import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import SessionCore from './session-core';
import EnvironmentSessionCore from './environment-session-core';
import EnvironmentSwapOverlay from '../../src/components/workout/EnvironmentSwapOverlay';
import SessionOverviewSheet from '../../src/components/workout/SessionOverviewSheet';
import SessionWhySheet from '../../src/components/workout/SessionWhySheet';
import SessionAdaptationSheet from '../../src/components/workout/SessionAdaptationSheet';
import { spacing } from '../../src/constants';
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

  const isEnvironmentSession = ['GYM', 'OUTDOOR'].includes(environmentCode);
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

  const canRegeneratePlanB =
    Boolean(workout?.sessionId) && !isEnvironmentSession && !progressRecorded;
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
      {isEnvironmentSession ? (
        <>
          <EnvironmentSessionCore environmentCode={environmentCode} />
          <EnvironmentSwapOverlay />
        </>
      ) : (
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
      )}

      {isEnvironmentSession ? (
        <View style={styles.sessionTools} pointerEvents="box-none">
          <Pressable
            onPress={() => setOverviewOpen(true)}
            style={({ pressed }) => [styles.toolButton, pressed && styles.pressed]}
          >
            <Ionicons name="clipboard-outline" size={18} color={colors.text} />
            <Text style={styles.toolButtonText}>Ma séance</Text>
          </Pressable>
        </View>
      ) : null}

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

function createStyles(colors, isDark) {
  return StyleSheet.create({
    root: { flex: 1 },
    sessionTools: {
      position: 'absolute',
      left: spacing.lg,
      right: spacing.lg,
      bottom: 84,
      zIndex: 32,
      flexDirection: 'row',
      justifyContent: 'space-between',
      pointerEvents: 'box-none',
    },
    toolButton: {
      minHeight: 40,
      paddingHorizontal: 12,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceElevated,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      shadowColor: colors.shadow,
      shadowOpacity: isDark ? 0.24 : 0.08,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 4 },
    },
    toolButtonText: {
      fontFamily: 'Manrope_700Bold',
      fontSize: 10,
      color: colors.text,
    },
    pressed: { opacity: 0.76 },
  });
}
