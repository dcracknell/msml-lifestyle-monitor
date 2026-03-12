import { ScrollView, StyleSheet } from 'react-native';
import { ProfileSection } from '../profile/ProfileScreen';
import { ShareSection } from '../share/ShareScreen';
import { BluetoothSection } from '../devices/BluetoothScreen';
import { AdminSection } from '../admin/AdminScreen';
import { colors } from '../../theme';

export function SettingsScreen() {
  return (
    <ScrollView
      style={styles.scroll}
      showsVerticalScrollIndicator={false}
    >
      <ProfileSection />
      <ShareSection />
      <BluetoothSection />
      <AdminSection />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: colors.background,
  },
});
