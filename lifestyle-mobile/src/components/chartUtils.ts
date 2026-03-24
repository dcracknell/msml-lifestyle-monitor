export function buildDistributedTicks<T>(values: T[], targetCount: number) {
  if (!values.length) {
    return [] as T[];
  }

  const count = Math.max(2, Math.min(targetCount, values.length));
  if (values.length <= count) {
    return values.slice();
  }

  const result: T[] = [];
  for (let index = 0; index < count; index += 1) {
    const valueIndex = Math.round((index * (values.length - 1)) / Math.max(1, count - 1));
    const value = values[valueIndex];
    if (result[result.length - 1] !== value) {
      result.push(value);
    }
  }

  const lastValue = values[values.length - 1];
  if (result[result.length - 1] !== lastValue) {
    result.push(lastValue);
  }

  return result;
}

export function buildSmartXTickValues(labels: string[], chartWidth: number, fontSize = 11) {
  const uniqueLabels = Array.from(new Set(labels.filter(Boolean)));
  if (uniqueLabels.length <= 2) {
    return uniqueLabels;
  }

  const longestLabel = uniqueLabels.reduce((max, label) => Math.max(max, label.length), 0);
  const approxLabelWidth = Math.max(40, Math.min(longestLabel * fontSize * 0.58, chartWidth));
  const maxTicksByWidth = Math.max(2, Math.floor(chartWidth / approxLabelWidth));
  const targetTickCount = Math.max(2, Math.min(5, maxTicksByWidth));

  return buildDistributedTicks(uniqueLabels, targetTickCount);
}

export function getXAxisAngle(labels: string[], chartWidth: number, fontSize = 11) {
  if (labels.length <= 2) {
    return 0;
  }

  const longestLabel = labels.reduce((max, label) => Math.max(max, label.length), 0);
  const estimatedWidth = labels.length * longestLabel * fontSize * 0.45;

  return labels.length > 3 || longestLabel > 7 || estimatedWidth > chartWidth * 1.1 ? -28 : 0;
}

export function buildYAxisTickValues(
  domain: [number, number],
  step?: number,
  maxTicks = 5
) {
  const [min, max] = domain;
  if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) {
    return undefined;
  }

  if (step && step > 0) {
    const values: number[] = [];
    let guard = 0;
    for (let value = min; value <= max + step / 2 && guard < 500; value += step, guard += 1) {
      values.push(roundTickValue(value));
    }
    return values.length <= maxTicks ? values : buildDistributedTicks(values, maxTicks);
  }

  if (min === max) {
    return [roundTickValue(min)];
  }

  return buildDistributedTicks(
    Array.from({ length: maxTicks }, (_, index) => {
      const ratio = index / Math.max(1, maxTicks - 1);
      return roundTickValue(min + (max - min) * ratio);
    }),
    maxTicks
  );
}

export function buildZeroSeriesDomain(values: number[]) {
  if (!values.length || values.some((value) => value !== 0)) {
    return undefined;
  }
  return [0, 4] as [number, number];
}

function roundTickValue(value: number) {
  return Number(value.toFixed(2));
}
