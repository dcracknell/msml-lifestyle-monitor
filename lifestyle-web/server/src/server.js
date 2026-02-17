const createApp = require('./app');

const PORT = Number(process.env.PORT) || 4000;
const HOST = process.env.HOST || '0.0.0.0';
const app = createApp();

app.listen(PORT, HOST, () => {
  const hostLabel = HOST === '0.0.0.0' ? 'localhost' : HOST;
  console.log(`Lifestyle dashboard listening on http://${hostLabel}:${PORT}`);
  const { allowAllOrigins, allowedOrigins = [] } = app.locals.cors || {};
  if (allowAllOrigins) {
    console.log('CORS: accepting requests from any origin (APP_ORIGIN=*).');
  } else {
    console.log(`CORS whitelist: ${allowedOrigins.join(', ') || '(none)'}`);
  }
});
