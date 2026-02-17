import { View, StyleSheet } from 'react-native';
import { AppText } from './AppText';

export function EmptyState({ message = 'No data yet.' }: { message?: string }) {
  return (
    <View style={styles.container}>
      <AppText variant="muted">{message}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
});
