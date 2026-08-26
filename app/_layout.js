import { useEffect } from 'react';
import { router, Stack, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { setAudioModeAsync } from 'expo-audio';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import {
  BebasNeue_400Regular,
  useFonts,
} from '@expo-google-fonts/bebas-neue';

import {
  Oswald_400Regular,
  Oswald_500Medium,
  Oswald_600SemiBold,
  Oswald_700Bold,
} from '@expo-google-fonts/oswald';

import { colors } from '../src/constants';
import { OnboardingProvider } from '../src/contexts/OnboardingContext';
import { UgerodThemeProvider } from '../src/contexts/UgerodThemeContext';
import { WorkoutProvider } from '../src/contexts/WorkoutContext';
import SessionAdaptationOverlay from '../src/components/workout/SessionAdaptationOverlay';
import SessionWhyOverlay from '../src/components/workout/SessionWhyOverlay';

const KHAKI = '#646F5E';
const ORANGE = '#FF6B19';

function DashboardBuilderShortcut() {
  const segments = useSegments();
  const firstSegment = segments?.[0] ?? '';
  const secondSegment = segments?.[1] ?? '';

  const isMainDashboard =
    firstSegment === '(tabs)' &&
    (!secondSegment || secondSegment === 'index');
  const isDarkDashboard = firstSegment === 'dashboard-test';
  const isLightDashboard = firstSegment === 'dashboard-test-light';
  const visible = isMainDashboard || isDarkDashboard || isLightDashboard;

  if (!visible) {
    return null;
  }

  const isLight = isLightDashboard;

  return (
    <View pointerEvents="box-none" style={styles.builderShortcutLayer}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Créer ma séance"
        onPress={() => router.push('/workout/builder')}
        style={({ pressed }) => [
          styles.builderShortcut,
          isLight && styles.builderShortcutLight,
          pressed && styles.builderShortcutPressed,
        ]}
      >
        <View
          style={[
            styles.builderShortcutIcon,
            isLight && styles.builderShortcutIconLight,
          ]}
        >
          <Ionicons
            name="construct-outline"
            size={20}
            color="#FFFFFF"
          />
        </View>

        <View style={styles.builderShortcutCopy}>
          <Text style={styles.builderShortcutEyebrow}>
            JE GARDE LA MAIN
          </Text>
          <Text style={styles.builderShortcutTitle}>
            CRÉER MA SÉANCE
          </Text>
        </View>

        <Ionicons
          name="arrow-forward"
          size={20}
          color="#FFFFFF"
        />
      </Pressable>
    </View>
  );
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    BebasNeue_400Regular,
    Oswald_400Regular,
    Oswald_500Medium,
    Oswald_600SemiBold,
    Oswald_700Bold,
  });

  useEffect(() => {
    setAudioModeAsync({
      playsInSilentMode: true,
      interruptionMode: 'mixWithOthers',
    }).catch((error) => {
      console.warn('UGEROD audio mixing mode', error);
    });
  }, []);

  if (!fontsLoaded) {
    return null;
  }

  return (
    <SafeAreaProvider>
      <UgerodThemeProvider>
        <OnboardingProvider>
          <WorkoutProvider>
            {/*
             * Les écrans migrés gèrent leur StatusBar selon le thème.
             * La valeur racine reste sombre tant que la passe UX globale
             * n'a pas migré les anciens écrans vers le thème partagé.
             */}
            <StatusBar style="light" />

            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: {
                  backgroundColor: colors.background,
                },
              }}
            />

            <DashboardBuilderShortcut />
            <SessionWhyOverlay />
            <SessionAdaptationOverlay />
          </WorkoutProvider>
        </OnboardingProvider>
      </UgerodThemeProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  builderShortcutLayer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
    paddingHorizontal: 16,
    paddingBottom: 86,
  },
  builderShortcut: {
    minHeight: 58,
    borderRadius: 17,
    paddingHorizontal: 14,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    backgroundColor: colors.primary,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
    shadowColor: '#000000',
    shadowOpacity: 0.24,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 9,
  },
  builderShortcutLight: {
    backgroundColor: KHAKI,
    borderColor: ORANGE,
  },
  builderShortcutPressed: {
    opacity: 0.84,
    transform: [{ scale: 0.99 }],
  },
  builderShortcutIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  builderShortcutIconLight: {
    backgroundColor: ORANGE,
  },
  builderShortcutCopy: {
    flex: 1,
  },
  builderShortcutEyebrow: {
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 9,
    lineHeight: 12,
    letterSpacing: 0.85,
    color: 'rgba(255,255,255,0.76)',
  },
  builderShortcutTitle: {
    marginTop: 1,
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 20,
    lineHeight: 22,
    letterSpacing: 1,
    color: '#FFFFFF',
  },
});
