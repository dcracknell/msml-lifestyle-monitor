import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'msml.activityGoals';

export interface ActivityGoals {
  targetDistanceKm: number;
  targetDurationMin: number;
}

interface StoredGoals extends ActivityGoals {
  minimized: boolean;
}

const DEFAULT_STATE: StoredGoals = {
  targetDistanceKm: 25,
  targetDurationMin: 150,
  minimized: false,
};

export function useActivityGoals() {
  const [state, setState] = useState<StoredGoals>(DEFAULT_STATE);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let canceled = false;
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(STORAGE_KEY);
        if (!stored || canceled) return;
        const parsed = JSON.parse(stored);
        setState((prev) => ({
          targetDistanceKm: sanitizeNumber(parsed.targetDistanceKm, prev.targetDistanceKm),
          targetDurationMin: sanitizeNumber(parsed.targetDurationMin, prev.targetDurationMin),
          minimized: Boolean(parsed.minimized),
        }));
      } catch {
        // ignore corrupted storage
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

  const persist = useCallback((next: StoredGoals) => {
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => {});
  }, []);

  const updateState = useCallback(
    (patch: Partial<StoredGoals>) => {
      setState((prev) => {
        const next = {
          ...prev,
          ...patch,
        };
        persist(next);
        return next;
      });
    },
    [persist]
  );

  const saveGoals = useCallback(
    (nextGoals: ActivityGoals) => {
      updateState({
        targetDistanceKm: sanitizeNumber(nextGoals.targetDistanceKm, DEFAULT_STATE.targetDistanceKm),
        targetDurationMin: sanitizeNumber(nextGoals.targetDurationMin, DEFAULT_STATE.targetDurationMin),
      });
    },
    [updateState]
  );

  const toggleMinimized = useCallback(() => {
    setState((prev) => {
      const next = { ...prev, minimized: !prev.minimized };
      persist(next);
      return next;
    });
  }, [persist]);

  return {
    goals: {
      targetDistanceKm: state.targetDistanceKm,
      targetDurationMin: state.targetDurationMin,
    },
    minimized: state.minimized,
    isReady,
    saveGoals,
    toggleMinimized,
  };
}

function sanitizeNumber(value: unknown, fallback: number) {
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return fallback;
}
