"""
Sanity-check manual systolic peak detection against pyPPG on real 15-minute
PPG segments from the VitalDB glucose pipeline.

What this script does:
1. Loads the VitalDB config and master table.
2. Selects 5 random segments, stratified by HR category:
   - 2 high-HR segments (> 90 bpm)
   - 2 normal-HR segments (60-80 bpm)
   - 1 low-HR segment (< 60 bpm)
3. Reconstructs the raw and filtered 15-minute PPG windows for each segment
   from the original per-case `.npy` waveforms using the existing pipeline
   preprocessing helpers.
4. Runs:
   - the current manual detector from morphology_prv.py
   - pyPPG on the already-filtered signal
   - pyPPG on the raw signal with pyPPG's own preprocessing
5. Uses the raw-input pyPPG result as the primary comparison when available,
   falling back to the filtered-input pyPPG result if the raw path fails.
6. Computes peak-set agreement metrics and saves one PNG per segment plus a
   summary CSV under outputs/sanity_check_pyppg/.

Notes on this environment:
- pyPPG 1.0.73 assumes older NumPy/Pandas behavior. NumPy 2 removed `np.NaN`,
  so we add a runtime alias below.
- pyPPG's full `get_fiducials()` DataFrame assembly is incompatible with
  pandas >= 3 because of chained assignment. To avoid modifying installed
  packages, this script uses `FpCollection.get_peak_onset("PPGdet")`, which is
  the same validated pyPPG peak detector used internally before fiducial
  assembly.
"""

from __future__ import annotations

import argparse
import math
import sys
import traceback
from dataclasses import dataclass
from pathlib import Path

import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from dotmap import DotMap
from scipy.signal import find_peaks

# pyPPG 1.0.73 expects this alias, but NumPy 2 removed it.
if not hasattr(np, "NaN"):
    np.NaN = np.nan  # type: ignore[attr-defined]

PROJECT_ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = PROJECT_ROOT / "configs" / "vitaldb.yaml"
MASTER_TABLE_PATH = PROJECT_ROOT / "outputs" / "master_table.csv"
DEFAULT_OUTPUT_DIR = PROJECT_ROOT / "outputs" / "sanity_check_pyppg"

if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

import pyPPG
import pyPPG.fiducials as FP
import pyPPG.ppg_sqi as SQI
import pyPPG.preproc as PP
from src.a_preprocessing.load_vitaldb import load_config
from src.a_preprocessing.preprocess import (
    bandpass_filter,
    extract_window,
    fill_missing_samples,
)


RNG_SEED = 42
PYPPG_SM_WINS = {"ppg": 50, "vpg": 10, "apg": 10, "jpg": 10}
PYPPG_RAW_FILTER = {"fL": 0.5000001, "fH": 12.0, "order": 4}


@dataclass
class PyPPGResult:
    mode: str
    success: bool
    peaks: np.ndarray | None
    sqi_pct: float | None
    peak_source: str | None
    error: str | None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=CONFIG_PATH)
    parser.add_argument("--master-table", type=Path, default=MASTER_TABLE_PATH)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--seed", type=int, default=RNG_SEED)
    return parser.parse_args()


def manual_detect_peaks(sig: np.ndarray, fs: int) -> np.ndarray:
    """Replicate the exact detector used in morphology_prv.py."""
    min_distance = int(0.4 * fs)
    peaks, _ = find_peaks(
        sig,
        distance=min_distance,
        prominence=0.1 * np.std(sig),
    )
    return peaks.astype(int)


def categorize_hr(hr_bpm: float) -> str:
    if hr_bpm > 90:
        return "high"
    if 60 <= hr_bpm <= 80:
        return "normal"
    if hr_bpm < 60:
        return "low"
    return "other"


def sample_stratified_segments(df: pd.DataFrame, seed: int) -> pd.DataFrame:
    work = df.copy()
    work = work.loc[work["w15m_hr_bpm"].notna()].copy()
    work["hr_category"] = work["w15m_hr_bpm"].map(categorize_hr)

    category_plan = [("high", 2), ("normal", 2), ("low", 1)]
    rng = np.random.default_rng(seed)
    picked_frames: list[pd.DataFrame] = []

    for category, count in category_plan:
        subset = work.loc[work["hr_category"] == category].copy()
        if len(subset) < count:
            raise RuntimeError(
                f"Need {count} segments for HR category '{category}', found {len(subset)}."
            )
        choice_idx = rng.choice(subset.index.to_numpy(), size=count, replace=False)
        picked = subset.loc[choice_idx].copy()
        picked["selection_bucket"] = category
        picked_frames.append(picked)

    selected = pd.concat(picked_frames, axis=0, ignore_index=True)
    selected["segment_id"] = selected.apply(
        lambda row: f"{int(row['sid'])}_{int(round(row['glucose_time_sec']))}",
        axis=1,
    )
    return selected[
        [
            "segment_id",
            "sid",
            "glucose_time_sec",
            "w15m_hr_bpm",
            "hr_category",
            "selection_bucket",
        ]
    ].copy()


def load_case_ppg(caseid: int, cfg: dict, data_dir: Path) -> np.ndarray:
    rel = Path(cfg["ppg_file_pattern"].format(caseid=caseid))
    path = data_dir / rel
    ppg = np.load(path)
    if ppg.ndim > 1:
        ppg = ppg.flatten()
    return np.asarray(ppg, dtype=float)


def reconstruct_segment_signals(
    sid: int,
    glucose_time_sec: float,
    fs: int,
    cfg: dict,
    raw_cache: dict[int, np.ndarray],
    data_dir: Path,
) -> tuple[np.ndarray, np.ndarray]:
    if sid not in raw_cache:
        raw_cache[sid] = load_case_ppg(sid, cfg, data_dir)

    raw_full = raw_cache[sid]
    raw_window = extract_window(raw_full, glucose_time_sec, cfg["window_minutes"], fs)
    if raw_window is None:
        raise RuntimeError(
            f"Failed to reconstruct raw window for sid={sid}, t={glucose_time_sec:.1f}s."
        )

    raw_filled = fill_missing_samples(raw_window)
    if raw_filled is None:
        raise RuntimeError(
            f"fill_missing_samples returned None for sid={sid}, t={glucose_time_sec:.1f}s."
        )

    filtered = bandpass_filter(
        raw_filled,
        cfg["bandpass_low"],
        cfg["bandpass_high"],
        fs,
        cfg["bandpass_order"],
    )
    return np.asarray(raw_filled, dtype=float), np.asarray(filtered, dtype=float)


def build_pyppg_signal(sig: np.ndarray, fs: int, name: str, filtering: bool) -> DotMap:
    signal = DotMap()
    signal.v = np.asarray(sig, dtype=float)
    signal.fs = int(fs)
    signal.start_sig = 0
    signal.end_sig = len(sig)
    signal.name = name
    signal.filtering = filtering
    signal.fL = PYPPG_RAW_FILTER["fL"]
    signal.fH = PYPPG_RAW_FILTER["fH"]
    signal.order = PYPPG_RAW_FILTER["order"]
    signal.sm_wins = dict(PYPPG_SM_WINS)
    signal.correction = pd.DataFrame()

    prep = PP.Preprocess(
        fL=signal.fL,
        fH=signal.fH,
        order=signal.order,
        sm_wins=signal.sm_wins,
    )
    signal.ppg, signal.vpg, signal.apg, signal.jpg = prep.get_signals(s=signal)
    return signal


def run_pyppg(sig: np.ndarray, fs: int, segment_id: str, mode: str) -> PyPPGResult:
    filtering = mode == "raw"
    signal_name = f"{segment_id}_{mode}"

    try:
        signal = build_pyppg_signal(sig=sig, fs=fs, name=signal_name, filtering=filtering)
        s = pyPPG.PPG(s=signal, check_ppg_len=False)
        fpex = FP.FpCollection(s=s)

        # pyPPG 1.0.73 + pandas >= 3 breaks inside get_fiducials() because of
        # chained assignment. get_peak_onset() is the same validated detector
        # used internally before the incompatible DataFrame assembly step.
        peaks, _ = fpex.get_peak_onset("PPGdet")
        peaks = np.asarray(peaks, dtype=int)

        if peaks.size == 0:
            raise RuntimeError("pyPPG returned zero systolic peaks.")

        sqi_pct = compute_sqi_pct(s.ppg, s.fs, peaks)

        return PyPPGResult(
            mode=mode,
            success=True,
            peaks=peaks,
            sqi_pct=sqi_pct,
            peak_source="FpCollection.get_peak_onset('PPGdet')",
            error=None,
        )
    except Exception as exc:
        return PyPPGResult(
            mode=mode,
            success=False,
            peaks=None,
            sqi_pct=None,
            peak_source=None,
            error=f"{type(exc).__name__}: {exc}",
        )


def compute_sqi_pct(ppg: np.ndarray, fs: int, peaks: np.ndarray) -> float | None:
    if peaks.size < 2:
        return None

    sqi_values = SQI.get_ppgSQI(ppg=ppg, fs=fs, annotation=peaks)
    if sqi_values is None:
        return None

    sqi_values = np.asarray(sqi_values, dtype=float)
    if sqi_values.size == 0 or np.all(np.isnan(sqi_values)):
        return None

    return float(np.nanmean(sqi_values) * 100.0)


def choose_primary_pyppg_result(
    raw_result: PyPPGResult,
    filtered_result: PyPPGResult,
) -> tuple[PyPPGResult | None, str]:
    if raw_result.success:
        return raw_result, "raw"
    if filtered_result.success:
        return filtered_result, "filtered"
    return None, "failed"


def one_to_one_peak_matches(
    my_peaks: np.ndarray,
    ref_peaks: np.ndarray,
    tolerance_samples: int,
) -> list[tuple[int, int, int]]:
    """Greedy one-to-one matching over all candidate pairs, sorted by distance."""
    if my_peaks.size == 0 or ref_peaks.size == 0:
        return []

    my_sorted = np.asarray(my_peaks, dtype=int)
    ref_sorted = np.asarray(ref_peaks, dtype=int)
    candidates: list[tuple[int, int, int]] = []

    ref_start = 0
    for i, peak in enumerate(my_sorted):
        while ref_start < len(ref_sorted) and ref_sorted[ref_start] < peak - tolerance_samples:
            ref_start += 1

        j = ref_start
        while j < len(ref_sorted) and ref_sorted[j] <= peak + tolerance_samples:
            candidates.append((abs(int(peak - ref_sorted[j])), i, j))
            j += 1

    candidates.sort(key=lambda item: item[0])

    used_my: set[int] = set()
    used_ref: set[int] = set()
    matches: list[tuple[int, int, int]] = []

    for abs_diff, my_idx, ref_idx in candidates:
        if my_idx in used_my or ref_idx in used_ref:
            continue
        used_my.add(my_idx)
        used_ref.add(ref_idx)
        matches.append((my_idx, ref_idx, abs_diff))

    return matches


def compute_agreement_metrics(
    my_peaks: np.ndarray,
    pyppg_peaks: np.ndarray,
    tolerance_samples: int,
    fs: int,
) -> dict[str, float | int | None]:
    matches = one_to_one_peak_matches(my_peaks, pyppg_peaks, tolerance_samples)
    matched = len(matches)
    missed_by_mine = int(len(pyppg_peaks) - matched)
    extra_in_mine = int(len(my_peaks) - matched)
    if max(len(my_peaks), len(pyppg_peaks)):
        agreement = matched / max(len(my_peaks), len(pyppg_peaks))
    else:
        agreement = math.nan

    if matches:
        abs_diffs_samples = np.array([item[2] for item in matches], dtype=float)
        mean_abs_diff_ms = float(abs_diffs_samples.mean() / fs * 1000.0)
        median_abs_diff_ms = float(np.median(abs_diffs_samples) / fs * 1000.0)
    else:
        mean_abs_diff_ms = None
        median_abs_diff_ms = None

    return {
        "matched": matched,
        "missed_by_mine": missed_by_mine,
        "extra_in_mine": extra_in_mine,
        "agreement_pct": float(agreement * 100.0),
        "mean_abs_diff_ms": mean_abs_diff_ms,
        "median_abs_diff_ms": median_abs_diff_ms,
    }


def format_metric(value: object, decimals: int = 2) -> str:
    if value is None:
        return "N/A"
    if isinstance(value, float):
        if np.isnan(value):
            return "N/A"
        return f"{value:.{decimals}f}"
    return str(value)


def plot_segment(
    out_path: Path,
    segment_id: str,
    sid: int,
    glucose_time_sec: float,
    hr_category: str,
    hr_bpm: float,
    filtered_signal: np.ndarray,
    fs: int,
    my_peaks: np.ndarray,
    primary_result: PyPPGResult | None,
    agreement_pct: float | None,
    sqi_pct: float | None,
    pyppg_source: str,
) -> None:
    time_sec = np.arange(filtered_signal.size) / fs
    line_step = max(1, fs // 100)

    fig, (ax_sig, ax_info) = plt.subplots(
        2,
        1,
        figsize=(16, 7),
        gridspec_kw={"height_ratios": [5, 1]},
        constrained_layout=True,
    )

    ax_sig.plot(
        time_sec[::line_step],
        filtered_signal[::line_step],
        color="black",
        linewidth=0.8,
        alpha=0.85,
        label="Filtered PPG",
    )

    ax_sig.plot(
        my_peaks / fs,
        filtered_signal[my_peaks],
        "o",
        color="red",
        markersize=3,
        alpha=0.8,
        label="My peaks",
    )

    if primary_result is not None and primary_result.success and primary_result.peaks is not None:
        pyppg_peaks = primary_result.peaks
        ax_sig.plot(
            pyppg_peaks / fs,
            filtered_signal[pyppg_peaks],
            "^",
            color="royalblue",
            markersize=3.5,
            alpha=0.8,
            label=f"pyPPG peaks ({pyppg_source})",
        )

    title = (
        f"Segment {segment_id} | sid={sid} | HR={hr_bpm:.1f} bpm ({hr_category}) | "
        f"Agreement={format_metric(agreement_pct)}% | SQI={format_metric(sqi_pct)}%"
    )
    ax_sig.set_title(title)
    ax_sig.set_xlabel("Time (s)")
    ax_sig.set_ylabel("Amplitude")
    ax_sig.legend(loc="upper right")
    ax_sig.grid(alpha=0.2)

    ax_info.axis("off")
    if primary_result is None:
        info_text = (
            f"glucose_time_sec={glucose_time_sec:.1f}\n"
            "pyPPG failed in both raw and filtered modes."
        )
    else:
        info_text = (
            f"glucose_time_sec={glucose_time_sec:.1f} s | "
            f"pyPPG mode={primary_result.mode} | "
            f"peak source={primary_result.peak_source}\n"
            f"manual peaks={len(my_peaks)} | "
            f"pyPPG peaks={len(primary_result.peaks) if primary_result.peaks is not None else 'N/A'} | "
            f"SQI={format_metric(primary_result.sqi_pct)}%"
        )
    ax_info.text(0.01, 0.65, info_text, fontsize=11, va="top", ha="left")

    fig.savefig(out_path, dpi=180)
    plt.close(fig)


def print_selection_header(selected: pd.DataFrame) -> None:
    print("=" * 88)
    print("Selected 5 stratified segments")
    print("=" * 88)
    print(
        selected[
            ["segment_id", "sid", "glucose_time_sec", "w15m_hr_bpm", "hr_category"]
        ].to_string(index=False)
    )
    print()


def summarize_sqi_trend(summary_df: pd.DataFrame) -> str:
    valid = summary_df.loc[summary_df["sqi_pct"].notna()].copy()
    if valid.empty:
        return "SQI trend: no valid SQI values."

    parts: list[str] = []
    for category in ["high", "normal", "low"]:
        subset = valid.loc[valid["hr_category"] == category, "sqi_pct"]
        if subset.empty:
            continue
        parts.append(f"{category}={subset.mean():.2f}%")

    trend = " | ".join(parts) if parts else "no category means available"

    if {"high", "normal"}.issubset(set(valid["hr_category"])):
        high_mean = valid.loc[valid["hr_category"] == "high", "sqi_pct"].mean()
        normal_mean = valid.loc[valid["hr_category"] == "normal", "sqi_pct"].mean()
        if high_mean + 1e-9 < normal_mean:
            verdict = "High-HR segments had lower mean SQI than normal-HR segments."
        elif high_mean > normal_mean + 1e-9:
            verdict = "High-HR segments had higher mean SQI than normal-HR segments."
        else:
            verdict = "High-HR and normal-HR mean SQI were essentially the same."
    else:
        verdict = "Not enough categories for a high-vs-normal SQI comparison."

    return f"SQI trend: {trend}. {verdict}"


def build_display_summary(summary_df: pd.DataFrame) -> pd.DataFrame:
    display = summary_df[
        [
            "segment_id",
            "my_peak_count",
            "pyppg_peak_count",
            "agreement_pct",
            "sqi_pct",
            "hr_category",
            "pyppg_mode_used",
        ]
    ].copy()

    for col in ["agreement_pct", "sqi_pct"]:
        display[col] = display[col].map(lambda value: format_metric(value))

    for col in ["my_peak_count", "pyppg_peak_count"]:
        display[col] = display[col].map(lambda value: format_metric(value, decimals=0))

    return display


def main() -> None:
    args = parse_args()

    cfg = load_config(str(args.config))
    master_df = pd.read_csv(args.master_table)

    output_dir = args.output_dir
    output_dir.mkdir(parents=True, exist_ok=True)

    data_dir = (PROJECT_ROOT / cfg["data_dir"]).resolve()
    raw_ppg_dir = data_dir / Path(cfg["ppg_file_pattern"]).parent
    fs = int(cfg["ppg_sampling_rate"])
    tolerance_samples = int(round(0.1 * fs))

    print("=" * 88)
    print("PPG sanity check: manual detector vs pyPPG")
    print("=" * 88)
    print(f"Config:              {args.config}")
    print(f"Master table:        {args.master_table}")
    print(f"Output directory:    {output_dir}")
    print(f"Sampling rate:       {fs} Hz")
    print(f"Tolerance window:    +/-{tolerance_samples} samples (+/-100 ms)")
    print(f"Raw PPG directory:   {raw_ppg_dir}")
    print(
        "Segment source note: no pre-saved segment directory is defined in the config, "
        "so 15-minute windows are reconstructed from the raw per-case `.npy` files "
        "using the existing preprocessing helpers."
    )
    print()

    selected = sample_stratified_segments(master_df, seed=args.seed)
    print_selection_header(selected)

    raw_cache: dict[int, np.ndarray] = {}
    rows: list[dict[str, object]] = []

    for _, row in selected.iterrows():
        segment_id = str(row["segment_id"])
        sid = int(row["sid"])
        glucose_time_sec = float(row["glucose_time_sec"])
        hr_bpm = float(row["w15m_hr_bpm"])
        hr_category = str(row["hr_category"])

        print(f"[{segment_id}] Processing {hr_category} HR segment at t={glucose_time_sec:.1f}s...")

        try:
            raw_signal, filtered_signal = reconstruct_segment_signals(
                sid=sid,
                glucose_time_sec=glucose_time_sec,
                fs=fs,
                cfg=cfg,
                raw_cache=raw_cache,
                data_dir=data_dir,
            )
            my_peaks = manual_detect_peaks(filtered_signal, fs)

            pyppg_filtered = run_pyppg(
                sig=filtered_signal,
                fs=fs,
                segment_id=segment_id,
                mode="filtered",
            )
            pyppg_raw = run_pyppg(
                sig=raw_signal,
                fs=fs,
                segment_id=segment_id,
                mode="raw",
            )
            primary_result, pyppg_mode_used = choose_primary_pyppg_result(
                raw_result=pyppg_raw,
                filtered_result=pyppg_filtered,
            )

            agreement_metrics: dict[str, object]
            pyppg_peak_count: int | float
            sqi_pct: float | None
            failure_reason: str | None = None

            if primary_result is not None and primary_result.peaks is not None:
                agreement_metrics = compute_agreement_metrics(
                    my_peaks=my_peaks,
                    pyppg_peaks=primary_result.peaks,
                    tolerance_samples=tolerance_samples,
                    fs=fs,
                )
                pyppg_peak_count = int(len(primary_result.peaks))
                sqi_pct = primary_result.sqi_pct
            else:
                agreement_metrics = {
                    "matched": None,
                    "missed_by_mine": None,
                    "extra_in_mine": None,
                    "agreement_pct": math.nan,
                    "mean_abs_diff_ms": None,
                    "median_abs_diff_ms": None,
                }
                pyppg_peak_count = math.nan
                sqi_pct = None
                failure_reason = (
                    f"raw -> {pyppg_raw.error or 'N/A'} | "
                    f"filtered -> {pyppg_filtered.error or 'N/A'}"
                )

            plot_path = output_dir / f"{segment_id}.png"
            plot_segment(
                out_path=plot_path,
                segment_id=segment_id,
                sid=sid,
                glucose_time_sec=glucose_time_sec,
                hr_category=hr_category,
                hr_bpm=hr_bpm,
                filtered_signal=filtered_signal,
                fs=fs,
                my_peaks=my_peaks,
                primary_result=primary_result,
                agreement_pct=(
                    None
                    if math.isnan(float(agreement_metrics["agreement_pct"]))
                    else float(agreement_metrics["agreement_pct"])
                ),
                sqi_pct=sqi_pct,
                pyppg_source=pyppg_mode_used,
            )

            result_row = {
                "segment_id": segment_id,
                "sid": sid,
                "glucose_time_sec": glucose_time_sec,
                "w15m_hr_bpm": hr_bpm,
                "hr_category": hr_category,
                "my_peak_count": int(len(my_peaks)),
                "pyppg_peak_count": pyppg_peak_count,
                "agreement_pct": agreement_metrics["agreement_pct"],
                "matched": agreement_metrics["matched"],
                "missed_by_mine": agreement_metrics["missed_by_mine"],
                "extra_in_mine": agreement_metrics["extra_in_mine"],
                "mean_abs_diff_ms": agreement_metrics["mean_abs_diff_ms"],
                "median_abs_diff_ms": agreement_metrics["median_abs_diff_ms"],
                "sqi_pct": sqi_pct,
                "pyppg_mode_used": pyppg_mode_used,
                "pyppg_raw_peak_count": len(pyppg_raw.peaks) if pyppg_raw.peaks is not None else math.nan,
                "pyppg_filtered_peak_count": len(pyppg_filtered.peaks) if pyppg_filtered.peaks is not None else math.nan,
                "pyppg_raw_sqi_pct": pyppg_raw.sqi_pct if pyppg_raw.success else math.nan,
                "pyppg_filtered_sqi_pct": pyppg_filtered.sqi_pct if pyppg_filtered.success else math.nan,
                "pyppg_raw_error": pyppg_raw.error,
                "pyppg_filtered_error": pyppg_filtered.error,
                "pyppg_peak_source": primary_result.peak_source if primary_result is not None else None,
                "pyppg_failed": primary_result is None,
                "pyppg_failure_reason": failure_reason,
                "plot_path": str(plot_path),
            }
            rows.append(result_row)
        except Exception as exc:
            failure_trace = traceback.format_exc(limit=3)
            plot_path = output_dir / f"{segment_id}.png"
            rows.append(
                {
                    "segment_id": segment_id,
                    "sid": sid,
                    "glucose_time_sec": glucose_time_sec,
                    "w15m_hr_bpm": hr_bpm,
                    "hr_category": hr_category,
                    "my_peak_count": math.nan,
                    "pyppg_peak_count": math.nan,
                    "agreement_pct": math.nan,
                    "matched": None,
                    "missed_by_mine": None,
                    "extra_in_mine": None,
                    "mean_abs_diff_ms": None,
                    "median_abs_diff_ms": None,
                    "sqi_pct": math.nan,
                    "pyppg_mode_used": "failed",
                    "pyppg_raw_peak_count": math.nan,
                    "pyppg_filtered_peak_count": math.nan,
                    "pyppg_raw_sqi_pct": math.nan,
                    "pyppg_filtered_sqi_pct": math.nan,
                    "pyppg_raw_error": None,
                    "pyppg_filtered_error": None,
                    "pyppg_peak_source": None,
                    "pyppg_failed": True,
                    "pyppg_failure_reason": f"{type(exc).__name__}: {exc}",
                    "plot_path": str(plot_path),
                    "segment_exception_trace": failure_trace,
                }
            )
            print(f"  FAILED: {type(exc).__name__}: {exc}")

    summary_df = pd.DataFrame(rows)
    summary_csv = output_dir / "summary.csv"
    summary_df.to_csv(summary_csv, index=False)

    display_summary = build_display_summary(summary_df)
    print()
    print("=" * 88)
    print("Summary table")
    print("=" * 88)
    print(display_summary.to_string(index=False))
    print()

    successful_agreements = summary_df.loc[summary_df["agreement_pct"].notna(), "agreement_pct"]
    mean_agreement = float(successful_agreements.mean()) if not successful_agreements.empty else math.nan
    median_agreement = float(successful_agreements.median()) if not successful_agreements.empty else math.nan
    failed_segments = summary_df.loc[summary_df["pyppg_failed"], ["segment_id", "pyppg_failure_reason"]]

    print(f"Mean agreement (%):   {format_metric(mean_agreement)}")
    print(f"Median agreement (%): {format_metric(median_agreement)}")
    if failed_segments.empty:
        print("pyPPG failures:       none")
    else:
        print("pyPPG failures:")
        print(failed_segments.to_string(index=False))
    print(summarize_sqi_trend(summary_df))
    print()
    print(f"Saved summary CSV:    {summary_csv}")
    print(f"Saved segment plots:  {output_dir}")


if __name__ == "__main__":
    main()
