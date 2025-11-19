const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const loadSqlStatements = require('./utils/load-sql');
const { ROLES, coerceRole } = require('./utils/role');
const { hashPassword } = require('./utils/hash-password');

const DATA_ROOT = path.join(__dirname, '..', '..', 'database');
const seedUserPasswords = [
  { email: 'head.coach@example.com', env: 'HEAD_COACH_SEED_PASSWORD', fallback: 'Password' },
  { email: 'coach@example.com', env: 'COACH_SEED_PASSWORD', fallback: 'Password' },
  { email: 'athlete@example.com', env: 'ATHLETE_SEED_PASSWORD', fallback: 'Password' },
];

function resolvePath(input, fallback) {
  if (!input) return fallback;
  return path.isAbsolute(input) ? input : path.resolve(__dirname, '..', '..', input);
}

const STORAGE_DIR = resolvePath(process.env.DB_STORAGE_DIR, path.join(DATA_ROOT, 'storage'));
const SQL_DIR = resolvePath(process.env.DB_SQL_DIR, path.join(DATA_ROOT, 'sql'));
const DB_PATH = path.join(STORAGE_DIR, 'lifestyle_monitor.db');
const SQL_SEED_PATH = path.join(SQL_DIR, 'lifestyle_metrics.sql');

fs.mkdirSync(STORAGE_DIR, { recursive: true });
fs.mkdirSync(SQL_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

function seedDatabase() {
  const hasUsersTable = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'")
    .get();

  if (hasUsersTable) {
    return;
  }

  const statements = loadSqlStatements(SQL_SEED_PATH);
  const runAll = db.transaction(() => {
    statements.forEach((statement) => {
      db.prepare(statement).run();
    });
  });

  runAll();
  rehashSeedUserPasswords();
}

seedDatabase();

function rehashSeedUserPasswords() {
  const update = db.prepare('UPDATE users SET password_hash = ? WHERE email = ?');
  seedUserPasswords.forEach(({ email, env, fallback }) => {
    const password = process.env[env] || fallback;
    update.run(hashPassword(password), email);
  });
}

function ensureCoachAthleteLinksTable() {
  db.prepare(
    `CREATE TABLE IF NOT EXISTS coach_athlete_links (
      id INTEGER PRIMARY KEY,
      coach_id INTEGER NOT NULL,
      athlete_id INTEGER NOT NULL,
      UNIQUE (coach_id, athlete_id),
      FOREIGN KEY (coach_id) REFERENCES users (id),
      FOREIGN KEY (athlete_id) REFERENCES users (id)
    )`
  ).run();
}

ensureCoachAthleteLinksTable();
function ensurePasswordResetTable() {
  db.prepare(
    `CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL,
      token TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users (id)
    )`
  ).run();
  db.prepare('CREATE INDEX IF NOT EXISTS idx_password_reset_token ON password_reset_tokens(token)').run();
}

ensurePasswordResetTable();

function ensureWeightCategoryColumn() {
  const hasColumn = db
    .prepare("PRAGMA table_info(users)")
    .all()
    .some((column) => column.name === 'weight_category');
  if (!hasColumn) {
    db.prepare('ALTER TABLE users ADD COLUMN weight_category TEXT').run();
  }
}

ensureWeightCategoryColumn();

function ensureNutritionEntriesTable() {
  db.prepare(
    `CREATE TABLE IF NOT EXISTS nutrition_entries (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      item_name TEXT NOT NULL,
      item_type TEXT NOT NULL DEFAULT 'Food',
      calories INTEGER NOT NULL,
      protein_grams INTEGER DEFAULT 0,
      carbs_grams INTEGER DEFAULT 0,
      fats_grams INTEGER DEFAULT 0,
      weight_amount REAL,
      weight_unit TEXT DEFAULT 'g',
      barcode TEXT,
      photo_data TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users (id)
    )`
  ).run();
  db.prepare('CREATE INDEX IF NOT EXISTS idx_nutrition_entries_user_date ON nutrition_entries(user_id, date)').run();
}

ensureNutritionEntriesTable();

function ensureNutritionEntryWeightColumns() {
  const columns = db.prepare("PRAGMA table_info(nutrition_entries)").all();
  const hasAmount = columns.some((column) => column.name === 'weight_amount');
  const hasUnit = columns.some((column) => column.name === 'weight_unit');

  if (!hasAmount) {
    db.prepare('ALTER TABLE nutrition_entries ADD COLUMN weight_amount REAL').run();
  }
  if (!hasUnit) {
    db.prepare("ALTER TABLE nutrition_entries ADD COLUMN weight_unit TEXT DEFAULT 'g'").run();
    db.prepare("UPDATE nutrition_entries SET weight_unit = 'g' WHERE weight_unit IS NULL OR weight_unit = ''").run();
  }
}

ensureNutritionEntryWeightColumns();

function ensureNutritionEntryPhotoColumn() {
  const columns = db.prepare("PRAGMA table_info(nutrition_entries)").all();
  const hasPhoto = columns.some((column) => column.name === 'photo_data');
  if (!hasPhoto) {
    db.prepare('ALTER TABLE nutrition_entries ADD COLUMN photo_data TEXT').run();
  }
}

ensureNutritionEntryPhotoColumn();

function ensureWeightLogsTable() {
  db.prepare(
    `CREATE TABLE IF NOT EXISTS weight_logs (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      weight_kg REAL NOT NULL,
      recorded_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users (id),
      UNIQUE (user_id, date)
    )`
  ).run();
  db.prepare(
    `CREATE INDEX IF NOT EXISTS idx_weight_logs_user_date
       ON weight_logs(user_id, date)`
  ).run();
}

ensureWeightLogsTable();

function ensureTrigger(name, statement) {
  const exists = db
    .prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name = ?")
    .get(name);
  if (!exists) {
    db.exec(statement);
  }
}

function ensureSyncInfrastructure() {
  db.prepare(
    `CREATE TABLE IF NOT EXISTS sync_outbox (
      id INTEGER PRIMARY KEY,
      table_name TEXT NOT NULL,
      row_id INTEGER,
      operation TEXT NOT NULL CHECK (operation IN ('insert', 'update', 'delete')),
      payload TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      delivered INTEGER DEFAULT 0,
      delivered_at TEXT
    )`
  ).run();
  db.prepare(
    `CREATE INDEX IF NOT EXISTS idx_sync_outbox_pending
       ON sync_outbox(delivered, id)`
  ).run();
  db.prepare(
    `CREATE TABLE IF NOT EXISTS sync_cursors (
      id INTEGER PRIMARY KEY,
      client_id TEXT NOT NULL UNIQUE,
      last_outbox_id INTEGER DEFAULT 0,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`
  ).run();

  ensureTrigger(
    'trg_users_insert_outbox',
    `CREATE TRIGGER trg_users_insert_outbox
       AFTER INSERT ON users
       BEGIN
         INSERT INTO sync_outbox(table_name, row_id, operation, payload)
         VALUES(
           'users',
           NEW.id,
           'insert',
           json_object(
             'id', NEW.id,
             'name', NEW.name,
             'email', NEW.email,
             'role', NEW.role,
             'avatar_url', NEW.avatar_url,
             'avatar_photo', NEW.avatar_photo,
             'weight_category', NEW.weight_category,
             'goal_steps', NEW.goal_steps,
             'goal_calories', NEW.goal_calories,
             'goal_sleep', NEW.goal_sleep,
             'goal_readiness', NEW.goal_readiness,
             'strava_client_id', NEW.strava_client_id,
             'strava_client_secret', NEW.strava_client_secret,
             'strava_redirect_uri', NEW.strava_redirect_uri
           )
         );
       END`
  );

  ensureTrigger(
    'trg_users_update_outbox',
    `CREATE TRIGGER trg_users_update_outbox
       AFTER UPDATE ON users
       BEGIN
         INSERT INTO sync_outbox(table_name, row_id, operation, payload)
         VALUES(
           'users',
           NEW.id,
           'update',
           json_object(
             'id', NEW.id,
             'name', NEW.name,
             'email', NEW.email,
             'role', NEW.role,
             'avatar_url', NEW.avatar_url,
             'avatar_photo', NEW.avatar_photo,
             'weight_category', NEW.weight_category,
             'goal_steps', NEW.goal_steps,
             'goal_calories', NEW.goal_calories,
             'goal_sleep', NEW.goal_sleep,
             'goal_readiness', NEW.goal_readiness,
             'strava_client_id', NEW.strava_client_id,
             'strava_client_secret', NEW.strava_client_secret,
             'strava_redirect_uri', NEW.strava_redirect_uri
           )
         );
       END`
  );

  ensureTrigger(
    'trg_users_delete_outbox',
    `CREATE TRIGGER trg_users_delete_outbox
       AFTER DELETE ON users
       BEGIN
         INSERT INTO sync_outbox(table_name, row_id, operation, payload)
         VALUES('users', OLD.id, 'delete', json_object('id', OLD.id));
       END`
  );

  ensureTrigger(
    'trg_daily_metrics_insert_outbox',
    `CREATE TRIGGER trg_daily_metrics_insert_outbox
       AFTER INSERT ON daily_metrics
       BEGIN
         INSERT INTO sync_outbox(table_name, row_id, operation, payload)
         VALUES(
           'daily_metrics',
           NEW.id,
           'insert',
           json_object(
             'id', NEW.id,
             'user_id', NEW.user_id,
             'date', NEW.date,
             'steps', NEW.steps,
             'calories', NEW.calories,
             'sleep_hours', NEW.sleep_hours,
             'readiness_score', NEW.readiness_score
           )
         );
       END`
  );

  ensureTrigger(
    'trg_daily_metrics_update_outbox',
    `CREATE TRIGGER trg_daily_metrics_update_outbox
       AFTER UPDATE ON daily_metrics
       BEGIN
         INSERT INTO sync_outbox(table_name, row_id, operation, payload)
         VALUES(
           'daily_metrics',
           NEW.id,
           'update',
           json_object(
             'id', NEW.id,
             'user_id', NEW.user_id,
             'date', NEW.date,
             'steps', NEW.steps,
             'calories', NEW.calories,
             'sleep_hours', NEW.sleep_hours,
             'readiness_score', NEW.readiness_score
           )
         );
       END`
  );

  ensureTrigger(
    'trg_daily_metrics_delete_outbox',
    `CREATE TRIGGER trg_daily_metrics_delete_outbox
       AFTER DELETE ON daily_metrics
       BEGIN
         INSERT INTO sync_outbox(table_name, row_id, operation, payload)
         VALUES(
           'daily_metrics',
           OLD.id,
           'delete',
           json_object('id', OLD.id, 'user_id', OLD.user_id, 'date', OLD.date)
         );
       END`
  );

  ensureTrigger(
    'trg_nutrition_entries_insert_outbox',
    `CREATE TRIGGER trg_nutrition_entries_insert_outbox
       AFTER INSERT ON nutrition_entries
       BEGIN
         INSERT INTO sync_outbox(table_name, row_id, operation, payload)
         VALUES(
           'nutrition_entries',
           NEW.id,
           'insert',
           json_object(
             'id', NEW.id,
             'user_id', NEW.user_id,
             'date', NEW.date,
             'item_name', NEW.item_name,
             'item_type', NEW.item_type,
             'barcode', NEW.barcode,
             'calories', NEW.calories,
             'protein_grams', NEW.protein_grams,
             'carbs_grams', NEW.carbs_grams,
             'fats_grams', NEW.fats_grams,
             'weight_amount', NEW.weight_amount,
             'weight_unit', NEW.weight_unit,
             'created_at', NEW.created_at
           )
         );
       END`
  );

  ensureTrigger(
    'trg_nutrition_entries_update_outbox',
    `CREATE TRIGGER trg_nutrition_entries_update_outbox
       AFTER UPDATE ON nutrition_entries
       BEGIN
         INSERT INTO sync_outbox(table_name, row_id, operation, payload)
         VALUES(
           'nutrition_entries',
           NEW.id,
           'update',
           json_object(
             'id', NEW.id,
             'user_id', NEW.user_id,
             'date', NEW.date,
             'item_name', NEW.item_name,
             'item_type', NEW.item_type,
             'barcode', NEW.barcode,
             'calories', NEW.calories,
             'protein_grams', NEW.protein_grams,
             'carbs_grams', NEW.carbs_grams,
             'fats_grams', NEW.fats_grams,
             'weight_amount', NEW.weight_amount,
             'weight_unit', NEW.weight_unit,
             'created_at', NEW.created_at
           )
         );
       END`
  );

  ensureTrigger(
    'trg_nutrition_entries_delete_outbox',
    `CREATE TRIGGER trg_nutrition_entries_delete_outbox
       AFTER DELETE ON nutrition_entries
       BEGIN
         INSERT INTO sync_outbox(table_name, row_id, operation, payload)
         VALUES(
           'nutrition_entries',
           OLD.id,
           'delete',
           json_object('id', OLD.id, 'user_id', OLD.user_id, 'date', OLD.date)
         );
       END`
  );

  ensureTrigger(
    'trg_weight_logs_insert_outbox',
    `CREATE TRIGGER trg_weight_logs_insert_outbox
       AFTER INSERT ON weight_logs
       BEGIN
         INSERT INTO sync_outbox(table_name, row_id, operation, payload)
         VALUES(
           'weight_logs',
           NEW.id,
           'insert',
           json_object(
             'id', NEW.id,
             'user_id', NEW.user_id,
             'date', NEW.date,
             'weight_kg', NEW.weight_kg,
             'recorded_at', NEW.recorded_at
           )
         );
       END`
  );

  ensureTrigger(
    'trg_weight_logs_update_outbox',
    `CREATE TRIGGER trg_weight_logs_update_outbox
       AFTER UPDATE ON weight_logs
       BEGIN
         INSERT INTO sync_outbox(table_name, row_id, operation, payload)
         VALUES(
           'weight_logs',
           NEW.id,
           'update',
           json_object(
             'id', NEW.id,
             'user_id', NEW.user_id,
             'date', NEW.date,
             'weight_kg', NEW.weight_kg,
             'recorded_at', NEW.recorded_at
           )
         );
       END`
  );

  ensureTrigger(
    'trg_weight_logs_delete_outbox',
    `CREATE TRIGGER trg_weight_logs_delete_outbox
       AFTER DELETE ON weight_logs
       BEGIN
         INSERT INTO sync_outbox(table_name, row_id, operation, payload)
         VALUES(
           'weight_logs',
           OLD.id,
           'delete',
           json_object('id', OLD.id, 'user_id', OLD.user_id, 'date', OLD.date)
         );
       END`
  );
}

ensureSyncInfrastructure();

function ensureUserStravaColumns() {
  const columns = db.prepare("PRAGMA table_info(users)").all();
  const hasClientId = columns.some((column) => column.name === 'strava_client_id');
  const hasClientSecret = columns.some((column) => column.name === 'strava_client_secret');
  const hasRedirect = columns.some((column) => column.name === 'strava_redirect_uri');

  if (!hasClientId) {
    db.prepare('ALTER TABLE users ADD COLUMN strava_client_id TEXT').run();
  }
  if (!hasClientSecret) {
    db.prepare('ALTER TABLE users ADD COLUMN strava_client_secret TEXT').run();
  }
  if (!hasRedirect) {
    db.prepare('ALTER TABLE users ADD COLUMN strava_redirect_uri TEXT').run();
  }
}

ensureUserStravaColumns();

function ensureActivityTables() {
  db.prepare(
    `CREATE TABLE IF NOT EXISTS activity_sessions (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL,
      source TEXT NOT NULL DEFAULT 'manual',
      source_id TEXT,
      name TEXT NOT NULL,
      sport_type TEXT NOT NULL DEFAULT 'Run',
      start_time TEXT NOT NULL,
      distance_m REAL,
      moving_time_s INTEGER,
      elapsed_time_s INTEGER,
      average_hr REAL,
      max_hr REAL,
      average_pace_s REAL,
      average_cadence REAL,
      average_power REAL,
      elevation_gain_m REAL,
      calories REAL,
      perceived_effort INTEGER,
      vo2max_estimate REAL,
      training_load REAL,
      strava_activity_id INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users (id),
      UNIQUE (user_id, strava_activity_id)
    )`
  ).run();
  db.prepare(
    `CREATE INDEX IF NOT EXISTS idx_activity_sessions_user_time
     ON activity_sessions(user_id, start_time)`
  ).run();

  db.prepare(
    `CREATE TABLE IF NOT EXISTS activity_splits (
      id INTEGER PRIMARY KEY,
      session_id INTEGER NOT NULL,
      split_index INTEGER NOT NULL,
      distance_m REAL NOT NULL,
      moving_time_s INTEGER NOT NULL,
      average_pace_s REAL,
      elevation_gain_m REAL,
      average_hr REAL,
      FOREIGN KEY (session_id) REFERENCES activity_sessions (id)
    )`
  ).run();
  db.prepare(
    `CREATE INDEX IF NOT EXISTS idx_activity_splits_session
     ON activity_splits(session_id, split_index)`
  ).run();
}

ensureActivityTables();

function ensureHealthMarkersTable() {
  db.prepare(
    `CREATE TABLE IF NOT EXISTS health_markers (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      resting_hr INTEGER,
      hrv_score INTEGER,
      spo2 INTEGER,
      stress_score INTEGER,
      systolic_bp INTEGER,
      diastolic_bp INTEGER,
      glucose_mg_dl INTEGER,
      FOREIGN KEY (user_id) REFERENCES users (id)
    )`
  ).run();
  db.prepare(
    `CREATE INDEX IF NOT EXISTS idx_health_markers_user_date
     ON health_markers(user_id, date)`
  ).run();
}

ensureHealthMarkersTable();

function ensureStravaTables() {
  db.prepare(
    `CREATE TABLE IF NOT EXISTS strava_connections (
      id INTEGER PRIMARY KEY,
      user_id INTEGER UNIQUE NOT NULL,
      athlete_id INTEGER,
      athlete_name TEXT,
      client_id TEXT,
      client_secret TEXT,
      redirect_uri TEXT,
      access_token TEXT,
      refresh_token TEXT,
      expires_at INTEGER,
      scope TEXT,
      last_sync TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users (id)
    )`
  ).run();
  db.prepare(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_strava_connections_user
     ON strava_connections(user_id)`
  ).run();

  const columns = db.prepare("PRAGMA table_info(strava_connections)").all();
  const hasClientId = columns.some((column) => column.name === 'client_id');
  const hasClientSecret = columns.some((column) => column.name === 'client_secret');
  const hasRedirect = columns.some((column) => column.name === 'redirect_uri');

  if (!hasClientId) {
    db.prepare('ALTER TABLE strava_connections ADD COLUMN client_id TEXT').run();
  }
  if (!hasClientSecret) {
    db.prepare('ALTER TABLE strava_connections ADD COLUMN client_secret TEXT').run();
  }
  if (!hasRedirect) {
    db.prepare('ALTER TABLE strava_connections ADD COLUMN redirect_uri TEXT').run();
  }

  db.prepare(
    `CREATE TABLE IF NOT EXISTS strava_oauth_states (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL,
      state TEXT NOT NULL UNIQUE,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      expires_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users (id)
    )`
  ).run();
  db.prepare(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_strava_oauth_state
     ON strava_oauth_states(state)`
  ).run();
}

ensureStravaTables();

function ensureAvatarPhotoColumn() {
  const columns = db.prepare(`PRAGMA table_info(users)`).all();
  const hasPhotoColumn = columns.some((column) => column.name === 'avatar_photo');
  if (!hasPhotoColumn) {
    db.prepare(`ALTER TABLE users ADD COLUMN avatar_photo TEXT`).run();
  }
}

ensureAvatarPhotoColumn();

function ensureHeadCoachAccount() {
  const email = 'head.coach@example.com';
  const seedPassword = process.env.HEAD_COACH_SEED_PASSWORD || 'Password';
  const role = ROLES.HEAD_COACH;
  const avatarUrl = 'https://images.unsplash.com/photo-1504593811423-6dd665756598?auto=format&fit=crop&w=200&q=80';
  const existing = db
    .prepare('SELECT id, role, weight_category FROM users WHERE email = ?')
    .get(email);

  if (!existing) {
    const passwordHash = hashPassword(seedPassword);
    db.prepare(
      `INSERT INTO users (name, email, password_hash, role, avatar_url, avatar_photo, weight_category, goal_steps, goal_calories, goal_sleep, goal_readiness)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL)`
    ).run('Pat Head Coach', email, passwordHash, role, avatarUrl, null, 'Heavyweight');
    return;
  }

  const updates = [];
  const params = [];
  if (coerceRole(existing.role) !== role) {
    updates.push('role = ?');
    params.push(role);
  }
  if (!existing.weight_category) {
    updates.push('weight_category = ?');
    params.push('Heavyweight');
  }
  if (updates.length) {
    db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params, existing.id);
  }
}

function ensureHeadCoachLinks() {
  const users = db.prepare('SELECT id, role FROM users').all();
  const headCoach = users.find((user) => coerceRole(user.role) === ROLES.HEAD_COACH);
  if (!headCoach) return;

  const athletes = users.filter((user) => coerceRole(user.role) === ROLES.ATHLETE);

  const insertLink = db.prepare(
    `INSERT OR IGNORE INTO coach_athlete_links (coach_id, athlete_id) VALUES (?, ?)`
  );

  athletes.forEach(({ id }) => {
    if (id === headCoach.id) return;
    insertLink.run(headCoach.id, id);
  });
}

ensureHeadCoachAccount();
ensureHeadCoachLinks();

function ensureSensorStreamTables() {
  db.prepare(
    `CREATE TABLE IF NOT EXISTS sensor_stream_samples (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL,
      metric TEXT NOT NULL,
      ts INTEGER NOT NULL,
      value REAL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users (id)
    )`
  ).run();
  db.prepare(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_sensor_stream_unique
       ON sensor_stream_samples(user_id, metric, ts)`
  ).run();
  db.prepare(
    `CREATE INDEX IF NOT EXISTS idx_sensor_stream_query
       ON sensor_stream_samples(user_id, metric, ts DESC)`
  ).run();
}

ensureSensorStreamTables();

module.exports = db;
