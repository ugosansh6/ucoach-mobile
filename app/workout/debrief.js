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

function sessionObservationSnapshot(snapshot) {
  const summary = snapshot?.summary ?? {};
  const observations = Array.isArray(snapshot?.observations) ? snapshot.observations : [];
  const references = Number(summary.reference_observations ?? 0);
  const stateSignals = Number(summary.state_signal_observations ?? 0);
  const referenceNames = observations
    .filter((item) => ['MEASURABLE_REFERENCE', 'CONTEXTUAL_REFERENCE'].includes(item?.proof_class))
    .map((item) => item?.exercise_name)
    .filter(Boolean)
    .slice(0, 2);
  const environmentIssue = observations.some(
    (item) => item?.execution_reason_code === 'ENVIRONMENT_MISMATCH'
  );
  const painIssue = observations.some(
    (item) => item?.execution_reason_code === 'PAIN_DISCOMFORT'
  );

  if (painIssue) {
    return {
      tone: 'care',
      eyebrow: 'À RETENIR AUJOURD’HUI',
      title: 'Une gêne a été signalée',
      text: 'UGEROD conserve cette information séparément de ta performance pour éviter de tirer une conclusion trop rapide.',
      icon: 'shield-checkmark-outline',
    };
  }

  if (environmentIssue) {
    return {
      tone: 'context',
      eyebrow: 'CONTEXTE DE SÉANCE',
      title: 'Ton environnement a compté',
      text: 'Une partie de la séance a été limitée par le contexte. UGEROD ne l’interprète pas comme une baisse de niveau.',
      icon: 'navigate-outline',
    };
  }

  if (references > 0) {
    return {
      tone: 'reference',
      eyebrow: 'NOUVELLE RÉFÉRENCE',
      title:
        referenceNames.length > 0
          ? joinNames(referenceNames)
          : `${references} ${plural(references, 'référence')} exploitable${references > 1 ? 's' : ''}`,
      text: 'Cette séance ajoute une base de comparaison exploitable pour les prochaines expositions.',
      icon: 'analytics-outline',
    };
  }

  if (stateSignals > 0) {
    return {
      tone: 'learning',
      eyebrow: 'PROFIL AFFINÉ',
      title: 'UGEROD en sait un peu plus',
      text: 'Ton état et le déroulement de la séance enrichissent les prochaines décisions du Coach.',
      icon: 'options-outline',
    };
  }

  return {
    tone: 'session',
    eyebrow: 'SÉANCE VALIDÉE',
    title: 'Une séance de plus dans la trajectoire',
    text: 'Pas de faux signal de progression : la séance enrichit ton historique et servira aux prochaines comparaisons.',
    icon: 'checkmark-circle-outline',
  };
}

function coachLearning(snapshot) {
  const summary = snapshot?.summary ?? {};
  const references = Number(summary.reference_observations ?? 0);
  const observations = Array.isArray(snapshot?.observations) ? snapshot.observations : [];
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

  if (Number(summary.state_signal_observations ?? 0) > 0) {
    return 'Ton état et le déroulement réel de la séance sont désormais intégrés au contexte de décision.';
  }

  return 'La séance est conservée dans ton historique sans transformer une observation isolée en preuve de progression.';
}

function buildNextStep(snapshot, progression) {
  const observations = Array.isArray(snapshot?.observations) ? snapshot.observations : [];
  const referenceNames = observations
    .filter((item) => ['MEASURABLE_REFERENCE', 'CONTEXTUAL_REFERENCE'].includes(item?.proof_class))
    .map((item) => item?.exercise_name)
    .filter(Boolean);
  const movements = Array.isArray(progression?.movement_capabilities)
    ? progression.movement_capabilities
    : [];
  const related = movements.find(
    (item) => item?.name && referenceNames.some((name) => name === item.name)
  );

  if (related?.signal === 'PROGRESSING') {
    return `Le signal positif sur ${related.name} devra être confirmé sur une prochaine exposition comparable avant d’augmenter la référence.`;
  }

  if (related?.signal === 'RECALIBRATING') {
    return `UGEROD cherchera à revérifier ${related.name} dans un contexte comparable avant de modifier ta référence.`;
  }

  if (referenceNames.length > 0) {
    return `Cette nouvelle référence sera utilisée lorsque ${referenceNames[0]} réapparaîtra dans un contexte comparable.`;
  }

  return 'La prochaine séance restera guidée par ton programme, ta récupération et les signaux déjà établis — pas par une seule observation.';
}

function trajectorySignal(progression) {
  const movements = Array.isArray(progression?.movement_capabilities)
    ? progression.movement_capabilities
    : [];
  const progressing = movements.find((item) => item?.signal === 'PROGRESSING');
  const recalibrating = movements.find((item) => item?.signal === 'RECALIBRATING');

  if (progressing?.name) {
    return {
      label: 'TRAJECTOIRE 4 SEMAINES',
      title: `${progressing.name} progresse`,
      icon: 'trending-up-outline',
    };
  }

  if (recalibrating?.name) {
    return {
      label: 'TRAJECTOIRE 4 SEMAINES',
      title: `${recalibrating.name} à revérifier`,
      icon: 'swap-vertical-outline',
    };
  }

  return null;
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

function StoryPreview({ workout, blocks, highlight, styles }) {
  const environment = ENVIRONMENT_LABELS[sessionEnvironment(workout)] ?? sessionEnvironment(workout);
  const result = wodResultLine(workout?.wodRuntime);

  return (
    <View style={styles.storyCard}>
      <View style={styles.storyHeader}>
        <Text style={styles.storyBrand}>UGEROD</Text>
        <View style={styles.storyRule} />
        <Text style={styles.storyMeta}>
          {environment} · {actualDurationMinutes(workout)} MIN
        </Text>
      </View>

      <View style={styles.storyHero}>
        <Text style={styles.storyHeroLabel}>{highlight?.eyebrow ?? 'SÉANCE VALIDÉE'}</Text>
        <Text numberOfLines={3} style={styles.storyHeroTitle}>
          {highlight?.title ?? 'BIEN JOUÉ.'}
        </Text>
        <Text style={styles.storyHeroText}>{highlight?.text}</Text>
      </View>

      <View style={styles.storyBlocks}>
        {blocks.slice(0, 3).map((block) => (
          <View key={block.key} style={styles.storyBlock}>
            <Text style={styles.storyBlockLabel}>{block.label}</Text>
            <Text numberOfLines={1} style={styles.storyExerciseName}>
              {block.exercises.map((exercise) => exercise.name).join(' · ')}
            </Text>
            {block.key === 'wod' && result ? (
              <Text style={styles.storyResultValue}>{result}</Text>
            ) : null}
          </View>
        ))}
      </View>

      <View style={styles.storyFooter}>
        <Text style={styles.storyFooterText}>COACHED BY UGEROD</Text>
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
  const [sessionLoading, setSessionLoading] = useState(true);
  const [sessionError, setSessionError] = useState('');
  const [trajectoryLoading, setTrajectoryLoading] = useState(true);
  const [shareOpen, setShareOpen] = useState(false);

  const shareBlocks = useMemo(() => storyBlocksFromWorkout(workout), [workout]);
  const shareText = useMemo(() => buildShareText(workout, shareBlocks), [workout, shareBlocks]);
  const environment = ENVIRONMENT_LABELS[sessionEnvironment(workout)] ?? sessionEnvironment(workout);
  const duration = actualDurationMinutes(workout);
  const wodResult = wodResultLine(workout?.wodRuntime);

  const loadSession = useCallback(async () => {
    setSessionLoading(true);
    setSessionError('');

    try {
      if (!sessionId) throw new Error('Session manquante pour le débrief Coach.');
      const sessionLearning = await getSessionLearningSnapshot(sessionId);
      setSnapshot(sessionLearning);
    } catch (loadError) {
      setSessionError(
        loadError?.message ??
          "La séance est enregistrée, mais l'analyse Coach n'est pas disponible pour l'instant."
      );
    } finally {
      setSessionLoading(false);
    }
  }, [sessionId]);

  const loadSecondary = useCallback(async () => {
    setTrajectoryLoading(true);
    if (!sessionId) {
      setTrajectoryLoading(false);
      return;
    }

    const [progressionData, questionNeed] = await Promise.all([
      getProgressionDataContract('4w').catch(() => null),
      getObservationQuestionNeed(sessionId, 'SKILL_TECHNICAL_QUALITY').catch(() => ({
        should_ask: false,
        reason: 'QUESTION_UNAVAILABLE',
      })),
    ]);

    setProgression(progressionData);
    setSkillQuestion(questionNeed);
    setTrajectoryLoading(false);
  }, [sessionId]);

  useEffect(() => {
    loadSession();
    loadSecondary();
  }, [loadSession, loadSecondary]);

  const highlight = useMemo(() => sessionObservationSnapshot(snapshot), [snapshot]);
  const learning = useMemo(() => coachLearning(snapshot), [snapshot]);
  const nextStep = useMemo(() => buildNextStep(snapshot, progression), [snapshot, progression]);
  const trajectory = useMemo(() => trajectorySignal(progression), [progression]);

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
            <View style={styles.statusPill}>
              <View style={styles.statusDot} />
              <Text style={styles.statusText}>SÉANCE VALIDÉE</Text>
            </View>
            <Image source={brandIcon} style={styles.brandIcon} resizeMode="contain" />
          </View>

          <Text style={styles.heroTitle}>BIEN JOUÉ<Text style={styles.dot}>.</Text></Text>
          <Text style={styles.heroSubtitle}>Tu as fait le travail. Voilà ce qui compte aujourd’hui.</Text>

          <View style={styles.sessionFacts}>
            <View style={styles.durationBlock}>
              <Text style={styles.durationValue}>{duration}</Text>
              <Text style={styles.durationUnit}>MIN</Text>
            </View>
            <View style={styles.factDivider} />
            <View style={styles.sessionFactCopy}>
              <Text style={styles.environment}>{environment.toUpperCase()}</Text>
              <Text style={styles.resultLine}>{wodResult ? `WOD · ${wodResult}` : 'Séance enregistrée'}</Text>
            </View>
          </View>
        </View>

        <View style={styles.editorialSection}>
          <Text style={styles.sectionEyebrow}>CE QUI COMPTE AUJOURD’HUI</Text>

          {sessionLoading ? (
            <View style={styles.inlineLoading}>
              <ActivityIndicator size="small" color={colors.accent} />
              <Text style={styles.inlineLoadingText}>Le Coach relit ta séance…</Text>
            </View>
          ) : sessionError ? (
            <View style={styles.inlineError}>
              <Text style={styles.inlineErrorTitle}>Séance bien enregistrée.</Text>
              <Text style={styles.inlineErrorText}>{sessionError}</Text>
              <Pressable onPress={loadSession} style={styles.textButton}>
                <Text style={styles.textButtonLabel}>Réessayer l’analyse</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.highlightBlock}>
              <View style={styles.highlightIcon}>
                <Ionicons name={highlight.icon} size={22} color={colors.accent} />
              </View>
              <Text style={styles.highlightEyebrow}>{highlight.eyebrow}</Text>
              <Text style={styles.highlightTitle}>{highlight.title}</Text>
              <Text style={styles.highlightText}>{highlight.text}</Text>
            </View>
          )}
        </View>

        {!sessionLoading && !sessionError ? (
          <View style={styles.coachSection}>
            <View style={styles.coachHeader}>
              <View>
                <Text style={styles.sectionEyebrow}>LE COACH</Text>
                <Text style={styles.coachHeading}>Je retiens. J’adapte.</Text>
              </View>
              <View style={styles.coachMark}>
                <Ionicons name="sparkles-outline" size={20} color={colors.accent} />
              </View>
            </View>

            <View style={styles.coachPoint}>
              <Text style={styles.coachPointLabel}>CE QUE JE RETIENS</Text>
              <Text style={styles.coachPointText}>{learning}</Text>
            </View>

            <View style={styles.coachSeparator} />

            <View style={styles.coachPoint}>
              <Text style={styles.coachPointLabel}>POUR LA SUITE</Text>
              <Text style={styles.coachPointText}>{nextStep}</Text>
            </View>

            {trajectory ? (
              <View style={styles.trajectoryRow}>
                <Ionicons name={trajectory.icon} size={17} color={colors.accent} />
                <View style={styles.trajectoryMain}>
                  <Text style={styles.trajectoryLabel}>{trajectory.label}</Text>
                  <Text style={styles.trajectoryTitle}>{trajectory.title}</Text>
                </View>
                <Pressable onPress={() => router.push('/(tabs)/progression')} hitSlop={10}>
                  <Ionicons name="arrow-forward" size={18} color={colors.textSecondary} />
                </Pressable>
              </View>
            ) : trajectoryLoading ? (
              <Text style={styles.secondaryLoading}>Mise à jour de ta trajectoire…</Text>
            ) : null}
          </View>
        ) : null}

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
          <View style={styles.shareHeadingRow}>
            <View style={styles.shareHeadingCopy}>
              <Text style={styles.sectionEyebrow}>PARTAGER CE MOMENT</Text>
              <Text style={styles.shareHeading}>Une story qui raconte vraiment ta séance.</Text>
            </View>
            <Ionicons name="share-social-outline" size={20} color={colors.textSecondary} />
          </View>

          <Pressable
            onPress={() => setShareOpen(true)}
            style={({ pressed }) => [styles.sharePreview, pressed && styles.pressed]}
          >
            <View style={styles.sharePoster}>
              <Text style={styles.sharePosterBrand}>UGEROD</Text>
              <Text style={styles.sharePosterEyebrow}>{highlight.eyebrow}</Text>
              <Text numberOfLines={2} style={styles.sharePosterTitle}>{highlight.title}</Text>
              <View style={styles.sharePosterMetaRow}>
                <Text style={styles.sharePosterMeta}>{duration} MIN</Text>
                <Text style={styles.sharePosterMeta}>·</Text>
                <Text style={styles.sharePosterMeta}>{environment.toUpperCase()}</Text>
              </View>
            </View>
            <View style={styles.sharePreviewCopy}>
              <Text style={styles.sharePreviewTitle}>Story UGEROD</Text>
              <Text style={styles.sharePreviewText}>Le fait marquant d’abord. Les détails ensuite.</Text>
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
          <Text style={styles.progressionLinkText}>Voir toute ma progression</Text>
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
                <Text style={styles.shareSheetTitle}>Ce qui compte.</Text>
              </View>
              <Pressable onPress={() => setShareOpen(false)} style={styles.closeButton}>
                <Ionicons name="close" size={20} color={colors.text} />
              </Pressable>
            </View>

            <View style={styles.storyFrame}>
              <StoryPreview workout={workout} blocks={shareBlocks} highlight={highlight} styles={styles} />
            </View>

            <Pressable
              onPress={handleNativeShare}
              style={({ pressed }) => [styles.shareButton, pressed && styles.primaryButtonPressed]}
            >
              <Ionicons name="share-social-outline" size={20} color={colors.textOnAccent} />
              <Text style={styles.shareButtonText}>Partager</Text>
            </Pressable>

            <Text style={styles.shareFallbackNote}>
              Aperçu V2 : l’export image sera activé après validation de cette direction visuelle. Le partage natif utilise encore le résumé texte.
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
      paddingHorizontal: 20,
      paddingTop: 8,
      paddingBottom: 30,
    },
    hero: {
      paddingTop: 6,
      paddingBottom: 30,
    },
    heroTopRow: {
      minHeight: 54,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    statusPill: {
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
      fontSize: 10,
      lineHeight: 14,
      letterSpacing: 1,
      color: colors.textSecondary,
    },
    brandIcon: { width: 44, height: 44 },
    heroTitle: {
      marginTop: 27,
      fontFamily: 'BebasNeue_400Regular',
      fontSize: 62,
      lineHeight: 61,
      letterSpacing: 1.4,
      color: colors.text,
    },
    dot: { color: colors.secondaryAccent },
    heroSubtitle: {
      maxWidth: 290,
      marginTop: 8,
      fontFamily: MANROPE.medium,
      fontSize: 14,
      lineHeight: 21,
      color: colors.textSecondary,
    },
    sessionFacts: {
      marginTop: 28,
      flexDirection: 'row',
      alignItems: 'center',
    },
    durationBlock: {
      minWidth: 72,
      alignItems: 'flex-start',
    },
    durationValue: {
      fontFamily: 'BebasNeue_400Regular',
      fontSize: 46,
      lineHeight: 44,
      letterSpacing: 1,
      color: colors.text,
    },
    durationUnit: {
      marginTop: -2,
      fontFamily: MANROPE.bold,
      fontSize: 8,
      lineHeight: 12,
      letterSpacing: 1.2,
      color: colors.textMuted,
    },
    factDivider: {
      width: 1,
      height: 44,
      marginHorizontal: 16,
      backgroundColor: colors.borderStrong,
    },
    sessionFactCopy: { flex: 1 },
    environment: {
      fontFamily: MANROPE.extraBold,
      fontSize: 12,
      lineHeight: 17,
      letterSpacing: 0.7,
      color: colors.text,
    },
    resultLine: {
      marginTop: 4,
      fontFamily: MANROPE.medium,
      fontSize: 12,
      lineHeight: 17,
      color: colors.textSecondary,
    },

    editorialSection: {
      paddingTop: 26,
      paddingBottom: 29,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    sectionEyebrow: {
      fontFamily: MANROPE.bold,
      fontSize: 9,
      lineHeight: 13,
      letterSpacing: 1.25,
      color: colors.textMuted,
    },
    inlineLoading: {
      minHeight: 94,
      marginTop: 19,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    inlineLoadingText: {
      fontFamily: MANROPE.medium,
      fontSize: 13,
      color: colors.textSecondary,
    },
    inlineError: { marginTop: 17 },
    inlineErrorTitle: {
      fontFamily: MANROPE.bold,
      fontSize: 18,
      lineHeight: 24,
      color: colors.text,
    },
    inlineErrorText: {
      marginTop: 5,
      maxWidth: 320,
      fontFamily: MANROPE.regular,
      fontSize: 12,
      lineHeight: 18,
      color: colors.textSecondary,
    },
    textButton: { alignSelf: 'flex-start', marginTop: 11 },
    textButtonLabel: {
      fontFamily: MANROPE.bold,
      fontSize: 11,
      color: colors.accent,
    },
    highlightBlock: { marginTop: 18 },
    highlightIcon: {
      width: 42,
      height: 42,
      borderRadius: 21,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.accentSoft,
    },
    highlightEyebrow: {
      marginTop: 19,
      fontFamily: MANROPE.bold,
      fontSize: 9,
      lineHeight: 13,
      letterSpacing: 1.1,
      color: colors.accent,
    },
    highlightTitle: {
      marginTop: 6,
      maxWidth: 330,
      fontFamily: 'BebasNeue_400Regular',
      fontSize: 35,
      lineHeight: 38,
      letterSpacing: 0.8,
      color: colors.text,
    },
    highlightText: {
      maxWidth: 330,
      marginTop: 6,
      fontFamily: MANROPE.regular,
      fontSize: 13,
      lineHeight: 20,
      color: colors.textSecondary,
    },

    coachSection: {
      marginHorizontal: -20,
      paddingHorizontal: 20,
      paddingTop: 25,
      paddingBottom: 24,
      backgroundColor: colors.surface,
      borderTopWidth: 1,
      borderBottomWidth: 1,
      borderColor: colors.border,
    },
    coachHeader: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: 16,
    },
    coachHeading: {
      marginTop: 5,
      fontFamily: MANROPE.extraBold,
      fontSize: 22,
      lineHeight: 28,
      letterSpacing: -0.5,
      color: colors.text,
    },
    coachMark: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.accentSoft,
    },
    coachPoint: { marginTop: 22 },
    coachPointLabel: {
      fontFamily: MANROPE.bold,
      fontSize: 9,
      lineHeight: 13,
      letterSpacing: 0.9,
      color: colors.accent,
    },
    coachPointText: {
      marginTop: 6,
      maxWidth: 335,
      fontFamily: MANROPE.medium,
      fontSize: 13,
      lineHeight: 20,
      color: colors.text,
    },
    coachSeparator: {
      width: 38,
      height: 2,
      marginTop: 20,
      borderRadius: 1,
      backgroundColor: colors.secondaryAccent,
    },
    trajectoryRow: {
      marginTop: 23,
      paddingTop: 15,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    trajectoryMain: { flex: 1 },
    trajectoryLabel: {
      fontFamily: MANROPE.bold,
      fontSize: 8,
      lineHeight: 12,
      letterSpacing: 0.8,
      color: colors.textMuted,
    },
    trajectoryTitle: {
      marginTop: 2,
      fontFamily: MANROPE.semiBold,
      fontSize: 12,
      lineHeight: 17,
      color: colors.text,
    },
    secondaryLoading: {
      marginTop: 18,
      fontFamily: MANROPE.medium,
      fontSize: 10,
      color: colors.textMuted,
    },

    questionCard: {
      marginTop: 20,
      paddingVertical: 18,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    questionHeader: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 11,
    },
    questionIcon: {
      width: 38,
      height: 38,
      borderRadius: 19,
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

    shareSection: {
      paddingTop: 29,
      paddingBottom: 7,
    },
    shareHeadingRow: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      justifyContent: 'space-between',
      gap: 12,
    },
    shareHeadingCopy: { flex: 1 },
    shareHeading: {
      maxWidth: 290,
      marginTop: 5,
      fontFamily: MANROPE.bold,
      fontSize: 18,
      lineHeight: 24,
      letterSpacing: -0.2,
      color: colors.text,
    },
    sharePreview: {
      marginTop: 16,
      minHeight: 154,
      padding: 11,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 13,
    },
    sharePoster: {
      width: 92,
      height: 132,
      borderRadius: 15,
      padding: 10,
      backgroundColor: colors.background,
      borderWidth: 1,
      borderColor: colors.borderStrong,
      justifyContent: 'space-between',
    },
    sharePosterBrand: {
      fontFamily: 'BebasNeue_400Regular',
      fontSize: 15,
      letterSpacing: 1,
      color: colors.text,
    },
    sharePosterEyebrow: {
      marginTop: 15,
      fontFamily: MANROPE.bold,
      fontSize: 5.5,
      lineHeight: 8,
      letterSpacing: 0.65,
      color: colors.secondaryAccent,
    },
    sharePosterTitle: {
      flex: 1,
      marginTop: 3,
      fontFamily: 'BebasNeue_400Regular',
      fontSize: 16,
      lineHeight: 17,
      letterSpacing: 0.5,
      color: colors.text,
    },
    sharePosterMetaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
    },
    sharePosterMeta: {
      fontFamily: MANROPE.bold,
      fontSize: 5.5,
      letterSpacing: 0.45,
      color: colors.textMuted,
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
      backgroundColor: 'rgba(0,0,0,0.64)',
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
    storyHeader: {},
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
    storyHero: {
      marginTop: 27,
      paddingBottom: 18,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    storyHeroLabel: {
      fontFamily: MANROPE.bold,
      fontSize: 7,
      lineHeight: 10,
      letterSpacing: 0.8,
      color: colors.secondaryAccent,
    },
    storyHeroTitle: {
      marginTop: 5,
      fontFamily: 'BebasNeue_400Regular',
      fontSize: 29,
      lineHeight: 30,
      letterSpacing: 0.7,
      color: colors.text,
    },
    storyHeroText: {
      marginTop: 5,
      fontFamily: MANROPE.medium,
      fontSize: 7,
      lineHeight: 11,
      color: colors.textSecondary,
    },
    storyBlocks: {
      flex: 1,
      marginTop: 16,
      gap: 11,
    },
    storyBlock: {},
    storyBlockLabel: {
      fontFamily: MANROPE.bold,
      fontSize: 7,
      letterSpacing: 0.9,
      color: colors.accent,
    },
    storyExerciseName: {
      marginTop: 3,
      fontFamily: MANROPE.semiBold,
      fontSize: 8,
      lineHeight: 11,
      color: colors.text,
    },
    storyResultValue: {
      marginTop: 3,
      fontFamily: 'BebasNeue_400Regular',
      fontSize: 19,
      lineHeight: 21,
      color: colors.text,
    },
    storyFooter: {
      paddingTop: 10,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    storyFooterText: {
      fontFamily: MANROPE.bold,
      fontSize: 6.5,
      letterSpacing: 0.85,
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
    shareFallbackNote: {
      marginTop: 10,
      fontFamily: MANROPE.regular,
      fontSize: 8,
      lineHeight: 12,
      textAlign: 'center',
      color: colors.textMuted,
    },

    bottomSpace: { height: 20 },
    pressed: { opacity: 0.7 },
  });
}
