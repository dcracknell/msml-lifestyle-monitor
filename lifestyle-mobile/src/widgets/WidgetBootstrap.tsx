import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { QueryClient, useIsRestoring, useQueryClient } from '@tanstack/react-query';
import { File, Paths } from 'expo-file-system';

import type { ActivityResponse, ActivitySession, NutritionResponse } from '../api/types';
import {
  createActivityProgressWidgetSnapshot,
  syncActivityProgressWidget,
} from '../features/activity/activityWidget';
import { useActivityGoals } from '../features/activity/useActivityGoals';
import {
  buildCurrentRunWidgetPropsFromSession,
  buildCurrentRunWidgetPropsFromTracking,
  createCurrentRunWidgetSnapshot,
  syncCurrentRunWidget,
} from '../features/exercise/currentRunWidget';
import {
  getTrackingDistanceKm,
  loadStoredExerciseTrackingSnapshot,
} from '../features/exercise/trackingState';
import {
  createDailyCaloriesWidgetSnapshot,
  syncDailyCaloriesWidget,
} from '../features/nutrition/dailyCaloriesWidget';
import { hasWidgetNativeModules } from './widgetRuntime';

const DEFAULT_CALORIE_TARGET = 2000;
const CALORIE_FACTORS = {
  run: 1.0,
  ride: 0.4,
  walk: 0.7,
} as const;
const CALORIE_BODY_WEIGHT_KG = 70;
const WIDGET_DEBUG_FILE = new File(Paths.document, 'widget-debug.json');

export function WidgetBootstrap() {
  const queryClient = useQueryClient();
  const isRestoring = useIsRestoring();
  const { goals, isReady: goalsReady } = useActivityGoals();
  const goalsRef = useRef(goals);

  useEffect(() => {
    goalsRef.current = goals;
  }, [goals]);

  useEffect(() => {
    if (Platform.OS !== 'ios' || isRestoring || !goalsReady) {
      return;
    }

    let cancelled = false;

    const bootstrapWidgets = async () => {
      const report: Record<string, unknown> = {
        timestamp: new Date().toISOString(),
        platform: Platform.OS,
        isRestoring,
        goals,
      };

      report.activity = syncBootstrapActivityWidget(queryClient, goals);
      report.calories = syncBootstrapCaloriesWidget(queryClient);
      report.currentRun = await syncBootstrapCurrentRunWidget(queryClient, () => cancelled);

      report.timelines = await collectWidgetTimelines();
      await writeWidgetDebugReport(report);
    };

    void bootstrapWidgets();

    return () => {
      cancelled = true;
    };
  }, [goals, goalsReady, isRestoring, queryClient]);

  // Re-sync widgets automatically whenever relevant query data is fetched or updated.
  // This ensures widgets reflect fresh data after any screen loads, without requiring
  // the user to navigate to specific screens.
  useEffect(() => {
    if (Platform.OS !== 'ios') return;

    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (event.type !== 'updated' || !event.query.state.data) return;
      const queryKey = event.query.queryKey;
      if (!Array.isArray(queryKey) || queryKey.length === 0) return;
      const rootKey = queryKey[0];

      if (rootKey === 'activity' || rootKey === 'exercise') {
        syncBootstrapActivityWidget(queryClient, goalsRef.current);
        void syncBootstrapCurrentRunWidget(queryClient, () => false);
      } else if (rootKey === 'nutrition') {
        syncBootstrapCaloriesWidget(queryClient);
      }
    });

    return () => unsubscribe();
  }, [queryClient]);

  return null;
}

async function syncBootstrapCurrentRunWidget(
  queryClient: QueryClient,
  isCancelled: () => boolean
) {
  const trackingSnapshot = await loadStoredExerciseTrackingSnapshot().catch(() => null);
  if (isCancelled()) {
    return { status: 'cancelled' as const };
  }

  if (
    trackingSnapshot &&
    (trackingSnapshot.status === 'recording' || trackingSnapshot.status === 'paused')
  ) {
    const snapshot = buildCurrentRunWidgetPropsFromTracking(trackingSnapshot, {
      sportLabel: getSportLabel(trackingSnapshot.sportId),
      paceSeconds: trackingSnapshot.phoneCurrentPaceSeconds ?? trackingSnapshot.phonePaceSeconds,
      calories: estimateTrackingCalories(
        trackingSnapshot.sportId,
        getTrackingDistanceKm(trackingSnapshot)
      ),
    });
    return {
      source: 'tracking',
      result: syncCurrentRunWidget(snapshot),
      snapshot,
    };
  }

  const exerciseData =
    getLatestCachedQueryData<ActivityResponse>(queryClient, ['exercise']) ??
    getLatestCachedQueryData<ActivityResponse>(queryClient, ['activity']);
  const lastRunSession = pickLatestRunSession(exerciseData?.sessions || []);

  if (lastRunSession) {
    const snapshot = buildCurrentRunWidgetPropsFromSession(lastRunSession, 'Run');
    return {
      source: 'cached_session',
      result: syncCurrentRunWidget(snapshot),
      snapshot,
      sessionId: lastRunSession.id,
    };
  }

  const snapshot = createCurrentRunWidgetSnapshot({
    titleLabel: 'Run',
    statusLabel: 'Open the app to start a run',
    compactStatusLabel: 'Ready',
    distanceKm: 0,
    elapsedMs: 0,
    paceSeconds: null,
    calories: null,
  });
  return {
    source: 'empty',
    result: syncCurrentRunWidget(snapshot),
    snapshot,
  };
}

function syncBootstrapActivityWidget(
  queryClient: QueryClient,
  goals: { targetDistanceKm: number; targetDurationMin: number }
) {
  const activityData =
    getLatestCachedQueryData<ActivityResponse>(queryClient, ['activity']) ??
    getLatestCachedQueryData<ActivityResponse>(queryClient, ['exercise']);
  const summary = activityData?.summary;
  const snapshot = createActivityProgressWidgetSnapshot({
    athleteName: activityData?.subject?.name,
    weeklyDistanceKm: summary?.weeklyDistanceKm,
    weeklyDurationMin: summary?.weeklyDurationMin,
    goalDistanceKm: goals.targetDistanceKm,
    goalDurationMin: goals.targetDurationMin,
    weeklyTrainingLoad: summary?.trainingLoad,
    statusLabel: getActivityStatusLabel(summary?.trainingLoad ?? null),
  });

  return {
    hasActivityData: Boolean(activityData),
    result: syncActivityProgressWidget(snapshot),
    snapshot,
  };
}

function syncBootstrapCaloriesWidget(queryClient: QueryClient) {
  const nutritionData = getLatestCachedQueryData<NutritionResponse>(queryClient, ['nutrition']);
  const snapshot = createDailyCaloriesWidgetSnapshot({
    titleLabel: 'Daily calories',
    consumedCalories: nutritionData?.dailyTotals?.calories,
    targetCalories:
      nutritionData?.goals?.targetCalories ??
      nutritionData?.goals?.calories ??
      DEFAULT_CALORIE_TARGET,
    statusLabel: nutritionData ? null : 'Open the app to sync calories',
  });

  return {
    hasNutritionData: Boolean(nutritionData),
    result: syncDailyCaloriesWidget(snapshot),
    snapshot,
  };
}

function getLatestCachedQueryData<T>(queryClient: QueryClient, queryKey: readonly unknown[]): T | null {
  const matches = queryClient
    .getQueryCache()
    .findAll({ queryKey: [...queryKey] })
    .sort((left, right) => right.state.dataUpdatedAt - left.state.dataUpdatedAt);

  for (const match of matches) {
    const data = match.state.data as T | undefined;
    if (data && typeof data === 'object') {
      return data;
    }
  }

  return null;
}

function pickLatestRunSession(sessions: ActivitySession[]): ActivitySession | null {
  return [...sessions]
    .filter((session) => /run/i.test(session.sportType || ''))
    .sort(
      (left, right) =>
        new Date(right.startTime).getTime() - new Date(left.startTime).getTime()
    )[0] ?? null;
}

function getActivityStatusLabel(trainingLoad: number | null) {
  if (trainingLoad === null) {
    return 'Open the app to sync activity';
  }
  if (trainingLoad > 400) {
    return 'High load';
  }
  if (trainingLoad > 100) {
    return 'On track';
  }
  return 'Low activity';
}

function getSportLabel(sportId: 'run' | 'ride' | 'walk') {
  switch (sportId) {
    case 'ride':
      return 'Ride';
    case 'walk':
      return 'Walk';
    case 'run':
    default:
      return 'Run';
  }
}

function estimateTrackingCalories(
  sportId: 'run' | 'ride' | 'walk',
  distanceKm: number | null
) {
  if (distanceKm === null || !Number.isFinite(distanceKm) || distanceKm <= 0) {
    return null;
  }
  return Math.round(distanceKm * CALORIE_BODY_WEIGHT_KG * CALORIE_FACTORS[sportId]);
}

async function collectWidgetTimelines() {
  return {
    activity: await readWidgetTimeline(
      loadTimelineWidget(() => require('../features/activity/widgets/ActivityProgressWidget'))
    ),
    currentRun: await readWidgetTimeline(
      loadTimelineWidget(() => require('../features/exercise/widgets/CurrentRunWidget'))
    ),
    dailyCalories: await readWidgetTimeline(
      loadTimelineWidget(() => require('../features/nutrition/widgets/DailyCaloriesWidget'))
    ),
  };
}

type TimelineWidget = {
  getTimeline: () => Promise<Array<{ date: Date; props: unknown }>>;
};

function loadTimelineWidget(loadModule: () => unknown): TimelineWidget | null {
  if (!hasWidgetNativeModules()) {
    return null;
  }

  try {
    const imported = loadModule() as { default?: unknown } | unknown;
    const widget = (
      imported &&
      typeof imported === 'object' &&
      'default' in imported
        ? imported.default
        : imported
    ) as TimelineWidget | null;

    if (widget && typeof widget.getTimeline === 'function') {
      return widget;
    }
  } catch {
    return null;
  }

  return null;
}

async function readWidgetTimeline(widget: TimelineWidget | null) {
  if (!widget) {
    return {
      ok: false,
      error: 'Widget runtime unavailable in this build.',
    };
  }

  try {
    const entries = await widget.getTimeline();
    return {
      ok: true,
      count: entries.length,
      latest: entries.at(-1)
        ? {
            date: entries.at(-1)?.date.toISOString(),
            props: entries.at(-1)?.props,
          }
        : null,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function writeWidgetDebugReport(report: Record<string, unknown>) {
  try {
    if (!WIDGET_DEBUG_FILE.exists) {
      WIDGET_DEBUG_FILE.create({ overwrite: true });
    }
    WIDGET_DEBUG_FILE.write(JSON.stringify(report, null, 2));
  } catch {
    // Best-effort diagnostics only.
  }
}
