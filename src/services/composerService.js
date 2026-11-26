import { supabase } from '../lib/supabase';
import {
  getAuthenticatedUserWithRetry,
  runSupabaseRequestWithAuthRetry,
} from '../lib/supabaseAuthRetry';
import { readComposerPreferences } from '../utils/composerPreferences';

const ENGINE_POLICY = 'c4-final-default';

// Read the existing curated catalogue. A target is a preference, not a claim
// that an athlete has mastered its final movement or can perform it today.
export async function getComposerSkillTargets() {
  await getAuthenticatedUserWithRetry();
  const rows = await runSupabaseRequestWithAuthRetry(() => supabase
    .from('skill_paths')
    .select('path_key,display_name,body_region,description')
    .eq('active', true)
    .order('selection_priority', { ascending: false })
    .order('display_name'));
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    key: row.path_key, name: row.display_name, region: row.body_region,
    description: row.description ?? null,
  }));
}

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

async function readCompleteComposerCatalogue(query) {
  const rows = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await query.range(offset, offset + 499);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < 500) return rows;
  }
}

// Single read-only compatibility authority, shared with the compiler's inventory
// and environment predicates. Never infer physical compatibility from a flat list.
export async function getComposerExerciseCompatibility({exerciseIds=[],equipmentIds=[],environmentCode='HOME'}={}) {
  await getAuthenticatedUserWithRetry();
  const ids=[...new Set(exerciseIds.filter(Boolean))];
  const result={};
  for(let offset=0;offset<ids.length;offset+=500){
    const rows=await runSupabaseRequestWithAuthRetry(()=>supabase.rpc('week_composer_exercise_compatibility_v1',{
      p_exercise_ids:ids.slice(offset,offset+500),p_equipment_ids:equipmentIds,p_environment_code:environmentCode,
    }));
    Object.assign(result,rows??{});
  }
  return result;
}

export async function getComposerExerciseCandidates({
  blockType,
  focus,
  targetRegion = null,
  preferences = null,
  environmentCode = 'HOME',
  outdoorGym = false,
  equipmentIds = [],
  limit = 8,
  manualCatalogue = false,
}) {
  // Adapt the full preference set to the existing single-region catalogue
  // lookup. Keep its scores/eligibility unchanged; deduplicate by exercise,
  // taking the best existing match rather than adding new sporting weights.
  if (preferences && !manualCatalogue) {
    const normalized = readComposerPreferences(preferences);
    const regions = normalized.preferred_regions;
    const lists = await Promise.all((regions.length ? regions : [null]).map((region) =>
      getComposerExerciseCandidates({ blockType, focus, targetRegion: region,
        environmentCode, outdoorGym, equipmentIds, limit })));
    const choices = new Map();
    for (const list of lists) for (const exercise of list) {
      const previous = choices.get(exercise.id);
      if (!previous || exercise.score > previous.score) choices.set(exercise.id, exercise);
    }
    return [...choices.values()].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  }
  const role = BLOCK_ROLE[blockType] ?? 'WOD';
  const commonTrainingCatalogue = manualCatalogue || ['SKILL', 'STRENGTH'].includes(blockType);
  let query = supabase
    .from('exercises')
    .select('id,name,display_name,description,instructions,tips,image_path,exercise_type,difficulty,technical_complexity,movement_pattern,exercise_family,body_region,training_focus,equipment_requirement,selection_weight,usable_for,home_friendly,prescription_type,tabata_eligible,warmup_eligible,warmup_role,wod_role')
    .order('selection_weight', { ascending: false })
    .order('id', { ascending: true });
  if (!commonTrainingCatalogue) query = query.limit(targetRegion === 'Back' ? 160 : 80);

  if (blockType === 'WARMUP') query = query.eq('warmup_eligible', true);
  else if (blockType === 'TABATA') query = query.eq('tabata_eligible', true);
  else if (!commonTrainingCatalogue) query = query.contains('usable_for', [role]);

  if (!manualCatalogue && String(environmentCode).toUpperCase() === 'HOME') {
    query = query.eq('home_friendly', true);
  }

  let exercises;
  if (commonTrainingCatalogue) {
    // Both training contracts explore the same complete catalogue. The shared
    // authorities still own eligibility and prescription validation.
    exercises = await readCompleteComposerCatalogue(query);
  } else {
    const { data, error } = await query;
    if (error) throw error;
    exercises = data;
  }
  if (!manualCatalogue && outdoorGym && environmentCode === 'OUTDOOR' && blockType === 'SKILL') {
    await getAuthenticatedUserWithRetry();
    const ids = await runSupabaseRequestWithAuthRetry(() => supabase.rpc('week_composer_outdoor_gym_catalog_v1'));
    const allowed = new Set(ids ?? []);
    exercises = exercises.filter((exercise) => allowed.has(exercise.id));
  }
  if (!exercises?.length) return [];

  const ids = exercises.map((exercise) => exercise.id);
  const compatibility=await getComposerExerciseCompatibility({exerciseIds:ids,equipmentIds,environmentCode});
  const requiredIds=[...new Set(Object.values(compatibility).flatMap(row=>row.equipment_ids??[]))];
  const { data: equipmentRows, error: equipmentError } = requiredIds.length
    ? await supabase.from('equipment_catalog_v2').select('id,name').in('id', requiredIds)
    : { data: [], error: null };
  if (equipmentError) throw equipmentError;
  const equipmentNamesById = new Map((equipmentRows ?? []).map((item) => [String(item.id), item.name]));
  // Back is a targeted muscle-group request, not a new value in
  // exercises.body_region. Reuse the authoritative exercise_muscles taxonomy.
  // This keeps the existing Upper/Lower/Core/Full Body categories unchanged.
  let backMuscleWeights = new Map();
  if (targetRegion === 'Back' || manualCatalogue) {
    const { data: links, error: linksError } = await supabase
      .from('exercise_muscles')
      .select('exercise_id,muscle_id,priority')
      .in('exercise_id', ids)
      .in('muscle_id', ['M02', 'M12', 'M13']);
    if (linksError) throw linksError;
    for (const link of links ?? []) {
      if (link.priority !== 'primary') continue;
      const weight = link.priority === 'primary' ? 48 : 18;
      backMuscleWeights.set(link.exercise_id, (backMuscleWeights.get(link.exercise_id) ?? 0) + weight);
    }
  }
  return exercises
    .filter(exercise=>{
      const status=compatibility[exercise.id];
      if(!status?.equipment_ok||!status?.environment_ok)return false;
      if(blockType==='WOD'&&['prep_only'].includes(status.wod_role??exercise.wod_role))return false;
      return manualCatalogue||targetRegion!=='Back'||backMuscleWeights.has(exercise.id);
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
      wodRole: compatibility[exercise.id].wod_role ?? exercise.wod_role ?? null,
      trainingFocus: exercise.training_focus ?? null,
      ...(manualCatalogue ? { originalName: exercise.name, isBack: backMuscleWeights.has(exercise.id), missingEquipment: [] } : {}),
      equipmentIds: compatibility[exercise.id].equipment_ids ?? [],
      equipmentGroups: compatibility[exercise.id].equipment_groups ?? [],
      equipmentCompatibility: { equipmentOk: true, environmentOk: true, selectedIds: [...new Set(equipmentIds.map(String))].sort() },
      equipmentNames: (compatibility[exercise.id].equipment_groups ?? []).map(group=>group.map(id=>equipmentNamesById.get(id)??id).join(' + ')).length
        ? [(compatibility[exercise.id].equipment_groups ?? []).map(group=>group.map(id=>equipmentNamesById.get(id)??id).join(' + ')).join(' ou ')] : [],
      bodyRegion: exercise.body_region,
      movementPattern: exercise.movement_pattern,
      exerciseFamily: exercise.exercise_family,
      prescriptionType: exercise.prescription_type,
      score: scoreExercise(exercise, focus, targetRegion) + (backMuscleWeights.get(exercise.id) ?? 0),
      backMuscleEvidence: targetRegion === 'Back' ? (backMuscleWeights.get(exercise.id) ?? 0) : null,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, commonTrainingCatalogue ? undefined : Math.max(3, limit));
}

export async function getComposerSkillProposal(context) {
  const user = await getAuthenticatedUserWithRetry();
  return runSupabaseRequestWithAuthRetry(() => supabase.rpc('week_composer_skill_authority_v1', {
    p_user_id: user.id, p_context: { ...context, propose: true },
  }));
}

/**
 * Validate automatic Skill suggestions with the same authority as the preview.
 * Only discard a candidate explicitly rejected by that authority, then reuse
 * the existing ranking. Authored choices and target-path lessons use the
 * normal proposal API and are never substituted here.
 */
export async function getComposerAutomaticSkillProposal({
  context, candidateMap = {}, defaultSelections = {}, evidence = {},
  equipmentIds = [], targetRegion = null,
}) {
  let exercises = context.exercises ?? [];
  let candidates = [...(candidateMap.SKILL ?? [])];
  const max = exercises.length;
  const fixedSelections = Object.fromEntries(Object.entries(defaultSelections)
    .filter(([type]) => type !== 'SKILL'));
  const target = readComposerPreferences(context).skill_target_path_key;
  const excluded = new Set();
  while (true) {
    const proposal = await getComposerSkillProposal({ ...context, exercises });
    if (proposal?.status === 'READY' || target ||
        !['SKILL_CONTEXT_INCOMPATIBLE', 'SKILL_TIME_MISMATCH'].includes(proposal?.reason)) return proposal;
    const rejectedId = proposal.exercise_id;
    // No arbitrary retries: every retry must remove one rejected automatic
    // candidate. A malformed response cannot create an unbounded loop.
    if (!rejectedId || excluded.has(rejectedId) ||
        !exercises.some((exercise) => exercise.id === rejectedId) ||
        !candidates.some((exercise) => exercise.id === rejectedId)) return proposal;
    excluded.add(rejectedId);
    candidates = candidates.filter((exercise) => exercise.id !== rejectedId);
    const selection = selectComposerDefaultExercises({
      candidateMap: { ...candidateMap, SKILL: candidates },
      fixedSelections, evidence, equipmentIds, targetRegion,
      maxPerBlock: { SKILL: max },
    });
    if (!selection.SKILL?.length) return proposal;
    exercises = selection.SKILL.map((id) => ({ id }));
  }
}

function wodLabel(minutes) {
  if (minutes <= 15) return 'WOD court';
  if (minutes >= 30) return 'WOD long';
  return 'WOD';
}

/**
 * Localized structure labels follow the existing environment UX: a gym
 * strength block is shown as Musculation in Salle, Maison and Box; Skill remains distinct.
 * These are DISPLAY labels only; STRENGTH, SKILL, WOD and prescription types
 * are never remapped or substituted.
 */
export function composerBlockDisplayLabel(type, environmentCode = 'BOX', architecture = null) {
  const env = String(environmentCode ?? 'BOX').toUpperCase();
  if (type === 'WARMUP') return 'Warm-up';
  if (type === 'TABATA') return 'Tabata';
  if (type === 'TRANSITION') return 'Transitions';
  if (type === 'STRENGTH') {
    if (['GYM', 'HOME', 'BOX'].includes(env)) return 'Musculation';
    if (env === 'OUTDOOR') return 'Renforcement';
    return 'Force';
  }
  if (type === 'SKILL' && architecture?.blocks?.some((block) => block.type === 'STRENGTH')) return 'Skill';
  if (type === 'SKILL') return env === 'GYM' ? 'Musculation' : env === 'OUTDOOR' ? 'Gym' : 'Skill';
  if (type === 'WOD') return 'WOD';
  if (type === 'CARDIO') return env === 'OUTDOOR' ? 'Cardio extérieur' : 'Cardio';
  return String(type ?? '');
}

export function composerArchitectureDisplayTitle(option, environmentCode = 'BOX') {
  const mainBlocks = (option?.blocks ?? []).filter(
    (item) => !['WARMUP', 'TABATA'].includes(item.type)
  );
  if (!mainBlocks.length) return option?.title ?? 'Séance';
  const labels = mainBlocks.map((item) => composerBlockDisplayLabel(item.type, environmentCode, option));
  if (labels.length > 1) return labels.join(' + ');
  if (labels[0] === 'Cardio extérieur') return labels[0];
  return labels[0] + (['Musculation', 'Force', 'Gym'].includes(labels[0]) ? ' seule' : ' seul');
}

export function composerIntentBlockType(intentKey) {
  const key = String(intentKey ?? '').toUpperCase();
  return key.includes('STRENGTH') || key.includes('FORCE') ? 'STRENGTH'
    : key.includes('TECHNIQUE') || key.includes('SKILL') ? 'SKILL'
      : key.includes('CONDITIONING') || key.includes('ENDURANCE') ? 'WOD' : null;
}

// Orientation is a prescription preference, independent from block labels.
export function composerArchitectureMatchesIntent(option, intentKey) {
  // Orientation influences prescriptions, never a required majority of block labels.
  return (option?.blocks ?? []).some((b) => ['SKILL', 'STRENGTH', 'WOD', 'CARDIO'].includes(b.type));
}

export function composerArchitecturePurpose(option, intentKey, environmentCode = 'BOX') {
  const descriptions = {
    SKILL: 'Skill : maîtrise ou force sur quelques mouvements.',
    STRENGTH: 'Renforcement : séries, répétitions et récupérations.',
    WOD: 'WOD : effort organisé selon la mécanique choisie.',
    CARDIO: 'Cardio : protocole dédié, distinct du WOD.',
  };
  return (option?.blocks ?? []).map((b) => descriptions[b.type]).filter(Boolean).join(' ');
}

/**
 * Dynamic movement capacity for the Composer, not a required exercise quota.
 * A 45-minute Strength block can contain four complementary patterns,
 * unlike a 14/21-minute Strength block. Skill is intentionally NOT scaled
 * with length: a complex technique may be practiced for a long time.
 *
 * No duplicate patterns are invented by default to fill available slots.
 * The C2 preview remains authoritative for reps, sets, load and rest.
 */
export function composerExerciseSlotLimit(blockType, blockMinutes = 0) {
  const minutes = Math.max(0, Number(blockMinutes) || 0);
  if (blockType === 'WARMUP') return 3;
  if (blockType === 'TABATA') return 2;
  if (blockType === 'WOD') return 3;
  if (blockType === 'SKILL') return 3;
  if (blockType === 'CARDIO') return 2;
  if (blockType === 'STRENGTH') {
    // Eight is the existing Composer draft/compiler payload safety limit,
    // NOT an exercise recommendation. Count/sets/rest are owned by C2/C4.
    return 8;
  }
  return 2;
}

function block(type, minutes, label = null) {
  return {
    type,
    label: label ?? (type === 'WARMUP' ? 'Warm-up' : type === 'STRENGTH' ? 'Strength' : type === 'TABATA' ? 'Tabata' : type),
    minutes: Math.max(1, Math.round(minutes)),
  };
}

/**
 * Historical local proposal helper, retained for legacy contracts.
 * New guided proposals use week_composer_architectures_v1 with shared C4 targets. C2/C4 remain authoritative for actual
 * movements, prescriptions, mechanics and day-J feasibility.
 *
 * New proposals contain protected Warm-up and Tabata (4 min).
 * Previously saved drafts are reloaded unchanged; no automatic insertion. WOD mechanics support 3..90 minutes in DEV,
 * so the former 30-minute cap was a local heuristic, not a technical limit.
 */
export function buildComposerArchitectures({ durationMinutes, intentKey, environmentCode = 'BOX', targets = {} }) {
  const duration = Math.max(20, Math.min(90, Number(durationMinutes) || 45));
  const reserve = duration <= 30 ? 3 : duration <= 45 ? 4 : 5;
  const requestedWarmup = Number(targets.warmup_minutes ?? (duration <= 30 ? 5 : 8));
  const tabataMinutes = 4;
  const warmup = Math.max(4, Math.min(
    8, duration - reserve - tabataMinutes - 8,
    Number.isFinite(requestedWarmup) ? requestedWarmup : 6
  ));
  const mainMinutes = duration - reserve - warmup - tabataMinutes;
  const warmupBlock = block('WARMUP', warmup);
  const tabataBlock = block('TABATA', tabataMinutes);
  const options = [];
  function add(key, main) {
    if (!main.length || main.some((b) => b.minutes < 8 || b.minutes > 90)) return;
    if (main.reduce((sum, b) => sum + b.minutes, 0) !== mainMinutes) return;
    options.push({
      key, title: key, blocks: [warmupBlock, tabataBlock, ...main],
      transitionReserveMinutes: reserve, estimatedMinutes: duration,
    });
  }
  const key = String(intentKey ?? '').toUpperCase();
  const mode = key.includes('STRENGTH') || key.includes('FORCE') ? 'strength'
    : key.includes('TECHNIQUE') || key.includes('SKILL') ? 'skill'
      : key.includes('CONDITIONING') || key.includes('ENDURANCE') ? 'conditioning'
        : 'neutral';

  // Valid alone even for short sessions, including the 20-minute Technique
  // case. The workout is not rebuilt when the user picks an alternative.
  add('strength', [block('STRENGTH', mainMinutes)]);
  add('technique', [block('SKILL', mainMinutes)]);
  add('conditioning', [block('WOD', mainMinutes, wodLabel(mainMinutes))]);

  if (mainMinutes >= 16) {
    const strengthShare = mode === 'strength' ? .69 : mode === 'conditioning' ? .28 : .53;
    const strengthMinutes = Math.max(8, Math.min(mainMinutes - 8, Math.round(mainMinutes * strengthShare)));
    add('balanced', [
      block('STRENGTH', strengthMinutes),
      block('WOD', mainMinutes - strengthMinutes, wodLabel(mainMinutes - strengthMinutes)),
    ]);
    const skillShare = mode === 'skill' ? .69 : mode === 'conditioning' ? .28 : .54;
    const skillMinutes = Math.max(8, Math.min(mainMinutes - 8, Math.round(mainMinutes * skillShare)));
    add('skill', [
      block('SKILL', skillMinutes),
      block('WOD', mainMinutes - skillMinutes, wodLabel(mainMinutes - skillMinutes)),
    ]);
  }
  const environment = String(environmentCode ?? 'BOX').toUpperCase();
  const priority = mode === 'strength'
    ? ['strength','balanced','technique','skill','conditioning']
    : mode === 'skill'
      ? ['skill','technique','balanced','strength','conditioning']
      : mode === 'conditioning'
        ? ['conditioning','balanced','skill','strength','technique']
        : environment === 'HOME'
          ? ['skill','balanced','strength','conditioning','technique']
          : ['balanced','skill','strength','conditioning','technique'];
  return options
    .sort((a,b) => priority.indexOf(a.key) - priority.indexOf(b.key))
    .map((option,index) => ({ ...option, recommended: index === 0 }));
}

/**
 * MSW-036: engine-owned options, calculated once after the user validates the
 * exercise shortlist. Never fabricate a mechanic because of duration alone.
 */
export async function getComposerMechanicOptions({
  wodMinutes, exerciseIds, environmentCode, focus, sessionMinutes = 60,
  equipmentNames = [], targetRegion = null, progressionIntent = 'MAINTAIN',
  engineVersion = 'C4_COMPOSER_V2',
} = {}) {
  const user = await getAuthenticatedUserWithRetry();
  const result = await runSupabaseRequestWithAuthRetry(() =>
    engineVersion === 'C4_COMPOSER_V2' ? supabase.rpc('week_composer_mechanic_recommendations_v2', {
      p_user_id: user.id,
      p_context: { block_minutes: wodMinutes, session_minutes: sessionMinutes,
        exercises: (exerciseIds ?? []).map((id) => ({ id })),
        environment_code: environmentCode, equipment_names: equipmentNames,
        focus: focus ?? 'General Fitness', target_region: targetRegion,
        progression_intent: progressionIntent, readiness: 'normal' },
    }) : supabase.rpc('week_composer_mechanic_recommendations_v1', {
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

export async function getComposerWodSelectionContracts(context) {
  if (context?.engineVersion !== null) {
    const user = await getAuthenticatedUserWithRetry();
    const result = await runSupabaseRequestWithAuthRetry(() =>
      supabase.rpc('week_composer_mechanic_catalog_v2', { p_user_id: user.id }));
    const contracts = (result?.options ?? []).filter((o) => o.entitled).map((o) => o.contract);
    if (!contracts.length) throw new Error('No entitled Composer contracts');
    return contracts;
  }

  // Historical drafts retain their original five-format contract until the
  // athlete explicitly edits the WOD and validates a V2 format.
  const options = await getComposerMechanicOptions(context);
  const keys = [...new Set(options.map((option) => option.key).filter(Boolean))];
  if (!keys.length) throw new Error('No Composer mechanic contracts available');
  return Promise.all(keys.map((key) => runSupabaseRequestWithAuthRetry(() =>
    supabase.rpc('c4_mechanic_composition_contract', { p_mechanic: key })
  )));
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
  candidateMap = {}, evidence = {}, equipmentIds = [], maxPerBlock = {}, targetRegion = null,
  fixedSelections = {},
} = {}) {
  const defaults = {};
  const pickedExerciseIds = new Set();
  const types = Object.keys(candidateMap ?? {});
  // A curated Skill and explicit user choices are inputs, not candidates to
  // replace. Unchosen complements must not reclaim those exercise identities.
  for (const type of types) {
    if (!Array.isArray(fixedSelections[type])) continue;
    defaults[type] = [...fixedSelections[type]];
    for (const id of defaults[type]) pickedExerciseIds.add(id);
  }
  // Protect the important training blocks first; complements are editable
  // afterwards in the recap, and must not claim all available movements.
  const orderedTypes = [
    ...types.filter((type) => !['WARMUP', 'TABATA'].includes(type)),
    ...types.filter((type) => ['WARMUP', 'TABATA'].includes(type)),
  ];

  for (const type of orderedTypes) {
    if (Object.prototype.hasOwnProperty.call(defaults, type)) continue;
    defaults[type] = [];
    const max = Math.max(0, Math.min(8, Number(maxPerBlock[type] ?? 0) || 0));
    const patterns = new Set();
    const unclassifiedFamilies = new Set();

    while (defaults[type].length < max) {
      let ranked = rankComposerCandidates({
        candidates: candidateMap[type] ?? [], blockType: type,
        selectionMap: defaults, candidateMap, evidence, equipmentIds,
      });
      if (targetRegion === 'Full Body' && !['WARMUP', 'TABATA'].includes(type)) {
        const region = (exercise) => {
          if (/push|pull/i.test(exercise?.movementPattern ?? '')) return 'Upper';
          if (/squat|hinge|lunge|step|jump/i.test(exercise?.movementPattern ?? '')) return 'Lower';
          return exercise?.bodyRegion;
        };
        const covered = new Set(Object.entries(defaults)
          .filter(([key]) => !['WARMUP', 'TABATA'].includes(key))
          .flatMap(([key, ids]) => ids.map((id) => region((candidateMap[key] ?? []).find((e) => e.id === id)))));
        const priority = (exercise) => ['Upper', 'Lower'].includes(region(exercise)) && !covered.has(region(exercise)) ? 1 : 0;
        ranked = [...ranked].sort((a, b) => priority(b) - priority(a));
      }
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

/**
 * Strength-only adapter. The count, C4 sets/rest and time fit are produced
 * by the same backend authority used in recap preview and Day-J compilation.
 * Never infer the number of movements from duration in the UI.
 */
export async function getComposerStrengthAutoPick({
  candidates, sessionMinutes, blockMinutes, progressionIntent = 'MAINTAIN',
  equipmentNames = [], focus = 'Strength', targetRegion = null,
  environmentCode = 'BOX',
} = {}) {
  const user = await getAuthenticatedUserWithRetry();
  return runSupabaseRequestWithAuthRetry(() =>
    supabase.rpc('week_composer_strength_autopick_v2', {
      p_user_id: user.id,
      p_candidate_exercises: candidates,
      p_session_minutes: sessionMinutes,
      p_block_minutes: blockMinutes,
      p_progression_intent: progressionIntent,
      p_equipment_names: equipmentNames,
      p_focus: focus,
      p_target_region: targetRegion,
      p_environment_code: environmentCode,
    })
  );
}

export async function getComposerStrengthAssessment({
  exercises, sessionMinutes, blockMinutes, progressionIntent = 'MAINTAIN',
  equipmentNames = [], focus = 'Strength', targetRegion = null,
  environmentCode = 'BOX',
} = {}) {
  const user = await getAuthenticatedUserWithRetry();
  return runSupabaseRequestWithAuthRetry(() =>
    supabase.rpc('week_composer_strength_authority_v2', {
      p_user_id: user.id,
      p_exercises: exercises,
      p_session_minutes: sessionMinutes,
      p_block_minutes: blockMinutes,
      p_progression_intent: progressionIntent,
      p_equipment_names: equipmentNames,
      p_focus: focus,
      p_target_region: targetRegion,
      p_environment_code: environmentCode,
      p_readiness: 'normal',
    })
  );
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

export async function saveComposerDraft({ planItemId, draft, context = null, confirmReplacement = false }) {
  if (!planItemId) throw new Error('planItemId is required to save composer draft.');
  const user = await getAuthenticatedUserWithRetry();
  return runSupabaseRequestWithAuthRetry(() =>
    supabase.rpc('week_save_composer_with_model_v1', {
      p_user_id: user.id,
      p_plan_item_id: planItemId,
      p_draft: draft ?? {},
      p_context: context, p_confirm_replacement: confirmReplacement,
    })
  );
}

/**
 * Day-J read of a saved Composer structure. A Composer draft is not itself a
 * playable workout session; the future finalizer must materialize it first.
 */
export function newComposerCreationRequest() {
  // Retry identity, not a security credential.
  return 'composer-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2)+'-'+Math.random().toString(36).slice(2);
}

export async function createAndSaveComposer({dateKey,draft,context,requestId}) {
  if(!requestId)throw new Error('Identifiant de création requis.');
  const user=await getAuthenticatedUserWithRetry();
  return runSupabaseRequestWithAuthRetry(()=>supabase.rpc('week_create_composer_plan_v1',{
    p_user_id:user.id,p_date:dateKey,p_draft:draft,p_context:context,p_request_id:requestId,
  }));
}

function normalizeSavedComposer(data) {
  return {
    planItemId:data.plan_item_id,sessionId:data.session_id??null,status:data.status,date:data.local_date,
    draft:data.composer_draft??{},preferences:readComposerPreferences(data.composer_draft??{}),futureContext:data.future_context??{},
  };
}
export async function listComposersForLocalDate(dateKey) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(dateKey??'')))throw new Error('Date de séance invalide.');
  await getAuthenticatedUserWithRetry();
  const data=await runSupabaseRequestWithAuthRetry(()=>supabase.rpc('week_list_composer_for_day_v1',{p_local_date:dateKey}));
  if(!Array.isArray(data))throw new Error('Liste des séances indisponible.');
  return data.map(normalizeSavedComposer);
}

export async function getComposerForLocalDate(dateKey, planItemId = null) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateKey ?? ''))) {
    throw new Error('Invalid local date for Composer.');
  }
  const user = await getAuthenticatedUserWithRetry();
  const data = await runSupabaseRequestWithAuthRetry(() =>
    planItemId
      ? supabase.rpc('week_read_composer_for_item_v1', {p_plan_item_id:planItemId})
      : supabase.rpc('week_read_composer_for_day_v1', {p_user_id:user.id,p_local_date:dateKey})
  );
  if (!data?.found) return null;
  if(data.local_date!==dateKey||(planItemId&&data.plan_item_id!==planItemId))throw new Error('La séance ne correspond plus à la date sélectionnée.');
  return normalizeSavedComposer(data);
}

export async function getComposerArchitectureProposal({ durationMinutes, environmentCode, outdoorContext = null, skillTargetPath = null }) {
  await getAuthenticatedUserWithRetry();
  const result = await runSupabaseRequestWithAuthRetry(() => supabase.rpc(environmentCode === 'OUTDOOR' ? 'week_composer_outdoor_architectures_v1' : 'week_composer_architectures_v1', {
    p_duration: Number(durationMinutes),
    ...(environmentCode === 'OUTDOOR' ? { p_context: outdoorContext, p_skill_target: skillTargetPath } : { p_environment: environmentCode }),
  }));
  if (!['READY','DEFAULT_UNAVAILABLE'].includes(result?.status) || !Array.isArray(result.options)) {
    throw new Error('Les répartitions de séance ne sont pas disponibles. Réessaie.');
  }
  return result;
}

export async function getComposerCardioProposal(context) {
  const user = await getAuthenticatedUserWithRetry();
  const result = await runSupabaseRequestWithAuthRetry(() => supabase.rpc('week_composer_cardio_authority_v1', {
    p_user_id: user.id, p_context: { ...context, propose: true },
  }));
  if (result?.status !== 'READY' && context.environment_code === 'OUTDOOR') {
    const reasons = {
      OUTDOOR_SURFACE_REQUIRED: 'Précise le lieu et le terrain de ta séance extérieure.',
      OUTDOOR_CONTEXT_REQUIRED: 'Actualise le contexte extérieur avant de choisir tes mouvements.',
      OUTDOOR_RUNNING_UNAVAILABLE: 'La course est désactivée. Ajoute Gym ou WOD, puis retire Cardio extérieur dans la structure.',
      OUTDOOR_RUNNING_CONTEXT_INCOMPATIBLE: 'La course ne convient pas au contexte du jour. Ajuste la structure ou le contexte.',
    };
    const error = new Error(reasons[result?.reason] ?? 'Ce protocole de course ne peut pas être exécuté dans ce contexte. Ajuste le terrain ou la structure.');
    error.userMessage = error.message; throw error;
  }
  if (result?.status !== 'READY') throw new Error(result?.reason === 'CARDIO_EQUIPMENT_REQUIRED'
    ? 'Ajoute une machine cardio disponible dans ton matériel, ou retire le bloc Cardio.'
    : 'Le cardio doit être recalculé avec ton matériel actuel.');
  return (result.block.exercises ?? []).map((e) => ({ id: e.exercise_id, name: e.name,
    cardioProtocol: result.block, prescriptionJson: e.prescription, trackingModes: e.prescription?.tracking_modes ?? [],
    bodyRegion: null, movementPattern: 'Cardio', trainingFocus: 'Conditioning', equipmentNames: [],
  }));
}
