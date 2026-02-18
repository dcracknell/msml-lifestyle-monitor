const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
const imagePickerShimPath = path.resolve(__dirname, 'src/shims/expo-image-picker.ts');
const upstreamResolveRequest = config.resolver?.resolveRequest;

config.resolver = config.resolver || {};
config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules || {}),
  'expo-image-picker': imagePickerShimPath,
};
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'expo-image-picker' || moduleName.startsWith('expo-image-picker/')) {
    return {
      type: 'sourceFile',
      filePath: imagePickerShimPath,
    };
  }
  if (typeof upstreamResolveRequest === 'function') {
    return upstreamResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
