try {
  // eslint-disable-next-line global-require, import/no-extraneous-dependencies
  require('dotenv').config();
} catch (error) {
  if (error && error.code !== 'MODULE_NOT_FOUND') {
    console.warn('Failed to load .env file:', error);
  }
}

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
    bundleIdentifier: 'com.msml.lifestyle',
    infoPlist: {
      NSCameraUsageDescription: 'Allow MSML Lifestyle to capture meals and scan nutrition barcodes.',
      NSPhotoLibraryUsageDescription: 'Allow MSML Lifestyle to attach meal photos from your library.',
    },
  },
  android: {
    adaptiveIcon: {
      foregroundImage: './assets/icon.png',
      backgroundColor: '#010915',
    },
    package: 'com.msml.lifestyle',
    permissions: ['android.permission.CAMERA'],
  },
  web: {
    favicon: './assets/icon.png',
  },
  plugins: [
    'expo-secure-store',
    'expo-font',
    'expo-web-browser',
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
