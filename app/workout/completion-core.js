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
  { value: 2, label: 'Facile' },
  { value: 4, label: 'Modérée' },
  { value: 6, label: 'Soutenue' },
  { value: 8, label: 'Difficile' },
  { value: 10, label: 'Très dure' },
];

const FEELING_OPTIONS = [
  { value: 2, label: 'À plat' },
  { value: 4, label: 'Bien entamé' },
  { value: 6, label: 'Correct' },
  { value: 8, label: 'Bien' },
  { value: 10, label: 'Encore du jus' },
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

function failedStageTargetReps(exercise, failedStage) {
  const prescription =
    exercise?.prescriptionJson ??
    exercise?.prescription_json ??
    {};
  const overlay = prescription.mechanic_overlay ?? {};
  const start = numberOr(
    overlay.start_reps ??
      overlay.base_reps ??
      prescription.execution_target_reps ??
      prescription.reps_min,
    0
  );
  const increment = numberOr(overlay.increment_reps, 0);

  return Math.max(
    0,
    Math.round(start + Math.max(0, failedStage - 1) * increment)
  );
}

function roundedChoice(value, options) {
  if (value == null) return null;
  return options.reduce((best, option) =>
    Math.abs(option.value - value) < Math.abs(best.value - value)
      ? option
      : best
  );
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

function ChoiceScale({ title, subtitle, options, value, onChange, colors, styles }) {
  const selected = roundedChoice(value, options);

  return (
    <View style={styles.feedbackCard}>
      <View style={styles.feedbackHeader}>
        <Text style={styles.feedbackTitle}>{title}</Text>
        <Text style={styles.feedbackSubtitle}>{subtitle}</Text>
      </View>

      <View style={styles.scaleRow}>
        {options.map((option) => {
          const active = selected?.value === option.value;
          return (
            <Pressable
              key={option.value}
              onPress={() => onChange(option.value)}
              style={({ pressed }) => [
                styles.scaleOption,
                active && styles.scaleOptionSelected,
                pressed && styles.pressed,
              ]}
            >
              <View
                style={[
                  styles.scaleDot,
                  active && { backgroundColor: colors.accent, borderColor: colors.accent },
                ]}
              />
              <Text style={[styles.scaleLabel, active && styles.scaleLabelSelected]}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function ReasonCard({
  exercise,
  selectedReason,
  onSelect,
  colors,
  styles,
}) {
  const status = executionStatus(exercise);
  const adapted = status === 'adapted';
  const reasons = adapted ? ADAPTED_REASONS : NOT_COMPLETED_REASONS;

  return (
    <View style={styles.reasonCard}>
      <View style={styles.reasonTop}>
        <View
          style={[
            styles.reasonStatusIcon,
            {
              backgroundColor: adapted
                ? colors.warningSoft
                : colors.secondaryAccentSoft,
            },
          ]}
        >
          <Ionicons
            name={adapted ? 'options-outline' : 'close-outline'}
            size={18}
            color={adapted ? colors.warning : colors.secondaryAccent}
          />
        </View>

        <View style={styles.reasonMain}>
          <Text style={styles.reasonName}>{exercise?.name ?? exercise?.id}</Text>
          <Text style={styles.reasonPrescription}>
            {exercise?.prescription ?? (adapted ? 'Exercice adapté' : 'Non réalisé')}
          </Text>
        </View>

        <Text
          style={[
            styles.reasonBadge,
            { color: adapted ? colors.warning : colors.secondaryAccent },
          ]}
        >
          {adapted ? 'ADAPTÉ' : 'NON RÉALISÉ'}
        </Text>
      </View>

      <Text style={styles.reasonQuestion}>Pourquoi ?</Text>
      <View style={styles.reasonChips}>
        {reasons.map((reason) => {
          const active = selectedReason === reason.code;
          return (
            <Pressable
              key={reason.code}
              onPress={() => onSelect(active ? null : reason.code)}
              style={({ pressed }) => [
                styles.reasonChip,
                active && styles.reasonChipSelected,
                pressed && styles.pressed,
              ]}
            >
              <Text style={[styles.reasonChipText, active && styles.reasonChipTextSelected]}>
                {reason.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function ProtocolResultCard({
  runtime,
  failedStage,
  wodExercises,
  protocolFeedback,
  onPartialRepsChange,
  colors,
  styles,
}) {
  const mechanic = normalizeMechanic(runtime?.mechanic);
  const variant = normalizeMechanic(runtime?.variant);
  const partial = protocolFeedback?.partialRepsByExercise ?? {};

  const title =
    mechanic === 'PROGRESSIVE_INTERVAL' && variant === 'DEATH_BY'
      ? 'Death By'
      : mechanic === 'PROGRESSIVE_INTERVAL' && variant === 'DEATH_BY_COUPLET'
        ? 'Death By Couplet'
        : String(mechanic || 'WOD').replaceAll('_', ' ');

  const elapsed = numberOr(runtime?.elapsedSeconds, 0);
  const rounds = numberOr(runtime?.completedRounds, 0);

  return (
    <View style={styles.protocolCard}>
      <View style={styles.protocolHeader}>
        <View style={styles.protocolIcon}>
          <Ionicons name="timer-outline" size={19} color={colors.textOnAccent} />
        </View>
        <View style={styles.protocolMain}>
          <Text style={styles.protocolEyebrow}>WOD ENREGISTRÉ</Text>
          <Text style={styles.protocolTitle}>{title}</Text>
          <Text style={styles.protocolMeta}>
            {Math.floor(elapsed / 60)}:{String(Math.floor(elapsed % 60)).padStart(2, '0')}
            {rounds > 0 ? ` · ${rounds} tour${rounds > 1 ? 's' : ''}` : ''}
          </Text>
        </View>
      </View>

      {failedStage ? (
        <View style={styles.protocolDetail}>
          <Text style={styles.protocolDetailTitle}>Dernière étape incomplète</Text>
          <Text style={styles.protocolDetailText}>
            Si tu t’en souviens, indique seulement les répétitions faites sur cette étape.
          </Text>

          {wodExercises.map((exercise) => {
            const target = failedStageTargetReps(exercise, failedStage);
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
                      onPartialRepsChange(exercise, value.replace(/[^0-9]/g, ''))
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
  const [metricsOpen, setMetricsOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(Boolean(completion?.notes));

  const sourceExercises =
    workout.exercises?.length > 0 ? workout.exercises : FALLBACK_EXERCISES;

  const performedExercises = sourceExercises.filter(
    (exercise) => executionStatus(exercise) !== 'not_completed'
  );
  const exceptionExercises = sourceExercises.filter(
    (exercise) => executionStatus(exercise) !== 'completed'
  );

  const formAfterWorkout = completion.formAfter ?? null;
  const difficulty = completion.rpe ?? null;
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

  const sessionDuration = actualDurationMinutes(workout);
  const completedCount = sourceExercises.filter(
    (exercise) => executionStatus(exercise) === 'completed'
  ).length;

  const missingMetrics = performedExercises.flatMap((exercise) =>
    missingMetricFields(exercise, loads).map((field) => ({ exercise, field }))
  );

  const wodExercises = sourceExercises.filter(
    (exercise) =>
      String(exercise?.blockKey ?? exercise?.block ?? '').toLowerCase() === 'wod'
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
        [key]: {
          ...current,
          reasonCode,
        },
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
        exerciseKey(exercise) === key
          ? { ...exercise, ...patch }
          : exercise
      ),
    });
  }

  function withActual(exercise, extra = {}) {
    return {
      ...(exercise.performanceActualJson ??
        exercise.performance_actual_json ??
        {}),
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
      replaceExercise(exercise, {
        performanceActualJson: withActual(exercise),
      });
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
        performanceActualJson: withActual(exercise, {
          box_height_cm: numeric,
        }),
      });
    }
  }

  async function handleFinish() {
    if (isSaving) return;

    setSaveError('');
    setIsSaving(true);

    try {
      if (!workout.sessionId) {
        throw new Error("Aucune session backend active.");
      }

      if (difficulty == null) {
        throw new Error('Indique comment tu as trouvé la difficulté de la séance.');
      }

      if (formAfterWorkout == null) {
        throw new Error('Indique comment tu te sens maintenant.');
      }

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
              <Text style={styles.eyebrow}>Séance terminée</Text>
              <Text style={styles.title}>
                Bien joué<Text style={styles.dot}>.</Text>
              </Text>
            </View>

            <Image source={brandIcon} style={styles.brandIcon} resizeMode="contain" />
          </View>

          <View style={styles.summaryCard}>
            <View style={styles.summaryIcon}>
              <Ionicons name="checkmark" size={24} color={colors.textOnAccent} />
            </View>
            <View style={styles.summaryMain}>
              <Text style={styles.summaryTitle}>Ta séance est prête à être enregistrée</Text>
              <Text style={styles.summaryMeta}>
                {sessionDuration} min · {ENVIRONMENT_LABELS[environmentCode] ?? environmentCode} · {completedCount}/{sourceExercises.length} exos terminés
              </Text>
            </View>
          </View>

          <Text style={styles.sectionTitle}>Comment ça s’est passé ?</Text>
          <Text style={styles.sectionHelp}>
            Deux réponses rapides suffisent pour aider UGEROD à calibrer la suite.
          </Text>

          <ChoiceScale
            title="La séance t’a semblé…"
            subtitle="Ton ressenti global pendant l’effort."
            options={DIFFICULTY_OPTIONS}
            value={difficulty}
            onChange={(value) => updateCompletion({ rpe: value })}
            colors={colors}
            styles={styles}
          />

          <ChoiceScale
            title="Comment tu te sens maintenant ?"
            subtitle="Ton état juste après l’entraînement."
            options={FEELING_OPTIONS}
            value={formAfterWorkout}
            onChange={(value) => updateCompletion({ formAfter: value })}
            colors={colors}
            styles={styles}
          />

          {wodRuntime?.started ? (
            <>
              <Text style={styles.sectionTitle}>Résultat enregistré</Text>
              <ProtocolResultCard
                runtime={wodRuntime}
                failedStage={failedStage}
                wodExercises={wodExercises}
                protocolFeedback={protocolFeedback}
                onPartialRepsChange={updatePartialReps}
                colors={colors}
                styles={styles}
              />
            </>
          ) : null}

          {exceptionExercises.length > 0 ? (
            <>
              <View style={styles.sectionRow}>
                <View style={styles.sectionRowMain}>
                  <Text style={styles.sectionTitleNoMargin}>
                    {exceptionExercises.length} point{exceptionExercises.length > 1 ? 's' : ''} à préciser
                  </Text>
                  <Text style={styles.sectionHelpNoMargin}>
                    Facultatif. UGEROD sait déjà ce qui a changé ; le motif aide à comprendre pourquoi.
                  </Text>
                </View>
              </View>

              <View style={styles.reasonList}>
                {exceptionExercises.map((exercise) => {
                  const key = exerciseKey(exercise);
                  return (
                    <ReasonCard
                      key={key}
                      exercise={exercise}
                      selectedReason={exerciseFeedback[key]?.reasonCode ?? null}
                      onSelect={(reason) => setReason(exercise, reason)}
                      colors={colors}
                      styles={styles}
                    />
                  );
                })}
              </View>
            </>
          ) : null}

          {missingMetrics.length > 0 ? (
            <View style={styles.optionalCard}>
              <Pressable
                onPress={() => setMetricsOpen((current) => !current)}
                style={({ pressed }) => [styles.optionalHeader, pressed && styles.pressed]}
              >
                <View style={styles.optionalIcon}>
                  <Ionicons name="analytics-outline" size={19} color={colors.accent} />
                </View>
                <View style={styles.optionalMain}>
                  <Text style={styles.optionalTitle}>Compléter mes données</Text>
                  <Text style={styles.optionalText}>
                    {missingMetrics.length} mesure{missingMetrics.length > 1 ? 's' : ''} utile{missingMetrics.length > 1 ? 's' : ''} manque{missingMetrics.length > 1 ? 'nt' : ''}. Optionnel.
                  </Text>
                </View>
                <Ionicons
                  name={metricsOpen ? 'chevron-up' : 'chevron-down'}
                  size={20}
                  color={colors.textSecondary}
                />
              </Pressable>

              {metricsOpen ? (
                <View style={styles.metricsBody}>
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

          <View style={styles.optionalCard}>
            <Pressable
              onPress={() => setNotesOpen((current) => !current)}
              style={({ pressed }) => [styles.optionalHeader, pressed && styles.pressed]}
            >
              <View style={styles.optionalIcon}>
                <Ionicons name="create-outline" size={19} color={colors.accent} />
              </View>
              <View style={styles.optionalMain}>
                <Text style={styles.optionalTitle}>Ajouter une note</Text>
                <Text style={styles.optionalText}>
                  Un détail que tu veux garder pour la prochaine fois.
                </Text>
              </View>
              <Ionicons
                name={notesOpen ? 'chevron-up' : 'chevron-down'}
                size={20}
                color={colors.textSecondary}
              />
            </Pressable>

            {notesOpen ? (
              <View style={styles.notesBody}>
                <TextInput
                  value={notes}
                  onChangeText={(value) => updateCompletion({ notes: value })}
                  placeholder="Ex : bonnes sensations, mouvement à retravailler…"
                  placeholderTextColor={colors.textMuted}
                  multiline
                  textAlignVertical="top"
                  maxLength={1000}
                  style={styles.notesInput}
                />
                <Text style={styles.notesCount}>{notes.length}/1000</Text>
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
              {isSaving ? 'Enregistrement…' : 'Enregistrer ma séance'}
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
    screen: {
      flex: 1,
      backgroundColor: colors.background,
    },
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
      fontSize: 32,
      lineHeight: 38,
      letterSpacing: -0.8,
      color: colors.text,
    },
    dot: { color: colors.accent },
    brandIcon: { width: 44, height: 44 },

    summaryCard: {
      marginTop: 8,
      minHeight: 86,
      padding: 15,
      borderRadius: 18,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    summaryIcon: {
      width: 46,
      height: 46,
      borderRadius: 23,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.accent,
    },
    summaryMain: { flex: 1 },
    summaryTitle: {
      fontFamily: MANROPE.bold,
      fontSize: 15,
      lineHeight: 20,
      color: colors.text,
    },
    summaryMeta: {
      marginTop: 4,
      fontFamily: MANROPE.medium,
      fontSize: 12,
      lineHeight: 17,
      color: colors.textSecondary,
    },

    sectionTitle: {
      marginTop: 26,
      fontFamily: MANROPE.bold,
      fontSize: 18,
      lineHeight: 24,
      letterSpacing: -0.2,
      color: colors.text,
    },
    sectionTitleNoMargin: {
      fontFamily: MANROPE.bold,
      fontSize: 18,
      lineHeight: 24,
      letterSpacing: -0.2,
      color: colors.text,
    },
    sectionHelp: {
      marginTop: 4,
      fontFamily: MANROPE.regular,
      fontSize: 13,
      lineHeight: 19,
      color: colors.textSecondary,
    },
    sectionHelpNoMargin: {
      marginTop: 4,
      fontFamily: MANROPE.regular,
      fontSize: 13,
      lineHeight: 19,
      color: colors.textSecondary,
    },
    sectionRow: { marginTop: 26 },
    sectionRowMain: { flex: 1 },

    feedbackCard: {
      marginTop: 12,
      padding: 16,
      borderRadius: 18,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    feedbackHeader: { gap: 3 },
    feedbackTitle: {
      fontFamily: MANROPE.bold,
      fontSize: 15,
      lineHeight: 20,
      color: colors.text,
    },
    feedbackSubtitle: {
      fontFamily: MANROPE.regular,
      fontSize: 12,
      lineHeight: 17,
      color: colors.textSecondary,
    },
    scaleRow: {
      marginTop: 16,
      flexDirection: 'row',
      gap: 5,
    },
    scaleOption: {
      flex: 1,
      minHeight: 68,
      paddingHorizontal: 4,
      paddingVertical: 9,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 7,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceElevated,
    },
    scaleOptionSelected: {
      borderColor: colors.accent,
      backgroundColor: colors.accentSoft,
    },
    scaleDot: {
      width: 12,
      height: 12,
      borderRadius: 6,
      borderWidth: 2,
      borderColor: colors.borderStrong,
    },
    scaleLabel: {
      fontFamily: MANROPE.semiBold,
      fontSize: 9,
      lineHeight: 12,
      textAlign: 'center',
      color: colors.textSecondary,
    },
    scaleLabelSelected: { color: colors.text },

    protocolCard: {
      marginTop: 12,
      padding: 15,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    protocolHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    protocolIcon: {
      width: 42,
      height: 42,
      borderRadius: 13,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.accent,
    },
    protocolMain: { flex: 1 },
    protocolEyebrow: {
      fontFamily: MANROPE.bold,
      fontSize: 9,
      letterSpacing: 0.7,
      color: colors.accent,
    },
    protocolTitle: {
      marginTop: 2,
      fontFamily: 'BebasNeue_400Regular',
      fontSize: 25,
      lineHeight: 28,
      letterSpacing: 0.8,
      color: colors.text,
    },
    protocolMeta: {
      marginTop: 2,
      fontFamily: MANROPE.medium,
      fontSize: 11,
      color: colors.textSecondary,
    },
    protocolDetail: {
      marginTop: 13,
      paddingTop: 12,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    protocolDetailTitle: {
      fontFamily: MANROPE.bold,
      fontSize: 12,
      color: colors.secondaryAccent,
    },
    protocolDetailText: {
      marginTop: 3,
      fontFamily: MANROPE.regular,
      fontSize: 11,
      lineHeight: 17,
      color: colors.textSecondary,
    },
    partialRow: {
      marginTop: 10,
      minHeight: 52,
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
      minWidth: 88,
      height: 40,
      paddingHorizontal: 10,
      borderRadius: 11,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceElevated,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-end',
    },
    partialInput: {
      minWidth: 28,
      textAlign: 'right',
      paddingVertical: 0,
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

    reasonList: { marginTop: 12, gap: 10 },
    reasonCard: {
      padding: 14,
      borderRadius: 18,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    reasonTop: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    reasonStatusIcon: {
      width: 38,
      height: 38,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
    },
    reasonMain: { flex: 1 },
    reasonName: {
      fontFamily: MANROPE.bold,
      fontSize: 13,
      lineHeight: 18,
      color: colors.text,
    },
    reasonPrescription: {
      marginTop: 2,
      fontFamily: MANROPE.regular,
      fontSize: 11,
      lineHeight: 16,
      color: colors.textSecondary,
    },
    reasonBadge: {
      fontFamily: MANROPE.bold,
      fontSize: 8,
      letterSpacing: 0.5,
    },
    reasonQuestion: {
      marginTop: 13,
      fontFamily: MANROPE.bold,
      fontSize: 12,
      color: colors.text,
    },
    reasonChips: {
      marginTop: 8,
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 7,
    },
    reasonChip: {
      minHeight: 34,
      paddingHorizontal: 11,
      borderRadius: 17,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceElevated,
    },
    reasonChipSelected: {
      borderColor: colors.accent,
      backgroundColor: colors.accentSoft,
    },
    reasonChipText: {
      fontFamily: MANROPE.semiBold,
      fontSize: 10,
      color: colors.textSecondary,
    },
    reasonChipTextSelected: { color: colors.text },

    optionalCard: {
      marginTop: 14,
      borderRadius: 18,
      overflow: 'hidden',
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    optionalHeader: {
      minHeight: 70,
      padding: 14,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 11,
    },
    optionalIcon: {
      width: 38,
      height: 38,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.accentSoft,
    },
    optionalMain: { flex: 1 },
    optionalTitle: {
      fontFamily: MANROPE.bold,
      fontSize: 13,
      color: colors.text,
    },
    optionalText: {
      marginTop: 3,
      fontFamily: MANROPE.regular,
      fontSize: 11,
      lineHeight: 16,
      color: colors.textSecondary,
    },
    metricsBody: {
      paddingHorizontal: 14,
      paddingBottom: 14,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      gap: 13,
    },
    metricExercise: { paddingTop: 13 },
    metricExerciseName: {
      fontFamily: MANROPE.bold,
      fontSize: 12,
      color: colors.text,
    },
    metricGrid: {
      marginTop: 9,
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    metricField: {
      minWidth: '47%',
      flexGrow: 1,
      gap: 5,
    },
    metricLabel: {
      fontFamily: MANROPE.semiBold,
      fontSize: 10,
      color: colors.textSecondary,
    },
    metricInputWrap: {
      minHeight: 42,
      paddingHorizontal: 10,
      borderRadius: 11,
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
    notesBody: {
      padding: 14,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    notesInput: {
      minHeight: 92,
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
    notesCount: {
      marginTop: 6,
      textAlign: 'right',
      fontFamily: MANROPE.regular,
      fontSize: 9,
      color: colors.textMuted,
    },

    errorCard: {
      marginTop: 15,
      padding: 12,
      borderRadius: 13,
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
      marginTop: 22,
      borderRadius: 16,
      backgroundColor: colors.accent,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 9,
    },
    primaryButtonDisabled: { opacity: 0.42 },
    primaryButtonPressed: { transform: [{ scale: 0.985 }] },
    primaryButtonText: {
      fontFamily: MANROPE.bold,
      fontSize: 16,
      lineHeight: 22,
      color: colors.textOnAccent,
    },
    bottomSpace: { height: 26 },
    pressed: { opacity: 0.7 },
  });
}
