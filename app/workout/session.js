import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import SessionCore from './session-core';
import EnvironmentSessionCore from './environment-session-core';
import EnvironmentSwapOverlay from '../../src/components/workout/EnvironmentSwapOverlay';
import SessionOverviewSheet from '../../src/components/workout/SessionOverviewSheet';
import { spacing } from '../../src/constants';
import { useUgerodTheme } from '../../src/contexts/UgerodThemeContext';
import { useWorkout } from '../../src/contexts/WorkoutContext';
import {
  changeWholeWorkoutPlan,
  changeWorkoutSkillPlan,
} from '../../src/services/skillPlanService';

const DEV_TEST_RELOAD = process.env.EXPO_PUBLIC_APP_ENV === 'development';

function normalizeBlock(value) {
  const key = String(value ?? '').trim().toLowerCase();
  return key === 'warm_up' ? 'warmup' : key;
}

function hasRecordedProgress(workout) {
  if ((workout?.validatedBlocks ?? []).length > 0) return true;
  if (workout?.wodRuntime?.started || workout?.wodStarted || workout?.wodStartedAt) return true;
  return (workout?.exercises ?? []).some((exercise) => {
    const status = exercise?.userExecutionStatus ?? exercise?.status ?? 'pending';
    return status !== 'pending';
  });
}

export default function SessionScreen() {
  const { workout, setGeneratedWorkout } = useWorkout();
  const { colors, isDark } = useUgerodTheme();
  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);

  const [planBOpen, setPlanBOpen] = useState(false);
  const [busyAction, setBusyAction] = useState(null);
  const [overviewOpen, setOverviewOpen] = useState(false);
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

  // En usage normal, Plan B reste limité à l'avant-effort.
  // Sur le build DEV uniquement, on garde une boucle de recharge pour tester le Player
  // même après avoir avancé dans la séance. Le backend DEV protège les résultats persistés.
  const canRegeneratePlanB =
    Boolean(workout?.sessionId) &&
    !isEnvironmentSession &&
    (!progressRecorded || DEV_TEST_RELOAD);
  const showPlanBEntry = Boolean(workout?.sessionId) && !isEnvironmentSession;
  const canChangeSkill =
    Boolean(workout?.sessionId) && !isEnvironmentSession && !progressRecorded && hasSkill;

  useEffect(() => {
    if (!workout?.sessionId || overviewShownForSessionRef.current === workout.sessionId) return;
    overviewShownForSessionRef.current = workout.sessionId;
    if (!progressRecorded) setOverviewOpen(true);
  }, [progressRecorded, workout?.sessionId]);

  async function applySkillPlanB(action) {
    if (busyAction || !canChangeSkill) return;
    try {
      setBusyAction(action);
      const { workout: nextWorkout } = await changeWorkoutSkillPlan({
        sessionId: workout.sessionId,
        action,
        preparationSnapshot: workout.preparationSnapshot ?? null,
      });
      setGeneratedWorkout(nextWorkout);
      setPlanBOpen(false);
    } catch (error) {
      Alert.alert(
        'Impossible de modifier le Skill',
        error?.message ?? 'Aucune alternative sûre n’a été trouvée.'
      );
    } finally {
      setBusyAction(null);
    }
  }

  async function applyWholePlanB() {
    if (busyAction || !canRegeneratePlanB) return;
    try {
      setBusyAction('ALTERNATE_SESSION');
      const { workout: nextWorkout } = await changeWholeWorkoutPlan({
        sessionId: workout.sessionId,
        preparationSnapshot: workout.preparationSnapshot ?? null,
      });
      setGeneratedWorkout(nextWorkout);
      setPlanBOpen(false);
    } catch (error) {
      Alert.alert(
        'Impossible de proposer une autre séance',
        error?.message ?? 'Aucune autre proposition suffisamment différente n’a été trouvée.'
      );
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
        <SessionCore />
      )}

      <View style={styles.sessionTools} pointerEvents="box-none">
        <Pressable
          onPress={() => setOverviewOpen(true)}
          style={({ pressed }) => [styles.toolButton, pressed && styles.pressed]}
        >
          <Ionicons name="clipboard-outline" size={18} color={colors.text} />
          <Text style={styles.toolButtonText}>Ma séance</Text>
        </Pressable>

        {showPlanBEntry ? (
          <Pressable
            onPress={() => setPlanBOpen(true)}
            style={({ pressed }) => [styles.toolButton, styles.planBTool, pressed && styles.pressed]}
          >
            <Ionicons name="shuffle-outline" size={18} color={colors.secondaryAccent} />
            <Text style={[styles.toolButtonText, { color: colors.secondaryAccent }]}>Plan B</Text>
          </Pressable>
        ) : null}
      </View>

      <SessionOverviewSheet
        visible={overviewOpen}
        onClose={() => setOverviewOpen(false)}
        showPlanB={canRegeneratePlanB}
        onPlanB={() => setPlanBOpen(true)}
      />

      {!isEnvironmentSession ? (
        <Modal
          visible={planBOpen}
          transparent
          animationType="slide"
          onRequestClose={() => !busyAction && setPlanBOpen(false)}
        >
          <SafeAreaView style={styles.modalRoot}>
            <Pressable
              style={styles.backdrop}
              disabled={Boolean(busyAction)}
              onPress={() => setPlanBOpen(false)}
            />

            <View style={styles.sheet}>
              <View style={styles.handle} />
              <View style={styles.sheetHeader}>
                <View style={styles.planBIcon}>
                  <Ionicons name="shuffle-outline" size={20} color={colors.textOnAccent} />
                </View>
                <View style={styles.sheetHeaderCopy}>
                  <Text style={styles.eyebrow}>PLAN B</Text>
                  <Text style={styles.title}>
                    {canRegeneratePlanB
                      ? DEV_TEST_RELOAD && progressRecorded
                        ? 'Recharger pour continuer les tests ?'
                        : 'Envie d’autre chose ?'
                      : 'Ta séance a déjà commencé.'}
                  </Text>
                </View>
                <Pressable
                  disabled={Boolean(busyAction)}
                  onPress={() => setPlanBOpen(false)}
                  style={styles.closeButton}
                >
                  <Ionicons name="close" size={20} color={colors.text} />
                </Pressable>
              </View>

              {canRegeneratePlanB ? (
                <>
                  <Text style={styles.explanation}>
                    {DEV_TEST_RELOAD && progressRecorded
                      ? 'Mode développement : tu peux recharger une nouvelle séance pour continuer les tests. Les résultats déjà persistés restent protégés.'
                      : 'Tu peux encore changer de proposition : aucun résultat d’exercice n’a été enregistré.'}
                  </Text>

                  <ScrollView contentContainerStyle={styles.options} showsVerticalScrollIndicator={false}>
                    {hasSkill ? (
                      <>
                        <PlanBOption
                          title="Un autre Skill aujourd’hui"
                          description="UGEROD choisit un autre parcours compatible et ajuste l’échauffement spécifique."
                          icon="swap-horizontal-outline"
                          loading={busyAction === 'ALTERNATE_SKILL'}
                          disabled={Boolean(busyAction)}
                          onPress={() => applySkillPlanB('ALTERNATE_SKILL')}
                          styles={styles}
                          colors={colors}
                        />
                        <PlanBOption
                          title="Pas de Skill aujourd’hui"
                          description="Le bloc disparaît uniquement si le reste de la séance reste cohérent et sûr."
                          icon="remove-circle-outline"
                          loading={busyAction === 'SKIP_SKILL'}
                          disabled={Boolean(busyAction)}
                          onPress={() => applySkillPlanB('SKIP_SKILL')}
                          styles={styles}
                          colors={colors}
                        />
                      </>
                    ) : null}

                    <PlanBOption
                      title={DEV_TEST_RELOAD && progressRecorded ? 'Recharger une séance de test' : 'Une autre séance'}
                      description={
                        DEV_TEST_RELOAD && progressRecorded
                          ? 'La session de test en cours est abandonnée proprement, puis UGEROD recharge une nouvelle proposition avec le même check-in.'
                          : 'Même durée, matériel et forme du jour. UGEROD reconstruit une proposition différente.'
                      }
                      icon="refresh-outline"
                      loading={busyAction === 'ALTERNATE_SESSION'}
                      disabled={Boolean(busyAction)}
                      onPress={applyWholePlanB}
                      styles={styles}
                      colors={colors}
                    />
                  </ScrollView>
                </>
              ) : (
                <View style={styles.startedMessage}>
                  <Ionicons name="shield-checkmark-outline" size={22} color={colors.accent} />
                  <Text style={styles.startedText}>
                    Les résultats déjà réalisés restent intacts. Pour la suite, utilise Adapter ou Refuser sur l’exercice concerné : UGEROD ne réécrit pas ce qui est déjà fait.
                  </Text>
                </View>
              )}

              <Pressable
                disabled={Boolean(busyAction)}
                onPress={() => setPlanBOpen(false)}
                style={styles.keepButton}
              >
                <Text style={styles.keepText}>{canRegeneratePlanB ? 'Garder la séance' : 'Retour à la séance'}</Text>
              </Pressable>
            </View>
          </SafeAreaView>
        </Modal>
      ) : null}
    </View>
  );
}

function PlanBOption({ title, description, icon, loading, disabled, onPress, styles, colors }) {
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.option, pressed && !disabled && styles.pressed]}
    >
      <View style={styles.optionIcon}>
        {loading ? (
          <ActivityIndicator size="small" color={colors.secondaryAccent} />
        ) : (
          <Ionicons name={icon} size={20} color={colors.secondaryAccent} />
        )}
      </View>
      <View style={styles.optionCopy}>
        <Text style={styles.optionTitle}>{title}</Text>
        <Text style={styles.optionBody}>{description}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
    </Pressable>
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
    planBTool: { borderColor: colors.secondaryAccent },
    toolButtonText: { fontFamily: 'Manrope_700Bold', fontSize: 10, color: colors.text },
    pressed: { opacity: 0.76 },
    modalRoot: { flex: 1, justifyContent: 'flex-end' },
    backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.48)' },
    sheet: {
      maxHeight: '84%',
      paddingHorizontal: 20,
      paddingTop: 10,
      paddingBottom: 22,
      borderTopLeftRadius: 26,
      borderTopRightRadius: 26,
      backgroundColor: colors.background,
      borderWidth: 1,
      borderColor: colors.border,
    },
    handle: { width: 42, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 14, backgroundColor: colors.border },
    sheetHeader: { flexDirection: 'row', alignItems: 'center', gap: 11 },
    planBIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.secondaryAccent },
    sheetHeaderCopy: { flex: 1 },
    eyebrow: { fontFamily: 'Manrope_700Bold', fontSize: 9, letterSpacing: 1.1, color: colors.secondaryAccent },
    title: { marginTop: 3, fontFamily: 'Manrope_800ExtraBold', fontSize: 23, lineHeight: 28, color: colors.text },
    closeButton: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
    explanation: { marginTop: 14, fontFamily: 'Manrope_500Medium', fontSize: 12, lineHeight: 18, color: colors.textSecondary },
    options: { gap: 10, paddingTop: 16, paddingBottom: 6 },
    option: { minHeight: 70, paddingHorizontal: 13, paddingVertical: 12, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', gap: 11 },
    optionIcon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.secondaryAccentSoft },
    optionCopy: { flex: 1 },
    optionTitle: { fontFamily: 'Manrope_800ExtraBold', fontSize: 13, color: colors.text },
    optionBody: { marginTop: 3, fontFamily: 'Manrope_500Medium', fontSize: 10, lineHeight: 15, color: colors.textSecondary },
    startedMessage: { marginTop: 18, borderRadius: 16, padding: 15, flexDirection: 'row', alignItems: 'flex-start', gap: 11, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
    startedText: { flex: 1, fontFamily: 'Manrope_500Medium', fontSize: 12, lineHeight: 18, color: colors.textSecondary },
    keepButton: { marginTop: 16, minHeight: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
    keepText: { fontFamily: 'Manrope_700Bold', fontSize: 12, color: colors.text },
  });
}
