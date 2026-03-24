import AsyncStorage from '@react-native-async-storage/async-storage';

export type SportId = 'run' | 'ride' | 'walk';
export type TrackingSessionStatus = 'idle' | 'recording' | 'paused';

export interface PhoneGeoPoint {
  latitude: number;
  longitude: number;
  timestamp: number;
  altitude?: number | null;
  accuracy?: number | null;
  speed?: number | null;
}

export interface ExerciseTrackingSplit {
  km: number;
  paceSeconds: number;
}

export interface ExerciseTrackingSnapshot {
  version: 1;
  sportId: SportId;
  startedAt: number;
  workoutSourceId: string;
  status: TrackingSessionStatus;
  sessionStartTs: number | null;
  elapsedBeforePauseMs: number;
  phoneDistanceMeters: number;
  phonePaceSeconds: number | null;
  phoneCurrentPaceSeconds: number | null;
  elevationGainMeters: number;
  gpsAccuracyMeters: number | null;
  routePoints: PhoneGeoPoint[];
  lastPhonePoint: PhoneGeoPoint | null;
  lastAltitude: number | null;
  isAutoPaused: boolean;
  stationarySinceTs: number | null;
  recentPaceWindow: Array<{ distanceKm: number; timestamp: number }>;
  lastKm: number;
  lastKmTimestamp: number;
  kmSplits: ExerciseTrackingSplit[];
  updatedAt: number;
}

const STORAGE_KEY = 'msml.exercise.tracking.snapshot';
const ROUTE_POINT_LIMIT = 500;
const ROLLING_PACE_WINDOW_MS = 30_000;
const ELEVATION_NOISE_FILTER_M = 2;
const AUTO_PAUSE_SPEED_THRESHOLD_MS = 0.5;
const AUTO_PAUSE_DELAY_MS = 4_000;
const PHONE_MIN_STEP_METERS = 1;
const PHONE_MAX_STEP_METERS = 300;
const PHONE_MAX_SPEED_MS = 40;

export function createExerciseTrackingSnapshot({
  sportId,
  startedAt,
  workoutSourceId,
}: {
  sportId: SportId;
  startedAt: number;
  workoutSourceId: string;
}): ExerciseTrackingSnapshot {
  return {
    version: 1,
    sportId,
    startedAt,
    workoutSourceId,
    status: 'recording',
    sessionStartTs: startedAt,
    elapsedBeforePauseMs: 0,
    phoneDistanceMeters: 0,
    phonePaceSeconds: null,
    phoneCurrentPaceSeconds: null,
    elevationGainMeters: 0,
    gpsAccuracyMeters: null,
    routePoints: [],
    lastPhonePoint: null,
    lastAltitude: null,
    isAutoPaused: false,
    stationarySinceTs: null,
    recentPaceWindow: [],
    lastKm: 0,
    lastKmTimestamp: 0,
    kmSplits: [],
    updatedAt: startedAt,
  };
}

export function pauseExerciseTrackingSnapshot(
  snapshot: ExerciseTrackingSnapshot | null,
  pausedAt = Date.now()
) {
  if (!snapshot) {
    return null;
  }
  const elapsedAddition =
    snapshot.status === 'recording' &&
    !snapshot.isAutoPaused &&
    snapshot.sessionStartTs !== null &&
    pausedAt > snapshot.sessionStartTs
      ? pausedAt - snapshot.sessionStartTs
      : 0;

  return {
    ...snapshot,
    status: 'paused' as const,
    sessionStartTs: null,
    elapsedBeforePauseMs: snapshot.elapsedBeforePauseMs + elapsedAddition,
    lastPhonePoint: null,
    recentPaceWindow: [],
    phoneCurrentPaceSeconds: null,
    isAutoPaused: false,
    stationarySinceTs: null,
    updatedAt: pausedAt,
  };
}

export function resumeExerciseTrackingSnapshot(
  snapshot: ExerciseTrackingSnapshot | null,
  resumedAt = Date.now()
) {
  if (!snapshot) {
    return null;
  }
  return {
    ...snapshot,
    status: 'recording' as const,
    sessionStartTs: resumedAt,
    lastPhonePoint: null,
    recentPaceWindow: [],
    phoneCurrentPaceSeconds: null,
    isAutoPaused: false,
    stationarySinceTs: null,
    updatedAt: resumedAt,
  };
}

export function stopExerciseTrackingSnapshot(
  snapshot: ExerciseTrackingSnapshot | null,
  stoppedAt = Date.now()
) {
  if (!snapshot) {
    return null;
  }
  const elapsedAddition =
    snapshot.status === 'recording' &&
    !snapshot.isAutoPaused &&
    snapshot.sessionStartTs !== null &&
    stoppedAt > snapshot.sessionStartTs
      ? stoppedAt - snapshot.sessionStartTs
      : 0;

  return {
    ...snapshot,
    status: 'idle' as const,
    sessionStartTs: null,
    elapsedBeforePauseMs: snapshot.elapsedBeforePauseMs + elapsedAddition,
    isAutoPaused: false,
    stationarySinceTs: null,
    updatedAt: stoppedAt,
  };
}

export function getTrackingDistanceKm(snapshot: ExerciseTrackingSnapshot | null) {
  if (!snapshot) {
    return null;
  }
  return snapshot.phoneDistanceMeters / 1000;
}

export function getTrackingElapsedMs(snapshot: ExerciseTrackingSnapshot | null, now = Date.now()) {
  if (!snapshot) {
    return 0;
  }
  if (snapshot.status !== 'recording' || snapshot.isAutoPaused || snapshot.sessionStartTs === null) {
    return snapshot.elapsedBeforePauseMs;
  }
  return snapshot.elapsedBeforePauseMs + Math.max(0, now - snapshot.sessionStartTs);
}

export function applyLocationPointToTrackingSnapshot(
  snapshot: ExerciseTrackingSnapshot,
  point: PhoneGeoPoint
): ExerciseTrackingSnapshot {
  if (snapshot.status !== 'recording') {
    return {
      ...snapshot,
      updatedAt: normalizeTimestamp(point.timestamp) ?? Date.now(),
    };
  }

  const pointTs = normalizeTimestamp(point.timestamp) ?? Date.now();
  const normalizedPoint: PhoneGeoPoint = {
    latitude: point.latitude,
    longitude: point.longitude,
    timestamp: pointTs,
    altitude: toFiniteNumber(point.altitude),
    accuracy: toFiniteNumber(point.accuracy),
    speed: toFiniteNumber(point.speed),
  };

  const previous = snapshot.lastPhonePoint;
  const timeDeltaSeconds =
    previous && pointTs > previous.timestamp
      ? Math.max(0.1, (pointTs - previous.timestamp) / 1000)
      : null;
  const deltaMeters = previous ? haversineDistanceMeters(previous, normalizedPoint) : null;
  const calcSpeedMs =
    deltaMeters !== null && timeDeltaSeconds !== null ? deltaMeters / timeDeltaSeconds : null;
  const pointSpeed = normalizedPoint.speed ?? null;
  const gpsSpeed = pointSpeed !== null && pointSpeed >= 0 ? pointSpeed : calcSpeedMs;

  let next = {
    ...snapshot,
    gpsAccuracyMeters: normalizedPoint.accuracy ?? snapshot.gpsAccuracyMeters,
    updatedAt: pointTs,
  };

  if (gpsSpeed !== null) {
    if (gpsSpeed < AUTO_PAUSE_SPEED_THRESHOLD_MS) {
      if (next.isAutoPaused) {
        next = {
          ...next,
          stationarySinceTs: next.stationarySinceTs ?? pointTs,
        };
      } else if (next.stationarySinceTs === null) {
        next = {
          ...next,
          stationarySinceTs: pointTs,
        };
      } else if (pointTs - next.stationarySinceTs >= AUTO_PAUSE_DELAY_MS) {
        const elapsedAddition =
          next.sessionStartTs !== null && pointTs > next.sessionStartTs
            ? pointTs - next.sessionStartTs
            : 0;
        next = {
          ...next,
          elapsedBeforePauseMs: next.elapsedBeforePauseMs + elapsedAddition,
          sessionStartTs: null,
          isAutoPaused: true,
        };
      }
    } else {
      next = {
        ...next,
        stationarySinceTs: null,
      };
      if (next.isAutoPaused) {
        next = {
          ...next,
          isAutoPaused: false,
          sessionStartTs: pointTs,
        };
      }
    }
  }

  if (next.isAutoPaused) {
    return {
      ...next,
      lastPhonePoint: normalizedPoint,
    };
  }

  let acceptPoint = !previous;
  if (previous && deltaMeters !== null && timeDeltaSeconds !== null) {
    const speedMs = deltaMeters / timeDeltaSeconds;
    if (
      Number.isFinite(deltaMeters) &&
      deltaMeters >= PHONE_MIN_STEP_METERS &&
      deltaMeters <= PHONE_MAX_STEP_METERS &&
      speedMs <= PHONE_MAX_SPEED_MS
    ) {
      next = {
        ...next,
        phoneDistanceMeters: next.phoneDistanceMeters + deltaMeters,
      };
      acceptPoint = true;
    } else if (Number.isFinite(deltaMeters) && deltaMeters > PHONE_MAX_STEP_METERS) {
      return {
        ...next,
        lastPhonePoint: normalizedPoint,
      };
    }
  }

  if (!acceptPoint) {
    return next;
  }

  const distanceKm = next.phoneDistanceMeters / 1000;
  const routePoints = appendRoutePoint(next.routePoints, normalizedPoint);
  const lastKmTimestamp = next.lastKmTimestamp === 0 ? pointTs : next.lastKmTimestamp;

  const elevation = updateElevation(next.lastAltitude, next.elevationGainMeters, normalizedPoint.altitude);
  const paceWindow = updatePaceWindow(next.recentPaceWindow, distanceKm, pointTs);
  const currentPaceSeconds = calculateRollingPaceSeconds(paceWindow);
  const splitState = updateSplits(next.lastKm, lastKmTimestamp, next.kmSplits, distanceKm, pointTs);
  const activeDurationMs =
    next.elapsedBeforePauseMs +
    (next.sessionStartTs !== null ? Math.max(0, pointTs - next.sessionStartTs) : 0);
  const averagePaceSeconds =
    distanceKm > 0.02 && activeDurationMs > 0
      ? Math.round((activeDurationMs / 1000) / distanceKm)
      : null;

  return {
    ...next,
    lastPhonePoint: normalizedPoint,
    routePoints,
    lastAltitude: elevation.lastAltitude,
    elevationGainMeters: elevation.elevationGainMeters,
    recentPaceWindow: paceWindow,
    phoneCurrentPaceSeconds: currentPaceSeconds,
    lastKm: splitState.lastKm,
    lastKmTimestamp: splitState.lastKmTimestamp,
    kmSplits: splitState.kmSplits,
    phonePaceSeconds: averagePaceSeconds,
  };
}

export async function loadStoredExerciseTrackingSnapshot() {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    return sanitizeSnapshot(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function saveExerciseTrackingSnapshot(snapshot: ExerciseTrackingSnapshot | null) {
  if (!snapshot) {
    await AsyncStorage.removeItem(STORAGE_KEY);
    return;
  }
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
}

export async function clearStoredExerciseTrackingSnapshot() {
  await AsyncStorage.removeItem(STORAGE_KEY);
}

function sanitizeSnapshot(value: unknown): ExerciseTrackingSnapshot | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;
  const sportId = record.sportId === 'run' || record.sportId === 'ride' || record.sportId === 'walk'
    ? record.sportId
    : null;
  const workoutSourceId = typeof record.workoutSourceId === 'string' ? record.workoutSourceId.trim() : '';
  const startedAt = normalizeTimestamp(record.startedAt);
  if (!sportId || !workoutSourceId || startedAt === null) {
    return null;
  }

  const status =
    record.status === 'recording' || record.status === 'paused' || record.status === 'idle'
      ? record.status
      : 'idle';

  return {
    version: 1,
    sportId,
    startedAt,
    workoutSourceId,
    status,
    sessionStartTs: normalizeTimestamp(record.sessionStartTs),
    elapsedBeforePauseMs: Math.max(0, Math.round(toFiniteNumber(record.elapsedBeforePauseMs) ?? 0)),
    phoneDistanceMeters: Math.max(0, toFiniteNumber(record.phoneDistanceMeters) ?? 0),
    phonePaceSeconds: toFiniteNumber(record.phonePaceSeconds),
    phoneCurrentPaceSeconds: toFiniteNumber(record.phoneCurrentPaceSeconds),
    elevationGainMeters: Math.max(0, toFiniteNumber(record.elevationGainMeters) ?? 0),
    gpsAccuracyMeters: toFiniteNumber(record.gpsAccuracyMeters),
    routePoints: sanitizeRoutePoints(record.routePoints),
    lastPhonePoint: sanitizePoint(record.lastPhonePoint),
    lastAltitude: toFiniteNumber(record.lastAltitude),
    isAutoPaused: record.isAutoPaused === true,
    stationarySinceTs: normalizeTimestamp(record.stationarySinceTs),
    recentPaceWindow: sanitizePaceWindow(record.recentPaceWindow),
    lastKm: Math.max(0, Math.round(toFiniteNumber(record.lastKm) ?? 0)),
    lastKmTimestamp: normalizeTimestamp(record.lastKmTimestamp) ?? 0,
    kmSplits: sanitizeSplits(record.kmSplits),
    updatedAt: normalizeTimestamp(record.updatedAt) ?? startedAt,
  };
}

function sanitizeRoutePoints(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => sanitizePoint(entry))
    .filter((entry): entry is PhoneGeoPoint => entry !== null)
    .slice(-ROUTE_POINT_LIMIT);
}

function sanitizePoint(value: unknown): PhoneGeoPoint | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value as Record<string, unknown>;
  const latitude = toFiniteNumber(record.latitude);
  const longitude = toFiniteNumber(record.longitude);
  const timestamp = normalizeTimestamp(record.timestamp);
  if (latitude === null || longitude === null || timestamp === null) {
    return null;
  }
  return {
    latitude,
    longitude,
    timestamp,
    altitude: toFiniteNumber(record.altitude),
    accuracy: toFiniteNumber(record.accuracy),
    speed: toFiniteNumber(record.speed),
  };
}

function sanitizePaceWindow(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => {
      if (!entry || typeof entry !== 'object') {
        return null;
      }
      const record = entry as Record<string, unknown>;
      const distanceKm = toFiniteNumber(record.distanceKm);
      const timestamp = normalizeTimestamp(record.timestamp);
      if (distanceKm === null || timestamp === null) {
        return null;
      }
      return { distanceKm, timestamp };
    })
    .filter((entry): entry is { distanceKm: number; timestamp: number } => entry !== null)
    .slice(-120);
}

function sanitizeSplits(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => {
      if (!entry || typeof entry !== 'object') {
        return null;
      }
      const record = entry as Record<string, unknown>;
      const km = toFiniteNumber(record.km);
      const paceSeconds = toFiniteNumber(record.paceSeconds);
      if (km === null || paceSeconds === null) {
        return null;
      }
      return {
        km: Math.max(0, Math.round(km)),
        paceSeconds: Math.max(0, Math.round(paceSeconds)),
      };
    })
    .filter((entry): entry is ExerciseTrackingSplit => entry !== null);
}

function appendRoutePoint(points: PhoneGeoPoint[], point: PhoneGeoPoint) {
  const lastPoint = points[points.length - 1];
  if (
    lastPoint &&
    lastPoint.latitude === point.latitude &&
    lastPoint.longitude === point.longitude &&
    lastPoint.timestamp === point.timestamp
  ) {
    return points;
  }
  const nextPoints = [...points, point];
  return nextPoints.length <= ROUTE_POINT_LIMIT
    ? nextPoints
    : nextPoints.slice(nextPoints.length - ROUTE_POINT_LIMIT);
}

function updateElevation(
  currentAltitude: number | null,
  currentGainMeters: number,
  nextAltitude: number | null | undefined
) {
  if (nextAltitude === null || nextAltitude === undefined || !Number.isFinite(nextAltitude)) {
    return {
      lastAltitude: currentAltitude,
      elevationGainMeters: currentGainMeters,
    };
  }

  if (currentAltitude === null) {
    return {
      lastAltitude: nextAltitude,
      elevationGainMeters: currentGainMeters,
    };
  }

  const delta = nextAltitude - currentAltitude;
  if (delta > ELEVATION_NOISE_FILTER_M) {
    return {
      lastAltitude: nextAltitude,
      elevationGainMeters: currentGainMeters + delta,
    };
  }
  if (delta < -ELEVATION_NOISE_FILTER_M) {
    return {
      lastAltitude: nextAltitude,
      elevationGainMeters: currentGainMeters,
    };
  }
  return {
    lastAltitude: currentAltitude,
    elevationGainMeters: currentGainMeters,
  };
}

function updatePaceWindow(
  currentWindow: Array<{ distanceKm: number; timestamp: number }>,
  distanceKm: number,
  timestamp: number
) {
  const cutoff = timestamp - ROLLING_PACE_WINDOW_MS;
  return [...currentWindow, { distanceKm, timestamp }].filter((entry) => entry.timestamp >= cutoff);
}

function calculateRollingPaceSeconds(window: Array<{ distanceKm: number; timestamp: number }>) {
  if (window.length < 2) {
    return null;
  }
  const oldest = window[0];
  const newest = window[window.length - 1];
  const windowDistKm = newest.distanceKm - oldest.distanceKm;
  const windowTimeMs = newest.timestamp - oldest.timestamp;
  if (windowDistKm <= 0.005 || windowTimeMs <= 0) {
    return null;
  }
  return Math.round((windowTimeMs / 1000) / windowDistKm);
}

function updateSplits(
  currentKm: number,
  currentKmTimestamp: number,
  currentSplits: ExerciseTrackingSplit[],
  distanceKm: number,
  timestamp: number
) {
  const nextKm = currentKm + 1;
  if (distanceKm < nextKm) {
    return {
      lastKm: currentKm,
      lastKmTimestamp: currentKmTimestamp,
      kmSplits: currentSplits,
    };
  }

  const splitTimeMs = currentKmTimestamp > 0 ? timestamp - currentKmTimestamp : 0;
  if (splitTimeMs <= 0) {
    return {
      lastKm: nextKm,
      lastKmTimestamp: timestamp,
      kmSplits: currentSplits,
    };
  }

  return {
    lastKm: nextKm,
    lastKmTimestamp: timestamp,
    kmSplits: [...currentSplits, { km: nextKm, paceSeconds: Math.round(splitTimeMs / 1000) }],
  };
}

function haversineDistanceMeters(start: PhoneGeoPoint, end: PhoneGeoPoint) {
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const earthRadiusMeters = 6371000;
  const dLat = toRadians(end.latitude - start.latitude);
  const dLon = toRadians(end.longitude - start.longitude);
  const lat1 = toRadians(start.latitude);
  const lat2 = toRadians(end.latitude);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(lat1) * Math.cos(lat2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusMeters * c;
}

function toFiniteNumber(value: unknown) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeTimestamp(value: unknown) {
  const numeric = toFiniteNumber(value);
  if (numeric === null || numeric <= 0) {
    return null;
  }
  return Math.round(numeric);
}
