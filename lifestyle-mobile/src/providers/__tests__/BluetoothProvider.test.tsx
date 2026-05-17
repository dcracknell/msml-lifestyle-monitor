import { ReactNode } from 'react';
import { render, act, cleanup } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Native module mocks (must be declared before the provider is imported)
// ---------------------------------------------------------------------------

const mockConnectedDevices              = jest.fn();
const mockConnectToDevice               = jest.fn();
const mockDevices                       = jest.fn().mockResolvedValue([]);
const mockIsDeviceConnected             = jest.fn().mockResolvedValue(false);
const mockOnDeviceDisconnected          = jest.fn();
const mockStartDeviceScan               = jest.fn();
const mockStopDeviceScan                = jest.fn();
const mockCancelDeviceConnection        = jest.fn().mockResolvedValue(undefined);
const mockWriteWithResponse             = jest.fn().mockResolvedValue(undefined);
const mockWriteWithoutResponse          = jest.fn().mockResolvedValue(undefined);
const mockBleErrorCode = {
  OperationCancelled: 2,
  CharacteristicNotFound: 402,
};

jest.mock('react-native', () => ({
  Platform: { OS: 'ios', Version: 17 },
  PermissionsAndroid: {
    PERMISSIONS: {
      BLUETOOTH_SCAN:     'bluetooth-scan',
      BLUETOOTH_CONNECT:  'bluetooth-connect',
      ACCESS_FINE_LOCATION: 'fine-location',
    },
    RESULTS: { GRANTED: 'granted' },
    request: jest.fn().mockResolvedValue('granted'),
    requestMultiple: jest.fn().mockResolvedValue({
      'bluetooth-scan':      'granted',
      'bluetooth-connect':   'granted',
      'fine-location':       'granted',
    }),
  },
  NativeModules: { BlePlx: {} },
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
}));

const mockRunOrQueue = jest.fn().mockResolvedValue({ status: 'sent' });
const mockInvalidateQueries = jest.fn().mockResolvedValue(undefined);

jest.mock('../SyncProvider', () => ({
  useSyncQueue: () => ({ runOrQueue: mockRunOrQueue }),
}));

jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: mockInvalidateQueries }),
}));

jest.mock('react-native-ble-plx', () => {
  const onStateChange = jest.fn((callback: (state: string) => void) => {
    callback('PoweredOn');
    return { remove: jest.fn() };
  });
  return {
    BleErrorCode: mockBleErrorCode,
    State: {
      PoweredOn:   'PoweredOn',
      Unsupported: 'Unsupported',
      Unknown:     'Unknown',
    },
    BleManager: jest.fn().mockImplementation(() => ({
      connectedDevices:       mockConnectedDevices,
      connectToDevice:        mockConnectToDevice,
      devices:                mockDevices,
      isDeviceConnected:      mockIsDeviceConnected,
      onStateChange,
      onDeviceDisconnected:   mockOnDeviceDisconnected,
      startDeviceScan:        mockStartDeviceScan,
      stopDeviceScan:         mockStopDeviceScan,
      destroy:                jest.fn(),
      cancelDeviceConnection:                    mockCancelDeviceConnection,
      writeCharacteristicWithResponseForDevice:  mockWriteWithResponse,
      writeCharacteristicWithoutResponseForDevice: mockWriteWithoutResponse,
    })),
  };
});

// Load provider only after mocks are in place
const {
  BluetoothProvider,
  useBluetooth,
  expandUuid,
  validateMetricValue,
} = require('../BluetoothProvider') as typeof import('../BluetoothProvider');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE = '-0000-1000-8000-00805F9B34FB';
const full = (short: string) => `0000${short}${BASE}`;

// Encode a plain string as base-64 the same way the BLE stack does.
const encode = (s: string) => require('base-64').encode(s);
const decode = (s: string) => require('base-64').decode(s);

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
  mockDevices.mockResolvedValue([]);
  mockIsDeviceConnected.mockResolvedValue(false);
  mockCancelDeviceConnection.mockResolvedValue(undefined);
  mockWriteWithResponse.mockResolvedValue(undefined);
  mockWriteWithoutResponse.mockResolvedValue(undefined);
  mockInvalidateQueries.mockResolvedValue(undefined);
});

async function renderWithProvider(probe: (ctx: ReturnType<typeof useBluetooth>) => void) {
  function Probe() {
    probe(useBluetooth());
    return null;
  }

  await act(async () => {
    render(
      <BluetoothProvider>
        <Probe />
      </BluetoothProvider>
    );

    // The provider bootstraps its config from AsyncStorage on mount.
    // Flush that async effect here so individual tests don't race it.
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** Set up a fresh connected device and return the monitor notification callback. */
async function connectDevice(options?: {
  profile?: string;
  deviceId?: string;
  deviceName?: string;
  /** Override the UUIDs that characteristicsForService returns (defaults to FFF1 for FFF0 service). */
  availableCharUuids?: string[];
}) {
  const { profile = 'custom', deviceId = 'dev-1', deviceName = 'TestDevice', availableCharUuids } = options ?? {};
  const monitorCharacteristicForService = jest.fn();
  // Default: expose whichever characteristic the chosen profile expects so validation passes.
  const defaultCharUuids =
    profile === 'arduino_hm10'          ? [full('FFE1')] :
    profile === 'ble_hrm'               ? [full('2A37')] :
    profile === 'apple_watch_companion' ? [full('FFF1')] :
                                          [full('FFF1')];
  const characteristicsForService = jest.fn().mockResolvedValue(
    (availableCharUuids ?? defaultCharUuids).map((uuid) => ({ uuid }))
  );

  mockConnectedDevices.mockResolvedValue([{ id: deviceId, name: deviceName, rssi: -50 }]);
  mockConnectToDevice.mockResolvedValue({
    discoverAllServicesAndCharacteristics: jest.fn().mockResolvedValue({
      id: deviceId,
      name: deviceName,
      rssi: -50,
      monitorCharacteristicForService,
      characteristicsForService,
    }),
  });

  let ctx: ReturnType<typeof useBluetooth> | null = null;
  await renderWithProvider((c) => { ctx = c; });

  if (profile !== 'custom') {
    await act(async () => { ctx!.applyProfile(profile as any); });
  }

  await act(async () => { await ctx!.confirmSystemDevice(); });

  const monitorCallback = monitorCharacteristicForService.mock.calls[0]?.[2];
  return {
    ctx: ctx!,
    getCtx: () => ctx!,
    monitorCallback,
    monitorCharacteristicForService,
  };
}

// ---------------------------------------------------------------------------
// expandUuid — pure function
// ---------------------------------------------------------------------------

describe('expandUuid', () => {
  it('expands a 4-char (16-bit) UUID to the full 128-bit Bluetooth base form', () => {
    expect(expandUuid('FFE0')).toBe(`0000FFE0${BASE}`);
    expect(expandUuid('FFE1')).toBe(`0000FFE1${BASE}`);
    expect(expandUuid('FFF0')).toBe(`0000FFF0${BASE}`);
    expect(expandUuid('FFF1')).toBe(`0000FFF1${BASE}`);
    expect(expandUuid('180D')).toBe(`0000180D${BASE}`);
    expect(expandUuid('2A37')).toBe(`00002A37${BASE}`);
  });

  it('normalises lowercase input before expanding', () => {
    expect(expandUuid('ffe0')).toBe(`0000FFE0${BASE}`);
    expect(expandUuid('ffe1')).toBe(`0000FFE1${BASE}`);
  });

  it('expands an 8-char (32-bit) UUID', () => {
    expect(expandUuid('0000FFE0')).toBe(`0000FFE0${BASE}`);
  });

  it('returns a full UUID unchanged', () => {
    const full128 = `0000FFE0${BASE}`;
    expect(expandUuid(full128)).toBe(full128);
  });

  it('returns an empty string for empty input', () => {
    expect(expandUuid('')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// validateMetricValue — pure function
// ---------------------------------------------------------------------------

describe('validateMetricValue', () => {
  it('returns the value when it is within the registered range', () => {
    expect(validateMetricValue('vitals.heart_rate', 75)).toBe(75);
    expect(validateMetricValue('vitals.spo2',       98)).toBe(98);
    expect(validateMetricValue('vitals.hrv',        45)).toBe(45);
    expect(validateMetricValue('vitals.glucose',    95)).toBe(95);
    expect(validateMetricValue('body.weight_kg',  70.5)).toBe(70.5);
    expect(validateMetricValue('phone.steps',     8000)).toBe(8000);
  });

  it('returns null and warns when the value is below the minimum', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect(validateMetricValue('vitals.heart_rate', 5)).toBeNull();
    expect(validateMetricValue('vitals.spo2',      40)).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('returns null and warns when the value is above the maximum', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect(validateMetricValue('vitals.heart_rate', 999)).toBeNull();
    expect(validateMetricValue('vitals.spo2',       101)).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('passes through any value for an unregistered metric (no range defined)', () => {
    expect(validateMetricValue('custom.unknown_metric',  -999)).toBe(-999);
    expect(validateMetricValue('custom.unknown_metric', 99999)).toBe(99999);
  });

  it('accepts boundary values exactly on min and max', () => {
    expect(validateMetricValue('vitals.heart_rate', 20)).toBe(20);   // min
    expect(validateMetricValue('vitals.heart_rate', 300)).toBe(300); // max
    expect(validateMetricValue('vitals.spo2', 50)).toBe(50);         // min
    expect(validateMetricValue('vitals.spo2', 100)).toBe(100);       // max
  });
});

// ---------------------------------------------------------------------------
// confirmSystemDevice — existing tests (UUIDs now use full 128-bit form)
// ---------------------------------------------------------------------------

describe('BluetoothProvider confirmSystemDevice', () => {
  it('connects to the first paired device and uses expanded UUIDs', async () => {
    const monitorCharacteristicForService = jest.fn();
    mockConnectedDevices.mockResolvedValue([{ id: 'paired-id', name: 'Trainer', rssi: -45 }]);
    mockConnectToDevice.mockResolvedValue({
      discoverAllServicesAndCharacteristics: jest.fn().mockResolvedValue({
        id: 'paired-id',
        name: 'Trainer',
        rssi: -45,
        monitorCharacteristicForService,
        characteristicsForService: jest.fn().mockResolvedValue([{ uuid: full('FFF1') }]),
      }),
    });

    let snapshot: ReturnType<typeof useBluetooth> | null = null;
    await renderWithProvider((ctx) => { snapshot = ctx; });

    await act(async () => { await snapshot!.confirmSystemDevice(); });

    // connectedDevices and monitorCharacteristicForService must receive full UUIDs
    expect(mockConnectedDevices).toHaveBeenCalledWith([full('FFF0')]);
    expect(mockConnectToDevice).toHaveBeenCalledWith('paired-id');
    expect(snapshot!.connectedDevice?.id).toBe('paired-id');
    expect(snapshot!.status).toBe('connected');
    expect(monitorCharacteristicForService).toHaveBeenCalledWith(
      full('FFF0'),
      full('FFF1'),
      expect.any(Function)
    );
  });

  it('surfaces an error when no paired device is found', async () => {
    mockConnectedDevices.mockResolvedValue([]);

    let snapshot: ReturnType<typeof useBluetooth> | null = null;
    await renderWithProvider((ctx) => { snapshot = ctx; });

    await act(async () => { await snapshot!.confirmSystemDevice(); });

    expect(snapshot!.error).toContain('No paired device detected');
    expect(snapshot!.status).toBe('error');
    expect(mockConnectToDevice).not.toHaveBeenCalled();
  });

  it('falls back to the HM-10 FFF0 service when paired-device lookup on FFE0 returns nothing', async () => {
    const monitorCharacteristicForService = jest.fn();
    mockConnectedDevices
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'paired-hm10', name: 'BT05', rssi: -52 }]);
    mockConnectToDevice.mockResolvedValue({
      discoverAllServicesAndCharacteristics: jest.fn().mockResolvedValue({
        id: 'paired-hm10',
        name: 'BT05',
        rssi: -52,
        monitorCharacteristicForService,
        characteristicsForService: jest.fn((serviceUuid: string) => {
          if (serviceUuid === full('FFE0')) {
            return Promise.reject(new Error('Service not found'));
          }
          if (serviceUuid === full('FFF0')) {
            return Promise.resolve([{ uuid: full('FFF1') }]);
          }
          return Promise.resolve([]);
        }),
      }),
    });

    let snapshot: ReturnType<typeof useBluetooth> | null = null;
    await renderWithProvider((ctx) => { snapshot = ctx; });

    await act(async () => { snapshot!.applyProfile('arduino_hm10'); });
    await act(async () => { await snapshot!.confirmSystemDevice(); });

    expect(mockConnectedDevices).toHaveBeenNthCalledWith(1, [full('FFE0')]);
    expect(mockConnectedDevices).toHaveBeenNthCalledWith(2, [full('FFF0')]);
    expect(snapshot!.status).toBe('connected');
    expect(snapshot!.config.serviceUUID).toBe('FFF0');
    expect(snapshot!.config.characteristicUUID).toBe('FFF1');
    expect(monitorCharacteristicForService).toHaveBeenCalledWith(
      full('FFF0'),
      full('FFF1'),
      expect.any(Function)
    );
  });

  it('recovers if the initial BLE connect is cancelled but the device is already connected', async () => {
    const monitorCharacteristicForService = jest.fn();
    const discoveredDevice = {
      id: 'paired-id',
      name: 'Trainer',
      rssi: -45,
      monitorCharacteristicForService,
      characteristicsForService: jest.fn().mockResolvedValue([{ uuid: full('FFF1') }]),
    };
    mockConnectedDevices.mockResolvedValue([{ id: 'paired-id', name: 'Trainer', rssi: -45 }]);
    mockConnectToDevice.mockRejectedValue({ message: 'Operation was cancelled', errorCode: 2 });
    mockIsDeviceConnected.mockResolvedValue(true);
    mockDevices.mockResolvedValue([
      {
        discoverAllServicesAndCharacteristics: jest.fn().mockResolvedValue(discoveredDevice),
      },
    ]);

    let snapshot: ReturnType<typeof useBluetooth> | null = null;
    await renderWithProvider((ctx) => { snapshot = ctx; });

    await act(async () => { await snapshot!.confirmSystemDevice(); });

    expect(snapshot!.status).toBe('connected');
    expect(snapshot!.connectedDevice?.id).toBe('paired-id');
    expect(mockDevices).toHaveBeenCalledWith(['paired-id']);
  });

  it('shows a friendly message when a cancelled connect could not be recovered', async () => {
    mockConnectedDevices.mockResolvedValue([{ id: 'paired-id', name: 'Trainer', rssi: -45 }]);
    mockConnectToDevice.mockRejectedValue({ message: 'Operation was cancelled', errorCode: 2 });
    mockIsDeviceConnected.mockResolvedValue(false);

    let snapshot: ReturnType<typeof useBluetooth> | null = null;
    await renderWithProvider((ctx) => { snapshot = ctx; });

    await act(async () => { await snapshot!.confirmSystemDevice(); });

    expect(snapshot!.status).toBe('error');
    expect(snapshot!.error).toContain('Bluetooth connection was interrupted before setup completed');
  });

  it('parses standard BLE heart-rate measurements when using HR profile', async () => {
    const { monitorCallback } = await connectDevice({ profile: 'ble_hrm' });

    await act(async () => {
      monitorCallback(null, { value: encode(String.fromCharCode(0x00, 72)) });
      await Promise.resolve();
    });

    expect(mockRunOrQueue).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: '/api/streams',
        payload: expect.objectContaining({
          metric: 'exercise.hr',
          samples: [{ ts: expect.any(Number), value: 72 }],
        }),
      })
    );
  });

  it('uploads Apple Watch companion JSON as multiple stream metrics', async () => {
    const { monitorCallback } = await connectDevice({ profile: 'apple_watch_companion' });

    await act(async () => {
      monitorCallback(null, {
        value: encode(JSON.stringify({
          timestamp: 1700000000000,
          heartRate: 128,
          distanceKm: 6.4,
          paceSecondsPerKm: 315,
        })),
      });
      await Promise.resolve();
    });

    const metrics = mockRunOrQueue.mock.calls.map((c) => c[0]?.payload?.metric).sort();
    expect(mockRunOrQueue).toHaveBeenCalledTimes(3);
    expect(metrics).toEqual(['exercise.distance', 'exercise.hr', 'exercise.pace']);
  });

  it('infers workout metrics from nested JSON payloads on custom profile', async () => {
    const { monitorCallback } = await connectDevice();

    await act(async () => {
      monitorCallback(null, {
        value: encode(JSON.stringify({
          timestamp: 1700002000000,
          workout: { heartRate: 141, distanceMeters: 4200, speedMps: 3.2 },
        })),
      });
      await Promise.resolve();
    });

    const payloads = mockRunOrQueue.mock.calls.map((c) => c[0]?.payload);
    const byMetric = new Map(payloads.map((p) => [p.metric, p]));
    expect(byMetric.get('exercise.hr')?.samples?.[0]).toEqual({ ts: 1700002000000, value: 141 });
    expect(byMetric.get('exercise.distance')?.samples?.[0]?.value).toBeCloseTo(4.2, 6);
    expect(byMetric.get('exercise.pace')?.samples?.[0]?.value).toBeCloseTo(312.5, 6);
  });

  it('uploads Apple Watch sleep payload as stream metrics', async () => {
    const { monitorCallback } = await connectDevice({ profile: 'apple_watch_companion' });

    await act(async () => {
      monitorCallback(null, {
        value: encode(JSON.stringify({
          timestamp: 1700001000000,
          sleepMinutes: 390,
          deepSleepMinutes: 60,
          remSleepHours: 1.5,
          lightSleepMinutes: 240,
          awakeMinutes: 30,
        })),
      });
      await Promise.resolve();
    });

    const metrics = mockRunOrQueue.mock.calls.map((c) => c[0]?.payload?.metric).sort();
    expect(mockRunOrQueue).toHaveBeenCalledTimes(5);
    expect(metrics).toEqual([
      'sleep.awake_hours',
      'sleep.deep_hours',
      'sleep.light_hours',
      'sleep.rem_hours',
      'sleep.total_hours',
    ]);
  });

  it('normalizes Apple Watch environmental and body telemetry fields into stream metrics', async () => {
    const { monitorCallback } = await connectDevice({ profile: 'apple_watch_companion' });

    await act(async () => {
      monitorCallback(null, {
        value: encode(JSON.stringify({
          timestamp: 1700003000000,
          bodyTemperature: 36.7,
          ambientTemperature: 21.4,
          humidityPct: 48.2,
          co2ppm: 612,
          vocPpb: 184,
          pressureHpa: 1009.6,
          pm25Ugm3: 9.4,
        })),
      });
      await Promise.resolve();
    });

    const metrics = mockRunOrQueue.mock.calls.map((c) => c[0]?.payload?.metric).sort();
    expect(mockRunOrQueue).toHaveBeenCalledTimes(7);
    expect(metrics).toEqual([
      'sensor.ambient_temperature_c',
      'sensor.body_temperature_c',
      'sensor.co2_ppm',
      'sensor.humidity_pct',
      'sensor.pm25_ugm3',
      'sensor.pressure_hpa',
      'sensor.voc_ppb',
    ]);
  });
});

// ---------------------------------------------------------------------------
// Arduino + HM-10 line buffer
// ---------------------------------------------------------------------------

describe('Arduino HM-10 line buffer', () => {
  it('reassembles JSON split across multiple 20-byte BLE notifications', async () => {
    const { monitorCallback } = await connectDevice({ profile: 'arduino_hm10' });
    const line = '{"metric":"vitals.heart_rate","value":74}\n';

    // Send in two chunks the way HM-10 splits a 41-char string
    await act(async () => {
      monitorCallback(null, { value: encode(line.slice(0, 20)) });
      await Promise.resolve();
    });

    // No upload yet — newline not received
    expect(mockRunOrQueue).not.toHaveBeenCalled();

    await act(async () => {
      monitorCallback(null, { value: encode(line.slice(20)) });
      await Promise.resolve();
    });

    expect(mockRunOrQueue).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: '/api/streams',
        payload: expect.objectContaining({
          metric: 'vitals.heart_rate',
          samples: [expect.objectContaining({ value: 74 })],
        }),
      })
    );
  });

  it('handles \\r\\n Arduino line endings', async () => {
    const { monitorCallback } = await connectDevice({ profile: 'arduino_hm10' });

    await act(async () => {
      monitorCallback(null, { value: encode('{"metric":"vitals.spo2","value":98}\r\n') });
      await Promise.resolve();
    });

    expect(mockRunOrQueue).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ metric: 'vitals.spo2' }),
      })
    );
  });

  it('tracks partial HM-10 lines so the app can show traffic before a newline arrives', async () => {
    const connection = await connectDevice({ profile: 'arduino_hm10' });

    await act(async () => {
      connection.monitorCallback(null, { value: encode('{"metric":"sensor.hm10_link_probe"') });
      await Promise.resolve();
    });

    expect(connection.getCtx().transportDebug.totalNotifications).toBe(1);
    expect(connection.getCtx().transportDebug.lastOutcome).toBe('buffering');
    expect(connection.getCtx().transportDebug.lineBufferLength).toBeGreaterThan(0);
  });

  it('sends each metric in a multi-metric session to a separate runOrQueue call', async () => {
    const { monitorCallback } = await connectDevice({ profile: 'arduino_hm10' });

    // Heart rate packet (sent every 2 s)
    await act(async () => {
      monitorCallback(null, { value: encode('{"metric":"vitals.heart_rate","value":72}\n') });
      await Promise.resolve();
    });

    // SpO2 packet (sent every 10 s)
    await act(async () => {
      monitorCallback(null, { value: encode('{"metric":"vitals.spo2","value":97.5}\n') });
      await Promise.resolve();
    });

    expect(mockRunOrQueue).toHaveBeenCalledTimes(2);
    const metrics = mockRunOrQueue.mock.calls.map((c) => c[0]?.payload?.metric);
    expect(metrics).toContain('vitals.heart_rate');
    expect(metrics).toContain('vitals.spo2');
  });

  it('clears the buffer and recovers after an overflow (> 512 chars without newline)', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const connection = await connectDevice({ profile: 'arduino_hm10' });
    const { monitorCallback } = connection;

    // Send 513 chars of noise — no newline
    await act(async () => {
      monitorCallback(null, { value: encode('x'.repeat(513)) });
      await Promise.resolve();
    });

    expect(mockRunOrQueue).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('overflow'));
    expect(connection.getCtx().transportDebug.lastOutcome).toBe('overflow');
    expect(connection.getCtx().transportDebug.parseIssueCount).toBe(1);
    expect(connection.getCtx().transportDebug.lineBufferLength).toBe(0);

    // A valid line arriving after the overflow should still be parsed
    await act(async () => {
      monitorCallback(null, { value: encode('{"metric":"vitals.heart_rate","value":70}\n') });
      await Promise.resolve();
    });

    expect(mockRunOrQueue).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ metric: 'vitals.heart_rate', samples: [expect.objectContaining({ value: 70 })] }),
      })
    );

    warn.mockRestore();
  });

  it('captures unreadable BLE bytes in transport debug so baud mismatches are visible', async () => {
    const connection = await connectDevice({ profile: 'arduino_hm10' });

    await act(async () => {
      connection.monitorCallback(null, { value: encode(String.fromCharCode(0xff, 0xfe, 0xfd)) });
      await Promise.resolve();
    });

    expect(connection.getCtx().lastSample).toBeNull();
    expect(connection.getCtx().transportDebug.lastOutcome).toBe('binary_only');
    expect(connection.getCtx().transportDebug.lastNotificationHex).toContain('ff fe fd');
    expect(connection.getCtx().transportDebug.parseIssueCount).toBe(1);
  });

  it('marks printable HM-10 noise as unparsed instead of pretending it is a sample', async () => {
    const connection = await connectDevice({ profile: 'arduino_hm10' });

    await act(async () => {
      connection.monitorCallback(null, { value: encode('10:P|~\n') });
      await Promise.resolve();
    });

    expect(mockRunOrQueue).not.toHaveBeenCalled();
    expect(connection.getCtx().lastSample).toBeNull();
    expect(connection.getCtx().transportDebug.lastOutcome).toBe('unparsed');
    expect(connection.getCtx().transportDebug.parseIssueCount).toBe(1);
  });

  it('drops samples with out-of-range values (validateMetricValue integration)', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const { monitorCallback } = await connectDevice({ profile: 'arduino_hm10' });

    // SpO2 of 200 is physiologically impossible
    await act(async () => {
      monitorCallback(null, { value: encode('{"metric":"vitals.spo2","value":200}\n') });
      await Promise.resolve();
    });

    // runOrQueue is still called but the sample value should be null (dropped)
    const sampleValue = mockRunOrQueue.mock.calls[0]?.[0]?.payload?.samples?.[0]?.value;
    expect(sampleValue).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('vitals.spo2'));

    warn.mockRestore();
  });

  it('clears the line buffer when the device disconnects', async () => {
    const { ctx, monitorCallback } = await connectDevice({ profile: 'arduino_hm10' });

    // Send first half of a JSON line (no newline yet)
    await act(async () => {
      monitorCallback(null, { value: encode('{"metric":"vitals.heart_rate","val') });
      await Promise.resolve();
    });

    // Disconnect
    await act(async () => { await ctx.disconnectFromDevice(); });

    // Reconnect with a full line — should parse cleanly without leftover garbage
    const monitorCharacteristicForService2 = jest.fn();
    mockConnectToDevice.mockResolvedValue({
      discoverAllServicesAndCharacteristics: jest.fn().mockResolvedValue({
        id: 'dev-1',
        name: 'TestDevice',
        rssi: -50,
        monitorCharacteristicForService: monitorCharacteristicForService2,
        characteristicsForService: jest.fn().mockResolvedValue([{ uuid: full('FFE1') }]),
      }),
    });

    await act(async () => { await ctx.confirmSystemDevice(); });

    const monitorCallback2 = monitorCharacteristicForService2.mock.calls[0]?.[2];
    await act(async () => {
      monitorCallback2(null, { value: encode('{"metric":"vitals.heart_rate","value":75}\n') });
      await Promise.resolve();
    });

    const payloads = mockRunOrQueue.mock.calls.map((c) => c[0]?.payload);
    // Only one valid upload — the stale partial buffer was cleared on disconnect
    expect(payloads).toHaveLength(1);
    expect(payloads[0]?.samples?.[0]?.value).toBe(75);
  });
});

// ---------------------------------------------------------------------------
// startScan — scans all BLE devices (no UUID filter)
// ---------------------------------------------------------------------------

describe('BluetoothProvider startScan', () => {
  it('calls startDeviceScan with null so all BLE devices are shown', async () => {
    mockStartDeviceScan.mockImplementation(() => {});

    let snapshot: ReturnType<typeof useBluetooth> | null = null;
    await renderWithProvider((ctx) => { snapshot = ctx; });

    await act(async () => { await snapshot!.startScan(); });

    expect(mockStartDeviceScan).toHaveBeenCalledWith(
      null,               // no UUID filter — show every device
      null,
      expect.any(Function)
    );
    expect(snapshot!.isScanning).toBe(true);
    expect(snapshot!.status).toBe('scanning');
  });

  it('populates the devices list as the scan callback fires', async () => {
    let scanCallback: any;
    mockStartDeviceScan.mockImplementation((_: any, __: any, cb: any) => {
      scanCallback = cb;
    });

    let snapshot: ReturnType<typeof useBluetooth> | null = null;
    await renderWithProvider((ctx) => { snapshot = ctx; });

    await act(async () => { await snapshot!.startScan(); });

    act(() => {
      scanCallback(null, { id: 'hmsoft-1', name: 'HMSoft',  rssi: -55 });
      scanCallback(null, { id: 'bt05-2',   name: 'BT05',    rssi: -70 });
      scanCallback(null, { id: 'hmsoft-1', name: 'HMSoft',  rssi: -53 }); // duplicate — deduplicated by id
    });

    expect(snapshot!.devices).toHaveLength(2);
    expect(snapshot!.devices.map((d) => d.id)).toEqual(
      expect.arrayContaining(['hmsoft-1', 'bt05-2'])
    );
  });

  it('surfaces a scan error and stops scanning', async () => {
    let scanCallback: any;
    mockStartDeviceScan.mockImplementation((_: any, __: any, cb: any) => {
      scanCallback = cb;
    });

    let snapshot: ReturnType<typeof useBluetooth> | null = null;
    await renderWithProvider((ctx) => { snapshot = ctx; });

    await act(async () => { await snapshot!.startScan(); });

    act(() => {
      scanCallback({ message: 'Bluetooth permission denied' }, null);
    });

    expect(snapshot!.error).toBe('Bluetooth permission denied');
    expect(snapshot!.status).toBe('error');
    expect(mockStopDeviceScan).toHaveBeenCalled();
  });

  it('ignores benign scan cancellation after scanning stops', async () => {
    let scanCallback: any;
    mockStartDeviceScan.mockImplementation((_: any, __: any, cb: any) => {
      scanCallback = cb;
    });

    let snapshot: ReturnType<typeof useBluetooth> | null = null;
    await renderWithProvider((ctx) => { snapshot = ctx; });

    await act(async () => { await snapshot!.startScan(); });
    act(() => { snapshot!.stopScan(); });
    act(() => {
      scanCallback(
        { errorCode: mockBleErrorCode.OperationCancelled, message: 'Operation was cancelled' },
        null
      );
    });

    expect(snapshot!.error).toBeNull();
    expect(snapshot!.status).toBe('idle');
  });
});

// ---------------------------------------------------------------------------
// connectToDevice — direct connection to a scanned device
// ---------------------------------------------------------------------------

describe('BluetoothProvider connectToDevice', () => {
  it('connects directly to a device id returned by the scanner', async () => {
    const monitorCharacteristicForService = jest.fn();
    mockConnectToDevice.mockResolvedValue({
      discoverAllServicesAndCharacteristics: jest.fn().mockResolvedValue({
        id: 'hmsoft-1',
        name: 'HMSoft',
        rssi: -55,
        monitorCharacteristicForService,
        characteristicsForService: jest.fn().mockResolvedValue([{ uuid: full('FFE1') }]),
      }),
    });

    let snapshot: ReturnType<typeof useBluetooth> | null = null;
    await renderWithProvider((ctx) => { snapshot = ctx; });

    // Apply the Arduino profile first
    await act(async () => { snapshot!.applyProfile('arduino_hm10'); });

    await act(async () => { await snapshot!.connectToDevice('hmsoft-1'); });

    expect(mockConnectToDevice).toHaveBeenCalledWith('hmsoft-1');
    expect(snapshot!.connectedDevice?.id).toBe('hmsoft-1');
    expect(snapshot!.status).toBe('connected');

    // Characteristic subscription must use expanded FFE0 / FFE1
    expect(monitorCharacteristicForService).toHaveBeenCalledWith(
      full('FFE0'),
      full('FFE1'),
      expect.any(Function)
    );
  });

  it('auto-corrects a mixed FFE0 / 2A37 config to the HM-10 FFE1 characteristic', async () => {
    const monitorCharacteristicForService = jest.fn();
    mockConnectToDevice.mockResolvedValue({
      discoverAllServicesAndCharacteristics: jest.fn().mockResolvedValue({
        id: 'hmsoft-1',
        name: 'HMSoft',
        rssi: -55,
        monitorCharacteristicForService,
        characteristicsForService: jest.fn().mockResolvedValue([{ uuid: full('FFE1') }]),
      }),
    });

    let snapshot: ReturnType<typeof useBluetooth> | null = null;
    await renderWithProvider((ctx) => { snapshot = ctx; });

    await act(async () => {
      snapshot!.applyProfile('ble_hrm');
      snapshot!.updateConfig({ serviceUUID: 'FFE0' });
    });

    await act(async () => { await snapshot!.connectToDevice('hmsoft-1'); });

    expect(snapshot!.status).toBe('connected');
    expect(snapshot!.config.profile).toBe('arduino_hm10');
    expect(snapshot!.config.serviceUUID).toBe('FFE0');
    expect(snapshot!.config.characteristicUUID).toBe('FFE1');
    expect(monitorCharacteristicForService).toHaveBeenCalledWith(
      full('FFE0'),
      full('FFE1'),
      expect.any(Function)
    );

    const monitorCallback = monitorCharacteristicForService.mock.calls[0]?.[2];
    await act(async () => {
      monitorCallback(null, { value: encode('{"metric":"sensor.aht20_temperature_c","value":22.41}\n') });
      await Promise.resolve();
    });

    expect(mockRunOrQueue).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: '/api/streams',
        payload: expect.objectContaining({
          metric: 'sensor.aht20_temperature_c',
          samples: [expect.objectContaining({ value: 22.41 })],
        }),
      })
    );
  });

  it('recovers from the BLE heart-rate preset when an HMSoft device actually exposes HM-10 UUIDs', async () => {
    let scanCallback: any;
    mockStartDeviceScan.mockImplementation((_: any, __: any, cb: any) => {
      scanCallback = cb;
    });

    const monitorCharacteristicForService = jest.fn();
    mockConnectToDevice.mockResolvedValue({
      discoverAllServicesAndCharacteristics: jest.fn().mockResolvedValue({
        id: 'hmsoft-1',
        name: 'HMSoft',
        rssi: -55,
        monitorCharacteristicForService,
        characteristicsForService: jest.fn((serviceUuid: string) => {
          if (serviceUuid === full('180D')) {
            return Promise.reject(new Error('Service not found'));
          }
          if (serviceUuid === full('FFE0')) {
            return Promise.resolve([{ uuid: full('FFE1') }]);
          }
          return Promise.reject(new Error(`Unexpected service ${serviceUuid}`));
        }),
      }),
    });

    let snapshot: ReturnType<typeof useBluetooth> | null = null;
    await renderWithProvider((ctx) => { snapshot = ctx; });

    await act(async () => { snapshot!.applyProfile('ble_hrm'); });
    await act(async () => { await snapshot!.startScan(); });
    act(() => {
      scanCallback(null, { id: 'hmsoft-1', name: 'HMSoft', rssi: -55 });
    });

    await act(async () => { await snapshot!.connectToDevice('hmsoft-1'); });

    expect(snapshot!.status).toBe('connected');
    expect(snapshot!.config.profile).toBe('arduino_hm10');
    expect(snapshot!.config.serviceUUID).toBe('FFE0');
    expect(snapshot!.config.characteristicUUID).toBe('FFE1');
    expect(monitorCharacteristicForService).toHaveBeenCalledWith(
      full('FFE0'),
      full('FFE1'),
      expect.any(Function)
    );

    const monitorCallback = monitorCharacteristicForService.mock.calls[0]?.[2];
    await act(async () => {
      monitorCallback(null, { value: encode('{"metric":"sensor.aht20_temperature_c","value":22.41}\n') });
      await Promise.resolve();
    });

    expect(mockRunOrQueue).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: '/api/streams',
        payload: expect.objectContaining({
          metric: 'sensor.aht20_temperature_c',
          samples: [expect.objectContaining({ value: 22.41 })],
        }),
      })
    );
  });

  it('data flows from device to runOrQueue after connecting via scanner', async () => {
    const monitorCharacteristicForService = jest.fn();
    mockConnectToDevice.mockResolvedValue({
      discoverAllServicesAndCharacteristics: jest.fn().mockResolvedValue({
        id: 'hmsoft-1',
        name: 'HMSoft',
        rssi: -55,
        monitorCharacteristicForService,
        characteristicsForService: jest.fn().mockResolvedValue([{ uuid: full('FFE1') }]),
      }),
    });

    let snapshot: ReturnType<typeof useBluetooth> | null = null;
    await renderWithProvider((ctx) => { snapshot = ctx; });

    await act(async () => { snapshot!.applyProfile('arduino_hm10'); });
    await act(async () => { await snapshot!.connectToDevice('hmsoft-1'); });

    const monitorCallback = monitorCharacteristicForService.mock.calls[0]?.[2];

    await act(async () => {
      monitorCallback(null, { value: encode('{"metric":"vitals.heart_rate","value":78}\n') });
      await Promise.resolve();
    });

    expect(mockRunOrQueue).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: '/api/streams',
        payload: expect.objectContaining({
          metric: 'vitals.heart_rate',
          samples: [expect.objectContaining({ value: 78 })],
        }),
      })
    );
  });

  it('ignores monitor cancellations after a device is connected', async () => {
    const { ctx, monitorCallback } = await connectDevice({ profile: 'arduino_hm10' });

    await act(async () => {
      monitorCallback(
        { errorCode: mockBleErrorCode.OperationCancelled, message: 'Operation was cancelled' },
        null
      );
      await Promise.resolve();
    });

    expect(ctx.status).toBe('connected');
    expect(ctx.error).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// arduino_hm10 profile
// ---------------------------------------------------------------------------

describe('arduino_hm10 profile', () => {
  it('is present in the profiles list', async () => {
    let snapshot: ReturnType<typeof useBluetooth> | null = null;
    await renderWithProvider((ctx) => { snapshot = ctx; });

    const ids = snapshot!.profiles.map((p) => p.id);
    expect(ids).toContain('arduino_hm10');
  });

  it('pre-fills FFE0 / FFE1 UUIDs and the mock sensor metric', async () => {
    let snapshot: ReturnType<typeof useBluetooth> | null = null;
    await renderWithProvider((ctx) => { snapshot = ctx; });

    await act(async () => { snapshot!.applyProfile('arduino_hm10'); });

    expect(snapshot!.config.serviceUUID).toBe('FFE0');
    expect(snapshot!.config.characteristicUUID).toBe('FFE1');
    expect(snapshot!.config.metric).toBe('sensor.aht20_temperature_c');
    expect(snapshot!.config.profile).toBe('arduino_hm10');
  });

  it('connects via scanner using expanded FFE0 / FFE1 UUIDs', async () => {
    const monitorCharacteristicForService = jest.fn();
    mockConnectToDevice.mockResolvedValue({
      discoverAllServicesAndCharacteristics: jest.fn().mockResolvedValue({
        id: 'hmsoft-1',
        name: 'HMSoft',
        rssi: -60,
        monitorCharacteristicForService,
        characteristicsForService: jest.fn().mockResolvedValue([{ uuid: full('FFE1') }]),
      }),
    });

    let snapshot: ReturnType<typeof useBluetooth> | null = null;
    await renderWithProvider((ctx) => { snapshot = ctx; });

    await act(async () => { snapshot!.applyProfile('arduino_hm10'); });
    await act(async () => { await snapshot!.connectToDevice('hmsoft-1'); });

    expect(monitorCharacteristicForService).toHaveBeenCalledWith(
      full('FFE0'),
      full('FFE1'),
      expect.any(Function)
    );
    expect(snapshot!.status).toBe('connected');
  });

  it('uploads the default sensor metric when the Arduino sends a single-metric packet', async () => {
    const monitorCharacteristicForService = jest.fn();
    mockConnectToDevice.mockResolvedValue({
      discoverAllServicesAndCharacteristics: jest.fn().mockResolvedValue({
        id: 'hmsoft-1',
        name: 'HMSoft',
        rssi: -60,
        monitorCharacteristicForService,
        characteristicsForService: jest.fn().mockResolvedValue([{ uuid: full('FFE1') }]),
      }),
    });

    let snapshot: ReturnType<typeof useBluetooth> | null = null;
    await renderWithProvider((ctx) => { snapshot = ctx; });

    await act(async () => { snapshot!.applyProfile('arduino_hm10'); });
    await act(async () => { await snapshot!.connectToDevice('hmsoft-1'); });

    const monitorCallback = monitorCharacteristicForService.mock.calls[0]?.[2];

    await act(async () => {
      monitorCallback(null, { value: encode('{"metric":"sensor.aht20_temperature_c","value":22.41}\n') });
      await Promise.resolve();
    });

    expect(mockRunOrQueue).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: '/api/streams',
        payload: expect.objectContaining({
          metric: 'sensor.aht20_temperature_c',
          samples: [expect.objectContaining({ value: 22.41 })],
        }),
      })
    );
  });

  it('uploads the full Arduino telemetry frame including the HM-10 link probe metric', async () => {
    const monitorCharacteristicForService = jest.fn();
    mockConnectToDevice.mockResolvedValue({
      discoverAllServicesAndCharacteristics: jest.fn().mockResolvedValue({
        id: 'hmsoft-1',
        name: 'HMSoft',
        rssi: -60,
        monitorCharacteristicForService,
        characteristicsForService: jest.fn().mockResolvedValue([{ uuid: full('FFE1') }]),
      }),
    });

    let snapshot: ReturnType<typeof useBluetooth> | null = null;
    await renderWithProvider((ctx) => { snapshot = ctx; });

    await act(async () => { snapshot!.applyProfile('arduino_hm10'); });
    await act(async () => { await snapshot!.connectToDevice('hmsoft-1'); });

    const monitorCallback = monitorCharacteristicForService.mock.calls[0]?.[2];

    // Exact packet sequence produced by the Arduino sketch (one metric per line).
    const frame = [
      '{"metric":"sensor.hm10_link_probe","value":3}\n',
      '{"metric":"sensor.time_ms","value":3000}\n',
      '{"metric":"sensor.aht20_temperature_c","value":22.41}\n',
      '{"metric":"sensor.aht20_humidity_percent","value":48.12}\n',
      '{"metric":"sensor.tmp117_temperature_c","value":32.05}\n',
      '{"metric":"sensor.voc_raw","value":24300}\n',
      '{"metric":"sensor.accel_x","value":0.012}\n',
      '{"metric":"sensor.accel_y","value":-0.008}\n',
      '{"metric":"sensor.accel_z","value":9.803}\n',
      '{"metric":"sensor.gyro_x","value":0.003}\n',
      '{"metric":"sensor.gyro_y","value":-0.002}\n',
      '{"metric":"sensor.gyro_z","value":0.001}\n',
      '{"metric":"sensor.max_red","value":52100}\n',
      '{"metric":"sensor.max_ir","value":68200}\n',
    ];

    for (const line of frame) {
      await act(async () => {
        monitorCallback(null, { value: encode(line) });
        await Promise.resolve();
      });
    }

    expect(mockRunOrQueue).toHaveBeenCalledTimes(14);

    const uploadedMetrics = mockRunOrQueue.mock.calls.map((c) => c[0]?.payload?.metric);
    expect(uploadedMetrics).toEqual(expect.arrayContaining([
      'sensor.hm10_link_probe',
      'sensor.time_ms',
      'sensor.aht20_temperature_c',
      'sensor.aht20_humidity_percent',
      'sensor.tmp117_temperature_c',
      'sensor.voc_raw',
      'sensor.accel_x',
      'sensor.accel_y',
      'sensor.accel_z',
      'sensor.gyro_x',
      'sensor.gyro_y',
      'sensor.gyro_z',
      'sensor.max_red',
      'sensor.max_ir',
    ]));
  });

  it('reassembles a sensor metric split across two 20-byte BLE notifications', async () => {
    const monitorCharacteristicForService = jest.fn();
    mockConnectToDevice.mockResolvedValue({
      discoverAllServicesAndCharacteristics: jest.fn().mockResolvedValue({
        id: 'hmsoft-1',
        name: 'HMSoft',
        rssi: -60,
        monitorCharacteristicForService,
        characteristicsForService: jest.fn().mockResolvedValue([{ uuid: full('FFE1') }]),
      }),
    });

    let snapshot: ReturnType<typeof useBluetooth> | null = null;
    await renderWithProvider((ctx) => { snapshot = ctx; });

    await act(async () => { snapshot!.applyProfile('arduino_hm10'); });
    await act(async () => { await snapshot!.connectToDevice('hmsoft-1'); });

    const monitorCallback = monitorCharacteristicForService.mock.calls[0]?.[2];
    // 52-char line split at byte 20 and 40 — matches real HM-10 20-byte BLE MTU chunks
    const line = '{"metric":"sensor.aht20_temperature_c","value":22.41}\n';

    await act(async () => {
      monitorCallback(null, { value: encode(line.slice(0, 20)) });
      await Promise.resolve();
    });
    expect(mockRunOrQueue).not.toHaveBeenCalled();

    await act(async () => {
      monitorCallback(null, { value: encode(line.slice(20, 40)) });
      await Promise.resolve();
    });
    expect(mockRunOrQueue).not.toHaveBeenCalled();

    await act(async () => {
      monitorCallback(null, { value: encode(line.slice(40)) });
      await Promise.resolve();
    });

    expect(mockRunOrQueue).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          metric: 'sensor.aht20_temperature_c',
          samples: [expect.objectContaining({ value: 22.41 })],
        }),
      })
    );
  });
});

// ---------------------------------------------------------------------------
// disconnectFromDevice
// ---------------------------------------------------------------------------

describe('BluetoothProvider disconnectFromDevice', () => {
  it('clears connected device state and status after disconnect', async () => {
    // Use a live snapshot ref so state reads after act() are not stale.
    const monitorCharacteristicForService = jest.fn();
    mockConnectedDevices.mockResolvedValue([{ id: 'dev-1', name: 'TestDevice', rssi: -50 }]);
    mockConnectToDevice.mockResolvedValue({
      discoverAllServicesAndCharacteristics: jest.fn().mockResolvedValue({
        id: 'dev-1', name: 'TestDevice', rssi: -50, monitorCharacteristicForService,
        characteristicsForService: jest.fn().mockResolvedValue([{ uuid: full('FFE1') }]),
      }),
    });

    let snapshot: ReturnType<typeof useBluetooth> | null = null;
    await renderWithProvider((ctx) => { snapshot = ctx; });
    await act(async () => { snapshot!.applyProfile('arduino_hm10'); });
    await act(async () => { await snapshot!.confirmSystemDevice(); });

    expect(snapshot!.status).toBe('connected');
    expect(snapshot!.connectedDevice).not.toBeNull();

    await act(async () => { await snapshot!.disconnectFromDevice(); });

    expect(snapshot!.status).toBe('idle');
    expect(snapshot!.connectedDevice).toBeNull();
  });

  it('calls cancelDeviceConnection with the connected device id', async () => {
    const { ctx } = await connectDevice({ deviceId: 'bt05-1', profile: 'arduino_hm10' });

    await act(async () => { await ctx.disconnectFromDevice(); });

    expect(mockCancelDeviceConnection).toHaveBeenCalledWith('bt05-1');
  });

  it('is a no-op (no throw) when no device is connected', async () => {
    let snapshot: ReturnType<typeof useBluetooth> | null = null;
    await renderWithProvider((ctx) => { snapshot = ctx; });

    await act(async () => { await snapshot!.disconnectFromDevice(); });

    expect(snapshot!.status).toBe('idle');
    expect(mockCancelDeviceConnection).not.toHaveBeenCalled();
  });

  it('silently ignores errors from cancelDeviceConnection', async () => {
    mockCancelDeviceConnection.mockRejectedValueOnce(new Error('already gone'));
    const { ctx } = await connectDevice({ profile: 'arduino_hm10' });

    let threw = false;
    await act(async () => {
      try { await ctx.disconnectFromDevice(); } catch { threw = true; }
    });

    expect(threw).toBe(false);
    expect(mockCancelDeviceConnection).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// sendCommand
// ---------------------------------------------------------------------------

describe('BluetoothProvider sendCommand', () => {
  it('writes the payload to the characteristic using expanded UUIDs', async () => {
    const { ctx } = await connectDevice({ profile: 'arduino_hm10' });

    await act(async () => { await ctx.sendCommand('hello'); });

    expect(mockWriteWithResponse).toHaveBeenCalledWith(
      expect.any(String),         // device id
      full('FFE0'),               // expanded service UUID
      full('FFE1'),               // expanded characteristic UUID
      expect.any(String)          // base-64 encoded payload
    );
  });

  it('throws when no device is connected', async () => {
    let snapshot: ReturnType<typeof useBluetooth> | null = null;
    await renderWithProvider((ctx) => { snapshot = ctx; });

    await expect(
      act(async () => { await snapshot!.sendCommand('ping'); })
    ).rejects.toThrow(/connect.*before/i);
  });

  it('falls back to writeWithoutResponse when writeWithResponse fails', async () => {
    mockWriteWithResponse.mockRejectedValueOnce(new Error('GATT write failed'));
    const { ctx } = await connectDevice({ profile: 'arduino_hm10' });

    await act(async () => { await ctx.sendCommand('ping'); });

    expect(mockWriteWithoutResponse).toHaveBeenCalled();
  });

  it('throws when both write paths fail', async () => {
    mockWriteWithResponse.mockRejectedValueOnce(new Error('write with response failed'));
    mockWriteWithoutResponse.mockRejectedValueOnce(new Error('write without response failed'));
    const { ctx } = await connectDevice({ profile: 'arduino_hm10' });

    await expect(
      act(async () => { await ctx.sendCommand('ping'); })
    ).rejects.toThrow(/unable to send command/i);
  });
});

// ---------------------------------------------------------------------------
// applyHm10BaudRate
// ---------------------------------------------------------------------------

describe('BluetoothProvider applyHm10BaudRate', () => {
  it('sends the HM-10 baud command with a trailing newline and stores the selected baud', async () => {
    const connection = await connectDevice({ profile: 'arduino_hm10' });
    const { ctx } = connection;

    await act(async () => { ctx.updateConfig({ hm10BaudRate: 19200 as any }); });

    let appliedBaud: number | null = null;
    await act(async () => {
      appliedBaud = await ctx.applyHm10BaudRate();
    });

    expect(appliedBaud).toBe(19200);
    expect(connection.getCtx().config.hm10BaudRate).toBe(19200);
    expect(mockWriteWithResponse).toHaveBeenCalledWith(
      expect.any(String),
      full('FFE0'),
      full('FFE1'),
      encode('HM10:BAUD=19200\n')
    );
  });

  it('supports wider HM-10 baud values for recovery and faster serial links', async () => {
    const connection = await connectDevice({ profile: 'arduino_hm10' });
    const { ctx } = connection;

    await act(async () => { ctx.updateConfig({ hm10BaudRate: 57600 as any }); });

    let appliedBaud: number | null = null;
    await act(async () => {
      appliedBaud = await ctx.applyHm10BaudRate();
    });

    expect(appliedBaud).toBe(57600);
    expect(connection.getCtx().config.hm10BaudRate).toBe(57600);
    expect(mockWriteWithResponse).toHaveBeenCalledWith(
      expect.any(String),
      full('FFE0'),
      full('FFE1'),
      encode('HM10:BAUD=57600\n')
    );
  });

  it('rejects baud control outside the Arduino HM-10 profile', async () => {
    let snapshot: ReturnType<typeof useBluetooth> | null = null;
    await renderWithProvider((ctx) => { snapshot = ctx; });

    await expect(
      act(async () => { await snapshot!.applyHm10BaudRate(19200); })
    ).rejects.toThrow(/arduino \+ hm-10 profile/i);
  });
});

// ---------------------------------------------------------------------------
// verifyHm10Link
// ---------------------------------------------------------------------------

describe('BluetoothProvider verifyHm10Link', () => {
  it('sends a ping command and marks the HM-10 link verified when a matching ack returns', async () => {
    const connection = await connectDevice({ profile: 'arduino_hm10' });
    const { ctx } = connection;

    let verifyPromise: Promise<number> | null = null;
    await act(async () => {
      verifyPromise = ctx.verifyHm10Link();
      await Promise.resolve();
    });

    const lastWriteCall = mockWriteWithResponse.mock.calls[mockWriteWithResponse.mock.calls.length - 1];
    const encodedPayload = lastWriteCall?.[3];
    expect(typeof encodedPayload).toBe('string');
    const decodedPayload = decode(encodedPayload);
    expect(decodedPayload).toMatch(/^HM10:PING=\d+\n$/);
    const token = Number(decodedPayload.match(/^HM10:PING=(\d+)\n$/)?.[1]);

    await act(async () => {
      connection.monitorCallback(
        null,
        { value: encode(`{"metric":"sensor.hm10_link_ack","value":${token}}\n`) }
      );
      await Promise.resolve();
    });

    await expect(verifyPromise!).resolves.toBe(token);
    expect(connection.getCtx().hm10LinkGuard.status).toBe('verified');
    expect(connection.getCtx().hm10LinkGuard.lastAckValue).toBe(token);
  });

  it('rejects link verification outside the Arduino HM-10 profile', async () => {
    let snapshot: ReturnType<typeof useBluetooth> | null = null;
    await renderWithProvider((ctx) => { snapshot = ctx; });

    await expect(
      act(async () => { await snapshot!.verifyHm10Link(); })
    ).rejects.toThrow(/arduino \+ hm-10 profile/i);
  });
});

// ---------------------------------------------------------------------------
// manualPublish
// ---------------------------------------------------------------------------

describe('BluetoothProvider manualPublish', () => {
  it('uploads a sample to /api/streams using the configured metric', async () => {
    const { ctx } = await connectDevice({ profile: 'arduino_hm10' });

    await act(async () => { await ctx.manualPublish(36.6); });

    expect(mockRunOrQueue).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: '/api/streams',
        payload: expect.objectContaining({
          metric: 'sensor.aht20_temperature_c',
          samples: [expect.objectContaining({ value: 36.6 })],
        }),
      })
    );
  });

  it('uses a metric override when supplied', async () => {
    const { ctx } = await connectDevice({ profile: 'arduino_hm10' });

    await act(async () => { await ctx.manualPublish(72, 'vitals.heart_rate'); });

    expect(mockRunOrQueue).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ metric: 'vitals.heart_rate' }),
      })
    );
  });

  it('throws for a non-numeric value', async () => {
    const { ctx } = await connectDevice({ profile: 'arduino_hm10' });

    await expect(
      act(async () => { await ctx.manualPublish(NaN); })
    ).rejects.toThrow(/numeric/i);
  });

  it('calls runOrQueue exactly once for a successful upload', async () => {
    const { ctx } = await connectDevice({ profile: 'arduino_hm10' });

    await act(async () => { await ctx.manualPublish(22); });

    // One upload call — the mock returns { status: 'sent' }
    expect(mockRunOrQueue).toHaveBeenCalledTimes(1);
    expect(mockRunOrQueue).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: '/api/streams',
        payload: expect.objectContaining({ metric: 'sensor.aht20_temperature_c', samples: [expect.objectContaining({ value: 22 })] }),
      })
    );
  });

  it('stores a manual publish sample in local app history', async () => {
    const { ctx, getCtx } = await connectDevice({ profile: 'arduino_hm10' });

    await act(async () => { await ctx.manualPublish(36.6); });

    expect(getCtx().sampleHistory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          metric: 'sensor.aht20_temperature_c',
          value: 36.6,
          raw: 'Manual entry',
        }),
      ])
    );
  });

  it('refreshes the weight view when a body metric is uploaded', async () => {
    const { ctx } = await connectDevice({ profile: 'arduino_hm10' });

    await act(async () => { await ctx.manualPublish(18.4, 'body.body_fat_pct'); });

    expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['stream-history'] });
    expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['weight'] });
  });

  it('refreshes vitals when exercise heart-rate samples are uploaded', async () => {
    const { ctx } = await connectDevice({ profile: 'arduino_hm10' });

    await act(async () => { await ctx.manualPublish(148, 'exercise.hr'); });

    expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['exercise'] });
    expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['vitals'] });
  });
});

// ---------------------------------------------------------------------------
// updateConfig
// ---------------------------------------------------------------------------

describe('BluetoothProvider updateConfig', () => {
  it('normalises UUID values to uppercase and trims whitespace', async () => {
    let snapshot: ReturnType<typeof useBluetooth> | null = null;
    await renderWithProvider((ctx) => { snapshot = ctx; });

    await act(async () => { snapshot!.updateConfig({ serviceUUID: '  ffe0  ', characteristicUUID: 'ffe1' }); });

    expect(snapshot!.config.serviceUUID).toBe('FFE0');
    expect(snapshot!.config.characteristicUUID).toBe('FFE1');
  });

  it('ignores an empty metric patch and keeps the previous value', async () => {
    let snapshot: ReturnType<typeof useBluetooth> | null = null;
    await renderWithProvider((ctx) => { snapshot = ctx; });

    await act(async () => { snapshot!.applyProfile('arduino_hm10'); });
    await act(async () => { snapshot!.updateConfig({ metric: '   ' }); });

    expect(snapshot!.config.metric).toBe('sensor.aht20_temperature_c');
  });

  it('updates autoUpload independently without touching other fields', async () => {
    let snapshot: ReturnType<typeof useBluetooth> | null = null;
    await renderWithProvider((ctx) => { snapshot = ctx; });

    await act(async () => { snapshot!.applyProfile('arduino_hm10'); });
    await act(async () => { snapshot!.updateConfig({ autoUpload: false }); });

    expect(snapshot!.config.autoUpload).toBe(false);
    expect(snapshot!.config.serviceUUID).toBe('FFE0');
    expect(snapshot!.config.metric).toBe('sensor.aht20_temperature_c');
  });

  it('accepts new supported HM-10 baud values and rejects unsupported ones', async () => {
    let snapshot: ReturnType<typeof useBluetooth> | null = null;
    await renderWithProvider((ctx) => { snapshot = ctx; });

    await act(async () => { snapshot!.applyProfile('arduino_hm10'); });
    await act(async () => { snapshot!.updateConfig({ hm10BaudRate: 115200 as any }); });
    expect(snapshot!.config.hm10BaudRate).toBe(115200);

    await act(async () => { snapshot!.updateConfig({ hm10BaudRate: 12345 as any }); });
    expect(snapshot!.config.hm10BaudRate).toBe(9600);
  });
});

// ---------------------------------------------------------------------------
// characteristic pre-validation
// ---------------------------------------------------------------------------

describe('BluetoothProvider characteristic pre-validation', () => {
  it('surfaces a friendly error when the target service is missing from the device', async () => {
    const monitorCharacteristicForService = jest.fn();
    mockConnectedDevices.mockResolvedValue([{ id: 'hrm-1', name: 'HRM', rssi: -60 }]);
    mockConnectToDevice.mockResolvedValue({
      discoverAllServicesAndCharacteristics: jest.fn().mockResolvedValue({
        id: 'hrm-1',
        name: 'HRM',
        rssi: -60,
        monitorCharacteristicForService,
        // characteristicsForService throws — service not present on device
        characteristicsForService: jest.fn().mockRejectedValue(new Error('Service not found')),
      }),
    });

    let snapshot: ReturnType<typeof useBluetooth> | null = null;
    await renderWithProvider((ctx) => { snapshot = ctx; });

    await act(async () => { await snapshot!.confirmSystemDevice(); });

    expect(snapshot!.status).toBe('error');
    expect(snapshot!.error).toContain('was not found on this device');
    expect(snapshot!.error).toContain('HM-10');
    expect(monitorCharacteristicForService).not.toHaveBeenCalled();
    expect(mockCancelDeviceConnection).toHaveBeenCalledWith('hrm-1');
  });

  it('surfaces a friendly error listing available characteristics when the target char is absent', async () => {
    const monitorCharacteristicForService = jest.fn();
    mockConnectedDevices.mockResolvedValue([{ id: 'hrm-1', name: 'HRM', rssi: -60 }]);
    mockConnectToDevice.mockResolvedValue({
      discoverAllServicesAndCharacteristics: jest.fn().mockResolvedValue({
        id: 'hrm-1',
        name: 'HRM',
        rssi: -60,
        monitorCharacteristicForService,
        // service exists but only has 2A38 (body sensor location), not 2A37 (heart rate measurement)
        // default config uses FFF0/FFF1 — return service chars for FFF0 but with wrong char
        characteristicsForService: jest.fn().mockResolvedValue([{ uuid: full('2A38') }]),
      }),
    });

    let snapshot: ReturnType<typeof useBluetooth> | null = null;
    await renderWithProvider((ctx) => { snapshot = ctx; });

    await act(async () => { await snapshot!.confirmSystemDevice(); });

    expect(snapshot!.status).toBe('error');
    expect(snapshot!.error).toContain('FFF1');
    expect(snapshot!.error).toContain('Available');
    expect(monitorCharacteristicForService).not.toHaveBeenCalled();
    expect(mockCancelDeviceConnection).toHaveBeenCalledWith('hrm-1');
  });

  it('connects successfully when the target characteristic is present', async () => {
    const monitorCharacteristicForService = jest.fn();
    mockConnectedDevices.mockResolvedValue([{ id: 'dev-1', name: 'Dev', rssi: -50 }]);
    mockConnectToDevice.mockResolvedValue({
      discoverAllServicesAndCharacteristics: jest.fn().mockResolvedValue({
        id: 'dev-1',
        name: 'Dev',
        rssi: -50,
        monitorCharacteristicForService,
        characteristicsForService: jest.fn().mockResolvedValue([{ uuid: full('FFF1') }]),
      }),
    });

    let snapshot: ReturnType<typeof useBluetooth> | null = null;
    await renderWithProvider((ctx) => { snapshot = ctx; });

    await act(async () => { await snapshot!.confirmSystemDevice(); });

    expect(snapshot!.status).toBe('connected');
    expect(snapshot!.error).toBeNull();
    expect(monitorCharacteristicForService).toHaveBeenCalled();
  });

  it('cancels the BLE connection on any connection error in the catch block', async () => {
    mockConnectedDevices.mockResolvedValue([{ id: 'dev-1', name: 'Dev', rssi: -50 }]);
    mockConnectToDevice.mockRejectedValue(new Error('Connection refused'));

    let snapshot: ReturnType<typeof useBluetooth> | null = null;
    await renderWithProvider((ctx) => { snapshot = ctx; });

    await act(async () => { await snapshot!.confirmSystemDevice(); });

    expect(snapshot!.status).toBe('error');
    expect(mockCancelDeviceConnection).toHaveBeenCalledWith('dev-1');
  });
});
