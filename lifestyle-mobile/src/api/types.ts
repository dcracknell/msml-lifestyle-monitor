export type UserRole = 'Head Coach' | 'Coach' | 'Athlete';

export interface UserProfile {
  id: number;
  name: string;
  email: string;
  role: UserRole;
  avatar_url?: string | null;
  avatar_photo?: string | null;
  weight_category?: string | null;
  goal_steps?: number | null;
  goal_calories?: number | null;
  goal_sleep?: number | null;
  goal_readiness?: number | null;
  strava_client_id?: string | null;
  strava_client_secret?: string | null;
  strava_redirect_uri?: string | null;
}

export interface SessionPayload {
  token: string;
  user: UserProfile;
}

export interface MetricSummary {
  steps: number | null;
  calories: number | null;
  sleepHours: number | null;
  readiness: number | null;
}

export interface MetricTimelineEntry {
  date: string;
  steps: number | null;
  calories: number | null;
  readiness: number | null;
  sleepHours?: number | null;
}

export interface MacroTargets {
  protein: number | null;
  carbs: number | null;
  fats: number | null;
  targetCalories?: number | null;
  calories?: number | null;
}

export interface HeartRateZoneSample {
  zone: string;
  minutes: number;
}

export interface HydrationSample {
  date: string;
  ounces: number;
}

export interface SleepStageSample {
  date: string;
  deep: number | null;
  rem: number | null;
  light: number | null;
}

export interface ReadinessSample {
  date: string;
  readiness: number | null;
}

export interface MetricsResponse {
  user: UserProfile;
  subject: UserProfile;
  summary: MetricSummary | null;
  timeline: MetricTimelineEntry[];
  macros: MacroTargets | null;
  heartRateZones: HeartRateZoneSample[];
  hydration: HydrationSample[];
  sleepStages: SleepStageSample | null;
  readiness: ReadinessSample[];
}

export interface ActivitySession {
  id: number;
  source: string | null;
  sourceId: string | null;
  userId: number;
  name: string;
  notes: string | null;
  sportType: string;
  startTime: string;
  distance: number | null;
  movingTime: number | null;
  elapsedTime: number | null;
  averageHr: number | null;
  maxHr: number | null;
  averagePace: number | null;
  averageCadence: number | null;
  averagePower: number | null;
  elevationGain: number | null;
  calories: number | null;
  perceivedEffort: number | null;
  vo2maxEstimate: number | null;
  trainingLoad: number | null;
  stravaActivityId: number | null;
}

export interface ActivitySplit {
  sessionId: number;
  splitIndex: number;
  distance: number | null;
  movingTime: number | null;
  pace: number | null;
  elevation: number | null;
  heartRate: number | null;
}

export interface ActivityCharts {
  mileageTrend: { startTime: string; distanceKm: number; movingMinutes: number }[];
  heartRatePace: { label: string; heartRate: number; paceSeconds: number }[];
  trainingLoad: { startTime: string; trainingLoad: number }[];
}

export interface ActivitySummary {
  weeklyDistanceKm: number | null;
  weeklyDurationMin: number | null;
  weeklyElevationGain: number | null;
  trainingLoad: number | null;
  avgPaceSeconds: number | null;
  longestRunKm: number | null;
  longestRunName: string | null;
  vo2maxEstimate: number | null;
}

export interface ActivityEffort {
  label: string;
  sessionId: number | null;
  distance: number | null;
  paceSeconds: number | null;
  startTime: string | null;
}

export interface StravaStatus {
  enabled: boolean;
  configured: boolean;
  connected: boolean;
  athleteId: number | null;
  athleteName: string | null;
  lastSync: string | null;
  scope: string | null;
  redirectUri: string | null;
  canManage: boolean;
  requiresSetup: boolean;
  usingServerDefaults?: boolean;
}

export interface ActivityResponse {
  subject: UserProfile;
  sessions: ActivitySession[];
  splits: Record<number, ActivitySplit[]>;
  charts: ActivityCharts;
  bestEfforts: ActivityEffort[];
  summary: ActivitySummary | null;
  strava: StravaStatus;
}

export interface ActivitySessionUpdateResponse {
  message: string;
  session: Pick<ActivitySession, 'id' | 'source' | 'sourceId' | 'userId' | 'name' | 'notes'>;
}

export interface StravaConnectResponse {
  url: string;
  expiresAt: string;
}

export interface StravaSyncResponse {
  imported: number;
  fetched: number;
  skipped?: number;
  pages?: number;
  lastSync: string;
}

export interface StravaExportResponse {
  message: string;
  sessionId: number;
  stravaActivityId: number;
  stravaActivityUrl?: string | null;
  name?: string | null;
  sportType?: string | null;
  startTime?: string | null;
}

export interface WorkoutPublishResponse {
  accepted: number;
  created: number;
  updated: number;
}

export interface VitalsEntry {
  date: string;
  restingHr: number | null;
  hrvScore: number | null;
  spo2: number | null;
  stressScore: number | null;
  systolic: number | null;
  diastolic: number | null;
  glucose: number | null;
  fieldDates?: Partial<Record<'restingHr' | 'hrvScore' | 'spo2' | 'stressScore' | 'systolic' | 'diastolic' | 'glucose', string | null>>;
}

export interface VitalsStats {
  window: number;
  restingHrCount?: number | null;
  restingHrAvg: number | null;
  restingHrDelta: number | null;
  glucoseCount?: number | null;
  glucoseAvg: number | null;
  glucoseDelta: number | null;
  bloodPressureCount?: number | null;
  systolicAvg: number | null;
  diastolicAvg: number | null;
  hrvCount?: number | null;
  hrvAvg: number | null;
  spo2Count?: number | null;
  spo2Avg: number | null;
  stressCount?: number | null;
  stressAvg: number | null;
}

export interface VitalsResponse {
  subject: UserProfile;
  latest: VitalsEntry | null;
  timeline: VitalsEntry[];
  stats: VitalsStats | null;
}

export interface WeightEntry {
  id: number;
  date: string;
  weightKg: number | null;
  weightLbs: number | null;
  calories: number | null;
}

export interface WeightStats {
  window: number;
  avgWeightKg: number | null;
  avgWeightLbs: number | null;
  weeklyChangeKg: number | null;
  weeklyChangeLbs: number | null;
  caloriesAvg: number | null;
  caloriesDeltaFromGoal: number | null;
}

export interface WeightResponse {
  subject: UserProfile;
  latest: WeightEntry | null;
  timeline: WeightEntry[];
  recent: WeightEntry[];
  stats: WeightStats | null;
}

export interface NutritionEntry {
  id: number;
  date: string;
  name: string;
  type: string;
  barcode: string | null;
  calories: number;
  protein: number;
  carbs: number;
  fats: number;
  fiber: number;
  weightAmount: number | null;
  weightUnit: string | null;
  createdAt: string;
  photoData?: string | null;
}

export interface NutritionTotals {
  calories: number;
  protein: number;
  carbs: number;
  fats: number;
  fiber: number;
  count: number;
}

export interface NutritionTrendEntry {
  date: string;
  calories: number;
  protein: number;
  carbs: number;
  fats: number;
  fiber: number;
  targetCalories: number | null;
  percent: number | null;
}

export interface NutritionResponse {
  date: string;
  goals: MacroTargets;
  dailyTotals: NutritionTotals | null;
  entries: NutritionEntry[];
  monthTrend: NutritionTrendEntry[];
  subjectId: number;
}

export interface AthleteSummary {
  id: number;
  name: string;
  email: string;
  role: UserRole;
  avatar_url?: string | null;
  avatar_photo?: string | null;
  weight_category?: string | null;
  goal_steps?: number | null;
  goal_calories?: number | null;
  goal_sleep?: number | null;
  goal_readiness?: number | null;
  readinessScore: number | null;
  steps: number | null;
  calories: number | null;
  sleepHours: number | null;
  rank: number;
  roleTier: string;
}

export interface AthletesResponse {
  athletes: AthleteSummary[];
}

export interface ShareCoach {
  id: number;
  name: string;
  email: string;
  role: UserRole;
}

export interface ShareCoachesResponse {
  coaches: ShareCoach[];
}

export interface MessageResponse {
  message: string;
}

export interface NutritionSuggestionPrefill {
  type?: 'Food' | 'Liquid';
  calories?: number | null;
  protein?: number | null;
  carbs?: number | null;
  fats?: number | null;
  fiber?: number | null;
  weightAmount?: number | null;
  weightUnit?: string | null;
  barcode?: string | null;
}

export interface NutritionSuggestion {
  id: string;
  name: string;
  source?: string;
  barcode?: string | null;
  serving?: string | null;
  prefill?: NutritionSuggestionPrefill;
}

export interface NutritionSuggestionsResponse {
  suggestions: NutritionSuggestion[];
}

export interface NutritionLookupProduct {
  name?: string;
  barcode?: string | null;
  serving?: string | null;
  calories?: number | null;
  protein?: number | null;
  carbs?: number | null;
  fats?: number | null;
  fiber?: number | null;
  weightAmount?: number | null;
  weightUnit?: string | null;
}

export interface NutritionLookupResponse {
  product: NutritionLookupProduct | null;
}

export interface NutritionLogResponse {
  message?: string;
  autoLookup?: boolean;
  entriesLogged?: Array<{ name?: string }>;
  mealAnalysis?: unknown;
  photoAnalysis?: unknown;
}

export interface NutritionLookupBatchResult {
  barcode: string;
  found: boolean;
  product: NutritionLookupProduct | null;
  code?: string;
  message?: string;
}

export interface NutritionLookupBatchResponse {
  requested: number;
  resolved: number;
  truncated?: number;
  max?: number;
  results: NutritionLookupBatchResult[];
}

export interface StreamSample {
  ts: number;
  value: number | null;
}

export interface StreamHistoryResponse {
  subjectId: number;
  metric: string;
  from: number;
  to: number;
  total: number;
  maxPoints: number;
  points: StreamSample[];
}

export interface StreamSummaryMetric {
  metric: string;
  sampleCount: number;
  firstTs: number | null;
  lastTs: number | null;
  latest: {
    ts: number | null;
    value: number | null;
  } | null;
}

export interface StreamSummaryResponse {
  subjectId: number;
  from: number;
  to: number;
  totalMetrics: number;
  metrics: StreamSummaryMetric[];
}

export interface StreamPublishResponse {
  metric: string;
  accepted: number;
}

export interface PpgPredictionPayload {
  model_name: string | null;
  model_version?: string | null;
  input?: {
    signal_path?: string;
    demographics_path?: string;
    fs_hz?: number;
    window_seconds?: number;
    n_samples?: number;
  };
  prediction?: {
    class_index?: number;
    label?: string | null;
    probabilities?: Record<string, number>;
  };
  quality?: {
    n_subwindows_attempted?: number | null;
    n_subwindows_used?: number | null;
    mean_sqi?: number | null;
    min_sqi?: number | null;
  };
  input_preview?: PpgInputPreview | null;
  inputPreview?: PpgInputPreview | null;
  warnings?: string[];
}

export interface PpgInputPreviewSeries {
  timesSec?: number[];
  values?: number[];
}

export interface PpgInputPreviewWindow {
  startSec?: number | null;
  endSec?: number | null;
  durationSeconds?: number | null;
  usedLatestWindow?: boolean | null;
  label?: string | null;
}

export interface PpgInputPreview {
  sourceType?: string | null;
  demoDatasetId?: string | null;
  demoDatasetLabel?: string | null;
  signalFileName?: string | null;
  heartRateFileName?: string | null;
  rrFileName?: string | null;
  signalMetric?: string | null;
  sampleRateHz?: number | null;
  sampleCount?: number | null;
  durationSeconds?: number | null;
  signal?: PpgInputPreviewSeries | null;
  heartRate?: Record<string, unknown> | null;
  rr?: Record<string, unknown> | null;
  window?: PpgInputPreviewWindow | null;
}

export interface PpgRunRequestMeta {
  signalMetric: string | null;
  signalSampleCount: number | null;
  signalStartedAt: string | null;
  signalEndedAt: string | null;
  signalDurationMs: number | null;
  fsHz: number | null;
  strictLength: boolean;
}

export interface PpgRunResultSummary {
  label: string | null;
  confidence: number | null;
  modelName: string | null;
  meanSqi: number | null;
  usedSubwindows: number | null;
  attemptedSubwindows: number | null;
}

export interface PpgRunSummary {
  id: number;
  userId: number;
  requestedByUserId: number;
  mode: string;
  isDemo: boolean;
  status: 'running' | 'completed' | 'failed';
  startedAt: string | null;
  completedAt: string | null;
  elapsedSeconds: number | null;
  error: string | null;
  request: PpgRunRequestMeta;
  resultSummary: PpgRunResultSummary | null;
}

export interface PpgStatusInfo {
  ready: boolean;
  message: string;
  missingModules?: string[];
  missingFiles?: string[];
  missingFields?: string[];
  metric?: string;
  sampleCount?: number;
  requiredSamples?: number;
  fsHz?: number;
  windowSeconds?: number;
  spanMs?: number;
  expectedSpanMs?: number;
  pythonBin?: string;
  modelDir?: string;
  signalPath?: string;
  demographicsPath?: string;
}

export interface PpgDemoDatasetStatus {
  id: string;
  label: string;
  description: string;
  durationSeconds: number;
  window?: {
    label?: string | null;
    startSec?: number | null;
    durationSec?: number | null;
  } | null;
  ready: boolean;
  sourceName?: string | null;
  message: string;
}

export interface PpgStatusResponse {
  running: boolean;
  inMemory: PpgRunSummary | null;
  latestRun: PpgRunSummary | null;
  latestPrediction: PpgPredictionPayload | null;
  runtime: PpgStatusInfo;
  bundle: PpgStatusInfo;
  demoInput: PpgStatusInfo;
  demoDatasets: PpgDemoDatasetStatus[];
  liveInput: PpgStatusInfo;
  profile: PpgStatusInfo;
  signalMetric: string;
  subject: {
    id: number;
    name: string;
    role: string;
  };
}

export interface PpgResultsResponse {
  run: PpgRunSummary | null;
  prediction: PpgPredictionPayload | null;
}

export interface PpgRunStartResponse {
  message: string;
  mode: string;
  fsHz: number;
  strictLength: boolean;
  metric: string;
  athleteId: number;
}
