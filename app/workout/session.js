import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import SessionCore from './session-core';
import SessionOverviewSheet from '../../src/components/workout/SessionOverviewSheet';
import SessionWhySheet from '../../src/components/workout/SessionWhySheet';
import SessionAdaptationSheet from '../../src/components/workout/SessionAdaptationSheet';
import { useUgerodTheme } from '../../src/contexts/UgerodThemeContext';
import { useWorkout } from '../../src/contexts/WorkoutContext';
import {
  changeWholeWorkoutPlan,
  changeWorkoutSkillPlan,
} from '../../src/services/skillPlanService';

function normalizeBlock(value) {
  const key = String(value ?? '').trim().toLowerCase();
  return key === 'warm_up' ? 'warmup' : key;
}

function exerciseHasRecordedResult(exercise) {
  const status = String(exercise?.userExecutionStatus ?? exercise?.status ?? 'pending')
    .trim()
    .toLowerCase();
  return ['completed', 'adapted', 'not_completed', 'skipped'].includes(status);
}

function hasRecordedProgress(workout) {
  if ((workout?.validatedBlocks ?? []).length > 0) return true;
  if (workout?.wodRuntime?.started || workout?.wodStarted || workout?.wodStartedAt) return true;
  return (workout?.exercises ?? []).some(exerciseHasRecordedResult);
}

function visibleWorkoutFingerprint(workout) {
  return JSON.stringify({
    format: workout?.format ?? null,
    mechanic: workout?.mechanic ?? null,
    exercises: (workout?.exercises ?? []).map((exercise) => [
      normalizeBlock(exercise?.blockKey ?? exercise?.block),
      exercise?.exerciseId ?? exercise?.id ?? null,
      exercise?.prescription ?? null,
    ]),
  });
}

function verifyPlanBReplacement({ sourceWorkout, result, nextWorkout }) {
  const sourceSessionId = sourceWorkout?.sessionId ?? null;
  const nextSessionId = nextWorkout?.sessionId ?? null;
  const returnedSessionId = result?.new_session_id ?? null;

  if (!nextSessionId) {
    throw new Error('Plan B a répondu sans nouvelle séance exploitable.');
  }

  if (sourceSessionId && nextSessionId === sourceSessionId) {
    throw new Error('Plan B n’a pas remplacé la séance affichée.');
  }

  if (returnedSessionId && returnedSessionId !== nextSessionId) {
    throw new Error('La séance Plan B rechargée ne correspond pas à la proposition créée.');
  }

  if (visibleWorkoutFingerprint(sourceWorkout) === visibleWorkoutFingerprint(nextWorkout)) {
    throw new Error('UGEROD a généré une alternative, mais elle est identique à l’écran. Réessaie.');
  }
}

export default function SessionScreen() {
  const { workout, setGeneratedWorkout } = useWorkout();
  const { colors, isDark } = useUgerodTheme();
  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);

  const [planBOpen, setPlanBOpen] = useState(false);
  const [busyAction, setBusyAction] = useState(null);
  const [overviewOpen, setOverviewOpen] = useState(false);
  const [whyOpen, setWhyOpen] = useState(false);
  const [adaptationOpen, setAdaptationOpen] = useState(false);
  const overviewShownForSessionRef = useRef(null);

  const progressRecorded = hasRecordedProgress(workout);
  const hasResumeCursor = Boolean(
    workout?.playerCursor?.blockId &&
      (!workout?.playerCursor?.sessionId || workout.playerCursor.sessionId === workout?.sessionId)
  );

  const hasSkill = useMemo(
    () =>
      (workout?.exercises ?? []).some(
        (exercise) => normalizeBlock(exercise?.blockKey ?? exercise?.block) === 'skill'
      ) ||
      (workout?.rawBlocks ?? []).some(
        (block) => normalizeBlock(block?.block_key ?? block?.blockKey) === 'skill'
      ),
    [workout?.exercises, workout?.rawBlocks]
  );

  // PLAY-014: même règle pour Maison, Box, Salle et Extérieur.
  // L'environnement adapte le contenu de la séance, jamais les capacités du Player.
  const canRegeneratePlanB = Boolean(workout?.sessionId) && !progressRecorded;
  const showPlanBEntry = canRegeneratePlanB;
  const canChangeSkill = canRegeneratePlanB && hasSkill;

  useEffect(() => {
    if (!workout?.sessionId || overviewShownForSessionRef.current === workout.sessionId) return;
    overviewShownForSessionRef.current = workout.sessionId;
    if (!progressRecorded && !hasResumeCursor) setOverviewOpen(true);
  }, [hasResumeCursor, progressRecorded, workout?.sessionId]);

  useEffect(() => {
    if (progressRecorded && planBOpen) setPlanBOpen(false);
  }, [planBOpen, progressRecorded]);

  function openPlanBFromOverview() {
    if (busyAction || !canRegeneratePlanB) return;
    setPlanBOpen(true);
  }

  async function applySkillPlanB(action) {
    if (busyAction) return { ok: false, error: 'Une modification est déjà en cours.' };
    if (!canChangeSkill) {
      return { ok: false, error: 'Plan B n’est plus disponible une fois la séance commencée.' };
    }

    const sourceWorkout = workout;

    try {
      setBusyAction(action);
      const { result, workout: nextWorkout } = await changeWorkoutSkillPlan({
        sessionId: sourceWorkout.sessionId,
        action,
        preparationSnapshot: sourceWorkout.preparationSnapshot ?? null,
      });

      verifyPlanBReplacement({ sourceWorkout, result, nextWorkout });
      setGeneratedWorkout({ ...nextWorkout, playerCursor: null });
      setPlanBOpen(false);
      setOverviewOpen(true);

      Alert.alert(
        'Plan B appliqué',
        action === 'SKIP_SKILL' ? 'Le Skill a été retiré et ta séance a été réorganisée.' : 'Un nouveau Skill a été préparé.'
      );
      return { ok: true };
    } catch (error) {
      console.warn('Plan B Skill', error);
      return {
        ok: false,
        error: error?.message ?? 'UGEROD n’a pas trouvé d’alternative Skill cohérente.',
      };
    } finally {
      setBusyAction(null);
    }
  }

  async function applyWholePlanB() {
    if (busyAction) return { ok: false, error: 'Une modification est déjà en cours.' };
    if (!canRegeneratePlanB) {
      return { ok: false, error: 'Plan B n’est plus disponible une fois la séance commencée.' };
    }

    const sourceWorkout = workout;

    try {
      setBusyAction('ALTERNATE_SESSION');
      const { result, workout: nextWorkout } = await changeWholeWorkoutPlan({
        sessionId: sourceWorkout.sessionId,
        preparationSnapshot: sourceWorkout.preparationSnapshot ?? null,
      });

      verifyPlanBReplacement({ sourceWorkout, result, nextWorkout });
      setGeneratedWorkout({ ...nextWorkout, playerCursor: null });
      setPlanBOpen(false);
      setOverviewOpen(true);

      Alert.alert('Plan B appliqué', 'Une nouvelle séance a été préparée avec le même check-in.');
      return { ok: true };
    } catch (error) {
      console.warn('Plan B session', error);
      return {
        ok: false,
        error: error?.message ?? 'UGEROD n’a pas trouvé d’autre séance suffisamment différente.',
      };
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <SessionCore
        onOpenOverview={() => {
          setPlanBOpen(false);
          setOverviewOpen(true);
        }}
        onOpenPlanB={() => {
          if (!canRegeneratePlanB) return;
          setOverviewOpen(true);
          setPlanBOpen(true);
        }}
        onOpenWhy={() => setWhyOpen(true)}
        onOpenAdjust={() => setAdaptationOpen(true)}
        showPlanB={showPlanBEntry}
      />

      <SessionOverviewSheet
        key={`session-overview:${workout?.sessionId ?? 'none'}`}
        visible={overviewOpen}
        onClose={() => {
          setPlanBOpen(false);
          setOverviewOpen(false);
        }}
        showPlanB={canRegeneratePlanB}
        onPlanB={openPlanBFromOverview}
        planBOpen={planBOpen}
        canRegeneratePlanB={canRegeneratePlanB}
        canChangeSkill={canChangeSkill}
        hasSkill={hasSkill}
        progressRecorded={progressRecorded}
        busyAction={busyAction}
        onClosePlanB={() => setPlanBOpen(false)}
        onAlternateSkill={() => applySkillPlanB('ALTERNATE_SKILL')}
        onSkipSkill={() => applySkillPlanB('SKIP_SKILL')}
        onAlternateSession={applyWholePlanB}
      />

      <SessionWhySheet visible={whyOpen} onClose={() => setWhyOpen(false)} />
      <SessionAdaptationSheet
        visible={adaptationOpen}
        onClose={() => setAdaptationOpen(false)}
      />
    </View>
  );
}

function createStyles() {
  return StyleSheet.create({
    root: { flex: 1 },
  });
}
