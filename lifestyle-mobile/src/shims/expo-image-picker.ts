type PermissionResponse = {
  granted: boolean;
  canAskAgain: boolean;
  status: 'granted' | 'denied' | 'undetermined';
  expires: 'never';
};

type ImagePickerAsset = {
  uri: string;
  width?: number;
  height?: number;
  base64?: string | null;
};

type ImagePickerResult = {
  canceled: boolean;
  assets: ImagePickerAsset[] | null;
};

const UNAVAILABLE_MESSAGE =
  'Image picker is unavailable in this build. Rebuild and reinstall the app.';

function unavailableError(method: string) {
  return new Error(`expo-image-picker.${method} unavailable: ${UNAVAILABLE_MESSAGE}`);
}

function deniedPermission(): PermissionResponse {
  return {
    granted: false,
    canAskAgain: false,
    status: 'denied',
    expires: 'never',
  };
}

function canceledResult(): ImagePickerResult {
  return {
    canceled: true,
    assets: null,
  };
}

function getRealModule(): any | null {
  // Deliberately disabled to avoid native module startup crashes in stale dev builds.
  // Re-enable by removing this shim once the iOS build is cleanly rebuilt with expo-image-picker.
  return null;
}

async function callReal<TReturn>(method: string, fallback: TReturn, ...args: any[]): Promise<TReturn> {
  const mod = getRealModule();
  const fn = mod?.[method];
  if (typeof fn !== 'function') {
    return fallback;
  }
  try {
    return await fn(...args);
  } catch {
    return fallback;
  }
}

export const PermissionStatus = {
  UNDETERMINED: 'undetermined',
  DENIED: 'denied',
  GRANTED: 'granted',
} as const;

export async function requestCameraPermissionsAsync() {
  return callReal('requestCameraPermissionsAsync', deniedPermission());
}

export async function requestMediaLibraryPermissionsAsync(writeOnly = false) {
  return callReal('requestMediaLibraryPermissionsAsync', deniedPermission(), writeOnly);
}

export async function getCameraPermissionsAsync() {
  return callReal('getCameraPermissionsAsync', deniedPermission());
}

export async function getMediaLibraryPermissionsAsync(writeOnly = false) {
  return callReal('getMediaLibraryPermissionsAsync', deniedPermission(), writeOnly);
}

export async function launchCameraAsync(options: any = {}) {
  const mod = getRealModule();
  const fn = mod?.launchCameraAsync;
  if (typeof fn !== 'function') {
    throw unavailableError('launchCameraAsync');
  }
  try {
    return await fn(options);
  } catch {
    return canceledResult();
  }
}

export async function launchImageLibraryAsync(options: any = {}) {
  const mod = getRealModule();
  const fn = mod?.launchImageLibraryAsync;
  if (typeof fn !== 'function') {
    throw unavailableError('launchImageLibraryAsync');
  }
  try {
    return await fn(options);
  } catch {
    return canceledResult();
  }
}

export async function getPendingResultAsync() {
  return callReal('getPendingResultAsync', []);
}

export function useCameraPermissions() {
  return [
    null,
    async () => requestCameraPermissionsAsync(),
    async () => getCameraPermissionsAsync(),
  ] as const;
}

export function useMediaLibraryPermissions() {
  return [
    null,
    async () => requestMediaLibraryPermissionsAsync(),
    async () => getMediaLibraryPermissionsAsync(),
  ] as const;
}

export default {
  requestCameraPermissionsAsync,
  requestMediaLibraryPermissionsAsync,
  getCameraPermissionsAsync,
  getMediaLibraryPermissionsAsync,
  launchCameraAsync,
  launchImageLibraryAsync,
  getPendingResultAsync,
  useCameraPermissions,
  useMediaLibraryPermissions,
  PermissionStatus,
};
