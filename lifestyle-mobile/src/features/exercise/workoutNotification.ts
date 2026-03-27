import { Platform } from 'react-native';
import { getTrackingDistanceKm, getTrackingElapsedMs, type ExerciseTrackingSnapshot } from './trackingState';

export const WORKOUT_NOTIFICATION_ID = 'msml.workout.live';
const ANDROID_CHANNEL_ID = 'msml_workout_live';

// ── Load expo-notifications once at module scope (same pattern as expo-keep-awake / expo-speech).
// If the native module isn't built into the binary yet, all function refs stay null and
// every exported function below becomes a no-op — no crash, no red screen.
import type * as NotificationsType from 'expo-notifications';

type Notifications = typeof NotificationsType;

let scheduleNotificationAsync: Notifications['scheduleNotificationAsync'] | null = null;
let dismissNotificationAsync: Notifications['dismissNotificationAsync'] | null = null;
let requestPermissionsAsync: Notifications['requestPermissionsAsync'] | null = null;
let setNotificationChannelAsync: Notifications['setNotificationChannelAsync'] | null = null;
let AndroidImportance: Notifications['AndroidImportance'] | null = null;
let AndroidNotificationVisibility: Notifications['AndroidNotificationVisibility'] | null = null;

try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
  const N = require('expo-notifications') as Notifications;
  scheduleNotificationAsync = N.scheduleNotificationAsync;
  dismissNotificationAsync = N.dismissNotificationAsync;
  requestPermissionsAsync = N.requestPermissionsAsync;
  setNotificationChannelAsync = N.setNotificationChannelAsync;
  AndroidImportance = N.AndroidImportance;
  AndroidNotificationVisibility = N.AndroidNotificationVisibility;
} catch {
  // expo-notifications native module not yet linked — needs a native rebuild.
  // All notification calls below will silently do nothing until then.
}

let channelReady = false;

async function ensureAndroidChannel() {
  if (Platform.OS !== 'android' || channelReady || !setNotificationChannelAsync || !AndroidImportance || !AndroidNotificationVisibility) {
    return;
  }
  try {
    await setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
      name: 'Live Workout',
      importance: AndroidImportance.LOW,
      lockscreenVisibility: AndroidNotificationVisibility.PUBLIC,
      showBadge: false,
      sound: null,
      vibrationPattern: null,
      enableVibrate: false,
    });
    channelReady = true;
  } catch {
    // Will retry next call
  }
}

export async function requestWorkoutNotificationPermission(): Promise<boolean> {
  if (!requestPermissionsAsync) {
    return false;
  }
  try {
    const { status } = await requestPermissionsAsync();
    return status === 'granted';
  } catch {
    return false;
  }
}

function formatElapsedMs(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export async function updateWorkoutNotification(snapshot: ExerciseTrackingSnapshot): Promise<void> {
  if (!scheduleNotificationAsync) {
    return;
  }

  const distKm = getTrackingDistanceKm(snapshot) ?? 0;
  const elapsedMs = getTrackingElapsedMs(snapshot);
  const sport = snapshot.sportId.charAt(0).toUpperCase() + snapshot.sportId.slice(1);
  const distStr = distKm >= 0.01 ? `${distKm.toFixed(2)} km` : '0.00 km';
  const timeStr = formatElapsedMs(elapsedMs);
  const isPaused = snapshot.isAutoPaused || snapshot.status === 'paused';

  try {
    await ensureAndroidChannel();
    await scheduleNotificationAsync({
      identifier: WORKOUT_NOTIFICATION_ID,
      content: {
        title: `${isPaused ? '⏸' : '▶'} ${sport} in progress`,
        body: `${distStr}  ·  ${timeStr}  —  tap to open`,
        sound: false,
        data: { type: 'workout-live' },
      },
      // On Android, pass the channel ID in the trigger (expo-notifications v0.32 API).
      // On iOS, trigger null presents the notification immediately.
      trigger: Platform.OS === 'android' ? { channelId: ANDROID_CHANNEL_ID } : null,
    });
  } catch {
    // Silently ignore notification errors
  }
}

export async function dismissWorkoutNotification(): Promise<void> {
  if (!dismissNotificationAsync) {
    return;
  }
  try {
    await dismissNotificationAsync(WORKOUT_NOTIFICATION_ID);
  } catch {
    // Ignore
  }
}
