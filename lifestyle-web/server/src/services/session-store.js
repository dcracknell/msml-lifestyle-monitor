const crypto = require('crypto');
const { encryptPayload, decryptPayload } = require('../utils/crypto');

const HOURS = parseInt(process.env.SESSION_TTL_HOURS || '12', 10);
const TTL_MS = HOURS * 60 * 60 * 1000;

const revokedTokens = new Map();
const CLEANUP_INTERVAL_MS = Math.max(15 * 60 * 1000, Math.min(TTL_MS, 60 * 60 * 1000)); // between 15min and 1h

function sanitizeSessionPayload(user = {}) {
  if (!user || typeof user !== 'object') {
    return {};
  }
  const {
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

  const sanitized = { ...rest };
  const normalizedAvatarPhoto =
    avatar_photo !== undefined ? avatar_photo : avatarPhoto;

  if (normalizedAvatarPhoto !== undefined) {
    sanitized.avatar_photo = normalizedAvatarPhoto;
  }

  return sanitized;
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function purgeRevoked() {
  const now = Date.now();
  for (const [tokenHash, expiresAt] of revokedTokens.entries()) {
    if (expiresAt <= now) {
      revokedTokens.delete(tokenHash);
    }
  }
}

const cleanupTimer = setInterval(purgeRevoked, CLEANUP_INTERVAL_MS);
if (typeof cleanupTimer.unref === 'function') {
  cleanupTimer.unref();
}

function createSession(user) {
  const expiresAt = Date.now() + TTL_MS;
  const sanitizedUser = sanitizeSessionPayload(user);
  const token = encryptPayload({ user: sanitizedUser, expiresAt });

  return { token, user: sanitizedUser };
}

function isRevoked(token) {
  const tokenHash = hashToken(token);
  const expiresAt = revokedTokens.get(tokenHash);

  if (!expiresAt) {
    return false;
  }

  if (expiresAt < Date.now()) {
    revokedTokens.delete(tokenHash);
    return false;
  }

  return true;
}

function destroySession(token) {
  revokedTokens.set(hashToken(token), Date.now() + TTL_MS);
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
