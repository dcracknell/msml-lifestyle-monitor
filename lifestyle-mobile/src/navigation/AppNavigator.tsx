import '../utils/reanimatedCompat';
import { View, StyleSheet, TouchableOpacity, Image } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import {
  createDrawerNavigator,
  DrawerContentComponentProps,
  DrawerContentScrollView,
  DrawerItem,
} from '@react-navigation/drawer';
import { useMemo } from 'react';
import { AuthScreen, AuthStackParamList } from '../features/auth/AuthScreen';
import { ForgotPasswordScreen } from '../features/auth/ForgotPasswordScreen';
import { AppText, LoadingView } from '../components';
import { useAuth } from '../providers/AuthProvider';
import { colors, fonts } from '../theme';
import { useApiConfig } from '../providers/ApiConfigProvider';
import { OverviewScreen } from '../features/overview/OverviewScreen';
import { ActivityScreen } from '../features/activity/ActivityScreen';
import { SessionsScreen } from '../features/sessions/SessionsScreen';
import { VitalsScreen } from '../features/vitals/VitalsScreen';
import { NutritionScreen } from '../features/nutrition/NutritionScreen';
import { WeightScreen } from '../features/weight/WeightScreen';
import { SleepScreen } from '../features/sleep/SleepScreen';
import { RosterScreen } from '../features/roster/RosterScreen';
import { ShareScreen } from '../features/share/ShareScreen';
import { ProfileScreen } from '../features/profile/ProfileScreen';
import { AdminScreen } from '../features/admin/AdminScreen';
import { BluetoothScreen } from '../features/devices/BluetoothScreen';
import { ExerciseScreen } from '../features/exercise/ExerciseScreen';

const AuthStack = createNativeStackNavigator<AuthStackParamList>();

type DrawerParamList = {
  Overview: undefined;
  Activity: undefined;
  Exercise: undefined;
  Sessions: undefined;
  Vitals: undefined;
  Sleep: undefined;
  Devices: undefined;
  Nutrition: undefined;
  Weight: undefined;
  Roster: undefined;
  Share: undefined;
  Profile: undefined;
  Admin: undefined;
};

const Drawer = createDrawerNavigator<DrawerParamList>();
type DrawerRouteName = keyof DrawerParamList;
type DrawerGroup = {
  key: string;
  items: Array<{ label: string; route: DrawerRouteName }>;
  includeSignOut?: boolean;
};
const drawerItem = (label: string, route: DrawerRouteName) => ({ label, route });

export function AppNavigator() {
  const { user, isRestoring } = useAuth();
  const { isReady: isApiReady } = useApiConfig();

  if (isRestoring || !isApiReady) {
    return (
      <View style={styles.loadingWrapper}>
        <LoadingView />
      </View>
    );
  }

  if (!user) {
    return <AuthNavigator />;
  }

  return <DrawerNavigator />;
}

function AuthNavigator() {
  return (
    <AuthStack.Navigator
      initialRouteName="AuthLanding"
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <AuthStack.Screen name="AuthLanding" component={AuthScreen} />
      <AuthStack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
    </AuthStack.Navigator>
  );
}

function DrawerNavigator() {
  const { user, signOut } = useAuth();
  const isCoach = user?.role === 'Coach' || user?.role === 'Head Coach';
  const isHeadCoach = user?.role === 'Head Coach';

  return (
    <Drawer.Navigator
      useLegacyImplementation={false}
      initialRouteName="Overview"
      drawerContent={(drawerProps) => <CustomDrawerContent {...drawerProps} />}
      screenOptions={({ navigation }) => ({
        headerShown: true,
        drawerType: 'front',
        swipeEnabled: false,
        drawerStyle: { backgroundColor: colors.background },
        headerStyle: {
          backgroundColor: colors.background,
          borderBottomColor: colors.border,
          borderBottomWidth: StyleSheet.hairlineWidth,
        },
        headerTintColor: colors.text,
        headerTitleStyle: {
          fontFamily: fonts.display,
          fontSize: 20,
        },
        headerLeft: () => (
          <TouchableOpacity
            style={styles.headerMenuButton}
            onPress={() => navigation.toggleDrawer()}
            accessibilityLabel="Open navigation menu"
            hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
          >
            <AppText variant="label" style={styles.headerActionText}>
              Menu
            </AppText>
          </TouchableOpacity>
        ),
        headerRight: () => (
          <TouchableOpacity style={styles.headerAction} onPress={signOut}>
            <AppText variant="label" style={styles.headerActionText}>
              Sign out
            </AppText>
          </TouchableOpacity>
        ),
      })}
    >
      <Drawer.Screen name="Overview" component={OverviewScreen} />
      <Drawer.Screen name="Exercise" component={ExerciseScreen} />
      <Drawer.Screen name="Activity" component={ActivityScreen} />
      {isCoach ? <Drawer.Screen name="Roster" component={RosterScreen} /> : null}
      <Drawer.Screen name="Sessions" component={SessionsScreen} />
      <Drawer.Screen name="Sleep" component={SleepScreen} />
      <Drawer.Screen name="Vitals" component={VitalsScreen} />
      <Drawer.Screen name="Nutrition" component={NutritionScreen} />
      <Drawer.Screen name="Weight" component={WeightScreen} />
      <Drawer.Screen name="Devices" component={BluetoothScreen} />
      <Drawer.Screen name="Share" component={ShareScreen} />
      <Drawer.Screen name="Profile" component={ProfileScreen} />
      {isHeadCoach ? <Drawer.Screen name="Admin" component={AdminScreen} /> : null}
    </Drawer.Navigator>
  );
}

function CustomDrawerContent({
  state,
  navigation,
}: DrawerContentComponentProps) {
  const { user, signOut } = useAuth();
  const isCoach = user?.role === 'Coach' || user?.role === 'Head Coach';
  const isHeadCoach = user?.role === 'Head Coach';
  const activeRoute = state?.routes?.[state?.index]?.name;
  const navGroups = useMemo<DrawerGroup[]>(
    () =>
      [
        {
          key: 'overview',
          items: [drawerItem('Overview', 'Overview')],
        },
        {
          key: 'training',
          items: [
            drawerItem('Exercise', 'Exercise'),
            drawerItem('Activity', 'Activity'),
            ...(isCoach ? [drawerItem('Roster', 'Roster')] : []),
            drawerItem('Sessions', 'Sessions'),
          ],
        },
        {
          key: 'recovery',
          items: [
            drawerItem('Sleep', 'Sleep'),
            drawerItem('Vitals', 'Vitals'),
          ],
        },
        {
          key: 'fuel',
          items: [
            drawerItem('Nutrition', 'Nutrition'),
            drawerItem('Weight', 'Weight'),
          ],
        },
        {
          key: 'account',
          items: [
            drawerItem('Settings', 'Profile'),
            drawerItem('Share', 'Share'),
            drawerItem('Devices', 'Devices'),
            ...(isHeadCoach ? [drawerItem('Admin', 'Admin')] : []),
          ],
          includeSignOut: true,
        },
      ],
    [isCoach, isHeadCoach]
  );
  const initials =
    user?.name
      ?.split(' ')
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join('') || 'A';
  const avatarUri = user?.avatar_photo
    ? `data:image/jpeg;base64,${user.avatar_photo}`
    : user?.avatar_url || null;

  return (
    <DrawerContentScrollView contentContainerStyle={styles.drawerContent}>
      <View style={styles.profileBlock}>
        <View style={styles.profileAvatar}>
          {avatarUri ? (
            <Image source={{ uri: avatarUri }} style={styles.profileAvatarImage} />
          ) : (
            <AppText variant="heading" style={styles.profileInitials}>
              {initials}
            </AppText>
          )}
        </View>
        <View>
          <AppText variant="label">Signed in as</AppText>
          <AppText variant="heading">{user?.name || 'Athlete'}</AppText>
          <AppText variant="muted">{user?.role}</AppText>
        </View>
      </View>
      {navGroups.map((group, index) => {
        if (!group.items.length && !group.includeSignOut) {
          return null;
        }
        return (
          <View
            key={group.key}
            style={[styles.drawerGroup, index > 0 ? styles.drawerGroupDivider : undefined]}
          >
            {group.items.map((item) => (
              <DrawerItem
                key={item.route}
                label={item.label}
                onPress={() => {
                  navigation?.closeDrawer();
                  navigation?.navigate(item.route);
                }}
                labelStyle={styles.drawerLabel}
                focused={activeRoute === item.route}
                activeBackgroundColor="rgba(77,245,255,0.12)"
                inactiveTintColor={colors.muted}
              />
            ))}
            {group.includeSignOut ? (
              <DrawerItem label="Sign out" onPress={signOut} labelStyle={styles.drawerLabel} />
            ) : null}
          </View>
        );
      })}
    </DrawerContentScrollView>
  );
}

const styles = StyleSheet.create({
  loadingWrapper: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'center',
  },
  drawerContent: {
    paddingTop: 12,
  },
  profileBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    gap: 12,
  },
  profileAvatar: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  profileAvatarImage: {
    width: '100%',
    height: '100%',
  },
  profileInitials: {
    color: colors.text,
  },
  drawerLabel: {
    color: colors.text,
  },
  drawerGroup: {
    gap: 4,
    paddingBottom: 8,
  },
  drawerGroupDivider: {
    marginTop: 16,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 12,
  },
  headerMenuButton: {
    marginLeft: 12,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  headerAction: {
    marginRight: 12,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  headerActionText: {
    color: colors.text,
  },
});
