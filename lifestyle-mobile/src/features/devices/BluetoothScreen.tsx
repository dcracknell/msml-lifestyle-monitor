import { useMemo, useState } from 'react';
import { StyleSheet, View, Pressable, ScrollView } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Card, SectionHeader, AppText, AppButton, AppInput, TrendChart } from '../../components';
import { colors, spacing } from '../../theme';
import { useBluetooth, BluetoothDeviceSummary } from '../../providers/BluetoothProvider';
import { formatDate, formatNumber } from '../../utils/format';
import { streamHistoryRequest } from '../../api/endpoints';
import { useAuth } from '../../providers/AuthProvider';
import { useSubject } from '../../providers/SubjectProvider';
import { useSyncQueue } from '../../providers/SyncProvider';
import { parseIPhoneExportPayload, StreamBatch } from './iphoneImport';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function StatusPill({ label, active }: { label: string; active?: boolean }) {
  return (
    <View style={[pillStyles.pill, active ? pillStyles.pillActive : null]}>
      <View style={[pillStyles.dot, active ? pillStyles.dotActive : pillStyles.dotInactive]} />
      <AppText variant="label" style={active ? pillStyles.textActive : pillStyles.textInactive}>
        {label}
      </AppText>
    </View>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={metricStyles.metric}>
      <AppText variant="label">{label}</AppText>
      <AppText variant="heading">{value}</AppText>
    </View>
  );
}

function AppToggle({
  value,
  onValueChange,
}: {
  value: boolean;
  onValueChange: (val: boolean) => void;
}) {
  return (
    <Pressable
      onPress={() => onValueChange(!value)}
      style={[toggleStyles.track, value ? toggleStyles.trackOn : toggleStyles.trackOff]}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
    >
      <View style={[toggleStyles.thumb, value ? toggleStyles.thumbOn : toggleStyles.thumbOff]} />
    </Pressable>
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

// ---------------------------------------------------------------------------
// DeviceRow – one row in the scan results list
// ---------------------------------------------------------------------------

function signalInfo(rssi: number | null | undefined): { label: string; bars: string; color: string } {
  const r = rssi ?? -100;
  if (r > -60) return { label: 'Strong',   bars: '████', color: colors.accent };
  if (r > -75) return { label: 'Good',     bars: '███░', color: '#4ade80' };
  if (r > -85) return { label: 'Weak',     bars: '██░░', color: colors.warning };
  return         { label: 'Poor',      bars: '█░░░', color: colors.danger };
}

function DeviceRow({
  device,
  onConnect,
  connecting,
}: {
  device: BluetoothDeviceSummary;
  onConnect: () => void;
  connecting: boolean;
}) {
  const sig = signalInfo(device.rssi);
  return (
    <View style={deviceRowStyles.row}>
      <View style={deviceRowStyles.info}>
        <AppText variant="body" style={deviceRowStyles.name}>
          {device.name || 'Unknown device'}
        </AppText>
        <View style={deviceRowStyles.sigRow}>
          <AppText style={[deviceRowStyles.bars, { color: sig.color }]}>{sig.bars}</AppText>
          <AppText variant="muted" style={deviceRowStyles.sigLabel}>
            {sig.label}  {device.rssi != null ? `${device.rssi} dBm` : ''}
          </AppText>
        </View>
        <AppText variant="muted" style={deviceRowStyles.id} numberOfLines={1}>
          {device.id}
        </AppText>
      </View>
      <AppButton
        title="Connect"
        onPress={onConnect}
        loading={connecting}
        style={deviceRowStyles.connectBtn}
      />
    </View>
  );
}

const deviceRowStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.sm,
  },
  info: {
    flex: 1,
    gap: 2,
  },
  name: {
    fontWeight: '600',
  },
  sigRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  bars: {
    fontSize: 11,
    letterSpacing: 1,
  },
  sigLabel: {
    fontSize: 12,
  },
  id: {
    fontSize: 10,
    opacity: 0.5,
  },
  connectBtn: {
    flexShrink: 0,
    minWidth: 88,
  },
});

// ---------------------------------------------------------------------------
// BluetoothDevicesSection
// ---------------------------------------------------------------------------

export function BluetoothDevicesSection() {
  const { user } = useAuth();
  const { subjectId } = useSubject();
  const requestSubject = subjectId && subjectId !== user?.id ? subjectId : undefined;

  const {
    config,
    profiles,
    applyProfile,
    updateConfig,
    bluetoothState,
    status,
    isPoweredOn,
    isScanning,
    devices,
    connectedDevice,
    lastSample,
    recentSamples,
    lastUploadStatus,
    error,
    startScan,
    stopScan,
    connectToDevice,
    disconnectFromDevice,
  } = useBluetooth();

  const { data: streamHistory } = useQuery({
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

  return (
    <>
      {/* Device scanner card */}
      <Card>
        <SectionHeader
          title="Device scanner"
          subtitle={`Adapter: ${bluetoothState}`}
          action={
            <View style={styles.statusPills}>
              <StatusPill
                label={isPoweredOn ? 'Powered on' : 'Turn on Bluetooth'}
                active={isPoweredOn}
              />
              <StatusPill label={`Status: ${status}`} active={status === 'connected'} />
            </View>
          }
        />

        {connectedDevice ? (
          /* ── Connected state ── */
          <>
            <View style={styles.deviceMeta}>
              <AppText variant="body">
                Connected to {connectedDevice.name || 'Unnamed device'}
              </AppText>
              <AppText variant="muted">{connectedDevice.id}</AppText>
            </View>
            <AppButton
              title="Disconnect"
              variant="ghost"
              onPress={disconnectFromDevice}
              style={styles.disconnectBtn}
            />
          </>
        ) : (
          /* ── Scan state ── */
          <>
            <View style={styles.scanRow}>
              <AppButton
                title={isScanning ? 'Stop scanning' : 'Scan for devices'}
                onPress={isScanning ? stopScan : startScan}
                loading={status === 'connecting'}
                style={styles.scanBtn}
              />
              {isScanning ? (
                <AppText variant="muted" style={styles.scanningLabel}>Scanning…</AppText>
              ) : null}
            </View>

            {/* Device list */}
            {devices.length > 0 ? (
              <ScrollView style={styles.deviceList} scrollEnabled={false}>
                {[...devices]
                  .sort((a, b) => (b.rssi ?? -100) - (a.rssi ?? -100))
                  .map((device) => (
                    <DeviceRow
                      key={device.id}
                      device={device}
                      onConnect={() => {
                        stopScan();
                        connectToDevice(device.id);
                      }}
                      connecting={status === 'connecting'}
                    />
                  ))}
              </ScrollView>
            ) : (
              <AppText variant="muted" style={styles.helper}>
                {isScanning
                  ? 'Power on your HM-10 and wait — devices appear here as they are found.'
                  : 'Tap "Scan for devices" to discover nearby BLE sensors.'}
              </AppText>
            )}
          </>
        )}

        {error ? (
          <AppText variant="muted" style={styles.error}>
            {error}
          </AppText>
        ) : null}
        {lastUploadStatus ? (
          <AppText variant="muted" style={styles.helper}>
            Last upload: {lastUploadStatus.message}
          </AppText>
        ) : null}
      </Card>

      {/* Configuration card */}
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
          style={{ borderColor: '#1e3a5f' }}
        />
        <AppInput
          label="Characteristic UUID"
          autoCapitalize="characters"
          value={config.characteristicUUID}
          onChangeText={(text) => updateConfig({ characteristicUUID: text })}
          helperText="Default FFF1"
          style={{ borderColor: '#1e3a5f' }}
        />
        <AppInput
          label="Metric name"
          value={config.metric}
          onChangeText={(text) => updateConfig({ metric: text })}
          autoCapitalize="none"
          helperText="Samples are stored under this metric in /api/streams."
          style={{ borderColor: '#1e3a5f' }}
        />
        <View style={styles.switchRow}>
          <AppText variant="body">Auto upload samples</AppText>
          <AppToggle
            value={config.autoUpload}
            onValueChange={(value) => updateConfig({ autoUpload: value })}
          />
        </View>
      </Card>

      {/* Live data card */}
      <Card>
        <SectionHeader
          title="Live data"
          subtitle={
            lastSample
              ? formatDate(new Date(lastSample.ts).toISOString(), 'MMM D, HH:mm:ss')
              : 'Waiting for payloads'
          }
        />
        <View style={styles.metricsRow}>
          <Metric label="Metric" value={lastSample?.metric || config.metric} />
          <Metric label="Value" value={formatNumber(lastSample?.value)} />
          <Metric label="Raw" value={lastSample?.raw || '--'} />
        </View>
        {liveTrend.length === 0 ? (
          <View style={styles.emptyChart}>
            <AppText style={styles.emptyChartIcon}>◌</AppText>
            <AppText variant="muted">Waiting for device data</AppText>
          </View>
        ) : (
          <TrendChart data={liveTrend} yLabel="Live value" />
        )}
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------
// BluetoothDeveloperSection
// ---------------------------------------------------------------------------

export function BluetoothDeveloperSection() {
  const { user } = useAuth();
  const { subjectId } = useSubject();
  const { runOrQueue } = useSyncQueue();
  const requestSubject = subjectId && subjectId !== user?.id ? subjectId : undefined;

  const { config, updateConfig, sendCommand, manualPublish } = useBluetooth();

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
      setManualFeedback(
        publishError instanceof Error ? publishError.message : 'Unable to send sample.'
      );
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
    <>
      {/* Manual controls card */}
      <View style={[styles.devCard]}>
        <Card style={styles.devCardInner}>
          <AppText style={styles.devEyebrow}>MANUAL CONTROLS</AppText>
          <SectionHeader title="Manual controls" subtitle="Send commands or test uploads" />
          <AppInput
            label="Device command"
            placeholder="e.g. READ"
            value={commandText}
            onChangeText={setCommandText}
            autoCapitalize="characters"
            style={{ borderColor: '#1e3a5f' }}
          />
          <AppButton
            title="Send command"
            variant="ghost"
            onPress={handleSendCommand}
            loading={commandLoading}
          />
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
            style={{ borderColor: '#1e3a5f' }}
          />
          <AppButton
            title="Send sample to server"
            variant="ghost"
            onPress={handleManualPublish}
            loading={manualLoading}
          />
          {manualFeedback ? (
            <AppText variant="muted" style={styles.helper}>
              {manualFeedback}
            </AppText>
          ) : null}
        </Card>
      </View>

      {/* iPhone import card */}
      <View style={styles.devCard}>
        <Card style={styles.devCardInner}>
          <AppText style={styles.devEyebrow}>IPHONE IMPORT</AppText>
          <SectionHeader
            title="iPhone import"
            subtitle="Paste Auto Export JSON and preview metrics"
          />
          <AppText variant="muted" style={styles.importHint}>
            From your iPhone export app, copy JSON data and paste it here. Parsed metrics can be
            uploaded into the same stream pipeline used by Bluetooth imports.
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
          <AppButton
            title="Parse export"
            onPress={handleParseIphonePayload}
            loading={iphoneImportLoading}
            style={{ width: '100%' }}
          />
          <AppButton
            title="Upload to server"
            variant="ghost"
            onPress={handleUploadIphoneImport}
            loading={iphoneUploadLoading}
            disabled={!iphoneBatches.length}
            style={{ width: '100%' }}
          />
          <Pressable onPress={handleClearIphoneImport} style={styles.clearLink}>
            <AppText variant="muted" style={styles.clearLinkText}>
              Clear
            </AppText>
          </Pressable>
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
      </View>

      {/* Server stream card */}
      <View style={styles.devCard}>
        <Card style={styles.devCardInner}>
          <AppText style={styles.devEyebrow}>SERVER STREAM</AppText>
          <SectionHeader title="Server stream" subtitle={`Metric: ${config.metric}`} />
          {serverTrend.length === 0 ? (
            <View style={styles.emptyChart}>
              <AppText style={styles.emptyChartIcon}>◌</AppText>
              <AppText variant="muted">No stream data recorded yet</AppText>
            </View>
          ) : (
            <TrendChart data={serverTrend} yLabel="Server value" />
          )}
          <AppButton
            title="Refresh data"
            onPress={() => refetch()}
            loading={isRefetching}
            style={styles.refreshButton}
          />
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
      </View>
    </>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const pillStyles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  pillActive: {
    borderColor: colors.accent,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  dotActive: {
    backgroundColor: colors.accent,
  },
  dotInactive: {
    backgroundColor: colors.muted,
  },
  textActive: {
    color: colors.accent,
  },
  textInactive: {
    color: colors.muted,
  },
});

const metricStyles = StyleSheet.create({
  metric: {
    flex: 1,
  },
});

const toggleStyles = StyleSheet.create({
  track: {
    width: 51,
    height: 31,
    borderRadius: 15.5,
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  trackOn: {
    backgroundColor: colors.accent,
  },
  trackOff: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: 'transparent',
  },
  thumb: {
    width: 27,
    height: 27,
    borderRadius: 13.5,
    backgroundColor: colors.background,
  },
  thumbOn: {
    alignSelf: 'flex-end',
  },
  thumbOff: {
    alignSelf: 'flex-start',
  },
});

const styles = StyleSheet.create({
  statusPills: {
    flexDirection: 'row',
    gap: spacing.xs,
    flexWrap: 'wrap',
  },
  deviceMeta: {
    marginTop: spacing.xs,
    marginBottom: spacing.xs,
    gap: 4,
  },
  disconnectBtn: {
    marginTop: spacing.sm,
  },
  scanRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  scanBtn: {
    flex: 1,
  },
  scanningLabel: {
    fontSize: 13,
  },
  deviceList: {
    marginTop: spacing.sm,
    maxHeight: 340,
  },
  helper: {
    marginTop: spacing.xs,
  },
  error: {
    marginTop: spacing.sm,
    color: colors.danger,
  },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  metricsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginTop: spacing.sm,
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
  profileDescription: {
    marginBottom: spacing.sm,
  },
  metricChipButton: {
    flexGrow: 1,
    minWidth: 104,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.sm,
  },
  importHint: {
    marginBottom: spacing.sm,
  },
  importInput: {
    minHeight: 150,
    textAlignVertical: 'top',
    borderColor: '#1e3a5f',
  },
  refreshButton: {
    marginTop: spacing.sm,
  },
  emptyChart: {
    alignItems: 'center',
    paddingVertical: spacing.lg,
    gap: spacing.xs,
  },
  emptyChartIcon: {
    fontSize: 28,
    color: colors.muted,
  },
  devCard: {
    borderRadius: 16,
    overflow: 'hidden',
    borderLeftWidth: 3,
    borderLeftColor: colors.warning + '66',
  },
  devCardInner: {
    backgroundColor: colors.glass,
  },
  devEyebrow: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.6,
    color: colors.warning,
    marginBottom: spacing.xs,
  },
  clearLink: {
    alignItems: 'center',
    paddingVertical: spacing.xs,
  },
  clearLinkText: {
    color: colors.muted,
    fontSize: 13,
  },
});
