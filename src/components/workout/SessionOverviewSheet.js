import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { useUgerodTheme } from '../../contexts/UgerodThemeContext';
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

const BLOCK_LABELS = {
  unlock: 'Unlock',
  tabata: 'Tabata',
  warmup: 'Warm-up',
  warm_up: 'Warm-up',
  skill: 'Skill',
  strength: 'Musculation',
  gym: 'Gym',
  street_gym: 'Street gym',
  cardio: 'Cardio',
  conditioning: 'Conditioning',
  wod: 'WOD',
};

function normalizeBlockKey(value) {
  const key = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s/-]+/g, '_');

  return key === 'warm_up' ? 'warmup' : key;
}

function exerciseStatus(exercise) {
  if (exercise?.userExecutionStatus) return exercise.userExecutionStatus;
  if (exercise?.status === 'completed') return 'completed';
  if (exercise?.status === 'adapted') return 'adapted';
  if (exercise?.status === 'not_completed' || exercise?.status === 'skipped') {
    return 'not_completed';
  }
  return 'pending';
}

function rawBlocksFromWorkout(workout) {
  if (Array.isArray(workout?.rawBlocks) && workout.rawBlocks.length > 0) {
    return workout.rawBlocks;
  }

  if (Array.isArray(workout?.blocks)) {
    return workout.blocks;
  }

  if (workout?.blocks && typeof workout.blocks === 'object') {
    return Object.entries(workout.blocks).map(([key, block]) => ({
      ...(block ?? {}),
      block_key: block?.block_key ?? block?.blockKey ?? key,
    }));
  }

  return [];
}

function readBlockTitle(block, key) {
  return (
    block?.label_fr ??
    block?.label ??
    block?.title ??
    block?.block_name ??
    BLOCK_LABELS[key] ??
    key
  );
}

function readBlockDuration(block) {
  const value = Number(
    block?.duration_minutes ??
      block?.durationMinutes ??
      block?.duration
  );

  return Number.isFinite(value) && value > 0 ? value : null;
}

function environmentCodeFromWorkout(workout) {
  return String(
    workout?.meta?.environment_code ??
      workout?.meta?.environmentCode ??
      workout?.preparationSnapshot?.environmentCode ??
      ''
  )
    .trim()
    .toUpperCase();
}

function buildOverviewBlocks(workout) {
  const exercises = Array.isArray(workout?.exercises) ? workout.exercises : [];
  const rawBlocks = rawBlocksFromWorkout(workout);
  const seen = new Set();

  const blocks = rawBlocks
    .map((source, index) => {
      const key = normalizeBlockKey(
        source?.block_key ?? source?.blockKey ?? source?.key ?? source?.id
      );

      if (!key || seen.has(key)) return null;
      seen.add(key);

      const rows = exercises.filter(
        (exercise) =>
          normalizeBlockKey(exercise?.blockKey ?? exercise?.block) === key
      );

      if (rows.length === 0 && key !== 'wod') return null;

      const statuses = rows.map(exerciseStatus);
      const done = rows.length > 0 && statuses.every((status) => status !== 'pending');
      const pending = statuses.some((status) => status === 'pending');

      return {
        key,
        source,
        index,
        title: readBlockTitle(source, key),
        duration: readBlockDuration(source),
        exercises: rows,
        done,
        pending,
      };
    })
    .filter(Boolean);

  if (blocks.length === 0 && exercises.length > 0) {
    const grouped = [];
    const keys = [];

    for (const exercise of exercises) {
      const key = normalizeBlockKey(exercise?.blockKey ?? exercise?.block);
      if (key && !keys.includes(key)) keys.push(key);
    }

    keys.forEach((key, index) => {
      const rows = exercises.filter(
        (exercise) =>
          normalizeBlockKey(exercise?.blockKey ?? exercise?.block) === key
      );
      const statuses = rows.map(exerciseStatus);
      grouped.push({
        key,
        source: null,
        index,
        title: BLOCK_LABELS[key] ?? key,
        duration: null,
        exercises: rows,
        done: statuses.every((status) => status !== 'pending'),
        pending: statuses.some((status) => status === 'pending'),
      });
    });

    return grouped;
  }

  return blocks;
}

function anySwapDirection(item) {
  return Boolean(
    item?.directions?.equivalent?.available ||
      item?.directions?.easier?.available ||
      item?.directions?.harder?.available
  );
}

export default function SessionOverviewSheet({
  visible,
  onClose,
  onPlanB,
  showPlanB = false,
}) {
  const { colors, isDark } = useUgerodTheme();
  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);
  const {
    workout,
    setGeneratedWorkoutPreservingProgress,
  } = useWorkout();

  const [availability, setAvailability] = useState({});
  const [loadingAvailability, setLoadingAvailability] = useState(false);
  const [swapExercise, setSwapExercise] = useState(null);
  const [swapBusy, setSwapBusy] = useState(false);
  const [swapError, setSwapError] = useState('');

  const blocks = useMemo(() => buildOverviewBlocks(workout), [workout]);
  const activeBlock = blocks.find((block) => block.pending) ?? null;
  const environmentCode = environmentCodeFromWorkout(workout);
  const plannedDuration =
    Number(workout?.plannedDuration ?? workout?.preparationSnapshot?.durationMinutes) || null;

  const wodRevealed = Boolean(
    workout?.wodRevealed ||
      workout?.wodRevealedAt ||
      workout?.wodStarted ||
      workout?.wodStartedAt ||
      workout?.wodRuntime?.started ||
      activeBlock?.key === 'wod'
  );

  const refreshAvailability = useCallback(async () => {
    if (!visible || !workout?.sessionId) {
      setAvailability({});
      return;
    }

    try {
      setLoadingAvailability(true);
      const result = await getWorkoutSwapAvailability(workout.sessionId);
      setAvailability(result?.items ?? {});
    } catch (error) {
      console.warn('Session overview swap availability', error);
      setAvailability({});
    } finally {
      setLoadingAvailability(false);
    }
  }, [visible, workout?.sessionId]);

  useEffect(() => {
    refreshAvailability();
  }, [refreshAvailability]);

  useEffect(() => {
    if (!visible) {
      setSwapExercise(null);
      setSwapError('');
    }
  }, [visible]);

  async function applySwap(reason) {
    if (!swapExercise?.sessionExerciseId || !workout?.sessionId || swapBusy) return;

    const oldExerciseId = swapExercise.exerciseId ?? swapExercise.id;
    const block = blocks.find((item) =>
      item.exercises.some(
        (exercise) => exercise.sessionExerciseId === swapExercise.sessionExerciseId
      )
    );

    try {
      setSwapBusy(true);
      setSwapError('');

      const result = await adaptSessionExercise({
        sessionId: workout.sessionId,
        sessionExerciseId: swapExercise.sessionExerciseId,
        currentExerciseId: oldExerciseId,
        reason,
      });

      const manualEnvironmentBlock =
        ['GYM', 'OUTDOOR'].includes(environmentCode) &&
        (Boolean(block?.source?.builder_block_id) || block?.source?.manual_selection === true);

      if (manualEnvironmentBlock) {
        await syncEnvironmentBuilderSwapRuntime({
          sessionExerciseId: swapExercise.sessionExerciseId,
          oldExerciseId,
          substitute: result?.substitute ?? {},
        });
      }

      const refreshed = await reloadWorkoutSession({
        sessionId: workout.sessionId,
        preparationSnapshot: workout.preparationSnapshot ?? null,
      });

      const nextWorkout = ['GYM', 'OUTDOOR'].includes(environmentCode)
        ? await hydrateEnvironmentSessionExerciseIds(refreshed)
        : refreshed;

      setGeneratedWorkoutPreservingProgress(nextWorkout);
      setSwapExercise(null);
      await refreshAvailability();
    } catch (error) {
      setSwapError(
        error?.message ?? 'Aucune alternative sûre n’a été trouvée pour cet exercice.'
      );
    } finally {
      setSwapBusy(false);
    }
  }

  const selectedAvailability = swapExercise?.sessionExerciseId
    ? availability?.[swapExercise.sessionExerciseId] ?? null
    : null;

  return (
    <>
      <Modal
        visible={visible}
        animationType="slide"
        onRequestClose={onClose}
      >
        <SafeAreaView style={styles.screen}>
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <Text style={styles.eyebrow}>TA SÉANCE DU JOUR</Text>
              <Text style={styles.title}>Voici ta séance.</Text>
              <Text style={styles.subtitle}>
                {plannedDuration ? `${plannedDuration} min · ` : ''}
                {environmentCode === 'HOME'
                  ? 'Maison'
                  : environmentCode === 'BOX'
                    ? 'Box'
                    : environmentCode === 'GYM'
                      ? 'Salle'
                      : environmentCode === 'OUTDOOR'
                        ? 'Extérieur'
                        : 'UGEROD'}
              </Text>
            </View>

            <Pressable onPress={onClose} hitSlop={10} style={styles.closeButton}>
              <Ionicons name="close" size={22} color={colors.text} />
            </Pressable>
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
          >
            {blocks.map((block, blockIndex) => {
              const maskedWod = block.key === 'wod' && !wodRevealed;
              const active = activeBlock?.key === block.key;

              return (
                <View
                  key={`${block.key}:${blockIndex}`}
                  style={[
                    styles.block,
                    active && styles.blockActive,
                    block.done && styles.blockDone,
                  ]}
                >
                  <View style={styles.blockHeader}>
                    <View
                      style={[
                        styles.statusIcon,
                        active && styles.statusIconActive,
                        block.done && styles.statusIconDone,
                      ]}
                    >
                      {block.done ? (
                        <Ionicons name="checkmark" size={15} color={colors.textOnAccent} />
                      ) : maskedWod ? (
                        <Ionicons name="lock-closed" size={14} color={colors.textMuted} />
                      ) : active ? (
                        <Ionicons name="play" size={13} color={colors.textOnAccent} />
                      ) : (
                        <Text style={styles.statusNumber}>{blockIndex + 1}</Text>
                      )}
                    </View>

                    <View style={styles.blockHeaderCopy}>
                      <View style={styles.blockTitleRow}>
                        <Text style={styles.blockTitle}>{block.title}</Text>
                        {block.duration ? (
                          <Text style={styles.blockDuration}>{block.duration} min</Text>
                        ) : null}
                      </View>
                      <Text style={styles.blockState}>
                        {block.done
                          ? 'Terminé'
                          : active
                            ? 'En cours'
                            : maskedWod
                              ? 'Contenu masqué'
                              : 'À venir'}
                      </Text>
                    </View>
                  </View>

                  {maskedWod ? (
                    <View style={styles.maskedWod}>
                      <Ionicons name="eye-off-outline" size={18} color={colors.textMuted} />
                      <Text style={styles.maskedWodText}>
                        Le WOD reste secret. Son contenu apparaîtra quand tu arriveras à ce bloc.
                      </Text>
                    </View>
                  ) : (
                    <View style={styles.exerciseList}>
                      {block.exercises.map((exercise, exerciseIndex) => {
                        const status = exerciseStatus(exercise);
                        const pending = status === 'pending';
                        const item = exercise.sessionExerciseId
                          ? availability?.[exercise.sessionExerciseId] ?? null
                          : null;
                        const canSwap =
                          pending &&
                          Boolean(exercise.sessionExerciseId) &&
                          anySwapDirection(item);

                        return (
                          <View
                            key={
                              exercise.sessionExerciseId ??
                              `${block.key}:${exercise.id ?? exerciseIndex}:${exerciseIndex}`
                            }
                            style={styles.exerciseRow}
                          >
                            <View style={styles.exerciseCopy}>
                              <Text style={styles.exerciseName}>
                                {exercise.name ?? 'Exercice'}
                              </Text>
                              {exercise.prescription ? (
                                <Text style={styles.exercisePrescription}>
                                  {exercise.prescription}
                                </Text>
                              ) : null}
                            </View>

                            {status !== 'pending' ? (
                              <View style={styles.donePill}>
                                <Ionicons
                                  name={status === 'not_completed' ? 'close' : 'checkmark'}
                                  size={13}
                                  color={colors.textMuted}
                                />
                              </View>
                            ) : (
                              <Pressable
                                disabled={!canSwap || loadingAvailability}
                                onPress={() => {
                                  setSwapError('');
                                  setSwapExercise(exercise);
                                }}
                                style={({ pressed }) => [
                                  styles.swapButton,
                                  (!canSwap || loadingAvailability) && styles.swapButtonDisabled,
                                  pressed && canSwap && styles.pressed,
                                ]}
                              >
                                {loadingAvailability ? (
                                  <ActivityIndicator size="small" color={colors.accent} />
                                ) : (
                                  <Ionicons
                                    name="swap-horizontal-outline"
                                    size={17}
                                    color={canSwap ? colors.accent : colors.textDisabled}
                                  />
                                )}
                                <Text
                                  style={[
                                    styles.swapText,
                                    !canSwap && styles.swapTextDisabled,
                                  ]}
                                >
                                  Swap
                                </Text>
                              </Pressable>
                            )}
                          </View>
                        );
                      })}
                    </View>
                  )}
                </View>
              );
            })}

            {showPlanB ? (
              <Pressable
                onPress={() => {
                  onClose?.();
                  onPlanB?.();
                }}
                style={({ pressed }) => [styles.planBButton, pressed && styles.pressed]}
              >
                <Ionicons name="shuffle-outline" size={18} color={colors.text} />
                <Text style={styles.planBText}>Plan B</Text>
                <Text style={styles.planBHint}>Une autre proposition avant de commencer</Text>
              </Pressable>
            ) : null}
          </ScrollView>

          <View style={styles.footer}>
            <Pressable
              onPress={onClose}
              style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
            >
              <Text style={styles.primaryButtonText}>
                {workout?.sessionStarted ? 'RETOURNER À MA SÉANCE' : 'COMMENCER MA SÉANCE'}
              </Text>
              <Ionicons name="arrow-forward" size={19} color={colors.textOnAccent} />
            </Pressable>
          </View>
        </SafeAreaView>
      </Modal>

      <Modal
        visible={Boolean(swapExercise)}
        transparent
        animationType="slide"
        onRequestClose={() => !swapBusy && setSwapExercise(null)}
      >
        <SafeAreaView style={styles.swapModalRoot}>
          <Pressable
            style={styles.backdrop}
            disabled={swapBusy}
            onPress={() => setSwapExercise(null)}
          />

          <View style={styles.swapSheet}>
            <View style={styles.handle} />
            <View style={styles.swapHeader}>
              <View style={styles.swapHeaderCopy}>
                <Text style={styles.swapEyebrow}>ADAPTER L’EXERCICE</Text>
                <Text style={styles.swapTitle}>{swapExercise?.name ?? 'Exercice'}</Text>
              </View>
              <Pressable
                onPress={() => setSwapExercise(null)}
                disabled={swapBusy}
                style={styles.closeButton}
              >
                <Ionicons name="close" size={21} color={colors.text} />
              </Pressable>
            </View>

            {swapError ? <Text style={styles.swapError}>{swapError}</Text> : null}

            {[
              {
                key: 'equivalent',
                reason: 'equivalent',
                label: 'Un équivalent',
                description: 'Même intention, autre mouvement.',
                icon: 'swap-horizontal-outline',
              },
              {
                key: 'easier',
                reason: 'too_hard',
                label: 'Plus facile',
                description: 'Une variante plus accessible.',
                icon: 'arrow-down-circle-outline',
              },
              {
                key: 'harder',
                reason: 'too_easy',
                label: 'Plus difficile',
                description: 'Une progression plus exigeante.',
                icon: 'arrow-up-circle-outline',
              },
            ].map((option) => {
              const available =
                selectedAvailability?.directions?.[option.key]?.available === true;

              return (
                <Pressable
                  key={option.key}
                  disabled={!available || swapBusy}
                  onPress={() => applySwap(option.reason)}
                  style={({ pressed }) => [
                    styles.swapOption,
                    !available && styles.swapOptionDisabled,
                    pressed && available && !swapBusy && styles.pressed,
                  ]}
                >
                  <View style={styles.swapOptionIcon}>
                    <Ionicons
                      name={option.icon}
                      size={19}
                      color={available ? colors.accent : colors.textDisabled}
                    />
                  </View>
                  <View style={styles.swapOptionCopy}>
                    <Text
                      style={[
                        styles.swapOptionTitle,
                        !available && styles.swapOptionTitleDisabled,
                      ]}
                    >
                      {option.label}
                    </Text>
                    <Text style={styles.swapOptionBody}>
                      {available ? option.description : 'Aucune option sûre disponible.'}
                    </Text>
                  </View>
                  {swapBusy ? (
                    <ActivityIndicator size="small" color={colors.accent} />
                  ) : (
                    <Ionicons
                      name="chevron-forward"
                      size={18}
                      color={available ? colors.accent : colors.textDisabled}
                    />
                  )}
                </Pressable>
              );
            })}
          </View>
        </SafeAreaView>
      </Modal>
    </>
  );
}

function createStyles(colors, isDark) {
  return StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: colors.background,
    },
    header: {
      minHeight: 92,
      paddingHorizontal: 20,
      paddingTop: 10,
      paddingBottom: 14,
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 14,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    headerCopy: { flex: 1 },
    eyebrow: {
      fontFamily: 'Manrope_700Bold',
      fontSize: 10,
      letterSpacing: 1.05,
      color: colors.accent,
    },
    title: {
      marginTop: 4,
      fontFamily: 'Manrope_800ExtraBold',
      fontSize: 30,
      lineHeight: 36,
      letterSpacing: -0.7,
      color: colors.text,
    },
    subtitle: {
      marginTop: 4,
      fontFamily: 'Manrope_500Medium',
      fontSize: 13,
      lineHeight: 18,
      color: colors.textSecondary,
    },
    closeButton: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    scroll: { flex: 1 },
    content: {
      paddingHorizontal: 16,
      paddingTop: 14,
      paddingBottom: 18,
      gap: 10,
    },
    block: {
      borderRadius: 18,
      padding: 14,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    blockActive: {
      borderColor: colors.accent,
      backgroundColor: colors.accentSoft,
    },
    blockDone: {
      opacity: 0.76,
    },
    blockHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 11,
    },
    statusIcon: {
      width: 30,
      height: 30,
      borderRadius: 15,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.background,
      borderWidth: 1,
      borderColor: colors.border,
    },
    statusIconActive: {
      backgroundColor: colors.accent,
      borderColor: colors.accent,
    },
    statusIconDone: {
      backgroundColor: colors.success,
      borderColor: colors.success,
    },
    statusNumber: {
      fontFamily: 'Manrope_700Bold',
      fontSize: 11,
      color: colors.textMuted,
    },
    blockHeaderCopy: { flex: 1 },
    blockTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 10,
    },
    blockTitle: {
      flex: 1,
      fontFamily: 'Manrope_700Bold',
      fontSize: 17,
      lineHeight: 22,
      color: colors.text,
    },
    blockDuration: {
      fontFamily: 'Manrope_600SemiBold',
      fontSize: 12,
      color: colors.textMuted,
    },
    blockState: {
      marginTop: 2,
      fontFamily: 'Manrope_500Medium',
      fontSize: 11,
      color: colors.textSecondary,
    },
    maskedWod: {
      marginTop: 12,
      paddingTop: 12,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 9,
    },
    maskedWodText: {
      flex: 1,
      fontFamily: 'Manrope_500Medium',
      fontSize: 12,
      lineHeight: 18,
      color: colors.textMuted,
    },
    exerciseList: {
      marginTop: 10,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    exerciseRow: {
      minHeight: 58,
      paddingVertical: 10,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    exerciseCopy: { flex: 1 },
    exerciseName: {
      fontFamily: 'Manrope_700Bold',
      fontSize: 14,
      lineHeight: 19,
      color: colors.text,
    },
    exercisePrescription: {
      marginTop: 2,
      fontFamily: 'Manrope_500Medium',
      fontSize: 11,
      lineHeight: 16,
      color: colors.textSecondary,
    },
    swapButton: {
      minHeight: 34,
      paddingHorizontal: 10,
      borderRadius: 10,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      backgroundColor: colors.background,
      borderWidth: 1,
      borderColor: colors.borderStrong,
    },
    swapButtonDisabled: { opacity: 0.42 },
    swapText: {
      fontFamily: 'Manrope_700Bold',
      fontSize: 11,
      color: colors.accent,
    },
    swapTextDisabled: { color: colors.textDisabled },
    donePill: {
      width: 30,
      height: 30,
      borderRadius: 15,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.background,
      borderWidth: 1,
      borderColor: colors.border,
    },
    planBButton: {
      minHeight: 58,
      paddingHorizontal: 14,
      borderRadius: 16,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 9,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    planBText: {
      fontFamily: 'Manrope_700Bold',
      fontSize: 14,
      color: colors.text,
    },
    planBHint: {
      flex: 1,
      textAlign: 'right',
      fontFamily: 'Manrope_500Medium',
      fontSize: 10,
      lineHeight: 14,
      color: colors.textMuted,
    },
    footer: {
      paddingHorizontal: 16,
      paddingTop: 10,
      paddingBottom: 12,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      backgroundColor: isDark ? colors.background : colors.surfaceElevated,
    },
    primaryButton: {
      minHeight: 54,
      borderRadius: 15,
      paddingHorizontal: 18,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      backgroundColor: colors.accent,
    },
    primaryButtonText: {
      fontFamily: 'Manrope_700Bold',
      fontSize: 13,
      letterSpacing: 0.2,
      color: colors.textOnAccent,
    },
    swapModalRoot: {
      flex: 1,
      justifyContent: 'flex-end',
    },
    backdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: 'rgba(0,0,0,0.62)',
    },
    swapSheet: {
      paddingHorizontal: 16,
      paddingTop: 9,
      paddingBottom: 24,
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
      backgroundColor: colors.borderStrong,
      marginBottom: 14,
    },
    swapHeader: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 12,
    },
    swapHeaderCopy: { flex: 1 },
    swapEyebrow: {
      fontFamily: 'Manrope_700Bold',
      fontSize: 9,
      letterSpacing: 0.9,
      color: colors.accent,
    },
    swapTitle: {
      marginTop: 3,
      fontFamily: 'Manrope_800ExtraBold',
      fontSize: 22,
      lineHeight: 28,
      color: colors.text,
    },
    swapError: {
      marginTop: 12,
      padding: 10,
      borderRadius: 10,
      backgroundColor: colors.errorSoft,
      fontFamily: 'Manrope_600SemiBold',
      fontSize: 11,
      lineHeight: 16,
      color: colors.error,
    },
    swapOption: {
      minHeight: 68,
      marginTop: 10,
      paddingHorizontal: 13,
      paddingVertical: 10,
      borderRadius: 15,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    swapOptionDisabled: { opacity: 0.48 },
    swapOptionIcon: {
      width: 36,
      height: 36,
      borderRadius: 11,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.background,
    },
    swapOptionCopy: { flex: 1 },
    swapOptionTitle: {
      fontFamily: 'Manrope_700Bold',
      fontSize: 13,
      color: colors.text,
    },
    swapOptionTitleDisabled: { color: colors.textDisabled },
    swapOptionBody: {
      marginTop: 2,
      fontFamily: 'Manrope_500Medium',
      fontSize: 10,
      lineHeight: 15,
      color: colors.textMuted,
    },
    pressed: { opacity: 0.72 },
  });
}
