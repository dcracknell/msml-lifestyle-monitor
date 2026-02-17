const express = require('express');
const db = require('../db');
const { authenticate } = require('../services/session-store');
const { isHeadCoach, isCoach, classifyRole, coerceRole } = require('../utils/role');

const router = express.Router();

const rosterByCoachStatement = db.prepare(`
  WITH latest AS (
    SELECT dm.user_id,
           dm.steps,
           dm.calories,
           dm.sleep_hours,
           dm.readiness_score
    FROM daily_metrics dm
    INNER JOIN (
      SELECT user_id, MAX(date) AS max_date
      FROM daily_metrics
      GROUP BY user_id
    ) grouped
      ON grouped.user_id = dm.user_id AND grouped.max_date = dm.date
  )
  SELECT DISTINCT u.id,
         u.name,
         u.email,
         u.role,
         u.avatar_url,
         u.avatar_photo,
         u.weight_category,
         u.goal_steps,
         u.goal_calories,
         u.goal_sleep,
         u.goal_readiness,
         latest.steps,
         latest.calories,
         latest.sleep_hours,
         latest.readiness_score
  FROM coach_athlete_links cal
  JOIN users u ON cal.athlete_id = u.id
  LEFT JOIN latest ON latest.user_id = u.id
  WHERE cal.coach_id = ?
`);

const rosterAllStatement = db.prepare(`
  WITH latest AS (
    SELECT dm.user_id,
           dm.steps,
           dm.calories,
           dm.sleep_hours,
           dm.readiness_score
    FROM daily_metrics dm
    INNER JOIN (
      SELECT user_id, MAX(date) AS max_date
      FROM daily_metrics
      GROUP BY user_id
    ) grouped
      ON grouped.user_id = dm.user_id AND grouped.max_date = dm.date
  )
  SELECT u.id,
         u.name,
         u.email,
         u.role,
         u.avatar_url,
         u.avatar_photo,
         u.weight_category,
         u.goal_steps,
         u.goal_calories,
         u.goal_sleep,
         u.goal_readiness,
         latest.steps,
         latest.calories,
         latest.sleep_hours,
         latest.readiness_score
  FROM users u
  LEFT JOIN latest ON latest.user_id = u.id
  WHERE u.id != ?
`);

const latestForUser = db.prepare(
  `SELECT steps,
          calories,
          sleep_hours AS sleep_hours,
          readiness_score AS readiness_score
   FROM daily_metrics
   WHERE user_id = ?
   ORDER BY date DESC
   LIMIT 1`
);

router.get('/', authenticate, (req, res) => {
  const viewerId = req.user.id;
  const viewerRole = req.user.role || '';
  let roster = [];

  if (isHeadCoach(viewerRole)) {
    roster = rosterAllStatement.all(viewerId);
    const viewerStats = latestForUser.get(viewerId) || {};
    roster.unshift({
      id: req.user.id,
      name: req.user.name,
      email: req.user.email,
      role: req.user.role,
      avatar_url: req.user.avatar_url,
      avatar_photo: req.user.avatar_photo,
      weight_category: req.user.weight_category,
      goal_steps: req.user.goal_steps,
      goal_calories: req.user.goal_calories,
      goal_sleep: req.user.goal_sleep,
      goal_readiness: req.user.goal_readiness,
      steps: viewerStats.steps ?? null,
      calories: viewerStats.calories ?? null,
      sleep_hours: viewerStats.sleep_hours ?? null,
      readiness_score: viewerStats.readiness_score ?? null,
    });
  } else if (isCoach(viewerRole)) {
    roster = rosterByCoachStatement.all(viewerId);
  }

  if (!roster.length) {
    return res.json({ athletes: [] });
  }

  const ROLE_ORDER = { head: 0, coach: 1, athlete: 2, other: 3 };

  const ranked = roster
    .map((entry) => {
      const normalizedRole = coerceRole(entry.role);
      const roleTier = classifyRole(entry.role);
      return {
        id: entry.id,
        name: entry.name,
        email: entry.email,
        role: normalizedRole,
        avatar_url: entry.avatar_url,
        avatar_photo: entry.avatar_photo,
        weight_category: entry.weight_category,
        goal_steps: entry.goal_steps,
        goal_calories: entry.goal_calories,
        goal_sleep: entry.goal_sleep,
        goal_readiness: entry.goal_readiness,
        readinessScore: entry.readiness_score ?? null,
        steps: entry.steps ?? null,
        calories: entry.calories ?? null,
        sleepHours: entry.sleep_hours ?? null,
        roleTier,
      };
    })
    .sort((a, b) => {
      const tierDiff = (ROLE_ORDER[a.roleTier] ?? ROLE_ORDER.other) - (ROLE_ORDER[b.roleTier] ?? ROLE_ORDER.other);
      if (tierDiff !== 0) return tierDiff;
      const readinessDiff = (b.readinessScore ?? 0) - (a.readinessScore ?? 0);
      if (readinessDiff !== 0) return readinessDiff;
      return a.name.localeCompare(b.name);
    })
    .map((entry, index) => ({
      ...entry,
      rank: index + 1,
    }));

  return res.json({ athletes: ranked });
});

module.exports = router;
