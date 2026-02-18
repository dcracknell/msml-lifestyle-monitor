import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
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
import { activityRequest, connectStravaRequest, disconnectStravaRequest, syncStravaRequest } from '../../api/endpoints';
import { ActivityEffort } from '../../api/types';
import { ApiError } from '../../api/client';
import { useSubject } from '../../providers/SubjectProvider';
import { useAuth } from '../../providers/AuthProvider';
import { colors, spacing } from '../../theme';
import { formatDate, formatDecimal, formatDistance, formatMinutes, formatNumber, formatPace } from '../../utils/format';
import { useActivityGoals } from './useActivityGoals';

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

function formatHeartRateAxis(value: number) {
  if (!Number.isFinite(value)) {
    return '--';
  }
  return `${Math.round(value)} bpm`;
}

export function ActivityScreen() {
  const { subjectId } = useSubject();
  const { user } = useAuth();
  const navigation = useNavigation();
  const requestSubject = subjectId && subjectId !== user?.id ? subjectId : undefined;
  const [stravaFeedback, setStravaFeedback] = useState<string | null>(null);

  const { data, isLoading, isError, error, refetch, isFetching, isRefetching } = useQuery({
    queryKey: ['activity', requestSubject || user?.id],
    queryFn: () => activityRequest({ athleteId: requestSubject }),
    enabled: Boolean(user?.id),
  });
  const {
    goals,
    minimized: goalsMinimized,
    isReady: goalsReady,
    saveGoals,
    toggleMinimized,
  } = useActivityGoals();

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
      setStravaFeedback(`Imported ${payload.imported} of ${payload.fetched} activities.`);
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
  const mileageSeries = [
    {
      id: 'distance',
      label: 'Distance (km)',
      color: colors.accent,
      data: mileageTrend.map((entry) => ({
        label: formatDate(entry.startTime, 'MMM D'),
        value: entry.distanceKm ?? 0,
      })),
    },
    {
      id: 'duration',
      label: 'Duration (min)',
      color: colors.accentStrong,
      strokeDasharray: '6,4',
      data: mileageTrend.map((entry) => ({
        label: formatDate(entry.startTime, 'MMM D'),
        value: entry.movingMinutes ?? 0,
      })),
    },
  ];
  const legendItems = mileageSeries
    .filter((serie) => serie.data.length)
    .map((serie) => ({ label: serie.label, color: serie.color || colors.accent }));
  const trainingTrend = trainingLoadTrendData.map((entry) => ({
    label: formatDate(entry.startTime, 'MMM D'),
    value: entry.trainingLoad ?? 0,
  }));
  const pacePoints = heartRatePaceData.map((point) => ({
    x: Number(point.paceSeconds),
    y: Number(point.heartRate),
    label: point.label,
  }));

  return (
    <RefreshableScrollView
      contentContainerStyle={styles.container}
      refreshing={isRefetching}
      onRefresh={refetch}
      showsVerticalScrollIndicator={false}
    >
      {isError ? (
        <Card>
          <AppText variant="muted">{extractErrorMessage(error, 'Showing cached activity data.')}</AppText>
        </Card>
      ) : null}
      {goalsReady ? (
        <ActivityGoalCard
          summaryDistanceKm={summary?.weeklyDistanceKm ?? 0}
          summaryDurationMin={summary?.weeklyDurationMin ?? 0}
          goals={goals}
          minimized={goalsMinimized}
          onSaveGoals={saveGoals}
          onToggleMinimized={toggleMinimized}
        />
      ) : null}
      <SectionHeader title="Training summary" subtitle={data.subject?.name} />
      <View style={styles.statRow}>
        <StatCard label="Weekly distance" value={formatKilometers(summary?.weeklyDistanceKm)} />
        <StatCard label="Weekly duration" value={formatWeeklyDuration(summary?.weeklyDurationMin)} />
      </View>
      <View style={styles.statRow}>
        <StatCard label="Training load" value={formatNumber(summary?.trainingLoad)} />
        <StatCard label="VO₂ max" value={formatDecimal(summary?.vo2maxEstimate ?? null, 1)} />
      </View>
      <View style={styles.statRow}>
        <StatCard label="Avg pace" value={formatPace(summary?.avgPaceSeconds)} />
        <StatCard
          label="Longest run"
          value={formatKilometers(summary?.longestRunKm)}
          trend={summary?.longestRunName || 'Awaiting sync'}
        />
      </View>
      <Card>
        <SectionHeader title="Mileage vs duration" subtitle="Last sessions" />
        <MultiSeriesLineChart series={mileageSeries} yLabel="Volume" />
        <ChartLegend items={legendItems} />
      </Card>
      <Card>
        <SectionHeader title="Training load" subtitle="Recent sync" />
        <TrendChart data={trainingTrend} yLabel="Load" />
      </Card>
      <Card>
        <SectionHeader title="Pace vs heart rate" subtitle="Session comparison" />
        <ScatterChart
          data={pacePoints}
          xLabel="Pace (per km)"
          yLabel="Avg heart rate"
          xFormatter={(value) => formatPace(Number(value))}
          yFormatter={(value) => formatHeartRateAxis(Number(value))}
        />
      </Card>
      <Card>
        <SectionHeader title="Best efforts" subtitle="Auto-detected" />
        {efforts.length ? (
          efforts.map((effort) => (
            <View key={effort.label} style={styles.effortRow}>
              <AppText variant="body">{effort.label}</AppText>
              <View>
                <AppText variant="heading">{formatDistance(effort.distance || 0)}</AppText>
                <AppText variant="muted">{formatPace(effort.paceSeconds)}</AppText>
              </View>
            </View>
          ))
        ) : (
          <AppText variant="muted">Not enough data yet.</AppText>
        )}
      </Card>
      <Card>
        <SectionHeader title="Recent sessions" subtitle="Latest 3" action={
          <AppButton title="See all" variant="ghost" onPress={() => navigation.navigate('Sessions' as never)} />
        } />
        {sessions.length ? (
          sessions.slice(0, 3).map((session) => (
            <View key={session.id} style={styles.sessionRow}>
              <View>
                <AppText variant="body">{session.name}</AppText>
                <AppText variant="muted">{formatDate(session.startTime)} · {session.sportType}</AppText>
              </View>
              <View>
                <AppText variant="heading">{formatDistance(session.distance || 0)}</AppText>
                <AppText variant="muted">{formatPace(session.averagePace)}</AppText>
              </View>
            </View>
          ))
        ) : (
          <AppText variant="muted">No sessions available yet.</AppText>
        )}
      </Card>
      {data.strava?.enabled ? (
        <Card>
          <SectionHeader title="Strava" subtitle={data.strava.connected ? 'Connected' : 'Not linked'} />
          <AppText variant="muted">
            {data.strava.connected
              ? `Last sync ${data.strava.lastSync ? formatDate(data.strava.lastSync, 'MMM D, HH:mm') : 'pending'}`
              : 'Link to import outdoor sessions with splits.'}
          </AppText>
          <View style={styles.stravaActions}>
            {data.strava.canManage && !data.strava.connected ? (
              <AppButton title="Connect Strava" onPress={handleConnect} loading={isFetching} />
            ) : null}
            {data.strava.connected ? (
              <>
                <AppButton title="Sync now" variant="ghost" onPress={handleSync} loading={isFetching} />
                <AppButton title="Disconnect" variant="ghost" onPress={handleDisconnect} />
              </>
            ) : null}
          </View>
          {data.strava.requiresSetup ? (
            <AppText variant="muted" style={styles.warning}>
              Add your Strava API keys under Profile before connecting.
            </AppText>
          ) : null}
          {stravaFeedback ? (
            <AppText variant="muted" style={styles.stravaFeedback}>
              {stravaFeedback}
            </AppText>
          ) : null}
        </Card>
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

const styles = StyleSheet.create({
  container: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
  statRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  effortRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  sessionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  stravaActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  warning: {
    marginTop: spacing.sm,
    color: colors.warning,
  },
  stravaFeedback: {
    marginTop: spacing.sm,
  },
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
