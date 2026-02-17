const express = require('express');
const db = require('../db');
const { authenticate } = require('../services/session-store');
const { coerceRole, isHeadCoach } = require('../utils/role');

const router = express.Router();

const MAX_BATCH_SIZE = Math.max(1, parseInt(process.env.STREAM_MAX_BATCH || '2000', 10));
const MAX_POINTS = Math.max(10, parseInt(process.env.STREAM_MAX_POINTS || '600', 10));
const DEFAULT_WINDOW_MS = Math.max(
  60 * 1000,
  parseInt(process.env.STREAM_DEFAULT_WINDOW_MS || `${6 * 60 * 60 * 1000}`, 10)
);

const accessStatement = db.prepare(
  `SELECT 1
     FROM coach_athlete_links
    WHERE coach_id = ?
      AND athlete_id = ?`
);

const subjectExistsStatement = db.prepare('SELECT id FROM users WHERE id = ?');

const insertSampleStatement = db.prepare(
  `INSERT INTO sensor_stream_samples (user_id, metric, ts, value)
   VALUES (?, ?, ?, ?)
   ON CONFLICT(user_id, metric, ts) DO UPDATE SET
     value = excluded.value,
     updated_at = CURRENT_TIMESTAMP`
);

const samplesInRangeStatement = db.prepare(
  `SELECT ts, value
     FROM sensor_stream_samples
    WHERE user_id = ?
      AND metric = ?
      AND ts BETWEEN ? AND ?
    ORDER BY ts ASC`
);

function normalizeMetric(input = '') {
  const metric = String(input || '').trim().toLowerCase();
  if (!metric) return null;
  if (!/^[a-z0-9._:-]{2,64}$/.test(metric)) {
    return null;
  }
  return metric;
}

function parseTimestamp(input, fallback) {
  if (input === undefined || input === null || input === '') {
    return fallback;
  }
  const numeric = Number(input);
  if (Number.isFinite(numeric)) {
    return numeric;
  }
  const parsed = Date.parse(input);
  if (!Number.isNaN(parsed)) {
    return parsed;
  }
  return null;
}

function parseWindow(input) {
  if (input === undefined || input === null || input === '') {
    return null;
  }
  const numeric = Number(input);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric;
  }
  return null;
}

function clampMaxPoints(value) {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return Math.min(MAX_POINTS, Math.max(10, Math.floor(numeric)));
  }
  return MAX_POINTS;
}

function ensureAccess(viewer, subjectId) {
  if (viewer.id === subjectId) {
    return true;
  }
  if (isHeadCoach(viewer.role)) {
    return true;
  }
  const link = accessStatement.get(viewer.id, subjectId);
  return Boolean(link);
}

function sanitizeSamples(rawSamples = []) {
  return rawSamples
    .map((sample) => {
      const ts = Number(sample.timestamp ?? sample.ts ?? sample.time);
      if (!Number.isFinite(ts) || ts <= 0) {
        return null;
      }
      const numericValue = sample.value === null ? null : Number(sample.value);
      const value = Number.isFinite(numericValue) ? numericValue : null;
      return { ts: Math.round(ts), value };
    })
    .filter(Boolean)
    .slice(0, MAX_BATCH_SIZE)
    .sort((a, b) => a.ts - b.ts);
}

function downsample(samples = [], maxPoints = MAX_POINTS) {
  if (samples.length <= maxPoints) {
    return samples;
  }

  const bucketSize = samples.length / maxPoints;
  const buckets = [];
  for (let bucketIndex = 0; bucketIndex < maxPoints; bucketIndex += 1) {
    const start = Math.floor(bucketIndex * bucketSize);
    const rawEnd = Math.floor((bucketIndex + 1) * bucketSize);
    const end = Math.max(rawEnd, start + 1);
    buckets.push(samples.slice(start, end));
  }

  return buckets.map((bucket) => {
    const lastPoint = bucket[bucket.length - 1];
    const finiteValues = bucket
      .map((entry) => (Number.isFinite(entry.value) ? entry.value : null))
      .filter((value) => value !== null);
    const average =
      finiteValues.length > 0
        ? finiteValues.reduce((sum, value) => sum + value, 0) / finiteValues.length
        : null;
    const roundedAverage =
      average === null ? (Number.isFinite(lastPoint.value) ? lastPoint.value : null) : average;
    return {
      ts: lastPoint.ts,
      value: roundedAverage === null ? null : Math.round(roundedAverage * 100) / 100,
    };
  });
}

router.post('/', authenticate, (req, res) => {
  const metric = normalizeMetric(req.body.metric);
  if (!metric) {
    return res.status(400).json({ message: 'Metric name must be 2-64 characters (letters, numbers, . _ : -).' });
  }
  const samples = sanitizeSamples(req.body.samples);
  if (!samples.length) {
    return res.status(400).json({ message: 'At least one valid sample is required.' });
  }

  const insertMany = db.transaction((rows) => {
    rows.forEach((row) => {
      insertSampleStatement.run(req.user.id, metric, row.ts, row.value);
    });
  });
  insertMany(samples);

  return res.status(202).json({
    metric,
    accepted: samples.length,
  });
});

router.get('/', authenticate, (req, res) => {
  const metric = normalizeMetric(req.query.metric);
  if (!metric) {
    return res.status(400).json({ message: 'Metric query parameter is required.' });
  }

  const viewer = { id: req.user.id, role: coerceRole(req.user.role) };
  const requestedId = Number.parseInt(req.query.athleteId, 10);
  const subjectId = Number.isNaN(requestedId) ? viewer.id : requestedId;

  const subjectExists = subjectExistsStatement.get(subjectId);
  if (!subjectExists) {
    return res.status(404).json({ message: 'Athlete not found.' });
  }

  if (!ensureAccess(viewer, subjectId)) {
    return res.status(403).json({ message: 'Not authorized to view that athlete.' });
  }

  const now = Date.now();
  let toTs = parseTimestamp(req.query.to, now);
  if (toTs === null) {
    return res.status(400).json({ message: 'Unable to parse `to` timestamp.' });
  }
  let fromTs = parseTimestamp(req.query.from, null);
  if (fromTs === null) {
    const windowMs = parseWindow(req.query.windowMs) || DEFAULT_WINDOW_MS;
    fromTs = toTs - windowMs;
  }
  if (!Number.isFinite(fromTs) || fromTs >= toTs) {
    return res.status(400).json({ message: '`from` must be earlier than `to`.' });
  }

  const rawSamples = samplesInRangeStatement
    .all(subjectId, metric, fromTs, toTs)
    .map((entry) => ({
      ts: Number(entry.ts),
      value: typeof entry.value === 'number' ? entry.value : null,
    }));

  const maxPoints = clampMaxPoints(req.query.maxPoints);
  const points = downsample(rawSamples, maxPoints);

  return res.json({
    subjectId,
    metric,
    from: fromTs,
    to: toTs,
    total: rawSamples.length,
    maxPoints,
    points,
  });
});

module.exports = router;
