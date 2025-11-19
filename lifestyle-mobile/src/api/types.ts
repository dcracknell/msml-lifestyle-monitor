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

export interface StravaConnectResponse {
  url: string;
  expiresAt: string;
}

export interface StravaSyncResponse {
  imported: number;
  fetched: number;
  lastSync: string;
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
}

export interface VitalsStats {
  window: number;
  restingHrAvg: number | null;
  restingHrDelta: number | null;
  glucoseAvg: number | null;
  glucoseDelta: number | null;
  systolicAvg: number | null;
  diastolicAvg: number | null;
  hrvAvg: number | null;
  spo2Avg: number | null;
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
  count: number;
}

export interface NutritionTrendEntry {
  date: string;
  calories: number;
  protein: number;
  carbs: number;
  fats: number;
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
  calories?: number | null;
  protein?: number | null;
  carbs?: number | null;
  fats?: number | null;
  weightAmount?: number | null;
  weightUnit?: string | null;
}

export interface NutritionLookupResponse {
  product: NutritionLookupProduct | null;
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

export interface StreamPublishResponse {
  metric: string;
  accepted: number;
}
