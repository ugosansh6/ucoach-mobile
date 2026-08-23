import { useMemo } from 'react';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import {
  Image,
  ImageBackground,
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

const heroImage = require('../../assets/backgrounds/welcome-default.jpg');
const darkBrandIcon = require('../../assets/branding/ugerod-icon.png');
const lightBrandIcon = require('../../assets/branding/LOGO VERSION NOIR.png');

const BLOCK_ORDER = ['unlock', 'tabata', 'warmup', 'skill', 'wod'];

const BLOCK_LABELS = {
  unlock: 'UNLOCK',
  tabata: 'TABATA CORE',
  warmup: 'WARM-UP',
  skill: 'SKILL & FORCE',
  wod: 'WOD',
};

const FALLBACK_BLOCKS = [
  {
    id: 'unlock',
    duration: 4,
    structure: '1 série · mobilité ciblée',
    exercises: ['Shoulder CARs', 'Hip opener'],
  },
  {
    id: 'tabata',
    duration: 4,
    structure: '8 séries · 20s travail / 10s repos',
    exercises: ['Dead Bug', 'Shoulder Tap'],
  },
  {
    id: 'warmup',
    duration: 10,
    structure: '3 tours · montée progressive',
    exercises: ['Air Squat', 'Scapular Push-up', 'Good Morning'],
  },
  {
    id: 'skill',
    duration: 15,
    structure: '4 séries · progression technique',
    exercises: ['Pull-up progression'],
  },
  {
    id: 'wod',
    duration: 42,
    structure: 'Format surprise',
    exercises: ['À découvrir au démarrage'],
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

function humanize(value) {
  if (!value) return null;

  return String(value)
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function readBlockSource(workout, blockId) {
  const blocks = workout?.blocks;

  if (Array.isArray(blocks)) {
    return (
      blocks.find((block) =>
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

  return items.filter((exercise) =>
    normalizeBlockId(exercise?.blockKey ?? exercise?.block_key ?? exercise?.block) === blockId
  );
}

function readExerciseName(exercise) {
  return exercise?.name ?? exercise?.exercise_name ?? exercise?.title ?? null;
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
      demo: true,
    }));
  }

  return BLOCK_ORDER.map((blockId) => {
    const source = readBlockSource(workout, blockId);
    const exercises = readExercises(workout, blockId);

    if (!source && exercises.length === 0) return null;

    const names = exercises.map(readExerciseName).filter(Boolean);
    const duration = readDuration(source);

    return {
      id: blockId,
      title: BLOCK_LABELS[blockId],
      duration,
      structure: readStructure(source, exercises.length),
      exercises: names,
      demo: false,
    };
  }).filter(Boolean);
}

function readEquipment(workout) {
  const equipment = workout?.preparationSnapshot?.equipment;
  if (!Array.isArray(equipment) || equipment.length === 0) return null;

  return equipment
    .map((item) => {
      if (typeof item === 'string') return humanize(item);
      return humanize(item?.name ?? item?.label ?? item?.equipment_name);
    })
    .filter(Boolean)
    .slice(0, 3)
    .join(' · ');
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

  const duration = Number(
    workout?.plannedDuration ??
      workout?.preparationSnapshot?.duration ??
      blockVolume ??
      75
  ) || blockVolume || 75;

  const title =
    humanize(
      workout?.title ??
        workout?.meta?.target_region ??
        workout?.preparationSnapshot?.region
    ) ?? 'FULL BODY';

  const format =
    humanize(workout?.format ?? workout?.mechanic) ?? 'FUNCTIONAL FITNESS';

  const focus =
    humanize(
      workout?.meta?.focus ??
        workout?.meta?.primary_goal ??
        workout?.meta?.primaryGoal
    ) ?? 'FORCE · CONDITIONING';

  const equipment = readEquipment(workout) ?? 'MATÉRIEL DU JOUR';
  const wodRevealed = Boolean(workout?.wodRevealed);

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

          <View style={styles.prototypePill}>
            <View style={styles.prototypeDot} />
            <Text style={styles.prototypeText}>PILOTE DESIGN</Text>
          </View>

          <Image source={brandIcon} style={styles.logo} resizeMode="contain" />
        </View>

        <Text style={styles.eyebrow}>SÉANCE DU JOUR</Text>
        <Text style={styles.title}>{title}</Text>

        <View style={styles.metaLine}>
          <Text style={styles.metaStrong}>{duration} MIN</Text>
          <View style={styles.metaDot} />
          <Text style={styles.meta}>{format}</Text>
          <View style={styles.metaDot} />
          <Text style={styles.meta}>{focus}</Text>
        </View>

        <Text style={styles.equipment}>{equipment}</Text>

        <View style={styles.heroWrap}>
          <ImageBackground source={heroImage} style={styles.hero} resizeMode="cover">
            <LinearGradient
              colors={['rgba(7,9,12,0.08)', 'rgba(7,9,12,0.28)', 'rgba(7,9,12,0.88)']}
              locations={[0, 0.5, 1]}
              style={StyleSheet.absoluteFill}
            />

            <View style={styles.heroTop}>
              <View style={styles.heroBadge}>
                <Text style={styles.heroBadgeText}>UGEROD COACH</Text>
              </View>
            </View>

            <View style={styles.heroBottom}>
              <Text style={styles.heroCaption}>TA STRUCTURE. TON RYTHME.</Text>
              <Text style={styles.heroBigNumber}>{duration}</Text>
              <Text style={styles.heroMinutes}>MIN</Text>
            </View>
          </ImageBackground>
        </View>

        <View style={styles.sectionIntro}>
          <View>
            <Text style={styles.sectionEyebrow}>PROGRAMME</Text>
            <Text style={styles.sectionTitle}>TA SÉANCE</Text>
          </View>
          <Text style={styles.blockCount}>{blocks.length} BLOCS</Text>
        </View>

        <View style={styles.blockList}>
          {blocks.map((block, index) => {
            const isWod = block.id === 'wod';
            const concealed = isWod && !wodRevealed;
            const exercisePreview = concealed
              ? 'Le contenu reste surprise jusqu’au moment prévu.'
              : block.exercises.slice(0, 3).join(' · ') || 'Détail dans la séance';

            return (
              <View
                key={block.id}
                style={[
                  styles.blockRow,
                  index < blocks.length - 1 && styles.blockDivider,
                ]}
              >
                <View style={styles.blockIndexColumn}>
                  <Text style={[styles.blockIndex, isWod && styles.blockIndexWod]}>
                    {String(index + 1).padStart(2, '0')}
                  </Text>
                  <View style={[styles.blockRail, isWod && styles.blockRailWod]} />
                </View>

                <View style={styles.blockMain}>
                  <View style={styles.blockTopLine}>
                    <Text style={styles.blockTitle}>{block.title}</Text>
                    {block.duration > 0 ? (
                      <Text style={styles.blockDuration}>{block.duration} MIN</Text>
                    ) : null}
                  </View>

                  <Text style={styles.blockStructure} numberOfLines={2}>
                    {concealed ? 'FORMAT SURPRISE' : block.structure || 'STRUCTURE DE SÉANCE'}
                  </Text>

                  <Text style={styles.blockExercises} numberOfLines={2}>
                    {exercisePreview}
                  </Text>
                </View>

                <Ionicons
                  name="chevron-forward"
                  size={18}
                  color={isWod ? colors.secondaryAccent : colors.textMuted}
                />
              </View>
            );
          })}
        </View>

        <View style={styles.summaryLine}>
          <Text style={styles.summaryLabel}>VOLUME PLANIFIÉ</Text>
          <View style={styles.summaryRule} />
          <Text style={styles.summaryValue}>{duration} MIN</Text>
        </View>

        <Pressable
          onPress={() => {}}
          style={({ pressed }) => [styles.primaryButton, pressed && styles.primaryButtonPressed]}
        >
          <View style={styles.playCircle}>
            <Ionicons name="play" size={17} color={colors.textOnAccent} />
          </View>
          <Text style={styles.primaryButtonText}>DÉMARRER LA SÉANCE</Text>
          <Ionicons name="arrow-forward" size={20} color={colors.textOnAccent} />
        </Pressable>

        <Text style={styles.prototypeNote}>
          Prototype visuel uniquement · aucun démarrage de séance déclenché.
          {!hasGeneratedWorkout ? ' Données de démonstration affichées.' : ''}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function createStyles(colors, isDark) {
  const divider = isDark ? 'rgba(255,255,255,0.10)' : 'rgba(23,26,21,0.10)';
  const subtle = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(23,26,21,0.035)';

  return StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: colors.background,
    },
    content: {
      paddingHorizontal: 22,
      paddingTop: 8,
      paddingBottom: 46,
    },
    header: {
      height: 56,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 28,
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
    prototypePill: {
      minHeight: 28,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 7,
      paddingHorizontal: 11,
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
      fontSize: 10,
      letterSpacing: 0.9,
      color: colors.textSecondary,
    },
    logo: {
      width: 40,
      height: 40,
    },
    eyebrow: {
      fontFamily: 'Oswald_700Bold',
      fontSize: 12,
      lineHeight: 17,
      letterSpacing: 1.4,
      color: colors.accent,
    },
    title: {
      fontFamily: 'BebasNeue_400Regular',
      fontSize: 58,
      lineHeight: 61,
      letterSpacing: 1.2,
      color: colors.text,
      marginTop: 5,
    },
    metaLine: {
      marginTop: 10,
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: 8,
    },
    metaStrong: {
      fontFamily: 'Oswald_700Bold',
      fontSize: 14,
      lineHeight: 20,
      color: colors.text,
    },
    meta: {
      fontFamily: 'Oswald_400Regular',
      fontSize: 14,
      lineHeight: 20,
      color: colors.textSecondary,
    },
    metaDot: {
      width: 3,
      height: 3,
      borderRadius: 2,
      backgroundColor: colors.textMuted,
    },
    equipment: {
      marginTop: 7,
      fontFamily: 'Oswald_400Regular',
      fontSize: 12,
      lineHeight: 18,
      color: colors.textMuted,
      letterSpacing: 0.2,
    },
    heroWrap: {
      marginTop: 24,
      borderRadius: 24,
      overflow: 'hidden',
      backgroundColor: colors.surface,
    },
    hero: {
      height: 306,
      justifyContent: 'space-between',
    },
    heroTop: {
      padding: 18,
      flexDirection: 'row',
      justifyContent: 'flex-start',
    },
    heroBadge: {
      minHeight: 28,
      paddingHorizontal: 10,
      borderRadius: 999,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(7,9,12,0.62)',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: 'rgba(255,255,255,0.22)',
    },
    heroBadgeText: {
      fontFamily: 'Oswald_700Bold',
      fontSize: 10,
      letterSpacing: 1,
      color: '#FFFFFF',
    },
    heroBottom: {
      minHeight: 112,
      paddingHorizontal: 19,
      paddingBottom: 17,
      flexDirection: 'row',
      alignItems: 'flex-end',
    },
    heroCaption: {
      position: 'absolute',
      left: 20,
      bottom: 84,
      fontFamily: 'Oswald_600SemiBold',
      fontSize: 11,
      letterSpacing: 1,
      color: 'rgba(255,255,255,0.76)',
    },
    heroBigNumber: {
      fontFamily: 'BebasNeue_400Regular',
      fontSize: 72,
      lineHeight: 74,
      color: '#FFFFFF',
    },
    heroMinutes: {
      fontFamily: 'Oswald_700Bold',
      fontSize: 16,
      lineHeight: 24,
      color: '#FFFFFF',
      marginLeft: 7,
      marginBottom: 9,
    },
    sectionIntro: {
      marginTop: 36,
      paddingBottom: 14,
      flexDirection: 'row',
      alignItems: 'flex-end',
      justifyContent: 'space-between',
      borderBottomWidth: 1,
      borderBottomColor: divider,
    },
    sectionEyebrow: {
      fontFamily: 'Oswald_600SemiBold',
      fontSize: 10,
      lineHeight: 14,
      letterSpacing: 1.2,
      color: colors.accent,
    },
    sectionTitle: {
      marginTop: 2,
      fontFamily: 'BebasNeue_400Regular',
      fontSize: 34,
      lineHeight: 37,
      letterSpacing: 0.8,
      color: colors.text,
    },
    blockCount: {
      fontFamily: 'Oswald_600SemiBold',
      fontSize: 11,
      lineHeight: 16,
      letterSpacing: 0.8,
      color: colors.textMuted,
      marginBottom: 4,
    },
    blockList: {
      marginTop: 2,
    },
    blockRow: {
      minHeight: 118,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 13,
      paddingVertical: 18,
    },
    blockDivider: {
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: divider,
    },
    blockIndexColumn: {
      width: 29,
      alignSelf: 'stretch',
      alignItems: 'center',
    },
    blockIndex: {
      fontFamily: 'BebasNeue_400Regular',
      fontSize: 20,
      lineHeight: 22,
      color: colors.accent,
    },
    blockIndexWod: {
      color: colors.secondaryAccent,
    },
    blockRail: {
      width: 2,
      flex: 1,
      marginTop: 8,
      borderRadius: 1,
      backgroundColor: colors.accentSoft,
    },
    blockRailWod: {
      backgroundColor: colors.secondaryAccentSoft,
    },
    blockMain: {
      flex: 1,
    },
    blockTopLine: {
      flexDirection: 'row',
      alignItems: 'baseline',
      justifyContent: 'space-between',
      gap: 12,
    },
    blockTitle: {
      flex: 1,
      fontFamily: 'Oswald_700Bold',
      fontSize: 18,
      lineHeight: 24,
      color: colors.text,
    },
    blockDuration: {
      fontFamily: 'Oswald_600SemiBold',
      fontSize: 12,
      lineHeight: 18,
      color: colors.textSecondary,
    },
    blockStructure: {
      marginTop: 6,
      fontFamily: 'Oswald_500Medium',
      fontSize: 14,
      lineHeight: 20,
      color: colors.textSecondary,
    },
    blockExercises: {
      marginTop: 4,
      fontFamily: 'Oswald_400Regular',
      fontSize: 12,
      lineHeight: 18,
      color: colors.textMuted,
    },
    summaryLine: {
      marginTop: 20,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    summaryLabel: {
      fontFamily: 'Oswald_600SemiBold',
      fontSize: 10,
      lineHeight: 15,
      letterSpacing: 0.9,
      color: colors.textMuted,
    },
    summaryRule: {
      flex: 1,
      height: StyleSheet.hairlineWidth,
      backgroundColor: divider,
    },
    summaryValue: {
      fontFamily: 'BebasNeue_400Regular',
      fontSize: 22,
      lineHeight: 24,
      color: colors.text,
    },
    primaryButton: {
      minHeight: 64,
      marginTop: 26,
      borderRadius: 20,
      paddingHorizontal: 18,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      backgroundColor: colors.accent,
    },
    primaryButtonPressed: {
      opacity: 0.84,
      transform: [{ scale: 0.995 }],
    },
    playCircle: {
      width: 38,
      height: 38,
      borderRadius: 19,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.10)',
    },
    primaryButtonText: {
      flex: 1,
      fontFamily: 'Oswald_700Bold',
      fontSize: 17,
      lineHeight: 22,
      letterSpacing: 0.4,
      color: colors.textOnAccent,
    },
    prototypeNote: {
      marginTop: 12,
      fontFamily: 'Oswald_400Regular',
      fontSize: 10,
      lineHeight: 15,
      color: colors.textMuted,
      textAlign: 'center',
    },
    pressed: {
      opacity: 0.65,
    },
  });
}
