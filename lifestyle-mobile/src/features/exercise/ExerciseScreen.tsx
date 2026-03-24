import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, StyleSheet, View, Pressable, ScrollView, Platform } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Svg, { Circle, Defs, FeBlend, FeGaussianBlur, Filter, Line, Polyline, Rect, Text as SvgText } from 'react-native-svg';

// react-native-maps — loaded dynamically so the app works on web and before native rebuild
let MapView: any = null;
let MapPolyline: any = null;
let MapMarker: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
  const RNMaps = require('react-native-maps');
  MapView = RNMaps.default ?? RNMaps.MapView;
  MapPolyline = RNMaps.Polyline;
  MapMarker = RNMaps.Marker;
} catch {
  // react-native-maps not yet built into native binary — SVG fallback is used
}

// expo-keep-awake — keeps screen on during active workouts
let activateKeepAwakeAsync: (() => Promise<void>) | null = null;
let deactivateKeepAwakeAsync: (() => Promise<void>) | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
  const KeepAwake = require('expo-keep-awake');
  activateKeepAwakeAsync = KeepAwake.activateKeepAwakeAsync ?? null;
  deactivateKeepAwakeAsync = KeepAwake.deactivateKeepAwakeAsync ?? null;
} catch { /* not available before native rebuild */ }

// expo-speech — audio km split announcements
let speechSpeak: ((text: string) => void) | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
  const Speech = require('expo-speech');
  speechSpeak = Speech.speak ?? Speech.default?.speak ?? null;
} catch { /* not available before native rebuild */ }

import {
  AppInput,
  AppText,
  TrendChart,
} from '../../components';
import {
  activityRequest,
  streamHistoryRequest,
} from '../../api/endpoints';
import { useAuth } from '../../providers/AuthProvider';
import { useSubject } from '../../providers/SubjectProvider';
import { useBluetooth } from '../../providers/BluetoothProvider';
import { useSyncQueue } from '../../providers/SyncProvider';
import { colors, spacing } from '../../theme';
import { formatDate, formatDateTime, formatDistance, formatPace, titleCase } from '../../utils/format';
import {
  startExerciseBackgroundLocationUpdates,
  stopExerciseBackgroundLocationUpdates,
} from './backgroundTracking';
import {
  applyLocationPointToTrackingSnapshot,
  clearStoredExerciseTrackingSnapshot,
  createExerciseTrackingSnapshot,
  getTrackingDistanceKm,
  getTrackingElapsedMs,
  loadStoredExerciseTrackingSnapshot,
  pauseExerciseTrackingSnapshot,
  type PhoneGeoPoint,
  resumeExerciseTrackingSnapshot,
  saveExerciseTrackingSnapshot,
  type SportId,
  stopExerciseTrackingSnapshot,
  type ExerciseTrackingSnapshot,
} from './trackingState';

interface SportOption {
  id: SportId;
  label: string;
  tagline: string;
  match: string;
}

type SessionState = 'idle' | 'recording' | 'paused';

type ExerciseAction = 'start' | 'pause' | 'resume' | 'stop';
type PhoneTrackerSource = 'expo-location' | 'geolocation';

const SPORT_OPTIONS: SportOption[] = [
  { id: 'run', label: 'Run', tagline: 'Outdoor effort', match: 'run' },
  { id: 'ride', label: 'Ride', tagline: 'Road cycling', match: 'ride' },
  { id: 'walk', label: 'Walk', tagline: 'Easy movement', match: 'walk' },
];

const DEVICE_METRICS = {
  distance: 'exercise.distance',
  pace: 'exercise.pace',
  heartRate: 'exercise.hr',
};

// ── Design tokens ────────────────────────────────────────────────────────────
const TEAL = '#00d2a5';
const ORANGE = '#ff9132';
const PURPLE = '#a080ff';
const GRAY = 'rgba(255,255,255,0.25)';

// ── Google Maps dark style (Android) ─────────────────────────────────────────
// Matches the app's navy night theme so the teal route line pops clearly.
const DARK_MAP_STYLE = [
  { elementType: 'geometry',                                      stylers: [{ color: '#1a2534' }] },
  { elementType: 'labels.text.fill',                              stylers: [{ color: '#8496b0' }] },
  { elementType: 'labels.text.stroke',                            stylers: [{ color: '#0d1927' }] },
  { featureType: 'administrative', elementType: 'geometry',       stylers: [{ visibility: 'off' }] },
  { featureType: 'poi',                                           stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'geometry.fill',            stylers: [{ color: '#253649' }] },
  { featureType: 'road', elementType: 'geometry.stroke',          stylers: [{ color: '#1a2a3e' }] },
  { featureType: 'road', elementType: 'labels.icon',              stylers: [{ visibility: 'off' }] },
  { featureType: 'road.highway', elementType: 'geometry.fill',    stylers: [{ color: '#2f4665' }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke',  stylers: [{ color: '#1e3452' }] },
  { featureType: 'transit',                                       stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'geometry',                stylers: [{ color: '#0d1b2a' }] },
  { featureType: 'water', elementType: 'labels.text.fill',        stylers: [{ color: '#3d5a7a' }] },
];

const WATCH_COMMAND_TIMEOUT_MS = 3500;
const PHONE_TRACKER_START_TIMEOUT_MS = 4000;
const PHONE_UPLOAD_INTERVAL_MS = 15_000;
const PHONE_UPLOAD_DISTANCE_DELTA_KM = 0.05;
const WATCH_AUTO_START_FRESH_WINDOW_MS = 15_000;
const EXERCISE_STREAM_WINDOW_MS = 21 * 24 * 60 * 60 * 1000;
const CALORIE_FACTORS: Record<SportId, number> = { run: 1.0, ride: 0.4, walk: 0.7 }; // kcal/kg/km
const CALORIE_BODY_WEIGHT_KG = 70; // default body weight estimate
const WORKOUT_NAME_MAX_LENGTH = 96;
const WORKOUT_NOTES_MAX_LENGTH = 500;

export function ExerciseScreen() {
  const navigation = useNavigation();
  const { user } = useAuth();
  const { subjectId } = useSubject();
  const { runOrQueue } = useSyncQueue();
  const queryClient = useQueryClient();
  const requestSubject = subjectId && subjectId !== user?.id ? subjectId : undefined;

  const {
    connectedDevice,
    recentSamples,
    sendCommand,
    manualPublish,
    setWorkoutMirrorSuppressed,
  } = useBluetooth();

  const { data, isFetching } = useQuery({
    queryKey: ['exercise', requestSubject || user?.id],
    queryFn: () => activityRequest({ athleteId: requestSubject }),
    enabled: Boolean(user?.id),
  });
  const { data: exerciseHrStreamData } = useQuery({
    queryKey: ['stream-history', 'exercise.hr', requestSubject || user?.id],
    queryFn: () =>
      streamHistoryRequest({
        metric: 'exercise.hr',
        athleteId: requestSubject,
        windowMs: EXERCISE_STREAM_WINDOW_MS,
        maxPoints: 240,
      }),
    enabled: Boolean(user?.id),
  });
  const { data: exerciseDistanceStreamData } = useQuery({
    queryKey: ['stream-history', 'exercise.distance', requestSubject || user?.id],
    queryFn: () =>
      streamHistoryRequest({
        metric: 'exercise.distance',
        athleteId: requestSubject,
        windowMs: EXERCISE_STREAM_WINDOW_MS,
        maxPoints: 240,
      }),
    enabled: Boolean(user?.id),
  });

  const [selectedSport, setSelectedSport] = useState<SportId>('run');
  const [sessionState, setSessionState] = useState<SessionState>('idle');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [controlLoading, setControlLoading] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [workoutName, setWorkoutName] = useState(() => buildDefaultWorkoutName('Run'));
  const [workoutNotes, setWorkoutNotes] = useState('');
  const [phoneDistanceKm, setPhoneDistanceKm] = useState<number | null>(null);
  const [phonePaceSeconds, setPhonePaceSeconds] = useState<number | null>(null);
  const [phoneCurrentPaceSeconds, setPhoneCurrentPaceSeconds] = useState<number | null>(null);
  const [elevationGainMeters, setElevationGainMeters] = useState(0);
  const [gpsAccuracyMeters, setGpsAccuracyMeters] = useState<number | null>(null);
  const [isPhoneTracking, setIsPhoneTracking] = useState(false);
  const [phoneTrackingSource, setPhoneTrackingSource] = useState<PhoneTrackerSource | null>(null);
  const [phoneTrackingError, setPhoneTrackingError] = useState<string | null>(null);
  const [routePoints, setRoutePoints] = useState<PhoneGeoPoint[]>([]);
  const [isAutoPaused, setIsAutoPaused] = useState(false);
  const [kmSplits, setKmSplits] = useState<Array<{ km: number; paceSeconds: number }>>([]);

  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const elapsedBeforePauseRef = useRef(0);
  const sessionStartRef = useRef<number | null>(null);
  const workoutStartedAtRef = useRef<number | null>(null);
  const workoutSourceIdRef = useRef<string | null>(null);
  const trackingSnapshotRef = useRef<ExerciseTrackingSnapshot | null>(null);
  const sessionStateRef = useRef<SessionState>('idle');
  const locationWatcherRef = useRef<null | { stop: () => void }>(null);
  const lastPhoneUploadRef = useRef({ ts: 0, distanceKm: 0 });
  const phoneDistanceRef = useRef<number | null>(null);
  const phonePaceRef = useRef<number | null>(null);
  const elevationGainRef = useRef(0);

  const sportConfig = useMemo(() => {
    return SPORT_OPTIONS.find((option) => option.id === selectedSport) ?? SPORT_OPTIONS[0];
  }, [selectedSport]);

  const sessions = data?.sessions || [];
  const lastSessionForSport = useMemo(() => {
    return sessions.find((session) => session.sportType?.toLowerCase().includes(sportConfig.match));
  }, [sessions, sportConfig.match]);

  useEffect(() => {
    setWorkoutName((current) => {
      const trimmed = current.trim();
      if (!trimmed || isAutoWorkoutName(trimmed)) {
        return buildDefaultWorkoutName(sportConfig.label);
      }
      return current;
    });
  }, [sportConfig.label]);

  useEffect(() => {
    setWorkoutMirrorSuppressed(sessionState !== 'idle');
    return () => {
      setWorkoutMirrorSuppressed(false);
    };
  }, [sessionState, setWorkoutMirrorSuppressed]);

  // Keep screen on whenever a session is active (recording or paused)
  useEffect(() => {
    if (sessionState !== 'idle') {
      activateKeepAwakeAsync?.().catch(() => {});
    } else {
      deactivateKeepAwakeAsync?.().catch(() => {});
    }
    return () => {
      deactivateKeepAwakeAsync?.().catch(() => {});
    };
  }, [sessionState]);

  const applyTrackingSnapshot = useCallback((snapshot: ExerciseTrackingSnapshot | null) => {
    trackingSnapshotRef.current = snapshot;
    elapsedBeforePauseRef.current = snapshot?.elapsedBeforePauseMs ?? 0;
    sessionStartRef.current = snapshot?.sessionStartTs ?? null;
    elevationGainRef.current = snapshot?.elevationGainMeters ?? 0;
    phoneDistanceRef.current = getTrackingDistanceKm(snapshot);
    phonePaceRef.current = snapshot?.phonePaceSeconds ?? null;

    setPhoneDistanceKm(getTrackingDistanceKm(snapshot));
    setPhonePaceSeconds(snapshot?.phonePaceSeconds ?? null);
    setPhoneCurrentPaceSeconds(snapshot?.phoneCurrentPaceSeconds ?? null);
    setElevationGainMeters(Math.round(snapshot?.elevationGainMeters ?? 0));
    setGpsAccuracyMeters(snapshot?.gpsAccuracyMeters ?? null);
    setIsAutoPaused(snapshot?.isAutoPaused ?? false);
    setRoutePoints(snapshot?.routePoints ?? []);
    setKmSplits(snapshot?.kmSplits ?? []);

    if (snapshot && sessionStateRef.current !== 'idle') {
      setElapsedMs(getTrackingElapsedMs(snapshot));
    }
  }, []);

  const persistTrackingSnapshot = useCallback((snapshot: ExerciseTrackingSnapshot | null) => {
    applyTrackingSnapshot(snapshot);
    return saveExerciseTrackingSnapshot(snapshot).catch(() => {});
  }, [applyTrackingSnapshot]);

  const restorePersistedTrackingSnapshot = useCallback(async () => {
    const expectedSourceId = workoutSourceIdRef.current;
    if (!expectedSourceId) {
      return null;
    }

    const snapshot = await loadStoredExerciseTrackingSnapshot();
    if (!snapshot || snapshot.workoutSourceId !== expectedSourceId) {
      return null;
    }

    applyTrackingSnapshot(snapshot);
    return snapshot;
  }, [applyTrackingSnapshot]);

  const maybeStartBackgroundTracking = useCallback(
    async (snapshot: ExerciseTrackingSnapshot) => {
      const result = await startExerciseBackgroundLocationUpdates(snapshot);
      if (result.started) {
        return null;
      }
      if (result.reason === 'background-denied') {
        return 'Background tracking is off. Keep the app open for full phone GPS distance.';
      }
      if (result.reason === 'unsupported' || result.reason === 'start-failed') {
        return 'Background tracking is unavailable in this build. Keep the app open for full phone GPS distance.';
      }
      return null;
    },
    []
  );

  const uploadPhoneMetrics = useCallback(
    async (distanceKm: number, paceSeconds: number | null, force = false) => {
      if (!Number.isFinite(distanceKm) || distanceKm <= 0) {
        return;
      }
      const now = Date.now();
      if (!force) {
        const elapsedSinceLastUpload = now - lastPhoneUploadRef.current.ts;
        const distanceDelta = Math.abs(distanceKm - lastPhoneUploadRef.current.distanceKm);
        if (
          elapsedSinceLastUpload < PHONE_UPLOAD_INTERVAL_MS &&
          distanceDelta < PHONE_UPLOAD_DISTANCE_DELTA_KM
        ) {
          return;
        }
      }
      lastPhoneUploadRef.current = {
        ts: now,
        distanceKm,
      };
      const localDate = toLocalDateKey(new Date(now));

      try {
        await manualPublish(distanceKm, DEVICE_METRICS.distance, {
          localDate,
          skipWorkoutMirror: true,
        });
        if (paceSeconds !== null && Number.isFinite(paceSeconds)) {
          await manualPublish(paceSeconds, DEVICE_METRICS.pace, {
            localDate,
            skipWorkoutMirror: true,
          });
        }
      } catch (error) {
        setPhoneTrackingError(error instanceof Error ? error.message : 'Unable to upload phone run metrics.');
      }
    },
    [manualPublish]
  );

  const handlePhoneLocationPoint = useCallback(
    (point: PhoneGeoPoint) => {
      if (sessionStateRef.current !== 'recording') {
        return;
      }

      const startedAt =
        workoutStartedAtRef.current && workoutStartedAtRef.current > 0
          ? workoutStartedAtRef.current
          : Date.now();
      const sourceId =
        workoutSourceIdRef.current || buildWorkoutSourceId(sportConfig.id, startedAt);
      if (!workoutStartedAtRef.current) {
        workoutStartedAtRef.current = startedAt;
      }
      if (!workoutSourceIdRef.current) {
        workoutSourceIdRef.current = sourceId;
      }

      const currentSnapshot =
        trackingSnapshotRef.current ||
        createExerciseTrackingSnapshot({
          sportId: sportConfig.id,
          startedAt,
          workoutSourceId: sourceId,
        });
      const nextSnapshot = applyLocationPointToTrackingSnapshot(currentSnapshot, point);
      const previousDistanceKm = getTrackingDistanceKm(currentSnapshot) ?? 0;
      const nextDistanceKm = getTrackingDistanceKm(nextSnapshot) ?? 0;
      const previousSplitCount = currentSnapshot.kmSplits.length;

      void persistTrackingSnapshot(nextSnapshot);

      if (nextSnapshot.kmSplits.length > previousSplitCount) {
        const split = nextSnapshot.kmSplits[nextSnapshot.kmSplits.length - 1];
        const paceMin = Math.floor(split.paceSeconds / 60);
        const paceSec = split.paceSeconds % 60;
        const paceStr =
          paceSec > 0 ? `${paceMin} minutes ${paceSec} seconds` : `${paceMin} minutes`;
        speechSpeak?.(
          `${split.km} kilometre${split.km > 1 ? 's' : ''}. Pace ${paceStr} per kilometre.`
        );
      }

      if (nextDistanceKm > previousDistanceKm) {
        void uploadPhoneMetrics(nextDistanceKm, nextSnapshot.phonePaceSeconds);
      }
    },
    [persistTrackingSnapshot, sportConfig.id, uploadPhoneMetrics]
  );

  const stopPhoneTracking = useCallback(() => {
    locationWatcherRef.current?.stop();
    locationWatcherRef.current = null;
    setIsPhoneTracking(false);
    setPhoneTrackingSource(null);
    void stopExerciseBackgroundLocationUpdates();
  }, []);

  const resetPhoneTracking = useCallback(() => {
    stopPhoneTracking();
    lastPhoneUploadRef.current = { ts: 0, distanceKm: 0 };
    elevationGainRef.current = 0;
    applyTrackingSnapshot(null);
    setPhoneTrackingError(null);
    void clearStoredExerciseTrackingSnapshot();
  }, [applyTrackingSnapshot, stopPhoneTracking]);

  const startPhoneTracking = useCallback(async () => {
    if (locationWatcherRef.current) {
      return true;
    }
    setPhoneTrackingError(null);
    const createPoint = (
      latitude: number | null | undefined,
      longitude: number | null | undefined,
      timestamp?: number | null,
      altitude?: number | null,
      accuracy?: number | null,
      speed?: number | null,
    ) => {
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        return;
      }
      handlePhoneLocationPoint({
        latitude: latitude as number,
        longitude: longitude as number,
        timestamp: Number.isFinite(timestamp as number) ? Math.round(timestamp as number) : Date.now(),
        altitude: Number.isFinite(altitude as number) ? (altitude as number) : undefined,
        accuracy: Number.isFinite(accuracy as number) ? (accuracy as number) : undefined,
        speed: Number.isFinite(speed as number) ? (speed as number) : undefined,
      });
    };

    let lastError: string | null = null;

    try {
      const expoLocation = loadExpoLocationModule();
      if (expoLocation?.requestForegroundPermissionsAsync && expoLocation?.watchPositionAsync) {
        const permission = await expoLocation.requestForegroundPermissionsAsync();
        if (permission?.status !== 'granted') {
          throw new Error('Location permission is required to track the run with your phone.');
        }
        const accuracy =
          expoLocation?.Accuracy?.BestForNavigation ??
          expoLocation?.Accuracy?.Highest ??
          expoLocation?.Accuracy?.High ??
          expoLocation?.Accuracy?.Balanced ??
          3;
        const subscription = await expoLocation.watchPositionAsync(
          {
            accuracy,
            timeInterval: 2000,
            distanceInterval: 2,
            mayShowUserSettingsDialog: true,
          },
          (location: any) => {
            createPoint(
              location?.coords?.latitude,
              location?.coords?.longitude,
              location?.timestamp ?? Date.now(),
              location?.coords?.altitude,
              location?.coords?.accuracy,
              location?.coords?.speed,
            );
          }
        );
        locationWatcherRef.current = {
          stop: () => {
            if (typeof subscription?.remove === 'function') {
              subscription.remove();
            }
          },
        };
        setIsPhoneTracking(true);
        setPhoneTrackingSource('expo-location');
        return true;
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'Unable to start phone GPS tracking.';
    }

    if (typeof navigator !== 'undefined' && navigator?.geolocation?.watchPosition) {
      const watchId = navigator.geolocation.watchPosition(
        (position) => {
          createPoint(
            position?.coords?.latitude,
            position?.coords?.longitude,
            position?.timestamp ?? Date.now(),
            position?.coords?.altitude,
            position?.coords?.accuracy,
            position?.coords?.speed,
          );
        },
        (geoError) => {
          setPhoneTrackingError(geoError?.message || 'Phone location tracking failed.');
        },
        {
          enableHighAccuracy: true,
          timeout: 20000,
          maximumAge: 1000,
        }
      );
      locationWatcherRef.current = {
        stop: () => navigator.geolocation.clearWatch(watchId),
      };
      setIsPhoneTracking(true);
      setPhoneTrackingSource('geolocation');
      return true;
    }

    setPhoneTrackingError(
      lastError ||
        'Phone location tracking is unavailable. Install expo-location and rebuild to enable GPS run tracking.'
    );
    setIsPhoneTracking(false);
    setPhoneTrackingSource(null);
    return false;
  }, [handlePhoneLocationPoint]);

  const watchMetrics = useMemo(() => {
    const result: Record<keyof typeof DEVICE_METRICS, number | null> = {
      distance: null,
      pace: null,
      heartRate: null,
    };
    for (let index = recentSamples.length - 1; index >= 0; index -= 1) {
      const sample = recentSamples[index];
      const numericValue = Number.isFinite(sample.value as number) ? (sample.value as number) : null;
      if (numericValue === null) {
        continue;
      }

      if (result.distance === null && isWatchDistanceMetric(sample.metric)) {
        result.distance = normalizeDistanceSample(sample.metric, numericValue);
      }
      if (result.pace === null && (isWatchPaceMetric(sample.metric) || isWatchSpeedMetric(sample.metric))) {
        result.pace = normalizePaceSample(sample.metric, numericValue);
      }
      if (result.heartRate === null && isWatchHeartRateMetric(sample.metric)) {
        result.heartRate = numericValue;
      }
      if (result.distance !== null && result.pace !== null && result.heartRate !== null) {
        break;
      }
    }
    return result;
  }, [recentSamples]);
  const latestWatchSignalTs = useMemo(() => {
    return recentSamples.reduce((latest, sample) => {
      if (
        (isWatchDistanceMetric(sample.metric) ||
          isWatchPaceMetric(sample.metric) ||
          isWatchSpeedMetric(sample.metric) ||
          isWatchHeartRateMetric(sample.metric)) &&
        Number.isFinite(sample.ts) &&
        sample.ts > latest
      ) {
        return sample.ts;
      }
      return latest;
    }, 0);
  }, [recentSamples]);

  const liveDistanceKm = [watchMetrics.distance, phoneDistanceKm]
    .filter((value): value is number => value !== null && Number.isFinite(value))
    .reduce((maxValue, value) => Math.max(maxValue, value), 0);
  const fallbackDistanceKm = lastSessionForSport?.distance
    ? (lastSessionForSport.distance || 0) / 1000
    : null;
  const displayDistanceKm = liveDistanceKm > 0 ? liveDistanceKm : fallbackDistanceKm;
  // During recording show current (rolling 30 s) pace like Strava; otherwise show average
  const displayPaceSeconds =
    sessionState === 'recording'
      ? (watchMetrics.pace !== null
          ? watchMetrics.pace
          : phoneCurrentPaceSeconds !== null
          ? phoneCurrentPaceSeconds
          : phonePaceSeconds !== null
          ? phonePaceSeconds
          : null)
      : (watchMetrics.pace !== null
          ? watchMetrics.pace
          : phonePaceSeconds !== null
          ? phonePaceSeconds
          : lastSessionForSport?.averagePace ?? null);
  const avgPaceSeconds =
    watchMetrics.pace !== null
      ? watchMetrics.pace
      : phonePaceSeconds !== null
      ? phonePaceSeconds
      : lastSessionForSport?.averagePace ?? null;
  const liveCalories =
    liveDistanceKm > 0
      ? Math.round(liveDistanceKm * CALORIE_BODY_WEIGHT_KG * CALORIE_FACTORS[selectedSport])
      : null;
  const displayHeartRate =
    watchMetrics.heartRate !== null ? watchMetrics.heartRate : lastSessionForSport?.averageHr ?? null;
  const heartRateTrend = useMemo(
    () =>
      (exerciseHrStreamData?.points || [])
        .filter((point) => point.value !== null && Number.isFinite(point.value as number))
        .slice(-32)
        .map((point) => ({
          label: formatDate(new Date(point.ts).toISOString(), 'MMM D HH:mm'),
          value: Math.round(point.value as number),
        })),
    [exerciseHrStreamData?.points]
  );
  const distanceTrend = useMemo(
    () =>
      (exerciseDistanceStreamData?.points || [])
        .filter((point) => point.value !== null && Number.isFinite(point.value as number))
        .slice(-32)
        .map((point) => {
          const raw = point.value as number;
          const km = raw > 500 ? raw / 1000 : raw;
          return {
            label: formatDate(new Date(point.ts).toISOString(), 'MMM D HH:mm'),
            value: Math.round(km * 100) / 100,
          };
        }),
    [exerciseDistanceStreamData?.points]
  );
  const hasWatchSignal =
    watchMetrics.distance !== null || watchMetrics.pace !== null || watchMetrics.heartRate !== null;
  const hasPhoneSignal = phoneDistanceKm !== null || isPhoneTracking;
  const liveSourceLabel = hasWatchSignal && hasPhoneSignal
    ? 'Wearable + phone'
    : hasWatchSignal
    ? 'Wearable'
    : hasPhoneSignal
    ? 'Phone GPS'
    : 'Last session';
  const heroStatusCopy =
    sessionState === 'recording'
      ? `Tracking live from ${liveSourceLabel === 'Last session' ? 'phone GPS' : liveSourceLabel.toLowerCase()}.`
      : sessionState === 'paused'
      ? 'Workout paused. Resume when you are ready.'
      : connectedDevice
      ? 'Ready to record with phone GPS and wearable data.'
      : 'Ready to record with phone GPS.';
  const routeTitle = sessionState === 'idle' ? 'Route map' : 'Live route';
  const routeSubtitle =
    sessionState === 'recording'
      ? routePoints.length >= 2
        ? 'Your GPS path updates as you move.'
        : 'Waiting for the first clean GPS points.'
      : sessionState === 'paused'
      ? 'Route capture is paused until you resume.'
      : 'Start a session to draw a live route map.';
  const gpsAccuracyLabel =
    gpsAccuracyMeters == null
      ? '--'
      : gpsAccuracyMeters <= 10
      ? `±${Math.round(gpsAccuracyMeters)} m ●`
      : gpsAccuracyMeters <= 30
      ? `±${Math.round(gpsAccuracyMeters)} m ◑`
      : `±${Math.round(gpsAccuracyMeters)} m ○`;

  const routeSummary = [
    {
      label: 'Status',
      value: sessionState === 'idle' ? 'Ready' : isAutoPaused ? 'Auto-paused' : titleCase(sessionState),
    },
    { label: 'Source', value: liveSourceLabel },
    { label: 'GPS accuracy', value: gpsAccuracyLabel },
    { label: 'Elevation gain', value: elevationGainMeters > 0 ? `${elevationGainMeters} m` : '--' },
    { label: 'Calories', value: liveCalories !== null ? `${liveCalories} kcal` : '--' },
  ];
  const trainingSnapshot = [
    { label: 'This week', value: formatKilometers(data?.summary?.weeklyDistanceKm) },
    { label: 'Duration', value: formatDurationMinutes(data?.summary?.weeklyDurationMin) },
    { label: 'Load', value: formatWholeNumber(data?.summary?.trainingLoad) },
    { label: 'Avg pace', value: formatPace(data?.summary?.avgPaceSeconds) },
  ];

  useEffect(() => {
    sessionStateRef.current = sessionState;
  }, [sessionState]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        void restorePersistedTrackingSnapshot();
      }
    });

    return () => {
      subscription.remove();
    };
  }, [restorePersistedTrackingSnapshot]);

  useFocusEffect(
    useCallback(() => {
      (navigation as any)?.getParent?.()?.closeDrawer?.();
      return undefined;
    }, [navigation])
  );

  useEffect(() => {
    phoneDistanceRef.current = phoneDistanceKm;
    phonePaceRef.current = phonePaceSeconds;
  }, [phoneDistanceKm, phonePaceSeconds]);

  const invalidateActivityData = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['activity'] }),
      queryClient.invalidateQueries({ queryKey: ['exercise'] }),
      queryClient.invalidateQueries({ queryKey: ['roster'] }),
    ]);
  }, [queryClient]);

  const saveFinishedWorkout = useCallback(
    async ({
      endedAt,
      elapsedMilliseconds,
      distanceKm,
      paceSeconds,
      heartRate,
    }: {
      endedAt: number;
      elapsedMilliseconds: number;
      distanceKm: number | null;
      paceSeconds: number | null;
      heartRate: number | null;
    }) => {
      const movingTimeSeconds = Math.max(1, Math.round(elapsedMilliseconds / 1000));
      const startTs =
        workoutStartedAtRef.current && workoutStartedAtRef.current > 0
          ? workoutStartedAtRef.current
          : Math.max(0, endedAt - elapsedMilliseconds);
      const sourceId =
        workoutSourceIdRef.current || buildWorkoutSourceId(sportConfig.id, startTs);
      workoutSourceIdRef.current = sourceId;
      const normalizedWorkoutName = normalizeWorkoutName(workoutName, sportConfig.label);
      const normalizedWorkoutNotes = normalizeWorkoutNotes(workoutNotes);

      const workoutPayload = {
        sourceId,
        name: normalizedWorkoutName,
        notes: normalizedWorkoutNotes,
        sportType: sportConfig.label,
        startTime: new Date(startTs).toISOString(),
        endTime: new Date(endedAt).toISOString(),
        distanceMeters:
          distanceKm !== null && Number.isFinite(distanceKm) && distanceKm > 0
            ? Math.round(distanceKm * 1000)
            : null,
        movingTimeSeconds,
        elapsedTimeSeconds: movingTimeSeconds,
        averageHr:
          heartRate !== null && Number.isFinite(heartRate) && heartRate > 0
            ? Math.round(heartRate)
            : null,
        averagePace:
          paceSeconds !== null && Number.isFinite(paceSeconds) && paceSeconds > 0
            ? Math.round(paceSeconds)
            : null,
        elevationGain: elevationGainRef.current > 0 ? Math.round(elevationGainRef.current) : null,
        calories:
          distanceKm !== null && distanceKm > 0
            ? Math.round(distanceKm * CALORIE_BODY_WEIGHT_KG * CALORIE_FACTORS[sportConfig.id])
            : null,
      };

      const workoutResult = await runOrQueue({
        id: `workout:${sourceId}`,
        endpoint: '/api/streams/workouts',
        payload: { workouts: [workoutPayload] },
        description: `Finished ${sportConfig.label.toLowerCase()} workout`,
      });

      if (workoutResult.status === 'sent') {
        await invalidateActivityData();
      }

      return {
        sourceId,
        name: normalizedWorkoutName,
        workoutStatus: workoutResult.status,
      };
    },
    [invalidateActivityData, runOrQueue, sportConfig.id, sportConfig.label, workoutName, workoutNotes]
  );

  useEffect(() => {
    if (sessionState !== 'idle' || latestWatchSignalTs <= 0) {
      return;
    }
    const ageMs = Date.now() - latestWatchSignalTs;
    if (ageMs < 0 || ageMs > WATCH_AUTO_START_FRESH_WINDOW_MS) {
      return;
    }
    const startedAt = Date.now();
    elapsedBeforePauseRef.current = 0;
    sessionStartRef.current = startedAt;
    workoutStartedAtRef.current = startedAt;
    const sourceId = buildWorkoutSourceId(sportConfig.id, startedAt);
    workoutSourceIdRef.current = sourceId;
    const snapshot = createExerciseTrackingSnapshot({
      sportId: sportConfig.id,
      startedAt,
      workoutSourceId: sourceId,
    });
    void persistTrackingSnapshot(snapshot);
    setElapsedMs(0);
    setSessionState('recording');
    sessionStateRef.current = 'recording';
    setFeedback('Workout data detected from watch. Recording started automatically.');
    void startPhoneTracking();
    void maybeStartBackgroundTracking(snapshot);
  }, [
    latestWatchSignalTs,
    maybeStartBackgroundTracking,
    persistTrackingSnapshot,
    sessionState,
    sportConfig.id,
    startPhoneTracking,
  ]);

  useEffect(() => {
    if (sessionState !== 'recording') {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      return;
    }
    timerRef.current = setInterval(() => {
      const startTs = sessionStartRef.current || Date.now();
      setElapsedMs(elapsedBeforePauseRef.current + (Date.now() - startTs));
    }, 1000);
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [sessionState]);

  const sendExerciseCommand = async (action: ExerciseAction, nextState: SessionState, resetTimer?: boolean) => {
    setControlLoading(true);
    let watchNote: string | null = null;
    let trackingNote: string | null = null;
    try {
      const stopRequested = nextState === 'idle';
      const endedAt = stopRequested ? Date.now() : 0;
      const expectedSourceId = workoutSourceIdRef.current;
      const storedSnapshot = stopRequested ? await loadStoredExerciseTrackingSnapshot() : null;
      const matchingStoredSnapshot =
        storedSnapshot && (!expectedSourceId || storedSnapshot.workoutSourceId === expectedSourceId)
          ? storedSnapshot
          : null;
      const trackingSnapshotForStop =
        matchingStoredSnapshot && trackingSnapshotRef.current
          ? (getTrackingDistanceKm(matchingStoredSnapshot) ?? 0) >=
            (getTrackingDistanceKm(trackingSnapshotRef.current) ?? 0)
            ? matchingStoredSnapshot
            : trackingSnapshotRef.current
          : matchingStoredSnapshot || trackingSnapshotRef.current;
      const stoppedTrackingSnapshot = stopRequested
        ? stopExerciseTrackingSnapshot(trackingSnapshotForStop, endedAt || Date.now())
        : null;
      const elapsedAtStop = stopRequested
        ? Math.max(
            stoppedTrackingSnapshot ? getTrackingElapsedMs(stoppedTrackingSnapshot, endedAt || Date.now()) : 0,
            elapsedBeforePauseRef.current +
              (sessionStartRef.current ? Math.max(0, endedAt - sessionStartRef.current) : 0)
          )
        : 0;
      const persistedDistance = getTrackingDistanceKm(stoppedTrackingSnapshot);
      const finalDistanceCandidates = [
        liveDistanceKm > 0 ? liveDistanceKm : null,
        phoneDistanceRef.current,
        persistedDistance,
      ].filter((value): value is number => value !== null && Number.isFinite(value) && value > 0);
      const finalDistance = finalDistanceCandidates.length ? Math.max(...finalDistanceCandidates) : null;
      const finalPace =
        stopRequested && watchMetrics.pace !== null
          ? watchMetrics.pace
          : stopRequested
          ? stoppedTrackingSnapshot?.phonePaceSeconds ?? phonePaceRef.current
          : null;
      const finalHeartRate = stopRequested ? watchMetrics.heartRate : null;

      // Make controls respond immediately, then complete device operations in the background flow below.
      setSessionState(nextState);
      sessionStateRef.current = nextState;

      let watchCommandTask: Promise<void> | null = null;
      if (connectedDevice) {
        watchCommandTask = withTimeout(
          sendCommand(
            JSON.stringify({
              type: 'exercise-control',
              action,
              sport: sportConfig.id,
              timestamp: new Date().toISOString(),
              durationMs: elapsedMs,
            })
          ),
          WATCH_COMMAND_TIMEOUT_MS,
          'Watch command timed out.'
        );
      } else if (action === 'start') {
        watchNote = 'Watch not connected. Tracking with phone GPS only.';
      }

      if (resetTimer) {
        const startedAt = Date.now();
        elapsedBeforePauseRef.current = 0;
        sessionStartRef.current = startedAt;
        workoutStartedAtRef.current = startedAt;
        const sourceId = buildWorkoutSourceId(sportConfig.id, startedAt);
        workoutSourceIdRef.current = sourceId;
        const snapshot = createExerciseTrackingSnapshot({
          sportId: sportConfig.id,
          startedAt,
          workoutSourceId: sourceId,
        });
        void persistTrackingSnapshot(snapshot);
        setElapsedMs(0);
      } else if (nextState === 'recording') {
        const resumedAt = Date.now();
        sessionStartRef.current = resumedAt;
        const startedAt =
          workoutStartedAtRef.current && workoutStartedAtRef.current > 0
            ? workoutStartedAtRef.current
            : resumedAt;
        workoutStartedAtRef.current = startedAt;
        const sourceId =
          workoutSourceIdRef.current || buildWorkoutSourceId(sportConfig.id, startedAt);
        workoutSourceIdRef.current = sourceId;
        const snapshot = resumeExerciseTrackingSnapshot(
          trackingSnapshotRef.current ||
            createExerciseTrackingSnapshot({
              sportId: sportConfig.id,
              startedAt,
              workoutSourceId: sourceId,
            }),
          resumedAt
        );
        void persistTrackingSnapshot(snapshot);
      } else if (nextState === 'paused') {
        const pausedAt = Date.now();
        elapsedBeforePauseRef.current += pausedAt - (sessionStartRef.current || pausedAt);
        sessionStartRef.current = null;
        const snapshot = pauseExerciseTrackingSnapshot(trackingSnapshotRef.current, pausedAt);
        void persistTrackingSnapshot(snapshot);
      } else {
        sessionStartRef.current = null;
        setElapsedMs(0);
        void persistTrackingSnapshot(stoppedTrackingSnapshot);
      }

      if (nextState === 'recording') {
        let startedPhoneTracking = false;
        try {
          startedPhoneTracking = await withTimeout(
            startPhoneTracking(),
            PHONE_TRACKER_START_TIMEOUT_MS,
            'Phone GPS startup timed out.'
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Phone GPS tracking unavailable.';
          setPhoneTrackingError(message);
          trackingNote = message;
        }
        if (startedPhoneTracking && trackingSnapshotRef.current) {
          const backgroundNote = await maybeStartBackgroundTracking(trackingSnapshotRef.current);
          if (backgroundNote) {
            trackingNote = trackingNote ? `${trackingNote} ${backgroundNote}` : backgroundNote;
          }
        }
        if (!startedPhoneTracking && !trackingNote && !connectedDevice) {
          trackingNote = 'Phone GPS tracking unavailable.';
        }
      } else {
        stopPhoneTracking();
      }

      if (watchCommandTask) {
        try {
          await watchCommandTask;
        } catch (error) {
          watchNote =
            error instanceof Error
              ? `${error.message} Continuing with phone tracking.`
              : 'Unable to control the watch. Continuing with phone tracking.';
        }
      }

      if (nextState === 'idle') {
        if (finalDistance !== null && Number.isFinite(finalDistance) && finalDistance > 0) {
          await uploadPhoneMetrics(finalDistance, finalPace, true);
        }
        const savedWorkout = await saveFinishedWorkout({
          endedAt: endedAt || Date.now(),
          elapsedMilliseconds: Math.max(elapsedAtStop, 1000),
          distanceKm:
            finalDistance !== null && Number.isFinite(finalDistance) && finalDistance > 0
              ? finalDistance
              : null,
          paceSeconds: finalPace,
          heartRate: finalHeartRate,
        });

        setWorkoutName(buildDefaultWorkoutName(sportConfig.label));
        setWorkoutNotes('');
        elapsedBeforePauseRef.current = 0;
        workoutStartedAtRef.current = null;
        workoutSourceIdRef.current = null;
        resetPhoneTracking();

        if (savedWorkout.workoutStatus === 'queued') {
          trackingNote = 'Workout saved offline and will sync when online.';
        }
      }
      const baseMessage = buildSuccessMessage(action, connectedDevice ? 'watch + phone' : 'phone');
      const message = [baseMessage, watchNote, trackingNote].filter(Boolean).join(' ');
      setFeedback(message);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to control the watch.';
      setFeedback(message);
    } finally {
      setControlLoading(false);
    }
  };

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
      locationWatcherRef.current?.stop();
      locationWatcherRef.current = null;
      if (sessionStateRef.current === 'idle') {
        void stopExerciseBackgroundLocationUpdates();
        workoutStartedAtRef.current = null;
        workoutSourceIdRef.current = null;
      }
    };
  }, []);

  const handleStart = () => {
    setFeedback(`Starting ${sportConfig.label.toLowerCase()}...`);
    void sendExerciseCommand('start', 'recording', true);
  };
  const handlePause = () => {
    void sendExerciseCommand('pause', 'paused');
  };
  const handleResume = () => {
    void sendExerciseCommand('resume', 'recording');
  };
  const handleFinish = () => {
    void sendExerciseCommand('stop', 'idle');
  };

  const timerLabel = formatElapsed(elapsedMs);
  const isSportSelectionDisabled = sessionState !== 'idle';

  const sessionPillLabel =
    isAutoPaused ? 'Auto-paused' : sessionState === 'recording' ? 'Active' : sessionState === 'paused' ? 'Paused' : 'Ready';
  const sessionPillColor =
    isAutoPaused ? ORANGE : sessionState === 'recording' ? TEAL : sessionState === 'paused' ? ORANGE : TEAL;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {/* ── EXERCISE hero card ── */}
      <View style={styles.card}>
        <EyebrowLabel>EXERCISE</EyebrowLabel>
        <View style={styles.heroTopRow}>
          <IconCircle color={TEAL}>
            <AppText style={styles.iconGlyph}>▶</AppText>
          </IconCircle>
          <View style={styles.heroTopMeta}>
            <AppText style={styles.heroTitle}>{sportConfig.label}</AppText>
            <StatusPill label={sessionPillLabel} color={sessionPillColor} />
          </View>
        </View>

        {/* Sport selector */}
        <View style={styles.sportGrid}>
          {SPORT_OPTIONS.map((option) => (
            <Pressable
              key={option.id}
              onPress={() => { if (!isSportSelectionDisabled) setSelectedSport(option.id); }}
              disabled={isSportSelectionDisabled && option.id !== selectedSport}
              style={[
                styles.sportCell,
                option.id === selectedSport ? styles.sportCellActive : null,
                isSportSelectionDisabled && option.id !== selectedSport ? styles.sportCellDisabled : null,
              ]}
            >
              <AppText style={[styles.sportCellLabel, option.id === selectedSport ? styles.sportCellLabelActive : null]}>
                {option.label}
              </AppText>
              <AppText style={styles.sportCellTagline}>{option.tagline}</AppText>
            </Pressable>
          ))}
        </View>

        {/* 4-stat strip */}
        <View style={styles.statStrip}>
          <StatStripItem label="DURATION" value={timerLabel} />
          <View style={styles.stripDivider} />
          <StatStripItem label="KM" value={displayDistanceKm != null ? displayDistanceKm.toFixed(2) : '--'} />
          <View style={styles.stripDivider} />
          <StatStripItem label="BPM" value={displayHeartRate != null ? String(Math.round(displayHeartRate)) : '--'} />
          <View style={styles.stripDivider} />
          <StatStripItem
            label={sessionState === 'recording' ? 'CURR PACE' : 'PACE'}
            value={formatPace(displayPaceSeconds)}
            sublabel={sessionState === 'recording' && avgPaceSeconds != null ? `avg ${formatPace(avgPaceSeconds)}` : undefined}
          />
        </View>

        {/* Auto-pause banner */}
        {isAutoPaused ? (
          <View style={styles.autoPauseBanner}>
            <AppText style={styles.autoPauseBannerText}>Auto-paused — start moving to resume</AppText>
          </View>
        ) : null}

        <View style={styles.workoutDetailsForm}>
          <AppInput
            label="Activity name"
            value={workoutName}
            onChangeText={(value) => setWorkoutName(value.slice(0, WORKOUT_NAME_MAX_LENGTH))}
            placeholder={buildDefaultWorkoutName(sportConfig.label)}
            helperText="Saved with this workout and editable later."
            editable={!controlLoading}
          />
          <AppInput
            label="Notes"
            value={workoutNotes}
            onChangeText={(value) => setWorkoutNotes(value.slice(0, WORKOUT_NOTES_MAX_LENGTH))}
            placeholder="How it felt, terrain, weather, or anything you want to remember."
            helperText={`${workoutNotes.length}/${WORKOUT_NOTES_MAX_LENGTH}`}
            multiline
            textAlignVertical="top"
            style={styles.workoutNotesInput}
            editable={!controlLoading}
          />
        </View>

        {/* CTA */}
        {sessionState === 'idle' ? (
          <Pressable style={[styles.ctaButton, controlLoading ? styles.ctaButtonDisabled : null]} onPress={handleStart} disabled={controlLoading}>
            <AppText style={styles.ctaText}>Start {sportConfig.label.toLowerCase()}</AppText>
          </Pressable>
        ) : (
          <View style={styles.controlPair}>
            <Pressable
              style={styles.secondaryButton}
              onPress={sessionState === 'recording' ? handlePause : handleResume}
              disabled={controlLoading}
            >
              <AppText style={styles.secondaryButtonText}>
                {sessionState === 'recording' ? 'Pause' : 'Resume'}
              </AppText>
            </Pressable>
            <Pressable style={styles.ghostButton} onPress={handleFinish} disabled={controlLoading}>
              <AppText style={styles.ghostButtonText}>Finish</AppText>
            </Pressable>
          </View>
        )}

        {feedback ? <AppText style={styles.feedbackText}>{feedback}</AppText> : null}
      </View>

      {/* ── LAST SESSION card ── */}
      <View style={styles.card}>
        <EyebrowLabel>LAST SESSION</EyebrowLabel>
        <View style={styles.cardTitleRow}>
          <AppText style={styles.cardTitle}>Last effort</AppText>
          {lastSessionForSport ? (
            <AppText style={styles.cardSubtitle}>
              {formatDateTime(lastSessionForSport.startTime, 'MMM D · HH:mm')}
            </AppText>
          ) : null}
          <Pressable onPress={() => navigation.navigate('Sessions' as never)} disabled={isFetching}>
            <AppText style={styles.linkText}>See all</AppText>
          </Pressable>
        </View>

        {isFetching && !data ? (
          <AppText style={styles.mutedText}>Syncing activity…</AppText>
        ) : lastSessionForSport ? (
          <View style={styles.sixGrid}>
            <MetricSubCard label="DISTANCE" value={formatDistance(lastSessionForSport.distance)} />
            <MetricSubCard label="PACE" value={formatPace(lastSessionForSport.averagePace)} />
            <MetricSubCard label="AVG HR" value={formatHeartRate(lastSessionForSport.averageHr)} sublabel="bpm" />
            <MetricSubCard
              label="ELEVATION"
              value={lastSessionForSport?.elevationGain != null ? String(Math.round(lastSessionForSport.elevationGain)) : '--'}
              sublabel="m"
            />
            <MetricSubCard
              label="CALORIES"
              value={lastSessionForSport?.calories != null ? String(Math.round(lastSessionForSport.calories)) : '--'}
              sublabel="kcal"
            />
            <MetricSubCard
              label="DURATION"
              value={formatDurationSeconds(lastSessionForSport.elapsedTime || lastSessionForSport.movingTime)}
            />
          </View>
        ) : !isFetching ? (
          <AppText style={styles.mutedText}>No {sportConfig.label.toLowerCase()} recorded yet.</AppText>
        ) : null}

        <View style={styles.cardTitleRow}>
          <AppText style={styles.cardTitle}>{routeTitle}</AppText>
        </View>
        <AppText style={styles.mutedText}>{routeSubtitle}</AppText>
        <RouteMapCard
          points={routePoints}
          active={sessionState === 'recording'}
          distanceKm={displayDistanceKm}
          elevationGainMeters={elevationGainMeters}
          gpsAccuracyMeters={gpsAccuracyMeters}
        />
        <View style={styles.twoColGrid}>
          {routeSummary.map((item) => (
            <MetricSubCard key={item.label} label={item.label.toUpperCase()} value={item.value} />
          ))}
        </View>

        {kmSplits.length > 0 ? (
          <View style={styles.splitsTable}>
            <AppText style={styles.splitsTitle}>Km splits</AppText>
            {kmSplits.map((split) => (
              <View key={split.km} style={styles.splitRow}>
                <AppText style={styles.splitKmLabel}>KM {split.km}</AppText>
                <AppText style={styles.splitPaceValue}>{formatPace(split.paceSeconds)}</AppText>
              </View>
            ))}
          </View>
        ) : null}

        {phoneTrackingError ? <AppText style={styles.errorText}>{phoneTrackingError}</AppText> : null}
      </View>

      {/* ── TRAINING card ── */}
      <View style={styles.card}>
        <EyebrowLabel>TRAINING</EyebrowLabel>
        <View style={styles.cardTitleRow}>
          <IconCircle color={ORANGE}>
            <AppText style={styles.iconGlyph}>◈</AppText>
          </IconCircle>
          <AppText style={[styles.cardTitle, { flex: 1 }]}>Training snapshot</AppText>
          <StatusPill label="Low activity" color={ORANGE} />
        </View>
        <View style={styles.twoColGrid}>
          {trainingSnapshot.map((item) => (
            <MetricSubCard key={item.label} label={item.label.toUpperCase()} value={item.value} />
          ))}
        </View>
      </View>

      {/* ── STRAVA card ── */}
      <View style={styles.card}>
        <View style={styles.cardTitleRow}>
          <AppText style={[styles.cardTitle, { flex: 1 }]}>Strava</AppText>
          <StatusPill label="Setup required" color={ORANGE} />
          <View style={styles.toggleDisabled}>
            <View style={styles.toggleThumb} />
          </View>
        </View>
        <AppText style={styles.fineprint}>
          Connect Strava to automatically sync workouts and activity data. Requires an active Strava account.
        </AppText>
      </View>

      {/* ── EXERCISE TRENDS card ── */}
      <View style={styles.card}>
        <EyebrowLabel>EXERCISE TRENDS</EyebrowLabel>
        <AppText style={styles.cardTitle}>Heart rate & distance</AppText>
        <View style={styles.pillRow}>
          <StatusPill label="Heart rate" color={ORANGE} dot />
          <StatusPill label="Distance" color={ORANGE} dot />
        </View>
        {heartRateTrend.length ? (
          <TrendChart data={heartRateTrend} yLabel="bpm" />
        ) : (
          <AppText style={styles.mutedText}>Heart-rate history will appear after you record or sync sessions.</AppText>
        )}
        {distanceTrend.length ? (
          <View style={styles.trendSpacing}>
            <TrendChart data={distanceTrend} yLabel="km" />
          </View>
        ) : (
          <AppText style={[styles.mutedText, styles.trendSpacing]}>
            Distance history will appear after you record or sync sessions.
          </AppText>
        )}
      </View>

      {/* ── WATCH LINK card ── */}
      <View style={styles.card}>
        <View style={styles.cardTitleRow}>
          <IconCircle color={PURPLE}>
            <AppText style={styles.iconGlyph}>◎</AppText>
          </IconCircle>
          <View style={{ flex: 1 }}>
            <AppText style={styles.cardTitle}>Watch link</AppText>
            <StatusPill
              label={connectedDevice ? 'Connected' : 'No watch connected'}
              color={connectedDevice ? TEAL : GRAY}
            />
          </View>
        </View>
        <Pressable
          style={styles.purpleScanButton}
          onPress={() => navigation.navigate('Devices' as never)}
        >
          <AppText style={styles.purpleScanText}>Scan for devices</AppText>
        </Pressable>
        <Pressable
          style={styles.ghostDevicesButton}
          onPress={() => navigation.navigate('Devices' as never)}
        >
          <AppText style={styles.ghostDevicesText}>View all devices</AppText>
        </Pressable>
      </View>
    </ScrollView>
  );
}

function formatElapsed(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

function formatKilometers(value?: number | null) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '--';
  }
  return `${value.toFixed(2)} km`;
}

function formatHeartRate(value?: number | null) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '--';
  }
  return `${Math.round(value)} bpm`;
}

function formatDurationMinutes(value?: number | null) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '--';
  }
  const roundedMinutes = Math.max(0, Math.round(value));
  const hours = Math.floor(roundedMinutes / 60);
  const minutes = roundedMinutes % 60;
  if (hours > 0) {
    return `${hours}h ${minutes.toString().padStart(2, '0')}m`;
  }
  return `${roundedMinutes} min`;
}

function formatDurationSeconds(value?: number | null) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '--';
  }
  return formatElapsed(Math.round(value * 1000));
}

function formatWholeNumber(value?: number | null) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '--';
  }
  return `${Math.round(value)}`;
}

function toLocalDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function buildWorkoutSourceId(sportId: SportId, startedAt: number) {
  return `exercise:${sportId}:${startedAt}:${Math.random().toString(36).slice(2, 8)}`;
}

function buildDefaultWorkoutName(sportLabel: string) {
  return `${sportLabel} workout`;
}

function isAutoWorkoutName(name: string) {
  const normalized = String(name || '').trim().toLowerCase();
  return normalized === 'run workout' || normalized === 'ride workout' || normalized === 'walk workout';
}

function normalizeWorkoutName(name: string, sportLabel: string) {
  const trimmed = String(name || '').trim();
  if (!trimmed) {
    return buildDefaultWorkoutName(sportLabel);
  }
  return trimmed.slice(0, WORKOUT_NAME_MAX_LENGTH);
}

function normalizeWorkoutNotes(notes: string) {
  const trimmed = String(notes || '').replace(/\r\n/g, '\n').trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.slice(0, WORKOUT_NOTES_MAX_LENGTH);
}

function normalizeMetric(metric: string) {
  return String(metric || '').trim().toLowerCase();
}

function isWatchDistanceMetric(metric: string) {
  const normalized = normalizeMetric(metric);
  return normalized === DEVICE_METRICS.distance || normalized.includes('distance') || normalized.endsWith('.km');
}

function isWatchPaceMetric(metric: string) {
  const normalized = normalizeMetric(metric);
  return normalized === DEVICE_METRICS.pace || normalized.includes('pace');
}

function isWatchSpeedMetric(metric: string) {
  const normalized = normalizeMetric(metric);
  return normalized.includes('speed');
}

function isWatchHeartRateMetric(metric: string) {
  const normalized = normalizeMetric(metric);
  return (
    normalized === DEVICE_METRICS.heartRate ||
    normalized.includes('heart') ||
    /(^|[._-])hr($|[._-])/.test(normalized)
  );
}

function normalizeDistanceSample(metric: string, value: number) {
  const normalized = normalizeMetric(metric);
  if (normalized.includes('mile') || normalized.endsWith('.mi') || normalized.endsWith('_mi')) {
    return value * 1.60934;
  }
  if (
    normalized.includes('meter') ||
    normalized.includes('_m') ||
    normalized.includes('.m') ||
    normalized.includes('distance_m')
  ) {
    return value / 1000;
  }
  return value;
}

function normalizePaceSample(metric: string, value: number) {
  const normalized = normalizeMetric(metric);
  if (isWatchSpeedMetric(metric)) {
    return value > 0 ? 1000 / value : null;
  }
  if (
    normalized.includes('min_per_km') ||
    normalized.includes('minpkm') ||
    normalized.includes('minutes_per_km') ||
    normalized.endsWith('.min')
  ) {
    return value > 0 ? value * 60 : null;
  }
  return value > 0 ? value : null;
}

function buildSuccessMessage(action: ExerciseAction, source: 'watch + phone' | 'phone') {
  switch (action) {
    case 'start':
      return source === 'watch + phone'
        ? 'Recording started with watch + phone tracking.'
        : 'Recording started with phone tracking.';
    case 'pause':
      return 'Workout paused.';
    case 'resume':
      return 'Workout resumed.';
    case 'stop':
      return source === 'watch + phone'
        ? 'Workout saved from watch + phone tracking.'
        : 'Workout saved from phone tracking.';
    default:
      return null;
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string) {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, timeoutMs);
    promise
      .then((result) => {
        clearTimeout(timeoutId);
        resolve(result);
      })
      .catch((error) => {
        clearTimeout(timeoutId);
        reject(error);
      });
  });
}

function loadExpoLocationModule():
  | {
      requestForegroundPermissionsAsync: () => Promise<{ status: string }>;
      watchPositionAsync: (
        options: Record<string, unknown>,
        callback: (location: any) => void
      ) => Promise<{ remove?: () => void }>;
      Accuracy?: Record<string, number>;
    }
  | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    return require('expo-location');
  } catch {
    return null;
  }
}

// ── Small helper components ───────────────────────────────────────────────────

function EyebrowLabel({ children }: { children: string }) {
  return <AppText style={styles.eyebrow}>{children}</AppText>;
}

function IconCircle({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <View style={[styles.iconCircle, { backgroundColor: `${color}22`, borderColor: `${color}44` }]}>
      {children}
    </View>
  );
}

function StatusPill({ label, color, dot }: { label: string; color: string; dot?: boolean }) {
  return (
    <View style={[styles.pill, { backgroundColor: `${color}1a`, borderColor: `${color}44` }]}>
      {dot ? <View style={[styles.pillDot, { backgroundColor: color }]} /> : null}
      <AppText style={[styles.pillText, { color }]}>{label}</AppText>
    </View>
  );
}

function StatStripItem({ label, value, sublabel }: { label: string; value: string; sublabel?: string }) {
  return (
    <View style={styles.statStripItem}>
      <AppText style={styles.statStripLabel}>{label}</AppText>
      <AppText style={styles.statStripValue}>{value}</AppText>
      {sublabel ? <AppText style={styles.statStripSublabel}>{sublabel}</AppText> : null}
    </View>
  );
}

function MetricSubCard({ label, value, sublabel }: { label: string; value: string; sublabel?: string }) {
  return (
    <View style={styles.metricSubCard}>
      <AppText style={styles.metricSubLabel}>{label}</AppText>
      <AppText style={styles.metricSubValue}>{value}</AppText>
      {sublabel ? <AppText style={styles.metricSubSublabel}>{sublabel}</AppText> : null}
    </View>
  );
}

function RouteMapCard({
  points,
  active,
  distanceKm,
  elevationGainMeters,
  gpsAccuracyMeters,
}: {
  points: PhoneGeoPoint[];
  active: boolean;
  distanceKm: number | null;
  elevationGainMeters: number;
  gpsAccuracyMeters: number | null;
}) {
  const mapRef = useRef<any>(null);
  const wasActiveRef = useRef(active);
  const hasRealPoints = points.length >= 2;

  // During recording: smoothly track the latest GPS position at street level (zoom 16)
  useEffect(() => {
    if (!MapView || !mapRef.current || !active || points.length === 0) return;
    const last = points[points.length - 1];
    mapRef.current.animateCamera(
      { center: { latitude: last.latitude, longitude: last.longitude }, zoom: 16, altitude: 400 },
      { duration: 350 }
    );
  }, [active, points]);

  // When recording stops: fit the full route in frame with padding
  useEffect(() => {
    const wasActive = wasActiveRef.current;
    wasActiveRef.current = active;
    if (!MapView || !mapRef.current || active || !wasActive || points.length < 2) return;
    mapRef.current.fitToCoordinates(
      points.map((p) => ({ latitude: p.latitude, longitude: p.longitude })),
      { edgePadding: { top: 50, right: 44, bottom: 80, left: 44 }, animated: true }
    );
  }, [active, points]);

  // Position the camera the moment the MapView becomes ready (handles first mount)
  const onMapReady = useCallback(() => {
    if (!mapRef.current || points.length === 0) return;
    if (active) {
      const last = points[points.length - 1];
      mapRef.current.animateCamera(
        { center: { latitude: last.latitude, longitude: last.longitude }, zoom: 16, altitude: 400 },
        { duration: 0 }
      );
    } else if (points.length >= 2) {
      mapRef.current.fitToCoordinates(
        points.map((p) => ({ latitude: p.latitude, longitude: p.longitude })),
        { edgePadding: { top: 50, right: 44, bottom: 80, left: 44 }, animated: false }
      );
    }
  }, [active, points]);

  const accuracyColor =
    gpsAccuracyMeters == null
      ? GRAY
      : gpsAccuracyMeters <= 10
      ? '#22c55e'
      : gpsAccuracyMeters <= 30
      ? ORANGE
      : '#ef4444';

  const bottomBar = (
    <View style={styles.routeBottomBar}>
      <AppText style={styles.routeBottomItem}>
        {distanceKm != null ? `${distanceKm.toFixed(2)} km` : '--'}
      </AppText>
      <View style={styles.routeBottomDivider} />
      <AppText style={styles.routeBottomItem}>
        {elevationGainMeters > 0 ? `↑ ${elevationGainMeters} m` : '↑ --'}
      </AppText>
      <View style={styles.routeBottomDivider} />
      <AppText style={[styles.routeBottomItem, { color: accuracyColor }]}>
        {gpsAccuracyMeters != null ? `GPS ±${Math.round(gpsAccuracyMeters)} m` : 'GPS --'}
      </AppText>
    </View>
  );

  // ── Real map tiles via react-native-maps ────────────────────────────────────
  if (MapView && hasRealPoints) {
    const coordinates = points.map((p) => ({ latitude: p.latitude, longitude: p.longitude }));
    const startCoord = coordinates[0];
    const endCoord = coordinates[coordinates.length - 1];

    return (
      <View style={styles.routeMapCard}>
        <MapView
          ref={mapRef}
          style={styles.mapView}
          onMapReady={onMapReady}
          scrollEnabled={false}
          zoomEnabled={false}
          rotateEnabled={false}
          pitchEnabled={false}
          showsUserLocation={active}
          showsMyLocationButton={false}
          showsCompass={false}
          showsScale={false}
          showsTraffic={false}
          showsBuildings={false}
          showsPointsOfInterest={false}
          mapType={Platform.OS === 'ios' ? 'mutedStandard' : 'standard'}
          customMapStyle={Platform.OS === 'android' ? DARK_MAP_STYLE : undefined}
        >
          {/* White halo for visibility on both light and dark map backgrounds */}
          <MapPolyline
            coordinates={coordinates}
            strokeColor="rgba(255,255,255,0.65)"
            strokeWidth={8}
            lineCap="round"
            lineJoin="round"
          />
          {/* Main teal route line */}
          <MapPolyline
            coordinates={coordinates}
            strokeColor={TEAL}
            strokeWidth={4.5}
            lineCap="round"
            lineJoin="round"
          />
          {/* Start marker */}
          <MapMarker coordinate={startCoord} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
            <View style={styles.mapDotGreen} />
          </MapMarker>
          {/* Finish marker — hidden while still recording */}
          {!active ? (
            <MapMarker coordinate={endCoord} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
              <View style={styles.mapDotOrange} />
            </MapMarker>
          ) : null}
        </MapView>
        {bottomBar}
      </View>
    );
  }

  // ── SVG fallback (web / before native rebuild) ────────────────────────────────
  const preview = buildRoutePreview(points);
  const placeholderPoints =
    '18,72 24,58 32,50 38,42 46,36 54,34 62,36 70,44 76,54 80,64 78,72 70,78 58,80 46,78 34,76 24,76 18,72';
  const liveOrPlaceholder = preview?.points ?? placeholderPoints;
  const isLive = Boolean(preview);
  const startPt = preview?.start ?? { x: 18, y: 72 };
  const endPt = preview?.end ?? { x: 18, y: 72 };
  const waypointPositions = [
    { x: 38, y: 42 },
    { x: 62, y: 36 },
    { x: 80, y: 64 },
    { x: 46, y: 78 },
  ];

  return (
    <View style={styles.routeMapCard}>
      <Svg width="100%" height="100%" viewBox="0 0 100 100">
        <Defs>
          <Filter id="glow">
            <FeGaussianBlur stdDeviation="2.5" result="coloredBlur" />
            <FeBlend in="SourceGraphic" in2="coloredBlur" mode="normal" />
          </Filter>
        </Defs>
        <Rect x={0} y={0} width={100} height={100} fill="#0a1420" />
        {[20, 40, 60, 80].map((o) => (
          <Line key={`h${o}`} x1={8} y1={o} x2={92} y2={o} stroke="rgba(255,255,255,0.04)" strokeWidth={0.5} />
        ))}
        {[20, 40, 60, 80].map((o) => (
          <Line key={`v${o}`} x1={o} y1={8} x2={o} y2={88} stroke="rgba(255,255,255,0.04)" strokeWidth={0.5} />
        ))}
        <Polyline
          points={liveOrPlaceholder}
          fill="none"
          stroke={TEAL}
          strokeWidth={6}
          strokeOpacity={0.18}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <Polyline
          points={liveOrPlaceholder}
          fill="none"
          stroke={active ? TEAL : isLive ? TEAL : `${TEAL}aa`}
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {!isLive
          ? waypointPositions.map((pt, i) => (
              <Circle key={i} cx={pt.x} cy={pt.y} r={2.2} fill={TEAL} fillOpacity={0.7} />
            ))
          : null}
        <Circle cx={startPt.x} cy={startPt.y} r={3} fill="#22c55e" />
        <Circle cx={endPt.x} cy={endPt.y} r={3} fill={ORANGE} />
      </Svg>
      {bottomBar}
    </View>
  );
}

function buildRoutePreview(points: PhoneGeoPoint[]) {
  if (!points.length) {
    return null;
  }
  const latitudes = points.map((point) => point.latitude);
  const longitudes = points.map((point) => point.longitude);
  const minLat = Math.min(...latitudes);
  const maxLat = Math.max(...latitudes);
  const minLng = Math.min(...longitudes);
  const maxLng = Math.max(...longitudes);
  const latRange = maxLat - minLat || 0.001;
  const lngRange = maxLng - minLng || 0.001;
  const width = 68;
  const height = 68;
  const offset = 16;

  const mappedPoints = points.map((point) => {
    const x = offset + ((point.longitude - minLng) / lngRange) * width;
    const y = offset + height - ((point.latitude - minLat) / latRange) * height;
    return {
      x: clampMapValue(x),
      y: clampMapValue(y),
    };
  });
  const simplified = simplifyPreviewPoints(mappedPoints, 48);
  const start = simplified[0];
  const end = simplified[simplified.length - 1];

  return {
    points: simplified.map((point) => `${point.x},${point.y}`).join(' '),
    start,
    end,
  };
}

function simplifyPreviewPoints(points: Array<{ x: number; y: number }>, limit: number) {
  if (points.length <= limit) {
    return points;
  }
  const step = (points.length - 1) / (limit - 1);
  return Array.from({ length: limit }, (_, index) => points[Math.round(index * step)]);
}

function clampMapValue(value: number) {
  return Math.max(10, Math.min(90, Math.round(value * 10) / 10));
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#05080f',
  },
  container: {
    padding: spacing.lg,
    gap: spacing.lg,
    paddingBottom: spacing.lg * 2,
  },

  // ── Card shell ───────────────────────────────────────────────────────────────
  card: {
    backgroundColor: '#0c1222',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
    padding: spacing.lg,
    gap: spacing.md,
  },

  // ── Eyebrow ──────────────────────────────────────────────────────────────────
  eyebrow: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1.8,
    color: colors.muted,
    textTransform: 'uppercase',
  },

  // ── Hero card ────────────────────────────────────────────────────────────────
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  heroTopMeta: {
    flex: 1,
    gap: 6,
  },
  heroTitle: {
    fontSize: 32,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.3,
  },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconGlyph: {
    fontSize: 18,
    color: colors.text,
  },

  // ── Status pill ──────────────────────────────────────────────────────────────
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: 100,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 3,
    gap: 5,
  },
  pillDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  pillText: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.2,
  },

  // ── Sport selector ───────────────────────────────────────────────────────────
  sportGrid: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  sportCell: {
    flex: 1,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
    backgroundColor: '#060b16',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
    gap: 3,
  },
  sportCellActive: {
    borderColor: TEAL,
    backgroundColor: `${TEAL}14`,
  },
  sportCellDisabled: {
    opacity: 0.4,
  },
  sportCellLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.muted,
    letterSpacing: -0.2,
  },
  sportCellLabelActive: {
    color: TEAL,
  },
  sportCellTagline: {
    fontSize: 9,
    color: 'rgba(142,162,200,0.6)',
    letterSpacing: 0.3,
  },

  // ── 4-stat strip ─────────────────────────────────────────────────────────────
  statStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#060b16',
    borderRadius: 13,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
    paddingVertical: 12,
    paddingHorizontal: 8,
  },
  statStripItem: {
    flex: 1,
    alignItems: 'center',
    gap: 3,
  },
  statStripLabel: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1.4,
    color: colors.muted,
    textTransform: 'uppercase',
  },
  statStripValue: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.3,
  },
  statStripSublabel: {
    fontSize: 9,
    color: colors.muted,
    letterSpacing: 0.2,
  },
  stripDivider: {
    width: 1,
    height: 32,
    backgroundColor: 'rgba(255,255,255,0.07)',
  },

  // ── CTA / controls ───────────────────────────────────────────────────────────
  ctaButton: {
    backgroundColor: TEAL,
    borderRadius: 13,
    paddingVertical: 15,
    alignItems: 'center',
  },
  ctaButtonDisabled: {
    opacity: 0.5,
  },
  workoutDetailsForm: {
    gap: 0,
  },
  workoutNotesInput: {
    minHeight: 104,
    paddingTop: 14,
  },
  ctaText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#05080f',
    letterSpacing: 0.2,
  },
  controlPair: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  secondaryButton: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 13,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    paddingVertical: 13,
    alignItems: 'center',
  },
  secondaryButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  ghostButton: {
    flex: 1,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    paddingVertical: 13,
    alignItems: 'center',
  },
  ghostButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.muted,
  },
  feedbackText: {
    fontSize: 12,
    color: colors.muted,
    textAlign: 'center',
  },

  // ── Card header row ───────────────────────────────────────────────────────────
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.2,
  },
  cardSubtitle: {
    fontSize: 12,
    color: colors.muted,
  },
  linkText: {
    fontSize: 12,
    color: TEAL,
    marginLeft: 'auto',
  },

  // ── 6-stat grid ──────────────────────────────────────────────────────────────
  sixGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },

  // ── 2-col grid (training) ─────────────────────────────────────────────────────
  twoColGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },

  // ── Metric sub-card ───────────────────────────────────────────────────────────
  metricSubCard: {
    width: '30%',
    flexGrow: 1,
    backgroundColor: '#060b16',
    borderRadius: 13,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
    paddingVertical: 10,
    paddingHorizontal: 10,
    gap: 2,
  },
  metricSubLabel: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1.4,
    color: colors.muted,
    textTransform: 'uppercase',
  },
  metricSubValue: {
    fontSize: 21,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.3,
  },
  metricSubSublabel: {
    fontSize: 9,
    color: colors.muted,
    letterSpacing: 0.3,
  },

  // ── Route map card ────────────────────────────────────────────────────────────
  routeMapCard: {
    height: 260,
    borderRadius: 13,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
    backgroundColor: '#0a1420',
  },
  mapView: {
    flex: 1,
  },
  mapDotGreen: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#22c55e',
    borderWidth: 2,
    borderColor: '#fff',
  },
  mapDotOrange: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: ORANGE,
    borderWidth: 2,
    borderColor: '#fff',
  },
  routeBottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(5,8,15,0.82)',
    paddingVertical: 8,
    paddingHorizontal: 14,
    gap: 12,
  },
  routeBottomItem: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.text,
  },
  routeBottomDivider: {
    width: 1,
    height: 12,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },

  // ── Strava card ───────────────────────────────────────────────────────────────
  toggleDisabled: {
    width: 40,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  toggleThumb: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.3)',
  },
  fineprint: {
    fontSize: 11,
    color: colors.muted,
    lineHeight: 16,
  },

  // ── Trends card ───────────────────────────────────────────────────────────────
  pillRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  trendSpacing: {
    marginTop: spacing.md,
  },

  // ── Watch link card ───────────────────────────────────────────────────────────
  purpleScanButton: {
    backgroundColor: `${PURPLE}22`,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: `${PURPLE}55`,
    paddingVertical: 13,
    alignItems: 'center',
  },
  purpleScanText: {
    fontSize: 14,
    fontWeight: '700',
    color: PURPLE,
  },
  ghostDevicesButton: {
    borderRadius: 13,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    paddingVertical: 12,
    alignItems: 'center',
  },
  ghostDevicesText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.muted,
  },

  // ── Misc ──────────────────────────────────────────────────────────────────────
  mutedText: {
    fontSize: 13,
    color: colors.muted,
    lineHeight: 18,
  },
  errorText: {
    marginTop: spacing.sm,
    color: colors.danger,
    fontSize: 13,
  },

  // ── Auto-pause banner ─────────────────────────────────────────────────────────
  autoPauseBanner: {
    backgroundColor: `${ORANGE}18`,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: `${ORANGE}44`,
    paddingVertical: 8,
    paddingHorizontal: 14,
    alignItems: 'center',
  },
  autoPauseBannerText: {
    fontSize: 12,
    fontWeight: '600',
    color: ORANGE,
    letterSpacing: 0.2,
  },

  // ── Km splits table ───────────────────────────────────────────────────────────
  splitsTable: {
    gap: 5,
  },
  splitsTitle: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 1.4,
    marginBottom: 2,
  },
  splitRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: '#060b16',
    borderRadius: 8,
  },
  splitKmLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.muted,
    letterSpacing: 0.8,
  },
  splitPaceValue: {
    fontSize: 14,
    fontWeight: '700',
    color: TEAL,
    letterSpacing: -0.2,
  },
});
