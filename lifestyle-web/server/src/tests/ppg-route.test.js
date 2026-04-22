const EventEmitter = require('events');
const request = require('supertest');

function createMockProcess() {
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  return proc;
}

describe('PPG route', () => {
  let app;
  let spawnMock;
  let resolvePythonRuntimeMock;
  let dbState;

  beforeEach(() => {
    jest.resetModules();
    delete process.env.PPG_MODEL_PYTHON_BIN;
    delete process.env.PPG_PYTHON_BIN;

    spawnMock = jest.fn();
    resolvePythonRuntimeMock = jest.fn(() => '/tmp/ppg-venv/bin/python');
    dbState = {
      latestRun: null,
      models: [],
      glucoseSamples: [],
    };

    jest.doMock('child_process', () => ({
      spawn: spawnMock,
    }));

    jest.doMock('better-sqlite3', () =>
      jest.fn(() => ({
        prepare: jest.fn((sql) => ({
          get: jest.fn(() => (sql.includes('FROM pipeline_runs') ? dbState.latestRun : null)),
          all: jest.fn(() => {
            if (sql.includes('FROM model_results')) {
              return dbState.models;
            }
            if (sql.includes('FROM features_master')) {
              return dbState.glucoseSamples;
            }
            return [];
          }),
        })),
        close: jest.fn(),
      }))
    );

    jest.doMock('../services/session-store', () => ({
      authenticate: (req, res, next) => next(),
    }));

    jest.doMock('../utils/resolve-python-runtime', () => ({
      resolvePythonRuntime: resolvePythonRuntimeMock,
    }));

    const express = require('express');
    const router = require('../routes/ppg');
    app = express();
    app.use(express.json());
    app.use('/api/ppg', router);
  });

  it('returns latest run results from the pipeline database', async () => {
    dbState.latestRun = {
      run_id: 'demo_20260422_102800',
      is_demo: 1,
      n_subjects: 3,
      status: 'completed',
      error_message: null,
      started_at: '2026-04-22 09:28:00.661088',
      completed_at: '2026-04-22 09:29:35.343674',
      elapsed_seconds: 95.19,
    };
    dbState.models = [
      { task: 'regression', model_name: 'CatBoost', mae: 37.0 },
      { task: 'classification', model_name: 'SVC', f1_hyper: 0.0 },
    ];
    dbState.glucoseSamples = [
      { sid: 184, glucose_time_sec: 1000, glucose_mgdl: 118.2 },
    ];

    const response = await request(app).get('/api/ppg/results');

    expect(response.status).toBe(200);
    expect(response.body.run).toMatchObject({
      run_id: 'demo_20260422_102800',
      status: 'completed',
    });
    expect(response.body.models).toHaveLength(2);
    expect(response.body.glucoseSamples).toEqual([
      { sid: 184, glucose_time_sec: 1000, glucose_mgdl: 118.2 },
    ]);
  });

  it('uses the resolved Python runtime when starting a demo pipeline run', async () => {
    const proc = createMockProcess();
    spawnMock.mockReturnValue(proc);

    const response = await request(app).post('/api/ppg/run').send({ demo: true });

    expect(response.status).toBe(200);
    expect(resolvePythonRuntimeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        localVenvPython: expect.stringContaining('ppg_glucose/.venv/bin/python'),
        localVenvWindowsPython: expect.stringContaining('ppg_glucose/.venv/Scripts/python.exe'),
      })
    );
    expect(spawnMock).toHaveBeenCalledWith(
      '/tmp/ppg-venv/bin/python',
      [
        'run_pipeline.py',
        '--db-url',
        expect.stringContaining('pipeline_results.db'),
        '--demo',
        '--protocol',
        'loso',
      ],
      expect.objectContaining({
        cwd: expect.stringContaining('ppg_glucose'),
      })
    );

    proc.emit('close', 0);
  });

  it('rejects overlapping runs while a pipeline is already active', async () => {
    const proc = createMockProcess();
    spawnMock.mockReturnValue(proc);

    const first = await request(app).post('/api/ppg/run').send({ demo: true });
    const second = await request(app).post('/api/ppg/run').send({ demo: false });

    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    expect(second.body).toEqual({ message: 'Pipeline already running.' });

    proc.emit('close', 0);
  });

  it('rejects full runs when the complete dataset is not available locally', async () => {
    const response = await request(app).post('/api/ppg/run').send({ demo: false });

    expect(response.status).toBe(400);
    expect(spawnMock).not.toHaveBeenCalled();
    expect(response.body.dataset).toMatchObject({
      ready: false,
    });
    expect(response.body.dataset.availableCount).toBeLessThan(response.body.dataset.expectedCount);
    expect(response.body.message).toContain('Full dataset unavailable');
  });

  it('surfaces stderr details when the pipeline process fails', async () => {
    const proc = createMockProcess();
    spawnMock.mockReturnValue(proc);

    const run = await request(app).post('/api/ppg/run').send({ demo: true });
    expect(run.status).toBe(200);

    proc.stderr.emit('data', Buffer.from('Traceback: stage D exploded\n'));
    proc.emit('close', 1);

    const status = await request(app).get('/api/ppg/status');

    expect(status.status).toBe(200);
    expect(status.body.running).toBe(false);
    expect(status.body.inMemory).toMatchObject({
      status: 'failed',
    });
    expect(status.body.inMemory.error).toContain('Process exited with code 1');
    expect(status.body.inMemory.error).toContain('Traceback: stage D exploded');
  });
});
