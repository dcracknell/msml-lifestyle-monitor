import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { AppButton, AppInput, AppText, Card, SectionHeader, TrendChart } from '../../components';
import {
  BluetoothDeviceSummary,
  HM10_BAUD_RATE_OPTIONS,
  isHm10UnoCautionBaudRate,
  useBluetooth,
} from '../../providers/BluetoothProvider';
import { colors, spacing } from '../../theme';
import { formatDate, formatNumber } from '../../utils/format';

const LIVE_SAMPLE_WINDOW_MS = 10_000;
const LIVE_METRIC_SNAPSHOT_LIMIT = 6;

function formatSampleFreshness(ts: number | null | undefined, now: number) {
  if (!ts) {
    return 'No samples received yet.';
  }

  const ageMs = Math.max(0, now - ts);
  if (ageMs < 1_500) {
    return 'Last packet just now.';
  }

  if (ageMs < 60_000) {
    return `Last packet ${Math.round(ageMs / 1_000)}s ago.`;
  }

  const ageMinutes = Math.round(ageMs / 60_000);
  if (ageMinutes < 60) {
    return `Last packet ${ageMinutes}m ago.`;
  }

  const ageHours = Math.round(ageMinutes / 60);
  return `Last packet ${ageHours}h ago.`;
}

function formatTrafficFreshness(ts: number | null | undefined, now: number) {
  if (!ts) {
    return 'No BLE notifications received yet.';
  }
  return formatSampleFreshness(ts, now);
}

function formatTransportOutcome(outcome: string) {
  switch (outcome) {
    case 'parsed':
      return 'Parsed sample';
    case 'buffering':
      return 'Waiting for newline';
    case 'binary_only':
      return 'Bytes only';
    case 'overflow':
      return 'Buffer overflow';
    case 'unparsed':
      return 'Unparsed text';
    case 'empty':
      return 'Empty packet';
    default:
      return 'Idle';
  }
}

function formatHm10LinkGuardStatus(status: string) {
  switch (status) {
    case 'checking':
      return 'Checking';
    case 'verified':
      return 'Verified';
    case 'failed':
      return 'Needs attention';
    default:
      return 'Idle';
  }
}

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

function Metric({
  label,
  value,
  compact,
  valueNumberOfLines,
}: {
  label: string;
  value: string;
  compact?: boolean;
  valueNumberOfLines?: number;
}) {
  return (
    <View style={metricStyles.metric}>
      <AppText variant="label">{label}</AppText>
      <AppText
        variant={compact ? 'body' : 'heading'}
        weight={compact ? 'semibold' : 'regular'}
        style={compact ? metricStyles.compactValue : undefined}
        numberOfLines={valueNumberOfLines}
      >
        {value}
      </AppText>
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

function signalInfo(rssi: number | null | undefined): { label: string; bars: string; color: string } {
  const r = rssi ?? -100;
  if (r > -60) return { label: 'Strong', bars: '||||', color: colors.accent };
  if (r > -75) return { label: 'Good', bars: '|||.', color: '#4ade80' };
  if (r > -85) return { label: 'Weak', bars: '||..', color: colors.warning };
  return { label: 'Poor', bars: '|...', color: colors.danger };
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
        <AppText variant="body" weight="semibold" style={deviceRowStyles.name} numberOfLines={2}>
          {device.name || 'Unknown device'}
        </AppText>
        <View style={deviceRowStyles.sigRow}>
          <AppText style={[deviceRowStyles.bars, { color: sig.color }]}>{sig.bars}</AppText>
          <AppText variant="muted" style={deviceRowStyles.sigLabel}>
            {sig.label}
            {device.rssi != null ? `  ${device.rssi} dBm` : ''}
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

export function BluetoothDevicesSection() {
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
    transportDebug,
    hm10LinkGuard,
    lastUploadStatus,
    error,
    startScan,
    stopScan,
    connectToDevice,
    confirmSystemDevice,
    disconnectFromDevice,
    applyHm10BaudRate,
    verifyHm10Link,
  } = useBluetooth();
  const [now, setNow] = useState(() => Date.now());
  const [isApplyingHm10Baud, setIsApplyingHm10Baud] = useState(false);
  const [hm10ControlNotice, setHm10ControlNotice] = useState<{
    kind: 'info' | 'error';
    text: string;
  } | null>(null);

  useEffect(() => {
    setNow(Date.now());

    if (!connectedDevice && !lastSample && !transportDebug.lastNotificationTs) {
      return undefined;
    }

    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1_000);

    return () => clearInterval(timer);
  }, [connectedDevice, lastSample?.ts, transportDebug.lastNotificationTs]);

  const activeProfile = useMemo(
    () => profiles.find((profile) => profile.id === config.profile) || profiles[0],
    [profiles, config.profile]
  );

  const focusMetric = useMemo(() => {
    const configuredMetric = config.metric.trim();
    const latestConfiguredMetric = [...recentSamples]
      .reverse()
      .find((sample) => sample.metric === configuredMetric && sample.value !== null);
    if (latestConfiguredMetric) {
      return configuredMetric;
    }
    return lastSample?.metric || configuredMetric;
  }, [config.metric, lastSample?.metric, recentSamples]);

  const latestMetricSamples = useMemo(() => {
    const latestByMetric = new Map<string, (typeof recentSamples)[number]>();
    [...recentSamples].reverse().forEach((sample) => {
      if (!sample.metric || latestByMetric.has(sample.metric)) {
        return;
      }
      latestByMetric.set(sample.metric, sample);
    });
    return Array.from(latestByMetric.values())
      .sort((a, b) => b.ts - a.ts)
      .slice(0, LIVE_METRIC_SNAPSHOT_LIMIT);
  }, [recentSamples]);

  const focusedSample = useMemo(
    () => latestMetricSamples.find((sample) => sample.metric === focusMetric) || lastSample,
    [focusMetric, lastSample, latestMetricSamples]
  );

  const liveTrend = useMemo(
    () =>
      recentSamples
        .filter(
          (sample) =>
            sample.metric === focusMetric && sample.value !== null && Number.isFinite(sample.value)
        )
        .slice(-32)
        .map((sample) => ({
          label: formatDate(new Date(sample.ts).toISOString(), 'HH:mm:ss'),
          value: sample.value as number,
        })),
    [focusMetric, recentSamples]
  );

  const scanStatusLabel = status === 'connected' ? 'Connected' : isScanning ? 'Scanning' : 'Ready';
  const lastSampleAgeMs = lastSample ? Math.max(0, now - lastSample.ts) : null;
  const lastTrafficAgeMs = transportDebug.lastNotificationTs
    ? Math.max(0, now - transportDebug.lastNotificationTs)
    : null;
  const isReceivingLiveData = lastSampleAgeMs !== null && lastSampleAgeMs <= LIVE_SAMPLE_WINDOW_MS;
  const isReceivingAnyTraffic = lastTrafficAgeMs !== null && lastTrafficAgeMs <= LIVE_SAMPLE_WINDOW_MS;
  const hasNeverSeenHm10Traffic =
    config.profile === 'arduino_hm10' &&
    Boolean(connectedDevice) &&
    transportDebug.totalNotifications === 0;
  const isConnectionBusy = status === 'connecting';
  const streamStatusLabel = isReceivingLiveData
    ? 'Data live'
    : isReceivingAnyTraffic
      ? 'Traffic only'
    : lastSample
      ? 'Data waiting'
      : 'No data';
  const liveStatusTitle = isReceivingLiveData
    ? 'Live data is coming in'
    : isReceivingAnyTraffic
      ? 'BLE traffic detected'
    : connectedDevice
      ? 'Connected, waiting for data'
      : 'No live data yet';
  const liveStatusMessage = connectedDevice
    ? isReceivingLiveData
      ? 'Packets are arriving from your sensor now.'
      : isReceivingAnyTraffic
        ? 'Notifications are arriving, but the app has not parsed a clean sensor sample yet.'
      : hasNeverSeenHm10Traffic
        ? 'Connected, but the HM-10 has not emitted any BLE notifications on this service yet. That usually means the UART baud or BLE UART profile still needs repair.'
      : 'The device is connected, but no new packets have arrived recently.'
    : 'Connect a device to start receiving live samples.';
  const liveFreshnessLabel = formatSampleFreshness(lastSample?.ts, now);
  const trafficFreshnessLabel = formatTrafficFreshness(transportDebug.lastNotificationTs, now);
  const statusFreshnessLabel = isReceivingLiveData ? liveFreshnessLabel : trafficFreshnessLabel;
  const showPairedDeviceHint =
    config.profile === 'arduino_hm10' || config.profile === 'apple_watch_companion';
  const selectedHm10BaudNeedsCaution = isHm10UnoCautionBaudRate(config.hm10BaudRate);
  const isCheckingHm10Link = hm10LinkGuard.status === 'checking';
  const hm10LinkProbeFreshness = hm10LinkGuard.lastProbeTs
    ? formatSampleFreshness(hm10LinkGuard.lastProbeTs, now)
    : 'No stream probe parsed yet.';
  const hm10LinkVerifiedFreshness = hm10LinkGuard.lastVerifiedTs
    ? formatSampleFreshness(hm10LinkGuard.lastVerifiedTs, now)
    : 'Bidirectional link has not been verified yet.';
  const handleApplyHm10Baud = async () => {
    setIsApplyingHm10Baud(true);
    setHm10ControlNotice(null);
    try {
      const appliedBaud = await applyHm10BaudRate(config.hm10BaudRate);
      await disconnectFromDevice();
      setHm10ControlNotice({
        kind: 'info',
        text:
          `Saved ${appliedBaud} baud. The app disconnected so the Arduino can switch ` +
          'the HM-10 UART side. Wait 2 seconds, reconnect, then watch for sensor.hm10_link_probe or Transport debug traffic.' +
          (isHm10UnoCautionBaudRate(appliedBaud)
            ? ' That rate is above the usual Uno SoftwareSerial comfort zone, so if the stream goes noisy try 38400 or below.'
            : ''),
      });
    } catch (applyError) {
      setHm10ControlNotice({
        kind: 'error',
        text:
          applyError instanceof Error
            ? applyError.message
            : 'Unable to apply the HM-10 baud change.',
      });
    } finally {
      setIsApplyingHm10Baud(false);
    }
  };
  const handleVerifyHm10Link = async () => {
    try {
      await verifyHm10Link();
    } catch {
      // The provider records a user-facing failure message in hm10LinkGuard.
    }
  };

  useEffect(() => {
    if (config.profile !== 'arduino_hm10' || !connectedDevice || status !== 'connected') {
      return undefined;
    }
    if (transportDebug.totalNotifications > 0 || hm10LinkGuard.lastCheckStartedTs !== null) {
      return undefined;
    }
    const timer = setTimeout(() => {
      verifyHm10Link().catch(() => {
        // The provider records a user-facing failure message in hm10LinkGuard.
      });
    }, 1_500);
    return () => clearTimeout(timer);
  }, [
    config.profile,
    connectedDevice?.id,
    hm10LinkGuard.lastCheckStartedTs,
    status,
    transportDebug.totalNotifications,
    verifyHm10Link,
  ]);

  return (
    <>
      <Card>
        <SectionHeader
          title="Device scanner"
          subtitle={
            connectedDevice
              ? 'Connected and ready to receive live samples.'
              : `Adapter: ${bluetoothState}`
          }
        />

        <View style={styles.statusStack}>
          <View style={styles.statusPills}>
            <StatusPill label={isPoweredOn ? 'Bluetooth on' : 'Bluetooth off'} active={isPoweredOn} />
            <StatusPill label={scanStatusLabel} active={status === 'connected' || isScanning} />
            <StatusPill label={streamStatusLabel} active={isReceivingLiveData || isReceivingAnyTraffic} />
          </View>
          {activeProfile ? (
            <AppText variant="muted" style={styles.profileSummary}>
              Using the {activeProfile.label} preset.
            </AppText>
          ) : null}
        </View>

        {connectedDevice ? (
          <>
            <View style={styles.connectedPanel}>
              <AppText variant="body" weight="semibold">
                {connectedDevice.name || 'Unnamed device'}
              </AppText>
              <AppText variant="muted">{connectedDevice.id}</AppText>
            </View>
            <AppButton
              title="Disconnect"
              variant="ghost"
              onPress={disconnectFromDevice}
              style={styles.fullWidthButton}
            />
          </>
        ) : (
          <>
            <AppButton
              title={isScanning ? 'Stop scanning' : 'Scan for devices'}
              onPress={isScanning ? stopScan : startScan}
              loading={isConnectionBusy}
              style={styles.fullWidthButton}
            />
            <AppButton
              title="Confirm paired device"
              variant="ghost"
              onPress={() => {
                if (isScanning) {
                  stopScan();
                }
                confirmSystemDevice();
              }}
              disabled={isConnectionBusy}
              style={styles.secondaryActionButton}
            />
            {showPairedDeviceHint ? (
              <AppText variant="muted" style={styles.helper}>
                Use this when the HM-10 is already paired in system Bluetooth settings and does not
                appear in the scan list.
              </AppText>
            ) : null}
            {isScanning ? (
              <AppText variant="muted" style={styles.scanningLabel}>
                Searching for nearby sensors...
              </AppText>
            ) : null}

            {devices.length > 0 ? (
              <ScrollView style={styles.deviceList} contentContainerStyle={styles.deviceListContent}>
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
                      connecting={isConnectionBusy}
                    />
                  ))}
              </ScrollView>
            ) : (
              <View style={styles.emptyState}>
                <AppText variant="body" weight="semibold">
                  No devices found yet
                </AppText>
                <AppText variant="muted">
                  {isScanning
                    ? 'Keep your sensor powered on and nearby. It will appear here when it is discovered.'
                    : 'Tap "Scan for devices" to look for nearby BLE sensors.'}
                </AppText>
              </View>
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

      <Card>
        <SectionHeader title="Sensor setup" subtitle="Choose the preset that matches your device." />
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
          <>
            <AppText variant="muted" style={styles.profileDescription}>
              {activeProfile.description}
            </AppText>
            <View style={styles.configSummary}>
              <AppText variant="label">Preset details</AppText>
              <AppText variant="muted" style={styles.configSummaryText}>
                Service {config.serviceUUID}, characteristic {config.characteristicUUID}, metric{' '}
                {config.metric}.
              </AppText>
            </View>
            <AppText variant="muted" style={styles.profileTip}>
              {config.profile === 'arduino_hm10'
                ? 'HM-10 modules usually use FFE0 / FFE1. Some clones use FFF0 / FFF1 instead.'
                : 'Edit the UUIDs below if your peripheral advertises different values.'}
            </AppText>
          </>
        ) : null}
        <AppInput
          label="Service UUID"
          value={config.serviceUUID}
          onChangeText={(value) => updateConfig({ serviceUUID: value })}
          placeholder="FFE0"
          autoCapitalize="characters"
          autoCorrect={false}
        />
        <AppInput
          label="Characteristic UUID"
          value={config.characteristicUUID}
          onChangeText={(value) => updateConfig({ characteristicUUID: value })}
          placeholder="FFE1"
          autoCapitalize="characters"
          autoCorrect={false}
        />
        <AppInput
          label="Metric name"
          value={config.metric}
          onChangeText={(value) => updateConfig({ metric: value })}
          placeholder="sensor.aht20_temperature_c"
          autoCapitalize="none"
          autoCorrect={false}
          helperText={
            config.profile === 'arduino_hm10'
              ? 'The Arduino mock sends named sensor.* metrics. This field controls the live chart focus and acts as a fallback if a packet omits its metric.'
              : 'Used as the upload metric when the payload is a bare number or omits a metric name.'
          }
        />
        {config.profile === 'arduino_hm10' ? (
          <View style={styles.hm10ControlCard}>
            <AppText variant="label">HM-10 UART baud</AppText>
            <View style={styles.hm10BaudRow}>
              {HM10_BAUD_RATE_OPTIONS.map((baud) => (
                <AppButton
                  key={baud}
                  title={String(baud)}
                  variant={config.hm10BaudRate === baud ? 'secondary' : 'ghost'}
                  onPress={() => {
                    setHm10ControlNotice(null);
                    updateConfig({ hm10BaudRate: baud });
                  }}
                  style={styles.hm10BaudButton}
                />
              ))}
            </View>
            <AppText variant="muted" style={styles.hm10ControlHint}>
              The app can switch the HM-10 between 1200, 2400, 4800, 9600, 19200, 38400, 57600,
              and 115200 baud. Uno SoftwareSerial is usually happiest from 1200 through 38400, so
              start there and only try the faster rates if you need recovery or a board with a
              stronger serial link. If Transport debug shows changing hex/text but no parsed sample,
              the HM-10 UART baud is still wrong.
              {selectedHm10BaudNeedsCaution
                ? ' The currently selected rate is in the higher-speed caution range for an Uno.'
                : ''}
            </AppText>
            <AppButton
              title={connectedDevice ? 'Apply baud and disconnect' : 'Connect to apply baud'}
              variant="ghost"
              onPress={handleApplyHm10Baud}
              loading={isApplyingHm10Baud}
              disabled={!connectedDevice}
              style={styles.fullWidthButton}
            />
            {hm10ControlNotice ? (
              <AppText
                variant="muted"
                style={[
                  styles.hm10ControlNotice,
                  hm10ControlNotice.kind === 'error' ? styles.hm10ControlNoticeError : null,
                ]}
              >
                {hm10ControlNotice.text}
              </AppText>
            ) : null}
          </View>
        ) : null}
        <View style={styles.switchRow}>
          <AppText variant="body">Auto upload samples</AppText>
          <AppToggle
            value={config.autoUpload}
            onValueChange={(value) => updateConfig({ autoUpload: value })}
          />
        </View>
      </Card>

      <Card>
        <SectionHeader
          title="Live data"
          subtitle={
            focusedSample
              ? `${focusMetric} - ${formatDate(new Date(focusedSample.ts).toISOString(), 'MMM D, HH:mm:ss')}`
              : 'Waiting for payloads'
          }
        />
        <View
          style={[
            styles.liveBanner,
            isReceivingLiveData || isReceivingAnyTraffic ? styles.liveBannerActive : styles.liveBannerInactive,
          ]}
        >
          <View
            style={[
              styles.liveBannerDot,
              isReceivingLiveData || isReceivingAnyTraffic ? styles.liveBannerDotActive : styles.liveBannerDotInactive,
            ]}
          />
          <View style={styles.liveBannerContent}>
            <AppText variant="body" weight="semibold">
              {liveStatusTitle}
            </AppText>
            <AppText variant="muted" style={styles.liveBannerText}>
              {liveStatusMessage} {statusFreshnessLabel}
            </AppText>
          </View>
        </View>
        <View style={styles.metricsRow}>
          <Metric label="Metric" value={focusMetric} compact valueNumberOfLines={2} />
          <Metric label="Value" value={formatNumber(focusedSample?.value)} />
        </View>
        <View style={styles.rawPayload}>
          <AppText variant="label">Last parsed payload</AppText>
          <AppText variant="muted" style={styles.rawPayloadText}>
            {lastSample?.raw || 'Waiting for device data'}
          </AppText>
        </View>
        <View style={styles.rawPayload}>
          <AppText variant="label">Transport debug</AppText>
          <View style={styles.metricsRow}>
            <Metric label="Packets" value={String(transportDebug.totalNotifications)} compact />
            <Metric label="Last bytes" value={String(transportDebug.lastNotificationBytes)} compact />
            <Metric label="Buffer" value={String(transportDebug.lineBufferLength)} compact />
          </View>
          <AppText variant="muted" style={styles.rawPayloadText}>
            {trafficFreshnessLabel} Parser state: {formatTransportOutcome(transportDebug.lastOutcome)}.
            {transportDebug.parseIssueCount > 0
              ? ` Suspect packets: ${transportDebug.parseIssueCount}.`
              : ''}
          </AppText>
          <AppText variant="label">Last chunk text</AppText>
          <AppText variant="muted" style={styles.rawPayloadText}>
            {transportDebug.lastNotificationText || 'No printable UTF-8 text decoded from the last BLE notification yet.'}
          </AppText>
          <AppText variant="label">Last chunk hex</AppText>
          <AppText variant="muted" style={styles.rawPayloadText}>
            {transportDebug.lastNotificationHex || 'No BLE bytes captured yet.'}
          </AppText>
          {config.profile === 'arduino_hm10' ? (
            <>
              <AppText variant="label">Link guard</AppText>
              <View style={styles.metricsRow}>
                <Metric
                  label="Verify"
                  value={formatHm10LinkGuardStatus(hm10LinkGuard.status)}
                  compact
                  valueNumberOfLines={2}
                />
                <Metric
                  label="Probe"
                  value={hm10LinkGuard.lastProbeTs ? 'Seen' : 'Missing'}
                  compact
                />
                <Metric
                  label="Ack"
                  value={hm10LinkGuard.lastAckTs ? 'Seen' : 'Missing'}
                  compact
                />
              </View>
              <AppText variant="muted" style={styles.rawPayloadText}>
                {hm10LinkGuard.message ||
                  'Run the HM-10 link guard to prove the app can write to the Arduino and the Arduino can stream the ack back.'}
              </AppText>
              <AppText variant="muted" style={styles.rawPayloadText}>
                {hm10LinkProbeFreshness} {hm10LinkVerifiedFreshness}
              </AppText>
              <AppButton
                title="Verify HM-10 link"
                variant="ghost"
                onPress={handleVerifyHm10Link}
                loading={isCheckingHm10Link}
                disabled={!connectedDevice}
                style={styles.fullWidthButton}
              />
              <AppText variant="muted" style={styles.transportHint}>
                {transportDebug.totalNotifications === 0
                  ? 'Zero packets here usually means the module is connected on the wrong BLE UART service or the HM-10 UART/profile still needs repair. Start with FFE0/FFE1, then try FFF0/FFF1 for clones. The link guard will also fail until the module can answer back.'
                  : 'Watch for `sensor.hm10_link_probe` first. If hex changes here but parsed data stays blank, start with 9600, then try 4800, 19200, and 38400. The app also exposes 1200, 2400, 57600, and 115200 for recovery or faster boards.'}
              </AppText>
            </>
          ) : null}
        </View>
        {latestMetricSamples.length > 0 ? (
          <View style={styles.metricSnapshot}>
            <AppText variant="label">Latest metrics</AppText>
            <View style={styles.metricSnapshotList}>
              {latestMetricSamples.map((sample) => (
                <View key={`${sample.metric}-${sample.ts}`} style={styles.metricSnapshotRow}>
                  <AppText variant="body" weight="semibold" style={styles.metricSnapshotMetric}>
                    {sample.metric}
                  </AppText>
                  <AppText variant="muted" style={styles.metricSnapshotValue}>
                    {formatNumber(sample.value)}
                  </AppText>
                </View>
              ))}
            </View>
          </View>
        ) : null}
        {liveTrend.length === 0 ? (
          <View style={styles.emptyChart}>
            <AppText style={styles.emptyChartIcon}>o</AppText>
            <AppText variant="muted">Waiting for samples for {focusMetric}</AppText>
          </View>
        ) : (
          <TrendChart data={liveTrend} yLabel="Live value" />
        )}
      </Card>
    </>
  );
}

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
    minWidth: 0,
    gap: 4,
  },
  compactValue: {
    fontSize: 15,
    lineHeight: 20,
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

const deviceRowStyles = StyleSheet.create({
  row: {
    padding: spacing.sm,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.glass,
    gap: spacing.sm,
  },
  info: {
    minWidth: 0,
    gap: 4,
  },
  name: {
    minWidth: 0,
  },
  sigRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    flexWrap: 'wrap',
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
    width: '100%',
  },
});

const styles = StyleSheet.create({
  statusStack: {
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  statusPills: {
    flexDirection: 'row',
    gap: spacing.xs,
    flexWrap: 'wrap',
  },
  profileSummary: {
    lineHeight: 20,
  },
  connectedPanel: {
    marginBottom: spacing.sm,
    padding: spacing.md,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.glass,
    gap: 4,
  },
  fullWidthButton: {
    width: '100%',
  },
  secondaryActionButton: {
    width: '100%',
    marginTop: spacing.xs,
  },
  scanningLabel: {
    marginTop: spacing.xs,
    fontSize: 13,
  },
  deviceList: {
    marginTop: spacing.sm,
    maxHeight: 360,
  },
  deviceListContent: {
    gap: spacing.sm,
    paddingBottom: spacing.xs,
  },
  emptyState: {
    marginTop: spacing.sm,
    padding: spacing.md,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.glass,
    gap: spacing.xs,
  },
  helper: {
    marginTop: spacing.xs,
    lineHeight: 19,
  },
  error: {
    marginTop: spacing.sm,
    color: colors.danger,
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
  profileTip: {
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
    lineHeight: 20,
  },
  hm10ControlCard: {
    marginTop: spacing.sm,
    padding: spacing.sm,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.glass,
    gap: spacing.sm,
  },
  hm10BaudRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  hm10BaudButton: {
    flexGrow: 1,
    minWidth: 92,
  },
  hm10ControlHint: {
    lineHeight: 20,
  },
  hm10ControlNotice: {
    lineHeight: 19,
  },
  hm10ControlNoticeError: {
    color: colors.danger,
  },
  configSummary: {
    padding: spacing.sm,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.glass,
    gap: spacing.xs,
  },
  configSummaryText: {
    lineHeight: 20,
  },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.sm,
    gap: spacing.sm,
  },
  metricsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.sm,
    flexWrap: 'wrap',
    marginTop: spacing.sm,
  },
  liveBanner: {
    marginTop: spacing.sm,
    padding: spacing.sm,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  liveBannerActive: {
    borderColor: colors.accent + '66',
    backgroundColor: colors.accent + '14',
  },
  liveBannerInactive: {
    borderColor: colors.border,
    backgroundColor: colors.glass,
  },
  liveBannerDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginTop: 6,
  },
  liveBannerDotActive: {
    backgroundColor: colors.accent,
  },
  liveBannerDotInactive: {
    backgroundColor: colors.muted,
  },
  liveBannerContent: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  liveBannerText: {
    lineHeight: 19,
  },
  rawPayload: {
    marginTop: spacing.sm,
    padding: spacing.sm,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.glass,
    gap: spacing.xs,
  },
  rawPayloadText: {
    fontSize: 13,
    lineHeight: 18,
  },
  transportHint: {
    marginTop: spacing.xs,
    fontSize: 12,
    lineHeight: 18,
  },
  metricSnapshot: {
    marginTop: spacing.sm,
    padding: spacing.sm,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.glass,
    gap: spacing.xs,
  },
  metricSnapshotList: {
    gap: spacing.xs,
  },
  metricSnapshotRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
  },
  metricSnapshotMetric: {
    flex: 1,
    minWidth: 0,
  },
  metricSnapshotValue: {
    fontSize: 13,
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
});
