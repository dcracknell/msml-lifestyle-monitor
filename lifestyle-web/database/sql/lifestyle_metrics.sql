DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS coach_athlete_links;
DROP TABLE IF EXISTS daily_metrics;
DROP TABLE IF EXISTS heart_rate_zones;
DROP TABLE IF EXISTS nutrition_macros;
DROP TABLE IF EXISTS nutrition_entries;
DROP TABLE IF EXISTS hydration_logs;
DROP TABLE IF EXISTS sleep_stages;

CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL,
  avatar_url TEXT,
  avatar_photo TEXT,
  goal_steps INTEGER,
  goal_calories INTEGER,
  goal_sleep REAL,
  goal_readiness INTEGER
);

CREATE TABLE coach_athlete_links (
  id INTEGER PRIMARY KEY,
  coach_id INTEGER NOT NULL,
  athlete_id INTEGER NOT NULL,
  UNIQUE (coach_id, athlete_id),
  FOREIGN KEY (coach_id) REFERENCES users (id),
  FOREIGN KEY (athlete_id) REFERENCES users (id)
);

INSERT INTO users (
  id,
  name,
  email,
  password_hash,
  role,
  avatar_url,
  avatar_photo,
  goal_steps,
  goal_calories,
  goal_sleep,
  goal_readiness
) VALUES
  (1, 'Pat Head Coach', 'head.coach@example.com', 'seed-placeholder', 'Head Coach', 'https://images.unsplash.com/photo-1504593811423-6dd665756598?auto=format&fit=crop&w=200&q=80', NULL, 12000, 2500, 7.5, 90),
  (2, 'Casey Coach', 'coach@example.com', 'seed-placeholder', 'Coach', 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=200&q=80', NULL, 11000, 2400, 7.4, 85),
  (3, 'Jordan Athlete', 'athlete@example.com', 'seed-placeholder', 'Athlete', 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=200&q=80', NULL, 10000, 2200, 7.2, 80);

INSERT INTO coach_athlete_links (coach_id, athlete_id) VALUES
  (1, 2),
  (1, 3),
  (2, 3);

CREATE TABLE daily_metrics (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  steps INTEGER,
  calories INTEGER,
  sleep_hours REAL,
  readiness_score INTEGER,
  FOREIGN KEY (user_id) REFERENCES users (id)
);

INSERT INTO daily_metrics (user_id, date, steps, calories, sleep_hours, readiness_score) VALUES
  (1, '2025-03-12', 12840, 2480, 7.6, 92),
  (1, '2025-03-13', 13200, 2525, 7.4, 91),
  (1, '2025-03-14', 14110, 2590, 7.8, 94),
  (1, '2025-03-15', 12580, 2450, 7.2, 89),
  (1, '2025-03-16', 13640, 2510, 7.7, 93),
  (2, '2025-03-12', 11420, 2320, 7.5, 86),
  (2, '2025-03-13', 11890, 2380, 7.3, 84),
  (2, '2025-03-14', 12240, 2415, 7.6, 87),
  (2, '2025-03-15', 10980, 2290, 7.1, 82),
  (2, '2025-03-16', 11650, 2350, 7.4, 85),
  (3, '2025-03-12', 10430, 2180, 7.0, 79),
  (3, '2025-03-13', 9860, 2105, 6.8, 75),
  (3, '2025-03-14', 11120, 2235, 7.2, 82),
  (3, '2025-03-15', 10580, 2195, 7.1, 80),
  (3, '2025-03-16', 10890, 2225, 7.3, 81);

CREATE TABLE heart_rate_zones (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  zone TEXT NOT NULL,
  minutes INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users (id)
);

INSERT INTO heart_rate_zones (user_id, zone, minutes) VALUES
  (1, 'Peak', 38),
  (1, 'Cardio', 64),
  (1, 'Fat Burn', 82),
  (1, 'Ease', 255),
  (2, 'Peak', 29),
  (2, 'Cardio', 57),
  (2, 'Fat Burn', 88),
  (2, 'Ease', 242),
  (3, 'Peak', 22),
  (3, 'Cardio', 48),
  (3, 'Fat Burn', 79),
  (3, 'Ease', 265);

CREATE TABLE nutrition_macros (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  target_calories INTEGER,
  protein_grams INTEGER,
  carbs_grams INTEGER,
  fats_grams INTEGER,
  FOREIGN KEY (user_id) REFERENCES users (id)
);

INSERT INTO nutrition_macros (user_id, date, target_calories, protein_grams, carbs_grams, fats_grams) VALUES
  (1, '2025-03-16', 2600, 165, 285, 85),
  (2, '2025-03-16', 2400, 150, 255, 78),
  (3, '2025-03-16', 2250, 135, 230, 70);

CREATE TABLE nutrition_entries (
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
);

INSERT INTO nutrition_entries (
  user_id,
  date,
  item_name,
  item_type,
  calories,
  protein_grams,
  carbs_grams,
  fats_grams,
  weight_amount,
  weight_unit,
  barcode,
  photo_data
) VALUES
  (1, '2025-03-16', 'Recovery smoothie', 'Liquid', 310, 24, 42, 7, 420, 'ml', '001234567890', 'cGF0aF9zbW9vdGhpZQ=='),
  (2, '2025-03-16', 'Whole grain bowl', 'Food', 520, 32, 68, 14, 350, 'g', NULL, 'Y2FzZXlfYm93bA=='),
  (3, '2025-03-15', 'Overnight oats', 'Food', 410, 18, 55, 12, 260, 'g', NULL, 'am9yZGFuX293YXRz');

CREATE TABLE hydration_logs (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  ounces REAL NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users (id)
);

INSERT INTO hydration_logs (user_id, date, ounces) VALUES
  (1, '2025-03-12', 96),
  (1, '2025-03-13', 90),
  (1, '2025-03-14', 104),
  (1, '2025-03-15', 88),
  (1, '2025-03-16', 101),
  (2, '2025-03-12', 82),
  (2, '2025-03-13', 86),
  (2, '2025-03-14', 93),
  (2, '2025-03-15', 79),
  (2, '2025-03-16', 87),
  (3, '2025-03-12', 74),
  (3, '2025-03-13', 70),
  (3, '2025-03-14', 78),
  (3, '2025-03-15', 75),
  (3, '2025-03-16', 80);

CREATE TABLE sleep_stages (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  deep_minutes INTEGER,
  rem_minutes INTEGER,
  light_minutes INTEGER,
  FOREIGN KEY (user_id) REFERENCES users (id)
);

INSERT INTO sleep_stages (user_id, date, deep_minutes, rem_minutes, light_minutes) VALUES
  (1, '2025-03-16', 120, 140, 210),
  (2, '2025-03-16', 110, 135, 215),
  (3, '2025-03-16', 95, 120, 200);
