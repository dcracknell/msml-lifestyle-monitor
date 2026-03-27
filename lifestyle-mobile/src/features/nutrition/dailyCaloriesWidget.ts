import { Platform } from 'react-native';
import { hasWidgetNativeModules } from '../../widgets/widgetRuntime';

export interface DailyCaloriesWidgetProps {
  titleLabel: string;
  consumedCalories: number;
  targetCalories: number;
  progressPercent: number;
  statusLabel: string;
  remainingLabel: string;
  compactConsumedLabel: string;
  compactProgressLabel: string;
}

export type DailyCaloriesWidgetSyncResult = 'updated' | 'ios_only' | 'unavailable';

interface CreateDailyCaloriesWidgetSnapshotInput {
  titleLabel?: string | null;
  consumedCalories?: number | null;
  targetCalories?: number | null;
  statusLabel?: string | null;
}

interface WidgetLike<T extends object> {
  updateSnapshot: (props: T) => void;
}

export function createDailyCaloriesWidgetSnapshot({
  titleLabel,
  consumedCalories,
  targetCalories,
  statusLabel,
}: CreateDailyCaloriesWidgetSnapshotInput): DailyCaloriesWidgetProps {
  const safeConsumedCalories = Math.max(0, Math.round(sanitizeNumber(consumedCalories)));
  const safeTargetCalories = Math.max(1, Math.round(sanitizeNumber(targetCalories) || 1));
  const progressPercent = Math.min(999, Math.max(0, Math.round((safeConsumedCalories / safeTargetCalories) * 100)));
  const remainingCalories = safeTargetCalories - safeConsumedCalories;
  const computedStatusLabel =
    remainingCalories > 0
      ? `${remainingCalories} kcal left`
      : remainingCalories < 0
      ? `${Math.abs(remainingCalories)} kcal over`
      : 'Goal reached';
  const resolvedStatusLabel = statusLabel?.trim() || computedStatusLabel;

  return {
    titleLabel: titleLabel?.trim() || 'Daily calories',
    consumedCalories: safeConsumedCalories,
    targetCalories: safeTargetCalories,
    progressPercent,
    statusLabel: resolvedStatusLabel,
    remainingLabel: resolvedStatusLabel,
    compactConsumedLabel: `${safeConsumedCalories}`,
    compactProgressLabel: `${progressPercent}%`,
  };
}

export function syncDailyCaloriesWidget(
  snapshot: DailyCaloriesWidgetProps
): DailyCaloriesWidgetSyncResult {
  if (Platform.OS !== 'ios') {
    return 'ios_only';
  }

  try {
    const widget = loadWidget<DailyCaloriesWidgetProps>();
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
    const imported = require('./widgets/DailyCaloriesWidget');
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
