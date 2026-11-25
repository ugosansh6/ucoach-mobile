-- C4.4b — shared persistence/recompile path for swap and format changes.

create or replace function public.c4_prescription_text(p jsonb)
returns text
language plpgsql
immutable
as $$
declare a text;b text;v text:='Prescription adaptée';load_text text;
begin
  a:=coalesce(p->>'reps_min',p->>'duration_seconds_min',p->>'distance_meters_min');
  b:=coalesce(p->>'reps_max',p->>'duration_seconds_max',p->>'distance_meters_max');
  if p ? 'reps_min' or p ? 'reps_max' then
    v:=case when a=b or b is null then coalesce(a,b)||' reps' else a||' à '||b||' reps' end;
    if p->>'reps_semantics'='per_side' then v:=v||' par côté'; end if;
  elsif p ? 'duration_seconds_min' or p ? 'duration_seconds_max' then
    v:=case when a=b or b is null then coalesce(a,b)||' sec' else a||' à '||b||' sec' end;
  elsif p ? 'distance_meters_min' or p ? 'distance_meters_max' then
    v:=case when a=b or b is null then coalesce(a,b)||' m' else a||' à '||b||' m' end;
  end if;
  if nullif(p->>'load_kg','') is not null then
    load_text:=p->>'load_kg'||' kg';
    if p#>>'{load_resolution,load_scope}'='per_implement' then load_text:=load_text||' / élément'; end if;
    v:=v||' — '||load_text;
  end if;
  return v;
end;
$$;

create or replace function public.c4_session_wod_candidate(p_session_id uuid)
returns jsonb
language sql
stable
set search_path=public
as $$
  select jsonb_build_object(
    'mechanic',upper(coalesce(ws.mechanic_json->>'mechanic_key','CIRCUIT')),
    'variant_key',nullif(upper(coalesce(ws.mechanic_json->>'variant_key','')),''),
    'overlays',coalesce(ws.mechanic_json#>'{parameters,overlays}','[]'::jsonb),
    'coach_score',coalesce((select avg(coalesce(nullif(wse.solver_decision_json->>'exercise_candidate_score','')::numeric,50)) from public.workout_session_exercises wse where wse.session_id=ws.id and wse.block_key='wod'),50),
    'mechanic_fit',70,
    'exercises',coalesce((
      select jsonb_agg(jsonb_build_object(
        'exercise_id',wse.exercise_id,'name',wse.exercise_name,'pattern',e.movement_pattern,'family',e.exercise_family,
        'candidate_score',coalesce(nullif(wse.solver_decision_json->>'exercise_candidate_score','')::numeric,50),
        'components',coalesce(wse.solver_decision_json->'score_components','{}'::jsonb),
        'prescription',coalesce(wse.prescription_json,'{}'::jsonb)
      ) order by wse.position)
      from public.workout_session_exercises wse
      join public.exercises e on e.id=wse.exercise_id
      where wse.session_id=ws.id and wse.block_key='wod'
    ),'[]'::jsonb)
  )
  from public.workout_sessions ws where ws.id=p_session_id;
$$;

create or replace function public.c4_apply_wod_candidate(
  p_user_id uuid,
  p_session_id uuid,
  p_candidate jsonb,
  p_quality_gate jsonb,
  p_action text default 'RECOMPILE'
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  ws record;
  v_final jsonb:=coalesce(p_candidate->'c4_final','{}'::jsonb);
  v_mechanic_json jsonb:=coalesce(p_candidate#>'{c4_final,mechanic_json}','{}'::jsonb);
  v_mechanic text:=upper(coalesce(p_candidate->>'mechanic',v_mechanic_json->>'mechanic_key','CIRCUIT'));
  v_params jsonb:=coalesce(v_mechanic_json->'parameters','{}'::jsonb);
  v_ex jsonb;v_pres jsonb;v_instance uuid;v_name text;v_position int:=0;v_new_count int;
  v_rounds int;v_cap jsonb;v_wod_exercises jsonb:='[]'::jsonb;
  v_generated jsonb;v_blocks jsonb:='[]'::jsonb;v_block jsonb;v_wod_block jsonb:='{}'::jsonb;v_found_wod boolean:=false;
  v_duration int;v_rpe_min numeric;v_rpe_max numeric;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;
  select * into ws from public.workout_sessions where id=p_session_id and user_id=p_user_id for update;
  if not found then raise exception 'Session not found'; end if;
  if ws.status not in ('generated','in_progress') then raise exception 'Session cannot be recompiled in status %',ws.status; end if;

  v_new_count:=jsonb_array_length(coalesce(p_candidate->'exercises','[]'::jsonb));
  if v_new_count=0 then raise exception 'Cannot apply empty WOD'; end if;
  v_rpe_min:=nullif(ws.expected_stimulus_json#>>'{rpe_target,min}','')::numeric;
  v_rpe_max:=nullif(ws.expected_stimulus_json#>>'{rpe_target,max}','')::numeric;
  v_rounds:=coalesce(nullif(v_params->>'rounds','')::int,nullif(v_params->>'sets','')::int,nullif(v_params->>'cycles','')::int,nullif(v_params->>'rungs','')::int);

  for v_ex in select value from jsonb_array_elements(p_candidate->'exercises')
  loop
    v_position:=v_position+1;v_pres:=coalesce(v_ex->'prescription','{}'::jsonb);
    select name into v_name from public.exercises where id=v_ex->>'exercise_id';
    select id into v_instance from public.workout_session_exercises where session_id=p_session_id and block_key='wod' and position=v_position;

    select coalesce(jsonb_build_object(
      'source','user_exercise_coach_state','state',s.state,'recommendation',s.recommendation,
      'reps_envelope',s.reps_envelope,'load_envelope',s.load_envelope,'time_envelope',s.time_envelope,'distance_envelope',s.distance_envelope,'pace_envelope',s.pace_envelope,
      'capability_confidence',s.capability_confidence,'capability_freshness',s.capability_freshness,'valid_evidence_count',s.valid_evidence_count),'{}'::jsonb)
    into v_cap from public.user_exercise_coach_state s where s.user_id=p_user_id and s.exercise_id=v_ex->>'exercise_id';

    if v_instance is null then
      insert into public.workout_session_exercises(
        session_id,exercise_id,exercise_name,block_key,position,status,prescription,prescription_json,rounds,
        expected_outcome_json,expected_rpe_min,expected_rpe_max,capacity_snapshot_json,solver_decision_json
      ) values (
        p_session_id,v_ex->>'exercise_id',v_name,'wod',v_position,'pending',public.c4_prescription_text(v_pres),v_pres,v_rounds,
        jsonb_build_object('mechanic',v_mechanic,'block_parameters',v_params,'predicted_block_volume',coalesce(v_final->'predicted_volume','{}'::jsonb),'whole_wod_metrics',coalesce(v_final->'whole_wod_metrics','{}'::jsonb)),
        v_rpe_min,v_rpe_max,coalesce(v_cap,'{}'::jsonb),
        jsonb_build_object('engine_version','c4-full-backend-v2','action',p_action,'quality_gate',coalesce(p_quality_gate,'{}'::jsonb),'exercise_candidate_score',v_ex->'candidate_score','score_components',coalesce(v_ex->'components','{}'::jsonb),'mechanic',v_mechanic)
      ) returning id into v_instance;
    else
      update public.workout_session_exercises set
        exercise_id=v_ex->>'exercise_id',exercise_name=v_name,status='pending',prescription=public.c4_prescription_text(v_pres),prescription_json=v_pres,rounds=v_rounds,
        expected_outcome_json=jsonb_build_object('mechanic',v_mechanic,'block_parameters',v_params,'predicted_block_volume',coalesce(v_final->'predicted_volume','{}'::jsonb),'whole_wod_metrics',coalesce(v_final->'whole_wod_metrics','{}'::jsonb)),
        expected_rpe_min=v_rpe_min,expected_rpe_max=v_rpe_max,capacity_snapshot_json=coalesce(v_cap,'{}'::jsonb),
        solver_decision_json=jsonb_build_object('engine_version','c4-full-backend-v2','action',p_action,'quality_gate',coalesce(p_quality_gate,'{}'::jsonb),'exercise_candidate_score',v_ex->'candidate_score','score_components',coalesce(v_ex->'components','{}'::jsonb),'mechanic',v_mechanic),
        updated_at=now()
      where id=v_instance;
    end if;

    v_wod_exercises:=v_wod_exercises||jsonb_build_array(jsonb_build_object(
      'id',v_ex->>'exercise_id','session_exercise_id',v_instance,'name',v_name,
      'pattern',(select movement_pattern from public.exercises where id=v_ex->>'exercise_id'),
      'region',(select body_region from public.exercises where id=v_ex->>'exercise_id'),
      'prescription',public.c4_prescription_text(v_pres),'prescription_json',v_pres,
      'tracking_modes',(select to_jsonb(tracking_modes) from public.exercises where id=v_ex->>'exercise_id')
    ));
  end loop;

  delete from public.workout_session_exercises where session_id=p_session_id and block_key='wod' and position>v_new_count;

  v_generated:=coalesce(ws.generated_workout,'{}'::jsonb);
  for v_block in select value from jsonb_array_elements(coalesce(v_generated->'blocks','[]'::jsonb))
  loop
    if v_block->>'block_key'='wod' then
      v_found_wod:=true;
      v_duration:=coalesce(nullif(v_mechanic_json->>'wod_budget_minutes','')::int,nullif(v_block->>'duration_minutes','')::int,10);
      v_wod_block:=v_block||jsonb_build_object(
        'block_key','wod','block_name',coalesce(v_block->>'block_name','WOD principal'),'duration_minutes',v_duration,
        'mechanic',v_mechanic,'mechanic_json',v_mechanic_json,'structure',v_mechanic||' — '||v_duration||' min',
        'rounds',v_rounds,'exercises',v_wod_exercises,
        'expected_outcome',jsonb_build_object('role','primary_training_stimulus','predicted_volume',coalesce(v_final->'predicted_volume','{}'::jsonb),'whole_wod_metrics',coalesce(v_final->'whole_wod_metrics','{}'::jsonb))
      );
      v_blocks:=v_blocks||jsonb_build_array(v_wod_block);
    else
      v_blocks:=v_blocks||jsonb_build_array(v_block);
    end if;
  end loop;
  if not v_found_wod then
    v_duration:=coalesce(nullif(v_mechanic_json->>'wod_budget_minutes','')::int,10);
    v_blocks:=v_blocks||jsonb_build_array(jsonb_build_object('block_key','wod','block_name','WOD principal','duration_minutes',v_duration,'mechanic',v_mechanic,'mechanic_json',v_mechanic_json,'structure',v_mechanic||' — '||v_duration||' min','rounds',v_rounds,'exercises',v_wod_exercises));
  end if;

  v_generated:=jsonb_set(v_generated,'{blocks}',v_blocks,true);
  v_generated:=jsonb_set(v_generated,'{version}','"c4-full-backend-v2"'::jsonb,true);
  v_generated:=jsonb_set(v_generated,'{meta,session_engine}','"c4-full-backend-v2"'::jsonb,true);
  v_generated:=jsonb_set(v_generated,'{meta,last_wod_action}',to_jsonb(p_action),true);

  update public.workout_sessions set
    mechanic_json=v_mechanic_json,
    quality_gate_json=coalesce(p_quality_gate,'{}'::jsonb),
    generated_workout=v_generated,updated_at=now()
  where id=p_session_id and user_id=p_user_id;

  return jsonb_build_object('status','APPLIED','session_id',p_session_id,'action',p_action,'mechanic',v_mechanic,'mechanic_json',v_mechanic_json,'exercise_count',v_new_count,'exercises',v_wod_exercises,'generated_workout',v_generated);
end;
$$;

revoke all on function public.c4_apply_wod_candidate(uuid,uuid,jsonb,jsonb,text) from public;
grant execute on function public.c4_apply_wod_candidate(uuid,uuid,jsonb,jsonb,text) to authenticated;
;
