import { NativeModules, PermissionsAndroid, Platform } from 'react-native';

type PermissionResponse = {
  granted: boolean;
  canAskAgain: boolean;
  status: 'granted' | 'denied' | 'undetermined';
  expires: 'never';
};

type StepCountResponse = {
  steps: number;
};

type NativePedometerModule = {
  getStepCountAsync?: (start: number, end: number) => Promise<{ steps?: number } | number>;
};

function deniedPermission(canAskAgain = true): PermissionResponse {
  return {
    granted: false,
    canAskAgain,
    status: 'denied',
    expires: 'never',
  };
}

function grantedPermission(): PermissionResponse {
  return {
    granted: true,
    canAskAgain: true,
    status: 'granted',
    expires: 'never',
  };
}

function getNativePedometerModule(): NativePedometerModule | null {
  const module =
    NativeModules.ExponentPedometer || NativeModules.EXPedometer || NativeModules.ExpoPedometer || null;
  return module;
}

async function requestAndroidActivityPermission(): Promise<PermissionResponse> {
  if (Platform.OS !== 'android') {
    return grantedPermission();
  }

  if (typeof PermissionsAndroid.PERMISSIONS.ACTIVITY_RECOGNITION !== 'string') {
    return grantedPermission();
  }

  const current = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.ACTIVITY_RECOGNITION);
  if (current) {
    return grantedPermission();
  }

  const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACTIVITY_RECOGNITION);
  if (result === PermissionsAndroid.RESULTS.GRANTED) {
    return grantedPermission();
  }
  return deniedPermission(result !== PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN);
}

export const pedometer = {
  async isAvailableAsync() {
    return Boolean(getNativePedometerModule()?.getStepCountAsync);
  },
  async getPermissionsAsync() {
    return requestAndroidActivityPermission();
  },
  async requestPermissionsAsync() {
    return requestAndroidActivityPermission();
  },
  async getStepCountAsync(start: Date, end: Date): Promise<StepCountResponse> {
    const module = getNativePedometerModule();
    const fn = module?.getStepCountAsync;
    if (typeof fn !== 'function') {
      return { steps: 0 };
    }

    try {
      const result = await fn(start.getTime(), end.getTime());
      if (typeof result === 'number' && Number.isFinite(result)) {
        return { steps: Math.max(0, Math.round(result)) };
      }
      const stepValue =
        typeof result === 'object' && result && typeof result.steps === 'number' && Number.isFinite(result.steps)
          ? result.steps
          : 0;
      return { steps: Math.max(0, Math.round(stepValue)) };
    } catch {
      return { steps: 0 };
    }
  },
};
