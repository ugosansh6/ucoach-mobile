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

function plural(value, singular, pluralForm = `${singular}s`) {
  return Number(value) > 1 ? pluralForm : singular;
}

function joinNames(names) {
  const clean = names.filter(Boolean);
  if (clean.length <= 1) return clean[0] ?? '';
  if (clean.length === 2) return `${clean[0]} et ${clean[1]}`;
  return `${clean.slice(0, -1).join(', ')} et ${clean[clean.length - 1]}`;
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

function storyBlocksFromWorkout(workout) {
  const exercises = Array.isArray(workout?.exercises) ? workout.exercises : [];
  const grouped = new Map();

  exercises.forEach((exercise) => {
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
      prescription: exercise?.prescription ?? exercise?.prescriptionText ?? '',
    });
  });

  return [...grouped.values()]
    .sort((a, b) => a.order - b.order)
    .map((block) => ({ ...block, exercises: block.exercises.slice(0, 5) }));
}

function wodResultLine(runtime) {
  if (!runtime?.started) return null;

  const elapsed = Number(runtime?.elapsedSeconds ?? 0);
  const rounds = Number(runtime?.completedRounds ?? 0);
  const reps = Number(runtime?.reps ?? runtime?.repsCompleted ?? runtime?.totalReps ?? 0);

  if (rounds > 0 && reps > 0) return `${rounds} rounds + ${reps} reps`;
  if (rounds > 0) return `${rounds} round${rounds > 1 ? 's' : ''}`;
  if (elapsed > 0) {
    return `${Math.floor(elapsed / 60)}:${String(Math.floor(elapsed % 60)).padStart(2, '0')}`;
  }
  return null;
}

function buildShareText(workout, blocks) {
  const environment = ENVIRONMENT_LABELS[sessionEnvironment(workout)] ?? sessionEnvironment(workout);
  const duration = `${actualDurationMinutes(workout)} min`;
  const lines = ['UGEROD', `${environment} · ${duration}`, ''];

  blocks.forEach((block) => {
    lines.push(block.label);
    block.exercises.forEach((exercise) => {
      lines.push(`• ${exercise.name}${exercise.prescription ? ` — ${exercise.prescription}` : ''}`);
    });

    if (block.key === 'wod') {
      const result = wodResultLine(workout?.wodRuntime);
      if (result) lines.push(`Résultat : ${result}`);
    }
    lines.push('');
  });

  return lines.join('\n').trim();
}

function buildPerformanceSignal(snapshot, progression) {
  const summary = snapshot?.summary ?? {};
  const references = Number(summary.reference_observations ?? 0);
  const observations = Array.isArray(snapshot?.observations)
    ? snapshot.observations
    : [];
  const movements = Array.isArray(progression?.movement_capabilities)
    ? progression.movement_capabilities
    : [];

  const progressing = movements.find((item) => item?.signal === 'PROGRESSING');
  const recalibrating = movements.find((item) => item?.signal === 'RECALIBRATING');
  const currentWeek = progression?.activity?.current_week ?? {};

  if (progressing?.name) {
    return {
      eyebrow: 'PROGRESSION DÉTECTÉE',
      title: progressing.name,
      text: 'Tes dernières références comparables montrent une évolution positive.',
      icon: 'trending-up-outline',
    };
  }

  if (references > 0) {
    const referenceNames = observations
      .filter((item) =>
        ['MEASURABLE_REFERENCE', 'CONTEXTUAL_REFERENCE'].includes(item?.proof_class)
      )
      .map((item) => item?.exercise_name)
      .filter(Boolean)
      .slice(0, 2);

    return {
      eyebrow: 'NOUVELLE RÉFÉRENCE',
      title:
        referenceNames.length > 0
          ? joinNames(referenceNames)
          : `${references} ${plural(references, 'référence')} exploitable${references > 1 ? 's' : ''}`,
      text: 'Cette séance ajoute une nouvelle base de comparaison à ton historique.',
      icon: 'analytics-outline',
    };
  }

  if (
    Number(currentWeek?.target_sessions ?? 0) > 0 &&
    Number(currentWeek?.realized_sessions ?? 0) >= Number(currentWeek?.target_sessions ?? 0)
  ) {
    return {
      eyebrow: 'OBJECTIF DE LA SEMAINE',
      title: 'Régularité confirmée',
      text: `${currentWeek.realized_sessions} séance${Number(currentWeek.realized_sessions) > 1 ? 's' : ''} réalisée${Number(currentWeek.realized_sessions) > 1 ? 's' : ''} cette semaine.`,
      icon: 'calendar-outline',
    };
  }

  if (recalibrating?.name) {
    return {
      eyebrow: 'PROFIL AFFINÉ',
      title: recalibrating.name,
      text: 'Cette séance aide UGEROD à recalibrer ta référence proprement.',
      icon: 'options-outline',
    };
  }

  return {
    eyebrow: 'UNE MARCHE DE PLUS',
    title: 'Séance consolidée',
    text: 'Elle enrichit ton historique et construit une base plus solide pour la suite.',
    icon: 'footsteps-outline',
  };
}

function buildLearningText(snapshot) {
  const summary = snapshot?.summary ?? {};
  const references = Number(summary.reference_observations ?? 0);
  const stateSignals = Number(summary.state_signal_observations ?? 0);
  const observations = Array.isArray(snapshot?.observations)
    ? snapshot.observations
    : [];

  const environmentIssue = observations.some(
    (item) => item?.execution_reason_code === 'ENVIRONMENT_MISMATCH'
  );

  if (environmentIssue) {
    return 'Une partie de la séance a été limitée par ton environnement. UGEROD garde ce contexte séparé de ton niveau physique.';
  }

  const missingNames = observations
    .filter((item) => item?.proof_class === 'MISSING_METRIC')
    .map((item) => item?.exercise_name)
    .filter(Boolean)
    .slice(0, 2);

  if (references > 0 && missingNames.length > 0) {
    return `${references} ${plural(references, 'mouvement')} ont produit une référence exploitable. ${joinNames(missingNames)} restent à consolider.`;
  }

  if (references > 0) {
    return `${references} ${plural(references, 'mouvement')} ont produit une référence exploitable pour calibrer la suite.`;
  }

  if (stateSignals > 0) {
    return 'UGEROD a surtout retenu ton état et le déroulement de la séance pour mieux adapter les prochaines décisions.';
  }

  return 'Cette séance enrichit ton historique sans créer artificiellement une nouvelle référence.';
}

function SkillQuestionCard({ question, value, saving, error, onSelect, colors, styles }) {
  if (!question?.should_ask) return null;

  const options = Array.isArray(question.options)
    ? question.options
    : ['PROPRE', 'LIMITE', 'PAS_ENCORE'];

  return (
    <View style={styles.questionCard}>
      <View style={styles.questionHeader}>
        <View style={styles.questionIcon}>
          <Ionicons name="eye-outline" size={19} color={colors.accent} />
        </View>
        <View style={styles.questionMain}>
          <Text style={styles.questionEyebrow}>UNE INFO À CONFIRMER</Text>
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

function StoryPreview({ workout, blocks, styles }) {
  const environment = ENVIRONMENT_LABELS[sessionEnvironment(workout)] ?? sessionEnvironment(workout);
  const result = wodResultLine(workout?.wodRuntime);

  return (
    <View style={styles.storyCard}>
      <View>
        <Text style={styles.storyBrand}>UGEROD</Text>
        <View style={styles.storyRule} />
        <Text style={styles.storyMeta}>
          {environment} · {actualDurationMinutes(workout)} MIN
        </Text>
      </View>

      <View style={styles.storyBlocks}>
        {blocks.length > 0 ? (
          blocks.map((block) => (
            <View key={block.key} style={styles.storyBlock}>
              <Text style={styles.storyBlockLabel}>{block.label}</Text>
              {block.exercises.map((exercise, index) => (
                <View key={`${block.key}-${index}`} style={styles.storyExercise}>
                  <Text numberOfLines={1} style={styles.storyExerciseName}>
                    {exercise.name}
                  </Text>
                  {exercise.prescription ? (
                    <Text numberOfLines={1} style={styles.storyExercisePrescription}>
                      {exercise.prescription}
                    </Text>
                  ) : null}
                </View>
              ))}
              {block.key === 'wod' && result ? (
                <View style={styles.storyResult}>
                  <Text style={styles.storyResultLabel}>RÉSULTAT</Text>
                  <Text style={styles.storyResultValue}>{result}</Text>
                </View>
              ) : null}
            </View>
          ))
        ) : (
          <View style={styles.storyEmpty}>
            <Text style={styles.storyEmptyText}>Séance enregistrée</Text>
          </View>
        )}
      </View>

      <View style={styles.storyFooter}>
        <Text style={styles.storyFooterText}>UGEROD</Text>
      </View>
    </View>
  );
}

export default function WorkoutDebriefScreen() {
  const params = useLocalSearchParams();
  const sessionId = firstParam(params?.sessionId);
  const { workout } = useWorkout();
  const { colors, isDark } = useUgerodTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const brandIcon = isDark ? darkBrandIcon : lightBrandIcon;

  const [snapshot, setSnapshot] = useState(null);
  const [progression, setProgression] = useState(null);
  const [skillQuestion, setSkillQuestion] = useState(null);
  const [skillFeedback, setSkillFeedback] = useState(null);
  const [skillFeedbackSaving, setSkillFeedbackSaving] = useState(false);
  const [skillFeedbackError, setSkillFeedbackError] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [shareOpen, setShareOpen] = useState(false);

  const shareBlocks = useMemo(() => storyBlocksFromWorkout(workout), [workout]);
  const shareText = useMemo(() => buildShareText(workout, shareBlocks), [workout, shareBlocks]);
  const environment = ENVIRONMENT_LABELS[sessionEnvironment(workout)] ?? sessionEnvironment(workout);
  const duration = actualDurationMinutes(workout);
  const wodResult = wodResultLine(workout?.wodRuntime);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      if (!sessionId) throw new Error('Session manquante pour le débrief Coach.');

      const [sessionLearning, progressionData, questionNeed] = await Promise.all([
        getSessionLearningSnapshot(sessionId),
        getProgressionDataContract('4w'),
        getObservationQuestionNeed(sessionId, 'SKILL_TECHNICAL_QUALITY').catch(() => ({
          should_ask: false,
          reason: 'QUESTION_UNAVAILABLE',
        })),
      ]);

      setSnapshot(sessionLearning);
      setProgression(progressionData);
      setSkillQuestion(questionNeed);
    } catch (loadError) {
      setError(
        loadError?.message ??
          "La séance est enregistrée, mais l'analyse Coach n'est pas disponible pour l'instant."
      );
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    load();
  }, [load]);

  const performanceSignal = useMemo(
    () => buildPerformanceSignal(snapshot, progression),
    [snapshot, progression]
  );
  const learningText = useMemo(() => buildLearningText(snapshot), [snapshot]);

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
        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text style={styles.eyebrow}>Séance validée</Text>
            <Text style={styles.title}>
              Bien joué<Text style={styles.dot}>.</Text>
            </Text>
          </View>
          <Image source={brandIcon} style={styles.brandIcon} resizeMode="contain" />
        </View>

        <View style={styles.summaryStrip}>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryValue}>{duration}</Text>
            <Text style={styles.summaryLabel}>MIN</Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryCopy}>
            <Text style={styles.summaryEnvironment}>{environment}</Text>
            {wodResult ? <Text style={styles.summaryResult}>{wodResult}</Text> : null}
          </View>
          <Ionicons name="checkmark-circle" size={22} color={colors.accent} />
        </View>

        {loading ? (
          <View style={styles.loadingCard}>
            <ActivityIndicator color={colors.accent} />
            <Text style={styles.loadingText}>Analyse de ta séance…</Text>
          </View>
        ) : error ? (
          <View style={styles.errorCard}>
            <Ionicons name="information-circle-outline" size={21} color={colors.textSecondary} />
            <View style={styles.errorMain}>
              <Text style={styles.errorTitle}>Analyse temporairement indisponible</Text>
              <Text style={styles.errorText}>{error}</Text>
              <Pressable onPress={load} style={styles.retryButton}>
                <Text style={styles.retryText}>Réessayer</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <>
            <View style={styles.progressCard}>
              <View style={styles.progressIcon}>
                <Ionicons name={performanceSignal.icon} size={22} color={colors.accent} />
              </View>
              <Text style={styles.progressEyebrow}>{performanceSignal.eyebrow}</Text>
              <Text style={styles.progressTitle}>{performanceSignal.title}</Text>
              <Text style={styles.progressText}>{performanceSignal.text}</Text>
              <View style={styles.progressFooter}>
                <View style={styles.progressStep} />
                <Text style={styles.progressFooterText}>Une marche de plus dans ta progression</Text>
              </View>
            </View>

            <View style={styles.learningCard}>
              <Text style={styles.learningTitle}>Ce qu’UGEROD retient</Text>
              <Text style={styles.learningText}>{learningText}</Text>
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
          </>
        )}

        <Text style={styles.sectionTitle}>Partager ma séance</Text>

        <Pressable
          onPress={() => setShareOpen(true)}
          style={({ pressed }) => [styles.shareCard, pressed && styles.pressed]}
        >
          <View style={styles.shareMiniStory}>
            <Text style={styles.shareMiniBrand}>UGEROD</Text>
            <View style={styles.shareMiniRule} />
            <Text style={styles.shareMiniBlocks} numberOfLines={3}>
              {shareBlocks.map((block) => block.label).join('\n') || 'SÉANCE'}
            </Text>
          </View>
          <View style={styles.shareMain}>
            <Text style={styles.shareTitle}>Story UGEROD</Text>
            <Text style={styles.shareText}>Skill, Force, Tabata, WOD et résultat. Rien de plus.</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
        </Pressable>

        <Pressable
          onPress={() => router.replace('/(tabs)')}
          style={({ pressed }) => [styles.primaryButton, pressed && styles.primaryButtonPressed]}
        >
          <Text style={styles.primaryButtonText}>Terminer</Text>
          <Ionicons name="arrow-forward" size={20} color={colors.textOnAccent} />
        </Pressable>

        <Pressable
          onPress={() => router.replace('/(tabs)/progression')}
          style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
        >
          <Ionicons name="stats-chart-outline" size={19} color={colors.accent} />
          <Text style={styles.secondaryButtonText}>Voir ma progression</Text>
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
                <Text style={styles.shareSheetTitle}>Ta séance.</Text>
              </View>
              <Pressable onPress={() => setShareOpen(false)} style={styles.closeButton}>
                <Ionicons name="close" size={20} color={colors.text} />
              </Pressable>
            </View>

            <View style={styles.storyFrame}>
              <StoryPreview workout={workout} blocks={shareBlocks} styles={styles} />
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
    header: {
      minHeight: 92,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    headerText: { flex: 1 },
    eyebrow: {
      fontFamily: MANROPE.medium,
      fontSize: 12,
      lineHeight: 16,
      color: colors.textSecondary,
    },
    title: {
      marginTop: 1,
      fontFamily: MANROPE.extraBold,
      fontSize: 38,
      lineHeight: 43,
      letterSpacing: -1.1,
      color: colors.text,
    },
    dot: { color: colors.accent },
    brandIcon: { width: 46, height: 46 },

    summaryStrip: {
      minHeight: 68,
      paddingHorizontal: 14,
      borderRadius: 17,
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    summaryItem: { minWidth: 52 },
    summaryValue: {
      fontFamily: 'BebasNeue_400Regular',
      fontSize: 31,
      lineHeight: 31,
      color: colors.text,
    },
    summaryLabel: {
      marginTop: -1,
      fontFamily: MANROPE.bold,
      fontSize: 7,
      letterSpacing: 0.8,
      color: colors.textMuted,
    },
    summaryDivider: {
      width: 1,
      height: 34,
      marginHorizontal: 13,
      backgroundColor: colors.border,
    },
    summaryCopy: { flex: 1 },
    summaryEnvironment: {
      fontFamily: MANROPE.bold,
      fontSize: 13,
      color: colors.text,
    },
    summaryResult: {
      marginTop: 2,
      fontFamily: MANROPE.medium,
      fontSize: 10,
      color: colors.textSecondary,
    },

    loadingCard: {
      minHeight: 150,
      marginTop: 18,
      borderRadius: 20,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
    },
    loadingText: {
      fontFamily: MANROPE.semiBold,
      fontSize: 11,
      color: colors.textSecondary,
    },

    progressCard: {
      marginTop: 18,
      padding: 18,
      borderRadius: 22,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.accent,
    },
    progressIcon: {
      width: 42,
      height: 42,
      borderRadius: 13,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.accentSoft,
    },
    progressEyebrow: {
      marginTop: 18,
      fontFamily: MANROPE.bold,
      fontSize: 9,
      letterSpacing: 0.9,
      color: colors.accent,
    },
    progressTitle: {
      marginTop: 4,
      fontFamily: 'BebasNeue_400Regular',
      fontSize: 34,
      lineHeight: 37,
      letterSpacing: 1,
      color: colors.text,
    },
    progressText: {
      marginTop: 5,
      fontFamily: MANROPE.regular,
      fontSize: 12,
      lineHeight: 18,
      color: colors.textSecondary,
    },
    progressFooter: {
      marginTop: 18,
      paddingTop: 13,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    progressStep: {
      width: 24,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.secondaryAccent,
    },
    progressFooterText: {
      flex: 1,
      fontFamily: MANROPE.semiBold,
      fontSize: 10,
      color: colors.textSecondary,
    },

    learningCard: {
      marginTop: 10,
      padding: 15,
      borderRadius: 17,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    learningTitle: {
      fontFamily: MANROPE.bold,
      fontSize: 12,
      color: colors.text,
    },
    learningText: {
      marginTop: 5,
      fontFamily: MANROPE.regular,
      fontSize: 11,
      lineHeight: 17,
      color: colors.textSecondary,
    },

    questionCard: {
      marginTop: 10,
      padding: 15,
      borderRadius: 17,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    questionHeader: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 11,
    },
    questionIcon: {
      width: 38,
      height: 38,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.accentSoft,
    },
    questionMain: { flex: 1 },
    questionEyebrow: {
      fontFamily: MANROPE.bold,
      fontSize: 8,
      letterSpacing: 0.8,
      color: colors.accent,
    },
    questionTitle: {
      marginTop: 4,
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

    sectionTitle: {
      marginTop: 25,
      fontFamily: MANROPE.bold,
      fontSize: 18,
      lineHeight: 24,
      color: colors.text,
    },
    shareCard: {
      marginTop: 11,
      minHeight: 92,
      padding: 12,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    shareMiniStory: {
      width: 48,
      height: 68,
      borderRadius: 11,
      padding: 7,
      backgroundColor: colors.background,
      borderWidth: 1,
      borderColor: colors.border,
    },
    shareMiniBrand: {
      fontFamily: 'BebasNeue_400Regular',
      fontSize: 11,
      letterSpacing: 0.6,
      color: colors.text,
    },
    shareMiniRule: {
      width: 14,
      height: 2,
      marginTop: 3,
      borderRadius: 1,
      backgroundColor: colors.accent,
    },
    shareMiniBlocks: {
      marginTop: 7,
      fontFamily: MANROPE.bold,
      fontSize: 5.5,
      lineHeight: 8,
      color: colors.textSecondary,
    },
    shareMain: { flex: 1 },
    shareTitle: {
      fontFamily: MANROPE.bold,
      fontSize: 13,
      color: colors.text,
    },
    shareText: {
      marginTop: 4,
      fontFamily: MANROPE.regular,
      fontSize: 11,
      lineHeight: 16,
      color: colors.textSecondary,
    },

    primaryButton: {
      minHeight: 56,
      marginTop: 22,
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
    secondaryButton: {
      minHeight: 50,
      marginTop: 10,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
    },
    secondaryButtonText: {
      fontFamily: MANROPE.bold,
      fontSize: 12,
      color: colors.accent,
    },

    errorCard: {
      marginTop: 18,
      padding: 15,
      borderRadius: 17,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 11,
    },
    errorMain: { flex: 1 },
    errorTitle: {
      fontFamily: MANROPE.bold,
      fontSize: 11,
      color: colors.text,
    },
    errorText: {
      marginTop: 4,
      fontFamily: MANROPE.regular,
      fontSize: 10,
      lineHeight: 16,
      color: colors.textSecondary,
    },
    retryButton: {
      alignSelf: 'flex-start',
      marginTop: 10,
      minHeight: 34,
      paddingHorizontal: 12,
      borderRadius: 17,
      borderWidth: 1,
      borderColor: colors.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
    retryText: {
      fontFamily: MANROPE.bold,
      fontSize: 10,
      color: colors.accent,
    },

    modalRoot: { flex: 1, justifyContent: 'flex-end' },
    modalBackdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: 'rgba(0,0,0,0.62)',
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
      fontSize: 20,
      lineHeight: 25,
      color: colors.text,
    },
    closeButton: {
      width: 38,
      height: 38,
      borderRadius: 19,
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
      borderColor: colors.border,
    },
    storyCard: {
      flex: 1,
      paddingHorizontal: 18,
      paddingTop: 20,
      paddingBottom: 16,
      backgroundColor: colors.background,
    },
    storyBrand: {
      fontFamily: 'BebasNeue_400Regular',
      fontSize: 28,
      lineHeight: 31,
      letterSpacing: 1.5,
      color: colors.text,
    },
    storyRule: {
      width: 36,
      height: 4,
      borderRadius: 2,
      marginTop: 7,
      backgroundColor: colors.accent,
    },
    storyMeta: {
      marginTop: 8,
      fontFamily: MANROPE.bold,
      fontSize: 8,
      letterSpacing: 0.5,
      color: colors.textSecondary,
    },
    storyBlocks: {
      flex: 1,
      marginTop: 18,
      gap: 12,
    },
    storyBlock: {},
    storyBlockLabel: {
      fontFamily: MANROPE.bold,
      fontSize: 8,
      letterSpacing: 1,
      color: colors.secondaryAccent,
    },
    storyExercise: { marginTop: 5 },
    storyExerciseName: {
      fontFamily: 'BebasNeue_400Regular',
      fontSize: 17,
      lineHeight: 19,
      letterSpacing: 0.5,
      color: colors.text,
    },
    storyExercisePrescription: {
      marginTop: 1,
      fontFamily: MANROPE.medium,
      fontSize: 7,
      lineHeight: 10,
      color: colors.textSecondary,
    },
    storyResult: {
      marginTop: 8,
      paddingTop: 7,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    storyResultLabel: {
      fontFamily: MANROPE.bold,
      fontSize: 7,
      letterSpacing: 0.8,
      color: colors.accent,
    },
    storyResultValue: {
      marginTop: 2,
      fontFamily: 'BebasNeue_400Regular',
      fontSize: 22,
      lineHeight: 24,
      color: colors.text,
    },
    storyEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    storyEmptyText: {
      fontFamily: MANROPE.bold,
      fontSize: 12,
      color: colors.textSecondary,
    },
    storyFooter: {
      paddingTop: 10,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    storyFooterText: {
      fontFamily: 'BebasNeue_400Regular',
      fontSize: 12,
      letterSpacing: 1,
      color: colors.textMuted,
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
    pressed: { opacity: 0.7 },
  });
}
