import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { metricsRequest, updateProfileRequest } from '../../api/endpoints';
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
    const timeline = data?.timeline ?? [];
    return timeline
      .slice(-14)
      .map((entry) => ({
        label: formatDate(entry.date, 'MMM D'),
        value: entry.sleepHours ?? 0,
      }))
      .filter((entry) => Number.isFinite(entry.value));
  }, [data?.timeline]);

  if (isLoading || !data) {
    return <LoadingView />;
  }

  if (isError) {
    return <ErrorView message="Unable to load sleep data" onRetry={refetch} />;
  }

  const nightlyAverage = data.summary?.sleepHours ?? 0;
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

  return (
    <RefreshableScrollView
      contentContainerStyle={styles.container}
      refreshing={isRefetching}
      onRefresh={refetch}
      showsVerticalScrollIndicator={false}
    >
      <Card>
        <SectionHeader title="Sleep focus" subtitle={data.subject?.name || 'Athlete'} />
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
      </Card>

      <Card>
        <SectionHeader title="Sleep trend" subtitle="Last 14 nights" />
        <TrendChart data={sleepTrend} yLabel="hours" />
        <View style={styles.statsRow}>
          <InlineStat label="7-day avg" value={`${recentAvg.toFixed(1)} h`} />
          <InlineStat label="Goal delta" value={`${(nightlyAverage - sleepGoal).toFixed(1)} h`} />
          <InlineStat label="Streak" value={`${currentStreak} nights`} />
        </View>
      </Card>

      <Card>
        <SectionHeader title="Stage breakdown" subtitle="Deep · REM · Light" />
        <SleepStageCard sample={stageSample} />
      </Card>

      <Card>
        <SectionHeader title="Recovery cues" subtitle="Goal readiness" />
        <SleepInsightsCard
          average={nightlyAverage}
          goal={sleepGoal}
          streak={currentStreak}
          nightsMeetingGoal={nightsMeetingGoal}
          totalNights={sleepTrend.length}
        />
      </Card>
    </RefreshableScrollView>
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

const styles = StyleSheet.create({
  container: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
  goalRow: {
    flexDirection: 'row',
    gap: spacing.lg,
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  goalMeta: {
    flex: 1,
    minWidth: 220,
    gap: spacing.sm,
  },
  goalSave: {
    alignSelf: 'flex-start',
  },
  feedback: {
    marginTop: spacing.xs,
  },
  statsRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.md,
    flexWrap: 'wrap',
  },
  inlineStat: {
    flex: 1,
    minWidth: 120,
    gap: spacing.xs / 2,
  },
  stageList: {
    gap: spacing.md,
  },
  stageRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'center',
  },
  stageSwatch: {
    width: 16,
    height: 16,
    borderRadius: 4,
  },
  stageMeta: {
    flex: 1,
    gap: spacing.xs / 2,
  },
  stageBar: {
    height: 8,
    borderRadius: 999,
    backgroundColor: colors.border,
    overflow: 'hidden',
  },
  stageBarFill: {
    height: '100%',
    borderRadius: 999,
  },
  insights: {
    gap: spacing.xs,
  },
});
