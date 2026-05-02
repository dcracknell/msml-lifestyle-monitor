"""
Per-sub-window pyPPG biomarker extraction.

Runs the full pyPPG pipeline (preprocessing -> fiducials -> biomarkers)
on each surviving 30-second sub-window. Aggregates the 102 per-pulse
biomarkers as median + IQR across sub-windows.

Replaces summary_stats.py per-pulse features and morphology_prv.py
in their entirety.

Requires pyPPG 1.0.73 with pandas<2.2 and numpy<2.0 (see requirements.txt).
"""

from __future__ import annotations

import argparse
import io
import math
import os
import time
import warnings
from contextlib import redirect_stdout
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

import numpy as np
import pandas as pd
from pyPPG import Fiducials, PPG

import pyPPG.biomarkers as BM
import pyPPG.fiducials as FP
from src.b_features._pyppg_helpers import build_pyppg_signal


warnings.filterwarnings(
    "ignore",
    message="Setting an item of incompatible dtype is deprecated.*",
    category=FutureWarning,
)
warnings.filterwarnings(
    "ignore",
    message="Conversion of an array with ndim > 0 to a scalar is deprecated.*",
    category=DeprecationWarning,
)

IDENTIFIER_COLUMNS = [
    "sid",
    "glucose_time_sec",
    "glucose_mgdl",
    "window_type",
    "subwin_idx",
    "subwin_start_sec",
    "npz_path",
]
SEGMENT_KEY_COLUMNS = ["sid", "glucose_time_sec", "glucose_mgdl"]
WINDOW_TYPES = ["current", "lag"]


def _capture_stdout(func, *args, **kwargs):
    """Run noisy pyPPG calls without emitting their internal print output."""
    buffer = io.StringIO()
    with redirect_stdout(buffer):
        result = func(*args, **kwargs)
    return result


def _clean_biomarker_name(name: object) -> str:
    """Return biomarker names exactly as pyPPG reports them, as strings."""
    return str(name)


def _numeric_finite(values: pd.Series) -> pd.Series:
    """Coerce a biomarker pulse series to finite numeric values."""
    numeric = pd.to_numeric(values, errors="coerce")
    numeric = numeric.replace([np.inf, -np.inf], np.nan).dropna()
    return numeric.astype(float)


def _clip_within_distribution(values: pd.Series) -> pd.Series:
    """
    Clip only within the values supplied.

    This is used for per-sub-window pulse distributions and per-segment
    sub-window distributions. It never uses global percentiles.
    """
    numeric = _numeric_finite(values)
    if numeric.empty:
        return numeric
    if len(numeric) < 3:
        return numeric

    lower = float(numeric.quantile(0.01))
    upper = float(numeric.quantile(0.99))
    if not np.isfinite(lower) or not np.isfinite(upper) or lower > upper:
        return numeric
    return numeric.clip(lower=lower, upper=upper)


def _biomarker_names_from_defs(bm_defs: dict[str, pd.DataFrame]) -> list[str]:
    names: list[str] = []
    for category in ["ppg_sig", "sig_ratios", "ppg_derivs", "derivs_ratios"]:
        if category not in bm_defs:
            continue
        defs_df = bm_defs[category]
        if "name" not in defs_df.columns:
            continue
        for name in defs_df["name"].tolist():
            name = _clean_biomarker_name(name)
            if name not in names:
                names.append(name)
    return names


def _summarise_subwindow_biomarkers(
    bm_defs: dict[str, pd.DataFrame],
    bm_vals: dict[str, pd.DataFrame],
    bm_stats: dict[str, pd.DataFrame],
) -> dict:
    """
    Return one median value per biomarker for a single sub-window.

    Pulse-level values are clipped at the 1st/99th percentiles inside that
    sub-window only before taking the median.
    """
    biomarker_values: dict[str, float] = {}

    for category in ["ppg_sig", "sig_ratios", "ppg_derivs", "derivs_ratios"]:
        if category not in bm_defs or category not in bm_vals:
            continue

        vals_df = bm_vals[category]
        stats_df = bm_stats.get(category)
        names = bm_defs[category]["name"].tolist()

        for raw_name in names:
            name = _clean_biomarker_name(raw_name)
            value = math.nan

            if raw_name in vals_df.columns:
                clipped = _clip_within_distribution(vals_df[raw_name])
                if not clipped.empty:
                    value = float(clipped.median())

            if not np.isfinite(value) and stats_df is not None and name in stats_df.columns:
                try:
                    value = float(stats_df.loc["median", name])
                except Exception:
                    value = math.nan

            biomarker_values[name] = value

    return biomarker_values


def extract_biomarkers_from_subwindow(
    npz_path: Path,
    fs: int = 500,
) -> dict | None:
    """
    Run pyPPG biomarker pipeline on a single sub-window.
    Returns dict mapping biomarker name to median value across pulses,
    or None if pyPPG fails on this sub-window.
    """
    try:
        npz = np.load(Path(npz_path))
        signal = np.asarray(npz["signal"], dtype=float)
        npz_fs = int(np.asarray(npz["fs"]).item()) if "fs" in npz.files else int(fs)

        pyppg_signal = build_pyppg_signal(signal, npz_fs, Path(npz_path).stem, False)
        s = PPG(s=pyppg_signal, check_ppg_len=False)

        fpex = FP.FpCollection(s=s)
        fiducials = _capture_stdout(fpex.get_fiducials, s=s)
        fp = Fiducials(fp=fiducials)

        bmex = BM.BmCollection(s=s, fp=fp)
        bm_defs, bm_vals, bm_stats = _capture_stdout(bmex.get_biomarkers)

        biomarkers = _summarise_subwindow_biomarkers(bm_defs, bm_vals, bm_stats)
        if len(biomarkers) == 0:
            return None
        return biomarkers
    except Exception:
        return None


def _biomarker_columns(df: pd.DataFrame) -> list[str]:
    return [c for c in df.columns if c not in IDENTIFIER_COLUMNS]


def aggregate_segment(
    subwin_biomarker_rows: pd.DataFrame,
    window_type: str,
) -> dict:
    """
    Given the per-sub-window biomarker DataFrame for one segment,
    return a dict of aggregated features (median + IQR per biomarker)
    for that single segment. Pure within-segment computation.
    """
    rows = subwin_biomarker_rows.loc[
        subwin_biomarker_rows["window_type"] == window_type
    ].copy()

    result: dict[str, float | int] = {
        f"{window_type}_n_subwindows_used": int(len(rows))
    }

    for biomarker in _biomarker_columns(subwin_biomarker_rows):
        if len(rows) == 0:
            result[f"{window_type}_{biomarker}_median"] = math.nan
            result[f"{window_type}_{biomarker}_iqr"] = math.nan
            continue

        values = _clip_within_distribution(rows[biomarker])
        if values.empty:
            result[f"{window_type}_{biomarker}_median"] = math.nan
            result[f"{window_type}_{biomarker}_iqr"] = math.nan
            continue

        q1 = float(values.quantile(0.25))
        q3 = float(values.quantile(0.75))
        result[f"{window_type}_{biomarker}_median"] = float(values.median())
        result[f"{window_type}_{biomarker}_iqr"] = float(q3 - q1)

    return result


def _worker_extract(row: dict, subwindow_root: str) -> dict:
    warnings.filterwarnings(
        "ignore",
        message="Setting an item of incompatible dtype is deprecated.*",
        category=FutureWarning,
    )
    warnings.filterwarnings(
        "ignore",
        message="Conversion of an array with ndim > 0 to a scalar is deprecated.*",
        category=DeprecationWarning,
    )

    rel_path = str(row["npz_path"])
    npz_path = Path(subwindow_root) / rel_path
    biomarker_values = extract_biomarkers_from_subwindow(npz_path)

    base = {
        "sid": int(row["sid"]),
        "glucose_time_sec": float(row["glucose_time_sec"]),
        "glucose_mgdl": float(row["glucose_mgdl"]),
        "window_type": str(row["window_type"]),
        "subwin_idx": int(row["subwin_idx"]),
        "subwin_start_sec": float(row["subwin_start_sec"]),
        "npz_path": rel_path,
    }

    if biomarker_values is None:
        return {
            "success": False,
            "row": base,
        }

    base.update(biomarker_values)
    return {
        "success": True,
        "row": base,
    }


def _worker_extract_many(rows: list[dict], subwindow_root: str) -> list[dict]:
    """Extract biomarkers for a chunk of metadata rows in one worker task."""
    return [_worker_extract(row, subwindow_root) for row in rows]


def _aggregate_all_segments(
    metadata_df: pd.DataFrame,
    per_subwindow_df: pd.DataFrame,
) -> pd.DataFrame:
    segment_rows = (
        metadata_df[SEGMENT_KEY_COLUMNS]
        .drop_duplicates()
        .sort_values(["sid", "glucose_time_sec"])
        .reset_index(drop=True)
    )
    biomarker_columns = _biomarker_columns(per_subwindow_df)
    rows: list[dict] = []

    for _, segment in segment_rows.iterrows():
        sid = int(segment["sid"])
        glucose_time_sec = float(segment["glucose_time_sec"])
        glucose_mgdl = float(segment["glucose_mgdl"])
        segment_subwindows = per_subwindow_df.loc[
            (per_subwindow_df["sid"] == sid)
            & (per_subwindow_df["glucose_time_sec"] == glucose_time_sec)
        ].copy()

        row: dict[str, float | int] = {
            "sid": sid,
            "glucose_time_sec": glucose_time_sec,
            "glucose_mgdl": glucose_mgdl,
        }

        if segment_subwindows.empty:
            empty = pd.DataFrame(columns=IDENTIFIER_COLUMNS + biomarker_columns)
            for window_type in WINDOW_TYPES:
                row.update(aggregate_segment(empty, window_type))
        else:
            for window_type in WINDOW_TYPES:
                row.update(aggregate_segment(segment_subwindows, window_type))

        rows.append(row)

    features_df = pd.DataFrame(rows)
    front_cols = ["sid", "glucose_time_sec", "glucose_mgdl"]
    count_cols = [f"{w}_n_subwindows_used" for w in WINDOW_TYPES]
    feature_cols = sorted(
        [c for c in features_df.columns if c not in front_cols + count_cols]
    )
    ordered_cols = front_cols + feature_cols + count_cols
    return features_df[ordered_cols].copy()


def _print_summary(
    metadata_df: pd.DataFrame,
    features_df: pd.DataFrame,
    per_subwindow_df: pd.DataFrame,
    failed_rows: list[dict],
    output_dir: Path,
    runtime_sec: float,
) -> None:
    n_input = len(metadata_df)
    n_success = len(per_subwindow_df)
    n_failed = len(failed_rows)
    success_pct = (n_success / n_input * 100.0) if n_input else 0.0
    failed_subjects = sorted({int(row["sid"]) for row in failed_rows})

    both_windows = int(
        (
            (features_df["current_n_subwindows_used"] > 0)
            & (features_df["lag_n_subwindows_used"] > 0)
        ).sum()
    )
    current_only = int(
        (
            (features_df["current_n_subwindows_used"] > 0)
            & (features_df["lag_n_subwindows_used"] == 0)
        ).sum()
    )
    no_usable = int(
        (
            (features_df["current_n_subwindows_used"] == 0)
            & (features_df["lag_n_subwindows_used"] == 0)
        ).sum()
    )

    print("=== pyPPG biomarker extraction ===")
    print(
        f"Input: {n_input} sub-windows from "
        f"{metadata_df[['sid', 'glucose_time_sec']].drop_duplicates().shape[0]} segments"
    )
    print(f"Successfully extracted: {n_success} ({success_pct:.1f}%)")
    print(f"Failed: {n_failed} ({len(failed_subjects)} subjects affected, full breakdown below)")
    if failed_rows:
        failed_df = pd.DataFrame(failed_rows)
        for sid, count in failed_df.groupby("sid").size().sort_index().items():
            print(f"  sid={int(sid)}: {int(count)} failed sub-windows")
    else:
        print("  none")
    print()
    print("Per-segment aggregation:")
    print(f"  Segments with both current and lag features: {both_windows}/{len(features_df)}")
    print(f"  Segments with current only: {current_only}")
    print(f"  Segments with no usable sub-windows (all NaN): {no_usable}")
    print()
    print("Output:")
    print(
        f"  {(output_dir / 'pyppg_features.csv').as_posix()}: "
        f"{features_df.shape[0]} rows, {features_df.shape[1]} columns"
    )
    print(
        f"  {(output_dir / 'pyppg_features_per_subwindow.csv').as_posix()}: "
        f"{n_input} rows"
    )
    print()
    print(f"Runtime: {runtime_sec:.2f}s")


def process_metadata(
    metadata_path: Path = Path("outputs/subwindows/metadata.csv"),
    output_dir: Path = Path("outputs/features"),
    n_workers: int = 4,
) -> dict:
    """
    Run end-to-end: load metadata, extract biomarkers per sub-window
    in parallel, aggregate per segment, save outputs. Return summary.
    """
    start_time = time.perf_counter()
    metadata_path = Path(metadata_path)
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    metadata_df = pd.read_csv(metadata_path)
    subwindow_root = metadata_path.parent
    records = metadata_df.to_dict("records")

    success_rows: list[dict] = []
    failed_rows: list[dict] = []
    completed = 0
    next_report = 500

    if n_workers <= 1:
        for row in records:
            result = _worker_extract(row, str(subwindow_root))
            if result["success"]:
                success_rows.append(result["row"])
            else:
                failed_rows.append(result["row"])
            completed += 1
            if completed >= next_report or completed == len(records):
                print(f"Processed {completed}/{len(records)} sub-windows...", flush=True)
                next_report += 500
    else:
        chunk_size = 25
        chunks = [records[i : i + chunk_size] for i in range(0, len(records), chunk_size)]
        with ProcessPoolExecutor(max_workers=n_workers) as executor:
            future_map = {
                executor.submit(_worker_extract_many, chunk, str(subwindow_root)): chunk
                for chunk in chunks
            }
            for future in as_completed(future_map):
                results = future.result()
                for result in results:
                    if result["success"]:
                        success_rows.append(result["row"])
                    else:
                        failed_rows.append(result["row"])
                completed += len(results)
                if completed >= next_report or completed == len(records):
                    print(f"Processed {completed}/{len(records)} sub-windows...", flush=True)
                    next_report += 500

    per_subwindow_df = pd.DataFrame(success_rows)
    if not per_subwindow_df.empty:
        per_subwindow_df = per_subwindow_df.sort_values(
            ["sid", "glucose_time_sec", "window_type", "subwin_idx"]
        ).reset_index(drop=True)
    else:
        per_subwindow_df = pd.DataFrame(columns=IDENTIFIER_COLUMNS)

    all_rows_df = metadata_df[IDENTIFIER_COLUMNS].copy()
    output_per_subwindow = all_rows_df.merge(
        per_subwindow_df,
        on=IDENTIFIER_COLUMNS,
        how="left",
        validate="one_to_one",
    )
    output_per_subwindow.to_csv(output_dir / "pyppg_features_per_subwindow.csv", index=False)

    features_df = _aggregate_all_segments(metadata_df, per_subwindow_df)
    features_df.to_csv(output_dir / "pyppg_features.csv", index=False)

    runtime_sec = time.perf_counter() - start_time
    _print_summary(
        metadata_df,
        features_df,
        output_per_subwindow,
        failed_rows,
        output_dir,
        runtime_sec,
    )

    return {
        "n_subwindows_input": int(len(metadata_df)),
        "n_subwindows_success": int(len(success_rows)),
        "n_subwindows_failed": int(len(failed_rows)),
        "n_failed_subjects": int(len({row["sid"] for row in failed_rows})),
        "n_segments_output": int(len(features_df)),
        "n_feature_columns": int(features_df.shape[1]),
        "runtime_sec": float(runtime_sec),
        "failed_by_sid": (
            pd.DataFrame(failed_rows).groupby("sid").size().astype(int).to_dict()
            if failed_rows
            else {}
        ),
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Extract pyPPG biomarker features from saved sub-windows.")
    parser.add_argument("--metadata-path", type=Path, default=Path("outputs/subwindows/metadata.csv"))
    parser.add_argument("--output-dir", type=Path, default=Path("outputs/features"))
    parser.add_argument("--n-workers", type=int, default=min(8, max(1, os.cpu_count() or 1)))
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    process_metadata(
        metadata_path=args.metadata_path,
        output_dir=args.output_dir,
        n_workers=args.n_workers,
    )
