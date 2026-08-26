import { supabase } from '../lib/supabase';

async function getAuthenticatedUser() {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error) {
    throw error;
  }

  if (!user) {
    throw new Error(
      'Aucun utilisateur connecté. Reconnecte-toi puis recommence.'
    );
  }

  return user;
}

function throwRpcError(error, fallback) {
  if (!error) {
    return;
  }

  throw new Error(
    error.message || fallback
  );
}

export async function getUserSessionBuilderBootstrap(
  environmentCode = null
) {
  const { data, error } = await supabase.rpc(
    'get_user_session_builder_bootstrap_v1',
    {
      p_environment_code: environmentCode,
    }
  );

  throwRpcError(
    error,
    'Impossible de charger le constructeur de séance.'
  );

  return data ?? {};
}

export async function createUserSessionDraft({
  environmentCode,
  durationMinutes,
  surfaceCode = null,
  formatCode = null,
  readiness = 'normal',
  focus = 'General Fitness',
  targetRegion = null,
  progressionIntent = 'MAINTAIN',
  availableEquipment = [],
  injuredZones = [],
  notes = null,
}) {
  const user = await getAuthenticatedUser();

  const { data, error } = await supabase.rpc(
    'create_user_session_draft_v1',
    {
      p_user_id: user.id,
      p_environment_code: environmentCode,
      p_duration_minutes: durationMinutes,
      p_surface_code: surfaceCode,
      p_format_code: formatCode,
      p_readiness: readiness,
      p_focus: focus,
      p_target_region: targetRegion,
      p_progression_intent: progressionIntent,
      p_available_equipment: availableEquipment,
      p_injured_zones: injuredZones,
      p_notes: notes,
    }
  );

  throwRpcError(
    error,
    'Impossible de créer le brouillon de séance.'
  );

  return data ?? null;
}

export async function getUserSessionDraft(
  draftId
) {
  const { data, error } = await supabase.rpc(
    'get_user_session_draft_v1',
    {
      p_draft_id: draftId,
    }
  );

  throwRpcError(
    error,
    'Impossible de charger le brouillon.'
  );

  return data ?? null;
}

export async function updateUserSessionDraftContext({
  draftId,
  environmentCode = null,
  durationMinutes = null,
  surfaceCode = null,
  formatCode = null,
  readiness = null,
  focus = null,
  targetRegion = null,
  progressionIntent = null,
  availableEquipment = null,
  injuredZones = null,
  notes = null,
}) {
  const { data, error } = await supabase.rpc(
    'update_user_session_draft_context_v1',
    {
      p_draft_id: draftId,
      p_environment_code: environmentCode,
      p_duration_minutes: durationMinutes,
      p_surface_code: surfaceCode,
      p_format_code: formatCode,
      p_readiness: readiness,
      p_focus: focus,
      p_target_region: targetRegion,
      p_progression_intent: progressionIntent,
      p_available_equipment: availableEquipment,
      p_injured_zones: injuredZones,
      p_notes: notes,
    }
  );

  throwRpcError(
    error,
    'Impossible de mettre à jour le contexte de séance.'
  );

  return data ?? null;
}

export async function replaceUserSessionDraftStructure({
  draftId,
  blocks,
}) {
  const { data, error } = await supabase.rpc(
    'replace_user_session_draft_structure_v1',
    {
      p_draft_id: draftId,
      p_blocks: Array.isArray(blocks) ? blocks : [],
    }
  );

  throwRpcError(
    error,
    'Impossible d’enregistrer la structure de séance.'
  );

  return data ?? null;
}

export async function getUserSessionBuilderExercises({
  draftId,
  moduleCode,
  query = null,
  limit = 60,
}) {
  const { data, error } = await supabase.rpc(
    'get_user_session_builder_exercises_v1',
    {
      p_draft_id: draftId,
      p_module_code: moduleCode,
      p_query: query,
      p_limit: limit,
      p_max_complexity: 3,
      p_max_difficulty: 'Intermédiaire',
    }
  );

  throwRpcError(
    error,
    'Impossible de charger les exercices.'
  );

  return data ?? {
    results: [],
  };
}

export async function validateUserSessionDraft(
  draftId
) {
  const { data, error } = await supabase.rpc(
    'validate_user_session_draft_v1',
    {
      p_draft_id: draftId,
      p_max_complexity: 3,
      p_max_difficulty: 'Intermédiaire',
    }
  );

  throwRpcError(
    error,
    'Impossible de valider la séance.'
  );

  return data ?? null;
}

export async function commitUserSessionDraft({
  draftId,
  startNow = false,
  acceptWarnings = false,
}) {
  const { data, error } = await supabase.rpc(
    'commit_user_session_draft_v1',
    {
      p_draft_id: draftId,
      p_start_now: startNow,
      p_accept_warnings: acceptWarnings,
    }
  );

  throwRpcError(
    error,
    'Impossible d’enregistrer la séance.'
  );

  return data ?? null;
}
