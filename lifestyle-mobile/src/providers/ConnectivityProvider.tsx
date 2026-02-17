import { AppState, AppStateStatus } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { focusManager, onlineManager } from '@tanstack/react-query';

interface ConnectivityContextValue {
  isOnline: boolean;
}

const ConnectivityContext = createContext<ConnectivityContextValue | undefined>(undefined);

export function ConnectivityProvider({ children }: { children: React.ReactNode }) {
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      const reachable = state.isConnected && state.isInternetReachable !== false;
      setIsOnline(Boolean(reachable));
      onlineManager.setOnline(Boolean(reachable));
    });
    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    const onChange = (status: AppStateStatus) => {
      focusManager.setFocused(status === 'active');
    };
    const sub = AppState.addEventListener('change', onChange);
    return () => {
      sub.remove();
    };
  }, []);

  const value = useMemo(() => ({ isOnline }), [isOnline]);

  return <ConnectivityContext.Provider value={value}>{children}</ConnectivityContext.Provider>;
}

export function useConnectivity() {
  const ctx = useContext(ConnectivityContext);
  if (!ctx) {
    throw new Error('useConnectivity must be used within ConnectivityProvider');
  }
  return ctx;
}
