import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { weightRequest, deleteWeightEntryRequest } from '../../api/endpoints';
import { WeightStats } from '../../api/types';
import { useSubject } from '../../providers/SubjectProvider';
import { useAuth } from '../../providers/AuthProvider';
import {
  AppButton,
  AppInput,
  AppText,
  Card,
  ErrorView,
  LoadingView,
  SectionHeader,
  TrendChart,
  RefreshableScrollView,
} from '../../components';
import { colors, spacing } from '../../theme';
import { formatDate, formatNumber } from '../../utils/format';
import { useSyncQueue } from '../../providers/SyncProvider';
import { useBodyMetrics } from './useBodyMetrics';

export function WeightScreen() {
  const { subjectId } = useSubject();
  const { user } = useAuth();
  const { runOrQueue } = useSyncQueue();
  const [unit, setUnit] = useState<'kg' | 'lb'>('kg');
  const [value, setValue] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const requestSubject = subjectId && subjectId !== user?.id ? subjectId : undefined;
  const viewingOwnData = !requestSubject;

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['weight', requestSubject || user?.id],
    queryFn: () => weightRequest({ athleteId: requestSubject }),
    enabled: Boolean(user?.id),
  });

  const bodyMetrics = useBodyMetrics();
  const timeline = data?.timeline ?? [];
  const trend = useMemo(
    () =>
      timeline.map((entry) => ({
        label: formatDate(entry.date, 'MMM D'),
        value: unit === 'kg' ? entry.weightKg || 0 : entry.weightLbs || 0,
      })),
    [timeline, unit]
  );

  if (isLoading || !data) {
    return <LoadingView />;
  }

  if (isError) {
    return <ErrorView message="Unable to load weight" onRetry={refetch} />;
  }

  const latestEntry = data.latest || data.recent[0] || data.timeline[0] || null;
  const rawWeightKg = latestEntry?.weightKg ?? null;
  const rawWeightLbs = latestEntry?.weightLbs ?? null;
  const latestWeightKg = rawWeightKg ?? (rawWeightLbs ? rawWeightLbs / 2.20462 : null);
  const latestWeightLbs = rawWeightLbs ?? (rawWeightKg ? rawWeightKg * 2.20462 : null);
  const latestWeightDate = latestEntry?.date ?? null;

  const handleAdd = async () => {
    if (!viewingOwnData) {
      setFeedback('Switch back to your dashboard to log weight.');
      return;
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 500) {
      setFeedback('Enter a valid weight between 0 and 500.');
      return;
    }
    setIsSubmitting(true);
    setFeedback(null);
    try {
      const payload = {
        weight: parsed,
        unit,
        date: new Date().toISOString().slice(0, 10),
      };
      const result = await runOrQueue({ endpoint: '/api/weight', payload });
      if (result.status === 'sent') {
        await refetch();
        setFeedback('Weight saved.');
      } else {
        setFeedback('Saved offline. Syncs when you reconnect.');
      }
      setValue('');
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Unable to save weight.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (id: number) => {
    await deleteWeightEntryRequest(id);
    refetch();
  };

  return (
    <RefreshableScrollView
      contentContainerStyle={styles.container}
      refreshing={isRefetching}
      onRefresh={refetch}
      showsVerticalScrollIndicator={false}
    >
      {bodyMetrics.isReady ? (
        <BodyMetricsCard
          latestWeightKg={latestWeightKg}
          latestWeightLbs={latestWeightLbs}
          latestDate={latestWeightDate}
          heightCm={bodyMetrics.heightCm}
          onSaveHeight={bodyMetrics.saveHeight}
        />
      ) : null}
      <Card>
        <SectionHeader title="Log weight" subtitle="Sync with goals" />
        {viewingOwnData ? (
          <>
            <AppInput
              label={`Weight (${unit})`}
              keyboardType="numeric"
              value={value}
              onChangeText={setValue}
            />
            <AppButton title={`Save in ${unit}`} onPress={handleAdd} loading={isSubmitting} />
            <AppButton
              title={`Switch to ${unit === 'kg' ? 'lb' : 'kg'}`}
              variant="ghost"
              onPress={() => setUnit((prev) => (prev === 'kg' ? 'lb' : 'kg'))}
            />
          </>
        ) : (
          <AppText variant="muted">
            Switch to your own dashboard to log weight. Coaches can only view athlete history.
          </AppText>
        )}
        {feedback ? (
          <AppText variant="muted" style={styles.feedback}>
            {feedback}
          </AppText>
        ) : null}
      </Card>
      <Card>
        <SectionHeader title="Recent" subtitle="Last 10 entries" />
        {data.recent.length ? (
          data.recent.map((entry) => (
            <View key={entry.id} style={styles.entryRow}>
              <View>
                <AppText variant="body">{formatDate(entry.date)}</AppText>
                <AppText variant="muted">
                  {entry.weightKg} kg · {entry.weightLbs} lb
                </AppText>
              </View>
              {viewingOwnData ? (
                <AppButton title="Remove" variant="ghost" onPress={() => handleDelete(entry.id)} />
              ) : null}
            </View>
          ))
        ) : (
          <AppText variant="muted">No entries yet.</AppText>
        )}
      </Card>
      <WeightStatsCard stats={data.stats} unit={unit} />
      <Card>
        <SectionHeader title="Timeline" subtitle={`Avg change ${formatNumber(data.stats?.weeklyChangeKg)} kg`} />
        <TrendChart data={trend} yLabel={unit} />
      </Card>
    </RefreshableScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
  entryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.xs,
  },
  feedback: {
    marginTop: spacing.sm,
  },
  bmiRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.lg,
    marginBottom: spacing.md,
    flexWrap: 'wrap',
  },
  bmiValueBlock: {
    flex: 1,
    minWidth: 140,
    gap: spacing.xs,
  },
  bmiValue: {
    fontSize: 48,
  },
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs / 2,
    borderRadius: 999,
  },
  badgeNeutral: {
    backgroundColor: colors.border,
  },
  badgeSuccess: {
    backgroundColor: 'rgba(91,214,162,0.2)',
  },
  badgeWarning: {
    backgroundColor: 'rgba(244,199,111,0.2)',
  },
  badgeDanger: {
    backgroundColor: 'rgba(255,107,129,0.2)',
  },
  bmiDetails: {
    flex: 1,
    minWidth: 160,
    gap: spacing.xs,
  },
  heightBlock: {
    gap: spacing.xs,
  },
  heightEditRow: {
    gap: spacing.sm,
  },
  statsRow: {
    flexDirection: 'row',
    gap: spacing.md,
    flexWrap: 'wrap',
  },
  miniStat: {
    flex: 1,
    minWidth: 120,
    gap: spacing.xs / 2,
  },
  trendUp: {
    color: colors.warning,
  },
  trendDown: {
    color: colors.success,
  },
});

interface BodyMetricsCardProps {
  latestWeightKg: number | null;
  latestWeightLbs: number | null;
  latestDate: string | null;
  heightCm: number;
  onSaveHeight: (value: number) => void;
}

function BodyMetricsCard({ latestWeightKg, latestWeightLbs, latestDate, heightCm, onSaveHeight }: BodyMetricsCardProps) {
  const [editing, setEditing] = useState(false);
  const [heightInput, setHeightInput] = useState(String(heightCm));
  const [message, setMessage] = useState<string | null>(null);

  const bmi = computeBmi(latestWeightKg, heightCm);
  const bmiDescriptor = classifyBmi(bmi);

  const handleSaveHeight = () => {
    const numeric = Number(heightInput);
    if (!Number.isFinite(numeric) || numeric < 120 || numeric > 240) {
      setMessage('Enter height in cm (120-240).');
      return;
    }
    onSaveHeight(Math.round(numeric));
    setEditing(false);
    setMessage('Height updated for BMI calculations.');
  };

  return (
    <Card>
      <SectionHeader
        title="Body metrics"
        subtitle="BMI tracker"
        action={
          <AppButton
            title={editing ? 'Cancel' : 'Adjust height'}
            variant="ghost"
            onPress={() => {
              setEditing((prev) => !prev);
              setMessage(null);
              setHeightInput(String(heightCm));
            }}
          />
        }
      />
      {latestWeightKg ? (
        <View style={styles.bmiRow}>
          <View style={styles.bmiValueBlock}>
            <AppText variant="label">BMI</AppText>
            <AppText variant="heading" style={styles.bmiValue}>
              {bmi ? bmi.toFixed(1) : '--'}
            </AppText>
            <AppText variant="muted" style={[styles.badge, bmiDescriptor.style]}>
              {bmiDescriptor.label}
            </AppText>
          </View>
          <View style={styles.bmiDetails}>
            <AppText variant="label">Latest weight</AppText>
            <AppText variant="body">
              {formatWeightValue(latestWeightKg, 'kg')} · {formatWeightValue(latestWeightLbs, 'lb')}
            </AppText>
            <AppText variant="muted">
              {latestDate ? `Updated ${formatDate(latestDate, 'MMM D')}` : 'Awaiting latest measurement'}
            </AppText>
          </View>
        </View>
      ) : (
        <AppText variant="muted">Log at least one weight entry to unlock BMI insights.</AppText>
      )}
      <View style={styles.heightBlock}>
        <AppText variant="label">Height</AppText>
        {editing ? (
          <View style={styles.heightEditRow}>
            <AppInput
              label="Height (cm)"
              value={heightInput}
              onChangeText={setHeightInput}
              keyboardType="numeric"
            />
            <AppButton title="Save height" onPress={handleSaveHeight} />
          </View>
        ) : (
          <AppText variant="heading">
            {heightCm} cm · {formatFeetInches(heightCm)}
          </AppText>
        )}
        {message ? (
          <AppText variant="muted" style={styles.feedback}>
            {message}
          </AppText>
        ) : null}
      </View>
    </Card>
  );
}

function WeightStatsCard({ stats, unit }: { stats: WeightStats | null; unit: 'kg' | 'lb' }) {
  if (!stats) {
    return null;
  }
  const avgWeight = unit === 'kg' ? stats.avgWeightKg : stats.avgWeightLbs;
  const weeklyChange = unit === 'kg' ? stats.weeklyChangeKg : stats.weeklyChangeLbs;
  return (
    <Card>
      <SectionHeader title="Weekly stats" subtitle={`Based on ${stats.window}-day window`} />
      <View style={styles.statsRow}>
        <MiniStat label="Avg weight" value={formatNumber(avgWeight, { suffix: ` ${unit}` })} />
        <MiniStat
          label="Weekly change"
          value={`${weeklyChange ? weeklyChange.toFixed(1) : '--'} ${unit}`}
          trend={weeklyChange ? (weeklyChange > 0 ? 'up' : 'down') : null}
        />
        <MiniStat label="Calorie avg" value={formatNumber(stats.caloriesAvg, { suffix: ' kcal' })} />
      </View>
    </Card>
  );
}

function MiniStat({ label, value, trend }: { label: string; value: string; trend?: 'up' | 'down' | null }) {
  return (
    <View style={styles.miniStat}>
      <AppText variant="label">{label}</AppText>
      <AppText variant="heading">{value}</AppText>
      {trend ? (
        <AppText variant="muted" style={trend === 'up' ? styles.trendUp : styles.trendDown}>
          {trend === 'up' ? 'Trending up' : 'Trending down'}
        </AppText>
      ) : null}
    </View>
  );
}

function computeBmi(weightKg: number | null, heightCm: number) {
  if (!weightKg || !heightCm) return null;
  const heightMeters = heightCm / 100;
  if (!heightMeters) return null;
  return weightKg / (heightMeters * heightMeters);
}

function classifyBmi(bmi: number | null) {
  if (!bmi) {
    return { label: 'No data', style: styles.badgeNeutral };
  }
  if (bmi < 18.5) {
    return { label: 'Underweight', style: styles.badgeWarning };
  }
  if (bmi < 25) {
    return { label: 'Optimal', style: styles.badgeSuccess };
  }
  if (bmi < 30) {
    return { label: 'Elevated', style: styles.badgeWarning };
  }
  return { label: 'High', style: styles.badgeDanger };
}

function formatFeetInches(heightCm: number) {
  const totalInches = heightCm / 2.54;
  const feet = Math.floor(totalInches / 12);
  const inches = Math.round(totalInches % 12);
  return `${feet}'${inches}"`;
}

function formatWeightValue(value: number | null | undefined, unit: 'kg' | 'lb') {
  if (value === null || value === undefined) {
    return `-- ${unit}`;
  }
  return `${value.toFixed(1)} ${unit}`;
}
