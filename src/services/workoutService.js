import { supabase } from '../lib/supabase';
import { getCurrentPrimaryGoal } from './goalsService';

function getLocalDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(
    date.getMonth() + 1
  ).padStart(2, '0');
  const day = String(
    date.getDate()
  ).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

export async function markWorkoutSessionStarted({
  sessionId,
  localDate = new Date(),
}) {
  if (!sessionId) {
    return {
      status: 'NO_SESSION',
    };
  }

  const { data, error } = await supabase.rpc(
    'e_mark_session_started',
    {
      p_session_id: sessionId,
      p_local_date: getLocalDateKey(localDate),
    }
  );

  if (error) {
    throw new Error(error.message);
  }

  return data ?? {
    status: 'UNKNOWN',
  };
}

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

function normalizeMechanic(value) {
  const mechanic = String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/[\s/-]+/g, '_');

  return mechanic || null;
}

function humanizeMechanic(value, variant = null) {
  const mechanic = normalizeMechanic(value);
  const normalizedVariant = normalizeMechanic(variant);

  if (
    mechanic === 'PROGRESSIVE_INTERVAL' &&
    normalizedVariant === 'DEATH_BY'
  ) {
    return 'DEATH BY';
  }

  if (
    mechanic === 'PROGRESSIVE_INTERVAL' &&
    normalizedVariant === 'DEATH_BY_COUPLET'
  ) {
    return 'DEATH BY COUPLET';
  }

  if (
    mechanic === 'COUPLET' &&
    normalizedVariant === 'ASCENDING_COUPLET'
  ) {
    return 'COUPLET ASCENDANT';
  }

  if (
    mechanic === 'COUPLET' &&
    normalizedVariant === 'DESCENDING_COUPLET'
  ) {
    return 'COUPLET DESCENDANT';
  }

  const labels = {
    AMRAP: 'AMRAP',
    EMOM: 'EMOM',
    FOR_TIME: 'FOR TIME',
    CIRCUIT: 'CIRCUIT',
    STRENGTH: 'MUSCULATION',
    LADDER: 'LADDER',
    PYRAMID: 'PYRAMIDE',
    PROGRESSIVE_INTERVAL: 'PROGRESSIF',
    CHIPPER: 'CHIPPER',
    EVERY_X_MINUTES: 'EVERY X MIN',
    ODD_EVEN: 'ODD / EVEN',
    REP_TARGET: 'REP TARGET',
    COUPLET: 'COUPLET',
    DECK: 'DECK-STYLE',
    HIIT: 'HIIT',
  };

  return labels[mechanic] ??
    mechanic?.replaceAll('_', ' ') ??
    'WOD';
}

function readPrescriptionObject(exercise) {
  if (
    exercise?.prescription_json &&
    typeof exercise.prescription_json === 'object'
  ) {
    return exercise.prescription_json;
  }

  if (
    exercise?.prescription &&
    typeof exercise.prescription === 'object'
  ) {
    return stripRpeFromPrescription(exercise.prescription);
  }

  return {};
}

function formatNumber(value) {
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

function formatRange(
  minValue,
  maxValue,
  suffix
) {
  const min = formatNumber(minValue);
  const max = formatNumber(maxValue);

  if (!min && !max) {
    return null;
  }

  if (min && max && min !== max) {
    return `${min}–${max} ${suffix}`;
  }

  return `${min ?? max} ${suffix}`;
}

function stripRpeFromPrescription(value) {
  if (typeof value !== 'string') {
    return value;
  }

  return value
    .replace(/\s*[·|•]\s*RPE\s*\d+(?:[.,]\d+)?(?:\s*[–-]\s*\d+(?:[.,]\d+)?)?/gi, '')
    .replace(/RPE\s*\d+(?:[.,]\d+)?(?:\s*[–-]\s*\d+(?:[.,]\d+)?)?\s*[·|•]?\s*/gi, '')
    .replace(/\s*[·|•]\s*$/g, '')
    .replace(/^\s*[·|•]\s*/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function formatPrescription(exercise) {
  if (
    typeof exercise?.prescription ===
    'string'
  ) {
    return exercise.prescription;
  }

  const prescription =
    readPrescriptionObject(exercise);

  if (
    typeof prescription.text ===
      'string' &&
    prescription.text.trim()
  ) {
    return stripRpeFromPrescription(prescription.text.trim());
  }

  const protocol =
    prescription.protocol;

  if (
    normalizeMechanic(
      prescription.mechanic
    ) === 'TABATA' &&
    protocol &&
    typeof protocol === 'object'
  ) {
    const work = formatNumber(
      protocol.work_seconds
    );
    const rest = formatNumber(
      protocol.rest_seconds
    );
    const rounds = formatNumber(
      protocol.rounds
    );

    if (work && rest && rounds) {
      return `${rounds} rounds · ${work}s travail / ${rest}s repos`;
    }
  }

  const pieces = [];

  const reps = formatRange(
    prescription.reps_min,
    prescription.reps_max,
    prescription.reps_semantics ===
      'per_side'
      ? 'reps / côté'
      : 'reps'
  );

  const duration = formatRange(
    prescription.duration_seconds_min,
    prescription.duration_seconds_max,
    'sec'
  );

  const distance = formatRange(
    prescription.distance_meters_min,
    prescription.distance_meters_max,
    'm'
  );

  if (reps) {
    pieces.push(reps);
  } else if (duration) {
    pieces.push(duration);
  } else if (distance) {
    pieces.push(distance);
  }

  const load = formatNumber(
    prescription.load_kg
  );

  if (load) {
    const scope =
      prescription.load_scope ===
      'per_implement'
        ? ' / haltère'
        : '';

    pieces.push(
      `${load} kg${scope}`
    );
  }

  const sets = formatNumber(
    prescription.sets
  );

  if (sets) {
    pieces.unshift(`${sets} séries`);
  }


  if (pieces.length > 0) {
    return pieces.join(' · ');
  }

  if (
    protocol &&
    typeof protocol === 'object'
  ) {
    const work = formatNumber(
      protocol.work_seconds
    );
    const rest = formatNumber(
      protocol.rest_seconds
    );
    const rounds = formatNumber(
      protocol.rounds
    );

    if (work && rest && rounds) {
      return `${rounds} rounds · ${work}s / ${rest}s`;
    }
  }

  return 'Prescription adaptée';
}

function getBlockMechanic(block) {
  return normalizeMechanic(
    block?.mechanic ??
      block?.mechanic_json
        ?.mechanic_key ??
      null
  );
}

function getBlockVariant(block) {
  return (
    block?.variant_key ??
    block?.mechanic_json?.variant_key ??
    block?.mechanic_json?.variant ??
    null
  );
}

function getBlockParameters(block) {
  if (
    block?.mechanic_json?.parameters &&
    typeof block.mechanic_json
      .parameters === 'object'
  ) {
    return block.mechanic_json.parameters;
  }

  const firstExercise =
    block?.exercises?.[0];

  const prescription =
    readPrescriptionObject(
      firstExercise
    );

  return (
    prescription.block_parameters ??
    prescription.protocol ??
    {}
  );
}

function buildMechanicStructure(
  block,
  durationMinutes
) {
  if (
    typeof block?.structure ===
      'string' &&
    block.structure.trim()
  ) {
    return block.structure.trim();
  }

  const mechanic =
    getBlockMechanic(block);

  if (!mechanic) {
    return null;
  }

  const variant =
    getBlockVariant(block);

  const parameters =
    getBlockParameters(block);

  const duration =
    Number(durationMinutes);

  const rounds =
    formatNumber(
      parameters.rounds ??
        parameters.total_rounds
    );

  const intervalSeconds =
    formatNumber(
      parameters.interval_seconds
    );

  const intervalMinutes =
    formatNumber(
      parameters.interval_minutes ??
        parameters.every_minutes
    );

  const rest =
    formatNumber(
      parameters.rest_between_rounds_seconds ??
        parameters.rest_seconds
    );

  const timeCap =
    formatNumber(
      parameters.time_cap_minutes ??
        parameters.cap_minutes
    );

  const targetReps =
    formatNumber(
      parameters.target_reps ??
        parameters.rep_target
    );

  const baseLabel =
    humanizeMechanic(
      mechanic,
      variant
    );

  if (mechanic === 'AMRAP') {
    return Number.isFinite(duration)
      ? `${baseLabel} ${duration} min`
      : baseLabel;
  }

  if (mechanic === 'EMOM') {
    return rounds
      ? `${baseLabel} · ${rounds} minutes`
      : baseLabel;
  }

  if (
    mechanic === 'EVERY_X_MINUTES'
  ) {
    const every =
      intervalMinutes ??
      (intervalSeconds
        ? formatNumber(
            Number(intervalSeconds) /
              60
          )
        : null);

    return every
      ? `${baseLabel} · toutes les ${every} min`
      : baseLabel;
  }

  if (mechanic === 'CIRCUIT') {
    const parts = [baseLabel];

    if (rounds) {
      parts.push(`${rounds} tours`);
    }

    if (rest) {
      parts.push(
        `${rest}s repos / tour`
      );
    }

    return parts.join(' · ');
  }

  if (mechanic === 'HIIT') {
    const work = formatNumber(
      parameters.work_seconds
    );
    const intervalRest = formatNumber(
      parameters.rest_seconds
    );
    const count = formatNumber(
      parameters.exercise_count
    );

    const parts = [baseLabel];

    if (rounds) {
      parts.push(`${rounds} tours`);
    }

    if (count) {
      parts.push(`${count} exercices`);
    }

    if (work && intervalRest) {
      parts.push(`${work}s / ${intervalRest}s`);
    }

    return parts.join(' · ');
  }

  if (mechanic === 'STRENGTH') {
    return rounds
      ? `${baseLabel} · ${rounds} séries`
      : baseLabel;
  }

  if (mechanic === 'FOR_TIME') {
    const parts = [baseLabel];

    if (rounds) {
      parts.push(`${rounds} tours`);
    }

    if (timeCap) {
      parts.push(
        `cap ${timeCap} min`
      );
    }

    return parts.join(' · ');
  }

  if (
    mechanic === 'REP_TARGET' &&
    targetReps
  ) {
    return `${baseLabel} · objectif ${targetReps} reps`;
  }

  if (mechanic === 'CHIPPER') {
    return `${baseLabel} · 1 passage`;
  }

  if (mechanic === 'ODD_EVEN') {
    return `${baseLabel} · alternance minutes impaires / paires`;
  }

  if (
    mechanic === 'LADDER' ||
    mechanic === 'PYRAMID' ||
    mechanic ===
      'PROGRESSIVE_INTERVAL' ||
    mechanic === 'COUPLET'
  ) {
    return baseLabel;
  }

  if (mechanic === 'DECK') {
    return `${baseLabel} · tirage aléatoire encadré`;
  }

  return Number.isFinite(duration)
    ? `${baseLabel} · ${duration} min`
    : baseLabel;
}

function mapGeneratedWorkout(data, preparation) {
  const backendBlocks =
    Array.isArray(data?.blocks)
      ? data.blocks
      : [];

  const exercises =
    backendBlocks.flatMap(
      (block) =>
        (block.exercises ?? []).map(
          (exercise) => {
            const prescriptionJson =
              readPrescriptionObject(
                exercise
              );

            const trackingModes =
              Array.isArray(
                exercise.tracking_modes
              )
                ? exercise.tracking_modes
                : Array.isArray(
                    prescriptionJson
                      .tracking_modes
                  )
                  ? prescriptionJson
                      .tracking_modes
                  : [];

            return {
              id:
                exercise.exercise_id ??
                exercise.id,
              exerciseId:
                exercise.exercise_id ??
                exercise.id,
              sessionExerciseId:
                exercise
                  .session_exercise_id ??
                null,
              block: block.block_key,
              blockKey:
                block.block_key,
              name:
                exercise.name ??
                'Exercice',
              family:
                exercise.family ??
                null,
              prescription:
                formatPrescription(
                  exercise
                ),
              prescriptionJson,
              expectedOutcome:
                exercise
                  .expected_outcome ??
                null,
              status: 'pending',
              trackingType:
                getTrackingType(
                  trackingModes
                ),
              trackingModes,
              instructions:
                exercise.instructions ??
                null,
              tips:
                exercise.tips ?? null,
              pattern:
                exercise.pattern ?? null,
              region:
                exercise.region ?? null,
            };
          }
        )
    );

  const blocks = {};

  for (const block of backendBlocks) {
    const duration =
      Number(
        block.duration_minutes
      );

    const safeDuration =
      Number.isFinite(duration)
        ? duration
        : null;

    const mechanic =
      getBlockMechanic(block);

    const variant =
      getBlockVariant(block);

    const firstPrescription =
      readPrescriptionObject(
        block?.exercises?.[0]
      );

    const blockProtocol =
      firstPrescription?.protocol &&
      typeof firstPrescription.protocol === 'object'
        ? firstPrescription.protocol
        : {};

    blocks[block.block_key] = {
      key: block.block_key,
      title:
        block.block_name ??
        block.block_key,
      duration: safeDuration,
      required:
        block.required ?? null,
      objective:
        block.objective ?? null,
      structure:
        buildMechanicStructure(
          block,
          safeDuration
        ),
      mechanic,
      mechanicLabel:
        mechanic
          ? humanizeMechanic(
              mechanic,
              variant
            )
          : null,
      variant,
      mechanicJson:
        block.mechanic_json ??
        null,
      parameters:
        getBlockParameters(block),
      expectedOutcome:
        block.expected_outcome ??
        null,
      rounds:
        block.rounds ??
        blockProtocol.rounds ??
        null,
      workSeconds:
        block.work_seconds ??
        blockProtocol.work_seconds ??
        null,
      restSeconds:
        block.rest_seconds ??
        blockProtocol.rest_seconds ??
        null,
      rotationMode:
        block.rotation_mode ??
        blockProtocol.rotation ??
        null,
    };
  }

  const wodBlock =
    blocks.wod ??
    null;

  const plannedDuration =
    data?.meta?.architecture
      ?.total_minutes ??
    data?.stimulus
      ?.duration_minutes ??
    data?.meta
      ?.total_duration_minutes ??
    preparation?.duration ??
    45;

  const targetRegion =
    data?.meta?.target_region ??
    data?.stimulus?.target_region ??
    preparation?.region ??
    null;

  return {
    sessionId: data.session_id,
    backendVersion:
      data.version ?? null,
    title:
      targetRegion &&
      targetRegion !== 'AUTO'
        ? targetRegion
        : 'Full Body',
    focus:
      data?.meta?.focus ??
      data?.stimulus?.focus ??
      null,
    format:
      wodBlock?.mechanicLabel ??
      humanizeMechanic(
        data?.wod_solver
          ?.quality_gate
          ?.mechanic ??
          null
      ),
    mechanic:
      wodBlock?.mechanic ??
      null,
    formatVariant:
      wodBlock?.variant ??
      null,
    plannedDuration,
    generatedAt:
      data?.meta?.generated_at ??
      new Date().toISOString(),
    progressionIntent:
      data?.meta
        ?.progression_intent ??
      data?.stimulus
        ?.progression_intent ??
      null,
    stimulus:
      data?.stimulus ?? null,
    wodSolver:
      data?.wod_solver ?? null,
    weeklyLoop:
      data?.meta?.weekly_loop ??
      data?.weekly_loop ??
      null,
    coachNote:
      data?.meta?.coach_note ??
      null,
    resumedExistingSession:
      Boolean(
        data?.meta?.resumed_existing_session
      ),
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
async function enrichWorkoutExerciseMetadata(workout) {
  const source = Array.isArray(workout?.exercises)
    ? workout.exercises
    : [];

  const ids = [
    ...new Set(
      source
        .map((exercise) => exercise.id)
        .filter(Boolean)
    ),
  ];

  if (ids.length === 0) {
    return workout;
  }

  const { data, error } = await supabase
    .from('exercises')
    .select('id, description, instructions, tips, image_path')
    .in('id', ids);

  if (error) {
    console.warn('Exercise metadata enrichment', error.message);
    return workout;
  }

  const metaById = new Map(
    (data ?? []).map((item) => [
      item.id,
      item,
    ])
  );

  return {
    ...workout,
    exercises: source.map((exercise) => {
      const meta = metaById.get(exercise.id);

      if (!meta) {
        return exercise;
      }

      return {
        ...exercise,
        description:
          meta.description ??
          exercise.description ??
          null,
        instructions:
          meta.instructions ??
          exercise.instructions ??
          null,
        tips:
          meta.tips ??
          exercise.tips ??
          null,
        imagePath:
          meta.image_path ??
          exercise.imagePath ??
          null,
      };
    }),
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
    local_date:
      getLocalDateKey(),
  };

  const { data, error } =
    await supabase.functions.invoke(
      'coach-handler',
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

  const mappedWorkout =
    mapGeneratedWorkout(
      data,
      preparation
    );

  return enrichWorkoutExerciseMetadata(
    mappedWorkout
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

function normalizeUserExecutionStatus(status) {
  if (status === 'adapted') {
    return 'adapted';
  }

  if (
    status === 'not_completed' ||
    status === 'skipped'
  ) {
    return 'not_completed';
  }

  return 'completed';
}

function toLegacyStatus(userExecutionStatus) {
  return userExecutionStatus ===
    'not_completed'
    ? 'skipped'
    : 'completed';
}

function normalizeSessionBlockKey(blockKey) {
  if (blockKey === 'warmup') {
    return 'warm_up';
  }

  return blockKey ?? null;
}

async function resolveSessionExerciseInstances(
  sessionId,
  exercises
) {
  const { data, error } = await supabase
    .from('workout_session_exercises')
    .select('id, exercise_id, block_key, position')
    .eq('session_id', sessionId)
    .order('position', { ascending: true });

  if (error) {
    throw error;
  }

  const rows = data ?? [];
  const usedIds = new Set();

  return exercises.map((exercise) => {
    const knownInstanceId =
      exercise.sessionExerciseId ??
      exercise.session_exercise_id ??
      null;

    const expectedBlockKey =
      normalizeSessionBlockKey(
        exercise.blockKey ?? exercise.block
      );

    let match = null;

    if (knownInstanceId) {
      match = rows.find(
        (row) =>
          row.id === knownInstanceId &&
          row.exercise_id === exercise.id &&
          !usedIds.has(row.id)
      );
    }

    if (!match && expectedBlockKey) {
      match = rows.find(
        (row) =>
          row.exercise_id === exercise.id &&
          row.block_key === expectedBlockKey &&
          !usedIds.has(row.id)
      );
    }

    // Fallback conservateur pour les anciennes séances qui n'avaient pas encore
    // blockKey côté front. Le Set garantit qu'une instance ne peut pas être
    // réutilisée deux fois, même si le même exercise_id existe plusieurs fois.
    if (!match) {
      match = rows.find(
        (row) =>
          row.exercise_id === exercise.id &&
          !usedIds.has(row.id)
      );
    }

    if (!match) {
      throw new Error(
        `Impossible de résoudre l'instance de séance pour ${exercise.id}.`
      );
    }

    usedIds.add(match.id);

    return {
      ...exercise,
      sessionExerciseId: match.id,
    };
  });
}

export async function getWorkoutSwapAvailability(sessionId) {
  if (!sessionId) {
    return {
      sessionId: null,
      items: {},
      version: null,
    };
  }

  const { data, error } = await supabase.rpc(
    'get_workout_swap_availability',
    {
      p_session_id: sessionId,
    }
  );

  if (error) {
    throw new Error(
      error?.message ??
        'Impossible de vérifier les remplacements disponibles.'
    );
  }

  return {
    sessionId:
      data?.session_id ?? sessionId,
    items:
      data?.items ?? {},
    version:
      data?.version ?? null,
  };
}

export async function swapWorkoutExercise({
  sessionId,
  sessionExerciseId,
  currentExerciseId,
}) {
  if (!sessionId) {
    throw new Error(
      "Impossible de changer l'exercice : session_id manquant."
    );
  }

  if (!sessionExerciseId && !currentExerciseId) {
    throw new Error(
      "Impossible de changer l'exercice : instance de séance manquante."
    );
  }

  const { data, error } =
    await supabase.functions.invoke(
      'generate-workout',
      {
        body: {
          session_id: sessionId,
          session_exercise_id:
            sessionExerciseId ?? null,
          current_exercise_id:
            currentExerciseId ?? null,
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


export async function getWorkoutFormatOptions(sessionId) {
  if (!sessionId) {
    throw new Error(
      "Impossible de charger les formats : session_id manquant."
    );
  }

  const { data, error } = await supabase.rpc(
    'get_workout_format_options',
    {
      p_session_id: sessionId,
    }
  );

  if (error) {
    throw new Error(
      error?.message ??
        'Impossible de charger les formats disponibles.'
    );
  }

  return {
    sessionId:
      data?.session_id ?? sessionId,
    subscriptionTier:
      data?.subscription_tier ?? 'FREE',
    currentMechanic:
      data?.current_mechanic ?? null,
    currentVariant:
      data?.current_variant ?? null,
    options:
      Array.isArray(data?.options)
        ? data.options
        : [],
    version:
      data?.version ?? null,
  };
}

export async function reloadWorkoutSession({
  sessionId,
  preparationSnapshot = null,
}) {
  if (!sessionId) {
    throw new Error(
      "Impossible de recharger la séance : session_id manquant."
    );
  }

  const { data, error } = await supabase
    .from('workout_sessions')
    .select('id, status, generated_workout')
    .eq('id', sessionId)
    .single();

  if (error) {
    throw error;
  }

  if (!data?.generated_workout) {
    throw new Error(
      "La séance mise à jour est introuvable."
    );
  }

  const mappedWorkout =
    mapGeneratedWorkout(
      {
        ...data.generated_workout,
        session_id: sessionId,
        status:
          data.status ??
          data.generated_workout.status ??
          'generated',
      },
      preparationSnapshot ?? {}
    );

  return enrichWorkoutExerciseMetadata(
    mappedWorkout
  );
}

export async function changeWorkoutFormat({
  sessionId,
  mechanic,
  variantKey = null,
  overlays = [],
}) {
  if (!sessionId) {
    throw new Error(
      "Impossible de changer le format : session_id manquant."
    );
  }

  if (!mechanic) {
    throw new Error(
      "Impossible de changer le format : mécanique manquante."
    );
  }

  const { data, error } =
    await supabase.functions.invoke(
      'change-workout-format',
      {
        body: {
          session_id: sessionId,
          mechanic,
          variant_key:
            variantKey ?? null,
          overlays:
            Array.isArray(overlays)
              ? overlays
              : [],
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
        'Impossible de changer le format.'
    );
  }

  if (data?.error) {
    throw new Error(data.error);
  }

  if (
    data?.classification ===
    'PREMIUM_REQUIRED'
  ) {
    throw new Error(
      'Ce format est réservé à UGEROD Premium.'
    );
  }

  if (
    data?.classification ===
    'NOT_RECOMMENDED'
  ) {
    throw new Error(
      'Ce format n’est pas adapté à cette séance.'
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
  exerciseFeedback = {},
  protocolOutcome = null,
}) {
  if (!sessionId) {
    throw new Error(
      "Impossible d'enregistrer la séance : session_id manquant."
    );
  }

  const rawSessionExercises = Array.isArray(exercises)
    ? exercises.filter((exercise) => exercise?.id)
    : [];

  if (rawSessionExercises.length === 0) {
    throw new Error(
      "Impossible d'enregistrer la séance : aucun exercice disponible."
    );
  }

  const sessionExercises =
    await resolveSessionExerciseInstances(
      sessionId,
      rawSessionExercises
    );

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

    const userExecutionStatus =
      normalizeUserExecutionStatus(
        exercise.status
      );

    const legacyStatus =
      toLegacyStatus(
        userExecutionStatus
      );

    const isPerformed =
      userExecutionStatus !==
      'not_completed';

    const feedbackKey =
      exercise.sessionExerciseId ??
      exercise.id;

    const feedback =
      exerciseFeedback?.[
        feedbackKey
      ] ??
      exerciseFeedback?.[
        exercise.id
      ] ??
      {};

    const reasonCode =
      feedback.reasonCode ??
      exercise.executionReasonCode ??
      null;

    const loadValue =
      loads?.[
        feedbackKey
      ] ??
      loads?.[
        exercise.id
      ];

    const exerciseRpe =
      exercise.rpe ??
      exercise.exerciseRpe ??
      null;

    return {
      session_exercise_id:
        exercise.sessionExerciseId,
      exercise_id: exercise.id,
      status: legacyStatus,
      user_execution_status:
        userExecutionStatus,
      execution_reason_code:
        reasonCode,

      reps_completed:
        isPerformed &&
        trackingModes.includes('reps')
          ? exercise.repsCompleted ??
            exercise.reps_completed ??
            null
          : null,

      weight_kg:
        isPerformed &&
        trackingModes.includes('load')
          ? parseLoadKg(loadValue)
          : null,

      duration_seconds:
        isPerformed &&
        trackingModes.includes('time')
          ? exercise.durationSeconds ??
            exercise.duration_seconds ??
            null
          : null,

      distance_meters:
        isPerformed &&
        trackingModes.includes('distance')
          ? exercise.distanceMeters ??
            exercise.distance_meters ??
            null
          : null,

      rpe:
        isPerformed
          ? exerciseRpe
          : null,

      notes:
        exercise.notes ?? null,
    };
  });

  const { data, error } =
    await supabase.functions.invoke(
      'hyper-api-instance',
      {
        body: {
          session_id: sessionId,
          post_workout_feeling: formAfter,
          global_rpe: rpe,
          notes: notes?.trim() || null,
          exercises: results,
          protocol_outcome:
            protocolOutcome &&
            typeof protocolOutcome === 'object'
              ? protocolOutcome
              : null,
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