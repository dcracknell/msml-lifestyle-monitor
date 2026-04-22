const path = require('path');
const { spawn } = require('child_process');
const fsSync = require('fs');
const Database = require('better-sqlite3');
const express = require('express');
const { authenticate } = require('../services/session-store');
const { resolvePythonRuntime } = require('../utils/resolve-python-runtime');

const router = express.Router();

const PPG_DIR = path.resolve(__dirname, '..', '..', 'ppg_glucose');
const PIPELINE_DB_PATH = path.join(PPG_DIR, 'outputs', 'pipeline_results.db');
const FULL_DATA_CASES_PATH = path.join(PPG_DIR, 'data', 'vitaldb', 'final_cases.csv');
const FULL_DATA_PPG_DIR = path.join(PPG_DIR, 'data', 'vitaldb', 'ppg');
const LOCAL_VENV_PYTHON = path.join(PPG_DIR, '.venv', 'bin', 'python');
const LOCAL_VENV_WINDOWS_PYTHON = path.join(PPG_DIR, '.venv', 'Scripts', 'python.exe');
const PPG_PYTHON_BIN = resolvePythonRuntime({
  envOverride: process.env.PPG_MODEL_PYTHON_BIN || process.env.PPG_PYTHON_BIN,
  localVenvPython: LOCAL_VENV_PYTHON,
  localVenvWindowsPython: LOCAL_VENV_WINDOWS_PYTHON,
  existsSync: fsSync.existsSync,
});
const MAX_LOG_TAIL_CHARS = 4000;
const MAX_ERROR_CHARS = 600;

let activeProcess = null;
let lastRunStatus = null; // { status, runId, isDemo, startedAt, error }

function appendLogTail(current, chunk) {
  const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk ?? '');
  if (!text) {
    return current;
  }

  const combined = `${current}${text}`;
  if (combined.length <= MAX_LOG_TAIL_CHARS) {
    return combined;
  }
  return combined.slice(-MAX_LOG_TAIL_CHARS);
}

function formatProcessError(code, stderrTail, stdoutTail) {
  const detail = (stderrTail || stdoutTail || '').replace(/\s+/g, ' ').trim();
  if (!detail) {
    return `Process exited with code ${code}`;
  }

  const compactDetail =
    detail.length > MAX_ERROR_CHARS ? `${detail.slice(0, MAX_ERROR_CHARS - 1)}…` : detail;
  return `Process exited with code ${code}: ${compactDetail}`;
}

function getFullDatasetStatus() {
  try {
    const rawCases = fsSync.readFileSync(FULL_DATA_CASES_PATH, 'utf8');
    const expectedCaseIds = rawCases
      .split(/\r?\n/)
      .slice(1)
      .map((line) => Number.parseInt(String(line).split(',')[0], 10))
      .filter(Number.isFinite);

    if (!expectedCaseIds.length) {
      return {
        ready: false,
        availableCount: 0,
        expectedCount: 0,
        missingCaseIds: [],
        message: 'Full dataset unavailable: no case manifest was found.',
      };
    }

    const missingCaseIds = expectedCaseIds.filter(
      (caseId) => !fsSync.existsSync(path.join(FULL_DATA_PPG_DIR, `${caseId}.npy`))
    );
    const availableCount = expectedCaseIds.length - missingCaseIds.length;

    if (missingCaseIds.length === 0) {
      return {
        ready: true,
        availableCount,
        expectedCount: expectedCaseIds.length,
        missingCaseIds: [],
        message: 'Full dataset ready.',
      };
    }

    const preview = missingCaseIds.slice(0, 5).join(', ');
    const suffix =
      missingCaseIds.length > 5 ? `, +${missingCaseIds.length - 5} more` : '';
    return {
      ready: false,
      availableCount,
      expectedCount: expectedCaseIds.length,
      missingCaseIds,
      message:
        `Full dataset unavailable: found ${availableCount}/${expectedCaseIds.length} PPG files.` +
        ` Missing case IDs: ${preview}${suffix}.`,
    };
  } catch {
    return {
      ready: false,
      availableCount: 0,
      expectedCount: 0,
      missingCaseIds: [],
      message: 'Full dataset unavailable: required VitalDB files are missing.',
    };
  }
}

function openPipelineDb() {
  try {
    return new Database(PIPELINE_DB_PATH, { readonly: true });
  } catch {
    return null;
  }
}

function getLatestRun(db) {
  try {
    return db
      .prepare(
        `SELECT run_id, is_demo, n_subjects, status, error_message,
                started_at, completed_at, elapsed_seconds
           FROM pipeline_runs
          ORDER BY started_at DESC
          LIMIT 1`
      )
      .get();
  } catch {
    return null;
  }
}

function getModelResults(db, runId) {
  try {
    return db
      .prepare(
        `SELECT task, model_name, mae, rmse, r2, zone_a_pct, zone_ab_pct,
                accuracy, precision_hyper, recall_hyper, f1_hyper, auroc,
                macro_f1, weighted_f1, off_by_one_acc
           FROM model_results
          WHERE run_id = ?
          ORDER BY task, CASE WHEN mae IS NULL THEN 1 ELSE 0 END, mae ASC`
      )
      .all(runId);
  } catch {
    return [];
  }
}

function getGlucoseSamples(db, runId) {
  try {
    return db
      .prepare(
        `SELECT sid, glucose_time_sec, glucose_mgdl
           FROM features_master
          WHERE run_id = ?
          ORDER BY sid, glucose_time_sec
          LIMIT 300`
      )
      .all(runId);
  } catch {
    return [];
  }
}

function spawnPipeline(isDemo) {
  if (activeProcess) return false;

  const args = ['run_pipeline.py', '--db-url', `sqlite:///${PIPELINE_DB_PATH}`];
  if (isDemo) {
    args.push('--demo');
    args.push('--protocol', 'loso'); // 3 subjects → can't do 5-fold; loso works with any N
  }

  const proc = spawn(PPG_PYTHON_BIN, args, {
    cwd: PPG_DIR,
    stdio: 'pipe',
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
  });
  let stdoutTail = '';
  let stderrTail = '';

  activeProcess = proc;
  lastRunStatus = {
    status: 'running',
    isDemo,
    startedAt: new Date().toISOString(),
    error: null,
  };

  proc.stdout?.on('data', (chunk) => {
    stdoutTail = appendLogTail(stdoutTail, chunk);
  });

  proc.stderr?.on('data', (chunk) => {
    stderrTail = appendLogTail(stderrTail, chunk);
  });

  proc.on('close', (code) => {
    activeProcess = null;
    if (lastRunStatus) {
      lastRunStatus.status = code === 0 ? 'completed' : 'failed';
      if (code !== 0) {
        lastRunStatus.error = formatProcessError(code, stderrTail, stdoutTail);
      }
    }
  });

  proc.on('error', (err) => {
    activeProcess = null;
    if (lastRunStatus) {
      lastRunStatus.status = 'failed';
      lastRunStatus.error = err.message;
    }
  });

  return true;
}

// POST /api/ppg/run  (body: { demo: true|false })
router.post('/run', authenticate, (req, res) => {
  if (activeProcess) {
    return res.status(409).json({ message: 'Pipeline already running.' });
  }
  const isDemo = req.body?.demo === true;
  const dataset = getFullDatasetStatus();
  if (!isDemo && !dataset.ready) {
    return res.status(400).json({ message: dataset.message, dataset });
  }
  const started = spawnPipeline(isDemo);
  if (!started) {
    return res.status(409).json({ message: 'Pipeline already running.' });
  }
  return res.json({ message: 'Pipeline started.', isDemo });
});

// GET /api/ppg/status
router.get('/status', authenticate, (req, res) => {
  const running = !!activeProcess;
  const dataset = getFullDatasetStatus();

  // Merge in-memory status with last DB run
  const db = openPipelineDb();
  let dbRun = null;
  if (db) {
    dbRun = getLatestRun(db);
    db.close();
  }

  return res.json({
    running,
    inMemory: lastRunStatus,
    latestRun: dbRun || null,
    dataset,
  });
});

// GET /api/ppg/results
router.get('/results', authenticate, (req, res) => {
  const db = openPipelineDb();
  if (!db) {
    return res.json({ run: null, models: [], glucoseSamples: [] });
  }

  const run = getLatestRun(db);
  if (!run) {
    db.close();
    return res.json({ run: null, models: [], glucoseSamples: [] });
  }

  const models = getModelResults(db, run.run_id);
  const glucoseSamples = getGlucoseSamples(db, run.run_id);
  db.close();

  return res.json({ run, models, glucoseSamples });
});

module.exports = router;
