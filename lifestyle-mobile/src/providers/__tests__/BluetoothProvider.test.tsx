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
});
