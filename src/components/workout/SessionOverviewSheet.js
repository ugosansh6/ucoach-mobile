import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
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

const LABELS = {
  unlock: 'Unlock',
  tabata: 'Tabata',
  warmup: 'Warm-up',
  skill: 'Skill',
  strength: 'Musculation',
  gym: 'Gym',
  street_gym: 'Street gym',
  cardio: 'Cardio',
  conditioning: 'Conditioning',
  wod: 'WOD',
};

function normalizeBlock(value) {
  const key = String(value ?? '').trim().toLowerCase().replace(/[\s/-]+/g, '_');
  return key === 'warm_up' ? 'warmup' : key;
}

function normalizeText(value) {
  if (value == null) return '';
  return String(value)
    .replace(/\\r\\n|\\n|\\r/g, '\n')
    .replace(/\r\n?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}


const PRESCRIPTION_METRIC_PATTERN = /(\d+(?:[.,]\d+)?(?:\s*[-–]\s*\d+(?:[.,]\d+)?)?(?:\s*[x×]\s*\d+(?:[.,]\d+)?)?\s*(?:reps?|rép(?:s|étitions)?|secondes?|secs?|sec|s|minutes?|mins?|min|tours?|rounds?|séries?|series|sets?|mètres?|metres?|km|kg|%|rpe|rir|m))/gi;
const PRESCRIPTION_METRIC_FULL = /^\d+(?:[.,]\d+)?(?:\s*[-–]\s*\d+(?:[.,]\d+)?)?(?:\s*[x×]\s*\d+(?:[.,]\d+)?)?\s*(?:reps?|rép(?:s|étitions)?|secondes?|secs?|sec|s|minutes?|mins?|min|tours?|rounds?|séries?|series|sets?|mètres?|metres?|km|kg|%|rpe|rir|m)$/i;

function prescriptionParts(value) {
  const normalized = normalizeText(value);
  if (!normalized) return [];
  return normalized.split(PRESCRIPTION_METRIC_PATTERN).filter(Boolean);
}

function isPrescriptionMetric(value) {
  return PRESCRIPTION_METRIC_FULL.test(String(value ?? '').trim());
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

function exerciseStatus(exercise) {
  if (exercise?.userExecutionStatus) return exercise.userExecutionStatus;
  if (exercise?.status === 'completed') return 'completed';
  if (exercise?.status === 'adapted') return 'adapted';
  if (exercise?.status === 'not_completed' || exercise?.status === 'skipped') return 'not_completed';
  return 'pending';
}

function rawBlocks(workout) {
  if (Array.isArray(workout?.rawBlocks) && workout.rawBlocks.length > 0) return workout.rawBlocks;
  if (Array.isArray(workout?.blocks)) return workout.blocks;
  if (workout?.blocks && typeof workout.blocks === 'object') {
    return Object.entries(workout.blocks).map(([key, block]) => ({
      ...(block ?? {}),
      block_key: block?.block_key ?? block?.blockKey ?? key,
    }));
  }
  return [];
}

function readDuration(block) {
  const value = Number(block?.duration_minutes ?? block?.durationMinutes ?? block?.duration);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function environmentCode(workout) {
  return String(
    workout?.meta?.environment_code ??
      workout?.meta?.environmentCode ??
      workout?.preparationSnapshot?.environmentCode ??
      ''
  )
    .trim()
    .toUpperCase();
}

function environmentLabel(code) {
  if (code === 'HOME') return 'Maison';
  if (code === 'BOX') return 'Box';
  if (code === 'GYM') return 'Salle';
  if (code === 'OUTDOOR') return 'Extérieur';
  return 'UGEROD';
}

function buildBlocks(workout) {
  const exercises = Array.isArray(workout?.exercises) ? workout.exercises : [];
  const sources = rawBlocks(workout);
  const seen = new Set();
  const result = [];

  const sourceKeys = sources
    .map((source) => normalizeBlock(source?.block_key ?? source?.blockKey ?? source?.key ?? source?.id))
    .filter(Boolean);
  const exerciseKeys = exercises
    .map((exercise) => normalizeBlock(exercise?.blockKey ?? exercise?.block))
    .filter(Boolean);
  const orderedKeys = Array.from(new Set([...sourceKeys, ...exerciseKeys]));

  orderedKeys.forEach((key, index) => {
    if (!key || seen.has(key)) return;
    seen.add(key);
    const source = sources.find(
      (candidate) =>
        normalizeBlock(candidate?.block_key ?? candidate?.blockKey ?? candidate?.key ?? candidate?.id) === key
    );
    const rows = exercises.filter(
      (exercise) => normalizeBlock(exercise?.blockKey ?? exercise?.block) === key
    );
    if (rows.length === 0 && key !== 'wod') return;

    const statuses = rows.map(exerciseStatus);
    const done = rows.length > 0 && statuses.every((status) => status !== 'pending');
    const firstPendingIndex = statuses.findIndex((status) => status === 'pending');

    result.push({
      key,
      index,
      source,
      title: source?.label_fr ?? source?.label ?? source?.title ?? LABELS[key] ?? key,
      duration: readDuration(source),
      exercises: rows,
      done,
      firstPendingIndex,
    });
  });

  return result;
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
  const { workout, setGeneratedWorkoutPreservingProgress } = useWorkout();

  const blocks = useMemo(() => buildBlocks(workout), [workout]);
  const code = environmentCode(workout);
  const playerCursor = workout?.playerCursor ?? null;
  const cursorBlockKey = normalizeBlock(playerCursor?.blockId);
  const cursorBlockIndex = cursorBlockKey
    ? blocks.findIndex((block) => block.key === cursorBlockKey)
    : -1;
  const fallbackActiveBlockIndex = blocks.findIndex((block) => !block.done);
  const activeBlockIndex =
    cursorBlockIndex >= 0 && !blocks[cursorBlockIndex]?.done
      ? cursorBlockIndex
      : Math.max(0, fallbackActiveBlockIndex);
  const completedBlocks = blocks.filter((block) => block.done).length;
  const plannedDuration =
    Number(workout?.plannedDuration ?? workout?.preparationSnapshot?.durationMinutes ?? workout?.preparationSnapshot?.duration) || null;
  const progress = blocks.length > 0 ? completedBlocks / blocks.length : 0;
  const wodRevealed = Boolean(
    workout?.wodRevealed ||
      workout?.wodRevealedAt ||
      workout?.wodStarted ||
      workout?.wodStartedAt ||
      workout?.wodRuntime?.started ||
      blocks[activeBlockIndex]?.key === 'wod'
  );

  const [availability, setAvailability] = useState({});
  const [loadingAvailability, setLoadingAvailability] = useState(false);
  const [swapExercise, setSwapExercise] = useState(null);
  const [swapBusy, setSwapBusy] = useState(false);
  const [swapError, setSwapError] = useState('');
  const [detailExercise, setDetailExercise] = useState(null);

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
  }, [refreshAvailability, workout?.exercises]);

  useEffect(() => {
    if (!visible) {
      setSwapExercise(null);
      setSwapError('');
      setDetailExercise(null);
    }
  }, [visible]);

  async function applySwap(reason) {
    if (!swapExercise?.sessionExerciseId || !workout?.sessionId || swapBusy) return;

    const oldExerciseId = swapExercise.exerciseId ?? swapExercise.id;
    const block = blocks.find((item) =>
      item.exercises.some((exercise) => exercise.sessionExerciseId === swapExercise.sessionExerciseId)
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
        ['GYM', 'OUTDOOR'].includes(code) &&
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
      const nextWorkout = ['GYM', 'OUTDOOR'].includes(code)
        ? await hydrateEnvironmentSessionExerciseIds(refreshed)
        : refreshed;

      setGeneratedWorkoutPreservingProgress(nextWorkout);
      setSwapExercise(null);
      await refreshAvailability();
    } catch (error) {
      setSwapError(error?.message ?? 'Aucune alternative sûre n’a été trouvée.');
    } finally {
      setSwapBusy(false);
    }
  }

  const selectedAvailability = swapExercise?.sessionExerciseId
    ? availability?.[swapExercise.sessionExerciseId] ?? null
    : null;

  return (
    <>
      <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
        <SafeAreaView style={styles.screen}>
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <Text style={styles.eyebrow}>TA SÉANCE DU JOUR</Text>
              <Text style={styles.title}>Voici ta séance.</Text>
              <Text style={styles.subtitle}>
                {plannedDuration ? `${plannedDuration} min · ` : ''}{environmentLabel(code)}
              </Text>
            </View>
            <Pressable onPress={onClose} hitSlop={10} style={styles.closeButton}>
              <Ionicons name="close" size={22} color={colors.text} />
            </Pressable>
          </View>

          <View style={styles.progressMeta}>
            <Text style={styles.progressLabel}>{completedBlocks}/{blocks.length} blocs terminés</Text>
            <Text style={styles.progressPercent}>{Math.round(progress * 100)}%</Text>
          </View>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]} />
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.whiteboard}>
              {blocks.map((block, blockIndex) => {
                const active = blockIndex === activeBlockIndex && !block.done;
                const maskedWod = block.key === 'wod' && !wodRevealed;

                return (
                  <View key={`${block.key}:${blockIndex}`} style={[styles.block, blockIndex > 0 && styles.blockBorder]}>
                    <View style={styles.blockHeader}>
                      <View style={[styles.blockIndex, active && styles.blockIndexActive, block.done && styles.blockIndexDone]}>
                        {block.done ? (
                          <Ionicons name="checkmark" size={14} color={colors.textOnAccent} />
                        ) : (
                          <Text style={[styles.blockIndexText, active && styles.blockIndexTextActive]}>
                            {String(blockIndex + 1).padStart(2, '0')}
                          </Text>
                        )}
                      </View>

                      <View style={styles.blockHeaderCopy}>
                        <View style={styles.blockTitleRow}>
                          <Text style={[styles.blockTitle, active && styles.blockTitleActive]}>{block.title}</Text>
                          {block.duration ? <Text style={styles.blockDuration}>{block.duration} min</Text> : null}
                        </View>
                        <Text style={[styles.blockState, active && styles.blockStateActive]}>
                          {block.done ? 'Terminé' : active ? 'En cours' : maskedWod ? 'À découvrir' : 'À venir'}
                        </Text>
                      </View>
                    </View>

                    {maskedWod ? (
                      <View style={styles.maskedWod}>
                        <Ionicons name="lock-closed-outline" size={17} color={colors.secondaryAccent} />
                        <Text style={styles.maskedWodText}>Le contenu du WOD reste masqué jusqu’à son bloc.</Text>
                      </View>
                    ) : (
                      <View style={styles.exerciseList}>
                        {block.exercises.map((exercise, exerciseIndex) => {
                          const status = exerciseStatus(exercise);
                          const cursorExerciseMatches =
                            active &&
                            (playerCursor?.sessionExerciseId
                              ? exercise?.sessionExerciseId === playerCursor.sessionExerciseId
                              : Number.isFinite(Number(playerCursor?.exerciseIndex))
                                ? exerciseIndex === Number(playerCursor.exerciseIndex)
                                : false);
                          const current =
                            cursorExerciseMatches ||
                            (active && !playerCursor && exerciseIndex === block.firstPendingIndex);
                          const item = exercise.sessionExerciseId
                            ? availability?.[exercise.sessionExerciseId] ?? null
                            : null;
                          const canSwap =
                            status === 'pending' && Boolean(exercise.sessionExerciseId) && anySwapDirection(item);

                          return (
                            <View
                              key={exercise.sessionExerciseId ?? `${block.key}:${exercise.id ?? exerciseIndex}:${exerciseIndex}`}
                              style={[styles.exerciseRow, current && styles.exerciseRowCurrent]}
                            >
                              <View style={styles.exerciseMarker}>
                                {status === 'completed' ? (
                                  <Ionicons name="checkmark-circle" size={17} color={colors.accent} />
                                ) : status === 'not_completed' ? (
                                  <Ionicons name="close-circle" size={17} color={colors.secondaryAccent} />
                                ) : current ? (
                                  <View style={styles.currentDot} />
                                ) : (
                                  <View style={styles.futureDot} />
                                )}
                              </View>

                              <View style={styles.exerciseCopy}>
                                <View style={styles.exerciseTitleRow}>
                                  <Text style={[styles.exerciseName, current && styles.exerciseNameCurrent]}>
                                    {exercise.name ?? 'Exercice'}
                                  </Text>
                                  <Pressable
                                    onPress={() =>
                                      setDetailExercise({
                                        exercise,
                                        blockTitle: block.title,
                                        canSwap,
                                      })
                                    }
                                    hitSlop={6}
                                    accessibilityRole="button"
                                    accessibilityLabel={`Détails de ${exercise.name ?? 'l’exercice'}`}
                                    style={({ pressed }) => [styles.moreButton, pressed && styles.pressed]}
                                  >
                                    <Ionicons name="ellipsis-horizontal" size={18} color={colors.text} />
                                  </Pressable>
                                </View>
                                {exercise.prescription ? (
                                  <PrescriptionLine text={exercise.prescription} styles={styles} />
                                ) : null}
                              </View>
                            </View>
                          );
                        })}
                      </View>
                    )}
                  </View>
                );
              })}
            </View>

            {showPlanB ? (
              <Pressable
                onPress={() => {
                  onClose?.();
                  onPlanB?.();
                }}
                style={({ pressed }) => [styles.planBButton, pressed && styles.pressed]}
              >
                <View style={styles.planBIcon}>
                  <Ionicons name="shuffle-outline" size={19} color={colors.textOnAccent} />
                </View>
                <View style={styles.planBCopy}>
                  <Text style={styles.planBTitle}>Plan B</Text>
                  <Text style={styles.planBHint}>Une autre proposition avant ton premier exercice.</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.secondaryAccent} />
              </Pressable>
            ) : null}
          </ScrollView>

          <View style={styles.footer}>
            <Pressable onPress={onClose} style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}>
              <Text style={styles.primaryButtonText}>
                {workout?.sessionStarted ? 'RETOURNER À MA SÉANCE' : 'COMMENCER MA SÉANCE'}
              </Text>
              <Ionicons name="arrow-forward" size={19} color={colors.textOnAccent} />
            </Pressable>
          </View>
        </SafeAreaView>
      </Modal>


      <ExerciseDetailModal
        visible={Boolean(detailExercise)}
        exercise={detailExercise?.exercise ?? null}
        blockTitle={detailExercise?.blockTitle ?? null}
        canSwap={Boolean(detailExercise?.canSwap)}
        onClose={() => setDetailExercise(null)}
        onSwap={() => {
          const target = detailExercise?.exercise ?? null;
          setDetailExercise(null);
          if (target) {
            setSwapError('');
            setSwapExercise(target);
          }
        }}
        styles={styles}
        colors={colors}
      />

      <Modal
        visible={Boolean(swapExercise)}
        transparent
        animationType="slide"
        onRequestClose={() => !swapBusy && setSwapExercise(null)}
      >
        <SafeAreaView style={styles.swapModalRoot}>
          <Pressable style={styles.backdrop} disabled={swapBusy} onPress={() => setSwapExercise(null)} />
          <View style={styles.swapSheet}>
            <View style={styles.handle} />
            <View style={styles.swapHeader}>
              <View style={styles.swapHeaderCopy}>
                <Text style={styles.swapEyebrow}>ADAPTER L’EXERCICE</Text>
                <Text style={styles.swapTitle}>{swapExercise?.name ?? 'Exercice'}</Text>
              </View>
              <Pressable onPress={() => setSwapExercise(null)} disabled={swapBusy} style={styles.closeButton}>
                <Ionicons name="close" size={21} color={colors.text} />
              </Pressable>
            </View>

            {swapError ? <Text style={styles.swapError}>{swapError}</Text> : null}

            {[
              ['equivalent', 'equivalent', 'Un équivalent', 'swap-horizontal-outline'],
              ['easier', 'too_hard', 'Plus facile', 'arrow-down-circle-outline'],
              ['harder', 'too_easy', 'Plus difficile', 'arrow-up-circle-outline'],
            ].map(([key, reason, label, icon]) => {
              const available = selectedAvailability?.directions?.[key]?.available === true;
              return (
                <Pressable
                  key={key}
                  disabled={!available || swapBusy}
                  onPress={() => applySwap(reason)}
                  style={({ pressed }) => [
                    styles.swapOption,
                    !available && styles.swapOptionDisabled,
                    pressed && available && styles.pressed,
                  ]}
                >
                  <Ionicons name={icon} size={20} color={available ? colors.secondaryAccent : colors.textDisabled} />
                  <Text style={[styles.swapOptionText, !available && styles.swapOptionTextDisabled]}>{label}</Text>
                  {swapBusy ? (
                    <ActivityIndicator size="small" color={colors.secondaryAccent} />
                  ) : (
                    <Ionicons name="chevron-forward" size={18} color={available ? colors.secondaryAccent : colors.textDisabled} />
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


function PrescriptionLine({ text, styles, large = false }) {
  const parts = prescriptionParts(text);
  if (parts.length === 0) return null;

  return (
    <Text style={[styles.exercisePrescription, large && styles.exercisePrescriptionLarge]}>
      {parts.map((part, index) => (
        <Text
          key={`prescription-part-${index}`}
          style={isPrescriptionMetric(part) ? [styles.exercisePrescriptionStrong, large && styles.exercisePrescriptionStrongLarge] : null}
        >
          {part}
        </Text>
      ))}
    </Text>
  );
}

function ExerciseDetailModal({ visible, exercise, blockTitle, canSwap, onClose, onSwap, styles, colors }) {
  const imageUri = exerciseImageUri(exercise);
  const description = normalizeText(exercise?.description);
  const instructions = normalizeText(exercise?.instructions);
  const tips = normalizeText(exercise?.tips);
  const uniqueInstructions = instructions && instructions !== description ? instructions : '';
  const uniqueTips = tips && tips !== description && tips !== instructions ? tips : '';

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.detailScreen}>
        <View style={styles.detailHeader}>
          <View style={styles.detailHeaderCopy}>
            <Text style={styles.detailEyebrow}>{blockTitle ?? 'EXERCICE'}</Text>
            <Text style={styles.detailTitle}>{exercise?.name ?? 'Exercice'}</Text>
          </View>
          <Pressable onPress={onClose} hitSlop={10} style={styles.closeButton}>
            <Ionicons name="close" size={22} color={colors.text} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.detailContent} showsVerticalScrollIndicator={false}>
          <View style={styles.detailPrescriptionCard}>
            <Text style={styles.detailSectionLabel}>À FAIRE AUJOURD’HUI</Text>
            {exercise?.prescription ? (
              <PrescriptionLine text={exercise.prescription} styles={styles} large />
            ) : (
              <Text style={styles.detailBody}>Suis la prescription affichée dans ta séance.</Text>
            )}
          </View>

          {imageUri ? (
            <Image source={{ uri: imageUri }} style={styles.detailImage} resizeMode="cover" />
          ) : (
            <View style={styles.detailImageFallback}>
              <View style={styles.detailImageFallbackIcon}>
                <Ionicons name="barbell-outline" size={34} color={colors.accent} />
              </View>
              <Text style={styles.detailImageFallbackText}>Visuel non disponible pour cet exercice</Text>
            </View>
          )}

          {description ? (
            <View style={styles.detailSection}>
              <Text style={styles.detailSectionLabel}>DESCRIPTION</Text>
              <Text style={styles.detailBody}>{description}</Text>
            </View>
          ) : null}

          {uniqueInstructions ? (
            <View style={styles.detailSection}>
              <Text style={styles.detailSectionLabel}>EXÉCUTION</Text>
              <Text style={styles.detailBody}>{uniqueInstructions}</Text>
            </View>
          ) : null}

          {uniqueTips ? (
            <View style={styles.detailSection}>
              <Text style={styles.detailSectionLabel}>CONSEIL UGEROD</Text>
              <Text style={styles.detailBody}>{uniqueTips}</Text>
            </View>
          ) : null}

          {!description && !uniqueInstructions && !uniqueTips ? (
            <View style={styles.detailSection}>
              <Text style={styles.detailSectionLabel}>DESCRIPTION</Text>
              <Text style={styles.detailBody}>Aucune consigne détaillée supplémentaire n’est disponible pour cet exercice.</Text>
            </View>
          ) : null}

          {canSwap ? (
            <Pressable onPress={onSwap} style={({ pressed }) => [styles.detailSwapButton, pressed && styles.pressed]}>
              <Ionicons name="swap-horizontal-outline" size={18} color={colors.secondaryAccent} />
              <Text style={styles.detailSwapText}>Adapter / remplacer l’exercice</Text>
            </Pressable>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function createStyles(colors, isDark) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    header: {
      paddingHorizontal: 20,
      paddingTop: 16,
      paddingBottom: 14,
      flexDirection: 'row',
      alignItems: 'flex-start',
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    headerCopy: { flex: 1 },
    eyebrow: {
      fontFamily: 'Manrope_700Bold',
      fontSize: 10,
      letterSpacing: 1.2,
      color: colors.accent,
    },
    title: {
      marginTop: 5,
      fontFamily: 'Manrope_800ExtraBold',
      fontSize: 32,
      lineHeight: 38,
      color: colors.text,
    },
    subtitle: {
      marginTop: 4,
      fontFamily: 'Manrope_500Medium',
      fontSize: 14,
      color: colors.textSecondary,
    },
    closeButton: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    progressMeta: {
      paddingHorizontal: 20,
      paddingTop: 13,
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    progressLabel: { fontFamily: 'Manrope_600SemiBold', fontSize: 11, color: colors.textSecondary },
    progressPercent: { fontFamily: 'Manrope_700Bold', fontSize: 11, color: colors.secondaryAccent },
    progressTrack: {
      height: 4,
      marginHorizontal: 20,
      marginTop: 8,
      borderRadius: 2,
      overflow: 'hidden',
      backgroundColor: colors.border,
    },
    progressFill: { height: 4, backgroundColor: colors.secondaryAccent },
    scroll: { flex: 1 },
    content: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 24 },
    whiteboard: {
      borderRadius: 18,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: isDark ? colors.surface : '#FCFCF8',
      overflow: 'hidden',
    },
    block: { paddingHorizontal: 15, paddingVertical: 15 },
    blockBorder: { borderTopWidth: 1, borderTopColor: colors.border },
    blockHeader: { flexDirection: 'row', alignItems: 'center', gap: 11 },
    blockIndex: {
      width: 34,
      height: 34,
      borderRadius: 17,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    blockIndexActive: { borderColor: colors.secondaryAccent, backgroundColor: colors.secondaryAccentSoft },
    blockIndexDone: { borderColor: colors.accent, backgroundColor: colors.accent },
    blockIndexText: { fontFamily: 'Manrope_700Bold', fontSize: 10, color: colors.textMuted },
    blockIndexTextActive: { color: colors.secondaryAccent },
    blockHeaderCopy: { flex: 1 },
    blockTitleRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
    blockTitle: { flex: 1, fontFamily: 'Manrope_800ExtraBold', fontSize: 18, color: colors.text },
    blockTitleActive: { color: colors.secondaryAccent },
    blockDuration: { fontFamily: 'Manrope_600SemiBold', fontSize: 11, color: colors.textMuted },
    blockState: { marginTop: 2, fontFamily: 'Manrope_500Medium', fontSize: 10, color: colors.textMuted },
    blockStateActive: { color: colors.secondaryAccent },
    exerciseList: { marginTop: 11, marginLeft: 44, gap: 2 },
    exerciseRow: {
      minHeight: 48,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 9,
      paddingVertical: 7,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    exerciseRowCurrent: {
      marginLeft: -8,
      paddingLeft: 8,
      borderLeftWidth: 3,
      borderLeftColor: colors.secondaryAccent,
      backgroundColor: colors.secondaryAccentSoft,
      borderRadius: 8,
    },
    exerciseMarker: { width: 18, alignItems: 'center' },
    currentDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.secondaryAccent },
    futureDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.border },
    exerciseCopy: { flex: 1 },
    exerciseTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    exerciseName: { flex: 1, fontFamily: 'Manrope_700Bold', fontSize: 13, color: colors.text },
    exerciseNameCurrent: { color: colors.secondaryAccent },
    exercisePrescription: { marginTop: 3, fontFamily: 'Manrope_500Medium', fontSize: 12, lineHeight: 17, color: colors.textSecondary },
    exercisePrescriptionStrong: { fontFamily: 'Manrope_800ExtraBold', fontSize: 13, color: colors.accent },
    exercisePrescriptionLarge: { marginTop: 7, fontSize: 16, lineHeight: 23, color: colors.text },
    exercisePrescriptionStrongLarge: { fontSize: 18, color: colors.text },
    moreButton: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
    swapButton: {
      minHeight: 32,
      paddingHorizontal: 9,
      borderRadius: 10,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      borderWidth: 1,
      borderColor: colors.secondaryAccent,
      backgroundColor: colors.background,
    },
    swapText: { fontFamily: 'Manrope_700Bold', fontSize: 10, color: colors.secondaryAccent },
    maskedWod: {
      marginTop: 12,
      marginLeft: 44,
      paddingVertical: 10,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    maskedWodText: { flex: 1, fontFamily: 'Manrope_500Medium', fontSize: 11, lineHeight: 16, color: colors.textSecondary },
    planBButton: {
      marginTop: 16,
      minHeight: 64,
      paddingHorizontal: 14,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.secondaryAccent,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 11,
      backgroundColor: colors.secondaryAccentSoft,
    },
    planBIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.secondaryAccent },
    planBCopy: { flex: 1 },
    planBTitle: { fontFamily: 'Manrope_800ExtraBold', fontSize: 14, color: colors.text },
    planBHint: { marginTop: 2, fontFamily: 'Manrope_500Medium', fontSize: 10, color: colors.textSecondary },
    footer: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 16, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.background },
    primaryButton: { minHeight: 54, borderRadius: 16, backgroundColor: colors.accent, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
    primaryButtonText: { fontFamily: 'Manrope_800ExtraBold', fontSize: 13, letterSpacing: 0.2, color: colors.textOnAccent },
    detailScreen: { flex: 1, backgroundColor: colors.background },
    detailHeader: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 14, flexDirection: 'row', alignItems: 'flex-start', gap: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
    detailHeaderCopy: { flex: 1 },
    detailEyebrow: { fontFamily: 'Manrope_700Bold', fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: colors.accent },
    detailTitle: { marginTop: 4, fontFamily: 'Manrope_800ExtraBold', fontSize: 28, lineHeight: 34, color: colors.text },
    detailContent: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 36 },
    detailPrescriptionCard: { padding: 16, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
    detailImage: { width: '100%', height: 240, marginTop: 16, borderRadius: 18, backgroundColor: colors.surface },
    detailImageFallback: { minHeight: 210, marginTop: 16, borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 20 },
    detailImageFallbackIcon: { width: 68, height: 68, borderRadius: 34, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft },
    detailImageFallbackText: { fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: colors.textSecondary, textAlign: 'center' },
    detailSection: { marginTop: 18, paddingTop: 16, borderTopWidth: 1, borderTopColor: colors.border },
    detailSectionLabel: { fontFamily: 'Manrope_800ExtraBold', fontSize: 10, letterSpacing: 0.8, color: colors.textSecondary },
    detailBody: { marginTop: 7, fontFamily: 'Manrope_500Medium', fontSize: 14, lineHeight: 22, color: colors.text },
    detailSwapButton: { minHeight: 52, marginTop: 22, borderRadius: 15, borderWidth: 1, borderColor: colors.secondaryAccent, backgroundColor: colors.secondaryAccentSoft, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 14 },
    detailSwapText: { fontFamily: 'Manrope_800ExtraBold', fontSize: 13, color: colors.text },
    pressed: { opacity: 0.78 },
    swapModalRoot: { flex: 1, justifyContent: 'flex-end' },
    backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.48)' },
    swapSheet: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 24, borderTopLeftRadius: 24, borderTopRightRadius: 24, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border },
    handle: { width: 42, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 14, backgroundColor: colors.border },
    swapHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    swapHeaderCopy: { flex: 1 },
    swapEyebrow: { fontFamily: 'Manrope_700Bold', fontSize: 9, letterSpacing: 1.1, color: colors.secondaryAccent },
    swapTitle: { marginTop: 4, fontFamily: 'Manrope_800ExtraBold', fontSize: 23, color: colors.text },
    swapError: { marginTop: 12, fontFamily: 'Manrope_500Medium', fontSize: 11, color: colors.secondaryAccent },
    swapOption: { minHeight: 54, marginTop: 10, paddingHorizontal: 14, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', gap: 10 },
    swapOptionDisabled: { opacity: 0.4 },
    swapOptionText: { flex: 1, fontFamily: 'Manrope_700Bold', fontSize: 13, color: colors.text },
    swapOptionTextDisabled: { color: colors.textMuted },
  });
}
