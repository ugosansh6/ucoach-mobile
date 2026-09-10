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

function exerciseKey(exercise) {
  return exercise?.sessionExerciseId ?? exercise?._uiKey ?? exercise?.id ?? null;
}

const FULL_COMPLETION_REASONS = new Set([
  'timer_complete',
  'rounds_complete',
  'steps_complete',
  'sequence_complete',
  'deck_complete',
  'sets_complete',
]);

function addIndex(set, index, count) {
  if (count <= 0) return;
  const safe = ((index % count) + count) % count;
  set.add(safe);
}

export function deriveWodExerciseStatuses(block, runtime) {
  const exercises = Array.isArray(block?.exercises) ? block.exercises : [];
  const result = new Map();

  if (!runtime?.started || exercises.length === 0) {
    return result;
  }

  const reason = String(runtime?.finishReason ?? '').trim();
  const mechanic = normalizeMechanic(runtime?.mechanic ?? block?.mechanic);
  const params = runtime?.parameters ?? block?.source?.parameters ?? {};

  if (runtime?.finished && FULL_COMPLETION_REASONS.has(reason)) {
    for (const exercise of exercises) {
      const key = exerciseKey(exercise);
      if (key) result.set(key, 'completed');
    }
    return result;
  }

  const performed = new Set();
  const definitelyCompleted = new Set();
  const count = exercises.length;
  const elapsed = Math.max(0, numberOr(runtime?.elapsedSeconds, 0));

  if (['AMRAP', 'CIRCUIT', 'FOR_TIME'].includes(mechanic)) {
    if (numberOr(runtime?.completedRounds, 0) > 0) {
      for (let index = 0; index < count; index += 1) performed.add(index);
    }
  } else if (mechanic === 'EMOM') {
    const stationSeconds = Math.max(1, numberOr(params.station_seconds, 60));
    const completedIntervals = Math.floor(elapsed / stationSeconds);
    for (let interval = 0; interval < completedIntervals; interval += 1) {
      addIndex(performed, interval, count);
    }
    if (elapsed % stationSeconds > 0) addIndex(performed, completedIntervals, count);
  } else if (mechanic === 'ODD_EVEN') {
    const stationSeconds = Math.max(1, numberOr(params.station_seconds, 60));
    const completedIntervals = Math.floor(elapsed / stationSeconds);
    const indexForMinute = (minuteIndex) => {
      const odd = (minuteIndex + 1) % 2 === 1;
      return Math.max(
        0,
        numberOr(odd ? params.odd_position : params.even_position, odd ? 1 : 2) - 1
      );
    };
    for (let interval = 0; interval < completedIntervals; interval += 1) {
      addIndex(performed, indexForMinute(interval), count);
    }
    if (elapsed % stationSeconds > 0) {
      addIndex(performed, indexForMinute(completedIntervals), count);
    }
  } else if (mechanic === 'HIIT') {
    const work = Math.max(1, numberOr(params.work_seconds, 40));
    const rest = Math.max(0, numberOr(params.rest_seconds, 20));
    const stationSeconds = Math.max(1, work + rest);
    const completedStations = Math.floor(elapsed / stationSeconds);
    for (let station = 0; station < completedStations; station += 1) {
      addIndex(performed, station, count);
    }
    const within = elapsed % stationSeconds;
    if (within > 0 && within <= work) addIndex(performed, completedStations, count);
  } else if (mechanic === 'EVERY_X_MINUTES') {
    const interval = Math.max(1, numberOr(params.interval_seconds, 120));
    if (Math.floor(elapsed / interval) > 0) {
      for (let index = 0; index < count; index += 1) performed.add(index);
    }
  } else if (['LADDER', 'COUPLET'].includes(mechanic)) {
    const completedSteps = Math.max(0, numberOr(runtime?.manualStep, 1) - 1);
    if (completedSteps > 0) {
      for (let index = 0; index < count; index += 1) performed.add(index);
    }
  } else if (mechanic === 'PYRAMID') {
    const completedSteps = Math.max(0, numberOr(runtime?.manualStep, 1) - 1);
    if (completedSteps > 0) {
      for (let index = 0; index < count; index += 1) performed.add(index);
    }
  } else if (mechanic === 'PROGRESSIVE_INTERVAL') {
    const currentStage = Math.max(1, numberOr(runtime?.currentStage, 1));
    const completedStages = reason === 'time_cap'
      ? currentStage
      : Math.max(0, currentStage - 1);
    if (completedStages > 0) {
      for (let index = 0; index < count; index += 1) performed.add(index);
    }
  } else if (['CHIPPER', 'REP_TARGET'].includes(mechanic)) {
    const completedItems = Math.max(0, numberOr(runtime?.currentItemIndex, 0));
    for (let index = 0; index < Math.min(completedItems, count); index += 1) {
      definitelyCompleted.add(index);
    }
  } else if (mechanic === 'DECK') {
    const deck = Array.isArray(params.deck_order) ? params.deck_order : [];
    const cardsCompleted = Math.max(0, numberOr(runtime?.currentItemIndex, 0));
    for (let index = 0; index < Math.min(cardsCompleted, deck.length); index += 1) {
      const card = deck[index];
      addIndex(performed, Math.max(1, numberOr(card?.suit_index, 1)) - 1, count);
    }
  } else if (['STRENGTH', 'SETS_REPS'].includes(mechanic)) {
    const completedStations = Math.max(0, numberOr(runtime?.manualStep, 1) - 1);
    const sets = Math.max(1, numberOr(params.sets, 1));
    const stationCounts = Array(count).fill(0);
    for (let station = 0; station < completedStations; station += 1) {
      stationCounts[station % count] += 1;
    }
    stationCounts.forEach((value, index) => {
      if (value >= sets) definitelyCompleted.add(index);
      else if (value > 0) performed.add(index);
    });
  }

  exercises.forEach((exercise, index) => {
    const key = exerciseKey(exercise);
    if (!key) return;
    if (definitelyCompleted.has(index)) result.set(key, 'completed');
    else if (performed.has(index)) result.set(key, 'adapted');
    else result.set(key, 'not_completed');
  });

  return result;
}

export function applyWodRuntimeStatuses(allExercises, block, runtime) {
  const source = Array.isArray(allExercises) ? allExercises : [];
  const statuses = deriveWodExerciseStatuses(block, runtime);
  if (statuses.size === 0) return source;

  return source.map((exercise) => {
    const blockKey = String(exercise?.blockKey ?? exercise?.block ?? '').toLowerCase();
    if (blockKey !== 'wod') return exercise;
    const key = exerciseKey(exercise);
    const nextStatus = key ? statuses.get(key) : null;
    return nextStatus ? { ...exercise, status: nextStatus } : exercise;
  });
}
