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
  if target.block_key<>'wod' then
    return jsonb_build_object('status','NOT_SUPPORTED','reason','STRUCTURAL_FALLBACK_WOD_ONLY','mutated',false);
  end if;

  select * into ws from public.workout_sessions where id=target.session_id and user_id=p_user_id for update;
  if ws.status not in ('generated','in_progress') then
    return jsonb_build_object('status','NOT_AVAILABLE','reason','SESSION_NOT_MUTABLE','mutated',false);
  end if;
  if ws.wod_started_at is not null then
    return jsonb_build_object(
      'status','NOT_AVAILABLE','reason','STRUCTURAL_FALLBACK_LOCKED_AFTER_WOD_START','mutated',false,
      'session_id',target.session_id,'session_exercise_id',p_session_exercise_id
    );
  end if;

  v_base:=public.c4_session_wod_candidate(target.session_id);
  if jsonb_array_length(coalesce(v_base->'exercises','[]'::jsonb))<=1 then
    return jsonb_build_object(
      'status','NO_STRUCTURAL_FALLBACK','reason','CANNOT_REMOVE_LAST_WOD_MOVEMENT','mutated',false,
      'session_id',target.session_id,'session_exercise_id',p_session_exercise_id
    );
  end if;

  select coalesce(jsonb_agg(x.value order by x.ord),'[]'::jsonb)
  into v_reduced_exercises
  from jsonb_array_elements(coalesce(v_base->'exercises','[]'::jsonb)) with ordinality x(value,ord)
  where x.ord<>target.position;

  v_reduced:=jsonb_set(v_base,'{exercises}',v_reduced_exercises,true);
  v_current_mechanic:=upper(coalesce(v_base->>'mechanic',ws.mechanic_json->>'mechanic_key','CIRCUIT'));
  v_names:=coalesce(ws.available_equipment,'{}'::text[]);
  if cardinality(v_names)=0 then v_names:=array['Aucun']; end if;
  v_inventory:=public.resolve_user_equipment_inventory(p_user_id,v_names,'c4-final-default');
  v_wod_minutes:=coalesce(
    nullif(ws.mechanic_json->>'wod_budget_minutes','')::int,
    (select nullif(b->>'duration_minutes','')::int from jsonb_array_elements(coalesce(ws.generated_workout->'blocks','[]'::jsonb)) b where b->>'block_key'='wod' limit 1),
    10
  );
  v_max_complexity:=public.c4_user_max_swap_complexity(p_user_id,ws.readiness);

  v_prepared:=public.c4_prepare_candidate(v_reduced,'c4-final-default');
  v_final:=public.c4_finalize_candidate(v_prepared,ws.expected_stimulus_json,coalesce(ws.duration_minutes,45),v_wod_minutes,'c4-final-default','c3-sim-default');
  v_gate:=public.c4_candidate_quality_gate_v2(
    v_final,coalesce(ws.readiness,'normal'),coalesce(ws.focus,'General Fitness'),ws.target_region,
    coalesce(ws.injured_zones,'{}'::text[]),v_inventory,v_max_complexity,'c4-final-default'
  );
  v_current_ok:=coalesce((v_final#>>'{c4_final,feasible}')::boolean,false) and coalesce((v_gate->>'pass')::boolean,false);

  if v_current_ok then
    v_result:=public.c4_apply_wod_candidate(
      p_user_id,target.session_id,v_final,v_gate,'STRUCTURAL_FALLBACK_REMOVE:'||target.exercise_id
    );

    if lower(coalesce(p_reason,'')) in ('equipment','environment') then
      v_intent:=public.record_uncovered_pattern_intent_v1(p_user_id,target.session_id,target.exercise_id,p_reason);
    end if;
    begin v_ledger:=public.d_sync_session_stimulus_ledger(target.session_id); exception when others then v_ledger:=jsonb_build_object('status','LEDGER_SYNC_SKIPPED'); end;

    update public.workout_sessions
    set planning_context_json=coalesce(planning_context_json,'{}'::jsonb)||jsonb_build_object(
      'last_structural_fallback',jsonb_build_object(
        'version','structural-fallback-v1','applied_at',now(),'removed_exercise_id',target.exercise_id,
        'reason',p_reason,'old_mechanic',v_current_mechanic,'new_mechanic',v_current_mechanic,
        'mechanic_changed',false,'uncovered_pattern',target.movement_pattern
      )
    ),updated_at=now()
    where id=target.session_id and user_id=p_user_id;

    return jsonb_build_object(
      'status','STRUCTURAL_FALLBACK_APPLIED','mutated',true,'session_id',target.session_id,
      'removed_session_exercise_id',p_session_exercise_id,'removed_exercise_id',target.exercise_id,
      'removed_pattern',target.movement_pattern,'old_mechanic',v_current_mechanic,'new_mechanic',v_current_mechanic,
      'mechanic_changed',false,'rebalanced',true,'result',v_result,'uncovered_pattern_intent',v_intent,
      'ledger_sync',v_ledger,'version','structural-fallback-v1'
    );
  end if;

  for m in
    select wm.mechanic_key,public.c2_mechanic_fit(wm.mechanic_key,ws.expected_stimulus_json,ws.progression_intent) fit
    from public.workout_mechanics wm
    where wm.active and wm.mechanic_kind='core' and wm.mechanic_key<>v_current_mechanic
    order by public.c2_mechanic_fit(wm.mechanic_key,ws.expected_stimulus_json,ws.progression_intent) desc,wm.mechanic_key
  loop
    v_prepared:=public.c4_prepare_candidate(
      jsonb_set(jsonb_set(v_reduced,'{mechanic}',to_jsonb(m.mechanic_key),true),'{variant_key}','null'::jsonb,true),
      'c4-final-default'
    );
    v_final:=public.c4_finalize_candidate(v_prepared,ws.expected_stimulus_json,coalesce(ws.duration_minutes,45),v_wod_minutes,'c4-final-default','c3-sim-default');
    v_gate:=public.c4_candidate_quality_gate_v2(
      v_final,coalesce(ws.readiness,'normal'),coalesce(ws.focus,'General Fitness'),ws.target_region,
      coalesce(ws.injured_zones,'{}'::text[]),v_inventory,v_max_complexity,'c4-final-default'
    );
    if coalesce((v_final#>>'{c4_final,feasible}')::boolean,false) and coalesce((v_gate->>'pass')::boolean,false) then
      v_alt_mechanic:=m.mechanic_key;
      v_alt_final:=v_final;
      v_alt_gate:=v_gate;
      exit;
    end if;
  end loop;

  if v_alt_mechanic is null then
    return jsonb_build_object(
      'status','NO_STRUCTURAL_FALLBACK','mutated',false,'session_id',target.session_id,
      'session_exercise_id',p_session_exercise_id,'removed_exercise_id',target.exercise_id,
      'reason','NO_FEASIBLE_REBALANCED_WOD','version','structural-fallback-v1'
    );
  end if;

  if not p_confirm_structure_change then
    return jsonb_build_object(
      'status','STRUCTURAL_CHANGE_REQUIRED','mutated',false,'session_id',target.session_id,
      'session_exercise_id',p_session_exercise_id,'removed_exercise_id',target.exercise_id,
      'removed_pattern',target.movement_pattern,'old_mechanic',v_current_mechanic,'proposed_mechanic',v_alt_mechanic,
      'proposed_parameters',coalesce(v_alt_final#>'{c4_final,mechanic_json,parameters}','{}'::jsonb),
      'proposed_wod_minutes',coalesce(nullif(v_alt_final#>>'{c4_final,mechanic_json,wod_budget_minutes}','')::numeric,v_wod_minutes),
      'message','Sans ce mouvement, un autre format est plus cohérent pour conserver la qualité du WOD.',
      'requires_user_confirmation',true,'version','structural-fallback-v1'
    );
  end if;

  v_result:=public.c4_apply_wod_candidate(
    p_user_id,target.session_id,v_alt_final,v_alt_gate,'STRUCTURAL_FALLBACK_FORMAT:'||v_current_mechanic||'->'||v_alt_mechanic
  );
  if lower(coalesce(p_reason,'')) in ('equipment','environment') then
    v_intent:=public.record_uncovered_pattern_intent_v1(p_user_id,target.session_id,target.exercise_id,p_reason);
  end if;
  begin v_ledger:=public.d_sync_session_stimulus_ledger(target.session_id); exception when others then v_ledger:=jsonb_build_object('status','LEDGER_SYNC_SKIPPED'); end;

  update public.workout_sessions
  set planning_context_json=coalesce(planning_context_json,'{}'::jsonb)||jsonb_build_object(
    'last_structural_fallback',jsonb_build_object(
      'version','structural-fallback-v1','applied_at',now(),'removed_exercise_id',target.exercise_id,
      'reason',p_reason,'old_mechanic',v_current_mechanic,'new_mechanic',v_alt_mechanic,
      'mechanic_changed',true,'user_confirmed',true,'uncovered_pattern',target.movement_pattern
    )
  ),updated_at=now()
  where id=target.session_id and user_id=p_user_id;

  return jsonb_build_object(
    'status','STRUCTURAL_FALLBACK_APPLIED','mutated',true,'session_id',target.session_id,
    'removed_session_exercise_id',p_session_exercise_id,'removed_exercise_id',target.exercise_id,
    'removed_pattern',target.movement_pattern,'old_mechanic',v_current_mechanic,'new_mechanic',v_alt_mechanic,
    'mechanic_changed',true,'user_confirmed',true,'rebalanced',true,'result',v_result,
    'uncovered_pattern_intent',v_intent,'ledger_sync',v_ledger,'version','structural-fallback-v1'
  );
end;
$$;
