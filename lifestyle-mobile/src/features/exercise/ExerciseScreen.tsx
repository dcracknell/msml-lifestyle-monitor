import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View, Pressable } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { useNavigation } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import {
  AppButton,
  AppText,
  Card,
  ProgressRing,
  RefreshableScrollView,
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

export function ExerciseScreen() {
  const navigation = useNavigation();
  const { user } = useAuth();
  const { subjectId } = useSubject();
  const requestSubject = subjectId && subjectId !== user?.id ? subjectId : undefined;

  const {
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
  } = useBluetooth();

  const { data, refetch, isFetching, isRefetching } = useQuery({
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

  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const elapsedBeforePauseRef = useRef(0);
  const sessionStartRef = useRef<number | null>(null);

  const sportConfig = useMemo(() => {
    return SPORT_OPTIONS.find((option) => option.id === selectedSport) ?? SPORT_OPTIONS[0];
  }, [selectedSport]);

  const sessions = data?.sessions || [];
  const lastSessionForSport = useMemo(() => {
    return sessions.find((session) => session.sportType?.toLowerCase().includes(sportConfig.match));
  }, [sessions, sportConfig.match]);

  const liveMetrics = useMemo(() => {
    const result: Record<keyof typeof DEVICE_METRICS, number | null> = {
      distance: null,
      pace: null,
      heartRate: null,
    };
    for (let index = recentSamples.length - 1; index >= 0; index -= 1) {
      const sample = recentSamples[index];
      if (sample.metric === DEVICE_METRICS.distance && result.distance === null) {
        result.distance = Number.isFinite(sample.value as number) ? (sample.value as number) : null;
      }
      if (sample.metric === DEVICE_METRICS.pace && result.pace === null) {
        result.pace = Number.isFinite(sample.value as number) ? (sample.value as number) : null;
      }
      if (sample.metric === DEVICE_METRICS.heartRate && result.heartRate === null) {
        result.heartRate = Number.isFinite(sample.value as number) ? (sample.value as number) : null;
      }
      if (result.distance !== null && result.pace !== null && result.heartRate !== null) {
        break;
      }
    }
    return result;
  }, [recentSamples]);

  const displayDistanceKm =
    liveMetrics.distance !== null
      ? liveMetrics.distance
      : lastSessionForSport?.distance
      ? (lastSessionForSport.distance || 0) / 1000
      : null;
  const displayPaceSeconds =
    liveMetrics.pace !== null
      ? liveMetrics.pace
      : lastSessionForSport?.averagePace ?? null;
  const displayHeartRate =
    liveMetrics.heartRate !== null ? liveMetrics.heartRate : lastSessionForSport?.averageHr ?? null;

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

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, []);

  const ensureConnected = () => {
    if (!connectedDevice) {
      setFeedback('Connect your watch before starting an activity.');
      return false;
    }
    return true;
  };

  const sendExerciseCommand = async (action: ExerciseAction, nextState: SessionState, resetTimer?: boolean) => {
    if (!ensureConnected()) {
      return;
    }
    setControlLoading(true);
    try {
      await sendCommand(
        JSON.stringify({
          type: 'exercise-control',
          action,
          sport: sportConfig.id,
          timestamp: new Date().toISOString(),
          durationMs: elapsedMs,
        })
      );
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
      setSessionState(nextState);
      setFeedback(buildSuccessMessage(action));
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to control the watch.';
      setFeedback(message);
    } finally {
      setControlLoading(false);
    }
  };

  const handleStart = () => sendExerciseCommand('start', 'recording', true);
  const handlePause = () => sendExerciseCommand('pause', 'paused');
  const handleResume = () => sendExerciseCommand('resume', 'recording');
  const handleFinish = () => sendExerciseCommand('stop', 'idle');

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
    : isPoweredOn
    ? 'Bluetooth ready — tap scan to find your watch.'
    : `Adapter: ${adapterStateLabel}`;

  const isSportSelectionDisabled = sessionState !== 'idle';
  const statusLabel = status === 'connected' ? 'Connected' : titleCase(status);

  return (
    <RefreshableScrollView
      contentContainerStyle={styles.container}
      refreshing={isRefetching}
      onRefresh={refetch}
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
                disabled={!connectedDevice}
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
          Samples use metric names {DEVICE_METRICS.distance}, {DEVICE_METRICS.pace}, and {DEVICE_METRICS.heartRate}.
        </AppText>
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
    </RefreshableScrollView>
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

function buildSuccessMessage(action: ExerciseAction) {
  switch (action) {
    case 'start':
      return 'Recording started on the watch.';
    case 'pause':
      return 'Workout paused.';
    case 'resume':
      return 'Workout resumed.';
    case 'stop':
      return 'Workout saved on the watch.';
    default:
      return null;
  }
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
