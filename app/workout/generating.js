import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import {
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  Image,
  Pressable,
  SafeAreaView,
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

export default function GeneratingScreen() {
  const [
    activeStep,
    setActiveStep,
  ] = useState(0);

  const [
    generationError,
    setGenerationError,
  ] = useState('');

  const generationDone =
    useRef(false);

  const {
    preparation,
    setGeneratedWorkout,
  } = useWorkout();

  useEffect(() => {
    const interval = setInterval(
      () => {
        setActiveStep(
          (current) => {
            if (
              current >=
              STEPS.length - 1
            ) {
              return current;
            }

            return current + 1;
          }
        );
      },
      850
    );

    return () => {
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (
      activeStep !==
      STEPS.length - 1 ||
      generationDone.current
    ) {
      return;
    }

    generationDone.current = true;
    let cancelled = false;

    async function runGeneration() {
      try {
        setGenerationError('');

        const generatedWorkout =
          await generateWorkoutSession(
            preparation
          );

        if (cancelled) {
          return;
        }

        setGeneratedWorkout(
          generatedWorkout
        );

        /*
         * F-C4 : pas d'écran d'aperçu.
         * Le WOD reste une surprise directement
         * dans l'écran Session.
         */
        router.replace(
          '/workout/session'
        );
      } catch (error) {
        if (cancelled) {
          return;
        }

        setGenerationError(
          error?.message ??
            'Impossible de générer la séance.'
        );

        generationDone.current = false;
      }
    }

    runGeneration();

    return () => {
      cancelled = true;
    };
  }, [
    activeStep,
    preparation,
    setGeneratedWorkout,
  ]);

  function handleRetry() {
    setGenerationError('');
    generationDone.current = false;
    setActiveStep(
      STEPS.length - 2
    );

    setTimeout(() => {
      setActiveStep(
        STEPS.length - 1
      );
    }, 100);
  }

  function handleBack() {
    router.back();
  }

  return (
    <SafeAreaView
      style={styles.screen}
    >
      <View style={styles.content}>
        <View style={styles.header}>
          <Pressable
            onPress={handleBack}
            hitSlop={12}
            style={({ pressed }) => [
              styles.backButton,
              pressed &&
                styles.pressed,
            ]}
          >
            <Ionicons
              name="arrow-back"
              size={22}
              color={colors.textPrimary}
            />
          </Pressable>

          <View
            style={styles.headerSpacer}
          />

          <Image
            source={brandIcon}
            style={styles.brandIcon}
            resizeMode="contain"
          />
        </View>

        <View
          style={styles.progressWrapper}
        >
          <LinearGradient
            colors={[
              colors.primary,
              colors.brandWhite,
              colors.brandRed,
            ]}
            start={{
              x: 0,
              y: 0.5,
            }}
            end={{
              x: 1,
              y: 0.5,
            }}
            style={styles.progressLine}
          />
        </View>

        <View
          style={styles.titleArea}
        >
          <Text style={styles.eyebrow}>
            UGEROD PRÉPARE TA SÉANCE
          </Text>

          <Text style={styles.title}>
            CRÉATION DE
            {'\n'}
            TA SÉANCE
            <Text
              style={styles.blueDot}
            >
              .
            </Text>
          </Text>

          <Text style={styles.subtitle}>
            UGEROD construit une séance adaptée à ton profil, ton matériel et ta forme du jour.
          </Text>
        </View>

        <View style={styles.stepsCard}>
          {STEPS.map(
            (step, index) => {
              const done =
                index < activeStep;
              const active =
                index === activeStep;
              const future =
                index > activeStep;

              return (
                <View
                  key={step}
                  style={[
                    styles.stepRow,
                    index !==
                      STEPS.length - 1 &&
                      styles.stepRowBorder,
                  ]}
                >
                  <View
                    style={[
                      styles.stepIcon,
                      done &&
                        styles.stepIconDone,
                      active &&
                        styles.stepIconActive,
                      future &&
                        styles.stepIconFuture,
                    ]}
                  >
                    {done ? (
                      <Ionicons
                        name="checkmark"
                        size={15}
                        color={
                          colors.brandWhite
                        }
                      />
                    ) : active ? (
                      <View
                        style={styles.activeDot}
                      />
                    ) : (
                      <View
                        style={styles.futureDot}
                      />
                    )}
                  </View>

                  <Text
                    style={[
                      styles.stepText,
                      done &&
                        styles.stepTextDone,
                      active &&
                        styles.stepTextActive,
                      future &&
                        styles.stepTextFuture,
                    ]}
                  >
                    {step}
                  </Text>
                </View>
              );
            }
          )}
        </View>

        <View style={styles.spacer} />

        <View
          style={styles.bottomArea}
        >
          <View style={styles.loaderDots}>
            <View
              style={styles.loaderDotBlue}
            />
            <View
              style={styles.loaderDotWhite}
            />
            <View
              style={styles.loaderDotRed}
            />
          </View>

          {generationError ? (
            <>
              <Text
                style={styles.errorText}
              >
                {generationError}
              </Text>

              <Pressable
                onPress={handleRetry}
                style={({ pressed }) => [
                  styles.retryButton,
                  pressed &&
                    styles.pressed,
                ]}
              >
                <Text
                  style={styles.retryButtonText}
                >
                  RÉESSAYER
                </Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text
                style={styles.waitText}
              >
                QUELQUES SECONDES...
              </Text>

              <Text
                style={styles.motivation}
              >
                Le contenu du WOD restera une surprise jusqu’au bon moment.
              </Text>
            </>
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor:
      colors.background,
  },

  content: {
    flex: 1,
    paddingHorizontal:
      spacing.xl,
    paddingTop: spacing.sm,
    paddingBottom:
      spacing.xxl,
  },

  header: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
  },

  backButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor:
      colors.surface,
    borderWidth: 1,
    borderColor:
      colors.border,
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
    marginBottom:
      spacing.xxl,
  },

  progressLine: {
    height: 4,
    borderRadius: 999,
  },

  titleArea: {
    marginBottom:
      spacing.xxl,
  },

  eyebrow: {
    fontFamily:
      'Oswald_600SemiBold',
    fontSize: 11,
    lineHeight: 15,
    letterSpacing: 1.1,
    color:
      colors.textSecondary,
  },

  title: {
    ...typography.display,
    fontSize: 44,
    lineHeight: 47,
    letterSpacing: 2.2,
    color:
      colors.textPrimary,
    marginTop: spacing.sm,
  },

  blueDot: {
    color: colors.primary,
  },

  subtitle: {
    fontFamily:
      'Oswald_400Regular',
    fontSize: 15,
    lineHeight: 22,
    color:
      colors.textSecondary,
    marginTop: spacing.md,
    maxWidth: 360,
  },

  stepsCard: {
    borderRadius: 18,
    backgroundColor:
      colors.surface,
    borderWidth: 1,
    borderColor:
      colors.border,
    overflow: 'hidden',
  },

  stepRow: {
    minHeight: 68,
    paddingHorizontal:
      spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },

  stepRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor:
      'rgba(255,255,255,0.05)',
  },

  stepIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },

  stepIconDone: {
    backgroundColor:
      colors.primary,
  },

  stepIconActive: {
    borderWidth: 2,
    borderColor:
      colors.brandWhite,
  },

  stepIconFuture: {
    borderWidth: 1,
    borderColor:
      colors.border,
  },

  activeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor:
      colors.brandWhite,
  },

  futureDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor:
      colors.textMuted,
  },

  stepText: {
    fontFamily:
      'Oswald_500Medium',
    fontSize: 15,
    lineHeight: 20,
  },

  stepTextDone: {
    color:
      colors.textPrimary,
  },

  stepTextActive: {
    color:
      colors.brandWhite,
  },

  stepTextFuture: {
    color:
      colors.textMuted,
  },

  spacer: {
    flex: 1,
  },

  bottomArea: {
    alignItems: 'center',
    paddingTop:
      spacing.xxl,
  },

  loaderDots: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
  },

  loaderDotBlue: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor:
      colors.primary,
  },

  loaderDotWhite: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor:
      colors.brandWhite,
  },

  loaderDotRed: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor:
      colors.brandRed,
  },

  waitText: {
    fontFamily:
      'Oswald_700Bold',
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 1.2,
    color:
      colors.textPrimary,
  },

  motivation: {
    fontFamily:
      'Oswald_400Regular',
    fontSize: 14,
    lineHeight: 21,
    color:
      colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.sm,
    maxWidth: 300,
  },

  errorText: {
    fontFamily:
      'Oswald_500Medium',
    fontSize: 13,
    lineHeight: 20,
    color:
      colors.brandRed,
    textAlign: 'center',
    maxWidth: 330,
  },

  retryButton: {
    minHeight: 42,
    marginTop: 14,
    borderRadius: 12,
    paddingHorizontal: 22,
    backgroundColor:
      colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },

  retryButtonText: {
    fontFamily:
      'Oswald_700Bold',
    fontSize: 12,
    letterSpacing: 0.8,
    color:
      colors.brandWhite,
  },

  pressed: {
    opacity: 0.65,
  },
});