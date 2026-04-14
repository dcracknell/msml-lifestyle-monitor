const path = require('path');
const { execSync } = require('child_process');
require('../scripts/ensure-native-deps');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const createApp = require('./app');
const { ensureNutExpressWorkerRunning } = require('./services/nut-express-worker');

const PORT = Number(process.env.PORT) || 4000;
const HOST = process.env.HOST || '0.0.0.0';

function freePort(port) {
  try {
    const pids = execSync(`lsof -ti:${port}`, { encoding: 'utf8' }).trim();
    if (pids) {
      execSync(`kill -9 ${pids.split('\n').join(' ')}`);
      console.log(`Killed stale process(es) on port ${port}: ${pids.replace(/\n/g, ', ')}`);
    }
  } catch {
    // port already free
  }
}

function logStartupDetails(app) {
  const hostLabel = HOST === '0.0.0.0' ? 'localhost' : HOST;
  console.log(`Lifestyle dashboard listening on http://${hostLabel}:${PORT}`);
  const { allowAllOrigins, allowedOrigins = [] } = app.locals.cors || {};
  if (allowAllOrigins) {
    console.log('CORS: accepting requests from any origin (APP_ORIGIN=*).');
  } else {
    console.log(`CORS whitelist: ${allowedOrigins.join(', ') || '(none)'}`);
  }
}

function listenWithRetry(app) {
  return new Promise((resolve, reject) => {
    let settled = false;

    const finish = (server) => {
      if (settled) {
        return;
      }
      settled = true;
      logStartupDetails(app);
      resolve(server);
    };

    const attemptListen = ({ allowPortRecovery = false } = {}) => {
      const server = app.listen(PORT, HOST, () => finish(server));
      server.on('error', (error) => {
        if (!allowPortRecovery || error.code !== 'EADDRINUSE') {
          return reject(error);
        }

        console.log(`Port ${PORT} in use - freeing it and retrying...`);
        server.close();
        freePort(PORT);
        setTimeout(() => attemptListen(), 500);
      });
    };

    attemptListen({ allowPortRecovery: true });
  });
}

function formatNutWorkerWarmupMessage(error) {
  const message = String(error?.message || 'Unknown startup error.');
  if (/missing (worker script|model weights|label map|Python runtime)/i.test(message)) {
    return `Nutrition express worker warm-up skipped: ${message}`;
  }
  return `Nutrition express worker warm-up failed: ${error?.stack || message}`;
}

async function startServer() {
  const app = createApp();
  const server = await listenWithRetry(app);

  // The main site should stay available even if the optional nutrition worker
  // is still warming up or temporarily unavailable.
  ensureNutExpressWorkerRunning().catch((error) => {
    console.warn(formatNutWorkerWarmupMessage(error));
  });

  return server;
}

if (require.main === module) {
  startServer().catch((error) => {
    console.error(`Failed to start Lifestyle dashboard: ${error.stack || error.message}`);
    process.exit(1);
  });
}

module.exports = {
  startServer,
};
