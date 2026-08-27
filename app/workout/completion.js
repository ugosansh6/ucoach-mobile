import { useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import CompletionCore from './completion-core';
import {
  colors,
  spacing,
} from '../../src/constants';
import {
  useWorkout,
} from '../../src/contexts/WorkoutContext';

const NOR004_FIELDS = {
  EX152: ['reps', 'time', 'box_height'],
  EX155: ['distance'],
  EX507: ['distance', 'time', 'load'],
  EX508: ['distance', 'time', 'load'],
  EX509: ['distance', 'time', 'load'],
  EX510: ['reps', 'load'],
  EX513: ['reps', 'load'],
  EX514: ['reps', 'load'],
  EX515: ['reps', 'load'],
  EX516: ['distance', 'time', 'load'],
};

const FIELD_META = {
  reps: {
    label: 'RÉPÉTITIONS RÉELLES',
    placeholder: 'Ex : 12',
    unit: 'reps',
    integer: true,
  },
  time: {
    label: 'TEMPS RÉEL',
    placeholder: 'Ex : 31',
    unit: 'sec',
    integer: true,
  },
  distance: {
    label: 'DISTANCE RÉELLE',
    placeholder: 'Ex : 40',
    unit: 'm',
    integer: false,
  },
  load: {
    label: 'CHARGE UTILISÉE',
    placeholder: 'Ex : 45 kg',
    unit: 'kg',
    integer: false,
  },
  box_height: {
    label: 'HAUTEUR DE BOX',
    placeholder: 'Ex : 60',
    unit: 'cm',
    integer: false,
  },
};

function exerciseKey(exercise) {
  return (
    exercise?.sessionExerciseId ??
    exercise?.id
  );
}

function isPerformed(exercise) {
  return ![
    'not_completed',
    'skipped',
  ].includes(exercise?.status);
}

function normalizeDecimal(value) {
  const normalized = String(value ?? '')
    .trim()
    .replace(',', '.');

  if (!normalized) {
    return null;
  }

  const numeric = Number(normalized);
  return Number.isFinite(numeric) && numeric > 0
    ? numeric
    : null;
}

function formatInputValue(value) {
  if (value == null || value === '') {
    return '';
  }

  return String(value);
}

export default function CompletionScreen() {
  const {
    workout,
    completion,
    updateWorkout,
    setExerciseLoad,
  } = useWorkout();

  const trackingExercises = useMemo(
    () =>
      (workout.exercises ?? []).filter(
        (exercise) =>
          Boolean(NOR004_FIELDS[exercise.id]) &&
          isPerformed(exercise)
      ),
    [workout.exercises]
  );

  const [trackingOpen, setTrackingOpen] =
    useState(
      () => trackingExercises.length > 0
    );

  function replaceExercise(target, patch) {
    const key = exerciseKey(target);

    updateWorkout({
      exercises: (workout.exercises ?? []).map(
        (exercise) =>
          exerciseKey(exercise) === key
            ? {
                ...exercise,
                ...patch,
              }
            : exercise
      ),
    });
  }

  function withNor004Actual(
    exercise,
    extra = {}
  ) {
    return {
      ...(exercise.performanceActualJson ??
        exercise.performance_actual_json ??
        {}),
      provenance_class: 'USER_EXPLICIT',
      nor004_tracking_contract:
        'nor004-tracking-v1',
      ...extra,
    };
  }

  function updateMetric(
    exercise,
    field,
    rawValue
  ) {
    if (field === 'load') {
      setExerciseLoad(
        exerciseKey(exercise),
        rawValue
      );
      replaceExercise(exercise, {
        performanceActualJson:
          withNor004Actual(exercise),
      });
      return;
    }

    if (
      field === 'reps' ||
      field === 'time'
    ) {
      const digits = String(rawValue ?? '')
        .replace(/[^0-9]/g, '');
      const numeric = digits
        ? Number(digits)
        : null;

      replaceExercise(exercise, {
        ...(field === 'reps'
          ? { repsCompleted: numeric }
          : { durationSeconds: numeric }),
        performanceActualJson:
          withNor004Actual(exercise),
      });
      return;
    }

    const numeric = normalizeDecimal(rawValue);

    if (field === 'distance') {
      replaceExercise(exercise, {
        distanceMeters: numeric,
        performanceActualJson:
          withNor004Actual(exercise),
      });
      return;
    }

    if (field === 'box_height') {
      replaceExercise(exercise, {
        performanceActualJson:
          withNor004Actual(exercise, {
            box_height_cm: numeric,
          }),
      });
    }
  }

  function readMetric(exercise, field) {
    if (field === 'load') {
      const key = exerciseKey(exercise);
      return (
        completion.loads?.[key] ??
        completion.loads?.[exercise.id] ??
        ''
      );
    }

    if (field === 'reps') {
      return (
        exercise.repsCompleted ??
        exercise.reps_completed ??
        ''
      );
    }

    if (field === 'time') {
      return (
        exercise.durationSeconds ??
        exercise.duration_seconds ??
        ''
      );
    }

    if (field === 'distance') {
      return (
        exercise.distanceMeters ??
        exercise.distance_meters ??
        ''
      );
    }

    if (field === 'box_height') {
      return (
        exercise.performanceActualJson
          ?.box_height_cm ??
        exercise.performance_actual_json
          ?.box_height_cm ??
        ''
      );
    }

    return '';
  }

  return (
    <View style={styles.screen}>
      <CompletionCore />

      <Modal
        visible={trackingOpen}
        transparent
        animationType="slide"
        onRequestClose={() =>
          setTrackingOpen(false)
        }
      >
        <SafeAreaView style={styles.modalRoot}>
          <Pressable
            style={styles.backdrop}
            onPress={() =>
              setTrackingOpen(false)
            }
          />

          <View style={styles.sheet}>
            <View style={styles.handle} />

            <View style={styles.sheetHeader}>
              <View style={styles.sheetIcon}>
                <Ionicons
                  name="analytics-outline"
                  size={20}
                  color={colors.brandWhite}
                />
              </View>

              <View style={styles.sheetHeaderText}>
                <Text style={styles.sheetEyebrow}>
                  MESURES UTILES
                </Text>
                <Text style={styles.sheetTitle}>
                  GARDE UNE MESURE EXPLOITABLE
                </Text>
              </View>

              <Pressable
                onPress={() =>
                  setTrackingOpen(false)
                }
                hitSlop={10}
                style={styles.closeButton}
              >
                <Ionicons
                  name="close"
                  size={20}
                  color={colors.textSecondary}
                />
              </Pressable>
            </View>

            <Text style={styles.sheetIntro}>
              Optionnel. Renseigne seulement ce que tu connais réellement. UGEROD ne déduit jamais une charge, une hauteur ou une performance manquante.
            </Text>

            <ScrollView
              style={styles.scroll}
              contentContainerStyle={styles.scrollContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {trackingExercises.map(
                (exercise) => (
                  <View
                    key={exerciseKey(exercise)}
                    style={styles.exerciseCard}
                  >
                    <Text style={styles.exerciseName}>
                      {String(
                        exercise.name ??
                          exercise.id
                      ).toUpperCase()}
                    </Text>
                    <Text style={styles.exerciseHint}>
                      {exercise.prescription ??
                        'Résultat réel'}
                    </Text>

                    <View style={styles.fieldGrid}>
                      {NOR004_FIELDS[
                        exercise.id
                      ].map((field) => {
                        const meta =
                          FIELD_META[field];
                        const value =
                          readMetric(
                            exercise,
                            field
                          );

                        return (
                          <View
                            key={field}
                            style={styles.field}
                          >
                            <Text
                              style={styles.fieldLabel}
                            >
                              {meta.label}
                            </Text>

                            <View
                              style={styles.inputWrap}
                            >
                              <TextInput
                                value={formatInputValue(
                                  value
                                )}
                                onChangeText={(next) =>
                                  updateMetric(
                                    exercise,
                                    field,
                                    next
                                  )
                                }
                                keyboardType={
                                  meta.integer
                                    ? 'number-pad'
                                    : 'decimal-pad'
                                }
                                placeholder={
                                  meta.placeholder
                                }
                                placeholderTextColor={
                                  colors.textMuted
                                }
                                style={styles.input}
                              />
                              <Text style={styles.unit}>
                                {meta.unit}
                              </Text>
                            </View>
                          </View>
                        );
                      })}
                    </View>
                  </View>
                )
              )}
            </ScrollView>

            <Pressable
              onPress={() =>
                setTrackingOpen(false)
              }
              style={({ pressed }) => [
                styles.continueButton,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.continueText}>
                CONTINUER
              </Text>
              <Ionicons
                name="arrow-forward"
                size={18}
                color={colors.brandWhite}
              />
            </Pressable>

            <Pressable
              onPress={() =>
                setTrackingOpen(false)
              }
              style={({ pressed }) => [
                styles.skipButton,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.skipText}>
                JE NE SAIS PAS / PASSER
              </Text>
            </Pressable>
          </View>
        </SafeAreaView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  modalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.72)',
  },
  sheet: {
    maxHeight: '82%',
    paddingHorizontal: spacing.xl,
    paddingTop: 9,
    paddingBottom: 14,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  handle: {
    width: 42,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    backgroundColor: colors.border,
    marginBottom: 14,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },
  sheetIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  sheetHeaderText: {
    flex: 1,
  },
  sheetEyebrow: {
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 9,
    letterSpacing: 0.8,
    color: colors.primaryLight,
  },
  sheetTitle: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 24,
    lineHeight: 27,
    letterSpacing: 1,
    color: colors.textPrimary,
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sheetIntro: {
    marginTop: 11,
    fontFamily: 'Oswald_400Regular',
    fontSize: 11,
    lineHeight: 17,
    color: colors.textSecondary,
  },
  scroll: {
    marginTop: 13,
  },
  scrollContent: {
    gap: 10,
    paddingBottom: 8,
  },
  exerciseCard: {
    borderRadius: 15,
    padding: 13,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  exerciseName: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 12,
    lineHeight: 16,
    color: colors.textPrimary,
  },
  exerciseHint: {
    marginTop: 2,
    fontFamily: 'Oswald_400Regular',
    fontSize: 10,
    lineHeight: 14,
    color: colors.textMuted,
  },
  fieldGrid: {
    marginTop: 11,
    gap: 9,
  },
  field: {
    gap: 5,
  },
  fieldLabel: {
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 9,
    letterSpacing: 0.45,
    color: colors.textSecondary,
  },
  inputWrap: {
    minHeight: 42,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: 'rgba(255,255,255,0.025)',
    paddingHorizontal: 11,
    flexDirection: 'row',
    alignItems: 'center',
  },
  input: {
    flex: 1,
    paddingVertical: 0,
    fontFamily: 'Oswald_500Medium',
    fontSize: 13,
    color: colors.textPrimary,
  },
  unit: {
    marginLeft: 8,
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 10,
    color: colors.textMuted,
  },
  continueButton: {
    minHeight: 52,
    marginTop: 12,
    borderRadius: 13,
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  continueText: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 19,
    letterSpacing: 1,
    color: colors.brandWhite,
  },
  skipButton: {
    minHeight: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  skipText: {
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 9,
    letterSpacing: 0.45,
    color: colors.textMuted,
  },
  pressed: {
    opacity: 0.68,
  },
});