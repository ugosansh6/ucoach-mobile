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

const ADAPTED_REASONS = [
  {
    code: 'TECHNIQUE_DIFFICULTY',
    label: 'Mouvement difficile',
  },
  {
    code: 'LOAD_TOO_HEAVY',
    label: 'Charge trop lourde',
  },
  {
    code: 'FATIGUE',
    label: 'Fatigue',
  },
  {
    code: 'PAIN_DISCOMFORT',
    label: 'Gêne / douleur',
  },
  {
    code: 'EQUIPMENT',
    label: 'Matériel',
  },
  {
    code: 'TIME',
    label: 'Manque de temps',
  },
  {
    code: 'OTHER',
    label: 'Autre',
  },
];

const NOT_COMPLETED_REASONS = [
  {
    code: 'MOVEMENT_FAILURE',
    label: 'Échec du mouvement',
  },
  {
    code: 'FATIGUE',
    label: 'Fatigue',
  },
  {
    code: 'PAIN_DISCOMFORT',
    label: 'Gêne / douleur',
  },
  {
    code: 'TIME',
    label: 'Manque de temps',
  },
  {
    code: 'MOTIVATION',
    label: 'Motivation',
  },
  {
    code: 'EQUIPMENT',
    label: 'Matériel',
  },
  {
    code: 'OTHER',
    label: 'Autre',
  },
];

const FALLBACK_EXERCISES = [
  {
    id: 'air-squat',
    sessionExerciseId: 'dev-air-squat',
    name: 'AIR SQUAT',
    prescription: '12 REPS',
    status: 'completed',
    trackingType: 'bodyweight',
  },
  {
    id: 'goblet-squat',
    sessionExerciseId: 'dev-goblet-squat',
    name: 'GOBLET SQUAT',
    prescription: '8 REPS',
    status: 'adapted',
    adaptationSource: 'manual',
    trackingType: 'load',
  },
  {
    id: 'burpee',
    sessionExerciseId: 'dev-burpee',
    name: 'BURPEE',
    prescription: '8 REPS',
    status: 'not_completed',
    trackingType: 'bodyweight',
  },
];

function executionStatus(exercise) {
  if (exercise.status === 'adapted') {
    return 'adapted';
  }

  if (
    exercise.status ===
      'not_completed' ||
    exercise.status === 'skipped'
  ) {
    return 'not_completed';
  }

  return 'completed';
}

function exerciseKey(exercise) {
  return (
    exercise.sessionExerciseId ??
    exercise.id
  );
}

function normalizeMechanic(value) {
  return String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/[\s/-]+/g, '_');
}

function numberOr(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric)
    ? numeric
    : fallback;
}

function failedStageTargetReps(
  exercise,
  failedStage
) {
  const prescription =
    exercise?.prescriptionJson ??
    exercise?.prescription_json ??
    {};
  const overlay =
    prescription.mechanic_overlay ??
    {};
  const start = numberOr(
    overlay.start_reps ??
      overlay.base_reps ??
      prescription.reps_min,
    0
  );
  const increment = numberOr(
    overlay.increment_reps,
    0
  );

  return Math.max(
    0,
    Math.round(
      start +
        Math.max(
          0,
          failedStage - 1
        ) *
          increment
    )
  );
}

function buildProtocolOutcome(
  workout,
  protocolFeedback
) {
  const runtime =
    workout?.wodRuntime;

  if (!runtime?.started) {
    return null;
  }

  const mechanic =
    normalizeMechanic(
      runtime.mechanic ??
        workout.mechanic
    );
  const variant =
    normalizeMechanic(
      runtime.variant ??
        workout.formatVariant
    ) || null;
  const elapsedSeconds =
    Math.max(
      0,
      numberOr(
        runtime.elapsedSeconds,
        0
      )
    );
  const parameters =
    runtime.parameters ?? {};

  const outcome = {
    mechanic_key: mechanic,
    variant_key: variant,
    elapsed_seconds:
      elapsedSeconds,
    finish_reason:
      runtime.finishReason ??
      null,
    player_version:
      runtime.version ??
      'fc5-wod-player-v1',
  };

  if (
    ['AMRAP', 'CIRCUIT', 'FOR_TIME'].includes(
      mechanic
    )
  ) {
    outcome.rounds_completed =
      Math.max(
        0,
        numberOr(
          runtime.completedRounds,
          0
        )
      );
  }

  if (mechanic === 'FOR_TIME') {
    outcome.hit_time_cap =
      runtime.finishReason ===
      'time_cap';
    outcome.time_limit_seconds =
      numberOr(
        parameters.cap_seconds,
        elapsedSeconds
      );
  }

  if (
    mechanic === 'EMOM' ||
    mechanic === 'ODD_EVEN'
  ) {
    const stationSeconds =
      Math.max(
        1,
        numberOr(
          parameters.station_seconds,
          60
        )
      );
    outcome.intervals_completed =
      Math.floor(
        elapsedSeconds /
          stationSeconds
      );
  }

  if (
    mechanic ===
    'EVERY_X_MINUTES'
  ) {
    const intervalSeconds =
      Math.max(
        1,
        numberOr(
          parameters.interval_seconds,
          120
        )
      );
    outcome.intervals_completed =
      Math.floor(
        elapsedSeconds /
          intervalSeconds
      );
  }

  if (mechanic === 'HIIT') {
    const workSeconds =
      Math.max(
        1,
        numberOr(
          parameters.work_seconds,
          40
        )
      );
    const restSeconds =
      Math.max(
        0,
        numberOr(
          parameters.rest_seconds,
          20
        )
      );
    const stationSeconds =
      Math.max(
        1,
        workSeconds +
          restSeconds
      );
    const stationsCompleted =
      Math.floor(
        elapsedSeconds /
          stationSeconds
      );

    outcome.intervals_completed =
      stationsCompleted;
    outcome.work_seconds =
      stationsCompleted *
      workSeconds;
  }

  if (
    mechanic === 'LADDER' ||
    mechanic === 'COUPLET'
  ) {
    outcome.last_completed_stage =
      Math.max(
        0,
        numberOr(
          runtime.manualStep,
          1
        )
      );
  }

  if (
    mechanic ===
    'PROGRESSIVE_INTERVAL'
  ) {
    const currentStage =
      Math.max(
        1,
        numberOr(
          runtime.currentStage,
          1
        )
      );

    if (
      runtime.finishReason ===
      'observed_failure'
    ) {
      outcome.last_completed_stage =
        Math.max(
          0,
          currentStage - 1
        );
      outcome.failed_stage =
        currentStage;

      const partial =
        protocolFeedback
          ?.partialRepsByExercise ??
        {};

      if (
        Object.keys(partial).length >
        0
      ) {
        outcome.partial_reps_by_exercise =
          Object.fromEntries(
            Object.entries(partial)
              .map(([id, value]) => [
                id,
                Math.max(
                  0,
                  numberOr(value, 0)
                ),
              ])
          );
      }
    } else {
      outcome.last_completed_stage =
        currentStage;

      if (
        runtime.finishReason ===
        'time_cap'
      ) {
        outcome.completed_time_limit =
          true;
        outcome.hit_time_cap = true;
        outcome.time_limit_seconds =
          elapsedSeconds;
      }
    }
  }

  if (mechanic === 'PYRAMID') {
    outcome.steps_completed =
      Math.max(
        0,
        numberOr(
          runtime.manualStep,
          1
        )
      );
  }

  if (
    mechanic === 'CHIPPER' ||
    mechanic === 'REP_TARGET'
  ) {
    outcome.items_completed =
      Math.max(
        0,
        numberOr(
          runtime.currentItemIndex,
          0
        ) +
          (runtime.finished ? 1 : 0)
      );
  }

  if (mechanic === 'DECK') {
    outcome.cards_completed =
      Math.max(
        0,
        numberOr(
          runtime.currentItemIndex,
          0
        ) +
          (runtime.finished ? 1 : 0)
      );
  }

  if (mechanic === 'STRENGTH') {
    outcome.set_stations_completed =
      Math.max(
        0,
        numberOr(
          runtime.manualStep,
          1
        )
      );
  }

  return outcome;
}

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

  const sourceExercises =
    workout.exercises?.length > 0
      ? workout.exercises
      : FALLBACK_EXERCISES;

  const performedExercises =
    sourceExercises.filter(
      (exercise) =>
        executionStatus(exercise) !==
        'not_completed'
    );

  const exceptionExercises =
    sourceExercises.filter(
      (exercise) =>
        executionStatus(exercise) !==
        'completed'
    );

  const loadExercises =
    performedExercises.filter(
      (exercise) =>
        exercise.trackingType ===
          'load' ||
        exercise.trackingModes?.includes(
          'load'
        )
    );

  const plannedDuration =
    workout.plannedDuration ?? 45;

  const blockCount =
    Array.isArray(workout.rawBlocks) &&
    workout.rawBlocks.length > 0
      ? workout.rawBlocks.length
      : Object.keys(
          workout.blocks ?? {}
        ).length;

  const formAfterWorkout =
    completion.formAfter ?? null;
  const rpe =
    completion.rpe ?? null;
  const notes =
    completion.notes ?? '';
  const loads =
    completion.loads ?? {};
  const exerciseFeedback =
    completion.exerciseFeedback ?? {};
  const protocolFeedback =
    completion.protocolFeedback ?? {};
  const wodRuntime =
    workout.wodRuntime ?? null;
  const wodExercises =
    sourceExercises.filter(
      (exercise) =>
        String(
          exercise.blockKey ??
            exercise.block ??
            ''
        ).toLowerCase() === 'wod'
    );
  const progressiveFailure =
    normalizeMechanic(
      wodRuntime?.mechanic
    ) ===
      'PROGRESSIVE_INTERVAL' &&
    wodRuntime?.finishReason ===
      'observed_failure';
  const failedStage =
    progressiveFailure
      ? Math.max(
          1,
          numberOr(
            wodRuntime?.currentStage,
            1
          )
        )
      : null;

  function handleBack() {
    router.back();
  }

  function setReason(
    exercise,
    reasonCode
  ) {
    const key = exerciseKey(exercise);
    const current =
      exerciseFeedback[key] ?? {};

    updateCompletion({
      exerciseFeedback: {
        ...exerciseFeedback,
        [key]: {
          ...current,
          reasonCode:
            current.reasonCode ===
            reasonCode
              ? null
              : reasonCode,
        },
      },
    });
  }

  function updatePartialReps(
    exercise,
    value
  ) {
    updateCompletion({
      protocolFeedback: {
        ...protocolFeedback,
        partialRepsByExercise: {
          ...(protocolFeedback
            .partialRepsByExercise ??
            {}),
          [exercise.id]: value,
        },
      },
    });
  }

  function updateLoad(
    exercise,
    value
  ) {
    setExerciseLoad(
      exerciseKey(exercise),
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

      if (rpe == null) {
        throw new Error(
          'Indique la difficulté ressentie avant d’enregistrer la séance.'
        );
      }

      if (formAfterWorkout == null) {
        throw new Error(
          'Indique ton ressenti après la séance avant de l’enregistrer.'
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
        exerciseFeedback,
        protocolOutcome:
          buildProtocolOutcome(
            workout,
            protocolFeedback
          ),
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
    if (formAfterWorkout <= 3) {
      return 'VIDÉ';
    }
    if (formAfterWorkout <= 6) {
      return 'BIEN SOLLICITÉ';
    }
    if (formAfterWorkout <= 8) {
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
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView
        style={styles.keyboardView}
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
                color={
                  colors.textPrimary
                }
              />
            </Pressable>

            <View style={styles.headerText}>
              <Text
                style={styles.headerEyebrow}
              >
                SÉANCE TERMINÉE
              </Text>
              <Text
                style={styles.headerTitle}
              >
                BIEN JOUÉ
                <Text
                  style={styles.blueDot}
                >
                  .
                </Text>
              </Text>
            </View>

            <Image
              source={brandIcon}
              style={styles.brandIcon}
              resizeMode="contain"
            />
          </View>

          <View style={styles.heroCard}>
            <View style={styles.heroIcon}>
              <Ionicons
                name="checkmark"
                size={27}
                color={colors.brandWhite}
              />
            </View>

            <View style={styles.heroMain}>
              <Text style={styles.heroTitle}>
                SÉANCE VALIDÉE
              </Text>
              <Text
                style={styles.heroDescription}
              >
                {plannedDuration} MIN · {blockCount} BLOCS · {performedExercises.length} EXOS RÉALISÉS
              </Text>
            </View>
          </View>

          <View style={styles.learningCard}>
            <View
              style={styles.learningIcon}
            >
              <Ionicons
                name="analytics-outline"
                size={23}
                color={
                  colors.brandWhite
                }
              />
            </View>

            <View style={styles.learningMain}>
              <Text
                style={styles.learningTitle}
              >
                CES INFORMATIONS AIDENT UGEROD À MIEUX ADAPTER TES PROCHAINES SÉANCES.
              </Text>
              <Text
                style={styles.learningText}
              >
                Ta difficulté, ton ressenti et les raisons d’une adaptation permettent au coach de mieux comprendre ce qui s’est réellement passé.
              </Text>
            </View>
          </View>

          <SectionHeader
            title="DIFFICULTÉ DE LA SÉANCE"
            subtitle="À quel point cette séance t’a semblé difficile ?"
          />
          <RatingCard
            value={rpe}
            onChange={(value) =>
              updateCompletion({
                rpe: value,
              })
            }
            label={getRpeLabel()}
            lowLabel="FACILE"
            highLabel="TRÈS DIFFICILE"
            useRedAtHigh
          />

          <SectionHeader
            title="TON RESSENTI MAINTENANT"
            subtitle="Comment tu te sens juste après l’entraînement ?"
          />
          <RatingCard
            value={formAfterWorkout}
            onChange={(value) =>
              updateCompletion({
                formAfter: value,
              })
            }
            label={getFormLabel()}
            lowLabel="VIDÉ"
            highLabel="ENCORE DU JUS"
          />

          {wodRuntime?.started ? (
            <>
              <SectionHeader
                title="RÉSULTAT DU WOD"
                subtitle="UGEROD a déjà récupéré le résultat du player. Tu n’as rien à ressaisir sauf une éventuelle étape échouée."
              />

              <ProtocolResultCard
                runtime={wodRuntime}
                failedStage={failedStage}
                wodExercises={wodExercises}
                protocolFeedback={
                  protocolFeedback
                }
                onPartialRepsChange={
                  updatePartialReps
                }
              />
            </>
          ) : null}

          {exceptionExercises.length > 0 ? (
            <>
              <SectionHeader
                title="ADAPTATIONS DE LA SÉANCE"
                subtitle="Facultatif : précise uniquement pourquoi certains exercices ont été adaptés ou non réalisés."
              />

              <View style={styles.exceptionList}>
                {exceptionExercises.map(
                  (exercise) => (
                    <ExceptionCard
                      key={exerciseKey(
                        exercise
                      )}
                      exercise={exercise}
                      selectedReason={
                        exerciseFeedback[
                          exerciseKey(
                            exercise
                          )
                        ]?.reasonCode ??
                        null
                      }
                      onReasonSelect={(
                        reasonCode
                      ) =>
                        setReason(
                          exercise,
                          reasonCode
                        )
                      }
                    />
                  )
                )}
              </View>
            </>
          ) : null}

          {loadExercises.length > 0 ? (
            <>
              <SectionHeader
                title="CHARGES UTILISÉES"
                subtitle="Optionnel. Renseigne uniquement les charges que tu veux conserver dans ton historique."
              />

              <View style={styles.loadsCard}>
                {loadExercises.map(
                  (exercise, index) => {
                    const key =
                      exerciseKey(
                        exercise
                      );

                    return (
                      <View
                        key={key}
                        style={[
                          styles.loadRow,
                          index !==
                            loadExercises.length -
                              1 &&
                            styles.loadRowBorder,
                        ]}
                      >
                        <View
                          style={styles.loadMain}
                        >
                          <Text
                            style={styles.loadName}
                          >
                            {String(
                              exercise.name
                            ).toUpperCase()}
                          </Text>
                          <Text
                            style={styles.loadPrescription}
                          >
                            {exercise.prescription}
                          </Text>
                        </View>

                        <View
                          style={styles.loadInputWrap}
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
                              loads[key] ??
                              loads[
                                exercise.id
                              ] ??
                              ''
                            }
                            onChangeText={(
                              value
                            ) =>
                              updateLoad(
                                exercise,
                                value
                              )
                            }
                            placeholder="Ex : 2 × 12 kg"
                            placeholderTextColor={
                              colors.textMuted
                            }
                            style={styles.loadInput}
                            returnKeyType="done"
                          />
                        </View>
                      </View>
                    );
                  }
                )}
              </View>
            </>
          ) : null}

          <SectionHeader
            title="NOTES"
            subtitle="Optionnel. Ajoute ce que tu veux retenir de cette séance."
          />

          <View style={styles.notesCard}>
            <TextInput
              value={notes}
              onChangeText={(value) =>
                updateCompletion({
                  notes: value,
                })
              }
              placeholder="Ex : bonnes sensations, mouvement à retravailler..."
              placeholderTextColor={
                colors.textMuted
              }
              multiline
              textAlignVertical="top"
              maxLength={1000}
              style={styles.notesInput}
            />
            <Text style={styles.notesCount}>
              {notes.length}/1000
            </Text>
          </View>

          {saveError ? (
            <View style={styles.errorCard}>
              <Ionicons
                name="alert-circle-outline"
                size={19}
                color={colors.brandRed}
              />
              <Text style={styles.errorText}>
                {saveError}
              </Text>
            </View>
          ) : null}

          <Pressable
            onPress={handleFinish}
            disabled={
              isSaving ||
              rpe == null ||
              formAfterWorkout == null
            }
            style={({ pressed }) => [
              styles.finishButton,
              (isSaving ||
                rpe == null ||
                formAfterWorkout == null) &&
                styles.finishButtonDisabled,
              pressed &&
                !isSaving &&
                rpe != null &&
                formAfterWorkout != null &&
                styles.finishButtonPressed,
            ]}
          >
            <Text
              style={styles.finishButtonText}
            >
              {isSaving
                ? 'ENREGISTREMENT...'
                : rpe == null ||
                    formAfterWorkout == null
                  ? 'RENSEIGNE TES 2 JAUGES'
                  : 'ENREGISTRER MA SÉANCE'}
            </Text>
            <Ionicons
              name="checkmark-circle-outline"
              size={21}
              color={colors.brandWhite}
            />
          </Pressable>

          <Text style={styles.finishHint}>
            Les motifs d’adaptation sont facultatifs et ne bloquent jamais l’enregistrement.
          </Text>

          <View style={styles.bottomSpace} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function ProtocolResultCard({
  runtime,
  failedStage,
  wodExercises,
  protocolFeedback,
  onPartialRepsChange,
}) {
  const mechanic =
    normalizeMechanic(
      runtime?.mechanic
    );
  const variant =
    normalizeMechanic(
      runtime?.variant
    );
  const partial =
    protocolFeedback
      ?.partialRepsByExercise ??
    {};

  const title =
    mechanic ===
      'PROGRESSIVE_INTERVAL' &&
    variant === 'DEATH_BY'
      ? 'DEATH BY'
      : mechanic ===
            'PROGRESSIVE_INTERVAL' &&
          variant ===
            'DEATH_BY_COUPLET'
        ? 'DEATH BY COUPLET'
        : mechanic.replaceAll(
            '_',
            ' '
          );

  return (
    <View style={styles.protocolCard}>
      <View style={styles.protocolHeader}>
        <View style={styles.protocolIcon}>
          <Ionicons
            name="timer-outline"
            size={20}
            color={colors.brandWhite}
          />
        </View>

        <View style={styles.protocolHeaderMain}>
          <Text style={styles.protocolTitle}>
            {title}
          </Text>
          <Text style={styles.protocolMeta}>
            {Math.floor(
              numberOr(
                runtime.elapsedSeconds,
                0
              ) / 60
            )}
            :{String(
              Math.floor(
                numberOr(
                  runtime.elapsedSeconds,
                  0
                ) % 60
              )
            ).padStart(2, '0')}
            {runtime.completedRounds > 0
              ? ` · ${runtime.completedRounds} tour${runtime.completedRounds > 1 ? 's' : ''}`
              : ''}
          </Text>
        </View>

        <Ionicons
          name="checkmark-circle-outline"
          size={22}
          color={colors.primaryLight}
        />
      </View>

      {failedStage ? (
        <View style={styles.failureResult}>
          <Text style={styles.failureResultTitle}>
            ÉCHEC À L’ÉTAPE {failedStage}
          </Text>
          <Text style={styles.failureResultText}>
            {Math.max(
              0,
              failedStage - 1
            )}{' '}
            étape{failedStage - 1 > 1 ? 's' : ''} complète{failedStage - 1 > 1 ? 's' : ''} enregistrée{failedStage - 1 > 1 ? 's' : ''}. Si tu t’en souviens, indique les répétitions faites sur l’étape échouée.
          </Text>

          {wodExercises.map(
            (exercise) => {
              const target =
                failedStageTargetReps(
                  exercise,
                  failedStage
                );

              return (
                <View
                  key={exerciseKey(
                    exercise
                  )}
                  style={styles.partialRow}
                >
                  <View style={styles.partialMain}>
                    <Text style={styles.partialName}>
                      {String(
                        exercise.name
                      ).toUpperCase()}
                    </Text>
                    <Text style={styles.partialTarget}>
                      Prévu : {target} reps
                    </Text>
                  </View>

                  <View style={styles.partialInputWrap}>
                    <TextInput
                      value={String(
                        partial[
                          exercise.id
                        ] ?? ''
                      )}
                      onChangeText={(value) =>
                        onPartialRepsChange(
                          exercise,
                          value.replace(
                            /[^0-9]/g,
                            ''
                          )
                        )
                      }
                      placeholder="0"
                      placeholderTextColor={
                        colors.textMuted
                      }
                      keyboardType="number-pad"
                      style={styles.partialInput}
                    />
                    <Text style={styles.partialUnit}>
                      / {target}
                    </Text>
                  </View>
                </View>
              );
            }
          )}
        </View>
      ) : (
        <Text style={styles.protocolSavedText}>
          Résultat récupéré automatiquement par le player UGEROD.
        </Text>
      )}
    </View>
  );
}

function ExceptionCard({
  exercise,
  selectedReason,
  onReasonSelect,
}) {
  const status =
    executionStatus(exercise);
  const adapted =
    status === 'adapted';
  const reasons = adapted
    ? ADAPTED_REASONS
    : NOT_COMPLETED_REASONS;

  return (
    <View style={styles.exceptionCard}>
      <View style={styles.exceptionHeader}>
        <View
          style={[
            styles.exceptionStatus,
            adapted
              ? styles.exceptionStatusAdapted
              : styles.exceptionStatusNotCompleted,
          ]}
        >
          {adapted ? (
            <Text
              style={styles.exceptionAdaptedSymbol}
            >
              ≈
            </Text>
          ) : (
            <Ionicons
              name="close"
              size={15}
              color={colors.brandWhite}
            />
          )}
        </View>

        <View style={styles.exceptionMain}>
          <Text
            style={styles.exceptionName}
          >
            {String(
              exercise.name
            ).toUpperCase()}
          </Text>
          <Text
            style={styles.exceptionPrescription}
          >
            {exercise.prescription}
          </Text>
        </View>

        <Text
          style={[
            styles.exceptionBadge,
            adapted
              ? styles.exceptionBadgeAdapted
              : styles.exceptionBadgeNotCompleted,
          ]}
        >
          {adapted
            ? 'ADAPTÉ'
            : 'NON RÉALISÉ'}
        </Text>
      </View>

      {exercise.adaptationSource ===
      'swap' ? (
        <View style={styles.swapInfo}>
          <Ionicons
            name="swap-horizontal-outline"
            size={15}
            color={colors.primaryLight}
          />
          <Text style={styles.swapInfoText}>
            Exercice remplacé pendant la séance.
          </Text>
        </View>
      ) : null}

      <Text style={styles.reasonQuestion}>
        {adapted
          ? 'Pourquoi as-tu adapté cet exercice ?'
          : 'Pourquoi ne l’as-tu pas réalisé ?'}
      </Text>

      <Text style={styles.reasonOptional}>
        Facultatif
      </Text>

      <View style={styles.reasonChips}>
        {reasons.map((reason) => {
          const selected =
            selectedReason ===
            reason.code;

          return (
            <Pressable
              key={reason.code}
              onPress={() =>
                onReasonSelect(
                  reason.code
                )
              }
              style={[
                styles.reasonChip,
                selected &&
                  styles.reasonChipSelected,
              ]}
            >
              <Text
                style={[
                  styles.reasonChipText,
                  selected &&
                    styles.reasonChipTextSelected,
                ]}
              >
                {reason.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function SectionHeader({
  title,
  subtitle,
}) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>
        {title}
      </Text>
      <Text
        style={styles.sectionSubtitle}
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
  const hasValue = value != null;
  const highValue =
    hasValue && value >= 9;
  const lowValue =
    hasValue && value <= 3;

  let activeColor = hasValue
    ? colors.primary
    : colors.textMuted;

  if (lowValue) {
    activeColor = colors.brandRed;
  }

  if (
    highValue &&
    useRedAtHigh
  ) {
    activeColor = colors.brandRed;
  }

  return (
    <View style={styles.ratingCard}>
      <View style={styles.ratingTop}>
        <View>
          <Text
            style={[
              styles.ratingValue,
              { color: activeColor },
            ]}
          >
            {hasValue ? value : '—'}
            <Text
              style={styles.ratingTotal}
            >
              /10
            </Text>
          </Text>
          <Text
            style={[
              styles.ratingLabel,
              { color: activeColor },
            ]}
          >
            {label}
          </Text>
        </View>

        <Ionicons
          name="pulse-outline"
          size={27}
          color={activeColor}
        />
      </View>

      <View style={styles.ratingNumbers}>
        {Array.from(
          { length: 10 },
          (_, index) => {
            const number = index + 1;
            const selected =
              value === number;

            let selectedBackground =
              colors.primary;

            if (number <= 3) {
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

      <View style={styles.ratingLegend}>
        <Text
          style={styles.ratingLegendText}
        >
          {lowLabel}
        </Text>
        <Text
          style={styles.ratingLegendText}
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
    paddingTop: spacing.sm,
  },
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
    color: colors.primary,
  },
  brandIcon: {
    width: 45,
    height: 45,
  },
  heroCard: {
    marginTop: 10,
    borderRadius: 18,
    padding: 15,
    backgroundColor:
      colors.surface,
    borderWidth: 1,
    borderColor:
      colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  heroIcon: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor:
      colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroMain: {
    flex: 1,
  },
  heroTitle: {
    fontFamily:
      'BebasNeue_400Regular',
    fontSize: 27,
    lineHeight: 30,
    letterSpacing: 1.3,
    color:
      colors.textPrimary,
  },
  heroDescription: {
    fontFamily:
      'Oswald_400Regular',
    fontSize: 10,
    lineHeight: 15,
    letterSpacing: 0.3,
    color:
      colors.textSecondary,
    marginTop: 2,
  },
  learningCard: {
    marginTop: 14,
    borderRadius: 16,
    padding: 15,
    backgroundColor:
      'rgba(8,104,255,0.16)',
    borderWidth: 1,
    borderColor:
      'rgba(8,104,255,0.46)',
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 11,
  },
  learningIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor:
      colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  learningMain: {
    flex: 1,
  },
  learningTitle: {
    fontFamily:
      'Oswald_700Bold',
    fontSize: 12,
    lineHeight: 17,
    letterSpacing: 0.5,
    color:
      colors.textPrimary,
  },
  learningText: {
    fontFamily:
      'Oswald_400Regular',
    fontSize: 11,
    lineHeight: 17,
    color:
      colors.textSecondary,
    marginTop: 4,
  },
  sectionHeader: {
    marginTop: 27,
    marginBottom: 10,
  },
  sectionTitle: {
    fontFamily:
      'Oswald_700Bold',
    fontSize: 15,
    lineHeight: 19,
    letterSpacing: 0.65,
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
    lineHeight: 38,
  },
  ratingTotal: {
    fontSize: 18,
    color:
      colors.textMuted,
  },
  ratingLabel: {
    fontFamily:
      'Oswald_700Bold',
    fontSize: 10,
    letterSpacing: 0.65,
  },
  ratingNumbers: {
    marginTop: 16,
    flexDirection: 'row',
    justifyContent:
      'space-between',
    gap: 4,
  },
  ratingNumber: {
    flex: 1,
    aspectRatio: 1,
    maxWidth: 33,
    borderRadius: 8,
    borderWidth: 1,
    borderColor:
      colors.border,
    backgroundColor:
      'rgba(255,255,255,0.025)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ratingNumberText: {
    fontFamily:
      'Oswald_600SemiBold',
    fontSize: 11,
    color:
      colors.textSecondary,
  },
  ratingNumberTextSelected: {
    color:
      colors.brandWhite,
  },
  ratingLegend: {
    marginTop: 8,
    flexDirection: 'row',
    justifyContent:
      'space-between',
  },
  ratingLegendText: {
    fontFamily:
      'Oswald_600SemiBold',
    fontSize: 8,
    letterSpacing: 0.5,
    color:
      colors.textMuted,
  },
  protocolCard: {
    borderRadius: 16,
    padding: 14,
    backgroundColor:
      colors.surface,
    borderWidth: 1,
    borderColor:
      'rgba(8,104,255,0.28)',
  },
  protocolHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  protocolIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor:
      colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  protocolHeaderMain: {
    flex: 1,
  },
  protocolTitle: {
    fontFamily:
      'BebasNeue_400Regular',
    fontSize: 23,
    lineHeight: 26,
    letterSpacing: 1,
    color:
      colors.textPrimary,
  },
  protocolMeta: {
    fontFamily:
      'Oswald_400Regular',
    fontSize: 10,
    color:
      colors.textSecondary,
    marginTop: 1,
  },
  protocolSavedText: {
    marginTop: 12,
    paddingTop: 11,
    borderTopWidth: 1,
    borderTopColor:
      'rgba(255,255,255,0.05)',
    fontFamily:
      'Oswald_400Regular',
    fontSize: 10,
    lineHeight: 16,
    color:
      colors.textSecondary,
  },
  failureResult: {
    marginTop: 13,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor:
      'rgba(255,255,255,0.06)',
  },
  failureResultTitle: {
    fontFamily:
      'Oswald_700Bold',
    fontSize: 11,
    letterSpacing: 0.55,
    color:
      colors.brandRed,
  },
  failureResultText: {
    fontFamily:
      'Oswald_400Regular',
    fontSize: 10,
    lineHeight: 16,
    color:
      colors.textSecondary,
    marginTop: 4,
  },
  partialRow: {
    minHeight: 58,
    marginTop: 9,
    borderRadius: 12,
    paddingHorizontal: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor:
      'rgba(255,255,255,0.03)',
    borderWidth: 1,
    borderColor:
      'rgba(255,255,255,0.06)',
  },
  partialMain: {
    flex: 1,
  },
  partialName: {
    fontFamily:
      'Oswald_600SemiBold',
    fontSize: 10,
    color:
      colors.textPrimary,
  },
  partialTarget: {
    fontFamily:
      'Oswald_400Regular',
    fontSize: 9,
    color:
      colors.textMuted,
    marginTop: 2,
  },
  partialInputWrap: {
    minWidth: 86,
    height: 38,
    borderRadius: 10,
    borderWidth: 1,
    borderColor:
      colors.border,
    backgroundColor:
      'rgba(255,255,255,0.025)',
    paddingHorizontal: 9,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  partialInput: {
    minWidth: 28,
    paddingVertical: 0,
    textAlign: 'right',
    fontFamily:
      'Oswald_700Bold',
    fontSize: 13,
    color:
      colors.textPrimary,
  },
  partialUnit: {
    marginLeft: 3,
    fontFamily:
      'Oswald_400Regular',
    fontSize: 10,
    color:
      colors.textMuted,
  },

  exceptionList: {
    gap: 10,
  },
  exceptionCard: {
    borderRadius: 16,
    padding: 14,
    backgroundColor:
      colors.surface,
    borderWidth: 1,
    borderColor:
      colors.border,
  },
  exceptionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  exceptionStatus: {
    width: 31,
    height: 31,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  exceptionStatusAdapted: {
    backgroundColor:
      'rgba(245,166,35,0.92)',
  },
  exceptionStatusNotCompleted: {
    backgroundColor:
      colors.brandRed,
  },
  exceptionAdaptedSymbol: {
    fontFamily:
      'Oswald_700Bold',
    fontSize: 17,
    color:
      colors.brandWhite,
  },
  exceptionMain: {
    flex: 1,
  },
  exceptionName: {
    fontFamily:
      'Oswald_700Bold',
    fontSize: 12,
    lineHeight: 16,
    color:
      colors.textPrimary,
  },
  exceptionPrescription: {
    fontFamily:
      'Oswald_400Regular',
    fontSize: 10,
    lineHeight: 14,
    color:
      colors.textSecondary,
    marginTop: 2,
  },
  exceptionBadge: {
    fontFamily:
      'Oswald_700Bold',
    fontSize: 8,
    letterSpacing: 0.5,
  },
  exceptionBadgeAdapted: {
    color:
      '#F5A623',
  },
  exceptionBadgeNotCompleted: {
    color:
      colors.brandRed,
  },
  swapInfo: {
    marginTop: 11,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor:
      'rgba(255,255,255,0.05)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  swapInfoText: {
    fontFamily:
      'Oswald_400Regular',
    fontSize: 10,
    color:
      colors.primaryLight,
  },
  reasonQuestion: {
    marginTop: 13,
    fontFamily:
      'Oswald_600SemiBold',
    fontSize: 11,
    lineHeight: 16,
    color:
      colors.textPrimary,
  },
  reasonOptional: {
    fontFamily:
      'Oswald_400Regular',
    fontSize: 9,
    color:
      colors.textMuted,
    marginTop: 1,
  },
  reasonChips: {
    marginTop: 9,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
  },
  reasonChip: {
    minHeight: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor:
      'rgba(255,255,255,0.09)',
    backgroundColor:
      'rgba(255,255,255,0.03)',
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reasonChipSelected: {
    borderColor:
      'rgba(8,104,255,0.52)',
    backgroundColor:
      'rgba(8,104,255,0.15)',
  },
  reasonChipText: {
    fontFamily:
      'Oswald_500Medium',
    fontSize: 9,
    color:
      colors.textSecondary,
  },
  reasonChipTextSelected: {
    color:
      colors.primaryLight,
  },
  loadsCard: {
    borderRadius: 16,
    backgroundColor:
      colors.surface,
    borderWidth: 1,
    borderColor:
      colors.border,
    overflow: 'hidden',
  },
  loadRow: {
    minHeight: 72,
    padding: 13,
    gap: 10,
  },
  loadRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor:
      'rgba(255,255,255,0.05)',
  },
  loadMain: {
    flex: 1,
  },
  loadName: {
    fontFamily:
      'Oswald_600SemiBold',
    fontSize: 11,
    color:
      colors.textPrimary,
  },
  loadPrescription: {
    fontFamily:
      'Oswald_400Regular',
    fontSize: 10,
    color:
      colors.textMuted,
    marginTop: 2,
  },
  loadInputWrap: {
    minHeight: 42,
    borderRadius: 11,
    borderWidth: 1,
    borderColor:
      colors.border,
    backgroundColor:
      'rgba(255,255,255,0.025)',
    paddingHorizontal: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  loadInput: {
    flex: 1,
    fontFamily:
      'Oswald_400Regular',
    fontSize: 12,
    color:
      colors.textPrimary,
    paddingVertical: 0,
  },
  notesCard: {
    borderRadius: 16,
    padding: 13,
    backgroundColor:
      colors.surface,
    borderWidth: 1,
    borderColor:
      colors.border,
  },
  notesInput: {
    minHeight: 92,
    fontFamily:
      'Oswald_400Regular',
    fontSize: 12,
    lineHeight: 18,
    color:
      colors.textPrimary,
    padding: 0,
  },
  notesCount: {
    marginTop: 8,
    textAlign: 'right',
    fontFamily:
      'Oswald_400Regular',
    fontSize: 9,
    color:
      colors.textMuted,
  },
  errorCard: {
    marginTop: 18,
    borderRadius: 13,
    padding: 12,
    borderWidth: 1,
    borderColor:
      'rgba(227,27,35,0.32)',
    backgroundColor:
      'rgba(227,27,35,0.08)',
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  errorText: {
    flex: 1,
    fontFamily:
      'Oswald_400Regular',
    fontSize: 11,
    lineHeight: 16,
    color:
      colors.brandRed,
  },
  finishButton: {
    minHeight: 58,
    marginTop: 22,
    borderRadius: 14,
    backgroundColor:
      colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  finishButtonDisabled: {
    opacity: 0.38,
  },
  finishButtonPressed: {
    transform: [
      { scale: 0.985 },
    ],
  },
  finishButtonText: {
    fontFamily:
      'BebasNeue_400Regular',
    fontSize: 20,
    letterSpacing: 1,
    color:
      colors.brandWhite,
  },
  finishHint: {
    marginTop: 9,
    textAlign: 'center',
    fontFamily:
      'Oswald_400Regular',
    fontSize: 10,
    lineHeight: 15,
    color:
      colors.textMuted,
  },
  bottomSpace: {
    height: 38,
  },
  pressed: {
    opacity: 0.66,
  },
});