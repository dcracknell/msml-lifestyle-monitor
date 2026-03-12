import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View, Pressable, ScrollView } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Svg, { Circle, Line, Polyline, Rect } from 'react-native-svg';
import {
  AppButton,
  AppText,
  Card,
  ProgressRing,
  SectionHeader,
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

type SportId = 'run' | 'ride' | 'walk';

interface SportOption {
  id: SportId;
  label: string;
  tagline: string;
  match: string;
}

type SessionState = 'idle' | 'recording' | 'paused';

type ExerciseAction = 'start' | 'pause' | 'resume' | 'stop';
type PhoneTrackerSource = 'expo-location' | 'geolocation';

interface PhoneGeoPoint {
  latitude: number;
  longitude: number;
  timestamp: number;
}

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

const PROGRESS_MAX_MINUTES = 120;
const HERO_GRADIENT = colors.gradient as [string, string, ...string[]];
const WATCH_COMMAND_TIMEOUT_MS = 3500;
const PHONE_TRACKER_START_TIMEOUT_MS = 4000;
const PHONE_UPLOAD_INTERVAL_MS = 15_000;
const PHONE_UPLOAD_DISTANCE_DELTA_KM = 0.05;
const PHONE_MIN_STEP_METERS = 1;
const PHONE_MAX_STEP_METERS = 300;
const WATCH_AUTO_START_FRESH_WINDOW_MS = 15_000;
const EXERCISE_STREAM_WINDOW_MS = 21 * 24 * 60 * 60 * 1000;
const ROUTE_POINT_LIMIT = 160;

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
  const [phoneDistanceKm, setPhoneDistanceKm] = useState<number | null>(null);
  const [phonePaceSeconds, setPhonePaceSeconds] = useState<number | null>(null);
  const [isPhoneTracking, setIsPhoneTracking] = useState(false);
  const [phoneTrackingSource, setPhoneTrackingSource] = useState<PhoneTrackerSource | null>(null);
  const [phoneTrackingError, setPhoneTrackingError] = useState<string | null>(null);
  const [routePoints, setRoutePoints] = useState<PhoneGeoPoint[]>([]);

  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const elapsedBeforePauseRef = useRef(0);
  const sessionStartRef = useRef<number | null>(null);
  const workoutStartedAtRef = useRef<number | null>(null);
  const workoutSourceIdRef = useRef<string | null>(null);
  const sessionStateRef = useRef<SessionState>('idle');
  const locationWatcherRef = useRef<null | { stop: () => void }>(null);
  const lastPhonePointRef = useRef<PhoneGeoPoint | null>(null);
  const phoneDistanceMetersRef = useRef(0);
  const lastPhoneUploadRef = useRef({ ts: 0, distanceKm: 0 });
  const phoneDistanceRef = useRef<number | null>(null);
  const phonePaceRef = useRef<number | null>(null);

  const sportConfig = useMemo(() => {
    return SPORT_OPTIONS.find((option) => option.id === selectedSport) ?? SPORT_OPTIONS[0];
  }, [selectedSport]);

  const sessions = data?.sessions || [];
  const lastSessionForSport = useMemo(() => {
    return sessions.find((session) => session.sportType?.toLowerCase().includes(sportConfig.match));
  }, [sessions, sportConfig.match]);

  useEffect(() => {
    setWorkoutMirrorSuppressed(sessionState !== 'idle');
    return () => {
      setWorkoutMirrorSuppressed(false);
    };
  }, [sessionState, setWorkoutMirrorSuppressed]);

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
      const previous = lastPhonePointRef.current;
      let acceptPoint = !previous;
      if (previous) {
        const deltaMeters = haversineDistanceMeters(previous, point);
        if (
          Number.isFinite(deltaMeters) &&
          deltaMeters >= PHONE_MIN_STEP_METERS &&
          deltaMeters <= PHONE_MAX_STEP_METERS
        ) {
          phoneDistanceMetersRef.current += deltaMeters;
          acceptPoint = true;
        }
      }
      if (!acceptPoint) {
        return;
      }
      lastPhonePointRef.current = point;
      setRoutePoints((current) => appendRoutePoint(current, point));

      const distanceKm = phoneDistanceMetersRef.current / 1000;
      const activeDurationMs =
        elapsedBeforePauseRef.current +
        (sessionStartRef.current ? Math.max(0, Date.now() - sessionStartRef.current) : 0);
      const paceSeconds =
        distanceKm > 0.02 && activeDurationMs > 0
          ? Math.round((activeDurationMs / 1000) / distanceKm)
          : null;

      setPhoneDistanceKm(distanceKm);
      setPhonePaceSeconds(paceSeconds);
      void uploadPhoneMetrics(distanceKm, paceSeconds);
    },
    [uploadPhoneMetrics]
  );

  const stopPhoneTracking = useCallback(() => {
    locationWatcherRef.current?.stop();
    locationWatcherRef.current = null;
    setIsPhoneTracking(false);
    setPhoneTrackingSource(null);
    lastPhonePointRef.current = null;
  }, []);

  const resetPhoneTracking = useCallback(() => {
    stopPhoneTracking();
    phoneDistanceMetersRef.current = 0;
    lastPhoneUploadRef.current = { ts: 0, distanceKm: 0 };
    setPhoneDistanceKm(null);
    setPhonePaceSeconds(null);
    setPhoneTrackingError(null);
    setRoutePoints([]);
    phoneDistanceRef.current = null;
    phonePaceRef.current = null;
  }, [stopPhoneTracking]);

  const startPhoneTracking = useCallback(async () => {
    if (locationWatcherRef.current) {
      return true;
    }
    setPhoneTrackingError(null);
    const createPoint = (
      latitude: number | null | undefined,
      longitude: number | null | undefined,
      timestamp?: number | null
    ) => {
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        return;
      }
      handlePhoneLocationPoint({
        latitude: latitude as number,
        longitude: longitude as number,
        timestamp: Number.isFinite(timestamp as number) ? Math.round(timestamp as number) : Date.now(),
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
              location?.timestamp ?? Date.now()
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
            position?.timestamp ?? Date.now()
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
  const displayPaceSeconds =
    watchMetrics.pace !== null
      ? watchMetrics.pace
      : phonePaceSeconds !== null
      ? phonePaceSeconds
      : lastSessionForSport?.averagePace ?? null;
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
  const trackerLabel =
    phoneTrackingSource === 'expo-location'
      ? 'Phone GPS'
      : phoneTrackingSource === 'geolocation'
      ? 'Fallback GPS'
      : sessionState === 'recording'
      ? 'Starting'
      : 'Standby';
  const routeSummary = [
    { label: 'Status', value: sessionState === 'idle' ? 'Ready' : titleCase(sessionState) },
    { label: 'Source', value: liveSourceLabel },
    { label: 'Tracker', value: trackerLabel },
    { label: 'GPS points', value: routePoints.length ? String(routePoints.length) : '--' },
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

      const workoutPayload = {
        sourceId,
        name: `${sportConfig.label} workout`,
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
        workoutStatus: workoutResult.status,
      };
    },
    [invalidateActivityData, runOrQueue, sportConfig.id, sportConfig.label]
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
    workoutSourceIdRef.current = buildWorkoutSourceId(sportConfig.id, startedAt);
    setElapsedMs(0);
    setSessionState('recording');
    sessionStateRef.current = 'recording';
    setFeedback('Workout data detected from watch. Recording started automatically.');
    void startPhoneTracking();
  }, [latestWatchSignalTs, sessionState, sportConfig.id, startPhoneTracking]);

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
      const elapsedAtStop = stopRequested
        ? elapsedBeforePauseRef.current +
          (sessionStartRef.current ? Math.max(0, endedAt - sessionStartRef.current) : 0)
        : 0;
      const finalDistance =
        stopRequested && liveDistanceKm > 0
          ? liveDistanceKm
          : stopRequested
          ? phoneDistanceRef.current
          : null;
      const finalPace =
        stopRequested && watchMetrics.pace !== null ? watchMetrics.pace : stopRequested ? phonePaceRef.current : null;
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
        workoutSourceIdRef.current = buildWorkoutSourceId(sportConfig.id, startedAt);
        setElapsedMs(0);
      } else if (nextState === 'recording') {
        sessionStartRef.current = Date.now();
      } else if (nextState === 'paused') {
        elapsedBeforePauseRef.current += Date.now() - (sessionStartRef.current || Date.now());
        sessionStartRef.current = null;
      } else {
        sessionStartRef.current = null;
        setElapsedMs(0);
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
      stopPhoneTracking();
      workoutStartedAtRef.current = null;
      workoutSourceIdRef.current = null;
    };
  }, [stopPhoneTracking]);

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

  const elapsedMinutes = Math.floor(elapsedMs / 60000);
  const timerLabel = formatElapsed(elapsedMs);
  const isSportSelectionDisabled = sessionState !== 'idle';

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <Card padded={false} style={styles.heroCard}>
        <LinearGradient colors={HERO_GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.heroGradient}>
          <View style={styles.heroHeader}>
            <AppText variant="eyebrow">Exercise</AppText>
            <AppText variant="heading" style={styles.heroTitle}>
              {sportConfig.label}
            </AppText>
            <AppText variant="body">{heroStatusCopy}</AppText>
          </View>
          <View style={styles.sportRow}>
            {SPORT_OPTIONS.map((option) => (
              <Pressable
                key={option.id}
                onPress={() => {
                  if (!isSportSelectionDisabled) {
                    setSelectedSport(option.id);
                  }
                }}
                disabled={isSportSelectionDisabled && option.id !== selectedSport}
                style={[
                  styles.sportChip,
                  option.id === selectedSport ? styles.sportChipActive : null,
                  isSportSelectionDisabled && option.id !== selectedSport ? styles.sportChipDisabled : null,
                ]}
              >
                <AppText variant="label" style={styles.sportTagline}>
                  {option.tagline}
                </AppText>
                <AppText variant="heading">{option.label}</AppText>
              </Pressable>
            ))}
          </View>
          <View style={styles.timerBlock}>
            <ProgressRing value={elapsedMinutes} max={PROGRESS_MAX_MINUTES} size={160} label="min" />
            <View style={styles.timerMeta}>
              <AppText variant="eyebrow">Duration</AppText>
              <AppText variant="heading" style={styles.timerValue}>
                {timerLabel}
              </AppText>
              <View style={styles.timerMetrics}>
                <InlineMetric label="Distance" value={formatKilometers(displayDistanceKm)} />
                <InlineMetric label="Pace" value={formatPace(displayPaceSeconds)} />
                <InlineMetric label="Heart rate" value={formatHeartRate(displayHeartRate)} />
              </View>
            </View>
          </View>
          <View style={styles.controlRow}>
            {sessionState === 'idle' ? (
              <AppButton
                title={`Start ${sportConfig.label.toLowerCase()}`}
                onPress={handleStart}
                loading={controlLoading}
                style={styles.primaryControl}
              />
            ) : (
              <>
                <AppButton
                  title={sessionState === 'recording' ? 'Pause' : 'Resume'}
                  variant="secondary"
                  onPress={sessionState === 'recording' ? handlePause : handleResume}
                  loading={controlLoading}
                  style={styles.controlButton}
                />
                <AppButton
                  title="Finish"
                  variant="ghost"
                  onPress={handleFinish}
                  disabled={controlLoading}
                  style={styles.controlButton}
                />
              </>
            )}
          </View>
          {feedback ? (
            <AppText variant="muted" style={styles.feedbackText}>
              {feedback}
            </AppText>
          ) : null}
        </LinearGradient>
      </Card>

      <Card>
        <SectionHeader title={routeTitle} subtitle={routeSubtitle} />
        <View style={styles.routeCard}>
          <RoutePreview points={routePoints} active={sessionState === 'recording'} />
          <View style={styles.summaryGrid}>
            {routeSummary.map((item) => (
              <SummaryTile key={item.label} label={item.label} value={item.value} compact />
            ))}
          </View>
          <AppText variant="muted" style={styles.liveHint}>
            Route drawing uses phone GPS during a live workout. When there is no active route, this screen falls back to
            your latest session metrics.
          </AppText>
        </View>
        {phoneTrackingError ? <AppText style={styles.errorText}>{phoneTrackingError}</AppText> : null}
      </Card>

      <Card>
        <SectionHeader title="Training snapshot" subtitle="This week" />
        <View style={styles.summaryGrid}>
          {trainingSnapshot.map((item) => (
            <SummaryTile key={item.label} label={item.label} value={item.value} />
          ))}
        </View>
      </Card>

      <Card>
        <SectionHeader title="Exercise trends" subtitle="Heart rate and distance over the last 21 days" />
        {heartRateTrend.length ? (
          <TrendChart data={heartRateTrend} yLabel="bpm" />
        ) : (
          <AppText variant="muted">Heart-rate history will appear after you record or sync sessions.</AppText>
        )}
        {distanceTrend.length ? (
          <View style={styles.trendSpacing}>
            <TrendChart data={distanceTrend} yLabel="km" />
          </View>
        ) : (
          <AppText variant="muted">Distance history will appear after you record or sync sessions.</AppText>
        )}
      </Card>

      <Card>
        <SectionHeader
          title="Last effort"
          subtitle={lastSessionForSport ? formatDateTime(lastSessionForSport.startTime, 'MMM D · HH:mm') : 'Awaiting sync'}
          action={
            <AppButton
              title="See sessions"
              variant="ghost"
              onPress={() => navigation.navigate('Sessions' as never)}
              disabled={isFetching}
            />
          }
        />
        {isFetching && !data ? (
          <AppText variant="muted">Syncing activity…</AppText>
        ) : lastSessionForSport ? (
          <View style={styles.lastSession}>
            <AppText variant="heading">{lastSessionForSport.name}</AppText>
            <AppText variant="muted">Source: {lastSessionForSport.source || 'session history'}</AppText>
            <View style={styles.lastSessionStats}>
              <InlineMetric label="Distance" value={formatDistance(lastSessionForSport.distance)} />
              <InlineMetric label="Pace" value={formatPace(lastSessionForSport.averagePace)} />
              <InlineMetric label="Avg HR" value={formatHeartRate(lastSessionForSport.averageHr)} />
              <InlineMetric
                label="Duration"
                value={formatDurationSeconds(lastSessionForSport.elapsedTime || lastSessionForSport.movingTime)}
              />
            </View>
          </View>
        ) : (
          <AppText variant="muted">No {sportConfig.label.toLowerCase()} recorded yet.</AppText>
        )}
      </Card>
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
  if (nextPoints.length <= ROUTE_POINT_LIMIT) {
    return nextPoints;
  }
  return nextPoints.slice(nextPoints.length - ROUTE_POINT_LIMIT);
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

function RoutePreview({ points, active }: { points: PhoneGeoPoint[]; active: boolean }) {
  const preview = buildRoutePreview(points);

  return (
    <View style={styles.routeCanvas}>
      <Svg width="100%" height="100%" viewBox="0 0 100 100">
        <Rect x={0} y={0} width={100} height={100} rx={18} fill="rgba(255,255,255,0.02)" />
        {[20, 40, 60, 80].map((offset) => (
          <Line
            key={`horizontal-${offset}`}
            x1={10}
            y1={offset}
            x2={90}
            y2={offset}
            stroke="rgba(255,255,255,0.06)"
            strokeWidth={0.6}
          />
        ))}
        {[20, 40, 60, 80].map((offset) => (
          <Line
            key={`vertical-${offset}`}
            x1={offset}
            y1={10}
            x2={offset}
            y2={90}
            stroke="rgba(255,255,255,0.06)"
            strokeWidth={0.6}
          />
        ))}
        <Polyline
          points="16,70 30,54 42,59 55,41 72,47 84,33"
          fill="none"
          stroke="rgba(255,255,255,0.12)"
          strokeWidth={2}
          strokeDasharray="4 6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {preview ? (
          <>
            <Polyline
              points={preview.points}
              fill="none"
              stroke={active ? colors.accent : colors.accentStrong}
              strokeWidth={3.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <Circle cx={preview.start.x} cy={preview.start.y} r={2.8} fill={colors.success} />
            <Circle cx={preview.end.x} cy={preview.end.y} r={3.2} fill={colors.accent} />
          </>
        ) : null}
      </Svg>
      <View style={styles.routeOverlay}>
        <AppText variant="label" style={styles.routeOverlayLabel}>
          {preview ? 'Start to finish' : 'Preview'}
        </AppText>
        <AppText variant="body" style={styles.routeOverlayText}>
          {preview ? 'Live route locked to your GPS path.' : 'Start moving outdoors to draw your route.'}
        </AppText>
      </View>
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

function SummaryTile({
  label,
  value,
  compact = false,
}: {
  label: string;
  value: string;
  compact?: boolean;
}) {
  return (
    <View style={[styles.summaryTile, compact ? styles.summaryTileCompact : null]}>
      <AppText variant="label">{label}</AppText>
      <AppText variant="heading" style={[styles.summaryValue, compact ? styles.summaryValueCompact : null]}>
        {value}
      </AppText>
    </View>
  );
}

function InlineMetric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.inlineMetric}>
      <AppText variant="label">{label}</AppText>
      <AppText variant="body">{value}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
  heroCard: {
    borderRadius: 28,
    overflow: 'hidden',
    borderColor: colors.border,
    borderWidth: 1,
  },
  heroGradient: {
    width: '100%',
    padding: spacing.lg,
    gap: spacing.lg,
  },
  heroHeader: {
    gap: spacing.xs,
  },
  heroTitle: {
    fontSize: 42,
  },
  sportRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  sportChip: {
    flex: 1,
    minWidth: 110,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
    backgroundColor: 'rgba(0,0,0,0.12)',
  },
  sportChipActive: {
    borderColor: colors.accent,
    backgroundColor: 'rgba(0,0,0,0.2)',
  },
  sportChipDisabled: {
    opacity: 0.5,
  },
  sportTagline: {
    color: colors.muted,
  },
  timerBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
  },
  timerMeta: {
    flex: 1,
    gap: spacing.xs,
  },
  timerValue: {
    fontSize: 44,
  },
  timerMetrics: {
    flexDirection: 'row',
    gap: spacing.md,
    flexWrap: 'wrap',
    marginTop: spacing.xs,
  },
  controlRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  primaryControl: {
    flex: 1,
  },
  controlButton: {
    flex: 1,
    minWidth: 140,
  },
  feedbackText: {
    marginTop: spacing.xs,
  },
  routeCard: {
    gap: spacing.md,
  },
  routeCanvas: {
    height: 240,
    borderRadius: 22,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: 'rgba(1, 9, 21, 0.8)',
  },
  routeOverlay: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    bottom: spacing.md,
    padding: spacing.sm,
    borderRadius: 16,
    backgroundColor: 'rgba(1, 9, 21, 0.72)',
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.xs,
  },
  routeOverlayLabel: {
    color: colors.accent,
  },
  routeOverlayText: {
    color: colors.text,
  },
  liveHint: {
    marginTop: spacing.sm,
  },
  summaryGrid: {
    flexDirection: 'row',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  summaryTile: {
    minWidth: 140,
    flex: 1,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: 'rgba(255,255,255,0.03)',
    padding: spacing.md,
    gap: spacing.xs,
  },
  summaryTileCompact: {
    minWidth: 96,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  summaryValue: {
    fontSize: 28,
  },
  summaryValueCompact: {
    fontSize: 20,
  },
  trendSpacing: {
    marginTop: spacing.md,
  },
  lastSession: {
    gap: spacing.sm,
  },
  lastSessionStats: {
    flexDirection: 'row',
    gap: spacing.md,
    flexWrap: 'wrap',
  },
  inlineMetric: {
    flex: 1,
  },
  errorText: {
    marginTop: spacing.sm,
    color: colors.danger,
  },
});
