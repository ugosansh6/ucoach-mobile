import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  Image,
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import {
  colors,
  spacing,
  typography,
} from '../../src/constants';
import {
  useWorkout,
} from '../../src/contexts/WorkoutContext';
import {
  generateWorkoutSession,
} from '../../src/services/workoutService';

const brandIcon = require('../../assets/branding/ugerod-icon.png');

const STEPS = [
  'Analyse de tes paramètres',
  'Temps disponible',
  'Matériel',
  'Forme du jour',
  'Construction des blocs',
];

function getGenerationMessage(elapsedSeconds) {
  if (elapsedSeconds < 8) {
    return 'UGEROD analyse ton contexte et prépare les meilleurs blocs pour aujourd’hui.';
  }

  if (elapsedSeconds < 15) {
    return 'UGEROD équilibre le skill, le WOD, ton matériel et ta progression.';
  }

  if (elapsedSeconds < 22) {
    return 'UGEROD compare plusieurs options pour conserver une séance cohérente et adaptée.';
  }

  return 'Cette séance demande un peu plus de calcul. UGEROD finalise les ajustements utiles.';
}

export default function GeneratingScreen() {
  const [activeStep, setActiveStep] =
    useState(0);
  const [generationError, setGenerationError] =
    useState('');
  const [generationControl, setGenerationControl] =
    useState(null);
  const [forceRecalculating, setForceRecalculating] =
    useState(false);
  const [isGenerating, setIsGenerating] =
    useState(false);
  const [elapsedSeconds, setElapsedSeconds] =
    useState(0);

  const generationDone = useRef(false);
  const generationStartedAt = useRef(null);

  const {
    preparation,
    workout,
    setGeneratedWorkout,
    setGeneratedWorkoutPreservingProgress,
  } = useWorkout();

  useEffect(() => {
    const interval = setInterval(() => {
      setActiveStep((current) =>
        current >= STEPS.length - 1
          ? current
          : current + 1
      );
    }, 850);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!isGenerating) {
      return undefined;
    }

    const updateElapsed = () => {
      if (!generationStartedAt.current) {
        return;
      }

      setElapsedSeconds(
        Math.max(
          0,
          Math.floor(
            (Date.now() - generationStartedAt.current) /
              1000
          )
        )
      );
    };

    updateElapsed();
    const interval = setInterval(updateElapsed, 1000);
    return () => clearInterval(interval);
  }, [isGenerating]);

  const runGeneration = useCallback(
    async ({
      forceRecalculateStarted = false,
    } = {}) => {
      setGenerationError('');
      setGenerationControl(null);
      generationStartedAt.current = Date.now();
      setElapsedSeconds(0);
      setIsGenerating(true);

      try {
        const protectedSessionExerciseIds =
          (workout.exercises ?? [])
            .filter(
              (exercise) =>
                exercise.sessionExerciseId &&
                exercise.status !== 'pending'
            )
            .map(
              (exercise) =>
                exercise.sessionExerciseId
            );

        const generatedWorkout =
          await generateWorkoutSession(
            preparation,
            {
              forceRecalculateStarted,
              protectedSessionExerciseIds,
            }
          );

        if (generatedWorkout?.controlStatus) {
          setGenerationControl(generatedWorkout);
          return;
        }

        const sameSession =
          Boolean(workout.sessionId) &&
          workout.sessionId ===
            generatedWorkout?.sessionId;

        const preserveProgress =
          sameSession &&
          [
            'resume_existing',
            'safety_adapted_existing',
            'safety_adapt_partial_recalc_required',
          ].includes(
            generatedWorkout
              ?.generationControlStatus
          );

        if (preserveProgress) {
          setGeneratedWorkoutPreservingProgress(
            generatedWorkout
          );
        } else {
          setGeneratedWorkout(generatedWorkout);
        }

        if (
          generatedWorkout
            ?.generationControlStatus ===
          'safety_adapt_partial_recalc_required'
        ) {
          setGenerationControl({
            controlStatus:
              'SAFETY_ADAPT_PARTIAL_RECALC_REQUIRED',
            sessionId:
              generatedWorkout.sessionId,
            safetyAdaptation:
              generatedWorkout.safetyAdaptation,
          });
          return;
        }

        router.replace('/workout/session');
      } finally {
        setIsGenerating(false);
      }
    },
    [
      preparation,
      workout.exercises,
      workout.sessionId,
      setGeneratedWorkout,
      setGeneratedWorkoutPreservingProgress,
    ]
  );

  const launchGeneration = useCallback(() => {
    if (generationDone.current) {
      return;
    }

    generationDone.current = true;

    runGeneration().catch((error) => {
      setGenerationError(
        error?.message ??
          'Impossible de générer la séance.'
      );
      generationDone.current = false;
    });
  }, [runGeneration]);

  useEffect(() => {
    launchGeneration();
  }, [launchGeneration]);

  async function handleForceRecalculate() {
    if (forceRecalculating) {
      return;
    }

    setForceRecalculating(true);

    try {
      await runGeneration({
        forceRecalculateStarted: true,
      });
    } catch (error) {
      setGenerationError(
        error?.message ??
          'Impossible de recalculer la séance.'
      );
      setGenerationControl(null);
      generationDone.current = false;
    } finally {
      setForceRecalculating(false);
    }
  }

  function handleResumeCurrentSession() {
    setGenerationControl(null);
    router.replace('/workout/session');
  }

  function handleRetry() {
    setGenerationError('');
    generationDone.current = false;
    launchGeneration();
  }

  function handleBack() {
    router.back();
  }

  const controlStatus =
    generationControl?.controlStatus;

  const controlTitle =
    controlStatus === 'RECALC_LIMIT_REACHED'
      ? '3 RECALCULS UTILISÉS'
      : controlStatus ===
          'SAFETY_ADAPT_PARTIAL_RECALC_REQUIRED'
        ? 'ADAPTATION INCOMPLÈTE'
        : 'RECALCULER LA SÉANCE ?';

  const controlMessage =
    controlStatus === 'RECALC_LIMIT_REACHED'
      ? 'Tu as utilisé les 3 recalculs volontaires disponibles avant le début. Les adaptations nécessaires pour une nouvelle gêne ou un matériel devenu indisponible restent possibles.'
      : controlStatus ===
          'SAFETY_ADAPT_PARTIAL_RECALC_REQUIRED'
        ? 'UGEROD a sécurisé ce qu’il pouvait sans effacer ta progression, mais certains exercices restants n’ont pas de remplacement suffisamment sûr. Tu peux reprendre la séance adaptée ou abandonner et tout recalculer.'
        : 'Ta séance a déjà commencé. En la recalculant, tu perdras toute la progression enregistrée sur cette séance : exercices validés, adaptations, chronos et performances.';

  const canForceRecalculate =
    controlStatus ===
      'STARTED_SESSION_CONFIRM_REQUIRED' ||
    controlStatus ===
      'SAFETY_ADAPT_PARTIAL_RECALC_REQUIRED';

  const generationMessage =
    getGenerationMessage(elapsedSeconds);

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
        <View style={styles.header}>
          <Pressable
            onPress={handleBack}
            hitSlop={12}
            style={({ pressed }) => [
              styles.backButton,
              pressed && styles.pressed,
            ]}
          >
            <Ionicons
              name="arrow-back"
              size={22}
              color={colors.textPrimary}
            />
          </Pressable>

          <View style={styles.headerSpacer} />

          <Image
            source={brandIcon}
            style={styles.brandIcon}
            resizeMode="contain"
          />
        </View>

        <View style={styles.progressWrapper}>
          <LinearGradient
            colors={[
              colors.primary,
              colors.brandWhite,
              colors.brandRed,
            ]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={styles.progressLine}
          />
        </View>

        <View style={styles.titleArea}>
          <Text style={styles.eyebrow}>
            UGEROD PRÉPARE TA SÉANCE
          </Text>

          <Text style={styles.title}>
            CRÉATION DE
            {'\n'}
            TA SÉANCE
            <Text style={styles.blueDot}>.</Text>
          </Text>

          <Text style={styles.subtitle}>
            {generationMessage}
          </Text>
        </View>

        <View style={styles.stepsCard}>
          {STEPS.map((step, index) => {
            const done = index < activeStep;
            const active = index === activeStep;
            const future = index > activeStep;

            return (
              <View
                key={step}
                style={[
                  styles.stepRow,
                  index !== STEPS.length - 1 &&
                    styles.stepRowBorder,
                ]}
              >
                <View
                  style={[
                    styles.stepIcon,
                    done && styles.stepIconDone,
                    active && styles.stepIconActive,
                    future && styles.stepIconFuture,
                  ]}
                >
                  {done ? (
                    <Ionicons
                      name="checkmark"
                      size={15}
                      color={colors.brandWhite}
                    />
                  ) : active ? (
                    <View style={styles.activeDot} />
                  ) : (
                    <View style={styles.futureDot} />
                  )}
                </View>

                <Text
                  style={[
                    styles.stepText,
                    done && styles.stepTextDone,
                    active && styles.stepTextActive,
                    future && styles.stepTextFuture,
                  ]}
                >
                  {step}
                </Text>
              </View>
            );
          })}
        </View>

        <View style={styles.bottomArea}>
          {generationError ? (
            <View style={styles.errorCard}>
              <Ionicons
                name="alert-circle-outline"
                size={21}
                color={colors.brandRed}
              />

              <View style={styles.errorMain}>
                <Text style={styles.errorTitle}>
                  GÉNÉRATION INTERROMPUE
                </Text>
                <Text style={styles.errorText}>
                  {generationError}
                </Text>
              </View>

              <Pressable
                onPress={handleRetry}
                style={({ pressed }) => [
                  styles.retryButton,
                  pressed && styles.pressed,
                ]}
              >
                <Ionicons
                  name="refresh"
                  size={17}
                  color={colors.brandWhite}
                />
                <Text style={styles.retryButtonText}>
                  RÉESSAYER
                </Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.runningStatus}>
              <View style={styles.loaderDots}>
                <View style={styles.loaderDotBlue} />
                <View style={styles.loaderDotWhite} />
                <View style={styles.loaderDotRed} />
              </View>

              <Text style={styles.waitText}>
                GÉNÉRATION EN COURS · {elapsedSeconds} S
              </Text>
            </View>
          )}
        </View>
      </ScrollView>

      <Modal
        visible={Boolean(generationControl)}
        transparent
        animationType="fade"
        onRequestClose={handleResumeCurrentSession}
      >
        <View style={styles.controlModalOverlay}>
          <View style={styles.controlModalCard}>
            <View style={styles.controlModalIcon}>
              <Ionicons
                name={
                  controlStatus ===
                  'RECALC_LIMIT_REACHED'
                    ? 'lock-closed-outline'
                    : 'warning-outline'
                }
                size={26}
                color={colors.brandRed}
              />
            </View>

            <Text style={styles.controlModalTitle}>
              {controlTitle}
            </Text>

            <Text style={styles.controlModalText}>
              {controlMessage}
            </Text>

            <Pressable
              onPress={handleResumeCurrentSession}
              disabled={forceRecalculating}
              style={({ pressed }) => [
                styles.controlPrimaryButton,
                pressed &&
                  !forceRecalculating &&
                  styles.pressed,
              ]}
            >
              <Text style={styles.controlPrimaryButtonText}>
                REPRENDRE MA SÉANCE
              </Text>
            </Pressable>

            {canForceRecalculate ? (
              <Pressable
                onPress={handleForceRecalculate}
                disabled={forceRecalculating}
                style={({ pressed }) => [
                  styles.controlDangerButton,
                  pressed &&
                    !forceRecalculating &&
                    styles.pressed,
                ]}
              >
                <Text style={styles.controlDangerButtonText}>
                  {forceRecalculating
                    ? 'RECALCUL EN COURS...'
                    : 'ABANDONNER ET RECALCULER'}
                </Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },

  scroll: {
    flex: 1,
  },

  content: {
    flexGrow: 1,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    paddingBottom: 44,
  },

  header: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
  },

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

  headerSpacer: {
    flex: 1,
  },

  brandIcon: {
    width: 46,
    height: 46,
  },

  progressWrapper: {
    marginTop: spacing.sm,
    marginBottom: spacing.xl,
  },

  progressLine: {
    height: 4,
    borderRadius: 999,
  },

  titleArea: {
    marginBottom: spacing.xl,
  },

  eyebrow: {
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 11,
    lineHeight: 15,
    letterSpacing: 1.1,
    color: colors.textSecondary,
  },

  title: {
    ...typography.display,
    fontSize: 44,
    lineHeight: 47,
    letterSpacing: 2.2,
    color: colors.textPrimary,
    marginTop: spacing.sm,
  },

  blueDot: {
    color: colors.primary,
  },

  subtitle: {
    fontFamily: 'Oswald_400Regular',
    fontSize: 15,
    lineHeight: 22,
    color: colors.textSecondary,
    marginTop: spacing.md,
    maxWidth: 390,
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

  stepRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },

  stepIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },

  stepIconDone: {
    backgroundColor: colors.primary,
  },

  stepIconActive: {
    borderWidth: 2,
    borderColor: colors.brandWhite,
  },

  stepIconFuture: {
    borderWidth: 1,
    borderColor: colors.border,
  },

  activeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.brandWhite,
  },

  futureDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.textMuted,
  },

  stepText: {
    fontFamily: 'Oswald_500Medium',
    fontSize: 15,
    lineHeight: 20,
  },

  stepTextDone: {
    color: colors.textPrimary,
  },

  stepTextActive: {
    color: colors.brandWhite,
  },

  stepTextFuture: {
    color: colors.textMuted,
  },

  bottomArea: {
    marginTop: spacing.xl,
  },

  runningStatus: {
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },

  loaderDots: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },

  loaderDotBlue: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.primary,
  },

  loaderDotWhite: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.brandWhite,
  },

  loaderDotRed: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.brandRed,
  },

  waitText: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 1.2,
    color: colors.textPrimary,
  },

  errorCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,65,65,0.34)',
    backgroundColor: 'rgba(255,65,65,0.07)',
    padding: 13,
    gap: 10,
  },

  errorMain: {
    gap: 3,
  },

  errorTitle: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 11,
    lineHeight: 15,
    letterSpacing: 0.8,
    color: colors.brandRed,
  },

  errorText: {
    fontFamily: 'Oswald_400Regular',
    fontSize: 12,
    lineHeight: 18,
    color: colors.textSecondary,
  },

  retryButton: {
    minHeight: 43,
    borderRadius: 11,
    paddingHorizontal: 16,
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },

  retryButtonText: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 11,
    letterSpacing: 0.8,
    color: colors.brandWhite,
  },

  controlModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.82)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },

  controlModalCard: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 20,
    padding: spacing.xl,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },

  controlModalIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,65,65,0.10)',
    marginBottom: spacing.lg,
  },

  controlModalTitle: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 24,
    lineHeight: 30,
    letterSpacing: 0.7,
    color: colors.textPrimary,
  },

  controlModalText: {
    fontFamily: 'Oswald_400Regular',
    fontSize: 15,
    lineHeight: 22,
    color: colors.textSecondary,
    marginTop: spacing.md,
    marginBottom: spacing.xl,
  },

  controlPrimaryButton: {
    minHeight: 50,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },

  controlPrimaryButtonText: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 13,
    letterSpacing: 0.8,
    color: colors.brandWhite,
  },

  controlDangerButton: {
    minHeight: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.sm,
    borderWidth: 1,
    borderColor: colors.brandRed,
  },

  controlDangerButtonText: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 12,
    letterSpacing: 0.7,
    color: colors.brandRed,
  },

  pressed: {
    opacity: 0.65,
  },
});
