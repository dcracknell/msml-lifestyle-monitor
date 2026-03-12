import { useState } from 'react';
import { StyleSheet, View, Pressable, ActivityIndicator } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { shareCoachesRequest, shareAccessRequest } from '../../api/endpoints';
import {
  AppButton,
  AppInput,
  AppText,
  Card,
  ErrorView,
  SectionHeader,
} from '../../components';
import { colors, spacing } from '../../theme';

export function ShareSection() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['coaches'],
    queryFn: shareCoachesRequest,
  });
  const [selectedCoach, setSelectedCoach] = useState<number | null>(null);
  const [email, setEmail] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);

  const handleShare = async () => {
    setFeedback(null);
    try {
      const response = await shareAccessRequest({
        coachId: selectedCoach || undefined,
        coachEmail: email || undefined,
      });
      setFeedback(response.message);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Unable to share access.');
    }
  };

  return (
    <Card>
      <SectionHeader title="Share with a coach" subtitle="Grant dashboard access" />
      {isLoading ? (
        <ActivityIndicator color={colors.accent} />
      ) : isError ? (
        <View style={styles.emptyState}>
          <AppText style={styles.emptyIcon}>⚠</AppText>
          <AppText variant="muted" style={styles.emptyText}>
            Unable to load coaches
          </AppText>
          <AppButton title="Retry" variant="ghost" onPress={() => refetch()} style={styles.retryButton} />
        </View>
      ) : (
        <>
          <AppText variant="label" style={styles.selectLabel}>
            Select coach
          </AppText>
          {data!.coaches.length === 0 ? (
            <View style={styles.emptyState}>
              <AppText style={styles.emptyIcon}>◻</AppText>
              <AppText variant="muted" style={styles.emptyText}>
                No coaches available
              </AppText>
            </View>
          ) : (
            <View style={styles.coachGrid}>
              {data!.coaches.map((coach) => {
                const selected = selectedCoach === coach.id;
                return (
                  <Pressable
                    key={coach.id}
                    style={[styles.coachCard, selected && styles.coachCardSelected]}
                    onPress={() => setSelectedCoach(selected ? null : coach.id)}
                  >
                    <AppText
                      variant="body"
                      weight="semibold"
                      style={selected ? styles.coachNameSelected : styles.coachName}
                    >
                      {coach.name}
                    </AppText>
                    <AppText variant="muted" style={styles.coachRole}>
                      {coach.role}
                    </AppText>
                  </Pressable>
                );
              })}
            </View>
          )}
          <AppInput
            label="Coach email (optional)"
            placeholder="coach@example.com"
            autoCapitalize="none"
            value={email}
            onChangeText={setEmail}
            style={{ borderColor: '#1e3a5f' }}
          />
          {feedback ? (
            <AppText variant="muted" style={styles.feedback}>
              {feedback}
            </AppText>
          ) : null}
          <AppButton title="Share access" onPress={handleShare} />
        </>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  selectLabel: {
    marginBottom: spacing.sm,
  },
  coachGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  coachCard: {
    flex: 1,
    minWidth: '45%',
    padding: spacing.md,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel,
    gap: spacing.xxs,
  },
  coachCardSelected: {
    borderColor: colors.accent,
    backgroundColor: 'rgba(0,229,204,0.08)',
  },
  coachName: {
    color: colors.text,
  },
  coachNameSelected: {
    color: colors.accent,
  },
  coachRole: {
    fontSize: 12,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: spacing.lg,
    gap: spacing.xs,
  },
  emptyIcon: {
    fontSize: 28,
    color: colors.muted,
    marginBottom: spacing.xs,
  },
  emptyText: {
    textAlign: 'center',
  },
  retryButton: {
    marginTop: spacing.xs,
  },
  feedback: {
    marginVertical: spacing.sm,
  },
});
