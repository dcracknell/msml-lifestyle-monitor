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

export const PermissionStatus = {
  UNDETERMINED: 'undetermined',
  DENIED: 'denied',
  GRANTED: 'granted',
} as const;

export async function requestCameraPermissionsAsync() {
  return deniedPermission();
}

export async function requestMediaLibraryPermissionsAsync(writeOnly = false) {
  void writeOnly;
  return deniedPermission();
}

export async function getCameraPermissionsAsync() {
  return deniedPermission();
}

export async function getMediaLibraryPermissionsAsync(writeOnly = false) {
  void writeOnly;
  return deniedPermission();
}

export async function launchCameraAsync(options: any = {}) {
  void options;
  return canceledResult();
}

export async function launchImageLibraryAsync(options: any = {}) {
  void options;
  return canceledResult();
}

export async function getPendingResultAsync() {
  return [];
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
