import { supabase } from '../lib/supabase';
import {
  getAuthenticatedUserWithRetry,
  runSupabaseRequestWithAuthRetry,
} from '../lib/supabaseAuthRetry';

const ENGINE_POLICY = 'c4-final-default';

const BLOCK_ROLE = {
  WARMUP: 'Warm-up',
  TABATA: 'Core',
  STRENGTH: 'STRENGTH',
  SKILL: 'Skill',
  WOD: 'WOD',
};

export async function getComposerArchitectureTargets(durationMinutes) {
  const { data, error } = await supabase.rpc('c4_session_architecture_targets_v2', {
    p_duration_minutes: Number(durationMinutes),
    p_policy_key: ENGINE_POLICY,
  });
  if (error) throw error;
  return data ?? {};
}

function scoreExercise(exercise, focus, targetRegion) {
  let score = Number(exercise.selection_weight ?? 0);
  const focusKey = String(focus ?? '').toLowerCase();
  const regionKey = String(targetRegion ?? '').toLowerCase();
  const exerciseFocus = String(exercise.training_focus ?? '').toLowerCase();
  const exerciseRegion = String(exercise.body_region ?? '').toLowerCase();

  if (focusKey && exerciseFocus.includes(focusKey)) score += 20;
  if (regionKey && exerciseRegion.includes(regionKey)) score += 14;
  if (exercise.display_name) score += 1;
  return score;
}

export async function getComposerExerciseCandidates({
  blockType,
  focus,
  targetRegion = null,
  environmentCode = 'HOME',
  equipmentIds = [],
  limit = 8,
}) {
  const role = BLOCK_ROLE[blockType] ?? 'WOD';
  let query = supabase
    .from('exercises')
    .select('id,name,display_name,description,instructions,tips,image_path,exercise_type,difficulty,technical_complexity,movement_pattern,exercise_family,body_region,training_focus,equipment_requirement,selection_weight,usable_for,home_friendly,prescription_type,tabata_eligible,warmup_eligible,warmup_role,wod_role')
    .order('selection_weight', { ascending: false })
    .limit(80);

  if (blockType === 'WARMUP') query = query.eq('warmup_eligible', true);
  else if (blockType === 'TABATA') query = query.eq('tabata_eligible', true);
  else query = query.contains('usable_for', [role]);

  if (String(environmentCode).toUpperCase() === 'HOME') {
    query = query.eq('home_friendly', true);
  }

  const { data: exercises, error } = await query;
  if (error) throw error;
  if (!exercises?.length) return [];

  const ids = exercises.map((exercise) => exercise.id);
  const { data: requirements, error: requirementsError } = await supabase
    .from('exercise_equipment')
    .select('exercise_id,equipment_id')
    .in('exercise_id', ids);
  if (requirementsError) throw requirementsError;

  const requiredIds = [...new Set((requirements ?? []).map((row) => String(row.equipment_id)).filter((id) => id && id !== 'E00'))];
  const { data: equipmentRows, error: equipmentError } = requiredIds.length
    ? await supabase.from('equipment').select('id,name').in('id', requiredIds)
    : { data: [], error: null };
  if (equipmentError) throw equipmentError;
  const equipmentNamesById = new Map((equipmentRows ?? []).map((item) => [String(item.id), item.name]));
  const available = new Set(['E00', ...(equipmentIds ?? []).map(String)]);
  const byExercise = new Map();
  (requirements ?? []).forEach((row) => {
    const list = byExercise.get(row.exercise_id) ?? [];
    list.push(String(row.equipment_id));
    byExercise.set(row.exercise_id, list);
  });

  return exercises
    .filter((exercise) => {
      const reqs = byExercise.get(exercise.id) ?? [];
      if (reqs.length === 0) return true;
      return reqs.every((equipmentId) => available.has(equipmentId));
    })
    .map((exercise) => ({
      id: exercise.id,
      name: exercise.display_name || exercise.name,
      description: exercise.description ?? null,
      instructions: exercise.instructions ?? null,
      tips: exercise.tips ?? null,
      imagePath: exercise.image_path ?? null,
      difficulty: exercise.difficulty ?? null,
      exerciseType: exercise.exercise_type ?? null,
      trainingFocus: exercise.training_focus ?? null,
      equipmentIds: (byExercise.get(exercise.id) ?? []).filter((id) => id !== 'E00'),
      equipmentNames: (byExercise.get(exercise.id) ?? [])
        .filter((id) => id !== 'E00')
        .map((id) => equipmentNamesById.get(id) ?? id),
      bodyRegion: exercise.body_region,
      movementPattern: exercise.movement_pattern,
      exerciseFamily: exercise.exercise_family,
      prescriptionType: exercise.prescription_type,
      score: scoreExercise(exercise, focus, targetRegion),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(3, limit));
}

function wodLabel(minutes) {
  if (minutes <= 15) return 'WOD court';
  if (minutes >= 30) return 'WOD long';
  return 'WOD';
}

function block(type, minutes, label = null) {
  return {
    type,
    label: label ?? (type === 'WARMUP' ? 'Warm-up' : type === 'STRENGTH' ? 'Strength' : type === 'TABATA' ? 'Tabata' : type),
    minutes: Math.max(1, Math.round(minutes)),
  };
}

/**
 * Composition is planned within the existing C4 architecture budget.
 * Warm-up and Tabata are always included in the total duration. Only the
 * main blocks are edited first; the user can edit these complements at recap.
 * A WOD-alone option is hidden if it would require an excessively long WOD.
 */
export function buildComposerArchitectures({ durationMinutes, intentKey, targets = {} }) {
  const duration = Math.max(20, Number(durationMinutes) || 45);
  const transitionReserveMinutes = duration <= 30 ? 3 : duration <= 45 ? 4 : 5;
  const warmupMinutes = Math.max(4, Math.min(8, Number(targets.warmup_minutes ?? (duration <= 30 ? 5 : 8))));
  const tabataMinutes = 4;
  const coreMinutes = duration - transitionReserveMinutes - warmupMinutes - tabataMinutes;
  const baseBlocks = [block('WARMUP', warmupMinutes), block('TABATA', tabataMinutes)];
  const options = [];

  function add(key, title, mainBlocks) {
    const blocks = [...baseBlocks, ...mainBlocks];
    options.push({
      key, title, blocks, transitionReserveMinutes,
      estimatedMinutes: blocks.reduce((sum, item) => sum + Number(item.minutes), 0) + transitionReserveMinutes,
    });
  }

  if (coreMinutes >= 16) {
    const strengthMinutes = Math.max(8, Math.min(coreMinutes - 8, Math.round(coreMinutes * 0.46)));
    add('balanced', 'Strength + WOD', [
      block('STRENGTH', strengthMinutes),
      block('WOD', coreMinutes - strengthMinutes, wodLabel(coreMinutes - strengthMinutes)),
    ]);
    const skillMinutes = Math.max(8, Math.min(coreMinutes - 8, Math.round(coreMinutes * 0.38)));
    add('skill', 'Skill + WOD', [
      block('SKILL', skillMinutes),
      block('WOD', coreMinutes - skillMinutes, wodLabel(coreMinutes - skillMinutes)),
    ]);
  }
  add('strength', 'Strength seul', [block('STRENGTH', coreMinutes)]);
  if (coreMinutes >= 8 && coreMinutes <= 30) {
    add('conditioning', 'WOD seul', [block('WOD', coreMinutes, wodLabel(coreMinutes))]);
  }

  const intent = String(intentKey ?? '').toUpperCase();
  const preference = intent.includes('STRENGTH') || intent.includes('FORCE')
    ? ['balanced', 'strength', 'skill', 'conditioning']
    : intent.includes('TECHNIQUE') || intent.includes('SKILL')
      ? ['skill', 'balanced', 'strength', 'conditioning']
      : ['conditioning', 'balanced', 'skill', 'strength'];
  return options
    .sort((left, right) => preference.indexOf(left.key) - preference.indexOf(right.key))
    .map((option, index) => ({ ...option, recommended: index === 0 }));
}

/**
 * MSW-036: engine-owned options, calculated once after the user validates the
 * exercise shortlist. Never fabricate a mechanic because of duration alone.
 */
export async function getComposerMechanicOptions({
  wodMinutes, exerciseIds, environmentCode, focus,
} = {}) {
  const user = await getAuthenticatedUserWithRetry();
  const result = await runSupabaseRequestWithAuthRetry(() =>
    supabase.rpc('week_composer_mechanic_recommendations_v1', {
      p_user_id: user.id,
      p_environment_code: environmentCode,
      p_wod_minutes: wodMinutes,
      p_exercise_ids: exerciseIds ?? [],
      p_focus: focus ?? 'General Fitness',
    })
  );
  return Array.isArray(result?.options) ? result.options : [];
}

export async function saveComposerDraft({ planItemId, draft }) {
  if (!planItemId) throw new Error('planItemId is required to save composer draft.');
  const user = await getAuthenticatedUserWithRetry();
  return runSupabaseRequestWithAuthRetry(() =>
    supabase.rpc('week_save_composer_draft_v1', {
      p_user_id: user.id,
      p_plan_item_id: planItemId,
      p_draft: draft ?? {},
    })
  );
}

/**
 * Day-J read of a saved Composer structure. A Composer draft is not itself a
 * playable workout session; the future finalizer must materialize it first.
 */
export async function getComposerForLocalDate(dateKey) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateKey ?? ''))) {
    throw new Error('Invalid local date for Composer.');
  }
  const user = await getAuthenticatedUserWithRetry();
  const data = await runSupabaseRequestWithAuthRetry(() =>
    supabase.rpc('week_read_composer_for_day_v1', {
      p_user_id: user.id,
      p_local_date: dateKey,
    })
  );
  if (!data?.found) return null;
  return {
    planItemId: data.plan_item_id,
    sessionId: data.session_id ?? null,
    status: data.status,
    date: data.local_date,
    draft: data.composer_draft ?? {},
    futureContext: data.future_context ?? {},
  };
}
