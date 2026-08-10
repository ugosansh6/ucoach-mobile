import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
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
import { WorkoutProvider } from '../src/contexts/WorkoutContext';

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    BebasNeue_400Regular,
    Oswald_400Regular,
    Oswald_500Medium,
    Oswald_600SemiBold,
    Oswald_700Bold,
  });

  if (!fontsLoaded) {
    return null;
  }

  return (
    <SafeAreaProvider>
      <OnboardingProvider>
        <WorkoutProvider>
          <StatusBar style="light" />

          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: {
                backgroundColor: colors.background,
              },
            }}
          />
        </WorkoutProvider>
      </OnboardingProvider>
    </SafeAreaProvider>
  );
}