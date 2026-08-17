import { supabase } from '../lib/supabase';

async function requireUser() {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error) throw new Error(error.message);
  if (!user?.id) throw new Error('Utilisateur non authentifié.');
  return user;
}

export async function searchExternalSessionExercises(query = '') {
  await requireUser();

  let request = supabase
    .from('exercises')
    .select('id, name, tracking_modes, prescription_type, exercise_family, movement_pattern')
    .order('name', { ascending: true })
    .limit(30);

  const term = String(query ?? '').trim();
  if (term) request = request.ilike('name', `%${term}%`);

  const { data, error } = await request;
  if (error) throw new Error(error.message);
  return data ?? [];
}

function cleanActual(item) {
  const actual = {
    user_execution_status: 'completed',
  };

  const reps = Number(item.reps);
  const load = Number(String(item.loadKg ?? '').replace(',', '.'));
  const duration = Number(item.durationSeconds);
  const distance = Number(String(item.distanceMeters ?? '').replace(',', '.'));
  const rpe = Number(item.rpe);

  if (Number.isFinite(reps) && reps >= 0) actual.reps_completed = reps;
  if (Number.isFinite(load) && load >= 0) actual.load_kg = load;
  if (Number.isFinite(duration) && duration >= 0) actual.duration_seconds = duration;
  if (Number.isFinite(distance) && distance >= 0) actual.distance_meters = distance;
  if (Number.isFinite(rpe) && rpe >= 1 && rpe <= 10) actual.rpe = rpe;

  return actual;
}

export async function saveStructuredExternalSession({
  durationMinutes,
  performedAt = new Date(),
  globalRpe = null,
  postWorkoutFeeling = null,
  notes = null,
  exercises = [],
}) {
  await requireUser();

  if (!Array.isArray(exercises) || exercises.length === 0) {
    throw new Error('Ajoute au moins un exercice.');
  }

  const duration = Number(durationMinutes);
  if (!Number.isFinite(duration) || duration < 10 || duration > 300) {
    throw new Error('La durée doit être comprise entre 10 et 300 minutes.');
  }

  const rawText = exercises
    .map((item) => item.exercise?.name)
    .filter(Boolean)
    .join(', ');

  const { data: created, error: createError } = await supabase.rpc(
    'create_external_session_import_v1',
    {
      p_raw_text: rawText,
      p_input_type: 'manual',
      p_source_metadata: {
        duration_minutes: duration,
        performed_at: performedAt.toISOString(),
        entry_mode: 'structured_manual_v1',
      },
    }
  );

  if (createError) throw new Error(createError.message);
  const importId = created?.import_id;
  if (!importId) throw new Error('Import externe non créé.');

  const parserItems = exercises.map((item) => ({
    raw_name: item.exercise.name,
    suggested_exercise_id: item.exercise.id,
    confidence: 1,
    structured: {
      block_key: 'external',
      actual: cleanActual(item),
    },
  }));

  const { error: parseError } = await supabase.rpc(
    'apply_external_parser_output_v1',
    {
      p_import_id: importId,
      p_parser_name: 'ugerod_structured_manual',
      p_parser_version: '1',
      p_parser_output: {
        duration_minutes: duration,
        items: parserItems,
      },
    }
  );

  if (parseError) throw new Error(parseError.message);

  const { data: review, error: reviewError } = await supabase.rpc(
    'get_external_import_review_v1',
    {
      p_import_id: importId,
    }
  );

  if (reviewError) throw new Error(reviewError.message);

  const reviewItems = review?.items ?? [];
  if (reviewItems.length !== exercises.length) {
    throw new Error('La séance doit être revue avant validation.');
  }

  for (let index = 0; index < reviewItems.length; index += 1) {
    const reviewItem = reviewItems[index];
    const source = exercises[index];

    const { error: confirmError } = await supabase.rpc(
      'confirm_external_session_item_v1',
      {
        p_item_id: reviewItem.item_id,
        p_exercise_id: source.exercise.id,
        p_structured_patch: {
          block_key: 'external',
          actual: cleanActual(source),
        },
      }
    );

    if (confirmError) throw new Error(confirmError.message);
  }

  const sessionMeta = {
    duration_minutes: duration,
    performed_at: performedAt.toISOString(),
    focus: 'General Fitness',
    mechanic: 'EXTERNAL',
  };

  const globalRpeNumber = Number(globalRpe);
  if (Number.isFinite(globalRpeNumber) && globalRpeNumber >= 1 && globalRpeNumber <= 10) {
    sessionMeta.global_rpe = globalRpeNumber;
  }

  const feelingNumber = Number(postWorkoutFeeling);
  if (Number.isFinite(feelingNumber) && feelingNumber >= 1 && feelingNumber <= 10) {
    sessionMeta.post_workout_feeling = feelingNumber;
  }

  if (notes?.trim()) sessionMeta.notes = notes.trim();

  const { data: committed, error: commitError } = await supabase.rpc(
    'commit_validated_external_session_v1',
    {
      p_import_id: importId,
      p_session_meta: sessionMeta,
    }
  );

  if (commitError) throw new Error(commitError.message);
  return committed;
}
