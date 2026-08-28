import { supabase } from '../lib/supabase';
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

async function currentUserId() {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error) throw error;
  if (!user?.id) {
    throw new Error('Aucun utilisateur connecté.');
  }
  return user.id;
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
    };
  }

  if (status === 'EXISTING_GENERATED_SESSION_CONFLICT') {
    return {
      controlStatus: 'ENVIRONMENT_CHANGE_CONFIRM_REQUIRED',
      sessionId: data?.session_id ?? null,
      environmentControlStatus: status,
      existingEnvironmentCode: data?.existing_environment_code ?? null,
      requestedEnvironmentCode: data?.requested_environment_code ?? null,
    };
  }

  return null;
}

async function generateEnvironmentWorkoutSession(preparation) {
  const environmentCode = normalizeEnvironment(preparation?.environmentCode);
  const userId = await currentUserId();
  const focus = await resolveFocus();
  const { inventory, availableEquipment } =
    await buildSelectedInventory(preparation);

  const params = {
    p_user_id: userId,
    p_environment_code: environmentCode,
    p_surface_code: preparation?.surfaceCode ?? null,
    p_requested_format_code: preparation?.formatCode ?? null,
    p_execution_style: preparation?.executionStyle ?? null,
    p_user_focus: focus,
    p_duration_minutes: preparation?.duration ?? 45,
    p_readiness: String(preparation?.readiness ?? 6),
    p_target_region: preparation?.region ?? null,
    p_progression_intent: preparation?.progressionIntent ?? 'MAINTAIN',
    p_zone_terms: (preparation?.painZones ?? []).filter(
      (zone) => zone && zone !== 'Aucune'
    ),
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

  const { data, error } = await supabase.rpc(
    'generate_environment_session_v3',
    params
  );

  if (error) {
    throw new Error(
      error?.message ?? 'Impossible de générer la séance pour cet environnement.'
    );
  }

  if (data?.status === 'ENVIRONMENT_GENERATION_NOT_READY') {
    const reason =
      data?.policy?.reason_code ??
      data?.policy?.compiler_status ??
      'ENVIRONMENT_GENERATION_NOT_READY';
    throw new Error(`Génération ${environmentCode} indisponible : ${reason}.`);
  }

  const control = normalizeEnvironmentControl(data);
  if (control) return control;

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

export async function generateWorkoutSession(preparation, options = {}) {
  const environmentCode = normalizeEnvironment(preparation?.environmentCode);

  if (!['GYM', 'OUTDOOR'].includes(environmentCode)) {
    return generateLegacyWorkoutSession(preparation, options);
  }

  return generateEnvironmentWorkoutSession(preparation);
}
