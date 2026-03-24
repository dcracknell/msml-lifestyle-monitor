import { View, useWindowDimensions } from 'react-native';
import {
  VictoryArea,
  VictoryAxis,
  VictoryChart,
  VictoryLabel,
  VictoryLine,
  VictoryScatter,
  VictoryTheme,
} from 'victory-native';
import { colors, spacing } from '../theme';
import { AppText } from './AppText';
import {
  buildSmartXTickValues,
  buildYAxisTickValues,
  buildZeroSeriesDomain,
  getXAxisAngle,
} from './chartUtils';

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
  const chartData = (data || [])
    .filter((point) => Boolean(point?.label) && Number.isFinite(point?.value))
    .map((point) => ({
      x: point.label,
      y: point.value,
    }));
  const comparisonData = (targetData || [])
    .filter((point) => Boolean(point?.label) && Number.isFinite(point?.value))
    .map((point) => ({
      x: point.label,
      y: point.value,
    }));
  const innerChartWidth = chartWidth - chartPadding.left - chartPadding.right;
  const xTickValues = buildSmartXTickValues(
    chartData.map((point) => String(point.x)),
    innerChartWidth
  );
  const xAxisAngle = getXAxisAngle(xTickValues, innerChartWidth);
  const normalizedPadding = {
    ...chartPadding,
    bottom: Math.max(chartPadding.bottom, xAxisAngle ? 54 : 42),
  };
  const resolvedYDomain = yDomain ?? buildZeroSeriesDomain(chartData.map((point) => point.y));
  const tickValues = resolvedYDomain
    ? buildYAxisTickValues(resolvedYDomain, yTickStep)
    : undefined;

  if (!chartData.length) {
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
      padding={normalizedPadding}
      theme={VictoryTheme.material}
      domain={resolvedYDomain ? { y: resolvedYDomain } : undefined}
    >
      <VictoryAxis
        tickValues={xTickValues}
        tickLabelComponent={(
          <VictoryLabel
            angle={xAxisAngle}
            textAnchor={xAxisAngle ? 'end' : 'middle'}
            verticalAnchor={xAxisAngle ? 'middle' : 'end'}
            dx={xAxisAngle ? -6 : 0}
            dy={xAxisAngle ? 4 : 0}
          />
        )}
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

function formatAxisValue(value: number) {
  if (Math.abs(value) >= 1000) {
    return `${Math.round(value / 100) / 10}k`;
  }
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}
