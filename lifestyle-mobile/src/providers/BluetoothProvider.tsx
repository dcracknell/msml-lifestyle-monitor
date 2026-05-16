import { ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, PermissionsAndroid, NativeModules } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BleErrorCode, BleManager, Device, Subscription, State } from 'react-native-ble-plx';
import { encode as encodeBase64, decode as decodeBase64 } from 'base-64';
import { useSyncQueue } from './SyncProvider';

const CONFIG_KEY = 'msml.bluetooth.config';
const MAX_RECENT_SAMPLES = 120;
const ANDROID_CONNECTION_TIMEOUT_MS = 15_000;
const MAX_TRANSPORT_TEXT_PREVIEW_CHARS = 180;
const MAX_TRANSPORT_HEX_PREVIEW_BYTES = 24;
const HM10_LINK_CHECK_TIMEOUT_MS = 4_500;
const HM10_LINK_ACK_METRIC = 'sensor.hm10_link_ack';
const HM10_LINK_PROBE_METRIC = 'sensor.hm10_link_probe';
export const HM10_BAUD_RATE_OPTIONS = [1200, 2400, 4800, 9600, 19_200, 38_400, 57_600, 115_200] as const;
export const HM10_UNO_SOFTWARESERIAL_MAX_BAUD = 38_400;
export type Hm10BaudRate = (typeof HM10_BAUD_RATE_OPTIONS)[number];
const DEFAULT_HM10_BAUD_RATE: Hm10BaudRate = 9600;

export function isHm10UnoCautionBaudRate(value: number) {
  return Number.isFinite(value) && value > HM10_UNO_SOFTWARESERIAL_MAX_BAUD;
}

export type BluetoothProfileId = 'custom' | 'ble_hrm' | 'apple_watch_companion' | 'arduino_hm10';

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
  {
    id: 'arduino_hm10',
    label: 'Arduino + HM-10',
    shortLabel: 'Arduino',
    description: 'Arduino Uno with HM-10 BLE module sending multi-sensor JSON metric packets.',
    defaults: {
      serviceUUID: 'FFE0',
      characteristicUUID: 'FFE1',
      metric: 'sensor.aht20_temperature_c',
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
  hm10BaudRate: DEFAULT_HM10_BAUD_RATE,
  autoUpload: true,
};

export interface BluetoothConfig {
  profile: BluetoothProfileId;
  serviceUUID: string;
  characteristicUUID: string;
  metric: string;
  hm10BaudRate: Hm10BaudRate;
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

export type BluetoothTransportOutcome =
  | 'idle'
  | 'parsed'
  | 'buffering'
  | 'binary_only'
  | 'overflow'
  | 'empty'
  | 'unparsed';

export interface BluetoothTransportDebug {
  lastNotificationTs: number | null;
  lastNotificationBytes: number;
  lastNotificationText: string | null;
  lastNotificationHex: string | null;
  totalNotifications: number;
  totalBytes: number;
  lineBufferLength: number;
  parseIssueCount: number;
  lastOutcome: BluetoothTransportOutcome;
}

export type BluetoothLinkGuardStatus = 'idle' | 'checking' | 'verified' | 'failed';

export interface BluetoothLinkGuard {
  status: BluetoothLinkGuardStatus;
  lastCheckStartedTs: number | null;
  lastCheckFinishedTs: number | null;
  lastVerifiedTs: number | null;
  lastProbeTs: number | null;
  lastAckTs: number | null;
  pendingAckValue: number | null;
  lastAckValue: number | null;
  message: string | null;
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
  transportDebug: BluetoothTransportDebug;
  hm10LinkGuard: BluetoothLinkGuard;
  lastUploadStatus: UploadStatus | null;
  error: string | null;
  startScan: () => Promise<void>;
  stopScan: () => void;
  connectToDevice: (deviceId: string) => Promise<void>;
  confirmSystemDevice: () => Promise<void>;
  disconnectFromDevice: () => Promise<void>;
  sendCommand: (payload: string) => Promise<void>;
  applyHm10BaudRate: (baudOverride?: number) => Promise<Hm10BaudRate>;
  verifyHm10Link: () => Promise<number>;
  manualPublish: (
    value: number,
    metricOverride?: string,
    options?: { localDate?: string; skipWorkoutMirror?: boolean }
  ) => Promise<void>;
  setWorkoutMirrorSuppressed: (suppressed: boolean) => void;
}

const BluetoothContext = createContext<BluetoothContextValue | undefined>(undefined);

const DEFAULT_TRANSPORT_DEBUG: BluetoothTransportDebug = {
  lastNotificationTs: null,
  lastNotificationBytes: 0,
  lastNotificationText: null,
  lastNotificationHex: null,
  totalNotifications: 0,
  totalBytes: 0,
  lineBufferLength: 0,
  parseIssueCount: 0,
  lastOutcome: 'idle',
};

const DEFAULT_HM10_LINK_GUARD: BluetoothLinkGuard = {
  status: 'idle',
  lastCheckStartedTs: null,
  lastCheckFinishedTs: null,
  lastVerifiedTs: null,
  lastProbeTs: null,
  lastAckTs: null,
  pendingAckValue: null,
  lastAckValue: null,
  message: null,
};

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

// Expands a 4-char (16-bit) or 8-char (32-bit) short UUID to the full
// 128-bit Bluetooth base UUID that the BLE platform APIs require.
// Full UUIDs are returned unchanged.  Used only at BLE API call sites –
// the stored config values stay in short form so the UI stays readable.
const BLE_BASE_SUFFIX = '-0000-1000-8000-00805F9B34FB';
export function expandUuid(value: string): string {
  const n = normalizeUuid(value);
  if (!n) return n;
  if (/^[0-9A-F]{4}$/.test(n)) return `0000${n}${BLE_BASE_SUFFIX}`;
  if (/^[0-9A-F]{8}$/.test(n)) return `${n}${BLE_BASE_SUFFIX}`;
  return n;
}

type CharacteristicLookupDevice = {
  characteristicsForService: (serviceUUID: string) => Promise<Array<{ uuid: string }>>;
};

type ConnectionUuidCandidate = {
  serviceUUID: string;
  characteristicUUID: string;
};

const KNOWN_SERVICE_CHARACTERISTICS: Record<string, string> = {
  '180D': '2A37',
  'FFE0': 'FFE1',
  'FFF0': 'FFF1',
};

const HM10_UUID_VARIANTS: ConnectionUuidCandidate[] = [
  { serviceUUID: 'FFE0', characteristicUUID: 'FFE1' },
  { serviceUUID: 'FFF0', characteristicUUID: 'FFF1' },
];

function looksLikeHm10Device(name?: string | null) {
  return /hmsoft|bt05|hm-?10|cc41|jdy-?08|mlt-bt05/i.test(String(name ?? ''));
}

async function lookupCharacteristicUuids(
  device: CharacteristicLookupDevice,
  serviceUUID: string
): Promise<string[] | null> {
  try {
    const chars = await device.characteristicsForService(expandUuid(serviceUUID));
    return chars.map((char) => expandUuid(char.uuid));
  } catch {
    return null;
  }
}

function buildConnectionRecoveryCandidates({
  profile,
  serviceUUID,
  characteristicUUID,
  deviceName,
}: {
  profile: BluetoothProfileId;
  serviceUUID: string;
  characteristicUUID: string;
  deviceName?: string | null;
}) {
  const candidates: ConnectionUuidCandidate[] = [];
  const seen = new Set<string>();
  const addCandidate = (candidate: ConnectionUuidCandidate) => {
    const key = `${candidate.serviceUUID}:${candidate.characteristicUUID}`;
    if (seen.has(key)) return;
    if (candidate.serviceUUID === serviceUUID && candidate.characteristicUUID === characteristicUUID) return;
    seen.add(key);
    candidates.push(candidate);
  };

  const expectedCharacteristic = KNOWN_SERVICE_CHARACTERISTICS[serviceUUID];
  if (expectedCharacteristic && expectedCharacteristic !== characteristicUUID) {
    addCandidate({ serviceUUID, characteristicUUID: expectedCharacteristic });
  }

  const shouldProbeHm10Variants =
    profile === 'arduino_hm10' ||
    looksLikeHm10Device(deviceName) ||
    serviceUUID === 'FFE0' ||
    serviceUUID === 'FFF0';

  if (shouldProbeHm10Variants) {
    HM10_UUID_VARIANTS.forEach(addCandidate);
  }

  return candidates;
}

function buildPairedDeviceServiceCandidates({
  profile,
  serviceUUID,
}: {
  profile: BluetoothProfileId;
  serviceUUID: string;
}) {
  const candidates: string[] = [];
  const seen = new Set<string>();
  const addCandidate = (candidate: string) => {
    const normalized = normalizeUuid(candidate);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    candidates.push(normalized);
  };

  addCandidate(serviceUUID);

  const shouldProbeHm10Variants =
    profile === 'arduino_hm10' ||
    serviceUUID === 'FFE0' ||
    serviceUUID === 'FFF0';

  if (shouldProbeHm10Variants) {
    HM10_UUID_VARIANTS.forEach((candidate) => addCandidate(candidate.serviceUUID));
  }

  return candidates;
}

function inferRecoveredProfile({
  currentProfile,
  serviceUUID,
  characteristicUUID,
  deviceName,
}: {
  currentProfile: BluetoothProfileId;
  serviceUUID: string;
  characteristicUUID: string;
  deviceName?: string | null;
}): BluetoothProfileId {
  if (serviceUUID === '180D' && characteristicUUID === '2A37') {
    return 'ble_hrm';
  }
  if (serviceUUID === 'FFE0' && characteristicUUID === 'FFE1') {
    return 'arduino_hm10';
  }
  if (serviceUUID === 'FFF0' && characteristicUUID === 'FFF1') {
    if (currentProfile === 'apple_watch_companion') {
      return 'apple_watch_companion';
    }
    if (currentProfile === 'ble_hrm' || currentProfile === 'arduino_hm10' || looksLikeHm10Device(deviceName)) {
      return 'arduino_hm10';
    }
  }
  return currentProfile;
}

function normalizeMetricName(metric: unknown, fallback: string) {
  const value = String(metric ?? '').trim().toLowerCase();
  return value || fallback;
}

function normalizeProfile(profile: unknown): BluetoothProfileId {
  const value = String(profile ?? '').trim() as BluetoothProfileId;
  return value && PROFILE_BY_ID[value] ? value : 'custom';
}

function normalizeHm10BaudRate(value: unknown): Hm10BaudRate {
  const parsed = Number(value);
  return HM10_BAUD_RATE_OPTIONS.includes(parsed as Hm10BaudRate)
    ? (parsed as Hm10BaudRate)
    : DEFAULT_HM10_BAUD_RATE;
}

function buildHm10BaudCommand(baud: Hm10BaudRate) {
  return `HM10:BAUD=${baud}\n`;
}

function buildHm10PingCommand(token: number) {
  return `HM10:PING=${token}\n`;
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

function previewTransportText(text: string) {
  if (!text) return null;
  const escaped = text
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/[^\x20-\x7E]/g, (char) => `\\x${char.charCodeAt(0).toString(16).padStart(2, '0')}`);
  if (!escaped) return null;
  return escaped.length > MAX_TRANSPORT_TEXT_PREVIEW_CHARS
    ? `${escaped.slice(0, MAX_TRANSPORT_TEXT_PREVIEW_CHARS - 3)}...`
    : escaped;
}

function previewTransportHex(binary: string) {
  if (!binary) return null;
  const bytes = binary.split('').map((char) => char.charCodeAt(0) & 0xff);
  if (!bytes.length) return null;
  const preview = bytes
    .slice(0, MAX_TRANSPORT_HEX_PREVIEW_BYTES)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join(' ');
  return bytes.length > MAX_TRANSPORT_HEX_PREVIEW_BYTES ? `${preview} ...` : preview;
}

function isBleOperationCancelledError(error: unknown) {
  if (typeof error === 'string') {
    return /operation\s+was\s+cancelled|operation\s+cancell?ed/i.test(error);
  }
  if (!error || typeof error !== 'object') {
    return false;
  }
  const maybeBleError = error as { errorCode?: number; message?: string; reason?: string };
  if (maybeBleError.errorCode === BleErrorCode.OperationCancelled) {
    return true;
  }
  const message = String(maybeBleError.message ?? '');
  const reason = String(maybeBleError.reason ?? '');
  return /operation\s+was\s+cancelled|operation\s+cancell?ed/i.test(`${message} ${reason}`);
}

function normalizeConnectionError(error: unknown) {
  if (isBleOperationCancelledError(error)) {
    return 'Bluetooth connection was interrupted before setup completed. Retry with the device awake and nearby.';
  }
  return error instanceof Error ? error.message : 'Unable to connect to device.';
}

function buildConnectionOptions() {
  if (Platform.OS !== 'android') {
    return undefined;
  }
  return {
    autoConnect: false,
    timeout: ANDROID_CONNECTION_TIMEOUT_MS,
  };
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
    return [];
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
  if (Number.isFinite(numeric)) {
    return [{ metric: fallbackMetric, samples: [{ ts: now, value: numeric }] }];
  }

  return [];
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

// ---------------------------------------------------------------------------
// Physiological range validation
// Returns null (drops the sample) when a known metric carries an impossible
// value, preventing corrupt readings from polluting the database.
// ---------------------------------------------------------------------------

const METRIC_RANGES: Record<string, [number, number]> = {
  'vitals.heart_rate':  [20,  300],
  'vitals.resting_hr':  [20,  300],
  'exercise.hr':        [20,  300],
  'exercise.max_hr':    [20,  300],
  'vitals.spo2':        [50,  100],
  'vitals.hrv':         [1,   300],
  'vitals.glucose':     [1,    60],
  'body.weight_kg':     [10,  500],
  'phone.steps':        [0,  200000],
  'vitals.systolic_bp': [40,  300],
  'vitals.diastolic_bp':[20,  200],
};

export function validateMetricValue(metric: string, value: number): number | null {
  const range = METRIC_RANGES[metric];
  if (!range) return value;
  const [min, max] = range;
  if (value < min || value > max) {
    console.warn(
      `[BLE] ${metric} value ${value} outside physiological range [${min}, ${max}] – dropped.`
    );
    return null;
  }
  return value;
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
  // Accumulates BLE notification chunks for UART-based sensors (Arduino + HM-10)
  // until a newline is received, at which point the complete JSON line is parsed.
  const lineBufferRef = useRef<string>('');
  const transportDebugRef = useRef<BluetoothTransportDebug>(DEFAULT_TRANSPORT_DEBUG);
  const hm10LinkSequenceRef = useRef(1);
  const pendingHm10LinkCheckRef = useRef<{
    token: number;
    startedAt: number;
    notificationCountAtStart: number;
    timeoutHandle: ReturnType<typeof setTimeout>;
    resolve: (token: number) => void;
    reject: (error: Error) => void;
    promise: Promise<number>;
  } | null>(null);
  const { runOrQueue } = useSyncQueue();

  const [config, setConfig] = useState<BluetoothConfig>(DEFAULT_CONFIG);
  const configRef = useRef<BluetoothConfig>(DEFAULT_CONFIG);
  const [isConfigReady, setIsConfigReady] = useState(false);
  const [status, setStatus] = useState<'idle' | 'scanning' | 'connecting' | 'connected' | 'error'>('idle');
  const [isScanning, setIsScanning] = useState(false);
  const [bluetoothState, setBluetoothState] = useState<State>(isBleSupported ? State.Unknown : State.Unsupported);
  const [devices, setDevices] = useState<BluetoothDeviceSummary[]>([]);
  const [connectedDevice, setConnectedDevice] = useState<BluetoothDeviceSummary | null>(null);
  const [lastSample, setLastSample] = useState<BluetoothSample | null>(null);
  const [recentSamples, setRecentSamples] = useState<BluetoothSample[]>([]);
  const [transportDebug, setTransportDebug] = useState<BluetoothTransportDebug>(DEFAULT_TRANSPORT_DEBUG);
  const [hm10LinkGuard, setHm10LinkGuard] = useState<BluetoothLinkGuard>(DEFAULT_HM10_LINK_GUARD);
  const [lastUploadStatus, setLastUploadStatus] = useState<UploadStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const suppressWorkoutMirrorRef = useRef(false);
  const connectionAttemptIdRef = useRef(0);

  const clearPendingHm10LinkCheck = useCallback((message: string) => {
    const pending = pendingHm10LinkCheckRef.current;
    if (!pending) {
      return;
    }
    clearTimeout(pending.timeoutHandle);
    pendingHm10LinkCheckRef.current = null;
    pending.reject(new Error(message));
  }, []);

  const resetHm10LinkGuard = useCallback((message?: string) => {
    if (message) {
      clearPendingHm10LinkCheck(message);
    }
    setHm10LinkGuard(DEFAULT_HM10_LINK_GUARD);
  }, [clearPendingHm10LinkCheck]);

  useEffect(() => {
    transportDebugRef.current = transportDebug;
  }, [transportDebug]);

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
              hm10BaudRate: normalizeHm10BaudRate(parsed?.hm10BaudRate),
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
    configRef.current = config;
  }, [config]);

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
        transportDebugRef.current = DEFAULT_TRANSPORT_DEBUG;
        setTransportDebug(DEFAULT_TRANSPORT_DEBUG);
        resetHm10LinkGuard('Bluetooth powered off during HM-10 link verification.');
        devicesRef.current.clear();
        setDevices([]);
      }
    }, true);
    return () => {
      subscription.remove();
    };
  }, [resetHm10LinkGuard, unsupportedMessage]);

  useEffect(() => {
    return () => {
      stopScan();
      clearPendingHm10LinkCheck('Bluetooth provider unmounted during HM-10 link verification.');
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
    setConfig((prev) => {
      const nextConfig: BluetoothConfig = {
        ...prev,
        profile: normalizedProfile,
        serviceUUID: normalizeUuid(preset.defaults.serviceUUID),
        characteristicUUID: normalizeUuid(preset.defaults.characteristicUUID),
        metric: preset.defaults.metric,
        hm10BaudRate:
          normalizedProfile === 'arduino_hm10'
            ? normalizeHm10BaudRate(prev.hm10BaudRate)
            : prev.hm10BaudRate,
      };
      configRef.current = nextConfig;
      return nextConfig;
    });
  }, []);

  const updateConfig = useCallback((patch: Partial<BluetoothConfig>) => {
    const nextProfile = patch.profile ? normalizeProfile(patch.profile) : undefined;
    setConfig((prev) => {
      const nextConfig: BluetoothConfig = {
        ...prev,
        ...patch,
        profile: nextProfile ?? prev.profile,
        serviceUUID: normalizeUuid(patch.serviceUUID ?? prev.serviceUUID),
        characteristicUUID: normalizeUuid(patch.characteristicUUID ?? prev.characteristicUUID),
        metric: String(patch.metric ?? prev.metric).trim() || prev.metric,
        hm10BaudRate: normalizeHm10BaudRate(patch.hm10BaudRate ?? prev.hm10BaudRate),
      };
      configRef.current = nextConfig;
      return nextConfig;
    });
  }, []);

  const setWorkoutMirrorSuppressed = useCallback((suppressed: boolean) => {
    suppressWorkoutMirrorRef.current = suppressed;
  }, []);

  const shouldSkipWorkoutMirror = useCallback((metric: string) => {
    return suppressWorkoutMirrorRef.current && normalizeMetricName(metric, '').startsWith('exercise.');
  }, []);

  const handleCharacteristicValue = useCallback(
    async (value: string | null) => {
      if (!value) return;
      const activeConfig = configRef.current;
      const { text, binary } = decodePayload(value);
      const receivedAt = Date.now();
      const receivedBytes = binary.length;
      const textPreview = previewTransportText(text);
      const hexPreview = previewTransportHex(binary);
      let parsedAny = false;

      const commitTransportDebug = (
        outcome: BluetoothTransportOutcome,
        options?: { lineBufferLength?: number; incrementIssue?: boolean }
      ) => {
        setTransportDebug((prev) => {
          const next = {
            lastNotificationTs: receivedAt,
            lastNotificationBytes: receivedBytes,
            lastNotificationText: textPreview,
            lastNotificationHex: hexPreview,
            totalNotifications: prev.totalNotifications + 1,
            totalBytes: prev.totalBytes + receivedBytes,
            lineBufferLength: options?.lineBufferLength ?? prev.lineBufferLength,
            parseIssueCount: prev.parseIssueCount + (options?.incrementIssue ? 1 : 0),
            lastOutcome: outcome,
          };
          transportDebugRef.current = next;
          return next;
        });
      };

      // Inner helper: process a fully-assembled payload string.
      async function processBatches(rawText: string, rawBinary: string) {
        const parsedBatches = parsePayloadBatches({
          rawText,
          binary: rawBinary,
          fallbackMetric: activeConfig.metric,
          profile: activeConfig.profile,
          characteristicUUID: activeConfig.characteristicUUID,
        });
        if (!parsedBatches.length) return;
        parsedAny = true;

        const visibleBatches = parsedBatches.filter((batch) => {
          if (batch.metric === HM10_LINK_PROBE_METRIC) {
            const latestProbe = batch.samples[batch.samples.length - 1];
            if (latestProbe) {
              setHm10LinkGuard((prev) => ({
                ...prev,
                lastProbeTs: latestProbe.ts,
                message:
                  prev.status === 'idle' && !prev.message
                    ? 'Arduino stream probe packets are reaching the app.'
                    : prev.message,
              }));
            }
            return true;
          }

          if (batch.metric !== HM10_LINK_ACK_METRIC) {
            return true;
          }

          const latestAck = batch.samples[batch.samples.length - 1];
          const ackTs = latestAck?.ts ?? Date.now();
          const ackValue =
            latestAck && Number.isFinite(latestAck.value as number)
              ? Math.round(latestAck.value as number)
              : null;

          setHm10LinkGuard((prev) => ({
            ...prev,
            lastAckTs: ackTs,
            lastAckValue: ackValue,
          }));

          const pending = pendingHm10LinkCheckRef.current;
          if (pending && ackValue !== null && ackValue === pending.token) {
            clearTimeout(pending.timeoutHandle);
            pendingHm10LinkCheckRef.current = null;
            setHm10LinkGuard((prev) => ({
              ...prev,
              status: 'verified',
              lastAckTs: ackTs,
              lastAckValue: ackValue,
              lastCheckFinishedTs: Date.now(),
              lastVerifiedTs: Date.now(),
              pendingAckValue: null,
              message: 'Bidirectional HM-10 link verified. The app can write commands and the Arduino can stream back.',
            }));
            pending.resolve(ackValue);
          }
          return false;
        });

        const appendedSamples: BluetoothSample[] = visibleBatches
          .map((batch) => {
            const sanitized = batch.samples
              .map((sample) => ({
                ts: Number.isFinite(sample.ts) ? Math.round(sample.ts) : Date.now(),
                value: Number.isFinite(sample.value as number) ? (sample.value as number) : null,
              }))
              .filter((sample) => Number.isFinite(sample.ts));
            if (!sanitized.length) return null;
            const latest = sanitized[sanitized.length - 1];
            return {
              ts: latest.ts,
              value: latest.value,
              raw: rawText || '[binary]',
              metric: batch.metric,
            } as BluetoothSample;
          })
          .filter((sample): sample is BluetoothSample => Boolean(sample));

        if (!appendedSamples.length) return;

        const latestSample = appendedSamples.reduce((latest, sample) =>
          sample.ts >= latest.ts ? sample : latest
        );
        setLastSample(latestSample);
        setRecentSamples((prev) => {
          const next = [...prev, ...appendedSamples];
          return next.length > MAX_RECENT_SAMPLES ? next.slice(next.length - MAX_RECENT_SAMPLES) : next;
        });

        if (!activeConfig.autoUpload) return;
        try {
          const uploadResults = await Promise.all(
            visibleBatches.map((batch) => {
              const sanitizedSamples = batch.samples
                .map((sample) => ({
                  ts: Number.isFinite(sample.ts) ? Math.round(sample.ts) : Date.now(),
                  value: Number.isFinite(sample.value as number)
                    ? validateMetricValue(batch.metric, sample.value as number)
                    : null,
                }))
                .filter((sample) => Number.isFinite(sample.ts));
              if (!sanitizedSamples.length) return Promise.resolve({ status: 'sent' as const });
              return runOrQueue({
                endpoint: '/api/streams',
                payload: {
                  metric: batch.metric,
                  skipWorkoutMirror: shouldSkipWorkoutMirror(batch.metric),
                  samples: sanitizedSamples,
                },
                description: `Sensor sample (${batch.metric})`,
              });
            })
          );
          const queuedCount = uploadResults.filter((r) => r.status === 'queued').length;
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
      }

      // BLE Heart Rate Monitor uses a binary protocol where each notification
      // is self-contained – parse immediately without line buffering.
      if (activeConfig.profile === 'ble_hrm') {
        await processBatches(text, binary);
        commitTransportDebug(
          parsedAny ? 'parsed' : receivedBytes > 0 ? 'binary_only' : 'empty',
          { lineBufferLength: 0, incrementIssue: !parsedAny && receivedBytes > 0 }
        );
        return;
      }

      if (!text && receivedBytes > 0) {
        commitTransportDebug('binary_only', {
          lineBufferLength: lineBufferRef.current.length,
          incrementIssue: true,
        });
        return;
      }

      // For UART-based sensors (Arduino + HM-10) and watch companions, the
      // JSON payload may be fragmented across multiple 20-byte BLE packets.
      // Accumulate text chunks in a line buffer and parse only complete lines
      // (terminated by '\n') to avoid partial-JSON parse errors.
      lineBufferRef.current += text;

      // Overflow guard: a valid JSON line from the Arduino mock is under 100 bytes.
      // If the buffer grows beyond 512 chars without a newline, the HM-10 is
      // sending garbled data (noise, baud mismatch). Discard and log.
      if (lineBufferRef.current.length > 512) {
        console.warn(
          '[BLE] Line buffer overflow (' + lineBufferRef.current.length + ' chars) – discarding. ' +
          'Check HM-10 baud rate and UUID configuration.'
        );
        lineBufferRef.current = '';
        commitTransportDebug('overflow', { lineBufferLength: 0, incrementIssue: true });
        return;
      }

      const lines = lineBufferRef.current.split('\n');
      // Everything after the last '\n' is an incomplete line – keep it buffered.
      lineBufferRef.current = lines.pop() ?? '';
      let sawCompleteLine = false;

      for (const rawLine of lines) {
        const trimmedLine = rawLine.replace(/\r$/, '').trim();
        if (!trimmedLine) continue;
        sawCompleteLine = true;
        await processBatches(trimmedLine, '');
      }

      // Apple Watch companion payloads (and other JSON sources) may arrive as
      // a complete JSON object without a trailing '\n'. If the buffered remainder
      // looks like a complete JSON object, process it immediately rather than
      // waiting for a newline that will never come.
      const remainder = lineBufferRef.current.trim();
      if (remainder.startsWith('{') && remainder.endsWith('}')) {
        try {
          JSON.parse(remainder);
          lineBufferRef.current = '';
          await processBatches(remainder, '');
        } catch {
          // Incomplete JSON fragment – keep buffered until more data arrives.
        }
      }

      if (parsedAny) {
        commitTransportDebug('parsed', { lineBufferLength: lineBufferRef.current.length });
        return;
      }

      if (lineBufferRef.current.length > 0) {
        commitTransportDebug('buffering', { lineBufferLength: lineBufferRef.current.length });
        return;
      }

      if (sawCompleteLine) {
        commitTransportDebug('unparsed', { lineBufferLength: 0, incrementIssue: true });
        return;
      }

      commitTransportDebug('empty', { lineBufferLength: 0 });
    },
    [
      runOrQueue,
      shouldSkipWorkoutMirror,
    ]
  );

  const stopScan = useCallback(() => {
    if (!managerRef.current) return;
    managerRef.current.stopDeviceScan();
    setIsScanning(false);
    setStatus((prev) => (prev === 'scanning' ? 'idle' : prev));
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
    // Pass null to scan ALL nearby BLE devices so the user can pick by name
    // (DSD Tech / nRF Connect style). The service UUID is only needed when
    // subscribing to the characteristic after the device is chosen.
    managerRef.current.startDeviceScan(null, null, (scanError, device) => {
      if (scanError) {
        if (isBleOperationCancelledError(scanError)) {
          return;
        }
        setError(scanError.message);
        stopScan();
        setStatus('error');
        return;
      }
      if (!device) return;
      devicesRef.current.set(device.id, {
        id: device.id,
        name: device.name,
        rssi: device.rssi,
      });
      setDevices(Array.from(devicesRef.current.values()));
    });
  }, [isPoweredOn, isScanning, stopScan, unsupportedMessage]);

  const disconnectFromDevice = useCallback(async () => {
    connectionAttemptIdRef.current += 1;
    clearPendingHm10LinkCheck('Bluetooth device disconnected during HM-10 link verification.');
    monitorRef.current?.remove();
    monitorRef.current = null;
    disconnectRef.current?.remove();
    disconnectRef.current = null;
    lineBufferRef.current = '';
    const deviceId = connectedDeviceIdRef.current;
    connectedDeviceIdRef.current = null;
    setConnectedDevice(null);
    setTransportDebug((prev) => ({
      ...prev,
      lineBufferLength: 0,
    }));
    setHm10LinkGuard(DEFAULT_HM10_LINK_GUARD);
    setStatus('idle');
    if (!deviceId || !managerRef.current) {
      return;
    }
    try {
      await managerRef.current.cancelDeviceConnection(deviceId);
    } catch {
      // ignore disconnect errors
    }
  }, [clearPendingHm10LinkCheck]);

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
      const attemptId = connectionAttemptIdRef.current + 1;
      connectionAttemptIdRef.current = attemptId;
      const isStaleAttempt = () => connectionAttemptIdRef.current !== attemptId;
      monitorRef.current?.remove();
      disconnectRef.current?.remove();
      lineBufferRef.current = '';
      clearPendingHm10LinkCheck('HM-10 link verification was cancelled by a new connection attempt.');
      transportDebugRef.current = DEFAULT_TRANSPORT_DEBUG;
      setTransportDebug(DEFAULT_TRANSPORT_DEBUG);
      setHm10LinkGuard(DEFAULT_HM10_LINK_GUARD);
      try {
        const normalizedService = normalizeUuid(config.serviceUUID);
        const normalizedCharacteristic = normalizeUuid(config.characteristicUUID);
        const requestedProfile = config.profile;
        if (!normalizedService || !normalizedCharacteristic) {
          throw new Error('Enter the service and characteristic UUIDs before connecting.');
        }
        let connected: Device | null = null;
        const alreadyConnected = await manager.isDeviceConnected(deviceId).catch(() => false);
        if (alreadyConnected) {
          const knownDevices = await manager.devices([deviceId]);
          connected = knownDevices[0] ?? null;
        }
        if (!connected) {
          try {
            const connectionOptions = buildConnectionOptions();
            connected = connectionOptions
              ? await manager.connectToDevice(deviceId, connectionOptions)
              : await manager.connectToDevice(deviceId);
          } catch (connectError) {
            if (!isBleOperationCancelledError(connectError)) {
              throw connectError;
            }
            const recovered = await manager.isDeviceConnected(deviceId).catch(() => false);
            if (!recovered) {
              throw connectError;
            }
            const knownDevices = await manager.devices([deviceId]);
            connected = knownDevices[0] ?? null;
            if (!connected) {
              throw connectError;
            }
          }
        }
        if (!connected) {
          throw new Error('Unable to access the Bluetooth device after connecting.');
        }
        const readyDevice = await connected.discoverAllServicesAndCharacteristics();
        if (isStaleAttempt()) {
          try {
            await manager.cancelDeviceConnection(readyDevice.id);
          } catch {
            // ignore cleanup errors from stale connection attempts
          }
          return;
        }
        const deviceName = readyDevice.name || fallback?.name || null;
        let resolvedService = normalizedService;
        let resolvedCharacteristic = normalizedCharacteristic;
        let availableCharUuids = await lookupCharacteristicUuids(
          readyDevice as unknown as CharacteristicLookupDevice,
          resolvedService
        );

        if (!availableCharUuids || !availableCharUuids.includes(expandUuid(resolvedCharacteristic))) {
          const recoveryCandidates = buildConnectionRecoveryCandidates({
            profile: requestedProfile,
            serviceUUID: normalizedService,
            characteristicUUID: normalizedCharacteristic,
            deviceName,
          });

          for (const candidate of recoveryCandidates) {
            const candidateChars = await lookupCharacteristicUuids(
              readyDevice as unknown as CharacteristicLookupDevice,
              candidate.serviceUUID
            );
            if (!candidateChars || !candidateChars.includes(expandUuid(candidate.characteristicUUID))) {
              continue;
            }
            resolvedService = candidate.serviceUUID;
            resolvedCharacteristic = candidate.characteristicUUID;
            availableCharUuids = candidateChars;

            const recoveredProfile = inferRecoveredProfile({
              currentProfile: requestedProfile,
              serviceUUID: resolvedService,
              characteristicUUID: resolvedCharacteristic,
              deviceName,
            });
            const nextConfig: BluetoothConfig = {
              ...configRef.current,
              profile: recoveredProfile,
              serviceUUID: resolvedService,
              characteristicUUID: resolvedCharacteristic,
              metric:
                configRef.current.profile === recoveredProfile
                  ? configRef.current.metric
                  : PROFILE_BY_ID[recoveredProfile].defaults.metric,
            };
            configRef.current = nextConfig;
            setConfig((prev) => ({
              ...prev,
              ...nextConfig,
            }));
            break;
          }
        }

        if (!availableCharUuids) {
          await manager.cancelDeviceConnection(readyDevice.id).catch(() => {});
          throw new Error(
            `Service ${normalizedService} was not found on this device. ` +
            `Select the correct device profile (HM-10: FFE0/FFE1, Heart Rate: 180D/2A37).`
          );
        }

        if (!availableCharUuids.includes(expandUuid(resolvedCharacteristic))) {
          await manager.cancelDeviceConnection(readyDevice.id).catch(() => {});
          throw new Error(
            `Characteristic ${normalizedCharacteristic} was not found in service ${normalizedService}.` +
            (availableCharUuids.length ? ` Available: ${availableCharUuids.join(', ')}.` : '') +
            ` Select the correct device profile or edit the characteristic UUID.`
          );
        }
        connectedDeviceIdRef.current = readyDevice.id;
        setConnectedDevice({
          id: readyDevice.id,
          name: readyDevice.name || fallback?.name,
          rssi: readyDevice.rssi ?? fallback?.rssi,
        });
        disconnectRef.current = manager.onDeviceDisconnected(readyDevice.id, () => {
          connectionAttemptIdRef.current += 1;
          clearPendingHm10LinkCheck('Bluetooth device disconnected during HM-10 link verification.');
          connectedDeviceIdRef.current = null;
          setConnectedDevice(null);
          setTransportDebug((prev) => ({
            ...prev,
            lineBufferLength: 0,
          }));
          setHm10LinkGuard(DEFAULT_HM10_LINK_GUARD);
          setStatus('idle');
        });
        monitorRef.current = readyDevice.monitorCharacteristicForService(
          expandUuid(resolvedService),
          expandUuid(resolvedCharacteristic),
          (monitorError, characteristic) => {
            if (isStaleAttempt()) {
              return;
            }
            if (monitorError) {
              if (isBleOperationCancelledError(monitorError)) {
                return;
              }
              connectedDeviceIdRef.current = null;
              setConnectedDevice(null);
              clearPendingHm10LinkCheck('HM-10 link verification was interrupted by a Bluetooth monitor error.');
              setError(normalizeConnectionError(monitorError));
              setStatus('error');
              manager.cancelDeviceConnection(readyDevice.id).catch(() => {});
              return;
            }
            if (characteristic?.value) {
              handleCharacteristicValue(characteristic.value);
            }
          }
        );
        setStatus('connected');
      } catch (connectionError) {
        if (isStaleAttempt()) {
          return;
        }
        await manager.cancelDeviceConnection(deviceId).catch(() => {});
        clearPendingHm10LinkCheck('HM-10 link verification failed because the Bluetooth connection did not finish.');
        connectedDeviceIdRef.current = null;
        setConnectedDevice(null);
        setStatus('error');
        setError(normalizeConnectionError(connectionError));
      }
    },
    [
      clearPendingHm10LinkCheck,
      config.characteristicUUID,
      config.serviceUUID,
      handleCharacteristicValue,
      stopScan,
      unsupportedMessage,
    ]
  );

  const connectToDevice = useCallback(
    async (deviceId: string) => {
      if (!isPoweredOn) {
        setError('Bluetooth is not ready.');
        return;
      }
      await performConnection(deviceId, devicesRef.current.get(deviceId) ?? null);
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
      const serviceCandidates = buildPairedDeviceServiceCandidates({
        profile: config.profile,
        serviceUUID: normalizedService,
      });
      let paired: Device[] = [];
      for (const candidate of serviceCandidates) {
        // connectedDevices() requires the full 128-bit UUID on both iOS and Android.
        const matches = await manager.connectedDevices([expandUuid(candidate)]);
        if (matches.length) {
          paired = matches;
          break;
        }
      }
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
          expandUuid(normalizedService),
          expandUuid(normalizedCharacteristic),
          encoded
        );
        return;
      } catch (withResponseError) {
        try {
          await manager.writeCharacteristicWithoutResponseForDevice(
            connectedDeviceIdRef.current,
            expandUuid(normalizedService),
            expandUuid(normalizedCharacteristic),
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

  const applyHm10BaudRate = useCallback(
    async (baudOverride?: number) => {
      const activeConfig = configRef.current;
      if (activeConfig.profile !== 'arduino_hm10') {
        throw new Error('HM-10 baud control is only available for the Arduino + HM-10 profile.');
      }
      const nextBaud = normalizeHm10BaudRate(baudOverride ?? activeConfig.hm10BaudRate);
      await sendCommand(buildHm10BaudCommand(nextBaud));
      setConfig((prev) => {
        const nextConfig: BluetoothConfig = {
          ...prev,
          hm10BaudRate: nextBaud,
        };
        configRef.current = nextConfig;
        return nextConfig;
      });
      return nextBaud;
    },
    [sendCommand]
  );

  const verifyHm10Link = useCallback(async () => {
    const activeConfig = configRef.current;
    if (activeConfig.profile !== 'arduino_hm10') {
      throw new Error('HM-10 link verification is only available for the Arduino + HM-10 profile.');
    }
    if (!connectedDeviceIdRef.current) {
      throw new Error('Connect to the HM-10 before running the link verification.');
    }

    const existingCheck = pendingHm10LinkCheckRef.current;
    if (existingCheck) {
      return existingCheck.promise;
    }

    const startedAt = Date.now();
    const token = hm10LinkSequenceRef.current++;
    let resolveCheck!: (value: number) => void;
    let rejectCheck!: (error: Error) => void;
    const promise = new Promise<number>((resolve, reject) => {
      resolveCheck = resolve;
      rejectCheck = reject;
    });

    const timeoutHandle = setTimeout(() => {
      const pending = pendingHm10LinkCheckRef.current;
      if (!pending || pending.token !== token) {
        return;
      }
      pendingHm10LinkCheckRef.current = null;
      const sawTraffic = transportDebugRef.current.totalNotifications > pending.notificationCountAtStart;
      const message = sawTraffic
        ? 'BLE traffic came back, but no matching sensor.hm10_link_ack reply arrived. The Arduino may be streaming one-way or still running an older sketch.'
        : 'No BLE reply arrived after the HM-10 link ping. Check the UUIDs, UART baud, and that the updated Arduino sketch is flashed.';
      setHm10LinkGuard((prev) => ({
        ...prev,
        status: 'failed',
        lastCheckFinishedTs: Date.now(),
        pendingAckValue: null,
        message,
      }));
      rejectCheck(new Error(message));
    }, HM10_LINK_CHECK_TIMEOUT_MS);

    pendingHm10LinkCheckRef.current = {
      token,
      startedAt,
      notificationCountAtStart: transportDebugRef.current.totalNotifications,
      timeoutHandle,
      resolve: resolveCheck,
      reject: rejectCheck,
      promise,
    };

    setHm10LinkGuard((prev) => ({
      ...prev,
      status: 'checking',
      lastCheckStartedTs: startedAt,
      lastCheckFinishedTs: null,
      pendingAckValue: token,
      message: 'Sent an HM-10 link ping. Waiting for sensor.hm10_link_ack from the Arduino...',
    }));

    try {
      await sendCommand(buildHm10PingCommand(token));
    } catch (sendError) {
      clearTimeout(timeoutHandle);
      pendingHm10LinkCheckRef.current = null;
      const message =
        sendError instanceof Error
          ? sendError.message
          : 'Unable to send the HM-10 link ping.';
      setHm10LinkGuard((prev) => ({
        ...prev,
        status: 'failed',
        lastCheckFinishedTs: Date.now(),
        pendingAckValue: null,
        message,
      }));
      throw sendError;
    }

    return promise;
  }, [sendCommand]);

  const manualPublish = useCallback(
    async (
      value: number,
      metricOverride?: string,
      options?: { localDate?: string; skipWorkoutMirror?: boolean }
    ) => {
      const metric = (metricOverride || config.metric || '').trim() || config.metric;
      const sampleValue = Number(value);
      if (!Number.isFinite(sampleValue)) {
        throw new Error('Enter a numeric value to publish.');
      }
      try {
        const result = await runOrQueue({
          endpoint: '/api/streams',
          payload: {
            metric,
            ...(options?.localDate ? { localDate: options.localDate } : {}),
            skipWorkoutMirror:
              options?.skipWorkoutMirror === true || shouldSkipWorkoutMirror(metric),
            samples: [
              {
                ts: Date.now(),
                value: sampleValue,
                ...(options?.localDate ? { localDate: options.localDate } : {}),
              },
            ],
          },
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
    [config.metric, runOrQueue, shouldSkipWorkoutMirror]
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
      transportDebug,
      hm10LinkGuard,
      lastUploadStatus,
      error,
      startScan,
      stopScan,
      connectToDevice,
      confirmSystemDevice,
      disconnectFromDevice,
      sendCommand,
      applyHm10BaudRate,
      verifyHm10Link,
      manualPublish,
      setWorkoutMirrorSuppressed,
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
      transportDebug,
      hm10LinkGuard,
      lastUploadStatus,
      error,
      startScan,
      stopScan,
      connectToDevice,
      confirmSystemDevice,
      disconnectFromDevice,
      sendCommand,
      applyHm10BaudRate,
      verifyHm10Link,
      manualPublish,
      setWorkoutMirrorSuppressed,
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
