import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

const canUseSecureStore = Platform.OS !== 'web';

const SECURE_WARNING_THRESHOLD = 2048;

async function setSecureItem(key: string, value: string | null) {
  if (value === null) {
    await deleteSecureItem(key);
    return;
  }

  if (value.length > SECURE_WARNING_THRESHOLD) {
    console.warn(
      `SecureStore: Value for ${key} exceeds ${SECURE_WARNING_THRESHOLD} bytes, storing via AsyncStorage fallback.`
    );
    await AsyncStorage.setItem(key, value);
    if (canUseSecureStore && (await SecureStore.isAvailableAsync())) {
      await SecureStore.deleteItemAsync(key);
    }
    return;
  }

  if (canUseSecureStore && (await SecureStore.isAvailableAsync())) {
    await SecureStore.setItemAsync(key, value);
    return;
  }
  await AsyncStorage.setItem(key, value);
}

async function getSecureItem(key: string) {
  const asyncValue = await AsyncStorage.getItem(key);
  if (asyncValue !== null) {
    return asyncValue;
  }
  if (canUseSecureStore && (await SecureStore.isAvailableAsync())) {
    const value = await SecureStore.getItemAsync(key);
    if (value !== null) {
      return value;
    }
  }
  return null;
}

async function deleteSecureItem(key: string) {
  if (canUseSecureStore && (await SecureStore.isAvailableAsync())) {
    await SecureStore.deleteItemAsync(key);
  }
  await AsyncStorage.removeItem(key);
}

export const secureStorage = {
  setItem: setSecureItem,
  getItem: getSecureItem,
  deleteItem: deleteSecureItem,
};
