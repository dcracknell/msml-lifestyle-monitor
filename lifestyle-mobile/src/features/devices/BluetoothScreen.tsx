import { useMemo, useState } from 'react';
import { StyleSheet, View, Switch } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Card, SectionHeader, AppText, AppButton, AppInput, TrendChart, RefreshableScrollView } from '../../components';
import { colors, spacing } from '../../theme';
import { useBluetooth } from '../../providers/BluetoothProvider';
import { formatDate, formatNumber } from '../../utils/format';
import { streamHistoryRequest } from '../../api/endpoints';
import { useAuth } from '../../providers/AuthProvider';
import { useSubject } from '../../providers/SubjectProvider';
import { useSyncQueue } from '../../providers/SyncProvider';
import { parseIPhoneExportPayload, StreamBatch } from './iphoneImport';

export function BluetoothScreen() {
  const { user } = useAuth();
  const { subjectId } = useSubject();
  const { runOrQueue } = useSyncQueue();
  const requestSubject = subjectId && subjectId !== user?.id ? subjectId : undefined;

  const {
    config,
    profiles,
    applyProfile,
    updateConfig,
    bluetoothState,
    status,
    isPoweredOn,
    connectedDevice,
    lastSample,
    recentSamples,
    lastUploadStatus,
    error,
    confirmSystemDevice,
    disconnectFromDevice,
    sendCommand,
    manualPublish,
  } = useBluetooth();

  const [commandText, setCommandText] = useState('');
  const [commandFeedback, setCommandFeedback] = useState<string | null>(null);
  const [commandLoading, setCommandLoading] = useState(false);
  const [manualValue, setManualValue] = useState('');
  const [manualFeedback, setManualFeedback] = useState<string | null>(null);
  const [manualLoading, setManualLoading] = useState(false);
  const [iphonePayload, setIphonePayload] = useState('');
  const [iphoneBatches, setIphoneBatches] = useState<StreamBatch[]>([]);
  const [iphoneImportFeedback, setIphoneImportFeedback] = useState<string | null>(null);
  const [iphoneImportLoading, setIphoneImportLoading] = useState(false);
  const [iphoneUploadLoading, setIphoneUploadLoading] = useState(false);
  const [selectedImportMetric, setSelectedImportMetric] = useState<string | null>(null);
  const [importWindow, setImportWindow] = useState<string | null>(null);

  const { data: streamHistory, refetch, isRefetching } = useQuery({
    queryKey: ['streamHistory', config.metric, requestSubject],
    queryFn: () =>
      streamHistoryRequest({
        metric: config.metric,
        athleteId: requestSubject,
        windowMs: 6 * 60 * 60 * 1000,
        maxPoints: 60,
      }),
    enabled: Boolean(user?.id && config.metric),
  });

  const activeProfile = useMemo(
    () => profiles.find((profile) => profile.id === config.profile) || profiles[0],
    [profiles, config.profile]
  );

  const liveTrend = useMemo(
    () =>
      recentSamples
        .filter((sample) => sample.value !== null && Number.isFinite(sample.value))
        .slice(-32)
        .map((sample) => ({
          label: formatDate(new Date(sample.ts).toISOString(), 'HH:mm:ss'),
          value: sample.value as number,
        })),
    [recentSamples]
  );

  const serverTrend = useMemo(
    () =>
      (streamHistory?.points || [])
        .filter((point) => point.value !== null && Number.isFinite(point.value as number))
        .map((point) => ({
          label: formatDate(new Date(point.ts).toISOString(), 'HH:mm'),
          value: point.value as number,
        })),
    [streamHistory?.points]
  );

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

  const handleSendCommand = async () => {
    const trimmed = commandText.trim();
    if (!trimmed) {
      setCommandFeedback('Enter a command to send.');
      return;
    }
    setCommandFeedback(null);
    setCommandLoading(true);
    try {
      await sendCommand(trimmed);
      setCommandFeedback('Command sent to device.');
      setCommandText('');
    } catch (sendError) {
      setCommandFeedback(sendError instanceof Error ? sendError.message : 'Unable to send command.');
    } finally {
      setCommandLoading(false);
    }
  };

  const handleManualPublish = async () => {
    const numeric = Number(manualValue);
    if (!Number.isFinite(numeric)) {
      setManualFeedback('Enter a numeric sample value.');
      return;
    }
    setManualFeedback(null);
    setManualLoading(true);
    try {
      await manualPublish(numeric);
      setManualFeedback('Sample sent to server.');
      setManualValue('');
      refetch();
    } catch (publishError) {
      setManualFeedback(publishError instanceof Error ? publishError.message : 'Unable to send sample.');
    } finally {
      setManualLoading(false);
    }
  };

  const handleParseIphonePayload = () => {
    const trimmed = iphonePayload.trim();
    if (!trimmed) {
      setIphoneImportFeedback('Paste your iPhone export JSON before parsing.');
      return;
    }

    setIphoneImportLoading(true);
    setIphoneImportFeedback(null);
    try {
      const parsed = parseIPhoneExportPayload(trimmed);
      setIphoneBatches(parsed.batches);
      setSelectedImportMetric(parsed.batches[0]?.metric || null);
      setImportWindow(formatImportWindow(parsed.startTs, parsed.endTs));
      setIphoneImportFeedback(
        `Parsed ${parsed.sampleCount} samples across ${parsed.metricCount} metrics.`
      );
    } catch (parseError) {
      setIphoneBatches([]);
      setSelectedImportMetric(null);
      setImportWindow(null);
      setIphoneImportFeedback(
        parseError instanceof Error ? parseError.message : 'Unable to parse iPhone export.'
      );
    } finally {
      setIphoneImportLoading(false);
    }
  };

  const handleUploadIphoneImport = async () => {
    if (!iphoneBatches.length) {
      setIphoneImportFeedback('Parse an iPhone export before uploading.');
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
      const sampleCount = iphoneBatches.reduce((total, batch) => total + batch.samples.length, 0);

      setIphoneImportFeedback(
        queuedCount > 0
          ? `Imported ${sampleCount} samples. Uploaded ${sentCount} metrics and queued ${queuedCount}.`
          : `Imported ${sampleCount} samples across ${sentCount} metrics.`
      );

      const focusMetric = selectedImportMetric || iphoneBatches[0]?.metric;
      if (focusMetric) {
        updateConfig({ metric: focusMetric });
        refetch();
      }
    } catch (uploadError) {
      setIphoneImportFeedback(
        uploadError instanceof Error ? uploadError.message : 'Unable to upload imported samples.'
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
      refreshing={isRefetching}
      onRefresh={refetch}
      showsVerticalScrollIndicator={false}
    >
      <Card>
        <SectionHeader title="Bluetooth bridge" subtitle={`Adapter: ${bluetoothState}`} />
        <View style={styles.statusRow}>
          <StatusPill label={isPoweredOn ? 'Powered on' : 'Turn on Bluetooth'} active={isPoweredOn} />
          <StatusPill label={`Status: ${status}`} active={status === 'connected'} />
        </View>
        {connectedDevice ? (
          <View style={styles.deviceMeta}>
            <AppText variant="body">Connected to {connectedDevice.name || 'Unnamed peripheral'}</AppText>
            <AppText variant="muted">ID: {connectedDevice.id}</AppText>
          </View>
        ) : (
          <AppText variant="muted">No device connected.</AppText>
        )}
        <View style={styles.instructions}>
          {config.profile === 'apple_watch_companion' ? (
            <>
              <AppText variant="body">
                1. Pair your watch companion peripheral in iOS Bluetooth settings.
              </AppText>
              <AppText variant="body">
                2. Keep the companion app active and tap confirm to start streaming.
              </AppText>
              <AppText variant="muted" style={styles.helper}>
                Apple Watch is usually not directly discoverable as a BLE sensor by iPhone apps.
              </AppText>
            </>
          ) : (
            <>
              <AppText variant="body">1. Open your phone's Bluetooth settings and pair your sensor as usual.</AppText>
              <AppText variant="body">
                2. Keep the device awake, return here, and tap confirm to start streaming.
              </AppText>
            </>
          )}
        </View>
        <View style={styles.actionsRow}>
          <AppButton
            title={connectedDevice ? 'Refresh connection' : 'Confirm connection'}
            onPress={confirmSystemDevice}
            loading={status === 'connecting'}
          />
          {connectedDevice ? (
            <AppButton title="Disconnect" variant="ghost" onPress={disconnectFromDevice} />
          ) : null}
        </View>
        {error ? (
          <AppText variant="muted" style={styles.error}>
            {error}
          </AppText>
        ) : null}
        {lastUploadStatus ? (
          <AppText variant="muted">Last upload: {lastUploadStatus.message}</AppText>
        ) : null}
      </Card>

      <Card>
        <SectionHeader title="Configuration" subtitle="Match your sensor's characteristics" />
        <AppText variant="label" style={styles.profileLabel}>
          Device profile
        </AppText>
        <View style={styles.profileRow}>
          {profiles.map((profile) => (
            <AppButton
              key={profile.id}
              title={profile.shortLabel}
              variant={config.profile === profile.id ? 'secondary' : 'ghost'}
              onPress={() => applyProfile(profile.id)}
              style={styles.profileButton}
            />
          ))}
        </View>
        {activeProfile ? (
          <AppText variant="muted" style={styles.profileDescription}>
            {activeProfile.description}
          </AppText>
        ) : null}
        <AppInput
          label="Service UUID"
          autoCapitalize="characters"
          value={config.serviceUUID}
          onChangeText={(text) => updateConfig({ serviceUUID: text })}
          helperText="Default FFF0"
        />
        <AppInput
          label="Characteristic UUID"
          autoCapitalize="characters"
          value={config.characteristicUUID}
          onChangeText={(text) => updateConfig({ characteristicUUID: text })}
          helperText="Default FFF1"
        />
        <AppInput
          label="Metric name"
          value={config.metric}
          onChangeText={(text) => updateConfig({ metric: text })}
          autoCapitalize="none"
          helperText="Samples are stored under this metric in /api/streams."
        />
        <View style={styles.switchRow}>
          <AppText variant="body">Auto upload samples</AppText>
          <Switch
            value={config.autoUpload}
            onValueChange={(value) => updateConfig({ autoUpload: value })}
            trackColor={{ true: colors.accent, false: colors.border }}
            thumbColor={colors.background}
          />
        </View>
      </Card>

      <Card>
        <SectionHeader title="Live data" subtitle={lastSample ? formatDate(new Date(lastSample.ts).toISOString(), 'MMM D, HH:mm:ss') : 'Waiting for payloads'} />
        <View style={styles.metricsRow}>
          <Metric label="Metric" value={lastSample?.metric || config.metric} />
          <Metric label="Value" value={formatNumber(lastSample?.value)} />
          <Metric label="Raw" value={lastSample?.raw || '--'} />
        </View>
        <TrendChart data={liveTrend} yLabel="Live value" />
      </Card>

      <Card>
        <SectionHeader title="Manual controls" subtitle="Send commands or test uploads" />
        <AppInput
          label="Device command"
          placeholder="e.g. READ"
          value={commandText}
          onChangeText={setCommandText}
          autoCapitalize="characters"
        />
        <AppButton title="Send command" onPress={handleSendCommand} loading={commandLoading} />
        {commandFeedback ? (
          <AppText variant="muted" style={styles.helper}>
            {commandFeedback}
          </AppText>
        ) : null}
        <View style={styles.divider} />
        <AppInput
          label="Manual sample"
          placeholder="123.4"
          keyboardType="numeric"
          value={manualValue}
          onChangeText={setManualValue}
        />
        <AppButton title="Send sample to server" onPress={handleManualPublish} loading={manualLoading} />
        {manualFeedback ? (
          <AppText variant="muted" style={styles.helper}>
            {manualFeedback}
          </AppText>
        ) : null}
      </Card>

      <Card>
        <SectionHeader title="iPhone import" subtitle="Paste Auto Export JSON and preview metrics" />
        <AppText variant="muted" style={styles.importHint}>
          From your iPhone export app, copy JSON data and paste it here. Parsed metrics can be uploaded
          into the same stream pipeline used by Bluetooth imports.
        </AppText>
        <AppInput
          label="Export JSON"
          placeholder='{"samples":[{"metric":"exercise.hr","ts":1739836800000,"value":72}]}'
          value={iphonePayload}
          onChangeText={setIphonePayload}
          multiline
          numberOfLines={8}
          autoCapitalize="none"
          style={styles.importInput}
        />
        <View style={styles.importActionsRow}>
          <AppButton
            title="Parse export"
            onPress={handleParseIphonePayload}
            loading={iphoneImportLoading}
            style={styles.importActionButton}
          />
          <AppButton
            title="Upload to server"
            onPress={handleUploadIphoneImport}
            loading={iphoneUploadLoading}
            disabled={!iphoneBatches.length}
            style={styles.importActionButton}
          />
          <AppButton title="Clear" variant="ghost" onPress={handleClearIphoneImport} />
        </View>
        {iphoneImportFeedback ? (
          <AppText variant="muted" style={styles.helper}>
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
              <AppText variant="muted" style={styles.helper}>
                Time window: {importWindow}
              </AppText>
            ) : null}
            <View style={styles.profileRow}>
              {visibleImportBatches.map((batch) => (
                <AppButton
                  key={batch.metric}
                  title={toMetricLabel(batch.metric)}
                  variant={selectedImportMetric === batch.metric ? 'secondary' : 'ghost'}
                  onPress={() => setSelectedImportMetric(batch.metric)}
                  style={styles.metricChipButton}
                />
              ))}
            </View>
            {iphoneBatches.length > visibleImportBatches.length ? (
              <AppText variant="muted" style={styles.helper}>
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

      <Card>
        <SectionHeader title="Server stream" subtitle={`Metric: ${config.metric}`} />
        <TrendChart data={serverTrend} yLabel="Server value" />
        <AppButton title="Refresh data" onPress={() => refetch()} loading={isRefetching} style={styles.refreshButton} />
        {streamHistory ? (
          <AppText variant="muted" style={styles.helper}>
            Showing {streamHistory.points.length} points from the last window.
          </AppText>
        ) : (
          <AppText variant="muted" style={styles.helper}>
            Trigger uploads to populate server-side samples.
          </AppText>
        )}
      </Card>
    </RefreshableScrollView>
  );
}

function StatusPill({ label, active }: { label: string; active?: boolean }) {
  return (
    <View style={[styles.pill, active ? styles.pillActive : null]}>
      <AppText variant="label">{label}</AppText>
    </View>
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

const styles = StyleSheet.create({
  container: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
  statusRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    flexWrap: 'wrap',
    marginBottom: spacing.sm,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
    flexWrap: 'wrap',
  },
  deviceMeta: {
    marginTop: spacing.xs,
    marginBottom: spacing.xs,
    gap: 4,
  },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  helper: {
    marginTop: spacing.xs,
  },
  importHint: {
    marginBottom: spacing.sm,
  },
  importInput: {
    minHeight: 150,
    textAlignVertical: 'top',
  },
  importActionsRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    flexWrap: 'wrap',
  },
  importActionButton: {
    flexGrow: 1,
    minWidth: 120,
  },
  error: {
    marginTop: spacing.sm,
    color: colors.danger,
  },
  metricsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  metric: {
    flex: 1,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.sm,
  },
  refreshButton: {
    marginTop: spacing.sm,
  },
  instructions: {
    marginTop: spacing.sm,
    gap: spacing.xs,
  },
  profileLabel: {
    marginBottom: spacing.xs,
  },
  profileRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    flexWrap: 'wrap',
    marginBottom: spacing.xs,
  },
  profileButton: {
    flexGrow: 1,
    minWidth: 108,
  },
  metricChipButton: {
    flexGrow: 1,
    minWidth: 104,
  },
  profileDescription: {
    marginBottom: spacing.sm,
  },
  pill: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  pillActive: {
    borderColor: colors.accent,
  },
});
