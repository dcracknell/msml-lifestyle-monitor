import { Platform } from 'react-native';
import { hasWidgetNativeModules } from '../../widgets/widgetRuntime';

export interface ActivityProgressWidgetProps {
  athleteName: string;
  overallPercent: number;
  distancePercent: number;
  durationPercent: number;
  weeklyDistanceKm: number;
  goalDistanceKm: number;
  weeklyDurationMin: number;
  goalDurationMin: number;
  weeklyTrainingLoad: number;
  statusLabel: string;
  distanceSummary: string;
  durationSummary: string;
  trainingLoadSummary: string;
}

export type ActivityWidgetSyncResult = 'updated' | 'ios_only' | 'unavailable';

interface CreateActivityProgressWidgetSnapshotInput {
  athleteName?: string | null;
  weeklyDistanceKm?: number | null;
  weeklyDurationMin?: number | null;
  goalDistanceKm: number;
  goalDurationMin: number;
  weeklyTrainingLoad?: number | null;
  statusLabel: string;
}

interface WidgetLike<T extends object> {
  updateSnapshot: (props: T) => void;
}

export function createActivityProgressWidgetSnapshot({
  athleteName,
  weeklyDistanceKm,
  weeklyDurationMin,
  goalDistanceKm,
  goalDurationMin,
  weeklyTrainingLoad,
  statusLabel,
}: CreateActivityProgressWidgetSnapshotInput): ActivityProgressWidgetProps {
  const distanceKm = sanitizeNumber(weeklyDistanceKm);
  const durationMin = Math.round(sanitizeNumber(weeklyDurationMin));
  const trainingLoad = Math.round(sanitizeNumber(weeklyTrainingLoad));
  const safeGoalDistanceKm = Math.max(1, sanitizeNumber(goalDistanceKm));
  const safeGoalDurationMin = Math.max(1, Math.round(sanitizeNumber(goalDurationMin)));
  const distancePercent = calculateProgress(distanceKm, safeGoalDistanceKm);
  const durationPercent = calculateProgress(durationMin, safeGoalDurationMin);

  return {
    athleteName: athleteName?.trim() || 'Weekly activity',
    overallPercent: Math.round((distancePercent + durationPercent) / 2),
    distancePercent,
    durationPercent,
    weeklyDistanceKm: roundTo(distanceKm, 1),
    goalDistanceKm: roundTo(safeGoalDistanceKm, 1),
    weeklyDurationMin: durationMin,
    goalDurationMin: safeGoalDurationMin,
    weeklyTrainingLoad: trainingLoad,
    statusLabel,
    distanceSummary: `${formatCompactDecimal(distanceKm, 1)}/${formatCompactDecimal(safeGoalDistanceKm, 1)} km`,
    durationSummary: `${durationMin}/${safeGoalDurationMin} min`,
    trainingLoadSummary: `${trainingLoad} pts`,
  };
}

export function syncActivityProgressWidget(snapshot: ActivityProgressWidgetProps): ActivityWidgetSyncResult {
  if (Platform.OS !== 'ios') {
    return 'ios_only';
  }

  try {
    const widget = loadWidget<ActivityProgressWidgetProps>();
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
    const imported = require('./widgets/ActivityProgressWidget');
    const widget = (imported?.default ?? imported) as WidgetLike<T> | null;
    if (widget && typeof widget.updateSnapshot === 'function') {
      return widget;
    }
  } catch {
    return null;
  }
  return null;
}
function calculateProgress(current: number, goal: number) {
  if (!Number.isFinite(goal) || goal <= 0) return 0;
  if (!Number.isFinite(current) || current <= 0) return 0;
  return clamp(Math.round((current / goal) * 100), 0, 100);
}

function sanitizeNumber(value: number | null | undefined) {
  return Number.isFinite(value) ? Number(value) : 0;
}

function roundTo(value: number, digits: number) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function formatCompactDecimal(value: number, digits: number) {
  return roundTo(value, digits)
    .toFixed(digits)
    .replace(/\.0$/, '');
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
