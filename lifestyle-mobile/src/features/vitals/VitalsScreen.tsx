import { useEffect, useMemo, useState } from 'react';
import dayjs from 'dayjs';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import {
  ppgResultsRequest,
  ppgStatusRequest,
  runPpgInferenceRequest,
  streamHistoryRequest,
  streamSummaryRequest,
  vitalsRequest,
} from '../../api/endpoints';
import type {
  PpgDemoDatasetStatus,
  PpgInputPreview,
  StreamHistoryResponse,
  StreamSample,
  StreamSummaryMetric,
  VitalsEntry,
  VitalsStats,
} from '../../api/types';
import { useSubject } from '../../providers/SubjectProvider';
import { useAuth } from '../../providers/AuthProvider';
import {
  AppButton,
  Card,
  ErrorView,
  LoadingView,
  AppText,
  MultiSeriesLineChart,
  RefreshableScrollView,
  SectionHeader,
  TrendChart,
} from '../../components';
import { colors, spacing } from '../../theme';
import { formatDate, formatNumber } from '../../utils/format';
import {
  formatBluetoothMetricLabel,
  formatBluetoothMetricReading,
  resolveDeviceTelemetryMetric,
  sortDeviceTelemetryMetrics,
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
const DEVICE_TELEMETRY_WINDOW_MS = 24 * 60 * 60 * 1000;
const PPG_STATUS_POLL_INTERVAL_MS = 5_000;
const DEVICE_TELEMETRY_SUMMARY_LIMIT = 4;
const DEVICE_TELEMETRY_CHART_LIMIT = 6;
const HEART_RATE_STREAM_POINT_LIMIT = 300;
const PPG_WAVEFORM_POINT_LIMIT = 180;

type PpgSubmittingMode = 'demo' | 'latest' | null;

type DeviceTelemetryEntry = StreamSummaryMetric & {
  def: ReturnType<typeof resolveDeviceTelemetryMetric>;
  lastTs: number | null;
};

type DeviceTelemetrySeriesEntry = DeviceTelemetryEntry & {
  data: StreamHistoryResponse;
};

type HrZone = {
  name: string;
  shortName: string;
  pctMin: number;
  pctMax: number;
  color: string;
  bpmMin: number;
  bpmMax: number;
};

export function VitalsScreen() {
  const { subjectId } = useSubject();
  const { user } = useAuth();
  const requestSubject = subjectId && subjectId !== user?.id ? subjectId : undefined;
  const viewingOwnData = !requestSubject;
  const [ppgSubmittingMode, setPpgSubmittingMode] = useState<PpgSubmittingMode>(null);
  const [ppgActionError, setPpgActionError] = useState<string | null>(null);
  const [selectedPpgDemoDatasetId, setSelectedPpgDemoDatasetId] = useState<string>('');
  const [showPpgDemoChooser, setShowPpgDemoChooser] = useState(false);

  const subjectQueryKey = requestSubject || user?.id || 'self';

  const {
    data,
    isLoading,
    isError,
    refetch,
    isRefetching,
  } = useQuery({
    queryKey: ['vitals', subjectQueryKey],
    queryFn: () => vitalsRequest({ athleteId: requestSubject }),
    enabled: Boolean(user?.id),
  });

  const {
    data: restingHrStreamData,
    refetch: refetchRestingHrStream,
  } = useQuery({
    queryKey: ['stream-history', 'vitals.resting_hr', subjectQueryKey],
    queryFn: () =>
      streamHistoryRequest({
        metric: 'vitals.resting_hr',
        athleteId: requestSubject,
        windowMs: VITALS_STREAM_WINDOW_MS,
        maxPoints: 600,
      }),
    enabled: Boolean(user?.id),
  });

  const {
    data: glucoseStreamData,
    refetch: refetchGlucoseStream,
  } = useQuery({
    queryKey: ['stream-history', 'vitals.glucose', subjectQueryKey],
    queryFn: () =>
      streamHistoryRequest({
        metric: 'vitals.glucose',
        athleteId: requestSubject,
        windowMs: VITALS_STREAM_WINDOW_MS,
        maxPoints: 600,
      }),
    enabled: Boolean(user?.id),
  });

  const {
    data: hrvStreamData,
    refetch: refetchHrvStream,
  } = useQuery({
    queryKey: ['stream-history', 'vitals.hrv', subjectQueryKey],
    queryFn: () =>
      streamHistoryRequest({
        metric: 'vitals.hrv',
        athleteId: requestSubject,
        windowMs: VITALS_STREAM_WINDOW_MS,
        maxPoints: 600,
      }),
    enabled: Boolean(user?.id),
  });

  const {
    data: streamSummaryData,
    refetch: refetchStreamSummary,
  } = useQuery({
    queryKey: ['stream-summary', subjectQueryKey, DEVICE_TELEMETRY_WINDOW_MS],
    queryFn: () =>
      streamSummaryRequest({
        athleteId: requestSubject,
        windowMs: DEVICE_TELEMETRY_WINDOW_MS,
      }),
    enabled: Boolean(user?.id),
  });

  const { data: ppgStatusData, refetch: refetchPpgStatus } = useQuery({
    queryKey: ['ppg-status', subjectQueryKey],
    queryFn: () => ppgStatusRequest({ athleteId: requestSubject }),
    enabled: Boolean(user?.id),
  });

  const { data: ppgResultsData, refetch: refetchPpgResults } = useQuery({
    queryKey: ['ppg-results', subjectQueryKey],
    queryFn: () => ppgResultsRequest({ athleteId: requestSubject }),
    enabled: Boolean(user?.id),
  });

  const discoveredDeviceTelemetry = useMemo(
    () =>
      sortDeviceTelemetryMetrics(
        (streamSummaryData?.metrics || [])
          .map((entry) => ({
            ...entry,
            lastTs: entry.latest?.ts ?? entry.lastTs,
            def: resolveDeviceTelemetryMetric(entry.metric),
          }))
          .filter(
            (
              entry
            ): entry is DeviceTelemetryEntry =>
              Boolean(entry.def) && Number(entry.sampleCount) > 0 && Boolean(entry.latest)
          )
      ),
    [streamSummaryData]
  );

  const deviceTelemetrySummaryEntries = useMemo(
    () => discoveredDeviceTelemetry.slice(0, DEVICE_TELEMETRY_SUMMARY_LIMIT),
    [discoveredDeviceTelemetry]
  );

  const deviceTelemetryChartTargets = useMemo(
    () => discoveredDeviceTelemetry.slice(0, DEVICE_TELEMETRY_CHART_LIMIT),
    [discoveredDeviceTelemetry]
  );

  const {
    data: deviceTelemetrySeriesData,
    refetch: refetchDeviceTelemetrySeries,
  } = useQuery({
    queryKey: [
      'stream-telemetry-series',
      subjectQueryKey,
      deviceTelemetryChartTargets.map((entry) => entry.metric).join('|'),
    ],
    queryFn: async () => {
      const responses = await Promise.allSettled(
        deviceTelemetryChartTargets.map(async (entry) => {
          const data = await streamHistoryRequest({
            metric: entry.metric,
            athleteId: requestSubject,
            windowMs: DEVICE_TELEMETRY_WINDOW_MS,
            maxPoints: 240,
          });
          return {
            ...entry,
            data,
          } satisfies DeviceTelemetrySeriesEntry;
        })
      );

      return responses
        .map((result) => (result.status === 'fulfilled' ? result.value : null))
        .filter(
          (entry): entry is DeviceTelemetrySeriesEntry =>
            entry !== null && Array.isArray(entry.data?.points) && entry.data.points.length > 0
        );
    },
    enabled: Boolean(user?.id) && deviceTelemetryChartTargets.length > 0,
  });

  const {
    data: heartRateStreamPoints,
    refetch: refetchHeartRateStream,
  } = useQuery({
    queryKey: ['vitals-heart-rate-stream', subjectQueryKey],
    queryFn: async () => {
      const metrics = ['exercise.hr', 'vitals.heart_rate', 'vitals.resting_hr'];
      const responses = await Promise.all(
        metrics.map(async (metric) => {
          try {
            return await streamHistoryRequest({
              metric,
              athleteId: requestSubject,
              windowMs: DEVICE_TELEMETRY_WINDOW_MS,
              maxPoints: HEART_RATE_STREAM_POINT_LIMIT,
            });
          } catch {
            return null;
          }
        })
      );

      return responses
        .flatMap((response) => response?.points || [])
        .filter(
          (point): point is StreamSample =>
            Number.isFinite(point?.ts) && Number.isFinite(point?.value as number)
        )
        .sort((a, b) => a.ts - b.ts);
    },
    enabled: Boolean(user?.id),
  });

  const readyPpgDemoDatasets = useMemo(
    () => (ppgStatusData?.demoDatasets || []).filter((dataset) => dataset?.ready !== false),
    [ppgStatusData?.demoDatasets]
  );

  useEffect(() => {
    if (!readyPpgDemoDatasets.length) {
      if (selectedPpgDemoDatasetId) {
        setSelectedPpgDemoDatasetId('');
      }
      return;
    }
    const selectedStillExists = readyPpgDemoDatasets.some(
      (dataset) => dataset.id === selectedPpgDemoDatasetId
    );
    if (!selectedStillExists) {
      setSelectedPpgDemoDatasetId(readyPpgDemoDatasets[0].id);
    }
  }, [readyPpgDemoDatasets, selectedPpgDemoDatasetId]);

  const selectedPpgDemoDataset =
    readyPpgDemoDatasets.find((dataset) => dataset.id === selectedPpgDemoDatasetId) ||
    readyPpgDemoDatasets[0] ||
    null;

  const ppgRun = ppgResultsData?.run || ppgStatusData?.inMemory || ppgStatusData?.latestRun || null;
  const ppgPrediction = ppgResultsData?.prediction || ppgStatusData?.latestPrediction || null;
  const ppgInputPreview =
    ppgPrediction?.inputPreview || ppgPrediction?.input_preview || null;
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
  const ppgQualityUsed =
    ppgPrediction?.quality?.n_subwindows_used ?? ppgRun?.resultSummary?.usedSubwindows ?? null;
  const ppgQualityAttempted =
    ppgPrediction?.quality?.n_subwindows_attempted ?? ppgRun?.resultSummary?.attemptedSubwindows ?? null;
  const ppgQualityMean =
    ppgPrediction?.quality?.mean_sqi ?? ppgRun?.resultSummary?.meanSqi ?? null;
  const ppgElapsedSeconds =
    ppgRun?.elapsedSeconds !== null && ppgRun?.elapsedSeconds !== undefined
      ? Number(ppgRun.elapsedSeconds)
      : null;
  const ppgWaveformTrend = useMemo(
    () => buildPpgWaveformTrend(ppgInputPreview),
    [ppgInputPreview]
  );
  const ppgSourceMeta = useMemo(
    () => formatPpgSourceMeta(ppgInputPreview),
    [ppgInputPreview]
  );
  const ppgStatusMessage = (() => {
    if (ppgSubmittingMode === 'demo') {
      return selectedPpgDemoDataset
        ? `Starting ${selectedPpgDemoDataset.label} inference…`
        : 'Starting demo BGL inference…';
    }
    if (ppgSubmittingMode === 'latest') {
      return 'Starting live watch-stream inference…';
    }
    if (ppgIsRunning) {
      const mode = getPpgRunModeLabel(ppgStatusData?.inMemory?.mode, ppgStatusData?.inMemory?.isDemo);
      return `BGL inference running (${mode}). This can take 1-3 minutes.`;
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

  const handleRefresh = async () => {
    await Promise.allSettled([
      refetch(),
      refetchRestingHrStream(),
      refetchGlucoseStream(),
      refetchHrvStream(),
      refetchStreamSummary(),
      refetchDeviceTelemetrySeries(),
      refetchHeartRateStream(),
      refetchPpgStatus(),
      refetchPpgResults(),
    ]);
  };

  const startPpgRun = async (options: { demoDatasetId?: string } = {}) => {
    const demoDatasetId = options.demoDatasetId;
    const isDemo = Boolean(demoDatasetId);
    setPpgSubmittingMode(isDemo ? 'demo' : 'latest');
    setPpgActionError(null);
    try {
      await runPpgInferenceRequest({
        athleteId: requestSubject,
        ...(isDemo ? { demoDatasetId } : {}),
      });
      await Promise.all([refetchPpgStatus(), refetchPpgResults()]);
    } catch (error) {
      setPpgActionError(error instanceof Error ? error.message : 'Unable to start inference.');
    } finally {
      setPpgSubmittingMode(null);
    }
  };

  const handleRunDemo = () => {
    if (!readyPpgDemoDatasets.length) {
      return;
    }
    if (readyPpgDemoDatasets.length === 1 && readyPpgDemoDatasets[0]) {
      const onlyDataset = readyPpgDemoDatasets[0];
      setSelectedPpgDemoDatasetId(onlyDataset.id);
      setShowPpgDemoChooser(false);
      void startPpgRun({ demoDatasetId: onlyDataset.id });
      return;
    }
    setShowPpgDemoChooser((prev) => !prev);
  };

  const handleSelectDemo = (dataset: PpgDemoDatasetStatus) => {
    setSelectedPpgDemoDatasetId(dataset.id);
    setShowPpgDemoChooser(false);
    void startPpgRun({ demoDatasetId: dataset.id });
  };

  if (isError) {
    return <ErrorView message="Unable to load vitals" onRetry={refetch} />;
  }

  if (isLoading || !data) {
    return <LoadingView />;
  }

  const timeline = Array.isArray(data.timeline) ? data.timeline : [];
  const chronologicalTimeline = sortVitalsTimeline(timeline);
  const fourteenDayStart = dayjs().startOf('day').subtract(13, 'day');
  const recentTimeline = chronologicalTimeline.filter(
    (entry) => !dayjs(entry.date).isBefore(fourteenDayStart)
  );
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
  const hrvTrendFromStreams = buildDailyTrendFromStream(
    (hrvStreamData?.points || []).filter(
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
  const hrvTrend = hrvTrendFromStreams.length
    ? hrvTrendFromStreams
    : recentTimeline
        .map((entry) => ({
          label: formatDate(entry.date, 'MMM D'),
          value: entry.hrvScore,
        }))
        .filter(hasFiniteTrendValue);

  const latestRestingHrValue =
    restingTrend.length > 0 ? restingTrend[restingTrend.length - 1].value : data.latest?.restingHr;
  const latestGlucoseValue =
    glucoseTrend.length > 0 ? glucoseTrend[glucoseTrend.length - 1].value : data.latest?.glucose;
  const latestHrvValue =
    hrvTrend.length > 0 ? hrvTrend[hrvTrend.length - 1].value : data.latest?.hrvScore;
  const latestStreamTs = Math.max(
    latestPointTimestamp(restingHrStreamData?.points || []),
    latestPointTimestamp(glucoseStreamData?.points || []),
    latestPointTimestamp(hrvStreamData?.points || [])
  );
  const latestFallbackDate =
    recentTimeline.length > 0 ? recentTimeline[recentTimeline.length - 1]?.date : data.latest?.date;
  const latestVitalsDate = latestStreamTs > 0 ? new Date(latestStreamTs).toISOString() : latestFallbackDate;
  const signalSummaryRows = buildVitalsSummaryRows(data.latest, data.stats);
  const vitalsHistory = [...chronologicalTimeline].reverse().slice(0, 8);
  const heartRateAnalysis = buildHeartRateAnalysis(heartRateStreamPoints || []);
  const glucoseTargetSeries = buildGlucoseTargetSeries(glucoseTrend);
  const telemetryStatusLabel = deviceTelemetrySeriesData?.length
    ? `${deviceTelemetrySeriesData.length} metric${deviceTelemetrySeriesData.length === 1 ? '' : 's'}`
    : deviceTelemetrySummaryEntries.length
    ? `${deviceTelemetrySummaryEntries.length} detected`
    : streamSummaryData
    ? 'No data'
    : 'Loading…';
  const telemetryHint = deviceTelemetrySummaryEntries.length
    ? 'Live telemetry from connected devices. Body and ambient signals update here automatically as new uploads arrive.'
    : 'No device telemetry found for the last 24 hours. Stream body temperature, outside temperature, humidity, CO2, or similar metrics from the device page to surface them here.';

  return (
    <RefreshableScrollView
      contentContainerStyle={styles.container}
      refreshing={isRefetching}
      onRefresh={() => {
        void handleRefresh();
      }}
      showsVerticalScrollIndicator={false}
    >
      <Card style={styles.heroCard}>
        <SectionHeader
          eyebrow="PPG Sensor · Glucose Inference"
          title="Keep the photoplethysmography stream front and center."
          subtitle="Run a live watch-driven ppg.raw window or choose from the three bundled demo recordings."
        />
        <View style={styles.ppgActionRow}>
          <AppButton
            title="Run Live Watch Stream"
            onPress={() => {
              setShowPpgDemoChooser(false);
              void startPpgRun();
            }}
            loading={ppgSubmittingMode === 'latest'}
            disabled={ppgIsRunning || !ppgLiveReady}
            style={styles.ppgActionButton}
          />
          <AppButton
            title="Run Demo Data"
            variant="ghost"
            onPress={handleRunDemo}
            loading={ppgSubmittingMode === 'demo'}
            disabled={ppgIsRunning || !ppgDemoReady}
            style={styles.ppgActionButton}
          />
        </View>

        <View style={styles.statusMiniGrid}>
          <View style={styles.statusMiniCard}>
            <AppText style={styles.statusMiniLabel}>Model Runtime</AppText>
            <AppText style={styles.statusMiniCopy}>{ppgStatusData?.runtime?.message || 'Checking Python runtime…'}</AppText>
          </View>
          <View style={styles.statusMiniCard}>
            <AppText style={styles.statusMiniLabel}>Demo Library</AppText>
            <AppText style={styles.statusMiniCopy}>
              {formatPpgDemoLibraryCopy(selectedPpgDemoDataset, readyPpgDemoDatasets)}
            </AppText>
          </View>
        </View>

        <View style={styles.quickFactsRow}>
          <QuickFactCard title="Live stream" value="Watch/BLE sensor → ppg.raw" />
          <QuickFactCard title="Demo library" value={`${readyPpgDemoDatasets.length || 0} bundled recordings`} />
          <QuickFactCard title="Output" value="Waveform preview + zone confidence" />
        </View>

        <View
          style={[
            styles.ppgStatusPill,
            {
              borderColor: `${ppgStatusTone}44`,
              backgroundColor: `${ppgStatusTone}14`,
            },
          ]}
        >
          <View style={[styles.badgeDot, { backgroundColor: ppgStatusTone }]} />
          <AppText style={[styles.badgeText, { color: ppgStatusTone }]}>{ppgStatusMessage}</AppText>
        </View>

        {!ppgLiveReady && !ppgBlockingMessage ? (
          <AppText style={styles.cardHint}>{ppgLiveHint}</AppText>
        ) : null}

        {showPpgDemoChooser && readyPpgDemoDatasets.length ? (
          <View style={styles.demoChooser}>
            <AppText variant="label" style={styles.demoChooserLabel}>
              Choose a demo window
            </AppText>
            {readyPpgDemoDatasets.map((dataset) => {
              const isSelected = dataset.id === selectedPpgDemoDataset?.id;
              return (
                <TouchableOpacity
                  key={dataset.id}
                  activeOpacity={0.86}
                  style={[
                    styles.demoChooserOption,
                    isSelected ? styles.demoChooserOptionActive : null,
                  ]}
                  onPress={() => handleSelectDemo(dataset)}
                >
                  <View style={styles.demoChooserHeader}>
                    <AppText weight="semibold">{dataset.label}</AppText>
                    <AppText style={styles.demoChooserDuration}>
                      {formatDurationFromSeconds(dataset.durationSeconds)}
                    </AppText>
                  </View>
                  <AppText variant="muted" style={styles.demoChooserCopy}>
                    {dataset.description}
                  </AppText>
                </TouchableOpacity>
              );
            })}
          </View>
        ) : null}

        {ppgRun?.status === 'completed' && ppgPrediction ? (
          <View style={styles.ppgResultsSection}>
            <View style={styles.ppgSummaryGrid}>
              <PpgSummaryCard
                label="Estimate"
                value={formatPpgZoneLabel(ppgPredictedLabel)}
                meta={getPpgZoneRangeLabel(ppgPredictedLabel)}
              />
              <PpgSummaryCard
                label="Confidence"
                value={formatPpgPercent(ppgTopProbability)}
                meta="Top zone probability"
              />
              <PpgSummaryCard
                label="Quality"
                value={
                  Number.isFinite(ppgQualityUsed as number) &&
                  Number.isFinite(ppgQualityAttempted as number)
                    ? `${ppgQualityUsed}/${ppgQualityAttempted}`
                    : '--'
                }
                meta={
                  Number.isFinite(ppgQualityMean as number)
                    ? `Mean SQI ${(ppgQualityMean as number).toFixed(2)}`
                    : 'SQI unavailable'
                }
              />
              <PpgSummaryCard
                label="Source"
                value={getPpgRunModeLabel(ppgRun.mode, ppgRun.isDemo)}
                meta={
                  Number.isFinite(ppgElapsedSeconds)
                    ? `${ppgElapsedSeconds!.toFixed(1)} s runtime`
                    : 'Latest completed run'
                }
              />
            </View>

            <View style={styles.chartPanel}>
              <AppText style={styles.chartPanelLabel}>Source Waveform</AppText>
              <AppText style={styles.chartPanelMeta}>{ppgSourceMeta}</AppText>
              {ppgWaveformTrend.length ? (
                <TrendChart
                  data={ppgWaveformTrend}
                  yLabel="signal"
                  height={190}
                  showPoints={false}
                  areaOpacity={0.08}
                  strokeWidth={2}
                  pointSize={0}
                />
              ) : (
                <AppText variant="muted">Signal preview will appear after inference.</AppText>
              )}
            </View>

            {ppgProbabilityEntries.length ? (
              <View style={styles.chartPanel}>
                <AppText style={styles.chartPanelLabel}>Model Confidence</AppText>
                <AppText style={styles.chartPanelMeta}>
                  Zone probabilities from the selected PPG run.
                </AppText>
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
                            opacity: entry.isPredicted ? 1 : 0.55,
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
              <AppText style={styles.cardHint}>{ppgPrediction.warnings.join(' ')}</AppText>
            ) : null}
          </View>
        ) : null}
      </Card>

      <View style={styles.metricGrid}>
        <MetricCard
          label="RESTING HR"
          value={toRoundedIntegerLabel(latestRestingHrValue)}
          unit="bpm"
          status={classifyRestingHr(latestRestingHrValue)}
          note={describeVitalsDelta(data.stats?.restingHrDelta, 'bpm') || formatVitalsRecency(latestVitalsDateForField(data.latest, 'restingHr'), 'Awaiting sync.')}
        />
        <MetricCard
          label="SPO₂"
          value={toRoundedIntegerLabel(data.latest?.spo2)}
          unit="%"
          status={classifySpo2(data.latest?.spo2)}
          note={hasVitalsAverage(data.stats?.spo2Count) && Number.isFinite(data.stats?.spo2Avg)
            ? `Avg ${Math.round(data.stats!.spo2Avg!)}% across ${formatNumber(data.stats?.spo2Count)} readings.`
            : formatVitalsRecency(latestVitalsDateForField(data.latest, 'spo2'), 'No oxygen trend yet.')}
        />
        <MetricCard
          label="HRV"
          value={toRoundedIntegerLabel(latestHrvValue)}
          unit="ms"
          status={classifyHrv(latestHrvValue, data.stats?.hrvAvg)}
          note={hasVitalsAverage(data.stats?.hrvCount) && Number.isFinite(data.stats?.hrvAvg)
            ? `Baseline ${Math.round(data.stats!.hrvAvg!)} ms across ${formatNumber(data.stats?.hrvCount)} logged readings.`
            : formatVitalsRecency(latestVitalsDateForField(data.latest, 'hrvScore'), 'No recovery baseline yet.')}
        />
        <MetricCard
          label="STRESS"
          value={toRoundedIntegerLabel(data.latest?.stressScore)}
          unit="score"
          status={classifyStress(data.latest?.stressScore)}
          note={hasVitalsAverage(data.stats?.stressCount) && Number.isFinite(data.stats?.stressAvg)
            ? `Avg ${Math.round(data.stats!.stressAvg!)} across ${formatNumber(data.stats?.stressCount)} logged readings.`
            : formatVitalsRecency(latestVitalsDateForField(data.latest, 'stressScore'), 'No recent stress reading.')}
        />
        <MetricCard
          label="BLOOD PRESSURE"
          value={formatBloodPressureValue(data.latest)}
          unit="mmHg"
          status={classifyBloodPressure(data.latest)}
          note={hasVitalsAverage(data.stats?.bloodPressureCount) && Number.isFinite(data.stats?.systolicAvg) && Number.isFinite(data.stats?.diastolicAvg)
            ? `Avg ${Math.round(data.stats!.systolicAvg!)}/${Math.round(data.stats!.diastolicAvg!)} mmHg across ${formatNumber(data.stats?.bloodPressureCount)} logged readings.`
            : formatVitalsRecency(latestVitalsDateForField(data.latest, 'systolic') || latestVitalsDateForField(data.latest, 'diastolic'), 'Connect a cuff to monitor BP trends.')}
        />
        <MetricCard
          label="GLUCOSE"
          value={toRoundedIntegerLabel(latestGlucoseValue)}
          unit="mg/dL"
          status={classifyGlucose(latestGlucoseValue)}
          note={describeVitalsDelta(data.stats?.glucoseDelta, 'mg/dL') || formatVitalsRecency(latestVitalsDateForField(data.latest, 'glucose'), 'Logs appear once data syncs.')}
        />
      </View>

      <Card>
        <SectionHeader
          eyebrow="Device Telemetry"
          title="Body + ambient sensor streams from your connected device"
          subtitle={telemetryHint}
          action={<StatusChip text={telemetryStatusLabel} tone={deviceTelemetrySeriesData?.length ? 'success' : 'neutral'} />}
        />

        {deviceTelemetrySummaryEntries.length ? (
          <View style={styles.telemetrySummaryGrid}>
            {deviceTelemetrySummaryEntries.map((entry) => (
              <TelemetryTile key={entry.metric} entry={entry} />
            ))}
          </View>
        ) : (
          <AppText variant="muted">{telemetryHint}</AppText>
        )}

        {deviceTelemetrySeriesData?.length ? (
          <View style={styles.telemetryChartList}>
            {deviceTelemetrySeriesData.map((entry) => (
              <View key={entry.metric} style={styles.chartPanel}>
                <View style={styles.chartHeaderRow}>
                  <View style={styles.chartHeaderCopy}>
                    <AppText style={styles.chartPanelLabel}>{entry.def?.label || formatBluetoothMetricLabel(entry.metric)}</AppText>
                    <AppText style={styles.chartPanelMeta}>
                      {formatMetricTimestamp(entry.latest?.ts || entry.lastTs)} · {formatNumber(entry.sampleCount)} sample{entry.sampleCount === 1 ? '' : 's'}
                    </AppText>
                  </View>
                  <AppText style={[styles.chartHeaderValue, { color: entry.def?.color || colors.accent }]}>
                    {formatBluetoothMetricReading(entry.metric, entry.latest?.value)}
                  </AppText>
                </View>
                <TrendChart
                  data={buildIntradayTrend(entry.data?.points || [])}
                  yLabel={entry.def?.unit || undefined}
                  color={entry.def?.color || colors.accent}
                  height={170}
                  showPoints={false}
                  areaOpacity={0.08}
                />
              </View>
            ))}
          </View>
        ) : null}
      </Card>

      <Card>
        <SectionHeader
          eyebrow={`Vitals · ${latestVitalsDate ? formatDate(latestVitalsDate) : 'No data'}`}
          title="Heart rate variability trend"
          subtitle="14-day recovery signal"
        />
        <TrendChart data={hrvTrend} yLabel="ms" />
      </Card>

      <Card>
        <SectionHeader
          eyebrow="Signal Summary"
          title="Latest vitals interpretation"
          subtitle={viewingOwnData ? 'Same summary layer as the web dashboard.' : 'Viewing the selected athlete’s latest summary.'}
        />
        <View style={styles.summaryTable}>
          {signalSummaryRows.map((row) => (
            <SummaryRow
              key={row.label}
              label={row.label}
              value={row.value}
              unit={row.unit}
              copy={row.copy}
            />
          ))}
        </View>
      </Card>

      <Card>
        <SectionHeader
          eyebrow="Resting HR · 14 Days"
          title="Resting heart rate"
          subtitle="Daily average from synced vitals and recent stream history."
        />
        <TrendChart data={restingTrend} yLabel="bpm" yDomain={[40, 200]} yTickStep={10} color="#f87171" />
      </Card>

      <Card>
        <SectionHeader
          eyebrow="Blood Glucose · 14 Days"
          title="Blood glucose"
          subtitle="Target band markers match the website view."
        />
        <MultiSeriesLineChart
          yLabel="mg/dL"
          series={[
            {
              id: 'glucose',
              label: 'Glucose',
              color: '#a78bfa',
              data: glucoseTrend,
            },
            {
              id: 'target-low',
              label: 'Low target',
              color: 'rgba(245, 158, 11, 0.7)',
              strokeDasharray: '6,6',
              data: glucoseTargetSeries.low,
            },
            {
              id: 'target-high',
              label: 'High target',
              color: 'rgba(255,255,255,0.45)',
              strokeDasharray: '6,6',
              data: glucoseTargetSeries.high,
            },
          ]}
        />
      </Card>

      <Card>
        <SectionHeader
          eyebrow="Heart Rate Stream · Last 24 h"
          title="BPM analysis from device streams"
          subtitle={
            heartRateAnalysis.points.length
              ? 'Combined from exercise HR, live HR, and resting HR streams.'
              : 'Connect a BLE heart rate source from Devices to start streaming.'
          }
          action={
            <StatusChip
              text={
                heartRateAnalysis.points.length
                  ? `${heartRateAnalysis.points.length} sample${heartRateAnalysis.points.length === 1 ? '' : 's'}`
                  : 'No data'
              }
              tone={heartRateAnalysis.points.length ? 'success' : 'neutral'}
            />
          }
        />

        {heartRateAnalysis.points.length ? (
          <>
            <View style={styles.hrStatGrid}>
              <HrStatCard label="Current" value={`${heartRateAnalysis.current} bpm`} copy={classifyHeartRateLevel(heartRateAnalysis.current)} />
              <HrStatCard label="Average" value={`${heartRateAnalysis.average} bpm`} copy={classifyHeartRateLevel(heartRateAnalysis.average)} />
              <HrStatCard label="Min" value={`${heartRateAnalysis.min} bpm`} />
              <HrStatCard label="Max" value={`${heartRateAnalysis.max} bpm`} />
              <HrStatCard
                label="Active Zone"
                value={heartRateAnalysis.currentZone.shortName}
                copy={`Estimated max HR ${heartRateAnalysis.estimatedMaxHr} bpm`}
                accentColor={heartRateAnalysis.currentZone.color}
              />
            </View>

            <View style={styles.zoneList}>
              {heartRateAnalysis.zones.map((zone) => (
                <HrZoneRow
                  key={zone.name}
                  zone={zone}
                  percentage={heartRateAnalysis.zonePercentages[zone.name] || 0}
                />
              ))}
            </View>

            <TrendChart
              data={buildIntradayTrend(heartRateAnalysis.points)}
              yLabel="bpm"
              color="#f87171"
              height={190}
              showPoints={false}
              areaOpacity={0.08}
            />
          </>
        ) : (
          <AppText variant="muted">
            No heart rate stream data for the last 24 hours. Connect a BLE heart rate sensor from the Devices page to start streaming.
          </AppText>
        )}
      </Card>

      <Card>
        <SectionHeader
          eyebrow="Vitals Log"
          title="Recent vitals entries"
          subtitle="Latest recorded snapshots, matching the web dashboard history block."
        />
        <View style={styles.logList}>
          {vitalsHistory.length ? (
            vitalsHistory.map((entry) => (
              <VitalsLogRow key={`${entry.date}-${entry.restingHr}-${entry.glucose}`} entry={entry} />
            ))
          ) : (
            <AppText variant="muted">Vitals sync required to populate history.</AppText>
          )}
        </View>
      </Card>
    </RefreshableScrollView>
  );
}

function MetricCard({
  label,
  value,
  unit,
  status,
  note,
}: {
  label: string;
  value: string;
  unit: string;
  status: string;
  note: string;
}) {
  return (
    <View style={styles.metricCard}>
      <AppText style={styles.metricLabel}>{label}</AppText>
      <View style={styles.metricValueRow}>
        <AppText style={styles.metricValue}>{value}</AppText>
        <AppText style={styles.metricUnit}>{unit}</AppText>
      </View>
      <AppText style={styles.metricStatus}>{status}</AppText>
      <AppText style={styles.metricNote}>{note}</AppText>
    </View>
  );
}

function QuickFactCard({ title, value }: { title: string; value: string }) {
  return (
    <View style={styles.quickFactCard}>
      <AppText style={styles.quickFactTitle}>{title}</AppText>
      <AppText style={styles.quickFactValue}>{value}</AppText>
    </View>
  );
}

function PpgSummaryCard({
  label,
  value,
  meta,
}: {
  label: string;
  value: string;
  meta: string;
}) {
  return (
    <View style={styles.ppgSummaryCard}>
      <AppText style={styles.ppgSummaryLabel}>{label}</AppText>
      <AppText style={styles.ppgSummaryValue}>{value}</AppText>
      <AppText style={styles.ppgSummaryMeta}>{meta}</AppText>
    </View>
  );
}

function StatusChip({
  text,
  tone = 'neutral',
}: {
  text: string;
  tone?: 'neutral' | 'success';
}) {
  const chipColor = tone === 'success' ? colors.success : colors.muted;
  return (
    <View
      style={[
        styles.statusChip,
        {
          borderColor: `${chipColor}44`,
          backgroundColor: `${chipColor}18`,
        },
      ]}
    >
      <AppText style={[styles.statusChipText, { color: chipColor }]}>{text}</AppText>
    </View>
  );
}

function TelemetryTile({ entry }: { entry: DeviceTelemetryEntry }) {
  return (
    <View style={styles.telemetryTile}>
      <AppText style={styles.telemetryTileLabel}>
        {entry.def?.label || formatBluetoothMetricLabel(entry.metric)}
      </AppText>
      <AppText style={styles.telemetryTileValue}>
        {formatBluetoothMetricReading(entry.metric, entry.latest?.value)}
      </AppText>
      <AppText style={styles.telemetryTileCopy}>
        {formatMetricTimestamp(entry.latest?.ts || entry.lastTs)} · {formatNumber(entry.sampleCount)} sample{entry.sampleCount === 1 ? '' : 's'}
      </AppText>
    </View>
  );
}

function SummaryRow({
  label,
  value,
  unit,
  copy,
}: {
  label: string;
  value: string;
  unit: string;
  copy: string;
}) {
  return (
    <View style={styles.summaryRow}>
      <View style={styles.summaryRowCopy}>
        <AppText weight="semibold">{label}</AppText>
        <AppText variant="muted" style={styles.summaryRowMeta}>
          {copy}
        </AppText>
      </View>
      <View style={styles.summaryRowValue}>
        <AppText style={styles.summaryRowMetric}>{value}</AppText>
        <AppText variant="muted">{unit}</AppText>
      </View>
    </View>
  );
}

function HrStatCard({
  label,
  value,
  copy,
  accentColor,
}: {
  label: string;
  value: string;
  copy?: string;
  accentColor?: string;
}) {
  return (
    <View style={styles.hrStatCard}>
      <AppText style={styles.hrStatLabel}>{label}</AppText>
      <AppText style={[styles.hrStatValue, accentColor ? { color: accentColor } : null]}>{value}</AppText>
      {copy ? (
        <AppText variant="muted" style={styles.hrStatCopy}>
          {copy}
        </AppText>
      ) : null}
    </View>
  );
}

function HrZoneRow({ zone, percentage }: { zone: HrZone; percentage: number }) {
  const rangeText = zone.bpmMax < 999 ? `${zone.bpmMin}-${zone.bpmMax} bpm` : `>${zone.bpmMin} bpm`;
  return (
    <View style={styles.zoneRow}>
      <View style={styles.zoneRowHeader}>
        <AppText style={[styles.zoneName, { color: zone.color }]}>{zone.name}</AppText>
        <AppText variant="muted">{rangeText}</AppText>
      </View>
      <View style={styles.zoneBarTrack}>
        <View
          style={[
            styles.zoneBarFill,
            {
              width: `${percentage}%`,
              backgroundColor: `${zone.color}33`,
              borderLeftColor: zone.color,
            },
          ]}
        />
      </View>
      <AppText style={styles.zonePercent}>{percentage}%</AppText>
    </View>
  );
}

function VitalsLogRow({ entry }: { entry: VitalsEntry }) {
  const tag = classifyVitalsLogEntry(entry);
  return (
    <View style={styles.logRow}>
      <View style={styles.logRowMain}>
        <AppText weight="semibold">{formatDate(entry.date, 'MMM D')}</AppText>
        <AppText variant="muted" style={styles.logRowSummary}>
          {`${toRoundedIntegerLabel(entry.restingHr)} bpm · ${formatBloodPressureValue(entry)} · ${toRoundedIntegerLabel(entry.glucose)} mg/dL`}
        </AppText>
        <View style={styles.logRowSecondary}>
          <AppText variant="muted">HRV {toRoundedIntegerLabel(entry.hrvScore)} ms</AppText>
          <AppText variant="muted">SpO₂ {toRoundedIntegerLabel(entry.spo2)}%</AppText>
        </View>
      </View>
      <View
        style={[
          styles.logTag,
          {
            backgroundColor: `${tag.color}18`,
            borderColor: `${tag.color}40`,
          },
        ]}
      >
        <AppText style={[styles.logTagText, { color: tag.color }]}>{tag.label}</AppText>
      </View>
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

function buildIntradayTrend(points: Array<{ ts: number; value: number | null }>) {
  const filtered = points.filter(
    (point): point is { ts: number; value: number } =>
      Number.isFinite(point?.ts) && Number.isFinite(point?.value as number)
  );
  if (!filtered.length) {
    return [];
  }
  const downsampled = downsampleTimeSeries(filtered, 180);
  return downsampled.map((point) => ({
    label: formatDate(new Date(point.ts).toISOString(), 'HH:mm'),
    value: Number(point.value),
  }));
}

function buildGlucoseTargetSeries(trend: Array<{ label: string; value: number }>) {
  return {
    low: trend.map((point) => ({ label: point.label, value: 70 })),
    high: trend.map((point) => ({ label: point.label, value: 140 })),
  };
}

function buildPpgWaveformTrend(preview: PpgInputPreview | null) {
  const signalTimes = Array.isArray(preview?.signal?.timesSec) ? preview!.signal!.timesSec! : [];
  const signalValues = Array.isArray(preview?.signal?.values) ? preview!.signal!.values! : [];
  const points = signalTimes
    .map((time, index) => ({
      ts: Number(time),
      value: Number(signalValues[index]),
    }))
    .filter(
      (point) => Number.isFinite(point.ts) && Number.isFinite(point.value)
    );
  return downsampleTimeSeries(points, PPG_WAVEFORM_POINT_LIMIT).map((point) => ({
    label: formatDurationLabel(point.ts),
    value: point.value,
  }));
}

function formatPpgSourceMeta(preview: PpgInputPreview | null) {
  if (!preview) {
    return 'Signal preview will appear after inference.';
  }
  const parts = [
    preview.demoDatasetLabel || preview.signalFileName || 'Selected signal',
    Number.isFinite(preview.sampleRateHz as number)
      ? `${Math.round(preview.sampleRateHz as number)} Hz`
      : null,
    preview.window?.label || null,
    Number.isFinite(preview.window?.durationSeconds as number)
      ? `${formatDurationFromSeconds(Number(preview.window?.durationSeconds))} analysed`
      : null,
  ].filter(Boolean);
  return parts.join(' · ') || 'Signal preview will appear after inference.';
}

function formatPpgDemoLibraryCopy(
  selectedDataset: PpgDemoDatasetStatus | null,
  readyDatasets: PpgDemoDatasetStatus[]
) {
  if (!readyDatasets.length) {
    return 'No demo datasets are ready right now.';
  }
  const selected = selectedDataset || readyDatasets[0];
  return `Selected demo: ${selected.label} (${formatDurationFromSeconds(selected.durationSeconds)}). Tap "Run Demo Data" to choose another window.`;
}

function buildVitalsSummaryRows(latest: VitalsEntry | null, stats: VitalsStats | null) {
  return [
    {
      label: 'Resting HR',
      value: toRoundedIntegerLabel(latest?.restingHr),
      unit: 'bpm',
      copy: `${classifyRestingHr(latest?.restingHr)}. ${formatVitalsRecency(
        latestVitalsDateForField(latest, 'restingHr'),
        'No recent heart-rate reading.'
      )}`,
    },
    {
      label: 'SpO₂',
      value: toRoundedIntegerLabel(latest?.spo2),
      unit: '%',
      copy: `${classifySpo2(latest?.spo2)}. ${formatVitalsRecency(
        latestVitalsDateForField(latest, 'spo2'),
        'No recent oxygen reading.'
      )}`,
    },
    {
      label: 'HRV',
      value: toRoundedIntegerLabel(latest?.hrvScore),
      unit: 'ms',
      copy: `${classifyHrv(latest?.hrvScore, stats?.hrvAvg)}. ${formatVitalsRecency(
        latestVitalsDateForField(latest, 'hrvScore'),
        'No recent HRV reading.'
      )}`,
    },
    {
      label: 'Stress',
      value: toRoundedIntegerLabel(latest?.stressScore),
      unit: 'score',
      copy: `${classifyStress(latest?.stressScore)}. ${formatVitalsRecency(
        latestVitalsDateForField(latest, 'stressScore'),
        'No recent stress reading.'
      )}`,
    },
    {
      label: 'Blood Pressure',
      value: formatBloodPressureValue(latest),
      unit: 'mmHg',
      copy: `${classifyBloodPressure(latest)}. ${formatVitalsRecency(
        latestVitalsDateForField(latest, 'systolic') || latestVitalsDateForField(latest, 'diastolic'),
        'No recent cuff reading.'
      )}`,
    },
    {
      label: 'Glucose',
      value: toRoundedIntegerLabel(latest?.glucose),
      unit: 'mg/dL',
      copy: `${classifyGlucose(latest?.glucose)}. ${formatVitalsRecency(
        latestVitalsDateForField(latest, 'glucose'),
        'No recent glucose reading.'
      )}`,
    },
  ];
}

function buildHeartRateAnalysis(points: StreamSample[]) {
  const filtered = points.filter(
    (point): point is StreamSample & { value: number } =>
      Number.isFinite(point?.ts) && Number.isFinite(point?.value as number)
  );

  if (!filtered.length) {
    return {
      points: [] as Array<{ ts: number; value: number }>,
      current: 0,
      average: 0,
      min: 0,
      max: 0,
      zones: [] as HrZone[],
      zonePercentages: {} as Record<string, number>,
      currentZone: {
        name: 'Zone 1 · Easy',
        shortName: 'Easy',
        pctMin: 0,
        pctMax: 0.6,
        color: '#34d399',
        bpmMin: 0,
        bpmMax: 999,
      } satisfies HrZone,
      estimatedMaxHr: 190,
    };
  }

  const normalizedPoints = filtered.map((point) => ({
    ts: point.ts,
    value: Number(point.value),
  }));
  const values = normalizedPoints.map((point) => point.value);
  const current = Math.round(values[values.length - 1]);
  const average = Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
  const min = Math.round(Math.min(...values));
  const max = Math.round(Math.max(...values));
  const estimatedMaxHr = 190;
  const zones: HrZone[] = [
    { name: 'Zone 1 · Easy', shortName: 'Easy', pctMin: 0, pctMax: 0.6, color: '#34d399', bpmMin: 0, bpmMax: 0 },
    { name: 'Zone 2 · Fat Burn', shortName: 'Fat Burn', pctMin: 0.6, pctMax: 0.7, color: '#fbbf24', bpmMin: 0, bpmMax: 0 },
    { name: 'Zone 3 · Aerobic', shortName: 'Aerobic', pctMin: 0.7, pctMax: 0.8, color: '#fb923c', bpmMin: 0, bpmMax: 0 },
    { name: 'Zone 4 · Threshold', shortName: 'Threshold', pctMin: 0.8, pctMax: 0.9, color: '#f87171', bpmMin: 0, bpmMax: 0 },
    { name: 'Zone 5 · Peak', shortName: 'Peak', pctMin: 0.9, pctMax: 1.1, color: '#ef4444', bpmMin: 0, bpmMax: 999 },
  ].map((zone) => ({
    ...zone,
    bpmMin: Math.round(estimatedMaxHr * zone.pctMin),
    bpmMax: zone.pctMax >= 1 ? 999 : Math.round(estimatedMaxHr * zone.pctMax),
  }));

  const currentZone = zones.find((zone) => current >= zone.bpmMin && current < zone.bpmMax) || zones[0];
  const zonePercentages = zones.reduce<Record<string, number>>((acc, zone) => {
    const count = values.filter((value) => value >= zone.bpmMin && value < zone.bpmMax).length;
    acc[zone.name] = normalizedPoints.length ? Math.round((count / normalizedPoints.length) * 100) : 0;
    return acc;
  }, {});

  return {
    points: normalizedPoints,
    current,
    average,
    min,
    max,
    zones,
    zonePercentages,
    currentZone,
    estimatedMaxHr,
  };
}

function classifyHeartRateLevel(value: number | null | undefined) {
  const numeric = toFiniteVitalsMetricValue(value);
  if (numeric == null) return 'Awaiting data';
  if (numeric < 60) return 'Below normal (bradycardia)';
  if (numeric <= 100) return 'Normal range';
  if (numeric <= 120) return 'Mildly elevated';
  return 'Elevated (tachycardia)';
}

function classifyVitalsLogEntry(entry: VitalsEntry) {
  const glucoseState = classifyGlucose(entry.glucose);
  const bloodPressureState = classifyBloodPressure(entry);
  const hrvState = classifyHrv(entry.hrvScore, null);

  if (
    glucoseState === 'Above target' ||
    bloodPressureState === 'High reading' ||
    hrvState === 'Suppressed recovery'
  ) {
    return { label: 'Elevated', color: colors.warning };
  }
  if (
    glucoseState === 'Below target' ||
    bloodPressureState === 'Slightly elevated' ||
    hrvState === 'Below baseline'
  ) {
    return { label: 'Monitor', color: '#60a5fa' };
  }
  return { label: 'Good', color: colors.success };
}

function latestVitalsDateForField(
  entry: VitalsEntry | null | undefined,
  field: keyof NonNullable<VitalsEntry['fieldDates']> | 'date'
) {
  if (!entry) {
    return null;
  }
  if (field === 'date') {
    return entry.date || null;
  }
  return entry.fieldDates?.[field] || entry.date || null;
}

function formatVitalsRecency(date: string | null | undefined, fallback: string) {
  if (!date) {
    return fallback;
  }
  return `Last logged ${formatDate(date, 'MMM D')}.`;
}

function formatBloodPressureValue(entry: Pick<VitalsEntry, 'systolic' | 'diastolic'> | null | undefined) {
  const systolic = toFiniteVitalsMetricValue(entry?.systolic);
  const diastolic = toFiniteVitalsMetricValue(entry?.diastolic);
  if (systolic == null || diastolic == null) {
    return '--';
  }
  return `${Math.round(systolic)}/${Math.round(diastolic)}`;
}

function describeVitalsDelta(value: number | null | undefined, unit: string) {
  const numeric = toFiniteVitalsMetricValue(value);
  if (numeric == null || numeric === 0) {
    return '';
  }
  const direction = numeric > 0 ? 'higher' : 'lower';
  return `${Math.abs(Math.round(numeric))} ${unit} ${direction} vs previous reading.`;
}

function hasVitalsAverage(value: number | null | undefined) {
  return Number.isFinite(value) && Number(value) > 0;
}

function toFiniteVitalsMetricValue(value: number | null | undefined) {
  return Number.isFinite(value) ? Number(value) : null;
}

function classifyRestingHr(value: number | null | undefined) {
  const numeric = toFiniteVitalsMetricValue(value);
  if (numeric == null) return 'Awaiting data';
  if (numeric < 50) return 'Low athlete baseline';
  if (numeric <= 60) return 'Within range';
  if (numeric <= 75) return 'Slightly elevated';
  return 'Above baseline';
}

function classifySpo2(value: number | null | undefined) {
  const numeric = toFiniteVitalsMetricValue(value);
  if (numeric == null) return 'Awaiting data';
  if (numeric >= 97) return 'Normal oxygenation';
  if (numeric >= 94) return 'Monitor';
  return 'Low oxygenation';
}

function classifyHrv(value: number | null | undefined, baseline: number | null | undefined) {
  const numeric = toFiniteVitalsMetricValue(value);
  const normalizedBaseline = toFiniteVitalsMetricValue(baseline);
  if (numeric == null) return 'Awaiting data';
  if (normalizedBaseline != null) {
    if (numeric >= normalizedBaseline + 8) return 'Above baseline';
    if (numeric <= normalizedBaseline - 8) return 'Below baseline';
    return 'Near baseline';
  }
  if (numeric >= 100) return 'Strong recovery';
  if (numeric >= 60) return 'Moderate recovery';
  return 'Suppressed recovery';
}

function classifyStress(value: number | null | undefined) {
  const numeric = toFiniteVitalsMetricValue(value);
  if (numeric == null) return 'Awaiting data';
  if (numeric <= 25) return 'Low strain';
  if (numeric <= 50) return 'Moderate strain';
  return 'High strain';
}

function classifyBloodPressure(entry: Pick<VitalsEntry, 'systolic' | 'diastolic'> | null | undefined) {
  const systolic = toFiniteVitalsMetricValue(entry?.systolic);
  const diastolic = toFiniteVitalsMetricValue(entry?.diastolic);
  if (systolic == null || diastolic == null) {
    return 'Awaiting data';
  }
  if (systolic < 120 && diastolic < 80) return 'In range';
  if (systolic < 130 && diastolic < 80) return 'Slightly elevated';
  return 'High reading';
}

function classifyGlucose(value: number | null | undefined) {
  const numeric = toFiniteVitalsMetricValue(value);
  if (numeric == null) return 'Awaiting data';
  if (numeric < 70) return 'Below target';
  if (numeric <= 140) return 'In target band';
  return 'Above target';
}

function sortVitalsTimeline(timeline: VitalsEntry[]) {
  return [...timeline].sort((a, b) => {
    const aTime = Date.parse(a?.date || '') || 0;
    const bTime = Date.parse(b?.date || '') || 0;
    return aTime - bTime;
  });
}

function formatMetricTimestamp(ts: number | null | undefined) {
  if (!Number.isFinite(ts as number)) {
    return 'No recent sample';
  }
  return `Updated ${formatDate(new Date(Number(ts)).toISOString(), 'MMM D, HH:mm')}`;
}

function formatDurationFromSeconds(value: number | null | undefined) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return 'unknown duration';
  }
  if (numeric >= 3600) {
    const hours = Math.floor(numeric / 3600);
    const minutes = Math.round((numeric % 3600) / 60);
    return `${hours}h ${minutes}m`;
  }
  const minutes = Math.floor(numeric / 60);
  const seconds = Math.round(numeric % 60);
  if (minutes <= 0) {
    return `${seconds}s`;
  }
  return `${minutes}m ${seconds.toString().padStart(2, '0')}s`;
}

function formatDurationLabel(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return '';
  }
  const totalSeconds = Math.round(seconds);
  const mins = Math.floor(totalSeconds / 60);
  const secs = String(totalSeconds % 60).padStart(2, '0');
  if (mins >= 60) {
    const hours = Math.floor(mins / 60);
    const remMins = String(mins % 60).padStart(2, '0');
    return `${hours}:${remMins}:${secs}`;
  }
  return `${mins}:${secs}`;
}

function downsampleTimeSeries<T extends { ts: number; value: number }>(points: T[], maxPoints: number) {
  if (points.length <= maxPoints) {
    return points;
  }
  const step = (points.length - 1) / (maxPoints - 1);
  const sampled: T[] = [];
  for (let index = 0; index < maxPoints; index += 1) {
    const sourceIndex = Math.min(points.length - 1, Math.round(index * step));
    sampled.push(points[sourceIndex]);
  }
  return sampled;
}

function hasFiniteTrendValue<T extends { value: number | null | undefined }>(
  entry: T
): entry is T & { value: number } {
  return Number.isFinite(entry.value);
}

const styles = StyleSheet.create({
  container: {
    padding: spacing.lg,
    gap: spacing.sm,
    paddingBottom: spacing.xxl,
  },
  heroCard: {
    backgroundColor: colors.glass,
    gap: spacing.md,
  },
  ppgActionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  ppgActionButton: {
    flexGrow: 1,
    minWidth: 150,
  },
  statusMiniGrid: {
    gap: spacing.sm,
  },
  statusMiniCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: 'rgba(255,255,255,0.03)',
    padding: 14,
    gap: 6,
  },
  statusMiniLabel: {
    fontSize: 11,
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
  },
  statusMiniCopy: {
    color: colors.text,
    lineHeight: 20,
  },
  quickFactsRow: {
    gap: spacing.sm,
  },
  quickFactCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: 'rgba(255,255,255,0.025)',
    padding: 14,
    gap: 6,
  },
  quickFactTitle: {
    fontSize: 12,
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 1.1,
  },
  quickFactValue: {
    fontSize: 14,
    lineHeight: 20,
  },
  ppgStatusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  badgeDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
  },
  badgeText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
  cardHint: {
    color: colors.muted,
    lineHeight: 20,
  },
  demoChooser: {
    gap: spacing.sm,
    paddingTop: spacing.xs,
  },
  demoChooserLabel: {
    color: colors.accent,
  },
  demoChooserOption: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: 'rgba(255,255,255,0.025)',
    padding: 14,
    gap: 6,
  },
  demoChooserOptionActive: {
    borderColor: 'rgba(0,229,204,0.35)',
    backgroundColor: 'rgba(0,229,204,0.08)',
  },
  demoChooserHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  demoChooserDuration: {
    color: colors.accent,
  },
  demoChooserCopy: {
    lineHeight: 19,
  },
  ppgResultsSection: {
    gap: spacing.sm,
  },
  ppgSummaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  ppgSummaryCard: {
    width: '47%',
    flexGrow: 1,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel,
    padding: 14,
    gap: 6,
  },
  ppgSummaryLabel: {
    fontSize: 11,
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 1.1,
  },
  ppgSummaryValue: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text,
  },
  ppgSummaryMeta: {
    color: colors.muted,
    lineHeight: 18,
  },
  chartPanel: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: 'rgba(255,255,255,0.03)',
    padding: 14,
    gap: spacing.xs,
  },
  chartPanelLabel: {
    fontSize: 12,
    color: colors.accent,
    textTransform: 'uppercase',
    letterSpacing: 1.1,
  },
  chartPanelMeta: {
    color: colors.muted,
    lineHeight: 18,
  },
  chartHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  chartHeaderCopy: {
    flex: 1,
    gap: 4,
  },
  chartHeaderValue: {
    fontSize: 16,
    fontWeight: '700',
  },
  ppgProbabilityRow: {
    gap: 6,
    marginTop: 10,
  },
  ppgProbabilityHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  ppgProbabilityLabel: {
    fontSize: 14,
    color: colors.text,
  },
  ppgProbabilityValue: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  ppgProbabilityTrack: {
    height: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
  },
  ppgProbabilityFill: {
    height: '100%',
    borderRadius: 999,
  },
  ppgProbabilityRange: {
    color: colors.muted,
    fontSize: 12,
  },
  metricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  metricCard: {
    width: '47%',
    flexGrow: 1,
    backgroundColor: colors.panel,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    gap: 6,
  },
  metricLabel: {
    fontSize: 11,
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
  },
  metricValueRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 6,
  },
  metricValue: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.text,
  },
  metricUnit: {
    fontSize: 15,
    color: colors.text,
    marginBottom: 4,
  },
  metricStatus: {
    color: colors.accent,
    fontSize: 14,
  },
  metricNote: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
  },
  statusChip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  statusChipText: {
    fontSize: 12,
    fontWeight: '600',
  },
  telemetrySummaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  telemetryTile: {
    width: '47%',
    flexGrow: 1,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: 'rgba(255,255,255,0.025)',
    padding: 14,
    gap: 6,
  },
  telemetryTileLabel: {
    color: colors.muted,
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 1.1,
  },
  telemetryTileValue: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.text,
  },
  telemetryTileCopy: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 17,
  },
  telemetryChartList: {
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  summaryTable: {
    gap: 2,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  summaryRowCopy: {
    flex: 1,
    gap: 4,
  },
  summaryRowMeta: {
    lineHeight: 18,
  },
  summaryRowValue: {
    alignItems: 'flex-end',
    gap: 4,
    minWidth: 84,
  },
  summaryRowMetric: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text,
  },
  hrStatGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  hrStatCard: {
    width: '47%',
    flexGrow: 1,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: 'rgba(255,255,255,0.025)',
    padding: 14,
    gap: 6,
  },
  hrStatLabel: {
    fontSize: 11,
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 1.1,
  },
  hrStatValue: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.text,
  },
  hrStatCopy: {
    lineHeight: 18,
  },
  zoneList: {
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  zoneRow: {
    gap: 6,
  },
  zoneRowHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  zoneName: {
    fontWeight: '700',
  },
  zoneBarTrack: {
    height: 12,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.06)',
    overflow: 'hidden',
  },
  zoneBarFill: {
    height: '100%',
    borderLeftWidth: 3,
    borderRadius: 999,
  },
  zonePercent: {
    color: colors.muted,
    fontSize: 12,
  },
  logList: {
    gap: spacing.sm,
  },
  logRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: 'rgba(255,255,255,0.025)',
    padding: 14,
  },
  logRowMain: {
    flex: 1,
    gap: 6,
  },
  logRowSummary: {
    lineHeight: 18,
  },
  logRowSecondary: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  logTag: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
    alignSelf: 'flex-start',
  },
  logTagText: {
    fontSize: 12,
    fontWeight: '700',
  },
});
