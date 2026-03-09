import { useState } from 'react';
import { StyleSheet, View, Pressable, ScrollView } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { activityRequest, exportSessionToStravaRequest } from '../../api/endpoints';
import { useSubject } from '../../providers/SubjectProvider';
import { useAuth } from '../../providers/AuthProvider';
import {
  LoadingView,
  ErrorView,
  AppButton,
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
  const [isExporting, setIsExporting] = useState(false);
  const [exportFeedback, setExportFeedback] = useState<string | null>(null);

  if (isLoading || !data) {
    return <LoadingView />;
  }

  if (isError) {
    return <ErrorView message="Unable to load sessions" onRetry={refetch} />;
  }

  const sessions = data.sessions || [];
  const activeSession = sessions.find((session) => session.id === selectedId) || sessions[0];
  const splits = activeSession ? data.splits[activeSession.id] || [] : [];
  const canExportToStrava = Boolean(
    data.strava?.canManage &&
      data.strava?.connected &&
      activeSession &&
      !activeSession.stravaActivityId
  );

  const handleExportToStrava = async () => {
    if (!activeSession) return;
    setExportFeedback(null);
    setIsExporting(true);
    try {
      const payload = await exportSessionToStravaRequest(activeSession.id);
      await refetch();
      setExportFeedback(payload.message || `Exported "${activeSession.name}" to Strava.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to export session to Strava.';
      setExportFeedback(message);
    } finally {
      setIsExporting(false);
    }
  };

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
          {data.strava?.canManage && data.strava?.connected ? (
            <View style={styles.exportRow}>
              <AppButton
                title={activeSession.stravaActivityId ? 'Already in Strava' : 'Export to Strava'}
                variant="ghost"
                onPress={handleExportToStrava}
                loading={isExporting}
                disabled={!canExportToStrava || isExporting}
              />
            </View>
          ) : null}
          {exportFeedback ? (
            <AppText variant="muted">{exportFeedback}</AppText>
          ) : null}
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
  exportRow: {
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
});
