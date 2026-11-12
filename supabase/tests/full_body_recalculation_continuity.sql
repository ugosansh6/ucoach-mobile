-- DEV only. Set ugerod.qa_user_id first. All fixture rows are rolled back.
begin;
set local statement_timeout='90s';
do $$
declare
  uid uuid:=nullif(current_setting('ugerod.qa_user_id',true),'')::uuid;
  parent_id uuid;
  child_id uuid;
  j jsonb;
  w jsonb;
  exposure jsonb;
begin
  if uid is null then raise exception 'Set ugerod.qa_user_id first'; end if;
  perform set_config('request.jwt.claim.sub',uid::text,true);
  perform set_config('ugerod.session_environment','HOME',true);
  perform set_config('ugerod.session_anchor_date',current_date::text,true);
  insert into public.workout_sessions(user_id,status,duration_minutes,target_region,readiness,focus,available_equipment,injured_zones,progression_intent,generated_workout)
    values(uid,'generated',60,'Full Body','low','Strength',array['Aucun'],'{}','DELOAD','{}') returning id into parent_id;
  insert into public.workout_session_exercises(session_id,exercise_id,exercise_name,block_key,position,status,prescription_json)
    select parent_id,e.id,e.name,'wod',x.pos,'pending',public.c2_solver_prescription(uid,e.id,'{}','SETS_REPS','DELOAD','[]')
    from (values ('EX033',1),('EX524',2),('EX454',3)) x(id,pos) join public.exercises e on e.id=x.id;

  j:=public.c4_generate_full_session(uid,'Strength',60,'low','Full Body','DELOAD','{}','[]',array['Aucun'],3,'Intermédiaire',8,'c4-final-default');
  child_id:=nullif(j->>'session_id','')::uuid;
  if child_id is null then raise exception 'Child generation failed: %',j->>'status'; end if;
  perform public.c4_preserve_recalculation_continuity_v1(uid,parent_id,child_id);
  select generated_workout into w from public.workout_sessions where id=child_id;
  exposure:=public.c4_full_body_exposure_v1(w->'blocks');
  if exposure is distinct from w#>'{meta,architecture,full_body_balance,after}' then
    raise exception 'Continuity diagnostic does not describe final exercises';
  end if;
  if (exposure->>'missing_count')::integer<>0
     or (exposure->>'imbalance')::numeric>(w#>>'{meta,architecture,full_body_balance,generation_after,imbalance}')::numeric+0.0001 then
    raise exception 'Continuity degraded whole-session balance';
  end if;
  if exists(select 1 from public.workout_session_exercises x join public.exercises e on e.id=x.exercise_id
    where x.session_id=child_id and x.block_key='wod' and e.exercise_family='Core') then
    raise exception 'Continuity restored core stacking from the parent';
  end if;
end;
$$;
select 'full_body_recalculation_continuity: PASS' as result;
rollback;
