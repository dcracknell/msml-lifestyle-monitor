import { StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { athletesRequest } from '../../api/endpoints';
import { useAuth } from '../../providers/AuthProvider';
import {
  AppText,
  Card,
  ErrorView,
  LoadingView,
  SectionHeader,
  RefreshableScrollView,
} from '../../components';
import { colors, spacing } from '../../theme';
import { formatNumber } from '../../utils/format';

export function RosterScreen() {
  const { user } = useAuth();
  const isCoach = user?.role === 'Coach' || user?.role === 'Head Coach';
  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['roster'],
    queryFn: athletesRequest,
    enabled: isCoach,
  });

  if (!isCoach) {
    return (
      <View style={styles.centered}> 
        <AppText variant="muted">Roster is available to coaches only.</AppText>
      </View>
    );
  }

  if (isLoading || !data) {
    return <LoadingView />;
  }

  if (isError) {
    return <ErrorView message="Unable to load roster" onRetry={refetch} />;
  }

  return (
    <RefreshableScrollView
      contentContainerStyle={styles.container}
      refreshing={isRefetching}
      onRefresh={refetch}
      showsVerticalScrollIndicator={false}
    >
      <SectionHeader title="Athlete roster" subtitle={`${data.athletes.length} linked`} />
      {data.athletes.map((athlete) => (
        <Card key={athlete.id}>
          <AppText variant="heading">{athlete.name}</AppText>
          <AppText variant="muted">{athlete.role}</AppText>
          <View style={styles.metricsRow}>
            <Metric label="Readiness" value={`${athlete.readinessScore ?? '--'}`} />
            <Metric label="Steps" value={formatNumber(athlete.steps)} />
          </View>
          <View style={styles.metricsRow}>
            <Metric label="Calories" value={formatNumber(athlete.calories)} />
            <Metric label="Sleep" value={`${athlete.sleepHours ?? '--'} h`} />
          </View>
        </Card>
      ))}
    </RefreshableScrollView>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metric}>
      <AppText variant="label">{label}</AppText>
      <AppText variant="heading">{value}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
  metricsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
  metric: {
    flex: 1,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
  },
});
