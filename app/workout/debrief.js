import { useCallback, useEffect, useMemo, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import {
  ActivityIndicator,
  Image,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { colors, spacing, typography } from '../../src/constants';
import {
  getProgressionDataContract,
  getSessionLearningSnapshot,
} from '../../src/services/progressionDataService';
import {
  getObservationQuestionNeed,
  submitSkillTechnicalFeedback,
} from '../../src/services/observationService';

const brandIcon = require('../../assets/branding/ugerod-icon.png');

function firstParam(value) {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}

function plural(value, singular, pluralForm = `${singular}s`) {
  return Number(value) > 1 ? pluralForm : singular;
}

function joinNames(names) {
  const clean = names.filter(Boolean);

  if (clean.length <= 1) {
    return clean[0] ?? '';
  }

  if (clean.length === 2) {
    return `${clean[0]} et ${clean[1]}`;
  }

  return `${clean.slice(0, -1).join(', ')} et ${clean[clean.length - 1]}`;
}

function buildLearningText(snapshot) {
  const summary = snapshot?.summary ?? {};
  const references = Number(summary.reference_observations ?? 0);
  const stateSignals = Number(summary.state_signal_observations ?? 0);
  const observations = Array.isArray(snapshot?.observations)
    ? snapshot.observations
    : [];

  const missingNames = observations
    .filter((item) => item?.proof_class === 'MISSING_METRIC')
    .map((item) => item?.exercise_name)
    .filter(Boolean)
    .slice(0, 2);

  if (references > 0 && missingNames.length > 0) {
    return `${references} ${plural(references, 'mouvement')} ont fourni de nouvelles références exploitables. ${joinNames(missingNames)} ${missingNames.length > 1 ? "n'ont" : "n'a"} pas fourni assez de mesure pour modifier ton niveau.`;
  }

  if (references > 0) {
    return `${references} ${plural(references, 'mouvement')} ont fourni de nouvelles références exploitables pour mieux calibrer tes prochaines séances.`;
  }

  if (missingNames.length > 0) {
    return `${joinNames(missingNames)} ${missingNames.length > 1 ? "n'ont" : "n'a"} pas fourni assez de mesure pour modifier ton niveau. L'exposition reste mémorisée.`;
  }

  if (stateSignals > 0) {
    return 'UGEROD a surtout enregistré des informations sur ton état et le déroulement de la séance. Elles aideront à adapter la suite sans être prises pour une preuve de niveau.';
  }

  return 'La séance enrichit ton historique, mais elle ne fournit pas encore de nouvelle référence suffisamment mesurable pour modifier ton niveau.';
}

function buildContextText(snapshot) {
  const concentration =
    snapshot?.wod_performance_context?.muscular_concentration ?? {};

  if (concentration?.status === 'SOFT_OVERCONCENTRATION') {
    const dominant = concentration?.dominant_primary_muscle;
    const observations = Array.isArray(snapshot?.observations)
      ? snapshot.observations
      : [];
    const affected = observations
      .filter((item) =>
        item?.proof_class === 'CONTEXTUAL_REFERENCE' &&
        Array.isArray(item?.context_modifiers) &&
        item.context_modifiers.some(
          (modifier) =>
            modifier?.type === 'LOCAL_MUSCLE_CONCENTRATION' &&
            modifier?.exercise_matches_dominant_muscle === true
        )
      )
      .map((item) => item?.exercise_name)
      .filter(Boolean)
      .slice(0, 3);

    const movementText = affected.length
      ? ` notamment sur ${joinNames(affected)}`
      : '';

    return `Ce WOD était très concentré sur ${dominant ? `les ${dominant.toLowerCase()}` : 'une même zone musculaire'}. Tes résultats${movementText} sont enregistrés avec ce contexte.`;
  }

  return "UGEROD conserve le format du WOD, la prescription et le contexte d'exécution avec chaque référence afin de comparer des performances réellement comparables.";
}

function buildChangeText(progression) {
  const movements = Array.isArray(progression?.movement_capabilities)
    ? progression.movement_capabilities
    : [];
  const progressing = movements.find((item) => item?.signal === 'PROGRESSING');
  const recalibrating = movements.find((item) => item?.signal === 'RECALIBRATING');
  const overallState = progression?.overall?.state;
  const maturity = progression?.maturity?.stage;

  if (overallState === 'PROGRESSING' && progressing?.name) {
    return `${progressing.name} montre un signal de progression. UGEROD continuera à chercher une confirmation avant d'en faire une nouvelle référence solide.`;
  }

  if (overallState === 'RECALIBRATING' && recalibrating?.name) {
    return `${recalibrating.name} mérite d'être recalibré. Une prochaine exposition comparable aidera UGEROD à ajuster cette référence proprement.`;
  }

  if (maturity === 'ESTABLISHED') {
    return 'Ton profil est déjà suffisamment établi pour que cette séance affine les prochaines décisions sans provoquer de changement artificiel sur une seule observation.';
  }

  return 'Trop tôt pour augmenter une référence. UGEROD continue de consolider ton profil avant de faire évoluer la difficulté.';
}

function DebriefCard({ icon, eyebrow, text, accent = 'blue' }) {
  const isRed = accent === 'red';

  return (
    <View style={styles.card}>
      <View style={[styles.cardIcon, isRed && styles.cardIconRed]}>
        <Ionicons
          name={icon}
          size={21}
          color={isRed ? colors.brandRed : colors.primaryLight}
        />
      </View>

      <View style={styles.cardMain}>
        <Text style={styles.cardEyebrow}>{eyebrow}</Text>
        <Text style={styles.cardText}>{text}</Text>
      </View>
    </View>
  );
}

function SkillQuestionCard({ question, value, saving, error, onSelect }) {
  if (!question?.should_ask) {
    return null;
  }

  const options = Array.isArray(question.options)
    ? question.options
    : ['PROPRE', 'LIMITE', 'PAS_ENCORE'];

  return (
    <View style={styles.questionCard}>
      <View style={styles.questionHeader}>
        <View style={styles.questionIcon}>
          <Ionicons name="eye-outline" size={19} color={colors.primaryLight} />
        </View>
        <View style={styles.questionMain}>
          <Text style={styles.questionEyebrow}>UNE INFO QUE JE NE PEUX PAS VOIR</Text>
          <Text style={styles.questionTitle}>{question.question_text ?? 'Sur le Skill, ta technique était…'}</Text>
          <Text style={styles.questionText}>
            Je te le demande uniquement parce que ta réponse peut changer la prochaine étape du Skill.
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
                {String(option).replace('_', ' ')}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {saving ? (
        <View style={styles.questionStatus}>
          <ActivityIndicator size="small" color={colors.primaryLight} />
          <Text style={styles.questionStatusText}>J’ENREGISTRE…</Text>
        </View>
      ) : null}

      {value && !saving ? (
        <Text style={styles.questionSaved}>
          Pris en compte. Cette réponse ne crée pas une performance : elle sert uniquement à éviter une progression technique prématurée.
        </Text>
      ) : null}

      {error ? <Text style={styles.questionError}>{error}</Text> : null}
    </View>
  );
}

export default function WorkoutDebriefScreen() {
  const params = useLocalSearchParams();
  const sessionId = firstParam(params?.sessionId);

  const [snapshot, setSnapshot] = useState(null);
  const [progression, setProgression] = useState(null);
  const [skillQuestion, setSkillQuestion] = useState(null);
  const [skillFeedback, setSkillFeedback] = useState(null);
  const [skillFeedbackSaving, setSkillFeedbackSaving] = useState(false);
  const [skillFeedbackError, setSkillFeedbackError] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      if (!sessionId) {
        throw new Error('Session manquante pour le débrief Coach.');
      }

      const [sessionLearning, progressionData, questionNeed] = await Promise.all([
        getSessionLearningSnapshot(sessionId),
        getProgressionDataContract('4w'),
        getObservationQuestionNeed(
          sessionId,
          'SKILL_TECHNICAL_QUALITY'
        ).catch(() => ({ should_ask: false, reason: 'QUESTION_UNAVAILABLE' })),
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

  const learningText = useMemo(
    () => buildLearningText(snapshot),
    [snapshot]
  );
  const contextText = useMemo(
    () => buildContextText(snapshot),
    [snapshot]
  );
  const changeText = useMemo(
    () => buildChangeText(progression),
    [progression]
  );

  const handleSkillFeedback = useCallback(async (feedback) => {
    if (!skillQuestion?.session_exercise_id || skillFeedbackSaving) {
      return;
    }

    setSkillFeedbackSaving(true);
    setSkillFeedbackError('');

    try {
      await submitSkillTechnicalFeedback({
        sessionExerciseId: skillQuestion.session_exercise_id,
        feedback,
      });
      setSkillFeedback(feedback);
    } catch (feedbackError) {
      setSkillFeedbackError(
        feedbackError?.message ??
          'Impossible d’enregistrer ce retour.'
      );
    } finally {
      setSkillFeedbackSaving(false);
    }
  }, [skillFeedbackSaving, skillQuestion?.session_exercise_id]);

  function handleFinish() {
    router.replace('/(tabs)');
  }

  function handleProgression() {
    router.replace('/(tabs)/progression');
  }

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text style={styles.eyebrow}>COACH UGEROD</Text>
            <Text style={styles.title}>
              CE QU’UGEROD RETIENT<Text style={styles.blueDot}>.</Text>
            </Text>
          </View>

          <Image source={brandIcon} style={styles.brandIcon} resizeMode="contain" />
        </View>

        <View style={styles.heroCard}>
          <View style={styles.heroIcon}>
            <Ionicons name="checkmark" size={25} color={colors.brandWhite} />
          </View>
          <View style={styles.heroMain}>
            <Text style={styles.heroTitle}>SÉANCE ENREGISTRÉE</Text>
            <Text style={styles.heroText}>
              Tes données sont sauvegardées. Le Coach te montre uniquement ce qu’il peut réellement en déduire.
            </Text>
          </View>
        </View>

        {loading ? (
          <View style={styles.loadingCard}>
            <ActivityIndicator color={colors.primaryLight} />
            <Text style={styles.loadingText}>ANALYSE DE LA SÉANCE...</Text>
          </View>
        ) : error ? (
          <View style={styles.errorCard}>
            <Ionicons name="information-circle-outline" size={21} color={colors.textSecondary} />
            <View style={styles.errorMain}>
              <Text style={styles.errorTitle}>ANALYSE TEMPORAIREMENT INDISPONIBLE</Text>
              <Text style={styles.errorText}>{error}</Text>
              <Pressable onPress={load} style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}>
                <Text style={styles.retryText}>RÉESSAYER</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <>
            <Text style={styles.groupTitle}>CE QUE JE RETIENS</Text>
            <DebriefCard
              icon="analytics-outline"
              eyebrow="OBSERVATION"
              text={learningText}
            />

            <DebriefCard
              icon="layers-outline"
              eyebrow="CONTEXTE"
              text={contextText}
            />

            <Text style={styles.groupTitle}>POUR LA SUITE</Text>
            <DebriefCard
              icon="navigate-outline"
              eyebrow="IMPACT COACH"
              text={changeText}
              accent="red"
            />

            <SkillQuestionCard
              question={skillQuestion}
              value={skillFeedback}
              saving={skillFeedbackSaving}
              error={skillFeedbackError}
              onSelect={handleSkillFeedback}
            />
          </>
        )}

        <Pressable
          onPress={handleFinish}
          style={({ pressed }) => [styles.primaryButton, pressed && styles.primaryButtonPressed]}
        >
          <Text style={styles.primaryButtonText}>TERMINER</Text>
          <Ionicons name="arrow-forward" size={20} color={colors.brandWhite} />
        </Pressable>

        <Pressable
          onPress={handleProgression}
          style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
        >
          <Ionicons name="stats-chart-outline" size={19} color={colors.primaryLight} />
          <Text style={styles.secondaryButtonText}>VOIR MA PROGRESSION</Text>
        </Pressable>

        <Text style={styles.footerNote}>
          Une seule séance ne suffit pas toujours à modifier une référence. UGEROD privilégie les preuves répétées et comparables.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    paddingBottom: 42,
  },
  header: {
    minHeight: 86,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  headerText: {
    flex: 1,
  },
  eyebrow: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 10,
    letterSpacing: 1.1,
    color: colors.brandRed,
  },
  title: {
    ...typography.display,
    marginTop: 2,
    fontSize: 31,
    lineHeight: 34,
    letterSpacing: 1.2,
    color: colors.textPrimary,
  },
  blueDot: {
    color: colors.primaryLight,
  },
  brandIcon: {
    width: 42,
    height: 42,
  },
  heroCard: {
    marginTop: 8,
    padding: 16,
    borderRadius: 18,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: 'rgba(8,104,255,0.30)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  heroIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroMain: {
    flex: 1,
  },
  heroTitle: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 24,
    lineHeight: 27,
    letterSpacing: 1,
    color: colors.textPrimary,
  },
  heroText: {
    marginTop: 3,
    fontFamily: 'Oswald_400Regular',
    fontSize: 10,
    lineHeight: 15,
    color: colors.textSecondary,
  },
  loadingCard: {
    minHeight: 150,
    marginTop: 16,
    borderRadius: 18,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 11,
  },
  loadingText: {
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 10,
    letterSpacing: 0.8,
    color: colors.textMuted,
  },
  groupTitle: {
    marginTop: 20,
    marginBottom: -2,
    fontFamily: 'Oswald_700Bold',
    fontSize: 9,
    letterSpacing: 1,
    color: colors.textMuted,
  },
  card: {
    marginTop: 12,
    padding: 15,
    borderRadius: 17,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  cardIcon: {
    width: 40,
    height: 40,
    borderRadius: 13,
    backgroundColor: 'rgba(8,104,255,0.13)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardIconRed: {
    backgroundColor: 'rgba(227,27,35,0.10)',
  },
  cardMain: {
    flex: 1,
  },
  cardEyebrow: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 9,
    letterSpacing: 0.9,
    color: colors.textMuted,
  },
  cardText: {
    marginTop: 5,
    fontFamily: 'Oswald_400Regular',
    fontSize: 12,
    lineHeight: 18,
    color: colors.textPrimary,
  },
  questionCard: {
    marginTop: 12,
    padding: 15,
    borderRadius: 17,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: 'rgba(8,104,255,0.30)',
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
    backgroundColor: 'rgba(8,104,255,0.13)',
  },
  questionMain: { flex: 1 },
  questionEyebrow: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 8,
    letterSpacing: 0.8,
    color: colors.primaryLight,
  },
  questionTitle: {
    marginTop: 4,
    fontFamily: 'Oswald_700Bold',
    fontSize: 13,
    lineHeight: 18,
    color: colors.textPrimary,
  },
  questionText: {
    marginTop: 4,
    fontFamily: 'Oswald_400Regular',
    fontSize: 10,
    lineHeight: 15,
    color: colors.textSecondary,
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
  },
  optionButtonSelected: {
    borderColor: 'rgba(8,104,255,0.55)',
    backgroundColor: 'rgba(8,104,255,0.13)',
  },
  optionText: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 9,
    letterSpacing: 0.45,
    color: colors.textMuted,
  },
  optionTextSelected: { color: colors.primaryLight },
  questionStatus: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  questionStatusText: {
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 9,
    color: colors.textMuted,
  },
  questionSaved: {
    marginTop: 10,
    fontFamily: 'Oswald_400Regular',
    fontSize: 9,
    lineHeight: 14,
    color: colors.textSecondary,
  },
  questionError: {
    marginTop: 9,
    fontFamily: 'Oswald_400Regular',
    fontSize: 9,
    color: colors.brandRed,
  },
  errorCard: {
    marginTop: 16,
    padding: 15,
    borderRadius: 17,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 11,
  },
  errorMain: {
    flex: 1,
  },
  errorTitle: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 10,
    letterSpacing: 0.65,
    color: colors.textPrimary,
  },
  errorText: {
    marginTop: 4,
    fontFamily: 'Oswald_400Regular',
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
    borderColor: 'rgba(8,104,255,0.40)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryText: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 9,
    letterSpacing: 0.7,
    color: colors.primaryLight,
  },
  primaryButton: {
    minHeight: 58,
    marginTop: 24,
    borderRadius: 14,
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  primaryButtonPressed: {
    transform: [{ scale: 0.985 }],
  },
  primaryButtonText: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 20,
    letterSpacing: 1,
    color: colors.brandWhite,
  },
  secondaryButton: {
    minHeight: 50,
    marginTop: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(8,104,255,0.36)',
    backgroundColor: 'rgba(8,104,255,0.08)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  secondaryButtonText: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 10,
    letterSpacing: 0.8,
    color: colors.primaryLight,
  },
  footerNote: {
    marginTop: 13,
    paddingHorizontal: 10,
    textAlign: 'center',
    fontFamily: 'Oswald_400Regular',
    fontSize: 9,
    lineHeight: 14,
    color: colors.textMuted,
  },
  pressed: {
    opacity: 0.68,
  },
});
