import { useRef, useState } from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import {
  AccountCard,
  AccountCardHandle,
  AppleHealthCard,
  PhoneSyncCard,
  ConnectionCard,
} from '../profile/ProfileScreen';
import { ShareSection } from '../share/ShareScreen';
import { BluetoothDevicesSection, BluetoothDeveloperSection } from '../devices/BluetoothScreen';
import { AdminSection } from '../admin/AdminScreen';
import { AppButton, AppText } from '../../components';
import { colors, spacing } from '../../theme';

function SectionLabel({ label, developer }: { label: string; developer?: boolean }) {
  return (
    <AppText style={[styles.sectionLabel, developer ? styles.sectionLabelDev : undefined]}>
      {label}
    </AppText>
  );
}

export function SettingsScreen() {
  const [profileDirty, setProfileDirty] = useState(false);
  const [saveLoading, setSaveLoading] = useState(false);
  const accountRef = useRef<AccountCardHandle>(null);

  const handleSave = async () => {
    if (!accountRef.current) return;
    setSaveLoading(true);
    try {
      await accountRef.current.submit();
    } finally {
      setSaveLoading(false);
    }
  };

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          profileDirty ? styles.contentWithBar : undefined,
        ]}
        showsVerticalScrollIndicator={false}
      >
        <SectionLabel label="ACCOUNT" />
        <AccountCard ref={accountRef} onDirtyChange={setProfileDirty} />

        <SectionLabel label="SHARING" />
        <ShareSection />

        <SectionLabel label="DATA SYNC" />
        <AppleHealthCard />
        <PhoneSyncCard />

        <SectionLabel label="DEVICES" />
        <BluetoothDevicesSection />

        <SectionLabel label="DEVELOPER" developer />
        <BluetoothDeveloperSection />

        <SectionLabel label="CONNECTION" />
        <ConnectionCard />

        <AdminSection />
      </ScrollView>

      {profileDirty ? (
        <View style={styles.stickyBar}>
          <AppButton
            title={saveLoading ? 'Saving…' : 'Save changes'}
            onPress={handleSave}
            loading={saveLoading}
            style={styles.stickyButton}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.lg,
    gap: 12,
    paddingBottom: spacing.lg * 2,
  },
  contentWithBar: {
    paddingBottom: 100,
  },
  sectionLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.8,
    color: colors.muted,
    textTransform: 'uppercase',
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  sectionLabelDev: {
    color: colors.warning,
  },
  stickyBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.background,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    padding: spacing.lg,
    paddingBottom: spacing.xl,
  },
  stickyButton: {
    width: '100%',
  },
});
