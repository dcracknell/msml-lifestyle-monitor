const express = require('express');
const db = require('../db');
const { authenticate } = require('../services/session-store');
const { isHeadCoach, coerceRole } = require('../utils/role');

const router = express.Router();
const OUNCES_PER_ML = 0.033814;

const DEFAULT_METRIC_SECTIONS = [
  'summary',
  'timeline',
  'macros',
  'heartRate',
  'hydration',
  'sleepStages',
  'readiness',
];
const DEFAULT_SECTION_SET = new Set(DEFAULT_METRIC_SECTIONS);
const SECTION_ALIASES = new Map([
  ['summary', 'summary'],
  ['timeline', 'timeline'],
  ['macros', 'macros'],
  ['heartrate', 'heartRate'],
  ['heart-rate', 'heartRate'],
  ['heart_rate', 'heartRate'],
  ['heartratezones', 'heartRate'],
  ['heart_rate_zones', 'heartRate'],
  ['hydration', 'hydration'],
  ['sleep', 'sleepStages'],
  ['sleepstages', 'sleepStages'],
  ['sleep-stages', 'sleepStages'],
  ['sleep_stages', 'sleepStages'],
  ['readiness', 'readiness'],
]);

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

const liquidHydrationStatement = db.prepare(
  `SELECT date,
          weight_amount AS amount,
          weight_unit   AS unit
     FROM nutrition_entries
    WHERE user_id = ?
      AND item_type = 'Liquid'
      AND weight_amount IS NOT NULL`
);

const summaryStatement = db.prepare(
  `SELECT steps,
          calories,
          sleep_hours    AS sleepHours,
          readiness_score AS readiness
     FROM daily_metrics
    WHERE user_id = ?
    ORDER BY date DESC
    LIMIT 1`
);

const timelineStatement = db.prepare(
  `SELECT date,
          steps,
          calories,
          sleep_hours     AS sleepHours,
          readiness_score AS readiness
     FROM daily_metrics
    WHERE user_id = ?
    ORDER BY date ASC`
);

const macrosStatement = db.prepare(
  `SELECT protein_grams   AS protein,
          carbs_grams     AS carbs,
          fats_grams      AS fats,
          target_calories AS targetCalories
     FROM nutrition_macros
    WHERE user_id = ?
    ORDER BY date DESC
    LIMIT 1`
);

const heartRateZonesStatement = db.prepare(
  `SELECT zone, minutes
     FROM heart_rate_zones
    WHERE user_id = ?`
);

const hydrationLogsStatement = db.prepare(
  `SELECT date, ounces
     FROM hydration_logs
    WHERE user_id = ?
    ORDER BY date ASC`
);

const sleepStagesStatement = db.prepare(
  `SELECT date,
          deep_minutes  AS deep,
          rem_minutes   AS rem,
          light_minutes AS light
     FROM sleep_stages
    WHERE user_id = ?
    ORDER BY date DESC
    LIMIT 1`
);

const readinessTrendStatement = db.prepare(
  `SELECT date,
          readiness_score AS readiness
     FROM daily_metrics
    WHERE user_id = ?
    ORDER BY date ASC`
);

function convertToOunces(amount, unit) {
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }
  const normalizedUnit = (unit || '').toLowerCase();
  if (normalizedUnit === 'ml' || normalizedUnit === '') {
    return Math.round(value * OUNCES_PER_ML * 10) / 10;
  }
  if (normalizedUnit === 'g') {
    return Math.round(value * OUNCES_PER_ML * 10) / 10;
  }
  return null;
}

function mergeHydrationSources(logs = [], liquids = []) {
  const totals = new Map();
  logs.forEach((entry) => {
    const ounces = Number(entry.ounces);
    if (!Number.isFinite(ounces) || ounces <= 0) return;
    totals.set(entry.date, (totals.get(entry.date) || 0) + ounces);
  });
  liquids.forEach((entry) => {
    const ounces = convertToOunces(entry.amount, entry.unit);
    if (!Number.isFinite(ounces) || ounces <= 0) return;
    totals.set(entry.date, (totals.get(entry.date) || 0) + ounces);
  });
  return Array.from(totals.entries())
    .map(([date, ounces]) => ({ date, ounces: Math.round(ounces * 10) / 10 }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function parseIncludeParam(raw) {
  if (!raw) {
    return new Set(DEFAULT_METRIC_SECTIONS);
  }
  const serialized = Array.isArray(raw) ? raw.join(',') : raw;
  const sections = serialized
    .split(',')
    .map((section) => section.trim().toLowerCase())
    .filter(Boolean)
    .map((section) => SECTION_ALIASES.get(section) || section)
    .filter((section) => DEFAULT_SECTION_SET.has(section));

  if (!sections.length) {
    return new Set(DEFAULT_METRIC_SECTIONS);
  }
  return new Set(sections);
}

router.get('/', authenticate, (req, res) => {
  req.user = { ...req.user, role: coerceRole(req.user.role) };
  const viewerId = req.user.id;
  const requestedId = Number.parseInt(req.query.athleteId, 10);
  const subjectId = Number.isNaN(requestedId) ? viewerId : requestedId;
  const includeSections = parseIncludeParam(req.query.include);
  const include = (section) => includeSections.has(section);

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

  const payload = {
    user: req.user,
    subject,
  };

  if (include('summary')) {
    payload.summary = summaryStatement.get(subjectId) || null;
  }
  if (include('timeline')) {
    payload.timeline = timelineStatement.all(subjectId);
  }
  if (include('macros')) {
    payload.macros = macrosStatement.get(subjectId) || null;
  }
  if (include('heartRate')) {
    payload.heartRateZones = heartRateZonesStatement.all(subjectId);
  }
  if (include('hydration')) {
    const hydrationLogs = hydrationLogsStatement.all(subjectId);
    const liquidHydration = liquidHydrationStatement.all(subjectId);
    payload.hydration = mergeHydrationSources(hydrationLogs, liquidHydration);
  }
  if (include('sleepStages')) {
    payload.sleepStages = sleepStagesStatement.get(subjectId) || null;
  }
  if (include('readiness')) {
    payload.readiness = readinessTrendStatement.all(subjectId);
  }

  return res.json(payload);
});

module.exports = router;
