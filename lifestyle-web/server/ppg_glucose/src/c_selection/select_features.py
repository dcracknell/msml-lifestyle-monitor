"""
Step C1: Feature Selection
===========================
Ranks all features by importance using CatBoost, then selects
the top N for model training.

Why CatBoost for ranking?
- Handles NaN natively (no imputation needed for ranking)
- Captures nonlinear feature-target relationships
- Consistent with Satter et al. (2024) methodology

This step does NOT use subject-wise CV — it fits on the full
dataset purely to rank features. The actual train/test split
happens in Step D.

Output:
  outputs/feature_ranking.csv     — all features ranked
  outputs/selected_features.txt   — top N feature names

Usage:
    python -m src.c_selection.select_features
"""

import numpy as np
import pandas as pd
from pathlib import Path
from catboost import CatBoostRegressor


def load_master_table(cfg):
    """Load the master table parquet."""
    path = Path(cfg["output_dir"]) / "master_table.parquet"
    if path.exists():
        return pd.read_parquet(path)
    # Fallback to CSV if parquet not available
    csv_path = Path(cfg["output_dir"]) / "master_table.csv"
    if csv_path.exists():
        return pd.read_csv(csv_path)
    raise FileNotFoundError(f"No master table found in {cfg['output_dir']}")


def get_feature_columns(df):
    """Return list of feature column names (exclude metadata and target)."""
    exclude = {"sid", "glucose_time_sec", "glucose_mgdl", "glucose_zone"}
    return [c for c in df.columns if c not in exclude]


def rank_features_catboost(df, feature_cols, target_col="glucose_mgdl"):
    """
    Fit CatBoost on full dataset and extract feature importances.

    Args:
        df:           master table DataFrame
        feature_cols: list of feature column names
        target_col:   target variable name

    Returns:
        pd.DataFrame with columns [feature, importance, rank]
        sorted by importance descending
    """
    X = df[feature_cols].copy()
    y = df[target_col].values

    # CatBoost handles NaN natively — no imputation needed
    model = CatBoostRegressor(
        iterations=500,
        depth=6,
        learning_rate=0.05,
        loss_function="RMSE",
        random_seed=42,
        verbose=0,  # silent
    )

    model.fit(X, y)

    # Extract feature importances
    importances = model.get_feature_importance()

    ranking = pd.DataFrame({
        "feature": feature_cols,
        "importance": importances,
    }).sort_values("importance", ascending=False).reset_index(drop=True)

    ranking["rank"] = range(1, len(ranking) + 1)

    return ranking


def select_top_features(ranking, n_top=50):
    """Select top N features from the ranking."""
    selected = ranking.head(n_top)["feature"].tolist()
    return selected


def analyse_selection(ranking, selected, df):
    """Print analysis of the selected features."""
    print(f"\n  Selected {len(selected)} features from {len(ranking)} total")

    # Break down by feature family
    families = {
        "w15m_summary": [],
        "w15m_morph_prv": [],
        "w15m_emd": [],
        "lag15m_summary": [],
        "lag15m_morph_prv": [],
        "lag15m_emd": [],
        "demographics": [],
    }

    morph_prv_keywords = [
        "pulse_width", "systolic_time", "diastolic_time", "sys_dia_ratio",
        "rise_slope", "fall_slope", "prv_"
    ]

    for feat in selected:
        if feat.startswith("demo_"):
            families["demographics"].append(feat)
        elif feat.startswith("w15m_imf"):
            families["w15m_emd"].append(feat)
        elif feat.startswith("lag15m_imf"):
            families["lag15m_emd"].append(feat)
        elif feat.startswith("w15m_") and any(k in feat for k in morph_prv_keywords):
            families["w15m_morph_prv"].append(feat)
        elif feat.startswith("lag15m_") and any(k in feat for k in morph_prv_keywords):
            families["lag15m_morph_prv"].append(feat)
        elif feat.startswith("w15m_"):
            families["w15m_summary"].append(feat)
        elif feat.startswith("lag15m_"):
            families["lag15m_summary"].append(feat)

    print(f"\n  Feature family breakdown:")
    for family, feats in families.items():
        if feats:
            print(f"    {family}: {len(feats)}")
            for f in feats[:3]:
                imp = ranking[ranking["feature"] == f]["importance"].values[0]
                print(f"      {f} (importance={imp:.2f})")
            if len(feats) > 3:
                print(f"      ... and {len(feats) - 3} more")

    # Current vs lag window balance
    n_current = sum(1 for f in selected if f.startswith("w15m_"))
    n_lag = sum(1 for f in selected if f.startswith("lag15m_"))
    n_demo = sum(1 for f in selected if f.startswith("demo_"))
    print(f"\n  Window balance: {n_current} current, {n_lag} lag, {n_demo} demographic")


def run_feature_selection(cfg):
    """Main feature selection pipeline."""
    print("\n[C1] Feature selection...")

    n_top = cfg.get("n_top_features", 50)
    output_dir = Path(cfg["output_dir"])
    output_dir.mkdir(parents=True, exist_ok=True)

    # Load data
    df = load_master_table(cfg)
    feature_cols = get_feature_columns(df)
    print(f"  Master table: {df.shape[0]} rows × {len(feature_cols)} features")

    # Rank features
    print(f"  Fitting CatBoost for feature ranking (this takes ~30s)...")
    ranking = rank_features_catboost(df, feature_cols)

    # Select top N
    selected = select_top_features(ranking, n_top)

    # Save outputs
    ranking.to_csv(output_dir / "feature_ranking.csv", index=False)
    with open(output_dir / "selected_features.txt", "w") as f:
        for feat in selected:
            f.write(feat + "\n")

    print(f"\n  Saved: feature_ranking.csv ({len(ranking)} features ranked)")
    print(f"  Saved: selected_features.txt ({len(selected)} selected)")

    # Print top 20
    print(f"\n  Top 20 features:")
    for _, row in ranking.head(20).iterrows():
        print(f"    {row['rank']:2d}. {row['feature']:45s} importance={row['importance']:.2f}")

    # Analysis
    analyse_selection(ranking, selected, df)

    return ranking, selected


# ── Standalone run ───────────────────────────────────────────
if __name__ == "__main__":
    from src.a_preprocessing.load_vitaldb import load_config
    cfg = load_config()
    ranking, selected = run_feature_selection(cfg)
