import { Platform } from 'react-native';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

import {
  applyLocationPointToTrackingSnapshot,
  type ExerciseTrackingSnapshot,
  type PhoneGeoPoint,
  loadStoredExerciseTrackingSnapshot,
  saveExerciseTrackingSnapshot,
} from './trackingState';
import { updateWorkoutNotification } from './workoutNotification';
import { buildWorkoutLiveActivityPropsFromSnapshot, updateWorkoutLiveActivity } from './workoutLiveActivity';
import { buildCurrentRunWidgetPropsFromTracking, syncCurrentRunWidget } from './currentRunWidget';

// Throttle background notification updates to once per minute
let lastBgNotificationTs = 0;
const BG_NOTIFICATION_INTERVAL_MS = 60_000;

export const EXERCISE_BACKGROUND_LOCATION_TASK = 'msml.exercise.background-location';

type BackgroundStartFailureReason =
  | 'unsupported'
  | 'foreground-denied'
  | 'background-denied'
  | 'start-failed';

export interface BackgroundTrackingStartResult {
  started: boolean;
  reason?: BackgroundStartFailureReason;
}

const ANDROID_FOREGROUND_SERVICE =
  Platform.OS === 'android'
    ? {
        foregroundService: {
          notificationTitle: 'Workout tracking active',
          notificationBody: 'MSML Lifestyle is tracking your route in the background.',
          notificationColor: '#00d2a5',
          killServiceOnDestroy: false,
        },
      }
    : {};

if (!TaskManager.isTaskDefined(EXERCISE_BACKGROUND_LOCATION_TASK)) {
  TaskManager.defineTask(EXERCISE_BACKGROUND_LOCATION_TASK, async ({ data, error, executionInfo }) => {
    if (error) {
      return;
    }

    if (executionInfo?.appState === 'active') {
      return;
    }

    const locations = Array.isArray((data as { locations?: unknown[] } | undefined)?.locations)
      ? ((data as { locations?: unknown[] }).locations as unknown[])
      : [];
    if (!locations.length) {
      return;
    }

    let snapshot: ExerciseTrackingSnapshot | null = null;
    try {
      snapshot = await loadStoredExerciseTrackingSnapshot();
    } catch {
      return;
    }
    if (!snapshot || snapshot.status !== 'recording') {
      return;
    }

    let nextSnapshot = snapshot;
    locations.forEach((location) => {
      const point = locationToPoint(location);
      if (!point) {
        return;
      }
      nextSnapshot = applyLocationPointToTrackingSnapshot(nextSnapshot, point);
    });

    try {
      await saveExerciseTrackingSnapshot(nextSnapshot);
    } catch {
      // Storage write failed — continue without saving this batch
    }

    // Update the live workout notification and Live Activity while the screen is locked (throttled)
    const now = Date.now();
    if (now - lastBgNotificationTs >= BG_NOTIFICATION_INTERVAL_MS) {
      lastBgNotificationTs = now;
      const liveProps = buildWorkoutLiveActivityPropsFromSnapshot(nextSnapshot);
      const widgetProps = buildCurrentRunWidgetPropsFromTracking(nextSnapshot, {
        sportLabel: nextSnapshot.sportId.charAt(0).toUpperCase() + nextSnapshot.sportId.slice(1),
        paceSeconds: nextSnapshot.phoneCurrentPaceSeconds ?? nextSnapshot.phonePaceSeconds,
        calories: null,
      });
      await Promise.all([
        updateWorkoutNotification(nextSnapshot).catch(() => {}),
        updateWorkoutLiveActivity(liveProps).catch(() => {}),
        Promise.resolve(syncCurrentRunWidget(widgetProps)).catch(() => {}),
      ]);
    }
  });
}

export async function startExerciseBackgroundLocationUpdates(
  snapshot: ExerciseTrackingSnapshot
): Promise<BackgroundTrackingStartResult> {
  await saveExerciseTrackingSnapshot(snapshot);

  if (Platform.OS === 'web') {
    return { started: false, reason: 'unsupported' };
  }

  const isTaskManagerAvailable = await TaskManager.isAvailableAsync().catch(() => false);
  if (!isTaskManagerAvailable) {
    return { started: false, reason: 'unsupported' };
  }

  const foregroundPermission = await Location.getForegroundPermissionsAsync().catch(() => null);
  if (foregroundPermission?.status !== 'granted') {
    return { started: false, reason: 'foreground-denied' };
  }

  const existingBackgroundPermission = await Location.getBackgroundPermissionsAsync().catch(() => null);
  const backgroundPermission =
    existingBackgroundPermission?.status === 'granted'
      ? existingBackgroundPermission
      : await Location.requestBackgroundPermissionsAsync().catch(() => null);
  if (backgroundPermission?.status !== 'granted') {
    return { started: false, reason: 'background-denied' };
  }

  const alreadyStarted = await Location.hasStartedLocationUpdatesAsync(
    EXERCISE_BACKGROUND_LOCATION_TASK
  ).catch(() => false);
  if (alreadyStarted) {
    return { started: true };
  }

  try {
    await Location.startLocationUpdatesAsync(EXERCISE_BACKGROUND_LOCATION_TASK, {
      accuracy: Location.Accuracy.BestForNavigation,
      activityType: Location.ActivityType.Fitness,
      pausesUpdatesAutomatically: false,
      showsBackgroundLocationIndicator: true,
      timeInterval: 2000,
      distanceInterval: 2,
      deferredUpdatesDistance: 2,
      deferredUpdatesInterval: 2000,
      ...ANDROID_FOREGROUND_SERVICE,
    });
    return { started: true };
  } catch {
    return { started: false, reason: 'start-failed' };
  }
}

export async function stopExerciseBackgroundLocationUpdates() {
  if (Platform.OS === 'web') {
    return;
  }

  const started = await Location.hasStartedLocationUpdatesAsync(
    EXERCISE_BACKGROUND_LOCATION_TASK
  ).catch(() => false);
  if (!started) {
    return;
  }

  await Location.stopLocationUpdatesAsync(EXERCISE_BACKGROUND_LOCATION_TASK).catch(() => {});
}

function locationToPoint(location: unknown): PhoneGeoPoint | null {
  if (!location || typeof location !== 'object') {
    return null;
  }

  const record = location as {
    coords?: {
      latitude?: unknown;
      longitude?: unknown;
      altitude?: unknown;
      accuracy?: unknown;
      speed?: unknown;
    };
    timestamp?: unknown;
  };

  const latitude = toFiniteNumber(record.coords?.latitude);
  const longitude = toFiniteNumber(record.coords?.longitude);
  const timestamp = toFiniteNumber(record.timestamp);
  if (latitude === null || longitude === null || timestamp === null) {
    return null;
  }

  return {
    latitude,
    longitude,
    timestamp: Math.round(timestamp),
    altitude: toFiniteNumber(record.coords?.altitude),
    accuracy: toFiniteNumber(record.coords?.accuracy),
    speed: toFiniteNumber(record.coords?.speed),
  };
}

function toFiniteNumber(value: unknown) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
