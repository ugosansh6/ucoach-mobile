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
import { Ionicons } from '@expo/vector-icons';

import SessionCore from './session-core';
import EnvironmentSessionCore from './environment-session-core';
import EnvironmentSwapOverlay from '../../src/components/workout/EnvironmentSwapOverlay';
import SessionOverviewSheet from '../../src/components/workout/SessionOverviewSheet';
import { colors, spacing } from '../../src/constants';
import { useUgerodTheme } from '../../src/contexts/UgerodThemeContext';
import { useWorkout } from '../../src/contexts/WorkoutContext';
import {
  changeWholeWorkoutPlan,
  changeWorkoutSkillPlan,
} from '../../src/services/skillPlanService';

export default function SessionScreen() {
  const {
    workout,
    setGeneratedWorkout,
  } = useWorkout();
  const { colors: themeColors } = useUgerodTheme();
  const overviewStyles = useMemo(
    () => createOverviewStyles(themeColors),
    [themeColors]
  );

  const [sheetOpen, setSheetOpen] =
    useState(false);
  const [busyAction, setBusyAction] =
    useState(null);
  const [overviewOpen, setOverviewOpen] =
    useState(false);
  const overviewShownForSessionRef =
    useRef(null);

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

  const isEnvironmentSession =
    ['GYM', 'OUTDOOR'].includes(
      environmentCode
    );

  const hasSkill = useMemo(
    () =>
      (workout.exercises ?? []).some(
        (exercise) =>
          String(
            exercise.blockKey ??
              exercise.block ??
              ''
          ).toLowerCase() === 'skill'
      ) ||
      (workout.rawBlocks ?? []).some(
        (block) =>
          String(
            block?.block_key ??
              block?.blockKey ??
              ''
          ).toLowerCase() === 'skill'
      ),
    [workout.exercises, workout.rawBlocks]
  );

  const canUsePlanB =
    Boolean(workout.sessionId) &&
    !workout.sessionStarted &&
    workout.status !== 'in_progress';

  const canChangeSkill =
    canUsePlanB && hasSkill;

  useEffect(() => {
    if (
      !workout.sessionId ||
      overviewShownForSessionRef.current === workout.sessionId
    ) {
      return;
    }

    overviewShownForSessionRef.current = workout.sessionId;

    if (!workout.sessionStarted) {
      setOverviewOpen(true);
    }
  }, [workout.sessionId, workout.sessionStarted]);

  async function applySkillPlanB(action) {
    if (busyAction || !canChangeSkill) {
      return;
    }

    try {
      setBusyAction(action);

      const { workout: nextWorkout } =
        await changeWorkoutSkillPlan({
          sessionId: workout.sessionId,
          action,
          preparationSnapshot:
            workout.preparationSnapshot ?? null,
        });

      setGeneratedWorkout(nextWorkout);
      setSheetOpen(false);
    } catch (error) {
      Alert.alert(
        'Impossible de modifier le Skill',
        error?.message ??
          'Aucune alternative sûre n’a été trouvée.'
      );
    } finally {
      setBusyAction(null);
    }
  }

  async function applyWholePlanB() {
    if (busyAction || !canUsePlanB) {
      return;
    }

    try {
      setBusyAction('ALTERNATE_SESSION');

      const { workout: nextWorkout } =
        await changeWholeWorkoutPlan({
          sessionId: workout.sessionId,
          preparationSnapshot:
            workout.preparationSnapshot ?? null,
        });

      setGeneratedWorkout(nextWorkout);
      setSheetOpen(false);
    } catch (error) {
      Alert.alert(
        'Impossible de proposer une autre séance',
        error?.message ??
          'Aucune autre proposition suffisamment différente n’a été trouvée.'
      );
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <View
      style={[
        styles.root,
        { backgroundColor: themeColors.background },
      ]}
    >
      {isEnvironmentSession ? (
        <>
          <EnvironmentSessionCore
            environmentCode={environmentCode}
          />
          <EnvironmentSwapOverlay />
        </>
      ) : (
        <SessionCore />
      )}

      <Pressable
        onPress={() => setOverviewOpen(true)}
        style={({ pressed }) => [
          overviewStyles.overviewButton,
          pressed && styles.pressed,
        ]}
      >
        <Ionicons
          name="list-outline"
          size={18}
          color={themeColors.text}
        />
        <Text style={overviewStyles.overviewButtonText}>
          VOIR MA SÉANCE
        </Text>
      </Pressable>

      {!isEnvironmentSession && canUsePlanB ? (
        <Pressable
          onPress={() => setSheetOpen(true)}
          style={({ pressed }) => [
            styles.changeSkillButton,
            pressed && styles.pressed,
          ]}
        >
          <Ionicons
            name="shuffle-outline"
            size={17}
            color={colors.textPrimary}
          />
          <Text style={styles.changeSkillText}>
            PLAN B
          </Text>
        </Pressable>
      ) : null}

      <SessionOverviewSheet
        visible={overviewOpen}
        onClose={() => setOverviewOpen(false)}
        showPlanB={!isEnvironmentSession && canUsePlanB}
        onPlanB={() => setSheetOpen(true)}
      />

      {!isEnvironmentSession ? (
        <Modal
          visible={sheetOpen}
          transparent
          animationType="slide"
          onRequestClose={() => {
            if (!busyAction) {
              setSheetOpen(false);
            }
          }}
        >
          <SafeAreaView style={styles.modalRoot}>
            <Pressable
              style={styles.backdrop}
              disabled={Boolean(busyAction)}
              onPress={() => setSheetOpen(false)}
            />

            <View style={styles.sheet}>
              <View style={styles.handle} />

              <View style={styles.sheetHeader}>
                <View style={styles.iconBox}>
                  <Ionicons
                    name="shuffle-outline"
                    size={20}
                    color={colors.brandWhite}
                  />
                </View>

                <View style={styles.headerCopy}>
                  <Text style={styles.eyebrow}>
                    PLAN B
                  </Text>
                  <Text style={styles.title}>
                    ENVIE D’AUTRE CHOSE AUJOURD’HUI ?
                  </Text>
                </View>

                <Pressable
                  disabled={Boolean(busyAction)}
                  onPress={() => setSheetOpen(false)}
                  hitSlop={10}
                  style={styles.closeButton}
                >
                  <Ionicons
                    name="close"
                    size={20}
                    color={colors.textSecondary}
                  />
                </Pressable>
              </View>

              <Text style={styles.explanation}>
                {hasSkill
                  ? 'Aucun besoin de déclarer une gêne. Ton choix vaut pour aujourd’hui : il ne baisse pas ton niveau et ne crée aucune séance à rattraper.'
                  : 'Tu peux demander une autre proposition avant de commencer. Le même check-in est conservé et aucune séance à rattraper n’est créée.'}
              </Text>

              <ScrollView
                style={styles.optionsScroll}
                contentContainerStyle={styles.optionsContent}
                showsVerticalScrollIndicator={false}
              >
                {hasSkill ? (
                  <>
                    <Pressable
                      disabled={Boolean(busyAction)}
                      onPress={() =>
                        applySkillPlanB('ALTERNATE_SKILL')
                      }
                      style={({ pressed }) => [
                        styles.option,
                        styles.primaryOption,
                        pressed && styles.pressed,
                      ]}
                    >
                      <View style={styles.optionIcon}>
                        {busyAction === 'ALTERNATE_SKILL' ? (
                          <ActivityIndicator
                            size="small"
                            color={colors.brandWhite}
                          />
                        ) : (
                          <Ionicons
                            name="swap-horizontal"
                            size={20}
                            color={colors.brandWhite}
                          />
                        )}
                      </View>
                      <View style={styles.optionCopy}>
                        <Text style={styles.primaryOptionTitle}>
                          UN AUTRE SKILL AUJOURD’HUI
                        </Text>
                        <Text style={styles.primaryOptionBody}>
                          UGEROD choisit un autre parcours compatible et reconstruit l’échauffement spécifique.
                        </Text>
                      </View>
                      <Ionicons
                        name="chevron-forward"
                        size={18}
                        color={colors.brandWhite}
                      />
                    </Pressable>

                    <Pressable
                      disabled={Boolean(busyAction)}
                      onPress={() =>
                        applySkillPlanB('SKIP_SKILL')
                      }
                      style={({ pressed }) => [
                        styles.option,
                        styles.secondaryOption,
                        pressed && styles.pressed,
                      ]}
                    >
                      <View style={styles.secondaryIcon}>
                        {busyAction === 'SKIP_SKILL' ? (
                          <ActivityIndicator
                            size="small"
                            color={colors.textPrimary}
                          />
                        ) : (
                          <Ionicons
                            name="remove-circle-outline"
                            size={20}
                            color={colors.textPrimary}
                          />
                        )}
                      </View>
                      <View style={styles.optionCopy}>
                        <Text style={styles.secondaryOptionTitle}>
                          PAS DE SKILL AUJOURD’HUI
                        </Text>
                        <Text style={styles.secondaryOptionBody}>
                          Le bloc disparaît. Le reste de la séance est réorganisé uniquement si cela reste cohérent et sûr.
                        </Text>
                      </View>
                      <Ionicons
                        name="chevron-forward"
                        size={18}
                        color={colors.textMuted}
                      />
                    </Pressable>
                  </>
                ) : null}

                <Pressable
                  disabled={Boolean(busyAction)}
                  onPress={applyWholePlanB}
                  style={({ pressed }) => [
                    styles.option,
                    hasSkill
                      ? styles.secondaryOption
                      : styles.primaryOption,
                    pressed && styles.pressed,
                  ]}
                >
                  <View
                    style={
                      hasSkill
                        ? styles.secondaryIcon
                        : styles.optionIcon
                    }
                  >
                    {busyAction === 'ALTERNATE_SESSION' ? (
                      <ActivityIndicator
                        size="small"
                        color={
                          hasSkill
                            ? colors.textPrimary
                            : colors.brandWhite
                        }
                      />
                    ) : (
                      <Ionicons
                        name="refresh-outline"
                        size={20}
                        color={
                          hasSkill
                            ? colors.textPrimary
                            : colors.brandWhite
                        }
                      />
                    )}
                  </View>
                  <View style={styles.optionCopy}>
                    <Text
                      style={
                        hasSkill
                          ? styles.secondaryOptionTitle
                          : styles.primaryOptionTitle
                      }
                    >
                      UNE AUTRE SÉANCE
                    </Text>
                    <Text
                      style={
                        hasSkill
                          ? styles.secondaryOptionBody
                          : styles.primaryOptionBody
                      }
                    >
                      Même durée, matériel et forme du jour. UGEROD reconstruit une proposition suffisamment différente.
                    </Text>
                  </View>
                  <Ionicons
                    name="chevron-forward"
                    size={18}
                    color={
                      hasSkill
                        ? colors.textMuted
                        : colors.brandWhite
                    }
                  />
                </Pressable>
              </ScrollView>

              <Pressable
                disabled={Boolean(busyAction)}
                onPress={() => setSheetOpen(false)}
                style={({ pressed }) => [
                  styles.keepButton,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.keepText}>
                  GARDER LA SÉANCE
                </Text>
              </Pressable>
            </View>
          </SafeAreaView>
        </Modal>
      ) : null}
    </View>
  );
}

function createOverviewStyles(themeColors) {
  return StyleSheet.create({
    overviewButton: {
      position: 'absolute',
      left: spacing.lg,
      bottom: 92,
      minHeight: 42,
      paddingHorizontal: 13,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: themeColors.border,
      backgroundColor: themeColors.surfaceElevated,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 7,
      zIndex: 30,
      elevation: 9,
      shadowColor: themeColors.shadow,
      shadowOpacity: 0.12,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 5 },
    },
    overviewButtonText: {
      fontFamily: 'Manrope_700Bold',
      fontSize: 10,
      letterSpacing: 0.35,
      color: themeColors.text,
    },
  });
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  changeSkillButton: {
    position: 'absolute',
    right: spacing.lg,
    bottom: 92,
    minHeight: 42,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    zIndex: 20,
    elevation: 8,
  },
  changeSkillText: {
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 10,
    letterSpacing: 0.7,
    color: colors.textPrimary,
  },
  modalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.72)',
  },
  sheet: {
    maxHeight: '84%',
    paddingHorizontal: spacing.xl,
    paddingTop: 9,
    paddingBottom: 18,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  handle: {
    width: 42,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    backgroundColor: colors.border,
    marginBottom: 14,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },
  iconBox: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  headerCopy: {
    flex: 1,
  },
  eyebrow: {
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 9,
    letterSpacing: 0.8,
    color: colors.primaryLight,
  },
  title: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 22,
    lineHeight: 25,
    letterSpacing: 1,
    color: colors.textPrimary,
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  explanation: {
    marginTop: 12,
    fontFamily: 'Oswald_400Regular',
    fontSize: 11,
    lineHeight: 17,
    color: colors.textSecondary,
  },
  optionsScroll: {
    marginTop: 2,
  },
  optionsContent: {
    paddingBottom: 2,
  },
  option: {
    minHeight: 82,
    marginTop: 10,
    borderRadius: 15,
    paddingHorizontal: 13,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  primaryOption: {
    backgroundColor: colors.primary,
  },
  secondaryOption: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  optionIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  secondaryIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  optionCopy: {
    flex: 1,
  },
  primaryOptionTitle: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 11,
    letterSpacing: 0.35,
    color: colors.brandWhite,
  },
  primaryOptionBody: {
    marginTop: 3,
    fontFamily: 'Oswald_400Regular',
    fontSize: 10,
    lineHeight: 14,
    color: 'rgba(255,255,255,0.78)',
  },
  secondaryOptionTitle: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 11,
    letterSpacing: 0.35,
    color: colors.textPrimary,
  },
  secondaryOptionBody: {
    marginTop: 3,
    fontFamily: 'Oswald_400Regular',
    fontSize: 10,
    lineHeight: 14,
    color: colors.textSecondary,
  },
  keepButton: {
    minHeight: 44,
    marginTop: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keepText: {
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 10,
    letterSpacing: 0.55,
    color: colors.textMuted,
  },
  pressed: {
    opacity: 0.68,
  },
});
