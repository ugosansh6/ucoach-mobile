create or replace function public.c4_compile_reduced_wod_for_mechanic_v1(
  p_user_id uuid,
  p_session_id uuid,
  p_candidate jsonb,
  p_new_mechanic text
) returns jsonb
language plpgsql
stable
security definer
set search_path='public'
as $$
declare
  ws public.workout_sessions%rowtype;
  v_mechanic text:=upper(trim(coalesce(p_new_mechanic,'')));
  v_names text[];
  v_inventory jsonb;
  v_exercises jsonb:='[]'::jsonb;
  v_ex jsonb;
  v_pres jsonb;
  v_base jsonb:=coalesce(p_candidate,'{}'::jsonb);
  v_expanded jsonb;
  v_prepared jsonb;
  v_final jsonb;
  v_gate jsonb;
  v_wod_min int;
  v_max_complexity int;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;
  select * into ws from public.workout_sessions where id=p_session_id and user_id=p_user_id;
  if not found then return jsonb_build_object('status','NOT_RECOMMENDED','reason','SESSION_NOT_FOUND'); end if;
  if not exists(select 1 from public.workout_mechanics where mechanic_key=v_mechanic and active and mechanic_kind='core') then
    return jsonb_build_object('status','NOT_RECOMMENDED','reason','UNKNOWN_OR_INACTIVE_CORE_MECHANIC');
  end if;
  if jsonb_array_length(coalesce(v_base->'exercises','[]'::jsonb))=0 then
    return jsonb_build_object('status','NOT_RECOMMENDED','reason','EMPTY_REDUCED_WOD');
  end if;

  v_names:=coalesce(ws.available_equipment,'{}'::text[]);
  if cardinality(v_names)=0 then v_names:=array['Aucun']; end if;
  v_inventory:=public.resolve_user_equipment_inventory(p_user_id,v_names,'c4-final-default');
  v_max_complexity:=public.c4_user_max_swap_complexity(p_user_id,ws.readiness);

  for v_ex in select value from jsonb_array_elements(v_base->'exercises') loop
    v_pres:=public.c2_solver_prescription(
      p_user_id,v_ex->>'exercise_id',ws.expected_stimulus_json,v_mechanic,ws.progression_intent,v_inventory
    );
    v_exercises:=v_exercises||jsonb_build_array(jsonb_set(v_ex,'{prescription}',v_pres,true));
  end loop;

  v_base:=jsonb_set(v_base,'{exercises}',v_exercises,true);
  v_base:=jsonb_set(v_base,'{mechanic}',to_jsonb(v_mechanic),true);
  v_base:=v_base-'variant_key';
  v_base:=jsonb_set(v_base,'{overlays}','[]'::jsonb,true);

  v_expanded:=public.c4_expand_candidate_to_block_rules(
    v_base,p_user_id,coalesce(ws.focus,'General Fitness'),coalesce(ws.duration_minutes,45),coalesce(ws.readiness,'normal'),
    ws.target_region,ws.progression_intent,coalesce(ws.injured_zones,'{}'::text[]),v_inventory,v_max_complexity,'Avancé'
  );
  v_prepared:=public.c4_prepare_candidate(v_expanded,'c4-final-default');
  v_wod_min:=coalesce(
    nullif(ws.mechanic_json->>'wod_budget_minutes','')::int,
    nullif(ws.planning_context_json#>>'{architecture,wod_minutes}','')::int,
    (select nullif(b->>'duration_minutes','')::int from jsonb_array_elements(coalesce(ws.generated_workout->'blocks','[]'::jsonb)) b where b->>'block_key'='wod' limit 1),
    10
  );
  v_final:=public.c4_finalize_candidate(
    v_prepared,ws.expected_stimulus_json,coalesce(ws.duration_minutes,45),v_wod_min,'c4-final-default','c3-sim-default'
  );
  v_gate:=public.c4_candidate_quality_gate_v2(
    v_final,coalesce(ws.readiness,'normal'),coalesce(ws.focus,'General Fitness'),ws.target_region,
    coalesce(ws.injured_zones,'{}'::text[]),v_inventory,v_max_complexity,'c4-final-default'
  );

  if coalesce((v_final#>>'{c4_final,feasible}')::boolean,false)=false or coalesce((v_gate->>'pass')::boolean,false)=false then
    return jsonb_build_object(
      'status','NOT_RECOMMENDED','mechanic',v_mechanic,'reason_codes',
      coalesce(v_final#>'{c4_final,reasons}','[]'::jsonb)||coalesce(v_gate->'hard_gate_reasons','[]'::jsonb),
      'candidate',v_final,'quality_gate',v_gate
    );
  end if;

  return jsonb_build_object(
    'status','AVAILABLE','mechanic',v_mechanic,'candidate',v_final,'quality_gate',v_gate,
    'mechanic_json',coalesce(v_final#>'{c4_final,mechanic_json}','{}'::jsonb),
    'compiler','c4-reduced-wod-mechanic-v1'
  );
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
  v_alt_preview jsonb:=null;
  v_result jsonb;
  v_intent jsonb:='{}'::jsonb;
  v_ledger jsonb:='{}'::jsonb;
  v_pending jsonb:='{}'::jsonb;
  v_pending_confirmed boolean:=false;
  v_detached_id uuid:=null;
  v_prompt text;
  v_alt_duration numeric:=null;
  m record;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;

  select wse.*,e.movement_pattern,e.exercise_family into target
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
    update public.workout_sessions set planning_context_json=(coalesce(planning_context_json,'{}'::jsonb)-'pending_structural_fallback')||jsonb_build_object('last_structural_fallback',jsonb_build_object('version','structural-fallback-v1.2','applied_at',now(),'removed_exercise_id',target.exercise_id,'reason',p_reason,'old_mechanic',v_current_mechanic,'new_mechanic',v_current_mechanic,'mechanic_changed',false,'uncovered_pattern',target.movement_pattern)),updated_at=now() where id=target.session_id and user_id=p_user_id;
    return jsonb_build_object('status','STRUCTURAL_FALLBACK_APPLIED','mutated',true,'session_id',target.session_id,'removed_session_exercise_id',p_session_exercise_id,'removed_exercise_id',target.exercise_id,'removed_pattern',target.movement_pattern,'old_mechanic',v_current_mechanic,'new_mechanic',v_current_mechanic,'mechanic_changed',false,'rebalanced',true,'detached_recompiled_instance_id',v_detached_id,'result',v_result,'uncovered_pattern_intent',v_intent,'ledger_sync',v_ledger,'version','structural-fallback-v1.2');
  end if;

  for m in
    select wm.mechanic_key,public.c2_mechanic_fit(wm.mechanic_key,ws.expected_stimulus_json,ws.progression_intent) fit
    from public.workout_mechanics wm
    where wm.active and wm.mechanic_kind='core' and wm.mechanic_key<>v_current_mechanic
    order by public.c2_mechanic_fit(wm.mechanic_key,ws.expected_stimulus_json,ws.progression_intent) desc,wm.mechanic_key
  loop
    v_alt_preview:=public.c4_compile_reduced_wod_for_mechanic_v1(p_user_id,target.session_id,v_reduced,m.mechanic_key);
    if v_alt_preview->>'status'='AVAILABLE' then
      v_alt_mechanic:=m.mechanic_key;
      v_alt_final:=v_alt_preview->'candidate';
      v_alt_gate:=v_alt_preview->'quality_gate';
      exit;
    end if;
  end loop;

  if v_alt_mechanic is null then return jsonb_build_object('status','NO_STRUCTURAL_FALLBACK','mutated',false,'session_id',target.session_id,'session_exercise_id',p_session_exercise_id,'removed_exercise_id',target.exercise_id,'reason','NO_FEASIBLE_REBALANCED_WOD','version','structural-fallback-v1.2'); end if;

  v_alt_duration:=coalesce(nullif(v_alt_final#>>'{c4_final,mechanic_json,parameters,duration_minutes}','')::numeric,nullif(v_alt_final#>>'{c4_final,mechanic_json,wod_budget_minutes}','')::numeric,v_wod_minutes);

  if not v_pending_confirmed then
    v_prompt:='Sans ce mouvement, UGEROD propose '||replace(v_alt_mechanic,'_',' ')||case when v_alt_duration is not null then ' · '||trim(to_char(v_alt_duration,'FM999990.##'))||' min' else '' end||'. Appuie à nouveau sur le même choix pour confirmer.';
    update public.workout_sessions set planning_context_json=coalesce(planning_context_json,'{}'::jsonb)||jsonb_build_object('pending_structural_fallback',jsonb_build_object('version','structural-fallback-v1.2','requested_at',now(),'session_exercise_id',p_session_exercise_id,'exercise_id',target.exercise_id,'reason',p_reason,'old_mechanic',v_current_mechanic,'proposed_mechanic',v_alt_mechanic,'proposed_parameters',coalesce(v_alt_final#>'{c4_final,mechanic_json,parameters}','{}'::jsonb))),updated_at=now() where id=target.session_id and user_id=p_user_id;
    return jsonb_build_object('status','STRUCTURAL_CHANGE_REQUIRED','mutated',false,'session_id',target.session_id,'session_exercise_id',p_session_exercise_id,'removed_exercise_id',target.exercise_id,'removed_pattern',target.movement_pattern,'old_mechanic',v_current_mechanic,'proposed_mechanic',v_alt_mechanic,'proposed_parameters',coalesce(v_alt_final#>'{c4_final,mechanic_json,parameters}','{}'::jsonb),'message',v_prompt,'requires_user_confirmation',true,'confirmation_mode','repeat_same_reason_within_5_minutes','version','structural-fallback-v1.2');
  end if;

  v_result:=public.c4_apply_wod_candidate(p_user_id,target.session_id,v_alt_final,v_alt_gate,'STRUCTURAL_FALLBACK_FORMAT:'||v_current_mechanic||'->'||v_alt_mechanic);
  v_detached_id:=public.c4_detach_recompiled_wod_instance_v1(p_user_id,target.session_id,p_session_exercise_id);
  if lower(coalesce(p_reason,'')) in ('equipment','environment') then v_intent:=public.record_uncovered_pattern_intent_v1(p_user_id,target.session_id,target.exercise_id,p_reason); end if;
  begin v_ledger:=public.d_sync_session_stimulus_ledger(target.session_id); exception when others then v_ledger:=jsonb_build_object('status','LEDGER_SYNC_SKIPPED'); end;
  update public.workout_sessions set planning_context_json=(coalesce(planning_context_json,'{}'::jsonb)-'pending_structural_fallback')||jsonb_build_object('last_structural_fallback',jsonb_build_object('version','structural-fallback-v1.2','applied_at',now(),'removed_exercise_id',target.exercise_id,'reason',p_reason,'old_mechanic',v_current_mechanic,'new_mechanic',v_alt_mechanic,'mechanic_changed',true,'user_confirmed',true,'uncovered_pattern',target.movement_pattern)),updated_at=now() where id=target.session_id and user_id=p_user_id;
  return jsonb_build_object('status','STRUCTURAL_FALLBACK_APPLIED','mutated',true,'session_id',target.session_id,'removed_session_exercise_id',p_session_exercise_id,'removed_exercise_id',target.exercise_id,'removed_pattern',target.movement_pattern,'old_mechanic',v_current_mechanic,'new_mechanic',v_alt_mechanic,'mechanic_changed',true,'user_confirmed',true,'rebalanced',true,'detached_recompiled_instance_id',v_detached_id,'result',v_result,'uncovered_pattern_intent',v_intent,'ledger_sync',v_ledger,'version','structural-fallback-v1.2');
end;
$$;
