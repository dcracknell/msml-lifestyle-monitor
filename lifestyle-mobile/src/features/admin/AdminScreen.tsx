import { Alert, StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import {
  AppButton,
  AppText,
  Card,
  ErrorView,
  LoadingView,
  SectionHeader,
  RefreshableScrollView,
} from '../../components';
import { useAuth } from '../../providers/AuthProvider';
import {
  athletesRequest,
  promoteCoachRequest,
  demoteCoachRequest,
  deleteUserRequest,
  resetUserPasswordRequest,
} from '../../api/endpoints';
import { ApiError } from '../../api/client';
import { colors, spacing } from '../../theme';

export function AdminScreen() {
  const { user } = useAuth();
  const isHeadCoach = user?.role === 'Head Coach';
  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['roster'],
    queryFn: athletesRequest,
    enabled: isHeadCoach,
  });

  const handleAction = async (action: 'promote' | 'demote' | 'delete', userId: number) => {
    if (action === 'promote') await promoteCoachRequest(userId);
    if (action === 'demote') await demoteCoachRequest(userId);
    if (action === 'delete') await deleteUserRequest(userId);
    refetch();
  };

  const resetPassword = async (userId: number) => {
    try {
      await resetUserPasswordRequest(userId);
      Alert.alert('Password reset', 'Password reset successfully to the default "Password".');
      refetch();
    } catch (error) {
      const message = error instanceof ApiError ? error.message : 'Unable to reset the password.';
      Alert.alert('Reset failed', message);
    }
  };

  const confirmResetPassword = (userId: number, name: string) => {
    const displayName = name || 'this account';
    const message = `Reset the password for ${displayName}? The temporary password will be "Password".`;
    Alert.alert('Reset password', message, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reset',
        style: 'destructive',
        onPress: () => resetPassword(userId),
      },
    ]);
  };

  if (!isHeadCoach) {
    return (
      <View style={styles.centered}>
        <AppText variant="muted">Admin tools available to Head Coach only.</AppText>
      </View>
    );
  }

  if (isLoading || !data) {
    return <LoadingView />;
  }

  if (isError) {
    return <ErrorView message="Unable to load users" onRetry={refetch} />;
  }

  return (
    <RefreshableScrollView
      contentContainerStyle={styles.container}
      refreshing={isRefetching}
      onRefresh={refetch}
      showsVerticalScrollIndicator={false}
    >
      <SectionHeader title="Admin" subtitle="Manage access" />
      {data.athletes.map((athlete) => (
        <Card key={athlete.id}>
          <AppText variant="heading">{athlete.name}</AppText>
          <AppText variant="muted">{athlete.role}</AppText>
          <View style={styles.actions}>
            <View style={styles.actionRow}>
              {athlete.role === 'Athlete' ? (
                <AppButton title="Promote" variant="ghost" onPress={() => handleAction('promote', athlete.id)} />
              ) : (
                <AppButton title="Demote" variant="ghost" onPress={() => handleAction('demote', athlete.id)} />
              )}
              <AppButton title="Delete" variant="ghost" onPress={() => handleAction('delete', athlete.id)} />
            </View>
            <View style={styles.resetRow}>
              <AppButton
                title="Reset Password"
                variant="ghost"
                onPress={() => confirmResetPassword(athlete.id, athlete.name)}
                style={styles.resetButton}
              />
            </View>
          </View>
        </Card>
      ))}
    </RefreshableScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
  actions: {
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  actionRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  resetRow: {
    flexDirection: 'row',
  },
  resetButton: {
    flex: 1,
  },
  centered: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
