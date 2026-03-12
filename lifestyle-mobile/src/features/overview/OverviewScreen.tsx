import { ComponentProps, ReactNode } from 'react';
import dayjs from 'dayjs';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';
import { useQueries } from '@tanstack/react-query';
import {
  AppButton,
  AppText,
  Card,
  ErrorView,
  LoadingView,
  RefreshableScrollView,
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
import { useAuth } from '../../providers/AuthProvider';
import { useSubject } from '../../providers/SubjectProvider';
import { colors, fonts, spacing } from '../../theme';
import { formatDate, formatDecimal, formatNumber, formatPace } from '../../utils/format';

type IconName = ComponentProps<typeof Ionicons>['name'];

type SectionTone = {
  color: string;
  soft: string;
  border: string;
  icon: IconName;
};

type InsightTone = 'positive' | 'neutral' | 'negative';

type InsightChip = {
  label: string;
  value: string;
  tone: InsightTone;
};

const HERO_GRADIENT = ['#071019', '#0b1c29', '#123344'] as const;

const SECTION_TONES: Record<'recovery' | 'training' | 'nutrition' | 'trends', SectionTone> = {
  recovery: {
    color: '#43d9c9',
    soft: 'rgba(67, 217, 201, 0.10)',
    border: 'rgba(67, 217, 201, 0.30)',
    icon: 'moon-outline',
  },
  training: {
    color: '#ff9a52',
    soft: 'rgba(255, 154, 82, 0.10)',
    border: 'rgba(255, 154, 82, 0.28)',
    icon: 'barbell-outline',
  },
  nutrition: {
    color: '#78d87a',
    soft: 'rgba(120, 216, 122, 0.10)',
    border: 'rgba(120, 216, 122, 0.28)',
    icon: 'leaf-outline',
  },
  trends: {
    color: '#7eaefc',
    soft: 'rgba(126, 174, 252, 0.10)',
    border: 'rgba(126, 174, 252, 0.24)',
    icon: 'analytics-outline',
  },
};

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

  const readinessTrend = (sleepData?.readiness || [])
    .slice(-10)
    .map((entry) => ({
      label: formatDate(entry.date, 'MMM D'),
      value: entry.readiness ?? 0,
    }))
    .filter((entry) => Number.isFinite(entry.value));

  const sleepTrend = (sleepData?.timeline || [])
    .slice(-14)
    .map((entry) => ({
      label: formatDate(entry.date, 'MMM D'),
      value: entry.sleepHours ?? 0,
    }))
    .filter((entry) => Number.isFinite(entry.value));

  const trainingLoadTrend = (activityData?.charts?.trainingLoad || [])
    .slice(-10)
    .map((entry) => ({
      label: formatDate(entry.startTime, 'MMM D'),
      value: entry.trainingLoad ?? 0,
    }))
    .filter((entry) => Number.isFinite(entry.value));

  const activitySummary = activityData?.summary;
  const latestVitals = vitalsData?.latest;
  const latestWeightEntry = weightData?.latest || weightData?.recent?.[0] || weightData?.timeline?.[0] || null;
  const latestWeightKg = latestWeightEntry?.weightKg ?? null;
  const weightWeeklyChange = weightData?.stats?.weeklyChangeKg ?? null;
  const calorieGoal = nutritionData?.goals?.targetCalories ?? nutritionData?.goals?.calories ?? null;
  const sleepGoal = sleepData?.subject?.goal_sleep ?? user?.goal_sleep ?? null;
  const readinessGoal = sleepData?.subject?.goal_readiness ?? user?.goal_readiness ?? null;
  const readinessScore = sleepData?.summary?.readiness ?? null;
  const sleepAverage = sleepData?.summary?.sleepHours ?? null;
  const trainingLoad = activitySummary?.trainingLoad ?? null;

  const dailyInsight = buildDailyInsight({
    sleepTrend,
    readinessTrend,
    trainingLoadTrend,
    sleepAverage,
    sleepGoal,
    readinessScore,
    trainingLoad,
  });

  const recoveryBadge = getRecoveryBadge(readinessScore, sleepAverage, sleepGoal);
  const trainingBadge = getTrainingBadge(trainingLoad, computeAverageDelta(trainingLoadTrend, 5));
  const nutritionBadge = getNutritionBadge(
    nutritionData?.dailyTotals?.calories ?? null,
    calorieGoal,
    nutritionData?.dailyTotals?.protein ?? null,
    nutritionData?.goals?.protein ?? null
  );

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

      <Card padded={false} style={styles.heroCard}>
        <LinearGradient colors={HERO_GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.heroGradient}>
          <View style={[styles.heroOrb, styles.heroOrbLeft]} />
          <View style={[styles.heroOrb, styles.heroOrbRight]} />

          <View style={styles.heroHeader}>
            <View style={styles.heroTextWrap}>
              <AppText variant="eyebrow" style={styles.heroEyebrow}>
                Performance overview
              </AppText>
              <AppText style={styles.heroTitle}>{firstName}'s athlete dashboard</AppText>
              <AppText variant="muted" style={styles.heroSubtitle}>
                Readiness, sleep, training strain, and fueling in one clean daily view.
              </AppText>
            </View>
            <View style={styles.datePill}>
              <Ionicons name="time-outline" size={14} color={colors.text} />
              <AppText variant="label" style={styles.datePillText}>
                {formatDate(selectedDate, 'ddd, MMM D')}
              </AppText>
            </View>
          </View>

          <View style={styles.heroMetricsRow}>
            <HeroMetric
              label="Readiness"
              value={formatPercent(readinessScore)}
              helper={readinessGoal ? `Goal ${formatPercent(readinessGoal)}` : 'Recovery score'}
              icon="sparkles-outline"
              tone={SECTION_TONES.recovery}
            />
            <HeroMetric
              label="Sleep"
              value={formatShortHours(sleepAverage)}
              helper={sleepGoal ? `Goal ${formatShortHours(sleepGoal)}` : 'Nightly average'}
              icon="moon-outline"
              tone={SECTION_TONES.recovery}
            />
            <HeroMetric
              label="Training Load"
              value={formatNumber(trainingLoad)}
              helper="Weekly strain"
              icon="barbell-outline"
              tone={SECTION_TONES.training}
            />
          </View>
        </LinearGradient>
      </Card>

      <Card style={styles.insightCard}>
        <View style={styles.insightHeader}>
          <View style={styles.insightTitleRow}>
            <View style={styles.insightIconWrap}>
              <Ionicons name="sparkles-outline" size={16} color={colors.accent} />
            </View>
            <View style={styles.insightTextWrap}>
              <AppText variant="label">Daily Insight</AppText>
              <AppText style={styles.insightTitle}>{dailyInsight.headline}</AppText>
            </View>
          </View>
        </View>
        <AppText variant="muted" style={styles.insightSummary}>
          {dailyInsight.summary}
        </AppText>
        <View style={styles.insightChipRow}>
          {dailyInsight.chips.map((chip) => (
            <InsightChipBlock key={chip.label} chip={chip} />
          ))}
        </View>
      </Card>

      <Card style={[styles.sectionCard, { borderColor: SECTION_TONES.recovery.border }]}>
        <SectionLabel
          eyebrow="Recovery"
          title="Sleep, readiness, and vital recovery markers"
          subtitle="Your key overnight signals in one section."
          tone={SECTION_TONES.recovery}
          badge={recoveryBadge}
        />
        {sleepQuery.isError && !sleepData && vitalsQuery.isError && !vitalsData ? (
          <SectionRetryMessage label="Unable to load recovery data." onRetry={handleRefresh} />
        ) : (
          <View style={styles.summaryGrid}>
            <SummaryBlock
              label="Sleep Avg"
              value={formatHours(sleepAverage)}
              helper={describeSleepGoalDelta(sleepAverage, sleepGoal)}
              tone={SECTION_TONES.recovery}
            />
            <SummaryBlock
              label="Readiness"
              value={formatPercent(readinessScore)}
              helper={readinessGoal ? `Goal ${formatPercent(readinessGoal)}` : 'Recovery score'}
              tone={SECTION_TONES.recovery}
            />
            <SummaryBlock
              label="Resting HR"
              value={formatBpm(latestVitals?.restingHr)}
              helper={describeRestingHr(vitalsData?.stats?.restingHrAvg)}
              tone={SECTION_TONES.recovery}
            />
            <SummaryBlock
              label="HRV"
              value={formatMs(latestVitals?.hrvScore)}
              helper={describeHrv(vitalsData?.stats?.hrvAvg)}
              tone={SECTION_TONES.recovery}
            />
          </View>
        )}
      </Card>

      <Card style={[styles.sectionCard, { borderColor: SECTION_TONES.training.border }]}>
        <SectionLabel
          eyebrow="Training"
          title="Weekly load, volume, and pace"
          subtitle="Keep the essentials visible without stacking extra cards."
          tone={SECTION_TONES.training}
          badge={trainingBadge}
        />
        {activityQuery.isError && !activityData ? (
          <SectionRetryMessage label="Unable to load training data." onRetry={activityQuery.refetch} />
        ) : (
          <View style={styles.summaryGrid}>
            <SummaryBlock
              label="Weekly Distance"
              value={formatKilometers(activitySummary?.weeklyDistanceKm)}
              helper={describeLongestRun(activitySummary?.longestRunKm)}
              tone={SECTION_TONES.training}
            />
            <SummaryBlock
              label="Weekly Duration"
              value={formatWeeklyDuration(activitySummary?.weeklyDurationMin)}
              helper={describeTrainingLoad(trainingLoad)}
              tone={SECTION_TONES.training}
            />
            <SummaryBlock
              label="Avg Pace"
              value={formatPace(activitySummary?.avgPaceSeconds)}
              helper={describeElevation(activitySummary?.weeklyElevationGain)}
              tone={SECTION_TONES.training}
            />
            <SummaryBlock
              label="Longest Effort"
              value={formatKilometers(activitySummary?.longestRunKm)}
              helper={activitySummary?.longestRunName || 'Best session this week'}
              tone={SECTION_TONES.training}
            />
          </View>
        )}
      </Card>

      <Card style={[styles.sectionCard, { borderColor: SECTION_TONES.nutrition.border }]}>
        <SectionLabel
          eyebrow="Nutrition"
          title="Fueling and body metrics"
          subtitle="Daily intake and body mass condensed into compact summary blocks."
          tone={SECTION_TONES.nutrition}
          badge={nutritionBadge}
        />
        {nutritionQuery.isError && !nutritionData && weightQuery.isError && !weightData ? (
          <SectionRetryMessage label="Unable to load nutrition data." onRetry={handleRefresh} />
        ) : (
          <View style={styles.summaryGrid}>
            <SummaryBlock
              label="Calories"
              value={formatMacroProgress(nutritionData?.dailyTotals?.calories, calorieGoal)}
              helper={calorieGoal ? 'Tracked against daily target' : 'Calories logged today'}
              tone={SECTION_TONES.nutrition}
            />
            <SummaryBlock
              label="Protein"
              value={formatMacroProgress(
                nutritionData?.dailyTotals?.protein,
                nutritionData?.goals?.protein,
                ' g'
              )}
              helper="Protein intake today"
              tone={SECTION_TONES.nutrition}
            />
            <SummaryBlock
              label="Carbs"
              value={formatNumber(nutritionData?.dailyTotals?.carbs, { suffix: ' g' })}
              helper="Primary training fuel"
              tone={SECTION_TONES.nutrition}
            />
            <SummaryBlock
              label="Body Mass"
              value={latestWeightKg === null ? '--' : `${formatDecimal(latestWeightKg, 1)} kg`}
              helper={describeWeightChange(weightWeeklyChange, latestWeightEntry?.date)}
              tone={SECTION_TONES.nutrition}
            />
          </View>
        )}
      </Card>

      <Card style={[styles.sectionCard, { borderColor: SECTION_TONES.trends.border }]}>
        <SectionLabel
          eyebrow="Trends"
          title="Recent performance curves"
          subtitle="Cleaner charts with clearer titles and stronger contrast."
          tone={SECTION_TONES.trends}
        />
        <View style={styles.chartStack}>
          <ChartPanel
            title="Readiness Trend"
            subtitle="Last 10 days"
            value={formatPercent(getLatestValue(readinessTrend))}
            tone={SECTION_TONES.recovery}
            error={sleepQuery.isError && !sleepData}
            onRetry={sleepQuery.refetch}
            retryLabel="Unable to load readiness trend."
          >
            <TrendChart
              data={readinessTrend}
              yLabel="score"
              color={SECTION_TONES.recovery.color}
              areaOpacity={0.12}
              showPoints={false}
              strokeWidth={3.5}
              gridColor="rgba(255,255,255,0.05)"
              chartPadding={{ top: 16, bottom: 38, left: 50, right: 16 }}
            />
          </ChartPanel>

          <ChartPanel
            title="Sleep Duration"
            subtitle="Last 14 nights"
            value={formatShortHours(getLatestValue(sleepTrend))}
            tone={SECTION_TONES.trends}
            error={sleepQuery.isError && !sleepData}
            onRetry={sleepQuery.refetch}
            retryLabel="Unable to load sleep trend."
          >
            <TrendChart
              data={sleepTrend}
              yLabel="hours"
              color={SECTION_TONES.trends.color}
              areaOpacity={0.10}
              showPoints={false}
              strokeWidth={3.2}
              gridColor="rgba(255,255,255,0.05)"
              chartPadding={{ top: 16, bottom: 38, left: 50, right: 16 }}
            />
          </ChartPanel>

          <ChartPanel
            title="Training Load"
            subtitle="Last 10 sessions"
            value={formatNumber(getLatestValue(trainingLoadTrend))}
            tone={SECTION_TONES.training}
            error={activityQuery.isError && !activityData}
            onRetry={activityQuery.refetch}
            retryLabel="Unable to load training trend."
          >
            <TrendChart
              data={trainingLoadTrend}
              yLabel="load"
              color={SECTION_TONES.training.color}
              areaOpacity={0.10}
              showPoints={false}
              strokeWidth={3.3}
              gridColor="rgba(255,255,255,0.05)"
              chartPadding={{ top: 16, bottom: 38, left: 50, right: 16 }}
            />
          </ChartPanel>
        </View>
      </Card>
    </RefreshableScrollView>
  );
}

function HeroMetric({
  label,
  value,
  helper,
  icon,
  tone,
}: {
  label: string;
  value: string;
  helper: string;
  icon: IconName;
  tone: SectionTone;
}) {
  return (
    <View style={[styles.heroMetric, { backgroundColor: 'rgba(3, 10, 18, 0.34)', borderColor: tone.border }]}>
      <View style={styles.heroMetricHeader}>
        <AppText variant="label" style={styles.heroMetricLabel}>
          {label}
        </AppText>
        <View style={[styles.metricIconBadge, { backgroundColor: tone.soft }]}>
          <Ionicons name={icon} size={14} color={tone.color} />
        </View>
      </View>
      <AppText style={styles.heroMetricValue}>{value}</AppText>
      <AppText variant="muted" style={styles.heroMetricHelper}>
        {helper}
      </AppText>
    </View>
  );
}

function SectionLabel({
  eyebrow,
  title,
  subtitle,
  tone,
  badge,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  tone: SectionTone;
  badge?: string | null;
}) {
  return (
    <View style={styles.sectionHeader}>
      <View style={styles.sectionHeaderMain}>
        <View style={[styles.sectionIconWrap, { backgroundColor: tone.soft }]}>
          <Ionicons name={tone.icon} size={16} color={tone.color} />
        </View>
        <View style={styles.sectionCopy}>
          <AppText variant="eyebrow">{eyebrow}</AppText>
          <AppText style={styles.sectionTitle}>{title}</AppText>
          <AppText variant="muted" style={styles.sectionSubtitle}>
            {subtitle}
          </AppText>
        </View>
      </View>
      {badge ? (
        <View style={[styles.sectionBadge, { backgroundColor: tone.soft, borderColor: tone.border }]}>
          <AppText variant="label" style={[styles.sectionBadgeText, { color: tone.color }]}>
            {badge}
          </AppText>
        </View>
      ) : null}
    </View>
  );
}

function SummaryBlock({
  label,
  value,
  helper,
  tone,
}: {
  label: string;
  value: string;
  helper: string | null;
  tone: SectionTone;
}) {
  return (
    <View style={[styles.summaryBlock, { backgroundColor: tone.soft, borderColor: tone.border }]}>
      <AppText variant="label">{label}</AppText>
      <AppText style={styles.summaryValue}>{value}</AppText>
      <AppText variant="muted" style={styles.summaryHelper}>
        {helper || 'No recent context'}
      </AppText>
    </View>
  );
}

function InsightChipBlock({ chip }: { chip: InsightChip }) {
  const tint = getInsightTone(chip.tone);
  return (
    <View style={[styles.insightChip, { backgroundColor: tint.soft, borderColor: tint.border }]}>
      <AppText variant="label" style={[styles.insightChipLabel, { color: tint.color }]}>
        {chip.label}
      </AppText>
      <AppText style={styles.insightChipValue}>{chip.value}</AppText>
    </View>
  );
}

function ChartPanel({
  title,
  subtitle,
  value,
  tone,
  error,
  retryLabel,
  onRetry,
  children,
}: {
  title: string;
  subtitle: string;
  value: string;
  tone: SectionTone;
  error: boolean;
  retryLabel: string;
  onRetry: () => void;
  children: ReactNode;
}) {
  return (
    <View style={[styles.chartPanel, { backgroundColor: tone.soft, borderColor: tone.border }]}>
      <View style={styles.chartPanelHeader}>
        <View style={styles.chartPanelTitleWrap}>
          <AppText style={styles.chartTitle}>{title}</AppText>
          <AppText variant="muted" style={styles.chartSubtitle}>
            {subtitle}
          </AppText>
        </View>
        <AppText style={styles.chartValue}>{value}</AppText>
      </View>
      {error ? <SectionRetryMessage label={retryLabel} onRetry={onRetry} /> : children}
    </View>
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

function buildDailyInsight({
  sleepTrend,
  readinessTrend,
  trainingLoadTrend,
  sleepAverage,
  sleepGoal,
  readinessScore,
  trainingLoad,
}: {
  sleepTrend: Array<{ label: string; value: number }>;
  readinessTrend: Array<{ label: string; value: number }>;
  trainingLoadTrend: Array<{ label: string; value: number }>;
  sleepAverage: number | null;
  sleepGoal: number | null;
  readinessScore: number | null;
  trainingLoad: number | null;
}) {
  const sleepDelta = computeAverageDelta(sleepTrend, 7);
  const readinessDelta = computeAverageDelta(readinessTrend, 3);
  const loadDelta = computeAverageDelta(trainingLoadTrend, 5);
  const sleepGap = sleepAverage !== null && sleepGoal !== null ? sleepAverage - sleepGoal : null;

  let headline = 'Load and recovery are relatively balanced.';
  if (readinessScore !== null && readinessScore < 70 && loadDelta !== null && loadDelta > 20) {
    headline = 'Training strain is running ahead of recovery.';
  } else if (readinessScore !== null && readinessScore >= 80 && (sleepGap === null || sleepGap >= 0)) {
    headline = 'Recovery markers support another strong session.';
  } else if ((sleepDelta !== null && sleepDelta > 0.2) || (readinessDelta !== null && readinessDelta > 3)) {
    headline = 'Recovery is trending in the right direction.';
  }

  const chips: InsightChip[] = [
    {
      label: 'Sleep',
      value: formatSleepDeltaChip(sleepDelta, sleepAverage),
      tone: getDeltaTone(sleepDelta, 0.1),
    },
    {
      label: 'Recovery',
      value: formatReadinessDeltaChip(readinessDelta, readinessScore),
      tone: getDeltaTone(readinessDelta, 2),
    },
    {
      label: 'Load',
      value: formatLoadDeltaChip(loadDelta, trainingLoad),
      tone: getLoadTone(loadDelta),
    },
  ];

  return {
    headline,
    summary: buildInsightSummary(sleepGap, readinessScore, loadDelta),
    chips,
  };
}

function buildInsightSummary(
  sleepGap: number | null,
  readinessScore: number | null,
  loadDelta: number | null
) {
  const sleepSentence =
    sleepGap === null
      ? 'Sleep trend is available, but no goal is set.'
      : sleepGap >= 0
      ? `Sleep is sitting ${formatSignedHours(sleepGap)} above target.`
      : `Sleep is ${formatSignedHours(Math.abs(sleepGap))} below target.`;
  const readinessSentence =
    readinessScore === null
      ? 'Readiness has not synced yet.'
      : readinessScore >= 80
      ? `Readiness is strong at ${formatPercent(readinessScore)}.`
      : readinessScore >= 70
      ? `Readiness is steady at ${formatPercent(readinessScore)}.`
      : `Readiness is muted at ${formatPercent(readinessScore)}.`;
  const loadSentence =
    loadDelta === null
      ? 'Training load is tracking from recent sessions.'
      : loadDelta > 20
      ? 'Load has climbed against the prior block.'
      : loadDelta < -20
      ? 'Load has eased off over recent sessions.'
      : 'Load is holding a stable range.';

  return `${sleepSentence} ${readinessSentence} ${loadSentence}`;
}

function getInsightTone(tone: InsightTone) {
  if (tone === 'positive') {
    return {
      color: colors.success,
      soft: 'rgba(91, 214, 162, 0.12)',
      border: 'rgba(91, 214, 162, 0.30)',
    };
  }
  if (tone === 'negative') {
    return {
      color: colors.warning,
      soft: 'rgba(244, 199, 111, 0.12)',
      border: 'rgba(244, 199, 111, 0.26)',
    };
  }
  return {
    color: colors.accent,
    soft: 'rgba(77, 245, 255, 0.10)',
    border: 'rgba(77, 245, 255, 0.20)',
  };
}

function getDeltaTone(delta: number | null, threshold: number): InsightTone {
  if (delta === null || Math.abs(delta) < threshold) {
    return 'neutral';
  }
  return delta > 0 ? 'positive' : 'negative';
}

function getLoadTone(delta: number | null): InsightTone {
  if (delta === null || Math.abs(delta) < 20) {
    return 'neutral';
  }
  return delta > 0 ? 'negative' : 'positive';
}

function computeAverageDelta(data: Array<{ value: number }>, window: number) {
  const values = data.map((entry) => entry.value).filter((value) => Number.isFinite(value));
  if (values.length < window * 2) {
    return null;
  }
  const recent = values.slice(-window);
  const previous = values.slice(-window * 2, -window);
  return average(recent) - average(previous);
}

function average(values: number[]) {
  if (!values.length) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function getLatestValue(data: Array<{ value: number }>) {
  for (let index = data.length - 1; index >= 0; index -= 1) {
    if (Number.isFinite(data[index].value)) {
      return data[index].value;
    }
  }
  return null;
}

function getRecoveryBadge(readiness: number | null, sleepHours: number | null, sleepGoal: number | null) {
  if (readiness !== null && readiness >= 80 && (sleepGoal === null || (sleepHours ?? 0) >= sleepGoal)) {
    return 'Recovered';
  }
  if (readiness !== null && readiness < 70) {
    return 'Watch recovery';
  }
  return 'Stable';
}

function getTrainingBadge(trainingLoad: number | null, loadDelta: number | null) {
  if (loadDelta !== null && loadDelta > 20) {
    return 'Load rising';
  }
  if (trainingLoad !== null && trainingLoad > 0) {
    return 'On block';
  }
  return 'Low activity';
}

function getNutritionBadge(
  calories: number | null,
  calorieGoal: number | null,
  protein: number | null,
  proteinGoal: number | null
) {
  const calorieRatio = calories !== null && calorieGoal ? calories / calorieGoal : null;
  const proteinRatio = protein !== null && proteinGoal ? protein / proteinGoal : null;
  const ratios = [calorieRatio, proteinRatio].filter((value): value is number => value !== null);

  if (!ratios.length) {
    return 'Logging';
  }

  const averageRatio = average(ratios);
  if (averageRatio >= 0.9 && averageRatio <= 1.1) {
    return 'On target';
  }
  if (averageRatio < 0.9) {
    return 'Below target';
  }
  return 'Over target';
}

function formatSleepDeltaChip(delta: number | null, current: number | null) {
  if (delta === null) {
    return current === null ? 'No trend yet' : `${formatShortHours(current)} avg`;
  }
  if (Math.abs(delta) < 0.1) {
    return 'Steady vs prior week';
  }
  const minutes = Math.round(Math.abs(delta) * 60);
  return `${delta > 0 ? '+' : '-'}${minutes} min vs prior`;
}

function formatReadinessDeltaChip(delta: number | null, current: number | null) {
  if (current === null && delta === null) {
    return 'No recovery score';
  }
  if (delta === null) {
    return `${formatPercent(current)} current`;
  }
  if (Math.abs(delta) < 2) {
    return 'Readiness steady';
  }
  return `${delta > 0 ? '+' : '-'}${Math.round(Math.abs(delta))} pts`;
}

function formatLoadDeltaChip(delta: number | null, current: number | null) {
  if (current === null && delta === null) {
    return 'No load yet';
  }
  if (delta === null) {
    return `${formatNumber(current)} current`;
  }
  if (Math.abs(delta) < 20) {
    return 'Load stable';
  }
  return `${delta > 0 ? '+' : '-'}${formatNumber(Math.abs(delta))} vs prior`;
}

function describeSleepGoalDelta(hours: number | null, goal: number | null) {
  if (hours === null && goal === null) {
    return 'No sleep goal set';
  }
  if (hours === null) {
    return 'Waiting for sleep data';
  }
  if (goal === null) {
    return 'Nightly average this window';
  }
  const delta = hours - goal;
  if (Math.abs(delta) < 0.1) {
    return 'Right on target';
  }
  return delta > 0 ? `${formatSignedHours(delta)} above goal` : `${formatSignedHours(Math.abs(delta))} below goal`;
}

function describeRestingHr(avg: number | null | undefined) {
  if (avg === null || avg === undefined || Number.isNaN(avg)) {
    return 'Latest resting heart rate';
  }
  return `Window avg ${Math.round(avg)} bpm`;
}

function describeHrv(avg: number | null | undefined) {
  if (avg === null || avg === undefined || Number.isNaN(avg)) {
    return 'Latest HRV reading';
  }
  return `Window avg ${Math.round(avg)} ms`;
}

function describeLongestRun(distanceKm: number | null | undefined) {
  if (distanceKm === null || distanceKm === undefined || Number.isNaN(distanceKm)) {
    return 'Longest effort this week';
  }
  return `Peak session ${formatKilometers(distanceKm)}`;
}

function describeTrainingLoad(trainingLoad: number | null) {
  if (trainingLoad === null) {
    return 'Training load this week';
  }
  return `Load ${formatNumber(trainingLoad)} this week`;
}

function describeElevation(elevationGain: number | null | undefined) {
  if (elevationGain === null || elevationGain === undefined || Number.isNaN(elevationGain)) {
    return 'Weekly pacing trend';
  }
  return `${formatNumber(elevationGain, { suffix: ' m' })} climbed`;
}

function describeWeightChange(changeKg: number | null, updatedAt?: string | null) {
  const updatedLabel = updatedAt ? `Updated ${formatDate(updatedAt, 'MMM D')}` : 'Latest body mass';
  if (changeKg === null || changeKg === undefined || Number.isNaN(changeKg)) {
    return updatedLabel;
  }
  const signedValue = `${changeKg > 0 ? '+' : ''}${changeKg.toFixed(1)} kg this week`;
  return `${signedValue} · ${updatedLabel}`;
}

function formatPercent(value?: number | null) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '--';
  }
  return `${Math.round(value)}%`;
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

function formatShortHours(hours?: number | null) {
  if (hours === null || hours === undefined || Number.isNaN(hours)) {
    return '--';
  }
  return `${hours.toFixed(1)}h`;
}

function formatSignedHours(hours: number) {
  return `${formatDecimal(hours, 1)}h`;
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

function formatMacroProgress(current?: number | null, target?: number | null, suffix?: string) {
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
    paddingBottom: spacing.xxl,
    gap: spacing.lg,
  },
  heroCard: {
    overflow: 'hidden',
    borderColor: 'rgba(255,255,255,0.10)',
    backgroundColor: '#06111d',
    shadowColor: '#000',
    shadowOpacity: 0.28,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 12 },
    elevation: 10,
  },
  heroGradient: {
    padding: spacing.lg,
    gap: spacing.lg,
    position: 'relative',
  },
  heroOrb: {
    position: 'absolute',
    borderRadius: 999,
    opacity: 0.18,
  },
  heroOrbLeft: {
    width: 150,
    height: 150,
    backgroundColor: SECTION_TONES.recovery.color,
    top: -48,
    left: -36,
  },
  heroOrbRight: {
    width: 190,
    height: 190,
    backgroundColor: SECTION_TONES.training.color,
    bottom: -100,
    right: -56,
  },
  heroHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.md,
    alignItems: 'flex-start',
  },
  heroTextWrap: {
    flex: 1,
    gap: spacing.xs,
  },
  heroEyebrow: {
    color: 'rgba(245, 247, 255, 0.72)',
  },
  heroTitle: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: 30,
    lineHeight: 34,
    letterSpacing: -0.8,
  },
  heroSubtitle: {
    maxWidth: 280,
    lineHeight: 22,
  },
  datePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  datePillText: {
    color: colors.text,
  },
  heroMetricsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  heroMetric: {
    flexBasis: '31%',
    flexGrow: 1,
    borderRadius: 18,
    borderWidth: 1,
    padding: spacing.md,
    gap: spacing.xs,
  },
  heroMetricHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  heroMetricLabel: {
    color: 'rgba(245, 247, 255, 0.72)',
  },
  metricIconBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroMetricValue: {
    fontFamily: fonts.display,
    fontSize: 30,
    lineHeight: 32,
    letterSpacing: -0.8,
    color: colors.text,
  },
  heroMetricHelper: {
    fontSize: 13,
  },
  insightCard: {
    backgroundColor: 'rgba(9, 22, 45, 0.92)',
    borderColor: 'rgba(77,245,255,0.18)',
    gap: spacing.sm,
  },
  insightHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  insightTitleRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    flex: 1,
  },
  insightIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(77,245,255,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(77,245,255,0.18)',
  },
  insightTextWrap: {
    flex: 1,
    gap: spacing.xxs,
  },
  insightTitle: {
    fontFamily: fonts.display,
    fontSize: 24,
    lineHeight: 28,
    letterSpacing: -0.6,
  },
  insightSummary: {
    lineHeight: 21,
  },
  insightChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  insightChip: {
    flexBasis: '31%',
    flexGrow: 1,
    padding: spacing.sm,
    borderRadius: 16,
    borderWidth: 1,
    gap: spacing.xxs,
  },
  insightChipLabel: {
    letterSpacing: 0.6,
  },
  insightChipValue: {
    fontFamily: fonts.sansSemi,
    fontSize: 14,
    lineHeight: 18,
  },
  sectionCard: {
    backgroundColor: 'rgba(7, 18, 34, 0.92)',
    gap: spacing.md,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  sectionHeaderMain: {
    flexDirection: 'row',
    gap: spacing.sm,
    flex: 1,
  },
  sectionIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  sectionCopy: {
    flex: 1,
    gap: spacing.xxs,
  },
  sectionTitle: {
    fontFamily: fonts.display,
    fontSize: 22,
    lineHeight: 26,
    letterSpacing: -0.5,
    color: colors.text,
  },
  sectionSubtitle: {
    lineHeight: 20,
  },
  sectionBadge: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  sectionBadgeText: {
    letterSpacing: 0.5,
  },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  summaryBlock: {
    flexBasis: '48%',
    flexGrow: 1,
    borderRadius: 18,
    borderWidth: 1,
    padding: spacing.md,
    gap: spacing.xs,
  },
  summaryValue: {
    fontFamily: fonts.display,
    fontSize: 24,
    lineHeight: 28,
    letterSpacing: -0.6,
    color: colors.text,
  },
  summaryHelper: {
    fontSize: 13,
    lineHeight: 18,
  },
  chartStack: {
    gap: spacing.md,
  },
  chartPanel: {
    borderRadius: 20,
    borderWidth: 1,
    padding: spacing.sm,
    paddingTop: spacing.md,
  },
  chartPanelHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginBottom: spacing.xs,
    paddingHorizontal: spacing.xs,
  },
  chartPanelTitleWrap: {
    flex: 1,
  },
  chartTitle: {
    fontFamily: fonts.sansSemi,
    fontSize: 16,
    color: colors.text,
  },
  chartSubtitle: {
    marginTop: 2,
    fontSize: 13,
  },
  chartValue: {
    fontFamily: fonts.display,
    fontSize: 22,
    letterSpacing: -0.4,
    color: colors.text,
  },
  sectionError: {
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
});
