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
    .limit(targetRegion === 'Back' ? 160 : 80);

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
    ? await supabase.from('equipment_catalog_v2').select('id,name').in('id', requiredIds)
    : { data: [], error: null };
  if (equipmentError) throw equipmentError;
  const equipmentNamesById = new Map((equipmentRows ?? []).map((item) => [String(item.id), item.name]));
  // Back is a targeted muscle-group request, not a new value in
  // exercises.body_region. Reuse the authoritative exercise_muscles taxonomy.
  // This keeps the existing Upper/Lower/Core/Full Body categories unchanged.
  let backMuscleWeights = new Map();
  if (targetRegion === 'Back') {
    const { data: links, error: linksError } = await supabase
      .from('exercise_muscles')
      .select('exercise_id,muscle_id,priority')
      .in('exercise_id', ids)
      .in('muscle_id', ['M02', 'M12', 'M13']);
    if (linksError) throw linksError;
    for (const link of links ?? []) {
      const weight = link.priority === 'primary' ? 48 : 18;
      backMuscleWeights.set(link.exercise_id, (backMuscleWeights.get(link.exercise_id) ?? 0) + weight);
    }
  }
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
      score: scoreExercise(exercise, focus, targetRegion) + (backMuscleWeights.get(exercise.id) ?? 0),
      backMuscleEvidence: targetRegion === 'Back' ? (backMuscleWeights.get(exercise.id) ?? 0) : null,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(3, limit));
}

function wodLabel(minutes) {
  if (minutes <= 15) return 'WOD court';
  if (minutes >= 30) return 'WOD long';
  return 'WOD';
}

/**
 * Localized structure labels follow the existing environment UX: a gym
 * strength block is shown as Musculation, while BOX/HOME retain Force/Skill.
 * These are DISPLAY labels only; STRENGTH, SKILL, WOD and prescription types
 * are never remapped or substituted.
 */
export function composerBlockDisplayLabel(type, environmentCode = 'BOX') {
  const env = String(environmentCode ?? 'BOX').toUpperCase();
  if (type === 'WARMUP') return 'Warm-up';
  if (type === 'TABATA') return 'Tabata';
  if (type === 'TRANSITION') return 'Transitions';
  if (type === 'STRENGTH') {
    if (env === 'GYM') return 'Musculation';
    if (env === 'HOME' || env === 'OUTDOOR') return 'Renforcement';
    return 'Force';
  }
  if (type === 'SKILL') return env === 'GYM' || env === 'OUTDOOR' ? 'Technique' : 'Skill';
  if (type === 'WOD') return env === 'GYM' || env === 'OUTDOOR' ? 'Conditioning' : 'WOD';
  return String(type ?? '');
}

export function composerArchitectureDisplayTitle(option, environmentCode = 'BOX') {
  const mainBlocks = (option?.blocks ?? []).filter(
    (item) => !['WARMUP', 'TABATA'].includes(item.type)
  );
  if (!mainBlocks.length) return option?.title ?? 'Séance';
  const labels = mainBlocks.map((item) => composerBlockDisplayLabel(item.type, environmentCode));
  if (labels.length > 1) return labels.join(' + ');
  return labels[0] + (['Musculation', 'Force', 'Technique'].includes(labels[0]) ? ' seule' : ' seul');
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
export function buildComposerArchitectures({ durationMinutes, intentKey, environmentCode = 'BOX', targets = {} }) {
  const duration = Math.max(20, Number(durationMinutes) || 45);
  const transitionReserveMinutes = duration <= 30 ? 3 : duration <= 45 ? 4 : 5;
  const warmupMinutes = Math.max(4, Math.min(
    8,
    duration - transitionReserveMinutes - 4 - 8,
    Number(targets.warmup_minutes ?? (duration <= 30 ? 5 : 8))
  ));
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
    const wodMinutes = Math.max(8, Math.min(30, coreMinutes - Math.round(coreMinutes * 0.46)));
    const strengthMinutes = coreMinutes - wodMinutes;
    add('balanced', 'Strength + WOD', [
      block('STRENGTH', strengthMinutes),
      block('WOD', wodMinutes, wodLabel(wodMinutes)),
    ]);
    const skillWodMinutes = Math.max(8, Math.min(30, coreMinutes - Math.round(coreMinutes * 0.38)));
    const skillMinutes = coreMinutes - skillWodMinutes;
    add('skill', 'Skill + WOD', [
      block('SKILL', skillMinutes),
      block('WOD', skillWodMinutes, wodLabel(skillWodMinutes)),
    ]);
  }
  add('strength', 'Strength seul', [block('STRENGTH', coreMinutes)]);
  if (coreMinutes >= 8 && coreMinutes <= 30) {
    add('conditioning', 'WOD seul', [block('WOD', coreMinutes, wodLabel(coreMinutes))]);
  }

  const intent = String(intentKey ?? '').toUpperCase();
  const env = String(environmentCode ?? 'BOX').toUpperCase();
  const wantsStrength = intent.includes('STRENGTH') || intent.includes('FORCE');
  const wantsSkill = intent.includes('TECHNIQUE') || intent.includes('SKILL');
  // The user's dominant intent wins; environment only breaks ties between
  // compatible structures. Never force a WOD or a Skill block in the gym.
  const preference = wantsSkill
    ? ['skill', 'balanced', 'strength', 'conditioning']
    : wantsStrength
      ? env === 'GYM' || env === 'HOME'
        ? ['strength', 'balanced', 'skill', 'conditioning']
        : ['balanced', 'strength', 'skill', 'conditioning']
      : env === 'GYM'
        ? ['balanced', 'conditioning', 'strength', 'skill']
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
  const available = Array.isArray(result?.options) ? result.options : [];
  const unavailable = Array.isArray(result?.unavailable) ? result.unavailable : [];
  return [
    ...available.map((option) => ({ ...option, available: true })),
    ...unavailable.map((option) => ({ ...option, available: false })),
  ];
}

/**
 * Read-only C2 preview for the recap. These values are indicative until the
 * real day-J check-in and finalization; never write sessions from the preview.
 */
/**
 * Reuse existing preference-evidence function and nearby user-authored
 * compositions. Server reports observations only, without invented "AI scores".
 */
export async function getComposerCandidateEvidence({
  exerciseIds = [], anchorDate, planItemId = null,
} = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(anchorDate ?? ''))) return {};
  const ids = [...new Set(exerciseIds.filter(Boolean))].slice(0, 160);
  if (!ids.length) return {};
  const user = await getAuthenticatedUserWithRetry();
  const data = await runSupabaseRequestWithAuthRetry(() =>
    supabase.rpc('week_composer_candidate_evidence_v1', {
      p_user_id: user.id,
      p_exercise_ids: ids,
      p_anchor_date: anchorDate,
      p_plan_item_id: planItemId,
    })
  );
  return data?.status === 'OK' ? (data.by_exercise ?? {}) : {};
}

/**
 * Dynamic, conservative presentation of engine candidates. Never mutates a
 * selected movement. Signals are derived from the real equipment catalogue,
 * recorded exposure, other user-authored sessions, and already chosen patterns.
 * The original engine selection_weight/focus/region score is retained.
 */
export function rankComposerCandidates({
  candidates = [], blockType, selectionMap = {}, candidateMap = {},
  evidence = {}, equipmentIds = [],
} = {}) {
  const thisBlockIds = new Set(selectionMap[blockType] ?? []);
  const selected = Object.entries(selectionMap)
    .flatMap(([type, ids]) => (ids ?? []).map((id) => ({
      type, exercise: (candidateMap[type] ?? []).find((item) => item.id === id),
    }))).filter((item) => item.exercise);
  const hasEquipment = (equipmentIds ?? []).length > 0;
  const scored = candidates.map((exercise) => {
    const usage = evidence[exercise.id] ?? null;
    const pattern = String(exercise.movementPattern ?? '').trim().toLowerCase();
    const selectedElsewhere = selected.filter(({ type, exercise: other }) =>
      other.id !== exercise.id && type === blockType && pattern &&
      String(other.movementPattern ?? '').trim().toLowerCase() === pattern);
    const plannedNearby = Number(usage?.other_composer_plans_nearby ?? 0);
    const recent = Number(usage?.recent_completed_14d ?? 0);
    const total = Number(usage?.completed_exposures ?? 0);
    const usesEquipment = hasEquipment && (exercise.equipmentIds ?? []).length > 0;
    const differentBlockRepeats = selected.some(({ type, exercise: other }) =>
      type !== blockType && pattern && other.id !== exercise.id &&
      String(other.movementPattern ?? '').toLowerCase() === pattern);
    let score = Number(exercise.score ?? 0);
    let positiveEvidence = false;
    const signals = [];
    // These are the established explicit states, not inferred dislikes.
    const preference = String(usage?.explicit_preference_state ?? 'NEUTRE').toUpperCase();
    if (preference === 'FAVORI') {
      score += 8;
      positiveEvidence = true;
      signals.push('Exercice enregistré dans tes favoris');
    } else if (preference === 'SOUVENT_CHOISI') {
      score += 4;
      positiveEvidence = true;
      signals.push('Exercice souvent choisi');
    } else if (preference === 'EVITE_VOLONTAIREMENT') {
      score -= 25;
    }
    if (selectedElsewhere.length) {
      score -= 22;
      signals.push(`${exercise.movementPattern ?? 'Mouvement'} déjà présent dans ce bloc`);
    }
    if (plannedNearby) {
      score -= Math.min(18, plannedNearby * 9);
      signals.push('Déjà prévu dans une autre séance composée');
    }
    if (recent >= 2) {
      score -= 11;
      signals.push(`Déjà réalisé ${recent} fois sur les 14 derniers jours`);
    } else if (usage && total > 0 && recent === 0) {
      score += 7;
      positiveEvidence = true;
      signals.push('Pas travaillé dans les 14 derniers jours');
    }
    if (differentBlockRepeats) score -= 4;
    if (usesEquipment) {
      // Availability improves the sporting choice, but is already shown in
      // the equipment row. It is not a personalized recommendation rationale.
      score += 8;
    }
    const conflicts = selectedElsewhere.length > 0;
    if (preference === 'EVITE_VOLONTAIREMENT') positiveEvidence = false;
    if (!signals.length && selected.length > 0 && pattern && !differentBlockRepeats) {
      score += 3;
      positiveEvidence = true;
      signals.push('Apporte un mouvement différent de ceux déjà choisis');
    }
    const warning = thisBlockIds.has(exercise.id) && conflicts;
    return { ...exercise, recommendationScore: score, recommendationReason: signals[0] ?? null,
      warning, conflicts, hasRecommendationEvidence: positiveEvidence };
  });
  const ranked = [...scored].sort((a, b) => b.recommendationScore - a.recommendationScore || a.id.localeCompare(b.id));
  const recommendedIds = new Set(ranked.filter((item) => !item.conflicts &&
    item.hasRecommendationEvidence &&
    Number(evidence[item.id]?.other_composer_plans_nearby ?? 0) === 0 &&
    Number(evidence[item.id]?.recent_completed_14d ?? 0) < 2
  ).slice(0, 3).map((item) => item.id));
  return ranked.map((item) => ({
    ...item, recommended: recommendedIds.has(item.id) && !item.warning,
  }));
}

/**
 * Composer initial proposals, built AFTER retrieving recent training evidence.
 * Reuse the existing candidate ranking at every pick, but prefer complementary
 * movement patterns rather than blindly taking the first N catalogue rows.
 *
 * A scarce catalogue can yield fewer auto-selections; never manufacture a
 * duplicate to satisfy a UI quota. A user may still add similar movements
 * manually, in which case rankComposerCandidates surfaces its warning.
 * Preserve all engine types and selected IDs; no prescription changes.
 */
export function selectComposerDefaultExercises({
  candidateMap = {}, evidence = {}, equipmentIds = [], maxPerBlock = {},
} = {}) {
  const defaults = {};
  const pickedExerciseIds = new Set();
  const types = Object.keys(candidateMap ?? {});
  // Protect the important training blocks first; complements are editable
  // afterwards in the recap, and must not claim all available movements.
  const orderedTypes = [
    ...types.filter((type) => !['WARMUP', 'TABATA'].includes(type)),
    ...types.filter((type) => ['WARMUP', 'TABATA'].includes(type)),
  ];

  for (const type of orderedTypes) {
    defaults[type] = [];
    const max = Math.max(0, Math.min(8, Number(maxPerBlock[type] ?? 0) || 0));
    const patterns = new Set();
    const unclassifiedFamilies = new Set();

    while (defaults[type].length < max) {
      const ranked = rankComposerCandidates({
        candidates: candidateMap[type] ?? [], blockType: type,
        selectionMap: defaults, candidateMap, evidence, equipmentIds,
      });
      const choice = ranked.find((exercise) => {
        if (!exercise?.id || pickedExerciseIds.has(exercise.id)) return false;
        if (String(evidence[exercise.id]?.explicit_preference_state ?? '').toUpperCase()
          === 'EVITE_VOLONTAIREMENT') return false;
        const pattern = String(exercise.movementPattern ?? '').trim().toLowerCase();
        const family = String(exercise.exerciseFamily ?? '').trim().toLowerCase();
        if (pattern && patterns.has(pattern)) return false;
        if (!pattern && family && unclassifiedFamilies.has(family)) return false;
        return !exercise.conflicts;
      });
      if (!choice) break;

      defaults[type].push(choice.id);
      pickedExerciseIds.add(choice.id);
      const pattern = String(choice.movementPattern ?? '').trim().toLowerCase();
      const family = String(choice.exerciseFamily ?? '').trim().toLowerCase();
      if (pattern) patterns.add(pattern);
      else if (family) unclassifiedFamilies.add(family);
    }
  }
  return defaults;
}

export async function getComposerPrescriptionPreview({ draft, equipmentNames = [] } = {}) {
  const user = await getAuthenticatedUserWithRetry();
  return runSupabaseRequestWithAuthRetry(() =>
    supabase.rpc('week_composer_prescription_preview_v1', {
      p_user_id: user.id,
      p_draft: draft,
      p_equipment_names: equipmentNames,
    })
  );
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
