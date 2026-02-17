import { View, StyleSheet } from 'react-native';
import { AppText } from './AppText';
import { colors, spacing } from '../theme';

export interface ChartLegendItem {
  label: string;
  color: string;
}

interface Props {
  items: ChartLegendItem[];
}

export function ChartLegend({ items }: Props) {
  if (!items?.length) {
    return null;
  }

  return (
    <View style={styles.legend}>
      {items.map((item) => (
        <View key={item.label} style={styles.legendItem}>
          <View style={[styles.swatch, { backgroundColor: item.color }]} />
          <AppText variant="muted">{item.label}</AppText>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  swatch: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.accent,
  },
});
