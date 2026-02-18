try {
  // eslint-disable-next-line global-require, import/no-extraneous-dependencies
  require('dotenv').config();
} catch (error) {
  if (error && error.code !== 'MODULE_NOT_FOUND') {
    console.warn('Failed to load .env file:', error);
  }
}

const iosBundleIdentifier =
  process.env.EXPO_PUBLIC_IOS_BUNDLE_IDENTIFIER ||
  process.env.IOS_BUNDLE_IDENTIFIER ||
  'com.dcracknell.msml.lifestyle';
const androidPackage =
  process.env.EXPO_PUBLIC_ANDROID_PACKAGE ||
  process.env.ANDROID_PACKAGE ||
  'com.dcracknell.msml.lifestyle';
const appleTeamId = process.env.APPLE_TEAM_ID;

export default ({ config }) => ({
  ...config,
  name: 'MSML Lifestyle',
  slug: 'msml-lifestyle-mobile',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  scheme: 'msml',
  userInterfaceStyle: 'automatic',
  jsEngine: 'hermes',
  splash: {
    image: './assets/splash.png',
    resizeMode: 'contain',
    backgroundColor: '#010915',
  },
  assetBundlePatterns: ['**/*'],
  updates: {
    fallbackToCacheTimeout: 0,
  },
  ios: {
    supportsTablet: true,
    bundleIdentifier: iosBundleIdentifier,
    icon: './assets/icon.png',
    ...(appleTeamId ? { appleTeamId } : {}),
    infoPlist: {
      NSBluetoothAlwaysUsageDescription: 'Allow MSML Lifestyle to connect to Bluetooth health sensors.',
      NSBluetoothPeripheralUsageDescription: 'Allow MSML Lifestyle to connect to Bluetooth health sensors.',
      NSLocationWhenInUseUsageDescription:
        'Allow MSML Lifestyle to track route distance and pace during your workouts.',
      NSLocationAlwaysAndWhenInUseUsageDescription:
        'Allow MSML Lifestyle to track route distance and pace during your workouts.',
      NSCameraUsageDescription: 'Allow MSML Lifestyle to capture meals and scan nutrition barcodes.',
      NSPhotoLibraryUsageDescription: 'Allow MSML Lifestyle to attach meal photos from your library.',
      NSMotionUsageDescription:
        'Allow MSML Lifestyle to read step and movement data from your phone sensors.',
    },
  },
  android: {
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon-foreground.png',
      monochromeImage: './assets/adaptive-icon-foreground.png',
      backgroundColor: '#010915',
    },
    package: androidPackage,
    permissions: [
      'android.permission.CAMERA',
      'android.permission.ACTIVITY_RECOGNITION',
      'android.permission.BLUETOOTH_SCAN',
      'android.permission.BLUETOOTH_CONNECT',
      'android.permission.ACCESS_FINE_LOCATION',
    ],
  },
  web: {
    favicon: './assets/icon.png',
  },
  plugins: [
    'expo-secure-store',
    'expo-font',
    'expo-web-browser',
    [
      'expo-image-picker',
      {
        photosPermission: 'Allow MSML Lifestyle to attach meal photos from your library.',
        cameraPermission: 'Allow MSML Lifestyle to capture meals and scan nutrition barcodes.',
      },
    ],
    [
      'expo-camera',
      {
        cameraPermission: 'Allow MSML Lifestyle to capture meals and scan nutrition barcodes.',
      },
    ],
  ],
  extra: {
    apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL || 'https://www.msmls.org',
    webAppOrigin: process.env.EXPO_PUBLIC_WEB_APP_ORIGIN || 'https://www.msmls.org',
  },
});
