import type { TrendPoint } from '../../components/TrendChart';
import type { BluetoothSample } from '../../providers/BluetoothProvider';
import { formatDate, formatDecimal, formatNumber, formatPace } from '../../utils/format';

export const BLUETOOTH_DIAGNOSTIC_METRICS = new Set([
  'sensor.hm10_link_probe',
  'sensor.hm10_link_ack',
  'sensor.time_ms',
]);

const METRIC_LABELS: Record<string, string> = {
  'sensor.aht20_temperature_c': 'AHT20 Temperature',
  'sensor.aht20_humidity_percent': 'AHT20 Humidity',
  'sensor.tmp117_temperature_c': 'TMP117 Temperature',
  'sensor.voc_raw': 'VOC Raw',
  'sensor.accel_x': 'Acceleration X',
  'sensor.accel_y': 'Acceleration Y',
  'sensor.accel_z': 'Acceleration Z',
  'sensor.gyro_x': 'Gyro X',
  'sensor.gyro_y': 'Gyro Y',
  'sensor.gyro_z': 'Gyro Z',
  'sensor.max_red': 'MAX30102 Red',
  'sensor.max_ir': 'MAX30102 IR',
  'exercise.hr': 'Exercise Heart Rate',
  'exercise.distance': 'Exercise Distance',
  'exercise.pace': 'Exercise Pace',
  'exercise.calories': 'Exercise Calories',
  'vitals.heart_rate': 'Heart Rate',
  'vitals.resting_hr': 'Resting Heart Rate',
  'vitals.glucose': 'Blood Glucose',
  'vitals.hrv': 'HRV',
  'vitals.spo2': 'SpO2',
  'vitals.systolic_bp': 'Systolic BP',
  'vitals.diastolic_bp': 'Diastolic BP',
  'vitals.respiratory_rate': 'Respiratory Rate',
  'vitals.stress_score': 'Stress',
  'vitals.readiness': 'Readiness',
  'sleep.total_hours': 'Total Sleep',
  'sleep.deep_hours': 'Deep Sleep',
  'sleep.rem_hours': 'REM Sleep',
  'sleep.light_hours': 'Light Sleep',
  'sleep.awake_hours': 'Awake Time',
  'body.weight_kg': 'Body Weight',
  'body.body_fat_pct': 'Body Fat',
};

const METRIC_UNITS: Record<string, string> = {
  'sensor.aht20_temperature_c': 'C',
  'sensor.aht20_humidity_percent': '%',
  'sensor.tmp117_temperature_c': 'C',
  'sensor.accel_x': 'm/s^2',
  'sensor.accel_y': 'm/s^2',
  'sensor.accel_z': 'm/s^2',
  'sensor.gyro_x': 'rad/s',
  'sensor.gyro_y': 'rad/s',
  'sensor.gyro_z': 'rad/s',
  'exercise.hr': 'bpm',
  'exercise.distance': 'km',
  'exercise.pace': 'sec/km',
  'exercise.calories': 'kcal',
  'vitals.heart_rate': 'bpm',
  'vitals.resting_hr': 'bpm',
  'vitals.glucose': 'mg/dL',
  'vitals.hrv': 'ms',
  'vitals.spo2': '%',
  'vitals.systolic_bp': 'mmHg',
  'vitals.diastolic_bp': 'mmHg',
  'vitals.respiratory_rate': 'br/min',
  'sleep.total_hours': 'h',
  'sleep.deep_hours': 'h',
  'sleep.rem_hours': 'h',
  'sleep.light_hours': 'h',
  'sleep.awake_hours': 'h',
  'body.weight_kg': 'kg',
  'body.body_fat_pct': '%',
};

export interface BluetoothTrendSeriesConfig {
  key: string;
  label?: string;
  yLabel?: string;
  matches?: (metric: string) => boolean;
  normalize?: (value: number, metric: string) => number | null;
  formatValue?: (value: number | null | undefined) => string;
}

export interface BluetoothTrendSeries {
  key: string;
  metric: string;
  label: string;
  yLabel?: string;
  latestTs: number;
  latestValue: number | null;
  latestValueLabel: string;
  points: TrendPoint[];
}

export function formatBluetoothMetricLabel(metric: string) {
  if (METRIC_LABELS[metric]) {
    return METRIC_LABELS[metric];
  }
  const tail = metric.split('.').pop() || metric;
  return tail
    .split('_')
    .map((part) => {
      const lowered = part.toLowerCase();
      if (lowered === 'hr') return 'HR';
      if (lowered === 'hrv') return 'HRV';
      if (lowered === 'spo2') return 'SpO2';
      if (lowered === 'voc') return 'VOC';
      if (lowered.length <= 2) return lowered.toUpperCase();
      return lowered.charAt(0).toUpperCase() + lowered.slice(1);
    })
    .join(' ');
}

export function formatBluetoothMetricReading(metric: string, value: number | null | undefined) {
  if (!Number.isFinite(value as number)) {
    return '--';
  }
  const numericValue = value as number;
  if (metric === 'exercise.pace') {
    return formatPace(numericValue);
  }
  if (metric === 'exercise.distance') {
    return `${formatDecimal(numericValue, numericValue >= 10 ? 1 : 2)} km`;
  }
  if (metric === 'body.weight_kg') {
    return `${formatDecimal(numericValue, 1)} kg`;
  }
  const fractionDigits =
    metric.includes('temperature') ||
    metric.includes('humidity') ||
    metric.includes('sleep') ||
    metric.includes('weight') ||
    metric.startsWith('sensor.accel_') ||
    metric.startsWith('sensor.gyro_')
      ? 1
      : 0;
  const valueLabel =
    fractionDigits > 0 ? numericValue.toFixed(fractionDigits) : formatNumber(numericValue);
  const unit = METRIC_UNITS[metric];
  return unit ? `${valueLabel} ${unit}` : valueLabel;
}

export function buildBluetoothTrendSeries(
  samples: BluetoothSample[],
  configs: BluetoothTrendSeriesConfig[],
  options: { limit?: number; labelFormat?: string } = {}
) {
  const limit = options.limit ?? 24;
  const labelFormat = options.labelFormat ?? 'HH:mm:ss';
  const seriesList: BluetoothTrendSeries[] = [];

  configs.forEach((config) => {
    const matches = config.matches ?? ((metric: string) => normalizeMetric(metric) === normalizeMetric(config.key));
    const normalizedPoints = samples
      .filter(
        (sample) =>
          matches(sample.metric) &&
          Number.isFinite(sample.ts) &&
          Number.isFinite(sample.value as number)
      )
      .map((sample) => {
        const rawValue = sample.value as number;
        const normalizedValue = config.normalize ? config.normalize(rawValue, sample.metric) : rawValue;
        if (!Number.isFinite(normalizedValue as number)) {
          return null;
        }
        return {
          metric: sample.metric,
          ts: Math.round(sample.ts),
          value: normalizedValue as number,
        };
      })
      .filter((sample): sample is { metric: string; ts: number; value: number } => Boolean(sample))
      .sort((a, b) => a.ts - b.ts);

    if (!normalizedPoints.length) {
      return;
    }

    const latest = normalizedPoints[normalizedPoints.length - 1];
    seriesList.push({
      key: config.key,
      metric: latest.metric,
      label: config.label || formatBluetoothMetricLabel(config.key),
      yLabel: config.yLabel || METRIC_UNITS[config.key],
      latestTs: latest.ts,
      latestValue: latest.value,
      latestValueLabel: config.formatValue
        ? config.formatValue(latest.value)
        : formatBluetoothMetricReading(config.key, latest.value),
      points: normalizedPoints.slice(-limit).map((point) => ({
        label: formatDate(new Date(point.ts).toISOString(), labelFormat),
        value: point.value,
      })),
    });
  });

  return seriesList.sort((a, b) => b.latestTs - a.latestTs);
}

function normalizeMetric(metric: string) {
  return String(metric || '').trim().toLowerCase();
}
