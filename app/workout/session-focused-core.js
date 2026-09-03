import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
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

import { spacing } from '../../src/constants';
import { useUgerodTheme } from '../../src/contexts/UgerodThemeContext';
import { useWorkout } from '../../src/contexts/WorkoutContext';
import {
  changeWorkoutFormat,
  getWorkoutFormatOptions,
  getWorkoutSwapAvailability,
  markWorkoutSessionStarted,
  markWorkoutWodRevealed,
  markWorkoutWodStarted,
  reloadWorkoutSession,
  swapWorkoutExercise,
} from '../../src/services/workoutService';
import { adaptSessionExercise } from '../../src/services/sessionAdaptationService';
import WodProtocolPlayer from '../../src/components/workout/WodProtocolPlayer';

const BLOCK_ORDER = ['unlock', 'tabata', 'warmup', 'skill', 'wod'];
const BLOCK_LABELS = {
  unlock: 'Unlock',
  tabata: 'Tabata',
  warmup: 'Warm-up',
  skill: 'Skill',
  wod: 'WOD',
};

function normalizeBlockId(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'warm_up') return 'warmup';
  return normalized;
}

function readSourceBlock(workout, blockId) {
  const blocks = workout?.blocks ?? {};

  if (Array.isArray(blocks)) {
    return (
      blocks.find(
        (block) =>
          normalizeBlockId(block?.block_key ?? block?.blockKey ?? block?.key ?? block?.id) === blockId
      ) ?? null
    );
  }

  if (blockId === 'warmup') {
    return blocks?.warmup ?? blocks?.warm_up ?? null;
  }

  return blocks?.[blockId] ?? null;
}

function firstFinite(...values) {
  for (const value of values) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return null;
}

function prescriptionObject(exercise) {
  const value =
    exercise?.prescriptionJson ??
    exercise?.prescription_json ??
    (exercise?.prescription && typeof exercise.prescription === 'object'
      ? exercise.prescription
      : null);

  return value && typeof value === 'object' ? value : {};
}

function buildBlockStructure(blockId, source, exercises) {
  const prescription = prescriptionObject(exercises?.[0]);
  const protocol = prescription?.protocol ?? {};

  if (blockId === 'tabata') {
    const rounds = firstFinite(source?.rounds, protocol?.rounds, 8);
    const work = firstFinite(source?.workSeconds, source?.work_seconds, protocol?.work_seconds, 20);
    const rest = firstFinite(source?.restSeconds, source?.rest_seconds, protocol?.rest_seconds, 10);
    return `${rounds} tours · ${work}s / ${rest}s`;
  }

  if (blockId === 'skill') {
    const contract = source?.skillContract ?? source?.skill_contract ?? {};
    const patch = contract?.prescription_patch ?? {};
    const sets = firstFinite(contract?.sets, patch?.sets, prescription?.sets);
    const reps = firstFinite(
      patch?.execution_target_reps,
      prescription?.execution_target_reps,
      prescription?.reps,
      prescription?.reps_min
    );
    const work = firstFinite(
      patch?.execution_target_duration_seconds,
      prescription?.execution_target_duration_seconds
    );
    const rest = firstFinite(
      contract?.restSeconds,
      contract?.rest_seconds,
      patch?.rest_between_sets_seconds,
      prescription?.rest_between_sets_seconds
    );

    const parts = [];
    if (sets != null) parts.push(`${sets} séries`);
    if (reps != null) parts.push(`${reps} reps`);
    else if (work != null) parts.push(`${work}s`);
    if (rest != null) parts.push(`${rest}s repos`);
    return parts.join(' · ');
  }

  if (blockId === 'warmup') {
    const rounds = firstFinite(source?.warmupRounds, source?.warmup_rounds, prescription?.warmup_rounds, 3);
    return `${rounds} tours · ${exercises.length} exercice${exercises.length > 1 ? 's' : ''}`;
  }

  if (blockId === 'unlock') {
    return `${exercises.length} exercice${exercises.length > 1 ? 's' : ''}`;
  }

  return source?.structure ?? source?.mechanicLabel ?? '';
}

function buildBlocks(workout) {
  const exercises = Array.isArray(workout?.exercises) ? workout.exercises : [];

  return BLOCK_ORDER.map((blockId) => {
    const source = readSourceBlock(workout, blockId);
    const rows = exercises
      .filter(
        (exercise) => normalizeBlockId(exercise?.blockKey ?? exercise?.block) === blockId
      )
      .map((exercise, index) => ({
        ...exercise,
        _uiKey: exercise?.sessionExerciseId ?? `${blockId}-${exercise?.id ?? index}-${index}`,
      }));

    const duration = firstFinite(source?.duration, source?.duration_minutes, source?.durationMinutes, 0) ?? 0;

    return {
      id: blockId,
      title: BLOCK_LABELS[blockId] ?? blockId,
      source,
      durationMinutes: duration,
      durationLabel: duration > 0 ? `${duration} min` : null,
      structure: buildBlockStructure(blockId, source, rows),
      objective: source?.objective ?? null,
      skillContract: source?.skillContract ?? source?.skill_contract ?? null,
      mechanic: source?.mechanic ?? source?.mechanic_json?.mechanic_key ?? source?.mechanicJson?.mechanic_key ?? null,
      exercises: rows,
    };
  }).filter((block) => block.exercises.length > 0);
}

function exerciseImageUri(exercise) {
  const value =
    exercise?.imagePath ??
    exercise?.image_path ??
    exercise?.imageUrl ??
    exercise?.image_url ??
    null;

  return typeof value === 'string' && /^https?:\/\//i.test(value) ? value : null;
}

function displayExerciseName(exercise) {
  return String(exercise?.name ?? 'Exercice');
}

function statusValue(exercise) {
  if (exercise?.userExecutionStatus) return exercise.userExecutionStatus;
  if (exercise?.status === 'skipped') return 'not_completed';
  return exercise?.status ?? 'pending';
}

function formatOptionTitle(option) {
  return String(option?.display_name ?? option?.option_id ?? option?.mechanic ?? 'Format');
}

export default function SessionFocusedCore() {
  const { workout, updateWorkout, setExerciseLoad } = useWorkout();
  const { colors, isDark } = useUgerodTheme();
  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);

  const blocks = useMemo(() => buildBlocks(workout), [workout]);
  const validatedBlocks = Array.isArray(workout?.validatedBlocks) ? workout.validatedBlocks : [];
  const activeBlock = blocks.find((block) => !validatedBlocks.includes(block.id)) ?? blocks.at(-1) ?? null;
  const activeBlockIndex = activeBlock
    ? Math.max(0, blocks.findIndex((block) => block.id === activeBlock.id))
    : 0;
  const completedBlocks = blocks.filter((block) => validatedBlocks.includes(block.id)).length;
  const progress = blocks.length > 0 ? completedBlocks / blocks.length : 0;

  const [exerciseIndexes, setExerciseIndexes] = useState({});
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [swapExercise, setSwapExercise] = useState(null);
  const [swapAvailability, setSwapAvailability] = useState({});
  const [swapLoading, setSwapLoading] = useState(false);
  const [swapBusy, setSwapBusy] = useState(false);
  const [swapError, setSwapError] = useState('');
  const [seenByInstance, setSeenByInstance] = useState({});
  const [statusExercise, setStatusExercise] = useState(null);
  const [skillScoreOpen, setSkillScoreOpen] = useState(false);
  const [skillScoreValue, setSkillScoreValue] = useState('');
  const [formatOpen, setFormatOpen] = useState(false);
  const [formatOptions, setFormatOptions] = useState([]);
  const [formatLoading, setFormatLoading] = useState(false);
  const [formatChanging, setFormatChanging] = useState(null);
  const [formatError, setFormatError] = useState('');

  const sessionStartPromiseRef = useRef(null);
  const sessionStartedRef = useRef(Boolean(workout?.sessionStarted));
  const wodStartedRef = useRef(Boolean(workout?.wodRuntime?.started || workout?.wodStarted));

  useEffect(() => {
    sessionStartedRef.current = Boolean(workout?.sessionStarted);
    wodStartedRef.current = Boolean(workout?.wodRuntime?.started || workout?.wodStarted);
  }, [workout?.sessionId, workout?.sessionStarted, workout?.wodRuntime?.started, workout?.wodStarted]);

  useEffect(() => {
    setDetailsOpen(false);
  }, [activeBlock?.id]);

  const activeExerciseIndex = activeBlock
    ? Math.min(
        exerciseIndexes[activeBlock.id] ?? 0,
        Math.max(0, activeBlock.exercises.length - 1)
      )
    : 0;
  const activeExercise = activeBlock?.exercises?.[activeExerciseIndex] ?? null;

  useEffect(() => {
    if (!activeBlock || !activeExercise) return;

    const nextCursor = {
      blockId: activeBlock.id,
      exerciseIndex: activeExerciseIndex,
      sessionExerciseId: activeExercise?.sessionExerciseId ?? null,
      exerciseId: activeExercise?.exerciseId ?? activeExercise?.id ?? null,
    };
    const currentCursor = workout?.playerCursor ?? null;

    if (
      currentCursor?.blockId === nextCursor.blockId &&
      Number(currentCursor?.exerciseIndex ?? -1) === nextCursor.exerciseIndex &&
      (currentCursor?.sessionExerciseId ?? null) === nextCursor.sessionExerciseId &&
      (currentCursor?.exerciseId ?? null) === nextCursor.exerciseId
    ) {
      return;
    }

    updateWorkout({ playerCursor: nextCursor });
  }, [
    activeBlock?.id,
    activeExerciseIndex,
    activeExercise?.sessionExerciseId,
    activeExercise?.exerciseId,
    activeExercise?.id,
    updateWorkout,
    workout?.playerCursor?.blockId,
    workout?.playerCursor?.exerciseIndex,
    workout?.playerCursor?.sessionExerciseId,
    workout?.playerCursor?.exerciseId,
  ]);

  const refreshSwapAvailability = useCallback(async () => {
    if (!workout?.sessionId) {
      setSwapAvailability({});
      return;
    }

    try {
      setSwapLoading(true);
      const result = await getWorkoutSwapAvailability(workout.sessionId);
      setSwapAvailability(result?.items ?? {});
    } catch (error) {
      console.warn('Focused player swap availability', error);
      setSwapAvailability({});
    } finally {
      setSwapLoading(false);
    }
  }, [workout?.sessionId]);

  useEffect(() => {
    refreshSwapAvailability();
  }, [refreshSwapAvailability, workout?.exercises]);

  const ensureSessionStarted = useCallback(async () => {
    if (!workout?.sessionId) return { status: 'NO_SESSION' };
    if (sessionStartedRef.current) return { status: 'IN_PROGRESS' };
    if (sessionStartPromiseRef.current) return sessionStartPromiseRef.current;

    sessionStartedRef.current = true;
    updateWorkout({
      sessionStarted: true,
      status: 'in_progress',
      startedAt: workout?.startedAt ?? new Date().toISOString(),
    });

    const request = markWorkoutSessionStarted({ sessionId: workout.sessionId })
      .then((result) => {
        if (result?.status === 'STALE_SESSION_REQUIRES_RECHECKIN') {
          sessionStartedRef.current = false;
          router.replace('/workout/preparation');
          return result;
        }

        updateWorkout({
          sessionStarted: true,
          status: 'in_progress',
          startedLocalDate: result?.started_local_date ?? workout?.startedLocalDate ?? null,
        });
        return result;
      })
      .catch((error) => {
        sessionStartedRef.current = false;
        updateWorkout({ sessionStarted: false, status: 'generated' });
        throw error;
      })
      .finally(() => {
        sessionStartPromiseRef.current = null;
      });

    sessionStartPromiseRef.current = request;
    return request;
  }, [updateWorkout, workout?.sessionId, workout?.startedAt, workout?.startedLocalDate]);

  function patchExercise(target, values) {
    const targetInstance = target?.sessionExerciseId;
    const targetId = target?.id;
    const targetBlock = normalizeBlockId(target?.blockKey ?? target?.block);

    updateWorkout({
      exercises: (workout?.exercises ?? []).map((exercise) => {
        const same = targetInstance
          ? exercise?.sessionExerciseId === targetInstance
          : exercise?.id === targetId &&
            normalizeBlockId(exercise?.blockKey ?? exercise?.block) === targetBlock;
        return same ? { ...exercise, ...values } : exercise;
      }),
    });
  }

  function moveExercise(direction) {
    if (!activeBlock?.exercises?.length) return;

    setExerciseIndexes((current) => {
      const currentIndex = Math.min(
        current[activeBlock.id] ?? 0,
        activeBlock.exercises.length - 1
      );
      const nextIndex = Math.max(
        0,
        Math.min(activeBlock.exercises.length - 1, currentIndex + direction)
      );
      return { ...current, [activeBlock.id]: nextIndex };
    });
    setDetailsOpen(false);
  }

  function finalizeBlock(block, extraExercisePatch = null) {
    const nextValidated = Array.from(new Set([...validatedBlocks, block.id]));
    const nextExercises = (workout?.exercises ?? []).map((exercise) => {
      if (normalizeBlockId(exercise?.blockKey ?? exercise?.block) !== block.id) return exercise;

      let next = exercise;
      if (
        extraExercisePatch?.exercise &&
        (exercise?.sessionExerciseId
          ? exercise.sessionExerciseId === extraExercisePatch.exercise.sessionExerciseId
          : exercise?.id === extraExercisePatch.exercise.id)
      ) {
        next = {
          ...next,
          ...extraExercisePatch.values,
          performanceActualJson: {
            ...(next?.performanceActualJson ?? {}),
            ...(extraExercisePatch.performanceActualJson ?? {}),
          },
        };
      }

      return statusValue(next) === 'pending' ? { ...next, status: 'completed' } : next;
    });

    if (block.id === 'wod') {
      updateWorkout({
        exercises: nextExercises,
        validatedBlocks: nextValidated,
        status: 'awaiting_completion',
      });
      router.push('/workout/completion');
      return;
    }

    updateWorkout({ exercises: nextExercises, validatedBlocks: nextValidated });
    setExerciseIndexes((current) => ({ ...current, [block.id]: 0 }));
    setDetailsOpen(false);
  }

  async function completeBlock(block) {
    if (!block) return;

    try {
      await ensureSessionStarted();
    } catch (error) {
      Alert.alert('Impossible de démarrer la séance', error?.message ?? 'Réessaie.');
      return;
    }

    const contract = block?.skillContract ?? {};
    if (block.id === 'skill' && (contract?.scoreRequired === true || contract?.score_required === true)) {
      setSkillScoreValue('');
      setSkillScoreOpen(true);
      return;
    }

    finalizeBlock(block);
  }

  async function completeCurrentExercise() {
    if (!activeBlock || !activeExercise) return;

    try {
      await ensureSessionStarted();
    } catch (error) {
      Alert.alert('Impossible de démarrer la séance', error?.message ?? 'Réessaie.');
      return;
    }

    if (activeExerciseIndex >= activeBlock.exercises.length - 1) {
      await completeBlock(activeBlock);
      return;
    }

    patchExercise(activeExercise, { status: 'completed' });
    moveExercise(1);
  }

  function saveSkillScore() {
    if (!activeBlock || !activeExercise) return;

    const numeric = Number(String(skillScoreValue).trim().replace(',', '.'));
    if (!Number.isFinite(numeric) || numeric <= 0) return;

    const contract = activeBlock.skillContract ?? {};
    const metric = contract?.scoreMetric ?? contract?.score_metric ?? 'score';
    const unit = contract?.scoreUnit ?? contract?.score_unit ?? null;
    const score = metric === 'max_reps' ? Math.max(1, Math.round(numeric)) : Math.round(numeric * 10) / 10;
    const values = {};

    if (metric === 'max_reps') values.repsCompleted = score;
    if (metric === 'max_duration_seconds') values.durationSeconds = score;
    if (metric === 'max_distance_meters') values.distanceMeters = score;
    if (metric === 'load_kg') {
      setExerciseLoad(activeExercise.sessionExerciseId ?? activeExercise.id, `${score} kg`);
    }

    setSkillScoreOpen(false);
    finalizeBlock(activeBlock, {
      exercise: activeExercise,
      values,
      performanceActualJson: {
        skill_test_contract: 'skill-contract-v2',
        skill_objective_type: 'TEST',
        skill_test_metric: metric,
        skill_test_score: score,
        skill_test_unit: unit,
      },
    });
  }

  async function openSwap(exercise) {
    if (!exercise?.sessionExerciseId || statusValue(exercise) === 'completed') return;
    setSwapError('');
    setSwapExercise(exercise);
    await refreshSwapAvailability();
  }

  async function applySwap(reason, undo = false) {
    const exercise = swapExercise;
    if (!exercise?.sessionExerciseId || !workout?.sessionId || swapBusy) return;

    const instanceId = exercise.sessionExerciseId;
    const item = swapAvailability?.[instanceId] ?? null;
    const directionMap = {
      too_easy: 'harder',
      too_hard: 'easier',
      equipment: 'equivalent',
      environment: 'equivalent',
      equivalent: 'equivalent',
    };
    const direction = directionMap[reason] ?? 'equivalent';
    const contextualAvailable =
      item?.directions?.equivalent?.available === true || item?.directions?.easier?.available === true;
    const available = undo
      ? item?.can_undo === true
      : reason === 'equipment' || reason === 'environment'
        ? contextualAvailable
        : item?.directions?.[direction]?.available === true;

    if (!available) return;

    try {
      setSwapBusy(true);
      setSwapError('');

      if (undo) {
        await swapWorkoutExercise({
          sessionId: workout.sessionId,
          sessionExerciseId: instanceId,
          currentExerciseId: exercise.exerciseId ?? exercise.id,
          direction: 'equivalent',
          undo: true,
          excludedExerciseIds: [],
        });
      } else {
        await adaptSessionExercise({
          sessionId: workout.sessionId,
          sessionExerciseId: instanceId,
          currentExerciseId: exercise.exerciseId ?? exercise.id,
          reason,
          excludedExerciseIds: seenByInstance[instanceId] ?? [],
        });
      }

      const refreshed = await reloadWorkoutSession({
        sessionId: workout.sessionId,
        preparationSnapshot: workout?.preparationSnapshot ?? null,
      });
      const availabilityAfter = await getWorkoutSwapAvailability(workout.sessionId);
      setSwapAvailability(availabilityAfter?.items ?? {});

      if (!undo) {
        setSeenByInstance((current) => ({
          ...current,
          [instanceId]: Array.from(
            new Set([...(current[instanceId] ?? []), exercise.exerciseId ?? exercise.id].filter(Boolean))
          ),
        }));
      }

      updateWorkout({ ...refreshed, validatedBlocks });
      setSwapExercise(null);
      setDetailsOpen(false);
    } catch (error) {
      setSwapError(error?.message ?? 'Impossible de changer cet exercice.');
    } finally {
      setSwapBusy(false);
    }
  }

  function selectExerciseStatus(value) {
    if (!statusExercise) return;
    ensureSessionStarted().catch(() => {});
    patchExercise(statusExercise, { status: value });
    setStatusExercise(null);
  }

  const wodUnlocked = useMemo(() => {
    const previous = blocks.filter((block) => block.id !== 'wod').map((block) => block.id);
    return previous.every((blockId) => validatedBlocks.includes(blockId));
  }, [blocks, validatedBlocks]);

  const wodRevealed = Boolean(workout?.wodRevealed || workout?.wodRevealedAt);

  async function revealWod() {
    if (!workout?.sessionId || !wodUnlocked || wodRevealed) return;

    try {
      const result = await markWorkoutWodRevealed({ sessionId: workout.sessionId });
      updateWorkout({
        wodRevealed: true,
        wodRevealedAt: result?.wod_revealed_at ?? new Date().toISOString(),
        formatChangeCount: Number(result?.format_change_count ?? workout?.formatChangeCount ?? 0),
        formatChangeLimit: Number(result?.format_change_limit ?? workout?.formatChangeLimit ?? 3),
        formatLocked: Boolean(result?.format_locked ?? false),
      });
    } catch (error) {
      Alert.alert('Impossible de révéler le WOD', error?.message ?? 'Réessaie.');
    }
  }

  const handleWodStart = useCallback(async () => {
    await ensureSessionStarted();

    if (!workout?.sessionId || wodStartedRef.current) return;
    const result = await markWorkoutWodStarted({ sessionId: workout.sessionId });
    wodStartedRef.current = true;
    updateWorkout({
      wodStarted: true,
      wodStartedAt: result?.wod_started_at ?? new Date().toISOString(),
      wodRevealed: true,
      wodRevealedAt: result?.wod_revealed_at ?? workout?.wodRevealedAt ?? null,
      formatLocked: true,
      remainingFormatChanges: 0,
    });
  }, [ensureSessionStarted, updateWorkout, workout?.sessionId, workout?.wodRevealedAt]);

  const handleWodRuntime = useCallback(
    (runtime) => {
      if (runtime?.started) wodStartedRef.current = true;
      updateWorkout({ wodRuntime: runtime });
    },
    [updateWorkout]
  );

  async function openFormatModal() {
    if (!workout?.sessionId || workout?.formatLocked || workout?.wodRuntime?.started) return;

    try {
      setFormatOpen(true);
      setFormatLoading(true);
      setFormatError('');
      const result = await getWorkoutFormatOptions(workout.sessionId);
      setFormatOptions(result?.options ?? []);
      updateWorkout({
        formatChangeCount: Number(result?.formatChangeCount ?? workout?.formatChangeCount ?? 0),
        formatChangeLimit: Number(result?.formatChangeLimit ?? workout?.formatChangeLimit ?? 3),
        formatLocked: Boolean(result?.formatLocked),
      });
    } catch (error) {
      setFormatError(error?.message ?? 'Impossible de charger les formats.');
    } finally {
      setFormatLoading(false);
    }
  }

  async function selectFormat(option) {
    if (!option?.selectable || option?.current || formatChanging || !workout?.sessionId) return;

    try {
      setFormatChanging(option.option_id);
      setFormatError('');
      const result = await changeWorkoutFormat({
        sessionId: workout.sessionId,
        mechanic: option.mechanic,
        variantKey: option.variant_key ?? null,
      });
      const refreshed = await reloadWorkoutSession({
        sessionId: workout.sessionId,
        preparationSnapshot: workout?.preparationSnapshot ?? null,
      });
      updateWorkout({
        ...refreshed,
        validatedBlocks,
        wodRevealed,
        wodRuntime: null,
        formatChangeCount: Number(result?.format_change_count ?? refreshed?.formatChangeCount ?? 0),
        formatChangeLimit: Number(result?.format_change_limit ?? refreshed?.formatChangeLimit ?? 3),
        formatLocked: Boolean(result?.format_locked ?? refreshed?.formatLocked ?? false),
      });
      setFormatOpen(false);
      setFormatOptions([]);
      await refreshSwapAvailability();
    } catch (error) {
      setFormatError(error?.message ?? 'Impossible de changer le format.');
    } finally {
      setFormatChanging(null);
    }
  }

  if (!activeBlock) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.emptyState}>
          <Ionicons name="alert-circle-outline" size={28} color={colors.textSecondary} />
          <Text style={styles.emptyTitle}>Séance incomplète</Text>
          <Text style={styles.emptyText}>Aucun bloc exécutable n’a été chargé.</Text>
          <Pressable onPress={() => router.replace('/workout/preparation')} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>Revenir au check-in</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const imageUri = exerciseImageUri(activeExercise);
  const swapItem = activeExercise?.sessionExerciseId
    ? swapAvailability?.[activeExercise.sessionExerciseId]
    : null;
  const canSwap = Boolean(
    activeExercise?.sessionExerciseId &&
      statusValue(activeExercise) !== 'completed' &&
      (swapItem?.directions?.equivalent?.available ||
        swapItem?.directions?.easier?.available ||
        swapItem?.directions?.harder?.available ||
        swapItem?.can_undo)
  );

  const remainingFormatChanges = Math.max(
    0,
    Number(workout?.formatChangeLimit ?? 3) - Number(workout?.formatChangeCount ?? 0)
  );

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Pressable onPress={() => router.replace('/workout/preparation')} hitSlop={12} style={styles.iconButton}>
          <Ionicons name="arrow-back" size={21} color={colors.text} />
        </Pressable>

        <View style={styles.headerCopy}>
          <Text style={styles.headerEyebrow}>Séance · {activeBlockIndex + 1}/{blocks.length}</Text>
          <Text style={styles.headerTitle}>{activeBlock.title}</Text>
        </View>

        <View style={styles.durationPill}>
          <Text style={styles.durationValue}>{activeBlock.durationLabel ?? '—'}</Text>
        </View>
      </View>

      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${Math.max(4, Math.round(progress * 100))}%` }]} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.blockIntro}>
          <View style={styles.blockIntroCopy}>
            <Text style={styles.blockKicker}>Bloc actif</Text>
            <Text style={styles.blockTitle}>{activeBlock.title}</Text>
            {activeBlock.structure ? <Text style={styles.blockStructure}>{activeBlock.structure}</Text> : null}
          </View>
          <Text style={styles.blockCounter}>{activeBlockIndex + 1}/{blocks.length}</Text>
        </View>

        {activeBlock.id === 'wod' ? (
          <>
            {!wodRevealed ? (
              <View style={styles.secretCard}>
                <View style={styles.secretIcon}>
                  <Ionicons name="eye-off-outline" size={24} color={colors.textOnAccent} />
                </View>
                <Text style={styles.secretTitle}>Ton WOD est prêt</Text>
                <Text style={styles.secretText}>
                  Le contenu reste masqué jusqu’à ce que tu choisisses de le découvrir.
                </Text>
                <View style={styles.formatRow}>
                  <View style={styles.formatCopy}>
                    <Text style={styles.formatLabel}>Format</Text>
                    <Text style={styles.formatValue}>{String(workout?.format ?? activeBlock?.source?.mechanicLabel ?? 'UGEROD')}</Text>
                  </View>
                  {remainingFormatChanges > 0 && !workout?.formatLocked ? (
                    <Pressable onPress={openFormatModal} style={styles.smallActionButton}>
                      <Ionicons name="options-outline" size={16} color={colors.accent} />
                      <Text style={styles.smallActionText}>Modifier</Text>
                    </Pressable>
                  ) : null}
                </View>
                <Pressable onPress={revealWod} style={styles.primaryButton}>
                  <Ionicons name="eye-outline" size={18} color={colors.textOnAccent} />
                  <Text style={styles.primaryButtonText}>Découvrir le WOD</Text>
                </Pressable>
              </View>
            ) : (
              <View style={styles.wodWrap}>
                <View style={styles.formatRowStandalone}>
                  <View style={styles.formatCopy}>
                    <Text style={styles.formatLabel}>Format du WOD</Text>
                    <Text style={styles.formatValue}>{String(workout?.format ?? activeBlock?.source?.mechanicLabel ?? 'UGEROD')}</Text>
                  </View>
                  {remainingFormatChanges > 0 && !workout?.formatLocked && !workout?.wodRuntime?.started ? (
                    <Pressable onPress={openFormatModal} style={styles.smallActionButton}>
                      <Ionicons name="options-outline" size={16} color={colors.accent} />
                      <Text style={styles.smallActionText}>Modifier</Text>
                    </Pressable>
                  ) : null}
                </View>

                <WodProtocolPlayer
                  key={`${workout?.sessionId ?? 'dev'}-${workout?.format ?? activeBlock?.mechanic ?? 'wod'}`}
                  block={activeBlock}
                  initialRuntime={workout?.wodRuntime ?? null}
                  onBeforeStart={handleWodStart}
                  onRuntimeChange={handleWodRuntime}
                />

                {workout?.wodRuntime?.finished ? (
                  <Pressable onPress={() => completeBlock(activeBlock)} style={styles.primaryButton}>
                    <Ionicons name="checkmark" size={18} color={colors.textOnAccent} />
                    <Text style={styles.primaryButtonText}>Terminer la séance</Text>
                  </Pressable>
                ) : null}
              </View>
            )}
          </>
        ) : activeBlock.id === 'tabata' ? (
          <FocusedTabata block={activeBlock} onFinish={() => completeBlock(activeBlock)} styles={styles} colors={colors} />
        ) : (
          <>
            <View style={styles.mediaCard}>
              {imageUri ? (
                <Image source={{ uri: imageUri }} style={styles.exerciseImage} resizeMode="cover" />
              ) : (
                <View style={styles.mediaFallback}>
                  <View style={styles.mediaFallbackIcon}>
                    <Ionicons name="barbell-outline" size={34} color={colors.accent} />
                  </View>
                  <Text style={styles.mediaFallbackText}>{activeBlock.title}</Text>
                </View>
              )}

              <View style={styles.mediaOverlayTop}>
                <Text style={styles.exercisePosition}>
                  Exercice {activeExerciseIndex + 1} / {activeBlock.exercises.length}
                </Text>
              </View>
            </View>

            <View style={styles.exerciseCard}>
              <Text style={styles.exerciseName}>{displayExerciseName(activeExercise)}</Text>
              {activeExercise?.prescription ? (
                <Text style={styles.exercisePrescription}>{String(activeExercise.prescription)}</Text>
              ) : null}

              {activeBlock.objective ? (
                <View style={styles.objectiveBox}>
                  <Text style={styles.objectiveLabel}>Objectif</Text>
                  <Text style={styles.objectiveText}>{activeBlock.objective}</Text>
                </View>
              ) : null}

              {detailsOpen ? (
                <View style={styles.detailsBox}>
                  {activeExercise?.instructions ? (
                    <>
                      <Text style={styles.detailsLabel}>Exécution</Text>
                      <Text style={styles.detailsText}>{String(activeExercise.instructions)}</Text>
                    </>
                  ) : null}
                  {activeExercise?.tips ? (
                    <>
                      <Text style={[styles.detailsLabel, { marginTop: 12 }]}>Conseil UGEROD</Text>
                      <Text style={styles.detailsText}>{String(activeExercise.tips)}</Text>
                    </>
                  ) : null}
                  {!activeExercise?.instructions && !activeExercise?.tips ? (
                    <Text style={styles.detailsText}>Aucune consigne détaillée supplémentaire.</Text>
                  ) : null}
                </View>
              ) : null}

              <View style={styles.inlineActions}>
                <Pressable onPress={() => setDetailsOpen((value) => !value)} style={styles.secondaryAction}>
                  <Ionicons name={detailsOpen ? 'chevron-up' : 'information-circle-outline'} size={18} color={colors.text} />
                  <Text style={styles.secondaryActionText}>{detailsOpen ? 'Réduire' : 'Consignes'}</Text>
                </Pressable>

                <Pressable
                  onPress={() => openSwap(activeExercise)}
                  disabled={!canSwap || swapLoading}
                  style={[styles.secondaryAction, (!canSwap || swapLoading) && styles.actionDisabled]}
                >
                  {swapLoading ? (
                    <ActivityIndicator size="small" color={colors.accent} />
                  ) : (
                    <Ionicons name="swap-horizontal-outline" size={18} color={canSwap ? colors.accent : colors.textMuted} />
                  )}
                  <Text style={[styles.secondaryActionText, canSwap && { color: colors.accent }]}>Adapter</Text>
                </Pressable>

                <Pressable onPress={() => setStatusExercise(activeExercise)} style={styles.secondaryActionCompact}>
                  <Ionicons name="ellipsis-horizontal" size={18} color={colors.text} />
                </Pressable>
              </View>
            </View>

            {activeBlock.exercises.length > 1 ? (
              <View style={styles.exerciseNav}>
                <Pressable
                  onPress={() => moveExercise(-1)}
                  disabled={activeExerciseIndex === 0}
                  style={[styles.navButton, activeExerciseIndex === 0 && styles.actionDisabled]}
                >
                  <Ionicons name="chevron-back" size={20} color={colors.text} />
                </Pressable>

                <View style={styles.navDots}>
                  {activeBlock.exercises.map((exercise, index) => (
                    <View
                      key={exercise._uiKey}
                      style={[styles.navDot, index === activeExerciseIndex && styles.navDotActive]}
                    />
                  ))}
                </View>

                <Pressable
                  onPress={() => moveExercise(1)}
                  disabled={activeExerciseIndex >= activeBlock.exercises.length - 1}
                  style={[
                    styles.navButton,
                    activeExerciseIndex >= activeBlock.exercises.length - 1 && styles.actionDisabled,
                  ]}
                >
                  <Ionicons name="chevron-forward" size={20} color={colors.text} />
                </Pressable>
              </View>
            ) : null}

            <Pressable onPress={completeCurrentExercise} style={styles.primaryButtonLarge}>
              <Text style={styles.primaryButtonTextLarge}>
                {activeExerciseIndex >= activeBlock.exercises.length - 1
                  ? activeBlock.id === 'skill'
                    ? 'Terminer le Skill'
                    : `Terminer le ${activeBlock.title}`
                  : 'Exercice terminé'}
              </Text>
              <Ionicons name="arrow-forward" size={19} color={colors.textOnAccent} />
            </Pressable>
          </>
        )}

        <View style={styles.bottomSpace} />
      </ScrollView>

      <SwapModal
        visible={Boolean(swapExercise)}
        exercise={swapExercise}
        availability={swapExercise?.sessionExerciseId ? swapAvailability?.[swapExercise.sessionExerciseId] : null}
        busy={swapBusy}
        error={swapError}
        onClose={() => !swapBusy && setSwapExercise(null)}
        onSelect={applySwap}
        styles={styles}
        colors={colors}
      />

      <StatusModal
        visible={Boolean(statusExercise)}
        exercise={statusExercise}
        onClose={() => setStatusExercise(null)}
        onSelect={selectExerciseStatus}
        styles={styles}
        colors={colors}
      />

      <SkillScoreModal
        visible={skillScoreOpen}
        value={skillScoreValue}
        onChange={setSkillScoreValue}
        contract={activeBlock?.skillContract}
        onClose={() => setSkillScoreOpen(false)}
        onSave={saveSkillScore}
        styles={styles}
        colors={colors}
      />

      <FormatModal
        visible={formatOpen}
        options={formatOptions}
        loading={formatLoading}
        changing={formatChanging}
        error={formatError}
        onClose={() => !formatChanging && setFormatOpen(false)}
        onSelect={selectFormat}
        styles={styles}
        colors={colors}
      />
    </SafeAreaView>
  );
}

function FocusedTabata({ block, onFinish, styles, colors }) {
  const protocol = prescriptionObject(block?.exercises?.[0])?.protocol ?? {};
  const rounds = Math.max(1, Number(block?.source?.rounds ?? protocol?.rounds ?? 8) || 8);
  const workSeconds = Math.max(1, Number(block?.source?.workSeconds ?? block?.source?.work_seconds ?? protocol?.work_seconds ?? 20) || 20);
  const restSeconds = Math.max(1, Number(block?.source?.restSeconds ?? block?.source?.rest_seconds ?? protocol?.rest_seconds ?? 10) || 10);
  const cycleSeconds = workSeconds + restSeconds;
  const totalSeconds = rounds * cycleSeconds;

  const [started, setStarted] = useState(false);
  const [paused, setPaused] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!started || paused || elapsed >= totalSeconds) return undefined;
    const timer = setInterval(() => setElapsed((current) => Math.min(totalSeconds, current + 1)), 1000);
    return () => clearInterval(timer);
  }, [elapsed, paused, started, totalSeconds]);

  const roundIndex = Math.min(rounds - 1, Math.floor(elapsed / cycleSeconds));
  const within = elapsed % cycleSeconds;
  const resting = started && elapsed < totalSeconds && within >= workSeconds;
  const remaining = elapsed >= totalSeconds
    ? 0
    : resting
      ? cycleSeconds - within
      : workSeconds - within;
  const activeExercise = block.exercises[roundIndex % Math.max(1, block.exercises.length)] ?? block.exercises[0];

  return (
    <View style={styles.timerCard}>
      <Text style={styles.timerEyebrow}>{started ? (resting ? 'Récupération' : 'Effort') : 'Prêt'}</Text>
      <Text style={styles.timerValue}>{remaining}</Text>
      <Text style={styles.timerUnit}>secondes</Text>
      <Text style={styles.timerRound}>Tour {Math.min(rounds, roundIndex + 1)} / {rounds}</Text>

      <View style={styles.timerExerciseCard}>
        <Text style={styles.timerExerciseLabel}>{resting ? 'Suivant' : 'Exercice actuel'}</Text>
        <Text style={styles.timerExerciseName}>{displayExerciseName(activeExercise)}</Text>
        {activeExercise?.prescription ? (
          <Text style={styles.timerExercisePrescription}>{String(activeExercise.prescription)}</Text>
        ) : null}
      </View>

      {!started ? (
        <Pressable onPress={() => setStarted(true)} style={styles.primaryButtonLarge}>
          <Ionicons name="play" size={19} color={colors.textOnAccent} />
          <Text style={styles.primaryButtonTextLarge}>Démarrer le Tabata</Text>
        </Pressable>
      ) : elapsed < totalSeconds ? (
        <Pressable onPress={() => setPaused((value) => !value)} style={styles.secondaryWideButton}>
          <Ionicons name={paused ? 'play' : 'pause'} size={19} color={colors.text} />
          <Text style={styles.secondaryWideText}>{paused ? 'Reprendre' : 'Pause'}</Text>
        </Pressable>
      ) : (
        <Pressable onPress={onFinish} style={styles.primaryButtonLarge}>
          <Ionicons name="checkmark" size={19} color={colors.textOnAccent} />
          <Text style={styles.primaryButtonTextLarge}>Terminer le Tabata</Text>
        </Pressable>
      )}

      {started && elapsed < totalSeconds ? (
        <Pressable
          onPress={() =>
            Alert.alert('Arrêter le Tabata ?', 'Le bloc sera terminé avec le temps réellement effectué.', [
              { text: 'Annuler', style: 'cancel' },
              { text: 'Arrêter', style: 'destructive', onPress: onFinish },
            ])
          }
          style={styles.stopButton}
        >
          <Text style={styles.stopButtonText}>Arrêter le bloc</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function SwapModal({ visible, exercise, availability, busy, error, onClose, onSelect, styles, colors }) {
  const directions = availability?.directions ?? {};
  const contextual = directions?.equivalent?.available === true || directions?.easier?.available === true;
  const options = [
    ['too_easy', 'Plus difficile', 'arrow-up-circle-outline', directions?.harder?.available === true],
    ['too_hard', 'Plus facile', 'arrow-down-circle-outline', directions?.easier?.available === true],
    ['equivalent', 'Un équivalent', 'swap-horizontal-outline', directions?.equivalent?.available === true],
    ['equipment', 'Matériel indisponible', 'construct-outline', contextual],
    ['environment', 'Impossible ici', 'location-outline', contextual],
  ];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.modalRoot}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <View style={styles.sheetHeaderCopy}>
              <Text style={styles.sheetEyebrow}>Adapter l’exercice</Text>
              <Text style={styles.sheetTitle}>{displayExerciseName(exercise)}</Text>
            </View>
            <Pressable onPress={onClose} disabled={busy} style={styles.sheetClose}>
              <Ionicons name="close" size={20} color={colors.text} />
            </Pressable>
          </View>

          {error ? <Text style={styles.modalError}>{error}</Text> : null}

          {options.map(([value, label, icon, available]) => (
            <Pressable
              key={value}
              onPress={() => onSelect(value, false)}
              disabled={busy || !available}
              style={[styles.modalOption, (!available || busy) && styles.actionDisabled]}
            >
              <Ionicons name={icon} size={20} color={available ? colors.accent : colors.textMuted} />
              <Text style={styles.modalOptionText}>{label}</Text>
              {busy ? <ActivityIndicator size="small" color={colors.accent} /> : null}
            </Pressable>
          ))}

          {availability?.can_undo === true ? (
            <Pressable onPress={() => onSelect('equivalent', true)} disabled={busy} style={styles.modalOption}>
              <Ionicons name="arrow-undo" size={20} color={colors.accent} />
              <Text style={styles.modalOptionText}>Revenir au précédent</Text>
            </Pressable>
          ) : null}
        </View>
      </SafeAreaView>
    </Modal>
  );
}

function StatusModal({ visible, exercise, onClose, onSelect, styles, colors }) {
  const options = [
    ['completed', 'Réalisé', 'checkmark-circle-outline'],
    ['adapted', 'Adapté', 'options-outline'],
    ['not_completed', 'Non réalisé', 'close-circle-outline'],
  ];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.modalRoot}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <View style={styles.sheetHeaderCopy}>
              <Text style={styles.sheetEyebrow}>Statut de l’exercice</Text>
              <Text style={styles.sheetTitle}>{displayExerciseName(exercise)}</Text>
            </View>
            <Pressable onPress={onClose} style={styles.sheetClose}>
              <Ionicons name="close" size={20} color={colors.text} />
            </Pressable>
          </View>

          {options.map(([value, label, icon]) => (
            <Pressable key={value} onPress={() => onSelect(value)} style={styles.modalOption}>
              <Ionicons name={icon} size={20} color={colors.accent} />
              <Text style={styles.modalOptionText}>{label}</Text>
            </Pressable>
          ))}
        </View>
      </SafeAreaView>
    </Modal>
  );
}

function SkillScoreModal({ visible, value, onChange, contract, onClose, onSave, styles, colors }) {
  const label = contract?.scoreLabel ?? contract?.score_label ?? 'Score';
  const unit = contract?.scoreUnit ?? contract?.score_unit ?? '';
  const numeric = Number(String(value).trim().replace(',', '.'));
  const canSave = Number.isFinite(numeric) && numeric > 0;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.modalRoot}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetEyebrow}>Skill terminé</Text>
          <Text style={styles.sheetTitle}>{String(label)}</Text>
          <Text style={styles.sheetBody}>Enregistre ta meilleure performance propre.</Text>
          <View style={styles.scoreInputRow}>
            <TextInput
              value={value}
              onChangeText={onChange}
              autoFocus
              keyboardType="decimal-pad"
              placeholder="0"
              placeholderTextColor={colors.textMuted}
              style={styles.scoreInput}
            />
            {unit ? <Text style={styles.scoreUnit}>{unit}</Text> : null}
          </View>
          <Pressable onPress={onSave} disabled={!canSave} style={[styles.primaryButtonLarge, !canSave && styles.actionDisabled]}>
            <Text style={styles.primaryButtonTextLarge}>Enregistrer</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

function FormatModal({ visible, options, loading, changing, error, onClose, onSelect, styles, colors }) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.modalRoot}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={[styles.sheet, styles.tallSheet]}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <View style={styles.sheetHeaderCopy}>
              <Text style={styles.sheetEyebrow}>Format du WOD</Text>
              <Text style={styles.sheetTitle}>Choisis ta mécanique</Text>
            </View>
            <Pressable onPress={onClose} disabled={Boolean(changing)} style={styles.sheetClose}>
              <Ionicons name="close" size={20} color={colors.text} />
            </Pressable>
          </View>

          {error ? <Text style={styles.modalError}>{error}</Text> : null}
          {loading ? <ActivityIndicator color={colors.accent} style={{ marginTop: 24 }} /> : null}

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 12 }}>
            {options.map((option) => {
              const disabled = !option?.selectable || option?.current || Boolean(changing);
              return (
                <Pressable
                  key={option.option_id ?? option.mechanic}
                  onPress={() => onSelect(option)}
                  disabled={disabled}
                  style={[styles.formatOption, disabled && !option?.current && styles.actionDisabled]}
                >
                  <View style={styles.formatOptionCopy}>
                    <Text style={styles.formatOptionTitle}>{formatOptionTitle(option)}</Text>
                    {option?.description ? <Text style={styles.formatOptionBody}>{option.description}</Text> : null}
                  </View>
                  {changing === option?.option_id ? (
                    <ActivityIndicator size="small" color={colors.accent} />
                  ) : option?.current ? (
                    <Ionicons name="checkmark-circle" size={20} color={colors.accent} />
                  ) : (
                    <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                  )}
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

function createStyles(colors, isDark) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    header: {
      minHeight: 72,
      paddingHorizontal: spacing.lg,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      backgroundColor: colors.background,
    },
    iconButton: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    headerCopy: { flex: 1 },
    headerEyebrow: {
      fontFamily: 'Manrope_600SemiBold',
      fontSize: 11,
      color: colors.textSecondary,
    },
    headerTitle: {
      marginTop: 1,
      fontFamily: 'Manrope_800ExtraBold',
      fontSize: 21,
      lineHeight: 27,
      color: colors.text,
    },
    durationPill: {
      minHeight: 34,
      paddingHorizontal: 11,
      borderRadius: 17,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    durationValue: {
      fontFamily: 'Manrope_700Bold',
      fontSize: 11,
      color: colors.textSecondary,
    },
    progressTrack: { height: 4, backgroundColor: colors.border },
    progressFill: { height: 4, backgroundColor: colors.accent },
    content: { padding: spacing.lg, paddingBottom: 150 },
    blockIntro: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 12,
      marginBottom: 15,
    },
    blockIntroCopy: { flex: 1 },
    blockKicker: {
      fontFamily: 'Manrope_700Bold',
      fontSize: 11,
      color: colors.accent,
    },
    blockTitle: {
      marginTop: 3,
      fontFamily: 'Manrope_800ExtraBold',
      fontSize: 30,
      lineHeight: 36,
      letterSpacing: -0.7,
      color: colors.text,
    },
    blockStructure: {
      marginTop: 5,
      fontFamily: 'Manrope_500Medium',
      fontSize: 14,
      lineHeight: 20,
      color: colors.textSecondary,
    },
    blockCounter: {
      fontFamily: 'BebasNeue_400Regular',
      fontSize: 28,
      color: colors.textMuted,
    },
    mediaCard: {
      height: 235,
      borderRadius: 22,
      overflow: 'hidden',
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      position: 'relative',
    },
    exerciseImage: { width: '100%', height: '100%' },
    mediaFallback: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
    mediaFallbackIcon: {
      width: 74,
      height: 74,
      borderRadius: 37,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.accentSoft,
    },
    mediaFallbackText: {
      fontFamily: 'Manrope_700Bold',
      fontSize: 14,
      color: colors.textSecondary,
    },
    mediaOverlayTop: {
      position: 'absolute',
      top: 12,
      left: 12,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 999,
      backgroundColor: isDark ? 'rgba(7,9,12,0.76)' : 'rgba(255,255,255,0.90)',
    },
    exercisePosition: {
      fontFamily: 'Manrope_700Bold',
      fontSize: 10,
      color: colors.text,
    },
    exerciseCard: {
      marginTop: 14,
      padding: 18,
      borderRadius: 20,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    exerciseName: {
      fontFamily: 'Manrope_800ExtraBold',
      fontSize: 26,
      lineHeight: 32,
      letterSpacing: -0.5,
      color: colors.text,
    },
    exercisePrescription: {
      marginTop: 5,
      fontFamily: 'Manrope_700Bold',
      fontSize: 16,
      lineHeight: 23,
      color: colors.accent,
    },
    objectiveBox: {
      marginTop: 14,
      padding: 13,
      borderRadius: 14,
      backgroundColor: colors.accentSoft,
    },
    objectiveLabel: {
      fontFamily: 'Manrope_700Bold',
      fontSize: 10,
      color: colors.accent,
    },
    objectiveText: {
      marginTop: 4,
      fontFamily: 'Manrope_500Medium',
      fontSize: 13,
      lineHeight: 19,
      color: colors.text,
    },
    detailsBox: {
      marginTop: 14,
      paddingTop: 14,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    detailsLabel: {
      fontFamily: 'Manrope_700Bold',
      fontSize: 11,
      color: colors.textSecondary,
    },
    detailsText: {
      marginTop: 4,
      fontFamily: 'Manrope_400Regular',
      fontSize: 13,
      lineHeight: 20,
      color: colors.textSecondary,
    },
    inlineActions: { marginTop: 16, flexDirection: 'row', alignItems: 'center', gap: 8 },
    secondaryAction: {
      minHeight: 42,
      paddingHorizontal: 12,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.background,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 7,
    },
    secondaryActionCompact: {
      width: 42,
      height: 42,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.background,
      alignItems: 'center',
      justifyContent: 'center',
    },
    secondaryActionText: {
      fontFamily: 'Manrope_700Bold',
      fontSize: 11,
      color: colors.text,
    },
    exerciseNav: {
      marginTop: 12,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    navButton: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    navDots: { flexDirection: 'row', gap: 6, alignItems: 'center' },
    navDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.borderStrong },
    navDotActive: { width: 18, backgroundColor: colors.accent },
    primaryButton: {
      minHeight: 50,
      marginTop: 16,
      paddingHorizontal: 16,
      borderRadius: 14,
      backgroundColor: colors.accent,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
    },
    primaryButtonText: {
      fontFamily: 'Manrope_700Bold',
      fontSize: 13,
      color: colors.textOnAccent,
    },
    primaryButtonLarge: {
      minHeight: 56,
      marginTop: 16,
      paddingHorizontal: 18,
      borderRadius: 16,
      backgroundColor: colors.accent,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 9,
    },
    primaryButtonTextLarge: {
      fontFamily: 'Manrope_800ExtraBold',
      fontSize: 14,
      color: colors.textOnAccent,
    },
    smallActionButton: {
      minHeight: 38,
      paddingHorizontal: 11,
      borderRadius: 11,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.background,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    smallActionText: {
      fontFamily: 'Manrope_700Bold',
      fontSize: 11,
      color: colors.accent,
    },
    actionDisabled: { opacity: 0.34 },
    secretCard: {
      padding: 20,
      borderRadius: 22,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
    },
    secretIcon: {
      width: 54,
      height: 54,
      borderRadius: 27,
      backgroundColor: colors.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
    secretTitle: {
      marginTop: 12,
      fontFamily: 'Manrope_800ExtraBold',
      fontSize: 24,
      color: colors.text,
    },
    secretText: {
      marginTop: 6,
      maxWidth: 320,
      fontFamily: 'Manrope_400Regular',
      fontSize: 13,
      lineHeight: 20,
      color: colors.textSecondary,
      textAlign: 'center',
    },
    formatRow: {
      width: '100%',
      marginTop: 18,
      paddingTop: 14,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    formatRowStandalone: {
      padding: 14,
      marginBottom: 12,
      borderRadius: 15,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    formatCopy: { flex: 1 },
    formatLabel: {
      fontFamily: 'Manrope_600SemiBold',
      fontSize: 10,
      color: colors.textMuted,
    },
    formatValue: {
      marginTop: 2,
      fontFamily: 'Manrope_800ExtraBold',
      fontSize: 17,
      color: colors.text,
    },
    wodWrap: { gap: 0 },
    timerCard: {
      padding: 20,
      borderRadius: 22,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
    },
    timerEyebrow: {
      fontFamily: 'Manrope_800ExtraBold',
      fontSize: 12,
      color: colors.accent,
    },
    timerValue: {
      marginTop: 4,
      fontFamily: 'BebasNeue_400Regular',
      fontSize: 88,
      lineHeight: 96,
      color: colors.text,
    },
    timerUnit: {
      marginTop: -7,
      fontFamily: 'Manrope_600SemiBold',
      fontSize: 11,
      color: colors.textMuted,
    },
    timerRound: {
      marginTop: 8,
      fontFamily: 'Manrope_700Bold',
      fontSize: 13,
      color: colors.textSecondary,
    },
    timerExerciseCard: {
      width: '100%',
      marginTop: 18,
      padding: 16,
      borderRadius: 16,
      backgroundColor: colors.background,
      borderWidth: 1,
      borderColor: colors.border,
    },
    timerExerciseLabel: {
      fontFamily: 'Manrope_600SemiBold',
      fontSize: 10,
      color: colors.textMuted,
    },
    timerExerciseName: {
      marginTop: 3,
      fontFamily: 'Manrope_800ExtraBold',
      fontSize: 22,
      color: colors.text,
    },
    timerExercisePrescription: {
      marginTop: 4,
      fontFamily: 'Manrope_600SemiBold',
      fontSize: 13,
      color: colors.accent,
    },
    secondaryWideButton: {
      width: '100%',
      minHeight: 52,
      marginTop: 16,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.background,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
    },
    secondaryWideText: {
      fontFamily: 'Manrope_700Bold',
      fontSize: 13,
      color: colors.text,
    },
    stopButton: { marginTop: 13, paddingVertical: 8, paddingHorizontal: 12 },
    stopButtonText: {
      fontFamily: 'Manrope_600SemiBold',
      fontSize: 11,
      color: colors.error,
    },
    modalRoot: { flex: 1, justifyContent: 'flex-end' },
    backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.62)' },
    sheet: {
      maxHeight: '78%',
      paddingHorizontal: spacing.lg,
      paddingTop: 10,
      paddingBottom: 24,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      backgroundColor: colors.background,
      borderWidth: 1,
      borderColor: colors.border,
    },
    tallSheet: { maxHeight: '88%' },
    sheetHandle: {
      width: 42,
      height: 4,
      borderRadius: 2,
      alignSelf: 'center',
      backgroundColor: colors.borderStrong,
      marginBottom: 14,
    },
    sheetHeader: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
    sheetHeaderCopy: { flex: 1 },
    sheetEyebrow: {
      fontFamily: 'Manrope_700Bold',
      fontSize: 11,
      color: colors.accent,
    },
    sheetTitle: {
      marginTop: 3,
      fontFamily: 'Manrope_800ExtraBold',
      fontSize: 23,
      lineHeight: 29,
      color: colors.text,
    },
    sheetBody: {
      marginTop: 6,
      fontFamily: 'Manrope_400Regular',
      fontSize: 13,
      lineHeight: 19,
      color: colors.textSecondary,
    },
    sheetClose: {
      width: 38,
      height: 38,
      borderRadius: 19,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    modalOption: {
      minHeight: 55,
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
    modalOptionText: {
      flex: 1,
      fontFamily: 'Manrope_700Bold',
      fontSize: 13,
      color: colors.text,
    },
    modalError: {
      marginTop: 12,
      fontFamily: 'Manrope_600SemiBold',
      fontSize: 12,
      lineHeight: 18,
      color: colors.error,
    },
    scoreInputRow: {
      marginTop: 16,
      minHeight: 58,
      borderRadius: 15,
      borderWidth: 1,
      borderColor: colors.borderStrong,
      backgroundColor: colors.surface,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 14,
    },
    scoreInput: {
      flex: 1,
      fontFamily: 'BebasNeue_400Regular',
      fontSize: 34,
      color: colors.text,
    },
    scoreUnit: {
      fontFamily: 'Manrope_700Bold',
      fontSize: 12,
      color: colors.textSecondary,
    },
    formatOption: {
      minHeight: 68,
      marginTop: 10,
      padding: 14,
      borderRadius: 15,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    formatOptionCopy: { flex: 1 },
    formatOptionTitle: {
      fontFamily: 'Manrope_800ExtraBold',
      fontSize: 14,
      color: colors.text,
    },
    formatOptionBody: {
      marginTop: 3,
      fontFamily: 'Manrope_400Regular',
      fontSize: 11,
      lineHeight: 16,
      color: colors.textSecondary,
    },
    emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
    emptyTitle: {
      marginTop: 12,
      fontFamily: 'Manrope_800ExtraBold',
      fontSize: 24,
      color: colors.text,
    },
    emptyText: {
      marginTop: 5,
      fontFamily: 'Manrope_400Regular',
      fontSize: 13,
      color: colors.textSecondary,
    },
    bottomSpace: { height: 20 },
  });
}
