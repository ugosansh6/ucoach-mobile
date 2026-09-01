import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { spacing, typography } from '../../src/constants';
import { useUgerodTheme } from '../../src/contexts/UgerodThemeContext';
import { useWorkout } from '../../src/contexts/WorkoutContext';
import {
  discardUnstartedWorkoutSession,
  generateWorkoutSession,
} from '../../src/services/workoutGenerationService';

function environmentLabel(code) {
  if (code === 'GYM') return 'SALLE';
  if (code === 'OUTDOOR') return 'EXTÉRIEUR';
  return 'SÉANCE';
}

export default function EnvironmentGeneratingScreen() {
  const { colors, isDark } = useUgerodTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const {
    preparation,
    workout,
    setGeneratedWorkout,
    setGeneratedWorkoutPreservingProgress,
  } = useWorkout();

  const environmentCode = String(preparation?.environmentCode ?? '')
    .trim()
    .toUpperCase();
  const label = environmentLabel(environmentCode);
  const missingOutdoorContext =
    environmentCode === 'OUTDOOR' &&
    (!preparation?.outdoorPlaceCode || !preparation?.surfaceCode);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [control, setControl] = useState(null);
  const launchedRef = useRef(false);
  const busyRef = useRef(false);

  const applyGenerationResult = useCallback(
    (nextWorkout) => {
      if (nextWorkout?.controlStatus) {
        setControl(nextWorkout);
        return false;
      }

      const sameSession =
        Boolean(workout.sessionId) &&
        workout.sessionId === nextWorkout?.sessionId;

      if (
        sameSession &&
        nextWorkout?.generationControlStatus === 'resume_existing'
      ) {
        setGeneratedWorkoutPreservingProgress(nextWorkout);
      } else {
        setGeneratedWorkout(nextWorkout);
      }

      router.replace('/workout/session');
      return true;
    },
    [
      setGeneratedWorkout,
      setGeneratedWorkoutPreservingProgress,
      workout.sessionId,
    ]
  );

  const generate = useCallback(async () => {
    if (busyRef.current) return;

    if (missingOutdoorContext) {
      setError(
        'Le contexte extérieur est incomplet. Reviens au check-in pour préciser le lieu et le terrain.'
      );
      return;
    }

    busyRef.current = true;
    setBusy(true);
    setError('');
    setControl(null);

    try {
      const nextWorkout = await generateWorkoutSession(preparation);
      applyGenerationResult(nextWorkout);
    } catch (generationError) {
      setError(
        generationError?.message ??
          `Impossible de générer la séance ${label.toLowerCase()}.`
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [applyGenerationResult, label, missingOutdoorContext, preparation]);

  useEffect(() => {
    if (launchedRef.current) return;
    launchedRef.current = true;
    generate();
  }, [generate]);

  async function replaceExisting() {
    if (
      busyRef.current ||
      control?.environmentControlStatus !== 'EXISTING_GENERATED_SESSION_CONFLICT' ||
      control?.existingSessionStarted ||
      !control?.sessionId
    ) {
      return;
    }

    busyRef.current = true;
    setBusy(true);
    setError('');

    try {
      await discardUnstartedWorkoutSession(control.sessionId);
      setControl(null);
      const nextWorkout = await generateWorkoutSession(preparation);
      applyGenerationResult(nextWorkout);
    } catch (replaceError) {
      setControl(null);
      setError(
        replaceError?.message ??
          'Impossible de remplacer la séance précédente.'
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  const canReplaceExisting =
    control?.environmentControlStatus === 'EXISTING_GENERATED_SESSION_CONFLICT' &&
    !control?.existingSessionStarted &&
    Boolean(control?.sessionId);

  const renderMainContent = () => {
    if (control) {
      return (
        <>
          <View style={styles.iconShell}>
            <Ionicons name="git-compare-outline" size={30} color={colors.accent} />
          </View>
          <Text style={styles.eyebrow}>SÉANCE EXISTANTE</Text>
          <Text style={styles.title}>UNE SÉANCE EST DÉJÀ ACTIVE.</Text>
          <Text style={styles.body}>
            {canReplaceExisting
              ? 'Elle n’a pas encore démarré. Tu peux la reprendre, revenir au check-in ou la remplacer explicitement.'
              : 'Elle a déjà démarré. UGEROD la protège : reprends-la ou reviens au check-in.'}
          </Text>

          <Pressable
            onPress={() => router.replace('/workout/session')}
            style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
          >
            <Text style={styles.primaryButtonText}>REPRENDRE LA SÉANCE</Text>
            <Ionicons name="arrow-forward" size={19} color={colors.textOnAccent} />
          </Pressable>

          {canReplaceExisting ? (
            <Pressable
              disabled={busy}
              onPress={replaceExisting}
              style={({ pressed }) => [
                styles.dangerButton,
                busy && styles.disabled,
                pressed && styles.pressed,
              ]}
            >
              <Ionicons name="refresh-outline" size={18} color={colors.secondaryAccent} />
              <Text style={styles.dangerButtonText}>GÉNÉRER UNE NOUVELLE SÉANCE</Text>
            </Pressable>
          ) : null}

          <Pressable
            onPress={() => router.replace('/workout/preparation')}
            style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
          >
            <Text style={styles.secondaryButtonText}>RETOUR AU CHECK-IN</Text>
          </Pressable>
        </>
      );
    }

    if (error) {
      return (
        <>
          <View style={[styles.iconShell, styles.errorIconShell]}>
            <Ionicons name="alert-circle-outline" size={30} color={colors.secondaryAccent} />
          </View>
          <Text style={styles.eyebrow}>GÉNÉRATION {label}</Text>
          <Text style={styles.title}>IMPOSSIBLE DE CONTINUER.</Text>
          <Text style={styles.body}>{error}</Text>

          {!missingOutdoorContext ? (
            <Pressable
              onPress={generate}
              disabled={busy}
              style={({ pressed }) => [
                styles.primaryButton,
                busy && styles.disabled,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.primaryButtonText}>RÉESSAYER</Text>
              <Ionicons name="refresh-outline" size={19} color={colors.textOnAccent} />
            </Pressable>
          ) : null}

          <Pressable
            onPress={() => router.replace('/workout/preparation')}
            style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
          >
            <Text style={styles.secondaryButtonText}>RETOUR AU CHECK-IN</Text>
          </Pressable>
        </>
      );
    }

    return (
      <>
        <View style={styles.loaderShell}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
        <Text style={styles.eyebrow}>UGEROD PRÉPARE TA SÉANCE</Text>
        <Text style={styles.title}>TA SÉANCE PREND FORME.</Text>
        <Text style={styles.body}>
          Le Coach vérifie ton contexte, tes garde-fous, ton matériel et la logique de ton programme.
        </Text>
        <View style={styles.progressHint}>
          <View style={styles.progressDot} />
          <Text style={styles.progressText}>GÉNÉRATION {label}</Text>
        </View>
      </>
    );
  };

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <View style={styles.center}>{renderMainContent()}</View>
    </SafeAreaView>
  );
}

function createStyles(colors) {
  return StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: colors.background,
    },
    center: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: spacing.xl,
      paddingBottom: 28,
    },
    iconShell: {
      width: 64,
      height: 64,
      borderRadius: 22,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.accentSoft,
      borderWidth: 1,
      borderColor: colors.border,
    },
    errorIconShell: {
      backgroundColor: colors.secondaryAccentSoft,
    },
    loaderShell: {
      width: 76,
      height: 76,
      borderRadius: 26,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    eyebrow: {
      marginTop: 20,
      fontFamily: 'Oswald_600SemiBold',
      fontSize: 10,
      letterSpacing: 1.15,
      color: colors.accent,
      textAlign: 'center',
    },
    title: {
      ...typography.display,
      marginTop: 7,
      maxWidth: 390,
      fontSize: 34,
      lineHeight: 37,
      letterSpacing: 1.35,
      color: colors.text,
      textAlign: 'center',
    },
    body: {
      marginTop: 11,
      maxWidth: 430,
      fontFamily: 'Oswald_400Regular',
      fontSize: 12,
      lineHeight: 18,
      color: colors.textSecondary,
      textAlign: 'center',
    },
    progressHint: {
      marginTop: 22,
      minHeight: 36,
      paddingHorizontal: 13,
      borderRadius: 18,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    progressDot: {
      width: 7,
      height: 7,
      borderRadius: 4,
      backgroundColor: colors.accent,
    },
    progressText: {
      fontFamily: 'Oswald_600SemiBold',
      fontSize: 9,
      letterSpacing: 0.7,
      color: colors.textSecondary,
    },
    primaryButton: {
      marginTop: 24,
      minHeight: 52,
      minWidth: 250,
      paddingHorizontal: 20,
      borderRadius: 14,
      backgroundColor: colors.accent,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
    },
    primaryButtonText: {
      fontFamily: 'Oswald_700Bold',
      fontSize: 10,
      letterSpacing: 0.75,
      color: colors.textOnAccent,
    },
    dangerButton: {
      marginTop: 10,
      minHeight: 48,
      minWidth: 250,
      paddingHorizontal: 18,
      borderRadius: 13,
      borderWidth: 1,
      borderColor: colors.secondaryAccent,
      backgroundColor: colors.secondaryAccentSoft,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
    },
    dangerButtonText: {
      fontFamily: 'Oswald_700Bold',
      fontSize: 9,
      letterSpacing: 0.6,
      color: colors.secondaryAccent,
    },
    secondaryButton: {
      marginTop: 9,
      minHeight: 44,
      paddingHorizontal: 18,
      alignItems: 'center',
      justifyContent: 'center',
    },
    secondaryButtonText: {
      fontFamily: 'Oswald_600SemiBold',
      fontSize: 10,
      letterSpacing: 0.6,
      color: colors.textMuted,
    },
    disabled: { opacity: 0.45 },
    pressed: { opacity: 0.7 },
  });
}
