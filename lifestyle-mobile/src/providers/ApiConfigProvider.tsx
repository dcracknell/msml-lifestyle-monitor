import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import apiClient from '../api/client';
import { API_BASE_URL } from '../config/env';

const STORAGE_KEY = 'msml.api.base-url';

interface ApiConfigContextValue {
  apiBaseUrl: string;
  isReady: boolean;
  updateBaseUrl: (nextUrl: string) => Promise<void>;
  resetBaseUrl: () => Promise<void>;
}

const ApiConfigContext = createContext<ApiConfigContextValue | undefined>(undefined);

export function ApiConfigProvider({ children }: { children: React.ReactNode }) {
  const [apiBaseUrl, setApiBaseUrl] = useState(API_BASE_URL);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let canceled = false;
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(STORAGE_KEY);
        if (stored && !canceled) {
          apiClient.setBaseUrl(stored);
          setApiBaseUrl(stored);
        } else if (!stored) {
          apiClient.setBaseUrl(API_BASE_URL);
        }
      } catch (error) {
        console.warn('Unable to read stored API base URL override', error);
      } finally {
        if (!canceled) {
          setIsReady(true);
        }
      }
    })();
    return () => {
      canceled = true;
    };
  }, []);

  const persistUpdate = useCallback(async (next: string) => {
    const trimmed = next.trim();
    if (!trimmed) {
      throw new Error('Enter a valid URL.');
    }
    let normalized = trimmed.replace(/\/+$/, '');
    try {
      const parsed = new URL(trimmed.startsWith('http') ? trimmed : `http://${trimmed}`);
      normalized = parsed.toString().replace(/\/+$/, '');
    } catch (error) {
      throw new Error('Enter a valid http or https URL.');
    }
    apiClient.setBaseUrl(normalized);
    setApiBaseUrl(normalized);
    await AsyncStorage.setItem(STORAGE_KEY, normalized);
  }, []);

  const resetBaseUrl = useCallback(async () => {
    await AsyncStorage.removeItem(STORAGE_KEY);
    apiClient.setBaseUrl(API_BASE_URL);
    setApiBaseUrl(API_BASE_URL);
  }, []);

  const value = useMemo(
    () => ({
      apiBaseUrl,
      isReady,
      updateBaseUrl: persistUpdate,
      resetBaseUrl,
    }),
    [apiBaseUrl, isReady, persistUpdate, resetBaseUrl]
  );

  return <ApiConfigContext.Provider value={value}>{children}</ApiConfigContext.Provider>;
}

export function useApiConfig() {
  const context = useContext(ApiConfigContext);
  if (!context) {
    throw new Error('useApiConfig must be used within ApiConfigProvider');
  }
  return context;
}
