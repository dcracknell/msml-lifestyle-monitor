const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const fsSync = require('fs');
const express = require('express');
const db = require('../db');
const { authenticate } = require('../services/session-store');
const { coerceRole, isHeadCoach } = require('../utils/role');
const { resolvePythonRuntime } = require('../utils/resolve-python-runtime');

const router = express.Router();

const PPG_DIR = path.resolve(__dirname, '..', '..', 'ppg_glucose');
const MODEL_DIR = path.join(PPG_DIR, 'models', 'bgl_catboost_current_ppg_demo_no_preop');
const DEMO_SIGNAL_PATH = path.join(PPG_DIR, 'examples', 'bgl', 'demo.signal.npy');
const DEMO_DEMOGRAPHICS_PATH = path.join(PPG_DIR, 'examples', 'bgl', 'demo.example.json');
const LOCAL_VENV_PYTHON = path.join(PPG_DIR, '.venv', 'bin', 'python');
const LOCAL_VENV_WINDOWS_PYTHON = path.join(PPG_DIR, '.venv', 'Scripts', 'python.exe');
const SIGNAL_METRIC = (process.env.PPG_BGL_SIGNAL_METRIC || 'ppg.raw').trim() || 'ppg.raw';
const DEFAULT_FS_HZ = Math.max(1, parseInt(process.env.PPG_BGL_FS_HZ || '500', 10));
const DEFAULT_WINDOW_SECONDS = Math.max(
  1,
  parseInt(process.env.PPG_BGL_WINDOW_SECONDS || '900', 10)
);
const WINDOW_SAMPLE_COUNT = DEFAULT_FS_HZ * DEFAULT_WINDOW_SECONDS;
const WINDOW_SPAN_TOLERANCE_MS = Math.max(
  1000,
  parseInt(process.env.PPG_BGL_WINDOW_TOLERANCE_MS || '30000', 10)
);
const MAX_LOG_TAIL_CHARS = 4000;
const MAX_ERROR_CHARS = 600;
const RUNTIME_CHECK_TIMEOUT_MS = 10000;
const REQUIRED_MODEL_FILES = [
  'catboost_model.cbm',
  'final_features.txt',
  'model_metadata.json',
  'training_schema.json',
];
const REQUIRED_PYTHON_MODULES = [
  'numpy',
  'pandas',
  'scipy',
  'sklearn',
  'PyEMD',
  'catboost',
  'dotmap',
  'yaml',
  'pyPPG',
];
const CSV_PREVIEW_MAX_POINTS = 900;
const MIN_CSV_SIGNAL_SECONDS = 30;

const subjectStatement = db.prepare(
  `SELECT id,
          name,
          email,
          role,
          avatar_url,
          avatar_photo,
          weight_category,
          goal_steps,
          goal_calories,
          goal_sleep,
          goal_readiness,
          age,
          sex,
          bmi,
          preop_dm,
          preop_hb,
          preop_cr
     FROM users
    WHERE id = ?`
);

const accessStatement = db.prepare(
  `SELECT 1
     FROM coach_athlete_links
    WHERE coach_id = ?
      AND athlete_id = ?`
);

const latestSignalWindowStatusStatement = db.prepare(
  `SELECT COUNT(*) AS count,
          MIN(ts) AS minTs,
          MAX(ts) AS maxTs
     FROM (
       SELECT ts
         FROM sensor_stream_samples
        WHERE user_id = ?
          AND metric = ?
        ORDER BY ts DESC
        LIMIT ?
     ) recent`
);

const latestSignalSamplesStatement = db.prepare(
  `SELECT ts, value
     FROM sensor_stream_samples
    WHERE user_id = ?
      AND metric = ?
    ORDER BY ts DESC
    LIMIT ?`
);

const insertRunStatement = db.prepare(
  `INSERT INTO bgl_inference_runs (
      user_id,
      requested_by_user_id,
      mode,
      status,
      signal_metric,
      signal_started_at,
      signal_ended_at,
      signal_sample_count,
      signal_duration_ms,
      fs_hz,
      strict_length
    ) VALUES (?, ?, ?, 'running', ?, ?, ?, ?, ?, ?, ?)`
);

const completeRunStatement = db.prepare(
  `UPDATE bgl_inference_runs
      SET status = 'completed',
          model_name = ?,
          model_version = ?,
          label = ?,
          prob_low = ?,
          prob_elevated = ?,
          prob_hyper = ?,
          mean_sqi = ?,
          min_sqi = ?,
          n_subwindows_attempted = ?,
          n_subwindows_used = ?,
          warnings_json = ?,
          result_json = ?,
          error_message = NULL,
          completed_at = CURRENT_TIMESTAMP
    WHERE id = ?`
);

const failRunStatement = db.prepare(
  `UPDATE bgl_inference_runs
      SET status = 'failed',
          model_name = COALESCE(?, model_name),
          model_version = COALESCE(?, model_version),
          warnings_json = ?,
          result_json = ?,
          error_message = ?,
          completed_at = CURRENT_TIMESTAMP
    WHERE id = ?`
);

const latestRunByUserStatement = db.prepare(
  `SELECT id,
          user_id AS userId,
          requested_by_user_id AS requestedByUserId,
          mode,
          status,
          signal_metric AS signalMetric,
          signal_started_at AS signalStartedAt,
          signal_ended_at AS signalEndedAt,
          signal_sample_count AS signalSampleCount,
          signal_duration_ms AS signalDurationMs,
          fs_hz AS fsHz,
          strict_length AS strictLength,
          model_name AS modelName,
          model_version AS modelVersion,
          label,
          prob_low AS probLow,
          prob_elevated AS probElevated,
          prob_hyper AS probHyper,
          mean_sqi AS meanSqi,
          min_sqi AS minSqi,
          n_subwindows_attempted AS nSubwindowsAttempted,
          n_subwindows_used AS nSubwindowsUsed,
          error_message AS errorMessage,
          warnings_json AS warningsJson,
          result_json AS resultJson,
          started_at AS startedAt,
          completed_at AS completedAt,
          created_at AS createdAt
     FROM bgl_inference_runs
    WHERE user_id = ?
    ORDER BY id DESC
    LIMIT 1`
);

let activeProcess = null;
let activeRunState = null;

function hasNumericValue(value) {
  return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
}

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

function createRunDirectory() {
  return fsSync.mkdtempSync(path.join(os.tmpdir(), 'msml-bgl-'));
}

function cleanupRunDirectory(runDir) {
  if (!runDir) {
    return;
  }

  try {
    fsSync.rmSync(runDir, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup only.
  }
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fsSync.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function writeJson(filePath, value) {
  fsSync.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function writeFloat32Npy(filePath, values) {
  const length = values.length;
  const dict = `{'descr': '<f4', 'fortran_order': False, 'shape': (${length},), }`;
  const preambleLength = 10;
  const paddingLength = (16 - ((preambleLength + Buffer.byteLength(dict, 'ascii') + 1) % 16)) % 16;
  const header = `${dict}${' '.repeat(paddingLength)}\n`;
  const headerBuffer = Buffer.from(header, 'ascii');
  const magicBuffer = Buffer.from([0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59, 0x01, 0x00]);
  const headerLengthBuffer = Buffer.alloc(2);
  headerLengthBuffer.writeUInt16LE(headerBuffer.length, 0);

  const dataBuffer = Buffer.alloc(length * 4);
  for (let index = 0; index < length; index += 1) {
    dataBuffer.writeFloatLE(values[index], index * 4);
  }

  fsSync.writeFileSync(
    filePath,
    Buffer.concat([magicBuffer, headerLengthBuffer, headerBuffer, dataBuffer])
  );
}

function resolvePpgPythonBin() {
  return resolvePythonRuntime({
    envOverride: process.env.PPG_MODEL_PYTHON_BIN || process.env.PPG_PYTHON_BIN,
    localVenvPython: LOCAL_VENV_PYTHON,
    localVenvWindowsPython: LOCAL_VENV_WINDOWS_PYTHON,
    existsSync: fsSync.existsSync,
  });
}

function getPpgRuntimeStatus() {
  const pythonBin = resolvePpgPythonBin();
  const moduleList = JSON.stringify(REQUIRED_PYTHON_MODULES);
  const probeScript = `
import importlib.util
import json
import sys

required = ${moduleList}
missing = [name for name in required if importlib.util.find_spec(name) is None]
print(json.dumps({"missing": missing}))
sys.exit(0 if not missing else 1)
`.trim();

  const probe = spawnSync(pythonBin, ['-c', probeScript], {
    cwd: PPG_DIR,
    encoding: 'utf8',
    timeout: RUNTIME_CHECK_TIMEOUT_MS,
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
  });

  if (probe.error) {
    return {
      ready: false,
      pythonBin,
      missingModules: [],
      message:
        `BGL inference Python runtime '${pythonBin}' is unavailable: ${probe.error.message}. ` +
        "Run 'npm run setup:ppg-model' in lifestyle-web/server or set " +
        "'PPG_MODEL_PYTHON_BIN' to a Python environment with " +
        "'ppg_glucose/requirements_server.txt' installed.",
    };
  }

  let missingModules = [];
  try {
    missingModules = JSON.parse(probe.stdout || '{}').missing || [];
  } catch {
    missingModules = [];
  }

  if (probe.status !== 0 || missingModules.length) {
    const missingDetail = missingModules.length
      ? ` Missing modules: ${missingModules.join(', ')}.`
      : '';
    return {
      ready: false,
      pythonBin,
      missingModules,
      message:
        `BGL inference Python runtime '${pythonBin}' is not ready.${missingDetail} ` +
        "Run 'npm run setup:ppg-model' in lifestyle-web/server or set " +
        "'PPG_MODEL_PYTHON_BIN' to a Python environment with " +
        "'ppg_glucose/requirements_server.txt' installed.",
    };
  }

  return {
    ready: true,
    pythonBin,
    missingModules: [],
    message: `BGL inference Python runtime '${pythonBin}' is ready.`,
  };
}

function getModelBundleStatus() {
  const missingFiles = REQUIRED_MODEL_FILES.filter(
    (fileName) => !fsSync.existsSync(path.join(MODEL_DIR, fileName))
  );

  if (missingFiles.length) {
    return {
      ready: false,
      modelDir: MODEL_DIR,
      missingFiles,
      message: `BGL model bundle is incomplete. Missing file(s): ${missingFiles.join(', ')}.`,
    };
  }

  return {
    ready: true,
    modelDir: MODEL_DIR,
    missingFiles: [],
    message: 'BGL model bundle is ready.',
  };
}

function getDemoInputStatus() {
  const missing = [];
  if (!fsSync.existsSync(DEMO_SIGNAL_PATH)) {
    missing.push(path.relative(PPG_DIR, DEMO_SIGNAL_PATH));
  }
  if (!fsSync.existsSync(DEMO_DEMOGRAPHICS_PATH)) {
    missing.push(path.relative(PPG_DIR, DEMO_DEMOGRAPHICS_PATH));
  }

  if (missing.length) {
    return {
      ready: false,
      signalPath: DEMO_SIGNAL_PATH,
      demographicsPath: DEMO_DEMOGRAPHICS_PATH,
      message: `Bundled demo input is missing: ${missing.join(', ')}.`,
    };
  }

  return {
    ready: true,
    signalPath: DEMO_SIGNAL_PATH,
    demographicsPath: DEMO_DEMOGRAPHICS_PATH,
    message: 'Bundled demo input is ready.',
  };
}

function parseRequestedSubjectId(rawValue) {
  const parsed = Number.parseInt(rawValue, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function resolveSubject(req, rawSubjectId) {
  req.user = { ...req.user, role: coerceRole(req.user.role) };
  const viewerId = req.user.id;
  const requestedId = parseRequestedSubjectId(rawSubjectId);
  const subjectId = requestedId || viewerId;

  if (subjectId !== viewerId && !isHeadCoach(req.user.role)) {
    const hasAccess = accessStatement.get(viewerId, subjectId);
    if (!hasAccess) {
      return { error: 'Not authorized to view that athlete.', statusCode: 403 };
    }
  }

  const subject = subjectStatement.get(subjectId);
  if (!subject) {
    return { error: 'Athlete not found.', statusCode: 404 };
  }

  subject.role = coerceRole(subject.role);
  return { subject };
}

function buildProfileStatus(subject) {
  const missingFields = [];
  if (!hasNumericValue(subject?.age)) {
    missingFields.push('age');
  }
  if (!subject?.sex || !String(subject.sex).trim()) {
    missingFields.push('sex');
  }
  if (!hasNumericValue(subject?.bmi)) {
    missingFields.push('bmi');
  }
  if (subject?.preop_dm === null || subject?.preop_dm === undefined || subject?.preop_dm === '') {
    missingFields.push('preop_dm');
  }

  if (missingFields.length) {
    return {
      ready: false,
      missingFields,
      message:
        `BGL profile is incomplete for ${subject?.name || 'this user'}. ` +
        `Add ${missingFields.join(', ')} in Profile before running live inference.`,
    };
  }

  return {
    ready: true,
    missingFields: [],
    message: 'BGL profile is ready.',
  };
}

function buildDemographicsPayload(subject) {
  const demographics = {
    age: Number(subject.age),
    sex: String(subject.sex).trim(),
    bmi: Number(subject.bmi),
    preop_dm: Boolean(Number(subject.preop_dm)),
  };

  if (hasNumericValue(subject.preop_hb)) {
    demographics.preop_hb = Number(subject.preop_hb);
  }
  if (hasNumericValue(subject.preop_cr)) {
    demographics.preop_cr = Number(subject.preop_cr);
  }

  return demographics;
}

function getLatestSignalWindowStatus(subjectId) {
  const row = latestSignalWindowStatusStatement.get(subjectId, SIGNAL_METRIC, WINDOW_SAMPLE_COUNT);
  const count = Number(row?.count || 0);
  const minTs = Number(row?.minTs);
  const maxTs = Number(row?.maxTs);

  if (count < WINDOW_SAMPLE_COUNT) {
    return {
      ready: false,
      metric: SIGNAL_METRIC,
      sampleCount: count,
      requiredSamples: WINDOW_SAMPLE_COUNT,
      fsHz: DEFAULT_FS_HZ,
      windowSeconds: DEFAULT_WINDOW_SECONDS,
      message:
        `Latest ${SIGNAL_METRIC} window is incomplete. ` +
        `Need ${WINDOW_SAMPLE_COUNT} samples at ${DEFAULT_FS_HZ} Hz; found ${count}.`,
    };
  }

  if (!Number.isFinite(minTs) || !Number.isFinite(maxTs)) {
    return {
      ready: false,
      metric: SIGNAL_METRIC,
      sampleCount: count,
      requiredSamples: WINDOW_SAMPLE_COUNT,
      fsHz: DEFAULT_FS_HZ,
      windowSeconds: DEFAULT_WINDOW_SECONDS,
      message: `Latest ${SIGNAL_METRIC} window timestamps are unavailable.`,
    };
  }

  const spanMs = Math.max(0, maxTs - minTs);
  const expectedSpanMs = Math.round(((WINDOW_SAMPLE_COUNT - 1) / DEFAULT_FS_HZ) * 1000);
  if (Math.abs(spanMs - expectedSpanMs) > WINDOW_SPAN_TOLERANCE_MS) {
    return {
      ready: false,
      metric: SIGNAL_METRIC,
      sampleCount: count,
      requiredSamples: WINDOW_SAMPLE_COUNT,
      fsHz: DEFAULT_FS_HZ,
      windowSeconds: DEFAULT_WINDOW_SECONDS,
      spanMs,
      expectedSpanMs,
      message:
        `Latest ${SIGNAL_METRIC} window spans ${(spanMs / 1000).toFixed(1)}s; ` +
        `expected about ${DEFAULT_WINDOW_SECONDS}s at ${DEFAULT_FS_HZ} Hz.`,
    };
  }

  return {
    ready: true,
    metric: SIGNAL_METRIC,
    sampleCount: count,
    requiredSamples: WINDOW_SAMPLE_COUNT,
    fsHz: DEFAULT_FS_HZ,
    windowSeconds: DEFAULT_WINDOW_SECONDS,
    spanMs,
    expectedSpanMs,
    message: `Latest ${SIGNAL_METRIC} window is ready.`,
  };
}

function loadLatestSignalWindow(subjectId) {
  const status = getLatestSignalWindowStatus(subjectId);
  if (!status.ready) {
    return { error: status.message, statusCode: 400 };
  }

  const rows = latestSignalSamplesStatement.all(subjectId, SIGNAL_METRIC, WINDOW_SAMPLE_COUNT);
  if (!Array.isArray(rows) || rows.length !== WINDOW_SAMPLE_COUNT) {
    return {
      error:
        `Latest ${SIGNAL_METRIC} window could not be assembled. ` +
        `Expected ${WINDOW_SAMPLE_COUNT} samples and found ${rows?.length || 0}.`,
      statusCode: 400,
    };
  }

  const ascending = [...rows].reverse();
  const samples = new Float32Array(WINDOW_SAMPLE_COUNT);

  for (let index = 0; index < ascending.length; index += 1) {
    const numeric = Number(ascending[index]?.value);
    if (!Number.isFinite(numeric)) {
      return {
        error: `Latest ${SIGNAL_METRIC} window contains a non-numeric sample.`,
        statusCode: 400,
      };
    }
    samples[index] = numeric;
  }

  const startedAtMs = Number(ascending[0]?.ts);
  const endedAtMs = Number(ascending[ascending.length - 1]?.ts);

  return {
    samples,
    signalMetric: SIGNAL_METRIC,
    signalSampleCount: ascending.length,
    signalDurationMs: Math.max(0, endedAtMs - startedAtMs),
    signalStartedAt: Number.isFinite(startedAtMs) ? new Date(startedAtMs).toISOString() : null,
    signalEndedAt: Number.isFinite(endedAtMs) ? new Date(endedAtMs).toISOString() : null,
  };
}

function summarisePrediction(payload) {
  const probabilities = payload?.prediction?.probabilities || {};
  const topProbability = Math.max(
    0,
    ...Object.values(probabilities)
      .map((value) => Number(value))
      .filter(Number.isFinite)
  );

  return {
    label: payload?.prediction?.label || null,
    confidence: topProbability,
    modelName: payload?.model_name || null,
    meanSqi: Number.isFinite(payload?.quality?.mean_sqi) ? payload.quality.mean_sqi : null,
    usedSubwindows: Number.isFinite(payload?.quality?.n_subwindows_used)
      ? payload.quality.n_subwindows_used
      : null,
    attemptedSubwindows: Number.isFinite(payload?.quality?.n_subwindows_attempted)
      ? payload.quality.n_subwindows_attempted
      : null,
  };
}

function serializeRunRow(row) {
  if (!row) {
    return null;
  }

  const startedAtMs = row.startedAt ? Date.parse(row.startedAt) : NaN;
  const completedAtMs = row.completedAt ? Date.parse(row.completedAt) : NaN;
  const probabilities = [row.probLow, row.probElevated, row.probHyper]
    .map((value) => Number(value))
    .filter(Number.isFinite);
  const confidence = probabilities.length ? Math.max(...probabilities) : null;

  return {
    id: row.id,
    userId: row.userId,
    requestedByUserId: row.requestedByUserId,
    mode: row.mode,
    isDemo: row.mode === 'demo',
    status: row.status,
    startedAt: row.startedAt || row.createdAt || null,
    completedAt: row.completedAt || null,
    elapsedSeconds:
      Number.isFinite(startedAtMs) && Number.isFinite(completedAtMs)
        ? Math.max(0, (completedAtMs - startedAtMs) / 1000)
        : null,
    error: row.errorMessage || null,
    request: {
      signalMetric: row.signalMetric || null,
      signalSampleCount: Number.isFinite(Number(row.signalSampleCount))
        ? Number(row.signalSampleCount)
        : null,
      signalStartedAt: row.signalStartedAt || null,
      signalEndedAt: row.signalEndedAt || null,
      signalDurationMs: Number.isFinite(Number(row.signalDurationMs))
        ? Number(row.signalDurationMs)
        : null,
      fsHz: Number.isFinite(Number(row.fsHz)) ? Number(row.fsHz) : null,
      strictLength: Boolean(row.strictLength),
    },
    resultSummary: {
      label: row.label || null,
      confidence,
      modelName: row.modelName || null,
      meanSqi: Number.isFinite(Number(row.meanSqi)) ? Number(row.meanSqi) : null,
      usedSubwindows: Number.isFinite(Number(row.nSubwindowsUsed))
        ? Number(row.nSubwindowsUsed)
        : null,
      attemptedSubwindows: Number.isFinite(Number(row.nSubwindowsAttempted))
        ? Number(row.nSubwindowsAttempted)
        : null,
    },
  };
}

function extractPredictionPayload(row) {
  if (!row?.resultJson) {
    return null;
  }
  try {
    const payload = JSON.parse(row.resultJson);
    return payload && !payload.error ? payload : null;
  } catch {
    return null;
  }
}

function prepareDemoRunConfig() {
  const demoInput = getDemoInputStatus();
  if (!demoInput.ready) {
    return { error: demoInput.message, statusCode: 500 };
  }

  const runDir = createRunDirectory();
  return {
    mode: 'demo',
    signalPath: demoInput.signalPath,
    demographicsPath: demoInput.demographicsPath,
    outputPath: path.join(runDir, 'prediction.json'),
    runDir,
    fsHz: DEFAULT_FS_HZ,
    strictLength: false,
    signalMetric: 'demo.signal',
    signalSampleCount: null,
    signalDurationMs: null,
    signalStartedAt: null,
    signalEndedAt: null,
  };
}

function normalizeUploadName(value, fallback = 'upload.csv') {
  const normalized = String(value || '').trim();
  return normalized || fallback;
}

function sanitizeCsvText(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} is empty.`);
  }
  return value.replace(/^\uFEFF/, '').trim();
}

function parseCsvTable(text, label) {
  const cleaned = sanitizeCsvText(text, label);
  const lines = cleaned
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    throw new Error(`${label} must include a header row and at least one data row.`);
  }

  const headers = lines[0].split(',').map((value) => value.trim());
  const rows = lines.slice(1).map((line) => {
    const cells = line.split(',').map((value) => value.trim());
    const row = {};
    headers.forEach((header, index) => {
      row[header] = cells[index] ?? '';
    });
    return row;
  });

  return { headers, rows };
}

function findCsvColumn(headers = [], candidates = []) {
  const normalizedHeaders = headers.map((value) => String(value || '').trim().toLowerCase());
  for (const candidate of candidates) {
    const index = normalizedHeaders.indexOf(candidate);
    if (index >= 0) {
      return headers[index];
    }
  }
  return null;
}

function toFiniteNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function inferFsHzFromTimes(timesSec = []) {
  const deltas = [];
  for (let index = 1; index < timesSec.length; index += 1) {
    const delta = Number(timesSec[index]) - Number(timesSec[index - 1]);
    if (Number.isFinite(delta) && delta > 0) {
      deltas.push(delta);
    }
  }
  if (!deltas.length) {
    return null;
  }
  const sorted = [...deltas].sort((left, right) => left - right);
  const median = sorted[Math.floor(sorted.length / 2)];
  if (!Number.isFinite(median) || median <= 0) {
    return null;
  }
  return Math.max(1, Math.round(1 / median));
}

function downsampleSeries(timesSec = [], values = [], limit = CSV_PREVIEW_MAX_POINTS) {
  if (!Array.isArray(timesSec) || !Array.isArray(values) || !timesSec.length || !values.length) {
    return null;
  }

  if (timesSec.length <= limit) {
    return {
      timesSec: timesSec.map((value) => Math.round(Number(value) * 1000) / 1000),
      values: values.map((value) => Math.round(Number(value) * 1000000) / 1000000),
    };
  }

  const sampledTimes = [];
  const sampledValues = [];
  const lastIndex = timesSec.length - 1;
  for (let index = 0; index < limit; index += 1) {
    const sourceIndex = Math.round((index / (limit - 1)) * lastIndex);
    sampledTimes.push(Math.round(Number(timesSec[sourceIndex]) * 1000) / 1000);
    sampledValues.push(Math.round(Number(values[sourceIndex]) * 1000000) / 1000000);
  }

  return {
    timesSec: sampledTimes,
    values: sampledValues,
  };
}

function parseSignalCsvSource(csvSignalText, csvSignalName) {
  const fileName = normalizeUploadName(csvSignalName, 'signal.csv');
  const { headers, rows } = parseCsvTable(csvSignalText, `${fileName} (signal CSV)`);
  const timeColumn = findCsvColumn(headers, ['time_s', 'time_sec', 'seconds', 'elapsed_s', 'elapsed_seconds', 'time']);
  const signalColumn = findCsvColumn(headers, ['synthetic_ppg', 'ppg', 'ppg_raw', 'ppg_value', 'signal', 'value', 'raw']);
  const embeddedHeartRateColumn = findCsvColumn(headers, ['heart_rate_bpm_interpolated', 'heart_rate_bpm', 'heart_rate', 'hr', 'bpm']);

  if (!timeColumn) {
    throw new Error(`${fileName} must include a time_s column so sample timing can be inferred.`);
  }
  if (!signalColumn) {
    throw new Error(`${fileName} must include a PPG column such as synthetic_ppg or ppg.`);
  }

  const parsed = rows
    .map((row) => ({
      timeSec: toFiniteNumber(row[timeColumn]),
      signalValue: toFiniteNumber(row[signalColumn]),
      heartRateValue: embeddedHeartRateColumn ? toFiniteNumber(row[embeddedHeartRateColumn]) : null,
    }))
    .filter((row) => Number.isFinite(row.timeSec) && Number.isFinite(row.signalValue))
    .sort((left, right) => left.timeSec - right.timeSec);

  if (!parsed.length) {
    throw new Error(`${fileName} did not contain any numeric PPG samples.`);
  }

  const baseTimeSec = parsed[0].timeSec;
  const timesSec = parsed.map((row) => Math.max(0, row.timeSec - baseTimeSec));
  const signalValues = parsed.map((row) => row.signalValue);
  const fsHz = inferFsHzFromTimes(timesSec);

  if (!Number.isFinite(fsHz) || fsHz < 1) {
    throw new Error(`Could not infer a usable sample rate from ${fileName}.`);
  }

  let embeddedHeartRate = null;
  if (embeddedHeartRateColumn) {
    const heartRateRows = parsed.filter((row) => Number.isFinite(row.heartRateValue));
    if (heartRateRows.length) {
      embeddedHeartRate = {
        fileName,
        ...downsampleSeries(
          heartRateRows.map((row) => Math.max(0, row.timeSec - baseTimeSec)),
          heartRateRows.map((row) => row.heartRateValue)
        ),
      };
    }
  }

  return {
    fileName,
    fsHz,
    timesSec,
    signalValues,
    embeddedHeartRate,
  };
}

function parseOptionalHeartRateCsv(csvHeartRateText, csvHeartRateName) {
  if (typeof csvHeartRateText !== 'string' || !csvHeartRateText.trim()) {
    return null;
  }

  const fileName = normalizeUploadName(csvHeartRateName, 'heart-rate.csv');
  const { headers, rows } = parseCsvTable(csvHeartRateText, `${fileName} (heart-rate CSV)`);
  const timeColumn = findCsvColumn(headers, ['time_s', 'time_sec', 'seconds', 'elapsed_s', 'elapsed_seconds', 'time']);
  const heartRateColumn = findCsvColumn(headers, ['heart_rate_bpm', 'heart_rate_bpm_interpolated', 'heart_rate', 'hr', 'bpm']);

  if (!timeColumn || !heartRateColumn) {
    return null;
  }

  const parsed = rows
    .map((row) => ({
      timeSec: toFiniteNumber(row[timeColumn]),
      value: toFiniteNumber(row[heartRateColumn]),
    }))
    .filter((row) => Number.isFinite(row.timeSec) && Number.isFinite(row.value))
    .sort((left, right) => left.timeSec - right.timeSec);

  if (!parsed.length) {
    return null;
  }

  const baseTimeSec = parsed[0].timeSec;
  return {
    fileName,
    ...downsampleSeries(
      parsed.map((row) => Math.max(0, row.timeSec - baseTimeSec)),
      parsed.map((row) => row.value)
    ),
  };
}

function parseOptionalRrSummary(csvRrText, csvRrName) {
  if (typeof csvRrText !== 'string' || !csvRrText.trim()) {
    return { fileName: normalizeUploadName(csvRrName, 'rr.csv'), sampleCount: 0, meanMs: null };
  }

  const fileName = normalizeUploadName(csvRrName, 'rr.csv');
  const { headers, rows } = parseCsvTable(csvRrText, `${fileName} (RR CSV)`);
  const rrColumn = findCsvColumn(headers, ['rr_interval_ms', 'rr_ms', 'rr_interval', 'rr']);
  if (!rrColumn) {
    return { fileName, sampleCount: 0, meanMs: null };
  }

  const values = rows
    .map((row) => toFiniteNumber(row[rrColumn]))
    .filter((value) => Number.isFinite(value));
  if (!values.length) {
    return { fileName, sampleCount: 0, meanMs: null };
  }

  const sum = values.reduce((total, value) => total + value, 0);
  return {
    fileName,
    sampleCount: values.length,
    meanMs: Math.round((sum / values.length) * 100) / 100,
  };
}

function prepareCsvRunConfig(subject, input = {}) {
  const profileStatus = buildProfileStatus(subject);
  if (!profileStatus.ready) {
    return { error: profileStatus.message, statusCode: 400 };
  }

  let signalSource;
  try {
    signalSource = parseSignalCsvSource(input.csvSignalText, input.csvSignalName);
  } catch (error) {
    return { error: error.message || 'Unable to parse the PPG signal CSV.', statusCode: 400 };
  }

  const minRequiredSamples = Math.max(1, Math.ceil(signalSource.fsHz * MIN_CSV_SIGNAL_SECONDS));
  const fullDurationSeconds = signalSource.signalValues.length / signalSource.fsHz;
  if (signalSource.signalValues.length < minRequiredSamples) {
    return {
      error: `${signalSource.fileName} must contain at least ${MIN_CSV_SIGNAL_SECONDS} seconds of PPG data.`,
      statusCode: 400,
    };
  }

  const targetWindowSeconds = Math.max(DEFAULT_WINDOW_SECONDS, MIN_CSV_SIGNAL_SECONDS);
  const desiredSampleCount = Math.max(
    minRequiredSamples,
    Math.round(signalSource.fsHz * targetWindowSeconds)
  );
  const useStrictLength = signalSource.signalValues.length >= desiredSampleCount;
  const startIndex = useStrictLength
    ? Math.max(0, signalSource.signalValues.length - desiredSampleCount)
    : 0;
  const analysisSignal = signalSource.signalValues.slice(startIndex);
  const analysisStartSec = Number(signalSource.timesSec[startIndex] || 0);
  const analysisEndSec = Number(signalSource.timesSec[signalSource.timesSec.length - 1] || analysisStartSec);
  const analysisDurationSeconds = analysisSignal.length / signalSource.fsHz;

  if (analysisSignal.length < minRequiredSamples || analysisDurationSeconds < MIN_CSV_SIGNAL_SECONDS) {
    return {
      error: `${signalSource.fileName} does not contain a long enough continuous window for inference.`,
      statusCode: 400,
    };
  }

  const heartRatePreview =
    parseOptionalHeartRateCsv(input.csvHeartRateText, input.csvHeartRateName)
    || signalSource.embeddedHeartRate
    || null;
  const rrSummary = parseOptionalRrSummary(input.csvRrText, input.csvRrName);

  const runDir = createRunDirectory();
  const signalPath = path.join(runDir, 'signal.npy');
  const demographicsPath = path.join(runDir, 'demographics.json');
  const outputPath = path.join(runDir, 'prediction.json');

  writeFloat32Npy(signalPath, new Float32Array(analysisSignal));
  writeJson(demographicsPath, buildDemographicsPayload(subject));

  return {
    mode: 'csv',
    signalPath,
    demographicsPath,
    outputPath,
    runDir,
    fsHz: signalSource.fsHz,
    strictLength: useStrictLength,
    signalMetric: 'csv.upload',
    signalSampleCount: analysisSignal.length,
    signalDurationMs: Math.max(0, Math.round(analysisDurationSeconds * 1000)),
    signalStartedAt: null,
    signalEndedAt: null,
    inputPreview: {
      sourceType: 'csv',
      signalFileName: signalSource.fileName,
      heartRateFileName: heartRatePreview?.fileName || null,
      rrFileName: rrSummary.fileName || null,
      sampleRateHz: signalSource.fsHz,
      sampleCount: signalSource.signalValues.length,
      durationSeconds: Math.round(fullDurationSeconds * 1000) / 1000,
      signal: downsampleSeries(signalSource.timesSec, signalSource.signalValues),
      heartRate: heartRatePreview,
      rr: rrSummary,
      window: {
        startSec: Math.round(analysisStartSec * 1000) / 1000,
        endSec: Math.round(analysisEndSec * 1000) / 1000,
        durationSeconds: Math.round(analysisDurationSeconds * 1000) / 1000,
        usedLatestWindow: useStrictLength,
      },
    },
  };
}

function normalizeSignalMetric(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return /^[a-z0-9_.-]{2,64}$/i.test(trimmed) ? trimmed : null;
}

function parseHzParam(value) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n >= 1 && n <= 5000 ? n : null;
}

function getArduinoSignalStatus(subjectId, metric, fsHz) {
  const MIN_SECONDS = 30;          // one full subwindow
  const minSamples = fsHz * MIN_SECONDS;
  const maxLoad = fsHz * DEFAULT_WINDOW_SECONDS;
  const rows = latestSignalSamplesStatement.all(subjectId, metric, maxLoad);
  const count = rows?.length || 0;

  if (count < minSamples) {
    return {
      ready: false,
      metric,
      fsHz,
      sampleCount: count,
      minSamples,
      message:
        `Only ${count} samples of "${metric}" available. ` +
        `Need at least ${minSamples} (${MIN_SECONDS} s at ${fsHz} Hz). ` +
        'Stream a PPG signal from your Arduino to this metric first.',
    };
  }

  const ascending = [...rows].reverse();
  const startTs = Number(ascending[0]?.ts);
  const endTs = Number(ascending[ascending.length - 1]?.ts);
  const durationSeconds = Number.isFinite(startTs) && Number.isFinite(endTs)
    ? Math.round((endTs - startTs) / 1000)
    : null;

  return {
    ready: true,
    metric,
    fsHz,
    sampleCount: count,
    minSamples,
    durationSeconds,
    message:
      `${count} samples of "${metric}" ready` +
      (durationSeconds != null ? ` (~${durationSeconds} s at ${fsHz} Hz)` : '') + '.',
  };
}

function prepareArduinoRunConfig(subject, metric, fsHz) {
  const profileStatus = buildProfileStatus(subject);
  if (!profileStatus.ready) {
    return { error: profileStatus.message, statusCode: 400 };
  }

  const minSamples = fsHz * 30;
  const maxLoad = fsHz * DEFAULT_WINDOW_SECONDS;
  const rows = latestSignalSamplesStatement.all(subject.id, metric, maxLoad);

  if (!rows || rows.length < minSamples) {
    return {
      error:
        `Not enough "${metric}" samples for inference. ` +
        `Need at least ${minSamples} (30 s at ${fsHz} Hz), found ${rows?.length || 0}.`,
      statusCode: 400,
    };
  }

  // rows are DESC (newest first); isolate the most recent continuous segment.
  // A gap > 5× the expected inter-sample interval marks a session boundary.
  const maxGapMs = (1000 / fsHz) * 5;
  let segmentEnd = 0; // index in rows[] where the continuous segment ends (exclusive)
  for (let i = 0; i < rows.length - 1; i++) {
    const gap = Number(rows[i].ts) - Number(rows[i + 1].ts);
    if (gap > maxGapMs) {
      segmentEnd = i + 1;
      break;
    }
  }
  // segmentEnd === 0 means no large gap found — use all rows
  const segmentRows = segmentEnd > 0 ? rows.slice(0, segmentEnd) : rows;

  if (segmentRows.length < minSamples) {
    const segSec = Math.round(segmentRows.length / fsHz);
    return {
      error:
        `Most recent continuous "${metric}" session has only ${segmentRows.length} samples (~${segSec} s). ` +
        `Stream at least 30 s of PPG data without interruption, then run inference.`,
      statusCode: 400,
    };
  }

  const ascending = [...segmentRows].reverse();
  const samples = new Float32Array(ascending.length);
  for (let i = 0; i < ascending.length; i++) {
    const num = Number(ascending[i]?.value);
    if (!Number.isFinite(num)) {
      return { error: `Signal "${metric}" contains a non-numeric sample.`, statusCode: 400 };
    }
    samples[i] = num;
  }

  const startedAtMs = Number(ascending[0]?.ts);
  const endedAtMs = Number(ascending[ascending.length - 1]?.ts);

  const runDir = createRunDirectory();
  const signalPath = path.join(runDir, 'signal.npy');
  const demographicsPath = path.join(runDir, 'demographics.json');
  const outputPath = path.join(runDir, 'prediction.json');

  writeFloat32Npy(signalPath, samples);
  writeJson(demographicsPath, buildDemographicsPayload(subject));

  return {
    mode: 'arduino',
    signalPath,
    demographicsPath,
    outputPath,
    runDir,
    fsHz,
    strictLength: false,
    signalMetric: metric,
    signalSampleCount: ascending.length,
    signalDurationMs: Math.max(0, endedAtMs - startedAtMs),
    signalStartedAt: Number.isFinite(startedAtMs) ? new Date(startedAtMs).toISOString() : null,
    signalEndedAt: Number.isFinite(endedAtMs) ? new Date(endedAtMs).toISOString() : null,
  };
}

function prepareLiveRunConfig(subject) {
  const profileStatus = buildProfileStatus(subject);
  if (!profileStatus.ready) {
    return { error: profileStatus.message, statusCode: 400 };
  }

  const latestWindow = loadLatestSignalWindow(subject.id);
  if (latestWindow.error) {
    return latestWindow;
  }

  const runDir = createRunDirectory();
  const signalPath = path.join(runDir, 'window.npy');
  const demographicsPath = path.join(runDir, 'demographics.json');
  const outputPath = path.join(runDir, 'prediction.json');

  writeFloat32Npy(signalPath, latestWindow.samples);
  writeJson(demographicsPath, buildDemographicsPayload(subject));

  return {
    mode: 'latest',
    signalPath,
    demographicsPath,
    outputPath,
    runDir,
    fsHz: DEFAULT_FS_HZ,
    strictLength: true,
    signalMetric: latestWindow.signalMetric,
    signalSampleCount: latestWindow.signalSampleCount,
    signalDurationMs: latestWindow.signalDurationMs,
    signalStartedAt: latestWindow.signalStartedAt,
    signalEndedAt: latestWindow.signalEndedAt,
  };
}

function spawnInference(runConfig, subject, requestedByUserId) {
  if (activeProcess) {
    return { started: false, statusCode: 409, error: 'BGL inference already running.' };
  }

  const runtime = getPpgRuntimeStatus();
  if (!runtime.ready) {
    return { started: false, statusCode: 500, error: runtime.message };
  }

  const modelBundle = getModelBundleStatus();
  if (!modelBundle.ready) {
    return { started: false, statusCode: 500, error: modelBundle.message };
  }

  const args = [
    '-m',
    'src.inference.predict',
    '--signal',
    runConfig.signalPath,
    '--demographics',
    runConfig.demographicsPath,
    '--output',
    runConfig.outputPath,
    '--model-dir',
    MODEL_DIR,
    '--fs',
    String(runConfig.fsHz),
  ];

  if (!runConfig.strictLength) {
    args.push('--no-strict-length');
  }

  const insertResult = insertRunStatement.run(
    subject.id,
    requestedByUserId,
    runConfig.mode,
    runConfig.signalMetric,
    runConfig.signalStartedAt,
    runConfig.signalEndedAt,
    runConfig.signalSampleCount,
    runConfig.signalDurationMs,
    runConfig.fsHz,
    runConfig.strictLength ? 1 : 0
  );

  const runId = insertResult.lastInsertRowid;
  const proc = spawn(runtime.pythonBin, args, {
    cwd: PPG_DIR,
    stdio: 'pipe',
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
  });

  let stdoutTail = '';
  let stderrTail = '';

  activeProcess = proc;
  activeRunState = {
    id: runId,
    userId: subject.id,
    requestedByUserId,
    mode: runConfig.mode,
    isDemo: runConfig.mode === 'demo',
    status: 'running',
    startedAt: new Date().toISOString(),
    completedAt: null,
    elapsedSeconds: null,
    error: null,
    request: {
      signalMetric: runConfig.signalMetric,
      signalSampleCount: runConfig.signalSampleCount,
      signalStartedAt: runConfig.signalStartedAt,
      signalEndedAt: runConfig.signalEndedAt,
      signalDurationMs: runConfig.signalDurationMs,
      fsHz: runConfig.fsHz,
      strictLength: runConfig.strictLength,
    },
    resultSummary: null,
  };

  proc.stdout?.on('data', (chunk) => {
    stdoutTail = appendLogTail(stdoutTail, chunk);
  });

  proc.stderr?.on('data', (chunk) => {
    stderrTail = appendLogTail(stderrTail, chunk);
  });

  proc.on('close', (code) => {
    activeProcess = null;
    const completedAt = new Date();
    const rawPayload = readJsonFile(runConfig.outputPath);
    const payload = rawPayload && runConfig.inputPreview
      ? { ...rawPayload, input_preview: runConfig.inputPreview }
      : rawPayload;

    if (activeRunState?.id === runId) {
      activeRunState.completedAt = completedAt.toISOString();
      const startedAtMs = activeRunState.startedAt ? Date.parse(activeRunState.startedAt) : NaN;
      activeRunState.elapsedSeconds = Number.isFinite(startedAtMs)
        ? Math.max(0, (completedAt.getTime() - startedAtMs) / 1000)
        : null;
    }

    if (code === 0 && payload && !payload.error) {
      const probabilities = payload?.prediction?.probabilities || {};
      completeRunStatement.run(
        payload?.model_name || null,
        payload?.model_version || null,
        payload?.prediction?.label || null,
        Number.isFinite(Number(probabilities.low)) ? Number(probabilities.low) : null,
        Number.isFinite(Number(probabilities.elevated)) ? Number(probabilities.elevated) : null,
        Number.isFinite(Number(probabilities.hyper)) ? Number(probabilities.hyper) : null,
        Number.isFinite(Number(payload?.quality?.mean_sqi)) ? Number(payload.quality.mean_sqi) : null,
        Number.isFinite(Number(payload?.quality?.min_sqi)) ? Number(payload.quality.min_sqi) : null,
        Number.isFinite(Number(payload?.quality?.n_subwindows_attempted))
          ? Number(payload.quality.n_subwindows_attempted)
          : null,
        Number.isFinite(Number(payload?.quality?.n_subwindows_used))
          ? Number(payload.quality.n_subwindows_used)
          : null,
        Array.isArray(payload?.warnings) ? JSON.stringify(payload.warnings) : null,
        JSON.stringify(payload),
        runId
      );

      if (activeRunState?.id === runId) {
        activeRunState.status = 'completed';
        activeRunState.resultSummary = summarisePrediction(payload);
      }
    } else {
      const errorMessage =
        payload?.error?.message ||
        formatProcessError(code, stderrTail, stdoutTail) ||
        'Inference failed.';
      failRunStatement.run(
        payload?.model_name || null,
        payload?.model_version || null,
        Array.isArray(payload?.warnings) ? JSON.stringify(payload.warnings) : null,
        payload ? JSON.stringify(payload) : null,
        errorMessage,
        runId
      );

      if (activeRunState?.id === runId) {
        activeRunState.status = 'failed';
        activeRunState.error = errorMessage;
      }
    }

    cleanupRunDirectory(runConfig.runDir);
  });

  proc.on('error', (err) => {
    activeProcess = null;
    failRunStatement.run(null, null, null, null, err.message, runId);
    if (activeRunState?.id === runId) {
      activeRunState.status = 'failed';
      activeRunState.completedAt = new Date().toISOString();
      activeRunState.error = err.message;
    }
    cleanupRunDirectory(runConfig.runDir);
  });

  return { started: true };
}

router.post('/run', authenticate, (req, res) => {
  const requestedSubject = resolveSubject(req, req.body?.athleteId);
  if (requestedSubject.error) {
    return res.status(requestedSubject.statusCode || 400).json({ message: requestedSubject.error });
  }

  if (activeProcess) {
    return res.status(409).json({ message: 'BGL inference already running.' });
  }

  const isDemo = req.body?.demo === true;
  const hasCsvSignal = typeof req.body?.csvSignalText === 'string' && req.body.csvSignalText.trim();
  const customMetric = !isDemo ? normalizeSignalMetric(req.body?.metric) : null;
  const customFsHz = !isDemo && customMetric ? parseHzParam(req.body?.fsHz) : null;

  let runConfig;
  if (isDemo) {
    runConfig = prepareDemoRunConfig();
  } else if (hasCsvSignal) {
    runConfig = prepareCsvRunConfig(requestedSubject.subject, req.body || {});
  } else if (customMetric && customFsHz) {
    runConfig = prepareArduinoRunConfig(requestedSubject.subject, customMetric, customFsHz);
  } else {
    runConfig = prepareLiveRunConfig(requestedSubject.subject);
  }

  if (runConfig.error) {
    return res.status(runConfig.statusCode || 400).json({ message: runConfig.error });
  }

  const started = spawnInference(runConfig, requestedSubject.subject, req.user.id);
  if (!started.started) {
    cleanupRunDirectory(runConfig.runDir);
    return res.status(started.statusCode || 500).json({ message: started.error });
  }

  return res.json({
    message: 'BGL inference started.',
    mode: runConfig.mode,
    fsHz: runConfig.fsHz,
    strictLength: runConfig.strictLength,
    metric: runConfig.signalMetric,
    athleteId: requestedSubject.subject.id,
  });
});

router.get('/status', authenticate, (req, res) => {
  const requestedSubject = resolveSubject(req, req.query?.athleteId);
  if (requestedSubject.error) {
    return res.status(requestedSubject.statusCode || 400).json({ message: requestedSubject.error });
  }

  const subject = requestedSubject.subject;
  const latestRunRow = latestRunByUserStatement.get(subject.id);
  const latestRun = serializeRunRow(latestRunRow);
  const inMemory =
    activeRunState && activeRunState.userId === subject.id ? activeRunState : null;

  const arduinoMetric = normalizeSignalMetric(req.query.signalMetric);
  const arduinoFsHz = arduinoMetric ? parseHzParam(req.query.signalFsHz) : null;

  return res.json({
    running: Boolean(inMemory && inMemory.status === 'running'),
    inMemory,
    latestRun: inMemory || latestRun,
    latestPrediction: latestRunRow ? extractPredictionPayload(latestRunRow) : null,
    runtime: getPpgRuntimeStatus(),
    bundle: getModelBundleStatus(),
    demoInput: getDemoInputStatus(),
    liveInput: getLatestSignalWindowStatus(subject.id),
    arduinoInput: arduinoMetric && arduinoFsHz
      ? getArduinoSignalStatus(subject.id, arduinoMetric, arduinoFsHz)
      : null,
    profile: buildProfileStatus(subject),
    signalMetric: SIGNAL_METRIC,
    subject: {
      id: subject.id,
      name: subject.name,
      role: subject.role,
    },
  });
});

router.get('/results', authenticate, (req, res) => {
  const requestedSubject = resolveSubject(req, req.query?.athleteId);
  if (requestedSubject.error) {
    return res.status(requestedSubject.statusCode || 400).json({ message: requestedSubject.error });
  }

  const latestRunRow = latestRunByUserStatement.get(requestedSubject.subject.id);
  const latestRun = serializeRunRow(latestRunRow);

  return res.json({
    run: latestRun,
    prediction: latestRunRow ? extractPredictionPayload(latestRunRow) : null,
  });
});

module.exports = router;
