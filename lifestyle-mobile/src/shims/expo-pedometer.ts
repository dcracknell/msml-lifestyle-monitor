type PermissionResponse = {
  granted: boolean;
  canAskAgain: boolean;
  status: 'granted' | 'denied' | 'undetermined';
  expires: 'never';
};

type StepCountResponse = {
  steps: number;
};

function deniedPermission(): PermissionResponse {
  return {
    granted: false,
    canAskAgain: true,
    status: 'denied',
    expires: 'never',
  };
}

function getRealPedometer(): any | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    const sensors = require('expo-sensors');
    return sensors?.Pedometer ?? null;
  } catch {
    return null;
  }
}

async function callReal<TReturn>(method: string, fallback: TReturn, ...args: any[]): Promise<TReturn> {
  const pedometer = getRealPedometer();
  const fn = pedometer?.[method];
  if (typeof fn !== 'function') {
    return fallback;
  }
  try {
    return await fn(...args);
  } catch {
    return fallback;
  }
}

export const pedometer = {
  isAvailableAsync: async () => callReal('isAvailableAsync', false),
  getPermissionsAsync: async () => callReal('getPermissionsAsync', deniedPermission()),
  requestPermissionsAsync: async () => callReal('requestPermissionsAsync', deniedPermission()),
  getStepCountAsync: async (start: Date, end: Date) =>
    callReal<StepCountResponse>('getStepCountAsync', { steps: 0 }, start, end),
};
