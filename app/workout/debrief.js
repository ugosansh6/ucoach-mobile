import { useCallback, useEffect, useMemo, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useUgerodTheme } from '../../src/contexts/UgerodThemeContext';
import { useWorkout } from '../../src/contexts/WorkoutContext';
import {
  getCoachOpportunitySnapshot,
  getProgressionDataContract,
  getSessionLearningSnapshot,
} from '../../src/services/progressionDataService';
import {
  getObservationQuestionNeed,
  submitSkillTechnicalFeedback,
} from '../../src/services/observationService';

const darkBrandIcon = require('../../assets/branding/ugerod-icon.png');
const lightBrandIcon = require('../../assets/branding/LOGO VERSION NOIR.png');

const MANROPE = {
  regular: 'Manrope_400Regular',
  medium: 'Manrope_500Medium',
  semiBold: 'Manrope_600SemiBold',
  bold: 'Manrope_700Bold',
  extraBold: 'Manrope_800ExtraBold',
};

const ENVIRONMENT_LABELS = {
  HOME: 'Maison',
  BOX: 'Box',
  GYM: 'Salle',
  OUTDOOR: 'Extérieur',
};

const SHAREABLE_BLOCKS = {
  skill: { label: 'SKILL', order: 1 },
  strength: { label: 'FORCE', order: 2 },
  tabata: { label: 'TABATA', order: 3 },
  wod: { label: 'WOD', order: 4 },
  conditioning: { label: 'CONDITIONING', order: 5 },
};

const HIDDEN_SHARE_BLOCKS = new Set([
  'unlock',
  'warmup',
  'warm_up',
  'warm-up',
  'mobility',
  'activation',
  'cooldown',
  'cool_down',
  'cool-down',
  'preparation',
]);

function firstParam(value) {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function normalizeBlock(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s/-]+/g, '_');
}

function exerciseKey(exercise) {
  return exercise?.sessionExerciseId ?? exercise?.session_exercise_id ?? exercise?.id;
}

function executionStatus(exercise) {
  const raw = String(
    exercise?.userExecutionStatus ??
      exercise?.user_execution_status ??
      exercise?.status ??
      ''
  ).toLowerCase();

  if (raw === 'completed') return 'completed';
  if (raw === 'adapted') return 'adapted';
  if (raw === 'skipped' || raw === 'not_completed') return 'not_completed';
  return raw || 'completed';
}

function numberOrNull(value) {
  if (value == null || value === '') return null;
  const numeric = Number(String(value).replace(',', '.'));
  return Number.isFinite(numeric) ? numeric : null;
}

function compactNumber(value) {
  const numeric = numberOrNull(value);
  if (numeric == null) return null;
  return Number.isInteger(numeric) ? String(numeric) : String(Math.round(numeric * 10) / 10);
}

function formatSeconds(value) {
  const seconds = numberOrNull(value);
  if (seconds == null || seconds <= 0) return null;
  const rounded = Math.round(seconds);
  const minutes = Math.floor(rounded / 60);
  const rest = rounded % 60;
  if (!minutes) return `${rest} s`;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

function sessionEnvironment(workout) {
  return (
    workout?.preparationSnapshot?.environmentCode ??
    workout?.meta?.environment_code ??
    workout?.meta?.planned_environment_code ??
    'HOME'
  );
}

function actualDurationMinutes(workout) {
  const start = workout?.startedAt ? new Date(workout.startedAt).getTime() : NaN;
  const end = workout?.completedAt ? new Date(workout.completedAt).getTime() : Date.now();

  if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
    const minutes = Math.max(1, Math.round((end - start) / 60000));
    if (minutes < 360) return minutes;
  }

  return workout?.plannedDuration ?? 45;
}

function wodPerformance(runtime) {
  if (!runtime?.started) return null;

  const elapsed = Number(runtime?.elapsedSeconds ?? 0);
  const rounds = Number(runtime?.completedRounds ?? 0);
  const reps = Number(runtime?.reps ?? runtime?.repsCompleted ?? runtime?.totalReps ?? 0);

  if (rounds > 0 && reps > 0) {
    return {
      block: 'WOD',
      name: 'Résultat',
      value: `${rounds} + ${reps}`,
      meta: 'TOURS + REPS',
      priority: 0,
    };
  }

  if (rounds > 0) {
    return {
      block: 'WOD',
      name: 'Résultat',
      value: String(rounds),
      meta: rounds > 1 ? 'TOURS' : 'TOUR',
      priority: 0,
    };
  }

  if (elapsed > 0) {
    return {
      block: 'WOD',
      name: 'Temps',
      value: formatSeconds(elapsed),
      meta: 'TEMPS',
      priority: 0,
    };
  }

  return null;
}

function storyBlocksFromWorkout(workout) {
  const exercises = Array.isArray(workout?.exercises) ? workout.exercises : [];
  const grouped = new Map();

  exercises.forEach((exercise) => {
    if (executionStatus(exercise) === 'not_completed') return;

    const block = normalizeBlock(exercise?.blockKey ?? exercise?.block);
    if (!block || HIDDEN_SHARE_BLOCKS.has(block)) return;

    const policy = SHAREABLE_BLOCKS[block] ?? null;
    if (!policy) return;

    if (!grouped.has(block)) {
      grouped.set(block, {
        key: block,
        label: policy.label,
        order: policy.order,
        exercises: [],
      });
    }

    grouped.get(block).exercises.push({
      name: exercise?.name ?? exercise?.exerciseName ?? exercise?.id,
      status: executionStatus(exercise),
    });
  });

  return [...grouped.values()]
    .sort((a, b) => a.order - b.order)
    .map((block) => ({ ...block, exercises: block.exercises.slice(0, 8) }));
}

function exercisePerformanceItems(workout, completion) {
  const exercises = Array.isArray(workout?.exercises) ? workout.exercises : [];
  const loads = completion?.loads ?? {};
  const items = [];
  const wodResult = wodPerformance(workout?.wodRuntime);

  if (wodResult) items.push(wodResult);

  exercises.forEach((exercise, index) => {
    if (executionStatus(exercise) === 'not_completed') return;

    const blockKey = normalizeBlock(exercise?.blockKey ?? exercise?.block);
    const block = SHAREABLE_BLOCKS[blockKey]?.label ?? null;
    if (!block || blockKey === 'wod') return;

    const key = exerciseKey(exercise);
    const actual = exercise?.performanceActualJson ?? exercise?.performance_actual_json ?? {};
    const load = numberOrNull(
      loads?.[key] ??
        loads?.[exercise?.id] ??
        actual?.load_kg ??
        actual?.load ??
        exercise?.loadKg ??
        exercise?.load_kg
    );
    const reps = numberOrNull(
      exercise?.repsCompleted ??
        exercise?.reps_completed ??
        actual?.reps_completed ??
        actual?.reps
    );
    const duration = numberOrNull(
      exercise?.durationSeconds ??
        exercise?.duration_seconds ??
        actual?.duration_seconds ??
        actual?.time_seconds
    );
    const distance = numberOrNull(
      exercise?.distanceMeters ??
        exercise?.distance_meters ??
        actual?.distance_meters ??
        actual?.distance
    );

    let value = null;
    let meta = null;

    if (load != null && load > 0) {
      value = `${compactNumber(load)} KG`;
      meta = reps != null && reps > 0 ? `${Math.round(reps)} REPS` : block;
    } else if (reps != null && reps > 0) {
      value = `${Math.round(reps)} REPS`;
      meta = block;
    } else if (distance != null && distance > 0) {
      value = `${compactNumber(distance)} M`;
      meta = duration != null && duration > 0 ? formatSeconds(duration) : block;
    } else if (duration != null && duration > 0) {
      value = formatSeconds(duration);
      meta = block;
    }

    if (!value) return;

    items.push({
      block,
      name: exercise?.name ?? exercise?.exerciseName ?? exercise?.id,
      value,
      meta,
      priority: blockKey === 'strength' ? 1 : blockKey === 'skill' ? 2 : 3,
      index,
    });
  });

  return items
    .sort((a, b) => (a.priority ?? 9) - (b.priority ?? 9) || (a.index ?? 0) - (b.index ?? 0))
    .slice(0, 3);
}

function buildShareText(workout, performanceItems, blocks) {
  const environment = ENVIRONMENT_LABELS[sessionEnvironment(workout)] ?? sessionEnvironment(workout);
  const lines = ['UGEROD', `${actualDurationMinutes(workout)} min · ${environment}`, ''];

  performanceItems.slice(0, 3).forEach((item) => {
    lines.push(`${item.block} · ${item.name}`);
    lines.push(`${item.value}${item.meta ? ` · ${item.meta}` : ''}`);
    lines.push('');
  });

  if (!performanceItems.length) {
    lines.push(blocks.map((block) => block.label).join(' · ') || 'Séance terminée');
  }

  return lines.join('\n').trim();
}

function equipmentRequirementLabel(item) {
  const name = String(item?.name ?? '').trim();
  if (!name) return null;
  const quantity = Math.max(1, Math.round(Number(item?.required_quantity ?? 1)));
  return quantity > 1 ? `${quantity} × ${name}` : name;
}

function joinEquipmentLabels(items) {
  const labels = (Array.isArray(items) ? items : [])
    .map(equipmentRequirementLabel)
    .filter(Boolean);

  if (!labels.length) return '';
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} + ${labels[1]}`;
  return `${labels.slice(0, -1).join(', ')} + ${labels[labels.length - 1]}`;
}

function buildCoachRecommendation(snapshot, progression, opportunitySnapshot) {
  const opportunities = Array.isArray(opportunitySnapshot?.top_opportunities)
    ? opportunitySnapshot.top_opportunities
    : [];
  const equipmentOpportunity = opportunities.find((item) => item?.type === 'EQUIPMENT_ACCESS');

  if (equipmentOpportunity) {
    const equipment = joinEquipmentLabels(equipmentOpportunity?.equipment_gap?.missing_equipment);
    const target = equipmentOpportunity?.target_exercise_name ?? 'ton prochain objectif';
    const supportType = equipmentOpportunity?.supports_opportunity_type;
    const benefit = supportType === 'CALIBRATION'
      ? `mieux calibrer ${target}`
      : supportType === 'RETEST'
        ? `retester ${target}`
        : supportType === 'SKILL_PROGRESSION'
          ? `faire progresser ${target}`
          : supportType === 'SKILL_DEVELOPMENT'
            ? `développer ${target}`
            : supportType === 'MOVEMENT_PROGRESSION'
              ? `faire progresser ${target}`
              : `mieux travailler ${target}`;

    return {
      icon: 'barbell-outline',
      eyebrow: 'PROCHAINE OPPORTUNITÉ',
      title: 'Si tu peux, choisis une salle',
      text: equipment
        ? `Avec ${equipment}, je pourrai ${benefit} dans de meilleures conditions.`
        : `Un environnement mieux équipé me permettra de ${benefit}.`,
      why: `Cette recommandation vient d’une opportunité matériel détectée autour de ${target}. Ce n’est pas une obligation : si tu restes à la maison, le programme continue avec ce que tu as.`,
    };
  }

  const movements = Array.isArray(progression?.movement_capabilities)
    ? progression.movement_capabilities
    : [];
  const progressing = movements.find((item) => item?.signal === 'PROGRESSING');
  const recalibrating = movements.find((item) => item?.signal === 'RECALIBRATING');
  const observations = Array.isArray(snapshot?.observations) ? snapshot.observations : [];
  const environmentIssue = observations.some(
    (item) => item?.execution_reason_code === 'ENVIRONMENT_MISMATCH'
  );

  if (progressing?.name) {
    return {
      icon: 'trending-up-outline',
      eyebrow: 'POUR LA SUITE',
      title: 'On consolide avant d’augmenter',
      text: `Le signal est positif sur ${progressing.name}. Je veux encore une exposition comparable avant de monter la référence.`,
      why: 'UGEROD évite de faire progresser une charge, une variante ou un niveau à partir d’une seule observation isolée.',
    };
  }

  if (recalibrating?.name) {
    return {
      icon: 'swap-vertical-outline',
      eyebrow: 'POUR LA SUITE',
      title: 'On revérifie proprement',
      text: `${recalibrating.name} mérite une nouvelle exposition comparable avant de changer ton niveau de référence.`,
      why: 'Une séance atypique ne doit pas suffire à faire monter ou baisser automatiquement ton niveau.',
    };
  }

  if (environmentIssue) {
    return {
      icon: 'navigate-outline',
      eyebrow: 'POUR LA SUITE',
      title: 'Un autre contexte peut aider',
      text: 'Ton environnement a limité une partie de la séance. Si tu peux changer de contexte la prochaine fois, je pourrai te proposer davantage d’options.',
      why: 'UGEROD sépare une limite de contexte d’une limite physique pour ne pas dégrader ton profil à tort.',
    };
  }

  return {
    icon: 'checkmark-circle-outline',
    eyebrow: 'POUR LA SUITE',
    title: 'Continue comme prévu',
    text: 'Rien ne justifie de bouleverser la suite aujourd’hui. La prochaine séance restera guidée par ton programme, ta récupération et tes signaux établis.',
    why: 'Le Coach ne crée pas une nouvelle recommandation juste pour remplir l’écran. Quand aucune opportunité forte n’est détectée, il conserve la trajectoire prévue.',
  };
}

function SkillQuestionCard({ question, value, saving, error, onSelect, colors, styles }) {
  if (!question?.should_ask) return null;

  const options = Array.isArray(question.options)
    ? question.options
    : ['PROPRE', 'LIMITE', 'PAS_ENCORE'];

  return (
    <View style={styles.questionSection}>
      <View style={styles.questionHeader}>
        <View style={styles.questionIcon}>
          <Ionicons name="eye-outline" size={18} color={colors.accent} />
        </View>
        <View style={styles.questionMain}>
          <Text style={styles.microLabel}>UNE INFO POUR MIEUX ADAPTER</Text>
          <Text style={styles.questionTitle}>
            {question.question_text ?? 'Sur le Skill, ta technique était…'}
          </Text>
        </View>
      </View>

      <View style={styles.optionRow}>
        {options.map((option) => {
          const selected = value === option;
          return (
            <Pressable
              key={option}
              disabled={saving}
              onPress={() => onSelect(option)}
              style={({ pressed }) => [
                styles.optionButton,
                selected && styles.optionButtonSelected,
                pressed && !saving && styles.pressed,
              ]}
            >
              <Text style={[styles.optionText, selected && styles.optionTextSelected]}>
                {String(option).replaceAll('_', ' ')}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {saving ? (
        <View style={styles.questionStatus}>
          <ActivityIndicator size="small" color={colors.accent} />
          <Text style={styles.questionStatusText}>J’enregistre…</Text>
        </View>
      ) : null}

      {error ? <Text style={styles.questionError}>{error}</Text> : null}
    </View>
  );
}

function StoryPreview({ workout, performanceItems, blocks, styles }) {
  const environment = ENVIRONMENT_LABELS[sessionEnvironment(workout)] ?? sessionEnvironment(workout);
  const duration = actualDurationMinutes(workout);
  const primary = performanceItems[0] ?? null;
  const secondary = performanceItems[1] ?? null;
  const blockLine = blocks.map((block) => block.label).slice(0, 4).join(' · ');

  return (
    <View style={styles.storyCard}>
      <View style={styles.storyAccentTop} />
      <View style={styles.storyTopRow}>
        <Text style={styles.storyBrand}>UGEROD</Text>
        <Text style={styles.storyDate}>{formatStoryDate(workout?.completedAt)}</Text>
      </View>

      <View style={styles.storySessionMeta}>
        <Text style={styles.storyDuration}>{duration}</Text>
        <View style={styles.storyDurationCopy}>
          <Text style={styles.storyDurationUnit}>MIN</Text>
          <Text style={styles.storyEnvironment}>{environment.toUpperCase()}</Text>
        </View>
      </View>

      <Text style={styles.storyBlocksLine}>{blockLine || 'SÉANCE UGEROD'}</Text>

      <View style={styles.storyPerformanceZone}>
        {primary ? (
          <View>
            <Text style={styles.storyPerformanceLabel}>{primary.block} · {primary.name}</Text>
            <Text style={styles.storyPerformanceValue}>{primary.value}</Text>
            {primary.meta ? <Text style={styles.storyPerformanceMeta}>{primary.meta}</Text> : null}
          </View>
        ) : (
          <View>
            <Text style={styles.storyPerformanceLabel}>SÉANCE TERMINÉE</Text>
            <Text style={styles.storyPerformanceValue}>DONE</Text>
            <Text style={styles.storyPerformanceMeta}>{blocks.length} BLOCS RÉALISÉS</Text>
          </View>
        )}

        {secondary ? (
          <View style={styles.storySecondaryPerformance}>
            <Text style={styles.storySecondaryLabel}>{secondary.name}</Text>
            <Text style={styles.storySecondaryValue}>{secondary.value}</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.storyFooter}>
        <View style={styles.storyFooterMark} />
        <Text style={styles.storyFooterText}>COACHED BY UGEROD</Text>
      </View>
    </View>
  );
}

function formatStoryDate(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return '';
  return `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getFullYear()).slice(-2)}`;
}

export default function WorkoutDebriefScreen() {
  const params = useLocalSearchParams();
  const sessionId = firstParam(params?.sessionId);
  const { workout, completion } = useWorkout();
  const { colors, isDark } = useUgerodTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const brandIcon = isDark ? darkBrandIcon : lightBrandIcon;

  const [snapshot, setSnapshot] = useState(null);
  const [progression, setProgression] = useState(null);
  const [opportunitySnapshot, setOpportunitySnapshot] = useState(null);
  const [skillQuestion, setSkillQuestion] = useState(null);
  const [skillFeedback, setSkillFeedback] = useState(null);
  const [skillFeedbackSaving, setSkillFeedbackSaving] = useState(false);
  const [skillFeedbackError, setSkillFeedbackError] = useState('');
  const [coachLoading, setCoachLoading] = useState(true);
  const [coachError, setCoachError] = useState('');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [whyOpen, setWhyOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  const environment = ENVIRONMENT_LABELS[sessionEnvironment(workout)] ?? sessionEnvironment(workout);
  const duration = actualDurationMinutes(workout);
  const blocks = useMemo(() => storyBlocksFromWorkout(workout), [workout]);
  const performanceItems = useMemo(
    () => exercisePerformanceItems(workout, completion),
    [workout, completion]
  );
  const performedExercises = useMemo(
    () => (Array.isArray(workout?.exercises) ? workout.exercises : []).filter(
      (exercise) => executionStatus(exercise) !== 'not_completed'
    ),
    [workout?.exercises]
  );
  const shareText = useMemo(
    () => buildShareText(workout, performanceItems, blocks),
    [workout, performanceItems, blocks]
  );

  const loadCoach = useCallback(async () => {
    setCoachLoading(true);
    setCoachError('');

    if (!sessionId) {
      setCoachError('Session manquante pour préparer la suite.');
      setCoachLoading(false);
      return;
    }

    const [sessionLearning, progressionData, opportunityData, questionNeed] = await Promise.all([
      getSessionLearningSnapshot(sessionId).catch(() => null),
      getProgressionDataContract('4w').catch(() => null),
      getCoachOpportunitySnapshot().catch(() => null),
      getObservationQuestionNeed(sessionId, 'SKILL_TECHNICAL_QUALITY').catch(() => ({
        should_ask: false,
        reason: 'QUESTION_UNAVAILABLE',
      })),
    ]);

    setSnapshot(sessionLearning);
    setProgression(progressionData);
    setOpportunitySnapshot(opportunityData);
    setSkillQuestion(questionNeed);

    if (!sessionLearning && !progressionData && !opportunityData) {
      setCoachError("La séance est enregistrée, mais le conseil Coach n'est pas disponible pour l'instant.");
    }

    setCoachLoading(false);
  }, [sessionId]);

  useEffect(() => {
    loadCoach();
  }, [loadCoach]);

  const coachRecommendation = useMemo(
    () => buildCoachRecommendation(snapshot, progression, opportunitySnapshot),
    [snapshot, progression, opportunitySnapshot]
  );

  const handleSkillFeedback = useCallback(
    async (feedback) => {
      if (!skillQuestion?.session_exercise_id || skillFeedbackSaving) return;

      setSkillFeedbackSaving(true);
      setSkillFeedbackError('');

      try {
        await submitSkillTechnicalFeedback({
          sessionExerciseId: skillQuestion.session_exercise_id,
          feedback,
        });
        setSkillFeedback(feedback);
      } catch (feedbackError) {
        setSkillFeedbackError(feedbackError?.message ?? 'Impossible d’enregistrer ce retour.');
      } finally {
        setSkillFeedbackSaving(false);
      }
    },
    [skillFeedbackSaving, skillQuestion?.session_exercise_id]
  );

  async function handleNativeShare() {
    try {
      await Share.share({ message: shareText, title: 'Ma séance UGEROD' });
    } catch {
      // Le partage ne doit jamais bloquer le débrief.
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <View style={styles.heroTopRow}>
            <View style={styles.statusRow}>
              <View style={styles.statusDot} />
              <Text style={styles.statusText}>SÉANCE TERMINÉE</Text>
            </View>
            <Image source={brandIcon} style={styles.brandIcon} resizeMode="contain" />
          </View>

          <Text style={styles.heroTitle}>Bien joué.</Text>

          <View style={styles.heroStats}>
            <View style={styles.heroDuration}>
              <Text style={styles.heroDurationValue}>{duration}</Text>
              <Text style={styles.heroDurationUnit}>MIN</Text>
            </View>
            <View style={styles.heroStatsDivider} />
            <View style={styles.heroSummary}>
              <Text style={styles.heroEnvironment}>{environment.toUpperCase()}</Text>
              <Text style={styles.heroSummaryLine}>
                {blocks.length} {blocks.length > 1 ? 'BLOCS' : 'BLOC'} · {performedExercises.length} EXERCICE{performedExercises.length > 1 ? 'S' : ''}
              </Text>
              <View style={styles.heroCompletedRow}>
                <Ionicons name="checkmark-circle" size={15} color={colors.accent} />
                <Text style={styles.heroCompletedText}>Séance enregistrée</Text>
              </View>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>TA PERFORMANCE</Text>

          {performanceItems.length > 0 ? (
            <View style={styles.performanceList}>
              {performanceItems.map((item, index) => (
                <View key={`${item.block}-${item.name}-${index}`} style={styles.performanceItem}>
                  <View style={styles.performanceCopy}>
                    <Text style={styles.performanceBlock}>{item.block}</Text>
                    <Text numberOfLines={1} style={styles.performanceName}>{item.name}</Text>
                  </View>
                  <View style={styles.performanceValueWrap}>
                    <Text style={styles.performanceValue}>{item.value}</Text>
                    {item.meta ? <Text style={styles.performanceMeta}>{item.meta}</Text> : null}
                  </View>
                </View>
              ))}
            </View>
          ) : (
            <View style={styles.noPerformance}>
              <Ionicons name="pulse-outline" size={20} color={colors.textMuted} />
              <View style={styles.noPerformanceCopy}>
                <Text style={styles.noPerformanceTitle}>Pas de métrique forte à afficher</Text>
                <Text style={styles.noPerformanceText}>Ta séance est bien enregistrée. UGEROD n’invente pas une performance quand aucune mesure fiable n’a été saisie.</Text>
              </View>
            </View>
          )}
        </View>

        <View style={styles.sessionSection}>
          <View style={styles.sessionHeadingRow}>
            <View>
              <Text style={styles.sectionLabel}>TA SÉANCE</Text>
              <Text style={styles.sessionHeading}>{blocks.map((block) => block.label).join(' · ') || 'SÉANCE UGEROD'}</Text>
              <Text style={styles.sessionMeta}>{blocks.length} bloc{blocks.length > 1 ? 's' : ''} · {performedExercises.length} exercice{performedExercises.length > 1 ? 's' : ''} réalisé{performedExercises.length > 1 ? 's' : ''}</Text>
            </View>
            <Pressable
              onPress={() => setDetailsOpen((value) => !value)}
              style={({ pressed }) => [styles.inlineAction, pressed && styles.pressed]}
            >
              <Text style={styles.inlineActionText}>{detailsOpen ? 'Masquer' : 'Détail'}</Text>
              <Ionicons name={detailsOpen ? 'chevron-up' : 'chevron-down'} size={16} color={colors.accent} />
            </Pressable>
          </View>

          <View style={styles.blockRail}>
            {blocks.map((block) => (
              <View key={block.key} style={styles.blockRailItem}>
                <View style={styles.blockRailMarker} />
                <Text style={styles.blockRailLabel}>{block.label}</Text>
              </View>
            ))}
          </View>

          {detailsOpen ? (
            <View style={styles.sessionDetail}>
              {blocks.map((block) => (
                <View key={block.key} style={styles.sessionDetailBlock}>
                  <Text style={styles.sessionDetailLabel}>{block.label}</Text>
                  <Text style={styles.sessionDetailExercises}>
                    {block.exercises.map((exercise) => exercise.name).join(' · ')}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>

        <View style={styles.coachSection}>
          <View style={styles.coachAccent} />
          <View style={styles.coachHeader}>
            <View style={styles.coachIcon}>
              <Ionicons name={coachRecommendation.icon} size={20} color={colors.accent} />
            </View>
            <View style={styles.coachHeaderCopy}>
              <Text style={styles.sectionLabel}>COACH</Text>
              <Text style={styles.coachEyebrow}>{coachRecommendation.eyebrow}</Text>
            </View>
          </View>

          {coachLoading ? (
            <View style={styles.coachLoadingRow}>
              <ActivityIndicator size="small" color={colors.accent} />
              <Text style={styles.coachLoadingText}>Je prépare la suite…</Text>
            </View>
          ) : coachError ? (
            <View style={styles.coachError}>
              <Text style={styles.coachErrorText}>{coachError}</Text>
              <Pressable onPress={loadCoach}>
                <Text style={styles.coachRetry}>Réessayer</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <Text style={styles.coachTitle}>{coachRecommendation.title}</Text>
              <Text style={styles.coachText}>{coachRecommendation.text}</Text>
              <Pressable
                onPress={() => setWhyOpen((value) => !value)}
                style={({ pressed }) => [styles.whyButton, pressed && styles.pressed]}
              >
                <Text style={styles.whyButtonText}>{whyOpen ? 'Masquer' : 'Pourquoi ?'}</Text>
                <Ionicons name={whyOpen ? 'chevron-up' : 'arrow-forward'} size={15} color={colors.accent} />
              </Pressable>
              {whyOpen ? <Text style={styles.coachWhy}>{coachRecommendation.why}</Text> : null}
            </>
          )}
        </View>

        <SkillQuestionCard
          question={skillQuestion}
          value={skillFeedback}
          saving={skillFeedbackSaving}
          error={skillFeedbackError}
          onSelect={handleSkillFeedback}
          colors={colors}
          styles={styles}
        />

        <View style={styles.shareSection}>
          <View style={styles.shareHeader}>
            <View>
              <Text style={styles.sectionLabel}>PARTAGER MA SÉANCE</Text>
              <Text style={styles.shareTitle}>Ta séance, en un coup d’œil.</Text>
            </View>
            <Ionicons name="share-social-outline" size={20} color={colors.textSecondary} />
          </View>

          <Pressable
            onPress={() => setShareOpen(true)}
            style={({ pressed }) => [styles.sharePreview, pressed && styles.pressed]}
          >
            <View style={styles.sharePreviewPoster}>
              <View style={styles.sharePreviewAccent} />
              <Text style={styles.sharePreviewBrand}>UGEROD</Text>
              <Text style={styles.sharePreviewDuration}>{duration}</Text>
              <Text style={styles.sharePreviewMeta}>MIN · {environment.toUpperCase()}</Text>
              <Text numberOfLines={2} style={styles.sharePreviewResult}>
                {performanceItems[0]?.value ?? `${blocks.length} BLOCS`}
              </Text>
              <Text style={styles.sharePreviewResultMeta}>
                {performanceItems[0] ? `${performanceItems[0].block} · ${performanceItems[0].name}` : blocks.map((block) => block.label).join(' · ')}
              </Text>
            </View>

            <View style={styles.sharePreviewCopy}>
              <Text style={styles.sharePreviewTitle}>Story UGEROD</Text>
              <Text style={styles.sharePreviewText}>Durée, structure et résultat réel. Rien d’inventé.</Text>
              <Text style={styles.sharePreviewAction}>Voir l’aperçu</Text>
            </View>
            <Ionicons name="chevron-forward" size={19} color={colors.textSecondary} />
          </Pressable>
        </View>

        <Pressable
          onPress={() => router.replace('/(tabs)')}
          style={({ pressed }) => [styles.primaryButton, pressed && styles.primaryButtonPressed]}
        >
          <Text style={styles.primaryButtonText}>Terminer</Text>
          <Ionicons name="arrow-forward" size={20} color={colors.textOnAccent} />
        </Pressable>

        <Pressable
          onPress={() => router.replace('/(tabs)/progression')}
          style={({ pressed }) => [styles.progressionLink, pressed && styles.pressed]}
        >
          <Text style={styles.progressionLinkText}>Voir ma progression</Text>
          <Ionicons name="stats-chart-outline" size={18} color={colors.accent} />
        </Pressable>

        <View style={styles.bottomSpace} />
      </ScrollView>

      <Modal
        visible={shareOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setShareOpen(false)}
      >
        <View style={styles.modalRoot}>
          <Pressable style={styles.modalBackdrop} onPress={() => setShareOpen(false)} />
          <View style={styles.shareSheet}>
            <View style={styles.sheetHandle} />
            <View style={styles.shareSheetHeader}>
              <View>
                <Text style={styles.shareSheetEyebrow}>APERÇU STORY</Text>
                <Text style={styles.shareSheetTitle}>Ma séance.</Text>
              </View>
              <Pressable onPress={() => setShareOpen(false)} style={styles.closeButton}>
                <Ionicons name="close" size={20} color={colors.text} />
              </Pressable>
            </View>

            <View style={styles.storyFrame}>
              <StoryPreview
                workout={workout}
                performanceItems={performanceItems}
                blocks={blocks}
                styles={styles}
              />
            </View>

            <Pressable
              onPress={handleNativeShare}
              style={({ pressed }) => [styles.shareButton, pressed && styles.primaryButtonPressed]}
            >
              <Ionicons name="share-social-outline" size={20} color={colors.textOnAccent} />
              <Text style={styles.shareButtonText}>Partager</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function createStyles(colors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    content: {
      paddingHorizontal: 20,
      paddingTop: 8,
      paddingBottom: 30,
    },

    hero: {
      paddingTop: 6,
      paddingBottom: 28,
    },
    heroTopRow: {
      minHeight: 52,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    statusRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 7,
    },
    statusDot: {
      width: 7,
      height: 7,
      borderRadius: 4,
      backgroundColor: colors.accent,
    },
    statusText: {
      fontFamily: MANROPE.bold,
      fontSize: 9,
      lineHeight: 13,
      letterSpacing: 1.1,
      color: colors.textMuted,
    },
    brandIcon: { width: 42, height: 42 },
    heroTitle: {
      marginTop: 21,
      fontFamily: MANROPE.extraBold,
      fontSize: 27,
      lineHeight: 34,
      letterSpacing: -0.7,
      color: colors.text,
    },
    heroStats: {
      marginTop: 20,
      flexDirection: 'row',
      alignItems: 'center',
    },
    heroDuration: { minWidth: 88 },
    heroDurationValue: {
      fontFamily: 'BebasNeue_400Regular',
      fontSize: 68,
      lineHeight: 62,
      letterSpacing: 1.5,
      color: colors.text,
    },
    heroDurationUnit: {
      marginTop: -2,
      fontFamily: MANROPE.bold,
      fontSize: 9,
      letterSpacing: 1.3,
      color: colors.textMuted,
    },
    heroStatsDivider: {
      width: 1,
      height: 58,
      marginHorizontal: 18,
      backgroundColor: colors.borderStrong,
    },
    heroSummary: { flex: 1 },
    heroEnvironment: {
      fontFamily: MANROPE.extraBold,
      fontSize: 13,
      letterSpacing: 0.7,
      color: colors.text,
    },
    heroSummaryLine: {
      marginTop: 5,
      fontFamily: MANROPE.medium,
      fontSize: 11,
      lineHeight: 16,
      color: colors.textSecondary,
    },
    heroCompletedRow: {
      marginTop: 8,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
    },
    heroCompletedText: {
      fontFamily: MANROPE.semiBold,
      fontSize: 10,
      color: colors.textSecondary,
    },

    section: {
      paddingTop: 26,
      paddingBottom: 27,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    sectionLabel: {
      fontFamily: MANROPE.bold,
      fontSize: 9,
      lineHeight: 13,
      letterSpacing: 1.25,
      color: colors.textMuted,
    },
    microLabel: {
      fontFamily: MANROPE.bold,
      fontSize: 8,
      lineHeight: 12,
      letterSpacing: 0.9,
      color: colors.textMuted,
    },
    performanceList: { marginTop: 13 },
    performanceItem: {
      minHeight: 86,
      paddingVertical: 13,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    performanceCopy: { flex: 1, minWidth: 0 },
    performanceBlock: {
      fontFamily: MANROPE.bold,
      fontSize: 8,
      lineHeight: 12,
      letterSpacing: 1,
      color: colors.accent,
    },
    performanceName: {
      marginTop: 5,
      fontFamily: MANROPE.bold,
      fontSize: 14,
      lineHeight: 19,
      color: colors.text,
    },
    performanceValueWrap: {
      minWidth: 104,
      alignItems: 'flex-end',
    },
    performanceValue: {
      fontFamily: 'BebasNeue_400Regular',
      fontSize: 34,
      lineHeight: 34,
      letterSpacing: 0.8,
      color: colors.text,
    },
    performanceMeta: {
      marginTop: 2,
      fontFamily: MANROPE.bold,
      fontSize: 7.5,
      letterSpacing: 0.85,
      color: colors.textMuted,
    },
    noPerformance: {
      marginTop: 17,
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 12,
    },
    noPerformanceCopy: { flex: 1 },
    noPerformanceTitle: {
      fontFamily: MANROPE.bold,
      fontSize: 14,
      lineHeight: 19,
      color: colors.text,
    },
    noPerformanceText: {
      marginTop: 4,
      fontFamily: MANROPE.regular,
      fontSize: 11,
      lineHeight: 17,
      color: colors.textSecondary,
    },

    sessionSection: {
      paddingTop: 27,
      paddingBottom: 29,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    sessionHeadingRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: 14,
    },
    sessionHeading: {
      maxWidth: 280,
      marginTop: 6,
      fontFamily: MANROPE.extraBold,
      fontSize: 20,
      lineHeight: 26,
      letterSpacing: -0.35,
      color: colors.text,
    },
    sessionMeta: {
      marginTop: 5,
      fontFamily: MANROPE.medium,
      fontSize: 11,
      lineHeight: 16,
      color: colors.textSecondary,
    },
    inlineAction: {
      minHeight: 34,
      paddingHorizontal: 10,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    inlineActionText: {
      fontFamily: MANROPE.bold,
      fontSize: 10,
      color: colors.accent,
    },
    blockRail: {
      marginTop: 21,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    blockRailItem: { flex: 1, minWidth: 0 },
    blockRailMarker: {
      height: 5,
      borderRadius: 3,
      backgroundColor: colors.accent,
      opacity: 0.82,
    },
    blockRailLabel: {
      marginTop: 6,
      fontFamily: MANROPE.bold,
      fontSize: 7,
      letterSpacing: 0.7,
      color: colors.textMuted,
    },
    sessionDetail: {
      marginTop: 20,
      paddingTop: 4,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    sessionDetailBlock: { paddingTop: 14 },
    sessionDetailLabel: {
      fontFamily: MANROPE.bold,
      fontSize: 8,
      letterSpacing: 0.9,
      color: colors.accent,
    },
    sessionDetailExercises: {
      marginTop: 5,
      fontFamily: MANROPE.medium,
      fontSize: 11,
      lineHeight: 17,
      color: colors.text,
    },

    coachSection: {
      position: 'relative',
      marginHorizontal: -20,
      paddingHorizontal: 20,
      paddingTop: 25,
      paddingBottom: 26,
      backgroundColor: colors.surface,
      borderTopWidth: 1,
      borderBottomWidth: 1,
      borderColor: colors.border,
      overflow: 'hidden',
    },
    coachAccent: {
      position: 'absolute',
      left: 0,
      top: 0,
      bottom: 0,
      width: 4,
      backgroundColor: colors.secondaryAccent,
    },
    coachHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 11,
    },
    coachIcon: {
      width: 38,
      height: 38,
      borderRadius: 19,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.accentSoft,
    },
    coachHeaderCopy: { flex: 1 },
    coachEyebrow: {
      marginTop: 2,
      fontFamily: MANROPE.bold,
      fontSize: 9,
      lineHeight: 13,
      letterSpacing: 0.9,
      color: colors.accent,
    },
    coachLoadingRow: {
      marginTop: 20,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 9,
    },
    coachLoadingText: {
      fontFamily: MANROPE.medium,
      fontSize: 12,
      color: colors.textSecondary,
    },
    coachError: { marginTop: 18 },
    coachErrorText: {
      fontFamily: MANROPE.regular,
      fontSize: 11,
      lineHeight: 17,
      color: colors.textSecondary,
    },
    coachRetry: {
      marginTop: 8,
      fontFamily: MANROPE.bold,
      fontSize: 10,
      color: colors.accent,
    },
    coachTitle: {
      marginTop: 18,
      maxWidth: 320,
      fontFamily: MANROPE.extraBold,
      fontSize: 24,
      lineHeight: 30,
      letterSpacing: -0.55,
      color: colors.text,
    },
    coachText: {
      maxWidth: 335,
      marginTop: 8,
      fontFamily: MANROPE.medium,
      fontSize: 13,
      lineHeight: 20,
      color: colors.text,
    },
    whyButton: {
      alignSelf: 'flex-start',
      marginTop: 16,
      minHeight: 32,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
    },
    whyButtonText: {
      fontFamily: MANROPE.bold,
      fontSize: 10,
      color: colors.accent,
    },
    coachWhy: {
      maxWidth: 330,
      marginTop: 8,
      fontFamily: MANROPE.regular,
      fontSize: 10.5,
      lineHeight: 16,
      color: colors.textSecondary,
    },

    questionSection: {
      paddingTop: 24,
      paddingBottom: 24,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    questionHeader: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 11,
    },
    questionIcon: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.accentSoft,
    },
    questionMain: { flex: 1 },
    questionTitle: {
      marginTop: 5,
      fontFamily: MANROPE.bold,
      fontSize: 13,
      lineHeight: 18,
      color: colors.text,
    },
    optionRow: {
      marginTop: 14,
      flexDirection: 'row',
      gap: 7,
    },
    optionButton: {
      flex: 1,
      minHeight: 40,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 6,
      backgroundColor: colors.surfaceElevated,
    },
    optionButtonSelected: {
      borderColor: colors.accent,
      backgroundColor: colors.accentSoft,
    },
    optionText: {
      fontFamily: MANROPE.bold,
      fontSize: 9,
      color: colors.textMuted,
    },
    optionTextSelected: { color: colors.text },
    questionStatus: {
      marginTop: 10,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 7,
    },
    questionStatusText: {
      fontFamily: MANROPE.semiBold,
      fontSize: 9,
      color: colors.textMuted,
    },
    questionError: {
      marginTop: 9,
      fontFamily: MANROPE.regular,
      fontSize: 9,
      color: colors.error,
    },

    shareSection: {
      paddingTop: 29,
      paddingBottom: 7,
    },
    shareHeader: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      justifyContent: 'space-between',
      gap: 12,
    },
    shareTitle: {
      marginTop: 6,
      fontFamily: MANROPE.extraBold,
      fontSize: 20,
      lineHeight: 25,
      letterSpacing: -0.4,
      color: colors.text,
    },
    sharePreview: {
      marginTop: 16,
      minHeight: 158,
      padding: 11,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 13,
    },
    sharePreviewPoster: {
      position: 'relative',
      width: 96,
      height: 136,
      borderRadius: 15,
      overflow: 'hidden',
      paddingHorizontal: 11,
      paddingVertical: 10,
      backgroundColor: '#11140F',
    },
    sharePreviewAccent: {
      position: 'absolute',
      left: 0,
      top: 0,
      bottom: 0,
      width: 4,
      backgroundColor: '#FF6B19',
    },
    sharePreviewBrand: {
      fontFamily: 'BebasNeue_400Regular',
      fontSize: 16,
      letterSpacing: 1.1,
      color: '#FFFFFF',
    },
    sharePreviewDuration: {
      marginTop: 18,
      fontFamily: 'BebasNeue_400Regular',
      fontSize: 35,
      lineHeight: 34,
      color: '#FFFFFF',
    },
    sharePreviewMeta: {
      marginTop: 1,
      fontFamily: MANROPE.bold,
      fontSize: 6,
      letterSpacing: 0.7,
      color: '#BFC6B9',
    },
    sharePreviewResult: {
      marginTop: 13,
      fontFamily: 'BebasNeue_400Regular',
      fontSize: 16,
      lineHeight: 17,
      color: '#FF6B19',
    },
    sharePreviewResultMeta: {
      marginTop: 2,
      fontFamily: MANROPE.bold,
      fontSize: 5.5,
      lineHeight: 8,
      color: '#FFFFFF',
    },
    sharePreviewCopy: { flex: 1 },
    sharePreviewTitle: {
      fontFamily: MANROPE.bold,
      fontSize: 14,
      lineHeight: 19,
      color: colors.text,
    },
    sharePreviewText: {
      marginTop: 5,
      fontFamily: MANROPE.regular,
      fontSize: 11,
      lineHeight: 16,
      color: colors.textSecondary,
    },
    sharePreviewAction: {
      marginTop: 12,
      fontFamily: MANROPE.bold,
      fontSize: 10,
      color: colors.accent,
    },

    primaryButton: {
      minHeight: 56,
      marginTop: 24,
      borderRadius: 16,
      backgroundColor: colors.accent,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 9,
    },
    primaryButtonPressed: { transform: [{ scale: 0.985 }] },
    primaryButtonText: {
      fontFamily: MANROPE.bold,
      fontSize: 15,
      color: colors.textOnAccent,
    },
    progressionLink: {
      minHeight: 48,
      marginTop: 4,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
    },
    progressionLinkText: {
      fontFamily: MANROPE.semiBold,
      fontSize: 11,
      color: colors.textSecondary,
    },

    modalRoot: { flex: 1, justifyContent: 'flex-end' },
    modalBackdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: 'rgba(0,0,0,0.68)',
    },
    shareSheet: {
      maxHeight: '94%',
      paddingHorizontal: 20,
      paddingTop: 8,
      paddingBottom: 22,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      backgroundColor: colors.background,
      borderWidth: 1,
      borderColor: colors.border,
    },
    sheetHandle: {
      width: 42,
      height: 4,
      borderRadius: 2,
      alignSelf: 'center',
      backgroundColor: colors.borderStrong,
      marginBottom: 14,
    },
    shareSheetHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
    },
    shareSheetEyebrow: {
      fontFamily: MANROPE.bold,
      fontSize: 9,
      letterSpacing: 0.8,
      color: colors.accent,
    },
    shareSheetTitle: {
      marginTop: 3,
      fontFamily: MANROPE.extraBold,
      fontSize: 21,
      lineHeight: 26,
      color: colors.text,
    },
    closeButton: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    storyFrame: {
      alignSelf: 'center',
      width: '68%',
      maxWidth: 290,
      aspectRatio: 9 / 16,
      marginTop: 16,
      borderRadius: 22,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: '#2D3229',
    },
    storyCard: {
      flex: 1,
      position: 'relative',
      paddingHorizontal: 18,
      paddingTop: 21,
      paddingBottom: 17,
      backgroundColor: '#11140F',
    },
    storyAccentTop: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      height: 5,
      backgroundColor: '#FF6B19',
    },
    storyTopRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
    },
    storyBrand: {
      fontFamily: 'BebasNeue_400Regular',
      fontSize: 30,
      lineHeight: 31,
      letterSpacing: 1.6,
      color: '#FFFFFF',
    },
    storyDate: {
      marginTop: 3,
      fontFamily: MANROPE.bold,
      fontSize: 7,
      letterSpacing: 0.8,
      color: '#AEB6A7',
    },
    storySessionMeta: {
      marginTop: 33,
      flexDirection: 'row',
      alignItems: 'flex-end',
    },
    storyDuration: {
      fontFamily: 'BebasNeue_400Regular',
      fontSize: 76,
      lineHeight: 67,
      letterSpacing: 1.6,
      color: '#FFFFFF',
    },
    storyDurationCopy: {
      marginLeft: 8,
      paddingBottom: 7,
    },
    storyDurationUnit: {
      fontFamily: MANROPE.extraBold,
      fontSize: 8,
      letterSpacing: 1,
      color: '#FF6B19',
    },
    storyEnvironment: {
      marginTop: 3,
      fontFamily: MANROPE.bold,
      fontSize: 7,
      letterSpacing: 0.8,
      color: '#FFFFFF',
    },
    storyBlocksLine: {
      marginTop: 9,
      fontFamily: MANROPE.bold,
      fontSize: 7,
      lineHeight: 11,
      letterSpacing: 0.6,
      color: '#AEB6A7',
    },
    storyPerformanceZone: {
      flex: 1,
      marginTop: 30,
      justifyContent: 'center',
    },
    storyPerformanceLabel: {
      fontFamily: MANROPE.bold,
      fontSize: 7,
      lineHeight: 11,
      letterSpacing: 0.85,
      color: '#BFC6B9',
    },
    storyPerformanceValue: {
      marginTop: 7,
      fontFamily: 'BebasNeue_400Regular',
      fontSize: 49,
      lineHeight: 47,
      letterSpacing: 1.1,
      color: '#FF6B19',
    },
    storyPerformanceMeta: {
      marginTop: 4,
      fontFamily: MANROPE.bold,
      fontSize: 8,
      letterSpacing: 0.9,
      color: '#FFFFFF',
    },
    storySecondaryPerformance: {
      marginTop: 24,
      paddingTop: 15,
      borderTopWidth: 1,
      borderTopColor: '#30362D',
    },
    storySecondaryLabel: {
      fontFamily: MANROPE.semiBold,
      fontSize: 7,
      color: '#BFC6B9',
    },
    storySecondaryValue: {
      marginTop: 4,
      fontFamily: 'BebasNeue_400Regular',
      fontSize: 24,
      lineHeight: 25,
      color: '#FFFFFF',
    },
    storyFooter: {
      paddingTop: 12,
      borderTopWidth: 1,
      borderTopColor: '#30362D',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 7,
    },
    storyFooterMark: {
      width: 18,
      height: 4,
      borderRadius: 2,
      backgroundColor: '#646F5E',
    },
    storyFooterText: {
      fontFamily: MANROPE.bold,
      fontSize: 6.5,
      letterSpacing: 0.9,
      color: '#AEB6A7',
    },
    shareButton: {
      minHeight: 54,
      marginTop: 16,
      borderRadius: 15,
      backgroundColor: colors.accent,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
    },
    shareButtonText: {
      fontFamily: MANROPE.bold,
      fontSize: 15,
      color: colors.textOnAccent,
    },

    bottomSpace: { height: 20 },
    pressed: { opacity: 0.72 },
  });
}
