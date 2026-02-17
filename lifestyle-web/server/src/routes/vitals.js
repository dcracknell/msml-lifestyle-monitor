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
    ORDER BY date ASC`
);

function averageOfKey(records = [], key) {
  const values = records
    .map((entry) => Number(entry[key]))
    .filter((value) => Number.isFinite(value));
  if (!values.length) return null;
  const sum = values.reduce((total, value) => total + value, 0);
  return Math.round((sum / values.length) * 10) / 10;
}

function deltaFromLast(records = [], key) {
  if (!records.length) return null;
  const latest = Number(records[records.length - 1]?.[key]);
  const previous = Number(records[records.length - 2]?.[key]);
  if (!Number.isFinite(latest) || !Number.isFinite(previous)) return null;
  return Math.round((latest - previous) * 10) / 10;
}

function buildStats(timeline = []) {
  const recentWindow = timeline.slice(-7);
  return {
    window: recentWindow.length,
    restingHrAvg: averageOfKey(recentWindow, 'restingHr'),
    restingHrDelta: deltaFromLast(timeline, 'restingHr'),
    glucoseAvg: averageOfKey(recentWindow, 'glucose'),
    glucoseDelta: deltaFromLast(timeline, 'glucose'),
    systolicAvg: averageOfKey(recentWindow, 'systolic'),
    diastolicAvg: averageOfKey(recentWindow, 'diastolic'),
    hrvAvg: averageOfKey(recentWindow, 'hrvScore'),
    spo2Avg: averageOfKey(recentWindow, 'spo2'),
    stressAvg: averageOfKey(recentWindow, 'stressScore'),
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
  const latest = timeline[timeline.length - 1] || null;

  return res.json({
    subject,
    latest,
    timeline,
    stats: buildStats(timeline),
  });
});

module.exports = router;
