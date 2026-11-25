import { supabase } from '../lib/supabase';
import {
  getAuthenticatedUserWithRetry,
  runSupabaseRequestWithAuthRetry,
} from '../lib/supabaseAuthRetry';

async function getAuthenticatedUser() {
  return getAuthenticatedUserWithRetry();
}

export async function getEquipmentCatalog() {
  const {
    data: categorizedData,
    error: categorizedError,
  } = await supabase
    .from('equipment_catalog_v2')
    .select(
      'id, name, category, description, locations, exercise_count'
    )
    .order('name', { ascending: true });

  if (!categorizedError) {
    return (categorizedData ?? [])
      .filter(
        (item) =>
          item.id === 'E00' ||
          item.exercise_count === null ||
          item.exercise_count === undefined ||
          Number(item.exercise_count) > 0
      )
      .map((item) => ({
        ...item,
        locations: Array.isArray(item.locations)
          ? item.locations
          : [],
      }));
  }

  /*
   * Compatibilité temporaire avec un environnement plus ancien
   * qui n'aurait pas encore reçu equipment_catalog_v2.
   */
  const { data, error } = await supabase
    .from('equipment')
    .select('id, name, category, description')
    .order('id', { ascending: true });

  if (error) {
    throw categorizedError ?? error;
  }

  return (data ?? []).map((item) => ({
    ...item,
    locations: [],
  }));
}

export async function getUserEquipmentInventory() {
  const user = await getAuthenticatedUser();

  const data = await runSupabaseRequestWithAuthRetry(() =>
    supabase
      .from('user_equipment_inventory')
      .select(
        'id, equipment_id, inventory_mode, quantity, load_kg, min_load_kg, max_load_kg, increment_kg, resistance_label, active, notes'
      )
      .eq('user_id', user.id)
      .eq('active', true)
      .order('equipment_id', { ascending: true })
      .order('load_kg', { ascending: true })
  );

  return data ?? [];
}

function normalizeEnvironmentCode(value) {
  const code = String(value ?? 'HOME').trim().toUpperCase();
  return ['HOME', 'BOX', 'GYM', 'OUTDOOR'].includes(code) ? code : 'HOME';
}

export async function getUserEnvironmentEquipmentPreset(environmentCode = 'HOME') {
  const environment = normalizeEnvironmentCode(environmentCode);

  // HOME reste l'inventaire personnel historique, avec quantité/charges.
  if (environment === 'HOME') {
    return getUserEquipmentInventory();
  }

  const user = await getAuthenticatedUser();
  const data = await runSupabaseRequestWithAuthRetry(() =>
    supabase
      .from('user_environment_equipment_presets')
      .select('equipment_id, created_at, updated_at')
      .eq('user_id', user.id)
      .eq('environment_code', environment)
      .order('equipment_id', { ascending: true })
  );

  return (data ?? []).map((row) => ({
    ...row,
    inventory_mode: 'non_load',
    quantity: 1,
    active: true,
  }));
}

export async function replaceUserEnvironmentEquipmentPreset(environmentCode, equipmentIds) {
  await getAuthenticatedUser();
  const environment = normalizeEnvironmentCode(environmentCode);
  const ids = Array.from(
    new Set(
      (Array.isArray(equipmentIds) ? equipmentIds : [])
        .map((value) => String(value ?? '').trim())
        .filter((value) => value && value !== 'E00')
    )
  );

  const data = await runSupabaseRequestWithAuthRetry(() =>
    supabase.rpc('replace_user_environment_equipment_preset', {
      p_environment_code: environment,
      p_equipment_ids: ids,
    })
  );

  return Array.isArray(data) ? data : [];
}

function normalizeInventoryRow(row) {
  const inventoryMode =
    row.inventory_mode ?? 'non_load';

  const base = {
    equipment_id: row.equipment_id,
    inventory_mode: inventoryMode,
    quantity: Math.max(
      1,
      Math.round(Number(row.quantity ?? 1))
    ),
    active: true,
    notes: row.notes ?? null,
  };

  if (inventoryMode === 'load_unknown') {
    return {
      ...base,
      load_kg: null,
      min_load_kg: null,
      max_load_kg: null,
      increment_kg: null,
      resistance_label: null,
    };
  }

  if (inventoryMode === 'fixed_load') {
    const load = Number(row.load_kg);

    if (!Number.isFinite(load) || load <= 0) {
      throw new Error(
        'Une charge fixe doit être supérieure à 0 kg.'
      );
    }

    return {
      ...base,
      load_kg: load,
      min_load_kg: null,
      max_load_kg: null,
      increment_kg: null,
      resistance_label: null,
    };
  }

  if (inventoryMode === 'adjustable_load') {
    const min = Number(row.min_load_kg);
    const max = Number(row.max_load_kg);
    const increment = Number(row.increment_kg);

    if (!Number.isFinite(min) || min <= 0) {
      throw new Error(
        'La charge minimale doit être supérieure à 0 kg.'
      );
    }

    if (!Number.isFinite(max) || max < min) {
      throw new Error(
        'La charge maximale doit être supérieure ou égale à la charge minimale.'
      );
    }

    if (
      !Number.isFinite(increment) ||
      increment <= 0
    ) {
      throw new Error(
        "L'incrément de charge doit être supérieur à 0 kg."
      );
    }

    return {
      ...base,
      load_kg: null,
      min_load_kg: min,
      max_load_kg: max,
      increment_kg: increment,
      resistance_label: null,
    };
  }

  return {
    ...base,
    inventory_mode: 'non_load',
    load_kg: null,
    min_load_kg: null,
    max_load_kg: null,
    increment_kg: null,
    resistance_label:
      row.resistance_label?.trim() || null,
  };
}

export async function replaceUserEquipmentInventory(rows) {
  await getAuthenticatedUser();

  const normalizedRows = Array.isArray(rows)
    ? rows
        .filter((row) => row?.equipment_id)
        .map(normalizeInventoryRow)
    : [];

  /*
   * F-C2 : remplacement atomique côté PostgreSQL.
   * Si une ligne est invalide, toute l'opération est annulée :
   * l'ancien inventaire n'est jamais supprimé à moitié.
   */
  const data = await runSupabaseRequestWithAuthRetry(() =>
    supabase.rpc(
      'replace_user_equipment_inventory',
      {
        p_rows: normalizedRows,
      }
    )
  );

  return Array.isArray(data) ? data : [];
}
