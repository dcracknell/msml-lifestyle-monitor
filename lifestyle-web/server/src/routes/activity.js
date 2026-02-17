const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const { authenticate } = require('../services/session-store');
const { coerceRole, isHeadCoach } = require('../utils/role');
const {
  hasStravaConfig,
  resolveConfig,
  buildAuthorizeUrl,
  exchangeCodeForTokens,
  refreshAccessToken,
  fetchAthleteActivities,
  fetchActivityDetails,
  STRAVA_SCOPE,
} = require('../services/strava');

const router = express.Router();

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const WEEK_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const ALLOWED_SPORTS = new Set(['run', 'trailrun', 'virtualrun', 'walk', 'hike']);

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
    WHERE coach_id = ?
      AND athlete_id = ?`
);

const userStravaSettingsStatement = db.prepare(
  `SELECT strava_client_id     AS clientId,
          strava_client_secret AS clientSecret,
          strava_redirect_uri  AS redirectUri
     FROM users
    WHERE id = ?`
);

const sessionsStatement = db.prepare(
  `SELECT id,
          user_id          AS userId,
          source,
          source_id        AS sourceId,
          name,
          sport_type       AS sportType,
          start_time       AS startTime,
          distance_m       AS distance,
          moving_time_s    AS movingTime,
          elapsed_time_s   AS elapsedTime,
          average_hr       AS averageHr,
          max_hr           AS maxHr,
          average_pace_s   AS averagePace,
          average_cadence  AS averageCadence,
          average_power    AS averagePower,
          elevation_gain_m AS elevationGain,
          calories,
          perceived_effort AS perceivedEffort,
          vo2max_estimate  AS vo2maxEstimate,
          training_load    AS trainingLoad,
          strava_activity_id AS stravaActivityId
     FROM activity_sessions
    WHERE user_id = ?
    ORDER BY datetime(start_time) DESC
    LIMIT 24`
);

const publicStravaConnectionStatement = db.prepare(
  `SELECT user_id AS userId,
          athlete_id AS athleteId,
          athlete_name AS athleteName,
          last_sync AS lastSync,
          scope
     FROM strava_connections
    WHERE user_id = ?`
);

const privateStravaConnectionStatement = db.prepare(
  `SELECT user_id AS userId,
          athlete_id AS athleteId,
          athlete_name AS athleteName,
          client_id AS clientId,
          client_secret AS clientSecret,
          redirect_uri AS redirectUri,
          access_token AS accessToken,
          refresh_token AS refreshToken,
          expires_at AS expiresAt,
          scope,
          last_sync AS lastSync
     FROM strava_connections
    WHERE user_id = ?`
);

const upsertStravaConnectionStatement = db.prepare(
  `INSERT INTO strava_connections (
      user_id,
      athlete_id,
      athlete_name,
      client_id,
      client_secret,
      redirect_uri,
      access_token,
      refresh_token,
      expires_at,
      scope,
      last_sync,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id) DO UPDATE SET
      athlete_id = excluded.athlete_id,
      athlete_name = excluded.athlete_name,
      client_id = excluded.client_id,
      client_secret = excluded.client_secret,
      redirect_uri = excluded.redirect_uri,
      access_token = excluded.access_token,
      refresh_token = excluded.refresh_token,
      expires_at = excluded.expires_at,
      scope = excluded.scope,
      last_sync = NULL,
      updated_at = CURRENT_TIMESTAMP`
);

const deleteStravaConnectionStatement = db.prepare('DELETE FROM strava_connections WHERE user_id = ?');

const updateStravaTokensStatement = db.prepare(
  `UPDATE strava_connections
      SET access_token = ?,
          refresh_token = ?,
          expires_at = ?,
          updated_at = CURRENT_TIMESTAMP
    WHERE user_id = ?`
);

const updateStravaSyncStatement = db.prepare(
  `UPDATE strava_connections
      SET last_sync = ?,
          updated_at = CURRENT_TIMESTAMP
    WHERE user_id = ?`
);

const pruneStateStatement = db.prepare('DELETE FROM strava_oauth_states WHERE expires_at < ?');
const insertStateStatement = db.prepare(
  'INSERT INTO strava_oauth_states (user_id, state, expires_at) VALUES (?, ?, ?)'
);
const fetchStateStatement = db.prepare(
  'SELECT user_id AS userId FROM strava_oauth_states WHERE state = ? AND expires_at >= ?'
);
const deleteStateStatement = db.prepare('DELETE FROM strava_oauth_states WHERE state = ?');

const upsertStravaSessionStatement = db.prepare(
  `INSERT INTO activity_sessions (
      user_id,
      source,
      source_id,
      name,
      sport_type,
      start_time,
      distance_m,
      moving_time_s,
      elapsed_time_s,
      average_hr,
      max_hr,
      average_pace_s,
      average_cadence,
      average_power,
      elevation_gain_m,
      calories,
      perceived_effort,
      vo2max_estimate,
      training_load,
      strava_activity_id
    )
    VALUES (?, 'strava', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, strava_activity_id) DO UPDATE SET
      source_id = excluded.source_id,
      name = excluded.name,
      sport_type = excluded.sport_type,
      start_time = excluded.start_time,
      distance_m = excluded.distance_m,
      moving_time_s = excluded.moving_time_s,
      elapsed_time_s = excluded.elapsed_time_s,
      average_hr = excluded.average_hr,
      max_hr = excluded.max_hr,
      average_pace_s = excluded.average_pace_s,
      average_cadence = excluded.average_cadence,
      average_power = excluded.average_power,
      elevation_gain_m = excluded.elevation_gain_m,
      calories = excluded.calories,
      perceived_effort = excluded.perceived_effort,
      training_load = excluded.training_load,
      vo2max_estimate = excluded.vo2max_estimate`
);

const sessionByStravaStatement = db.prepare(
  `SELECT id
     FROM activity_sessions
    WHERE user_id = ?
      AND strava_activity_id = ?`
);

const deleteSplitsStatement = db.prepare('DELETE FROM activity_splits WHERE session_id = ?');
const insertSplitStatement = db.prepare(
  `INSERT INTO activity_splits (
      session_id,
      split_index,
      distance_m,
      moving_time_s,
      average_pace_s,
      elevation_gain_m,
      average_hr
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`
);

const replaceSplitsTransaction = db.transaction((sessionId, splits) => {
  deleteSplitsStatement.run(sessionId);
  splits.forEach((split) => {
    insertSplitStatement.run(
      sessionId,
      split.splitIndex,
      split.distance,
      split.movingTime,
      split.pace,
      split.elevation,
      split.heartRate
    );
  });
});

function getSplitsForSessions(sessionIds) {
  const normalizedIds = (sessionIds || [])
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => Number.isInteger(value) && value > 0);

  if (!normalizedIds.length) {
    return {};
  }
  const placeholders = normalizedIds.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT session_id AS sessionId,
              split_index AS splitIndex,
              distance_m AS distance,
              moving_time_s AS movingTime,
              average_pace_s AS pace,
              elevation_gain_m AS elevation,
              average_hr AS heartRate
         FROM activity_splits
        WHERE session_id IN (${placeholders})
        ORDER BY session_id ASC, split_index ASC`
    )
    .all(...normalizedIds);

  return rows.reduce((acc, row) => {
    if (!acc[row.sessionId]) {
      acc[row.sessionId] = [];
    }
    acc[row.sessionId].push(row);
    return acc;
  }, {});
}

function coerceNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function hasPersonalStravaConfig(settings = {}) {
  return Boolean(settings?.clientId && settings?.clientSecret && settings?.redirectUri);
}

function getUserStravaSettings(userId) {
  if (!userId) return null;
  const settings = userStravaSettingsStatement.get(userId);
  return settings || null;
}

function resolveEffectiveStravaSettings(userId) {
  const personal = getUserStravaSettings(userId);
  if (hasPersonalStravaConfig(personal)) {
    return { config: personal, source: 'user' };
  }
  if (hasStravaConfig()) {
    return { config: resolveConfig(), source: 'server' };
  }
  return { config: null, source: null };
}

function computePace(distanceMeters, movingTimeSeconds) {
  const normalizedDistance = coerceNumber(distanceMeters);
  const distanceKm = normalizedDistance ? normalizedDistance / 1000 : null;
  const seconds = coerceNumber(movingTimeSeconds);
  if (!distanceKm || distanceKm <= 0 || !seconds || seconds <= 0) {
    return null;
  }
  return seconds / distanceKm;
}

function normalizeSession(row) {
  return {
    id: row.id,
    source: row.source,
    sourceId: row.sourceId,
    userId: row.userId,
    name: row.name,
    sportType: row.sportType,
    startTime: row.startTime,
    distance: coerceNumber(row.distance),
    movingTime: coerceNumber(row.movingTime),
    elapsedTime: coerceNumber(row.elapsedTime),
    averageHr: coerceNumber(row.averageHr),
    maxHr: coerceNumber(row.maxHr),
    averagePace: coerceNumber(row.averagePace) || computePace(row.distance, row.movingTime),
    averageCadence: coerceNumber(row.averageCadence),
    averagePower: coerceNumber(row.averagePower),
    elevationGain: coerceNumber(row.elevationGain),
    calories: coerceNumber(row.calories),
    perceivedEffort: coerceNumber(row.perceivedEffort),
    vo2maxEstimate: coerceNumber(row.vo2maxEstimate),
    trainingLoad: coerceNumber(row.trainingLoad),
    stravaActivityId: row.stravaActivityId,
  };
}

function computeSummary(sessions) {
  if (!sessions.length) {
    return null;
  }
  const sorted = sessions.slice().sort((a, b) => new Date(b.startTime) - new Date(a.startTime));
  const latestDate = new Date(sorted[0].startTime || Date.now());
  const windowStart = new Date(latestDate.getTime() - WEEK_WINDOW_MS);

  let weeklyDistance = 0;
  let weeklyDuration = 0;
  let weeklyElevation = 0;
  let trainingLoad = 0;
  let vo2maxEstimate = null;
  let maxDistance = 0;
  let maxDistanceSession = null;

  sorted.forEach((session) => {
    const sessionDate = new Date(session.startTime || 0);
    if (sessionDate >= windowStart) {
      weeklyDistance += session.distance || 0;
      weeklyDuration += session.movingTime || 0;
      weeklyElevation += session.elevationGain || 0;
      trainingLoad += session.trainingLoad || 0;
      if (session.vo2maxEstimate) {
        vo2maxEstimate = session.vo2maxEstimate;
      }
    }
    if ((session.distance || 0) > maxDistance) {
      maxDistance = session.distance || 0;
      maxDistanceSession = session;
    }
  });

  const weeklyDistanceKm = weeklyDistance / 1000;
  const avgPace = computePace(weeklyDistance, weeklyDuration);

  return {
    weeklyDistanceKm: Number(weeklyDistanceKm.toFixed(2)),
    weeklyDurationMin: Math.round((weeklyDuration || 0) / 60),
    weeklyElevationGain: Math.round(weeklyElevation || 0),
    trainingLoad: Math.round(trainingLoad || 0),
    avgPaceSeconds: avgPace ? Math.round(avgPace) : null,
    longestRunKm: maxDistance ? Number((maxDistance / 1000).toFixed(2)) : null,
    longestRunName: maxDistanceSession?.name || null,
    vo2maxEstimate,
  };
}

function buildCharts(sessions) {
  if (!sessions.length) {
    return { mileageTrend: [], heartRatePace: [], trainingLoad: [] };
  }
  const chronological = sessions.slice().sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
  const mileageTrend = chronological.map((session) => ({
    startTime: session.startTime,
    distanceKm: session.distance ? Number((session.distance / 1000).toFixed(2)) : 0,
    movingMinutes: session.movingTime ? Number((session.movingTime / 60).toFixed(1)) : 0,
  }));

  const heartRatePace = chronological
    .filter((session) => session.averageHr && session.averagePace)
    .map((session) => ({
      label: session.name,
      heartRate: session.averageHr,
      paceSeconds: session.averagePace,
    }));

  const trainingLoad = chronological.map((session) => ({
    startTime: session.startTime,
    trainingLoad: session.trainingLoad || 0,
  }));

  return { mileageTrend, heartRatePace, trainingLoad };
}

function computeBestEfforts(sessions) {
  const efforts = [
    { label: 'Fastest 5K', target: 5000 },
    { label: 'Fastest 10K', target: 10000 },
    { label: 'Longest Run', target: null },
  ];

  return efforts.map((effort) => {
    if (!effort.target) {
      const longest = sessions.reduce((best, session) => {
        if (!best || (session.distance || 0) > (best.distance || 0)) {
          return session;
        }
        return best;
      }, null);
      return longest
        ? {
            label: effort.label,
            sessionId: longest.id,
            distance: longest.distance,
            paceSeconds: longest.averagePace,
            startTime: longest.startTime,
          }
        : null;
    }

    const matching = sessions
      .filter((session) => (session.distance || 0) >= effort.target)
      .map((session) => ({
        ...session,
        paceSeconds: session.averagePace || computePace(session.distance, session.movingTime),
      }))
      .filter((session) => session.paceSeconds);

    if (!matching.length) {
      return null;
    }

    const fastest = matching.reduce((best, session) => {
      if (!best || session.paceSeconds < best.paceSeconds) {
        return session;
      }
      return best;
    });

    return {
      label: effort.label,
      sessionId: fastest.id,
      distance: fastest.distance,
      paceSeconds: fastest.paceSeconds,
      startTime: fastest.startTime,
    };
  });
}

function buildStravaStatus(connection, { canManage = false, settings = null } = {}) {
  const serverEnabled = hasStravaConfig();
  const personalConfigured = hasPersonalStravaConfig(settings);
  const effectiveConfig = resolveConfig(personalConfigured ? settings : {});
  return {
    enabled: Boolean(serverEnabled || personalConfigured),
    configured: Boolean(serverEnabled || personalConfigured),
    connected: Boolean(connection),
    athleteId: connection?.athleteId || null,
    athleteName: connection?.athleteName || null,
    lastSync: connection?.lastSync || null,
    scope: connection?.scope || effectiveConfig.scope || STRAVA_SCOPE,
    redirectUri: effectiveConfig.redirectUri || null,
    canManage,
    requiresSetup: Boolean(canManage && !personalConfigured && !serverEnabled),
    usingServerDefaults: Boolean(!personalConfigured && serverEnabled),
  };
}

async function ensureValidAccessToken(connection) {
  if (!connection || !connection.userId) {
    throw new Error('Strava account not connected.');
  }
  let { accessToken } = connection;
  let refreshToken = connection.refreshToken;
  const expiresAt = Number(connection.expiresAt || 0);
  const nowSeconds = Math.floor(Date.now() / 1000);
  const configOverrides = {
    clientId: connection.clientId,
    clientSecret: connection.clientSecret,
    redirectUri: connection.redirectUri,
  };

  if (!hasPersonalStravaConfig(configOverrides)) {
    throw new Error('Strava credentials missing. Update your Strava keys in Profile and reconnect.');
  }

  if (!accessToken || !expiresAt || expiresAt <= nowSeconds + 60) {
    if (!refreshToken) {
      throw new Error('Strava session expired. Reconnect to continue syncing.');
    }
    const refreshed = await refreshAccessToken(refreshToken, configOverrides);
    accessToken = refreshed.access_token;
    refreshToken = refreshed.refresh_token || refreshToken;
    const newExpiresAt = refreshed.expires_at;
    updateStravaTokensStatement.run(accessToken, refreshToken, newExpiresAt, connection.userId);
  }

  return { accessToken, refreshToken, expiresAt };
}

async function saveStravaActivity(userId, activity, accessToken) {
  if (!activity || !activity.id) {
    return null;
  }
  const distance = coerceNumber(activity.distance) || 0;
  const movingTime = coerceNumber(activity.moving_time) || 0;
  const elapsedTime = coerceNumber(activity.elapsed_time) || movingTime;
  const pace = computePace(distance, movingTime);
  const elevation = coerceNumber(activity.total_elevation_gain);
  const perceivedEffort = coerceNumber(activity.perceived_exertion) || null;
  const trainingLoad = coerceNumber(activity.training_load || activity.suffer_score);
  const cadence = coerceNumber(activity.average_cadence);
  const power = coerceNumber(activity.weighted_average_watts);
  const heartRate = coerceNumber(activity.average_heartrate);
  const maxHr = coerceNumber(activity.max_heartrate);
  const calories = coerceNumber(activity.calories || activity.kilojoules);
  const sourceId = activity.external_id || activity.upload_id || activity.id;
  const startTime = activity.start_date || activity.start_date_local;

  upsertStravaSessionStatement.run(
    userId,
    sourceId ? String(sourceId) : null,
    activity.name || 'Strava activity',
    activity.sport_type || 'Run',
    startTime,
    distance || null,
    movingTime || null,
    elapsedTime || null,
    heartRate,
    maxHr,
    pace ? Math.round(pace) : null,
    cadence,
    power,
    elevation,
    calories,
    perceivedEffort,
    null,
    trainingLoad,
    activity.id
  );

  const sessionRow = sessionByStravaStatement.get(userId, activity.id);
  if (!sessionRow) {
    return null;
  }

  try {
    const detail = await fetchActivityDetails(accessToken, activity.id);
    if (detail && Array.isArray(detail.splits_metric) && detail.splits_metric.length) {
      const splits = detail.splits_metric
        .map((split, index) => {
          const distanceMeters = coerceNumber(split.distance) ? Number(split.distance) * 1000 : null;
          const moving = coerceNumber(split.moving_time);
          const paceSeconds = computePace(distanceMeters, moving) || coerceNumber(split.pace);
          return {
            splitIndex: split.split || index + 1,
            distance: distanceMeters,
            movingTime: moving,
            pace: paceSeconds ? Math.round(paceSeconds) : null,
            elevation: coerceNumber(split.elevation_difference),
            heartRate: coerceNumber(split.average_heartrate),
          };
        })
        .filter((split) => split.distance && split.movingTime);
      if (splits.length) {
        replaceSplitsTransaction(sessionRow.id, splits);
      }
    }
  } catch (error) {
    console.error('Unable to refresh Strava splits', error.message);
  }

  return sessionRow.id;
}

async function syncStravaActivitiesForUser(userId) {
  const connection = privateStravaConnectionStatement.get(userId);
  if (!connection) {
    throw new Error('Connect Strava before syncing.');
  }

  const { accessToken } = await ensureValidAccessToken(connection);
  const since = connection.lastSync ? new Date(connection.lastSync).getTime() : null;
  const afterSeconds = since ? Math.max(0, Math.floor(since / 1000) - 120) : undefined;

  const activities = await fetchAthleteActivities(accessToken, {
    perPage: 20,
    after: afterSeconds,
  });

  let imported = 0;
  for (const activity of activities) {
    const sport = (activity.sport_type || '').toLowerCase();
    if (!ALLOWED_SPORTS.has(sport)) {
      continue; // eslint-disable-line no-continue
    }
    // eslint-disable-next-line no-await-in-loop
    const sessionId = await saveStravaActivity(userId, activity, accessToken);
    if (sessionId) {
      imported += 1;
    }
  }

  const timestamp = new Date().toISOString();
  updateStravaSyncStatement.run(timestamp, userId);
  return { imported, fetched: activities.length, lastSync: timestamp };
}

router.get('/', authenticate, (req, res) => {
  req.user = { ...req.user, role: coerceRole(req.user.role) };
  const viewerId = req.user.id;
  const requestedId = Number.parseInt(req.query.athleteId, 10);
  const subjectId = Number.isNaN(requestedId) ? viewerId : requestedId;

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

  const sessions = sessionsStatement.all(subjectId).map(normalizeSession);
  const sessionIds = sessions.map((session) => session.id);
  const splits = getSplitsForSessions(sessionIds);
  const charts = buildCharts(sessions);
  const efforts = computeBestEfforts(sessions).filter(Boolean);
  const summary = computeSummary(sessions);
  const stravaConnection = publicStravaConnectionStatement.get(subjectId);
  const viewerSettings = subjectId === viewerId ? getUserStravaSettings(subjectId) : null;
  const strava = buildStravaStatus(stravaConnection, {
    canManage: subjectId === viewerId,
    settings: viewerSettings,
  });

  return res.json({
    subject,
    sessions,
    splits,
    charts,
    bestEfforts: efforts,
    summary,
    strava,
  });
});

router.post('/strava/connect', authenticate, (req, res) => {
  const { config } = resolveEffectiveStravaSettings(req.user.id);
  if (!config) {
    return res
      .status(422)
      .json({
        message:
          'Add your Strava API keys under Profile or configure STRAVA_CLIENT_ID/SECRET/REDIRECT_URI on the server before connecting.',
      });
  }
  pruneStateStatement.run(new Date().toISOString());
  const stateValue = crypto.randomBytes(24).toString('hex');
  const expiresAt = new Date(Date.now() + OAUTH_STATE_TTL_MS).toISOString();
  insertStateStatement.run(req.user.id, stateValue, expiresAt);
  const url = buildAuthorizeUrl(stateValue, config);
  return res.json({ url, expiresAt });
});

router.post('/strava/disconnect', authenticate, (req, res) => {
  deleteStravaConnectionStatement.run(req.user.id);
  return res.json({ message: 'Strava account disconnected.' });
});

router.post('/strava/sync', authenticate, async (req, res) => {
  try {
    const result = await syncStravaActivitiesForUser(req.user.id);
    return res.json(result);
  } catch (error) {
    return res.status(400).json({ message: error.message || 'Unable to sync Strava right now.' });
  }
});

router.get('/strava/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (error) {
    return res.status(400).send(`Strava error: ${error}`);
  }
  if (!code || !state) {
    return res.status(400).send('Missing OAuth parameters.');
  }
  pruneStateStatement.run(new Date().toISOString());
  const stateRow = fetchStateStatement.get(state, new Date().toISOString());
  if (!stateRow) {
    return res.status(410).send('Link expired. Please restart the Strava connection from the dashboard.');
  }

  const { config } = resolveEffectiveStravaSettings(stateRow.userId);
  if (!config) {
    return res
      .status(422)
      .send('Strava credentials missing. Configure them in Profile or on the server and try again.');
  }

  try {
    const payload = await exchangeCodeForTokens(code, config);
    const athleteName = payload?.athlete?.firstname
      ? `${payload.athlete.firstname} ${payload.athlete.lastname || ''}`.trim()
      : payload?.athlete?.username || null;
    upsertStravaConnectionStatement.run(
      stateRow.userId,
      payload?.athlete?.id || null,
      athleteName,
      config.clientId,
      config.clientSecret,
      config.redirectUri,
      payload.access_token,
      payload.refresh_token,
      payload.expires_at,
      Array.isArray(payload?.scope) ? payload.scope.join(',') : payload?.scope || STRAVA_SCOPE
    );
    deleteStateStatement.run(state);

    try {
      await syncStravaActivitiesForUser(stateRow.userId);
    } catch (syncError) {
      console.warn('Initial Strava sync failed:', syncError.message);
    }

    return res.send(`<!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <title>Strava linked</title>
          <style>
            body { font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, sans-serif; padding: 2rem; text-align: center; background: #060b23; color: #f2f4ff; }
            .card { max-width: 460px; margin: 0 auto; padding: 2rem; background: rgba(255,255,255,0.04); border-radius: 16px; }
            button { margin-top: 1.5rem; padding: 0.75rem 1.5rem; border-radius: 999px; border: none; background: #27d2fe; color: #040815; font-weight: 600; cursor: pointer; }
          </style>
        </head>
        <body>
          <div class="card">
            <h2>Strava connected ✅</h2>
            <p>You can return to the Lifestyle dashboard. This window will close automatically.</p>
            <button type="button" onclick="window.close()">Close window</button>
          </div>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'strava:connected' }, '*');
              setTimeout(() => window.close(), 1500);
            }
          </script>
        </body>
      </html>`);
  } catch (err) {
    console.error('Strava callback failed:', err.message);
    return res.status(500).send('Unable to complete Strava link. Try again later.');
  }
});

module.exports = router;
