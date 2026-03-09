export interface StreamSample {
  ts: number;
  value: number | null;
}

export interface StreamBatch {
  metric: string;
  samples: StreamSample[];
}

export interface IPhoneImportResult {
  batches: StreamBatch[];
  metricCount: number;
  sampleCount: number;
  startTs: number | null;
  endTs: number | null;
}

interface CandidateRecord {
  record: Record<string, unknown>;
  metricHint?: string;
}

const MAX_SCAN_DEPTH = 4;
const DEFAULT_METRIC = 'iphone.imported_value';

const TIMESTAMP_KEYS = [
  'ts',
  'timestamp',
  'time',
  'date',
  'datetime',
  'startTime',
  'start_time',
  'endTime',
  'end_time',
  'recordedAt',
  'recorded_at',
  'createdAt',
  'created_at',
  'startDate',
  'start_date',
  'endDate',
  'end_date',
  'start',
  'end',
];

const GENERIC_IGNORED_KEYS = new Set([
  'metric',
  'source',
  'sourceName',
  'source_name',
  'sourceBundle',
  'source_bundle',
  'device',
  'type',
  'unit',
  'uuid',
  'id',
  'name',
  'title',
  'notes',
  'metadata',
  'samples',
  'records',
  'entries',
  'items',
  'data',
]);

const GENERIC_HINT_KEYS = new Set(['samples', 'records', 'entries', 'items', 'data', 'values']);

const TYPE_HINT_KEYS = [
  'metric',
  'type',
  'dataType',
  'data_type',
  'sampleType',
  'sample_type',
  'identifier',
  'quantityType',
  'quantity_type',
];

const METRIC_ALIASES: Record<string, string> = {
  heart_rate: 'exercise.hr',
  heartrate: 'exercise.hr',
  hr: 'exercise.hr',
  bpm: 'exercise.hr',
  resting_hr: 'vitals.resting_hr',
  resting_heart_rate: 'vitals.resting_hr',
  restingheart_rate: 'vitals.resting_hr',
  resting_heartrate: 'vitals.resting_hr',
  hrv: 'vitals.hrv',
  hrv_sdnn: 'vitals.hrv',
  hrv_score: 'vitals.hrv',
  heart_rate_variability_sdnn: 'vitals.hrv',
  readiness: 'vitals.readiness',
  readiness_score: 'vitals.readiness',
  recovery_score: 'vitals.readiness',
  stress: 'vitals.stress_score',
  stress_score: 'vitals.stress_score',
  spo2: 'vitals.spo2',
  blood_oxygen: 'vitals.spo2',
  oxygen_saturation: 'vitals.spo2',
  respiratory_rate: 'vitals.respiratory_rate',
  breaths_per_minute: 'vitals.respiratory_rate',
  systolic: 'vitals.systolic_bp',
  systolic_bp: 'vitals.systolic_bp',
  blood_pressure_systolic: 'vitals.systolic_bp',
  diastolic: 'vitals.diastolic_bp',
  diastolic_bp: 'vitals.diastolic_bp',
  blood_pressure_diastolic: 'vitals.diastolic_bp',
  steps: 'activity.steps',
  step_count: 'activity.steps',
  stepcount: 'activity.steps',
  active_calories: 'activity.active_calories',
  active_energy_burned: 'activity.active_calories',
  calories: 'exercise.calories',
  kcal: 'exercise.calories',
  energy_kcal: 'exercise.calories',
  total_energy_burned: 'exercise.calories',
  distance_km: 'exercise.distance',
  distance_meters: 'exercise.distance',
  distance_metres: 'exercise.distance',
  distance_miles: 'exercise.distance',
  total_distance: 'exercise.distance',
  distance_walking_running: 'exercise.distance',
  distance_running: 'exercise.distance',
  distance_walking: 'exercise.distance',
  distance_cycling: 'exercise.distance',
  body_mass: 'body.weight_kg',
  body_fat: 'body.body_fat_pct',
  body_fat_percentage: 'body.body_fat_pct',
  dietary_energy_consumed: 'exercise.calories',
  pace_seconds_per_km: 'exercise.pace',
  pace_seconds: 'exercise.pace',
  seconds_per_km: 'exercise.pace',
  min_per_km: 'exercise.pace',
  speed_mps: 'exercise.pace',
  moving_time: 'exercise.moving_time',
  moving_time_s: 'exercise.moving_time',
  moving_time_seconds: 'exercise.moving_time',
  elapsed_time: 'exercise.elapsed_time',
  elapsed_time_s: 'exercise.elapsed_time',
  elapsed_time_seconds: 'exercise.elapsed_time',
  duration: 'exercise.elapsed_time',
  duration_seconds: 'exercise.elapsed_time',
  duration_minutes: 'exercise.elapsed_time',
  elevation_gain: 'exercise.elevation_gain',
  elevation_gain_m: 'exercise.elevation_gain',
  cadence: 'exercise.cadence',
  average_cadence: 'exercise.cadence',
  power: 'exercise.power',
  average_power: 'exercise.power',
  vo2max: 'exercise.vo2max',
  vo2_max: 'exercise.vo2max',
  training_load: 'exercise.training_load',
  perceived_effort: 'exercise.perceived_effort',
  rpe: 'exercise.perceived_effort',
  max_hr: 'exercise.max_hr',
  max_heart_rate: 'exercise.max_hr',
  sleep_hours: 'sleep.total_hours',
  total_sleep_hours: 'sleep.total_hours',
  sleep_minutes: 'sleep.total_hours',
  total_sleep_minutes: 'sleep.total_hours',
  deep_sleep_hours: 'sleep.deep_hours',
  deep_sleep_minutes: 'sleep.deep_hours',
  rem_sleep_hours: 'sleep.rem_hours',
  rem_sleep_minutes: 'sleep.rem_hours',
  light_sleep_hours: 'sleep.light_hours',
  light_sleep_minutes: 'sleep.light_hours',
  awake_hours: 'sleep.awake_hours',
  awake_minutes: 'sleep.awake_hours',
  weight_kg: 'body.weight_kg',
  weight_lbs: 'body.weight_kg',
  body_fat_percent: 'body.body_fat_pct',
  glucose: 'vitals.glucose',
  blood_glucose: 'vitals.glucose',
  sleep_analysis: 'sleep.total_hours',
  workout: 'exercise.distance',
};

interface MetricExtractor {
  metric: string;
  read: (record: Record<string, unknown>) => number | null | undefined;
}

const METRIC_EXTRACTORS: MetricExtractor[] = [
  {
    metric: 'exercise.hr',
    read: (record) =>
      pickNumeric(record, [
        'heartRate',
        'heart_rate',
        'workoutHeartRate',
        'workout_heart_rate',
        'hr',
        'bpm',
        'currentHeartRate',
        'current_heart_rate',
        'averageHeartRate',
        'avgHeartRate',
      ]),
  },
  {
    metric: 'exercise.max_hr',
    read: (record) => pickNumeric(record, ['maxHeartRate', 'max_heart_rate', 'maxHr', 'max_hr']),
  },
  {
    metric: 'vitals.resting_hr',
    read: (record) => pickNumeric(record, ['restingHr', 'resting_hr', 'restingHeartRate', 'resting_heartrate']),
  },
  {
    metric: 'vitals.hrv',
    read: (record) => pickNumeric(record, ['hrv', 'hrvScore', 'heartRateVariability', 'rmssd']),
  },
  {
    metric: 'vitals.readiness',
    read: (record) => pickNumeric(record, ['readiness', 'readinessScore', 'readiness_score', 'recoveryScore', 'recovery_score']),
  },
  {
    metric: 'vitals.stress_score',
    read: (record) => pickNumeric(record, ['stress', 'stressScore', 'stress_score']),
  },
  {
    metric: 'vitals.spo2',
    read: (record) => pickNumeric(record, ['spo2', 'bloodOxygen', 'oxygenSaturation']),
  },
  {
    metric: 'vitals.systolic_bp',
    read: (record) =>
      pickNumeric(record, ['systolic', 'systolicBp', 'systolic_bp', 'bloodPressureSystolic', 'blood_pressure_systolic']),
  },
  {
    metric: 'vitals.diastolic_bp',
    read: (record) =>
      pickNumeric(record, ['diastolic', 'diastolicBp', 'diastolic_bp', 'bloodPressureDiastolic', 'blood_pressure_diastolic']),
  },
  {
    metric: 'vitals.respiratory_rate',
    read: (record) => pickNumeric(record, ['respiratoryRate', 'breathsPerMinute']),
  },
  {
    metric: 'activity.steps',
    read: (record) => pickNumeric(record, ['steps', 'stepCount', 'step_count']),
  },
  {
    metric: 'activity.active_calories',
    read: (record) =>
      pickNumeric(record, ['activeCalories', 'active_calories', 'activeEnergyBurned', 'active_energy_burned']),
  },
  {
    metric: 'exercise.calories',
    read: (record) =>
      pickNumeric(record, ['calories', 'kcal', 'energyKcal', 'energy_kcal', 'totalEnergyBurned', 'total_energy_burned']),
  },
  {
    metric: 'exercise.distance',
    read: (record) => {
      const kilometers = pickNumeric(record, ['distanceKm', 'distance_km', 'kilometers', 'totalDistanceKm', 'total_distance_km']);
      if (kilometers !== undefined) {
        return kilometers;
      }
      const meters = pickNumeric(record, [
        'distanceMeters',
        'distance_meters',
        'meters',
        'metres',
        'distanceM',
        'distance_m',
        'totalDistance',
        'total_distance',
      ]);
      if (meters !== undefined) {
        return Number.isFinite(meters as number) ? (meters as number) / 1000 : null;
      }
      const miles = pickNumeric(record, ['distanceMiles', 'distance_miles', 'miles']);
      if (miles !== undefined) {
        return Number.isFinite(miles as number) ? (miles as number) * 1.60934 : null;
      }
      return undefined;
    },
  },
  {
    metric: 'exercise.pace',
    read: (record) => {
      const paceSeconds = pickNumeric(record, [
        'paceSecondsPerKm',
        'pace_seconds_per_km',
        'paceSeconds',
        'pace_seconds',
        'secondsPerKm',
        'seconds_per_km',
      ]);
      if (paceSeconds !== undefined) {
        return paceSeconds;
      }
      const speedMps = pickNumeric(record, ['speedMps', 'speed_mps']);
      if (speedMps === undefined) {
        return undefined;
      }
      if (!Number.isFinite(speedMps as number) || (speedMps as number) <= 0) {
        return null;
      }
      return 1000 / (speedMps as number);
    },
  },
  {
    metric: 'exercise.moving_time',
    read: (record) => {
      const seconds = pickDurationSeconds(record, [
        'movingTimeSeconds',
        'moving_time_seconds',
        'movingTime',
        'moving_time',
      ]);
      if (seconds !== undefined) {
        return seconds;
      }
      const minutes = pickNumeric(record, ['movingTimeMinutes', 'moving_time_minutes']);
      if (minutes !== undefined) {
        return Number.isFinite(minutes as number) ? (minutes as number) * 60 : null;
      }
      return undefined;
    },
  },
  {
    metric: 'exercise.elapsed_time',
    read: (record) => {
      const seconds = pickDurationSeconds(record, [
        'elapsedTimeSeconds',
        'elapsed_time_seconds',
        'elapsedTime',
        'elapsed_time',
        'durationSeconds',
        'duration_seconds',
        'duration',
      ]);
      if (seconds !== undefined) {
        return seconds;
      }
      const minutes = pickNumeric(record, ['durationMinutes', 'duration_minutes', 'elapsedTimeMinutes', 'elapsed_time_minutes']);
      if (minutes !== undefined) {
        return Number.isFinite(minutes as number) ? (minutes as number) * 60 : null;
      }
      return undefined;
    },
  },
  {
    metric: 'exercise.elevation_gain',
    read: (record) =>
      pickNumeric(record, ['elevationGainMeters', 'elevation_gain_meters', 'elevationGainM', 'elevation_gain_m']),
  },
  {
    metric: 'exercise.cadence',
    read: (record) => pickNumeric(record, ['averageCadence', 'average_cadence', 'cadence']),
  },
  {
    metric: 'exercise.power',
    read: (record) => pickNumeric(record, ['averagePower', 'average_power', 'power']),
  },
  {
    metric: 'exercise.vo2max',
    read: (record) =>
      pickNumeric(record, ['vo2max', 'vo2_max', 'vo2Max', 'vo2maxMlKgMin', 'vo2max_ml_kg_min']),
  },
  {
    metric: 'exercise.training_load',
    read: (record) => pickNumeric(record, ['trainingLoad', 'training_load', 'load']),
  },
  {
    metric: 'exercise.perceived_effort',
    read: (record) => pickNumeric(record, ['perceivedEffort', 'perceived_effort', 'rpe']),
  },
  {
    metric: 'sleep.total_hours',
    read: (record) =>
      readDurationHours(
        record,
        ['sleepHours', 'sleep_hours', 'totalSleepHours', 'total_sleep_hours', 'asleepHours', 'asleep_hours'],
        ['sleepMinutes', 'sleep_minutes', 'totalSleepMinutes', 'total_sleep_minutes', 'asleepMinutes', 'asleep_minutes']
      ),
  },
  {
    metric: 'sleep.deep_hours',
    read: (record) =>
      readDurationHours(
        record,
        ['deepSleepHours', 'deep_sleep_hours', 'sleepDeepHours', 'sleep_deep_hours'],
        ['deepSleepMinutes', 'deep_sleep_minutes', 'sleepDeepMinutes', 'sleep_deep_minutes']
      ),
  },
  {
    metric: 'sleep.rem_hours',
    read: (record) =>
      readDurationHours(
        record,
        ['remSleepHours', 'rem_sleep_hours', 'sleepRemHours', 'sleep_rem_hours'],
        ['remSleepMinutes', 'rem_sleep_minutes', 'sleepRemMinutes', 'sleep_rem_minutes']
      ),
  },
  {
    metric: 'sleep.light_hours',
    read: (record) =>
      readDurationHours(
        record,
        ['lightSleepHours', 'light_sleep_hours', 'sleepLightHours', 'sleep_light_hours'],
        ['lightSleepMinutes', 'light_sleep_minutes', 'sleepLightMinutes', 'sleep_light_minutes']
      ),
  },
  {
    metric: 'sleep.awake_hours',
    read: (record) =>
      readDurationHours(
        record,
        ['awakeHours', 'awake_hours', 'wakeHours', 'wake_hours'],
        ['awakeMinutes', 'awake_minutes', 'wakeMinutes', 'wake_minutes']
      ),
  },
  {
    metric: 'body.weight_kg',
    read: (record) => {
      const weightKg = pickNumeric(record, ['weightKg', 'weight_kg', 'bodyMassKg', 'body_mass_kg']);
      if (weightKg !== undefined) {
        return weightKg;
      }
      const weightLbs = pickNumeric(record, ['weightLbs', 'weight_lbs', 'weightPounds']);
      if (weightLbs !== undefined) {
        return Number.isFinite(weightLbs as number) ? (weightLbs as number) * 0.453592 : null;
      }
      return undefined;
    },
  },
  {
    metric: 'body.body_fat_pct',
    read: (record) => pickNumeric(record, ['bodyFatPercent', 'body_fat_percent', 'bodyFatPercentage']),
  },
  {
    metric: 'vitals.glucose',
    read: (record) => pickNumeric(record, ['glucose', 'glucoseMgDl', 'glucose_mg_dl']),
  },
];

export function parseIPhoneExportPayload(rawPayload: string): IPhoneImportResult {
  const trimmed = rawPayload.trim();
  if (!trimmed) {
    throw new Error('Paste JSON exported from your iPhone first.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error('Import payload must be valid JSON.');
  }

  const now = Date.now();
  const candidates = collectCandidateRecords(parsed, undefined, 0);
  if (!candidates.length) {
    throw new Error('No records found. Export data should include JSON arrays or sample objects.');
  }

  const grouped = new Map<string, Array<StreamSample>>();
  candidates.forEach(({ record, metricHint }) => {
    const timestamp = parseTimestamp(readFirst(record, TIMESTAMP_KEYS), now);
    if (!Number.isFinite(timestamp)) {
      return;
    }

    const samples = parseSamplesFromRecord(record, timestamp, metricHint);
    samples.forEach((sample) => {
      const metric = normalizeMetricName(sample.metric, DEFAULT_METRIC);
      const list = grouped.get(metric) || [];
      list.push({ ts: sample.ts, value: sample.value });
      grouped.set(metric, list);
    });
  });

  const batches = Array.from(grouped.entries())
    .map(([metric, samples]) => ({
      metric,
      samples: collapseBatchSamples(metric, dedupeAndSortSamples(samples)),
    }))
    .filter((batch) => batch.samples.length > 0)
    .sort((a, b) => b.samples.length - a.samples.length);

  if (!batches.length) {
    throw new Error('No numeric samples were found in this export.');
  }

  const sampleCount = batches.reduce((sum, batch) => sum + batch.samples.length, 0);
  const timestamps = batches.flatMap((batch) => batch.samples.map((sample) => sample.ts));
  const startTs = timestamps.length ? Math.min(...timestamps) : null;
  const endTs = timestamps.length ? Math.max(...timestamps) : null;

  return {
    batches,
    metricCount: batches.length,
    sampleCount,
    startTs,
    endTs,
  };
}

function collectCandidateRecords(value: unknown, metricHint?: string, depth = 0): CandidateRecord[] {
  if (depth > MAX_SCAN_DEPTH || value === null || value === undefined) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry) => {
      if (isPlainObject(entry)) {
        return collectCandidateRecords(entry, metricHint, depth + 1);
      }
      const numeric = parseNumericValue(entry);
      if (numeric !== null) {
        return [{ record: { value: numeric }, metricHint }];
      }
      return [];
    });
  }

  if (!isPlainObject(value)) {
    return [];
  }

  const record = value as Record<string, unknown>;
  const candidates: CandidateRecord[] = [];

  if (looksLikeSampleRecord(record)) {
    candidates.push({ record, metricHint });
  }

  Object.entries(record).forEach(([key, nested]) => {
    if (Array.isArray(nested)) {
      candidates.push(...collectCandidateRecords(nested, key, depth + 1));
      return;
    }
    if (isPlainObject(nested)) {
      candidates.push(...collectCandidateRecords(nested, key, depth + 1));
    }
  });

  return candidates;
}

function parseSamplesFromRecord(
  record: Record<string, unknown>,
  timestamp: number,
  metricHint?: string
): Array<{ metric: string; ts: number; value: number | null }> {
  const parsed: Array<{ metric: string; ts: number; value: number | null }> = [];
  const seenMetrics = new Set<string>();
  const metricSource = readFirst(record, TYPE_HINT_KEYS);
  const hasExplicitMetric = metricSource !== undefined || Boolean(metricHint && !isGenericHint(metricHint));
  const inferredMetricName = normalizeMetricName(
    metricSource ?? (metricHint && !isGenericHint(metricHint) ? metricHint : undefined),
    DEFAULT_METRIC
  );

  const sleepSamples = parseAppleSleepCategorySamples(record);
  sleepSamples.forEach((sample) => {
    if (seenMetrics.has(sample.metric)) {
      return;
    }
    parsed.push({
      metric: sample.metric,
      ts: sample.ts,
      value: normalizeMetricValue(sample.metric, sample.value, record),
    });
    seenMetrics.add(sample.metric);
  });

  const explicitMetric = inferredMetricName;
  const explicitValueSource = readFirst(record, ['value', 'qty', 'quantity', 'amount']);
  if (explicitValueSource !== undefined) {
    const explicitValue = parseNumericValue(explicitValueSource);
    if (explicitValue !== null || explicitValueSource === null) {
      parsed.push({
        metric: explicitMetric,
        ts: timestamp,
        value: normalizeMetricValue(explicitMetric, explicitValue, record, true),
      });
      seenMetrics.add(explicitMetric);
    }
  }

  METRIC_EXTRACTORS.forEach((extractor) => {
    const value = extractor.read(record);
    if (value === undefined) {
      return;
    }
    if (seenMetrics.has(extractor.metric)) {
      return;
    }
    parsed.push({
      metric: extractor.metric,
      ts: timestamp,
      value: normalizeMetricValue(extractor.metric, value, record),
    });
    seenMetrics.add(extractor.metric);
  });

  Object.entries(record).forEach(([key, value]) => {
    if (isIgnoredGenericKey(key)) {
      return;
    }
    if (key === 'value' && hasExplicitMetric) {
      return;
    }
    const numeric = parseNumericValue(value);
    if (numeric === null && value !== null) {
      return;
    }
    const metric = normalizeMetricName(
      metricHint && key === 'value' && !isGenericHint(metricHint) ? metricHint : key,
      DEFAULT_METRIC
    );
    if (seenMetrics.has(metric)) {
      return;
    }
    parsed.push({
      metric,
      ts: timestamp,
      value: normalizeMetricValue(metric, numeric, record),
    });
    seenMetrics.add(metric);
  });

  return parsed;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function looksLikeSampleRecord(record: Record<string, unknown>) {
  if ('metric' in record && 'value' in record) {
    return true;
  }
  if (TIMESTAMP_KEYS.some((key) => key in record) && Object.values(record).some((value) => parseNumericValue(value) !== null)) {
    return true;
  }
  return Object.values(record).some((value) => parseNumericValue(value) !== null);
}

function parseNumericValue(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.replace(/,/g, '').trim();
  if (!normalized) {
    return null;
  }
  const direct = Number(normalized);
  if (Number.isFinite(direct)) {
    return direct;
  }
  const matched = normalized.match(/-?\d+(?:\.\d+)?/);
  if (!matched) {
    return null;
  }
  const parsed = Number(matched[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseDurationSeconds(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const clockMatch = trimmed.match(/^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/);
  if (clockMatch) {
    const first = Number(clockMatch[1]);
    const second = Number(clockMatch[2]);
    const third = clockMatch[3] ? Number(clockMatch[3]) : null;
    if (third === null) {
      return first * 60 + second;
    }
    return first * 3600 + second * 60 + third;
  }

  const isoMatch = trimmed.match(/^P(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)$/i);
  if (isoMatch) {
    const hours = Number(isoMatch[1] || 0);
    const minutes = Number(isoMatch[2] || 0);
    const seconds = Number(isoMatch[3] || 0);
    const total = hours * 3600 + minutes * 60 + seconds;
    return Number.isFinite(total) ? total : null;
  }

  return parseNumericValue(trimmed);
}

function pickDurationSeconds(record: Record<string, unknown>, keys: string[]): number | null | undefined {
  for (const key of keys) {
    if (!(key in record)) {
      continue;
    }
    const parsed = parseDurationSeconds(record[key]);
    if (parsed === null) {
      if (record[key] === null || record[key] === '') {
        return null;
      }
      continue;
    }
    return parsed;
  }
  return undefined;
}

function parseAppleSleepCategorySamples(record: Record<string, unknown>) {
  const typeToken = toMetricToken(readFirst(record, ['type', 'dataType', 'data_type', 'sampleType', 'sample_type']));
  if (!typeToken.includes('sleepanalysis') && !typeToken.includes('sleep_analysis')) {
    return [];
  }

  const startTs = parseTimestamp(
    readFirst(record, ['startDate', 'start_date', 'startTime', 'start_time', 'date', 'timestamp', 'ts']),
    NaN
  );
  const endTs = parseTimestamp(
    readFirst(record, ['endDate', 'end_date', 'endTime', 'end_time', 'timestamp', 'ts', 'date']),
    startTs
  );

  if (!Number.isFinite(startTs) || !Number.isFinite(endTs) || endTs <= startTs) {
    return [];
  }

  const hours = (endTs - startTs) / 3_600_000;
  if (!Number.isFinite(hours) || hours <= 0) {
    return [];
  }

  const stageToken = toMetricToken(readFirst(record, ['value', 'stage', 'sleepStage', 'sleep_stage', 'category']));
  const stageMetric = mapSleepStageToken(stageToken);
  if (!stageMetric) {
    return [];
  }

  const ts = Math.round(endTs);
  const samples = [{ metric: stageMetric, ts, value: hours }];
  if (stageMetric !== 'sleep.awake_hours') {
    samples.push({ metric: 'sleep.total_hours', ts, value: hours });
  }
  return samples;
}

function mapSleepStageToken(token: string) {
  if (!token) {
    return null;
  }
  if (token === '2') {
    return 'sleep.awake_hours';
  }
  if (token === '4') {
    return 'sleep.deep_hours';
  }
  if (token === '5') {
    return 'sleep.rem_hours';
  }
  if (token === '3') {
    return 'sleep.light_hours';
  }
  if (token === '0' || token === '1') {
    return 'sleep.total_hours';
  }
  if (token.includes('awake') || token.includes('wake')) {
    return 'sleep.awake_hours';
  }
  if (token.includes('asleepdeep') || token.includes('asleep_deep') || token === 'deep') {
    return 'sleep.deep_hours';
  }
  if (token.includes('asleeprem') || token.includes('asleep_rem') || token === 'rem') {
    return 'sleep.rem_hours';
  }
  if (
    token.includes('asleepcore') ||
    token.includes('asleep_core') ||
    token.includes('asleeplight') ||
    token.includes('asleep_light') ||
    token === 'core' ||
    token === 'light'
  ) {
    return 'sleep.light_hours';
  }
  if (token.includes('asleep') || token.includes('inbed') || token.includes('sleep')) {
    return 'sleep.total_hours';
  }
  return null;
}

function normalizeMetricValue(
  metric: string,
  value: number | null,
  record: Record<string, unknown>,
  useUnitHints = false
) {
  if (value === null || !Number.isFinite(value)) {
    return null;
  }

  const unitToken = toMetricToken(
    readFirst(record, ['unit', 'units', 'valueUnit', 'value_unit', 'durationUnit', 'duration_unit'])
  );
  let numeric = Number(value);

  if (metric === 'exercise.distance' && useUnitHints) {
    if (unitToken === 'm' || unitToken === 'meter' || unitToken === 'meters' || unitToken === 'metre' || unitToken === 'metres') {
      numeric /= 1000;
    } else if (unitToken === 'cm' || unitToken === 'centimeter' || unitToken === 'centimeters') {
      numeric /= 100000;
    } else if (unitToken.includes('mile') || unitToken === 'mi') {
      numeric *= 1.60934;
    }
  }

  if (metric === 'body.weight_kg' && useUnitHints) {
    if (unitToken.includes('lb') || unitToken.includes('pound')) {
      numeric *= 0.453592;
    }
  }

  if (metric === 'vitals.glucose' && useUnitHints) {
    if (unitToken.includes('mmol')) {
      numeric *= 18;
    }
  }

  if (metric === 'vitals.spo2' || metric === 'body.body_fat_pct') {
    if (numeric >= 0 && numeric <= 1) {
      numeric *= 100;
    }
  }

  if (
    metric === 'vitals.resting_hr' ||
    metric === 'vitals.systolic_bp' ||
    metric === 'vitals.diastolic_bp' ||
    metric === 'vitals.stress_score' ||
    metric === 'vitals.readiness'
  ) {
    numeric = Math.round(numeric);
  }

  if (metric === 'exercise.vo2max' || metric === 'exercise.training_load') {
    numeric = Math.round(numeric * 10) / 10;
  }

  if (metric === 'exercise.perceived_effort') {
    numeric = Math.max(0, Math.min(10, Math.round(numeric)));
  }

  if (
    metric === 'sleep.total_hours' ||
    metric === 'sleep.deep_hours' ||
    metric === 'sleep.rem_hours' ||
    metric === 'sleep.light_hours' ||
    metric === 'sleep.awake_hours'
  ) {
    if (useUnitHints) {
      if (unitToken.includes('min')) {
        numeric /= 60;
      } else if (unitToken === 's' || unitToken.includes('sec')) {
        numeric /= 3600;
      }
    }
    numeric = Math.max(0, numeric);
  }

  if (metric === 'exercise.moving_time' || metric === 'exercise.elapsed_time') {
    if (useUnitHints) {
      if (unitToken.includes('min')) {
        numeric *= 60;
      } else if (unitToken === 'h' || unitToken.includes('hour')) {
        numeric *= 3600;
      }
    }
    numeric = Math.max(0, numeric);
  }

  if (metric === 'exercise.pace') {
    if (useUnitHints) {
      if (unitToken.includes('min') && unitToken.includes('km')) {
        numeric *= 60;
      } else if (unitToken.includes('mps') || unitToken === 'm_s') {
        numeric = numeric > 0 ? 1000 / numeric : 0;
      } else if (unitToken.includes('km_h') || unitToken === 'kph') {
        numeric = numeric > 0 ? 3600 / numeric : 0;
      }
    }
  }

  return Number.isFinite(numeric) ? numeric : null;
}

function pickNumeric(record: Record<string, unknown>, keys: string[]): number | null | undefined {
  for (const key of keys) {
    if (!(key in record)) {
      continue;
    }
    const parsed = parseNumericValue(record[key]);
    if (parsed === null) {
      if (record[key] === null || record[key] === '') {
        return null;
      }
      continue;
    }
    return parsed;
  }
  return undefined;
}

function readDurationHours(
  record: Record<string, unknown>,
  hoursKeys: string[],
  minutesKeys: string[]
) {
  const hours = pickNumeric(record, hoursKeys);
  if (hours !== undefined) {
    return hours;
  }
  const minutes = pickNumeric(record, minutesKeys);
  if (minutes === undefined) {
    return undefined;
  }
  if (!Number.isFinite(minutes as number)) {
    return null;
  }
  return (minutes as number) / 60;
}

function parseTimestamp(value: unknown, fallback: number) {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value > 0 && value < 10_000_000_000) {
      return Math.round(value * 1000);
    }
    return Math.round(value);
  }
  if (typeof value === 'string') {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) {
      if (numeric < 10_000_000_000) {
        return Math.round(numeric * 1000);
      }
      return Math.round(numeric);
    }
    const dateParsed = Date.parse(value);
    if (!Number.isNaN(dateParsed) && dateParsed > 0) {
      return Math.round(dateParsed);
    }
  }
  return fallback;
}

function readFirst(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    if (key in record) {
      return record[key];
    }
  }
  return undefined;
}

function toMetricToken(value: unknown) {
  return String(value ?? '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9.]+/g, '_')
    .toLowerCase()
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
}

function normalizeMetricName(value: unknown, fallback: string) {
  const token = toMetricToken(value);
  if (!token) {
    return fallback;
  }
  const collapsedHkToken = token
    .replace(/^hkquantity_type_identifier_/, '')
    .replace(/^hkcategory_type_identifier_/, '')
    .replace(/^hkworkout_type_identifier$/, 'workout')
    .replace(/^hkcategory_value_sleep_analysis_/, 'sleep_');
  if (token.includes('.')) {
    return token;
  }
  return METRIC_ALIASES[token] || METRIC_ALIASES[collapsedHkToken] || `iphone.${token}`;
}

const SLEEP_DURATION_METRICS = new Set([
  'sleep.total_hours',
  'sleep.deep_hours',
  'sleep.rem_hours',
  'sleep.light_hours',
  'sleep.awake_hours',
]);

function collapseBatchSamples(metric: string, samples: StreamSample[]) {
  if (!SLEEP_DURATION_METRICS.has(metric)) {
    return samples;
  }
  const grouped = new Map<string, StreamSample[]>();
  samples.forEach((sample) => {
    if (!Number.isFinite(sample.ts)) {
      return;
    }
    const key = toLocalDateKey(sample.ts);
    const list = grouped.get(key) || [];
    list.push(sample);
    grouped.set(key, list);
  });

  const collapsed: StreamSample[] = [];
  grouped.forEach((entries) => {
    if (entries.length <= 1) {
      collapsed.push(...entries);
      return;
    }
    const valid = entries
      .map((entry) => (Number.isFinite(entry.value as number) ? (entry.value as number) : null))
      .filter((entry): entry is number => entry !== null && entry >= 0);
    const canAggregate = valid.length === entries.length && valid.every((value) => value <= 4);
    if (!canAggregate) {
      collapsed.push(...entries);
      return;
    }
    const total = valid.reduce((sum, value) => sum + value, 0);
    const latestTs = entries.reduce((latest, entry) => Math.max(latest, entry.ts), 0);
    collapsed.push({
      ts: latestTs,
      value: Math.round(total * 1000) / 1000,
    });
  });

  return dedupeAndSortSamples(collapsed);
}

function toLocalDateKey(ts: number) {
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) {
    return 'invalid';
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function dedupeAndSortSamples(samples: StreamSample[]): StreamSample[] {
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

function isIgnoredGenericKey(key: string) {
  return GENERIC_IGNORED_KEYS.has(key) || TIMESTAMP_KEYS.includes(key);
}

function isGenericHint(metricHint: string) {
  return GENERIC_HINT_KEYS.has(toMetricToken(metricHint));
}
