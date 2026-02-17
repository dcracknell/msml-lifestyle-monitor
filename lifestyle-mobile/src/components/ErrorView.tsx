import { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { AppText } from './AppText';
import { AppButton } from './AppButton';

interface Props {
  message?: string;
  onRetry?: () => void;
  actionLabel?: string;
  extraContent?: ReactNode;
}

export function ErrorView({ message = 'Something went wrong.', onRetry, actionLabel, extraContent }: Props) {
  return (
    <View style={styles.container}>
      <AppText variant="muted" style={styles.message}>
        {message}
      </AppText>
      {extraContent}
      {onRetry ? (
        <AppButton title={actionLabel || 'Retry'} variant="ghost" onPress={onRetry} style={styles.button} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  message: {
    textAlign: 'center',
  },
  button: {
    marginTop: 12,
  },
});
