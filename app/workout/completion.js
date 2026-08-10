// completion.js — aligné hyper-api v2.2.1 / moteur de progression coach
import { useState } from 'react';
import { router } from 'expo-router';
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
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
  completeWorkoutSession,
} from '../../src/services/workoutService';

const brandIcon = require('../../assets/branding/ugerod-icon.png');

/*
 * FALLBACK MENU DEV
 *
 * Utilisé uniquement si completion.js est ouvert directement
 * sans passer par Préparation → Génération → Séance.
 */
const FALLBACK_EXERCISES = [
  {
    id: 'air-squat',
    name: 'AIR SQUAT',
    prescription: '12 REPS',
    status: 'completed',
    trackingType: 'bodyweight',
  },
  {
    id: 'goblet-squat',
    name: 'GOBLET SQUAT',
    prescription: '8 REPS',
    status: 'completed',
    trackingType: 'load',
  },
  {
    id: 'push-up',
    name: 'PUSH-UP',
    prescription: '10 REPS',
    status: 'completed',
    trackingType: 'bodyweight',
  },
  {
    id: 'burpee',
    name: 'BURPEE',
    prescription: '8 REPS',
    status: 'skipped',
    trackingType: 'bodyweight',
  },
];

export default function CompletionScreen() {
  const {
    workout,
    completion,
    updateWorkout,
    updateCompletion,
    setExerciseLoad,
  } = useWorkout();

  const [isSaving, setIsSaving] =
    useState(false);

  const [saveError, setSaveError] =
    useState('');

  /*
   * =========================================================
   * DONNÉES DE LA SÉANCE
   * =========================================================
   */

  const sourceExercises =
    workout.exercises?.length > 0
      ? workout.exercises
      : FALLBACK_EXERCISES;

  const completedExercises =
    sourceExercises.filter(
      (exercise) =>
        exercise.status === 'completed'
    );

  const skippedExercises =
    sourceExercises.filter(
      (exercise) =>
        exercise.status === 'skipped'
    );

  const loadExercises =
    completedExercises.filter(
      (exercise) =>
        exercise.trackingType === 'load'
    );

  const plannedDuration =
    workout.plannedDuration ?? 45;

  const blockCount =
    Array.isArray(workout.rawBlocks) &&
    workout.rawBlocks.length > 0
      ? workout.rawBlocks.length
      : Object.keys(workout.blocks ?? {}).length;

  /*
   * Ne jamais inventer un ressenti utilisateur.
   * Tant que l'utilisateur n'a pas choisi une note,
   * la valeur reste réellement absente.
   */
  const formAfterWorkout =
    completion.formAfter ?? null;

  const rpe =
    completion.rpe ?? null;

  const notes =
    completion.notes ?? '';

  const loads =
    completion.loads ?? {};

  function handleBack() {
    router.back();
  }

  function handleFormChange(value) {
    updateCompletion({
      formAfter: value,
    });
  }

  function handleRpeChange(value) {
    updateCompletion({
      rpe: value,
    });
  }

  function handleNotesChange(value) {
    updateCompletion({
      notes: value,
    });
  }

  function updateLoad(
    exerciseId,
    value
  ) {
    setExerciseLoad(
      exerciseId,
      value
    );
  }

  async function handleFinish() {
    if (isSaving) {
      return;
    }

    setSaveError('');
    setIsSaving(true);

    try {
      if (!workout.sessionId) {
        throw new Error(
          "Aucune session backend active. Génère d'abord une vraie séance UGEROD."
        );
      }

      if (formAfterWorkout == null) {
        throw new Error(
          'Indique ta forme après la séance avant de l’enregistrer.'
        );
      }

      if (rpe == null) {
        throw new Error(
          'Indique la difficulté ressentie avant de l’enregistrer.'
        );
      }

      await completeWorkoutSession({
        sessionId:
          workout.sessionId,

        exercises:
          sourceExercises,

        formAfter:
          formAfterWorkout,

        rpe,

        notes,

        loads,
      });

      updateCompletion({
        formAfter:
          formAfterWorkout,
        rpe,
        notes,
      });

      updateWorkout({
        status: 'completed',
        completedAt:
          new Date().toISOString(),
      });

      router.replace('/(tabs)');
    } catch (error) {
      setSaveError(
        error?.message ??
          "Impossible d'enregistrer la séance."
      );
    } finally {
      setIsSaving(false);
    }
  }

  function getFormLabel() {
    if (formAfterWorkout == null) {
      return 'À RENSEIGNER';
    }

    if (
      formAfterWorkout <= 3
    ) {
      return 'VIDÉ';
    }

    if (
      formAfterWorkout <= 6
    ) {
      return 'BIEN SOLLICITÉ';
    }

    if (
      formAfterWorkout <= 8
    ) {
      return 'BIEN';
    }

    return 'ENCORE DU JUS';
  }

  function getRpeLabel() {
    if (rpe == null) {
      return 'À RENSEIGNER';
    }

    if (rpe <= 3) {
      return 'FACILE';
    }

    if (rpe <= 6) {
      return 'MODÉRÉ';
    }

    if (rpe <= 8) {
      return 'DIFFICILE';
    }

    return 'TRÈS DIFFICILE';
  }

  return (
    <SafeAreaView
      style={styles.screen}
    >
      <KeyboardAvoidingView
        style={
          styles.keyboardView
        }
        behavior={
          Platform.OS === 'ios'
            ? 'padding'
            : undefined
        }
      >
        <ScrollView
          contentContainerStyle={
            styles.content
          }
          showsVerticalScrollIndicator={
            false
          }
          keyboardShouldPersistTaps="handled"
        >
          {/* HEADER */}
          <View
            style={styles.header}
          >
            <Pressable
              onPress={handleBack}
              hitSlop={12}
              style={({
                pressed,
              }) => [
                styles.backButton,
                pressed &&
                  styles.pressed,
              ]}
            >
              <Ionicons
                name="arrow-back"
                size={22}
                color={
                  colors.textPrimary
                }
              />
            </Pressable>

            <View
              style={
                styles.headerText
              }
            >
              <Text
                style={
                  styles.headerEyebrow
                }
              >
                SÉANCE TERMINÉE
              </Text>

              <Text
                style={
                  styles.headerTitle
                }
              >
                BIEN JOUÉ
                <Text
                  style={
                    styles.blueDot
                  }
                >
                  .
                </Text>
              </Text>
            </View>

            <Image
              source={brandIcon}
              style={
                styles.brandIcon
              }
              resizeMode="contain"
            />
          </View>

          {/* HERO */}
          <View
            style={
              styles.heroCard
            }
          >
            <View
              style={
                styles.heroIcon
              }
            >
              <Ionicons
                name="checkmark"
                size={29}
                color={
                  colors.brandWhite
                }
              />
            </View>

            <Text
              style={
                styles.heroTitle
              }
            >
              SÉANCE VALIDÉE
            </Text>

            <Text
              style={
                styles.heroDescription
              }
            >
              Ton entraînement est
              terminé. Enregistre
              maintenant ton ressenti
              et tes performances.
            </Text>

            <View
              style={
                styles.heroStats
              }
            >
              <View
                style={
                  styles.heroStat
                }
              >
                <Text
                  style={
                    styles.heroStatValue
                  }
                >
                  {plannedDuration}
                </Text>

                <Text
                  style={
                    styles.heroStatLabel
                  }
                >
                  MINUTES
                </Text>
              </View>

              <View
                style={
                  styles.heroStatDivider
                }
              />

              <View
                style={
                  styles.heroStat
                }
              >
                <Text
                  style={
                    styles.heroStatValue
                  }
                >
                  {blockCount}
                </Text>

                <Text
                  style={
                    styles.heroStatLabel
                  }
                >
                  BLOCS
                </Text>
              </View>

              <View
                style={
                  styles.heroStatDivider
                }
              />

              <View
                style={
                  styles.heroStat
                }
              >
                <Text
                  style={
                    styles.heroStatValue
                  }
                >
                  {
                    completedExercises.length
                  }
                </Text>

                <Text
                  style={
                    styles.heroStatLabel
                  }
                >
                  EXOS FAITS
                </Text>
              </View>
            </View>
          </View>

          {/* FORME APRÈS */}
          <SectionHeader
            title="TA FORME MAINTENANT"
            subtitle="Comment tu te sens juste après cette séance ?"
          />

          <RatingCard
            value={
              formAfterWorkout
            }
            onChange={
              handleFormChange
            }
            label={
              getFormLabel()
            }
            lowLabel="VIDÉ"
            highLabel="ENCORE DU JUS"
          />

          {/* RPE */}
          <SectionHeader
            title="DIFFICULTÉ RESSENTIE"
            subtitle="Note l’intensité globale de ta séance."
          />

          <RatingCard
            value={rpe}
            onChange={
              handleRpeChange
            }
            label={
              getRpeLabel()
            }
            lowLabel="FACILE"
            highLabel="TRÈS DIFFICILE"
            useRedAtHigh
          />

          {/* CHARGES */}
          {loadExercises.length >
            0 && (
            <>
              <SectionHeader
                title="CHARGES UTILISÉES"
                subtitle="Optionnel. Renseigne les charges réellement utilisées aujourd’hui."
              />

              <View
                style={
                  styles.loadsCard
                }
              >
                {loadExercises.map(
                  (
                    exercise,
                    index
                  ) => (
                    <View
                      key={
                        exercise.id
                      }
                      style={[
                        styles.loadRow,

                        index !==
                          loadExercises.length -
                            1 &&
                          styles.loadRowBorder,
                      ]}
                    >
                      <View
                        style={
                          styles.loadExerciseMain
                        }
                      >
                        <Text
                          style={
                            styles.loadExerciseName
                          }
                        >
                          {exercise.name.toUpperCase()}
                        </Text>

                        <Text
                          style={
                            styles.loadExerciseDetail
                          }
                        >
                          {
                            exercise.prescription
                          }
                        </Text>
                      </View>

                      <View
                        style={
                          styles.loadInputWrapper
                        }
                      >
                        <Ionicons
                          name="barbell-outline"
                          size={15}
                          color={
                            colors.textMuted
                          }
                        />

                        <TextInput
                          value={
                            loads[
                              exercise
                                .id
                            ] || ''
                          }
                          onChangeText={(
                            value
                          ) =>
                            updateLoad(
                              exercise.id,
                              value
                            )
                          }
                          placeholder="Ex : 20 kg"
                          placeholderTextColor={
                            colors.textMuted
                          }
                          style={
                            styles.loadInput
                          }
                          autoCapitalize="none"
                          autoCorrect={
                            false
                          }
                          returnKeyType="done"
                        />
                      </View>
                    </View>
                  )
                )}

                <View
                  style={
                    styles.loadHelp
                  }
                >
                  <Ionicons
                    name="information-circle-outline"
                    size={17}
                    color={
                      colors.primaryLight
                    }
                  />

                  <Text
                    style={
                      styles.loadHelpText
                    }
                  >
                    Tu peux écrire par
                    exemple 20 kg,
                    2 × 12 kg ou laisser
                    vide.
                  </Text>
                </View>
              </View>
            </>
          )}

          {/* RÉCAP */}
          <SectionHeader
            title="RÉCAP DE TA SÉANCE"
            subtitle="Les exercices enregistrés pour aujourd’hui."
          />

          <View
            style={
              styles.recapCard
            }
          >
            <View
              style={
                styles.recapHeader
              }
            >
              <View>
                <Text
                  style={
                    styles.recapEyebrow
                  }
                >
                  RÉALISÉS
                </Text>

                <Text
                  style={
                    styles.recapCount
                  }
                >
                  {
                    completedExercises.length
                  }
                </Text>
              </View>

              <View
                style={
                  styles.recapCompletedIcon
                }
              >
                <Ionicons
                  name="checkmark"
                  size={19}
                  color={
                    colors.brandWhite
                  }
                />
              </View>
            </View>

            <View
              style={
                styles.exerciseList
              }
            >
              {completedExercises.map(
                (
                  exercise,
                  index
                ) => {
                  const load =
                    exercise.trackingType ===
                      'load' &&
                    loads[
                      exercise.id
                    ]?.trim();

                  return (
                    <View
                      key={
                        exercise.id
                      }
                      style={[
                        styles.exerciseRow,

                        index !==
                          completedExercises.length -
                            1 &&
                          styles.exerciseBorder,
                      ]}
                    >
                      <View
                        style={
                          styles.exerciseStatusCompleted
                        }
                      >
                        <Ionicons
                          name="checkmark"
                          size={13}
                          color={
                            colors.brandWhite
                          }
                        />
                      </View>

                      <View
                        style={
                          styles.exerciseMain
                        }
                      >
                        <Text
                          style={
                            styles.exerciseName
                          }
                        >
                          {exercise.name.toUpperCase()}
                        </Text>

                        <Text
                          style={
                            styles.exerciseDetail
                          }
                        >
                          {
                            exercise.prescription
                          }
                        </Text>
                      </View>

                      {load ? (
                        <View
                          style={
                            styles.savedLoadBadge
                          }
                        >
                          <Ionicons
                            name="barbell-outline"
                            size={12}
                            color={
                              colors.primaryLight
                            }
                          />

                          <Text
                            style={
                              styles.savedLoadText
                            }
                          >
                            {load.toUpperCase()}
                          </Text>
                        </View>
                      ) : null}
                    </View>
                  );
                }
              )}

              {completedExercises.length ===
                0 && (
                <Text
                  style={
                    styles.emptyText
                  }
                >
                  Aucun exercice
                  marqué comme réalisé.
                </Text>
              )}
            </View>
          </View>

          {/* NON RÉALISÉS */}
          {skippedExercises.length >
            0 && (
            <View
              style={
                styles.skippedCard
              }
            >
              <View
                style={
                  styles.skippedHeader
                }
              >
                <Text
                  style={
                    styles.skippedTitle
                  }
                >
                  NON RÉALISÉS
                </Text>

                <Text
                  style={
                    styles.skippedCount
                  }
                >
                  {
                    skippedExercises.length
                  }
                </Text>
              </View>

              {skippedExercises.map(
                (exercise) => (
                  <View
                    key={
                      exercise.id
                    }
                    style={
                      styles.skippedRow
                    }
                  >
                    <View
                      style={
                        styles.exerciseStatusSkipped
                      }
                    >
                      <Ionicons
                        name="close"
                        size={13}
                        color={
                          colors.brandWhite
                        }
                      />
                    </View>

                    <Text
                      style={
                        styles.skippedExerciseName
                      }
                    >
                      {exercise.name.toUpperCase()}
                    </Text>

                    <Text
                      style={
                        styles.exerciseDetail
                      }
                    >
                      {
                        exercise.prescription
                      }
                    </Text>
                  </View>
                )
              )}
            </View>
          )}

          {/* NOTES */}
          <SectionHeader
            title="NOTES"
            subtitle="Ajoute librement ce que tu veux retenir de cette séance."
          />

          <View
            style={
              styles.notesCard
            }
          >
            <TextInput
              value={notes}
              onChangeText={
                handleNotesChange
              }
              placeholder="Ex : bonnes sensations aujourd’hui, 24 kg un peu lourd sur les dernières séries..."
              placeholderTextColor={
                colors.textMuted
              }
              multiline
              textAlignVertical="top"
              maxLength={1000}
              style={
                styles.notesInput
              }
            />

            <View
              style={
                styles.notesFooter
              }
            >
              <View
                style={
                  styles.notesHint
                }
              >
                <Ionicons
                  name="create-outline"
                  size={15}
                  color={
                    colors.textMuted
                  }
                />

                <Text
                  style={
                    styles.notesHintText
                  }
                >
                  NOTE PERSONNELLE
                </Text>
              </View>

              <Text
                style={
                  styles.notesCount
                }
              >
                {notes.length}/1000
              </Text>
            </View>
          </View>

          {/* INFO */}
          <View
            style={
              styles.infoCard
            }
          >
            <Ionicons
              name="analytics-outline"
              size={21}
              color={
                colors.primaryLight
              }
            />

            <Text
              style={
                styles.infoText
              }
            >
              Tes performances et
              ton ressenti alimentent
              la progression UGEROD.
              Tes notes restent aussi
              enregistrées avec la
              séance.
            </Text>
          </View>

          {/* ERREUR ENREGISTREMENT */}
          {saveError ? (
            <View
              style={
                styles.saveErrorCard
              }
            >
              <Ionicons
                name="alert-circle-outline"
                size={20}
                color={
                  colors.brandRed
                }
              />

              <Text
                style={
                  styles.saveErrorText
                }
              >
                {saveError}
              </Text>
            </View>
          ) : null}

          {/* CTA */}
          <Pressable
            onPress={
              handleFinish
            }
            disabled={
              isSaving ||
              formAfterWorkout == null ||
              rpe == null
            }
            style={({
              pressed,
            }) => [
              styles.finishButton,

              (isSaving ||
                formAfterWorkout == null ||
                rpe == null) &&
                styles.finishButtonDisabled,

              pressed &&
                !isSaving &&
                formAfterWorkout != null &&
                rpe != null &&
                styles.finishButtonPressed,
            ]}
          >
            <Text
              style={
                styles.finishButtonText
              }
            >
              {isSaving
                ? 'ENREGISTREMENT...'
                : formAfterWorkout == null ||
                    rpe == null
                  ? 'RENSEIGNE TON RESSENTI'
                  : 'ENREGISTRER MA SÉANCE'}
            </Text>

            <Ionicons
              name="checkmark-circle-outline"
              size={21}
              color={
                colors.brandWhite
              }
            />
          </Pressable>

          <Text
            style={
              styles.finishHint
            }
          >
            Tu retrouveras cette
            séance dans ton planning
            et ta progression.
          </Text>

          <View
            style={
              styles.bottomSpace
            }
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function SectionHeader({
  title,
  subtitle,
}) {
  return (
    <View
      style={
        styles.sectionHeader
      }
    >
      <Text
        style={
          styles.sectionTitle
        }
      >
        {title}
      </Text>

      <Text
        style={
          styles.sectionSubtitle
        }
      >
        {subtitle}
      </Text>
    </View>
  );
}

function RatingCard({
  value,
  onChange,
  label,
  lowLabel,
  highLabel,
  useRedAtHigh = false,
}) {
  const hasValue =
    value != null;

  const highValue =
    hasValue && value >= 9;

  const lowValue =
    hasValue && value <= 3;

  let activeColor =
    hasValue
      ? colors.primary
      : colors.textMuted;

  if (lowValue) {
    activeColor =
      colors.brandRed;
  }

  if (
    highValue &&
    useRedAtHigh
  ) {
    activeColor =
      colors.brandRed;
  }

  return (
    <View
      style={
        styles.ratingCard
      }
    >
      <View
        style={
          styles.ratingTop
        }
      >
        <View>
          <Text
            style={[
              styles.ratingValue,
              {
                color:
                  activeColor,
              },
            ]}
          >
            {hasValue ? value : '—'}
            <Text
              style={
                styles.ratingTotal
              }
            >
              /10
            </Text>
          </Text>

          <Text
            style={[
              styles.ratingLabel,
              {
                color:
                  activeColor,
              },
            ]}
          >
            {label}
          </Text>
        </View>

        <Ionicons
          name="pulse-outline"
          size={27}
          color={
            activeColor
          }
        />
      </View>

      <View
        style={
          styles.ratingNumbers
        }
      >
        {Array.from(
          {
            length: 10,
          },
          (_, index) => {
            const number =
              index + 1;

            const selected =
              value === number;

            let selectedBackground =
              colors.primary;

            if (
              number <= 3
            ) {
              selectedBackground =
                colors.brandRed;
            }

            if (
              useRedAtHigh &&
              number >= 9
            ) {
              selectedBackground =
                colors.brandRed;
            }

            return (
              <Pressable
                key={number}
                onPress={() =>
                  onChange(number)
                }
                style={[
                  styles.ratingNumber,

                  selected && {
                    backgroundColor:
                      selectedBackground,

                    borderColor:
                      selectedBackground,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.ratingNumberText,

                    selected &&
                      styles.ratingNumberTextSelected,
                  ]}
                >
                  {number}
                </Text>
              </Pressable>
            );
          }
        )}
      </View>

      <View
        style={
          styles.ratingLegend
        }
      >
        <Text
          style={
            styles.ratingLegendLow
          }
        >
          {lowLabel}
        </Text>

        <Text
          style={
            styles.ratingLegendHigh
          }
        >
          {highLabel}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor:
      colors.background,
  },

  keyboardView: {
    flex: 1,
  },

  content: {
    paddingHorizontal:
      spacing.xl,
    paddingTop:
      spacing.sm,
  },

  /* HEADER */

  header: {
    minHeight: 74,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
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

  headerText: {
    flex: 1,
  },

  headerEyebrow: {
    fontFamily:
      'Oswald_600SemiBold',
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 1,
    color:
      colors.textSecondary,
  },

  headerTitle: {
    ...typography.display,
    fontSize: 32,
    lineHeight: 35,
    letterSpacing: 1.7,
    color:
      colors.textPrimary,
  },

  blueDot: {
    color:
      colors.primary,
  },

  brandIcon: {
    width: 45,
    height: 45,
  },

  /* HERO */

  heroCard: {
    marginTop: 10,
    borderRadius: 20,
    padding: 20,
    backgroundColor:
      colors.surface,
    borderWidth: 1,
    borderColor:
      colors.border,
    alignItems: 'center',
  },

  heroIcon: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor:
      colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },

  heroTitle: {
    fontFamily:
      'BebasNeue_400Regular',
    fontSize: 31,
    lineHeight: 34,
    letterSpacing: 1.6,
    color:
      colors.textPrimary,
    marginTop: 13,
  },

  heroDescription: {
    fontFamily:
      'Oswald_400Regular',
    fontSize: 13,
    lineHeight: 20,
    color:
      colors.textSecondary,
    textAlign: 'center',
    maxWidth: 310,
    marginTop: 5,
  },

  heroStats: {
    width: '100%',
    marginTop: 20,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor:
      'rgba(255,255,255,0.06)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent:
      'space-around',
  },

  heroStat: {
    flex: 1,
    alignItems: 'center',
  },

  heroStatValue: {
    fontFamily:
      'BebasNeue_400Regular',
    fontSize: 27,
    lineHeight: 29,
    color:
      colors.textPrimary,
  },

  heroStatLabel: {
    fontFamily:
      'Oswald_600SemiBold',
    fontSize: 9,
    lineHeight: 12,
    letterSpacing: 0.6,
    color:
      colors.textMuted,
    marginTop: 2,
  },

  heroStatDivider: {
    width: 1,
    height: 30,
    backgroundColor:
      'rgba(255,255,255,0.08)',
  },

  /* SECTIONS */

  sectionHeader: {
    marginTop: 28,
    marginBottom: 11,
  },

  sectionTitle: {
    fontFamily:
      'Oswald_700Bold',
    fontSize: 14,
    lineHeight: 18,
    letterSpacing: 0.7,
    color:
      colors.textPrimary,
  },

  sectionSubtitle: {
    fontFamily:
      'Oswald_400Regular',
    fontSize: 12,
    lineHeight: 18,
    color:
      colors.textSecondary,
    marginTop: 3,
  },

  /* RATING */

  ratingCard: {
    borderRadius: 17,
    padding: 16,
    backgroundColor:
      colors.surface,
    borderWidth: 1,
    borderColor:
      colors.border,
  },

  ratingTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent:
      'space-between',
  },

  ratingValue: {
    fontFamily:
      'BebasNeue_400Regular',
    fontSize: 35,
    lineHeight: 37,
  },

  ratingTotal: {
    fontFamily:
      'Oswald_600SemiBold',
    fontSize: 14,
    color:
      colors.textSecondary,
  },

  ratingLabel: {
    fontFamily:
      'Oswald_700Bold',
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 0.7,
    marginTop: 1,
  },

  ratingNumbers: {
    flexDirection: 'row',
    justifyContent:
      'space-between',
    gap: 4,
    marginTop: 18,
  },

  ratingNumber: {
    flex: 1,
    aspectRatio: 1,
    maxWidth: 34,
    borderRadius: 17,
    backgroundColor:
      colors.backgroundSoft,
    borderWidth: 1,
    borderColor:
      colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },

  ratingNumberText: {
    fontFamily:
      'Oswald_600SemiBold',
    fontSize: 12,
    color:
      colors.textSecondary,
  },

  ratingNumberTextSelected: {
    color:
      colors.brandWhite,
  },

  ratingLegend: {
    flexDirection: 'row',
    justifyContent:
      'space-between',
    marginTop: 10,
  },

  ratingLegendLow: {
    fontFamily:
      'Oswald_600SemiBold',
    fontSize: 9,
    letterSpacing: 0.4,
    color:
      colors.textMuted,
  },

  ratingLegendHigh: {
    fontFamily:
      'Oswald_600SemiBold',
    fontSize: 9,
    letterSpacing: 0.4,
    color:
      colors.textMuted,
  },

  /* CHARGES */

  loadsCard: {
    borderRadius: 17,
    paddingHorizontal: 15,
    backgroundColor:
      colors.surface,
    borderWidth: 1,
    borderColor:
      colors.border,
    overflow: 'hidden',
  },

  loadRow: {
    minHeight: 86,
    paddingVertical: 13,
    gap: 10,
  },

  loadRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor:
      'rgba(255,255,255,0.06)',
  },

  loadExerciseMain: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent:
      'space-between',
  },

  loadExerciseName: {
    flex: 1,
    fontFamily:
      'Oswald_700Bold',
    fontSize: 13,
    lineHeight: 17,
    color:
      colors.textPrimary,
  },

  loadExerciseDetail: {
    fontFamily:
      'Oswald_500Medium',
    fontSize: 10,
    color:
      colors.textMuted,
  },

  loadInputWrapper: {
    height: 44,
    borderRadius: 12,
    paddingHorizontal: 12,
    backgroundColor:
      colors.backgroundSoft,
    borderWidth: 1,
    borderColor:
      colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },

  loadInput: {
    flex: 1,
    fontFamily:
      'Oswald_500Medium',
    fontSize: 13,
    color:
      colors.textPrimary,
    paddingVertical: 0,
  },

  loadHelp: {
    minHeight: 52,
    borderTopWidth: 1,
    borderTopColor:
      'rgba(255,255,255,0.06)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },

  loadHelpText: {
    flex: 1,
    fontFamily:
      'Oswald_400Regular',
    fontSize: 10,
    lineHeight: 15,
    color:
      colors.textMuted,
  },

  /* NOTES */

  notesCard: {
    minHeight: 170,
    borderRadius: 17,
    padding: 14,
    backgroundColor:
      colors.surface,
    borderWidth: 1,
    borderColor:
      colors.border,
  },

  notesInput: {
    minHeight: 115,
    fontFamily:
      'Oswald_400Regular',
    fontSize: 13,
    lineHeight: 20,
    color:
      colors.textPrimary,
    padding: 0,
  },

  notesFooter: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor:
      'rgba(255,255,255,0.06)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent:
      'space-between',
  },

  notesHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },

  notesHintText: {
    fontFamily:
      'Oswald_600SemiBold',
    fontSize: 8,
    letterSpacing: 0.6,
    color:
      colors.textMuted,
  },

  notesCount: {
    fontFamily:
      'Oswald_500Medium',
    fontSize: 9,
    color:
      colors.textMuted,
  },

  /* RÉCAP */

  recapCard: {
    borderRadius: 17,
    padding: 16,
    backgroundColor:
      colors.surface,
    borderWidth: 1,
    borderColor:
      colors.border,
  },

  recapHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent:
      'space-between',
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor:
      'rgba(255,255,255,0.06)',
  },

  recapEyebrow: {
    fontFamily:
      'Oswald_600SemiBold',
    fontSize: 9,
    lineHeight: 13,
    letterSpacing: 0.7,
    color:
      colors.textSecondary,
  },

  recapCount: {
    fontFamily:
      'BebasNeue_400Regular',
    fontSize: 27,
    lineHeight: 29,
    color:
      colors.primaryLight,
    marginTop: 2,
  },

  recapCompletedIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor:
      colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },

  exerciseList: {
    marginTop: 4,
  },

  exerciseRow: {
    minHeight: 57,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },

  exerciseBorder: {
    borderBottomWidth: 1,
    borderBottomColor:
      'rgba(255,255,255,0.05)',
  },

  exerciseStatusCompleted: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor:
      colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },

  exerciseMain: {
    flex: 1,
  },

  exerciseName: {
    fontFamily:
      'Oswald_600SemiBold',
    fontSize: 12,
    lineHeight: 17,
    letterSpacing: 0.3,
    color:
      colors.textPrimary,
  },

  exerciseDetail: {
    fontFamily:
      'Oswald_500Medium',
    fontSize: 10,
    lineHeight: 14,
    color:
      colors.textMuted,
    marginTop: 2,
  },

  savedLoadBadge: {
    minHeight: 28,
    paddingHorizontal: 8,
    borderRadius: 14,
    backgroundColor:
      'rgba(8,104,255,0.10)',
    borderWidth: 1,
    borderColor:
      'rgba(8,104,255,0.25)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },

  savedLoadText: {
    fontFamily:
      'Oswald_700Bold',
    fontSize: 9,
    color:
      colors.primaryLight,
  },

  emptyText: {
    fontFamily:
      'Oswald_400Regular',
    fontSize: 11,
    lineHeight: 17,
    color:
      colors.textMuted,
    textAlign: 'center',
    paddingVertical: 18,
  },

  /* NON RÉALISÉS */

  skippedCard: {
    marginTop: 10,
    borderRadius: 17,
    padding: 16,
    backgroundColor:
      colors.surface,
    borderWidth: 1,
    borderColor:
      'rgba(255,59,59,0.20)',
  },

  skippedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent:
      'space-between',
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor:
      'rgba(255,255,255,0.05)',
  },

  skippedTitle: {
    fontFamily:
      'Oswald_700Bold',
    fontSize: 10,
    letterSpacing: 0.7,
    color:
      colors.brandRed,
  },

  skippedCount: {
    fontFamily:
      'BebasNeue_400Regular',
    fontSize: 21,
    color:
      colors.brandRed,
  },

  skippedRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },

  exerciseStatusSkipped: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor:
      colors.brandRed,
    alignItems: 'center',
    justifyContent: 'center',
  },

  skippedExerciseName: {
    flex: 1,
    fontFamily:
      'Oswald_600SemiBold',
    fontSize: 12,
    lineHeight: 17,
    color:
      colors.textSecondary,
  },

  /* INFO */

  infoCard: {
    minHeight: 76,
    marginTop: 24,
    borderRadius: 15,
    padding: 14,
    backgroundColor:
      'rgba(8,104,255,0.08)',
    borderWidth: 1,
    borderColor:
      'rgba(8,104,255,0.25)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },

  infoText: {
    flex: 1,
    fontFamily:
      'Oswald_400Regular',
    fontSize: 12,
    lineHeight: 18,
    color:
      colors.textSecondary,
  },

  /* ERREUR ENREGISTREMENT */

  saveErrorCard: {
    minHeight: 58,
    marginTop: 22,
    borderRadius: 14,
    padding: 13,
    backgroundColor:
      'rgba(255,59,59,0.08)',
    borderWidth: 1,
    borderColor:
      'rgba(255,59,59,0.24)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },

  saveErrorText: {
    flex: 1,
    fontFamily:
      'Oswald_400Regular',
    fontSize: 12,
    lineHeight: 18,
    color:
      colors.textSecondary,
  },

  /* CTA */

  finishButton: {
    minHeight: 58,
    marginTop: 22,
    borderRadius: 14,
    backgroundColor:
      colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
  },

  finishButtonDisabled: {
    opacity: 0.45,
  },

  finishButtonPressed: {
    backgroundColor:
      colors.primaryDark,
    transform: [
      {
        scale: 0.985,
      },
    ],
  },

  finishButtonText: {
    fontFamily:
      'BebasNeue_400Regular',
    fontSize: 20,
    lineHeight: 23,
    letterSpacing: 1.1,
    color:
      colors.brandWhite,
  },

  finishHint: {
    fontFamily:
      'Oswald_400Regular',
    fontSize: 11,
    lineHeight: 17,
    color:
      colors.textMuted,
    textAlign: 'center',
    marginTop: 10,
    paddingHorizontal: 20,
  },

  bottomSpace: {
    height: 38,
  },

  pressed: {
    opacity: 0.65,
  },
});