import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  Vibration,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { setAudioModeAsync, useAudioPlayer } from 'expo-audio';

import {
  colors,
  spacing,
} from '../../constants';

const wodBeep = require('../../../assets/sounds/tabata-beep.wav');

function normalizeMechanic(value) {
  return String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/[\s/-]+/g, '_');
}

function formatClock(totalSeconds) {
  const safe = Math.max(
    0,
    Math.floor(Number(totalSeconds) || 0)
  );
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;

  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function numberOr(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric)
    ? numeric
    : fallback;
}

function paramsFromBlock(block) {
  return (
    block?.source?.parameters ??
    block?.source?.mechanicJson?.parameters ??
    block?.source?.mechanic_json?.parameters ??
    {}
  );
}

function mechanicFromBlock(block) {
  return normalizeMechanic(
    block?.source?.mechanic ??
      block?.source?.mechanicJson?.mechanic_key ??
      block?.source?.mechanic_json?.mechanic_key ??
      block?.mechanic ??
      ''
  );
}

function variantFromBlock(block) {
  return normalizeMechanic(
    block?.source?.variant ??
      block?.source?.mechanicJson?.variant_key ??
      block?.source?.mechanic_json?.variant_key ??
      ''
  );
}

function overlayForExercise(exercise) {
  return (
    exercise?.prescriptionJson?.mechanic_overlay ??
    exercise?.prescription_json?.mechanic_overlay ??
    {}
  );
}

function repsForStage(
  exercise,
  stage,
  direction = 'ascending'
) {
  const overlay =
    overlayForExercise(exercise);

  const start = numberOr(
    overlay.start_reps ??
      overlay.base_reps ??
      exercise?.prescriptionJson?.reps_min,
    1
  );

  const increment = Math.max(
    1,
    numberOr(
      overlay.increment_reps,
      1
    )
  );

  if (direction === 'descending') {
    const first = numberOr(
      overlay.first_stage_reps,
      start
    );

    return Math.max(
      start,
      first -
        Math.max(0, stage - 1) *
          increment
    );
  }

  return Math.max(
    1,
    start +
      Math.max(0, stage - 1) *
        increment
  );
}

function pyramidReps(
  exercise,
  multiplier
) {
  const overlay =
    overlayForExercise(exercise);
  const base = Math.max(
    1,
    numberOr(
      overlay.base_reps ??
        exercise?.prescriptionJson?.reps_min,
      1
    )
  );

  return Math.round(base * multiplier);
}

function totalSecondsForMechanic({
  mechanic,
  params,
  durationMinutes,
  exerciseCount,
}) {
  const wodBudgetSeconds =
    Math.max(
      1,
      numberOr(
        params.wod_budget_minutes ??
          durationMinutes,
        durationMinutes || 10
      )
    ) * 60;

  if (mechanic === 'AMRAP') {
    return (
      numberOr(
        params.duration_minutes,
        durationMinutes
      ) * 60
    );
  }

  if (mechanic === 'EMOM') {
    if (params.duration_minutes) {
      return numberOr(
        params.duration_minutes,
        durationMinutes
      ) * 60;
    }

    return (
      Math.max(1, numberOr(params.cycles, 1)) *
      Math.max(1, exerciseCount) *
      Math.max(1, numberOr(params.station_seconds, 60))
    );
  }

  if (mechanic === 'HIIT') {
    return (
      Math.max(1, numberOr(params.rounds, 1)) *
      Math.max(
        1,
        numberOr(
          params.exercise_count,
          exerciseCount || 1
        )
      ) *
      (
        Math.max(1, numberOr(params.work_seconds, 40)) +
        Math.max(0, numberOr(params.rest_seconds, 20))
      )
    );
  }

  if (mechanic === 'FOR_TIME') {
    return Math.max(
      1,
      numberOr(
        params.cap_seconds,
        wodBudgetSeconds
      )
    );
  }

  if (mechanic === 'ODD_EVEN') {
    return (
      Math.max(1, numberOr(params.cycles, 1)) *
      2 *
      Math.max(1, numberOr(params.station_seconds, 60))
    );
  }

  if (mechanic === 'EVERY_X_MINUTES') {
    return (
      Math.max(1, numberOr(params.cycles, 1)) *
      Math.max(1, numberOr(params.interval_seconds, 120))
    );
  }

  if (mechanic === 'PROGRESSIVE_INTERVAL') {
    return wodBudgetSeconds;
  }

  return null;
}

function useSecondClock({
  started,
  paused,
  finished,
  maxSeconds = null,
  initialElapsed = 0,
  onAutoFinish,
}) {
  const [elapsed, setElapsed] =
    useState(
      Math.max(
        0,
        numberOr(initialElapsed, 0)
      )
    );

  useEffect(() => {
    if (
      !started ||
      paused ||
      finished
    ) {
      return undefined;
    }

    const timer = setInterval(() => {
      setElapsed((current) => {
        const next = current + 1;

        if (
          maxSeconds != null &&
          next >= maxSeconds
        ) {
          setTimeout(() => {
            onAutoFinish?.(maxSeconds);
          }, 0);
          return maxSeconds;
        }

        return next;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [
    finished,
    maxSeconds,
    onAutoFinish,
    paused,
    started,
  ]);

  return [elapsed, setElapsed];
}

export default function WodProtocolPlayer({
  block,
  initialRuntime = null,
  onRuntimeChange,
}) {
  const mechanic =
    mechanicFromBlock(block);
  const variant =
    variantFromBlock(block);
  const params =
    paramsFromBlock(block);
  const exercises =
    Array.isArray(block?.exercises)
      ? block.exercises
      : [];
  const durationMinutes =
    numberOr(
      block?.durationMinutes,
      10
    );

  const beepPlayer =
    useAudioPlayer(wodBeep);

  useEffect(() => {
    setAudioModeAsync({
      playsInSilentMode: true,
    }).catch((error) => {
      console.warn(
        'WOD audio mode',
        error
      );
    });
  }, []);

  const playBeep =
    useCallback(
      (count = 1) => {
        for (
          let index = 0;
          index < count;
          index += 1
        ) {
          setTimeout(() => {
            try {
              beepPlayer.seekTo(0);
              beepPlayer.play();
            } catch (error) {
              console.warn(
                'WOD beep',
                error
              );
            }
          }, index * 170);
        }
      },
      [beepPlayer]
    );

  const [started, setStarted] =
    useState(
      Boolean(initialRuntime?.started)
    );
  const [paused, setPaused] =
    useState(false);
  const [finished, setFinished] =
    useState(
      Boolean(initialRuntime?.finished)
    );
  const [finishReason, setFinishReason] =
    useState(
      initialRuntime?.finishReason ??
        null
    );
  const [completedRounds, setCompletedRounds] =
    useState(
      numberOr(
        initialRuntime?.completedRounds,
        0
      )
    );
  const [manualStep, setManualStep] =
    useState(
      Math.max(
        1,
        numberOr(
          initialRuntime?.manualStep,
          1
        )
      )
    );
  const [currentItemIndex, setCurrentItemIndex] =
    useState(
      Math.max(
        0,
        numberOr(
          initialRuntime?.currentItemIndex,
          0
        )
      )
    );
  const [restRemaining, setRestRemaining] =
    useState(0);

  const totalSeconds =
    useMemo(
      () =>
        totalSecondsForMechanic({
          mechanic,
          params,
          durationMinutes,
          exerciseCount:
            exercises.length,
        }),
      [
        durationMinutes,
        exercises.length,
        mechanic,
        params,
      ]
    );

  const handleAutoFinish =
    useCallback(() => {
      if (finished) {
        return;
      }

      setFinished(true);
      setPaused(false);

      if (mechanic === 'FOR_TIME') {
        setFinishReason('time_cap');
      } else if (
        mechanic ===
        'PROGRESSIVE_INTERVAL'
      ) {
        setFinishReason('time_cap');
      } else {
        setFinishReason('timer_complete');
      }

      playBeep(2);
      Vibration.vibrate([
        0,
        120,
        80,
        120,
      ]);
    }, [finished, mechanic, playBeep]);

  const [elapsed, setElapsed] =
    useSecondClock({
      started,
      paused,
      finished,
      maxSeconds: totalSeconds,
      initialElapsed:
        initialRuntime?.elapsedSeconds ??
        0,
      onAutoFinish:
        handleAutoFinish,
    });

  const lastPhaseKey = useRef(null);

  useEffect(() => {
    if (restRemaining <= 0) {
      return undefined;
    }

    const timer = setInterval(() => {
      setRestRemaining((current) => {
        if (current <= 1) {
          playBeep();
          Vibration.vibrate(70);
          return 0;
        }

        return current - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [playBeep, restRemaining > 0]);

  const derived = useMemo(() => {
    const interval = Math.max(
      1,
      numberOr(
        params.interval_seconds,
        60
      )
    );

    if (mechanic === 'EMOM') {
      const stationSeconds = Math.max(
        1,
        numberOr(
          params.station_seconds,
          60
        )
      );
      const minuteIndex = Math.floor(
        elapsed / stationSeconds
      );
      const stationElapsed =
        elapsed % stationSeconds;
      const exerciseIndex =
        minuteIndex %
        Math.max(1, exercises.length);

      return {
        phaseKey: `emom-${minuteIndex}`,
        currentExercise:
          exercises[exerciseIndex] ??
          null,
        nextExercise:
          exercises[
            (exerciseIndex + 1) %
              Math.max(
                1,
                exercises.length
              )
          ] ?? null,
        phaseRemaining:
          Math.max(
            0,
            stationSeconds -
              stationElapsed
          ),
        label: `MINUTE ${minuteIndex + 1}`,
      };
    }

    if (mechanic === 'HIIT') {
      const work = Math.max(
        1,
        numberOr(
          params.work_seconds,
          40
        )
      );
      const rest = Math.max(
        0,
        numberOr(
          params.rest_seconds,
          20
        )
      );
      const stationDuration =
        work + rest;
      const stationIndex =
        Math.floor(
          elapsed /
            Math.max(
              1,
              stationDuration
            )
        );
      const withinStation =
        elapsed %
        Math.max(
          1,
          stationDuration
        );
      const inWork =
        withinStation < work;
      const exerciseCount =
        Math.max(
          1,
          numberOr(
            params.exercise_count,
            exercises.length || 1
          )
        );
      const exerciseIndex =
        stationIndex %
        Math.max(
          1,
          exercises.length
        );
      const round =
        Math.floor(
          stationIndex /
            exerciseCount
        ) + 1;

      return {
        phaseKey: `hiit-${stationIndex}-${
          inWork ? 'work' : 'rest'
        }`,
        currentExercise:
          exercises[exerciseIndex] ??
          null,
        nextExercise:
          exercises[
            (exerciseIndex + 1) %
              Math.max(
                1,
                exercises.length
              )
          ] ?? null,
        phaseRemaining: inWork
          ? Math.max(
              0,
              work - withinStation
            )
          : Math.max(
              0,
              stationDuration -
                withinStation
            ),
        phaseDuration: inWork
          ? work
          : Math.max(1, rest),
        phase: inWork
          ? 'EFFORT'
          : 'REPOS',
        round,
      };
    }

    if (mechanic === 'ODD_EVEN') {
      const stationSeconds = Math.max(
        1,
        numberOr(
          params.station_seconds,
          60
        )
      );
      const minuteIndex = Math.floor(
        elapsed / stationSeconds
      );
      const odd =
        (minuteIndex + 1) % 2 === 1;
      const exerciseIndex = odd
        ? Math.max(
            0,
            numberOr(
              params.odd_position,
              1
            ) - 1
          )
        : Math.max(
            0,
            numberOr(
              params.even_position,
              2
            ) - 1
          );

      return {
        phaseKey: `odd-even-${minuteIndex}`,
        currentExercise:
          exercises[exerciseIndex] ??
          exercises[0] ??
          null,
        phaseRemaining:
          Math.max(
            0,
            stationSeconds -
              (elapsed % stationSeconds)
          ),
        label: `MINUTE ${minuteIndex + 1} · ${
          odd ? 'IMPAIRE' : 'PAIRE'
        }`,
      };
    }

    if (
      mechanic ===
      'EVERY_X_MINUTES'
    ) {
      const cycleIndex = Math.floor(
        elapsed / interval
      );

      return {
        phaseKey: `every-${cycleIndex}`,
        phaseRemaining:
          Math.max(
            0,
            interval -
              (elapsed % interval)
          ),
        label: `CYCLE ${
          cycleIndex + 1
        } / ${Math.max(
          1,
          numberOr(
            params.cycles,
            1
          )
        )}`,
      };
    }

    if (
      mechanic ===
      'PROGRESSIVE_INTERVAL'
    ) {
      const stage =
        Math.floor(
          Math.max(0, elapsed - 1) /
            interval
        ) + 1;

      return {
        phaseKey: `progressive-${stage}`,
        stage,
        phaseRemaining:
          Math.max(
            0,
            interval -
              (elapsed % interval)
          ),
      };
    }

    return {};
  }, [
    elapsed,
    exercises,
    mechanic,
    params,
  ]);

  useEffect(() => {
    if (
      !started ||
      finished ||
      !derived.phaseKey
    ) {
      return;
    }

    if (
      lastPhaseKey.current ===
      derived.phaseKey
    ) {
      return;
    }

    if (lastPhaseKey.current != null) {
      playBeep();
      Vibration.vibrate(70);
    }

    lastPhaseKey.current =
      derived.phaseKey;
  }, [
    derived.phaseKey,
    finished,
    playBeep,
    started,
  ]);

  useEffect(() => {
    if (
      !started ||
      paused ||
      finished
    ) {
      return;
    }

    const remaining =
      derived.phaseRemaining ??
      (totalSeconds != null
        ? totalSeconds - elapsed
        : null);

    if (
      remaining != null &&
      remaining > 0 &&
      remaining <= 3
    ) {
      playBeep();
      Vibration.vibrate(30);
    }
  }, [
    derived.phaseRemaining,
    elapsed,
    finished,
    paused,
    playBeep,
    started,
    totalSeconds,
  ]);

  const runtime = useMemo(
    () => ({
      version:
        'fc5-wod-player-v1',
      mechanic,
      variant:
        variant || null,
      started,
      paused,
      finished,
      finishReason,
      elapsedSeconds: elapsed,
      completedRounds,
      manualStep,
      currentItemIndex,
      currentStage:
        derived.stage ?? null,
      phase:
        derived.phase ?? null,
      phaseRemainingSeconds:
        derived.phaseRemaining ??
        null,
      parameters: params,
    }),
    [
      completedRounds,
      currentItemIndex,
      derived.phase,
      derived.phaseRemaining,
      derived.stage,
      elapsed,
      finishReason,
      finished,
      manualStep,
      mechanic,
      params,
      paused,
      started,
      variant,
    ]
  );

  useEffect(() => {
    onRuntimeChange?.(runtime);
  }, [onRuntimeChange, runtime]);

  function start() {
    if (finished) {
      return;
    }

    setStarted(true);
    setPaused(false);
    setFinishReason(null);
    playBeep();
    Vibration.vibrate(60);
  }

  function togglePause() {
    if (!started || finished) {
      return;
    }

    setPaused((value) => !value);
  }

  function finishManually(reason = 'completed') {
    setFinished(true);
    setPaused(false);
    setFinishReason(reason);
    playBeep(2);
    Vibration.vibrate([
      0,
      100,
      60,
      100,
    ]);
  }

  function completeRound() {
    const next =
      completedRounds + 1;

    setCompletedRounds(next);

    const target =
      params.rounds != null
        ? Math.max(
            1,
            numberOr(
              params.rounds,
              1
            )
          )
        : null;

    if (
      mechanic !== 'AMRAP' &&
      target != null &&
      next >= target
    ) {
      finishManually('rounds_complete');
      return;
    }

    const rest = Math.max(
      0,
      numberOr(
        params.rest_between_rounds_seconds,
        0
      )
    );

    if (rest > 0) {
      setRestRemaining(rest);
      Vibration.vibrate(60);
    }
  }

  function completeManualStep(maxSteps) {
    if (manualStep >= maxSteps) {
      finishManually('steps_complete');
      return;
    }

    setManualStep(
      (value) => value + 1
    );
  }

  function completeCurrentItem() {
    if (
      currentItemIndex >=
      exercises.length - 1
    ) {
      finishManually('sequence_complete');
      return;
    }

    setCurrentItemIndex(
      (value) => value + 1
    );
  }

  if (!mechanic) {
    return (
      <GenericProtocolCard
        title="WOD"
        subtitle="Le protocole est prêt. Suis les prescriptions affichées ci-dessous."
      />
    );
  }

  const timedMechanics = new Set([
    'AMRAP',
    'EMOM',
    'FOR_TIME',
    'HIIT',
    'ODD_EVEN',
    'EVERY_X_MINUTES',
    'PROGRESSIVE_INTERVAL',
  ]);

  const showStart =
    !started && !finished;

  return (
    <View style={styles.playerCard}>
      <View style={styles.playerHeader}>
        <View style={styles.playerHeaderMain}>
          <Text style={styles.playerEyebrow}>
            PLAYER UGEROD
          </Text>
          <Text style={styles.playerTitle}>
            {playerTitle(mechanic, variant)}
          </Text>
          <Text style={styles.playerSubtitle}>
            {block?.structure ??
              block?.source?.structure ??
              'Protocole compilé par UGEROD'}
          </Text>
        </View>

        {started && !finished ? (
          <Pressable
            onPress={togglePause}
            style={styles.pauseButton}
          >
            <Ionicons
              name={paused ? 'play' : 'pause'}
              size={18}
              color={colors.textPrimary}
            />
          </Pressable>
        ) : null}
      </View>

      {showStart ? (
        <StartPanel
          mechanic={mechanic}
          exercises={exercises}
          onStart={start}
        />
      ) : null}

      {started && !finished ? (
        <>
          {timedMechanics.has(mechanic) ? (
            <TimedProtocol
              mechanic={mechanic}
              variant={variant}
              params={params}
              exercises={exercises}
              elapsed={elapsed}
              totalSeconds={totalSeconds}
              derived={derived}
              completedRounds={completedRounds}
              onRoundComplete={
                completeRound
              }
              onFailure={() =>
                finishManually(
                  'observed_failure'
                )
              }
            />
          ) : null}

          {mechanic === 'CIRCUIT' ? (
            <CircuitProtocol
              params={params}
              exercises={exercises}
              completedRounds={
                completedRounds
              }
              restRemaining={
                restRemaining
              }
              onRoundComplete={
                completeRound
              }
            />
          ) : null}

          {mechanic === 'LADDER' ||
          mechanic === 'COUPLET' ? (
            <ProgressionProtocol
              mechanic={mechanic}
              variant={variant}
              params={params}
              exercises={exercises}
              step={manualStep}
              onCompleteStep={() =>
                completeManualStep(
                  Math.max(
                    1,
                    numberOr(
                      params.rungs,
                      1
                    )
                  )
                )
              }
            />
          ) : null}

          {mechanic === 'PYRAMID' ? (
            <PyramidProtocol
              params={params}
              exercises={exercises}
              step={manualStep}
              onCompleteStep={() => {
                const multipliers =
                  Array.isArray(
                    params.multipliers
                  )
                    ? params.multipliers
                    : [1, 2, 3, 2, 1];
                const cycles = Math.max(
                  1,
                  numberOr(
                    params.cycles,
                    1
                  )
                );

                completeManualStep(
                  multipliers.length *
                    cycles
                );
              }}
            />
          ) : null}

          {mechanic === 'CHIPPER' ||
          mechanic === 'REP_TARGET' ? (
            <SequenceProtocol
              mechanic={mechanic}
              params={params}
              exercises={exercises}
              currentItemIndex={
                currentItemIndex
              }
              onCompleteItem={
                completeCurrentItem
              }
            />
          ) : null}

          {mechanic === 'DECK' ? (
            <DeckProtocol
              params={params}
              exercises={exercises}
              currentCardIndex={
                currentItemIndex
              }
              onNextCard={() => {
                const deck =
                  Array.isArray(
                    params.deck_order
                  )
                    ? params.deck_order
                    : [];

                if (
                  currentItemIndex >=
                  deck.length - 1
                ) {
                  finishManually(
                    'deck_complete'
                  );
                } else {
                  setCurrentItemIndex(
                    (value) =>
                      value + 1
                  );
                }
              }}
            />
          ) : null}

          {mechanic === 'STRENGTH' || mechanic === 'SETS_REPS' ? (
            <StrengthProtocol
              params={params}
              exercises={exercises}
              step={manualStep}
              restRemaining={
                restRemaining
              }
              onCompleteSet={() => {
                const sets = Math.max(
                  1,
                  numberOr(
                    params.sets,
                    1
                  )
                );
                const total =
                  sets *
                  Math.max(
                    1,
                    exercises.length
                  );

                if (manualStep >= total) {
                  finishManually(
                    'sets_complete'
                  );
                } else {
                  setManualStep(
                    (value) =>
                      value + 1
                  );
                  setRestRemaining(
                    Math.max(
                      0,
                      numberOr(
                        params.rest_between_exercises_seconds,
                        0
                      )
                    )
                  );
                }
              }}
            />
          ) : null}
        </>
      ) : null}

      {finished ? (
        <FinishedPanel
          mechanic={mechanic}
          elapsed={elapsed}
          finishReason={finishReason}
          completedRounds={
            completedRounds
          }
          manualStep={manualStep}
        />
      ) : null}
    </View>
  );
}

function playerTitle(mechanic, variant) {
  if (
    mechanic === 'PROGRESSIVE_INTERVAL' &&
    variant === 'DEATH_BY'
  ) {
    return 'DEATH BY';
  }

  if (
    mechanic === 'PROGRESSIVE_INTERVAL' &&
    variant === 'DEATH_BY_COUPLET'
  ) {
    return 'DEATH BY COUPLET';
  }

  if (
    mechanic === 'COUPLET' &&
    variant === 'ASCENDING_COUPLET'
  ) {
    return 'COUPLET ASCENDANT';
  }

  if (
    mechanic === 'COUPLET' &&
    variant === 'DESCENDING_COUPLET'
  ) {
    return 'COUPLET DESCENDANT';
  }

  const labels = {
    AMRAP: 'AMRAP',
    EMOM: 'EMOM',
    FOR_TIME: 'FOR TIME',
    CIRCUIT: 'CIRCUIT',
    HIIT: 'HIIT',
    LADDER: 'LADDER',
    PYRAMID: 'PYRAMIDE',
    PROGRESSIVE_INTERVAL:
      'PROGRESSIF',
    ODD_EVEN: 'ODD / EVEN',
    EVERY_X_MINUTES:
      'EVERY X MIN',
    CHIPPER: 'CHIPPER',
    REP_TARGET: 'REP TARGET',
    COUPLET: 'COUPLET',
    DECK: 'DECK-STYLE',
    STRENGTH: 'MUSCULATION',
    SETS_REPS: 'S??RIES / REPS',
  };

  return (
    labels[mechanic] ??
    mechanic.replaceAll('_', ' ')
  );
}

function StartPanel({
  mechanic,
  exercises,
  onStart,
}) {
  return (
    <View style={styles.startPanel}>
      <View style={styles.startIcon}>
        <Ionicons
          name="flash-outline"
          size={24}
          color={colors.brandWhite}
        />
      </View>

      <Text style={styles.startTitle}>
        TON WOD EST PRÊT
      </Text>
      <Text style={styles.startText}>
        {exercises.length} exercice{exercises.length > 1 ? 's' : ''} · {playerTitle(mechanic)}. Le player suit le protocole décidé par UGEROD.
      </Text>

      <Pressable
        onPress={onStart}
        style={styles.primaryButton}
      >
        <Ionicons
          name="play"
          size={18}
          color={colors.brandWhite}
        />
        <Text style={styles.primaryButtonText}>
          DÉMARRER LE WOD
        </Text>
      </Pressable>
    </View>
  );
}

function TimedProtocol({
  mechanic,
  variant,
  params,
  exercises,
  elapsed,
  totalSeconds,
  derived,
  completedRounds,
  onRoundComplete,
  onFailure,
}) {
  if (mechanic === 'AMRAP') {
    const remaining = Math.max(
      0,
      numberOr(totalSeconds, 0) -
        elapsed
    );

    return (
      <>
        <ProtocolGauge
          value={remaining}
          total={totalSeconds}
          label="RESTANT"
          countDown
        />
        <MetricRow
          label="TOURS TERMINÉS"
          value={completedRounds}
        />
        <Pressable
          onPress={onRoundComplete}
          style={styles.primaryButton}
        >
          <Ionicons
            name="checkmark"
            size={18}
            color={colors.brandWhite}
          />
          <Text style={styles.primaryButtonText}>
            TOUR TERMINÉ
          </Text>
        </Pressable>
      </>
    );
  }

  if (mechanic === 'FOR_TIME') {
    const cap = Math.max(
      1,
      numberOr(totalSeconds, 1)
    );

    return (
      <>
        <ProtocolGauge
          value={elapsed}
          total={cap}
          label="CHRONO"
        />
        <View style={styles.dualMetricRow}>
          <MetricRow
            label="CAP"
            value={formatClock(cap)}
          />
          <MetricRow
            label="TOURS"
            value={completedRounds}
          />
        </View>
        <Pressable
          onPress={onRoundComplete}
          style={styles.primaryButton}
        >
          <Ionicons
            name="checkmark"
            size={18}
            color={colors.brandWhite}
          />
          <Text style={styles.primaryButtonText}>
            TOUR TERMINÉ
          </Text>
        </Pressable>
      </>
    );
  }

  if (mechanic === 'EMOM') {
    return (
      <>
        <ProtocolGauge
          value={
            derived.phaseRemaining ??
            0
          }
          total={
            numberOr(
              params.station_seconds,
              60
            )
          }
          label={derived.label ?? 'MINUTE'}
          countDown
        />
        <CurrentExerciseCard
          exercise={
            derived.currentExercise
          }
          nextExercise={
            derived.nextExercise
          }
          helper="Termine le travail. Le temps restant dans la minute sert à récupérer."
        />
      </>
    );
  }

  if (mechanic === 'HIIT') {
    return (
      <>
        <ProtocolGauge
          value={
            derived.phaseRemaining ??
            0
          }
          total={
            derived.phaseDuration ??
            1
          }
          label={
            derived.phase ?? 'EFFORT'
          }
          countDown
          alert={
            derived.phase === 'REPOS'
          }
        />
        <MetricRow
          label="TOUR"
          value={`${derived.round ?? 1} / ${Math.max(
            1,
            numberOr(params.rounds, 1)
          )}`}
        />
        <CurrentExerciseCard
          exercise={
            derived.currentExercise
          }
          nextExercise={
            derived.nextExercise
          }
          helper={
            derived.phase === 'REPOS'
              ? 'Récupère. UGEROD enchaîne automatiquement sur le prochain exercice.'
              : 'Travaille pendant tout l’intervalle en gardant une exécution propre.'
          }
        />
      </>
    );
  }

  if (mechanic === 'ODD_EVEN') {
    return (
      <>
        <ProtocolGauge
          value={
            derived.phaseRemaining ??
            0
          }
          total={
            numberOr(
              params.station_seconds,
              60
            )
          }
          label={derived.label ?? 'MINUTE'}
          countDown
        />
        <CurrentExerciseCard
          exercise={
            derived.currentExercise
          }
          helper="L’exercice change automatiquement à la minute suivante."
        />
      </>
    );
  }

  if (
    mechanic ===
    'EVERY_X_MINUTES'
  ) {
    return (
      <>
        <ProtocolGauge
          value={
            derived.phaseRemaining ??
            0
          }
          total={
            numberOr(
              params.interval_seconds,
              120
            )
          }
          label={derived.label ?? 'CYCLE'}
          countDown
        />
        <Text style={styles.protocolHint}>
          Réalise tout le travail ci-dessous puis récupère jusqu’au prochain départ.
        </Text>
      </>
    );
  }

  if (
    mechanic ===
    'PROGRESSIVE_INTERVAL'
  ) {
    const stage =
      derived.stage ?? 1;
    const direction =
      'ascending';

    return (
      <>
        <ProtocolGauge
          value={
            derived.phaseRemaining ??
            0
          }
          total={
            numberOr(
              params.interval_seconds,
              60
            )
          }
          label={`ÉTAPE ${stage}`}
          countDown
        />

        <StageExerciseList
          exercises={exercises}
          stage={stage}
          direction={direction}
        />

        <Text style={styles.protocolHint}>
          {variant === 'DEATH_BY' ||
          variant === 'DEATH_BY_COUPLET'
            ? 'Chaque intervalle augmente la dose. Arrête lorsque tu ne peux plus terminer la prescription dans le temps.'
            : 'La difficulté augmente à chaque intervalle selon le contrat UGEROD.'}
        </Text>

        <Pressable
          onPress={onFailure}
          style={styles.failureButton}
        >
          <Ionicons
            name="flag-outline"
            size={17}
            color={colors.brandRed}
          />
          <Text style={styles.failureButtonText}>
            ÉCHEC / ARRÊTER ICI
          </Text>
        </Pressable>
      </>
    );
  }

  return null;
}

function CircuitProtocol({
  params,
  exercises,
  completedRounds,
  restRemaining,
  onRoundComplete,
}) {
  const rounds = Math.max(
    1,
    numberOr(params.rounds, 1)
  );
  const currentRound = Math.min(
    rounds,
    completedRounds + 1
  );

  return (
    <>
      <BigMetric
        eyebrow="TOUR EN COURS"
        value={`${currentRound} / ${rounds}`}
      />

      {restRemaining > 0 ? (
        <ProtocolGauge
          value={restRemaining}
          total={Math.max(
            1,
            numberOr(
              params.rest_between_rounds_seconds,
              restRemaining
            )
          )}
          label="REPOS"
          countDown
          alert
        />
      ) : (
        <Text style={styles.protocolHint}>
          Enchaîne les {exercises.length} exercices dans l’ordre puis valide le tour complet.
        </Text>
      )}

      <Pressable
        onPress={onRoundComplete}
        disabled={restRemaining > 0}
        style={[
          styles.primaryButton,
          restRemaining > 0 &&
            styles.buttonDisabled,
        ]}
      >
        <Ionicons
          name="checkmark"
          size={18}
          color={colors.brandWhite}
        />
        <Text style={styles.primaryButtonText}>
          TOUR TERMINÉ
        </Text>
      </Pressable>
    </>
  );
}

function ProgressionProtocol({
  mechanic,
  variant,
  params,
  exercises,
  step,
  onCompleteStep,
}) {
  const rungs = Math.max(
    1,
    numberOr(params.rungs, 1)
  );
  const descending =
    variant === 'DESCENDING_COUPLET' ||
    params.sequence_direction ===
      'descending';

  return (
    <>
      <BigMetric
        eyebrow="ÉTAPE"
        value={`${step} / ${rungs}`}
      />

      <StageExerciseList
        exercises={exercises}
        stage={step}
        direction={
          descending
            ? 'descending'
            : 'ascending'
        }
      />

      <Pressable
        onPress={onCompleteStep}
        style={styles.primaryButton}
      >
        <Ionicons
          name="arrow-forward"
          size={18}
          color={colors.brandWhite}
        />
        <Text style={styles.primaryButtonText}>
          {step >= rungs
            ? 'TERMINER LE PROTOCOLE'
            : 'ÉTAPE TERMINÉE'}
        </Text>
      </Pressable>
    </>
  );
}

function PyramidProtocol({
  params,
  exercises,
  step,
  onCompleteStep,
}) {
  const multipliers =
    Array.isArray(params.multipliers) &&
    params.multipliers.length > 0
      ? params.multipliers.map((value) =>
          numberOr(value, 1)
        )
      : [1, 2, 3, 2, 1];
  const cycles = Math.max(
    1,
    numberOr(params.cycles, 1)
  );
  const totalSteps =
    multipliers.length * cycles;
  const index =
    (step - 1) %
    multipliers.length;
  const cycle =
    Math.floor(
      (step - 1) /
        multipliers.length
    ) + 1;
  const multiplier =
    multipliers[index];

  return (
    <>
      <BigMetric
        eyebrow={`CYCLE ${cycle} / ${cycles}`}
        value={`${step} / ${totalSteps}`}
      />

      <View style={styles.sequenceStrip}>
        {multipliers.map((value, idx) => (
          <View
            key={`${idx}-${value}`}
            style={[
              styles.sequenceItem,
              idx === index &&
                styles.sequenceItemActive,
            ]}
          >
            <Text
              style={[
                styles.sequenceItemText,
                idx === index &&
                  styles.sequenceItemTextActive,
              ]}
            >
              ×{value}
            </Text>
          </View>
        ))}
      </View>

      <View style={styles.stageList}>
        {exercises.map((exercise) => (
          <View
            key={exercise._uiKey ?? exercise.id}
            style={styles.stageRow}
          >
            <Text style={styles.stageName}>
              {String(exercise.name).toUpperCase()}
            </Text>
            <Text style={styles.stageReps}>
              {pyramidReps(
                exercise,
                multiplier
              )} REPS
            </Text>
          </View>
        ))}
      </View>

      <Pressable
        onPress={onCompleteStep}
        style={styles.primaryButton}
      >
        <Ionicons
          name="arrow-forward"
          size={18}
          color={colors.brandWhite}
        />
        <Text style={styles.primaryButtonText}>
          {step >= totalSteps
            ? 'TERMINER LE PROTOCOLE'
            : 'ÉTAPE TERMINÉE'}
        </Text>
      </Pressable>
    </>
  );
}

function SequenceProtocol({
  mechanic,
  params,
  exercises,
  currentItemIndex,
  onCompleteItem,
}) {
  const current =
    exercises[currentItemIndex] ??
    exercises[0] ??
    null;
  const totalTarget =
    numberOr(
      params.total_rep_target,
      0
    );
  const completedTarget =
    exercises
      .slice(0, currentItemIndex)
      .reduce(
        (sum, exercise) =>
          sum +
          numberOr(
            exercise?.prescriptionJson?.reps_max ??
              exercise?.prescriptionJson?.reps_min,
            0
          ),
        0
      );

  return (
    <>
      <BigMetric
        eyebrow={
          mechanic === 'REP_TARGET'
            ? 'OBJECTIF REPS'
            : 'PROGRESSION'
        }
        value={
          mechanic === 'REP_TARGET' &&
          totalTarget > 0
            ? `${completedTarget} / ${totalTarget}`
            : `${Math.min(
                currentItemIndex + 1,
                exercises.length
              )} / ${exercises.length}`
        }
      />

      <CurrentExerciseCard
        exercise={current}
        helper={
          mechanic === 'CHIPPER'
            ? 'Termine complètement cet exercice avant de passer au suivant.'
            : 'Atteins la cible prévue pour cet exercice avant de continuer.'
        }
      />

      <Pressable
        onPress={onCompleteItem}
        style={styles.primaryButton}
      >
        <Ionicons
          name="checkmark"
          size={18}
          color={colors.brandWhite}
        />
        <Text style={styles.primaryButtonText}>
          {currentItemIndex >=
          exercises.length - 1
            ? 'TERMINER LE WOD'
            : 'EXERCICE TERMINÉ'}
        </Text>
      </Pressable>
    </>
  );
}

function DeckProtocol({
  params,
  exercises,
  currentCardIndex,
  onNextCard,
}) {
  const deck = Array.isArray(
    params.deck_order
  )
    ? params.deck_order
    : [];
  const card =
    deck[currentCardIndex] ?? null;

  if (!card) {
    return (
      <GenericProtocolCard
        title="DECK-STYLE"
        subtitle="Le paquet n’est pas disponible. UGEROD doit fournir un ordre de cartes avant l’exécution."
      />
    );
  }

  const suitIndex = Math.max(
    1,
    numberOr(card.suit_index, 1)
  );
  const exercise =
    exercises[suitIndex - 1] ??
    exercises[0] ?? null;
  const symbols = ['♠', '♥', '♦', '♣'];
  const symbol =
    symbols[suitIndex - 1] ?? '•';

  return (
    <>
      <Text style={styles.deckProgress}>
        CARTE {currentCardIndex + 1} / {deck.length}
      </Text>

      <View style={styles.deckCard}>
        <Text style={styles.deckRank}>
          {symbol} {card.rank}
        </Text>
        <Text style={styles.deckExercise}>
          {String(
            exercise?.name ??
              'EXERCICE'
          ).toUpperCase()}
        </Text>
        <Text style={styles.deckReps}>
          {numberOr(card.reps, 1)} REPS
        </Text>
      </View>

      <Pressable
        onPress={onNextCard}
        style={styles.primaryButton}
      >
        <Ionicons
          name="layers-outline"
          size={18}
          color={colors.brandWhite}
        />
        <Text style={styles.primaryButtonText}>
          {currentCardIndex >=
          deck.length - 1
            ? 'TERMINER LE DECK'
            : 'CARTE SUIVANTE'}
        </Text>
      </Pressable>
    </>
  );
}

function StrengthProtocol({
  params,
  exercises,
  step,
  restRemaining,
  onCompleteSet,
}) {
  const sets = Math.max(
    1,
    numberOr(params.sets, 1)
  );
  const exerciseCount = Math.max(
    1,
    exercises.length
  );
  const exerciseIndex =
    (step - 1) % exerciseCount;
  const setNumber =
    Math.floor(
      (step - 1) /
        exerciseCount
    ) + 1;
  const current =
    exercises[exerciseIndex] ??
    exercises[0] ?? null;

  return (
    <>
      <BigMetric
        eyebrow="SÉRIE"
        value={`${Math.min(
          setNumber,
          sets
        )} / ${sets}`}
      />

      {restRemaining > 0 ? (
        <ProtocolGauge
          value={restRemaining}
          total={Math.max(
            1,
            numberOr(
              params.rest_between_exercises_seconds,
              restRemaining
            )
          )}
          label="REPOS"
          countDown
          alert
        />
      ) : (
        <CurrentExerciseCard
          exercise={current}
          helper="Réalise la série avec la charge et le RPE prescrits."
        />
      )}

      <Pressable
        onPress={onCompleteSet}
        disabled={restRemaining > 0}
        style={[
          styles.primaryButton,
          restRemaining > 0 &&
            styles.buttonDisabled,
        ]}
      >
        <Ionicons
          name="checkmark"
          size={18}
          color={colors.brandWhite}
        />
        <Text style={styles.primaryButtonText}>
          SÉRIE TERMINÉE
        </Text>
      </Pressable>
    </>
  );
}

function StageExerciseList({
  exercises,
  stage,
  direction,
}) {
  return (
    <View style={styles.stageList}>
      {exercises.map((exercise) => (
        <View
          key={exercise._uiKey ?? exercise.id}
          style={styles.stageRow}
        >
          <Text style={styles.stageName}>
            {String(exercise.name).toUpperCase()}
          </Text>
          <Text style={styles.stageReps}>
            {repsForStage(
              exercise,
              stage,
              direction
            )} REPS
          </Text>
        </View>
      ))}
    </View>
  );
}

function CurrentExerciseCard({
  exercise,
  nextExercise = null,
  helper,
}) {
  if (!exercise) {
    return null;
  }

  return (
    <View style={styles.currentCard}>
      <Text style={styles.currentLabel}>
        EXERCICE ACTUEL
      </Text>
      <Text style={styles.currentName}>
        {String(exercise.name).toUpperCase()}
      </Text>
      <Text style={styles.currentPrescription}>
        {exercise.prescription}
      </Text>

      {helper ? (
        <Text style={styles.currentHelper}>
          {helper}
        </Text>
      ) : null}

      {nextExercise ? (
        <Text style={styles.nextExercise}>
          SUIVANT · {String(
            nextExercise.name
          ).toUpperCase()}
        </Text>
      ) : null}
    </View>
  );
}

function MetricRow({ label, value }) {
  return (
    <View style={styles.metricCard}>
      <Text style={styles.metricLabel}>
        {label}
      </Text>
      <Text style={styles.metricValue}>
        {value}
      </Text>
    </View>
  );
}

function BigMetric({ eyebrow, value }) {
  return (
    <View style={styles.bigMetric}>
      <Text style={styles.bigMetricLabel}>
        {eyebrow}
      </Text>
      <Text style={styles.bigMetricValue}>
        {value}
      </Text>
    </View>
  );
}

function ProtocolGauge({
  value,
  total,
  label,
  countDown = false,
  alert = false,
}) {
  const safeTotal = Math.max(
    1,
    numberOr(total, 1)
  );
  const safeValue = Math.max(
    0,
    numberOr(value, 0)
  );
  const ratio = Math.max(
    0,
    Math.min(
      1,
      countDown
        ? safeValue / safeTotal
        : safeValue / safeTotal
    )
  );
  const segmentCount = 32;
  const activeCount = Math.ceil(
    ratio * segmentCount
  );
  const radius = 78;

  return (
    <View style={styles.gaugeWrap}>
      <View style={styles.gaugeRing}>
        {Array.from(
          { length: segmentCount },
          (_, index) => {
            const active =
              countDown
                ? index < activeCount
                : index < activeCount;

            return (
              <View
                key={index}
                style={[
                  styles.gaugeSegment,
                  {
                    opacity: active
                      ? 1
                      : 0.13,
                    backgroundColor:
                      alert
                        ? colors.brandWhite
                        : colors.primaryLight,
                    transform: [
                      {
                        rotate: `${
                          index *
                          (360 / segmentCount)
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
          <Text style={styles.gaugeLabel}>
            {label}
          </Text>
          <Text style={styles.gaugeValue}>
            {formatClock(safeValue)}
          </Text>
        </View>
      </View>
    </View>
  );
}

function FinishedPanel({
  mechanic,
  elapsed,
  finishReason,
  completedRounds,
  manualStep,
}) {
  return (
    <View style={styles.finishedPanel}>
      <View style={styles.finishedIcon}>
        <Ionicons
          name="checkmark"
          size={25}
          color={colors.brandWhite}
        />
      </View>
      <Text style={styles.finishedTitle}>
        PROTOCOLE TERMINÉ
      </Text>
      <Text style={styles.finishedText}>
        {playerTitle(mechanic)} · {formatClock(elapsed)}
      </Text>
      {completedRounds > 0 ? (
        <Text style={styles.finishedMeta}>
          {completedRounds} tour{completedRounds > 1 ? 's' : ''} enregistré{completedRounds > 1 ? 's' : ''}
        </Text>
      ) : null}
      {finishReason ===
      'observed_failure' ? (
        <Text style={styles.finishedWarning}>
          Échec enregistré à l’étape {manualStep}. Les reps partielles seront précisées dans le suivi protocolaire.
        </Text>
      ) : null}
    </View>
  );
}

function GenericProtocolCard({
  title,
  subtitle,
}) {
  return (
    <View style={styles.genericCard}>
      <Text style={styles.genericTitle}>
        {title}
      </Text>
      <Text style={styles.genericText}>
        {subtitle}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  playerCard: {
    marginBottom: 18,
    borderRadius: 20,
    padding: 17,
    backgroundColor:
      'rgba(7,10,14,0.94)',
    borderWidth: 1,
    borderColor:
      'rgba(8,104,255,0.30)',
  },
  playerHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  playerHeaderMain: {
    flex: 1,
  },
  playerEyebrow: {
    fontFamily:
      'Oswald_700Bold',
    fontSize: 9,
    letterSpacing: 0.9,
    color: colors.primaryLight,
  },
  playerTitle: {
    fontFamily:
      'BebasNeue_400Regular',
    fontSize: 31,
    lineHeight: 34,
    letterSpacing: 1.4,
    color: colors.textPrimary,
    marginTop: 2,
  },
  playerSubtitle: {
    fontFamily:
      'Oswald_400Regular',
    fontSize: 11,
    lineHeight: 17,
    color: colors.textSecondary,
    marginTop: 3,
  },
  pauseButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor:
      'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor:
      'rgba(255,255,255,0.10)',
  },
  startPanel: {
    marginTop: 18,
    alignItems: 'center',
    borderRadius: 16,
    padding: 17,
    backgroundColor:
      'rgba(8,104,255,0.08)',
    borderWidth: 1,
    borderColor:
      'rgba(8,104,255,0.22)',
  },
  startIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  startTitle: {
    fontFamily:
      'BebasNeue_400Regular',
    fontSize: 25,
    lineHeight: 28,
    letterSpacing: 1.1,
    color: colors.textPrimary,
    marginTop: 10,
  },
  startText: {
    maxWidth: 320,
    fontFamily:
      'Oswald_400Regular',
    fontSize: 11,
    lineHeight: 17,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: 3,
  },
  primaryButton: {
    minHeight: 48,
    marginTop: 15,
    borderRadius: 13,
    backgroundColor: colors.primary,
    paddingHorizontal: 17,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  primaryButtonText: {
    fontFamily:
      'Oswald_700Bold',
    fontSize: 11,
    letterSpacing: 0.75,
    color: colors.brandWhite,
  },
  buttonDisabled: {
    opacity: 0.35,
  },
  gaugeWrap: {
    marginTop: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gaugeRing: {
    width: 194,
    height: 194,
    borderRadius: 97,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gaugeSegment: {
    position: 'absolute',
    left: 94.5,
    top: 90,
    width: 5,
    height: 14,
    borderRadius: 3,
  },
  gaugeCenter: {
    width: 136,
    height: 136,
    borderRadius: 68,
    backgroundColor:
      'rgba(17,21,26,0.96)',
    borderWidth: 1,
    borderColor:
      'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  gaugeLabel: {
    fontFamily:
      'Oswald_700Bold',
    fontSize: 9,
    letterSpacing: 0.8,
    color: colors.primaryLight,
  },
  gaugeValue: {
    fontFamily:
      'BebasNeue_400Regular',
    fontSize: 50,
    lineHeight: 54,
    color: colors.textPrimary,
    marginTop: 2,
  },
  currentCard: {
    marginTop: 13,
    borderRadius: 15,
    padding: 14,
    backgroundColor:
      'rgba(255,255,255,0.035)',
    borderWidth: 1,
    borderColor:
      'rgba(255,255,255,0.07)',
  },
  currentLabel: {
    fontFamily:
      'Oswald_700Bold',
    fontSize: 8,
    letterSpacing: 0.8,
    color: colors.primaryLight,
  },
  currentName: {
    fontFamily:
      'BebasNeue_400Regular',
    fontSize: 25,
    lineHeight: 28,
    letterSpacing: 1,
    color: colors.textPrimary,
    marginTop: 3,
  },
  currentPrescription: {
    fontFamily:
      'Oswald_600SemiBold',
    fontSize: 12,
    lineHeight: 17,
    color: colors.textPrimary,
    marginTop: 2,
  },
  currentHelper: {
    fontFamily:
      'Oswald_400Regular',
    fontSize: 10,
    lineHeight: 16,
    color: colors.textSecondary,
    marginTop: 7,
  },
  nextExercise: {
    fontFamily:
      'Oswald_600SemiBold',
    fontSize: 9,
    letterSpacing: 0.5,
    color: colors.textMuted,
    marginTop: 9,
  },
  metricCard: {
    flex: 1,
    marginTop: 11,
    borderRadius: 12,
    padding: 11,
    backgroundColor:
      'rgba(255,255,255,0.035)',
    borderWidth: 1,
    borderColor:
      'rgba(255,255,255,0.06)',
  },
  metricLabel: {
    fontFamily:
      'Oswald_700Bold',
    fontSize: 8,
    letterSpacing: 0.65,
    color: colors.textMuted,
  },
  metricValue: {
    fontFamily:
      'BebasNeue_400Regular',
    fontSize: 26,
    lineHeight: 29,
    color: colors.textPrimary,
    marginTop: 2,
  },
  dualMetricRow: {
    flexDirection: 'row',
    gap: 9,
  },
  bigMetric: {
    marginTop: 17,
    alignItems: 'center',
  },
  bigMetricLabel: {
    fontFamily:
      'Oswald_700Bold',
    fontSize: 9,
    letterSpacing: 0.8,
    color: colors.textMuted,
  },
  bigMetricValue: {
    fontFamily:
      'BebasNeue_400Regular',
    fontSize: 44,
    lineHeight: 48,
    color: colors.textPrimary,
    marginTop: 2,
  },
  protocolHint: {
    fontFamily:
      'Oswald_400Regular',
    fontSize: 11,
    lineHeight: 17,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: 12,
  },
  stageList: {
    marginTop: 14,
    gap: 8,
  },
  stageRow: {
    minHeight: 46,
    borderRadius: 12,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    backgroundColor:
      'rgba(255,255,255,0.035)',
    borderWidth: 1,
    borderColor:
      'rgba(255,255,255,0.06)',
  },
  stageName: {
    flex: 1,
    fontFamily:
      'Oswald_600SemiBold',
    fontSize: 11,
    color: colors.textPrimary,
  },
  stageReps: {
    fontFamily:
      'BebasNeue_400Regular',
    fontSize: 20,
    color: colors.primaryLight,
  },
  failureButton: {
    minHeight: 44,
    marginTop: 13,
    borderRadius: 12,
    borderWidth: 1,
    borderColor:
      'rgba(227,27,35,0.34)',
    backgroundColor:
      'rgba(227,27,35,0.07)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  failureButtonText: {
    fontFamily:
      'Oswald_700Bold',
    fontSize: 10,
    letterSpacing: 0.6,
    color: colors.brandRed,
  },
  sequenceStrip: {
    marginTop: 12,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
  },
  sequenceItem: {
    minWidth: 36,
    height: 34,
    borderRadius: 9,
    borderWidth: 1,
    borderColor:
      'rgba(255,255,255,0.08)',
    backgroundColor:
      'rgba(255,255,255,0.025)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sequenceItemActive: {
    borderColor:
      'rgba(8,104,255,0.5)',
    backgroundColor:
      'rgba(8,104,255,0.16)',
  },
  sequenceItemText: {
    fontFamily:
      'Oswald_600SemiBold',
    fontSize: 10,
    color: colors.textMuted,
  },
  sequenceItemTextActive: {
    color: colors.primaryLight,
  },
  deckProgress: {
    marginTop: 17,
    textAlign: 'center',
    fontFamily:
      'Oswald_700Bold',
    fontSize: 9,
    letterSpacing: 0.8,
    color: colors.textMuted,
  },
  deckCard: {
    width: 168,
    minHeight: 215,
    alignSelf: 'center',
    marginTop: 11,
    borderRadius: 18,
    backgroundColor:
      'rgba(255,255,255,0.94)',
    padding: 17,
    justifyContent: 'space-between',
  },
  deckRank: {
    fontFamily:
      'BebasNeue_400Regular',
    fontSize: 40,
    color: '#11151A',
  },
  deckExercise: {
    fontFamily:
      'Oswald_700Bold',
    fontSize: 14,
    lineHeight: 19,
    color: '#11151A',
    textAlign: 'center',
  },
  deckReps: {
    fontFamily:
      'BebasNeue_400Regular',
    fontSize: 28,
    color: '#0868FF',
    textAlign: 'right',
  },
  finishedPanel: {
    marginTop: 18,
    alignItems: 'center',
    borderRadius: 16,
    padding: 17,
    backgroundColor:
      'rgba(8,104,255,0.09)',
    borderWidth: 1,
    borderColor:
      'rgba(8,104,255,0.27)',
  },
  finishedIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  finishedTitle: {
    fontFamily:
      'BebasNeue_400Regular',
    fontSize: 25,
    lineHeight: 28,
    letterSpacing: 1.1,
    color: colors.textPrimary,
    marginTop: 9,
  },
  finishedText: {
    fontFamily:
      'Oswald_600SemiBold',
    fontSize: 11,
    color: colors.primaryLight,
    marginTop: 2,
  },
  finishedMeta: {
    fontFamily:
      'Oswald_400Regular',
    fontSize: 10,
    color: colors.textSecondary,
    marginTop: 5,
  },
  finishedWarning: {
    fontFamily:
      'Oswald_400Regular',
    fontSize: 10,
    lineHeight: 16,
    color: colors.brandRed,
    textAlign: 'center',
    marginTop: 8,
  },
  genericCard: {
    marginTop: 14,
    borderRadius: 14,
    padding: 14,
    backgroundColor:
      'rgba(255,255,255,0.03)',
    borderWidth: 1,
    borderColor:
      'rgba(255,255,255,0.07)',
  },
  genericTitle: {
    fontFamily:
      'Oswald_700Bold',
    fontSize: 12,
    color: colors.textPrimary,
  },
  genericText: {
    fontFamily:
      'Oswald_400Regular',
    fontSize: 10,
    lineHeight: 16,
    color: colors.textSecondary,
    marginTop: 4,
  },
});