import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, StyleSheet, View, Pressable, ScrollView, Platform } from 'react-native';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
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
import { buildBluetoothTrendSeries } from '../devices/bluetoothMetricUtils';
import {
  startExerciseBackgroundLocationUpdates,
  stopExerciseBackgroundLocationUpdates,
} from './backgroundTracking';
import {
  dismissWorkoutNotification,
  requestWorkoutNotificationPermission,
  updateWorkoutNotification,
} from './workoutNotification';
import {
  buildCurrentRunWidgetPropsFromSession,
  buildCurrentRunWidgetPropsFromTracking,
  createCurrentRunWidgetSnapshot,
  syncCurrentRunWidget,
  type CurrentRunWidgetProps,
} from './currentRunWidget';
import {
  endWorkoutLiveActivity,
  startWorkoutLiveActivity,
  updateWorkoutLiveActivity,
  type WorkoutLiveActivityProps,
} from './workoutLiveActivity';
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
import { buildStoredWorkoutMetrics } from './workoutSummary';

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
const TEAL = '#fc4c02';
const ORANGE = '#ff9b54';
const PURPLE = '#78a7ff';
const GRAY = '#a2aab3';
const SURFACE = '#111315';
const SURFACE_ALT = '#191c20';
const SURFACE_SOFT = '#0c0f13';
const TEXT_MUTED = '#a9b0b8';

// ── Google Maps dark style (Android) ─────────────────────────────────────────
// Matches the app's navy night theme so the teal route line pops clearly.
const DARK_MAP_STYLE = [
  { elementType: 'geometry',                                      stylers: [{ color: '#17191d' }] },
  { elementType: 'labels.text.fill',                              stylers: [{ color: '#8d949d' }] },
  { elementType: 'labels.text.stroke',                            stylers: [{ color: '#0f1114' }] },
  { featureType: 'administrative', elementType: 'geometry',       stylers: [{ visibility: 'off' }] },
  { featureType: 'poi',                                           stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'geometry.fill',            stylers: [{ color: '#25282d' }] },
  { featureType: 'road', elementType: 'geometry.stroke',          stylers: [{ color: '#1b1e22' }] },
  { featureType: 'road', elementType: 'labels.icon',              stylers: [{ visibility: 'off' }] },
  { featureType: 'road.highway', elementType: 'geometry.fill',    stylers: [{ color: '#2e333a' }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke',  stylers: [{ color: '#20242a' }] },
  { featureType: 'transit',                                       stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'geometry',                stylers: [{ color: '#0f1217' }] },
  { featureType: 'water', elementType: 'labels.text.fill',        stylers: [{ color: '#555d67' }] },
];

const WATCH_COMMAND_TIMEOUT_MS = 3500;
const PHONE_TRACKER_START_TIMEOUT_MS = 4000;
const PHONE_UPLOAD_INTERVAL_MS = 15_000;
const PHONE_UPLOAD_DISTANCE_DELTA_KM = 0.05;
const WATCH_AUTO_START_FRESH_WINDOW_MS = 15_000;
const EXERCISE_STREAM_WINDOW_MS = 21 * 24 * 60 * 60 * 1000;
const RUN_WIDGET_UPDATE_INTERVAL_TICKS = 60;
const CALORIE_FACTORS: Record<SportId, number> = { run: 1.0, ride: 0.4, walk: 0.7 }; // kcal/kg/km
const CALORIE_BODY_WEIGHT_KG = 70; // default body weight estimate
const WORKOUT_NAME_MAX_LENGTH = 96;
const WORKOUT_NOTES_MAX_LENGTH = 500;
const LIVE_ACTIVITY_UPDATE_INTERVAL_TICKS = 10;

export function ExerciseScreen() {
  const navigation = useNavigation();
  const { user } = useAuth();
  const { subjectId } = useSubject();
  const { runOrQueue } = useSyncQueue();
  const queryClient = useQueryClient();
  const requestSubject = subjectId && subjectId !== user?.id ? subjectId : undefined;
  const viewingOwnData = !requestSubject;

  const {
    connectedDevice,
    recentSamples,
    sampleHistory,
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
  const workoutLiveActivityPropsRef = useRef<WorkoutLiveActivityProps | null>(null);
  const currentRunWidgetPropsRef = useRef<CurrentRunWidgetProps | null>(null);
  const sessionStateRef = useRef<SessionState>('idle');
  const locationWatcherRef = useRef<null | { stop: () => void }>(null);
  const lastPhoneUploadRef = useRef({ ts: 0, distanceKm: 0 });
  const phoneDistanceRef = useRef<number | null>(null);
  const phonePaceRef = useRef<number | null>(null);
  const elevationGainRef = useRef(0);
  // Counts 1-second timer ticks to throttle notification updates to every 30 s
  const notificationTickRef = useRef(0);

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

  // Request notification permission early so it doesn't interrupt mid-workout
  useEffect(() => {
    void requestWorkoutNotificationPermission();
  }, []);

  // Crash / app-restart recovery: if there is an in-progress tracking session in
  // storage from a previous run, restore it so the user can continue or finish it.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (sessionStateRef.current !== 'idle') {
        return;
      }
      const snapshot = await loadStoredExerciseTrackingSnapshot().catch(() => null);
      if (cancelled || !snapshot) {
        return;
      }
      if (snapshot.status !== 'recording' && snapshot.status !== 'paused') {
        return;
      }
      // Ignore sessions that are more than 4 hours stale
      if (Date.now() - snapshot.updatedAt > 4 * 60 * 60 * 1000) {
        return;
      }

      workoutSourceIdRef.current = snapshot.workoutSourceId;
      workoutStartedAtRef.current = snapshot.startedAt;
      setSelectedSport(snapshot.sportId);
      applyTrackingSnapshot(snapshot);

      const restoredStatus = snapshot.status;
      setSessionState(restoredStatus);
      sessionStateRef.current = restoredStatus;

      if (restoredStatus === 'recording') {
        void startPhoneTracking();
        void maybeStartBackgroundTracking(snapshot);
        void updateWorkoutNotification(snapshot);
        void updateWorkoutLiveActivity(
          buildWorkoutLiveActivityProps({
            sportLabel: titleCase(snapshot.sportId),
            status: snapshot.isAutoPaused ? 'auto-paused' : 'active',
            distanceKm: getTrackingDistanceKm(snapshot),
            elapsedMs: getTrackingElapsedMs(snapshot),
            paceSeconds: snapshot.phoneCurrentPaceSeconds ?? snapshot.phonePaceSeconds,
            heartRate: null,
          })
        );
        syncCurrentRunWidget(
          buildCurrentRunWidgetPropsFromTracking(snapshot, {
            sportLabel: titleCase(snapshot.sportId),
            paceSeconds: snapshot.phoneCurrentPaceSeconds ?? snapshot.phonePaceSeconds,
            calories: null,
          })
        );
      } else if (restoredStatus === 'paused') {
        void updateWorkoutLiveActivity(
          buildWorkoutLiveActivityProps({
            sportLabel: titleCase(snapshot.sportId),
            status: 'paused',
            distanceKm: getTrackingDistanceKm(snapshot),
            elapsedMs: getTrackingElapsedMs(snapshot),
            paceSeconds: snapshot.phonePaceSeconds,
            heartRate: null,
          })
        );
        syncCurrentRunWidget(
          buildCurrentRunWidgetPropsFromTracking(snapshot, {
            sportLabel: titleCase(snapshot.sportId),
            paceSeconds: snapshot.phonePaceSeconds,
            calories: null,
          })
        );
      }

      setFeedback('Previous workout restored. Resume or finish when ready.');
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

    // During an active session, protect against background GPS drift causing spurious
    // auto-pauses that would reduce elapsed time and make the timer jump backwards.
    // If the live timer shows more elapsed than the stored snapshot, keep the live
    // elapsed accounting but take all other fields (distance, route, pace) from storage.
    if (sessionStateRef.current !== 'idle') {
      const liveElapsedMs =
        elapsedBeforePauseRef.current +
        (sessionStartRef.current !== null
          ? Math.max(0, Date.now() - sessionStartRef.current)
          : 0);
      const storedElapsedMs = getTrackingElapsedMs(snapshot);
      if (liveElapsedMs > storedElapsedMs) {
        const merged = {
          ...snapshot,
          elapsedBeforePauseMs: elapsedBeforePauseRef.current,
          sessionStartTs: sessionStartRef.current,
          isAutoPaused: sessionStartRef.current === null,
          stationarySinceTs: null,
        };
        applyTrackingSnapshot(merged);
        return merged;
      }
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
  const liveExerciseSeries = useMemo(
    () =>
      buildBluetoothTrendSeries(
        sampleHistory,
        [
          {
            key: DEVICE_METRICS.heartRate,
            label: 'Heart rate',
            yLabel: 'bpm',
            matches: isWatchHeartRateMetric,
            normalize: (value) => (value > 0 ? Math.round(value) : null),
            formatValue: (value) => (value != null ? `${Math.round(value)} bpm` : '--'),
          },
          {
            key: DEVICE_METRICS.distance,
            label: 'Distance',
            yLabel: 'km',
            matches: isWatchDistanceMetric,
            normalize: (value, metric) => normalizeDistanceSample(metric, value),
            formatValue: (value) =>
              value != null ? `${value >= 10 ? value.toFixed(1) : value.toFixed(2)} km` : '--',
          },
          {
            key: DEVICE_METRICS.pace,
            label: 'Pace',
            yLabel: 'sec/km',
            matches: (metric) => isWatchPaceMetric(metric) || isWatchSpeedMetric(metric),
            normalize: (value, metric) => normalizePaceSample(metric, value),
            formatValue: (value) => formatPace(value),
          },
        ],
        { limit: 24, labelFormat: 'HH:mm:ss' }
      ),
    [sampleHistory]
  );

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
  const currentRunWidgetPreview = useMemo(() => {
    if (sessionState === 'idle') {
      return buildCurrentRunWidgetPropsFromSession(lastSessionForSport, sportConfig.label);
    }

    return createCurrentRunWidgetSnapshot({
      titleLabel: 'Current run',
      statusLabel: `${sportConfig.label} · ${isAutoPaused ? 'Auto-paused' : sessionState === 'paused' ? 'Paused' : 'Active'}`,
      compactStatusLabel: isAutoPaused ? 'Auto' : sessionState === 'paused' ? 'Paused' : 'Active',
      distanceKm: liveDistanceKm,
      elapsedMs,
      paceSeconds: displayPaceSeconds,
      calories: liveCalories,
    });
  }, [
    displayPaceSeconds,
    elapsedMs,
    isAutoPaused,
    lastSessionForSport,
    liveCalories,
    liveDistanceKm,
    sessionState,
    sportConfig.label,
  ]);
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
  const weeklyLoadValue = data?.summary?.trainingLoad ?? null;
  const loadBadgeColor =
    weeklyLoadValue == null
      ? GRAY
      : weeklyLoadValue >= 350
      ? '#39d98a'
      : weeklyLoadValue >= 120
      ? TEAL
      : ORANGE;
  const loadBadgeLabel =
    weeklyLoadValue == null
      ? 'Awaiting sync'
      : weeklyLoadValue >= 350
      ? 'Big week'
      : weeklyLoadValue >= 120
      ? 'On track'
      : 'Easy week';

  useEffect(() => {
    workoutLiveActivityPropsRef.current = buildWorkoutLiveActivityProps({
      sportLabel: sportConfig.label,
      status:
        isAutoPaused
          ? 'auto-paused'
          : sessionState === 'paused'
          ? 'paused'
          : sessionState === 'idle'
          ? 'finished'
          : 'active',
      distanceKm: liveDistanceKm,
      elapsedMs,
      paceSeconds: displayPaceSeconds,
      heartRate: displayHeartRate,
    });
  }, [displayHeartRate, displayPaceSeconds, elapsedMs, isAutoPaused, liveDistanceKm, sessionState, sportConfig.label]);

  useEffect(() => {
    currentRunWidgetPropsRef.current = currentRunWidgetPreview;
  }, [currentRunWidgetPreview]);

  useEffect(() => {
    if (sessionState !== 'idle') {
      return;
    }
    syncCurrentRunWidget(currentRunWidgetPreview);
  }, [currentRunWidgetPreview, sessionState]);

  const syncWorkoutLiveActivity = useCallback(
    async (mode: 'start' | 'update' | 'end') => {
      const props = workoutLiveActivityPropsRef.current;
      if (!props) {
        return;
      }
      if (mode === 'start') {
        await startWorkoutLiveActivity(props);
        return;
      }
      if (mode === 'end') {
        await endWorkoutLiveActivity(props);
        return;
      }
      await updateWorkoutLiveActivity(props);
    },
    []
  );

  useEffect(() => {
    sessionStateRef.current = sessionState;
  }, [sessionState]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        if (sessionStateRef.current === 'recording') {
          // Always stop and restart the foreground watcher when the app comes back to
          // the foreground while recording — expo-location subscriptions can silently
          // stop delivering events while backgrounded even if the handle is non-null.
          // Restore the background-accumulated snapshot first so the restarted watcher
          // builds on top of it (avoids a race where a GPS event arrives before the
          // restore completes and overwrites background progress).
          locationWatcherRef.current?.stop();
          locationWatcherRef.current = null;
          void restorePersistedTrackingSnapshot().then(() => {
            if (sessionStateRef.current === 'recording') {
              // Also re-ensure the background task is running — the OS can kill it
              // under memory pressure even while the session is active.
              const snapshot = trackingSnapshotRef.current;
              if (snapshot) {
                void maybeStartBackgroundTracking(snapshot);
              }
              void startPhoneTracking();
            }
          });
        } else {
          void restorePersistedTrackingSnapshot();
        }
      }
    });

    return () => {
      subscription.remove();
    };
  }, [maybeStartBackgroundTracking, restorePersistedTrackingSnapshot, startPhoneTracking]);

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
    }: {
      endedAt: number;
      elapsedMilliseconds: number;
      distanceKm: number | null;
    }) => {
      const storedMetrics = buildStoredWorkoutMetrics({
        elapsedMilliseconds,
        distanceKm,
      });
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
        ...storedMetrics,
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
    void syncWorkoutLiveActivity('start');
    syncCurrentRunWidget(
      createCurrentRunWidgetSnapshot({
        titleLabel: 'Current run',
        statusLabel: `${sportConfig.label} · Active`,
        compactStatusLabel: 'Active',
        distanceKm: 0,
        elapsedMs: 0,
        paceSeconds: null,
        calories: null,
      })
    );
    void startPhoneTracking();
    void maybeStartBackgroundTracking(snapshot);
  }, [
    latestWatchSignalTs,
    maybeStartBackgroundTracking,
    persistTrackingSnapshot,
    sessionState,
    sportConfig.id,
    startPhoneTracking,
    syncWorkoutLiveActivity,
  ]);

  useEffect(() => {
    if (sessionState !== 'recording') {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      notificationTickRef.current = 0;
      return;
    }
    notificationTickRef.current = 0;
    timerRef.current = setInterval(() => {
      const startTs = sessionStartRef.current || Date.now();
      setElapsedMs(elapsedBeforePauseRef.current + (Date.now() - startTs));

      // Update the live notification every 30 seconds while the screen is on
      notificationTickRef.current += 1;
      if (notificationTickRef.current % 30 === 0 && trackingSnapshotRef.current) {
        void updateWorkoutNotification(trackingSnapshotRef.current);
      }
      if (notificationTickRef.current % LIVE_ACTIVITY_UPDATE_INTERVAL_TICKS === 0) {
        void syncWorkoutLiveActivity('update');
      }
      if (notificationTickRef.current % RUN_WIDGET_UPDATE_INTERVAL_TICKS === 0) {
        const snapshot = currentRunWidgetPropsRef.current;
        if (snapshot) {
          syncCurrentRunWidget(snapshot);
        }
      }
    }, 1000);
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [sessionState, syncWorkoutLiveActivity]);

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
        void updateWorkoutNotification(snapshot);
        void startWorkoutLiveActivity(buildWorkoutLiveActivityProps({
          sportLabel: sportConfig.label,
          status: 'active',
          distanceKm: 0,
          elapsedMs: 0,
          paceSeconds: null,
          heartRate: watchMetrics.heartRate,
        }));
        syncCurrentRunWidget(
          createCurrentRunWidgetSnapshot({
            titleLabel: 'Current run',
            statusLabel: `${sportConfig.label} · Active`,
            compactStatusLabel: 'Active',
            distanceKm: 0,
            elapsedMs: 0,
            paceSeconds: null,
            calories: null,
          })
        );
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
        if (snapshot) {
          void updateWorkoutNotification(snapshot);
        }
        void updateWorkoutLiveActivity(buildWorkoutLiveActivityProps({
          sportLabel: sportConfig.label,
          status: 'active',
          distanceKm: liveDistanceKm,
          elapsedMs: getTrackingElapsedMs(snapshot, resumedAt),
          paceSeconds: displayPaceSeconds,
          heartRate: displayHeartRate,
        }));
        syncCurrentRunWidget(
          createCurrentRunWidgetSnapshot({
            titleLabel: 'Current run',
            statusLabel: `${sportConfig.label} · Active`,
            compactStatusLabel: 'Active',
            distanceKm: liveDistanceKm,
            elapsedMs: getTrackingElapsedMs(snapshot, resumedAt),
            paceSeconds: displayPaceSeconds,
            calories: liveCalories,
          })
        );
      } else if (nextState === 'paused') {
        const pausedAt = Date.now();
        elapsedBeforePauseRef.current += pausedAt - (sessionStartRef.current || pausedAt);
        sessionStartRef.current = null;
        const snapshot = pauseExerciseTrackingSnapshot(trackingSnapshotRef.current, pausedAt);
        void persistTrackingSnapshot(snapshot);
        if (snapshot) {
          void updateWorkoutNotification(snapshot);
        }
        void updateWorkoutLiveActivity(buildWorkoutLiveActivityProps({
          sportLabel: sportConfig.label,
          status: 'paused',
          distanceKm: liveDistanceKm,
          elapsedMs: getTrackingElapsedMs(snapshot, pausedAt),
          paceSeconds: displayPaceSeconds,
          heartRate: displayHeartRate,
        }));
        syncCurrentRunWidget(
          createCurrentRunWidgetSnapshot({
            titleLabel: 'Current run',
            statusLabel: `${sportConfig.label} · ${isAutoPaused ? 'Auto-paused' : 'Paused'}`,
            compactStatusLabel: isAutoPaused ? 'Auto' : 'Paused',
            distanceKm: liveDistanceKm,
            elapsedMs: getTrackingElapsedMs(snapshot, pausedAt),
            paceSeconds: displayPaceSeconds,
            calories: liveCalories,
          })
        );
      } else {
        sessionStartRef.current = null;
        setElapsedMs(0);
        void persistTrackingSnapshot(stoppedTrackingSnapshot);
        void dismissWorkoutNotification();
        void endWorkoutLiveActivity(buildWorkoutLiveActivityProps({
          sportLabel: sportConfig.label,
          status: 'finished',
          distanceKm: finalDistance,
          elapsedMs: elapsedAtStop,
          paceSeconds: finalPace,
          heartRate: finalHeartRate,
        }));
        syncCurrentRunWidget(
          createCurrentRunWidgetSnapshot({
            titleLabel: 'Last run',
            statusLabel: normalizeWorkoutName(workoutName, sportConfig.label),
            compactStatusLabel: 'Last',
            distanceKm: finalDistance,
            elapsedMs: elapsedAtStop,
            paceSeconds: finalPace,
            calories:
              finalDistance !== null && finalDistance > 0
                ? Math.round(finalDistance * CALORIE_BODY_WEIGHT_KG * CALORIE_FACTORS[sportConfig.id])
                : null,
          })
        );
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
  const heroMetrics = [
    {
      label: 'Distance',
      value: displayDistanceKm != null ? displayDistanceKm.toFixed(2) : '--',
      helper: 'km',
      tone: 'accent' as const,
    },
    {
      label: 'Time',
      value: timerLabel,
      helper: sessionState === 'idle' ? 'ready to start' : 'elapsed',
      tone: 'neutral' as const,
    },
    {
      label: sessionState === 'recording' ? 'Current pace' : 'Pace',
      value: formatPace(displayPaceSeconds),
      helper:
        sessionState === 'recording' && avgPaceSeconds != null
          ? `avg ${formatPace(avgPaceSeconds)}`
          : 'per km',
      tone: 'accent' as const,
    },
    {
      label: 'Heart rate',
      value: displayHeartRate != null ? String(Math.round(displayHeartRate)) : '--',
      helper: displayHeartRate != null ? 'bpm' : 'no sensor',
      tone: 'neutral' as const,
    },
  ];
  const watchConnectionLabel = connectedDevice ? 'Wearable connected' : 'No wearable connected';
  const stravaStatusLabel = data?.strava?.connected ? 'Strava linked' : 'Strava not linked';

  useEffect(() => {
    if (sessionState === 'idle') {
      return;
    }
    if (trackingSnapshotRef.current) {
      void syncWorkoutLiveActivity('update');
    }
  }, [isAutoPaused, sessionState, syncWorkoutLiveActivity]);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <View style={[styles.card, styles.heroCard]}>
        <LinearGradient
          colors={['#2b1a12', '#17191d', '#121316']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.heroGradient}
        >
          <View style={styles.heroHeaderRow}>
            <View style={styles.heroHeaderCopy}>
              <EyebrowLabel>LIVE TRACKING</EyebrowLabel>
              <AppText style={styles.heroTitle}>{sportConfig.label}</AppText>
              <AppText style={styles.heroSubtitle}>{heroStatusCopy}</AppText>
            </View>
            <View style={styles.heroStatusStack}>
              <StatusPill label={sessionPillLabel} color={sessionPillColor} />
              <StatusPill
                label={liveSourceLabel}
                color={liveSourceLabel === 'Last session' ? '#aab1ba' : '#ffd1bf'}
                dot
              />
            </View>
          </View>

          <View style={styles.heroMetricsGrid}>
            {heroMetrics.map((item) => (
              <HeroMetricCard
                key={item.label}
                label={item.label}
                value={item.value}
                helper={item.helper}
                tone={item.tone}
              />
            ))}
          </View>

          {isAutoPaused ? (
            <View style={styles.autoPauseBanner}>
              <AppText style={styles.autoPauseBannerText}>Auto-paused — start moving to resume</AppText>
            </View>
          ) : null}

          <View style={styles.heroMapSection}>
            <View style={styles.inlineHeadingRow}>
              <View style={styles.inlineHeadingCopy}>
                <AppText style={styles.inlineSectionTitle}>{routeTitle}</AppText>
                <AppText style={styles.inlineSectionSubtitle}>{routeSubtitle}</AppText>
              </View>
              <StatusPill
                label={
                  routePoints.length >= 2
                    ? 'GPS locked'
                    : sessionState === 'idle'
                    ? 'Standby'
                    : 'Waiting for GPS'
                }
                color={routePoints.length >= 2 ? '#39d98a' : ORANGE}
              />
            </View>

            <RouteMapCard
              points={routePoints}
              active={sessionState === 'recording'}
              distanceKm={displayDistanceKm}
              elevationGainMeters={elevationGainMeters}
              gpsAccuracyMeters={gpsAccuracyMeters}
            />
          </View>

          <View style={styles.routeFactGrid}>
            {routeSummary.map((item) => (
              <RouteFactChip key={item.label} label={item.label} value={item.value} />
            ))}
          </View>

          {kmSplits.length > 0 ? (
            <View style={styles.splitsTable}>
              <AppText style={styles.splitsTitle}>Live kilometre splits</AppText>
              {kmSplits.map((split) => (
                <View key={split.km} style={styles.splitRow}>
                  <AppText style={styles.splitKmLabel}>KM {split.km}</AppText>
                  <AppText style={styles.splitPaceValue}>{formatPace(split.paceSeconds)}</AppText>
                </View>
              ))}
            </View>
          ) : null}

          {phoneTrackingError ? <AppText style={styles.errorText}>{phoneTrackingError}</AppText> : null}

          {sessionState === 'idle' ? (
            <Pressable
              style={[styles.ctaButton, controlLoading ? styles.ctaButtonDisabled : null]}
              onPress={handleStart}
              disabled={controlLoading}
            >
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

          {feedback ? (
            <View style={styles.feedbackBanner}>
              <AppText style={styles.feedbackText}>{feedback}</AppText>
            </View>
          ) : null}
        </LinearGradient>
      </View>

      <View style={styles.card}>
        <View style={styles.sectionIntro}>
          <EyebrowLabel>WORKOUT SETUP</EyebrowLabel>
          <AppText style={styles.cardTitle}>Name, sport, and notes</AppText>
          <AppText style={styles.mutedText}>
            Set up the run the way it should appear once it lands in your activity history.
          </AppText>
        </View>

        <View style={styles.sportGrid}>
          {SPORT_OPTIONS.map((option) => (
            <Pressable
              key={option.id}
              onPress={() => {
                if (!isSportSelectionDisabled) setSelectedSport(option.id);
              }}
              disabled={isSportSelectionDisabled && option.id !== selectedSport}
              style={[
                styles.sportCell,
                option.id === selectedSport ? styles.sportCellActive : null,
                isSportSelectionDisabled && option.id !== selectedSport ? styles.sportCellDisabled : null,
              ]}
            >
              <AppText
                style={[
                  styles.sportCellLabel,
                  option.id === selectedSport ? styles.sportCellLabelActive : null,
                ]}
              >
                {option.label}
              </AppText>
              <AppText style={styles.sportCellTagline}>{option.tagline}</AppText>
            </Pressable>
          ))}
        </View>

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
      </View>

      <View style={styles.card}>
        <View style={styles.cardTitleRow}>
          <View style={styles.titleStack}>
            <EyebrowLabel>RECENT EFFORT</EyebrowLabel>
            <AppText style={styles.cardTitle}>Last {sportConfig.label.toLowerCase()}</AppText>
          </View>
          {lastSessionForSport ? (
            <AppText style={styles.cardSubtitle}>
              {formatDateTime(lastSessionForSport.startTime, 'MMM D · HH:mm')}
            </AppText>
          ) : null}
          <Pressable onPress={() => navigation.navigate('Activity' as never)} disabled={isFetching}>
            <AppText style={styles.linkText}>History</AppText>
          </Pressable>
        </View>

        {isFetching && !data ? (
          <AppText style={styles.mutedText}>Syncing activity…</AppText>
        ) : lastSessionForSport ? (
          <View style={styles.sixGrid}>
            <MetricSubCard label="Distance" value={formatDistance(lastSessionForSport.distance)} />
            <MetricSubCard label="Pace" value={formatPace(lastSessionForSport.averagePace)} />
            <MetricSubCard label="Avg HR" value={formatHeartRate(lastSessionForSport.averageHr)} />
            <MetricSubCard
              label="Elevation"
              value={
                lastSessionForSport?.elevationGain != null
                  ? `${Math.round(lastSessionForSport.elevationGain)} m`
                  : '--'
              }
            />
            <MetricSubCard
              label="Calories"
              value={
                lastSessionForSport?.calories != null
                  ? `${Math.round(lastSessionForSport.calories)} kcal`
                  : '--'
              }
            />
            <MetricSubCard
              label="Duration"
              value={formatDurationSeconds(lastSessionForSport.elapsedTime || lastSessionForSport.movingTime)}
            />
          </View>
        ) : !isFetching ? (
          <AppText style={styles.mutedText}>No {sportConfig.label.toLowerCase()} recorded yet.</AppText>
        ) : null}
      </View>

      <View style={styles.card}>
        <View style={styles.cardTitleRow}>
          <View style={styles.titleStack}>
            <EyebrowLabel>TRAINING BLOCK</EyebrowLabel>
            <AppText style={styles.cardTitle}>This week</AppText>
          </View>
          <StatusPill label={loadBadgeLabel} color={loadBadgeColor} />
        </View>
        <View style={styles.twoColGrid}>
          {trainingSnapshot.map((item) => (
            <MetricSubCard key={item.label} label={item.label} value={item.value} />
          ))}
        </View>
      </View>

      <View style={styles.card}>
        <View style={styles.sectionIntroCompact}>
          <EyebrowLabel>RECENT TRENDS</EyebrowLabel>
          <AppText style={styles.cardTitle}>Heart rate and distance</AppText>
        </View>
        <View style={styles.pillRow}>
          <StatusPill label="Heart rate" color={TEAL} dot />
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

      {viewingOwnData ? (
        <View style={styles.card}>
          <View style={styles.sectionIntroCompact}>
            <EyebrowLabel>LIVE DEVICE FEED</EyebrowLabel>
            <AppText style={styles.cardTitle}>Wearable charts</AppText>
          </View>
          <AppText style={styles.cardSubtitle}>
            {liveExerciseSeries.length
              ? `${connectedDevice?.name || 'Bluetooth device'} · ${formatDateTime(
                  new Date((liveExerciseSeries[0]?.latestTs || latestWatchSignalTs) as number).toISOString(),
                  'MMM D, HH:mm:ss'
                )}`
              : connectedDevice
              ? 'Connected and waiting for distance, pace, or heart-rate samples.'
              : 'Connect a wearable in Settings to see live heart-rate, distance, and pace charts here.'}
          </AppText>
          {liveExerciseSeries.length ? (
            liveExerciseSeries.map((series) => (
              <View key={series.key} style={styles.liveFeedPanel}>
                <View style={styles.liveFeedHeader}>
                  <AppText style={styles.liveFeedTitle}>{series.label}</AppText>
                  <AppText style={styles.liveFeedValue}>{series.latestValueLabel}</AppText>
                </View>
                {series.points.length > 1 ? (
                  <TrendChart
                    data={series.points}
                    yLabel={series.yLabel}
                    height={150}
                    chartPadding={{ top: 20, bottom: 40, left: 52, right: 16 }}
                  />
                ) : (
                  <AppText style={styles.mutedText}>Waiting for a few more samples to draw the chart.</AppText>
                )}
              </View>
            ))
          ) : (
            <Pressable onPress={() => navigation.navigate('Settings' as never)}>
              <AppText style={styles.linkText}>Open device settings</AppText>
            </Pressable>
          )}
        </View>
      ) : null}

      <View style={styles.card}>
        <View style={styles.sectionIntroCompact}>
          <EyebrowLabel>SYNC SOURCES</EyebrowLabel>
          <AppText style={styles.cardTitle}>Devices and Strava</AppText>
        </View>
        <View style={styles.syncGrid}>
          <View style={styles.syncPanel}>
            <View style={styles.syncPanelHead}>
              <IconCircle color={PURPLE}>
                <AppText style={styles.iconGlyph}>◎</AppText>
              </IconCircle>
              <View style={styles.syncPanelCopy}>
                <AppText style={styles.syncPanelTitle}>Wearable</AppText>
                <StatusPill label={watchConnectionLabel} color={connectedDevice ? '#39d98a' : GRAY} />
              </View>
            </View>
            <AppText style={styles.fineprint}>
              Use phone GPS with a watch for the closest match to a proper Strava live run screen.
            </AppText>
            <Pressable
              style={styles.syncActionButton}
              onPress={() => navigation.navigate('Settings' as never)}
            >
              <AppText style={styles.syncActionText}>Open device settings</AppText>
            </Pressable>
          </View>

          <View style={styles.syncPanel}>
            <View style={styles.syncPanelHead}>
              <IconCircle color={ORANGE}>
                <AppText style={styles.iconGlyph}>S</AppText>
              </IconCircle>
              <View style={styles.syncPanelCopy}>
                <AppText style={styles.syncPanelTitle}>Strava</AppText>
                <StatusPill label={stravaStatusLabel} color={data?.strava?.connected ? '#39d98a' : ORANGE} />
              </View>
            </View>
            <AppText style={styles.fineprint}>
              Sync your finished runs into the activity feed for deeper pace, load, and route review.
            </AppText>
            <Pressable
              style={styles.syncActionGhost}
              onPress={() => navigation.navigate('Activity' as never)}
            >
              <AppText style={styles.syncActionGhostText}>Open activity page</AppText>
            </Pressable>
          </View>
        </View>
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

function formatCompactDistanceKilometers(value?: number | null) {
  if (value === null || value === undefined || Number.isNaN(value) || value <= 0) {
    return '0.00 km';
  }
  return `${value.toFixed(2)} km`;
}

function buildWorkoutLiveActivityProps({
  sportLabel,
  status,
  distanceKm,
  elapsedMs,
  paceSeconds,
  heartRate,
}: {
  sportLabel: string;
  status: 'active' | 'paused' | 'auto-paused' | 'finished';
  distanceKm: number | null;
  elapsedMs: number;
  paceSeconds: number | null;
  heartRate: number | null;
}): WorkoutLiveActivityProps {
  const statusLabel =
    status === 'auto-paused'
      ? 'Auto-paused'
      : status.charAt(0).toUpperCase() + status.slice(1);
  const elapsedLabel = formatElapsed(Math.max(0, elapsedMs));
  const distanceLabel = formatCompactDistanceKilometers(distanceKm);
  const paceText = formatPace(paceSeconds);
  const heartRateText = formatHeartRate(heartRate);

  return {
    sportLabel,
    statusLabel,
    distanceLabel,
    elapsedLabel,
    paceLabel: paceText === '--' ? 'Pace --' : `Pace ${paceText}`,
    heartRateLabel: heartRateText === '--' ? 'Heart rate --' : `Heart rate ${heartRateText}`,
    compactDistanceLabel: distanceKm !== null && Number.isFinite(distanceKm) && distanceKm > 0
      ? `${distanceKm.toFixed(1)}k`
      : '0.0k',
    compactElapsedLabel: elapsedLabel,
  };
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

function HeroMetricCard({
  label,
  value,
  helper,
  tone,
}: {
  label: string;
  value: string;
  helper: string;
  tone: 'accent' | 'neutral';
}) {
  return (
    <View style={[styles.heroMetricCard, tone === 'accent' ? styles.heroMetricCardAccent : null]}>
      <AppText style={styles.heroMetricLabel}>{label}</AppText>
      <AppText style={styles.heroMetricValue}>{value}</AppText>
      <AppText style={styles.heroMetricHelper}>{helper}</AppText>
    </View>
  );
}

function RouteFactChip({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.routeFactChip}>
      <AppText style={styles.routeFactLabel}>{label}</AppText>
      <AppText style={styles.routeFactValue}>{value}</AppText>
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
    backgroundColor: '#0b0c0f',
  },
  container: {
    padding: spacing.lg,
    gap: spacing.lg + 2,
    paddingBottom: spacing.xl * 2,
  },

  // ── Card shell ───────────────────────────────────────────────────────────────
  card: {
    backgroundColor: SURFACE,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    padding: spacing.lg,
    gap: spacing.md,
    shadowColor: '#000',
    shadowOpacity: 0.28,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  heroCard: {
    padding: 0,
    overflow: 'hidden',
  },
  heroGradient: {
    padding: spacing.lg,
    gap: spacing.lg,
  },

  // ── Eyebrow ──────────────────────────────────────────────────────────────────
  eyebrow: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.8,
    color: '#ffb08a',
    textTransform: 'uppercase',
  },

  // ── Hero card ────────────────────────────────────────────────────────────────
  heroHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
    flexWrap: 'wrap',
  },
  heroHeaderCopy: {
    flex: 1,
    minWidth: 220,
    gap: 8,
  },
  heroStatusStack: {
    alignItems: 'flex-start',
    gap: 8,
  },
  heroTitle: {
    fontSize: 38,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -1.1,
  },
  heroSubtitle: {
    fontSize: 14,
    lineHeight: 20,
    color: TEXT_MUTED,
  },
  iconCircle: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconGlyph: {
    fontSize: 17,
    color: colors.text,
    fontWeight: '700',
  },

  // ── Status pill ──────────────────────────────────────────────────────────────
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: 100,
    borderWidth: 1,
    paddingHorizontal: 11,
    paddingVertical: 5,
    gap: 5,
  },
  pillDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  pillText: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.2,
  },

  // ── Hero metrics ─────────────────────────────────────────────────────────────
  heroMetricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  heroMetricCard: {
    width: '48%',
    minWidth: 148,
    flexGrow: 1,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    paddingVertical: 14,
    paddingHorizontal: 14,
    gap: 6,
  },
  heroMetricCardAccent: {
    backgroundColor: 'rgba(252,76,2,0.1)',
    borderColor: 'rgba(252,76,2,0.18)',
  },
  heroMetricLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.3,
    color: TEXT_MUTED,
    textTransform: 'uppercase',
  },
  heroMetricValue: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.8,
  },
  heroMetricHelper: {
    fontSize: 12,
    color: TEXT_MUTED,
  },
  heroMapSection: {
    gap: spacing.sm,
  },
  inlineHeadingRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
    flexWrap: 'wrap',
  },
  inlineHeadingCopy: {
    flex: 1,
    minWidth: 220,
    gap: 4,
  },
  inlineSectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.3,
  },
  inlineSectionSubtitle: {
    fontSize: 13,
    color: TEXT_MUTED,
    lineHeight: 18,
  },
  routeFactGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  routeFactChip: {
    minWidth: '30%',
    flexGrow: 1,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    paddingVertical: 11,
    paddingHorizontal: 12,
    gap: 4,
  },
  routeFactLabel: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1.2,
    color: TEXT_MUTED,
    textTransform: 'uppercase',
  },
  routeFactValue: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },

  // ── Sport selector ───────────────────────────────────────────────────────────
  sportGrid: {
    flexDirection: 'row',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  sportCell: {
    flex: 1,
    minWidth: 96,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
    backgroundColor: SURFACE_SOFT,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
    gap: 3,
  },
  sportCellActive: {
    borderColor: TEAL,
    backgroundColor: `${TEAL}12`,
  },
  sportCellDisabled: {
    opacity: 0.4,
  },
  sportCellLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: TEXT_MUTED,
    letterSpacing: -0.2,
  },
  sportCellLabelActive: {
    color: TEAL,
  },
  sportCellTagline: {
    fontSize: 10,
    color: 'rgba(169,176,184,0.68)',
    letterSpacing: 0.3,
  },

  // ── CTA / controls ───────────────────────────────────────────────────────────
  ctaButton: {
    backgroundColor: TEAL,
    borderRadius: 18,
    paddingVertical: 16,
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
    color: '#fff7f2',
    letterSpacing: 0.2,
  },
  controlPair: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  secondaryButton: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    paddingVertical: 14,
    alignItems: 'center',
  },
  secondaryButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  ghostButton: {
    flex: 1,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(252,76,2,0.18)',
    backgroundColor: 'rgba(252,76,2,0.05)',
    paddingVertical: 14,
    alignItems: 'center',
  },
  ghostButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ffd1bf',
  },
  feedbackBanner: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
    backgroundColor: 'rgba(255,255,255,0.04)',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  feedbackText: {
    fontSize: 12,
    color: TEXT_MUTED,
    textAlign: 'center',
    lineHeight: 18,
  },

  // ── Card header row ───────────────────────────────────────────────────────────
  sectionIntro: {
    gap: 6,
  },
  sectionIntroCompact: {
    gap: 4,
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  titleStack: {
    gap: 4,
    flex: 1,
    minWidth: 160,
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.4,
  },
  cardSubtitle: {
    fontSize: 12,
    color: TEXT_MUTED,
  },
  linkText: {
    fontSize: 12,
    color: '#ffd1bf',
    marginLeft: 'auto',
    fontWeight: '700',
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
    width: '48%',
    flexGrow: 1,
    backgroundColor: SURFACE_ALT,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    paddingVertical: 12,
    paddingHorizontal: 12,
    gap: 4,
  },
  metricSubLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
    color: TEXT_MUTED,
    textTransform: 'uppercase',
  },
  metricSubValue: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.4,
  },
  metricSubSublabel: {
    fontSize: 10,
    color: TEXT_MUTED,
    letterSpacing: 0.3,
  },

  // ── Route map card ────────────────────────────────────────────────────────────
  routeMapCard: {
    height: 320,
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: '#13161a',
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
    backgroundColor: 'rgba(10,11,13,0.82)',
    paddingVertical: 10,
    paddingHorizontal: 14,
    gap: 12,
  },
  routeBottomItem: {
    fontSize: 12,
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
    fontSize: 12,
    color: TEXT_MUTED,
    lineHeight: 18,
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
  liveFeedPanel: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
    gap: spacing.sm,
  },
  liveFeedHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
  },
  liveFeedTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  liveFeedValue: {
    fontSize: 13,
    fontWeight: '700',
    color: '#ffd1bf',
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
    color: TEXT_MUTED,
    lineHeight: 19,
  },
  errorText: {
    marginTop: spacing.sm,
    color: colors.danger,
    fontSize: 13,
  },

  // ── Auto-pause banner ─────────────────────────────────────────────────────────
  autoPauseBanner: {
    backgroundColor: `${ORANGE}16`,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: `${ORANGE}55`,
    paddingVertical: 10,
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
    gap: 8,
    paddingTop: 2,
  },
  splitsTitle: {
    fontSize: 10,
    fontWeight: '700',
    color: '#ffb08a',
    textTransform: 'uppercase',
    letterSpacing: 1.4,
    marginBottom: 2,
  },
  splitRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 11,
    paddingHorizontal: 14,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  splitKmLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: TEXT_MUTED,
    letterSpacing: 0.8,
  },
  splitPaceValue: {
    fontSize: 16,
    fontWeight: '700',
    color: TEAL,
    letterSpacing: -0.3,
  },

  // ── Sync sources ─────────────────────────────────────────────────────────────
  syncGrid: {
    gap: spacing.sm,
  },
  syncPanel: {
    gap: spacing.sm,
    backgroundColor: SURFACE_ALT,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    padding: spacing.md,
  },
  syncPanelHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  syncPanelCopy: {
    flex: 1,
    gap: 6,
  },
  syncPanelTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.2,
  },
  syncActionButton: {
    backgroundColor: `${PURPLE}16`,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: `${PURPLE}48`,
    paddingVertical: 13,
    alignItems: 'center',
  },
  syncActionText: {
    fontSize: 14,
    fontWeight: '700',
    color: PURPLE,
  },
  syncActionGhost: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: `${ORANGE}40`,
    backgroundColor: `${ORANGE}10`,
    paddingVertical: 13,
    alignItems: 'center',
  },
  syncActionGhostText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#ffd1bf',
  },
});
