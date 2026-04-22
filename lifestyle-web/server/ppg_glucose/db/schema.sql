-- PPG-Glucose Pipeline - Reference SQL Schema (PostgreSQL)
-- =========================================================
-- This file is for reference only.
-- Tables are auto-created by db/connector.py (run_pipeline.py --db-url ...).
-- Use this file if you need to pre-create the schema manually.
--
-- For MySQL:  replace SERIAL → INT AUTO_INCREMENT
--             replace BOOLEAN → TINYINT(1)
-- For SQLite: SQLite auto-creates via SQLAlchemy, no manual creation needed.

CREATE TABLE IF NOT EXISTS pipeline_runs (
    run_id          VARCHAR(80)  PRIMARY KEY,
    is_demo         BOOLEAN      NOT NULL DEFAULT FALSE,
    n_subjects      INTEGER,
    config_name     VARCHAR(100),
    status          VARCHAR(20)  NOT NULL DEFAULT 'running',  -- running|completed|failed
    error_message   TEXT,
    started_at      TIMESTAMP    NOT NULL,
    completed_at    TIMESTAMP,
    elapsed_seconds FLOAT
);

-- One row per glucose measurement per subject.
-- All ~365 PPG feature values stored as a JSON blob in the features column.
-- Metadata columns are indexed for fast filtering.
CREATE TABLE IF NOT EXISTS features_master (
    id               SERIAL       PRIMARY KEY,
    run_id           VARCHAR(80)  NOT NULL REFERENCES pipeline_runs(run_id),
    sid              INTEGER      NOT NULL,         -- subject / case ID
    glucose_time_sec FLOAT        NOT NULL,         -- seconds from case start
    glucose_mgdl     FLOAT        NOT NULL,         -- target value
    features         TEXT         NOT NULL,         -- JSON: {feature_name: value, ...}
    created_at       TIMESTAMP    NOT NULL DEFAULT NOW()
);

-- Feature importance ranking from Stage C (CatBoost-based).
CREATE TABLE IF NOT EXISTS feature_rankings (
    id           SERIAL       PRIMARY KEY,
    run_id       VARCHAR(80)  NOT NULL REFERENCES pipeline_runs(run_id),
    feature_name VARCHAR(255) NOT NULL,
    importance   FLOAT        NOT NULL,
    rank         INTEGER      NOT NULL,
    selected     BOOLEAN      NOT NULL,   -- TRUE = top-N selected for training
    created_at   TIMESTAMP    NOT NULL DEFAULT NOW()
);

-- Evaluation metrics for every model across all three tasks.
CREATE TABLE IF NOT EXISTS model_results (
    id                  SERIAL       PRIMARY KEY,
    run_id              VARCHAR(80)  NOT NULL REFERENCES pipeline_runs(run_id),
    task                VARCHAR(30)  NOT NULL,   -- regression | classification | multiclass
    model_name          VARCHAR(100) NOT NULL,
    -- Regression metrics
    mae                 FLOAT,
    rmse                FLOAT,
    r2                  FLOAT,
    median_subject_mae  FLOAT,
    zone_a_pct          FLOAT,
    zone_ab_pct         FLOAT,
    -- Binary classification metrics (>180 mg/dL = hyperglycaemia)
    accuracy            FLOAT,
    precision_hyper     FLOAT,
    recall_hyper        FLOAT,
    f1_hyper            FLOAT,
    auroc               FLOAT,
    -- 5-zone multiclass metrics
    macro_f1            FLOAT,
    weighted_f1         FLOAT,
    off_by_one_acc      FLOAT,
    created_at          TIMESTAMP    NOT NULL DEFAULT NOW(),
    UNIQUE (run_id, task, model_name)
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_features_run   ON features_master(run_id);
CREATE INDEX IF NOT EXISTS idx_features_sid   ON features_master(sid);
CREATE INDEX IF NOT EXISTS idx_rankings_run   ON feature_rankings(run_id);
CREATE INDEX IF NOT EXISTS idx_results_run    ON model_results(run_id);
CREATE INDEX IF NOT EXISTS idx_results_task   ON model_results(task);

-- ── Example queries ────────────────────────────────────────────

-- List all pipeline runs:
-- SELECT run_id, is_demo, n_subjects, status, started_at, elapsed_seconds/60 AS minutes
-- FROM pipeline_runs ORDER BY started_at DESC;

-- Best regression model for a run:
-- SELECT model_name, mae, rmse, r2, zone_a_pct
-- FROM model_results
-- WHERE run_id = 'full_20260422_143012' AND task = 'regression'
-- ORDER BY mae ASC LIMIT 1;

-- Top 10 most important features:
-- SELECT feature_name, importance, selected
-- FROM feature_rankings
-- WHERE run_id = 'full_20260422_143012'
-- ORDER BY rank ASC LIMIT 10;

-- All glucose measurements for a subject:
-- SELECT sid, glucose_time_sec, glucose_mgdl
-- FROM features_master
-- WHERE run_id = 'full_20260422_143012' AND sid = 184
-- ORDER BY glucose_time_sec;
