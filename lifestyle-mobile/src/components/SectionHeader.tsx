import { ReactNode } from 'react';
import { View, StyleSheet } from 'react-native';
import { AppText } from './AppText';
import { colors } from '../theme';

interface Props {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  action?: ReactNode;
}

export function SectionHeader({ eyebrow, title, subtitle, action }: Props) {
  return (
    <View style={styles.container}>
      <View style={styles.textContainer}>
        {eyebrow ? (
          <AppText variant="eyebrow" style={styles.eyebrow}>
            {eyebrow}
          </AppText>
        ) : null}
        <AppText variant="heading">{title}</AppText>
        {subtitle ? (
          <AppText variant="muted" style={styles.subtitle}>
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {action ? <View style={styles.action}>{action}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  textContainer: {
    flex: 1,
    paddingRight: 8,
  },
  action: {
    marginLeft: 12,
  },
  subtitle: {
    marginTop: 4,
  },
  eyebrow: {
    color: colors.muted,
  },
});
