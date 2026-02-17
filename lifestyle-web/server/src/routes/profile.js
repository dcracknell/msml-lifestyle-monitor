const express = require('express');
const db = require('../db');
const { authenticate, createSession } = require('../services/session-store');
const { hashPassword, verifyPassword } = require('../utils/hash-password');
const { coerceRole, ROLES } = require('../utils/role');
const { NAME_LIMITS, PASSWORD_LIMITS, violatesLimits } = require('../utils/validation');

const router = express.Router();

router.use(authenticate);

function normalizeAvatarUrl(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^https?:\/\//i.test(trimmed)) {
    return null;
  }
  return trimmed.slice(0, 600);
}

function normalizeAvatarPhoto(value) {
  if (value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    return undefined;
  }
  let trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.startsWith('data:image')) {
    const idx = trimmed.indexOf(',');
    trimmed = idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
  }
  const MAX_LENGTH = 5 * 1024 * 1024;
  if (trimmed.length > MAX_LENGTH) {
    throw new Error('Profile photo is too large. Try a smaller image.');
  }
  return trimmed;
}

router.put('/', (req, res) => {
  const {
    name,
    email,
    password,
    currentPassword,
    weightCategory,
    stravaClientId,
    stravaClientSecret,
    stravaRedirectUri,
    avatar,
    avatarPhoto,
    goalSleep,
  } = req.body || {};
  const trimmedName = typeof name === 'string' ? name.trim() : '';
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
  const newPassword = typeof password === 'string' ? password : '';
  const current = typeof currentPassword === 'string' ? currentPassword : '';
  const trimmedWeightCategory =
    typeof weightCategory === 'string' ? weightCategory.trim() : '';
  const trimmedStravaClientId =
    typeof stravaClientId === 'string' ? stravaClientId.trim() : undefined;
  const trimmedStravaClientSecret =
    typeof stravaClientSecret === 'string' ? stravaClientSecret.trim() : undefined;
  const trimmedStravaRedirectUri =
    typeof stravaRedirectUri === 'string' ? stravaRedirectUri.trim() : undefined;

  const user = db
    .prepare(
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
              goal_readiness,
              password_hash,
              strava_client_id,
              strava_client_secret,
              strava_redirect_uri
         FROM users
        WHERE id = ?`
    )
    .get(req.user.id);

  if (!user) {
    return res.status(404).json({ message: 'Account not found.' });
  }

  const normalizedUserName = (user.name || '').trim();
  const normalizedUserEmail = (user.email || '').trim().toLowerCase();
  const wantsNameChange = Boolean(trimmedName) && trimmedName !== normalizedUserName;
  const wantsEmailChange =
    Boolean(normalizedEmail) && normalizedEmail !== normalizedUserEmail;
  const wantsPasswordChange = Boolean(newPassword);
  const requiresPassword = wantsNameChange || wantsEmailChange || wantsPasswordChange;
  let passwordVerified = false;

  if (requiresPassword || current) {
    if (!current) {
      return res.status(400).json({ message: 'Current password is required for that change.' });
    }
    if (!verifyPassword(current, user.password_hash)) {
      return res.status(401).json({ message: 'Current password is incorrect.' });
    }
    passwordVerified = true;
  }

  const updates = {
    name: user.name,
    email: user.email,
    password_hash: user.password_hash,
    weight_category: user.weight_category || null,
    strava_client_id: user.strava_client_id || null,
    strava_client_secret: user.strava_client_secret || null,
    strava_redirect_uri: user.strava_redirect_uri || null,
    avatar_url: user.avatar_url || null,
    avatar_photo: user.avatar_photo || null,
    goal_sleep: user.goal_sleep ?? null,
  };

  if (wantsNameChange) {
    if (trimmedName.length < 2) {
      return res.status(400).json({ message: 'Name must be at least 2 characters.' });
    }
    if (violatesLimits(trimmedName, NAME_LIMITS)) {
      return res.status(400).json({
        message: `Name must be ${NAME_LIMITS.maxWords} words and ${NAME_LIMITS.maxLength} characters or fewer.`,
      });
    }
    const existingName = db
      .prepare('SELECT id FROM users WHERE LOWER(name) = ? AND id != ?')
      .get(trimmedName.toLowerCase(), req.user.id);
    if (existingName) {
      return res.status(409).json({ message: 'That name is already in use.' });
    }
    updates.name = trimmedName;
  }

  if (wantsEmailChange) {
    const existingEmail = db
      .prepare('SELECT id FROM users WHERE LOWER(email) = ? AND id != ?')
      .get(normalizedEmail, req.user.id);
    if (existingEmail) {
      return res.status(409).json({ message: 'That email is already in use.' });
    }
    updates.email = normalizedEmail;
  }

  if (trimmedWeightCategory || trimmedWeightCategory === '') {
    if (trimmedWeightCategory.length > 40) {
      return res.status(400).json({ message: 'Weight category must be 40 characters or fewer.' });
    }
    updates.weight_category = trimmedWeightCategory || null;
  }

  if (passwordVerified && /^[a-f0-9]{64}$/i.test(user.password_hash || '')) {
    updates.password_hash = hashPassword(current);
  }

  if (newPassword) {
    if (!passwordVerified) {
      return res
        .status(400)
        .json({ message: 'Enter your current password to change it.' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ message: 'New password must be at least 8 characters.' });
    }
    if (violatesLimits(newPassword, PASSWORD_LIMITS)) {
      return res.status(400).json({
        message: `Password must be ${PASSWORD_LIMITS.maxWords} words and ${PASSWORD_LIMITS.maxLength} characters or fewer.`,
      });
    }
    updates.password_hash = hashPassword(newPassword);
  }

  const hasStravaFields =
    trimmedStravaClientId !== undefined ||
    trimmedStravaClientSecret !== undefined ||
    trimmedStravaRedirectUri !== undefined;

  if (hasStravaFields) {
    const normalizedId = trimmedStravaClientId || '';
    const normalizedSecret = trimmedStravaClientSecret || '';
    const normalizedRedirect = trimmedStravaRedirectUri || '';
    const allEmpty = !normalizedId && !normalizedSecret && !normalizedRedirect;
    if (!allEmpty && (!normalizedId || !normalizedSecret || !normalizedRedirect)) {
      return res
        .status(400)
        .json({ message: 'Provide Strava client ID, secret, and redirect URL together.' });
    }
    if (normalizedRedirect && !/^https?:\/\//i.test(normalizedRedirect)) {
      return res.status(400).json({ message: 'Redirect URL must start with http:// or https://.' });
    }
    updates.strava_client_id = normalizedId || null;
    updates.strava_client_secret = normalizedSecret || null;
    updates.strava_redirect_uri = normalizedRedirect || null;
  }

  if (avatar !== undefined) {
    const normalizedAvatar = normalizeAvatarUrl(avatar);
    updates.avatar_url = normalizedAvatar;
  }

  if (avatarPhoto !== undefined) {
    let normalizedPhoto;
    try {
      normalizedPhoto = normalizeAvatarPhoto(avatarPhoto);
    } catch (error) {
      return res.status(400).json({ message: error.message || 'Invalid profile photo.' });
    }
    if (normalizedPhoto === undefined) {
      normalizedPhoto = updates.avatar_photo;
    }
    updates.avatar_photo = normalizedPhoto;
  }

  if (goalSleep !== undefined) {
    if (goalSleep === null || goalSleep === '') {
      updates.goal_sleep = null;
    } else {
      const numericGoal = Number(goalSleep);
      if (!Number.isFinite(numericGoal)) {
        return res.status(400).json({ message: 'Sleep goal must be a number of hours.' });
      }
      if (numericGoal < 3 || numericGoal > 12) {
        return res.status(400).json({ message: 'Sleep goal must be between 3 and 12 hours.' });
      }
      updates.goal_sleep = Math.round(numericGoal * 10) / 10;
    }
  }

  db.prepare(
    `UPDATE users
        SET name = ?,
            email = ?,
            password_hash = ?,
            weight_category = ?,
            strava_client_id = ?,
            strava_client_secret = ?,
            strava_redirect_uri = ?,
            avatar_url = ?,
            avatar_photo = ?,
            goal_sleep = ?
      WHERE id = ?`
  ).run(
    updates.name,
    updates.email,
    updates.password_hash,
    updates.weight_category,
    updates.strava_client_id,
    updates.strava_client_secret,
    updates.strava_redirect_uri,
    updates.avatar_url,
    updates.avatar_photo,
    updates.goal_sleep,
    req.user.id
  );

  const refreshed = {
    ...user,
    name: updates.name,
    email: updates.email,
    weight_category: updates.weight_category,
    strava_client_id: updates.strava_client_id,
    strava_client_secret: updates.strava_client_secret,
    strava_redirect_uri: updates.strava_redirect_uri,
    avatar_url: updates.avatar_url,
    avatar_photo: updates.avatar_photo,
    password_hash: undefined,
    role: coerceRole(user.role) || ROLES.ATHLETE,
  };

  const session = createSession({
    id: req.user.id,
    name: refreshed.name,
    email: refreshed.email,
    role: refreshed.role,
    avatar_url: updates.avatar_url,
    avatar_photo: updates.avatar_photo,
    weight_category: refreshed.weight_category,
    goal_steps: user.goal_steps,
    goal_calories: user.goal_calories,
    goal_sleep: updates.goal_sleep,
    goal_readiness: user.goal_readiness,
    strava_client_id: updates.strava_client_id,
    strava_client_secret: updates.strava_client_secret,
    strava_redirect_uri: updates.strava_redirect_uri,
  });

  return res.json(session);
});

module.exports = router;
