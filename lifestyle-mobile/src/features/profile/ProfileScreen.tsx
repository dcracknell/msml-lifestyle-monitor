import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Image,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { updateProfileRequest } from '../../api/endpoints';
import { useAuth } from '../../providers/AuthProvider';
import { useApiConfig } from '../../providers/ApiConfigProvider';
import { useSyncQueue } from '../../providers/SyncProvider';
import {
  AppButton,
  AppInput,
  AppText,
  Card,
  SectionHeader,
} from '../../components';
import { colors, spacing } from '../../theme';
import { getImagePickerMissingMessage, getImagePickerModule } from '../../utils/imagePicker';
import { formatDate, formatNumber } from '../../utils/format';
import {
  getPedometerMissingMessage,
  getPedometerModule,
  isPermissionGranted,
} from '../../utils/pedometer';
import { useQueryClient } from '@tanstack/react-query';
import { getAppleHealthMissingMessage, readAppleHealthPayload } from '../../utils/appleHealth';
import { AppleHealthWorkoutImport, parseAppleHealthPayload } from './appleHealthImport';

// ---------------------------------------------------------------------------
// Types and constants
// ---------------------------------------------------------------------------

type PhoneAccessStatus = 'unknown' | 'granted' | 'denied' | 'unavailable';
type StreamBatch = { metric: string; samples: Array<{ ts: number; value: number | null }> };

export type AccountCardHandle = { submit: () => Promise<void> };
export type AccountCardProps = { onDirtyChange?: (dirty: boolean) => void };

const PHONE_STEPS_METRIC = 'phone.steps';
const PHONE_SYNC_OPT_IN_KEY = 'msml.settings.syncPhoneData';
const APPLE_HEALTH_LAST_SYNC_KEY = 'msml.settings.appleHealthLastSyncTs';
const STREAM_UPLOAD_CHUNK_SIZE = 1000;
const WORKOUT_UPLOAD_CHUNK_SIZE = 120;
const APPLE_HEALTH_INITIAL_LOOKBACK_DAYS = 30;
const APPLE_HEALTH_RESYNC_BUFFER_HOURS = 24;

// ---------------------------------------------------------------------------
// Shared helper component
// ---------------------------------------------------------------------------

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={sharedStyles.metric}>
      <AppText variant="label">{label}</AppText>
      <AppText variant="heading">{value}</AppText>
    </View>
  );
}

// ---------------------------------------------------------------------------
// AccountCard
// ---------------------------------------------------------------------------

export const AccountCard = forwardRef<AccountCardHandle, AccountCardProps>(
  function AccountCard({ onDirtyChange }, ref) {
    const { user, setSessionFromPayload } = useAuth();

    const [form, setForm] = useState({
      name: user?.name || '',
      email: user?.email || '',
      weightCategory: user?.weight_category || '',
      password: '',
      currentPassword: '',
      avatarUrl: user?.avatar_url || '',
      avatarPhoto: user?.avatar_photo || null as string | null,
    });
    const [feedback, setFeedback] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [photoStatus, setPhotoStatus] = useState<string | null>(null);
    const [showAvatarSheet, setShowAvatarSheet] = useState(false);
    const [showAdvancedAvatar, setShowAdvancedAvatar] = useState(false);

    const handleChange = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => {
      setForm((prev) => ({ ...prev, [key]: value }));
    };

    const isDirty = useMemo(() => {
      if (form.name !== (user?.name || '')) return true;
      if (form.email !== (user?.email || '')) return true;
      if (form.weightCategory !== (user?.weight_category || '')) return true;
      if (form.password !== '') return true;
      if (form.avatarUrl !== (user?.avatar_url || '')) return true;
      if (form.avatarPhoto !== (user?.avatar_photo || null)) return true;
      return false;
    }, [form, user]);

    useEffect(() => {
      onDirtyChange?.(isDirty);
    }, [isDirty, onDirtyChange]);

    const derivedAvatarPhoto =
      typeof form.avatarPhoto === 'string' && form.avatarPhoto.length > 0
        ? form.avatarPhoto
        : form.avatarPhoto === null
        ? null
        : user?.avatar_photo || null;

    const previewUri = derivedAvatarPhoto
      ? `data:image/jpeg;base64,${derivedAvatarPhoto}`
      : form.avatarUrl || user?.avatar_url || null;

    const handleTakePhoto = async () => {
      setShowAvatarSheet(false);
      setPhotoStatus(null);
      try {
        const imagePicker = getImagePickerModule();
        if (!imagePicker) {
          setPhotoStatus(getImagePickerMissingMessage());
          return;
        }
        const permission = await imagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          setPhotoStatus('Camera permission is required.');
          return;
        }
        const result = await imagePicker.launchCameraAsync({
          allowsEditing: false,
          quality: 0.5,
          base64: true,
        });
        if (result.canceled) {
          setPhotoStatus('Capture cancelled.');
          return;
        }
        const base64 = result.assets?.[0]?.base64;
        if (base64) {
          handleChange('avatarPhoto', base64);
          handleChange('avatarUrl', '');
          setPhotoStatus('Profile photo updated.');
        } else {
          setPhotoStatus('Unable to attach photo.');
        }
      } catch {
        setPhotoStatus(getImagePickerMissingMessage());
      }
    };

    const handlePickFromLibrary = async () => {
      setShowAvatarSheet(false);
      setPhotoStatus(null);
      try {
        const imagePicker = getImagePickerModule();
        if (!imagePicker) {
          setPhotoStatus(getImagePickerMissingMessage());
          return;
        }
        const permission = await imagePicker.requestMediaLibraryPermissionsAsync();
        if (!permission.granted) {
          setPhotoStatus('Photo library permission is required.');
          return;
        }
        const result = await imagePicker.launchImageLibraryAsync({
          allowsEditing: false,
          quality: 0.5,
          base64: true,
        });
        if (result.canceled) {
          setPhotoStatus('Selection cancelled.');
          return;
        }
        const base64 = result.assets?.[0]?.base64;
        if (base64) {
          handleChange('avatarPhoto', base64);
          handleChange('avatarUrl', '');
          setPhotoStatus('Photo selected.');
        } else {
          setPhotoStatus('Unable to attach photo.');
        }
      } catch {
        setPhotoStatus(getImagePickerMissingMessage());
      }
    };

    const handleRemovePhoto = () => {
      setShowAvatarSheet(false);
      handleChange('avatarPhoto', null);
      handleChange('avatarUrl', '');
      setPhotoStatus('Photo removed.');
    };

    const handleSubmit = useCallback(async () => {
      setFeedback(null);
      setLoading(true);
      try {
        const payload = await updateProfileRequest({
          name: form.name,
          email: form.email,
          weightCategory: form.weightCategory,
          password: form.password || undefined,
          currentPassword: form.currentPassword,
          avatar: form.avatarUrl.trim() ? form.avatarUrl.trim() : null,
          avatarPhoto:
            form.avatarPhoto === null ? null : form.avatarPhoto ? form.avatarPhoto : undefined,
        });
        await setSessionFromPayload(payload);
        setFeedback('Profile updated.');
        setForm((prev) => ({ ...prev, password: '', currentPassword: '' }));
      } catch (error) {
        setFeedback(error instanceof Error ? error.message : 'Unable to update profile.');
      } finally {
        setLoading(false);
      }
    }, [form, setSessionFromPayload]);

    useImperativeHandle(ref, () => ({ submit: handleSubmit }), [handleSubmit]);

    const hasPhoto = !!(form.avatarPhoto || form.avatarUrl);

    return (
      <Card>
        <SectionHeader title="Account" subtitle="Profile details and password" />

        {/* Avatar */}
        <View style={accountStyles.avatarSection}>
          <View style={accountStyles.avatarContainer}>
            {previewUri ? (
              <Image source={{ uri: previewUri }} style={accountStyles.avatarImage} />
            ) : (
              <View style={[accountStyles.avatarImage, accountStyles.avatarPlaceholder]}>
                <AppText variant="label">No photo</AppText>
              </View>
            )}
            <Pressable
              style={accountStyles.avatarEditButton}
              onPress={() => setShowAvatarSheet(true)}
            >
              <AppText style={accountStyles.avatarEditIcon}>✏</AppText>
            </Pressable>
          </View>
          <View style={accountStyles.avatarMeta}>
            <AppText variant="body" weight="semibold">
              {user?.name || 'Your name'}
            </AppText>
            <AppText variant="muted">{user?.email || ''}</AppText>
            <Pressable
              onPress={() => setShowAdvancedAvatar((v) => !v)}
              style={accountStyles.advancedLink}
            >
              <AppText style={accountStyles.advancedLinkText}>
                {showAdvancedAvatar ? 'Hide URL field' : 'Advanced ↓'}
              </AppText>
            </Pressable>
          </View>
        </View>

        {showAdvancedAvatar ? (
          <AppInput
            label="Avatar URL (optional)"
            autoCapitalize="none"
            value={form.avatarUrl}
            onChangeText={(value) => handleChange('avatarUrl', value)}
            style={{ borderColor: '#1e3a5f' }}
          />
        ) : null}

        {photoStatus ? (
          <AppText variant="muted" style={accountStyles.helperText}>
            {photoStatus}
          </AppText>
        ) : null}

        {/* Form fields */}
        <AppInput
          label="Name"
          value={form.name}
          onChangeText={(value) => handleChange('name', value)}
          style={{ borderColor: '#1e3a5f' }}
        />
        <AppInput
          label="Email"
          autoCapitalize="none"
          value={form.email}
          onChangeText={(value) => handleChange('email', value)}
          style={{ borderColor: '#1e3a5f' }}
        />
        <AppInput
          label="Weight category"
          value={form.weightCategory}
          onChangeText={(value) => handleChange('weightCategory', value)}
          style={{ borderColor: '#1e3a5f' }}
        />
        <AppInput
          label="New password"
          secureTextEntry
          value={form.password}
          onChangeText={(value) => handleChange('password', value)}
          style={{ borderColor: '#1e3a5f' }}
        />
        <AppInput
          label="Confirm with current password"
          secureTextEntry
          value={form.currentPassword}
          onChangeText={(value) => handleChange('currentPassword', value)}
          style={{ borderColor: '#1e3a5f' }}
        />

        {feedback ? (
          <AppText variant="muted" style={accountStyles.helperText}>
            {feedback}
          </AppText>
        ) : null}

        {/* Avatar bottom sheet */}
        <Modal
          visible={showAvatarSheet}
          transparent
          animationType="slide"
          onRequestClose={() => setShowAvatarSheet(false)}
        >
          <Pressable
            style={accountStyles.sheetBackdrop}
            onPress={() => setShowAvatarSheet(false)}
          />
          <View style={accountStyles.sheet}>
            <View style={accountStyles.sheetHandle} />
            <Pressable style={accountStyles.sheetOption} onPress={handleTakePhoto}>
              <AppText variant="body">Take photo</AppText>
            </Pressable>
            <Pressable style={accountStyles.sheetOption} onPress={handlePickFromLibrary}>
              <AppText variant="body">Choose from library</AppText>
            </Pressable>
            {hasPhoto ? (
              <Pressable style={accountStyles.sheetOption} onPress={handleRemovePhoto}>
                <AppText style={accountStyles.sheetRemoveText}>Remove photo</AppText>
              </Pressable>
            ) : null}
            <Pressable
              style={[accountStyles.sheetOption, accountStyles.sheetCancel]}
              onPress={() => setShowAvatarSheet(false)}
            >
              <AppText variant="muted">Cancel</AppText>
            </Pressable>
          </View>
        </Modal>
      </Card>
    );
  }
);

const accountStyles = StyleSheet.create({
  avatarSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  avatarContainer: {
    position: 'relative',
    width: 72,
    height: 72,
  },
  avatarImage: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 2,
    borderColor: colors.accent,
  },
  avatarPlaceholder: {
    backgroundColor: colors.glass,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarEditButton: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.accent,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarEditIcon: {
    fontSize: 11,
    color: colors.background,
  },
  avatarMeta: {
    flex: 1,
    gap: spacing.xxs,
  },
  advancedLink: {
    marginTop: spacing.xs,
  },
  advancedLinkText: {
    color: colors.accent,
    fontSize: 13,
  },
  helperText: {
    marginTop: spacing.sm,
  },
  sheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  sheet: {
    backgroundColor: colors.panel,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 40,
    paddingTop: spacing.sm,
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    alignSelf: 'center',
    marginBottom: spacing.md,
  },
  sheetOption: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  sheetCancel: {
    borderBottomWidth: 0,
    marginTop: spacing.xs,
  },
  sheetRemoveText: {
    color: colors.danger,
  },
});

// ---------------------------------------------------------------------------
// AppleHealthCard
// ---------------------------------------------------------------------------

function formatLastSync(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return `Last synced today at ${time}`;
  const yest = new Date(now);
  yest.setDate(yest.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return `Last synced yesterday at ${time}`;
  return `Last synced ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} at ${time}`;
}

export function AppleHealthCard() {
  const { runOrQueue } = useSyncQueue();
  const queryClient = useQueryClient();

  const [appleHealthSyncLoading, setAppleHealthSyncLoading] = useState(false);
  const [appleHealthFeedback, setAppleHealthFeedback] = useState<string | null>(null);
  const [appleHealthLastSyncTs, setAppleHealthLastSyncTs] = useState<number | null>(null);
  const [showHowItWorks, setShowHowItWorks] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const storedAppleHealthSyncTs = await AsyncStorage.getItem(APPLE_HEALTH_LAST_SYNC_KEY);
        if (cancelled) return;
        const parsedAppleHealthTs = Number(storedAppleHealthSyncTs);
        if (Number.isFinite(parsedAppleHealthTs) && parsedAppleHealthTs > 0) {
          setAppleHealthLastSyncTs(parsedAppleHealthTs);
        } else {
          setAppleHealthLastSyncTs(null);
        }
      } catch {
        if (!cancelled) setAppleHealthLastSyncTs(null);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const uploadStreamBatches = useCallback(
    async (batches: StreamBatch[]) => {
      let queuedCount = 0;
      let sentCount = 0;
      let uploadedSampleCount = 0;

      for (const batch of batches) {
        const chunks = chunkSamples(batch.samples, STREAM_UPLOAD_CHUNK_SIZE);
        for (const chunk of chunks) {
          const samplesWithLocalDate = chunk.map((sample) => {
            const localDate = toLocalDateKey(new Date(sample.ts));
            return { ...sample, localDate };
          });
          uploadedSampleCount += samplesWithLocalDate.length;
          // eslint-disable-next-line no-await-in-loop
          const result = await runOrQueue({
            endpoint: '/api/streams',
            payload: {
              metric: batch.metric,
              localDate: samplesWithLocalDate[0]?.localDate || undefined,
              samples: samplesWithLocalDate,
            },
            description: `Health stream import (${batch.metric})`,
          });
          if (result.status === 'queued') {
            queuedCount += 1;
          } else {
            sentCount += 1;
          }
        }
      }

      if (sentCount > 0) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['sleep'] }),
          queryClient.invalidateQueries({ queryKey: ['activity'] }),
          queryClient.invalidateQueries({ queryKey: ['vitals'] }),
          queryClient.invalidateQueries({ queryKey: ['roster'] }),
          queryClient.invalidateQueries({ queryKey: ['stream-history'] }),
          queryClient.invalidateQueries({ queryKey: ['streamHistory'] }),
        ]);
      }

      return { queuedCount, sentCount, uploadedSampleCount };
    },
    [queryClient, runOrQueue]
  );

  const uploadWorkoutSessions = useCallback(
    async (workouts: AppleHealthWorkoutImport[]) => {
      let queuedCount = 0;
      let sentCount = 0;
      let uploadedWorkoutCount = 0;

      const chunks = chunkSamples(workouts, WORKOUT_UPLOAD_CHUNK_SIZE);
      for (const chunk of chunks) {
        uploadedWorkoutCount += chunk.length;
        // eslint-disable-next-line no-await-in-loop
        const result = await runOrQueue({
          endpoint: '/api/streams/workouts',
          payload: { workouts: chunk },
          description: 'Apple Health workout session import',
        });
        if (result.status === 'queued') {
          queuedCount += 1;
        } else {
          sentCount += 1;
        }
      }

      if (sentCount > 0) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['activity'] }),
          queryClient.invalidateQueries({ queryKey: ['roster'] }),
        ]);
      }

      return { queuedCount, sentCount, uploadedWorkoutCount };
    },
    [queryClient, runOrQueue]
  );

  const syncAppleHealth = useCallback(
    async (showFeedback: boolean) => {
      setAppleHealthSyncLoading(true);
      if (showFeedback) {
        setAppleHealthFeedback(null);
      }

      try {
        const endDate = new Date();
        const startDate = new Date(endDate);
        const previousSyncTs =
          appleHealthLastSyncTs &&
          Number.isFinite(appleHealthLastSyncTs) &&
          appleHealthLastSyncTs > 0
            ? appleHealthLastSyncTs
            : null;
        if (previousSyncTs) {
          startDate.setTime(previousSyncTs - APPLE_HEALTH_RESYNC_BUFFER_HOURS * 60 * 60 * 1000);
        } else {
          startDate.setDate(startDate.getDate() - APPLE_HEALTH_INITIAL_LOOKBACK_DAYS);
        }

        const payload = await readAppleHealthPayload({ startDate, endDate });
        const parsed = parseAppleHealthPayload(payload);
        const hasStreamSamples = parsed.sampleCount > 0;
        const hasWorkouts = parsed.workoutCount > 0;
        if (!hasStreamSamples && !hasWorkouts) {
          if (showFeedback) {
            setAppleHealthFeedback(
              previousSyncTs
                ? 'No new Apple Health samples were found since your last sync.'
                : `No Apple Health samples were found in the last ${APPLE_HEALTH_INITIAL_LOOKBACK_DAYS} days.`
            );
          }
          return false;
        }

        const streamSummary = hasStreamSamples
          ? await uploadStreamBatches(parsed.batches)
          : { queuedCount: 0, sentCount: 0, uploadedSampleCount: 0 };
        const workoutSummary = hasWorkouts
          ? await uploadWorkoutSessions(parsed.workouts)
          : { queuedCount: 0, sentCount: 0, uploadedWorkoutCount: 0 };
        const syncCompletedAt = Date.now();
        setAppleHealthLastSyncTs(syncCompletedAt);
        AsyncStorage.setItem(APPLE_HEALTH_LAST_SYNC_KEY, String(syncCompletedAt)).catch(() => {});

        if (showFeedback) {
          const importedSegments: string[] = [];
          if (streamSummary.uploadedSampleCount > 0) {
            importedSegments.push(`${streamSummary.uploadedSampleCount} samples`);
          }
          if (workoutSummary.uploadedWorkoutCount > 0) {
            importedSegments.push(`${workoutSummary.uploadedWorkoutCount} workouts`);
          }
          const sentBatchCount = streamSummary.sentCount + workoutSummary.sentCount;
          const queuedBatchCount = streamSummary.queuedCount + workoutSummary.queuedCount;
          const importedLabel = importedSegments.join(' and ');
          setAppleHealthFeedback(
            queuedBatchCount > 0
              ? `Apple Health sync imported ${importedLabel}. Uploaded ${sentBatchCount} batches and queued ${queuedBatchCount}.`
              : `Apple Health sync uploaded ${importedLabel} across ${sentBatchCount} batches.`
          );
        }

        return true;
      } catch (error) {
        if (showFeedback) {
          const fallbackMessage =
            Platform.OS !== 'ios'
              ? 'Apple Health sync is only available on iOS devices.'
              : getAppleHealthMissingMessage();
          setAppleHealthFeedback(error instanceof Error ? error.message : fallbackMessage);
        }
        return false;
      } finally {
        setAppleHealthSyncLoading(false);
      }
    },
    [appleHealthLastSyncTs, uploadStreamBatches, uploadWorkoutSessions]
  );

  return (
    <Card>
      <SectionHeader title="Apple Health sync" subtitle="One button, direct from your phone" />
      <AppText variant="muted">
        Tap once to request Apple Health permission and sync data automatically. No export files or
        other apps are needed.
      </AppText>
      <AppButton
        title="Sync Apple Health"
        onPress={() => syncAppleHealth(true)}
        loading={appleHealthSyncLoading}
        disabled={appleHealthSyncLoading}
        style={appleHealthStyles.syncButton}
      />
      {appleHealthLastSyncTs ? (
        <View style={appleHealthStyles.lastSyncRow}>
          <AppText style={appleHealthStyles.syncIcon}>↻</AppText>
          <AppText variant="muted" style={appleHealthStyles.lastSyncText}>
            {formatLastSync(appleHealthLastSyncTs)}
          </AppText>
        </View>
      ) : null}
      <Pressable
        onPress={() => setShowHowItWorks((v) => !v)}
        style={appleHealthStyles.howItWorksLink}
      >
        <AppText variant="muted" style={appleHealthStyles.howItWorksLinkText}>
          {showHowItWorks ? 'Hide ↑' : 'How it works ↓'}
        </AppText>
      </Pressable>
      {showHowItWorks ? (
        <>
          <AppText variant="muted" style={appleHealthStyles.howItWorksText}>
            First sync imports up to {APPLE_HEALTH_INITIAL_LOOKBACK_DAYS} days. Later syncs import
            new samples plus a {APPLE_HEALTH_RESYNC_BUFFER_HOURS}-hour overlap for reliability.
          </AppText>
          <AppText variant="muted" style={appleHealthStyles.howItWorksText}>
            Sync updates sleep/vitals trends and now imports individual Apple Health workouts into
            Sessions, including distance, calories, and duration.
          </AppText>
        </>
      ) : null}
      {appleHealthFeedback ? (
        <AppText variant="muted" style={appleHealthStyles.feedbackText}>
          {appleHealthFeedback}
        </AppText>
      ) : null}
    </Card>
  );
}

const appleHealthStyles = StyleSheet.create({
  syncButton: {
    marginTop: spacing.md,
  },
  lastSyncRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  syncIcon: {
    color: colors.muted,
    fontSize: 14,
  },
  lastSyncText: {
    fontSize: 13,
  },
  howItWorksLink: {
    marginTop: spacing.sm,
  },
  howItWorksLinkText: {
    fontSize: 13,
  },
  howItWorksText: {
    marginTop: spacing.sm,
  },
  feedbackText: {
    marginTop: spacing.sm,
  },
});

// ---------------------------------------------------------------------------
// PhoneSyncCard
// ---------------------------------------------------------------------------

export function PhoneSyncCard() {
  const { runOrQueue } = useSyncQueue();
  const queryClient = useQueryClient();

  const [phoneAccessStatus, setPhoneAccessStatus] = useState<PhoneAccessStatus>('unknown');
  const [phoneAccessFeedback, setPhoneAccessFeedback] = useState<string | null>(null);
  const [phoneSyncEnabled, setPhoneSyncEnabled] = useState<boolean | null>(null);
  const [phoneSyncPreferenceLoading, setPhoneSyncPreferenceLoading] = useState(true);
  const [phoneSyncLoading, setPhoneSyncLoading] = useState(false);
  const [phoneStepSample, setPhoneStepSample] = useState<{ steps: number; ts: number } | null>(
    null
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const storedPreference = await AsyncStorage.getItem(PHONE_SYNC_OPT_IN_KEY);
        if (cancelled) return;
        if (storedPreference === 'true') {
          setPhoneSyncEnabled(true);
        } else if (storedPreference === 'false') {
          setPhoneSyncEnabled(false);
        } else {
          setPhoneSyncEnabled(null);
        }
      } catch {
        if (!cancelled) setPhoneSyncEnabled(null);
      } finally {
        if (!cancelled) setPhoneSyncPreferenceLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const statusLabel =
    phoneSyncEnabled === true ? 'Enabled' : phoneSyncEnabled === false ? 'Off' : 'Not set';

  const ensurePhoneAccess = async (requestAccess: boolean) => {
    const pedometer = getPedometerModule();
    if (!pedometer) {
      setPhoneAccessStatus('unavailable');
      throw new Error(getPedometerMissingMessage());
    }

    if (pedometer.isAvailableAsync) {
      const isAvailable = await pedometer.isAvailableAsync();
      if (!isAvailable) {
        setPhoneAccessStatus('unavailable');
        throw new Error('Phone motion data is not available on this device.');
      }
    }

    let permission = null;
    if (requestAccess && pedometer.requestPermissionsAsync) {
      permission = await pedometer.requestPermissionsAsync();
    } else if (pedometer.getPermissionsAsync) {
      permission = await pedometer.getPermissionsAsync();
    }

    const granted = isPermissionGranted(permission);
    setPhoneAccessStatus(granted ? 'granted' : 'denied');
    if (!granted) {
      throw new Error('Motion access denied. Enable Motion & Fitness permission in settings.');
    }
    return pedometer;
  };

  const handleSyncPhoneSteps = async (requestAccess = true) => {
    setPhoneAccessFeedback(null);
    setPhoneSyncLoading(true);
    try {
      const pedometer = await ensurePhoneAccess(requestAccess);
      if (!pedometer.getStepCountAsync) {
        throw new Error('Step count API is unavailable on this phone.');
      }
      const end = new Date();
      const start = new Date(end);
      start.setHours(0, 0, 0, 0);
      const response = await pedometer.getStepCountAsync(start, end);
      const rawSteps = Number(response?.steps);
      if (!Number.isFinite(rawSteps)) {
        throw new Error('No step data was returned by the phone.');
      }
      const steps = Math.max(0, Math.round(rawSteps));
      const ts = Date.now();
      const localDate = toLocalDateKey(new Date(ts));
      const upload = await runOrQueue({
        endpoint: '/api/streams',
        payload: {
          metric: PHONE_STEPS_METRIC,
          localDate,
          samples: [{ ts, value: steps, localDate }],
        },
        description: 'Phone step count sync',
      });
      setPhoneStepSample({ steps, ts });
      setPhoneAccessFeedback(
        upload.status === 'queued'
          ? `Read ${steps.toLocaleString()} steps today. Upload queued offline.`
          : `Read ${steps.toLocaleString()} steps today and uploaded.`
      );
      if (upload.status === 'sent') {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['sleep'] }),
          queryClient.invalidateQueries({ queryKey: ['activity'] }),
          queryClient.invalidateQueries({ queryKey: ['vitals'] }),
          queryClient.invalidateQueries({ queryKey: ['roster'] }),
        ]);
      }
      return true;
    } catch (error) {
      setPhoneAccessFeedback(error instanceof Error ? error.message : 'Unable to sync phone data.');
      return false;
    } finally {
      setPhoneSyncLoading(false);
    }
  };

  const persistPhoneSyncPreference = async (enabled: boolean) => {
    setPhoneSyncEnabled(enabled);
    try {
      await AsyncStorage.setItem(PHONE_SYNC_OPT_IN_KEY, enabled ? 'true' : 'false');
      return true;
    } catch {
      setPhoneAccessFeedback('Unable to save this setting right now.');
      return false;
    }
  };

  const handlePhoneSyncPreference = async (enabled: boolean) => {
    setPhoneAccessFeedback(null);
    const saved = await persistPhoneSyncPreference(enabled);
    if (!saved) return;
    if (!enabled) {
      setPhoneAccessFeedback('Phone data sync is turned off.');
      return;
    }
    const syncOk = await handleSyncPhoneSteps(true);
    if (!syncOk) {
      setPhoneSyncEnabled(false);
      AsyncStorage.setItem(PHONE_SYNC_OPT_IN_KEY, 'false').catch(() => {});
    }
  };

  return (
    <Card>
      <SectionHeader
        title="Phone sync"
        subtitle={
          phoneSyncEnabled === null
            ? 'Sync step data from this phone?'
            : phoneSyncEnabled
            ? 'Phone data sync is enabled.'
            : 'Phone data sync is currently off.'
        }
        action={
          <View style={phoneSyncStyles.statusPill}>
            <AppText variant="label" style={phoneSyncStyles.statusPillText}>
              {statusLabel}
            </AppText>
          </View>
        }
      />
      {phoneSyncPreferenceLoading ? (
        <AppText variant="muted">Loading...</AppText>
      ) : (
        <View style={phoneSyncStyles.buttonsRow}>
          <AppButton
            title={phoneSyncEnabled ? 'Sync today steps' : 'Enable and sync'}
            onPress={
              phoneSyncEnabled
                ? () => handleSyncPhoneSteps(true)
                : () => handlePhoneSyncPreference(true)
            }
            loading={phoneSyncLoading}
            style={phoneSyncStyles.flex}
          />
          <AppButton
            title={phoneSyncEnabled ? 'Turn off' : 'Keep off'}
            variant="ghost"
            onPress={() => handlePhoneSyncPreference(false)}
            disabled={phoneSyncLoading}
            style={phoneSyncStyles.flex}
          />
        </View>
      )}
      {phoneAccessFeedback ? (
        <AppText variant="muted" style={phoneSyncStyles.helperText}>
          {phoneAccessFeedback}
        </AppText>
      ) : null}
      {phoneStepSample ? (
        <View style={phoneSyncStyles.metricsRow}>
          <Metric label="Today steps" value={formatNumber(phoneStepSample.steps)} />
          <Metric label="Metric" value={PHONE_STEPS_METRIC} />
          <Metric
            label="Synced"
            value={formatDate(new Date(phoneStepSample.ts).toISOString(), 'HH:mm')}
          />
        </View>
      ) : null}
    </Card>
  );
}

const phoneSyncStyles = StyleSheet.create({
  statusPill: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.accent,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  statusPillText: {
    color: colors.accent,
    fontSize: 11,
  },
  buttonsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  flex: {
    flex: 1,
  },
  helperText: {
    marginTop: spacing.sm,
  },
  metricsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
});

// ---------------------------------------------------------------------------
// ConnectionCard
// ---------------------------------------------------------------------------

export function ConnectionCard() {
  const { apiBaseUrl, updateBaseUrl, resetBaseUrl } = useApiConfig();
  const [apiUrlInput, setApiUrlInput] = useState(apiBaseUrl);
  const [apiUrlFeedback, setApiUrlFeedback] = useState<string | null>(null);
  const [apiUrlSaving, setApiUrlSaving] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  useEffect(() => {
    setApiUrlInput(apiBaseUrl);
  }, [apiBaseUrl]);

  const handleApplyApiUrl = async () => {
    setApiUrlFeedback(null);
    setApiUrlSaving(true);
    try {
      await updateBaseUrl(apiUrlInput);
      setApiUrlFeedback('API base URL updated. New requests will use this server.');
    } catch (error) {
      setApiUrlFeedback(error instanceof Error ? error.message : 'Unable to update API base URL.');
    } finally {
      setApiUrlSaving(false);
    }
  };

  const handleResetApiUrl = async () => {
    setShowResetConfirm(false);
    setApiUrlFeedback(null);
    setApiUrlSaving(true);
    try {
      await resetBaseUrl();
      setApiUrlFeedback('Reverted to the default API server.');
    } catch (error) {
      setApiUrlFeedback(error instanceof Error ? error.message : 'Unable to reset API base URL.');
    } finally {
      setApiUrlSaving(false);
    }
  };

  return (
    <Card>
      <SectionHeader title="Connection" subtitle="Configure the backend server for this app" />
      <AppInput
        label="API base URL"
        autoCapitalize="none"
        autoCorrect={false}
        value={apiUrlInput}
        onChangeText={setApiUrlInput}
        style={{ borderColor: '#1e3a5f' }}
      />
      <View style={connectionStyles.applyRow}>
        <AppButton
          title="Apply"
          onPress={handleApplyApiUrl}
          loading={apiUrlSaving}
          style={connectionStyles.applyButton}
        />
        <Pressable onPress={() => setShowResetConfirm(true)}>
          <AppText style={connectionStyles.resetText}>Reset to default</AppText>
        </Pressable>
      </View>
      {showResetConfirm ? (
        <View style={connectionStyles.confirmRow}>
          <AppText variant="muted" style={connectionStyles.confirmText}>
            Reset to default server? This cannot be undone.
          </AppText>
          <View style={connectionStyles.confirmButtons}>
            <AppButton
              title="Reset"
              variant="ghost"
              onPress={handleResetApiUrl}
              style={connectionStyles.confirmButton}
            />
            <AppButton
              title="Cancel"
              variant="ghost"
              onPress={() => setShowResetConfirm(false)}
              style={connectionStyles.confirmButton}
            />
          </View>
        </View>
      ) : null}
      {apiUrlFeedback ? (
        <AppText variant="muted" style={connectionStyles.helperText}>
          {apiUrlFeedback}
        </AppText>
      ) : null}
    </Card>
  );
}

const connectionStyles = StyleSheet.create({
  applyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  applyButton: {
    alignSelf: 'flex-start',
    paddingHorizontal: 24,
    height: 40,
  },
  resetText: {
    color: colors.danger,
    fontSize: 13,
  },
  confirmRow: {
    marginTop: spacing.sm,
    gap: spacing.xs,
  },
  confirmText: {
    fontSize: 13,
  },
  confirmButtons: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  confirmButton: {
    flexGrow: 1,
  },
  helperText: {
    marginTop: spacing.sm,
  },
});

// ---------------------------------------------------------------------------
// Backward-compat ProfileSection
// ---------------------------------------------------------------------------

export function ProfileSection() {
  const accountRef = useRef<AccountCardHandle>(null);

  return (
    <View style={sharedStyles.container}>
      <AccountCard ref={accountRef} />
      <AppleHealthCard />
      <PhoneSyncCard />
      <ConnectionCard />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Shared styles
// ---------------------------------------------------------------------------

const sharedStyles = StyleSheet.create({
  container: {
    gap: spacing.lg,
  },
  metric: {
    flex: 1,
  },
});

// ---------------------------------------------------------------------------
// Utility functions (kept at bottom, unchanged)
// ---------------------------------------------------------------------------

function toLocalDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatPhoneAccessStatus(status: PhoneAccessStatus) {
  if (status === 'granted') return 'Granted';
  if (status === 'denied') return 'Denied';
  if (status === 'unavailable') return 'Unavailable';
  return 'Not requested';
}

function chunkSamples<T>(items: T[], chunkSize: number) {
  const size = Math.max(1, Math.floor(chunkSize));
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

// Suppress unused warning for formatPhoneAccessStatus (kept for API compat)
void formatPhoneAccessStatus;
