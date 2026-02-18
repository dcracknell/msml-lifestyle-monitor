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
  'recordedAt',
  'recorded_at',
  'createdAt',
  'created_at',
  'startDate',
  'start_date',
  'endDate',
  'end_date',
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

const METRIC_ALIASES: Record<string, string> = {
  heart_rate: 'exercise.hr',
  heartrate: 'exercise.hr',
  hr: 'exercise.hr',
  bpm: 'exercise.hr',
  resting_hr: 'vitals.resting_hr',
  resting_heartrate: 'vitals.resting_hr',
  hrv: 'vitals.hrv',
  hrv_score: 'vitals.hrv',
  spo2: 'vitals.spo2',
  blood_oxygen: 'vitals.spo2',
  oxygen_saturation: 'vitals.spo2',
  respiratory_rate: 'vitals.respiratory_rate',
  breaths_per_minute: 'vitals.respiratory_rate',
  steps: 'activity.steps',
  step_count: 'activity.steps',
  active_calories: 'activity.active_calories',
  calories: 'exercise.calories',
  kcal: 'exercise.calories',
  energy_kcal: 'exercise.calories',
  distance_km: 'exercise.distance',
  distance_meters: 'exercise.distance',
  distance_miles: 'exercise.distance',
  pace_seconds_per_km: 'exercise.pace',
  pace_seconds: 'exercise.pace',
  seconds_per_km: 'exercise.pace',
  speed_mps: 'exercise.pace',
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
  body_fat_percentage: 'body.body_fat_pct',
  glucose: 'vitals.glucose',
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
        'hr',
        'bpm',
        'currentHeartRate',
        'current_heart_rate',
        'averageHeartRate',
        'avgHeartRate',
      ]),
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
    metric: 'vitals.spo2',
    read: (record) => pickNumeric(record, ['spo2', 'bloodOxygen', 'oxygenSaturation']),
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
    read: (record) => pickNumeric(record, ['calories', 'kcal', 'energyKcal', 'energy_kcal']),
  },
  {
    metric: 'exercise.distance',
    read: (record) => {
      const kilometers = pickNumeric(record, ['distanceKm', 'distance_km', 'kilometers']);
      if (kilometers !== undefined) {
        return kilometers;
      }
      const meters = pickNumeric(record, ['distanceMeters', 'distance_meters', 'meters']);
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
      samples: dedupeAndSortSamples(samples),
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
  const hasExplicitMetric = 'metric' in record;

  const explicitMetric = normalizeMetricName(record.metric ?? metricHint, DEFAULT_METRIC);
  if ('value' in record) {
    const explicitValue = parseNumericValue(record.value);
    if (explicitValue !== null || record.value === null) {
      parsed.push({ metric: explicitMetric, ts: timestamp, value: explicitValue });
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
    parsed.push({ metric: extractor.metric, ts: timestamp, value });
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
    parsed.push({ metric, ts: timestamp, value: numeric });
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
  if (token.includes('.')) {
    return token;
  }
  return METRIC_ALIASES[token] || `iphone.${token}`;
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
