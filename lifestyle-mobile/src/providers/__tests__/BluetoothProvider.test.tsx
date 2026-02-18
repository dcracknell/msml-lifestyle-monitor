import { ReactNode } from 'react';
import { render, act, cleanup } from '@testing-library/react';

const mockConnectedDevices = jest.fn();
const mockConnectToDevice = jest.fn();
const mockOnDeviceDisconnected = jest.fn();

jest.mock('react-native', () => ({
  Platform: { OS: 'ios', Version: 17 },
  PermissionsAndroid: {
    PERMISSIONS: {
      BLUETOOTH_SCAN: 'bluetooth-scan',
      BLUETOOTH_CONNECT: 'bluetooth-connect',
      ACCESS_FINE_LOCATION: 'fine-location',
    },
    RESULTS: { GRANTED: 'granted' },
    request: jest.fn().mockResolvedValue('granted'),
    requestMultiple: jest.fn().mockResolvedValue({
      'bluetooth-scan': 'granted',
      'bluetooth-connect': 'granted',
      'fine-location': 'granted',
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
    State: {
      PoweredOn: 'PoweredOn',
      Unsupported: 'Unsupported',
      Unknown: 'Unknown',
    },
    BleManager: jest.fn().mockImplementation(() => ({
      connectedDevices: mockConnectedDevices,
      connectToDevice: mockConnectToDevice,
      onStateChange,
      onDeviceDisconnected: mockOnDeviceDisconnected,
      startDeviceScan: jest.fn(),
      stopDeviceScan: jest.fn(),
      destroy: jest.fn(),
    })),
  };
});

// Load the provider only after native dependencies are mocked.
// This avoids initializing the real BLE module in Jest.
const { BluetoothProvider, useBluetooth } = require('../BluetoothProvider') as typeof import('../BluetoothProvider');

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
});

function renderWithProvider(probe: (ctx: any) => void) {
  function Probe() {
    const ctx = useBluetooth();
    probe(ctx);
    return null;
  }
  render(
    <BluetoothProvider>
      <Probe />
    </BluetoothProvider>
  );
}

describe('BluetoothProvider confirmSystemDevice', () => {
  it('connects to the first paired device exposed by the OS', async () => {
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

    let snapshot: any = null;
    renderWithProvider((ctx) => {
      snapshot = ctx;
    });

    await act(async () => {
      await snapshot?.confirmSystemDevice();
    });

    expect(mockConnectedDevices).toHaveBeenCalledWith(['FFF0']);
    expect(mockConnectToDevice).toHaveBeenCalledWith('paired-id', { autoConnect: true });
    expect(snapshot?.connectedDevice?.id).toBe('paired-id');
    expect(snapshot?.status).toBe('connected');
    expect(monitorCharacteristicForService).toHaveBeenCalledWith(
      'FFF0',
      'FFF1',
      expect.any(Function)
    );
  });

  it('surfaces an error when no paired device is found', async () => {
    mockConnectedDevices.mockResolvedValue([]);

    let snapshot: any = null;
    renderWithProvider((ctx) => {
      snapshot = ctx;
    });

    await act(async () => {
      await snapshot?.confirmSystemDevice();
    });

    expect(snapshot?.error).toContain('No paired device detected');
    expect(snapshot?.status).toBe('error');
    expect(mockConnectToDevice).not.toHaveBeenCalled();
  });

  it('parses standard BLE heart-rate measurements when using HR profile', async () => {
    const monitorCharacteristicForService = jest.fn();
    mockConnectedDevices.mockResolvedValue([{ id: 'hrm-id', name: 'HR Strap', rssi: -52 }]);
    mockConnectToDevice.mockResolvedValue({
      discoverAllServicesAndCharacteristics: jest.fn().mockResolvedValue({
        id: 'hrm-id',
        name: 'HR Strap',
        rssi: -52,
        monitorCharacteristicForService,
      }),
    });

    let snapshot: any = null;
    renderWithProvider((ctx) => {
      snapshot = ctx;
    });

    await act(async () => {
      snapshot?.applyProfile('ble_hrm');
    });

    await act(async () => {
      await snapshot?.confirmSystemDevice();
    });

    const monitorCallback = monitorCharacteristicForService.mock.calls[0]?.[2];
    await act(async () => {
      const encodedHeartRate = require('base-64').encode(String.fromCharCode(0x00, 72));
      monitorCallback?.(null, { value: encodedHeartRate });
      await Promise.resolve();
    });

    expect(mockRunOrQueue).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: '/api/streams',
        payload: {
          metric: 'exercise.hr',
          samples: [{ ts: expect.any(Number), value: 72 }],
        },
      })
    );
  });

  it('uploads Apple Watch companion JSON as multiple stream metrics', async () => {
    const monitorCharacteristicForService = jest.fn();
    mockConnectedDevices.mockResolvedValue([{ id: 'watch-bridge', name: 'Watch Bridge', rssi: -41 }]);
    mockConnectToDevice.mockResolvedValue({
      discoverAllServicesAndCharacteristics: jest.fn().mockResolvedValue({
        id: 'watch-bridge',
        name: 'Watch Bridge',
        rssi: -41,
        monitorCharacteristicForService,
      }),
    });

    let snapshot: any = null;
    renderWithProvider((ctx) => {
      snapshot = ctx;
    });

    await act(async () => {
      snapshot?.applyProfile('apple_watch_companion');
    });

    await act(async () => {
      await snapshot?.confirmSystemDevice();
    });

    const monitorCallback = monitorCharacteristicForService.mock.calls[0]?.[2];
    await act(async () => {
      const encodedPayload = require('base-64').encode(
        JSON.stringify({
          timestamp: 1700000000000,
          heartRate: 128,
          distanceKm: 6.4,
          paceSecondsPerKm: 315,
        })
      );
      monitorCallback?.(null, { value: encodedPayload });
      await Promise.resolve();
    });

    const streamCalls = mockRunOrQueue.mock.calls.map((call) => call[0]);
    const metrics = streamCalls.map((call) => call?.payload?.metric).sort();

    expect(mockRunOrQueue).toHaveBeenCalledTimes(3);
    expect(metrics).toEqual(['exercise.distance', 'exercise.hr', 'exercise.pace']);
    expect(streamCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          endpoint: '/api/streams',
          payload: { metric: 'exercise.hr', samples: [{ ts: 1700000000000, value: 128 }] },
        }),
        expect.objectContaining({
          endpoint: '/api/streams',
          payload: { metric: 'exercise.distance', samples: [{ ts: 1700000000000, value: 6.4 }] },
        }),
        expect.objectContaining({
          endpoint: '/api/streams',
          payload: { metric: 'exercise.pace', samples: [{ ts: 1700000000000, value: 315 }] },
        }),
      ])
    );
  });

  it('infers workout metrics from nested JSON payloads on custom profile', async () => {
    const monitorCharacteristicForService = jest.fn();
    mockConnectedDevices.mockResolvedValue([{ id: 'custom-watch', name: 'Custom Watch', rssi: -49 }]);
    mockConnectToDevice.mockResolvedValue({
      discoverAllServicesAndCharacteristics: jest.fn().mockResolvedValue({
        id: 'custom-watch',
        name: 'Custom Watch',
        rssi: -49,
        monitorCharacteristicForService,
      }),
    });

    let snapshot: any = null;
    renderWithProvider((ctx) => {
      snapshot = ctx;
    });

    await act(async () => {
      await snapshot?.confirmSystemDevice();
    });

    const monitorCallback = monitorCharacteristicForService.mock.calls[0]?.[2];
    await act(async () => {
      const encodedPayload = require('base-64').encode(
        JSON.stringify({
          timestamp: 1700002000000,
          workout: {
            heartRate: 141,
            distanceMeters: 4200,
            speedMps: 3.2,
          },
        })
      );
      monitorCallback?.(null, { value: encodedPayload });
      await Promise.resolve();
    });

    const streamPayloads = mockRunOrQueue.mock.calls.map((call) => call[0]?.payload);
    const metrics = streamPayloads.map((payload) => payload?.metric).sort();

    expect(mockRunOrQueue).toHaveBeenCalledTimes(3);
    expect(metrics).toEqual(['exercise.distance', 'exercise.hr', 'exercise.pace']);

    const byMetric = new Map(streamPayloads.map((payload) => [payload.metric, payload]));
    expect(byMetric.get('exercise.hr')?.samples?.[0]).toEqual({ ts: 1700002000000, value: 141 });
    expect(byMetric.get('exercise.distance')?.samples?.[0]?.ts).toBe(1700002000000);
    expect(byMetric.get('exercise.distance')?.samples?.[0]?.value).toBeCloseTo(4.2, 6);
    expect(byMetric.get('exercise.pace')?.samples?.[0]?.ts).toBe(1700002000000);
    expect(byMetric.get('exercise.pace')?.samples?.[0]?.value).toBeCloseTo(312.5, 6);
  });

  it('uploads Apple Watch sleep payload as stream metrics', async () => {
    const monitorCharacteristicForService = jest.fn();
    mockConnectedDevices.mockResolvedValue([{ id: 'watch-bridge', name: 'Watch Bridge', rssi: -44 }]);
    mockConnectToDevice.mockResolvedValue({
      discoverAllServicesAndCharacteristics: jest.fn().mockResolvedValue({
        id: 'watch-bridge',
        name: 'Watch Bridge',
        rssi: -44,
        monitorCharacteristicForService,
      }),
    });

    let snapshot: any = null;
    renderWithProvider((ctx) => {
      snapshot = ctx;
    });

    await act(async () => {
      snapshot?.applyProfile('apple_watch_companion');
    });

    await act(async () => {
      await snapshot?.confirmSystemDevice();
    });

    const monitorCallback = monitorCharacteristicForService.mock.calls[0]?.[2];
    await act(async () => {
      const encodedPayload = require('base-64').encode(
        JSON.stringify({
          timestamp: 1700001000000,
          sleepMinutes: 390,
          deepSleepMinutes: 60,
          remSleepHours: 1.5,
          lightSleepMinutes: 240,
          awakeMinutes: 30,
        })
      );
      monitorCallback?.(null, { value: encodedPayload });
      await Promise.resolve();
    });

    const streamCalls = mockRunOrQueue.mock.calls.map((call) => call[0]);
    const metrics = streamCalls.map((call) => call?.payload?.metric).sort();

    expect(mockRunOrQueue).toHaveBeenCalledTimes(5);
    expect(metrics).toEqual([
      'sleep.awake_hours',
      'sleep.deep_hours',
      'sleep.light_hours',
      'sleep.rem_hours',
      'sleep.total_hours',
    ]);
    expect(streamCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          endpoint: '/api/streams',
          payload: { metric: 'sleep.total_hours', samples: [{ ts: 1700001000000, value: 6.5 }] },
        }),
        expect.objectContaining({
          endpoint: '/api/streams',
          payload: { metric: 'sleep.deep_hours', samples: [{ ts: 1700001000000, value: 1 }] },
        }),
        expect.objectContaining({
          endpoint: '/api/streams',
          payload: { metric: 'sleep.rem_hours', samples: [{ ts: 1700001000000, value: 1.5 }] },
        }),
        expect.objectContaining({
          endpoint: '/api/streams',
          payload: { metric: 'sleep.light_hours', samples: [{ ts: 1700001000000, value: 4 }] },
        }),
        expect.objectContaining({
          endpoint: '/api/streams',
          payload: { metric: 'sleep.awake_hours', samples: [{ ts: 1700001000000, value: 0.5 }] },
        }),
      ])
    );
  });
});
