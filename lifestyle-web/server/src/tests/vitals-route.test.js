const request = require('supertest');

describe('Vitals route', () => {
  let app;
  let subjectRow;
  let timelineRows;

  beforeEach(() => {
    jest.resetModules();

    subjectRow = {
      id: 3,
      name: 'Jordan Athlete',
      email: 'athlete@example.com',
      role: 'Athlete',
      avatar_url: null,
      avatar_photo: null,
      weight_category: null,
      goal_steps: null,
      goal_calories: null,
      goal_sleep: null,
      goal_readiness: null,
    };

    timelineRows = [
      {
        date: '2026-05-10',
        restingHr: 60,
        hrvScore: null,
        spo2: null,
        stressScore: null,
        systolic: null,
        diastolic: null,
        glucose: null,
      },
      {
        date: '2026-05-11',
        restingHr: null,
        hrvScore: 70,
        spo2: 97,
        stressScore: null,
        systolic: null,
        diastolic: null,
        glucose: null,
      },
      {
        date: '2026-05-12',
        restingHr: 56,
        hrvScore: null,
        spo2: null,
        stressScore: 41,
        systolic: 122,
        diastolic: 79,
        glucose: 101,
      },
      {
        date: '2026-05-13',
        restingHr: null,
        hrvScore: 74,
        spo2: 98,
        stressScore: null,
        systolic: null,
        diastolic: null,
        glucose: null,
      },
    ];

    jest.doMock('../services/session-store', () => ({
      authenticate: (req, res, next) => {
        req.user = {
          id: 3,
          name: 'Jordan Athlete',
          email: 'athlete@example.com',
          role: 'Athlete',
        };
        next();
      },
    }));

    jest.doMock('../db', () => ({
      prepare: jest.fn((sql) => {
        if (sql.includes('FROM users')) {
          return { get: jest.fn(() => subjectRow) };
        }
        if (sql.includes('FROM coach_athlete_links')) {
          return { get: jest.fn(() => null) };
        }
        if (sql.includes('FROM health_markers')) {
          return { all: jest.fn(() => timelineRows) };
        }
        throw new Error(`Unexpected SQL in test: ${sql}`);
      }),
    }));

    const express = require('express');
    const router = require('../routes/vitals');
    app = express();
    app.use('/api/vitals', router);
  });

  it('builds a latest snapshot from the newest non-null value for each metric', async () => {
    const response = await request(app).get('/api/vitals');

    expect(response.status).toBe(200);
    expect(response.body.latest).toMatchObject({
      date: '2026-05-13',
      restingHr: 56,
      hrvScore: 74,
      spo2: 98,
      stressScore: 41,
      systolic: 122,
      diastolic: 79,
      glucose: 101,
      fieldDates: {
        restingHr: '2026-05-12',
        hrvScore: '2026-05-13',
        spo2: '2026-05-13',
        stressScore: '2026-05-12',
        systolic: '2026-05-12',
        diastolic: '2026-05-12',
        glucose: '2026-05-12',
      },
    });
    expect(response.body.stats).toMatchObject({
      window: 4,
      restingHrCount: 2,
      restingHrAvg: 58,
      restingHrDelta: -4,
      hrvCount: 2,
      hrvAvg: 72,
      spo2Count: 2,
      spo2Avg: 97.5,
      stressCount: 1,
      stressAvg: 41,
      bloodPressureCount: 1,
      systolicAvg: 122,
      diastolicAvg: 79,
      glucoseCount: 1,
      glucoseAvg: 101,
    });
  });

  it('returns a null latest snapshot when no vitals exist yet', async () => {
    timelineRows = [];

    const response = await request(app).get('/api/vitals');

    expect(response.status).toBe(200);
    expect(response.body.latest).toBeNull();
    expect(response.body.timeline).toEqual([]);
    expect(response.body.stats).toMatchObject({
      window: 0,
      restingHrCount: 0,
      glucoseCount: 0,
      bloodPressureCount: 0,
      hrvCount: 0,
      spo2Count: 0,
      stressCount: 0,
    });
  });
});
