import { useEffect, useMemo, useState } from 'react';
import dayjs from 'dayjs';
import { StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import {
  ppgResultsRequest,
  ppgStatusRequest,
  runPpgInferenceRequest,
  streamHistoryRequest,
  vitalsRequest,
} from '../../api/endpoints';
import { useSubject } from '../../providers/SubjectProvider';
import { useAuth } from '../../providers/AuthProvider';
import { useBluetooth } from '../../providers/BluetoothProvider';
import {
  AppButton,
  LoadingView,
  ErrorView,
  AppText,
  TrendChart,
  RefreshableScrollView,
} from '../../components';
import { colors, spacing } from '../../theme';
import { formatDate, formatNumber } from '../../utils/format';
import {
  buildBluetoothTrendSeries,
  formatBluetoothMetricLabel,
} from '../devices/bluetoothMetricUtils';
import {
  buildPpgProbabilityEntries,
  canRunPpgDemo,
  canRunPpgLive,
  formatPpgPercent,
  formatPpgZoneLabel,
  getPpgBlockingMessage,
  getPpgIdleMessage,
  getPpgRunModeLabel,
  getPpgZoneRangeLabel,
} from './ppgGlucoseUtils';

const VITALS_STREAM_WINDOW_MS = 45 * 24 * 60 * 60 * 1000;
const PPG_STATUS_POLL_INTERVAL_MS = 5_000;

export function VitalsScreen() {
  const { subjectId } = useSubject();
  const { user } = useAuth();
  const { connectedDevice, sampleHistory } = useBluetooth();
  const requestSubject = subjectId && subjectId !== user?.id ? subjectId : undefined;
  const viewingOwnData = !requestSubject;
  const [ppgSubmittingMode, setPpgSubmittingMode] = useState<'demo' | 'latest' | null>(null);
  const [ppgActionError, setPpgActionError] = useState<string | null>(null);

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
  const { data: ppgStatusData, refetch: refetchPpgStatus } = useQuery({
    queryKey: ['ppg-status', requestSubject || user?.id],
    queryFn: () => ppgStatusRequest({ athleteId: requestSubject }),
    enabled: Boolean(user?.id),
  });
  const { data: ppgResultsData, refetch: refetchPpgResults } = useQuery({
    queryKey: ['ppg-results', requestSubject || user?.id],
    queryFn: () => ppgResultsRequest({ athleteId: requestSubject }),
    enabled: Boolean(user?.id),
  });
  const liveVitalsSeries = useMemo(
    () =>
      buildBluetoothTrendSeries(
        sampleHistory,
        [
          {
            key: 'vitals.heart_rate',
            label: 'Heart rate',
            yLabel: 'bpm',
            matches: isLiveHeartRateMetric,
            normalize: (value) => (value > 0 ? Math.round(value) : null),
            formatValue: (value) => (value != null ? `${Math.round(value)} bpm` : '--'),
          },
          { key: 'vitals.resting_hr', label: 'Resting HR', yLabel: 'bpm' },
          { key: 'vitals.glucose', label: 'Glucose', yLabel: 'mg/dL', matches: isLiveGlucoseMetric },
          { key: 'vitals.spo2', label: 'SpO2', yLabel: '%' },
          { key: 'vitals.hrv', label: 'HRV', yLabel: 'ms' },
          { key: 'vitals.respiratory_rate', label: 'Respiratory rate', yLabel: 'br/min' },
          { key: 'vitals.systolic_bp', label: 'Systolic BP', yLabel: 'mmHg' },
          { key: 'vitals.diastolic_bp', label: 'Diastolic BP', yLabel: 'mmHg' },
        ],
        { limit: 24, labelFormat: 'HH:mm:ss' }
      ),
    [sampleHistory]
  );
  const ppgRun = ppgResultsData?.run || ppgStatusData?.inMemory || ppgStatusData?.latestRun || null;
  const ppgPrediction = ppgResultsData?.prediction || ppgStatusData?.latestPrediction || null;
  const ppgProbabilityEntries = useMemo(
    () => buildPpgProbabilityEntries(ppgPrediction),
    [ppgPrediction]
  );
  const ppgIsRunning = Boolean(ppgStatusData?.running || ppgStatusData?.inMemory?.status === 'running');
  const ppgBlockingMessage = getPpgBlockingMessage(ppgStatusData);
  const ppgDemoReady = canRunPpgDemo(ppgStatusData);
  const ppgLiveReady = canRunPpgLive(ppgStatusData);
  const ppgTopProbability = ppgRun?.resultSummary?.confidence ?? (
    ppgProbabilityEntries.length
      ? Math.max(...ppgProbabilityEntries.map((entry) => entry.value))
      : null
  );
  const ppgPredictedLabel = ppgPrediction?.prediction?.label || ppgRun?.resultSummary?.label || null;
  const ppgQualityUsed = ppgPrediction?.quality?.n_subwindows_used ?? ppgRun?.resultSummary?.usedSubwindows ?? null;
  const ppgQualityAttempted =
    ppgPrediction?.quality?.n_subwindows_attempted ?? ppgRun?.resultSummary?.attemptedSubwindows ?? null;
  const ppgQualityMean = ppgPrediction?.quality?.mean_sqi ?? ppgRun?.resultSummary?.meanSqi ?? null;
  const ppgElapsedSeconds =
    ppgRun?.elapsedSeconds !== null && ppgRun?.elapsedSeconds !== undefined
      ? Number(ppgRun.elapsedSeconds)
      : null;
  const ppgStatusMessage = (() => {
    if (ppgSubmittingMode) {
      return `Starting ${ppgSubmittingMode === 'demo' ? 'demo' : 'live'} BGL inference…`;
    }
    if (ppgIsRunning) {
      const mode = getPpgRunModeLabel(ppgStatusData?.inMemory?.mode, ppgStatusData?.inMemory?.isDemo);
      return `BGL inference running (${mode} mode). This can take 1-3 minutes.`;
    }
    if (ppgActionError) {
      return `Unable to start inference: ${ppgActionError}`;
    }
    if (ppgRun?.status === 'failed') {
      return `Inference failed: ${ppgRun.error || 'unknown error'}`;
    }
    if (ppgRun?.status === 'completed') {
      const mode = getPpgRunModeLabel(ppgRun.mode, ppgRun.isDemo);
      const elapsedSecondsLabel =
        typeof ppgElapsedSeconds === 'number' ? ppgElapsedSeconds.toFixed(1) : null;
      const secs = elapsedSecondsLabel ? ` in ${elapsedSecondsLabel} s` : '';
      const label = ppgPredictedLabel ? ` Predicted ${formatPpgZoneLabel(ppgPredictedLabel)}.` : '';
      return `Last ${mode} inference completed${secs}.${label}`;
    }
    return getPpgIdleMessage(ppgStatusData);
  })();
  const ppgStatusTone =
    ppgSubmittingMode || ppgIsRunning
      ? colors.warning
      : ppgActionError || ppgRun?.status === 'failed' || ppgBlockingMessage
      ? colors.danger
      : ppgRun?.status === 'completed'
      ? colors.success
      : colors.muted;
  const ppgLiveHint =
    ppgBlockingMessage ||
    (ppgStatusData?.profile?.ready === false
      ? ppgStatusData.profile.message
      : ppgStatusData?.liveInput?.message ||
        'Live mode needs a 15-minute ppg.raw window stored on the server.');

  useEffect(() => {
    if (!ppgIsRunning && !ppgSubmittingMode) {
      return undefined;
    }
    const timer = setInterval(() => {
      void refetchPpgStatus();
      void refetchPpgResults();
    }, PPG_STATUS_POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [ppgIsRunning, ppgSubmittingMode, refetchPpgResults, refetchPpgStatus]);

  useEffect(() => {
    if (ppgActionError && (ppgIsRunning || ppgRun?.status === 'completed')) {
      setPpgActionError(null);
    }
  }, [ppgActionError, ppgIsRunning, ppgRun?.status]);

  const handleRefresh = () => {
    void refetch();
    void refetchPpgStatus();
    void refetchPpgResults();
  };

  const handleRunPpg = async (demo: boolean) => {
    setPpgSubmittingMode(demo ? 'demo' : 'latest');
    setPpgActionError(null);
    try {
      await runPpgInferenceRequest({
        demo,
        athleteId: requestSubject,
      });
      await Promise.all([refetchPpgStatus(), refetchPpgResults()]);
    } catch (error) {
      setPpgActionError(error instanceof Error ? error.message : 'Unable to start inference.');
    } finally {
      setPpgSubmittingMode(null);
    }
  };

  if (isError) {
    return <ErrorView message="Unable to load vitals" onRetry={refetch} />;
  }

  if (isLoading || !data) {
    return <LoadingView />;
  }

  const timeline = data.timeline || [];
  const fourteenDayStart = dayjs().startOf('day').subtract(13, 'day');
  const recentTimeline = timeline.filter((entry) => !dayjs(entry.date).isBefore(fourteenDayStart));
  const restingTrendFromStreams = buildDailyTrendFromStream(
    (restingHrStreamData?.points || []).filter(
      (point) => Number.isFinite(point.ts) && point.ts >= fourteenDayStart.valueOf()
    ),
    (values) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length)
  ).slice(-14);
  const glucoseTrendFromStreams = buildDailyTrendFromStream(
    (glucoseStreamData?.points || []).filter(
      (point) => Number.isFinite(point.ts) && point.ts >= fourteenDayStart.valueOf()
    ),
    (values) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length)
  ).slice(-14);
  const restingTrend = restingTrendFromStreams.length
    ? restingTrendFromStreams
    : recentTimeline
        .map((entry) => ({
          label: formatDate(entry.date, 'MMM D'),
          value: entry.restingHr,
        }))
        .filter(hasFiniteTrendValue);
  const glucoseTrend = glucoseTrendFromStreams.length
    ? glucoseTrendFromStreams
    : recentTimeline
        .map((entry) => ({
          label: formatDate(entry.date, 'MMM D'),
          value: entry.glucose,
        }))
        .filter(hasFiniteTrendValue);
  const latestRestingHrValue =
    restingTrend.length > 0 ? restingTrend[restingTrend.length - 1].value : data.latest?.restingHr;
  const latestGlucoseValue =
    glucoseTrend.length > 0 ? glucoseTrend[glucoseTrend.length - 1].value : data.latest?.glucose;
  const latestStreamTs = Math.max(
    latestPointTimestamp(restingHrStreamData?.points || []),
    latestPointTimestamp(glucoseStreamData?.points || [])
  );
  const latestFallbackDate =
    recentTimeline.length > 0 ? recentTimeline[recentTimeline.length - 1]?.date : data.latest?.date;
  const latestVitalsDate = latestStreamTs > 0 ? new Date(latestStreamTs).toISOString() : latestFallbackDate;

  const hrvValue = data.latest?.hrvScore ?? null;
  const hrv = hrvValue !== null ? `${hrvValue} ms` : '--';

  return (
    <RefreshableScrollView
      contentContainerStyle={styles.container}
      refreshing={isRefetching}
      onRefresh={handleRefresh}
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

      <View style={styles.card}>
        <AppText style={styles.eyebrow}>PPG GLUCOSE MODEL</AppText>
        <AppText style={styles.cardTitle}>Estimated glucose zone</AppText>
        <AppText style={styles.cardSubtitle}>
          Server-side classifier demo only. Not for diagnosis, treatment, or insulin dosing.
        </AppText>
        <View style={[styles.ppgStatusPill, { borderColor: `${ppgStatusTone}44`, backgroundColor: `${ppgStatusTone}14` }]}>
          <View style={[styles.badgeDot, { backgroundColor: ppgStatusTone }]} />
          <AppText style={[styles.badgeText, { color: ppgStatusTone }]}>{ppgStatusMessage}</AppText>
        </View>
        <View style={styles.ppgButtonRow}>
          <AppButton
            title="Run demo"
            onPress={() => { void handleRunPpg(true); }}
            loading={ppgSubmittingMode === 'demo'}
            disabled={ppgIsRunning || !ppgDemoReady}
            style={styles.ppgButton}
          />
          <AppButton
            title="Run live PPG"
            variant="ghost"
            onPress={() => { void handleRunPpg(false); }}
            loading={ppgSubmittingMode === 'latest'}
            disabled={ppgIsRunning || !ppgLiveReady}
            style={styles.ppgButton}
          />
        </View>
        {!ppgLiveReady && !ppgBlockingMessage ? (
          <AppText style={styles.ppgHintText}>{ppgLiveHint}</AppText>
        ) : null}
        {ppgRun?.status === 'completed' && ppgPrediction ? (
          <>
            <View style={styles.ppgSummaryGrid}>
              <View style={styles.ppgSummaryCard}>
                <AppText style={styles.ppgSummaryLabel}>ESTIMATE</AppText>
                <AppText style={styles.ppgSummaryValue}>{formatPpgZoneLabel(ppgPredictedLabel)}</AppText>
                <AppText style={styles.ppgSummaryMeta}>{getPpgZoneRangeLabel(ppgPredictedLabel)}</AppText>
              </View>
              <View style={styles.ppgSummaryCard}>
                <AppText style={styles.ppgSummaryLabel}>CONFIDENCE</AppText>
                <AppText style={styles.ppgSummaryValue}>{formatPpgPercent(ppgTopProbability)}</AppText>
                <AppText style={styles.ppgSummaryMeta}>Top zone probability</AppText>
              </View>
              <View style={styles.ppgSummaryCard}>
                <AppText style={styles.ppgSummaryLabel}>QUALITY</AppText>
                <AppText style={styles.ppgSummaryValue}>
                  {Number.isFinite(ppgQualityUsed as number) && Number.isFinite(ppgQualityAttempted as number)
                    ? `${ppgQualityUsed}/${ppgQualityAttempted}`
                    : '--'}
                </AppText>
                <AppText style={styles.ppgSummaryMeta}>
                  {Number.isFinite(ppgQualityMean as number)
                    ? `Mean SQI ${(ppgQualityMean as number).toFixed(2)}`
                    : 'SQI unavailable'}
                </AppText>
              </View>
              <View style={styles.ppgSummaryCard}>
                <AppText style={styles.ppgSummaryLabel}>SOURCE</AppText>
                <AppText style={styles.ppgSummaryValue}>
                  {getPpgRunModeLabel(ppgRun.mode, ppgRun.isDemo) === 'demo' ? 'Demo' : 'Live'}
                </AppText>
                <AppText style={styles.ppgSummaryMeta}>
                  {Number.isFinite(ppgElapsedSeconds)
                    ? `${ppgElapsedSeconds!.toFixed(1)} s runtime`
                    : 'Latest completed run'}
                </AppText>
              </View>
            </View>
            {ppgProbabilityEntries.length ? (
              <View style={styles.ppgProbabilityPanel}>
                <AppText style={styles.ppgProbabilityTitle}>Zone probability graph</AppText>
                {ppgProbabilityEntries.map((entry) => (
                  <View key={entry.key} style={styles.ppgProbabilityRow}>
                    <View style={styles.ppgProbabilityHeader}>
                      <AppText style={styles.ppgProbabilityLabel}>{entry.label}</AppText>
                      <AppText
                        style={[
                          styles.ppgProbabilityValue,
                          entry.isPredicted ? { color: entry.color } : null,
                        ]}
                      >
                        {formatPpgPercent(entry.value)}
                      </AppText>
                    </View>
                    <View style={styles.ppgProbabilityTrack}>
                      <View
                        style={[
                          styles.ppgProbabilityFill,
                          {
                            width: `${entry.value > 0 ? Math.max(entry.value * 100, 4) : 0}%`,
                            backgroundColor: entry.color,
                            opacity: entry.isPredicted ? 1 : 0.5,
                          },
                        ]}
                      />
                    </View>
                    <AppText style={styles.ppgProbabilityRange}>{entry.rangeLabel}</AppText>
                  </View>
                ))}
              </View>
            ) : null}
            {ppgPrediction.warnings?.length ? (
              <AppText style={styles.ppgHintText}>{ppgPrediction.warnings.join(' ')}</AppText>
            ) : null}
          </>
        ) : null}
      </View>

      {viewingOwnData ? (
        <View style={styles.card}>
          <AppText style={styles.eyebrow}>LIVE DEVICE FEED</AppText>
          <AppText style={styles.cardTitle}>Bluetooth vitals</AppText>
          <AppText style={styles.cardSubtitle}>
            {liveVitalsSeries.length
              ? `${connectedDevice?.name || 'Bluetooth device'} · ${formatDate(
                  new Date(liveVitalsSeries[0].latestTs).toISOString(),
                  'MMM D, HH:mm:ss'
                )}`
              : connectedDevice
              ? 'Connected and waiting for vitals samples.'
              : 'Connect a wearable in Settings to see live vitals charts here.'}
          </AppText>
          {liveVitalsSeries.length ? (
            <>
              <View style={styles.liveMetricGrid}>
                {liveVitalsSeries.map((series) => (
                  <View key={series.key} style={styles.liveMetricCard}>
                    <AppText style={styles.liveMetricLabel}>{formatBluetoothMetricLabel(series.key)}</AppText>
                    <AppText style={styles.liveMetricValue}>{series.latestValueLabel}</AppText>
                  </View>
                ))}
              </View>
              {liveVitalsSeries.map((series) => (
                <View key={`${series.key}-chart`} style={styles.liveChartPanel}>
                  <View style={styles.liveChartHeader}>
                    <AppText style={styles.liveChartTitle}>{series.label}</AppText>
                    <AppText style={styles.liveChartValue}>{series.latestValueLabel}</AppText>
                  </View>
                  {series.points.length > 1 ? (
                    <TrendChart
                      data={series.points}
                      yLabel={series.yLabel}
                      height={150}
                      chartPadding={{ top: 20, bottom: 40, left: 52, right: 16 }}
                    />
                  ) : (
                    <AppText style={styles.cardSubtitle}>Waiting for a few more samples to draw the chart.</AppText>
                  )}
                </View>
              ))}
            </>
          ) : null}
        </View>
      ) : null}

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

function isLiveGlucoseMetric(metric: string) {
  const normalized = String(metric || '').trim().toLowerCase();
  return normalized === 'vitals.glucose' || normalized === 'sensor.glucose';
}

function isLiveHeartRateMetric(metric: string) {
  const normalized = String(metric || '').trim().toLowerCase();
  return (
    normalized === 'vitals.heart_rate' ||
    normalized === 'exercise.hr' ||
    normalized.endsWith('.heart_rate') ||
    normalized.endsWith('.heartrate')
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

function hasFiniteTrendValue<T extends { value: number | null | undefined }>(
  entry: T
): entry is T & { value: number } {
  return Number.isFinite(entry.value);
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
  ppgStatusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  ppgButtonRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 2,
  },
  ppgButton: {
    flex: 1,
  },
  ppgHintText: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.muted,
    marginTop: 2,
  },
  ppgSummaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 6,
  },
  ppgSummaryCard: {
    width: '47%',
    flexGrow: 1,
    backgroundColor: colors.glass,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    gap: 4,
  },
  ppgSummaryLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.1,
    color: colors.muted,
    textTransform: 'uppercase',
  },
  ppgSummaryValue: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text,
  },
  ppgSummaryMeta: {
    fontSize: 12,
    color: colors.muted,
  },
  ppgProbabilityPanel: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: spacing.sm,
  },
  ppgProbabilityTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  ppgProbabilityRow: {
    gap: 6,
  },
  ppgProbabilityHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  ppgProbabilityLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
  },
  ppgProbabilityValue: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.muted,
  },
  ppgProbabilityTrack: {
    height: 10,
    borderRadius: 999,
    backgroundColor: colors.border,
    overflow: 'hidden',
  },
  ppgProbabilityFill: {
    height: '100%',
    borderRadius: 999,
  },
  ppgProbabilityRange: {
    fontSize: 12,
    color: colors.muted,
  },
  liveMetricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 6,
  },
  liveMetricCard: {
    width: '47%',
    flexGrow: 1,
    backgroundColor: colors.glass,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    gap: 4,
  },
  liveMetricLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.1,
    color: colors.muted,
    textTransform: 'uppercase',
  },
  liveMetricValue: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text,
  },
  liveChartPanel: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: spacing.sm,
  },
  liveChartHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
  },
  liveChartTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  liveChartValue: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.accent,
  },
});
