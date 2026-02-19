import type imagePickerShim from '../shims/expo-image-picker';

type ImagePickerModule = typeof imagePickerShim;

const MISSING_IMAGE_PICKER_MESSAGE =
  'Camera and photo library are unavailable in this build. Rebuild and reinstall the app with `npx expo run:ios --device`.';

let cachedImagePicker: ImagePickerModule | null | undefined;

function hasNativeImagePickerModule() {
  const expoRuntime = (globalThis as { expo?: { modules?: Record<string, unknown> } }).expo;
  return Boolean(expoRuntime?.modules?.ExponentImagePicker);
}

function resolveImagePickerModule(): ImagePickerModule | null {
  // Avoid importing `expo-image-picker` unless its native module is already installed.
  if (!hasNativeImagePickerModule()) {
    return null;
  }

  try {
    const imagePickerModule = require('expo-image-picker') as Partial<ImagePickerModule>;
    if (
      imagePickerModule &&
      typeof imagePickerModule.launchCameraAsync === 'function' &&
      typeof imagePickerModule.launchImageLibraryAsync === 'function'
    ) {
      return imagePickerModule as ImagePickerModule;
    }
    return null;
  } catch {
    return null;
  }
}

export function getImagePickerModule(): ImagePickerModule | null {
  if (cachedImagePicker !== undefined) {
    return cachedImagePicker;
  }
  cachedImagePicker = resolveImagePickerModule();
  return cachedImagePicker;
}

export function getImagePickerMissingMessage() {
  return MISSING_IMAGE_PICKER_MESSAGE;
}
