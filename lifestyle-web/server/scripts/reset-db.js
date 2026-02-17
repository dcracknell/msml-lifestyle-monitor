#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const SERVER_ROOT = path.resolve(__dirname, '..');
const PROJECT_ROOT = path.resolve(SERVER_ROOT, '..');
require('dotenv').config({ path: path.join(SERVER_ROOT, '.env') });

function resolvePath(input, fallback) {
  if (!input) return fallback;
  return path.isAbsolute(input) ? input : path.resolve(PROJECT_ROOT, input);
}

const STORAGE_DIR = resolvePath(
  process.env.DB_STORAGE_DIR,
  path.join(PROJECT_ROOT, 'database', 'storage')
);

const dbFiles = ['lifestyle_monitor.db', 'lifestyle_monitor.db-shm', 'lifestyle_monitor.db-wal'];

dbFiles.forEach((fileName) => {
  const filePath = path.join(STORAGE_DIR, fileName);
  if (fs.existsSync(filePath)) {
    fs.rmSync(filePath);
    console.log(`Deleted ${filePath}`);
  }
});

console.log('Recreating SQLite database from SQL seed...');
// Requiring the DB module will re-run the seed logic.
const db = require('../src/db');
db.close();
console.log('Database reset complete.');
