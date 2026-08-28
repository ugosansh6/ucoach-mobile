import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { colors, spacing } from '../../constants';
import { useWorkout } from '../../contexts/WorkoutContext';
import { adaptSessionExercise } from '../../services/sessionAdaptationService';
import {
  getWorkoutSwapAvailability,
  reloadWorkoutSession,
} from '../../services/workoutService';
import {
  hydrateEnvironmentSessionExerciseIds,
  syncEnvironmentBuilderSwapRuntime,
} from '../../services/environmentSessionRuntimeService';

const SUPPORTED_RUNTIME_BLOCKS = new Set(['gym', 'tabata']);

function statusValue(exercise) {
  if (exercise?.userExecutionStatus) return exercise.userExecutionStatus;
  if (exercise?.status === 'completed') return 'completed';
  if (exercise?.status === 'adapted') return 'adapted';
  if (exercise?.status === 'not_completed' || exercise?.status === 'skipped') return 'not_completed';
  return 'pending';
}

function blockKey(block) {
  return String(block?.block_key ?? block?.blockKey ?? '').toLowerCase();
}

function currentBuilderTarget(workout) {
  const blocks = Array.isArray(workout?.rawBlocks) ? workout.rawBlocks : [];
  const exercises = Array.isArray(workout?.exercises) ? workout.exercises : [];

  for (const block of blocks) {
    const key = blockKey(block);
    const rows = exercises.filter(
      (exercise) => String(exercise.blockKey ?? exercise.block ?? '').toLowerCase() === key
    );
    if (!rows.length || rows.every((exercise) => statusValue(exercise) !== 'pending')) continue;

    const isManualBuilderBlock = Boolean(block?.builder_block_id) || block?.manual_selection === true;
    if (!isManualBuilderBlock || !SUPPORTED_RUNTIME_BLOCKS.has(key)) return null;

    const exercise = rows.find((row) => statusValue(row) === 'pending') ?? rows[0];
    return { block, key, exercise };
  }

  return null;
}

function directionAvailable(item, direction) {
  return item?.directions?.[direction]?.available === true;
}

export default function EnvironmentSwapOverlay() {
  const { workout, setGeneratedWorkout } = useWorkout();
  const [availability, setAvailability] = useState({});
  const [loading, setLoading] = useState(false);
  const [swapping, setSwapping] = useState(false);
  const [visible, setVisible] = useState(false);

  const target = useMemo(() => currentBuilderTarget(workout), [workout]);
  const instanceId = target?.exercise?.sessionExerciseId ?? null;
  const item = instanceId ? availability?.[instanceId] ?? null : null;
  const hasChoice =
    directionAvailable(item, 'equivalent') ||
    directionAvailable(item, 'easier') ||
    directionAvailable(item, 'harder');

  const hydrate = useCallback(async () => {
    if (!workout?.sessionId || !Array.isArray(workout?.exercises)) return;
    if (workout.exercises.every((exercise) => Boolean(exercise.sessionExerciseId))) return;

    try {
      const hydrated = await hydrateEnvironmentSessionExerciseIds(workout);
      setGeneratedWorkout(hydrated);
    } catch (error) {
      console.warn('Environment session instance hydration', error);
    }
  }, [setGeneratedWorkout, workout]);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  const refreshAvailability = useCallback(async () => {
    if (!workout?.sessionId || !target?.exercise?.sessionExerciseId) {
      setAvailability({});
      return;
    }

    try {
      setLoading(true);
      const result = await getWorkoutSwapAvailability(workout.sessionId);
      setAvailability(result?.items ?? {});
    } catch (error) {
      console.warn('Environment swap availability', error);
      setAvailability({});
    } finally {
      setLoading(false);
    }
  }, [target?.exercise?.sessionExerciseId, workout?.sessionId]);

  useEffect(() => {
    refreshAvailability();
  }, [refreshAvailability]);

  async function applySwap(reason) {
    if (!target?.exercise?.sessionExerciseId || swapping) return;

    const oldExerciseId = target.exercise.exerciseId ?? target.exercise.id;
    const previousByInstance = new Map(
      (workout.exercises ?? [])
        .filter((exercise) => exercise.sessionExerciseId)
        .map((exercise) => [exercise.sessionExerciseId, exercise])
    );

    try {
      setSwapping(true);
      const result = await adaptSessionExercise({
        sessionId: workout.sessionId,
        sessionExerciseId: target.exercise.sessionExerciseId,
        currentExerciseId: oldExerciseId,
        reason,
      });

      await syncEnvironmentBuilderSwapRuntime({
        sessionExerciseId: target.exercise.sessionExerciseId,
        oldExerciseId,
        substitute: result?.substitute ?? {},
      });

      const refreshed = await reloadWorkoutSession({
        sessionId: workout.sessionId,
        preparationSnapshot: workout.preparationSnapshot ?? null,
      });
      const hydrated = await hydrateEnvironmentSessionExerciseIds(refreshed);

      setGeneratedWorkout({
        ...hydrated,
        exercises: (hydrated.exercises ?? []).map((exercise) => {
          const previous = previousByInstance.get(exercise.sessionExerciseId);
          if (!previous || exercise.sessionExerciseId === target.exercise.sessionExerciseId) {
            return {
              ...exercise,
              status: 'pending',
              userExecutionStatus: null,
              repsCompleted: null,
              durationSeconds: null,
              distanceMeters: null,
              rpe: null,
              performanceActualJson: null,
            };
          }

          return {
            ...exercise,
            status: previous.status,
            userExecutionStatus: previous.userExecutionStatus,
            repsCompleted: previous.repsCompleted,
            durationSeconds: previous.durationSeconds,
            distanceMeters: previous.distanceMeters,
            rpe: previous.rpe,
            performanceActualJson: previous.performanceActualJson,
          };
        }),
      });

      setVisible(false);
    } catch (error) {
      Alert.alert(
        'Remplacement impossible',
        error?.message ?? 'Aucune alternative sûre n’a été trouvée.'
      );
    } finally {
      setSwapping(false);
    }
  }

  if (!target || loading || !instanceId || !hasChoice) return null;

  return (
    <>
      <Pressable
        onPress={() => setVisible(true)}
        style={({ pressed }) => [styles.floatingButton, pressed && styles.pressed]}
      >
        <Ionicons name="swap-horizontal" size={17} color={colors.textPrimary} />
        <Text style={styles.floatingText}>REMPLACER</Text>
      </Pressable>

      <Modal visible={visible} transparent animationType="slide" onRequestClose={() => !swapping && setVisible(false)}>
        <SafeAreaView style={styles.modalRoot}>
          <Pressable style={styles.backdrop} disabled={swapping} onPress={() => setVisible(false)} />
          <View style={styles.sheet}>
            <View style={styles.handle} />
            <View style={styles.sheetHeader}>
              <View style={styles.flex}>
                <Text style={styles.eyebrow}>REMPLACEMENT</Text>
                <Text style={styles.title}>{target.exercise.name}</Text>
                <Text style={styles.body}>UGEROD n’affiche que les alternatives déjà validées comme compatibles avec cette séance.</Text>
              </View>
              <Pressable disabled={swapping} onPress={() => setVisible(false)} hitSlop={10}>
                <Ionicons name="close" size={21} color={colors.textSecondary} />
              </Pressable>
            </View>

            {swapping ? <ActivityIndicator color={colors.primaryLight} style={styles.loader} /> : null}

            {directionAvailable(item, 'equivalent') ? (
              <SwapOption icon="swap-horizontal" title="UN ÉQUIVALENT" onPress={() => applySwap('equivalent')} disabled={swapping} />
            ) : null}
            {directionAvailable(item, 'easier') ? (
              <SwapOption icon="arrow-down-circle-outline" title="PLUS FACILE" onPress={() => applySwap('too_hard')} disabled={swapping} />
            ) : null}
            {directionAvailable(item, 'harder') ? (
              <SwapOption icon="arrow-up-circle-outline" title="PLUS DIFFICILE" onPress={() => applySwap('too_easy')} disabled={swapping} />
            ) : null}
          </View>
        </SafeAreaView>
      </Modal>
    </>
  );
}

function SwapOption({ icon, title, onPress, disabled }) {
  return (
    <Pressable disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.option, pressed && styles.pressed]}>
      <Ionicons name={icon} size={20} color={colors.primaryLight} />
      <Text style={styles.optionText}>{title}</Text>
      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pressed: { opacity: 0.7 },
  floatingButton: {
    position: 'absolute',
    right: spacing.lg,
    top: 76,
    minHeight: 38,
    paddingHorizontal: 12,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    zIndex: 20,
  },
  floatingText: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 9,
    letterSpacing: 0.65,
    color: colors.textPrimary,
  },
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.72)' },
  sheet: {
    paddingHorizontal: spacing.lg,
    paddingTop: 10,
    paddingBottom: 24,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: 14 },
  sheetHeader: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  eyebrow: { fontFamily: 'Oswald_600SemiBold', fontSize: 9, letterSpacing: 0.8, color: colors.primaryLight },
  title: { marginTop: 3, fontFamily: 'BebasNeue_400Regular', fontSize: 25, color: colors.textPrimary },
  body: { marginTop: 5, fontFamily: 'Oswald_400Regular', fontSize: 10.5, lineHeight: 15, color: colors.textMuted },
  loader: { marginTop: 16 },
  option: {
    minHeight: 54,
    marginTop: 10,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  optionText: { flex: 1, fontFamily: 'Oswald_700Bold', fontSize: 10, letterSpacing: 0.5, color: colors.textPrimary },
});
