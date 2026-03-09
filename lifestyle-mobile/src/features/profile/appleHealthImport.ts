import { IPhoneImportResult, StreamBatch, StreamSample } from '../devices/iphoneImport';

export interface AppleHealthQuantitySample {
  startDate?: unknown;
  endDate?: unknown;
  value?: unknown;
}

export interface AppleHealthWorkoutSample {
  id?: unknown;
  uuid?: unknown;
  activityName?: unknown;
  activityType?: unknown;
  workoutActivityType?: unknown;
  activityId?: unknown;
  type?: unknown;
  calories?: unknown;
  totalEnergyBurned?: unknown;
  energyBurned?: unknown;
  distance?: unknown;
  totalDistance?: unknown;
  distanceMeters?: unknown;
  distanceKm?: unknown;
  distanceMiles?: unknown;
  distanceUnit?: unknown;
  duration?: unknown;
  movingTimeSeconds?: unknown;
  elapsedTimeSeconds?: unknown;
  start?: unknown;
  end?: unknown;
  startTime?: unknown;
  endTime?: unknown;
  startDate?: unknown;
  endDate?: unknown;
  sourceName?: unknown;
  sourceId?: unknown;
}

export interface AppleHealthWorkoutImport {
  sourceId: string;
  name: string;
  sportType: string;
  startTime: string;
  endTime: string | null;
  distanceMeters: number | null;
  calories: number | null;
  movingTimeSeconds: number | null;
  elapsedTimeSeconds: number | null;
}

export interface AppleHealthImportResult extends IPhoneImportResult {
  workouts: AppleHealthWorkoutImport[];
  workoutCount: number;
}

export interface AppleHealthPayload {
  dailyStepCountSamples?: AppleHealthQuantitySample[];
  dailyDistanceWalkingRunningSamples?: AppleHealthQuantitySample[];
  activeEnergyBurnedSamples?: AppleHealthQuantitySample[];
  appleExerciseTimeSamples?: AppleHealthQuantitySample[];
  heartRateSamples?: AppleHealthQuantitySample[];
  restingHeartRateSamples?: AppleHealthQuantitySample[];
  bloodGlucoseSamples?: AppleHealthQuantitySample[];
  sleepSamples?: AppleHealthQuantitySample[];
  workoutSamples?: AppleHealthWorkoutSample[];
}

const METRIC_ACTIVITY_STEPS = 'activity.steps';
const METRIC_EXERCISE_DISTANCE = 'exercise.distance';
const METRIC_EXERCISE_CALORIES = 'exercise.calories';
const METRIC_EXERCISE_ELAPSED_TIME = 'exercise.elapsed_time';
const METRIC_EXERCISE_HR = 'exercise.hr';
const METRIC_RESTING_HR = 'vitals.resting_hr';
const METRIC_GLUCOSE = 'vitals.glucose';
const METRIC_SLEEP_TOTAL_HOURS = 'sleep.total_hours';

export function parseAppleHealthPayload(payload: AppleHealthPayload): AppleHealthImportResult {
  const batches: StreamBatch[] = [];

  const dailySteps = mapDailySteps(payload.dailyStepCountSamples || []);
  if (dailySteps.length) {
    batches.push({ metric: METRIC_ACTIVITY_STEPS, samples: dailySteps });
  }

  const distanceWalkingRunning = mapQuantitySamples(
    payload.dailyDistanceWalkingRunningSamples || [],
    (value) => roundTo(value / 1000, 3),
    true
  );
  if (distanceWalkingRunning.length) {
    batches.push({ metric: METRIC_EXERCISE_DISTANCE, samples: distanceWalkingRunning });
  }

  const activeEnergyBurned = mapQuantitySamples(
    payload.activeEnergyBurnedSamples || [],
    (value) => roundTo(value, 1),
    true
  );
  if (activeEnergyBurned.length) {
    batches.push({ metric: METRIC_EXERCISE_CALORIES, samples: activeEnergyBurned });
  }

  const appleExerciseTime = mapQuantitySamples(
    payload.appleExerciseTimeSamples || [],
    (value) => Math.round(value),
    true
  );
  if (appleExerciseTime.length) {
    batches.push({ metric: METRIC_EXERCISE_ELAPSED_TIME, samples: appleExerciseTime });
  }

  const heartRate = mapQuantitySamples(payload.heartRateSamples || [], (value) => value, true);
  if (heartRate.length) {
    batches.push({ metric: METRIC_EXERCISE_HR, samples: heartRate });
  }

  const restingHeartRate = mapQuantitySamples(
    payload.restingHeartRateSamples || [],
    (value) => value,
    true
  );
  if (restingHeartRate.length) {
    batches.push({ metric: METRIC_RESTING_HR, samples: restingHeartRate });
  }

  const bloodGlucose = mapQuantitySamples(
    payload.bloodGlucoseSamples || [],
    normalizeGlucoseMgDl,
    true
  );
  if (bloodGlucose.length) {
    batches.push({ metric: METRIC_GLUCOSE, samples: bloodGlucose });
  }

  const sleepTotals = mapDailySleepHours(payload.sleepSamples || []);
  if (sleepTotals.length) {
    batches.push({ metric: METRIC_SLEEP_TOTAL_HOURS, samples: sleepTotals });
  }

  const workouts = mapWorkoutSamples(payload.workoutSamples || []);

  const sampleCount = batches.reduce((total, batch) => total + batch.samples.length, 0);
  const timestamps = batches.flatMap((batch) => batch.samples.map((sample) => sample.ts));
  const startTs = timestamps.length ? Math.min(...timestamps) : null;
  const endTs = timestamps.length ? Math.max(...timestamps) : null;

  return {
    batches: batches.sort((a, b) => b.samples.length - a.samples.length),
    metricCount: batches.length,
    sampleCount,
    startTs,
    endTs,
    workouts,
    workoutCount: workouts.length,
  };
}

function mapWorkoutSamples(samples: AppleHealthWorkoutSample[]) {
  const bySourceId = new Map<string, AppleHealthWorkoutImport>();

  samples.forEach((sample) => {
    const activityLabel = resolveWorkoutActivityLabel(sample);
    const startTs = parseTimestamp(sample.start ?? sample.startDate ?? sample.startTime);
    if (startTs === null) {
      return;
    }

    const endTsValue = parseTimestamp(sample.end ?? sample.endDate ?? sample.endTime);
    const endTs = endTsValue !== null && endTsValue > startTs ? endTsValue : null;
    const durationSeconds = resolveWorkoutDurationSeconds(sample, startTs, endTs);
    const distanceMeters = resolveWorkoutDistanceMeters(sample);
    const calories = resolveWorkoutCalories(sample);
    const sportType = normalizeWorkoutSportType(activityLabel);
    const sourceId = deriveWorkoutSourceId(sample, startTs, endTs, sportType);
    const endTime =
      endTs !== null
        ? new Date(endTs).toISOString()
        : durationSeconds !== null && durationSeconds > 0
        ? new Date(startTs + durationSeconds * 1000).toISOString()
        : null;

    const workout: AppleHealthWorkoutImport = {
      sourceId,
      name: normalizeWorkoutName(activityLabel, sportType),
      sportType,
      startTime: new Date(startTs).toISOString(),
      endTime,
      distanceMeters,
      calories,
      movingTimeSeconds: durationSeconds,
      elapsedTimeSeconds: durationSeconds,
    };

    const existing = bySourceId.get(sourceId);
    if (!existing) {
      bySourceId.set(sourceId, workout);
      return;
    }

    existing.name = existing.name || workout.name;
    existing.sportType = existing.sportType || workout.sportType;
    existing.endTime = existing.endTime || workout.endTime;
    existing.distanceMeters =
      existing.distanceMeters ?? workout.distanceMeters;
    existing.calories = existing.calories ?? workout.calories;
    existing.movingTimeSeconds =
      existing.movingTimeSeconds ?? workout.movingTimeSeconds;
    existing.elapsedTimeSeconds =
      existing.elapsedTimeSeconds ?? workout.elapsedTimeSeconds;
  });

  return Array.from(bySourceId.values()).sort(
    (a, b) => Date.parse(a.startTime) - Date.parse(b.startTime)
  );
}

function resolveWorkoutActivityLabel(sample: AppleHealthWorkoutSample) {
  return sample.activityName ?? sample.activityType ?? sample.workoutActivityType ?? sample.type;
}

function resolveWorkoutDistanceMeters(sample: AppleHealthWorkoutSample) {
  const meters = firstFiniteNumber(sample.distanceMeters);
  if (meters !== null && meters > 0) {
    return Math.round(meters);
  }

  const kilometers = firstFiniteNumber(sample.distanceKm);
  if (kilometers !== null && kilometers > 0) {
    return Math.round(kilometers * 1000);
  }

  const miles = firstFiniteNumber(sample.distanceMiles);
  if (miles !== null && miles > 0) {
    return Math.round(miles * 1609.344);
  }

  const rawDistance = firstFiniteNumber(sample.distance, sample.totalDistance);
  if (rawDistance === null || rawDistance <= 0) {
    return null;
  }

  const explicitUnit = normalizeDistanceUnit(sample.distanceUnit);
  if (explicitUnit === 'm') {
    return Math.round(rawDistance);
  }
  if (explicitUnit === 'km') {
    return Math.round(rawDistance * 1000);
  }
  if (explicitUnit === 'mi') {
    return Math.round(rawDistance * 1609.344);
  }

  // react-native-health returns workout distance in miles, but other bridges often send meters.
  if (rawDistance <= 200) {
    return Math.round(rawDistance * 1609.344);
  }
  return Math.round(rawDistance);
}

function resolveWorkoutCalories(sample: AppleHealthWorkoutSample) {
  const calories = firstFiniteNumber(sample.calories, sample.totalEnergyBurned, sample.energyBurned);
  if (calories === null || calories <= 0) {
    return null;
  }
  return Math.round(calories);
}

function resolveWorkoutDurationSeconds(
  sample: AppleHealthWorkoutSample,
  startTs: number,
  endTs: number | null
) {
  const duration = firstFiniteNumber(
    sample.duration,
    sample.movingTimeSeconds,
    sample.elapsedTimeSeconds
  );
  if (duration !== null && duration > 0) {
    const normalizedDuration = duration > 1_000_000 ? duration / 1000 : duration;
    return Math.round(normalizedDuration);
  }
  if (endTs !== null && endTs > startTs) {
    return Math.round((endTs - startTs) / 1000);
  }
  return null;
}

function normalizeWorkoutSportType(activityName: unknown) {
  const raw = String(activityName || '').trim().toLowerCase();
  if (!raw) {
    return 'Run';
  }
  if (raw.includes('run') || raw.includes('jog') || raw.includes('treadmill')) {
    return 'Run';
  }
  if (raw.includes('walk')) {
    return 'Walk';
  }
  if (raw.includes('hike')) {
    return 'Hike';
  }
  if (raw.includes('cycle') || raw.includes('bike') || raw.includes('ride')) {
    return 'Ride';
  }
  if (raw.includes('swim')) {
    return 'Swim';
  }
  if (raw.includes('row')) {
    return 'Row';
  }
  if (raw.includes('strength') || raw.includes('weight')) {
    return 'Strength';
  }
  if (raw.includes('yoga')) {
    return 'Yoga';
  }
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function normalizeWorkoutName(activityName: unknown, sportType: string) {
  const raw = String(activityName || '').trim();
  if (raw) {
    return raw.slice(0, 96);
  }
  return `${sportType} workout`;
}

function normalizeSourceToken(value: unknown, fallback = 'unknown') {
  const token = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return (token || fallback).slice(0, 64);
}

function deriveWorkoutSourceId(
  sample: AppleHealthWorkoutSample,
  startTs: number,
  endTs: number | null,
  sportType: string
) {
  const explicit = String(sample.id ?? sample.uuid ?? '').trim();
  if (explicit) {
    return `apple-health:${explicit}`.slice(0, 180);
  }
  const sourceToken = normalizeSourceToken(sample.sourceId ?? sample.sourceName, 'apple-health');
  const sportToken = normalizeSourceToken(sportType, 'workout');
  const endToken = Number.isFinite(endTs) ? String(endTs) : 'na';
  const distanceToken = resolveWorkoutDistanceMeters(sample) ?? 0;
  const durationToken = resolveWorkoutDurationSeconds(sample, startTs, endTs) ?? 0;
  return `apple-health:${sourceToken}:${sportToken}:${startTs}:${endToken}:${distanceToken}:${durationToken}`.slice(0, 180);
}

function mapDailySteps(samples: AppleHealthQuantitySample[]) {
  const normalized: StreamSample[] = [];

  samples.forEach((sample) => {
    const ts = parseTimestamp(sample.endDate) ?? parseTimestamp(sample.startDate);
    const numericValue = toFiniteNumber(sample.value);
    if (!Number.isFinite(ts) || numericValue === null) {
      return;
    }
    normalized.push({
      ts: ts as number,
      value: Math.max(0, Math.round(numericValue)),
    });
  });

  return dedupeAndSortSamples(normalized);
}

function mapQuantitySamples(
  samples: AppleHealthQuantitySample[],
  mapValue: (value: number) => number,
  positiveOnly = false
) {
  const normalized: StreamSample[] = [];

  samples.forEach((sample) => {
    const ts = parseTimestamp(sample.startDate) ?? parseTimestamp(sample.endDate);
    const rawValue = toFiniteNumber(sample.value);
    if (!Number.isFinite(ts) || rawValue === null) {
      return;
    }

    const value = mapValue(rawValue);
    if (!Number.isFinite(value)) {
      return;
    }
    if (positiveOnly && value <= 0) {
      return;
    }

    normalized.push({ ts: ts as number, value });
  });

  return dedupeAndSortSamples(normalized);
}

function mapDailySleepHours(samples: AppleHealthQuantitySample[]) {
  const dailyTotals = new Map<string, { totalMs: number; ts: number }>();

  samples.forEach((sample) => {
    if (!isSleepValueCounted(sample.value)) {
      return;
    }
    const startTs = parseTimestamp(sample.startDate);
    const endTs = parseTimestamp(sample.endDate);
    if (!Number.isFinite(startTs) || !Number.isFinite(endTs)) {
      return;
    }
    if ((endTs as number) <= (startTs as number)) {
      return;
    }
    const ts = endTs as number;
    const dayKey = toLocalDateKey(new Date(ts));
    const previous = dailyTotals.get(dayKey) || { totalMs: 0, ts };
    previous.totalMs += ts - (startTs as number);
    previous.ts = Math.max(previous.ts, ts);
    dailyTotals.set(dayKey, previous);
  });

  const normalized: StreamSample[] = [];
  dailyTotals.forEach((entry) => {
    const hours = roundTo(entry.totalMs / (60 * 60 * 1000), 3);
    if (hours <= 0) {
      return;
    }
    normalized.push({
      ts: entry.ts,
      value: hours,
    });
  });

  return dedupeAndSortSamples(normalized);
}

function isSleepValueCounted(value: unknown) {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (!normalized) {
      return true;
    }
    if (normalized.includes('awake')) {
      return false;
    }
    return true;
  }
  if (typeof value === 'number') {
    return value !== 2;
  }
  return true;
}

function parseTimestamp(value: unknown): number | null {
  const numeric = toFiniteNumber(value);
  if (numeric !== null) {
    const normalized = Math.abs(numeric) < 1_000_000_000_000 ? numeric * 1000 : numeric;
    return Number.isFinite(normalized) ? Math.round(normalized) : null;
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function firstFiniteNumber(...values: unknown[]) {
  for (const value of values) {
    const numeric = toFiniteNumber(value);
    if (numeric !== null) {
      return numeric;
    }
  }
  return null;
}

function normalizeDistanceUnit(value: unknown): 'm' | 'km' | 'mi' | null {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) {
    return null;
  }
  if (raw === 'm' || raw === 'meter' || raw === 'meters' || raw === 'metre' || raw === 'metres') {
    return 'm';
  }
  if (raw === 'km' || raw === 'kilometer' || raw === 'kilometers' || raw === 'kilometre' || raw === 'kilometres') {
    return 'km';
  }
  if (raw === 'mi' || raw === 'mile' || raw === 'miles') {
    return 'mi';
  }
  return null;
}

function dedupeAndSortSamples(samples: StreamSample[]) {
  const seen = new Set<string>();
  const normalized: StreamSample[] = [];
  samples.forEach((sample) => {
    if (!Number.isFinite(sample.ts)) {
      return;
    }
    const ts = Math.round(sample.ts);
    const key = `${ts}|${sample.value === null ? 'null' : sample.value}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    normalized.push({ ts, value: sample.value });
  });
  return normalized.sort((a, b) => a.ts - b.ts);
}

function roundTo(value: number, precision = 2) {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function normalizeGlucoseMgDl(value: number) {
  if (!Number.isFinite(value)) {
    return value;
  }
  // Most apps operate in mg/dL. Values <= 30 are almost always mmol/L.
  if (value > 0 && value <= 30) {
    return roundTo(value * 18.0182, 1);
  }
  return roundTo(value, 1);
}

function toLocalDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
