DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS coach_athlete_links;
DROP TABLE IF EXISTS daily_metrics;
DROP TABLE IF EXISTS heart_rate_zones;
DROP TABLE IF EXISTS activity_splits;
DROP TABLE IF EXISTS activity_sessions;
DROP TABLE IF EXISTS nutrition_macros;
DROP TABLE IF EXISTS nutrition_entries;
DROP TABLE IF EXISTS hydration_logs;
DROP TABLE IF EXISTS weight_logs;
DROP TABLE IF EXISTS sleep_stages;
DROP TABLE IF EXISTS health_markers;

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
  (1, '2025-12-12', 12840, 2480, 7.6, 92),
  (1, '2025-12-13', 13200, 2525, 7.4, 91),
  (1, '2025-12-14', 14110, 2590, 7.8, 94),
  (1, '2025-12-15', 12580, 2450, 7.2, 89),
  (1, '2025-12-16', 13640, 2510, 7.7, 93);

WITH RECURSIVE date_series(day_offset, date_value) AS (
  SELECT 0 AS day_offset,
         DATE('2025-12-12') AS date_value
  UNION ALL
  SELECT day_offset + 1,
         DATE('2025-12-12', printf('+%d days', day_offset + 1))
  FROM date_series
  WHERE day_offset < 364
),
athlete_profiles AS (
  SELECT 2 AS user_id,
         11200 AS steps_base,
         2450 AS calories_base,
         7.4 AS sleep_base,
         86 AS readiness_base,
         260 AS block_variation,
         150 AS weekday_variation
  UNION ALL
  SELECT 3,
         9800,
         2250,
         7.1,
         80,
         210,
         130
)
INSERT INTO daily_metrics (user_id, date, steps, calories, sleep_hours, readiness_score)
SELECT
  ap.user_id,
  ds.date_value AS date,
  CAST(
    ap.steps_base
    + ((ds.day_offset % 14) - 7) * ap.block_variation
    + ((ds.day_offset % 7) - 3) * ap.weekday_variation
    + CASE
        WHEN (ds.day_offset % 28) BETWEEN 0 AND 6 THEN 650
        WHEN (ds.day_offset % 28) BETWEEN 7 AND 13 THEN 250
        WHEN (ds.day_offset % 28) BETWEEN 14 AND 20 THEN -450
        ELSE -450
      END
  AS INTEGER) AS steps,
  CAST(
    ap.calories_base
    + ((ds.day_offset % 5) - 2) * 55
    + ((ds.day_offset % 3) - 1) * 40
    + CASE
        WHEN (ds.day_offset % 28) BETWEEN 0 AND 6 THEN 120
        WHEN (ds.day_offset % 28) BETWEEN 7 AND 13 THEN 40
        WHEN (ds.day_offset % 28) BETWEEN 14 AND 20 THEN -60
        ELSE -100
      END
  AS INTEGER) AS calories,
  ROUND(
    ap.sleep_base
    + ((ds.day_offset % 10) - 5) * 0.05
    + ((ds.day_offset % 6) - 3) * 0.03
    + CASE
        WHEN (ds.day_offset % 28) BETWEEN 0 AND 6 THEN 0.18
        WHEN (ds.day_offset % 28) BETWEEN 7 AND 13 THEN 0.05
        WHEN (ds.day_offset % 28) BETWEEN 14 AND 20 THEN -0.08
        ELSE -0.15
      END,
    2
  ) AS sleep_hours,
  MAX(
    MIN(
      ap.readiness_base
      + ((ds.day_offset % 8) - 4) * 2
      + ((ds.day_offset % 5) - 2)
      + CASE
          WHEN (ds.day_offset % 28) BETWEEN 0 AND 6 THEN 4
          WHEN (ds.day_offset % 28) BETWEEN 7 AND 13 THEN 1
          WHEN (ds.day_offset % 28) BETWEEN 14 AND 20 THEN -2
          ELSE -3
        END,
      99
    ),
    62
  ) AS readiness_score
FROM date_series ds
JOIN athlete_profiles ap
ORDER BY ds.date_value ASC, ap.user_id;

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
  (1, '2025-12-16', 2600, 165, 285, 85);

WITH RECURSIVE macro_months(idx, date_value) AS (
  SELECT 0 AS idx,
         DATE('2025-12-01') AS date_value
  UNION ALL
  SELECT idx + 1,
         DATE('2025-12-01', printf('+%d months', idx + 1))
  FROM macro_months
  WHERE idx < 11
),
macro_profiles AS (
  SELECT 2 AS user_id,
         2450 AS base_calories,
         -20 AS monthly_calorie_shift,
         155 AS base_protein,
         265 AS base_carbs,
         78 AS base_fats,
         2 AS monthly_protein_shift,
         -3 AS monthly_carb_shift,
         -1 AS monthly_fat_shift,
         140 AS block_bonus
  UNION ALL
  SELECT 3,
         2300,
         -15,
         142,
         240,
         72,
         1,
         -2,
         0,
         110
)
INSERT INTO nutrition_macros (user_id, date, target_calories, protein_grams, carbs_grams, fats_grams)
SELECT
  mp.user_id,
  mm.date_value,
  CAST(
    mp.base_calories
    + mm.idx * mp.monthly_calorie_shift
    + CASE
        WHEN (mm.idx % 3) = 0 THEN mp.block_bonus
        WHEN (mm.idx % 3) = 1 THEN mp.block_bonus / 4
        ELSE -mp.block_bonus / 3
      END
  AS INTEGER) AS target_calories,
  CAST(
    mp.base_protein
    + mm.idx * mp.monthly_protein_shift
    + CASE
        WHEN (mm.idx % 2) = 0 THEN 6
        ELSE -4
      END
  AS INTEGER) AS protein_grams,
  CAST(
    mp.base_carbs
    + mm.idx * mp.monthly_carb_shift
    + CASE
        WHEN (mm.idx % 4) IN (0, 1) THEN 18
        ELSE -12
      END
  AS INTEGER) AS carbs_grams,
  CAST(
    mp.base_fats
    + mm.idx * mp.monthly_fat_shift
    + CASE
        WHEN (mm.idx % 4) = 0 THEN 6
        WHEN (mm.idx % 4) = 1 THEN 2
        ELSE -4
      END
  AS INTEGER) AS fats_grams
FROM macro_months mm
JOIN macro_profiles mp;

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

WITH RECURSIVE nutrition_days(day_offset, date_value) AS (
  SELECT 0 AS day_offset,
         DATE('2025-12-12') AS date_value
  UNION ALL
  SELECT day_offset + 1,
         DATE('2025-12-12', printf('+%d days', day_offset + 1))
  FROM nutrition_days
  WHERE day_offset < 364
),
user_profiles AS (
  SELECT 2 AS user_id,
         120 AS calorie_jitter,
         6 AS protein_jitter,
         12 AS carb_jitter,
         5 AS fat_jitter,
         45 AS endurance_push
  UNION ALL
  SELECT 3,
         95,
         5,
         10,
         4,
         35
),
meal_templates AS (
  SELECT 0 AS meal_slot, 'Sunrise oats' AS base_name, 'Food' AS item_type, 420 AS calories, 26 AS protein, 58 AS carbs, 12 AS fats, 320 AS weight_amount, 'g' AS weight_unit
  UNION ALL
  SELECT 1, 'Power grain bowl', 'Food', 610, 40, 68, 18, 390, 'g'
  UNION ALL
  SELECT 2, 'Recovery dinner plate', 'Food', 720, 44, 62, 25, 380, 'g'
  UNION ALL
  SELECT 3, 'Hydration flask', 'Liquid', 0, 0, 0, 0, 600, 'ml'
  UNION ALL
  SELECT 4, 'Recovery shake', 'Liquid', 230, 28, 22, 4, 450, 'ml'
  UNION ALL
  SELECT 5, 'Trail mix boost', 'Food', 210, 6, 18, 12, 70, 'g'
  UNION ALL
  SELECT 6, 'Evening tea', 'Liquid', 5, 0, 1, 0, 355, 'ml'
)
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
)
SELECT
  up.user_id,
  nd.date_value AS date,
  CASE
    WHEN mt.meal_slot = 0 THEN
      CASE ((nd.day_offset + up.user_id) % 3)
        WHEN 0 THEN 'Sunrise oats'
        WHEN 1 THEN 'Chia protein parfait'
        ELSE 'Veggie scramble wrap'
      END
    WHEN mt.meal_slot = 1 THEN
      CASE ((nd.day_offset + up.user_id) % 4)
        WHEN 0 THEN 'Power grain bowl'
        WHEN 1 THEN 'Roasted veggie bowl'
        WHEN 2 THEN 'Soba boost salad'
        ELSE 'Mediterranean plate'
      END
    WHEN mt.meal_slot = 2 THEN
      CASE ((nd.day_offset + up.user_id) % 4)
        WHEN 0 THEN 'Recovery dinner plate'
        WHEN 1 THEN 'Citrus salmon fuel'
        WHEN 2 THEN 'Lean steak & roots'
        ELSE 'Tofu stir fry'
      END
    WHEN mt.meal_slot = 3 THEN
      CASE ((nd.day_offset + up.user_id) % 3)
        WHEN 0 THEN 'Hydration - citrus'
        WHEN 1 THEN 'Hydration - berry'
        ELSE 'Hydration - herbal'
      END
    WHEN mt.meal_slot = 4 THEN 'Protein shake + greens'
    WHEN mt.meal_slot = 5 THEN
      CASE ((nd.day_offset + up.user_id) % 2)
        WHEN 0 THEN 'Trail mix boost'
        ELSE 'Greek yogurt crunch'
      END
    ELSE 'Evening tea'
  END AS item_name,
  mt.item_type,
  CASE
    WHEN mt.item_type = 'Food' THEN
      CAST(
        MAX(
          mt.calories
          + ((nd.day_offset + mt.meal_slot) % 5 - 2) * up.calorie_jitter
          + CASE
              WHEN mt.meal_slot = 2 THEN ((nd.day_offset % 14) - 7) * 9
              WHEN mt.meal_slot = 0 THEN ((nd.day_offset % 10) - 5) * 6
              ELSE 0
            END,
          150
        ) AS INTEGER
      )
    ELSE
      CAST(
        MAX(
          mt.calories
          + ((nd.day_offset % 6) - 3) * 5,
          0
        ) AS INTEGER
      )
  END AS calories,
  CASE
    WHEN mt.item_type = 'Food' THEN
      CAST(
        MAX(
          mt.protein
          + ((nd.day_offset + mt.meal_slot) % 4 - 2) * up.protein_jitter,
          4
        ) AS INTEGER
      )
    ELSE mt.protein
  END AS protein_grams,
  CASE
    WHEN mt.item_type = 'Food' THEN
      CAST(
        MAX(
          mt.carbs
          + ((nd.day_offset + mt.meal_slot) % 5 - 2) * up.carb_jitter,
          8
        ) AS INTEGER
      )
    ELSE mt.carbs
  END AS carbs_grams,
  CASE
    WHEN mt.item_type = 'Food' THEN
      CAST(
        MAX(
          mt.fats
          + ((nd.day_offset + mt.meal_slot) % 3 - 1) * up.fat_jitter,
          3
        ) AS INTEGER
      )
    ELSE mt.fats
  END AS fats_grams,
  CASE
    WHEN mt.item_type = 'Food' THEN
      ROUND(
        MAX(
          mt.weight_amount
          + ((nd.day_offset % 6) - 3) * 18,
          120
        ),
        1
      )
    ELSE
      ROUND(
        MAX(
          mt.weight_amount
          + ((nd.day_offset % 4) - 2) * 35,
          220
        ),
        1
      )
  END AS weight_amount,
  mt.weight_unit,
  CASE
    WHEN mt.meal_slot = 3 THEN 'ELECTROLYTE'
    WHEN mt.meal_slot = 4 THEN 'RECOVERY'
    ELSE NULL
  END AS barcode,
  NULL AS photo_data
FROM nutrition_days nd
JOIN user_profiles up
JOIN meal_templates mt
WHERE
  mt.meal_slot < 4
  OR (mt.meal_slot = 4 AND ((nd.day_offset + up.user_id) % 3) = 0)
  OR (mt.meal_slot = 5 AND ((nd.day_offset + up.user_id) % 2) = 0)
  OR (mt.meal_slot = 6 AND ((nd.day_offset + up.user_id) % 4) = 0);

CREATE TABLE hydration_logs (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  ounces REAL NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users (id)
);

INSERT INTO hydration_logs (user_id, date, ounces) VALUES
  (1, '2025-12-12', 96),
  (1, '2025-12-13', 90),
  (1, '2025-12-14', 104),
  (1, '2025-12-15', 88),
  (1, '2025-12-16', 101),
  (1, '2025-12-17', 99),
  (1, '2025-12-18', 95),
  (1, '2025-12-19', 102),
  (1, '2025-12-20', 97),
  (1, '2025-12-21', 100);

WITH RECURSIVE hydration_days(day_offset, date_value) AS (
  SELECT 0 AS day_offset,
         DATE('2025-12-12') AS date_value
  UNION ALL
  SELECT day_offset + 1,
         DATE('2025-12-12', printf('+%d days', day_offset + 1))
  FROM hydration_days
  WHERE day_offset < 364
),
hydration_profiles AS (
  SELECT 2 AS user_id,
         96.0 AS base_ounces,
         1.8 AS weekday_push,
         1.1 AS block_push
  UNION ALL
  SELECT 3,
         84.0,
         1.5,
         0.9
)
INSERT INTO hydration_logs (user_id, date, ounces)
SELECT
  hp.user_id,
  hd.date_value AS date,
  ROUND(
    hp.base_ounces
    + ((hd.day_offset % 7) - 3) * hp.weekday_push
    + ((hd.day_offset % 5) - 2) * hp.block_push
    + CASE
        WHEN (hd.day_offset % 28) BETWEEN 0 AND 6 THEN 6.0
        WHEN (hd.day_offset % 28) BETWEEN 7 AND 13 THEN 2.0
        WHEN (hd.day_offset % 28) BETWEEN 14 AND 20 THEN -3.5
        ELSE -5.5
      END,
    1
  ) AS ounces
FROM hydration_days hd
JOIN hydration_profiles hp
ORDER BY hd.date_value ASC, hp.user_id;

CREATE TABLE weight_logs (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  weight_kg REAL NOT NULL,
  recorded_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users (id),
  UNIQUE (user_id, date)
);

WITH RECURSIVE weight_days(day_offset, date_value) AS (
  SELECT 0 AS day_offset,
         DATE('2025-12-12') AS date_value
  UNION ALL
  SELECT day_offset + 1,
         DATE('2025-12-12', printf('+%d days', day_offset + 1))
  FROM weight_days
  WHERE day_offset < 364
),
weight_profiles AS (
  SELECT 2 AS user_id,
         83.5 AS base_weight,
         -0.25 AS monthly_trend,
         0.18 AS weekly_variation,
         0.35 AS block_wave
  UNION ALL
  SELECT 3,
         74.0,
         0.18,
         0.15,
         0.28
)
INSERT INTO weight_logs (user_id, date, weight_kg)
SELECT
  wp.user_id,
  wd.date_value AS date,
  ROUND(
    wp.base_weight
    + (wd.day_offset / 30.0) * wp.monthly_trend
    + ((wd.day_offset % 7) - 3) * wp.weekly_variation
    + CASE
        WHEN (wd.day_offset % 28) BETWEEN 0 AND 6 THEN wp.block_wave
        WHEN (wd.day_offset % 28) BETWEEN 7 AND 13 THEN wp.block_wave / 2
        WHEN (wd.day_offset % 28) BETWEEN 14 AND 20 THEN -wp.block_wave / 3
        ELSE -wp.block_wave
      END,
    1
  ) AS weight_kg
FROM weight_days wd
JOIN weight_profiles wp;

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
  (1, '2025-12-16', 120, 140, 210),
  (2, '2025-12-16', 110, 135, 215),
  (3, '2025-12-16', 95, 120, 200);

CREATE TABLE activity_sessions (
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
);

INSERT INTO activity_sessions (
  id,
  user_id,
  source,
  source_id,
  name,
  sport_type,
  start_time,
  distance_m,
  moving_time_s,
  elapsed_time_s,
  average_hr,
  max_hr,
  average_pace_s,
  average_cadence,
  average_power,
  elevation_gain_m,
  calories,
  perceived_effort,
  vo2max_estimate,
  training_load,
  strava_activity_id
) VALUES
  (1101, 1, 'seed', 'demo-head-01', 'Sunrise aerobic run', 'Run', '2025-12-16T05:30:00Z', 9800, 3305, 3425, 146, 168, 338, 172, 248, 84, 645, 5, 50.8, 52, 601001),
  (1102, 1, 'seed', 'demo-head-02', 'Progressive midweek', 'Run', '2025-12-13T06:40:00Z', 15200, 4120, 4255, 154, 174, 271, 178, 0, 140, 905, 7, 52.6, 74, 601002),
  (2201, 2, 'seed', 'demo-coach-01', 'Threshold mixer', 'Run', '2025-12-14T07:00:00Z', 12500, 3605, 3720, 160, 179, 288, 180, 298, 120, 880, 7, 53.2, 72, 602201),
  (2202, 2, 'seed', 'demo-coach-02', 'Evening double', 'Run', '2025-12-12T17:45:00Z', 7800, 2680, 2795, 138, 156, 344, 170, 0, 48, 510, 4, NULL, 38, 602202),
  (3001, 3, 'seed', 'demo-athlete-01', 'Sunrise tempo blocks', 'Run', '2025-12-15T07:10:00Z', 14200, 3780, 3920, 166, 184, 266, 184, 315, 128, 990, 8, 56.2, 88, 603001),
  (3002, 3, 'seed', 'demo-athlete-02', 'Mobility shakeout', 'Run', '2025-12-14T18:05:00Z', 6100, 1985, 2050, 141, 155, 326, 176, 0, 42, 410, 3, NULL, 32, 603002),
  (3003, 3, 'seed', 'demo-athlete-03', 'Coastal long progression', 'Run', '2025-12-13T08:20:00Z', 24000, 7740, 7905, 154, 176, 323, 182, 302, 280, 1480, 9, 56.8, 124, 603003),
  (3004, 3, 'seed', 'demo-athlete-04', 'Track fartlek', 'Run', '2025-12-11T06:45:00Z', 10200, 3180, 3285, 168, 188, 312, 186, 320, 96, 840, 8, 55.9, 79, 603004);

CREATE TABLE activity_splits (
  id INTEGER PRIMARY KEY,
  session_id INTEGER NOT NULL,
  split_index INTEGER NOT NULL,
  distance_m REAL NOT NULL,
  moving_time_s INTEGER NOT NULL,
  average_pace_s REAL,
  elevation_gain_m REAL,
  average_hr REAL,
  FOREIGN KEY (session_id) REFERENCES activity_sessions (id)
);

INSERT INTO activity_splits (
  session_id,
  split_index,
  distance_m,
  moving_time_s,
  average_pace_s,
  elevation_gain_m,
  average_hr
) VALUES
  (3001, 1, 3000, 810, 270, 12, 162),
  (3001, 2, 3000, 804, 268, 18, 166),
  (3001, 3, 3000, 798, 266, 22, 169),
  (3001, 4, 3200, 876, 274, 24, 168),
  (3003, 1, 5000, 1655, 331, 38, 150),
  (3003, 2, 5000, 1600, 320, 42, 153),
  (3003, 3, 5000, 1568, 314, 46, 156),
  (3003, 4, 4500, 1408, 313, 52, 158),
  (3003, 5, 4500, 1409, 313, 54, 160),
  (2201, 1, 4000, 1160, 290, 18, 158),
  (2201, 2, 4000, 1154, 288, 22, 162),
  (2201, 3, 4500, 1291, 287, 30, 164),
  (1101, 1, 5000, 1690, 338, 32, 144),
  (1101, 2, 4800, 1615, 336, 30, 147);

CREATE TABLE health_markers (
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
);

INSERT INTO health_markers (
  user_id,
  date,
  resting_hr,
  hrv_score,
  spo2,
  stress_score,
  systolic_bp,
  diastolic_bp,
  glucose_mg_dl
) VALUES
  (1, '2025-12-12', 52, 96, 97, 30, 121, 74, 95),
  (1, '2025-12-13', 51, 98, 97, 29, 120, 74, 96),
  (1, '2025-12-14', 50, 101, 98, 27, 119, 73, 94),
  (1, '2025-12-15', 49, 103, 98, 26, 118, 72, 93),
  (1, '2025-12-16', 49, 104, 99, 25, 117, 72, 92),
  (2, '2025-12-12', 50, 104, 98, 27, 119, 71, 94),
  (2, '2025-12-13', 49, 105, 98, 26, 118, 71, 93),
  (2, '2025-12-14', 48, 107, 99, 24, 117, 70, 92),
  (2, '2025-12-15', 47, 109, 99, 23, 117, 70, 91),
  (2, '2025-12-16', 47, 110, 99, 23, 116, 69, 90),
  (3, '2025-12-12', 52, 105, 98, 26, 118, 72, 96),
  (3, '2025-12-13', 51, 107, 98, 25, 118, 71, 95),
  (3, '2025-12-14', 50, 109, 99, 24, 117, 71, 94),
  (3, '2025-12-15', 49, 111, 99, 23, 116, 70, 93),
  (3, '2025-12-16', 48, 113, 99, 22, 115, 70, 92);
