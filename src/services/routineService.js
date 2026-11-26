import {supabase} from '../lib/supabase';
import {getAuthenticatedUserWithRetry,runSupabaseRequestWithAuthRetry} from '../lib/supabaseAuthRetry';
import {normalizeRoutineDraft,localRoutineDate,buildRoutineDayRows} from './routineContract';
const columns='id,name,category,mechanic,planned_minutes,recurrence_days,exercises,archived_at,created_at,updated_at';
async function ownedRoutines(userId,includeArchived=false){
  const rows=[];
  for(let offset=0;;offset+=500){
    const batch=await runSupabaseRequestWithAuthRetry(()=>{
      let query=supabase.from('user_routines').select(columns).eq('user_id',userId);
      if(!includeArchived)query=query.is('archived_at',null);
      return query.order('created_at',{ascending:true}).order('id').range(offset,offset+499);
    });
    rows.push(...(batch??[]));
    if(!batch||batch.length<500)return rows;
  }
}
export async function listRoutines(){
  const user=await getAuthenticatedUserWithRetry();return ownedRoutines(user.id);
}
export async function saveRoutine(draft,id=null){
  const user=await getAuthenticatedUserWithRetry();
  const values={...normalizeRoutineDraft(draft),updated_at:new Date().toISOString()};
  return runSupabaseRequestWithAuthRetry(()=>id
    ?supabase.from('user_routines').update(values).eq('id',id).eq('user_id',user.id).is('archived_at',null).select(columns).single()
    :supabase.from('user_routines').insert({...values,user_id:user.id}).select(columns).single());
}
export async function archiveRoutine(id){
  const user=await getAuthenticatedUserWithRetry();
  return runSupabaseRequestWithAuthRetry(()=>supabase.from('user_routines').update({archived_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('id',id).eq('user_id',user.id).is('archived_at',null).select('id').single());
}
export async function getRoutineDay(date=new Date()){
  const user=await getAuthenticatedUserWithRetry();
  const dateKey=localRoutineDate(date);
  const [routines,realizations]=await Promise.all([ownedRoutines(user.id,true),runSupabaseRequestWithAuthRetry(()=>supabase.from('user_routine_realizations').select('routine_id,local_date').eq('user_id',user.id).eq('local_date',dateKey))]);
  return buildRoutineDayRows(routines,realizations,date);
}
export async function canStartRoutine(){
  const user=await getAuthenticatedUserWithRetry();
  const active=await runSupabaseRequestWithAuthRetry(()=>supabase.from('workout_sessions').select('id').eq('user_id',user.id).eq('status','in_progress').eq('started_local_date',localRoutineDate()).limit(1));
  return !active?.length;
}
export async function completeRoutine(id,date=new Date()){
  const user=await getAuthenticatedUserWithRetry();
  const local_date=localRoutineDate(date);
  await runSupabaseRequestWithAuthRetry(()=>supabase.from('user_routine_realizations').upsert({user_id:user.id,routine_id:id,local_date},{onConflict:'user_id,routine_id,local_date',ignoreDuplicates:true}));
  // Verify a durable completion; the daily unique key makes repeat submissions idempotent.
  return runSupabaseRequestWithAuthRetry(()=>supabase.from('user_routine_realizations').select('routine_id,local_date').eq('user_id',user.id).eq('routine_id',id).eq('local_date',local_date).single());
}
