import {
  useState,
} from 'react';
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

import {
  colors,
  spacing,
} from '../../constants';
import {
  useWorkout,
} from '../../contexts/WorkoutContext';
import {
  generateWorkoutSession,
} from '../../services/workoutService';

function normalizeBlock(value) {
  if (value === 'warm_up') {
    return 'warmup';
  }

  return value ?? null;
}

function getProtectedExerciseIds(workout) {
  const validated = new Set(
    Array.isArray(workout?.validatedBlocks)
      ? workout.validatedBlocks
      : []
  );

  return (workout?.exercises ?? [])
    .filter((exercise) => {
      const block = normalizeBlock(
        exercise?.blockKey ??
          exercise?.block
      );

      return (
        validated.has(block) ||
        exercise?.status === 'completed' ||
        exercise?.status === 'not_completed'
      );
    })
    .map(
      (exercise) =>
        exercise?.sessionExerciseId ??
        exercise?.session_exercise_id
    )
    .filter(Boolean);
}

function buildPreparationSnapshot(
  preparation,
  workout
) {
  const snapshot =
    workout?.preparationSnapshot ?? {};

  return {
    duration:
      preparation?.duration ??
      snapshot?.duration ??
      workout?.plannedDuration ??
      45,
    equipment:
      preparation?.equipment?.length > 0
        ? preparation.equipment
        : snapshot?.equipment?.length > 0
          ? snapshot.equipment
          : ['Poids du corps'],
    readiness:
      preparation?.readiness ??
      snapshot?.readiness ??
      6,
    painZones:
      preparation?.painZones?.length > 0
        ? preparation.painZones
        : snapshot?.painZones?.length > 0
          ? snapshot.painZones
          : ['Aucune'],
    // Le focus de séance appartient au moteur Coach.
    // Une ancienne préférence locale ne doit pas survivre à un ajustement.
    region: null,
  };
}

export default function SessionAdaptationOverlay() {
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const {
    preparation,
    workout,
    updatePreparation,
    setGeneratedWorkoutPreservingProgress,
  } = useWorkout();

  const [visible, setVisible] =
    useState(false);
  const [loading, setLoading] =
    useState(false);
  const [error, setError] =
    useState('');

  async function adaptRemaining(
    nextPreparation,
    preparationPatch = null
  ) {
    setLoading(true);
    setError('');

    try {
      const generated =
        await generateWorkoutSession(
          nextPreparation,
          {
            forceRecalculateStarted: true,
            protectedSessionExerciseIds:
              getProtectedExerciseIds(
                workout
              ),
          }
        );

      if (generated?.controlStatus) {
        throw new Error(
          generated.controlStatus ===
          'RECALC_LIMIT_REACHED'
            ? 'La limite d’ajustements globaux de cette séance est atteinte.'
            : 'UGEROD a besoin d’une nouvelle confirmation avant d’ajuster la séance.'
        );
      }

      if (preparationPatch) {
        updatePreparation(
          preparationPatch
        );
      }

      setGeneratedWorkoutPreservingProgress(
        generated
      );
      setVisible(false);
      setError('');
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

  if (
    pathname !== '/workout/session' ||
    !workout?.sessionId
  ) {
    return null;
  }

  function open() {
    setError('');
    setVisible(true);
  }

  function close() {
    if (loading) {
      return;
    }

    setVisible(false);
    setError('');
  }

  async function adaptForFatigue() {
    const current =
      buildPreparationSnapshot(
        preparation,
        workout
      );
    const readiness = Math.max(
      1,
      Number(current.readiness ?? 6) - 2
    );

    await adaptRemaining(
      {
        ...current,
        readiness,
      },
      {
        readiness,
        region: null,
      }
    );
  }

  return (
    <>
      <View
        pointerEvents="box-none"
        style={[
          styles.floatingLayer,
          { top: insets.top + 24 },
        ]}
      >
        <Pressable
          onPress={open}
          accessibilityRole="button"
          accessibilityLabel="Ajuster ma séance"
          hitSlop={8}
          style={({ pressed }) => [
            styles.floatingButton,
            pressed &&
              styles.floatingButtonPressed,
          ]}
        >
          <Ionicons
            name="options-outline"
            size={20}
            color={colors.brandWhite}
          />
        </Pressable>
      </View>

      <Modal
        visible={visible}
        transparent
        animationType="fade"
        onRequestClose={close}
      >
        <View style={styles.overlay}>
          <Pressable
            style={styles.backdrop}
            onPress={close}
          />

          <View style={styles.card}>
            <View style={styles.header}>
              <View style={styles.headerMain}>
                <Text style={styles.eyebrow}>
                  COACH UGEROD
                </Text>
                <Text style={styles.title}>
                  AJUSTER MA SÉANCE
                </Text>
              </View>

              <Pressable
                onPress={close}
                disabled={loading}
                style={styles.closeButton}
              >
                <Ionicons
                  name="close"
                  size={21}
                  color={colors.textPrimary}
                />
              </Pressable>
            </View>

            <Text style={styles.helper}>
              Ta forme a changé en cours de séance ? UGEROD conserve ce qui est déjà fait et ajuste uniquement ce qu’il reste à faire.
            </Text>

            {error ? (
              <View style={styles.errorBox}>
                <Ionicons
                  name="alert-circle-outline"
                  size={18}
                  color={colors.brandRed}
                />
                <Text style={styles.errorText}>
                  {error}
                </Text>
              </View>
            ) : null}

            <View style={styles.options}>
              <ActionRow
                icon="battery-half-outline"
                title="PLUS FATIGUÉ QUE PRÉVU"
                description="UGEROD baisse l’intensité du contexte du jour et ajuste uniquement les blocs restants."
                loading={loading}
                onPress={adaptForFatigue}
              />

              <GuidanceRow
                icon="swap-horizontal-outline"
                title="UN EXERCICE ME GÊNE"
                description="Ferme cette fenêtre et utilise Swap sur l’exercice concerné. Pour changer durée, matériel ou gêne globale, utilise simplement le bouton retour de la séance."
              />
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

function ActionRow({
  icon,
  title,
  description,
  loading,
  onPress,
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={loading}
      style={({ pressed }) => [
        styles.actionRow,
        loading &&
          styles.actionRowDisabled,
        pressed &&
          !loading &&
          styles.actionRowPressed,
      ]}
    >
      <View style={styles.actionIcon}>
        <Ionicons
          name={icon}
          size={20}
          color={colors.primaryLight}
        />
      </View>

      <View style={styles.actionMain}>
        <Text style={styles.actionTitle}>
          {title}
        </Text>
        <Text style={styles.actionDescription}>
          {description}
        </Text>
      </View>

      {loading ? (
        <ActivityIndicator
          size="small"
          color={colors.primaryLight}
        />
      ) : (
        <Ionicons
          name="chevron-forward"
          size={18}
          color={colors.textMuted}
        />
      )}
    </Pressable>
  );
}

function GuidanceRow({
  icon,
  title,
  description,
}) {
  return (
    <View style={styles.guidanceRow}>
      <View style={styles.guidanceIcon}>
        <Ionicons
          name={icon}
          size={20}
          color={colors.primaryLight}
        />
      </View>

      <View style={styles.actionMain}>
        <Text style={styles.actionTitle}>
          {title}
        </Text>
        <Text style={styles.actionDescription}>
          {description}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  floatingLayer: {
    position: 'absolute',
    right: spacing.xl + 58,
    zIndex: 80,
  },

  floatingButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor:
      'rgba(16,126,255,0.94)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor:
      'rgba(255,255,255,0.14)',
  },

  floatingButtonPressed: {
    opacity: 0.78,
    transform: [{ scale: 0.96 }],
  },

  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor:
      'rgba(0,0,0,0.38)',
  },

  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },

  card: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.xl,
    paddingTop: 24,
    paddingBottom: 34,
  },

  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 16,
  },

  headerMain: {
    flex: 1,
  },

  eyebrow: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 1.4,
    color: colors.brandRed,
  },

  title: {
    marginTop: 5,
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 35,
    lineHeight: 39,
    letterSpacing: 1.3,
    color: colors.textPrimary,
  },

  closeButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor:
      'rgba(255,255,255,0.05)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  helper: {
    marginTop: 14,
    fontFamily: 'Oswald_400Regular',
    fontSize: 13,
    lineHeight: 19,
    color: colors.textSecondary,
  },

  errorBox: {
    marginTop: 16,
    minHeight: 52,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor:
      'rgba(255,61,72,0.36)',
    backgroundColor:
      'rgba(255,61,72,0.08)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },

  errorText: {
    flex: 1,
    fontFamily: 'Oswald_400Regular',
    fontSize: 12,
    lineHeight: 17,
    color: colors.textPrimary,
  },

  options: {
    marginTop: 18,
    gap: 12,
  },

  actionRow: {
    minHeight: 82,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 13,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor:
      'rgba(255,255,255,0.025)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
  },

  guidanceRow: {
    minHeight: 82,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 13,
    borderWidth: 1,
    borderColor:
      'rgba(16,126,255,0.30)',
    backgroundColor:
      'rgba(16,126,255,0.07)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
  },

  actionRowDisabled: {
    opacity: 0.55,
  },

  actionRowPressed: {
    opacity: 0.76,
  },

  actionIcon: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor:
      'rgba(16,126,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  guidanceIcon: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor:
      'rgba(16,126,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  actionMain: {
    flex: 1,
  },

  actionTitle: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 14,
    lineHeight: 18,
    letterSpacing: 0.55,
    color: colors.textPrimary,
  },

  actionDescription: {
    marginTop: 4,
    fontFamily: 'Oswald_400Regular',
    fontSize: 12,
    lineHeight: 17,
    color: colors.textSecondary,
  },
});