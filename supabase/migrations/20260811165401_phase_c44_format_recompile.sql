-- C4.4c — format change re-enters the SAME compiler and quality gates.
create or replace function public.c4_recompile_session_format(
  p_user_id uuid,
  p_session_id uuid,
  p_new_mechanic text,
  p_variant_key text default null,
  p_overlays jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  ws record;
  v_mechanic text:=upper(trim(coalesce(p_new_mechanic,'')));
  v_variant text:=upper(trim(coalesce(p_variant_key,'')));
  v_names text[];
  v_inventory jsonb;
  v_base jsonb;v_exercises jsonb:='[]'::jsonb;v_ex jsonb;v_pres jsonb;
  v_expanded jsonb;v_prepared jsonb;v_final jsonb;v_gate jsonb;v_red jsonb;v_quality jsonb;
  v_original_count int;v_final_count int;v_wod_min int;v_class text;
  v_max_complexity int;
  v_result jsonb;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;
  select * into ws from public.workout_sessions where id=p_session_id and user_id=p_user_id for update;
  if not found then raise exception 'Session not found'; end if;
  if ws.status not in ('generated','in_progress') then raise exception 'Session cannot change format in status %',ws.status; end if;

  if not exists(select 1 from public.workout_mechanics wm where wm.mechanic_key=v_mechanic and wm.active and wm.mechanic_kind='core') then
    return jsonb_build_object('status','NOT_RECOMMENDED','classification','NOT_RECOMMENDED','reason','UNKNOWN_OR_INACTIVE_CORE_MECHANIC','mutated',false);
  end if;
  if jsonb_typeof(coalesce(p_overlays,'[]'::jsonb))<>'array' then
    return jsonb_build_object('status','NOT_RECOMMENDED','classification','NOT_RECOMMENDED','reason','OVERLAYS_MUST_BE_ARRAY','mutated',false);
  end if;
  if exists(select 1 from jsonb_array_elements(coalesce(p_overlays,'[]'::jsonb)) o where upper(coalesce(o->>'type','')) not in ('BUY_IN','CASH_OUT','BUY_IN_CASH_OUT','PENALTY')) then
    return jsonb_build_object('status','NOT_RECOMMENDED','classification','NOT_RECOMMENDED','reason','UNSUPPORTED_OVERLAY','mutated',false);
  end if;

  v_names:=coalesce(ws.available_equipment,'{}'::text[]);
  if cardinality(v_names)=0 then
    select coalesce(array_agg(e.name order by e.id),'{}'::text[]) into v_names
    from public.user_equipment_inventory ui join public.equipment e on e.id=ui.equipment_id
    where ui.user_id=p_user_id and ui.active;
  end if;
  if cardinality(v_names)=0 then v_names:=array['Aucun']; end if;
  v_inventory:=public.resolve_user_equipment_inventory(p_user_id,v_names,'c4-final-default');

  v_base:=public.c4_session_wod_candidate(p_session_id);
  if v_base is null or jsonb_array_length(coalesce(v_base->'exercises','[]'::jsonb))=0 then raise exception 'Session has no WOD'; end if;
  v_original_count:=jsonb_array_length(v_base->'exercises');
  v_max_complexity:=case lower(coalesce(ws.readiness,'normal')) when 'low' then 3 else 5 end;

  -- Rebuild every existing prescription for the new mechanic; no second conversion engine.
  for v_ex in select value from jsonb_array_elements(v_base->'exercises')
  loop
    v_pres:=public.c2_solver_prescription(p_user_id,v_ex->>'exercise_id',ws.expected_stimulus_json,v_mechanic,ws.progression_intent,v_inventory);
    v_exercises:=v_exercises||jsonb_build_array(jsonb_set(v_ex,'{prescription}',v_pres,true));
  end loop;
  v_base:=jsonb_set(v_base,'{exercises}',v_exercises,true);
  v_base:=jsonb_set(v_base,'{mechanic}',to_jsonb(v_mechanic),true);
  if v_variant<>'' then v_base:=jsonb_set(v_base,'{variant_key}',to_jsonb(v_variant),true); else v_base:=v_base-'variant_key'; end if;
  v_base:=jsonb_set(v_base,'{overlays}',coalesce(p_overlays,'[]'::jsonb),true);

  v_expanded:=public.c4_expand_candidate_to_block_rules(
    v_base,p_user_id,coalesce(ws.focus,'General Fitness'),coalesce(ws.duration_minutes,45),coalesce(ws.readiness,'normal'),ws.target_region,ws.progression_intent,
    coalesce(ws.injured_zones,'{}'::text[]),v_inventory,v_max_complexity,'Avancé'
  );
  v_prepared:=public.c4_prepare_candidate(v_expanded,'c4-final-default');
  v_wod_min:=coalesce(nullif(ws.mechanic_json->>'wod_budget_minutes','')::int,nullif(ws.planning_context_json#>>'{architecture,wod_minutes}','')::int,
    (select nullif(b->>'duration_minutes','')::int from jsonb_array_elements(coalesce(ws.generated_workout->'blocks','[]'::jsonb)) b where b->>'block_key'='wod' limit 1),10);
  v_final:=public.c4_finalize_candidate(v_prepared,ws.expected_stimulus_json,coalesce(ws.duration_minutes,45),v_wod_min,'c4-final-default','c3-sim-default');
  v_gate:=public.c4_candidate_quality_gate_v2(v_final,coalesce(ws.readiness,'normal'),coalesce(ws.focus,'General Fitness'),ws.target_region,coalesce(ws.injured_zones,'{}'::text[]),v_inventory,v_max_complexity,'c4-final-default');
  v_red:=public.c4_redundancy_score(p_user_id,v_final,'c4-final-default');
  v_final_count:=jsonb_array_length(coalesce(v_final->'exercises','[]'::jsonb));

  if coalesce((v_final#>>'{c4_final,feasible}')::boolean,false)=false or coalesce((v_gate->>'pass')::boolean,false)=false then
    return jsonb_build_object('status','NOT_RECOMMENDED','classification','NOT_RECOMMENDED','mutated',false,'mechanic',v_mechanic,'variant_key',nullif(v_variant,''),
      'quality_gate',v_gate,'final_status',v_final#>>'{c4_final,status}','reasons',v_final#>'{c4_final,reasons}');
  end if;

  v_class:=case when v_final_count=v_original_count then 'COMPATIBLE' else 'ADAPTABLE' end;
  v_quality:=v_gate||jsonb_build_object('anti_redundancy',v_red,'format_change_classification',v_class,'format_change_uses_same_compiler',true);
  v_result:=public.c4_apply_wod_candidate(p_user_id,p_session_id,v_final,v_quality,'FORMAT_CHANGE:'||v_mechanic||case when v_variant<>'' then ':'||v_variant else '' end);
  return jsonb_build_object('status','APPLIED','classification',v_class,'mutated',true,'mechanic',v_mechanic,'variant_key',nullif(v_variant,''),
    'original_exercise_count',v_original_count,'final_exercise_count',v_final_count,'quality_gate',v_quality,'result',v_result);
end;
$$;

revoke all on function public.c4_recompile_session_format(uuid,uuid,text,text,jsonb) from public;
grant execute on function public.c4_recompile_session_format(uuid,uuid,text,text,jsonb) to authenticated;
;
