import { useState } from 'react';
import { StyleSheet, View, Pressable } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { shareCoachesRequest, shareAccessRequest } from '../../api/endpoints';
import {
  AppButton,
  AppInput,
  AppText,
  Card,
  ErrorView,
  LoadingView,
  SectionHeader,
  RefreshableScrollView,
} from '../../components';
import { colors, spacing } from '../../theme';

export function ShareScreen() {
  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['coaches'],
    queryFn: shareCoachesRequest,
  });
  const [selectedCoach, setSelectedCoach] = useState<number | null>(null);
  const [email, setEmail] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);

  const handleShare = async () => {
    setFeedback(null);
    try {
      const response = await shareAccessRequest({ coachId: selectedCoach || undefined, coachEmail: email || undefined });
      setFeedback(response.message);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Unable to share access.');
    }
  };

  if (isLoading || !data) {
    return <LoadingView />;
  }

  if (isError) {
    return <ErrorView message="Unable to load coaches" onRetry={refetch} />;
  }

  return (
    <RefreshableScrollView
      contentContainerStyle={styles.container}
      refreshing={isRefetching}
      onRefresh={refetch}
      showsVerticalScrollIndicator={false}
    >
      <Card>
        <SectionHeader title="Share with a coach" subtitle="Grant dashboard access" />
        <AppText variant="label">Select coach</AppText>
        <View style={styles.coachList}>
          {data.coaches.map((coach) => {
            const selected = selectedCoach === coach.id;
            return (
              <Pressable
                key={coach.id}
                style={[styles.coachChip, selected && styles.coachChipSelected]}
                onPress={() => setSelectedCoach(coach.id)}
              >
                <AppText variant="body" style={selected ? styles.coachChipTextSelected : undefined}>
                  {coach.name} ({coach.role})
                </AppText>
              </Pressable>
            );
          })}
        </View>
        <AppInput
          label="Coach email (optional)"
          placeholder="coach@example.com"
          autoCapitalize="none"
          value={email}
          onChangeText={setEmail}
        />
        {feedback ? (
          <AppText variant="muted" style={styles.feedback}>
            {feedback}
          </AppText>
        ) : null}
        <AppButton title="Share access" onPress={handleShare} />
      </Card>
    </RefreshableScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: spacing.lg,
  },
  coachList: {
    flexDirection: 'column',
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  coachChip: {
    padding: spacing.sm,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  coachChipSelected: {
    borderColor: colors.accent,
    backgroundColor: 'rgba(77,245,255,0.12)',
  },
  coachChipTextSelected: {
    color: colors.accent,
  },
  feedback: {
    marginVertical: spacing.sm,
  },
});
