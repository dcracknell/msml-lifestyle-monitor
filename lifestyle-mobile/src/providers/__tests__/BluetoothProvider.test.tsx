import { ReactNode } from 'react';
import { render, act, cleanup } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Native module mocks (must be declared before the provider is imported)
// ---------------------------------------------------------------------------

const mockConnectedDevices   = jest.fn();
const mockConnectToDevice    = jest.fn();
const mockOnDeviceDisconnected = jest.fn();
const mockStartDeviceScan    = jest.fn();
const mockStopDeviceScan     = jest.fn();
const mockBleErrorCode = {
  OperationCancelled: 2,
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

jest.mock('../SyncProvider', () => ({
  useSyncQueue: () => ({ runOrQueue: mockRunOrQueue }),
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
      onStateChange,
      onDeviceDisconnected:   mockOnDeviceDisconnected,
      startDeviceScan:        mockStartDeviceScan,
      stopDeviceScan:         mockStopDeviceScan,
      destroy:                jest.fn(),
      cancelDeviceConnection: jest.fn().mockResolvedValue(undefined),
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

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
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
}) {
  const { profile = 'custom', deviceId = 'dev-1', deviceName = 'TestDevice' } = options ?? {};
  const monitorCharacteristicForService = jest.fn();

  mockConnectedDevices.mockResolvedValue([{ id: deviceId, name: deviceName, rssi: -50 }]);
  mockConnectToDevice.mockResolvedValue({
    discoverAllServicesAndCharacteristics: jest.fn().mockResolvedValue({
      id: deviceId,
      name: deviceName,
      rssi: -50,
      monitorCharacteristicForService,
    }),
  });

  let ctx: ReturnType<typeof useBluetooth> | null = null;
  await renderWithProvider((c) => { ctx = c; });

  if (profile !== 'custom') {
    await act(async () => { ctx!.applyProfile(profile as any); });
  }

  await act(async () => { await ctx!.confirmSystemDevice(); });

  const monitorCallback = monitorCharacteristicForService.mock.calls[0]?.[2];
  return { ctx: ctx!, monitorCallback, monitorCharacteristicForService };
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
    expect(validateMetricValue('vitals.glucose',   5.2)).toBe(5.2);
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
      }),
    });

    let snapshot: ReturnType<typeof useBluetooth> | null = null;
    await renderWithProvider((ctx) => { snapshot = ctx; });

    await act(async () => { await snapshot!.confirmSystemDevice(); });

    // connectedDevices and monitorCharacteristicForService must receive full UUIDs
    expect(mockConnectedDevices).toHaveBeenCalledWith([full('FFF0')]);
    expect(mockConnectToDevice).toHaveBeenCalledWith('paired-id', { autoConnect: false });
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
    const { monitorCallback } = await connectDevice({ profile: 'arduino_hm10' });

    // Send 513 chars of noise — no newline
    await act(async () => {
      monitorCallback(null, { value: encode('x'.repeat(513)) });
      await Promise.resolve();
    });

    expect(mockRunOrQueue).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('overflow'));

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
      }),
    });

    let snapshot: ReturnType<typeof useBluetooth> | null = null;
    await renderWithProvider((ctx) => { snapshot = ctx; });

    // Apply the Arduino profile first
    await act(async () => { snapshot!.applyProfile('arduino_hm10'); });

    await act(async () => { await snapshot!.connectToDevice('hmsoft-1'); });

    expect(mockConnectToDevice).toHaveBeenCalledWith('hmsoft-1', { autoConnect: false });
    expect(snapshot!.connectedDevice?.id).toBe('hmsoft-1');
    expect(snapshot!.status).toBe('connected');

    // Characteristic subscription must use expanded FFE0 / FFE1
    expect(monitorCharacteristicForService).toHaveBeenCalledWith(
      full('FFE0'),
      full('FFE1'),
      expect.any(Function)
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

  it('ignores benign monitor cancellation after a connection is established', async () => {
    const { ctx, monitorCallback } = await connectDevice({ profile: 'arduino_hm10' });

    act(() => {
      monitorCallback(
        { errorCode: mockBleErrorCode.OperationCancelled, message: 'Operation was cancelled' },
        null
      );
    });

    expect(ctx.error).toBeNull();
    expect(ctx.status).toBe('connected');
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
});
