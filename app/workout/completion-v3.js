import { useMemo, useState } from 'react';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import {
  Image,
  KeyboardAvoidingView,
  Modal,
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
  { value: 4, label: 'Facile' },
  { value: 6, label: 'Bien dosée' },
  { value: 8, label: 'Difficile' },
  { value: 10, label: 'Trop difficile' },
];

const FEELING_OPTIONS = [
  { value: 2, label: 'Épuisé' },
  { value: 4, label: 'Fatigué' },
  { value: 6, label: 'Bien' },
  { value: 8, label: 'En forme' },
  { value: 10, label: 'Plein d’énergie' },
];

const ADAPTED_REASONS = [
  { code: 'TECHNIQUE_DIFFICULTY', label: 'Mouvement trop technique' },
  { code: 'LOAD_TOO_HEAVY', label: 'Trop difficile' },
  { code: 'FATIGUE', label: 'Fatigue' },
  { code: 'PAIN_DISCOMFORT', label: 'Gêne ou douleur' },
  { code: 'EQUIPMENT', label: 'Matériel indisponible' },
  { code: 'TIME', label: 'Manque de temps' },
  { code: 'ENVIRONMENT_MISMATCH', label: 'Environnement inadapté' },
  { code: 'OTHER', label: 'Autre raison' },
];

const NOT_COMPLETED_REASONS = [
  { code: 'MOVEMENT_FAILURE', label: 'Trop difficile' },
  { code: 'FATIGUE', label: 'Fatigue' },
  { code: 'PAIN_DISCOMFORT', label: 'Gêne ou douleur' },
  { code: 'TIME', label: 'Manque de temps' },
  { code: 'MOTIVATION', label: 'Pas envie aujourd’hui' },
  { code: 'EQUIPMENT', label: 'Matériel indisponible' },
  { code: 'ENVIRONMENT_MISMATCH', label: 'Environnement inadapté' },
  { code: 'OTHER', label: 'Autre raison' },
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

function FeedbackScale({ title, options, value, onChange, styles }) {
  return (
    <View style={styles.questionBlock}>
      <Text style={styles.questionTitle}>{title}</Text>
      <View style={styles.scaleRow}>
        {options.map((option) => {
          const active = value === option.value;
          return (
            <Pressable
              key={option.value}
              onPress={() => onChange(option.value)}
              style={({ pressed }) => [
                styles.scaleChoice,
                active && styles.scaleChoiceSelected,
                pressed && styles.pressed,
              ]}
            >
              <View style={[styles.scaleIndicator, active && styles.scaleIndicatorSelected]}>
                {active ? <View style={styles.scaleIndicatorCore} /> : null}
              </View>
              <Text
                numberOfLines={2}
                style={[styles.scaleChoiceText, active && styles.scaleChoiceTextSelected]}
              >
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function RecapProgress({ ratio, realizedCount, totalCount, colors, styles }) {
  const safeRatio = Math.max(0, Math.min(1, ratio));
  const knobPercent = Math.max(3, Math.min(97, safeRatio * 100));

  return (
    <View style={styles.recapProgressBlock}>
      <View style={styles.recapProgressHeader}>
        <Text style={styles.recapProgressLabel}>Réalisation</Text>
        <Text style={styles.recapProgressValue}>
          {realizedCount}/{totalCount}
        </Text>
      </View>

      <View style={styles.recapTrackShell}>
        <LinearGradient
          colors={[colors.secondaryAccent, colors.accent]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.recapTrackGradient}
        />
        <View
          pointerEvents="none"
          style={[
            styles.recapTrackKnob,
            {
              left: `${knobPercent}%`,
              borderColor: safeRatio >= 0.66 ? colors.accent : colors.secondaryAccent,
            },
          ]}
        >
          <View
            style={[
              styles.recapTrackKnobCore,
              {
                backgroundColor:
                  safeRatio >= 0.66 ? colors.accent : colors.secondaryAccent,
              },
            ]}
          />
        </View>
      </View>
    </View>
  );
}

function AdjustmentRow({ exercise, selectedReason, onPress, styles }) {
  const adapted = executionStatus(exercise) === 'adapted';
  const reasons = adapted ? ADAPTED_REASONS : NOT_COMPLETED_REASONS;
  const selectedLabel = reasons.find((reason) => reason.code === selectedReason)?.label ?? null;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.adjustmentRow, pressed && styles.adjustmentRowPressed]}
    >
      <View
        style={[
          styles.adjustmentStatus,
          adapted ? styles.adjustmentStatusAdapted : styles.adjustmentStatusSkipped,
        ]}
      >
        <Ionicons
          name={adapted ? 'options-outline' : 'close-outline'}
          size={18}
          style={adapted ? styles.adjustmentIconAdapted : styles.adjustmentIconSkipped}
        />
      </View>

      <View style={styles.adjustmentMain}>
        <Text style={styles.adjustmentName}>{exercise?.name ?? exercise?.id}</Text>
        <Text style={styles.adjustmentMeta}>
          {selectedLabel ?? (adapted ? 'Adapté' : 'Non réalisé')}
        </Text>
      </View>

      <View style={styles.adjustmentAction}>
        <Text style={styles.adjustmentActionText}>{selectedLabel ? 'Modifier' : 'Préciser'}</Text>
        <Ionicons name="chevron-forward" size={18} style={styles.adjustmentChevron} />
      </View>
    </Pressable>
  );
}

function ReasonPicker({ exercise, selectedReason, onSelect, onClose, visible, styles, colors }) {
  if (!exercise) return null;

  const adapted = executionStatus(exercise) === 'adapted';
  const reasons = adapted ? ADAPTED_REASONS : NOT_COMPLETED_REASONS;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.modalRoot}>
        <Pressable style={styles.modalBackdrop} onPress={onClose} />
        <View style={styles.reasonSheet}>
          <View style={styles.sheetHandle} />

          <View style={styles.reasonSheetHeader}>
            <View style={styles.reasonSheetHeaderMain}>
              <Text style={styles.reasonSheetEyebrow}>
                {adapted ? 'EXERCICE ADAPTÉ' : 'EXERCICE NON RÉALISÉ'}
              </Text>
              <Text style={styles.reasonSheetTitle}>{exercise?.name ?? exercise?.id}</Text>
              <Text style={styles.reasonSheetSubtitle}>Qu’est-ce qui l’explique le mieux ?</Text>
            </View>
            <Pressable onPress={onClose} style={styles.closeButton} hitSlop={10}>
              <Ionicons name="close" size={20} color={colors.text} />
            </Pressable>
          </View>

          <View style={styles.reasonList}>
            {reasons.map((reason) => {
              const active = selectedReason === reason.code;
              return (
                <Pressable
                  key={reason.code}
                  onPress={() => onSelect(reason.code)}
                  style={({ pressed }) => [
                    styles.reasonOption,
                    active && styles.reasonOptionSelected,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={[styles.reasonOptionText, active && styles.reasonOptionTextSelected]}>
                    {reason.label}
                  </Text>
                  <View style={[styles.reasonRadio, active && styles.reasonRadioSelected]}>
                    {active ? (
                      <Ionicons name="checkmark" size={14} color={colors.textOnAccent} />
                    ) : null}
                  </View>
                </Pressable>
              );
            })}
          </View>

          {selectedReason ? (
            <Pressable onPress={() => onSelect(null)} style={styles.clearReasonButton}>
              <Text style={styles.clearReasonText}>Ne pas préciser de motif</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

export default function CompletionV3Screen() {
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
  const [reasonPickerExercise, setReasonPickerExercise] = useState(null);
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
  const skippedCount = sourceExercises.filter(
    (exercise) => executionStatus(exercise) === 'not_completed'
  ).length;
  const realizedCount = completedCount + adaptedCount;
  const realizationRatio = sourceExercises.length > 0 ? realizedCount / sourceExercises.length : 1;

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

  function handleReasonSelect(reasonCode) {
    if (!reasonPickerExercise) return;
    setReason(reasonPickerExercise, reasonCode);
    setReasonPickerExercise(null);
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
      completion_capture_contract: 'completion-v3',
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
            <View style={styles.recapTopRow}>
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
                    : [
                        completedCount > 0
                          ? `${completedCount} terminé${completedCount > 1 ? 's' : ''}`
                          : null,
                        adaptedCount > 0
                          ? `${adaptedCount} adapté${adaptedCount > 1 ? 's' : ''}`
                          : null,
                        skippedCount > 0
                          ? `${skippedCount} non réalisé${skippedCount > 1 ? 's' : ''}`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                </Text>
              </View>
            </View>

            <RecapProgress
              ratio={realizationRatio}
              realizedCount={realizedCount}
              totalCount={sourceExercises.length}
              colors={colors}
              styles={styles}
            />
          </View>

          <FeedbackScale
            title="La séance était…"
            options={DIFFICULTY_OPTIONS}
            value={difficulty}
            onChange={(value) => updateCompletion({ rpe: value })}
            styles={styles}
          />

          <FeedbackScale
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
                <Text style={styles.optionalLabel}>OPTIONNEL</Text>
              </View>

              <View style={styles.adjustmentList}>
                {exceptionExercises.map((exercise, index) => {
                  const key = exerciseKey(exercise);
                  return (
                    <View key={key}>
                      <AdjustmentRow
                        exercise={exercise}
                        selectedReason={exerciseFeedback[key]?.reasonCode ?? null}
                        onPress={() => setReasonPickerExercise(exercise)}
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
                  <Text style={styles.compactMeta}>
                    {missingMetrics.length} donnée{missingMetrics.length > 1 ? 's' : ''} manquante{missingMetrics.length > 1 ? 's' : ''}
                  </Text>
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

      <ReasonPicker
        visible={Boolean(reasonPickerExercise)}
        exercise={reasonPickerExercise}
        selectedReason={
          reasonPickerExercise
            ? exerciseFeedback[exerciseKey(reasonPickerExercise)]?.reasonCode ?? null
            : null
        }
        onSelect={handleReasonSelect}
        onClose={() => setReasonPickerExercise(null)}
        styles={styles}
        colors={colors}
      />
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
      minHeight: 70,
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
      letterSpacing: 0.35,
      color: colors.textSecondary,
    },
    title: {
      fontFamily: MANROPE.extraBold,
      fontSize: 32,
      lineHeight: 38,
      letterSpacing: -0.8,
      color: colors.text,
    },
    dot: { color: colors.accent },
    brandIcon: { width: 44, height: 44 },

    recapCard: {
      marginTop: 10,
      paddingHorizontal: 16,
      paddingTop: 14,
      paddingBottom: 16,
      borderRadius: 18,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    recapTopRow: {
      minHeight: 58,
      flexDirection: 'row',
      alignItems: 'center',
    },
    recapDuration: {
      width: 72,
      alignItems: 'flex-start',
      justifyContent: 'center',
    },
    recapDurationValue: {
      fontFamily: 'BebasNeue_400Regular',
      fontSize: 42,
      lineHeight: 40,
      letterSpacing: 1,
      color: colors.text,
    },
    recapDurationUnit: {
      marginTop: 1,
      fontFamily: MANROPE.bold,
      fontSize: 10,
      lineHeight: 14,
      letterSpacing: 0.9,
      color: colors.textMuted,
    },
    recapDivider: {
      width: 1,
      height: 42,
      marginHorizontal: 14,
      backgroundColor: colors.border,
    },
    recapMain: { flex: 1 },
    recapEnvironment: {
      fontFamily: MANROPE.bold,
      fontSize: 15,
      lineHeight: 20,
      color: colors.text,
    },
    recapDetail: {
      marginTop: 4,
      fontFamily: MANROPE.medium,
      fontSize: 13,
      lineHeight: 18,
      color: colors.textSecondary,
    },
    recapProgressBlock: {
      marginTop: 13,
      paddingTop: 12,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    recapProgressHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 9,
    },
    recapProgressLabel: {
      fontFamily: MANROPE.semiBold,
      fontSize: 12,
      lineHeight: 17,
      color: colors.textSecondary,
    },
    recapProgressValue: {
      fontFamily: MANROPE.bold,
      fontSize: 12,
      lineHeight: 17,
      color: colors.text,
    },
    recapTrackShell: {
      height: 24,
      justifyContent: 'center',
      position: 'relative',
    },
    recapTrackGradient: {
      height: 6,
      borderRadius: 3,
    },
    recapTrackKnob: {
      position: 'absolute',
      top: 2,
      width: 20,
      height: 20,
      marginLeft: -10,
      borderRadius: 10,
      borderWidth: 2,
      backgroundColor: colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    recapTrackKnobCore: {
      width: 8,
      height: 8,
      borderRadius: 4,
    },

    questionBlock: { marginTop: 24 },
    questionTitle: {
      fontFamily: MANROPE.bold,
      fontSize: 18,
      lineHeight: 23,
      letterSpacing: -0.25,
      color: colors.text,
    },
    scaleRow: {
      marginTop: 12,
      flexDirection: 'row',
      gap: 6,
    },
    scaleChoice: {
      flex: 1,
      minWidth: 0,
      minHeight: 88,
      paddingHorizontal: 4,
      paddingVertical: 12,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceElevated,
    },
    scaleChoiceSelected: {
      borderColor: colors.accent,
      backgroundColor: colors.accentSoft,
    },
    scaleIndicator: {
      width: 18,
      height: 18,
      borderRadius: 9,
      borderWidth: 2,
      borderColor: colors.borderStrong,
      alignItems: 'center',
      justifyContent: 'center',
    },
    scaleIndicatorSelected: {
      borderColor: colors.accent,
    },
    scaleIndicatorCore: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: colors.accent,
    },
    scaleChoiceText: {
      fontFamily: MANROPE.semiBold,
      fontSize: 12,
      lineHeight: 16,
      letterSpacing: -0.1,
      textAlign: 'center',
      color: colors.textSecondary,
    },
    scaleChoiceTextSelected: { color: colors.text },

    conditionalCard: {
      marginTop: 18,
      padding: 14,
      borderRadius: 14,
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
      width: 38,
      height: 38,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.accentSoft,
    },
    conditionalMain: { flex: 1 },
    conditionalTitle: {
      fontFamily: MANROPE.bold,
      fontSize: 15,
      lineHeight: 20,
      color: colors.text,
    },
    conditionalText: {
      marginTop: 3,
      fontFamily: MANROPE.regular,
      fontSize: 13,
      lineHeight: 18,
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
      fontSize: 13,
      lineHeight: 18,
      color: colors.text,
    },
    partialTarget: {
      marginTop: 2,
      fontFamily: MANROPE.regular,
      fontSize: 11,
      lineHeight: 16,
      color: colors.textMuted,
    },
    partialInputWrap: {
      minWidth: 86,
      height: 42,
      borderRadius: 11,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceElevated,
      paddingHorizontal: 10,
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
      fontSize: 11,
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
      lineHeight: 23,
      letterSpacing: -0.25,
      color: colors.text,
    },
    optionalLabel: {
      fontFamily: MANROPE.bold,
      fontSize: 9,
      lineHeight: 13,
      letterSpacing: 0.8,
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
    adjustmentRow: {
      minHeight: 72,
      paddingHorizontal: 13,
      paddingVertical: 12,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 11,
      backgroundColor: colors.surface,
    },
    adjustmentRowPressed: { backgroundColor: colors.surfacePressed },
    adjustmentStatus: {
      width: 40,
      height: 40,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
    },
    adjustmentStatusAdapted: { backgroundColor: colors.warningSoft },
    adjustmentStatusSkipped: { backgroundColor: colors.secondaryAccentSoft },
    adjustmentIconAdapted: { color: colors.warning },
    adjustmentIconSkipped: { color: colors.secondaryAccent },
    adjustmentMain: { flex: 1 },
    adjustmentName: {
      fontFamily: MANROPE.bold,
      fontSize: 15,
      lineHeight: 20,
      color: colors.text,
    },
    adjustmentMeta: {
      marginTop: 3,
      fontFamily: MANROPE.regular,
      fontSize: 12,
      lineHeight: 17,
      color: colors.textSecondary,
    },
    adjustmentAction: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 2,
    },
    adjustmentActionText: {
      fontFamily: MANROPE.semiBold,
      fontSize: 11,
      lineHeight: 16,
      color: colors.textMuted,
    },
    adjustmentChevron: { color: colors.textMuted },
    adjustmentSeparator: {
      height: 1,
      marginLeft: 64,
      backgroundColor: colors.border,
    },

    compactAccordion: {
      marginTop: 12,
      borderRadius: 16,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    compactHeader: {
      minHeight: 64,
      paddingHorizontal: 14,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    compactMain: { flex: 1 },
    compactTitle: {
      fontFamily: MANROPE.bold,
      fontSize: 15,
      lineHeight: 20,
      color: colors.text,
    },
    compactMeta: {
      marginTop: 3,
      fontFamily: MANROPE.regular,
      fontSize: 12,
      lineHeight: 17,
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
      fontSize: 13,
      lineHeight: 18,
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
      fontSize: 11,
      lineHeight: 16,
      color: colors.textSecondary,
    },
    metricInputWrap: {
      minHeight: 42,
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
      fontSize: 11,
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
      fontSize: 12,
      lineHeight: 17,
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
      fontSize: 17,
      lineHeight: 22,
      letterSpacing: -0.1,
      color: colors.textOnAccent,
    },
    bottomSpace: { height: 24 },
    pressed: { opacity: 0.74 },

    modalRoot: {
      flex: 1,
      justifyContent: 'flex-end',
    },
    modalBackdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: 'rgba(0,0,0,0.56)',
    },
    reasonSheet: {
      paddingHorizontal: 20,
      paddingTop: 8,
      paddingBottom: 26,
      borderTopLeftRadius: 28,
      borderTopRightRadius: 28,
      backgroundColor: colors.background,
      borderWidth: 1,
      borderColor: colors.border,
    },
    sheetHandle: {
      width: 38,
      height: 4,
      borderRadius: 2,
      alignSelf: 'center',
      marginBottom: 16,
      backgroundColor: colors.borderStrong,
    },
    reasonSheetHeader: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 12,
    },
    reasonSheetHeaderMain: { flex: 1 },
    reasonSheetEyebrow: {
      fontFamily: MANROPE.bold,
      fontSize: 9,
      lineHeight: 13,
      letterSpacing: 0.8,
      color: colors.secondaryAccent,
    },
    reasonSheetTitle: {
      marginTop: 4,
      fontFamily: MANROPE.bold,
      fontSize: 21,
      lineHeight: 28,
      letterSpacing: -0.45,
      color: colors.text,
    },
    reasonSheetSubtitle: {
      marginTop: 5,
      fontFamily: MANROPE.regular,
      fontSize: 14,
      lineHeight: 21,
      color: colors.textSecondary,
    },
    closeButton: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    reasonList: {
      marginTop: 16,
      borderRadius: 16,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    reasonOption: {
      minHeight: 54,
      paddingHorizontal: 14,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
      backgroundColor: colors.surface,
    },
    reasonOptionSelected: {
      backgroundColor: colors.accentSoft,
    },
    reasonOptionText: {
      flex: 1,
      fontFamily: MANROPE.medium,
      fontSize: 14,
      lineHeight: 20,
      color: colors.text,
    },
    reasonOptionTextSelected: {
      fontFamily: MANROPE.bold,
      color: colors.accent,
    },
    reasonRadio: {
      width: 22,
      height: 22,
      borderRadius: 11,
      borderWidth: 1,
      borderColor: colors.borderStrong,
      alignItems: 'center',
      justifyContent: 'center',
    },
    reasonRadioSelected: {
      borderColor: colors.accent,
      backgroundColor: colors.accent,
    },
    clearReasonButton: {
      alignSelf: 'center',
      marginTop: 14,
      minHeight: 40,
      paddingHorizontal: 14,
      alignItems: 'center',
      justifyContent: 'center',
    },
    clearReasonText: {
      fontFamily: MANROPE.semiBold,
      fontSize: 12,
      lineHeight: 17,
      color: colors.textMuted,
    },
  });
}
