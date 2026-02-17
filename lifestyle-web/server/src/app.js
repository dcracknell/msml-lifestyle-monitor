const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

// Ensure database initializes before routes use it.
require('./db'); // eslint-disable-line import/no-unassigned-import

const normalizeOrigin = (value = '') => value.trim().replace(/\/+$/, '').toLowerCase();

const defaultOrigins = [
  'http://localhost:4000',
  'http://127.0.0.1:4000',
  'http://localhost:8081',
  'http://localhost:8082',
  'http://localhost:8083',
  'http://127.0.0.1:8083',
  'http://localhost:19006',
];

function expandOriginsWithSchemes(origins = []) {
  const expanded = new Set(origins);
  origins.forEach((origin) => {
    if (origin === '*' || !/^https?:\/\//.test(origin)) {
      return;
    }
    const alternate = origin.startsWith('https://')
      ? origin.replace(/^https:\/\//, 'http://')
      : origin.replace(/^http:\/\//, 'https://');
    expanded.add(alternate);
  });
  return [...expanded];
}

function resolveAllowedOrigins(override) {
  const configured = [
    ...defaultOrigins,
    ...(override || process.env.APP_ORIGIN || '').split(','),
  ]
    .map(normalizeOrigin)
    .filter(Boolean);
  const uniqueConfigured = expandOriginsWithSchemes([...new Set(configured)]);

  const allowAllOrigins = uniqueConfigured.includes('*');
  const allowedOrigins = allowAllOrigins
    ? uniqueConfigured.filter((origin) => origin !== '*')
    : uniqueConfigured;

  return {
    allowAllOrigins,
    allowedOrigins,
    allowedOriginsSet: new Set(allowedOrigins),
  };
}

function createHttpsMiddleware(requireHttps) {
  if (!requireHttps) {
    return null;
  }
  return (req, res, next) => {
    const protoHeader = (req.get('x-forwarded-proto') || '').split(',')[0].trim().toLowerCase();
    const protocol = protoHeader || (req.protocol || '').toLowerCase();
    if (protocol === 'https') {
      return next();
    }

    if (req.method === 'GET' || req.method === 'HEAD') {
      const host = req.get('host');
      if (host) {
        return res.redirect(301, `https://${host}${req.originalUrl}`);
      }
    }
    return res.status(403).json({ message: 'HTTPS required.' });
  };
}

function resolveRequestProtocol(req) {
  const protoHeader = (req.get('x-forwarded-proto') || '').split(',')[0].trim().toLowerCase();
  if (protoHeader) {
    return protoHeader;
  }
  return (req.protocol || '').toLowerCase();
}

function resolveRequestOrigin(req) {
  const host = (req.get('host') || '').trim();
  if (!host) {
    return null;
  }
  const protocol = resolveRequestProtocol(req) || 'http';
  return normalizeOrigin(`${protocol}://${host}`);
}

function resolveRequestHost(req) {
  return (req.get('host') || '').trim().toLowerCase();
}

function parseOriginHost(origin) {
  if (!origin) {
    return null;
  }
  try {
    return new URL(origin).host.toLowerCase();
  } catch (error) {
    return null;
  }
}

function isRequestSelfOrigin(req, origin) {
  const requestHost = resolveRequestHost(req);
  const originHost = parseOriginHost(origin);
  if (!requestHost || !originHost) {
    return false;
  }
  return requestHost === originHost;
}

function createApp(options = {}) {
  const app = express();
  const bodyLimit = options.bodyLimit || process.env.API_BODY_LIMIT || '6mb';
  const requireHttps = options.requireHttps ?? process.env.REQUIRE_HTTPS === 'true';
  const { allowAllOrigins, allowedOrigins, allowedOriginsSet } = resolveAllowedOrigins(
    options.appOrigin
  );

  const corsOptionsDelegate = (req, callback) => {
    const originHeader = req.get('origin');
    if (!originHeader || allowAllOrigins) {
      return callback(null, { origin: true });
    }

    const normalizedOrigin = normalizeOrigin(originHeader);
    if (allowedOriginsSet.has(normalizedOrigin) || isRequestSelfOrigin(req, normalizedOrigin)) {
      return callback(null, { origin: true });
    }

    const label = normalizedOrigin || originHeader;
    console.warn(`Rejected CORS origin: ${label}`);
    return callback(new Error('Not allowed by CORS'));
  };

  // Expose CORS config for logging and tests.
  app.locals.cors = { allowAllOrigins, allowedOrigins };

  app.use(
    helmet({
      crossOriginEmbedderPolicy: false,
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          // Allow remote HTTPS avatars plus data URLs generated from uploads.
          'img-src': ["'self'", 'data:', 'https:'],
        },
      },
    })
  );

  const httpsMiddleware = createHttpsMiddleware(requireHttps);
  if (httpsMiddleware) {
    app.use(httpsMiddleware);
  }

  app.use(cors(corsOptionsDelegate));
  app.use(express.json({ limit: bodyLimit }));
  app.use(
    express.urlencoded({
      extended: false,
      limit: bodyLimit,
    })
  );

  app.use((error, req, res, next) => {
    if (error && error.type === 'entity.too.large') {
      return res
        .status(413)
        .json({ message: 'Upload too large. Try a smaller image (under 5 MB).' });
    }
    if (error) {
      return res.status(400).json({ message: error.message || 'Invalid request payload.' });
    }
    return next();
  });

  app.use('/api/login', require('./routes/auth'));
  app.use('/api/signup', require('./routes/signup'));
  app.use('/api/metrics', require('./routes/metrics'));
  app.use('/api/athletes', require('./routes/athletes'));
  app.use('/api/share', require('./routes/share'));
  app.use('/api/admin', require('./routes/admin'));
  app.use('/api/profile', require('./routes/profile'));
  app.use('/api/password', require('./routes/password'));
  app.use('/api/nutrition', require('./routes/nutrition'));
  app.use('/api/activity', require('./routes/activity'));
  app.use('/api/vitals', require('./routes/vitals'));
  app.use('/api/weight', require('./routes/weight'));
  app.use('/api/streams', require('./routes/streams'));

  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.use(express.static(path.join(__dirname, '..', 'public')));

  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
  });

  return app;
}

module.exports = createApp;
