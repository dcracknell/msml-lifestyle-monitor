const fs = require('fs');
const os = require('os');
const path = require('path');

const tempStorageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lifestyle-db-'));

process.env.NODE_ENV = 'test';
process.env.DB_STORAGE_DIR = tempStorageDir;
process.env.DB_SQL_DIR = path.join(__dirname, '..', '..', '..', 'database', 'sql');
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-session-secret';
