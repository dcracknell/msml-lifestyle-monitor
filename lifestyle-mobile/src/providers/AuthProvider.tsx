import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import apiClient from '../api/client';
import { loginRequest, logoutRequest, signupRequest } from '../api/endpoints';
import { SessionPayload, UserProfile } from '../api/types';
import { clearSession, readSession, saveSession } from '../storage/session';

interface AuthContextValue {
  user: UserProfile | null;
  token: string | null;
  isRestoring: boolean;
  isAuthenticating: boolean;
  signIn: (payload: { email: string; password: string }) => Promise<void>;
  signUp: (payload: {
    name: string;
    email: string;
    password: string;
    avatar?: string | null;
    avatarPhoto?: string | null;
  }) => Promise<void>;
  signOut: () => Promise<void>;
  refreshUser: (user: UserProfile) => Promise<void>;
  setSessionFromPayload: (session: SessionPayload | null) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<SessionPayload | null>(null);
  const [isRestoring, setIsRestoring] = useState(true);
  const [isAuthenticating, setIsAuthenticating] = useState(false);

  useEffect(() => {
    let isMounted = true;
    (async () => {
      const stored = await readSession();
      if (!isMounted) return;
      if (stored) {
        setSession(stored);
        apiClient.setAuthToken(stored.token);
      }
      setIsRestoring(false);
    })();
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    apiClient.setAuthToken(session?.token || null);
  }, [session?.token]);

  const persistSession = useCallback(async (payload: SessionPayload | null) => {
    if (payload) {
      await saveSession(payload);
    } else {
      await clearSession();
    }
    setSession(payload);
    apiClient.setAuthToken(payload?.token || null);
  }, []);

  const signIn = useCallback(
    async (payload: { email: string; password: string }) => {
      setIsAuthenticating(true);
      try {
        const nextSession = await loginRequest(payload);
        await persistSession(nextSession);
      } finally {
        setIsAuthenticating(false);
      }
    },
    [persistSession]
  );

  const signUp = useCallback(
    async (payload: {
      name: string;
      email: string;
      password: string;
      avatar?: string | null;
      avatarPhoto?: string | null;
    }) => {
      setIsAuthenticating(true);
      try {
        const nextSession = await signupRequest(payload);
        await persistSession(nextSession);
      } finally {
        setIsAuthenticating(false);
      }
    },
    [persistSession]
  );

  const signOut = useCallback(async () => {
    try {
      await logoutRequest();
    } catch (error) {
      // ignore network failures on logout
    }
    await persistSession(null);
  }, [persistSession]);

  const refreshUser = useCallback(
    async (user: UserProfile) => {
      if (!session) return;
      const updated = { ...session, user };
      await persistSession(updated);
    },
    [persistSession, session]
  );

  const value = useMemo(
    () => ({
      user: session?.user || null,
      token: session?.token || null,
      isRestoring,
      isAuthenticating,
      signIn,
      signUp,
      signOut,
      refreshUser,
      setSessionFromPayload: persistSession,
    }),
    [session, isRestoring, isAuthenticating, signIn, signUp, signOut, refreshUser, persistSession]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return context;
}
