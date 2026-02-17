import { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { colors } from '../theme';
import { AppText } from './AppText';

interface Props {
  label: string;
  value: string;
  trend?: string | null;
  icon?: ReactNode;
  tone?: 'default' | 'positive' | 'negative';
}

export function StatCard({ label, value, trend, icon, tone = 'default' }: Props) {
  return (
    <View style={[styles.card, toneStyles[tone]]}>
      <View style={styles.row}>
        <AppText variant="label">{label}</AppText>
        {icon ? <View>{icon}</View> : null}
      </View>
      <AppText variant="heading" style={styles.value}>
        {value}
      </AppText>
      {trend ? (
        <AppText variant="muted" style={styles.trend}>
          {trend}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.panel,
    borderRadius: 18,
    borderColor: colors.border,
    borderWidth: 1,
    padding: 16,
    flex: 1,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  value: {
    marginBottom: 4,
  },
  trend: {
    fontSize: 13,
  },
});

const toneStyles: Record<'default' | 'positive' | 'negative', object> = {
  default: {},
  positive: {
    borderColor: 'rgba(91,214,162,0.5)',
  },
  negative: {
    borderColor: 'rgba(255,107,129,0.5)',
  },
};
