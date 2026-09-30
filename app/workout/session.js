import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';

import SessionCore from './session-core';
import EnvironmentSessionCore from './environment-session-core';
import SessionOverviewSheet from '../../src/components/workout/SessionOverviewSheet';
import SessionWhySheet from '../../src/components/workout/SessionWhySheet';
import SessionAdaptationSheet from '../../src/components/workout/SessionAdaptationSheet';
import { useUgerodTheme } from '../../src/contexts/UgerodThemeContext';
import { useWorkout } from '../../src/contexts/WorkoutContext';
import {
  changeWholeWorkoutPlan,
  changeWorkoutSkillPlan,
  getWorkoutSessionLifecycle,
  markWorkoutSessionStarted,
} from '../../src/services/sessionMutationService';

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
  const { workout, updateWorkout, setGeneratedWorkout } = useWorkout();
  const { colors } = useUgerodTheme();
  const styles = useMemo(() => createStyles(), []);

  const [planBOpen, setPlanBOpen] = useState(false);
  const [busyAction, setBusyAction] = useState(null);
  const [overviewOpen, setOverviewOpen] = useState(false);
  const [whyOpen, setWhyOpen] = useState(false);
  const [whyReturnToOverview, setWhyReturnToOverview] = useState(false);
  const [adaptationOpen, setAdaptationOpen] = useState(false);
  const [startBusy, setStartBusy] = useState(false);
  const [lifecycleReady, setLifecycleReady] = useState(false);
  const overviewShownForSessionRef = useRef(null);

  const environmentCode = useMemo(
    () =>
      String(
        workout?.meta?.environment_code ??
          workout?.meta?.environmentCode ??
          workout?.preparationSnapshot?.environmentCode ??
          ''
      )
        .trim()
        .toUpperCase(),
    [
      workout?.meta?.environmentCode,
      workout?.meta?.environment_code,
      workout?.preparationSnapshot?.environmentCode,
    ]
  );

  // Le backend est l'autorité du cycle de vie. On hydrate explicitement l'état
  // avant d'autoriser un player local à enregistrer une exécution ou à révéler le WOD.
  useEffect(() => {
    let cancelled = false;
    const sessionId = workout?.sessionId ?? null;

    setLifecycleReady(false);

    if (!sessionId) {
      return () => {
        cancelled = true;
      };
    }

    getWorkoutSessionLifecycle(sessionId)
      .then((lifecycle) => {
        if (cancelled || lifecycle?.sessionId !== sessionId) return;

        updateWorkout({
          sessionStarted: Boolean(lifecycle?.sessionStarted),
          sessionClosed: Boolean(lifecycle?.sessionClosed),
          lifecycleStage: lifecycle?.lifecycleStage ?? null,
          status: lifecycle?.status ?? workout?.status ?? 'generated',
          startedAt: lifecycle?.startedAt ?? null,
          startedLocalDate: lifecycle?.startedLocalDate ?? null,
          wodRevealed: Boolean(lifecycle?.wodRevealed),
          wodRevealedAt: lifecycle?.wodRevealedAt ?? null,
          wodStarted: Boolean(lifecycle?.wodStarted),
          wodStartedAt: lifecycle?.wodStartedAt ?? null,
          ...(lifecycle?.wodStarted
            ? {}
            : {
                wodRuntime: workout?.wodRuntime?.started ? null : workout?.wodRuntime ?? null,
              }),
        });
        setLifecycleReady(true);
      })
      .catch((error) => {
        if (cancelled) return;
        console.warn('Session lifecycle hydration', error);
        // Fail closed: tant que le backend n'a pas confirmé l'état, aucun player
        // ne peut enregistrer d'exécution et le WOD reste masqué.
        setLifecycleReady(false);
      });

    return () => {
      cancelled = true;
    };
  }, [workout?.sessionId]);

  const authoritativeSessionStarted = Boolean(
    lifecycleReady &&
      workout?.sessionStarted &&
      !workout?.sessionClosed
  );

  // GYM et OUTDOOR conservent leurs runtimes spécialisés (séries, cardio, course),
  // mais leur shell et leurs actions sont alignés sur le Player commun.
  const usesSpecializedEnvironmentRuntime = ['GYM', 'OUTDOOR'].includes(environmentCode);
  const progressRecorded = hasRecordedProgress(workout);
  const hasResumeCursor = Boolean(
    authoritativeSessionStarted &&
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

  // UI rule shared by every environment. Backend remains authoritative on whether
  // an actual alternative can be produced.
  const canRegeneratePlanB =
    Boolean(workout?.sessionId) &&
    lifecycleReady &&
    !workout?.sessionClosed &&
    !authoritativeSessionStarted &&
    !progressRecorded;
  const showPlanBEntry = canRegeneratePlanB;
  const canChangeSkill = canRegeneratePlanB && hasSkill;

  useEffect(() => {
    if (!workout?.sessionId || overviewShownForSessionRef.current === workout.sessionId) return;
    overviewShownForSessionRef.current = workout.sessionId;
    if (!progressRecorded && !hasResumeCursor) setOverviewOpen(true);
  }, [hasResumeCursor, progressRecorded, workout?.sessionId]);

  useEffect(() => {
    if ((progressRecorded || authoritativeSessionStarted) && planBOpen) setPlanBOpen(false);
  }, [authoritativeSessionStarted, planBOpen, progressRecorded]);

  function openPlanBFromOverview() {
    if (busyAction || !canRegeneratePlanB) return;
    setPlanBOpen(true);
  }

  function openWhyFromOverview() {
    // Avoid stacking two full-screen Modals on React Native Web / iOS Safari.
    // Close the overview first, then open the Coach sheet on the next frame.
    setPlanBOpen(false);
    setWhyReturnToOverview(true);
    setOverviewOpen(false);
    requestAnimationFrame(() => setWhyOpen(true));
  }

  function openWhyFromPlayer() {
    setWhyReturnToOverview(false);
    setWhyOpen(true);
  }

  function closeWhy() {
    setWhyOpen(false);

    if (whyReturnToOverview) {
      setWhyReturnToOverview(false);
      requestAnimationFrame(() => setOverviewOpen(true));
    }
  }

  async function startSessionExplicitly() {
    if (!workout?.sessionId || authoritativeSessionStarted || startBusy) return;

    try {
      setStartBusy(true);
      const result = await markWorkoutSessionStarted({ sessionId: workout.sessionId });

      if (result?.status === 'STALE_SESSION_REQUIRES_RECHECKIN') {
        Alert.alert(
          'Check-in à refaire',
          'Ton contexte a trop changé depuis la génération. Reviens au check-in avant de démarrer.'
        );
        router.replace('/workout/preparation');
        return;
      }

      updateWorkout({
        sessionStarted: true,
        status: 'in_progress',
        startedAt: result?.started_at ?? workout?.startedAt ?? new Date().toISOString(),
        startedLocalDate: result?.started_local_date ?? workout?.startedLocalDate ?? null,
      });
      setLifecycleReady(true);
      setPlanBOpen(false);
    } catch (error) {
      Alert.alert(
        'Impossible de démarrer la séance',
        error?.message ?? 'Réessaie dans quelques secondes.'
      );
    } finally {
      setStartBusy(false);
    }
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
        action === 'SKIP_SKILL'
          ? 'Le Skill a été retiré et ta séance a été réorganisée.'
          : 'Un nouveau Skill a été préparé.'
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

  const commonPlayerActions = {
    onOpenOverview: () => {
      setPlanBOpen(false);
      setOverviewOpen(true);
    },
    onOpenPlanB: () => {
      if (!canRegeneratePlanB) return;
      setOverviewOpen(true);
      setPlanBOpen(true);
    },
    onOpenWhy: openWhyFromPlayer,
    onOpenAdjust: () => {
      if (!authoritativeSessionStarted) return;
      setAdaptationOpen(true);
    },
    onStartSession: startSessionExplicitly,
    startBusy,
    lifecycleReady,
    sessionStarted: authoritativeSessionStarted,
    showAdjust: authoritativeSessionStarted,
    showPlanB: showPlanBEntry,
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {usesSpecializedEnvironmentRuntime ? (
        <EnvironmentSessionCore
          environmentCode={environmentCode}
          {...commonPlayerActions}
        />
      ) : (
        <SessionCore {...commonPlayerActions} />
      )}

      <SessionOverviewSheet
        key={`session-overview:${workout?.sessionId ?? 'none'}`}
        visible={overviewOpen}
        onClose={() => {
          setPlanBOpen(false);
          setOverviewOpen(false);
        }}
        showPlanB={canRegeneratePlanB}
        onPlanB={openPlanBFromOverview}
        onOpenWhy={openWhyFromOverview}
        planBOpen={planBOpen}
        canRegeneratePlanB={canRegeneratePlanB}
        canChangeSkill={canChangeSkill}
        hasSkill={hasSkill}
        progressRecorded={progressRecorded}
        lifecycleReady={lifecycleReady}
        busyAction={busyAction}
        onClosePlanB={() => setPlanBOpen(false)}
        onAlternateSkill={() => applySkillPlanB('ALTERNATE_SKILL')}
        onSkipSkill={() => applySkillPlanB('SKIP_SKILL')}
        onAlternateSession={applyWholePlanB}
      />

      <SessionWhySheet visible={whyOpen} onClose={closeWhy} />
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
