const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const loadSqlStatements = require('../utils/load-sql');

function getSqlSeedPath() {
  return path.resolve(__dirname, '..', '..', '..', 'database', 'sql', 'lifestyle_metrics.sql');
}

describe('Lifestyle SQL seed', () => {
  it('executes without errors and seeds demo data', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lifestyle-sql-'));
    const dbPath = path.join(tempDir, 'seed.db');
    const db = new Database(dbPath);
    const statements = loadSqlStatements(getSqlSeedPath());

    expect(() => {
      const runAll = db.transaction(() => {
        statements.forEach((statement) => {
          db.prepare(statement).run();
        });
      });
      runAll();
    }).not.toThrow();

    const { count: userCount } = db.prepare('SELECT COUNT(*) AS count FROM users').get();
    const { count: metricCount } = db.prepare('SELECT COUNT(*) AS count FROM daily_metrics').get();
    expect(userCount).toBeGreaterThanOrEqual(3);
    expect(metricCount).toBeGreaterThan(0);

    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});
