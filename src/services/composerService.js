import { supabase } from '../lib/supabase';

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
    .select('id,name,display_name,exercise_type,difficulty,technical_complexity,movement_pattern,exercise_family,body_region,training_focus,equipment_requirement,selection_weight,usable_for,home_friendly,prescription_type,tabata_eligible,warmup_eligible,warmup_role,wod_role')
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
      bodyRegion: exercise.body_region,
      movementPattern: exercise.movement_pattern,
      exerciseFamily: exercise.exercise_family,
      prescriptionType: exercise.prescription_type,
      score: scoreExercise(exercise, focus, targetRegion),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(3, limit));
}

export function buildComposerArchitectures({ durationMinutes, intentKey, targets = {} }) {
  const warmup = Number(targets.warmup_minutes ?? (durationMinutes <= 30 ? 5 : 6));
  const tabata = Number(targets.tabata_minutes ?? 4);
  const skill = Number(targets.skill_target_minutes ?? (durationMinutes >= 45 ? 10 : 0));
  const wod = Number(targets.wod_target_minutes ?? Math.max(10, Math.round(durationMinutes * 0.35)));
  const strength = Math.max(10, skill || Math.round(durationMinutes * 0.24));

  const conditioning = {
    key: 'conditioning',
    title: 'Plus conditioning',
    blocks: [
      { type: 'WARMUP', label: 'Warm-up', minutes: warmup },
      { type: 'TABATA', label: 'Tabata', minutes: tabata },
      { type: 'WOD', label: 'WOD', minutes: Math.min(durationMinutes - warmup - tabata - 4, wod + 6) },
    ],
  };
  const balanced = {
    key: 'balanced',
    title: 'Équilibrée',
    blocks: [
      { type: 'WARMUP', label: 'Warm-up', minutes: warmup },
      { type: 'TABATA', label: 'Tabata', minutes: tabata },
      { type: 'STRENGTH', label: 'Strength', minutes: strength },
      { type: 'WOD', label: 'WOD', minutes: Math.max(8, durationMinutes - warmup - tabata - strength - 5) },
    ],
  };
  const strengthFirst = {
    key: 'strength',
    title: 'Plus force',
    blocks: [
      { type: 'WARMUP', label: 'Warm-up', minutes: warmup },
      { type: 'STRENGTH', label: 'Strength', minutes: strength + 5 },
      { type: 'WOD', label: 'WOD court', minutes: Math.max(8, durationMinutes - warmup - strength - 10) },
    ],
  };

  const normalized = String(intentKey ?? '').toUpperCase();
  const ordered = normalized.includes('STRENGTH') || normalized.includes('FORCE')
    ? [strengthFirst, balanced, conditioning]
    : normalized.includes('CONDITION')
      ? [conditioning, balanced, strengthFirst]
      : [balanced, conditioning, strengthFirst];

  return ordered.map((option, index) => ({ ...option, recommended: index === 0 }));
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
