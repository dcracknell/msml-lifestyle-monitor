import { StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { athletesRequest } from '../../api/endpoints';
import { useAuth } from '../../providers/AuthProvider';
import {
  AppText,
  Card,
  ErrorView,
  LoadingView,
  SectionHeader,
  RefreshableScrollView,
} from '../../components';
import { colors, spacing } from '../../theme';
import { formatNumber } from '../../utils/format';

export function RosterScreen() {
  const { user } = useAuth();
  const isCoach = user?.role === 'Coach' || user?.role === 'Head Coach';
  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['roster'],
    queryFn: athletesRequest,
    enabled: isCoach,
  });

  if (!isCoach) {
    return (
      <View style={styles.centered}> 
        <AppText variant="muted">Roster is available to coaches only.</AppText>
      </View>
    );
  }

  if (isLoading || !data) {
    return <LoadingView />;
  }

  if (isError) {
    return <ErrorView message="Unable to load roster" onRetry={refetch} />;
  }

  const sorted = [...data.athletes].sort((a, b) => (b.readinessScore ?? 0) - (a.readinessScore ?? 0));

  return (
    <RefreshableScrollView
      contentContainerStyle={styles.container}
      refreshing={isRefetching}
      onRefresh={refetch}
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <View style={styles.pageHeader}>
        <AppText style={styles.eyebrow}>ROSTER</AppText>
        <AppText style={styles.pageTitle}>Athlete roster</AppText>
        <View style={styles.countBadge}>
          <AppText style={styles.countBadgeText}>{data.athletes.length} athletes linked</AppText>
        </View>
      </View>

      {/* Athlete cards */}
      {sorted.map((athlete, index) => {
        const readiness = athlete.readinessScore ?? null;
        const pillColor = readiness === null ? colors.muted : readiness >= 70 ? colors.accent : readiness >= 40 ? colors.warning : colors.danger;
        return (
          <View key={athlete.id} style={styles.athleteCard}>
            <View style={styles.athleteHeader}>
              <View style={styles.rankBadge}>
                <AppText style={styles.rankText}>#{index + 1}</AppText>
              </View>
              <View style={{ flex: 1 }}>
                <AppText style={styles.athleteName}>{athlete.name}</AppText>
                <AppText style={styles.athleteRole}>{athlete.role}</AppText>
              </View>
              <View style={[styles.readinessPill, { backgroundColor: `${pillColor}1a`, borderColor: `${pillColor}55` }]}>
                <View style={[styles.pillDot, { backgroundColor: pillColor }]} />
                <AppText style={[styles.readinessText, { color: pillColor }]}>
                  {readiness !== null ? `${readiness}%` : '--'}
                </AppText>
              </View>
            </View>
            <View style={styles.athleteGrid}>
              <AthleteMetric label="STEPS" value={formatNumber(athlete.steps)} />
              <AthleteMetric label="SLEEP" value={`${athlete.sleepHours ?? '--'} h`} />
              <AthleteMetric label="CALORIES" value={formatNumber(athlete.calories)} />
            </View>
          </View>
        );
      })}
    </RefreshableScrollView>
  );
}

function AthleteMetric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.athleteMetric}>
      <AppText style={styles.athleteMetricLabel}>{label}</AppText>
      <AppText style={styles.athleteMetricValue}>{value}</AppText>
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
  athleteCard: {
    backgroundColor: colors.panel,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    gap: 12,
  },
  athleteHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  rankBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  rankText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.muted,
  },
  athleteName: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.2,
  },
  athleteRole: {
    fontSize: 12,
    color: colors.muted,
  },
  readinessPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 100,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  pillDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  readinessText: {
    fontSize: 13,
    fontWeight: '700',
  },
  athleteGrid: {
    flexDirection: 'row',
    gap: 8,
  },
  athleteMetric: {
    flex: 1,
    backgroundColor: colors.glass,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    gap: 3,
  },
  athleteMetricLabel: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1.2,
    color: colors.muted,
    textTransform: 'uppercase',
  },
  athleteMetricValue: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.3,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
  },
});
