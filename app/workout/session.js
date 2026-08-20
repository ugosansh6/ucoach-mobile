import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Image,
  ImageBackground,
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  Vibration,
  View,
  useWindowDimensions,
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
  changeWorkoutFormat,
  getWorkoutFormatOptions,
  getWorkoutSwapAvailability,
  markWorkoutSessionStarted,
  markWorkoutWodRevealed,
  markWorkoutWodStarted,
  reloadWorkoutSession,
  swapWorkoutExercise,
} from '../../src/services/workoutService';

import { adaptSessionExercise } from '../../src/services/sessionAdaptationService';

import WodProtocolPlayer from '../../src/components/workout/WodProtocolPlayer';

const brandIcon = require('../../assets/branding/ugerod-icon.png');
const workoutBackground = require('../../assets/backgrounds/welcome-default.jpg');

const BLOCK_ORDER = [
  'unlock',
  'tabata',
  'warmup',
  'skill',
  'wod',
];

const BLOCK_LABELS = {
  unlock: 'UNLOCK',
  tabata: 'TABATA',
  warmup: 'WARM-UP',
  skill: 'SKILL',
  wod: 'WOD',
};

const FALLBACK_EXERCISES = [
  {
    id: 'shoulder-cars',
    exerciseId: 'shoulder-cars',
    sessionExerciseId: null,
    block: 'unlock',
    blockKey: 'unlock',
    name: 'Shoulder CARs',
    prescription: '45 sec / côté',
    status: 'pending',
    trackingType: 'time',
    trackingModes: ['time'],
    instructions:
      'Réalise de grands cercles contrôlés de l’épaule sans chercher la fatigue.',
    tips:
      'Reste lent et cherche surtout l’amplitude disponible.',
  },
  {
    id: 'air-squat',
    exerciseId: 'air-squat',
    sessionExerciseId: null,
    block: 'warmup',
    blockKey: 'warmup',
    name: 'Air Squat',
    prescription: '2 × 12',
    status: 'pending',
    trackingType: 'bodyweight',
    trackingModes: ['reps'],
    instructions:
      'Descends les hanches en gardant le buste droit et les pieds bien ancrés au sol.',
    tips:
      'Genoux dans l’axe des pieds.',
  },
  {
    id: 'shoulder-tap',
    exerciseId: 'shoulder-tap',
    sessionExerciseId: null,
    block: 'tabata',
    blockKey: 'tabata',
    name: 'Shoulder Tap',
    prescription: '20 sec / 10 sec',
    status: 'pending',
    trackingType: 'time',
    trackingModes: ['time'],
    instructions:
      'En planche haute, touche alternativement chaque épaule avec la main opposée.',
    tips:
      'Garde le bassin stable.',
  },
  {
    id: 'goblet-squat',
    exerciseId: 'goblet-squat',
    sessionExerciseId: null,
    block: 'skill',
    blockKey: 'skill',
    name: 'Goblet Squat',
    prescription: '4 × 8',
    status: 'pending',
    trackingType: 'load',
    trackingModes: ['reps', 'load'],
    instructions:
      'Tiens la charge devant la poitrine et réalise un squat contrôlé.',
    tips:
      'Reste solide sur le tronc.',
  },
  {
    id: 'burpee',
    exerciseId: 'burpee',
    sessionExerciseId: null,
    block: 'wod',
    blockKey: 'wod',
    name: 'Burpee',
    prescription: '8 reps',
    status: 'pending',
    trackingType: 'bodyweight',
    trackingModes: ['reps'],
    instructions:
      'Descends au sol puis reviens debout avec une extension complète.',
    tips:
      'Trouve un rythme régulier.',
  },
];

function formatExerciseDetailText(value) {
  if (typeof value !== 'string') {
    return value ?? '';
  }

  return value
    .replace(/\\r\\n|\\n|\\r/g, '\n')
    .replace(/\r\n?/g, '\n')
    .replace(/(^|\n)\s*(\d+)[.)-]?\s+/g, (_, prefix, number) =>
      prefix + number + '. '
    )
    .replace(/\n{3,}/g, '\n\n')
    .trim();
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
              block.key ??
              block.id
          ) === blockId
      ) ?? null
    );
  }

  if (blockId === 'warmup') {
    return (
      blockData.warmup ??
      blockData.warm_up ??
      null
    );
  }

  return blockData[blockId] ?? null;
}

function readBlockDuration(
  block,
  fallback = 0
) {
  const numeric = Number(
    block?.duration ??
      block?.duration_minutes
  );

  return Number.isFinite(numeric)
    ? numeric
    : fallback;
}

function readBlockStructure(block) {
  return (
    block?.structure ??
    block?.mechanicLabel ??
    ''
  );
}

function firstFiniteNumber(...values) {
  for (const value of values) {
    const numeric = Number(value);

    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }

  return null;
}

function formatCompactNumber(value) {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return null;
  }

  return Number.isInteger(numeric)
    ? String(numeric)
    : String(
        Math.round(numeric * 10) / 10
      );
}

function getExercisePrescription(exercise) {
  const value =
    exercise?.prescriptionJson ??
    exercise?.prescription_json ??
    (exercise?.prescription &&
    typeof exercise.prescription === 'object'
      ? exercise.prescription
      : null);

  return value && typeof value === 'object'
    ? value
    : {};
}

function formatExerciseCount(count) {
  const safeCount = Math.max(
    1,
    Number(count) || 1
  );

  return `${safeCount} exercice${safeCount > 1 ? 's' : ''}`;
}

function buildPreWodBlockStructure({
  blockId,
  source,
  blockExercises,
  durationMinutes,
}) {
  const exerciseCount =
    blockExercises.length;
  const prescription =
    getExercisePrescription(
      blockExercises[0]
    );
  const protocol =
    prescription?.protocol &&
    typeof prescription.protocol === 'object'
      ? prescription.protocol
      : {};

  if (blockId === 'tabata') {
    const rounds = firstFiniteNumber(
      source?.rounds,
      protocol.rounds,
      8
    );
    const workSeconds =
      firstFiniteNumber(
        source?.workSeconds,
        source?.work_seconds,
        protocol.work_seconds
      );
    const restSeconds =
      firstFiniteNumber(
        source?.restSeconds,
        source?.rest_seconds,
        protocol.rest_seconds
      );

    if (
      rounds != null &&
      workSeconds != null &&
      restSeconds != null
    ) {
      return `${formatCompactNumber(rounds)} séries · ${formatCompactNumber(workSeconds)}s travail / ${formatCompactNumber(restSeconds)}s repos`;
    }
  }

  if (blockId === 'skill') {
    const contract =
      source?.skillContract ??
      source?.skill_contract ??
      {};
    const patch =
      contract?.prescription_patch &&
      typeof contract.prescription_patch ===
        'object'
        ? contract.prescription_patch
        : {};

    const sets = firstFiniteNumber(
      contract?.sets,
      patch?.sets,
      prescription?.sets
    );
    const restSeconds =
      firstFiniteNumber(
        contract?.restSeconds,
        contract?.rest_seconds,
        patch?.rest_between_sets_seconds,
        prescription?.rest_between_sets_seconds
      );
    const workSeconds =
      firstFiniteNumber(
        patch?.execution_target_duration_seconds,
        prescription?.execution_target_duration_seconds
      );
    const targetReps =
      firstFiniteNumber(
        patch?.execution_target_reps,
        prescription?.execution_target_reps
      );
    const repsMin = firstFiniteNumber(
      prescription?.reps_min
    );
    const repsMax = firstFiniteNumber(
      prescription?.reps_max
    );

    const seriesLabel = sets != null
      ? `${formatCompactNumber(sets)} séries`
      : '1 série';

    if (workSeconds != null) {
      const workLabel =
        `${formatCompactNumber(workSeconds)}s travail`;

      return restSeconds != null
        ? `${seriesLabel} · ${workLabel} / ${formatCompactNumber(restSeconds)}s repos`
        : `${seriesLabel} · ${workLabel}`;
    }

    let repsLabel = null;

    if (targetReps != null) {
      repsLabel = `${formatCompactNumber(targetReps)} reps`;
    } else if (
      repsMin != null ||
      repsMax != null
    ) {
      const min = formatCompactNumber(
        repsMin ?? repsMax
      );
      const max = formatCompactNumber(
        repsMax ?? repsMin
      );

      repsLabel = min === max
        ? `${min} reps`
        : `${min}–${max} reps`;
    }

    if (repsLabel) {
      return restSeconds != null
        ? `${seriesLabel} · ${repsLabel} · ${formatCompactNumber(restSeconds)}s repos`
        : `${seriesLabel} · ${repsLabel}`;
    }

    return seriesLabel;
  }

  if (blockId === 'warmup') {
    const rounds = firstFiniteNumber(
      source?.warmupRounds,
      source?.warmup_rounds,
      prescription?.warmup_rounds,
      3
    );

    return `${formatCompactNumber(rounds ?? 3)} tours · ${formatExerciseCount(exerciseCount)}`;
  }

  if (blockId === 'unlock') {
    const safeCount = Math.max(
      1,
      exerciseCount
    );

    const allocatedDurations =
      blockExercises
        .map((exercise) =>
          firstFiniteNumber(
            getExercisePrescription(exercise)
              ?.allocated_duration_seconds,
            exercise?.expectedOutcome
              ?.allocated_duration_seconds
          )
        )
        .filter(
          (value) => value != null
        );

    const totalSeconds =
      Math.max(
        0,
        Number(durationMinutes) || 0
      ) * 60;
    const secondsPerExercise =
      allocatedDurations.length ===
      safeCount
        ? Math.round(
            allocatedDurations.reduce(
              (sum, value) =>
                sum + value,
              0
            ) / safeCount
          )
        : totalSeconds > 0
          ? Math.round(
              totalSeconds / safeCount
            )
          : null;

    const parts = [
      '1 série',
      formatExerciseCount(safeCount),
    ];

    if (secondsPerExercise != null) {
      parts.push(
        `${formatCompactNumber(secondsPerExercise)}s / exercice`
      );
    }

    return parts.join(' · ');
  }

  return readBlockStructure(source);
}

function buildBlocks(
  workout,
  exercises
) {
  const isFallback =
    !workout.exercises?.length;

  const fallbackDurations = {
    unlock: 3,
    tabata: 4,
    warmup: 5,
    skill: 10,
    wod: 15,
  };

  return BLOCK_ORDER.map(
    (blockId) => {
      const source =
        getWorkoutBlock(
          workout,
          blockId
        );

      const blockExercises =
        exercises.filter(
          (exercise) =>
            normalizeBlockId(
              exercise.blockKey ??
                exercise.block
            ) === blockId
        );

      const duration =
        readBlockDuration(
          source,
          isFallback
            ? fallbackDurations[
                blockId
              ]
            : 0
        );

      const structure =
        buildPreWodBlockStructure({
          blockId,
          source,
          blockExercises,
          durationMinutes: duration,
        });

      return {
        id: blockId,
        source,
        title:
          BLOCK_LABELS[
            blockId
          ] ??
          source?.title ??
          source?.block_name ??
          blockId,
        durationMinutes:
          duration,
        duration:
          `${duration} MIN`,
        structure:
          structure ||
          (blockId === 'wod'
            ? workout.format ??
              'FORMAT UGEROD'
            : ''),
        objective:
          source?.objective ??
          null,
        skillContract:
          source?.skillContract ??
          source?.skill_contract ??
          null,
        mechanic:
          source?.mechanic ??
          null,
        mechanicLabel:
          source?.mechanicLabel ??
          (blockId === 'wod'
            ? workout.format
            : null),
        exercises:
          blockExercises.map(
            (
              exercise,
              index
            ) => ({
              ...exercise,
              _uiKey:
                exercise.sessionExerciseId ??
                `${blockId}-${exercise.id}-${index}`,
              tabataPosition:
                blockId === 'tabata'
                  ? index % 2 === 0
                    ? 'A'
                    : 'B'
                  : null,
            })
          ),
      };
    }
  ).filter(
    (block) =>
      block.exercises.length > 0 &&
      block.durationMinutes > 0
  );
}

function sameExerciseInstance(
  candidate,
  target
) {
  if (
    candidate?.sessionExerciseId &&
    target?.sessionExerciseId
  ) {
    return (
      candidate.sessionExerciseId ===
      target.sessionExerciseId
    );
  }

  return (
    candidate?.id === target?.id &&
    normalizeBlockId(
      candidate?.blockKey ??
        candidate?.block
    ) ===
      normalizeBlockId(
        target?.blockKey ??
          target?.block
      )
  );
}

function sortFormatOptions(options) {
  return [...options].sort(
    (a, b) => {
      const rank = (item) => {
        if (item.current) {
          return 0;
        }

        if (
          item.compatible &&
          !item.locked
        ) {
          return 1;
        }

        if (
          item.compatible &&
          item.locked
        ) {
          return 2;
        }

        return 3;
      };

      const rankDiff =
        rank(a) - rank(b);

      if (rankDiff !== 0) {
        return rankDiff;
      }

      return String(
        a.display_name ??
          a.option_id ??
          ''
      ).localeCompare(
        String(
          b.display_name ??
            b.option_id ??
            ''
        ),
        'fr'
      );
    }
  );
}

function formatOptionState(option) {
  if (option.current) {
    return {
      label: 'CHOIX ACTUEL',
      icon: 'checkmark-circle',
      tone: 'current',
    };
  }

  if (!option.compatible) {
    return {
      label:
        'NON ADAPTÉ À CETTE SÉANCE',
      icon: 'ban-outline',
      tone: 'incompatible',
    };
  }

  if (option.locked) {
    return {
      label: 'PREMIUM',
      icon: 'lock-closed',
      tone: 'locked',
    };
  }

  return {
    label: null,
    icon: 'checkmark',
    tone: 'available',
  };
}

export default function WorkoutSessionScreen() {
  const {
    workout,
    updateWorkout,
    setExerciseLoad,
  } = useWorkout();

  const [
    devExercises,
    setDevExercises,
  ] = useState(
    FALLBACK_EXERCISES
  );

  const sourceExercises =
    workout.exercises?.length > 0
      ? workout.exercises
      : devExercises;

  const blockDefinitions =
    useMemo(
      () =>
        buildBlocks(
          workout,
          sourceExercises
        ),
      [workout, sourceExercises]
    );

  const [
    validatedBlocks,
    setValidatedBlocks,
  ] = useState(
    Array.isArray(
      workout.validatedBlocks
    )
      ? workout.validatedBlocks
      : []
  );

  const [
    expandedBlocks,
    setExpandedBlocks,
  ] = useState(() => {
    const first =
      blockDefinitions[0]?.id;

    return first
      ? { [first]: true }
      : {};
  });

  const [
    expandedExercises,
    setExpandedExercises,
  ] = useState({});

  const [
    activeExerciseIndexes,
    setActiveExerciseIndexes,
  ] = useState({});

  const [
    statusModalExercise,
    setStatusModalExercise,
  ] = useState(null);

  const [
    skillTestModal,
    setSkillTestModal,
  ] = useState(null);

  const [
    swappingExerciseKey,
    setSwappingExerciseKey,
  ] = useState(null);

  const [swapError, setSwapError] =
    useState('');

  const [
    swapAvailability,
    setSwapAvailability,
  ] = useState({});

  const [
    swapAvailabilityLoading,
    setSwapAvailabilityLoading,
  ] = useState(false);

  const [
    swapActionExercise,
    setSwapActionExercise,
  ] = useState(null);

  const [
    swapSeenExerciseIds,
    setSwapSeenExerciseIds,
  ] = useState({});

  const [
    formatModalVisible,
    setFormatModalVisible,
  ] = useState(false);

  const [
    formatLoading,
    setFormatLoading,
  ] = useState(false);

  const [
    formatChanging,
    setFormatChanging,
  ] = useState(null);

  const [
    formatError,
    setFormatError,
  ] = useState('');

  const [
    formatOptions,
    setFormatOptions,
  ] = useState([]);

  const [
    subscriptionTier,
    setSubscriptionTier,
  ] = useState('FREE');

  const [
    wodRevealed,
    setWodRevealed,
  ] = useState(
    Boolean(
      workout.wodRevealed ||
        workout.wodRevealedAt
    )
  );

  const [
    formatChangeCount,
    setFormatChangeCount,
  ] = useState(
    Number(workout.formatChangeCount ?? 0)
  );

  const [
    formatChangeLimit,
    setFormatChangeLimit,
  ] = useState(
    Number(workout.formatChangeLimit ?? 3)
  );

  const [
    formatLocked,
    setFormatLocked,
  ] = useState(
    Boolean(
      workout.formatLocked ||
        workout.wodStarted ||
        workout.wodStartedAt ||
        workout.wodRuntime?.started
    )
  );

  const remainingFormatChanges =
    Math.max(
      0,
      formatChangeLimit -
        formatChangeCount
    );

  useEffect(() => {
    setWodRevealed(
      Boolean(
        workout.wodRevealed ||
          workout.wodRevealedAt
      )
    );
    setFormatChangeCount(
      Number(
        workout.formatChangeCount ?? 0
      )
    );
    setFormatChangeLimit(
      Number(
        workout.formatChangeLimit ?? 3
      )
    );
    setFormatLocked(
      Boolean(
        workout.formatLocked ||
          workout.wodStarted ||
          workout.wodStartedAt ||
          workout.wodRuntime?.started
      )
    );
  }, [
    workout.sessionId,
    workout.wodRevealed,
    workout.wodRevealedAt,
    workout.wodStarted,
    workout.wodStartedAt,
    workout.wodRuntime?.started,
    workout.formatChangeCount,
    workout.formatChangeLimit,
    workout.formatLocked,
  ]);

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

  const completedBlockCount =
    blocks.filter(
      (block) => block.validated
    ).length;

  const activeBlock =
    blocks.find(
      (block) => !block.validated
    ) ?? null;

  const activeBlockNumber =
    activeBlock
      ? blocks.findIndex(
          (block) =>
            block.id === activeBlock.id
        ) + 1
      : blocks.length;

  const sessionProgress =
    blocks.length > 0
      ? completedBlockCount /
        blocks.length
      : 0;

  const previousBlockIds =
    blocks
      .filter(
        (block) =>
          block.id !== 'wod'
      )
      .map((block) => block.id);

  const wodUnlocked =
    previousBlockIds.every(
      (blockId) =>
        validatedBlocks.includes(
          blockId
        )
    );

  const plannedDuration =
    workout.plannedDuration ?? 45;

  const workoutFormat =
    workout.format ??
    getWorkoutBlock(
      workout,
      'wod'
    )?.mechanicLabel ??
    'FORMAT UGEROD';

  const swapAvailabilityFingerprint =
    useMemo(
      () =>
        sourceExercises
          .filter(
            (exercise) =>
              exercise.sessionExerciseId
          )
          .map(
            (exercise) =>
              `${exercise.sessionExerciseId}:${exercise.id}`
          )
          .join('|'),
      [sourceExercises]
    );

  const refreshSwapAvailability =
    useCallback(async () => {
      if (!workout.sessionId) {
        setSwapAvailability({});
        return;
      }

      setSwapAvailabilityLoading(true);

      try {
        const result =
          await getWorkoutSwapAvailability(
            workout.sessionId
          );

        setSwapAvailability(
          result?.items ?? {}
        );
      } catch (error) {
        console.warn(
          'Swap availability',
          error
        );
        setSwapAvailability({});
      } finally {
        setSwapAvailabilityLoading(false);
      }
    }, [workout.sessionId]);

  useEffect(() => {
    refreshSwapAvailability();
  }, [
    refreshSwapAvailability,
    swapAvailabilityFingerprint,
  ]);

  function moveActiveExercise(
    blockId,
    direction
  ) {
    const block = blocks.find(
      (item) => item.id === blockId
    );

    if (!block?.exercises?.length) {
      return;
    }

    setActiveExerciseIndexes(
      (current) => {
        const currentIndex =
          Math.min(
            current[blockId] ?? 0,
            block.exercises.length - 1
          );

        const nextIndex = Math.max(
          0,
          Math.min(
            block.exercises.length - 1,
            currentIndex + direction
          )
        );

        return {
          ...current,
          [blockId]: nextIndex,
        };
      }
    );
  }
const sessionStartedRef = useRef(false);
  const sessionStartPromiseRef = useRef(null);
  const wodRuntimeStartedRef = useRef(false);

  useEffect(() => {
    sessionStartedRef.current =
      Boolean(workout.sessionStarted);
    sessionStartPromiseRef.current = null;
    wodRuntimeStartedRef.current =
      Boolean(
        workout.wodRuntime?.started
      );
  }, [
    workout.sessionId,
    workout.sessionStarted,
    workout.wodRuntime?.started,
  ]);

  const ensureSessionStarted =
    useCallback(() => {
      if (!workout.sessionId) {
        return Promise.resolve({
          status: 'NO_SESSION',
        });
      }

      if (
        sessionStartPromiseRef.current
      ) {
        return sessionStartPromiseRef.current;
      }

      if (sessionStartedRef.current) {
        return Promise.resolve({
          status: 'IN_PROGRESS',
        });
      }

      sessionStartedRef.current = true;

      updateWorkout({
        sessionStarted: true,
        status: 'in_progress',
        startedAt:
          workout.startedAt ??
          new Date().toISOString(),
      });

      const request =
        markWorkoutSessionStarted({
          sessionId: workout.sessionId,
        })
          .then((result) => {
            if (
              result?.status ===
                'STALE_SESSION_REQUIRES_RECHECKIN'
            ) {
              router.replace(
                '/workout/preparation'
              );
              return result;
            }

            if (
              result?.status ===
              'IN_PROGRESS'
            ) {
              updateWorkout({
                sessionStarted: true,
                status: 'in_progress',
                startedLocalDate:
                  result
                    ?.started_local_date ??
                  null,
              });
            }

            return result;
          })
          .catch((error) => {
            sessionStartedRef.current = false;
            updateWorkout({
              sessionStarted: false,
              status: 'generated',
            });
            console.warn(
              'Session start marker',
              error
            );
            throw error;
          })
          .finally(() => {
            sessionStartPromiseRef.current =
              null;
          });

      sessionStartPromiseRef.current =
        request;

      return request;
    }, [
      updateWorkout,
      workout.sessionId,
      workout.startedAt,
    ]);

  async function handleBack() {
    if (
      sessionStartPromiseRef.current
    ) {
      try {
        await sessionStartPromiseRef.current;
      } catch {
        // Le retour vers le check-in reste possible.
      }
    }

    router.replace('/workout/preparation');
  }

  function replaceExercise(
    target,
    values
  ) {
    if (!workout.exercises?.length) {
      setDevExercises(
        (current) =>
          current.map((exercise) =>
            sameExerciseInstance(
              exercise,
              target
            )
              ? {
                  ...exercise,
                  ...values,
                }
              : exercise
          )
      );
      return;
    }

    updateWorkout({
      exercises:
        workout.exercises.map(
          (exercise) =>
            sameExerciseInstance(
              exercise,
              target
            )
              ? {
                  ...exercise,
                  ...values,
                }
              : exercise
        ),
    });
  }

  function toggleBlock(blockId) {
    if (
      blockId === 'wod' &&
      (!wodUnlocked ||
        !wodRevealed)
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
    exercise
  ) {
    const key = exercise._uiKey;

    setExpandedExercises(
      (current) => ({
        ...current,
        [key]: !current[key],
      })
    );
  }

  function openExerciseStatus(
    blockId,
    exercise
  ) {
    if (
      validatedBlocks.includes(
        blockId
      )
    ) {
      return;
    }

    setStatusModalExercise({
      blockId,
      exercise,
    });
  }

  function closeExerciseStatus() {
    setStatusModalExercise(null);
  }

  function selectExerciseStatus(status) {
    const exercise =
      statusModalExercise?.exercise;

    if (!exercise) {
      return;
    }

    ensureSessionStarted();

    replaceExercise(exercise, {
      status,
    });

    setStatusModalExercise(null);
  }

  function openSwapActions(
    blockId,
    exercise
  ) {
    if (
      swappingExerciseKey ||
      validatedBlocks.includes(
        blockId
      ) ||
      !workout.sessionId ||
      !exercise.sessionExerciseId
    ) {
      return;
    }

    setSwapError('');
    setSwapActionExercise({
      blockId,
      exercise,
    });
  }

  function closeSwapActions() {
    if (swappingExerciseKey) {
      return;
    }

    setSwapActionExercise(null);
  }

  async function handleSwap(
    blockId,
    exercise,
    {
      reason = 'equivalent',
      undo = false,
    } = {}
  ) {
    const instanceId =
      exercise?.sessionExerciseId;

    const swapState =
      instanceId
        ? swapAvailability?.[
            instanceId
          ]
        : null;

    const directionByReason = {
      too_easy: 'harder',
      too_hard: 'easier',
      environment: 'equivalent',
      equipment: 'equivalent',
      equivalent: 'equivalent',
    };

    const direction =
      directionByReason[reason] ??
      'equivalent';

    const directionAvailable =
      undo
        ? swapState?.can_undo === true
        : reason === 'environment' ||
            reason === 'equipment'
          ? true
          : swapState?.directions?.[
              direction
            ]?.available === true;

    if (
      swappingExerciseKey ||
      validatedBlocks.includes(
        blockId
      ) ||
      !workout.sessionId ||
      !instanceId ||
      !directionAvailable
    ) {
      return;
    }

    setSwapError('');
    setSwappingExerciseKey(
      exercise._uiKey
    );

    try {
      const excludedExerciseIds =
        undo
          ? []
          : swapSeenExerciseIds[
              instanceId
            ] ?? [];

      if (undo) {
        await swapWorkoutExercise({
          sessionId:
            workout.sessionId,
          sessionExerciseId:
            instanceId,
          currentExerciseId:
            exercise.exerciseId ??
            exercise.id,
          direction: 'equivalent',
          undo: true,
          excludedExerciseIds: [],
        });
      } else {
        await adaptSessionExercise({
          sessionId:
            workout.sessionId,
          sessionExerciseId:
            instanceId,
          currentExerciseId:
            exercise.exerciseId ??
            exercise.id,
          reason,
          excludedExerciseIds,
        });
      }

      const previousByInstance =
        new Map(
          sourceExercises
            .filter(
              (item) =>
                item.sessionExerciseId
            )
            .map((item) => [
              item.sessionExerciseId,
              item,
            ])
        );

      const refreshed =
        await reloadWorkoutSession({
          sessionId:
            workout.sessionId,
          preparationSnapshot:
            workout.preparationSnapshot,
        });

      const availabilityAfter =
        await getWorkoutSwapAvailability(
          workout.sessionId
        );

      const stillAdaptedAfterUndo =
        undo
          ? availabilityAfter?.items?.[
              instanceId
            ]?.can_undo === true
          : true;

      setSwapAvailability(
        availabilityAfter?.items ?? {}
      );

      updateWorkout({
        ...refreshed,
        exercises:
          refreshed.exercises.map(
            (item) => {
              if (
                item.sessionExerciseId ===
                instanceId
              ) {
                return {
                  ...item,
                  status:
                    undo &&
                    !stillAdaptedAfterUndo
                      ? 'pending'
                      : 'adapted',
                  adaptationSource:
                    undo &&
                    !stillAdaptedAfterUndo
                      ? null
                      : undo
                        ? 'swap-undo'
                        : reason,
                };
              }

              const previous =
                previousByInstance.get(
                  item.sessionExerciseId
                );

              return previous
                ? {
                    ...item,
                    status:
                      previous.status,
                    adaptationSource:
                      previous.adaptationSource ??
                      null,
                  }
                : item;
            }
          ),
        validatedBlocks,
      });

      setSwapSeenExerciseIds(
        (current) => {
          if (undo) {
            return {
              ...current,
              [instanceId]: [],
            };
          }

          const seen = new Set(
            current[instanceId] ?? []
          );

          const currentExerciseId =
            exercise.exerciseId ??
            exercise.id;

          if (currentExerciseId) {
            seen.add(
              currentExerciseId
            );
          }

          return {
            ...current,
            [instanceId]: [
              ...seen,
            ],
          };
        }
      );

      setExpandedExercises(
        (current) => {
          const next = {
            ...current,
          };

          delete next[
            exercise._uiKey
          ];

          return next;
        }
      );

      setSwapActionExercise(null);
    } catch (error) {
      setSwapError(
        error?.message ??
          'Impossible de changer cet exercice.'
      );
    } finally {
      setSwappingExerciseKey(null);
    }
  }

  function toggleBlockExerciseSelection(
    blockId
  ) {
    if (
      validatedBlocks.includes(
        blockId
      )
    ) {
      return;
    }

    const blockExercises =
      sourceExercises.filter(
        (exercise) =>
          normalizeBlockId(
            exercise.blockKey ??
              exercise.block
          ) === blockId
      );

    if (blockExercises.length === 0) {
      return;
    }

    ensureSessionStarted();

    const hasPending =
      blockExercises.some(
        (exercise) =>
          exercise.status ===
          'pending'
      );

    const nextExercises =
      sourceExercises.map(
        (exercise) => {
          const sameBlock =
            normalizeBlockId(
              exercise.blockKey ??
                exercise.block
            ) === blockId;

          if (!sameBlock) {
            return exercise;
          }

          if (hasPending) {
            return exercise.status ===
              'pending'
              ? {
                  ...exercise,
                  status: 'completed',
                }
              : exercise;
          }

          return exercise.status ===
            'completed'
            ? {
                ...exercise,
                status: 'pending',
              }
            : exercise;
        }
      );

    if (workout.exercises?.length) {
      updateWorkout({
        exercises: nextExercises,
      });
    } else {
      setDevExercises(
        nextExercises
      );
    }

    setExpandedBlocks(
      (current) => ({
        ...current,
        [blockId]: true,
      })
    );
  }

  function canValidateBlock(block) {
    return Boolean(
      block?.exercises?.length
    );
  }

  function validateBlock(
    blockId,
    options = {}
  ) {
    const block = blocks.find(
      (item) => item.id === blockId
    );

    if (!block) {
      return;
    }

    const skillContract =
      block.skillContract ??
      block.source?.skillContract ??
      block.source?.skill_contract ??
      null;

    if (
      blockId === 'skill' &&
      skillContract?.scoreRequired ===
        true &&
      !options.skipSkillTestPrompt
    ) {
      const exercise =
        block.exercises?.[0] ??
        null;

      if (exercise) {
        ensureSessionStarted();

        setSkillTestModal({
          blockId,
          exercise,
          contract:
            skillContract,
        });
        return;
      }
    }

    ensureSessionStarted();

    const finalizedExercises =
      sourceExercises.map(
        (exercise) => {
          const sameBlock =
            normalizeBlockId(
              exercise.blockKey ??
                exercise.block
            ) === blockId;

          let nextExercise =
            exercise;

          if (
            sameBlock &&
            options.skillTestActual &&
            sameExerciseInstance(
              exercise,
              options.skillTestActual
                .exercise
            )
          ) {
            nextExercise = {
              ...nextExercise,
              ...options.skillTestActual
                .exerciseValues,
              performanceActualJson: {
                ...(nextExercise
                  .performanceActualJson ??
                  {}),
                skill_test_contract:
                  'skill-contract-v2',
                skill_objective_type:
                  'TEST',
                skill_test_metric:
                  options.skillTestActual
                    .metric,
                skill_test_score:
                  options.skillTestActual
                    .score,
                skill_test_unit:
                  options.skillTestActual
                    .unit ??
                  null,
              },
            };
          }

          if (
            sameBlock &&
            nextExercise.status ===
              'pending'
          ) {
            return {
              ...nextExercise,
              status: 'completed',
            };
          }

          return nextExercise;
        }
      );

    if (
      !workout.exercises?.length
    ) {
      setDevExercises(
        finalizedExercises
      );
    }

    if (blockId === 'wod') {
      const allValidated = [
        ...validatedBlocks,
        'wod',
      ];

      setValidatedBlocks(
        allValidated
      );

      if (
        workout.exercises?.length
      ) {
        updateWorkout({
          exercises:
            finalizedExercises,
          status:
            'awaiting_completion',
          validatedBlocks:
            allValidated,
        });
      }

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

    if (
      workout.exercises?.length
    ) {
      updateWorkout({
        exercises:
          finalizedExercises,
        validatedBlocks:
          nextValidated,
      });
    }

    const currentIndex =
      blocks.findIndex(
        (item) =>
          item.id === blockId
      );

    const nextBlock =
      blocks[currentIndex + 1];

    if (nextBlock) {
      setExpandedBlocks(
        (current) => ({
          ...current,
          [blockId]: false,
          [nextBlock.id]:
            nextBlock.id === 'wod'
              ? false
              : true,
        })
      );
    }
  }

  function closeSkillTestModal() {
    setSkillTestModal(null);
  }

  function saveSkillTestScore(rawValue) {
    const modal =
      skillTestModal;

    if (!modal?.exercise) {
      return;
    }

    const normalized =
      String(rawValue ?? '')
        .trim()
        .replace(',', '.');

    const numeric =
      Number(normalized);

    if (
      !Number.isFinite(numeric) ||
      numeric <= 0
    ) {
      return;
    }

    const metric =
      modal.contract?.scoreMetric ??
      modal.contract?.score_metric ??
      'score';

    const unit =
      modal.contract?.scoreUnit ??
      modal.contract?.score_unit ??
      null;

    const score =
      metric === 'max_reps'
        ? Math.max(
            1,
            Math.round(numeric)
          )
        : Math.round(
            numeric * 10
          ) / 10;

    const exerciseValues = {};

    if (metric === 'max_reps') {
      exerciseValues.repsCompleted =
        score;
    }

    if (
      metric ===
      'max_duration_seconds'
    ) {
      exerciseValues.durationSeconds =
        score;
    }

    if (
      metric ===
      'max_distance_meters'
    ) {
      exerciseValues.distanceMeters =
        score;
    }

    if (metric === 'load_kg') {
      setExerciseLoad(
        modal.exercise
          .sessionExerciseId ??
          modal.exercise.id,
        `${score} kg`
      );
    }

    setSkillTestModal(null);

    validateBlock(
      modal.blockId,
      {
        skipSkillTestPrompt: true,
        skillTestActual: {
          exercise:
            modal.exercise,
          exerciseValues,
          metric,
          score,
          unit,
        },
      }
    );
  }

  async function revealWod() {
    if (
      !wodUnlocked ||
      wodRevealed
    ) {
      return;
    }

    setSwapError('');

    try {
      const result =
        workout.sessionId
          ? await markWorkoutWodRevealed({
              sessionId:
                workout.sessionId,
            })
          : null;
      const nextCount =
        Number(
          result?.format_change_count ??
            formatChangeCount
        );
      const nextLimit =
        Number(
          result?.format_change_limit ??
            formatChangeLimit
        );
      const nextLocked =
        Boolean(
          result?.format_locked ??
            nextCount >= nextLimit
        );

      setWodRevealed(true);
      setFormatChangeCount(nextCount);
      setFormatChangeLimit(nextLimit);
      setFormatLocked(nextLocked);
      setExpandedBlocks(
        (current) => ({
          ...current,
          wod: true,
        })
      );
      updateWorkout({
        wodRevealed: true,
        wodRevealedAt:
          result?.wod_revealed_at ??
          workout.wodRevealedAt ??
          null,
        formatChangeCount: nextCount,
        formatChangeLimit: nextLimit,
        remainingFormatChanges:
          Math.max(
            0,
            nextLimit - nextCount
          ),
        formatLocked: nextLocked,
      });
    } catch (error) {
      setSwapError(
        error?.message ??
          'Impossible de révéler le WOD.'
      );
    }
  }

  const handleWodStartRequest =
    useCallback(async () => {
      if (!workout.sessionId) {
        setFormatLocked(true);
        ensureSessionStarted();
        return;
      }

      const result =
        await markWorkoutWodStarted({
          sessionId:
            workout.sessionId,
        });

      if (
        result?.status &&
        result.status !== 'WOD_STARTED'
      ) {
        throw new Error(
          'Le WOD ne peut pas être démarré dans cet état.'
        );
      }

      wodRuntimeStartedRef.current = true;
      setFormatLocked(true);
      ensureSessionStarted();
      updateWorkout({
        wodStarted: true,
        wodStartedAt:
          result?.wod_started_at ??
          new Date().toISOString(),
        wodRevealed: true,
        wodRevealedAt:
          result?.wod_revealed_at ??
          workout.wodRevealedAt ??
          null,
        formatChangeCount:
          Number(
            result?.format_change_count ??
              formatChangeCount
          ),
        formatChangeLimit:
          Number(
            result?.format_change_limit ??
              formatChangeLimit
          ),
        remainingFormatChanges: 0,
        formatLocked: true,
      });
    }, [
      ensureSessionStarted,
      formatChangeCount,
      formatChangeLimit,
      updateWorkout,
      workout.sessionId,
      workout.wodRevealedAt,
    ]);

  const handleWodRuntimeChange =
    useCallback(
      (runtime) => {
        if (
          runtime?.started &&
          !wodRuntimeStartedRef.current
        ) {
          wodRuntimeStartedRef.current = true;
          setFormatLocked(true);
          ensureSessionStarted();

          if (workout.sessionId) {
            markWorkoutWodStarted({
              sessionId:
                workout.sessionId,
            })
              .then((result) => {
                updateWorkout({
                  wodStarted: true,
                  wodStartedAt:
                    result?.wod_started_at ??
                    null,
                  formatLocked: true,
                  remainingFormatChanges: 0,
                });
              })
              .catch((error) => {
                console.warn(
                  'WOD start marker fallback',
                  error
                );
              });
          }
        }

        updateWorkout({
          wodRuntime: runtime,
        });
      },
      [
        ensureSessionStarted,
        updateWorkout,
        workout.sessionId,
      ]
    );

  async function openFormatModal() {
    if (
      !workout.sessionId ||
      formatLocked ||
      workout.wodRuntime?.started
    ) {
      return;
    }

    setFormatModalVisible(true);
    setFormatLoading(true);
    setFormatError('');

    try {
      const result =
        await getWorkoutFormatOptions(
          workout.sessionId
        );

      setSubscriptionTier(
        result.subscriptionTier
      );
      setFormatChangeCount(
        Number(
          result.formatChangeCount ?? 0
        )
      );
      setFormatChangeLimit(
        Number(
          result.formatChangeLimit ?? 3
        )
      );
      setFormatLocked(
        Boolean(result.formatLocked)
      );

      if (result.formatLocked) {
        setFormatModalVisible(false);
        return;
      }

      setFormatOptions(
        sortFormatOptions(
          result.options
        )
      );
    } catch (error) {
      setFormatError(
        error?.message ??
          'Impossible de charger les formats.'
      );
    } finally {
      setFormatLoading(false);
    }
  }

  function closeFormatModal() {
    if (formatChanging) {
      return;
    }

    setFormatModalVisible(false);
    setFormatError('');
  }

  async function handleFormatSelect(
    option
  ) {
    if (
      !option?.selectable ||
      option.current ||
      formatChanging ||
      formatLocked ||
      workout.wodRuntime?.started
    ) {
      return;
    }

    setFormatChanging(
      option.option_id
    );
    setFormatError('');

    try {
      const wasRevealed =
        wodRevealed;
      const changeResult =
        await changeWorkoutFormat({
          sessionId:
            workout.sessionId,
          mechanic:
            option.mechanic,
          variantKey:
            option.variant_key ??
            null,
        });

      const refreshed =
        await reloadWorkoutSession({
          sessionId:
            workout.sessionId,
          preparationSnapshot:
            workout.preparationSnapshot,
        });

      const previousByInstance =
        new Map(
          (workout.exercises ?? [])
            .filter(
              (exercise) =>
                exercise.sessionExerciseId
            )
            .map((exercise) => [
              exercise.sessionExerciseId,
              exercise,
            ])
        );
      const nextCount =
        Number(
          changeResult?.format_change_count ??
            refreshed.formatChangeCount ??
            formatChangeCount
        );
      const nextLimit =
        Number(
          changeResult?.format_change_limit ??
            refreshed.formatChangeLimit ??
            formatChangeLimit
        );
      const nextLocked =
        Boolean(
          changeResult?.format_locked ??
            refreshed.formatLocked ??
            nextCount >= nextLimit
        );

      updateWorkout({
        ...refreshed,
        exercises:
          refreshed.exercises.map(
            (exercise) => {
              const previous =
                previousByInstance.get(
                  exercise.sessionExerciseId
                );
              const blockId =
                normalizeBlockId(
                  exercise.blockKey ??
                    exercise.block
                );

              if (
                previous &&
                blockId !== 'wod'
              ) {
                return {
                  ...exercise,
                  status:
                    previous.status,
                  adaptationSource:
                    previous.adaptationSource ??
                    null,
                };
              }

              if (
                previous &&
                blockId === 'wod' &&
                previous.id === exercise.id &&
                previous.status === 'adapted'
              ) {
                return {
                  ...exercise,
                  status: 'adapted',
                  adaptationSource:
                    previous.adaptationSource ??
                    'swap',
                };
              }

              return exercise;
            }
          ),
        validatedBlocks,
        wodRevealed: wasRevealed,
        wodRuntime: null,
        formatChangeCount: nextCount,
        formatChangeLimit: nextLimit,
        remainingFormatChanges:
          Math.max(
            0,
            nextLimit - nextCount
          ),
        formatLocked: nextLocked,
      });

      setWodRevealed(wasRevealed);
      setFormatChangeCount(nextCount);
      setFormatChangeLimit(nextLimit);
      setFormatLocked(nextLocked);

      if (wasRevealed) {
        setExpandedBlocks(
          (current) => ({
            ...current,
            wod: true,
          })
        );
      }

      await refreshSwapAvailability();
      setFormatModalVisible(false);
      setFormatOptions([]);
    } catch (error) {
      setFormatError(
        error?.message ??
          'Impossible de changer le format.'
      );
    } finally {
      setFormatChanging(null);
    }
  }

  return (
    <View style={styles.screen}>
      <ImageBackground
        source={workoutBackground}
        style={styles.background}
        resizeMode="cover"
      >
        <View
          style={styles.darkOverlay}
        />

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

        <SafeAreaView
          style={styles.safeArea}
        >
          <ScrollView
            contentContainerStyle={
              styles.content
            }
            showsVerticalScrollIndicator={
              false
            }
          >
            <View style={styles.header}>
              <Pressable
                onPress={handleBack}
                hitSlop={12}
                style={({ pressed }) => [
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
                style={styles.headerText}
              >
                <Text
                  style={styles.headerTitle}
                >
                  TA SÉANCE
                  <Text
                    style={styles.blueDot}
                  >
                    .
                  </Text>
                </Text>
              </View>

              <Image
                source={brandIcon}
                style={styles.brandIcon}
                resizeMode="contain"
              />
            </View>

            <View
              style={styles.summaryCard}
            >
              <View style={styles.summaryTopRow}>
                <View>
                  <Text
                    style={styles.summaryLabel}
                  >
                    DURÉE PRÉVUE
                  </Text>
                  <Text
                    style={styles.summaryDuration}
                  >
                    {plannedDuration} MIN
                  </Text>
                </View>

                <View
                  style={styles.summaryRight}
                >
                  <Text
                    style={styles.summaryLabel}
                  >
                    PROGRESSION
                  </Text>

                  <Text
                    style={styles.summaryBlockCounter}
                  >
                    {blocks.length > 0
                      ? `BLOC ${activeBlockNumber} / ${blocks.length}`
                      : '—'}
                  </Text>
                </View>
              </View>

              <View style={styles.sessionProgressTrack}>
                <View
                  style={[
                    styles.sessionProgressFill,
                    {
                      width: `${Math.round(
                        sessionProgress * 100
                      )}%`,
                    },
                  ]}
                />
              </View>

              <View style={styles.summaryBottomRow}>
                <Text
                  style={styles.summaryCurrentBlock}
                >
                  {activeBlock
                    ? `EN COURS · ${activeBlock.title}`
                    : 'SÉANCE TERMINÉE'}
                </Text>
              </View>
            </View>

            {swapError ? (
              <View
                style={styles.errorCard}
              >
                <Ionicons
                  name="alert-circle-outline"
                  size={19}
                  color={colors.brandRed}
                />
                <Text
                  style={styles.errorText}
                >
                  {swapError}
                </Text>
              </View>
            ) : null}

            <View style={styles.blocks}>
              {blocks.map((block) => {
                const isWod =
                  block.id === 'wod';

                const locked =
                  isWod &&
                  !wodUnlocked;

                const concealed =
                  isWod &&
                  wodUnlocked &&
                  !wodRevealed;

                const expanded =
                  expandedBlocks[
                    block.id
                  ];

                const wodPlayerInProgress =
                  isWod &&
                  Boolean(
                    workout.wodRuntime?.started
                  ) &&
                  !workout.wodRuntime?.finished;

                const canValidate =
                  canValidateBlock(block) &&
                  !wodPlayerInProgress;

                return (
                  <View
                    key={block.id}
                    style={[
                      styles.block,
                      block.validated &&
                        styles.blockValidated,
                      (locked || concealed) &&
                        styles.blockLocked,
                    ]}
                  >
                    <Pressable
                      onPress={() =>
                        toggleBlock(
                          block.id
                        )
                      }
                      style={styles.blockHeader}
                    >
                      <BlockStatus
                        validated={
                          block.validated
                        }
                        locked={locked}
                        selected={
                          block.exercises.length > 0 &&
                          block.exercises.every(
                            (exercise) =>
                              exercise.status !==
                              'pending'
                          )
                        }
                        onPress={
                          block.id !== 'wod' &&
                          !block.validated &&
                          !locked &&
                          !concealed &&
                          canValidate
                            ? () =>
                                toggleBlockExerciseSelection(
                                  block.id
                                )
                            : null
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
                              (locked || concealed) &&
                                styles.blockTitleLocked,
                            ]}
                          >
                            {block.title}
                          </Text>

                          <Text
                            style={styles.blockDuration}
                          >
                            {block.duration}
                          </Text>
                        </View>

                        {!locked &&
                          !concealed &&
                          block.structure ? (
                          <Text
                            style={styles.blockStructure}
                          >
                            {block.structure}
                          </Text>
                        ) : null}

                        {locked ? (
                          <Text
                            style={styles.blockLockedText}
                          >
                            LE CONTENU DU WOD RESTE CACHÉ JUSQU’À LA FIN DES BLOCS PRÉCÉDENTS
                          </Text>
                        ) : null}
                      </View>

                      <Ionicons
                        name={
                          locked
                            ? 'lock-closed-outline'
                            : concealed
                              ? 'eye-off-outline'
                              : expanded
                                ? 'chevron-up'
                                : 'chevron-down'
                        }
                        size={20}
                        color={
                          locked || concealed
                            ? colors.textMuted
                            : colors.textSecondary
                        }
                      />
                    </Pressable>

                    {locked || concealed ? (
                      <View
                        style={styles.secretWodContent}
                      >
                        <View
                          style={styles.formatPreview}
                        >
                          <View
                            style={styles.formatPreviewMain}
                          >
                            <Text
                              style={styles.formatPreviewLabel}
                            >
                              FORMAT DU WOD
                            </Text>

                            <Text
                              style={styles.formatPreviewValue}
                            >
                              {String(
                                workoutFormat
                              ).toUpperCase()}
                            </Text>

                            <Text
                              style={styles.formatPreviewHint}
                            >
                              Choisi par UGEROD
                            </Text>
                          </View>

                          {workout.sessionId ? (
                            <Pressable
                              onPress={
                                openFormatModal
                              }
                              style={({ pressed }) => [
                                styles.modifyFormatButton,
                                pressed &&
                                  styles.pressed,
                              ]}
                            >
                              <Ionicons
                                name="options-outline"
                                size={16}
                                color={
                                  colors.primaryLight
                                }
                              />
                              <Text
                                style={styles.modifyFormatText}
                              >
                                MODIFIER
                              </Text>
                            </Pressable>
                          ) : null}
                        </View>

                        <View
                          style={styles.secretMessage}
                        >
                          <Ionicons
                            name={
                              locked
                                ? 'lock-closed-outline'
                                : 'eye-off-outline'
                            }
                            size={19}
                            color={colors.textMuted}
                          />
                          <Text
                            style={styles.secretMessageText}
                          >
                            {locked
                              ? 'Termine les blocs précédents pour accéder au WOD.'
                              : 'Ton WOD est prêt. Le contenu reste secret jusqu’à ce que tu choisisses de le découvrir.'}
                          </Text>
                        </View>

                        {concealed ? (
                          <Pressable
                            onPress={revealWod}
                            style={({ pressed }) => [
                              styles.discoverWodButton,
                              pressed &&
                                styles.validateButtonPressed,
                            ]}
                          >
                            <Ionicons
                              name="eye-outline"
                              size={19}
                              color={colors.brandWhite}
                            />
                            <Text
                              style={styles.discoverWodText}
                            >
                              DÉCOUVRIR LE WOD
                            </Text>
                          </Pressable>
                        ) : null}
                      </View>
                    ) : null}

                    {expanded &&
                    !locked &&
                    !concealed ? (
                      <View
                        style={styles.blockContent}
                      >
                        {block.objective ? (
                          <View
                            style={styles.objectiveBanner}
                          >
                            <Text
                              style={styles.objectiveLabel}
                            >
                              OBJECTIF
                            </Text>
                            <Text
                              style={styles.objectiveText}
                            >
                              {block.objective}
                            </Text>

                            {block.skillContract
                              ?.scoreRequired ? (
                              <Text
                                style={
                                  styles.skillScoreHint
                                }
                              >
                                SCORE À ENREGISTRER · {String(
                                  block.skillContract
                                    .scoreLabel ??
                                    block.skillContract
                                      .score_label ??
                                    'SCORE'
                                ).toUpperCase()}
                              </Text>
                            ) : null}
                          </View>
                        ) : null}

                        {block.id === 'wod' ? (
                          <>
                            <View
                              style={[
                                styles.formatPreview,
                                {
                                  marginTop: 12,
                                  marginBottom: 12,
                                },
                              ]}
                            >
                              <View
                                style={styles.formatPreviewMain}
                              >
                                <Text
                                  style={styles.formatPreviewLabel}
                                >
                                  FORMAT DU WOD
                                </Text>
                                <Text
                                  style={styles.formatPreviewValue}
                                >
                                  {String(
                                    workoutFormat
                                  ).toUpperCase()}
                                </Text>
                                <Text
                                  style={styles.formatPreviewHint}
                                >
                                  {workout.wodRuntime?.started ||
                                  workout.wodStarted ||
                                  workout.wodStartedAt
                                    ? 'Format verrouillé après démarrage'
                                    : remainingFormatChanges <= 0
                                      ? 'Limite de ' + formatChangeLimit + ' changements atteinte'
                                      : remainingFormatChanges + ' changement' + (remainingFormatChanges > 1 ? 's' : '') + ' restant' + (remainingFormatChanges > 1 ? 's' : '')}
                                </Text>
                              </View>

                              {workout.sessionId ? (
                                <Pressable
                                  onPress={openFormatModal}
                                  disabled={
                                    formatLocked ||
                                    workout.wodRuntime?.started ||
                                    remainingFormatChanges <= 0
                                  }
                                  style={({ pressed }) => [
                                    styles.modifyFormatButton,
                                    (formatLocked ||
                                      workout.wodRuntime?.started ||
                                      remainingFormatChanges <= 0) &&
                                      { opacity: 0.38 },
                                    pressed &&
                                      !formatLocked &&
                                      !workout.wodRuntime?.started &&
                                      remainingFormatChanges > 0 &&
                                      styles.pressed,
                                  ]}
                                >
                                  <Ionicons
                                    name={
                                      formatLocked ||
                                      workout.wodRuntime?.started ||
                                      remainingFormatChanges <= 0
                                        ? 'lock-closed-outline'
                                        : 'options-outline'
                                    }
                                    size={16}
                                    color={
                                      formatLocked ||
                                      workout.wodRuntime?.started ||
                                      remainingFormatChanges <= 0
                                        ? colors.textMuted
                                        : colors.primaryLight
                                    }
                                  />
                                  <Text
                                    style={styles.modifyFormatText}
                                  >
                                    {formatLocked ||
                                    workout.wodRuntime?.started ||
                                    remainingFormatChanges <= 0
                                      ? 'VERROUILLÉ'
                                      : 'MODIFIER'}
                                  </Text>
                                </Pressable>
                              ) : null}
                            </View>

                            <WodProtocolPlayer
                            key={`${
                              workout.sessionId ?? 'dev'
                            }-${
                              workout.mechanic ?? workout.format ?? 'wod'
                            }`}
                            block={block}
                            initialRuntime={
                              workout.wodRuntime ?? null
                            }
                            onBeforeStart={
                              handleWodStartRequest
                            }
                            onRuntimeChange={
                              handleWodRuntimeChange
                            }
                          />
                          </>
                        ) : null}

                        {block.id === 'tabata' ? (
                          <TabataTimer
                            block={block}
                          />
                        ) : null}

                        {(block.id === 'unlock' ||
                          block.id === 'warmup' ||
                          block.id === 'skill') &&
                        block.exercises.length > 0 ? (
                          <CurrentExerciseCard
                            block={block}
                            activeIndex={Math.min(
                              activeExerciseIndexes[
                                block.id
                              ] ?? 0,
                              block.exercises.length - 1
                            )}
                            onPrevious={() =>
                              moveActiveExercise(
                                block.id,
                                -1
                              )
                            }
                            onNext={() =>
                              moveActiveExercise(
                                block.id,
                                1
                              )
                            }
                          />
                        ) : null}

                        {block.exercises.map(
                          (
                            exercise,
                            index
                          ) => {
                            const detailsExpanded =
                              expandedExercises[
                                exercise._uiKey
                              ];

                            const swapping =
                              swappingExerciseKey ===
                              exercise._uiKey;

                            const swapState =
                              exercise.sessionExerciseId
                                ? swapAvailability[
                                    exercise.sessionExerciseId
                                  ]
                                : null;

                            const swapAvailable =
                              Boolean(
                                exercise.sessionExerciseId
                              );

                            const swapDisabled =
                              Boolean(
                                swappingExerciseKey
                              ) ||
                              swapAvailabilityLoading ||
                              !swapAvailable;

                            return (
                              <View
                                key={exercise._uiKey}
                                style={[
                                  styles.exerciseWrapper,
                                  index <
                                    block.exercises.length -
                                      1 &&
                                    styles.exerciseBorder,
                                ]}
                              >
                                <View
                                  style={styles.exerciseRow}
                                >
                                  <Pressable
                                    onPress={() =>
                                      openExerciseStatus(
                                        block.id,
                                        exercise
                                      )
                                    }
                                    disabled={
                                      block.validated
                                    }
                                    style={[
                                      styles.exerciseStatus,
                                      (exercise.status ===
                                        'not_completed' ||
                                        exercise.status ===
                                          'skipped') &&
                                        styles.exerciseStatusSkipped,
                                      exercise.status ===
                                        'adapted' &&
                                        styles.exerciseStatusAdapted,
                                      exercise.status ===
                                        'completed' &&
                                        styles.exerciseStatusCompleted,
                                    ]}
                                  >
                                    {(exercise.status ===
                                      'not_completed' ||
                                      exercise.status ===
                                        'skipped') ? (
                                      <Ionicons
                                        name="close"
                                        size={16}
                                        color={
                                          colors.brandWhite
                                        }
                                      />
                                    ) : null}

                                    {exercise.status ===
                                    'adapted' ? (
                                      <Text
                                        style={styles.adaptedStatusSymbol}
                                      >
                                        ≈
                                      </Text>
                                    ) : null}

                                    {exercise.status ===
                                    'completed' ? (
                                      <Ionicons
                                        name="checkmark"
                                        size={16}
                                        color={
                                          colors.brandWhite
                                        }
                                      />
                                    ) : null}
                                  </Pressable>

                                  <Pressable
                                    onPress={() =>
                                      toggleExerciseDetails(
                                        exercise
                                      )
                                    }
                                    style={styles.exerciseMain}
                                  >

                                    <Text
                                      style={styles.exerciseName}
                                    >
                                      {String(
                                        exercise.name ??
                                          'Exercice'
                                      ).toUpperCase()}
                                    </Text>

                                    <Text
                                      style={styles.exercisePrescription}
                                    >
                                      {exercise.prescription}
                                    </Text>
                                  </Pressable>

                                  {(exercise.status ===
                                    'pending' ||
                                    exercise.status ===
                                      'adapted') &&
                                  !block.validated &&
                                  workout.sessionId ? (
                                    <Pressable
                                      onPress={() =>
                                        openSwapActions(
                                          block.id,
                                          exercise
                                        )
                                      }
                                      disabled={
                                        swapDisabled
                                      }
                                      hitSlop={8}
                                      style={[
                                        styles.swapButton,
                                        swapping &&
                                          styles.swapButtonLoading,
                                        (!swapAvailable ||
                                          swapAvailabilityLoading) &&
                                          { opacity: 0.28 },
                                      ]}
                                    >
                                      {swapping ? (
                                        <ActivityIndicator
                                          size="small"
                                          color={
                                            colors.primaryLight
                                          }
                                        />
                                      ) : (
                                        <Ionicons
                                          name="swap-horizontal-outline"
                                          size={20}
                                          color={
                                            swapAvailable &&
                                            !swapAvailabilityLoading
                                              ? colors.primaryLight
                                              : colors.textMuted
                                          }
                                        />
                                      )}
                                    </Pressable>
                                  ) : null}

                                  <Pressable
                                    onPress={() =>
                                      toggleExerciseDetails(
                                        exercise
                                      )
                                    }
                                    hitSlop={8}
                                  >
                                    <Ionicons
                                      name={
                                        detailsExpanded
                                          ? 'chevron-up'
                                          : 'chevron-down'
                                      }
                                      size={17}
                                      color={colors.textMuted}
                                    />
                                  </Pressable>
                                </View>

                                {detailsExpanded ? (
                                  <View
                                    style={styles.exerciseDetails}
                                  >
                                    {exercise.imagePath &&
                                    /^https?:\/\//i.test(
                                      exercise.imagePath
                                    ) ? (
                                      <Image
                                        source={{
                                          uri: exercise.imagePath,
                                        }}
                                        style={styles.exerciseDetailImage}
                                        resizeMode="cover"
                                      />
                                    ) : null}

                                    {exercise.description ? (
                                      <View style={styles.exerciseDetailSection}>
                                        <Text style={styles.exerciseDetailLabel}>
                                          PRÉSENTATION
                                        </Text>
                                        <Text style={styles.exerciseDescription}>
                                          {formatExerciseDetailText(exercise.description)}
                                        </Text>
                                      </View>
                                    ) : null}

                                    {exercise.instructions ? (
                                      <View style={styles.exerciseDetailSection}>
                                        <Text style={styles.exerciseDetailLabel}>
                                          EXÉCUTION
                                        </Text>
                                        <Text style={styles.exerciseDescription}>
                                          {formatExerciseDetailText(exercise.instructions)}
                                        </Text>
                                      </View>
                                    ) : null}

                                    {!exercise.description &&
                                    !exercise.instructions ? (
                                      <Text style={styles.exerciseDescription}>
                                        Les consignes détaillées de ce mouvement ne sont pas encore renseignées.
                                      </Text>
                                    ) : null}

                                    {exercise.tips ? (
                                      <View
                                        style={styles.tipRow}
                                      >
                                        <Ionicons
                                          name="bulb-outline"
                                          size={18}
                                          color={
                                            colors.primaryLight
                                          }
                                        />
                                        <View style={styles.tipTextWrap}>
                                          <Text style={styles.exerciseDetailLabel}>
                                            CONSEIL UGEROD
                                          </Text>
                                          <Text
                                            style={styles.tipText}
                                          >
                                            {formatExerciseDetailText(exercise.tips)}
                                          </Text>
                                        </View>
                                      </View>
                                    ) : null}
                                  </View>
                                ) : null}
                              </View>
                            );
                          }
                        )}

                        {block.id === 'wod' &&
                        block.validated &&
                        workout.status !== 'completed' ? (
                          <Pressable
                            onPress={() =>
                              router.push(
                                '/workout/completion'
                              )
                            }
                            style={({ pressed }) => [
                              styles.validateButton,
                              pressed &&
                                styles.validateButtonPressed,
                            ]}
                          >
                            <Ionicons
                              name="arrow-forward-circle-outline"
                              size={20}
                              color={colors.brandWhite}
                            />
                            <Text
                              style={styles.validateButtonText}
                            >
                              RETOURNER À LA FIN DE SÉANCE
                            </Text>
                          </Pressable>
                        ) : (
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
                            style={({ pressed }) => [
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
                                  size={20}
                                  color={
                                    colors.primaryLight
                                  }
                                />
                                <Text
                                  style={styles.validateButtonDoneText}
                                >
                                  BLOC VALIDÉ
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
                                  'unlock' &&
                                  'TERMINER L’UNLOCK'}
                                {block.id ===
                                  'warmup' &&
                                  'TERMINER LE WARM-UP'}
                                {block.id ===
                                  'tabata' &&
                                  'TERMINER LE TABATA'}
                                {block.id ===
                                  'skill' &&
                                  'TERMINER LE SKILL'}
                                {block.id ===
                                  'wod' &&
                                  (wodPlayerInProgress
                                    ? 'TERMINE OU ARRÊTE LE WOD'
                                    : 'TERMINER LA SÉANCE')}
                              </Text>
                            )}
                          </Pressable>
                        )}
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </View>

            <View
              style={styles.bottomSpace}
            />
          </ScrollView>
        </SafeAreaView>
      </ImageBackground>

      <ExerciseStatusModal
        visible={Boolean(
          statusModalExercise
        )}
        exercise={
          statusModalExercise?.exercise ??
          null
        }
        onClose={
          closeExerciseStatus
        }
        onSelect={
          selectExerciseStatus
        }
      />

      <SwapDirectionModal
        visible={Boolean(
          swapActionExercise
        )}
        exercise={
          swapActionExercise?.exercise ??
          null
        }
        availability={
          swapActionExercise?.exercise
            ?.sessionExerciseId
            ? swapAvailability[
                swapActionExercise
                  .exercise
                  .sessionExerciseId
              ] ?? null
            : null
        }
        loading={Boolean(
          swappingExerciseKey
        )}
        error={swapError}
        onClose={
          closeSwapActions
        }
        onSelect={(
          reason,
          undo = false
        ) =>
          handleSwap(
            swapActionExercise
              ?.blockId,
            swapActionExercise
              ?.exercise,
            {
              reason,
              undo,
            }
          )
        }
      />

      <SkillTestModal
        visible={Boolean(
          skillTestModal
        )}
        exercise={
          skillTestModal?.exercise ??
          null
        }
        contract={
          skillTestModal?.contract ??
          null
        }
        onClose={
          closeSkillTestModal
        }
        onSave={
          saveSkillTestScore
        }
      />

      <FormatModal
        visible={formatModalVisible}
        onClose={closeFormatModal}
        loading={formatLoading}
        changing={formatChanging}
        error={formatError}
        options={formatOptions}
        subscriptionTier={
          subscriptionTier
        }
        onSelect={handleFormatSelect}
      />
    </View>
  );
}

function CurrentExerciseCard({
  block,
  activeIndex,
  onPrevious,
  onNext,
}) {
  const exercise =
    block.exercises[activeIndex];

  if (!exercise) {
    return null;
  }

  const isFirst =
    activeIndex === 0;
  const isLast =
    activeIndex ===
    block.exercises.length - 1;

  return (
    <View style={styles.currentExerciseCard}>
      <View style={styles.currentExerciseTopRow}>
        <Text style={styles.currentExerciseEyebrow}>
          EXERCICE {activeIndex + 1} / {block.exercises.length}
        </Text>
        <Text style={styles.currentExerciseBlockLabel}>
          {block.title}
        </Text>
      </View>

      <Text style={styles.currentExerciseName}>
        {String(
          exercise.name ?? 'Exercice'
        ).toUpperCase()}
      </Text>

      <Text style={styles.currentExercisePrescription}>
        {exercise.prescription ?? 'Prescription UGEROD'}
      </Text>

      {exercise.instructions ? (
        <Text style={styles.currentExerciseInstructions}>
          {formatExerciseDetailText(
            exercise.instructions
          )}
        </Text>
      ) : null}

      <View style={styles.currentExerciseActions}>
        <Pressable
          onPress={onPrevious}
          disabled={isFirst}
          style={[
            styles.currentExerciseNavButton,
            isFirst &&
              styles.currentExerciseNavButtonDisabled,
          ]}
        >
          <Ionicons
            name="chevron-back"
            size={18}
            color={
              isFirst
                ? colors.textMuted
                : colors.textPrimary
            }
          />
        </Pressable>

        <View style={styles.currentExerciseDots}>
          {block.exercises.map((item, index) => (
            <View
              key={item._uiKey}
              style={[
                styles.currentExerciseDot,
                index === activeIndex &&
                  styles.currentExerciseDotActive,
              ]}
            />
          ))}
        </View>

        <Pressable
          onPress={onNext}
          disabled={isLast}
          style={[
            styles.currentExerciseNavButton,
            isLast &&
              styles.currentExerciseNavButtonDisabled,
          ]}
        >
          <Ionicons
            name="chevron-forward"
            size={18}
            color={
              isLast
                ? colors.textMuted
                : colors.textPrimary
            }
          />
        </Pressable>
      </View>
    </View>
  );
}

function BlockStatus({
  validated,
  locked,
  selected,
  onPress,
}) {
  if (locked) {
    return (
      <View
        style={styles.exerciseStatus}
      >
        <Ionicons
          name="lock-closed"
          size={16}
          color={colors.textMuted}
        />
      </View>
    );
  }

  if (validated) {
    return (
      <View
        style={[
          styles.exerciseStatus,
          styles.exerciseStatusCompleted,
        ]}
      >
        <Ionicons
          name="checkmark"
          size={16}
          color={colors.brandWhite}
        />
      </View>
    );
  }

  if (onPress) {
    return (
      <Pressable
        onPress={(event) => {
          event?.stopPropagation?.();
          onPress();
        }}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel="Sélectionner ou désélectionner les exercices du bloc"
        style={({ pressed }) => [
          styles.exerciseStatus,
          selected &&
            styles.exerciseStatusCompleted,
          pressed &&
            styles.blockStatusPressed,
        ]}
      >
        {selected ? (
          <Ionicons
            name="checkmark"
            size={16}
            color={colors.brandWhite}
          />
        ) : null}
      </Pressable>
    );
  }

  return (
    <View style={styles.exerciseStatus} />
  );
}

function SkillTestModal({
  visible,
  exercise,
  contract,
  onClose,
  onSave,
}) {
  const [value, setValue] =
    useState('');

  useEffect(() => {
    if (visible) {
      setValue('');
    }
  }, [visible]);

  const metric =
    contract?.scoreMetric ??
    contract?.score_metric ??
    'score';

  const label =
    contract?.scoreLabel ??
    contract?.score_label ??
    'SCORE';

  const unit =
    contract?.scoreUnit ??
    contract?.score_unit ??
    '';

  const placeholder =
    metric === 'load_kg'
      ? 'Ex : 20'
      : metric === 'max_duration_seconds'
        ? 'Ex : 45'
        : metric === 'max_distance_meters'
          ? 'Ex : 25'
          : 'Ex : 8';

  const numeric =
    Number(
      String(value)
        .trim()
        .replace(',', '.')
    );

  const canSave =
    Number.isFinite(numeric) &&
    numeric > 0;

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={onClose}
    >
      <View
        style={
          styles.skillTestOverlay
        }
      >
        <Pressable
          style={
            styles.skillTestBackdrop
          }
          onPress={onClose}
        />

        <View
          style={
            styles.skillTestCard
          }
        >
          <Text
            style={
              styles.skillTestEyebrow
            }
          >
            TEST TERMINÉ
          </Text>

          <Text
            style={
              styles.skillTestTitle
            }
          >
            {String(
              exercise?.name ??
                'SKILL'
            ).toUpperCase()}
          </Text>

          <Text
            style={
              styles.skillTestPrompt
            }
          >
            SCORE À ENREGISTRER · {String(
              label
            ).toUpperCase()}
          </Text>

          <Text
            style={
              styles.skillTestHelper
            }
          >
            Entre ta meilleure performance propre.
          </Text>

          <View
            style={
              styles.skillTestInputWrap
            }
          >
            <TextInput
              value={value}
              onChangeText={setValue}
              placeholder={placeholder}
              placeholderTextColor={
                colors.textMuted
              }
              keyboardType="decimal-pad"
              autoFocus
              style={
                styles.skillTestInput
              }
              returnKeyType="done"
            />

            {unit ? (
              <Text
                style={
                  styles.skillTestUnit
                }
              >
                {unit}
              </Text>
            ) : null}
          </View>

          <View
            style={
              styles.skillTestActions
            }
          >
            <Pressable
              onPress={onClose}
              style={({ pressed }) => [
                styles.skillTestCancel,
                pressed &&
                  styles.pressed,
              ]}
            >
              <Text
                style={
                  styles.skillTestCancelText
                }
              >
                REVENIR AU SKILL
              </Text>
            </Pressable>

            <Pressable
              onPress={() =>
                onSave(value)
              }
              disabled={!canSave}
              style={({ pressed }) => [
                styles.skillTestSave,
                !canSave &&
                  styles.skillTestSaveDisabled,
                pressed &&
                  canSave &&
                  styles.validateButtonPressed,
              ]}
            >
              <Text
                style={
                  styles.skillTestSaveText
                }
              >
                ENREGISTRER LE SCORE
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function SwapDirectionModal({
  visible,
  exercise,
  availability,
  loading,
  error,
  onClose,
  onSelect,
}) {
  const directions =
    availability?.directions ?? {};

  const options = [
    {
      value: 'too_easy',
      label: 'TROP FACILE',
      description:
        'UGEROD cherche une progression plus exigeante.',
      icon: 'arrow-up-circle-outline',
      available:
        directions?.harder
          ?.available === true,
      unavailableText:
        'Aucune progression sûre disponible.',
    },
    {
      value: 'too_hard',
      label: 'TROP DIFFICILE',
      description:
        'UGEROD cherche une variante plus accessible.',
      icon: 'arrow-down-circle-outline',
      available:
        directions?.easier
          ?.available === true,
      unavailableText:
        'Aucune régression sûre disponible.',
    },
    {
      value: 'environment',
      label: 'IMPOSSIBLE ICI',
      description:
        'Mur, espace, hauteur ou autre contrainte du lieu.',
      icon: 'location-outline',
      available: true,
    },
    {
      value: 'equipment',
      label: 'MATÉRIEL INDISPONIBLE',
      description:
        'UGEROD cherche une alternative sans ce matériel.',
      icon: 'construct-outline',
      available: true,
    },
  ];

  const canUndo =
    availability?.can_undo === true;

  const undoLabel =
    availability?.undo_exercise_name
      ? `REVENIR À ${String(
          availability.undo_exercise_name
        ).toUpperCase()}`
      : 'REVENIR AU PRÉCÉDENT';

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.statusModalOverlay}>
        <Pressable
          style={styles.statusModalBackdrop}
          onPress={onClose}
        />

        <View style={styles.statusModalCard}>
          <View style={styles.statusModalHeader}>
            <View style={styles.statusModalTitleArea}>
              <Text style={styles.statusModalEyebrow}>
                COACH UGEROD
              </Text>
              <Text style={styles.statusModalTitle}>
                {String(
                  exercise?.name ??
                    'EXERCICE'
                ).toUpperCase()}
              </Text>
              <Text style={styles.statusModalSubtitle}>
                Pourquoi veux-tu changer ce mouvement ?
              </Text>
            </View>

            <Pressable
              onPress={onClose}
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
            <View
              style={[
                styles.statusOption,
                {
                  marginTop: 14,
                  borderColor:
                    'rgba(255,61,72,0.38)',
                  backgroundColor:
                    'rgba(255,61,72,0.08)',
                },
              ]}
            >
              <View
                style={[
                  styles.statusOptionIcon,
                  styles.statusOptionIconNotCompleted,
                ]}
              >
                <Ionicons
                  name="alert-circle-outline"
                  size={18}
                  color={colors.brandWhite}
                />
              </View>
              <View style={styles.statusOptionMain}>
                <Text style={styles.statusOptionDescription}>
                  {error}
                </Text>
              </View>
            </View>
          ) : null}

          <View style={styles.statusOptions}>
            {options.map((option) => {
              const disabled =
                loading ||
                !option.available;

              return (
                <Pressable
                  key={option.value}
                  onPress={() =>
                    onSelect(
                      option.value,
                      false
                    )
                  }
                  disabled={disabled}
                  style={({ pressed }) => [
                    styles.statusOption,
                    disabled &&
                      styles.swapDirectionOptionDisabled,
                    pressed &&
                      !disabled &&
                      styles.pressed,
                  ]}
                >
                  <View
                    style={[
                      styles.statusOptionIcon,
                      styles.statusOptionIconCompleted,
                    ]}
                  >
                    <Ionicons
                      name={option.icon}
                      size={18}
                      color={colors.brandWhite}
                    />
                  </View>

                  <View style={styles.statusOptionMain}>
                    <Text style={styles.statusOptionLabel}>
                      {option.label}
                    </Text>
                    <Text style={styles.statusOptionDescription}>
                      {option.available
                        ? option.description
                        : option.unavailableText ??
                          'Aucune option sûre disponible.'}
                    </Text>
                  </View>

                  {loading ? (
                    <ActivityIndicator
                      size="small"
                      color={colors.primaryLight}
                    />
                  ) : option.available ? (
                    <Ionicons
                      name="chevron-forward"
                      size={18}
                      color={colors.primaryLight}
                    />
                  ) : (
                    <Ionicons
                      name="ban-outline"
                      size={18}
                      color={colors.textMuted}
                    />
                  )}
                </Pressable>
              );
            })}

            {canUndo ? (
              <Pressable
                onPress={() =>
                  onSelect(
                    'equivalent',
                    true
                  )
                }
                disabled={loading}
                style={({ pressed }) => [
                  styles.statusOption,
                  styles.swapUndoOption,
                  loading &&
                    styles.swapDirectionOptionDisabled,
                  pressed &&
                    !loading &&
                    styles.pressed,
                ]}
              >
                <View
                  style={[
                    styles.statusOptionIcon,
                    styles.swapUndoIcon,
                  ]}
                >
                  <Ionicons
                    name="arrow-undo"
                    size={18}
                    color={colors.brandWhite}
                  />
                </View>

                <View style={styles.statusOptionMain}>
                  <Text style={styles.statusOptionLabel}>
                    {undoLabel}
                  </Text>
                  <Text style={styles.statusOptionDescription}>
                    Annule le dernier remplacement de cet exercice.
                  </Text>
                </View>

                {loading ? (
                  <ActivityIndicator
                    size="small"
                    color={colors.primaryLight}
                  />
                ) : (
                  <Ionicons
                    name="chevron-back"
                    size={18}
                    color={colors.primaryLight}
                  />
                )}
              </Pressable>
            ) : null}
          </View>
        </View>
      </View>
    </Modal>
  );
}

function ExerciseStatusModal({
  visible,
  exercise,
  onClose,
  onSelect,
}) {
  const options = [
    {
      value: 'completed',
      label: 'RÉALISÉ',
      description:
        'Tu as effectué l’exercice comme prévu.',
      icon: 'checkmark',
      tone: 'completed',
    },
    {
      value: 'adapted',
      label: 'ADAPTÉ',
      description:
        'Tu l’as fait, mais différemment de la prescription.',
      icon: 'options-outline',
      tone: 'adapted',
    },
    {
      value: 'not_completed',
      label: 'NON RÉALISÉ',
      description:
        'Tu n’as pas réalisé cet exercice.',
      icon: 'close',
      tone: 'not_completed',
    },
  ];

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.statusModalOverlay}>
        <Pressable
          style={styles.statusModalBackdrop}
          onPress={onClose}
        />

        <View style={styles.statusModalCard}>
          <View style={styles.statusModalHeader}>
            <View style={styles.statusModalTitleArea}>
              <Text style={styles.statusModalEyebrow}>
                STATUT DE L’EXERCICE
              </Text>
              <Text style={styles.statusModalTitle}>
                {String(
                  exercise?.name ??
                    'EXERCICE'
                ).toUpperCase()}
              </Text>
              <Text style={styles.statusModalSubtitle}>
                Aucun motif à renseigner maintenant. Tu pourras le préciser à la fin de la séance.
              </Text>
            </View>

            <Pressable
              onPress={onClose}
              style={styles.closeButton}
            >
              <Ionicons
                name="close"
                size={21}
                color={colors.textPrimary}
              />
            </Pressable>
          </View>

          <View style={styles.statusOptions}>
            {options.map((option) => {
              const selected =
                exercise?.status ===
                option.value;

              return (
                <Pressable
                  key={option.value}
                  onPress={() =>
                    onSelect(
                      option.value
                    )
                  }
                  style={({ pressed }) => [
                    styles.statusOption,
                    selected &&
                      styles.statusOptionSelected,
                    pressed &&
                      styles.pressed,
                  ]}
                >
                  <View
                    style={[
                      styles.statusOptionIcon,
                      option.tone ===
                        'completed' &&
                        styles.statusOptionIconCompleted,
                      option.tone ===
                        'adapted' &&
                        styles.statusOptionIconAdapted,
                      option.tone ===
                        'not_completed' &&
                        styles.statusOptionIconNotCompleted,
                    ]}
                  >
                    <Ionicons
                      name={option.icon}
                      size={18}
                      color={colors.brandWhite}
                    />
                  </View>

                  <View style={styles.statusOptionMain}>
                    <Text style={styles.statusOptionLabel}>
                      {option.label}
                    </Text>
                    <Text style={styles.statusOptionDescription}>
                      {option.description}
                    </Text>
                  </View>

                  {selected ? (
                    <Ionicons
                      name="checkmark-circle"
                      size={20}
                      color={colors.primaryLight}
                    />
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>
    </Modal>
  );
}

function TabataTimer({ block }) {
  const rounds = Math.max(
    1,
    Number(
      block?.source?.rounds ??
        8
    ) || 8
  );

  const workSeconds = Math.max(
    1,
    Number(
      block?.source?.workSeconds ??
        20
    ) || 20
  );

  const restSeconds = Math.max(
    1,
    Number(
      block?.source?.restSeconds ??
        10
    ) || 10
  );

  const [phase, setPhase] =
    useState('idle');
  const [round, setRound] =
    useState(1);
  const [remaining, setRemaining] =
    useState(workSeconds);
  const [paused, setPaused] =
    useState(false);

  const lastBuzzSecond =
    useRef(null);

  const running =
    phase === 'work' ||
    phase === 'rest';

  const phaseDuration =
    phase === 'rest'
      ? restSeconds
      : workSeconds;

  const progress = Math.max(
    0,
    Math.min(
      1,
      remaining /
        Math.max(1, phaseDuration)
    )
  );

  const exerciseIndex =
    (round - 1) %
    Math.max(
      1,
      block.exercises.length
    );

  const currentExercise =
    block.exercises[
      exerciseIndex
    ];

  const nextExercise =
    block.exercises[
      (exerciseIndex + 1) %
        Math.max(
          1,
          block.exercises.length
        )
    ];

  useEffect(() => {
    if (
      !running ||
      paused
    ) {
      return undefined;
    }

    const timer = setInterval(() => {
      setRemaining(
        (current) => {
          if (current > 1) {
            return current - 1;
          }

          if (phase === 'work') {
            setPhase('rest');
            Vibration.vibrate(80);
            return restSeconds;
          }

          if (round >= rounds) {
            setPhase('finished');
            setPaused(false);
            Vibration.vibrate([
              0,
              120,
              80,
              120,
            ]);
            return 0;
          }

          setRound(
            (value) => value + 1
          );
          setPhase('work');
          Vibration.vibrate(80);
          return workSeconds;
        }
      );
    }, 1000);

    return () =>
      clearInterval(timer);
  }, [
    paused,
    phase,
    restSeconds,
    round,
    rounds,
    running,
    workSeconds,
  ]);

  useEffect(() => {
    lastBuzzSecond.current = null;
  }, [phase]);

  useEffect(() => {
    if (
      !running ||
      paused ||
      remaining > 3 ||
      remaining <= 0
    ) {
      return;
    }

    if (
      lastBuzzSecond.current ===
      remaining
    ) {
      return;
    }

    lastBuzzSecond.current =
      remaining;
    Vibration.vibrate(35);
  }, [
    paused,
    remaining,
    running,
  ]);

  function start() {
    setRound(1);
    setPhase('work');
    setRemaining(workSeconds);
    setPaused(false);
    lastBuzzSecond.current = null;
    Vibration.vibrate(60);
  }

  function reset() {
    setPhase('idle');
    setRound(1);
    setRemaining(workSeconds);
    setPaused(false);
    lastBuzzSecond.current = null;
  }

  const phaseLabel =
    phase === 'rest'
      ? 'REPOS'
      : phase === 'finished'
        ? 'TERMINÉ'
        : 'EFFORT';

  return (
    <View style={styles.tabataTimerCard}>
      <View style={styles.tabataTimerTop}>
        <View>
          <Text style={styles.tabataTimerEyebrow}>
            TIMER TABATA
          </Text>
          <Text style={styles.tabataTimerMeta}>
            {rounds} ROUNDS · {workSeconds}S / {restSeconds}S
          </Text>
        </View>

        {running ? (
          <Pressable
            onPress={() =>
              setPaused(
                (value) => !value
              )
            }
            style={styles.timerMiniButton}
          >
            <Ionicons
              name={
                paused
                  ? 'play'
                  : 'pause'
              }
              size={17}
              color={colors.textPrimary}
            />
          </Pressable>
        ) : null}
      </View>

      <SegmentGauge
        progress={progress}
        remaining={remaining}
        phase={phase}
        phaseLabel={phaseLabel}
      />

      <Text style={styles.tabataRoundLabel}>
        {phase === 'finished'
          ? 'TABATA TERMINÉ'
          : `TOUR ${round} / ${rounds}`}
      </Text>

      {phase !== 'finished' ? (
        <>
          <Text style={styles.tabataCurrentExercise}>
            {phase === 'rest'
              ? 'RÉCUPÈRE'
              : String(
                  currentExercise?.name ??
                    'EXERCICE'
                ).toUpperCase()}
          </Text>

          {phase === 'rest' &&
          nextExercise ? (
            <Text style={styles.tabataNextExercise}>
              SUIVANT · {String(
                nextExercise.name
              ).toUpperCase()}
            </Text>
          ) : null}
        </>
      ) : (
        <Text style={styles.tabataNextExercise}>
          Tu peux maintenant terminer le bloc.
        </Text>
      )}

      {phase === 'idle' ? (
        <Pressable
          onPress={start}
          style={styles.timerPrimaryButton}
        >
          <Ionicons
            name="play"
            size={17}
            color={colors.brandWhite}
          />
          <Text style={styles.timerPrimaryButtonText}>
            DÉMARRER LE TIMER
          </Text>
        </Pressable>
      ) : null}

      {phase === 'finished' ? (
        <Pressable
          onPress={reset}
          style={styles.timerSecondaryButton}
        >
          <Ionicons
            name="refresh"
            size={16}
            color={colors.textSecondary}
          />
          <Text style={styles.timerSecondaryButtonText}>
            RECOMMENCER
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function SegmentGauge({
  progress,
  remaining,
  phase,
  phaseLabel,
}) {
  const segmentCount = 36;
  const activeCount = Math.ceil(
    progress * segmentCount
  );
  const radius = 91;

  const alert =
    remaining > 0 &&
    remaining <= 3;

  return (
    <View style={styles.gaugeWrap}>
      <View style={styles.gaugeRing}>
        {Array.from(
          { length: segmentCount },
          (_, index) => {
            const active =
              index < activeCount;

            return (
              <View
                key={index}
                style={[
                  styles.gaugeSegment,
                  {
                    opacity:
                      active
                        ? 1
                        : 0.14,
                    backgroundColor:
                      alert
                        ? colors.brandRed
                        : phase === 'rest'
                          ? colors.brandWhite
                          : colors.primaryLight,
                    transform: [
                      {
                        rotate: `${
                          index *
                            (360 /
                              segmentCount)
                        }deg`,
                      },
                      {
                        translateY:
                          -radius,
                      },
                    ],
                  },
                ]}
              />
            );
          }
        )}

        <View style={styles.gaugeCenter}>
          <Text
            style={[
              styles.gaugePhase,
              alert &&
                styles.gaugePhaseAlert,
            ]}
          >
            {phase === 'idle'
              ? 'PRÊT'
              : phaseLabel}
          </Text>
          <Text
            style={[
              styles.gaugeValue,
              alert &&
                styles.gaugeValueAlert,
            ]}
          >
            {remaining}
          </Text>
          <Text style={styles.gaugeUnit}>
            SECONDES
          </Text>
        </View>
      </View>
    </View>
  );
}

function FormatModal({
  visible,
  onClose,
  loading,
  changing,
  error,
  options,
  subscriptionTier,
  onSelect,
}) {
  const {
    width: viewportWidth,
    height: viewportHeight,
  } = useWindowDimensions();

  const compactViewport =
    viewportWidth <= 600;

  const modalHeight = compactViewport
    ? viewportHeight
    : Math.min(
        720,
        Math.max(
          480,
          Math.round(viewportHeight * 0.84)
        )
      );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View
        style={styles.modalOverlay}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={onClose}
        />

        <SafeAreaView
          style={[
            styles.modalSheet,
            compactViewport &&
              styles.modalSheetCompact,
            { height: modalHeight },
          ]}
        >
          <View
            style={styles.modalHandle}
          />

          <View
            style={styles.modalHeader}
          >
            <View style={styles.modalTitleArea}>
              <Text
                style={styles.modalEyebrow}
              >
                FORMAT DU WOD · {subscriptionTier}
              </Text>

              <Text
                style={styles.modalTitle}
              >
                CHOISIS TA MÉCANIQUE
                <Text
                  style={styles.blueDot}
                >
                  .
                </Text>
              </Text>

              <Text
                style={styles.modalSubtitle}
              >
                UGEROD garde la main sur les exercices, les répétitions, les charges et les paramètres du format.
              </Text>
            </View>

            <Pressable
              onPress={onClose}
              disabled={Boolean(changing)}
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
            <View
              style={styles.modalError}
            >
              <Ionicons
                name="alert-circle-outline"
                size={18}
                color={colors.brandRed}
              />
              <Text
                style={styles.modalErrorText}
              >
                {error}
              </Text>
            </View>
          ) : null}

          {loading ? (
            <View
              style={styles.modalLoading}
            >
              <ActivityIndicator
                size="large"
                color={colors.primaryLight}
              />
              <Text
                style={styles.modalLoadingText}
              >
                UGEROD vérifie les formats compatibles avec cette séance…
              </Text>
            </View>
          ) : (
            <ScrollView
              style={styles.formatList}
              contentContainerStyle={
                styles.formatListContent
              }
              showsVerticalScrollIndicator={false}
            >
              {options.map((option) => {
                const state =
                  formatOptionState(option);

                const disabled =
                  !option.selectable ||
                  option.current ||
                  Boolean(changing);

                const isChanging =
                  changing ===
                  option.option_id;

                return (
                  <Pressable
                    key={option.option_id}
                    disabled={disabled}
                    onPress={() =>
                      onSelect(option)
                    }
                    style={({ pressed }) => [
                      styles.formatOption,
                      option.current &&
                        styles.formatOptionCurrent,
                      !option.compatible &&
                        styles.formatOptionDisabled,
                      option.locked &&
                        option.compatible &&
                        styles.formatOptionLocked,
                      pressed &&
                        !disabled &&
                        styles.formatOptionPressed,
                    ]}
                  >
                    <View
                      style={styles.formatOptionMain}
                    >
                      <View
                        style={styles.formatOptionTitleRow}
                      >
                        <Text
                          style={[
                            styles.formatOptionTitle,
                            !option.compatible &&
                              !option.current &&
                              styles.formatOptionTitleMuted,
                          ]}
                        >
                          {String(
                            option.display_name ??
                              option.option_id
                          ).toUpperCase()}
                        </Text>

                        {isChanging ? (
                          <ActivityIndicator
                            size="small"
                            color={colors.primaryLight}
                          />
                        ) : (
                          <Ionicons
                            name={state.icon}
                            size={17}
                            color={
                              state.tone ===
                                'incompatible'
                                ? colors.textMuted
                                : state.tone ===
                                    'locked'
                                  ? '#F5A623'
                                  : colors.primaryLight
                            }
                          />
                        )}
                      </View>

                      <Text
                        style={[
                          styles.formatOptionDescription,
                          !option.compatible &&
                            !option.current &&
                            styles.formatOptionDescriptionMuted,
                        ]}
                      >
                        {option.description ??
                          'UGEROD adaptera la structure de la séance à cette mécanique.'}
                      </Text>

                      {state.label ? (
                        <Text
                          style={[
                            styles.formatOptionState,
                            state.tone ===
                              'incompatible' &&
                              styles.formatStateMuted,
                            state.tone ===
                              'locked' &&
                              styles.formatStateLocked,
                          ]}
                        >
                          {state.label}
                        </Text>
                      ) : null}
                    </View>
                  </Pressable>
                );
              })}

            </ScrollView>
          )}
        </SafeAreaView>
      </View>
    </Modal>
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

  summaryCard: {
    marginTop: 10,
    borderRadius: 17,
    padding: 16,
    backgroundColor:
      'rgba(17,21,26,0.90)',
    borderWidth: 1,
    borderColor:
      'rgba(255,255,255,0.09)',
  },

  summaryTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 16,
  },

  summaryLabel: {
    fontFamily:
      'Oswald_600SemiBold',
    fontSize: 11,
    lineHeight: 15,
    letterSpacing: 0.8,
    color:
      colors.textSecondary,
  },

  summaryDuration: {
    fontFamily:
      'BebasNeue_400Regular',
    fontSize: 33,
    lineHeight: 36,
    letterSpacing: 1.2,
    color:
      colors.textPrimary,
    marginTop: 2,
  },

  summaryRight: {
    alignItems: 'flex-end',
  },

  summaryBlockCounter: {
    marginTop: 3,
    fontFamily:
      'BebasNeue_400Regular',
    fontSize: 22,
    lineHeight: 25,
    letterSpacing: 0.9,
    color:
      colors.textPrimary,
  },

  sessionProgressTrack: {
    width: '100%',
    height: 5,
    marginTop: 12,
    borderRadius: 3,
    overflow: 'hidden',
    backgroundColor:
      'rgba(255,255,255,0.08)',
  },

  sessionProgressFill: {
    height: '100%',
    borderRadius: 3,
    backgroundColor:
      colors.primary,
  },

  summaryBottomRow: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },

  summaryCurrentBlock: {
    flex: 1,
    fontFamily:
      'Oswald_700Bold',
    fontSize: 11,
    lineHeight: 15,
    letterSpacing: 0.5,
    color:
      colors.textSecondary,
  },

  summaryMeta: {
    fontFamily:
      'Oswald_700Bold',
    fontSize: 11,
    letterSpacing: 0.8,
    color:
      colors.primaryLight,
  },

  errorCard: {
    marginTop: 12,
    minHeight: 48,
    paddingHorizontal: 13,
    borderRadius: 12,
    borderWidth: 1,
    borderColor:
      'rgba(255,59,59,0.45)',
    backgroundColor:
      'rgba(255,59,59,0.08)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },

  errorText: {
    flex: 1,
    fontFamily:
      'Oswald_400Regular',
    fontSize: 12,
    lineHeight: 17,
    color:
      colors.brandRed,
  },

  blocks: {
    marginTop: 15,
    gap: 11,
  },

  block: {
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor:
      'rgba(17,21,26,0.93)',
    borderWidth: 1,
    borderColor:
      'rgba(255,255,255,0.09)',
  },

  blockValidated: {
    borderColor:
      'rgba(8,104,255,0.38)',
  },

  blockLocked: {
    borderColor:
      'rgba(255,255,255,0.07)',
  },

  blockHeader: {
    minHeight: 74,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },

  blockHeaderText: {
    flex: 1,
  },

  blockTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent:
      'space-between',
    gap: 8,
  },

  blockTitle: {
    fontFamily:
      'Oswald_700Bold',
    fontSize: 16,
    lineHeight: 21,
    letterSpacing: 0.7,
    color:
      colors.textPrimary,
  },

  blockTitleLocked: {
    color:
      colors.textSecondary,
  },

  blockDuration: {
    fontFamily:
      'Oswald_600SemiBold',
    fontSize: 11,
    color:
      colors.textMuted,
  },

  blockStructure: {
    marginTop: 5,
    fontFamily:
      'Oswald_400Regular',
    fontSize: 12,
    lineHeight: 18,
    color:
      colors.textSecondary,
  },

  blockLockedText: {
    marginTop: 5,
    fontFamily:
      'Oswald_600SemiBold',
    fontSize: 9,
    lineHeight: 14,
    letterSpacing: 0.45,
    color:
      colors.textMuted,
  },

  blockStatusPending: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor:
      colors.border,
  },

  blockStatusActionable: {
    borderColor:
      'rgba(8,104,255,0.62)',
    backgroundColor:
      'rgba(8,104,255,0.08)',
  },

  blockStatusSelected: {
    borderColor:
      colors.primary,
    backgroundColor:
      colors.primary,
  },

  blockStatusPressed: {
    backgroundColor:
      'rgba(8,104,255,0.24)',
  },

  blockStatusLocked: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor:
      colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },

  blockStatusValidated: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor:
      colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },

  secretWodContent: {
    paddingHorizontal: 14,
    paddingBottom: 14,
    gap: 10,
  },

  formatPreview: {
    minHeight: 76,
    borderRadius: 13,
    padding: 12,
    borderWidth: 1,
    borderColor:
      'rgba(8,104,255,0.28)',
    backgroundColor:
      'rgba(8,104,255,0.08)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },

  formatPreviewMain: {
    flex: 1,
  },

  formatPreviewLabel: {
    fontFamily:
      'Oswald_600SemiBold',
    fontSize: 9,
    letterSpacing: 0.75,
    color:
      colors.textMuted,
  },

  formatPreviewValue: {
    marginTop: 2,
    fontFamily:
      'BebasNeue_400Regular',
    fontSize: 24,
    lineHeight: 27,
    letterSpacing: 1,
    color:
      colors.textPrimary,
  },

  formatPreviewHint: {
    marginTop: 1,
    fontFamily:
      'Oswald_400Regular',
    fontSize: 10,
    color:
      colors.textSecondary,
  },

  modifyFormatButton: {
    minHeight: 38,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor:
      'rgba(8,104,255,0.38)',
    backgroundColor:
      'rgba(8,104,255,0.10)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },

  modifyFormatText: {
    fontFamily:
      'Oswald_700Bold',
    fontSize: 9,
    letterSpacing: 0.55,
    color:
      colors.primaryLight,
  },

  secretMessage: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 3,
  },

  secretMessageText: {
    flex: 1,
    fontFamily:
      'Oswald_400Regular',
    fontSize: 11,
    lineHeight: 16,
    color:
      colors.textMuted,
  },

  blockContent: {
    borderTopWidth: 1,
    borderTopColor:
      'rgba(255,255,255,0.06)',
    paddingHorizontal: 14,
    paddingBottom: 14,
  },

  objectiveBanner: {
    marginTop: 12,
    marginBottom: 3,
    borderRadius: 11,
    padding: 10,
    backgroundColor:
      'rgba(255,255,255,0.035)',
  },

  objectiveLabel: {
    fontFamily:
      'Oswald_700Bold',
    fontSize: 8,
    letterSpacing: 0.65,
    color:
      colors.textMuted,
  },

  objectiveText: {
    marginTop: 2,
    fontFamily:
      'Oswald_400Regular',
    fontSize: 11,
    lineHeight: 16,
    color:
      colors.textSecondary,
  },

  currentExerciseCard: {
    marginTop: 12,
    marginBottom: 4,
    borderRadius: 15,
    padding: 15,
    borderWidth: 1,
    borderColor:
      'rgba(8,104,255,0.34)',
    backgroundColor:
      'rgba(8,104,255,0.075)',
  },

  currentExerciseTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },

  currentExerciseEyebrow: {
    fontFamily:
      'Oswald_700Bold',
    fontSize: 11,
    lineHeight: 15,
    letterSpacing: 0.75,
    color:
      colors.primaryLight,
  },

  currentExerciseBlockLabel: {
    fontFamily:
      'Oswald_600SemiBold',
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 0.55,
    color:
      colors.textMuted,
  },

  currentExerciseName: {
    marginTop: 10,
    fontFamily:
      'BebasNeue_400Regular',
    fontSize: 30,
    lineHeight: 33,
    letterSpacing: 1.1,
    color:
      colors.textPrimary,
  },

  currentExercisePrescription: {
    marginTop: 2,
    fontFamily:
      'Oswald_700Bold',
    fontSize: 15,
    lineHeight: 20,
    color:
      colors.primaryLight,
  },

  currentExerciseInstructions: {
    marginTop: 9,
    fontFamily:
      'Oswald_400Regular',
    fontSize: 12,
    lineHeight: 18,
    color:
      colors.textSecondary,
  },

  currentExerciseActions: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },

  currentExerciseNavButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor:
      'rgba(255,255,255,0.11)',
    backgroundColor:
      'rgba(255,255,255,0.045)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  currentExerciseNavButtonDisabled: {
    opacity: 0.28,
  },

  currentExerciseDots: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },

  currentExerciseDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor:
      'rgba(255,255,255,0.14)',
  },

  currentExerciseDotActive: {
    width: 18,
    backgroundColor:
      colors.primary,
  },

  exerciseWrapper: {
    paddingVertical: 12,
  },

  exerciseBorder: {
    borderBottomWidth: 1,
    borderBottomColor:
      'rgba(255,255,255,0.05)',
  },

  exerciseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },

  exerciseStatus: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 2,
    borderColor:
      colors.border,
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

  tabataPosition: {
    fontFamily:
      'Oswald_700Bold',
    fontSize: 8,
    letterSpacing: 0.55,
    color:
      colors.primaryLight,
    marginBottom: 2,
  },

  exerciseName: {
    fontFamily:
      'Oswald_700Bold',
    fontSize: 15,
    lineHeight: 20,
    color:
      colors.textPrimary,
  },

  exercisePrescription: {
    marginTop: 3,
    fontFamily:
      'Oswald_600SemiBold',
    fontSize: 13,
    lineHeight: 18,
    color:
      colors.primaryLight,
  },

  swapButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor:
      'rgba(8,104,255,0.08)',
  },

  swapButtonLoading: {
    opacity: 0.7,
  },

  swapDirectionOptionDisabled: {
    opacity: 0.42,
  },

  swapUndoOption: {
    marginTop: 3,
    borderColor:
      'rgba(8,104,255,0.18)',
  },

  swapUndoIcon: {
    backgroundColor:
      'rgba(8,104,255,0.72)',
  },

  exerciseDetails: {
    marginTop: 11,
    marginLeft: 38,
    borderRadius: 11,
    padding: 11,
    backgroundColor:
      'rgba(255,255,255,0.035)',
  },

  exerciseDetailImage: {
    width: '100%',
    height: 170,
    borderRadius: 10,
    marginBottom: 12,
    backgroundColor:
      'rgba(255,255,255,0.04)',
  },

  exerciseDetailSection: {
    gap: 4,
    marginBottom: 10,
  },

  exerciseDetailLabel: {
    fontFamily:
      'Oswald_700Bold',
    fontSize: 9,
    lineHeight: 13,
    letterSpacing: 0.75,
    color:
      colors.primaryLight,
  },

  exerciseDescription: {
    fontFamily:
      'Oswald_400Regular',
    fontSize: 11,
    lineHeight: 17,
    color:
      colors.textSecondary,
  },

  tipRow: {
    marginTop: 9,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 7,
  },

  tipTextWrap: {
    flex: 1,
    gap: 3,
  },

  tipText: {
    flex: 1,
    fontFamily:
      'Oswald_400Regular',
    fontSize: 10,
    lineHeight: 15,
    color:
      colors.textSecondary,
  },

  statusHint: {
    marginTop: 11,
    fontFamily:
      'Oswald_400Regular',
    fontSize: 10,
    lineHeight: 15,
    color:
      colors.textMuted,
    textAlign: 'center',
  },

  validateButton: {
    minHeight: 50,
    marginTop: 14,
    borderRadius: 12,
    backgroundColor:
      colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 7,
  },

  validateButtonDisabled: {
    backgroundColor:
      'rgba(255,255,255,0.06)',
  },

  validateButtonDone: {
    backgroundColor:
      'rgba(8,104,255,0.09)',
    borderWidth: 1,
    borderColor:
      'rgba(8,104,255,0.25)',
  },

  validateButtonPressed: {
    backgroundColor:
      colors.primaryDark,
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
    fontSize: 10,
    letterSpacing: 0.65,
    color:
      colors.primaryLight,
  },

  bottomSpace: {
    height: 36,
  },


  discoverWodButton: {
    minHeight: 52,
    marginTop: 13,
    borderRadius: 13,
    backgroundColor:
      colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },

  discoverWodText: {
    fontFamily:
      'Oswald_700Bold',
    fontSize: 11,
    letterSpacing: 0.8,
    color:
      colors.brandWhite,
  },

  exerciseStatusAdapted: {
    backgroundColor:
      'rgba(245,166,35,0.92)',
    borderColor:
      'rgba(245,166,35,1)',
  },

  adaptedStatusSymbol: {
    fontFamily:
      'Oswald_700Bold',
    fontSize: 17,
    lineHeight: 18,
    color:
      colors.brandWhite,
  },

  statusModalOverlay: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal:
      spacing.xl,
  },

  statusModalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor:
      'rgba(0,0,0,0.72)',
  },

  statusModalCard: {
    borderRadius: 20,
    padding: 18,
    backgroundColor:
      '#11151A',
    borderWidth: 1,
    borderColor:
      'rgba(255,255,255,0.11)',
  },

  statusModalHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },

  statusModalTitleArea: {
    flex: 1,
  },

  statusModalEyebrow: {
    fontFamily:
      'Oswald_600SemiBold',
    fontSize: 9,
    letterSpacing: 0.9,
    color:
      colors.primaryLight,
  },

  statusModalTitle: {
    fontFamily:
      'BebasNeue_400Regular',
    fontSize: 27,
    lineHeight: 30,
    letterSpacing: 1.1,
    color:
      colors.textPrimary,
    marginTop: 3,
  },

  statusModalSubtitle: {
    fontFamily:
      'Oswald_400Regular',
    fontSize: 12,
    lineHeight: 18,
    color:
      colors.textSecondary,
    marginTop: 5,
  },

  statusOptions: {
    gap: 9,
    marginTop: 18,
  },

  statusOption: {
    minHeight: 68,
    borderRadius: 14,
    borderWidth: 1,
    borderColor:
      'rgba(255,255,255,0.08)',
    backgroundColor:
      'rgba(255,255,255,0.025)',
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },

  statusOptionSelected: {
    borderColor:
      'rgba(8,104,255,0.40)',
    backgroundColor:
      'rgba(8,104,255,0.08)',
  },

  statusOptionIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },

  statusOptionIconCompleted: {
    backgroundColor:
      colors.primary,
  },

  statusOptionIconAdapted: {
    backgroundColor:
      'rgba(245,166,35,0.92)',
  },

  statusOptionIconNotCompleted: {
    backgroundColor:
      colors.brandRed,
  },

  statusOptionMain: {
    flex: 1,
  },

  statusOptionLabel: {
    fontFamily:
      'Oswald_700Bold',
    fontSize: 12,
    letterSpacing: 0.55,
    color:
      colors.textPrimary,
  },

  statusOptionDescription: {
    fontFamily:
      'Oswald_400Regular',
    fontSize: 11,
    lineHeight: 16,
    color:
      colors.textSecondary,
    marginTop: 2,
  },

  tabataTimerCard: {
    marginBottom: 16,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor:
      'rgba(8,104,255,0.28)',
    backgroundColor:
      'rgba(7,10,14,0.88)',
    alignItems: 'center',
  },

  tabataTimerTop: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  tabataTimerEyebrow: {
    fontFamily:
      'Oswald_700Bold',
    fontSize: 10,
    letterSpacing: 0.8,
    color:
      colors.primaryLight,
  },

  tabataTimerMeta: {
    fontFamily:
      'Oswald_400Regular',
    fontSize: 11,
    color:
      colors.textSecondary,
    marginTop: 2,
  },

  timerMiniButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    borderColor:
      'rgba(255,255,255,0.10)',
    backgroundColor:
      'rgba(255,255,255,0.05)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  gaugeWrap: {
    marginTop: 20,
    width: 220,
    height: 220,
    alignItems: 'center',
    justifyContent: 'center',
  },

  gaugeRing: {
    width: 220,
    height: 220,
    borderRadius: 110,
    alignItems: 'center',
    justifyContent: 'center',
  },

  gaugeSegment: {
    position: 'absolute',
    left: 107.5,
    top: 103,
    width: 5,
    height: 14,
    borderRadius: 3,
  },

  gaugeCenter: {
    width: 150,
    height: 150,
    borderRadius: 75,
    borderWidth: 1,
    borderColor:
      'rgba(255,255,255,0.08)',
    backgroundColor:
      'rgba(17,21,26,0.96)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  gaugePhase: {
    fontFamily:
      'Oswald_700Bold',
    fontSize: 10,
    letterSpacing: 1,
    color:
      colors.primaryLight,
  },

  gaugePhaseAlert: {
    color:
      colors.brandRed,
  },

  gaugeValue: {
    fontFamily:
      'BebasNeue_400Regular',
    fontSize: 68,
    lineHeight: 72,
    color:
      colors.textPrimary,
    marginTop: -2,
  },

  gaugeValueAlert: {
    color:
      colors.brandRed,
  },

  gaugeUnit: {
    fontFamily:
      'Oswald_600SemiBold',
    fontSize: 8,
    letterSpacing: 0.8,
    color:
      colors.textMuted,
    marginTop: -3,
  },

  tabataRoundLabel: {
    fontFamily:
      'Oswald_700Bold',
    fontSize: 11,
    letterSpacing: 0.75,
    color:
      colors.textSecondary,
  },

  tabataCurrentExercise: {
    fontFamily:
      'BebasNeue_400Regular',
    fontSize: 26,
    lineHeight: 30,
    letterSpacing: 1,
    color:
      colors.textPrimary,
    textAlign: 'center',
    marginTop: 5,
  },

  tabataNextExercise: {
    fontFamily:
      'Oswald_400Regular',
    fontSize: 11,
    lineHeight: 16,
    color:
      colors.textMuted,
    textAlign: 'center',
    marginTop: 2,
  },

  timerPrimaryButton: {
    minHeight: 45,
    marginTop: 15,
    borderRadius: 12,
    backgroundColor:
      colors.primary,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },

  timerPrimaryButtonText: {
    fontFamily:
      'Oswald_700Bold',
    fontSize: 11,
    letterSpacing: 0.7,
    color:
      colors.brandWhite,
  },

  timerSecondaryButton: {
    minHeight: 40,
    marginTop: 13,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor:
      'rgba(255,255,255,0.08)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },

  timerSecondaryButtonText: {
    fontFamily:
      'Oswald_600SemiBold',
    fontSize: 10,
    letterSpacing: 0.5,
    color:
      colors.textSecondary,
  },

  pressed: {
    opacity: 0.68,
  },

  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },

  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor:
      'rgba(0,0,0,0.72)',
  },

  modalSheet: {
    width: '94%',
    maxWidth: 560,
    maxHeight: '94%',
    flexShrink: 1,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor:
      colors.background,
    borderWidth: 1,
    borderColor:
      'rgba(255,255,255,0.10)',
    paddingHorizontal: 16,
  },

  modalSheetCompact: {
    width: '100%',
    maxWidth: '100%',
    maxHeight: '100%',
    borderRadius: 0,
    borderWidth: 0,
    paddingHorizontal: 16,
  },

  modalHandle: {
    width: 42,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 9,
    backgroundColor:
      'rgba(255,255,255,0.16)',
  },

  modalHeader: {
    paddingTop: 17,
    paddingBottom: 13,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },

  modalTitleArea: {
    flex: 1,
  },

  modalEyebrow: {
    fontFamily:
      'Oswald_600SemiBold',
    fontSize: 9,
    letterSpacing: 0.8,
    color:
      colors.primaryLight,
  },

  modalTitle: {
    marginTop: 3,
    fontFamily:
      'BebasNeue_400Regular',
    fontSize: 29,
    lineHeight: 32,
    letterSpacing: 1.25,
    color:
      colors.textPrimary,
  },

  modalSubtitle: {
    marginTop: 5,
    fontFamily:
      'Oswald_400Regular',
    fontSize: 11,
    lineHeight: 17,
    color:
      colors.textSecondary,
  },

  closeButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    borderColor:
      colors.border,
    backgroundColor:
      colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },

  modalError: {
    minHeight: 46,
    marginBottom: 10,
    paddingHorizontal: 11,
    borderRadius: 10,
    borderWidth: 1,
    borderColor:
      'rgba(255,59,59,0.38)',
    backgroundColor:
      'rgba(255,59,59,0.07)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },

  modalErrorText: {
    flex: 1,
    fontFamily:
      'Oswald_400Regular',
    fontSize: 11,
    lineHeight: 16,
    color:
      colors.brandRed,
  },

  modalLoading: {
    flex: 1,
    minHeight: 280,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },

  modalLoadingText: {
    marginTop: 14,
    fontFamily:
      'Oswald_400Regular',
    fontSize: 12,
    lineHeight: 18,
    color:
      colors.textSecondary,
    textAlign: 'center',
  },

  formatList: {
    flex: 1,
    minHeight: 0,
  },

  formatListContent: {
    paddingBottom: 24,
    gap: 8,
  },

  skillScoreHint: {
    marginTop: 7,
    fontFamily:
      'Oswald_700Bold',
    fontSize: 9,
    lineHeight: 13,
    letterSpacing: 0.65,
    color:
      colors.primaryLight,
  },

  skillTestOverlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },

  skillTestBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor:
      'rgba(0,0,0,0.78)',
  },

  skillTestCard: {
    width: '100%',
    maxWidth: 430,
    borderRadius: 18,
    padding: 18,
    backgroundColor:
      '#0B0F14',
    borderWidth: 1,
    borderColor:
      'rgba(8,104,255,0.38)',
  },

  skillTestEyebrow: {
    fontFamily:
      'Oswald_700Bold',
    fontSize: 9,
    letterSpacing: 0.8,
    color:
      colors.primaryLight,
  },

  skillTestTitle: {
    marginTop: 3,
    fontFamily:
      'BebasNeue_400Regular',
    fontSize: 28,
    lineHeight: 31,
    letterSpacing: 1.1,
    color:
      colors.textPrimary,
  },

  skillTestPrompt: {
    marginTop: 14,
    fontFamily:
      'Oswald_700Bold',
    fontSize: 12,
    lineHeight: 17,
    letterSpacing: 0.55,
    color:
      colors.textPrimary,
  },

  skillTestHelper: {
    marginTop: 3,
    fontFamily:
      'Oswald_400Regular',
    fontSize: 11,
    lineHeight: 17,
    color:
      colors.textSecondary,
  },

  skillTestInputWrap: {
    minHeight: 54,
    marginTop: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor:
      colors.border,
    backgroundColor:
      'rgba(255,255,255,0.035)',
    paddingHorizontal: 13,
    flexDirection: 'row',
    alignItems: 'center',
  },

  skillTestInput: {
    flex: 1,
    fontFamily:
      'BebasNeue_400Regular',
    fontSize: 27,
    color:
      colors.textPrimary,
    paddingVertical: 0,
  },

  skillTestUnit: {
    fontFamily:
      'Oswald_600SemiBold',
    fontSize: 12,
    color:
      colors.textMuted,
  },

  skillTestActions: {
    marginTop: 15,
    gap: 8,
  },

  skillTestCancel: {
    minHeight: 44,
    borderRadius: 11,
    borderWidth: 1,
    borderColor:
      colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },

  skillTestCancelText: {
    fontFamily:
      'Oswald_700Bold',
    fontSize: 10,
    letterSpacing: 0.6,
    color:
      colors.textSecondary,
  },

  skillTestSave: {
    minHeight: 50,
    borderRadius: 12,
    backgroundColor:
      colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },

  skillTestSaveDisabled: {
    opacity: 0.35,
  },

  skillTestSaveText: {
    fontFamily:
      'Oswald_700Bold',
    fontSize: 11,
    letterSpacing: 0.7,
    color:
      colors.brandWhite,
  },

  formatOption: {
    minHeight: 82,
    borderRadius: 13,
    padding: 12,
    backgroundColor:
      colors.surface,
    borderWidth: 1,
    borderColor:
      colors.border,
  },

  formatOptionCurrent: {
    backgroundColor:
      'rgba(8,104,255,0.10)',
    borderColor:
      'rgba(8,104,255,0.42)',
  },

  formatOptionDisabled: {
    opacity: 0.46,
  },

  formatOptionLocked: {
    backgroundColor:
      'rgba(245,166,35,0.10)',
    borderColor:
      'rgba(245,166,35,0.48)',
  },

  formatOptionPressed: {
    transform: [
      { scale: 0.988 },
    ],
  },

  formatOptionMain: {
    flex: 1,
  },

  formatOptionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent:
      'space-between',
    gap: 8,
  },

  formatOptionTitle: {
    flex: 1,
    fontFamily:
      'Oswald_700Bold',
    fontSize: 13,
    lineHeight: 17,
    letterSpacing: 0.6,
    color:
      colors.textPrimary,
  },

  formatOptionTitleMuted: {
    color:
      colors.textSecondary,
  },

  formatOptionDescription: {
    marginTop: 5,
    fontFamily:
      'Oswald_400Regular',
    fontSize: 13,
    lineHeight: 19,
    color:
      colors.textSecondary,
  },

  formatOptionDescriptionMuted: {
    color:
      colors.textMuted,
  },

  formatOptionState: {
    marginTop: 6,
    fontFamily:
      'Oswald_700Bold',
    fontSize: 8,
    letterSpacing: 0.6,
    color:
      colors.primaryLight,
  },

  formatStateMuted: {
    color:
      colors.textMuted,
  },

  formatStateLocked: {
    color:
      '#F5A623',
  },

  formatFooter: {
    marginTop: 5,
    padding: 12,
    borderRadius: 11,
    backgroundColor:
      'rgba(8,104,255,0.06)',
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },

  formatFooterText: {
    flex: 1,
    fontFamily:
      'Oswald_400Regular',
    fontSize: 10,
    lineHeight: 15,
    color:
      colors.textSecondary,
  },
});