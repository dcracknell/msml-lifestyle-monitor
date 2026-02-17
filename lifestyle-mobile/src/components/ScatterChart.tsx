import { View, StyleSheet, useWindowDimensions } from 'react-native';
import {
  VictoryAxis,
  VictoryChart,
  VictoryScatter,
  VictoryTheme,
  VictoryTooltip,
  VictoryVoronoiContainer,
} from 'victory-native';
import { AppText } from './AppText';
import { colors, spacing } from '../theme';

export interface ScatterPoint {
  x: number;
  y: number;
  label?: string;
}

interface Props {
  data: ScatterPoint[];
  height?: number;
  xLabel?: string;
  yLabel?: string;
  xFormatter?: (value: number) => string;
  yFormatter?: (value: number) => string;
}

export function ScatterChart({
  data,
  height = 220,
  xLabel,
  yLabel,
  xFormatter,
  yFormatter,
}: Props) {
  const { width } = useWindowDimensions();
  const horizontalPadding = spacing.lg * 2 + 32;
  const chartWidth = Math.max(240, width - horizontalPadding);
  const activeData = (data || []).filter(
    (point) => Number.isFinite(point?.x) && Number.isFinite(point?.y)
  );

  if (!activeData.length) {
    return (
      <View style={styles.empty}>
        <AppText variant="muted">Not enough data to plot yet.</AppText>
      </View>
    );
  }

  return (
    <VictoryChart
      height={height}
      width={chartWidth}
      padding={{ top: 24, bottom: 48, left: 56, right: 24 }}
      theme={VictoryTheme.material}
      containerComponent={
        <VictoryVoronoiContainer
          voronoiDimension="x"
          labels={({ datum }) => {
            const paceLabel = xFormatter ? xFormatter(Number(datum.x)) : String(datum.x);
            const hrLabel = yFormatter ? yFormatter(Number(datum.y)) : String(datum.y);
            return `${datum.label || 'Session'}\n${paceLabel} • ${hrLabel}`;
          }}
          labelComponent={
            <VictoryTooltip
              flyoutStyle={{ fill: colors.panel, stroke: colors.border }}
              style={{ fill: colors.text, fontSize: 12 }}
            />
          }
        />
      }
    >
      <VictoryAxis
        label={xLabel}
        style={{
          axis: { stroke: 'rgba(255,255,255,0.15)' },
          tickLabels: { fill: colors.muted, fontSize: 10 },
          axisLabel: { fill: colors.muted, padding: 36 },
          grid: { stroke: 'rgba(255,255,255,0.05)' },
        }}
        tickFormat={xFormatter}
      />
      <VictoryAxis
        dependentAxis
        label={yLabel}
        style={{
          axis: { stroke: 'rgba(255,255,255,0.15)' },
          tickLabels: { fill: colors.muted, fontSize: 10 },
          axisLabel: { fill: colors.muted, padding: 40 },
          grid: { stroke: 'rgba(255,255,255,0.05)' },
        }}
        tickFormat={yFormatter}
      />
      <VictoryScatter
        data={activeData}
        size={5}
        style={{
          data: { fill: colors.accentStrong },
        }}
      />
    </VictoryChart>
  );
}

const styles = StyleSheet.create({
  empty: {
    alignItems: 'center',
    padding: 16,
  },
});
