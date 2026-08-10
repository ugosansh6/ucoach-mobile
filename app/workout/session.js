// session.js — compatible bright-handler v2.4.2\nimport { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useMemo, useState } from 'react';
import {
  Image,
  ImageBackground,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import {
  colors,
  spacing,
  typography,
} from '../../src/constants';

import {
  useWorkout,
} from '../../src/contexts/WorkoutContext';

import {
  swapWorkoutExercise,
} from '../../src/services/workoutService';

const brandIcon = require('../../assets/branding/ugerod-icon.png');
const workoutBackground = require('../../assets/backgrounds/welcome-default.jpg');

/*
 * =========================================================
 * INFORMATIONS VISUELLES TEMPORAIRES
 * =========================================================
 *
 * Plus tard elles viendront directement de la table exercises.
 */

const EXERCISE_DETAILS = {
  'air-squat': {
    description:
      'Descends les hanches en gardant le buste droit et les pieds bien ancrés au sol.',
    tip:
      'Genoux dans l’axe des pieds.',
  },

  'shoulder-tap': {
    description:
      'En position de planche, touche alternativement chaque épaule avec la main opposée.',
    tip:
      'Garde le bassin aussi stable que possible.',
  },

  'dead-bug': {
    description:
      'Allongé sur le dos, alterne bras et jambe opposés tout en gardant le bas du dos au sol.',
    tip:
      'Cherche le contrôle plutôt que la vitesse.',
  },

  'goblet-squat': {
    description:
      'Tiens la charge devant la poitrine et réalise un squat contrôlé.',
    tip:
      'Reste solide sur le tronc et garde les talons au sol.',
  },

  'push-up': {
    description:
      'Descends la poitrine vers le sol en gardant le corps aligné puis repousse.',
    tip:
      'Garde les coudes légèrement orientés vers l’arrière.',
  },

  burpee: {
    description:
      'Descends au sol puis reviens debout avec une extension complète.',
    tip:
      'Trouve un rythme que tu peux maintenir.',
  },
};

/*
 * =========================================================
 * FALLBACK POUR LE MENU DEV
 * =========================================================
 *
 * Si on ouvre directement /workout/session sans passer
 * par Préparation → Génération, on garde une séance de test.
 */

const FALLBACK_EXERCISES = [
  {
    id: 'air-squat',
    block: 'warmup',
    name: 'Air Squat',
    prescription: '2 × 12',
    status: 'pending',
    trackingType: 'bodyweight',
  },

  {
    id: 'shoulder-tap',
    block: 'warmup',
    name: 'Shoulder Tap',
    prescription: '2 × 10 / côté',
    status: 'pending',
    trackingType: 'bodyweight',
  },

  {
    id: 'dead-bug',
    block: 'tabata',
    name: 'Dead Bug',
    prescription: '20 sec / 10 sec',
    status: 'pending',
    trackingType: 'time',
  },

  {
    id: 'goblet-squat',
    block: 'skill',
    name: 'Goblet Squat',
    prescription: '4 × 8',
    status: 'pending',
    trackingType: 'load',
  },

  {
    id: 'goblet-squat-wod',
    exerciseId: 'goblet-squat',
    block: 'wod',
    name: 'Goblet Squat',
    prescription: '12 reps',
    status: 'pending',
    trackingType: 'load',
  },

  {
    id: 'push-up',
    block: 'wod',
    name: 'Push-up',
    prescription: '10 reps',
    status: 'pending',
    trackingType: 'bodyweight',
  },

  {
    id: 'burpee',
    block: 'wod',
    name: 'Burpee',
    prescription: '8 reps',
    status: 'pending',
    trackingType: 'bodyweight',
  },
];

function getExerciseDetails(exercise) {
  const referenceId =
    exercise.exerciseId ??
    exercise.id;

  return (
    EXERCISE_DETAILS[
      referenceId
    ] ?? {
      description:
        'Consulte les consignes de mouvement et réalise chaque répétition avec contrôle.',
      tip:
        'Privilégie toujours la qualité du mouvement.',
    }
  );
}

function normalizeBlockTitle(
  blockId,
  title,
  durationMinutes
) {
  if (blockId === 'warmup') {
    return 'WARM-UP';
  }

  if (blockId === 'tabata') {
    return durationMinutes >= 8
      ? '2 TABATAS'
      : 'TABATA';
  }

  if (blockId === 'skill') {
    return 'SKILL';
  }

  if (blockId === 'wod') {
    return 'WOD';
  }

  return title;
}

function normalizeBlockId(value) {
  if (value === 'warm_up') {
    return 'warmup';
  }

  return value;
}

function getWorkoutBlock(
  workout,
  blockId
) {
  const blockData =
    workout.blocks ?? {};

  if (Array.isArray(blockData)) {
    return (
      blockData.find(
        (block) =>
          normalizeBlockId(
            block.block_key ??
              block.id
          ) === blockId
      ) ?? null
    );
  }

  if (
    blockId === 'warmup'
  ) {
    return (
      blockData.warmup ??
      blockData.warm_up ??
      null
    );
  }

  return (
    blockData[blockId] ??
    null
  );
}

function readBlockDuration(
  block,
  fallback
) {
  const raw =
    block?.duration ??
    block?.duration_minutes;

  const numeric =
    Number(raw);

  if (
    Number.isFinite(numeric) &&
    numeric >= 0
  ) {
    return numeric;
  }

  return fallback;
}

function readBlockStructure(
  block,
  fallback
) {
  return (
    block?.structure ??
    fallback
  );
}

function getTabataNumber(
  exercise,
  index,
  durationMinutes
) {
  const explicit =
    exercise
      .prescriptionJson
      ?.tabata_number ??
    exercise
      .prescription_json
      ?.tabata_number ??
    exercise.tabataNumber;

  if (
    Number(explicit) === 1 ||
    Number(explicit) === 2
  ) {
    return Number(explicit);
  }

  if (
    durationMinutes >= 8
  ) {
    return index < 2 ? 1 : 2;
  }

  return 1;
}

function getTabataPosition(
  exercise,
  index
) {
  const explicit =
    exercise
      .prescriptionJson
      ?.tabata_position ??
    exercise
      .prescription_json
      ?.tabata_position ??
    exercise.tabataPosition;

  if (
    explicit === 'A' ||
    explicit === 'B'
  ) {
    return explicit;
  }

  return index % 2 === 0
    ? 'A'
    : 'B';
}

function buildBlocks(
  workout,
  exercises
) {
  const plannedDuration =
    workout.plannedDuration ??
    45;

  const isDevFallback =
    !workout.exercises?.length;

  const warmupBlock =
    getWorkoutBlock(
      workout,
      'warmup'
    );

  const tabataBlock =
    getWorkoutBlock(
      workout,
      'tabata'
    );

  const skillBlock =
    getWorkoutBlock(
      workout,
      'skill'
    );

  const wodBlock =
    getWorkoutBlock(
      workout,
      'wod'
    );

  const warmupDuration =
    readBlockDuration(
      warmupBlock,
      isDevFallback ? 8 : 0
    );

  const tabataDuration =
    readBlockDuration(
      tabataBlock,
      isDevFallback ? 4 : 0
    );

  const skillDuration =
    readBlockDuration(
      skillBlock,
      isDevFallback ? 8 : 0
    );

  /*
   * IMPORTANT :
   * la durée du WOD vient d'une seule source de vérité.
   * On ne recalcule plus "plannedDuration - 20" dans l'UI.
   */
  const wodDuration =
    readBlockDuration(
      wodBlock,
      isDevFallback
        ? Math.max(
            plannedDuration - 20,
            10
          )
        : 0
    );

  const definitions = [
    {
      id: 'warmup',
      source: warmupBlock,
      title:
        warmupBlock?.title ??
        warmupBlock?.block_name ??
        'WARM-UP',
      duration:
        warmupDuration,
      structure:
        readBlockStructure(
          warmupBlock,
          isDevFallback
            ? '2 PASSAGES COURTS'
            : ''
        ),
    },

    {
      id: 'tabata',
      source: tabataBlock,
      title:
        tabataBlock?.title ??
        tabataBlock?.block_name ??
        'TABATA',
      duration:
        tabataDuration,
      structure:
        readBlockStructure(
          tabataBlock,
          tabataDuration >= 8
            ? '2 TABATAS DE 4 MIN · 20S / 10S'
            : '1 TABATA DE 4 MIN · 20S / 10S'
        ),
    },

    {
      id: 'skill',
      source: skillBlock,
      title:
        skillBlock?.title ??
        skillBlock?.block_name ??
        'SKILL',
      duration:
        skillDuration,
      structure:
        readBlockStructure(
          skillBlock,
          isDevFallback
            ? '4 SÉRIES'
            : ''
        ),
    },

    {
      id: 'wod',
      source: wodBlock,
      title:
        wodBlock?.title ??
        wodBlock?.block_name ??
        'WOD',
      duration:
        wodDuration,
      structure:
        readBlockStructure(
          wodBlock,
          `${
            wodBlock?.format ??
            workout.format ??
            'AMRAP'
          } ${wodDuration} MIN`
        ),
    },
  ];

  return definitions
    .map(
      (definition) => {
        const blockExercises =
          exercises
            .filter(
              (exercise) =>
                normalizeBlockId(
                  exercise.block
                ) ===
                definition.id
            )
            .map(
              (
                exercise,
                index
              ) => {
                const details =
                  getExerciseDetails(
                    exercise
                  );

                const normalized = {
                  ...exercise,

                  name:
                    exercise.name.toUpperCase(),

                  description:
                    exercise.instructions ??
                    exercise.description ??
                    details.description,

                  tip:
                    exercise.tips ??
                    exercise.tip ??
                    details.tip,
                };

                if (
                  definition.id ===
                  'tabata'
                ) {
                  normalized.tabataNumber =
                    getTabataNumber(
                      exercise,
                      index,
                      definition.duration
                    );

                  normalized.tabataPosition =
                    getTabataPosition(
                      exercise,
                      index
                    );
                }

                return normalized;
              }
            );

        return {
          ...definition,

          title:
            normalizeBlockTitle(
              definition.id,
              definition.title,
              definition.duration
            ),

          durationMinutes:
            definition.duration,

          duration:
            `${definition.duration} MIN`,

          exercises:
            blockExercises,
        };
      }
    )
    /*
     * Skill et Tabata peuvent maintenant être absents.
     * Un bloc sans exercice n'est donc jamais affiché dans le parcours réel.
     */
    .filter(
      (block) =>
        block.exercises.length > 0 &&
        block.durationMinutes > 0
    );
}


function getTrackingType(
  trackingModes
) {
  const modes =
    Array.isArray(
      trackingModes
    )
      ? trackingModes
      : [];

  if (
    modes.includes('load')
  ) {
    return 'load';
  }

  if (
    modes.includes(
      'distance'
    )
  ) {
    return 'distance';
  }

  if (
    modes.includes('time')
  ) {
    return 'time';
  }

  return 'bodyweight';
}

export default function WorkoutSessionScreen() {
  const {
    workout,
    updateWorkout,
    updateExercise,
  } = useWorkout();

  /*
   * Si l'écran est ouvert directement depuis le menu DEV,
   * on utilise FALLBACK_EXERCISES.
   *
   * Dans le vrai parcours utilisateur, workout.exercises
   * contient la séance créée dans generating.js.
   */
  const sourceExercises =
    workout.exercises?.length > 0
      ? workout.exercises
      : FALLBACK_EXERCISES;

  const plannedDuration =
    workout.plannedDuration ??
    45;

  const workoutTitle =
    workout.title ??
    'FULL BODY';

  const workoutFormat =
    workout.format ??
    'AMRAP';

  const blockDefinitions =
    useMemo(
      () =>
        buildBlocks(
          workout,
          sourceExercises
        ),
      [
        workout,
        sourceExercises,
      ]
    );

  /*
   * Les blocs validés restent une logique d'interface.
   * Les décisions exercice par exercice sont quant à elles
   * enregistrées directement dans WorkoutContext.
   */
  const [
    validatedBlocks,
    setValidatedBlocks,
  ] = useState([]);

  const [
    expandedBlocks,
    setExpandedBlocks,
  ] = useState(() =>
    blockDefinitions.reduce(
      (
        accumulator,
        block,
        index
      ) => ({
        ...accumulator,
        [block.id]:
          index === 0,
      }),
      {}
    )
  );

  const [
    expandedExercises,
    setExpandedExercises,
  ] = useState({});

  const [
    swappingExerciseId,
    setSwappingExerciseId,
  ] = useState(null);

  const [
    swapError,
    setSwapError,
  ] = useState('');

  const blocks = useMemo(
    () =>
      blockDefinitions.map(
        (block) => ({
          ...block,

          validated:
            validatedBlocks.includes(
              block.id
            ),
        })
      ),
    [
      blockDefinitions,
      validatedBlocks,
    ]
  );

  const wodUnlocked =
    useMemo(() => {
      const previousBlockIds =
        blocks
          .filter(
            (block) =>
              block.id !== 'wod'
          )
          .map(
            (block) =>
              block.id
          );

      return previousBlockIds.every(
        (blockId) =>
          validatedBlocks.includes(
            blockId
          )
      );
    }, [
      blocks,
      validatedBlocks,
    ]);

  function handleBack() {
    router.back();
  }

  function toggleBlock(blockId) {
    if (
      blockId === 'wod' &&
      !wodUnlocked
    ) {
      return;
    }

    setExpandedBlocks(
      (current) => ({
        ...current,

        [blockId]:
          !current[blockId],
      })
    );
  }

  function toggleExerciseDetails(
    exerciseId
  ) {
    setExpandedExercises(
      (current) => ({
        ...current,

        [exerciseId]:
          !current[exerciseId],
      })
    );
  }

  function cycleExerciseStatus(
    blockId,
    exerciseId
  ) {
    if (
      validatedBlocks.includes(
        blockId
      )
    ) {
      return;
    }

    const exercise =
      sourceExercises.find(
        (item) =>
          item.id === exerciseId
      );

    if (!exercise) {
      return;
    }

    let nextStatus =
      'skipped';

    if (
      exercise.status ===
      'skipped'
    ) {
      nextStatus =
        'completed';
    }

    if (
      exercise.status ===
      'completed'
    ) {
      nextStatus =
        'pending';
    }

    /*
     * Cas parcours normal :
     * l'exercice existe dans WorkoutContext.
     */
    if (
      workout.exercises?.some(
        (item) =>
          item.id === exerciseId
      )
    ) {
      updateExercise(
        exerciseId,
        {
          status:
            nextStatus,
        }
      );

      return;
    }

    /*
     * Cas menu DEV :
     * on initialise la séance de fallback dans le contexte
     * avant d'enregistrer la modification.
     */
    const initializedExercises =
      sourceExercises.map(
        (item) =>
          item.id === exerciseId
            ? {
                ...item,
                status:
                  nextStatus,
              }
            : item
      );

    updateWorkout({
      sessionId:
        'dev-active-session',

      status: 'generated',

      title:
        workoutTitle,

      format:
        workoutFormat,

      plannedDuration,

      exercises:
        initializedExercises,
    });
  }

  async function handleSwap(
    blockId,
    exerciseId
  ) {
    if (
      swappingExerciseId ||
      validatedBlocks.includes(
        blockId
      )
    ) {
      return;
    }

    if (!workout.sessionId) {
      setSwapError(
        "Impossible de changer l'exercice : séance backend introuvable."
      );

      return;
    }

    setSwapError('');
    setSwappingExerciseId(
      exerciseId
    );

    try {
      const data =
        await swapWorkoutExercise({
          sessionId:
            workout.sessionId,
          currentExerciseId:
            exerciseId,
        });

      const substitute =
        data.substitute;

      updateExercise(
        exerciseId,
        {
          id:
            substitute.id,

          exerciseId:
            substitute.id,

          name:
            substitute.name,

          prescription:
            substitute.prescription,

          prescriptionJson:
            substitute.prescription_json ??
            null,

          instructions:
            substitute.instructions ??
            null,

          tips:
            substitute.tips ??
            null,

          pattern:
            substitute.pattern ??
            null,

          region:
            substitute.region ??
            null,

          trackingModes:
            substitute.tracking_modes ??
            [],

          trackingType:
            getTrackingType(
              substitute.tracking_modes
            ),

          status:
            'pending',
        }
      );

      setExpandedExercises(
        (current) => {
          const next = {
            ...current,
          };

          delete next[
            exerciseId
          ];

          return next;
        }
      );
    } catch (error) {
      setSwapError(
        error?.message ??
          "Impossible de changer cet exercice."
      );
    } finally {
      setSwappingExerciseId(
        null
      );
    }
  }

  function canValidateBlock(
    block
  ) {
    return block.exercises.every(
      (exercise) =>
        exercise.status !==
        'pending'
    );
  }

  function validateBlock(
    blockId
  ) {
    const block = blocks.find(
      (item) =>
        item.id === blockId
    );

    if (!block) {
      return;
    }

    if (
      !canValidateBlock(block)
    ) {
      return;
    }

    /*
     * FIN DU WOD
     */
    if (
      blockId === 'wod'
    ) {
      const allValidated = [
        ...validatedBlocks,
        'wod',
      ];

      setValidatedBlocks(
        allValidated
      );

      updateWorkout({
        status:
          'awaiting_completion',

        validatedBlocks:
          allValidated,
      });

      router.push(
        '/workout/completion'
      );

      return;
    }

    const nextValidated = [
      ...validatedBlocks,
      blockId,
    ];

    setValidatedBlocks(
      nextValidated
    );

    updateWorkout({
      validatedBlocks:
        nextValidated,
    });

    const currentIndex =
      blocks.findIndex(
        (item) =>
          item.id === blockId
      );

    const nextBlock =
      blocks[
        currentIndex + 1
      ];

    if (nextBlock) {
      setExpandedBlocks(
        (current) => ({
          ...current,

          [blockId]:
            false,

          [nextBlock.id]:
            true,
        })
      );
    }
  }

  return (
    <View style={styles.screen}>
      <ImageBackground
        source={
          workoutBackground
        }
        style={styles.background}
        resizeMode="cover"
      >
        {/* VOILE NOIR */}
        <View
          style={
            styles.darkOverlay
          }
        />

        {/* DÉGRADÉ VERTICAL */}
        <LinearGradient
          colors={[
            'rgba(6,8,11,0.58)',
            'rgba(6,8,11,0.72)',
            'rgba(6,8,11,0.88)',
            'rgba(6,8,11,0.98)',
          ]}
          locations={[
            0,
            0.25,
            0.62,
            1,
          ]}
          style={
            StyleSheet.absoluteFill
          }
        />

        {/* DÉGRADÉ LATÉRAL */}
        <LinearGradient
          colors={[
            'rgba(6,8,11,0.48)',
            'rgba(6,8,11,0.05)',
            'rgba(6,8,11,0.28)',
          ]}
          start={{
            x: 0,
            y: 0.5,
          }}
          end={{
            x: 1,
            y: 0.5,
          }}
          style={
            StyleSheet.absoluteFill
          }
        />

        <SafeAreaView
          style={
            styles.safeArea
          }
        >
          <ScrollView
            contentContainerStyle={
              styles.content
            }
            showsVerticalScrollIndicator={
              false
            }
          >
            {/* HEADER */}
            <View
              style={
                styles.header
              }
            >
              <Pressable
                onPress={
                  handleBack
                }
                hitSlop={12}
                style={({
                  pressed,
                }) => [
                  styles.backButton,

                  pressed &&
                    styles.pressed,
                ]}
              >
                <Ionicons
                  name="arrow-back"
                  size={22}
                  color={
                    colors.textPrimary
                  }
                />
              </Pressable>

              <View
                style={
                  styles.headerText
                }
              >
                <Text
                  style={
                    styles.headerEyebrow
                  }
                >
                  {workoutTitle}
                </Text>

                <Text
                  style={
                    styles.headerTitle
                  }
                >
                  TON WOD

                  <Text
                    style={
                      styles.blueDot
                    }
                  >
                    .
                  </Text>
                </Text>
              </View>

              <Image
                source={
                  brandIcon
                }
                style={
                  styles.brandIcon
                }
                resizeMode="contain"
              />
            </View>

            {/* RÉSUMÉ */}
            <View
              style={
                styles.summaryCard
              }
            >
              <View>
                <Text
                  style={
                    styles.summaryLabel
                  }
                >
                  DURÉE PRÉVUE
                </Text>

                <Text
                  style={
                    styles.summaryDuration
                  }
                >
                  {
                    plannedDuration
                  } MIN
                </Text>
              </View>

              <View
                style={
                  styles.summaryRight
                }
              >
                <Text
                  style={
                    styles.summaryLabel
                  }
                >
                  {blocks.length} BLOCS ·{' '}
                  {workoutFormat}
                </Text>

                <View
                  style={
                    styles.tricolor
                  }
                >
                  <View
                    style={
                      styles.tricolorBlue
                    }
                  />

                  <View
                    style={
                      styles.tricolorWhite
                    }
                  />

                  <View
                    style={
                      styles.tricolorRed
                    }
                  />
                </View>
              </View>
            </View>

            {/* ERREUR SWAP */}
            {swapError ? (
              <View
                style={
                  styles.swapErrorCard
                }
              >
                <Ionicons
                  name="alert-circle-outline"
                  size={19}
                  color={
                    colors.brandRed
                  }
                />

                <Text
                  style={
                    styles.swapErrorText
                  }
                >
                  {swapError}
                </Text>
              </View>
            ) : null}

            {/* BLOCS */}
            <View
              style={styles.blocks}
            >
              {blocks.map(
                (block) => {
                  const isWod =
                    block.id ===
                    'wod';

                  const locked =
                    isWod &&
                    !wodUnlocked;

                  const expanded =
                    expandedBlocks[
                      block.id
                    ];

                  const canValidate =
                    canValidateBlock(
                      block
                    );

                  return (
                    <View
                      key={
                        block.id
                      }
                      style={[
                        styles.block,

                        block.validated &&
                          styles.blockValidated,

                        locked &&
                          styles.blockLocked,
                      ]}
                    >
                      {/* HEADER BLOC */}
                      <Pressable
                        onPress={() =>
                          toggleBlock(
                            block.id
                          )
                        }
                        style={
                          styles.blockHeader
                        }
                      >
                        <BlockStatus
                          validated={
                            block.validated
                          }
                          locked={
                            locked
                          }
                        />

                        <View
                          style={
                            styles.blockHeaderText
                          }
                        >
                          <View
                            style={
                              styles.blockTitleRow
                            }
                          >
                            <Text
                              style={[
                                styles.blockTitle,

                                locked &&
                                  styles.blockTitleLocked,
                              ]}
                            >
                              {
                                block.title
                              }
                            </Text>

                            <Text
                              style={
                                styles.blockDuration
                              }
                            >
                              {
                                block.duration
                              }
                            </Text>
                          </View>

                          {!locked && (
                            <Text
                              style={
                                styles.blockStructure
                              }
                            >
                              {
                                block.structure
                              }
                            </Text>
                          )}

                          {locked && (
                            <Text
                              style={
                                styles.blockLockedText
                              }
                            >
                              VALIDE LES
                              BLOCS
                              PRÉCÉDENTS
                              POUR
                              LE DÉCOUVRIR
                            </Text>
                          )}
                        </View>

                        <Ionicons
                          name={
                            locked
                              ? 'lock-closed-outline'
                              : expanded
                                ? 'chevron-up'
                                : 'chevron-down'
                          }
                          size={20}
                          color={
                            locked
                              ? colors.textMuted
                              : colors.textSecondary
                          }
                        />
                      </Pressable>

                      {/* CONTENU */}
                      {expanded &&
                        !locked && (
                          <View
                            style={
                              styles.blockContent
                            }
                          >
                            <View
                              style={
                                styles.structureBanner
                              }
                            >
                              <Text
                                style={
                                  styles.structureBannerLabel
                                }
                              >
                                STRUCTURE
                              </Text>

                              <Text
                                style={
                                  styles.structureBannerValue
                                }
                              >
                                {
                                  block.structure
                                }
                              </Text>
                            </View>

                            {block.exercises.map(
                              (
                                exercise,
                                index
                              ) => {
                                const detailsExpanded =
                                  expandedExercises[
                                    exercise
                                      .id
                                  ];

                                const showTabataGroup =
                                  block.id ===
                                    'tabata' &&
                                  (
                                    index === 0 ||
                                    block
                                      .exercises[
                                        index - 1
                                      ]
                                      ?.tabataNumber !==
                                      exercise
                                        .tabataNumber
                                  );

                                return (
                                  <View
                                    key={
                                      exercise.id
                                    }
                                  >
                                    {showTabataGroup && (
                                      <View
                                        style={
                                          styles.tabataGroupHeader
                                        }
                                      >
                                        <Text
                                          style={
                                            styles.tabataGroupTitle
                                          }
                                        >
                                          TABATA{' '}
                                          {
                                            exercise
                                              .tabataNumber
                                          }
                                        </Text>

                                        <Text
                                          style={
                                            styles.tabataGroupMeta
                                          }
                                        >
                                          4 MIN · 8 ROUNDS · A / B
                                        </Text>
                                      </View>
                                    )}

                                    <View
                                      style={[
                                        styles.exerciseWrapper,

                                        index !==
                                          block
                                            .exercises
                                            .length -
                                            1 &&
                                          styles.exerciseBorder,
                                      ]}
                                    >
                                      <View
                                        style={
                                          styles.exerciseRow
                                        }
                                      >
                                      {/* STATUT */}
                                      <Pressable
                                        onPress={() =>
                                          cycleExerciseStatus(
                                            block.id,
                                            exercise.id
                                          )
                                        }
                                        disabled={
                                          block.validated
                                        }
                                        style={[
                                          styles.exerciseStatus,

                                          exercise.status ===
                                            'skipped' &&
                                            styles.exerciseStatusSkipped,

                                          exercise.status ===
                                            'completed' &&
                                            styles.exerciseStatusCompleted,
                                        ]}
                                      >
                                        {exercise.status ===
                                          'skipped' && (
                                          <Ionicons
                                            name="close"
                                            size={
                                              16
                                            }
                                            color={
                                              colors.brandWhite
                                            }
                                          />
                                        )}

                                        {exercise.status ===
                                          'completed' && (
                                          <Ionicons
                                            name="checkmark"
                                            size={
                                              16
                                            }
                                            color={
                                              colors.brandWhite
                                            }
                                          />
                                        )}
                                      </Pressable>

                                      {/* EXERCICE */}
                                      <Pressable
                                        onPress={() =>
                                          toggleExerciseDetails(
                                            exercise.id
                                          )
                                        }
                                        style={
                                          styles.exerciseMain
                                        }
                                      >
                                        {block.id ===
                                          'tabata' &&
                                          exercise.tabataPosition && (
                                            <Text
                                              style={
                                                styles.tabataPosition
                                              }
                                            >
                                              EXERCICE{' '}
                                              {
                                                exercise
                                                  .tabataPosition
                                              }
                                            </Text>
                                          )}

                                        <Text
                                          style={
                                            styles.exerciseName
                                          }
                                        >
                                          {
                                            exercise.name
                                          }
                                        </Text>

                                        <Text
                                          style={
                                            styles.exercisePrescription
                                          }
                                        >
                                          {
                                            exercise.prescription
                                          }
                                        </Text>
                                      </Pressable>

                                      {/* SWAP */}
                                      {exercise.status ===
                                        'pending' &&
                                        !block.validated && (
                                          <Pressable
                                            onPress={() =>
                                              handleSwap(
                                                block.id,
                                                exercise.id
                                              )
                                            }
                                            disabled={
                                              Boolean(
                                                swappingExerciseId
                                              )
                                            }
                                            hitSlop={
                                              8
                                            }
                                            style={({
                                              pressed,
                                            }) => [
                                              styles.swapButton,

                                              swappingExerciseId ===
                                                exercise.id &&
                                                styles.swapButtonLoading,

                                              pressed &&
                                                !swappingExerciseId &&
                                                styles.pressed,
                                            ]}
                                          >
                                            <Ionicons
                                              name={
                                                swappingExerciseId ===
                                                exercise.id
                                                  ? 'hourglass-outline'
                                                  : 'swap-horizontal-outline'
                                              }
                                              size={
                                                20
                                              }
                                              color={
                                                colors.primaryLight
                                              }
                                            />
                                          </Pressable>
                                        )}

                                      <Pressable
                                        onPress={() =>
                                          toggleExerciseDetails(
                                            exercise.id
                                          )
                                        }
                                        hitSlop={
                                          8
                                        }
                                      >
                                        <Ionicons
                                          name={
                                            detailsExpanded
                                              ? 'chevron-up'
                                              : 'chevron-down'
                                          }
                                          size={
                                            17
                                          }
                                          color={
                                            colors.textMuted
                                          }
                                        />
                                      </Pressable>
                                    </View>

                                    {/* DÉTAIL */}
                                    {detailsExpanded && (
                                      <View
                                        style={
                                          styles.exerciseDetails
                                        }
                                      >
                                        <View
                                          style={
                                            styles.exerciseImagePlaceholder
                                          }
                                        >
                                          <Ionicons
                                            name="image-outline"
                                            size={
                                              28
                                            }
                                            color={
                                              colors.textMuted
                                            }
                                          />

                                          <Text
                                            style={
                                              styles.imagePlaceholderText
                                            }
                                          >
                                            VISUEL
                                            EXERCICE
                                          </Text>
                                        </View>

                                        <Text
                                          style={
                                            styles.exerciseDescription
                                          }
                                        >
                                          {
                                            exercise.description
                                          }
                                        </Text>

                                        <View
                                          style={
                                            styles.tipRow
                                          }
                                        >
                                          <Ionicons
                                            name="information-circle-outline"
                                            size={
                                              18
                                            }
                                            color={
                                              colors.primaryLight
                                            }
                                          />

                                          <Text
                                            style={
                                              styles.tipText
                                            }
                                          >
                                            {
                                              exercise.tip
                                            }
                                          </Text>
                                        </View>
                                      </View>
                                    )}
                                    </View>
                                  </View>
                                );
                              }
                            )}

                            {!block.validated && (
                              <Text
                                style={
                                  styles.statusHint
                                }
                              >
                                Appuie
                                sur le
                                cercle :
                                ✕ non
                                réalisé
                                · ✓
                                réalisé
                              </Text>
                            )}

                            <Pressable
                              onPress={() =>
                                validateBlock(
                                  block.id
                                )
                              }
                              disabled={
                                !canValidate ||
                                block.validated
                              }
                              style={({
                                pressed,
                              }) => [
                                styles.validateButton,

                                block.validated &&
                                  styles.validateButtonDone,

                                !canValidate &&
                                  !block.validated &&
                                  styles.validateButtonDisabled,

                                pressed &&
                                  canValidate &&
                                  !block.validated &&
                                  styles.validateButtonPressed,
                              ]}
                            >
                              {block.validated ? (
                                <>
                                  <Ionicons
                                    name="checkmark-circle"
                                    size={
                                      20
                                    }
                                    color={
                                      colors.primaryLight
                                    }
                                  />

                                  <Text
                                    style={
                                      styles.validateButtonDoneText
                                    }
                                  >
                                    BLOC
                                    VALIDÉ
                                  </Text>
                                </>
                              ) : (
                                <Text
                                  style={[
                                    styles.validateButtonText,

                                    !canValidate &&
                                      styles.validateButtonTextDisabled,
                                  ]}
                                >
                                  {block.id ===
                                    'warmup' &&
                                    'VALIDER LE WARM-UP'}

                                  {block.id ===
                                    'tabata' &&
                                    'VALIDER LE TABATA'}

                                  {block.id ===
                                    'skill' &&
                                    'VALIDER LE SKILL'}

                                  {block.id ===
                                    'wod' &&
                                    'TERMINER LA SÉANCE'}
                                </Text>
                              )}
                            </Pressable>
                          </View>
                        )}
                    </View>
                  );
                }
              )}
            </View>

            <View
              style={
                styles.bottomSpace
              }
            />
          </ScrollView>
        </SafeAreaView>
      </ImageBackground>
    </View>
  );
}

function BlockStatus({
  validated,
  locked,
}) {
  if (locked) {
    return (
      <View
        style={
          styles.blockStatusLocked
        }
      >
        <Ionicons
          name="lock-closed"
          size={13}
          color={
            colors.textMuted
          }
        />
      </View>
    );
  }

  if (validated) {
    return (
      <View
        style={
          styles.blockStatusValidated
        }
      >
        <Ionicons
          name="checkmark"
          size={17}
          color={
            colors.brandWhite
          }
        />
      </View>
    );
  }

  return (
    <View
      style={
        styles.blockStatusPending
      }
    />
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor:
      colors.background,
  },

  background: {
    flex: 1,
  },

  safeArea: {
    flex: 1,
  },

  darkOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor:
      'rgba(0,0,0,0.30)',
  },

  content: {
    paddingHorizontal:
      spacing.xl,
    paddingTop: spacing.sm,
  },

  /* HEADER */

  header: {
    minHeight: 74,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },

  backButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor:
      'rgba(17,21,26,0.90)',
    borderWidth: 1,
    borderColor:
      'rgba(255,255,255,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  headerText: {
    flex: 1,
  },

  headerEyebrow: {
    fontFamily:
      'Oswald_600SemiBold',
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 1,
    color:
      colors.textSecondary,
  },

  headerTitle: {
    ...typography.display,
    fontSize: 31,
    lineHeight: 34,
    letterSpacing: 1.6,
    color:
      colors.textPrimary,
  },

  brandIcon: {
    width: 45,
    height: 45,
  },

  blueDot: {
    color: colors.primary,
  },

  /* RÉSUMÉ */

  summaryCard: {
    marginTop: 10,
    borderRadius: 17,
    padding: 16,
    backgroundColor:
      'rgba(17,21,26,0.90)',
    borderWidth: 1,
    borderColor:
      'rgba(255,255,255,0.09)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent:
      'space-between',
  },

  summaryLabel: {
    fontFamily:
      'Oswald_600SemiBold',
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 0.8,
    color:
      colors.textSecondary,
  },

  summaryDuration: {
    fontFamily:
      'BebasNeue_400Regular',
    fontSize: 31,
    lineHeight: 34,
    letterSpacing: 1.2,
    color:
      colors.textPrimary,
    marginTop: 2,
  },

  summaryRight: {
    alignItems:
      'flex-end',
  },

  tricolor: {
    width: 75,
    height: 4,
    flexDirection: 'row',
    borderRadius: 999,
    overflow: 'hidden',
    marginTop: 10,
  },

  tricolorBlue: {
    flex: 1,
    backgroundColor:
      colors.primary,
  },

  tricolorWhite: {
    flex: 1,
    backgroundColor:
      colors.brandWhite,
  },

  tricolorRed: {
    flex: 1,
    backgroundColor:
      colors.brandRed,
  },

  /* BLOCS */

  blocks: {
    marginTop:
      spacing.xl,
    gap: 14,
  },

  block: {
    borderRadius: 18,
    backgroundColor:
      'rgba(17,21,26,0.92)',
    borderWidth: 1,
    borderColor:
      'rgba(255,255,255,0.09)',
    overflow: 'hidden',
  },

  blockValidated: {
    borderColor:
      'rgba(8,104,255,0.55)',
    backgroundColor:
      'rgba(12,20,31,0.94)',
  },

  blockLocked: {
    opacity: 0.66,
  },

  blockHeader: {
    minHeight: 82,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },

  blockHeaderText: {
    flex: 1,
  },

  blockTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },

  blockTitle: {
    fontFamily:
      'BebasNeue_400Regular',
    fontSize: 24,
    lineHeight: 27,
    letterSpacing: 1.3,
    color:
      colors.textPrimary,
  },

  blockTitleLocked: {
    color:
      colors.textMuted,
  },

  blockDuration: {
    fontFamily:
      'Oswald_600SemiBold',
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 0.6,
    color:
      colors.textSecondary,
  },

  blockStructure: {
    fontFamily:
      'Oswald_500Medium',
    fontSize: 11,
    lineHeight: 15,
    letterSpacing: 0.4,
    color:
      colors.primaryLight,
    marginTop: 3,
  },

  blockLockedText: {
    fontFamily:
      'Oswald_500Medium',
    fontSize: 9,
    lineHeight: 13,
    letterSpacing: 0.4,
    color:
      colors.textMuted,
    marginTop: 3,
  },

  blockStatusPending: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor:
      colors.border,
  },

  blockStatusValidated: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor:
      colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },

  blockStatusLocked: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderColor:
      colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },

  blockContent: {
    borderTopWidth: 1,
    borderTopColor:
      'rgba(255,255,255,0.06)',
    paddingHorizontal: 16,
    paddingBottom: 16,
  },

  structureBanner: {
    marginTop: 14,
    marginBottom: 4,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 11,
    backgroundColor:
      'rgba(7,9,12,0.72)',
    borderWidth: 1,
    borderColor:
      'rgba(255,255,255,0.05)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent:
      'space-between',
  },

  structureBannerLabel: {
    fontFamily:
      'Oswald_600SemiBold',
    fontSize: 9,
    letterSpacing: 0.7,
    color:
      colors.textMuted,
  },

  structureBannerValue: {
    fontFamily:
      'Oswald_700Bold',
    fontSize: 11,
    letterSpacing: 0.6,
    color:
      colors.textPrimary,
  },

  /* TABATA */

  tabataGroupHeader: {
    marginTop: 16,
    marginBottom: 2,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor:
      'rgba(8,104,255,0.10)',
    borderWidth: 1,
    borderColor:
      'rgba(8,104,255,0.24)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent:
      'space-between',
  },

  tabataGroupTitle: {
    fontFamily:
      'BebasNeue_400Regular',
    fontSize: 17,
    lineHeight: 20,
    letterSpacing: 1,
    color:
      colors.primaryLight,
  },

  tabataGroupMeta: {
    fontFamily:
      'Oswald_500Medium',
    fontSize: 9,
    lineHeight: 13,
    letterSpacing: 0.4,
    color:
      colors.textSecondary,
  },

  tabataPosition: {
    fontFamily:
      'Oswald_600SemiBold',
    fontSize: 9,
    lineHeight: 12,
    letterSpacing: 0.7,
    color:
      colors.primaryLight,
    marginBottom: 1,
  },

  /* EXERCICES */

  exerciseWrapper: {
    paddingVertical: 14,
  },

  exerciseBorder: {
    borderBottomWidth: 1,
    borderBottomColor:
      'rgba(255,255,255,0.05)',
  },

  exerciseRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },

  exerciseStatus: {
    width: 27,
    height: 27,
    borderRadius: 14,
    borderWidth: 2,
    borderColor:
      colors.border,
    backgroundColor:
      'rgba(7,9,12,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  exerciseStatusSkipped: {
    backgroundColor:
      colors.brandRed,
    borderColor:
      colors.brandRed,
  },

  exerciseStatusCompleted: {
    backgroundColor:
      colors.primary,
    borderColor:
      colors.primary,
  },

  exerciseMain: {
    flex: 1,
  },

  exerciseName: {
    fontFamily:
      'Oswald_700Bold',
    fontSize: 14,
    lineHeight: 18,
    letterSpacing: 0.3,
    color:
      colors.textPrimary,
  },

  exercisePrescription: {
    fontFamily:
      'Oswald_400Regular',
    fontSize: 12,
    lineHeight: 17,
    color:
      colors.textSecondary,
    marginTop: 2,
  },

  swapButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor:
      'rgba(8,104,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  swapButtonLoading: {
    opacity: 0.55,
  },

  swapErrorCard: {
    minHeight: 54,
    marginTop: 14,
    borderRadius: 13,
    padding: 12,
    backgroundColor:
      'rgba(255,59,59,0.08)',
    borderWidth: 1,
    borderColor:
      'rgba(255,59,59,0.24)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },

  swapErrorText: {
    flex: 1,
    fontFamily:
      'Oswald_400Regular',
    fontSize: 12,
    lineHeight: 18,
    color:
      colors.textSecondary,
  },

  exerciseDetails: {
    marginTop: 12,
    marginLeft: 38,
  },

  exerciseImagePlaceholder: {
    height: 120,
    borderRadius: 13,
    backgroundColor:
      'rgba(7,9,12,0.78)',
    borderWidth: 1,
    borderColor:
      'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },

  imagePlaceholderText: {
    fontFamily:
      'Oswald_600SemiBold',
    fontSize: 9,
    letterSpacing: 0.8,
    color:
      colors.textMuted,
  },

  exerciseDescription: {
    fontFamily:
      'Oswald_400Regular',
    fontSize: 13,
    lineHeight: 19,
    color:
      colors.textSecondary,
    marginTop: 11,
  },

  tipRow: {
    marginTop: 9,
    flexDirection: 'row',
    alignItems:
      'flex-start',
    gap: 7,
  },

  tipText: {
    flex: 1,
    fontFamily:
      'Oswald_500Medium',
    fontSize: 12,
    lineHeight: 17,
    color:
      colors.textPrimary,
  },

  statusHint: {
    fontFamily:
      'Oswald_400Regular',
    fontSize: 10,
    lineHeight: 15,
    color:
      colors.textMuted,
    textAlign: 'center',
    marginTop: 6,
    marginBottom: 12,
  },

  /* VALIDATION */

  validateButton: {
    minHeight: 50,
    borderRadius: 12,
    backgroundColor:
      colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },

  validateButtonDisabled: {
    backgroundColor:
      'rgba(38,43,50,0.92)',
  },

  validateButtonDone: {
    backgroundColor:
      'rgba(8,104,255,0.10)',
    borderWidth: 1,
    borderColor:
      'rgba(8,104,255,0.35)',
  },

  validateButtonPressed: {
    backgroundColor:
      colors.primaryDark,
    transform: [
      {
        scale: 0.99,
      },
    ],
  },

  validateButtonText: {
    fontFamily:
      'BebasNeue_400Regular',
    fontSize: 18,
    lineHeight: 21,
    letterSpacing: 1,
    color:
      colors.brandWhite,
  },

  validateButtonTextDisabled: {
    color:
      colors.textMuted,
  },

  validateButtonDoneText: {
    fontFamily:
      'Oswald_700Bold',
    fontSize: 11,
    lineHeight: 15,
    letterSpacing: 0.7,
    color:
      colors.primaryLight,
  },

  bottomSpace: {
    height: 48,
  },

  pressed: {
    opacity: 0.65,
  },
});