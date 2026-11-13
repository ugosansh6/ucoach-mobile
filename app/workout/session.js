import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import SessionCore from './session-core';
import EnvironmentSessionCore from './environment-session-core';
import SessionOverviewSheet from '../../src/components/workout/SessionOverviewSheet';
import SessionWhySheet from '../../src/components/workout/SessionWhySheet';
import SessionAdaptationSheet from '../../src/components/workout/SessionAdaptationSheet';
import { useUgerodTheme } from '../../src/contexts/UgerodThemeContext';
import { useWorkout } from '../../src/contexts/WorkoutContext';
import { reloadWorkoutSession } from '../../src/services/workoutService';
import { hasPlayableSessionBlocks, playerSessionNeedsReload } from '../../src/utils/playerSessionHydration';
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
  const { workout, updateWorkout, setGeneratedWorkout, setGeneratedWorkoutPreservingProgress } = useWorkout();
  const routeParams = useLocalSearchParams();
  const routeSessionId = Array.isArray(routeParams?.sessionId)
    ? routeParams.sessionId[0]
    : routeParams?.sessionId;
  const targetSessionId = String(routeSessionId || workout?.sessionId || '').trim();
  const playerDataReady = Boolean(
    targetSessionId && targetSessionId === workout?.sessionId && hasPlayableSessionBlocks(workout)
  );
  const [playerReload, setPlayerReload] = useState({ status: 'pending', sessionId: null, error: null });
  const [playerRetry, setPlayerRetry] = useState(0);
  const { colors, isDark } = useUgerodTheme();
  const styles = useMemo(() => createStyles(), []);

  const [planBOpen, setPlanBOpen] = useState(false);
  const [busyAction, setBusyAction] = useState(null);
  const [overviewOpen, setOverviewOpen] = useState(false);
  const [whyOpen, setWhyOpen] = useState(false);
  const [whyReturnToOverview, setWhyReturnToOverview] = useState(false);
  const [adaptationOpen, setAdaptationOpen] = useState(false);
  const [startBusy, setStartBusy] = useState(false);
  const [lifecycleReady, setLifecycleReady] = useState(false);
  const [lifecycleSessionId, setLifecycleSessionId] = useState(null);
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

  // #3: Composer and other persisted sessions must be reloadable by identity.
  // A browser refresh can reset WorkoutContext; never open the classic player
  // with empty blocks or select/re-generate another session to hide this failure.
  useEffect(() => {
    let cancelled = false;
    if (!targetSessionId) {
      setPlayerReload({
        status: 'error', sessionId: null,
        error: 'Aucune séance à reprendre. Reviens à la préparation.',
      });
      return () => { cancelled = true; };
    }
    if (!playerSessionNeedsReload(workout, targetSessionId)) {
      setPlayerReload({ status: 'ready', sessionId: targetSessionId, error: null });
      return () => { cancelled = true; };
    }

    setPlayerReload({ status: 'loading', sessionId: targetSessionId, error: null });
    reloadWorkoutSession({
      sessionId: targetSessionId,
      preparationSnapshot: workout?.preparationSnapshot ?? null,
    }).then((restored) => {
      if (cancelled) return;
      if (restored?.sessionId !== targetSessionId || !hasPlayableSessionBlocks(restored)) {
        setPlayerReload({
          status: 'error', sessionId: targetSessionId,
          error: 'La séance existe, mais ses blocs exécutables sont introuvables. Tes choix ont été conservés.',
        });
        return;
      }
      // Rehydrate rather than rebuild: preserve already recorded local progress.
      setGeneratedWorkoutPreservingProgress(restored);
      setPlayerReload({ status: 'ready', sessionId: targetSessionId, error: null });
    }).catch((error) => {
      if (cancelled) return;
      console.warn('[Player] session hydration failed', error);
      setPlayerReload({
        status: 'error', sessionId: targetSessionId,
        error: 'Impossible de recharger ta séance. Réessaie ou reviens à la préparation.',
      });
    });
    return () => { cancelled = true; };
  }, [targetSessionId, playerDataReady, playerRetry, setGeneratedWorkoutPreservingProgress]);

  // Le backend est l'autorité du cycle de vie. On hydrate explicitement l'état
  // avant d'autoriser un player local à enregistrer une exécution ou à révéler le WOD.
  useEffect(() => {
    let cancelled = false;
    const sessionId = workout?.sessionId ?? null;

    setLifecycleReady(false);
    setLifecycleSessionId(null);

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
        setLifecycleSessionId(sessionId);
        setLifecycleReady(true);
      })
      .catch((error) => {
        if (cancelled) return;
        console.warn('Session lifecycle hydration', error);
        // Fail closed: tant que le backend n'a pas confirmé l'état, aucun player
        // ne peut enregistrer d'exécution et le WOD reste masqué.
        setLifecycleSessionId(null);
        setLifecycleReady(false);
      });

    return () => {
      cancelled = true;
    };
  }, [workout?.sessionId]);

  const lifecycleReadyForCurrentSession = Boolean(
    lifecycleReady &&
      workout?.sessionId &&
      lifecycleSessionId === workout.sessionId
  );

  const authoritativeSessionStarted = Boolean(
    lifecycleReadyForCurrentSession &&
      workout?.sessionStarted &&
      !workout?.sessionClosed
  );

  // GYM et OUTDOOR conservent leurs runtimes spécialisés (séries, cardio, course),
  // mais leur shell et leurs actions sont alignés sur le Player commun.
  // Composer may include a native Strength block at HOME/BOX as well as WOD.
  // The classic Functional Fitness player has a fixed block list without
  // Strength, while the environment player reads the actual persisted blocks.
  const usesSpecializedEnvironmentRuntime =
    ['GYM', 'OUTDOOR'].includes(environmentCode) ||
    String(workout?.meta?.source ?? '').toLowerCase() === 'w11_composer' ||
    (workout?.rawBlocks ?? []).some((block) =>
      ['strength', 'gym', 'street_gym', 'cardio', 'conditioning'].includes(
        normalizeBlock(block?.block_key ?? block?.blockKey)
      )
    ) ||
    (workout?.exercises ?? []).some((exercise) =>
      ['strength', 'gym', 'street_gym', 'cardio', 'conditioning'].includes(
        normalizeBlock(exercise?.blockKey ?? exercise?.block)
      )
    );
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
    lifecycleReadyForCurrentSession &&
    !workout?.sessionClosed &&
    !authoritativeSessionStarted &&
    !progressRecorded;
  const showPlanBEntry = canRegeneratePlanB;
  const canChangeSkill = canRegeneratePlanB && hasSkill;

  useEffect(() => {
    if (!playerDataReady || !workout?.sessionId || overviewShownForSessionRef.current === workout.sessionId) return;
    overviewShownForSessionRef.current = workout.sessionId;
    if (!progressRecorded && !hasResumeCursor) setOverviewOpen(true);
  }, [hasResumeCursor, playerDataReady, progressRecorded, workout?.sessionId]);

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
      setLifecycleSessionId(workout.sessionId);
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
    lifecycleReady: lifecycleReadyForCurrentSession,
    sessionStarted: authoritativeSessionStarted,
    showAdjust: authoritativeSessionStarted,
    showPlanB: showPlanBEntry,
  };

  if (!playerDataReady || playerReload.status !== 'ready' ||
      playerReload.sessionId !== targetSessionId) {
    const failed = playerReload.status === 'error';
    return (
      <View style={[styles.root, {
        backgroundColor: colors.background,
        alignItems: 'center', justifyContent: 'center', padding: 24,
      }]}>
        {failed ? null : <ActivityIndicator color={colors.accent} size="large" />}
        <Text style={{ color: colors.text, textAlign: 'center', marginTop: 20 }}>
          {failed ? playerReload.error : 'Chargement de ta séance enregistrée…'}
        </Text>
        {failed && targetSessionId ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => setPlayerRetry((value) => value + 1)}
            style={{ padding: 14, marginTop: 16 }}
          >
            <Text style={{ color: colors.accent, fontWeight: '700' }}>RÉESSAYER</Text>
          </Pressable>
        ) : null}
        {failed ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.replace('/workout/preparation')}
            style={{ padding: 14, marginTop: 8 }}
          >
            <Text style={{ color: colors.text }}>Revenir au check-in</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
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
        lifecycleReady={lifecycleReadyForCurrentSession}
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
