import { ReactNode } from 'react';
import { View, ViewProps, StyleSheet } from 'react-native';
import { colors } from '../theme';

interface Props extends ViewProps {
  children: ReactNode;
  padded?: boolean;
}

export function Card({ children, style, padded = true, ...rest }: Props) {
  return (
    <View style={[styles.card, padded && styles.padded, style]} {...rest}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.panel,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    width: '100%',
    alignSelf: 'center',
  },
  padded: {
    padding: 16,
  },
});
