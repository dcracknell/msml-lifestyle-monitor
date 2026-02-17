const express = require('express');
const db = require('../db');
const { authenticate } = require('../services/session-store');
const { isHeadCoach, coerceRole } = require('../utils/role');

const router = express.Router();
const POUNDS_PER_KG = 2.20462262185;

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
    WHERE coach_id = ?
      AND athlete_id = ?`
);

const timelineStatement = db.prepare(
  `SELECT wl.id,
          wl.date,
          wl.weight_kg AS weightKg,
          dm.calories    AS calories
     FROM weight_logs wl
LEFT JOIN daily_metrics dm
       ON dm.user_id = wl.user_id
      AND dm.date = wl.date
    WHERE wl.user_id = ?
    ORDER BY wl.date ASC, wl.id ASC`
);

const entryByDateStatement = db.prepare(
  `SELECT id,
          date,
          weight_kg AS weightKg
     FROM weight_logs
    WHERE user_id = ?
      AND date = ?`
);

const entryByIdStatement = db.prepare(
  `SELECT id,
          user_id AS userId,
          date,
          weight_kg AS weightKg
     FROM weight_logs
    WHERE id = ?`
);

const deleteByIdStatement = db.prepare('DELETE FROM weight_logs WHERE id = ?');

const upsertStatement = db.prepare(
  `INSERT INTO weight_logs (user_id, date, weight_kg)
        VALUES (?, ?, ?)
   ON CONFLICT(user_id, date)
   DO UPDATE SET weight_kg = excluded.weight_kg,
                 recorded_at = CURRENT_TIMESTAMP`
);

function kgToLbs(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.round(numeric * POUNDS_PER_KG * 10) / 10;
}

function round(value, decimals = 1) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function average(values = []) {
  const valid = values.filter((value) => Number.isFinite(value));
  if (!valid.length) return null;
  const total = valid.reduce((sum, value) => sum + value, 0);
  return total / valid.length;
}

function normalizeDate(value) {
  if (!value) {
    return new Date().toISOString().slice(0, 10);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString().slice(0, 10);
  }
  return parsed.toISOString().slice(0, 10);
}

function buildStats(timeline = [], goalCalories) {
  if (!timeline.length) return null;
  const lastSeven = timeline.slice(-7);
  const latest = timeline[timeline.length - 1];
  if (!latest) return null;

  const avgWeightKg = average(lastSeven.map((entry) => entry.weightKg));
  const baselineIndex = timeline.length - lastSeven.length - 1;
  const comparisonEntry =
    baselineIndex >= 0
      ? timeline[baselineIndex]
      : timeline.length > 1
      ? timeline[0]
      : null;
  const weeklyChangeKg =
    comparisonEntry && comparisonEntry !== latest
      ? latest.weightKg - comparisonEntry.weightKg
      : null;

  const caloriesWindow = average(lastSeven.map((entry) => entry.calories));
  const caloriesDeltaFromGoal =
    Number.isFinite(goalCalories) && Number.isFinite(caloriesWindow)
      ? caloriesWindow - goalCalories
      : null;

  return {
    window: lastSeven.length,
    avgWeightKg: round(avgWeightKg),
    avgWeightLbs: round(kgToLbs(avgWeightKg)),
    weeklyChangeKg: round(weeklyChangeKg),
    weeklyChangeLbs: round(kgToLbs(weeklyChangeKg)),
    caloriesAvg: Number.isFinite(caloriesWindow) ? Math.round(caloriesWindow) : null,
    caloriesDeltaFromGoal: Number.isFinite(caloriesDeltaFromGoal)
      ? Math.round(caloriesDeltaFromGoal)
      : null,
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

  const records = timelineStatement.all(subjectId);
  const timeline = records.map((row) => ({
    id: row.id,
    date: row.date,
    weightKg: round(row.weightKg),
    weightLbs: round(kgToLbs(row.weightKg)),
    calories: Number.isFinite(row.calories) ? Number(row.calories) : null,
  }));
  const latest = timeline[timeline.length - 1] || null;
  const recent = timeline.slice(-10).reverse();

  return res.json({
    subject,
    latest,
    timeline,
    recent,
    stats: buildStats(timeline, subject.goal_calories),
  });
});

router.post('/', authenticate, (req, res) => {
  const userId = req.user.id;
  const { weight, unit, date } = req.body || {};
  const parsedWeight = Number(weight);
  if (!Number.isFinite(parsedWeight) || parsedWeight <= 0 || parsedWeight > 500) {
    return res.status(400).json({ message: 'Enter a valid weight.' });
  }
  const normalizedUnit = (unit || 'kg').toString().trim().toLowerCase();
  if (normalizedUnit !== 'kg' && normalizedUnit !== 'lb') {
    return res.status(400).json({ message: 'Unit must be kg or lb.' });
  }
  const normalizedDate = normalizeDate(date);
  const weightKg =
    normalizedUnit === 'lb' ? parsedWeight / POUNDS_PER_KG : parsedWeight;
  const roundedKg = round(weightKg);

  upsertStatement.run(userId, normalizedDate, roundedKg);
  const entry = entryByDateStatement.get(userId, normalizedDate);
  return res.status(201).json({
    id: entry?.id || null,
    date: normalizedDate,
    weightKg: round(entry?.weightKg ?? roundedKg),
    weightLbs: round(kgToLbs(entry?.weightKg ?? roundedKg)),
  });
});

router.delete('/:id', authenticate, (req, res) => {
  const entryId = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(entryId) || entryId <= 0) {
    return res.status(400).json({ message: 'Invalid weight entry.' });
  }

  const entry = entryByIdStatement.get(entryId);
  if (!entry) {
    return res.status(404).json({ message: 'Weight entry not found.' });
  }

  if (entry.userId !== req.user.id) {
    return res.status(403).json({ message: 'You can only delete your own entries.' });
  }

  deleteByIdStatement.run(entryId);
  return res.json({ message: 'Entry deleted.' });
});

module.exports = router;
