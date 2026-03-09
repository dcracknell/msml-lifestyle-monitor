const request = require('supertest');
const createApp = require('../app');
const { NAME_LIMITS, PASSWORD_LIMITS } = require('../utils/validation');

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

describe('Signup validation', () => {
  it('rejects names that exceed the configured word limit', async () => {
    const excessiveName = Array(NAME_LIMITS.maxWords + 2)
      .fill('Word')
      .join(' ');
    const response = await request(app).post('/api/signup').send({
      name: excessiveName,
      email: `limit-name-${Date.now()}@example.com`,
      password: 'Password123',
    });

    expect(response.status).toBe(400);
    expect(response.body).toHaveProperty('message');
    expect(response.body.message).toContain('Name must');
  });

  it('rejects passwords that exceed the configured limits', async () => {
    const longPassword = `${Array(PASSWORD_LIMITS.maxWords + 1)
      .fill('word')
      .join(' ')}`.padEnd(PASSWORD_LIMITS.maxLength + 10, 'x');
    const response = await request(app).post('/api/signup').send({
      name: 'Limit Tester',
      email: `limit-pass-${Date.now()}@example.com`,
      password: longPassword,
    });

    expect(response.status).toBe(400);
    expect(response.body).toHaveProperty('message');
    expect(response.body.message).toContain('Password must');
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

  it('mirrors phone step samples into daily metrics timeline rows', async () => {
    const { token } = await loginAsCoach();
    const syncTs = Date.now();
    const targetDate = formatLocalDate(new Date(syncTs));
    const syncSteps = 43210;

    const ingest = await request(app)
      .post('/api/streams')
      .set('Authorization', `Bearer ${token}`)
      .send({
        metric: 'phone.steps',
        localDate: targetDate,
        samples: [{ ts: syncTs, value: syncSteps, localDate: targetDate }],
      });

    expect(ingest.status).toBe(202);
    expect(ingest.body).toMatchObject({ metric: 'phone.steps', accepted: 1 });

    const metrics = await request(app)
      .get('/api/metrics?include=timeline')
      .set('Authorization', `Bearer ${token}`);

    expect(metrics.status).toBe(200);
    const day = metrics.body.timeline.find((entry) => entry.date === targetDate);
    expect(day).toBeTruthy();
    expect(day.steps).toBe(syncSteps);
  });

  it('does not let future-dated step rows override current summary', async () => {
    const { token } = await loginAsCoach();
    const today = new Date();
    const future = new Date(today);
    future.setDate(future.getDate() + 30);
    const todayDate = formatLocalDate(today);
    const futureDate = formatLocalDate(future);

    const todaySteps = 15678;
    const futureSteps = 999999;

    const syncToday = await request(app)
      .post('/api/streams')
      .set('Authorization', `Bearer ${token}`)
      .send({
        metric: 'phone.steps',
        localDate: todayDate,
        samples: [{ ts: today.getTime(), value: todaySteps, localDate: todayDate }],
      });
    expect(syncToday.status).toBe(202);

    const syncFuture = await request(app)
      .post('/api/streams')
      .set('Authorization', `Bearer ${token}`)
      .send({
        metric: 'phone.steps',
        localDate: futureDate,
        samples: [{ ts: future.getTime(), value: futureSteps, localDate: futureDate }],
      });
    expect(syncFuture.status).toBe(202);

    const metrics = await request(app)
      .get('/api/metrics?include=summary,timeline')
      .set('Authorization', `Bearer ${token}`);

    expect(metrics.status).toBe(200);
    expect(metrics.body.summary?.steps).toBe(todaySteps);
    expect(metrics.body.timeline.some((entry) => entry.date === futureDate)).toBe(false);
  });

  it('maps sleep, vitals, and workout stream metrics into app-facing endpoints', async () => {
    const { token } = await loginAsCoach();
    const now = new Date();
    const date = formatLocalDate(now);
    const ts = now.getTime();

    const uploads = [
      { metric: 'sleep.total_hours', value: 7.8 },
      { metric: 'sleep.deep_hours', value: 1.6 },
      { metric: 'sleep.rem_hours', value: 1.7 },
      { metric: 'sleep.light_hours', value: 4.5 },
      { metric: 'vitals.resting_hr', value: 49 },
      { metric: 'vitals.hrv', value: 105 },
      { metric: 'vitals.spo2', value: 98 },
      { metric: 'vitals.stress_score', value: 32 },
      { metric: 'vitals.systolic_bp', value: 118 },
      { metric: 'vitals.diastolic_bp', value: 76 },
      { metric: 'vitals.glucose', value: 92 },
      { metric: 'vitals.readiness', value: 87 },
      { metric: 'exercise.distance', value: 8.4 },
      { metric: 'exercise.pace', value: 312 },
      { metric: 'exercise.calories', value: 620 },
      { metric: 'exercise.hr', value: 154 },
      { metric: 'exercise.max_hr', value: 176 },
      { metric: 'exercise.moving_time', value: 2620 },
      { metric: 'exercise.elapsed_time', value: 2800 },
      { metric: 'exercise.elevation_gain', value: 120 },
      { metric: 'exercise.cadence', value: 168.4 },
      { metric: 'exercise.power', value: 245.7 },
      { metric: 'exercise.vo2max', value: 52.4 },
      { metric: 'exercise.training_load', value: 96.2 },
      { metric: 'exercise.perceived_effort', value: 7 },
    ];

    for (const upload of uploads) {
      // eslint-disable-next-line no-await-in-loop
      const response = await request(app)
        .post('/api/streams')
        .set('Authorization', `Bearer ${token}`)
        .send({
          metric: upload.metric,
          localDate: date,
          samples: [{ ts, value: upload.value, localDate: date }],
        });
      expect(response.status).toBe(202);
    }

    const metrics = await request(app)
      .get('/api/metrics?include=summary,sleepStages')
      .set('Authorization', `Bearer ${token}`);
    expect(metrics.status).toBe(200);
    expect(metrics.body.summary?.sleepHours).toBeCloseTo(7.8, 1);
    expect(metrics.body.summary?.readiness).toBe(87);
    expect(metrics.body.sleepStages?.deep).toBe(96);
    expect(metrics.body.sleepStages?.rem).toBe(102);
    expect(metrics.body.sleepStages?.light).toBe(270);

    const vitals = await request(app)
      .get('/api/vitals')
      .set('Authorization', `Bearer ${token}`);
    expect(vitals.status).toBe(200);
    const todaysVitals = vitals.body.timeline.find((entry) => entry.date === date);
    expect(todaysVitals).toBeTruthy();
    expect(todaysVitals.restingHr).toBe(49);
    expect(todaysVitals.hrvScore).toBe(105);
    expect(todaysVitals.spo2).toBe(98);
    expect(todaysVitals.stressScore).toBe(32);
    expect(todaysVitals.systolic).toBe(118);
    expect(todaysVitals.diastolic).toBe(76);
    expect(todaysVitals.glucose).toBe(92);

    const activity = await request(app)
      .get('/api/activity')
      .set('Authorization', `Bearer ${token}`);
    expect(activity.status).toBe(200);
    const phoneSession = activity.body.sessions.find((session) => session.sourceId === `phone_sync:${date}`);
    expect(phoneSession).toBeTruthy();
    expect(phoneSession.source).toBe('phone_sync');
    expect(phoneSession.distance).toBe(8400);
    expect(phoneSession.movingTime).toBe(2620);
    expect(phoneSession.elapsedTime).toBe(2800);
    expect(phoneSession.averagePace).toBe(312);
    expect(phoneSession.calories).toBe(620);
    expect(phoneSession.averageHr).toBe(154);
    expect(phoneSession.maxHr).toBe(176);
    expect(phoneSession.averageCadence).toBeCloseTo(168.4, 1);
    expect(phoneSession.averagePower).toBeCloseTo(245.7, 1);
    expect(phoneSession.elevationGain).toBe(120);
    expect(phoneSession.vo2maxEstimate).toBeCloseTo(52.4, 1);
    expect(phoneSession.trainingLoad).toBeCloseTo(96.2, 1);
    expect(phoneSession.perceivedEffort).toBe(7);
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

function formatLocalDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
