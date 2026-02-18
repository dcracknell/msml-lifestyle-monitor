import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View, Pressable, ScrollView } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import {
  AppButton,
  AppText,
  Card,
  ProgressRing,
  SectionHeader,
} from '../../components';
import { activityRequest } from '../../api/endpoints';
import { useAuth } from '../../providers/AuthProvider';
import { useSubject } from '../../providers/SubjectProvider';
import { useBluetooth } from '../../providers/BluetoothProvider';
import { colors, spacing } from '../../theme';
import { formatDateTime, formatDistance, formatPace, titleCase } from '../../utils/format';

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
const EXERCISE_BUILD_MARKER = 'run-fix-2026-02-18-b';

export function ExerciseScreen() {
  const navigation = useNavigation();
  const { user } = useAuth();
  const { subjectId } = useSubject();
  const requestSubject = subjectId && subjectId !== user?.id ? subjectId : undefined;

  const {
    config,
    bluetoothState,
    status,
    isPoweredOn,
    isScanning,
    connectedDevice,
    recentSamples,
    error: bluetoothError,
    startScan,
    stopScan,
    disconnectFromDevice,
    sendCommand,
    manualPublish,
  } = useBluetooth();

  const { data, isFetching } = useQuery({
    queryKey: ['exercise', requestSubject || user?.id],
    queryFn: () => activityRequest({ athleteId: requestSubject }),
    enabled: Boolean(user?.id),
  });

  const [selectedSport, setSelectedSport] = useState<SportId>('run');
  const [sessionState, setSessionState] = useState<SessionState>('idle');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [controlLoading, setControlLoading] = useState(false);
  const [scanLoading, setScanLoading] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [phoneDistanceKm, setPhoneDistanceKm] = useState<number | null>(null);
  const [phonePaceSeconds, setPhonePaceSeconds] = useState<number | null>(null);
  const [isPhoneTracking, setIsPhoneTracking] = useState(false);
  const [phoneTrackingSource, setPhoneTrackingSource] = useState<PhoneTrackerSource | null>(null);
  const [phoneTrackingError, setPhoneTrackingError] = useState<string | null>(null);

  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const elapsedBeforePauseRef = useRef(0);
  const sessionStartRef = useRef<number | null>(null);
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

      try {
        await manualPublish(distanceKm, DEVICE_METRICS.distance);
        if (paceSeconds !== null && Number.isFinite(paceSeconds)) {
          await manualPublish(paceSeconds, DEVICE_METRICS.pace);
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
      if (previous) {
        const deltaMeters = haversineDistanceMeters(previous, point);
        if (
          Number.isFinite(deltaMeters) &&
          deltaMeters >= PHONE_MIN_STEP_METERS &&
          deltaMeters <= PHONE_MAX_STEP_METERS
        ) {
          phoneDistanceMetersRef.current += deltaMeters;
        }
      }
      lastPhonePointRef.current = point;

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
  const dataSourceLabel = [
    (watchMetrics.distance !== null || watchMetrics.pace !== null || watchMetrics.heartRate !== null) ? 'watch' : null,
    (phoneDistanceKm !== null || isPhoneTracking) ? `phone ${phoneTrackingSource ? `(${phoneTrackingSource})` : ''}` : null,
  ]
    .filter(Boolean)
    .join(' + ');

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

  useEffect(() => {
    if (sessionState !== 'idle' || latestWatchSignalTs <= 0) {
      return;
    }
    const ageMs = Date.now() - latestWatchSignalTs;
    if (ageMs < 0 || ageMs > WATCH_AUTO_START_FRESH_WINDOW_MS) {
      return;
    }
    elapsedBeforePauseRef.current = 0;
    sessionStartRef.current = Date.now();
    setElapsedMs(0);
    setSessionState('recording');
    sessionStateRef.current = 'recording';
    setFeedback('Workout data detected from watch. Recording started automatically.');
    void startPhoneTracking();
  }, [latestWatchSignalTs, sessionState, startPhoneTracking]);

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
        elapsedBeforePauseRef.current = 0;
        sessionStartRef.current = Date.now();
        setElapsedMs(0);
      } else if (nextState === 'recording') {
        sessionStartRef.current = Date.now();
      } else if (nextState === 'paused') {
        elapsedBeforePauseRef.current += Date.now() - (sessionStartRef.current || Date.now());
        sessionStartRef.current = null;
      } else {
        elapsedBeforePauseRef.current = 0;
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
        const finalDistance = phoneDistanceRef.current;
        const finalPace = phonePaceRef.current;
        if (finalDistance !== null && Number.isFinite(finalDistance) && finalDistance > 0) {
          await uploadPhoneMetrics(finalDistance, finalPace, true);
        }
        resetPhoneTracking();
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

  const handleToggleScan = async () => {
    if (!isPoweredOn) {
      setFeedback('Turn on Bluetooth to scan for your watch.');
      return;
    }
    setScanLoading(true);
    try {
      if (isScanning) {
        stopScan();
      } else {
        await startScan();
      }
    } finally {
      setScanLoading(false);
    }
  };

  const handleDisconnect = async () => {
    await disconnectFromDevice();
    setFeedback('Disconnected from watch.');
  };

  const elapsedMinutes = Math.floor(elapsedMs / 60000);
  const timerLabel = formatElapsed(elapsedMs);
  const adapterStateLabel = formatBluetoothState(bluetoothState);
  const connectionCopy = connectedDevice
    ? `Connected to ${connectedDevice.name || 'custom watch'}`
    : config.profile === 'apple_watch_companion'
    ? 'Apple Watch companion ready — open the companion app, then connect.'
    : isPoweredOn
    ? 'Bluetooth ready — tap scan to find your watch.'
    : `Adapter: ${adapterStateLabel}`;

  const isSportSelectionDisabled = sessionState !== 'idle';
  const statusLabel = status === 'connected' ? 'Connected' : titleCase(status);

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
            <AppText variant="body">{connectionCopy}</AppText>
            <AppText variant="muted">Build {EXERCISE_BUILD_MARKER}</AppText>
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
        <SectionHeader title="Live stats" subtitle="Updates from your watch or last session" />
        <View style={styles.liveRow}>
          <LiveMetric label="Distance" value={formatKilometers(displayDistanceKm)} helper="km" />
          <LiveMetric label="Pace" value={formatPace(displayPaceSeconds)} helper="/km" />
          <LiveMetric label="Heart rate" value={formatHeartRate(displayHeartRate)} helper="bpm" />
        </View>
        <AppText variant="muted" style={styles.liveHint}>
          Live source: {dataSourceLabel || 'last session'}. Metrics publish as {DEVICE_METRICS.distance},{' '}
          {DEVICE_METRICS.pace}, and {DEVICE_METRICS.heartRate}.
        </AppText>
        {phoneTrackingError ? <AppText style={styles.errorText}>{phoneTrackingError}</AppText> : null}
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
            <View style={styles.lastSessionStats}>
              <InlineMetric label="Distance" value={formatDistance(lastSessionForSport.distance)} />
              <InlineMetric label="Pace" value={formatPace(lastSessionForSport.averagePace)} />
              <InlineMetric label="Avg HR" value={formatHeartRate(lastSessionForSport.averageHr)} />
            </View>
          </View>
        ) : (
          <AppText variant="muted">No {sportConfig.label.toLowerCase()} recorded yet.</AppText>
        )}
      </Card>

      <Card>
        <SectionHeader title="Watch link" subtitle="Bluetooth bridge" />
        <View style={styles.statusPills}>
          <StatusChip label={`Adapter: ${adapterStateLabel}`} active />
          <StatusChip label={statusLabel} />
        </View>
        {connectedDevice ? (
          <View style={styles.deviceInfo}>
            <AppText variant="heading">{connectedDevice.name || 'Custom watch'}</AppText>
            <AppText variant="muted">Signal: {connectedDevice.rssi ?? '--'} dBm</AppText>
          </View>
        ) : (
          <AppText variant="muted" style={styles.liveHint}>
            Scan for your prototype watch or open the Devices tab for advanced controls.
          </AppText>
        )}
        {config.profile === 'apple_watch_companion' ? (
          <AppText variant="muted" style={styles.liveHint}>
            Apple Watch usually cannot stream directly as a BLE sensor to iPhone apps. Use a Watch companion app that
            relays JSON payloads.
          </AppText>
        ) : null}
        <View style={styles.actionsRow}>
          <AppButton
            title={isScanning ? 'Stop scan' : 'Scan for watch'}
            variant="secondary"
            onPress={handleToggleScan}
            loading={scanLoading}
            style={styles.controlButton}
          />
          <AppButton
            title="Devices panel"
            variant="ghost"
            onPress={() => navigation.navigate('Devices' as never)}
            style={styles.controlButton}
          />
        </View>
        {connectedDevice ? (
          <AppButton title="Disconnect watch" variant="ghost" onPress={handleDisconnect} style={styles.disconnectButton} />
        ) : null}
        {bluetoothError ? <AppText style={styles.errorText}>{bluetoothError}</AppText> : null}
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

function LiveMetric({ label, value, helper }: { label: string; value: string; helper?: string }) {
  return (
    <View style={styles.metricBlock}>
      <AppText variant="label">{label}</AppText>
      <AppText variant="heading">{value}</AppText>
      {helper ? (
        <AppText variant="muted" style={styles.metricHelper}>
          {helper}
        </AppText>
      ) : null}
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

function StatusChip({ label, active }: { label: string; active?: boolean }) {
  return (
    <View style={[styles.statusChip, active ? styles.statusChipActive : null]}>
      <AppText variant="label">{label}</AppText>
    </View>
  );
}

function formatBluetoothState(state: string) {
  if (!state) {
    return 'Unknown';
  }
  return state.replace(/([a-z])([A-Z])/g, '$1 $2');
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
  liveRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  metricBlock: {
    flex: 1,
  },
  metricHelper: {
    marginTop: spacing.xs / 2,
  },
  liveHint: {
    marginTop: spacing.sm,
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
  statusPills: {
    flexDirection: 'row',
    gap: spacing.sm,
    flexWrap: 'wrap',
    marginBottom: spacing.sm,
  },
  statusChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  statusChipActive: {
    borderColor: colors.accent,
  },
  deviceInfo: {
    marginBottom: spacing.sm,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  disconnectButton: {
    marginTop: spacing.sm,
  },
  errorText: {
    marginTop: spacing.sm,
    color: colors.danger,
  },
});
