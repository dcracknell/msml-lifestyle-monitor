import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { metricsRequest, streamHistoryRequest, updateProfileRequest } from '../../api/endpoints';
import { useSubject } from '../../providers/SubjectProvider';
import { useAuth } from '../../providers/AuthProvider';
import {
  AppButton,
  AppInput,
  AppText,
  Card,
  ErrorView,
  LoadingView,
  ProgressRing,
  RefreshableScrollView,
  SectionHeader,
  TrendChart,
} from '../../components';
import { colors, spacing } from '../../theme';
import { formatDate } from '../../utils/format';

const SLEEP_STREAM_WINDOW_MS = 45 * 24 * 60 * 60 * 1000;

export function SleepScreen() {
  const { subjectId } = useSubject();
  const { user, setSessionFromPayload } = useAuth();
  const requestSubject = subjectId && subjectId !== user?.id ? subjectId : undefined;
  const viewingOwnData = !requestSubject;

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['sleep', requestSubject || user?.id],
    queryFn: () => metricsRequest({ athleteId: requestSubject }),
    enabled: Boolean(user?.id),
  });
  const { data: sleepStreamData } = useQuery({
    queryKey: ['stream-history', 'sleep.total_hours', requestSubject || user?.id],
    queryFn: () =>
      streamHistoryRequest({
        metric: 'sleep.total_hours',
        athleteId: requestSubject,
        windowMs: SLEEP_STREAM_WINDOW_MS,
        maxPoints: 600,
      }),
    enabled: Boolean(user?.id),
  });

  const [goalInput, setGoalInput] = useState('');
  const [goalFeedback, setGoalFeedback] = useState<string | null>(null);
  const [savingGoal, setSavingGoal] = useState(false);

  useEffect(() => {
    const nextGoal = data?.subject?.goal_sleep;
    if (nextGoal === null || nextGoal === undefined) {
      setGoalInput('');
      return;
    }
    setGoalInput(String(nextGoal));
  }, [data?.subject?.goal_sleep]);

  const sleepTrend = useMemo(() => {
    const streamTrend = buildDailyTrendFromStream(
      sleepStreamData?.points || [],
      (values) => Math.max(...values)
    );
    if (streamTrend.length) {
      return streamTrend.slice(-14);
    }

    const timeline = data?.timeline ?? [];
    return timeline
      .slice(-14)
      .map((entry) => ({
        label: formatDate(entry.date, 'MMM D'),
        value: entry.sleepHours ?? 0,
      }))
      .filter((entry) => Number.isFinite(entry.value));
  }, [data?.timeline, sleepStreamData?.points]);

  if (isLoading || !data) {
    return <LoadingView />;
  }

  if (isError) {
    return <ErrorView message="Unable to load sleep data" onRetry={refetch} />;
  }

  const nightlyAverage = sleepTrend.length
    ? sleepTrend.reduce((sum, entry) => sum + entry.value, 0) / sleepTrend.length
    : data.summary?.sleepHours ?? 0;
  const sleepGoal = data.subject?.goal_sleep ?? 8;

  const recentWindow = sleepTrend.slice(-7);
  const recentAvg =
    recentWindow.reduce((sum, entry) => sum + entry.value, 0) /
    Math.max(1, recentWindow.length);

  const nightsMeetingGoal = sleepTrend.filter((night) => night.value >= sleepGoal).length;
  const currentStreak = computeGoalStreak(sleepTrend, sleepGoal);

  const stageSample = data.sleepStages;

  const canEditGoal = viewingOwnData;

  const handleSaveGoal = async () => {
    if (!canEditGoal) {
      return;
    }
    const numeric = Number(goalInput);
    if (!Number.isFinite(numeric)) {
      setGoalFeedback('Enter a numeric sleep goal.');
      return;
    }
    if (numeric < 3 || numeric > 12) {
      setGoalFeedback('Goal must be between 3 and 12 hours.');
      return;
    }
    setSavingGoal(true);
    setGoalFeedback(null);
    try {
      const payload = await updateProfileRequest({
        goalSleep: Math.round(numeric * 10) / 10,
        currentPassword: '',
      });
      await setSessionFromPayload(payload);
      setGoalFeedback('Sleep goal updated.');
      refetch();
    } catch (error) {
      setGoalFeedback(error instanceof Error ? error.message : 'Unable to update sleep goal.');
    } finally {
      setSavingGoal(false);
    }
  };

  const goalDiff = nightlyAverage - sleepGoal;
  const goalDiffText = goalDiff >= 0 ? `+${goalDiff.toFixed(1)} h above goal` : `${goalDiff.toFixed(1)} h below goal`;
  const goalPillColor = goalDiff >= 0 ? colors.accent : colors.warning;

  return (
    <RefreshableScrollView
      contentContainerStyle={styles.container}
      refreshing={isRefetching}
      onRefresh={refetch}
      showsVerticalScrollIndicator={false}
    >
      {/* Hero */}
      <View style={styles.heroCard}>
        <AppText style={styles.eyebrow}>SLEEP · {data.subject?.name || 'Athlete'}</AppText>
        <AppText style={styles.heroNumber}>{nightlyAverage.toFixed(1)} h</AppText>
        <AppText style={styles.heroLabel}>Nightly average</AppText>
        <View style={styles.heroBadgeRow}>
          <View style={[styles.heroBadge, { backgroundColor: `${goalPillColor}1a`, borderColor: `${goalPillColor}44` }]}>
            <View style={[styles.badgeDot, { backgroundColor: goalPillColor }]} />
            <AppText style={[styles.badgeText, { color: goalPillColor }]}>{goalDiffText}</AppText>
          </View>
          <View style={styles.heroBadge}>
            <View style={[styles.badgeDot, { backgroundColor: colors.muted }]} />
            <AppText style={[styles.badgeText, { color: colors.muted }]}>{currentStreak} night streak</AppText>
          </View>
        </View>
      </View>

      {/* 4-metric grid */}
      <View style={styles.metricGrid}>
        <SleepMetric label="7-DAY AVG" value={`${recentAvg.toFixed(1)} h`} />
        <SleepMetric label="GOAL" value={sleepGoal ? `${sleepGoal.toFixed(1)} h` : '--'} />
        <SleepMetric label="NIGHTS MET" value={`${nightsMeetingGoal}`} />
        <SleepMetric label="STREAK" value={`${currentStreak} nights`} />
      </View>

      {/* Trend chart */}
      <View style={styles.card}>
        <AppText style={styles.eyebrow}>TREND · 14 NIGHTS</AppText>
        <AppText style={styles.cardTitle}>Sleep duration</AppText>
        <TrendChart data={sleepTrend} yLabel="hours" />
      </View>

      {/* Goal editor */}
      <View style={styles.card}>
        <AppText style={styles.eyebrow}>SLEEP GOAL</AppText>
        <AppText style={styles.cardTitle}>{data.subject?.name || 'Athlete'}</AppText>
        <SleepGoalCard
          average={nightlyAverage}
          goal={sleepGoal}
          nightsMeetingGoal={nightsMeetingGoal}
          streak={currentStreak}
          goalInput={goalInput}
          onGoalInputChange={setGoalInput}
          onSaveGoal={handleSaveGoal}
          savingGoal={savingGoal}
          feedback={goalFeedback}
          canEdit={canEditGoal}
        />
      </View>

      {/* Stage breakdown */}
      <View style={styles.card}>
        <AppText style={styles.eyebrow}>STAGES</AppText>
        <AppText style={styles.cardTitle}>Sleep stage breakdown</AppText>
        <AppText style={styles.cardSubtitle}>Deep · REM · Light</AppText>
        <SleepStageCard sample={stageSample} />
      </View>

      {/* Recovery insight */}
      <View style={styles.insightCard}>
        <AppText style={styles.eyebrow}>RECOVERY CUES</AppText>
        <SleepInsightsCard
          average={nightlyAverage}
          goal={sleepGoal}
          streak={currentStreak}
          nightsMeetingGoal={nightsMeetingGoal}
          totalNights={sleepTrend.length}
        />
      </View>
    </RefreshableScrollView>
  );
}

function SleepMetric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metricCard}>
      <AppText style={styles.metricLabel}>{label}</AppText>
      <AppText style={styles.metricValue}>{value}</AppText>
    </View>
  );
}

function SleepGoalCard({
  average,
  goal,
  nightsMeetingGoal,
  streak,
  goalInput,
  onGoalInputChange,
  onSaveGoal,
  savingGoal,
  feedback,
  canEdit,
}: {
  average: number;
  goal: number;
  nightsMeetingGoal: number;
  streak: number;
  goalInput: string;
  onGoalInputChange: (value: string) => void;
  onSaveGoal: () => void;
  savingGoal: boolean;
  feedback: string | null;
  canEdit: boolean;
}) {
  const maxValue = Math.max(goal || 10, 10);
  return (
    <View style={styles.goalRow}>
      <ProgressRing value={average} max={maxValue} label="avg" />
      <View style={styles.goalMeta}>
        <AppText variant="heading">{average.toFixed(1)} h nightly</AppText>
        <AppText variant="muted">
          Goal {goal ? `${goal.toFixed(1)} h` : '--'} · {nightsMeetingGoal} nights met this window
        </AppText>
        <AppText variant="muted">Current streak: {streak} nights</AppText>
        <AppInput
          label="Nightly goal (hours)"
          value={goalInput}
          onChangeText={onGoalInputChange}
          keyboardType="numeric"
          editable={canEdit}
        />
        <AppButton
          title="Save goal"
          onPress={onSaveGoal}
          loading={savingGoal}
          disabled={!canEdit}
          style={styles.goalSave}
        />
        {!canEdit ? (
          <AppText variant="muted">Only the athlete can update their goal.</AppText>
        ) : null}
        {feedback ? (
          <AppText variant="muted" style={styles.feedback}>
            {feedback}
          </AppText>
        ) : null}
      </View>
    </View>
  );
}

function SleepStageCard({
  sample,
}: {
  sample: { deep: number | null; rem: number | null; light: number | null } | null;
}) {
  if (!sample) {
    return <AppText variant="muted">Sleep stage data will appear after your next sync.</AppText>;
  }
  const values = [
    { label: 'Deep', color: colors.accentStrong, minutes: sample.deep ?? 0 },
    { label: 'REM', color: colors.accent, minutes: sample.rem ?? 0 },
    { label: 'Light', color: colors.muted, minutes: sample.light ?? 0 },
  ];
  const total = values.reduce((sum, entry) => sum + (entry.minutes || 0), 0) || 1;
  return (
    <View style={styles.stageList}>
      {values.map((stage) => {
        const percent = Math.round(((stage.minutes || 0) / total) * 100);
        const hours = (stage.minutes || 0) / 60;
        return (
          <View key={stage.label} style={styles.stageRow}>
            <View style={[styles.stageSwatch, { backgroundColor: stage.color }]} />
            <View style={styles.stageMeta}>
              <AppText variant="body">{stage.label}</AppText>
              <AppText variant="muted">
                {hours ? hours.toFixed(1) : '--'} h · {percent}%
              </AppText>
              <View style={styles.stageBar}>
                <View style={[styles.stageBarFill, { width: `${percent}%`, backgroundColor: stage.color }]} />
              </View>
            </View>
          </View>
        );
      })}
    </View>
  );
}

function SleepInsightsCard({
  average,
  goal,
  streak,
  nightsMeetingGoal,
  totalNights,
}: {
  average: number;
  goal: number;
  streak: number;
  nightsMeetingGoal: number;
  totalNights: number;
}) {
  const goalDiff = average - goal;
  const adherencePercent =
    totalNights > 0 ? Math.round((nightsMeetingGoal / totalNights) * 100) : 0;
  return (
    <View style={styles.insights}>
      <AppText variant="body">
        You are averaging <AppText variant="heading">{average.toFixed(1)} h</AppText> per night,{' '}
        {goalDiff >= 0 ? `${goalDiff.toFixed(1)} h above` : `${Math.abs(goalDiff).toFixed(1)} h below`} your goal of{' '}
        {goal.toFixed(1)} h.
      </AppText>
      <AppText variant="body">
        Goal adherence sits at <AppText variant="heading">{adherencePercent}%</AppText> across the last window with a{' '}
        <AppText variant="heading">{streak}-night</AppText> streak.
      </AppText>
      <AppText variant="muted">
        Aim to keep REM above 20% and deep sleep near 1.5 h for optimal recovery.
      </AppText>
    </View>
  );
}

function InlineStat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.inlineStat}>
      <AppText variant="label">{label}</AppText>
      <AppText variant="heading">{value}</AppText>
    </View>
  );
}

function computeGoalStreak(
  nights: { label: string; value: number }[],
  goal: number
): number {
  let streak = 0;
  for (let index = nights.length - 1; index >= 0; index -= 1) {
    if (nights[index].value >= goal) {
      streak += 1;
    } else {
      break;
    }
  }
  return streak;
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
  // Hero
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
  heroBadgeRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
    marginTop: 4,
  },
  heroBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 100,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 10,
    paddingVertical: 3,
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  badgeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '600',
  },
  // 4-metric grid
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
    fontSize: 10,
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
  // Generic card
  card: {
    backgroundColor: colors.panel,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 20,
    gap: 8,
  },
  insightCard: {
    backgroundColor: colors.glass,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: `${colors.accent}22`,
    padding: 20,
    gap: 12,
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
  },
  // Goal form
  goalRow: {
    gap: spacing.sm,
  },
  goalMeta: {
    gap: spacing.sm,
  },
  goalSave: {
    alignSelf: 'flex-start',
  },
  feedback: {
    marginTop: spacing.xs,
    fontSize: 13,
    color: colors.muted,
  },
  // Sleep stages
  stageList: {
    gap: spacing.md,
    marginTop: 4,
  },
  stageRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'center',
  },
  stageSwatch: {
    width: 12,
    height: 12,
    borderRadius: 3,
  },
  stageMeta: {
    flex: 1,
    gap: spacing.xs / 2,
  },
  stageBar: {
    height: 6,
    borderRadius: 999,
    backgroundColor: colors.border,
    overflow: 'hidden',
    marginTop: 2,
  },
  stageBarFill: {
    height: '100%',
    borderRadius: 999,
  },
  // Insight text
  insights: {
    gap: spacing.sm,
  },
  inlineStat: {
    flex: 1,
    gap: 4,
    alignItems: 'center',
  },
});
