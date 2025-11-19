import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'msml.weight.bodyMetrics';
const DEFAULT_HEIGHT_CM = 175;

export function useBodyMetrics() {
  const [heightCm, setHeightCm] = useState(DEFAULT_HEIGHT_CM);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let canceled = false;
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(STORAGE_KEY);
        if (!stored || canceled) {
          return;
        }
        const parsed = JSON.parse(stored);
        const normalized = sanitizeHeight(parsed?.heightCm);
        if (!canceled && normalized) {
          setHeightCm(normalized);
        }
      } catch {
        // ignore storage errors
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

  const saveHeight = useCallback((nextHeight: number) => {
    const normalized = sanitizeHeight(nextHeight) ?? DEFAULT_HEIGHT_CM;
    setHeightCm(normalized);
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ heightCm: normalized })).catch(() => {});
  }, []);

  return { heightCm, isReady, saveHeight };
}

function sanitizeHeight(value?: number) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  if (numeric < 120 || numeric > 240) {
    return null;
  }
  return Math.round(numeric);
}
