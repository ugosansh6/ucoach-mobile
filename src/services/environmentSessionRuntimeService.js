import { supabase } from '../lib/supabase';

function normalize(value) {
  return String(value ?? '').trim().toUpperCase();
}

function runtimeModuleByBlock(workout) {
  const map = new Map();
  for (const block of workout?.rawBlocks ?? []) {
    const key = String(block?.block_key ?? block?.blockKey ?? '').toLowerCase();
    if (!key) continue;
    map.set(key, normalize(block?.module_code));
  }
  return map;
}

export async function hydrateEnvironmentSessionExerciseIds(workout) {
  if (!workout?.sessionId || !Array.isArray(workout?.exercises) || workout.exercises.length === 0) {
    return workout;
  }

  if (workout.exercises.every((exercise) => Boolean(exercise.sessionExerciseId))) {
    return workout;
  }

  const { data, error } = await supabase
    .from('workout_session_exercises')
    .select('id, exercise_id, block_key, position, solver_decision_json')
    .eq('session_id', workout.sessionId)
    .order('position', { ascending: true });

  if (error) throw error;

  const rows = data ?? [];
  const used = new Set(
    workout.exercises
      .map((exercise) => exercise.sessionExerciseId)
      .filter(Boolean)
  );
  const moduleByBlock = runtimeModuleByBlock(workout);
  let changed = false;

  const exercises = workout.exercises.map((exercise) => {
    if (exercise.sessionExerciseId) return exercise;

    const exerciseId = exercise.exerciseId ?? exercise.id;
    const runtimeKey = String(exercise.blockKey ?? exercise.block ?? '').toLowerCase();
    const runtimeModule = moduleByBlock.get(runtimeKey) ?? '';

    let match = rows.find((row) =>
      !used.has(row.id) &&
      row.exercise_id === exerciseId &&
      runtimeModule &&
      normalize(row.solver_decision_json?.module_code) === runtimeModule
    );

    if (!match) {
      const legacyKeys = {
        gym: ['skill'],
        street_gym: ['skill'],
        strength: ['wod'],
        cardio: ['wod'],
        conditioning: ['wod'],
        tabata: ['tabata'],
        skill: ['skill'],
        unlock: ['unlock'],
        warmup: ['warm_up', 'warmup'],
        wod: ['wod'],
      }[runtimeKey] ?? [runtimeKey];

      match = rows.find((row) =>
        !used.has(row.id) &&
        row.exercise_id === exerciseId &&
        legacyKeys.includes(String(row.block_key ?? '').toLowerCase())
      );
    }

    if (!match) {
      match = rows.find((row) => !used.has(row.id) && row.exercise_id === exerciseId);
    }

    if (!match) return exercise;
    used.add(match.id);
    changed = true;

    return {
      ...exercise,
      sessionExerciseId: match.id,
    };
  });

  return changed ? { ...workout, exercises } : workout;
}

export async function syncEnvironmentBuilderSwapRuntime({
  sessionExerciseId,
  oldExerciseId,
  substitute = {},
}) {
  const { data, error } = await supabase.rpc(
    'sync_user_session_builder_runtime_swap_v1',
    {
      p_session_exercise_id: sessionExerciseId,
      p_old_exercise_id: oldExerciseId,
      p_substitute: substitute && typeof substitute === 'object' ? substitute : {},
    }
  );

  if (error) throw new Error(error?.message ?? 'Impossible de synchroniser le remplacement.');
  return data;
}
