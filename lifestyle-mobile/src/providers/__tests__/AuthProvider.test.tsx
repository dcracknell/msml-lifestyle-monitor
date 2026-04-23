import { ReactNode } from 'react';
import { act, cleanup, render, waitFor } from '@testing-library/react';

const mockReadSession = jest.fn();
const mockSaveSession = jest.fn();
const mockClearSession = jest.fn();
const mockSetAuthToken = jest.fn();

jest.mock('../../storage/session', () => ({
  readSession: (...args: unknown[]) => mockReadSession(...args),
  saveSession: (...args: unknown[]) => mockSaveSession(...args),
  clearSession: (...args: unknown[]) => mockClearSession(...args),
}));

jest.mock('../../api/client', () => ({
  __esModule: true,
  default: {
    setAuthToken: (...args: unknown[]) => mockSetAuthToken(...args),
  },
}));

const { AuthProvider, useAuth } = require('../AuthProvider') as typeof import('../AuthProvider');

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
});

async function renderWithProvider(probe: (value: ReturnType<typeof useAuth>) => void) {
  function Probe({ children }: { children?: ReactNode }) {
    probe(useAuth());
    return children ?? null;
  }

  await act(async () => {
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );
  });
}

describe('AuthProvider session restoration', () => {
  it('restores a stored session and clears the loading state', async () => {
    const storedSession = {
      token: 'token-123',
      user: {
        id: 7,
        name: 'Jordan Athlete',
        email: 'jordan@example.com',
        role: 'athlete',
      },
    };
    mockReadSession.mockResolvedValueOnce(storedSession);

    let latest = null as ReturnType<typeof useAuth> | null;
    await renderWithProvider((value) => {
      latest = value;
    });

    await waitFor(() => expect(latest?.isRestoring).toBe(false));

    expect(latest?.token).toBe('token-123');
    expect(latest?.user?.name).toBe('Jordan Athlete');
    expect(mockSetAuthToken).toHaveBeenLastCalledWith('token-123');
  });

  it('falls back to a signed-out state when session restore fails', async () => {
    const warning = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockReadSession.mockRejectedValueOnce(new Error('SecureStore unavailable'));

    let latest = null as ReturnType<typeof useAuth> | null;
    await renderWithProvider((value) => {
      latest = value;
    });

    await waitFor(() => expect(latest?.isRestoring).toBe(false));

    expect(latest?.user).toBeNull();
    expect(latest?.token).toBeNull();
    expect(mockSetAuthToken).toHaveBeenLastCalledWith(null);
    expect(warning).toHaveBeenCalledWith('Unable to restore session', expect.any(Error));

    warning.mockRestore();
  });
});
