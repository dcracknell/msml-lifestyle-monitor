import { StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import {
  Card,
  SectionHeader,
  AppText,
  StatCard,
  ProgressRing,
  TrendChart,
  SubjectSwitcher,
  LoadingView,
  ErrorView,
  RefreshableScrollView,
} from '../../components';
import { metricsRequest } from '../../api/endpoints';
import { useSubject } from '../../providers/SubjectProvider';
import { useAuth } from '../../providers/AuthProvider';
import { formatDate, formatNumber } from '../../utils/format';
import { colors, spacing } from '../../theme';

export function OverviewScreen() {
  const { subjectId } = useSubject();
  const { user } = useAuth();
  const requestSubject = subjectId && subjectId !== user?.id ? subjectId : undefined;

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['metrics', requestSubject || user?.id],
    queryFn: () => metricsRequest({ athleteId: requestSubject }),
    enabled: Boolean(user?.id),
  });

  if (isLoading || !data) {
    return <LoadingView />;
  }

  if (isError) {
    return <ErrorView message="Unable to load metrics" onRetry={refetch} />;
  }

  const readinessScore = data.summary?.readiness ?? 0;
  const readinessTrend = (data.readiness || []).slice(-10).map((entry) => ({
    label: formatDate(entry.date, 'MMM D'),
    value: entry.readiness || 0,
  }));
  const hydrationTrend = (data.hydration || []).slice(-10).map((entry) => ({
    label: formatDate(entry.date, 'MMM D'),
    value: entry.ounces,
  }));

  return (
    <RefreshableScrollView
      contentContainerStyle={styles.container}
      refreshing={isRefetching}
      onRefresh={refetch}
      showsVerticalScrollIndicator={false}
    >
      <SubjectSwitcher />
      <Card>
        <AppText variant="eyebrow">Welcome</AppText>
        <AppText variant="heading" style={styles.greeting}>
          Ready to sync, {data.subject?.name?.split(' ')[0] || 'athlete'}
        </AppText>
        <AppText variant="muted">
          Goals • Steps {formatNumber(data.subject?.goal_steps)} • Sleep {data.subject?.goal_sleep}h
        </AppText>
      </Card>
      <View style={styles.statRow}>
        <StatCard label="Steps" value={formatNumber(data.summary?.steps)} trend="today" />
        <StatCard label="Calories" value={formatNumber(data.summary?.calories)} />
      </View>
      <View style={styles.statRow}>
        <StatCard label="Sleep" value={`${data.summary?.sleepHours ?? '--'} h`} />
        <StatCard label="Goal readiness" value={`${data.subject?.goal_readiness ?? '--'}%`} />
      </View>
      <Card>
        <SectionHeader title="Readiness" subtitle="Last 10 days" />
        <View style={styles.readinessContent}>
          <ProgressRing value={readinessScore || 0} label="Today" />
          <TrendChart data={readinessTrend} yLabel="Score" />
        </View>
      </Card>
      <Card>
        <SectionHeader title="Hydration" subtitle="Logged liquids" />
        <TrendChart data={hydrationTrend} yLabel="oz" />
      </Card>
      <Card>
        <SectionHeader title="Macro targets" subtitle="Latest goals" />
        <View style={styles.macroRow}>
          <AppText variant="body">Calories</AppText>
          <AppText variant="heading">{formatNumber(data.macros?.targetCalories || data.macros?.calories)}</AppText>
        </View>
        <View style={styles.macroRow}>
          <AppText variant="body">Protein</AppText>
          <AppText variant="heading">{formatNumber(data.macros?.protein, { suffix: ' g' })}</AppText>
        </View>
        <View style={styles.macroRow}>
          <AppText variant="body">Carbs</AppText>
          <AppText variant="heading">{formatNumber(data.macros?.carbs, { suffix: ' g' })}</AppText>
        </View>
        <View style={styles.macroRow}>
          <AppText variant="body">Fats</AppText>
          <AppText variant="heading">{formatNumber(data.macros?.fats, { suffix: ' g' })}</AppText>
        </View>
      </Card>
    </RefreshableScrollView>
  );
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
  readinessContent: {
    flexDirection: 'row',
    gap: spacing.md,
    alignItems: 'center',
  },
  macroRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
});
