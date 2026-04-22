# Server Deployment Guide — PPG-Glucose Pipeline

## Contents
1. [Prerequisites](#1-prerequisites)
2. [Transfer the project to the server](#2-transfer-the-project-to-the-server)
3. [Server environment setup](#3-server-environment-setup)
4. [Data files](#4-data-files)
5. [Verify the setup](#5-verify-the-setup)
6. [Run the demo (fast, no SQL)](#6-run-the-demo-fast-no-sql)
7. [Run the demo with SQL](#7-run-the-demo-with-sql)
8. [Full pipeline run](#8-full-pipeline-run)
9. [SQL database options](#9-sql-database-options)
10. [Running in the background](#10-running-in-the-background)
11. [Querying results from SQL](#11-querying-results-from-sql)
12. [Troubleshooting](#12-troubleshooting)

---

## 1. Prerequisites

The server needs:

| Requirement | Version | Check command |
|-------------|---------|---------------|
| Python      | ≥ 3.9   | `python3 --version` |
| pip         | any     | `pip3 --version` |
| Git         | any     | `git --version` |
| ~4 GB RAM   | —       | `free -h` |
| ~2 GB disk  | —       | `df -h .` |

> **GPU not required.** All models (CatBoost, XGBoost, etc.) run on CPU.

---

## 2. Transfer the project to the server

### Option A — Copy via SCP (from your local machine)
```bash
# Replace user@server-ip with your server credentials
scp -r ppg_glucose/ user@server-ip:/home/user/ppg_pipeline/
```

### Option B — Clone from Git
```bash
# SSH into the server first, then:
git clone <your-repo-url> /home/user/ppg_pipeline
cd /home/user/ppg_pipeline/ppg_glucose
```

### Option C — rsync (best for large data files)
```bash
rsync -avz --progress ppg_glucose/ user@server-ip:/home/user/ppg_pipeline/ppg_glucose/
```

---

## 3. Server environment setup

All commands below run **on the server** inside the `ppg_glucose/` directory.

```bash
# SSH into the server
ssh user@server-ip

# Navigate to the project
cd /home/user/ppg_pipeline/ppg_glucose

# Create a virtual environment
python3 -m venv venv

# Activate it
source venv/bin/activate

# Upgrade pip first
pip install --upgrade pip

# Install all dependencies (includes SQL support)
pip install -r requirements_server.txt
```

> The first install takes 5–10 minutes due to catboost/xgboost/lightgbm compilation.

---

## 4. Data files

The pipeline expects this layout inside `data/vitaldb/`:

```
data/vitaldb/
├── final_glucose.csv           ← glucose measurements
├── selected_demographics.csv   ← patient demographics
├── download_log.csv            ← PPG download metadata
├── final_cases.csv             ← case list
└── ppg/
    ├── 184.npy                 ← raw PPG waveform (500 Hz)
    ├── 241.npy
    ├── 626.npy
    └── ...  (20 .npy files total)
```

Copy these from your local machine if needed:
```bash
scp -r data/vitaldb/ user@server-ip:/home/user/ppg_pipeline/ppg_glucose/data/
```

Verify all 20 subject files are present:
```bash
ls data/vitaldb/ppg/*.npy | wc -l   # should print 20
```

---

## 5. Verify the setup

Run this quick check before anything else:

```bash
# Activate venv if not already active
source venv/bin/activate

# Check all packages load correctly
python3 -c "
import numpy, pandas, scipy, sklearn, PyEMD, catboost, xgboost, lightgbm, sqlalchemy
print('All packages OK')
print('SQLAlchemy version:', sqlalchemy.__version__)
"

# Check data files exist
python3 -c "
from src.a_preprocessing.load_vitaldb import load_config, load_glucose, load_demographics
cfg = load_config()
df = load_glucose(cfg)
print(f'Glucose file OK: {len(df)} rows')
demo = load_demographics(cfg)
print(f'Demographics file OK: {len(demo)} cases')
"
```

---

## 6. Run the demo (fast, no SQL)

The demo uses **3 subjects** instead of 20, completing in **5–15 minutes**.
This is the fastest way to verify the pipeline works end-to-end.

```bash
source venv/bin/activate
python run_pipeline.py --demo
```

**What it does:**
- Loads 3 subjects (cases 184, 241, 626)
- Runs all 4 stages: load → preprocess → features → train
- Saves results to `outputs/demo/`
- Does NOT write to any database

**Expected output:**
```
=================================================================
  PPG → Glucose Prediction Pipeline  (VitalDB)
  Started : 2026-04-22 14:30:12
  Mode    : DEMO (3 subjects)
  Stages  : A → B → C → D
=================================================================
[DEMO] Subjects : [184, 241, 626]
[DEMO] Output   : outputs/demo/

── Stage A — Load & Preprocess ──────────────────────────────
  ...
[A done] ~30 segments in 12s

── Stage B — Feature Extraction ─────────────────────────────
  ...
[B done] 30×368 table in 180s

── Stage C — Feature Selection ──────────────────────────────
  ...
[C done] 50 features selected from 365 in 15s

── Stage D — Training & Evaluation ──────────────────────────
  ...
[D done] 21 models evaluated in 90s

=================================================================
  PIPELINE COMPLETE
  Total time : 5.0 min
  Outputs    : /home/user/ppg_pipeline/ppg_glucose/outputs/demo/
=================================================================
```

---

## 7. Run the demo with SQL

### Option A — SQLite (zero config, best for testing)

SQLite requires no server — it creates a single `.db` file automatically.

```bash
source venv/bin/activate

python run_pipeline.py --demo --db-url "sqlite:///demo_results.db"
```

The file `demo_results.db` will appear in the current directory.
Query it with any SQLite client or the Python snippet in [Section 11](#11-querying-results-from-sql).

### Option B — PostgreSQL

```bash
python run_pipeline.py --demo \
  --db-url "postgresql://ppg_user:your_password@localhost:5432/ppg_db"
```

### Option C — MySQL / MariaDB

```bash
python run_pipeline.py --demo \
  --db-url "mysql+pymysql://ppg_user:your_password@localhost:3306/ppg_db"
```

> **Tip:** Use an environment variable to avoid putting passwords in the shell history:
> ```bash
> export DB_URL="postgresql://ppg_user:your_password@localhost:5432/ppg_db"
> python run_pipeline.py --demo --db-url "$DB_URL"
> ```

---

## 8. Full pipeline run

Once the demo works, run with all 20 subjects:

```bash
# No SQL (~45–90 min depending on server)
python run_pipeline.py

# With SQLite
python run_pipeline.py --db-url "sqlite:///full_results.db"

# With PostgreSQL
python run_pipeline.py --db-url "postgresql://ppg_user:pass@localhost:5432/ppg_db"
```

### Run individual stages

If a stage crashes, you can re-run from any point (B/C/D read prior stage outputs from disk):

```bash
# Re-run only feature selection and training
python run_pipeline.py --stages C D

# Re-run only training
python run_pipeline.py --stages D

# Re-run only feature extraction (needs A to run first or existing segments)
python run_pipeline.py --stages A B
```

---

## 9. SQL database options

### SQLite (local testing — no setup needed)
```bash
# Auto-created, no installation required
python run_pipeline.py --db-url "sqlite:///results.db"
```

### PostgreSQL (recommended for production)

```bash
# Install PostgreSQL on the server (Ubuntu/Debian)
sudo apt update && sudo apt install -y postgresql postgresql-contrib

# Start it
sudo systemctl start postgresql
sudo systemctl enable postgresql

# Create the database and user
sudo -u postgres psql <<EOF
CREATE USER ppg_user WITH PASSWORD 'your_secure_password';
CREATE DATABASE ppg_db OWNER ppg_user;
GRANT ALL PRIVILEGES ON DATABASE ppg_db TO ppg_user;
EOF

# Verify connection
psql -h localhost -U ppg_user -d ppg_db -c "\dt"
```

Then run the pipeline:
```bash
python run_pipeline.py --db-url "postgresql://ppg_user:your_secure_password@localhost:5432/ppg_db"
```

### MySQL / MariaDB

```bash
# Install MariaDB (Ubuntu/Debian)
sudo apt update && sudo apt install -y mariadb-server

# Secure and start
sudo systemctl start mariadb
sudo mysql_secure_installation

# Create database and user
sudo mysql <<EOF
CREATE DATABASE ppg_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'ppg_user'@'localhost' IDENTIFIED BY 'your_secure_password';
GRANT ALL PRIVILEGES ON ppg_db.* TO 'ppg_user'@'localhost';
FLUSH PRIVILEGES;
EOF
```

Then run the pipeline:
```bash
python run_pipeline.py --db-url "mysql+pymysql://ppg_user:your_secure_password@localhost:3306/ppg_db"
```

---

## 10. Running in the background

For long runs on a server, use `nohup` so the job survives disconnection:

### Demo in background
```bash
source venv/bin/activate

nohup python run_pipeline.py --demo \
  --db-url "sqlite:///demo_results.db" \
  > logs/demo_run.log 2>&1 &

echo "Pipeline PID: $!"
```

### Full run in background
```bash
mkdir -p logs

nohup python run_pipeline.py \
  --db-url "postgresql://ppg_user:pass@localhost:5432/ppg_db" \
  > logs/full_run_$(date +%Y%m%d_%H%M%S).log 2>&1 &

echo "Pipeline PID: $!"
```

### Monitor progress
```bash
# Follow log output live
tail -f logs/full_run_*.log

# Check if still running
ps aux | grep run_pipeline

# Check disk usage of outputs
du -sh outputs/
```

### Using screen (alternative — survives SSH disconnect)
```bash
# Start a named screen session
screen -S ppg_pipeline

source venv/bin/activate
python run_pipeline.py --demo --db-url "sqlite:///demo_results.db"

# Detach: Ctrl+A then D
# Reattach later:
screen -r ppg_pipeline
```

---

## 11. Querying results from SQL

### Python (works for all DB backends)
```python
from db.connector import PipelineDB

db = PipelineDB("sqlite:///demo_results.db")  # change URL as needed

# List all runs
for run in db.list_runs():
    print(run)

# Best model per task for a run
best = db.get_best_models("demo_20260422_143012")
print(best)
# → {'best_regression': {'model': 'CatBoost', 'metric': 'MAE', 'score': 18.3}, ...}
```

### SQLite CLI
```bash
sqlite3 demo_results.db

# List runs
SELECT run_id, status, n_subjects, elapsed_seconds/60.0 AS minutes FROM pipeline_runs;

# Best regression models
SELECT model_name, mae, rmse, r2, zone_a_pct
FROM model_results
WHERE task = 'regression'
ORDER BY mae ASC;

# Top 10 features
SELECT feature_name, importance, selected
FROM feature_rankings
ORDER BY rank ASC
LIMIT 10;

# Glucose distribution
SELECT
  ROUND(glucose_mgdl/20)*20 AS bucket,
  COUNT(*) AS n
FROM features_master
GROUP BY bucket ORDER BY bucket;

.quit
```

### PostgreSQL / MySQL
Use the same SQL queries above in `psql` or any GUI tool (DBeaver, TablePlus, etc.).

---

## 12. Troubleshooting

### "No module named 'src'"
You must run all commands from inside the `ppg_glucose/` directory:
```bash
cd /home/user/ppg_pipeline/ppg_glucose
python run_pipeline.py --demo
```

### "FileNotFoundError: No master table found"
Stages B, C, D read outputs from prior stages. Run in order:
```bash
python run_pipeline.py --stages A B C D   # or just: python run_pipeline.py
```

### "venv\Scripts\activate: command not found"
You're on Linux — use:
```bash
source venv/bin/activate     # Linux / macOS
# NOT: venv\Scripts\activate  (that's Windows only)
```

### Out of memory during Stage B (EMD feature extraction)
The EMD step is the most memory-intensive. If you hit OOM:
- Reduce `max_imfs` in `configs/vitaldb.yaml` from 7 to 5
- Or run on a machine with ≥ 8 GB RAM

### Stage D is very slow
Stage D trains 21 models with 5-fold cross-validation. Expected times:
- Demo (3 subjects): ~2–4 min
- Full (20 subjects): ~15–30 min

If still slow, check CPU count: `nproc`. Models use all cores automatically.

### SQLAlchemy connection error
Test the DB connection separately:
```bash
python3 -c "
from sqlalchemy import create_engine, text
engine = create_engine('YOUR_DB_URL')
with engine.connect() as conn:
    print('Connected:', conn.execute(text('SELECT 1')).scalar())
"
```

### Demo results overwrite full results
Demo outputs go to `outputs/demo/` automatically — they will never overwrite `outputs/`.

---

## Quick Reference Card

```bash
# ── One-time setup ─────────────────────────────────────────────
cd ppg_glucose/
python3 -m venv venv && source venv/bin/activate
pip install -r requirements_server.txt

# ── Demo run (5-15 min, no SQL) ────────────────────────────────
python run_pipeline.py --demo

# ── Demo run + SQLite ──────────────────────────────────────────
python run_pipeline.py --demo --db-url "sqlite:///demo_results.db"

# ── Full run in background + PostgreSQL ────────────────────────
mkdir -p logs
nohup python run_pipeline.py \
  --db-url "postgresql://ppg_user:pass@localhost:5432/ppg_db" \
  > logs/run.log 2>&1 &

# ── Monitor ────────────────────────────────────────────────────
tail -f logs/run.log

# ── Query results ──────────────────────────────────────────────
sqlite3 demo_results.db \
  "SELECT model_name, mae, r2 FROM model_results WHERE task='regression' ORDER BY mae;"
```
