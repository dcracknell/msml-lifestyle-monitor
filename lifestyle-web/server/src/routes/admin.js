const express = require('express');
const db = require('../db');
const { authenticate } = require('../services/session-store');
const { hashPassword } = require('../utils/hash-password');
const { ROLES, isHeadCoach, isHeadCoach: isHeadCoachRole, isCoach, coerceRole } = require('../utils/role');
const { PASSWORD_LIMITS, violatesLimits } = require('../utils/validation');

const router = express.Router();

function requireHeadCoach(req, res, next) {
  if (!req.user || !isHeadCoach(req.user.role)) {
    return res.status(403).json({ message: 'Head coach privileges required.' });
  }
  return next();
}

router.use(authenticate);
router.use(requireHeadCoach);

router.post('/promote', (req, res) => {
  const { userId } = req.body || {};
  const targetId = Number.parseInt(userId, 10);
  if (!Number.isInteger(targetId)) {
    return res.status(400).json({ message: 'Valid userId is required.' });
  }

  if (targetId === req.user.id) {
    return res.status(400).json({ message: 'Head coach is already promoted.' });
  }

  const target = db
    .prepare('SELECT id, name, role FROM users WHERE id = ?')
    .get(targetId);

  if (!target) {
    return res.status(404).json({ message: 'User not found.' });
  }

  if (isHeadCoachRole(target.role)) {
    return res.status(400).json({ message: 'User is already a head coach.' });
  }

  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(ROLES.COACH, targetId);
  return res.json({ message: `${target.name || 'User'} is now a Coach.` });
});

router.post('/demote', (req, res) => {
  const { userId } = req.body || {};
  const targetId = Number.parseInt(userId, 10);
  if (!Number.isInteger(targetId)) {
    return res.status(400).json({ message: 'Valid userId is required.' });
  }

  const target = db
    .prepare('SELECT id, name, role FROM users WHERE id = ?')
    .get(targetId);

  if (!target) {
    return res.status(404).json({ message: 'User not found.' });
  }

  if (isHeadCoachRole(target.role)) {
    return res.status(400).json({ message: 'Head coach cannot be demoted.' });
  }

  if (!isCoach(target.role)) {
    return res.status(400).json({ message: 'User is not a coach.' });
  }

  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(ROLES.ATHLETE, targetId);
  return res.json({ message: `${target.name || 'User'} is now an Athlete.` });
});

const deleteUser = db.transaction((userId) => {
  [
    'coach_athlete_links',
    'daily_metrics',
    'heart_rate_zones',
    'nutrition_macros',
    'hydration_logs',
    'sleep_stages',
  ].forEach((table) => {
    if (table === 'coach_athlete_links') {
      db.prepare(`DELETE FROM ${table} WHERE coach_id = ? OR athlete_id = ?`).run(userId, userId);
    } else {
      db.prepare(`DELETE FROM ${table} WHERE user_id = ?`).run(userId);
    }
  });
  db.prepare('DELETE FROM users WHERE id = ?').run(userId);
});

router.delete('/users/:id', (req, res) => {
  const targetId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(targetId)) {
    return res.status(400).json({ message: 'User id must be numeric.' });
  }

  if (targetId === req.user.id) {
    return res.status(400).json({ message: 'Head coach account cannot be deleted.' });
  }

  const target = db
    .prepare('SELECT id, role FROM users WHERE id = ?')
    .get(targetId);

  if (!target) {
    return res.status(404).json({ message: 'User not found.' });
  }

  if (isHeadCoachRole(target.role)) {
    return res.status(400).json({ message: 'Cannot delete another head coach.' });
  }

  deleteUser(targetId);
  return res.status(204).send();
});

router.post('/reset-password', (req, res) => {
  const { userId, password } = req.body || {};
  const targetId = Number.parseInt(userId, 10);
  if (!Number.isInteger(targetId)) {
    return res.status(400).json({ message: 'Valid userId is required.' });
  }

  const target = db
    .prepare('SELECT id, name FROM users WHERE id = ?')
    .get(targetId);

  if (!target) {
    return res.status(404).json({ message: 'User not found.' });
  }

  const desiredPassword = typeof password === 'string' ? password.trim() : '';
  if (desiredPassword && desiredPassword.length < 8) {
    return res.status(400).json({ message: 'Temporary password must be at least 8 characters.' });
  }
  if (desiredPassword && violatesLimits(desiredPassword, PASSWORD_LIMITS)) {
    return res.status(400).json({
      message: `Password must be ${PASSWORD_LIMITS.maxWords} words and ${PASSWORD_LIMITS.maxLength} characters or fewer.`,
    });
  }
  const tempPassword = desiredPassword || 'Password';
  const nextHash = hashPassword(tempPassword);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(nextHash, targetId);
  return res.json({
    message: `${target.name || 'Account'} password reset to "${tempPassword}".`,
  });
});

module.exports = router;
