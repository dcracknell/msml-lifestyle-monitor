import '../shims/installMissingNativeModules';
import '../utils/reanimatedCompat';
import { View, StyleSheet, TouchableOpacity, Image, Text } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import {
  createDrawerNavigator,
  DrawerContentComponentProps,
  DrawerContentScrollView,
} from '@react-navigation/drawer';
import { useMemo } from 'react';
import { Feather } from '@expo/vector-icons';
import { AuthScreen, AuthStackParamList } from '../features/auth/AuthScreen';
import { ForgotPasswordScreen } from '../features/auth/ForgotPasswordScreen';
import { AppText, LoadingView } from '../components';
import { useAuth } from '../providers/AuthProvider';
import { colors, fonts } from '../theme';
import { useApiConfig } from '../providers/ApiConfigProvider';
import { OverviewScreen } from '../features/overview/OverviewScreen';
import { ActivityScreen } from '../features/activity/ActivityScreen';
import { VitalsScreen } from '../features/vitals/VitalsScreen';
import { NutritionScreen } from '../features/nutrition/NutritionScreen';
import { WeightScreen } from '../features/weight/WeightScreen';
import { SleepScreen } from '../features/sleep/SleepScreen';
import { ExerciseScreen } from '../features/exercise/ExerciseScreen';
import { SettingsScreen } from '../features/settings/SettingsScreen';

const AuthStack = createNativeStackNavigator<AuthStackParamList>();

type DrawerParamList = {
  Overview: undefined;
  Activity: undefined;
  Exercise: undefined;
  Vitals: undefined;
  Sleep: undefined;
  Nutrition: undefined;
  Weight: undefined;
  Settings: undefined;
};

const Drawer = createDrawerNavigator<DrawerParamList>();
type DrawerRouteName = keyof DrawerParamList;
type DrawerGroup = {
  label: string;
  key: string;
  items: Array<{ label: string; route: DrawerRouteName; icon: keyof typeof Feather.glyphMap }>;
  includeSignOut?: boolean;
};
const drawerItem = (
  label: string,
  route: DrawerRouteName,
  icon: keyof typeof Feather.glyphMap
) => ({ label, route, icon });

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
  const { signOut } = useAuth();

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
      <Drawer.Screen name="Sleep" component={SleepScreen} />
      <Drawer.Screen name="Vitals" component={VitalsScreen} />
      <Drawer.Screen name="Nutrition" component={NutritionScreen} />
      <Drawer.Screen name="Weight" component={WeightScreen} />
      <Drawer.Screen name="Settings" component={SettingsScreen} />
    </Drawer.Navigator>
  );
}

function CustomDrawerContent({
  state,
  navigation,
}: DrawerContentComponentProps) {
  const { user, signOut } = useAuth();
  const activeRoute = state?.routes?.[state?.index]?.name;
  const navGroups = useMemo<DrawerGroup[]>(
    () => [
      {
        label: 'OVERVIEW',
        key: 'overview',
        items: [drawerItem('Overview', 'Overview', 'grid')],
      },
      {
        label: 'TRAINING',
        key: 'training',
        items: [
          drawerItem('Exercise', 'Exercise', 'zap'),
          drawerItem('Activity', 'Activity', 'activity'),
        ],
      },
      {
        label: 'HEALTH',
        key: 'recovery',
        items: [
          drawerItem('Sleep', 'Sleep', 'moon'),
          drawerItem('Vitals', 'Vitals', 'heart'),
        ],
      },
      {
        label: 'BODY',
        key: 'fuel',
        items: [
          drawerItem('Nutrition', 'Nutrition', 'coffee'),
          drawerItem('Weight', 'Weight', 'trending-up'),
        ],
      },
      {
        label: 'ACCOUNT',
        key: 'account',
        items: [drawerItem('Settings', 'Settings', 'settings')],
        includeSignOut: true,
      },
    ],
    []
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
      {/* Profile header */}
      <View style={styles.profileBlock}>
        <View style={styles.profileAvatarRing}>
          <View style={styles.profileAvatar}>
            {avatarUri ? (
              <Image source={{ uri: avatarUri }} style={styles.profileAvatarImage} />
            ) : (
              <AppText variant="heading" style={styles.profileInitials}>
                {initials}
              </AppText>
            )}
          </View>
        </View>
        <View style={styles.profileInfo}>
          <AppText variant="heading" style={styles.profileName}>
            {user?.name || 'Athlete'}
          </AppText>
          {user?.role ? (
            <AppText variant="muted" style={styles.profileRole}>
              {user.role}
            </AppText>
          ) : null}
        </View>
      </View>

      {/* Nav groups */}
      {navGroups.map((group, index) => {
        if (!group.items.length && !group.includeSignOut) return null;
        return (
          <View
            key={group.key}
            style={[styles.drawerGroup, index > 0 ? styles.drawerGroupDivider : undefined]}
          >
            <Text style={styles.groupLabel}>{group.label}</Text>
            {group.items.map((item) => {
              const isActive = activeRoute === item.route;
              return (
                <TouchableOpacity
                  key={item.route}
                  style={[styles.navItem, isActive && styles.navItemActive]}
                  onPress={() => {
                    navigation?.closeDrawer();
                    navigation?.navigate(item.route);
                  }}
                  activeOpacity={0.7}
                >
                  {isActive && <View style={styles.activeBorder} />}
                  <Feather
                    name={item.icon}
                    size={20}
                    color={isActive ? colors.accent : 'rgba(255,255,255,0.55)'}
                    style={styles.navIcon}
                  />
                  <Text style={[styles.navLabel, isActive && styles.navLabelActive]}>
                    {item.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
            {group.includeSignOut ? (
              <TouchableOpacity style={styles.navItem} onPress={signOut} activeOpacity={0.7}>
                <Feather
                  name="log-out"
                  size={20}
                  color="#ef4444"
                  style={styles.navIcon}
                />
                <Text style={styles.navLabelSignOut}>Sign out</Text>
              </TouchableOpacity>
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
    paddingTop: 8,
    paddingBottom: 24,
  },

  // Profile header
  profileBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 20,
    gap: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#1a2d45',
    marginBottom: 8,
  },
  profileAvatarRing: {
    padding: 2,
    borderRadius: 28,
    borderWidth: 2,
    borderColor: colors.accent,
  },
  profileAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.panel,
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
  profileInfo: {
    flex: 1,
  },
  profileName: {
    color: colors.text,
    fontSize: 17,
    fontFamily: fonts.display,
  },
  profileRole: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 2,
  },

  // Groups
  drawerGroup: {
    paddingBottom: 4,
  },
  drawerGroupDivider: {
    marginTop: 4,
    borderTopWidth: 1,
    borderTopColor: '#1a2d45',
    paddingTop: 4,
  },
  groupLabel: {
    fontSize: 10,
    letterSpacing: 1.2,
    color: '#8a9bb0',
    fontWeight: '600',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
  },

  // Nav items
  navItem: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 44,
    paddingHorizontal: 16,
    position: 'relative',
  },
  navItemActive: {
    backgroundColor: 'rgba(0,229,204,0.08)',
  },
  activeBorder: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
    backgroundColor: colors.accent,
    borderTopRightRadius: 2,
    borderBottomRightRadius: 2,
  },
  navIcon: {
    marginRight: 14,
  },
  navLabel: {
    fontSize: 15,
    color: 'rgba(255,255,255,0.85)',
    fontFamily: fonts.body,
  },
  navLabelActive: {
    color: colors.accent,
    fontWeight: '600',
  },
  navLabelSignOut: {
    fontSize: 15,
    color: '#ef4444',
    fontFamily: fonts.body,
  },

  // Header
  headerMenuButton: {
    marginLeft: 12,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.04)',
    backgroundColor: 'rgba(255,255,255,0.02)',
  },
  headerAction: {
    marginRight: 12,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.04)',
    backgroundColor: 'rgba(255,255,255,0.02)',
  },
  headerActionText: {
    color: colors.muted,
  },
});
