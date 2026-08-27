import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import SessionCore from './session-core';
import { colors, spacing } from '../../src/constants';
import { useWorkout } from '../../src/contexts/WorkoutContext';
import { changeWorkoutSkillPlan } from '../../src/services/skillPlanService';

export default function SessionScreen() {
  const {
    workout,
    setGeneratedWorkout,
  } = useWorkout();

  const [sheetOpen, setSheetOpen] =
    useState(false);
  const [busyAction, setBusyAction] =
    useState(null);

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

  const canChangeSkill =
    Boolean(workout.sessionId) &&
    hasSkill &&
    !workout.sessionStarted &&
    workout.status !== 'in_progress';

  async function applyPlanB(action) {
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

  return (
    <View style={styles.root}>
      <SessionCore />

      {canChangeSkill ? (
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
            CHANGER LE SKILL
          </Text>
        </Pressable>
      ) : null}

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
                  PAS CE SKILL AUJOURD’HUI ?
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
              Aucun besoin de déclarer une gêne. Ce choix vaut uniquement pour aujourd’hui : il ne change ni ton niveau, ni ton cycle de progression.
            </Text>

            <Pressable
              disabled={Boolean(busyAction)}
              onPress={() =>
                applyPlanB('ALTERNATE_SKILL')
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
                applyPlanB('SKIP_SKILL')
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
                  Le bloc disparaît. Les minutes libérées ne sont réutilisées que si la séance reste cohérente et sûre.
                </Text>
              </View>
              <Ionicons
                name="chevron-forward"
                size={18}
                color={colors.textMuted}
              />
            </Pressable>

            <Pressable
              disabled={Boolean(busyAction)}
              onPress={() => setSheetOpen(false)}
              style={({ pressed }) => [
                styles.keepButton,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.keepText}>
                GARDER CE SKILL
              </Text>
            </Pressable>
          </View>
        </SafeAreaView>
      </Modal>
    </View>
  );
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
    fontSize: 24,
    lineHeight: 27,
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
  option: {
    minHeight: 82,
    marginTop: 12,
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
