import { requireOptionalNativeModule } from 'expo-modules-core';

export function hasWidgetNativeModules() {
  return Boolean(
    requireOptionalNativeModule('ExpoWidgets') &&
      requireOptionalNativeModule('ExpoUI')
  );
}
