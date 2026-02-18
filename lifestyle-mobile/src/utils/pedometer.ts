export interface PedometerPermissionResponse {
  status?: string;
  granted?: boolean;
  canAskAgain?: boolean;
}

export interface PedometerStepCountResponse {
  steps?: number;
}

export interface PedometerApi {
  isAvailableAsync?: () => Promise<boolean>;
  requestPermissionsAsync?: () => Promise<PedometerPermissionResponse>;
  getPermissionsAsync?: () => Promise<PedometerPermissionResponse>;
  getStepCountAsync?: (start: Date, end: Date) => Promise<PedometerStepCountResponse>;
}

interface ExpoSensorsModule {
  Pedometer?: PedometerApi;
}

let cachedPedometer: PedometerApi | null | undefined;

const MISSING_PEDOMETER_MESSAGE =
  'Phone motion data is unavailable in this build. Install `expo-sensors` and rebuild the app.';

export function getPedometerModule(): PedometerApi | null {
  if (cachedPedometer !== undefined) {
    return cachedPedometer;
  }

  try {
    // Loaded lazily so startup remains stable when native modules are missing.
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    const module = require('expo-sensors') as ExpoSensorsModule;
    cachedPedometer = module?.Pedometer || null;
  } catch {
    cachedPedometer = null;
  }

  return cachedPedometer;
}

export function getPedometerMissingMessage() {
  return MISSING_PEDOMETER_MESSAGE;
}

export function isPermissionGranted(permission: PedometerPermissionResponse | null | undefined) {
  if (!permission) {
    return true;
  }
  if (typeof permission.granted === 'boolean') {
    return permission.granted;
  }
  return permission.status === 'granted';
}
