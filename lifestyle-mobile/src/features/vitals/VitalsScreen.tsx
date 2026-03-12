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
import { colors, spacing } from '../../theme';
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

  const hrvValue = data.latest?.hrvScore ?? null;
  const hrv = hrvValue !== null ? `${hrvValue} ms` : '--';

  return (
    <RefreshableScrollView
      contentContainerStyle={styles.container}
      refreshing={isRefetching}
      onRefresh={refetch}
      showsVerticalScrollIndicator={false}
    >
      {/* Hero */}
      <View style={styles.heroCard}>
        <AppText style={styles.eyebrow}>VITALS · {latestVitalsDate ? formatDate(latestVitalsDate) : 'No data'}</AppText>
        <AppText style={styles.heroNumber}>{hrv}</AppText>
        <AppText style={styles.heroLabel}>Heart Rate Variability</AppText>
        <View style={styles.heroBadge}>
          <View style={[styles.badgeDot, { backgroundColor: colors.accent }]} />
          <AppText style={[styles.badgeText, { color: colors.accent }]}>Recovery signal</AppText>
        </View>
      </View>

      {/* 2×3 metric grid */}
      <View style={styles.metricGrid}>
        <MetricCard label="RESTING HR" value={`${toRoundedIntegerLabel(latestRestingHrValue)}`} unit="bpm" />
        <MetricCard label="SPO₂" value={`${data.latest?.spo2 ?? '--'}`} unit="%" />
        <MetricCard label="STRESS" value={formatNumber(data.latest?.stressScore)} unit="score" />
        <MetricCard label="BLOOD PRESSURE" value={`${data.latest?.systolic ?? '--'}/${data.latest?.diastolic ?? '--'}`} unit="mmHg" />
        <MetricCard label="GLUCOSE" value={`${toRoundedIntegerLabel(latestGlucoseValue)}`} unit="mg/dL" />
        <MetricCard label="HRV" value={hrv} unit="" />
      </View>

      {/* Resting HR trend */}
      <View style={styles.card}>
        <AppText style={styles.eyebrow}>TREND · RESTING HR</AppText>
        <AppText style={styles.cardTitle}>Resting heart rate</AppText>
        <AppText style={styles.cardSubtitle}>14-day window</AppText>
        <TrendChart data={restingTrend} yLabel="bpm" yDomain={[40, 200]} yTickStep={10} />
      </View>

      {/* Glucose trend */}
      <View style={styles.card}>
        <AppText style={styles.eyebrow}>TREND · GLUCOSE</AppText>
        <AppText style={styles.cardTitle}>Blood glucose</AppText>
        <AppText style={styles.cardSubtitle}>14-day window</AppText>
        <TrendChart data={glucoseTrend} yLabel="mg/dL" yDomain={[70, 200]} yTickStep={10} />
      </View>
    </RefreshableScrollView>
  );
}

function MetricCard({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <View style={styles.metricCard}>
      <AppText style={styles.metricLabel}>{label}</AppText>
      <AppText style={styles.metricValue}>{value}</AppText>
      {unit ? <AppText style={styles.metricUnit}>{unit}</AppText> : null}
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
    gap: 6,
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
  },
  heroBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  badgeDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
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
  metricCard: {
    width: '47%',
    flexGrow: 1,
    backgroundColor: colors.panel,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    gap: 4,
  },
  metricLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    color: colors.muted,
    textTransform: 'uppercase',
  },
  metricValue: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.5,
  },
  metricUnit: {
    fontSize: 12,
    color: colors.muted,
  },
  // Generic card
  card: {
    backgroundColor: colors.panel,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 20,
    gap: 6,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.3,
  },
  cardSubtitle: {
    fontSize: 13,
    color: colors.muted,
    marginBottom: 8,
  },
});
