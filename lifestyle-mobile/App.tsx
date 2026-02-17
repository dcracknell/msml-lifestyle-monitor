import 'react-native-gesture-handler';
import { useMemo } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer, DefaultTheme, DarkTheme } from '@react-navigation/native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useFonts, Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from '@expo-google-fonts/inter';
import { SpaceGrotesk_500Medium } from '@expo-google-fonts/space-grotesk';
import { AppProviders } from './src/providers/AppProviders';
import { colors } from './src/theme';
import { AppNavigator } from './src/navigation/AppNavigator';
import { WEB_APP_ORIGIN } from './src/config/env';

const navigationTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: colors.background,
    card: colors.panel,
    primary: colors.accent,
    text: colors.text,
    border: colors.border,
  },
};

export default function App() {
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    SpaceGrotesk_500Medium,
  });

  const linking = useMemo(
    () => ({
      prefixes: ['msml://', WEB_APP_ORIGIN],
      config: {
        screens: {
          ForgotPassword: 'forgot',
        },
      },
    }),
    [WEB_APP_ORIGIN]
  );

  if (!fontsLoaded) {
    return (
      <GestureHandlerRootView style={{ flex: 1 }}>
        <View style={styles.loaderContainer}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      </GestureHandlerRootView>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AppProviders>
        <NavigationContainer linking={linking} theme={navigationTheme}>
          <StatusBar style="light" />
          <AppNavigator />
        </NavigationContainer>
      </AppProviders>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  loaderContainer: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
