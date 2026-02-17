import { View, useWindowDimensions } from 'react-native';
import { VictoryArea, VictoryAxis, VictoryChart, VictoryScatter, VictoryTheme } from 'victory-native';
import { colors, spacing } from '../theme';
import { AppText } from './AppText';

export interface TrendPoint {
  label: string;
  value: number;
}

interface Props {
  data: TrendPoint[];
  height?: number;
  color?: string;
  yLabel?: string;
  yDomain?: [number, number];
  yTickStep?: number;
}

export function TrendChart({
  data,
  height = 180,
  color = colors.accent,
  yLabel,
  yDomain,
  yTickStep,
}: Props) {
  const { width } = useWindowDimensions();
  const horizontalPadding = spacing.lg * 2 + 32; // screen gutters + card padding
  const chartWidth = Math.max(240, width - horizontalPadding);
  const chartData = data?.map((point) => ({
    x: point.label,
    y: point.value,
  }));
  const tickValues =
    Array.isArray(yDomain) && yDomain.length === 2 && yTickStep
      ? buildTickValues(yDomain[0], yDomain[1], yTickStep)
      : undefined;

  if (!data || !data.length) {
    return (
      <View style={{ alignItems: 'center', padding: 16 }}>
        <AppText variant="muted">No data available.</AppText>
      </View>
    );
  }

  return (
    <VictoryChart
      height={height}
      width={chartWidth}
      padding={{ top: 24, bottom: 36, left: 48, right: 24 }}
      theme={VictoryTheme.material}
      domain={yDomain ? { y: yDomain } : undefined}
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
        tickValues={tickValues}
        style={{
          axis: { stroke: 'transparent' },
          tickLabels: { fill: colors.muted, fontSize: 10 },
          grid: { stroke: 'rgba(255,255,255,0.08)', strokeDasharray: '4,8' },
          axisLabel: { fill: colors.muted, padding: 35 },
        }}
      />
      <VictoryArea
        data={chartData}
        interpolation="monotoneX"
        style={{
          data: {
            stroke: color,
            fill: `${color}33`,
            strokeWidth: 2,
          },
        }}
      />
      <VictoryScatter
        data={chartData}
        size={3}
        style={{
          data: { fill: color },
        }}
      />
    </VictoryChart>
  );
}

function buildTickValues(min: number, max: number, step: number) {
  const values: number[] = [];
  for (let value = min; value <= max; value += step) {
    values.push(value);
  }
  return values;
}
