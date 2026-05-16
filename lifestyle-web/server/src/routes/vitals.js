const express = require('express');
const db = require('../db');
const { authenticate } = require('../services/session-store');
const { isHeadCoach, coerceRole } = require('../utils/role');

const router = express.Router();

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
          goal_readiness
     FROM users
    WHERE id = ?`
);

const accessStatement = db.prepare(
  `SELECT 1
     FROM coach_athlete_links
    WHERE coach_id = ? AND athlete_id = ?`
);

const vitalsStatement = db.prepare(
  `SELECT date,
          resting_hr   AS restingHr,
          hrv_score    AS hrvScore,
          spo2,
          stress_score AS stressScore,
          systolic_bp  AS systolic,
          diastolic_bp AS diastolic,
          glucose_mg_dl AS glucose
     FROM health_markers
    WHERE user_id = ?
      AND date <= DATE('now', 'localtime')
    ORDER BY date ASC`
);

const SNAPSHOT_FIELDS = [
  'restingHr',
  'hrvScore',
  'spo2',
  'stressScore',
  'systolic',
  'diastolic',
  'glucose',
];

function entriesWithFiniteKey(records = [], key) {
  return records.filter((entry) => Number.isFinite(Number(entry?.[key])));
}

function recentEntriesForKey(records = [], key, limit = 7) {
  return entriesWithFiniteKey(records, key).slice(-limit);
}

function recentEntriesForPair(records = [], leftKey, rightKey, limit = 7) {
  return records
    .filter(
      (entry) =>
        Number.isFinite(Number(entry?.[leftKey])) && Number.isFinite(Number(entry?.[rightKey]))
    )
    .slice(-limit);
}

function averageOfKey(records = [], key) {
  const values = entriesWithFiniteKey(records, key).map((entry) => Number(entry[key]));
  if (!values.length) return null;
  const sum = values.reduce((total, value) => total + value, 0);
  return Math.round((sum / values.length) * 10) / 10;
}

function deltaFromLast(records = [], key) {
  const nonNullEntries = entriesWithFiniteKey(records, key);
  if (nonNullEntries.length < 2) return null;
  const latest = Number(nonNullEntries[nonNullEntries.length - 1]?.[key]);
  const previous = Number(nonNullEntries[nonNullEntries.length - 2]?.[key]);
  if (!Number.isFinite(latest) || !Number.isFinite(previous)) return null;
  return Math.round((latest - previous) * 10) / 10;
}

function buildLatestSnapshot(timeline = []) {
  if (!timeline.length) {
    return null;
  }

  const latest = {
    date: timeline[timeline.length - 1]?.date || null,
    fieldDates: {},
  };

  SNAPSHOT_FIELDS.forEach((field) => {
    const match = [...timeline].reverse().find((entry) => Number.isFinite(Number(entry?.[field])));
    latest[field] = match ? Number(match[field]) : null;
    latest.fieldDates[field] = match?.date || null;
  });

  return latest;
}

function buildStats(timeline = []) {
  const restingHrEntries = recentEntriesForKey(timeline, 'restingHr');
  const glucoseEntries = recentEntriesForKey(timeline, 'glucose');
  const bpEntries = recentEntriesForPair(timeline, 'systolic', 'diastolic');
  const hrvEntries = recentEntriesForKey(timeline, 'hrvScore');
  const spo2Entries = recentEntriesForKey(timeline, 'spo2');
  const stressEntries = recentEntriesForKey(timeline, 'stressScore');

  return {
    window: Math.min(timeline.length, 7),
    restingHrCount: restingHrEntries.length,
    restingHrAvg: averageOfKey(restingHrEntries, 'restingHr'),
    restingHrDelta: deltaFromLast(timeline, 'restingHr'),
    glucoseCount: glucoseEntries.length,
    glucoseAvg: averageOfKey(glucoseEntries, 'glucose'),
    glucoseDelta: deltaFromLast(timeline, 'glucose'),
    bloodPressureCount: bpEntries.length,
    systolicAvg: averageOfKey(bpEntries, 'systolic'),
    diastolicAvg: averageOfKey(bpEntries, 'diastolic'),
    hrvCount: hrvEntries.length,
    hrvAvg: averageOfKey(hrvEntries, 'hrvScore'),
    spo2Count: spo2Entries.length,
    spo2Avg: averageOfKey(spo2Entries, 'spo2'),
    stressCount: stressEntries.length,
    stressAvg: averageOfKey(stressEntries, 'stressScore'),
  };
}

router.get('/', authenticate, (req, res) => {
  req.user = { ...req.user, role: coerceRole(req.user.role) };
  const viewerId = req.user.id;
  const requestedId = Number.parseInt(req.query.athleteId, 10);
  const subjectId = Number.isNaN(requestedId) ? viewerId : requestedId;

  if (subjectId !== viewerId && !isHeadCoach(req.user.role)) {
    const hasAccess = accessStatement.get(viewerId, subjectId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Not authorized to view that athlete.' });
    }
  }

  const subject = subjectStatement.get(subjectId);
  if (!subject) {
    return res.status(404).json({ message: 'Athlete not found.' });
  }
  subject.role = coerceRole(subject.role);

  const timeline = vitalsStatement.all(subjectId);
  const latest = buildLatestSnapshot(timeline);

  return res.json({
    subject,
    latest,
    timeline,
    stats: buildStats(timeline),
  });
});

module.exports = router;
