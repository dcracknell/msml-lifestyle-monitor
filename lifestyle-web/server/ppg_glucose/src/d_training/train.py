"""
Step D2: Model Training
========================
Trains 7 models for regression (glucose in mg/dL) and
7 models for binary classification (target vs hyperglycaemia
at the 180 mg/dL clinical threshold).

All preprocessing (scaling, imputation) happens INSIDE each
CV fold to prevent data leakage.

Models:
  Regression:    Ridge, SVR, HistGBR, RF, XGBoost, CatBoost, LightGBM
  Classification: Ridge, SVC, HistGBC, RF, XGBoost, CatBoost, LightGBM

Usage:
    python -m src.d_training.train
"""

import numpy as np
import pandas as pd
import time
from pathlib import Path
from sklearn.linear_model import Ridge, RidgeClassifier, LogisticRegression
from sklearn.metrics import f1_score as _f1_score
from sklearn.svm import SVR, SVC
from sklearn.ensemble import (
    HistGradientBoostingRegressor,
    HistGradientBoostingClassifier,
    RandomForestRegressor,
    RandomForestClassifier,
)
from xgboost import XGBRegressor, XGBClassifier
from catboost import CatBoostRegressor, CatBoostClassifier
from lightgbm import LGBMRegressor, LGBMClassifier
from sklearn.preprocessing import StandardScaler
from sklearn.impute import SimpleImputer
from sklearn.pipeline import Pipeline

from src.d_training.split import get_cv_splits


# ── Clinical threshold ───────────────────────────────────────
# AACE/ADA, Endocrine Society, SAMBA all recommend treatment
# at >180 mg/dL intraoperatively.
HYPER_THRESHOLD = 180  # mg/dL

# ── 5-zone multiclass glucose classification ─────────────────
# Original 7 zones had sev_hypo (n=2, 2 subs) and hypo (n=4, 2 subs) both below
# the ≥5-samples threshold; sev_hyper (n=3, 2 subs) also fails.
# Merges applied: sev_hypo + hypo → "hypo" [0, 70);
#                 sev_hyper + hyper → "hyper" [180, ∞).
# Resulting counts: hypo=6, normal=24, target=70, elevated=59, hyper=31.
GLUCOSE_BINS   = [0, 70, 100, 140, 180, np.inf]
GLUCOSE_LABELS = ["hypo", "normal", "target", "elevated", "hyper"]
NUM_CLASSES    = len(GLUCOSE_LABELS)


def get_regression_models():
    """Return dict of model_name → sklearn Pipeline for regression."""
    return {
        "Ridge": Pipeline([
            ("imputer", SimpleImputer(strategy="median")),
            ("scaler", StandardScaler()),
            ("model", Ridge(alpha=1.0)),
        ]),
        "SVR": Pipeline([
            ("imputer", SimpleImputer(strategy="median")),
            ("scaler", StandardScaler()),
            ("model", SVR(kernel="rbf", C=10, epsilon=0.1)),
        ]),
        "HistGBR": Pipeline([
            # HistGBR handles NaN natively — no imputer/scaler needed
            ("model", HistGradientBoostingRegressor(
                max_iter=300, max_depth=5, learning_rate=0.05,
                random_state=42)),
        ]),
        "RandomForest": Pipeline([
            ("imputer", SimpleImputer(strategy="median")),
            ("model", RandomForestRegressor(
                n_estimators=300, max_depth=8, random_state=42)),
        ]),
        "XGBoost": Pipeline([
            ("imputer", SimpleImputer(strategy="median")),
            ("model", XGBRegressor(
                n_estimators=300, max_depth=5, learning_rate=0.05,
                random_state=42, verbosity=0)),
        ]),
        "CatBoost": Pipeline([
            # CatBoost handles NaN natively
            ("model", CatBoostRegressor(
                iterations=300, depth=5, learning_rate=0.05,
                random_seed=42, verbose=0)),
        ]),
        "LightGBM": Pipeline([
            ("imputer", SimpleImputer(strategy="median")),
            ("model", LGBMRegressor(
                n_estimators=300, max_depth=5, learning_rate=0.05,
                random_state=42, verbose=-1)),
        ]),
    }


def get_classification_models():
    """Return dict of model_name → sklearn Pipeline for classification."""
    return {
        "Ridge": Pipeline([
            ("imputer", SimpleImputer(strategy="median")),
            ("scaler", StandardScaler()),
            ("model", RidgeClassifier(alpha=1.0, class_weight="balanced")),
        ]),
        "SVC": Pipeline([
            ("imputer", SimpleImputer(strategy="median")),
            ("scaler", StandardScaler()),
            ("model", SVC(kernel="rbf", C=10, class_weight="balanced",
                          probability=True)),
        ]),
        "HistGBC": Pipeline([
            ("model", HistGradientBoostingClassifier(
                max_iter=300, max_depth=5, learning_rate=0.05,
                class_weight="balanced", random_state=42)),
        ]),
        "RandomForest": Pipeline([
            ("imputer", SimpleImputer(strategy="median")),
            ("model", RandomForestClassifier(
                n_estimators=300, max_depth=8,
                class_weight="balanced", random_state=42)),
        ]),
        "XGBoost": Pipeline([
            ("imputer", SimpleImputer(strategy="median")),
            ("model", XGBClassifier(
                n_estimators=300, max_depth=5, learning_rate=0.05,
                scale_pos_weight=5,  # approx 159/31 ratio
                random_state=42, verbosity=0, eval_metric="logloss")),
        ]),
        "CatBoost": Pipeline([
            ("model", CatBoostClassifier(
                iterations=300, depth=5, learning_rate=0.05,
                auto_class_weights="Balanced",
                random_seed=42, verbose=0)),
        ]),
        "LightGBM": Pipeline([
            ("imputer", SimpleImputer(strategy="median")),
            ("model", LGBMClassifier(
                n_estimators=300, max_depth=5, learning_rate=0.05,
                is_unbalance=True,
                random_state=42, verbose=-1)),
        ]),
    }


def get_multiclass_models():
    """Return dict of model_name → sklearn Pipeline for 5-zone multiclass classification."""
    return {
        "LogReg": Pipeline([
             ("imputer", SimpleImputer(strategy="median")),
             ("scaler", StandardScaler()),
             ("model", LogisticRegression(max_iter=1000, class_weight="balanced",
                                 solver="lbfgs")),
         ]),
        
        "SVC": Pipeline([
            ("imputer", SimpleImputer(strategy="median")),
            ("scaler", StandardScaler()),
            ("model", SVC(kernel="rbf", C=10, class_weight="balanced",
                          probability=True)),
        ]),
        "HistGBC": Pipeline([
            ("model", HistGradientBoostingClassifier(
                max_iter=300, max_depth=5, learning_rate=0.05,
                class_weight="balanced", random_state=42)),
        ]),
        "RandomForest": Pipeline([
            ("imputer", SimpleImputer(strategy="median")),
            ("model", RandomForestClassifier(
                n_estimators=300, max_depth=8,
                class_weight="balanced", random_state=42)),
        ]),
        "XGBoost": Pipeline([
            ("imputer", SimpleImputer(strategy="median")),
            # scale_pos_weight removed: not valid for multi-class
            # use_label_encoder omitted: removed from XGBoost >= 1.6
            ("model", XGBClassifier(
                n_estimators=300, max_depth=5, learning_rate=0.05,
                random_state=42, verbosity=0, eval_metric="mlogloss")),
        ]),
        "CatBoost": Pipeline([
            ("model", CatBoostClassifier(
                iterations=300, depth=5, learning_rate=0.05,
                auto_class_weights="Balanced",
                random_seed=42, verbose=0)),
        ]),
        "LightGBM": Pipeline([
            ("imputer", SimpleImputer(strategy="median")),
            ("model", LGBMClassifier(
                n_estimators=300, max_depth=5, learning_rate=0.05,
                is_unbalance=True,
                random_state=42, verbose=-1)),
        ]),
    }


def train_regression(df, feature_cols, cv_splits):
    """
    Train all regression models under subject-wise CV.

    Returns:
        dict of model_name → {
            "oof_preds": np.array (out-of-fold predictions),
            "y_true": np.array,
            "sids": np.array,
        }
    """
    X = df[feature_cols].values
    y = df["glucose_mgdl"].values
    sids = df["sid"].values

    models = get_regression_models()
    results = {}

    for name, pipeline in models.items():
        print(f"    {name}...", end=" ", flush=True)
        t0 = time.time()
        oof_preds = np.full(len(y), np.nan)

        for fold_idx, (train_idx, test_idx) in enumerate(cv_splits):
            X_train, X_test = X[train_idx], X[test_idx]
            y_train, y_test = y[train_idx], y[test_idx]

            pipeline.fit(X_train, y_train)
            oof_preds[test_idx] = pipeline.predict(X_test)

        elapsed = time.time() - t0
        results[name] = {
            "oof_preds": oof_preds,
            "y_true": y,
            "sids": sids,
        }
        # Quick MAE
        mask = ~np.isnan(oof_preds)
        mae = np.mean(np.abs(y[mask] - oof_preds[mask]))
        print(f"MAE={mae:.1f} mg/dL ({elapsed:.1f}s)")

    return results


def train_classification(df, feature_cols, cv_splits):
    """
    Train all classification models under subject-wise CV.
    Binary: 0 = within target (<=180), 1 = hyperglycaemia (>180).

    Returns:
        dict of model_name → {
            "oof_preds": np.array (predicted classes),
            "oof_proba": np.array (predicted probability of class 1),
            "y_true": np.array (true classes),
            "sids": np.array,
        }
    """
    X = df[feature_cols].values
    y_class = (df["glucose_mgdl"].values > HYPER_THRESHOLD).astype(int)
    sids = df["sid"].values

    models = get_classification_models()
    results = {}

    for name, pipeline in models.items():
        print(f"    {name}...", end=" ", flush=True)
        t0 = time.time()
        oof_preds = np.full(len(y_class), -1, dtype=int)
        oof_proba = np.full(len(y_class), np.nan)

        for fold_idx, (train_idx, test_idx) in enumerate(cv_splits):
            X_train, X_test = X[train_idx], X[test_idx]
            y_train = y_class[train_idx]

            # Skip folds where training set has only one class (e.g. small demo)
            if len(np.unique(y_train)) < 2:
                continue

            pipeline.fit(X_train, y_train)
            oof_preds[test_idx] = pipeline.predict(X_test)

            # Get probability if available
            model_step = pipeline.named_steps.get("model")
            if hasattr(model_step, "predict_proba"):
                proba = pipeline.predict_proba(X_test)
                oof_proba[test_idx] = proba[:, 1]
            elif hasattr(model_step, "decision_function"):
                oof_proba[test_idx] = pipeline.decision_function(X_test)

        elapsed = time.time() - t0
        results[name] = {
            "oof_preds": oof_preds,
            "oof_proba": oof_proba,
            "y_true": y_class,
            "sids": sids,
        }
        acc = np.mean(oof_preds[oof_preds >= 0] == y_class[oof_preds >= 0])
        print(f"Acc={acc:.3f} ({elapsed:.1f}s)")

    return results


def train_multiclass(df, feature_cols, cv_splits):
    """
    Train all multiclass models under subject-wise CV.
    Predicts one of NUM_CLASSES glucose zones defined by GLUCOSE_BINS.

    Returns:
        dict of model_name → {
            "oof_preds":   np.array (predicted class indices, int),
            "oof_proba":   np.array shape (n, NUM_CLASSES) (per-class probabilities),
            "y_true":      np.array (true class indices, int),
            "sids":        np.array,
            "label_names": list[str] (GLUCOSE_LABELS),
        }
    """
    X    = df[feature_cols].values
    sids = df["sid"].values

    # Bin glucose into integer class labels
    y_zone_raw = pd.cut(df["glucose_mgdl"], bins=GLUCOSE_BINS, labels=range(NUM_CLASSES))
    nan_mask   = y_zone_raw.isna()
    if nan_mask.any():
        n_drop = int(nan_mask.sum())
        print(f"  WARNING: {n_drop} rows fall outside GLUCOSE_BINS — dropping")
        keep      = (~nan_mask).values
        X         = X[keep]
        sids      = sids[keep]
        y_zone_raw = y_zone_raw[keep]
        # Remap fold indices to the compressed index space
        keep_pos  = np.where(keep)[0]
        old_to_new = {old: new for new, old in enumerate(keep_pos)}
        cv_splits  = [
            (np.array([old_to_new[i] for i in tr if i in old_to_new], dtype=int),
             np.array([old_to_new[i] for i in te if i in old_to_new], dtype=int))
            for tr, te in cv_splits
        ]
    y_class = y_zone_raw.astype(int).values

    models = get_multiclass_models()
    n      = len(y_class)
    results = {}

    for name, pipeline in models.items():
        print(f"    {name}...", end=" ", flush=True)
        t0        = time.time()
        oof_preds = np.full(n, -1, dtype=int)
        oof_proba = np.full((n, NUM_CLASSES), np.nan)

        for fold_idx, (train_idx, test_idx) in enumerate(cv_splits):
            X_train, X_test = X[train_idx], X[test_idx]
            y_train = y_class[train_idx]

            # Skip folds where training set has fewer than 2 classes
            if len(np.unique(y_train)) < 2:
                continue

            # Remap labels to contiguous 0-based range for models that require it
            # (e.g. XGBoost errors when labels are not 0..n-1)
            orig_classes = np.unique(y_train)
            remap = {c: i for i, c in enumerate(orig_classes)}
            unmap = {i: c for c, i in remap.items()}
            y_train_enc = np.array([remap[v] for v in y_train])

            pipeline.fit(X_train, y_train_enc)
            raw_preds = pipeline.predict(X_test).ravel()
            # Decode back to original class indices
            oof_preds[test_idx] = np.array([unmap.get(int(p), int(p)) for p in raw_preds])

            model_step = pipeline.named_steps.get("model")
            if hasattr(model_step, "predict_proba"):
                proba = pipeline.predict_proba(X_test)
                # Map encoded class positions back to original class slots
                for enc_i, orig_c in unmap.items():
                    if enc_i < proba.shape[1] and orig_c < NUM_CLASSES:
                        oof_proba[test_idx, orig_c] = proba[:, enc_i]

        elapsed  = time.time() - t0
        mask     = oof_preds >= 0
        macro_f1 = _f1_score(y_class[mask], oof_preds[mask], average="macro", zero_division=0)
        print(f"macro-F1={macro_f1:.3f} ({elapsed:.1f}s)")

        results[name] = {
            "oof_preds":   oof_preds,
            "oof_proba":   oof_proba,
            "y_true":      y_class,
            "sids":        sids,
            "label_names": GLUCOSE_LABELS,
        }

    return results


def load_selected_features(cfg):
    """Load the selected feature names from Step C1."""
    path = Path(cfg["output_dir"]) / "selected_features.txt"
    with open(path) as f:
        return [line.strip() for line in f if line.strip()]


def run_training(cfg, protocol="group_kfold_5"):
    """
    Run the full training pipeline.

    Returns:
        reg_results, cls_results, mc_results, feature_cols, df
    """
    from src.c_selection.select_features import load_master_table

    print(f"\n[D2] Model training ({protocol})")
    df = load_master_table(cfg)
    feature_cols = load_selected_features(cfg)

    # Verify features exist in the table
    missing_feats = [f for f in feature_cols if f not in df.columns]
    if missing_feats:
        print(f"  WARNING: {len(missing_feats)} features not in master table, removing")
        feature_cols = [f for f in feature_cols if f in df.columns]

    print(f"  Data: {len(df)} rows, {len(feature_cols)} features")
    print(f"  Target: glucose_mgdl (regression) + >180 mg/dL (classification)"
          f" + {NUM_CLASSES}-zone multiclass")

    # Get CV splits
    splits = get_cv_splits(df, protocol)
    print(f"  CV: {protocol} ({len(splits)} folds)")

    # Regression
    print(f"\n  === REGRESSION ===")
    reg_results = train_regression(df, feature_cols, splits)

    # Classification
    print(f"\n  === CLASSIFICATION (threshold: {HYPER_THRESHOLD} mg/dL) ===")
    n_target = (df["glucose_mgdl"] <= HYPER_THRESHOLD).sum()
    n_hyper = (df["glucose_mgdl"] > HYPER_THRESHOLD).sum()
    print(f"  Class balance: {n_target} target, {n_hyper} hyper ({n_hyper/len(df)*100:.1f}%)")
    cls_results = train_classification(df, feature_cols, splits)

    # Multiclass
    print(f"\n  === MULTICLASS ({NUM_CLASSES} zones: {', '.join(GLUCOSE_LABELS)}) ===")
    mc_results = train_multiclass(df, feature_cols, splits)

    return reg_results, cls_results, mc_results, feature_cols, df


# ── Standalone run ───────────────────────────────────────────
if __name__ == "__main__":
    from src.a_preprocessing.load_vitaldb import load_config
    cfg = load_config()
    reg_results, cls_results, mc_results, features, df = run_training(cfg, "group_kfold_5")

    print("\n" + "=" * 60)
    print("TRAINING COMPLETE")
    print("=" * 60)
    print(f"Regression models:    {list(reg_results.keys())}")
    print(f"Classification models:{list(cls_results.keys())}")
    print(f"Multiclass models:    {list(mc_results.keys())}")
