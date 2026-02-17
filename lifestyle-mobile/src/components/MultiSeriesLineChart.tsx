import { View, StyleSheet, useWindowDimensions } from 'react-native';
import { VictoryAxis, VictoryChart, VictoryLine, VictoryScatter, VictoryTheme } from 'victory-native';
import { AppText } from './AppText';
import { colors, spacing } from '../theme';

export interface LineSeriesPoint {
  label: string;
  value: number;
}

export interface LineSeries {
  id: string;
  label: string;
  color?: string;
  strokeDasharray?: string;
  data: LineSeriesPoint[];
}

interface Props {
  series: LineSeries[];
  height?: number;
  yLabel?: string;
}

export function MultiSeriesLineChart({ series, height = 220, yLabel }: Props) {
  const { width } = useWindowDimensions();
  const horizontalPadding = spacing.lg * 2 + 32;
  const chartWidth = Math.max(240, width - horizontalPadding);
  const activeSeries = (series || []).filter((item) => item?.data?.length);
  const normalizedSeries = activeSeries.map((serie) => ({
    ...serie,
    data: serie.data.map((point) => ({
      x: point.label,
      y: point.value,
    })),
  }));
  if (!activeSeries.length) {
    return (
      <View style={styles.empty}>
        <AppText variant="muted">No data available.</AppText>
      </View>
    );
  }

  return (
    <VictoryChart
      height={height}
      width={chartWidth}
      padding={{ top: 24, bottom: 40, left: 52, right: 32 }}
      theme={VictoryTheme.material}
    >
      <VictoryAxis
        style={{
          axis: { stroke: 'transparent' },
          tickLabels: { fill: colors.muted, fontSize: 10, angle: -30 },
          grid: { stroke: 'transparent' },
        }}
      />
      <VictoryAxis
        dependentAxis
        label={yLabel}
        style={{
          axis: { stroke: 'transparent' },
          tickLabels: { fill: colors.muted, fontSize: 10 },
          grid: { stroke: 'rgba(255,255,255,0.08)', strokeDasharray: '4,8' },
          axisLabel: { fill: colors.muted, padding: 40 },
        }}
      />
      {normalizedSeries.map((serie) => (
        <VictoryLine
          key={serie.id}
          data={serie.data}
          interpolation="monotoneX"
          style={{
            data: {
              stroke: serie.color || colors.accent,
              strokeWidth: 2,
              strokeDasharray: serie.strokeDasharray,
            },
          }}
        />
      ))}
      {normalizedSeries.map((serie) => (
        <VictoryScatter
          key={`${serie.id}-points`}
          data={serie.data}
          size={3}
          style={{
            data: { fill: serie.color || colors.accent },
          }}
        />
      ))}
    </VictoryChart>
  );
}

const styles = StyleSheet.create({
  empty: {
    alignItems: 'center',
    padding: 16,
  },
});
