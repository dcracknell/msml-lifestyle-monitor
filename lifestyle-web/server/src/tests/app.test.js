const request = require('supertest');
const createApp = require('../app');

jest.setTimeout(20000);

let app;

beforeAll(() => {
  app = createApp();
});

async function loginAsCoach() {
  const response = await request(app).post('/api/login').send({
    email: 'coach@example.com',
    password: 'Password',
  });

  expect(response.status).toBe(200);
  expect(response.body).toHaveProperty('token');
  expect(response.body).toHaveProperty('user');

  return response.body;
}

describe('Health check', () => {
  it('returns an ok payload with timestamp', async () => {
    const response = await request(app).get('/api/health');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: 'ok' });
    expect(typeof response.body.timestamp).toBe('string');
    expect(Number.isNaN(Date.parse(response.body.timestamp))).toBe(false);
  });
});

describe('Authentication flow', () => {
  it('logs in a seeded athlete by email and password', async () => {
    const { token, user } = await loginAsCoach();

    expect(typeof token).toBe('string');
    expect(user).toMatchObject({
      email: 'coach@example.com',
      name: 'Casey Coach',
      role: 'Coach',
    });
  });
});

describe('Metrics endpoint', () => {
  it('returns readiness data for the authenticated user', async () => {
    const { token } = await loginAsCoach();
    const response = await request(app)
      .get('/api/metrics')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('subject');
    expect(response.body.subject).toMatchObject({
      name: 'Casey Coach',
      email: 'coach@example.com',
    });
    expect(response.body).toHaveProperty('summary');
    expect(response.body.summary).toHaveProperty('steps');
    expect(Array.isArray(response.body.timeline)).toBe(true);
    expect(Array.isArray(response.body.readiness)).toBe(true);
    expect(response.body.readiness.length).toBeGreaterThan(0);
  });
});

describe('Sensor stream ingestion', () => {
  it('accepts batched samples and returns downsampled data', async () => {
    const { token } = await loginAsCoach();
    const now = Date.now();
    const samples = Array.from({ length: 120 }, (_, index) => ({
      timestamp: now - index * 1000,
      value: 120 + index,
    }));

    const ingest = await request(app)
      .post('/api/streams')
      .set('Authorization', `Bearer ${token}`)
      .send({ metric: 'heart_rate', samples });

    expect(ingest.status).toBe(202);
    expect(ingest.body).toMatchObject({ metric: 'heart_rate' });
    expect(ingest.body.accepted).toBe(samples.length);

    const lookbackStart = now - 60 * 1000;
    const response = await request(app)
      .get(`/api/streams?metric=heart_rate&from=${lookbackStart}&to=${now}&maxPoints=10`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.metric).toBe('heart_rate');
    expect(response.body.points.length).toBeLessThanOrEqual(10);
    expect(response.body.total).toBeGreaterThan(0);
    expect(response.body.points[0]).toHaveProperty('ts');
  });
});

describe('CORS configuration', () => {
  it('always includes default localhost origins even when custom origins are set', () => {
    const customApp = createApp({ appOrigin: 'https://msmls.org' });
    const { allowedOrigins = [] } = customApp.locals.cors || {};

    expect(Array.isArray(allowedOrigins)).toBe(true);
    expect(allowedOrigins).toEqual(
      expect.arrayContaining([
        'http://localhost:4000',
        'https://msmls.org',
        'http://msmls.org',
      ])
    );
  });

  it('allows requests originating from the same host even if not explicitly configured', async () => {
    const customApp = createApp({ appOrigin: 'http://localhost:4000' });
    const response = await request(customApp)
      .get('/api/health')
      .set('Host', 'msmlifestyle.test')
      .set('Origin', 'https://msmlifestyle.test')
      .set('X-Forwarded-Proto', 'https');

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('status', 'ok');
  });

  it('still allows HTTPS browser origins when TLS is terminated upstream', async () => {
    const customApp = createApp({ appOrigin: 'http://localhost:4000' });
    const response = await request(customApp)
      .get('/api/health')
      .set('Host', 'msmlifestyle.test')
      .set('Origin', 'https://msmlifestyle.test');

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('status', 'ok');
  });

  it('still rejects origins that do not match the allowed list or host', async () => {
    const customApp = createApp({ appOrigin: 'http://localhost:4000' });
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const response = await request(customApp)
        .get('/api/health')
        .set('Host', 'msmlifestyle.test')
        .set('Origin', 'https://attacker.test');

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('message', 'Not allowed by CORS');
    } finally {
      warnSpy.mockRestore();
    }
  });
});
