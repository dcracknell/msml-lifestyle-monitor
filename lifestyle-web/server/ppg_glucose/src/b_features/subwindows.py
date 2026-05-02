"""
Sliding sub-window extraction within 15-min PPG segments.

Slides 30-second windows with 15-second overlap (~58 sub-windows
per 15-min segment). Each sub-window is gated on SQI > 0.8,
spike fraction < 1%, quiet fraction < 20%.

Surviving sub-windows are passed to pyppg_features.py and
prv_from_tpp.py for feature extraction.
"""

from __future__ import annotations

import argparse
import math
import os
import shutil
import time
import warnings
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

import numpy as np
import pandas as pd

from src.b_features._pyppg_helpers import load_config, reconstruct_segment_signals, run_pyppg


DEFAULT_SQI_THRESHOLD = 0.8
DEFAULT_SPIKE_THRESHOLD = 0.01
DEFAULT_QUIET_THRESHOLD = 0.20
DEFAULT_SUBWINDOW_SEC = 30.0
DEFAULT_OVERLAP_SEC = 15.0
SPIKE_MAD_MULTIPLIER = 5.0
QUIET_STD_RATIO = 0.05
MIN_PEAKS = 5

METADATA_COLUMNS = [
    "sid",
    "glucose_time_sec",
    "glucose_mgdl",
    "window_type",
    "subwin_idx",
    "subwin_start_sec",
    "sqi",
    "spike_fraction",
    "quiet_fraction",
    "n_peaks",
    "mean_tpp_sec",
    "npz_path",
]

WORKER_CFG: dict | None = None
WORKER_DATA_DIR: Path | None = None
WORKER_FS: int | None = None
WORKER_RAW_CACHE: dict[int, np.ndarray] | None = None
WORKER_OUTPUT_DIR: Path | None = None
WORKER_PROJECT_ROOT: Path | None = None
WORKER_THRESHOLDS: dict[str, float] | None = None


def subwindow_starts(
    n_samples: int,
    fs: int,
    subwindow_sec: float = DEFAULT_SUBWINDOW_SEC,
    overlap_sec: float = DEFAULT_OVERLAP_SEC,
) -> np.ndarray:
    """Return 0-indexed start samples for overlapping sub-windows."""
    window_samples = int(round(subwindow_sec * fs))
    step_samples = int(round((subwindow_sec - overlap_sec) * fs))
    if window_samples <= 0:
        raise ValueError("subwindow_sec must be positive.")
    if step_samples <= 0:
        raise ValueError("overlap_sec must be smaller than subwindow_sec.")
    if n_samples < window_samples:
        return np.array([], dtype=int)
    return np.arange(0, n_samples - window_samples + 1, step_samples, dtype=int)


def spike_fraction(signal: np.ndarray) -> float:
    """Fraction of samples more than 5 MAD from the sub-window median."""
    sig = np.asarray(signal, dtype=float)
    median = float(np.nanmedian(sig))
    mad = float(np.nanmedian(np.abs(sig - median)))
    if not np.isfinite(mad) or mad <= 0:
        mad = 1e-12
    spike_mask = np.abs(sig - median) > (SPIKE_MAD_MULTIPLIER * mad)
    return float(np.mean(spike_mask))


def quiet_fraction(signal: np.ndarray, fs: int, segment_std: float) -> float:
    """Fraction of 1-second mini-windows with std below 5% of segment std."""
    sig = np.asarray(signal, dtype=float)
    if not np.isfinite(segment_std) or segment_std <= 0:
        return 1.0

    mini_samples = max(1, int(round(fs)))
    n_complete = sig.size // mini_samples
    if n_complete == 0:
        return 1.0

    trimmed = sig[: n_complete * mini_samples].reshape(n_complete, mini_samples)
    mini_std = np.std(trimmed, axis=1)
    return float(np.mean(mini_std < (QUIET_STD_RATIO * segment_std)))


def extract_subwindows_from_segment(
    signal: np.ndarray,
    fs: int,
    sqi_threshold: float = DEFAULT_SQI_THRESHOLD,
    spike_threshold: float = DEFAULT_SPIKE_THRESHOLD,
    quiet_threshold: float = DEFAULT_QUIET_THRESHOLD,
    subwindow_sec: float = DEFAULT_SUBWINDOW_SEC,
    overlap_sec: float = DEFAULT_OVERLAP_SEC,
) -> list[dict]:
    """
    Slide sub-windows across a single 15-min segment, return list of
    dicts for surviving sub-windows. Each dict contains: signal, peaks,
    tpp, sqi, spike_fraction, quiet_fraction, subwin_idx, subwin_start_sec.
    """
    sig = np.asarray(signal, dtype=float)
    starts = subwindow_starts(sig.size, fs, subwindow_sec, overlap_sec)
    window_samples = int(round(subwindow_sec * fs))
    segment_std = float(np.nanstd(sig))
    survivors: list[dict] = []

    for idx, start in enumerate(starts):
        end = int(start + window_samples)
        sub_signal = sig[start:end]

        spikes = spike_fraction(sub_signal)
        quiet = quiet_fraction(sub_signal, fs, segment_std)

        if spikes >= spike_threshold or quiet >= quiet_threshold:
            continue

        pyppg_result = run_pyppg(sub_signal, fs, f"subwin_{idx}", "filtered")
        if (
            not pyppg_result.success
            or pyppg_result.peaks is None
            or pyppg_result.sqi_pct is None
        ):
            continue

        peaks = np.asarray(pyppg_result.peaks, dtype=int)
        if peaks.size < MIN_PEAKS:
            continue

        sqi = float(pyppg_result.sqi_pct / 100.0)
        if not np.isfinite(sqi) or sqi < sqi_threshold:
            continue

        tpp = np.diff(peaks) / float(fs)
        if tpp.size == 0:
            continue

        survivors.append(
            {
                "signal": np.asarray(sub_signal, dtype=np.float32),
                "peaks": peaks.astype(np.int32),
                "tpp": np.asarray(tpp, dtype=np.float32),
                "sqi": sqi,
                "spike_fraction": spikes,
                "quiet_fraction": quiet,
                "subwin_idx": int(idx),
                "subwin_start_sec": float(start / fs),
            }
        )

    return survivors


def _format_glucose_time(value: float) -> str:
    """Format glucose time for stable file names."""
    if float(value).is_integer():
        return str(int(round(float(value))))
    return f"{float(value):.3f}".rstrip("0").rstrip(".").replace(".", "p")


def _relative_npz_path(sid: int, glucose_time_sec: float, window_type: str, subwin_idx: int) -> Path:
    filename = f"{sid}_{_format_glucose_time(glucose_time_sec)}_{window_type}_{subwin_idx}.npz"
    return Path("data") / filename


def _save_subwindow_npz(path: Path, subwindow: dict, fs: int) -> None:
    np.savez_compressed(
        path,
        signal=subwindow["signal"],
        peaks=subwindow["peaks"],
        tpp=subwindow["tpp"],
        fs=np.array(fs, dtype=np.int32),
    )


def _init_worker(config_path: str, output_dir: str, thresholds: dict[str, float]) -> None:
    global WORKER_CFG, WORKER_DATA_DIR, WORKER_FS, WORKER_RAW_CACHE
    global WORKER_OUTPUT_DIR, WORKER_PROJECT_ROOT, WORKER_THRESHOLDS

    warnings.filterwarnings(
        "ignore",
        message="Setting an item of incompatible dtype is deprecated.*",
        category=FutureWarning,
    )

    config = Path(config_path).resolve()
    WORKER_PROJECT_ROOT = config.parents[1]
    WORKER_CFG = load_config(str(config))
    WORKER_DATA_DIR = (WORKER_PROJECT_ROOT / WORKER_CFG["data_dir"]).resolve()
    WORKER_FS = int(WORKER_CFG["ppg_sampling_rate"])
    WORKER_RAW_CACHE = {}
    WORKER_OUTPUT_DIR = Path(output_dir).resolve()
    WORKER_THRESHOLDS = thresholds


def _process_segment(row: dict) -> dict:
    if (
        WORKER_CFG is None
        or WORKER_DATA_DIR is None
        or WORKER_FS is None
        or WORKER_RAW_CACHE is None
        or WORKER_OUTPUT_DIR is None
        or WORKER_THRESHOLDS is None
    ):
        raise RuntimeError("Worker not initialized.")

    sid = int(row["sid"])
    glucose_time_sec = float(row["glucose_time_sec"])
    glucose_mgdl = float(row["glucose_mgdl"])
    lag_end_sec = glucose_time_sec - float(WORKER_CFG["lag_minutes"] * 60)

    result = {
        "sid": sid,
        "glucose_time_sec": glucose_time_sec,
        "current_attempted": 0,
        "lag_attempted": 0,
        "current_clean": 0,
        "lag_clean": 0,
        "lag_valid": False,
        "metadata_rows": [],
        "warnings": [],
    }

    windows = [("current", glucose_time_sec), ("lag", lag_end_sec)]
    for window_type, end_time_sec in windows:
        try:
            _, filtered_signal = reconstruct_segment_signals(
                sid=sid,
                glucose_time_sec=end_time_sec,
                fs=WORKER_FS,
                cfg=WORKER_CFG,
                raw_cache=WORKER_RAW_CACHE,
                data_dir=WORKER_DATA_DIR,
            )
        except Exception as exc:
            if window_type == "lag":
                result["warnings"].append(
                    f"sid={sid}, glucose_time_sec={glucose_time_sec:.1f}: lag skipped ({exc})"
                )
                continue
            result["warnings"].append(
                f"sid={sid}, glucose_time_sec={glucose_time_sec:.1f}: current skipped ({exc})"
            )
            continue

        attempted = int(
            subwindow_starts(
                len(filtered_signal),
                WORKER_FS,
                WORKER_THRESHOLDS["subwindow_sec"],
                WORKER_THRESHOLDS["overlap_sec"],
            ).size
        )
        result[f"{window_type}_attempted"] = attempted
        if window_type == "lag":
            result["lag_valid"] = True

        subwindows = extract_subwindows_from_segment(
            filtered_signal,
            WORKER_FS,
            sqi_threshold=WORKER_THRESHOLDS["sqi_threshold"],
            spike_threshold=WORKER_THRESHOLDS["spike_threshold"],
            quiet_threshold=WORKER_THRESHOLDS["quiet_threshold"],
            subwindow_sec=WORKER_THRESHOLDS["subwindow_sec"],
            overlap_sec=WORKER_THRESHOLDS["overlap_sec"],
        )
        result[f"{window_type}_clean"] = len(subwindows)

        for subwindow in subwindows:
            rel_path = _relative_npz_path(
                sid=sid,
                glucose_time_sec=glucose_time_sec,
                window_type=window_type,
                subwin_idx=int(subwindow["subwin_idx"]),
            )
            npz_path = WORKER_OUTPUT_DIR / rel_path
            _save_subwindow_npz(npz_path, subwindow, WORKER_FS)

            tpp = np.asarray(subwindow["tpp"], dtype=float)
            result["metadata_rows"].append(
                {
                    "sid": sid,
                    "glucose_time_sec": glucose_time_sec,
                    "glucose_mgdl": glucose_mgdl,
                    "window_type": window_type,
                    "subwin_idx": int(subwindow["subwin_idx"]),
                    "subwin_start_sec": float(subwindow["subwin_start_sec"]),
                    "sqi": float(subwindow["sqi"]),
                    "spike_fraction": float(subwindow["spike_fraction"]),
                    "quiet_fraction": float(subwindow["quiet_fraction"]),
                    "n_peaks": int(len(subwindow["peaks"])),
                    "mean_tpp_sec": float(np.mean(tpp)) if tpp.size else math.nan,
                    "npz_path": rel_path.as_posix(),
                }
            )

    return result


def _run_worker_local(
    row: dict,
    config_path: Path,
    output_dir: Path,
    thresholds: dict[str, float],
) -> dict:
    _init_worker(str(config_path), str(output_dir), thresholds)
    return _process_segment(row)


def _print_summary(
    master_df: pd.DataFrame,
    segment_results: list[dict],
    metadata_df: pd.DataFrame,
    output_dir: Path,
    runtime_sec: float,
) -> None:
    total_current = int(sum(r["current_attempted"] for r in segment_results))
    total_lag = int(sum(r["lag_attempted"] for r in segment_results))
    total_attempted = total_current + total_lag
    total_surviving = int(len(metadata_df))
    survival_pct = (total_surviving / total_attempted * 100.0) if total_attempted else 0.0

    print("=== sub-window extraction ===")
    print(f"Input: {len(master_df)} segments from {master_df['sid'].nunique()} subjects")
    print(
        f"Total sub-windows attempted: {total_current} (current) + "
        f"{total_lag} (lag) = {total_attempted}"
    )
    print(f"Surviving sub-windows: {total_surviving} ({survival_pct:.1f}%)")
    print()
    print("Per-subject summary:")

    result_df = pd.DataFrame(
        [
            {
                "sid": r["sid"],
                "glucose_time_sec": r["glucose_time_sec"],
                "attempted": r["current_attempted"] + r["lag_attempted"],
                "clean": r["current_clean"] + r["lag_clean"],
                "current_clean": r["current_clean"],
                "lag_clean": r["lag_clean"],
                "lag_valid": r["lag_valid"],
            }
            for r in segment_results
        ]
    )

    for sid, group in result_df.groupby("sid", sort=True):
        attempted = int(group["attempted"].sum())
        clean = int(group["clean"].sum())
        pct = (clean / attempted * 100.0) if attempted else 0.0
        print(
            f"  sid={int(sid)}: {len(group)} segments, "
            f"{clean} clean sub-windows ({pct:.1f}% survival)"
        )

    current_counts = result_df["current_clean"].astype(int)
    print()
    print("Per-segment statistics (summary):")
    print(f"  Mean clean sub-windows per current window: {current_counts.mean():.1f}")
    print(f"  Median: {current_counts.median():.1f}")
    print(f"  Min: {current_counts.min() if len(current_counts) else 0}")

    zero_rows = result_df.loc[result_df["current_clean"] == 0, ["sid", "glucose_time_sec"]]
    if not zero_rows.empty:
        print("  Segments with 0 surviving current sub-windows:")
        for _, row in zero_rows.iterrows():
            print(f"    sid={int(row['sid'])}, glucose_time_sec={float(row['glucose_time_sec']):.1f}")

    lag_valid = result_df.loc[result_df["lag_valid"]].copy()
    print()
    print("Lag window coverage:")
    print(f"  Segments with valid lag window: {len(lag_valid)}/{len(result_df)}")
    if len(lag_valid):
        print(f"  Mean clean sub-windows per lag window: {lag_valid['lag_clean'].mean():.1f}")
    else:
        print("  Mean clean sub-windows per lag window: 0.0")

    data_dir = output_dir / "data"
    print()
    print(f"Saved: {total_surviving} .npz files to {data_dir.as_posix()}/")
    print(f"Saved: {(output_dir / 'metadata.csv').as_posix()} ({len(metadata_df)} rows)")
    print()
    print(f"Total runtime: {runtime_sec:.2f}s")


def process_master_table(
    master_path: Path = Path("outputs/master_table_filtered.csv"),
    output_dir: Path = Path("outputs/subwindows"),
    config_path: Path = Path("configs/vitaldb.yaml"),
    sqi_threshold: float = DEFAULT_SQI_THRESHOLD,
    spike_threshold: float = DEFAULT_SPIKE_THRESHOLD,
    quiet_threshold: float = DEFAULT_QUIET_THRESHOLD,
    n_workers: int = 4,
) -> dict:
    """
    Run sub-window extraction on every segment in the filtered master table.
    Save .npz files and metadata.csv. Return summary statistics.
    """
    start_time = time.perf_counter()
    master_path = Path(master_path)
    output_dir = Path(output_dir)
    config_path = Path(config_path)
    data_dir = output_dir / "data"

    output_dir.mkdir(parents=True, exist_ok=True)
    if data_dir.exists():
        shutil.rmtree(data_dir)
    data_dir.mkdir(parents=True, exist_ok=True)

    master_df = pd.read_csv(master_path)
    if not {"sid", "glucose_time_sec", "glucose_mgdl"}.issubset(master_df.columns):
        raise ValueError("Master table must contain sid, glucose_time_sec, and glucose_mgdl.")

    thresholds = {
        "sqi_threshold": float(sqi_threshold),
        "spike_threshold": float(spike_threshold),
        "quiet_threshold": float(quiet_threshold),
        "subwindow_sec": DEFAULT_SUBWINDOW_SEC,
        "overlap_sec": DEFAULT_OVERLAP_SEC,
    }
    records = master_df.to_dict("records")
    segment_results: list[dict] = []
    completed = 0

    if n_workers <= 1:
        for row in records:
            segment_results.append(_run_worker_local(row, config_path, output_dir, thresholds))
            completed += 1
            if completed % 10 == 0 or completed == len(records):
                print(f"Processed {completed}/{len(records)} segments...")
    else:
        with ProcessPoolExecutor(
            max_workers=n_workers,
            initializer=_init_worker,
            initargs=(str(config_path), str(output_dir), thresholds),
        ) as executor:
            future_map = {executor.submit(_process_segment, row): row for row in records}
            for future in as_completed(future_map):
                segment_results.append(future.result())
                completed += 1
                if completed % 10 == 0 or completed == len(records):
                    print(f"Processed {completed}/{len(records)} segments...")

    segment_results = sorted(segment_results, key=lambda r: (int(r["sid"]), float(r["glucose_time_sec"])))
    metadata_rows = [row for result in segment_results for row in result["metadata_rows"]]
    metadata_df = pd.DataFrame(metadata_rows, columns=METADATA_COLUMNS)
    if not metadata_df.empty:
        metadata_df = metadata_df.sort_values(
            ["sid", "glucose_time_sec", "window_type", "subwin_idx"]
        ).reset_index(drop=True)
    metadata_df.to_csv(output_dir / "metadata.csv", index=False)

    warnings_seen = [warning for result in segment_results for warning in result["warnings"]]
    for warning in warnings_seen[:20]:
        print(f"WARNING: {warning}")
    if len(warnings_seen) > 20:
        print(f"WARNING: {len(warnings_seen) - 20} additional warnings omitted")

    runtime_sec = time.perf_counter() - start_time
    _print_summary(master_df, segment_results, metadata_df, output_dir, runtime_sec)

    total_current = int(sum(r["current_attempted"] for r in segment_results))
    total_lag = int(sum(r["lag_attempted"] for r in segment_results))
    total_surviving = int(len(metadata_df))
    zero_current = [
        {"sid": int(r["sid"]), "glucose_time_sec": float(r["glucose_time_sec"])}
        for r in segment_results
        if int(r["current_clean"]) == 0
    ]

    return {
        "n_segments_input": int(len(master_df)),
        "n_subjects_input": int(master_df["sid"].nunique()),
        "n_current_attempted": total_current,
        "n_lag_attempted": total_lag,
        "n_subwindows_attempted": total_current + total_lag,
        "n_subwindows_surviving": total_surviving,
        "n_metadata_rows": int(len(metadata_df)),
        "n_lag_valid": int(sum(1 for r in segment_results if r["lag_valid"])),
        "zero_current_segments": zero_current,
        "runtime_sec": float(runtime_sec),
        "metadata_path": str(output_dir / "metadata.csv"),
        "data_dir": str(data_dir),
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Extract gated v2 pyPPG sub-windows.")
    parser.add_argument("--master-path", type=Path, default=Path("outputs/master_table_filtered.csv"))
    parser.add_argument("--output-dir", type=Path, default=Path("outputs/subwindows"))
    parser.add_argument("--config-path", type=Path, default=Path("configs/vitaldb.yaml"))
    parser.add_argument("--sqi-threshold", type=float, default=DEFAULT_SQI_THRESHOLD)
    parser.add_argument("--spike-threshold", type=float, default=DEFAULT_SPIKE_THRESHOLD)
    parser.add_argument("--quiet-threshold", type=float, default=DEFAULT_QUIET_THRESHOLD)
    parser.add_argument(
        "--n-workers",
        type=int,
        default=min(4, max(1, os.cpu_count() or 1)),
    )
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    process_master_table(
        master_path=args.master_path,
        output_dir=args.output_dir,
        config_path=args.config_path,
        sqi_threshold=args.sqi_threshold,
        spike_threshold=args.spike_threshold,
        quiet_threshold=args.quiet_threshold,
        n_workers=args.n_workers,
    )
