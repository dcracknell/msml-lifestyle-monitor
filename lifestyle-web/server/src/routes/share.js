const express = require('express');
const db = require('../db');
const { authenticate } = require('../services/session-store');
const { isCoach, coerceRole } = require('../utils/role');

const router = express.Router();

const findCoachByEmail = db.prepare(
  `SELECT id, role, email, name
   FROM users
   WHERE LOWER(email) = ?`
);

const findCoachById = db.prepare(
  `SELECT id, role, email, name
   FROM users
   WHERE id = ?`
);

const listAvailableCoaches = db.prepare(
  `SELECT id, name, email, role
   FROM users
   WHERE LOWER(role) LIKE '%coach%'
   ORDER BY LOWER(role) LIKE '%head coach%' DESC, name ASC`
);

const insertLink = db.prepare(
  `INSERT OR IGNORE INTO coach_athlete_links (coach_id, athlete_id)
   VALUES (?, ?)`
);

router.get('/coaches', authenticate, (req, res) => {
  const coaches = listAvailableCoaches.all().map((coach) => ({
    id: coach.id,
    name: coach.name,
    email: coach.email,
    role: coerceRole(coach.role),
  }));
  return res.json({ coaches });
});

router.post('/', authenticate, (req, res) => {
  const { coachEmail, coachId } = req.body || {};
  const normalizedEmail = typeof coachEmail === 'string' ? coachEmail.trim().toLowerCase() : '';
  let parsedCoachId = null;
  if (typeof coachId === 'number' && Number.isFinite(coachId)) {
    parsedCoachId = coachId;
  } else if (typeof coachId === 'string' && coachId.trim()) {
    const maybeId = Number.parseInt(coachId, 10);
    if (!Number.isNaN(maybeId)) {
      parsedCoachId = maybeId;
    }
  }

  if (!normalizedEmail && !parsedCoachId) {
    return res.status(400).json({ message: 'Select a coach or enter their email.' });
  }

  if (normalizedEmail && normalizedEmail === req.user.email.toLowerCase()) {
    return res.status(400).json({ message: 'You cannot share access with yourself.' });
  }

  let coach = null;
  if (normalizedEmail) {
    coach = findCoachByEmail.get(normalizedEmail);
  } else if (parsedCoachId) {
    coach = findCoachById.get(parsedCoachId);
  }

  if (!coach || !isCoach(coach.role)) {
    return res.status(404).json({ message: 'Coach account not found.' });
  }

  insertLink.run(coach.id, req.user.id);

  return res.json({
    message: `Shared your data with ${coach.name || coach.email}.`,
  });
});

module.exports = router;
