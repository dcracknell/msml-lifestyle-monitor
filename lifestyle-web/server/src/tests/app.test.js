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

async function createAthleteAccount() {
  const email = `athlete-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;
  const password = 'Password123';
  const response = await request(app).post('/api/signup').send({
    name: 'Metrics Athlete',
    email,
    password,
  });

  expect(response.status).toBe(201);
  expect(response.body).toHaveProperty('token');
  expect(response.body).toHaveProperty('user');

  return {
    email,
    password,
    token: response.body.token,
    user: response.body.user,
  };
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

describe('Static asset delivery', () => {
  it('loads the auth guard before the main app bundle', async () => {
    const response = await request(app).get('/');

    expect(response.status).toBe(200);
    expect(response.text).toContain('/auth-guard.js?v=1');
    expect(response.text).toContain('/app.js?v=25');
    expect(response.text.indexOf('/auth-guard.js?v=1')).toBeLessThan(
      response.text.indexOf('/app.js?v=25')
    );
  });

  it('serves bundled assets with cache headers that still allow updates to roll out', async () => {
    const response = await request(app).get('/app.js?v=14');

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toContain('max-age=3600');
    expect(response.headers['cache-control']).toContain('must-revalidate');
  });

  it('compresses sizeable static assets when gzip is requested', async () => {
    const response = await request(app)
      .get('/app.js?v=14')
      .set('Accept-Encoding', 'gzip');

    expect(response.status).toBe(200);
    expect(response.headers['content-encoding']).toBe('gzip');
  });

  it('redirects stray root form posts back to the dashboard', async () => {
    const response = await request(app).post('/').type('form').send({
      email: 'coach@example.com',
      password: 'Password',
    });

    expect(response.status).toBe(303);
    expect(response.headers.location).toBe('/');
  });
});

describe('Content security policy', () => {
  it('allows documented cross-origin API targets for browser fetch requests', async () => {
    const customApp = createApp({ appOrigin: 'https://msmls.org' });
    const response = await request(customApp).get('/');

    expect(response.status).toBe(200);

    const policy = response.headers['content-security-policy'] || '';
    expect(policy).toContain('connect-src');
    expect(policy).toContain("'self'");
    expect(policy).toContain('https://msmls.org');
    expect(policy).toContain('https://www.msmls.org');
    expect(policy).toContain('http://localhost:*');
    expect(policy).toContain('http://127.0.0.1:*');
  });

  it('widens connect-src when all origins are explicitly allowed', async () => {
    const customApp = createApp({ appOrigin: '*' });
    const response = await request(customApp).get('/');

    expect(response.status).toBe(200);

    const policy = response.headers['content-security-policy'] || '';
    expect(policy).toContain('connect-src');
    expect(policy).toContain('http:');
    expect(policy).toContain('https:');
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

  it('keeps bearer tokens small enough for photo accounts', async () => {
    const avatarPhoto = 'a'.repeat(12000);
    const email = `photo-user-${Date.now()}@example.com`;
    const password = 'Password123';

    const signup = await request(app).post('/api/signup').send({
      name: 'Photo User',
      email,
      password,
      avatarPhoto,
    });

    expect(signup.status).toBe(201);
    expect(signup.body.user).toMatchObject({
      email,
      name: 'Photo User',
      role: 'Athlete',
      avatar_photo: avatarPhoto,
    });
    expect(signup.body.token.length).toBeLessThan(4096);

    const login = await request(app).post('/api/login').send({
      email,
      password,
    });

    expect(login.status).toBe(200);
    expect(login.body.user).toMatchObject({
      email,
      avatar_photo: avatarPhoto,
    });
    expect(login.body.token.length).toBeLessThan(4096);

    const metrics = await request(app)
      .get('/api/metrics')
      .set('Authorization', `Bearer ${login.body.token}`);

    expect(metrics.status).toBe(200);
    expect(metrics.body.subject).toMatchObject({
      email,
      name: 'Photo User',
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

  it('derives daily calories from logged nutrition entries', async () => {
    const { token } = await createAthleteAccount();
    const targetDate = formatLocalDate(new Date());

    const breakfast = await request(app)
      .post('/api/nutrition')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Breakfast oats',
        calories: 320,
        protein: 20,
        carbs: 45,
        fats: 8,
        date: targetDate,
      });
    expect(breakfast.status).toBe(200);

    const snack = await request(app)
      .post('/api/nutrition')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Greek yogurt',
        calories: 180,
        protein: 17,
        carbs: 12,
        fats: 5,
        date: targetDate,
      });
    expect(snack.status).toBe(200);

    const metrics = await request(app)
      .get('/api/metrics?include=summary,timeline')
      .set('Authorization', `Bearer ${token}`);

    expect(metrics.status).toBe(200);
    expect(metrics.body.summary).toMatchObject({
      calories: 500,
    });

    const day = metrics.body.timeline.find((entry) => entry.date === targetDate);
    expect(day).toBeTruthy();
    expect(day.calories).toBe(500);
  });
});

describe('Weight endpoint', () => {
  it('uses logged nutrition totals for weight timeline calories', async () => {
    const { token } = await createAthleteAccount();
    const targetDate = formatLocalDate(new Date());

    const nutrition = await request(app)
      .post('/api/nutrition')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Lunch bowl',
        calories: 640,
        protein: 38,
        carbs: 72,
        fats: 18,
        date: targetDate,
      });
    expect(nutrition.status).toBe(200);

    const weight = await request(app)
      .post('/api/weight')
      .set('Authorization', `Bearer ${token}`)
      .send({
        weight: 182,
        unit: 'lb',
        date: targetDate,
      });
    expect(weight.status).toBe(201);

    const response = await request(app)
      .get('/api/weight')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    const day = response.body.timeline.find((entry) => entry.date === targetDate);
    expect(day).toBeTruthy();
    expect(day.calories).toBe(640);
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

  it('can skip workout session mirroring for raw exercise stream uploads', async () => {
    const { token } = await loginAsCoach();
    const syncTs = Date.now();
    const targetDate = formatLocalDate(new Date(syncTs + 7 * 24 * 60 * 60 * 1000));

    const ingest = await request(app)
      .post('/api/streams')
      .set('Authorization', `Bearer ${token}`)
      .send({
        metric: 'exercise.distance',
        localDate: targetDate,
        skipWorkoutMirror: true,
        samples: [{ ts: syncTs, value: 6.2, localDate: targetDate }],
      });

    expect(ingest.status).toBe(202);
    expect(ingest.body).toMatchObject({ metric: 'exercise.distance', accepted: 1 });

    const activity = await request(app)
      .get('/api/activity')
      .set('Authorization', `Bearer ${token}`);

    expect(activity.status).toBe(200);
    expect(activity.body.sessions.some((session) => session.sourceId === `phone_sync:${targetDate}`)).toBe(
      false
    );
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

describe('Strava export route', () => {
  it('accepts a sourceId lookup before attempting the Strava connection', async () => {
    const { token } = await loginAsCoach();
    const sourceId = `test-run:${Date.now()}`;
    const startedAt = new Date().toISOString();

    const workout = await request(app)
      .post('/api/streams/workouts')
      .set('Authorization', `Bearer ${token}`)
      .send({
        workouts: [
          {
            sourceId,
            name: 'Source export test',
            sportType: 'Run',
            startTime: startedAt,
            endTime: startedAt,
            distanceMeters: 5000,
            movingTimeSeconds: 1500,
            elapsedTimeSeconds: 1500,
          },
        ],
      });

    expect(workout.status).toBe(202);

    const exportResponse = await request(app)
      .post('/api/activity/strava/export')
      .set('Authorization', `Bearer ${token}`)
      .send({ sourceId });

    expect(exportResponse.status).toBe(400);
    expect(exportResponse.body.message).toBe('Connect Strava before exporting sessions.');
  });
});

describe('Activity session editing', () => {
  it('truncates sport-derived workout names to the session length limit', async () => {
    const { token } = await loginAsCoach();
    const sourceId = `long-sport:${Date.now()}`;
    const startedAt = new Date().toISOString();
    const sportType = 'pilates-endurance-focus-'.repeat(6);
    const normalizedSportType = `${sportType.charAt(0).toUpperCase()}${sportType.slice(1)}`;
    const expectedName = `${normalizedSportType} workout`.slice(0, 96);

    const workout = await request(app)
      .post('/api/streams/workouts')
      .set('Authorization', `Bearer ${token}`)
      .send({
        workouts: [
          {
            sourceId,
            sportType,
            startTime: startedAt,
            endTime: startedAt,
            distanceMeters: 3200,
            movingTimeSeconds: 900,
            elapsedTimeSeconds: 900,
          },
        ],
      });

    expect(workout.status).toBe(202);

    const activity = await request(app)
      .get('/api/activity')
      .set('Authorization', `Bearer ${token}`);
    expect(activity.status).toBe(200);

    const createdSession = activity.body.sessions.find((session) => session.sourceId === sourceId);
    expect(createdSession).toBeTruthy();
    expect(createdSession.name).toBe(expectedName);
    expect(createdSession.name.length).toBeLessThanOrEqual(96);
  });

  it('stores workout notes and allows self-owned sessions to be updated after logging', async () => {
    const { token } = await loginAsCoach();
    const sourceId = `editable-run:${Date.now()}`;
    const startedAt = new Date().toISOString();

    const workout = await request(app)
      .post('/api/streams/workouts')
      .set('Authorization', `Bearer ${token}`)
      .send({
        workouts: [
          {
            sourceId,
            name: 'Lunch shakeout',
            notes: 'Kept it relaxed until the final kilometre.',
            sportType: 'Run',
            startTime: startedAt,
            endTime: startedAt,
            distanceMeters: 6200,
            movingTimeSeconds: 1860,
            elapsedTimeSeconds: 1860,
          },
        ],
      });

    expect(workout.status).toBe(202);

    const activityBefore = await request(app)
      .get('/api/activity')
      .set('Authorization', `Bearer ${token}`);
    expect(activityBefore.status).toBe(200);

    const createdSession = activityBefore.body.sessions.find((session) => session.sourceId === sourceId);
    expect(createdSession).toBeTruthy();
    expect(createdSession.notes).toBe('Kept it relaxed until the final kilometre.');

    const update = await request(app)
      .patch(`/api/activity/sessions/${createdSession.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Lunch progression',
        notes: 'Felt smooth, then closed hard over the final 2 km.',
      });

    expect(update.status).toBe(200);
    expect(update.body.message).toBe('Session updated.');
    expect(update.body.session).toMatchObject({
      id: createdSession.id,
      name: 'Lunch progression',
      notes: 'Felt smooth, then closed hard over the final 2 km.',
    });

    const activityAfter = await request(app)
      .get('/api/activity')
      .set('Authorization', `Bearer ${token}`);
    expect(activityAfter.status).toBe(200);

    const updatedSession = activityAfter.body.sessions.find((session) => session.id === createdSession.id);
    expect(updatedSession).toBeTruthy();
    expect(updatedSession.name).toBe('Lunch progression');
    expect(updatedSession.notes).toBe('Felt smooth, then closed hard over the final 2 km.');
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

  it('automatically trusts apex and www aliases for configured public origins', async () => {
    const customApp = createApp({ appOrigin: 'https://msmls.org' });
    const { allowedOrigins = [] } = customApp.locals.cors || {};

    expect(allowedOrigins).toEqual(
      expect.arrayContaining(['https://msmls.org', 'https://www.msmls.org'])
    );

    const response = await request(customApp)
      .get('/api/health')
      .set('Host', 'api.msmls.test')
      .set('Origin', 'https://www.msmls.org');

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('status', 'ok');
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

  it('treats apex and www aliases as same-origin requests even when the proxy forwards a default port', async () => {
    const customApp = createApp({ appOrigin: 'http://localhost:4000' });
    const response = await request(customApp)
      .get('/api/health')
      .set('Host', 'msmls.org:443')
      .set('X-Forwarded-Proto', 'https')
      .set('Origin', 'https://www.msmls.org');

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('status', 'ok');
  });

  it('treats forwarded tunnel hostnames as same-origin requests', async () => {
    const customApp = createApp({ appOrigin: 'http://localhost:4000' });
    const response = await request(customApp)
      .get('/api/health')
      .set('Host', '127.0.0.1:4000')
      .set('X-Forwarded-Host', 'misty-river.trycloudflare.com, 127.0.0.1:4000')
      .set('X-Forwarded-Proto', 'https')
      .set('Origin', 'https://misty-river.trycloudflare.com');

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('status', 'ok');
  });

  it('uses the RFC Forwarded header when reconstructing the public host', async () => {
    const customApp = createApp({ appOrigin: 'http://localhost:4000' });
    const response = await request(customApp)
      .get('/api/health')
      .set('Host', '127.0.0.1:4000')
      .set('Forwarded', 'for=203.0.113.10;host=misty-river.trycloudflare.com;proto=https')
      .set('Origin', 'https://misty-river.trycloudflare.com');

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('status', 'ok');
  });

  it('allows loopback dev origins even when the port is not pre-listed', async () => {
    const customApp = createApp({ appOrigin: 'http://localhost:4000' });
    const origins = [
      'http://localhost:5173',
      'http://127.0.0.1:8081',
      'http://127.0.0.1:19006',
      'https://localhost:7443',
      'http://[::1]:8081',
      'http://192.168.1.44:8081',
      'http://10.0.2.2:8081',
    ];

    for (const origin of origins) {
      // eslint-disable-next-line no-await-in-loop
      const response = await request(customApp)
        .get('/api/health')
        .set('Host', 'localhost:4000')
        .set('Origin', origin);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('status', 'ok');
    }
  });

  it('allows loopback dev origins against a public host for local frontend development', async () => {
    const customApp = createApp({ appOrigin: 'https://www.msmls.org' });
    const origins = [
      'http://localhost:3000',
      'http://127.0.0.1:5173',
      'https://localhost:7443',
      'http://0.0.0.0:8080',
    ];

    for (const origin of origins) {
      // eslint-disable-next-line no-await-in-loop
      const response = await request(customApp)
        .get('/api/health')
        .set('Host', 'www.msmls.org')
        .set('Origin', origin);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('status', 'ok');
    }
  });

  it('allows null origins for local-network hosts', async () => {
    const customApp = createApp({ appOrigin: 'http://localhost:4000' });
    const response = await request(customApp)
      .get('/api/health')
      .set('Host', 'localhost:4000')
      .set('Origin', 'null');

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('status', 'ok');
  });

  it('does not allow local-network origins against a public host unless explicitly configured', async () => {
    const customApp = createApp({ appOrigin: 'https://www.msmls.org' });
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const response = await request(customApp)
        .get('/api/health')
        .set('Host', 'www.msmls.org')
        .set('Origin', 'http://192.168.1.44:8081');

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('message', 'Not allowed by CORS');
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('still rejects null origins against public hosts', async () => {
    const customApp = createApp({ appOrigin: 'https://www.msmls.org' });
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const response = await request(customApp)
        .get('/api/health')
        .set('Host', 'www.msmls.org')
        .set('Origin', 'null');

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('message', 'Not allowed by CORS');
    } finally {
      warnSpy.mockRestore();
    }
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

describe('HTTPS enforcement behind trusted proxies', () => {
  it('redirects to the forwarded public host instead of localhost', async () => {
    const customApp = createApp({ requireHttps: true, appOrigin: 'http://localhost:4000' });
    const response = await request(customApp)
      .get('/dashboard?view=athlete')
      .set('Host', '127.0.0.1:4000')
      .set('X-Forwarded-Host', 'misty-river.trycloudflare.com, 127.0.0.1:4000')
      .set('X-Forwarded-Proto', 'http');

    expect(response.status).toBe(301);
    expect(response.headers.location).toBe(
      'https://misty-river.trycloudflare.com/dashboard?view=athlete'
    );
  });
});

function formatLocalDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
