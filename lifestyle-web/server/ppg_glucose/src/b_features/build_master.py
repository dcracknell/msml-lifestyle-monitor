"""
Step B4: Build Master Table v2
==============================
Merge the v2 feature sources into a single segment-level feature table.

This module does only key-based joins on (sid, glucose_time_sec). It does not
normalise, scale, impute, or fit any transformer.
"""

from __future__ import annotations

from pathlib import Path

import pandas as pd


KEY_COLUMNS = ["sid", "glucose_time_sec"]
METADATA_COLUMNS = ["sid", "glucose_time_sec", "glucose_mgdl"]

DEMOGRAPHIC_COLUMNS = [
    "demo_age",
    "demo_sex",
    "demo_bmi",
    "demo_preop_dm",
    "demo_preop_gluc",
    "demo_preop_hb",
    "demo_preop_cr",
]

SUMMARY_SUFFIXES = [
    "mean",
    "std",
    "min",
    "max",
    "median",
    "iqr",
    "rms",
    "peak_to_peak",
    "skew",
    "kurtosis",
    "d1_mean",
    "d1_std",
    "d1_max",
    "d1_min",
    "d2_mean",
    "d2_std",
    "d2_max",
    "d2_min",
]

QC_RENAMES = {
    "clean_subwindow_fraction": "qc_clean_subwindow_fraction",
    "whole_window_sqi": "qc_whole_window_sqi",
    "spike_fraction": "qc_spike_fraction",
    "quiet_fraction": "qc_quiet_fraction",
    "largest_clean_stretch_sec": "qc_largest_clean_stretch_sec",
}
QC_COLUMNS = list(QC_RENAMES.values()) + [
    "qc_n_clean_subwindows_current",
    "qc_n_clean_subwindows_lag",
]

EXPECTED_COUNTS = {
    "metadata": 3,
    "demographics": 7,
    "QC": 7,
    "window summary (w15m + lag15m)": 36,
    "EMD/IMF": 280,
    "pyPPG": 410,
    "PRV": 36,
}
EXPECTED_TOTAL_COLUMNS = sum(EXPECTED_COUNTS.values())


def _read_csv_without_index_columns(path: Path) -> pd.DataFrame:
    """Read a CSV and drop accidental index columns."""
    df = pd.read_csv(path)
    unnamed = [c for c in df.columns if str(c).startswith("Unnamed:")]
    if unnamed:
        df = df.drop(columns=unnamed)
    return df


def _assert_unique_keys(df: pd.DataFrame, name: str) -> None:
    if df.duplicated(KEY_COLUMNS).any():
        dupes = df.loc[df.duplicated(KEY_COLUMNS, keep=False), KEY_COLUMNS]
        raise ValueError(f"{name} has duplicate segment keys:\n{dupes}")


def _column_matches(prefix: str, suffixes: list[str], column: str) -> bool:
    if suffixes == ["*"]:
        return column.startswith(prefix)
    return any(column == f"{prefix}_{suffix}" for suffix in suffixes)


def load_v1_subset(
    v1_master_path: Path,
    column_filters: dict[str, list[str]],
) -> pd.DataFrame:
    """
    Load v1 master table, return only columns matching the prefix/suffix
    rules in column_filters. Always include sid + glucose_time_sec as keys.
    """
    v1 = _read_csv_without_index_columns(Path(v1_master_path))
    selected: list[str] = []

    for column in v1.columns:
        if column in KEY_COLUMNS or column == "glucose_mgdl":
            continue
        if any(_column_matches(prefix, suffixes, column) for prefix, suffixes in column_filters.items()):
            selected.append(column)

    return v1[KEY_COLUMNS + selected].copy()


def _match_count(base: pd.DataFrame, source: pd.DataFrame) -> int:
    merged = base[KEY_COLUMNS].merge(
        source[KEY_COLUMNS].drop_duplicates(),
        on=KEY_COLUMNS,
        how="left",
        indicator=True,
    )
    return int((merged["_merge"] == "both").sum())


def _left_merge(base: pd.DataFrame, source: pd.DataFrame, name: str) -> pd.DataFrame:
    _assert_unique_keys(source, name)
    return base.merge(source, on=KEY_COLUMNS, how="left", validate="one_to_one")


def _missing_cells(df: pd.DataFrame, columns: list[str]) -> int:
    existing = [c for c in columns if c in df.columns]
    if not existing:
        return 0
    return int(df[existing].isna().sum().sum())


def _grouped_columns(
    demographics: list[str],
    qc: list[str],
    summary: list[str],
    emd: list[str],
    pyppg: list[str],
    prv: list[str],
) -> list[str]:
    return METADATA_COLUMNS + demographics + qc + summary + emd + pyppg + prv


def _print_column_warning(actual_columns: list[str], expected_total: int) -> None:
    actual_total = len(actual_columns)
    if abs(actual_total - expected_total) <= 5:
        return

    print()
    print("WARNING: final column count differs from expected by more than 5")
    print(f"  Expected around: {expected_total}")
    print(f"  Actual:          {actual_total}")


def build_master_v2(
    pyppg_path: Path = Path("outputs/features/pyppg_features.csv"),
    prv_path: Path = Path("outputs/features/prv_features.csv"),
    v1_master_path: Path = Path("outputs/v1_archive/master_table.csv"),
    audit_path: Path = Path("outputs/dataset_quality_audit/audit_summary.csv"),
    filtered_path: Path = Path("outputs/master_table_filtered.csv"),
    output_path: Path = Path("outputs/master_table_v2.csv"),
) -> dict:
    """End-to-end merger. Returns summary dict with column counts per source."""
    pyppg = _read_csv_without_index_columns(Path(pyppg_path))
    prv = _read_csv_without_index_columns(Path(prv_path))
    v1 = _read_csv_without_index_columns(Path(v1_master_path))
    audit = _read_csv_without_index_columns(Path(audit_path))
    filtered = _read_csv_without_index_columns(Path(filtered_path))

    for name, df in [
        ("pyppg_features", pyppg),
        ("prv_features", prv),
        ("v1 master", v1),
        ("audit_summary", audit),
        ("master_table_filtered", filtered),
    ]:
        _assert_unique_keys(df, name)

    base = filtered[METADATA_COLUMNS].copy()

    emd_df = load_v1_subset(
        Path(v1_master_path),
        {"w15m_imf": ["*"], "lag15m_imf": ["*"]},
    )
    summary_df = load_v1_subset(
        Path(v1_master_path),
        {"w15m": SUMMARY_SUFFIXES, "lag15m": SUMMARY_SUFFIXES},
    )
    demo_df = v1[KEY_COLUMNS + DEMOGRAPHIC_COLUMNS].copy()

    qc_df = audit[KEY_COLUMNS + list(QC_RENAMES.keys())].rename(columns=QC_RENAMES)
    qc_df = qc_df.merge(
        pyppg[KEY_COLUMNS + ["current_n_subwindows_used", "lag_n_subwindows_used"]].rename(
            columns={
                "current_n_subwindows_used": "qc_n_clean_subwindows_current",
                "lag_n_subwindows_used": "qc_n_clean_subwindows_lag",
            }
        ),
        on=KEY_COLUMNS,
        how="left",
        validate="one_to_one",
    )

    pyppg_feature_cols = [c for c in pyppg.columns if c not in METADATA_COLUMNS]
    prv_feature_cols = [c for c in prv.columns if c not in METADATA_COLUMNS]
    pyppg_df = pyppg[KEY_COLUMNS + pyppg_feature_cols].copy()
    prv_df = prv[KEY_COLUMNS + prv_feature_cols].copy()

    match_counts = {
        "pyppg": _match_count(base, pyppg),
        "prv": _match_count(base, prv),
        "emd": _match_count(base, emd_df),
        "summary": _match_count(base, summary_df),
        "demographics": _match_count(base, demo_df),
        "qc": _match_count(base, qc_df),
        "filtered": _match_count(base, filtered),
    }

    merged = base.copy()
    for name, source in [
        ("demographics", demo_df),
        ("QC", qc_df),
        ("window summary", summary_df),
        ("EMD/IMF", emd_df),
        ("pyPPG", pyppg_df),
        ("PRV", prv_df),
    ]:
        merged = _left_merge(merged, source, name)

    demographics_cols = DEMOGRAPHIC_COLUMNS
    qc_cols = QC_COLUMNS
    summary_cols = [c for c in summary_df.columns if c not in KEY_COLUMNS]
    emd_cols = [c for c in emd_df.columns if c not in KEY_COLUMNS]
    pyppg_cols = pyppg_feature_cols
    prv_cols = prv_feature_cols
    final_columns = _grouped_columns(
        demographics_cols,
        qc_cols,
        summary_cols,
        emd_cols,
        pyppg_cols,
        prv_cols,
    )

    duplicate_columns = [c for c in final_columns if final_columns.count(c) > 1]
    if duplicate_columns:
        raise ValueError(f"Duplicate output columns requested: {sorted(set(duplicate_columns))}")

    output = merged[final_columns].copy()
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output.to_csv(output_path, index=False)

    counts = {
        "metadata": len(METADATA_COLUMNS),
        "demographics": len(demographics_cols),
        "QC": len(qc_cols),
        "window summary (w15m + lag15m)": len(summary_cols),
        "EMD/IMF": len(emd_cols),
        "pyPPG": len(pyppg_cols),
        "PRV": len(prv_cols),
    }
    missing = {
        "Demographics": _missing_cells(output, demographics_cols),
        "QC": _missing_cells(output, qc_cols),
        "Window summary": _missing_cells(output, summary_cols),
        "EMD": _missing_cells(output, emd_cols),
        "pyPPG": _missing_cells(output, pyppg_cols),
        "PRV": _missing_cells(output, prv_cols),
    }

    print("=== build master table v2 ===")
    print()
    print("Loading sources:")
    print(f"  pyppg_features.csv:        {pyppg.shape[0]} rows, {pyppg.shape[1]} cols")
    print(f"  prv_features.csv:          {prv.shape[0]} rows, {prv.shape[1]} cols")
    print(f"  v1_archive/master_table:   {v1.shape[0]} rows, {v1.shape[1]} cols")
    print(f"    -> EMD subset:            {len(emd_cols)} cols")
    print(f"    -> window summary subset: {len(summary_cols)} cols")
    print(f"    -> demographics subset:   {len(demographics_cols)} cols")
    print(f"  audit_summary.csv:         {audit.shape[0]} rows")
    print(f"    -> QC features:           {len(QC_RENAMES)} cols")
    print(f"  master_table_filtered.csv: {filtered.shape[0]} rows (authoritative segment list)")
    print()
    print("Merging by (sid, glucose_time_sec):")
    print(f"  pyppg <-> prv:        {match_counts['prv']}/{len(base)} matched")
    print(f"  <-> v1 EMD:           {match_counts['emd']}/{len(base)} matched")
    print(f"  <-> v1 summary:       {match_counts['summary']}/{len(base)} matched")
    print(f"  <-> v1 demographics:  {match_counts['demographics']}/{len(base)} matched")
    print(f"  <-> audit QC:         {match_counts['qc']}/{len(base)} matched")
    print(f"  <-> filtered list:    {match_counts['filtered']}/{len(base)} confirmed")
    print()
    print("Final master_table_v2.csv:")
    print(f"  Rows: {output.shape[0]}")
    print(f"  Columns: {output.shape[1]}")
    print()
    print("Column counts by source:")
    for key, value in counts.items():
        print(f"  {key}: {value}")
    print()
    print("Missing values per source:")
    for key, value in missing.items():
        print(f"  {key}: {value} cells")
    print()
    _print_column_warning(list(output.columns), EXPECTED_TOTAL_COLUMNS)
    print(f"Saved: {output_path.as_posix()}")

    return {
        "rows": int(output.shape[0]),
        "columns": int(output.shape[1]),
        "counts": counts,
        "missing": missing,
        "match_counts": match_counts,
        "output_path": str(output_path),
    }


def build_master_table(*args, **kwargs):
    """Compatibility symbol for older imports; use build_master_v2 for v2."""
    _ = args, kwargs
    raise RuntimeError("build_master_table is deprecated for v2; use build_master_v2().")


if __name__ == "__main__":
    build_master_v2()
