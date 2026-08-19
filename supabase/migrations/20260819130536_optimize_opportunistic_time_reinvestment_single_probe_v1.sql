do $$
declare
  v_def text;
  v_old text;
  v_new text;
begin
  select pg_get_functiondef('public.c4_reinvest_available_time_v1(uuid,jsonb,text,text,integer,text,text,text,text[],jsonb,integer,text,integer,text)'::regprocedure)
  into v_def;

  v_old := $old$  v_bonus_cap:=least(5,v_unallocated);
  for v_try in (v_base_target+1)..(v_base_target+v_bonus_cap) loop
    if v_intent='CLASSIC' then
      v_solver:=public.solve_session_engine_c4(
        p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
        p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty,p_candidate_count,v_try,p_policy_key
      );
    else
      v_solver:=public.solve_session_engine_c4_mechanic_policy_shadow_full_v1(
        p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
        p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty,p_candidate_count,v_try,p_policy_key
      );
    end if;
    if coalesce(v_solver->>'status','')<>'READY' or v_solver->'selected_candidate' is null then continue; end if;
    v_candidate:=v_solver->'selected_candidate';
    v_fit:=coalesce(nullif(v_candidate#>>'{c4_final,whole_wod_metrics,whole_wod_fit}','')::numeric,0);
    v_actual:=case
      when upper(coalesce(v_candidate->>'mechanic',''))='SETS_REPS' and nullif(v_candidate#>>'{c4_final,mechanic_json,predicted_elapsed_seconds}','') is not null
      then least(coalesce(nullif(v_candidate#>>'{c4_final,mechanic_json,wod_budget_minutes}','')::int,v_try),greatest(10,ceil(nullif(v_candidate#>>'{c4_final,mechanic_json,predicted_elapsed_seconds}','')::numeric/60.0)::int))
      else coalesce(nullif(v_candidate#>>'{c4_final,mechanic_json,wod_budget_minutes}','')::int,v_try)
    end;
    v_added:=v_actual-v_current_wod;
    if v_added<2 or v_added>v_bonus_cap then continue; end if;
    if v_fit<v_current_fit+v_quality_floor then continue; end if;
    if v_best_fit is null or v_fit>v_best_fit or (v_fit=v_best_fit and v_added<v_best_added) then
      v_best:=v_candidate; v_best_fit:=v_fit; v_best_actual:=v_actual; v_best_target:=v_try; v_best_added:=v_added;
    end if;
  end loop;$old$;

  v_new := $new$  v_bonus_cap:=least(5,v_unallocated);
  v_try:=v_base_target+v_bonus_cap;
  if v_intent='CLASSIC' then
    v_solver:=public.solve_session_engine_c4(
      p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
      p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty,p_candidate_count,v_try,p_policy_key
    );
  else
    v_solver:=public.solve_session_engine_c4_mechanic_policy_shadow_full_v1(
      p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
      p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty,p_candidate_count,v_try,p_policy_key
    );
  end if;

  if coalesce(v_solver->>'status','')='READY' and v_solver->'selected_candidate' is not null then
    v_candidate:=v_solver->'selected_candidate';
    v_fit:=coalesce(nullif(v_candidate#>>'{c4_final,whole_wod_metrics,whole_wod_fit}','')::numeric,0);
    v_actual:=case
      when upper(coalesce(v_candidate->>'mechanic',''))='SETS_REPS' and nullif(v_candidate#>>'{c4_final,mechanic_json,predicted_elapsed_seconds}','') is not null
      then least(coalesce(nullif(v_candidate#>>'{c4_final,mechanic_json,wod_budget_minutes}','')::int,v_try),greatest(10,ceil(nullif(v_candidate#>>'{c4_final,mechanic_json,predicted_elapsed_seconds}','')::numeric/60.0)::int))
      else coalesce(nullif(v_candidate#>>'{c4_final,mechanic_json,wod_budget_minutes}','')::int,v_try)
    end;
    v_added:=v_actual-v_current_wod;
    if v_added between 2 and v_bonus_cap and v_fit>=v_current_fit+v_quality_floor then
      v_best:=v_candidate;
      v_best_fit:=v_fit;
      v_best_actual:=v_actual;
      v_best_target:=v_try;
      v_best_added:=v_added;
    end if;
  end if;$new$;

  if position(v_old in v_def)=0 then
    raise exception 'Time reinvestment loop anchor not found';
  end if;

  execute replace(v_def,v_old,v_new);
end $$;