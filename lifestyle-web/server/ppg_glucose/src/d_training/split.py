"""
Step D1: Subject-Wise Splitting
================================
Defines cross-validation splits grouped by patient.
No patient appears in both train and test within the same fold.

Protocols:
  - GroupKFold(5): 5 folds, ~4 subjects per test fold
  - LOSO: leave-one-subject-out, 20 folds

Usage:
    python -m src.d_training.split
"""

import numpy as np
import pandas as pd
from sklearn.model_selection import GroupKFold, LeaveOneGroupOut


def get_cv_splits(df, protocol="group_kfold_5"):
    """
    Generate subject-wise CV splits.

    Args:
        df:       master table DataFrame (must have 'sid' column)
        protocol: "group_kfold_5" or "loso"

    Returns:
        list of (train_idx, test_idx) tuples (numpy arrays)
    """
    groups = df["sid"].values

    if protocol == "group_kfold_5":
        gkf = GroupKFold(n_splits=5)
        splits = list(gkf.split(df, groups=groups))
    elif protocol == "loso":
        logo = LeaveOneGroupOut()
        splits = list(logo.split(df, groups=groups))
    else:
        raise ValueError(f"Unknown protocol: {protocol}")

    return splits


def describe_splits(df, splits, protocol_name):
    """Print a summary of the CV splits."""
    print(f"\n  {protocol_name}: {len(splits)} folds")
    for i, (train_idx, test_idx) in enumerate(splits):
        train_subs = sorted(df.iloc[train_idx]["sid"].unique())
        test_subs = sorted(df.iloc[test_idx]["sid"].unique())
        print(f"    Fold {i}: train={len(train_idx)} rows ({len(train_subs)} subjects), "
              f"test={len(test_idx)} rows ({len(test_subs)} subjects) "
              f"— test subs: {test_subs}")


# ── Standalone test ──────────────────────────────────────────
if __name__ == "__main__":
    from src.a_preprocessing.load_vitaldb import load_config
    from src.c_selection.select_features import load_master_table

    cfg = load_config()
    df = load_master_table(cfg)

    print("[D1] Subject-wise splitting")

    splits_gkf = get_cv_splits(df, "group_kfold_5")
    describe_splits(df, splits_gkf, "GroupKFold(5)")

    splits_loso = get_cv_splits(df, "loso")
    describe_splits(df, splits_loso, "LOSO")
