import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View, Image } from 'react-native';
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
  TrendChart,
} from '../../components';
import { colors, spacing } from '../../theme';
import { getImagePickerMissingMessage, getImagePickerModule } from '../../utils/imagePicker';
import { getDocumentPickerMissingMessage, getDocumentPickerModule } from '../../utils/documentPicker';
import { formatDate, formatNumber } from '../../utils/format';
import { parseIPhoneExportPayload, StreamBatch } from '../devices/iphoneImport';
import { getPedometerMissingMessage, getPedometerModule, isPermissionGranted } from '../../utils/pedometer';

type PhoneAccessStatus = 'unknown' | 'granted' | 'denied' | 'unavailable';

const PHONE_STEPS_METRIC = 'activity.steps';

export function ProfileScreen() {
  const { user, setSessionFromPayload } = useAuth();
  const { apiBaseUrl, updateBaseUrl, resetBaseUrl } = useApiConfig();
  const { runOrQueue } = useSyncQueue();
  const [form, setForm] = useState({
    name: user?.name || '',
    email: user?.email || '',
    weightCategory: user?.weight_category || '',
    password: '',
    currentPassword: '',
    stravaClientId: user?.strava_client_id || '',
    stravaClientSecret: user?.strava_client_secret || '',
    stravaRedirectUri: user?.strava_redirect_uri || '',
    avatarUrl: user?.avatar_url || '',
    avatarPhoto: user?.avatar_photo || null,
  });
  const [feedback, setFeedback] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [photoStatus, setPhotoStatus] = useState<string | null>(null);
  const [apiUrlInput, setApiUrlInput] = useState(apiBaseUrl);
  const [apiUrlFeedback, setApiUrlFeedback] = useState<string | null>(null);
  const [apiUrlSaving, setApiUrlSaving] = useState(false);
  const [iphonePayload, setIphonePayload] = useState('');
  const [iphoneBatches, setIphoneBatches] = useState<StreamBatch[]>([]);
  const [iphoneImportFeedback, setIphoneImportFeedback] = useState<string | null>(null);
  const [iphonePickLoading, setIphonePickLoading] = useState(false);
  const [iphoneParseLoading, setIphoneParseLoading] = useState(false);
  const [iphoneUploadLoading, setIphoneUploadLoading] = useState(false);
  const [selectedImportMetric, setSelectedImportMetric] = useState<string | null>(null);
  const [importWindow, setImportWindow] = useState<string | null>(null);
  const [phoneAccessStatus, setPhoneAccessStatus] = useState<PhoneAccessStatus>('unknown');
  const [phoneAccessFeedback, setPhoneAccessFeedback] = useState<string | null>(null);
  const [phonePermissionLoading, setPhonePermissionLoading] = useState(false);
  const [phoneSyncLoading, setPhoneSyncLoading] = useState(false);
  const [phoneStepSample, setPhoneStepSample] = useState<{ steps: number; ts: number } | null>(null);

  useEffect(() => {
    setApiUrlInput(apiBaseUrl);
  }, [apiBaseUrl]);

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

  const importedSampleCount = useMemo(
    () => iphoneBatches.reduce((total, batch) => total + batch.samples.length, 0),
    [iphoneBatches]
  );

  const selectedImportBatch = useMemo(
    () =>
      iphoneBatches.find((batch) => batch.metric === selectedImportMetric) ||
      iphoneBatches[0] ||
      null,
    [iphoneBatches, selectedImportMetric]
  );

  const selectedImportTrend = useMemo(
    () =>
      (selectedImportBatch?.samples || [])
        .filter((sample) => sample.value !== null && Number.isFinite(sample.value))
        .slice(-40)
        .map((sample) => ({
          label: formatDate(new Date(sample.ts).toISOString(), 'MMM D HH:mm'),
          value: sample.value as number,
        })),
    [selectedImportBatch]
  );

  const visibleImportBatches = useMemo(() => iphoneBatches.slice(0, 8), [iphoneBatches]);

  const handleTakePhoto = async () => {
    setPhotoStatus(null);
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
  };

  const handlePickFromLibrary = async () => {
    setPhotoStatus(null);
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
        stravaClientId: form.stravaClientId,
        stravaClientSecret: form.stravaClientSecret,
        stravaRedirectUri: form.stravaRedirectUri,
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

  const handleGrantPhoneAccess = async () => {
    setPhoneAccessFeedback(null);
    setPhonePermissionLoading(true);
    try {
      await ensurePhoneAccess(true);
      setPhoneAccessFeedback('Access granted. You can now sync phone step data.');
    } catch (error) {
      setPhoneAccessFeedback(
        error instanceof Error ? error.message : 'Unable to request phone data access.'
      );
    } finally {
      setPhonePermissionLoading(false);
    }
  };

  const handleSyncPhoneSteps = async () => {
    setPhoneAccessFeedback(null);
    setPhoneSyncLoading(true);
    try {
      const pedometer = await ensurePhoneAccess(true);
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
      const upload = await runOrQueue({
        endpoint: '/api/streams',
        payload: { metric: PHONE_STEPS_METRIC, samples: [{ ts, value: steps }] },
        description: 'Phone step count sync',
      });
      setPhoneStepSample({ steps, ts });
      setPhoneAccessFeedback(
        upload.status === 'queued'
          ? `Read ${steps.toLocaleString()} steps today. Upload queued offline.`
          : `Read ${steps.toLocaleString()} steps today and uploaded.`
      );
    } catch (error) {
      setPhoneAccessFeedback(error instanceof Error ? error.message : 'Unable to sync phone data.');
    } finally {
      setPhoneSyncLoading(false);
    }
  };

  const parseIphonePayload = (payloadText: string) => {
    const parsed = parseIPhoneExportPayload(payloadText);
    setIphoneBatches(parsed.batches);
    setSelectedImportMetric(parsed.batches[0]?.metric || null);
    setImportWindow(formatImportWindow(parsed.startTs, parsed.endTs));
    return parsed;
  };

  const handlePickIphoneExport = async () => {
    setIphoneImportFeedback(null);
    setIphonePickLoading(true);
    try {
      const documentPicker = getDocumentPickerModule();
      if (!documentPicker) {
        throw new Error(getDocumentPickerMissingMessage());
      }
      const result = await documentPicker.getDocumentAsync({
        multiple: false,
        copyToCacheDirectory: true,
        type: ['application/json', 'text/plain', 'text/*'],
      });
      if (result.canceled) {
        setIphoneImportFeedback('Import cancelled.');
        return;
      }
      const asset = result.assets?.[0];
      if (!asset?.uri) {
        throw new Error('Unable to read the selected file.');
      }

      let payloadText: string | null = null;
      if (asset.file && typeof asset.file.text === 'function') {
        payloadText = await asset.file.text();
      }
      if (!payloadText) {
        payloadText = await readTextFromUri(asset.uri);
      }
      if (!payloadText.trim()) {
        throw new Error('Selected file is empty.');
      }

      setIphonePayload(payloadText);
      const parsed = parseIphonePayload(payloadText);
      setIphoneImportFeedback(
        `Loaded ${asset.name || 'export file'}: ${parsed.sampleCount} samples across ${parsed.metricCount} metrics.`
      );
    } catch (error) {
      setIphoneBatches([]);
      setSelectedImportMetric(null);
      setImportWindow(null);
      setIphoneImportFeedback(
        error instanceof Error
          ? error.message
          : 'Unable to import this file. You can still paste JSON manually.'
      );
    } finally {
      setIphonePickLoading(false);
    }
  };

  const handleParseIphonePayload = () => {
    const trimmed = iphonePayload.trim();
    if (!trimmed) {
      setIphoneImportFeedback('Paste your iPhone export JSON before parsing.');
      return;
    }
    setIphoneParseLoading(true);
    setIphoneImportFeedback(null);
    try {
      const parsed = parseIphonePayload(trimmed);
      setIphoneImportFeedback(
        `Parsed ${parsed.sampleCount} samples across ${parsed.metricCount} metrics.`
      );
    } catch (error) {
      setIphoneBatches([]);
      setSelectedImportMetric(null);
      setImportWindow(null);
      setIphoneImportFeedback(error instanceof Error ? error.message : 'Unable to parse iPhone export.');
    } finally {
      setIphoneParseLoading(false);
    }
  };

  const handleUploadIphoneImport = async () => {
    if (!iphoneBatches.length) {
      setIphoneImportFeedback('Parse an export before uploading.');
      return;
    }

    setIphoneUploadLoading(true);
    setIphoneImportFeedback(null);
    try {
      const uploadResults = await Promise.all(
        iphoneBatches.map((batch) =>
          runOrQueue({
            endpoint: '/api/streams',
            payload: { metric: batch.metric, samples: batch.samples },
            description: `iPhone import (${batch.metric})`,
          })
        )
      );
      const queuedCount = uploadResults.filter((result) => result.status === 'queued').length;
      const sentCount = uploadResults.length - queuedCount;
      setIphoneImportFeedback(
        queuedCount > 0
          ? `Imported ${importedSampleCount} samples. Uploaded ${sentCount} metrics and queued ${queuedCount}.`
          : `Imported ${importedSampleCount} samples across ${sentCount} metrics.`
      );
    } catch (error) {
      setIphoneImportFeedback(
        error instanceof Error ? error.message : 'Unable to upload imported samples.'
      );
    } finally {
      setIphoneUploadLoading(false);
    }
  };

  const handleClearIphoneImport = () => {
    setIphonePayload('');
    setIphoneBatches([]);
    setSelectedImportMetric(null);
    setImportWindow(null);
    setIphoneImportFeedback(null);
  };

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
        <SectionHeader title="Strava API" subtitle="Personal client keys" />
        <AppInput
          label="Client ID"
          autoCapitalize="none"
          value={form.stravaClientId}
          onChangeText={(value) => handleChange('stravaClientId', value)}
        />
        <AppInput
          label="Client secret"
          autoCapitalize="none"
          value={form.stravaClientSecret}
          onChangeText={(value) => handleChange('stravaClientSecret', value)}
        />
        <AppInput
          label="Redirect URL"
          autoCapitalize="none"
          value={form.stravaRedirectUri}
          onChangeText={(value) => handleChange('stravaRedirectUri', value)}
        />
      </Card>
      <Card>
        <SectionHeader title="Confirm changes" subtitle="Enter your current password to save" />
        <AppText variant="muted" style={styles.helperText}>
          For security, you must confirm any updates with your current password. This protects profile,
          Strava, and photo changes.
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
      <Card>
        <SectionHeader title="Phone data import" subtitle="Import Auto Export / Health JSON from your iPhone" />
        <AppText variant="muted" style={styles.importHint}>
          Export health data to a JSON file on your iPhone, then choose the file here or paste the JSON
          directly. Parsed metrics are uploaded to your stream timeline.
        </AppText>
        <SectionHeader
          title="Direct phone access"
          subtitle={`Status: ${formatPhoneAccessStatus(phoneAccessStatus)}`}
        />
        <View style={styles.importActionsRow}>
          <AppButton
            title="Grant access"
            onPress={handleGrantPhoneAccess}
            loading={phonePermissionLoading}
            style={styles.importActionButton}
          />
          <AppButton
            title="Sync today steps"
            onPress={handleSyncPhoneSteps}
            loading={phoneSyncLoading}
            style={styles.importActionButton}
          />
        </View>
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
        <View style={styles.importDivider} />
        <SectionHeader title="File / paste import" subtitle="Use exported JSON from iPhone apps" />
        <View style={styles.importActionsRow}>
          <AppButton
            title="Choose file"
            variant="ghost"
            onPress={handlePickIphoneExport}
            loading={iphonePickLoading}
            style={styles.importActionButton}
          />
          <AppButton
            title="Parse JSON"
            onPress={handleParseIphonePayload}
            loading={iphoneParseLoading}
            style={styles.importActionButton}
          />
          <AppButton
            title="Upload"
            onPress={handleUploadIphoneImport}
            loading={iphoneUploadLoading}
            disabled={!iphoneBatches.length}
            style={styles.importActionButton}
          />
          <AppButton title="Clear" variant="ghost" onPress={handleClearIphoneImport} />
        </View>
        <AppInput
          label="Import JSON"
          placeholder='{"samples":[{"metric":"exercise.hr","ts":1739836800000,"value":72}]}'
          value={iphonePayload}
          onChangeText={setIphonePayload}
          multiline
          numberOfLines={8}
          autoCapitalize="none"
          style={styles.importInput}
        />
        {iphoneImportFeedback ? (
          <AppText variant="muted" style={styles.helperText}>
            {iphoneImportFeedback}
          </AppText>
        ) : null}
        {iphoneBatches.length ? (
          <>
            <View style={styles.metricsRow}>
              <Metric label="Metrics" value={formatNumber(iphoneBatches.length)} />
              <Metric label="Samples" value={formatNumber(importedSampleCount)} />
              <Metric
                label="Preview"
                value={selectedImportBatch ? toMetricLabel(selectedImportBatch.metric) : '--'}
              />
            </View>
            {importWindow ? (
              <AppText variant="muted" style={styles.helperText}>
                Time window: {importWindow}
              </AppText>
            ) : null}
            <View style={styles.importMetricRow}>
              {visibleImportBatches.map((batch) => (
                <AppButton
                  key={batch.metric}
                  title={toMetricLabel(batch.metric)}
                  variant={selectedImportMetric === batch.metric ? 'secondary' : 'ghost'}
                  onPress={() => setSelectedImportMetric(batch.metric)}
                  style={styles.importMetricButton}
                />
              ))}
            </View>
            {iphoneBatches.length > visibleImportBatches.length ? (
              <AppText variant="muted" style={styles.helperText}>
                +{iphoneBatches.length - visibleImportBatches.length} more metrics parsed.
              </AppText>
            ) : null}
            <TrendChart
              data={selectedImportTrend}
              yLabel={selectedImportBatch ? toMetricLabel(selectedImportBatch.metric) : 'Value'}
            />
          </>
        ) : null}
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

function formatImportWindow(startTs: number | null, endTs: number | null) {
  if (!startTs || !endTs) {
    return null;
  }
  return `${formatDate(new Date(startTs).toISOString(), 'MMM D, HH:mm')} - ${formatDate(
    new Date(endTs).toISOString(),
    'MMM D, HH:mm'
  )}`;
}

function toMetricLabel(metric: string) {
  const tail = metric.split('.').pop() || metric;
  const pretty = tail.replace(/_/g, ' ');
  return pretty.length > 18 ? `${pretty.slice(0, 16)}..` : pretty;
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

async function readTextFromUri(uri: string) {
  try {
    const response = await fetch(uri);
    return await response.text();
  } catch {
    throw new Error('Unable to read the selected file. Paste JSON manually if needed.');
  }
}

const styles = StyleSheet.create({
  container: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
  feedback: {
    textAlign: 'center',
  },
  importHint: {
    marginBottom: spacing.sm,
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
  importInput: {
    minHeight: 140,
    textAlignVertical: 'top',
  },
  importDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.md,
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
  importMetricRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    flexWrap: 'wrap',
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  importMetricButton: {
    flexGrow: 1,
    minWidth: 96,
  },
});
