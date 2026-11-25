-- C4.4d — exact session_exercise_id swap; complete WOD is re-simulated before persistence.
create or replace function public.c4_swap_session_exercise(
  p_user_id uuid,
  p_session_exercise_id uuid,
  p_excluded_exercise_ids text[] default '{}'::text[]
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  target record;
  ws record;
  v_names text[];
  v_inventory jsonb;
  v_base jsonb;v_candidate jsonb;v_exercises jsonb;v_final jsonb;v_prepared jsonb;v_gate jsonb;v_red jsonb;v_quality jsonb;
  v_best jsonb:=null;v_best_gate jsonb:=null;v_best_red jsonb:=null;v_best_score numeric:=-1e9;
  v_score numeric;v_same_pattern numeric;v_same_family numeric;v_wod_min int;v_max_complexity int;
  r record;v_pres jsonb;v_new_ex jsonb;v_result jsonb;v_new_id text:=null;v_tested int:=0;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;

  select wse.*,e.movement_pattern old_pattern,e.exercise_family old_family
  into target
  from public.workout_session_exercises wse
  join public.workout_sessions s on s.id=wse.session_id
  join public.exercises e on e.id=wse.exercise_id
  where wse.id=p_session_exercise_id and s.user_id=p_user_id;
  if not found then raise exception 'Session exercise instance not found'; end if;
  if target.block_key<>'wod' then
    return jsonb_build_object('status','NOT_SUPPORTED','reason','C4_SWAP_REQUIRES_WOD_INSTANCE','session_exercise_id',p_session_exercise_id,'mutated',false);
  end if;

  select * into ws from public.workout_sessions where id=target.session_id and user_id=p_user_id for update;
  if ws.status not in ('generated','in_progress') then raise exception 'Session cannot swap in status %',ws.status; end if;

  v_names:=coalesce(ws.available_equipment,'{}'::text[]);
  if cardinality(v_names)=0 then
    select coalesce(array_agg(e.name order by e.id),'{}'::text[]) into v_names
    from public.user_equipment_inventory ui join public.equipment e on e.id=ui.equipment_id
    where ui.user_id=p_user_id and ui.active;
  end if;
  if cardinality(v_names)=0 then v_names:=array['Aucun']; end if;
  v_inventory:=public.resolve_user_equipment_inventory(p_user_id,v_names,'c4-final-default');
  v_base:=public.c4_session_wod_candidate(target.session_id);
  v_wod_min:=coalesce(nullif(ws.mechanic_json->>'wod_budget_minutes','')::int,nullif(ws.planning_context_json#>>'{architecture,wod_minutes}','')::int,
    (select nullif(b->>'duration_minutes','')::int from jsonb_array_elements(coalesce(ws.generated_workout->'blocks','[]'::jsonb)) b where b->>'block_key'='wod' limit 1),10);
  v_max_complexity:=case lower(coalesce(ws.readiness,'normal')) when 'low' then 3 else 5 end;

  for r in
    select cp.*
    from public.c2_candidate_pool(
      p_user_id,coalesce(ws.focus,'General Fitness'),coalesce(ws.duration_minutes,45),coalesce(ws.readiness,'normal'),ws.target_region,ws.progression_intent,
      coalesce(ws.injured_zones,'{}'::text[]),v_inventory,'WOD',v_max_complexity,'Avancé',60
    ) cp
    where cp.exercise_id<>target.exercise_id
      and not (cp.exercise_id=any(coalesce(p_excluded_exercise_ids,'{}'::text[])))
      and not exists(select 1 from jsonb_array_elements(v_base->'exercises') x where x->>'exercise_id'=cp.exercise_id)
    order by
      case when cp.movement_pattern=target.old_pattern then 0 when cp.exercise_family=target.old_family then 1 else 2 end,
      cp.candidate_score desc,cp.exercise_id
  loop
    v_tested:=v_tested+1;
    exit when v_tested>25;
    v_pres:=public.c2_solver_prescription(p_user_id,r.exercise_id,ws.expected_stimulus_json,v_base->>'mechanic',ws.progression_intent,v_inventory);
    v_new_ex:=jsonb_build_object('exercise_id',r.exercise_id,'name',r.exercise_name,'pattern',r.movement_pattern,'family',r.exercise_family,
      'candidate_score',r.candidate_score,'components',r.score_components,'prescription',v_pres);

    select coalesce(jsonb_agg(case when ord=target.position then v_new_ex else value end order by ord),'[]'::jsonb)
    into v_exercises
    from jsonb_array_elements(v_base->'exercises') with ordinality x(value,ord);

    v_candidate:=jsonb_set(v_base,'{exercises}',v_exercises,true);
    v_prepared:=public.c4_prepare_candidate(v_candidate,'c4-final-default');
    v_final:=public.c4_finalize_candidate(v_prepared,ws.expected_stimulus_json,coalesce(ws.duration_minutes,45),v_wod_min,'c4-final-default','c3-sim-default');
    v_gate:=public.c4_candidate_quality_gate_v2(v_final,coalesce(ws.readiness,'normal'),coalesce(ws.focus,'General Fitness'),ws.target_region,
      coalesce(ws.injured_zones,'{}'::text[]),v_inventory,v_max_complexity,'c4-final-default');
    if coalesce((v_gate->>'pass')::boolean,false)=false or coalesce((v_final#>>'{c4_final,feasible}')::boolean,false)=false then continue; end if;

    v_red:=public.c4_redundancy_score(p_user_id,v_final,'c4-final-default');
    v_same_pattern:=case when r.movement_pattern=target.old_pattern then 10 else 0 end;
    v_same_family:=case when r.exercise_family=target.old_family then 5 else 0 end;
    v_score:=coalesce(r.candidate_score,0)*0.40+coalesce((v_final#>>'{c4_final,whole_wod_metrics,whole_wod_fit}')::numeric,0)*0.40+
      coalesce((v_red->>'score')::numeric,0)*0.20+v_same_pattern+v_same_family;

    if v_score>v_best_score then
      v_best_score:=v_score;v_best:=v_final;v_best_gate:=v_gate;v_best_red:=v_red;v_new_id:=r.exercise_id;
    end if;
  end loop;

  if v_best is null then
    return jsonb_build_object('status','NO_SAFE_SWAP','mutated',false,'session_exercise_id',p_session_exercise_id,'old_exercise_id',target.exercise_id,'candidates_tested',v_tested);
  end if;

  v_quality:=v_best_gate||jsonb_build_object('anti_redundancy',v_best_red,'swap_full_wod_resimulated',true,'swap_score',round(v_best_score,2),'target_session_exercise_id',p_session_exercise_id);
  v_result:=public.c4_apply_wod_candidate(p_user_id,target.session_id,v_best,v_quality,'SWAP_INSTANCE:'||p_session_exercise_id::text);

  return jsonb_build_object(
    'status','APPLIED','mutated',true,'session_id',target.session_id,'session_exercise_id',p_session_exercise_id,
    'position',target.position,'old_exercise_id',target.exercise_id,'new_exercise_id',v_new_id,'candidates_tested',v_tested,
    'full_wod_resimulated',true,'quality_gate',v_quality,'result',v_result
  );
end;
$$;

revoke all on function public.c4_swap_session_exercise(uuid,uuid,text[]) from public;
grant execute on function public.c4_swap_session_exercise(uuid,uuid,text[]) to authenticated;
;
