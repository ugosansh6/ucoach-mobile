-- Environment-aware shared authority: C4 standard outside GYM, Gym real-time duration band in GYM.
-- Composer shares the real C2/C3/C4 strength prescription and the
-- common UGEROD elapsed-time engine. No client-side set-count formula.
-- Read-only. Does not write sessions or override the user's chosen exercises.
create or replace function public.week_composer_strength_authority_v2(
  p_user_id uuid,
  p_exercises jsonb,
  p_session_minutes integer,
  p_block_minutes integer,
  p_progression_intent text default 'MAINTAIN',
  p_equipment_names text[] default '{}'::text[],
  p_focus text default 'Strength',
  p_target_region text default null,
  p_readiness text default 'normal',
  p_environment_code text default 'BOX'
) returns jsonb language plpgsql stable security definer
set search_path = public,pg_temp as $$
declare
 v_inventory jsonb;
 v_stimulus jsonb;
 v_candidate jsonb;
 v_final jsonb;
 v_estimate jsonb;
 v_ex jsonb;
 v_solver jsonb;
 v_exercises jsonb:='[]'::jsonb;
 v_results jsonb:='[]'::jsonb;
 v_params jsonb;
 v_id text;
 v_seen text[]:='{}'::text[];
 v_reps int;
 v_sets int;
 v_rest int;
 v_active numeric;
 v_total numeric;
 v_budget numeric;
 v_util numeric;
 v_band_min numeric;
 v_band_max numeric;
 v_c4_status text;
 v_status text;
begin
 if auth.uid() is null or auth.uid()<>p_user_id then
   raise exception 'FORBIDDEN_STRENGTH_AUTHORITY' using errcode='42501';
 end if;
 if p_session_minutes not between 20 and 90
    or p_block_minutes not between 2 and 90
    or p_block_minutes > p_session_minutes
    or upper(coalesce(p_environment_code,'')) not in ('HOME','BOX','GYM','OUTDOOR')
    or jsonb_typeof(p_exercises) <> 'array'
    or jsonb_array_length(p_exercises) not between 1 and 8 then
   raise exception 'INVALID_STRENGTH_BLOCK';
 end if;
 v_inventory:=public.resolve_user_equipment_inventory(p_user_id,coalesce(p_equipment_names,'{}'::text[]),'c4-final-default');
 v_stimulus:=public.build_session_stimulus_target(
   coalesce(nullif(p_focus,''),'Strength'),p_session_minutes,
   coalesce(nullif(p_readiness,''),'normal'),p_target_region,
   coalesce(nullif(p_progression_intent,''),'MAINTAIN'),'c1-default'
 );
 for v_ex in select value from jsonb_array_elements(p_exercises) loop
   v_id:=coalesce(nullif(v_ex->>'id',''),nullif(v_ex->>'exercise_id',''));
   if v_id is null or v_id=any(v_seen) or not exists(select 1 from public.exercises where id=v_id) then
     raise exception 'INVALID_STRENGTH_EXERCISE';
   end if;
   v_seen:=array_append(v_seen,v_id);
   v_solver:=public.c2_solver_prescription(p_user_id,v_id,v_stimulus,'STRENGTH',p_progression_intent,v_inventory);
   if jsonb_typeof(v_solver)<>'object' then
     raise exception 'C2_PRESCRIPTION_UNAVAILABLE';
   end if;
   v_exercises:=v_exercises||jsonb_build_array(jsonb_build_object(
     'exercise_id',v_id,
     'name',coalesce(v_ex->>'name',(select name from public.exercises where id=v_id)),
     'prescription',v_solver
   ));
 end loop;
 v_candidate:=jsonb_build_object('mechanic','SETS_REPS','exercises',v_exercises);
 -- Standard C4 sets/rounds/rest calculation, not an independent Composer rule.
 v_final:=public.c4_finalize_sets_reps_candidate(
   v_candidate,v_stimulus,p_session_minutes,p_block_minutes,
   'c4-final-default','c3-sim-default'
 );
 v_params:=coalesce(v_final#>'{c4_final,mechanic_json,parameters}','{}'::jsonb);
 v_c4_status:=coalesce(v_final#>>'{c4_final,mechanic_json,duration_status}','UNKNOWN');
 v_sets:=nullif(v_params->>'sets','')::int;
 v_rest:=nullif(v_params->>'rest_between_exercises_seconds','')::int;
 -- Uses gym's existing standard adapter to the UGEROD common elapsed engine.
 -- NOTE: estimated_total_seconds is MAX(budget, prescribed time) and hides
 -- underfill; use the *actual component total* instead.
 v_estimate:=public.gym_estimate_real_elapsed_time_v1(v_final,p_block_minutes);
 v_active:=coalesce((v_estimate->>'active_seconds')::numeric,0);
 v_total:=v_active
   +coalesce((v_estimate->>'rest_seconds')::numeric,0)
   +coalesce((v_estimate->>'setup_seconds')::numeric,0)
   +coalesce((v_estimate->>'transition_seconds')::numeric,0)
   +coalesce((v_estimate->>'load_adjustment_seconds')::numeric,0);
 v_budget:=p_block_minutes*60;
 v_util:=round(100*v_total/greatest(1,v_budget),2);
 v_band_min:=coalesce((v_estimate#>>'{target_band_percent,0}')::numeric,82);
 v_band_max:=coalesce((v_estimate#>>'{target_band_percent,1}')::numeric,108);
 v_status:=case
   when coalesce((v_final#>>'{c4_final,feasible}')::boolean,false)=false then 'UNFEASIBLE'
   when v_c4_status='UNDERFILLED' then 'UNDERFILLED'
   when v_c4_status='OVERFILLED' then 'OVERFILLED'
   when upper(p_environment_code)='GYM' and v_util<v_band_min then 'UNDERFILLED'
   when upper(p_environment_code)='GYM' and v_util>v_band_max then 'OVERFILLED'
   else 'READY'
 end;
 for v_ex in select value from jsonb_array_elements(v_final->'exercises') loop
   v_solver:=v_ex->'prescription';
   v_reps:=coalesce(nullif(v_solver->>'reps_min','')::int,nullif(v_solver->>'reps_max','')::int);
   v_results:=v_results||jsonb_build_array(jsonb_build_object(
     'id',v_ex->>'exercise_id','name',v_ex->>'name',
     'sets',v_sets,'rest_seconds',v_rest,'reps',v_reps,
     'reps_semantics',v_solver->>'reps_semantics',
     'duration_seconds',v_solver->'duration_seconds_min',
     'distance_meters',v_solver->'distance_meters_min',
     'load_kg',v_solver->'load_kg','load_scope',v_solver->'load_scope',
     'band_resistance_label',v_solver->'band_resistance_label',
     'target_rpe_min',v_solver->'target_rpe_min',
     'target_rpe_max',v_solver->'target_rpe_max',
     'solver_version',v_solver->'solver_version',
     'solver_reference',v_solver
   ));
 end loop;
 return jsonb_build_object(
   'version','composer-shared-authority-v1',
   'source','C2+C3+C4+UGEROD_TIME_ENGINE',
   'environment_code',upper(p_environment_code),
   'duration_contract',case when upper(p_environment_code)='GYM' then 'GYM_STANDARD_REAL_ELAPSED' else 'C4_STANDARD_DURATION' end,
   'status',v_status,
   'block_type','STRENGTH',
   'minutes',p_block_minutes,
   'exercise_count',jsonb_array_length(p_exercises),
   'exercises',v_results,
   'sets',v_sets,'rest_seconds',v_rest,
   'c4_duration_status',v_c4_status,
   'time',jsonb_build_object(
     'budget_seconds',v_budget,
     'prescribed_seconds',round(v_total,2),
     'utilization_percent',v_util,
     'target_band_percent',v_estimate->'target_band_percent',
     'duration_is_maximum_not_fill_target',true,
     'components',jsonb_build_object(
       'active',v_active,'rest',v_estimate->'rest_seconds',
       'setup',v_estimate->'setup_seconds',
       'transitions',v_estimate->'transition_seconds',
       'load_adjustment',v_estimate->'load_adjustment_seconds'
     )
   )
 );
end;
$$;
revoke all on function public.week_composer_strength_authority_v2(
 uuid,jsonb,integer,integer,text,text[],text,text,text,text) from public,anon;
grant execute on function public.week_composer_strength_authority_v2(
 uuid,jsonb,integer,integer,text,text[],text,text,text,text) to authenticated,service_role;

-- Rank is provided by the existing Composer/C2 selection policy.
-- C4 and the common elapsed engine determine the *number*, not UI caps.
create or replace function public.week_composer_strength_autopick_v2(
  p_user_id uuid,
  p_candidate_exercises jsonb,
  p_session_minutes integer,
  p_block_minutes integer,
  p_progression_intent text default 'MAINTAIN',
  p_equipment_names text[] default '{}'::text[],
  p_focus text default 'Strength',
  p_target_region text default null,
  p_environment_code text default 'BOX'
) returns jsonb language plpgsql stable security definer
set search_path = public,pg_temp as $$
declare
 v_count int;
 v_prefix jsonb;
 v_plan jsonb;
 v_best jsonb;
 v_best_distance numeric:=1e9;
 v_util numeric;
 v_status text;
 v_n int;
begin
 if auth.uid() is null or auth.uid()<>p_user_id then
   raise exception 'FORBIDDEN_STRENGTH_AUTOPICK' using errcode='42501';
 end if;
 if jsonb_typeof(p_candidate_exercises)<>'array'
    or jsonb_array_length(p_candidate_exercises) not between 1 and 8 then
   raise exception 'INVALID_AUTOPICK_CANDIDATES';
 end if;
 v_count:=jsonb_array_length(p_candidate_exercises);
 for v_n in 1..v_count loop
   select jsonb_agg(value order by ord) into v_prefix
   from jsonb_array_elements(p_candidate_exercises) with ordinality t(value,ord)
   where ord<=v_n;
   v_plan:=public.week_composer_strength_authority_v2(
     p_user_id,v_prefix,p_session_minutes,p_block_minutes,
     p_progression_intent,p_equipment_names,p_focus,p_target_region,'normal',p_environment_code
   );
   v_status:=v_plan->>'status';
   v_util:=coalesce((v_plan#>>'{time,utilization_percent}')::numeric,0);
   if v_best is null or (
     (v_status='READY' and v_best->>'status'<>'READY')
     or (v_status='READY' and v_best->>'status'='READY' and abs(100-v_util)<v_best_distance)
     or (v_best->>'status'<>'READY' and v_util>coalesce((v_best#>>'{time,utilization_percent}')::numeric,0)
         and v_status<>'OVERFILLED')
   ) then
     v_best:=v_plan||jsonb_build_object('selected_exercises',v_prefix);
     v_best_distance:=abs(100-v_util);
   end if;
 end loop;
 return v_best||jsonb_build_object('selection_authority','C2+C4+UGEROD_TIME_ENGINE','catalogue_count',v_count);
end;
$$;
revoke all on function public.week_composer_strength_autopick_v2(
 uuid,jsonb,integer,integer,text,text[],text,text,text) from public,anon;
grant execute on function public.week_composer_strength_autopick_v2(
 uuid,jsonb,integer,integer,text,text[],text,text,text) to authenticated,service_role;
