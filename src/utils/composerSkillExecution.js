// Execute the canonical prescription; never choose exercises or increase dosage.
const positive = (value) => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null;
export function skillExecutionUnits(exercises, { sets: blockSets = null, restSeconds: blockRest = null, rounds = false } = {}) {
  const units = (exercises ?? []).flatMap((exercise) => {
    const p = exercise.prescriptionJson ?? {};
    const sets = positive(p.test_attempts ?? p.sets ?? blockSets);
    if (!Number.isInteger(sets)) throw new Error(`Séries manquantes pour ${exercise.name}.`);
    const reps = positive(p.execution_target_reps ?? p.reps ?? p.reps_min);
    const seconds = reps ? null : positive(p.execution_target_duration_seconds ?? p.duration_seconds ?? p.duration_seconds_min);
    const distance = reps || seconds ? null : positive(p.execution_target_distance_meters ?? p.distance_meters ?? p.distance_meters_min);
    const test = p.test_score_required === true;
    if (!reps && !seconds && !distance && !test) throw new Error(`Prescription manquante pour ${exercise.name}.`);
    const sides = p.reps_semantics === 'per_side' || p.duration_semantics === 'per_side' ? ['left', 'right'] : [null];
    return Array.from({ length: sets }, (_, index) => sides.map((side, sideIndex) => ({
      key: `${exercise.sessionExerciseId}:${index + 1}:${side ?? 'both'}`,
      sessionExerciseId: exercise.sessionExerciseId, exercise, setIndex: index + 1, sets, side,
      reps, seconds, distance, test, metric: p.test_metric,
      restSeconds: sideIndex === sides.length - 1 ? Number(p.rest_between_sets_seconds ?? p.rest_seconds ?? blockRest ?? 0) : Number(p.rest_between_sides_seconds ?? 0),
    }))).flat();
  });
  // Warm-up rounds follow the authored exercise order, then repeat the round.
  return rounds ? units.sort((a, b) => a.setIndex - b.setIndex) : units;
}
export function skillElapsed(runtime, now = Date.now()) {
  return Math.max(0, Number(runtime?.elapsedSeconds ?? 0) + (runtime?.runningSince ? Math.max(0, now - runtime.runningSince) / 1000 : 0));
}
export function skillExecutionUpdates(exercises, units, results, protocolFinished, blockType = 'skill') {
  return Object.fromEntries(exercises.map((exercise) => {
    const rows = units.filter((u) => u.sessionExerciseId === exercise.sessionExerciseId && results[u.key])
      .map((u) => ({ set_index: u.setIndex, side: u.side, ...results[u.key], status: 'completed' }));
    const complete = rows.length > 0 && rows.length === units.filter((u) => u.sessionExerciseId === exercise.sessionExerciseId).length;
    const status = complete ? 'completed' : rows.length ? 'adapted' : 'not_completed';
    const testMetric = exercise.prescriptionJson?.test_metric;
    const testScores = rows.map((row) => row.score).filter((score) => Number.isFinite(score) && score > 0);
    const testScore = complete && exercise.prescriptionJson?.test_score_required && testScores.length === rows.length ? Math.max(...testScores) : null;
    return [exercise.sessionExerciseId, { status, userExecutionStatus: status,
      repsCompleted: rows.some((r) => r.reps != null) ? rows.reduce((n, r) => n + (r.reps ?? 0), 0) : null,
      durationSeconds: rows.some((r) => r.duration_seconds != null) ? rows.reduce((n, r) => n + (r.duration_seconds ?? 0), 0) : null,
      distanceMeters: rows.some((r) => r.distance_meters != null) ? rows.reduce((n, r) => n + (r.distance_meters ?? 0), 0) : null,
      performanceActualJson: { ...(exercise.performanceActualJson ?? {}), [blockType === 'skill' ? 'skill_sets' : blockType === 'warmup' ? 'warmup_sets' : 'gym_sets']: rows,
        protocol_completed: complete, source: 'composer_skill_player_v1',
        ...(testScore != null ? { skill_test_contract: 'skill-contract-v2', skill_objective_type: 'TEST',
          skill_test_metric: testMetric, skill_test_score: testScore, skill_test_unit: exercise.prescriptionJson?.test_score_unit } : {}) },
    }];
  }));
}
