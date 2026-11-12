-- Run after setting ugerod.qa_user_id to an existing DEV QA profile.
begin;
do $test$
declare uid uuid:=current_setting('ugerod.qa_user_id')::uuid; p jsonb; r jsonb;
begin
  p:='{"status":"READY","architecture":{},"blocks":[{"block_key":"tabata","duration_minutes":4,"exercises":[{"id":"EX320"},{"id":"EX524"}]},{"block_key":"warmup","duration_minutes":5,"exercises":[{"id":"EX098"}]},{"block_key":"wod","duration_minutes":10,"exercises":[{"id":"EX320"},{"id":"EX087"}]}]}';
  r:=public.ugerod_finalize_environment_plan_v1(p,uid,'HOME','Strength',30,'{}','[]',3,'Intermédiaire',null,false);
  if r->>'status'<>'READY' then raise exception 'Distinct signature unavailable';end if;
  if r#>'{blocks,2,exercises}' is distinct from p#>'{blocks,2,exercises}' or r#>'{blocks,2,duration_minutes}' is distinct from p#>'{blocks,2,duration_minutes}' then raise exception 'Signature repair changed WOD';end if;
  if exists(select 1 from jsonb_array_elements(r#>'{blocks,0,exercises}') ex where coalesce(ex->>'exercise_id',ex->>'id')=any(public.exercise_expand_functional_exclusions_v1(array['EX320','EX087','EX098']))) then raise exception 'Signature still repeats final training';end if;
end $test$;
do $mutation$
declare uid uuid:=current_setting('ugerod.qa_user_id')::uuid; sid uuid:=gen_random_uuid(); blocked boolean:=false; before_hash text; after_hash text;
begin
  insert into public.workout_sessions(id,user_id,status,duration_minutes,readiness,focus,target_region,available_equipment,injured_zones,generated_workout)
  values(sid,uid,'generated',30,'normal','Strength','Full Body',array['Aucun'],'{}',
    '{"blocks":[{"block_key":"tabata","exercises":[{"exercise_id":"EX320"}]},{"block_key":"wod","exercises":[{"exercise_id":"EX009"}]}]}');
  select md5(generated_workout::text) into before_hash from public.workout_sessions where id=sid;
  begin
    perform public.c4_apply_wod_candidate(uid,sid,'{"mechanic":"CIRCUIT","exercises":[{"exercise_id":"EX098"}]}','{"pass":true}','RECOMPILE');
  exception when others then
    if sqlerrm like 'Ce WOD répète%' then blocked:=true;else raise;end if;
  end;
  select md5(generated_workout::text) into after_hash from public.workout_sessions where id=sid;
  if not blocked or before_hash is distinct from after_hash then raise exception 'Format change introduced a signature variant';end if;
end $mutation$;
rollback;
