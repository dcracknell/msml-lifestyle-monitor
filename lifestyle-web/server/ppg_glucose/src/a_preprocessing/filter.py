"""
Apply audit-based filtering to produce the v2 master table.

Reads outputs/dataset_quality_audit/audit_summary.csv.
Drops subjects with <10% usable segments (1492, 3255, 4245, 6337, 3962).
Drops segments with clean_subwindow_fraction < 0.7.
Writes outputs/master_table_filtered.csv.

Expected output: ~80 segments from 15 subjects.
"""

from argparse import ArgumentParser
from pathlib import Path

import pandas as pd


DEFAULT_DROP_SUBJECTS = [1492, 3255, 4245, 6337, 3962]
KEY_COLUMNS = ["sid", "glucose_time_sec"]


def _validate_inputs(audit_df, master_df):
    """Validate required columns and segment keys before filtering."""
    required_audit_cols = KEY_COLUMNS + ["clean_subwindow_fraction"]
    required_master_cols = KEY_COLUMNS + ["glucose_mgdl"]

    missing_audit = [c for c in required_audit_cols if c not in audit_df.columns]
    missing_master = [c for c in required_master_cols if c not in master_df.columns]

    if missing_audit:
        raise ValueError(f"Audit table missing columns: {missing_audit}")
    if missing_master:
        raise ValueError(f"Master table missing columns: {missing_master}")

    if audit_df.duplicated(KEY_COLUMNS).any():
        dupes = audit_df.loc[audit_df.duplicated(KEY_COLUMNS, keep=False), KEY_COLUMNS]
        raise ValueError(f"Audit table has duplicate segment keys:\n{dupes}")
    if master_df.duplicated(KEY_COLUMNS).any():
        dupes = master_df.loc[master_df.duplicated(KEY_COLUMNS, keep=False), KEY_COLUMNS]
        raise ValueError(f"Master table has duplicate segment keys:\n{dupes}")


def _count_segments_and_subjects(df):
    """Return segment and subject counts for summary printing."""
    return len(df), df["sid"].nunique()


def _format_pct(n, total):
    """Format a count as a percentage of total rows."""
    if total == 0:
        return "0.0%"
    return f"{(n / total) * 100:.1f}%"


def _class_balance(glucose):
    """Return clinical-threshold class counts."""
    return [
        ("<70 (hypo)", glucose < 70),
        ("70-99 (normal)", (glucose >= 70) & (glucose <= 99)),
        ("100-139 (target)", (glucose >= 100) & (glucose <= 139)),
        ("140-179 (elevated)", (glucose >= 140) & (glucose <= 179)),
        (">=180 (hyper)", glucose >= 180),
    ]


def _group_fold_summary(df, n_splits=5):
    """
    Estimate subject-wise fold balance using greedy subject assignment.

    This avoids importing scikit-learn in preprocessing while still giving
    a practical feasibility check for GroupKFold-style evaluation.
    """
    if df["sid"].nunique() < n_splits:
        return False, 0, 0

    subject_counts = (
        df.groupby("sid")
        .agg(n_segments=("sid", "size"), has_hyper=("glucose_mgdl", lambda x: (x >= 180).any()))
        .sort_values(["n_segments", "sid"], ascending=[False, True])
    )

    folds = [{"n_segments": 0, "has_hyper": False} for _ in range(n_splits)]
    for _, row in subject_counts.iterrows():
        fold = min(folds, key=lambda f: f["n_segments"])
        fold["n_segments"] += int(row["n_segments"])
        fold["has_hyper"] = fold["has_hyper"] or bool(row["has_hyper"])

    min_segments = min(fold["n_segments"] for fold in folds)
    folds_with_hyper = sum(1 for fold in folds if fold["has_hyper"])
    return True, min_segments, folds_with_hyper


def _print_summary(
    master_df,
    after_subject_df,
    after_quality_df,
    filtered_df,
    n_bad_subjects,
    min_clean_subwindow_fraction,
    min_segments_per_subject,
    output_path,
):
    """Print the v2 dataset filter report."""
    n_input, s_input = _count_segments_and_subjects(master_df)
    n_subject, s_subject = _count_segments_and_subjects(after_subject_df)
    n_quality, s_quality = _count_segments_and_subjects(after_quality_df)
    n_output, s_output = _count_segments_and_subjects(filtered_df)

    glucose = filtered_df["glucose_mgdl"]
    feasible, min_fold_segments, folds_with_hyper = _group_fold_summary(filtered_df)
    feasibility = "feasible" if feasible else "not feasible — needs >= 5 subjects"

    print("=== v2 dataset filter ===")
    print(f"Input:  {n_input} segments, {s_input} subjects")
    print(f"After dropping {n_bad_subjects} bad subjects: {n_subject} segments, {s_subject} subjects")
    print(
        f"After clean_subwindow_fraction >= {min_clean_subwindow_fraction:g}: "
        f"{n_quality} segments, {s_quality} subjects"
    )
    print(
        f"After min {min_segments_per_subject} segments/subject: "
        f"{n_output} segments, {s_output} subjects"
    )
    print()
    print("Final v2 dataset:")
    print(f"  Subjects: {s_output}")
    print(f"  Segments: {n_output}")
    print(f"  Glucose range: {glucose.min():.0f}-{glucose.max():.0f} mg/dL")
    print(f"  Glucose mean ± std: {glucose.mean():.1f} ± {glucose.std():.1f}")
    print()
    print("Class balance at clinical thresholds:")
    for label, mask in _class_balance(glucose):
        n_class = int(mask.sum())
        if label == "<70 (hypo)":
            print(f"  {label}:       {n_class} ({_format_pct(n_class, n_output)})")
        elif label == "70-99 (normal)":
            print(f"  {label}:   {n_class} ({_format_pct(n_class, n_output)})")
        elif label == "100-139 (target)":
            print(f"  {label}: {n_class} ({_format_pct(n_class, n_output)})")
        elif label == "140-179 (elevated)":
            print(f"  {label}: {n_class} ({_format_pct(n_class, n_output)})")
        else:
            print(f"  {label}:    {n_class} ({_format_pct(n_class, n_output)})")
    print()
    print("Per-subject segment count:")
    for sid, n_segments in filtered_df.groupby("sid").size().sort_index().items():
        print(f"  sid={sid}: {n_segments} segments")
    print()
    print("Subject-wise CV feasibility check:")
    print(f"  GroupKFold(5): {feasibility}")
    print(f"  Min segments per fold: {min_fold_segments}")
    print(f"  Folds with at least 1 hyperglycaemic sample: {folds_with_hyper}/5")
    print()
    print(f"Saved: {output_path}")


def filter_master_table(
    audit_path: Path = Path("outputs/dataset_quality_audit/audit_summary.csv"),
    master_path: Path = Path("outputs/v1_archive/master_table.csv"),
    output_path: Path = Path("outputs/master_table_filtered.csv"),
    min_clean_subwindow_fraction: float = 0.7,
    min_segments_per_subject: int = 2,
    drop_subjects: list[int] = None,
) -> dict:
    """
    Apply audit-based filtering to produce v2 master table.

    Returns a dict with: n_segments_input, n_segments_output,
    n_subjects_input, n_subjects_output, n_dropped_by_subject,
    n_dropped_by_quality, n_dropped_by_min_segments.
    """
    if drop_subjects is None:
        drop_subjects = DEFAULT_DROP_SUBJECTS

    audit_path = Path(audit_path)
    master_path = Path(master_path)
    output_path = Path(output_path)

    audit_df = pd.read_csv(audit_path)
    master_df = pd.read_csv(master_path)
    _validate_inputs(audit_df, master_df)

    audit_filter_cols = KEY_COLUMNS + ["clean_subwindow_fraction"]
    merged = master_df.merge(
        audit_df[audit_filter_cols],
        on=KEY_COLUMNS,
        how="left",
        validate="one_to_one",
    )

    if merged["clean_subwindow_fraction"].isna().any():
        missing = merged.loc[merged["clean_subwindow_fraction"].isna(), KEY_COLUMNS]
        raise ValueError(f"Master segments missing from audit table:\n{missing}")

    n_segments_input = len(master_df)
    n_subjects_input = master_df["sid"].nunique()

    drop_subjects = set(drop_subjects)
    bad_subjects_present = set(merged["sid"].unique()).intersection(drop_subjects)
    after_subject = merged[~merged["sid"].isin(drop_subjects)].copy()
    n_dropped_by_subject = n_segments_input - len(after_subject)

    after_quality = after_subject[
        after_subject["clean_subwindow_fraction"] >= min_clean_subwindow_fraction
    ].copy()
    n_dropped_by_quality = len(after_subject) - len(after_quality)

    segment_counts = after_quality.groupby("sid").size()
    keep_subjects = segment_counts[segment_counts >= min_segments_per_subject].index
    filtered = after_quality[after_quality["sid"].isin(keep_subjects)].copy()
    n_dropped_by_min_segments = len(after_quality) - len(filtered)

    output_df = filtered[master_df.columns].copy()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_df.to_csv(output_path, index=False)

    summary = {
        "n_segments_input": n_segments_input,
        "n_segments_output": len(output_df),
        "n_subjects_input": n_subjects_input,
        "n_subjects_output": output_df["sid"].nunique(),
        "n_dropped_by_subject": n_dropped_by_subject,
        "n_dropped_by_quality": n_dropped_by_quality,
        "n_dropped_by_min_segments": n_dropped_by_min_segments,
    }

    _print_summary(
        master_df,
        after_subject,
        after_quality,
        output_df,
        len(bad_subjects_present),
        min_clean_subwindow_fraction,
        min_segments_per_subject,
        output_path,
    )

    return summary


def parse_args():
    """Parse command-line arguments."""
    parser = ArgumentParser(description="Apply audit-based filtering to the v2 master table.")
    parser.add_argument(
        "--audit-path",
        type=Path,
        default=Path("outputs/dataset_quality_audit/audit_summary.csv"),
        help="Path to audit_summary.csv.",
    )
    parser.add_argument(
        "--master-path",
        type=Path,
        default=Path("outputs/v1_archive/master_table.csv"),
        help="Path to the input master table.",
    )
    parser.add_argument(
        "--output-path",
        type=Path,
        default=Path("outputs/master_table_filtered.csv"),
        help="Path for the filtered output CSV.",
    )
    parser.add_argument(
        "--min-clean-subwindow-fraction",
        type=float,
        default=0.7,
        help="Minimum clean sub-window fraction required per segment.",
    )
    parser.add_argument(
        "--min-segments-per-subject",
        type=int,
        default=2,
        help="Minimum number of surviving segments required per subject.",
    )
    parser.add_argument(
        "--drop-subjects",
        type=int,
        nargs="*",
        default=None,
        help="Subject IDs to drop before quality filtering.",
    )
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    filter_master_table(
        audit_path=args.audit_path,
        master_path=args.master_path,
        output_path=args.output_path,
        min_clean_subwindow_fraction=args.min_clean_subwindow_fraction,
        min_segments_per_subject=args.min_segments_per_subject,
        drop_subjects=args.drop_subjects,
    )
