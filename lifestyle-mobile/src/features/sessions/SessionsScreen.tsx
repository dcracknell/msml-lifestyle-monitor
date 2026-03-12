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
      {/* Page header */}
      <View style={styles.pageHeader}>
        <AppText style={styles.eyebrow}>SESSIONS</AppText>
        <AppText style={styles.pageTitle}>Training log</AppText>
        <View style={styles.countBadge}>
          <AppText style={styles.countBadgeText}>{sessions.length} sessions</AppText>
        </View>
      </View>

      {/* Session selector chips */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.sessionChips}>
        {sessions.map((session) => {
          const selected = activeSession?.id === session.id;
          return (
            <Pressable
              key={session.id}
              style={[styles.sessionChip, selected && styles.sessionChipSelected]}
              onPress={() => setSelectedId(session.id)}
            >
              <AppText style={[styles.sessionChipText, selected && styles.sessionChipTextSelected]}>
                {formatDate(session.startTime, 'MMM D')}
              </AppText>
              <AppText style={[styles.sessionChipSport, selected && styles.sessionChipTextSelected]}>
                {session.name}
              </AppText>
            </Pressable>
          );
        })}
      </ScrollView>

      {activeSession ? (
        <>
          {/* Session hero */}
          <View style={styles.heroCard}>
            <AppText style={styles.eyebrow}>{activeSession.sportType?.toUpperCase() ?? 'SESSION'} · {formatDate(activeSession.startTime, 'MMM D, HH:mm')}</AppText>
            <AppText style={styles.heroDistance}>{formatDistance(activeSession.distance || 0)}</AppText>
            <AppText style={styles.heroName}>{activeSession.name}</AppText>
            {data.strava?.canManage && data.strava?.connected ? (
              <Pressable
                style={[styles.stravaBtn, (!canExportToStrava || isExporting) && styles.stravaBtnDisabled]}
                onPress={handleExportToStrava}
                disabled={!canExportToStrava || isExporting}
              >
                <AppText style={styles.stravaBtnText}>
                  {activeSession.stravaActivityId ? 'Synced to Strava' : isExporting ? 'Exporting…' : 'Export to Strava'}
                </AppText>
              </Pressable>
            ) : null}
            {exportFeedback ? <AppText style={styles.mutedText}>{exportFeedback}</AppText> : null}
          </View>

          {/* 6-metric grid */}
          <View style={styles.metricGrid}>
            <SessionMetric label="DISTANCE" value={formatDistance(activeSession.distance || 0)} />
            <SessionMetric label="PACE" value={formatPace(activeSession.averagePace)} />
            <SessionMetric label="DURATION" value={formatMinutes(activeSession.movingTime)} />
            <SessionMetric label="AVG HR" value={activeSession.averageHr ? `${activeSession.averageHr} bpm` : '--'} />
            <SessionMetric label="CADENCE" value={activeSession.averageCadence ? `${activeSession.averageCadence} spm` : '--'} />
            <SessionMetric label="ELEVATION" value={activeSession.elevationGain ? `${Math.round(activeSession.elevationGain)} m` : '--'} />
          </View>

          {/* Splits */}
          <View style={styles.card}>
            <AppText style={styles.eyebrow}>SPLITS</AppText>
            <AppText style={styles.cardTitle}>Kilometre splits</AppText>
            {splits.length ? (
              splits.map((split) => (
                <View key={`${split.sessionId}-${split.splitIndex}`} style={styles.splitRow}>
                  <View style={styles.splitKm}>
                    <AppText style={styles.splitKmText}>KM {split.splitIndex}</AppText>
                  </View>
                  <AppText style={styles.splitPace}>{formatPace(split.pace)}</AppText>
                  <AppText style={styles.splitHr}>{split.heartRate ? `${split.heartRate} bpm` : '--'}</AppText>
                </View>
              ))
            ) : (
              <AppText style={styles.mutedText}>No split data available for this session.</AppText>
            )}
          </View>
        </>
      ) : (
        <View style={styles.card}>
          <AppText style={styles.mutedText}>No sessions available yet.</AppText>
        </View>
      )}
    </RefreshableScrollView>
  );
}

function SessionMetric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.sessionMetric}>
      <AppText style={styles.sessionMetricLabel}>{label}</AppText>
      <AppText style={styles.sessionMetricValue}>{value}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: spacing.lg,
    gap: 12,
    paddingBottom: spacing.lg * 2,
  },
  pageHeader: {
    gap: 4,
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.4,
    color: colors.muted,
    textTransform: 'uppercase',
  },
  pageTitle: {
    fontSize: 32,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.5,
  },
  countBadge: {
    alignSelf: 'flex-start',
    backgroundColor: `${colors.accent}1a`,
    borderWidth: 1,
    borderColor: `${colors.accent}44`,
    borderRadius: 100,
    paddingHorizontal: 10,
    paddingVertical: 3,
    marginTop: 4,
  },
  countBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.accent,
  },
  sessionChips: {
    gap: spacing.sm,
    paddingBottom: 4,
  },
  sessionChip: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: colors.panel,
    marginRight: spacing.sm,
    gap: 2,
    minWidth: 90,
    alignItems: 'center',
  },
  sessionChipSelected: {
    borderColor: colors.accent,
    backgroundColor: `${colors.accent}18`,
  },
  sessionChipText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.muted,
    letterSpacing: 0.3,
  },
  sessionChipSport: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.muted,
  },
  sessionChipTextSelected: {
    color: colors.accent,
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
  heroDistance: {
    fontSize: 52,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -1,
    lineHeight: 56,
  },
  heroName: {
    fontSize: 15,
    color: colors.muted,
    marginBottom: 4,
  },
  stravaBtn: {
    alignSelf: 'flex-start',
    backgroundColor: `${colors.accent}18`,
    borderWidth: 1,
    borderColor: `${colors.accent}44`,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 7,
    marginTop: 4,
  },
  stravaBtnDisabled: {
    opacity: 0.4,
  },
  stravaBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.accent,
  },
  // Metric grid
  metricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  sessionMetric: {
    width: '30%',
    flexGrow: 1,
    backgroundColor: colors.panel,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    gap: 6,
  },
  sessionMetricLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
    color: colors.muted,
    textTransform: 'uppercase',
  },
  sessionMetricValue: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.3,
  },
  // Generic card
  card: {
    backgroundColor: colors.panel,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 20,
    gap: 10,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.3,
  },
  // Splits
  splitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: 12,
  },
  splitKm: {
    width: 52,
    backgroundColor: `${colors.accent}12`,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    alignItems: 'center',
  },
  splitKmText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.accent,
    letterSpacing: 0.3,
  },
  splitPace: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  splitHr: {
    fontSize: 13,
    color: colors.muted,
  },
  mutedText: {
    fontSize: 13,
    color: colors.muted,
    lineHeight: 18,
  },
});
