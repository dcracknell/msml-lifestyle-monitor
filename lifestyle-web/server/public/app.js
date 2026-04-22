const Chart = window.Chart;
if (!Chart) {
  console.warn('Chart.js failed to load. Charts will be skipped until the page is reloaded.');
}

let chartWarningShown = false;
function resolveRequestErrorMessage(error, fallback = 'Request failed.') {
  const message = typeof error?.message === 'string' ? error.message.trim() : '';
  if (!message) {
    return fallback;
  }
  const normalized = message.toLowerCase();
  if (
    normalized === 'failed to fetch' ||
    normalized.includes('networkerror') ||
    normalized.includes('load failed')
  ) {
    return 'Cannot reach the server. Make sure it is running, then reload this page.';
  }
  return message;
}

const API_BASE_STORAGE_KEY = 'msml.api.base-url';
const API_BASE_QUERY_PARAM = 'apiBaseUrl';

function normalizeApiBaseUrl(value) {
  if (typeof value !== 'string') {
    return '';
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  try {
    const parsed = new URL(candidate);
    if (!/^https?:$/.test(parsed.protocol)) {
      return '';
    }
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString().replace(/\/+$/, '');
  } catch (error) {
    return '';
  }
}

function persistApiBaseUrl(value) {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      if (value) {
        window.localStorage.setItem(API_BASE_STORAGE_KEY, value);
      } else {
        window.localStorage.removeItem(API_BASE_STORAGE_KEY);
      }
    }
  } catch (error) {
    // Ignore storage failures.
  }
}

function resolveApiBaseUrl() {
  if (typeof window === 'undefined') {
    return '';
  }

  try {
    const params = new URLSearchParams(window.location?.search || '');
    if (params.has(API_BASE_QUERY_PARAM)) {
      const queryOverride = normalizeApiBaseUrl(params.get(API_BASE_QUERY_PARAM) || '');
      persistApiBaseUrl(queryOverride);
      if (queryOverride) {
        return queryOverride;
      }
    }
  } catch (error) {
    // Ignore query parsing issues.
  }

  const runtimeOverride = normalizeApiBaseUrl(window.__MSML_API_BASE_URL || '');
  if (runtimeOverride) {
    return runtimeOverride;
  }

  const metaOverride = normalizeApiBaseUrl(
    document.querySelector('meta[name="msml-api-base-url"]')?.content || ''
  );
  if (metaOverride) {
    return metaOverride;
  }

  try {
    const stored = normalizeApiBaseUrl(window.localStorage?.getItem(API_BASE_STORAGE_KEY) || '');
    if (stored) {
      return stored;
    }
  } catch (error) {
    // Ignore storage failures.
  }

  if (window.location?.protocol === 'file:') {
    return 'http://localhost:4000';
  }

  return '';
}

const API_BASE_URL = resolveApiBaseUrl();
const nativeFetch =
  typeof window !== 'undefined' && typeof window.fetch === 'function'
    ? window.fetch.bind(window)
    : null;

function resolveApiRequestUrl(targetUrl) {
  if (!API_BASE_URL || typeof targetUrl !== 'string') {
    return targetUrl;
  }

  if (/^\/api(?:\/|$)/i.test(targetUrl)) {
    return `${API_BASE_URL}${targetUrl}`;
  }

  return targetUrl;
}

async function finalizeApiResponse(response) {
  if (!response || response.ok || response.status !== 400) {
    return response;
  }

  const responseUrl = typeof response.url === 'string' ? response.url : '';
  if (!/\/api(?:\/|$)/i.test(responseUrl)) {
    return response;
  }

  let bodyText = '';
  try {
    bodyText = await response.clone().text();
  } catch (error) {
    return response;
  }

  if (!/request header or cookie too large/i.test(bodyText)) {
    return response;
  }

  resetToAuth('Session expired. Please sign in again.');
  throw new Error('Session expired. Please sign in again.');
}

async function apiFetch(input, init) {
  if (!nativeFetch) {
    throw new Error('Fetch is unavailable in this browser.');
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 20000);
  const initWithSignal = init
    ? { signal: controller.signal, ...init }
    : { signal: controller.signal };

  try {
    if (typeof input === 'string') {
      return finalizeApiResponse(await nativeFetch(resolveApiRequestUrl(input), initWithSignal));
    }

    if (typeof URL !== 'undefined' && input instanceof URL) {
      return finalizeApiResponse(await nativeFetch(resolveApiRequestUrl(input.toString()), initWithSignal));
    }

    if (typeof Request !== 'undefined' && input instanceof Request) {
      const resolvedUrl = resolveApiRequestUrl(input.url);
      if (resolvedUrl !== input.url) {
        return finalizeApiResponse(await nativeFetch(new Request(resolvedUrl, input), initWithSignal));
      }
    }

    return finalizeApiResponse(await nativeFetch(input, initWithSignal));
  } finally {
    clearTimeout(timeoutId);
  }
}

function destroyChartBoundToCanvas(canvas) {
  if (!Chart || !canvas) {
    return;
  }

  const candidates = new Set();
  if (typeof Chart.getChart === 'function') {
    const direct = Chart.getChart(canvas);
    if (direct) {
      candidates.add(direct);
    }
  }
  const tracked = canvas.__msmlChartInstance;
  if (tracked) {
    candidates.add(tracked);
  }
  const registry = Chart.instances;
  if (registry && typeof registry === 'object') {
    const instances = Array.isArray(registry) ? registry : Object.values(registry);
    instances.forEach((instance) => {
      if (!instance) return;
      if (instance.canvas === canvas || instance.ctx?.canvas === canvas) {
        candidates.add(instance);
      }
    });
  }

  candidates.forEach((instance) => {
    try {
      instance.destroy();
    } catch (error) {
      console.warn('Unable to destroy stale chart instance.', error);
    }
  });

  if (canvas.__msmlChartInstance) {
    delete canvas.__msmlChartInstance;
  }
}

function replaceCanvasElement(canvas) {
  if (!canvas || !canvas.parentNode) {
    return canvas;
  }
  const replacement = canvas.cloneNode(false);
  replacement.width = canvas.width;
  replacement.height = canvas.height;
  replacement.className = canvas.className;
  replacement.style.cssText = canvas.style.cssText;
  canvas.parentNode.replaceChild(replacement, canvas);
  return replacement;
}

function createChart(ctx, config) {
  if (!Chart) {
    if (!chartWarningShown) {
      console.warn('Chart.js is unavailable; charts will be skipped.');
      chartWarningShown = true;
    }
    return null;
  }
  const canvas = ctx?.canvas || ctx;
  if (canvas) {
    destroyChartBoundToCanvas(canvas);
  }
  try {
    const chart = new Chart(ctx, config);
    if (canvas) {
      canvas.__msmlChartInstance = chart;
    }
    return chart;
  } catch (error) {
    const initialMessage = typeof error?.message === 'string' ? error.message : '';
    if (canvas && initialMessage.includes('Canvas is already in use')) {
      try {
        destroyChartBoundToCanvas(canvas);
        const recovered = new Chart(ctx, config);
        canvas.__msmlChartInstance = recovered;
        return recovered;
      } catch (retryError) {
        const retryMessage = typeof retryError?.message === 'string' ? retryError.message : '';
        if (retryMessage.includes('Canvas is already in use')) {
          try {
            const replacementCanvas = replaceCanvasElement(canvas);
            destroyChartBoundToCanvas(replacementCanvas);
            const replacementCtx = replacementCanvas?.getContext?.('2d');
            if (replacementCtx) {
              const recovered = new Chart(replacementCtx, config);
              replacementCanvas.__msmlChartInstance = recovered;
              return recovered;
            }
          } catch (replacementError) {
            console.warn('Unable to recover chart canvas after reuse conflict.', replacementError);
          }
        } else {
          console.warn('Unable to recover chart after initial reuse conflict.', retryError);
        }
      }
    }
    console.warn('Skipping chart render due to Chart.js error.', error);
    return null;
  }
}

const SMART_CHART_MAX_VISIBLE_POINTS = 14;
const SMART_CHART_TARGET_TICKS = 6;
const SMART_CHART_DRAG_PIXELS_PER_STEP = 30;
const SMART_CHART_WHEEL_DELTA_PER_STEP = 70;
const SMART_CHART_Y_PADDING_RATIO = 0.12;
const AXIS_COMPACT_FORMATTER = new Intl.NumberFormat(undefined, {
  notation: 'compact',
  maximumFractionDigits: 1,
});

function clampValue(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function readNumericValue(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function readDatasetPointValue(point, axis = 'y') {
  if (point === null || point === undefined) return null;
  if (typeof point === 'number') return Number.isFinite(point) ? point : null;
  if (typeof point === 'object') {
    return readNumericValue(point[axis]);
  }
  return readNumericValue(point);
}

function getNiceNumber(value, round = true) {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const exponent = Math.floor(Math.log10(value));
  const fraction = value / 10 ** exponent;
  let niceFraction = 1;
  if (round) {
    if (fraction < 1.5) {
      niceFraction = 1;
    } else if (fraction < 3) {
      niceFraction = 2;
    } else if (fraction < 7) {
      niceFraction = 5;
    } else {
      niceFraction = 10;
    }
  } else if (fraction <= 1) {
    niceFraction = 1;
  } else if (fraction <= 2) {
    niceFraction = 2;
  } else if (fraction <= 5) {
    niceFraction = 5;
  } else {
    niceFraction = 10;
  }
  return niceFraction * 10 ** exponent;
}

function computeNiceAxisRange(values, { targetTicks = SMART_CHART_TARGET_TICKS } = {}) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  if (!Number.isFinite(minValue) || !Number.isFinite(maxValue)) return null;
  const allNonNegative = values.every((value) => value >= 0);
  let workingMin = minValue;
  let workingMax = maxValue;
  if (workingMin === workingMax) {
    const pad = Math.max(Math.abs(workingMin) * 0.1, 1);
    workingMin -= pad;
    workingMax += pad;
  } else {
    const pad = (workingMax - workingMin) * SMART_CHART_Y_PADDING_RATIO;
    workingMin -= pad;
    workingMax += pad;
  }
  const safeTargetTicks = Math.max(3, Math.floor(targetTicks));
  const roughStep = (workingMax - workingMin) / Math.max(safeTargetTicks - 1, 1);
  const stepSize = getNiceNumber(roughStep, true);
  let niceMin = Math.floor(workingMin / stepSize) * stepSize;
  let niceMax = Math.ceil(workingMax / stepSize) * stepSize;
  if (allNonNegative && niceMin < 0) {
    niceMin = 0;
  }
  if (niceMax <= niceMin) {
    niceMax = niceMin + stepSize;
  }
  return { min: niceMin, max: niceMax, stepSize };
}

function formatSmartAxisTick(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return value;
  const abs = Math.abs(numeric);
  if (abs >= 1000) {
    return AXIS_COMPACT_FORMATTER.format(numeric);
  }
  if (abs >= 10) {
    return Math.round(numeric);
  }
  if (abs >= 1) {
    return Math.round(numeric * 10) / 10;
  }
  return Math.round(numeric * 100) / 100;
}

function cleanupSmartViewportListeners(chart) {
  if (typeof chart?.$smartViewportCleanup === 'function') {
    chart.$smartViewportCleanup();
  }
  chart.$smartViewportCleanup = null;
}

function setSmartViewportStart(chart, nextStart) {
  const viewport = chart?.$smartViewportState;
  if (!viewport || !viewport.active) return false;
  const clamped = clampValue(Math.round(nextStart), 0, viewport.maxStart);
  if (clamped === viewport.start) return false;
  viewport.start = clamped;
  chart.update('none');
  return true;
}

function ensureSmartViewportListeners(chart, pluginOptions) {
  if (!chart?.canvas || chart.$smartViewportCleanup) return;
  const canvas = chart.canvas;
  const allowWheel = pluginOptions?.wheelPan !== false;
  const allowDrag = pluginOptions?.dragPan !== false;
  const onWheel = (event) => {
    if (!allowWheel) return;
    const viewport = chart.$smartViewportState;
    if (!viewport?.active) return;
    const delta = event.deltaX || event.deltaY;
    if (!delta) return;
    event.preventDefault();
    const step = Math.max(1, Math.round(Math.abs(delta) / SMART_CHART_WHEEL_DELTA_PER_STEP));
    const direction = Math.sign(delta);
    setSmartViewportStart(chart, viewport.start + direction * step);
  };
  const onPointerDown = (event) => {
    if (!allowDrag) return;
    const viewport = chart.$smartViewportState;
    if (!viewport?.active) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    viewport.dragging = true;
    viewport.dragStartX = event.clientX;
    viewport.dragStartIndex = viewport.start;
    canvas.style.cursor = 'grabbing';
    event.preventDefault();
  };
  const onPointerMove = (event) => {
    if (!allowDrag) return;
    const viewport = chart.$smartViewportState;
    if (!viewport?.dragging) return;
    const delta = event.clientX - viewport.dragStartX;
    const step = Math.round(delta / SMART_CHART_DRAG_PIXELS_PER_STEP);
    setSmartViewportStart(chart, viewport.dragStartIndex - step);
    event.preventDefault();
  };
  const stopDragging = () => {
    const viewport = chart.$smartViewportState;
    if (viewport) {
      viewport.dragging = false;
    }
    if (chart?.$smartViewportState?.active) {
      canvas.style.cursor = 'grab';
    } else {
      canvas.style.cursor = 'default';
    }
  };
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', stopDragging);
  window.addEventListener('pointercancel', stopDragging);
  chart.$smartViewportCleanup = () => {
    canvas.removeEventListener('wheel', onWheel);
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', stopDragging);
    window.removeEventListener('pointercancel', stopDragging);
    canvas.style.cursor = 'default';
  };
}

function getVisibleAxisValues(chart, axisId, viewport) {
  const datasets = Array.isArray(chart?.data?.datasets) ? chart.data.datasets : [];
  const values = [];
  datasets.forEach((dataset) => {
    const yAxisId = dataset?.yAxisID || 'y';
    if (yAxisId !== axisId) return;
    const points = Array.isArray(dataset?.data) ? dataset.data : [];
    if (!points.length) return;
    if (viewport?.active && Number.isFinite(viewport.start) && Number.isFinite(viewport.end)) {
      for (let index = viewport.start; index <= viewport.end; index += 1) {
        if (index < 0 || index >= points.length) continue;
        const value = readDatasetPointValue(points[index], 'y');
        if (Number.isFinite(value)) {
          values.push(value);
        }
      }
      return;
    }
    points.forEach((point) => {
      const value = readDatasetPointValue(point, 'y');
      if (Number.isFinite(value)) {
        values.push(value);
      }
    });
  });
  return values;
}

function applySmartYScales(chart, pluginOptions, viewport) {
  const scales = chart?.options?.scales;
  if (!scales || typeof scales !== 'object') return;
  const datasets = Array.isArray(chart?.data?.datasets) ? chart.data.datasets : [];
  const axisIds = new Set(
    datasets.map((dataset) => dataset?.yAxisID || 'y').filter((axisId) => typeof axisId === 'string')
  );
  if (!axisIds.size && scales.y) {
    axisIds.add('y');
  }
  axisIds.forEach((axisId) => {
    const axisConfig = scales[axisId];
    if (!axisConfig || typeof axisConfig !== 'object') return;
    const axis = axisConfig.axis || (axisId === 'x' ? 'x' : 'y');
    if (axis !== 'y') return;
    const values = getVisibleAxisValues(chart, axisId, viewport);
    if (!values.length) return;
    const range = computeNiceAxisRange(values, {
      targetTicks: Math.max(
        3,
        Math.floor(Number(pluginOptions?.targetTicks) || SMART_CHART_TARGET_TICKS)
      ),
    });
    if (!range) return;
    axisConfig.min = range.min;
    axisConfig.max = range.max;
  });
}

const SMART_VIEWPORT_PLUGIN = {
  id: 'smartViewport',
  beforeUpdate(chart, _args, pluginOptions) {
    if (!pluginOptions || pluginOptions.enabled !== true) {
      cleanupSmartViewportListeners(chart);
      return;
    }
    const scales = chart?.options?.scales || {};
    const xScale = scales.x;
    const labels = Array.isArray(chart?.data?.labels) ? chart.data.labels : [];
    const xType = xScale?.type || 'category';
    const isCategoryScale = xType === 'category' && labels.length > 0;
    const maxVisible = Math.max(
      4,
      Math.floor(Number(pluginOptions.maxVisiblePoints) || SMART_CHART_MAX_VISIBLE_POINTS)
    );
    const totalPoints = labels.length;
    const visiblePoints = isCategoryScale ? Math.min(totalPoints, maxVisible) : totalPoints;
    const maxStart = Math.max(totalPoints - visiblePoints, 0);
    const viewport = chart.$smartViewportState || {};
    const previousStart = Number(viewport.start);
    const start = Number.isFinite(previousStart) ? clampValue(previousStart, 0, maxStart) : maxStart;
    const end = visiblePoints > 0 ? start + visiblePoints - 1 : 0;
    viewport.start = start;
    viewport.end = end;
    viewport.maxStart = maxStart;
    viewport.active = isCategoryScale && totalPoints > visiblePoints;
    chart.$smartViewportState = viewport;

    if (xScale && typeof xScale === 'object') {
      if (isCategoryScale && totalPoints > visiblePoints) {
        xScale.min = start;
        xScale.max = end;
      } else {
        xScale.min = undefined;
        xScale.max = undefined;
      }
    }

    if (chart.$smartViewportState.active && pluginOptions.panX !== false) {
      ensureSmartViewportListeners(chart, pluginOptions);
      if (chart.canvas) {
        chart.canvas.style.cursor = 'grab';
      }
    } else {
      cleanupSmartViewportListeners(chart);
    }

    applySmartYScales(chart, pluginOptions, chart.$smartViewportState);
  },
  afterDestroy(chart) {
    cleanupSmartViewportListeners(chart);
  },
};

if (Chart) {
  Chart.register(SMART_VIEWPORT_PLUGIN);
}

function getSmartViewportOptions(overrides = {}) {
  return {
    enabled: true,
    panX: true,
    wheelPan: true,
    dragPan: true,
    maxVisiblePoints: SMART_CHART_MAX_VISIBLE_POINTS,
    targetTicks: SMART_CHART_TARGET_TICKS,
    ...overrides,
  };
}

const DEFAULT_HEIGHT_CM = 175;
const WEIGHT_HEIGHT_STORAGE_KEY = 'msml.weight.height';
let weightHeightSettings = loadWeightHeightSettings();
const ACTIVITY_WIDGET_GOALS_STORAGE_KEY = 'msml.activityWidgetGoals';
const ACTIVITY_WIDGET_DEFAULT_GOALS = {
  distanceKm: 25,
  durationMin: 150,
};
const ACTIVITY_WIDGET_GOAL_NOTE_DEFAULT = 'These targets are saved in this browser.';
const ACTIVITY_WIDGET_GOAL_NOTE_PENDING = 'Press Save targets to apply these goals.';
const ACTIVITY_WIDGET_GOAL_NOTE_SAVED = 'Targets saved in this browser.';
const ACTIVITY_WIDGET_GOAL_NOTE_INVALID = 'Enter positive targets for distance and duration.';
const ACTIVITY_WIDGET_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function sanitizeActivityWidgetGoal(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function normalizeActivityWidgetGoals(goals = {}) {
  return {
    distanceKm: sanitizeActivityWidgetGoal(
      goals?.distanceKm,
      ACTIVITY_WIDGET_DEFAULT_GOALS.distanceKm
    ),
    durationMin: sanitizeActivityWidgetGoal(
      goals?.durationMin,
      ACTIVITY_WIDGET_DEFAULT_GOALS.durationMin
    ),
  };
}

function loadActivityWidgetGoals() {
  try {
    const raw = window.localStorage?.getItem(ACTIVITY_WIDGET_GOALS_STORAGE_KEY);
    if (!raw) {
      return normalizeActivityWidgetGoals();
    }
    const parsed = JSON.parse(raw);
    return normalizeActivityWidgetGoals(parsed);
  } catch (error) {
    return normalizeActivityWidgetGoals();
  }
}

function persistActivityWidgetGoals(goals) {
  try {
    window.localStorage?.setItem(ACTIVITY_WIDGET_GOALS_STORAGE_KEY, JSON.stringify(goals));
  } catch (error) {
    // Ignore storage failures for optional preview settings.
  }
}

const state = {
  token: null,
  user: null,
  charts: {},
  viewing: null,
  subject: null,
  roster: [],
  coaches: [],
  coachesLoaded: false,
  nutrition: {
    date: null,
    goals: null,
    dailyTotals: null,
    entries: [],
    monthTrend: [],
  },
  nutritionAmountBaseline: null,
  nutritionAmountReference: null,
  nutritionMacroReference: null,
  nutritionResolvedSelection: null,
  nutritionCustomMode: false,
  nutritionSuggestionStatus: 'idle',
  nutritionEntryFilter: 'all',
  nutritionLogShouldScrollToTop: false,
  nutritionDeletingEntries: new Set(),
  nutritionPendingDeletes: new Map(),
  nutritionPhotoData: null,
  nutritionPhotoPreparing: false,
  nutritionPhotoAnalyzing: false,
  nutritionPhotoAnalysis: null,
  nutritionMealDraft: null,
  nutritionMealDraftLookupPendingIds: new Set(),
  suggestionTimer: null,
  suggestionQuery: '',
  suggestions: [],
  activeSuggestionIndex: -1,
  hydrationEntries: [],
  macroTargetExpanded: false,
  activity: {
    summary: null,
    sessions: [],
    splits: {},
    bestEfforts: [],
    strava: null,
    selectedSessionId: null,
    subjectId: null,
    widgetGoals: loadActivityWidgetGoals(),
  },
  vitals: {
    latest: null,
    timeline: [],
    stats: null,
  },
  weight: {
    timeline: [],
    recent: [],
    latest: null,
    stats: null,
    goalCalories: null,
    heightCm: resolveStoredHeight(null),
  },
  overview: {
    summary: null,
    timeline: [],
    sleepStages: null,
    goals: {
      steps: null,
      calories: null,
      sleep: 8,
    },
  },
  currentPage: 'overview',
};

const DEMO_ACTIVITY = {
  summary: {
    weeklyDistanceKm: 52.4,
    weeklyDurationMin: 392,
    avgPaceSeconds: 298,
    longestRunKm: 21.1,
    longestRunName: 'Long progression',
    trainingLoad: 325,
    vo2maxEstimate: 56.3,
  },
  sessions: [
    {
      id: 9101,
      startTime: '2024-03-18T07:10:00Z',
      sportType: 'Run',
      name: 'Tempo pyramid',
      distance: 14000,
      averagePace: 280,
      averageHr: 162,
      trainingLoad: 85,
    },
    {
      id: 9102,
      startTime: '2024-03-17T18:00:00Z',
      sportType: 'Run',
      name: 'Mobility shakeout',
      distance: 6000,
      averagePace: 325,
      averageHr: 144,
      trainingLoad: 38,
    },
    {
      id: 9103,
      startTime: '2024-03-16T08:30:00Z',
      sportType: 'Run',
      name: 'Long progression',
      distance: 24000,
      averagePace: 300,
      averageHr: 153,
      trainingLoad: 118,
    },
  ],
  splits: {
    9101: [
      { splitIndex: 1, distance: 2000, pace: 280, heartRate: 158, elevation: 8 },
      { splitIndex: 2, distance: 3000, pace: 272, heartRate: 164, elevation: 16 },
      { splitIndex: 3, distance: 4000, pace: 268, heartRate: 168, elevation: 22 },
    ],
    9103: [
      { splitIndex: 1, distance: 5000, pace: 310, heartRate: 146, elevation: 18 },
      { splitIndex: 2, distance: 5000, pace: 305, heartRate: 149, elevation: 22 },
      { splitIndex: 3, distance: 5000, pace: 295, heartRate: 152, elevation: 30 },
      { splitIndex: 4, distance: 4500, pace: 285, heartRate: 156, elevation: 28 },
      { splitIndex: 5, distance: 4500, pace: 278, heartRate: 160, elevation: 35 },
    ],
  },
  bestEfforts: [
    { label: '5K benchmark', distance: 5000, paceSeconds: 260, startTime: '2024-03-10T09:00:00Z' },
    { label: 'Half marathon', distance: 21097, paceSeconds: 295, startTime: '2024-03-02T07:30:00Z' },
  ],
  charts: {
    mileageTrend: [
      { startTime: '2024-03-12T00:00:00Z', distanceKm: 7.2, movingMinutes: 38 },
      { startTime: '2024-03-13T00:00:00Z', distanceKm: 9.8, movingMinutes: 49 },
      { startTime: '2024-03-14T00:00:00Z', distanceKm: 11.4, movingMinutes: 55 },
      { startTime: '2024-03-15T00:00:00Z', distanceKm: 8.6, movingMinutes: 43 },
      { startTime: '2024-03-16T00:00:00Z', distanceKm: 24, movingMinutes: 118 },
      { startTime: '2024-03-17T00:00:00Z', distanceKm: 6, movingMinutes: 32 },
      { startTime: '2024-03-18T00:00:00Z', distanceKm: 14, movingMinutes: 68 },
    ],
    heartRatePace: [
      { label: 'Steady state', paceSeconds: 300, heartRate: 150 },
      { label: 'Tempo', paceSeconds: 278, heartRate: 164 },
      { label: 'Intervals', paceSeconds: 255, heartRate: 172 },
      { label: 'Long run', paceSeconds: 315, heartRate: 142 },
    ],
  },
  strava: {
    connected: false,
    enabled: true,
    configured: true,
    requiresSetup: false,
    usingServerDefaults: true,
    canManage: false,
  },
};

const DEMO_VITALS = {
  latest: {
    restingHr: 48,
    hrvScore: 108,
    spo2: 98,
    stressScore: 23,
    systolic: 118,
    diastolic: 70,
    glucose: 92,
  },
  timeline: [
    { date: '2024-03-12', restingHr: 51, hrvScore: 102, spo2: 97, stressScore: 24 },
    { date: '2024-03-13', restingHr: 50, hrvScore: 104, spo2: 98, stressScore: 23 },
    { date: '2024-03-14', restingHr: 49, hrvScore: 106, spo2: 97, stressScore: 22 },
    { date: '2024-03-15', restingHr: 48, hrvScore: 109, spo2: 98, stressScore: 21 },
    { date: '2024-03-16', restingHr: 47, hrvScore: 111, spo2: 99, stressScore: 22 },
  ],
  stats: {
    window: 7,
    restingHrDelta: -2,
    restingHrAvg: 50,
    hrvAvg: 105,
    spo2Avg: 97,
    stressAvg: 24,
    systolicAvg: 119,
    diastolicAvg: 71,
    glucoseAvg: 94,
  },
};

const cloneDemoData = (value) => JSON.parse(JSON.stringify(value));

const QUICK_SUGGESTIONS = [
  {
    id: 'quick-water',
    name: 'Water (500 ml)',
    serving: '500 ml',
    source: 'Quick add',
    prefill: {
      type: 'Liquid',
      calories: 0,
      protein: 0,
      carbs: 0,
      fats: 0,
      weightAmount: 500,
      weightUnit: 'ml',
    },
  },
  {
    id: 'quick-diet-coke',
    name: 'Diet Coke (can)',
    serving: '355 ml',
    source: 'Quick add',
    prefill: {
      type: 'Liquid',
      calories: 0,
      protein: 0,
      carbs: 0,
      fats: 0,
      weightAmount: 355,
      weightUnit: 'ml',
      barcode: '049000050103',
    },
  },
  {
    id: 'quick-greek-yogurt',
    name: 'Greek Yogurt (200 g)',
    serving: '200 g',
    source: 'Quick add',
    prefill: {
      type: 'Food',
      calories: 146,
      protein: 15,
      carbs: 8,
      fats: 4,
      weightAmount: 200,
      weightUnit: 'g',
    },
  },
  {
    id: 'quick-chicken-breast',
    name: 'Chicken Breast (150 g)',
    serving: '150 g',
    source: 'Quick add',
    prefill: {
      type: 'Food',
      calories: 248,
      protein: 46,
      carbs: 0,
      fats: 5,
      weightAmount: 150,
      weightUnit: 'g',
    },
  },
  {
    id: 'quick-oatmeal',
    name: 'Oatmeal (1 cup cooked)',
    serving: '240 g',
    source: 'Quick add',
    prefill: {
      type: 'Food',
      calories: 160,
      protein: 6,
      carbs: 27,
      fats: 3,
      weightAmount: 240,
      weightUnit: 'g',
    },
  },
];

const SESSION_STORAGE_KEY = 'msml:lifestyle:session';
const storage = (() => {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
  } catch (error) {
    // Local storage is unavailable (private mode or disabled); fall back to in-memory only.
  }
  return null;
})();

const RECENT_NUTRITION_KEY = 'msml:nutrition:recent';
const MAX_RECENT_NUTRITION = 5;

function loadRecentNutritionItems() {
  try {
    const raw = storage?.getItem(RECENT_NUTRITION_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveRecentNutritionItem(item) {
  if (!item?.name) return;
  try {
    const recent = loadRecentNutritionItems().filter((r) => r.name !== item.name);
    recent.unshift(item);
    storage?.setItem(RECENT_NUTRITION_KEY, JSON.stringify(recent.slice(0, MAX_RECENT_NUTRITION)));
  } catch {}
}

function persistSession(session) {
  if (!storage || !session?.token || !session?.user) {
    return;
  }
  try {
    storage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({
        token: session.token,
        user: session.user,
        savedAt: new Date().toISOString(),
      })
    );
  } catch (error) {
    console.warn('Unable to persist session', error);
  }
}

function readPersistedSession() {
  if (!storage) {
    return null;
  }
  try {
    const raw = storage.getItem(SESSION_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    if (!parsed?.token || !parsed?.user) {
      storage.removeItem(SESSION_STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch (error) {
    console.warn('Unable to read session from storage', error);
    storage.removeItem(SESSION_STORAGE_KEY);
    return null;
  }
}

function clearPersistedSession() {
  if (!storage) {
    return;
  }
  try {
    storage.removeItem(SESSION_STORAGE_KEY);
  } catch (error) {
    // Ignore storage errors; UI will fall back to auth screen.
  }
}

const loginForm = document.getElementById('loginForm');
const signupForm = document.getElementById('signupForm');
const loginPanel = document.getElementById('loginPanel');
const loginFeedback = document.getElementById('loginFeedback');
const signupFeedback = document.getElementById('signupFeedback');
const dashboard = document.getElementById('dashboard');
const greeting = document.getElementById('greeting');
const readinessHeadline = document.getElementById('readinessHeadline');
const profileCard = document.getElementById('profileCard');
const pageTitle = document.getElementById('pageTitle');
const pageSubtitle = document.getElementById('pageSubtitle');
const appSidebar = document.getElementById('appSidebar');
const sidebarToggle = document.getElementById('sidebarToggle');
const sidebarBackdrop = document.getElementById('sidebarBackdrop');
const sideNav = document.getElementById('sideNav');
const pageContainers = document.querySelectorAll('[data-subpage]');
const authTabs = document.getElementById('authTabs');
const logoutButton = document.getElementById('logoutButton');
const avatarValueInput = document.getElementById('avatarValue');
const customAvatarInput = document.getElementById('customAvatarInput');
const avatarOptionButtons = Array.from(document.querySelectorAll('[data-avatar-option]'));
const coachPanel = document.getElementById('coachPanel');
const coachRanking = document.getElementById('coachRanking');
const athleteSwitcher = document.getElementById('athleteSwitcher');
const viewingChip = document.getElementById('viewingChip');
const sharePanel = document.getElementById('sharePanel');
const shareForm = document.getElementById('shareForm');
const shareEmailInput = document.getElementById('shareEmail');
const shareFeedback = document.getElementById('shareFeedback');
const shareCoachSelect = document.getElementById('shareCoachSelect');
const shareDisabledMessage = document.getElementById('shareDisabledMessage');
const vitalsRestingHrValue = document.getElementById('vitalsRestingHr');
const vitalsRestingHrNote = document.getElementById('vitalsRestingHrNote');
const vitalsHrvValue = document.getElementById('vitalsHrv');
const vitalsSpo2Value = document.getElementById('vitalsSpo2');
const vitalsStressValue = document.getElementById('vitalsStress');
const vitalsBloodPressureValue = document.getElementById('vitalsBloodPressure');
const vitalsBloodPressureNote = document.getElementById('vitalsBloodPressureNote');
const vitalsGlucoseValue = document.getElementById('vitalsGlucose');
const vitalsGlucoseNote = document.getElementById('vitalsGlucoseNote');
const vitalsHistoryList = document.getElementById('vitalsHistory');
const vitalsFeedback = document.getElementById('vitalsFeedback');
const nutritionGoalList = document.getElementById('nutritionGoalList');
const nutritionEntriesList = document.getElementById('nutritionEntriesList');
const nutritionMonthList = document.getElementById('nutritionMonthList');
const nutritionDateLabel = document.getElementById('nutritionDateLabel');
const nutritionDatePrimary = document.getElementById('nutritionDatePrimary');
const nutritionDateSubtitle = document.getElementById('nutritionDateSubtitle');
const nutritionLogDateLabel = document.getElementById('nutritionLogDateLabel');
const nutritionEntryCount = document.getElementById('nutritionEntryCount');
const nutritionPrevDayButton = document.getElementById('nutritionPrevDay');
const nutritionNextDayButton = document.getElementById('nutritionNextDay');
const nutritionTodayButton = document.getElementById('nutritionTodayButton');
const nutritionDateInput = document.getElementById('nutritionDateInput');
const nutritionLogSummary = document.getElementById('nutritionLogSummary');
const nutritionEntryFilters = document.getElementById('nutritionEntryFilters');
const nutritionForm = document.getElementById('nutritionForm');
const nutritionFeedback = document.getElementById('nutritionFeedback');
const nutritionNameInput = document.getElementById('nutritionName');
const nutritionBarcodeInput = document.getElementById('nutritionBarcode');
const nutritionTypeSelect = document.getElementById('nutritionType');
const nutritionCaloriesInput = document.getElementById('nutritionCalories');
const nutritionProteinInput = document.getElementById('nutritionProtein');
const nutritionCarbsInput = document.getElementById('nutritionCarbs');
const nutritionFatsInput = document.getElementById('nutritionFats');
const nutritionFiberInput = document.getElementById('nutritionFiber');
const nutritionFormHint = document.getElementById('nutritionFormHint');
const nutritionLookupButton = document.getElementById('nutritionLookupButton');
const nutritionAmountInput = document.getElementById('nutritionAmount');
const nutritionAmountLabel = document.getElementById('nutritionAmountLabel');
const nutritionAmountReferenceText = document.getElementById('nutritionAmountReference');
const nutritionUnitSelect = document.getElementById('nutritionUnit');

if (typeof document !== 'undefined' && document.body && sidebarToggle) {
  document.body.classList.add('sidebar-enhanced');
}
const nutritionSuggestions = document.getElementById('nutritionSuggestions');
const nutritionSuggestionBar = document.getElementById('nutritionSuggestionBar');
const nutritionPreview = document.getElementById('nutritionPreview');
const nutritionClearButton = document.getElementById('nutritionClearButton');
const nutritionCustomToggle = document.getElementById('nutritionCustomToggle');
const nutritionCustomPanel = document.getElementById('nutritionCustomPanel');
const nutritionMatchCard = document.getElementById('nutritionMatchCard');
const nutritionMatchName = document.getElementById('nutritionMatchName');
const nutritionMatchMeta = document.getElementById('nutritionMatchMeta');
const nutritionMatchDerived = document.getElementById('nutritionMatchDerived');
const nutritionMatchChangeButton = document.getElementById('nutritionMatchChangeButton');
const nutritionScanButton = document.getElementById('nutritionScanButton');
const nutritionScanStatus = document.getElementById('nutritionScanStatus');
const nutritionScanPreviewWrapper = document.getElementById('nutritionScanPreviewWrapper');
const nutritionScanPreview = document.getElementById('nutritionScanPreview');
const nutritionPhotoInput = document.getElementById('nutritionPhotoInput');
const nutritionPhotoButton = document.getElementById('nutritionPhotoButton');
const nutritionPhotoClearButton = document.getElementById('nutritionPhotoClearButton');
const nutritionPhotoStatus = document.getElementById('nutritionPhotoStatus');
const nutritionPhotoPreviewWrapper = document.getElementById('nutritionPhotoPreviewWrapper');
const nutritionPhotoPreview = document.getElementById('nutritionPhotoPreview');
const nutritionPhotoAnalysis = document.getElementById('nutritionPhotoAnalysis');
const nutritionPhotoDropZone = document.getElementById('nutritionPhotoDropZone');
const macroTargetToggleButton = document.getElementById('macroTargetToggle');
const macroTargetForm = document.getElementById('macroTargetForm');
const macroTargetDateInput = document.getElementById('macroTargetDate');
const macroTargetCaloriesInput = document.getElementById('macroTargetCalories');
const macroTargetProteinInput = document.getElementById('macroTargetProtein');
const macroTargetCarbsInput = document.getElementById('macroTargetCarbs');
const macroTargetFatsInput = document.getElementById('macroTargetFats');
const macroTargetResetButton = document.getElementById('macroTargetResetButton');
const macroTargetFeedback = document.getElementById('macroTargetFeedback');
const macroTargetFormHint = document.getElementById('macroTargetFormHint');
const nutritionInsightSelect = document.getElementById('nutritionInsightSelect');
const nutritionInsightSummary = document.getElementById('nutritionInsightSummary');
const nutritionInsightFlag = document.getElementById('nutritionInsightFlag');
const defaultScanStatusMessage = nutritionScanStatus?.textContent || '';
const barcodeScanButtonLabel = 'Scan with browser camera';
const barcodeStopButtonLabel = 'Stop camera scan';
const appLoadingScreen = document.getElementById('appLoadingScreen');
const forgotForm = document.getElementById('forgotForm');
const forgotEmailInput = document.getElementById('forgotEmail');
const forgotFeedback = document.getElementById('forgotFeedback');
const forgotPasswordButton = document.getElementById('forgotPasswordButton');
const backToLoginButtons = document.querySelectorAll('[data-auth-back]');
const adminPanel = document.getElementById('adminPanel');
const adminUserSelect = document.getElementById('adminUserSelect');
const promoteButton = document.getElementById('promoteButton');
const demoteButton = document.getElementById('demoteButton');
const adminPasswordInput = document.getElementById('adminPasswordInput');
const resetPasswordButton = document.getElementById('resetPasswordButton');
const deleteButton = document.getElementById('deleteButton');
const adminFeedback = document.getElementById('adminFeedback');
const profileForm = document.getElementById('profileForm');
const profileNameInput = document.getElementById('profileName');
const profileWeightCategorySelect = document.getElementById('profileWeightCategory');
const profileEmailInput = document.getElementById('profileEmail');
const profilePasswordInput = document.getElementById('profilePassword');
const profileCurrentPasswordInput = document.getElementById('profileCurrentPassword');
const profileFeedback = document.getElementById('profileFeedback');
const profileStravaClientIdInput = document.getElementById('profileStravaClientId');
const profileStravaClientSecretInput = document.getElementById('profileStravaClientSecret');
const profileStravaRedirectUriInput = document.getElementById('profileStravaRedirectUri');
const profileAvatarUrlInput = document.getElementById('profileAvatarUrl');
const profileAvatarUploadInput = document.getElementById('profileAvatarUpload');
const profileAvatarClearButton = document.getElementById('profileAvatarClear');
const profileAvatarPreview = document.getElementById('profileAvatarPreview');
const profileAvatarFallback = document.getElementById('profileAvatarFallback');
const profileAvatarStatus = document.getElementById('profileAvatarStatus');
const activitySummaryGrid = document.getElementById('activitySummaryGrid');
const activityWeeklyDistance = document.getElementById('activityWeeklyDistance');
const activityWeeklyDuration = document.getElementById('activityWeeklyDuration');
const activityAvgPace = document.getElementById('activityAvgPace');
const activityLongestRun = document.getElementById('activityLongestRun');
const activityLongestRunLabel = document.getElementById('activityLongestRunLabel');
const activityWidgetPercent = document.getElementById('activityWidgetPercent');
const activityWidgetStatus = document.getElementById('activityWidgetStatus');
const activityWidgetLoad = document.getElementById('activityWidgetLoad');
const activityWidgetDistance = document.getElementById('activityWidgetDistance');
const activityWidgetDuration = document.getElementById('activityWidgetDuration');
const activityWidgetDistanceBar = document.getElementById('activityWidgetDistanceBar');
const activityWidgetDurationBar = document.getElementById('activityWidgetDurationBar');
const activityWidgetDistanceGoalInput = document.getElementById('activityWidgetDistanceGoal');
const activityWidgetDurationGoalInput = document.getElementById('activityWidgetDurationGoal');
const activityWidgetSaveGoalsButton = document.getElementById('activityWidgetSaveGoals');
const activityWidgetGoalNote = document.getElementById('activityWidgetGoalNote');
const sleepHoursPrimary = document.getElementById('sleepHoursPrimary');
const sleepGoalCopy = document.getElementById('sleepGoalCopy');
const sleepGoalInput = document.getElementById('sleepGoalInput');
const sleepTrendCopy = document.getElementById('sleepTrendCopy');
const sleepReadinessCopy = document.getElementById('sleepReadinessCopy');
const sleepHeroHint = document.getElementById('sleepHeroHint');
const sleepStageBreakdown = document.getElementById('sleepStageBreakdown');
const overviewSyncCopy = document.getElementById('overviewSyncCopy');
const overviewSyncReadiness = document.getElementById('overviewSyncReadiness');
const overviewSyncReadinessNote = document.getElementById('overviewSyncReadinessNote');
const overviewSyncSteps = document.getElementById('overviewSyncSteps');
const overviewSyncStepsNote = document.getElementById('overviewSyncStepsNote');
const overviewSyncCalories = document.getElementById('overviewSyncCalories');
const overviewSyncCaloriesNote = document.getElementById('overviewSyncCaloriesNote');
const overviewSyncSleep = document.getElementById('overviewSyncSleep');
const overviewSyncSleepNote = document.getElementById('overviewSyncSleepNote');

let startupReady = false;
function markStartupReady() {
  if (startupReady) return;
  startupReady = true;
  if (document.body) {
    document.body.classList.remove('app-loading');
    document.body.setAttribute('aria-busy', 'false');
  }
  appLoadingScreen?.classList.add('hidden');
}

// Failsafe: if something in the startup chain hangs or throws before
// markStartupReady is reached, forcibly clear the loading screen after 10s.
setTimeout(markStartupReady, 10000);

function decodeBase64Sample(value) {
  if (!value || typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const chunkMax = Math.min(trimmed.length, 64);
  const normalizedLength = chunkMax - (chunkMax % 4) || chunkMax;
  const sample = trimmed.slice(0, normalizedLength);
  if (!sample) {
    return null;
  }
  const root = typeof globalThis !== 'undefined' ? globalThis : undefined;
  const decoder = root && typeof root.atob === 'function' ? root.atob.bind(root) : null;
  if (decoder) {
    try {
      return decoder(sample);
    } catch (error) {
      // Ignore and fall back to Buffer when available.
    }
  }
  if (typeof Buffer !== 'undefined') {
    try {
      return Buffer.from(sample, 'base64').toString('binary');
    } catch (error) {
      return null;
    }
  }
  return null;
}

function detectBase64ImageMime(photo) {
  if (!photo || typeof photo !== 'string') {
    return 'image/jpeg';
  }
  const trimmed = photo.trim();
  if (!trimmed) {
    return 'image/jpeg';
  }
  const prefix = trimmed.slice(0, 10);
  if (prefix.startsWith('/9j/')) return 'image/jpeg';
  if (prefix.startsWith('iVBOR')) return 'image/png';
  if (prefix.startsWith('R0lGOD')) return 'image/gif';
  if (prefix.startsWith('UklGR')) return 'image/webp';
  if (prefix.startsWith('Qk')) return 'image/bmp';

  const binary = decodeBase64Sample(trimmed);
  if (!binary || binary.length < 2) {
    return 'image/jpeg';
  }

  const byte0 = binary.charCodeAt(0);
  const byte1 = binary.charCodeAt(1);
  const byte2 = binary.charCodeAt(2);
  const byte3 = binary.charCodeAt(3);
  if (byte0 === 0x89 && byte1 === 0x50 && byte2 === 0x4e && byte3 === 0x47) {
    return 'image/png';
  }
  if (binary.startsWith('GIF8')) {
    return 'image/gif';
  }
  if (binary.startsWith('BM')) {
    return 'image/bmp';
  }
  if (
    byte0 === 0x52 &&
    byte1 === 0x49 &&
    byte2 === 0x46 &&
    byte3 === 0x46 &&
    binary.length >= 12 &&
    binary.slice(8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  if (byte0 === 0xff && byte1 === 0xd8) {
    return 'image/jpeg';
  }
  return 'image/jpeg';
}

function resolveAvatarSrc(entity) {
  if (!entity) return null;
  const photo = entity.avatar_photo || entity.avatarPhoto;
  if (photo && typeof photo === 'string') {
    const trimmed = photo.trim();
    if (trimmed) {
      if (trimmed.startsWith('data:image')) {
        return trimmed;
      }
      const mime = detectBase64ImageMime(trimmed);
      return `data:${mime};base64,${trimmed}`;
    }
  }
  const url = entity.avatar_url || entity.avatarUrl;
  return url || null;
}

function setProfileAvatarPreview(src) {
  if (profileAvatarPreview) {
    if (src) {
      profileAvatarPreview.src = src;
      profileAvatarPreview.classList.remove('hidden');
    } else {
      profileAvatarPreview.removeAttribute('src');
      profileAvatarPreview.classList.add('hidden');
    }
  }
  if (profileAvatarFallback) {
    profileAvatarFallback.classList.toggle('hidden', Boolean(src));
  }
}

function normalizeBase64ImageData(data) {
  if (typeof data !== 'string') {
    return '';
  }
  const trimmed = data.trim();
  if (!trimmed) {
    return '';
  }
  if (trimmed.startsWith('data:image')) {
    return trimmed.split(',').pop() || '';
  }
  return trimmed;
}

function isHeicLikeFile(file) {
  const mime = String(file?.type || '').toLowerCase();
  const name = String(file?.name || '').toLowerCase();
  return (
    mime.includes('heic') ||
    mime.includes('heif') ||
    name.endsWith('.heic') ||
    name.endsWith('.heif')
  );
}

function canTranscodeNutritionPhoto() {
  return (
    typeof document !== 'undefined' &&
    typeof document.createElement === 'function' &&
    typeof Image !== 'undefined'
  );
}

async function transcodeNutritionPhotoDataUrl(dataUrl, { maxDimension = 1600, quality = 0.86 } = {}) {
  if (typeof dataUrl !== 'string' || !dataUrl.trim().startsWith('data:image/')) {
    return normalizeBase64ImageData(dataUrl);
  }
  if (!canTranscodeNutritionPhoto()) {
    return normalizeBase64ImageData(dataUrl);
  }

  const image = new Image();
  image.decoding = 'async';
  await new Promise((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('image-load-failed'));
    image.src = dataUrl;
  });

  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight) || sourceWidth <= 0 || sourceHeight <= 0) {
    return normalizeBase64ImageData(dataUrl);
  }

  const targetMax = Number.isFinite(maxDimension) && maxDimension > 0 ? maxDimension : 1600;
  const scale = Math.min(1, targetMax / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) {
    return normalizeBase64ImageData(dataUrl);
  }
  context.drawImage(image, 0, 0, width, height);

  const normalizedQuality =
    Number.isFinite(quality) && quality > 0 && quality <= 1 ? Number(quality) : 0.86;
  const convertedDataUrl = canvas.toDataURL('image/jpeg', normalizedQuality);
  const converted = normalizeBase64ImageData(convertedDataUrl);
  return converted || normalizeBase64ImageData(dataUrl);
}

function getNutritionPhotoDataUri(photoData) {
  const normalized = normalizeBase64ImageData(photoData);
  if (!normalized) {
    return null;
  }
  const mime = detectBase64ImageMime(normalized);
  return `data:${mime};base64,${normalized}`;
}

function setNutritionPhotoStatus(message = '', { isError = false } = {}) {
  if (!nutritionPhotoStatus) return;
  const nextMessage = message || DEFAULT_NUTRITION_PHOTO_STATUS;
  nutritionPhotoStatus.textContent = nextMessage;
  nutritionPhotoStatus.classList.toggle('error', Boolean(isError));
}

function renderNutritionPhotoPreview() {
  const photoUri = getNutritionPhotoDataUri(state.nutritionPhotoData);
  if (nutritionPhotoPreview) {
    if (photoUri) {
      nutritionPhotoPreview.src = photoUri;
      nutritionPhotoPreview.classList.remove('hidden');
    } else {
      nutritionPhotoPreview.removeAttribute('src');
      nutritionPhotoPreview.classList.add('hidden');
    }
  }
  nutritionPhotoPreviewWrapper?.classList.toggle('hidden', !photoUri);
  nutritionPhotoClearButton?.classList.toggle('hidden', !photoUri);
}

function normalizeNutritionMealAnalysis(source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    return null;
  }

  const items = Array.isArray(source.items)
    ? source.items
        .map((entry) => {
          if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
            return null;
          }
          const name = typeof entry.name === 'string' ? entry.name.trim() : '';
          if (!name) {
            return null;
          }
          const confidence = Number(entry.confidence);
          return {
            name,
            confidence: Number.isFinite(confidence) ? Number(confidence.toFixed(4)) : null,
            calories: Number.isFinite(Number(entry.calories)) ? Number(entry.calories) : null,
            protein: Number.isFinite(Number(entry.protein)) ? Number(entry.protein) : null,
            carbs: Number.isFinite(Number(entry.carbs)) ? Number(entry.carbs) : null,
            fats: Number.isFinite(Number(entry.fats)) ? Number(entry.fats) : null,
            fiber: Number.isFinite(Number(entry.fiber)) ? Number(entry.fiber) : null,
            weightAmount: Number.isFinite(Number(entry.weightAmount)) ? Number(entry.weightAmount) : null,
            weightUnit: typeof entry.weightUnit === 'string' ? entry.weightUnit : 'g',
            portionPercent:
              Number.isFinite(Number(entry.portionPercent)) ? Number(entry.portionPercent) : null,
          };
        })
        .filter(Boolean)
    : [];

  if (!items.length && !Number.isFinite(Number(source.totalCalories))) {
    return null;
  }

  return {
    foodCount: Number.isFinite(Number(source.foodCount)) ? Number(source.foodCount) : items.length,
    totalCalories: Number.isFinite(Number(source.totalCalories)) ? Number(source.totalCalories) : null,
    totalProtein: Number.isFinite(Number(source.totalProtein)) ? Number(source.totalProtein) : null,
    totalCarbs: Number.isFinite(Number(source.totalCarbs)) ? Number(source.totalCarbs) : null,
    totalFats: Number.isFinite(Number(source.totalFats)) ? Number(source.totalFats) : null,
    totalFiber: Number.isFinite(Number(source.totalFiber)) ? Number(source.totalFiber) : null,
    totalWeightAmount:
      Number.isFinite(Number(source.totalWeightAmount)) ? Number(source.totalWeightAmount) : null,
    weightUnit: typeof source.weightUnit === 'string' ? source.weightUnit : 'g',
    plateDetected: source.plateDetected !== false,
    plateDiameterPx:
      Number.isFinite(Number(source.plateDiameterPx)) ? Number(source.plateDiameterPx) : null,
    mmPerPixel: Number.isFinite(Number(source.mmPerPixel)) ? Number(source.mmPerPixel) : null,
    items,
  };
}

function resolveNutritionMealAnalysis(result) {
  const direct = normalizeNutritionMealAnalysis(result?.mealAnalysis);
  if (direct) {
    return direct;
  }
  const nested = normalizeNutritionMealAnalysis(result?.photoAnalysis?.mealAnalysis);
  return nested;
}

function createNutritionMealDraftId() {
  return `meal-item-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function normalizeMealDraftNumber(value, fractionDigits = 1) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  const multiplier = 10 ** fractionDigits;
  return Math.round(numeric * multiplier) / multiplier;
}

function normalizeNutritionMealDraftItem(entry = {}, options = {}) {
  const type = entry.type === 'Liquid' || options.fallbackType === 'Liquid' ? 'Liquid' : 'Food';
  const requestedUnit =
    typeof entry.weightUnit === 'string' ? entry.weightUnit.trim().toLowerCase() : '';
  const weightUnit = MEAL_DRAFT_UNITS.has(requestedUnit) ? requestedUnit : getUnitForType(type);

  return {
    id: typeof entry.id === 'string' && entry.id ? entry.id : createNutritionMealDraftId(),
    name: typeof entry.name === 'string' ? entry.name : '',
    type,
    calories: normalizeMealDraftNumber(entry.calories, 1),
    protein: normalizeMealDraftNumber(entry.protein, 1),
    carbs: normalizeMealDraftNumber(entry.carbs, 1),
    fats: normalizeMealDraftNumber(entry.fats, 1),
    fiber: normalizeMealDraftNumber(entry.fiber, 1),
    weightAmount: normalizeMealDraftNumber(entry.weightAmount, 1),
    weightUnit,
    confidence: normalizeMealDraftNumber(entry.confidence, 4),
    portionPercent: normalizeMealDraftNumber(entry.portionPercent, 1),
    source: entry.source === 'manual' ? 'manual' : 'analysis',
  };
}

function cloneNutritionMealDraftItems(items = []) {
  return items.map((item) => ({ ...item }));
}

function calculateNutritionMealDraftSummary(draft) {
  const items = Array.isArray(draft?.items) ? draft.items : [];
  const summary = {
    foodCount: 0,
    totalCalories: null,
    totalProtein: null,
    totalCarbs: null,
    totalFats: null,
    totalFiber: null,
    totalWeightAmount: null,
    weightUnit: null,
    plateDetected: draft?.analysis?.plateDetected !== false,
    plateDiameterPx:
      Number.isFinite(Number(draft?.analysis?.plateDiameterPx)) ? Number(draft.analysis.plateDiameterPx) : null,
    mmPerPixel: Number.isFinite(Number(draft?.analysis?.mmPerPixel)) ? Number(draft.analysis.mmPerPixel) : null,
  };

  const totals = {
    calories: 0,
    protein: 0,
    carbs: 0,
    fats: 0,
    fiber: 0,
  };
  const seenTotals = {
    calories: false,
    protein: false,
    carbs: false,
    fats: false,
    fiber: false,
  };
  let totalWeightAmount = 0;
  let weightUnit = null;
  let mixedWeightUnits = false;
  let hasWeight = false;

  items.forEach((item) => {
    const hasContent =
      Boolean(item?.name?.trim()) ||
      Number.isFinite(item?.calories) ||
      Number.isFinite(item?.weightAmount) ||
      Number.isFinite(item?.protein) ||
      Number.isFinite(item?.carbs) ||
      Number.isFinite(item?.fats) ||
      Number.isFinite(item?.fiber);
    if (!hasContent) {
      return;
    }

    summary.foodCount += 1;

    ['calories', 'protein', 'carbs', 'fats', 'fiber'].forEach((field) => {
      const value = Number(item?.[field]);
      if (Number.isFinite(value)) {
        totals[field] += value;
        seenTotals[field] = true;
      }
    });

    const itemWeight = Number(item?.weightAmount);
    if (Number.isFinite(itemWeight)) {
      const itemWeightUnit = item?.weightUnit || getUnitForType(item?.type || 'Food');
      hasWeight = true;
      totalWeightAmount += itemWeight;
      if (!weightUnit) {
        weightUnit = itemWeightUnit;
      } else if (weightUnit !== itemWeightUnit) {
        mixedWeightUnits = true;
      }
    }
  });

  summary.totalCalories = seenTotals.calories ? normalizeMealDraftNumber(totals.calories, 1) : null;
  summary.totalProtein = seenTotals.protein ? normalizeMealDraftNumber(totals.protein, 1) : null;
  summary.totalCarbs = seenTotals.carbs ? normalizeMealDraftNumber(totals.carbs, 1) : null;
  summary.totalFats = seenTotals.fats ? normalizeMealDraftNumber(totals.fats, 1) : null;
  summary.totalFiber = seenTotals.fiber ? normalizeMealDraftNumber(totals.fiber, 1) : null;
  summary.totalWeightAmount =
    hasWeight && !mixedWeightUnits ? normalizeMealDraftNumber(totalWeightAmount, 1) : null;
  summary.weightUnit = hasWeight && !mixedWeightUnits ? weightUnit : null;

  return summary.foodCount ? summary : draft?.analysis || null;
}

function createNutritionMealDraft(analysis, suggestedItems = [], options = {}) {
  const fallbackType = options.fallbackType === 'Liquid' ? 'Liquid' : 'Food';
  const normalizedItems = (Array.isArray(suggestedItems) ? suggestedItems : [])
    .map((item) =>
      normalizeNutritionMealDraftItem(item, {
        fallbackType: item?.type || fallbackType,
      })
    )
    .filter(
      (item) =>
        item.name.trim() ||
        Number.isFinite(item.calories) ||
        Number.isFinite(item.weightAmount) ||
        Number.isFinite(item.protein) ||
        Number.isFinite(item.carbs) ||
        Number.isFinite(item.fats) ||
        Number.isFinite(item.fiber)
    );

  return {
    items: cloneNutritionMealDraftItems(normalizedItems),
    originalItems: cloneNutritionMealDraftItems(normalizedItems),
    analysis: normalizeNutritionMealAnalysis(analysis) || null,
    requiresReview: options.requiresReview === true,
  };
}

function getNutritionMealDraftSubmissionItems(items = []) {
  return items
    .map((item) => {
      const name = typeof item?.name === 'string' ? item.name.trim() : '';
      const type = item?.type === 'Liquid' ? 'Liquid' : 'Food';
      const weightUnit = MEAL_DRAFT_UNITS.has(item?.weightUnit)
        ? item.weightUnit
        : getUnitForType(type);
      const weightAmount = normalizeMealDraftNumber(item?.weightAmount, 1);
      const payload = {
        type,
        weightUnit,
      };
      if (name) {
        payload.name = name;
      }
      ['calories', 'protein', 'carbs', 'fats', 'fiber'].forEach((field) => {
        const value = normalizeMealDraftNumber(item?.[field], 1);
        if (Number.isFinite(value)) {
          payload[field] = value;
        }
      });
      if (Number.isFinite(weightAmount)) {
        payload.weightAmount = weightAmount;
      }
      return payload;
    })
    .filter((item) => item.name || Number.isFinite(item.calories));
}

function setNutritionMealDraft(draft) {
  state.nutritionMealDraftLookupPendingIds.clear();
  state.nutritionMealDraft =
    draft && typeof draft === 'object'
      ? {
          items: cloneNutritionMealDraftItems(draft.items || []),
          originalItems: cloneNutritionMealDraftItems(draft.originalItems || draft.items || []),
          analysis: normalizeNutritionMealAnalysis(draft.analysis) || null,
          requiresReview: draft.requiresReview === true,
        }
      : null;
  renderNutritionPhotoAnalysis();
}

function clearNutritionMealDraft() {
  state.nutritionMealDraftLookupPendingIds.clear();
  state.nutritionMealDraft = null;
  renderNutritionPhotoAnalysis();
}

function isNutritionMealDraftLookupPending(itemId) {
  return Boolean(itemId && state.nutritionMealDraftLookupPendingIds.has(itemId));
}

function duplicateNutritionMealDraftItem(index) {
  if (!state.nutritionMealDraft || !Array.isArray(state.nutritionMealDraft.items)) {
    return;
  }
  if (!Number.isInteger(index) || index < 0 || index >= state.nutritionMealDraft.items.length) {
    return;
  }

  const sourceItem = state.nutritionMealDraft.items[index];
  if (!sourceItem) {
    return;
  }

  const duplicate = normalizeNutritionMealDraftItem(
    {
      ...sourceItem,
      id: createNutritionMealDraftId(),
      source: 'manual',
    },
    { fallbackType: sourceItem.type }
  );

  const nextItems = [...state.nutritionMealDraft.items];
  nextItems.splice(index + 1, 0, duplicate);
  state.nutritionMealDraft.items = nextItems;
  renderNutritionPhotoAnalysis();
}

function mapLookupProductToMealDraftItem(product, fallbackType = 'Food') {
  if (!product || typeof product !== 'object') {
    return null;
  }

  const type =
    fallbackType === 'Liquid' || product.weightUnit === UNIT_LIQUID ? 'Liquid' : 'Food';
  let weightUnit = MEAL_DRAFT_UNITS.has(product.weightUnit) ? product.weightUnit : getUnitForType(type);
  let weightAmount = normalizeMealDraftNumber(product.weightAmount, 1);
  if (weightUnit === UNIT_PORTION && (!Number.isFinite(weightAmount) || weightAmount <= 0)) {
    weightAmount = 1;
  }

  return {
    name: typeof product.name === 'string' ? product.name : '',
    type,
    calories: normalizeMealDraftNumber(product.calories, 1),
    protein: normalizeMealDraftNumber(product.protein, 1),
    carbs: normalizeMealDraftNumber(product.carbs, 1),
    fats: normalizeMealDraftNumber(product.fats, 1),
    fiber: normalizeMealDraftNumber(product.fiber, 1),
    weightAmount,
    weightUnit,
  };
}

async function lookupNutritionMealDraftItem(index) {
  if (!state.token || !state.nutritionMealDraft || !Array.isArray(state.nutritionMealDraft.items)) {
    return;
  }
  if (!Number.isInteger(index) || index < 0 || index >= state.nutritionMealDraft.items.length) {
    return;
  }

  const item = state.nutritionMealDraft.items[index];
  const query = item?.name?.trim();
  if (!query) {
    setNutritionFeedback('Enter an item name before filling its macros.');
    return;
  }
  if (isNutritionMealDraftLookupPending(item.id)) {
    return;
  }

  state.nutritionMealDraftLookupPendingIds.add(item.id);
  renderNutritionPhotoAnalysis();
  setNutritionFeedback(`Looking up macros for ${query}...`);

  try {
    const response = await apiFetch(`/api/nutrition/lookup?q=${encodeURIComponent(query)}`, {
      headers: { Authorization: `Bearer ${state.token}` },
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.product) {
      throw new Error(payload?.message || 'No nutrition data found.');
    }

    const lookupItem = mapLookupProductToMealDraftItem(payload.product, item.type);
    if (!lookupItem) {
      throw new Error('No nutrition data found.');
    }

    state.nutritionMealDraft.items = state.nutritionMealDraft.items.map((draftItem, itemIndex) =>
      itemIndex === index
        ? normalizeNutritionMealDraftItem(
            {
              ...draftItem,
              ...lookupItem,
              source: draftItem.source,
            },
            { fallbackType: lookupItem.type || draftItem.type }
          )
        : draftItem
    );
    setNutritionFeedback(`Filled macros for ${lookupItem.name || query}.`, { tone: 'success' });
  } catch (error) {
    setNutritionFeedback(error.message);
  } finally {
    state.nutritionMealDraftLookupPendingIds.delete(item.id);
    renderNutritionPhotoAnalysis();
  }
}

function renderNutritionPhotoAnalysis() {
  if (!nutritionPhotoAnalysis) {
    return;
  }
  nutritionPhotoAnalysis.innerHTML = '';
  const analysis = state.nutritionPhotoAnalysis;
  const mealDraft = state.nutritionMealDraft;
  const activeSummary = mealDraft ? calculateNutritionMealDraftSummary(mealDraft) : analysis;
  const displayAnalysis = mealDraft?.analysis || analysis;

  if (!activeSummary && !mealDraft) {
    nutritionPhotoAnalysis.classList.add('hidden');
    return;
  }

  const summary = document.createElement('div');
  summary.className = 'nutrition-photo-analysis-summary';

  const title = document.createElement('strong');
  const titleCount = activeSummary?.foodCount || mealDraft?.items?.length || 0;
  title.textContent = `${mealDraft ? 'Editable meal' : 'Meal analysis'}${
    titleCount ? ` • ${titleCount} items` : ''
  }`;
  summary.appendChild(title);

  const totals = [];
  if (Number.isFinite(activeSummary?.totalCalories)) {
    totals.push(`${formatDecimal(activeSummary.totalCalories, 1)} kcal`);
  }
  if (Number.isFinite(activeSummary?.totalProtein)) {
    totals.push(`${formatDecimal(activeSummary.totalProtein, 1)} g protein`);
  }
  if (Number.isFinite(activeSummary?.totalCarbs)) {
    totals.push(`${formatDecimal(activeSummary.totalCarbs, 1)} g carbs`);
  }
  if (Number.isFinite(activeSummary?.totalFats)) {
    totals.push(`${formatDecimal(activeSummary.totalFats, 1)} g fats`);
  }
  if (Number.isFinite(activeSummary?.totalFiber)) {
    totals.push(`${formatDecimal(activeSummary.totalFiber, 1)} g fiber`);
  }
  if (Number.isFinite(activeSummary?.totalWeightAmount) && activeSummary?.weightUnit) {
    totals.push(
      `${formatDecimal(activeSummary.totalWeightAmount, 1)} ${activeSummary.weightUnit} total`
    );
  }

  const totalsText = document.createElement('span');
  totalsText.className = 'muted small-text';
  totalsText.textContent = totals.length
    ? totals.join(' • ')
    : mealDraft
      ? 'Add or edit items to build the meal totals.'
      : 'Meal analysis available.';
  summary.appendChild(totalsText);

  if (mealDraft) {
    const helper = document.createElement('span');
    helper.className = 'muted tiny-text nutrition-photo-analysis-hint';
    helper.textContent = mealDraft.requiresReview
      ? 'The model was not confident. Review the detected foods, fix macros, and add anything it missed.'
      : 'Review the detected foods, adjust the macros, and add anything the model missed before logging.';
    summary.appendChild(helper);
  }

  if (displayAnalysis?.plateDetected && Number.isFinite(displayAnalysis?.plateDiameterPx)) {
    const plateMeta = document.createElement('span');
    plateMeta.className = 'muted tiny-text';
    const scaleText = Number.isFinite(displayAnalysis.mmPerPixel)
      ? ` • ${formatDecimal(displayAnalysis.mmPerPixel, 4)} mm/px`
      : '';
    plateMeta.textContent = `Plate diameter ${formatNumber(
      Math.round(displayAnalysis.plateDiameterPx)
    )} px${scaleText}`;
    summary.appendChild(plateMeta);
  }

  nutritionPhotoAnalysis.appendChild(summary);

  if (mealDraft) {
    const hasPendingItemLookup = state.nutritionMealDraftLookupPendingIds.size > 0;
    const actions = document.createElement('div');
    actions.className = 'nutrition-photo-analysis-actions';

    const addButton = document.createElement('button');
    addButton.type = 'button';
    addButton.className = 'outline-btn secondary';
    addButton.dataset.action = 'add-meal-item';
    addButton.textContent = 'Add missing item';
    addButton.disabled = !canModifyOwnNutrition();
    actions.appendChild(addButton);

    const reanalyzeButton = document.createElement('button');
    reanalyzeButton.type = 'button';
    reanalyzeButton.className = 'outline-btn secondary';
    reanalyzeButton.dataset.action = 'reanalyze-meal-photo';
    reanalyzeButton.textContent = state.nutritionPhotoAnalyzing ? 'Analyzing photo...' : 'Re-analyze photo';
    reanalyzeButton.disabled = !canModifyOwnNutrition() || state.nutritionPhotoAnalyzing;
    actions.appendChild(reanalyzeButton);

    const resetButton = document.createElement('button');
    resetButton.type = 'button';
    resetButton.className = 'outline-btn secondary';
    resetButton.dataset.action = 'reset-meal-draft';
    resetButton.textContent = 'Reset detected items';
    resetButton.disabled =
      !canModifyOwnNutrition() || !mealDraft.originalItems.length || state.nutritionPhotoAnalyzing;
    actions.appendChild(resetButton);

    const saveButton = document.createElement('button');
    saveButton.type = 'button';
    saveButton.className = 'outline-btn';
    saveButton.dataset.action = 'save-meal-draft';
    saveButton.textContent = hasPendingItemLookup
      ? 'Waiting on item lookup...'
      : state.nutritionPhotoAnalyzing
        ? 'Analyzing...'
        : 'Log edited meal';
    saveButton.disabled =
      !canModifyOwnNutrition() || state.nutritionPhotoAnalyzing || hasPendingItemLookup;
    actions.appendChild(saveButton);

    nutritionPhotoAnalysis.appendChild(actions);

    const hint = document.createElement('p');
    hint.className = 'muted tiny-text nutrition-photo-analysis-hint';
    hint.textContent =
      'Tip: leave macros blank on a manual item if you want the food lookup to try filling them in when you save.';
    nutritionPhotoAnalysis.appendChild(hint);

    const list = document.createElement('ul');
    list.className = 'nutrition-photo-analysis-list';
    const createNumberField = (labelText, item, index, field, options = {}) => {
      const label = document.createElement('label');
      label.className = 'nutrition-meal-editor-field';
      label.textContent = labelText;
      const input = document.createElement('input');
      input.type = 'number';
      input.min = options.min ?? '0';
      input.step = options.step ?? '0.1';
      input.placeholder = options.placeholder ?? '0';
      input.value = Number.isFinite(item[field]) ? String(item[field]) : '';
      input.dataset.draftIndex = String(index);
      input.dataset.draftField = field;
      input.disabled = !canModifyOwnNutrition();
      label.appendChild(input);
      return label;
    };

    mealDraft.items.forEach((item, index) => {
      const isLookupPending = isNutritionMealDraftLookupPending(item.id);
      const row = document.createElement('li');
      row.className = 'nutrition-meal-editor-row';

      const head = document.createElement('div');
      head.className = 'nutrition-meal-editor-head';

      const nameLabel = document.createElement('label');
      nameLabel.className = 'nutrition-meal-editor-name';
      nameLabel.textContent = 'Item name';
      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.placeholder = item.source === 'manual' ? 'Add missing food or drink' : 'Detected item';
      nameInput.value = item.name || '';
      nameInput.dataset.draftIndex = String(index);
      nameInput.dataset.draftField = 'name';
      nameInput.disabled = !canModifyOwnNutrition();
      nameLabel.appendChild(nameInput);
      head.appendChild(nameLabel);

      const controls = document.createElement('div');
      controls.className = 'nutrition-meal-editor-controls';

      const tag = document.createElement('span');
      tag.className = 'nutrition-meal-editor-tag';
      tag.textContent = item.source === 'manual' ? 'Manual' : 'Detected';
      controls.appendChild(tag);

      if (Number.isFinite(item.confidence)) {
        const confidenceTag = document.createElement('span');
        confidenceTag.className = 'nutrition-meal-editor-tag';
        confidenceTag.textContent = `${Math.round(item.confidence * 100)}% confidence`;
        controls.appendChild(confidenceTag);
      }

      const removeButton = document.createElement('button');
      removeButton.type = 'button';
      removeButton.className = 'link-btn nutrition-meal-editor-remove';
      removeButton.dataset.action = 'remove-meal-item';
      removeButton.dataset.draftIndex = String(index);
      removeButton.textContent = 'Remove';
      removeButton.disabled = !canModifyOwnNutrition();
      controls.appendChild(removeButton);

      const duplicateButton = document.createElement('button');
      duplicateButton.type = 'button';
      duplicateButton.className = 'link-btn nutrition-meal-editor-remove';
      duplicateButton.dataset.action = 'duplicate-meal-item';
      duplicateButton.dataset.draftIndex = String(index);
      duplicateButton.textContent = 'Duplicate';
      duplicateButton.disabled = !canModifyOwnNutrition();
      controls.appendChild(duplicateButton);

      const lookupButton = document.createElement('button');
      lookupButton.type = 'button';
      lookupButton.className = 'link-btn nutrition-meal-editor-remove';
      lookupButton.dataset.action = 'lookup-meal-item';
      lookupButton.dataset.draftIndex = String(index);
      lookupButton.textContent = isLookupPending ? 'Filling...' : 'Fill macros';
      lookupButton.disabled = !canModifyOwnNutrition() || isLookupPending || !item.name.trim();
      controls.appendChild(lookupButton);

      head.appendChild(controls);
      row.appendChild(head);

      const metaParts = [];
      if (Number.isFinite(item.portionPercent)) {
        metaParts.push(`${formatDecimal(item.portionPercent, 1)}% of plate`);
      }
      if (item.type) {
        metaParts.push(item.type);
      }
      if (metaParts.length) {
        const meta = document.createElement('span');
        meta.className = 'muted tiny-text';
        meta.textContent = metaParts.join(' • ');
        row.appendChild(meta);
      }

      const rowSummaryParts = [];
      if (Number.isFinite(item.calories)) {
        rowSummaryParts.push(`${formatDecimal(item.calories, 1)} kcal`);
      }
      if (Number.isFinite(item.weightAmount) && item.weightUnit) {
        rowSummaryParts.push(`${formatDecimal(item.weightAmount, 1)} ${item.weightUnit}`);
      }
      if (Number.isFinite(item.protein) || Number.isFinite(item.carbs) || Number.isFinite(item.fats)) {
        rowSummaryParts.push(
          `${formatDecimal(Number.isFinite(item.protein) ? item.protein : 0, 1)}p / ${formatDecimal(
            Number.isFinite(item.carbs) ? item.carbs : 0,
            1
          )}c / ${formatDecimal(Number.isFinite(item.fats) ? item.fats : 0, 1)}f`
        );
      }
      if (rowSummaryParts.length) {
        const rowSummary = document.createElement('span');
        rowSummary.className = 'muted tiny-text nutrition-meal-editor-summary';
        rowSummary.textContent = rowSummaryParts.join(' • ');
        row.appendChild(rowSummary);
      }

      const grid = document.createElement('div');
      grid.className = 'nutrition-meal-editor-grid';

      const typeLabel = document.createElement('label');
      typeLabel.className = 'nutrition-meal-editor-field';
      typeLabel.textContent = 'Type';
      const typeSelect = document.createElement('select');
      typeSelect.dataset.draftIndex = String(index);
      typeSelect.dataset.draftField = 'type';
      typeSelect.disabled = !canModifyOwnNutrition();
      ['Food', 'Liquid'].forEach((typeValue) => {
        const option = document.createElement('option');
        option.value = typeValue;
        option.textContent = typeValue;
        option.selected = item.type === typeValue;
        typeSelect.appendChild(option);
      });
      typeLabel.appendChild(typeSelect);
      grid.appendChild(typeLabel);

      grid.appendChild(
        createNumberField('Amount', item, index, 'weightAmount', {
          placeholder: item.type === 'Liquid' ? 'ml' : 'g',
        })
      );

      const unitLabel = document.createElement('label');
      unitLabel.className = 'nutrition-meal-editor-field';
      unitLabel.textContent = 'Unit';
      const unitSelect = document.createElement('select');
      unitSelect.dataset.draftIndex = String(index);
      unitSelect.dataset.draftField = 'weightUnit';
      unitSelect.disabled = !canModifyOwnNutrition();
      [UNIT_FOOD, UNIT_LIQUID, UNIT_PORTION].forEach((unitValue) => {
        const option = document.createElement('option');
        option.value = unitValue;
        option.textContent = unitValue;
        option.selected = item.weightUnit === unitValue;
        unitSelect.appendChild(option);
      });
      unitLabel.appendChild(unitSelect);
      grid.appendChild(unitLabel);

      grid.appendChild(createNumberField('Calories', item, index, 'calories', { placeholder: 'kcal' }));
      grid.appendChild(createNumberField('Protein (g)', item, index, 'protein'));
      grid.appendChild(createNumberField('Carbs (g)', item, index, 'carbs'));
      grid.appendChild(createNumberField('Fats (g)', item, index, 'fats'));
      grid.appendChild(createNumberField('Fiber (g)', item, index, 'fiber'));

      row.appendChild(grid);
      list.appendChild(row);
    });

    if (!mealDraft.items.length) {
      const empty = document.createElement('li');
      empty.className = 'nutrition-meal-editor-row';
      const text = document.createElement('span');
      text.className = 'muted small-text';
      text.textContent = 'No items detected yet. Add the meal items manually.';
      empty.appendChild(text);
      list.appendChild(empty);
    }

    nutritionPhotoAnalysis.appendChild(list);
  } else if (analysis?.items?.length) {
    const list = document.createElement('ul');
    list.className = 'nutrition-photo-analysis-list';
    analysis.items.forEach((item) => {
      const row = document.createElement('li');

      const name = document.createElement('strong');
      name.textContent = item.name;
      row.appendChild(name);

      const metaParts = [];
      if (Number.isFinite(item.portionPercent)) {
        metaParts.push(`${formatDecimal(item.portionPercent, 1)}% of plate`);
      }
      if (Number.isFinite(item.weightAmount)) {
        metaParts.push(`${formatDecimal(item.weightAmount, 1)} ${item.weightUnit || 'g'}`);
      }
      if (Number.isFinite(item.calories)) {
        metaParts.push(`${formatDecimal(item.calories, 1)} kcal`);
      }
      if (Number.isFinite(item.fiber)) {
        metaParts.push(`${formatDecimal(item.fiber, 1)} g fiber`);
      }
      if (Number.isFinite(item.confidence)) {
        metaParts.push(`${Math.round(item.confidence * 100)}% confidence`);
      }

      const meta = document.createElement('span');
      meta.className = 'muted tiny-text';
      meta.textContent = metaParts.join(' • ');
      row.appendChild(meta);

      list.appendChild(row);
    });
    nutritionPhotoAnalysis.appendChild(list);
  }

  nutritionPhotoAnalysis.classList.remove('hidden');
}

function setNutritionPhotoAnalysis(analysis) {
  state.nutritionPhotoAnalysis = normalizeNutritionMealAnalysis(analysis);
  renderNutritionPhotoAnalysis();
}

function clearNutritionPhotoAnalysis() {
  state.nutritionPhotoAnalysis = null;
  renderNutritionPhotoAnalysis();
}

function clearNutritionPhotoSelection({ keepStatus = false, keepAnalysis = false, keepDraft = false } = {}) {
  state.nutritionPhotoData = null;
  state.nutritionPhotoPreparing = false;
  state.nutritionPhotoAnalyzing = false;
  if (nutritionPhotoInput) {
    nutritionPhotoInput.value = '';
  }
  renderNutritionPhotoPreview();
  if (!keepDraft) {
    state.nutritionMealDraftLookupPendingIds.clear();
    state.nutritionMealDraft = null;
  }
  if (!keepAnalysis) {
    clearNutritionPhotoAnalysis();
  } else {
    renderNutritionPhotoAnalysis();
  }
  if (!keepStatus) {
    setNutritionPhotoStatus('');
  }
  toggleNutritionPhotoDropZone(false);
}

function addNutritionMealDraftItem(prefill = {}) {
  const fallbackType = prefill.type === 'Liquid' ? 'Liquid' : nutritionTypeSelect?.value || 'Food';
  const nextItem = normalizeNutritionMealDraftItem(
    {
      ...prefill,
      type: fallbackType,
      weightUnit: prefill.weightUnit || getUnitForType(fallbackType),
      source: 'manual',
    },
    { fallbackType }
  );

  if (!state.nutritionMealDraft) {
    state.nutritionMealDraft = {
      items: [nextItem],
      originalItems: [],
      analysis: state.nutritionPhotoAnalysis,
      requiresReview: true,
    };
  } else {
    state.nutritionMealDraft.items = [...state.nutritionMealDraft.items, nextItem];
  }

  renderNutritionPhotoAnalysis();
}

function updateNutritionMealDraftItem(index, field, value) {
  if (!state.nutritionMealDraft || !Array.isArray(state.nutritionMealDraft.items)) {
    return;
  }
  if (!Number.isInteger(index) || index < 0 || index >= state.nutritionMealDraft.items.length) {
    return;
  }

  const current = state.nutritionMealDraft.items[index];
  if (!current) {
    return;
  }

  const next = { ...current };
  if (field === 'name') {
    next.name = String(value ?? '');
  } else if (field === 'type') {
    next.type = value === 'Liquid' ? 'Liquid' : 'Food';
    if (next.weightUnit !== UNIT_PORTION) {
      next.weightUnit = getUnitForType(next.type);
    }
  } else if (field === 'weightUnit') {
    next.weightUnit = MEAL_DRAFT_UNITS.has(value) ? value : getUnitForType(next.type);
  } else {
    next[field] = normalizeMealDraftNumber(value, field === 'confidence' ? 4 : 1);
  }

  state.nutritionMealDraft.items = state.nutritionMealDraft.items.map((item, itemIndex) =>
    itemIndex === index ? next : item
  );
  renderNutritionPhotoAnalysis();
}

function removeNutritionMealDraftItem(index) {
  if (!state.nutritionMealDraft || !Array.isArray(state.nutritionMealDraft.items)) {
    return;
  }
  state.nutritionMealDraft.items = state.nutritionMealDraft.items.filter(
    (_item, itemIndex) => itemIndex !== index
  );
  renderNutritionPhotoAnalysis();
}

function resetNutritionMealDraft() {
  if (!state.nutritionMealDraft) {
    return;
  }
  state.nutritionMealDraft.items = cloneNutritionMealDraftItems(
    state.nutritionMealDraft.originalItems || []
  );
  renderNutritionPhotoAnalysis();
}

function isSubmittableNutritionMealDraftItem(item) {
  return Boolean(item?.name?.trim()) || Number.isFinite(normalizeMealDraftNumber(item?.calories, 1));
}

async function analyzeNutritionPhotoSelection() {
  if (!state.token || !state.nutritionPhotoData || !canModifyOwnNutrition()) {
    return null;
  }
  if (state.nutritionPhotoPreparing) {
    setNutritionPhotoStatus('Preparing photo. Please wait a moment.', { isError: true });
    return null;
  }

  const activePhotoData = state.nutritionPhotoData;
  state.nutritionPhotoAnalyzing = true;
  renderNutritionPhotoAnalysis();
  setNutritionPhotoStatus('Analyzing meal photo...');
  setNutritionFeedback('Analyzing meal photo...');

  try {
    const response = await apiFetch('/api/nutrition/photo/analyze', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${state.token}`,
      },
      body: JSON.stringify({
        photoData: activePhotoData,
        type: nutritionTypeSelect?.value || 'Food',
      }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload) {
      throw new Error(payload?.message || 'Unable to analyze the meal photo.');
    }
    if (state.nutritionPhotoData !== activePhotoData) {
      return payload;
    }

    const nextAnalysis = resolveNutritionMealAnalysis(payload);
    setNutritionPhotoAnalysis(nextAnalysis);
    setNutritionMealDraft(
      createNutritionMealDraft(nextAnalysis, payload?.suggestedItems, {
        fallbackType: nutritionTypeSelect?.value || 'Food',
        requiresReview: payload?.requiresReview === true,
      })
    );
    clearSuggestions();
    setNutritionFeedback(payload.message || 'Meal photo analyzed.', { tone: 'success' });
    setNutritionPhotoStatus(
      payload?.requiresReview === true
        ? 'Review the detected meal items, update the macros, and add anything the model missed.'
        : 'Detected meal items are ready. Adjust them before logging if needed.'
    );
    return payload;
  } catch (error) {
    if (state.nutritionPhotoData === activePhotoData) {
      clearNutritionMealDraft();
      clearNutritionPhotoAnalysis();
      setNutritionPhotoStatus(error.message, { isError: true });
      setNutritionFeedback(error.message);
    }
    return null;
  } finally {
    if (state.nutritionPhotoData === activePhotoData) {
      state.nutritionPhotoAnalyzing = false;
      renderNutritionPhotoAnalysis();
    }
  }
}

async function submitNutritionMealDraft() {
  if (!state.token || !state.nutritionPhotoData || !state.nutritionMealDraft) {
    return false;
  }
  if (!canModifyOwnNutrition()) {
    setNutritionFeedback('Switch to your own profile to log intake.');
    return false;
  }
  if (state.nutritionPhotoPreparing || state.nutritionPhotoAnalyzing) {
    const waitMessage = 'Wait for the meal photo analysis to finish before saving.';
    setNutritionFeedback(waitMessage);
    setNutritionPhotoStatus(waitMessage, { isError: true });
    return false;
  }
  if (state.nutritionMealDraftLookupPendingIds.size > 0) {
    const waitMessage = 'Wait for the item macro lookup to finish before saving.';
    setNutritionFeedback(waitMessage);
    setNutritionPhotoStatus(waitMessage, { isError: true });
    return false;
  }

  const submittedDraftItems = (state.nutritionMealDraft.items || []).filter((item) =>
    isSubmittableNutritionMealDraftItem(item)
  );
  const requestItems = getNutritionMealDraftSubmissionItems(submittedDraftItems);
  if (!requestItems.length) {
    const message = 'Add at least one meal item or calorie value before saving the edited meal.';
    setNutritionFeedback(message);
    setNutritionPhotoStatus(message, { isError: true });
    return false;
  }

  setNutritionFeedback('Logging edited meal...');
  setNutritionPhotoStatus('Logging edited meal...');

  try {
    const response = await apiFetch('/api/nutrition', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${state.token}`,
      },
      body: JSON.stringify({
        date: getActiveNutritionDate(),
        photoData: state.nutritionPhotoData,
        items: requestItems,
      }),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result) {
      const fallback = `Unable to log that meal (HTTP ${response.status || 'unknown'}).`;
      throw new Error(result?.message || fallback);
    }

    const skippedItems = Array.isArray(result?.skippedItems) ? result.skippedItems : [];
    if (skippedItems.length) {
      const skippedIndexSet = new Set(
        skippedItems
          .map((entry) => Number.parseInt(entry?.index, 10))
          .filter((index) => Number.isInteger(index) && index >= 0)
      );
      const remainingItems = submittedDraftItems.filter((_item, index) => skippedIndexSet.has(index));
      state.nutritionMealDraft.items = cloneNutritionMealDraftItems(remainingItems);
      state.nutritionMealDraft.originalItems = cloneNutritionMealDraftItems(remainingItems);
      renderNutritionPhotoAnalysis();

      const reasons = skippedItems
        .map((entry) => entry?.reason)
        .filter(Boolean)
        .slice(0, 2)
        .join(' ');
      const suffix = reasons ? ` ${reasons}` : '';
      setNutritionFeedback(
        `${result.message} ${skippedItems.length} item${
          skippedItems.length === 1 ? '' : 's'
        } still need attention.${suffix}`
      );
      setNutritionPhotoStatus('Some items were logged. Fix the remaining ones and save again.');
    } else {
      nutritionForm?.reset();
      if (nutritionTypeSelect) {
        nutritionTypeSelect.value = 'Food';
      }
      setAmountReference(null);
      state.nutritionAmountBaseline = null;
      state.nutritionMacroReference = null;
      setNutritionResolvedSelection(null);
      setSelectedUnit(UNIT_FOOD);
      setNutritionCustomMode(false);
      updateAmountFieldUnit();
      updateNutritionPreview();
      clearSuggestions();
      clearNutritionPhotoSelection({ keepStatus: true });
      setNutritionFeedback(
        `${result.message}${result.autoLookup ? ' (nutrition estimated automatically)' : ''}`,
        { tone: 'success' }
      );
      setNutritionPhotoStatus('Meal logged.');
    }

    state.nutritionLogShouldScrollToTop = true;
    await refreshNutritionLinkedViews();
    return true;
  } catch (error) {
    setNutritionFeedback(error.message);
    setNutritionPhotoStatus(error.message, { isError: true });
    return false;
  }
}

function handleNutritionMealDraftFieldChange(event) {
  const target = event.target;
  const index = Number.parseInt(target?.dataset?.draftIndex, 10);
  const field = target?.dataset?.draftField;
  if (!Number.isInteger(index) || !field) {
    return;
  }
  updateNutritionMealDraftItem(index, field, target.value);
}

function handleNutritionMealDraftAction(event) {
  const button = event.target.closest('button[data-action]');
  if (!button) {
    return;
  }

  const index = Number.parseInt(button.dataset.draftIndex, 10);
  const action = button.dataset.action;
  if (action === 'add-meal-item') {
    addNutritionMealDraftItem();
  } else if (action === 'reanalyze-meal-photo') {
    void analyzeNutritionPhotoSelection();
  } else if (action === 'reset-meal-draft') {
    resetNutritionMealDraft();
  } else if (action === 'save-meal-draft') {
    void submitNutritionMealDraft();
  } else if (action === 'lookup-meal-item' && Number.isInteger(index)) {
    void lookupNutritionMealDraftItem(index);
  } else if (action === 'duplicate-meal-item' && Number.isInteger(index)) {
    duplicateNutritionMealDraftItem(index);
  } else if (action === 'remove-meal-item' && Number.isInteger(index)) {
    removeNutritionMealDraftItem(index);
  }
}

function processNutritionPhotoFile(file) {
  if (!file) return;
  clearNutritionMealDraft();
  clearNutritionPhotoAnalysis();
  if (!canModifyOwnNutrition()) {
    setNutritionPhotoStatus('Switch back to your profile to import meal photos.', { isError: true });
    return;
  }
  if (!String(file.type || '').startsWith('image/')) {
    clearNutritionPhotoSelection({ keepStatus: true });
    setNutritionPhotoStatus('Choose a valid image file.', { isError: true });
    return;
  }
  if (isHeicLikeFile(file)) {
    clearNutritionPhotoSelection({ keepStatus: true });
    setNutritionPhotoStatus('HEIC/HEIF photos are not supported here. Convert to JPG or PNG first.', {
      isError: true,
    });
    return;
  }
  if (file.size > MAX_NUTRITION_PHOTO_BYTES) {
    clearNutritionPhotoSelection({ keepStatus: true });
    setNutritionPhotoStatus('Meal photo must be smaller than 12 MB.', { isError: true });
    return;
  }
  state.nutritionPhotoPreparing = true;
  const reader = new FileReader();
  reader.onload = () => {
    const result = typeof reader.result === 'string' ? reader.result : '';
    void (async () => {
      const normalized = normalizeBase64ImageData(result);
      if (!normalized) {
        clearNutritionPhotoSelection({ keepStatus: true });
        setNutritionPhotoStatus('Could not read photo. Try another file.', { isError: true });
        return;
      }
      let prepared = normalized;
      try {
        setNutritionPhotoStatus('Preparing meal photo...');
        prepared = await transcodeNutritionPhotoDataUrl(result, {
          maxDimension: 1600,
          quality: 0.86,
        });
      } catch (error) {
        prepared = normalized;
      } finally {
        state.nutritionPhotoPreparing = false;
      }
      state.nutritionPhotoData = prepared || normalized;
      renderNutritionPhotoPreview();
      await analyzeNutritionPhotoSelection();
    })();
  };
  reader.onerror = () => {
    clearNutritionPhotoSelection({ keepStatus: true });
    setNutritionPhotoStatus('Could not read photo. Try another file.', { isError: true });
  };
  reader.readAsDataURL(file);
}

function handleNutritionPhotoUpload(event) {
  processNutritionPhotoFile(event?.target?.files?.[0]);
}

function toggleNutritionPhotoDropZone(isDragging) {
  nutritionPhotoDropZone?.classList.toggle('dragging', Boolean(isDragging));
}

function handleNutritionPhotoDrop(event) {
  event.preventDefault();
  event.stopPropagation();
  toggleNutritionPhotoDropZone(false);
  const file = event?.dataTransfer?.files?.[0];
  processNutritionPhotoFile(file);
}

function scrubSensitiveQueryParams() {
  const { origin, pathname, search, hash } = window.location;
  if (!search) return;
  const params = new URLSearchParams(search);
  const sensitiveKeys = ['email', 'password', 'token'];
  let mutated = false;
  sensitiveKeys.forEach((key) => {
    if (params.has(key)) {
      params.delete(key);
      mutated = true;
    }
  });
  if (!mutated) return;
  const nextSearch = params.toString();
  const nextUrl = `${origin}${pathname}${nextSearch ? `?${nextSearch}` : ''}${hash || ''}`;
  window.history.replaceState({}, document.title, nextUrl);
}

scrubSensitiveQueryParams();
const activityTrainingLoad = document.getElementById('activityTrainingLoad');
const activityVo2max = document.getElementById('activityVo2max');
const activityPrimarySessionsList = document.getElementById('sessionsList');
const activitySessionsList = document.getElementById('activitySessions');
const activitySplitsList = document.getElementById('activitySplits');
const activitySplitTitle = document.getElementById('activitySplitTitle');
const activityFocusTitle = document.getElementById('activityFocusTitle');
const activityFocusSubtitle = document.getElementById('activityFocusSubtitle');
const activityFocusSourceChip = document.getElementById('activityFocusSourceChip');
const activityFocusRouteChip = document.getElementById('activityFocusRouteChip');
const activityFocusMetrics = document.getElementById('activityFocusMetrics');
const activityFocusInsightTitle = document.getElementById('activityFocusInsightTitle');
const activityFocusInsightBody = document.getElementById('activityFocusInsightBody');
const activityFocusHighlights = document.getElementById('activityFocusHighlights');
const activityRouteSvg = document.getElementById('activityRouteSvg');
const activityRouteShadow = document.getElementById('activityRouteShadow');
const activityRoutePath = document.getElementById('activityRoutePath');
const activityRouteStart = document.getElementById('activityRouteStart');
const activityRouteEnd = document.getElementById('activityRouteEnd');
const activityRouteEmpty = document.getElementById('activityRouteEmpty');
const activityRouteLegend = document.getElementById('activityRouteLegend');
const activityBestEffortsList = document.getElementById('activityBestEfforts');
const activityBestEffortsBadge = document.getElementById('activityBestEffortsBadge');
const activityBestEffortsHint = document.getElementById('activityBestEffortsHint');
const activitySessionHint = document.getElementById('activitySessionHint');
const stravaExportButton = document.getElementById('stravaExportButton');
const stravaPanelElement = document.getElementById('stravaPanel');
const stravaStatusChip = document.getElementById('stravaStatusChip');
const stravaSummary = document.getElementById('stravaSummary');
const stravaConnectButton = document.getElementById('stravaConnectButton');
const stravaSyncButton = document.getElementById('stravaSyncButton');
const stravaDisconnectButton = document.getElementById('stravaDisconnectButton');
const stravaFeedback = document.getElementById('stravaFeedback');
const weightLatestValue = document.getElementById('weightLatestValue');
const weightLatestSecondary = document.getElementById('weightLatestSecondary');
const weightLatestDate = document.getElementById('weightLatestDate');
const weightAverageValue = document.getElementById('weightAverageValue');
const weightChangeValue = document.getElementById('weightChangeValue');
const weightCaloriesAvg = document.getElementById('weightCaloriesAvg');
const weightCaloriesInsight = document.getElementById('weightCaloriesInsight');
const weightLogList = document.getElementById('weightLog');
const weightForm = document.getElementById('weightForm');
const weightValueInput = document.getElementById('weightValue');
const weightUnitSelect = document.getElementById('weightUnit');
const weightDateInput = document.getElementById('weightDate');
const weightFeedback = document.getElementById('weightFeedback');
const weightFormHint = document.getElementById('weightFormHint');
const weightBmiValue = document.getElementById('weightBmiValue');
const weightBmiLabel = document.getElementById('weightBmiLabel');
const weightBmiLatest = document.getElementById('weightBmiLatest');
const weightBmiUpdated = document.getElementById('weightBmiUpdated');
const weightHeightValue = document.getElementById('weightHeightValue');
const weightHeightDisplay = document.getElementById('weightHeightDisplay');
const weightHeightEditToggle = document.getElementById('weightHeightEditToggle');
const weightHeightForm = document.getElementById('weightHeightForm');
const weightHeightInput = document.getElementById('weightHeightInput');
const weightHeightFeedback = document.getElementById('weightHeightFeedback');
const weightHeightCancelButton = document.getElementById('weightHeightCancelButton');
let weightHeightEditing = false;

const formatNumber = (value) => Intl.NumberFormat().format(value);
const formatDecimal = (value, fractionDigits = 1) =>
  new Intl.NumberFormat(undefined, { maximumFractionDigits: fractionDigits }).format(value);
const formatDate = (value) =>
  new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(value));
const formatFullDate = (value) =>
  new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).format(
    new Date(value)
  );
const formatSignedValue = (value, suffix = '') => {
  if (!Number.isFinite(value)) return null;
  const rounded = Math.round(value * 10) / 10;
  if (rounded === 0) {
    return `0${suffix}`;
  }
  const sign = rounded > 0 ? '+' : '-';
  return `${sign}${formatDecimal(Math.abs(rounded))}${suffix}`;
};
const formatPace = (seconds) => {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—';
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60)
    .toString()
    .padStart(2, '0');
  return `${mins}:${secs}`;
};
const formatDurationFromMinutes = (minutes) => {
  if (!Number.isFinite(minutes) || minutes <= 0) return '—';
  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  if (hours <= 0) return `${mins}m`;
  return `${hours}h ${String(mins).padStart(2, '0')}m`;
};
const formatDistance = (meters) => {
  if (!Number.isFinite(meters) || meters <= 0) return '—';
  if (meters >= 1000) {
    return `${formatDecimal(meters / 1000, 1)} km`;
  }
  return `${Math.round(meters)} m`;
};
const formatDurationFromSeconds = (seconds) =>
  Number.isFinite(seconds) && seconds > 0
    ? formatDurationFromMinutes(seconds / 60)
    : '—';
const formatActivityDateTime = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
};
const formatSessionSource = (value) => {
  const normalized = String(value || '').trim();
  if (!normalized) return '—';
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
};
const formatPaceDelta = (seconds) => {
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60)
    .toString()
    .padStart(2, '0');
  return `${mins}:${secs}`;
};

function formatSessionSourceBadge(session) {
  const source = String(session?.source || '').trim().toLowerCase();
  if (!source) return 'Session';
  if (source === 'strava') return 'Strava sync';
  if (source === 'phone_sync') return 'Phone sync';
  if (source === 'seed') return 'Demo activity';
  return formatSessionSource(source);
}

function simplifyRoutePoints(points = [], maxPoints = 180) {
  if (!Array.isArray(points) || points.length <= maxPoints) {
    return Array.isArray(points) ? points.slice() : [];
  }

  const output = [];
  const step = (points.length - 1) / (maxPoints - 1);
  for (let index = 0; index < maxPoints; index += 1) {
    const sourceIndex = Math.round(index * step);
    output.push(points[Math.min(sourceIndex, points.length - 1)]);
  }
  return output;
}

function buildSessionRoutePoints(session, precision = 5) {
  const routePoints = decodePolyline(session?.routeSummaryPolyline, precision);
  const startLat = Number(session?.routeStartLat);
  const startLng = Number(session?.routeStartLng);
  const endLat = Number(session?.routeEndLat);
  const endLng = Number(session?.routeEndLng);
  const hasStart = Number.isFinite(startLat) && Number.isFinite(startLng);
  const hasEnd = Number.isFinite(endLat) && Number.isFinite(endLng);

  if (!routePoints.length) {
    return [];
  }

  const normalized = routePoints.slice();
  if (hasStart) {
    normalized[0] = { x: startLng, y: startLat };
  }
  if (hasEnd) {
    normalized[normalized.length - 1] = { x: endLng, y: endLat };
  }
  return simplifyRoutePoints(normalized);
}

function decodePolyline(encoded, precision = 5) {
  if (typeof encoded !== 'string' || !encoded.trim()) {
    return [];
  }

  const points = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  const factor = 10 ** precision;

  try {
    while (index < encoded.length) {
      let result = 0;
      let shift = 0;
      let byte = null;

      do {
        if (index >= encoded.length) {
          return [];
        }
        byte = encoded.charCodeAt(index++) - 63;
        if (!Number.isFinite(byte) || byte < 0) {
          return [];
        }
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);
      lat += result & 1 ? ~(result >> 1) : result >> 1;

      result = 0;
      shift = 0;
      do {
        if (index >= encoded.length) {
          return [];
        }
        byte = encoded.charCodeAt(index++) - 63;
        if (!Number.isFinite(byte) || byte < 0) {
          return [];
        }
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);
      lng += result & 1 ? ~(result >> 1) : result >> 1;

      points.push({
        x: lng / factor,
        y: lat / factor,
      });
    }
  } catch (error) {
    return [];
  }

  return points.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
}

function buildRouteGeometry(points = [], { size = 100, padding = 10 } = {}) {
  if (!Array.isArray(points) || points.length < 2) {
    return null;
  }

  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const drawable = Math.max(1, size - padding * 2);
  const scale = Math.min(drawable / spanX, drawable / spanY);
  const offsetX = (size - spanX * scale) / 2;
  const offsetY = (size - spanY * scale) / 2;

  const transformed = points.map((point) => ({
    x: offsetX + (point.x - minX) * scale,
    y: size - (offsetY + (point.y - minY) * scale),
  }));
  const d = transformed
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(' ');

  return {
    d,
    start: transformed[0],
    end: transformed[transformed.length - 1],
  };
}

function buildEffortTracePoints(splits = []) {
  if (!Array.isArray(splits) || splits.length < 2) {
    return [];
  }

  const totalDistance = splits.reduce((sum, split) => sum + (Number(split?.distance) || 0), 0);
  if (!Number.isFinite(totalDistance) || totalDistance <= 0) {
    return [];
  }

  const paceValues = splits
    .map((split) => getSplitPaceValue(split))
    .filter((value) => Number.isFinite(value) && value > 0);
  const elevationValues = splits
    .map((split) => Number(split?.elevation))
    .filter((value) => Number.isFinite(value));
  if (!paceValues.length && !elevationValues.length) {
    return [];
  }
  const minPace = Math.min(...paceValues);
  const maxPace = Math.max(...paceValues);
  const minElevation = elevationValues.length ? Math.min(...elevationValues) : 0;
  const maxElevation = elevationValues.length ? Math.max(...elevationValues) : 1;
  let coveredDistance = 0;

  return splits.map((split) => {
    coveredDistance += Number(split?.distance) || 0;
    const progress = coveredDistance / totalDistance;
    const pace = getSplitPaceValue(split);
    const elevation = Number(split?.elevation);
    const paceFactor =
      Number.isFinite(pace) && maxPace > minPace ? (pace - minPace) / (maxPace - minPace) : 0.5;
    const elevationFactor =
      Number.isFinite(elevation) && maxElevation > minElevation
        ? (elevation - minElevation) / (maxElevation - minElevation)
        : 0.5;
    const wave = Math.sin(progress * Math.PI * (2.2 + splits.length * 0.12)) * 0.2;

    return {
      x: progress,
      y: paceFactor * 0.68 + (1 - elevationFactor) * 0.22 + wave,
    };
  });
}

function getSelectedActivitySessionSplits(session = getSelectedActivitySession()) {
  if (!session?.id) return [];
  return Array.isArray(state.activity?.splits?.[session.id]) ? state.activity.splits[session.id] : [];
}

function averageSplitPace(splits = []) {
  const totals = splits.reduce(
    (acc, split) => {
      const distance = Number(split?.distance);
      const pace = getSplitPaceValue(split);
      if (Number.isFinite(distance) && distance > 0 && Number.isFinite(pace) && pace > 0) {
        acc.distance += distance;
        acc.seconds += pace * (distance / 1000);
      }
      return acc;
    },
    { distance: 0, seconds: 0 }
  );
  if (!totals.distance || !totals.seconds) return null;
  return totals.seconds / (totals.distance / 1000);
}

function getSplitPaceValue(split = {}) {
  const pace = Number(split?.pace);
  if (Number.isFinite(pace) && pace > 0) {
    return pace;
  }
  const distance = Number(split?.distance);
  const movingTime = Number(split?.movingTime);
  if (Number.isFinite(distance) && distance > 0 && Number.isFinite(movingTime) && movingTime > 0) {
    return movingTime / (distance / 1000);
  }
  return null;
}

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function formatIsoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseIsoDateString(value) {
  if (typeof value !== 'string' || !ISO_DATE_PATTERN.test(value)) return null;
  const [year, month, day] = value.split('-').map((part) => Number.parseInt(part, 10));
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  const date = new Date(year, month - 1, day);
  if (Number.isNaN(date.getTime())) return null;
  date.setHours(12, 0, 0, 0);
  return date;
}

function getTodayIsoDate() {
  return formatIsoDate(new Date());
}

function normalizeIsoDate(value) {
  const parsed = parseIsoDateString(value);
  if (!parsed) return null;
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  if (parsed.getTime() > today.getTime()) {
    return formatIsoDate(today);
  }
  return formatIsoDate(parsed);
}

function shiftIsoDate(dateString, deltaDays) {
  const base = parseIsoDateString(dateString) || new Date();
  base.setDate(base.getDate() + deltaDays);
  return normalizeIsoDate(formatIsoDate(base));
}

function formatFeetInches(heightCm) {
  if (!Number.isFinite(heightCm) || heightCm <= 0) return '—';
  const totalInches = heightCm / 2.54;
  const feet = Math.floor(totalInches / 12);
  const inches = Math.round(totalInches - feet * 12);
  return `${feet}'${inches}"`;
}

function computeBmi(weightKg, heightCm) {
  if (!Number.isFinite(weightKg) || !Number.isFinite(heightCm) || heightCm <= 0) return null;
  const heightMeters = heightCm / 100;
  const bmi = weightKg / (heightMeters * heightMeters);
  if (!Number.isFinite(bmi) || bmi <= 0) return null;
  return Math.round(bmi * 10) / 10;
}

function classifyBmi(bmi) {
  if (!Number.isFinite(bmi)) {
    return { label: 'Awaiting BMI data', className: 'neutral' };
  }
  if (bmi < 18.5) {
    return { label: 'Underweight range', className: 'warning' };
  }
  if (bmi < 25) {
    return { label: 'Optimal range', className: 'success' };
  }
  if (bmi < 30) {
    return { label: 'Overweight range', className: 'warning' };
  }
  return { label: 'Obese range', className: 'danger' };
}

function loadWeightHeightSettings() {
  try {
    const raw = window.localStorage.getItem(WEIGHT_HEIGHT_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    console.warn('Unable to load height preferences.', error);
    return {};
  }
}

function persistWeightHeightSettings() {
  try {
    window.localStorage.setItem(WEIGHT_HEIGHT_STORAGE_KEY, JSON.stringify(weightHeightSettings));
  } catch (error) {
    console.warn('Unable to save height preference.', error);
  }
}

function sanitizeHeight(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  if (numeric < 120 || numeric > 240) return null;
  return Math.round(numeric);
}

function resolveStoredHeight(subjectId) {
  const key = Number.isFinite(Number(subjectId)) ? String(Number(subjectId)) : null;
  if (key && sanitizeHeight(weightHeightSettings[key])) {
    return sanitizeHeight(weightHeightSettings[key]);
  }
  if (sanitizeHeight(weightHeightSettings.default)) {
    return sanitizeHeight(weightHeightSettings.default);
  }
  return DEFAULT_HEIGHT_CM;
}

function updateStoredHeight(subjectId, heightCm) {
  const normalized = sanitizeHeight(heightCm);
  if (!normalized) return;
  const key = Number.isFinite(Number(subjectId)) ? String(Number(subjectId)) : 'default';
  weightHeightSettings[key] = normalized;
  persistWeightHeightSettings();
}

function getActiveSubjectId() {
  if (state.viewing?.id) {
    return state.viewing.id;
  }
  if (state.subject?.id) {
    return state.subject.id;
  }
  return state.user?.id ?? null;
}

function refreshWeightHeightContext() {
  const resolved = resolveStoredHeight(getActiveSubjectId());
  state.weight.heightCm = resolved;
  setWeightHeightEditing(false);
  renderWeightBodyMetrics(state.weight.latest, resolved);
}

const viewingOwnProfile = () => state.user && state.viewing && state.user.id === state.viewing.id;
const NUTRITION_METRICS = {
  calories: { key: 'calories', label: 'Calories', unit: 'kcal' },
  protein: { key: 'protein', label: 'Protein', unit: 'g' },
  carbs: { key: 'carbs', label: 'Carbs', unit: 'g' },
  fats: { key: 'fats', label: 'Fats', unit: 'g' },
  fiber: { key: 'fiber', label: 'Fiber', unit: 'g' },
};

const LINEAR_BARCODE_FORMATS = [
  'ean_13',
  'ean_8',
  'upc_a',
  'upc_e',
  'code_128',
  'code_39',
  'itf',
  'codabar',
];
const NUMERIC_BARCODE_FORMATS = new Set(['ean_13', 'ean_8', 'upc_a', 'upc_e', 'itf', 'itf_14']);

const barcodeScanState = {
  detector: null,
  stream: null,
  frameId: null,
  active: false,
};
let barcodeDetectorWarmupPromise = null;

function showEmptyState(container, message) {
  if (!container) return;
  let empty = container.querySelector('.empty-state');
  if (!empty) {
    empty = document.createElement('p');
    empty.className = 'empty-state';
    container.appendChild(empty);
  }
  empty.textContent = message;
  empty.hidden = false;
}

function hideEmptyState(container) {
  if (!container) return;
  const empty = container.querySelector('.empty-state');
  if (empty) {
    empty.hidden = true;
  }
}

function renderListPlaceholder(listElement, message) {
  if (!listElement) return;
  listElement.innerHTML = `<li class="empty-row">${message}</li>`;
  enforceScrollableList(listElement);
}

const DEFAULT_LIST_LIMIT = 5;

function enforceScrollableList(listElement, options = {}) {
  if (!listElement) return;
  const limit =
    Number.isFinite(options.limit) && options.limit > 0 ? Math.floor(options.limit) : DEFAULT_LIST_LIMIT;
  const items = Array.from(listElement.children);
  if (items.length <= limit) {
    listElement.classList.remove('list-scrollable');
    listElement.style.removeProperty('--list-scroll-max-height');
    return;
  }

  const applyClamp = () => {
    const sample = Array.from(listElement.children).slice(0, limit);
    const totalHeight = sample.reduce((sum, item) => sum + item.getBoundingClientRect().height, 0);
    const hasWindow = typeof window !== 'undefined' && typeof window.getComputedStyle === 'function';
    const computed = hasWindow ? window.getComputedStyle(listElement) : null;
    const gapValue = computed ? Number.parseFloat(computed.rowGap || computed.gap || 0) : 0;
    const gapTotal = gapValue > 0 ? gapValue * Math.max(sample.length - 1, 0) : 0;
    const maxHeight = Math.max(totalHeight + gapTotal, 1);
    listElement.style.setProperty('--list-scroll-max-height', `${maxHeight}px`);
    listElement.classList.add('list-scrollable');
  };

  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(applyClamp);
  } else {
    setTimeout(applyClamp, 0);
  }
}

function showChartMessage(canvasId, message) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return null;
  const container = canvas.closest('.chart-card');
  if (canvas) {
    canvas.classList.add('hidden');
  }
  showEmptyState(container, message);
  return { canvas, container };
}

function hideChartMessage(canvasId) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return null;
  const container = canvas.closest('.chart-card');
  canvas.classList.remove('hidden');
  hideEmptyState(container);
  return { canvas, container };
}

function setChartCardTitle(canvasId, title) {
  const canvas = document.getElementById(canvasId);
  const titleEl = canvas?.closest('.chart-card')?.querySelector('.section-eyebrow');
  if (titleEl && typeof title === 'string' && title.trim()) {
    titleEl.textContent = title;
  }
}

let pendingChartResizeFrame = null;
function resizeAllCharts() {
  if (!state || !state.charts) {
    return;
  }
  Object.values(state.charts).forEach((chart) => {
    if (chart && typeof chart.resize === 'function') {
      try {
        chart.resize();
      } catch (error) {
        console.warn('Unable to resize chart', error);
      }
    }
  });
}

function queueChartResize() {
  if (typeof requestAnimationFrame !== 'function') {
    resizeAllCharts();
    return;
  }
  if (pendingChartResizeFrame) {
    cancelAnimationFrame(pendingChartResizeFrame);
  }
  pendingChartResizeFrame = requestAnimationFrame(() => {
    pendingChartResizeFrame = null;
    resizeAllCharts();
  });
}

const SIDEBAR_OVERLAY_BREAKPOINT = 1040;
const SIDEBAR_OPEN_LABEL = 'Close menu';
const SIDEBAR_CLOSED_LABEL = 'Open menu';

function shouldUseSidebarOverlay() {
  if (typeof window === 'undefined') {
    return false;
  }
  if (typeof window.matchMedia === 'function') {
    return window.matchMedia(`(max-width: ${SIDEBAR_OVERLAY_BREAKPOINT}px)`).matches;
  }
  return window.innerWidth <= SIDEBAR_OVERLAY_BREAKPOINT;
}

function setSidebarOpen(open) {
  if (typeof document === 'undefined' || !document.body) {
    return;
  }
  const enableOverlay = shouldUseSidebarOverlay();
  const nextState = Boolean(open && enableOverlay);
  document.body.classList.toggle('sidebar-open', nextState);
  if (sidebarToggle) {
    sidebarToggle.setAttribute('aria-expanded', String(nextState));
    sidebarToggle.textContent = nextState ? SIDEBAR_OPEN_LABEL : SIDEBAR_CLOSED_LABEL;
    sidebarToggle.setAttribute('aria-label', sidebarToggle.textContent);
  }
  if (sidebarBackdrop) {
    if (nextState) {
      sidebarBackdrop.removeAttribute('hidden');
    } else {
      sidebarBackdrop.setAttribute('hidden', 'hidden');
    }
  }
  if (appSidebar) {
    if (enableOverlay) {
      appSidebar.setAttribute('aria-hidden', String(!nextState));
      if (!nextState) {
        appSidebar.setAttribute('inert', '');
      } else {
        appSidebar.removeAttribute('inert');
      }
    } else {
      appSidebar.removeAttribute('aria-hidden');
      appSidebar.removeAttribute('inert');
    }
  }
}

function clearShareInputs({ disableSelect = false, clearFeedback = true } = {}) {
  if (shareForm) {
    shareForm.reset();
  }
  if (shareCoachSelect) {
    shareCoachSelect.innerHTML = '<option value="">Choose a coach</option>';
    shareCoachSelect.disabled = disableSelect;
  }
  if (clearFeedback && shareFeedback) {
    shareFeedback.textContent = '';
  }
}

function resetNutritionState() {
  state.nutrition = {
    date: null,
    goals: null,
    dailyTotals: null,
    entries: [],
    monthTrend: [],
  };
  state.nutritionAmountBaseline = null;
  state.nutritionMacroReference = null;
  state.nutritionDeletingEntries.clear();
  state.nutritionPendingDeletes.forEach((p) => { clearTimeout(p.timeoutId); p.dismissToast?.(); });
  state.nutritionPendingDeletes.clear();
  setNutritionEntryFilter('all', { force: true, render: false });
  state.nutritionLogShouldScrollToTop = true;
  setAmountReference(null);
  state.nutritionPhotoData = null;
  state.nutritionPhotoPreparing = false;
  state.nutritionPhotoAnalyzing = false;
  state.nutritionPhotoAnalysis = null;
  state.nutritionMealDraft = null;
  state.nutritionMealDraftLookupPendingIds.clear();
  renderNutritionPhotoPreview();
  renderNutritionPhotoAnalysis();
  setNutritionPhotoStatus('');
  state.macroTargetExpanded = false;
  setMacroTargetExpanded(false);
  renderNutritionDashboard(state.nutrition);
}

function resetActivityState() {
  const currentWidgetGoals = state.activity?.widgetGoals || loadActivityWidgetGoals();
  state.activity = {
    summary: null,
    sessions: [],
    splits: {},
    bestEfforts: [],
    strava: null,
    selectedSessionId: null,
    subjectId: null,
    widgetGoals: currentWidgetGoals,
  };
  state.charts.activityMileage?.destroy();
  state.charts.activityMileage = null;
  state.charts.activityPace?.destroy();
  state.charts.activityPace = null;
  state.charts.activityLoad?.destroy();
  state.charts.activityLoad = null;
  state.charts.activitySplit?.destroy();
  state.charts.activitySplit = null;
  if (activityPrimarySessionsList) activityPrimarySessionsList.innerHTML = '';
  if (activitySessionsList) activitySessionsList.innerHTML = '';
  if (activitySplitsList) activitySplitsList.innerHTML = '';
  if (activityBestEffortsList) activityBestEffortsList.innerHTML = '';
  if (activityBestEffortsBadge) {
    activityBestEffortsBadge.textContent = '';
    activityBestEffortsBadge.className = 'status-chip hidden';
  }
  if (activityBestEffortsHint) {
    activityBestEffortsHint.textContent =
      'Fastest pace and longest-distance efforts from your recent runs.';
  }
  if (activitySessionHint) activitySessionHint.textContent = 'Click a run to inspect details →';
  if (activitySplitTitle) activitySplitTitle.textContent = 'Select a run';
  if (activityWeeklyDistance) activityWeeklyDistance.textContent = '—';
  if (activityWeeklyDuration) activityWeeklyDuration.textContent = '—';
  if (activityAvgPace) activityAvgPace.textContent = '—';
  if (activityLongestRun) activityLongestRun.textContent = '—';
  if (activityTrainingLoad) activityTrainingLoad.textContent = '—';
  if (activityVo2max) activityVo2max.textContent = '—';
  renderActivityWidgetPreview(null);
  if (stravaFeedback) stravaFeedback.textContent = '';
  if (stravaExportButton) {
    stravaExportButton.classList.add('hidden');
    stravaExportButton.disabled = true;
    stravaExportButton.textContent = 'Export to Strava';
  }
  renderSessions([]);
  renderActivityFocus();
  renderActivitySplitChart();
  updateActivityWidgetGoalDraftState();
}

function resetVitalsState() {
  state.vitals = {
    latest: null,
    timeline: [],
    stats: null,
  };
  state.charts.vitalsTrend?.destroy();
  state.charts.vitalsTrend = null;
  if (vitalsRestingHrValue) vitalsRestingHrValue.textContent = '—';
  if (vitalsRestingHrNote) vitalsRestingHrNote.textContent = 'Awaiting vitals sync.';
  if (vitalsHrvValue) vitalsHrvValue.textContent = '—';
  if (vitalsSpo2Value) vitalsSpo2Value.textContent = '—';
  if (vitalsStressValue) vitalsStressValue.textContent = '—';
  if (vitalsBloodPressureValue) vitalsBloodPressureValue.textContent = '—';
  if (vitalsBloodPressureNote) vitalsBloodPressureNote.textContent = 'Connect a cuff to monitor BP trends.';
  if (vitalsGlucoseValue) vitalsGlucoseValue.textContent = '—';
  if (vitalsGlucoseNote) vitalsGlucoseNote.textContent = 'Logs appear once data syncs.';
  if (vitalsFeedback) vitalsFeedback.textContent = '';
  if (vitalsHistoryList) {
    renderListPlaceholder(vitalsHistoryList, 'Vitals sync required to populate history.');
  }
  renderVitalsChart([]);
}

function renderNutritionGoals(goals = {}, totals = null) {
  if (!nutritionGoalList) return;
  nutritionGoalList.innerHTML = '';

  const metrics = [
    { key: 'calories', label: 'Calories', unit: 'kcal' },
    { key: 'protein', label: 'Protein', unit: 'g' },
    { key: 'carbs', label: 'Carbs', unit: 'g' },
    { key: 'fats', label: 'Fats', unit: 'g' },
  ];

  const hasAnyGoal = metrics.some((metric) => Number(goals?.[metric.key]) > 0);
  const hasTotals = totals && typeof totals === 'object';

  if (!hasAnyGoal && !hasTotals) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = 'No nutrition goals set yet.';
    nutritionGoalList.appendChild(empty);
    return;
  }

  metrics.forEach((metric) => {
    const goalValue = Number(goals?.[metric.key]) || 0;
    const actualValue = Number(totals?.[metric.key]) || 0;
    const percent = goalValue ? Math.min(100, Math.round((actualValue / goalValue) * 100)) : 0;
    const detail = goalValue
      ? `${formatNumber(actualValue)} / ${formatNumber(goalValue)} ${metric.unit}`
      : `${formatNumber(actualValue)} ${metric.unit}`;
    const goalText = goalValue ? `${percent}% of goal` : 'Goal not set';
    const card = document.createElement('div');
    card.className = 'nutrition-goal';
    card.innerHTML = `
      <div>
        <span class="small-text">${metric.label}</span>
        <h4>${detail}</h4>
        <span>${goalText}</span>
      </div>
      <div class="progress-track">
        <span style="width:${percent}%;"></span>
      </div>
    `;
    nutritionGoalList.appendChild(card);
  });
}

function normalizeEntryFilter(value) {
  if (value === 'Food' || value === 'Liquid') {
    return value;
  }
  return 'all';
}

function updateNutritionFilterButtons() {
  if (!nutritionEntryFilters) return;
  const buttons = Array.from(nutritionEntryFilters.querySelectorAll('button[data-filter]'));
  buttons.forEach((button) => {
    const datasetValue = button.dataset.filter || 'all';
    const isActive = datasetValue === state.nutritionEntryFilter;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-pressed', String(isActive));
  });
}

function updateNutritionLogSummary(allEntries = [], filteredEntries = []) {
  if (!nutritionLogSummary) return;
  if (!allEntries.length) {
    nutritionLogSummary.textContent = 'No intake logged yet today.';
    return;
  }
  if (!filteredEntries.length) {
    const label = state.nutritionEntryFilter === 'Liquid' ? 'fluids' : 'foods';
    nutritionLogSummary.textContent = `No ${label.toLowerCase()} logged yet today.`;
    return;
  }
  const totals = filteredEntries.reduce(
    (acc, entry) => ({
      calories: acc.calories + (Number(entry.calories) || 0),
      protein: acc.protein + (Number(entry.protein) || 0),
      carbs: acc.carbs + (Number(entry.carbs) || 0),
      fats: acc.fats + (Number(entry.fats) || 0),
      fiber: acc.fiber + (Number(entry.fiber) || 0),
    }),
    { calories: 0, protein: 0, carbs: 0, fats: 0, fiber: 0 }
  );
  const label =
    state.nutritionEntryFilter === 'Liquid'
      ? 'Fluids'
      : state.nutritionEntryFilter === 'Food'
        ? 'Foods'
        : 'All intake';
  const countLabel = `${filteredEntries.length} item${filteredEntries.length === 1 ? '' : 's'}`;
  const segments = [`${label}: ${countLabel}`, `${formatNumber(totals.calories)} kcal`];
  const macrosAvailable = totals.protein > 0 || totals.carbs > 0 || totals.fats > 0 || totals.fiber > 0;
  if (macrosAvailable) {
    const macroLabel = `${Math.round(totals.protein)}g P / ${Math.round(totals.carbs)}g C / ${Math.round(
      totals.fats
    )}g F / ${Math.round(totals.fiber)}g Fiber`;
    segments.push(macroLabel);
  }
  nutritionLogSummary.textContent = segments.join(' • ');
}

function renderNutritionEntries(entries = []) {
  if (!nutritionEntriesList) return;
  const previousScrollTop = nutritionEntriesList.scrollTop;
  const activeFilter = normalizeEntryFilter(state.nutritionEntryFilter);
  const filteredEntries =
    activeFilter === 'all'
      ? entries
      : entries.filter((entry) => (entry.type || 'Food') === activeFilter);

  nutritionEntriesList.innerHTML = '';
  if (!entries.length) {
    nutritionEntriesList.innerHTML = '<li class="empty-row">No intake logged yet today.</li>';
    updateNutritionLogSummary(entries, filteredEntries);
    state.nutritionLogShouldScrollToTop = false;
    return;
  }

  if (!filteredEntries.length) {
    const label = activeFilter === 'Liquid' ? 'fluids' : 'foods';
    nutritionEntriesList.innerHTML = `<li class="empty-row">No ${label} logged yet today.</li>`;
    updateNutritionLogSummary(entries, filteredEntries);
    state.nutritionLogShouldScrollToTop = false;
    return;
  }

  const canEditEntries = canModifyOwnNutrition();
  const fragment = document.createDocumentFragment();
  filteredEntries.forEach((entry, index) => {
    const li = document.createElement('li');
    li.dataset.entryType = entry.type || 'Food';
    li.dataset.entryId = entry.id;
    li.style.animationDelay = `${Math.min(index, 6) * 40}ms`;
    if (state.nutritionPendingDeletes.has(entry.id)) {
      li.classList.add('pending-delete');
    }

    const header = document.createElement('div');
    header.className = 'nutrition-log-row-head';

    const infoBlock = document.createElement('div');
    const title = document.createElement('h4');
    title.textContent = entry.name;
    const meta = document.createElement('p');
    meta.className = 'muted small-text';
    meta.textContent = `${entry.type}${entry.barcode ? ` • #${entry.barcode}` : ''}`;
    infoBlock.appendChild(title);
    infoBlock.appendChild(meta);

    const metaGroup = document.createElement('div');
    metaGroup.className = 'nutrition-log-meta';

    const calorieBadge = document.createElement('span');
    calorieBadge.className = 'badge';
    const calories = Number(entry.calories) || 0;
    calorieBadge.textContent = `${formatNumber(calories)} kcal`;
    metaGroup.appendChild(calorieBadge);

    if (canEditEntries) {
      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'nutrition-delete-btn';
      deleteButton.dataset.action = 'delete-entry';
      deleteButton.dataset.entryId = entry.id;
      const isDeleting = state.nutritionDeletingEntries.has(entry.id) || state.nutritionPendingDeletes.has(entry.id);
      deleteButton.textContent = state.nutritionDeletingEntries.has(entry.id)
        ? 'Removing...'
        : 'Remove';
      deleteButton.disabled = isDeleting;
      deleteButton.setAttribute('aria-label', `Remove ${entry.name}`);
      metaGroup.appendChild(deleteButton);
    }

    header.appendChild(infoBlock);
    header.appendChild(metaGroup);

    const metricsParts = [];
    const unitLabel = entry.weightUnit || getUnitForType(entry.type);
    const displayUnit =
      unitLabel === UNIT_PORTION ? 'serving' : unitLabel || getUnitForType(entry.type);
    const weightAmount = Number(entry.weightAmount);
    if (Number.isFinite(weightAmount) && weightAmount > 0) {
      metricsParts.push(`${formatDecimal(weightAmount)} ${displayUnit}`);
    }
    const protein = Number(entry.protein) || 0;
    const carbs = Number(entry.carbs) || 0;
    const fats = Number(entry.fats) || 0;
    const fiber = Number(entry.fiber) || 0;
    metricsParts.push(`${protein}g P`);
    metricsParts.push(`${carbs}g C`);
    metricsParts.push(`${fats}g F`);
    metricsParts.push(`${fiber}g Fiber`);

    const metrics = document.createElement('div');
    metrics.className = 'nutrition-log-metrics';
    metricsParts.forEach((part) => {
      const span = document.createElement('span');
      span.textContent = part;
      metrics.appendChild(span);
    });

    li.appendChild(header);
    li.appendChild(metrics);
    fragment.appendChild(li);
  });

  nutritionEntriesList.appendChild(fragment);
  enforceScrollableList(nutritionEntriesList, { limit: DEFAULT_LIST_LIMIT });
  updateNutritionLogSummary(entries, filteredEntries);

  const shouldScrollToTop = state.nutritionLogShouldScrollToTop;
  requestAnimationFrame(() => {
    if (shouldScrollToTop) {
      nutritionEntriesList.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      const maxScroll = Math.max(
        0,
        nutritionEntriesList.scrollHeight - nutritionEntriesList.clientHeight
      );
      nutritionEntriesList.scrollTop = Math.min(previousScrollTop, maxScroll);
    }
  });
  state.nutritionLogShouldScrollToTop = false;
}

function setNutritionEntryFilter(nextFilter = 'all', options = {}) {
  const normalized = normalizeEntryFilter(nextFilter);
  const { force = false, render = true, scrollToTop = false } = options;
  const hasChanged = normalized !== state.nutritionEntryFilter;
  if (!hasChanged && !force && !scrollToTop) {
    return;
  }
  state.nutritionEntryFilter = normalized;
  updateNutritionFilterButtons();
  if (scrollToTop) {
    state.nutritionLogShouldScrollToTop = true;
  }
  if (render && (hasChanged || force || scrollToTop)) {
    renderNutritionEntries(state.nutrition.entries || []);
  }
}

function getChronologicalTrend(days = []) {
  if (!Array.isArray(days)) return [];
  return days
    .filter((day) => day && day.date)
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date));
}

function renderNutritionTrend(days = []) {
  if (!nutritionMonthList) return;
  nutritionMonthList.innerHTML = '';
  if (!days.length) {
    nutritionMonthList.innerHTML =
      '<li class="empty-row">No intake logged in the last 30 days.</li>';
    enforceScrollableList(nutritionMonthList);
    return;
  }
  const chronological = getChronologicalTrend(days).reverse();
  chronological.forEach((day) => {
    const percentLabel =
      typeof day.percent === 'number' ? `${day.percent}% of goal` : 'Goal not set';
    const targetLabel = day.targetCalories ? ` / ${formatNumber(day.targetCalories)} kcal` : '';
    const li = document.createElement('li');
    li.innerHTML = `
      <div>
        <strong>${formatDate(day.date)}</strong>
        <p class="trend-meta">${percentLabel}</p>
      </div>
      <div class="trend-meta">
        ${formatNumber(day.calories)} kcal${targetLabel}
      </div>
    `;
    nutritionMonthList.appendChild(li);
  });
  enforceScrollableList(nutritionMonthList);
}

function renderNutritionTrendChart(days = []) {
  const canvasId = 'nutritionTrendChart';
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const sorted = getChronologicalTrend(days);
  if (!sorted.length) {
    state.charts.nutritionTrend?.destroy();
    state.charts.nutritionTrend = null;
    showChartMessage(canvasId, 'Log food in the database to build a calorie trend.');
    return;
  }

  const labels = sorted.map((day) => formatDate(day.date));
  const actualCalories = sorted.map((day) => Number(day.calories) || 0);
  const targetCalories = sorted.map((day) =>
    Number.isFinite(day?.targetCalories) ? Number(day.targetCalories) : null
  );
  const hasTargetData = targetCalories.some((value) => Number.isFinite(value));

  const datasets = [
    {
      label: 'Calories',
      data: actualCalories,
      borderColor: '#4df5ff',
      backgroundColor: 'rgba(77, 245, 255, 0.2)',
      tension: 0.35,
      fill: true,
      pointRadius: 0,
    },
  ];
  if (hasTargetData) {
    datasets.push({
      label: 'Target',
      data: targetCalories,
      borderColor: '#a95dff',
      borderDash: [6, 4],
      tension: 0.35,
      pointRadius: 0,
      spanGaps: true,
      fill: false,
    });
  }

  const { canvas: activeCanvas } = hideChartMessage(canvasId) || {};
  const ctx = (activeCanvas || canvas).getContext('2d');
  state.charts.nutritionTrend?.destroy();
  state.charts.nutritionTrend = createChart(ctx, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: '#dfe6ff' } },
        smartViewport: getSmartViewportOptions({ maxVisiblePoints: 14 }),
      },
      scales: {
        x: { ticks: { color: '#9bb0d6' }, grid: { color: 'rgba(255,255,255,0.05)' } },
        y: { ticks: { color: '#9bb0d6' }, grid: { color: 'rgba(255,255,255,0.05)' } },
      },
    },
  });
}

function renderMacroHistoryChart(days = [], goals = null) {
  const canvasId = 'nutritionMacroTrendChart';
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const sorted = getChronologicalTrend(days);
  const hasMacros = sorted.some(
    (day) =>
      Number(day?.protein) > 0 ||
      Number(day?.carbs) > 0 ||
      Number(day?.fats) > 0 ||
      Number(day?.fiber) > 0 ||
      Number(day?.calories) > 0
  );
  if (!sorted.length || !hasMacros) {
    state.charts.nutritionMacroTrend?.destroy();
    state.charts.nutritionMacroTrend = null;
    showChartMessage(canvasId, 'Log macros in the database to reveal the trend.');
    return;
  }

  const labels = sorted.map((day) => formatDate(day.date));
  const buildSeries = (key) =>
    sorted.map((day) => {
      const value = Number(day?.[key]);
      return Number.isFinite(value) && value > 0 ? value : 0;
    });

  const macroConfigs = [
    { key: 'protein', label: 'Protein (g)', border: '#27d2fe', background: 'rgba(39, 210, 254, 0.12)' },
    { key: 'carbs', label: 'Carbs (g)', border: '#5f6bff', background: 'rgba(95, 107, 255, 0.12)' },
    { key: 'fats', label: 'Fats (g)', border: '#a95dff', background: 'rgba(169, 93, 255, 0.12)' },
    { key: 'fiber', label: 'Fiber (g)', border: '#5fd38d', background: 'rgba(95, 211, 141, 0.14)' },
  ];

  const datasets = macroConfigs.map((config) => ({
    label: config.label,
    data: buildSeries(config.key),
    borderColor: config.border,
    backgroundColor: config.background,
    tension: 0.35,
    fill: false,
    pointRadius: 0,
  }));

  macroConfigs.forEach((config) => {
    const goalValue = Number(goals?.[config.key]);
    if (!Number.isFinite(goalValue) || goalValue <= 0) return;
    datasets.push({
      label: `${config.label.replace(' (g)', '')} goal`,
      data: Array(labels.length).fill(goalValue),
      borderColor: config.border,
      borderDash: [6, 4],
      tension: 0,
      fill: false,
      pointRadius: 0,
    });
  });

  const { canvas: activeCanvas } = hideChartMessage(canvasId) || {};
  const ctx = (activeCanvas || canvas).getContext('2d');
  state.charts.nutritionMacroTrend?.destroy();
  state.charts.nutritionMacroTrend = createChart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets,
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: '#dfe6ff' } },
        smartViewport: getSmartViewportOptions({ maxVisiblePoints: 14 }),
      },
      scales: {
        x: { ticks: { color: '#9bb0d6' }, grid: { color: 'rgba(255,255,255,0.05)' } },
        y: { ticks: { color: '#9bb0d6' }, grid: { color: 'rgba(255,255,255,0.05)' } },
      },
    },
  });
}

// ── Today's macro split doughnut ─────────────────────────────────────────
function renderMacroDonutChart(totals = null) {
  const canvasId = 'nutritionMacroDonutChart';
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const protein = Number(totals?.protein) || 0;
  const carbs   = Number(totals?.carbs)   || 0;
  const fats    = Number(totals?.fats)    || 0;
  const total   = protein + carbs + fats;
  if (!total) {
    state.charts.nutritionMacroDonut?.destroy();
    state.charts.nutritionMacroDonut = null;
    showChartMessage(canvasId, 'Log macros today to see the current split.');
    return;
  }
  const dProtein = protein;
  const dCarbs = carbs;
  const dFats = fats;
  const dTotal = total || 1;
  const { canvas: activeCanvas } = hideChartMessage(canvasId) || {};
  const ctx = (activeCanvas || canvas).getContext('2d');
  state.charts.nutritionMacroDonut?.destroy();
  state.charts.nutritionMacroDonut = createChart(ctx, {
    type: 'doughnut',
    data: {
      labels: [
        `Protein — ${dProtein}g (${Math.round((dProtein / dTotal) * 100)}%)`,
        `Carbs — ${dCarbs}g (${Math.round((dCarbs / dTotal) * 100)}%)`,
        `Fats — ${dFats}g (${Math.round((dFats / dTotal) * 100)}%)`,
      ],
      datasets: [{
        data: [dProtein, dCarbs, dFats],
        backgroundColor: ['rgba(39,210,254,0.82)', 'rgba(95,107,255,0.82)', 'rgba(169,93,255,0.82)'],
        borderColor:     ['#27d2fe', '#5f6bff', '#a95dff'],
        borderWidth: 2,
        hoverOffset: 8,
      }],
    },
    options: {
      cutout: '65%',
      plugins: {
        legend: {
          position: 'bottom',
          labels: { color: '#9bb0d6', padding: 14, font: { size: 11, weight: '600' } },
        },
        tooltip: {
          callbacks: {
            label: (ctx) => ` ${ctx.raw}g  (${Math.round((ctx.raw / dTotal) * 100)}%)`,
          },
        },
      },
      responsive: true,
      maintainAspectRatio: true,
    },
  });
}

// ── Daily calorie surplus / deficit bar chart ─────────────────────────────
function renderSurplusChart(days = []) {
  const canvasId = 'nutritionSurplusChart';
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const sorted = getChronologicalTrend(days).slice(-14);
  const withTarget = sorted.filter(
    (d) => Number.isFinite(Number(d?.targetCalories)) && Number(d.targetCalories) > 0
  );
  if (!withTarget.length) {
    state.charts.nutritionSurplus?.destroy();
    state.charts.nutritionSurplus = null;
    showChartMessage(canvasId, 'Set calorie targets and log meals to compare surplus vs deficit.');
    return;
  }
  const labels = withTarget.map((d) => formatDate(d.date));
  const surpluses = withTarget.map((d) =>
    Math.round(Number(d.calories) - Number(d.targetCalories))
  );
  const bgColors   = surpluses.map((v) => v >= 0 ? 'rgba(255,107,129,0.75)' : 'rgba(45,212,191,0.75)');
  const bdColors   = surpluses.map((v) => v >= 0 ? '#ff6b81' : '#2dd4bf');
  const { canvas: activeCanvas } = hideChartMessage(canvasId) || {};
  const ctx = (activeCanvas || canvas).getContext('2d');
  state.charts.nutritionSurplus?.destroy();
  state.charts.nutritionSurplus = createChart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'kcal vs target',
        data: surpluses,
        backgroundColor: bgColors,
        borderColor:     bdColors,
        borderWidth: 1,
        borderRadius: 4,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const v = ctx.raw;
              return v >= 0 ? ` +${v} kcal surplus` : ` ${v} kcal deficit`;
            },
          },
        },
      },
      scales: {
        x: { ticks: { color: '#9bb0d6' }, grid: { color: 'rgba(255,255,255,0.05)' } },
        y: { ticks: { color: '#9bb0d6' }, grid: { color: 'rgba(255,255,255,0.05)' } },
      },
    },
  });
}

function computeAverage(values = []) {
  if (!values.length) return null;
  const total = values.reduce((sum, value) => sum + value, 0);
  return total / values.length;
}

function renderNutritionInsights(data = {}) {
  if (!nutritionInsightSummary) return;
  const metricKey = nutritionInsightSelect?.value || 'calories';
  const metric = NUTRITION_METRICS[metricKey] || NUTRITION_METRICS.calories;
  const sorted = getChronologicalTrend(data.monthTrend || []);
  if (!sorted.length) {
    nutritionInsightSummary.textContent = 'Log more days to unlock insights.';
    if (nutritionInsightFlag) {
      nutritionInsightFlag.classList.add('hidden');
      nutritionInsightFlag.classList.remove('positive', 'negative');
    }
    return;
  }

  const values = sorted
    .map((day) => Number(day?.[metric.key]) || 0)
    .filter((value) => Number.isFinite(value));
  if (!values.length) {
    nutritionInsightSummary.textContent = 'Need recorded data for that metric.';
    if (nutritionInsightFlag) {
      nutritionInsightFlag.classList.add('hidden');
      nutritionInsightFlag.classList.remove('positive', 'negative');
    }
    return;
  }

  const lastWeekValues = values.slice(-7);
  const previousWeekValues = values.slice(-14, -7);
  const avgCurrent = computeAverage(lastWeekValues);
  const avgPrevious = computeAverage(previousWeekValues);
  if (!avgCurrent) {
    nutritionInsightSummary.textContent = 'Log at least a week of data for this view.';
    if (nutritionInsightFlag) {
      nutritionInsightFlag.classList.add('hidden');
      nutritionInsightFlag.classList.remove('positive', 'negative');
    }
    return;
  }

  const roundedAvg =
    metric.unit === 'kcal' ? Math.round(avgCurrent) : Math.round(avgCurrent * 10) / 10;
  let summary = `Past 7-day average: ${formatNumber(roundedAvg)} ${metric.unit}.`;

  let comparisonTarget = null;
  if (metric.key === 'calories') {
    comparisonTarget =
      Number(data.goals?.calories) || Number(sorted[sorted.length - 1]?.targetCalories);
  } else {
    comparisonTarget = Number(data.goals?.[metric.key]);
  }

  if (Number.isFinite(comparisonTarget) && comparisonTarget > 0) {
    const ratio = (avgCurrent / comparisonTarget) * 100;
    summary += ` That's ${Math.round(ratio)}% of your goal (${formatNumber(
      Math.round(comparisonTarget)
    )} ${metric.unit}).`;
  } else if (Number.isFinite(avgPrevious) && avgPrevious > 0) {
    const deltaPercent = ((avgCurrent - avgPrevious) / avgPrevious) * 100;
    const direction = deltaPercent >= 0 ? 'Up' : 'Down';
    summary += ` ${direction} ${Math.abs(Math.round(deltaPercent))}% versus the prior week.`;
  }

  nutritionInsightSummary.textContent = summary;

  let trackerText = '';
  let trackerClass = '';
  const threshold = 0.15;
  if (Number.isFinite(comparisonTarget) && comparisonTarget > 0) {
    const diffPercent = (avgCurrent - comparisonTarget) / comparisonTarget;
    if (Math.abs(diffPercent) >= threshold) {
      const direction = diffPercent > 0 ? 'Up' : 'Down';
      trackerText = `${direction} ${Math.abs(Math.round(diffPercent * 100))}% vs goal`;
      trackerClass = diffPercent > 0 ? 'positive' : 'negative';
    }
  } else if (Number.isFinite(avgPrevious) && avgPrevious > 0) {
    const diffPercent = (avgCurrent - avgPrevious) / avgPrevious;
    if (Math.abs(diffPercent) >= threshold) {
      const direction = diffPercent > 0 ? 'Up' : 'Down';
      trackerText = `${direction} ${Math.abs(Math.round(diffPercent * 100))}% vs prior week`;
      trackerClass = diffPercent > 0 ? 'positive' : 'negative';
    }
  }

  if (nutritionInsightFlag) {
    if (trackerText) {
      nutritionInsightFlag.textContent = trackerText;
      nutritionInsightFlag.classList.remove('hidden', 'positive', 'negative');
      nutritionInsightFlag.classList.add(trackerClass || 'positive');
    } else {
      nutritionInsightFlag.classList.add('hidden');
      nutritionInsightFlag.classList.remove('positive', 'negative');
    }
  }
}

function defaultMacroTargetDate() {
  return state.nutrition?.date || new Date().toISOString().slice(0, 10);
}

function syncMacroTargetFields(goals = {}) {
  if (macroTargetDateInput) {
    macroTargetDateInput.value = defaultMacroTargetDate();
  }
  const mappings = [
    { input: macroTargetCaloriesInput, key: 'calories' },
    { input: macroTargetProteinInput, key: 'protein' },
    { input: macroTargetCarbsInput, key: 'carbs' },
    { input: macroTargetFatsInput, key: 'fats' },
  ];
  mappings.forEach(({ input, key }) => {
    if (!input) return;
    const numeric = Number(goals?.[key]);
    input.value = Number.isFinite(numeric) && numeric > 0 ? numeric : '';
  });
}

function getActiveNutritionDate() {
  return state.nutrition?.date || getTodayIsoDate();
}

function syncNutritionDateControls(dateValue) {
  const todayIso = getTodayIsoDate();
  const normalized = normalizeIsoDate(dateValue) || todayIso;
  if (nutritionDatePrimary) {
    nutritionDatePrimary.textContent = normalized === todayIso ? 'Today' : formatDate(normalized);
  }
  if (nutritionDateSubtitle) {
    nutritionDateSubtitle.textContent = formatFullDate(normalized);
  }
  if (nutritionDateInput) {
    nutritionDateInput.value = normalized;
    nutritionDateInput.max = todayIso;
  }
  if (nutritionNextDayButton) {
    nutritionNextDayButton.disabled = normalized >= todayIso;
  }
  if (nutritionTodayButton) {
    nutritionTodayButton.disabled = normalized === todayIso;
  }
}

function requestNutritionDate(targetDate) {
  const normalized = normalizeIsoDate(targetDate) || getTodayIsoDate();
  if (state.nutrition) {
    if (state.nutrition.date === normalized) {
      syncNutritionDateControls(normalized);
      return;
    }
    state.nutrition.date = normalized;
  }
  syncNutritionDateControls(normalized);
  loadNutrition(getActiveSubjectId(), { date: normalized });
}

function openNutritionDatePicker() {
  const todayIso = getTodayIsoDate();
  const active = getActiveNutritionDate();
  if (nutritionDateInput && typeof nutritionDateInput.showPicker === 'function') {
    nutritionDateInput.value = active;
    nutritionDateInput.max = todayIso;
    nutritionDateInput.showPicker();
    return;
  }
  const fallback = window.prompt('Enter a date (YYYY-MM-DD)', active);
  if (!fallback) return;
  const normalized = normalizeIsoDate(fallback);
  if (!normalized) {
    window.alert('Please enter a valid date in YYYY-MM-DD format.');
    return;
  }
  requestNutritionDate(normalized);
}

function renderNutritionDashboard(data = {}) {
  const activeDate = normalizeIsoDate(data.date) || getActiveNutritionDate();
  syncNutritionDateControls(activeDate);
  if (nutritionEntryCount) {
    const count = data.dailyTotals?.count || 0;
    nutritionEntryCount.textContent = count
      ? `${count} item${count === 1 ? '' : 's'} logged`
      : 'No items logged yet';
  }
  if (nutritionLogDateLabel) {
    const todayIso = getTodayIsoDate();
    const descriptor =
      activeDate === todayIso ? 'Viewing today' : `Viewing ${formatFullDate(activeDate)}`;
    nutritionLogDateLabel.textContent = descriptor;
  }
  renderNutritionGoals(data.goals, data.dailyTotals);
  renderNutritionEntries(data.entries);
  renderNutritionTrend(data.monthTrend);
  renderNutritionTrendChart(data.monthTrend);
  renderMacroHistoryChart(data.monthTrend, data.goals);
  renderNutritionInsights(data);
  renderMacroDonutChart(data.dailyTotals);
  renderSurplusChart(data.monthTrend);
  syncMacroTargetFields(data.goals);
  updateNutritionPreview();
  rerenderOverviewFromState();
  queueChartResize();
}

function renderWeightDashboard(data = {}) {
  const timeline = Array.isArray(data.timeline) ? data.timeline.slice() : [];
  const recent = Array.isArray(data.recent) ? data.recent.slice() : [];
  const latest = data.latest || (timeline.length ? timeline[timeline.length - 1] : null);
  const activeHeight =
    Number.isFinite(state.weight?.heightCm) && state.weight.heightCm > 0
      ? state.weight.heightCm
      : resolveStoredHeight(getActiveSubjectId());
  state.weight.heightCm = activeHeight;
  renderWeightSummary(latest, data.stats || null, data.goalCalories ?? null);
  renderWeightBodyMetrics(latest, activeHeight);
  const rows = recent.length ? recent : timeline.slice(-10).reverse();
  renderWeightLog(rows);
  renderWeightChart(timeline, data.goalCalories ?? null);
}

function renderWeightSummary(latest, stats, goalCalories) {
  if (weightLatestValue) {
    weightLatestValue.textContent = Number.isFinite(latest?.weightLbs)
      ? `${formatDecimal(latest.weightLbs)} lb`
      : '—';
  }
  if (weightLatestSecondary) {
    weightLatestSecondary.textContent = Number.isFinite(latest?.weightKg)
      ? `${formatDecimal(latest.weightKg)} kg`
      : '';
  }
  if (weightLatestDate) {
    weightLatestDate.textContent = latest?.date
      ? `Logged ${formatDate(latest.date)}`
      : 'Log a weigh-in to begin';
  }
  if (weightAverageValue) {
    weightAverageValue.textContent = Number.isFinite(stats?.avgWeightLbs)
      ? `${formatDecimal(stats.avgWeightLbs)} lb`
      : '—';
  }
  if (weightChangeValue) {
    const delta = Number.isFinite(stats?.weeklyChangeLbs)
      ? formatSignedValue(stats.weeklyChangeLbs, ' lb')
      : null;
    weightChangeValue.textContent = delta || '—';
  }
  if (weightCaloriesAvg) {
    weightCaloriesAvg.textContent = Number.isFinite(stats?.caloriesAvg)
      ? `${formatNumber(stats.caloriesAvg)} kcal`
      : '—';
  }
  if (weightCaloriesInsight) {
    let insight = 'Log weight regularly to align nutrition with your target.';
    if (Number.isFinite(stats?.caloriesAvg)) {
      const targetLabel = Number.isFinite(goalCalories)
        ? ` vs ${formatNumber(goalCalories)} goal`
        : '';
      let deltaText = '';
      if (Number.isFinite(stats?.caloriesDeltaFromGoal) && Number.isFinite(goalCalories)) {
        const delta = stats.caloriesDeltaFromGoal;
        const sign = delta > 0 ? '+' : delta < 0 ? '-' : '';
        const magnitude = formatNumber(Math.abs(delta));
        deltaText = ` (${sign}${magnitude} kcal from goal)`;
      }
      insight = `Avg intake ${formatNumber(stats.caloriesAvg)} kcal${targetLabel}${deltaText}`;
    }
    weightCaloriesInsight.textContent = insight;
  }
}

function renderWeightBodyMetrics(latest, heightCm = DEFAULT_HEIGHT_CM) {
  const weightKg = Number.isFinite(latest?.weightKg) ? latest.weightKg : null;
  const weightLbs = Number.isFinite(latest?.weightLbs) ? latest.weightLbs : null;
  const bmi = computeBmi(weightKg, heightCm);
  const descriptor = classifyBmi(bmi);
  if (weightBmiValue) {
    weightBmiValue.textContent = Number.isFinite(bmi) ? bmi.toFixed(1) : '—';
  }
  if (weightBmiLabel) {
    weightBmiLabel.textContent = descriptor.label;
    weightBmiLabel.classList.remove('neutral', 'success', 'warning', 'danger');
    weightBmiLabel.classList.add(descriptor.className);
  }
  if (weightBmiLatest) {
    if (weightKg || weightLbs) {
      const parts = [];
      if (weightKg) parts.push(`${formatDecimal(weightKg)} kg`);
      if (weightLbs) parts.push(`${formatDecimal(weightLbs)} lb`);
      weightBmiLatest.textContent = parts.join(' · ');
    } else {
      weightBmiLatest.textContent = '—';
    }
  }
  if (weightBmiUpdated) {
    weightBmiUpdated.textContent = latest?.date
      ? `Updated ${formatDate(latest.date)}`
      : 'Log weight to unlock BMI insights.';
  }
  if (weightHeightValue) {
    weightHeightValue.textContent = `${heightCm} cm · ${formatFeetInches(heightCm)}`;
  }
  if (weightHeightInput && !weightHeightEditing) {
    weightHeightInput.value = String(heightCm);
  }
}

function renderWeightLog(entries = []) {
  if (!weightLogList) return;
  weightLogList.innerHTML = '';
  if (!entries.length) {
    renderListPlaceholder(weightLogList, 'Log weight to build a trend.');
    return;
  }
  const canDelete = viewingOwnProfile();
  entries.forEach((entry, index) => {
    const previous = entries[index + 1];
    const delta =
      Number.isFinite(entry?.weightLbs) && Number.isFinite(previous?.weightLbs)
        ? entry.weightLbs - previous.weightLbs
        : null;
    const deltaLabel = delta === null ? 'First entry' : `${formatSignedValue(delta, ' lb')} vs prior`;
    const caloriesLabel = Number.isFinite(entry?.calories)
      ? `${formatNumber(entry.calories)} kcal`
      : 'No calorie data';
    const weightLabel = Number.isFinite(entry?.weightLbs)
      ? `${formatDecimal(entry.weightLbs)} lb`
      : '—';
    const li = document.createElement('li');
    const deleteButton =
      canDelete && Number.isFinite(entry?.id)
        ? `
        <button
          type="button"
          class="weight-log-delete"
          data-weight-delete="true"
          data-weight-id="${entry.id}">
          Delete
        </button>`
        : '';
    li.innerHTML = `
      <div>
        <p class="weight-log-meta">${formatDate(entry.date)}</p>
        <p class="weight-log-meta">${caloriesLabel}</p>
      </div>
      <div class="weight-log-actions">
        <div class="weight-log-values">
          <p class="weight-log-value">${weightLabel}</p>
          <p class="weight-log-delta">${deltaLabel}</p>
        </div>
        ${deleteButton}
      </div>
    `;
    weightLogList.appendChild(li);
  });
  enforceScrollableList(weightLogList);
}

function renderWeightChart(timeline = [], goalCalories) {
  const canvasId = 'weightTrendChart';
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  if (!timeline.length) {
    state.charts.weightTrend?.destroy();
    state.charts.weightTrend = null;
    showChartMessage(canvasId, 'Log weight entries to unlock trends.');
    return;
  }

  const chronological = timeline
    .slice()
    .sort((a, b) => new Date(a?.date || 0).getTime() - new Date(b?.date || 0).getTime());
  const labels = chronological.map((entry) => formatDate(entry.date));
  const weights = chronological.map((entry) =>
    Number.isFinite(entry?.weightLbs) ? Math.round(entry.weightLbs * 10) / 10 : null
  );
  const calories = chronological.map((entry) =>
    Number.isFinite(entry?.calories) ? Math.round(entry.calories) : null
  );
  const hasCalories = calories.some((value) => Number.isFinite(value));
  const datasets = [
    {
      type: 'line',
      label: 'Weight (lb)',
      data: weights,
      borderColor: '#ffb347',
      backgroundColor: 'rgba(255, 179, 71, 0.2)',
      tension: 0.35,
      fill: false,
      pointRadius: 0,
      spanGaps: true,
      yAxisID: 'weight',
    },
  ];

  if (hasCalories) {
    datasets.push({
      type: 'bar',
      label: 'Calories',
      data: calories,
      backgroundColor: 'rgba(95, 107, 255, 0.35)',
      borderRadius: 6,
      yAxisID: 'calories',
    });
  }

  if (Number.isFinite(goalCalories)) {
    datasets.push({
      type: 'line',
      label: 'Calorie goal',
      data: Array(labels.length).fill(goalCalories),
      borderColor: '#27d2fe',
      borderDash: [6, 4],
      pointRadius: 0,
      tension: 0,
      spanGaps: true,
      yAxisID: 'calories',
    });
  }

  const { canvas: activeCanvas } = hideChartMessage(canvasId) || {};
  const ctx = (activeCanvas || canvas).getContext('2d');
  state.charts.weightTrend?.destroy();
  const showCaloriesAxis = hasCalories || Number.isFinite(goalCalories);
  const scales = {
    x: { ticks: { color: '#9bb0d6' }, grid: { color: 'rgba(255,255,255,0.05)' } },
    weight: {
      type: 'linear',
      position: 'left',
      ticks: { color: '#ffd7a8' },
      grid: { color: 'rgba(255,255,255,0.05)' },
    },
  };
  if (showCaloriesAxis) {
    scales.calories = {
      type: 'linear',
      position: 'right',
      ticks: { color: '#9bb0d6' },
      grid: { drawOnChartArea: false, color: 'rgba(255,255,255,0.05)' },
    };
  }
  state.charts.weightTrend = createChart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets,
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: '#dfe6ff' } },
        smartViewport: getSmartViewportOptions({ maxVisiblePoints: 16 }),
      },
      scales,
    },
  });
}

function setWeightDateDefault(dateString) {
  if (!weightDateInput) return;
  const parsed = dateString ? new Date(dateString) : new Date();
  const isValid = !Number.isNaN(parsed.getTime());
  const target = isValid ? parsed : new Date();
  weightDateInput.value = target.toISOString().slice(0, 10);
}

function setWeightHeightEditing(editing) {
  weightHeightEditing = Boolean(editing);
  if (weightHeightForm) {
    weightHeightForm.classList.toggle('hidden', !weightHeightEditing);
  }
  if (weightHeightDisplay) {
    weightHeightDisplay.classList.toggle('hidden', weightHeightEditing);
  }
  if (weightHeightEditToggle) {
    weightHeightEditToggle.textContent = weightHeightEditing ? 'Close height editor' : 'Adjust height';
  }
  if (weightHeightFeedback && !weightHeightEditing) {
    weightHeightFeedback.textContent = '';
  }
  if (weightHeightEditing && weightHeightInput) {
    weightHeightInput.value = String(state.weight.heightCm || DEFAULT_HEIGHT_CM);
    weightHeightInput.focus();
    weightHeightInput.select();
  }
}

function handleWeightHeightSubmit(event) {
  event.preventDefault();
  if (!weightHeightInput) return;
  const normalized = sanitizeHeight(weightHeightInput.value);
  if (!normalized) {
    if (weightHeightFeedback) {
      weightHeightFeedback.textContent = 'Enter height in centimeters (120-240).';
    }
    return;
  }
  const subjectId = getActiveSubjectId();
  updateStoredHeight(subjectId, normalized);
  state.weight.heightCm = normalized;
  renderWeightDashboard(state.weight);
  if (weightHeightFeedback) {
    weightHeightFeedback.textContent = 'Height saved for BMI calculations.';
  }
  setWeightHeightEditing(false);
}

function updateWeightFormVisibility() {
  if (!weightForm) return;
  const ownsProfile = viewingOwnProfile();
  const fields = weightForm.querySelectorAll('input, select, button');
  fields.forEach((field) => {
    field.disabled = !ownsProfile;
  });
  if (weightFormHint) {
    weightFormHint.textContent = ownsProfile
      ? 'Only you can log weight for your own profile.'
      : 'Switch back to your profile to log weight.';
  }
  if (!ownsProfile && weightFeedback) {
    weightFeedback.textContent = '';
  }
}

function resetWeightState() {
  const preservedHeight =
    state.weight?.heightCm && Number.isFinite(state.weight.heightCm)
      ? state.weight.heightCm
      : resolveStoredHeight(getActiveSubjectId());
  state.weight = {
    timeline: [],
    recent: [],
    latest: null,
    stats: null,
    goalCalories: null,
    heightCm: preservedHeight,
  };
  renderWeightDashboard(state.weight);
}

function renderAmountReference() {
  if (!nutritionAmountReferenceText) return;
  const reference = state.nutritionAmountReference;
  if (reference && Number.isFinite(reference.amount)) {
    const parts = [`${formatDecimal(reference.amount)} ${reference.unit || getSelectedUnit()}`];
    if (
      reference.unit !== UNIT_FOOD &&
      Number.isFinite(reference.gramsEquivalent) &&
      reference.gramsEquivalent > 0
    ) {
      parts.push(`${formatDecimal(reference.gramsEquivalent)} g`);
    }
    if (
      reference.unit !== UNIT_LIQUID &&
      Number.isFinite(reference.mlEquivalent) &&
      reference.mlEquivalent > 0
    ) {
      parts.push(`${formatDecimal(reference.mlEquivalent)} ml`);
    }
    nutritionAmountReferenceText.textContent = `Base: ${parts.join(' • ')}`;
  } else {
    nutritionAmountReferenceText.textContent = '';
  }
}

function setAmountReference(amount, unit, extras = {}) {
  if (Number.isFinite(amount) && amount > 0) {
    const normalizedUnit = VALID_UNITS.has(unit) ? unit : getSelectedUnit();
    state.nutritionAmountReference = {
      amount: Number(amount),
      unit: normalizedUnit,
      gramsEquivalent:
        Number.isFinite(extras.gramsEquivalent) && extras.gramsEquivalent > 0
          ? Number(extras.gramsEquivalent)
          : normalizedUnit === UNIT_FOOD
            ? Number(amount)
            : normalizedUnit === UNIT_OZ
              ? Number(amount) * OZ_TO_GRAMS
              : null,
      mlEquivalent:
        Number.isFinite(extras.mlEquivalent) && extras.mlEquivalent > 0
          ? Number(extras.mlEquivalent)
          : normalizedUnit === UNIT_LIQUID
            ? Number(amount)
            : null,
    };
  } else {
    state.nutritionAmountReference = null;
  }
  renderAmountReference();
  updateNutritionPreview();
}

function normalizeWeightForInput(amount, unit, extras = {}, options = {}) {
  const fallbackType = options.fallbackType || nutritionTypeSelect?.value || 'Food';
  const fallbackUnit = options.fallbackUnit || getUnitForType(fallbackType);
  let normalizedAmount = Number(amount);
  if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
    normalizedAmount = null;
  }
  let normalizedUnit = unit || fallbackUnit;
  const normalizedExtras = { ...extras };
  const gramsEquivalent =
    Number.isFinite(extras.gramsEquivalent) && extras.gramsEquivalent > 0
      ? Number(extras.gramsEquivalent)
      : null;
  const mlEquivalent =
    Number.isFinite(extras.mlEquivalent) && extras.mlEquivalent > 0 ? Number(extras.mlEquivalent) : null;

  if (normalizedUnit === UNIT_PORTION) {
    if (Number.isFinite(gramsEquivalent)) {
      normalizedAmount = gramsEquivalent;
      normalizedUnit = UNIT_FOOD;
      normalizedExtras.gramsEquivalent = gramsEquivalent;
    } else if (Number.isFinite(mlEquivalent)) {
      normalizedAmount = mlEquivalent;
      normalizedUnit = UNIT_LIQUID;
      normalizedExtras.mlEquivalent = mlEquivalent;
    } else if (Number.isFinite(normalizedAmount)) {
      normalizedUnit = UNIT_FOOD;
    } else {
      normalizedUnit = fallbackUnit;
    }
  }

  if (!VALID_UNITS.has(normalizedUnit)) {
    normalizedUnit = fallbackUnit;
  }

  return {
    amount: normalizedAmount,
    unit: normalizedUnit,
    extras: normalizedExtras,
  };
}

function clearSuggestions() {
  if (state.suggestionTimer) {
    clearTimeout(state.suggestionTimer);
    state.suggestionTimer = null;
  }
  state.suggestionQuery = '';
  state.suggestions = [];
  state.activeSuggestionIndex = -1;
  state.nutritionSuggestionStatus = 'idle';
  if (nutritionSuggestions) {
    nutritionSuggestions.innerHTML = '';
    nutritionSuggestions.classList.add('hidden');
  }
  if (nutritionNameInput) {
    nutritionNameInput.removeAttribute('aria-activedescendant');
    nutritionNameInput.setAttribute('aria-expanded', 'false');
  }
  updateNutritionLookupButtonLabel();
}

function renderSuggestionStatus(message, className = 'suggestion-loading') {
  state.suggestions = [];
  state.activeSuggestionIndex = -1;
  state.nutritionSuggestionStatus = className === 'suggestion-loading' ? 'loading' : 'empty';
  if (!nutritionSuggestions) {
    updateNutritionLookupButtonLabel();
    return;
  }
  nutritionSuggestions.innerHTML = '';
  const li = document.createElement('li');
  li.className = className;
  li.textContent = message;
  nutritionSuggestions.appendChild(li);
  nutritionSuggestions.classList.remove('hidden');
  if (nutritionNameInput) {
    nutritionNameInput.removeAttribute('aria-activedescendant');
    nutritionNameInput.setAttribute('aria-expanded', 'true');
  }
  updateNutritionLookupButtonLabel();
}

function getNutritionSuggestionKey(item = {}) {
  const barcode = String(item?.barcode || item?.prefill?.barcode || '').trim();
  if (barcode) {
    return `barcode:${barcode}`;
  }
  return `name:${normalizeNutritionSearchText(item?.name || '')}`;
}

function dedupeNutritionSuggestions(items = []) {
  const seen = new Set();
  return (Array.isArray(items) ? items : []).filter((item) => {
    const key = getNutritionSuggestionKey(item);
    if (!key || key === 'name:') {
      return false;
    }
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function getLocalNutritionSuggestions(query = '') {
  const recent = loadRecentNutritionItems().map((item, index) => ({
    ...item,
    source: item.source || 'Recent',
    _recentIndex: index,
  }));
  const localSuggestions = dedupeNutritionSuggestions([
    ...recent,
    ...QUICK_SUGGESTIONS.map((item) => ({ ...item, _recentIndex: Number.POSITIVE_INFINITY })),
  ]);
  if (!query.trim()) {
    return localSuggestions.slice(0, 6);
  }
  return rankNutritionSuggestions(localSuggestions, query, {
    preferredType: nutritionTypeSelect?.value || 'Food',
  });
}

function normalizePhotoDetectedFoods(photoAnalysis, { minConfidence = 0.08, maxItems = 6 } = {}) {
  const source = Array.isArray(photoAnalysis?.detectedFoods)
    ? photoAnalysis.detectedFoods
    : Array.isArray(photoAnalysis?.topMatches)
      ? photoAnalysis.topMatches
      : [];
  const foods = [];
  const seen = new Set();
  source.forEach((entry, index) => {
    if (foods.length >= maxItems) {
      return;
    }
    const name = typeof entry?.name === 'string' ? entry.name.trim() : '';
    if (!name) {
      return;
    }
    const key = name.toLowerCase();
    if (seen.has(key)) {
      return;
    }
    const confidenceRaw = Number(entry?.confidence);
    const confidence =
      Number.isFinite(confidenceRaw) && confidenceRaw >= 0 && confidenceRaw <= 1
        ? Number(confidenceRaw.toFixed(4))
        : null;
    if (confidence !== null && confidence < minConfidence) {
      return;
    }
    seen.add(key);
    foods.push({
      id: `photo-${index}-${key.replace(/\s+/g, '-')}`,
      name,
      confidence,
    });
  });
  return foods;
}

function applyPhotoDetectedSuggestions(foods = []) {
  state.suggestions = foods.map((food) => ({
    id: food.id,
    name: food.name,
    source: 'Photo analysis',
    serving:
      Number.isFinite(food.confidence) && food.confidence >= 0
        ? `${Math.round(food.confidence * 100)}% confidence`
        : 'Detected from photo',
  }));
  state.activeSuggestionIndex = -1;
  renderSuggestions();
  if (nutritionNameInput && !nutritionNameInput.value.trim() && foods[0]?.name) {
    nutritionNameInput.value = foods[0].name;
    maybeAutoSelectLiquid(foods[0].name);
  }
}

function renderSuggestions() {
  if (!nutritionSuggestions) return;
  nutritionSuggestions.innerHTML = '';
  if (!state.suggestions.length) {
    const activeQuery = nutritionNameInput?.value?.trim();
    if (activeQuery) {
      const li = document.createElement('li');
      li.className = 'suggestion-empty';
      li.textContent = NUTRITION_EMPTY_STATE_MESSAGE;
      nutritionSuggestions.appendChild(li);
      nutritionSuggestions.classList.remove('hidden');
      if (nutritionNameInput) {
        nutritionNameInput.removeAttribute('aria-activedescendant');
        nutritionNameInput.setAttribute('aria-expanded', 'true');
      }
    } else {
      nutritionSuggestions.classList.add('hidden');
      if (nutritionNameInput) {
        nutritionNameInput.removeAttribute('aria-activedescendant');
        nutritionNameInput.setAttribute('aria-expanded', 'false');
      }
    }
    updateNutritionLookupButtonLabel();
    return;
  }
  nutritionSuggestions.classList.remove('hidden');
  if (nutritionNameInput) {
    nutritionNameInput.setAttribute('aria-expanded', 'true');
  }
  state.suggestions.forEach((item, index) => {
    const li = document.createElement('li');
    li.setAttribute('role', 'option');
    li.id = `nutritionSuggestionOption-${index}`;
    li.dataset.index = index;
    li.classList.toggle('active', index === state.activeSuggestionIndex);
    li.setAttribute('aria-selected', String(index === state.activeSuggestionIndex));
    const metaParts = [];
    const calories = Number(item?.prefill?.calories);
    if (Number.isFinite(calories) && calories >= 0) {
      metaParts.push(`${formatNumber(calories)} kcal`);
    }
    const protein = Number(item?.prefill?.protein);
    const carbs = Number(item?.prefill?.carbs);
    const fats = Number(item?.prefill?.fats);
    const macroSummary = [];
    if (Number.isFinite(protein) && protein >= 0) macroSummary.push(`P ${formatDecimal(protein, 1)} g`);
    if (Number.isFinite(carbs) && carbs >= 0) macroSummary.push(`C ${formatDecimal(carbs, 1)} g`);
    if (Number.isFinite(fats) && fats >= 0) macroSummary.push(`F ${formatDecimal(fats, 1)} g`);
    if (macroSummary.length) {
      metaParts.push(macroSummary.join(' • '));
    }
    if (item.serving) {
      metaParts.push(item.serving);
    }
    if (item.source) {
      metaParts.push(item.source);
    }
    const metaLabel = metaParts.length ? metaParts.join(' • ') : 'Serving suggestion';
    li.innerHTML = `
      <span class="suggestion-name">${renderHighlightedSuggestionName(item.name, nutritionNameInput?.value || '')}</span>
      <span class="suggestion-meta">${escapeHtml(metaLabel)}</span>
    `;
    nutritionSuggestions.appendChild(li);
  });
  if (nutritionNameInput) {
    if (state.activeSuggestionIndex >= 0 && state.activeSuggestionIndex < state.suggestions.length) {
      nutritionNameInput.setAttribute(
        'aria-activedescendant',
        `nutritionSuggestionOption-${state.activeSuggestionIndex}`
      );
    } else {
      nutritionNameInput.removeAttribute('aria-activedescendant');
    }
  }
  updateNutritionLookupButtonLabel();
}

function showQuickSuggestions(query = '') {
  state.suggestions = getLocalNutritionSuggestions(query);
  state.activeSuggestionIndex = -1;
  renderSuggestions();
}

function renderSuggestionBar() {
  if (!nutritionSuggestionBar) return;
  nutritionSuggestionBar.innerHTML = '';

  const recent = loadRecentNutritionItems().slice(0, 3);
  const items = recent.length ? recent : QUICK_SUGGESTIONS.slice(0, 3);
  if (!items.length) {
    updateSuggestionBarVisibility();
    return;
  }
  const label = document.createElement('span');
  label.className = 'suggestion-bar-label';
  label.textContent = recent.length ? 'Recent' : 'Top repeats';
  nutritionSuggestionBar.appendChild(label);
  items.forEach((item) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'suggestion-chip';
    button.dataset.suggestionId = item.id;
    const metaLabel = item.serving || '';
    button.innerHTML = `<strong>${item.name}</strong>${metaLabel ? `<span>${metaLabel}</span>` : ''}`;
    nutritionSuggestionBar.appendChild(button);
  });
  updateSuggestionBarVisibility();
}

function clearResolvedNutritionSelection({ resetType = true, clearFeedback = false, preserveCustomMode = false } = {}) {
  setNutritionResolvedSelection(null);
  if (nutritionBarcodeInput) {
    nutritionBarcodeInput.value = '';
  }
  [nutritionCaloriesInput, nutritionProteinInput, nutritionCarbsInput, nutritionFatsInput, nutritionFiberInput, nutritionAmountInput].forEach((field) => {
    if (field) {
      field.value = '';
    }
  });
  setAmountReference(null);
  state.nutritionAmountBaseline = null;
  state.nutritionMacroReference = null;
  if (nutritionTypeSelect && resetType) {
    nutritionTypeSelect.value = 'Food';
  }
  syncNutritionUnitOptions({ forceDefault: true });
  updateAmountFieldUnit();
  updateNutritionPreview();
  if (!preserveCustomMode) {
    setNutritionCustomMode(false);
  }
  if (clearFeedback && nutritionFeedback) {
    setNutritionFeedback('');
  }
}

function clearResolvedNutritionSelectionIfQueryChanged() {
  const resolvedSelection = state.nutritionResolvedSelection;
  if (!resolvedSelection) {
    return false;
  }
  const query = nutritionNameInput?.value.trim() || '';
  const normalizedQuery = normalizeNutritionSearchText(query);
  if (state.nutritionCustomMode && resolvedSelection.mode === 'custom') {
    setNutritionResolvedSelection(buildNutritionSelectionFromCustom());
    updateNutritionPreview();
    return false;
  }
  if (normalizedQuery && normalizedQuery === resolvedSelection.normalizedName) {
    return false;
  }
  clearResolvedNutritionSelection({
    resetType: !state.nutritionCustomMode,
    clearFeedback: true,
    preserveCustomMode: true,
  });
  return true;
}

function focusNutritionComposer({ selectText = false } = {}) {
  const scrollTarget = nutritionForm?.closest('.nutrition-form-card') || nutritionForm || nutritionNameInput;
  if (scrollTarget && typeof scrollTarget.scrollIntoView === 'function') {
    scrollTarget.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  if (!nutritionNameInput) {
    return;
  }
  const focusInput = () => {
    try {
      nutritionNameInput.focus({ preventScroll: true });
    } catch (error) {
      nutritionNameInput.focus();
    }
    if (selectText) {
      highlightNutritionNameInput();
    }
  };
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(focusInput);
  } else {
    setTimeout(focusInput, 0);
  }
}

function focusNutritionAmountInput({ selectText = true } = {}) {
  if (!nutritionAmountInput) {
    focusNutritionComposer();
    return;
  }
  const focusInput = () => {
    try {
      nutritionAmountInput.focus({ preventScroll: true });
    } catch (error) {
      nutritionAmountInput.focus();
    }
    if (selectText && nutritionAmountInput.value) {
      if (typeof nutritionAmountInput.select === 'function') {
        nutritionAmountInput.select();
      } else if (typeof nutritionAmountInput.setSelectionRange === 'function') {
        nutritionAmountInput.setSelectionRange(0, nutritionAmountInput.value.length);
      }
    }
  };
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(focusInput);
  } else {
    setTimeout(focusInput, 0);
  }
}

function buildNutritionFeedbackSummary({ calories, protein, carbs, fats } = {}) {
  const parts = [];
  if (Number.isFinite(calories) && calories >= 0) {
    parts.push(`${formatNumber(Math.round(calories))} kcal`);
  }
  if (Number.isFinite(protein) && protein >= 0) {
    parts.push(`P ${formatDecimal(protein, 1)} g`);
  }
  if (Number.isFinite(carbs) && carbs >= 0) {
    parts.push(`C ${formatDecimal(carbs, 1)} g`);
  }
  if (Number.isFinite(fats) && fats >= 0) {
    parts.push(`F ${formatDecimal(fats, 1)} g`);
  }
  return parts.join(' • ');
}

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeRegExp(value = '') {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function inferNutritionSourceType(item = {}) {
  const source = String(item?.source || '').toLowerCase();
  if (source.includes('quick add')) return 'quick_add';
  if (source.includes('recent')) return 'recent';
  if (source.includes('usda')) return 'database';
  if (source.includes('openfoodfacts')) return 'database';
  if (source.includes('photo')) return 'photo';
  return 'database';
}

function formatNutritionBasisLabel({ serving = '', weightAmount = null, weightUnit = null } = {}) {
  const servingText = String(serving || '').trim();
  if (servingText) {
    const normalizedServing = servingText.toLowerCase();
    return normalizedServing.startsWith('per ') ? servingText : `Per ${servingText}`;
  }
  if (Number.isFinite(weightAmount) && weightAmount > 0 && weightUnit) {
    return `Per ${formatDecimal(weightAmount)} ${weightUnit}`;
  }
  return 'Serving basis unavailable';
}

function buildNutritionConfidenceLabel(item = {}, rankInfo = {}) {
  const exactMatch = Boolean(rankInfo.exactMatch);
  const allTermsMatch = Boolean(rankInfo.allTermsMatch);
  const tokenCoverage = Number(rankInfo.tokenCoverage || 0);
  const letterSimilarity = Number(rankInfo.letterSimilarity || 0);
  const sourceType = inferNutritionSourceType(item);
  if (sourceType === 'quick_add') {
    return 'High confidence';
  }
  if (exactMatch || allTermsMatch || tokenCoverage >= 0.99) {
    return 'High confidence';
  }
  if (tokenCoverage >= 0.5 || letterSimilarity >= 0.72) {
    return 'Medium confidence';
  }
  return 'Low confidence';
}

function buildNutritionDerivationLabel(item = {}, { isCustom = false } = {}) {
  if (isCustom) {
    return 'Macros entered manually for this custom item.';
  }
  const sourceType = inferNutritionSourceType(item);
  if (sourceType === 'quick_add') {
    return 'Macros come from the saved quick-add defaults for this item.';
  }
  if (sourceType === 'recent') {
    return 'Macros are based on your recent logged intake for this item.';
  }
  if (sourceType === 'photo') {
    return 'Macros are based on the selected photo-analysis suggestion.';
  }
  return 'Macros are derived from the matched food database entry and serving basis.';
}

function renderHighlightedSuggestionName(name = '', query = '') {
  const safeName = escapeHtml(name);
  const queryTokens = Array.from(
    new Set(
      tokenizeNutritionSearchText(query)
        .filter((token) => token.length >= 2)
        .sort((left, right) => right.length - left.length)
    )
  );
  if (!queryTokens.length) {
    return safeName;
  }
  const pattern = new RegExp(`(${queryTokens.map((token) => escapeRegExp(token)).join('|')})`, 'ig');
  return safeName.replace(pattern, '<mark>$1</mark>');
}

function buildNutritionSelectionFromSuggestion(item = {}, { query = '' } = {}) {
  const rankInfo = item._rankInfo || {};
  const prefill = item.prefill || {};
  return {
    mode: 'suggestion',
    normalizedName: normalizeNutritionSearchText(item.name || ''),
    barcode: String(item.barcode || prefill.barcode || '').trim(),
    name: item.name || 'Selected item',
    basisLabel: formatNutritionBasisLabel({
      serving: item.serving,
      weightAmount: Number(prefill.weightAmount),
      weightUnit: prefill.weightUnit,
    }),
    sourceLabel: item.source || 'Food database',
    confidenceLabel: buildNutritionConfidenceLabel(item, rankInfo),
    derivationLabel: buildNutritionDerivationLabel(item),
    query: query || nutritionNameInput?.value.trim() || '',
  };
}

function buildNutritionSelectionFromProduct(product = {}, { query = '', matchType = 'database' } = {}) {
  const sourceLabel = product.source || 'Food database';
  let confidenceLabel = 'High confidence';
  if (matchType === 'barcode') {
    confidenceLabel = 'Barcode match';
  } else if (matchType === 'database') {
    confidenceLabel = 'Database match';
  }
  return {
    mode: 'suggestion',
    normalizedName: normalizeNutritionSearchText(product.name || query || ''),
    barcode: String(product.barcode || '').trim(),
    name: product.name || query || 'Selected item',
    basisLabel: formatNutritionBasisLabel({
      serving: product.serving,
      weightAmount: Number(product.weightAmount),
      weightUnit: product.weightUnit,
    }),
    sourceLabel,
    confidenceLabel,
    derivationLabel: 'Macros are derived from the matched food database entry and serving basis.',
    query: query || nutritionNameInput?.value.trim() || '',
  };
}

function buildNutritionSelectionFromCustom() {
  const name = nutritionNameInput?.value.trim() || 'Custom item';
  return {
    mode: 'custom',
    normalizedName: normalizeNutritionSearchText(name),
    barcode: '',
    name,
    basisLabel: 'Manual item',
    sourceLabel: 'Custom item',
    confidenceLabel: 'Manual entry',
    derivationLabel: 'Macros entered manually for this custom item.',
    query: nutritionNameInput?.value.trim() || '',
  };
}

function setNutritionResolvedSelection(selection) {
  state.nutritionResolvedSelection = selection || null;
  if (!selection) {
    if (nutritionMatchCard) {
      nutritionMatchCard.classList.add('hidden');
    }
    return;
  }
  if (nutritionMatchName) {
    nutritionMatchName.textContent = selection.name || 'Selected item';
  }
  if (nutritionMatchMeta) {
    nutritionMatchMeta.textContent = [selection.basisLabel, selection.sourceLabel, selection.confidenceLabel]
      .filter(Boolean)
      .join(' • ');
  }
  if (nutritionMatchDerived) {
    nutritionMatchDerived.textContent = selection.derivationLabel || '';
  }
  nutritionMatchCard?.classList.remove('hidden');
}

function highlightNutritionNameInput({ forceFocus = false } = {}) {
  if (!nutritionNameInput) return;
  const shouldForceFocus =
    forceFocus &&
    typeof document !== 'undefined' &&
    document.activeElement !== nutritionNameInput &&
    typeof nutritionNameInput.focus === 'function';
  if (shouldForceFocus) {
    try {
      nutritionNameInput.focus({ preventScroll: true });
    } catch (error) {
      nutritionNameInput.focus();
    }
  }
  if (!nutritionNameInput.value) {
    return;
  }
  const selectText = () => {
    if (!nutritionNameInput || !nutritionNameInput.value) {
      return;
    }
    if (typeof nutritionNameInput.select === 'function') {
      nutritionNameInput.select();
    } else if (typeof nutritionNameInput.setSelectionRange === 'function') {
      nutritionNameInput.setSelectionRange(0, nutritionNameInput.value.length);
    }
  };
  const schedule =
    typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame
      : (callback) => setTimeout(callback, 0);
  schedule(selectText);
}

function applySuggestion(item) {
  if (!item) return;
  setNutritionCustomMode(false);
  if (nutritionNameInput) {
    nutritionNameInput.value = item.name;
  }
  if (nutritionBarcodeInput && item.barcode) {
    nutritionBarcodeInput.value = item.barcode;
  }
  setNutritionResolvedSelection(
    buildNutritionSelectionFromSuggestion(item, {
      query: nutritionNameInput?.value.trim() || '',
    })
  );
  clearSuggestions();
  state.suggestionQuery = '';
  if (applySuggestionPrefill(item)) {
    focusNutritionAmountInput();
    return;
  }
  // Trigger lookup automatically to hydrate macros/weight
  lookupNutritionFromApi();
  focusNutritionAmountInput({ selectText: false });
}

function applySuggestionPrefill(item) {
  const prefill = item?.prefill;
  if (!prefill) {
    return false;
  }
  const type = prefill.type === 'Liquid' ? 'Liquid' : 'Food';
  if (nutritionTypeSelect) {
    nutritionTypeSelect.value = type;
  }
  if (nutritionBarcodeInput && (item.barcode || prefill.barcode)) {
    nutritionBarcodeInput.value = item.barcode || prefill.barcode || '';
  }
  const calories = Number(prefill.calories);
  const protein = Number(prefill.protein);
  const carbs = Number(prefill.carbs);
  const fats = Number(prefill.fats);
  const fiber = Number(prefill.fiber);
  if (nutritionCaloriesInput) {
    nutritionCaloriesInput.value = Number.isFinite(calories) ? Math.round(calories) : '';
  }
  if (nutritionProteinInput) {
    nutritionProteinInput.value = Number.isFinite(protein) ? Math.round(protein) : '';
  }
  if (nutritionCarbsInput) {
    nutritionCarbsInput.value = Number.isFinite(carbs) ? Math.round(carbs) : '';
  }
  if (nutritionFatsInput) {
    nutritionFatsInput.value = Number.isFinite(fats) ? Math.round(fats) : '';
  }
  if (nutritionFiberInput) {
    nutritionFiberInput.value = Number.isFinite(fiber) ? Math.round(fiber) : '';
  }

  const normalizedWeight = normalizeWeightForInput(prefill.weightAmount, prefill.weightUnit, {}, {
    fallbackType: type,
  });
  if (Number.isFinite(normalizedWeight.amount) && normalizedWeight.amount > 0) {
    setAmountReference(normalizedWeight.amount, normalizedWeight.unit, normalizedWeight.extras);
    setSelectedUnit(normalizedWeight.unit, { applyAmount: true });
  } else {
    setAmountReference(null);
    syncAmountBaselineFromInput();
  }
  syncMacroReferenceFromInputs({ amount: normalizedWeight.amount });
  updateNutritionPreview();
  return true;
}

function resolveAmountInGrams(amount, unit) {
  const reference = state.nutritionAmountReference;
  if (!Number.isFinite(amount) || amount <= 0) return null;
  if (unit === UNIT_FOOD) {
    return amount;
  }
  if (unit === UNIT_OZ) {
    return amount * OZ_TO_GRAMS;
  }
  if (unit === UNIT_LIQUID) {
    return null;
  }
  if (unit === UNIT_PORTION && reference && Number.isFinite(reference.gramsEquivalent) && Number.isFinite(reference.amount) && reference.amount > 0) {
    return (reference.gramsEquivalent / reference.amount) * amount;
  }
  return null;
}

function resolveAmountInMl(amount, unit) {
  const reference = state.nutritionAmountReference;
  if (!Number.isFinite(amount) || amount <= 0) return null;
  if (unit === UNIT_LIQUID) {
    return amount;
  }
  if (unit === UNIT_PORTION && reference && Number.isFinite(reference.mlEquivalent) && Number.isFinite(reference.amount) && reference.amount > 0) {
    return (reference.mlEquivalent / reference.amount) * amount;
  }
  return null;
}

function updateNutritionPreview() {
  if (!nutritionPreview) return;
  const selection = state.nutritionResolvedSelection;
  const amount = Number.parseFloat(nutritionAmountInput?.value);
  const unit = getSelectedUnit();
  const calories = Number.parseFloat(nutritionCaloriesInput?.value);
  const protein = Number.parseFloat(nutritionProteinInput?.value);
  const carbs = Number.parseFloat(nutritionCarbsInput?.value);
  const fats = Number.parseFloat(nutritionFatsInput?.value);
  const fiber = Number.parseFloat(nutritionFiberInput?.value);
  const hasMacroData = [calories, protein, carbs, fats, fiber].some((value) => Number.isFinite(value));

  if (!selection) {
    nutritionPreview.innerHTML =
      '<p class="muted small-text">Select a suggestion or choose Custom item, then set an amount to preview macros.</p>';
    return;
  }

  if (!Number.isFinite(amount) || amount <= 0) {
    nutritionPreview.innerHTML = `<p class="muted small-text">Set an amount for ${escapeHtml(selection.name)} to preview macros.</p>`;
    return;
  }

  if (!hasMacroData) {
    nutritionPreview.innerHTML =
      selection.mode === 'custom'
        ? '<p class="muted small-text">Enter macros in Custom item mode to preview this entry.</p>'
        : `<p class="muted small-text">Nutrition data for ${escapeHtml(selection.name)} is not ready yet.</p>`;
    return;
  }

  const grams = resolveAmountInGrams(amount, unit);
  const ml = resolveAmountInMl(amount, unit);
  const perUnit = Number.isFinite(calories) ? calories / amount : null;
  const proteinPerUnit = Number.isFinite(protein) ? protein / amount : null;
  const carbsPerUnit = Number.isFinite(carbs) ? carbs / amount : null;
  const fatsPerUnit = Number.isFinite(fats) ? fats / amount : null;
  const fiberPerUnit = Number.isFinite(fiber) ? fiber / amount : null;

  const badgeRows = [];
  if (Number.isFinite(calories) && calories >= 0) {
    badgeRows.push(
      `<span class="nutrition-preview-badge calories"><strong>${formatNumber(Math.round(calories))}</strong><span>kcal</span></span>`
    );
  }
  if (Number.isFinite(protein) && protein >= 0) {
    badgeRows.push(
      `<span class="nutrition-preview-badge protein"><strong>${formatDecimal(protein, 1)}</strong><span>P</span></span>`
    );
  }
  if (Number.isFinite(carbs) && carbs >= 0) {
    badgeRows.push(
      `<span class="nutrition-preview-badge carbs"><strong>${formatDecimal(carbs, 1)}</strong><span>C</span></span>`
    );
  }
  if (Number.isFinite(fats) && fats >= 0) {
    badgeRows.push(
      `<span class="nutrition-preview-badge fats"><strong>${formatDecimal(fats, 1)}</strong><span>F</span></span>`
    );
  }
  if (Number.isFinite(fiber) && fiber >= 0) {
    badgeRows.push(
      `<span class="nutrition-preview-badge fiber"><strong>${formatDecimal(fiber, 1)}</strong><span>Fi</span></span>`
    );
  }

  const chips = [];
  if (Number.isFinite(perUnit)) {
    chips.push(
      `<div class="nutrition-preview-chip"><strong>${perUnit.toFixed(1)} kcal</strong><span>per ${unit === UNIT_PORTION ? 'portion' : unit}</span></div>`
    );
  }
  if (Number.isFinite(proteinPerUnit)) {
    chips.push(
      `<div class="nutrition-preview-chip"><strong>${proteinPerUnit.toFixed(1)} g</strong><span>protein per ${unit}</span></div>`
    );
  }
  if (Number.isFinite(carbsPerUnit)) {
    chips.push(
      `<div class="nutrition-preview-chip"><strong>${carbsPerUnit.toFixed(1)} g</strong><span>carbs per ${unit}</span></div>`
    );
  }
  if (Number.isFinite(fatsPerUnit)) {
    chips.push(
      `<div class="nutrition-preview-chip"><strong>${fatsPerUnit.toFixed(1)} g</strong><span>fat per ${unit}</span></div>`
    );
  }
  if (Number.isFinite(fiberPerUnit)) {
    chips.push(
      `<div class="nutrition-preview-chip"><strong>${fiberPerUnit.toFixed(1)} g</strong><span>fiber per ${unit}</span></div>`
    );
  }
  if (Number.isFinite(grams)) {
    chips.push(
      `<div class="nutrition-preview-chip"><strong>${formatDecimal(grams)} g</strong><span>current weight</span></div>`
    );
  }
  if (Number.isFinite(ml)) {
    chips.push(
      `<div class="nutrition-preview-chip"><strong>${formatDecimal(ml)} ml</strong><span>current volume</span></div>`
    );
  }
  const referenceText = nutritionAmountReferenceText?.textContent?.trim() || '';

  nutritionPreview.innerHTML = `
    <div class="nutrition-preview-summary">
      <strong>${escapeHtml(selection.name)}</strong>
      <span class="muted small-text">${escapeHtml(
        [selection.basisLabel, selection.sourceLabel, selection.confidenceLabel].filter(Boolean).join(' • ')
      )}</span>
    </div>
    <p class="nutrition-preview-derived">${escapeHtml(selection.derivationLabel || '')}</p>
    <div class="nutrition-preview-context">
      <span>${Number.isFinite(calories) ? formatNumber(Math.round(calories)) : '\u2014'} kcal</span>
      <span>${formatDecimal(amount)} ${unit} selected${referenceText ? ` • ${escapeHtml(referenceText)}` : ''}</span>
    </div>
    <div class="nutrition-preview-badges">
      ${badgeRows.join('')}
    </div>
    <div class="nutrition-preview-grid">
      ${chips.join('')}
    </div>
  `;
}

function updateAmountFieldUnit({ fill = false } = {}) {
  if (!nutritionAmountLabel) return false;
  const unit = getSelectedUnit();
  nutritionAmountLabel.textContent = `Amount (${unit})`;
  if (nutritionAmountInput) {
    let placeholder = 'grams';
    if (unit === UNIT_LIQUID) placeholder = 'milliliters';
    else if (unit === UNIT_OZ) placeholder = 'ounces';
    else if (unit === UNIT_PORTION) placeholder = 'portions';
    nutritionAmountInput.placeholder = placeholder;
  }
  const filled = fill ? fillAmountForUnit(unit) : false;
  renderAmountReference();
  return filled;
}

function updateNutritionFormVisibility() {
  if (!nutritionForm) return;
  const ownsProfile = state.user && state.viewing && state.user.id === state.viewing.id;
  const fields = nutritionForm.querySelectorAll('input, select, button');
  fields.forEach((field) => {
    if (field === nutritionLookupButton) {
      return;
    }
    field.disabled = !ownsProfile;
  });
  if (nutritionLookupButton) {
    nutritionLookupButton.disabled = false;
  }
  if (nutritionFormHint) {
    nutritionFormHint.textContent = ownsProfile
      ? 'Select a result or choose Custom item, then press Enter to log instantly.'
      : 'Switch back to your profile to log intake.';
  }
  if (!ownsProfile && nutritionFeedback) {
    setNutritionFeedback('');
  }
  if (!ownsProfile) {
    clearNutritionPhotoSelection({ keepStatus: true });
    setNutritionPhotoStatus('Switch back to your profile to import meal photos.');
  } else if (!state.nutritionPhotoData) {
    setNutritionPhotoStatus('');
  }
  if (!ownsProfile) {
    stopBarcodeScan({
      message: 'Switch back to your profile to scan items.',
      isError: true,
      resetToDefault: false,
    });
  } else if (!barcodeScanState.active) {
    setScanStatus(defaultScanStatusMessage);
  }

  updateMacroTargetFormState();
}

function canEditMacroTargets() {
  if (!state.user || !state.viewing) {
    return false;
  }
  if (state.user.id === state.viewing.id) {
    return true;
  }
  return state.user.role === 'Head Coach';
}

function updateMacroTargetFormState() {
  if (!macroTargetForm) return;
  const canEdit = canEditMacroTargets();
  const controls = macroTargetForm.querySelectorAll('input, button');
  controls.forEach((control) => {
    // Allow native validation to handle required states when enabled
    control.disabled = !canEdit;
  });
  if (macroTargetToggleButton) {
    macroTargetToggleButton.disabled = !canEdit;
  }
  if (!canEdit) {
    setMacroTargetExpanded(false);
  }
  if (macroTargetFormHint) {
    if (!canEdit) {
      macroTargetFormHint.textContent = 'Switch to your profile to edit macro targets.';
    } else if (state.user && state.viewing && state.user.id !== state.viewing.id) {
      macroTargetFormHint.textContent =
        'Head coaches can set targets for the selected athlete.';
    } else {
      macroTargetFormHint.textContent = 'Targets apply to the selected date.';
    }
  }
  if (!canEdit && macroTargetFeedback) {
    macroTargetFeedback.textContent = '';
  }
  updateMacroTargetToggleLabel();
}

function setMacroTargetExpanded(expanded) {
  state.macroTargetExpanded = Boolean(expanded);
  if (macroTargetForm) {
    macroTargetForm.classList.toggle('hidden', !state.macroTargetExpanded);
  }
  if (macroTargetToggleButton) {
    macroTargetToggleButton.setAttribute('aria-expanded', String(state.macroTargetExpanded));
  }
  updateMacroTargetToggleLabel();
}

function updateMacroTargetToggleLabel() {
  if (!macroTargetToggleButton) return;
  const canEdit = canEditMacroTargets();
  let label = 'Set macro targets';
  if (state.macroTargetExpanded) {
    label = 'Hide macro targets';
  } else if (!canEdit && state.user) {
    label = 'Switch profiles to edit targets';
  }
  macroTargetToggleButton.textContent = label;
}

function toggleMacroTargetForm() {
  if (!canEditMacroTargets()) {
    if (macroTargetFeedback) {
      macroTargetFeedback.textContent = 'Switch to your profile to edit macro targets.';
    }
    return;
  }
  setMacroTargetExpanded(!state.macroTargetExpanded);
  if (state.macroTargetExpanded && macroTargetFeedback) {
    macroTargetFeedback.textContent = '';
  }
}

function setScanStatus(message, { isError = false } = {}) {
  if (!nutritionScanStatus) return;
  const nextMessage = message || defaultScanStatusMessage;
  nutritionScanStatus.textContent = nextMessage;
  nutritionScanStatus.classList.toggle('error', Boolean(isError));
}

function resolveLinearBarcodeFormats(supportedFormats = []) {
  if (!Array.isArray(supportedFormats) || !supportedFormats.length) {
    return [];
  }
  return supportedFormats.filter((format) => LINEAR_BARCODE_FORMATS.includes(format));
}

function normalizeDetectedBarcodeValue(rawValue, format) {
  const trimmed = typeof rawValue === 'string' ? rawValue.trim() : '';
  if (!trimmed) {
    return '';
  }
  if (format && NUMERIC_BARCODE_FORMATS.has(format)) {
    const digitsOnly = trimmed.replace(/\D+/g, '');
    return digitsOnly || trimmed;
  }
  return trimmed;
}

function isBarcodeScannerSupported() {
  return (
    typeof window !== 'undefined' &&
    'BarcodeDetector' in window &&
    typeof navigator?.mediaDevices?.getUserMedia === 'function'
  );
}

async function ensureBarcodeDetector() {
  if (!('BarcodeDetector' in window)) {
    throw new Error('Barcode scanning is not supported in this browser.');
  }
  if (!barcodeScanState.detector) {
    let formats = [...LINEAR_BARCODE_FORMATS];
    if (typeof window.BarcodeDetector.getSupportedFormats === 'function') {
      try {
        const supported = await window.BarcodeDetector.getSupportedFormats();
        if (supported?.length) {
          const linearFormats = resolveLinearBarcodeFormats(supported);
          if (!linearFormats.length) {
            throw new Error('This browser camera supports QR codes only. Enter the barcode manually or use Chrome/Edge.');
          }
          formats = linearFormats;
        }
      } catch (error) {
        if (error?.message?.includes('QR codes only')) {
          throw error;
        }
        // fallback to defaults when supported format detection fails
      }
    }
    try {
      barcodeScanState.detector = new window.BarcodeDetector({ formats });
    } catch (error) {
      if (typeof window.BarcodeDetector.getSupportedFormats === 'function') {
        throw error;
      }
      // Some implementations reject explicit format lists but work with defaults.
      barcodeScanState.detector = new window.BarcodeDetector();
    }
  }
  return barcodeScanState.detector;
}

function warmupBarcodeDetector() {
  if (!isBarcodeScannerSupported()) {
    return;
  }
  if (barcodeDetectorWarmupPromise) {
    return;
  }
  barcodeDetectorWarmupPromise = ensureBarcodeDetector().catch(() => {}).finally(() => {
    barcodeDetectorWarmupPromise = null;
  });
}

function stopBarcodeScan(options = {}) {
  const { message, isError = false, resetToDefault = true } = options;
  if (barcodeScanState.frameId) {
    cancelAnimationFrame(barcodeScanState.frameId);
    barcodeScanState.frameId = null;
  }
  if (barcodeScanState.stream) {
    barcodeScanState.stream.getTracks().forEach((track) => track.stop());
    barcodeScanState.stream = null;
  }
  barcodeScanState.active = false;
  if (nutritionScanPreview) {
    try {
      nutritionScanPreview.pause?.();
    } catch (error) {
      // ignore
    }
    nutritionScanPreview.srcObject = null;
  }
  nutritionScanPreviewWrapper?.classList.add('hidden');
  if (nutritionScanButton) {
    nutritionScanButton.textContent = barcodeScanButtonLabel;
    nutritionScanButton.disabled = false;
  }
  if (message) {
    setScanStatus(message, { isError });
  } else if (resetToDefault) {
    setScanStatus(defaultScanStatusMessage);
  }
}

function processBarcodeFrame(detector) {
  if (!barcodeScanState.active || !nutritionScanPreview) {
    return;
  }
  if (nutritionScanPreview.readyState < 2) {
    barcodeScanState.frameId = requestAnimationFrame(() => processBarcodeFrame(detector));
    return;
  }
  detector
    .detect(nutritionScanPreview)
    .then((barcodes) => {
      const match = barcodes?.find((entry) => normalizeDetectedBarcodeValue(entry?.rawValue, entry?.format));
      const rawValue = normalizeDetectedBarcodeValue(match?.rawValue, match?.format);
      if (rawValue) {
        if (nutritionBarcodeInput) {
          nutritionBarcodeInput.value = rawValue;
        }
        stopBarcodeScan({
          message: `Captured #${rawValue}. Loading nutrition...`,
          resetToDefault: false,
        });
        lookupNutritionFromApi();
        return;
      }
      barcodeScanState.frameId = requestAnimationFrame(() => processBarcodeFrame(detector));
    })
    .catch((error) => {
      console.error('Barcode detection failed', error);
      stopBarcodeScan({
        message: 'Scanning interrupted. Try again.',
        isError: true,
        resetToDefault: false,
      });
    });
}

async function startBarcodeScan() {
  if (!nutritionScanButton || barcodeScanState.active) return;
  warmupBarcodeDetector();
  if (!isBarcodeScannerSupported()) {
    setScanStatus('Browser camera scanning is unavailable here. Search or upload a photo instead.', { isError: true });
    return;
  }
  nutritionScanButton.disabled = true;
  setScanStatus('Opening browser camera...');
  try {
    const detector = await ensureBarcodeDetector();
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 640, max: 1280 },
        height: { ideal: 480, max: 720 },
        frameRate: { ideal: 24, max: 30 },
      },
      audio: false,
    });
    barcodeScanState.stream = stream;
    barcodeScanState.active = true;
    if (nutritionScanPreview) {
      nutritionScanPreview.srcObject = stream;
      if (typeof nutritionScanPreview.play === 'function') {
        const playPromise = nutritionScanPreview.play();
        if (playPromise?.catch) {
          playPromise.catch(() => {});
        }
      }
    }
    nutritionScanPreviewWrapper?.classList.remove('hidden');
    nutritionScanButton.textContent = barcodeStopButtonLabel;
    nutritionScanButton.disabled = false;
    setScanStatus('Align the barcode inside the frame.');
    barcodeScanState.frameId = requestAnimationFrame(() => processBarcodeFrame(detector));
  } catch (error) {
    console.error('Unable to start barcode scan', error);
    stopBarcodeScan({
      message: error?.message || 'Unable to access the browser camera for scanning.',
      isError: true,
      resetToDefault: false,
    });
  }
}

function initializeBarcodeScanner() {
  if (!nutritionScanButton) return;
  if (!isBarcodeScannerSupported()) {
    nutritionScanButton.disabled = true;
    setScanStatus('Browser camera scanning is unavailable here. Search or upload a photo instead.', { isError: true });
    return;
  }
  setScanStatus(defaultScanStatusMessage);
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(warmupBarcodeDetector, { timeout: 1000 });
  } else {
    setTimeout(warmupBarcodeDetector, 0);
  }
}

function fillAmountForUnit(unit) {
  if (!nutritionAmountInput || !state.nutritionAmountReference) return false;
  const reference = state.nutritionAmountReference;
  let value = null;
  if (unit === reference.unit) {
    value = reference.amount;
  } else if (unit === UNIT_FOOD && Number.isFinite(reference.gramsEquivalent)) {
    value = reference.gramsEquivalent;
  } else if (unit === UNIT_OZ && Number.isFinite(reference.gramsEquivalent)) {
    value = reference.gramsEquivalent / OZ_TO_GRAMS;
  } else if (unit === UNIT_LIQUID && Number.isFinite(reference.mlEquivalent)) {
    value = reference.mlEquivalent;
  }
  if (!Number.isFinite(value) || value <= 0) {
    return false;
  }
  nutritionAmountInput.value = value;
  state.nutritionAmountBaseline = value;
  rebaseMacroReferenceAmount(value, unit);
  updateNutritionPreview();
  return true;
}

function syncAmountBaselineFromInput() {
  if (!nutritionAmountInput) {
    state.nutritionAmountBaseline = null;
    return;
  }
  const amount = Number.parseFloat(nutritionAmountInput.value);
  if (Number.isFinite(amount) && amount > 0) {
    state.nutritionAmountBaseline = amount;
    if (!state.nutritionAmountReference) {
      setAmountReference(amount, getSelectedUnit());
    }
  } else {
    state.nutritionAmountBaseline = null;
  }
  if (
    Number.isFinite(amount) &&
    amount > 0 &&
    !state.nutritionMacroReference &&
    [nutritionCaloriesInput, nutritionProteinInput, nutritionCarbsInput, nutritionFatsInput, nutritionFiberInput].some(
      (field) => Number.isFinite(getInputNumber(field))
    )
  ) {
    syncMacroReferenceFromInputs({ amount });
  }
}

function getInputNumber(field) {
  if (!field) return null;
  const value = Number.parseFloat(field.value);
  return Number.isFinite(value) ? value : null;
}

function syncMacroReferenceFromInputs(options = {}) {
  const amount =
    Number.isFinite(options.amount) && options.amount > 0
      ? options.amount
      : getInputNumber(nutritionAmountInput);
  if (!Number.isFinite(amount) || amount <= 0) {
    state.nutritionMacroReference = null;
    return false;
  }
  const reference = {
    amount,
    unit: options.unit || getSelectedUnit(),
    calories: getInputNumber(nutritionCaloriesInput),
    protein: getInputNumber(nutritionProteinInput),
    carbs: getInputNumber(nutritionCarbsInput),
    fats: getInputNumber(nutritionFatsInput),
    fiber: getInputNumber(nutritionFiberInput),
  };
  if (
    ![reference.calories, reference.protein, reference.carbs, reference.fats, reference.fiber].some((value) =>
      Number.isFinite(value)
    )
  ) {
    state.nutritionMacroReference = null;
    return false;
  }
  state.nutritionMacroReference = reference;
  return true;
}

function rebaseMacroReferenceAmount(amount, unit = getSelectedUnit()) {
  if (
    !state.nutritionMacroReference ||
    !Number.isFinite(amount) ||
    amount <= 0
  ) {
    return;
  }
  state.nutritionMacroReference.amount = amount;
  state.nutritionMacroReference.unit = unit;
}

function scaleMetric(field, ratio, { round = 'oneDecimal', baseline } = {}) {
  if (!field || !Number.isFinite(ratio) || ratio <= 0) return;
  const baseValue = Number.isFinite(baseline) ? baseline : Number.parseFloat(field.value);
  if (!Number.isFinite(baseValue)) return;
  let next = baseValue * ratio;
  if (round === 'int') {
    next = Math.max(0, Math.round(next));
  } else {
    next = Math.max(0, Math.round(next * 10) / 10);
  }
  field.value = Number.isFinite(next) ? String(next) : '';
}

function handleAmountInputChange() {
  if (!nutritionAmountInput) return;
  const newAmount = Number.parseFloat(nutritionAmountInput.value);
  if (!Number.isFinite(newAmount) || newAmount <= 0) {
    state.nutritionAmountBaseline = null;
    return;
  }
  const unit = getSelectedUnit();
  if (!state.nutritionAmountReference) {
    setAmountReference(newAmount, unit);
  }
  const lastAmount = state.nutritionAmountBaseline;
  const amountChanged =
    Number.isFinite(lastAmount) && lastAmount > 0 && Math.abs(newAmount - lastAmount) > 1e-4;

  if (amountChanged) {
    const macroReference = state.nutritionMacroReference;
    let macroRatio = null;
    if (macroReference && Number.isFinite(macroReference.amount) && macroReference.amount > 0) {
      macroRatio = newAmount / macroReference.amount;
    } else if (Number.isFinite(lastAmount) && lastAmount > 0) {
      macroRatio = newAmount / lastAmount;
    }
    if (Number.isFinite(macroRatio) && macroRatio > 0) {
      scaleMetric(nutritionCaloriesInput, macroRatio, {
        round: 'int',
        baseline: macroReference?.calories,
      });
      scaleMetric(nutritionProteinInput, macroRatio, { baseline: macroReference?.protein });
      scaleMetric(nutritionCarbsInput, macroRatio, { baseline: macroReference?.carbs });
      scaleMetric(nutritionFatsInput, macroRatio, { baseline: macroReference?.fats });
      scaleMetric(nutritionFiberInput, macroRatio, { baseline: macroReference?.fiber });
    }

    if (state.nutritionAmountReference && Number.isFinite(lastAmount) && lastAmount > 0) {
      const ratio = newAmount / lastAmount;
      if (Number.isFinite(ratio) && ratio > 0) {
        const ref = state.nutritionAmountReference;
        if (unit === ref.unit) {
          ref.amount = newAmount;
          if (Number.isFinite(ref.gramsEquivalent)) {
            ref.gramsEquivalent = Math.round(ref.gramsEquivalent * ratio * 10) / 10;
          }
          if (Number.isFinite(ref.mlEquivalent)) {
            ref.mlEquivalent = Math.round(ref.mlEquivalent * ratio * 10) / 10;
          }
        } else if (unit === UNIT_FOOD && Number.isFinite(ref.gramsEquivalent)) {
          ref.gramsEquivalent = newAmount;
        } else if (unit === UNIT_OZ && Number.isFinite(ref.gramsEquivalent)) {
          ref.gramsEquivalent = Math.round(newAmount * OZ_TO_GRAMS * 10) / 10;
        } else if (unit === UNIT_LIQUID && Number.isFinite(ref.mlEquivalent)) {
          ref.mlEquivalent = newAmount;
        }
        renderAmountReference();
      }
    }
  }
  state.nutritionAmountBaseline = newAmount;
  updateNutritionPreview();
}

const pageCopy = {
  overview: {
    title: 'Overview',
    subtitle: 'Sleep, readiness, load, and fuel in one place.',
  },
  activity: {
    title: 'Activity',
    subtitle: 'Sessions, pace, load, and Strava sync.',
  },
  sleep: {
    title: 'Sleep',
    subtitle: 'Nightly recovery, goals, and stage balance.',
  },
  vitals: {
    title: 'Vitals',
    subtitle: 'Heart rhythm, blood pressure, glucose, and recovery signals.',
  },
  nutrition: {
    title: 'Nutrition',
    subtitle: 'Daily intake, macro targets, and photo-assisted logging.',
  },
  weight: {
    title: 'Weight',
    subtitle: 'Weight trend, calories, and body metrics.',
  },
  profile: {
    title: 'Settings',
    subtitle: 'Profile, security, avatar, and integrations.',
  },
  sharing: {
    title: 'Share',
    subtitle: 'Invite coaches to view your dashboard.',
  },
};

let activeAuthMode = 'login';
let lastPresetAvatar = avatarValueInput?.value || '';
let profileAvatarInitialUrl = '';
let profileAvatarInitialPhoto = null;
let profileAvatarPhotoData = null;
let profileAvatarPhotoChanged = false;
let profileAvatarUrlChanged = false;
const ROLE_HEAD_COACH = 'Head Coach';
const ROLE_COACH = 'Coach';
const ROLE_ATHLETE = 'Athlete';
const UNIT_FOOD = 'g';
const UNIT_LIQUID = 'ml';
const UNIT_PORTION = 'portion';
const UNIT_OZ = 'oz';
const OZ_TO_GRAMS = 28.3495;
const VALID_UNITS = new Set([UNIT_FOOD, UNIT_LIQUID, UNIT_OZ]);
const MEAL_DRAFT_UNITS = new Set([UNIT_FOOD, UNIT_LIQUID, UNIT_PORTION]);
const LIQUID_KEYWORDS = [
  'water',
  'cola',
  'coke',
  'soda',
  'juice',
  'smoothie',
  'shake',
  'latte',
  'coffee',
  'tea',
  'milk',
  'broth',
  'soup',
  'ade',
  'hydration',
  'drink',
  'beverage',
  'kombucha',
  'spritz',
  'beer',
  'wine',
  'flavored water',
];
const POUNDS_PER_KG = 2.2046226218;
const MAX_NUTRITION_PHOTO_BYTES = 12 * 1024 * 1024;
const DEFAULT_NUTRITION_PHOTO_STATUS = nutritionPhotoStatus?.textContent || '';
const NUTRITION_EMPTY_STATE_MESSAGE = 'No results. Try searching the food database or add a custom item.';

const resolveRoleLabel = (role = '') => {
  const key = role?.toString().trim().toLowerCase();
  if (key === 'head coach') return ROLE_HEAD_COACH;
  if (key === 'coach') return ROLE_COACH;
  return ROLE_ATHLETE;
};

const hasCoachPermissions = (role = '') => {
  const normalized = resolveRoleLabel(role);
  return normalized === ROLE_COACH || normalized === ROLE_HEAD_COACH;
};

const isHeadCoachRole = (role = '') => resolveRoleLabel(role) === ROLE_HEAD_COACH;

const getUnitForType = (value) => (value === 'Liquid' ? UNIT_LIQUID : UNIT_FOOD);
const getAllowedNutritionUnitsForType = (value = nutritionTypeSelect?.value || 'Food') =>
  value === 'Liquid' ? [UNIT_LIQUID] : [UNIT_FOOD, UNIT_OZ];

function syncNutritionUnitOptions({ forceDefault = false } = {}) {
  if (!nutritionUnitSelect) {
    return getAllowedNutritionUnitsForType();
  }
  const allowedUnits = getAllowedNutritionUnitsForType(nutritionTypeSelect?.value || 'Food');
  const allowedUnitSet = new Set(allowedUnits);
  Array.from(nutritionUnitSelect.options).forEach((option) => {
    const isAllowed = allowedUnitSet.has(option.value);
    option.disabled = !isAllowed;
    option.hidden = !isAllowed;
  });
  if (forceDefault || !allowedUnitSet.has(nutritionUnitSelect.value)) {
    nutritionUnitSelect.value = allowedUnits[0];
  }
  return allowedUnits;
}

function getSelectedUnit() {
  const allowedUnits = getAllowedNutritionUnitsForType(nutritionTypeSelect?.value || 'Food');
  if (nutritionUnitSelect && VALID_UNITS.has(nutritionUnitSelect.value) && allowedUnits.includes(nutritionUnitSelect.value)) {
    return nutritionUnitSelect.value;
  }
  return getUnitForType(nutritionTypeSelect?.value || 'Food');
}

function getNutritionSuggestionType(item = {}) {
  const prefillType = item?.prefill?.type;
  if (prefillType === 'Liquid' || prefillType === 'Food') {
    return prefillType;
  }
  const name = String(item?.name || '').toLowerCase();
  return LIQUID_KEYWORDS.some((keyword) => name.includes(keyword)) ? 'Liquid' : 'Food';
}

function normalizeNutritionSearchText(value = '') {
  return value.toString().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function tokenizeNutritionSearchText(value = '') {
  return normalizeNutritionSearchText(value).split(/\s+/).filter(Boolean);
}

function computeNutritionLetterSimilarity(text = '', query = '') {
  const normalizedText = normalizeNutritionSearchText(text).replace(/\s+/g, '');
  const normalizedQuery = normalizeNutritionSearchText(query).replace(/\s+/g, '');
  if (!normalizedText || !normalizedQuery) {
    return 0;
  }
  if (normalizedText === normalizedQuery) {
    return 1;
  }
  let sharedPrefix = 0;
  while (
    sharedPrefix < normalizedText.length &&
    sharedPrefix < normalizedQuery.length &&
    normalizedText[sharedPrefix] === normalizedQuery[sharedPrefix]
  ) {
    sharedPrefix += 1;
  }
  const textChars = normalizedText.split('');
  const overlap = normalizedQuery.split('').reduce((count, char) => {
    const index = textChars.indexOf(char);
    if (index === -1) {
      return count;
    }
    textChars.splice(index, 1);
    return count + 1;
  }, 0);
  const overlapRatio = overlap / Math.max(normalizedText.length, normalizedQuery.length);
  const prefixRatio = sharedPrefix / Math.max(Math.min(normalizedText.length, normalizedQuery.length), 1);
  return Number(Math.min(1, overlapRatio * 0.65 + prefixRatio * 0.35).toFixed(4));
}

function rankNutritionSuggestions(items = [], query = '', options = {}) {
  const normalizedQuery = normalizeNutritionSearchText(query);
  if (!normalizedQuery) {
    return Array.isArray(items) ? items.slice(0, 6) : [];
  }
  const preferredType = options.preferredType || nutritionTypeSelect?.value || 'Food';
  const queryTokens = tokenizeNutritionSearchText(query);
  const ranked = (Array.isArray(items) ? items : [])
    .map((item) => {
      const normalizedName = normalizeNutritionSearchText(item?.name || '');
      if (!normalizedName) {
        return null;
      }
      const sourceType = inferNutritionSourceType(item);
      const nameTokens = tokenizeNutritionSearchText(item.name);
      const matchedTokens = queryTokens.filter((token) =>
        nameTokens.some((word) => word.startsWith(token) || word.includes(token)) ||
        normalizedName.includes(token)
      );
      const tokenCoverage = queryTokens.length ? matchedTokens.length / queryTokens.length : 0;
      const allTermsMatch = Boolean(queryTokens.length) && matchedTokens.length === queryTokens.length;
      const prefixCoverage = queryTokens.length
        ? queryTokens.reduce((count, token) => {
            if (nameTokens.some((word) => word.startsWith(token))) {
              return count + 1;
            }
            return count;
          }, 0) / queryTokens.length
        : 0;
      const exactMatch = normalizedName === normalizedQuery;
      const startsWithQuery = normalizedName.startsWith(normalizedQuery);
      const containsQuery = normalizedName.includes(normalizedQuery);
      const letterSimilarity = computeNutritionLetterSimilarity(item.name, query);
      const itemType = getNutritionSuggestionType(item);
      const typeMatches = itemType === preferredType;
      const phraseMatch = allTermsMatch && queryTokens.length > 1;
      const baseRelevance =
        (exactMatch ? 1 : 0) * 4.2 +
        (allTermsMatch ? 1 : 0) * 2.1 +
        tokenCoverage * 1.55 +
        prefixCoverage * 0.7 +
        (startsWithQuery ? 0.55 : 0) +
        (containsQuery ? 0.24 : 0) +
        letterSimilarity * 0.38 +
        (typeMatches ? 0.1 : -0.35) +
        (phraseMatch ? 0.22 : 0);
      let sourceBonus = 0;
      if (baseRelevance >= 2.25 && tokenCoverage >= 0.5) {
        if (sourceType === 'recent') {
          sourceBonus += 0.04;
        } else if (sourceType === 'quick_add') {
          sourceBonus += 0.03;
        }
      }
      const recentTieBreaker =
        sourceType === 'recent' && Number.isFinite(item._recentIndex)
          ? Math.max(0, 0.018 - item._recentIndex * 0.003)
          : 0;
      const score = Number((baseRelevance + sourceBonus + recentTieBreaker).toFixed(4));
      return {
        ...item,
        _rankInfo: {
          exactMatch,
          allTermsMatch,
          startsWithQuery,
          containsQuery,
          tokenCoverage,
          letterSimilarity,
          confidenceLabel: buildNutritionConfidenceLabel(item, {
            exactMatch,
            allTermsMatch,
            tokenCoverage,
            letterSimilarity,
          }),
        },
        _rankScore: score,
        _sourceType: sourceType,
        _allTermsMatch: allTermsMatch,
        _exactMatch: exactMatch,
        _startsWithQuery: startsWithQuery,
        _containsQuery: containsQuery,
        _tokenCoverage: tokenCoverage,
        _letterSimilarity: letterSimilarity,
        _recentIndex: item._recentIndex,
        _itemType: itemType,
      };
    })
    .filter(Boolean)
    .filter((item) => {
      const minimumLetterSimilarity = normalizedQuery.length >= 6 ? 0.42 : 0.34;
      return (
        item._exactMatch ||
        item._allTermsMatch ||
        item._startsWithQuery ||
        item._containsQuery ||
        item._tokenCoverage >= 0.5 ||
        item._letterSimilarity >= minimumLetterSimilarity
      );
    })
    .sort((left, right) => {
      if (left._exactMatch !== right._exactMatch) {
        return left._exactMatch ? -1 : 1;
      }
      if (left._allTermsMatch !== right._allTermsMatch) {
        return left._allTermsMatch ? -1 : 1;
      }
      if (Math.abs(right._tokenCoverage - left._tokenCoverage) > 0.01) {
        return right._tokenCoverage - left._tokenCoverage;
      }
      if (Math.abs(right._rankScore - left._rankScore) > 0.02) {
        return right._rankScore - left._rankScore;
      }
      if (left._itemType !== right._itemType) {
        return left._itemType === preferredType ? -1 : 1;
      }
      if (left._sourceType !== right._sourceType) {
        if (left._sourceType === 'recent' && Number.isFinite(left._recentIndex)) {
          return -1;
        }
        if (right._sourceType === 'recent' && Number.isFinite(right._recentIndex)) {
          return 1;
        }
      }
      if (
        left._sourceType === 'recent' &&
        right._sourceType === 'recent' &&
        Number.isFinite(left._recentIndex) &&
        Number.isFinite(right._recentIndex) &&
        left._recentIndex !== right._recentIndex
      ) {
        return left._recentIndex - right._recentIndex;
      }
      return String(left.name || '').localeCompare(String(right.name || ''));
    });
  const sameTypeStrongMatch = ranked.some((item) => item._itemType === preferredType && item._rankScore >= 1.8);
  const filtered = sameTypeStrongMatch ? ranked.filter((item) => item._itemType === preferredType) : ranked;
  return filtered.slice(0, 6);
}

function updateNutritionLookupButtonLabel() {
  if (!nutritionLookupButton) {
    return;
  }
  nutritionLookupButton.textContent = 'Search food database';
}

function updateSuggestionBarVisibility() {
  if (!nutritionSuggestionBar) {
    return;
  }
  const hasActiveQuery = Boolean(nutritionNameInput?.value.trim());
  nutritionSuggestionBar.classList.toggle('hidden', hasActiveQuery || state.nutritionCustomMode);
}

function setNutritionFeedback(message = '', { tone = 'default' } = {}) {
  if (!nutritionFeedback) {
    return;
  }
  nutritionFeedback.textContent = message;
  nutritionFeedback.classList.toggle('ok', tone === 'success');
}

function setNutritionCustomMode(enabled) {
  const nextEnabled = Boolean(enabled);
  state.nutritionCustomMode = nextEnabled;
  nutritionCustomPanel?.classList.toggle('hidden', !nextEnabled);
  nutritionForm?.classList.toggle('custom-mode', nextEnabled);
  if (nutritionCustomToggle) {
    nutritionCustomToggle.setAttribute('aria-expanded', String(nextEnabled));
    nutritionCustomToggle.textContent = nextEnabled ? 'Hide custom' : 'Custom item';
  }
  if (nextEnabled) {
    if (!state.nutritionResolvedSelection) {
      setNutritionResolvedSelection(buildNutritionSelectionFromCustom());
    }
  } else if (state.nutritionResolvedSelection?.mode === 'custom') {
    setNutritionResolvedSelection(null);
  }
  updateNutritionPreview();
}

function maybeAutoSelectLiquid(name) {
  if (!nutritionTypeSelect) return false;
  const value = name?.toString().toLowerCase();
  if (!value) return false;
  const matched = LIQUID_KEYWORDS.some((keyword) => value.includes(keyword));
  if (matched && nutritionTypeSelect.value !== 'Liquid') {
    nutritionTypeSelect.value = 'Liquid';
    syncNutritionUnitOptions({ forceDefault: true });
    setSelectedUnit(UNIT_LIQUID);
    return true;
  }
  return false;
}

function canModifyOwnNutrition() {
  return (
    state.user &&
    state.viewing &&
    state.user.id === state.viewing.id
  );
}

function setSelectedUnit(unit, options = {}) {
  if (!nutritionUnitSelect) return;
  const allowedUnits = syncNutritionUnitOptions();
  const normalized = VALID_UNITS.has(unit) && allowedUnits.includes(unit)
    ? unit
    : allowedUnits[0] || getUnitForType(nutritionTypeSelect?.value || 'Food');
  nutritionUnitSelect.value = normalized;
  const filled = updateAmountFieldUnit({ fill: Boolean(options.applyAmount) });
  if (!filled && options.applyAmount && options.resetAmountOnFailure) {
    if (nutritionAmountInput) {
      nutritionAmountInput.value = '';
    }
    state.nutritionAmountBaseline = null;
    if (options.clearReference !== false) {
      setAmountReference(null);
    } else {
      renderAmountReference();
      updateNutritionPreview();
    }
  }
  return filled;
}

function setAuthMode(mode = 'login') {
  activeAuthMode = mode;

  document.querySelectorAll('[data-auth-mode]').forEach((button) => {
    if (mode === 'login' || mode === 'signup') {
      const isActive = button.dataset.authMode === mode;
      button.classList.toggle('active', isActive);
      button.setAttribute('aria-pressed', String(isActive));
    } else {
      button.classList.remove('active');
      button.setAttribute('aria-pressed', 'false');
    }
  });

  const views = {
    login: loginForm,
    signup: signupForm,
    forgot: forgotForm,
  };
  Object.entries(views).forEach(([key, form]) => {
    form?.classList.toggle('hidden', key !== mode);
  });

  if (mode === 'login') {
    signupForm?.classList.add('hidden');
  }

  if (loginFeedback) loginFeedback.textContent = '';
  if (signupFeedback) signupFeedback.textContent = '';
  if (forgotFeedback) forgotFeedback.textContent = '';
}

async function lookupNutritionFromApi() {
  if (!state.token) return;
  const barcode = nutritionBarcodeInput?.value.trim();
  const query = nutritionNameInput?.value.trim();
  if (!barcode && !query) {
    setNutritionFeedback('Enter a name or barcode to look up.');
    return;
  }
  clearSuggestions();
  setNutritionFeedback('Fetching nutrition data...');
  if (nutritionLookupButton) nutritionLookupButton.disabled = true;
  try {
    const params = new URLSearchParams();
    if (barcode) {
      params.set('barcode', barcode);
    } else if (query) {
      params.set('q', query);
    }
    const response = await apiFetch(`/api/nutrition/lookup?${params.toString()}`, {
      headers: { Authorization: `Bearer ${state.token}` },
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.product) {
      throw new Error(payload?.message || 'No nutrition data found.');
    }
    // Stale check: discard if the user changed the input while the request was in flight
    const currentBarcode = nutritionBarcodeInput?.value.trim();
    const currentQuery = nutritionNameInput?.value.trim();
    if (barcode ? currentBarcode !== barcode : (query && currentQuery !== query)) {
      return;
    }
    const product = payload.product;
    if (nutritionNameInput && (!nutritionNameInput.value || barcode)) {
      nutritionNameInput.value = product.name || nutritionNameInput.value;
    }
    if (nutritionBarcodeInput && product.barcode) {
      nutritionBarcodeInput.value = product.barcode;
    }
    if (nutritionCaloriesInput) {
      nutritionCaloriesInput.value = Number.isFinite(product.calories) ? product.calories : '';
    }
    if (nutritionProteinInput) {
      nutritionProteinInput.value = Number.isFinite(product.protein) ? product.protein : '';
    }
    if (nutritionCarbsInput) {
      nutritionCarbsInput.value = Number.isFinite(product.carbs) ? product.carbs : '';
    }
    if (nutritionFatsInput) {
      nutritionFatsInput.value = Number.isFinite(product.fats) ? product.fats : '';
    }
    if (nutritionFiberInput) {
      nutritionFiberInput.value = Number.isFinite(product.fiber) ? product.fiber : '';
    }
    const resolvedType =
      product.type === 'Liquid' || getNutritionSuggestionType(product) === 'Liquid'
        ? 'Liquid'
        : 'Food';
    if (nutritionTypeSelect) {
      nutritionTypeSelect.value = resolvedType;
    }
    setNutritionCustomMode(false);
    syncNutritionUnitOptions({ forceDefault: true });
    if (nutritionAmountInput && Number.isFinite(product.weightAmount) && product.weightAmount > 0) {
      const normalizedWeight = normalizeWeightForInput(
        product.weightAmount,
        product.weightUnit === UNIT_LIQUID
          ? UNIT_LIQUID
          : product.weightUnit === UNIT_PORTION
            ? UNIT_PORTION
            : UNIT_FOOD,
        {
          gramsEquivalent: product.weightGramsEquivalent,
          mlEquivalent: product.weightMlEquivalent,
        },
        {
          fallbackType: resolvedType,
        }
      );
      if (Number.isFinite(normalizedWeight.amount) && normalizedWeight.amount > 0) {
        setAmountReference(normalizedWeight.amount, normalizedWeight.unit, normalizedWeight.extras);
        setSelectedUnit(normalizedWeight.unit, { applyAmount: true });
      } else {
        setAmountReference(null);
        syncAmountBaselineFromInput();
      }
    } else {
      setAmountReference(null);
      syncAmountBaselineFromInput();
    }
    setNutritionResolvedSelection(
      buildNutritionSelectionFromProduct(product, {
        query,
        matchType: barcode ? 'barcode' : 'database',
      })
    );
    setNutritionFeedback('Matched — adjust amount inline or open Custom item if needed.');
    updateNutritionPreview();
    syncMacroReferenceFromInputs();
  } catch (error) {
    setNutritionFeedback(error.message);
  } finally {
    if (nutritionLookupButton) nutritionLookupButton.disabled = false;
    syncAmountBaselineFromInput();
  }
}

function scheduleSuggestionFetch(options = {}) {
  const query = nutritionNameInput?.value.trim() || '';
  const immediate = Boolean(options.immediate);
  const onlyRemote = Boolean(options.onlyRemote);
  if (state.suggestionTimer) {
    clearTimeout(state.suggestionTimer);
    state.suggestionTimer = null;
  }
  if (!query) {
    showQuickSuggestions();
    return;
  }
  if (query.length < 2 || (!state.token && !onlyRemote)) {
    showQuickSuggestions(query);
    if (!state.suggestions.length) {
      renderSuggestionStatus(NUTRITION_EMPTY_STATE_MESSAGE, 'suggestion-empty');
    }
    return;
  }
  if (!state.token && onlyRemote) {
    renderSuggestionStatus(NUTRITION_EMPTY_STATE_MESSAGE, 'suggestion-empty');
    return;
  }
  state.suggestionQuery = query;
  renderSuggestionStatus('Searching foods…');
  const executeSearch = async () => {
    const activeQuery = state.suggestionQuery;
    try {
      const response = await apiFetch(`/api/nutrition/search?q=${encodeURIComponent(activeQuery)}`, {
        headers: { Authorization: `Bearer ${state.token}` },
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload) {
        throw new Error(payload?.message || 'Lookup failed.');
      }
      const latestQuery = nutritionNameInput?.value.trim() || '';
      if (activeQuery !== latestQuery) {
        return;
      }
      const remoteSuggestions = Array.isArray(payload.suggestions) ? payload.suggestions : [];
      const localSuggestions = onlyRemote ? [] : getLocalNutritionSuggestions(activeQuery);
      state.suggestions = rankNutritionSuggestions(
        dedupeNutritionSuggestions([...remoteSuggestions, ...localSuggestions]),
        activeQuery,
        { preferredType: nutritionTypeSelect?.value || 'Food' }
      );
      state.activeSuggestionIndex = -1;
      if (!state.suggestions.length) {
        renderSuggestionStatus(NUTRITION_EMPTY_STATE_MESSAGE, 'suggestion-empty');
        return;
      }
      state.nutritionSuggestionStatus = 'ready';
      renderSuggestions();
    } catch (error) {
      const latestQuery = nutritionNameInput?.value.trim() || '';
      if (activeQuery !== latestQuery) {
        return;
      }
      if (onlyRemote) {
        renderSuggestionStatus('Unable to load results. Try again or add a custom item.', 'suggestion-empty');
      } else {
        setNutritionFeedback('Food search is temporarily unavailable. Showing close local matches.');
        showQuickSuggestions(activeQuery);
        if (!state.suggestions.length) {
          renderSuggestionStatus(NUTRITION_EMPTY_STATE_MESSAGE, 'suggestion-empty');
        }
      }
    }
  };
  if (immediate) {
    executeSearch();
    return;
  }
  state.suggestionTimer = setTimeout(executeSearch, 300);
}

function setDeleteButtonState(entryId, isLoading) {
  if (!nutritionEntriesList) return;
  const selector = `button[data-action="delete-entry"][data-entry-id="${entryId}"]`;
  const button = nutritionEntriesList.querySelector(selector);
  if (!button) return;
  button.disabled = isLoading;
  button.textContent = isLoading ? 'Removing...' : 'Remove';
}

function getOrCreateUndoToastContainer() {
  let container = document.getElementById('nutritionUndoToastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'nutritionUndoToastContainer';
    container.className = 'undo-toast-container';
    document.body.appendChild(container);
  }
  return container;
}

function showUndoDeleteToast(entryId, entryName, undoFn, durationMs) {
  const container = getOrCreateUndoToastContainer();
  const toastId = `toast-delete-${entryId}`;
  const existing = document.getElementById(toastId);
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = toastId;
  toast.className = 'undo-toast';

  const msg = document.createElement('span');
  msg.textContent = `Removed \u201c${entryName}\u201d.`;

  const countdownEl = document.createElement('span');
  countdownEl.className = 'undo-toast-countdown';
  const startTime = Date.now();
  countdownEl.textContent = `${Math.ceil(durationMs / 1000)}s`;

  const ticker = setInterval(() => {
    const remaining = Math.max(0, Math.ceil((durationMs - (Date.now() - startTime)) / 1000));
    countdownEl.textContent = `${remaining}s`;
  }, 250);

  const undoButton = document.createElement('button');
  undoButton.type = 'button';
  undoButton.className = 'undo-toast-btn';
  undoButton.textContent = 'Undo';
  undoButton.addEventListener('click', () => {
    clearInterval(ticker);
    const pending = state.nutritionPendingDeletes.get(entryId);
    if (pending) {
      clearTimeout(pending.timeoutId);
      state.nutritionPendingDeletes.delete(entryId);
    }
    toast.remove();
    undoFn();
  });

  toast.appendChild(msg);
  toast.appendChild(countdownEl);
  toast.appendChild(undoButton);
  container.appendChild(toast);

  return () => { clearInterval(ticker); toast.remove(); };
}

async function commitDeleteNutritionEntry(entryId, entryName) {
  state.nutritionDeletingEntries.add(entryId);
  try {
    const response = await apiFetch(`/api/nutrition/${entryId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${state.token}` },
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(payload?.message || 'Unable to remove that item.');
    }
    await refreshNutritionLinkedViews();
    setNutritionFeedback(payload?.message || `${entryName} removed.`, { tone: 'success' });
  } catch (error) {
    setNutritionFeedback(error.message);
  } finally {
    state.nutritionDeletingEntries.delete(entryId);
  }
}

function deleteNutritionEntry(entryId) {
  if (!state.token || !Number.isFinite(entryId) || entryId <= 0) return;
  if (!canModifyOwnNutrition()) return;
  if (state.nutritionDeletingEntries.has(entryId) || state.nutritionPendingDeletes.has(entryId)) return;

  const entryEl = nutritionEntriesList?.querySelector(`li[data-entry-id="${entryId}"]`);
  const entryName = entryEl?.querySelector('h4')?.textContent || 'Item';

  if (entryEl) entryEl.classList.add('pending-delete');
  setDeleteButtonState(entryId, true);

  const UNDO_DURATION_MS = 7000;

  const undoFn = () => {
    if (entryEl) entryEl.classList.remove('pending-delete');
    setDeleteButtonState(entryId, false);
    setNutritionFeedback('');
  };

  const dismissToast = showUndoDeleteToast(entryId, entryName, undoFn, UNDO_DURATION_MS);

  const timeoutId = setTimeout(async () => {
    dismissToast();
    state.nutritionPendingDeletes.delete(entryId);
    await commitDeleteNutritionEntry(entryId, entryName);
  }, UNDO_DURATION_MS);

  state.nutritionPendingDeletes.set(entryId, { timeoutId, entryName, undoFn, dismissToast });
}

function setAvatarValue(value) {
  if (avatarValueInput) {
    avatarValueInput.value = value;
  }
}

function setActiveAvatarButton(target) {
  avatarOptionButtons.forEach((button) => {
    button.classList.toggle('active', button === target);
  });
}

function initializeAvatarPicker() {
  if (!avatarOptionButtons.length) {
    return;
  }

  avatarOptionButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const value = button.dataset.avatarOption || '';
      if (value === 'custom') {
        setActiveAvatarButton(button);
        customAvatarInput?.focus();
        const typed = customAvatarInput?.value.trim();
        setAvatarValue(typed);
        return;
      }

      lastPresetAvatar = value;
      setAvatarValue(value);
      if (customAvatarInput) {
        customAvatarInput.value = '';
      }
      setActiveAvatarButton(button);
    });
  });

  customAvatarInput?.addEventListener('input', (event) => {
    const value = event.target.value.trim();
    const customButton = avatarOptionButtons.find((btn) => btn.dataset.avatarOption === 'custom');
    if (value) {
      setAvatarValue(value);
      if (customButton) {
        setActiveAvatarButton(customButton);
      }
      return;
    }

    if (lastPresetAvatar) {
      const fallbackButton = avatarOptionButtons.find(
        (btn) => btn.dataset.avatarOption === lastPresetAvatar
      );
      if (fallbackButton) {
        setAvatarValue(lastPresetAvatar);
        setActiveAvatarButton(fallbackButton);
      }
    }
  });
}

function handleProfileAvatarUpload(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) {
    if (profileAvatarStatus) {
      profileAvatarStatus.textContent = 'Photo must be smaller than 5 MB.';
    }
    event.target.value = '';
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    const result = reader.result;
    if (typeof result === 'string') {
      const base64 = result.includes(',') ? result.split(',').pop() : result;
      profileAvatarPhotoData = base64 || null;
      profileAvatarPhotoChanged = true;
      profileAvatarUrlChanged = !!profileAvatarInitialUrl;
      if (profileAvatarUrlInput) {
        profileAvatarUrlInput.value = '';
      }
      setProfileAvatarPreview(result);
      if (profileAvatarStatus) {
        profileAvatarStatus.textContent = 'Photo ready to upload.';
      }
    }
  };
  reader.onerror = () => {
    if (profileAvatarStatus) {
      profileAvatarStatus.textContent = 'Could not read photo. Try another file.';
    }
  };
  reader.readAsDataURL(file);
}

function clearProfileAvatarSelection({ showMessage = true } = {}) {
  if (profileAvatarUploadInput) {
    profileAvatarUploadInput.value = '';
  }
  if (profileAvatarUrlInput) {
    profileAvatarUrlInput.value = '';
  }
  profileAvatarPhotoData = null;
  profileAvatarPhotoChanged = profileAvatarInitialPhoto !== null;
  profileAvatarUrlChanged = profileAvatarInitialUrl !== '';
  setProfileAvatarPreview(null);
  if (profileAvatarStatus && showMessage) {
    profileAvatarStatus.textContent = 'Avatar will be removed when you save.';
  }
}

function handleProfileAvatarUrlInput(event) {
  const value = event.target.value.trim();
  const changed = value !== profileAvatarInitialUrl;
  profileAvatarUrlChanged = changed;
  if (changed) {
    if (profileAvatarInitialPhoto) {
      profileAvatarPhotoData = null;
      profileAvatarPhotoChanged = true;
    }
    if (value) {
      setProfileAvatarPreview(value);
      if (profileAvatarStatus) {
        profileAvatarStatus.textContent = 'Avatar will use this URL.';
      }
    } else {
      setProfileAvatarPreview(null);
      if (profileAvatarStatus) {
        profileAvatarStatus.textContent = 'Avatar will be cleared.';
      }
    }
  } else {
    profileAvatarPhotoChanged = false;
    profileAvatarPhotoData = null;
    setProfileAvatarPreview(resolveAvatarSrc(state.user));
    if (profileAvatarStatus) {
      profileAvatarStatus.textContent = '';
    }
  }
}

function updateViewingChip(subject) {
  if (!viewingChip) return;
  if (!subject || !state.user) {
    viewingChip.textContent = 'Viewing your own dashboard';
    return;
  }
  viewingChip.textContent =
    subject.id === state.user.id
      ? 'Viewing your own dashboard'
      : `Viewing ${subject.name}'s dashboard`;
}

function updateSubjectContext(subject) {
  if (!subject) return;
  state.subject = subject;
  const goalSteps = subject.goal_steps ? `${formatNumber(subject.goal_steps)} steps` : 'Custom goals';
  const contextParts = [subject.role || 'Athlete'];
  if (subject.weight_category) {
    contextParts.push(subject.weight_category);
  }
  contextParts.push(goalSteps);
  readinessHeadline.textContent = contextParts.join(' • ');
  updateViewingChip(subject);
  updateNutritionFormVisibility();
  updateWeightFormVisibility();
  refreshWeightHeightContext();
}

function updateSharePanelVisibility(user) {
  if (!sharePanel) return;
  const signedOut = !user;
  const allowSharing = Boolean(user && !hasCoachPermissions(user.role));

  shareForm?.classList.toggle('hidden', !allowSharing);
  if (shareDisabledMessage) {
    const message = signedOut
      ? 'Sign in with an athlete account to share access.'
      : 'Sharing is limited to athlete accounts. Switch profiles to invite coaches.';
    shareDisabledMessage.textContent = message;
    shareDisabledMessage.classList.toggle('hidden', allowSharing);
  }

  if (!allowSharing) {
    clearShareInputs({ disableSelect: true });
    return;
  }

  shareCoachSelect?.removeAttribute('disabled');
  if (state.coachesLoaded) {
    populateCoachSelect();
  } else {
    loadCoachDirectory();
  }
}

function setAdminFeedback(message = '') {
  if (adminFeedback) {
    adminFeedback.textContent = message;
  }
}
function updateAdminPanelVisibility(user) {
  if (!adminPanel) return;
  const showAdmin = Boolean(user && isHeadCoachRole(user.role));
  adminPanel.classList.toggle('hidden', !showAdmin);
  if (!showAdmin && adminUserSelect) {
    adminUserSelect.value = '';
  }
  if (!showAdmin) {
    setAdminFeedback('');
  }
}

function populateAdminUserOptions() {
  if (!adminUserSelect) return;
  adminUserSelect.innerHTML = '<option value="">Choose a member</option>';
  if (!state.user || !isHeadCoachRole(state.user.role)) {
    return;
  }
  state.roster
    .filter((member) => member.id !== state.user.id)
    .forEach((member) => {
      const option = document.createElement('option');
      option.value = String(member.id);
      option.textContent = `${member.name} • ${member.role || 'Athlete'}`;
      adminUserSelect.appendChild(option);
    });
}

function getSelectedAdminUserId() {
  if (!adminUserSelect) return null;
  const raw = adminUserSelect.value;
  if (!raw) {
    return null;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

async function submitAdminAction({ endpoint, method = 'POST', body, pending, success }) {
  if (!state.token) return;
  setAdminFeedback(pending);
  try {
    const response = await apiFetch(endpoint, {
      method,
      headers: {
        Authorization: `Bearer ${state.token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    let payload = null;
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      payload = await response.json().catch(() => null);
    }
    if (!response.ok) {
      throw new Error(payload?.message || 'Unable to complete request.');
    }
    setAdminFeedback(payload?.message || success);
    if (adminUserSelect) {
      adminUserSelect.value = '';
    }
    await fetchRoster();
  } catch (error) {
    setAdminFeedback(error.message);
  }
}

async function promoteSelectedUser() {
  const userId = getSelectedAdminUserId();
  if (!userId) {
    setAdminFeedback('Select a member first.');
    return;
  }
  const confirmed =
    typeof window === 'undefined' ? true : window.confirm('Promote this member to Coach?');
  if (!confirmed) return;
  await submitAdminAction({
    endpoint: '/api/admin/promote',
    body: { userId },
    pending: 'Promoting member...',
    success: 'Member promoted to Coach.',
  });
}

async function demoteSelectedUser() {
  const userId = getSelectedAdminUserId();
  if (!userId) {
    setAdminFeedback('Select a member first.');
    return;
  }
  const confirmed =
    typeof window === 'undefined' ? true : window.confirm('Demote this coach to Athlete?');
  if (!confirmed) return;
  await submitAdminAction({
    endpoint: '/api/admin/demote',
    body: { userId },
    pending: 'Demoting coach...',
    success: 'Coach demoted to Athlete.',
  });
}

async function deleteSelectedUser() {
  const userId = getSelectedAdminUserId();
  if (!userId) {
    setAdminFeedback('Select a member first.');
    return;
  }
  const confirmed =
    typeof window === 'undefined'
      ? true
      : window.confirm('Delete this account and all related data? This cannot be undone.');
  if (!confirmed) return;
  await submitAdminAction({
    endpoint: `/api/admin/users/${userId}`,
    method: 'DELETE',
    pending: 'Deleting account...',
    success: 'Account deleted.',
  });
}

async function resetSelectedUserPassword() {
  const userId = getSelectedAdminUserId();
  if (!userId) {
    setAdminFeedback('Select a member first.');
    return;
  }
  const tempPassword = adminPasswordInput?.value?.trim() || '';
  if (tempPassword && tempPassword.length < 8) {
    setAdminFeedback('Temporary password must be at least 8 characters.');
    return;
  }
  const confirmed =
    typeof window === 'undefined'
      ? true
      : window.confirm(
          tempPassword
            ? `Reset this account password to "${tempPassword}"?`
            : 'Reset this account password to "Password"?'
        );
  if (!confirmed) return;
  await submitAdminAction({
    endpoint: '/api/admin/reset-password',
    body: { userId, password: tempPassword || undefined },
    pending: 'Resetting password...',
    success: tempPassword
      ? `Password reset to "${tempPassword}".`
      : 'Password reset to "Password".',
  });
  if (adminPasswordInput) {
    adminPasswordInput.value = '';
  }
}

function prefillProfileForm(user) {
  if (!profileForm || !user) return;
  profileAvatarInitialUrl = user.avatar_url || '';
  profileAvatarInitialPhoto = user.avatar_photo || null;
  profileAvatarPhotoData = null;
  profileAvatarPhotoChanged = false;
  profileAvatarUrlChanged = false;
  if (profileNameInput) profileNameInput.value = user.name || '';
  if (profileWeightCategorySelect) {
    profileWeightCategorySelect.value = user.weight_category || '';
  }
  if (profileEmailInput) profileEmailInput.value = user.email || '';
  if (profilePasswordInput) profilePasswordInput.value = '';
  if (profileCurrentPasswordInput) profileCurrentPasswordInput.value = '';
  if (profileFeedback) profileFeedback.textContent = '';
  if (profileStravaClientIdInput) profileStravaClientIdInput.value = user.strava_client_id || '';
  if (profileStravaClientSecretInput) {
    profileStravaClientSecretInput.value = user.strava_client_secret || '';
  }
  if (profileStravaRedirectUriInput) {
    profileStravaRedirectUriInput.value = user.strava_redirect_uri || '';
  }
  if (profileAvatarUrlInput) {
    profileAvatarUrlInput.value = profileAvatarInitialUrl;
  }
  if (profileAvatarUploadInput) {
    profileAvatarUploadInput.value = '';
  }
  const previewSrc = resolveAvatarSrc(user);
  setProfileAvatarPreview(previewSrc);
  if (profileAvatarStatus) {
    if (user.avatar_photo) {
      profileAvatarStatus.textContent = 'Using uploaded photo.';
    } else if (user.avatar_url) {
      profileAvatarStatus.textContent = 'Using linked avatar.';
    } else {
      profileAvatarStatus.textContent = '';
    }
  }
}

function populateCoachSelect() {
  if (!shareCoachSelect) return;
  const hasCoaches = Array.isArray(state.coaches) && state.coaches.length > 0;
  const placeholder = hasCoaches ? 'Choose a coach' : 'No coaches available';
  shareCoachSelect.innerHTML = `<option value="">${placeholder}</option>`;
  shareCoachSelect.disabled = !hasCoaches;

  if (!hasCoaches) {
    return;
  }

  state.coaches.forEach((coach) => {
    const option = document.createElement('option');
    option.value = String(coach.id);
    option.textContent = `${coach.name} • ${coach.role}`;
    shareCoachSelect.appendChild(option);
  });
}

async function loadCoachDirectory(force = false) {
  if (!shareCoachSelect || !state.token || !state.user) return;
  if (hasCoachPermissions(state.user.role)) return;
  if (!force && state.coachesLoaded) {
    populateCoachSelect();
    return;
  }

  shareCoachSelect.disabled = true;
  shareCoachSelect.innerHTML = '<option value="">Loading coaches...</option>';

  try {
    const response = await apiFetch('/api/share/coaches', {
      headers: {
        Authorization: `Bearer ${state.token}`,
      },
    });
    if (!response.ok) {
      throw new Error('Unable to load coaches.');
    }
    const payload = await response.json();
    state.coaches = payload.coaches || [];
    state.coachesLoaded = true;
    populateCoachSelect();
    if (shareFeedback && !shareForm?.classList.contains('hidden')) {
      shareFeedback.textContent = '';
    }
  } catch (error) {
    state.coaches = [];
    state.coachesLoaded = false;
    populateCoachSelect();
    if (shareFeedback) {
      shareFeedback.textContent = error.message;
    }
  }
}

function highlightRanking(athleteId) {
  if (!coachRanking) return;
  coachRanking.querySelectorAll('li').forEach((item) => {
    const isActive = athleteId && item.dataset.athleteId === String(athleteId);
    item.classList.toggle('active', Boolean(isActive));
  });
}

function renderCoachPanel() {
  if (!athleteSwitcher || !coachRanking) return;

  athleteSwitcher.innerHTML = '<option value="self">My dashboard</option>';
  state.roster.forEach((athlete) => {
    if (!state.user || athlete.id === state.user.id) {
      return;
    }
    const option = document.createElement('option');
    option.value = String(athlete.id);
    option.textContent = athlete.name;
    athleteSwitcher.appendChild(option);
  });

  const selectedValue =
    state.viewing && state.viewing.id !== state.user.id ? String(state.viewing.id) : 'self';
  athleteSwitcher.value = selectedValue;

  coachRanking.innerHTML = '';
  state.roster.forEach((athlete) => {
    const readinessLabel =
      typeof athlete.readinessScore === 'number' ? `${athlete.readinessScore}%` : '—';
    const stepsLabel = athlete.steps ? `${formatNumber(athlete.steps)} steps` : 'Awaiting sync';
    const avatarSrc = resolveAvatarSrc(athlete);
    const avatarMarkup = avatarSrc
      ? `<img class="coach-avatar" src="${avatarSrc}" alt="${athlete.name}" />`
      : '<div class="coach-avatar fallback"></div>';
    const li = document.createElement('li');
    li.dataset.athleteId = String(athlete.id);
    li.setAttribute('role', 'button');
    li.setAttribute('tabindex', '0');
    if (state.viewing && state.viewing.id === athlete.id) {
      li.classList.add('active');
    }
    li.innerHTML = `
      <span class="rank-pill">${athlete.rank}</span>
      ${avatarMarkup}
      <div class="athlete-info">
        <h4>${athlete.name}</h4>
        <p>${[athlete.role || 'Athlete', athlete.weight_category, stepsLabel].filter(Boolean).join(' • ')}</p>
      </div>
      <span class="score">${readinessLabel}</span>
    `;
    coachRanking.appendChild(li);
  });
  enforceScrollableList(coachRanking);
}

async function fetchRoster() {
  if (!coachPanel) return;
  try {
    const response = await apiFetch('/api/athletes', {
      headers: { Authorization: `Bearer ${state.token}` },
    });
    if (!response.ok) {
      throw new Error('Unable to load athletes.');
    }
    const payload = await response.json();
    state.roster = payload.athletes || [];
    populateAdminUserOptions();
    updateAdminPanelVisibility(state.user);

    if (!state.roster.length) {
      coachPanel.classList.add('hidden');
      if (coachRanking) {
        coachRanking.innerHTML = '';
        enforceScrollableList(coachRanking);
      }
      if (athleteSwitcher) {
        athleteSwitcher.innerHTML = '<option value="self">My dashboard</option>';
        athleteSwitcher.value = 'self';
      }
      state.viewing = state.user;
      highlightRanking(null);
      setAdminFeedback('');
      return;
    }

    coachPanel.classList.remove('hidden');

    if (!state.viewing) {
      state.viewing = state.user;
    } else if (state.viewing.id !== state.user.id) {
      const match = state.roster.find((athlete) => athlete.id === state.viewing.id);
      state.viewing = match || state.user;
    }

    renderCoachPanel();
    const activeId =
      state.viewing && state.viewing.id !== state.user.id ? state.viewing.id : null;
    highlightRanking(activeId);
  } catch (error) {
    coachPanel.classList.add('hidden');
    state.roster = [];
    state.viewing = state.user;
    highlightRanking(null);
    populateAdminUserOptions();
    updateAdminPanelVisibility(state.user);
    setAdminFeedback(error.message);
  }
}

function handleAthleteSelection(selection) {
  if (!state.user) return;
  if (!selection || selection === 'self') {
    state.viewing = state.user;
    updateSubjectContext(state.user);
    highlightRanking(null);
    state.nutrition.date = null;
    if (athleteSwitcher) {
      athleteSwitcher.value = 'self';
    }
    loadMetrics();
    loadNutrition(undefined, { resetDate: true });
    loadActivity();
    loadVitals();
    loadWeight();
    return;
  }

  const athlete = state.roster.find((item) => String(item.id) === String(selection));
  if (!athlete) {
    return;
  }
  state.viewing = athlete;
  updateSubjectContext(athlete);
  highlightRanking(athlete.id);
  state.nutrition.date = null;
  if (athleteSwitcher) {
    athleteSwitcher.value = String(athlete.id);
  }
  loadMetrics(athlete.id);
  loadNutrition(athlete.id, { resetDate: true });
  loadActivity(athlete.id);
  loadVitals(athlete.id);
  loadWeight(athlete.id);
}
function setActivePage(targetPage = 'overview') {
  if (targetPage === 'sessions') {
    targetPage = 'activity';
  }

  state.currentPage = targetPage;

  document.querySelectorAll('#sideNav [data-page]').forEach((button) => {
    const isActive = button.dataset.page === targetPage;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-pressed', String(isActive));
  });

  pageContainers.forEach((panel) => {
    panel.classList.toggle('hidden', panel.dataset.subpage !== targetPage);
  });

  const copy = pageCopy[targetPage] || pageCopy.overview;
  if (pageTitle) pageTitle.textContent = copy.title;
  if (pageSubtitle) pageSubtitle.textContent = copy.subtitle;

  if (targetPage === 'sharing') {
    updateSharePanelVisibility(state.user);
  }
  if (targetPage === 'overview') {
    loadMetrics(state.viewing?.id ?? state.user?.id);
  }
  if (targetPage === 'nutrition') {
    loadNutrition(state.viewing?.id ?? state.user?.id);
  }
  if (targetPage === 'activity') {
    loadActivity(state.viewing?.id ?? state.user?.id);
  }
  if (targetPage === 'vitals') {
    loadVitals(state.viewing?.id ?? state.user?.id);
  } else {
    stopPpgPoll();
  }
  if (targetPage === 'weight') {
    loadWeight(state.viewing?.id ?? state.user?.id);
    if (!weightDateInput?.value) {
      setWeightDateDefault();
    }
  }
  queueChartResize();
}

function resetToAuth(message = '') {
  clearPersistedSession();
  state.token = null;
  state.user = null;
  state.viewing = null;
  state.subject = null;
  state.roster = [];
  state.coaches = [];
  state.coachesLoaded = false;
  state.nutritionAmountBaseline = null;
  state.nutritionMacroReference = null;
  state.nutritionDeletingEntries.clear();
  state.nutritionPendingDeletes.forEach((p) => { clearTimeout(p.timeoutId); p.dismissToast?.(); });
  state.nutritionPendingDeletes.clear();
  state.hydrationEntries = [];
  setAmountReference(null);
  if (state.suggestionTimer) {
    clearTimeout(state.suggestionTimer);
    state.suggestionTimer = null;
  }
  clearSuggestions();
  resetNutritionState();
  resetActivityState();
  resetVitalsState();
  resetWeightState();
  dashboard.classList.add('hidden');
  loginPanel.classList.remove('hidden');
  setActivePage('overview');
  setSidebarOpen(false);
  setAuthMode('login');
  loginForm?.reset();
  signupForm?.reset();
  if (avatarOptionButtons.length) {
    const defaultButton = avatarOptionButtons.find(
      (button) => button.dataset.avatarOption !== 'custom'
    );
    if (defaultButton) {
      lastPresetAvatar = defaultButton.dataset.avatarOption;
      setAvatarValue(lastPresetAvatar);
      setActiveAvatarButton(defaultButton);
    }
  }
  if (customAvatarInput) {
    customAvatarInput.value = '';
  }
  if (coachPanel) {
    coachPanel.classList.add('hidden');
  }
  if (coachRanking) {
    coachRanking.innerHTML = '';
    enforceScrollableList(coachRanking);
  }
  if (athleteSwitcher) {
    athleteSwitcher.innerHTML = '<option value="self">My dashboard</option>';
    athleteSwitcher.value = 'self';
  }
  if (adminUserSelect) {
    adminUserSelect.innerHTML = '<option value="">Choose a member</option>';
  }
  if (adminUserSelect) {
    adminUserSelect.innerHTML = '<option value="">Choose a member</option>';
  }
  updateViewingChip(null);
  updateSharePanelVisibility(null);
  updateAdminPanelVisibility(null);
  setAdminFeedback('');
  clearShareInputs({ disableSelect: true });
  updateNutritionFormVisibility();
  prefillProfileForm({ name: '', email: '', weight_category: '' });
  setWeightDateDefault();
  updateWeightFormVisibility();
  if (loginFeedback) loginFeedback.textContent = message;
  if (signupFeedback) signupFeedback.textContent = '';
}

if (sideNav) {
  sideNav.addEventListener('click', (event) => {
    const target = event.target.closest('[data-page]');
    if (!target) return;
    setActivePage(target.dataset.page);
    if (shouldUseSidebarOverlay()) {
      setSidebarOpen(false);
    }
  });
}

sidebarToggle?.addEventListener('click', () => {
  const isOpen = Boolean(document?.body?.classList.contains('sidebar-open'));
  setSidebarOpen(!isOpen);
});

sidebarBackdrop?.addEventListener('click', () => {
  setSidebarOpen(false);
});

if (typeof document !== 'undefined') {
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    const hasOpenSidebar = Boolean(document.body?.classList.contains('sidebar-open'));
    if (!hasOpenSidebar || !shouldUseSidebarOverlay()) {
      return;
    }
    setSidebarOpen(false);
  });
}

if (typeof window !== 'undefined') {
  window.addEventListener('resize', () => {
    if (!shouldUseSidebarOverlay()) {
      setSidebarOpen(false);
    }
  });
}

setSidebarOpen(false);

async function restoreSessionFromStorage() {
  const stored = readPersistedSession();
  if (!stored) {
    return;
  }
  if (loginFeedback) {
    loginFeedback.textContent = 'Restoring your session...';
  }
  try {
    await completeAuthentication(stored);
  } catch (error) {
    clearPersistedSession();
    resetToAuth(error?.message || 'Please sign in again.');
  }
}

setMacroTargetExpanded(false);
updateNutritionFormVisibility();
setActivePage('overview');
if (authTabs) {
  authTabs.addEventListener('click', (event) => {
    const target = event.target.closest('[data-auth-mode]');
    if (!target) return;
    setAuthMode(target.dataset.authMode);
  });
}
setAuthMode('login');
initializeAvatarPicker();
profileAvatarUploadInput?.addEventListener('change', handleProfileAvatarUpload);
profileAvatarClearButton?.addEventListener('click', () => clearProfileAvatarSelection());
profileAvatarUrlInput?.addEventListener('input', handleProfileAvatarUrlInput);
athleteSwitcher?.addEventListener('change', (event) =>
  handleAthleteSelection(event.target.value)
);
const shiftNutritionDate = (delta) => {
  const current = getActiveNutritionDate();
  const next = shiftIsoDate(current, delta);
  if (next) {
    requestNutritionDate(next);
  }
};
nutritionPrevDayButton?.addEventListener('click', () => shiftNutritionDate(-1));
nutritionNextDayButton?.addEventListener('click', () => shiftNutritionDate(1));
nutritionTodayButton?.addEventListener('click', () => requestNutritionDate(getTodayIsoDate()));
nutritionDateLabel?.addEventListener('click', openNutritionDatePicker);
nutritionDateInput?.addEventListener('change', (event) => {
  const value = event.target?.value;
  if (!value) return;
  const normalized = normalizeIsoDate(value);
  if (normalized) {
    requestNutritionDate(normalized);
  } else {
    event.target.value = getActiveNutritionDate();
  }
});
forgotPasswordButton?.addEventListener('click', () => setAuthMode('forgot'));
backToLoginButtons.forEach((button) => {
  button.addEventListener('click', () => setAuthMode(button.dataset.authBack || 'login'));
});
activityPrimarySessionsList?.addEventListener('click', handleActivitySessionClick);
activityPrimarySessionsList?.addEventListener('keydown', handleActivitySessionKeydown);
activitySessionsList?.addEventListener('click', handleActivitySessionClick);
stravaConnectButton?.addEventListener('click', handleStravaConnect);
stravaSyncButton?.addEventListener('click', handleStravaSync);
stravaDisconnectButton?.addEventListener('click', handleStravaDisconnect);
stravaExportButton?.addEventListener('click', handleStravaExportSelectedSession);
window.addEventListener('message', handleStravaMessage);
sleepGoalInput?.addEventListener('change', handleSleepGoalInputChange);
const handleRankingSelection = (target) => {
  if (!target) return;
  const selectedId = target.dataset.athleteId;
  const value = selectedId === String(state.user?.id) ? 'self' : selectedId;
  handleAthleteSelection(value);
  if (athleteSwitcher && value) {
    athleteSwitcher.value = value;
  }
};

coachRanking?.addEventListener('click', (event) => {
  const target = event.target.closest('[data-athlete-id]');
  handleRankingSelection(target);
});

coachRanking?.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  const target = event.target.closest('[data-athlete-id]');
  if (!target) return;
  event.preventDefault();
  handleRankingSelection(target);
});

shareCoachSelect?.addEventListener('change', () => {
  if (shareCoachSelect.value && shareEmailInput) {
    shareEmailInput.value = '';
  }
  if (shareFeedback) {
    shareFeedback.textContent = '';
  }
});

shareEmailInput?.addEventListener('input', () => {
  if (!shareCoachSelect) return;
  if (shareEmailInput.value.trim()) {
    shareCoachSelect.value = '';
  }
});

shareForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!state.token) return;

  const emailValue = shareEmailInput ? shareEmailInput.value : '';
  const typedEmail = emailValue.trim().toLowerCase();
  const selectValue = shareCoachSelect ? shareCoachSelect.value : '';
  const selectedCoach = selectValue.trim();
  const sharePayload = {};

  if (typedEmail) {
    sharePayload.coachEmail = typedEmail;
  } else if (selectedCoach) {
    const coachId = Number.parseInt(selectedCoach, 10);
    if (Number.isNaN(coachId)) {
      shareFeedback.textContent = 'Invalid coach selection.';
      return;
    }
    sharePayload.coachId = coachId;
  } else {
    shareFeedback.textContent = 'Choose a coach or enter their email.';
    return;
  }

  shareFeedback.textContent = 'Sending access...';
  try {
    const response = await apiFetch('/api/share', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${state.token}`,
      },
      body: JSON.stringify(sharePayload),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload) {
      throw new Error(payload?.message || 'Unable to share access.');
    }
    shareFeedback.textContent = payload.message;
    shareForm.reset();
    if (shareCoachSelect) {
      shareCoachSelect.value = '';
    }
  } catch (error) {
    shareFeedback.textContent = error.message;
  }
});

initializeBarcodeScanner();
nutritionScanButton?.addEventListener('mouseenter', warmupBarcodeDetector);
nutritionScanButton?.addEventListener('focus', warmupBarcodeDetector);
nutritionScanButton?.addEventListener('click', () => {
  if (barcodeScanState.active) {
    stopBarcodeScan();
    return;
  }
  startBarcodeScan();
});
nutritionPhotoButton?.addEventListener('click', () => nutritionPhotoInput?.click());
nutritionPhotoInput?.addEventListener('change', handleNutritionPhotoUpload);
nutritionPhotoClearButton?.addEventListener('click', () => clearNutritionPhotoSelection());
nutritionPhotoDropZone?.addEventListener('dragenter', (event) => {
  event.preventDefault();
  event.stopPropagation();
  toggleNutritionPhotoDropZone(true);
});
nutritionPhotoDropZone?.addEventListener('dragover', (event) => {
  event.preventDefault();
  event.stopPropagation();
  toggleNutritionPhotoDropZone(true);
});
nutritionPhotoDropZone?.addEventListener('dragleave', (event) => {
  event.preventDefault();
  event.stopPropagation();
  toggleNutritionPhotoDropZone(false);
});
nutritionPhotoDropZone?.addEventListener('drop', handleNutritionPhotoDrop);
renderNutritionPhotoPreview();
setNutritionPhotoStatus('');

document.addEventListener('visibilitychange', () => {
  if (document.hidden && barcodeScanState.active) {
    stopBarcodeScan({
      message: 'Scan paused while the app is hidden.',
      resetToDefault: false,
    });
  }
});

nutritionLookupButton?.addEventListener('pointerdown', (event) => {
  event.preventDefault();
});

nutritionLookupButton?.addEventListener('mousedown', (event) => {
  event.preventDefault();
});

nutritionLookupButton?.addEventListener('click', () => {
  const query = nutritionNameInput?.value.trim() || '';
  if (!query) {
    setNutritionFeedback('Type a food name, then search the food database.');
    focusNutritionComposer();
    showQuickSuggestions();
    return;
  }
  if (state.nutritionCustomMode) {
    setNutritionCustomMode(false);
  }
  setNutritionFeedback('');
  scheduleSuggestionFetch({ immediate: true, onlyRemote: true });
});
nutritionCustomToggle?.addEventListener('click', () => {
  setNutritionCustomMode(!state.nutritionCustomMode);
  updateSuggestionBarVisibility();
  if (state.nutritionCustomMode) {
    clearSuggestions();
    setNutritionFeedback('Custom item mode is open. Enter your own macros when the search results are not right.');
  } else {
    setNutritionFeedback('');
    const query = nutritionNameInput?.value.trim() || '';
    if (query) {
      scheduleSuggestionFetch();
    } else {
      showQuickSuggestions();
    }
  }
});
nutritionMatchChangeButton?.addEventListener('click', () => {
  clearResolvedNutritionSelection({ resetType: true, clearFeedback: true });
  const query = nutritionNameInput?.value.trim() || '';
  if (query) {
    scheduleSuggestionFetch();
  } else {
    showQuickSuggestions();
  }
  focusNutritionComposer({ selectText: true });
  setNutritionFeedback('Pick a different result or choose Custom item.');
});
nutritionTypeSelect?.addEventListener('change', () => {
  let filled = false;
  if (nutritionTypeSelect) {
    const defaultUnit = getUnitForType(nutritionTypeSelect.value);
    if (getSelectedUnit() !== UNIT_PORTION) {
      setSelectedUnit(defaultUnit, { applyAmount: true, resetAmountOnFailure: true });
      filled = true;
    } else {
      filled = updateAmountFieldUnit({ fill: true });
    }
  }
  if (!filled) {
    syncAmountBaselineFromInput();
  }
  const query = nutritionNameInput?.value.trim() || '';
  if (query) {
    scheduleSuggestionFetch();
  } else {
    showQuickSuggestions();
  }
});
nutritionUnitSelect?.addEventListener('change', () => {
  if (!nutritionUnitSelect) return;
  const allowedUnits = getAllowedNutritionUnitsForType(nutritionTypeSelect?.value || 'Food');
  if (!VALID_UNITS.has(nutritionUnitSelect.value) || !allowedUnits.includes(nutritionUnitSelect.value)) {
    setSelectedUnit(getUnitForType(nutritionTypeSelect?.value || 'Food'), {
      applyAmount: true,
      resetAmountOnFailure: true,
    });
    return;
  }
  const filled = setSelectedUnit(nutritionUnitSelect.value, {
    applyAmount: true,
    resetAmountOnFailure: true,
  });
  if (!filled) {
    syncAmountBaselineFromInput();
  }
});
syncNutritionUnitOptions({ forceDefault: true });
updateAmountFieldUnit();
syncAmountBaselineFromInput();
setNutritionCustomMode(false);
nutritionAmountInput?.addEventListener('input', handleAmountInputChange);
const macroInputs = [
  nutritionCaloriesInput,
  nutritionProteinInput,
  nutritionCarbsInput,
  nutritionFatsInput,
  nutritionFiberInput,
];
macroInputs.forEach((input) => {
  input?.addEventListener('input', () => {
    syncAmountBaselineFromInput();
    syncMacroReferenceFromInputs();
    updateNutritionPreview();
  });
});
renderSuggestionBar();
updateSuggestionBarVisibility();
updateNutritionLookupButtonLabel();
nutritionPhotoAnalysis?.addEventListener('input', handleNutritionMealDraftFieldChange);
nutritionPhotoAnalysis?.addEventListener('change', handleNutritionMealDraftFieldChange);
nutritionPhotoAnalysis?.addEventListener('click', handleNutritionMealDraftAction);

nutritionEntriesList?.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action="delete-entry"]');
  if (!button) return;
  const entryId = Number.parseInt(button.dataset.entryId, 10);
  if (!Number.isFinite(entryId)) return;
  deleteNutritionEntry(entryId);
});

nutritionEntryFilters?.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-filter]');
  if (!button) return;
  const nextFilter = button.dataset.filter || 'all';
  setNutritionEntryFilter(nextFilter, { scrollToTop: true });
});

nutritionNameInput?.addEventListener('input', () => {
  clearResolvedNutritionSelectionIfQueryChanged();
  updateSuggestionBarVisibility();
  updateNutritionLookupButtonLabel();
  if (state.nutritionCustomMode) {
    clearSuggestions();
    setNutritionFeedback('');
    return;
  }
  setNutritionFeedback('');
  scheduleSuggestionFetch();
});

nutritionNameInput?.addEventListener('blur', () => {
  setTimeout(() => clearSuggestions(), 150);
});

nutritionNameInput?.addEventListener('focus', () => {
  highlightNutritionNameInput();
  updateSuggestionBarVisibility();
  if (state.nutritionCustomMode) {
    clearSuggestions();
    return;
  }
  const query = nutritionNameInput?.value.trim() || '';
  if (state.suggestions.length) {
    renderSuggestions();
    return;
  }
  if (query) {
    scheduleSuggestionFetch();
  } else {
    showQuickSuggestions();
  }
});

nutritionSuggestions?.addEventListener('click', (event) => {
  const li = event.target.closest('li[data-index]');
  if (!li) return;
  const index = Number.parseInt(li.dataset.index, 10);
  const item = state.suggestions[index];
  applySuggestion(item);
});

nutritionSuggestionBar?.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-suggestion-id]');
  if (!button) return;
  const id = button.dataset.suggestionId;
  const suggestion =
    QUICK_SUGGESTIONS.find((item) => item.id === id) ||
    loadRecentNutritionItems().find((item) => item.id === id);
  applySuggestion(suggestion);
});

nutritionNameInput?.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowDown') {
    if (!state.suggestions.length) return;
    event.preventDefault();
    state.activeSuggestionIndex =
      (state.activeSuggestionIndex + 1) % state.suggestions.length;
    renderSuggestions();
  } else if (event.key === 'ArrowUp') {
    if (!state.suggestions.length) return;
    event.preventDefault();
    state.activeSuggestionIndex =
      (state.activeSuggestionIndex - 1 + state.suggestions.length) % state.suggestions.length;
    renderSuggestions();
  } else if (event.key === 'Enter') {
    if (state.activeSuggestionIndex >= 0) {
      event.preventDefault();
      const item = state.suggestions[state.activeSuggestionIndex];
      applySuggestion(item);
    } else if (nutritionNameInput?.value.trim()) {
      const selection = state.nutritionResolvedSelection;
      const normalizedQuery = normalizeNutritionSearchText(nutritionNameInput.value.trim());
      const hasCommittedSelection =
        Boolean(selection) &&
        selection.mode !== 'custom' &&
        normalizedQuery === selection.normalizedName;
      if (!hasCommittedSelection && !state.nutritionCustomMode) {
        event.preventDefault();
        setNutritionFeedback('Choose a suggestion or open Custom item before logging.');
      }
    }
  } else if (event.key === 'Escape') {
    clearSuggestions();
  }
});

nutritionForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!state.token) return;
  if (!state.user || !state.viewing || state.user.id !== state.viewing.id) {
    setNutritionFeedback('Switch to your own profile to log intake.');
    return;
  }

  const name = nutritionNameInput?.value.trim();
  const barcode = nutritionBarcodeInput?.value.trim();
  const type = nutritionTypeSelect?.value || 'Food';
  const caloriesValue = Number.parseInt(nutritionCaloriesInput?.value, 10);
  const photoData = state.nutritionPhotoData;
  if (state.nutritionPhotoPreparing) {
    setNutritionFeedback('Preparing photo. Please wait a moment and submit again.');
    return;
  }
  if (state.nutritionPhotoAnalyzing) {
    setNutritionFeedback('Meal photo analysis is still running. Please wait a moment.');
    return;
  }

  if (!name && !barcode && !photoData) {
    setNutritionFeedback('Provide a name, barcode, or meal photo.');
    return;
  }

  if (!photoData && !state.nutritionResolvedSelection && !state.nutritionCustomMode) {
    setNutritionFeedback('Select a suggestion or choose Custom item before logging.');
    focusNutritionComposer();
    if (name) {
      scheduleSuggestionFetch();
    } else {
      showQuickSuggestions();
    }
    return;
  }

  if (photoData && !name && !barcode) {
    if (!state.nutritionMealDraft) {
      await analyzeNutritionPhotoSelection();
      if (state.nutritionMealDraft) {
        setNutritionFeedback('Review the detected meal items, then log the edited meal.');
      }
      return;
    }
    await submitNutritionMealDraft();
    return;
  }

  const payload = {
    name,
    barcode,
    type,
  };
  if (photoData) {
    payload.photoData = photoData;
  }
  const activeDate = getActiveNutritionDate();
  if (activeDate) {
    payload.date = activeDate;
  }
  if (Number.isFinite(caloriesValue) && caloriesValue >= 0) {
    payload.calories = caloriesValue;
  }
  const unit = getSelectedUnit();
  const amountValue = Number.parseFloat(nutritionAmountInput?.value);
  if (Number.isFinite(amountValue) && amountValue > 0) {
    payload.weightAmount = Number(amountValue.toFixed(1));
  }
  payload.weightUnit = unit;
  const proteinValue = Number.parseInt(nutritionProteinInput?.value, 10);
  const carbValue = Number.parseInt(nutritionCarbsInput?.value, 10);
  const fatValue = Number.parseInt(nutritionFatsInput?.value, 10);
  const fiberValue = Number.parseInt(nutritionFiberInput?.value, 10);
  if (proteinValue > 0) payload.protein = proteinValue;
  if (carbValue > 0) payload.carbs = carbValue;
  if (fatValue > 0) payload.fats = fatValue;
  if (fiberValue > 0) payload.fiber = fiberValue;

  setNutritionFeedback('Logging item...');
  try {
    const response = await apiFetch('/api/nutrition', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${state.token}`,
      },
      body: JSON.stringify(payload),
    });
    const result = await response.json().catch(() => null);

    if (!response.ok || !result) {
      const fallback = `Unable to log that item (HTTP ${response.status || 'unknown'}).`;
      const detail = result?.message || fallback;
      const codeSuffix = result?.code ? ` [${result.code}]` : '';
      throw new Error(`${detail}${codeSuffix}`);
    }
    const resolvedMealAnalysis = resolveNutritionMealAnalysis(result);
    if (resolvedMealAnalysis) {
      setNutritionPhotoAnalysis(resolvedMealAnalysis);
    } else if (!photoData) {
      clearNutritionPhotoAnalysis();
    }
    const note = result.autoLookup ? ' (nutrition estimated automatically)' : '';
    const detectedName = result.photoAnalysis?.name ? ` Detected: ${result.photoAnalysis.name}.` : '';
    const summary = buildNutritionFeedbackSummary({
      calories: Number.isFinite(caloriesValue) ? caloriesValue : null,
      protein: proteinValue > 0 ? proteinValue : null,
      carbs: carbValue > 0 ? carbValue : null,
      fats: fatValue > 0 ? fatValue : null,
    });
    const summarySuffix = summary ? ` • ${summary}` : '';
    setNutritionFeedback(`${result.message}${note}${detectedName}${summarySuffix}`, { tone: 'success' });
    nutritionForm.reset();
    if (nutritionTypeSelect) {
      nutritionTypeSelect.value = 'Food';
    }
    clearNutritionPhotoSelection({ keepStatus: true, keepAnalysis: true });
    if (result.photoAnalysis?.name) {
      setNutritionPhotoStatus(`Detected and logged: ${result.photoAnalysis.name}.`);
    } else {
      setNutritionPhotoStatus('');
    }
    state.nutritionAmountBaseline = null;
    state.nutritionMacroReference = null;
    setNutritionResolvedSelection(null);
    state.nutritionLogShouldScrollToTop = true;
    setAmountReference(null);
    setNutritionCustomMode(false);
    syncNutritionUnitOptions({ forceDefault: true });
    updateAmountFieldUnit();
    await refreshNutritionLinkedViews();
    clearSuggestions();
    if (name && !photoData) {
      saveRecentNutritionItem({
        id: `recent-local-${Date.now()}`,
        name,
        source: 'Recent',
        serving: Number.isFinite(amountValue) && amountValue > 0 ? `${amountValue}\u202f${unit}` : null,
        prefill: {
          type: payload.type || 'Food',
          calories: payload.calories ?? null,
          protein: payload.protein ?? null,
          carbs: payload.carbs ?? null,
          fats: payload.fats ?? null,
          fiber: payload.fiber ?? null,
          weightAmount: payload.weightAmount ?? null,
          weightUnit: unit,
        },
      });
      renderSuggestionBar();
    }
    focusNutritionComposer();
  } catch (error) {
    setNutritionFeedback(error.message);
    if (photoData) {
      setNutritionPhotoStatus(error.message, { isError: true });
    }
  }
});

nutritionClearButton?.addEventListener('click', () => {
  stopBarcodeScan();
  nutritionForm?.reset();
  clearNutritionPhotoSelection();
  clearSuggestions();
  clearResolvedNutritionSelection({ resetType: true, clearFeedback: true });
  setSelectedUnit(UNIT_FOOD);
  renderSuggestionBar();
  setNutritionFeedback('');
  setNutritionCustomMode(false);
  showQuickSuggestions();
  focusNutritionComposer();
});

macroTargetToggleButton?.addEventListener('click', toggleMacroTargetForm);

macroTargetResetButton?.addEventListener('click', () => {
  macroTargetForm?.reset();
  syncMacroTargetFields(state.nutrition?.goals || {});
  if (macroTargetFeedback) {
    macroTargetFeedback.textContent = '';
  }
});

macroTargetForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!state.user || !state.token) return;
  if (!canEditMacroTargets()) {
    if (macroTargetFeedback) {
      macroTargetFeedback.textContent = 'Switch to your profile to edit macro targets.';
    }
    return;
  }

  const parseMacroInput = (input, max) => {
    if (!input) return null;
    const value = Number.parseInt(input.value, 10);
    if (!Number.isFinite(value) || value <= 0) {
      return null;
    }
    return Math.min(value, max);
  };

  const targets = {
    calories: parseMacroInput(macroTargetCaloriesInput, 15000),
    protein: parseMacroInput(macroTargetProteinInput, 1200),
    carbs: parseMacroInput(macroTargetCarbsInput, 1500),
    fats: parseMacroInput(macroTargetFatsInput, 800),
  };

  const hasAnyTarget = Object.values(targets).some((value) => Number.isFinite(value) && value > 0);
  if (!hasAnyTarget) {
    if (macroTargetFeedback) {
      macroTargetFeedback.textContent = 'Add at least one macro target before saving.';
    }
    return;
  }

  const targetDate = macroTargetDateInput?.value || defaultMacroTargetDate();
  const payload = {
    date: targetDate,
    calories: targets.calories,
    protein: targets.protein,
    carbs: targets.carbs,
    fats: targets.fats,
  };

  if (
    state.user &&
    state.viewing &&
    state.user.role === 'Head Coach' &&
    state.viewing.id !== state.user.id
  ) {
    payload.athleteId = state.viewing.id;
  }

  if (macroTargetFeedback) {
    macroTargetFeedback.textContent = 'Saving targets...';
  }

  try {
    const response = await apiFetch('/api/nutrition/macros', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${state.token}`,
      },
      body: JSON.stringify(payload),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result) {
      throw new Error(result?.message || 'Unable to save macro targets.');
    }

    if (macroTargetFeedback) {
      macroTargetFeedback.textContent = result.message || 'Macro targets updated.';
    }
    state.nutrition.goals = result.goals || state.nutrition.goals;
    syncMacroTargetFields(state.nutrition.goals);
    renderNutritionGoals(state.nutrition.goals, state.nutrition.dailyTotals);
    await loadNutrition(state.viewing?.id ?? state.user?.id);
    await loadMetrics(state.viewing?.id ?? state.user?.id);
  } catch (error) {
    if (macroTargetFeedback) {
      macroTargetFeedback.textContent = error.message || 'Unable to save macro targets.';
    }
  }
});

nutritionInsightSelect?.addEventListener('change', () => renderNutritionInsights(state.nutrition));
weightForm?.addEventListener('submit', handleWeightSubmit);
weightHeightEditToggle?.addEventListener('click', () => {
  setWeightHeightEditing(!weightHeightEditing);
});
weightHeightCancelButton?.addEventListener('click', () => {
  setWeightHeightEditing(false);
});
weightHeightForm?.addEventListener('submit', handleWeightHeightSubmit);
weightLogList?.addEventListener('click', (event) => {
  const target = event.target.closest('[data-weight-delete]');
  if (!target) return;
  const entryId = Number.parseInt(target.dataset.weightId, 10);
  if (!Number.isFinite(entryId) || entryId <= 0) return;
  handleWeightDelete(entryId, target);
});

forgotForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const email = forgotEmailInput?.value.trim();
  if (!email) {
    if (forgotFeedback) forgotFeedback.textContent = 'Enter your email address.';
    return;
  }
  if (forgotFeedback) forgotFeedback.textContent = 'Notifying the head coach...';
  try {
    const response = await apiFetch('/api/password/forgot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload) {
      throw new Error(payload?.message || 'Unable to notify the head coach.');
    }
    forgotFeedback.textContent =
      'If that email exists, the head coach has been notified and will follow up.';
    forgotForm.reset();
  } catch (error) {
    forgotFeedback.textContent = error.message;
  }
});

promoteButton?.addEventListener('click', promoteSelectedUser);
demoteButton?.addEventListener('click', demoteSelectedUser);
resetPasswordButton?.addEventListener('click', resetSelectedUserPassword);
deleteButton?.addEventListener('click', deleteSelectedUser);

profileForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!state.token) return;
  const name = profileNameInput?.value.trim();
  const email = profileEmailInput?.value.trim().toLowerCase();
  const password = profilePasswordInput?.value;
  const currentPassword = profileCurrentPasswordInput?.value || '';
  const weightCategory = profileWeightCategorySelect?.value || '';
  const stravaClientId = profileStravaClientIdInput?.value.trim() || '';
  const stravaClientSecret = profileStravaClientSecretInput?.value.trim() || '';
  const stravaRedirectUri = profileStravaRedirectUriInput?.value.trim() || '';
  const avatarUrlValue = profileAvatarUrlInput?.value?.trim() || '';
  const avatarUrlPayload =
    profileAvatarUrlChanged ? (avatarUrlValue ? avatarUrlValue : null) : undefined;
  const avatarPhotoPayload = profileAvatarPhotoChanged ? profileAvatarPhotoData : undefined;

  profileFeedback.textContent = 'Saving changes...';

  try {
    const response = await apiFetch('/api/profile', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${state.token}`,
      },
      body: JSON.stringify({
        name,
        email,
        password: password || undefined,
        currentPassword,
        weightCategory,
        stravaClientId,
        stravaClientSecret,
        stravaRedirectUri,
        avatar: avatarUrlPayload,
        avatarPhoto: avatarPhotoPayload,
      }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload) {
      throw new Error(payload?.message || 'Unable to update profile.');
    }
    state.token = payload.token;
    state.user = payload.user;
    state.viewing = payload.user;
    state.subject = payload.user;
    persistSession(payload);
    personalizeDashboard(payload.user);
    updateSharePanelVisibility(payload.user);
    updateAdminPanelVisibility(payload.user);
    updateSubjectContext(payload.user);
    prefillProfileForm(payload.user);
    await loadActivity(payload.user.id);
    profileFeedback.textContent = 'Profile updated.';
  } catch (error) {
    profileFeedback.textContent = error.message;
  }
});


promoteButton?.addEventListener('click', promoteSelectedUser);
deleteButton?.addEventListener('click', deleteSelectedUser);
logoutButton?.addEventListener('click', handleLogout);
activityWidgetSaveGoalsButton?.addEventListener('click', saveActivityWidgetGoalsFromInputs);
activityWidgetDistanceGoalInput?.addEventListener('input', updateActivityWidgetGoalDraftState);
activityWidgetDurationGoalInput?.addEventListener('input', updateActivityWidgetGoalDraftState);
activityWidgetDistanceGoalInput?.addEventListener('keydown', handleActivityWidgetGoalInputKeydown);
activityWidgetDurationGoalInput?.addEventListener('keydown', handleActivityWidgetGoalInputKeydown);

async function completeAuthentication(session) {
  if (!session || !session.token || !session.user) {
    throw new Error('Invalid session payload.');
  }

  state.token = session.token;
  state.user = session.user;
  state.viewing = session.user;
  state.subject = session.user;
  state.coaches = [];
  state.coachesLoaded = false;
  updateNutritionFormVisibility();
  persistSession(session);

  personalizeDashboard(session.user);
  updateSharePanelVisibility(session.user);
  updateAdminPanelVisibility(session.user);
  updateSubjectContext(session.user);
  prefillProfileForm(session.user);

  // Show the dashboard before loading data so Chart.js can measure container
  // dimensions correctly. The startup loading screen (z-index 9999) covers the
  // dashboard during the fetch phase, so the user sees no flicker.
  loginPanel.classList.add('hidden');
  dashboard.classList.remove('hidden');

  await fetchRoster();
  await Promise.all([loadMetrics(), loadNutrition(), loadActivity(), loadVitals(), loadWeight()]);
  setWeightDateDefault();

  queueChartResize();
  loginForm?.reset();
  signupForm?.reset();
  if (loginFeedback) loginFeedback.textContent = '';
  if (signupFeedback) signupFeedback.textContent = '';
}

async function handleLogout(event) {
  if (event) {
    event.preventDefault();
  }

  if (!state.token) {
    resetToAuth();
    return;
  }

  try {
    await apiFetch('/api/login/logout', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${state.token}`,
      },
    });
  } catch (error) {
    // no-op: even if the request fails we still clear local state
  } finally {
    resetToAuth('You have been signed out.');
  }
}

loginForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  const email = formData.get('email');
  const password = formData.get('password');

  loginFeedback.textContent = 'Signing you in...';

  try {
    const response = await apiFetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const payload = await response.json().catch(() => null);

    if (!response.ok || !payload) {
      const errorMessage = payload?.message || 'Invalid email or password.';
      throw new Error(errorMessage);
    }

    loginFeedback.textContent = '';
    await completeAuthentication(payload);
  } catch (error) {
    loginFeedback.textContent = resolveRequestErrorMessage(
      error,
      'Unable to sign in right now.'
    );
  }
});

signupForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const name = data.get('name');
  const email = data.get('email');
  const password = data.get('password');
  const avatar = data.get('avatar');

  if (signupFeedback) {
    signupFeedback.textContent = 'Creating your account...';
  }

  try {
    const response = await apiFetch('/api/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password, avatar }),
    });
    const payload = await response.json().catch(() => null);

    if (!response.ok || !payload) {
      const fallback = payload?.message || 'Unable to create your account right now.';
      throw new Error(fallback);
    }

    if (signupFeedback) {
      signupFeedback.textContent = '';
    }
    await completeAuthentication(payload);
  } catch (error) {
    if (signupFeedback) {
      signupFeedback.textContent = resolveRequestErrorMessage(
        error,
        'Unable to create your account right now.'
      );
    }
  }
});

async function loadMetrics(subjectOverrideId) {
  if (!state.user) return;
  const targetId = subjectOverrideId ?? state.viewing?.id ?? state.user.id;
  const query =
    targetId && targetId !== state.user.id ? `?athleteId=${encodeURIComponent(targetId)}` : '';
  try {
    const response = await apiFetch(`/api/metrics${query}`, {
      headers: {
        Authorization: `Bearer ${state.token}`,
      },
    });

    if (!response.ok) {
      if (response.status === 401) {
        resetToAuth('Session expired. Please log in again.');
      } else if (response.status === 403) {
        handleAthleteSelection('self');
        if (loginFeedback) {
          loginFeedback.textContent = 'Access revoked for that athlete.';
        }
      } else if (response.status === 404) {
        handleAthleteSelection('self');
        if (loginFeedback) {
          loginFeedback.textContent = 'That athlete is no longer available.';
        }
      } else if (loginFeedback) {
        loginFeedback.textContent = 'Unable to fetch metrics.';
      }
      return;
    }

    const metrics = await response.json();
    if (metrics.subject) {
      updateSubjectContext(metrics.subject);
      if (metrics.subject.id !== state.user.id) {
        state.viewing = metrics.subject;
        highlightRanking(metrics.subject.id);
      } else {
        highlightRanking(null);
      }
    } else if (state.viewing) {
      updateSubjectContext(state.viewing);
    }
    state.hydrationEntries = Array.isArray(metrics.hydration) ? metrics.hydration.slice() : [];
    const resolvedGoalSleep =
      metrics.subject?.goal_sleep ??
      state.subject?.goal_sleep ??
      state.viewing?.goal_sleep ??
      state.user?.goal_sleep ??
      null;
    const numericGoalSleep = Number(resolvedGoalSleep);
    const activeSleepGoal = Number.isFinite(numericGoalSleep) ? numericGoalSleep : 8;
    if (sleepGoalInput) {
      sleepGoalInput.value = activeSleepGoal.toFixed(1);
    }
    const resolvedGoalSteps =
      metrics.subject?.goal_steps ??
      state.subject?.goal_steps ??
      state.viewing?.goal_steps ??
      state.user?.goal_steps ??
      null;
    const resolvedGoalCalories =
      metrics.subject?.goal_calories ??
      state.subject?.goal_calories ??
      state.viewing?.goal_calories ??
      state.user?.goal_calories ??
      null;
    const goalStepsValue = Number.isFinite(Number(resolvedGoalSteps))
      ? Number(resolvedGoalSteps)
      : null;
    const goalCaloriesValue = Number.isFinite(Number(resolvedGoalCalories))
      ? Number(resolvedGoalCalories)
      : null;

    state.overview.summary = metrics.summary || null;
    state.overview.timeline = Array.isArray(metrics.timeline) ? metrics.timeline : [];
    state.overview.sleepStages = metrics.sleepStages || null;
    state.overview.goals = {
      steps: goalStepsValue,
      calories: goalCaloriesValue,
      sleep: activeSleepGoal,
    };

    renderSummary(state.overview.summary, {
      goalSteps: goalStepsValue,
      goalCalories: goalCaloriesValue,
      goalSleep: activeSleepGoal,
    });
    renderHydration(state.hydrationEntries);
    renderHeartRate(metrics.heartRateZones);
    renderSleepOverview(metrics.sleepStages);
    renderSleepDetails({
      summary: state.overview.summary,
      timeline: state.overview.timeline,
      sleepStages: state.overview.sleepStages,
      goalSleep: activeSleepGoal,
    });
    renderSessions(state.activity.sessions);
    renderNutritionDetails(metrics.macros, state.hydrationEntries);
    updateCharts(metrics);
  } catch (error) {
    if (loginFeedback) {
      loginFeedback.textContent = resolveRequestErrorMessage(
        error,
        'Unable to fetch metrics right now.'
      );
    }
  }
}

async function loadNutrition(subjectOverrideId, options = {}) {
  if (!state.user || !state.token) return;
  const targetId = subjectOverrideId ?? state.viewing?.id ?? state.user.id;
  const isSelfView = !targetId || targetId === state.user.id;
  const params = new URLSearchParams();
  if (targetId && targetId !== state.user.id) {
    params.set('athleteId', String(targetId));
  }
  let requestedDate = null;
  if (options.date) {
    requestedDate = normalizeIsoDate(options.date);
  } else if (!options.resetDate && state.nutrition?.date) {
    requestedDate = normalizeIsoDate(state.nutrition.date);
  }
  if (requestedDate) {
    params.set('date', requestedDate);
  }
  const query = params.toString() ? `?${params.toString()}` : '';

  try {
    const response = await apiFetch(`/api/nutrition${query}`, {
      headers: {
        Authorization: `Bearer ${state.token}`,
      },
    });

    if (!response.ok) {
      if (response.status === 401) {
        resetToAuth('Session expired. Please log in again.');
      } else if (
        (response.status === 403 || response.status === 404) &&
        targetId !== state.user.id
      ) {
        handleAthleteSelection('self');
        if (isSelfView) {
          setNutritionFeedback(
            response.status === 403
              ? 'Access revoked for that athlete.'
              : 'That athlete is no longer available.'
          );
        }
      } else if (isSelfView) {
        setNutritionFeedback('Unable to load nutrition right now.');
      }
      return;
    }

    const payload = await response.json();
    const fallbackDate =
      normalizeIsoDate(payload.date) || requestedDate || getTodayIsoDate();
    state.nutrition = {
      date: fallbackDate,
      goals: payload.goals || null,
      dailyTotals: payload.dailyTotals || null,
      entries: payload.entries || [],
      monthTrend: payload.monthTrend || [],
    };
    syncNutritionDateControls(fallbackDate);
    state.nutritionDeletingEntries.clear();
    state.nutritionPendingDeletes.forEach((p) => { clearTimeout(p.timeoutId); p.dismissToast?.(); });
    state.nutritionPendingDeletes.clear();
    state.nutritionLogShouldScrollToTop = true;
    renderNutritionDashboard(state.nutrition);
  } catch (error) {
    if (isSelfView) {
      setNutritionFeedback('Unable to load nutrition right now.');
    }
  }
}

async function refreshNutritionLinkedViews() {
  const subjectId = state.user?.id;
  if (!subjectId) return;
  await Promise.all([
    loadNutrition(subjectId, { date: getActiveNutritionDate() }),
    loadMetrics(subjectId),
    loadWeight(subjectId),
  ]);
}

async function loadActivity(subjectOverrideId) {
  if (!state.user || !state.token) return;
  const targetId = subjectOverrideId ?? state.viewing?.id ?? state.user.id;
  const isSelfView = !targetId || targetId === state.user.id;
  const query =
    targetId && targetId !== state.user.id ? `?athleteId=${encodeURIComponent(targetId)}` : '';

  try {
    const response = await apiFetch(`/api/activity${query}`, {
      headers: {
        Authorization: `Bearer ${state.token}`,
      },
    });

    if (!response.ok) {
      if (response.status === 401) {
        resetToAuth('Session expired. Please log in again.');
      } else if ((response.status === 403 || response.status === 404) && !isSelfView) {
        handleAthleteSelection('self');
        if (loginFeedback) {
          loginFeedback.textContent =
            response.status === 403
              ? 'Access revoked for that athlete.'
              : 'That athlete is no longer available.';
        }
      } else if (stravaFeedback) {
        stravaFeedback.textContent = 'Unable to load activity data right now.';
      }
      return;
    }

    const payload = await response.json();
    state.activity.summary = payload.summary || null;
    state.activity.sessions = Array.isArray(payload.sessions) ? payload.sessions : [];
    state.activity.splits = payload.splits || {};
    state.activity.bestEfforts = Array.isArray(payload.bestEfforts)
      ? payload.bestEfforts
      : [];
    state.activity.strava = payload.strava || {};
    state.activity.subjectId = payload.subject?.id || targetId;
    const hasSelection = state.activity.sessions.some(
      (session) => session.id === state.activity.selectedSessionId
    );
    if (!hasSelection) {
      state.activity.selectedSessionId = state.activity.sessions[0]?.id || null;
    }
    const charts = payload.charts || {};
    const hasActivityData =
      Boolean(state.activity.summary) ||
      state.activity.sessions.length > 0 ||
      (Array.isArray(charts.mileageTrend) && charts.mileageTrend.length > 0) ||
      (Array.isArray(charts.heartRatePace) && charts.heartRatePace.length > 0);
    renderActivitySummary(state.activity.summary);
    renderActivitySessions(state.activity.sessions);
    renderActivitySelectionDetails();
    renderActivityBestEfforts(state.activity.bestEfforts);
    renderActivityCharts(charts);
    renderStravaPanel(state.activity.strava || {});
    renderSessions(state.activity.sessions);
    if (stravaFeedback && !hasActivityData && isSelfView) {
      stravaFeedback.textContent = '';
    }
  } catch (error) {
    if (stravaFeedback) {
      stravaFeedback.textContent = 'Unable to load activity data right now.';
    }
  }
}

async function loadVitals(subjectOverrideId) {
  if (!state.user || !state.token) return;
  const targetId = subjectOverrideId ?? state.viewing?.id ?? state.user.id;
  const isSelfView = !targetId || targetId === state.user.id;
  const query =
    targetId && targetId !== state.user.id ? `?athleteId=${encodeURIComponent(targetId)}` : '';

  try {
    const response = await apiFetch(`/api/vitals${query}`, {
      headers: {
        Authorization: `Bearer ${state.token}`,
      },
    });

    if (!response.ok) {
      if (response.status === 401) {
        resetToAuth('Session expired. Please log in again.');
      } else if ((response.status === 403 || response.status === 404) && !isSelfView) {
        handleAthleteSelection('self');
        if (loginFeedback) {
          loginFeedback.textContent =
            response.status === 403
              ? 'Access revoked for that athlete.'
              : 'That athlete is no longer available.';
        }
      } else if (vitalsFeedback) {
        vitalsFeedback.textContent = 'Unable to load vitals right now.';
      }
      return;
    }

    const payload = await response.json();
    state.vitals.latest = payload.latest || null;
    state.vitals.timeline = Array.isArray(payload.timeline) ? payload.timeline : [];
    state.vitals.stats = payload.stats || null;
    renderVitalsDashboard(state.vitals);
    if (vitalsFeedback) {
      vitalsFeedback.textContent = '';
    }
    loadPpgResults();
    loadPpgStatus();
  } catch (error) {
    if (vitalsFeedback) {
      vitalsFeedback.textContent = 'Unable to load vitals right now.';
    }
  }
}

async function loadWeight(subjectOverrideId) {
  if (!state.user || !state.token) return;
  const targetId = subjectOverrideId ?? state.viewing?.id ?? state.user.id;
  const isSelfView = !targetId || targetId === state.user.id;
  const query =
    targetId && targetId !== state.user.id ? `?athleteId=${encodeURIComponent(targetId)}` : '';

  try {
    const response = await apiFetch(`/api/weight${query}`, {
      headers: {
        Authorization: `Bearer ${state.token}`,
      },
    });

    if (!response.ok) {
      if (response.status === 401) {
        resetToAuth('Session expired. Please log in again.');
      } else if ((response.status === 403 || response.status === 404) && !isSelfView) {
        handleAthleteSelection('self');
        if (loginFeedback) {
          loginFeedback.textContent =
            response.status === 403
              ? 'Access revoked for that athlete.'
              : 'That athlete is no longer available.';
        }
      } else if (weightFeedback && isSelfView) {
        weightFeedback.textContent = 'Unable to load weight data right now.';
      }
      return;
    }

    const payload = await response.json();
    state.weight.timeline = Array.isArray(payload.timeline) ? payload.timeline : [];
    state.weight.recent = Array.isArray(payload.recent) ? payload.recent : [];
    state.weight.latest = payload.latest || null;
    state.weight.stats = payload.stats || null;
    const goalCalories = Number(payload.subject?.goal_calories);
    state.weight.goalCalories = Number.isFinite(goalCalories) ? goalCalories : null;
    renderWeightDashboard(state.weight);
    if (isSelfView && weightFeedback) {
      weightFeedback.textContent = '';
    }
  } catch (error) {
    if (weightFeedback && isSelfView) {
      weightFeedback.textContent = 'Unable to load weight data right now.';
    }
  }
}

function handleActivitySessionClick(event) {
  const target = event.target.closest('[data-session-id]');
  if (!target) return;
  const sessionId = Number(target.dataset.sessionId);
  if (!sessionId || sessionId === state.activity.selectedSessionId) {
    return;
  }
  state.activity.selectedSessionId = sessionId;
  renderSessions(state.activity.sessions);
  renderActivitySessions(state.activity.sessions);
  renderActivitySelectionDetails();
}

function handleActivitySessionKeydown(event) {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  const target = event.target.closest('[data-session-id]');
  if (!target) return;
  event.preventDefault();
  handleActivitySessionClick(event);
}

async function handleStravaConnect(event) {
  if (event) event.preventDefault();
  if (!state.token) return;
  if (stravaFeedback) {
    stravaFeedback.textContent = 'Opening Strava...';
  }
  try {
    const response = await apiFetch('/api/activity/strava/connect', {
      method: 'POST',
      headers: { Authorization: `Bearer ${state.token}` },
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.url) {
      throw new Error(payload?.message || 'Unable to start Strava link.');
    }
    const popup = window.open(payload.url, 'stravaConnect', 'width=520,height=720');
    if (!popup) {
      throw new Error('Please allow pop-ups to continue connecting Strava.');
    }
    popup.focus();
    if (stravaFeedback) {
      stravaFeedback.textContent = 'Authorize Strava in the new window to finish linking.';
    }
  } catch (error) {
    if (stravaFeedback) {
      stravaFeedback.textContent = error.message;
    }
  }
}

async function handleStravaSync(event) {
  if (event) event.preventDefault();
  if (!state.token) return;
  if (stravaFeedback) {
    stravaFeedback.textContent = 'Syncing Strava...';
  }
  try {
    const response = await apiFetch('/api/activity/strava/sync', {
      method: 'POST',
      headers: { Authorization: `Bearer ${state.token}` },
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(payload?.message || 'Unable to sync Strava right now.');
    }
    if (stravaFeedback) {
      const pageLabel =
        Number.isFinite(payload?.pages) && payload.pages > 1
          ? ` across ${payload.pages} pages`
          : '';
      const skippedLabel =
        Number.isFinite(payload?.skipped) && payload.skipped > 0
          ? ` (${payload.skipped} skipped)`
          : '';
      stravaFeedback.textContent = `Imported ${payload.imported} of ${payload.fetched} activities${pageLabel}${skippedLabel}.`;
    }
    await loadActivity(state.activity.subjectId || state.viewing?.id || state.user?.id);
  } catch (error) {
    if (stravaFeedback) {
      stravaFeedback.textContent = error.message;
    }
  }
}

async function handleStravaExportSelectedSession(event) {
  if (event) event.preventDefault();
  if (!state.token) return;

  const session = getSelectedActivitySession();
  if (!session) {
    if (stravaFeedback) {
      stravaFeedback.textContent = 'Select a session before exporting.';
    }
    renderStravaExportButton();
    return;
  }
  if (
    Number.isFinite(Number(session.stravaActivityId)) &&
    Number(session.stravaActivityId) > 0
  ) {
    if (stravaFeedback) {
      stravaFeedback.textContent = 'This session is already linked to Strava.';
    }
    renderStravaExportButton();
    return;
  }
  if (!canExportSessionToStrava(session)) {
    if (stravaFeedback) {
      stravaFeedback.textContent =
        'Connect Strava with activity write access before exporting sessions.';
    }
    renderStravaExportButton();
    return;
  }

  if (stravaFeedback) {
    stravaFeedback.textContent = `Exporting "${session.name || 'session'}" to Strava...`;
  }
  if (stravaExportButton) {
    stravaExportButton.disabled = true;
    stravaExportButton.textContent = 'Exporting...';
  }

  try {
    const response = await apiFetch('/api/activity/strava/export', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${state.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sessionId: session.id }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(payload?.message || 'Unable to export session to Strava.');
    }
    if (stravaFeedback) {
      stravaFeedback.textContent =
        payload?.message || `Exported "${session.name || 'session'}" to Strava.`;
    }
    await loadActivity(state.activity.subjectId || state.viewing?.id || state.user?.id);
  } catch (error) {
    if (stravaFeedback) {
      stravaFeedback.textContent = error.message;
    }
  } finally {
    renderStravaExportButton();
  }
}

async function handleStravaDisconnect(event) {
  if (event) event.preventDefault();
  if (!state.token) return;
  if (stravaFeedback) {
    stravaFeedback.textContent = 'Disconnecting Strava...';
  }
  try {
    const response = await apiFetch('/api/activity/strava/disconnect', {
      method: 'POST',
      headers: { Authorization: `Bearer ${state.token}` },
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(payload?.message || 'Unable to disconnect Strava right now.');
    }
    if (stravaFeedback) {
      stravaFeedback.textContent = 'Strava disconnected.';
    }
    await loadActivity(state.activity.subjectId || state.viewing?.id || state.user?.id);
  } catch (error) {
    if (stravaFeedback) {
      stravaFeedback.textContent = error.message;
    }
  }
}

function handleStravaMessage(event) {
  if (!window.location) return;
  if (event.origin !== window.location.origin) {
    return;
  }
  if (event.data?.type === 'strava:connected') {
    if (stravaFeedback) {
      stravaFeedback.textContent = 'Strava linked. Syncing latest runs...';
    }
    loadActivity(state.activity.subjectId || state.viewing?.id || state.user?.id);
  }
}

async function handleWeightSubmit(event) {
  if (event) {
    event.preventDefault();
  }
  if (!state.token || !weightValueInput || !weightDateInput) return;
  if (!viewingOwnProfile()) return;

  const weightValue = Number(weightValueInput.value);
  if (!Number.isFinite(weightValue) || weightValue <= 0) {
    if (weightFeedback) {
      weightFeedback.textContent = 'Enter your current weight.';
    }
    return;
  }
  const unit = weightUnitSelect?.value || 'lb';
  const dateValue = weightDateInput.value || new Date().toISOString().slice(0, 10);
  if (weightFeedback) {
    weightFeedback.textContent = 'Saving entry...';
  }

  try {
    const response = await apiFetch('/api/weight', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${state.token}`,
      },
      body: JSON.stringify({ weight: weightValue, unit, date: dateValue }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload) {
      throw new Error(payload?.message || 'Unable to save weight entry.');
    }
    if (weightFeedback) {
      weightFeedback.textContent = 'Saved.';
    }
    await loadWeight(state.user.id);
    if (weightValueInput) {
      weightValueInput.select();
    }
  } catch (error) {
    if (weightFeedback) {
      weightFeedback.textContent = error.message;
    }
  }
}

async function handleWeightDelete(entryId, trigger) {
  if (!state.token || !viewingOwnProfile()) return;
  const confirmed =
    typeof window === 'undefined'
      ? true
      : window.confirm('Delete this weight entry? This cannot be undone.');
  if (!confirmed) return;

  if (trigger) {
    trigger.disabled = true;
  }
  if (weightFeedback) {
    weightFeedback.textContent = 'Removing entry...';
  }

  try {
    const response = await apiFetch(`/api/weight/${entryId}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${state.token}`,
      },
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload) {
      throw new Error(payload?.message || 'Unable to delete entry.');
    }
    if (weightFeedback) {
      weightFeedback.textContent = payload.message || 'Entry deleted.';
    }
    await loadWeight(state.user.id);
  } catch (error) {
    if (weightFeedback) {
      weightFeedback.textContent = error.message;
    }
  } finally {
    if (trigger) {
      trigger.disabled = false;
    }
  }
}

function personalizeDashboard(user) {
  const displayName = (user.name || '').trim() || 'there';
  greeting.textContent = `Hello ${displayName}`;

  profileCard.innerHTML = '';

  const avatarShell = document.createElement('div');
  avatarShell.className = 'avatar-shell';
  const initials =
    (user.name || '')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join('') || 'A';
  const createAvatarFallback = () => {
    const fallback = document.createElement('div');
    fallback.className = 'avatar avatar-fallback';
    fallback.setAttribute('aria-hidden', 'true');
    fallback.textContent = initials;
    return fallback;
  };
  const avatarSrc = resolveAvatarSrc(user);
  if (avatarSrc) {
    const avatar = document.createElement('img');
    avatar.className = 'avatar';
    avatar.alt = user.name;
    avatar.src = avatarSrc;
    avatarShell.appendChild(avatar);
    avatar.onerror = () => {
      avatarShell.replaceChildren(createAvatarFallback());
    };
  } else {
    avatarShell.appendChild(createAvatarFallback());
  }

  const info = document.createElement('div');
  const roleParts = [user.role, user.weight_category].filter(Boolean);
  const labelText = roleParts.length ? roleParts.join(' • ') : 'Athlete';
  info.innerHTML = `
    <p class="label">${labelText}</p>
    <h3>${user.name}</h3>
  `;

  profileCard.appendChild(avatarShell);
  profileCard.appendChild(info);
}

function renderSummary(summary, options = {}) {
  const timeline = Array.isArray(state.overview?.timeline) ? state.overview.timeline : [];
  const syncCopyEl = overviewSyncCopy;
  const syncReadinessEl = overviewSyncReadiness;
  const syncReadinessNoteEl = overviewSyncReadinessNote;
  const syncStepsEl = overviewSyncSteps;
  const syncStepsNoteEl = overviewSyncStepsNote;
  const syncCaloriesEl = overviewSyncCalories;
  const syncCaloriesNoteEl = overviewSyncCaloriesNote;
  const syncSleepEl = overviewSyncSleep;
  const syncSleepNoteEl = overviewSyncSleepNote;
  const momentumTitleEl = document.getElementById('overviewMomentumTitle');
  const momentumCopyEl = document.getElementById('overviewMomentumCopy');
  const momentumFootEl = document.getElementById('overviewMomentumFoot');
  const focusTitleEl = document.getElementById('overviewFocusTitle');
  const focusCopyEl = document.getElementById('overviewFocusCopy');
  const goalSteps = Number.isFinite(options.goalSteps) ? options.goalSteps : null;
  const goalCalories = Number.isFinite(options.goalCalories) ? options.goalCalories : null;
  const goalSleep = Number.isFinite(options.goalSleep) ? options.goalSleep : null;

  const setText = (el, text) => {
    if (el) {
      el.textContent = text;
    }
  };

  if (!summary) {
    updateOverviewGoalList(null);
    renderOverviewCoverage(timeline);

    setText(
      syncCopyEl,
      'Sync your wearable or log nutrition + sleep to unlock personalized coaching.'
    );
    setText(syncReadinessEl, '—');
    setText(syncReadinessNoteEl, 'Awaiting readiness data.');
    setText(syncStepsEl, '—');
    setText(
      syncStepsNoteEl,
      goalSteps ? 'No steps logged yet.' : 'Set a steps goal to unlock pacing tips.'
    );
    setText(syncCaloriesEl, '—');
    setText(
      syncCaloriesNoteEl,
      goalCalories ? 'No calories logged yet.' : 'Set a calorie goal to track fuel gaps.'
    );
    setText(syncSleepEl, '—');
    setText(
      syncSleepNoteEl,
      goalSleep ? 'No sleep logged yet.' : 'Set a sleep target to coach recovery rhythm.'
    );

    if (momentumTitleEl) {
      momentumTitleEl.textContent = 'Waiting for your next sync';
    }
    if (momentumCopyEl) {
      momentumCopyEl.textContent =
        'Once your day syncs we translate readiness, steps, and sleep into a single focus signal.';
    }
    if (momentumFootEl) {
      momentumFootEl.textContent =
        'Tip: Link Strava or keep the wearable app open so new sessions land faster.';
    }
    if (focusTitleEl) {
      focusTitleEl.textContent = 'Sync to plan';
    }
    if (focusCopyEl) {
      focusCopyEl.textContent = 'Log sleep, steps, and fuel to surface the biggest opportunity.';
    }
    return;
  }

  const stepsValue = Number.isFinite(summary.steps) ? summary.steps : null;
  const readiness = Number.isFinite(summary.readiness) ? summary.readiness : null;
  const sleepValue = Number.isFinite(summary.sleepHours) ? summary.sleepHours : null;
  const nutritionTotals = state.nutrition?.dailyTotals || null;
  const nutritionGoalCaloriesRaw = Number(state.nutrition?.goals?.calories);
  const nutritionGoalCalories = Number.isFinite(nutritionGoalCaloriesRaw)
    ? nutritionGoalCaloriesRaw
    : null;
  const caloriesGoalValue = Number.isFinite(nutritionGoalCalories)
    ? nutritionGoalCalories
    : goalCalories;
  const activeCaloriesGoal = Number.isFinite(caloriesGoalValue) ? caloriesGoalValue : null;
  const nutritionCaloriesRaw = Number(nutritionTotals?.calories);
  const caloriesValue = Number.isFinite(nutritionCaloriesRaw)
    ? nutritionCaloriesRaw
    : Number.isFinite(summary.calories)
      ? summary.calories
      : null;
  const activeCaloriesValue = Number.isFinite(caloriesValue) ? caloriesValue : null;

  const stepsDiff =
    Number.isFinite(goalSteps) && Number.isFinite(stepsValue) ? stepsValue - goalSteps : null;
  const sleepDiff =
    Number.isFinite(goalSleep) && Number.isFinite(sleepValue) ? sleepValue - goalSleep : null;
  const caloriesDiff =
    Number.isFinite(activeCaloriesGoal) && Number.isFinite(activeCaloriesValue)
      ? activeCaloriesValue - activeCaloriesGoal
      : null;

  const stepsTrendText =
    stepsDiff === null
      ? 'Log steps to compare vs. goal.'
      : stepsDiff >= 0
        ? `Ahead of ${formatNumber(goalSteps)} goal`
        : `${formatNumber(Math.abs(stepsDiff))} steps below target`;
  const caloriesTrendText =
    caloriesDiff === null
      ? 'Log meals to compare vs. goal.'
      : Math.abs(caloriesDiff) <= activeCaloriesGoal * 0.05
        ? 'Fuel on target.'
        : caloriesDiff > 0
          ? `${formatNumber(caloriesDiff)} kcal above target`
          : `${formatNumber(Math.abs(caloriesDiff))} kcal under target`;
  const sleepTrendText =
    sleepDiff === null
      ? 'Log sleep to compare vs. goal.'
      : sleepDiff >= 0
        ? `${sleepDiff.toFixed(1)} hrs above target`
        : `${Math.abs(sleepDiff).toFixed(1)} hrs below target`;
  const readinessTrendText =
    readiness !== null
      ? readiness >= 85
        ? 'Recovery trending up.'
        : readiness >= 70
          ? 'Holding steady.'
          : 'Recovery dip detected.'
      : 'Awaiting readiness data.';

  updateOverviewGoalList({
    steps: { value: stepsValue, goal: goalSteps, diff: stepsDiff },
    calories: { value: activeCaloriesValue, goal: activeCaloriesGoal, diff: caloriesDiff },
    sleep: { value: sleepValue, goal: goalSleep, diff: sleepDiff },
  });

  const syncSegments = [];
  if (readiness !== null) {
    syncSegments.push(`Readiness ${readiness}%`);
  }
  if (Number.isFinite(stepsValue)) {
    syncSegments.push(`${formatNumber(stepsValue)} steps`);
  }
  if (Number.isFinite(activeCaloriesValue)) {
    syncSegments.push(`${formatNumber(activeCaloriesValue)} kcal`);
  }
  if (Number.isFinite(sleepValue)) {
    syncSegments.push(`${sleepValue.toFixed(1)} hrs sleep`);
  }

  const syncHint = (() => {
    if (Number.isFinite(goalSteps) && Number.isFinite(stepsValue) && stepsValue < goalSteps) {
      return `${formatNumber(goalSteps - stepsValue)} steps remaining today.`;
    }
    if (
      Number.isFinite(activeCaloriesGoal) &&
      Number.isFinite(activeCaloriesValue) &&
      activeCaloriesValue < activeCaloriesGoal
    ) {
      return `${formatNumber(activeCaloriesGoal - activeCaloriesValue)} kcal left to fuel.`;
    }
    if (Number.isFinite(goalSleep) && Number.isFinite(sleepValue) && sleepValue < goalSleep) {
      return `${Math.max(goalSleep - sleepValue, 0).toFixed(1)} hrs to bedtime goal.`;
    }
    if (readiness !== null) {
      return readiness >= 85
        ? 'Green day — layer in intensity.'
        : readiness >= 70
          ? 'Hold steady and protect fueling.'
          : 'Recovery flag — prioritize sleep + hydration.';
    }
    return 'Sync steps, macros, and sleep to build trends.';
  })();

  if (syncCopyEl) {
    syncCopyEl.textContent =
      syncHint || syncSegments.join(' • ') || 'Daily metrics update in real time as data syncs.';
  }
  setText(syncReadinessEl, readiness !== null ? `${readiness}%` : '—');
  setText(syncReadinessNoteEl, readinessTrendText);
  setText(
    syncStepsEl,
    Number.isFinite(stepsValue) ? `${formatNumber(stepsValue)} steps` : '—'
  );
  setText(syncStepsNoteEl, stepsTrendText);
  setText(
    syncCaloriesEl,
    Number.isFinite(activeCaloriesValue) ? `${formatNumber(activeCaloriesValue)} kcal` : '—'
  );
  setText(syncCaloriesNoteEl, caloriesTrendText);
  setText(
    syncSleepEl,
    Number.isFinite(sleepValue) ? `${sleepValue.toFixed(1)} hrs` : '—'
  );
  setText(syncSleepNoteEl, sleepTrendText);

  if (momentumTitleEl || momentumCopyEl || momentumFootEl) {
    let momentumTitle = 'Daily pulse';
    let momentumCopy =
      'Keep blending steps, sleep, and fueling — we’ll highlight trends as they land.';
    let momentumFoot = 'Share a short sync note once new data arrives.';
    if (readiness !== null) {
      if (readiness >= 85) {
        momentumTitle = 'Peak day signal';
        momentumCopy =
          'Systems aligned for intensity. Warm thoroughly, then attack the main set with intent.';
        momentumFoot = "Log how the effort felt so tomorrow's load can be dialed in.";
      } else if (readiness >= 70) {
        momentumTitle = 'Maintain + refine';
        momentumCopy =
          'You’re balanced. Keep macros tight and sprinkle mobility so fatigue stays low.';
        momentumFoot = 'Plan a steady aerobic block, then review hydration trend.';
      } else {
        momentumTitle = 'Recovery priority';
        momentumCopy =
          'Readiness dip detected. Dial down intensity, elevate sleep hygiene, and monitor HRV.';
        momentumFoot = 'Share how you’re trending so coaches can adjust tomorrow’s load.';
      }
    }
    if (momentumTitleEl) momentumTitleEl.textContent = momentumTitle;
    if (momentumCopyEl) momentumCopyEl.textContent = momentumCopy;
    if (momentumFootEl) momentumFootEl.textContent = momentumFoot;
  }

  if (focusTitleEl || focusCopyEl) {
    const sleepGoalLabel = Number.isFinite(goalSleep)
      ? Number.isInteger(goalSleep)
        ? goalSleep
        : Number(goalSleep).toFixed(1)
      : null;
    const deficits = [];
    if (Number.isFinite(goalSteps) && Number.isFinite(stepsValue)) {
      deficits.push({ type: 'steps', delta: goalSteps - stepsValue });
    }
    if (Number.isFinite(activeCaloriesGoal) && Number.isFinite(activeCaloriesValue)) {
      deficits.push({ type: 'calories', delta: activeCaloriesGoal - activeCaloriesValue });
    }
    if (Number.isFinite(goalSleep) && Number.isFinite(sleepValue)) {
      deficits.push({ type: 'sleep', delta: goalSleep - sleepValue });
    }
    const primaryGap = deficits
      .filter((item) => Number.isFinite(item.delta) && item.delta > 0)
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0];

    let focusTitle = 'Keep momentum';
    let focusCopy =
      'All systems trending well. Stay consistent with hydration and micro mobility work.';

    if (primaryGap) {
      if (primaryGap.type === 'steps') {
        focusTitle = 'Movement boost';
        focusCopy = `${formatNumber(primaryGap.delta)} steps remain to hit ${formatNumber(
          goalSteps
        )}. Add a walk, easy ride, or light circuit tonight.`;
      } else if (primaryGap.type === 'calories') {
        focusTitle = 'Fuel gap';
        focusCopy = `${formatNumber(primaryGap.delta)} kcal under target. Prioritize carbs + lean protein in the next meal.`;
      } else if (primaryGap.type === 'sleep') {
        focusTitle = 'Recovery window';
        focusCopy = `${Math.abs(primaryGap.delta).toFixed(
          1
        )} hrs shy of the ${sleepGoalLabel ?? goalSleep} hr goal. Guard bedtime and wind down early.`;
      }
    } else if (readiness !== null && readiness < 70) {
      focusTitle = 'Reset rhythm';
      focusCopy =
        'Let today be restorative: low intensity movement, consistent meals, and early lights out.';
    } else if (readiness !== null && readiness >= 85) {
      focusTitle = 'Press advantage';
      focusCopy = 'Capitalize on the green light with a key session and then log how it felt.';
    }

    if (focusTitleEl) focusTitleEl.textContent = focusTitle;
    if (focusCopyEl) focusCopyEl.textContent = focusCopy;
  }

  renderOverviewCoverage(timeline);
}
function goalDisplayValue(metricKey, value, goal) {
  if (!Number.isFinite(value)) {
    return '—';
  }
  if (metricKey === 'sleep') {
    const formattedValue = `${formatDecimal(value, 1)} hrs`;
    if (Number.isFinite(goal)) {
      return `${formattedValue} / ${formatDecimal(goal, 1)} hrs`;
    }
    return formattedValue;
  }
  const rounded = metricKey === 'calories' ? Math.round(value) : Math.round(value);
  const suffix = metricKey === 'steps' ? ' steps' : metricKey === 'calories' ? ' kcal' : '';
  const formattedValue = `${formatNumber(rounded)}${suffix}`;
  if (Number.isFinite(goal)) {
    const goalRounded = metricKey === 'calories' ? Math.round(goal) : Math.round(goal);
    const goalSuffix = suffix;
    return `${formattedValue} / ${formatNumber(goalRounded)}${goalSuffix}`;
  }
  return formattedValue;
}

function goalTargetLabel(metricKey, goal) {
  if (!Number.isFinite(goal)) return '';
  if (metricKey === 'sleep') {
    return `Goal ${formatDecimal(goal, 1)} hrs`;
  }
  return `Goal ${formatNumber(Math.round(goal))}${metricKey === 'steps' ? ' steps' : ' kcal'}`;
}

function describeGoalStatus(metricKey, { value, goal, diff }) {
  if (!Number.isFinite(goal)) {
    return 'Set a goal to track progress.';
  }
  if (!Number.isFinite(value)) {
    return 'Awaiting data.';
  }
  if (!Number.isFinite(diff)) {
    return 'Log data to compare vs target.';
  }
  if (metricKey === 'steps') {
    if (diff >= 0) {
      return `Ahead by ${formatNumber(Math.round(diff))} steps.`;
    }
    return `${formatNumber(Math.abs(Math.round(diff)))} steps to go.`;
  }
  if (metricKey === 'calories') {
    if (diff > 0) {
      return `${formatNumber(Math.round(diff))} kcal above target.`;
    }
    if (diff === 0) {
      return 'Right on target.';
    }
    return `${formatNumber(Math.abs(Math.round(diff)))} kcal remaining to hit target.`;
  }
  if (metricKey === 'sleep') {
    if (diff > 0) {
      return `${formatDecimal(diff, 1)} hrs above goal.`;
    }
    if (diff === 0) {
      return 'Exactly on your goal.';
    }
    return `${formatDecimal(Math.abs(diff), 1)} hrs to catch up.`;
  }
  return '';
}

function updateOverviewGoalList(goalDetails) {
  const list = document.getElementById('overviewGoalList');
  if (!list) return;
  if (!goalDetails) {
    list.innerHTML =
      '<li class="goal-progress-item"><p class="muted small-text">Sync metrics to compare against your goals.</p></li>';
    return;
  }

  const metrics = [
    { key: 'steps', label: 'Steps' },
    { key: 'calories', label: 'Calories' },
    { key: 'sleep', label: 'Sleep' },
  ];

  const items = metrics
    .map((metric) => {
      const detail = goalDetails[metric.key];
      if (!detail) {
        return '';
      }
      const value = Number(detail.value);
      const goal = Number(detail.goal);
      const diff = Number(detail.diff);
      const status = describeGoalStatus(metric.key, { value, goal, diff });
      const hasGoal = Number.isFinite(goal) && goal > 0;
      const hasValue = Number.isFinite(value);
      const percent = hasGoal && hasValue ? Math.round((value / goal) * 100) : null;
      const width = Number.isFinite(percent) ? Math.max(0, Math.min(percent, 100)) : null;
      return `
        <li class="goal-progress-item">
          <div class="goal-progress-header">
            <div>
              <p class="label">${metric.label}</p>
              <p class="muted small-text">${status}</p>
            </div>
            <div class="goal-progress-value">
              <strong>${goalDisplayValue(metric.key, value, goal)}</strong>
              ${hasGoal ? `<span>${goalTargetLabel(metric.key, goal)}</span>` : ''}
            </div>
          </div>
          ${
            width !== null
              ? `<div class="goal-progress-bar"><span style="width:${width}%"></span></div>`
              : ''
          }
        </li>
      `;
    })
    .filter(Boolean);

  list.innerHTML =
    items.length > 0
      ? items.join('')
      : '<li class="goal-progress-item"><p class="muted small-text">Add goals to start tracking pacing.</p></li>';
}

function renderOverviewCoverage(timeline = []) {
  const copyEl = document.getElementById('overviewCoverageCopy');
  const gridEl = document.getElementById('overviewCoverageGrid');
  if (!copyEl || !gridEl) return;

  if (!Array.isArray(timeline) || !timeline.length) {
    copyEl.textContent = 'Sync your wearable + meals to reveal how many days reported data.';
    gridEl.innerHTML = '<p class="muted small-text">No history yet.</p>';
    return;
  }

  const recent = timeline.slice(-7);
  const totalDays = recent.length || 0;
  const coverage = [
    {
      label: 'Steps logged',
      covered: recent.filter((entry) => Number(entry.steps) > 0).length,
    },
    {
      label: 'Calories logged',
      covered: recent.filter((entry) => Number(entry.calories) > 0).length,
    },
    {
      label: 'Sleep tracked',
      covered: recent.filter((entry) => Number(entry.sleepHours) > 0).length,
    },
  ].map((metric) => ({
    ...metric,
    percent: totalDays ? Math.round((metric.covered / totalDays) * 100) : 0,
  }));

  gridEl.innerHTML = coverage
    .map(
      (row) => `
        <div class="coverage-row">
          <div>
            <p class="label">${row.label}</p>
            <p class="muted small-text">${row.covered}/${totalDays} days</p>
          </div>
          <div class="coverage-bar"><span style="width:${row.percent}%"></span></div>
          <span class="coverage-value">${row.percent}%</span>
        </div>
      `
    )
    .join('');

  const best = coverage.reduce(
    (acc, item) => (item.percent > acc.percent ? item : acc),
    coverage[0]
  );
  const lowest = coverage.reduce(
    (acc, item) => (item.percent < acc.percent ? item : acc),
    coverage[0]
  );

  if (!totalDays) {
    copyEl.textContent = 'Sync your wearable + meals to reveal how many days reported data.';
  } else if (best && lowest) {
    copyEl.textContent = `${totalDays}-day window: ${best.label} strongest (${best.percent}%), ${lowest.label} needs attention (${lowest.percent}%).`;
  } else {
    copyEl.textContent = `${totalDays}-day window tracked.`;
  }
}

function rerenderOverviewFromState() {
  renderSummary(state.overview.summary, {
    goalSteps: state.overview.goals.steps,
    goalCalories: state.overview.goals.calories,
    goalSleep: state.overview.goals.sleep,
  });
  renderSleepDetails({
    summary: state.overview.summary,
    timeline: state.overview.timeline,
    sleepStages: state.overview.sleepStages,
    goalSleep: state.overview.goals.sleep,
  });
}

function renderHydration(entries = state.hydrationEntries) {
  const list = document.getElementById('hydrationList');
  if (!list) return;
  list.innerHTML = '';
  if (!entries.length) {
    renderListPlaceholder(list, 'No hydration logs yet.');
    enforceScrollableList(list);
    return;
  }
  entries.forEach((item) => {
    const li = document.createElement('li');
    li.innerHTML = `<span>${formatDate(item.date)}</span><span>${item.ounces} oz</span>`;
    list.appendChild(li);
  });
  enforceScrollableList(list);
}

function renderHeartRate(zones = []) {
  const list = document.getElementById('heartRateList');
  if (!list) return;
  list.innerHTML = '';
  if (!zones.length) {
    renderListPlaceholder(list, 'No heart rate data yet.');
    enforceScrollableList(list);
    return;
  }
  zones.forEach((zone) => {
    const li = document.createElement('li');
    li.innerHTML = `<span>${zone.zone}</span><span>${zone.minutes} min</span>`;
    list.appendChild(li);
  });
  enforceScrollableList(list);
}

function describeVitalsDelta(delta, unit = '') {
  if (!Number.isFinite(delta) || delta === 0) return '';
  const direction = delta > 0 ? 'higher' : 'lower';
  return `${Math.abs(delta)}${unit ? ` ${unit}` : ''} ${direction} vs previous reading.`;
}

function pickVitalsNumber(primary, secondary) {
  const primaryValue = Number(primary);
  if (Number.isFinite(primaryValue)) {
    return primaryValue;
  }
  const secondaryValue = Number(secondary);
  if (Number.isFinite(secondaryValue)) {
    return secondaryValue;
  }
  return null;
}

function formatBloodPressure(entry) {
  if (!entry) return '— mmHg';
  const systolic = Number(entry.systolic);
  const diastolic = Number(entry.diastolic);
  if (Number.isFinite(systolic) && Number.isFinite(diastolic)) {
    return `${systolic}/${diastolic} mmHg`;
  }
  if (Number.isFinite(systolic) || Number.isFinite(diastolic)) {
    return `${Number.isFinite(systolic) ? systolic : diastolic} mmHg`;
  }
  return '— mmHg';
}

function sortVitalsTimeline(timeline = []) {
  return timeline
    .slice()
    .sort((a, b) => {
      const aTime = new Date(a?.date || 0).getTime();
      const bTime = new Date(b?.date || 0).getTime();
      const safeATime = Number.isFinite(aTime) ? aTime : 0;
      const safeBTime = Number.isFinite(bTime) ? bTime : 0;
      return safeATime - safeBTime;
    });
}

function renderVitalsDashboard(vitals = state.vitals) {
  const latest = vitals?.latest || null;
  const stats = vitals?.stats || null;
  const timeline = Array.isArray(vitals?.timeline) ? vitals.timeline : [];
  const windowLabel = stats?.window ? `last ${stats.window} days` : 'latest sync';

  if (vitalsRestingHrValue) {
    const value = Number(latest?.restingHr);
    vitalsRestingHrValue.textContent = Number.isFinite(value) ? `${value} bpm` : '—';
  }
  if (vitalsRestingHrNote) {
    const deltaCopy = describeVitalsDelta(stats?.restingHrDelta, 'bpm');
    if (deltaCopy) {
      vitalsRestingHrNote.textContent = deltaCopy;
    } else if (Number.isFinite(stats?.restingHrAvg)) {
      vitalsRestingHrNote.textContent = `Avg ${Math.round(stats.restingHrAvg)} bpm (${windowLabel}).`;
    } else {
      vitalsRestingHrNote.textContent = 'Awaiting more heart rate readings.';
    }
  }
  if (vitalsHrvValue) {
    const value = pickVitalsNumber(latest?.hrvScore, stats?.hrvAvg);
    vitalsHrvValue.textContent = Number.isFinite(value) ? `${Math.round(value)} ms` : '—';
  }
  if (vitalsSpo2Value) {
    const value = pickVitalsNumber(latest?.spo2, stats?.spo2Avg);
    vitalsSpo2Value.textContent = Number.isFinite(value) ? `${Math.round(value)}%` : '—';
  }
  if (vitalsStressValue) {
    const value = pickVitalsNumber(latest?.stressScore, stats?.stressAvg);
    vitalsStressValue.textContent = Number.isFinite(value) ? `${Math.round(value)}` : '—';
  }
  if (vitalsBloodPressureValue) {
    vitalsBloodPressureValue.textContent = formatBloodPressure(latest);
  }
  if (vitalsBloodPressureNote) {
    if (Number.isFinite(stats?.systolicAvg) && Number.isFinite(stats?.diastolicAvg)) {
      vitalsBloodPressureNote.textContent = `Avg ${Math.round(stats.systolicAvg)}/${Math.round(
        stats.diastolicAvg
      )} mmHg (${windowLabel}).`;
    } else {
      vitalsBloodPressureNote.textContent = 'Add a cuff reading to populate blood pressure insights.';
    }
  }
  if (vitalsGlucoseValue) {
    const value = Number(latest?.glucose);
    vitalsGlucoseValue.textContent = Number.isFinite(value) ? `${value} mg/dL` : '—';
  }
  if (vitalsGlucoseNote) {
    const deltaCopy = describeVitalsDelta(stats?.glucoseDelta, 'mg/dL');
    if (deltaCopy) {
      vitalsGlucoseNote.textContent = deltaCopy;
    } else if (Number.isFinite(stats?.glucoseAvg)) {
      vitalsGlucoseNote.textContent = `Avg ${Math.round(stats.glucoseAvg)} mg/dL (${windowLabel}).`;
    } else {
      vitalsGlucoseNote.textContent = 'Sync a glucose reading to view trends.';
    }
  }

  renderVitalsHistory(timeline);
  renderVitalsHrvChart(timeline);
  renderVitalsRestingHrChart(timeline);
  renderVitalsGlucoseChart(timeline);
}

function renderVitalsHrvChart(timeline = []) {
  const canvasId = 'vitalsHrvChart';
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const chronological = sortVitalsTimeline(timeline).filter((entry) =>
    Number.isFinite(Number(entry?.hrvScore))
  );
  if (!chronological.length) {
    state.charts.vitalsHrv?.destroy();
    state.charts.vitalsHrv = null;
    showChartMessage(canvasId, 'Sync HRV readings to reveal recovery trend.');
    return;
  }
  const { canvas: activeCanvas } = hideChartMessage(canvasId) || {};
  const ctx = (activeCanvas || canvas).getContext('2d');
  state.charts.vitalsHrv?.destroy();
  state.charts.vitalsHrv = createChart(ctx, {
    type: 'line',
    data: {
      labels: chronological.map((entry) => formatDate(entry.date)),
      datasets: [
        {
          label: 'HRV (ms)',
          data: chronological.map((entry) => Number(entry.hrvScore)),
          borderColor: '#43d9c9',
          backgroundColor: 'rgba(67, 217, 201, 0.12)',
          borderWidth: 2,
          tension: 0.35,
          fill: true,
          pointRadius: 3,
          pointBackgroundColor: '#43d9c9',
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { intersect: false, mode: 'index' },
      plugins: {
        legend: { display: false },
        smartViewport: getSmartViewportOptions({ maxVisiblePoints: 14 }),
      },
      scales: {
        x: {
          ticks: { color: '#9bb0d6' },
          grid: { color: 'rgba(255,255,255,0.05)' },
        },
        y: {
          ticks: {
            color: '#9bb0d6',
            callback(value) {
              return `${value} ms`;
            },
          },
          grid: { color: 'rgba(255,255,255,0.05)' },
        },
      },
    },
  });
}

function renderVitalsRestingHrChart(timeline = []) {
  const canvasId = 'vitalsHrChart';
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const chronological = sortVitalsTimeline(timeline).filter((entry) =>
    Number.isFinite(Number(entry?.restingHr))
  );
  if (!chronological.length) {
    state.charts.vitalsRestingHr?.destroy();
    state.charts.vitalsRestingHr = null;
    showChartMessage(canvasId, 'Sync heart rate readings to see resting HR trend.');
    return;
  }
  const { canvas: activeCanvas } = hideChartMessage(canvasId) || {};
  const ctx = (activeCanvas || canvas).getContext('2d');
  const averageHr =
    chronological.reduce((sum, entry) => sum + Number(entry.restingHr), 0) / chronological.length;
  state.charts.vitalsRestingHr?.destroy();
  state.charts.vitalsRestingHr = createChart(ctx, {
    type: 'line',
    data: {
      labels: chronological.map((entry) => formatDate(entry.date)),
      datasets: [
        {
          label: 'Resting HR',
          data: chronological.map((entry) => Number(entry.restingHr)),
          borderColor: '#f87171',
          backgroundColor: 'rgba(248, 113, 113, 0.14)',
          borderWidth: 2,
          tension: 0.35,
          fill: false,
          pointRadius: 3,
          pointBackgroundColor: '#f87171',
        },
        {
          label: 'Average',
          data: Array(chronological.length).fill(Math.round(averageHr * 10) / 10),
          borderColor: 'rgba(255,255,255,0.35)',
          borderWidth: 1,
          borderDash: [5, 4],
          pointRadius: 0,
          tension: 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { intersect: false, mode: 'index' },
      plugins: {
        legend: { display: false },
        smartViewport: getSmartViewportOptions({ maxVisiblePoints: 14 }),
      },
      scales: {
        x: {
          ticks: { color: '#9bb0d6' },
          grid: { color: 'rgba(255,255,255,0.05)' },
        },
        y: {
          ticks: {
            color: '#9bb0d6',
            callback(value) {
              return `${value} bpm`;
            },
          },
          grid: { color: 'rgba(255,255,255,0.05)' },
        },
      },
    },
  });
}

function renderVitalsGlucoseChart(timeline = []) {
  const canvasId = 'vitalsGlucoseChart';
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const chronological = sortVitalsTimeline(timeline).filter((entry) =>
    Number.isFinite(Number(entry?.glucose))
  );
  if (!chronological.length) {
    state.charts.vitalsGlucose?.destroy();
    state.charts.vitalsGlucose = null;
    showChartMessage(canvasId, 'Sync glucose readings to reveal blood sugar trend.');
    return;
  }
  const { canvas: activeCanvas } = hideChartMessage(canvasId) || {};
  const ctx = (activeCanvas || canvas).getContext('2d');
  state.charts.vitalsGlucose?.destroy();
  state.charts.vitalsGlucose = createChart(ctx, {
    type: 'line',
    data: {
      labels: chronological.map((entry) => formatDate(entry.date)),
      datasets: [
        {
          label: 'Glucose',
          data: chronological.map((entry) => Number(entry.glucose)),
          borderColor: '#a78bfa',
          backgroundColor: 'rgba(167, 139, 250, 0.14)',
          borderWidth: 2,
          tension: 0.35,
          fill: false,
          pointRadius: 3,
          pointBackgroundColor: '#a78bfa',
        },
        {
          label: 'Reference',
          data: Array(chronological.length).fill(100),
          borderColor: 'rgba(255,255,255,0.35)',
          borderWidth: 1,
          borderDash: [5, 4],
          pointRadius: 0,
          tension: 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { intersect: false, mode: 'index' },
      plugins: {
        legend: { display: false },
        smartViewport: getSmartViewportOptions({ maxVisiblePoints: 14 }),
      },
      scales: {
        x: {
          ticks: { color: '#9bb0d6' },
          grid: { color: 'rgba(255,255,255,0.05)' },
        },
        y: {
          ticks: {
            color: '#9bb0d6',
            callback(value) {
              return `${value} mg/dL`;
            },
          },
          grid: { color: 'rgba(255,255,255,0.05)' },
        },
      },
    },
  });
}

function renderVitalsHistory(timeline = []) {
  if (!vitalsHistoryList) return;
  const chronological = sortVitalsTimeline(timeline);
  vitalsHistoryList.innerHTML = '';
  if (!chronological.length) {
    renderListPlaceholder(vitalsHistoryList, 'Vitals history will appear after your first sync.');
    enforceScrollableList(vitalsHistoryList);
    return;
  }
  const ordered = chronological.slice().reverse();
  ordered.forEach((entry) => {
    const li = document.createElement('li');
    const dateLabel = formatDate(entry.date);
    const hrText = Number.isFinite(entry.restingHr) ? `${entry.restingHr} bpm` : '— bpm';
    const glucoseText = Number.isFinite(entry.glucose) ? `${entry.glucose} mg/dL` : '— mg/dL';
    const hrvText = Number.isFinite(entry.hrvScore) ? `${entry.hrvScore} ms HRV` : 'HRV —';
    const spo2Text = Number.isFinite(entry.spo2) ? `${entry.spo2}% SpO₂` : 'SpO₂ —';
    li.innerHTML = `
      <div>
        <p class="label">${dateLabel}</p>
        <p class="muted small-text">${hrText} • ${formatBloodPressure(entry)} • ${glucoseText}</p>
    </div>
    <div class="vitals-history-meta">
      <span>${hrvText}</span>
      <span>${spo2Text}</span>
    </div>
    `;
    vitalsHistoryList.appendChild(li);
  });
  enforceScrollableList(vitalsHistoryList);
}

function renderVitalsChart(timeline = []) {
  const canvasId = 'vitalsTrendChart';
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const chronological = sortVitalsTimeline(timeline);
  if (!chronological.length) {
    state.charts.vitalsTrend?.destroy();
    state.charts.vitalsTrend = null;
    showChartMessage(canvasId, 'Vitals history will visualize once readings sync.');
    return;
  }
  hideChartMessage(canvasId);
  const ctx = canvas.getContext('2d');
  const labels = chronological.map((entry) => formatDate(entry.date));
  const restingHr = chronological.map((entry) => entry.restingHr ?? null);
  const glucose = chronological.map((entry) => entry.glucose ?? null);
  const systolic = chronological.map((entry) => entry.systolic ?? null);
  state.charts.vitalsTrend?.destroy();
  state.charts.vitalsTrend = createChart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Resting HR',
          data: restingHr,
          borderColor: '#ff6b6b',
          backgroundColor: 'rgba(255, 107, 107, 0.1)',
          borderWidth: 2,
          tension: 0.35,
          pointRadius: 0,
        },
        {
          label: 'Glucose',
          data: glucose,
          borderColor: '#ffd166',
          backgroundColor: 'rgba(255, 209, 102, 0.14)',
          borderWidth: 2,
          tension: 0.35,
          pointRadius: 0,
        },
        {
          label: 'Systolic BP',
          data: systolic,
          borderColor: '#4dd0e1',
          backgroundColor: 'rgba(77, 208, 225, 0.18)',
          borderWidth: 2,
          tension: 0.35,
          pointRadius: 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      animations: {
        colors: { duration: 0 },
        borderColor: { duration: 0 },
        tension: { duration: 0 },
        x: { duration: 0 },
        y: { duration: 0 },
      },
      transitions: {
        active: { animation: { duration: 0 } },
        resize: { animation: { duration: 0 } },
      },
      interaction: { intersect: false, mode: 'index' },
      plugins: {
        legend: { display: false },
        smartViewport: getSmartViewportOptions({ maxVisiblePoints: 16 }),
        tooltip: {
          callbacks: {
            label(context) {
              const label = context.dataset.label || '';
              const value = Number(context.parsed.y);
              if (!Number.isFinite(value)) return label;
              if (label.includes('Glucose')) return `${label}: ${value} mg/dL`;
              if (label.includes('BP')) return `${label}: ${value} mmHg`;
              return `${label}: ${value} bpm`;
            },
          },
        },
      },
      scales: {
        y: {
          ticks: {
            color: 'rgba(255, 255, 255, 0.7)',
          },
          grid: { color: 'rgba(255, 255, 255, 0.08)' },
        },
        x: {
          ticks: { color: 'rgba(255, 255, 255, 0.5)' },
          grid: { display: false },
        },
      },
    },
  });
}

function renderSleepOverview(sleepStages) {
  const container = document.getElementById('sleepSummary');
  if (!container) return;
  container.innerHTML = '';
  if (!sleepStages) {
    container.innerHTML = '<p class="empty-state">No sleep data yet.</p>';
    return;
  }
  ['deep', 'rem', 'light'].forEach((stage) => {
    const minutes = Number(sleepStages[stage]);
    const formatted = Number.isFinite(minutes) ? `${minutes} min` : '—';
    const row = document.createElement('div');
    row.innerHTML = `<span>${stage.toUpperCase()}</span><span>${formatted}</span>`;
    container.appendChild(row);
  });
}

function renderSleepStageBreakdown(sleepStages) {
  if (!sleepStageBreakdown) return;
  sleepStageBreakdown.innerHTML = '';
  if (!sleepStages) {
    renderListPlaceholder(sleepStageBreakdown, 'No sleep data yet.');
    return;
  }
  const stages = [
    { key: 'deep', label: 'Deep', color: '#43d9c9' },
    { key: 'rem', label: 'REM', color: '#7eaefc' },
    { key: 'light', label: 'Light', color: '#8e8bff' },
  ];
  const totalMinutes = stages.reduce((sum, stage) => {
    const value = Number(sleepStages[stage.key]);
    return Number.isFinite(value) ? sum + value : sum;
  }, 0);
  if (!totalMinutes) {
    renderListPlaceholder(sleepStageBreakdown, 'No sleep data yet.');
    return;
  }
  stages.forEach((stage) => {
    const minutes = Number(sleepStages[stage.key]);
    if (!Number.isFinite(minutes) || minutes <= 0) {
      return;
    }
    const percent = Math.round((minutes / totalMinutes) * 100);
    const item = document.createElement('li');
    item.className = 'sleep-stage-item';
    item.innerHTML = `
      <div class="sleep-stage-header">
        <span class="sleep-stage-swatch" style="background:${stage.color}"></span>
        <span class="label">${stage.label}</span>
        <span class="sleep-stage-pct muted small-text">${percent}%</span>
        <span class="sleep-stage-duration">${formatDurationFromMinutes(minutes)}</span>
      </div>
      <div class="sleep-stage-bar-track">
        <div class="sleep-stage-bar-fill" style="width:${percent}%;background:${stage.color}"></div>
      </div>
    `;
    sleepStageBreakdown.appendChild(item);
  });
  enforceScrollableList(sleepStageBreakdown, { limit: 3 });
}

function describeSleepHint(latestHours, goalSleep, trendAverage) {
  if (Number.isFinite(latestHours) && Number.isFinite(goalSleep)) {
    const delta = Math.round((latestHours - goalSleep) * 10) / 10;
    if (Math.abs(delta) < 0.25) {
      return 'Right on your target last night.';
    }
    return delta > 0
      ? `Exceeded goal by ${formatDecimal(delta, 1)} hrs.`
      : `Fell short by ${formatDecimal(Math.abs(delta), 1)} hrs.`;
  }
  if (Number.isFinite(trendAverage) && Number.isFinite(goalSleep)) {
    const delta = Math.round((trendAverage - goalSleep) * 10) / 10;
    if (Math.abs(delta) < 0.25) {
      return 'Weekly average is matching your goal.';
    }
    return delta > 0
      ? `Averages ${formatDecimal(delta, 1)} hrs above goal.`
      : `Trending ${formatDecimal(Math.abs(delta), 1)} hrs below goal.`;
  }
  if (Number.isFinite(latestHours)) {
    return 'Set a sleep goal to benchmark recovery.';
  }
  return 'Sync wearable data to reveal deep, REM, and light balance.';
}

function renderSleepDetails({ summary, timeline, sleepStages, goalSleep }) {
  const latestHours = Number(summary?.sleepHours);
  const readinessScore = Number(summary?.readiness);
  const trendEntries = Array.isArray(timeline)
    ? timeline.filter((entry) => Number.isFinite(entry.sleepHours))
    : [];
  const recent = trendEntries.slice(-7);
  const trendAverage = recent.length
    ? recent.reduce((sum, entry) => sum + entry.sleepHours, 0) / recent.length
    : null;
  const spanLabel = recent.length
    ? `last ${recent.length} night${recent.length === 1 ? '' : 's'}`
    : '';

  if (sleepHoursPrimary) {
    sleepHoursPrimary.textContent = Number.isFinite(latestHours)
      ? formatDecimal(latestHours, 1)
      : '—';
  }
  if (sleepGoalCopy) {
    sleepGoalCopy.textContent = Number.isFinite(goalSleep)
      ? `Goal: ${formatDecimal(goalSleep, 1)} hrs`
      : 'Set a sleep goal to start tracking.';
  }
  if (sleepTrendCopy) {
    if (Number.isFinite(trendAverage) && recent.length) {
      let text = `Avg ${formatDecimal(trendAverage, 1)} hrs`;
      if (spanLabel) {
        text += ` • ${spanLabel}`;
      }
      if (Number.isFinite(goalSleep)) {
        const delta = Math.round((trendAverage - goalSleep) * 10) / 10;
        if (Math.abs(delta) >= 0.25) {
          text += delta > 0 ? ' • Above goal' : ' • Below goal';
        } else {
          text += ' • On target';
        }
      }
      sleepTrendCopy.textContent = text;
    } else {
      sleepTrendCopy.textContent = 'Awaiting sleep history.';
    }
  }
  if (sleepReadinessCopy) {
    sleepReadinessCopy.textContent = Number.isFinite(readinessScore)
      ? `${Math.round(readinessScore)}%`
      : '—';
  }
  if (sleepHeroHint) {
    sleepHeroHint.textContent = describeSleepHint(latestHours, goalSleep, trendAverage);
  }

  renderSleepStageBreakdown(sleepStages);
  renderSleepTrendChart(trendEntries, goalSleep);
}

function renderSleepTrendChart(timeline = [], goalSleep) {
  const canvasId = 'sleepTrendChart';
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  if (!timeline.length) {
    state.charts.sleepTrend?.destroy();
    state.charts.sleepTrend = null;
    showChartMessage(canvasId, 'No sleep history yet.');
    return;
  }
  const chronological = timeline
    .slice()
    .sort((a, b) => new Date(a?.date || 0).getTime() - new Date(b?.date || 0).getTime())
    .slice(-7);
  const { canvas: activeCanvas } = hideChartMessage(canvasId) || {};
  const ctx = (activeCanvas || canvas).getContext('2d');
  const labels = chronological.map((entry) => formatDate(entry.date));
  const hours = chronological.map((entry) => Math.round(entry.sleepHours * 10) / 10);
  const sleepAxisValues = Number.isFinite(goalSleep) ? [...hours, Number(goalSleep)] : [...hours];
  const sleepAxisMin = Math.max(
    0,
    Math.floor((Math.min(...sleepAxisValues) - 0.2) * 2) / 2
  );
  const sleepAxisMax = Math.ceil((Math.max(...sleepAxisValues) + 0.2) * 2) / 2;
  const datasets = [
    {
      label: 'Sleep hours',
      data: hours,
      borderColor: '#5f6bff',
      backgroundColor: 'rgba(95, 107, 255, 0.2)',
      tension: 0.4,
      fill: true,
      pointRadius: 4,
      pointBackgroundColor: '#5f6bff',
    },
  ];
  if (Number.isFinite(goalSleep)) {
    datasets.push({
      label: 'Goal',
      data: Array(hours.length).fill(Math.round(goalSleep * 10) / 10),
      borderColor: 'rgba(255, 255, 255, 0.35)',
      borderDash: [6, 4],
      pointRadius: 0,
    });
  }

  state.charts.sleepTrend?.destroy();
  state.charts.sleepTrend = createChart(ctx, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: { color: '#dfe6ff' },
        },
        tooltip: {
          callbacks: {
            label(context) {
              const value = Number(context.parsed.y);
              if (!Number.isFinite(value)) return context.dataset.label;
              return `${context.dataset.label}: ${formatDecimal(value, 1)} hrs`;
            },
          },
        },
      },
      scales: {
        x: {
          title: {
            display: true,
            text: 'Night',
            color: '#9bb0d6',
          },
          ticks: {
            color: '#9bb0d6',
            autoSkip: false,
            maxRotation: 0,
            minRotation: 0,
          },
          grid: { color: 'rgba(255, 255, 255, 0.05)' },
        },
        y: {
          min: sleepAxisMin,
          max: sleepAxisMax,
          title: {
            display: true,
            text: 'Hours Slept',
            color: '#9bb0d6',
          },
          ticks: {
            color: '#9bb0d6',
            stepSize: 0.5,
            maxTicksLimit: 6,
            callback(value) {
              return `${formatDecimal(Number(value), 1)}h`;
            },
          },
          grid: { color: 'rgba(255, 255, 255, 0.05)' },
        },
      },
    },
  });
}

function handleSleepGoalInputChange(event) {
  const rawValue = Number.parseFloat(event?.target?.value ?? '');
  const normalized = Number.isFinite(rawValue)
    ? Math.min(Math.max(rawValue, 4), 12)
    : 8;
  if (sleepGoalInput) {
    sleepGoalInput.value = normalized.toFixed(1);
  }
  const targetProfile =
    state.viewing && state.viewing.id !== state.user.id ? state.viewing : state.user;
  if (targetProfile) {
    targetProfile.goal_sleep = normalized;
  }
  state.overview.goals.sleep = normalized;
  rerenderOverviewFromState();
}

function updateCharts(data) {
  renderActivityChart(data.timeline);
  renderMacroChart(data.macros);
  renderOverviewReadinessChart(data.timeline);
  renderOverviewSleepChart(data.timeline);
  renderOverviewTrainingLoadChart(state.activity.sessions);
}

function renderOverviewReadinessChart(timeline = []) {
  const canvasId = 'overviewReadinessChart';
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const sorted = (Array.isArray(timeline) ? timeline : [])
    .slice()
    .sort((a, b) => new Date(a?.date || 0).getTime() - new Date(b?.date || 0).getTime())
    .filter((e) => Number.isFinite(Number(e.readiness)));
  const recent = sorted.slice(-10);
  if (!recent.length) {
    state.charts.overviewReadiness?.destroy();
    state.charts.overviewReadiness = null;
    showChartMessage(canvasId, 'Sync wearable data to see readiness trend.');
    return;
  }
  const { canvas: activeCanvas } = hideChartMessage(canvasId) || {};
  const ctx = (activeCanvas || canvas).getContext('2d');
  state.charts.overviewReadiness?.destroy();
  state.charts.overviewReadiness = createChart(ctx, {
    type: 'line',
    data: {
      labels: recent.map((e) => formatDate(e.date)),
      datasets: [
        {
          label: 'Readiness',
          data: recent.map((e) => Number(e.readiness)),
          borderColor: '#43d9c9',
          backgroundColor: 'rgba(67, 217, 201, 0.12)',
          tension: 0.4,
          fill: true,
          pointRadius: 3,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        smartViewport: getSmartViewportOptions({ maxVisiblePoints: 10 }),
      },
      scales: {
        x: { ticks: { color: '#9bb0d6' }, grid: { color: 'rgba(255,255,255,0.05)' } },
        y: {
          min: 0,
          max: 100,
          ticks: { color: '#9bb0d6' },
          grid: { color: 'rgba(255,255,255,0.05)' },
        },
      },
    },
  });
}

function renderOverviewSleepChart(timeline = []) {
  const canvasId = 'overviewSleepChart';
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const sorted = (Array.isArray(timeline) ? timeline : [])
    .slice()
    .sort((a, b) => new Date(a?.date || 0).getTime() - new Date(b?.date || 0).getTime())
    .filter((e) => Number.isFinite(Number(e.sleepHours)));
  const recent = sorted.slice(-14);
  if (!recent.length) {
    state.charts.overviewSleep?.destroy();
    state.charts.overviewSleep = null;
    showChartMessage(canvasId, 'Sync sleep data to see duration trend.');
    return;
  }
  const { canvas: activeCanvas } = hideChartMessage(canvasId) || {};
  const ctx = (activeCanvas || canvas).getContext('2d');
  state.charts.overviewSleep?.destroy();
  state.charts.overviewSleep = createChart(ctx, {
    type: 'line',
    data: {
      labels: recent.map((e) => formatDate(e.date)),
      datasets: [
        {
          label: 'Sleep (hrs)',
          data: recent.map((e) => Number(e.sleepHours)),
          borderColor: '#7eaefc',
          backgroundColor: 'rgba(126, 174, 252, 0.10)',
          tension: 0.4,
          fill: true,
          pointRadius: 3,
        },
      ],
    },
    options: {
      plugins: {
        legend: { display: false },
        smartViewport: getSmartViewportOptions({ maxVisiblePoints: 14 }),
      },
      scales: {
        x: { ticks: { color: '#9bb0d6' }, grid: { color: 'rgba(255,255,255,0.05)' } },
        y: {
          min: 0,
          ticks: { color: '#9bb0d6' },
          grid: { color: 'rgba(255,255,255,0.05)' },
        },
      },
    },
  });
}

function renderOverviewTrainingLoadChart(sessions = []) {
  const canvasId = 'overviewTrainingLoadChart';
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const withLoad = (Array.isArray(sessions) ? sessions : [])
    .filter((s) => Number.isFinite(Number(s.trainingLoad)) && Number(s.trainingLoad) > 0)
    .slice()
    .sort(
      (a, b) =>
        new Date(a?.startTime || 0).getTime() - new Date(b?.startTime || 0).getTime()
    )
    .slice(-10);
  if (!withLoad.length) {
    state.charts.overviewTrainingLoad?.destroy();
    state.charts.overviewTrainingLoad = null;
    showChartMessage(canvasId, 'Complete sessions to see training load trend.');
    return;
  }
  const { canvas: activeCanvas } = hideChartMessage(canvasId) || {};
  const ctx = (activeCanvas || canvas).getContext('2d');
  state.charts.overviewTrainingLoad?.destroy();
  state.charts.overviewTrainingLoad = createChart(ctx, {
    type: 'line',
    data: {
      labels: withLoad.map((s) => formatDate(s.startTime)),
      datasets: [
        {
          label: 'Training Load',
          data: withLoad.map((s) => Number(s.trainingLoad)),
          borderColor: '#ff9a52',
          backgroundColor: 'rgba(255, 154, 82, 0.10)',
          tension: 0.4,
          fill: true,
          pointRadius: 3,
        },
      ],
    },
    options: {
      plugins: {
        legend: { display: false },
        smartViewport: getSmartViewportOptions({ maxVisiblePoints: 10 }),
      },
      scales: {
        x: { ticks: { color: '#9bb0d6' }, grid: { color: 'rgba(255,255,255,0.05)' } },
        y: {
          min: 0,
          ticks: { color: '#9bb0d6' },
          grid: { color: 'rgba(255,255,255,0.05)' },
        },
      },
    },
  });
}

function renderActivityChart(timeline = []) {
  const canvas = document.getElementById('activityChart');
  if (!canvas) return;
  if (!timeline.length) {
    state.charts.activity?.destroy();
    state.charts.activity = null;
    showChartMessage('activityChart', 'No activity history yet.');
    return;
  }
  const { canvas: activeCanvas } = hideChartMessage('activityChart') || {};
  const ctx = (activeCanvas || canvas).getContext('2d');
  const chronological = timeline
    .slice()
    .sort((a, b) => new Date(a?.date || 0).getTime() - new Date(b?.date || 0).getTime());
  const labels = chronological.map((entry) => formatDate(entry.date));
  const steps = chronological.map((entry) => entry.steps);
  const calories = chronological.map((entry) => entry.calories);

  state.charts.activity?.destroy();
  state.charts.activity = createChart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Steps',
          data: steps,
          borderColor: '#4df5ff',
          backgroundColor: 'rgba(77, 245, 255, 0.15)',
          tension: 0.4,
          fill: true,
        },
        {
          label: 'Calories',
          data: calories,
          borderColor: '#a95dff',
          borderDash: [6, 4],
          tension: 0.4,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: '#dfe6ff' } },
        smartViewport: getSmartViewportOptions({ maxVisiblePoints: 14 }),
      },
      scales: {
        x: { ticks: { color: '#9bb0d6' }, grid: { color: 'rgba(255,255,255,0.05)' } },
        y: { ticks: { color: '#9bb0d6' }, grid: { color: 'rgba(255,255,255,0.05)' } },
      },
    },
  });
}

function renderMacroChart(macros) {
  const canvas = document.getElementById('macroChart');
  if (!canvas) return;
  if (!macros) {
    state.charts.macros?.destroy();
    state.charts.macros = null;
    showChartMessage('macroChart', 'No macro targets yet.');
    return;
  }
  const { canvas: activeCanvas } = hideChartMessage('macroChart') || {};
  const ctx = (activeCanvas || canvas).getContext('2d');
  state.charts.macros?.destroy();
  state.charts.macros = createChart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Protein', 'Carbs', 'Fats'],
      datasets: [
        {
          data: [macros.protein, macros.carbs, macros.fats],
          backgroundColor: ['#27d2fe', '#5f6bff', '#a95dff'],
          borderWidth: 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { color: '#dfe6ff' } },
      },
    },
  });
}

function renderSessions(sessions = []) {
  const list = activityPrimarySessionsList;
  const summary = document.getElementById('sessionsSummary');
  if (!list) return;

  const sourceSessions = Array.isArray(sessions) ? sessions : [];
  list.innerHTML = '';

  if (!sourceSessions.length) {
    const li = document.createElement('li');
    li.className = 'session-item';
    li.innerHTML = '<p class="muted">No sessions logged yet.</p>';
    list.appendChild(li);
    if (activitySessionHint) {
      activitySessionHint.textContent = 'Connect Strava to start streaming your runs.';
    }
    if (summary) {
      summary.textContent = 'Sessions will populate once your tracker syncs workout data.';
    }
    enforceScrollableList(list);
    return;
  }

  const orderedSessions = sourceSessions
    .slice()
    .sort(
      (a, b) =>
        new Date(b?.startTime || 0).getTime() - new Date(a?.startTime || 0).getTime()
    );
  const rollingWindow = orderedSessions.slice(0, 5);
  if (activitySessionHint) {
    activitySessionHint.textContent = 'Click a run to inspect details →';
  }
  const fragment = document.createDocumentFragment();

  const estimateSessionLoad = (entry) => {
    const explicitLoad = Number(entry?.trainingLoad);
    if (Number.isFinite(explicitLoad) && explicitLoad >= 0) {
      return Math.round(explicitLoad);
    }
    const calories = Number(entry?.calories);
    if (Number.isFinite(calories) && calories > 0) {
      return Math.round(calories / 8);
    }
    const seconds = Number(entry?.movingTime) || Number(entry?.elapsedTime);
    const hr = Number(entry?.averageHr);
    if (Number.isFinite(seconds) && seconds > 0 && Number.isFinite(hr) && hr > 0) {
      return Math.round((seconds / 60) * (hr / 100));
    }
    return null;
  };

  orderedSessions.forEach((entry) => {
    const load = estimateSessionLoad(entry);
    const durationSeconds = Number(entry?.movingTime) || Number(entry?.elapsedTime) || null;
    const durationMinutes = Number.isFinite(durationSeconds) ? durationSeconds / 60 : null;
    const effortLabel = Number.isFinite(load)
      ? load >= 70
        ? 'High intensity'
        : load >= 40
        ? 'Aerobic build'
        : 'Recovery session'
      : Number.isFinite(durationMinutes) && durationMinutes >= 60
      ? 'Long endurance'
      : 'Steady effort';
    const li = document.createElement('li');
    const isActive = entry.id === state.activity.selectedSessionId;
    li.className = `session-item${isActive ? ' active' : ''}`;
    li.dataset.sessionId = entry.id;
    li.tabIndex = 0;
    li.setAttribute('role', 'button');
    li.setAttribute('aria-pressed', String(isActive));

    const body = document.createElement('div');
    const title = document.createElement('p');
    title.className = 'session-title';
    title.textContent = `${formatDate(entry.startTime)} · ${entry.sportType || 'Workout'}`;
    const subtitle = document.createElement('p');
    subtitle.className = 'muted';
    subtitle.textContent = `${entry.name || 'Training session'} · ${effortLabel}`;
    body.appendChild(title);
    body.appendChild(subtitle);

    const metrics = document.createElement('div');
    metrics.className = 'session-metrics';
    [
      formatDistance(entry.distance),
      entry.averagePace ? `${formatPace(entry.averagePace)} /km` : '—',
      formatDurationFromMinutes(durationMinutes),
      Number.isFinite(load) ? `${formatNumber(load)} load` : '—',
    ].forEach((value) => {
      const metric = document.createElement('span');
      metric.textContent = value;
      metrics.appendChild(metric);
    });

    li.appendChild(body);
    li.appendChild(metrics);
    fragment.appendChild(li);
  });
  list.appendChild(fragment);

  if (summary) {
    const totalDistanceKm = rollingWindow.reduce(
      (sum, session) => sum + (Number(session?.distance) > 0 ? Number(session.distance) / 1000 : 0),
      0
    );
    const totalDurationMinutes = rollingWindow.reduce((sum, session) => {
      const seconds = Number(session?.movingTime) || Number(session?.elapsedTime);
      return sum + (Number.isFinite(seconds) && seconds > 0 ? seconds / 60 : 0);
    }, 0);
    const loadValues = rollingWindow
      .map((session) => estimateSessionLoad(session))
      .filter((value) => Number.isFinite(value));
    const avgLoad = loadValues.length
      ? Math.round(loadValues.reduce((sum, value) => sum + value, 0) / loadValues.length)
      : null;
    const windowLabel =
      rollingWindow.length >= 5
        ? 'last 5 sessions'
        : `${rollingWindow.length} recent session${rollingWindow.length === 1 ? '' : 's'}`;
    const distanceLabel =
      totalDistanceKm > 0 ? `${formatDecimal(totalDistanceKm, 1)} km` : 'no distance logged';
    const durationLabel =
      totalDurationMinutes > 0 ? formatDurationFromMinutes(totalDurationMinutes) : 'no duration logged';
    const loadLabel = Number.isFinite(avgLoad)
      ? `Average load ${formatNumber(avgLoad)}.`
      : 'Load will appear as pace, HR, and calories sync.';
    summary.textContent = `${windowLabel}: ${distanceLabel} across ${durationLabel}. ${loadLabel}`;
  }
  enforceScrollableList(list);
}

function renderNutritionDetails(macros, hydration = []) {
  const macroBreakdown = document.getElementById('macroBreakdown');

  if (macroBreakdown) {
    macroBreakdown.innerHTML = '';
    if (!macros) {
      macroBreakdown.innerHTML = '<p class="empty-state">Macro targets not set yet.</p>';
    } else {
      const keys = ['protein', 'carbs', 'fats'];
      const total = keys.reduce((sum, key) => sum + (Number(macros[key]) || 0), 0) || 1;
      keys.forEach((key) => {
        const value = Number(macros[key]) || 0;
        const percent = Math.round((value / total) * 100);
        const row = document.createElement('div');
        row.className = 'macro-row';
        row.innerHTML = `
          <span class="label">${key.toUpperCase()}</span>
          <div class="macro-bar"><span style="width:${percent}%;"></span></div>
          <span class="macro-value">${value} g</span>
        `;
        macroBreakdown.appendChild(row);
      });
    }
  }

  // hydration summary card removed per design refresh
}

function renderActivitySummary(summary) {
  if (!activitySummaryGrid) return;
  if (!summary) {
    if (activityWeeklyDistance) activityWeeklyDistance.textContent = '—';
    if (activityWeeklyDuration) activityWeeklyDuration.textContent = '—';
    if (activityAvgPace) activityAvgPace.textContent = '—';
    if (activityLongestRun) activityLongestRun.textContent = '—';
    if (activityLongestRunLabel) activityLongestRunLabel.textContent = 'Longest effort';
    if (activityTrainingLoad) activityTrainingLoad.textContent = '—';
    if (activityVo2max) activityVo2max.textContent = '—';
    renderActivityWidgetPreview(null);
    return;
  }

  if (activityWeeklyDistance) {
    const value = Number(summary.weeklyDistanceKm);
    activityWeeklyDistance.textContent = Number.isFinite(value)
      ? formatDecimal(value, 1)
      : '—';
  }
  if (activityWeeklyDuration) {
    activityWeeklyDuration.textContent = formatDurationFromMinutes(summary.weeklyDurationMin);
  }
  if (activityAvgPace) {
    activityAvgPace.textContent = summary.avgPaceSeconds
      ? `${formatPace(summary.avgPaceSeconds)} /km`
      : '—';
  }
  if (activityLongestRun) {
    activityLongestRun.textContent = Number.isFinite(summary.longestRunKm)
      ? formatDecimal(summary.longestRunKm, 1)
      : '—';
  }
  if (activityLongestRunLabel) {
    activityLongestRunLabel.textContent = summary.longestRunName || 'Longest effort';
  }
  if (activityTrainingLoad) {
    const load = Number(summary.trainingLoad);
    activityTrainingLoad.textContent = Number.isFinite(load) ? formatNumber(load) : '—';
  }
  if (activityVo2max) {
    const vo2 = Number(summary.vo2maxEstimate);
    activityVo2max.textContent = Number.isFinite(vo2) ? formatDecimal(vo2, 1) : '—';
  }
  renderActivityWidgetPreview(summary);
}

function renderActivityWidgetPreview(summary) {
  if (
    !activityWidgetPercent ||
    !activityWidgetStatus ||
    !activityWidgetLoad ||
    !activityWidgetDistance ||
    !activityWidgetDuration
  ) {
    return;
  }

  const goals = normalizeActivityWidgetGoals(state.activity?.widgetGoals || loadActivityWidgetGoals());
  syncActivityWidgetGoalInputs(goals);

  const targetDistanceKm = sanitizeActivityWidgetGoal(
    goals.distanceKm,
    ACTIVITY_WIDGET_DEFAULT_GOALS.distanceKm
  );
  const targetDurationMin = sanitizeActivityWidgetGoal(
    goals.durationMin,
    ACTIVITY_WIDGET_DEFAULT_GOALS.durationMin
  );
  const widgetData = buildActivityWidgetData(summary, state.activity?.sessions || []);
  const distanceValue = widgetData.weeklyDistanceKm;
  const durationValue = widgetData.weeklyDurationMin;
  const distanceProgress = Math.min(100, Math.round((distanceValue / targetDistanceKm) * 100));
  const durationProgress = Math.min(100, Math.round((durationValue / targetDurationMin) * 100));
  const overallPercent = Math.round((distanceProgress + durationProgress) / 2);

  activityWidgetPercent.textContent = `${overallPercent}%`;
  activityWidgetStatus.textContent = describeActivityWidgetStatus({
    hasSummary: Boolean(summary),
    hasSessions: widgetData.sessionCount > 0,
    usesFallbackWindow: widgetData.usesFallbackWindow,
    overallPercent,
    trainingLoad: widgetData.trainingLoad,
  });
  activityWidgetLoad.textContent = describeActivityWidgetLoad(widgetData);
  activityWidgetDistance.textContent =
    `${formatDecimal(distanceValue, 1)} / ${formatDecimal(targetDistanceKm, 1)} km`;
  activityWidgetDuration.textContent =
    `${formatWidgetMinutes(durationValue)} / ${formatWidgetMinutes(targetDurationMin)}`;
  setActivityWidgetProgressBar(activityWidgetDistanceBar, distanceProgress, 'distance goal complete');
  setActivityWidgetProgressBar(activityWidgetDurationBar, durationProgress, 'duration goal complete');
}

function collectActivityWidgetWindowStats(sessions = [], windowEndTs = Date.now()) {
  if (!Array.isArray(sessions) || !sessions.length) {
    return {
      weeklyDistanceKm: 0,
      weeklyDurationMin: 0,
      trainingLoad: 0,
      sessionCount: 0,
      windowEndTs,
    };
  }

  const windowStartTs = windowEndTs - ACTIVITY_WIDGET_WINDOW_MS;
  let weeklyDistance = 0;
  let weeklyDuration = 0;
  let trainingLoad = 0;
  let sessionCount = 0;

  sessions.forEach((session) => {
    const sessionTs = new Date(session?.startTime || 0).getTime();
    if (!Number.isFinite(sessionTs) || sessionTs < windowStartTs || sessionTs > windowEndTs) {
      return;
    }
    sessionCount += 1;
    weeklyDistance += Number(session?.distance) || 0;
    weeklyDuration += Number(session?.movingTime) || Number(session?.elapsedTime) || 0;
    trainingLoad += Number(session?.trainingLoad) || 0;
  });

  return {
    weeklyDistanceKm: Number((weeklyDistance / 1000).toFixed(2)),
    weeklyDurationMin: Math.round(weeklyDuration / 60),
    trainingLoad: Math.round(trainingLoad),
    sessionCount,
    windowEndTs,
  };
}

function resolveActivityWidgetMetric(summaryValue, derivedValue, derivedSessionCount) {
  if (Number.isFinite(summaryValue) && (summaryValue > 0 || !derivedSessionCount)) {
    return summaryValue;
  }
  return Number.isFinite(derivedValue) && derivedValue > 0 ? derivedValue : 0;
}

function buildActivityWidgetData(summary, sessions = []) {
  const normalizedSessions = Array.isArray(sessions)
    ? sessions
        .filter((session) => Number.isFinite(new Date(session?.startTime || 0).getTime()))
        .slice()
        .sort((a, b) => new Date(b?.startTime || 0).getTime() - new Date(a?.startTime || 0).getTime())
    : [];
  const currentWindow = collectActivityWidgetWindowStats(normalizedSessions, Date.now());
  const fallbackWindow =
    !summary && !currentWindow.sessionCount && normalizedSessions.length
      ? collectActivityWidgetWindowStats(
          normalizedSessions,
          new Date(normalizedSessions[0]?.startTime || 0).getTime()
        )
      : null;
  const derivedWindow = currentWindow.sessionCount ? currentWindow : fallbackWindow || currentWindow;
  const summaryDistance = Number(summary?.weeklyDistanceKm);
  const summaryDuration = Number(summary?.weeklyDurationMin);
  const summaryTrainingLoad = Number(summary?.trainingLoad);

  return {
    weeklyDistanceKm: resolveActivityWidgetMetric(
      summaryDistance,
      derivedWindow.weeklyDistanceKm,
      derivedWindow.sessionCount
    ),
    weeklyDurationMin: resolveActivityWidgetMetric(
      summaryDuration,
      derivedWindow.weeklyDurationMin,
      derivedWindow.sessionCount
    ),
    trainingLoad: resolveActivityWidgetMetric(
      summaryTrainingLoad,
      derivedWindow.trainingLoad,
      derivedWindow.sessionCount
    ),
    sessionCount: derivedWindow.sessionCount,
    usesFallbackWindow: Boolean(!summary && !currentWindow.sessionCount && derivedWindow.sessionCount),
  };
}

function describeActivityWidgetStatus({
  hasSummary,
  hasSessions,
  usesFallbackWindow,
  overallPercent,
  trainingLoad,
}) {
  if (!hasSummary && !hasSessions) {
    return 'Awaiting activity data.';
  }
  if (usesFallbackWindow) {
    return 'Showing your most recent synced training block.';
  }
  if (overallPercent >= 100) {
    return 'Goal smashed this week.';
  }
  if (overallPercent >= 70) {
    return 'On track for your weekly target.';
  }
  if (Number.isFinite(trainingLoad) && trainingLoad > 0) {
    return 'Momentum is building. Keep going.';
  }
  return 'No sessions logged this week yet.';
}

function describeActivityWidgetLoad({ trainingLoad, sessionCount, usesFallbackWindow }) {
  const periodLabel = usesFallbackWindow ? 'in your most recent synced week' : 'this week';
  if (Number.isFinite(trainingLoad) && trainingLoad > 0) {
    return `${formatNumber(trainingLoad)} training load points ${periodLabel}`;
  }
  if (Number.isFinite(sessionCount) && sessionCount > 0) {
    return `${formatNumber(sessionCount)} synced session${sessionCount === 1 ? '' : 's'} counted ${periodLabel}`;
  }
  return 'Training load appears once sessions sync.';
}

function formatWidgetMinutes(minutes) {
  if (!Number.isFinite(minutes) || minutes <= 0) return '0m';
  return formatDurationFromMinutes(minutes);
}

function syncActivityWidgetGoalInputs(goals) {
  const normalizedGoals = normalizeActivityWidgetGoals(goals);
  if (activityWidgetDistanceGoalInput && document.activeElement !== activityWidgetDistanceGoalInput) {
    activityWidgetDistanceGoalInput.value = String(normalizedGoals.distanceKm);
  }
  if (activityWidgetDurationGoalInput && document.activeElement !== activityWidgetDurationGoalInput) {
    activityWidgetDurationGoalInput.value = String(normalizedGoals.durationMin);
  }
}

function setActivityWidgetProgressBar(element, percent, description) {
  if (!element) return;
  const safePercent = Math.max(0, Math.min(100, Math.round(percent)));
  element.style.width = `${safePercent}%`;
  element.setAttribute('aria-valuenow', String(safePercent));
  if (description) {
    element.setAttribute('aria-valuetext', `${safePercent}% ${description}`);
  }
}

function setActivityWidgetGoalNote(message = ACTIVITY_WIDGET_GOAL_NOTE_DEFAULT, stateName = 'default') {
  if (!activityWidgetGoalNote) return;
  activityWidgetGoalNote.textContent = message;
  activityWidgetGoalNote.dataset.state = stateName;
}

function setActivityWidgetGoalValidity(isValid) {
  [activityWidgetDistanceGoalInput, activityWidgetDurationGoalInput].forEach((input) => {
    if (!input) return;
    input.setAttribute('aria-invalid', String(!isValid));
  });
}

function readActivityWidgetGoalsFromInputs() {
  const distanceKm = sanitizeActivityWidgetGoal(activityWidgetDistanceGoalInput?.value, NaN);
  const durationMin = sanitizeActivityWidgetGoal(activityWidgetDurationGoalInput?.value, NaN);
  if (!Number.isFinite(distanceKm) || !Number.isFinite(durationMin)) {
    return null;
  }
  return normalizeActivityWidgetGoals({ distanceKm, durationMin });
}

function activityWidgetGoalsMatch(left, right) {
  if (!left || !right) return false;
  return Number(left.distanceKm) === Number(right.distanceKm) &&
    Number(left.durationMin) === Number(right.durationMin);
}

function updateActivityWidgetGoalDraftState() {
  if (!activityWidgetDistanceGoalInput && !activityWidgetDurationGoalInput) {
    return;
  }

  const savedGoals = normalizeActivityWidgetGoals(state.activity?.widgetGoals || loadActivityWidgetGoals());
  const draftGoals = readActivityWidgetGoalsFromInputs();

  if (!draftGoals) {
    setActivityWidgetGoalValidity(false);
    setActivityWidgetGoalNote(ACTIVITY_WIDGET_GOAL_NOTE_INVALID, 'error');
    return;
  }

  setActivityWidgetGoalValidity(true);
  if (activityWidgetGoalsMatch(savedGoals, draftGoals)) {
    setActivityWidgetGoalNote(ACTIVITY_WIDGET_GOAL_NOTE_DEFAULT, 'default');
    return;
  }

  setActivityWidgetGoalNote(ACTIVITY_WIDGET_GOAL_NOTE_PENDING, 'pending');
}

function handleActivityWidgetGoalInputKeydown(event) {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  saveActivityWidgetGoalsFromInputs();
}

function saveActivityWidgetGoalsFromInputs() {
  const goals = readActivityWidgetGoalsFromInputs();
  if (!goals) {
    setActivityWidgetGoalValidity(false);
    setActivityWidgetGoalNote(ACTIVITY_WIDGET_GOAL_NOTE_INVALID, 'error');
    return;
  }

  state.activity.widgetGoals = goals;
  persistActivityWidgetGoals(state.activity.widgetGoals);
  setActivityWidgetGoalValidity(true);
  setActivityWidgetGoalNote(ACTIVITY_WIDGET_GOAL_NOTE_SAVED, 'saved');
  renderActivityWidgetPreview(state.activity.summary);
}

function renderActivitySessions(sessions = []) {
  if (!activitySessionsList) return;
  activitySessionsList.innerHTML = '';
  if (!sessions.length) {
    const empty = document.createElement('li');
    empty.className = 'empty-row';
    empty.textContent = 'No recorded sessions yet.';
    activitySessionsList.appendChild(empty);
    if (activitySessionHint) {
      activitySessionHint.textContent = 'Connect Strava to start streaming your runs.';
    }
    enforceScrollableList(activitySessionsList);
    return;
  }

  const fragment = document.createDocumentFragment();

  sessions.forEach((session) => {
    const averagePace = Number(session.averagePace);
    const averageHr = Number(session.averageHr);
    const li = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.sessionId = session.id;
    button.className = `activity-session${
      session.id === state.activity.selectedSessionId ? ' active' : ''
    }`;

    const header = document.createElement('div');
    const subtitle = document.createElement('p');
    subtitle.className = 'muted small-text';
    subtitle.textContent = `${formatDate(session.startTime)} • ${session.sportType || 'Run'}`;
    const title = document.createElement('h4');
    title.textContent = session.name || 'Training session';
    header.appendChild(subtitle);
    header.appendChild(title);

    const meta = document.createElement('div');
    meta.className = 'activity-session-meta';
    const distance = document.createElement('span');
    distance.textContent = formatDistance(session.distance);
    const pace = document.createElement('span');
    pace.textContent =
      Number.isFinite(averagePace) && averagePace > 0 ? `${formatPace(averagePace)} /km` : '—';
    const hr = document.createElement('span');
    hr.textContent = Number.isFinite(averageHr) && averageHr > 0 ? `${Math.round(averageHr)} bpm` : '—';
    meta.appendChild(distance);
    meta.appendChild(pace);
    meta.appendChild(hr);
    const trainingLoad = Number(session.trainingLoad);
    if (Number.isFinite(trainingLoad)) {
      const load = document.createElement('span');
      load.textContent = `${Math.round(trainingLoad)} load`;
      meta.appendChild(load);
    }

    button.appendChild(header);
    button.appendChild(meta);
    li.appendChild(button);
    fragment.appendChild(li);
  });
  activitySessionsList.appendChild(fragment);
  enforceScrollableList(activitySessionsList);
}

function getSelectedActivitySession() {
  const sessionId = state.activity.selectedSessionId;
  if (!sessionId) return null;
  return state.activity.sessions.find((item) => item.id === sessionId) || null;
}

function renderActivitySelectionDetails() {
  renderActivityFocus();
  renderActivitySplits();
  renderActivitySplitChart();
}

function renderActivityFocus() {
  if (
    !activityFocusTitle ||
    !activityFocusSubtitle ||
    !activityFocusMetrics ||
    !activityFocusInsightTitle ||
    !activityFocusInsightBody ||
    !activityFocusHighlights
  ) {
    return;
  }

  const session = getSelectedActivitySession();
  if (!session) {
    activityFocusTitle.textContent = 'Select a run';
    activityFocusSubtitle.textContent =
      'Choose a run to inspect route shape, pacing behaviour, and training context.';
    activityFocusMetrics.innerHTML = '';
    activityFocusInsightTitle.textContent = 'Ready for analysis';
    activityFocusInsightBody.textContent =
      'Choose a run to see pacing, load, and route context.';
    activityFocusHighlights.innerHTML = '';
    const emptyHighlight = document.createElement('li');
    emptyHighlight.textContent = 'No run selected yet.';
    activityFocusHighlights.appendChild(emptyHighlight);
    renderActivityRoutePreview(null, []);
    renderActivityFocusBadge(activityFocusSourceChip, '', '');
    renderActivityFocusBadge(activityFocusRouteChip, '', '');
    return;
  }

  const splits = getSelectedActivitySessionSplits(session);
  const movingTimeSeconds = Number(session?.movingTime) || Number(session?.elapsedTime);
  const fastestSplit = splits.reduce((best, split) => {
    const pace = getSplitPaceValue(split);
    if (!Number.isFinite(pace) || pace <= 0) return best;
    if (!best || pace < best.pace) {
      return { splitIndex: split.splitIndex, pace };
    }
    return best;
  }, null);

  activityFocusTitle.textContent = session.name || 'Training session';
  activityFocusSubtitle.textContent = [
    formatActivityDateTime(session.startTime),
    session.sportType || 'Run',
    formatSessionSourceBadge(session),
  ]
    .filter(Boolean)
    .join(' • ');

  const focusMetrics = [
    {
      label: 'Distance',
      value: formatDistance(session.distance),
      copy: splits.length ? `${splits.length} split${splits.length === 1 ? '' : 's'} captured` : 'No split data',
    },
    {
      label: 'Moving time',
      value: formatDurationFromSeconds(movingTimeSeconds),
      copy: `Elapsed ${formatDurationFromSeconds(Number(session.elapsedTime))}`,
    },
    {
      label: 'Average pace',
      value: session.averagePace ? `${formatPace(session.averagePace)} /km` : '—',
      copy: fastestSplit
        ? `Fastest split ${fastestSplit.splitIndex}: ${formatPace(fastestSplit.pace)} /km`
        : 'Pace detail will sharpen once split data syncs',
    },
    {
      label: 'Heart rate',
      value: session.averageHr ? `${Math.round(session.averageHr)} bpm` : '—',
      copy: session.maxHr ? `Max ${Math.round(session.maxHr)} bpm` : 'No max heart rate recorded',
    },
    {
      label: 'Elevation',
      value: Number.isFinite(Number(session.elevationGain))
        ? `${Math.round(Number(session.elevationGain))} m`
        : '—',
      copy: Number.isFinite(Number(session.averageCadence))
        ? `${formatDecimal(Number(session.averageCadence), 0)} spm cadence`
        : 'Cadence unavailable',
    },
    {
      label: 'Training load',
      value: Number.isFinite(Number(session.trainingLoad))
        ? formatNumber(Math.round(Number(session.trainingLoad)))
        : '—',
      copy: Number.isFinite(Number(session.perceivedEffort))
        ? `RPE ${Math.round(Number(session.perceivedEffort))}/10`
        : Number.isFinite(Number(session.vo2maxEstimate))
        ? `VO2 ${formatDecimal(Number(session.vo2maxEstimate), 1)}`
        : 'Load context will appear as more data arrives',
    },
  ];

  activityFocusMetrics.innerHTML = '';
  const metricsFragment = document.createDocumentFragment();
  focusMetrics.forEach((metric) => {
    const card = document.createElement('article');
    card.className = 'activity-focus-metric';

    const label = document.createElement('span');
    label.className = 'activity-focus-metric-label';
    label.textContent = metric.label;

    const value = document.createElement('strong');
    value.className = 'activity-focus-metric-value';
    value.textContent = metric.value;

    const copy = document.createElement('span');
    copy.className = 'activity-focus-metric-copy';
    copy.textContent = metric.copy;

    card.appendChild(label);
    card.appendChild(value);
    card.appendChild(copy);
    metricsFragment.appendChild(card);
  });
  activityFocusMetrics.appendChild(metricsFragment);

  const insights = buildActivitySessionInsights(session, splits);
  activityFocusInsightTitle.textContent = insights.title;
  activityFocusInsightBody.textContent = insights.body;
  activityFocusHighlights.innerHTML = '';
  insights.highlights.forEach((item) => {
    const li = document.createElement('li');
    li.textContent = item;
    activityFocusHighlights.appendChild(li);
  });

  renderActivityRoutePreview(session, splits);
  renderActivityFocusBadge(activityFocusSourceChip, formatSessionSourceBadge(session), 'status-chip');
}

function renderActivityFocusBadge(element, text, className) {
  if (!element) return;
  element.className = className || 'status-chip';
  if (!text) {
    element.textContent = '';
    element.classList.add('hidden');
    return;
  }
  element.textContent = text;
  element.classList.remove('hidden');
}

function buildActivitySessionInsights(session, splits = []) {
  const distanceKm = Number(session?.distance) / 1000;
  const movingMinutes = (Number(session?.movingTime) || Number(session?.elapsedTime) || 0) / 60;
  const trainingLoad = Number(session?.trainingLoad);
  const averageHr = Number(session?.averageHr);
  const averagePace = Number(session?.averagePace);
  const summary = state.activity?.summary || null;

  let title = 'Balanced run';
  let body = 'A steady session with enough signal to track pacing, load, and efficiency.';

  if ((Number.isFinite(distanceKm) && distanceKm >= 18) || movingMinutes >= 90) {
    title = 'Long-run builder';
    body = 'A higher-volume endurance session that should meaningfully shape the current training week.';
  } else if (
    (Number.isFinite(trainingLoad) && trainingLoad >= 90) ||
    (Number.isFinite(averagePace) && averagePace > 0 && averagePace <= 285)
  ) {
    title = 'Quality session';
    body = 'A sharper run profile with enough intensity to move fitness, load, and confidence forward.';
  } else if (Number.isFinite(averageHr) && averageHr > 0 && averageHr < 150) {
    title = 'Aerobic support';
    body = 'A lower-stress aerobic session that supports volume, recovery, and consistency.';
  }

  const highlights = [];
  if (splits.length >= 2) {
    const firstHalf = averageSplitPace(splits.slice(0, Math.ceil(splits.length / 2)));
    const secondHalf = averageSplitPace(splits.slice(Math.floor(splits.length / 2)));
    if (Number.isFinite(firstHalf) && Number.isFinite(secondHalf)) {
      const delta = Math.round(Math.abs(firstHalf - secondHalf));
      if (delta >= 3) {
        highlights.push(
          secondHalf < firstHalf
            ? `Closed the second half ${formatPaceDelta(delta)} /km faster than the opening half.`
            : `Pace faded by ${formatPaceDelta(delta)} /km over the second half.`
        );
      }
    }

    const heartRates = splits
      .map((split) => Number(split?.heartRate))
      .filter((value) => Number.isFinite(value) && value > 0);
    if (heartRates.length >= 2) {
      const drift = Math.round(heartRates[heartRates.length - 1] - heartRates[0]);
      if (drift !== 0) {
        highlights.push(
          drift > 0
            ? `Heart rate drifted +${drift} bpm from the first split to the finish.`
            : `Heart rate settled ${Math.abs(drift)} bpm lower by the closing split.`
        );
      }
    }

    const paceValues = splits
      .map((split) => getSplitPaceValue(split))
      .filter((value) => Number.isFinite(value) && value > 0);
    if (paceValues.length >= 2) {
      const paceSpread = Math.round(Math.max(...paceValues) - Math.min(...paceValues));
      if (paceSpread > 0) {
        highlights.push(`Split pace spread stayed within ${formatPaceDelta(paceSpread)} /km.`);
      }
    }
  }

  if (Number.isFinite(Number(session?.elevationGain)) && Number(session.elevationGain) > 0) {
    highlights.push(`Climbing totaled ${Math.round(Number(session.elevationGain))} m across the run.`);
  }

  if (summary && Number.isFinite(Number(summary.weeklyDistanceKm)) && Number(summary.weeklyDistanceKm) > 0) {
    const weeklyShare = (Number(session?.distance) / (Number(summary.weeklyDistanceKm) * 1000)) * 100;
    if (Number.isFinite(weeklyShare) && weeklyShare > 0) {
      highlights.push(`This run accounts for ${Math.round(weeklyShare)}% of the last 7 days of distance.`);
    }
  }

  if (!highlights.length) {
    if (Number.isFinite(trainingLoad) && trainingLoad > 0) {
      highlights.push(`Training load landed at ${Math.round(trainingLoad)} for this session.`);
    } else if (Number.isFinite(distanceKm) && distanceKm > 0) {
      highlights.push(`Session volume landed at ${formatDecimal(distanceKm, 1)} km.`);
    } else {
      highlights.push('More route and split data will sharpen this summary.');
    }
  }

  return {
    title,
    body,
    highlights: highlights.slice(0, 3),
  };
}

function renderActivityRoutePreview(session, splits = []) {
  if (
    !activityRoutePath ||
    !activityRouteShadow ||
    !activityRouteStart ||
    !activityRouteEnd ||
    !activityRouteEmpty
  ) {
    return;
  }

  const routePoints = buildSessionRoutePoints(session);
  const effortTracePoints = routePoints.length >= 2 ? [] : buildEffortTracePoints(splits);
  const previewMode = routePoints.length >= 2 ? 'gps' : effortTracePoints.length >= 2 ? 'trace' : 'none';
  const previewPoints = previewMode === 'gps' ? routePoints : previewMode === 'trace' ? effortTracePoints : [];
  const geometry = buildRouteGeometry(previewPoints);

  if (!session || !geometry) {
    activityRoutePath.setAttribute('d', '');
    activityRouteShadow.setAttribute('d', '');
    activityRouteStart.setAttribute('r', '0');
    activityRouteEnd.setAttribute('r', '0');
    activityRouteEmpty.classList.remove('hidden');
    if (activityRouteLegend) {
      activityRouteLegend.classList.add('hidden');
    }
    renderActivityFocusBadge(activityFocusRouteChip, '', '');
    return;
  }

  activityRoutePath.setAttribute('d', geometry.d);
  activityRouteShadow.setAttribute('d', geometry.d);
  activityRouteStart.setAttribute('cx', geometry.start.x.toFixed(2));
  activityRouteStart.setAttribute('cy', geometry.start.y.toFixed(2));
  activityRouteStart.setAttribute('r', '4.6');
  activityRouteEnd.setAttribute('cx', geometry.end.x.toFixed(2));
  activityRouteEnd.setAttribute('cy', geometry.end.y.toFixed(2));
  activityRouteEnd.setAttribute('r', '5.2');
  activityRouteEmpty.classList.add('hidden');
  if (activityRouteLegend) {
    activityRouteLegend.classList.remove('hidden');
  }

  if (previewMode === 'gps') {
    renderActivityFocusBadge(activityFocusRouteChip, 'GPS route', 'status-chip ok');
  } else {
    renderActivityFocusBadge(activityFocusRouteChip, 'Effort trace', 'status-chip warn');
  }
}

function canExportSessionToStrava(session) {
  if (!session) return false;
  if (Number.isFinite(Number(session.stravaActivityId)) && Number(session.stravaActivityId) > 0) {
    return false;
  }
  const strava = state.activity.strava || {};
  return Boolean(strava.canManage && strava.connected);
}

function renderStravaExportButton() {
  if (!stravaExportButton) return;
  const session = getSelectedActivitySession();
  const strava = state.activity.strava || {};
  const shouldShow = Boolean(session && strava.canManage && strava.connected);
  stravaExportButton.classList.toggle('hidden', !shouldShow);
  if (!shouldShow) {
    stravaExportButton.disabled = true;
    stravaExportButton.textContent = 'Export to Strava';
    return;
  }
  const alreadyLinked =
    Number.isFinite(Number(session?.stravaActivityId)) && Number(session?.stravaActivityId) > 0;
  stravaExportButton.disabled = !canExportSessionToStrava(session);
  stravaExportButton.textContent = alreadyLinked ? 'Already in Strava' : 'Export to Strava';
}

function renderActivitySplits() {
  if (!activitySplitsList) return;
  activitySplitsList.innerHTML = '';
  const session = getSelectedActivitySession();
  if (!session) {
    if (activitySplitTitle) activitySplitTitle.textContent = 'Select a run';
    const empty = document.createElement('li');
    empty.className = 'empty-row';
    empty.textContent = 'Choose a run to view the session details.';
    activitySplitsList.appendChild(empty);
    renderStravaExportButton();
    enforceScrollableList(activitySplitsList);
    return;
  }
  if (activitySplitTitle) activitySplitTitle.textContent = session.name || 'Run details';

  const overview = document.createElement('li');
  overview.className = 'run-detail-card';

  const overviewHeader = document.createElement('div');
  overviewHeader.className = 'run-detail-header';
  const overviewKicker = document.createElement('p');
  overviewKicker.className = 'run-detail-kicker';
  overviewKicker.textContent = `${formatActivityDateTime(session.startTime)} • ${
    session.sportType || 'Run'
  }`;
  const overviewCopy = document.createElement('p');
  overviewCopy.className = 'run-detail-copy';
  overviewCopy.textContent = `Source: ${formatSessionSource(session.source)}`;
  overviewHeader.appendChild(overviewKicker);
  overviewHeader.appendChild(overviewCopy);

  const detailGrid = document.createElement('div');
  detailGrid.className = 'run-detail-grid';
  const detailFields = [
    ['Distance', formatDistance(session.distance)],
    [
      'Moving time',
      formatDurationFromSeconds(Number(session.movingTime) || Number(session.elapsedTime)),
    ],
    ['Elapsed time', formatDurationFromSeconds(Number(session.elapsedTime))],
    ['Average pace', session.averagePace ? `${formatPace(session.averagePace)} /km` : '—'],
    ['Average HR', session.averageHr ? `${Math.round(session.averageHr)} bpm` : '—'],
    ['Max HR', session.maxHr ? `${Math.round(session.maxHr)} bpm` : '—'],
    [
      'Elevation gain',
      Number.isFinite(Number(session.elevationGain))
        ? `${Math.round(Number(session.elevationGain))} m`
        : '—',
    ],
    [
      'Cadence',
      Number.isFinite(Number(session.averageCadence))
        ? `${formatDecimal(Number(session.averageCadence), 0)} spm`
        : '—',
    ],
    [
      'Average power',
      Number.isFinite(Number(session.averagePower))
        ? `${Math.round(Number(session.averagePower))} w`
        : '—',
    ],
    [
      'Calories',
      Number.isFinite(Number(session.calories))
        ? `${formatNumber(Math.round(Number(session.calories)))} kcal`
        : '—',
    ],
    [
      'Training load',
      Number.isFinite(Number(session.trainingLoad))
        ? formatNumber(Math.round(Number(session.trainingLoad)))
        : '—',
    ],
    [
      'VO2 max',
      Number.isFinite(Number(session.vo2maxEstimate))
        ? formatDecimal(Number(session.vo2maxEstimate), 1)
        : '—',
    ],
    [
      'Perceived effort',
      Number.isFinite(Number(session.perceivedEffort))
        ? `${Math.round(Number(session.perceivedEffort))}/10`
        : '—',
    ],
  ];

  detailFields.forEach(([label, value]) => {
    const metric = document.createElement('div');
    metric.className = 'run-detail-metric';
    const metricLabel = document.createElement('span');
    metricLabel.className = 'run-detail-label';
    metricLabel.textContent = label;
    const metricValue = document.createElement('span');
    metricValue.className = 'run-detail-value';
    metricValue.textContent = value;
    metric.appendChild(metricLabel);
    metric.appendChild(metricValue);
    detailGrid.appendChild(metric);
  });

  overview.appendChild(overviewHeader);
  overview.appendChild(detailGrid);
  activitySplitsList.appendChild(overview);

  const splitCard = document.createElement('li');
  splitCard.className = 'run-split-card';
  const splitHeader = document.createElement('div');
  splitHeader.className = 'run-detail-section-header';
  const splitTitle = document.createElement('span');
  splitTitle.className = 'run-detail-section-title';
  splitTitle.textContent = 'Splits';
  const splitCopy = document.createElement('span');
  splitCopy.className = 'run-detail-section-copy';
  const splits = state.activity.splits?.[session.id] || [];
  splitCopy.textContent = splits.length
    ? `${splits.length} recorded segment${splits.length === 1 ? '' : 's'}`
    : 'No split data on this activity';
  splitHeader.appendChild(splitTitle);
  splitHeader.appendChild(splitCopy);
  splitCard.appendChild(splitHeader);

  if (!splits.length) {
    const empty = document.createElement('p');
    empty.className = 'run-split-empty';
    empty.textContent = 'Split-by-split data is not available for this run.';
    splitCard.appendChild(empty);
    activitySplitsList.appendChild(splitCard);
    renderStravaExportButton();
    enforceScrollableList(activitySplitsList);
    return;
  }

  const splitTable = document.createElement('div');
  splitTable.className = 'run-split-table';
  const splitRows = document.createDocumentFragment();
  splits.forEach((split) => {
    const row = document.createElement('div');
    row.className = 'run-split-row';

    const index = document.createElement('span');
    index.className = 'run-split-index';
    index.textContent = `Split ${split.splitIndex}`;

    const distance = document.createElement('span');
    distance.className = 'run-split-distance';
    distance.textContent = formatDistance(split.distance);

    const pace = document.createElement('span');
    pace.className = 'run-split-pace';
    const splitPace = getSplitPaceValue(split);
    pace.textContent =
      Number.isFinite(splitPace) && splitPace > 0 ? `${formatPace(splitPace)} /km` : '—';

    const meta = document.createElement('span');
    meta.className = 'run-split-meta';
    const heartRate = Number(split.heartRate);
    const elevation = Number(split.elevation);
    meta.textContent =
      [
        Number.isFinite(heartRate) && heartRate > 0 ? `${Math.round(heartRate)} bpm` : null,
        Number.isFinite(elevation) ? `${Math.round(elevation)} m` : null,
      ]
        .filter(Boolean)
        .join(' • ') || '—';

    row.appendChild(index);
    row.appendChild(distance);
    row.appendChild(pace);
    row.appendChild(meta);
    splitRows.appendChild(row);
  });
  splitTable.appendChild(splitRows);

  splitCard.appendChild(splitTable);
  activitySplitsList.appendChild(splitCard);
  renderStravaExportButton();
  enforceScrollableList(activitySplitsList);
}

function renderActivityBestEfforts(efforts = []) {
  if (!activityBestEffortsList) return;
  activityBestEffortsList.innerHTML = '';
  if (activityBestEffortsHint) {
    activityBestEffortsHint.textContent = efforts.length
      ? 'Fastest pace and longest-distance efforts from your recent runs.'
      : 'Log more qualifying runs to surface pace and distance markers.';
  }
  if (activityBestEffortsBadge) {
    activityBestEffortsBadge.className = efforts.length ? 'status-chip ok' : 'status-chip';
    activityBestEffortsBadge.textContent = efforts.length ? `${efforts.length} tracked` : 'Waiting';
    activityBestEffortsBadge.classList.remove('hidden');
  }
  if (!efforts.length) {
    const empty = document.createElement('li');
    empty.className = 'empty-row';
    empty.textContent = 'Log more runs to uncover best efforts.';
    activityBestEffortsList.appendChild(empty);
    enforceScrollableList(activityBestEffortsList);
    return;
  }
  efforts.forEach((effort) => {
    const li = document.createElement('li');
    const badge = document.createElement('span');
    badge.className = 'eff-badge';
    badge.dataset.tone = getBestEffortTone(effort.label);
    badge.textContent = getBestEffortBadgeText(effort.label);

    const card = document.createElement('div');
    card.className = 'eff-card';

    const head = document.createElement('div');
    head.className = 'eff-card-head';
    const title = document.createElement('strong');
    title.className = 'eff-name';
    title.textContent = effort.label || 'Best effort';
    const date = document.createElement('span');
    date.className = 'eff-date';
    date.textContent = effort.startTime ? formatDate(effort.startTime) : 'No date';
    head.appendChild(title);
    head.appendChild(date);

    const metrics = document.createElement('div');
    metrics.className = 'eff-card-metrics';
    const value = document.createElement('span');
    value.className = 'eff-value';
    value.textContent = getBestEffortPrimaryValue(effort);
    const pill = document.createElement('span');
    pill.className = 'eff-pill';
    pill.textContent = getBestEffortSecondaryValue(effort);
    metrics.appendChild(value);
    metrics.appendChild(pill);

    card.appendChild(head);
    card.appendChild(metrics);
    li.appendChild(badge);
    li.appendChild(card);
    activityBestEffortsList.appendChild(li);
  });
  enforceScrollableList(activityBestEffortsList);
}

function getBestEffortTone(label = '') {
  const normalized = String(label || '').toLowerCase();
  if (normalized.includes('load')) return 'amber';
  if (normalized.includes('longest')) return 'blue';
  return 'teal';
}

function getBestEffortBadgeText(label = '') {
  const normalized = String(label || '').toLowerCase();
  if (normalized.includes('5k')) return '5K';
  if (normalized.includes('10k')) return '10K';
  if (normalized.includes('load')) return 'LOAD';
  if (normalized.includes('longest')) return 'LONG';
  if (normalized.includes('pace')) return 'PACE';
  return 'PB';
}

function getBestEffortPrimaryValue(effort = {}) {
  const normalized = String(effort?.label || '').toLowerCase();
  if (normalized.includes('fastest') || normalized.includes('pace')) {
    return Number.isFinite(Number(effort?.paceSeconds)) && Number(effort.paceSeconds) > 0
      ? `${formatPace(Number(effort.paceSeconds))} /km`
      : 'Pace unavailable';
  }
  return formatDistance(Number(effort?.distance));
}

function getBestEffortSecondaryValue(effort = {}) {
  const normalized = String(effort?.label || '').toLowerCase();
  const distance = formatDistance(Number(effort?.distance));
  const pace =
    Number.isFinite(Number(effort?.paceSeconds)) && Number(effort.paceSeconds) > 0
      ? `${formatPace(Number(effort.paceSeconds))} /km`
      : null;

  if (normalized.includes('fastest') || normalized.includes('pace')) {
    return distance !== '—' ? `${distance} session` : 'Qualifying run';
  }
  if (normalized.includes('load')) {
    return '7-day peak';
  }
  return pace || 'Endurance marker';
}

function renderActivityCharts(charts = {}) {
  const mileageTrend = charts.mileageTrend || [];
  renderActivityPaceChart(charts.heartRatePace || [], mileageTrend);
  renderActivityLoadChart(state.activity.sessions, mileageTrend);
}

function renderActivitySplitChart() {
  const canvasId = 'activitySplitChart';
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  const session = getSelectedActivitySession();
  const splits = getSelectedActivitySessionSplits(session);
  setChartCardTitle(canvasId, 'Split Breakdown');

  if (!session) {
    state.charts.activitySplit?.destroy();
    state.charts.activitySplit = null;
    showChartMessage(canvasId, 'Select a run to compare split behaviour.');
    return;
  }

  if (!splits.length) {
    state.charts.activitySplit?.destroy();
    state.charts.activitySplit = null;
    showChartMessage(canvasId, 'This run does not have split detail yet.');
    return;
  }

  const { canvas: activeCanvas } = hideChartMessage(canvasId) || {};
  const ctx = (activeCanvas || canvas).getContext('2d');
  const labels = splits.map((split) => `S${split.splitIndex}`);
  const paceSeries = splits.map((split) => getSplitPaceValue(split));
  const heartRateSeries = splits.map((split) => {
    const value = Number(split?.heartRate);
    return Number.isFinite(value) && value > 0 ? Math.round(value) : null;
  });
  const elevationSeries = splits.map((split) => {
    const value = Number(split?.elevation);
    return Number.isFinite(value) ? Math.round(value) : null;
  });
  const hasPaceData = paceSeries.some((value) => Number.isFinite(value) && value > 0);
  const hasHeartRate = heartRateSeries.some((value) => Number.isFinite(value));
  const hasElevation = elevationSeries.some((value) => Number.isFinite(value));

  if (!hasPaceData) {
    state.charts.activitySplit?.destroy();
    state.charts.activitySplit = null;
    showChartMessage(canvasId, 'This run is missing pace data needed for split comparison.');
    return;
  }

  const secondaryDataset = hasHeartRate
    ? {
        type: 'line',
        label: 'Heart rate',
        yAxisID: 'secondary',
        data: heartRateSeries,
        borderColor: '#fb7185',
        backgroundColor: 'rgba(251, 113, 133, 0.16)',
        tension: 0.35,
        pointRadius: 3,
        pointHoverRadius: 4,
      }
    : hasElevation
    ? {
        type: 'line',
        label: 'Elevation',
        yAxisID: 'secondary',
        data: elevationSeries,
        borderColor: '#60a5fa',
        backgroundColor: 'rgba(96, 165, 250, 0.16)',
        tension: 0.35,
        pointRadius: 3,
        pointHoverRadius: 4,
      }
    : null;

  state.charts.activitySplit?.destroy();
  state.charts.activitySplit = createChart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          type: 'bar',
          label: 'Pace',
          yAxisID: 'pace',
          data: paceSeries,
          backgroundColor: 'rgba(45, 212, 191, 0.48)',
          borderColor: '#2dd4bf',
          borderWidth: 1,
          borderRadius: 8,
          maxBarThickness: 32,
        },
        ...(secondaryDataset ? [secondaryDataset] : []),
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        smartViewport: getSmartViewportOptions({ panX: false, maxVisiblePoints: 12 }),
        tooltip: {
          callbacks: {
            label(context) {
              if (context.dataset.yAxisID === 'pace') {
                const pace = Number(context.parsed.y);
                return Number.isFinite(pace) && pace > 0
                  ? `Pace ${formatPace(pace)} /km`
                  : 'Pace unavailable';
              }
              if (secondaryDataset?.label === 'Heart rate') {
                const heartRate = Number(context.parsed.y);
                return Number.isFinite(heartRate) ? `${Math.round(heartRate)} bpm` : 'Heart rate unavailable';
              }
              const elevation = Number(context.parsed.y);
              return Number.isFinite(elevation) ? `${Math.round(elevation)} m` : 'Elevation unavailable';
            },
          },
        },
      },
      scales: {
        x: {
          ticks: { color: '#9bb0d6' },
          grid: { color: 'rgba(255,255,255,0.05)' },
        },
        pace: {
          position: 'left',
          reverse: true,
          ticks: {
            color: '#9bb0d6',
            callback(value) {
              return formatPace(Number(value));
            },
          },
          grid: { color: 'rgba(255,255,255,0.05)' },
        },
        secondary: secondaryDataset
          ? {
              position: 'right',
              ticks: {
                color: '#9bb0d6',
                callback(value) {
                  return secondaryDataset.label === 'Heart rate'
                    ? `${Math.round(Number(value))} bpm`
                    : `${Math.round(Number(value))} m`;
                },
              },
              grid: { drawOnChartArea: false },
            }
          : undefined,
      },
    },
  });
}

function renderActivityLoadChart(sessions = [], mileageTrend = []) {
  const canvasId = 'activityLoadChart';
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const withLoad = (Array.isArray(sessions) ? sessions : [])
    .filter((s) => Number.isFinite(Number(s.trainingLoad)) && Number(s.trainingLoad) > 0)
    .slice()
    .sort(
      (a, b) =>
        new Date(a?.startTime || 0).getTime() - new Date(b?.startTime || 0).getTime()
    );
  if (!withLoad.length) {
    const durationTrend = (Array.isArray(mileageTrend) ? mileageTrend : [])
      .slice()
      .sort(
        (a, b) =>
          new Date(a?.startTime || 0).getTime() - new Date(b?.startTime || 0).getTime()
      )
      .filter((entry) => Number.isFinite(Number(entry?.movingMinutes)) && Number(entry.movingMinutes) > 0);
    if (!durationTrend.length) {
      setChartCardTitle(canvasId, 'Load Trend');
      state.charts.activityLoad?.destroy();
      state.charts.activityLoad = null;
      showChartMessage(canvasId, 'Complete sessions to see training load trend.');
      return;
    }
    setChartCardTitle(canvasId, 'Duration Trend');
    const { canvas: activeCanvas } = hideChartMessage(canvasId) || {};
    const ctx = (activeCanvas || canvas).getContext('2d');
    state.charts.activityLoad?.destroy();
    state.charts.activityLoad = createChart(ctx, {
      type: 'bar',
      data: {
        labels: durationTrend.map((entry) => formatDate(entry.startTime)),
        datasets: [
          {
            label: 'Duration (min)',
            data: durationTrend.map((entry) => Math.round(Number(entry.movingMinutes))),
            backgroundColor: 'rgba(255, 154, 82, 0.45)',
            borderColor: '#ff9a52',
            borderWidth: 1,
            borderRadius: 4,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          smartViewport: getSmartViewportOptions({ maxVisiblePoints: 20 }),
        },
        scales: {
          x: { ticks: { color: '#9bb0d6' }, grid: { color: 'rgba(255,255,255,0.05)' } },
          y: {
            min: 0,
            ticks: {
              color: '#9bb0d6',
              callback(value) {
                return `${value} min`;
              },
            },
            grid: { color: 'rgba(255,255,255,0.05)' },
          },
        },
      },
    });
    return;
  }
  setChartCardTitle(canvasId, 'Load Trend');
  const { canvas: activeCanvas } = hideChartMessage(canvasId) || {};
  const ctx = (activeCanvas || canvas).getContext('2d');
  state.charts.activityLoad?.destroy();
  state.charts.activityLoad = createChart(ctx, {
    type: 'line',
    data: {
      labels: withLoad.map((s) => formatDate(s.startTime)),
      datasets: [
        {
          label: 'Training Load',
          data: withLoad.map((s) => Number(s.trainingLoad)),
          borderColor: '#ff9a52',
          backgroundColor: 'rgba(255, 154, 82, 0.12)',
          tension: 0.4,
          fill: true,
          pointRadius: 3,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        smartViewport: getSmartViewportOptions({ maxVisiblePoints: 20 }),
      },
      scales: {
        x: { ticks: { color: '#9bb0d6' }, grid: { color: 'rgba(255,255,255,0.05)' } },
        y: {
          min: 0,
          ticks: { color: '#9bb0d6' },
          grid: { color: 'rgba(255,255,255,0.05)' },
        },
      },
    },
  });
}

function renderActivityMileageChart(trend = []) {
  const canvas = document.getElementById('activityMileageChart');
  if (!canvas) return;
  if (!trend.length) {
    state.charts.activityMileage?.destroy();
    state.charts.activityMileage = null;
    showChartMessage('activityMileageChart', 'No mileage trend yet.');
    return;
  }
  const { canvas: activeCanvas } = hideChartMessage('activityMileageChart') || {};
  const ctx = (activeCanvas || canvas).getContext('2d');
  const chronological = trend
    .slice()
    .sort((a, b) => new Date(a?.startTime || 0).getTime() - new Date(b?.startTime || 0).getTime());
  const labels = chronological.map((entry) => formatDate(entry.startTime));
  const distances = chronological.map((entry) => Number(entry.distanceKm) || 0);
  const durations = chronological.map((entry) => Number(entry.movingMinutes) || 0);
  state.charts.activityMileage?.destroy();
  state.charts.activityMileage = createChart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Distance (km)',
          data: distances,
          borderColor: '#4df5ff',
          backgroundColor: 'rgba(77, 245, 255, 0.18)',
          tension: 0.35,
          fill: true,
        },
        {
          label: 'Duration (min)',
          data: durations,
          borderColor: '#a95dff',
          borderDash: [6, 4],
          tension: 0.35,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: '#dfe6ff' } },
        smartViewport: getSmartViewportOptions({ maxVisiblePoints: 14 }),
      },
      scales: {
        x: { ticks: { color: '#9bb0d6' }, grid: { color: 'rgba(255,255,255,0.05)' } },
        y: { ticks: { color: '#9bb0d6' }, grid: { color: 'rgba(255,255,255,0.05)' } },
      },
    },
  });
}

function renderActivityPaceChart(points = [], mileageTrend = []) {
  const canvasId = 'activityPaceChart';
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  if (!points.length) {
    const distanceTrend = (Array.isArray(mileageTrend) ? mileageTrend : [])
      .slice()
      .sort(
        (a, b) =>
          new Date(a?.startTime || 0).getTime() - new Date(b?.startTime || 0).getTime()
      )
      .filter((entry) => Number.isFinite(Number(entry?.distanceKm)) && Number(entry.distanceKm) > 0);
    if (!distanceTrend.length) {
      setChartCardTitle(canvasId, 'Pace vs Heart Rate');
      state.charts.activityPace?.destroy();
      state.charts.activityPace = null;
      showChartMessage(canvasId, 'Add a few runs to compare pace vs HR.');
      return;
    }
    setChartCardTitle(canvasId, 'Mileage Trend');
    const { canvas: activeCanvas } = hideChartMessage(canvasId) || {};
    const ctx = (activeCanvas || canvas).getContext('2d');
    state.charts.activityPace?.destroy();
    state.charts.activityPace = createChart(ctx, {
      type: 'line',
      data: {
        labels: distanceTrend.map((entry) => formatDate(entry.startTime)),
        datasets: [
          {
            label: 'Distance (km)',
            data: distanceTrend.map((entry) => Number(entry.distanceKm)),
            borderColor: '#27d2fe',
            backgroundColor: 'rgba(39, 210, 254, 0.18)',
            borderWidth: 2,
            tension: 0.35,
            fill: true,
            pointRadius: 3,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          smartViewport: getSmartViewportOptions({ maxVisiblePoints: 14 }),
        },
        scales: {
          x: { ticks: { color: '#9bb0d6' }, grid: { color: 'rgba(255,255,255,0.05)' } },
          y: {
            min: 0,
            ticks: {
              color: '#9bb0d6',
              callback(value) {
                return `${value} km`;
              },
            },
            grid: { color: 'rgba(255,255,255,0.05)' },
          },
        },
      },
    });
    return;
  }
  setChartCardTitle(canvasId, 'Pace vs Heart Rate');
  const { canvas: activeCanvas } = hideChartMessage(canvasId) || {};
  const ctx = (activeCanvas || canvas).getContext('2d');
  const dataset = points
    .filter((point) => Number.isFinite(point.paceSeconds) && Number.isFinite(point.heartRate))
    .map((point) => ({ x: point.paceSeconds, y: point.heartRate, label: point.label }));
  if (!dataset.length) {
    setChartCardTitle(canvasId, 'Pace vs Heart Rate');
    state.charts.activityPace?.destroy();
    state.charts.activityPace = null;
    showChartMessage(canvasId, 'Add one more run with HR data to plot pace.');
    return;
  }
  state.charts.activityPace?.destroy();
  state.charts.activityPace = createChart(ctx, {
    type: 'scatter',
    data: {
      datasets: [
        {
          label: 'Sessions',
          data: dataset,
          backgroundColor: '#27d2fe',
          borderColor: '#27d2fe',
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        smartViewport: getSmartViewportOptions({ panX: false }),
        tooltip: {
          callbacks: {
            title(items) {
              return items[0]?.raw?.label || 'Session';
            },
            label(item) {
              return `Pace ${formatPace(item.raw.x)} /km • ${Math.round(item.raw.y)} bpm`;
            },
          },
        },
      },
      scales: {
        x: {
          title: { display: true, text: 'Pace (per km)' },
          ticks: {
            color: '#9bb0d6',
            callback: (value) => formatPace(Number(value)),
          },
          grid: { color: 'rgba(255,255,255,0.05)' },
        },
        y: {
          title: { display: true, text: 'Avg heart rate' },
          ticks: { color: '#9bb0d6' },
          grid: { color: 'rgba(255,255,255,0.05)' },
        },
      },
    },
  });
}

function renderStravaPanel(strava = {}) {
  if (!stravaPanelElement || !stravaStatusChip) return;
  const connected = Boolean(strava.connected);
  const enabled = Boolean(strava.enabled);
  const configured = Boolean(strava.configured);
  const requiresSetup = Boolean(strava.requiresSetup);
  const usingServerDefaults = Boolean(strava.usingServerDefaults);
  const isOwner = Boolean(strava.canManage);
  const canManage = Boolean(isOwner && enabled && configured && !requiresSetup);
  const athleteLabel = strava.athleteName ? ` • ${strava.athleteName}` : '';
  stravaStatusChip.textContent = connected
    ? `Connected${athleteLabel}`
    : !enabled
    ? 'Disabled'
    : requiresSetup
    ? 'Setup required'
    : 'Not connected';
  stravaStatusChip.classList.toggle('connected', connected);

  if (stravaSummary) {
    if (!enabled) {
      stravaSummary.textContent = 'Server missing Strava credentials. Add them to enable syncing.';
    } else if (requiresSetup) {
      stravaSummary.textContent = 'Add your Strava client ID, secret, and redirect URL under Profile before linking.';
    } else if (connected && strava.lastSync) {
      stravaSummary.textContent = `Last sync ${new Date(strava.lastSync).toLocaleString()}`;
    } else if (!connected && usingServerDefaults) {
      stravaSummary.textContent = 'Connect Strava using the shared credentials configured by your coach.';
    } else {
      stravaSummary.textContent = 'Connect Strava to automatically import activities and workouts.';
    }
  }

  if (stravaConnectButton) {
    stravaConnectButton.classList.toggle('hidden', !(canManage && !connected));
    stravaConnectButton.disabled = !canManage;
  }
  if (stravaSyncButton) {
    stravaSyncButton.classList.toggle('hidden', !(canManage && connected));
  }
  if (stravaDisconnectButton) {
    stravaDisconnectButton.classList.toggle('hidden', !(canManage && connected));
  }
  renderStravaExportButton();
  if (stravaFeedback) {
    stravaFeedback.textContent = !enabled
      ? 'Ask the server operator to configure STRAVA_CLIENT_ID/SECRET/REDIRECT_URI.'
      : requiresSetup && isOwner
      ? 'Open Profile → Strava connection keys to save your client ID, secret, and redirect URL.'
      : !isOwner && connected
      ? 'Only the account owner can manage Strava connections.'
      : '';
  }
}

if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      queueChartResize();
      // Reload the active page's data so BLE-streamed samples appear
      // immediately when the user returns from the Bluetooth bridge page.
      if (state.token && state.user) {
        const subjectId = state.viewing?.id ?? state.user?.id;
        const page = state.currentPage;
        if (page === 'overview') loadMetrics(subjectId);
        else if (page === 'activity') loadActivity(subjectId);
        else if (page === 'vitals') loadVitals(subjectId);
        else if (page === 'weight') loadWeight(subjectId);
        else if (page === 'nutrition') loadNutrition(subjectId);
      }
    }
  });
}

// ─── PPG Glucose Model ────────────────────────────────────────────────────

const ppgRunDemoBtn = document.getElementById('ppgRunDemo');
const ppgRunFullBtn = document.getElementById('ppgRunFull');
const ppgStatusText = document.getElementById('ppgStatusText');
const ppgResultsDiv = document.getElementById('ppgResults');
const ppgBestRegModel = document.getElementById('ppgBestRegModel');
const ppgBestRegMAE   = document.getElementById('ppgBestRegMAE');
const ppgBestClsModel = document.getElementById('ppgBestClsModel');
const ppgBestClsF1    = document.getElementById('ppgBestClsF1');
const ppgBestMcModel  = document.getElementById('ppgBestMcModel');
const ppgBestMcF1     = document.getElementById('ppgBestMcF1');

let ppgPollTimer = null;
let ppgDatasetStatus = null;

function setPpgButtonsDisabled(disabled, dataset = ppgDatasetStatus) {
  ppgDatasetStatus = dataset ?? ppgDatasetStatus;

  if (ppgRunDemoBtn) {
    ppgRunDemoBtn.disabled = disabled;
    ppgRunDemoBtn.title = disabled ? 'Pipeline running.' : '';
  }

  if (ppgRunFullBtn) {
    const fullRunReady = ppgDatasetStatus?.ready !== false;
    ppgRunFullBtn.disabled = disabled || !fullRunReady;
    if (!fullRunReady) {
      ppgRunFullBtn.title =
        ppgDatasetStatus?.message || 'Full run unavailable until the full dataset is present.';
    } else {
      ppgRunFullBtn.title = disabled ? 'Pipeline running.' : '';
    }
  }
}

function setPpgStatus(text, cls) {
  if (!ppgStatusText) return;
  ppgStatusText.textContent = text;
  ppgStatusText.className = 'ppg-status-text' + (cls ? ` ${cls}` : '');
}

function getPpgDatasetNote(dataset = ppgDatasetStatus) {
  if (!dataset || dataset.ready !== false) return '';
  if (!Number.isFinite(dataset.availableCount) || !Number.isFinite(dataset.expectedCount)) return '';
  return ` Full run unavailable (${dataset.availableCount}/${dataset.expectedCount} PPG files found).`;
}

function stopPpgPoll() {
  if (ppgPollTimer) {
    clearInterval(ppgPollTimer);
    ppgPollTimer = null;
  }
}

function startPpgPoll() {
  stopPpgPoll();
  ppgPollTimer = setInterval(async () => {
    try {
      const res = await apiFetch('/api/ppg/status', { headers: { Authorization: `Bearer ${state.token}` } });
      if (!res.ok) return;
      const data = await res.json();
      if (!data.running) {
        stopPpgPoll();
        setPpgButtonsDisabled(false, data.dataset);
        if (data.latestRun?.status === 'completed') {
          const mode = data.latestRun.is_demo ? 'demo' : 'full';
          const mins = data.latestRun.elapsed_seconds
            ? `${(data.latestRun.elapsed_seconds / 60).toFixed(1)} min`
            : '';
          const completedText = `Last ${mode} run completed${mins ? ` in ${mins}` : ''}.`;
          setPpgStatus(
            `${completedText}${getPpgDatasetNote(data.dataset)}`,
            'ppg-done'
          );
          loadPpgResults();
        } else if (data.inMemory?.status === 'failed' || data.latestRun?.status === 'failed') {
          const message = data.inMemory?.error || data.latestRun?.error_message || 'unknown error';
          setPpgStatus(`Run failed: ${message}`, 'ppg-error');
        }
      }
    } catch { /* ignore poll errors */ }
  }, 5000);
}

async function triggerPpg(isDemo) {
  if (!state.token) return;
  setPpgButtonsDisabled(true);
  setPpgStatus(`Starting ${isDemo ? 'demo' : 'full'} pipeline…`, 'ppg-running');
  try {
    const res = await apiFetch('/api/ppg/run', {
      method: 'POST',
      headers: { Authorization: `Bearer ${state.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ demo: isDemo }),
    });
    if (res.status === 409) {
      setPpgStatus('Pipeline already running…', 'ppg-running');
      startPpgPoll();
      return;
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      setPpgStatus(`Failed to start: ${err.message || res.statusText}`, 'ppg-error');
      setPpgButtonsDisabled(false);
      return;
    }
    const estMins = isDemo ? '5–10' : '15–30';
    setPpgStatus(
      `Pipeline running (${isDemo ? 'demo · 3 subjects' : 'full · 20 subjects'}, ~${estMins} min)…`,
      'ppg-running'
    );
    startPpgPoll();
  } catch (err) {
    setPpgStatus(`Error: ${err.message}`, 'ppg-error');
    setPpgButtonsDisabled(false);
  }
}

function renderPpgModelChart(models) {
  const canvas = document.getElementById('ppgModelChart');
  if (!canvas) return;
  const regModels = models
    .filter((m) => m.task === 'regression' && Number.isFinite(m.mae))
    .sort((a, b) => a.mae - b.mae);
  if (!regModels.length) return;

  state.charts.ppgModel?.destroy();
  const ctx = canvas.getContext('2d');
  state.charts.ppgModel = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: regModels.map((m) => m.model_name),
      datasets: [
        {
          label: 'MAE (mg/dL)',
          data: regModels.map((m) => Math.round(m.mae * 10) / 10),
          backgroundColor: regModels.map((_, i) =>
            i === 0 ? 'rgba(67,217,201,0.75)' : 'rgba(167,139,250,0.5)'
          ),
          borderColor: regModels.map((_, i) =>
            i === 0 ? '#43d9c9' : '#a78bfa'
          ),
          borderWidth: 1,
          borderRadius: 4,
        },
      ],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => ` MAE ${ctx.raw} mg/dL`,
          },
        },
      },
      scales: {
        x: {
          ticks: { color: '#9bb0d6', callback: (v) => `${v} mg/dL` },
          grid: { color: 'rgba(255,255,255,0.05)' },
        },
        y: {
          ticks: { color: '#9bb0d6' },
          grid: { color: 'rgba(255,255,255,0.05)' },
        },
      },
    },
  });
}

async function loadPpgStatus() {
  if (!state.token) return;
  try {
    const res = await apiFetch('/api/ppg/status', { headers: { Authorization: `Bearer ${state.token}` } });
    if (!res.ok) return;
    const data = await res.json();

    if (data.running) {
      const mode = data.inMemory?.isDemo ? 'demo' : 'full';
      setPpgButtonsDisabled(true, data.dataset);
      setPpgStatus(`Pipeline running (${mode} mode)…`, 'ppg-running');
      startPpgPoll();
      return;
    }

    stopPpgPoll();
    setPpgButtonsDisabled(false, data.dataset);

    if (data.inMemory?.status === 'failed' || data.latestRun?.status === 'failed') {
      const message = data.inMemory?.error || data.latestRun?.error_message || 'unknown error';
      setPpgStatus(`Run failed: ${message}`, 'ppg-error');
      return;
    }

    if (data.latestRun?.status === 'completed') {
      const mode = data.latestRun.is_demo ? 'demo' : 'full';
      const mins = data.latestRun.elapsed_seconds
        ? `${(data.latestRun.elapsed_seconds / 60).toFixed(1)} min`
        : '';
      const completedText = `Last ${mode} run completed${mins ? ` in ${mins}` : ''}.`;
      setPpgStatus(
        `${completedText}${getPpgDatasetNote(data.dataset)}`,
        'ppg-done'
      );
      return;
    }

    setPpgStatus(`No run yet. Press a button to start the pipeline.${getPpgDatasetNote(data.dataset)}`);
  } catch { /* ignore */ }
}

async function loadPpgResults() {
  if (!state.token) return;
  try {
    const res = await apiFetch('/api/ppg/results', { headers: { Authorization: `Bearer ${state.token}` } });
    if (!res.ok) return;
    const data = await res.json();
    if (!data.run || !data.models.length) {
      if (ppgResultsDiv) ppgResultsDiv.classList.add('hidden');
      return;
    }

    const reg = data.models.filter((m) => m.task === 'regression').sort((a, b) => a.mae - b.mae);
    const cls = data.models.filter((m) => m.task === 'classification').sort((a, b) => (b.f1_hyper ?? 0) - (a.f1_hyper ?? 0));
    const mc  = data.models.filter((m) => m.task === 'multiclass').sort((a, b) => (b.macro_f1 ?? 0) - (a.macro_f1 ?? 0));

    if (ppgBestRegModel && reg[0]) {
      ppgBestRegModel.textContent = reg[0].model_name;
      if (ppgBestRegMAE) ppgBestRegMAE.textContent = `MAE ${reg[0].mae?.toFixed(1) ?? '—'} mg/dL`;
    }
    if (ppgBestClsModel && cls[0]) {
      ppgBestClsModel.textContent = cls[0].model_name;
      if (ppgBestClsF1) ppgBestClsF1.textContent = `F1 ${cls[0].f1_hyper?.toFixed(3) ?? '—'}`;
    }
    if (ppgBestMcModel && mc[0]) {
      ppgBestMcModel.textContent = mc[0].model_name;
      if (ppgBestMcF1) ppgBestMcF1.textContent = `Macro F1 ${mc[0].macro_f1?.toFixed(3) ?? '—'}`;
    }

    if (ppgResultsDiv) ppgResultsDiv.classList.remove('hidden');
    renderPpgModelChart(data.models);

    if (!ppgStatusText?.textContent || ppgStatusText.textContent.includes('No run yet')) {
      const mode = data.run.is_demo ? 'demo' : 'full';
      const mins = data.run.elapsed_seconds ? `${(data.run.elapsed_seconds / 60).toFixed(1)} min` : '';
      setPpgStatus(`Last ${mode} run completed ${mins ? `in ${mins}` : ''}.`, 'ppg-done');
    }
  } catch { /* ignore */ }
}

if (ppgRunDemoBtn) ppgRunDemoBtn.addEventListener('click', () => triggerPpg(true));
if (ppgRunFullBtn) ppgRunFullBtn.addEventListener('click', () => triggerPpg(false));

updateNutritionFilterButtons();
syncActivityWidgetGoalInputs(state.activity.widgetGoals);
renderActivityWidgetPreview(state.activity.summary);
updateActivityWidgetGoalDraftState();
restoreSessionFromStorage()
  .catch((error) => {
    console.error('Unexpected startup restore failure.', error);
  })
  .finally(markStartupReady);
