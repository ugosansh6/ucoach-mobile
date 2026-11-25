import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { usePathname } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { spacing } from '../../constants';
import { useUgerodTheme } from '../../contexts/UgerodThemeContext';
import { useWorkout } from '../../contexts/WorkoutContext';
import { generateWorkoutSession } from '../../services/workoutService';

function normalizeBlock(value) {
  return value === 'warm_up' ? 'warmup' : value ?? null;
}

function getProtectedExerciseIds(workout) {
  const validated = new Set(
    Array.isArray(workout?.validatedBlocks) ? workout.validatedBlocks : []
  );

  return (workout?.exercises ?? [])
    .filter((exercise) => {
      const block = normalizeBlock(exercise?.blockKey ?? exercise?.block);
      return (
        validated.has(block) ||
        exercise?.status === 'completed' ||
        exercise?.status === 'not_completed'
      );
    })
    .map((exercise) => exercise?.sessionExerciseId ?? exercise?.session_exercise_id)
    .filter(Boolean);
}

function buildPreparationSnapshot(preparation, workout) {
  const snapshot = workout?.preparationSnapshot ?? {};
  return {
    duration:
      preparation?.duration ?? snapshot?.duration ?? workout?.plannedDuration ?? 45,
    equipment:
      preparation?.equipment?.length > 0
        ? preparation.equipment
        : snapshot?.equipment?.length > 0
          ? snapshot.equipment
          : ['Poids du corps'],
    readiness: preparation?.readiness ?? snapshot?.readiness ?? 6,
    painZones:
      preparation?.painZones?.length > 0
        ? preparation.painZones
        : snapshot?.painZones?.length > 0
          ? snapshot.painZones
          : ['Aucune'],
    region: null,
  };
}

export default function SessionAdaptationOverlayThemed() {
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { colors } = useUgerodTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const {
    preparation,
    workout,
    updatePreparation,
    setGeneratedWorkoutPreservingProgress,
  } = useWorkout();

  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  if (pathname !== '/workout/session' || !workout?.sessionId) return null;

  async function adaptRemaining(nextPreparation, preparationPatch = null) {
    setLoading(true);
    setError('');

    try {
      const generated = await generateWorkoutSession(nextPreparation, {
        forceRecalculateStarted: true,
        protectedSessionExerciseIds: getProtectedExerciseIds(workout),
      });

      if (generated?.controlStatus) {
        throw new Error(
          generated.controlStatus === 'RECALC_LIMIT_REACHED'
            ? 'La limite d’ajustements globaux de cette séance est atteinte.'
            : 'UGEROD a besoin d’une nouvelle confirmation avant d’ajuster la séance.'
        );
      }

      if (preparationPatch) updatePreparation(preparationPatch);
      setGeneratedWorkoutPreservingProgress(generated);
      setVisible(false);
    } catch (adaptationError) {
      setError(
        adaptationError instanceof Error
          ? adaptationError.message
          : 'Impossible d’ajuster la séance.'
      );
      setVisible(true);
    } finally {
      setLoading(false);
    }
  }

  async function adaptForFatigue() {
    const current = buildPreparationSnapshot(preparation, workout);
    const readiness = Math.max(1, Number(current.readiness ?? 6) - 2);
    await adaptRemaining(
      { ...current, readiness },
      { readiness, region: null }
    );
  }

  return (
    <>
      <View
        pointerEvents="box-none"
        style={[styles.floatingLayer, { top: insets.top + 24 }]}
      >
        <Pressable
          onPress={() => {
            setError('');
            setVisible(true);
          }}
          accessibilityRole="button"
          accessibilityLabel="Ajuster ma séance"
          hitSlop={8}
          style={({ pressed }) => [styles.floatingButton, pressed && styles.pressed]}
        >
          <Ionicons name="options-outline" size={20} color="#FFFFFF" />
        </Pressable>
      </View>

      <Modal
        visible={visible}
        transparent
        animationType="fade"
        onRequestClose={() => !loading && setVisible(false)}
      >
        <View style={styles.overlay}>
          <Pressable
            style={styles.backdrop}
            onPress={() => !loading && setVisible(false)}
          />
          <View style={styles.card}>
            <View style={styles.header}>
              <View style={styles.headerMain}>
                <Text style={styles.eyebrow}>AJUSTER LA SÉANCE</Text>
                <Text style={styles.title}>Quelque chose a changé ?</Text>
              </View>
              <Pressable
                onPress={() => !loading && setVisible(false)}
                disabled={loading}
                style={styles.closeButton}
              >
                <Ionicons name="close" size={21} color={colors.text} />
              </Pressable>
            </View>

            <Text style={styles.helper}>
              UGEROD garde ce qui est déjà fait et ajuste uniquement ce qu’il reste à faire.
            </Text>

            {error ? (
              <View style={styles.errorBox}>
                <Ionicons name="alert-circle-outline" size={18} color={colors.secondaryAccent} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            <Pressable
              onPress={adaptForFatigue}
              disabled={loading}
              style={[styles.actionRow, loading && styles.disabled]}
            >
              <View style={styles.actionIcon}>
                <Ionicons name="battery-half-outline" size={20} color={colors.secondaryAccent} />
              </View>
              <View style={styles.actionMain}>
                <Text style={styles.actionTitle}>Plus fatigué que prévu</Text>
                <Text style={styles.actionDescription}>
                  Ajuste l’intensité des blocs restants.
                </Text>
              </View>
              {loading ? (
                <ActivityIndicator size="small" color={colors.secondaryAccent} />
              ) : (
                <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
              )}
            </Pressable>

            <View style={styles.guidanceRow}>
              <View style={styles.actionIcon}>
                <Ionicons name="swap-horizontal-outline" size={20} color={colors.accent} />
              </View>
              <View style={styles.actionMain}>
                <Text style={styles.actionTitle}>Un exercice me gêne</Text>
                <Text style={styles.actionDescription}>
                  Utilise directement Adapter sur l’exercice concerné.
                </Text>
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

function createStyles(colors) {
  return StyleSheet.create({
    floatingLayer: {
      position: 'absolute',
      right: spacing.xl + 58,
      zIndex: 80,
    },
    floatingButton: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: colors.secondaryAccent,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: colors.secondaryAccent,
      shadowColor: colors.shadow,
      shadowOpacity: 0.16,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 4 },
    },
    pressed: { opacity: 0.78, transform: [{ scale: 0.96 }] },
    disabled: { opacity: 0.45 },
    overlay: {
      flex: 1,
      justifyContent: 'flex-end',
      backgroundColor: 'rgba(0,0,0,0.38)',
    },
    backdrop: { ...StyleSheet.absoluteFillObject },
    card: {
      borderTopLeftRadius: 26,
      borderTopRightRadius: 26,
      backgroundColor: colors.background,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: spacing.xl,
      paddingTop: 22,
      paddingBottom: 32,
    },
    header: { flexDirection: 'row', alignItems: 'flex-start', gap: 14 },
    headerMain: { flex: 1 },
    eyebrow: {
      fontFamily: 'Manrope_800ExtraBold',
      fontSize: 9,
      letterSpacing: 0.9,
      color: colors.secondaryAccent,
    },
    title: {
      marginTop: 4,
      fontFamily: 'Manrope_800ExtraBold',
      fontSize: 25,
      lineHeight: 30,
      color: colors.text,
    },
    closeButton: {
      width: 42,
      height: 42,
      borderRadius: 21,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    helper: {
      marginTop: 12,
      fontFamily: 'Manrope_400Regular',
      fontSize: 13,
      lineHeight: 19,
      color: colors.textSecondary,
    },
    errorBox: {
      marginTop: 14,
      minHeight: 50,
      paddingHorizontal: 13,
      paddingVertical: 11,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.secondaryAccent,
      backgroundColor: colors.secondaryAccentSoft,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 9,
    },
    errorText: {
      flex: 1,
      fontFamily: 'Manrope_500Medium',
      fontSize: 12,
      lineHeight: 18,
      color: colors.secondaryAccent,
    },
    actionRow: {
      minHeight: 72,
      marginTop: 16,
      paddingHorizontal: 13,
      paddingVertical: 11,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.secondaryAccent,
      backgroundColor: colors.secondaryAccentSoft,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    guidanceRow: {
      minHeight: 72,
      marginTop: 10,
      paddingHorizontal: 13,
      paddingVertical: 11,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    actionIcon: {
      width: 38,
      height: 38,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.background,
    },
    actionMain: { flex: 1 },
    actionTitle: {
      fontFamily: 'Manrope_700Bold',
      fontSize: 12,
      color: colors.text,
    },
    actionDescription: {
      marginTop: 3,
      fontFamily: 'Manrope_400Regular',
      fontSize: 11,
      lineHeight: 16,
      color: colors.textSecondary,
    },
  });
}
