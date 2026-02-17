const express = require('express');
const db = require('../db');
const { createSession, destroySession, authenticate } = require('../services/session-store');
const { hashPassword, verifyPassword } = require('../utils/hash-password');
const { coerceRole } = require('../utils/role');

const router = express.Router();

router.post('/', (req, res) => {
  const { email, password } = req.body;
  const identifier = typeof email === 'string' ? email.trim() : '';
  const secret = typeof password === 'string' ? password : '';

  if (!identifier || !secret) {
    return res.status(400).json({ message: 'Email/username and password are required.' });
  }

  const normalizedIdentifier = identifier.toLowerCase();

  const defaultSelection = `
    SELECT id,
           name,
           email,
           role,
           avatar_url,
           avatar_photo,
           weight_category,
           goal_steps,
           goal_calories,
           goal_sleep,
           goal_readiness,
           password_hash,
           strava_client_id,
           strava_client_secret,
           strava_redirect_uri
    FROM users
    WHERE %IDENTIFIER_CLAUSE%
    LIMIT 1
  `;

  const emailMatch = db
    .prepare(defaultSelection.replace('%IDENTIFIER_CLAUSE%', 'LOWER(email) = ?'))
    .get(normalizedIdentifier);

  let user = emailMatch;

  if (!user) {
    const fallback = db
      .prepare(
        defaultSelection.replace(
          '%IDENTIFIER_CLAUSE%',
          `
          LOWER(name) = @id
          OR LOWER(REPLACE(name, ' ', '')) = @id
          OR LOWER(
            CASE
              WHEN instr(name, ' ') = 0 THEN name
              ELSE substr(name, 1, instr(name, ' ') - 1)
            END
          ) = @id
          OR LOWER(
            CASE
              WHEN instr(email, '@') > 0 THEN substr(email, 1, instr(email, '@') - 1)
              ELSE email
            END
          ) = @id
        `
        )
      )
      .get({ id: normalizedIdentifier });
    user = fallback;
  }

  if (!user || !verifyPassword(secret, user.password_hash)) {
    return res.status(401).json({ message: 'Invalid credentials.' });
  }

  if (/^[a-f0-9]{64}$/i.test(user.password_hash || '')) {
    // Upgrade legacy SHA-256 hashes the moment the credentials are confirmed.
    const upgraded = hashPassword(secret);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(upgraded, user.id);
    user.password_hash = upgraded;
  }

  const normalizedRole = coerceRole(user.role);
  const {
    password_hash: _,
    strava_client_id, // eslint-disable-line camelcase
    strava_client_secret, // eslint-disable-line camelcase
    strava_redirect_uri, // eslint-disable-line camelcase
    ...safeUser
  } = { ...user, role: normalizedRole }; // eslint-disable-line camelcase, no-unused-vars
  const session = createSession(safeUser);

  return res.json(session);
});

router.post('/logout', authenticate, (req, res) => {
  destroySession(req.token);
  return res.status(204).send();
});

module.exports = router;
