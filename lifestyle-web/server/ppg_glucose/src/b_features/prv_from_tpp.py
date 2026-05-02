"""
PRV feature computation from pyPPG's Tpp (peak-to-peak interval) series.

Computes RMSSD, SDNN, pNN50, LF power, HF power, LF/HF ratio,
total power. Same definitions as the original prv_* features in
morphology_prv.py, but uses pyPPG's validated peak detection
output instead of scipy.find_peaks.
"""

from __future__ import annotations

import argparse
import math
import os
import time
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.interpolate import interp1d
from scipy.signal import welch


PRV_FEATURES = [
    "mean_ibi",
    "sdnn",
    "rmssd",
    "pnn50",
    "cv_ibi",
    "lf_power",
    "hf_power",
    "lf_hf_ratio",
    "total_power",
]
SPECTRAL_FEATURES = ["lf_power", "hf_power", "lf_hf_ratio", "total_power"]
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


def _nan_features() -> dict:
    """Return a PRV feature dict filled with NaN values."""
    return {feature: math.nan for feature in PRV_FEATURES}


def _finite_tpp(tpp: np.ndarray) -> np.ndarray:
    """Return finite Tpp values as a 1D float array."""
    values = np.asarray(tpp, dtype=float).ravel()
    return values[np.isfinite(values)]


def _spectral_prv_features(tpp: np.ndarray, interpolation_fs: float = 4.0) -> dict:
    """Compute Welch spectral PRV features on interpolated interval series."""
    result = {feature: math.nan for feature in SPECTRAL_FEATURES}
    if tpp.size < 20:
        return result

    beat_times = np.cumsum(tpp)
    if beat_times.size < 4 or np.unique(beat_times).size < 4:
        return result

    duration = float(beat_times[-1] - beat_times[0])
    if not np.isfinite(duration) or duration <= 0:
        return result

    regular_times = np.arange(beat_times[0], beat_times[-1], 1.0 / interpolation_fs)
    if regular_times.size < 8:
        return result

    try:
        interpolator = interp1d(
            beat_times,
            tpp,
            kind="cubic",
            bounds_error=False,
            fill_value="extrapolate",
        )
        regular_tpp = np.asarray(interpolator(regular_times), dtype=float)
    except Exception:
        return result

    if regular_tpp.size < 8 or not np.isfinite(regular_tpp).all():
        return result

    regular_tpp = regular_tpp - np.mean(regular_tpp)
    nperseg = min(256, regular_tpp.size)
    freqs, power = welch(regular_tpp, fs=interpolation_fs, nperseg=nperseg)

    def band_power(low: float, high: float) -> float:
        mask = (freqs >= low) & (freqs < high)
        if not mask.any():
            return math.nan
        return float(np.trapz(power[mask], freqs[mask]))

    lf_power = band_power(0.04, 0.15)
    hf_power = band_power(0.15, 0.40)
    total_power = band_power(0.0, 0.50)
    lf_hf_ratio = math.nan
    if np.isfinite(lf_power) and np.isfinite(hf_power) and hf_power != 0:
        lf_hf_ratio = float(lf_power / hf_power)

    result.update(
        {
            "lf_power": lf_power,
            "hf_power": hf_power,
            "lf_hf_ratio": lf_hf_ratio,
            "total_power": total_power,
        }
    )
    return result


def compute_prv_features(
    tpp: np.ndarray,
    fs: int = 500,
) -> dict:
    """
    Compute 9 PRV features from a single sub-window's Tpp series.
    Returns dict mapping feature name to value (or NaN).
    """
    _ = fs
    values = _finite_tpp(tpp)
    if values.size < 4:
        return _nan_features()

    mean_ibi = float(np.mean(values))
    sdnn = float(np.std(values, ddof=1)) if values.size > 1 else 0.0

    diffs = np.diff(values)
    if diffs.size:
        rmssd = float(np.sqrt(np.mean(diffs * diffs)))
        pnn50 = float(np.mean(np.abs(diffs) > 0.05) * 100.0)
    else:
        rmssd = 0.0
        pnn50 = 0.0

    cv_ibi = math.nan
    if np.isfinite(mean_ibi) and mean_ibi != 0:
        cv_ibi = float(sdnn / mean_ibi)

    features = {
        "mean_ibi": mean_ibi,
        "sdnn": sdnn,
        "rmssd": rmssd,
        "pnn50": pnn50,
        "cv_ibi": cv_ibi,
    }
    features.update(_spectral_prv_features(values))
    return features


def _prv_columns(df: pd.DataFrame) -> list[str]:
    return [c for c in df.columns if c not in IDENTIFIER_COLUMNS]


def _numeric_finite(values: pd.Series) -> pd.Series:
    numeric = pd.to_numeric(values, errors="coerce")
    numeric = numeric.replace([np.inf, -np.inf], np.nan).dropna()
    return numeric.astype(float)


def aggregate_segment(
    subwin_prv_rows: pd.DataFrame,
    window_type: str,
) -> dict:
    """
    Aggregate per-sub-window PRV features into per-segment median + IQR.
    Pure within-segment computation.
    """
    rows = subwin_prv_rows.loc[subwin_prv_rows["window_type"] == window_type].copy()
    result: dict[str, float] = {}

    for feature in PRV_FEATURES:
        out_prefix = f"{window_type}_prv_{feature}"
        if feature not in subwin_prv_rows.columns or rows.empty:
            result[f"{out_prefix}_median"] = math.nan
            result[f"{out_prefix}_iqr"] = math.nan
            continue

        values = _numeric_finite(rows[feature])
        if values.empty:
            result[f"{out_prefix}_median"] = math.nan
            result[f"{out_prefix}_iqr"] = math.nan
            continue

        q1 = float(values.quantile(0.25))
        q3 = float(values.quantile(0.75))
        result[f"{out_prefix}_median"] = float(values.median())
        result[f"{out_prefix}_iqr"] = float(q3 - q1)

    return result


def _load_tpp_features(row: dict, subwindow_root: str) -> dict:
    rel_path = str(row["npz_path"])
    npz_path = Path(subwindow_root) / rel_path
    npz = np.load(npz_path)
    tpp = np.asarray(npz["tpp"], dtype=float)
    fs = int(np.asarray(npz["fs"]).item()) if "fs" in npz.files else 500

    output = {
        "sid": int(row["sid"]),
        "glucose_time_sec": float(row["glucose_time_sec"]),
        "glucose_mgdl": float(row["glucose_mgdl"]),
        "window_type": str(row["window_type"]),
        "subwin_idx": int(row["subwin_idx"]),
        "subwin_start_sec": float(row["subwin_start_sec"]),
        "npz_path": rel_path,
    }
    output.update(compute_prv_features(tpp, fs=fs))
    return output


def _load_tpp_features_many(rows: list[dict], subwindow_root: str) -> list[dict]:
    return [_load_tpp_features(row, subwindow_root) for row in rows]


def _aggregate_all_segments(metadata_df: pd.DataFrame, per_subwindow_df: pd.DataFrame) -> pd.DataFrame:
    segment_rows = (
        metadata_df[SEGMENT_KEY_COLUMNS]
        .drop_duplicates()
        .sort_values(["sid", "glucose_time_sec"])
        .reset_index(drop=True)
    )
    rows: list[dict] = []

    for _, segment in segment_rows.iterrows():
        sid = int(segment["sid"])
        glucose_time_sec = float(segment["glucose_time_sec"])
        glucose_mgdl = float(segment["glucose_mgdl"])
        segment_subwindows = per_subwindow_df.loc[
            (per_subwindow_df["sid"] == sid)
            & (per_subwindow_df["glucose_time_sec"] == glucose_time_sec)
        ].copy()

        row = {
            "sid": sid,
            "glucose_time_sec": glucose_time_sec,
            "glucose_mgdl": glucose_mgdl,
        }
        for window_type in WINDOW_TYPES:
            row.update(aggregate_segment(segment_subwindows, window_type))
        rows.append(row)

    feature_df = pd.DataFrame(rows)
    feature_cols = [
        f"{window_type}_prv_{feature}_{stat}"
        for window_type in WINDOW_TYPES
        for feature in PRV_FEATURES
        for stat in ["median", "iqr"]
    ]
    return feature_df[SEGMENT_KEY_COLUMNS + feature_cols].copy()


def _print_summary(
    metadata_df: pd.DataFrame,
    per_subwindow_df: pd.DataFrame,
    feature_df: pd.DataFrame,
    output_dir: Path,
    runtime_sec: float,
) -> None:
    print("=== PRV feature extraction ===")
    print(
        f"Input: {len(metadata_df)} sub-windows from "
        f"{metadata_df[['sid', 'glucose_time_sec']].drop_duplicates().shape[0]} segments"
    )
    print()
    print("Per-feature NaN counts (sub-windows where computation returned NaN):")
    for feature in PRV_FEATURES:
        print(f"  {feature}: {int(per_subwindow_df[feature].isna().sum())}")

    both_windows = int(
        (
            feature_df["current_prv_mean_ibi_median"].notna()
            & feature_df["lag_prv_mean_ibi_median"].notna()
        ).sum()
    )
    no_prv = int(
        (
            feature_df["current_prv_mean_ibi_median"].isna()
            & feature_df["lag_prv_mean_ibi_median"].isna()
        ).sum()
    )

    print()
    print("Per-segment aggregation:")
    print(f"  Segments with both current and lag PRV: {both_windows}/{len(feature_df)}")
    print(f"  Segments with no PRV at all: {no_prv}")
    if no_prv > 0:
        all_nan = feature_df.loc[
            feature_df["current_prv_mean_ibi_median"].isna()
            & feature_df["lag_prv_mean_ibi_median"].isna(),
            ["sid", "glucose_time_sec"],
        ]
        for _, row in all_nan.iterrows():
            print(f"    sid={int(row['sid'])}, glucose_time_sec={float(row['glucose_time_sec']):.1f}")

    print()
    print("Output:")
    print(
        f"  {(output_dir / 'prv_features.csv').as_posix()}: "
        f"{feature_df.shape[0]} rows, {feature_df.shape[1]} columns"
    )
    print(
        f"  {(output_dir / 'prv_features_per_subwindow.csv').as_posix()}: "
        f"{per_subwindow_df.shape[0]} rows"
    )
    print()
    print(f"Runtime: {runtime_sec:.2f}s")


def process_metadata(
    metadata_path: Path = Path("outputs/subwindows/metadata.csv"),
    output_dir: Path = Path("outputs/features"),
    n_workers: int = 4,
) -> dict:
    """End-to-end runner."""
    start_time = time.perf_counter()
    metadata_path = Path(metadata_path)
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    metadata_df = pd.read_csv(metadata_path)
    records = metadata_df.to_dict("records")
    subwindow_root = str(metadata_path.parent)
    rows: list[dict] = []
    completed = 0
    next_report = 1000

    if n_workers <= 1:
        for row in records:
            rows.append(_load_tpp_features(row, subwindow_root))
            completed += 1
            if completed >= next_report or completed == len(records):
                print(f"Processed {completed}/{len(records)} sub-windows...", flush=True)
                next_report += 1000
    else:
        chunk_size = 250
        chunks = [records[i : i + chunk_size] for i in range(0, len(records), chunk_size)]
        with ProcessPoolExecutor(max_workers=n_workers) as executor:
            future_map = {
                executor.submit(_load_tpp_features_many, chunk, subwindow_root): chunk
                for chunk in chunks
            }
            for future in as_completed(future_map):
                result_rows = future.result()
                rows.extend(result_rows)
                completed += len(result_rows)
                if completed >= next_report or completed == len(records):
                    print(f"Processed {completed}/{len(records)} sub-windows...", flush=True)
                    next_report += 1000

    per_subwindow_df = pd.DataFrame(rows)
    per_subwindow_df = per_subwindow_df.sort_values(
        ["sid", "glucose_time_sec", "window_type", "subwin_idx"]
    ).reset_index(drop=True)
    per_subwindow_df.to_csv(output_dir / "prv_features_per_subwindow.csv", index=False)

    feature_df = _aggregate_all_segments(metadata_df, per_subwindow_df)
    feature_df.to_csv(output_dir / "prv_features.csv", index=False)

    runtime_sec = time.perf_counter() - start_time
    _print_summary(metadata_df, per_subwindow_df, feature_df, output_dir, runtime_sec)

    return {
        "n_subwindows_input": int(len(metadata_df)),
        "n_segments_output": int(len(feature_df)),
        "n_columns_output": int(feature_df.shape[1]),
        "runtime_sec": float(runtime_sec),
        "nan_counts": {
            feature: int(per_subwindow_df[feature].isna().sum())
            for feature in PRV_FEATURES
        },
        "n_segments_with_both_current_and_lag": int(
            (
                feature_df["current_prv_mean_ibi_median"].notna()
                & feature_df["lag_prv_mean_ibi_median"].notna()
            ).sum()
        ),
        "n_segments_all_nan": int(
            (
                feature_df["current_prv_mean_ibi_median"].isna()
                & feature_df["lag_prv_mean_ibi_median"].isna()
            ).sum()
        ),
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Compute PRV features from saved pyPPG Tpp series.")
    parser.add_argument("--metadata-path", type=Path, default=Path("outputs/subwindows/metadata.csv"))
    parser.add_argument("--output-dir", type=Path, default=Path("outputs/features"))
    parser.add_argument("--n-workers", type=int, default=min(4, max(1, os.cpu_count() or 1)))
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    process_metadata(
        metadata_path=args.metadata_path,
        output_dir=args.output_dir,
        n_workers=args.n_workers,
    )
