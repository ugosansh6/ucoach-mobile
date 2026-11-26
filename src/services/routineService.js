import AsyncStorage from '@react-native-async-storage/async-storage';
import {supabase} from '../lib/supabase';
import {getAuthenticatedUserWithRetry,runSupabaseRequestWithAuthRetry} from '../lib/supabaseAuthRetry';
import {normalizeRoutineDraft,localRoutineDate,buildRoutineDayRows,validRoutineCheckpoint} from './routineContract';
const columns='id,name,category,mechanic,parameters,planned_minutes,recurrence_days,exercises,archived_at,created_at,updated_at';
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
  const checkpoint=await readRoutineCheckpoint(user.id,date).catch(()=>null);
  return buildRoutineDayRows(routines,realizations,date,checkpoint);
}
export async function canStartRoutine(){
  const user=await getAuthenticatedUserWithRetry();
  const active=await runSupabaseRequestWithAuthRetry(()=>supabase.from('workout_sessions').select('id').eq('user_id',user.id).eq('status','in_progress').eq('started_local_date',localRoutineDate()).limit(1));
  return !active?.length;
}
export async function completeRoutine(id,date=new Date(),expectedOwner=null){
  const user=await getAuthenticatedUserWithRetry();
  if(expectedOwner&&user.id!==expectedOwner)throw new Error('Compte modifié : reconnecte-toi.');
  const local_date=localRoutineDate(date);
  await runSupabaseRequestWithAuthRetry(()=>supabase.from('user_routine_realizations').upsert({user_id:user.id,routine_id:id,local_date},{onConflict:'user_id,routine_id,local_date',ignoreDuplicates:true}));
  // Verify a durable completion; the daily unique key makes repeat submissions idempotent.
  return runSupabaseRequestWithAuthRetry(()=>supabase.from('user_routine_realizations').select('routine_id,local_date').eq('user_id',user.id).eq('routine_id',id).eq('local_date',local_date).single());
}

const checkpointKey=userId=>'ugerod.routine.active.v2:'+userId;
export async function readRoutineCheckpoint(userId,date=new Date()){
 const value=await AsyncStorage.getItem(checkpointKey(userId));
 if(!value)return null;
 try{return validRoutineCheckpoint(JSON.parse(value),date);}catch{return null;}
}
export async function writeRoutineCheckpoint(userId,checkpoint){
 if(!userId)throw new Error('Compte indisponible.');
 if(!validRoutineCheckpoint(checkpoint))throw new Error('Cette routine doit être relancée aujourd’hui.');
 await AsyncStorage.setItem(checkpointKey(userId),JSON.stringify(checkpoint));
}
export async function clearRoutineCheckpoint(userId){if(userId)await AsyncStorage.removeItem(checkpointKey(userId));}
export async function loadRoutineScreen(){
 const user=await getAuthenticatedUserWithRetry();
 const [rows,checkpoint]=await Promise.all([ownedRoutines(user.id),readRoutineCheckpoint(user.id)]);
 return {rows,ownerId:user.id,checkpoint:checkpoint&&rows.some(r=>r.id===checkpoint.routine.id)?checkpoint:null};
}
