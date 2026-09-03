import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
  return normalized === 'warm_up' ? 'warmup' : normalized;
}

function readSourceBlock(workout, blockId) {
  const blocks = workout?.blocks ?? {};
  if (Array.isArray(blocks)) {
    return (
      blocks.find(
        (block) =>
          normalizeBlockId(
            block?.block_key ?? block?.blockKey ?? block?.key ?? block?.id
          ) === blockId
      ) ?? null
    );
  }

  if (blockId === 'warmup') return blocks?.warmup ?? blocks?.warm_up ?? null;
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

function normalizeDetailText(value) {
  if (value == null) return '';
  return String(value)
    .replace(/\\r\\n|\\n|\\r/g, '\n')
    .replace(/\r\n?/g, '\n')
    .replace(/(^|\n)\s*(\d+)[.)-]?\s+/g, (_, prefix, number) => `${prefix}${number}. `)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function shortCue(exercise) {
  const value = normalizeDetailText(
    exercise?.tips ?? exercise?.instructions ?? exercise?.description ?? ''
  );
  if (!value) return null;

  const line = value.split(/\n+/)[0].replace(/^\d+\.\s*/, '').trim();
  const sentence = line.match(/^(.{1,150}?[.!?])(?:\s|$)/)?.[1] ?? line;
  return sentence.length > 150 ? `${sentence.slice(0, 147).trim()}…` : sentence;
}

function buildBlockStructure(blockId, source, exercises) {
  const prescription = prescriptionObject(exercises?.[0]);
  const protocol = prescription?.protocol ?? {};

  if (blockId === 'tabata') {
    const rounds = firstFinite(source?.rounds, protocol?.rounds, 8);
    const work = firstFinite(
      source?.workSeconds,
      source?.work_seconds,
      protocol?.work_seconds,
      20
    );
    const rest = firstFinite(
      source?.restSeconds,
      source?.rest_seconds,
      protocol?.rest_seconds,
      10
    );
    return `${rounds} tours · ${work}s travail / ${rest}s repos`;
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
    const rounds = firstFinite(
      source?.warmupRounds,
      source?.warmup_rounds,
      prescription?.warmup_rounds,
      3
    );
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

    const duration =
      firstFinite(source?.duration, source?.duration_minutes, source?.durationMinutes, 0) ?? 0;

    return {
      id: blockId,
      title: BLOCK_LABELS[blockId] ?? blockId,
      source,
      durationMinutes: duration,
      durationLabel: duration > 0 ? `${duration} min` : null,
      structure: buildBlockStructure(blockId, source, rows),
      objective: source?.objective ?? null,
      skillContract: source?.skillContract ?? source?.skill_contract ?? null,
      mechanic:
        source?.mechanic ??
        source?.mechanic_json?.mechanic_key ??
        source?.mechanicJson?.mechanic_key ??
        null,
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

export default function SessionArenaCore() {
  const { workout, updateWorkout, setExerciseLoad } = useWorkout();
  const { colors, isDark } = useUgerodTheme();
  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);

  const blocks = useMemo(() => buildBlocks(workout), [workout]);
  const validatedBlocks = Array.isArray(workout?.validatedBlocks) ? workout.validatedBlocks : [];
  const activeBlock =
    blocks.find((block) => !validatedBlocks.includes(block.id)) ?? blocks.at(-1) ?? null;
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
      console.warn('Arena player swap availability', error);
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
      console.warn('Session start', error);
      return;
    }

    const contract = block?.skillContract ?? {};
    if (
      block.id === 'skill' &&
      (contract?.scoreRequired === true || contract?.score_required === true)
    ) {
      setSkillScoreValue('');
      setSkillScoreOpen(true);
      return;
    }

    finalizeBlock(block);
  }

  async function markCurrentAndAdvance(status) {
    if (!activeBlock || !activeExercise) return;
    try {
      await ensureSessionStarted();
    } catch (error) {
      console.warn('Session start', error);
      return;
    }

    patchExercise(activeExercise, { status });

    if (activeExerciseIndex >= activeBlock.exercises.length - 1) {
      if (activeBlock.id === 'skill') {
        const contract = activeBlock?.skillContract ?? {};
        if (contract?.scoreRequired === true || contract?.score_required === true) {
          setSkillScoreValue('');
          setSkillScoreOpen(true);
          return;
        }
      }

      const patchedBlock = {
        ...activeBlock,
        exercises: activeBlock.exercises.map((exercise, index) =>
          index === activeExerciseIndex ? { ...exercise, status } : exercise
        ),
      };
      finalizeBlock(patchedBlock);
      return;
    }

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

  const wodUnlocked = useMemo(() => {
    const previous = blocks.filter((block) => block.id !== 'wod').map((block) => block.id);
    return previous.every((blockId) => validatedBlocks.includes(blockId));
  }, [blocks, validatedBlocks]);

  const wodRevealed = Boolean(workout?.wodRevealed || workout?.wodRevealedAt);

  async function revealWod() {
    if (!wodUnlocked || wodRevealed) return;
    try {
      const result = workout?.sessionId
        ? await markWorkoutWodRevealed({ sessionId: workout.sessionId })
        : null;
      updateWorkout({
        wodRevealed: true,
        wodRevealedAt: result?.wod_revealed_at ?? new Date().toISOString(),
        formatChangeCount: Number(result?.format_change_count ?? workout?.formatChangeCount ?? 0),
        formatChangeLimit: Number(result?.format_change_limit ?? workout?.formatChangeLimit ?? 3),
        formatLocked: Boolean(result?.format_locked ?? false),
      });
    } catch (error) {
      console.warn('WOD reveal', error);
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
          <Text style={styles.emptyTitle}>Séance incomplète</Text>
          <Text style={styles.emptyText}>Aucun bloc exécutable n’a été chargé.</Text>
        </View>
      </SafeAreaView>
    );
  }

  const imageUri = exerciseImageUri(activeExercise);
  const cue = shortCue(activeExercise);
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
        <Pressable
          onPress={() => router.replace('/workout/preparation')}
          hitSlop={12}
          style={styles.iconButton}
        >
          <Ionicons name="arrow-back" size={21} color={colors.text} />
        </Pressable>

        <View style={styles.headerCopy}>
          <Text style={styles.headerEyebrow}>
            Séance · {activeBlockIndex + 1}/{blocks.length}
          </Text>
          <Text style={styles.headerTitle}>{activeBlock.title}</Text>
        </View>

        <View style={styles.durationPill}>
          <Text style={styles.durationValue}>{activeBlock.durationLabel ?? '—'}</Text>
        </View>
      </View>

      <View style={styles.progressTrack}>
        <View
          style={[
            styles.progressFill,
            { width: `${Math.max(4, Math.round(progress * 100))}%` },
          ]}
        />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <ArenaBoard
          block={activeBlock}
          blockIndex={activeBlockIndex}
          blockCount={blocks.length}
          activeExerciseIndex={activeExerciseIndex}
          styles={styles}
          colors={colors}
          hideExercises={activeBlock.id === 'wod' && !wodRevealed}
        />

        {activeBlock.id === 'wod' ? (
          !wodRevealed ? (
            <View style={styles.secretCard}>
              <View style={styles.orangeTag}>
                <Ionicons name="eye-off-outline" size={17} color={colors.textOnAccent} />
                <Text style={styles.orangeTagText}>WOD SECRET</Text>
              </View>
              <Text style={styles.secretTitle}>Ton WOD est prêt.</Text>
              <Text style={styles.secretText}>
                Le format est visible. Les exercices restent cachés jusqu’au moment où tu entres dans le WOD.
              </Text>

              <View style={styles.formatRow}>
                <View style={styles.formatCopy}>
                  <Text style={styles.formatLabel}>Format</Text>
                  <Text style={styles.formatValue}>
                    {String(workout?.format ?? activeBlock?.source?.mechanicLabel ?? 'UGEROD')}
                  </Text>
                </View>
                {remainingFormatChanges > 0 && !workout?.formatLocked ? (
                  <Pressable onPress={openFormatModal} style={styles.smallActionButton}>
                    <Ionicons name="options-outline" size={16} color={colors.accent} />
                    <Text style={styles.smallActionText}>Modifier</Text>
                  </Pressable>
                ) : null}
              </View>

              <Pressable onPress={revealWod} style={styles.primaryButtonLarge}>
                <Text style={styles.primaryButtonTextLarge}>Découvrir le WOD</Text>
                <Ionicons name="arrow-forward" size={19} color={colors.textOnAccent} />
              </Pressable>
            </View>
          ) : (
            <View style={styles.wodWrap}>
              <View style={styles.formatRowStandalone}>
                <View style={styles.formatCopy}>
                  <Text style={styles.formatLabel}>Format du WOD</Text>
                  <Text style={styles.formatValue}>
                    {String(workout?.format ?? activeBlock?.source?.mechanicLabel ?? 'UGEROD')}
                  </Text>
                </View>
                {remainingFormatChanges > 0 &&
                !workout?.formatLocked &&
                !workout?.wodRuntime?.started ? (
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
                <Pressable onPress={() => completeBlock(activeBlock)} style={styles.primaryButtonLarge}>
                  <Text style={styles.primaryButtonTextLarge}>Terminer la séance</Text>
                  <Ionicons name="arrow-forward" size={19} color={colors.textOnAccent} />
                </Pressable>
              ) : null}
            </View>
          )
        ) : activeBlock.id === 'tabata' ? (
          <ArenaTabata
            block={activeBlock}
            onFinish={() => completeBlock(activeBlock)}
            styles={styles}
            colors={colors}
          />
        ) : (
          <>
            <View style={styles.mediaCard}>
              {imageUri ? (
                <Image source={{ uri: imageUri }} style={styles.exerciseImage} resizeMode="cover" />
              ) : (
                <View style={styles.mediaFallback}>
                  <View style={styles.mediaFallbackIcon}>
                    <Ionicons name="barbell-outline" size={36} color={colors.accent} />
                  </View>
                  <Text style={styles.mediaFallbackText}>{activeBlock.title}</Text>
                </View>
              )}
              <View style={styles.mediaPositionBadge}>
                <Text style={styles.mediaPositionText}>
                  {activeExerciseIndex + 1}/{activeBlock.exercises.length}
                </Text>
              </View>
            </View>

            <View style={styles.exercisePanel}>
              <Text style={styles.exerciseName}>{displayExerciseName(activeExercise)}</Text>
              {activeExercise?.prescription ? (
                <Text style={styles.exercisePrescription}>{String(activeExercise.prescription)}</Text>
              ) : null}

              {cue ? (
                <View style={styles.cueRow}>
                  <View style={styles.cueDot} />
                  <Text style={styles.cueText}>{cue}</Text>
                </View>
              ) : null}

              {detailsOpen ? (
                <View style={styles.detailsBox}>
                  {activeExercise?.instructions ? (
                    <>
                      <Text style={styles.detailsLabel}>Exécution</Text>
                      <Text style={styles.detailsText}>
                        {normalizeDetailText(activeExercise.instructions)}
                      </Text>
                    </>
                  ) : null}
                  {activeExercise?.tips ? (
                    <>
                      <Text style={[styles.detailsLabel, styles.detailsLabelSpaced]}>
                        Conseil UGEROD
                      </Text>
                      <Text style={styles.detailsText}>
                        {normalizeDetailText(activeExercise.tips)}
                      </Text>
                    </>
                  ) : null}
                  {!activeExercise?.instructions && !activeExercise?.tips ? (
                    <Text style={styles.detailsText}>Aucune consigne détaillée supplémentaire.</Text>
                  ) : null}
                </View>
              ) : null}

              <Pressable
                onPress={() => setDetailsOpen((value) => !value)}
                style={styles.instructionsButton}
              >
                <Ionicons
                  name={detailsOpen ? 'chevron-up' : 'information-circle-outline'}
                  size={18}
                  color={colors.text}
                />
                <Text style={styles.instructionsButtonText}>
                  {detailsOpen ? 'Réduire les consignes' : 'Voir les consignes'}
                </Text>
              </Pressable>
            </View>

            <View style={styles.actionStrip}>
              <Pressable
                onPress={() => openSwap(activeExercise)}
                disabled={!canSwap || swapLoading}
                style={[styles.actionButton, (!canSwap || swapLoading) && styles.actionDisabled]}
              >
                {swapLoading ? (
                  <ActivityIndicator size="small" color={colors.accent} />
                ) : (
                  <Ionicons
                    name="swap-horizontal-outline"
                    size={20}
                    color={canSwap ? colors.accent : colors.textMuted}
                  />
                )}
                <Text style={[styles.actionButtonText, canSwap && { color: colors.accent }]}>Adapter</Text>
              </Pressable>

              <Pressable
                onPress={() => markCurrentAndAdvance('not_completed')}
                style={[styles.actionButton, styles.rejectButton]}
              >
                <Ionicons name="close" size={20} color={colors.secondaryAccent} />
                <Text style={[styles.actionButtonText, { color: colors.secondaryAccent }]}>Refuser</Text>
              </Pressable>
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

            <Pressable
              onPress={() => markCurrentAndAdvance('completed')}
              style={styles.primaryButtonLarge}
            >
              <Ionicons name="checkmark-circle-outline" size={20} color={colors.textOnAccent} />
              <Text style={styles.primaryButtonTextLarge}>
                {activeExerciseIndex >= activeBlock.exercises.length - 1
                  ? activeBlock.id === 'skill'
                    ? 'Terminer le Skill'
                    : `Terminer le ${activeBlock.title}`
                  : 'Réalisé · exercice suivant'}
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

function ArenaBoard({
  block,
  blockIndex,
  blockCount,
  activeExerciseIndex,
  styles,
  colors,
  hideExercises,
}) {
  return (
    <View style={styles.arenaBoard}>
      <View style={styles.arenaTopLine} />
      <View style={styles.arenaHeader}>
        <View style={styles.arenaHeaderCopy}>
          <Text style={styles.arenaEyebrow}>DANS L’ARÈNE · BLOC {blockIndex + 1}/{blockCount}</Text>
          <Text style={styles.arenaTitle}>{block.title}</Text>
          {block.structure ? <Text style={styles.arenaStructure}>{block.structure}</Text> : null}
        </View>
        {block.durationLabel ? (
          <View style={styles.arenaDurationBadge}>
            <Text style={styles.arenaDurationText}>{block.durationLabel}</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.arenaRule} />

      {hideExercises ? (
        <View style={styles.secretBoardRow}>
          <Ionicons name="lock-closed-outline" size={18} color={colors.secondaryAccent} />
          <Text style={styles.secretBoardText}>Le tableau du WOD sera dévoilé au dernier moment.</Text>
        </View>
      ) : (
        block.exercises.map((exercise, index) => {
          const state = statusValue(exercise);
          const active = index === activeExerciseIndex;
          const completed = state === 'completed';
          const refused = state === 'not_completed';
          return (
            <View
              key={exercise._uiKey}
              style={[
                styles.arenaRow,
                active && styles.arenaRowActive,
                index > 0 && styles.arenaRowBorder,
              ]}
            >
              <View style={[styles.arenaIndex, active && styles.arenaIndexActive]}>
                {completed ? (
                  <Ionicons name="checkmark" size={14} color="#FFFFFF" />
                ) : refused ? (
                  <Ionicons name="close" size={14} color="#FFFFFF" />
                ) : (
                  <Text style={[styles.arenaIndexText, active && styles.arenaIndexTextActive]}>
                    {index + 1}
                  </Text>
                )}
              </View>
              <View style={styles.arenaExerciseCopy}>
                <Text style={[styles.arenaExerciseName, !active && styles.arenaExerciseNameMuted]}>
                  {displayExerciseName(exercise)}
                </Text>
                {exercise?.prescription ? (
                  <Text style={styles.arenaExercisePrescription}>{String(exercise.prescription)}</Text>
                ) : null}
              </View>
              {active ? (
                <View style={styles.liveBadge}>
                  <Text style={styles.liveBadgeText}>EN COURS</Text>
                </View>
              ) : null}
            </View>
          );
        })
      )}
    </View>
  );
}

function ArenaTabata({ block, onFinish, styles, colors }) {
  const protocol = prescriptionObject(block?.exercises?.[0])?.protocol ?? {};
  const rounds = Math.max(1, Number(block?.source?.rounds ?? protocol?.rounds ?? 8) || 8);
  const workSeconds = Math.max(
    1,
    Number(block?.source?.workSeconds ?? block?.source?.work_seconds ?? protocol?.work_seconds ?? 20) || 20
  );
  const restSeconds = Math.max(
    1,
    Number(block?.source?.restSeconds ?? block?.source?.rest_seconds ?? protocol?.rest_seconds ?? 10) || 10
  );
  const cycleSeconds = workSeconds + restSeconds;
  const totalSeconds = rounds * cycleSeconds;

  const [started, setStarted] = useState(false);
  const [paused, setPaused] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [exerciseIndex, setExerciseIndex] = useState(0);
  const [confirmStop, setConfirmStop] = useState(false);
  const lastRoundRef = useRef(0);

  useEffect(() => {
    if (!started || paused || elapsed >= totalSeconds) return undefined;
    const timer = setInterval(() => {
      setElapsed((current) => Math.min(totalSeconds, current + 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [elapsed, paused, started, totalSeconds]);

  const roundIndex = Math.min(rounds - 1, Math.floor(elapsed / cycleSeconds));
  const within = elapsed % cycleSeconds;
  const resting = started && elapsed < totalSeconds && within >= workSeconds;
  const phaseDuration = resting ? restSeconds : workSeconds;
  const remaining =
    elapsed >= totalSeconds
      ? 0
      : resting
        ? cycleSeconds - within
        : workSeconds - within;

  useEffect(() => {
    if (!started || roundIndex === lastRoundRef.current) return;
    lastRoundRef.current = roundIndex;
    setExerciseIndex(roundIndex % Math.max(1, block.exercises.length));
  }, [block.exercises.length, roundIndex, started]);

  const currentExercise =
    block.exercises[exerciseIndex % Math.max(1, block.exercises.length)] ?? block.exercises[0];
  const nextExercise =
    block.exercises[(exerciseIndex + 1) % Math.max(1, block.exercises.length)] ?? currentExercise;
  const shownExercise = resting ? nextExercise : currentExercise;
  const cue = shortCue(shownExercise);
  const phaseColor = resting ? colors.secondaryAccent : colors.accent;

  function moveTabataExercise(direction) {
    if (block.exercises.length <= 1) return;
    setExerciseIndex((current) => {
      const next = current + direction;
      if (next < 0) return block.exercises.length - 1;
      if (next >= block.exercises.length) return 0;
      return next;
    });
  }

  return (
    <View style={styles.tabataArena}>
      <View style={styles.tabataPhasePill}>
        <View style={[styles.tabataPhaseDot, { backgroundColor: phaseColor }]} />
        <Text style={[styles.tabataPhaseText, { color: phaseColor }]}>
          {started ? (resting ? 'RÉCUPÉRATION' : 'EFFORT') : 'PRÊT'}
        </Text>
      </View>

      <SegmentGauge
        value={remaining}
        total={phaseDuration}
        color={phaseColor}
        label={String(remaining)}
        styles={styles}
      />

      <Text style={styles.tabataRound}>TOUR {Math.min(rounds, roundIndex + 1)} / {rounds}</Text>

      <View style={styles.tabataExercisePanel}>
        <Text style={styles.tabataExerciseLabel}>{resting ? 'SUIVANT' : 'EXERCICE ACTUEL'}</Text>
        <Text style={styles.tabataExerciseName}>{displayExerciseName(shownExercise)}</Text>
        {shownExercise?.prescription ? (
          <Text style={styles.tabataExercisePrescription}>{String(shownExercise.prescription)}</Text>
        ) : null}
        {cue ? <Text style={styles.tabataCue}>{cue}</Text> : null}
      </View>

      {block.exercises.length > 1 ? (
        <View style={styles.tabataNavRow}>
          <Pressable onPress={() => moveTabataExercise(-1)} style={styles.tabataNavButton}>
            <Ionicons name="chevron-back" size={18} color={colors.text} />
            <Text style={styles.tabataNavText}>Précédent</Text>
          </Pressable>
          <Pressable onPress={() => moveTabataExercise(1)} style={styles.tabataNavButton}>
            <Text style={styles.tabataNavText}>Suivant</Text>
            <Ionicons name="chevron-forward" size={18} color={colors.text} />
          </Pressable>
        </View>
      ) : null}

      {!started ? (
        <Pressable onPress={() => setStarted(true)} style={styles.primaryButtonLarge}>
          <Ionicons name="play" size={19} color={colors.textOnAccent} />
          <Text style={styles.primaryButtonTextLarge}>Démarrer le Tabata</Text>
        </Pressable>
      ) : elapsed < totalSeconds ? (
        <Pressable onPress={() => setPaused((value) => !value)} style={styles.pauseButton}>
          <Ionicons name={paused ? 'play' : 'pause'} size={20} color={colors.text} />
          <Text style={styles.pauseButtonText}>{paused ? 'Reprendre' : 'Pause'}</Text>
        </Pressable>
      ) : (
        <Pressable onPress={onFinish} style={styles.primaryButtonLarge}>
          <Ionicons name="checkmark" size={19} color={colors.textOnAccent} />
          <Text style={styles.primaryButtonTextLarge}>Terminer le Tabata</Text>
        </Pressable>
      )}

      {started && elapsed < totalSeconds ? (
        <Pressable onPress={() => setConfirmStop(true)} style={styles.stopTabataButton}>
          <Ionicons name="stop-circle-outline" size={18} color={colors.secondaryAccent} />
          <Text style={styles.stopTabataText}>Arrêter maintenant</Text>
        </Pressable>
      ) : null}

      <Modal visible={confirmStop} transparent animationType="fade" onRequestClose={() => setConfirmStop(false)}>
        <View style={styles.confirmOverlay}>
          <Pressable style={styles.confirmBackdrop} onPress={() => setConfirmStop(false)} />
          <View style={styles.confirmCard}>
            <Text style={styles.confirmEyebrow}>TABATA EN COURS</Text>
            <Text style={styles.confirmTitle}>Arrêter le bloc maintenant ?</Text>
            <Text style={styles.confirmText}>Tu quittes le chrono sans attendre la fin du Tabata.</Text>
            <View style={styles.confirmActions}>
              <Pressable onPress={() => setConfirmStop(false)} style={styles.confirmCancel}>
                <Text style={styles.confirmCancelText}>Continuer</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  setConfirmStop(false);
                  setPaused(true);
                  onFinish();
                }}
                style={styles.confirmStop}
              >
                <Text style={styles.confirmStopText}>Arrêter le bloc</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function SegmentGauge({ value, total, color, label, styles }) {
  const safeTotal = Math.max(1, Number(total) || 1);
  const safeValue = Math.max(0, Number(value) || 0);
  const ratio = Math.max(0, Math.min(1, safeValue / safeTotal));
  const segmentCount = 30;
  const activeCount = Math.ceil(ratio * segmentCount);
  const radius = 74;

  return (
    <View style={styles.gaugeWrap}>
      <View style={styles.gaugeRing}>
        {Array.from({ length: segmentCount }, (_, index) => (
          <View
            key={index}
            style={[
              styles.gaugeSegment,
              {
                backgroundColor: color,
                opacity: index < activeCount ? 1 : 0.13,
                transform: [
                  { rotate: `${index * (360 / segmentCount)}deg` },
                  { translateY: -radius },
                ],
              },
            ]}
          />
        ))}
        <View style={styles.gaugeCenter}>
          <Text style={styles.gaugeValue}>{label}</Text>
          <Text style={styles.gaugeUnit}>SEC</Text>
        </View>
      </View>
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
              keyboardType="decimal-pad"
              placeholder="0"
              placeholderTextColor={colors.textMuted}
              style={styles.scoreInput}
            />
            {unit ? <Text style={styles.scoreUnit}>{unit}</Text> : null}
          </View>
          <Pressable
            onPress={onSave}
            disabled={!canSave}
            style={[styles.primaryButtonLarge, !canSave && styles.actionDisabled]}
          >
            <Text style={styles.primaryButtonTextLarge}>Enregistrer le score</Text>
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
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <View style={styles.sheetHeaderCopy}>
              <Text style={styles.sheetEyebrow}>Format du WOD</Text>
              <Text style={styles.sheetTitle}>Choisis ton format</Text>
            </View>
            <Pressable onPress={onClose} disabled={Boolean(changing)} style={styles.sheetClose}>
              <Ionicons name="close" size={20} color={colors.text} />
            </Pressable>
          </View>

          {loading ? <ActivityIndicator color={colors.accent} style={styles.sheetLoader} /> : null}
          {error ? <Text style={styles.modalError}>{error}</Text> : null}

          {!loading
            ? options.map((option) => (
                <Pressable
                  key={option.option_id ?? option.display_name}
                  onPress={() => onSelect(option)}
                  disabled={!option.selectable || option.current || Boolean(changing)}
                  style={[
                    styles.modalOption,
                    (!option.selectable || Boolean(changing)) && styles.actionDisabled,
                  ]}
                >
                  <View style={styles.modalOptionCopy}>
                    <Text style={styles.modalOptionText}>
                      {String(option.display_name ?? option.option_id ?? option.mechanic ?? 'Format')}
                    </Text>
                    {option.current ? <Text style={styles.modalOptionMeta}>Format actuel</Text> : null}
                  </View>
                  {changing === option.option_id ? (
                    <ActivityIndicator size="small" color={colors.accent} />
                  ) : (
                    <Ionicons
                      name={option.current ? 'checkmark-circle' : 'chevron-forward'}
                      size={18}
                      color={option.current ? colors.accent : colors.textMuted}
                    />
                  )}
                </Pressable>
              ))
            : null}
        </View>
      </SafeAreaView>
    </Modal>
  );
}

function createStyles(colors, isDark) {
  const boardBackground = isDark ? '#10140F' : '#171A15';
  const boardText = '#F7F8F3';
  const boardMuted = '#AEB5A8';

  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    header: {
      minHeight: 104,
      paddingHorizontal: spacing.lg,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      backgroundColor: colors.background,
    },
    iconButton: {
      width: 44,
      height: 44,
      borderRadius: 22,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surface,
    },
    headerCopy: { flex: 1 },
    headerEyebrow: {
      fontFamily: 'Manrope_600SemiBold',
      fontSize: 11,
      color: colors.textSecondary,
    },
    headerTitle: {
      marginTop: 2,
      fontFamily: 'Manrope_800ExtraBold',
      fontSize: 27,
      lineHeight: 31,
      color: colors.text,
    },
    durationPill: {
      minWidth: 68,
      minHeight: 42,
      borderRadius: 21,
      paddingHorizontal: 12,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    durationValue: {
      fontFamily: 'Manrope_700Bold',
      fontSize: 12,
      color: colors.textSecondary,
    },
    progressTrack: { height: 5, backgroundColor: colors.border },
    progressFill: { height: 5, backgroundColor: colors.secondaryAccent },
    content: {
      paddingHorizontal: spacing.lg,
      paddingTop: 18,
      paddingBottom: 180,
      gap: 16,
    },

    arenaBoard: {
      overflow: 'hidden',
      borderRadius: 12,
      backgroundColor: boardBackground,
      borderWidth: 1,
      borderColor: isDark ? '#30382D' : '#2C342A',
      shadowColor: '#000000',
      shadowOpacity: isDark ? 0.24 : 0.14,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 6 },
    },
    arenaTopLine: { height: 5, backgroundColor: colors.secondaryAccent },
    arenaHeader: {
      paddingHorizontal: 16,
      paddingTop: 14,
      paddingBottom: 12,
      flexDirection: 'row',
      gap: 12,
      alignItems: 'flex-start',
    },
    arenaHeaderCopy: { flex: 1 },
    arenaEyebrow: {
      fontFamily: 'Manrope_800ExtraBold',
      fontSize: 9,
      letterSpacing: 1.1,
      color: colors.secondaryAccent,
    },
    arenaTitle: {
      marginTop: 3,
      fontFamily: 'Manrope_800ExtraBold',
      fontSize: 28,
      lineHeight: 32,
      color: boardText,
    },
    arenaStructure: {
      marginTop: 4,
      fontFamily: 'Manrope_500Medium',
      fontSize: 12,
      lineHeight: 18,
      color: boardMuted,
    },
    arenaDurationBadge: {
      paddingHorizontal: 10,
      minHeight: 30,
      borderRadius: 15,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(255,255,255,0.08)',
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.12)',
    },
    arenaDurationText: {
      fontFamily: 'Manrope_700Bold',
      fontSize: 11,
      color: boardText,
    },
    arenaRule: { height: 1, marginHorizontal: 16, backgroundColor: 'rgba(255,255,255,0.12)' },
    arenaRow: {
      minHeight: 62,
      paddingHorizontal: 16,
      paddingVertical: 10,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 11,
    },
    arenaRowActive: { backgroundColor: 'rgba(255,107,25,0.14)' },
    arenaRowBorder: { borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.08)' },
    arenaIndex: {
      width: 28,
      height: 28,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.18)',
      backgroundColor: 'rgba(255,255,255,0.05)',
    },
    arenaIndexActive: { backgroundColor: colors.secondaryAccent, borderColor: colors.secondaryAccent },
    arenaIndexText: { fontFamily: 'Manrope_800ExtraBold', fontSize: 11, color: boardMuted },
    arenaIndexTextActive: { color: '#FFFFFF' },
    arenaExerciseCopy: { flex: 1 },
    arenaExerciseName: {
      fontFamily: 'Manrope_700Bold',
      fontSize: 14,
      lineHeight: 19,
      color: boardText,
    },
    arenaExerciseNameMuted: { color: '#D0D5CC' },
    arenaExercisePrescription: {
      marginTop: 2,
      fontFamily: 'Manrope_500Medium',
      fontSize: 11,
      color: boardMuted,
    },
    liveBadge: {
      paddingHorizontal: 8,
      minHeight: 24,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.secondaryAccent,
    },
    liveBadgeText: {
      fontFamily: 'Manrope_800ExtraBold',
      fontSize: 8,
      letterSpacing: 0.7,
      color: '#FFFFFF',
    },
    secretBoardRow: {
      minHeight: 68,
      paddingHorizontal: 16,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    secretBoardText: {
      flex: 1,
      fontFamily: 'Manrope_600SemiBold',
      fontSize: 12,
      lineHeight: 18,
      color: boardMuted,
    },

    mediaCard: {
      height: 300,
      borderRadius: 14,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    exerciseImage: { width: '100%', height: '100%' },
    mediaFallback: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
    mediaFallbackIcon: {
      width: 86,
      height: 86,
      borderRadius: 43,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.accentSoft,
    },
    mediaFallbackText: {
      fontFamily: 'Manrope_600SemiBold',
      fontSize: 16,
      color: colors.textSecondary,
    },
    mediaPositionBadge: {
      position: 'absolute',
      top: 12,
      right: 12,
      minWidth: 48,
      minHeight: 30,
      borderRadius: 15,
      paddingHorizontal: 10,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.secondaryAccent,
    },
    mediaPositionText: {
      fontFamily: 'Manrope_800ExtraBold',
      fontSize: 11,
      color: '#FFFFFF',
    },

    exercisePanel: {
      padding: 18,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    exerciseName: {
      fontFamily: 'Manrope_800ExtraBold',
      fontSize: 27,
      lineHeight: 32,
      color: colors.text,
    },
    exercisePrescription: {
      marginTop: 6,
      fontFamily: 'Manrope_700Bold',
      fontSize: 17,
      color: colors.accent,
    },
    cueRow: {
      marginTop: 14,
      paddingTop: 12,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 9,
    },
    cueDot: {
      width: 8,
      height: 8,
      marginTop: 6,
      borderRadius: 4,
      backgroundColor: colors.secondaryAccent,
    },
    cueText: {
      flex: 1,
      fontFamily: 'Manrope_500Medium',
      fontSize: 13,
      lineHeight: 19,
      color: colors.textSecondary,
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
    detailsLabelSpaced: { marginTop: 14 },
    detailsText: {
      marginTop: 5,
      fontFamily: 'Manrope_400Regular',
      fontSize: 13,
      lineHeight: 21,
      color: colors.textSecondary,
    },
    instructionsButton: {
      alignSelf: 'flex-start',
      minHeight: 40,
      marginTop: 14,
      paddingHorizontal: 12,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.border,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 7,
      backgroundColor: colors.background,
    },
    instructionsButtonText: {
      fontFamily: 'Manrope_700Bold',
      fontSize: 11,
      color: colors.text,
    },

    actionStrip: { flexDirection: 'row', gap: 10 },
    actionButton: {
      flex: 1,
      minHeight: 52,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.borderStrong,
      backgroundColor: colors.surface,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
    },
    rejectButton: { borderColor: colors.secondaryAccent },
    actionButtonText: {
      fontFamily: 'Manrope_700Bold',
      fontSize: 12,
      color: colors.text,
    },
    actionDisabled: { opacity: 0.34 },
    exerciseNav: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
    },
    navButton: {
      width: 46,
      height: 46,
      borderRadius: 23,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    navDots: { flex: 1, flexDirection: 'row', justifyContent: 'center', gap: 7 },
    navDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.borderStrong },
    navDotActive: { width: 28, backgroundColor: colors.secondaryAccent },
    primaryButtonLarge: {
      minHeight: 58,
      borderRadius: 14,
      paddingHorizontal: 18,
      backgroundColor: colors.accent,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
    },
    primaryButtonTextLarge: {
      fontFamily: 'Manrope_800ExtraBold',
      fontSize: 13,
      color: colors.textOnAccent,
    },

    tabataArena: {
      padding: 18,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      alignItems: 'center',
    },
    tabataPhasePill: {
      minHeight: 32,
      paddingHorizontal: 11,
      borderRadius: 16,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 7,
      backgroundColor: colors.background,
      borderWidth: 1,
      borderColor: colors.border,
    },
    tabataPhaseDot: { width: 8, height: 8, borderRadius: 4 },
    tabataPhaseText: {
      fontFamily: 'Manrope_800ExtraBold',
      fontSize: 10,
      letterSpacing: 0.8,
    },
    gaugeWrap: { marginTop: 15, alignItems: 'center', justifyContent: 'center' },
    gaugeRing: {
      width: 190,
      height: 190,
      borderRadius: 95,
      alignItems: 'center',
      justifyContent: 'center',
    },
    gaugeSegment: {
      position: 'absolute',
      left: 92,
      top: 89,
      width: 6,
      height: 16,
      borderRadius: 3,
    },
    gaugeCenter: {
      width: 130,
      height: 130,
      borderRadius: 65,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.background,
      borderWidth: 1,
      borderColor: colors.border,
    },
    gaugeValue: {
      fontFamily: 'BebasNeue_400Regular',
      fontSize: 68,
      lineHeight: 70,
      color: colors.text,
    },
    gaugeUnit: {
      marginTop: -5,
      fontFamily: 'Manrope_700Bold',
      fontSize: 9,
      letterSpacing: 1.2,
      color: colors.textMuted,
    },
    tabataRound: {
      marginTop: 3,
      fontFamily: 'Manrope_700Bold',
      fontSize: 12,
      color: colors.textSecondary,
    },
    tabataExercisePanel: {
      width: '100%',
      marginTop: 16,
      padding: 16,
      borderRadius: 12,
      backgroundColor: colors.background,
      borderWidth: 1,
      borderColor: colors.border,
    },
    tabataExerciseLabel: {
      fontFamily: 'Manrope_700Bold',
      fontSize: 9,
      letterSpacing: 0.8,
      color: colors.secondaryAccent,
    },
    tabataExerciseName: {
      marginTop: 4,
      fontFamily: 'Manrope_800ExtraBold',
      fontSize: 23,
      lineHeight: 28,
      color: colors.text,
    },
    tabataExercisePrescription: {
      marginTop: 4,
      fontFamily: 'Manrope_700Bold',
      fontSize: 13,
      color: colors.accent,
    },
    tabataCue: {
      marginTop: 9,
      fontFamily: 'Manrope_500Medium',
      fontSize: 12,
      lineHeight: 18,
      color: colors.textSecondary,
    },
    tabataNavRow: { width: '100%', marginTop: 12, flexDirection: 'row', gap: 10 },
    tabataNavButton: {
      flex: 1,
      minHeight: 44,
      borderRadius: 11,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.background,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
    },
    tabataNavText: {
      fontFamily: 'Manrope_700Bold',
      fontSize: 11,
      color: colors.text,
    },
    pauseButton: {
      width: '100%',
      minHeight: 54,
      marginTop: 14,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.borderStrong,
      backgroundColor: colors.background,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
    },
    pauseButtonText: {
      fontFamily: 'Manrope_800ExtraBold',
      fontSize: 12,
      color: colors.text,
    },
    stopTabataButton: {
      minHeight: 42,
      marginTop: 8,
      paddingHorizontal: 12,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 7,
    },
    stopTabataText: {
      fontFamily: 'Manrope_700Bold',
      fontSize: 11,
      color: colors.secondaryAccent,
    },

    secretCard: {
      padding: 18,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    orangeTag: {
      alignSelf: 'flex-start',
      minHeight: 30,
      paddingHorizontal: 10,
      borderRadius: 15,
      backgroundColor: colors.secondaryAccent,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    orangeTagText: {
      fontFamily: 'Manrope_800ExtraBold',
      fontSize: 9,
      letterSpacing: 0.7,
      color: '#FFFFFF',
    },
    secretTitle: {
      marginTop: 13,
      fontFamily: 'Manrope_800ExtraBold',
      fontSize: 25,
      color: colors.text,
    },
    secretText: {
      marginTop: 6,
      fontFamily: 'Manrope_400Regular',
      fontSize: 13,
      lineHeight: 20,
      color: colors.textSecondary,
    },
    formatRow: {
      marginTop: 16,
      paddingTop: 14,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    formatRowStandalone: {
      marginBottom: 12,
      padding: 14,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
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
      fontSize: 16,
      color: colors.text,
    },
    smallActionButton: {
      minHeight: 40,
      paddingHorizontal: 11,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.border,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: colors.background,
    },
    smallActionText: {
      fontFamily: 'Manrope_700Bold',
      fontSize: 10,
      color: colors.accent,
    },
    wodWrap: { gap: 12 },

    confirmOverlay: { flex: 1, justifyContent: 'center', paddingHorizontal: 24 },
    confirmBackdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: 'rgba(0,0,0,0.58)',
    },
    confirmCard: {
      borderRadius: 18,
      padding: 20,
      backgroundColor: colors.surfaceElevated,
      borderWidth: 1,
      borderColor: colors.borderStrong,
    },
    confirmEyebrow: {
      fontFamily: 'Manrope_800ExtraBold',
      fontSize: 9,
      letterSpacing: 0.8,
      color: colors.secondaryAccent,
    },
    confirmTitle: {
      marginTop: 5,
      fontFamily: 'Manrope_800ExtraBold',
      fontSize: 22,
      lineHeight: 28,
      color: colors.text,
    },
    confirmText: {
      marginTop: 7,
      fontFamily: 'Manrope_400Regular',
      fontSize: 13,
      lineHeight: 20,
      color: colors.textSecondary,
    },
    confirmActions: { marginTop: 18, flexDirection: 'row', gap: 10 },
    confirmCancel: {
      flex: 1,
      minHeight: 48,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: colors.border,
    },
    confirmCancelText: {
      fontFamily: 'Manrope_700Bold',
      fontSize: 11,
      color: colors.text,
    },
    confirmStop: {
      flex: 1,
      minHeight: 48,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.secondaryAccent,
    },
    confirmStopText: {
      fontFamily: 'Manrope_800ExtraBold',
      fontSize: 11,
      color: '#FFFFFF',
    },

    modalRoot: { flex: 1, justifyContent: 'flex-end' },
    backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.60)' },
    sheet: {
      maxHeight: '82%',
      paddingHorizontal: spacing.lg,
      paddingTop: 10,
      paddingBottom: 28,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      backgroundColor: colors.background,
      borderWidth: 1,
      borderColor: colors.border,
    },
    sheetHandle: {
      alignSelf: 'center',
      width: 42,
      height: 4,
      borderRadius: 2,
      marginBottom: 15,
      backgroundColor: colors.borderStrong,
    },
    sheetHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
    sheetHeaderCopy: { flex: 1 },
    sheetEyebrow: {
      fontFamily: 'Manrope_700Bold',
      fontSize: 10,
      color: colors.secondaryAccent,
    },
    sheetTitle: {
      marginTop: 3,
      fontFamily: 'Manrope_800ExtraBold',
      fontSize: 23,
      lineHeight: 28,
      color: colors.text,
    },
    sheetBody: {
      marginTop: 7,
      fontFamily: 'Manrope_400Regular',
      fontSize: 13,
      lineHeight: 20,
      color: colors.textSecondary,
    },
    sheetClose: {
      width: 40,
      height: 40,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surface,
    },
    sheetLoader: { marginTop: 18 },
    modalError: {
      marginTop: 12,
      fontFamily: 'Manrope_600SemiBold',
      fontSize: 12,
      color: colors.secondaryAccent,
    },
    modalOption: {
      minHeight: 54,
      marginTop: 10,
      paddingHorizontal: 13,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    modalOptionCopy: { flex: 1 },
    modalOptionText: {
      flex: 1,
      fontFamily: 'Manrope_700Bold',
      fontSize: 12,
      color: colors.text,
    },
    modalOptionMeta: {
      marginTop: 2,
      fontFamily: 'Manrope_500Medium',
      fontSize: 10,
      color: colors.accent,
    },
    scoreInputRow: {
      marginTop: 16,
      minHeight: 58,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.borderStrong,
      backgroundColor: colors.surface,
      paddingHorizontal: 14,
      flexDirection: 'row',
      alignItems: 'center',
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

    emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 },
    emptyTitle: {
      fontFamily: 'Manrope_800ExtraBold',
      fontSize: 22,
      color: colors.text,
    },
    emptyText: {
      marginTop: 6,
      fontFamily: 'Manrope_400Regular',
      fontSize: 13,
      color: colors.textSecondary,
      textAlign: 'center',
    },
    bottomSpace: { height: 24 },
  });
}
