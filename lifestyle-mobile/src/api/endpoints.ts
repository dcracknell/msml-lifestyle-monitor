import apiClient from './client';
import {
  ActivityResponse,
  AthletesResponse,
  MessageResponse,
  MetricsResponse,
  NutritionResponse,
  NutritionSuggestionsResponse,
  NutritionLookupResponse,
  SessionPayload,
  ShareCoachesResponse,
  StreamHistoryResponse,
  StreamPublishResponse,
  StravaConnectResponse,
  StravaSyncResponse,
  VitalsResponse,
  WeightResponse,
} from './types';

function buildQuery(params?: Record<string, string | number | undefined | null>) {
  if (!params) return '';
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    searchParams.append(key, String(value));
  });
  const query = searchParams.toString();
  return query ? `?${query}` : '';
}

export const loginRequest = (payload: { email: string; password: string }) =>
  apiClient.post<SessionPayload>('/api/login', payload);

export const logoutRequest = () => apiClient.post('/api/login/logout');

export const signupRequest = (payload: {
  name: string;
  email: string;
  password: string;
  avatar?: string | null;
  avatarPhoto?: string | null;
}) =>
  apiClient.post<SessionPayload>('/api/signup', payload);

export const metricsRequest = (params?: { athleteId?: number }) =>
  apiClient.get<MetricsResponse>(`/api/metrics${buildQuery({ athleteId: params?.athleteId })}`);

export const activityRequest = (params?: { athleteId?: number }) =>
  apiClient.get<ActivityResponse>(`/api/activity${buildQuery({ athleteId: params?.athleteId })}`);

export const vitalsRequest = (params?: { athleteId?: number }) =>
  apiClient.get<VitalsResponse>(`/api/vitals${buildQuery({ athleteId: params?.athleteId })}`);

export const weightRequest = (params?: { athleteId?: number }) =>
  apiClient.get<WeightResponse>(`/api/weight${buildQuery({ athleteId: params?.athleteId })}`);

export const createWeightEntryRequest = (payload: { weight: number; unit?: 'kg' | 'lb'; date?: string }) =>
  apiClient.post('/api/weight', payload);

export const deleteWeightEntryRequest = (id: number) =>
  apiClient.delete<MessageResponse>(`/api/weight/${id}`);

export const nutritionRequest = (params?: { athleteId?: number; date?: string }) =>
  apiClient.get<NutritionResponse>(
    `/api/nutrition${buildQuery({ athleteId: params?.athleteId, date: params?.date })}`
  );

export const saveMacroTargetsRequest = (payload: {
  calories?: number | null;
  protein?: number | null;
  carbs?: number | null;
  fats?: number | null;
  date?: string;
  athleteId?: number;
}) => apiClient.post<MessageResponse>('/api/nutrition/macros', payload);

export const createNutritionEntryRequest = (payload: {
  name?: string;
  barcode?: string;
  type?: 'Food' | 'Liquid';
  calories?: number;
  protein?: number;
  carbs?: number;
  fats?: number;
  weightAmount?: number;
  weightUnit?: string;
  date?: string;
}) => apiClient.post<MessageResponse>('/api/nutrition', payload);

export const deleteNutritionEntryRequest = (entryId: number) =>
  apiClient.delete<MessageResponse>(`/api/nutrition/${entryId}`);

export const lookupNutritionRequest = (params: { barcode?: string; query?: string }) =>
  apiClient.get<NutritionLookupResponse>(
    `/api/nutrition/lookup${buildQuery({ barcode: params.barcode, q: params.query })}`
  );

export const searchNutritionRequest = (query: string) =>
  apiClient.get<NutritionSuggestionsResponse>(`/api/nutrition/search${buildQuery({ q: query })}`);

export const athletesRequest = () => apiClient.get<AthletesResponse>('/api/athletes');

export const shareCoachesRequest = () => apiClient.get<ShareCoachesResponse>('/api/share/coaches');

export const shareAccessRequest = (payload: { coachEmail?: string; coachId?: number }) =>
  apiClient.post<MessageResponse>('/api/share', payload);

export const promoteCoachRequest = (userId: number) =>
  apiClient.post<MessageResponse>('/api/admin/promote', { userId });

export const demoteCoachRequest = (userId: number) =>
  apiClient.post<MessageResponse>('/api/admin/demote', { userId });

export const deleteUserRequest = (userId: number) => apiClient.delete(`/api/admin/users/${userId}`);

export const resetUserPasswordRequest = (userId: number, password?: string) =>
  apiClient.post<MessageResponse>('/api/admin/reset-password', {
    userId,
    ...(password ? { password } : {}),
  });

export const updateProfileRequest = (payload: {
  name?: string;
  email?: string;
  password?: string;
  currentPassword: string;
  weightCategory?: string;
  stravaClientId?: string;
  stravaClientSecret?: string;
  stravaRedirectUri?: string;
  avatar?: string | null;
  avatarPhoto?: string | null;
  goalSleep?: number | null;
}) => apiClient.put<SessionPayload>('/api/profile', payload);

export const forgotPasswordRequest = (payload: { email: string }) =>
  apiClient.post<MessageResponse>('/api/password/forgot', payload);

export const resetPasswordRequest = (payload: { token: string; password: string }) =>
  apiClient.post<MessageResponse>('/api/password/reset', payload);

export const connectStravaRequest = () => apiClient.post<StravaConnectResponse>('/api/activity/strava/connect');

export const disconnectStravaRequest = () => apiClient.post<MessageResponse>('/api/activity/strava/disconnect');

export const syncStravaRequest = () => apiClient.post<StravaSyncResponse>('/api/activity/strava/sync');

export const publishStreamSamplesRequest = (payload: {
  metric: string;
  samples: { ts: number; value: number | null }[];
}) => apiClient.post<StreamPublishResponse>('/api/streams', payload);

export const streamHistoryRequest = (params: {
  metric: string;
  athleteId?: number;
  from?: number;
  to?: number;
  windowMs?: number;
  maxPoints?: number;
}) =>
  apiClient.get<StreamHistoryResponse>(
    `/api/streams${buildQuery({
      metric: params.metric,
      athleteId: params.athleteId,
      from: params.from,
      to: params.to,
      windowMs: params.windowMs,
      maxPoints: params.maxPoints,
    })}`
  );
