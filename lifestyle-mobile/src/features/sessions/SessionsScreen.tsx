import { useState } from 'react';
import { StyleSheet, View, Pressable, ScrollView } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { activityRequest } from '../../api/endpoints';
import { useSubject } from '../../providers/SubjectProvider';
import { useAuth } from '../../providers/AuthProvider';
import {
  LoadingView,
  ErrorView,
  Card,
  AppText,
  SectionHeader,
  RefreshableScrollView,
} from '../../components';
import { colors, spacing } from '../../theme';
import { formatDate, formatDistance, formatMinutes, formatPace } from '../../utils/format';

export function SessionsScreen() {
  const { subjectId } = useSubject();
  const { user } = useAuth();
  const requestSubject = subjectId && subjectId !== user?.id ? subjectId : undefined;

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['activity', requestSubject || user?.id],
    queryFn: () => activityRequest({ athleteId: requestSubject }),
    enabled: Boolean(user?.id),
  });

  const [selectedId, setSelectedId] = useState<number | null>(null);

  if (isLoading || !data) {
    return <LoadingView />;
  }

  if (isError) {
    return <ErrorView message="Unable to load sessions" onRetry={refetch} />;
  }

  const sessions = data.sessions || [];
  const activeSession = sessions.find((session) => session.id === selectedId) || sessions[0];
  const splits = activeSession ? data.splits[activeSession.id] || [] : [];

  return (
    <RefreshableScrollView
      contentContainerStyle={styles.container}
      refreshing={isRefetching}
      onRefresh={refetch}
      showsVerticalScrollIndicator={false}
    >
      <SectionHeader title="Sessions" subtitle={`${sessions.length} imported`} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.sessionChips}>
        {sessions.map((session) => {
          const selected = activeSession?.id === session.id;
          return (
            <Pressable
              key={session.id}
              style={[styles.sessionChip, selected && styles.sessionChipSelected]}
              onPress={() => setSelectedId(session.id)}
            >
              <AppText variant="body" style={selected ? styles.sessionChipTextSelected : undefined}>
                {formatDate(session.startTime, 'MMM D')} · {session.name}
              </AppText>
            </Pressable>
          );
        })}
      </ScrollView>
      {activeSession ? (
        <Card>
          <AppText variant="heading">{activeSession.name}</AppText>
          <AppText variant="muted">{formatDate(activeSession.startTime, 'MMM D, HH:mm')} · {activeSession.sportType}</AppText>
          <View style={styles.metricsRow}>
            <Metric label="Distance" value={formatDistance(activeSession.distance || 0)} />
            <Metric label="Pace" value={formatPace(activeSession.averagePace)} />
          </View>
          <View style={styles.metricsRow}>
            <Metric label="Duration" value={formatMinutes(activeSession.movingTime)} />
            <Metric label="HR" value={activeSession.averageHr ? `${activeSession.averageHr} bpm` : '--'} />
          </View>
          <View style={styles.metricsRow}>
            <Metric label="Cadence" value={activeSession.averageCadence ? `${activeSession.averageCadence} spm` : '--'} />
            <Metric label="Elevation" value={activeSession.elevationGain ? `${Math.round(activeSession.elevationGain)} m` : '--'} />
          </View>
          <SectionHeader title="Splits" subtitle={`${splits.length} km`} />
          {splits.length ? (
            splits.map((split) => (
              <View key={`${split.sessionId}-${split.splitIndex}`} style={styles.splitRow}>
                <AppText variant="body">KM {split.splitIndex}</AppText>
                <AppText variant="muted">{formatPace(split.pace)} · {split.heartRate ? `${split.heartRate} bpm` : '--'}</AppText>
              </View>
            ))
          ) : (
            <AppText variant="muted">No split data available.</AppText>
          )}
        </Card>
      ) : null}
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
  sessionChips: {
    gap: spacing.sm,
  },
  sessionChip: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    backgroundColor: colors.glass,
    marginRight: spacing.sm,
  },
  sessionChipSelected: {
    borderColor: colors.accent,
    backgroundColor: 'rgba(77,245,255,0.1)',
  },
  sessionChipTextSelected: {
    color: colors.accent,
  },
  metricsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginVertical: spacing.sm,
  },
  metric: {
    flex: 1,
  },
  splitRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
});
