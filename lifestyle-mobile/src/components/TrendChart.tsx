import { View, useWindowDimensions } from 'react-native';
import {
  VictoryArea,
  VictoryAxis,
  VictoryChart,
  VictoryLine,
  VictoryScatter,
  VictoryTheme,
} from 'victory-native';
import { colors, spacing } from '../theme';
import { AppText } from './AppText';

export interface TrendPoint {
  label: string;
  value: number;
}

interface Props {
  data: TrendPoint[];
  targetData?: TrendPoint[];
  height?: number;
  color?: string;
  yLabel?: string;
  yDomain?: [number, number];
  yTickStep?: number;
  areaOpacity?: number;
  showPoints?: boolean;
  strokeWidth?: number;
  pointSize?: number;
  chartPadding?: { top: number; bottom: number; left: number; right: number };
  gridColor?: string;
}

export function TrendChart({
  data,
  targetData,
  height = 180,
  color = colors.accent,
  yLabel,
  yDomain,
  yTickStep,
  areaOpacity = 0.2,
  showPoints = true,
  strokeWidth = 2.5,
  pointSize = 2.5,
  chartPadding = { top: 24, bottom: 42, left: 52, right: 18 },
  gridColor = 'rgba(255,255,255,0.08)',
}: Props) {
  const { width } = useWindowDimensions();
  const horizontalPadding = spacing.lg * 2 + 32; // screen gutters + card padding
  const chartWidth = Math.max(240, width - horizontalPadding);
  const chartData = data?.map((point) => ({
    x: point.label,
    y: point.value,
  }));
  const comparisonData = targetData?.map((point) => ({
    x: point.label,
    y: point.value,
  }));
  const tickValues =
    Array.isArray(yDomain) && yDomain.length === 2 && yTickStep
      ? buildTickValues(yDomain[0], yDomain[1], yTickStep)
      : undefined;
  const xTickValues = buildXTickValues(data.map((point) => point.label));

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
      padding={chartPadding}
      theme={VictoryTheme.material}
      domain={yDomain ? { y: yDomain } : undefined}
    >
      <VictoryAxis
        tickValues={xTickValues}
        style={{
          axis: { stroke: 'transparent' },
          tickLabels: { fill: colors.muted, fontSize: 11, padding: 8 },
          grid: { stroke: 'transparent' },
          ticks: { stroke: 'transparent' },
        }}
      />
      <VictoryAxis
        dependentAxis
        label={yLabel}
        tickValues={tickValues}
        tickFormat={(value) => formatAxisValue(value)}
        style={{
          axis: { stroke: 'transparent' },
          tickLabels: { fill: colors.muted, fontSize: 11, padding: 6 },
          grid: { stroke: gridColor, strokeDasharray: '4,8' },
          axisLabel: { fill: colors.muted, padding: 40 },
          ticks: { stroke: 'transparent' },
        }}
      />
      {comparisonData?.length ? (
        <VictoryLine
          data={comparisonData}
          interpolation="monotoneX"
          style={{
            data: {
              stroke: colors.muted,
              strokeDasharray: '6,6',
              strokeWidth: 1.5,
              opacity: 0.9,
            },
          }}
        />
      ) : null}
      <VictoryArea
        data={chartData}
        interpolation="monotoneX"
        style={{
          data: {
            stroke: color,
            fill: color,
            fillOpacity: areaOpacity,
            strokeWidth,
          },
        }}
      />
      {showPoints ? (
        <VictoryScatter
          data={chartData}
          size={pointSize}
          style={{
            data: { fill: color },
          }}
        />
      ) : null}
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

function buildXTickValues(labels: string[]) {
  if (labels.length <= 5) {
    return labels;
  }
  const step = Math.max(1, Math.ceil(labels.length / 4));
  const ticks = labels.filter((_, index) => index === 0 || index === labels.length - 1 || index % step === 0);
  return Array.from(new Set(ticks));
}

function formatAxisValue(value: number) {
  if (Math.abs(value) >= 1000) {
    return `${Math.round(value / 100) / 10}k`;
  }
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}
