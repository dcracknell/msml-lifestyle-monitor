try {
  // eslint-disable-next-line global-require, import/no-extraneous-dependencies
  require('dotenv').config({ quiet: true });
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
    entitlements: {
      'com.apple.developer.healthkit': true,
    },
    infoPlist: {
      NSBluetoothAlwaysUsageDescription: 'Allow MSML Lifestyle to connect to Bluetooth health sensors.',
      NSBluetoothPeripheralUsageDescription: 'Allow MSML Lifestyle to connect to Bluetooth health sensors.',
      NSBluetoothWhileInUseUsageDescription:
        'Allow MSML Lifestyle to connect to Bluetooth health sensors while you use the app.',
      NSLocationWhenInUseUsageDescription:
        'Allow MSML Lifestyle to track route distance and pace during your workouts.',
      NSLocationAlwaysAndWhenInUseUsageDescription:
        'Allow MSML Lifestyle to track route distance and pace during your workouts.',
      NSCameraUsageDescription: 'Allow MSML Lifestyle to capture meals and scan nutrition barcodes.',
      NSPhotoLibraryUsageDescription: 'Allow MSML Lifestyle to attach meal photos from your library.',
      NSMotionUsageDescription:
        'Allow MSML Lifestyle to read step and movement data from your phone sensors.',
      NSHealthClinicalHealthRecordsShareUsageDescription:
        'Allow MSML Lifestyle to read clinical health records if you choose to share them.',
      NSHealthShareUsageDescription:
        'Allow MSML Lifestyle to read Apple Health data such as steps, heart rate, and sleep.',
      NSHealthUpdateUsageDescription:
        'Allow MSML Lifestyle to write approved training metrics to Apple Health if enabled.',
      NSSensorKitUsageDescription:
        'Allow MSML Lifestyle to access supported sensor data when available.',
      NSUserNotificationUsageDescription:
        'Allow MSML Lifestyle to show live workout stats on your lock screen while recording.',
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
      'android.permission.ACCESS_COARSE_LOCATION',
      'android.permission.ACCESS_FINE_LOCATION',
      'android.permission.ACCESS_BACKGROUND_LOCATION',
      'android.permission.FOREGROUND_SERVICE',
      'android.permission.FOREGROUND_SERVICE_LOCATION',
      'android.permission.ACTIVITY_RECOGNITION',
    ],
    // Google Maps API key for react-native-maps on Android
    ...(process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY
      ? { config: { googleMaps: { apiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY } } }
      : {}),
  },
  web: {
    favicon: './assets/icon.png',
  },
  plugins: [
    'expo-secure-store',
    'expo-font',
    'expo-web-browser',
    [
      'expo-widgets',
      {
        widgets: [
          {
            name: 'ActivityProgressWidget',
            displayName: 'Weekly Progress',
            description: 'See weekly activity goal progress on your Lock Screen.',
            supportedFamilies: [
              'systemSmall',
              'systemMedium',
              'accessoryCircular',
              'accessoryRectangular',
              'accessoryInline',
            ],
          },
          {
            name: 'CurrentRunWidget',
            displayName: 'Current Run',
            description: 'See live distance, pace, and elapsed time for your current or latest run.',
            supportedFamilies: [
              'systemSmall',
              'systemMedium',
              'accessoryCircular',
              'accessoryRectangular',
              'accessoryInline',
            ],
          },
          {
            name: 'DailyCaloriesWidget',
            displayName: 'Daily Calories',
            description: 'Track today’s calorie progress from the Home or Lock Screen.',
            supportedFamilies: [
              'systemSmall',
              'systemMedium',
              'accessoryCircular',
              'accessoryRectangular',
              'accessoryInline',
            ],
          },
        ],
      },
    ],
    [
      'expo-notifications',
      {
        icon: './assets/icon.png',
        color: '#00d2a5',
        sounds: [],
      },
    ],
    [
      'expo-location',
      {
        locationWhenInUsePermission:
          'Allow MSML Lifestyle to track route distance and pace during your workouts.',
        locationAlwaysAndWhenInUsePermission:
          'Allow MSML Lifestyle to keep tracking route distance and pace while the app is in the background.',
        isIosBackgroundLocationEnabled: true,
        isAndroidBackgroundLocationEnabled: true,
      },
    ],
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
