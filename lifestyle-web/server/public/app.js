const Chart = window.Chart;
if (!Chart) {
  console.warn('Chart.js failed to load. Charts will be skipped until the page is reloaded.');
}

let chartWarningShown = false;
function createChart(ctx, config) {
  if (!Chart) {
    if (!chartWarningShown) {
      console.warn('Chart.js is unavailable; charts will be skipped.');
      chartWarningShown = true;
    }
    return null;
  }
  return new Chart(ctx, config);
}

const DEFAULT_HEIGHT_CM = 175;
const WEIGHT_HEIGHT_STORAGE_KEY = 'msml.weight.height';
let weightHeightSettings = loadWeightHeightSettings();

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
  nutritionEntryFilter: 'all',
  nutritionLogShouldScrollToTop: false,
  nutritionDeletingEntries: new Set(),
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

const DEMO_SESSIONS = [
  { date: '2024-03-18', steps: 13540, calories: 2375 },
  { date: '2024-03-17', steps: 11820, calories: 2104 },
  { date: '2024-03-16', steps: 20110, calories: 2986 },
  { date: '2024-03-15', steps: 10240, calories: 1840 },
  { date: '2024-03-14', steps: 8900, calories: 1720 },
];

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
const nutritionScanButton = document.getElementById('nutritionScanButton');
const nutritionScanStatus = document.getElementById('nutritionScanStatus');
const nutritionScanPreviewWrapper = document.getElementById('nutritionScanPreviewWrapper');
const nutritionScanPreview = document.getElementById('nutritionScanPreview');
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
const activitySessionsList = document.getElementById('activitySessions');
const activitySplitsList = document.getElementById('activitySplits');
const activitySplitTitle = document.getElementById('activitySplitTitle');
const activityBestEffortsList = document.getElementById('activityBestEfforts');
const activitySessionHint = document.getElementById('activitySessionHint');
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
};

const BARCODE_DETECTOR_FALLBACK_FORMATS = [
  'ean_13',
  'ean_8',
  'upc_a',
  'upc_e',
  'code_128',
  'code_39',
];

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
  setNutritionEntryFilter('all', { force: true, render: false });
  state.nutritionLogShouldScrollToTop = true;
  setAmountReference(null);
  state.macroTargetExpanded = false;
  setMacroTargetExpanded(false);
  renderNutritionDashboard(state.nutrition);
}

function resetActivityState() {
  state.activity = {
    summary: null,
    sessions: [],
    splits: {},
    bestEfforts: [],
    strava: null,
    selectedSessionId: null,
    subjectId: null,
  };
  state.charts.activityMileage?.destroy();
  state.charts.activityMileage = null;
  state.charts.activityPace?.destroy();
  state.charts.activityPace = null;
  if (activitySessionsList) activitySessionsList.innerHTML = '';
  if (activitySplitsList) activitySplitsList.innerHTML = '';
  if (activityBestEffortsList) activityBestEffortsList.innerHTML = '';
  if (activitySplitTitle) activitySplitTitle.textContent = 'Select a session';
  if (activityWeeklyDistance) activityWeeklyDistance.textContent = '—';
  if (activityWeeklyDuration) activityWeeklyDuration.textContent = '—';
  if (activityAvgPace) activityAvgPace.textContent = '—';
  if (activityLongestRun) activityLongestRun.textContent = '—';
  if (activityTrainingLoad) activityTrainingLoad.textContent = '—';
  if (activityVo2max) activityVo2max.textContent = '—';
  if (stravaFeedback) stravaFeedback.textContent = '';
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

function applyEntryRemoval(entryId) {
  if (!state.nutrition || !Array.isArray(state.nutrition.entries)) {
    return null;
  }
  const index = state.nutrition.entries.findIndex((entry) => entry.id === entryId);
  if (index === -1) {
    return null;
  }
  const [removed] = state.nutrition.entries.splice(index, 1);
  if (state.nutrition.dailyTotals && removed) {
    const totals = { ...state.nutrition.dailyTotals };
    const clamp = (value) => Math.max(0, Math.round(value));
    totals.calories = clamp((totals.calories || 0) - (removed.calories || 0));
    totals.protein = clamp((totals.protein || 0) - (removed.protein || 0));
    totals.carbs = clamp((totals.carbs || 0) - (removed.carbs || 0));
    totals.fats = clamp((totals.fats || 0) - (removed.fats || 0));
    totals.count = Math.max(0, (totals.count || state.nutrition.entries.length + 1) - 1);
    state.nutrition.dailyTotals = totals;
  }
  return removed;
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
    }),
    { calories: 0, protein: 0, carbs: 0, fats: 0 }
  );
  const label =
    state.nutritionEntryFilter === 'Liquid'
      ? 'Fluids'
      : state.nutritionEntryFilter === 'Food'
        ? 'Foods'
        : 'All intake';
  const countLabel = `${filteredEntries.length} item${filteredEntries.length === 1 ? '' : 's'}`;
  const segments = [`${label}: ${countLabel}`, `${formatNumber(totals.calories)} kcal`];
  const macrosAvailable = totals.protein > 0 || totals.carbs > 0 || totals.fats > 0;
  if (macrosAvailable) {
    const macroLabel = `${Math.round(totals.protein)}g P / ${Math.round(totals.carbs)}g C / ${Math.round(
      totals.fats
    )}g F`;
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
      deleteButton.textContent = state.nutritionDeletingEntries.has(entry.id)
        ? 'Removing...'
        : 'Remove';
      deleteButton.disabled = state.nutritionDeletingEntries.has(entry.id);
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
    metricsParts.push(`${protein}g P`);
    metricsParts.push(`${carbs}g C`);
    metricsParts.push(`${fats}g F`);

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
    showChartMessage(canvasId, 'Log intake to unlock trend insights.');
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
    data: {
      labels,
      datasets,
    },
    options: {
      plugins: { legend: { labels: { color: '#dfe6ff' } } },
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
      Number(day?.calories) > 0
  );
  if (!sorted.length || !hasMacros) {
    state.charts.nutritionMacroTrend?.destroy();
    state.charts.nutritionMacroTrend = null;
    showChartMessage(canvasId, 'Need at least one day of macro data.');
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
      plugins: { legend: { labels: { color: '#dfe6ff' } } },
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
  syncMacroTargetFields(data.goals);
  updateNutritionPreview();
  rerenderOverviewFromState();
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

  const labels = timeline.map((entry) => formatDate(entry.date));
  const weights = timeline.map((entry) =>
    Number.isFinite(entry?.weightLbs) ? Math.round(entry.weightLbs * 10) / 10 : null
  );
  const calories = timeline.map((entry) =>
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
      plugins: { legend: { labels: { color: '#dfe6ff' } } },
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
  state.suggestions = [];
  state.activeSuggestionIndex = -1;
  if (nutritionSuggestions) {
    nutritionSuggestions.innerHTML = '';
    nutritionSuggestions.classList.add('hidden');
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
      li.textContent = 'No matches yet. Try the lookup button or pick a quick add.';
      nutritionSuggestions.appendChild(li);
      nutritionSuggestions.classList.remove('hidden');
    } else {
      nutritionSuggestions.classList.add('hidden');
    }
    return;
  }
  nutritionSuggestions.classList.remove('hidden');
  state.suggestions.forEach((item, index) => {
    const li = document.createElement('li');
    li.setAttribute('role', 'option');
    li.dataset.index = index;
    li.classList.toggle('active', index === state.activeSuggestionIndex);
    const metaParts = [];
    const calories = Number(item?.prefill?.calories);
    if (Number.isFinite(calories) && calories > 0) {
      metaParts.push(`${formatNumber(calories)} kcal`);
    }
    if (item.serving) {
      metaParts.push(item.serving);
    }
    if (item.source) {
      metaParts.push(item.source);
    }
    const metaLabel = metaParts.length ? metaParts.join(' • ') : 'Serving suggestion';
    li.innerHTML = `
      <span>${item.name}</span>
      <span class="suggestion-meta">${metaLabel}</span>
    `;
    nutritionSuggestions.appendChild(li);
  });
}

function showQuickSuggestions(query = '') {
  const normalized = query.trim().toLowerCase();
  const matches = QUICK_SUGGESTIONS.filter((item) => {
    if (!normalized) return true;
    return (
      item.name.toLowerCase().includes(normalized) ||
      item.serving?.toLowerCase().includes(normalized)
    );
  });
  const fallback = matches.length ? matches : QUICK_SUGGESTIONS;
  state.suggestions = fallback.slice(0, 8);
  state.activeSuggestionIndex = -1;
  renderSuggestions();
}

function renderSuggestionBar() {
  if (!nutritionSuggestionBar) return;
  nutritionSuggestionBar.innerHTML = '';
  QUICK_SUGGESTIONS.forEach((item) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'suggestion-chip';
    button.dataset.suggestionId = item.id;
    const metaLabel = item.serving || item.source || 'Quick add';
    button.innerHTML = `<strong>${item.name}</strong><span>${metaLabel}</span>`;
    nutritionSuggestionBar.appendChild(button);
  });
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
  if (nutritionNameInput) {
    nutritionNameInput.value = item.name;
    highlightNutritionNameInput({ forceFocus: true });
  }
  if (nutritionBarcodeInput && item.barcode) {
    nutritionBarcodeInput.value = item.barcode;
  }
  clearSuggestions();
  state.suggestionQuery = '';
  if (applySuggestionPrefill(item)) {
    return;
  }
  // Trigger lookup automatically to hydrate macros/weight
  lookupNutritionFromApi();
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
  const amount = Number.parseFloat(nutritionAmountInput?.value);
  const unit = getSelectedUnit();
  const calories = Number.parseFloat(nutritionCaloriesInput?.value);
  const protein = Number.parseFloat(nutritionProteinInput?.value);
  const carbs = Number.parseFloat(nutritionCarbsInput?.value);
  const fats = Number.parseFloat(nutritionFatsInput?.value);

  if (
    !Number.isFinite(amount) ||
    amount <= 0 ||
    !Number.isFinite(calories) ||
    calories <= 0
  ) {
    nutritionPreview.innerHTML =
      '<p class="muted small-text">Enter an item and amount to preview macros.</p>';
    return;
  }

  const grams = resolveAmountInGrams(amount, unit);
  const ml = resolveAmountInMl(amount, unit);
  const perUnit = calories / amount;
  const proteinPerUnit = Number.isFinite(protein) ? protein / amount : null;
  const carbsPerUnit = Number.isFinite(carbs) ? carbs / amount : null;
  const fatsPerUnit = Number.isFinite(fats) ? fats / amount : null;

  const detailRows = [
    `<div><strong>${formatNumber(calories)} kcal</strong><span class="muted small-text">Current ${amount} ${unit}</span></div>`,
  ];

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

  nutritionPreview.innerHTML = `
    ${detailRows.join('')}
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
      ? 'Only you can log items for your own profile.'
      : 'Switch back to your profile to log intake.';
  }
  if (!ownsProfile && nutritionFeedback) {
    nutritionFeedback.textContent = '';
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
    let formats = BARCODE_DETECTOR_FALLBACK_FORMATS;
    if (typeof window.BarcodeDetector.getSupportedFormats === 'function') {
      try {
        const supported = await window.BarcodeDetector.getSupportedFormats();
        if (supported?.length) {
          formats = supported;
        }
      } catch (error) {
        // fallback to defaults
      }
    }
    barcodeScanState.detector = new window.BarcodeDetector({ formats });
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
    nutritionScanButton.textContent = 'Scan a barcode';
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
      const rawValue = barcodes?.[0]?.rawValue?.trim();
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
    setScanStatus('Barcode scanning is not supported in this browser.', { isError: true });
    return;
  }
  nutritionScanButton.disabled = true;
  setScanStatus('Opening camera...');
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
    nutritionScanButton.textContent = 'Stop scanning';
    nutritionScanButton.disabled = false;
    setScanStatus('Align the barcode inside the frame.');
    barcodeScanState.frameId = requestAnimationFrame(() => processBarcodeFrame(detector));
  } catch (error) {
    console.error('Unable to start barcode scan', error);
    stopBarcodeScan({
      message: error?.message || 'Unable to access the camera for scanning.',
      isError: true,
      resetToDefault: false,
    });
  }
}

function initializeBarcodeScanner() {
  if (!nutritionScanButton) return;
  if (!isBarcodeScannerSupported()) {
    nutritionScanButton.disabled = true;
    setScanStatus('Barcode scanning is not supported in this browser.', { isError: true });
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
    [nutritionCaloriesInput, nutritionProteinInput, nutritionCarbsInput, nutritionFatsInput].some(
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
  };
  if (
    ![reference.calories, reference.protein, reference.carbs, reference.fats].some((value) =>
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
    title: 'Daily Dashboard',
    subtitle: 'Live snapshot of readiness, movement, and fuel.',
  },
  activity: {
    title: 'Activity Tracking',
    subtitle: 'Apple Watch / Garmin style analytics with Strava sync.',
  },
  sessions: {
    title: 'Session Planner',
    subtitle: 'Blend intensity and skill work with guardrails from your data.',
  },
  readiness: {
    title: 'Readiness Signals',
    subtitle: 'Monitor stress, sleep, and adaptation trends.',
  },
  sleep: {
    title: 'Sleep Insights',
    subtitle: 'Preview nightly recovery while the expanded module is built.',
  },
  vitals: {
    title: 'Vitals & Labs',
    subtitle: 'Track heart readings, blood pressure, and glucose trends.',
  },
  nutrition: {
    title: 'Fuel & Hydration',
    subtitle: 'Macro ratios and hydration rhythm for the current block.',
  },
  weight: {
    title: 'Weight Intelligence',
    subtitle: 'Log weigh-ins and compare against calorie exposure.',
  },
  profile: {
    title: 'Profile & Security',
    subtitle: 'Update your login details and keep your account current.',
  },
  sharing: {
    title: 'Share Data',
    subtitle: 'Invite your coach to view your dashboard.',
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
const VALID_UNITS = new Set([UNIT_FOOD, UNIT_LIQUID]);
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

function getSelectedUnit() {
  if (nutritionUnitSelect && VALID_UNITS.has(nutritionUnitSelect.value)) {
    return nutritionUnitSelect.value;
  }
  return getUnitForType(nutritionTypeSelect?.value || 'Food');
}

function maybeAutoSelectLiquid(name) {
  if (!nutritionTypeSelect) return false;
  const value = name?.toString().toLowerCase();
  if (!value) return false;
  const matched = LIQUID_KEYWORDS.some((keyword) => value.includes(keyword));
  if (matched && nutritionTypeSelect.value !== 'Liquid') {
    nutritionTypeSelect.value = 'Liquid';
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
  const normalized = VALID_UNITS.has(unit)
    ? unit
    : getUnitForType(nutritionTypeSelect?.value || 'Food');
  nutritionUnitSelect.value = normalized;
  const filled = updateAmountFieldUnit({ fill: Boolean(options.applyAmount) });
  if (!filled && options.applyAmount) {
    fillAmountForUnit(normalized);
  }
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
    if (nutritionFeedback) nutritionFeedback.textContent = 'Enter a name or barcode to look up.';
    return;
  }
  clearSuggestions();
  if (nutritionFeedback) nutritionFeedback.textContent = 'Fetching nutrition data...';
  if (nutritionLookupButton) nutritionLookupButton.disabled = true;
  try {
    const params = new URLSearchParams();
    if (barcode) {
      params.set('barcode', barcode);
    } else if (query) {
      params.set('q', query);
    }
    const response = await fetch(`/api/nutrition/lookup?${params.toString()}`, {
      headers: { Authorization: `Bearer ${state.token}` },
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.product) {
      throw new Error(payload?.message || 'No nutrition data found.');
    }
    const product = payload.product;
    if (nutritionNameInput && (!nutritionNameInput.value || barcode)) {
      nutritionNameInput.value = product.name || nutritionNameInput.value;
    }
    if (nutritionBarcodeInput && product.barcode) {
      nutritionBarcodeInput.value = product.barcode;
    }
    if (nutritionCaloriesInput && product.calories) {
      nutritionCaloriesInput.value = product.calories;
    }
    if (nutritionProteinInput && Number.isFinite(product.protein)) {
      nutritionProteinInput.value = product.protein;
    }
    if (nutritionCarbsInput && Number.isFinite(product.carbs)) {
      nutritionCarbsInput.value = product.carbs;
    }
    if (nutritionFatsInput && Number.isFinite(product.fats)) {
      nutritionFatsInput.value = product.fats;
    }
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
        }
      );
      if (nutritionTypeSelect) {
        nutritionTypeSelect.value = normalizedWeight.unit === UNIT_LIQUID ? 'Liquid' : 'Food';
      }
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
    if (nutritionFeedback) {
      nutritionFeedback.textContent = 'Nutrition details loaded. Adjust if needed before saving.';
    }
    updateNutritionPreview();
    syncMacroReferenceFromInputs();
  } catch (error) {
    if (nutritionFeedback) {
      nutritionFeedback.textContent = error.message;
    }
  } finally {
    if (nutritionLookupButton) nutritionLookupButton.disabled = false;
    syncAmountBaselineFromInput();
  }
}

function scheduleSuggestionFetch() {
  const query = nutritionNameInput?.value.trim() || '';
  if (state.suggestionTimer) {
    clearTimeout(state.suggestionTimer);
    state.suggestionTimer = null;
  }
  if (!query) {
    showQuickSuggestions();
    return;
  }
  if (query.length < 2 || !state.token) {
    showQuickSuggestions(query);
    return;
  }
  state.suggestionQuery = query;
  state.suggestionTimer = setTimeout(async () => {
    const activeQuery = state.suggestionQuery;
    try {
      const response = await fetch(`/api/nutrition/search?q=${encodeURIComponent(query)}`, {
        headers: { Authorization: `Bearer ${state.token}` },
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload) {
        throw new Error(payload?.message || 'Lookup failed.');
      }
      const latestQuery = nutritionNameInput?.value.trim() || '';
      if (activeQuery && latestQuery && activeQuery !== latestQuery) {
        return;
      }
      state.suggestions = Array.isArray(payload.suggestions) ? payload.suggestions : [];
      state.activeSuggestionIndex = -1;
      if (!state.suggestions.length) {
        showQuickSuggestions();
        return;
      }
      renderSuggestions();
    } catch (error) {
      showQuickSuggestions(query);
    }
  }, 250);
}

function setDeleteButtonState(entryId, isLoading) {
  if (!nutritionEntriesList) return;
  const selector = `button[data-action="delete-entry"][data-entry-id="${entryId}"]`;
  const button = nutritionEntriesList.querySelector(selector);
  if (!button) return;
  button.disabled = isLoading;
  button.textContent = isLoading ? 'Removing...' : 'Remove';
}

async function deleteNutritionEntry(entryId) {
  if (!state.token || !Number.isFinite(entryId) || entryId <= 0) return;
  if (!canModifyOwnNutrition() || state.nutritionDeletingEntries.has(entryId)) return;
  state.nutritionDeletingEntries.add(entryId);
  setDeleteButtonState(entryId, true);
  if (nutritionFeedback) {
    nutritionFeedback.textContent = 'Removing item...';
  }
  try {
    const response = await fetch(`/api/nutrition/${entryId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${state.token}` },
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(payload?.message || 'Unable to remove that item.');
    }
    applyEntryRemoval(entryId);
    state.nutritionLogShouldScrollToTop = false;
    renderNutritionDashboard(state.nutrition);
    if (nutritionFeedback) {
      nutritionFeedback.textContent = payload?.message || 'Entry removed.';
    }
  } catch (error) {
    if (nutritionFeedback) {
      nutritionFeedback.textContent = error.message;
    }
  } finally {
    state.nutritionDeletingEntries.delete(entryId);
    setDeleteButtonState(entryId, false);
  }
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
    viewingChip.textContent = 'Viewing your own performance';
    return;
  }
  viewingChip.textContent =
    subject.id === state.user.id
      ? 'Viewing your own performance'
      : `Viewing ${subject.name}'s performance`;
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
    const response = await fetch(endpoint, {
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
    const response = await fetch('/api/share/coaches', {
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
    const response = await fetch('/api/athletes', {
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
  if (targetPage === 'nutrition') {
    loadNutrition(state.viewing?.id ?? state.user?.id);
  }
  if (targetPage === 'activity') {
    loadActivity(state.viewing?.id ?? state.user?.id);
  }
  if (targetPage === 'vitals') {
    loadVitals(state.viewing?.id ?? state.user?.id);
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
activitySessionsList?.addEventListener('click', handleActivitySessionClick);
stravaConnectButton?.addEventListener('click', handleStravaConnect);
stravaSyncButton?.addEventListener('click', handleStravaSync);
stravaDisconnectButton?.addEventListener('click', handleStravaDisconnect);
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
    const response = await fetch('/api/share', {
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

document.addEventListener('visibilitychange', () => {
  if (document.hidden && barcodeScanState.active) {
    stopBarcodeScan({
      message: 'Scan paused while the app is hidden.',
      resetToDefault: false,
    });
  }
});

nutritionLookupButton?.addEventListener('click', lookupNutritionFromApi);
nutritionTypeSelect?.addEventListener('change', () => {
  let filled = false;
  if (nutritionTypeSelect) {
    const defaultUnit = getUnitForType(nutritionTypeSelect.value);
    if (getSelectedUnit() !== UNIT_PORTION) {
      setSelectedUnit(defaultUnit, { applyAmount: true });
      filled = true;
    } else {
      filled = updateAmountFieldUnit({ fill: true });
    }
  }
  if (!filled) {
    syncAmountBaselineFromInput();
  }
});
nutritionUnitSelect?.addEventListener('change', () => {
  if (!nutritionUnitSelect) return;
  if (!VALID_UNITS.has(nutritionUnitSelect.value)) {
    setSelectedUnit(getUnitForType(nutritionTypeSelect?.value || 'Food'), { applyAmount: true });
    return;
  }
  if (nutritionUnitSelect.value === UNIT_LIQUID && nutritionTypeSelect) {
    nutritionTypeSelect.value = 'Liquid';
  } else if (nutritionUnitSelect.value === UNIT_FOOD && nutritionTypeSelect) {
    nutritionTypeSelect.value = 'Food';
  }
  const filled = updateAmountFieldUnit({ fill: true });
  if (!filled) {
    syncAmountBaselineFromInput();
  }
});
updateAmountFieldUnit();
syncAmountBaselineFromInput();
nutritionAmountInput?.addEventListener('input', handleAmountInputChange);
const macroInputs = [
  nutritionCaloriesInput,
  nutritionProteinInput,
  nutritionCarbsInput,
  nutritionFatsInput,
];
macroInputs.forEach((input) => {
  input?.addEventListener('input', () => {
    syncAmountBaselineFromInput();
    syncMacroReferenceFromInputs();
    updateNutritionPreview();
  });
});
renderSuggestionBar();

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
  maybeAutoSelectLiquid(nutritionNameInput.value);
  scheduleSuggestionFetch();
});

nutritionNameInput?.addEventListener('blur', () => {
  setTimeout(() => clearSuggestions(), 150);
});

nutritionNameInput?.addEventListener('focus', () => {
  highlightNutritionNameInput();
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
  const suggestion = QUICK_SUGGESTIONS.find((item) => item.id === button.dataset.suggestionId);
  applySuggestion(suggestion);
});

nutritionNameInput?.addEventListener('keydown', (event) => {
  if (!state.suggestions.length) return;
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    state.activeSuggestionIndex =
      (state.activeSuggestionIndex + 1) % state.suggestions.length;
    renderSuggestions();
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    state.activeSuggestionIndex =
      (state.activeSuggestionIndex - 1 + state.suggestions.length) % state.suggestions.length;
    renderSuggestions();
  } else if (event.key === 'Enter') {
    if (state.activeSuggestionIndex >= 0) {
      event.preventDefault();
      const item = state.suggestions[state.activeSuggestionIndex];
      applySuggestion(item);
    }
  } else if (event.key === 'Escape') {
    clearSuggestions();
  }
});

nutritionForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!state.token) return;
  if (!state.user || !state.viewing || state.user.id !== state.viewing.id) {
    if (nutritionFeedback) {
      nutritionFeedback.textContent = 'Switch to your own profile to log intake.';
    }
    return;
  }

  const name = nutritionNameInput?.value.trim();
  const barcode = nutritionBarcodeInput?.value.trim();
  const type = nutritionTypeSelect?.value || 'Food';
  const caloriesValue = Number.parseInt(nutritionCaloriesInput?.value, 10);

  if (!name && !barcode) {
    nutritionFeedback.textContent = 'Provide a name or barcode.';
    return;
  }

  const payload = {
    name,
    barcode,
    type,
  };
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
  if (proteinValue > 0) payload.protein = proteinValue;
  if (carbValue > 0) payload.carbs = carbValue;
  if (fatValue > 0) payload.fats = fatValue;

  nutritionFeedback.textContent = 'Logging item...';
  try {
    const response = await fetch('/api/nutrition', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${state.token}`,
      },
      body: JSON.stringify(payload),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result) {
      throw new Error(result?.message || 'Unable to log that item.');
    }
    const note = result.autoLookup ? ' (nutrition estimated automatically)' : '';
    nutritionFeedback.textContent = `${result.message}${note}`;
    nutritionForm.reset();
    if (nutritionTypeSelect) {
      nutritionTypeSelect.value = 'Food';
    }
    state.nutritionAmountBaseline = null;
    state.nutritionMacroReference = null;
    state.nutritionLogShouldScrollToTop = true;
    setAmountReference(null);
    updateAmountFieldUnit();
    await loadNutrition();
    if (type === 'Liquid') {
      await loadMetrics(state.user?.id);
    }
    clearSuggestions();
  } catch (error) {
    nutritionFeedback.textContent = error.message;
  }
});

nutritionClearButton?.addEventListener('click', () => {
  stopBarcodeScan();
  nutritionForm?.reset();
  clearSuggestions();
  if (nutritionTypeSelect) {
    nutritionTypeSelect.value = 'Food';
  }
  setAmountReference(null);
  state.nutritionAmountBaseline = null;
  state.nutritionMacroReference = null;
  setSelectedUnit(UNIT_FOOD);
  updateAmountFieldUnit();
  updateNutritionPreview();
  if (nutritionFeedback) {
    nutritionFeedback.textContent = '';
  }
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
    const response = await fetch('/api/nutrition/macros', {
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
    const response = await fetch('/api/password/forgot', {
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
    const response = await fetch('/api/profile', {
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
  await fetchRoster();
  await loadMetrics();
  await loadNutrition();
  await loadActivity();
  await loadVitals();
  await loadWeight();
  setWeightDateDefault();

  loginPanel.classList.add('hidden');
  dashboard.classList.remove('hidden');
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
    await fetch('/api/login/logout', {
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
    const response = await fetch('/api/login', {
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
    loginFeedback.textContent = error.message;
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
    const response = await fetch('/api/signup', {
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
      signupFeedback.textContent = error.message;
    }
  }
});

async function loadMetrics(subjectOverrideId) {
  if (!state.user) return;
  const targetId = subjectOverrideId ?? state.viewing?.id ?? state.user.id;
  const query =
    targetId && targetId !== state.user.id ? `?athleteId=${encodeURIComponent(targetId)}` : '';

  const response = await fetch(`/api/metrics${query}`, {
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
  renderSessions(metrics.timeline);
  renderNutritionDetails(metrics.macros, state.hydrationEntries);
  updateCharts(metrics);
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
    const response = await fetch(`/api/nutrition${query}`, {
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
        if (nutritionFeedback && isSelfView) {
          nutritionFeedback.textContent =
            response.status === 403
              ? 'Access revoked for that athlete.'
              : 'That athlete is no longer available.';
        }
      } else if (nutritionFeedback && isSelfView) {
        nutritionFeedback.textContent = 'Unable to load nutrition right now.';
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
    state.nutritionLogShouldScrollToTop = true;
    renderNutritionDashboard(state.nutrition);
  } catch (error) {
    if (nutritionFeedback && isSelfView) {
      nutritionFeedback.textContent = 'Unable to load nutrition right now.';
    }
  }
}

function applyDemoActivityData(feedbackMessage) {
  const demo = cloneDemoData(DEMO_ACTIVITY);
  state.activity.summary = demo.summary || null;
  state.activity.sessions = Array.isArray(demo.sessions) ? demo.sessions.slice() : [];
  state.activity.splits = demo.splits || {};
  state.activity.bestEfforts = Array.isArray(demo.bestEfforts) ? demo.bestEfforts.slice() : [];
  state.activity.strava = {
    ...(state.activity.strava || {}),
    ...(demo.strava || {}),
  };
  state.activity.subjectId = state.viewing?.id ?? state.user?.id ?? null;
  state.activity.selectedSessionId = state.activity.sessions[0]?.id || null;
  renderActivitySummary(state.activity.summary);
  renderActivitySessions(state.activity.sessions);
  renderActivitySplits();
  renderActivityBestEfforts(state.activity.bestEfforts);
  renderActivityCharts(demo.charts || {});
  renderStravaPanel(state.activity.strava || {});
  if (feedbackMessage && stravaFeedback) {
    stravaFeedback.textContent = feedbackMessage;
  }
}

function applyDemoVitalsData(feedbackMessage) {
  const demo = cloneDemoData(DEMO_VITALS);
  state.vitals.latest = demo.latest || null;
  state.vitals.timeline = Array.isArray(demo.timeline) ? demo.timeline.slice() : [];
  state.vitals.stats = demo.stats || null;
  renderVitalsDashboard(state.vitals);
  if (feedbackMessage && vitalsFeedback) {
    vitalsFeedback.textContent = feedbackMessage;
  }
}

async function loadActivity(subjectOverrideId) {
  if (!state.user || !state.token) return;
  const targetId = subjectOverrideId ?? state.viewing?.id ?? state.user.id;
  const isSelfView = !targetId || targetId === state.user.id;
  const query =
    targetId && targetId !== state.user.id ? `?athleteId=${encodeURIComponent(targetId)}` : '';

  try {
    const response = await fetch(`/api/activity${query}`, {
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
      } else if (isSelfView) {
        applyDemoActivityData('Showing demo activity data while your tracker syncs.');
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
    if (!hasActivityData && isSelfView) {
      applyDemoActivityData('Showing demo activity data while your tracker syncs.');
      return;
    }
    renderActivitySummary(state.activity.summary);
    renderActivitySessions(state.activity.sessions);
    renderActivitySplits();
    renderActivityBestEfforts(state.activity.bestEfforts);
    renderActivityCharts(charts);
    renderStravaPanel(state.activity.strava || {});
  } catch (error) {
    if (isSelfView) {
      applyDemoActivityData('Showing demo activity data while your tracker syncs.');
    } else if (stravaFeedback) {
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
    const response = await fetch(`/api/vitals${query}`, {
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
      } else if (isSelfView) {
        applyDemoVitalsData('Showing demo vitals data while wearables sync.');
      } else if (vitalsFeedback) {
        vitalsFeedback.textContent = 'Unable to load vitals right now.';
      }
      return;
    }

    const payload = await response.json();
    state.vitals.latest = payload.latest || null;
    state.vitals.timeline = Array.isArray(payload.timeline) ? payload.timeline : [];
    state.vitals.stats = payload.stats || null;
    const hasVitalsData =
      Boolean(state.vitals.latest) ||
      (Array.isArray(state.vitals.timeline) && state.vitals.timeline.length > 0) ||
      Boolean(state.vitals.stats);
    if (!hasVitalsData && isSelfView) {
      applyDemoVitalsData('Showing demo vitals data while wearables sync.');
      return;
    }
    renderVitalsDashboard(state.vitals);
    if (vitalsFeedback) {
      vitalsFeedback.textContent = '';
    }
  } catch (error) {
    if (isSelfView) {
      applyDemoVitalsData('Showing demo vitals data while wearables sync.');
    } else if (vitalsFeedback) {
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
    const response = await fetch(`/api/weight${query}`, {
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
  renderActivitySessions(state.activity.sessions);
  renderActivitySplits();
}

async function handleStravaConnect(event) {
  if (event) event.preventDefault();
  if (!state.token) return;
  if (stravaFeedback) {
    stravaFeedback.textContent = 'Opening Strava...';
  }
  try {
    const response = await fetch('/api/activity/strava/connect', {
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
    const response = await fetch('/api/activity/strava/sync', {
      method: 'POST',
      headers: { Authorization: `Bearer ${state.token}` },
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(payload?.message || 'Unable to sync Strava right now.');
    }
    if (stravaFeedback) {
      stravaFeedback.textContent = `Imported ${payload.imported} of ${payload.fetched} activities.`;
    }
    await loadActivity(state.activity.subjectId || state.viewing?.id || state.user?.id);
  } catch (error) {
    if (stravaFeedback) {
      stravaFeedback.textContent = error.message;
    }
  }
}

async function handleStravaDisconnect(event) {
  if (event) event.preventDefault();
  if (!state.token) return;
  if (stravaFeedback) {
    stravaFeedback.textContent = 'Disconnecting Strava...';
  }
  try {
    const response = await fetch('/api/activity/strava/disconnect', {
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
    const response = await fetch('/api/weight', {
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
    const response = await fetch(`/api/weight/${entryId}`, {
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

  const avatar = document.createElement('img');
  avatar.className = 'avatar';
  avatar.alt = user.name;
  const avatarSrc = resolveAvatarSrc(user);
  if (avatarSrc) {
    avatar.src = avatarSrc;
  } else {
    avatar.style.background = 'var(--gradient)';
  }
  avatar.onerror = () => {
    avatar.removeAttribute('src');
    avatar.style.background = 'var(--gradient)';
  };

  const info = document.createElement('div');
  const roleParts = [user.role, user.weight_category].filter(Boolean);
  const labelText = roleParts.length ? roleParts.join(' • ') : 'Athlete';
  info.innerHTML = `
    <p class="label">${labelText}</p>
    <h3>${user.name}</h3>
  `;

  profileCard.appendChild(avatar);
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

const VITALS_CHART_WINDOW = 14;
const VITALS_CHART_AXIS_MIN = 40;
const VITALS_CHART_AXIS_MAX = 200;

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

function getRecentVitalsTimeline(timeline = [], limit = VITALS_CHART_WINDOW) {
  const chronological = sortVitalsTimeline(timeline);
  if (!limit || chronological.length <= limit) {
    return chronological;
  }
  return chronological.slice(-limit);
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
  renderVitalsChart(timeline);
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
  const chronological = getRecentVitalsTimeline(timeline);
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
          min: VITALS_CHART_AXIS_MIN,
          max: VITALS_CHART_AXIS_MAX,
          ticks: {
            color: 'rgba(255, 255, 255, 0.7)',
            stepSize: 10,
            autoSkip: false,
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
    { key: 'deep', label: 'Deep' },
    { key: 'rem', label: 'REM' },
    { key: 'light', label: 'Light' },
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
    item.innerHTML = `
      <div>
        <p class="label">${stage.label}</p>
        <p class="muted small-text">${percent}% of night</p>
      </div>
      <p class="sleep-stage-duration">${formatDurationFromMinutes(minutes)}</p>
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
  const recent = timeline.slice(-7);
  const { canvas: activeCanvas } = hideChartMessage(canvasId) || {};
  const ctx = (activeCanvas || canvas).getContext('2d');
  const labels = recent.map((entry) => formatDate(entry.date));
  const hours = recent.map((entry) => Math.round(entry.sleepHours * 10) / 10);
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
          ticks: { color: '#9bb0d6' },
          grid: { color: 'rgba(255, 255, 255, 0.05)' },
        },
        y: {
          ticks: {
            color: '#9bb0d6',
            callback(value) {
              return `${value}h`;
            },
          },
          grid: { color: 'rgba(255, 255, 255, 0.05)' },
          suggestedMin: 4,
          suggestedMax: Number.isFinite(goalSleep) ? Math.max(goalSleep + 1, 9) : 9,
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
  const labels = timeline.map((entry) => formatDate(entry.date));
  const steps = timeline.map((entry) => entry.steps);
  const calories = timeline.map((entry) => entry.calories);

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
      plugins: { legend: { labels: { color: '#dfe6ff' } } },
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
      plugins: {
        legend: { position: 'bottom', labels: { color: '#dfe6ff' } },
      },
    },
  });
}

function renderSessions(timeline = []) {
  const list = document.getElementById('sessionsList');
  const summary = document.getElementById('sessionsSummary');
  if (!list) return;

  const hasTimeline = Array.isArray(timeline) && timeline.length > 0;
  const sourceTimeline = hasTimeline ? timeline : DEMO_SESSIONS;
  const usingDemoTimeline = !hasTimeline && Array.isArray(sourceTimeline) && sourceTimeline.length > 0;
  list.innerHTML = '';

  if (!sourceTimeline.length) {
    const li = document.createElement('li');
    li.className = 'session-item';
    li.innerHTML = '<p class="muted">No sessions logged yet.</p>';
    list.appendChild(li);
    if (summary) {
      summary.textContent = 'Sessions will populate once your tracker syncs activity.';
    }
    enforceScrollableList(list);
    return;
  }

  const orderedSessions = sourceTimeline.slice().reverse();
  const loadBySession = orderedSessions.map((entry) => Math.round(entry.calories / 12 + entry.steps / 500));

  orderedSessions.forEach((entry, index) => {
    const load = loadBySession[index];
    const li = document.createElement('li');
    li.className = 'session-item';
    const effort =
      load >= 40 ? 'High output day' : load >= 25 ? 'Solid aerobic effort' : 'Recovery biased';
    li.innerHTML = `
      <div>
        <p class="session-title">${formatDate(entry.date)}</p>
        <p class="muted">${effort}</p>
      </div>
      <div class="session-metrics">
        <span>${formatNumber(entry.steps)} steps</span>
        <span>${formatNumber(entry.calories)} kcal</span>
      </div>
    `;
    list.appendChild(li);
  });

  if (summary) {
    const summaryWindow = orderedSessions.slice(0, 5);
    const windowLoad = loadBySession.slice(0, summaryWindow.length).reduce((sum, value) => sum + value, 0);
    const avgLoad = Math.round(windowLoad / (summaryWindow.length || 1));
    const windowLabel =
      summaryWindow.length >= 5
        ? 'last five days'
        : `${summaryWindow.length} recent day${summaryWindow.length === 1 ? '' : 's'}`;
    const baseCopy =
      avgLoad >= 40
        ? `Dial in parasympathetic work—pair tough days with breath work or easy spins (${windowLabel}).`
        : avgLoad >= 25
          ? `Load is balanced (${windowLabel}). Keep two intensity waves and anchor sleep before peak sessions.`
          : `Volume is light (${windowLabel}). Layer in one longer aerobic builder plus a short strength primer.`;
    summary.textContent = usingDemoTimeline ? `Demo block · ${baseCopy}` : baseCopy;
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

  sessions.forEach((session) => {
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
    pace.textContent = session.averagePace ? `${formatPace(session.averagePace)} /km` : '—';
    const hr = document.createElement('span');
    hr.textContent = session.averageHr ? `${Math.round(session.averageHr)} bpm` : '—';
    meta.appendChild(distance);
    meta.appendChild(pace);
    meta.appendChild(hr);
    if (Number.isFinite(session.trainingLoad)) {
      const load = document.createElement('span');
      load.textContent = `${Math.round(session.trainingLoad)} load`;
      meta.appendChild(load);
    }

    button.appendChild(header);
    button.appendChild(meta);
    li.appendChild(button);
    activitySessionsList.appendChild(li);
  });
  enforceScrollableList(activitySessionsList);
}

function renderActivitySplits() {
  if (!activitySplitsList) return;
  activitySplitsList.innerHTML = '';
  const sessionId = state.activity.selectedSessionId;
  const session = state.activity.sessions.find((item) => item.id === sessionId);
  if (!session) {
    if (activitySplitTitle) activitySplitTitle.textContent = 'Select a session';
    const empty = document.createElement('li');
    empty.className = 'empty-row';
    empty.textContent = 'Choose a session to review splits.';
    activitySplitsList.appendChild(empty);
    enforceScrollableList(activitySplitsList);
    return;
  }
  if (activitySplitTitle) activitySplitTitle.textContent = session.name || 'Session splits';
  const splits = state.activity.splits?.[session.id] || [];
  if (!splits.length) {
    const empty = document.createElement('li');
    empty.className = 'empty-row';
    empty.textContent = 'Splits not available for this run.';
    activitySplitsList.appendChild(empty);
    enforceScrollableList(activitySplitsList);
    return;
  }
  splits.forEach((split) => {
    const li = document.createElement('li');
    const main = document.createElement('div');
    main.className = 'activity-split-main';
    const title = document.createElement('strong');
    title.textContent = `Split ${split.splitIndex}`;
    const detail = document.createElement('span');
    detail.className = 'muted';
    detail.textContent = `${formatDistance(split.distance)} • ${
      split.pace ? `${formatPace(split.pace)} /km` : '—'
    }`;
    main.appendChild(title);
    main.appendChild(detail);

    const metrics = document.createElement('div');
    metrics.className = 'activity-session-meta';
    const hr = document.createElement('span');
    hr.textContent = split.heartRate ? `${Math.round(split.heartRate)} bpm` : '—';
    const elevation = document.createElement('span');
    elevation.textContent = Number.isFinite(split.elevation)
      ? `${Math.round(split.elevation)} m`
      : '—';
    metrics.appendChild(hr);
    metrics.appendChild(elevation);

    li.appendChild(main);
    li.appendChild(metrics);
    activitySplitsList.appendChild(li);
  });
  enforceScrollableList(activitySplitsList);
}

function renderActivityBestEfforts(efforts = []) {
  if (!activityBestEffortsList) return;
  activityBestEffortsList.innerHTML = '';
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
    const main = document.createElement('div');
    main.className = 'activity-split-main';
    const title = document.createElement('strong');
    title.textContent = effort.label;
    const detail = document.createElement('span');
    detail.className = 'muted';
    const distance = formatDistance(effort.distance);
    const pace = effort.paceSeconds ? `${formatPace(effort.paceSeconds)} /km` : '—';
    detail.textContent = `${distance} • ${pace}`;
    main.appendChild(title);
    main.appendChild(detail);
    const date = document.createElement('span');
    date.className = 'muted';
    date.textContent = effort.startTime ? formatDate(effort.startTime) : '';
    li.appendChild(main);
    li.appendChild(date);
    activityBestEffortsList.appendChild(li);
  });
  enforceScrollableList(activityBestEffortsList);
}

function renderActivityCharts(charts = {}) {
  renderActivityMileageChart(charts.mileageTrend || []);
  renderActivityPaceChart(charts.heartRatePace || []);
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
  const labels = trend.map((entry) => formatDate(entry.startTime));
  const distances = trend.map((entry) => Number(entry.distanceKm) || 0);
  const durations = trend.map((entry) => Number(entry.movingMinutes) || 0);
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
      plugins: { legend: { labels: { color: '#dfe6ff' } } },
      scales: {
        x: { ticks: { color: '#9bb0d6' }, grid: { color: 'rgba(255,255,255,0.05)' } },
        y: { ticks: { color: '#9bb0d6' }, grid: { color: 'rgba(255,255,255,0.05)' } },
      },
    },
  });
}

function renderActivityPaceChart(points = []) {
  const canvas = document.getElementById('activityPaceChart');
  if (!canvas) return;
  if (!points.length) {
    state.charts.activityPace?.destroy();
    state.charts.activityPace = null;
    showChartMessage('activityPaceChart', 'Add a few runs to compare pace vs HR.');
    return;
  }
  const { canvas: activeCanvas } = hideChartMessage('activityPaceChart') || {};
  const ctx = (activeCanvas || canvas).getContext('2d');
  const dataset = points
    .filter((point) => Number.isFinite(point.paceSeconds) && Number.isFinite(point.heartRate))
    .map((point) => ({ x: point.paceSeconds, y: point.heartRate, label: point.label }));
  if (!dataset.length) {
    state.charts.activityPace?.destroy();
    state.charts.activityPace = null;
    showChartMessage('activityPaceChart', 'Add one more run with HR data to plot pace.');
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
      plugins: {
        legend: { display: false },
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
      stravaSummary.textContent = 'Connect Strava to automatically import runs, rides, and hikes.';
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
    }
  });
}

updateNutritionFilterButtons();
restoreSessionFromStorage();
