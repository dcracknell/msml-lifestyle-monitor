import { StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { vitalsRequest } from '../../api/endpoints';
import { useSubject } from '../../providers/SubjectProvider';
import { useAuth } from '../../providers/AuthProvider';
import {
  LoadingView,
  ErrorView,
  Card,
  SectionHeader,
  AppText,
  TrendChart,
  RefreshableScrollView,
} from '../../components';
import { spacing } from '../../theme';
import { formatDate, formatNumber } from '../../utils/format';

export function VitalsScreen() {
  const { subjectId } = useSubject();
  const { user } = useAuth();
  const requestSubject = subjectId && subjectId !== user?.id ? subjectId : undefined;

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['vitals', requestSubject || user?.id],
    queryFn: () => vitalsRequest({ athleteId: requestSubject }),
    enabled: Boolean(user?.id),
  });

  if (isLoading || !data) {
    return <LoadingView />;
  }

  if (isError) {
    return <ErrorView message="Unable to load vitals" onRetry={refetch} />;
  }

  const timeline = data.timeline || [];
  const restingTrend = timeline.slice(-14).map((entry) => ({
    label: formatDate(entry.date, 'MMM D'),
    value: entry.restingHr || 0,
  }));
  const glucoseTrend = timeline.slice(-14).map((entry) => ({
    label: formatDate(entry.date, 'MMM D'),
    value: entry.glucose || 0,
  }));

  return (
    <RefreshableScrollView
      contentContainerStyle={styles.container}
      refreshing={isRefetching}
      onRefresh={refetch}
      showsVerticalScrollIndicator={false}
    >
      <Card>
        <SectionHeader title="Latest vitals" subtitle={formatDate(data.latest?.date)} />
        <View style={styles.metricsRow}>
          <Metric label="Resting HR" value={`${data.latest?.restingHr ?? '--'} bpm`} />
          <Metric label="HRV" value={`${data.latest?.hrvScore ?? '--'} ms`} />
        </View>
        <View style={styles.metricsRow}>
          <Metric label="SpO₂" value={`${data.latest?.spo2 ?? '--'} %`} />
          <Metric label="Stress" value={formatNumber(data.latest?.stressScore)} />
        </View>
        <View style={styles.metricsRow}>
          <Metric label="Blood pressure" value={`${data.latest?.systolic ?? '--'}/${data.latest?.diastolic ?? '--'}`} />
          <Metric label="Glucose" value={`${data.latest?.glucose ?? '--'} mg/dL`} />
        </View>
      </Card>
      <Card>
        <SectionHeader title="Resting HR" subtitle="14-day trend" />
        <TrendChart
          data={restingTrend}
          yLabel="bpm"
          yDomain={[40, 200]}
          yTickStep={10}
        />
      </Card>
      <Card>
        <SectionHeader title="Glucose" subtitle="14-day trend" />
        <TrendChart
          data={glucoseTrend}
          yLabel="mg/dL"
          yDomain={[70, 200]}
          yTickStep={10}
        />
      </Card>
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
    marginBottom: spacing.sm,
  },
  metric: {
    flex: 1,
  },
});
