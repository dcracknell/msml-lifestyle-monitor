import { SessionPayload } from '../api/types';
import { secureStorage } from './secure';

const SESSION_KEY = 'msml.session';

export async function saveSession(payload: SessionPayload) {
  await secureStorage.setItem(SESSION_KEY, JSON.stringify(payload));
}

export async function readSession(): Promise<SessionPayload | null> {
  const stored = await secureStorage.getItem(SESSION_KEY);
  if (!stored) {
    return null;
  }
  try {
    return JSON.parse(stored) as SessionPayload;
  } catch (error) {
    await secureStorage.deleteItem(SESSION_KEY);
    return null;
  }
}

export async function clearSession() {
  await secureStorage.deleteItem(SESSION_KEY);
}
