import { View, StyleSheet, useWindowDimensions } from 'react-native';
import { VictoryAxis, VictoryChart, VictoryLabel, VictoryLine, VictoryScatter, VictoryTheme } from 'victory-native';
import { AppText } from './AppText';
import { colors, spacing } from '../theme';
import { buildSmartXTickValues, getXAxisAngle } from './chartUtils';

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
  tickEvery?: number;
}

export function MultiSeriesLineChart({ series, height = 220, yLabel, tickEvery }: Props) {
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
  const labelSource = normalizedSeries.reduce<string[]>(
    (selected, serie) => (serie.data.length > selected.length ? serie.data.map((point) => String(point.x)) : selected),
    []
  );
  const tickSource = tickEvery
    ? labelSource.filter(
        (_, index) => index === 0 || index === labelSource.length - 1 || index % tickEvery === 0
      )
    : labelSource;
  const innerChartWidth = chartWidth - 84;
  const xTickValues = buildSmartXTickValues(tickSource, innerChartWidth, 10);
  const xAxisAngle = getXAxisAngle(xTickValues, innerChartWidth, 10);
  const chartPadding = { top: 24, bottom: Math.max(40, xAxisAngle ? 54 : 40), left: 52, right: 32 };
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
      padding={chartPadding}
      theme={VictoryTheme.material}
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
          tickLabels: { fill: colors.muted, fontSize: 10 },
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
