import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { setAudioModeAsync } from 'expo-audio';
import { SafeAreaProvider } from 'react-native-safe-area-context';

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

            <SessionWhyOverlay />
            <SessionAdaptationOverlay />
          </WorkoutProvider>
        </OnboardingProvider>
      </UgerodThemeProvider>
    </SafeAreaProvider>
  );
}
