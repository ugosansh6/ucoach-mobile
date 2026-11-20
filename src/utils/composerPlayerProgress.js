// Execution state only. Never changes prescriptions, block order or doses.
export const COMPOSER_PLAYER_PROGRESS_VERSION = 'composer-player-progress-v1';

export function isComposerWorkout(workout) {
  return String(workout?.meta?.source ?? '').toLowerCase() === 'w11_composer';
}

export function composerPlayerSnapshot(workout, now = Date.now()) {
  return {
    version: COMPOSER_PLAYER_PROGRESS_VERSION,
    sessionId: workout.sessionId,
    clientUpdatedAt: now,
    playerCursor: workout.playerCursor ?? null,
    warmupRuntime: workout.warmupRuntime ?? null,
    tabataRuntime: workout.tabataRuntime ?? null,
    skillRuntime: workout.skillRuntime ?? null,
    strengthRuntime: workout.strengthRuntime ?? null,
    wodRuntime: workout.wodRuntime ?? null,
    timedRuntimes: workout.timedRuntimes ?? {},
    strengthDrafts: workout.strengthDrafts ?? {},
    setRestRuntime: workout.setRestRuntime ?? null,
    environmentPartialProgress: workout.environmentPartialProgress ?? null,
    executionEvents: workout.executionEvents ?? [],
    exercises: (workout.exercises ?? []).map((e) => ({
      sessionExerciseId: e.sessionExerciseId,
      status: e.status ?? 'pending', userExecutionStatus: e.userExecutionStatus ?? e.status ?? 'pending',
      repsCompleted: e.repsCompleted ?? null, durationSeconds: e.durationSeconds ?? null,
      distanceMeters: e.distanceMeters ?? null, rpe: e.rpe ?? null,
      performanceActualJson: e.performanceActualJson ?? null,
    })),
  };
}

export function composerProgressFingerprint(progress, includeClock = true) {
  if (!progress) return '';
  const p = { ...progress };
  delete p.clientUpdatedAt;
  if (!includeClock) {
    for (const key of ['wodRuntime', 'tabataRuntime']) {
      if (!p[key]) continue;
      p[key] = { ...p[key] };
      for (const field of ['elapsedSeconds', 'elapsed', 'phaseRemainingSeconds', 'restRemaining', 'sampledAt']) delete p[key][field];
    }
    p.timedRuntimes = Object.fromEntries(Object.entries(p.timedRuntimes ?? {}).map(([key, value]) => {
      const r = { ...value }; delete r.elapsed; delete r.elapsedSeconds; delete r.sampledAt; return [key, r];
    }));
  }
  return JSON.stringify(p);
}

export function restoreRunningClock(runtime, savedAt, now = Date.now()) {
  if (!runtime?.started || runtime.paused || runtime.finished) return runtime;
  const extra = Math.max(0, (now - Number(savedAt ?? now)) / 1000);
  const key = runtime.elapsedSeconds != null ? 'elapsedSeconds' : 'elapsed';
  const cap = Number(runtime.totalSeconds ?? runtime.prescribedSeconds);
  const elapsed = Math.floor(Number(runtime[key] ?? 0) + extra);
  return { ...runtime, sampledAt: now, [key]: Number.isFinite(cap) && cap > 0 ? Math.min(cap, elapsed) : elapsed,
    ...(runtime.restRemaining != null ? { restRemaining: Math.max(0, Math.ceil(runtime.restRemaining - extra)) } : {}) };
}

export function hydrateComposerPlayerProgress(workout, snapshot, now = Date.now()) {
  const progress = snapshot?.progress;
  const metadata = { revision: Number(snapshot?.revision ?? 0), contractKey: snapshot?.contract_key, loaded: true, rebased: snapshot?.rebased === true };
  if (snapshot?.closed || !progress || progress.version !== COMPOSER_PLAYER_PROGRESS_VERSION || progress.sessionId !== workout.sessionId) {
    return { ...workout, composerPlayerProgress: metadata };
  }
  const byId = new Map((progress.exercises ?? []).map((e) => [e.sessionExerciseId, e]));
  const clientUpdatedAt = progress.clientUpdatedAt;
  const state = Object.fromEntries(['playerCursor', 'warmupRuntime', 'tabataRuntime', 'skillRuntime', 'strengthRuntime', 'wodRuntime',
    'timedRuntimes', 'strengthDrafts', 'setRestRuntime', 'environmentPartialProgress', 'executionEvents']
    .filter((key) => Object.hasOwn(progress, key)).map((key) => [key, progress[key]]));
  return {
    ...workout, ...state,
    wodRuntime: restoreRunningClock(progress.wodRuntime, clientUpdatedAt, now),
    tabataRuntime: restoreRunningClock(progress.tabataRuntime, clientUpdatedAt, now),
    timedRuntimes: Object.fromEntries(Object.entries(progress.timedRuntimes ?? {}).map(([key, r]) => [key, restoreRunningClock(r, clientUpdatedAt, now)])),
    exercises: (workout.exercises ?? []).map((e) => {
      const stored = byId.get(e.sessionExerciseId);
      return stored ? { ...e, ...Object.fromEntries(['status', 'userExecutionStatus', 'repsCompleted', 'durationSeconds', 'distanceMeters', 'rpe', 'performanceActualJson'].filter((key) => Object.hasOwn(stored, key)).map((key) => [key, stored[key]])) } : e;
    }),
    composerPlayerProgress: metadata,
  };
}

export function composerRecordedInstanceIds(workout) {
  const ids = new Set(workout?.environmentPartialProgress?.sessionExerciseIds ?? []);
  for (const [id, draft] of Object.entries(workout?.strengthDrafts ?? {})) if (draft?.sets?.some((s) => s.done)) ids.add(id);
  for (const runtime of [workout?.skillRuntime, workout?.strengthRuntime, workout?.warmupRuntime]) {
    for (const key of Object.keys(runtime?.results ?? {})) ids.add(key.split(':')[0]);
    if (runtime?.runningSince && workout?.playerCursor?.sessionExerciseId) ids.add(workout.playerCursor.sessionExerciseId);
  }
  for (const exercise of workout?.exercises ?? []) {
    const key = String(exercise.blockKey ?? exercise.block ?? '');
    const started = (key === 'wod' && workout?.wodRuntime?.started) || (key === 'tabata' && workout?.tabataRuntime?.started)
      || (['warm_up','warmup'].includes(key) && Number(workout?.warmupRuntime?.round ?? 1) > 1)
      || workout?.timedRuntimes?.[key]?.started;
    if (started || ['completed','adapted','not_completed','skipped'].includes(exercise.userExecutionStatus ?? exercise.status)) ids.add(exercise.sessionExerciseId);
  }
  return [...ids].filter(Boolean);
}
