import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import {
  Image,
  Pressable,
  SafeAreaView,
  ScrollView,
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

const darkBrandIcon = require('../../assets/branding/ugerod-icon.png');
const lightBrandIcon = require('../../assets/branding/LOGO VERSION NOIR.png');
const STEPS = [
  'Analyse de tes paramètres',
  'Temps disponible',
  'Matériel',
  'Forme du jour',
  'Construction des blocs',
];

function environmentLabel(code) {
  if (code === 'HOME') return 'MAISON';
  if (code === 'BOX') return 'BOX';
  if (code === 'GYM') return 'SALLE';
  if (code === 'OUTDOOR') return 'EXTÉRIEUR';
  return 'SÉANCE';
}

export default function GeneratingThemedScreen() {
  const { colors, isDark } = useUgerodTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const brandIcon = isDark ? darkBrandIcon : lightBrandIcon;
  const {
    preparation,
    workout,
    setGeneratedWorkout,
    setGeneratedWorkoutPreservingProgress,
  } = useWorkout();

  const environmentCode = String(preparation?.environmentCode ?? 'HOME').trim().toUpperCase();
  const label = environmentLabel(environmentCode);
  const missingOutdoorContext =
    environmentCode === 'OUTDOOR' &&
    (!preparation?.outdoorPlaceCode || !preparation?.surfaceCode);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [control, setControl] = useState(null);
  const [activeStep, setActiveStep] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const launchedRef = useRef(false);
  const busyRef = useRef(false);

  const protectedSessionExerciseIds = useMemo(
    () =>
      (workout.exercises ?? [])
        .filter((exercise) => exercise.sessionExerciseId && exercise.status !== 'pending')
        .map((exercise) => exercise.sessionExerciseId),
    [workout.exercises]
  );

  const applyGenerationResult = useCallback(
    (nextWorkout) => {
      if (nextWorkout?.controlStatus) {
        setControl(nextWorkout);
        return;
      }

      const sameSession = Boolean(workout.sessionId) && workout.sessionId === nextWorkout?.sessionId;
      const preserveProgress =
        sameSession &&
        ['resume_existing', 'safety_adapted_existing', 'safety_adapt_partial_recalc_required'].includes(
          nextWorkout?.generationControlStatus
        );

      if (preserveProgress) setGeneratedWorkoutPreservingProgress(nextWorkout);
      else setGeneratedWorkout(nextWorkout);

      if (nextWorkout?.generationControlStatus === 'safety_adapt_partial_recalc_required') {
        setControl({
          controlStatus: 'SAFETY_ADAPT_PARTIAL_RECALC_REQUIRED',
          sessionId: nextWorkout.sessionId,
          safetyAdaptation: nextWorkout.safetyAdaptation,
        });
        return;
      }

      router.replace('/workout/session');
    },
    [setGeneratedWorkout, setGeneratedWorkoutPreservingProgress, workout.sessionId]
  );

  const generate = useCallback(
    async ({ forceRecalculateStarted = false } = {}) => {
      if (busyRef.current) return;
      if (missingOutdoorContext) {
        setError('Le contexte extérieur est incomplet. Reviens au check-in pour préciser le lieu et le terrain.');
        return;
      }

      busyRef.current = true;
      setBusy(true);
      setError('');
      setControl(null);
      setActiveStep(0);
      setElapsedSeconds(0);

      try {
        const nextWorkout = await generateWorkoutSession(preparation, {
          forceRecalculateStarted,
          protectedSessionExerciseIds,
        });
        applyGenerationResult(nextWorkout);
      } catch (generationError) {
        setError(generationError?.message ?? `Impossible de générer la séance ${label.toLowerCase()}.`);
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    }, [applyGenerationResult, label, missingOutdoorContext, preparation, protectedSessionExerciseIds]
  );

  useEffect(() => {
    if (launchedRef.current) return;
    launchedRef.current = true;
    generate();
  }, [generate]);

  useEffect(() => {
    if (!busy) return undefined;
    const startedAt = Date.now();
    const stepTimer = setInterval(
      () => setActiveStep((current) => Math.min(current + 1, STEPS.length - 1)),
      850
    );
    const timeTimer = setInterval(
      () => setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000)),
      1000
    );
    return () => {
      clearInterval(stepTimer);
      clearInterval(timeTimer);
    };
  }, [busy]);

  const controlStatus = String(control?.controlStatus ?? '').toUpperCase();
  const canReplaceExisting =
    control?.environmentControlStatus === 'EXISTING_GENERATED_SESSION_CONFLICT' &&
    !control?.existingSessionStarted &&
    Boolean(control?.sessionId);
  const canForceRecalculate =
    !control?.environmentControlStatus &&
    ['STARTED_SESSION_CONFIRM_REQUIRED', 'SAFETY_ADAPT_PARTIAL_RECALC_REQUIRED'].includes(controlStatus);

  async function replaceExisting() {
    if (!canReplaceExisting || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    setControl(null);
    try {
      await discardUnstartedWorkoutSession(control.sessionId);
      const nextWorkout = await generateWorkoutSession(preparation, { protectedSessionExerciseIds });
      applyGenerationResult(nextWorkout);
    } catch (replaceError) {
      setError(replaceError?.message ?? 'Impossible de remplacer la séance précédente.');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  const controlCopy = useMemo(() => {
    if (canReplaceExisting) {
      return {
        eyebrow: 'SÉANCE EXISTANTE',
        title: 'UNE SÉANCE EST DÉJÀ PRÊTE.',
        body: 'Elle n’a pas encore démarré. Tu peux la reprendre ou en générer une nouvelle.',
      };
    }
    if (controlStatus === 'RECALC_LIMIT_REACHED') {
      return {
        eyebrow: 'SÉANCE EN COURS',
        title: '3 RECALCULS UTILISÉS.',
        body: 'Les adaptations nécessaires restent disponibles si ton contexte change.',
      };
    }
    if (controlStatus === 'SAFETY_ADAPT_PARTIAL_RECALC_REQUIRED') {
      return {
        eyebrow: 'ADAPTATION DE SÉCURITÉ',
        title: 'ADAPTATION INCOMPLÈTE.',
        body: 'Certains exercices restants n’ont pas de remplacement suffisamment sûr.',
      };
    }
    return {
      eyebrow: 'SÉANCE EN COURS',
      title: 'UNE SÉANCE A DÉJÀ COMMENCÉ.',
      body: canForceRecalculate
        ? 'Tu peux la reprendre. Un recalcul complet effacera la progression enregistrée sur cette séance.'
        : 'UGEROD protège cette séance : reprends-la ou retourne au check-in.',
    };
  }, [canForceRecalculate, canReplaceExisting, controlStatus]);

  if (control || error) {
    const copy = error
      ? { eyebrow: `GÉNÉRATION ${label}`, title: 'IMPOSSIBLE DE CONTINUER.', body: error }
      : controlCopy;
    return (
      <SafeAreaView style={styles.screen}>
        <StatusBar style={isDark ? 'light' : 'dark'} />
        <View style={styles.stateCenter}>
          <View style={[styles.stateIcon, error && styles.stateIconError]}>
            <Ionicons
              name={error ? 'alert-circle-outline' : 'git-compare-outline'}
              size={30}
              color={error ? colors.secondaryAccent : colors.accent}
            />
          </View>
          <Text style={styles.stateEyebrow}>{copy.eyebrow}</Text>
          <Text style={styles.stateTitle}>{copy.title}</Text>
          <Text style={styles.stateBody}>{copy.body}</Text>

          {!error ? (
            <Pressable onPress={() => router.replace('/workout/session')} style={styles.primaryButton}>
              <Text style={styles.primaryButtonText}>REPRENDRE LA SÉANCE</Text>
            </Pressable>
          ) : !missingOutdoorContext ? (
            <Pressable onPress={() => generate()} disabled={busy} style={styles.primaryButton}>
              <Text style={styles.primaryButtonText}>RÉESSAYER</Text>
            </Pressable>
          ) : null}

          {canReplaceExisting ? (
            <Pressable onPress={replaceExisting} disabled={busy} style={styles.dangerButton}>
              <Text style={styles.dangerButtonText}>GÉNÉRER UNE NOUVELLE SÉANCE</Text>
            </Pressable>
          ) : null}
          {canForceRecalculate ? (
            <Pressable
              onPress={() => generate({ forceRecalculateStarted: true })}
              disabled={busy}
              style={styles.dangerButton}
            >
              <Text style={styles.dangerButtonText}>TOUT RECALCULER</Text>
            </Pressable>
          ) : null}
          <Pressable onPress={() => router.replace('/workout/preparation')} style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>RETOUR AU CHECK-IN</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
        <View style={styles.header}>
          <Pressable onPress={() => router.replace('/workout/preparation')} style={styles.backButton}>
            <Ionicons name="arrow-back" size={22} color={colors.text} />
          </Pressable>
          <View style={styles.headerSpacer} />
          <Image source={brandIcon} style={styles.brandIcon} resizeMode="contain" />
        </View>

        <LinearGradient
          colors={[colors.accent, isDark ? colors.text : colors.borderStrong, colors.secondaryAccent]}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={styles.progressLine}
        />

        <View style={styles.titleArea}>
          <Text style={styles.eyebrow}>UGEROD PRÉPARE TA SÉANCE</Text>
          <Text style={styles.title}>
            CRÉATION DE{`\n`}TA SÉANCE<Text style={styles.accentDot}>.</Text>
          </Text>
          <Text style={styles.subtitle}>UGEROD construit la séance adaptée à ton contexte du jour.</Text>
        </View>

        <View style={styles.stepsCard}>
          {STEPS.map((step, index) => {
            const done = index < activeStep;
            const active = index === activeStep;
            return (
              <View key={step} style={[styles.stepRow, index < STEPS.length - 1 && styles.stepBorder]}>
                <View style={[styles.stepIcon, done && styles.stepDone, active && styles.stepActive]}>
                  {done ? (
                    <Ionicons name="checkmark" size={15} color={colors.textOnAccent} />
                  ) : (
                    <View style={[styles.stepDot, active && styles.stepDotActive]} />
                  )}
                </View>
                <Text style={[styles.stepText, active && styles.stepTextActive, done && styles.stepTextDone]}>
                  {step}
                </Text>
              </View>
            );
          })}
        </View>

        <View style={styles.bottomArea}>
          <View style={styles.statusCard}>
            <View style={styles.dots}>
              <View style={[styles.dot, { backgroundColor: colors.accent }]} />
              <View style={[styles.dot, { backgroundColor: isDark ? colors.text : colors.borderStrong }]} />
              <View style={[styles.dot, { backgroundColor: colors.secondaryAccent }]} />
            </View>
            <Text style={styles.statusText}>GÉNÉRATION {label} · {elapsedSeconds} S</Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function createStyles(colors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    scroll: { flex: 1 },
    content: {
      flexGrow: 1,
      paddingHorizontal: spacing.xl,
      paddingTop: spacing.sm,
      paddingBottom: 42,
    },
    header: { minHeight: 64, flexDirection: 'row', alignItems: 'center' },
    backButton: {
      width: 42,
      height: 42,
      borderRadius: 21,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerSpacer: { flex: 1 },
    brandIcon: { width: 46, height: 46 },
    progressLine: { height: 4, borderRadius: 999, marginTop: spacing.sm, marginBottom: spacing.xl },
    titleArea: { marginBottom: spacing.xl },
    eyebrow: {
      fontFamily: 'Manrope_600SemiBold',
      fontSize: 11,
      lineHeight: 16,
      letterSpacing: 0.8,
      color: colors.textSecondary,
    },
    title: {
      ...typography.display,
      fontSize: 44,
      lineHeight: 47,
      letterSpacing: 2.1,
      color: colors.text,
      marginTop: 9,
    },
    accentDot: { color: colors.accent },
    subtitle: {
      marginTop: spacing.md,
      maxWidth: 390,
      fontFamily: 'Manrope_400Regular',
      fontSize: 15,
      lineHeight: 22,
      color: colors.textSecondary,
    },
    stepsCard: {
      borderRadius: 18,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: 'hidden',
    },
    stepRow: {
      minHeight: 62,
      paddingHorizontal: spacing.lg,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
    },
    stepBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
    stepIcon: {
      width: 30,
      height: 30,
      borderRadius: 15,
      borderWidth: 1,
      borderColor: colors.borderStrong,
      backgroundColor: colors.surfaceElevated,
      alignItems: 'center',
      justifyContent: 'center',
    },
    stepDone: { backgroundColor: colors.accent, borderColor: colors.accent },
    stepActive: { backgroundColor: colors.accentSoft, borderColor: colors.accent },
    stepDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.textMuted, opacity: 0.55 },
    stepDotActive: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent, opacity: 1 },
    stepText: {
      flex: 1,
      fontFamily: 'Manrope_500Medium',
      fontSize: 14,
      lineHeight: 20,
      color: colors.textMuted,
    },
    stepTextActive: { fontFamily: 'Manrope_700Bold', color: colors.text },
    stepTextDone: { color: colors.textSecondary },
    bottomArea: { marginTop: 'auto', paddingTop: 26 },
    statusCard: {
      minHeight: 48,
      paddingHorizontal: 16,
      borderRadius: 15,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceElevated,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    dots: { flexDirection: 'row', gap: 5 },
    dot: { width: 7, height: 7, borderRadius: 4 },
    statusText: {
      flex: 1,
      fontFamily: 'Manrope_600SemiBold',
      fontSize: 11,
      lineHeight: 16,
      letterSpacing: 0.45,
      color: colors.textSecondary,
      textAlign: 'right',
    },
    stateCenter: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: spacing.xl,
      paddingBottom: 28,
    },
    stateIcon: {
      width: 64,
      height: 64,
      borderRadius: 22,
      backgroundColor: colors.accentSoft,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    stateIconError: { backgroundColor: colors.secondaryAccentSoft },
    stateEyebrow: {
      marginTop: 20,
      fontFamily: 'Manrope_600SemiBold',
      fontSize: 11,
      letterSpacing: 0.8,
      color: colors.accent,
      textAlign: 'center',
    },
    stateTitle: {
      ...typography.display,
      marginTop: 8,
      maxWidth: 390,
      fontSize: 34,
      lineHeight: 37,
      color: colors.text,
      textAlign: 'center',
    },
    stateBody: {
      marginTop: 12,
      maxWidth: 430,
      fontFamily: 'Manrope_400Regular',
      fontSize: 14,
      lineHeight: 21,
      color: colors.textSecondary,
      textAlign: 'center',
    },
    primaryButton: {
      marginTop: 24,
      minHeight: 52,
      minWidth: 250,
      paddingHorizontal: 20,
      borderRadius: 14,
      backgroundColor: colors.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
    primaryButtonText: { fontFamily: 'Manrope_700Bold', fontSize: 13, color: colors.textOnAccent },
    dangerButton: {
      marginTop: 10,
      minHeight: 48,
      minWidth: 250,
      paddingHorizontal: 18,
      borderRadius: 13,
      borderWidth: 1,
      borderColor: colors.secondaryAccent,
      backgroundColor: colors.secondaryAccentSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    dangerButtonText: { fontFamily: 'Manrope_700Bold', fontSize: 12, color: colors.secondaryAccent },
    secondaryButton: { marginTop: 9, minHeight: 44, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center' },
    secondaryButtonText: { fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: colors.textSecondary },
  });
}
