import { Alert, StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import {
  AppButton,
  AppText,
  Card,
  ErrorView,
  LoadingView,
  SectionHeader,
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
import { spacing } from '../../theme';

export function AdminSection() {
  const { user } = useAuth();
  const isHeadCoach = user?.role === 'Head Coach';
  const { data, isLoading, isError, refetch } = useQuery({
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
    return null;
  }

  if (isLoading || !data) {
    return <View style={styles.container}><LoadingView /></View>;
  }

  if (isError) {
    return <View style={styles.container}><ErrorView message="Unable to load users" onRetry={refetch} /></View>;
  }

  return (
    <View style={styles.container}>
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
    </View>
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
});
