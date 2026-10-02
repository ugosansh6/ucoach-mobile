import { useMemo, useState } from 'react';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
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

import { useUgerodTheme } from '../../src/contexts/UgerodThemeContext';
import { useWorkout } from '../../src/contexts/WorkoutContext';
import { completeWorkoutSession } from '../../src/services/workoutService';
import { buildWodProtocolCompletion } from '../../src/services/wodProtocolOutcome';

const darkBrandIcon = require('../../assets/branding/ugerod-icon.png');
const lightBrandIcon = require('../../assets/branding/LOGO VERSION NOIR.png');

const MANROPE = {
  regular: 'Manrope_400Regular',
  medium: 'Manrope_500Medium',
  semiBold: 'Manrope_600SemiBold',
  bold: 'Manrope_700Bold',
  extraBold: 'Manrope_800ExtraBold',
};

const DIFFICULTY_OPTIONS = [
  { value: 2, label: 'Trop facile' },
  { value: 4, label: 'Plutôt facile' },
  { value: 6, label: 'Bien dosée' },
  { value: 8, label: 'Difficile' },
  { value: 10, label: 'Trop difficile' },
];

const FEELING_OPTIONS = [
  { value: 2, label: 'Épuisé' },
  { value: 4, label: 'Fatigué' },
  { value: 6, label: 'Bien' },
  { value: 8, label: 'En forme' },
  { value: 10, label: 'Très en forme' },
];

const ADAPTED_REASONS = [
  { code: 'TECHNIQUE_DIFFICULTY', label: 'Mouvement difficile' },
  { code: 'LOAD_TOO_HEAVY', label: 'Trop difficile' },
  { code: 'FATIGUE', label: 'Fatigue' },
  { code: 'PAIN_DISCOMFORT', label: 'Gêne' },
  { code: 'EQUIPMENT', label: 'Matériel' },
  { code: 'TIME', label: 'Manque de temps' },
  { code: 'ENVIRONMENT_MISMATCH', label: 'Environnement inadapté' },
  { code: 'OTHER', label: 'Autre' },
];

const NOT_COMPLETED_REASONS = [
  { code: 'MOVEMENT_FAILURE', label: 'Trop difficile' },
  { code: 'FATIGUE', label: 'Fatigue' },
  { code: 'PAIN_DISCOMFORT', label: 'Gêne' },
  { code: 'TIME', label: 'Manque de temps' },
  { code: 'MOTIVATION', label: 'Motivation' },
  { code: 'EQUIPMENT', label: 'Matériel' },
  { code: 'ENVIRONMENT_MISMATCH', label: 'Environnement inadapté' },
  { code: 'OTHER', label: 'Autre' },
];

const ENVIRONMENT_LABELS = {
  HOME: 'Maison',
  BOX: 'Box',
  GYM: 'Salle',
  OUTDOOR: 'Extérieur',
};

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
  reps: { label: 'Répétitions', placeholder: '12', unit: 'reps', integer: true },
  time: { label: 'Temps', placeholder: '31', unit: 'sec', integer: true },
  distance: { label: 'Distance', placeholder: '400', unit: 'm', integer: false },
  load: { label: 'Charge', placeholder: '45', unit: 'kg', integer: false },
  box_height: { label: 'Hauteur', placeholder: '60', unit: 'cm', integer: false },
};

const FALLBACK_EXERCISES = [
  {
    id: 'air-squat',
    sessionExerciseId: 'dev-air-squat',
    name: 'Air Squat',
    prescription: '12 reps',
    status: 'completed',
    trackingType: 'bodyweight',
  },
  {
    id: 'goblet-squat',
    sessionExerciseId: 'dev-goblet-squat',
    name: 'Goblet Squat',
    prescription: '8 reps',
    status: 'adapted',
    adaptationSource: 'manual',
    trackingType: 'load',
  },
  {
    id: 'burpee',
    sessionExerciseId: 'dev-burpee',
    name: 'Burpee',
    prescription: '8 reps',
    status: 'not_completed',
    trackingType: 'bodyweight',
  },
];

function exerciseKey(exercise) {
  return exercise?.sessionExerciseId ?? exercise?.session_exercise_id ?? exercise?.id;
}

function executionStatus(exercise) {
  const raw = String(
    exercise?.userExecutionStatus ??
      exercise?.user_execution_status ??
      exercise?.status ??
      ''
  ).toLowerCase();

  if (raw === 'completed') return 'completed';
  if (raw === 'adapted') return 'adapted';
  if (raw === 'skipped' || raw === 'not_completed') return 'not_completed';
  return raw || 'not_completed';
}

function normalizeMechanic(value) {
  return String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/[\s/-]+/g, '_');
}

function numberOr(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeDecimal(value) {
  const normalized = String(value ?? '').trim().replace(',', '.');
  if (!normalized) return null;
  const numeric = Number(normalized);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
}

function formatInputValue(value) {
  if (value == null || value === '') return '';
  return String(value);
}

function actualDurationMinutes(workout) {
  const start = workout?.startedAt ? new Date(workout.startedAt).getTime() : NaN;
  if (Number.isFinite(start)) {
    const minutes = Math.max(1, Math.round((Date.now() - start) / 60000));
    if (minutes < 360) return minutes;
  }
  return workout?.plannedDuration ?? 45;
}

function wodResultLine(runtime) {
  if (!runtime?.started) return null;

  const elapsed = Number(runtime?.elapsedSeconds ?? 0);
  const rounds = Number(runtime?.completedRounds ?? 0);
  const reps = Number(runtime?.reps ?? runtime?.repsCompleted ?? runtime?.totalReps ?? 0);

  if (rounds > 0 && reps > 0) return `${rounds} rounds + ${reps} reps`;
  if (rounds > 0) return `${rounds} round${rounds > 1 ? 's' : ''}`;
  if (elapsed > 0) {
    return `${Math.floor(elapsed / 60)}:${String(Math.floor(elapsed % 60)).padStart(2, '0')}`;
  }
  return null;
}

function failedStageTargetReps(exercise, failedStage) {
  const prescription = exercise?.prescriptionJson ?? exercise?.prescription_json ?? {};
  const overlay = prescription.mechanic_overlay ?? {};
  const start = numberOr(
    overlay.start_reps ??
      overlay.base_reps ??
      prescription.execution_target_reps ??
      prescription.reps_min,
    0
  );
  const increment = numberOr(overlay.increment_reps, 0);
  return Math.max(0, Math.round(start + Math.max(0, failedStage - 1) * increment));
}

function missingMetricFields(exercise, loads) {
  const configured = NOR004_FIELDS[exercise?.id] ?? [];
  const key = exerciseKey(exercise);

  return configured.filter((field) => {
    if (field === 'load') {
      const value = loads?.[key] ?? loads?.[exercise?.id];
      return value == null || String(value).trim() === '';
    }
    if (field === 'reps') {
      return exercise?.repsCompleted == null && exercise?.reps_completed == null;
    }
    if (field === 'time') {
      return exercise?.durationSeconds == null && exercise?.duration_seconds == null;
    }
    if (field === 'distance') {
      return exercise?.distanceMeters == null && exercise?.distance_meters == null;
    }
    if (field === 'box_height') {
      return (
        exercise?.performanceActualJson?.box_height_cm == null &&
        exercise?.performance_actual_json?.box_height_cm == null
      );
    }
    return false;
  });
}

function ChoicePills({ title, options, value, onChange, styles }) {
  return (
    <View style={styles.questionBlock}>
      <Text style={styles.questionTitle}>{title}</Text>
      <View style={styles.choiceWrap}>
        {options.map((option) => {
          const active = value === option.value;
          return (
            <Pressable
              key={option.value}
              onPress={() => onChange(option.value)}
              style={({ pressed }) => [
                styles.choicePill,
                active && styles.choicePillSelected,
                pressed && styles.pressed,
              ]}
            >
              <Text style={[styles.choiceText, active && styles.choiceTextSelected]}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function AdjustmentRow({ exercise, selectedReason, onSelect, expanded, onToggle, styles }) {
  const status = executionStatus(exercise);
  const adapted = status === 'adapted';
  const reasons = adapted ? ADAPTED_REASONS : NOT_COMPLETED_REASONS;
  const selectedLabel = reasons.find((reason) => reason.code === selectedReason)?.label ?? null;

  return (
    <View style={styles.adjustmentItem}>
      <Pressable
        onPress={onToggle}
        style={({ pressed }) => [styles.adjustmentHeader, pressed && styles.pressed]}
      >
        <View style={styles.adjustmentMain}>
          <Text style={styles.adjustmentName}>{exercise?.name ?? exercise?.id}</Text>
          <Text style={styles.adjustmentMeta}>
            {adapted ? 'Adapté' : 'Non réalisé'}
            {selectedLabel ? ` · ${selectedLabel}` : ''}
          </Text>
        </View>
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={19}
          style={styles.adjustmentChevron}
        />
      </Pressable>

      {expanded ? (
        <View style={styles.adjustmentBody}>
          <Text style={styles.adjustmentQuestion}>Pourquoi ?</Text>
          <View style={styles.reasonWrap}>
            {reasons.map((reason) => {
              const active = selectedReason === reason.code;
              return (
                <Pressable
                  key={reason.code}
                  onPress={() => onSelect(active ? null : reason.code)}
                  style={({ pressed }) => [
                    styles.reasonPill,
                    active && styles.reasonPillSelected,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={[styles.reasonText, active && styles.reasonTextSelected]}>
                    {reason.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}
    </View>
  );
}

export default function CompletionScreen() {
  const { colors, isDark } = useUgerodTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const brandIcon = isDark ? darkBrandIcon : lightBrandIcon;

  const {
    workout,
    completion,
    updateWorkout,
    updateCompletion,
    setExerciseLoad,
  } = useWorkout();

  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [expandedAdjustment, setExpandedAdjustment] = useState(null);
  const [metricsOpen, setMetricsOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(Boolean(completion?.notes));

  const sourceExercises = workout.exercises?.length > 0 ? workout.exercises : FALLBACK_EXERCISES;
  const performedExercises = sourceExercises.filter(
    (exercise) => executionStatus(exercise) !== 'not_completed'
  );
  const exceptionExercises = sourceExercises.filter(
    (exercise) => executionStatus(exercise) !== 'completed'
  );

  const difficulty = completion.rpe ?? null;
  const formAfterWorkout = completion.formAfter ?? null;
  const notes = completion.notes ?? '';
  const loads = completion.loads ?? {};
  const exerciseFeedback = completion.exerciseFeedback ?? {};
  const protocolFeedback = completion.protocolFeedback ?? {};
  const wodRuntime = workout.wodRuntime ?? null;

  const environmentCode =
    workout?.preparationSnapshot?.environmentCode ??
    workout?.meta?.environment_code ??
    workout?.meta?.planned_environment_code ??
    'HOME';

  const duration = actualDurationMinutes(workout);
  const wodResult = wodResultLine(wodRuntime);
  const completedCount = sourceExercises.filter(
    (exercise) => executionStatus(exercise) === 'completed'
  ).length;
  const adaptedCount = sourceExercises.filter(
    (exercise) => executionStatus(exercise) === 'adapted'
  ).length;

  const missingMetrics = performedExercises.flatMap((exercise) =>
    missingMetricFields(exercise, loads).map((field) => ({ exercise, field }))
  );

  const wodExercises = sourceExercises.filter(
    (exercise) => String(exercise?.blockKey ?? exercise?.block ?? '').toLowerCase() === 'wod'
  );
  const progressiveFailure =
    normalizeMechanic(wodRuntime?.mechanic) === 'PROGRESSIVE_INTERVAL' &&
    wodRuntime?.finishReason === 'observed_failure';
  const failedStage = progressiveFailure
    ? Math.max(1, numberOr(wodRuntime?.currentStage, 1))
    : null;

  function setReason(exercise, reasonCode) {
    const key = exerciseKey(exercise);
    const current = exerciseFeedback[key] ?? {};
    updateCompletion({
      exerciseFeedback: {
        ...exerciseFeedback,
        [key]: { ...current, reasonCode },
      },
    });
  }

  function updatePartialReps(exercise, value) {
    updateCompletion({
      protocolFeedback: {
        ...protocolFeedback,
        partialRepsByExercise: {
          ...(protocolFeedback.partialRepsByExercise ?? {}),
          [exercise.id]: value,
        },
      },
    });
  }

  function replaceExercise(target, patch) {
    const key = exerciseKey(target);
    updateWorkout({
      exercises: (workout.exercises ?? []).map((exercise) =>
        exerciseKey(exercise) === key ? { ...exercise, ...patch } : exercise
      ),
    });
  }

  function withActual(exercise, extra = {}) {
    return {
      ...(exercise.performanceActualJson ?? exercise.performance_actual_json ?? {}),
      provenance_class: 'USER_EXPLICIT',
      completion_capture_contract: 'completion-v2-simple',
      ...extra,
    };
  }

  function readMetric(exercise, field) {
    const key = exerciseKey(exercise);
    if (field === 'load') return loads[key] ?? loads[exercise.id] ?? '';
    if (field === 'reps') return exercise.repsCompleted ?? exercise.reps_completed ?? '';
    if (field === 'time') return exercise.durationSeconds ?? exercise.duration_seconds ?? '';
    if (field === 'distance') return exercise.distanceMeters ?? exercise.distance_meters ?? '';
    if (field === 'box_height') {
      return (
        exercise.performanceActualJson?.box_height_cm ??
        exercise.performance_actual_json?.box_height_cm ??
        ''
      );
    }
    return '';
  }

  function updateMetric(exercise, field, rawValue) {
    if (field === 'load') {
      setExerciseLoad(exerciseKey(exercise), rawValue);
      replaceExercise(exercise, { performanceActualJson: withActual(exercise) });
      return;
    }

    if (field === 'reps' || field === 'time') {
      const digits = String(rawValue ?? '').replace(/[^0-9]/g, '');
      const numeric = digits ? Number(digits) : null;
      replaceExercise(exercise, {
        ...(field === 'reps'
          ? { repsCompleted: numeric }
          : { durationSeconds: numeric }),
        performanceActualJson: withActual(exercise),
      });
      return;
    }

    const numeric = normalizeDecimal(rawValue);
    if (field === 'distance') {
      replaceExercise(exercise, {
        distanceMeters: numeric,
        performanceActualJson: withActual(exercise),
      });
      return;
    }

    if (field === 'box_height') {
      replaceExercise(exercise, {
        performanceActualJson: withActual(exercise, { box_height_cm: numeric }),
      });
    }
  }

  async function handleFinish() {
    if (isSaving) return;

    setSaveError('');
    setIsSaving(true);

    try {
      if (!workout.sessionId) throw new Error('Aucune session backend active.');
      if (difficulty == null) throw new Error('Indique comment tu as trouvé la séance.');
      if (formAfterWorkout == null) throw new Error('Indique comment tu te sens maintenant.');

      const { exercises: completionExercises, outcome: protocolOutcome } =
        buildWodProtocolCompletion({
          workout,
          exercises: sourceExercises,
          protocolFeedback,
        });

      await completeWorkoutSession({
        sessionId: workout.sessionId,
        exercises: completionExercises,
        formAfter: formAfterWorkout,
        rpe: difficulty,
        notes,
        loads,
        exerciseFeedback,
        protocolOutcome,
      });

      updateWorkout({
        exercises: completionExercises,
        status: 'completed',
        completedAt: new Date().toISOString(),
      });

      router.replace({
        pathname: '/workout/debrief',
        params: { sessionId: workout.sessionId },
      });
    } catch (error) {
      setSaveError(error?.message ?? "Impossible d'enregistrer la séance.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.header}>
            <Pressable onPress={() => router.back()} hitSlop={12} style={styles.headerButton}>
              <Ionicons name="arrow-back" size={21} color={colors.text} />
            </Pressable>
            <View style={styles.headerCopy}>
              <Text style={styles.eyebrow}>Fin de séance</Text>
              <Text style={styles.title}>
                Séance terminée<Text style={styles.dot}>.</Text>
              </Text>
            </View>
            <Image source={brandIcon} style={styles.brandIcon} resizeMode="contain" />
          </View>

          <View style={styles.recapCard}>
            <View style={styles.recapDuration}>
              <Text style={styles.recapDurationValue}>{duration}</Text>
              <Text style={styles.recapDurationUnit}>MIN</Text>
            </View>
            <View style={styles.recapDivider} />
            <View style={styles.recapMain}>
              <Text style={styles.recapEnvironment}>
                {ENVIRONMENT_LABELS[environmentCode] ?? environmentCode}
              </Text>
              <Text style={styles.recapDetail}>
                {wodResult
                  ? `WOD · ${wodResult}`
                  : `${completedCount} terminé${completedCount > 1 ? 's' : ''}${adaptedCount > 0 ? ` · ${adaptedCount} adapté${adaptedCount > 1 ? 's' : ''}` : ''}`}
              </Text>
            </View>
            <View style={styles.recapCheck}>
              <Ionicons name="checkmark" size={17} color={colors.textOnAccent} />
            </View>
          </View>

          <ChoicePills
            title="La séance était…"
            options={DIFFICULTY_OPTIONS}
            value={difficulty}
            onChange={(value) => updateCompletion({ rpe: value })}
            styles={styles}
          />

          <ChoicePills
            title="Tu te sens maintenant…"
            options={FEELING_OPTIONS}
            value={formAfterWorkout}
            onChange={(value) => updateCompletion({ formAfter: value })}
            styles={styles}
          />

          {failedStage ? (
            <View style={styles.conditionalCard}>
              <View style={styles.conditionalHeader}>
                <View style={styles.conditionalIcon}>
                  <Ionicons name="timer-outline" size={18} color={colors.accent} />
                </View>
                <View style={styles.conditionalMain}>
                  <Text style={styles.conditionalTitle}>Dernière étape du WOD</Text>
                  <Text style={styles.conditionalText}>Ajoute les reps faites si tu t’en souviens.</Text>
                </View>
              </View>

              {wodExercises.map((exercise) => {
                const target = failedStageTargetReps(exercise, failedStage);
                const partial = protocolFeedback?.partialRepsByExercise ?? {};
                return (
                  <View key={exerciseKey(exercise)} style={styles.partialRow}>
                    <View style={styles.partialMain}>
                      <Text style={styles.partialName}>{exercise?.name}</Text>
                      <Text style={styles.partialTarget}>Prévu : {target} reps</Text>
                    </View>
                    <View style={styles.partialInputWrap}>
                      <TextInput
                        value={String(partial[exercise.id] ?? '')}
                        onChangeText={(value) =>
                          updatePartialReps(exercise, value.replace(/[^0-9]/g, ''))
                        }
                        placeholder="0"
                        placeholderTextColor={colors.textMuted}
                        keyboardType="number-pad"
                        style={styles.partialInput}
                      />
                      <Text style={styles.partialUnit}>/ {target}</Text>
                    </View>
                  </View>
                );
              })}
            </View>
          ) : null}

          {exceptionExercises.length > 0 ? (
            <View style={styles.adjustmentSection}>
              <View style={styles.sectionHeadingRow}>
                <Text style={styles.sectionTitle}>Ce qui a été ajusté</Text>
                <Text style={styles.optionalLabel}>FACULTATIF</Text>
              </View>

              <View style={styles.adjustmentList}>
                {exceptionExercises.map((exercise, index) => {
                  const key = exerciseKey(exercise);
                  const expanded = expandedAdjustment === key;
                  return (
                    <View key={key}>
                      <AdjustmentRow
                        exercise={exercise}
                        selectedReason={exerciseFeedback[key]?.reasonCode ?? null}
                        onSelect={(reason) => setReason(exercise, reason)}
                        expanded={expanded}
                        onToggle={() => setExpandedAdjustment(expanded ? null : key)}
                        styles={styles}
                      />
                      {index < exceptionExercises.length - 1 ? (
                        <View style={styles.adjustmentSeparator} />
                      ) : null}
                    </View>
                  );
                })}
              </View>
            </View>
          ) : null}

          {missingMetrics.length > 0 ? (
            <View style={styles.compactAccordion}>
              <Pressable
                onPress={() => setMetricsOpen((current) => !current)}
                style={({ pressed }) => [styles.compactHeader, pressed && styles.pressed]}
              >
                <View style={styles.compactMain}>
                  <Text style={styles.compactTitle}>Compléter mes données</Text>
                  <Text style={styles.compactMeta}>{missingMetrics.length} donnée{missingMetrics.length > 1 ? 's' : ''} manquante{missingMetrics.length > 1 ? 's' : ''}</Text>
                </View>
                <Ionicons
                  name={metricsOpen ? 'chevron-up' : 'chevron-down'}
                  size={19}
                  color={colors.textSecondary}
                />
              </Pressable>

              {metricsOpen ? (
                <View style={styles.compactBody}>
                  {performedExercises
                    .filter((exercise) => missingMetricFields(exercise, loads).length > 0)
                    .map((exercise) => (
                      <View key={exerciseKey(exercise)} style={styles.metricExercise}>
                        <Text style={styles.metricExerciseName}>{exercise.name}</Text>
                        <View style={styles.metricGrid}>
                          {missingMetricFields(exercise, loads).map((field) => {
                            const meta = FIELD_META[field];
                            return (
                              <View key={field} style={styles.metricField}>
                                <Text style={styles.metricLabel}>{meta.label}</Text>
                                <View style={styles.metricInputWrap}>
                                  <TextInput
                                    value={formatInputValue(readMetric(exercise, field))}
                                    onChangeText={(value) => updateMetric(exercise, field, value)}
                                    keyboardType={meta.integer ? 'number-pad' : 'decimal-pad'}
                                    placeholder={meta.placeholder}
                                    placeholderTextColor={colors.textMuted}
                                    style={styles.metricInput}
                                  />
                                  <Text style={styles.metricUnit}>{meta.unit}</Text>
                                </View>
                              </View>
                            );
                          })}
                        </View>
                      </View>
                    ))}
                </View>
              ) : null}
            </View>
          ) : null}

          <View style={styles.compactAccordion}>
            <Pressable
              onPress={() => setNotesOpen((current) => !current)}
              style={({ pressed }) => [styles.compactHeader, pressed && styles.pressed]}
            >
              <View style={styles.compactMain}>
                <Text style={styles.compactTitle}>Ajouter une note</Text>
                {notes ? <Text style={styles.compactMeta}>Note ajoutée</Text> : null}
              </View>
              <Ionicons
                name={notesOpen ? 'chevron-up' : 'chevron-down'}
                size={19}
                color={colors.textSecondary}
              />
            </Pressable>

            {notesOpen ? (
              <View style={styles.compactBody}>
                <TextInput
                  value={notes}
                  onChangeText={(value) => updateCompletion({ notes: value })}
                  placeholder="Ce que tu veux retenir de cette séance…"
                  placeholderTextColor={colors.textMuted}
                  multiline
                  textAlignVertical="top"
                  maxLength={1000}
                  style={styles.notesInput}
                />
              </View>
            ) : null}
          </View>

          {saveError ? (
            <View style={styles.errorCard}>
              <Ionicons name="alert-circle-outline" size={19} color={colors.error} />
              <Text style={styles.errorText}>{saveError}</Text>
            </View>
          ) : null}

          <Pressable
            onPress={handleFinish}
            disabled={isSaving || difficulty == null || formAfterWorkout == null}
            style={({ pressed }) => [
              styles.primaryButton,
              (isSaving || difficulty == null || formAfterWorkout == null) &&
                styles.primaryButtonDisabled,
              pressed &&
                !isSaving &&
                difficulty != null &&
                formAfterWorkout != null &&
                styles.primaryButtonPressed,
            ]}
          >
            <Text style={styles.primaryButtonText}>
              {isSaving ? 'Enregistrement…' : 'Valider et voir mon débrief'}
            </Text>
            <Ionicons name="arrow-forward" size={20} color={colors.textOnAccent} />
          </Pressable>

          <View style={styles.bottomSpace} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function createStyles(colors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    keyboardView: { flex: 1 },
    content: {
      paddingHorizontal: 20,
      paddingTop: 8,
      paddingBottom: 30,
    },
    header: {
      minHeight: 82,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    headerButton: {
      width: 42,
      height: 42,
      borderRadius: 21,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    headerCopy: { flex: 1 },
    eyebrow: {
      fontFamily: MANROPE.medium,
      fontSize: 12,
      lineHeight: 16,
      color: colors.textSecondary,
    },
    title: {
      marginTop: 1,
      fontFamily: MANROPE.extraBold,
      fontSize: 31,
      lineHeight: 37,
      letterSpacing: -0.8,
      color: colors.text,
    },
    dot: { color: colors.accent },
    brandIcon: { width: 44, height: 44 },

    recapCard: {
      marginTop: 6,
      minHeight: 78,
      paddingHorizontal: 14,
      borderRadius: 18,
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    recapDuration: {
      minWidth: 64,
      alignItems: 'flex-start',
      justifyContent: 'center',
    },
    recapDurationValue: {
      fontFamily: 'BebasNeue_400Regular',
      fontSize: 36,
      lineHeight: 36,
      letterSpacing: 0.6,
      color: colors.text,
    },
    recapDurationUnit: {
      marginTop: -1,
      fontFamily: MANROPE.bold,
      fontSize: 8,
      letterSpacing: 0.9,
      color: colors.textMuted,
    },
    recapDivider: {
      width: 1,
      height: 40,
      marginHorizontal: 14,
      backgroundColor: colors.border,
    },
    recapMain: { flex: 1 },
    recapEnvironment: {
      fontFamily: MANROPE.bold,
      fontSize: 14,
      color: colors.text,
    },
    recapDetail: {
      marginTop: 3,
      fontFamily: MANROPE.medium,
      fontSize: 11,
      lineHeight: 16,
      color: colors.textSecondary,
    },
    recapCheck: {
      width: 30,
      height: 30,
      borderRadius: 15,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.accent,
    },

    questionBlock: { marginTop: 26 },
    questionTitle: {
      fontFamily: MANROPE.bold,
      fontSize: 19,
      lineHeight: 25,
      letterSpacing: -0.25,
      color: colors.text,
    },
    choiceWrap: {
      marginTop: 11,
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    choicePill: {
      minHeight: 42,
      paddingHorizontal: 14,
      borderRadius: 21,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    choicePillSelected: {
      borderColor: colors.accent,
      backgroundColor: colors.accentSoft,
    },
    choiceText: {
      fontFamily: MANROPE.semiBold,
      fontSize: 12,
      color: colors.textSecondary,
    },
    choiceTextSelected: { color: colors.text },

    conditionalCard: {
      marginTop: 18,
      padding: 14,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    conditionalHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    conditionalIcon: {
      width: 36,
      height: 36,
      borderRadius: 11,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.accentSoft,
    },
    conditionalMain: { flex: 1 },
    conditionalTitle: {
      fontFamily: MANROPE.bold,
      fontSize: 13,
      color: colors.text,
    },
    conditionalText: {
      marginTop: 2,
      fontFamily: MANROPE.regular,
      fontSize: 11,
      color: colors.textSecondary,
    },
    partialRow: {
      marginTop: 11,
      minHeight: 48,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    partialMain: { flex: 1 },
    partialName: {
      fontFamily: MANROPE.semiBold,
      fontSize: 12,
      color: colors.text,
    },
    partialTarget: {
      marginTop: 2,
      fontFamily: MANROPE.regular,
      fontSize: 10,
      color: colors.textMuted,
    },
    partialInputWrap: {
      minWidth: 86,
      height: 40,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceElevated,
      paddingHorizontal: 9,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-end',
    },
    partialInput: {
      minWidth: 26,
      paddingVertical: 0,
      textAlign: 'right',
      fontFamily: MANROPE.bold,
      fontSize: 13,
      color: colors.text,
    },
    partialUnit: {
      marginLeft: 3,
      fontFamily: MANROPE.regular,
      fontSize: 10,
      color: colors.textMuted,
    },

    adjustmentSection: { marginTop: 28 },
    sectionHeadingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
    },
    sectionTitle: {
      fontFamily: MANROPE.bold,
      fontSize: 18,
      lineHeight: 24,
      color: colors.text,
    },
    optionalLabel: {
      fontFamily: MANROPE.bold,
      fontSize: 8,
      letterSpacing: 0.7,
      color: colors.textMuted,
    },
    adjustmentList: {
      marginTop: 11,
      borderRadius: 16,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    adjustmentItem: { backgroundColor: colors.surface },
    adjustmentHeader: {
      minHeight: 66,
      paddingHorizontal: 14,
      paddingVertical: 12,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    adjustmentMain: { flex: 1 },
    adjustmentName: {
      fontFamily: MANROPE.bold,
      fontSize: 13,
      color: colors.text,
    },
    adjustmentMeta: {
      marginTop: 3,
      fontFamily: MANROPE.medium,
      fontSize: 11,
      color: colors.secondaryAccent,
    },
    adjustmentChevron: { color: colors.textSecondary },
    adjustmentSeparator: {
      height: 1,
      marginLeft: 14,
      backgroundColor: colors.border,
    },
    adjustmentBody: {
      paddingHorizontal: 14,
      paddingBottom: 14,
    },
    adjustmentQuestion: {
      fontFamily: MANROPE.bold,
      fontSize: 11,
      color: colors.text,
    },
    reasonWrap: {
      marginTop: 8,
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 7,
    },
    reasonPill: {
      minHeight: 34,
      paddingHorizontal: 11,
      borderRadius: 17,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceElevated,
    },
    reasonPillSelected: {
      borderColor: colors.accent,
      backgroundColor: colors.accentSoft,
    },
    reasonText: {
      fontFamily: MANROPE.semiBold,
      fontSize: 10,
      color: colors.textSecondary,
    },
    reasonTextSelected: { color: colors.text },

    compactAccordion: {
      marginTop: 12,
      borderRadius: 16,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    compactHeader: {
      minHeight: 60,
      paddingHorizontal: 14,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    compactMain: { flex: 1 },
    compactTitle: {
      fontFamily: MANROPE.bold,
      fontSize: 13,
      color: colors.text,
    },
    compactMeta: {
      marginTop: 2,
      fontFamily: MANROPE.regular,
      fontSize: 10,
      color: colors.textMuted,
    },
    compactBody: {
      paddingHorizontal: 14,
      paddingBottom: 14,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    metricExercise: { paddingTop: 13 },
    metricExerciseName: {
      fontFamily: MANROPE.bold,
      fontSize: 12,
      color: colors.text,
    },
    metricGrid: {
      marginTop: 8,
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    metricField: { minWidth: '47%', flexGrow: 1, gap: 5 },
    metricLabel: {
      fontFamily: MANROPE.semiBold,
      fontSize: 10,
      color: colors.textSecondary,
    },
    metricInputWrap: {
      minHeight: 40,
      paddingHorizontal: 10,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceElevated,
      flexDirection: 'row',
      alignItems: 'center',
    },
    metricInput: {
      flex: 1,
      paddingVertical: 0,
      fontFamily: MANROPE.semiBold,
      fontSize: 13,
      color: colors.text,
    },
    metricUnit: {
      marginLeft: 6,
      fontFamily: MANROPE.medium,
      fontSize: 10,
      color: colors.textMuted,
    },
    notesInput: {
      minHeight: 92,
      marginTop: 12,
      padding: 12,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceElevated,
      fontFamily: MANROPE.regular,
      fontSize: 13,
      lineHeight: 19,
      color: colors.text,
    },

    errorCard: {
      marginTop: 14,
      padding: 12,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.error,
      backgroundColor: colors.errorSoft,
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 8,
    },
    errorText: {
      flex: 1,
      fontFamily: MANROPE.regular,
      fontSize: 11,
      lineHeight: 16,
      color: colors.error,
    },
    primaryButton: {
      minHeight: 58,
      marginTop: 20,
      borderRadius: 16,
      backgroundColor: colors.accent,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 9,
    },
    primaryButtonDisabled: { opacity: 0.4 },
    primaryButtonPressed: { transform: [{ scale: 0.985 }] },
    primaryButtonText: {
      fontFamily: MANROPE.bold,
      fontSize: 15,
      color: colors.textOnAccent,
    },
    bottomSpace: { height: 24 },
    pressed: { opacity: 0.7 },
  });
}
