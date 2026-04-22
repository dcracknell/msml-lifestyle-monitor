const crypto = require('crypto');
const { encryptPayload, decryptPayload } = require('../utils/crypto');
const db = require('../db');

const HOURS = parseInt(process.env.SESSION_TTL_HOURS || '12', 10);
const TTL_MS = HOURS * 60 * 60 * 1000;

const CLEANUP_INTERVAL_MS = Math.max(15 * 60 * 1000, Math.min(TTL_MS, 60 * 60 * 1000)); // between 15min and 1h

function sanitizeSessionUser(user = {}) {
  if (!user || typeof user !== 'object') {
    return {};
  }
  const {
    password_hash, // eslint-disable-line camelcase
    passwordHash,
    avatar_photo, // eslint-disable-line camelcase
    avatarPhoto,
    strava_client_id, // eslint-disable-line camelcase
    stravaClientId,
    strava_client_secret, // eslint-disable-line camelcase
    stravaClientSecret,
    strava_redirect_uri, // eslint-disable-line camelcase
    stravaRedirectUri,
    ...rest
  } = user;

  return {
    ...rest,
    ...(avatar_photo !== undefined
      ? { avatar_photo }
      : avatarPhoto !== undefined
      ? { avatar_photo: avatarPhoto }
      : {}),
  };
}

function createTokenUser(user = {}) {
  if (!user || typeof user !== 'object') {
    return {};
  }

  const {
    avatar_photo, // eslint-disable-line camelcase
    avatarPhoto,
    ...rest
  } = user;

  return rest;
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function purgeRevoked() {
  db.prepare('DELETE FROM revoked_tokens WHERE expires_at <= ?').run(Date.now());
}

const cleanupTimer = setInterval(purgeRevoked, CLEANUP_INTERVAL_MS);
if (typeof cleanupTimer.unref === 'function') {
  cleanupTimer.unref();
}

function createSession(user) {
  const expiresAt = Date.now() + TTL_MS;
  const sanitizedUser = sanitizeSessionUser(user);
  const tokenUser = createTokenUser(sanitizedUser);
  const token = encryptPayload({ user: tokenUser, expiresAt });

  return { token, user: sanitizedUser };
}

function isRevoked(token) {
  const tokenHash = hashToken(token);
  const row = db.prepare('SELECT expires_at FROM revoked_tokens WHERE token_hash = ?').get(tokenHash);

  if (!row) {
    return false;
  }

  if (row.expires_at < Date.now()) {
    db.prepare('DELETE FROM revoked_tokens WHERE token_hash = ?').run(tokenHash);
    return false;
  }

  return true;
}

function destroySession(token, userId) {
  const tokenHash = hashToken(token);
  const expiresAt = Date.now() + TTL_MS;
  db.prepare(
    'INSERT OR REPLACE INTO revoked_tokens (token_hash, user_id, expires_at) VALUES (?, ?, ?)'
  ).run(tokenHash, userId ?? null, expiresAt);
}

function authenticate(req, res, next) {
  const authHeader = req.get('authorization');
  if (!authHeader) {
    return res.status(401).json({ message: 'Missing authorization header.' });
  }

  const [, token] = authHeader.split(' ');
  if (!token) {
    return res.status(401).json({ message: 'Invalid authorization header.' });
  }

  if (isRevoked(token)) {
    return res.status(401).json({ message: 'Session expired.' });
  }

  const payload = decryptPayload(token);
  if (!payload || !payload.user || !payload.expiresAt) {
    return res.status(401).json({ message: 'Token invalid.' });
  }

  if (payload.expiresAt < Date.now()) {
    return res.status(401).json({ message: 'Session expired.' });
  }

  req.user = payload.user;
  req.token = token;
  return next();
}

module.exports = {
  createSession,
  destroySession,
  authenticate,
};
