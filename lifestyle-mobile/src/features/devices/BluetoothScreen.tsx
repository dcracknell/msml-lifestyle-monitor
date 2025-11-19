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

export function BluetoothScreen() {
  const { user } = useAuth();
  const { subjectId } = useSubject();
  const requestSubject = subjectId && subjectId !== user?.id ? subjectId : undefined;

  const {
    config,
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
          <AppText variant="body">1. Open your phone's Bluetooth settings and pair your sensor as usual.</AppText>
          <AppText variant="body">2. Keep the device awake, return here, and tap confirm to start streaming.</AppText>
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
