import {
  useMemo,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  router,
  usePathname,
} from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import {
  colors,
  spacing,
} from '../../constants';
import {
  useWorkout,
} from '../../contexts/WorkoutContext';
import {
  generateWorkoutSession,
  reloadWorkoutSession,
} from '../../services/workoutService';
import {
  adaptSessionExercise,
} from '../../services/sessionAdaptationService';

const REASON_OPTIONS = [
  {
    value: 'too_easy',
    label: 'TROP FACILE',
    description:
      'UGEROD cherche une progression plus exigeante.',
    icon: 'arrow-up-circle-outline',
  },
  {
    value: 'too_hard',
    label: 'TROP DIFFICILE',
    description:
      'UGEROD cherche une variante plus accessible.',
    icon: 'arrow-down-circle-outline',
  },
  {
    value: 'environment',
    label: 'IMPOSSIBLE ICI',
    description:
      'Mur, espace, hauteur ou autre contrainte du lieu.',
    icon: 'location-outline',
  },
  {
    value: 'equipment',
    label: 'MATÉRIEL INDISPONIBLE',
    description:
      'UGEROD cherche une alternative sans ce matériel.',
    icon: 'construct-outline',
  },
];

function normalizeBlock(value) {
  if (value === 'warm_up') {
    return 'warmup';
  }

  return value ?? null;
}

function getExerciseKey(exercise) {
  return (
    exercise?.sessionExerciseId ??
    exercise?.session_exercise_id ??
    exercise?.id
  );
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
    region:
      preparation?.region ??
      snapshot?.region ??
      null,
  };
}

export default function SessionAdaptationOverlay() {
  const pathname = usePathname();
  const {
    preparation,
    workout,
    updatePreparation,
    setGeneratedWorkoutPreservingProgress,
  } = useWorkout();

  const [visible, setVisible] =
    useState(false);
  const [view, setView] =
    useState('root');
  const [selectedExercise, setSelectedExercise] =
    useState(null);
  const [forcedReason, setForcedReason] =
    useState(null);
  const [loading, setLoading] =
    useState(false);
  const [error, setError] =
    useState('');

  const adaptableExercises = useMemo(() => {
    const validated = new Set(
      Array.isArray(workout?.validatedBlocks)
        ? workout.validatedBlocks
        : []
    );

    return (workout?.exercises ?? []).filter(
      (exercise) => {
        const block = normalizeBlock(
          exercise?.blockKey ??
            exercise?.block
        );

        return (
          !validated.has(block) &&
          ![
            'completed',
            'not_completed',
          ].includes(exercise?.status) &&
          Boolean(
            exercise?.sessionExerciseId ??
              exercise?.session_exercise_id
          )
        );
      }
    );
  }, [
    workout?.exercises,
    workout?.validatedBlocks,
  ]);

  if (
    pathname !== '/workout/session' ||
    !workout?.sessionId
  ) {
    return null;
  }

  function openRoot() {
    setError('');
    setForcedReason(null);
    setSelectedExercise(null);
    setView('root');
    setVisible(true);
  }

  function close() {
    if (loading) {
      return;
    }

    setVisible(false);
    setError('');
    setSelectedExercise(null);
    setForcedReason(null);
    setView('root');
  }

  function openExerciseList(reason = null) {
    setError('');
    setForcedReason(reason);
    setSelectedExercise(null);
    setView('exercise-list');
  }

  function chooseExercise(exercise) {
    setSelectedExercise(exercise);

    if (forcedReason) {
      handleExerciseAdaptation(
        exercise,
        forcedReason
      );
      return;
    }

    setView('reason');
  }

  async function handleExerciseAdaptation(
    exercise,
    reason
  ) {
    const instanceId =
      exercise?.sessionExerciseId ??
      exercise?.session_exercise_id;

    if (!instanceId) {
      setError(
        'Impossible d’identifier cet exercice dans la séance.'
      );
      return;
    }

    setLoading(true);
    setError('');

    try {
      await adaptSessionExercise({
        sessionId: workout.sessionId,
        sessionExerciseId: instanceId,
        currentExerciseId:
          exercise?.exerciseId ??
          exercise?.id,
        reason,
      });

      const refreshed =
        await reloadWorkoutSession({
          sessionId: workout.sessionId,
          preparationSnapshot:
            workout.preparationSnapshot,
        });

      setGeneratedWorkoutPreservingProgress({
        ...refreshed,
        exercises:
          (refreshed.exercises ?? []).map(
            (item) =>
              item.sessionExerciseId ===
              instanceId
                ? {
                    ...item,
                    status: 'adapted',
                    adaptationSource:
                      reason,
                  }
                : item
          ),
      });

      closeAfterSuccess();
    } catch (adaptationError) {
      setError(
        adaptationError instanceof Error
          ? adaptationError.message
          : 'Impossible de trouver une alternative sûre.'
      );
    } finally {
      setLoading(false);
    }
  }

  function closeAfterSuccess() {
    setVisible(false);
    setError('');
    setSelectedExercise(null);
    setForcedReason(null);
    setView('root');
  }

  async function adaptForFatigue() {
    setLoading(true);
    setError('');

    try {
      const current =
        buildPreparationSnapshot(
          preparation,
          workout
        );
      const readiness = Math.max(
        1,
        Number(current.readiness ?? 6) - 2
      );
      const nextPreparation = {
        ...current,
        readiness,
      };

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
            ? 'La limite d’adaptations globales de cette séance est atteinte.'
            : 'UGEROD a besoin d’une nouvelle confirmation avant de recalculer la séance.'
        );
      }

      updatePreparation({
        readiness,
      });
      setGeneratedWorkoutPreservingProgress(
        generated
      );
      closeAfterSuccess();
    } catch (adaptationError) {
      setError(
        adaptationError instanceof Error
          ? adaptationError.message
          : 'Impossible d’adapter le reste de la séance.'
      );
    } finally {
      setLoading(false);
    }
  }

  function openInjuries() {
    setVisible(false);
    router.push('/workout/injuries');
  }

  return (
    <>
      <View
        pointerEvents="box-none"
        style={styles.floatingLayer}
      >
        <Pressable
          onPress={openRoot}
          style={({ pressed }) => [
            styles.floatingButton,
            pressed &&
              styles.floatingButtonPressed,
          ]}
        >
          <Ionicons
            name="options-outline"
            size={18}
            color={colors.brandWhite}
          />
          <Text style={styles.floatingButtonText}>
            ADAPTER
          </Text>
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
                  {view === 'root' &&
                    'ADAPTER MA SÉANCE'}
                  {view === 'exercise-list' &&
                    'QUEL EXERCICE ?'}
                  {view === 'reason' &&
                    String(
                      selectedExercise?.name ??
                        'EXERCICE'
                    ).toUpperCase()}
                  {view === 'emergency' &&
                    'ADAPTER LE RESTE'}
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

            {view === 'root' ? (
              <View style={styles.options}>
                <ActionRow
                  icon="swap-horizontal-outline"
                  title="ADAPTER UN EXERCICE"
                  description="Trop facile, trop difficile, impossible ici ou matériel indisponible."
                  onPress={() =>
                    openExerciseList()
                  }
                />
                <ActionRow
                  icon="shield-outline"
                  title="ADAPTER LE RESTE DE MA SÉANCE"
                  description="Si ton état ou ton contexte a changé pendant l’entraînement."
                  onPress={() =>
                    setView('emergency')
                  }
                />
              </View>
            ) : null}

            {view === 'exercise-list' ? (
              <>
                <Text style={styles.helper}>
                  Choisis le premier mouvement qui ne convient plus. UGEROD ne touche pas aux blocs déjà terminés.
                </Text>

                <ScrollView
                  style={styles.exerciseList}
                  showsVerticalScrollIndicator={false}
                >
                  {adaptableExercises.map(
                    (exercise) => (
                      <Pressable
                        key={getExerciseKey(
                          exercise
                        )}
                        onPress={() =>
                          chooseExercise(
                            exercise
                          )
                        }
                        disabled={loading}
                        style={({ pressed }) => [
                          styles.exerciseRow,
                          pressed &&
                            styles.rowPressed,
                        ]}
                      >
                        <View
                          style={styles.exerciseIcon}
                        >
                          <Ionicons
                            name="barbell-outline"
                            size={18}
                            color={
                              colors.primaryLight
                            }
                          />
                        </View>
                        <View
                          style={styles.exerciseMain}
                        >
                          <Text
                            style={styles.exerciseName}
                          >
                            {String(
                              exercise?.name ??
                                'EXERCICE'
                            ).toUpperCase()}
                          </Text>
                          <Text
                            style={styles.exerciseMeta}
                          >
                            {String(
                              normalizeBlock(
                                exercise?.blockKey ??
                                  exercise?.block
                              ) ?? 'SÉANCE'
                            ).toUpperCase()}
                          </Text>
                        </View>
                        {loading &&
                        selectedExercise &&
                        getExerciseKey(
                          selectedExercise
                        ) ===
                          getExerciseKey(
                            exercise
                          ) ? (
                          <ActivityIndicator
                            size="small"
                            color={
                              colors.primaryLight
                            }
                          />
                        ) : (
                          <Ionicons
                            name="chevron-forward"
                            size={18}
                            color={colors.textMuted}
                          />
                        )}
                      </Pressable>
                    )
                  )}
                </ScrollView>
              </>
            ) : null}

            {view === 'reason' ? (
              <View style={styles.options}>
                <Text style={styles.helper}>
                  Pourquoi veux-tu changer ce mouvement ?
                </Text>

                {REASON_OPTIONS.map(
                  (option) => (
                    <ActionRow
                      key={option.value}
                      icon={option.icon}
                      title={option.label}
                      description={
                        option.description
                      }
                      loading={loading}
                      onPress={() =>
                        handleExerciseAdaptation(
                          selectedExercise,
                          option.value
                        )
                      }
                    />
                  )
                )}
              </View>
            ) : null}

            {view === 'emergency' ? (
              <View style={styles.options}>
                <ActionRow
                  icon="battery-half-outline"
                  title="JE SUIS PLUS FATIGUÉ QUE PRÉVU"
                  description="UGEROD réduit la readiness et recalcule uniquement ce qui reste à faire."
                  loading={loading}
                  onPress={adaptForFatigue}
                />
                <ActionRow
                  icon="location-outline"
                  title="MON ENVIRONNEMENT BLOQUE UN EXERCICE"
                  description="UGEROD identifie la contrainte du mouvement et cherche une alternative réalisable ici."
                  onPress={() =>
                    openExerciseList(
                      'environment'
                    )
                  }
                />
                <ActionRow
                  icon="construct-outline"
                  title="UN MATÉRIEL N’EST PLUS DISPONIBLE"
                  description="Choisis le mouvement concerné : UGEROD cherchera une alternative sans ce matériel."
                  onPress={() =>
                    openExerciseList(
                      'equipment'
                    )
                  }
                />
                <ActionRow
                  icon="medkit-outline"
                  title="UNE GÊNE EST APPARUE"
                  description="Mets à jour la zone à protéger avant de poursuivre."
                  onPress={openInjuries}
                />
              </View>
            ) : null}

            {view !== 'root' ? (
              <Pressable
                onPress={() => {
                  if (loading) {
                    return;
                  }

                  setError('');
                  setForcedReason(null);
                  setSelectedExercise(null);
                  setView('root');
                }}
                style={styles.backAction}
              >
                <Ionicons
                  name="arrow-back"
                  size={16}
                  color={colors.textSecondary}
                />
                <Text
                  style={styles.backActionText}
                >
                  RETOUR
                </Text>
              </Pressable>
            ) : null}
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
  onPress,
  loading = false,
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={loading}
      style={({ pressed }) => [
        styles.actionRow,
        loading && styles.rowDisabled,
        pressed &&
          !loading &&
          styles.rowPressed,
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

const styles = StyleSheet.create({
  floatingLayer: {
    position: 'absolute',
    right: spacing.xl,
    bottom: 24,
    zIndex: 30,
  },
  floatingButton: {
    minHeight: 46,
    paddingHorizontal: 17,
    borderRadius: 23,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(8,104,255,0.96)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  floatingButtonPressed: {
    opacity: 0.82,
    transform: [{ scale: 0.98 }],
  },
  floatingButtonText: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 11,
    letterSpacing: 0.9,
    color: colors.brandWhite,
  },
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.48)',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  card: {
    maxHeight: '84%',
    paddingHorizontal: spacing.xl,
    paddingTop: 20,
    paddingBottom: 28,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: '#0D1116',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.09)',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  headerMain: {
    flex: 1,
  },
  eyebrow: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 1.1,
    color: colors.brandRed,
  },
  title: {
    marginTop: 4,
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 31,
    lineHeight: 34,
    letterSpacing: 1.3,
    color: colors.textPrimary,
  },
  closeButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceElevated,
  },
  helper: {
    marginTop: 12,
    marginBottom: 10,
    fontFamily: 'Oswald_400Regular',
    fontSize: 12,
    lineHeight: 18,
    color: colors.textSecondary,
  },
  errorBox: {
    marginTop: 14,
    padding: 12,
    borderRadius: 13,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: 'rgba(255,59,59,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,59,59,0.20)',
  },
  errorText: {
    flex: 1,
    fontFamily: 'Oswald_400Regular',
    fontSize: 11,
    lineHeight: 17,
    color: colors.textSecondary,
  },
  options: {
    marginTop: 16,
    gap: 9,
  },
  actionRow: {
    minHeight: 76,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  actionIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primaryTransparent,
  },
  actionMain: {
    flex: 1,
  },
  actionTitle: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.45,
    color: colors.textPrimary,
  },
  actionDescription: {
    marginTop: 3,
    fontFamily: 'Oswald_400Regular',
    fontSize: 11,
    lineHeight: 16,
    color: colors.textSecondary,
  },
  exerciseList: {
    maxHeight: 430,
  },
  exerciseRow: {
    minHeight: 68,
    marginBottom: 8,
    paddingHorizontal: 13,
    paddingVertical: 10,
    borderRadius: 15,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
  },
  exerciseIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primaryTransparent,
  },
  exerciseMain: {
    flex: 1,
  },
  exerciseName: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 12,
    lineHeight: 16,
    color: colors.textPrimary,
  },
  exerciseMeta: {
    marginTop: 2,
    fontFamily: 'Oswald_500Medium',
    fontSize: 9,
    lineHeight: 13,
    letterSpacing: 0.7,
    color: colors.textMuted,
  },
  backAction: {
    alignSelf: 'flex-start',
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingVertical: 7,
  },
  backActionText: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 10,
    letterSpacing: 0.7,
    color: colors.textSecondary,
  },
  rowPressed: {
    backgroundColor: colors.surfacePressed,
  },
  rowDisabled: {
    opacity: 0.5,
  },
});
