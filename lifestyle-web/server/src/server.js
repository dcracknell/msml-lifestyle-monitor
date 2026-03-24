const path = require('path');
const { execSync } = require('child_process');
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

async function startServer() {
  const app = createApp();
  const server = await new Promise((resolve, reject) => {
    const srv = app.listen(PORT, HOST, () => {
      const hostLabel = HOST === '0.0.0.0' ? 'localhost' : HOST;
      console.log(`Lifestyle dashboard listening on http://${hostLabel}:${PORT}`);
      const { allowAllOrigins, allowedOrigins = [] } = app.locals.cors || {};
      if (allowAllOrigins) {
        console.log('CORS: accepting requests from any origin (APP_ORIGIN=*).');
      } else {
        console.log(`CORS whitelist: ${allowedOrigins.join(', ') || '(none)'}`);
      }
      resolve(srv);
    });
    srv.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.log(`Port ${PORT} in use — freeing it and retrying…`);
        srv.close();
        freePort(PORT);
        // brief pause to let the OS release the socket
        setTimeout(() => {
          const srv2 = app.listen(PORT, HOST, () => {
            const hostLabel = HOST === '0.0.0.0' ? 'localhost' : HOST;
            console.log(`Lifestyle dashboard listening on http://${hostLabel}:${PORT}`);
            resolve(srv2);
          });
          srv2.on('error', reject);
        }, 500);
      } else {
        reject(err);
      }
    });
  });

  // The main site should stay available even if the optional nutrition worker
  // is still warming up or temporarily unavailable.
  ensureNutExpressWorkerRunning().catch((error) => {
    console.error(
      `Nutrition express worker warm-up failed: ${error.stack || error.message}`
    );
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
