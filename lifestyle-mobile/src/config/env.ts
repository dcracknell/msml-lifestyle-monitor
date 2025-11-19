import { Platform } from 'react-native';
import Constants from 'expo-constants';

type Extra = {
  apiBaseUrl?: string;
  webAppOrigin?: string;
};

const runtimeExtra: Extra =
  (Constants.expoConfig?.extra as Extra | undefined) ||
  (Constants.manifest?.extra as Extra | undefined) ||
  {};

const fallbackBaseUrl = 'http://localhost:4000';

function getExpoLanHost() {
  const debuggerHost =
    Constants.expoGoConfig?.debuggerHost ||
    (Constants as any).expoConfig?.debuggerHost ||
    Constants.manifest?.debuggerHost;
  const hostUri =
    Constants.expoGoConfig?.hostUri ||
    (Constants as any).expoConfig?.hostUri ||
    Constants.manifest?.hostUri;
  const source = debuggerHost || hostUri;
  if (!source) return null;
  return source.split(':')[0];
}

function resolveBaseUrl() {
  const candidate =
    process.env.EXPO_PUBLIC_API_BASE_URL || runtimeExtra.apiBaseUrl || fallbackBaseUrl;

  if (Platform.OS === 'web') {
    return candidate;
  }

  if (!candidate || !/localhost|127\.0\.0\.1/i.test(candidate)) {
    return candidate;
  }

  const lanHost = getExpoLanHost();
  const platformFallbackHost = Platform.OS === 'android' ? '10.0.2.2' : Platform.OS === 'ios' ? '127.0.0.1' : null;

  const replacementHost = lanHost || platformFallbackHost;
  if (!replacementHost) {
    return candidate;
  }

  try {
    const url = new URL(candidate);
    url.hostname = replacementHost;
    return url.toString();
  } catch (error) {
    return candidate.replace(/localhost|127\.0\.0\.1/gi, replacementHost);
  }
}

export const API_BASE_URL = resolveBaseUrl();

export const WEB_APP_ORIGIN =
  process.env.EXPO_PUBLIC_WEB_APP_ORIGIN || runtimeExtra.webAppOrigin || API_BASE_URL;
