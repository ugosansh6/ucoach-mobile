import { supabase } from '../lib/supabase';
import { getCurrentPrimaryGoal } from './goalsService';

function normalizeEquipmentForBackend(equipment) {
  const values = Array.isArray(equipment)
    ? equipment.filter(Boolean)
    : [];

  const withoutBodyweight = values.filter(
    (item) => item !== 'Poids du corps'
  );

  return withoutBodyweight.length > 0
    ? withoutBodyweight
    : ['Aucun'];
}

function normalizeInjuriesForBackend(painZones) {
  const values = Array.isArray(painZones)
    ? painZones.filter(Boolean)
    : [];

  return values.filter(
    (item) => item !== 'Aucune'
  );
}

function getTrackingType(trackingModes) {
  const modes = Array.isArray(trackingModes)
    ? trackingModes
    : [];

  if (modes.includes('load')) {
    return 'load';
  }

  if (modes.includes('distance')) {
    return 'distance';
  }

  if (modes.includes('time')) {
    return 'time';
  }

  return 'bodyweight';
}

function mapGeneratedWorkout(data, preparation) {
  const backendBlocks = Array.isArray(data?.blocks)
    ? data.blocks
    : [];

  const exercises = backendBlocks.flatMap((block) =>
    (block.exercises ?? []).map((exercise) => ({
      id: exercise.id,
      exerciseId: exercise.id,
      block: block.block_key,
      blockKey: block.block_key,
      name: exercise.name,
      prescription: exercise.prescription,
      prescriptionJson:
        exercise.prescription_json ?? null,
      status: 'pending',
      trackingType: getTrackingType(
        exercise.tracking_modes
      ),
      trackingModes:
        exercise.tracking_modes ?? [],
      instructions:
        exercise.instructions ?? null,
      tips:
        exercise.tips ?? null,
      pattern:
        exercise.pattern ?? null,
      region:
        exercise.region ?? null,
    }))
  );

  const blocks = {};

  for (const block of backendBlocks) {
    blocks[block.block_key] = {
      key: block.block_key,
      title:
        block.block_name ?? block.block_key,
      duration:
        block.duration_minutes ?? null,
      objective:
        block.objective ?? null,
      structure:
        block.structure ?? null,
      format:
        block.block_key === 'wod'
          ? data?.meta?.format ?? null
          : null,
      rounds:
        block.rounds ?? null,
      workSeconds:
        block.work_seconds ?? null,
      restSeconds:
        block.rest_seconds ?? null,
      rotationMode:
        block.rotation_mode ?? null,
    };
  }

  return {
    sessionId: data.session_id,
    backendVersion:
      data.version ?? null,
    title:
      data?.meta?.target_region ??
      preparation?.region ??
      'Full Body',
    format:
      data?.meta?.format ?? null,
    plannedDuration:
      data?.meta?.total_duration_minutes ??
      preparation?.duration ??
      45,
    generatedAt:
      data?.meta?.generated_at ??
      new Date().toISOString(),
    preparationSnapshot: {
      duration:
        preparation?.duration ?? 45,
      equipment:
        preparation?.equipment?.length > 0
          ? preparation.equipment
          : ['Poids du corps'],
      readiness:
        preparation?.readiness ?? 6,
      painZones:
        preparation?.painZones?.length > 0
          ? preparation.painZones
          : ['Aucune'],
      region:
        preparation?.region ?? null,
    },
    blocks,
    rawBlocks: backendBlocks,
    exercises,
    meta: data?.meta ?? {},
  };
}

async function resolveFocusForGeneration() {
  try {
    const primaryGoal =
      await getCurrentPrimaryGoal();

    return (
      primaryGoal?.name ??
      'General Fitness'
    );
  } catch {
    /*
     * La génération ne doit pas être bloquée si le profil
     * n'a pas encore de goal exploitable. General Fitness
     * reste le fallback neutre du moteur.
     */
    return 'General Fitness';
  }
}

export async function generateWorkoutSession(preparation) {
  const focusOverride =
    await resolveFocusForGeneration();

  const payload = {
    duration_minutes:
      preparation?.duration ?? 45,
    readiness:
      preparation?.readiness ?? 6,
    available_equipment:
      normalizeEquipmentForBackend(
        preparation?.equipment
      ),
    injured_zones:
      normalizeInjuriesForBackend(
        preparation?.painZones
      ),
    target_region:
      preparation?.region ?? null,
    format_preference: null,
    focus_override: focusOverride,
  };

  const { data, error } =
    await supabase.functions.invoke(
      'bright-handler',
      {
        body: payload,
      }
    );

  if (error) {
    let detail = null;

    try {
      detail =
        await error?.context?.json();
    } catch {
      detail = null;
    }

    throw new Error(
      detail?.error ??
        detail?.message ??
        error?.message ??
        'Impossible de générer la séance.'
    );
  }

  if (data?.error) {
    throw new Error(data.error);
  }

  if (!data?.session_id) {
    throw new Error(
      "La génération n'a pas retourné de session_id."
    );
  }

  if (
    !Array.isArray(data?.blocks) ||
    data.blocks.length === 0
  ) {
    throw new Error(
      "La génération n'a retourné aucun bloc."
    );
  }

  return mapGeneratedWorkout(
    data,
    preparation
  );
}

function parseLoadKg(value) {
  if (value == null) {
    return null;
  }

  const normalized = String(value)
    .trim()
    .toLowerCase()
    .replace(',', '.');

  if (!normalized) {
    return null;
  }

  // Exemples supportés :
  // "20", "20 kg", "2 x 12 kg", "2 × 12 kg"
  const pairMatch = normalized.match(
    /\d+(?:\.\d+)?\s*[x×]\s*(\d+(?:\.\d+)?)/
  );

  if (pairMatch) {
    return Number(pairMatch[1]);
  }

  const singleMatch = normalized.match(
    /(\d+(?:\.\d+)?)/
  );

  return singleMatch
    ? Number(singleMatch[1])
    : null;
}

function normalizeStatus(status) {
  return status === 'skipped'
    ? 'skipped'
    : 'completed';
}

export async function swapWorkoutExercise({
  sessionId,
  currentExerciseId,
}) {
  if (!sessionId) {
    throw new Error(
      "Impossible de changer l'exercice : session_id manquant."
    );
  }

  if (!currentExerciseId) {
    throw new Error(
      "Impossible de changer l'exercice : exercise_id manquant."
    );
  }

  const { data, error } =
    await supabase.functions.invoke(
      'generate-workout',
      {
        body: {
          session_id: sessionId,
          current_exercise_id:
            currentExerciseId,
        },
      }
    );

  if (error) {
    let detail = null;

    try {
      detail =
        await error?.context?.json();
    } catch {
      detail = null;
    }

    throw new Error(
      detail?.error ??
        detail?.message ??
        error?.message ??
        "Impossible de changer cet exercice."
    );
  }

  if (data?.error) {
    throw new Error(data.error);
  }

  if (!data?.substitute?.id) {
    throw new Error(
      "Le backend n'a retourné aucun exercice de remplacement."
    );
  }

  return data;
}

export async function completeWorkoutSession({
  sessionId,
  exercises,
  formAfter,
  rpe,
  notes,
  loads = {},
}) {
  if (!sessionId) {
    throw new Error(
      "Impossible d'enregistrer la séance : session_id manquant."
    );
  }

  const sessionExercises = Array.isArray(exercises)
    ? exercises.filter((exercise) => exercise?.id)
    : [];

  if (sessionExercises.length === 0) {
    throw new Error(
      "Impossible d'enregistrer la séance : aucun exercice disponible."
    );
  }

  const exerciseIds = [
    ...new Set(
      sessionExercises.map((exercise) => exercise.id)
    ),
  ];

  const { data: exerciseMeta, error: metaError } =
    await supabase
      .from('exercises')
      .select('id, tracking_modes')
      .in('id', exerciseIds);

  if (metaError) {
    throw metaError;
  }

  const metaById = new Map(
    (exerciseMeta ?? []).map((exercise) => [
      exercise.id,
      exercise.tracking_modes ?? [],
    ])
  );

  const results = sessionExercises.map((exercise) => {
    const trackingModes =
      metaById.get(exercise.id) ?? [];

    const status = normalizeStatus(
      exercise.status
    );

    const isCompleted =
      status === 'completed';

    const loadValue =
      loads?.[exercise.id];

    /*
     * IMPORTANT : le RPE de séance n'est plus copié sur chaque exercice.
     * hyper-api distingue maintenant la difficulté globale de la séance
     * du RPE propre à un mouvement. Tant que l'UI ne demande pas de RPE
     * par exercice, on envoie null ici plutôt qu'une fausse donnée.
     */
    const exerciseRpe =
      exercise.rpe ??
      exercise.exerciseRpe ??
      null;

    return {
      exercise_id: exercise.id,
      status,

      reps_completed:
        isCompleted &&
        trackingModes.includes('reps')
          ? exercise.repsCompleted ??
            exercise.reps_completed ??
            null
          : null,

      weight_kg:
        isCompleted &&
        trackingModes.includes('load')
          ? parseLoadKg(loadValue)
          : null,

      duration_seconds:
        isCompleted &&
        trackingModes.includes('time')
          ? exercise.durationSeconds ??
            exercise.duration_seconds ??
            null
          : null,

      distance_meters:
        isCompleted &&
        trackingModes.includes('distance')
          ? exercise.distanceMeters ??
            exercise.distance_meters ??
            null
          : null,

      rpe:
        isCompleted
          ? exerciseRpe
          : null,

      notes:
        exercise.notes ?? null,
    };
  });

  const { data, error } =
    await supabase.functions.invoke(
      'hyper-api',
      {
        body: {
          session_id: sessionId,
          post_workout_feeling: formAfter,
          global_rpe: rpe,
          notes: notes?.trim() || null,
          exercises: results,
        },
      }
    );

  if (error) {
    let detail = null;

    try {
      detail = await error?.context?.json();
    } catch {
      detail = null;
    }

    const detailMessage =
      detail?.error ??
      detail?.message ??
      error?.message ??
      'Erreur inconnue pendant l’enregistrement.';

    throw new Error(detailMessage);
  }

  if (data?.error) {
    throw new Error(data.error);
  }

  return data;
}