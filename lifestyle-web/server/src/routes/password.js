const crypto = require('crypto');
const express = require('express');
const db = require('../db');
const { hashPassword } = require('../utils/hash-password');
const { PASSWORD_LIMITS, violatesLimits } = require('../utils/validation');

const router = express.Router();

router.post('/forgot', (req, res) => {
  const { email } = req.body || {};
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';

  if (!normalizedEmail) {
    return res.status(400).json({ message: 'Email is required.' });
  }

  const user = db
    .prepare('SELECT id, email, name FROM users WHERE LOWER(email) = ?')
    .get(normalizedEmail);

  if (user) {
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const createdAt = new Date().toISOString();
    db.prepare(
      'INSERT INTO password_reset_tokens (user_id, token, expires_at, created_at) VALUES (?, ?, ?, ?)'
    ).run(user.id, token, expiresAt, createdAt);

    const headCoach = db
      .prepare(
        `SELECT id, email, name
         FROM users
         WHERE LOWER(role) LIKE '%head coach%'
         ORDER BY id ASC
         LIMIT 1`
      )
      .get();

    if (headCoach) {
      console.log(
        `[Password reset] Head coach ${headCoach.email}: share this token with ${user.email} so they can reset their password (expires in 24h): ${token}`
      );
    } else {
      console.log(
        `[Password reset] No head coach found. Token for ${user.email} (expires in 24h): ${token}`
      );
    }
  }

  return res.json({
    message: 'If that email exists, your head coach has been notified to help reset your password.',
  });
});

router.post('/reset', (req, res) => {
  const { token, password } = req.body || {};
  const trimmedToken = typeof token === 'string' ? token.trim() : '';
  const newPassword = typeof password === 'string' ? password : '';

  if (!trimmedToken || !newPassword) {
    return res.status(400).json({ message: 'Token and new password are required.' });
  }

  if (newPassword.length < 8) {
    return res.status(400).json({ message: 'Password must be at least 8 characters.' });
  }
  if (violatesLimits(newPassword, PASSWORD_LIMITS)) {
    return res.status(400).json({
      message: `Password must be ${PASSWORD_LIMITS.maxWords} words and ${PASSWORD_LIMITS.maxLength} characters or fewer.`,
    });
  }

  const entry = db
    .prepare(
      `SELECT id, user_id, expires_at, used
       FROM password_reset_tokens
       WHERE token = ?`
    )
    .get(trimmedToken);

  if (!entry) {
    return res.status(400).json({ message: 'Invalid or expired token.' });
  }

  if (entry.used) {
    return res.status(400).json({ message: 'This token has already been used.' });
  }

  if (new Date(entry.expires_at).getTime() < Date.now()) {
    return res.status(400).json({ message: 'This token has expired.' });
  }

  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(newPassword), entry.user_id);
  db.prepare('UPDATE password_reset_tokens SET used = 1 WHERE id = ?').run(entry.id);

  return res.json({ message: 'Password updated. You can sign in with the new password.' });
});

module.exports = router;
