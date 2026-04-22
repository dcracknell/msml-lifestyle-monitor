"""
Shared pytest fixtures for the PPG-Glucose pipeline test suite.
All DB tests use an in-memory SQLite database — no server required.
"""

import json
import math
import numpy as np
import pandas as pd
import pytest

from db.connector import PipelineDB


# ── DB fixtures ───────────────────────────────────────────────

@pytest.fixture
def db():
    """Fresh in-memory SQLite database for every test."""
    conn = PipelineDB("sqlite:///:memory:")
    conn.init_schema()
    return conn


@pytest.fixture
def run_id():
    return "test_run_20260422_000001"


@pytest.fixture
def sample_cfg():
    return {
        "dataset_name": "vitaldb",
        "subjects": [184, 241, 626],
        "data_dir": "data/vitaldb",
        "output_dir": "outputs/test",
    }


# ── DataFrame fixtures ────────────────────────────────────────

@pytest.fixture
def master_df():
    """Minimal master table: 4 rows, 5 features + metadata."""
    rng = np.random.default_rng(42)
    rows = []
    for i, sid in enumerate([184, 184, 241, 626]):
        row = {
            "sid": sid,
            "glucose_time_sec": float(1000 + i * 500),
            "glucose_mgdl": float(rng.uniform(80, 220)),
            "w15m_mean": float(rng.normal()),
            "w15m_std": float(rng.uniform(0, 1)),
            "demo_age": 55.0,
            "demo_bmi": 24.5,
            "lag15m_mean": float(rng.normal()) if i % 2 == 0 else float("nan"),
        }
        rows.append(row)
    return pd.DataFrame(rows)


@pytest.fixture
def ranking_df():
    """Feature ranking DataFrame as produced by Stage C."""
    features = ["w15m_mean", "demo_age", "w15m_std", "demo_bmi", "lag15m_mean"]
    return pd.DataFrame({
        "feature":    features,
        "importance": [42.1, 30.5, 15.3, 8.7, 3.4],
        "rank":       [1, 2, 3, 4, 5],
    })


@pytest.fixture
def selected_features():
    return ["w15m_mean", "demo_age"]


@pytest.fixture
def reg_summary():
    return pd.DataFrame([
        {"model": "CatBoost",     "MAE": 18.3, "RMSE": 24.1, "R2": 0.42,
         "median_subject_MAE": 17.1, "Zone_A_pct": 68.2, "Zone_AB_pct": 95.1},
        {"model": "Ridge",        "MAE": 22.5, "RMSE": 29.4, "R2": 0.31,
         "median_subject_MAE": 21.0, "Zone_A_pct": 62.0, "Zone_AB_pct": 91.3},
    ])


@pytest.fixture
def cls_summary():
    return pd.DataFrame([
        {"model": "CatBoost", "accuracy": 0.87, "precision_hyper": 0.72,
         "recall_hyper": 0.65, "f1_hyper": 0.68, "AUROC": 0.81,
         "TN": 140, "FP": 10, "FN": 11, "TP": 21},
        {"model": "SVC",      "accuracy": 0.83, "precision_hyper": 0.60,
         "recall_hyper": 0.55, "f1_hyper": 0.57, "AUROC": "N/A",
         "TN": 138, "FP": 12, "FN": 14, "TP": 18},
    ])


@pytest.fixture
def mc_summary():
    return pd.DataFrame([
        {"model": "HistGBC", "macro_f1": 0.45, "weighted_f1": 0.61, "off_by_one_acc": 0.83},
        {"model": "XGBoost", "macro_f1": 0.41, "weighted_f1": 0.58, "off_by_one_acc": 0.80},
    ])
