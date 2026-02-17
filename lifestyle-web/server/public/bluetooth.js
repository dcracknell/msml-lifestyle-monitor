const SESSION_STORAGE_KEY = 'msml:lifestyle:session';
const FLUSH_INTERVAL_MS = 2500;
const MIN_FLUSH_SAMPLES = 10;
const LOCAL_BATCH_LIMIT = 400;

const bluetoothForm = document.getElementById('bluetoothForm');
const connectButton = document.getElementById('connectButton');
const disconnectButton = document.getElementById('disconnectButton');
const metricInput = document.getElementById('metricName');
const serviceInput = document.getElementById('serviceId');
const characteristicInput = document.getElementById('characteristicId');
const parserSelect = document.getElementById('parser');
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

const parserMap = {
  uint8: (dataView) => dataView.getUint8(0),
  uint16: (dataView) => dataView.getUint16(0, true),
  int16: (dataView) => dataView.getInt16(0, true),
  float32: (dataView) => (dataView.byteLength >= 4 ? dataView.getFloat32(0, true) : null),
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

function handleNotification(event) {
  const value = parseValue(event.target.value);
  if (value === null) {
    return;
  }
  const timestamp = Date.now();
  lastValue.dataset.currentValue = value;
  appendLogEntry(value, timestamp);
  pendingSamples.push({ ts: timestamp, value });
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
    const response = await fetch('/api/streams', {
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
    updateStats();
    setStatus(`Streaming ${payload?.metric || currentMetric} · last sync ${new Date(lastSyncTime).toLocaleTimeString()}`);
  } catch (error) {
    setStatus(`Sync failed: ${error.message}. Retrying…`);
    pendingSamples = batch.concat(pendingSamples);
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
