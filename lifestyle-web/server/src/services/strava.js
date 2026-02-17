const STRAVA_AUTH_URL = process.env.STRAVA_AUTH_URL || 'https://www.strava.com/oauth/authorize';
const STRAVA_TOKEN_URL = process.env.STRAVA_TOKEN_URL || 'https://www.strava.com/oauth/token';
const STRAVA_API_BASE = process.env.STRAVA_API_BASE || 'https://www.strava.com/api/v3';
const STRAVA_SCOPE = process.env.STRAVA_SCOPE || 'read,activity:read_all';

function resolveConfig(overrides = {}) {
  return {
    clientId: overrides.clientId || process.env.STRAVA_CLIENT_ID || '',
    clientSecret: overrides.clientSecret || process.env.STRAVA_CLIENT_SECRET || '',
    redirectUri: overrides.redirectUri || process.env.STRAVA_REDIRECT_URI || '',
    scope: overrides.scope || STRAVA_SCOPE,
  };
}

function hasStravaConfig(overrides = {}) {
  const config = resolveConfig(overrides);
  return Boolean(config.clientId && config.clientSecret && config.redirectUri);
}

function requireFetch() {
  if (typeof fetch !== 'function') {
    throw new Error('Strava integration requires Node.js 18+ with global fetch support.');
  }
  return fetch;
}

function buildAuthorizeUrl(state, overrides = {}) {
  if (!state) {
    throw new Error('Missing OAuth state.');
  }
  if (!hasStravaConfig(overrides)) {
    throw new Error('Strava credentials not configured.');
  }
  const config = resolveConfig(overrides);
  const query = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: config.scope,
    approval_prompt: 'auto',
    state,
  });
  return `${STRAVA_AUTH_URL}?${query.toString()}`;
}

async function exchangeCodeForTokens(code, overrides = {}) {
  if (!code) {
    throw new Error('Missing Strava authorization code.');
  }
  if (!hasStravaConfig(overrides)) {
    throw new Error('Strava credentials not configured.');
  }
  const config = resolveConfig(overrides);
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    grant_type: 'authorization_code',
  });
  const response = await requireFetch()(STRAVA_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload?.message || 'Strava token exchange failed.';
    throw new Error(message);
  }
  return payload;
}

async function refreshAccessToken(refreshToken, overrides = {}) {
  if (!refreshToken) {
    throw new Error('Missing Strava refresh token.');
  }
  if (!hasStravaConfig(overrides)) {
    throw new Error('Strava credentials not configured.');
  }
  const config = resolveConfig(overrides);
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
  const response = await requireFetch()(STRAVA_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload?.message || 'Unable to refresh Strava token.';
    throw new Error(message);
  }
  return payload;
}

async function fetchAthleteActivities(accessToken, { page = 1, perPage = 20, after } = {}) {
  if (!accessToken) {
    throw new Error('Missing Strava access token.');
  }
  const params = new URLSearchParams({ page: String(page), per_page: String(perPage) });
  if (Number.isFinite(after) && after > 0) {
    params.set('after', String(Math.floor(after)));
  }
  const response = await requireFetch()(`${STRAVA_API_BASE}/athlete/activities?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(payload)) {
    const message = payload?.message || 'Unable to fetch Strava activities.';
    throw new Error(message);
  }
  return payload;
}

async function fetchActivityDetails(accessToken, activityId) {
  if (!accessToken || !activityId) {
    throw new Error('Missing Strava activity context.');
  }
  const response = await requireFetch()(`${STRAVA_API_BASE}/activities/${activityId}?include_all_efforts=false`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload) {
    const message = payload?.message || 'Unable to fetch Strava activity detail.';
    throw new Error(message);
  }
  return payload;
}

module.exports = {
  hasStravaConfig,
  resolveConfig,
  buildAuthorizeUrl,
  exchangeCodeForTokens,
  refreshAccessToken,
  fetchAthleteActivities,
  fetchActivityDetails,
  STRAVA_SCOPE,
};
