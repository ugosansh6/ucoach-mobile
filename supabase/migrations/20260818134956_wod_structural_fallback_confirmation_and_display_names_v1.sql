create or replace function public.ugerod_apply_display_names_to_workout_v1(p_workout jsonb)
returns jsonb
language plpgsql
stable
set search_path='public'
as $$
declare
  v_result jsonb:=coalesce(p_workout,'{}'::jsonb);
  v_blocks jsonb;
begin
  if jsonb_typeof(v_result)<>'object' or jsonb_typeof(v_result->'blocks')<>'array' then return v_result; end if;

  select coalesce(jsonb_agg(
    case when jsonb_typeof(b->'exercises')='array' then
      jsonb_set(b,'{exercises}',coalesce((
        select jsonb_agg(
          case when e.display_name is not null and btrim(e.display_name)<>''
            then ex||jsonb_build_object('name',e.display_name)
            else ex end
          order by eord
        )
        from jsonb_array_elements(b->'exercises') with ordinality x(ex,eord)
        left join public.exercises e on e.id=coalesce(ex->>'exercise_id',ex->>'id')
      ),'[]'::jsonb),true)
    else b end
    order by bord
  ),'[]'::jsonb)
  into v_blocks
  from jsonb_array_elements(v_result->'blocks') with ordinality z(b,bord);

  return jsonb_set(v_result,'{blocks}',v_blocks,true);
end;
$$;

create or replace function public.ugerod_workout_display_name_trigger_v1()
returns trigger
language plpgsql
set search_path='public'
as $$
begin
  new.generated_workout:=public.ugerod_apply_display_names_to_workout_v1(new.generated_workout);
  return new;
end;
$$;

drop trigger if exists trg_ugerod_workout_display_names_v1 on public.workout_sessions;
create trigger trg_ugerod_workout_display_names_v1
before insert or update of generated_workout on public.workout_sessions
for each row execute function public.ugerod_workout_display_name_trigger_v1();

create or replace function public.ugerod_session_exercise_display_name_trigger_v1()
returns trigger
language plpgsql
set search_path='public'
as $$
declare v_name text;
begin
  if new.exercise_id is not null then
    select coalesce(nullif(btrim(display_name),''),name) into v_name from public.exercises where id=new.exercise_id;
    if v_name is not null then new.exercise_name:=v_name; end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_ugerod_session_exercise_display_name_v1 on public.workout_session_exercises;
create trigger trg_ugerod_session_exercise_display_name_v1
before insert or update of exercise_id on public.workout_session_exercises
for each row execute function public.ugerod_session_exercise_display_name_trigger_v1();

update public.workout_sessions
set generated_workout=public.ugerod_apply_display_names_to_workout_v1(generated_workout),updated_at=updated_at
where status in ('generated','in_progress') and generated_workout is not null;

update public.workout_session_exercises wse
set exercise_name=coalesce(nullif(btrim(e.display_name),''),e.name),updated_at=wse.updated_at
from public.exercises e
where e.id=wse.exercise_id and wse.status='pending';

create or replace function public.c4_detach_recompiled_wod_instance_v1(
  p_user_id uuid,
  p_session_id uuid,
  p_old_instance_id uuid
) returns uuid
language plpgsql
security definer
set search_path='public'
as $$
declare
  r public.workout_session_exercises%rowtype;
  v_new_id uuid;
  v_generated jsonb;
  v_blocks jsonb;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;

  select wse.* into r
  from public.workout_session_exercises wse
  join public.workout_sessions ws on ws.id=wse.session_id and ws.user_id=p_user_id
  where wse.id=p_old_instance_id and wse.session_id=p_session_id and wse.block_key='wod';

  if not found then return null; end if;

  insert into public.workout_session_exercises(
    session_id,exercise_id,exercise_name,block_key,position,status,prescription,rounds,reps_completed,weight_kg,rpe,notes,
    created_at,updated_at,duration_seconds,distance_meters,prescription_json,expected_outcome_json,expected_rpe_min,expected_rpe_max,
    capacity_snapshot_json,solver_decision_json,user_execution_status,execution_reason_code
  ) values (
    r.session_id,r.exercise_id,r.exercise_name,r.block_key,r.position,r.status,r.prescription,r.rounds,r.reps_completed,r.weight_kg,r.rpe,r.notes,
    r.created_at,r.updated_at,r.duration_seconds,r.distance_meters,r.prescription_json,r.expected_outcome_json,r.expected_rpe_min,r.expected_rpe_max,
    r.capacity_snapshot_json,r.solver_decision_json,r.user_execution_status,r.execution_reason_code
  ) returning id into v_new_id;

  delete from public.workout_session_exercises where id=p_old_instance_id;

  select generated_workout into v_generated from public.workout_sessions where id=p_session_id and user_id=p_user_id for update;
  select coalesce(jsonb_agg(
    case when b->>'block_key'='wod' and jsonb_typeof(b->'exercises')='array' then
      jsonb_set(b,'{exercises}',coalesce((
        select jsonb_agg(
          case when ex->>'session_exercise_id'=p_old_instance_id::text
            then jsonb_set(ex,'{session_exercise_id}',to_jsonb(v_new_id::text),true)
            else ex end
          order by eord
        )
        from jsonb_array_elements(b->'exercises') with ordinality x(ex,eord)
      ),'[]'::jsonb),true)
    else b end
    order by bord
  ),'[]'::jsonb)
  into v_blocks
  from jsonb_array_elements(coalesce(v_generated->'blocks','[]'::jsonb)) with ordinality z(b,bord);

  update public.workout_sessions
  set generated_workout=jsonb_set(coalesce(v_generated,'{}'::jsonb),'{blocks}',v_blocks,true),updated_at=now()
  where id=p_session_id and user_id=p_user_id;

  return v_new_id;
end;
$$;

create or replace function public.c4_wod_structural_fallback_v1(
  p_user_id uuid,
  p_session_exercise_id uuid,
  p_reason text default 'environment',
  p_confirm_structure_change boolean default false
) returns jsonb
language plpgsql
security definer
set search_path='public'
as $$
declare
  target record;
  ws public.workout_sessions%rowtype;
  v_base jsonb;
  v_reduced_exercises jsonb;
  v_reduced jsonb;
  v_prepared jsonb;
  v_final jsonb;
  v_gate jsonb;
  v_inventory jsonb;
  v_names text[];
  v_wod_minutes int;
  v_max_complexity int;
  v_current_mechanic text;
  v_current_ok boolean:=false;
  v_alt_mechanic text:=null;
  v_alt_final jsonb:=null;
  v_alt_gate jsonb:=null;
  v_result jsonb;
  v_intent jsonb:='{}'::jsonb;
  v_ledger jsonb:='{}'::jsonb;
  v_pending jsonb:='{}'::jsonb;
  v_pending_confirmed boolean:=false;
  v_detached_id uuid:=null;
  v_prompt text;
  m record;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;

  select wse.*,e.movement_pattern,e.exercise_family
  into target
  from public.workout_session_exercises wse
  join public.workout_sessions s on s.id=wse.session_id and s.user_id=p_user_id
  join public.exercises e on e.id=wse.exercise_id
  where wse.id=p_session_exercise_id;
  if not found then raise exception 'Session exercise instance not found'; end if;
  if target.block_key<>'wod' then return jsonb_build_object('status','NOT_SUPPORTED','reason','STRUCTURAL_FALLBACK_WOD_ONLY','mutated',false); end if;

  select * into ws from public.workout_sessions where id=target.session_id and user_id=p_user_id for update;
  if ws.status not in ('generated','in_progress') then return jsonb_build_object('status','NOT_AVAILABLE','reason','SESSION_NOT_MUTABLE','mutated',false); end if;
  if ws.wod_started_at is not null then
    return jsonb_build_object('status','NOT_AVAILABLE','reason','STRUCTURAL_FALLBACK_LOCKED_AFTER_WOD_START','mutated',false,'session_id',target.session_id,'session_exercise_id',p_session_exercise_id);
  end if;

  v_pending:=coalesce(ws.planning_context_json->'pending_structural_fallback','{}'::jsonb);
  v_pending_confirmed:=coalesce(p_confirm_structure_change,false) or (
    v_pending->>'session_exercise_id'=p_session_exercise_id::text
    and lower(coalesce(v_pending->>'reason',''))=lower(coalesce(p_reason,''))
    and nullif(v_pending->>'requested_at','')::timestamptz>now()-interval '5 minutes'
  );

  v_base:=public.c4_session_wod_candidate(target.session_id);
  if jsonb_array_length(coalesce(v_base->'exercises','[]'::jsonb))<=1 then
    return jsonb_build_object('status','NO_STRUCTURAL_FALLBACK','reason','CANNOT_REMOVE_LAST_WOD_MOVEMENT','mutated',false,'session_id',target.session_id,'session_exercise_id',p_session_exercise_id);
  end if;

  select coalesce(jsonb_agg(x.value order by x.ord),'[]'::jsonb) into v_reduced_exercises
  from jsonb_array_elements(coalesce(v_base->'exercises','[]'::jsonb)) with ordinality x(value,ord)
  where x.ord<>target.position;

  v_reduced:=jsonb_set(v_base,'{exercises}',v_reduced_exercises,true);
  v_current_mechanic:=upper(coalesce(v_base->>'mechanic',ws.mechanic_json->>'mechanic_key','CIRCUIT'));
  v_names:=coalesce(ws.available_equipment,'{}'::text[]); if cardinality(v_names)=0 then v_names:=array['Aucun']; end if;
  v_inventory:=public.resolve_user_equipment_inventory(p_user_id,v_names,'c4-final-default');
  v_wod_minutes:=coalesce(nullif(ws.mechanic_json->>'wod_budget_minutes','')::int,(select nullif(b->>'duration_minutes','')::int from jsonb_array_elements(coalesce(ws.generated_workout->'blocks','[]'::jsonb)) b where b->>'block_key'='wod' limit 1),10);
  v_max_complexity:=public.c4_user_max_swap_complexity(p_user_id,ws.readiness);

  v_prepared:=public.c4_prepare_candidate(v_reduced,'c4-final-default');
  v_final:=public.c4_finalize_candidate(v_prepared,ws.expected_stimulus_json,coalesce(ws.duration_minutes,45),v_wod_minutes,'c4-final-default','c3-sim-default');
  v_gate:=public.c4_candidate_quality_gate_v2(v_final,coalesce(ws.readiness,'normal'),coalesce(ws.focus,'General Fitness'),ws.target_region,coalesce(ws.injured_zones,'{}'::text[]),v_inventory,v_max_complexity,'c4-final-default');
  v_current_ok:=coalesce((v_final#>>'{c4_final,feasible}')::boolean,false) and coalesce((v_gate->>'pass')::boolean,false);

  if v_current_ok then
    v_result:=public.c4_apply_wod_candidate(p_user_id,target.session_id,v_final,v_gate,'STRUCTURAL_FALLBACK_REMOVE:'||target.exercise_id);
    v_detached_id:=public.c4_detach_recompiled_wod_instance_v1(p_user_id,target.session_id,p_session_exercise_id);
    if lower(coalesce(p_reason,'')) in ('equipment','environment') then v_intent:=public.record_uncovered_pattern_intent_v1(p_user_id,target.session_id,target.exercise_id,p_reason); end if;
    begin v_ledger:=public.d_sync_session_stimulus_ledger(target.session_id); exception when others then v_ledger:=jsonb_build_object('status','LEDGER_SYNC_SKIPPED'); end;
    update public.workout_sessions set planning_context_json=(coalesce(planning_context_json,'{}'::jsonb)-'pending_structural_fallback')||jsonb_build_object('last_structural_fallback',jsonb_build_object('version','structural-fallback-v1.1','applied_at',now(),'removed_exercise_id',target.exercise_id,'reason',p_reason,'old_mechanic',v_current_mechanic,'new_mechanic',v_current_mechanic,'mechanic_changed',false,'uncovered_pattern',target.movement_pattern)),updated_at=now() where id=target.session_id and user_id=p_user_id;
    return jsonb_build_object('status','STRUCTURAL_FALLBACK_APPLIED','mutated',true,'session_id',target.session_id,'removed_session_exercise_id',p_session_exercise_id,'removed_exercise_id',target.exercise_id,'removed_pattern',target.movement_pattern,'old_mechanic',v_current_mechanic,'new_mechanic',v_current_mechanic,'mechanic_changed',false,'rebalanced',true,'detached_recompiled_instance_id',v_detached_id,'result',v_result,'uncovered_pattern_intent',v_intent,'ledger_sync',v_ledger,'version','structural-fallback-v1.1');
  end if;

  for m in
    select wm.mechanic_key,public.c2_mechanic_fit(wm.mechanic_key,ws.expected_stimulus_json,ws.progression_intent) fit
    from public.workout_mechanics wm where wm.active and wm.mechanic_kind='core' and wm.mechanic_key<>v_current_mechanic
    order by public.c2_mechanic_fit(wm.mechanic_key,ws.expected_stimulus_json,ws.progression_intent) desc,wm.mechanic_key
  loop
    v_prepared:=public.c4_prepare_candidate(jsonb_set(jsonb_set(v_reduced,'{mechanic}',to_jsonb(m.mechanic_key),true),'{variant_key}','null'::jsonb,true),'c4-final-default');
    v_final:=public.c4_finalize_candidate(v_prepared,ws.expected_stimulus_json,coalesce(ws.duration_minutes,45),v_wod_minutes,'c4-final-default','c3-sim-default');
    v_gate:=public.c4_candidate_quality_gate_v2(v_final,coalesce(ws.readiness,'normal'),coalesce(ws.focus,'General Fitness'),ws.target_region,coalesce(ws.injured_zones,'{}'::text[]),v_inventory,v_max_complexity,'c4-final-default');
    if coalesce((v_final#>>'{c4_final,feasible}')::boolean,false) and coalesce((v_gate->>'pass')::boolean,false) then v_alt_mechanic:=m.mechanic_key;v_alt_final:=v_final;v_alt_gate:=v_gate;exit; end if;
  end loop;

  if v_alt_mechanic is null then return jsonb_build_object('status','NO_STRUCTURAL_FALLBACK','mutated',false,'session_id',target.session_id,'session_exercise_id',p_session_exercise_id,'removed_exercise_id',target.exercise_id,'reason','NO_FEASIBLE_REBALANCED_WOD','version','structural-fallback-v1.1'); end if;

  if not v_pending_confirmed then
    v_prompt:='Sans ce mouvement, UGEROD propose de passer en '||replace(v_alt_mechanic,'_',' ')||'. Appuie à nouveau sur le même choix pour confirmer.';
    update public.workout_sessions set planning_context_json=coalesce(planning_context_json,'{}'::jsonb)||jsonb_build_object('pending_structural_fallback',jsonb_build_object('version','structural-fallback-v1.1','requested_at',now(),'session_exercise_id',p_session_exercise_id,'exercise_id',target.exercise_id,'reason',p_reason,'old_mechanic',v_current_mechanic,'proposed_mechanic',v_alt_mechanic,'proposed_parameters',coalesce(v_alt_final#>'{c4_final,mechanic_json,parameters}','{}'::jsonb))),updated_at=now() where id=target.session_id and user_id=p_user_id;
    return jsonb_build_object('status','STRUCTURAL_CHANGE_REQUIRED','mutated',false,'session_id',target.session_id,'session_exercise_id',p_session_exercise_id,'removed_exercise_id',target.exercise_id,'removed_pattern',target.movement_pattern,'old_mechanic',v_current_mechanic,'proposed_mechanic',v_alt_mechanic,'proposed_parameters',coalesce(v_alt_final#>'{c4_final,mechanic_json,parameters}','{}'::jsonb),'message',v_prompt,'requires_user_confirmation',true,'confirmation_mode','repeat_same_reason_within_5_minutes','version','structural-fallback-v1.1');
  end if;

  v_result:=public.c4_apply_wod_candidate(p_user_id,target.session_id,v_alt_final,v_alt_gate,'STRUCTURAL_FALLBACK_FORMAT:'||v_current_mechanic||'->'||v_alt_mechanic);
  v_detached_id:=public.c4_detach_recompiled_wod_instance_v1(p_user_id,target.session_id,p_session_exercise_id);
  if lower(coalesce(p_reason,'')) in ('equipment','environment') then v_intent:=public.record_uncovered_pattern_intent_v1(p_user_id,target.session_id,target.exercise_id,p_reason); end if;
  begin v_ledger:=public.d_sync_session_stimulus_ledger(target.session_id); exception when others then v_ledger:=jsonb_build_object('status','LEDGER_SYNC_SKIPPED'); end;
  update public.workout_sessions set planning_context_json=(coalesce(planning_context_json,'{}'::jsonb)-'pending_structural_fallback')||jsonb_build_object('last_structural_fallback',jsonb_build_object('version','structural-fallback-v1.1','applied_at',now(),'removed_exercise_id',target.exercise_id,'reason',p_reason,'old_mechanic',v_current_mechanic,'new_mechanic',v_alt_mechanic,'mechanic_changed',true,'user_confirmed',true,'uncovered_pattern',target.movement_pattern)),updated_at=now() where id=target.session_id and user_id=p_user_id;
  return jsonb_build_object('status','STRUCTURAL_FALLBACK_APPLIED','mutated',true,'session_id',target.session_id,'removed_session_exercise_id',p_session_exercise_id,'removed_exercise_id',target.exercise_id,'removed_pattern',target.movement_pattern,'old_mechanic',v_current_mechanic,'new_mechanic',v_alt_mechanic,'mechanic_changed',true,'user_confirmed',true,'rebalanced',true,'detached_recompiled_instance_id',v_detached_id,'result',v_result,'uncovered_pattern_intent',v_intent,'ledger_sync',v_ledger,'version','structural-fallback-v1.1');
end;
$$;
