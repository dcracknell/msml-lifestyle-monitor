const express = require('express');
const db = require('../db');
const { hashPassword } = require('../utils/hash-password');

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
        `[Password reset request] Notify head coach ${headCoach.email} that ${user.email} needs assistance resetting their password.`
      );
    } else {
      console.log(
        `[Password reset request] ${user.email} requested assistance, but no head coach account is available to notify.`
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
