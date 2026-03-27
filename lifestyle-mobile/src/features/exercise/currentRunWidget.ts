import { Platform } from 'react-native';

import type { ActivitySession } from '../../api/types';
import type { ExerciseTrackingSnapshot } from './trackingState';
import { getTrackingDistanceKm, getTrackingElapsedMs } from './trackingState';
import { hasWidgetNativeModules } from '../../widgets/widgetRuntime';

export interface CurrentRunWidgetProps {
  titleLabel: string;
  statusLabel: string;
  distanceLabel: string;
  elapsedLabel: string;
  paceLabel: string;
  caloriesLabel: string;
  compactDistanceLabel: string;
  compactStatusLabel: string;
}

export type CurrentRunWidgetSyncResult = 'updated' | 'ios_only' | 'unavailable';

interface CreateCurrentRunWidgetSnapshotInput {
  titleLabel: string;
  statusLabel: string;
  compactStatusLabel?: string;
  distanceKm?: number | null;
  elapsedMs?: number | null;
  paceSeconds?: number | null;
  calories?: number | null;
}

interface WidgetLike<T extends object> {
  updateSnapshot: (props: T) => void;
}

export function createCurrentRunWidgetSnapshot({
  titleLabel,
  statusLabel,
  compactStatusLabel,
  distanceKm,
  elapsedMs,
  paceSeconds,
  calories,
}: CreateCurrentRunWidgetSnapshotInput): CurrentRunWidgetProps {
  const safeDistanceKm = sanitizeNumber(distanceKm);
  const safeElapsedMs = Math.max(0, Math.round(sanitizeNumber(elapsedMs)));
  const safePaceSeconds = sanitizeOptionalNumber(paceSeconds);
  const safeCalories = Math.max(0, Math.round(sanitizeNumber(calories)));

  return {
    titleLabel: titleLabel.trim() || 'Run',
    statusLabel: statusLabel.trim() || 'Open the app to start a run',
    distanceLabel: formatDistanceKm(safeDistanceKm),
    elapsedLabel: formatElapsedMs(safeElapsedMs),
    paceLabel: formatPaceLabel(safePaceSeconds),
    caloriesLabel: safeCalories > 0 ? `${safeCalories} kcal` : 'Calories --',
    compactDistanceLabel: formatCompactDistanceKm(safeDistanceKm),
    compactStatusLabel: compactStatusLabel?.trim() || compressStatusLabel(statusLabel),
  };
}

export function buildCurrentRunWidgetPropsFromTracking(
  snapshot: ExerciseTrackingSnapshot,
  options: {
    sportLabel?: string | null;
    paceSeconds?: number | null;
    calories?: number | null;
  } = {}
): CurrentRunWidgetProps {
  const statusLabel = snapshot.isAutoPaused
    ? 'Auto-paused'
    : snapshot.status === 'paused'
    ? 'Paused'
    : snapshot.status === 'recording'
    ? 'Active'
    : 'Ready';

  return createCurrentRunWidgetSnapshot({
    titleLabel: 'Current run',
    statusLabel: options.sportLabel ? `${options.sportLabel} · ${statusLabel}` : statusLabel,
    compactStatusLabel: statusLabel,
    distanceKm: getTrackingDistanceKm(snapshot),
    elapsedMs: getTrackingElapsedMs(snapshot),
    paceSeconds: options.paceSeconds,
    calories: options.calories,
  });
}

export function buildCurrentRunWidgetPropsFromSession(
  session?: ActivitySession | null,
  sportLabel: string = 'Run'
): CurrentRunWidgetProps {
  if (!session) {
    return createCurrentRunWidgetSnapshot({
      titleLabel: 'Run',
      statusLabel: `Open the app to start ${sportLabel.toLowerCase()}`,
      compactStatusLabel: 'Ready',
      distanceKm: 0,
      elapsedMs: 0,
      paceSeconds: null,
      calories: null,
    });
  }

  return createCurrentRunWidgetSnapshot({
    titleLabel: 'Last run',
    statusLabel: session.name?.trim() || `${sportLabel} session`,
    compactStatusLabel: 'Last',
    distanceKm: (session.distance || 0) / 1000,
    elapsedMs: ((session.elapsedTime ?? session.movingTime) || 0) * 1000,
    paceSeconds: session.averagePace,
    calories: session.calories,
  });
}

export function syncCurrentRunWidget(snapshot: CurrentRunWidgetProps): CurrentRunWidgetSyncResult {
  if (Platform.OS !== 'ios') {
    return 'ios_only';
  }

  try {
    const widget = loadWidget<CurrentRunWidgetProps>();
    if (!widget) {
      return 'unavailable';
    }
    widget.updateSnapshot(snapshot);
    return 'updated';
  } catch {
    return 'unavailable';
  }
}

function loadWidget<T extends object>(): WidgetLike<T> | null {
  if (!hasWidgetNativeModules()) {
    return null;
  }
  try {
    const imported = require('./widgets/CurrentRunWidget');
    const widget = (imported?.default ?? imported) as WidgetLike<T> | null;
    if (widget && typeof widget.updateSnapshot === 'function') {
      return widget;
    }
  } catch {
    return null;
  }
  return null;
}
function sanitizeNumber(value: number | null | undefined) {
  return Number.isFinite(value) ? Number(value) : 0;
}

function sanitizeOptionalNumber(value: number | null | undefined) {
  return Number.isFinite(value) ? Number(value) : null;
}

function formatDistanceKm(distanceKm: number) {
  if (distanceKm >= 10) {
    return `${distanceKm.toFixed(1)} km`;
  }
  return `${distanceKm.toFixed(2)} km`;
}

function formatCompactDistanceKm(distanceKm: number) {
  if (distanceKm >= 10) {
    return `${distanceKm.toFixed(0)}k`;
  }
  return `${distanceKm.toFixed(1)}k`;
}

function formatElapsedMs(ms: number) {
  const totalSec = Math.floor(ms / 1000);
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function formatPaceLabel(paceSeconds: number | null) {
  if (!paceSeconds || paceSeconds <= 0) {
    return 'Pace --';
  }
  const safeSeconds = Math.round(paceSeconds);
  return `Pace ${Math.floor(safeSeconds / 60)}:${String(safeSeconds % 60).padStart(2, '0')} /km`;
}

function compressStatusLabel(statusLabel: string) {
  const normalized = statusLabel.trim();
  if (!normalized) {
    return 'Ready';
  }
  if (/auto-paused/i.test(normalized)) {
    return 'Auto';
  }
  if (/paused/i.test(normalized)) {
    return 'Paused';
  }
  if (/active/i.test(normalized)) {
    return 'Active';
  }
  if (/last/i.test(normalized)) {
    return 'Last';
  }
  return normalized.split(/[·-]/)[0]?.trim() || 'Ready';
}
