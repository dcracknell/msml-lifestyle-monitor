import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import apiClient, { ApiError, HttpMethod } from '../api/client';
import { useConnectivity } from './ConnectivityProvider';

const QUEUE_KEY = 'msml.sync.queue';

export interface SyncTask {
  id: string;
  endpoint: string;
  method: HttpMethod;
  payload?: Record<string, unknown> | null;
  description?: string;
}

interface SyncRequest<T> {
  id?: string;
  endpoint: string;
  method?: HttpMethod;
  payload?: Record<string, unknown> | null;
  description?: string;
}

interface SyncResult<T> {
  status: 'sent' | 'queued';
  result?: T;
  task?: SyncTask;
}

interface SyncContextValue {
  queue: SyncTask[];
  isSyncing: boolean;
  runOrQueue: <T>(task: SyncRequest<T>) => Promise<SyncResult<T>>;
  flush: () => Promise<void>;
}

const SyncContext = createContext<SyncContextValue | undefined>(undefined);

export function SyncProvider({ children }: { children: React.ReactNode }) {
  const { isOnline } = useConnectivity();
  const [queue, setQueue] = useState<SyncTask[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const queueRef = useRef<SyncTask[]>([]);

  useEffect(() => {
    let canceled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(QUEUE_KEY);
        if (raw && !canceled) {
          const parsed: SyncTask[] = JSON.parse(raw);
          queueRef.current = parsed;
          setQueue(parsed);
        }
      } catch (error) {
        console.warn('Failed to load sync queue', error);
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

  const persistQueue = useCallback((next: SyncTask[]) => {
    queueRef.current = next;
    setQueue(next);
    AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(next)).catch(() => {});
  }, []);

  const removeTask = useCallback(
    (taskId: string) => {
      persistQueue(queueRef.current.filter((task) => task.id !== taskId));
    },
    [persistQueue]
  );

  const runOrQueue = useCallback(
    async <T,>(task: SyncRequest<T>): Promise<SyncResult<T>> => {
      const requestInit = {
        method: task.method || 'POST',
        body: task.payload || undefined,
      };
      if (isOnline) {
        try {
          const result = await apiClient.request<T>(task.endpoint, requestInit);
          return { status: 'sent', result };
        } catch (error) {
          if (!(error instanceof ApiError && error.isNetworkError)) {
            throw error;
          }
        }
      }

      const queuedTask: SyncTask = {
        id: task.id || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        endpoint: task.endpoint,
        method: (task.method || 'POST') as HttpMethod,
        payload: task.payload,
        description: task.description,
      };
      persistQueue([...queueRef.current, queuedTask]);
      return { status: 'queued', task: queuedTask };
    },
    [isOnline, persistQueue]
  );

  const flush = useCallback(async () => {
    if (!isReady || isSyncing || !isOnline) return;
    if (!queueRef.current.length) return;
    setIsSyncing(true);
    try {
      for (const task of [...queueRef.current]) {
        try {
          await apiClient.request(task.endpoint, {
            method: task.method,
            body: task.payload || undefined,
          });
          removeTask(task.id);
        } catch (error) {
          if (error instanceof ApiError && error.isNetworkError) {
            break; // Wait for connectivity to improve
          }
          console.warn('Sync task failed, dropping entry:', error);
          removeTask(task.id);
        }
      }
    } finally {
      setIsSyncing(false);
    }
  }, [isReady, isSyncing, isOnline, removeTask]);

  useEffect(() => {
    if (isOnline) {
      flush();
    }
  }, [isOnline, flush]);

  const value = useMemo(
    () => ({
      queue,
      isSyncing,
      runOrQueue,
      flush,
    }),
    [queue, isSyncing, runOrQueue, flush]
  );

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

export function useSyncQueue() {
  const context = useContext(SyncContext);
  if (!context) {
    throw new Error('useSyncQueue must be used within SyncProvider');
  }
  return context;
}
