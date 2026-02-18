import { ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, PermissionsAndroid, NativeModules } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BleManager, Device, Subscription, State } from 'react-native-ble-plx';
import { encode as encodeBase64, decode as decodeBase64 } from 'base-64';
import { useSyncQueue } from './SyncProvider';

const CONFIG_KEY = 'msml.bluetooth.config';
const MAX_RECENT_SAMPLES = 120;

export type BluetoothProfileId = 'custom' | 'ble_hrm' | 'apple_watch_companion';

export interface BluetoothProfileOption {
  id: BluetoothProfileId;
  label: string;
  shortLabel: string;
  description: string;
  defaults: Pick<BluetoothConfig, 'serviceUUID' | 'characteristicUUID' | 'metric'>;
}

export const BLUETOOTH_PROFILE_OPTIONS: BluetoothProfileOption[] = [
  {
    id: 'custom',
    label: 'Custom peripheral',
    shortLabel: 'Custom',
    description: 'Use custom UUIDs and payload format from your BLE peripheral.',
    defaults: {
      serviceUUID: 'FFF0',
      characteristicUUID: 'FFF1',
      metric: 'sensor.glucose',
    },
  },
  {
    id: 'ble_hrm',
    label: 'BLE heart rate monitor',
    shortLabel: 'HR strap',
    description: 'Standard BLE Heart Rate profile (0x180D / 0x2A37).',
    defaults: {
      serviceUUID: '180D',
      characteristicUUID: '2A37',
      metric: 'exercise.hr',
    },
  },
  {
    id: 'apple_watch_companion',
    label: 'Apple Watch companion',
    shortLabel: 'Apple Watch',
    description: 'Use with a custom Watch companion that relays activity and sleep JSON payloads over BLE.',
    defaults: {
      serviceUUID: 'FFF0',
      characteristicUUID: 'FFF1',
      metric: 'exercise.hr',
    },
  },
];

const PROFILE_BY_ID: Record<BluetoothProfileId, BluetoothProfileOption> = BLUETOOTH_PROFILE_OPTIONS.reduce(
  (acc, profile) => {
    acc[profile.id] = profile;
    return acc;
  },
  {} as Record<BluetoothProfileId, BluetoothProfileOption>
);

const DEFAULT_CONFIG: BluetoothConfig = {
  profile: 'custom',
  serviceUUID: 'FFF0',
  characteristicUUID: 'FFF1',
  metric: 'sensor.glucose',
  autoUpload: true,
};

export interface BluetoothConfig {
  profile: BluetoothProfileId;
  serviceUUID: string;
  characteristicUUID: string;
  metric: string;
  autoUpload: boolean;
}

export interface BluetoothDeviceSummary {
  id: string;
  name?: string | null;
  rssi?: number | null;
}

export interface BluetoothSample {
  ts: number;
  metric: string;
  value: number | null;
  raw: string;
}

interface UploadStatus {
  status: 'sent' | 'queued';
  timestamp: number;
  message: string;
}

interface BluetoothContextValue {
  config: BluetoothConfig;
  profiles: BluetoothProfileOption[];
  applyProfile: (profileId: BluetoothProfileId) => void;
  updateConfig: (patch: Partial<BluetoothConfig>) => void;
  isPoweredOn: boolean;
  bluetoothState: State;
  status: 'idle' | 'scanning' | 'connecting' | 'connected' | 'error';
  isScanning: boolean;
  devices: BluetoothDeviceSummary[];
  connectedDevice: BluetoothDeviceSummary | null;
  lastSample: BluetoothSample | null;
  recentSamples: BluetoothSample[];
  lastUploadStatus: UploadStatus | null;
  error: string | null;
  startScan: () => Promise<void>;
  stopScan: () => void;
  connectToDevice: (deviceId: string) => Promise<void>;
  confirmSystemDevice: () => Promise<void>;
  disconnectFromDevice: () => Promise<void>;
  sendCommand: (payload: string) => Promise<void>;
  manualPublish: (value: number, metricOverride?: string) => Promise<void>;
}

const BluetoothContext = createContext<BluetoothContextValue | undefined>(undefined);

async function ensureAndroidPermissions() {
  if (Platform.OS !== 'android') {
    return true;
  }
  if (Platform.Version >= 31) {
    const result = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    ]);
    return Object.values(result).every((status) => status === PermissionsAndroid.RESULTS.GRANTED);
  }
  const status = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
  return status === PermissionsAndroid.RESULTS.GRANTED;
}

function normalizeUuid(value: string) {
  if (!value) return '';
  return value.trim().replace(/^0x/i, '').toUpperCase();
}

function normalizeMetricName(metric: unknown, fallback: string) {
  const value = String(metric ?? '').trim().toLowerCase();
  return value || fallback;
}

function normalizeProfile(profile: unknown): BluetoothProfileId {
  const value = String(profile ?? '').trim() as BluetoothProfileId;
  return value && PROFILE_BY_ID[value] ? value : 'custom';
}

function decodePayload(value: string | null) {
  if (!value) {
    return { text: '', binary: '' };
  }
  try {
    const binary = decodeBase64(value);
    let text = '';
    if (binary) {
      try {
        text = decodeURIComponent(
          binary
            .split('')
            .map((char: string) => `%${char.charCodeAt(0).toString(16).padStart(2, '0')}`)
            .join('')
        );
      } catch {
        text = '';
      }
    }
    return { text, binary };
  } catch (error) {
    return { text: '', binary: '' };
  }
}

function encodePayload(value: string) {
  if (!value) {
    return '';
  }
  const sanitized = encodeURIComponent(value).replace(/%([0-9A-F]{2})/g, (_, hex) =>
    String.fromCharCode(Number.parseInt(hex, 16))
  );
  return encodeBase64(sanitized);
}

type ParsedBatch = {
  metric: string;
  samples: Array<{ ts: number; value: number | null }>;
};

function parseTimestamp(value: unknown, fallback: number) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return Math.round(numeric);
  }
  const parsedDate = Date.parse(String(value));
  if (!Number.isNaN(parsedDate) && parsedDate > 0) {
    return Math.round(parsedDate);
  }
  return fallback;
}

function parseSampleValue(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function groupSample(
  target: Map<string, Array<{ ts: number; value: number | null }>>,
  metric: string,
  sample: { ts: number; value: number | null }
) {
  const list = target.get(metric) || [];
  list.push(sample);
  target.set(metric, list);
}

function mapGroupedSamples(groups: Map<string, Array<{ ts: number; value: number | null }>>) {
  return Array.from(groups.entries())
    .map(([metric, samples]) => ({
      metric,
      samples: samples.filter((sample) => Number.isFinite(sample.ts)),
    }))
    .filter((entry) => entry.samples.length);
}

function parseStandardPayload(rawText: string, fallbackMetric: string): ParsedBatch[] {
  const now = Date.now();
  if (!rawText || !rawText.trim()) {
    return [{ metric: fallbackMetric, samples: [{ ts: now, value: null }] }];
  }

  const trimmed = rawText.trim();
  let parsedJson = false;

  try {
    const parsed = JSON.parse(trimmed);
    parsedJson = true;
    if (Array.isArray(parsed)) {
      const grouped = new Map<string, Array<{ ts: number; value: number | null }>>();
      parsed.forEach((entry) => {
        if (entry && typeof entry === 'object') {
          const metric = normalizeMetricName((entry as any).metric, fallbackMetric);
          const ts = parseTimestamp((entry as any).ts ?? (entry as any).timestamp ?? (entry as any).time, now);
          const value = parseSampleValue((entry as any).value);
          groupSample(grouped, metric, { ts, value });
          return;
        }
        const value = parseSampleValue(entry);
        groupSample(grouped, fallbackMetric, { ts: now, value });
      });
      const groupedBatches = mapGroupedSamples(grouped);
      return groupedBatches;
    }

    if (parsed && typeof parsed === 'object') {
      const asObject = parsed as Record<string, unknown>;
      if (Array.isArray(asObject.samples)) {
        const grouped = new Map<string, Array<{ ts: number; value: number | null }>>();
        const topLevelMetric = normalizeMetricName(asObject.metric, fallbackMetric);
        asObject.samples.forEach((entry) => {
          if (entry && typeof entry === 'object') {
            const metric = normalizeMetricName((entry as any).metric, topLevelMetric);
            const ts = parseTimestamp((entry as any).ts ?? (entry as any).timestamp ?? (entry as any).time, now);
            const value = parseSampleValue((entry as any).value);
            groupSample(grouped, metric, { ts, value });
          }
        });
        const groupedBatches = mapGroupedSamples(grouped);
        return groupedBatches;
      }

      if ('value' in asObject || 'metric' in asObject) {
        const metric = normalizeMetricName(asObject.metric, fallbackMetric);
        const ts = parseTimestamp(asObject.ts ?? asObject.timestamp ?? asObject.time, now);
        const value = parseSampleValue(asObject.value);
        return [{ metric, samples: [{ ts, value }] }];
      }
      return [];
    }
  } catch {
    // payload is not JSON
  }

  if (parsedJson) {
    return [];
  }

  const numeric = Number(trimmed);
  return [{ metric: fallbackMetric, samples: [{ ts: now, value: Number.isFinite(numeric) ? numeric : null }] }];
}

function parseHeartRateMeasurement(binary: string) {
  if (!binary || binary.length < 2) {
    return null;
  }
  const bytes = binary.split('').map((char: string) => char.charCodeAt(0) & 0xff);
  if (bytes.length < 2) {
    return null;
  }
  const flags = bytes[0];
  const usesUint16 = (flags & 0x01) === 0x01;
  if (usesUint16) {
    if (bytes.length < 3) {
      return null;
    }
    return bytes[1] | (bytes[2] << 8);
  }
  return bytes[1];
}

function getMetricFromRecord(
  record: Record<string, unknown>,
  keys: string[]
): number | null | undefined {
  for (const key of keys) {
    if (!(key in record)) continue;
    const parsed = parseSampleValue(record[key]);
    return parsed;
  }
  return undefined;
}

function getDurationHoursFromRecord(
  record: Record<string, unknown>,
  hoursKeys: string[],
  minutesKeys: string[]
): number | null | undefined {
  const hoursValue = getMetricFromRecord(record, hoursKeys);
  if (hoursValue !== undefined) {
    return hoursValue;
  }
  const minutesValue = getMetricFromRecord(record, minutesKeys);
  if (minutesValue === undefined) {
    return undefined;
  }
  if (!Number.isFinite(minutesValue as number)) {
    return null;
  }
  return (minutesValue as number) / 60;
}

function getMetricFromRecords(
  records: Record<string, unknown>[],
  keys: string[]
): number | null | undefined {
  for (const record of records) {
    const parsed = getMetricFromRecord(record, keys);
    if (parsed !== undefined) {
      return parsed;
    }
  }
  return undefined;
}

function getDurationHoursFromRecords(
  records: Record<string, unknown>[],
  hoursKeys: string[],
  minutesKeys: string[]
): number | null | undefined {
  for (const record of records) {
    const parsed = getDurationHoursFromRecord(record, hoursKeys, minutesKeys);
    if (parsed !== undefined) {
      return parsed;
    }
  }
  return undefined;
}

function parseKnownWatchPayload(rawText: string): ParsedBatch[] {
  if (!rawText || !rawText.trim()) {
    return [];
  }
  try {
    const parsed = JSON.parse(rawText);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return [];
    }
    const now = Date.now();
    const payload = parsed as Record<string, unknown>;
    const nestedRecords = ['activity', 'exercise', 'workout', 'metrics', 'data']
      .map((key) => payload[key])
      .filter(
        (value): value is Record<string, unknown> =>
          Boolean(value) && typeof value === 'object' && !Array.isArray(value)
      );
    const records = [payload, ...nestedRecords];
    const timestampSource = records
      .map((record) => record.ts ?? record.timestamp ?? record.time ?? record.date)
      .find((value) => value !== undefined && value !== null && value !== '');
    const timestamp = parseTimestamp(timestampSource, now);
    const batches: ParsedBatch[] = [];

    const heartRate = getMetricFromRecords(records, [
      'heartRate',
      'heart_rate',
      'hr',
      'bpm',
      'currentHeartRate',
      'current_heart_rate',
      'averageHeartRate',
      'avgHeartRate',
    ]);
    if (heartRate !== undefined) {
      batches.push({ metric: 'exercise.hr', samples: [{ ts: timestamp, value: heartRate }] });
    }

    const distanceKm = getMetricFromRecords(records, [
      'distanceKm',
      'distance_km',
      'distanceKilometers',
      'distance_kilometers',
      'km',
    ]);
    const distanceMeters = getMetricFromRecords(records, ['distanceMeters', 'distance_m', 'distance_meters']);
    const distanceMiles = getMetricFromRecords(records, ['distanceMiles', 'distance_miles', 'mi']);

    let normalizedDistanceKm: number | null | undefined;
    if (distanceKm !== undefined) {
      normalizedDistanceKm = distanceKm;
    } else if (distanceMeters !== undefined) {
      normalizedDistanceKm = Number.isFinite(distanceMeters as number) ? (distanceMeters as number) / 1000 : null;
    } else if (distanceMiles !== undefined) {
      normalizedDistanceKm = Number.isFinite(distanceMiles as number) ? (distanceMiles as number) * 1.60934 : null;
    }
    if (normalizedDistanceKm !== undefined) {
      batches.push({ metric: 'exercise.distance', samples: [{ ts: timestamp, value: normalizedDistanceKm }] });
    }

    const paceSeconds = getMetricFromRecords(records, [
      'paceSecondsPerKm',
      'pace_sec_per_km',
      'paceSeconds',
      'pace_seconds',
      'secondsPerKm',
      'sec_per_km',
      'pace',
    ]);
    const speedMps = getMetricFromRecords(records, ['speedMps', 'speed_mps']);
    let normalizedPace: number | null | undefined;
    if (paceSeconds !== undefined) {
      normalizedPace = paceSeconds;
    } else if (speedMps !== undefined) {
      normalizedPace = Number.isFinite(speedMps as number) && (speedMps as number) > 0 ? 1000 / (speedMps as number) : null;
    }
    if (normalizedPace !== undefined) {
      batches.push({ metric: 'exercise.pace', samples: [{ ts: timestamp, value: normalizedPace }] });
    }

    const calories = getMetricFromRecords(records, [
      'activeCalories',
      'active_calories',
      'calories',
      'kcal',
      'energyKcal',
      'energy_kcal',
    ]);
    if (calories !== undefined) {
      batches.push({ metric: 'exercise.calories', samples: [{ ts: timestamp, value: calories }] });
    }

    const totalSleepHours = getDurationHoursFromRecords(
      records,
      ['sleepHours', 'sleep_hours', 'totalSleepHours', 'total_sleep_hours', 'asleepHours', 'asleep_hours'],
      ['sleepMinutes', 'sleep_minutes', 'totalSleepMinutes', 'total_sleep_minutes', 'asleepMinutes', 'asleep_minutes']
    );
    if (totalSleepHours !== undefined) {
      batches.push({ metric: 'sleep.total_hours', samples: [{ ts: timestamp, value: totalSleepHours }] });
    }

    const deepSleepHours = getDurationHoursFromRecords(
      records,
      ['deepSleepHours', 'deep_sleep_hours', 'sleepDeepHours', 'sleep_deep_hours', 'deepHours', 'deep_hours'],
      ['deepSleepMinutes', 'deep_sleep_minutes', 'sleepDeepMinutes', 'sleep_deep_minutes', 'deepMinutes', 'deep_minutes']
    );
    if (deepSleepHours !== undefined) {
      batches.push({ metric: 'sleep.deep_hours', samples: [{ ts: timestamp, value: deepSleepHours }] });
    }

    const remSleepHours = getDurationHoursFromRecords(
      records,
      ['remSleepHours', 'rem_sleep_hours', 'sleepRemHours', 'sleep_rem_hours', 'remHours', 'rem_hours'],
      ['remSleepMinutes', 'rem_sleep_minutes', 'sleepRemMinutes', 'sleep_rem_minutes', 'remMinutes', 'rem_minutes']
    );
    if (remSleepHours !== undefined) {
      batches.push({ metric: 'sleep.rem_hours', samples: [{ ts: timestamp, value: remSleepHours }] });
    }

    const lightSleepHours = getDurationHoursFromRecords(
      records,
      ['lightSleepHours', 'light_sleep_hours', 'sleepLightHours', 'sleep_light_hours', 'lightHours', 'light_hours'],
      [
        'lightSleepMinutes',
        'light_sleep_minutes',
        'sleepLightMinutes',
        'sleep_light_minutes',
        'lightMinutes',
        'light_minutes',
      ]
    );
    if (lightSleepHours !== undefined) {
      batches.push({ metric: 'sleep.light_hours', samples: [{ ts: timestamp, value: lightSleepHours }] });
    }

    const awakeHours = getDurationHoursFromRecords(
      records,
      ['awakeHours', 'awake_hours', 'wakeHours', 'wake_hours'],
      ['awakeMinutes', 'awake_minutes', 'wakeMinutes', 'wake_minutes']
    );
    if (awakeHours !== undefined) {
      batches.push({ metric: 'sleep.awake_hours', samples: [{ ts: timestamp, value: awakeHours }] });
    }

    return batches;
  } catch {
    return [];
  }
}

function mergeBatches(batches: ParsedBatch[]): ParsedBatch[] {
  const grouped = new Map<string, Array<{ ts: number; value: number | null }>>();
  batches.forEach((batch) => {
    const metric = normalizeMetricName(batch.metric, 'sensor.unknown');
    const current = grouped.get(metric) || [];
    current.push(...batch.samples);
    grouped.set(metric, current);
  });
  return mapGroupedSamples(grouped).map((entry) => ({
    metric: entry.metric,
    samples: entry.samples.sort((a, b) => a.ts - b.ts),
  }));
}

function parsePayloadBatches({
  rawText,
  binary,
  fallbackMetric,
  profile,
  characteristicUUID,
}: {
  rawText: string;
  binary: string;
  fallbackMetric: string;
  profile: BluetoothProfileId;
  characteristicUUID: string;
}) {
  const normalizedCharacteristic = normalizeUuid(characteristicUUID);

  if (profile === 'ble_hrm' && normalizedCharacteristic === '2A37') {
    const heartRate = parseHeartRateMeasurement(binary);
    if (heartRate !== null) {
      return [
        {
          metric: normalizeMetricName(fallbackMetric, 'exercise.hr'),
          samples: [{ ts: Date.now(), value: heartRate }],
        },
      ];
    }
  }

  const inferredWatchBatches = parseKnownWatchPayload(rawText);
  const standardBatches = parseStandardPayload(rawText, fallbackMetric);
  return mergeBatches([...inferredWatchBatches, ...standardBatches]);
}

export function BluetoothProvider({ children }: { children: ReactNode }) {
  const unsupportedMessage =
    Platform.OS === 'web'
      ? 'Bluetooth is not available in the web preview. Build a native app to test device syncing.'
      : 'Bluetooth features require a native build with the react-native-ble-plx module installed.';
  const isBleSupported = Platform.OS !== 'web' && !!NativeModules?.BlePlx;
  const managerRef = useRef<BleManager | null>(isBleSupported ? new BleManager() : null);
  const monitorRef = useRef<Subscription | null>(null);
  const disconnectRef = useRef<Subscription | null>(null);
  const connectedDeviceIdRef = useRef<string | null>(null);
  const devicesRef = useRef<Map<string, BluetoothDeviceSummary>>(new Map());
  const { runOrQueue } = useSyncQueue();

  const [config, setConfig] = useState<BluetoothConfig>(DEFAULT_CONFIG);
  const [isConfigReady, setIsConfigReady] = useState(false);
  const [status, setStatus] = useState<'idle' | 'scanning' | 'connecting' | 'connected' | 'error'>('idle');
  const [isScanning, setIsScanning] = useState(false);
  const [bluetoothState, setBluetoothState] = useState<State>(isBleSupported ? State.Unknown : State.Unsupported);
  const [devices, setDevices] = useState<BluetoothDeviceSummary[]>([]);
  const [connectedDevice, setConnectedDevice] = useState<BluetoothDeviceSummary | null>(null);
  const [lastSample, setLastSample] = useState<BluetoothSample | null>(null);
  const [recentSamples, setRecentSamples] = useState<BluetoothSample[]>([]);
  const [lastUploadStatus, setLastUploadStatus] = useState<UploadStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let canceled = false;
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(CONFIG_KEY);
        if (stored) {
          const parsed = JSON.parse(stored);
          if (!canceled) {
            setConfig((prev) => ({
              ...prev,
              ...parsed,
              profile: normalizeProfile(parsed?.profile),
              serviceUUID: normalizeUuid(parsed?.serviceUUID ?? prev.serviceUUID),
              characteristicUUID: normalizeUuid(parsed?.characteristicUUID ?? prev.characteristicUUID),
            }));
          }
        }
      } catch {
        // ignore errors
      } finally {
        if (!canceled) {
          setIsConfigReady(true);
        }
      }
    })();
    return () => {
      canceled = true;
    };
  }, []);

  useEffect(() => {
    if (!isConfigReady) return;
    AsyncStorage.setItem(CONFIG_KEY, JSON.stringify(config)).catch(() => {});
  }, [config, isConfigReady]);

  useEffect(() => {
    if (!managerRef.current) {
      setStatus('error');
      setError(unsupportedMessage);
      setBluetoothState(State.Unsupported);
      return;
    }
    const subscription = managerRef.current.onStateChange((nextState) => {
      setBluetoothState(nextState);
      if (nextState !== State.PoweredOn) {
        setIsScanning(false);
        setStatus('idle');
        setConnectedDevice(null);
        devicesRef.current.clear();
        setDevices([]);
      }
    }, true);
    return () => {
      subscription.remove();
    };
  }, [unsupportedMessage]);

  useEffect(() => {
    return () => {
      stopScan();
      monitorRef.current?.remove();
      disconnectRef.current?.remove();
      managerRef.current?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isPoweredOn = managerRef.current != null && bluetoothState === State.PoweredOn;

  const applyProfile = useCallback((profileId: BluetoothProfileId) => {
    const normalizedProfile = normalizeProfile(profileId);
    const preset = PROFILE_BY_ID[normalizedProfile];
    setConfig((prev) => ({
      ...prev,
      profile: normalizedProfile,
      serviceUUID: normalizeUuid(preset.defaults.serviceUUID),
      characteristicUUID: normalizeUuid(preset.defaults.characteristicUUID),
      metric: preset.defaults.metric,
    }));
  }, []);

  const updateConfig = useCallback((patch: Partial<BluetoothConfig>) => {
    const nextProfile = patch.profile ? normalizeProfile(patch.profile) : undefined;
    setConfig((prev) => ({
      ...prev,
      ...patch,
      profile: nextProfile ?? prev.profile,
      serviceUUID: normalizeUuid(patch.serviceUUID ?? prev.serviceUUID),
      characteristicUUID: normalizeUuid(patch.characteristicUUID ?? prev.characteristicUUID),
      metric: String(patch.metric ?? prev.metric).trim() || prev.metric,
    }));
  }, []);

  const handleCharacteristicValue = useCallback(
    async (value: string | null) => {
      if (!value) return;
      const { text, binary } = decodePayload(value);
      const parsedBatches = parsePayloadBatches({
        rawText: text,
        binary,
        fallbackMetric: config.metric,
        profile: config.profile,
        characteristicUUID: config.characteristicUUID,
      });
      if (!parsedBatches.length) {
        return;
      }
      const appendedSamples: BluetoothSample[] = parsedBatches
        .map((batch) => {
          const sanitized = batch.samples
            .map((sample) => ({
              ts: Number.isFinite(sample.ts) ? Math.round(sample.ts) : Date.now(),
              value: Number.isFinite(sample.value as number) ? (sample.value as number) : null,
            }))
            .filter((sample) => Number.isFinite(sample.ts));
          if (!sanitized.length) {
            return null;
          }
          const latest = sanitized[sanitized.length - 1];
          return {
            ts: latest.ts,
            value: latest.value,
            raw: text || '[binary]',
            metric: batch.metric,
          } as BluetoothSample;
        })
        .filter((sample): sample is BluetoothSample => Boolean(sample));

      if (!appendedSamples.length) {
        return;
      }

      const latestSample = appendedSamples.reduce((latest, sample) => (sample.ts >= latest.ts ? sample : latest));
      setLastSample(latestSample);
      setRecentSamples((prev) => {
        const next = [...prev, ...appendedSamples];
        if (next.length > MAX_RECENT_SAMPLES) {
          return next.slice(next.length - MAX_RECENT_SAMPLES);
        }
        return next;
      });
      if (!config.autoUpload) {
        return;
      }
      try {
        const uploadResults = await Promise.all(
          parsedBatches.map((batch) => {
            const sanitizedSamples = batch.samples
              .map((sample) => ({
                ts: Number.isFinite(sample.ts) ? Math.round(sample.ts) : Date.now(),
                value: Number.isFinite(sample.value as number) ? (sample.value as number) : null,
              }))
              .filter((sample) => Number.isFinite(sample.ts));
            if (!sanitizedSamples.length) {
              return Promise.resolve({ status: 'sent' as const });
            }
            return runOrQueue({
              endpoint: '/api/streams',
              payload: { metric: batch.metric, samples: sanitizedSamples },
              description: `Sensor sample (${batch.metric})`,
            });
          })
        );
        const queuedCount = uploadResults.filter((result) => result.status === 'queued').length;
        const sentCount = uploadResults.length - queuedCount;
        setLastUploadStatus({
          status: queuedCount > 0 ? 'queued' : 'sent',
          timestamp: Date.now(),
          message:
            queuedCount > 0
              ? `Uploaded ${sentCount} metric${sentCount === 1 ? '' : 's'}, queued ${queuedCount}.`
              : `Uploaded ${sentCount} metric${sentCount === 1 ? '' : 's'}.`,
        });
      } catch (uploadError) {
        setError(uploadError instanceof Error ? uploadError.message : 'Unable to upload sample.');
      }
    },
    [config.metric, config.autoUpload, config.profile, config.characteristicUUID, runOrQueue]
  );

  const stopScan = useCallback(() => {
    if (!managerRef.current) return;
    managerRef.current.stopDeviceScan();
    setIsScanning(false);
  }, []);

  const startScan = useCallback(async () => {
    if (!managerRef.current) {
      setError(unsupportedMessage);
      setStatus('error');
      return;
    }
    if (!isPoweredOn) {
      setError('Bluetooth is turned off.');
      return;
    }
    if (isScanning) return;
    const hasPermission = await ensureAndroidPermissions();
    if (!hasPermission) {
      setError('Bluetooth permissions are required.');
      return;
    }
    setStatus('scanning');
    setError(null);
    devicesRef.current.clear();
    setDevices([]);
    setIsScanning(true);
    const targetService = normalizeUuid(config.serviceUUID);
    managerRef.current.startDeviceScan(targetService ? [targetService] : null, null, (scanError, device) => {
      if (scanError) {
        setError(scanError.message);
        stopScan();
        setStatus('error');
        return;
      }
      if (!device) {
        return;
      }
      devicesRef.current.set(device.id, {
        id: device.id,
        name: device.name,
        rssi: device.rssi,
      });
      setDevices(Array.from(devicesRef.current.values()));
    });
  }, [config.serviceUUID, isPoweredOn, isScanning, stopScan, unsupportedMessage]);

  const disconnectFromDevice = useCallback(async () => {
    monitorRef.current?.remove();
    monitorRef.current = null;
    disconnectRef.current?.remove();
    disconnectRef.current = null;
    const deviceId = connectedDeviceIdRef.current;
    connectedDeviceIdRef.current = null;
    setConnectedDevice(null);
    setStatus('idle');
    if (!deviceId || !managerRef.current) {
      return;
    }
    try {
      await managerRef.current.cancelDeviceConnection(deviceId);
    } catch {
      // ignore disconnect errors
    }
  }, []);

  const performConnection = useCallback(
    async (deviceId: string, fallback?: BluetoothDeviceSummary | null) => {
      const manager = managerRef.current;
      if (!manager) {
        setError(unsupportedMessage);
        setStatus('error');
        return;
      }
      setStatus('connecting');
      setError(null);
      stopScan();
      monitorRef.current?.remove();
      disconnectRef.current?.remove();
      try {
        const normalizedService = normalizeUuid(config.serviceUUID);
        const normalizedCharacteristic = normalizeUuid(config.characteristicUUID);
        if (!normalizedService || !normalizedCharacteristic) {
          throw new Error('Enter the service and characteristic UUIDs before connecting.');
        }
        const connected = await manager.connectToDevice(deviceId, { autoConnect: true });
        const readyDevice = await connected.discoverAllServicesAndCharacteristics();
        connectedDeviceIdRef.current = readyDevice.id;
        setConnectedDevice({
          id: readyDevice.id,
          name: readyDevice.name || fallback?.name,
          rssi: readyDevice.rssi ?? fallback?.rssi,
        });
        disconnectRef.current = manager.onDeviceDisconnected(readyDevice.id, () => {
          connectedDeviceIdRef.current = null;
          setConnectedDevice(null);
          setStatus('idle');
        });
        monitorRef.current = readyDevice.monitorCharacteristicForService(
          normalizedService,
          normalizedCharacteristic,
          (monitorError, characteristic) => {
            if (monitorError) {
              setError(monitorError.message);
              setStatus('error');
              return;
            }
            if (characteristic?.value) {
              handleCharacteristicValue(characteristic.value);
            }
          }
        );
        setStatus('connected');
      } catch (connectionError) {
        connectedDeviceIdRef.current = null;
        setConnectedDevice(null);
        setStatus('error');
        setError(connectionError instanceof Error ? connectionError.message : 'Unable to connect to device.');
      }
    },
    [config.characteristicUUID, config.serviceUUID, handleCharacteristicValue, stopScan, unsupportedMessage]
  );

  const connectToDevice = useCallback(
    async (deviceId: string) => {
      if (!isPoweredOn) {
        setError('Bluetooth is not ready.');
        return;
      }
      await performConnection(deviceId);
    },
    [isPoweredOn, performConnection]
  );

  const confirmSystemDevice = useCallback(async () => {
    if (!isPoweredOn) {
      setError('Bluetooth is not ready.');
      return;
    }
    const manager = managerRef.current;
    if (!manager) {
      setStatus('error');
      setError(unsupportedMessage);
      return;
    }
    const normalizedService = normalizeUuid(config.serviceUUID);
    if (!normalizedService) {
      setError('Enter the service UUID in the configuration card before confirming the connection.');
      return;
    }
    try {
      const paired = await manager.connectedDevices([normalizedService]);
      if (!paired.length) {
        if (config.profile === 'apple_watch_companion') {
          throw new Error(
            'No Apple Watch companion peripheral detected. Apple Watch is not directly discoverable in most iOS BLE flows; use a companion app that advertises as a BLE peripheral, then pair and retry.'
          );
        }
        throw new Error(
          'No paired device detected. Pair it in system Bluetooth settings, keep it awake, then try again.'
        );
      }
      const candidate = paired[0];
      await performConnection(candidate.id, {
        id: candidate.id,
        name: candidate.name,
        rssi: candidate.rssi,
      });
    } catch (confirmError) {
      setStatus('error');
      setError(
        confirmError instanceof Error ? confirmError.message : 'Unable to confirm the existing Bluetooth connection.'
      );
    }
  }, [config.serviceUUID, config.profile, isPoweredOn, performConnection, unsupportedMessage]);

  const sendCommand = useCallback(
    async (payload: string) => {
      if (!connectedDeviceIdRef.current) {
        throw new Error('Connect to a device before sending commands.');
      }
      const normalizedService = normalizeUuid(config.serviceUUID);
      const normalizedCharacteristic = normalizeUuid(config.characteristicUUID);
      const encoded = encodePayload(payload);
      const manager = managerRef.current;
      if (!manager) {
        throw new Error(unsupportedMessage);
      }
      try {
        await manager.writeCharacteristicWithResponseForDevice(
          connectedDeviceIdRef.current,
          normalizedService,
          normalizedCharacteristic,
          encoded
        );
        return;
      } catch (withResponseError) {
        try {
          await manager.writeCharacteristicWithoutResponseForDevice(
            connectedDeviceIdRef.current,
            normalizedService,
            normalizedCharacteristic,
            encoded
          );
          return;
        } catch (withoutResponseError) {
          const primaryMessage =
            withResponseError instanceof Error ? withResponseError.message : 'write with response failed';
          const fallbackMessage =
            withoutResponseError instanceof Error ? withoutResponseError.message : 'write without response failed';
          throw new Error(`Unable to send command. ${primaryMessage}; fallback failed: ${fallbackMessage}.`);
        }
      }
    },
    [config.serviceUUID, config.characteristicUUID, unsupportedMessage]
  );

  const manualPublish = useCallback(
    async (value: number, metricOverride?: string) => {
      const metric = (metricOverride || config.metric || '').trim() || config.metric;
      const sampleValue = Number(value);
      if (!Number.isFinite(sampleValue)) {
        throw new Error('Enter a numeric value to publish.');
      }
      try {
        const result = await runOrQueue({
          endpoint: '/api/streams',
          payload: { metric, samples: [{ ts: Date.now(), value: sampleValue }] },
          description: `Manual sample (${metric})`,
        });
        setLastUploadStatus({
          status: result.status,
          timestamp: Date.now(),
          message: result.status === 'sent' ? 'Manual sample uploaded.' : 'Manual sample queued offline.',
        });
      } catch (uploadError) {
        setError(uploadError instanceof Error ? uploadError.message : 'Unable to publish sample.');
      }
    },
    [config.metric, runOrQueue]
  );

  const value = useMemo(
    () => ({
      config,
      profiles: BLUETOOTH_PROFILE_OPTIONS,
      applyProfile,
      updateConfig,
      isPoweredOn,
      bluetoothState,
      status,
      isScanning,
      devices,
      connectedDevice,
      lastSample,
      recentSamples,
      lastUploadStatus,
      error,
      startScan,
      stopScan,
      connectToDevice,
      confirmSystemDevice,
      disconnectFromDevice,
      sendCommand,
      manualPublish,
    }),
    [
      config,
      applyProfile,
      updateConfig,
      isPoweredOn,
      bluetoothState,
      status,
      isScanning,
      devices,
      connectedDevice,
      lastSample,
      recentSamples,
      lastUploadStatus,
      error,
      startScan,
      stopScan,
      connectToDevice,
      confirmSystemDevice,
      disconnectFromDevice,
      sendCommand,
      manualPublish,
    ]
  );

  return <BluetoothContext.Provider value={value}>{children}</BluetoothContext.Provider>;
}

export function useBluetooth() {
  const context = useContext(BluetoothContext);
  if (!context) {
    throw new Error('useBluetooth must be used within a BluetoothProvider');
  }
  return context;
}
