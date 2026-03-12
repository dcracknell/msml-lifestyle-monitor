import { Component, ReactNode, useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as WebBrowser from 'expo-web-browser';
import { useNavigation } from '@react-navigation/native';
import {
  AppButton,
  AppInput,
  ChartLegend,
  AppText,
  Card,
  ErrorView,
  LoadingView,
  MultiSeriesLineChart,
  ScatterChart,
  SectionHeader,
  StatCard,
  TrendChart,
  RefreshableScrollView,
} from '../../components';
import {
  activityRequest,
  connectStravaRequest,
  disconnectStravaRequest,
  streamHistoryRequest,
  syncStravaRequest,
} from '../../api/endpoints';
import { ActivityEffort } from '../../api/types';
import { ApiError } from '../../api/client';
import { useSubject } from '../../providers/SubjectProvider';
import { useAuth } from '../../providers/AuthProvider';
import { useSyncQueue } from '../../providers/SyncProvider';
import { colors, spacing } from '../../theme';
import { formatDate, formatDecimal, formatDistance, formatMinutes, formatNumber, formatPace } from '../../utils/format';
import { useActivityGoals } from './useActivityGoals';
import { getPedometerMissingMessage, getPedometerModule, isPermissionGranted } from '../../utils/pedometer';

function formatKilometers(value?: number | null) {
  const label = formatDecimal(value ?? null, 1);
  return label === '--' ? label : `${label} km`;
}

function formatWeeklyDuration(minutes?: number | null) {
  if (minutes === null || minutes === undefined || Number.isNaN(minutes)) {
    return '--';
  }
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const remainder = Math.round(minutes % 60);
    if (!remainder) {
      return `${hours}h`;
    }
    return `${hours}h ${remainder}m`;
  }
  return `${Math.round(minutes)} min`;
}

const AUTO_EXPORT_STEPS_KEY = 'msml.activity.autoExportPhoneSteps';
const AUTO_EXPORT_INTERVAL_MS = 15 * 60 * 1000;
const ACTIVITY_STREAM_WINDOW_MS = 45 * 24 * 60 * 60 * 1000;

function formatHeartRateAxis(value: number) {
  if (!Number.isFinite(value)) {
    return '--';
  }
  return `${Math.round(value)} bpm`;
}

function toLocalDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function ActivityScreen() {
  const { subjectId } = useSubject();
  const { user } = useAuth();
  const { runOrQueue } = useSyncQueue();
  const queryClient = useQueryClient();
  const navigation = useNavigation();
  const requestSubject = subjectId && subjectId !== user?.id ? subjectId : undefined;
  const [stravaFeedback, setStravaFeedback] = useState<string | null>(null);
  const [todayPhoneSteps, setTodayPhoneSteps] = useState<number | null>(null);
  const [phoneExportFeedback, setPhoneExportFeedback] = useState<string | null>(null);
  const [autoExportEnabled, setAutoExportEnabled] = useState(false);
  const [isPhoneExporting, setIsPhoneExporting] = useState(false);

  const { data, isLoading, isError, error, refetch, isFetching, isRefetching } = useQuery({
    queryKey: ['activity', requestSubject || user?.id],
    queryFn: () => activityRequest({ athleteId: requestSubject }),
    enabled: Boolean(user?.id),
  });
  const { data: distanceStreamData } = useQuery({
    queryKey: ['stream-history', 'exercise.distance', requestSubject || user?.id],
    queryFn: () =>
      streamHistoryRequest({
        metric: 'exercise.distance',
        athleteId: requestSubject,
        windowMs: ACTIVITY_STREAM_WINDOW_MS,
        maxPoints: 800,
      }),
    enabled: Boolean(user?.id),
  });
  const { data: elapsedTimeStreamData } = useQuery({
    queryKey: ['stream-history', 'exercise.elapsed_time', requestSubject || user?.id],
    queryFn: () =>
      streamHistoryRequest({
        metric: 'exercise.elapsed_time',
        athleteId: requestSubject,
        windowMs: ACTIVITY_STREAM_WINDOW_MS,
        maxPoints: 800,
      }),
    enabled: Boolean(user?.id),
  });
  const { data: trainingLoadStreamData } = useQuery({
    queryKey: ['stream-history', 'exercise.training_load', requestSubject || user?.id],
    queryFn: () =>
      streamHistoryRequest({
        metric: 'exercise.training_load',
        athleteId: requestSubject,
        windowMs: ACTIVITY_STREAM_WINDOW_MS,
        maxPoints: 800,
      }),
    enabled: Boolean(user?.id),
  });
  const { data: paceStreamData } = useQuery({
    queryKey: ['stream-history', 'exercise.pace', requestSubject || user?.id],
    queryFn: () =>
      streamHistoryRequest({
        metric: 'exercise.pace',
        athleteId: requestSubject,
        windowMs: ACTIVITY_STREAM_WINDOW_MS,
        maxPoints: 800,
      }),
    enabled: Boolean(user?.id),
  });
  const { data: heartRateStreamData } = useQuery({
    queryKey: ['stream-history', 'exercise.hr', requestSubject || user?.id],
    queryFn: () =>
      streamHistoryRequest({
        metric: 'exercise.hr',
        athleteId: requestSubject,
        windowMs: ACTIVITY_STREAM_WINDOW_MS,
        maxPoints: 800,
      }),
    enabled: Boolean(user?.id),
  });
  const {
    goals,
    minimized: goalsMinimized,
    isReady: goalsReady,
    saveGoals,
    toggleMinimized,
  } = useActivityGoals();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const value = await AsyncStorage.getItem(AUTO_EXPORT_STEPS_KEY);
        if (!cancelled && value === 'true') {
          setAutoExportEnabled(true);
        }
      } catch {
        // ignore preference load errors
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const syncPhoneSteps = useCallback(
    async (showFeedback: boolean) => {
      setIsPhoneExporting(true);
      if (showFeedback) {
        setPhoneExportFeedback(null);
      }

      try {
        const pedometer = getPedometerModule();
        if (!pedometer) {
          if (showFeedback) {
            setPhoneExportFeedback(getPedometerMissingMessage());
          }
          return false;
        }

        if (pedometer.isAvailableAsync && !(await pedometer.isAvailableAsync())) {
          if (showFeedback) {
            setPhoneExportFeedback('Step tracking is unavailable on this device.');
          }
          return false;
        }

        let permission = null;
        if (pedometer.getPermissionsAsync) {
          permission = await pedometer.getPermissionsAsync();
        }
        if (!isPermissionGranted(permission) && pedometer.requestPermissionsAsync) {
          permission = await pedometer.requestPermissionsAsync();
        }

        if (!isPermissionGranted(permission)) {
          if (showFeedback) {
            setPhoneExportFeedback('Permission is required to access phone step data.');
          }
          return false;
        }
        if (!pedometer.getStepCountAsync) {
          if (showFeedback) {
            setPhoneExportFeedback('Step count API is unavailable on this device.');
          }
          return false;
        }

        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        const result = await pedometer.getStepCountAsync(startOfDay, new Date());
        const rawSteps = Number(result?.steps);
        const steps = Number.isFinite(rawSteps) ? rawSteps : 0;
        setTodayPhoneSteps(steps);
        const ts = Date.now();
        const localDate = toLocalDateKey(new Date(ts));

        const queued = await runOrQueue({
          endpoint: '/api/streams',
          payload: {
            metric: 'phone.steps',
            localDate,
            samples: [{ ts, value: steps, localDate }],
          },
          description: 'Phone steps auto export',
        });
        if (queued.status === 'sent') {
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ['sleep'] }),
            queryClient.invalidateQueries({ queryKey: ['activity'] }),
            queryClient.invalidateQueries({ queryKey: ['vitals'] }),
            queryClient.invalidateQueries({ queryKey: ['roster'] }),
            queryClient.invalidateQueries({ queryKey: ['stream-history'] }),
            queryClient.invalidateQueries({ queryKey: ['streamHistory'] }),
          ]);
        }

        if (showFeedback) {
          setPhoneExportFeedback(
            queued.status === 'sent'
              ? `Exported ${formatNumber(steps)} steps from your phone.`
              : `Saved ${formatNumber(steps)} steps offline. Will sync when online.`
          );
        }

        return true;
      } catch (error) {
        if (showFeedback) {
          setPhoneExportFeedback(extractErrorMessage(error, 'Unable to export phone steps right now.'));
        }
        return false;
      } finally {
        setIsPhoneExporting(false);
      }
    },
    [runOrQueue, queryClient]
  );

  const toggleAutoExport = useCallback(async () => {
    const next = !autoExportEnabled;
    setAutoExportEnabled(next);
    await AsyncStorage.setItem(AUTO_EXPORT_STEPS_KEY, next ? 'true' : 'false');

    if (next) {
      const ok = await syncPhoneSteps(true);
      if (!ok) {
        setAutoExportEnabled(false);
        await AsyncStorage.setItem(AUTO_EXPORT_STEPS_KEY, 'false');
      }
    } else {
      setPhoneExportFeedback('Auto-export turned off.');
    }
  }, [autoExportEnabled, syncPhoneSteps]);

  useEffect(() => {
    if (!autoExportEnabled) {
      return;
    }

    syncPhoneSteps(false).then((ok) => {
      if (!ok) {
        setAutoExportEnabled(false);
        AsyncStorage.setItem(AUTO_EXPORT_STEPS_KEY, 'false').catch(() => {});
      }
    });

    const id = setInterval(() => {
      syncPhoneSteps(false).then((ok) => {
        if (!ok) {
          setAutoExportEnabled(false);
          AsyncStorage.setItem(AUTO_EXPORT_STEPS_KEY, 'false').catch(() => {});
        }
      });
    }, AUTO_EXPORT_INTERVAL_MS);

    return () => clearInterval(id);
  }, [autoExportEnabled, syncPhoneSteps]);

  const handleConnect = async () => {
    if (!data?.strava?.canManage) return;
    setStravaFeedback(null);
    try {
      const payload = await connectStravaRequest();
      await WebBrowser.openBrowserAsync(payload.url);
      await refetch();
      setStravaFeedback('Strava connection flow opened. Return here after authorization.');
    } catch (connectError) {
      setStravaFeedback(extractErrorMessage(connectError, 'Unable to start Strava connection.'));
    }
  };

  const handleDisconnect = async () => {
    setStravaFeedback(null);
    try {
      await disconnectStravaRequest();
      await refetch();
      setStravaFeedback('Strava disconnected.');
    } catch (disconnectError) {
      setStravaFeedback(extractErrorMessage(disconnectError, 'Unable to disconnect Strava.'));
    }
  };

  const handleSync = async () => {
    setStravaFeedback(null);
    try {
      const payload = await syncStravaRequest();
      await refetch();
      const pageLabel =
        typeof payload.pages === 'number' && payload.pages > 1
          ? ` across ${payload.pages} pages`
          : '';
      const skippedLabel =
        typeof payload.skipped === 'number' && payload.skipped > 0
          ? ` (${payload.skipped} skipped)`
          : '';
      setStravaFeedback(
        `Imported ${payload.imported} of ${payload.fetched} activities${pageLabel}${skippedLabel}.`
      );
    } catch (syncError) {
      setStravaFeedback(extractErrorMessage(syncError, 'Unable to sync Strava right now.'));
    }
  };

  if (isLoading && !data) {
    return <LoadingView />;
  }

  if (!data) {
    return (
      <ErrorView
        message={isError ? extractErrorMessage(error, 'Unable to load activity') : 'No activity data available.'}
        onRetry={refetch}
      />
    );
  }

  if (typeof data !== 'object') {
    return <ErrorView message="Activity response was invalid. Please try again." onRetry={refetch} />;
  }

  const summary = data.summary;
  const sessions = Array.isArray(data.sessions) ? data.sessions : [];
  const efforts = Array.isArray(data.bestEfforts)
    ? data.bestEfforts.filter((entry): entry is ActivityEffort => Boolean(entry))
    : [];
  const mileageTrend = Array.isArray(data.charts?.mileageTrend) ? data.charts.mileageTrend : [];
  const trainingLoadTrendData = Array.isArray(data.charts?.trainingLoad) ? data.charts.trainingLoad : [];
  const heartRatePaceData = Array.isArray(data.charts?.heartRatePace) ? data.charts.heartRatePace : [];
  const streamMileageTrend = buildStreamMileageTrend(
    distanceStreamData?.points || [],
    elapsedTimeStreamData?.points || []
  );
  const streamTrainingLoadTrend = buildDailyStreamTrend(
    trainingLoadStreamData?.points || [],
    (value) => value,
    (values) => values.reduce((sum, value) => sum + value, 0)
  );
  const streamPacePoints = buildPaceHeartRateScatter(
    paceStreamData?.points || [],
    heartRateStreamData?.points || []
  );
  const mileageSource = streamMileageTrend.length ? streamMileageTrend : mileageTrend;
  const trainingLoadSource = streamTrainingLoadTrend.length
    ? streamTrainingLoadTrend
    : trainingLoadTrendData.map((entry) => ({
        startTime: entry.startTime,
        value: entry.trainingLoad ?? 0,
      }));
  const paceSource = streamPacePoints.length
    ? streamPacePoints
    : heartRatePaceData.map((point) => ({
        x: Number(point.paceSeconds),
        y: Number(point.heartRate),
        label: point.label,
      }));
  const mileageSeries = [
    {
      id: 'distance',
      label: 'Distance (km)',
      color: colors.accent,
      data: mileageSource.map((entry) => ({
        label: formatDate(entry.startTime, 'MMM D'),
        value: entry.distanceKm ?? 0,
      })),
    },
    {
      id: 'duration',
      label: 'Duration (min)',
      color: colors.accentStrong,
      strokeDasharray: '6,4',
      data: mileageSource.map((entry) => ({
        label: formatDate(entry.startTime, 'MMM D'),
        value: entry.movingMinutes ?? 0,
      })),
    },
  ];
  const legendItems = mileageSeries
    .filter((serie) => serie.data.length)
    .map((serie) => ({ label: serie.label, color: serie.color || colors.accent }));
  const trainingTrend = trainingLoadSource.map((entry) => ({
    label: formatDate(entry.startTime, 'MMM D'),
    value: entry.value ?? 0,
  }));
  const pacePoints = paceSource;
  const chartSummary = buildSummaryFromCharts(mileageSource, trainingLoadSource);
  const weeklyDistanceKm = chartSummary.weeklyDistanceKm ?? summary?.weeklyDistanceKm ?? null;
  const weeklyDurationMin = chartSummary.weeklyDurationMin ?? summary?.weeklyDurationMin ?? null;
  const weeklyTrainingLoad = chartSummary.trainingLoad ?? summary?.trainingLoad ?? null;
  const averagePaceSeconds = chartSummary.avgPaceSeconds ?? summary?.avgPaceSeconds ?? null;
  const longestRunKm = chartSummary.longestRunKm ?? summary?.longestRunKm ?? null;
  const longestRunLabel = chartSummary.longestRunLabel || summary?.longestRunName || 'Awaiting sync';

  const loadBadgeColor = weeklyTrainingLoad == null
    ? colors.muted
    : weeklyTrainingLoad > 400 ? colors.warning : weeklyTrainingLoad > 100 ? colors.accent : colors.warning;
  const loadBadgeLabel = weeklyTrainingLoad == null
    ? 'No data'
    : weeklyTrainingLoad > 400 ? 'High load' : weeklyTrainingLoad > 100 ? 'On track' : 'Low activity';

  return (
    <RefreshableScrollView
      contentContainerStyle={styles.container}
      refreshing={isRefetching}
      onRefresh={refetch}
      showsVerticalScrollIndicator={false}
    >
      {isError ? (
        <View style={styles.errorBanner}>
          <AppText style={styles.errorText}>{extractErrorMessage(error, 'Showing cached activity data.')}</AppText>
        </View>
      ) : null}

      {/* Hero: training load */}
      <View style={styles.heroCard}>
        <AppText style={styles.eyebrow}>TRAINING · {data.subject?.name ?? 'Athlete'}</AppText>
        <AppText style={styles.heroNumber}>{formatNumber(weeklyTrainingLoad)}</AppText>
        <AppText style={styles.heroLabel}>Weekly training load</AppText>
        <View style={[styles.heroBadge, { backgroundColor: `${loadBadgeColor}1a`, borderColor: `${loadBadgeColor}44` }]}>
          <View style={[styles.badgeDot, { backgroundColor: loadBadgeColor }]} />
          <AppText style={[styles.badgeText, { color: loadBadgeColor }]}>{loadBadgeLabel}</AppText>
        </View>
      </View>

      {/* Goals card */}
      {goalsReady ? (
        <ActivityGoalCard
          summaryDistanceKm={weeklyDistanceKm ?? 0}
          summaryDurationMin={weeklyDurationMin ?? 0}
          goals={goals}
          minimized={goalsMinimized}
          onSaveGoals={saveGoals}
          onToggleMinimized={toggleMinimized}
        />
      ) : null}

      {/* 2×3 metric grid */}
      <View style={styles.metricGrid}>
        <ActivityMetric label="WEEKLY DISTANCE" value={formatKilometers(weeklyDistanceKm)} />
        <ActivityMetric label="WEEKLY DURATION" value={formatWeeklyDuration(weeklyDurationMin)} />
        <ActivityMetric label="AVG PACE" value={formatPace(averagePaceSeconds)} />
        <ActivityMetric label="LONGEST RUN" value={formatKilometers(longestRunKm)} sub={longestRunLabel ?? undefined} />
        <ActivityMetric label="TRAINING LOAD" value={formatNumber(weeklyTrainingLoad)} />
        <ActivityMetric label="VO₂ MAX" value={formatDecimal(summary?.vo2maxEstimate ?? null, 1)} />
      </View>

      {/* Training load chart */}
      <View style={styles.card}>
        <AppText style={styles.eyebrow}>TREND · TRAINING LOAD</AppText>
        <AppText style={styles.cardTitle}>Training load</AppText>
        <AppText style={styles.cardSubtitle}>Recent sessions</AppText>
        <ChartErrorBoundary fallback="Training load chart is unavailable on this device.">
          <TrendChart data={trainingTrend} yLabel="Load" />
        </ChartErrorBoundary>
      </View>

      {/* Mileage vs duration */}
      <View style={styles.card}>
        <AppText style={styles.eyebrow}>CHART · VOLUME</AppText>
        <AppText style={styles.cardTitle}>Mileage vs duration</AppText>
        <AppText style={styles.cardSubtitle}>Last sessions</AppText>
        <ChartErrorBoundary fallback="Mileage chart is unavailable on this device.">
          <MultiSeriesLineChart series={mileageSeries} yLabel="Volume" />
        </ChartErrorBoundary>
        <ChartLegend items={legendItems} />
      </View>

      {/* Pace vs HR scatter */}
      <View style={styles.card}>
        <AppText style={styles.eyebrow}>CHART · EFFICIENCY</AppText>
        <AppText style={styles.cardTitle}>Pace vs heart rate</AppText>
        <AppText style={styles.cardSubtitle}>Session comparison</AppText>
        <ChartErrorBoundary fallback="Pace vs heart rate chart is unavailable on this device.">
          <ScatterChart
            data={pacePoints}
            xLabel="Pace (per km)"
            yLabel="Avg heart rate"
            xFormatter={(value) => formatPace(Number(value))}
            yFormatter={(value) => formatHeartRateAxis(Number(value))}
          />
        </ChartErrorBoundary>
      </View>

      {/* Best efforts */}
      <View style={styles.card}>
        <AppText style={styles.eyebrow}>BEST EFFORTS</AppText>
        <AppText style={styles.cardTitle}>Personal bests</AppText>
        {efforts.length ? (
          efforts.map((effort) => (
            <View key={effort.label} style={styles.effortRow}>
              <AppText style={styles.effortLabel}>{effort.label}</AppText>
              <View style={styles.effortRight}>
                <AppText style={styles.effortValue}>{formatDistance(effort.distance || 0)}</AppText>
                <AppText style={styles.mutedText}>{formatPace(effort.paceSeconds)}</AppText>
              </View>
            </View>
          ))
        ) : (
          <AppText style={styles.mutedText}>Not enough data yet.</AppText>
        )}
      </View>

      {/* Recent sessions */}
      <View style={styles.card}>
        <View style={styles.cardTitleRow}>
          <AppText style={styles.eyebrow}>RECENT SESSIONS</AppText>
          <Pressable onPress={() => navigation.navigate('Sessions' as never)} style={styles.seeAllBtn}>
            <AppText style={styles.seeAllText}>See all</AppText>
          </Pressable>
        </View>
        <AppText style={styles.cardTitle}>Latest 3</AppText>
        {sessions.length ? (
          sessions.slice(0, 3).map((session) => (
            <View key={session.id} style={styles.sessionRow}>
              <View style={{ flex: 1 }}>
                <AppText style={styles.sessionName}>{session.name}</AppText>
                <AppText style={styles.mutedText}>{formatDate(session.startTime)} · {session.sportType}</AppText>
              </View>
              <View style={styles.sessionRight}>
                <AppText style={styles.sessionDistance}>{formatDistance(session.distance || 0)}</AppText>
                <AppText style={styles.mutedText}>{formatPace(session.averagePace)}</AppText>
              </View>
            </View>
          ))
        ) : (
          <AppText style={styles.mutedText}>No sessions available yet.</AppText>
        )}
      </View>

      {/* Phone export */}
      <View style={styles.card}>
        <AppText style={styles.eyebrow}>PHONE DATA</AppText>
        <AppText style={styles.cardTitle}>Step count export</AppText>
        <View style={styles.phoneExportActions}>
          <AppButton
            title={isPhoneExporting ? 'Exporting…' : 'Export now'}
            onPress={() => syncPhoneSteps(true)}
            loading={isPhoneExporting}
            disabled={isPhoneExporting}
          />
          <AppButton
            title={autoExportEnabled ? 'Disable auto-export' : 'Enable auto-export'}
            variant="ghost"
            onPress={toggleAutoExport}
            disabled={isPhoneExporting}
          />
        </View>
        <AppText style={styles.mutedText}>
          Reads phone step count every 15 min while this screen is open.
        </AppText>
        <View style={styles.phoneStepRow}>
          <AppText style={styles.phoneStepLabel}>TODAY FROM PHONE</AppText>
          <AppText style={styles.phoneStepValue}>{formatNumber(todayPhoneSteps)}</AppText>
        </View>
        {phoneExportFeedback ? <AppText style={styles.mutedText}>{phoneExportFeedback}</AppText> : null}
      </View>

      {/* Strava */}
      {data.strava?.enabled || data.strava?.canManage ? (
        <View style={styles.card}>
          <AppText style={styles.eyebrow}>STRAVA</AppText>
          <View style={styles.cardTitleRow}>
            <AppText style={styles.cardTitle}>Strava</AppText>
            <View style={[styles.stravaPill, data.strava.connected && styles.stravaPillConnected]}>
              <View style={[styles.badgeDot, { backgroundColor: data.strava.connected ? colors.accent : colors.warning }]} />
              <AppText style={[styles.badgeText, { color: data.strava.connected ? colors.accent : colors.warning }]}>
                {data.strava.connected ? 'Connected' : data.strava.requiresSetup ? 'Unavailable' : 'Not linked'}
              </AppText>
            </View>
          </View>
          <AppText style={styles.mutedText}>
            {data.strava.connected
              ? `Last sync ${data.strava.lastSync ? formatDate(data.strava.lastSync, 'MMM D, HH:mm') : 'pending'}`
              : data.strava.requiresSetup
              ? 'Strava needs to be enabled on the server before you can connect it.'
              : 'Link to import Strava workouts and sessions with splits.'}
          </AppText>
          <View style={styles.stravaActions}>
            {data.strava.canManage && !data.strava.connected ? (
              <AppButton
                title={data.strava.requiresSetup ? 'Not available' : 'Connect Strava'}
                onPress={handleConnect}
                loading={isFetching}
                disabled={data.strava.requiresSetup}
              />
            ) : null}
            {data.strava.connected ? (
              <>
                <AppButton title="Sync now" variant="ghost" onPress={handleSync} loading={isFetching} />
                <AppButton title="Disconnect" variant="ghost" onPress={handleDisconnect} />
              </>
            ) : null}
          </View>
          {stravaFeedback ? <AppText style={styles.mutedText}>{stravaFeedback}</AppText> : null}
        </View>
      ) : null}
    </RefreshableScrollView>
  );
}

interface ActivityGoalCardProps {
  summaryDistanceKm: number;
  summaryDurationMin: number;
  goals: { targetDistanceKm: number; targetDurationMin: number };
  minimized: boolean;
  onSaveGoals: (next: { targetDistanceKm: number; targetDurationMin: number }) => void;
  onToggleMinimized: () => void;
}

function ActivityGoalCard({
  summaryDistanceKm,
  summaryDurationMin,
  goals,
  minimized,
  onSaveGoals,
  onToggleMinimized,
}: ActivityGoalCardProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [distanceInput, setDistanceInput] = useState(String(goals.targetDistanceKm));
  const [durationInput, setDurationInput] = useState(String(goals.targetDurationMin));
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (isEditing) return;
    setDistanceInput(String(goals.targetDistanceKm));
    setDurationInput(String(goals.targetDurationMin));
  }, [goals.targetDistanceKm, goals.targetDurationMin, isEditing]);

  const distanceProgress = computeProgress(summaryDistanceKm, goals.targetDistanceKm);
  const durationProgress = computeProgress(summaryDurationMin, goals.targetDurationMin);

  const handleSave = () => {
    const distance = Number(distanceInput);
    const duration = Number(durationInput);
    if (!Number.isFinite(distance) || distance <= 0) {
      setMessage('Enter a positive weekly distance.');
      return;
    }
    if (!Number.isFinite(duration) || duration <= 0) {
      setMessage('Enter a positive weekly duration.');
      return;
    }
    onSaveGoals({ targetDistanceKm: distance, targetDurationMin: duration });
    setIsEditing(false);
    setMessage('Goals updated.');
  };

  const handleCancel = () => {
    setIsEditing(false);
    setMessage(null);
  };

  return (
    <Card>
      <SectionHeader
        title="Activity goals"
        subtitle="Weekly targets"
        action={
          <AppButton
            title={minimized ? 'Expand' : 'Minimize'}
            variant="ghost"
            onPress={() => {
              onToggleMinimized();
              setIsEditing(false);
            }}
          />
        }
      />
      {minimized ? (
        <View style={styles.goalMinimizedRow}>
          <AppText variant="body">
            Distance {formatPercent(distanceProgress)} · Duration {formatPercent(durationProgress)}
          </AppText>
          <AppButton
            title="Edit"
            variant="ghost"
            onPress={() => {
              if (minimized) {
                onToggleMinimized();
              }
              setIsEditing(true);
            }}
          />
        </View>
      ) : isEditing ? (
        <View style={styles.goalForm}>
          <AppInput
            label="Weekly distance (km)"
            value={distanceInput}
            keyboardType="numeric"
            onChangeText={setDistanceInput}
          />
          <AppInput
            label="Weekly duration (min)"
            value={durationInput}
            keyboardType="numeric"
            onChangeText={setDurationInput}
          />
          <View style={styles.goalActions}>
            <AppButton title="Save goals" onPress={handleSave} />
            <AppButton title="Cancel" variant="ghost" onPress={handleCancel} />
          </View>
          {message ? (
            <AppText variant="muted" style={styles.goalFeedback}>
              {message}
            </AppText>
          ) : null}
        </View>
      ) : (
        <View style={styles.goalContent}>
          <GoalProgressBar
            label="Weekly distance"
            progress={distanceProgress}
            currentLabel={formatKilometers(summaryDistanceKm)}
            targetLabel={formatKilometers(goals.targetDistanceKm)}
          />
          <GoalProgressBar
            label="Weekly duration"
            progress={durationProgress}
            currentLabel={formatWeeklyDuration(summaryDurationMin)}
            targetLabel={formatWeeklyDuration(goals.targetDurationMin)}
          />
          <AppButton title="Edit goals" variant="ghost" onPress={() => setIsEditing(true)} />
          {message ? (
            <AppText variant="muted" style={styles.goalFeedback}>
              {message}
            </AppText>
          ) : null}
        </View>
      )}
    </Card>
  );
}

function GoalProgressBar({
  label,
  progress,
  currentLabel,
  targetLabel,
}: {
  label: string;
  progress: number;
  currentLabel: string;
  targetLabel: string;
}) {
  const cappedProgress = Math.min(100, progress);
  return (
    <View style={styles.goalMetric}>
      <View style={styles.goalMetricHeader}>
        <AppText variant="body" weight="semibold">
          {label}
        </AppText>
        <AppText variant="label">{formatPercent(progress)}</AppText>
      </View>
      <View style={styles.goalBar}>
        <View style={[styles.goalBarFill, { width: `${cappedProgress}%` }]} />
      </View>
      <AppText variant="muted">
        {currentLabel} of {targetLabel}
      </AppText>
    </View>
  );
}

function computeProgress(current: number, goal: number) {
  if (!Number.isFinite(goal) || goal <= 0) return 0;
  if (!Number.isFinite(current) || current <= 0) return 0;
  return Math.min((current / goal) * 100, 999);
}

function formatPercent(value: number) {
  return `${Math.round(Math.min(value, 999))}%`;
}

function buildSummaryFromCharts(
  mileageRows: Array<{ startTime: string; distanceKm?: number | null; movingMinutes?: number | null }>,
  trainingRows: Array<{ startTime: string; value?: number | null }>
) {
  const nowTs = Date.now();
  const windowStartTs = nowTs - 7 * 24 * 60 * 60 * 1000;
  const weeklyMileageRows = mileageRows.filter((row) => {
    const ts = Date.parse(row.startTime);
    return Number.isFinite(ts) && ts >= windowStartTs && ts <= nowTs;
  });
  const weeklyTrainingRows = trainingRows.filter((row) => {
    const ts = Date.parse(row.startTime);
    return Number.isFinite(ts) && ts >= windowStartTs && ts <= nowTs;
  });
  const weeklyDistanceKm = weeklyMileageRows.length
    ? weeklyMileageRows.reduce((sum, row) => sum + toFiniteNumberOrZero(row.distanceKm), 0)
    : null;
  const weeklyDurationMin = weeklyMileageRows.length
    ? weeklyMileageRows.reduce((sum, row) => sum + toFiniteNumberOrZero(row.movingMinutes), 0)
    : null;
  const trainingLoad = weeklyTrainingRows.length
    ? weeklyTrainingRows.reduce((sum, row) => sum + toFiniteNumberOrZero(row.value), 0)
    : null;
  const avgPaceSeconds =
    weeklyDistanceKm && weeklyDistanceKm > 0 && weeklyDurationMin && weeklyDurationMin > 0
      ? Math.round((weeklyDurationMin * 60) / weeklyDistanceKm)
      : null;

  let longestRunKm: number | null = null;
  let longestRunLabel: string | null = null;
  mileageRows.forEach((row) => {
    const distanceKm = toFiniteNumberOrZero(row.distanceKm);
    if (distanceKm <= 0) {
      return;
    }
    if (longestRunKm === null || distanceKm > longestRunKm) {
      longestRunKm = distanceKm;
      longestRunLabel = formatDate(row.startTime, 'MMM D');
    }
  });

  return {
    weeklyDistanceKm,
    weeklyDurationMin,
    trainingLoad,
    avgPaceSeconds,
    longestRunKm,
    longestRunLabel,
  };
}

function toFiniteNumberOrZero(value: number | null | undefined) {
  return Number.isFinite(value) ? Number(value) : 0;
}

function normalizeDistanceKilometers(value: number) {
  if (!Number.isFinite(value)) {
    return null;
  }
  return value > 500 ? value / 1000 : value;
}

function buildStreamMileageTrend(
  distancePoints: Array<{ ts: number; value: number | null }>,
  elapsedTimePoints: Array<{ ts: number; value: number | null }>
) {
  const distanceTrend = buildDailyStreamTrend(
    distancePoints,
    normalizeDistanceKilometers,
    (values) => Math.max(...values)
  );
  const durationTrend = buildDailyStreamTrend(
    elapsedTimePoints,
    (value) => value / 60,
    (values) => Math.max(...values)
  );

  const rowsByDay = new Map<string, { startTime: string; distanceKm: number; movingMinutes: number }>();

  distanceTrend.forEach((entry) => {
    const row = rowsByDay.get(entry.dayKey) || {
      startTime: entry.startTime,
      distanceKm: 0,
      movingMinutes: 0,
    };
    row.startTime = row.startTime > entry.startTime ? row.startTime : entry.startTime;
    row.distanceKm = entry.value;
    rowsByDay.set(entry.dayKey, row);
  });

  durationTrend.forEach((entry) => {
    const row = rowsByDay.get(entry.dayKey) || {
      startTime: entry.startTime,
      distanceKm: 0,
      movingMinutes: 0,
    };
    row.startTime = row.startTime > entry.startTime ? row.startTime : entry.startTime;
    row.movingMinutes = entry.value;
    rowsByDay.set(entry.dayKey, row);
  });

  return Array.from(rowsByDay.values())
    .sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime))
    .slice(-20);
}

function buildDailyStreamTrend(
  points: Array<{ ts: number; value: number | null }>,
  normalizeValue: (value: number) => number | null,
  aggregate: (values: number[]) => number
) {
  const buckets = new Map<string, { ts: number; values: number[] }>();

  points.forEach((point) => {
    if (!Number.isFinite(point?.ts) || !Number.isFinite(point?.value as number)) {
      return;
    }
    const normalizedValue = normalizeValue(point.value as number);
    if (!Number.isFinite(normalizedValue as number)) {
      return;
    }
    const ts = Math.round(point.ts);
    const date = new Date(ts);
    if (Number.isNaN(date.getTime())) {
      return;
    }
    const dayKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
      date.getDate()
    ).padStart(2, '0')}`;
    const bucket = buckets.get(dayKey) || { ts, values: [] };
    bucket.ts = Math.max(bucket.ts, ts);
    bucket.values.push(normalizedValue as number);
    buckets.set(dayKey, bucket);
  });

  return Array.from(buckets.entries())
    .map(([dayKey, bucket]) => ({
      dayKey,
      startTime: new Date(bucket.ts).toISOString(),
      value: aggregate(bucket.values),
    }))
    .filter((entry) => Number.isFinite(entry.value))
    .sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime));
}

function buildPaceHeartRateScatter(
  pacePoints: Array<{ ts: number; value: number | null }>,
  heartRatePoints: Array<{ ts: number; value: number | null }>
) {
  const paceByMinute = new Map<number, number>();
  pacePoints.forEach((point) => {
    if (!Number.isFinite(point?.ts) || !Number.isFinite(point?.value as number)) {
      return;
    }
    const paceSeconds = Number(point.value);
    if (!Number.isFinite(paceSeconds) || paceSeconds <= 0) {
      return;
    }
    const minuteKey = Math.round(point.ts / 60_000);
    paceByMinute.set(minuteKey, paceSeconds);
  });

  const scatter = heartRatePoints
    .map((point) => {
      if (!Number.isFinite(point?.ts) || !Number.isFinite(point?.value as number)) {
        return null;
      }
      const minuteKey = Math.round(point.ts / 60_000);
      const pace = paceByMinute.get(minuteKey);
      const hr = Number(point.value);
      if (!Number.isFinite(pace as number) || !Number.isFinite(hr) || hr <= 0) {
        return null;
      }
      return {
        x: pace as number,
        y: hr,
        label: formatDate(new Date(point.ts).toISOString(), 'MMM D HH:mm'),
        ts: point.ts,
      };
    })
    .filter((point): point is { x: number; y: number; label: string; ts: number } => Boolean(point))
    .sort((a, b) => a.ts - b.ts)
    .slice(-60);

  return scatter.map(({ x, y, label }) => ({ x, y, label }));
}

function ActivityMetric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <View style={styles.activityMetric}>
      <AppText style={styles.activityMetricLabel}>{label}</AppText>
      <AppText style={styles.activityMetricValue}>{value}</AppText>
      {sub ? <AppText style={styles.mutedText}>{sub}</AppText> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: spacing.lg,
    gap: 12,
    paddingBottom: spacing.lg * 2,
  },
  // Hero card
  heroCard: {
    backgroundColor: colors.glass,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 20,
    gap: 4,
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.4,
    color: colors.muted,
    textTransform: 'uppercase',
  },
  heroNumber: {
    fontSize: 52,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -1,
    lineHeight: 56,
  },
  heroLabel: {
    fontSize: 14,
    color: colors.muted,
    marginBottom: 4,
  },
  heroBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'flex-start',
    borderRadius: 100,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '600',
  },
  // Metric grid
  metricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  activityMetric: {
    width: '47%',
    flexGrow: 1,
    backgroundColor: colors.panel,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    gap: 4,
  },
  activityMetricLabel: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1.2,
    color: colors.muted,
    textTransform: 'uppercase',
  },
  activityMetricValue: {
    fontSize: 21,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.3,
  },
  // Generic card
  card: {
    backgroundColor: colors.panel,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 20,
    gap: 8,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.3,
  },
  cardSubtitle: {
    fontSize: 12,
    color: colors.muted,
    marginBottom: 4,
  },
  cardTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  // Effort rows
  effortRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  effortLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  effortRight: {
    alignItems: 'flex-end',
    gap: 2,
  },
  effortValue: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.accent,
  },
  // Session rows
  sessionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  sessionName: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  sessionRight: {
    alignItems: 'flex-end',
    gap: 2,
  },
  sessionDistance: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.accent,
  },
  seeAllBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  seeAllText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.accent,
  },
  // Phone export
  phoneExportActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  phoneStepRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.glass,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginTop: 4,
  },
  phoneStepLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.1,
    color: colors.muted,
    textTransform: 'uppercase',
  },
  phoneStepValue: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.3,
  },
  // Strava
  stravaActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  stravaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 100,
    borderWidth: 1,
    borderColor: `${colors.warning}44`,
    backgroundColor: `${colors.warning}1a`,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  stravaPillConnected: {
    borderColor: `${colors.accent}44`,
    backgroundColor: `${colors.accent}1a`,
  },
  // Misc
  mutedText: {
    fontSize: 13,
    color: colors.muted,
    lineHeight: 18,
  },
  errorBanner: {
    backgroundColor: `${colors.danger}18`,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: `${colors.danger}44`,
    padding: 12,
  },
  errorText: {
    fontSize: 13,
    color: colors.danger,
  },
  // Chart fallback (used by ChartErrorBoundary)
  chartFallback: {
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  // Goal card styles (ActivityGoalCard / GoalProgressBar)
  goalContent: {
    gap: spacing.md,
  },
  goalMetric: {
    gap: spacing.xs,
  },
  goalMetricHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  goalBar: {
    height: 8,
    borderRadius: 999,
    backgroundColor: colors.border,
    overflow: 'hidden',
  },
  goalBarFill: {
    backgroundColor: colors.accent,
    height: '100%',
  },
  goalActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  goalForm: {
    gap: spacing.sm,
  },
  goalFeedback: {
    marginTop: spacing.xs,
  },
  goalMinimizedRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
  },
});

function extractErrorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError) {
    if (error.message) {
      return error.message;
    }
    if (error.status) {
      return `${fallback} (HTTP ${error.status})`;
    }
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
}

interface ChartErrorBoundaryProps {
  children: ReactNode;
  fallback: string;
}

interface ChartErrorBoundaryState {
  hasError: boolean;
}

class ChartErrorBoundary extends Component<ChartErrorBoundaryProps, ChartErrorBoundaryState> {
  state: ChartErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    console.warn('Activity chart render failed', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.chartFallback}>
          <AppText variant="muted">{this.props.fallback}</AppText>
        </View>
      );
    }

    return this.props.children;
  }
}
