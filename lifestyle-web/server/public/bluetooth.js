const SESSION_STORAGE_KEY = 'msml:lifestyle:session';
const FLUSH_INTERVAL_MS = 2500;
const MIN_FLUSH_SAMPLES = 10;
const LOCAL_BATCH_LIMIT = 400;
const API_BASE_STORAGE_KEY = 'msml.api.base-url';
const API_BASE_QUERY_PARAM = 'apiBaseUrl';

function normalizeApiBaseUrl(value) {
  if (typeof value !== 'string') {
    return '';
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  try {
    const parsed = new URL(candidate);
    if (!/^https?:$/.test(parsed.protocol)) {
      return '';
    }
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString().replace(/\/+$/, '');
  } catch (error) {
    return '';
  }
}

function resolveCurrentOrigin() {
  if (typeof window === 'undefined') {
    return '';
  }
  const origin = typeof window.location?.origin === 'string' ? window.location.origin : '';
  if (!origin || origin === 'null') {
    return '';
  }
  return normalizeApiBaseUrl(origin);
}

function isLoopbackHostname(hostname = '') {
  const normalized = String(hostname || '').trim().toLowerCase();
  return (
    normalized === 'localhost' ||
    normalized === '127.0.0.1' ||
    normalized === '0.0.0.0' ||
    normalized === '[::1]' ||
    normalized === '::1'
  );
}

function isPrivateIpv4Hostname(hostname = '') {
  const octets = String(hostname || '')
    .trim()
    .split('.')
    .map((segment) => Number.parseInt(segment, 10));
  if (
    octets.length !== 4 ||
    octets.some((segment) => !Number.isInteger(segment) || segment < 0 || segment > 255)
  ) {
    return false;
  }

  if (octets[0] === 10) return true;
  if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) return true;
  if (octets[0] === 192 && octets[1] === 168) return true;
  if (octets[0] === 169 && octets[1] === 254) return true;
  return false;
}

function isLocalHostname(hostname = '') {
  const normalized = String(hostname || '').trim().toLowerCase();
  if (!normalized) return false;
  if (isLoopbackHostname(normalized)) return true;
  if (normalized.endsWith('.local')) return true;
  return isPrivateIpv4Hostname(normalized);
}

function shouldForceSameOriginApi(currentOrigin) {
  if (!currentOrigin) return false;
  try {
    const parsed = new URL(currentOrigin);
    if (!/^https?:$/.test(parsed.protocol)) {
      return false;
    }
    return !isLocalHostname(parsed.hostname);
  } catch (error) {
    return false;
  }
}

// Treat apex and www variants as equivalent so a stored override pointing at
// e.g. https://msmls.org doesn't force a cross-origin fetch from a page on
// https://www.msmls.org (the preflight redirect nulls Origin and CORS fails).
function isSameSiteOrigin(candidate, baseline) {
  if (!candidate || !baseline) return false;
  if (candidate === baseline) return true;
  try {
    const a = new URL(candidate);
    const b = new URL(baseline);
    if (a.protocol !== b.protocol) return false;
    const portA = a.port || (a.protocol === 'https:' ? '443' : '80');
    const portB = b.port || (b.protocol === 'https:' ? '443' : '80');
    if (portA !== portB) return false;
    const stripWww = (host) => host.toLowerCase().replace(/^www\./, '');
    return stripWww(a.hostname) === stripWww(b.hostname);
  } catch (error) {
    return false;
  }
}

function persistApiBaseUrl(value) {
  try {
    if (window.localStorage) {
      if (value) {
        window.localStorage.setItem(API_BASE_STORAGE_KEY, value);
      } else {
        window.localStorage.removeItem(API_BASE_STORAGE_KEY);
      }
    }
  } catch (error) {
    // Ignore storage failures.
  }
}

function resolveApiBaseUrl() {
  if (typeof window === 'undefined') {
    return { url: '', source: 'server' };
  }
  const currentOrigin = resolveCurrentOrigin();
  const forceSameOrigin = shouldForceSameOriginApi(currentOrigin);

  if (forceSameOrigin) {
    persistApiBaseUrl('');
    try {
      const params = new URLSearchParams(window.location?.search || '');
      if (params.has(API_BASE_QUERY_PARAM) && window.history?.replaceState) {
        const nextUrl = new URL(window.location.href);
        nextUrl.searchParams.delete(API_BASE_QUERY_PARAM);
        window.history.replaceState({}, '', nextUrl.toString());
      }
    } catch (error) {
      // Ignore query cleanup failures.
    }
    return { url: '', source: 'forced-same-origin' };
  }

  try {
    const params = new URLSearchParams(window.location?.search || '');
    if (params.has(API_BASE_QUERY_PARAM)) {
      const queryOverride = normalizeApiBaseUrl(params.get(API_BASE_QUERY_PARAM) || '');
      const queryIsSameSite = isSameSiteOrigin(queryOverride, currentOrigin);
      persistApiBaseUrl(queryIsSameSite ? '' : queryOverride);
      if (queryOverride) {
        return {
          url: queryIsSameSite ? '' : queryOverride,
          source: 'query',
        };
      }
      return { url: '', source: 'query' };
    }
  } catch (error) {
    // Ignore query parsing errors.
  }

  const runtimeOverride = normalizeApiBaseUrl(window.__MSML_API_BASE_URL || '');
  if (runtimeOverride) {
    return {
      url: isSameSiteOrigin(runtimeOverride, currentOrigin) ? '' : runtimeOverride,
      source: 'runtime',
    };
  }

  const metaOverride = normalizeApiBaseUrl(
    document.querySelector('meta[name="msml-api-base-url"]')?.content || ''
  );
  if (metaOverride) {
    return {
      url: isSameSiteOrigin(metaOverride, currentOrigin) ? '' : metaOverride,
      source: 'meta',
    };
  }

  try {
    const stored = normalizeApiBaseUrl(window.localStorage?.getItem(API_BASE_STORAGE_KEY) || '');
    if (stored) {
      if (isSameSiteOrigin(stored, currentOrigin)) {
        persistApiBaseUrl('');
        return { url: '', source: 'storage' };
      }
      return { url: stored, source: 'storage' };
    }
  } catch (error) {
    // Ignore storage failures.
  }

  if (window.location?.protocol === 'file:') {
    return { url: 'http://localhost:4000', source: 'file' };
  }

  return { url: '', source: 'same-origin' };
}

const initialApiBase = resolveApiBaseUrl();
let apiBaseUrl = initialApiBase.url;
let apiBaseSource = initialApiBase.source;
let apiBaseFallbackUsed = false;
const nativeFetch =
  typeof window !== 'undefined' && typeof window.fetch === 'function'
    ? window.fetch.bind(window)
    : null;

function resolveApiRequestUrl(targetUrl, baseUrl = apiBaseUrl) {
  if (!baseUrl || typeof targetUrl !== 'string') {
    return targetUrl;
  }
  if (/^\/api(?:\/|$)/i.test(targetUrl)) {
    return `${baseUrl}${targetUrl}`;
  }
  return targetUrl;
}

function isCrossOriginApiBase(baseUrl = apiBaseUrl) {
  const currentOrigin = resolveCurrentOrigin();
  return Boolean(baseUrl && currentOrigin && normalizeApiBaseUrl(baseUrl) !== currentOrigin);
}

function isRetryableRelativeApiRequest(input) {
  if (typeof input === 'string') {
    return /^\/api(?:\/|$)/i.test(input);
  }
  if (typeof URL !== 'undefined' && input instanceof URL) {
    return /^\/api(?:\/|$)/i.test(input.pathname || '');
  }
  return false;
}

function fallbackToSameOriginApi(reason) {
  const previousBaseUrl = apiBaseUrl;
  const previousSource = apiBaseSource;
  if (previousSource === 'storage' || previousSource === 'query') {
    persistApiBaseUrl('');
  }
  if (previousSource === 'query' && typeof window !== 'undefined' && window.history?.replaceState) {
    try {
      const nextUrl = new URL(window.location.href);
      nextUrl.searchParams.delete(API_BASE_QUERY_PARAM);
      window.history.replaceState({}, '', nextUrl.toString());
    } catch (error) {
      // Ignore URL rewrite failures.
    }
  }
  apiBaseUrl = '';
  apiBaseSource = 'same-origin-fallback';
  apiBaseFallbackUsed = true;
  const suffix = reason ? ` (${reason})` : '';
  console.warn(
    `Bluetooth page falling back to same-origin API after ${previousSource} API base failed: ${previousBaseUrl || '(none)'}${suffix}`
  );
}

function resolveFetchInput(input, baseUrl = apiBaseUrl) {
  if (typeof input === 'string') {
    return resolveApiRequestUrl(input, baseUrl);
  }

  if (typeof URL !== 'undefined' && input instanceof URL) {
    return resolveApiRequestUrl(input.toString(), baseUrl);
  }

  if (typeof Request !== 'undefined' && input instanceof Request) {
    const resolvedUrl = resolveApiRequestUrl(input.url, baseUrl);
    if (resolvedUrl !== input.url) {
      return new Request(resolvedUrl, input);
    }
  }

  return input;
}

async function isCorsRejectionResponse(response) {
  if (!response || response.ok || response.status !== 400) {
    return false;
  }
  const responseUrl = typeof response.url === 'string' ? response.url : '';
  if (!/\/api(?:\/|$)/i.test(responseUrl)) {
    return false;
  }
  try {
    const bodyText = await response.clone().text();
    return /not allowed by cors/i.test(bodyText);
  } catch (error) {
    return false;
  }
}

async function apiFetch(input, init) {
  if (!nativeFetch) {
    throw new Error('Fetch is unavailable in this browser.');
  }

  try {
    const response = await nativeFetch(resolveFetchInput(input), init);
    if (
      !apiBaseFallbackUsed &&
      isCrossOriginApiBase() &&
      isRetryableRelativeApiRequest(input) &&
      (await isCorsRejectionResponse(response))
    ) {
      fallbackToSameOriginApi('CORS rejection');
      return nativeFetch(resolveFetchInput(input, ''), init);
    }
    return response;
  } catch (error) {
    const message = String(error?.message || '').trim().toLowerCase();
    const shouldRetry =
      !apiBaseFallbackUsed &&
      isCrossOriginApiBase() &&
      isRetryableRelativeApiRequest(input) &&
      (!message ||
        message === 'failed to fetch' ||
        message.includes('networkerror') ||
        message.includes('load failed') ||
        message.includes('cors'));
    if (shouldRetry) {
      fallbackToSameOriginApi(error?.message || 'network error');
      return nativeFetch(resolveFetchInput(input, ''), init);
    }
    throw error;
  }
}

const bluetoothForm = document.getElementById('bluetoothForm');
const connectButton = document.getElementById('connectButton');
const disconnectButton = document.getElementById('disconnectButton');
const metricInput = document.getElementById('metricName');
const serviceInput = document.getElementById('serviceId');
const characteristicInput = document.getElementById('characteristicId');
const parserSelect = document.getElementById('parser');
const profileSelect = document.getElementById('profileSelect');
const statusText = document.getElementById('statusText');
const bufferSize = document.getElementById('bufferSize');
const sentCount = document.getElementById('sentCount');
const lastValue = document.getElementById('lastValue');
const lastSync = document.getElementById('lastSync');
const logList = document.getElementById('sampleLog');
const authWarning = document.getElementById('authWarning');
const browserWarning = document.getElementById('browserWarning');

const bluetoothSupported = typeof navigator !== 'undefined' && Boolean(navigator.bluetooth);
if (!bluetoothSupported) {
  browserWarning.classList.remove('hidden');
  connectButton.disabled = true;
}

function readPersistedSession() {
  try {
    const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.token) return null;
    return parsed;
  } catch (error) {
    return null;
  }
}

const session = readPersistedSession();
if (!session) {
  authWarning.classList.remove('hidden');
  connectButton.disabled = true;
}

let device = null;
let characteristic = null;
let pendingSamples = [];
let totalSent = 0;
let flushTimer = null;
let currentMetric = '';
let lastSyncTime = null;
let isConnecting = false;
// Line buffer for the jsontext parser – accumulates BLE notification bytes
// until a complete newline-terminated JSON line is received.
let lineBuffer = '';

// Persist pendingSamples to localStorage so data survives page reloads and
// unexpected closes even if the in-flight upload hasn't completed yet.
const PENDING_KEY = 'msml:bt:pending';

function persistPending() {
  try {
    if (pendingSamples.length > 0) {
      window.localStorage?.setItem(
        PENDING_KEY,
        JSON.stringify({ metric: currentMetric, samples: pendingSamples })
      );
    } else {
      window.localStorage?.removeItem(PENDING_KEY);
    }
  } catch {
    // ignore storage errors
  }
}

function loadPersistedPending() {
  try {
    const raw = window.localStorage?.getItem(PENDING_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return;
    if (!Array.isArray(parsed.samples) || !parsed.samples.length) return;
    const metric = typeof parsed.metric === 'string' && parsed.metric ? parsed.metric : null;
    if (!metric) return;
    const valid = parsed.samples.filter(
      (s) => s && typeof s.ts === 'number' && typeof s.value === 'number'
    );
    if (!valid.length) return;
    currentMetric = metric;
    pendingSamples = valid;
    if (metricInput) metricInput.value = metric;
    updateStats();
  } catch {
    // ignore storage errors
  }
}

// Profile presets – mirrors the mobile app's BLUETOOTH_PROFILE_OPTIONS.
const PROFILES = {
  custom:                 { serviceUUID: '',       characteristicUUID: '',       metric: '',                 parser: 'jsontext' },
  ble_hrm:               { serviceUUID: '180D',   characteristicUUID: '2A37',   metric: 'exercise.hr',      parser: 'ble_hrm'  },
  arduino_hm10:          { serviceUUID: 'FFE0',   characteristicUUID: 'FFE1',   metric: 'sensor.aht20_temperature_c',parser: 'jsontext' },
  apple_watch_companion: { serviceUUID: 'FFF0',   characteristicUUID: 'FFF1',   metric: 'exercise.hr',      parser: 'jsontext' },
  ppg_raw_500hz:         { serviceUUID: '',       characteristicUUID: '',       metric: 'ppg.raw',          parser: 'float32'  },
};

if (profileSelect) {
  profileSelect.addEventListener('change', () => {
    const preset = PROFILES[profileSelect.value];
    if (!preset) return;
    if (preset.serviceUUID)        serviceInput.value        = preset.serviceUUID;
    if (preset.characteristicUUID) characteristicInput.value = preset.characteristicUUID;
    if (preset.metric)             metricInput.value         = preset.metric;
    parserSelect.value = preset.parser;
  });
}

const parserMap = {
  uint8:   (dv) => dv.getUint8(0),
  uint16:  (dv) => dv.getUint16(0, true),
  int16:   (dv) => dv.getInt16(0, true),
  float32: (dv) => (dv.byteLength >= 4 ? dv.getFloat32(0, true) : null),
  // Standard BLE Heart Rate Measurement characteristic (0x2A37).
  // Byte 0 = flags; bit 0 selects uint8 (0) or uint16 (1) HR format.
  ble_hrm: (dv) => {
    if (dv.byteLength < 2) return null;
    const flags = dv.getUint8(0);
    return (flags & 0x01) ? (dv.byteLength >= 3 ? dv.getUint16(1, true) : null) : dv.getUint8(1);
  },
};

function updateStats() {
  bufferSize.textContent = pendingSamples.length;
  sentCount.textContent = totalSent;
  lastValue.textContent = lastValue.dataset.currentValue ?? '—';
  lastSync.textContent = lastSyncTime ? new Date(lastSyncTime).toLocaleTimeString() : '—';
}

function appendLogEntry(value, timestamp) {
  if (logList.firstElementChild?.classList.contains('muted')) {
    logList.firstElementChild.remove();
  }
  const entry = document.createElement('li');
  const time = new Date(timestamp).toLocaleTimeString();
  entry.innerHTML = `<span>${time}</span><span>${value}</span>`;
  logList.prepend(entry);
  if (logList.children.length > 40) {
    logList.removeChild(logList.lastElementChild);
  }
}

function setStatus(message) {
  statusText.textContent = message;
}

function normalizeUuid(input) {
  if (!input) {
    return null;
  }
  const value = input.trim();
  if (!value) return null;
  try {
    if (typeof window.BluetoothUUID?.getService === 'function') {
      return window.BluetoothUUID.getService(value);
    }
  } catch (error) {
    // ignore and return the raw value
  }
  return value;
}

async function connectBluetoothDevice() {
  if (!bluetoothSupported) return;
  if (!session) return;
  if (isConnecting) return;

  const metric = metricInput.value.trim();
  const serviceId = normalizeUuid(serviceInput.value);
  const characteristicId = normalizeUuid(characteristicInput.value);

  if (!metric || !serviceId || !characteristicId) {
    setStatus('Please fill in metric, service, and characteristic.');
    return;
  }

  isConnecting = true;
  connectButton.disabled = true;
  setStatus('Requesting Bluetooth device access…');

  try {
    const deviceRequest = await navigator.bluetooth.requestDevice({
      filters: [{ services: [serviceId] }],
      optionalServices: [serviceId],
    });
    device = deviceRequest;
    currentMetric = metric;
    device.addEventListener('gattserverdisconnected', handleDisconnect);

    const server = await device.gatt.connect();
    const service = await server.getPrimaryService(serviceId);
    characteristic = await service.getCharacteristic(characteristicId);
    characteristic.addEventListener('characteristicvaluechanged', handleNotification);
    await characteristic.startNotifications();

    flushTimer = flushTimer || setInterval(() => flushSamples(false), FLUSH_INTERVAL_MS);
    disconnectButton.disabled = false;
    setStatus(`Streaming ${metric} from ${device.name || 'Bluetooth device'}.`);
  } catch (error) {
    console.error('Bluetooth error', error);
    setStatus(error?.message ? `Unable to connect: ${error.message}` : 'Unable to connect to device.');
    connectButton.disabled = false;
  } finally {
    isConnecting = false;
  }
}

function handleDisconnect() {
  disconnectButton.disabled = true;
  connectButton.disabled = false;
  setStatus('Device disconnected. You can reconnect when ready.');
  characteristic?.removeEventListener('characteristicvaluechanged', handleNotification);
  characteristic = null;
  device = null;
  lineBuffer = '';
}

async function disconnectDevice() {
  if (characteristic) {
    try {
      await characteristic.stopNotifications();
    } catch (error) {
      // ignore
    }
  }
  if (device?.gatt?.connected) {
    try {
      device.gatt.disconnect();
    } catch (error) {
      // ignore disconnect issues
    }
  }
  handleDisconnect();
}

function parseValue(dataView) {
  if (!dataView || dataView.byteLength === 0) {
    return null;
  }
  const parser = parserMap[parserSelect.value];
  if (!parser) {
    return null;
  }
  try {
    const value = parser(dataView);
    if (typeof value === 'number' && Number.isFinite(value)) {
      return Math.round(value * 100) / 100;
    }
  } catch (error) {
    console.warn('Unable to parse sample', error);
  }
  return null;
}

// ── JSON payload helpers ────────────────────────────────────────────────────

function parseTs(raw, fallback) {
  if (raw == null || raw === '') return fallback;
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) return Math.round(n);
  const d = Date.parse(String(raw));
  return Number.isNaN(d) ? fallback : Math.round(d);
}

function parseNum(raw) {
  const n = Number(raw);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

// Extract well-known fields from Apple Watch / rich JSON payloads.
// Mirrors the mobile app's parseKnownWatchPayload logic.
function parseWatchFields(obj, now) {
  const nestedKeys = ['activity', 'exercise', 'workout', 'metrics', 'data'];
  const records = [obj, ...nestedKeys.map(k => obj[k]).filter(v => v && typeof v === 'object' && !Array.isArray(v))];
  const tsSource = records.map(r => r.ts ?? r.timestamp ?? r.time ?? r.date).find(v => v != null);
  const ts = parseTs(tsSource, now);
  const results = [];
  function extract(keys, metric) {
    for (const r of records) {
      for (const k of keys) {
        if (!(k in r)) continue;
        const v = parseNum(r[k]);
        if (v !== null) { results.push({ metric, ts, value: v }); return; }
      }
    }
  }
  extract(['heartRate','heart_rate','hr','bpm','currentHeartRate','averageHeartRate','avg_heart_rate'], 'exercise.hr');
  extract(['restingHeartRate','resting_hr','restingHr','resting_heart_rate'], 'vitals.resting_hr');
  extract(['hrv','heartRateVariability','heart_rate_variability'], 'vitals.hrv');
  extract(['spo2','spO2','bloodOxygen','blood_oxygen'], 'vitals.spo2');
  extract(['steps','stepCount','step_count'], 'activity.steps');
  extract(['distanceKm','distance_km'], 'exercise.distance');
  extract(['pace','paceMinPerKm','pace_min_per_km'], 'exercise.pace');
  extract(['calories','activeCalories','active_calories','caloriesBurned'], 'exercise.calories');
  extract(['cadence','stepsPerMinute','steps_per_minute'], 'exercise.cadence');
  extract(['power','watts'], 'exercise.power');
  extract(['weightKg','weight_kg','bodyWeight','body_weight'], 'body.weight_kg');
  extract(['glucose','bloodGlucose','blood_glucose'], 'vitals.glucose');
  extract(['systolic','systolicBp','systolic_bp'], 'vitals.systolic_bp');
  extract(['diastolic','diastolicBp','diastolic_bp'], 'vitals.diastolic_bp');
  extract(['readiness','readinessScore','readiness_score','recoveryScore','recovery_score'], 'vitals.readiness');
  return results;
}

// Parse a complete JSON text into one or more {metric, ts, value} samples.
// Supports: single object, array of objects, batch {metric, samples}, and
// Apple Watch companion rich JSON with nested known fields.
function parseJsonLine(line, fallbackMetric) {
  const now = Date.now();
  let obj;
  try { obj = JSON.parse(line); } catch { return []; }

  // Array: [{metric?, value, ts?}, ...]
  if (Array.isArray(obj)) {
    return obj.flatMap(e => {
      if (!e || typeof e !== 'object' || !('value' in e)) return [];
      const v = parseNum(e.value);
      if (v === null) return [];
      return [{ metric: (typeof e.metric === 'string' && e.metric.trim()) || fallbackMetric, ts: parseTs(e.ts ?? e.timestamp ?? e.time, now), value: v }];
    });
  }

  if (!obj || typeof obj !== 'object') return [];

  // Batch: {metric?, samples: [{ts?, value}, ...]}
  if (Array.isArray(obj.samples)) {
    const batchMetric = (typeof obj.metric === 'string' && obj.metric.trim()) || fallbackMetric;
    return obj.samples.flatMap(s => {
      if (!s || typeof s !== 'object') return [];
      const v = parseNum(s.value);
      if (v === null) return [];
      return [{ metric: (typeof s.metric === 'string' && s.metric.trim()) || batchMetric, ts: parseTs(s.ts ?? s.timestamp ?? s.time, now), value: v }];
    });
  }

  // Simple {metric?, value, ts?}
  if ('value' in obj) {
    const v = parseNum(obj.value);
    if (v === null) return [];
    return [{ metric: (typeof obj.metric === 'string' && obj.metric.trim()) || fallbackMetric, ts: parseTs(obj.ts ?? obj.timestamp ?? obj.time, now), value: v }];
  }

  // Apple Watch / rich JSON — extract by known field names.
  return parseWatchFields(obj, now);
}

function handleJsonTextNotification(dataView) {
  if (!dataView || dataView.byteLength === 0) return;
  let chunk = '';
  for (let i = 0; i < dataView.byteLength; i++) {
    chunk += String.fromCharCode(dataView.getUint8(i));
  }
  lineBuffer += chunk;

  // Overflow guard: discard corrupt/oversized buffers.
  if (lineBuffer.length > 1024) {
    console.warn('[BLE] Line buffer overflow – discarding. Check baud rate and UUID configuration.');
    lineBuffer = '';
    return;
  }

  const lines = lineBuffer.split('\n');
  lineBuffer = lines.pop() || '';

  // Apple Watch companion payloads may arrive as a complete JSON object
  // without a trailing '\n'. Process immediately rather than waiting.
  const remainder = lineBuffer.trim();
  if (remainder.startsWith('{') && remainder.endsWith('}')) {
    try { JSON.parse(remainder); lines.push(lineBuffer); lineBuffer = ''; } catch { /* incomplete */ }
  }

  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, '').trim();
    if (!line) continue;

    const samples = parseJsonLine(line, currentMetric || 'sensor.mock');
    if (!samples.length) continue;

    const primary = samples[0];

    // Flush buffer before switching primary metric.
    if (primary.metric !== currentMetric && pendingSamples.length > 0) {
      flushSamples(true);
    }
    currentMetric = primary.metric;
    metricInput.value = primary.metric;
    lastValue.dataset.currentValue = primary.value;
    appendLogEntry(
      samples.length > 1
        ? samples.map(s => `${s.metric}: ${s.value}`).join(' · ')
        : `${primary.metric}: ${primary.value}`,
      primary.ts
    );

    pendingSamples.push({ ts: primary.ts, value: primary.value });
    persistPending();
    updateStats();
    flushSamples(true);

    // For multi-metric payloads (Apple Watch companion, JSON arrays), upload
    // each additional metric immediately as a separate API call.
    const extras = samples.slice(1);
    if (extras.length && session?.token) {
      const byMetric = new Map();
      for (const s of extras) {
        if (!byMetric.has(s.metric)) byMetric.set(s.metric, []);
        byMetric.get(s.metric).push({ timestamp: s.ts, value: s.value });
      }
      for (const [metric, metricSamples] of byMetric) {
        apiFetch('/api/streams', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
          body: JSON.stringify({ metric, samples: metricSamples }),
        }).then(r => r.ok ? r.json() : Promise.reject(new Error(r.status)))
          .then(payload => { totalSent += payload?.accepted ?? metricSamples.length; lastSyncTime = Date.now(); updateStats(); })
          .catch(err => console.warn(`[BLE] Failed to upload ${metric}:`, err.message));
      }
    }
  }
}

function handleNotification(event) {
  if (parserSelect.value === 'jsontext') {
    handleJsonTextNotification(event.target.value);
    return;
  }
  const value = parseValue(event.target.value);
  if (value === null) {
    return;
  }
  const timestamp = Date.now();
  lastValue.dataset.currentValue = value;
  appendLogEntry(value, timestamp);
  pendingSamples.push({ ts: timestamp, value });
  persistPending();
  updateStats();
  if (pendingSamples.length >= MIN_FLUSH_SAMPLES) {
    flushSamples(false);
  }
}

async function flushSamples(force) {
  if (!session?.token || !pendingSamples.length) {
    return;
  }
  if (!force && pendingSamples.length < MIN_FLUSH_SAMPLES) {
    return;
  }
  const batch = pendingSamples.splice(0, Math.min(pendingSamples.length, LOCAL_BATCH_LIMIT));
  updateStats();

  try {
    const response = await apiFetch('/api/streams', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.token}`,
      },
      body: JSON.stringify({
        metric: currentMetric || 'sensor_metric',
        samples: batch.map((sample) => ({
          timestamp: sample.ts,
          value: sample.value,
        })),
      }),
    });
    if (!response.ok) {
      throw new Error(`API responded with ${response.status}`);
    }
    const payload = await response.json();
    totalSent += payload?.accepted ?? batch.length;
    lastSyncTime = Date.now();
    persistPending();
    updateStats();
    setStatus(`Streaming ${payload?.metric || currentMetric} · last sync ${new Date(lastSyncTime).toLocaleTimeString()}`);
  } catch (error) {
    setStatus(`Sync failed: ${error.message}. Retrying…`);
    pendingSamples = batch.concat(pendingSamples);
    persistPending();
    updateStats();
  }
}

bluetoothForm.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!session) {
    setStatus('Sign in on the main dashboard before connecting a device.');
    authWarning.classList.remove('hidden');
    return;
  }
  connectBluetoothDevice();
});

disconnectButton.addEventListener('click', () => {
  disconnectDevice();
});

window.addEventListener('beforeunload', () => {
  if (flushTimer) {
    clearInterval(flushTimer);
  }
  flushSamples(true);
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    flushSamples(true);
  }
});

updateStats();
// Restore any samples that were buffered before the last page close and
// immediately attempt to send them if a session is available.
loadPersistedPending();
if (session && pendingSamples.length > 0) {
  flushSamples(true);
}
