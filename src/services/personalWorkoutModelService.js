import {supabase} from '../lib/supabase';
import {getAuthenticatedUserWithRetry,runSupabaseRequestWithAuthRetry} from '../lib/supabaseAuthRetry';
const table='personal_workout_models';
const fields='id,name,origin,draft,source_key,source_payload,created_at,updated_at';
export async function listPersonalWorkoutModels(){
 const user=await getAuthenticatedUserWithRetry();
 return (await runSupabaseRequestWithAuthRetry(()=>supabase.from(table).select(fields).eq('user_id',user.id).order('updated_at',{ascending:false})))??[];
}
export async function getPersonalWorkoutModel(id){
 const user=await getAuthenticatedUserWithRetry();
 return await runSupabaseRequestWithAuthRetry(()=>supabase.from(table).select(fields).eq('user_id',user.id).eq('id',id).maybeSingle());
}
export async function renamePersonalWorkoutModel(id,name){
 const user=await getAuthenticatedUserWithRetry();
 const value=String(name??'').trim();
 if(!value||value.length>120)throw new Error('Le nom doit contenir entre 1 et 120 caractères.');
 return runSupabaseRequestWithAuthRetry(()=>supabase.from(table).update({name:value,updated_at:new Date().toISOString()}).eq('user_id',user.id).eq('id',id).select(fields).single());
}
export async function duplicatePersonalWorkoutModel(id){
 const model=await getPersonalWorkoutModel(id);
 if(!model)throw new Error('Modèle introuvable.');
 const user=await getAuthenticatedUserWithRetry();
 return runSupabaseRequestWithAuthRetry(()=>supabase.from(table).insert({user_id:user.id,name:(model.name.slice(0,111)+' (copie)').slice(0,120),origin:model.origin,draft:model.draft,source_payload:model.source_payload}).select(fields).single());
}
export async function deletePersonalWorkoutModel(id){
 const user=await getAuthenticatedUserWithRetry();
 return runSupabaseRequestWithAuthRetry(()=>supabase.from(table).delete().eq('user_id',user.id).eq('id',id).select('id').single());
}

export async function planPersonalProgram(modelId,date,draft,surface=null){
 await getAuthenticatedUserWithRetry();
 return runSupabaseRequestWithAuthRetry(()=>supabase.rpc('week_plan_personal_program_v1',{p_model_id:modelId,p_date:date,p_draft:draft,p_surface:surface}));
}
