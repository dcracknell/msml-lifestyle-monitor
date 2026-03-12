const express = require('express');
const db = require('../db');
const { authenticate } = require('../services/session-store');
const { coerceRole, isHeadCoach } = require('../utils/role');

const router = express.Router();

const MAX_BATCH_SIZE = Math.max(1, parseInt(process.env.STREAM_MAX_BATCH || '2000', 10));
const MAX_WORKOUT_BATCH_SIZE = Math.max(1, parseInt(process.env.STREAM_MAX_WORKOUT_BATCH || '500', 10));
const MAX_POINTS = Math.max(10, parseInt(process.env.STREAM_MAX_POINTS || '600', 10));
const DEFAULT_WINDOW_MS = Math.max(
  60 * 1000,
  parseInt(process.env.STREAM_DEFAULT_WINDOW_MS || `${6 * 60 * 60 * 1000}`, 10)
);

const accessStatement = db.prepare(
  `SELECT 1
     FROM coach_athlete_links
    WHERE coach_id = ?
      AND athlete_id = ?`
);

const subjectExistsStatement = db.prepare('SELECT id FROM users WHERE id = ?');

const insertSampleStatement = db.prepare(
  `INSERT INTO sensor_stream_samples (user_id, metric, ts, value)
   VALUES (?, ?, ?, ?)
   ON CONFLICT(user_id, metric, ts) DO UPDATE SET
     value = excluded.value,
     updated_at = CURRENT_TIMESTAMP`
);

const samplesInRangeStatement = db.prepare(
  `SELECT ts, value
     FROM sensor_stream_samples
    WHERE user_id = ?
      AND metric = ?
      AND ts BETWEEN ? AND ?
    ORDER BY ts ASC`
);

const DAILY_STEP_MIRROR_METRICS = new Set(['phone.steps', 'activity.steps']);
const DAILY_CALORIE_MIRROR_METRICS = new Set(['activity.active_calories', 'exercise.calories']);
const DAILY_SLEEP_MIRROR_METRICS = new Set(['sleep.total_hours']);
const DAILY_READINESS_MIRROR_METRICS = new Set(['vitals.readiness', 'readiness.score', 'recovery.readiness']);
const SLEEP_STAGE_MIRRORS = new Map([
  ['sleep.deep_hours', 'deepMinutes'],
  ['sleep.rem_hours', 'remMinutes'],
  ['sleep.light_hours', 'lightMinutes'],
]);
const HEALTH_MARKER_MIRRORS = new Map([
  ['vitals.resting_hr', 'restingHr'],
  ['vitals.heart_rate', 'restingHr'],
  ['vitals.hrv', 'hrvScore'],
  ['vitals.spo2', 'spo2'],
  ['vitals.stress_score', 'stressScore'],
  ['vitals.systolic_bp', 'systolic'],
  ['vitals.diastolic_bp', 'diastolic'],
  ['vitals.glucose', 'glucose'],
]);
const WEIGHT_MIRROR_METRICS = new Set(['body.weight_kg']);
const PHONE_WORKOUT_MIRROR_METRICS = new Set([
  'exercise.distance',
  'exercise.pace',
  'exercise.calories',
  'exercise.hr',
  'exercise.max_hr',
  'exercise.moving_time',
  'exercise.elapsed_time',
  'exercise.duration',
  'exercise.elevation_gain',
  'exercise.cadence',
  'exercise.power',
  'exercise.vo2max',
  'exercise.training_load',
  'exercise.perceived_effort',
]);

const dailyMetricByDateStatement = db.prepare(
  `SELECT id,
          steps,
          calories,
          sleep_hours AS sleepHours,
          readiness_score AS readiness
     FROM daily_metrics
    WHERE user_id = ?
      AND date = ?
    ORDER BY id DESC
    LIMIT 1`
);

const updateDailyMetricByIdStatement = db.prepare(
  `UPDATE daily_metrics
      SET steps = ?,
          calories = ?,
          sleep_hours = ?,
          readiness_score = ?
    WHERE id = ?`
);

const insertDailyMetricStatement = db.prepare(
  `INSERT INTO daily_metrics (user_id, date, steps, calories, sleep_hours, readiness_score)
   VALUES (?, ?, ?, ?, ?, ?)`
);

const sleepStageByDateStatement = db.prepare(
  `SELECT id,
          deep_minutes AS deepMinutes,
          rem_minutes AS remMinutes,
          light_minutes AS lightMinutes
     FROM sleep_stages
    WHERE user_id = ?
      AND date = ?
    ORDER BY id DESC
    LIMIT 1`
);

const updateSleepStageByIdStatement = db.prepare(
  `UPDATE sleep_stages
      SET deep_minutes = ?,
          rem_minutes = ?,
          light_minutes = ?
    WHERE id = ?`
);

const insertSleepStageStatement = db.prepare(
  `INSERT INTO sleep_stages (user_id, date, deep_minutes, rem_minutes, light_minutes)
   VALUES (?, ?, ?, ?, ?)`
);

const healthMarkerByDateStatement = db.prepare(
  `SELECT id,
          resting_hr AS restingHr,
          hrv_score AS hrvScore,
          spo2,
          stress_score AS stressScore,
          systolic_bp AS systolic,
          diastolic_bp AS diastolic,
          glucose_mg_dl AS glucose
     FROM health_markers
    WHERE user_id = ?
      AND date = ?
    ORDER BY id DESC
    LIMIT 1`
);

const updateHealthMarkerByIdStatement = db.prepare(
  `UPDATE health_markers
      SET resting_hr = ?,
          hrv_score = ?,
          spo2 = ?,
          stress_score = ?,
          systolic_bp = ?,
          diastolic_bp = ?,
          glucose_mg_dl = ?
    WHERE id = ?`
);

const insertHealthMarkerStatement = db.prepare(
  `INSERT INTO health_markers (
      user_id,
      date,
      resting_hr,
      hrv_score,
      spo2,
      stress_score,
      systolic_bp,
      diastolic_bp,
      glucose_mg_dl
    )
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
);

const upsertWeightLogStatement = db.prepare(
  `INSERT INTO weight_logs (user_id, date, weight_kg)
   VALUES (?, ?, ?)
   ON CONFLICT(user_id, date)
   DO UPDATE SET weight_kg = excluded.weight_kg,
                 recorded_at = CURRENT_TIMESTAMP`
);

const phoneSessionBySourceStatement = db.prepare(
  `SELECT id,
          name,
          sport_type AS sportType,
          start_time AS startTime,
          distance_m AS distanceMeters,
          moving_time_s AS movingTimeSeconds,
          elapsed_time_s AS elapsedTimeSeconds,
          average_hr AS averageHr,
          max_hr AS maxHr,
          average_pace_s AS averagePace,
          average_cadence AS averageCadence,
          average_power AS averagePower,
          elevation_gain_m AS elevationGain,
          vo2max_estimate AS vo2maxEstimate,
          training_load AS trainingLoad,
          perceived_effort AS perceivedEffort,
          calories
     FROM activity_sessions
    WHERE user_id = ?
      AND source = 'phone_sync'
      AND source_id = ?
    ORDER BY id DESC
    LIMIT 1`
);

const updatePhoneSessionByIdStatement = db.prepare(
  `UPDATE activity_sessions
      SET name = ?,
          sport_type = ?,
          start_time = ?,
          distance_m = ?,
          moving_time_s = ?,
          elapsed_time_s = ?,
          average_hr = ?,
          max_hr = ?,
          average_pace_s = ?,
          average_cadence = ?,
          average_power = ?,
          elevation_gain_m = ?,
          vo2max_estimate = ?,
          training_load = ?,
          perceived_effort = ?,
          calories = ?
    WHERE id = ?`
);

const insertPhoneSessionStatement = db.prepare(
  `INSERT INTO activity_sessions (
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
      vo2max_estimate,
      training_load,
      perceived_effort,
      calories
    ) VALUES (?, 'phone_sync', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
);

function normalizeMetric(input = '') {
  const metric = String(input || '').trim().toLowerCase();
  if (!metric) return null;
  if (!/^[a-z0-9._:-]{2,64}$/.test(metric)) {
    return null;
  }
  return metric;
}

function parseTimestamp(input, fallback) {
  if (input === undefined || input === null || input === '') {
    return fallback;
  }
  const numeric = Number(input);
  if (Number.isFinite(numeric)) {
    return numeric;
  }
  const parsed = Date.parse(input);
  if (!Number.isNaN(parsed)) {
    return parsed;
  }
  return null;
}

function parseWindow(input) {
  if (input === undefined || input === null || input === '') {
    return null;
  }
  const numeric = Number(input);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric;
  }
  return null;
}

function parseBooleanFlag(input) {
  if (input === true || input === false) {
    return input;
  }
  if (typeof input === 'string') {
    const normalized = input.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  return false;
}

function clampMaxPoints(value) {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return Math.min(MAX_POINTS, Math.max(10, Math.floor(numeric)));
  }
  return MAX_POINTS;
}

function ensureAccess(viewer, subjectId) {
  if (viewer.id === subjectId) {
    return true;
  }
  if (isHeadCoach(viewer.role)) {
    return true;
  }
  const link = accessStatement.get(viewer.id, subjectId);
  return Boolean(link);
}

function toUtcDateString(ts) {
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}

function normalizeDateInput(input) {
  if (!input) {
    return null;
  }
  const raw = String(input).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw;
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString().slice(0, 10);
}

function sanitizeSamples(rawSamples = [], defaultLocalDate = null) {
  return rawSamples
    .map((sample) => {
      const ts = Number(sample.timestamp ?? sample.ts ?? sample.time);
      if (!Number.isFinite(ts) || ts <= 0) {
        return null;
      }
      const numericValue = sample.value === null ? null : Number(sample.value);
      const value = Number.isFinite(numericValue) ? numericValue : null;
      const localDate = normalizeDateInput(sample.localDate ?? sample.date ?? defaultLocalDate);
      return { ts: Math.round(ts), value, localDate };
    })
    .filter(Boolean)
    .sort((a, b) => a.ts - b.ts)
    .slice(-MAX_BATCH_SIZE);
}

function toRoundedInt(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return Math.round(numeric);
}

function toRoundedOneDecimal(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return Math.round(numeric * 10) / 10;
}

function mergeDateFieldsByMetric(metric, samples = []) {
  const rowsByDate = new Map();
  const sampleCountByDate = new Map();
  samples.forEach((sample) => {
    const date = sample?.localDate || toUtcDateString(sample?.ts);
    if (!date) {
      return;
    }
    sampleCountByDate.set(date, (sampleCountByDate.get(date) || 0) + 1);
  });

  samples.forEach((sample) => {
    if (!Number.isFinite(sample?.value)) {
      return;
    }
    const date = sample.localDate || toUtcDateString(sample.ts);
    if (!date) {
      return;
    }

    const current = rowsByDate.get(date) || { date };
    const numeric = Number(sample.value);
    const hasMultipleSamplesForDate = (sampleCountByDate.get(date) || 0) > 1;

    if (DAILY_STEP_MIRROR_METRICS.has(metric)) {
      const rounded = Math.max(0, Math.round(numeric));
      if (metric === 'activity.steps' && hasMultipleSamplesForDate) {
        current.steps = (current.steps || 0) + rounded;
      } else {
        current.steps = Math.max(current.steps || 0, rounded);
      }
    } else if (DAILY_CALORIE_MIRROR_METRICS.has(metric)) {
      const rounded = Math.max(0, Math.round(numeric));
      if (metric === 'activity.active_calories' && hasMultipleSamplesForDate) {
        current.calories = (current.calories || 0) + rounded;
      } else {
        current.calories = Math.max(current.calories || 0, rounded);
      }
    } else if (DAILY_SLEEP_MIRROR_METRICS.has(metric)) {
      const candidate = Math.max(0, toRoundedOneDecimal(numeric) || 0);
      if (hasMultipleSamplesForDate) {
        current.sleepHours = toRoundedOneDecimal((current.sleepHours || 0) + candidate);
      } else {
        current.sleepHours = Math.max(current.sleepHours || 0, candidate);
      }
    } else if (DAILY_READINESS_MIRROR_METRICS.has(metric)) {
      const readiness = Math.max(0, Math.min(100, toRoundedInt(numeric)));
      if (hasMultipleSamplesForDate) {
        current.readinessSum = (current.readinessSum || 0) + readiness;
        current.readinessCount = (current.readinessCount || 0) + 1;
        current.readiness = toRoundedInt(current.readinessSum / current.readinessCount);
      } else {
        current.readiness = readiness;
      }
    } else if (SLEEP_STAGE_MIRRORS.has(metric)) {
      const minutesField = SLEEP_STAGE_MIRRORS.get(metric);
      if (minutesField) {
        const minutes = Math.max(0, Math.round(numeric * 60));
        if (hasMultipleSamplesForDate) {
          current[minutesField] = (current[minutesField] || 0) + minutes;
        } else {
          current[minutesField] = Math.max(current[minutesField] || 0, minutes);
        }
      }
    } else if (HEALTH_MARKER_MIRRORS.has(metric)) {
      const field = HEALTH_MARKER_MIRRORS.get(metric);
      if (field) {
        const rounded = toRoundedInt(numeric);
        if (field === 'restingHr' && metric === 'vitals.heart_rate' && hasMultipleSamplesForDate) {
          current.restingHrSum = (current.restingHrSum || 0) + rounded;
          current.restingHrCount = (current.restingHrCount || 0) + 1;
          current.restingHr = toRoundedInt(current.restingHrSum / current.restingHrCount);
        } else {
          current[field] = rounded;
        }
        current.lastTs = Math.max(current.lastTs || 0, sample.ts);
      }
    } else if (WEIGHT_MIRROR_METRICS.has(metric)) {
      current.weightKg = toRoundedOneDecimal(Math.max(0, numeric));
      current.lastTs = Math.max(current.lastTs || 0, sample.ts);
    } else if (PHONE_WORKOUT_MIRROR_METRICS.has(metric)) {
      current.lastTs = Math.max(current.lastTs || 0, sample.ts);
      if (metric === 'exercise.distance') {
        const km = numeric > 500 ? numeric / 1000 : numeric;
        const meters = Math.round(Math.max(0, km) * 1000);
        if (hasMultipleSamplesForDate) {
          current.distanceMeters = (current.distanceMeters || 0) + meters;
        } else {
          current.distanceMeters = Math.max(current.distanceMeters || 0, meters);
        }
      } else if (metric === 'exercise.pace' && numeric > 0) {
        if (hasMultipleSamplesForDate) {
          current.averagePaceSum = (current.averagePaceSum || 0) + numeric;
          current.averagePaceCount = (current.averagePaceCount || 0) + 1;
          current.averagePace = Math.round(current.averagePaceSum / current.averagePaceCount);
        } else {
          current.averagePace = Math.round(numeric);
        }
      } else if (metric === 'exercise.calories') {
        const rounded = Math.max(0, Math.round(numeric));
        if (hasMultipleSamplesForDate) {
          current.calories = (current.calories || 0) + rounded;
        } else {
          current.calories = Math.max(current.calories || 0, rounded);
        }
      } else if (metric === 'exercise.hr' && numeric > 0) {
        if (hasMultipleSamplesForDate) {
          current.averageHrSum = (current.averageHrSum || 0) + numeric;
          current.averageHrCount = (current.averageHrCount || 0) + 1;
          current.averageHr = Math.round(current.averageHrSum / current.averageHrCount);
        } else {
          current.averageHr = Math.round(numeric);
        }
      } else if (metric === 'exercise.max_hr' && numeric > 0) {
        current.maxHr = Math.max(current.maxHr || 0, Math.round(numeric));
      } else if (
        (metric === 'exercise.moving_time' || metric === 'exercise.elapsed_time' || metric === 'exercise.duration') &&
        numeric > 0
      ) {
        const seconds = Math.round(numeric);
        if (hasMultipleSamplesForDate) {
          if (metric === 'exercise.moving_time') {
            current.movingTimeSeconds = (current.movingTimeSeconds || 0) + seconds;
          } else {
            current.elapsedTimeSeconds = (current.elapsedTimeSeconds || 0) + seconds;
          }
        } else if (metric === 'exercise.moving_time') {
          current.movingTimeSeconds = Math.max(current.movingTimeSeconds || 0, seconds);
        } else {
          current.elapsedTimeSeconds = Math.max(current.elapsedTimeSeconds || 0, seconds);
        }
      } else if (metric === 'exercise.elevation_gain') {
        const elevation = Math.max(0, Math.round(numeric));
        if (hasMultipleSamplesForDate) {
          current.elevationGain = (current.elevationGain || 0) + elevation;
        } else {
          current.elevationGain = Math.max(current.elevationGain || 0, elevation);
        }
      } else if (metric === 'exercise.cadence' && numeric > 0) {
        if (hasMultipleSamplesForDate) {
          current.cadenceSum = (current.cadenceSum || 0) + numeric;
          current.cadenceCount = (current.cadenceCount || 0) + 1;
          current.averageCadence = Math.round((current.cadenceSum / current.cadenceCount) * 10) / 10;
        } else {
          current.averageCadence = Math.round(numeric * 10) / 10;
        }
      } else if (metric === 'exercise.power' && numeric > 0) {
        if (hasMultipleSamplesForDate) {
          current.powerSum = (current.powerSum || 0) + numeric;
          current.powerCount = (current.powerCount || 0) + 1;
          current.averagePower = Math.round((current.powerSum / current.powerCount) * 10) / 10;
        } else {
          current.averagePower = Math.round(numeric * 10) / 10;
        }
      } else if (metric === 'exercise.vo2max' && numeric > 0) {
        if (hasMultipleSamplesForDate) {
          current.vo2Sum = (current.vo2Sum || 0) + numeric;
          current.vo2Count = (current.vo2Count || 0) + 1;
          current.vo2maxEstimate = Math.round((current.vo2Sum / current.vo2Count) * 10) / 10;
        } else {
          current.vo2maxEstimate = Math.round(numeric * 10) / 10;
        }
      } else if (metric === 'exercise.training_load' && numeric >= 0) {
        const load = Math.round(numeric * 10) / 10;
        if (hasMultipleSamplesForDate) {
          current.trainingLoad = Math.round(((current.trainingLoad || 0) + load) * 10) / 10;
        } else {
          current.trainingLoad = Math.max(current.trainingLoad || 0, load);
        }
      } else if (metric === 'exercise.perceived_effort' && numeric >= 0) {
        const effort = Math.max(0, Math.min(10, Math.round(numeric)));
        if (hasMultipleSamplesForDate) {
          current.effortSum = (current.effortSum || 0) + effort;
          current.effortCount = (current.effortCount || 0) + 1;
          current.perceivedEffort = Math.round(current.effortSum / current.effortCount);
        } else {
          current.perceivedEffort = effort;
        }
      }
    }

    rowsByDate.set(date, current);
  });

  return Array.from(rowsByDate.values());
}

function upsertDailyMetricFields(userId, row) {
  if (
    !Object.prototype.hasOwnProperty.call(row, 'steps') &&
    !Object.prototype.hasOwnProperty.call(row, 'calories') &&
    !Object.prototype.hasOwnProperty.call(row, 'sleepHours') &&
    !Object.prototype.hasOwnProperty.call(row, 'readiness')
  ) {
    return;
  }
  const existing = dailyMetricByDateStatement.get(userId, row.date);
  const nextSteps =
    row.steps === undefined
      ? Number.isFinite(existing?.steps)
        ? existing.steps
        : null
      : row.steps;
  const nextCalories =
    row.calories === undefined
      ? Number.isFinite(existing?.calories)
        ? existing.calories
        : null
      : row.calories;
  const nextSleepHours =
    row.sleepHours === undefined
      ? Number.isFinite(existing?.sleepHours)
        ? existing.sleepHours
        : null
      : row.sleepHours;
  const nextReadiness =
    row.readiness === undefined
      ? Number.isFinite(existing?.readiness)
        ? existing.readiness
        : null
      : row.readiness;

  if (existing?.id) {
    updateDailyMetricByIdStatement.run(nextSteps, nextCalories, nextSleepHours, nextReadiness, existing.id);
    return;
  }
  insertDailyMetricStatement.run(userId, row.date, nextSteps, nextCalories, nextSleepHours, nextReadiness);
}

function upsertSleepStageFields(userId, row) {
  if (
    !Object.prototype.hasOwnProperty.call(row, 'deepMinutes') &&
    !Object.prototype.hasOwnProperty.call(row, 'remMinutes') &&
    !Object.prototype.hasOwnProperty.call(row, 'lightMinutes')
  ) {
    return;
  }
  const existing = sleepStageByDateStatement.get(userId, row.date);
  const nextDeep =
    row.deepMinutes === undefined
      ? Number.isFinite(existing?.deepMinutes)
        ? existing.deepMinutes
        : null
      : row.deepMinutes;
  const nextRem =
    row.remMinutes === undefined
      ? Number.isFinite(existing?.remMinutes)
        ? existing.remMinutes
        : null
      : row.remMinutes;
  const nextLight =
    row.lightMinutes === undefined
      ? Number.isFinite(existing?.lightMinutes)
        ? existing.lightMinutes
        : null
      : row.lightMinutes;

  if (existing?.id) {
    updateSleepStageByIdStatement.run(nextDeep, nextRem, nextLight, existing.id);
    return;
  }
  insertSleepStageStatement.run(userId, row.date, nextDeep, nextRem, nextLight);
}

function upsertHealthMarkerFields(userId, row) {
  if (
    !Object.prototype.hasOwnProperty.call(row, 'restingHr') &&
    !Object.prototype.hasOwnProperty.call(row, 'hrvScore') &&
    !Object.prototype.hasOwnProperty.call(row, 'spo2') &&
    !Object.prototype.hasOwnProperty.call(row, 'stressScore') &&
    !Object.prototype.hasOwnProperty.call(row, 'systolic') &&
    !Object.prototype.hasOwnProperty.call(row, 'diastolic') &&
    !Object.prototype.hasOwnProperty.call(row, 'glucose')
  ) {
    return;
  }
  const existing = healthMarkerByDateStatement.get(userId, row.date);
  const nextRestingHr =
    row.restingHr === undefined
      ? Number.isFinite(existing?.restingHr)
        ? existing.restingHr
        : null
      : row.restingHr;
  const nextHrv =
    row.hrvScore === undefined
      ? Number.isFinite(existing?.hrvScore)
        ? existing.hrvScore
        : null
      : row.hrvScore;
  const nextSpo2 =
    row.spo2 === undefined
      ? Number.isFinite(existing?.spo2)
        ? existing.spo2
        : null
      : row.spo2;
  const nextStress =
    row.stressScore === undefined
      ? Number.isFinite(existing?.stressScore)
        ? existing.stressScore
        : null
      : row.stressScore;
  const nextSystolic =
    row.systolic === undefined
      ? Number.isFinite(existing?.systolic)
        ? existing.systolic
        : null
      : row.systolic;
  const nextDiastolic =
    row.diastolic === undefined
      ? Number.isFinite(existing?.diastolic)
        ? existing.diastolic
        : null
      : row.diastolic;
  const nextGlucose =
    row.glucose === undefined
      ? Number.isFinite(existing?.glucose)
        ? existing.glucose
        : null
      : row.glucose;

  if (existing?.id) {
    updateHealthMarkerByIdStatement.run(
      nextRestingHr,
      nextHrv,
      nextSpo2,
      nextStress,
      nextSystolic,
      nextDiastolic,
      nextGlucose,
      existing.id
    );
    return;
  }
  insertHealthMarkerStatement.run(
    userId,
    row.date,
    nextRestingHr,
    nextHrv,
    nextSpo2,
    nextStress,
    nextSystolic,
    nextDiastolic,
    nextGlucose
  );
}

function upsertWeightMetric(userId, row) {
  if (!Number.isFinite(row.weightKg) || row.weightKg <= 0) {
    return;
  }
  upsertWeightLogStatement.run(userId, row.date, row.weightKg);
}

function toIsoTimestamp(ts, date, fallback) {
  if (Number.isFinite(ts)) {
    return new Date(ts).toISOString();
  }
  if (fallback) {
    return fallback;
  }
  return `${date}T12:00:00.000Z`;
}

function toPositiveRoundedInt(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }
  return Math.round(numeric);
}

function toPositiveRoundedOneDecimal(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }
  return Math.round(numeric * 10) / 10;
}

function normalizeSportType(rawSportType, fallback = 'Run') {
  if (typeof rawSportType !== 'string') {
    return fallback;
  }
  const normalized = rawSportType.trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }
  if (
    normalized.includes('run') ||
    normalized.includes('jog') ||
    normalized.includes('treadmill')
  ) {
    return 'Run';
  }
  if (normalized.includes('walk')) {
    return 'Walk';
  }
  if (normalized.includes('hike')) {
    return 'Hike';
  }
  if (normalized.includes('cycle') || normalized.includes('bike') || normalized.includes('ride')) {
    return 'Ride';
  }
  if (normalized.includes('swim')) {
    return 'Swim';
  }
  if (normalized.includes('row')) {
    return 'Row';
  }
  if (normalized.includes('strength') || normalized.includes('weight')) {
    return 'Strength';
  }
  if (normalized.includes('yoga')) {
    return 'Yoga';
  }
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function normalizeSessionName(rawName, sportType, fallback = 'Phone workout sync') {
  if (typeof rawName === 'string') {
    const trimmed = rawName.trim();
    if (trimmed) {
      return trimmed.slice(0, 96);
    }
  }
  if (typeof sportType === 'string' && sportType.trim()) {
    return `${sportType.trim()} workout`;
  }
  return fallback;
}

function normalizeSourceId(value) {
  if (value === null || value === undefined) {
    return null;
  }
  const normalized = String(value).trim();
  if (!normalized) {
    return null;
  }
  return normalized.slice(0, 190);
}

function toSourceToken(value, fallback = 'unknown') {
  const normalized = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || fallback;
}

function deriveWorkoutSourceId(workout, startTs, endTs) {
  const explicit = normalizeSourceId(workout.sourceId ?? workout.id ?? workout.uuid);
  if (explicit) {
    return explicit;
  }
  const sourceName = toSourceToken(workout.sourceName ?? workout.sourceApp ?? 'apple-health', 'apple-health');
  const activity = normalizeSportType(
    workout.sportType ?? workout.activityName ?? workout.activity,
    'Workout'
  );
  const activityToken = toSourceToken(activity, 'workout');
  const endToken = Number.isFinite(endTs) ? endTs : 'na';
  const distanceToken = Number.isFinite(Number(workout.distanceMeters))
    ? Math.round(Number(workout.distanceMeters))
    : Number.isFinite(Number(workout.distanceKm))
    ? Math.round(Number(workout.distanceKm) * 1000)
    : Number.isFinite(Number(workout.distanceMiles))
    ? Math.round(Number(workout.distanceMiles) * 1609.344)
    : Number.isFinite(Number(workout.distance))
    ? Math.round(Number(workout.distance) * 1609.344)
    : 0;
  const durationToken = Number.isFinite(Number(workout.movingTimeSeconds))
    ? Math.round(Number(workout.movingTimeSeconds))
    : Number.isFinite(Number(workout.duration))
    ? Math.round(Number(workout.duration))
    : 0;
  return `phone_sync:${sourceName}:${activityToken}:${startTs}:${endToken}:${distanceToken}:${durationToken}`;
}

function sanitizeWorkoutImports(rawWorkouts = []) {
  if (!Array.isArray(rawWorkouts)) {
    return [];
  }

  return rawWorkouts
    .map((workout) => {
      if (!workout || typeof workout !== 'object') {
        return null;
      }
      const startTs = parseTimestamp(
        workout.startTime ?? workout.start ?? workout.startDate ?? workout.startedAt,
        null
      );
      if (!Number.isFinite(startTs)) {
        return null;
      }

      const endTsRaw = parseTimestamp(
        workout.endTime ?? workout.end ?? workout.endDate ?? workout.endedAt,
        null
      );
      const endTs = Number.isFinite(endTsRaw) && endTsRaw > startTs ? endTsRaw : null;

      const distanceMeters = Number.isFinite(Number(workout.distanceMeters))
        ? Math.max(0, Math.round(Number(workout.distanceMeters)))
        : Number.isFinite(Number(workout.distanceKm))
        ? Math.max(0, Math.round(Number(workout.distanceKm) * 1000))
        : Number.isFinite(Number(workout.distanceMiles))
        ? Math.max(0, Math.round(Number(workout.distanceMiles) * 1609.344))
        : Number.isFinite(Number(workout.distance))
        ? Math.max(0, Math.round(Number(workout.distance) * 1609.344))
        : null;

      const movingTimeSeconds = toPositiveRoundedInt(
        workout.movingTimeSeconds ??
          workout.movingTime ??
          workout.durationSeconds ??
          workout.duration
      );
      const elapsedFromWindow =
        Number.isFinite(startTs) && Number.isFinite(endTs) && endTs > startTs
          ? Math.round((endTs - startTs) / 1000)
          : null;
      const elapsedTimeSeconds =
        toPositiveRoundedInt(workout.elapsedTimeSeconds ?? workout.elapsedTime) ?? elapsedFromWindow;

      const sportType = normalizeSportType(
        workout.sportType ?? workout.activityName ?? workout.activityType,
        'Run'
      );
      const sourceId = deriveWorkoutSourceId(workout, startTs, endTs);

      return {
        sourceId,
        date: toUtcDateString(startTs),
        name: normalizeSessionName(workout.name ?? workout.activityName, sportType, 'Phone workout sync'),
        sportType,
        startTime: new Date(startTs).toISOString(),
        distanceMeters,
        movingTimeSeconds,
        elapsedTimeSeconds,
        averageHr: toPositiveRoundedInt(workout.averageHr ?? workout.avgHr ?? workout.heartRate),
        maxHr: toPositiveRoundedInt(workout.maxHr),
        averagePace: toPositiveRoundedOneDecimal(workout.averagePace ?? workout.paceSecondsPerKm),
        averageCadence: toPositiveRoundedOneDecimal(workout.averageCadence ?? workout.cadence),
        averagePower: toPositiveRoundedOneDecimal(workout.averagePower ?? workout.power),
        elevationGain: toPositiveRoundedInt(workout.elevationGain ?? workout.elevationGainMeters),
        vo2maxEstimate: toPositiveRoundedOneDecimal(workout.vo2maxEstimate ?? workout.vo2max),
        trainingLoad: toPositiveRoundedOneDecimal(workout.trainingLoad),
        perceivedEffort: Number.isFinite(Number(workout.perceivedEffort))
          ? Math.max(0, Math.min(10, Math.round(Number(workout.perceivedEffort))))
          : null,
        calories: toPositiveRoundedInt(workout.calories),
      };
    })
    .filter(Boolean)
    .slice(-MAX_WORKOUT_BATCH_SIZE);
}

function upsertPhoneSessionRecord(userId, sourceId, row) {
  const existing = phoneSessionBySourceStatement.get(userId, sourceId);
  const hasPrimaryMetric =
    Number.isFinite(row.distanceMeters) ||
    Number.isFinite(row.calories) ||
    Number.isFinite(row.movingTimeSeconds) ||
    Number.isFinite(row.elapsedTimeSeconds) ||
    Number.isFinite(row.trainingLoad) ||
    Number.isFinite(row.perceivedEffort) ||
    Number.isFinite(row.vo2maxEstimate);
  if (!existing && !hasPrimaryMetric) {
    return null;
  }

  const nextName = normalizeSessionName(
    row.name,
    row.sportType,
    existing?.name || 'Phone workout sync'
  );
  const nextSportType = normalizeSportType(row.sportType, existing?.sportType || 'Run');
  const nextDistance = Number.isFinite(row.distanceMeters)
    ? row.distanceMeters
    : Number.isFinite(existing?.distanceMeters)
    ? existing.distanceMeters
    : null;
  const nextElapsed = Number.isFinite(row.elapsedTimeSeconds)
    ? row.elapsedTimeSeconds
    : Number.isFinite(existing?.elapsedTimeSeconds)
    ? existing.elapsedTimeSeconds
    : null;
  const nextCalories = Number.isFinite(row.calories)
    ? row.calories
    : Number.isFinite(existing?.calories)
    ? existing.calories
    : null;
  const nextHr = Number.isFinite(row.averageHr)
    ? row.averageHr
    : Number.isFinite(existing?.averageHr)
    ? existing.averageHr
    : null;
  const nextMaxHr = Number.isFinite(row.maxHr)
    ? row.maxHr
    : Number.isFinite(existing?.maxHr)
    ? existing.maxHr
    : null;
  const nextCadence = Number.isFinite(row.averageCadence)
    ? row.averageCadence
    : Number.isFinite(existing?.averageCadence)
    ? existing.averageCadence
    : null;
  const nextPower = Number.isFinite(row.averagePower)
    ? row.averagePower
    : Number.isFinite(existing?.averagePower)
    ? existing.averagePower
    : null;
  const nextElevation = Number.isFinite(row.elevationGain)
    ? row.elevationGain
    : Number.isFinite(existing?.elevationGain)
    ? existing.elevationGain
    : null;
  const nextVo2 = Number.isFinite(row.vo2maxEstimate)
    ? row.vo2maxEstimate
    : Number.isFinite(existing?.vo2maxEstimate)
    ? existing.vo2maxEstimate
    : null;
  const nextTrainingLoad = Number.isFinite(row.trainingLoad)
    ? row.trainingLoad
    : Number.isFinite(existing?.trainingLoad)
    ? existing.trainingLoad
    : null;
  const nextEffort = Number.isFinite(row.perceivedEffort)
    ? row.perceivedEffort
    : Number.isFinite(existing?.perceivedEffort)
    ? existing.perceivedEffort
    : null;

  const paceForInference = Number.isFinite(row.averagePace)
    ? row.averagePace
    : Number.isFinite(existing?.averagePace)
    ? existing.averagePace
    : null;
  const inferredMovingTime =
    Number.isFinite(nextDistance) &&
    Number.isFinite(paceForInference) &&
    nextDistance > 0 &&
    paceForInference > 0
      ? Math.round((nextDistance / 1000) * paceForInference)
      : null;
  const nextMovingTime = Number.isFinite(row.movingTimeSeconds)
    ? row.movingTimeSeconds
    : Number.isFinite(existing?.movingTimeSeconds)
    ? existing.movingTimeSeconds
    : inferredMovingTime;

  const inferredPace =
    Number.isFinite(nextDistance) && Number.isFinite(nextMovingTime) && nextDistance > 0 && nextMovingTime > 0
      ? Math.round((nextMovingTime / (nextDistance / 1000)) * 10) / 10
      : null;
  const nextPace = Number.isFinite(row.averagePace)
    ? row.averagePace
    : Number.isFinite(existing?.averagePace)
    ? existing.averagePace
    : inferredPace;

  const observedStartTime =
    typeof row.startTime === 'string' && row.startTime
      ? row.startTime
      : toIsoTimestamp(row.lastTs, row.date, null);
  const existingStartTs = Date.parse(existing?.startTime || '');
  const observedStartTs = Date.parse(observedStartTime || '');
  const startTime =
    Number.isFinite(existingStartTs) && Number.isFinite(observedStartTs)
      ? new Date(Math.min(existingStartTs, observedStartTs)).toISOString()
      : existing?.startTime || observedStartTime;

  if (existing?.id) {
    updatePhoneSessionByIdStatement.run(
      nextName,
      nextSportType,
      startTime,
      nextDistance,
      nextMovingTime,
      nextElapsed,
      nextHr,
      nextMaxHr,
      nextPace,
      nextCadence,
      nextPower,
      nextElevation,
      nextVo2,
      nextTrainingLoad,
      nextEffort,
      nextCalories,
      existing.id
    );
    return 'updated';
  }

  insertPhoneSessionStatement.run(
    userId,
    sourceId,
    nextName,
    nextSportType,
    startTime,
    nextDistance,
    nextMovingTime,
    nextElapsed,
    nextHr,
    nextMaxHr,
    nextPace,
    nextCadence,
    nextPower,
    nextElevation,
    nextVo2,
    nextTrainingLoad,
    nextEffort,
    nextCalories
  );
  return 'created';
}

function upsertPhoneWorkoutSession(userId, row) {
  const sourceId = `phone_sync:${row.date}`;
  upsertPhoneSessionRecord(userId, sourceId, {
    ...row,
    name: 'Phone workout sync',
    sportType: 'Run',
  });
}

function downsample(samples = [], maxPoints = MAX_POINTS) {
  if (samples.length <= maxPoints) {
    return samples;
  }

  const bucketSize = samples.length / maxPoints;
  const buckets = [];
  for (let bucketIndex = 0; bucketIndex < maxPoints; bucketIndex += 1) {
    const start = Math.floor(bucketIndex * bucketSize);
    const rawEnd = Math.floor((bucketIndex + 1) * bucketSize);
    const end = Math.max(rawEnd, start + 1);
    buckets.push(samples.slice(start, end));
  }

  return buckets.map((bucket) => {
    const lastPoint = bucket[bucket.length - 1];
    const finiteValues = bucket
      .map((entry) => (Number.isFinite(entry.value) ? entry.value : null))
      .filter((value) => value !== null);
    const average =
      finiteValues.length > 0
        ? finiteValues.reduce((sum, value) => sum + value, 0) / finiteValues.length
        : null;
    const roundedAverage =
      average === null ? (Number.isFinite(lastPoint.value) ? lastPoint.value : null) : average;
    return {
      ts: lastPoint.ts,
      value: roundedAverage === null ? null : Math.round(roundedAverage * 100) / 100,
    };
  });
}

const upsertWorkoutSessionsTransaction = db.transaction((userId, workouts = []) => {
  let created = 0;
  let updated = 0;
  workouts.forEach((workout) => {
    const result = upsertPhoneSessionRecord(userId, workout.sourceId, workout);
    if (result === 'created') {
      created += 1;
    } else if (result === 'updated') {
      updated += 1;
    }
  });
  return { created, updated };
});

router.post('/', authenticate, (req, res) => {
  const metric = normalizeMetric(req.body.metric);
  if (!metric) {
    return res.status(400).json({ message: 'Metric name must be 2-64 characters (letters, numbers, . _ : -).' });
  }
  const samples = sanitizeSamples(req.body.samples, req.body.localDate);
  const skipWorkoutMirror = parseBooleanFlag(req.body?.skipWorkoutMirror);
  if (!samples.length) {
    return res.status(400).json({ message: 'At least one valid sample is required.' });
  }

  const mirroredRows = mergeDateFieldsByMetric(metric, samples);
  const insertMany = db.transaction((rows, dateRows) => {
    rows.forEach((row) => {
      insertSampleStatement.run(req.user.id, metric, row.ts, row.value);
    });
    dateRows.forEach((row) => {
      upsertDailyMetricFields(req.user.id, row);
      upsertSleepStageFields(req.user.id, row);
      upsertHealthMarkerFields(req.user.id, row);
      upsertWeightMetric(req.user.id, row);
      if (!skipWorkoutMirror) {
        upsertPhoneWorkoutSession(req.user.id, row);
      }
    });
  });
  insertMany(samples, mirroredRows);

  return res.status(202).json({
    metric,
    accepted: samples.length,
  });
});

router.post('/workouts', authenticate, (req, res) => {
  const rawWorkouts = Array.isArray(req.body?.workouts)
    ? req.body.workouts
    : req.body?.workout
    ? [req.body.workout]
    : [];
  const workouts = sanitizeWorkoutImports(rawWorkouts);
  if (!workouts.length) {
    return res.status(400).json({ message: 'At least one valid workout is required.' });
  }

  const result = upsertWorkoutSessionsTransaction(req.user.id, workouts);
  return res.status(202).json({
    accepted: workouts.length,
    created: result.created,
    updated: result.updated,
  });
});

router.get('/', authenticate, (req, res) => {
  const metric = normalizeMetric(req.query.metric);
  if (!metric) {
    return res.status(400).json({ message: 'Metric query parameter is required.' });
  }

  const viewer = { id: req.user.id, role: coerceRole(req.user.role) };
  const requestedId = Number.parseInt(req.query.athleteId, 10);
  const subjectId = Number.isNaN(requestedId) ? viewer.id : requestedId;

  const subjectExists = subjectExistsStatement.get(subjectId);
  if (!subjectExists) {
    return res.status(404).json({ message: 'Athlete not found.' });
  }

  if (!ensureAccess(viewer, subjectId)) {
    return res.status(403).json({ message: 'Not authorized to view that athlete.' });
  }

  const now = Date.now();
  let toTs = parseTimestamp(req.query.to, now);
  if (toTs === null) {
    return res.status(400).json({ message: 'Unable to parse `to` timestamp.' });
  }
  let fromTs = parseTimestamp(req.query.from, null);
  if (fromTs === null) {
    const windowMs = parseWindow(req.query.windowMs) || DEFAULT_WINDOW_MS;
    fromTs = toTs - windowMs;
  }
  if (!Number.isFinite(fromTs) || fromTs >= toTs) {
    return res.status(400).json({ message: '`from` must be earlier than `to`.' });
  }

  const rawSamples = samplesInRangeStatement
    .all(subjectId, metric, fromTs, toTs)
    .map((entry) => ({
      ts: Number(entry.ts),
      value: typeof entry.value === 'number' ? entry.value : null,
    }));

  const maxPoints = clampMaxPoints(req.query.maxPoints);
  const points = downsample(rawSamples, maxPoints);

  return res.json({
    subjectId,
    metric,
    from: fromTs,
    to: toTs,
    total: rawSamples.length,
    maxPoints,
    points,
  });
});

module.exports = router;
