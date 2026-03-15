const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

function parseIntegerEnv(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  if (parsed < min) {
    return min;
  }
  if (parsed > max) {
    return max;
  }
  return parsed;
}

const NUT_EXPRESS_MODE = process.env.NUT_EXPRESS_MODE === 'true';
const NUT_EXPRESS_URL = (process.env.NUT_EXPRESS_URL || 'http://127.0.0.1:8001').replace(
  /\/$/,
  ''
);
const NUT_EXPRESS_PORT = parseIntegerEnv(process.env.NUT_EXPRESS_PORT, 8001, {
  min: 1,
  max: 65535,
});
const LOCAL_VENV_PYTHON = path.resolve(__dirname, '..', '..', 'NUT_model', '.venv', 'bin', 'python');
const LOCAL_VENV_WINDOWS_PYTHON = path.resolve(
  __dirname,
  '..',
  '..',
  'NUT_model',
  '.venv',
  'Scripts',
  'python.exe'
);
const DEFAULT_PYTHON_BIN =
  process.env.NUT_MODEL_PYTHON_BIN ||
  (fs.existsSync(LOCAL_VENV_PYTHON)
    ? LOCAL_VENV_PYTHON
    : fs.existsSync(LOCAL_VENV_WINDOWS_PYTHON)
      ? LOCAL_VENV_WINDOWS_PYTHON
      : 'python');
const DEFAULT_MODEL_PATH =
  process.env.NUT_MODEL_WEIGHTS ||
  path.resolve(__dirname, '..', '..', 'NUT_model', 'checkpoint', 'canet_NUT.pth');
const DEFAULT_LABELS_PATH =
  process.env.NUT_MODEL_LABELS ||
  path.resolve(__dirname, '..', '..', 'data', 'FoodSeg103', 'category_id.txt');
const DEFAULT_WORKER_SCRIPT_PATH = path.resolve(__dirname, '..', '..', 'NUT_model', 'nut_server.py');
const STARTUP_TIMEOUT_MS = Math.max(
  parseIntegerEnv(process.env.NUT_MODEL_TIMEOUT_MS, 45000, {
    min: 1000,
    max: 300000,
  }),
  120000
);

let workerProcess = null;
let startupPromise = null;
let shutdownHandlersInstalled = false;
let workerLastError = null;
let workerLastExit = null;

function isLikelyPath(target) {
  return typeof target === 'string' && /[\\/]/.test(target);
}

function ensureReadableFile(targetPath, label) {
  if (!targetPath) {
    return;
  }
  if (!fs.existsSync(targetPath)) {
    throw new Error(`Cannot start NUT express worker: missing ${label} at ${targetPath}.`);
  }
}

function isLocalNutExpressUrl(targetUrl) {
  try {
    const parsed = new URL(targetUrl);
    return ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
  } catch (error) {
    return false;
  }
}

async function fetchWorkerHealth(timeoutMs = 1500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${NUT_EXPRESS_URL}/health`, {
      method: 'GET',
      signal: controller.signal,
    });
    if (!response.ok) {
      return null;
    }
    const payload = await response.json();
    return payload && typeof payload === 'object' ? payload : null;
  } catch (error) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function writePrefixed(stream, sink, prefix) {
  if (!stream) {
    return;
  }

  let buffered = '';
  stream.on('data', (chunk) => {
    buffered += String(chunk);
    const lines = buffered.split(/\r?\n/);
    buffered = lines.pop() || '';
    lines.forEach((line) => {
      sink.write(`${prefix}${line}\n`);
    });
  });
  stream.on('end', () => {
    if (buffered) {
      sink.write(`${prefix}${buffered}\n`);
      buffered = '';
    }
  });
}

function terminateWorker(signal = 'SIGTERM') {
  if (!workerProcess || workerProcess.exitCode !== null) {
    return;
  }

  workerProcess.kill(signal);
  setTimeout(() => {
    if (workerProcess && workerProcess.exitCode === null) {
      workerProcess.kill('SIGKILL');
    }
  }, 2000).unref();
}

function installShutdownHandlers() {
  if (shutdownHandlersInstalled) {
    return;
  }
  shutdownHandlersInstalled = true;

  process.on('exit', () => {
    terminateWorker();
  });

  ['SIGINT', 'SIGTERM', 'SIGUSR2'].forEach((signal) => {
    const handler = () => {
      terminateWorker(signal === 'SIGUSR2' ? 'SIGTERM' : signal);
      process.removeListener(signal, handler);
      process.kill(process.pid, signal);
    };
    process.on(signal, handler);
  });
}

function spawnWorkerProcess() {
  ensureReadableFile(DEFAULT_WORKER_SCRIPT_PATH, 'worker script');
  ensureReadableFile(DEFAULT_MODEL_PATH, 'model weights');
  if (DEFAULT_LABELS_PATH) {
    ensureReadableFile(DEFAULT_LABELS_PATH, 'label map');
  }
  if (isLikelyPath(DEFAULT_PYTHON_BIN)) {
    ensureReadableFile(DEFAULT_PYTHON_BIN, 'Python runtime');
  }

  const args = [
    DEFAULT_WORKER_SCRIPT_PATH,
    '--port',
    String(NUT_EXPRESS_PORT),
    '--model',
    DEFAULT_MODEL_PATH,
  ];
  if (DEFAULT_LABELS_PATH) {
    args.push('--labels', DEFAULT_LABELS_PATH);
  }

  workerProcess = spawn(DEFAULT_PYTHON_BIN, args, {
    env: {
      ...process.env,
      PYTHONUNBUFFERED: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  workerLastError = null;
  workerLastExit = null;

  writePrefixed(workerProcess.stdout, process.stdout, '[nut-worker] ');
  writePrefixed(workerProcess.stderr, process.stderr, '[nut-worker] ');

  workerProcess.on('exit', (code, signal) => {
    const details =
      signal ? `signal ${signal}` : `code ${Number.isInteger(code) ? code : 'unknown'}`;
    workerLastExit = details;
    console.log(`[nut-worker] exited with ${details}.`);
    workerProcess = null;
  });

  workerProcess.on('error', (error) => {
    workerLastError = error;
    console.error(`[nut-worker] failed to start: ${error.message}`);
  });

  installShutdownHandlers();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForWorkerReady(timeoutMs = STARTUP_TIMEOUT_MS, { expectManagedProcess = false } = {}) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (expectManagedProcess) {
      if (workerLastError) {
        throw new Error(`nut_server.py failed to start: ${workerLastError.message}`);
      }
      if (workerLastExit) {
        throw new Error(`nut_server.py exited before becoming ready (${workerLastExit}).`);
      }
    }

    const health = await fetchWorkerHealth();
    if (health?.status === 'ok' && health.modelLoaded) {
      return health;
    }

    await sleep(500);
  }

  throw new Error(
    `Timed out waiting for NUT express worker at ${NUT_EXPRESS_URL} after ${timeoutMs} ms.`
  );
}

async function ensureNutExpressWorkerRunning() {
  if (!NUT_EXPRESS_MODE) {
    return null;
  }

  if (startupPromise) {
    return startupPromise;
  }

  startupPromise = (async () => {
    const existingHealth = await fetchWorkerHealth();
    if (existingHealth?.status === 'ok' && existingHealth.modelLoaded) {
      return { reused: true, health: existingHealth };
    }

    if (existingHealth?.status === 'ok' && isLocalNutExpressUrl(NUT_EXPRESS_URL)) {
      return { reused: true, health: await waitForWorkerReady() };
    }

    if (!isLocalNutExpressUrl(NUT_EXPRESS_URL)) {
      throw new Error(
        `NUT_EXPRESS_MODE=true but ${NUT_EXPRESS_URL} is not local and no worker is reachable there.`
      );
    }

    console.log(`[nut-worker] starting ${DEFAULT_WORKER_SCRIPT_PATH} on ${NUT_EXPRESS_URL}`);
    spawnWorkerProcess();
    return {
      spawned: true,
      health: await waitForWorkerReady(STARTUP_TIMEOUT_MS, { expectManagedProcess: true }),
    };
  })()
    .catch((error) => {
      throw error;
    })
    .finally(() => {
      startupPromise = null;
    });

  return startupPromise;
}

module.exports = {
  ensureNutExpressWorkerRunning,
};
