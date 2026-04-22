"""
Database connector for the PPG-Glucose pipeline.

Supports PostgreSQL, MySQL, and SQLite via SQLAlchemy ORM.
Tables are auto-created on first connect (init_schema).

Example DB URLs:
    sqlite:///results.db
    postgresql://user:pass@host:5432/ppg_db
    mysql+pymysql://user:pass@host:3306/ppg_db
"""

import json
import math
from datetime import datetime

from sqlalchemy import (
    Boolean, Column, DateTime, Float, Integer, String, Text,
    UniqueConstraint, create_engine,
)
from sqlalchemy.orm import DeclarativeBase, Session


# ── ORM models ────────────────────────────────────────────────

class Base(DeclarativeBase):
    pass


class PipelineRun(Base):
    __tablename__ = "pipeline_runs"

    run_id          = Column(String(80), primary_key=True)
    is_demo         = Column(Boolean,    nullable=False, default=False)
    n_subjects      = Column(Integer)
    config_name     = Column(String(100))
    status          = Column(String(20), nullable=False, default="running")
    error_message   = Column(Text)
    started_at      = Column(DateTime,   nullable=False)
    completed_at    = Column(DateTime)
    elapsed_seconds = Column(Float)


class FeaturesMaster(Base):
    """One row per glucose measurement per subject, features stored as JSON."""
    __tablename__ = "features_master"

    id               = Column(Integer,  primary_key=True, autoincrement=True)
    run_id           = Column(String(80), nullable=False)
    sid              = Column(Integer,    nullable=False)
    glucose_time_sec = Column(Float,      nullable=False)
    glucose_mgdl     = Column(Float,      nullable=False)
    features         = Column(Text,       nullable=False)  # JSON blob
    created_at       = Column(DateTime,   nullable=False)


class FeatureRanking(Base):
    """Feature importance ranking from Stage C."""
    __tablename__ = "feature_rankings"

    id           = Column(Integer,  primary_key=True, autoincrement=True)
    run_id       = Column(String(80), nullable=False)
    feature_name = Column(String(255), nullable=False)
    importance   = Column(Float,  nullable=False)
    rank         = Column(Integer, nullable=False)
    selected     = Column(Boolean, nullable=False)
    created_at   = Column(DateTime, nullable=False)


class ModelResult(Base):
    """Evaluation metrics for every model across all three tasks."""
    __tablename__ = "model_results"

    id                 = Column(Integer,  primary_key=True, autoincrement=True)
    run_id             = Column(String(80),  nullable=False)
    task               = Column(String(30),  nullable=False)   # regression | classification | multiclass
    model_name         = Column(String(100), nullable=False)
    # Regression
    mae                = Column(Float)
    rmse               = Column(Float)
    r2                 = Column(Float)
    median_subject_mae = Column(Float)
    zone_a_pct         = Column(Float)
    zone_ab_pct        = Column(Float)
    # Binary classification
    accuracy           = Column(Float)
    precision_hyper    = Column(Float)
    recall_hyper       = Column(Float)
    f1_hyper           = Column(Float)
    auroc              = Column(Float)
    # Multiclass
    macro_f1           = Column(Float)
    weighted_f1        = Column(Float)
    off_by_one_acc     = Column(Float)
    created_at         = Column(DateTime, nullable=False)

    __table_args__ = (
        UniqueConstraint("run_id", "task", "model_name", name="uq_run_task_model"),
    )


# ── Helper ────────────────────────────────────────────────────

def _safe_float(val):
    """Convert a value to float, returning None for NaN/inf/non-numeric."""
    try:
        v = float(val)
        return None if (math.isnan(v) or math.isinf(v)) else v
    except (TypeError, ValueError):
        return None


# ── Main connector class ───────────────────────────────────────

class PipelineDB:
    """
    Thin wrapper around SQLAlchemy for the PPG-Glucose pipeline.

    Usage:
        db = PipelineDB("sqlite:///results.db")
        db.init_schema()                          # create tables
        db.start_run(run_id, cfg, is_demo=True)   # log run start
        db.save_master_table(run_id, df)          # Stage B output
        db.save_feature_rankings(run_id, r, sel)  # Stage C output
        db.save_model_results(run_id, r, c, m)    # Stage D output
        db.complete_run(run_id, elapsed_sec)       # mark done
    """

    def __init__(self, db_url: str):
        self.engine = create_engine(db_url, echo=False)

    # ── Schema ────────────────────────────────────────────────

    def init_schema(self):
        """Create all tables if they do not already exist."""
        Base.metadata.create_all(self.engine)

    # ── Run lifecycle ─────────────────────────────────────────

    def start_run(self, run_id: str, cfg: dict, is_demo: bool = False):
        with Session(self.engine) as session:
            session.add(PipelineRun(
                run_id=run_id,
                is_demo=is_demo,
                n_subjects=len(cfg.get("subjects", [])),
                config_name=cfg.get("dataset_name", "unknown"),
                status="running",
                started_at=datetime.utcnow(),
            ))
            session.commit()

    def complete_run(self, run_id: str, elapsed_seconds: float):
        with Session(self.engine) as session:
            run = session.get(PipelineRun, run_id)
            if run:
                run.status = "completed"
                run.completed_at = datetime.utcnow()
                run.elapsed_seconds = elapsed_seconds
                session.commit()

    def fail_run(self, run_id: str, error_message: str):
        with Session(self.engine) as session:
            run = session.get(PipelineRun, run_id)
            if run:
                run.status = "failed"
                run.error_message = error_message[:1000]
                run.completed_at = datetime.utcnow()
                session.commit()

    # ── Stage B: master table ─────────────────────────────────

    def save_master_table(self, run_id: str, df):
        """
        Insert all rows of the master feature table.
        Non-metadata columns are serialised to a JSON blob per row.
        """
        meta_cols = {"sid", "glucose_time_sec", "glucose_mgdl"}
        feature_cols = [c for c in df.columns if c not in meta_cols]
        now = datetime.utcnow()

        with Session(self.engine) as session:
            for _, row in df.iterrows():
                features = {
                    col: _safe_float(row[col])
                    for col in feature_cols
                }
                session.add(FeaturesMaster(
                    run_id=run_id,
                    sid=int(row["sid"]),
                    glucose_time_sec=float(row["glucose_time_sec"]),
                    glucose_mgdl=float(row["glucose_mgdl"]),
                    features=json.dumps(features),
                    created_at=now,
                ))
            session.commit()

    # ── Stage C: feature rankings ─────────────────────────────

    def save_feature_rankings(self, run_id: str, ranking_df, selected_features):
        """Insert the full feature importance ranking from Stage C."""
        selected_set = set(selected_features)
        now = datetime.utcnow()

        with Session(self.engine) as session:
            for _, row in ranking_df.iterrows():
                session.add(FeatureRanking(
                    run_id=run_id,
                    feature_name=str(row["feature"]),
                    importance=float(row["importance"]),
                    rank=int(row["rank"]),
                    selected=row["feature"] in selected_set,
                    created_at=now,
                ))
            session.commit()

    # ── Stage D: model results ────────────────────────────────

    def save_model_results(self, run_id: str, reg_summary, cls_summary, mc_summary):
        """Insert evaluation metrics for all models from Stage D."""
        now = datetime.utcnow()

        with Session(self.engine) as session:
            for _, row in reg_summary.iterrows():
                session.add(ModelResult(
                    run_id=run_id,
                    task="regression",
                    model_name=str(row["model"]),
                    mae=_safe_float(row.get("MAE")),
                    rmse=_safe_float(row.get("RMSE")),
                    r2=_safe_float(row.get("R2")),
                    median_subject_mae=_safe_float(row.get("median_subject_MAE")),
                    zone_a_pct=_safe_float(row.get("Zone_A_pct")),
                    zone_ab_pct=_safe_float(row.get("Zone_AB_pct")),
                    created_at=now,
                ))

            for _, row in cls_summary.iterrows():
                session.add(ModelResult(
                    run_id=run_id,
                    task="classification",
                    model_name=str(row["model"]),
                    accuracy=_safe_float(row.get("accuracy")),
                    precision_hyper=_safe_float(row.get("precision_hyper")),
                    recall_hyper=_safe_float(row.get("recall_hyper")),
                    f1_hyper=_safe_float(row.get("f1_hyper")),
                    auroc=_safe_float(row.get("AUROC")),
                    created_at=now,
                ))

            for _, row in mc_summary.iterrows():
                session.add(ModelResult(
                    run_id=run_id,
                    task="multiclass",
                    model_name=str(row["model"]),
                    macro_f1=_safe_float(row.get("macro_f1")),
                    weighted_f1=_safe_float(row.get("weighted_f1")),
                    off_by_one_acc=_safe_float(row.get("off_by_one_acc")),
                    created_at=now,
                ))

            session.commit()

    # ── Query helpers ─────────────────────────────────────────

    def list_runs(self):
        """Return a summary of all pipeline runs as a list of dicts."""
        with Session(self.engine) as session:
            runs = session.query(PipelineRun).order_by(PipelineRun.started_at.desc()).all()
            return [
                {
                    "run_id": r.run_id,
                    "is_demo": r.is_demo,
                    "n_subjects": r.n_subjects,
                    "status": r.status,
                    "started_at": str(r.started_at),
                    "elapsed_min": round(r.elapsed_seconds / 60, 1) if r.elapsed_seconds else None,
                }
                for r in runs
            ]

    def get_best_models(self, run_id: str):
        """Return the best model per task for a given run."""
        with Session(self.engine) as session:
            results = (
                session.query(ModelResult)
                .filter(ModelResult.run_id == run_id)
                .all()
            )
            best = {}
            for r in results:
                if r.task == "regression":
                    key = "best_regression"
                    score = r.mae  # lower is better
                    if key not in best or (score is not None and score < best[key]["score"]):
                        best[key] = {"model": r.model_name, "metric": "MAE", "score": score}
                elif r.task == "classification":
                    key = "best_classification"
                    score = r.f1_hyper
                    if key not in best or (score is not None and score > best[key]["score"]):
                        best[key] = {"model": r.model_name, "metric": "F1", "score": score}
                elif r.task == "multiclass":
                    key = "best_multiclass"
                    score = r.macro_f1
                    if key not in best or (score is not None and score > best[key]["score"]):
                        best[key] = {"model": r.model_name, "metric": "macro_F1", "score": score}
            return best
