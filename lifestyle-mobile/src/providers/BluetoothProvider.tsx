import { ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, PermissionsAndroid, NativeModules } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BleManager, Device, Subscription, State } from 'react-native-ble-plx';
import { encode as encodeBase64, decode as decodeBase64 } from 'base-64';
import { useSyncQueue } from './SyncProvider';

const CONFIG_KEY = 'msml.bluetooth.config';
const MAX_RECENT_SAMPLES = 120;

const DEFAULT_CONFIG: BluetoothConfig = {
  serviceUUID: 'FFF0',
  characteristicUUID: 'FFF1',
  metric: 'sensor.glucose',
  autoUpload: true,
};

export interface BluetoothConfig {
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

function decodePayload(value: string | null) {
  if (!value) {
    return { text: '', binary: '' };
  }
  try {
    const binary = decodeBase64(value);
    const text = binary
      ? decodeURIComponent(
          binary
            .split('')
            .map((char: string) => `%${char.charCodeAt(0).toString(16).padStart(2, '0')}`)
            .join('')
        )
      : '';
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

function parseSamplesFromText(rawText: string, fallbackMetric: string) {
  const now = Date.now();
  if (!rawText) {
    return { metric: fallbackMetric, samples: [{ ts: now, value: null }] };
  }
  const trimmed = rawText.trim();
  if (!trimmed) {
    return { metric: fallbackMetric, samples: [{ ts: now, value: null }] };
  }
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return {
        metric: fallbackMetric,
        samples: parsed
          .map((entry: any) => ({
            ts: Number(entry?.ts ?? entry?.timestamp ?? now),
            value: entry?.value === null ? null : Number(entry?.value),
          }))
          .filter((sample) => Number.isFinite(sample.ts)),
      };
    }
    if (parsed && typeof parsed === 'object') {
      if (Array.isArray(parsed.samples)) {
        const metric = typeof parsed.metric === 'string' ? parsed.metric : fallbackMetric;
        return {
          metric,
          samples: parsed.samples
            .map((entry: any) => ({
              ts: Number(entry?.ts ?? entry?.timestamp ?? now),
              value: entry?.value === null ? null : Number(entry?.value),
            }))
            .filter((sample: any) => Number.isFinite(sample.ts)),
        };
      }
      if (typeof parsed.value === 'number' || parsed.value === null) {
        const ts = Number(parsed.ts ?? parsed.timestamp ?? now);
        const metric = typeof parsed.metric === 'string' ? parsed.metric : fallbackMetric;
        return {
          metric,
          samples: [{ ts: Number.isFinite(ts) ? ts : now, value: parsed.value }],
        };
      }
    }
  } catch {
    // not json
  }
  const numeric = Number(trimmed);
  return {
    metric: fallbackMetric,
    samples: [{ ts: now, value: Number.isFinite(numeric) ? numeric : null }],
  };
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
            setConfig((prev) => ({ ...prev, ...parsed }));
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

  const updateConfig = useCallback((patch: Partial<BluetoothConfig>) => {
    setConfig((prev) => ({
      ...prev,
      ...patch,
      serviceUUID: normalizeUuid(patch.serviceUUID ?? prev.serviceUUID),
      characteristicUUID: normalizeUuid(patch.characteristicUUID ?? prev.characteristicUUID),
    }));
  }, []);

  const handleCharacteristicValue = useCallback(
    async (value: string | null) => {
      if (!value) return;
      const { text } = decodePayload(value);
      const parsed = parseSamplesFromText(text, config.metric);
      if (!parsed.samples.length) {
        return;
      }
      const sanitizedSamples = parsed.samples.map((sample: { ts: number; value: number | null }) => ({
        ts: Number.isFinite(sample.ts) ? Math.round(sample.ts) : Date.now(),
        value: Number.isFinite(sample.value as number) ? (sample.value as number) : null,
      }));
      const latest = sanitizedSamples[sanitizedSamples.length - 1];
      const sample: BluetoothSample = {
        ts: latest.ts,
        value: latest.value,
        raw: text || '[binary]',
        metric: parsed.metric,
      };
      setLastSample(sample);
      setRecentSamples((prev) => {
        const next = [...prev, sample];
        if (next.length > MAX_RECENT_SAMPLES) {
          return next.slice(next.length - MAX_RECENT_SAMPLES);
        }
        return next;
      });
      if (!config.autoUpload) {
        return;
      }
      try {
        const result = await runOrQueue({
          endpoint: '/api/streams',
          payload: { metric: parsed.metric, samples: sanitizedSamples },
          description: `Sensor sample (${parsed.metric})`,
        });
        setLastUploadStatus({
          status: result.status,
          timestamp: Date.now(),
          message: result.status === 'sent' ? 'Uploaded latest sample.' : 'Sample queued until you reconnect.',
        });
      } catch (uploadError) {
        setError(uploadError instanceof Error ? uploadError.message : 'Unable to upload sample.');
      }
    },
    [config.metric, config.autoUpload, runOrQueue]
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
        throw new Error('No paired device detected. Pair it in system Bluetooth settings, keep it awake, then try again.');
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
  }, [config.serviceUUID, isPoweredOn, performConnection, unsupportedMessage]);

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
      await manager.writeCharacteristicWithResponseForDevice(
        connectedDeviceIdRef.current,
        normalizedService,
        normalizedCharacteristic,
        encoded
      );
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
