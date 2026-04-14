type NutritionMetricName =
  | 'nutrition_search_latency'
  | 'nutrition_search_error'
  | 'nutrition_wrong_autofill'
  | 'nutrition_delete_undo';

type NutritionMetricEvent = {
  name: NutritionMetricName;
  payload: Record<string, unknown>;
  recordedAt: string;
};

const METRIC_BUFFER_KEY = '__MSML_NUTRITION_METRICS__';
const METRIC_BUFFER_LIMIT = 100;

export function trackNutritionMetric(
  name: NutritionMetricName,
  payload: Record<string, unknown> = {}
) {
  try {
    const globalObject = globalThis as typeof globalThis & {
      [METRIC_BUFFER_KEY]?: NutritionMetricEvent[];
    };
    const nextEvent: NutritionMetricEvent = {
      name,
      payload,
      recordedAt: new Date().toISOString(),
    };
    const current = Array.isArray(globalObject[METRIC_BUFFER_KEY])
      ? globalObject[METRIC_BUFFER_KEY]
      : [];
    globalObject[METRIC_BUFFER_KEY] = [...current, nextEvent].slice(-METRIC_BUFFER_LIMIT);
    if (typeof process !== 'undefined' && process.env.NODE_ENV !== 'production') {
      // Bridge hook until a first-class analytics sink is wired up.
      console.info('[nutrition-metric]', name, payload);
    }
  } catch {
    // Metrics should never block the user flow.
  }
}
