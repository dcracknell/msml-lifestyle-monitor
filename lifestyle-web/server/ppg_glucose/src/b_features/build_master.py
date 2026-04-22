"""
Step B4: Build Master Table
============================
Merges all three feature families (summary stats, morphology+PRV,
EMD/IMF) into a single master table with one row per glucose
measurement.

Output: outputs/master_table.parquet

Usage:
    python -m src.b_features.build_master
"""

import numpy as np
import pandas as pd
import time
from pathlib import Path

from src.b_features.summary_stats import extract_summary_features
from src.b_features.morphology_prv import extract_morphology_prv_features
from src.b_features.emd_imf import extract_emd_features


def build_master_table(segments, cfg):
    """
    Build the complete feature table from preprocessed segments.

    For each segment:
      - Extract summary stats (22 features × 2 windows)
      - Extract morphology+PRV (17 features × 2 windows)
      - Extract EMD/IMF (140 features × 2 windows)
      - Add demographics

    Total potential features: (22 + 17 + 140) × 2 = 358 per segment
    Plus demographics columns.

    Args:
        segments: list of segment dicts from preprocess_all()
        cfg:      config dict

    Returns:
        pd.DataFrame: master table
    """
    fs = cfg["ppg_sampling_rate"]
    max_imfs = cfg.get("max_imfs", 7)
    output_dir = Path(cfg["output_dir"])
    output_dir.mkdir(parents=True, exist_ok=True)

    print(f"\n[B] Building master table...")
    print(f"  Segments: {len(segments)}")
    print(f"  Feature families: summary(22) + morphology_prv(17) + emd_imf(140) = 179 per window")
    print(f"  Windows: current(w15m) + lag(lag15m)")
    print(f"  EMD downsampled to 64 Hz for speed")

    rows = []
    t_start = time.time()

    for idx, seg in enumerate(segments):
        row = {
            "sid": seg["sid"],
            "glucose_time_sec": seg["glucose_time"],
            "glucose_mgdl": seg["glucose_mgdl"],
        }

        # ── Current window (w15m) features ──────────────────
        row.update(extract_summary_features(seg["w15m_ppg"], fs, "w15m"))
        row.update(extract_morphology_prv_features(seg["w15m_ppg"], fs, "w15m"))
        row.update(extract_emd_features(seg["w15m_ppg"], fs, "w15m", max_imfs))

        # ── Lagged window (lag15m) features ─────────────────
        if seg["lag15m_ppg"] is not None:
            row.update(extract_summary_features(seg["lag15m_ppg"], fs, "lag15m"))
            row.update(extract_morphology_prv_features(seg["lag15m_ppg"], fs, "lag15m"))
            row.update(extract_emd_features(seg["lag15m_ppg"], fs, "lag15m", max_imfs))
        # If no lag window, those columns will be NaN (pandas handles this)

        # ── Demographics ────────────────────────────────────
        demo = seg.get("demographics", {})
        for key in ["age", "sex", "bmi", "preop_dm", "preop_gluc", "preop_hb", "preop_cr"]:
            row[f"demo_{key}"] = demo.get(key, np.nan)

        rows.append(row)

        # Progress
        if (idx + 1) % 10 == 0 or (idx + 1) == len(segments):
            elapsed = time.time() - t_start
            rate = (idx + 1) / elapsed
            eta = (len(segments) - idx - 1) / rate if rate > 0 else 0
            print(f"  [{idx + 1}/{len(segments)}] "
                  f"{elapsed:.0f}s elapsed, ~{eta:.0f}s remaining")

    # Build DataFrame
    df = pd.DataFrame(rows)

    # Encode categorical demographics
    if "demo_sex" in df.columns:
        df["demo_sex"] = df["demo_sex"].map({"M": 1, "F": 0}).fillna(-1).astype(int)

    # Save
    output_path = output_dir / "master_table.parquet"
    df.to_parquet(output_path, index=False)

    # Summary
    n_features = len([c for c in df.columns
                      if c not in ["sid", "glucose_time_sec", "glucose_mgdl"]])
    n_missing = df.isnull().sum().sum()
    total_cells = df.shape[0] * df.shape[1]

    print(f"\n  Master table saved: {output_path}")
    print(f"  Shape: {df.shape[0]} rows × {df.shape[1]} columns")
    print(f"  Feature columns: {n_features}")
    print(f"  Missing values: {n_missing} / {total_cells} ({n_missing/total_cells*100:.1f}%)")
    print(f"  Glucose range: {df['glucose_mgdl'].min():.0f} – {df['glucose_mgdl'].max():.0f} mg/dL")

    return df


# ── Standalone run ───────────────────────────────────────────
if __name__ == "__main__":
    from src.a_preprocessing.load_vitaldb import load_config, load_all_subjects
    from src.a_preprocessing.preprocess import preprocess_all

    cfg = load_config()
    subjects = load_all_subjects(cfg)
    segments = preprocess_all(subjects, cfg)
    df = build_master_table(segments, cfg)

    print("\n" + "=" * 60)
    print("MASTER TABLE SUMMARY")
    print("=" * 60)
    print(f"Rows:    {len(df)}")
    print(f"Columns: {len(df.columns)}")
    print(f"\nColumn groups:")

    prefixes = {}
    for col in df.columns:
        if col in ["sid", "glucose_time_sec", "glucose_mgdl"]:
            prefixes["metadata"] = prefixes.get("metadata", 0) + 1
        elif col.startswith("demo_"):
            prefixes["demographics"] = prefixes.get("demographics", 0) + 1
        elif col.startswith("w15m_imf"):
            prefixes["w15m_emd"] = prefixes.get("w15m_emd", 0) + 1
        elif col.startswith("lag15m_imf"):
            prefixes["lag15m_emd"] = prefixes.get("lag15m_emd", 0) + 1
        elif col.startswith("w15m_prv") or col.startswith("w15m_pulse") or col.startswith("w15m_sys") or col.startswith("w15m_dia") or col.startswith("w15m_rise") or col.startswith("w15m_fall"):
            prefixes["w15m_morph_prv"] = prefixes.get("w15m_morph_prv", 0) + 1
        elif col.startswith("lag15m_prv") or col.startswith("lag15m_pulse") or col.startswith("lag15m_sys") or col.startswith("lag15m_dia") or col.startswith("lag15m_rise") or col.startswith("lag15m_fall"):
            prefixes["lag15m_morph_prv"] = prefixes.get("lag15m_morph_prv", 0) + 1
        elif col.startswith("w15m_"):
            prefixes["w15m_summary"] = prefixes.get("w15m_summary", 0) + 1
        elif col.startswith("lag15m_"):
            prefixes["lag15m_summary"] = prefixes.get("lag15m_summary", 0) + 1
        else:
            prefixes["other"] = prefixes.get("other", 0) + 1

    for group, count in sorted(prefixes.items()):
        print(f"  {group}: {count}")
