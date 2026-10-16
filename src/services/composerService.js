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

export function buildComposerArchitectures({ durationMinutes, intentKey, targets = {} }) {
  const duration = Math.max(20, Number(durationMinutes) || 45);
  const reserve = duration <= 30 ? 3 : duration <= 45 ? 4 : 5;
  const warmup = Math.max(4, Math.min(8, Number(targets.warmup_minutes ?? (duration <= 30 ? 5 : 6))));
  const tabata = 4;

  let conditioning;
  let balanced;
  let strengthFirst;

  if (duration <= 30) {
    const conditioningWod = Math.max(8, duration - reserve - warmup - tabata);
    const strengthMinutes = Math.max(10, Math.round((duration - reserve - warmup) * 0.64));
    const strengthWod = Math.max(6, duration - reserve - warmup - strengthMinutes);
    const balancedStrength = Math.max(9, Math.round((duration - reserve - warmup) * 0.48));
    const balancedWod = Math.max(7, duration - reserve - warmup - balancedStrength);

    conditioning = {
      key: 'conditioning',
      title: 'Plus conditioning',
      blocks: [
        block('WARMUP', warmup),
        block('TABATA', tabata),
        block('WOD', conditioningWod, wodLabel(conditioningWod)),
      ],
    };
    balanced = {
      key: 'balanced',
      title: 'Équilibrée',
      blocks: [
        block('WARMUP', warmup),
        block('STRENGTH', balancedStrength),
        block('WOD', balancedWod, wodLabel(balancedWod)),
      ],
    };
    strengthFirst = {
      key: 'strength',
      title: 'Plus force',
      blocks: [
        block('WARMUP', warmup),
        block('STRENGTH', strengthMinutes),
        block('WOD', strengthWod, wodLabel(strengthWod)),
      ],
    };
  } else {
    const strengthAvailable = Math.max(18, duration - reserve - warmup);
    const strengthMinutes = Math.max(14, Math.round(strengthAvailable * 0.62));
    const strengthWod = Math.max(8, strengthAvailable - strengthMinutes);

    const balancedAvailable = Math.max(20, duration - reserve - warmup - tabata);
    const balancedStrength = Math.max(11, Math.round(balancedAvailable * 0.46));
    const balancedWod = Math.max(9, balancedAvailable - balancedStrength);

    const conditioningWod = Math.max(12, duration - reserve - warmup - tabata);

    conditioning = {
      key: 'conditioning',
      title: 'Plus conditioning',
      blocks: [
        block('WARMUP', warmup),
        block('TABATA', tabata),
        block('WOD', conditioningWod, wodLabel(conditioningWod)),
      ],
    };
    balanced = {
      key: 'balanced',
      title: 'Équilibrée',
      blocks: [
        block('WARMUP', warmup),
        block('TABATA', tabata),
        block('STRENGTH', balancedStrength),
        block('WOD', balancedWod, wodLabel(balancedWod)),
      ],
    };
    strengthFirst = {
      key: 'strength',
      title: 'Plus force',
      blocks: [
        block('WARMUP', warmup),
        block('STRENGTH', strengthMinutes),
        block('WOD', strengthWod, wodLabel(strengthWod)),
      ],
    };
  }

  const normalized = String(intentKey ?? '').toUpperCase();
  const ordered = normalized.includes('STRENGTH') || normalized.includes('FORCE')
    ? [strengthFirst, balanced, conditioning]
    : normalized.includes('CONDITION')
      ? [conditioning, balanced, strengthFirst]
      : [balanced, conditioning, strengthFirst];

  return ordered.map((option, index) => ({
    ...option,
    recommended: index === 0,
    estimatedMinutes: option.blocks.reduce((sum, item) => sum + Number(item.minutes ?? 0), 0) + reserve,
    transitionReserveMinutes: reserve,
  }));
}

export function getComposerMechanicOptions({ wodMinutes = 12, exerciseCount = 3 }) {
  const options = wodMinutes <= 12
    ? [
        { key: 'EMOM', title: 'EMOM', description: 'Cadencé et simple à tenir.' },
        { key: 'AMRAP', title: 'AMRAP', description: 'Rythme libre dans un temps fixé.' },
        { key: 'CIRCUIT', title: 'Circuit', description: 'Tours réguliers, lecture facile.' },
      ]
    : [
        { key: 'AMRAP', title: 'AMRAP', description: 'Bon compromis pour ce volume.' },
        { key: 'EMOM', title: 'EMOM', description: 'Cadence maîtrisée et transitions nettes.' },
        { key: 'FOR_TIME', title: 'For Time', description: 'Travail fini avec cap temporel.' },
      ];

  return options.map((option, index) => ({
    ...option,
    recommended: index === 0,
    exerciseCount,
  }));
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
