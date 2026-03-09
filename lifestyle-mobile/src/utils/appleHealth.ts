import { NativeModules, Platform } from 'react-native';
import {
  AppleHealthPayload,
  AppleHealthQuantitySample,
  AppleHealthWorkoutSample,
} from '../features/profile/appleHealthImport';

type AppleHealthCallback<T> = (error?: unknown, results?: T) => void;
type AppleHealthReadOptions = { startDate: string; endDate: string; [key: string]: unknown };

interface NativeAppleHealthModule {
  isAvailable?: (callback: AppleHealthCallback<boolean>) => void;
  initHealthKit?: (
    permissions: { permissions: { read: string[]; write: string[] } },
    callback: AppleHealthCallback<boolean>
  ) => void;
  getDailyStepCountSamples?: (
    options: AppleHealthReadOptions,
    callback: AppleHealthCallback<AppleHealthQuantitySample[]>
  ) => void;
  getDailyDistanceWalkingRunningSamples?: (
    options: AppleHealthReadOptions,
    callback: AppleHealthCallback<AppleHealthQuantitySample[]>
  ) => void;
  getActiveEnergyBurned?: (
    options: AppleHealthReadOptions,
    callback: AppleHealthCallback<AppleHealthQuantitySample[]>
  ) => void;
  getAppleExerciseTime?: (
    options: AppleHealthReadOptions,
    callback: AppleHealthCallback<AppleHealthQuantitySample[]>
  ) => void;
  getHeartRateSamples?: (
    options: AppleHealthReadOptions,
    callback: AppleHealthCallback<AppleHealthQuantitySample[]>
  ) => void;
  getRestingHeartRateSamples?: (
    options: AppleHealthReadOptions,
    callback: AppleHealthCallback<AppleHealthQuantitySample[]>
  ) => void;
  getBloodGlucoseSamples?: (
    options: AppleHealthReadOptions,
    callback: AppleHealthCallback<AppleHealthQuantitySample[]>
  ) => void;
  getSleepSamples?: (
    options: AppleHealthReadOptions,
    callback: AppleHealthCallback<AppleHealthQuantitySample[]>
  ) => void;
  getSamples?: (
    options: AppleHealthReadOptions & { type?: string },
    callback: AppleHealthCallback<AppleHealthWorkoutSample[]>
  ) => void;
}

const APPLE_HEALTH_READ_PERMISSIONS = [
  'StepCount',
  'DistanceWalkingRunning',
  'ActiveEnergyBurned',
  'AppleExerciseTime',
  'HeartRate',
  'RestingHeartRate',
  'BloodGlucose',
  'SleepAnalysis',
  'Workout',
];

const APPLE_HEALTH_MISSING_MESSAGE =
  'Apple Health sync is unavailable in this build. Install `react-native-health`, enable HealthKit in Xcode, and rebuild the iOS app.';

function getNativeAppleHealthModule(): NativeAppleHealthModule | null {
  if (Platform.OS !== 'ios') {
    return null;
  }
  const module = (NativeModules as { AppleHealthKit?: NativeAppleHealthModule }).AppleHealthKit;
  if (!module) {
    return null;
  }
  return module;
}

function normalizeNativeError(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === 'string' && error.trim()) {
    return error.trim();
  }
  return fallback;
}

function runNoOptionsMethod<T>(
  method: (callback: AppleHealthCallback<T>) => void,
  fallbackMessage: string
) {
  return new Promise<T>((resolve, reject) => {
    method((error, results) => {
      if (error) {
        reject(new Error(normalizeNativeError(error, fallbackMessage)));
        return;
      }
      resolve(results as T);
    });
  });
}

function runMethodWithOptions<TOptions extends Record<string, unknown>, TResult>(
  method: (options: TOptions, callback: AppleHealthCallback<TResult>) => void,
  options: TOptions,
  fallbackMessage: string
) {
  return new Promise<TResult>((resolve, reject) => {
    method(options, (error, results) => {
      if (error) {
        reject(new Error(normalizeNativeError(error, fallbackMessage)));
        return;
      }
      resolve(results as TResult);
    });
  });
}

async function ensureAppleHealthPermission(module: NativeAppleHealthModule) {
  if (typeof module.initHealthKit !== 'function') {
    throw new Error(APPLE_HEALTH_MISSING_MESSAGE);
  }

  if (typeof module.isAvailable === 'function') {
    const available = await runNoOptionsMethod(
      module.isAvailable,
      'Unable to check Apple Health availability.'
    );
    if (!available) {
      throw new Error('Apple Health is unavailable on this device.');
    }
  }

  await runMethodWithOptions(
    module.initHealthKit,
    {
      permissions: {
        read: APPLE_HEALTH_READ_PERMISSIONS,
        write: [],
      },
    },
    'Unable to request Apple Health permission.'
  );
}

async function readSamples<
  TSample,
  TOptions extends AppleHealthReadOptions = AppleHealthReadOptions
>(
  method:
    | ((
        options: TOptions,
        callback: AppleHealthCallback<TSample[]>
      ) => void)
    | undefined,
  options: TOptions
) {
  if (typeof method !== 'function') {
    return [];
  }
  const results = await runMethodWithOptions(
    method,
    options,
    'Unable to read Apple Health samples.'
  );
  return Array.isArray(results) ? results : [];
}

async function readSamplesSafely<
  TSample,
  TOptions extends AppleHealthReadOptions = AppleHealthReadOptions
>(
  method:
    | ((
        options: TOptions,
        callback: AppleHealthCallback<TSample[]>
      ) => void)
    | undefined,
  options: TOptions
) {
  try {
    return await readSamples<TSample, TOptions>(method, options);
  } catch (error) {
    const message =
      error instanceof Error && error.message
        ? error.message
        : 'Unable to read Apple Health samples.';
    console.warn('Apple Health query failed, continuing sync:', message);
    return [];
  }
}

export async function readAppleHealthPayload(range: {
  startDate: Date;
  endDate: Date;
}): Promise<AppleHealthPayload> {
  if (Platform.OS !== 'ios') {
    throw new Error('Apple Health sync is only available on iOS devices.');
  }

  const module = getNativeAppleHealthModule();
  if (!module) {
    throw new Error(APPLE_HEALTH_MISSING_MESSAGE);
  }

  await ensureAppleHealthPermission(module);

  const queryOptions = {
    startDate: range.startDate.toISOString(),
    endDate: range.endDate.toISOString(),
  };

  const dailyAggregateOptions = {
    ...queryOptions,
    period: 1440,
    ascending: false,
    includeManuallyAdded: true,
  };

  const [
    dailyStepCountSamples,
    dailyDistanceWalkingRunningSamples,
    activeEnergyBurnedSamples,
    appleExerciseTimeSamples,
    heartRateSamples,
    restingHeartRateSamples,
    bloodGlucoseSamples,
    sleepSamples,
    workoutSamples,
  ] =
    await Promise.all([
      readSamplesSafely<AppleHealthQuantitySample>(module.getDailyStepCountSamples, dailyAggregateOptions),
      readSamplesSafely<AppleHealthQuantitySample>(module.getDailyDistanceWalkingRunningSamples, {
        ...dailyAggregateOptions,
        unit: 'meter',
      }),
      readSamplesSafely<AppleHealthQuantitySample>(module.getActiveEnergyBurned, dailyAggregateOptions),
      readSamplesSafely<AppleHealthQuantitySample>(module.getAppleExerciseTime, {
        ...dailyAggregateOptions,
        unit: 'second',
      }),
      readSamplesSafely<AppleHealthQuantitySample>(module.getHeartRateSamples, queryOptions),
      readSamplesSafely<AppleHealthQuantitySample>(module.getRestingHeartRateSamples, queryOptions),
      readSamplesSafely<AppleHealthQuantitySample>(module.getBloodGlucoseSamples, {
        ...queryOptions,
        unit: 'mgPerdL',
      }),
      readSamplesSafely<AppleHealthQuantitySample>(module.getSleepSamples, queryOptions),
      readSamplesSafely<AppleHealthWorkoutSample>(module.getSamples, {
        ...queryOptions,
        type: 'Workout',
      }),
    ]);

  return {
    dailyStepCountSamples,
    dailyDistanceWalkingRunningSamples,
    activeEnergyBurnedSamples,
    appleExerciseTimeSamples,
    heartRateSamples,
    restingHeartRateSamples,
    bloodGlucoseSamples,
    sleepSamples,
    workoutSamples,
  };
}

export function getAppleHealthMissingMessage() {
  return APPLE_HEALTH_MISSING_MESSAGE;
}
