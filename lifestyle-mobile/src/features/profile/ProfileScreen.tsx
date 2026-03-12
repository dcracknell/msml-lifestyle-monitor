import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View, Image, Platform } from 'react-native';
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
  RefreshableScrollView,
} from '../../components';
import { colors, spacing } from '../../theme';
import { getImagePickerMissingMessage, getImagePickerModule } from '../../utils/imagePicker';
import { formatDate, formatNumber } from '../../utils/format';
import { getPedometerMissingMessage, getPedometerModule, isPermissionGranted } from '../../utils/pedometer';
import { useQueryClient } from '@tanstack/react-query';
import { getAppleHealthMissingMessage, readAppleHealthPayload } from '../../utils/appleHealth';
import { AppleHealthWorkoutImport, parseAppleHealthPayload } from './appleHealthImport';

type PhoneAccessStatus = 'unknown' | 'granted' | 'denied' | 'unavailable';
type StreamBatch = { metric: string; samples: Array<{ ts: number; value: number | null }> };

const PHONE_STEPS_METRIC = 'phone.steps';
const PHONE_SYNC_OPT_IN_KEY = 'msml.settings.syncPhoneData';
const APPLE_HEALTH_LAST_SYNC_KEY = 'msml.settings.appleHealthLastSyncTs';
const STREAM_UPLOAD_CHUNK_SIZE = 1000;
const WORKOUT_UPLOAD_CHUNK_SIZE = 120;
const APPLE_HEALTH_INITIAL_LOOKBACK_DAYS = 30;
const APPLE_HEALTH_RESYNC_BUFFER_HOURS = 24;

export function ProfileScreen() {
  const { user, setSessionFromPayload } = useAuth();
  const { apiBaseUrl, updateBaseUrl, resetBaseUrl } = useApiConfig();
  const { runOrQueue } = useSyncQueue();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    name: user?.name || '',
    email: user?.email || '',
    weightCategory: user?.weight_category || '',
    password: '',
    currentPassword: '',
    avatarUrl: user?.avatar_url || '',
    avatarPhoto: user?.avatar_photo || null,
  });
  const [feedback, setFeedback] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [photoStatus, setPhotoStatus] = useState<string | null>(null);
  const [apiUrlInput, setApiUrlInput] = useState(apiBaseUrl);
  const [apiUrlFeedback, setApiUrlFeedback] = useState<string | null>(null);
  const [apiUrlSaving, setApiUrlSaving] = useState(false);
  const [phoneAccessStatus, setPhoneAccessStatus] = useState<PhoneAccessStatus>('unknown');
  const [phoneAccessFeedback, setPhoneAccessFeedback] = useState<string | null>(null);
  const [phoneSyncEnabled, setPhoneSyncEnabled] = useState<boolean | null>(null);
  const [phoneSyncPreferenceLoading, setPhoneSyncPreferenceLoading] = useState(true);
  const [phoneSyncLoading, setPhoneSyncLoading] = useState(false);
  const [phoneStepSample, setPhoneStepSample] = useState<{ steps: number; ts: number } | null>(null);
  const [appleHealthSyncLoading, setAppleHealthSyncLoading] = useState(false);
  const [appleHealthFeedback, setAppleHealthFeedback] = useState<string | null>(null);
  const [appleHealthLastSyncTs, setAppleHealthLastSyncTs] = useState<number | null>(null);

  useEffect(() => {
    setApiUrlInput(apiBaseUrl);
  }, [apiBaseUrl]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [storedPreference, storedAppleHealthSyncTs] = await Promise.all([
          AsyncStorage.getItem(PHONE_SYNC_OPT_IN_KEY),
          AsyncStorage.getItem(APPLE_HEALTH_LAST_SYNC_KEY),
        ]);
        if (cancelled) {
          return;
        }
        if (storedPreference === 'true') {
          setPhoneSyncEnabled(true);
        } else if (storedPreference === 'false') {
          setPhoneSyncEnabled(false);
        } else {
          setPhoneSyncEnabled(null);
        }
        const parsedAppleHealthTs = Number(storedAppleHealthSyncTs);
        if (Number.isFinite(parsedAppleHealthTs) && parsedAppleHealthTs > 0) {
          setAppleHealthLastSyncTs(parsedAppleHealthTs);
        } else {
          setAppleHealthLastSyncTs(null);
        }
      } catch {
        if (!cancelled) {
          setPhoneSyncEnabled(null);
          setAppleHealthLastSyncTs(null);
        }
      } finally {
        if (!cancelled) {
          setPhoneSyncPreferenceLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const handleChange = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

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
    handleChange('avatarPhoto', null);
    handleChange('avatarUrl', '');
    setPhotoStatus('Photo removed.');
  };

  const handleSubmit = async () => {
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
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Unable to update profile.');
    } finally {
      setLoading(false);
    }
  };

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
    if (!saved) {
      return;
    }
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

      return {
        queuedCount,
        sentCount,
        uploadedSampleCount,
      };
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

      return {
        queuedCount,
        sentCount,
        uploadedWorkoutCount,
      };
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
          appleHealthLastSyncTs && Number.isFinite(appleHealthLastSyncTs) && appleHealthLastSyncTs > 0
            ? appleHealthLastSyncTs
            : null;
        if (previousSyncTs) {
          startDate.setTime(
            previousSyncTs - APPLE_HEALTH_RESYNC_BUFFER_HOURS * 60 * 60 * 1000
          );
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
    <RefreshableScrollView
      contentContainerStyle={styles.container}
      refreshing={false}
      onRefresh={() => {
        // no-op: profile data is already live through auth session
      }}
      showsVerticalScrollIndicator={false}
    >
      <Card>
        <SectionHeader
          title="Phone sync setting (v2)"
          subtitle={`Status: ${formatPhoneAccessStatus(phoneAccessStatus)}`}
        />
        <AppText variant="muted">
          {phoneSyncEnabled === null
            ? 'Sync step data from this phone?'
            : phoneSyncEnabled
            ? 'Phone data sync is enabled.'
            : 'Phone data sync is currently off.'}
        </AppText>
        {phoneSyncPreferenceLoading ? (
          <AppText variant="muted" style={styles.helperText}>
            Loading saved preference...
          </AppText>
        ) : phoneSyncEnabled === null ? (
          <View style={styles.importActionsRow}>
            <AppButton
              title="Yes, sync now"
              onPress={() => handlePhoneSyncPreference(true)}
              loading={phoneSyncLoading}
              style={styles.importActionButton}
            />
            <AppButton
              title="No thanks"
              variant="ghost"
              onPress={() => handlePhoneSyncPreference(false)}
              disabled={phoneSyncLoading}
              style={styles.importActionButton}
            />
          </View>
        ) : (
          <View style={styles.importActionsRow}>
            <AppButton
              title={phoneSyncEnabled ? 'Sync today steps' : 'Enable and sync'}
              onPress={
                phoneSyncEnabled
                  ? () => handleSyncPhoneSteps(true)
                  : () => handlePhoneSyncPreference(true)
              }
              loading={phoneSyncLoading}
              style={styles.importActionButton}
            />
            <AppButton
              title={phoneSyncEnabled ? 'Turn off' : 'Keep off'}
              variant="ghost"
              onPress={() => handlePhoneSyncPreference(false)}
              disabled={phoneSyncLoading}
              style={styles.importActionButton}
            />
          </View>
        )}
        {phoneAccessFeedback ? (
          <AppText variant="muted" style={styles.helperText}>
            {phoneAccessFeedback}
          </AppText>
        ) : null}
        {phoneStepSample ? (
          <View style={styles.metricsRow}>
            <Metric label="Today steps" value={formatNumber(phoneStepSample.steps)} />
            <Metric label="Metric" value={PHONE_STEPS_METRIC} />
            <Metric label="Synced" value={formatDate(new Date(phoneStepSample.ts).toISOString(), 'HH:mm')} />
          </View>
        ) : null}
      </Card>
      <Card>
        <SectionHeader title="Apple Health sync" subtitle="One button, direct from your phone" />
        <AppText variant="muted">
          Tap once to request Apple Health permission and sync data automatically. No export files or
          other apps are needed.
        </AppText>
        <View style={styles.importActionsRow}>
          <AppButton
            title="Sync Apple Health"
            onPress={() => syncAppleHealth(true)}
            loading={appleHealthSyncLoading}
            disabled={appleHealthSyncLoading}
            style={styles.importActionButton}
          />
        </View>
        <AppText variant="muted" style={styles.helperText}>
          First sync imports up to {APPLE_HEALTH_INITIAL_LOOKBACK_DAYS} days. Later syncs import new
          samples plus a {APPLE_HEALTH_RESYNC_BUFFER_HOURS}-hour overlap for reliability.
        </AppText>
        <AppText variant="muted" style={styles.helperText}>
          Sync updates sleep/vitals trends and now imports individual Apple Health workouts into
          Sessions, including distance, calories, and duration.
        </AppText>
        {appleHealthLastSyncTs ? (
          <AppText variant="muted" style={styles.helperText}>
            Last sync: {formatDate(new Date(appleHealthLastSyncTs).toISOString(), 'MMM D, HH:mm')}
          </AppText>
        ) : null}
        {appleHealthFeedback ? (
          <AppText variant="muted" style={styles.helperText}>
            {appleHealthFeedback}
          </AppText>
        ) : null}
      </Card>
      <Card>
        <SectionHeader title="Profile photo" subtitle="Show who you are" />
        <View style={styles.avatarRow}>
          {previewUri ? (
            <Image source={{ uri: previewUri }} style={styles.avatarPreview} />
          ) : (
            <View style={[styles.avatarPreview, styles.avatarPlaceholder]}>
              <AppText variant="label">No photo</AppText>
            </View>
          )}
          <View style={styles.avatarActions}>
            <AppButton title="Take photo" variant="ghost" onPress={handleTakePhoto} />
            <AppButton title="Choose from library" variant="ghost" onPress={handlePickFromLibrary} />
            {form.avatarPhoto || form.avatarUrl ? (
              <AppButton title="Remove photo" variant="ghost" onPress={handleRemovePhoto} />
            ) : null}
          </View>
        </View>
        <AppInput
          label="Avatar URL (optional)"
          autoCapitalize="none"
          value={form.avatarUrl}
          onChangeText={(value) => handleChange('avatarUrl', value)}
        />
        {photoStatus ? (
          <AppText variant="muted" style={styles.helperText}>
            {photoStatus}
          </AppText>
        ) : null}
      </Card>
      <Card>
        <SectionHeader title="Profile" subtitle="Account details" />
        <AppInput label="Name" value={form.name} onChangeText={(value) => handleChange('name', value)} />
        <AppInput label="Email" autoCapitalize="none" value={form.email} onChangeText={(value) => handleChange('email', value)} />
        <AppInput label="Weight category" value={form.weightCategory} onChangeText={(value) => handleChange('weightCategory', value)} />
        <AppInput
          label="New password"
          secureTextEntry
          value={form.password}
          onChangeText={(value) => handleChange('password', value)}
        />
      </Card>
      <Card>
        <SectionHeader title="Confirm changes" subtitle="Enter your current password to save" />
        <AppText variant="muted" style={styles.helperText}>
          For security, confirm account detail changes with your current password.
        </AppText>
        <AppInput
          label="Current password"
          secureTextEntry
          value={form.currentPassword}
          onChangeText={(value) => handleChange('currentPassword', value)}
        />
      </Card>
      <Card>
        <SectionHeader title="Connection" subtitle="Configure the backend server for this app" />
        <AppInput
          label="API base URL"
          autoCapitalize="none"
          autoCorrect={false}
          value={apiUrlInput}
          onChangeText={setApiUrlInput}
        />
        {apiUrlFeedback ? (
          <AppText variant="muted" style={styles.helperText}>
            {apiUrlFeedback}
          </AppText>
        ) : null}
        <View style={styles.connectionRow}>
          <AppButton title="Apply" onPress={handleApplyApiUrl} loading={apiUrlSaving} />
          <AppButton
            title="Reset to default"
            variant="ghost"
            onPress={handleResetApiUrl}
            disabled={apiUrlSaving}
          />
        </View>
      </Card>
      {feedback ? (
        <AppText variant="muted" style={styles.feedback}>
          {feedback}
        </AppText>
      ) : null}
      <AppButton title="Save changes" onPress={handleSubmit} loading={loading} />
    </RefreshableScrollView>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metric}>
      <AppText variant="label">{label}</AppText>
      <AppText variant="heading">{value}</AppText>
    </View>
  );
}

function toLocalDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatPhoneAccessStatus(status: PhoneAccessStatus) {
  if (status === 'granted') {
    return 'Granted';
  }
  if (status === 'denied') {
    return 'Denied';
  }
  if (status === 'unavailable') {
    return 'Unavailable';
  }
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

const styles = StyleSheet.create({
  container: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
  feedback: {
    textAlign: 'center',
  },
  avatarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  avatarPreview: {
    width: 96,
    height: 96,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
  },
  avatarPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.glass,
  },
  avatarActions: {
    flex: 1,
    gap: spacing.sm,
  },
  helperText: {
    marginTop: spacing.sm,
  },
  connectionRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
    flexWrap: 'wrap',
  },
  importActionsRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    flexWrap: 'wrap',
    marginBottom: spacing.sm,
  },
  importActionButton: {
    flexGrow: 1,
    minWidth: 100,
  },
  metricsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  metric: {
    flex: 1,
  },
});
