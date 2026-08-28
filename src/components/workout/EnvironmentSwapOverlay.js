import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
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
  markWorkoutSessionStarted,
  reloadWorkoutSession,
} from '../../services/workoutService';
import {
  hydrateEnvironmentSessionExerciseIds,
  syncEnvironmentBuilderSwapRuntime,
} from '../../services/environmentSessionRuntimeService';

const SUPPORTED_SWAP_RUNTIME_BLOCKS = new Set(['gym', 'tabata']);

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

function currentRuntimeTarget(workout) {
  const blocks = Array.isArray(workout?.rawBlocks) ? workout.rawBlocks : [];
  const exercises = Array.isArray(workout?.exercises) ? workout.exercises : [];

  for (const block of blocks) {
    const key = blockKey(block);
    const rows = exercises.filter(
      (exercise) => String(exercise.blockKey ?? exercise.block ?? '').toLowerCase() === key
    );
    if (!rows.length || rows.every((exercise) => statusValue(exercise) !== 'pending')) continue;

    return {
      block,
      key,
      exercises: rows,
      pendingExercises: rows.filter((exercise) => statusValue(exercise) === 'pending'),
    };
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
  const [busy, setBusy] = useState(false);
  const [visible, setVisible] = useState(false);

  const current = useMemo(() => currentRuntimeTarget(workout), [workout]);
  const isManualBuilderBlock = Boolean(current?.block?.builder_block_id) || current?.block?.manual_selection === true;
  const swapExercise =
    current &&
    isManualBuilderBlock &&
    SUPPORTED_SWAP_RUNTIME_BLOCKS.has(current.key)
      ? current.pendingExercises?.[0] ?? null
      : null;
  const instanceId = swapExercise?.sessionExerciseId ?? null;
  const item = instanceId ? availability?.[instanceId] ?? null : null;
  const hasSwapChoice =
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
    if (!workout?.sessionId || !instanceId) {
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
  }, [instanceId, workout?.sessionId]);

  useEffect(() => {
    refreshAvailability();
  }, [refreshAvailability]);

  async function applySwap(reason) {
    if (!swapExercise?.sessionExerciseId || busy) return;

    const oldExerciseId = swapExercise.exerciseId ?? swapExercise.id;
    const previousByInstance = new Map(
      (workout.exercises ?? [])
        .filter((exercise) => exercise.sessionExerciseId)
        .map((exercise) => [exercise.sessionExerciseId, exercise])
    );

    try {
      setBusy(true);
      const result = await adaptSessionExercise({
        sessionId: workout.sessionId,
        sessionExerciseId: swapExercise.sessionExerciseId,
        currentExerciseId: oldExerciseId,
        reason,
      });

      await syncEnvironmentBuilderSwapRuntime({
        sessionExerciseId: swapExercise.sessionExerciseId,
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
          if (!previous || exercise.sessionExerciseId === swapExercise.sessionExerciseId) {
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
      setBusy(false);
    }
  }

  async function skipCurrentBlock() {
    if (!current || busy) return;

    try {
      setBusy(true);
      let startedLocalDate = workout.startedLocalDate ?? null;

      if (!workout.sessionStarted) {
        const started = await markWorkoutSessionStarted({ sessionId: workout.sessionId });
        startedLocalDate = started?.started_local_date ?? startedLocalDate;
      }

      const nextExercises = (workout.exercises ?? []).map((exercise) => {
        const sameBlock = String(exercise.blockKey ?? exercise.block ?? '').toLowerCase() === current.key;
        if (!sameBlock || statusValue(exercise) !== 'pending') return exercise;
        return {
          ...exercise,
          status: 'not_completed',
          userExecutionStatus: 'not_completed',
          repsCompleted: null,
          durationSeconds: null,
          distanceMeters: null,
          rpe: null,
          performanceActualJson: null,
        };
      });

      setGeneratedWorkout({
        ...workout,
        sessionStarted: true,
        status: 'in_progress',
        startedAt: workout.startedAt ?? new Date().toISOString(),
        startedLocalDate,
        exercises: nextExercises,
      });
      setVisible(false);

      if (!nextExercises.some((exercise) => statusValue(exercise) === 'pending')) {
        router.push('/workout/completion');
      }
    } catch (error) {
      Alert.alert(
        'Impossible de passer ce bloc',
        error?.message ?? 'Réessaie dans quelques instants.'
      );
    } finally {
      setBusy(false);
    }
  }

  function confirmSkip() {
    Alert.alert(
      'Passer ce bloc ?',
      'Il sera enregistré comme non réalisé. Aucune performance ne sera inventée.',
      [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Passer', style: 'destructive', onPress: skipCurrentBlock },
      ]
    );
  }

  if (!current) return null;

  return (
    <>
      <Pressable
        onPress={() => setVisible(true)}
        style={({ pressed }) => [styles.floatingButton, pressed && styles.pressed]}
      >
        <Ionicons name="ellipsis-horizontal" size={17} color={colors.textPrimary} />
        <Text style={styles.floatingText}>OPTIONS</Text>
      </Pressable>

      <Modal visible={visible} transparent animationType="slide" onRequestClose={() => !busy && setVisible(false)}>
        <SafeAreaView style={styles.modalRoot}>
          <Pressable style={styles.backdrop} disabled={busy} onPress={() => setVisible(false)} />
          <View style={styles.sheet}>
            <View style={styles.handle} />
            <View style={styles.sheetHeader}>
              <View style={styles.flex}>
                <Text style={styles.eyebrow}>OPTIONS DU BLOC</Text>
                <Text style={styles.title}>{current.block?.title ?? current.block?.block_name ?? current.key}</Text>
                <Text style={styles.body}>
                  {hasSwapChoice
                    ? 'Les remplacements proposés sont déjà validés comme compatibles avec cette séance.'
                    : 'Tu peux passer ce bloc : il restera enregistré comme non réalisé.'}
                </Text>
              </View>
              <Pressable disabled={busy} onPress={() => setVisible(false)} hitSlop={10}>
                <Ionicons name="close" size={21} color={colors.textSecondary} />
              </Pressable>
            </View>

            {busy || loading ? <ActivityIndicator color={colors.primaryLight} style={styles.loader} /> : null}

            {hasSwapChoice && directionAvailable(item, 'equivalent') ? (
              <ActionOption icon="swap-horizontal" title="UN ÉQUIVALENT" onPress={() => applySwap('equivalent')} disabled={busy} />
            ) : null}
            {hasSwapChoice && directionAvailable(item, 'easier') ? (
              <ActionOption icon="arrow-down-circle-outline" title="PLUS FACILE" onPress={() => applySwap('too_hard')} disabled={busy} />
            ) : null}
            {hasSwapChoice && directionAvailable(item, 'harder') ? (
              <ActionOption icon="arrow-up-circle-outline" title="PLUS DIFFICILE" onPress={() => applySwap('too_easy')} disabled={busy} />
            ) : null}

            <ActionOption
              icon="play-skip-forward-outline"
              title="PASSER CE BLOC"
              subtitle="Le bloc est noté non réalisé et la séance continue."
              onPress={confirmSkip}
              disabled={busy}
            />
          </View>
        </SafeAreaView>
      </Modal>
    </>
  );
}

function ActionOption({ icon, title, subtitle, onPress, disabled }) {
  return (
    <Pressable disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.option, pressed && styles.pressed]}>
      <Ionicons name={icon} size={20} color={colors.primaryLight} />
      <View style={styles.flex}>
        <Text style={styles.optionText}>{title}</Text>
        {subtitle ? <Text style={styles.optionSubtitle}>{subtitle}</Text> : null}
      </View>
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
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  optionText: { fontFamily: 'Oswald_700Bold', fontSize: 10, letterSpacing: 0.5, color: colors.textPrimary },
  optionSubtitle: { marginTop: 2, fontFamily: 'Oswald_400Regular', fontSize: 9.5, lineHeight: 14, color: colors.textMuted },
});