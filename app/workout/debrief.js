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

function storyBlocksFromWorkout(workout) {
  const exercises = Array.isArray(workout?.exercises) ? workout.exercises : [];
  const grouped = new Map();

  exercises.forEach((exercise) => {
    const block = normalizeBlock(exercise?.blockKey ?? exercise?.block);
    if (!block || HIDDEN_SHARE_BLOCKS.has(block)) return;

    const policy = SHAREABLE_BLOCKS[block];
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
    .map((block) => ({ ...block, exercises: block.exercises.slice(0, 4) }));
}

function sessionReferenceNames(snapshot) {
  return (Array.isArray(snapshot?.observations) ? snapshot.observations : [])
    .filter((item) =>
      ['MEASURABLE_REFERENCE', 'CONTEXTUAL_REFERENCE'].includes(item?.proof_class)
    )
    .map((item) => item?.exercise_name)
    .filter(Boolean);
}

function buildSessionMoment(snapshot, workout) {
  const summary = snapshot?.summary ?? {};
  const observations = Array.isArray(snapshot?.observations) ? snapshot.observations : [];
  const references = Number(summary.reference_observations ?? 0);
  const referenceNames = sessionReferenceNames(snapshot);
  const wodResult = wodResultLine(workout?.wodRuntime);

  const environmentIssue = observations.some(
    (item) => item?.execution_reason_code === 'ENVIRONMENT_MISMATCH'
  );
  const adapted = observations.some(
    (item) =>
      item?.execution_status === 'adapted' ||
      item?.execution_reason_code === 'PAIN_DISCOMFORT' ||
      item?.execution_reason_code === 'FATIGUE'
  );

  if (references > 0) {
    return {
      tone: 'reference',
      eyebrow: 'NOUVELLE RÉFÉRENCE',
      title: referenceNames[0] ?? `${references} référence${references > 1 ? 's' : ''}`,
      text:
        referenceNames.length > 1
          ? `${referenceNames.slice(0, 2).join(' · ')} deviennent comparables dans ton historique.`
          : 'Cette séance ajoute une base de comparaison exploitable pour la suite.',
      icon: 'analytics-outline',
    };
  }

  if (environmentIssue) {
    return {
      tone: 'context',
      eyebrow: 'CONTEXTE PRIS EN COMPTE',
      title: 'Séance adaptée',
      text: 'La contrainte d’environnement reste séparée de ton niveau physique.',
      icon: 'options-outline',
    };
  }

  if (adapted) {
    return {
      tone: 'context',
      eyebrow: 'SÉANCE AJUSTÉE',
      title: 'Le contexte compte',
      text: 'UGEROD conserve ce qui a été réalisé sans transformer une adaptation en baisse de niveau.',
      icon: 'pulse-outline',
    };
  }

  if (wodResult) {
    return {
      tone: 'result',
      eyebrow: 'RÉSULTAT DU JOUR',
      title: wodResult,
      text: 'Séance enregistrée. Ce résultat reste rattaché au format réellement réalisé.',
      icon: 'stopwatch-outline',
    };
  }

  return {
    tone: 'default',
    eyebrow: 'SÉANCE VALIDÉE',
    title: 'Travail enregistré',
    text: 'Une séance de plus dans ton historique, sans inventer de progression là où il n’y en a pas encore.',
    icon: 'checkmark-circle-outline',
  };
}

function buildLearningText(snapshot) {
  const summary = snapshot?.summary ?? {};
  const references = Number(summary.reference_observations ?? 0);
  const stateSignals = Number(summary.state_signal_observations ?? 0);
  const observations = Array.isArray(snapshot?.observations) ? snapshot.observations : [];

  const environmentIssue = observations.some(
    (item) => item?.execution_reason_code === 'ENVIRONMENT_MISMATCH'
  );

  if (environmentIssue) {
    return 'Une partie de la séance a été limitée par ton environnement. Ce contexte reste séparé de ton niveau physique.';
  }

  const missingNames = observations
    .filter((item) => item?.proof_class === 'MISSING_METRIC')
    .map((item) => item?.exercise_name)
    .filter(Boolean)
    .slice(0, 2);

  if (references > 0 && missingNames.length > 0) {
    return `${references} mouvement${references > 1 ? 's' : ''} ont produit une référence exploitable. ${missingNames.join(' et ')} restent à consolider.`;
  }

  if (references > 0) {
    return `${references} mouvement${references > 1 ? 's' : ''} ont produit une référence exploitable pour calibrer la suite.`;
  }

  if (stateSignals > 0) {
    return 'UGEROD a surtout retenu ton état et le déroulement de la séance pour mieux interpréter les prochaines expositions.';
  }

  return 'Cette séance enrichit ton historique sans créer artificiellement une nouvelle référence.';
}

function buildNextStepText(snapshot, progression) {
  const summary = snapshot?.summary ?? {};
  const observations = Array.isArray(snapshot?.observations) ? snapshot.observations : [];
  const references = Number(summary.reference_observations ?? 0);
  const hasMissingMetric = observations.some((item) => item?.proof_class === 'MISSING_METRIC');
  const environmentIssue = observations.some(
    (item) => item?.execution_reason_code === 'ENVIRONMENT_MISMATCH'
  );

  if (environmentIssue) {
    return 'Je garderai cette contrainte séparée de ton niveau et je chercherai un contexte plus propre avant d’en tirer une conclusion sportive.';
  }

  if (hasMissingMetric) {
    return 'Je conserverai les données incomplètes comme telles et je chercherai une occasion utile de les recalibrer.';
  }

  if (references > 0) {
    return 'Je pourrai réutiliser cette référence lorsqu’un contexte comparable se présentera, sans augmenter artificiellement la difficulté.';
  }

  if (progression?.overall?.state === 'PROGRESSING') {
    return 'Je chercherai une nouvelle exposition comparable avant de transformer un signal positif en référence plus haute.';
  }

  if (progression?.overall?.state === 'RECALIBRATING') {
    return 'Je vais revérifier les références qui bougent avant de modifier ton niveau acquis.';
  }

  return 'Pas de changement forcé : la prochaine séance continuera à construire des preuves utiles avant d’ajuster le programme.';
}

function buildShareMoment(moment, workout) {
  const duration = actualDurationMinutes(workout);
  const environment =
    ENVIRONMENT_LABELS[sessionEnvironment(workout)] ?? sessionEnvironment(workout);
  const result = wodResultLine(workout?.wodRuntime);

  if (moment?.tone === 'reference') {
    return {
      kicker: 'NEW REFERENCE',
      headline: moment.title,
      metric: result ?? `${duration} MIN`,
      footer: `${environment} · UGEROD`,
    };
  }

  if (result) {
    return {
      kicker: 'SESSION DONE',
      headline: result,
      metric: `${duration} MIN`,
      footer: `${environment} · UGEROD`,
    };
  }

  return {
    kicker: 'SESSION DONE',
    headline: `${duration} MIN`,
    metric: environment.toUpperCase(),
    footer: 'UGEROD',
  };
}

function buildShareText(workout, blocks, shareMoment) {
  const lines = [
    'UGEROD',
    shareMoment?.kicker,
    shareMoment?.headline,
    shareMoment?.metric,
    '',
  ].filter(Boolean);

  blocks.slice(0, 3).forEach((block) => {
    lines.push(block.label);
    block.exercises.slice(0, 2).forEach((exercise) => {
      lines.push(`• ${exercise.name}${exercise.prescription ? ` — ${exercise.prescription}` : ''}`);
    });
    lines.push('');
  });

  return lines.join('\n').trim();
}

function SkillQuestionInline({ question, value, saving, error, onSelect, colors, styles }) {
  if (!question?.should_ask) return null;

  const options = Array.isArray(question.options)
    ? question.options
    : ['PROPRE', 'LIMITE', 'PAS_ENCORE'];

  return (
    <View style={styles.skillPrompt}>
      <View style={styles.sectionEyebrowRow}>
        <View style={styles.sectionRule} />
        <Text style={styles.sectionEyebrow}>UNE INFO À CONFIRMER</Text>
      </View>
      <Text style={styles.skillQuestion}>
        {question.question_text ?? 'Sur le Skill, ta technique était…'}
      </Text>
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
        <View style={styles.inlineStatus}>
          <ActivityIndicator size="small" color={colors.accent} />
          <Text style={styles.inlineStatusText}>J’enregistre…</Text>
        </View>
      ) : null}
      {error ? <Text style={styles.questionError}>{error}</Text> : null}
    </View>
  );
}

function StoryPreview({ shareMoment, styles }) {
  return (
    <View style={styles.storyCard}>
      <View>
        <Text style={styles.storyBrand}>UGEROD</Text>
        <View style={styles.storyRule} />
      </View>

      <View style={styles.storyCenter}>
        <Text style={styles.storyKicker}>{shareMoment.kicker}</Text>
        <Text style={styles.storyHeadline}>{shareMoment.headline}</Text>
        <Text style={styles.storyMetric}>{shareMoment.metric}</Text>
      </View>

      <Text style={styles.storyFooter}>{shareMoment.footer}</Text>
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
  const [snapshotLoading, setSnapshotLoading] = useState(true);
  const [snapshotError, setSnapshotError] = useState('');
  const [shareOpen, setShareOpen] = useState(false);

  const environment =
    ENVIRONMENT_LABELS[sessionEnvironment(workout)] ?? sessionEnvironment(workout);
  const duration = actualDurationMinutes(workout);
  const wodResult = wodResultLine(workout?.wodRuntime);
  const shareBlocks = useMemo(() => storyBlocksFromWorkout(workout), [workout]);

  const loadSessionSnapshot = useCallback(async () => {
    setSnapshotLoading(true);
    setSnapshotError('');

    try {
      if (!sessionId) throw new Error('Session manquante pour le débrief Coach.');
      const sessionLearning = await getSessionLearningSnapshot(sessionId);
      setSnapshot(sessionLearning);
    } catch (loadError) {
      setSnapshotError(
        loadError?.message ??
          "La séance est enregistrée, mais l’analyse Coach n’est pas disponible pour l’instant."
      );
    } finally {
      setSnapshotLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    loadSessionSnapshot();
  }, [loadSessionSnapshot]);

  useEffect(() => {
    let active = true;
    getProgressionDataContract('4w')
      .then((data) => {
        if (active) setProgression(data);
      })
      .catch(() => {
        if (active) setProgression(null);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    if (!sessionId) return undefined;

    getObservationQuestionNeed(sessionId, 'SKILL_TECHNICAL_QUALITY')
      .then((question) => {
        if (active) setSkillQuestion(question);
      })
      .catch(() => {
        if (active) setSkillQuestion({ should_ask: false, reason: 'QUESTION_UNAVAILABLE' });
      });

    return () => {
      active = false;
    };
  }, [sessionId]);

  const sessionMoment = useMemo(
    () => buildSessionMoment(snapshot, workout),
    [snapshot, workout]
  );
  const learningText = useMemo(() => buildLearningText(snapshot), [snapshot]);
  const nextStepText = useMemo(
    () => buildNextStepText(snapshot, progression),
    [snapshot, progression]
  );
  const shareMoment = useMemo(
    () => buildShareMoment(sessionMoment, workout),
    [sessionMoment, workout]
  );
  const shareText = useMemo(
    () => buildShareText(workout, shareBlocks, shareMoment),
    [workout, shareBlocks, shareMoment]
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
        <View style={styles.topBar}>
          <Text style={styles.topBarLabel}>SÉANCE VALIDÉE</Text>
          <Image source={brandIcon} style={styles.brandIcon} resizeMode="contain" />
        </View>

        <View style={styles.hero}>
          <Text style={styles.heroTitle}>
            Bien joué<Text style={styles.dot}>.</Text>
          </Text>
          <Text style={styles.heroSubtitle}>
            Ta séance est enregistrée. Voilà ce qui compte aujourd’hui.
          </Text>

          <View style={styles.heroSummary}>
            <View>
              <Text style={styles.heroMetric}>{duration}</Text>
              <Text style={styles.heroMetricLabel}>MIN</Text>
            </View>
            <View style={styles.heroSummaryRule} />
            <View style={styles.heroSummaryCopy}>
              <Text style={styles.heroEnvironment}>{environment}</Text>
              <Text style={styles.heroResult}>{wodResult ?? 'Session terminée'}</Text>
            </View>
            <Ionicons name="checkmark-circle" size={24} color={colors.accent} />
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionEyebrowRow}>
            <View style={styles.sectionRule} />
            <Text style={styles.sectionEyebrow}>CE QUI COMPTE AUJOURD’HUI</Text>
          </View>

          {snapshotLoading ? (
            <View style={styles.inlineLoading}>
              <ActivityIndicator size="small" color={colors.accent} />
              <Text style={styles.inlineLoadingText}>Le Coach analyse la séance…</Text>
            </View>
          ) : snapshotError ? (
            <View style={styles.inlineError}>
              <Text style={styles.inlineErrorTitle}>Analyse temporairement indisponible</Text>
              <Text style={styles.inlineErrorText}>{snapshotError}</Text>
              <Pressable onPress={loadSessionSnapshot} style={styles.retryButton}>
                <Text style={styles.retryText}>Réessayer</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.moment}>
              <View style={styles.momentIcon}>
                <Ionicons name={sessionMoment.icon} size={21} color={colors.accent} />
              </View>
              <Text style={styles.momentEyebrow}>{sessionMoment.eyebrow}</Text>
              <Text style={styles.momentTitle}>{sessionMoment.title}</Text>
              <Text style={styles.momentText}>{sessionMoment.text}</Text>
            </View>
          )}
        </View>

        <View style={styles.divider} />

        <View style={styles.coachSection}>
          <View style={styles.sectionEyebrowRow}>
            <View style={styles.sectionRule} />
            <Text style={styles.sectionEyebrow}>LE COACH</Text>
          </View>

          <View style={styles.coachRow}>
            <Text style={styles.coachLabel}>CE QUE JE RETIENS</Text>
            <Text style={styles.coachText}>
              {snapshotLoading ? 'Analyse en cours…' : learningText}
            </Text>
          </View>

          <View style={styles.coachSeparator} />

          <View style={styles.coachRow}>
            <Text style={styles.coachLabel}>POUR LA SUITE</Text>
            <Text style={styles.coachText}>
              {snapshotLoading ? 'Je prépare la suite à partir de cette séance.' : nextStepText}
            </Text>
          </View>
        </View>

        <SkillQuestionInline
          question={skillQuestion}
          value={skillFeedback}
          saving={skillFeedbackSaving}
          error={skillFeedbackError}
          onSelect={handleSkillFeedback}
          colors={colors}
          styles={styles}
        />

        <View style={styles.divider} />

        <View style={styles.shareSection}>
          <View style={styles.sectionEyebrowRow}>
            <View style={styles.sectionRuleSecondary} />
            <Text style={styles.sectionEyebrow}>PARTAGER CE MOMENT</Text>
          </View>
          <Text style={styles.shareIntro}>
            Une carte simple centrée sur ce qui mérite réellement d’être montré.
          </Text>

          <Pressable
            onPress={() => setShareOpen(true)}
            style={({ pressed }) => [styles.sharePreviewButton, pressed && styles.pressed]}
          >
            <View style={styles.sharePreviewFrame}>
              <StoryPreview shareMoment={shareMoment} styles={styles} />
            </View>
            <View style={styles.sharePreviewCopy}>
              <Text style={styles.sharePreviewTitle}>Story UGEROD</Text>
              <Text style={styles.sharePreviewText}>
                {sessionMoment.tone === 'reference'
                  ? 'Ta nouvelle référence devient le centre de la story.'
                  : 'Un résumé sobre de la séance, sans faux exploit.'}
              </Text>
              <View style={styles.sharePreviewAction}>
                <Text style={styles.sharePreviewActionText}>Voir l’aperçu</Text>
                <Ionicons name="arrow-forward" size={17} color={colors.accent} />
              </View>
            </View>
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
          style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
        >
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
                <Text style={styles.shareSheetTitle}>Ce qui compte, rien de plus.</Text>
              </View>
              <Pressable onPress={() => setShareOpen(false)} style={styles.closeButton}>
                <Ionicons name="close" size={20} color={colors.text} />
              </Pressable>
            </View>

            <View style={styles.storyFrame}>
              <StoryPreview shareMoment={shareMoment} styles={styles} />
            </View>

            <Pressable
              onPress={handleNativeShare}
              style={({ pressed }) => [styles.shareButton, pressed && styles.primaryButtonPressed]}
            >
              <Ionicons name="share-social-outline" size={20} color={colors.textOnAccent} />
              <Text style={styles.shareButtonText}>Partager</Text>
            </Pressable>
            <Text style={styles.shareNote}>
              V1 : le partage natif envoie encore un résumé texte. L’export image de la carte sera
              traité séparément après validation du design.
            </Text>
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
      paddingHorizontal: 22,
      paddingTop: 10,
      paddingBottom: 30,
    },
    topBar: {
      minHeight: 56,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    topBarLabel: {
      fontFamily: MANROPE.bold,
      fontSize: 10,
      letterSpacing: 1.2,
      color: colors.textMuted,
    },
    brandIcon: { width: 42, height: 42 },

    hero: {
      paddingTop: 26,
      paddingBottom: 28,
    },
    heroTitle: {
      fontFamily: MANROPE.extraBold,
      fontSize: 50,
      lineHeight: 54,
      letterSpacing: -1.8,
      color: colors.text,
    },
    dot: { color: colors.secondaryAccent },
    heroSubtitle: {
      maxWidth: 310,
      marginTop: 8,
      fontFamily: MANROPE.regular,
      fontSize: 15,
      lineHeight: 22,
      color: colors.textSecondary,
    },
    heroSummary: {
      marginTop: 28,
      flexDirection: 'row',
      alignItems: 'center',
    },
    heroMetric: {
      fontFamily: 'BebasNeue_400Regular',
      fontSize: 48,
      lineHeight: 46,
      color: colors.text,
    },
    heroMetricLabel: {
      marginTop: -1,
      fontFamily: MANROPE.bold,
      fontSize: 8,
      letterSpacing: 1,
      color: colors.textMuted,
    },
    heroSummaryRule: {
      width: 1,
      height: 44,
      marginHorizontal: 16,
      backgroundColor: colors.border,
    },
    heroSummaryCopy: { flex: 1 },
    heroEnvironment: {
      fontFamily: MANROPE.bold,
      fontSize: 14,
      color: colors.text,
    },
    heroResult: {
      marginTop: 3,
      fontFamily: MANROPE.medium,
      fontSize: 12,
      color: colors.textSecondary,
    },

    section: { paddingTop: 8 },
    sectionEyebrowRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 9,
    },
    sectionRule: {
      width: 26,
      height: 3,
      borderRadius: 2,
      backgroundColor: colors.accent,
    },
    sectionRuleSecondary: {
      width: 26,
      height: 3,
      borderRadius: 2,
      backgroundColor: colors.secondaryAccent,
    },
    sectionEyebrow: {
      fontFamily: MANROPE.bold,
      fontSize: 9,
      letterSpacing: 1,
      color: colors.textMuted,
    },

    inlineLoading: {
      minHeight: 82,
      marginTop: 18,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    inlineLoadingText: {
      fontFamily: MANROPE.semiBold,
      fontSize: 12,
      color: colors.textSecondary,
    },
    inlineError: { marginTop: 18 },
    inlineErrorTitle: {
      fontFamily: MANROPE.bold,
      fontSize: 15,
      color: colors.text,
    },
    inlineErrorText: {
      marginTop: 5,
      fontFamily: MANROPE.regular,
      fontSize: 12,
      lineHeight: 18,
      color: colors.textSecondary,
    },
    retryButton: {
      alignSelf: 'flex-start',
      marginTop: 12,
      minHeight: 36,
      paddingHorizontal: 14,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: colors.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
    retryText: {
      fontFamily: MANROPE.bold,
      fontSize: 11,
      color: colors.accent,
    },

    moment: { paddingTop: 18, paddingBottom: 6 },
    momentIcon: {
      width: 44,
      height: 44,
      borderRadius: 15,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.accentSoft,
    },
    momentEyebrow: {
      marginTop: 18,
      fontFamily: MANROPE.bold,
      fontSize: 9,
      letterSpacing: 1.05,
      color: colors.accent,
    },
    momentTitle: {
      marginTop: 4,
      fontFamily: 'BebasNeue_400Regular',
      fontSize: 40,
      lineHeight: 42,
      letterSpacing: 0.7,
      color: colors.text,
    },
    momentText: {
      maxWidth: 340,
      marginTop: 6,
      fontFamily: MANROPE.regular,
      fontSize: 13,
      lineHeight: 20,
      color: colors.textSecondary,
    },

    divider: {
      height: 1,
      marginVertical: 28,
      backgroundColor: colors.border,
    },

    coachSection: {},
    coachRow: { paddingTop: 20 },
    coachLabel: {
      fontFamily: MANROPE.bold,
      fontSize: 10,
      letterSpacing: 0.8,
      color: colors.textMuted,
    },
    coachText: {
      marginTop: 7,
      fontFamily: MANROPE.medium,
      fontSize: 15,
      lineHeight: 23,
      color: colors.text,
    },
    coachSeparator: {
      height: 1,
      marginTop: 20,
      backgroundColor: colors.border,
    },

    skillPrompt: {
      marginTop: 24,
      paddingTop: 22,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    skillQuestion: {
      marginTop: 12,
      fontFamily: MANROPE.bold,
      fontSize: 15,
      lineHeight: 21,
      color: colors.text,
    },
    optionRow: {
      marginTop: 14,
      flexDirection: 'row',
      gap: 7,
    },
    optionButton: {
      flex: 1,
      minHeight: 42,
      borderRadius: 13,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 6,
      backgroundColor: colors.surface,
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
    inlineStatus: {
      marginTop: 10,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 7,
    },
    inlineStatusText: {
      fontFamily: MANROPE.semiBold,
      fontSize: 9,
      color: colors.textMuted,
    },
    questionError: {
      marginTop: 9,
      fontFamily: MANROPE.regular,
      fontSize: 10,
      color: colors.error,
    },

    shareSection: {},
    shareIntro: {
      maxWidth: 330,
      marginTop: 12,
      fontFamily: MANROPE.regular,
      fontSize: 13,
      lineHeight: 20,
      color: colors.textSecondary,
    },
    sharePreviewButton: {
      marginTop: 18,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 18,
    },
    sharePreviewFrame: {
      width: 112,
      aspectRatio: 9 / 16,
      borderRadius: 20,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: colors.border,
    },
    sharePreviewCopy: { flex: 1 },
    sharePreviewTitle: {
      fontFamily: MANROPE.extraBold,
      fontSize: 20,
      lineHeight: 25,
      color: colors.text,
    },
    sharePreviewText: {
      marginTop: 6,
      fontFamily: MANROPE.regular,
      fontSize: 12,
      lineHeight: 18,
      color: colors.textSecondary,
    },
    sharePreviewAction: {
      marginTop: 13,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 7,
    },
    sharePreviewActionText: {
      fontFamily: MANROPE.bold,
      fontSize: 11,
      color: colors.accent,
    },

    primaryButton: {
      minHeight: 58,
      marginTop: 34,
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
      fontSize: 16,
      color: colors.textOnAccent,
    },
    secondaryButton: {
      minHeight: 46,
      marginTop: 8,
      alignItems: 'center',
      justifyContent: 'center',
    },
    secondaryButtonText: {
      fontFamily: MANROPE.bold,
      fontSize: 12,
      color: colors.textSecondary,
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
      borderTopLeftRadius: 26,
      borderTopRightRadius: 26,
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
      marginBottom: 16,
    },
    shareSheetHeader: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: 12,
    },
    shareSheetEyebrow: {
      fontFamily: MANROPE.bold,
      fontSize: 9,
      letterSpacing: 0.9,
      color: colors.accent,
    },
    shareSheetTitle: {
      maxWidth: 260,
      marginTop: 4,
      fontFamily: MANROPE.extraBold,
      fontSize: 23,
      lineHeight: 29,
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
      width: '66%',
      maxWidth: 285,
      aspectRatio: 9 / 16,
      marginTop: 18,
      borderRadius: 24,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: colors.border,
    },
    storyCard: {
      flex: 1,
      paddingHorizontal: 16,
      paddingTop: 18,
      paddingBottom: 14,
      backgroundColor: colors.surface,
    },
    storyBrand: {
      fontFamily: 'BebasNeue_400Regular',
      fontSize: 24,
      lineHeight: 27,
      letterSpacing: 1.4,
      color: colors.text,
    },
    storyRule: {
      width: 34,
      height: 4,
      borderRadius: 2,
      marginTop: 6,
      backgroundColor: colors.secondaryAccent,
    },
    storyCenter: {
      flex: 1,
      justifyContent: 'center',
    },
    storyKicker: {
      fontFamily: MANROPE.bold,
      fontSize: 8,
      letterSpacing: 1,
      color: colors.accent,
    },
    storyHeadline: {
      marginTop: 8,
      fontFamily: 'BebasNeue_400Regular',
      fontSize: 33,
      lineHeight: 35,
      letterSpacing: 0.6,
      color: colors.text,
    },
    storyMetric: {
      marginTop: 6,
      fontFamily: MANROPE.bold,
      fontSize: 10,
      letterSpacing: 0.6,
      color: colors.textSecondary,
    },
    storyFooter: {
      fontFamily: MANROPE.bold,
      fontSize: 7,
      letterSpacing: 0.7,
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
    shareNote: {
      marginTop: 10,
      fontFamily: MANROPE.regular,
      fontSize: 9,
      lineHeight: 14,
      textAlign: 'center',
      color: colors.textMuted,
    },

    bottomSpace: { height: 20 },
    pressed: { opacity: 0.72 },
  });
}
