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

type ExpoModulesRegistry = Record<string, unknown>;

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

const imagePickerFallback = {
  requestCameraPermissionsAsync: async () => deniedPermission(),
  requestMediaLibraryPermissionsAsync: async () => deniedPermission(),
  getCameraPermissionsAsync: async () => deniedPermission(),
  getMediaLibraryPermissionsAsync: async () => deniedPermission(),
  launchCameraAsync: async () => canceledResult(),
  launchImageLibraryAsync: async () => canceledResult(),
  getPendingResultAsync: async () => null,
};

function installImagePickerFallback() {
  const runtime = (globalThis as { expo?: { modules?: ExpoModulesRegistry } }).expo;
  if (!runtime) {
    if (__DEV__) {
      console.info('[msml] expo runtime unavailable while installing native module fallbacks.');
    }
    return;
  }
  const modules = (runtime.modules ??= {});
  if (!modules.ExponentImagePicker) {
    modules.ExponentImagePicker = imagePickerFallback;
    if (__DEV__) {
      console.info('[msml] installed ExponentImagePicker JS fallback.');
    }
  } else if (__DEV__) {
    console.info('[msml] native ExponentImagePicker is available.');
  }
}

installImagePickerFallback();
