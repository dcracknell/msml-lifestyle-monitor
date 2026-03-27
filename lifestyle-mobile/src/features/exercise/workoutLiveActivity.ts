import { Platform } from 'react-native';
import { getTrackingDistanceKm, getTrackingElapsedMs, type ExerciseTrackingSnapshot } from './trackingState';
import { hasWidgetNativeModules } from '../../widgets/widgetRuntime';

export interface WorkoutLiveActivityProps {
  sportLabel: string;
  statusLabel: string;
  distanceLabel: string;
  elapsedLabel: string;
  paceLabel: string;
  heartRateLabel: string;
  compactDistanceLabel: string;
  compactElapsedLabel: string;
}

type LiveActivitySyncResult = 'started' | 'updated' | 'ended' | 'ios_only' | 'unavailable';

interface LiveActivityInstanceLike<T extends object> {
  update: (props: T) => Promise<void>;
  end: (
    dismissalPolicy?: 'default' | 'immediate',
    props?: T,
    contentDate?: Date
  ) => Promise<void>;
}

interface LiveActivityFactoryLike<T extends object> {
  start: (props: T, url?: string) => LiveActivityInstanceLike<T>;
  getInstances: () => Array<LiveActivityInstanceLike<T>>;
}

export async function startWorkoutLiveActivity(props: WorkoutLiveActivityProps): Promise<LiveActivitySyncResult> {
  if (Platform.OS !== 'ios') {
    return 'ios_only';
  }

  try {
    const factory = loadLiveActivityFactory<WorkoutLiveActivityProps>();
    if (!factory) {
      return 'unavailable';
    }
    const instances = factory.getInstances();
    await Promise.all(instances.map((instance) => instance.end('immediate').catch(() => {})));
    factory.start(props, 'msml://exercise');
    return 'started';
  } catch {
    return 'unavailable';
  }
}

export async function updateWorkoutLiveActivity(props: WorkoutLiveActivityProps): Promise<LiveActivitySyncResult> {
  if (Platform.OS !== 'ios') {
    return 'ios_only';
  }

  try {
    const factory = loadLiveActivityFactory<WorkoutLiveActivityProps>();
    if (!factory) {
      return 'unavailable';
    }
    const instances = factory.getInstances();
    if (!instances.length) {
      factory.start(props, 'msml://exercise');
      return 'started';
    }
    await Promise.all(instances.map((instance) => instance.update(props).catch(() => {})));
    return 'updated';
  } catch {
    return 'unavailable';
  }
}

export async function endWorkoutLiveActivity(
  props?: WorkoutLiveActivityProps
): Promise<LiveActivitySyncResult> {
  if (Platform.OS !== 'ios') {
    return 'ios_only';
  }

  try {
    const factory = loadLiveActivityFactory<WorkoutLiveActivityProps>();
    if (!factory) {
      return 'unavailable';
    }
    const instances = factory.getInstances();
    if (!instances.length) {
      return 'ended';
    }
    await Promise.all(
      instances.map((instance) => instance.end('immediate', props, new Date()).catch(() => {}))
    );
    return 'ended';
  } catch {
    return 'unavailable';
  }
}

function loadLiveActivityFactory<T extends object>(): LiveActivityFactoryLike<T> | null {
  if (!hasWidgetNativeModules()) {
    return null;
  }
  try {
    const imported = require('./widgets/WorkoutLiveActivity');
    const factory = (imported?.default ?? imported) as LiveActivityFactoryLike<T> | null;
    if (factory && typeof factory.start === 'function' && typeof factory.getInstances === 'function') {
      return factory;
    }
  } catch {
    return null;
  }
  return null;
}
export function buildWorkoutLiveActivityPropsFromSnapshot(
  snapshot: ExerciseTrackingSnapshot,
  heartRate: number | null = null
): WorkoutLiveActivityProps {
  const distKm = getTrackingDistanceKm(snapshot) ?? 0;
  const elapsedMs = getTrackingElapsedMs(snapshot);
  const isPaused = snapshot.isAutoPaused || snapshot.status === 'paused';
  const status = snapshot.isAutoPaused ? 'Auto-paused' : snapshot.status === 'paused' ? 'Paused' : 'Active';
  const sportLabel = snapshot.sportId.charAt(0).toUpperCase() + snapshot.sportId.slice(1);
  const elapsedLabel = formatElapsedMs(elapsedMs);
  const distanceLabel = distKm >= 0.01 ? `${distKm.toFixed(2)} km` : '0.00 km';
  const paceSeconds = isPaused ? snapshot.phonePaceSeconds : (snapshot.phoneCurrentPaceSeconds ?? snapshot.phonePaceSeconds);
  const paceLabel = paceSeconds && paceSeconds > 0
    ? `Pace ${Math.floor(paceSeconds / 60)}:${String(Math.round(paceSeconds % 60)).padStart(2, '0')} /km`
    : 'Pace --';
  const hrLabel = heartRate && heartRate > 0 ? `Heart rate ${Math.round(heartRate)} bpm` : 'Heart rate --';

  return {
    sportLabel,
    statusLabel: status,
    distanceLabel,
    elapsedLabel,
    paceLabel,
    heartRateLabel: hrLabel,
    compactDistanceLabel: distKm > 0 ? `${distKm.toFixed(1)}k` : '0.0k',
    compactElapsedLabel: elapsedLabel,
  };
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
