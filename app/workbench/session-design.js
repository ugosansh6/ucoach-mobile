import { useMemo } from 'react';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import {
  Image,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useWorkout } from '../../src/contexts/WorkoutContext';
import { useUgerodTheme } from '../../src/contexts/UgerodThemeContext';

const darkBrandIcon = require('../../assets/branding/ugerod-icon.png');
const lightBrandIcon = require('../../assets/branding/LOGO VERSION NOIR.png');

const BLOCK_ORDER = ['unlock', 'tabata', 'warmup', 'skill', 'wod'];

const BLOCK_LABELS = {
  unlock: 'UNLOCK',
  tabata: 'TABATA',
  warmup: 'WARM-UP',
  skill: 'SKILL',
  wod: 'WOD',
};

const FALLBACK_BLOCKS = [
  {
    id: 'unlock',
    duration: 4,
    structure: '1 série · mobilité ciblée',
    exercises: [{ name: 'Shoulder CARs', prescription: '45 sec / côté' }],
  },
  {
    id: 'tabata',
    duration: 4,
    structure: '8 séries · 20s travail / 10s repos',
    exercises: [
      { name: 'Shoulder Tap', prescription: '20 sec' },
      { name: 'Dead Bug', prescription: '20 sec' },
    ],
  },
  {
    id: 'warmup',
    duration: 10,
    structure: '3 tours · 3 exercices',
    exercises: [
      { name: 'Air Squat', prescription: '12 reps' },
      { name: 'Scapular Push-up', prescription: '10 reps' },
      { name: 'Good Morning', prescription: '12 reps' },
    ],
  },
  {
    id: 'skill',
    duration: 15,
    structure: '4 séries · progression technique',
    exercises: [{ name: 'Pull-up progression', prescription: '4 × 5' }],
  },
  {
    id: 'wod',
    duration: 42,
    structure: 'Format surprise',
    exercises: [{ name: 'À découvrir', prescription: '' }],
  },
];

function normalizeBlockId(value) {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/-/g, '_');

  if (normalized === 'warm_up') return 'warmup';
  if (normalized === 'core_tabata') return 'tabata';
  return normalized;
}

function readBlockSource(workout, blockId) {
  const blocks = workout?.blocks;

  if (Array.isArray(blocks)) {
    return (
      blocks.find(
        (block) =>
          normalizeBlockId(block?.block_key ?? block?.key ?? block?.id) === blockId
      ) ?? null
    );
  }

  if (blocks && typeof blocks === 'object') {
    if (blockId === 'warmup') {
      return blocks.warmup ?? blocks.warm_up ?? null;
    }

    return blocks[blockId] ?? null;
  }

  return null;
}

function readExercises(workout, blockId) {
  const items = Array.isArray(workout?.exercises) ? workout.exercises : [];

  return items.filter(
    (exercise) =>
      normalizeBlockId(exercise?.blockKey ?? exercise?.block_key ?? exercise?.block) ===
      blockId
  );
}

function readDuration(source) {
  const value = Number(source?.duration ?? source?.duration_minutes);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function readStructure(source, exerciseCount) {
  const explicit =
    source?.structure ??
    source?.mechanicLabel ??
    source?.mechanic_label ??
    source?.objective ??
    null;

  if (explicit) return String(explicit);

  if (exerciseCount > 0) {
    return `${exerciseCount} exercice${exerciseCount > 1 ? 's' : ''}`;
  }

  return '';
}

function buildPreviewBlocks(workout) {
  const hasGeneratedWorkout = Boolean(
    workout?.sessionId ||
      (Array.isArray(workout?.exercises) && workout.exercises.length > 0)
  );

  if (!hasGeneratedWorkout) {
    return FALLBACK_BLOCKS.map((block) => ({
      ...block,
      title: BLOCK_LABELS[block.id],
      validated: false,
      demo: true,
    }));
  }

  const validatedBlocks = Array.isArray(workout?.validatedBlocks)
    ? workout.validatedBlocks
    : [];

  return BLOCK_ORDER.map((blockId) => {
    const source = readBlockSource(workout, blockId);
    const exercises = readExercises(workout, blockId);

    if (!source && exercises.length === 0) return null;

    return {
      id: blockId,
      title: BLOCK_LABELS[blockId],
      duration: readDuration(source),
      structure: readStructure(source, exercises.length),
      exercises,
      validated: validatedBlocks.includes(blockId),
      demo: false,
    };
  }).filter(Boolean);
}

function readExerciseName(exercise) {
  return exercise?.name ?? exercise?.exercise_name ?? exercise?.title ?? 'Exercice';
}

function readExercisePrescription(exercise) {
  if (typeof exercise?.prescription === 'string') return exercise.prescription;

  return (
    exercise?.prescriptionLabel ??
    exercise?.prescription_label ??
    exercise?.expectedOutcome?.label ??
    'Prescription UGEROD'
  );
}

function getTimerCopy(blockId) {
  if (blockId === 'tabata') {
    return {
      time: '00:20',
      state: 'TRAVAIL',
      action: 'DÉMARRER LE TIMER',
    };
  }

  if (blockId === 'wod') {
    return {
      time: '00:00',
      state: 'PLAYER WOD',
      action: 'DÉMARRER LE WOD',
    };
  }

  return {
    time: '00:00',
    state: 'TIMER',
    action: 'DÉMARRER LE TIMER',
  };
}

function ExerciseVisualPlaceholder({ compact = false, colors, styles }) {
  return (
    <View style={compact ? styles.thumbnailPlaceholder : styles.exerciseVisual}>
      <Ionicons
        name="image-outline"
        size={compact ? 20 : 32}
        color={colors.textMuted}
      />
      {!compact ? (
        <>
          <Text style={styles.exerciseVisualTitle}>VISUEL EXERCICE</Text>
          <Text style={styles.exerciseVisualHint}>EMPLACEMENT PRÉVU POUR L’IMAGE</Text>
        </>
      ) : null}
    </View>
  );
}

export default function SessionDesignPilotScreen() {
  const { workout } = useWorkout();
  const { colors, isDark } = useUgerodTheme();

  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);
  const blocks = useMemo(() => buildPreviewBlocks(workout), [workout]);
  const brandIcon = isDark ? darkBrandIcon : lightBrandIcon;

  const hasGeneratedWorkout = Boolean(
    workout?.sessionId ||
      (Array.isArray(workout?.exercises) && workout.exercises.length > 0)
  );

  const blockVolume = blocks.reduce(
    (sum, block) => sum + (Number(block.duration) || 0),
    0
  );

  const plannedDuration =
    Number(
      workout?.plannedDuration ??
        workout?.preparationSnapshot?.duration ??
        blockVolume
    ) || blockVolume || 75;

  const firstPendingIndex = blocks.findIndex((block) => !block.validated);
  const activeBlockIndex = firstPendingIndex >= 0 ? firstPendingIndex : Math.max(0, blocks.length - 1);
  const activeBlock = blocks[activeBlockIndex] ?? null;
  const activeExercise =
    activeBlock?.exercises?.find((exercise) => exercise?.status === 'pending') ??
    activeBlock?.exercises?.[0] ??
    null;

  const completedBlockCount = blocks.filter((block) => block.validated).length;
  const progress = blocks.length > 0 ? completedBlockCount / blocks.length : 0;
  const progressWidth = `${Math.round(progress * 100)}%`;
  const timer = getTimerCopy(activeBlock?.id);
  const wodConcealed = activeBlock?.id === 'wod' && !workout?.wodRevealed;

  const nextBlocks = blocks.slice(activeBlockIndex + 1);

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style={isDark ? 'light' : 'dark'} />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
      >
        <View style={styles.header}>
          <Pressable
            onPress={() => router.back()}
            hitSlop={12}
            style={({ pressed }) => [styles.headerAction, pressed && styles.pressed]}
          >
            <Ionicons name="arrow-back" size={22} color={colors.text} />
          </Pressable>

          <Text style={styles.headerTitle}>TA SÉANCE</Text>

          <Image source={brandIcon} style={styles.logo} resizeMode="contain" />
        </View>

        <View style={styles.sessionIntro}>
          <View>
            <Text style={styles.sessionEyebrow}>SÉANCE EN COURS</Text>
            <Text style={styles.sessionDuration}>{plannedDuration} MIN</Text>
          </View>

          <View style={styles.prototypePill}>
            <View style={styles.prototypeDot} />
            <Text style={styles.prototypeText}>PILOTE DESIGN</Text>
          </View>
        </View>

        <View style={styles.progressSection}>
          <View style={styles.progressTopRow}>
            <Text style={styles.progressLabel}>PROGRESSION</Text>
            <Text style={styles.progressValue}>
              {blocks.length > 0
                ? `BLOC ${activeBlockIndex + 1} / ${blocks.length}`
                : '—'}
            </Text>
          </View>

          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: progressWidth }]} />
            {blocks.length > 0 ? (
              <View
                style={[
                  styles.progressCursor,
                  {
                    left: `${Math.min(
                      100,
                      Math.max(0, ((activeBlockIndex + 0.5) / blocks.length) * 100)
                    )}%`,
                  },
                ]}
              />
            ) : null}
          </View>

          <Text style={styles.progressCurrent}>
            {activeBlock ? `EN COURS · ${activeBlock.title}` : 'SÉANCE TERMINÉE'}
          </Text>
        </View>

        {activeBlock ? (
          <View style={styles.activeBlock}>
            <View style={styles.activeBlockHeader}>
              <View>
                <Text style={styles.activeBlockEyebrow}>BLOC ACTIF</Text>
                <Text style={styles.activeBlockTitle}>{activeBlock.title}</Text>
              </View>
              {activeBlock.duration > 0 ? (
                <Text style={styles.activeBlockDuration}>{activeBlock.duration} MIN</Text>
              ) : null}
            </View>

            {activeBlock.structure ? (
              <Text style={styles.activeBlockStructure}>{activeBlock.structure}</Text>
            ) : null}

            {wodConcealed ? (
              <View style={styles.secretVisual}>
                <Ionicons name="lock-closed-outline" size={28} color={colors.textMuted} />
                <Text style={styles.secretTitle}>WOD SURPRISE</Text>
                <Text style={styles.secretText}>
                  Le contenu reste caché jusqu’au moment prévu.
                </Text>
              </View>
            ) : (
              <ExerciseVisualPlaceholder colors={colors} styles={styles} />
            )}

            {!wodConcealed ? (
              <>
                <View style={styles.exerciseHeading}>
                  <View style={styles.exerciseTextArea}>
                    <Text style={styles.exerciseCounter}>
                      EXERCICE {Math.max(1, activeBlock.exercises.indexOf(activeExercise) + 1)} /{' '}
                      {Math.max(1, activeBlock.exercises.length)}
                    </Text>
                    <Text style={styles.exerciseName}>
                      {String(readExerciseName(activeExercise)).toUpperCase()}
                    </Text>
                    <Text style={styles.exercisePrescription}>
                      {readExercisePrescription(activeExercise)}
                    </Text>
                  </View>
                </View>

                <View style={styles.timerArea}>
                  <Text style={styles.timerState}>{timer.state}</Text>
                  <Text style={styles.timerValue}>{timer.time}</Text>

                  <View style={styles.timerActions}>
                    <Pressable
                      onPress={() => {}}
                      style={({ pressed }) => [
                        styles.timerPrimaryButton,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Ionicons name="play" size={17} color={colors.textOnAccent} />
                      <Text style={styles.timerPrimaryText}>{timer.action}</Text>
                    </Pressable>

                    <Pressable
                      onPress={() => {}}
                      style={({ pressed }) => [
                        styles.timerSecondaryButton,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Ionicons name="refresh" size={18} color={colors.textSecondary} />
                    </Pressable>
                  </View>
                </View>

                <View style={styles.exerciseActions}>
                  <Pressable
                    onPress={() => {}}
                    style={({ pressed }) => [styles.statusButton, pressed && styles.pressed]}
                  >
                    <Ionicons name="checkmark-circle-outline" size={20} color={colors.accent} />
                    <Text style={styles.statusButtonText}>RÉALISÉ</Text>
                  </Pressable>

                  <Pressable
                    onPress={() => {}}
                    style={({ pressed }) => [styles.swapButton, pressed && styles.pressed]}
                  >
                    <Ionicons name="swap-horizontal-outline" size={21} color={colors.accent} />
                    <Text style={styles.swapButtonText}>REMPLACER</Text>
                  </Pressable>
                </View>

                <Pressable
                  onPress={() => {}}
                  style={({ pressed }) => [styles.detailButton, pressed && styles.pressed]}
                >
                  <Text style={styles.detailButtonText}>VOIR LES DÉTAILS TECHNIQUES</Text>
                  <Ionicons name="chevron-down" size={18} color={colors.textMuted} />
                </Pressable>
              </>
            ) : null}
          </View>
        ) : null}

        {nextBlocks.length > 0 ? (
          <View style={styles.nextSection}>
            <View style={styles.nextHeader}>
              <Text style={styles.nextEyebrow}>PROGRAMME</Text>
              <Text style={styles.nextTitle}>À SUIVRE</Text>
            </View>

            <View style={styles.nextList}>
              {nextBlocks.map((block, index) => {
                const concealed = block.id === 'wod' && !workout?.wodRevealed;
                const preview = concealed
                  ? 'Surprise'
                  : block.exercises
                      .slice(0, 2)
                      .map((exercise) => readExerciseName(exercise))
                      .join(' · ') || block.structure || 'Détail dans la séance';

                return (
                  <View
                    key={block.id}
                    style={[
                      styles.nextRow,
                      index < nextBlocks.length - 1 && styles.nextDivider,
                    ]}
                  >
                    <ExerciseVisualPlaceholder compact colors={colors} styles={styles} />

                    <View style={styles.nextMain}>
                      <View style={styles.nextTopLine}>
                        <Text style={styles.nextBlockTitle}>{block.title}</Text>
                        {block.duration > 0 ? (
                          <Text style={styles.nextDuration}>{block.duration} MIN</Text>
                        ) : null}
                      </View>
                      <Text style={styles.nextPreview} numberOfLines={2}>
                        {preview}
                      </Text>
                    </View>

                    <Ionicons
                      name={concealed ? 'lock-closed-outline' : 'chevron-forward'}
                      size={18}
                      color={concealed ? colors.secondaryAccent : colors.textMuted}
                    />
                  </View>
                );
              })}
            </View>
          </View>
        ) : null}

        <Text style={styles.prototypeNote}>
          Prototype visuel uniquement · la vraie page Session et ses comportements ne sont pas modifiés.
          {!hasGeneratedWorkout ? ' Données de démonstration affichées.' : ''}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function createStyles(colors, isDark) {
  const divider = isDark ? 'rgba(255,255,255,0.10)' : 'rgba(23,26,21,0.10)';
  const subtle = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(23,26,21,0.035)';
  const raised = isDark ? 'rgba(255,255,255,0.055)' : 'rgba(23,26,21,0.045)';

  return StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: colors.background,
    },
    content: {
      paddingHorizontal: 22,
      paddingTop: 8,
      paddingBottom: 48,
    },
    header: {
      height: 58,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      marginBottom: 20,
    },
    headerAction: {
      width: 42,
      height: 42,
      borderRadius: 21,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: subtle,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: divider,
    },
    headerTitle: {
      flex: 1,
      fontFamily: 'BebasNeue_400Regular',
      fontSize: 34,
      lineHeight: 37,
      letterSpacing: 1.4,
      color: colors.text,
    },
    logo: {
      width: 42,
      height: 42,
    },
    sessionIntro: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-end',
    },
    sessionEyebrow: {
      fontFamily: 'Oswald_600SemiBold',
      fontSize: 10,
      lineHeight: 14,
      letterSpacing: 1.1,
      color: colors.textMuted,
    },
    sessionDuration: {
      marginTop: 2,
      fontFamily: 'BebasNeue_400Regular',
      fontSize: 42,
      lineHeight: 44,
      letterSpacing: 1.1,
      color: colors.text,
    },
    prototypePill: {
      minHeight: 27,
      marginBottom: 5,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 7,
      paddingHorizontal: 10,
      borderRadius: 999,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: divider,
    },
    prototypeDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: colors.secondaryAccent,
    },
    prototypeText: {
      fontFamily: 'Oswald_600SemiBold',
      fontSize: 9,
      letterSpacing: 0.8,
      color: colors.textSecondary,
    },
    progressSection: {
      marginTop: 20,
      paddingTop: 16,
      paddingBottom: 18,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: divider,
    },
    progressTopRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    progressLabel: {
      fontFamily: 'Oswald_700Bold',
      fontSize: 11,
      lineHeight: 16,
      letterSpacing: 1.1,
      color: colors.textSecondary,
    },
    progressValue: {
      fontFamily: 'Oswald_600SemiBold',
      fontSize: 11,
      lineHeight: 16,
      letterSpacing: 0.8,
      color: colors.accent,
    },
    progressTrack: {
      position: 'relative',
      height: 4,
      marginTop: 12,
      borderRadius: 2,
      backgroundColor: colors.accentSoft,
      overflow: 'visible',
    },
    progressFill: {
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.accent,
    },
    progressCursor: {
      position: 'absolute',
      top: -4,
      width: 12,
      height: 12,
      marginLeft: -6,
      borderRadius: 6,
      backgroundColor: colors.accent,
      borderWidth: 2,
      borderColor: colors.background,
    },
    progressCurrent: {
      marginTop: 11,
      fontFamily: 'Oswald_600SemiBold',
      fontSize: 11,
      lineHeight: 16,
      letterSpacing: 0.6,
      color: colors.textMuted,
    },
    activeBlock: {
      marginTop: 30,
    },
    activeBlockHeader: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      justifyContent: 'space-between',
      gap: 14,
    },
    activeBlockEyebrow: {
      fontFamily: 'Oswald_600SemiBold',
      fontSize: 10,
      lineHeight: 14,
      letterSpacing: 1.2,
      color: colors.accent,
    },
    activeBlockTitle: {
      marginTop: 2,
      fontFamily: 'BebasNeue_400Regular',
      fontSize: 46,
      lineHeight: 49,
      letterSpacing: 1,
      color: colors.text,
    },
    activeBlockDuration: {
      marginBottom: 7,
      fontFamily: 'Oswald_700Bold',
      fontSize: 13,
      lineHeight: 18,
      color: colors.textSecondary,
    },
    activeBlockStructure: {
      marginTop: 6,
      fontFamily: 'Oswald_400Regular',
      fontSize: 13,
      lineHeight: 19,
      color: colors.textMuted,
    },
    exerciseVisual: {
      height: 248,
      marginTop: 20,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 20,
      backgroundColor: raised,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: divider,
    },
    exerciseVisualTitle: {
      marginTop: 11,
      fontFamily: 'Oswald_700Bold',
      fontSize: 12,
      lineHeight: 17,
      letterSpacing: 1,
      color: colors.textSecondary,
    },
    exerciseVisualHint: {
      marginTop: 3,
      fontFamily: 'Oswald_400Regular',
      fontSize: 9,
      lineHeight: 14,
      letterSpacing: 0.7,
      color: colors.textMuted,
    },
    secretVisual: {
      minHeight: 190,
      marginTop: 20,
      paddingHorizontal: 28,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 20,
      backgroundColor: raised,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: divider,
    },
    secretTitle: {
      marginTop: 12,
      fontFamily: 'BebasNeue_400Regular',
      fontSize: 30,
      lineHeight: 33,
      letterSpacing: 1,
      color: colors.text,
    },
    secretText: {
      marginTop: 4,
      fontFamily: 'Oswald_400Regular',
      fontSize: 12,
      lineHeight: 18,
      textAlign: 'center',
      color: colors.textMuted,
    },
    exerciseHeading: {
      marginTop: 20,
    },
    exerciseTextArea: {
      flex: 1,
    },
    exerciseCounter: {
      fontFamily: 'Oswald_600SemiBold',
      fontSize: 10,
      lineHeight: 14,
      letterSpacing: 1,
      color: colors.accent,
    },
    exerciseName: {
      marginTop: 3,
      fontFamily: 'BebasNeue_400Regular',
      fontSize: 38,
      lineHeight: 41,
      letterSpacing: 0.8,
      color: colors.text,
    },
    exercisePrescription: {
      marginTop: 3,
      fontFamily: 'Oswald_500Medium',
      fontSize: 14,
      lineHeight: 20,
      color: colors.textSecondary,
    },
    timerArea: {
      marginTop: 24,
      paddingVertical: 20,
      alignItems: 'center',
      borderTopWidth: StyleSheet.hairlineWidth,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: divider,
    },
    timerState: {
      fontFamily: 'Oswald_700Bold',
      fontSize: 11,
      lineHeight: 16,
      letterSpacing: 1.6,
      color: colors.secondaryAccent,
    },
    timerValue: {
      marginTop: 2,
      fontFamily: 'BebasNeue_400Regular',
      fontSize: 72,
      lineHeight: 76,
      letterSpacing: 2,
      color: colors.text,
    },
    timerActions: {
      width: '100%',
      marginTop: 12,
      flexDirection: 'row',
      gap: 10,
    },
    timerPrimaryButton: {
      flex: 1,
      minHeight: 52,
      paddingHorizontal: 16,
      borderRadius: 16,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      backgroundColor: colors.accent,
    },
    timerPrimaryText: {
      fontFamily: 'Oswald_700Bold',
      fontSize: 12,
      lineHeight: 17,
      letterSpacing: 0.5,
      color: colors.textOnAccent,
    },
    timerSecondaryButton: {
      width: 52,
      height: 52,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: divider,
      backgroundColor: subtle,
    },
    exerciseActions: {
      marginTop: 18,
      flexDirection: 'row',
      gap: 10,
    },
    statusButton: {
      flex: 1,
      minHeight: 50,
      paddingHorizontal: 14,
      borderRadius: 15,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      backgroundColor: colors.accentSoft,
    },
    statusButtonText: {
      fontFamily: 'Oswald_700Bold',
      fontSize: 12,
      lineHeight: 17,
      color: colors.accent,
    },
    swapButton: {
      flex: 1,
      minHeight: 50,
      paddingHorizontal: 14,
      borderRadius: 15,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: divider,
      backgroundColor: subtle,
    },
    swapButtonText: {
      fontFamily: 'Oswald_700Bold',
      fontSize: 12,
      lineHeight: 17,
      color: colors.textSecondary,
    },
    detailButton: {
      minHeight: 48,
      marginTop: 10,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: divider,
    },
    detailButtonText: {
      fontFamily: 'Oswald_600SemiBold',
      fontSize: 11,
      lineHeight: 16,
      letterSpacing: 0.5,
      color: colors.textMuted,
    },
    nextSection: {
      marginTop: 38,
    },
    nextHeader: {
      paddingBottom: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: divider,
    },
    nextEyebrow: {
      fontFamily: 'Oswald_600SemiBold',
      fontSize: 10,
      lineHeight: 14,
      letterSpacing: 1.2,
      color: colors.accent,
    },
    nextTitle: {
      marginTop: 2,
      fontFamily: 'BebasNeue_400Regular',
      fontSize: 34,
      lineHeight: 37,
      letterSpacing: 0.8,
      color: colors.text,
    },
    nextList: {
      marginTop: 2,
    },
    nextRow: {
      minHeight: 98,
      paddingVertical: 14,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    nextDivider: {
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: divider,
    },
    thumbnailPlaceholder: {
      width: 68,
      height: 68,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: raised,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: divider,
    },
    nextMain: {
      flex: 1,
    },
    nextTopLine: {
      flexDirection: 'row',
      alignItems: 'baseline',
      justifyContent: 'space-between',
      gap: 10,
    },
    nextBlockTitle: {
      flex: 1,
      fontFamily: 'Oswald_700Bold',
      fontSize: 16,
      lineHeight: 22,
      color: colors.text,
    },
    nextDuration: {
      fontFamily: 'Oswald_600SemiBold',
      fontSize: 11,
      lineHeight: 16,
      color: colors.textSecondary,
    },
    nextPreview: {
      marginTop: 4,
      fontFamily: 'Oswald_400Regular',
      fontSize: 12,
      lineHeight: 18,
      color: colors.textMuted,
    },
    prototypeNote: {
      marginTop: 30,
      fontFamily: 'Oswald_400Regular',
      fontSize: 10,
      lineHeight: 15,
      color: colors.textMuted,
      textAlign: 'center',
    },
    pressed: {
      opacity: 0.62,
    },
  });
}
