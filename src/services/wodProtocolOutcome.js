function normalizeMechanic(value) {
  return String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/[\s/-]+/g, '_');
}

function numberOr(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function numberOrNull(value) {
  if (value == null || value === '') {
    return null;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, numberOr(value, 0)));
}

function isWodExercise(exercise) {
  return String(
    exercise?.blockKey ?? exercise?.block ?? ''
  ).toLowerCase() === 'wod';
}

function prescriptionFor(exercise) {
  return (
    exercise?.prescriptionJson ??
    exercise?.prescription_json ??
    {}
  );
}

function overlayFor(exercise) {
  return prescriptionFor(exercise)?.mechanic_overlay ?? {};
}

function exactRangeValue(prescription, minKey, maxKey) {
  const min = numberOrNull(prescription?.[minKey]);
  const max = numberOrNull(prescription?.[maxKey]);

  if (min != null && max != null && min === max) {
    return min;
  }

  return null;
}

function executionTargetValue(
  prescription,
  targetKey,
  minKey,
  maxKey
) {
  const explicit = numberOrNull(
    prescription?.[targetKey]
  );

  if (explicit != null) {
    return explicit;
  }

  return exactRangeValue(
    prescription,
    minKey,
    maxKey
  );
}

function exerciseKey(exercise) {
  return exercise?.sessionExerciseId ?? exercise?.id ?? null;
}

function ensureActual(actuals, exercise) {
  const key = exerciseKey(exercise);
  if (!key) {
    return null;
  }

  const current = actuals.get(key) ?? {
    session_exercise_id:
      exercise.sessionExerciseId ?? null,
    exercise_id: exercise.id ?? null,
    performance_source:
      'ugerod_protocol_player',
    performance_actual_version:
      'm7.2-v1',
  };

  actuals.set(key, current);
  return current;
}

function setNumeric(current, field, value) {
  const numeric = numberOrNull(value);
  if (numeric == null || numeric < 0) {
    return;
  }

  current[field] = numeric;
}

function addSessionTotals(
  actuals,
  exercise,
  {
    reps = null,
    durationSeconds = null,
    distanceMeters = null,
  } = {}
) {
  const current = ensureActual(actuals, exercise);
  if (!current) {
    return;
  }

  if (reps != null) {
    setNumeric(
      current,
      'session_total_reps',
      numberOr(current.session_total_reps, 0) + reps
    );
  }

  if (durationSeconds != null) {
    setNumeric(
      current,
      'session_total_duration_seconds',
      numberOr(
        current.session_total_duration_seconds,
        0
      ) + durationSeconds
    );
  }

  if (distanceMeters != null) {
    setNumeric(
      current,
      'session_total_distance_meters',
      numberOr(
        current.session_total_distance_meters,
        0
      ) + distanceMeters
    );
  }
}

function setCapabilityObservation(
  actuals,
  exercise,
  {
    reps = null,
    durationSeconds = null,
    distanceMeters = null,
    unit = null,
  } = {}
) {
  const current = ensureActual(actuals, exercise);
  if (!current) {
    return;
  }

  setNumeric(current, 'capability_reps', reps);
  setNumeric(
    current,
    'capability_duration_seconds',
    durationSeconds
  );
  setNumeric(
    current,
    'capability_distance_meters',
    distanceMeters
  );

  if (unit) {
    current.capability_observation_unit = unit;
  }
}

function mergeActualsIntoExercises(exercises, actuals) {
  return exercises.map((exercise) => {
    const actual = actuals.get(exerciseKey(exercise));

    if (!actual) {
      return exercise;
    }

    return {
      ...exercise,
      repsCompleted:
        exercise.repsCompleted ??
        exercise.reps_completed ??
        actual.session_total_reps ??
        null,
      durationSeconds:
        exercise.durationSeconds ??
        exercise.duration_seconds ??
        actual.session_total_duration_seconds ??
        null,
      distanceMeters:
        exercise.distanceMeters ??
        exercise.distance_meters ??
        actual.session_total_distance_meters ??
        null,
      performanceActualJson: {
        ...(exercise.performanceActualJson ?? {}),
        ...actual,
      },
    };
  });
}

function stageReps(
  exercise,
  stage,
  direction = 'ascending'
) {
  const overlay = overlayFor(exercise);
  const prescription = prescriptionFor(exercise);
  const start = numberOrNull(
    overlay.start_reps ??
      overlay.base_reps ??
      prescription.execution_target_reps
  );
  const increment = numberOrNull(
    overlay.increment_reps
  );

  if (start == null) {
    return null;
  }

  if (direction === 'descending') {
    const first = numberOrNull(
      overlay.first_stage_reps
    );

    if (first == null) {
      return null;
    }

    return Math.max(
      start,
      Math.round(
        first -
          Math.max(0, stage - 1) *
            (increment ?? 0)
      )
    );
  }

  return Math.max(
    0,
    Math.round(
      start +
        Math.max(0, stage - 1) *
          (increment ?? 0)
    )
  );
}

function pyramidStepReps(exercise, multiplier) {
  const prescription = prescriptionFor(exercise);
  const base = numberOrNull(
    overlayFor(exercise).base_reps ??
      prescription.execution_target_reps
  );

  if (base == null) {
    return null;
  }

  return Math.max(0, Math.round(base * multiplier));
}

function completedManualSteps(runtime, completedReason) {
  const current = Math.max(
    1,
    numberOr(runtime?.manualStep, 1)
  );

  return runtime?.finished &&
    runtime?.finishReason === completedReason
    ? current
    : Math.max(0, current - 1);
}

function derivePlannedSeconds(workout, runtime) {
  const fromRuntime = numberOrNull(
    runtime?.totalSeconds
  );

  if (fromRuntime != null) {
    return Math.max(0, fromRuntime);
  }

  const blockMinutes = numberOrNull(
    workout?.blocks?.wod?.duration ??
      workout?.blocks?.wod?.durationMinutes
  );

  return blockMinutes != null
    ? Math.max(0, blockMinutes * 60)
    : null;
}

function addExactRoundObservation(
  actuals,
  exercise,
  completedRounds,
  unit
) {
  if (completedRounds <= 0) {
    return;
  }

  const prescription = prescriptionFor(exercise);
  const reps = executionTargetValue(
    prescription,
    'execution_target_reps',
    'reps_min',
    'reps_max'
  );
  const duration = executionTargetValue(
    prescription,
    'execution_target_duration_seconds',
    'duration_seconds_min',
    'duration_seconds_max'
  );
  const distance = executionTargetValue(
    prescription,
    'execution_target_distance_meters',
    'distance_meters_min',
    'distance_meters_max'
  );

  addSessionTotals(actuals, exercise, {
    reps:
      reps == null
        ? null
        : reps * completedRounds,
    durationSeconds:
      duration == null
        ? null
        : duration * completedRounds,
    distanceMeters:
      distance == null
        ? null
        : distance * completedRounds,
  });

  if (
    reps != null ||
    duration != null ||
    distance != null
  ) {
    setCapabilityObservation(actuals, exercise, {
      reps,
      durationSeconds: duration,
      distanceMeters: distance,
      unit,
    });
  }
}

export function buildWodProtocolCompletion({
  workout,
  exercises,
  protocolFeedback = {},
}) {
  const sourceExercises = Array.isArray(exercises)
    ? exercises
    : [];
  const runtime = workout?.wodRuntime;

  if (!runtime?.started) {
    return {
      exercises: sourceExercises,
      outcome: null,
    };
  }

  const mechanic = normalizeMechanic(
    runtime.mechanic ?? workout?.mechanic
  );
  const variant =
    normalizeMechanic(
      runtime.variant ?? workout?.formatVariant
    ) || null;
  const parameters = runtime.parameters ?? {};
  const wodExercises =
    sourceExercises.filter(isWodExercise);
  const elapsedSeconds = Math.max(
    0,
    numberOr(runtime.elapsedSeconds, 0)
  );
  const plannedSeconds =
    derivePlannedSeconds(workout, runtime);
  const actuals = new Map();

  const outcome = {
    mechanic_key: mechanic,
    variant_key: variant,
    elapsed_seconds: elapsedSeconds,
    planned_duration_seconds: plannedSeconds,
    finish_reason: runtime.finishReason ?? null,
    player_version:
      runtime.version ?? 'fc7-wod-player-v2',
    performance_capture_version: 'm7.2-v1',
    protocol_completed: false,
    completion_ratio: 0,
  };

  if (runtime.finishReason === 'manual_stop') {
    outcome.ended_by_user = true;
  }

  if (mechanic === 'AMRAP') {
    const rounds = Math.max(
      0,
      numberOr(runtime.completedRounds, 0)
    );

    outcome.rounds_completed = rounds;
    outcome.protocol_completed =
      runtime.finishReason === 'timer_complete';
    outcome.completed_time_limit =
      outcome.protocol_completed;
    outcome.completion_ratio =
      plannedSeconds && plannedSeconds > 0
        ? clamp01(elapsedSeconds / plannedSeconds)
        : outcome.protocol_completed
          ? 1
          : 0;

    for (const exercise of wodExercises) {
      addExactRoundObservation(
        actuals,
        exercise,
        rounds,
        'per_round'
      );
    }
  } else if (
    mechanic === 'CIRCUIT' ||
    mechanic === 'FOR_TIME'
  ) {
    const rounds = Math.max(
      0,
      numberOr(runtime.completedRounds, 0)
    );
    const plannedRounds = Math.max(
      0,
      numberOr(parameters.rounds, 0)
    );
    const completed =
      runtime.finishReason === 'rounds_complete';

    outcome.rounds_completed = rounds;
    outcome.planned_rounds = plannedRounds || null;
    outcome.protocol_completed = completed;
    outcome.completion_ratio =
      plannedRounds > 0
        ? clamp01(rounds / plannedRounds)
        : completed
          ? 1
          : 0;

    if (mechanic === 'FOR_TIME') {
      outcome.hit_time_cap =
        runtime.finishReason === 'time_cap';
      outcome.time_limit_seconds = Math.max(
        0,
        numberOr(
          parameters.cap_seconds,
          plannedSeconds ?? elapsedSeconds
        )
      );
    }

    for (const exercise of wodExercises) {
      addExactRoundObservation(
        actuals,
        exercise,
        rounds,
        'per_round'
      );
    }
  } else if (
    mechanic === 'EMOM' ||
    mechanic === 'ODD_EVEN'
  ) {
    const stationSeconds = Math.max(
      1,
      numberOr(parameters.station_seconds, 60)
    );
    const intervals = Math.floor(
      elapsedSeconds / stationSeconds
    );
    const plannedIntervals = plannedSeconds
      ? Math.floor(plannedSeconds / stationSeconds)
      : 0;

    outcome.intervals_completed = intervals;
    outcome.planned_intervals =
      plannedIntervals || null;
    outcome.protocol_completed =
      runtime.finishReason === 'timer_complete';
    outcome.completed_time_limit =
      outcome.protocol_completed;
    outcome.completion_ratio =
      plannedIntervals > 0
        ? clamp01(
            intervals / plannedIntervals
          )
        : outcome.protocol_completed
          ? 1
          : 0;
  } else if (
    mechanic === 'EVERY_X_MINUTES'
  ) {
    const intervalSeconds = Math.max(
      1,
      numberOr(parameters.interval_seconds, 120)
    );
    const cycles = Math.floor(
      elapsedSeconds / intervalSeconds
    );
    const plannedCycles = Math.max(
      0,
      numberOr(parameters.cycles, 0)
    );

    outcome.intervals_completed = cycles;
    outcome.planned_intervals =
      plannedCycles || null;
    outcome.protocol_completed =
      runtime.finishReason === 'timer_complete';
    outcome.completed_time_limit =
      outcome.protocol_completed;
    outcome.completion_ratio =
      plannedCycles > 0
        ? clamp01(cycles / plannedCycles)
        : outcome.protocol_completed
          ? 1
          : 0;
  } else if (mechanic === 'HIIT') {
    const workSeconds = Math.max(
      1,
      numberOr(parameters.work_seconds, 40)
    );
    const restSeconds = Math.max(
      0,
      numberOr(parameters.rest_seconds, 20)
    );
    const stationSeconds = Math.max(
      1,
      workSeconds + restSeconds
    );
    const stations = Math.floor(
      elapsedSeconds / stationSeconds
    );
    const exerciseCount = Math.max(
      1,
      numberOr(
        parameters.exercise_count,
        wodExercises.length || 1
      )
    );
    const plannedStations =
      Math.max(
        1,
        numberOr(parameters.rounds, 1)
      ) * exerciseCount;

    outcome.intervals_completed = stations;
    outcome.planned_intervals = plannedStations;
    outcome.work_seconds = stations * workSeconds;
    outcome.protocol_completed =
      runtime.finishReason === 'timer_complete';
    outcome.completed_time_limit =
      outcome.protocol_completed;
    outcome.completion_ratio = clamp01(
      stations / plannedStations
    );
  } else if (
    mechanic === 'LADDER' ||
    mechanic === 'COUPLET'
  ) {
    const completedStages =
      completedManualSteps(
        runtime,
        'steps_complete'
      );
    const plannedStages = Math.max(
      1,
      numberOr(parameters.rungs, 1)
    );
    const descending =
      variant === 'DESCENDING_COUPLET' ||
      parameters.sequence_direction === 'descending';

    outcome.last_completed_stage =
      completedStages;
    outcome.planned_stages = plannedStages;
    outcome.protocol_completed =
      runtime.finishReason === 'steps_complete';
    outcome.completion_ratio = clamp01(
      completedStages / plannedStages
    );

    for (const exercise of wodExercises) {
      let totalReps = 0;
      let maxSetReps = null;
      let exact = completedStages > 0;

      for (
        let stage = 1;
        stage <= completedStages;
        stage += 1
      ) {
        const reps = stageReps(
          exercise,
          stage,
          descending ? 'descending' : 'ascending'
        );

        if (reps == null) {
          exact = false;
          break;
        }

        totalReps += reps;
        maxSetReps = Math.max(
          maxSetReps ?? 0,
          reps
        );
      }

      if (exact) {
        addSessionTotals(actuals, exercise, {
          reps: totalReps,
        });
        setCapabilityObservation(actuals, exercise, {
          reps: maxSetReps,
          unit: 'completed_stage',
        });
      }
    }
  } else if (mechanic === 'PYRAMID') {
    const multipliers =
      Array.isArray(parameters.multipliers) &&
      parameters.multipliers.length > 0
        ? parameters.multipliers.map((value) =>
            numberOr(value, 1)
          )
        : [1, 2, 3, 2, 1];
    const cycles = Math.max(
      1,
      numberOr(parameters.cycles, 1)
    );
    const plannedSteps =
      multipliers.length * cycles;
    const completedSteps =
      completedManualSteps(
        runtime,
        'steps_complete'
      );

    outcome.steps_completed = completedSteps;
    outcome.planned_steps = plannedSteps;
    outcome.protocol_completed =
      runtime.finishReason === 'steps_complete';
    outcome.completion_ratio = clamp01(
      completedSteps / plannedSteps
    );

    for (const exercise of wodExercises) {
      let totalReps = 0;
      let maxSetReps = null;
      let exact = completedSteps > 0;

      for (
        let step = 1;
        step <= completedSteps;
        step += 1
      ) {
        const multiplier =
          multipliers[
            (step - 1) % multipliers.length
          ];
        const reps = pyramidStepReps(
          exercise,
          multiplier
        );

        if (reps == null) {
          exact = false;
          break;
        }

        totalReps += reps;
        maxSetReps = Math.max(
          maxSetReps ?? 0,
          reps
        );
      }

      if (exact) {
        addSessionTotals(actuals, exercise, {
          reps: totalReps,
        });
        setCapabilityObservation(actuals, exercise, {
          reps: maxSetReps,
          unit: 'pyramid_step',
        });
      }
    }
  } else if (
    mechanic === 'PROGRESSIVE_INTERVAL'
  ) {
    const intervalSeconds = Math.max(
      1,
      numberOr(parameters.interval_seconds, 60)
    );
    const currentStage = Math.max(
      1,
      numberOr(runtime.currentStage, 1)
    );
    const failed =
      runtime.finishReason === 'observed_failure';
    const hitCap =
      runtime.finishReason === 'time_cap';
    const completedStages = failed
      ? Math.max(0, currentStage - 1)
      : hitCap
        ? currentStage
        : Math.max(0, currentStage - 1);
    const plannedStages = plannedSeconds
      ? Math.max(
          1,
          Math.floor(
            plannedSeconds / intervalSeconds
          )
        )
      : null;

    outcome.last_completed_stage =
      completedStages;
    outcome.planned_stages = plannedStages;
    outcome.protocol_completed = hitCap;
    outcome.completed_time_limit = hitCap;
    outcome.hit_time_cap = hitCap;
    outcome.time_limit_seconds =
      plannedSeconds ?? elapsedSeconds;
    outcome.completion_ratio = plannedStages
      ? clamp01(
          completedStages / plannedStages
        )
      : 0;

    if (failed) {
      outcome.failed_stage = currentStage;
      const partial =
        protocolFeedback?.partialRepsByExercise ?? {};
      const normalizedPartial = {};

      for (const exercise of wodExercises) {
        const value = Math.max(
          0,
          numberOr(partial[exercise.id], 0)
        );

        if (value > 0) {
          normalizedPartial[exercise.id] = value;
        }
      }

      if (
        Object.keys(normalizedPartial).length > 0
      ) {
        outcome.partial_reps_by_exercise =
          normalizedPartial;
      }
    }

    // Progressive formats are learned through protocol capability.
    // We deliberately do not convert their cumulative stage reps into
    // per-exercise repeatable capability observations.
  } else if (
    mechanic === 'CHIPPER' ||
    mechanic === 'REP_TARGET'
  ) {
    const completed =
      runtime.finishReason === 'sequence_complete';
    const itemsCompleted = Math.max(
      0,
      numberOr(runtime.currentItemIndex, 0) +
        (completed ? 1 : 0)
    );

    outcome.items_completed = itemsCompleted;
    outcome.planned_items = wodExercises.length;
    outcome.protocol_completed = completed;
    outcome.completion_ratio =
      wodExercises.length > 0
        ? clamp01(
            itemsCompleted / wodExercises.length
          )
        : 0;

    for (
      let index = 0;
      index <
      Math.min(
        itemsCompleted,
        wodExercises.length
      );
      index += 1
    ) {
      const exercise = wodExercises[index];
      const prescription =
        prescriptionFor(exercise);
      const reps = executionTargetValue(
        prescription,
        'execution_target_reps',
        'reps_min',
        'reps_max'
      );
      const duration = executionTargetValue(
        prescription,
        'execution_target_duration_seconds',
        'duration_seconds_min',
        'duration_seconds_max'
      );
      const distance = executionTargetValue(
        prescription,
        'execution_target_distance_meters',
        'distance_meters_min',
        'distance_meters_max'
      );

      if (
        reps != null ||
        duration != null ||
        distance != null
      ) {
        addSessionTotals(actuals, exercise, {
          reps,
          durationSeconds: duration,
          distanceMeters: distance,
        });
        setCapabilityObservation(actuals, exercise, {
          reps,
          durationSeconds: duration,
          distanceMeters: distance,
          unit: 'sequence_item',
        });
      }
    }
  } else if (mechanic === 'DECK') {
    const deck = Array.isArray(
      parameters.deck_order
    )
      ? parameters.deck_order
      : [];
    const completed =
      runtime.finishReason === 'deck_complete';
    const cardsCompleted = Math.max(
      0,
      numberOr(runtime.currentItemIndex, 0) +
        (completed ? 1 : 0)
    );

    outcome.cards_completed = cardsCompleted;
    outcome.planned_cards =
      deck.length ||
      numberOr(parameters.cards, 52);
    outcome.protocol_completed = completed;
    outcome.completion_ratio =
      outcome.planned_cards > 0
        ? clamp01(
            cardsCompleted /
              outcome.planned_cards
          )
        : 0;

    const maxCardByExercise = new Map();

    for (
      let index = 0;
      index <
      Math.min(cardsCompleted, deck.length);
      index += 1
    ) {
      const card = deck[index];
      const suitIndex = Math.max(
        1,
        numberOr(card?.suit_index, 1)
      );
      const exercise =
        wodExercises[suitIndex - 1];

      if (!exercise) {
        continue;
      }

      const reps = Math.max(
        0,
        numberOr(card?.reps, 0)
      );

      addSessionTotals(actuals, exercise, {
        reps,
      });

      const key = exerciseKey(exercise);
      maxCardByExercise.set(
        key,
        Math.max(
          maxCardByExercise.get(key) ?? 0,
          reps
        )
      );
    }

    for (const exercise of wodExercises) {
      const maxCard = maxCardByExercise.get(
        exerciseKey(exercise)
      );

      if (maxCard != null && maxCard > 0) {
        setCapabilityObservation(actuals, exercise, {
          reps: maxCard,
          unit: 'deck_card',
        });
      }
    }
  } else if (
    mechanic === 'STRENGTH' ||
    mechanic === 'SETS_REPS'
  ) {
    const completed =
      runtime.finishReason === 'sets_complete';
    const completedStations =
      completedManualSteps(
        runtime,
        'sets_complete'
      );
    const sets = Math.max(
      1,
      numberOr(parameters.sets, 1)
    );
    const plannedStations =
      sets * Math.max(1, wodExercises.length);

    outcome.set_stations_completed =
      completedStations;
    outcome.planned_set_stations =
      plannedStations;
    outcome.protocol_completed = completed;
    outcome.completion_ratio = clamp01(
      completedStations / plannedStations
    );

    const maxRepsByExercise = new Map();

    for (
      let station = 0;
      station < completedStations;
      station += 1
    ) {
      const exercise =
        wodExercises[
          station %
            Math.max(1, wodExercises.length)
        ];

      if (!exercise) {
        continue;
      }

      const prescription =
        prescriptionFor(exercise);
      const reps = executionTargetValue(
        prescription,
        'execution_target_reps',
        'reps_min',
        'reps_max'
      );

      if (reps == null) {
        continue;
      }

      addSessionTotals(actuals, exercise, {
        reps,
      });

      const key = exerciseKey(exercise);
      maxRepsByExercise.set(
        key,
        Math.max(
          maxRepsByExercise.get(key) ?? 0,
          reps
        )
      );
    }

    for (const exercise of wodExercises) {
      const reps = maxRepsByExercise.get(
        exerciseKey(exercise)
      );

      if (reps != null && reps > 0) {
        setCapabilityObservation(actuals, exercise, {
          reps,
          unit: 'set',
        });
      }
    }
  }

  const actualRows = [...actuals.values()].filter(
    (item) =>
      item.session_total_reps != null ||
      item.session_total_duration_seconds != null ||
      item.session_total_distance_meters != null ||
      item.capability_reps != null ||
      item.capability_duration_seconds != null ||
      item.capability_distance_meters != null
  );

  if (actualRows.length > 0) {
    outcome.exercise_actuals = actualRows;
  }

  return {
    exercises: mergeActualsIntoExercises(
      sourceExercises,
      actuals
    ),
    outcome,
  };
}
