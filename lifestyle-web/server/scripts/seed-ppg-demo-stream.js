#!/usr/bin/env node
const path = require('path');

const SERVER_ROOT = path.resolve(__dirname, '..');
require('dotenv').config({ path: path.join(SERVER_ROOT, '.env') });
const db = require('../src/db');
const {
  DATASET_WINDOWS,
  DEFAULT_DATASET_ID,
  DEFAULT_FS_HZ,
  DEFAULT_METRIC,
  DEFAULT_WINDOW_SECONDS,
  seedPpgDemoStream,
} = require('../src/services/ppg-demo-stream-seeder');

const DEFAULT_USER_ID = 3;

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseArgs(argv) {
  const options = {
    userId: DEFAULT_USER_ID,
    metric: DEFAULT_METRIC,
    datasetId: DEFAULT_DATASET_ID,
    fsHz: DEFAULT_FS_HZ,
    windowSeconds: DEFAULT_WINDOW_SECONDS,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const nextValue = argv[index + 1];

    switch (token) {
      case '--user':
      case '--user-id':
        options.userId = parsePositiveInteger(nextValue, options.userId);
        index += 1;
        break;
      case '--metric':
        options.metric = String(nextValue || '').trim() || options.metric;
        index += 1;
        break;
      case '--dataset':
        options.datasetId = String(nextValue || '').trim().toLowerCase() || options.datasetId;
        index += 1;
        break;
      case '--fs':
        options.fsHz = parsePositiveInteger(nextValue, options.fsHz);
        index += 1;
        break;
      case '--seconds':
        options.windowSeconds = parsePositiveInteger(nextValue, options.windowSeconds);
        index += 1;
        break;
      default:
        break;
    }
  }

  return options;
}

try {
  const result = seedPpgDemoStream({
    db,
    ...parseArgs(process.argv.slice(2)),
  });
  console.log(
    `Seeded ${result.sampleCount} ${result.metric} samples for user ${result.user.id} (${result.user.name}) `
      + `from ${result.datasetId} at ${result.fsHz} Hz over ${result.windowSeconds}s.`
  );
  console.log(`Window: ${result.startedAt} -> ${result.endedAt}`);
} catch (error) {
  console.error(error.message || String(error));
  process.exitCode = 1;
} finally {
  db.close();
}
