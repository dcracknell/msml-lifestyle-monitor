const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const express = require('express');
const cors = require('cors');
const compression = require('compression');
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
const defaultConnectSrc = [
  "'self'",
  'http://localhost:*',
  'https://localhost:*',
  'http://127.0.0.1:*',
  'https://127.0.0.1:*',
  'http://0.0.0.0:*',
  'https://0.0.0.0:*',
  'http://[::1]:*',
  'https://[::1]:*',
  'http://*.local:*',
  'https://*.local:*',
  'http://10.0.2.2:*',
  'https://10.0.2.2:*',
];
const IMMUTABLE_STATIC_ASSET_PATTERN =
  /\.(?:css|js|mjs|png|jpe?g|gif|webp|svg|ico|woff2?|ttf|otf)$/i;

function getFirstForwardedHeaderValue(req, headerName) {
  const value = String(req.get(headerName) || '').trim();
  if (!value) {
    return '';
  }
  return value
    .split(',')
    .map((entry) => entry.trim())
    .find(Boolean);
}

function getForwardedHeaderParam(req, paramName) {
  const value = String(req.get('forwarded') || '').trim();
  if (!value) {
    return '';
  }

  const firstEntry = value
    .split(',')
    .map((entry) => entry.trim())
    .find(Boolean);
  if (!firstEntry) {
    return '';
  }

  const matcher = new RegExp(`(?:^|;)\\s*${paramName}=([^;]+)`, 'i');
  const match = firstEntry.match(matcher);
  if (!match || !match[1]) {
    return '';
  }

  return match[1].trim().replace(/^"|"$/g, '');
}

function resolveRequestHostHeader(req) {
  return (
    getFirstForwardedHeaderValue(req, 'x-forwarded-host') ||
    getForwardedHeaderParam(req, 'host') ||
    String(req.get('host') || '').trim()
  );
}

function isPublicHostnameAliasCandidate(hostname = '') {
  const normalized = stripIpv6Brackets(String(hostname || '').trim().toLowerCase());
  if (!normalized || isLoopbackHostname(normalized) || isPrivateIpv4Address(normalized)) {
    return false;
  }
  return normalized.includes('.');
}

function expandOriginHostAliases(origin) {
  if (origin === '*' || !/^https?:\/\//.test(origin)) {
    return [];
  }

  try {
    const parsed = new URL(origin);
    const hostname = stripIpv6Brackets(parsed.hostname.toLowerCase());
    if (!isPublicHostnameAliasCandidate(hostname)) {
      return [];
    }

    const aliasHostname = hostname.startsWith('www.') ? hostname.slice(4) : `www.${hostname}`;
    if (!aliasHostname || aliasHostname === hostname) {
      return [];
    }

    const aliasUrl = new URL(origin);
    aliasUrl.hostname = aliasHostname;
    return [normalizeOrigin(aliasUrl.toString())];
  } catch (error) {
    return [];
  }
}

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
    expandOriginHostAliases(origin).forEach((alias) => expanded.add(alias));
    expandOriginHostAliases(alternate).forEach((alias) => expanded.add(alias));
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

function resolveConnectSrc(allowAllOrigins, allowedOrigins = []) {
  if (allowAllOrigins) {
    return ["'self'", 'http:', 'https:'];
  }

  return [...new Set([...defaultConnectSrc, ...allowedOrigins])];
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
      const host = resolveRequestHostHeader(req);
      if (host) {
        return res.redirect(301, `https://${host}${req.originalUrl}`);
      }
    }
    return res.status(403).json({ message: 'HTTPS required.' });
  };
}

function setStaticAssetHeaders(res, filePath) {
  if (IMMUTABLE_STATIC_ASSET_PATTERN.test(filePath)) {
    res.setHeader('Cache-Control', 'public, max-age=3600, must-revalidate');
    return;
  }

  if (/\.html?$/i.test(filePath)) {
    res.setHeader('Cache-Control', 'no-cache');
  }
}

function resolveRequestProtocol(req) {
  const protoHeader = (req.get('x-forwarded-proto') || '').split(',')[0].trim().toLowerCase();
  if (protoHeader) {
    return protoHeader;
  }
  const forwardedProto = getForwardedHeaderParam(req, 'proto').toLowerCase();
  if (forwardedProto) {
    return forwardedProto;
  }
  return (req.protocol || '').toLowerCase();
}

function resolveRequestOrigin(req) {
  const host = resolveRequestHostHeader(req);
  if (!host) {
    return null;
  }
  const protocol = resolveRequestProtocol(req) || 'http';
  return normalizeOrigin(`${protocol}://${host}`);
}

function resolveRequestHost(req) {
  return resolveRequestHostHeader(req).toLowerCase();
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

function stripIpv6Brackets(hostname = '') {
  return hostname.replace(/^\[(.*)\]$/, '$1');
}

function isLoopbackHostname(hostname = '') {
  const normalized = stripIpv6Brackets(String(hostname || '').trim().toLowerCase());
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1' || normalized === '0.0.0.0';
}

function parseHostHeaderHostname(hostHeader = '') {
  if (!hostHeader) {
    return null;
  }
  try {
    return stripIpv6Brackets(new URL(`http://${hostHeader}`).hostname.toLowerCase());
  } catch (error) {
    return null;
  }
}

function isPrivateIpv4Address(hostname = '') {
  const octets = hostname.split('.').map((segment) => Number.parseInt(segment, 10));
  if (octets.length !== 4 || octets.some((segment) => !Number.isInteger(segment) || segment < 0 || segment > 255)) {
    return false;
  }

  if (octets[0] === 10) {
    return true;
  }
  if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) {
    return true;
  }
  if (octets[0] === 192 && octets[1] === 168) {
    return true;
  }
  if (octets[0] === 169 && octets[1] === 254) {
    return true;
  }

  return false;
}

function isLocalNetworkHostname(hostname = '') {
  const normalized = stripIpv6Brackets(String(hostname || '').trim().toLowerCase());
  if (!normalized) {
    return false;
  }
  if (isLoopbackHostname(normalized)) {
    return true;
  }
  if (normalized.endsWith('.local')) {
    return true;
  }
  return isPrivateIpv4Address(normalized);
}

function isLoopbackOrigin(origin = '') {
  if (!origin) {
    return false;
  }
  try {
    const parsed = new URL(origin);
    if (!/^https?:$/.test(parsed.protocol)) {
      return false;
    }
    return isLoopbackHostname(parsed.hostname);
  } catch (error) {
    return false;
  }
}

function isLocalNetworkOrigin(origin = '') {
  if (!origin) {
    return false;
  }
  try {
    const parsed = new URL(origin);
    if (!/^https?:$/.test(parsed.protocol)) {
      return false;
    }
    return isLocalNetworkHostname(parsed.hostname);
  } catch (error) {
    return false;
  }
}

function isLocalNetworkRequest(req) {
  const hostname = parseHostHeaderHostname(resolveRequestHostHeader(req));
  return isLocalNetworkHostname(hostname || '');
}

function parseComparableHost(value, fallbackProtocol = 'http') {
  if (!value) {
    return null;
  }

  const protocol = String(fallbackProtocol || 'http').replace(/:$/, '').toLowerCase() || 'http';
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `${protocol}://${value}`;

  try {
    const parsed = new URL(candidate);
    const normalizedProtocol = parsed.protocol.toLowerCase();
    if (!/^https?:$/.test(normalizedProtocol)) {
      return null;
    }

    const hostname = stripIpv6Brackets(parsed.hostname.toLowerCase());
    if (!hostname) {
      return null;
    }

    const port =
      parsed.port ||
      (normalizedProtocol === 'https:' ? '443' : normalizedProtocol === 'http:' ? '80' : '');

    return {
      hostname,
      port,
      protocol: normalizedProtocol,
    };
  } catch (error) {
    return null;
  }
}

function normalizePublicHostnameAlias(hostname = '') {
  return String(hostname || '').trim().toLowerCase().replace(/^www\./, '');
}

function hostsMatchForCors(requestHost, originHost) {
  if (!requestHost || !originHost) {
    return false;
  }

  const sameHostname =
    requestHost.hostname === originHost.hostname ||
    (isPublicHostnameAliasCandidate(requestHost.hostname) &&
      isPublicHostnameAliasCandidate(originHost.hostname) &&
      normalizePublicHostnameAlias(requestHost.hostname) ===
        normalizePublicHostnameAlias(originHost.hostname));

  if (!sameHostname) {
    return false;
  }

  if (requestHost.port === originHost.port) {
    return true;
  }

  const defaultWebPorts = new Set(['80', '443']);
  return defaultWebPorts.has(requestHost.port) && defaultWebPorts.has(originHost.port);
}

function isRequestSelfOrigin(req, origin) {
  const requestHost = parseComparableHost(resolveRequestHost(req), resolveRequestProtocol(req) || 'http');
  const originHost = parseComparableHost(origin, 'http');
  return hostsMatchForCors(requestHost, originHost);
}

function createApp(options = {}) {
  const app = express();
  const bodyLimit = options.bodyLimit || process.env.API_BODY_LIMIT || '20mb';
  const requireHttps = options.requireHttps ?? process.env.REQUIRE_HTTPS === 'true';
  const { allowAllOrigins, allowedOrigins, allowedOriginsSet } = resolveAllowedOrigins(
    options.appOrigin
  );
  const connectSrc = resolveConnectSrc(allowAllOrigins, allowedOrigins);

  // Trust only local/private proxy hops so Express can honor forwarded
  // host/protocol values from cloudflared and other same-machine proxies.
  app.set('trust proxy', 'loopback, linklocal, uniquelocal');

  const corsOptionsDelegate = (req, callback) => {
    const originHeader = req.get('origin');
    if (!originHeader || allowAllOrigins) {
      return callback(null, { origin: true });
    }

    const normalizedOrigin = normalizeOrigin(originHeader);
    const nullOriginLocalRequest =
      normalizedOrigin === 'null' && isLocalNetworkRequest(req);
    const loopbackDevOrigin = isLoopbackOrigin(normalizedOrigin);
    const localNetworkDevOrigin =
      isLocalNetworkOrigin(normalizedOrigin) && isLocalNetworkRequest(req);

    if (
      allowedOriginsSet.has(normalizedOrigin) ||
      isRequestSelfOrigin(req, normalizedOrigin) ||
      loopbackDevOrigin ||
      localNetworkDevOrigin ||
      nullOriginLocalRequest
    ) {
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
          // The dashboard supports targeting a different API origin via
          // ?apiBaseUrl=... so fetch/XHR must be allowed to those same hosts.
          'connect-src': connectSrc,
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

  app.use(
    compression({
      threshold: 1024,
    })
  );
  app.use(cors(corsOptionsDelegate));
  app.use(express.json({ limit: bodyLimit }));
  app.use(
    express.urlencoded({
      extended: false,
      limit: bodyLimit,
    })
  );

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
  app.use('/api/ppg', require('./routes/ppg'));
  app.use('/api/weight', require('./routes/weight'));
  app.use('/api/streams', require('./routes/streams'));

  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.use(
    express.static(path.join(__dirname, '..', 'public'), {
      setHeaders: setStaticAssetHeaders,
    })
  );

  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
  });

  // Error handler must come after routes so it catches both body-parser and route errors.
  app.use((error, req, res, next) => {
    if (error && error.type === 'entity.too.large') {
      return res.status(413).json({
        message: `Upload too large. Try a smaller image or reduce quality (request limit: ${bodyLimit}).`,
      });
    }
    if (error) {
      return res.status(400).json({ message: error.message || 'Invalid request payload.' });
    }
    return next();
  });

  return app;
}

module.exports = createApp;
