const fs = require('fs');
const path = require('path');

const SERVER_ROOT = path.resolve(__dirname, '..', '..');
const CSV_DEMO_DIR = path.join(
  SERVER_ROOT,
  'ppg_glucose',
  'examples',
  'bgl_csv',
  '21031807035'
);
const CSV_DEMO_SIGNAL_PATH = path.join(
  CSV_DEMO_DIR,
  '21031807035_ACTIVITY_recorded_ppg.csv'
);
const DEFAULT_DATASET_ID = 'activity-start';
const DEFAULT_METRIC = 'ppg.raw';
const DEFAULT_FS_HZ = Math.max(1, parseInt(process.env.PPG_BGL_FS_HZ || '500', 10));
const DEFAULT_WINDOW_SECONDS = Math.max(
  1,
  parseInt(process.env.PPG_BGL_WINDOW_SECONDS || '900', 10)
);
const DATASET_WINDOWS = {
  'activity-start': {
    startSec: 0,
    durationSec: 900,
  },
  'activity-middle': {
    startSec: 1603,
    durationSec: 900,
  },
  'activity-finish': {
    startSec: 3206,
    durationSec: 900,
  },
};

function readCsvSignal(filePath = CSV_DEMO_SIGNAL_PATH) {
  const text = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '').trim();
  const lines = text.split(/\r?\n/).filter(Boolean);
  const headers = lines[0].split(',').map((value) => value.trim());
  const timeIndex = headers.indexOf('time_s');
  const signalIndex = headers.indexOf('synthetic_ppg');

  if (timeIndex < 0 || signalIndex < 0) {
    throw new Error('Demo CSV is missing time_s or synthetic_ppg columns.');
  }

  const rows = [];
  for (let index = 1; index < lines.length; index += 1) {
    const columns = lines[index].split(',');
    const timeSec = Number(columns[timeIndex]);
    const signalValue = Number(columns[signalIndex]);
    if (Number.isFinite(timeSec) && Number.isFinite(signalValue)) {
      rows.push({ timeSec, signalValue });
    }
  }

  if (!rows.length) {
    throw new Error('Demo CSV did not contain numeric signal rows.');
  }

  return rows;
}

function resolveDatasetWindow(datasetId, windowSeconds) {
  const dataset = DATASET_WINDOWS[datasetId];
  if (!dataset) {
    throw new Error(
      `Unknown dataset '${datasetId}'. Expected one of: ${Object.keys(DATASET_WINDOWS).join(', ')}.`
    );
  }

  return {
    startSec: dataset.startSec,
    durationSec: windowSeconds,
  };
}

function sliceWindow(rows, startSec, durationSec) {
  const endSec = startSec + durationSec;
  const selected = rows.filter((row) => row.timeSec >= startSec && row.timeSec <= endSec);
  if (selected.length < 2) {
    throw new Error('Selected demo window did not contain enough samples.');
  }
  return selected.map((row) => ({
    timeSec: row.timeSec - startSec,
    signalValue: row.signalValue,
  }));
}

function resampleWindow(rows, targetFsHz, durationSec) {
  const targetSampleCount = Math.max(2, Math.round(targetFsHz * durationSec));
  const sourceTimes = rows.map((row) => row.timeSec);
  const sourceValues = rows.map((row) => row.signalValue);
  const result = new Array(targetSampleCount);
  let sourceIndex = 0;

  for (let index = 0; index < targetSampleCount; index += 1) {
    const targetTimeSec = index / targetFsHz;
    while (
      sourceIndex < sourceTimes.length - 2 &&
      sourceTimes[sourceIndex + 1] < targetTimeSec
    ) {
      sourceIndex += 1;
    }

    const leftTime = sourceTimes[sourceIndex];
    const rightTime = sourceTimes[Math.min(sourceIndex + 1, sourceTimes.length - 1)];
    const leftValue = sourceValues[sourceIndex];
    const rightValue = sourceValues[Math.min(sourceIndex + 1, sourceValues.length - 1)];

    if (!Number.isFinite(leftTime) || !Number.isFinite(rightTime) || rightTime <= leftTime) {
      result[index] = leftValue;
      continue;
    }

    const ratio = Math.max(0, Math.min(1, (targetTimeSec - leftTime) / (rightTime - leftTime)));
    result[index] = leftValue + (rightValue - leftValue) * ratio;
  }

  return result;
}

function seedPpgDemoStream({
  db,
  userId,
  metric = DEFAULT_METRIC,
  datasetId = DEFAULT_DATASET_ID,
  fsHz = DEFAULT_FS_HZ,
  windowSeconds = DEFAULT_WINDOW_SECONDS,
  nowMs = Date.now(),
  signalPath = CSV_DEMO_SIGNAL_PATH,
} = {}) {
  if (!db || typeof db.prepare !== 'function') {
    throw new Error('A Better-SQLite3 database handle is required to seed the demo stream.');
  }

  const datasetWindow = resolveDatasetWindow(datasetId, windowSeconds);
  const sourceRows = readCsvSignal(signalPath);
  const selectedWindow = sliceWindow(sourceRows, datasetWindow.startSec, datasetWindow.durationSec);
  const resampled = resampleWindow(selectedWindow, fsHz, windowSeconds);

  const firstTimestampMs = nowMs - Math.round((resampled.length - 1) * (1000 / fsHz));

  const user = db.prepare('SELECT id, name FROM users WHERE id = ?').get(userId);
  if (!user) {
    throw new Error(`User ${userId} was not found.`);
  }

  const deleteExisting = db.prepare(
    'DELETE FROM sensor_stream_samples WHERE user_id = ? AND metric = ?'
  );
  const insertSample = db.prepare(
    `INSERT INTO sensor_stream_samples (user_id, metric, ts, value)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, metric, ts) DO UPDATE SET
       value = excluded.value,
       updated_at = CURRENT_TIMESTAMP`
  );

  const writeAll = db.transaction(() => {
    deleteExisting.run(userId, metric);
    for (let index = 0; index < resampled.length; index += 1) {
      const ts = firstTimestampMs + Math.round(index * (1000 / fsHz));
      insertSample.run(userId, metric, ts, resampled[index]);
    }
  });

  writeAll();

  return {
    user,
    metric,
    fsHz,
    sampleCount: resampled.length,
    windowSeconds,
    datasetId,
    startedAt: new Date(firstTimestampMs).toISOString(),
    endedAt: new Date(
      firstTimestampMs + Math.round((resampled.length - 1) * (1000 / fsHz))
    ).toISOString(),
  };
}

module.exports = {
  DATASET_WINDOWS,
  DEFAULT_DATASET_ID,
  DEFAULT_FS_HZ,
  DEFAULT_METRIC,
  DEFAULT_WINDOW_SECONDS,
  seedPpgDemoStream,
};
