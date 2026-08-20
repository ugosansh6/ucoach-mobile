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
    return (categorizedData ?? []).map((item) => ({
      ...item,
      locations: Array.isArray(item.locations)
        ? item.locations
        : [],
      exercise_count: Number(item.exercise_count ?? 0),
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
    exercise_count: null,
  }));
}

export async function getUserEquipmentInventory() {
  const user = await getAuthenticatedUser();

  const { data, error } = await supabase
    .from('user_equipment_inventory')
    .select(
      'id, equipment_id, inventory_mode, quantity, load_kg, min_load_kg, max_load_kg, increment_kg, resistance_label, active, notes'
    )
    .eq('user_id', user.id)
    .eq('active', true)
    .order('equipment_id', { ascending: true })
    .order('load_kg', { ascending: true });

  if (error) {
    throw error;
  }

  return data ?? [];
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
  const { data, error } = await supabase.rpc(
    'replace_user_equipment_inventory',
    {
      p_rows: normalizedRows,
    }
  );

  if (error) {
    throw error;
  }

  return Array.isArray(data) ? data : [];
}
