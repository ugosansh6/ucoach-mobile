import { supabase } from '../lib/supabase';
import { runSupabaseRequestWithAuthRetry } from '../lib/supabaseAuthRetry';
import {
  getEquipmentCatalog,
  getUserEquipmentInventory,
} from './equipmentService';
import {
  generateWorkoutSession as generateLegacyWorkoutSession,
  reloadWorkoutSession,
} from './workoutService';
import { getCurrentPrimaryGoal } from './goalsService';

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizeEnvironment(value) {
  return String(value ?? '').trim().toUpperCase();
}

function selectedEquipmentNames(preparation) {
  return (Array.isArray(preparation?.equipment) ? preparation.equipment : [])
    .filter(Boolean)
    .filter((name) => name !== 'Poids du corps' && name !== 'Aucun');
}

function injuredZoneNames(preparation) {
  return (Array.isArray(preparation?.painZones) ? preparation.painZones : [])
    .filter(Boolean)
    .filter((zone) => zone !== 'Aucune');
}

async function resolveFocus() {
  try {
    const goal = await getCurrentPrimaryGoal();
    return goal?.name ?? 'General Fitness';
  } catch {
    return 'General Fitness';
  }
}

async function buildSelectedInventory(preparation) {
  const names = selectedEquipmentNames(preparation);
  if (names.length === 0) {
    return {
      inventory: [],
      availableEquipment: [],
    };
  }

  const [catalog, inventory] = await Promise.all([
    getEquipmentCatalog(),
    getUserEquipmentInventory(),
  ]);

  const selectedNameSet = new Set(names);
  const selectedIds = new Set(
    (catalog ?? [])
      .filter((item) => selectedNameSet.has(item.name))
      .map((item) => item.id)
  );

  const selectedInventory = (inventory ?? [])
    .filter((row) => selectedIds.has(row.equipment_id))
    .map((row) => ({
      equipment_id: row.equipment_id,
      inventory_mode: row.inventory_mode ?? 'non_load',
      quantity: Math.max(1, Number(row.quantity ?? 1)),
      load_kg: row.load_kg ?? null,
      min_load_kg: row.min_load_kg ?? null,
      max_load_kg: row.max_load_kg ?? null,
      increment_kg: row.increment_kg ?? null,
      resistance_label: row.resistance_label ?? null,
    }));

  return {
    inventory: selectedInventory,
    availableEquipment: names,
  };
}

function normalizeEnvironmentControl(data) {
  const status = String(data?.status ?? '').toUpperCase();

  if (status === 'ACTIVE_SESSION_CONFIRM_REQUIRED') {
    return {
      controlStatus: 'STARTED_SESSION_CONFIRM_REQUIRED',
      sessionId: data?.session_id ?? null,
      environmentControlStatus: status,
      existingSessionStarted: true,
    };
  }

  if (status === 'EXISTING_GENERATED_SESSION_CONFLICT') {
    return {
      controlStatus: 'ENVIRONMENT_CHANGE_CONFIRM_REQUIRED',
      sessionId: data?.session_id ?? null,
      environmentControlStatus: status,
      existingEnvironmentCode: data?.existing_environment_code ?? null,
      requestedEnvironmentCode: data?.requested_environment_code ?? null,
      existingSessionStarted: false,
    };
  }

  return null;
}

function normalizeCoachControl(data) {
  const status = String(data?.status ?? '').toUpperCase();

  if (!['STARTED_SESSION_CONFIRM_REQUIRED', 'RECALC_LIMIT_REACHED'].includes(status)) {
    return null;
  }

  return {
    controlStatus: status,
    sessionId: data?.session_id ?? null,
    changedFields: Array.isArray(data?.changed_fields) ? data.changed_fields : [],
    warningCode: data?.warning_code ?? null,
    contextRecalculationCount: Number(data?.context_recalculation_count ?? 0),
    contextRecalculationLimit: Number(data?.context_recalculation_limit ?? 3),
    startedAt: data?.started_at ?? null,
    startedLocalDate: data?.started_local_date ?? null,
  };
}

function environmentGenerationError(data, environmentCode) {
  const status = String(data?.status ?? '').toUpperCase();
  const reason = String(
    data?.reason_code ??
      data?.policy?.reason_code ??
      data?.policy?.compiler_status ??
      ''
  ).toUpperCase();

  const messages = {
    SURFACE_REQUIRED_OUTDOOR: 'Choisis le sol avant de valider ta séance extérieure.',
    DURATION_TOO_SHORT_FOR_CONDITIONING_PLUS_HOME_BOX_WOD:
      'La durée choisie est trop courte pour combiner Conditioning et WOD en gardant les deux blocs cohérents.',
    HOME_BOX_WOD_NOT_COMPILABLE_OUTDOOR:
      'UGEROD ne trouve pas de WOD compatible avec ton contexte extérieur actuel.',
    HOME_BOX_WOD_BLOCK_MISSING:
      'UGEROD ne peut pas construire le WOD demandé avec ce contexte.',
    OUTDOOR_CONDITIONING_NOT_COMPILABLE:
      'UGEROD ne trouve pas de bloc Conditioning compatible avec ton contexte actuel.',
    OUTDOOR_SAFETY_OR_FEASIBILITY_CONFLICT:
      'Le contexte extérieur choisi ne permet pas de construire cette séance en respectant les garde-fous.',
  };

  if (messages[reason]) return messages[reason];

  if (status === 'BLOCKED') {
    return `UGEROD ne peut pas construire cette séance ${environmentCode === 'OUTDOOR' ? 'extérieure' : 'en salle'} avec le contexte actuel.`;
  }

  return null;
}

async function generateHomeBoxWorkoutSession(preparation, options = {}) {
  const environmentCode = normalizeEnvironment(preparation?.environmentCode) || 'HOME';
  const focus = await resolveFocus();
  const availableEquipment = selectedEquipmentNames(preparation);

  const data = await runSupabaseRequestWithAuthRetry(() =>
    supabase.functions.invoke('coach-handler', {
      body: {
        duration_minutes: preparation?.duration ?? 45,
        readiness: preparation?.readiness ?? 6,
        available_equipment:
          availableEquipment.length > 0 ? availableEquipment : ['Aucun'],
        injured_zones: injuredZoneNames(preparation),
        target_region: preparation?.region ?? null,
        format_preference: null,
        focus_override: focus,
        progression_intent: preparation?.progressionIntent ?? null,
        local_date: localDateKey(),
        force_recalculate_started: Boolean(options?.forceRecalculateStarted),
        protected_session_exercise_ids: Array.isArray(options?.protectedSessionExerciseIds)
          ? options.protectedSessionExerciseIds.filter(Boolean)
          : [],
        environment_code: environmentCode,
        surface_code: preparation?.surfaceCode ?? null,
        environment_format_code: null,
        gym_execution_style: null,
      },
    })
  );

  if (data?.error) {
    throw new Error(data.error);
  }

  const control = normalizeCoachControl(data);
  if (control) return control;

  if (!data?.session_id) {
    throw new Error("La génération n'a pas retourné de session_id.");
  }

  const reloaded = await reloadWorkoutSession({
    sessionId: data.session_id,
    preparationSnapshot: preparation,
  });

  return {
    ...reloaded,
    backendVersion: data?.version ?? reloaded?.backendVersion ?? null,
    coachNote: data?.meta?.coach_note ?? reloaded?.coachNote ?? null,
    generationControlStatus:
      data?.generation_control_status ??
      data?.meta?.generation_control_status ??
      reloaded?.generationControlStatus ??
      null,
    safetyAdaptation:
      data?.safety_adaptation ??
      data?.meta?.safety_adaptation ??
      reloaded?.safetyAdaptation ??
      null,
    meta: {
      ...(reloaded?.meta ?? {}),
      ...(data?.meta ?? {}),
      environment_code: environmentCode,
    },
  };
}

async function generateEnvironmentWorkoutSession(preparation) {
  const environmentCode = normalizeEnvironment(preparation?.environmentCode);
  const focus = await resolveFocus();
  const { inventory, availableEquipment } =
    await buildSelectedInventory(preparation);

  const params = {
    p_environment_code: environmentCode,
    p_surface_code: preparation?.surfaceCode ?? null,
    p_requested_format_code: preparation?.formatCode ?? null,
    p_execution_style: preparation?.executionStyle ?? null,
    p_user_focus: focus,
    p_duration_minutes: preparation?.duration ?? 45,
    p_readiness: String(preparation?.readiness ?? 6),
    p_target_region: preparation?.region ?? null,
    p_progression_intent: preparation?.progressionIntent ?? 'MAINTAIN',
    p_zone_terms: injuredZoneNames(preparation),
    p_inventory: inventory,
    p_available_equipment: availableEquipment,
    p_outdoor_place_code: preparation?.outdoorPlaceCode ?? null,
    p_reliable_distance: Boolean(preparation?.reliableDistance),
    p_running_allowed: preparation?.runningAllowed !== false,
    p_calibration_opportunity: Boolean(preparation?.calibrationOpportunity),
    p_max_complexity: 3,
    p_max_difficulty: 'Intermédiaire',
    p_candidate_count: environmentCode === 'OUTDOOR' ? 16 : 20,
    p_policy_key: 'c4-final-default',
    p_start_now: false,
    p_anchor_date: localDateKey(),
  };

  const response = await runSupabaseRequestWithAuthRetry(() =>
    supabase.functions.invoke(
      'environment-session-handler',
      {
        body: { params },
      }
    )
  );

  if (!response?.ok) {
    throw new Error(
      response?.error ?? 'Impossible de générer la séance pour cet environnement.'
    );
  }

  const data = response?.result ?? null;

  if (data?.status === 'ENVIRONMENT_GENERATION_NOT_READY') {
    const reason =
      data?.policy?.reason_code ??
      data?.policy?.compiler_status ??
      'ENVIRONMENT_GENERATION_NOT_READY';
    throw new Error(`Génération ${environmentCode} indisponible : ${reason}.`);
  }

  const control = normalizeEnvironmentControl(data);
  if (control) return control;

  const friendlyError = environmentGenerationError(data, environmentCode);
  if (friendlyError) {
    throw new Error(friendlyError);
  }

  if (!data?.session_id) {
    throw new Error("La génération environnement n'a pas retourné de session_id.");
  }

  const reloaded = await reloadWorkoutSession({
    sessionId: data.session_id,
    preparationSnapshot: preparation,
  });

  return {
    ...reloaded,
    generationControlStatus:
      String(data?.status ?? '').toLowerCase() === 'resume_existing'
        ? 'resume_existing'
        : reloaded?.generationControlStatus ?? null,
  };
}

export async function discardUnstartedWorkoutSession(sessionId) {
  if (!sessionId) {
    throw new Error('Aucune séance à remplacer.');
  }

  const data = await runSupabaseRequestWithAuthRetry(() =>
    supabase.rpc(
      'discard_unstarted_workout_session_v1',
      { p_session_id: sessionId }
    )
  );

  if (data?.status === 'STARTED_SESSION_PROTECTED') {
    throw new Error(
      'Cette séance a déjà démarré : elle doit être reprise et ne peut plus être remplacée.'
    );
  }

  if (!data?.discarded) {
    throw new Error('La séance précédente ne peut pas être remplacée.');
  }

  return data;
}

export async function generateWorkoutSession(preparation, options = {}) {
  const environmentCode = normalizeEnvironment(preparation?.environmentCode) || 'HOME';

  if (['HOME', 'BOX'].includes(environmentCode)) {
    return generateHomeBoxWorkoutSession(
      {
        ...preparation,
        environmentCode,
      },
      options
    );
  }

  if (['GYM', 'OUTDOOR'].includes(environmentCode)) {
    return generateEnvironmentWorkoutSession(preparation);
  }

  return generateLegacyWorkoutSession(preparation, options);
}
