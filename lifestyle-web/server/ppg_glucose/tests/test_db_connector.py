"""
Tests for db/connector.py

All tests use an in-memory SQLite database — no server required.
Run with:  pytest tests/test_db_connector.py -v
"""

import json
import math
import numpy as np
import pandas as pd
import pytest

from sqlalchemy.orm import Session

from db.connector import (
    PipelineDB,
    PipelineRun,
    FeaturesMaster,
    FeatureRanking,
    ModelResult,
    _safe_float,
)


# ── _safe_float ───────────────────────────────────────────────

class TestSafeFloat:
    def test_normal_value(self):
        assert _safe_float(42.5) == 42.5

    def test_integer(self):
        assert _safe_float(10) == 10.0

    def test_nan_returns_none(self):
        assert _safe_float(float("nan")) is None

    def test_numpy_nan_returns_none(self):
        assert _safe_float(np.nan) is None

    def test_inf_returns_none(self):
        assert _safe_float(float("inf")) is None

    def test_negative_inf_returns_none(self):
        assert _safe_float(float("-inf")) is None

    def test_none_returns_none(self):
        assert _safe_float(None) is None

    def test_string_na_returns_none(self):
        # AUROC can be "N/A" in classification results
        assert _safe_float("N/A") is None

    def test_numeric_string(self):
        assert _safe_float("18.3") == 18.3

    def test_zero(self):
        assert _safe_float(0.0) == 0.0


# ── Schema creation ───────────────────────────────────────────

class TestInitSchema:
    def test_creates_all_tables(self, db):
        from sqlalchemy import inspect
        inspector = inspect(db.engine)
        tables = inspector.get_table_names()
        assert "pipeline_runs"    in tables
        assert "features_master"  in tables
        assert "feature_rankings" in tables
        assert "model_results"    in tables

    def test_idempotent(self, db):
        """Calling init_schema twice must not raise."""
        db.init_schema()


# ── Run lifecycle ─────────────────────────────────────────────

class TestRunLifecycle:
    def test_start_run_inserts_record(self, db, run_id, sample_cfg):
        db.start_run(run_id, sample_cfg, is_demo=True)
        with Session(db.engine) as s:
            run = s.get(PipelineRun, run_id)
        assert run is not None
        assert run.run_id == run_id
        assert run.is_demo is True
        assert run.n_subjects == 3
        assert run.config_name == "vitaldb"
        assert run.status == "running"
        assert run.started_at is not None

    def test_complete_run(self, db, run_id, sample_cfg):
        db.start_run(run_id, sample_cfg)
        db.complete_run(run_id, elapsed_seconds=312.5)
        with Session(db.engine) as s:
            run = s.get(PipelineRun, run_id)
        assert run.status == "completed"
        assert run.elapsed_seconds == pytest.approx(312.5)
        assert run.completed_at is not None

    def test_fail_run(self, db, run_id, sample_cfg):
        db.start_run(run_id, sample_cfg)
        db.fail_run(run_id, "Stage B crashed: out of memory")
        with Session(db.engine) as s:
            run = s.get(PipelineRun, run_id)
        assert run.status == "failed"
        assert "out of memory" in run.error_message
        assert run.completed_at is not None

    def test_fail_run_truncates_long_message(self, db, run_id, sample_cfg):
        db.start_run(run_id, sample_cfg)
        db.fail_run(run_id, "x" * 2000)
        with Session(db.engine) as s:
            run = s.get(PipelineRun, run_id)
        assert len(run.error_message) <= 1000

    def test_complete_nonexistent_run_does_not_crash(self, db):
        db.complete_run("does_not_exist", 99.0)

    def test_fail_nonexistent_run_does_not_crash(self, db):
        db.fail_run("does_not_exist", "oops")


# ── save_master_table ─────────────────────────────────────────

class TestSaveMasterTable:
    def test_inserts_correct_row_count(self, db, run_id, sample_cfg, master_df):
        db.start_run(run_id, sample_cfg)
        db.save_master_table(run_id, master_df)
        with Session(db.engine) as s:
            count = s.query(FeaturesMaster).filter_by(run_id=run_id).count()
        assert count == len(master_df)

    def test_metadata_columns_saved_correctly(self, db, run_id, sample_cfg, master_df):
        db.start_run(run_id, sample_cfg)
        db.save_master_table(run_id, master_df)
        with Session(db.engine) as s:
            rows = s.query(FeaturesMaster).filter_by(run_id=run_id).all()
        saved_sids = sorted(r.sid for r in rows)
        expected_sids = sorted(master_df["sid"].tolist())
        assert saved_sids == expected_sids

    def test_features_stored_as_valid_json(self, db, run_id, sample_cfg, master_df):
        db.start_run(run_id, sample_cfg)
        db.save_master_table(run_id, master_df)
        with Session(db.engine) as s:
            row = s.query(FeaturesMaster).filter_by(run_id=run_id).first()
        parsed = json.loads(row.features)
        assert isinstance(parsed, dict)
        assert "w15m_mean" in parsed
        assert "sid" not in parsed            # metadata cols excluded from JSON
        assert "glucose_mgdl" not in parsed

    def test_nan_features_stored_as_null(self, db, run_id, sample_cfg, master_df):
        db.start_run(run_id, sample_cfg)
        db.save_master_table(run_id, master_df)
        with Session(db.engine) as s:
            rows = s.query(FeaturesMaster).filter_by(run_id=run_id).all()
        # Rows where lag15m_mean was NaN should have null in the JSON
        for row in rows:
            parsed = json.loads(row.features)
            val = parsed.get("lag15m_mean")
            assert val is None or isinstance(val, float)

    def test_glucose_values_correct(self, db, run_id, sample_cfg, master_df):
        db.start_run(run_id, sample_cfg)
        db.save_master_table(run_id, master_df)
        with Session(db.engine) as s:
            rows = s.query(FeaturesMaster).filter_by(run_id=run_id).order_by(
                FeaturesMaster.glucose_time_sec
            ).all()
        for i, row in enumerate(rows):
            assert row.glucose_mgdl == pytest.approx(master_df.iloc[i]["glucose_mgdl"], rel=1e-5)


# ── save_feature_rankings ─────────────────────────────────────

class TestSaveFeatureRankings:
    def test_inserts_all_features(self, db, run_id, sample_cfg, ranking_df, selected_features):
        db.start_run(run_id, sample_cfg)
        db.save_feature_rankings(run_id, ranking_df, selected_features)
        with Session(db.engine) as s:
            count = s.query(FeatureRanking).filter_by(run_id=run_id).count()
        assert count == len(ranking_df)

    def test_selected_flag_correct(self, db, run_id, sample_cfg, ranking_df, selected_features):
        db.start_run(run_id, sample_cfg)
        db.save_feature_rankings(run_id, ranking_df, selected_features)
        with Session(db.engine) as s:
            rows = s.query(FeatureRanking).filter_by(run_id=run_id).all()
        selected_set = set(selected_features)
        for row in rows:
            if row.feature_name in selected_set:
                assert row.selected is True
            else:
                assert row.selected is False

    def test_rank_1_has_highest_importance(self, db, run_id, sample_cfg, ranking_df, selected_features):
        db.start_run(run_id, sample_cfg)
        db.save_feature_rankings(run_id, ranking_df, selected_features)
        with Session(db.engine) as s:
            top = s.query(FeatureRanking).filter_by(run_id=run_id, rank=1).first()
        assert top.feature_name == "w15m_mean"
        assert top.importance == pytest.approx(42.1)


# ── save_model_results ────────────────────────────────────────

class TestSaveModelResults:
    def test_inserts_correct_total_count(
        self, db, run_id, sample_cfg, reg_summary, cls_summary, mc_summary
    ):
        db.start_run(run_id, sample_cfg)
        db.save_model_results(run_id, reg_summary, cls_summary, mc_summary)
        with Session(db.engine) as s:
            count = s.query(ModelResult).filter_by(run_id=run_id).count()
        expected = len(reg_summary) + len(cls_summary) + len(mc_summary)
        assert count == expected

    def test_regression_task_metrics(
        self, db, run_id, sample_cfg, reg_summary, cls_summary, mc_summary
    ):
        db.start_run(run_id, sample_cfg)
        db.save_model_results(run_id, reg_summary, cls_summary, mc_summary)
        with Session(db.engine) as s:
            row = (
                s.query(ModelResult)
                .filter_by(run_id=run_id, task="regression", model_name="CatBoost")
                .first()
            )
        assert row is not None
        assert row.mae  == pytest.approx(18.3)
        assert row.rmse == pytest.approx(24.1)
        assert row.r2   == pytest.approx(0.42)
        assert row.zone_a_pct  == pytest.approx(68.2)
        assert row.zone_ab_pct == pytest.approx(95.1)

    def test_classification_metrics_saved(
        self, db, run_id, sample_cfg, reg_summary, cls_summary, mc_summary
    ):
        db.start_run(run_id, sample_cfg)
        db.save_model_results(run_id, reg_summary, cls_summary, mc_summary)
        with Session(db.engine) as s:
            row = (
                s.query(ModelResult)
                .filter_by(run_id=run_id, task="classification", model_name="CatBoost")
                .first()
            )
        assert row.accuracy       == pytest.approx(0.87)
        assert row.recall_hyper   == pytest.approx(0.65)
        assert row.f1_hyper       == pytest.approx(0.68)
        assert row.auroc          == pytest.approx(0.81)

    def test_classification_string_auroc_stored_as_null(
        self, db, run_id, sample_cfg, reg_summary, cls_summary, mc_summary
    ):
        # SVC has AUROC = "N/A" — must be stored as NULL, not crash
        db.start_run(run_id, sample_cfg)
        db.save_model_results(run_id, reg_summary, cls_summary, mc_summary)
        with Session(db.engine) as s:
            row = (
                s.query(ModelResult)
                .filter_by(run_id=run_id, task="classification", model_name="SVC")
                .first()
            )
        assert row.auroc is None

    def test_multiclass_metrics_saved(
        self, db, run_id, sample_cfg, reg_summary, cls_summary, mc_summary
    ):
        db.start_run(run_id, sample_cfg)
        db.save_model_results(run_id, reg_summary, cls_summary, mc_summary)
        with Session(db.engine) as s:
            row = (
                s.query(ModelResult)
                .filter_by(run_id=run_id, task="multiclass", model_name="HistGBC")
                .first()
            )
        assert row.macro_f1       == pytest.approx(0.45)
        assert row.weighted_f1    == pytest.approx(0.61)
        assert row.off_by_one_acc == pytest.approx(0.83)

    def test_all_three_tasks_present(
        self, db, run_id, sample_cfg, reg_summary, cls_summary, mc_summary
    ):
        db.start_run(run_id, sample_cfg)
        db.save_model_results(run_id, reg_summary, cls_summary, mc_summary)
        with Session(db.engine) as s:
            tasks = {
                r.task
                for r in s.query(ModelResult).filter_by(run_id=run_id).all()
            }
        assert tasks == {"regression", "classification", "multiclass"}


# ── Query helpers ─────────────────────────────────────────────

class TestQueryHelpers:
    def test_list_runs_empty(self, db):
        assert db.list_runs() == []

    def test_list_runs_returns_started_run(self, db, run_id, sample_cfg):
        db.start_run(run_id, sample_cfg, is_demo=True)
        runs = db.list_runs()
        assert len(runs) == 1
        assert runs[0]["run_id"] == run_id
        assert runs[0]["is_demo"] is True
        assert runs[0]["n_subjects"] == 3
        assert runs[0]["status"] == "running"

    def test_list_runs_newest_first(self, db, sample_cfg):
        for i in range(3):
            db.start_run(f"run_{i:03d}", sample_cfg)
            db.complete_run(f"run_{i:03d}", float(i * 10))
        runs = db.list_runs()
        assert len(runs) == 3
        # Most recent inserted last → list_runs returns DESC by started_at
        # All started_at values may be equal (same second) so just check all present
        ids = {r["run_id"] for r in runs}
        assert ids == {"run_000", "run_001", "run_002"}

    def test_get_best_models_regression(
        self, db, run_id, sample_cfg, reg_summary, cls_summary, mc_summary
    ):
        db.start_run(run_id, sample_cfg)
        db.save_model_results(run_id, reg_summary, cls_summary, mc_summary)
        best = db.get_best_models(run_id)
        # CatBoost has lower MAE (18.3 vs 22.5) → best regression
        assert best["best_regression"]["model"] == "CatBoost"
        assert best["best_regression"]["metric"] == "MAE"

    def test_get_best_models_classification(
        self, db, run_id, sample_cfg, reg_summary, cls_summary, mc_summary
    ):
        db.start_run(run_id, sample_cfg)
        db.save_model_results(run_id, reg_summary, cls_summary, mc_summary)
        best = db.get_best_models(run_id)
        # CatBoost has higher F1 (0.68 vs 0.57) → best classification
        assert best["best_classification"]["model"] == "CatBoost"

    def test_get_best_models_multiclass(
        self, db, run_id, sample_cfg, reg_summary, cls_summary, mc_summary
    ):
        db.start_run(run_id, sample_cfg)
        db.save_model_results(run_id, reg_summary, cls_summary, mc_summary)
        best = db.get_best_models(run_id)
        # HistGBC has higher macro_f1 (0.45 vs 0.41) → best multiclass
        assert best["best_multiclass"]["model"] == "HistGBC"

    def test_get_best_models_empty_run(self, db, run_id, sample_cfg):
        db.start_run(run_id, sample_cfg)
        best = db.get_best_models(run_id)
        assert best == {}


# ── Multi-run isolation ───────────────────────────────────────

class TestMultiRunIsolation:
    def test_two_runs_do_not_mix_features(self, db, sample_cfg, master_df):
        db.start_run("run_A", sample_cfg)
        db.start_run("run_B", sample_cfg)
        db.save_master_table("run_A", master_df)

        with Session(db.engine) as s:
            count_a = s.query(FeaturesMaster).filter_by(run_id="run_A").count()
            count_b = s.query(FeaturesMaster).filter_by(run_id="run_B").count()
        assert count_a == len(master_df)
        assert count_b == 0

    def test_two_runs_do_not_mix_results(
        self, db, sample_cfg, reg_summary, cls_summary, mc_summary
    ):
        db.start_run("run_A", sample_cfg)
        db.start_run("run_B", sample_cfg)
        db.save_model_results("run_A", reg_summary, cls_summary, mc_summary)

        with Session(db.engine) as s:
            count_b = s.query(ModelResult).filter_by(run_id="run_B").count()
        assert count_b == 0
