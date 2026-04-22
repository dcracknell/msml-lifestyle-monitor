import { requireOptionalNativeModule } from 'expo-modules-core';
import { WIDGETS_ENABLED } from '../config/env';

export function hasWidgetNativeModules() {
  if (!WIDGETS_ENABLED) {
    return false;
  }

  return Boolean(
    requireOptionalNativeModule('ExpoWidgets') &&
      requireOptionalNativeModule('ExpoUI')
  );
}
