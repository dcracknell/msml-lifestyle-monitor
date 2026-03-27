import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { AppButton, AppText, Card, SectionHeader, TrendChart } from '../../components';
import { useBluetooth, BluetoothDeviceSummary } from '../../providers/BluetoothProvider';
import { colors, spacing } from '../../theme';
import { formatDate, formatNumber } from '../../utils/format';

const LIVE_SAMPLE_WINDOW_MS = 10_000;

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
  if (r > -60) return { label: 'Strong', bars: '████', color: colors.accent };
  if (r > -75) return { label: 'Good', bars: '███░', color: '#4ade80' };
  if (r > -85) return { label: 'Weak', bars: '██░░', color: colors.warning };
  return { label: 'Poor', bars: '█░░░', color: colors.danger };
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
    lastUploadStatus,
    error,
    startScan,
    stopScan,
    connectToDevice,
    disconnectFromDevice,
  } = useBluetooth();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setNow(Date.now());

    if (!connectedDevice && !lastSample) {
      return undefined;
    }

    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1_000);

    return () => clearInterval(timer);
  }, [connectedDevice, lastSample?.ts]);

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

  const scanStatusLabel = status === 'connected' ? 'Connected' : isScanning ? 'Scanning' : 'Ready';
  const lastSampleAgeMs = lastSample ? Math.max(0, now - lastSample.ts) : null;
  const isReceivingLiveData =
    lastSampleAgeMs !== null && lastSampleAgeMs <= LIVE_SAMPLE_WINDOW_MS;
  const streamStatusLabel = isReceivingLiveData
    ? 'Data live'
    : lastSample
      ? 'Data waiting'
      : 'No data';
  const liveStatusTitle = isReceivingLiveData
    ? 'Live data is coming in'
    : connectedDevice
      ? 'Connected, waiting for data'
      : 'No live data yet';
  const liveStatusMessage = connectedDevice
    ? isReceivingLiveData
      ? 'Packets are arriving from your sensor now.'
      : 'The device is connected, but no new packets have arrived recently.'
    : 'Connect a device to start receiving live samples.';
  const liveFreshnessLabel = formatSampleFreshness(lastSample?.ts, now);

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
            <StatusPill
              label={scanStatusLabel}
              active={status === 'connected' || isScanning}
            />
            <StatusPill label={streamStatusLabel} active={isReceivingLiveData} />
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
              loading={status === 'connecting'}
              style={styles.fullWidthButton}
            />
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
                      connecting={status === 'connecting'}
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
          </>
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
            lastSample
              ? formatDate(new Date(lastSample.ts).toISOString(), 'MMM D, HH:mm:ss')
              : 'Waiting for payloads'
          }
        />
        <View
          style={[
            styles.liveBanner,
            isReceivingLiveData ? styles.liveBannerActive : styles.liveBannerInactive,
          ]}
        >
          <View
            style={[
              styles.liveBannerDot,
              isReceivingLiveData ? styles.liveBannerDotActive : styles.liveBannerDotInactive,
            ]}
          />
          <View style={styles.liveBannerContent}>
            <AppText variant="body" weight="semibold">
              {liveStatusTitle}
            </AppText>
            <AppText variant="muted" style={styles.liveBannerText}>
              {liveStatusMessage} {liveFreshnessLabel}
            </AppText>
          </View>
        </View>
        <View style={styles.metricsRow}>
          <Metric
            label="Metric"
            value={lastSample?.metric || config.metric}
            compact
            valueNumberOfLines={2}
          />
          <Metric label="Value" value={formatNumber(lastSample?.value)} />
        </View>
        <View style={styles.rawPayload}>
          <AppText variant="label">Raw payload</AppText>
          <AppText variant="muted" style={styles.rawPayloadText}>
            {lastSample?.raw || 'Waiting for device data'}
          </AppText>
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
