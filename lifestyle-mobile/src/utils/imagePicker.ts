import type * as ExpoImagePicker from 'expo-image-picker';

type ImagePickerModule = typeof ExpoImagePicker;

let cachedModule: ImagePickerModule | null | undefined;

const MISSING_IMAGE_PICKER_MESSAGE =
  'Camera and photo library are unavailable in this build. Rebuild and reinstall the app with `npx expo run:ios --device`.';

export function getImagePickerModule(): ImagePickerModule | null {
  if (cachedModule !== undefined) {
    return cachedModule;
  }

  try {
    // Loaded lazily so the app does not crash on startup if the native module is missing.
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    cachedModule = require('expo-image-picker') as ImagePickerModule;
  } catch {
    cachedModule = null;
  }

  return cachedModule;
}

export function getImagePickerMissingMessage() {
  return MISSING_IMAGE_PICKER_MESSAGE;
}

