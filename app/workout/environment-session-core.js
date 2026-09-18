import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { colors, spacing } from '../../src/constants';
import { useWorkout } from '../../src/contexts/WorkoutContext';
import { useUgerodTheme } from '../../src/contexts/UgerodThemeContext';
import EnvironmentWodBlock from '../../src/components/workout/EnvironmentWodBlock';
import EnvironmentSwapOverlay from '../../src/components/workout/EnvironmentSwapOverlay';
import { markWorkoutSessionStarted } from '../../src/services/workoutService';

function normalize(value) {
  return String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/[\s/-]+/g, '_');
}

function numberOr(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function optionalNumber(value) {
  if (value == null || String(value).trim() === '') return null;
  const parsed = Number(String(value).replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

function positiveInt(value, fallback = 0) {
  return Math.max(0, Math.round(numberOr(value, fallback)));
}

function formatClock(totalSeconds) {
  const safe = Math.max(0, Math.floor(numberOr(totalSeconds, 0)));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function formatRunDuration(totalSeconds) {
  const safe = Math.max(0, Math.round(numberOr(totalSeconds, 0)));
  if (safe <= 0) return null;

  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;

  if (minutes > 0 && seconds > 0) return `${minutes} min ${seconds} sec`;
  if (minutes > 0) return `${minutes} min`;
  return `${seconds} sec`;
}

function blockKey(block) {
  return String(block?.block_key ?? block?.blockKey ?? block?.key ?? '').toLowerCase();
}

function blockTitle(block, fallback = 'Préparation') {
  return block?.label_fr ?? block?.label ?? block?.title ?? block?.block_name ?? fallback;
}

function blockMechanic(block) {
  return normalize(
    block?.mechanic ??
      block?.mechanic_json?.mechanic_key ??
      block?.mechanicJson?.mechanic_key ??
      ''
  );
}

function blockParameters(block) {
  return (
    block?.mechanic_json?.parameters ??
    block?.mechanicJson?.parameters ??
    block?.parameters ??
    {}
  );
}

function exerciseKey(exercise) {
  return exercise?.sessionExerciseId ?? exercise?.id;
}

function exerciseTrackingModes(exercise) {
  if (Array.isArray(exercise?.trackingModes)) return exercise.trackingModes;
  if (Array.isArray(exercise?.prescriptionJson?.tracking_modes)) {
    return exercise.prescriptionJson.tracking_modes;
  }
  return [];
}

function isRunMechanic(mechanic) {
  return [
    'RUN_CONTINUOUS',
    'RUN_INTERVALS',
    'RUN_FARTLEK',
    'RUN_CALIBRATION',
  ].includes(mechanic);
}

function runFamilyLabel(mechanic, block) {
  const family = normalize(
    block?.mechanic_json?.variant_key ??
      block?.mechanicJson?.variant_key ??
      block?.running_protocol?.family_code ??
      block?.running_family_context?.family_code ??
      ''
  );

  const labels = {
    EASY_CONTINUOUS: 'Course continue — allure modérée',
    SHORT_INTERVALS: 'Intervalles courts',
    MEDIUM_INTERVALS: 'Intervalles moyens',
    GUIDED_FARTLEK: 'Fartlek guidé',
    CALIBRATION: 'Calibration',
  };

  if (labels[family]) return labels[family];
  if (mechanic === 'RUN_CONTINUOUS') return 'Course continue — allure modérée';
  if (mechanic === 'RUN_FARTLEK') return 'Fartlek guidé';
  if (mechanic === 'RUN_INTERVALS') return 'Intervalles';
  if (mechanic === 'RUN_CALIBRATION') return 'Calibration';
  return 'Course';
}

function runIntensityCueLabel(value) {
  const labels = {
    SUSTAINED_CONTROLLED: 'Allure soutenue mais contrôlée',
    EASY_CONVERSATIONAL: 'Allure facile, tu peux parler',
  };

  return labels[normalize(value)] ?? null;
}

function runRecoveryCueLabel(value) {
  const labels = {
    EASY_MOVE_OR_WALK: 'Marche ou trottine tranquillement',
  };

  return labels[normalize(value)] ?? null;
}

function statusValue(exercise) {
  if (exercise?.userExecutionStatus) return exercise.userExecutionStatus;
  if (exercise?.status === 'skipped') return 'not_completed';
  if (exercise?.status === 'not_completed') return 'not_completed';
  if (exercise?.status === 'adapted') return 'adapted';
  if (exercise?.status === 'completed') return 'completed';
  return 'pending';
}

function blockIsDone(block, exercises) {
  const key = blockKey(block);
  const rows = exercises.filter(
    (exercise) => String(exercise.blockKey ?? exercise.block ?? '').toLowerCase() === key
  );
  return rows.length > 0 && rows.every((exercise) => statusValue(exercise) !== 'pending');
}

function wodExecutionStatus(runtime) {
  if (!runtime?.started || !runtime?.finished) return 'pending';

  const completedReasons = [
    'timer_complete',
    'rounds_complete',
    'steps_complete',
    'sequence_complete',
    'target_complete',
    'completed',
  ];

  if (completedReasons.includes(runtime?.finishReason)) {
    return 'completed';
  }

  const observedWork =
    positiveInt(runtime?.elapsedSeconds, 0) > 0 ||
    positiveInt(runtime?.completedRounds, 0) > 0 ||
    positiveInt(runtime?.manualStep, 1) > 1 ||
    positiveInt(runtime?.currentStage, 0) > 0;

  return observedWork ? 'adapted' : 'not_completed';
}

function getSetCount(exercise, block) {
  const prescription = exercise?.prescriptionJson ?? {};
  const params = blockParameters(block);
  const mechanic = blockMechanic(block);

  if (mechanic === 'CIRCUIT') {
    return positiveInt(
      prescription?.block_parameters?.rounds ?? params?.rounds,
      0
    );
  }

  return positiveInt(
    prescription?.block_parameters?.sets ?? prescription?.sets ?? params?.sets,
    0
  );
}

function usesLoad(exercise) {
  return exerciseTrackingModes(exercise).includes('load');
}

function usesReps(exercise) {
  const modes = exerciseTrackingModes(exercise);
  return modes.includes('reps') || modes.length === 0;
}

function prescribedReps(exercise) {
  const prescription = exercise?.prescriptionJson ?? {};
  const candidates = [
    prescription?.execution_target_reps,
    prescription?.reps,
    prescription?.reps_max,
    prescription?.reps_min,
  ];

  for (const candidate of candidates) {
    const value = optionalNumber(candidate);
    if (value != null) return String(value);
  }

  const text = String(exercise?.prescription ?? '');
  const match = text.match(/(\d+(?:[.,]\d+)?)\s*reps?/i);
  return match?.[1]?.replace(',', '.') ?? '';
}

function prescribedLoad(exercise) {
  const prescription = exercise?.prescriptionJson ?? {};
  const candidates = [
    prescription?.execution_target_load_kg,
    prescription?.load_kg,
    prescription?.target_load_kg,
  ];

  for (const candidate of candidates) {
    const value = optionalNumber(candidate);
    if (value != null) return String(value);
  }

  return '';
}

function initialSetDrafts(exercises, block) {
  const next = {};

  for (const exercise of exercises) {
    const key = exerciseKey(exercise);
    const existing = exercise?.performanceActualJson?.gym_sets;
    const setCount = getSetCount(exercise, block);
    const defaultReps = prescribedReps(exercise);
    const defaultLoad = prescribedLoad(exercise);

    if (Array.isArray(existing) && existing.length > 0) {
      next[key] = {
        reps:
          existing.find((set) => set?.reps != null)?.reps != null
            ? String(existing.find((set) => set?.reps != null).reps)
            : defaultReps,
        sets: existing.map((set, index) => ({
          setIndex: positiveInt(set?.set_index, index + 1),
          load: set?.load_kg != null ? String(set.load_kg) : defaultLoad,
          done: set?.status === 'completed' || set?.completed === true,
        })),
      };
      continue;
    }

    next[key] = {
      reps: defaultReps,
      sets: Array.from({ length: setCount }, (_, index) => ({
        setIndex: index + 1,
        load: defaultLoad,
        done: false,
      })),
    };
  }

  return next;
}

function SimpleBlock({ block, exercises, onComplete }) {function SimpleBlock({ block, exercises, onComplete }) {
  const { colors: themeColors, isDark } = useUgerodTheme();
  const focusedStyles = useMemo(
    () => createEnvironmentFocusedStyles(themeColors, isDark),
    [themeColors, isDark]
  );
  const [exerciseIndex, setExerciseIndex] = useState(0);
  const exercise = exercises[exerciseIndex] ?? exercises[0] ?? null;

  if (!exercise) {
    return (
      <View style={focusedStyles.exerciseCard}>
        <Text style={focusedStyles.exerciseName}>Bloc vide</Text>
        <Text style={focusedStyles.exercisePrescription}>Aucun exercice exécutable n’a été reçu.</Text>
      </View>
    );
  }

  const isLast = exerciseIndex >= exercises.length - 1;

  function validateCurrent() {
    if (isLast) {
      onComplete();
      return;
    }
    setExerciseIndex((current) => Math.min(exercises.length - 1, current + 1));
  }

  return (
    <>
      <View style={focusedStyles.mediaCard}>
        <View style={focusedStyles.mediaFallback}>
          <View style={focusedStyles.mediaFallbackIcon}>
            <Ionicons name="barbell-outline" size={34} color={themeColors.accent} />
          </View>
          <Text style={focusedStyles.mediaFallbackText}>{blockTitle(block)}</Text>
        </View>
        <View style={focusedStyles.mediaOverlayTop}>
          <Text style={focusedStyles.exercisePosition}>
            Exercice {exerciseIndex + 1} / {exercises.length}
          </Text>
        </View>
      </View>

      <View style={focusedStyles.exerciseCard}>
        <Text style={focusedStyles.exerciseName}>{exercise.name}</Text>
        {exercise.prescription ? (
          <Text style={focusedStyles.exercisePrescription}>{exercise.prescription}</Text>
        ) : null}
        <View style={{ marginTop: 12, alignItems: 'flex-start' }}>
          <EnvironmentSwapOverlay variant="inline" targetExercise={exercise} />
        </View>
      </View>

      {exercises.length > 1 ? (
        <View style={focusedStyles.exerciseNav}>
          <Pressable
            onPress={() => setExerciseIndex((current) => Math.max(0, current - 1))}
            disabled={exerciseIndex === 0}
            style={[focusedStyles.navButton, exerciseIndex === 0 && focusedStyles.actionDisabled]}
          >
            <Ionicons name="chevron-back" size={20} color={themeColors.text} />
          </Pressable>
          <View style={focusedStyles.navDots}>
            {exercises.map((row, index) => (
              <View
                key={exerciseKey(row) ?? `${index}`}
                style={[focusedStyles.navDot, index === exerciseIndex && focusedStyles.navDotActive]}
              />
            ))}
          </View>
          <Pressable
            onPress={() => setExerciseIndex((current) => Math.min(exercises.length - 1, current + 1))}
            disabled={isLast}
            style={[focusedStyles.navButton, isLast && focusedStyles.actionDisabled]}
          >
            <Ionicons name="chevron-forward" size={20} color={themeColors.text} />
          </Pressable>
        </View>
      ) : null}

      <Pressable onPress={validateCurrent} style={focusedStyles.primaryButtonLarge}>
        <Ionicons name="checkmark-circle-outline" size={20} color={themeColors.textOnAccent} />
        <Text style={focusedStyles.primaryButtonTextLarge}>
          {isLast ? 'Réalisé · terminer le bloc' : 'Réalisé · suivant'}
        </Text>
      </Pressable>
    </>
  );
}

function StrengthBlock({ block, exercises, drafts, setDrafts, onComplete }) {
  const { colors: themeColors, isDark } = useUgerodTheme();
  const gymStyles = useMemo(
    () => createGymStyles(themeColors, isDark),
    [themeColors, isDark]
  );
  const mechanic = blockMechanic(block);
  const isCircuit = mechanic === 'CIRCUIT';
  const [activeKey, setActiveKey] = useState(() => exerciseKey(exercises?.[0]) ?? null);

  useEffect(() => {
    if (exercises.some((exercise) => exerciseKey(exercise) === activeKey)) return;
    setActiveKey(exerciseKey(exercises?.[0]) ?? null);
  }, [activeKey, exercises]);

  function updateExerciseReps(exercise, value) {
    const key = exerciseKey(exercise);
    setDrafts((current) => ({
      ...current,
      [key]: {
        ...(current[key] ?? { reps: '', sets: [] }),
        reps: value,
      },
    }));
  }

  function updateSetLoad(exercise, setIndex, value) {
    const key = exerciseKey(exercise);
    setDrafts((current) => ({
      ...current,
      [key]: {
        ...(current[key] ?? { reps: '', sets: [] }),
        sets: (current[key]?.sets ?? []).map((row, index) =>
          index === setIndex ? { ...row, load: value } : row
        ),
      },
    }));
  }

  function toggleSet(exercise, setIndex) {
    const key = exerciseKey(exercise);
    setDrafts((current) => ({
      ...current,
      [key]: {
        ...(current[key] ?? { reps: '', sets: [] }),
        sets: (current[key]?.sets ?? []).map((row, index) =>
          index === setIndex ? { ...row, done: !row.done } : row
        ),
      },
    }));
  }

  return (
    <>
      <View style={gymStyles.blockHint}>
        <Ionicons name="checkmark-circle-outline" size={18} color={themeColors.accent} />
        <Text style={gymStyles.blockHintText}>
          La séance est déjà préparée. Ajuste seulement les reps, la charge ou l’exercice si nécessaire.
        </Text>
      </View>

      {exercises.map((exercise, exerciseIndex) => {
        const key = exerciseKey(exercise);
        const draft = drafts[key] ?? { reps: '', sets: [] };
        const rows = draft.sets ?? [];
        const loadEnabled = usesLoad(exercise);
        const repsEnabled = usesReps(exercise);
        const isActive = activeKey === key;
        const completedCount = rows.filter((row) => row.done).length;
        const seriesLabel = isCircuit ? 'tours' : 'séries';

        return (
          <View key={key} style={[gymStyles.exerciseCard, isActive && gymStyles.exerciseCardActive]}>
            <Pressable
              onPress={() => setActiveKey(isActive ? null : key)}
              style={({ pressed }) => [gymStyles.exerciseHeader, pressed && gymStyles.pressed]}
            >
              <View style={gymStyles.exerciseHeaderCopy}>
                <Text style={gymStyles.exerciseEyebrow}>
                  EXERCICE {exerciseIndex + 1}/{exercises.length}
                </Text>
                <Text style={gymStyles.exerciseName}>{exercise.name}</Text>
                <Text style={gymStyles.exerciseSummary}>
                  {rows.length || '—'} {seriesLabel}
                  {repsEnabled ? ` · ${draft.reps || '—'} reps` : ''}
                  {loadEnabled ? ' · charge ajustable' : ''}
                </Text>
              </View>

              <View style={gymStyles.exerciseHeaderStatus}>
                <Text style={gymStyles.exerciseProgress}>
                  {completedCount}/{rows.length || 0}
                </Text>
                <Ionicons
                  name={isActive ? 'chevron-up' : 'chevron-down'}
                  size={19}
                  color={themeColors.textSecondary}
                />
              </View>
            </Pressable>

            {isActive ? (
              <View style={gymStyles.exerciseBody}>
                {repsEnabled ? (
                  <View style={gymStyles.globalFieldRow}>
                    <View style={gymStyles.globalFieldCopy}>
                      <Text style={gymStyles.fieldLabel}>RÉPÉTITIONS PAR SÉRIE</Text>
                      <Text style={gymStyles.fieldHelp}>
                        Une modification s’applique à toutes les séries.
                      </Text>
                    </View>
                    <View style={gymStyles.repsInputWrap}>
                      <TextInput
                        value={draft.reps}
                        onChangeText={(value) => updateExerciseReps(exercise, value)}
                        placeholder="—"
                        placeholderTextColor={themeColors.textMuted}
                        keyboardType="numeric"
                        selectTextOnFocus
                        style={gymStyles.repsInput}
                      />
                      <Text style={gymStyles.inputSuffix}>reps</Text>
                    </View>
                  </View>
                ) : null}

                <View style={gymStyles.exerciseActionsRow}>
                  <EnvironmentSwapOverlay variant="inline" targetExercise={exercise} />
                  <Text style={gymStyles.exerciseActionHelp}>
                    Trop simple, trop difficile ou besoin d’un autre mouvement ? Adapte l’exercice.
                  </Text>
                </View>

                {rows.length === 0 ? (
                  <Text style={gymStyles.warningText}>
                    Aucun nombre de séries/tours reçu du moteur. Ce bloc ne peut pas être validé automatiquement.
                  </Text>
                ) : (
                  <View style={gymStyles.setsPanel}>
                    <Text style={gymStyles.setsTitle}>
                      {isCircuit ? 'TOURS' : 'SÉRIES'}
                    </Text>

                    {rows.map((row, index) => (
                      <View
                        key={`${key}:${row.setIndex}`}
                        style={[gymStyles.setRow, row.done && gymStyles.setRowDone]}
                      >
                        <Pressable
                          onPress={() => toggleSet(exercise, index)}
                          accessibilityRole="checkbox"
                          accessibilityState={{ checked: Boolean(row.done) }}
                          style={[gymStyles.checkButton, row.done && gymStyles.checkButtonDone]}
                        >
                          <Ionicons
                            name={row.done ? 'checkmark' : 'ellipse-outline'}
                            size={18}
                            color={row.done ? themeColors.textOnAccent : themeColors.textSecondary}
                          />
                        </Pressable>

                        <Text style={gymStyles.setLabel}>
                          {isCircuit ? 'T' : 'S'}{row.setIndex}
                        </Text>

                        <Text style={gymStyles.setRepsText}>
                          {repsEnabled ? `${draft.reps || '—'} reps` : 'À réaliser'}
                        </Text>

                        {loadEnabled ? (
                          <View style={gymStyles.loadInputWrap}>
                            <TextInput
                              value={row.load}
                              onChangeText={(value) => updateSetLoad(exercise, index, value)}
                              placeholder="—"
                              placeholderTextColor={themeColors.textMuted}
                              keyboardType="decimal-pad"
                              selectTextOnFocus
                              style={gymStyles.loadInput}
                            />
                            <Text style={gymStyles.inputSuffix}>kg</Text>
                          </View>
                        ) : null}
                      </View>
                    ))}
                  </View>
                )}
              </View>
            ) : null}
          </View>
        );
      })}

      <Pressable
        onPress={onComplete}
        style={({ pressed }) => [gymStyles.primaryButton, pressed && gymStyles.pressed]}
      >
        <Ionicons name="checkmark-circle-outline" size={20} color={themeColors.textOnAccent} />
        <Text style={gymStyles.primaryButtonText}>VALIDER LE BLOC</Text>
      </Pressable>
    </>
  );
}

function ManualGymBlock({ block, exercises, onComplete }) {
  const { colors: themeColors, isDark } = useUgerodTheme();
  const gymStyles = useMemo(
    () => createGymStyles(themeColors, isDark),
    [themeColors, isDark]
  );
  const [drafts, setDrafts] = useState(() =>
    Object.fromEntries(
      exercises.map((exercise) => [
        exerciseKey(exercise),
        {
          reps: exercise?.repsCompleted != null ? String(exercise.repsCompleted) : '',
          seconds: exercise?.durationSeconds != null ? String(exercise.durationSeconds) : '',
        },
      ])
    )
  );

  function patch(exercise, field, value) {
    const key = exerciseKey(exercise);
    setDrafts((current) => ({
      ...current,
      [key]: { ...(current[key] ?? {}), [field]: value },
    }));
  }

  function finish() {
    const updates = {};

    for (const exercise of exercises) {
      const key = exerciseKey(exercise);
      const draft = drafts[key] ?? {};
      const modes = exerciseTrackingModes(exercise);
      const wantsReps = modes.includes('reps') || modes.length === 0;
      const wantsTime = modes.includes('time');
      const reps = optionalNumber(draft.reps);
      const seconds = optionalNumber(draft.seconds);

      if ((wantsReps || wantsTime) && reps == null && seconds == null) {
        Alert.alert(
          'Performance manquante',
          `Renseigne ce que tu as réellement réalisé pour ${exercise.name}.`
        );
        return;
      }

      updates[key] = {
        status: 'completed',
        userExecutionStatus: 'completed',
        repsCompleted: wantsReps ? reps : null,
        durationSeconds: wantsTime ? seconds : null,
        performanceActualJson: {
          ...(exercise.performanceActualJson ?? {}),
          source: 'ugerod_environment_gym_manual',
          controlled_entry: true,
        },
      };
    }

    onComplete(updates);
  }

  return (
    <>
      <View style={gymStyles.blockHint}>
        <Ionicons name="create-outline" size={18} color={themeColors.accent} />
        <Text style={gymStyles.blockHintText}>
          Ajuste uniquement les valeurs qui diffèrent de ce que tu as réellement fait.
        </Text>
      </View>

      {exercises.map((exercise, index) => {
        const key = exerciseKey(exercise);
        const draft = drafts[key] ?? {};
        const modes = exerciseTrackingModes(exercise);
        const showReps = modes.includes('reps') || modes.length === 0;
        const showTime = modes.includes('time');

        return (
          <View key={key} style={gymStyles.exerciseCard}>
            <View style={gymStyles.exerciseBody}>
              <Text style={gymStyles.exerciseEyebrow}>EXERCICE {index + 1}/{exercises.length}</Text>
              <Text style={gymStyles.exerciseName}>{exercise.name}</Text>
              {exercise.prescription ? (
                <Text style={gymStyles.exerciseSummary}>{exercise.prescription}</Text>
              ) : null}

              <View style={gymStyles.exerciseActionsRow}>
                <EnvironmentSwapOverlay variant="inline" targetExercise={exercise} />
              </View>

              <View style={gymStyles.manualFieldsRow}>
                {showReps ? (
                  <View style={gymStyles.manualField}>
                    <Text style={gymStyles.fieldLabel}>RÉPÉTITIONS</Text>
                    <TextInput
                      value={draft.reps ?? ''}
                      onChangeText={(value) => patch(exercise, 'reps', value)}
                      placeholder="—"
                      placeholderTextColor={themeColors.textMuted}
                      keyboardType="numeric"
                      style={gymStyles.manualInput}
                    />
                  </View>
                ) : null}
                {showTime ? (
                  <View style={gymStyles.manualField}>
                    <Text style={gymStyles.fieldLabel}>SECONDES</Text>
                    <TextInput
                      value={draft.seconds ?? ''}
                      onChangeText={(value) => patch(exercise, 'seconds', value)}
                      placeholder="—"
                      placeholderTextColor={themeColors.textMuted}
                      keyboardType="numeric"
                      style={gymStyles.manualInput}
                    />
                  </View>
                ) : null}
              </View>
            </View>
          </View>
        );
      })}

      <Pressable
        onPress={finish}
        style={({ pressed }) => [gymStyles.primaryButton, pressed && gymStyles.pressed]}
      >
        <Ionicons name="checkmark-circle-outline" size={20} color={themeColors.textOnAccent} />
        <Text style={gymStyles.primaryButtonText}>VALIDER LE BLOC</Text>
      </Pressable>
    </>
  );
}

function TabataBlock({ block, exercises, onComplete }) {function TabataBlock({ block, exercises, onComplete }) {
  const firstProtocol = exercises?.[0]?.prescriptionJson?.protocol ?? {};
  const settings = block?.settings ?? {};
  const rounds = positiveInt(settings.rounds ?? firstProtocol.rounds, 0);
  const workSeconds = positiveInt(settings.work_seconds ?? firstProtocol.work_seconds, 0);
  const restSeconds = positiveInt(settings.rest_seconds ?? firstProtocol.rest_seconds, 0);
  const cycleSeconds = workSeconds + restSeconds;
  const totalSeconds = rounds > 0 && workSeconds > 0 ? rounds * cycleSeconds : 0;

  const [started, setStarted] = useState(false);
  const [paused, setPaused] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!started || paused || totalSeconds <= 0 || elapsed >= totalSeconds) return undefined;
    const timer = setInterval(() => {
      setElapsed((current) => Math.min(totalSeconds, current + 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [elapsed, paused, started, totalSeconds]);

  const phase = useMemo(() => {
    if (totalSeconds <= 0 || cycleSeconds <= 0) {
      return { label: 'PROTOCOLE INCOMPLET', remaining: 0, round: 0, completedWorkIntervals: 0, exerciseIndex: 0 };
    }
    if (elapsed >= totalSeconds) {
      return { label: 'TERMINÉ', remaining: 0, round: rounds, completedWorkIntervals: rounds, exerciseIndex: Math.max(0, rounds - 1) % Math.max(1, exercises.length) };
    }

    const zeroBasedRound = Math.floor(elapsed / cycleSeconds);
    const within = elapsed % cycleSeconds;
    const resting = within >= workSeconds;
    const completedWorkIntervals = Math.min(rounds, zeroBasedRound + (resting ? 1 : 0));

    return {
      label: resting ? 'RÉCUPÉRATION' : 'EFFORT',
      remaining: resting ? Math.max(0, cycleSeconds - within) : Math.max(0, workSeconds - within),
      round: Math.min(rounds, zeroBasedRound + 1),
      completedWorkIntervals,
      exerciseIndex: zeroBasedRound % Math.max(1, exercises.length),
    };
  }, [cycleSeconds, elapsed, exercises.length, restSeconds, rounds, totalSeconds, workSeconds]);

  function finish() {
    if (totalSeconds <= 0) {
      Alert.alert('Protocole incomplet', 'Le nombre de rounds et les temps 20/10 sont manquants.');
      return;
    }
    if (!started && elapsed <= 0) {
      Alert.alert('Chrono non démarré', 'Démarre le chrono avant de terminer le Tabata.');
      return;
    }

    const protocolCompleted = elapsed >= totalSeconds;
    const updates = {};

    exercises.forEach((exercise, exerciseIndex) => {
      let exerciseIntervals = 0;
      for (let roundIndex = 0; roundIndex < phase.completedWorkIntervals; roundIndex += 1) {
        if (roundIndex % Math.max(1, exercises.length) === exerciseIndex) exerciseIntervals += 1;
      }

      const executionStatus = protocolCompleted
        ? 'completed'
        : exerciseIntervals > 0
          ? 'adapted'
          : 'not_completed';

      updates[exerciseKey(exercise)] = {
        status: executionStatus,
        userExecutionStatus: executionStatus,
        performanceActualJson: {
          ...(exercise.performanceActualJson ?? {}),
          source: 'ugerod_environment_tabata',
          controlled_timing: true,
          protocol_completed: protocolCompleted,
          elapsed_seconds: elapsed,
          planned_rounds: rounds,
          rounds_completed: phase.completedWorkIntervals,
          work_intervals_completed: exerciseIntervals,
          work_seconds,
          rest_seconds: restSeconds,
        },
      };
    });

    onComplete(updates);
  }

  const activeExercise = exercises[phase.exerciseIndex] ?? exercises[0] ?? null;

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{blockTitle(block, 'Tabata')}</Text>
      <Text style={styles.cardMeta}>{rounds} rounds · {workSeconds}s / {restSeconds}s</Text>

      <View style={styles.timerBox}>
        <Text style={styles.timer}>{formatClock(elapsed)}</Text>
        <Text style={styles.timerTarget}>/ {formatClock(totalSeconds)}</Text>
      </View>

      <View style={styles.phaseBox}>
        <Text style={styles.phaseLabel}>{phase.label}</Text>
        <Text style={styles.phaseTime}>{formatClock(phase.remaining)}</Text>
        <Text style={styles.cardMeta}>Round {phase.round}/{rounds}</Text>
        {phase.label === 'EFFORT' && activeExercise ? (
          <Text style={styles.exerciseName}>{activeExercise.name}</Text>
        ) : null}
        {!started && activeExercise ? (
          <View style={{ marginTop: 10, alignItems: 'center' }}>
            <EnvironmentSwapOverlay variant="inline" targetExercise={activeExercise} />
          </View>
        ) : null}
      </View>

      {exercises.length > 1 ? (
        <Text style={styles.helperText}>Alternance : {exercises.map((exercise) => exercise.name).join(' · ')}</Text>
      ) : null}

      <View style={styles.timerActions}>
        {!started ? (
          <Pressable onPress={() => setStarted(true)} style={({ pressed }) => [styles.primaryButton, styles.flexButton, pressed && styles.pressed]}>
            <Text style={styles.primaryButtonText}>DÉMARRER</Text>
          </Pressable>
        ) : (
          <Pressable onPress={() => setPaused((current) => !current)} style={({ pressed }) => [styles.secondaryButton, styles.flexButton, pressed && styles.pressed]}>
            <Text style={styles.secondaryButtonText}>{paused ? 'REPRENDRE' : 'PAUSE'}</Text>
          </Pressable>
        )}
      </View>

      <Pressable onPress={finish} style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}>
        <Text style={styles.primaryButtonText}>{elapsed >= totalSeconds ? 'TERMINER LE TABATA' : 'ARRÊTER ET TERMINER'}</Text>
      </Pressable>
    </View>
  );
}

function TimedBlock({ block, exercise, environmentCode, onComplete }) {
  const mechanic = blockMechanic(block);
  const params = blockParameters(block);
  const isRun = isRunMechanic(mechanic);
  const isIntervals = ['RUN_INTERVALS', 'RUN_FARTLEK'].includes(mechanic);
  const prescribedSeconds = Math.max(
    1,
    positiveInt(
      params?.duration_seconds,
      numberOr(block?.duration_minutes ?? block?.durationMinutes, 1) * 60
    )
  );
  const workSeconds = Math.max(1, positiveInt(params?.work_seconds, prescribedSeconds));
  const recoverySeconds = Math.max(0, positiveInt(params?.recovery_seconds, 0));
  const repeats = Math.max(1, positiveInt(params?.repeats, 1));

  const initialElapsed = positiveInt(exercise?.durationSeconds, 0);
  const [started, setStarted] = useState(initialElapsed > 0);
  const [paused, setPaused] = useState(false);
  const [elapsed, setElapsed] = useState(initialElapsed);
  const [distance, setDistance] = useState(exercise?.distanceMeters != null ? String(exercise.distanceMeters) : '');
  const [rpe, setRpe] = useState(exercise?.rpe != null ? String(exercise.rpe) : '');

  useEffect(() => {
    if (!started || paused || elapsed >= prescribedSeconds) return undefined;
    const timer = setInterval(() => {
      setElapsed((current) => Math.min(prescribedSeconds, current + 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [elapsed, paused, prescribedSeconds, started]);

  const phase = useMemo(() => {
    if (!isIntervals) {
      return {
        label: elapsed >= prescribedSeconds ? 'TERMINÉ' : 'EFFORT',
        remaining: Math.max(0, prescribedSeconds - elapsed),
        completedIntervals: 0,
        intervalNumber: 1,
      };
    }

    if (elapsed >= prescribedSeconds) {
      return {
        label: 'TERMINÉ',
        remaining: 0,
        completedIntervals: repeats,
        intervalNumber: repeats,
      };
    }

    const cycle = Math.max(1, workSeconds + recoverySeconds);
    const fullCycles = Math.floor(elapsed / cycle);
    const within = elapsed % cycle;
    const inRecovery = recoverySeconds > 0 && within >= workSeconds;
    const completedIntervals = Math.min(repeats, fullCycles + (inRecovery ? 1 : 0));
    const intervalNumber = Math.min(repeats, fullCycles + 1);
    const remaining = inRecovery ? Math.max(0, cycle - within) : Math.max(0, workSeconds - within);

    return {
      label: inRecovery ? 'RÉCUPÉRATION' : 'EFFORT',
      remaining,
      completedIntervals,
      intervalNumber,
    };
  }, [elapsed, isIntervals, prescribedSeconds, recoverySeconds, repeats, workSeconds]);

  const title = isRun ? runFamilyLabel(mechanic, block) : blockTitle(block, 'Cardio');
  const intensityCue = runIntensityCueLabel(params?.intensity_cue);
  const recoveryCue = runRecoveryCueLabel(params?.recovery_mode);
  const phaseCue = phase.label === 'RÉCUPÉRATION' ? recoveryCue : intensityCue;
  const workLabel = formatRunDuration(workSeconds);
  const recoveryLabel = formatRunDuration(recoverySeconds);
  const totalLabel = formatRunDuration(prescribedSeconds);

  function finish() {
    if (!started && elapsed <= 0) {
      Alert.alert('Chrono non démarré', 'Démarre le chrono avant de terminer ce bloc.');
      return;
    }

    onComplete({
      elapsedSeconds: elapsed,
      distanceMeters: distance.trim() ? numberOr(distance.replace(',', '.'), null) : null,
      rpe: rpe.trim() ? positiveInt(rpe, null) : null,
      intervalsCompleted: isIntervals ? phase.completedIntervals : null,
      protocolCompleted: elapsed >= prescribedSeconds,
      mechanic,
      parameters: params,
      controlledTiming: true,
    });
  }

  if (!isRun) {
    return (
      <View style={styles.card}>
        <Text style={styles.cardTitle}>{title}</Text>
        {exercise?.prescription ? <Text style={styles.prescription}>{exercise.prescription}</Text> : null}

        <View style={styles.timerBox}>
          <Text style={styles.timer}>{formatClock(elapsed)}</Text>
          <Text style={styles.timerTarget}>/ {formatClock(prescribedSeconds)}</Text>
        </View>

        <View style={styles.timerActions}>
          {!started ? (
            <Pressable onPress={() => setStarted(true)} style={({ pressed }) => [styles.primaryButton, styles.flexButton, pressed && styles.pressed]}>
              <Text style={styles.primaryButtonText}>DÉMARRER</Text>
            </Pressable>
          ) : (
            <Pressable onPress={() => setPaused((current) => !current)} style={({ pressed }) => [styles.secondaryButton, styles.flexButton, pressed && styles.pressed]}>
              <Text style={styles.secondaryButtonText}>{paused ? 'REPRENDRE' : 'PAUSE'}</Text>
            </Pressable>
          )}
        </View>

        <View style={styles.metricsRow}>
          <View style={styles.metricField}>
            <Text style={styles.inputLabel}>DISTANCE RÉELLE (M)</Text>
            <TextInput
              value={distance}
              onChangeText={setDistance}
              placeholder="Optionnel"
              placeholderTextColor={colors.textMuted}
              keyboardType="decimal-pad"
              style={styles.metricInput}
            />
          </View>
          <View style={styles.metricFieldSmall}>
            <Text style={styles.inputLabel}>RPE</Text>
            <TextInput
              value={rpe}
              onChangeText={setRpe}
              placeholder="1–10"
              placeholderTextColor={colors.textMuted}
              keyboardType="numeric"
              style={styles.metricInput}
            />
          </View>
        </View>

        <Text style={styles.helperText}>
          {environmentCode === 'OUTDOOR'
            ? 'La distance reste optionnelle : aucun GPS n’est requis.'
            : 'Renseigne seulement ce que tu as réellement mesuré.'}
        </Text>

        <Pressable onPress={finish} style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}>
          <Text style={styles.primaryButtonText}>{elapsed >= prescribedSeconds ? 'TERMINER LE BLOC' : 'ARRÊTER ET TERMINER'}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.card, styles.runCard]}>
      <Text style={styles.runEyebrow}>CONDITIONING COURSE</Text>
      <Text style={styles.cardTitle}>{title}</Text>
      {!started && exercise ? (
        <View style={{ marginTop: 10, alignItems: 'flex-start' }}>
          <EnvironmentSwapOverlay variant="inline" targetExercise={exercise} />
        </View>
      ) : null}

      <View style={styles.runBriefPanel}>
        <Text style={styles.runBriefEyebrow}>TA SÉANCE</Text>
        <Text style={styles.runBriefMain}>
          {isIntervals
            ? `${repeats} × ${workLabel} de course`
            : `${totalLabel} de course`}
        </Text>
        {isIntervals && recoverySeconds > 0 ? (
          <Text style={styles.runBriefRecovery}>+ {recoveryLabel} de récupération</Text>
        ) : null}

        {intensityCue ? (
          <View style={styles.runCueRow}>
            <Ionicons name="speedometer-outline" size={16} color={colors.primaryLight} />
            <Text style={styles.runCueText}>{intensityCue}</Text>
          </View>
        ) : null}

        <View style={styles.runTotalRow}>
          <Ionicons name="time-outline" size={14} color={colors.textSecondary} />
          <Text style={styles.runTotalText}>{totalLabel} au total</Text>
        </View>
      </View>

      <View style={styles.runPhaseCard}>
        <Text style={styles.runPhaseLabel}>
          {isIntervals
            ? `${phase.label} · ${phase.intervalNumber}/${repeats}`
            : phase.label === 'TERMINÉ' ? 'TERMINÉ' : 'COURSE'}
        </Text>
        <Text style={styles.runPhaseTime}>{formatClock(phase.remaining)}</Text>
        {phaseCue && phase.label !== 'TERMINÉ' ? (
          <Text style={styles.runPhaseCue}>{phaseCue}</Text>
        ) : null}
      </View>

      <View style={styles.runOverallRow}>
        <Text style={styles.runOverallLabel}>TEMPS TOTAL</Text>
        <Text style={styles.runOverallValue}>{formatClock(elapsed)} / {formatClock(prescribedSeconds)}</Text>
      </View>

      <View style={styles.timerActions}>
        {!started ? (
          <Pressable
            onPress={() => setStarted(true)}
            style={({ pressed }) => [styles.runStartButton, styles.flexButton, pressed && styles.pressed]}
          >
            <Ionicons name="play" size={18} color={colors.brandWhite} />
            <Text style={styles.primaryButtonText}>DÉMARRER</Text>
          </Pressable>
        ) : elapsed < prescribedSeconds ? (
          <Pressable
            onPress={() => setPaused((current) => !current)}
            style={({ pressed }) => [styles.secondaryButton, styles.flexButton, pressed && styles.pressed]}
          >
            <Ionicons name={paused ? 'play' : 'pause'} size={17} color={colors.textPrimary} />
            <Text style={styles.secondaryButtonText}>{paused ? 'REPRENDRE' : 'PAUSE'}</Text>
          </Pressable>
        ) : null}
      </View>

      {(started || elapsed > 0) ? (
        <View style={styles.runMetricsPanel}>
          <Text style={styles.runMetricsEyebrow}>APRÈS L’EFFORT · OPTIONNEL</Text>
          <View style={styles.metricsRowCompact}>
            <View style={styles.metricField}>
              <Text style={styles.inputLabel}>DISTANCE (M)</Text>
              <TextInput
                value={distance}
                onChangeText={setDistance}
                placeholder="Optionnel"
                placeholderTextColor={colors.textMuted}
                keyboardType="decimal-pad"
                style={styles.metricInput}
              />
            </View>
            <View style={styles.metricFieldSmall}>
              <Text style={styles.inputLabel}>RPE</Text>
              <TextInput
                value={rpe}
                onChangeText={setRpe}
                placeholder="1–10"
                placeholderTextColor={colors.textMuted}
                keyboardType="numeric"
                style={styles.metricInput}
              />
            </View>
          </View>
          {environmentCode === 'OUTDOOR' ? (
            <Text style={styles.helperText}>Aucun GPS n’est requis. Renseigne seulement ce que tu as réellement mesuré.</Text>
          ) : null}
        </View>
      ) : null}

      {elapsed >= prescribedSeconds ? (
        <Pressable onPress={finish} style={({ pressed }) => [styles.runStartButton, pressed && styles.pressed]}>
          <Ionicons name="checkmark" size={18} color={colors.brandWhite} />
          <Text style={styles.primaryButtonText}>TERMINER LE BLOC</Text>
        </Pressable>
      ) : started ? (
        <Pressable onPress={finish} style={({ pressed }) => [styles.stopButton, pressed && styles.pressed]}>
          <Ionicons name="stop-circle-outline" size={17} color={colors.brandRed} />
          <Text style={styles.stopButtonText}>ARRÊTER LE BLOC</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export default function EnvironmentSessionCore({
  environmentCode,
  onOpenOverview,
  onOpenPlanB,
  onOpenWhy,
  onOpenAdjust,
  showPlanB = false,
}) {
  const { workout, updateWorkout } = useWorkout();
  const { colors: themeColors, isDark } = useUgerodTheme();
  const shellStyles = useMemo(
    () => createShellStyles(themeColors, isDark),
    [themeColors, isDark]
  );
  const [currentIndex, setCurrentIndex] = useState(0);
  const sessionStartPromise = useRef(null);

  const blocks = useMemo(() => {
    const raw = Array.isArray(workout.rawBlocks) ? workout.rawBlocks : [];
    if (raw.length > 0) return raw;
    return Object.values(workout.blocks ?? {});
  }, [workout.blocks, workout.rawBlocks]);

  const currentBlock = blocks[currentIndex] ?? null;
  const currentKey = blockKey(currentBlock);
  const currentExercises = useMemo(
    () => (workout.exercises ?? []).filter(
      (exercise) => String(exercise.blockKey ?? exercise.block ?? '').toLowerCase() === currentKey
    ),
    [currentKey, workout.exercises]
  );

  const [setDrafts, setSetDrafts] = useState({});

  const structuredStrength = useMemo(() => {
    if (!currentBlock || !['strength', 'gym', 'street_gym'].includes(currentKey)) return false;
    if (currentKey !== 'gym') return true;
    return currentExercises.length > 0 && currentExercises.every((exercise) => getSetCount(exercise, currentBlock) > 0);
  }, [currentBlock, currentExercises, currentKey]);

  useEffect(() => {
    if (!currentBlock || !structuredStrength) return;
    setSetDrafts(initialSetDrafts(currentExercises, currentBlock));
  }, [currentBlock, currentExercises, structuredStrength]);

  useEffect(() => {
    const firstPending = blocks.findIndex((block) => !blockIsDone(block, workout.exercises ?? []));
    if (firstPending >= 0) setCurrentIndex(firstPending);
  }, [blocks, workout.exercises]);

  const ensureStarted = useCallback(async () => {
    if (workout.sessionStarted) return { status: 'IN_PROGRESS' };
    if (sessionStartPromise.current) return sessionStartPromise.current;

    updateWorkout({
      sessionStarted: true,
      status: 'in_progress',
      startedAt: workout.startedAt ?? new Date().toISOString(),
    });

    sessionStartPromise.current = markWorkoutSessionStarted({ sessionId: workout.sessionId })
      .then((result) => {
        updateWorkout({
          sessionStarted: true,
          status: 'in_progress',
          startedLocalDate: result?.started_local_date ?? workout.startedLocalDate ?? null,
        });
        return result;
      })
      .catch((error) => {
        updateWorkout({ sessionStarted: false, status: 'generated' });
        sessionStartPromise.current = null;
        throw error;
      });

    return sessionStartPromise.current;
  }, [updateWorkout, workout.sessionId, workout.sessionStarted, workout.startedAt, workout.startedLocalDate]);

  const handleWodRuntimeChange = useCallback((runtime) => {
    updateWorkout({ wodRuntime: runtime });
  }, [updateWorkout]);

  function writeExerciseUpdates(updatesByKey) {
    const nextExercises = (workout.exercises ?? []).map((exercise) => {
      const next = updatesByKey[exerciseKey(exercise)];
      return next ? { ...exercise, ...next } : exercise;
    });
    updateWorkout({ exercises: nextExercises });
    return nextExercises;
  }

  async function advanceWithUpdates(updatesByKey) {
    try {
      await ensureStarted();
    } catch (error) {
      Alert.alert('Impossible de démarrer la séance', error?.message ?? 'Réessaie.');
      return;
    }

    writeExerciseUpdates(updatesByKey);

    const nextIndex = currentIndex + 1;
    if (nextIndex < blocks.length) {
      setCurrentIndex(nextIndex);
      return;
    }

    router.push('/workout/completion');
  }

  function completeSimpleBlock() {
    const updates = {};
    for (const exercise of currentExercises) {
      updates[exerciseKey(exercise)] = { status: 'completed', userExecutionStatus: 'completed' };
    }
    advanceWithUpdates(updates);
  }

  function completeStrengthBlock() {
    const updates = {};

    for (const exercise of currentExercises) {
      const key = exerciseKey(exercise);
      const draft = setDrafts[key] ?? { reps: '', sets: [] };
      const rows = draft.sets ?? [];
      const repsEnabled = usesReps(exercise);

      if (rows.length === 0) {
        Alert.alert(
          'Séries indisponibles',
          `UGEROD n’a reçu aucun nombre de séries/tours pour ${exercise.name}. Le bloc reste fermé pour éviter d’inventer du volume.`
        );
        return;
      }

      const reps = repsEnabled
        ? optionalNumber(draft.reps)
        : null;

      if (repsEnabled && reps == null) {
        Alert.alert(
          'Répétitions manquantes',
          `Renseigne le nombre de répétitions prévu pour toutes les séries de ${exercise.name}.`
        );
        return;
      }

      const completedRows = rows.filter((row) => row.done);

      if (completedRows.length !== rows.length) {
        Alert.alert(
          'Séries restantes',
          `Valide les ${rows.length - completedRows.length} série(s) restante(s) de ${exercise.name} avant de terminer le bloc.`
        );
        return;
      }

      const gymSets = completedRows.map((row) => ({
        set_index: row.setIndex,
        status: 'completed',
        reps,
        load_kg: row.load.trim() ? numberOr(row.load.replace(',', '.'), null) : null,
        rpe: null,
      }));

      updates[key] = {
        status: 'completed',
        userExecutionStatus: 'completed',
        repsCompleted: reps,
        performanceActualJson: {
          ...(exercise.performanceActualJson ?? {}),
          gym_sets: gymSets,
          source: 'ugerod_gym_player',
        },
      };
    }

    advanceWithUpdates(updates);
  }

  function completeTimedBlock(result) {  function completeTimedBlock(result) {
    const exercise = currentExercises[0];
    if (!exercise) {
      Alert.alert('Bloc incomplet', 'Aucun exercice exécutable n’a été reçu.');
      return;
    }

    const key = exerciseKey(exercise);
    const isOutdoorRun = environmentCode === 'OUTDOOR' && isRunMechanic(result.mechanic);
    const actual = {
      ...(exercise.performanceActualJson ?? {}),
      elapsed_seconds: result.elapsedSeconds,
      controlled_timing: result.controlledTiming,
      protocol_completed: result.protocolCompleted,
    };

    if (result.distanceMeters != null) actual.distance_meters = result.distanceMeters;

    if (isOutdoorRun) {
      actual.running_mechanic = result.mechanic;
      actual.running_family_code =
        currentBlock?.mechanic_json?.variant_key ??
        currentBlock?.mechanicJson?.variant_key ??
        currentBlock?.running_protocol?.family_code ??
        null;
      actual.planned_duration_seconds = positiveInt(result.parameters?.duration_seconds, 0);
      actual.planned_work_seconds = positiveInt(result.parameters?.work_seconds, 0);
      actual.planned_recovery_seconds = positiveInt(result.parameters?.recovery_seconds, 0);
      actual.reliable_distance = Boolean(result.parameters?.reliable_distance);
      if (result.intervalsCompleted != null) actual.intervals_completed = result.intervalsCompleted;
      actual.source = 'ugerod_environment_player';
    }

    advanceWithUpdates({
      [key]: {
        status: 'completed',
        userExecutionStatus: 'completed',
        durationSeconds: result.elapsedSeconds,
        distanceMeters: result.distanceMeters,
        rpe: result.rpe,
        performanceActualJson: actual,
      },
    });
  }

  function completeWodBlock() {
    const runtime = workout.wodRuntime;
    const executionStatus = wodExecutionStatus(runtime);

    if (executionStatus === 'pending') {
      Alert.alert('WOD en cours', 'Termine ou arrête le WOD avant de valider ce bloc.');
      return;
    }

    const updates = {};
    for (const exercise of currentExercises) {
      updates[exerciseKey(exercise)] = {
        status: executionStatus,
        userExecutionStatus: executionStatus,
      };
    }
    advanceWithUpdates(updates);
  }

  if (!workout.sessionId || blocks.length === 0 || !currentBlock) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.emptyState}>
          <Ionicons name="alert-circle-outline" size={28} color={colors.textSecondary} />
          <Text style={styles.cardTitle}>SÉANCE INCOMPLÈTE</Text>
          <Text style={styles.prescription}>Aucun bloc environnement exécutable n’a été chargé.</Text>
          <Pressable onPress={() => router.replace('/workout/preparation')} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>REVENIR AU CHECK-IN</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const mechanic = blockMechanic(currentBlock);
  const timed = isRunMechanic(mechanic) || currentKey === 'cardio' || mechanic === 'CARDIO_CONTINUOUS';
  const tabata = currentKey === 'tabata' || ['TABATA', 'TABATA_ABS'].includes(normalize(currentBlock?.module_code));
  const manualGym = currentKey === 'gym' && !structuredStrength;
  const canonicalWod = currentKey === 'wod' && !isRunMechanic(mechanic);

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: themeColors.background }]}>
      <View style={shellStyles.header}>
        <View style={shellStyles.headerTop}>
          <Pressable
            onPress={() => router.replace('/workout/preparation')}
            hitSlop={12}
            style={shellStyles.iconButton}
          >
            <Ionicons name="arrow-back" size={21} color={themeColors.text} />
          </Pressable>

          <View style={shellStyles.headerCopy}>
            <Text style={shellStyles.headerEyebrow}>
              {(environmentCode === 'GYM' ? 'SALLE' : 'EXTÉRIEUR')} · Bloc {currentIndex + 1}/{blocks.length}
            </Text>
            <Text style={shellStyles.headerTitle}>
              {blockTitle(currentBlock, currentKey.toUpperCase())}
            </Text>
            <Text numberOfLines={1} style={shellStyles.headerMeta}>
              {[
                currentBlock?.structure ?? currentBlock?.execution_style?.label_fr ?? null,
                Number(currentBlock?.duration_minutes ?? currentBlock?.durationMinutes) > 0
                  ? `${Number(currentBlock?.duration_minutes ?? currentBlock?.durationMinutes)} min`
                  : null,
              ].filter(Boolean).join(' · ')}
            </Text>
          </View>

          {typeof onOpenOverview === 'function' ? (
            <Pressable
              onPress={onOpenOverview}
              accessibilityRole="button"
              accessibilityLabel="Voir ma séance"
              style={shellStyles.overviewButton}
            >
              <Ionicons name="clipboard-outline" size={17} color={themeColors.text} />
              <Text style={shellStyles.overviewButtonText}>Ma séance</Text>
            </Pressable>
          ) : null}
        </View>

        <View style={shellStyles.coachTools}>
          {typeof onOpenWhy === 'function' ? (
            <Pressable onPress={onOpenWhy} style={shellStyles.coachTool}>
              <Ionicons name="help-circle-outline" size={17} color={themeColors.textSecondary} />
              <Text style={shellStyles.coachToolText}>Pourquoi ?</Text>
            </Pressable>
          ) : null}
          {typeof onOpenAdjust === 'function' ? (
            <Pressable onPress={onOpenAdjust} style={shellStyles.coachTool}>
              <Ionicons name="options-outline" size={17} color={themeColors.accent} />
              <Text style={shellStyles.coachToolText}>Ajuster</Text>
            </Pressable>
          ) : null}
          {showPlanB && typeof onOpenPlanB === 'function' ? (
            <Pressable onPress={onOpenPlanB} style={shellStyles.coachTool}>
              <Ionicons name="shuffle-outline" size={17} color={themeColors.secondaryAccent} />
              <Text style={shellStyles.coachToolText}>Plan B</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      <View style={shellStyles.progressTrack}>
        <View
          style={[
            shellStyles.progressFill,
            { width: `${blocks.length > 0 ? Math.round((currentIndex / blocks.length) * 100) : 0}%` },
          ]}
        />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {timed ? (
          <TimedBlock
            key={`${currentKey}:${mechanic}`}
            block={currentBlock}
            exercise={currentExercises[0]}
            environmentCode={environmentCode}
            onComplete={completeTimedBlock}
          />
        ) : canonicalWod ? (
          <EnvironmentWodBlock
            key={`${currentKey}:${mechanic}`}
            block={currentBlock}
            exercises={currentExercises}
            runtime={workout.wodRuntime ?? null}
            onBeforeStart={ensureStarted}
            onRuntimeChange={handleWodRuntimeChange}
            onComplete={completeWodBlock}
          />
        ) : tabata ? (
          <TabataBlock
            key={`${currentKey}:${currentIndex}`}
            block={currentBlock}
            exercises={currentExercises}
            onComplete={advanceWithUpdates}
          />
        ) : structuredStrength ? (
          <StrengthBlock
            block={currentBlock}
            exercises={currentExercises}
            drafts={setDrafts}
            setDrafts={setSetDrafts}
            onComplete={completeStrengthBlock}
          />
        ) : manualGym ? (
          <ManualGymBlock
            key={`${currentKey}:${currentIndex}`}
            block={currentBlock}
            exercises={currentExercises}
            onComplete={advanceWithUpdates}
          />
        ) : (
          <SimpleBlock block={currentBlock} exercises={currentExercises} onComplete={completeSimpleBlock} />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function createShellStyles(colors, isDark) {
  return StyleSheet.create({
    header: {
      paddingHorizontal: spacing.lg,
      paddingTop: 8,
      paddingBottom: 10,
      backgroundColor: colors.background,
    },
    headerTop: {
      minHeight: 64,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    iconButton: {
      width: 42,
      height: 42,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surfaceElevated,
      borderWidth: 1,
      borderColor: colors.border,
    },
    headerCopy: { flex: 1, minWidth: 0 },
    headerEyebrow: {
      fontFamily: 'Manrope_700Bold',
      fontSize: 9,
      letterSpacing: 0.7,
      textTransform: 'uppercase',
      color: colors.accent,
    },
    headerTitle: {
      marginTop: 2,
      fontFamily: 'Manrope_800ExtraBold',
      fontSize: 22,
      lineHeight: 27,
      color: colors.text,
    },
    headerMeta: {
      marginTop: 2,
      fontFamily: 'Manrope_500Medium',
      fontSize: 10,
      lineHeight: 14,
      color: colors.textSecondary,
    },
    overviewButton: {
      minHeight: 38,
      paddingHorizontal: 10,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceElevated,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    overviewButtonText: {
      fontFamily: 'Manrope_700Bold',
      fontSize: 10,
      color: colors.text,
    },
    coachTools: {
      marginTop: 8,
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    coachTool: {
      minHeight: 36,
      paddingHorizontal: 11,
      borderRadius: 11,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
    },
    coachToolText: {
      fontFamily: 'Manrope_700Bold',
      fontSize: 10,
      color: colors.text,
    },
    progressTrack: { height: 3, backgroundColor: colors.border },
    progressFill: { height: 3, backgroundColor: colors.accent },
  });
}

function createGymStyles(colors, isDark) {
  return StyleSheet.create({
    pressed: { opacity: 0.72 },
    blockHint: {
      marginBottom: 12,
      paddingHorizontal: 14,
      paddingVertical: 12,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.accentSoft,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    blockHintText: {
      flex: 1,
      fontFamily: 'Manrope_600SemiBold',
      fontSize: 11,
      lineHeight: 16,
      color: colors.textSecondary,
    },
    exerciseCard: {
      marginBottom: 12,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceElevated,
      overflow: 'hidden',
    },
    exerciseCardActive: {
      borderColor: colors.accent,
      shadowColor: colors.shadow,
      shadowOpacity: isDark ? 0.18 : 0.08,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 4 },
      elevation: 2,
    },
    exerciseHeader: {
      minHeight: 88,
      paddingHorizontal: 16,
      paddingVertical: 14,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    exerciseHeaderCopy: { flex: 1, minWidth: 0 },
    exerciseHeaderStatus: {
      alignItems: 'flex-end',
      justifyContent: 'center',
      gap: 7,
    },
    exerciseEyebrow: {
      fontFamily: 'Manrope_700Bold',
      fontSize: 9,
      letterSpacing: 0.75,
      color: colors.accent,
    },
    exerciseName: {
      marginTop: 3,
      fontFamily: 'Manrope_800ExtraBold',
      fontSize: 18,
      lineHeight: 23,
      color: colors.text,
    },
    exerciseSummary: {
      marginTop: 4,
      fontFamily: 'Manrope_500Medium',
      fontSize: 11,
      lineHeight: 16,
      color: colors.textSecondary,
    },
    exerciseProgress: {
      minWidth: 34,
      textAlign: 'right',
      fontFamily: 'Manrope_700Bold',
      fontSize: 11,
      color: colors.textSecondary,
    },
    exerciseBody: {
      paddingHorizontal: 16,
      paddingBottom: 16,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    globalFieldRow: {
      paddingVertical: 14,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
    },
    globalFieldCopy: { flex: 1 },
    fieldLabel: {
      fontFamily: 'Manrope_700Bold',
      fontSize: 9,
      letterSpacing: 0.65,
      color: colors.textSecondary,
    },
    fieldHelp: {
      marginTop: 3,
      fontFamily: 'Manrope_500Medium',
      fontSize: 10,
      lineHeight: 14,
      color: colors.textMuted,
    },
    repsInputWrap: {
      minWidth: 112,
      minHeight: 46,
      paddingHorizontal: 10,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.borderStrong,
      backgroundColor: colors.background,
      flexDirection: 'row',
      alignItems: 'center',
    },
    repsInput: {
      minWidth: 44,
      paddingVertical: 8,
      textAlign: 'right',
      fontFamily: 'Manrope_800ExtraBold',
      fontSize: 16,
      color: colors.text,
    },
    inputSuffix: {
      marginLeft: 6,
      fontFamily: 'Manrope_600SemiBold',
      fontSize: 10,
      color: colors.textMuted,
    },
    exerciseActionsRow: {
      paddingTop: 12,
      paddingBottom: 14,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    exerciseActionHelp: {
      flex: 1,
      fontFamily: 'Manrope_500Medium',
      fontSize: 9.5,
      lineHeight: 14,
      color: colors.textMuted,
    },
    setsPanel: {
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      overflow: 'hidden',
    },
    setsTitle: {
      paddingHorizontal: 12,
      paddingTop: 10,
      paddingBottom: 7,
      fontFamily: 'Manrope_700Bold',
      fontSize: 9,
      letterSpacing: 0.75,
      color: colors.textMuted,
    },
    setRow: {
      minHeight: 54,
      paddingHorizontal: 10,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 9,
      backgroundColor: colors.surface,
    },
    setRowDone: {
      backgroundColor: colors.successSoft,
    },
    checkButton: {
      width: 36,
      height: 36,
      borderRadius: 11,
      borderWidth: 1,
      borderColor: colors.borderStrong,
      backgroundColor: colors.background,
      alignItems: 'center',
      justifyContent: 'center',
    },
    checkButtonDone: {
      backgroundColor: colors.accent,
      borderColor: colors.accent,
    },
    setLabel: {
      width: 28,
      fontFamily: 'Manrope_700Bold',
      fontSize: 11,
      color: colors.textSecondary,
    },
    setRepsText: {
      flex: 1,
      fontFamily: 'Manrope_600SemiBold',
      fontSize: 11,
      color: colors.text,
    },
    loadInputWrap: {
      minWidth: 100,
      minHeight: 40,
      paddingHorizontal: 9,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.background,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-end',
    },
    loadInput: {
      minWidth: 45,
      paddingVertical: 7,
      textAlign: 'right',
      fontFamily: 'Manrope_700Bold',
      fontSize: 12,
      color: colors.text,
    },
    warningText: {
      marginTop: 12,
      fontFamily: 'Manrope_600SemiBold',
      fontSize: 10,
      lineHeight: 15,
      color: colors.error,
    },
    primaryButton: {
      minHeight: 54,
      marginTop: 4,
      paddingHorizontal: 18,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'row',
      gap: 8,
      backgroundColor: colors.accent,
    },
    primaryButtonText: {
      fontFamily: 'Manrope_800ExtraBold',
      fontSize: 11,
      letterSpacing: 0.4,
      color: colors.textOnAccent,
    },
    manualFieldsRow: {
      marginTop: 14,
      flexDirection: 'row',
      gap: 10,
    },
    manualField: { flex: 1 },
    manualInput: {
      minHeight: 44,
      marginTop: 6,
      paddingHorizontal: 11,
      borderRadius: 11,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.background,
      fontFamily: 'Manrope_700Bold',
      fontSize: 12,
      color: colors.text,
    },
  });
}

function createEnvironmentFocusedStyles(colors, isDark) {
  return StyleSheet.create({
    mediaCard: {
      minHeight: 190,
      borderRadius: 18,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    mediaFallback: {
      flex: 1,
      minHeight: 190,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
      backgroundColor: colors.surface,
    },
    mediaFallbackIcon: {
      width: 64,
      height: 64,
      borderRadius: 22,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.accentSoft,
    },
    mediaFallbackText: {
      fontFamily: 'Manrope_800ExtraBold',
      fontSize: 16,
      color: colors.textSecondary,
    },
    mediaOverlayTop: {
      position: 'absolute',
      top: 12,
      right: 12,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 999,
      backgroundColor: isDark ? 'rgba(0,0,0,0.58)' : 'rgba(255,255,255,0.88)',
    },
    exercisePosition: {
      fontFamily: 'Manrope_700Bold',
      fontSize: 9,
      color: colors.text,
    },
    exerciseCard: {
      marginTop: 12,
      padding: 18,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceElevated,
    },
    exerciseName: {
      fontFamily: 'Manrope_800ExtraBold',
      fontSize: 20,
      lineHeight: 25,
      color: colors.text,
    },
    exercisePrescription: {
      marginTop: 6,
      fontFamily: 'Manrope_500Medium',
      fontSize: 13,
      lineHeight: 19,
      color: colors.textSecondary,
    },
    exerciseNav: {
      marginTop: 12,
      minHeight: 42,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
    },
    navButton: {
      width: 42,
      height: 42,
      borderRadius: 13,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    navDots: { flex: 1, flexDirection: 'row', justifyContent: 'center', gap: 7 },
    navDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.borderStrong },
    navDotActive: { width: 20, backgroundColor: colors.accent },
    actionDisabled: { opacity: 0.35 },
    primaryButtonLarge: {
      minHeight: 54,
      marginTop: 14,
      paddingHorizontal: 18,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'row',
      gap: 8,
      backgroundColor: colors.accent,
    },
    primaryButtonTextLarge: {
      fontFamily: 'Manrope_800ExtraBold',
      fontSize: 12,
      color: colors.textOnAccent,
    },
  });
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  header: {
    minHeight: 66,
    paddingHorizontal: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconButton: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  headerCopy: { flex: 1 },
  eyebrow: {
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 9,
    letterSpacing: 1.1,
    color: colors.primaryLight,
  },
  headerTitle: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 25,
    lineHeight: 28,
    color: colors.textPrimary,
  },
  stepText: {
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 11,
    color: colors.textSecondary,
  },
  progressTrack: { height: 3, backgroundColor: colors.border },
  progressFill: { height: 3, backgroundColor: colors.primary },
  content: { padding: spacing.lg, paddingBottom: 42 },
  card: {
    padding: spacing.lg,
    borderRadius: 18,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardTitle: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 28,
    lineHeight: 31,
    letterSpacing: 0.8,
    color: colors.textPrimary,
  },
  cardMeta: {
    marginTop: 4,
    fontFamily: 'Oswald_400Regular',
    fontSize: 11,
    lineHeight: 16,
    color: colors.textSecondary,
  },
  exerciseRow: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  bullet: {
    width: 7,
    height: 7,
    marginTop: 7,
    borderRadius: 4,
    backgroundColor: colors.primary,
  },
  exerciseCopy: { flex: 1 },
  exerciseName: {
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 14,
    color: colors.textPrimary,
  },
  prescription: {
    marginTop: 3,
    fontFamily: 'Oswald_400Regular',
    fontSize: 11,
    lineHeight: 16,
    color: colors.textSecondary,
  },
  strengthExercise: {
    marginTop: 16,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  setRow: {
    marginTop: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  setLabel: {
    width: 28,
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 11,
    color: colors.textSecondary,
  },
  input: {
    flex: 1,
    minHeight: 40,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    fontFamily: 'Oswald_500Medium',
    fontSize: 12,
    color: colors.textPrimary,
  },
  warningText: {
    marginTop: 8,
    fontFamily: 'Oswald_400Regular',
    fontSize: 11,
    lineHeight: 16,
    color: colors.brandRed,
  },
  primaryButton: {
    minHeight: 48,
    marginTop: 18,
    paddingHorizontal: 15,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  primaryButtonText: {
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 11,
    letterSpacing: 0.8,
    color: colors.brandWhite,
  },
  secondaryButton: {
    minHeight: 48,
    marginTop: 18,
    paddingHorizontal: 15,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  secondaryButtonText: {
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 11,
    letterSpacing: 0.8,
    color: colors.textPrimary,
  },
  flexButton: { flex: 1 },
  pressed: { opacity: 0.72 },
  timerBox: {
    marginTop: 20,
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
  },
  timer: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 62,
    lineHeight: 66,
    color: colors.textPrimary,
  },
  timerTarget: {
    marginLeft: 7,
    fontFamily: 'Oswald_400Regular',
    fontSize: 14,
    color: colors.textMuted,
  },
  phaseBox: {
    marginTop: 12,
    padding: 14,
    borderRadius: 14,
    alignItems: 'center',
    backgroundColor: colors.background,
  },
  phaseLabel: {
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 11,
    letterSpacing: 1,
    color: colors.primaryLight,
  },
  phaseTime: {
    marginTop: 2,
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 34,
    color: colors.textPrimary,
  },
  timerActions: { flexDirection: 'row', gap: 9 },
  metricsRow: { marginTop: 16, flexDirection: 'row', gap: 10 },
  metricsRowCompact: { marginTop: 10, flexDirection: 'row', gap: 10 },
  metricField: { flex: 1 },
  metricFieldSmall: { width: 92 },
  inputLabel: {
    marginBottom: 5,
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 9,
    letterSpacing: 0.7,
    color: colors.textSecondary,
  },
  metricInput: {
    minHeight: 44,
    paddingHorizontal: 11,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    fontFamily: 'Oswald_500Medium',
    fontSize: 12,
    color: colors.textPrimary,
  },
  helperText: {
    marginTop: 8,
    fontFamily: 'Oswald_400Regular',
    fontSize: 10,
    lineHeight: 15,
    color: colors.textMuted,
  },
  runCard: {
    borderRadius: 20,
    backgroundColor: 'rgba(7,10,14,0.94)',
    borderColor: 'rgba(8,104,255,0.30)',
  },
  runEyebrow: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 9,
    letterSpacing: 0.9,
    color: colors.primaryLight,
    marginBottom: 2,
  },
  runBriefPanel: {
    marginTop: 16,
    borderRadius: 16,
    padding: 16,
    backgroundColor: 'rgba(8,104,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(8,104,255,0.22)',
  },
  runBriefEyebrow: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 8,
    letterSpacing: 0.9,
    color: colors.primaryLight,
  },
  runBriefMain: {
    marginTop: 5,
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 27,
    lineHeight: 30,
    letterSpacing: 0.9,
    color: colors.textPrimary,
  },
  runBriefRecovery: {
    marginTop: 2,
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 12,
    lineHeight: 18,
    color: colors.textPrimary,
  },
  runCueRow: {
    marginTop: 12,
    paddingTop: 11,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.07)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  runCueText: {
    flex: 1,
    fontFamily: 'Oswald_400Regular',
    fontSize: 11,
    lineHeight: 17,
    color: colors.textSecondary,
  },
  runTotalRow: {
    marginTop: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  runTotalText: {
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 10,
    letterSpacing: 0.3,
    color: colors.textSecondary,
  },
  runPhaseCard: {
    marginTop: 14,
    borderRadius: 16,
    paddingVertical: 18,
    paddingHorizontal: 16,
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.035)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
  },
  runPhaseLabel: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 10,
    letterSpacing: 1,
    color: colors.primaryLight,
  },
  runPhaseTime: {
    marginTop: 2,
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 58,
    lineHeight: 62,
    color: colors.textPrimary,
  },
  runPhaseCue: {
    marginTop: 4,
    maxWidth: 300,
    fontFamily: 'Oswald_400Regular',
    fontSize: 11,
    lineHeight: 17,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  runOverallRow: {
    marginTop: 11,
    paddingHorizontal: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  runOverallLabel: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 8,
    letterSpacing: 0.7,
    color: colors.textMuted,
  },
  runOverallValue: {
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 11,
    color: colors.textSecondary,
  },
  runStartButton: {
    flexDirection: 'row',
    gap: 8,
    minHeight: 50,
    marginTop: 15,
    paddingHorizontal: 17,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  runMetricsPanel: {
    marginTop: 16,
    borderRadius: 14,
    padding: 13,
    backgroundColor: 'rgba(255,255,255,0.025)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  runMetricsEyebrow: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 8,
    letterSpacing: 0.7,
    color: colors.textMuted,
  },
  stopButton: {
    minHeight: 44,
    marginTop: 14,
    paddingHorizontal: 15,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    backgroundColor: 'rgba(255,255,255,0.02)',
    borderWidth: 1,
    borderColor: 'rgba(255,80,80,0.24)',
  },
  stopButtonText: {
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 10,
    letterSpacing: 0.7,
    color: colors.brandRed,
  },
  emptyState: {
    flex: 1,
    padding: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
});