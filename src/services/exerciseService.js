import { supabase } from '../lib/supabase';
import { getAuthenticatedUserWithRetry, runSupabaseRequestWithAuthRetry } from '../lib/supabaseAuthRetry';

export const TRACKING_TYPES = { BODYWEIGHT:'bodyweight', LOAD:'load', REPS:'reps', TIME:'time', DISTANCE:'distance' };
const FIELDS = 'id,name,display_name,body_region,movement_pattern,training_focus,description,instructions,tips,image_path,difficulty,exercise_family,tracking_modes';
async function enrich(rows) {
  if (!rows?.length) return [];
  const ids=rows.map((e)=>e.id);
  const [links, equipment] = await Promise.all([
    runSupabaseRequestWithAuthRetry(()=>supabase.from('exercise_equipment').select('exercise_id,equipment_id').in('exercise_id',ids)),
    runSupabaseRequestWithAuthRetry(()=>supabase.from('equipment').select('id,name')),
  ]);
  const names=new Map((equipment??[]).map((e)=>[String(e.id),e.name]));
  return rows.map((e)=>({ id:e.id, name:e.display_name||e.name, bodyRegion:e.body_region,
    movementPattern:e.movement_pattern, trainingFocus:e.training_focus, exerciseFamily:e.exercise_family,
    description:e.description, instructions:e.instructions, tips:e.tips, imagePath:e.image_path,
    difficulty:e.difficulty, trackingModes:e.tracking_modes??[],
    equipmentNames:[...new Set((links??[]).filter((link)=>link.exercise_id===e.id && String(link.equipment_id)!=='E00').map((link)=>names.get(String(link.equipment_id))).filter(Boolean))],
  }));
}
export async function getExercises() {
  await getAuthenticatedUserWithRetry();
  const rows=[];
  for(let start=0;;start+=500){
    const batch=await runSupabaseRequestWithAuthRetry(()=>supabase.from('exercises').select(FIELDS).order('id').range(start,start+499));
    rows.push(...(batch??[]));if(!batch || batch.length<500)break;
  }
  // Equipment IN queries stay below API URL limits for the complete catalogue.
  const result=[];
  for(let start=0;start<rows.length;start+=100)result.push(...await enrich(rows.slice(start,start+100)));
  return result.sort((a,b)=>a.name.localeCompare(b.name,'fr'));
}
export async function getExerciseById(exerciseId) {
  await getAuthenticatedUserWithRetry();
  const row=await runSupabaseRequestWithAuthRetry(()=>supabase.from('exercises').select(FIELDS).eq('id',exerciseId).maybeSingle());
  return row ? (await enrich([row]))[0] : null;
}
export async function getExerciseFavorites() {
  const user=await getAuthenticatedUserWithRetry();
  const rows=await runSupabaseRequestWithAuthRetry(()=>supabase.from('user_exercise_preferences').select('exercise_id,preference_state')
    .eq('user_id',user.id).eq('context_key','GLOBAL').eq('preference_state','FAVORI'));
  return (rows??[]).map((row)=>row.exercise_id);
}
export async function setExerciseFavorite(exerciseId, favorite) {
  const user=await getAuthenticatedUserWithRetry();
  const result=await runSupabaseRequestWithAuthRetry(()=>supabase.rpc('set_user_exercise_preference_v1',{
    p_user_id:user.id,p_exercise_id:exerciseId,p_preference_state:favorite?'FAVORI':'NEUTRE',p_context_key:'GLOBAL',
    p_evidence:{source:'EXERCISE_LIBRARY',action:favorite?'FAVORITE':'REMOVE_FAVORITE'},
  }));
  if(result?.status!=='SAVED')throw new Error('Le favori n’a pas pu être enregistré.');
  return result.preference_state==='FAVORI';
}

// Read-only detail metadata, independent from selection and prescription engines.
export async function getExerciseMuscles(exerciseId) {
  if (!exerciseId) return [];
  await getAuthenticatedUserWithRetry();
  const rows = await runSupabaseRequestWithAuthRetry(() => supabase.from('exercise_muscles')
    .select('muscle_id,priority').eq('exercise_id',exerciseId));
  return (rows ?? []).map(row => ({ id: row.muscle_id, priority: row.priority }));
}
