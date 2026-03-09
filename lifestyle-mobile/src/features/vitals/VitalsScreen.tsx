import { StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { streamHistoryRequest, vitalsRequest } from '../../api/endpoints';
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

const VITALS_STREAM_WINDOW_MS = 45 * 24 * 60 * 60 * 1000;

export function VitalsScreen() {
  const { subjectId } = useSubject();
  const { user } = useAuth();
  const requestSubject = subjectId && subjectId !== user?.id ? subjectId : undefined;

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['vitals', requestSubject || user?.id],
    queryFn: () => vitalsRequest({ athleteId: requestSubject }),
    enabled: Boolean(user?.id),
  });
  const { data: restingHrStreamData } = useQuery({
    queryKey: ['stream-history', 'vitals.resting_hr', requestSubject || user?.id],
    queryFn: () =>
      streamHistoryRequest({
        metric: 'vitals.resting_hr',
        athleteId: requestSubject,
        windowMs: VITALS_STREAM_WINDOW_MS,
        maxPoints: 600,
      }),
    enabled: Boolean(user?.id),
  });
  const { data: glucoseStreamData } = useQuery({
    queryKey: ['stream-history', 'vitals.glucose', requestSubject || user?.id],
    queryFn: () =>
      streamHistoryRequest({
        metric: 'vitals.glucose',
        athleteId: requestSubject,
        windowMs: VITALS_STREAM_WINDOW_MS,
        maxPoints: 600,
      }),
    enabled: Boolean(user?.id),
  });

  if (isLoading || !data) {
    return <LoadingView />;
  }

  if (isError) {
    return <ErrorView message="Unable to load vitals" onRetry={refetch} />;
  }

  const timeline = data.timeline || [];
  const restingTrendFromStreams = buildDailyTrendFromStream(
    restingHrStreamData?.points || [],
    (values) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length)
  ).slice(-14);
  const glucoseTrendFromStreams = buildDailyTrendFromStream(
    glucoseStreamData?.points || [],
    (values) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length)
  ).slice(-14);
  const restingTrend = restingTrendFromStreams.length
    ? restingTrendFromStreams
    : timeline.slice(-14).map((entry) => ({
        label: formatDate(entry.date, 'MMM D'),
        value: entry.restingHr || 0,
      }));
  const glucoseTrend = glucoseTrendFromStreams.length
    ? glucoseTrendFromStreams
    : timeline.slice(-14).map((entry) => ({
        label: formatDate(entry.date, 'MMM D'),
        value: entry.glucose || 0,
      }));
  const latestRestingHrValue =
    restingTrend.length > 0 ? restingTrend[restingTrend.length - 1].value : data.latest?.restingHr;
  const latestGlucoseValue =
    glucoseTrend.length > 0 ? glucoseTrend[glucoseTrend.length - 1].value : data.latest?.glucose;
  const latestStreamTs = Math.max(
    latestPointTimestamp(restingHrStreamData?.points || []),
    latestPointTimestamp(glucoseStreamData?.points || [])
  );
  const latestFallbackDate =
    timeline.length > 0 ? timeline[timeline.length - 1]?.date : data.latest?.date;
  const latestVitalsDate = latestStreamTs > 0 ? new Date(latestStreamTs).toISOString() : latestFallbackDate;

  return (
    <RefreshableScrollView
      contentContainerStyle={styles.container}
      refreshing={isRefetching}
      onRefresh={refetch}
      showsVerticalScrollIndicator={false}
    >
      <Card>
        <SectionHeader title="Latest vitals" subtitle={formatDate(latestVitalsDate)} />
        <View style={styles.metricsRow}>
          <Metric
            label="Resting HR"
            value={`${toRoundedIntegerLabel(latestRestingHrValue)} bpm`}
          />
          <Metric label="HRV" value={`${data.latest?.hrvScore ?? '--'} ms`} />
        </View>
        <View style={styles.metricsRow}>
          <Metric label="SpO₂" value={`${data.latest?.spo2 ?? '--'} %`} />
          <Metric label="Stress" value={formatNumber(data.latest?.stressScore)} />
        </View>
        <View style={styles.metricsRow}>
          <Metric label="Blood pressure" value={`${data.latest?.systolic ?? '--'}/${data.latest?.diastolic ?? '--'}`} />
          <Metric label="Glucose" value={`${toRoundedIntegerLabel(latestGlucoseValue)} mg/dL`} />
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

function toRoundedIntegerLabel(value: number | null | undefined) {
  return Number.isFinite(value) ? String(Math.round(value as number)) : '--';
}

function latestPointTimestamp(points: Array<{ ts: number; value: number | null }>) {
  return points.reduce((latest, point) => {
    if (!Number.isFinite(point?.ts) || !Number.isFinite(point?.value as number)) {
      return latest;
    }
    return Math.max(latest, Math.round(point.ts));
  }, 0);
}

function buildDailyTrendFromStream(
  points: Array<{ ts: number; value: number | null }>,
  aggregate: (values: number[]) => number
) {
  const perDay = new Map<string, { ts: number; values: number[] }>();
  points.forEach((point) => {
    if (!Number.isFinite(point?.ts) || !Number.isFinite(point?.value as number)) {
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
    const bucket = perDay.get(dayKey) || { ts, values: [] };
    bucket.ts = Math.max(bucket.ts, ts);
    bucket.values.push(point.value as number);
    perDay.set(dayKey, bucket);
  });

  return Array.from(perDay.values())
    .map((bucket) => ({
      label: formatDate(new Date(bucket.ts).toISOString(), 'MMM D'),
      value: aggregate(bucket.values),
      ts: bucket.ts,
    }))
    .filter((entry) => Number.isFinite(entry.value))
    .sort((a, b) => a.ts - b.ts)
    .map((entry) => ({ label: entry.label, value: entry.value }));
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
