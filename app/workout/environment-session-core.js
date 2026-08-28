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

function positiveInt(value, fallback = 0) {
  return Math.max(0, Math.round(numberOr(value, fallback)));
}

function formatClock(totalSeconds) {
  const safe = Math.max(0, Math.floor(numberOr(totalSeconds, 0)));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function blockKey(block) {
  return String(block?.block_key ?? block?.blockKey ?? block?.key ?? '').toLowerCase();
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

  if (labels[family]) {
    return labels[family];
  }

  if (mechanic === 'RUN_CONTINUOUS') return 'Course continue — allure modérée';
  if (mechanic === 'RUN_FARTLEK') return 'Fartlek guidé';
  if (mechanic === 'RUN_INTERVALS') return 'Intervalles';
  if (mechanic === 'RUN_CALIBRATION') return 'Calibration';
  return 'Course';
}

function statusValue(exercise) {
  if (exercise?.userExecutionStatus) return exercise.userExecutionStatus;
  if (exercise?.status === 'skipped') return 'not_completed';
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
    prescription?.block_parameters?.sets ??
      prescription?.sets ??
      params?.sets,
    0
  );
}

function usesLoad(exercise) {
  const modes = Array.isArray(exercise?.trackingModes)
    ? exercise.trackingModes
    : Array.isArray(exercise?.prescriptionJson?.tracking_modes)
      ? exercise.prescriptionJson.tracking_modes
      : [];
  return modes.includes('load');
}

function initialSetDrafts(exercises, block) {
  const next = {};

  for (const exercise of exercises) {
    const key = exerciseKey(exercise);
    const existing = exercise?.performanceActualJson?.gym_sets;
    const setCount = getSetCount(exercise, block);

    if (Array.isArray(existing) && existing.length > 0) {
      next[key] = existing.map((set, index) => ({
        setIndex: positiveInt(set?.set_index, index + 1),
        reps: set?.reps != null ? String(set.reps) : '',
        load: set?.load_kg != null ? String(set.load_kg) : '',
        rpe: set?.rpe != null ? String(set.rpe) : '',
      }));
      continue;
    }

    next[key] = Array.from({ length: setCount }, (_, index) => ({
      setIndex: index + 1,
      reps: '',
      load: '',
      rpe: '',
    }));
  }

  return next;
}

function SimpleBlock({ block, exercises, onComplete }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>
        {block?.label_fr ?? block?.label ?? 'Préparation'}
      </Text>
      {exercises.map((exercise) => (
        <View key={exerciseKey(exercise)} style={styles.exerciseRow}>
          <View style={styles.bullet} />
          <View style={styles.exerciseCopy}>
            <Text style={styles.exerciseName}>{exercise.name}</Text>
            {exercise.prescription ? (
              <Text style={styles.prescription}>{exercise.prescription}</Text>
            ) : null}
          </View>
        </View>
      ))}
      <Pressable onPress={onComplete} style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}>
        <Text style={styles.primaryButtonText}>VALIDER LE BLOC</Text>
      </Pressable>
    </View>
  );
}

function StrengthBlock({ block, exercises, drafts, setDrafts, onComplete }) {
  const mechanic = blockMechanic(block);
  const isCircuit = mechanic === 'CIRCUIT';

  function updateDraft(exercise, setIndex, field, value) {
    const key = exerciseKey(exercise);
    setDrafts((current) => ({
      ...current,
      [key]: (current[key] ?? []).map((row, index) =>
        index === setIndex ? { ...row, [field]: value } : row
      ),
    }));
  }

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>
        {block?.label_fr ?? 'Musculation / Gym'}
      </Text>
      <Text style={styles.cardMeta}>
        {isCircuit ? 'Circuit · saisis chaque tour réalisé' : 'Saisis les séries réellement réalisées'}
      </Text>

      {exercises.map((exercise) => {
        const key = exerciseKey(exercise);
        const rows = drafts[key] ?? [];
        const loadEnabled = usesLoad(exercise);

        return (
          <View key={key} style={styles.strengthExercise}>
            <Text style={styles.exerciseName}>{exercise.name}</Text>
            {exercise.prescription ? (
              <Text style={styles.prescription}>{exercise.prescription}</Text>
            ) : null}

            {rows.length === 0 ? (
              <Text style={styles.warningText}>
                Aucun nombre de séries/tours reçu du moteur. Ce bloc ne peut pas être validé automatiquement.
              </Text>
            ) : (
              rows.map((row, index) => (
                <View key={`${key}:${row.setIndex}`} style={styles.setRow}>
                  <Text style={styles.setLabel}>
                    {isCircuit ? 'T' : 'S'}{row.setIndex}
                  </Text>
                  <TextInput
                    value={row.reps}
                    onChangeText={(value) => updateDraft(exercise, index, 'reps', value)}
                    placeholder="reps"
                    placeholderTextColor={colors.textMuted}
                    keyboardType="numeric"
                    style={styles.input}
                  />
                  {loadEnabled ? (
                    <TextInput
                      value={row.load}
                      onChangeText={(value) => updateDraft(exercise, index, 'load', value)}
                      placeholder="kg"
                      placeholderTextColor={colors.textMuted}
                      keyboardType="decimal-pad"
                      style={styles.input}
                    />
                  ) : null}
                  <TextInput
                    value={row.rpe}
                    onChangeText={(value) => updateDraft(exercise, index, 'rpe', value)}
                    placeholder="RPE"
                    placeholderTextColor={colors.textMuted}
                    keyboardType="numeric"
                    style={styles.input}
                  />
                </View>
              ))
            )}
          </View>
        );
      })}

      <Pressable onPress={onComplete} style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}>
        <Text style={styles.primaryButtonText}>VALIDER MUSCULATION</Text>
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

  const [started, setStarted] = useState(false);
  const [paused, setPaused] = useState(false);
  const [elapsed, setElapsed] = useState(
    positiveInt(exercise?.durationSeconds, 0)
  );
  const [distance, setDistance] = useState(
    exercise?.distanceMeters != null ? String(exercise.distanceMeters) : ''
  );
  const [rpe, setRpe] = useState(exercise?.rpe != null ? String(exercise.rpe) : '');

  useEffect(() => {
    if (!started || paused || elapsed >= prescribedSeconds) {
      return undefined;
    }

    const timer = setInterval(() => {
      setElapsed((current) => Math.min(prescribedSeconds, current + 1));
    }, 1000);

    return () => clearInterval(timer);
  }, [elapsed, paused, prescribedSeconds, started]);

  const phase = useMemo(() => {
    if (!isIntervals) {
      return {
        label: 'EFFORT',
        remaining: Math.max(0, prescribedSeconds - elapsed),
        completedIntervals: 0,
        intervalNumber: 1,
      };
    }

    const cycle = Math.max(1, workSeconds + recoverySeconds);
    const fullCycles = Math.floor(elapsed / cycle);
    const within = elapsed % cycle;
    const inRecovery = recoverySeconds > 0 && within >= workSeconds;
    const completedIntervals = Math.min(
      repeats,
      fullCycles + (inRecovery ? 1 : 0)
    );
    const intervalNumber = Math.min(repeats, fullCycles + 1);
    const remaining = inRecovery
      ? Math.max(0, cycle - within)
      : Math.max(0, workSeconds - within);

    return {
      label: inRecovery ? 'RÉCUPÉRATION' : 'EFFORT',
      remaining,
      completedIntervals,
      intervalNumber,
    };
  }, [elapsed, isIntervals, prescribedSeconds, recoverySeconds, repeats, workSeconds]);

  const title = isRun
    ? runFamilyLabel(mechanic, block)
    : block?.label_fr ?? 'Cardio';

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

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      {exercise?.prescription ? (
        <Text style={styles.prescription}>{exercise.prescription}</Text>
      ) : null}

      <View style={styles.timerBox}>
        <Text style={styles.timer}>{formatClock(elapsed)}</Text>
        <Text style={styles.timerTarget}>/ {formatClock(prescribedSeconds)}</Text>
      </View>

      {isIntervals ? (
        <View style={styles.phaseBox}>
          <Text style={styles.phaseLabel}>{phase.label}</Text>
          <Text style={styles.phaseTime}>{formatClock(phase.remaining)}</Text>
          <Text style={styles.cardMeta}>
            Intervalle {phase.intervalNumber}/{repeats} · {phase.completedIntervals} terminé(s)
          </Text>
        </View>
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
        <Text style={styles.primaryButtonText}>
          {elapsed >= prescribedSeconds ? 'TERMINER LE BLOC' : 'ARRÊTER ET TERMINER'}
        </Text>
      </Pressable>
    </View>
  );
}

export default function EnvironmentSessionCore({ environmentCode }) {
  const { workout, updateWorkout } = useWorkout();
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

  useEffect(() => {
    if (!currentBlock) return;
    if (!['strength', 'gym', 'street_gym'].includes(currentKey)) return;
    setSetDrafts(initialSetDrafts(currentExercises, currentBlock));
  }, [currentBlock, currentExercises, currentKey]);

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

    sessionStartPromise.current = markWorkoutSessionStarted({
      sessionId: workout.sessionId,
    })
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
      updates[exerciseKey(exercise)] = {
        status: 'completed',
        userExecutionStatus: 'completed',
      };
    }
    advanceWithUpdates(updates);
  }

  function completeStrengthBlock() {
    const updates = {};

    for (const exercise of currentExercises) {
      const key = exerciseKey(exercise);
      const rows = setDrafts[key] ?? [];

      if (rows.length === 0) {
        Alert.alert(
          'Séries indisponibles',
          `UGEROD n’a reçu aucun nombre de séries/tours pour ${exercise.name}. Le bloc reste fermé pour éviter d’inventer du volume.`
        );
        return;
      }

      const gymSets = rows
        .filter((row) => row.reps.trim() || row.load.trim() || row.rpe.trim())
        .map((row) => ({
          set_index: row.setIndex,
          status: 'completed',
          reps: row.reps.trim() ? numberOr(row.reps.replace(',', '.'), null) : null,
          load_kg: row.load.trim() ? numberOr(row.load.replace(',', '.'), null) : null,
          rpe: row.rpe.trim() ? numberOr(row.rpe.replace(',', '.'), null) : null,
        }));

      if (gymSets.length === 0) {
        Alert.alert(
          'Performance manquante',
          `Renseigne au moins une série réellement réalisée pour ${exercise.name}.`
        );
        return;
      }

      updates[key] = {
        status: 'completed',
        userExecutionStatus: 'completed',
        performanceActualJson: {
          ...(exercise.performanceActualJson ?? {}),
          gym_sets: gymSets,
          source: 'ugerod_gym_player',
        },
      };
    }

    advanceWithUpdates(updates);
  }

  function completeTimedBlock(result) {
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

  if (!workout.sessionId || blocks.length === 0 || !currentBlock) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.emptyState}>
          <Ionicons name="alert-circle-outline" size={28} color={colors.textSecondary} />
          <Text style={styles.cardTitle}>SÉANCE INCOMPLÈTE</Text>
          <Text style={styles.prescription}>
            Aucun bloc environnement exécutable n’a été chargé.
          </Text>
          <Pressable onPress={() => router.replace('/workout/preparation')} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>REVENIR AU CHECK-IN</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const mechanic = blockMechanic(currentBlock);
  const timed = isRunMechanic(mechanic) || currentKey === 'cardio' || mechanic === 'CARDIO_CONTINUOUS';
  const strength = ['strength', 'gym', 'street_gym'].includes(currentKey);

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.iconButton}>
          <Ionicons name="arrow-back" size={21} color={colors.textPrimary} />
        </Pressable>
        <View style={styles.headerCopy}>
          <Text style={styles.eyebrow}>{environmentCode === 'GYM' ? 'SALLE' : 'EXTÉRIEUR'}</Text>
          <Text style={styles.headerTitle}>
            {currentBlock?.label_fr ?? currentBlock?.label ?? currentKey.toUpperCase()}
          </Text>
        </View>
        <Text style={styles.stepText}>{currentIndex + 1}/{blocks.length}</Text>
      </View>

      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${((currentIndex + 1) / blocks.length) * 100}%` }]} />
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
        ) : strength ? (
          <StrengthBlock
            block={currentBlock}
            exercises={currentExercises}
            drafts={setDrafts}
            setDrafts={setSetDrafts}
            onComplete={completeStrengthBlock}
          />
        ) : (
          <SimpleBlock
            block={currentBlock}
            exercises={currentExercises}
            onComplete={completeSimpleBlock}
          />
        )}
      </ScrollView>
    </SafeAreaView>
  );
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
  emptyState: {
    flex: 1,
    padding: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
});