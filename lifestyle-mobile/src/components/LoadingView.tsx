import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { colors } from '../theme';

export function LoadingView({ compact = false }: { compact?: boolean }) {
  return (
    <View style={[styles.container, compact && styles.compact]}>
      <ActivityIndicator color={colors.accent} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  compact: {
    paddingVertical: 12,
  },
});
