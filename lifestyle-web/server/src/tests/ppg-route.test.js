const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');
const request = require('supertest');

function createMockProcess() {
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  return proc;
}

function getArgValue(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : null;
}

describe('PPG route', () => {
  let app;
  let spawnMock;
  let spawnSyncMock;
  let resolvePythonRuntimeMock;
  let subjectRow;
  let latestWindowStatusRow;
  let latestSignalSamples;
  let latestRunRow;
  let insertRunRunMock;
  let completeRunRunMock;
  let failRunRunMock;

  beforeEach(() => {
    jest.resetModules();
    process.env.PPG_BGL_FS_HZ = '2';
    process.env.PPG_BGL_WINDOW_SECONDS = '3';
    delete process.env.PPG_MODEL_PYTHON_BIN;
    delete process.env.PPG_PYTHON_BIN;

    subjectRow = {
      id: 3,
      name: 'Jordan Athlete',
      email: 'athlete@example.com',
      role: 'Athlete',
      age: 62,
      sex: 'M',
      bmi: 27.5,
      preop_dm: 0,
      preop_hb: 13.2,
      preop_cr: 0.9,
    };
    latestWindowStatusRow = {
      count: 6,
      minTs: 1000,
      maxTs: 3500,
    };
    latestSignalSamples = [
      { ts: 3500, value: 6 },
      { ts: 3000, value: 5 },
      { ts: 2500, value: 4 },
      { ts: 2000, value: 3 },
      { ts: 1500, value: 2 },
      { ts: 1000, value: 1 },
    ];
    latestRunRow = null;

    spawnMock = jest.fn();
    spawnSyncMock = jest.fn(() => ({
      status: 0,
      stdout: JSON.stringify({ missing: [] }),
      stderr: '',
    }));
    resolvePythonRuntimeMock = jest.fn(() => '/tmp/ppg-venv/bin/python');
    insertRunRunMock = jest.fn(() => ({ lastInsertRowid: 77 }));
    completeRunRunMock = jest.fn();
    failRunRunMock = jest.fn();

    jest.doMock('child_process', () => ({
      spawn: spawnMock,
      spawnSync: spawnSyncMock,
    }));

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

    jest.doMock('../utils/resolve-python-runtime', () => ({
      resolvePythonRuntime: resolvePythonRuntimeMock,
    }));

    jest.doMock('../db', () => ({
      prepare: jest.fn((sql) => {
        if (sql.includes('FROM users')) {
          return { get: jest.fn(() => subjectRow) };
        }
        if (sql.includes('FROM coach_athlete_links')) {
          return { get: jest.fn(() => ({ 1: 1 })) };
        }
        if (sql.includes('COUNT(*) AS count')) {
          return { get: jest.fn(() => latestWindowStatusRow) };
        }
        if (sql.includes('SELECT ts, value')) {
          return { all: jest.fn(() => latestSignalSamples) };
        }
        if (sql.includes('INSERT INTO bgl_inference_runs')) {
          return { run: insertRunRunMock };
        }
        if (sql.includes("SET status = 'completed'")) {
          return { run: completeRunRunMock };
        }
        if (sql.includes("SET status = 'failed'")) {
          return { run: failRunRunMock };
        }
        if (sql.includes('FROM bgl_inference_runs')) {
          return { get: jest.fn(() => latestRunRow) };
        }
        throw new Error(`Unexpected SQL in test: ${sql}`);
      }),
    }));

    const express = require('express');
    const router = require('../routes/ppg');
    app = express();
    app.use(express.json());
    app.use('/api/ppg', router);
  });

  afterEach(() => {
    delete process.env.PPG_BGL_FS_HZ;
    delete process.env.PPG_BGL_WINDOW_SECONDS;
  });

  it('returns the latest persisted prediction after a completed live inference run', async () => {
    const proc = createMockProcess();
    spawnMock.mockReturnValue(proc);

    const run = await request(app).post('/api/ppg/run').send({});
    expect(run.status).toBe(200);
    expect(run.body.mode).toBe('latest');
    expect(run.body.metric).toBe('ppg.raw');

    const spawnArgs = spawnMock.mock.calls[0][1];
    const outputPath = getArgValue(spawnArgs, '--output');
    expect(outputPath).toBeTruthy();

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    const payload = {
      model_name: 'bgl_catboost_current_ppg_demo_no_preop',
      model_version: '20260501T165537Z',
      prediction: {
        label: 'elevated',
        probabilities: {
          low: 0.31,
          elevated: 0.52,
          hyper: 0.17,
        },
      },
      quality: {
        n_subwindows_attempted: 59,
        n_subwindows_used: 52,
        mean_sqi: 0.91,
        min_sqi: 0.82,
      },
      warnings: [],
    };
    fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2));

    proc.emit('close', 0);

    latestRunRow = {
      id: 77,
      userId: 3,
      requestedByUserId: 3,
      mode: 'latest',
      status: 'completed',
      signalMetric: 'ppg.raw',
      signalStartedAt: '2026-05-02T10:00:01.000Z',
      signalEndedAt: '2026-05-02T10:00:03.500Z',
      signalSampleCount: 6,
      signalDurationMs: 2500,
      fsHz: 2,
      strictLength: 1,
      modelName: payload.model_name,
      modelVersion: payload.model_version,
      label: payload.prediction.label,
      probLow: payload.prediction.probabilities.low,
      probElevated: payload.prediction.probabilities.elevated,
      probHyper: payload.prediction.probabilities.hyper,
      meanSqi: payload.quality.mean_sqi,
      minSqi: payload.quality.min_sqi,
      nSubwindowsAttempted: payload.quality.n_subwindows_attempted,
      nSubwindowsUsed: payload.quality.n_subwindows_used,
      errorMessage: null,
      warningsJson: JSON.stringify(payload.warnings),
      resultJson: JSON.stringify(payload),
      startedAt: '2026-05-02T10:01:00.000Z',
      completedAt: '2026-05-02T10:01:05.000Z',
      createdAt: '2026-05-02T10:01:00.000Z',
    };

    const response = await request(app).get('/api/ppg/results');

    expect(response.status).toBe(200);
    expect(response.body.run).toMatchObject({
      status: 'completed',
      mode: 'latest',
    });
    expect(response.body.prediction).toMatchObject({
      model_name: 'bgl_catboost_current_ppg_demo_no_preop',
      prediction: {
        label: 'elevated',
      },
    });
    expect(response.body.run.resultSummary).toMatchObject({
      label: 'elevated',
      confidence: 0.52,
    });
    expect(completeRunRunMock).toHaveBeenCalled();
  });

  it('uses the latest streamed window and user demographics for live inference', async () => {
    const proc = createMockProcess();
    spawnMock.mockReturnValue(proc);

    const response = await request(app).post('/api/ppg/run').send({});

    expect(response.status).toBe(200);
    expect(resolvePythonRuntimeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        localVenvPython: expect.stringContaining('ppg_glucose/.venv/bin/python'),
        localVenvWindowsPython: expect.stringContaining('ppg_glucose/.venv/Scripts/python.exe'),
      })
    );
    const [pythonBin, args, options] = spawnMock.mock.calls[0];
    expect(pythonBin).toBe('/tmp/ppg-venv/bin/python');
    expect(args).toEqual(
      expect.arrayContaining([
        '-m',
        'src.inference.predict',
        '--signal',
        expect.stringMatching(/window\.npy$/),
        '--demographics',
        expect.stringMatching(/demographics\.json$/),
        '--model-dir',
        expect.stringContaining('ppg_glucose/models/bgl_catboost_current_ppg_demo_no_preop'),
        '--fs',
        '2',
      ])
    );
    expect(args).not.toContain('--no-strict-length');
    expect(options).toEqual(
      expect.objectContaining({
        cwd: expect.stringContaining('ppg_glucose'),
      })
    );

    const demographicsPath = getArgValue(args, '--demographics');
    const demographics = JSON.parse(fs.readFileSync(demographicsPath, 'utf8'));
    expect(demographics).toEqual({
      age: 62,
      sex: 'M',
      bmi: 27.5,
      preop_dm: false,
      preop_hb: 13.2,
      preop_cr: 0.9,
    });

    proc.emit('close', 0);
  });

  it('rejects live inference when the BGL profile is incomplete', async () => {
    subjectRow = {
      ...subjectRow,
      age: null,
      bmi: null,
    };

    const response = await request(app).post('/api/ppg/run').send({});

    expect(response.status).toBe(400);
    expect(spawnMock).not.toHaveBeenCalled();
    expect(response.body.message).toContain('BGL profile is incomplete');
    expect(response.body.message).toContain('age');
    expect(response.body.message).toContain('bmi');
  });

  it('rejects overlapping runs while an inference is already active', async () => {
    const proc = createMockProcess();
    spawnMock.mockReturnValue(proc);

    const first = await request(app).post('/api/ppg/run').send({});
    const second = await request(app).post('/api/ppg/run').send({ demo: true });

    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    expect(second.body).toEqual({ message: 'BGL inference already running.' });

    proc.emit('close', 0);
  });

  it('surfaces stderr details when the inference process fails', async () => {
    const proc = createMockProcess();
    spawnMock.mockReturnValue(proc);

    const run = await request(app).post('/api/ppg/run').send({});
    expect(run.status).toBe(200);

    proc.stderr.emit('data', Buffer.from('Traceback: pyPPG stage exploded\n'));
    proc.emit('close', 1);

    const status = await request(app).get('/api/ppg/status');

    expect(status.status).toBe(200);
    expect(status.body.running).toBe(false);
    expect(status.body.inMemory).toMatchObject({
      status: 'failed',
    });
    expect(status.body.inMemory.error).toContain('Process exited with code 1');
    expect(status.body.inMemory.error).toContain('Traceback: pyPPG stage exploded');
    expect(failRunRunMock).toHaveBeenCalled();
  });

  it('returns an actionable error when the Python runtime is missing dependencies', async () => {
    spawnSyncMock.mockReturnValue({
      status: 1,
      stdout: JSON.stringify({ missing: ['pyPPG'] }),
      stderr: '',
    });

    const response = await request(app).post('/api/ppg/run').send({ demo: true });

    expect(response.status).toBe(500);
    expect(spawnMock).not.toHaveBeenCalled();
    expect(response.body.message).toContain('setup:ppg-model');
    expect(response.body.message).toContain('pyPPG');
  });
});
