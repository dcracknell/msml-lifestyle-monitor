import dayjs from 'dayjs';
import { StyleSheet, View } from 'react-native';
import { useQueries } from '@tanstack/react-query';
import {
  AppButton,
  Card,
  AppText,
  ErrorView,
  LoadingView,
  RefreshableScrollView,
  SectionHeader,
  StatCard,
  SubjectSwitcher,
  TrendChart,
} from '../../components';
import {
  activityRequest,
  metricsRequest,
  nutritionRequest,
  vitalsRequest,
  weightRequest,
} from '../../api/endpoints';
import { useSubject } from '../../providers/SubjectProvider';
import { useAuth } from '../../providers/AuthProvider';
import { formatDate, formatDecimal, formatNumber, formatPace } from '../../utils/format';
import { spacing } from '../../theme';

export function OverviewScreen() {
  const { subjectId } = useSubject();
  const { user } = useAuth();
  const requestSubject = subjectId && subjectId !== user?.id ? subjectId : undefined;
  const subjectQueryKey = requestSubject || user?.id;
  const selectedDate = dayjs().format('YYYY-MM-DD');

  const [sleepQuery, activityQuery, vitalsQuery, nutritionQuery, weightQuery] = useQueries({
    queries: [
      {
        queryKey: ['sleep', subjectQueryKey],
        queryFn: () => metricsRequest({ athleteId: requestSubject }),
        enabled: Boolean(user?.id),
      },
      {
        queryKey: ['activity', subjectQueryKey],
        queryFn: () => activityRequest({ athleteId: requestSubject }),
        enabled: Boolean(user?.id),
      },
      {
        queryKey: ['vitals', subjectQueryKey],
        queryFn: () => vitalsRequest({ athleteId: requestSubject }),
        enabled: Boolean(user?.id),
      },
      {
        queryKey: ['nutrition', subjectQueryKey, selectedDate],
        queryFn: () => nutritionRequest({ athleteId: requestSubject, date: selectedDate }),
        enabled: Boolean(user?.id),
      },
      {
        queryKey: ['weight', subjectQueryKey],
        queryFn: () => weightRequest({ athleteId: requestSubject }),
        enabled: Boolean(user?.id),
      },
    ],
  });

  const sleepData = sleepQuery.data;
  const activityData = activityQuery.data;
  const vitalsData = vitalsQuery.data;
  const nutritionData = nutritionQuery.data;
  const weightData = weightQuery.data;

  const hasAnyData = Boolean(sleepData || activityData || vitalsData || nutritionData || weightData);
  const anyLoading =
    sleepQuery.isLoading ||
    activityQuery.isLoading ||
    vitalsQuery.isLoading ||
    nutritionQuery.isLoading ||
    weightQuery.isLoading;
  const anyError =
    sleepQuery.isError ||
    activityQuery.isError ||
    vitalsQuery.isError ||
    nutritionQuery.isError ||
    weightQuery.isError;

  if (!hasAnyData && anyLoading) {
    return <LoadingView />;
  }

  const handleRefresh = () => {
    void Promise.all([
      sleepQuery.refetch(),
      activityQuery.refetch(),
      vitalsQuery.refetch(),
      nutritionQuery.refetch(),
      weightQuery.refetch(),
    ]);
  };

  if (!hasAnyData && anyError) {
    return <ErrorView message="Unable to load overview" onRetry={handleRefresh} />;
  }

  const subjectName =
    sleepData?.subject?.name ||
    activityData?.subject?.name ||
    vitalsData?.subject?.name ||
    user?.name ||
    'athlete';
  const firstName = subjectName.split(' ')[0] || 'athlete';

  const readinessTrend = (sleepData?.readiness || []).slice(-10).map((entry) => ({
    label: formatDate(entry.date, 'MMM D'),
    value: entry.readiness || 0,
  }));

  const sleepTrend = (sleepData?.timeline || [])
    .slice(-14)
    .map((entry) => ({
      label: formatDate(entry.date, 'MMM D'),
      value: entry.sleepHours ?? 0,
    }))
    .filter((entry) => Number.isFinite(entry.value));

  const trainingLoadTrend = (activityData?.charts?.trainingLoad || []).slice(-10).map((entry) => ({
    label: formatDate(entry.startTime, 'MMM D'),
    value: entry.trainingLoad ?? 0,
  }));

  const activitySummary = activityData?.summary;
  const latestVitals = vitalsData?.latest;
  const latestWeightEntry = weightData?.latest || weightData?.recent?.[0] || weightData?.timeline?.[0] || null;
  const latestWeightKg = latestWeightEntry?.weightKg ?? null;
  const weightWeeklyChange = weightData?.stats?.weeklyChangeKg ?? null;
  const calorieGoal = nutritionData?.goals?.targetCalories ?? nutritionData?.goals?.calories ?? null;

  const refreshing =
    sleepQuery.isRefetching ||
    activityQuery.isRefetching ||
    vitalsQuery.isRefetching ||
    nutritionQuery.isRefetching ||
    weightQuery.isRefetching;

  return (
    <RefreshableScrollView
      contentContainerStyle={styles.container}
      refreshing={refreshing}
      onRefresh={handleRefresh}
      showsVerticalScrollIndicator={false}
    >
      <SubjectSwitcher />
      <Card>
        <AppText variant="eyebrow">Overview</AppText>
        <AppText variant="heading" style={styles.greeting}>
          {firstName}'s cross-page snapshot
        </AppText>
        <AppText variant="muted">
          Data is pulled from Activity, Sleep, Vitals, Nutrition, and Weight.
        </AppText>
      </Card>
      <Card>
        <SectionHeader title="Training snapshot" subtitle="From Activity page" />
        {activityQuery.isError && !activityData ? (
          <SectionRetryMessage label="Unable to load activity data." onRetry={activityQuery.refetch} />
        ) : (
          <>
            <View style={styles.statRow}>
              <StatCard label="Weekly distance" value={formatKilometers(activitySummary?.weeklyDistanceKm)} />
              <StatCard label="Weekly duration" value={formatWeeklyDuration(activitySummary?.weeklyDurationMin)} />
            </View>
            <View style={styles.statRow}>
              <StatCard label="Training load" value={formatNumber(activitySummary?.trainingLoad)} />
              <StatCard label="Avg pace" value={formatPace(activitySummary?.avgPaceSeconds)} />
            </View>
          </>
        )}
      </Card>
      <Card>
        <SectionHeader title="Recovery snapshot" subtitle="From Sleep and Vitals pages" />
        {sleepQuery.isError && !sleepData && vitalsQuery.isError && !vitalsData ? (
          <SectionRetryMessage label="Unable to load recovery data." onRetry={handleRefresh} />
        ) : (
          <>
            <View style={styles.statRow}>
              <StatCard label="Sleep avg" value={formatHours(sleepData?.summary?.sleepHours)} />
              <StatCard
                label="Readiness"
                value={formatNumber(sleepData?.summary?.readiness, { suffix: '%' })}
              />
            </View>
            <View style={styles.statRow}>
              <StatCard label="Resting HR" value={formatBpm(latestVitals?.restingHr)} />
              <StatCard label="HRV" value={formatMs(latestVitals?.hrvScore)} />
            </View>
          </>
        )}
      </Card>
      <Card>
        <SectionHeader title="Nutrition + body" subtitle="From Nutrition and Weight pages" />
        {nutritionQuery.isError && !nutritionData && weightQuery.isError && !weightData ? (
          <SectionRetryMessage label="Unable to load nutrition and body data." onRetry={handleRefresh} />
        ) : (
          <>
            <View style={styles.statRow}>
              <StatCard
                label="Calories"
                value={formatMacroProgress(nutritionData?.dailyTotals?.calories, calorieGoal)}
              />
              <StatCard
                label="Protein"
                value={formatMacroProgress(
                  nutritionData?.dailyTotals?.protein,
                  nutritionData?.goals?.protein,
                  ' g'
                )}
              />
            </View>
            <View style={styles.statRow}>
              <StatCard
                label="Latest weight"
                value={latestWeightKg === null ? '--' : `${formatDecimal(latestWeightKg, 1)} kg`}
                trend={
                  latestWeightEntry?.date
                    ? `Updated ${formatDate(latestWeightEntry.date, 'MMM D')}`
                    : null
                }
              />
              <StatCard
                label="Weekly change"
                value={
                  weightWeeklyChange === null || weightWeeklyChange === undefined
                    ? '--'
                    : `${weightWeeklyChange > 0 ? '+' : ''}${weightWeeklyChange.toFixed(1)} kg`
                }
                tone={weightWeeklyChange !== null && weightWeeklyChange > 0 ? 'negative' : 'default'}
              />
            </View>
          </>
        )}
      </Card>
      <Card>
        <SectionHeader title="Readiness trend" subtitle="From Sleep page" />
        {sleepQuery.isError && !sleepData ? (
          <SectionRetryMessage label="Unable to load readiness trend." onRetry={sleepQuery.refetch} />
        ) : (
          <TrendChart data={readinessTrend} yLabel="Score" />
        )}
      </Card>
      <Card>
        <SectionHeader title="Sleep trend" subtitle="From Sleep page" />
        {sleepQuery.isError && !sleepData ? (
          <SectionRetryMessage label="Unable to load sleep trend." onRetry={sleepQuery.refetch} />
        ) : (
          <TrendChart data={sleepTrend} yLabel="hours" />
        )}
      </Card>
      <Card>
        <SectionHeader title="Training load trend" subtitle="From Activity page" />
        {activityQuery.isError && !activityData ? (
          <SectionRetryMessage label="Unable to load training trend." onRetry={activityQuery.refetch} />
        ) : (
          <TrendChart data={trainingLoadTrend} yLabel="Load" />
        )}
      </Card>
    </RefreshableScrollView>
  );
}

function SectionRetryMessage({ label, onRetry }: { label: string; onRetry: () => void }) {
  return (
    <View style={styles.sectionError}>
      <AppText variant="muted">{label}</AppText>
      <AppButton title="Retry" variant="ghost" onPress={onRetry} />
    </View>
  );
}

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

function formatHours(hours?: number | null) {
  if (hours === null || hours === undefined || Number.isNaN(hours)) {
    return '--';
  }
  return `${hours.toFixed(1)} h`;
}

function formatBpm(value?: number | null) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '--';
  }
  return `${Math.round(value)} bpm`;
}

function formatMs(value?: number | null) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '--';
  }
  return `${Math.round(value)} ms`;
}

function formatMacroProgress(
  current?: number | null,
  target?: number | null,
  suffix?: string
) {
  const currentLabel = formatNumber(current, suffix ? { suffix } : undefined);
  if (target === null || target === undefined || Number.isNaN(target)) {
    return currentLabel;
  }
  const targetLabel = formatNumber(target, suffix ? { suffix } : undefined);
  return `${currentLabel} / ${targetLabel}`;
}

const styles = StyleSheet.create({
  container: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
  greeting: {
    marginVertical: spacing.sm,
  },
  statRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  sectionError: {
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
});
