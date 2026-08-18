

-- SOURCE MIGRATION: 20260812083208_pi6_align_progression_snapshot_with_observation_time.sql
do $$
declare
  v_def text;
begin
  select pg_get_functiondef(p.oid)
  into v_def
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname='pi_progression_snapshot';

  if v_def is null then raise exception 'pi_progression_snapshot not found'; end if;

  -- Overall exercise-capability event counts: use the date of the sporting
  -- observation, not the later technical processing time.
  v_def:=replace(v_def,
$old$  from public.capability_update_events
  where user_id=p_user_id and applied
    and created_at::date between v_since and v_anchor;$old$,
$new$  from public.capability_update_events cue
  left join public.exercise_logs el on el.id=cue.exercise_log_id
  where cue.user_id=p_user_id and cue.applied
    and coalesce(el.created_at,cue.created_at)::date between v_since and v_anchor;$new$);

  -- Load-frontier expansion is a positive progression signal too.
  v_def:=replace(v_def,
    'count(*) filter(where decision ilike ''EXPAND%'' or decision ilike ''%PROGRESS%'')',
    'count(*) filter(where decision ilike ''EXPAND%'' or decision ilike ''%PROGRESS%'' or decision=''ADD_FRONTIER_POINT'')'
  );
  v_def:=replace(v_def,
    'count(*) filter(where cue.decision ilike ''EXPAND%'' or cue.decision ilike ''%PROGRESS%'')::int',
    'count(*) filter(where cue.decision ilike ''EXPAND%'' or cue.decision ilike ''%PROGRESS%'' or cue.decision=''ADD_FRONTIER_POINT'')::int'
  );
  v_def:=replace(v_def,
    'coalesce(ld.latest_decision,'''') ilike ''EXPAND%'' or coalesce(ld.latest_decision,'''') ilike ''%PROGRESS%''',
    'coalesce(ld.latest_decision,'''') ilike ''EXPAND%'' or coalesce(ld.latest_decision,'''') ilike ''%PROGRESS%'' or coalesce(ld.latest_decision,'''')=''ADD_FRONTIER_POINT'''
  );

  -- Movement-level live events: same sporting timestamp contract.
  v_def:=replace(v_def,
$new$      from public.capability_update_events cue
      where cue.user_id=c.user_id$new$,
$new$      from public.capability_update_events cue
      left join public.exercise_logs el on el.id=cue.exercise_log_id
      where cue.user_id=c.user_id$new$);
  v_def:=replace(v_def,
    'cue.created_at::date between v_since and v_anchor',
    'coalesce(el.created_at,cue.created_at)::date between v_since and v_anchor'
  );
  v_def:=replace(v_def,
    'order by cue.created_at desc,cue.id desc',
    'order by coalesce(el.created_at,cue.created_at) desc,cue.id desc'
  );

  -- Protocol events are scoped to the real completed session date.
  v_def:=replace(v_def,
$old$  from public.protocol_capability_events
  where user_id=p_user_id and applied
    and created_at::date between v_since and v_anchor;$old$,
$new$  from public.protocol_capability_events pe
  left join public.workout_sessions pws on pws.id=pe.session_id
  where pe.user_id=p_user_id and pe.applied
    and coalesce(pws.completed_at,pe.created_at)::date between v_since and v_anchor;$new$);

  v_def:=replace(v_def,
$new$      from public.protocol_capability_events pe
      where pe.user_id=p.user_id$new$,
$new$      from public.protocol_capability_events pe
      left join public.workout_sessions pws on pws.id=pe.session_id
      where pe.user_id=p.user_id$new$);
  v_def:=replace(v_def,
    'pe.created_at::date between v_since and v_anchor',
    'coalesce(pws.completed_at,pe.created_at)::date between v_since and v_anchor'
  );
  v_def:=replace(v_def,
    'order by pe.created_at desc,pe.id desc',
    'order by coalesce(pws.completed_at,pe.created_at) desc,pe.id desc'
  );

  v_def:=replace(v_def,
    '''version'',''pi1-progression-intelligence-v1''',
    '''version'',''pi1-progression-intelligence-v2-time-aligned'''
  );

  execute v_def;
end $$;;



-- SOURCE MIGRATION: 20260812083609_qa_catalog_complete_missing_joint_impact_v2.sql
update public.exercises
set joint_impact=1
where id in ('EX_C03','EX_L02') and joint_impact is null;;



-- SOURCE MIGRATION: 20260812083750_c48_progressive_variable_duration_with_wod_time_cap.sql
alter function public.c4_finalize_candidate(jsonb,jsonb,integer,integer,text,text)
rename to c4_finalize_candidate_pre_progressive_timecap;

create or replace function public.c4_finalize_candidate(
  p_candidate jsonb,
  p_stimulus jsonb,
  p_total_duration_minutes integer,
  p_exact_wod_minutes integer default null,
  p_c4_policy_key text default 'c4-final-default',
  p_c3_policy_key text default 'c3-sim-default'
)
returns jsonb
language plpgsql
stable
set search_path to 'public'
as $function$
declare
  v_result jsonb;
  v_mechanic text:=upper(coalesce(p_candidate->>'mechanic',''));
  v_wod_minutes int;
begin
  v_result:=public.c4_finalize_candidate_pre_progressive_timecap(
    p_candidate,p_stimulus,p_total_duration_minutes,p_exact_wod_minutes,p_c4_policy_key,p_c3_policy_key
  );

  if v_mechanic='PROGRESSIVE_INTERVAL' then
    v_wod_minutes:=coalesce(
      nullif(v_result#>>'{c4_final,mechanic_json,wod_budget_minutes}','')::int,
      p_exact_wod_minutes,
      greatest(1,p_total_duration_minutes)
    );

    v_result:=jsonb_set(v_result,'{c4_final,mechanic_json,parameters,time_limit_seconds}',to_jsonb(v_wod_minutes*60),true);
    v_result:=jsonb_set(v_result,'{c4_final,mechanic_json,parameters,duration_contract}',to_jsonb('variable_until_failure_with_wod_time_cap'::text),true);
    v_result:=jsonb_set(v_result,'{c4_final,mechanic_json,parameters,time_cap_role}',to_jsonb('session_budget_hard_cap'::text),true);
    v_result:=jsonb_set(v_result,'{c4_final,mechanic_json,parameters,predicted_duration_is_estimate}',to_jsonb(true),true);
  end if;

  return v_result;
end;
$function$;

alter function public.c4_candidate_quality_gate_v2(jsonb,text,text,text,text[],jsonb,integer,text)
rename to c4_candidate_quality_gate_v2_pre_progressive_duration;

create or replace function public.c4_candidate_quality_gate_v2(
  p_candidate jsonb,
  p_readiness text,
  p_focus text,
  p_target_region text,
  p_zone_terms text[],
  p_inventory jsonb,
  p_max_complexity integer,
  p_policy_key text default 'c4-final-default'
)
returns jsonb
language plpgsql
stable
set search_path to 'public'
as $function$
declare
  v_result jsonb;
  v_reasons jsonb;
  v_filtered jsonb;
  v_checks jsonb;
  v_mechanic text:=upper(coalesce(p_candidate->>'mechanic',''));
  v_duration_status text:=coalesce(p_candidate#>>'{c4_final,whole_wod_metrics,duration_status}','');
  v_time_limit int:=nullif(p_candidate#>>'{c4_final,mechanic_json,parameters,time_limit_seconds}','')::int;
  v_wod_minutes int:=nullif(p_candidate#>>'{c4_final,mechanic_json,wod_budget_minutes}','')::int;
begin
  v_result:=public.c4_candidate_quality_gate_v2_pre_progressive_duration(
    p_candidate,p_readiness,p_focus,p_target_region,p_zone_terms,p_inventory,p_max_complexity,p_policy_key
  );
  v_reasons:=coalesce(v_result->'hard_gate_reasons','[]'::jsonb);
  v_checks:=coalesce(v_result->'checks','{}'::jsonb);

  if v_mechanic='PROGRESSIVE_INTERVAL' and v_duration_status='UNDERFILLED' then
    -- Variable-duration progressive protocols may finish early by design.
    -- They are valid only when a hard cap protects the overall session budget.
    select coalesce(jsonb_agg(value),'[]'::jsonb)
    into v_filtered
    from jsonb_array_elements(v_reasons) x(value)
    where value<>to_jsonb('FINAL_DURATION_UNDERFILLED'::text);
    v_reasons:=v_filtered;

    if v_time_limit is null or v_time_limit<=0 or v_wod_minutes is null or v_time_limit>v_wod_minutes*60 then
      v_reasons:=v_reasons||jsonb_build_array('PROGRESSIVE_INTERVAL_REQUIRES_WOD_TIME_CAP');
    end if;

    v_checks:=v_checks||jsonb_build_object(
      'variable_duration_allowed',true,
      'time_limit_seconds',v_time_limit,
      'wod_budget_seconds',coalesce(v_wod_minutes,0)*60,
      'underfilled_prediction_is_hard_failure',false
    );
  else
    v_checks:=v_checks||jsonb_build_object('variable_duration_allowed',false);
  end if;

  return jsonb_build_object(
    'pass',jsonb_array_length(v_reasons)=0,
    'hard_gate_reasons',v_reasons,
    'mechanic',v_mechanic,
    'checks',v_checks,
    'version','c4-quality-gate-v1.5-progressive-duration'
  );
end;
$function$;;



-- SOURCE MIGRATION: 20260812084855_qa_security_protect_subscription_tier_from_client_updates.sql
create or replace function public.protect_profile_server_managed_fields()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if auth.uid() is not null and new.subscription_tier is distinct from old.subscription_tier then
    raise exception 'subscription_tier is server managed';
  end if;
  return new;
end;
$function$;

revoke execute on function public.protect_profile_server_managed_fields() from public,anon,authenticated;

drop trigger if exists trg_protect_profile_server_managed_fields on public.profiles;
create trigger trg_protect_profile_server_managed_fields
before update on public.profiles
for each row execute function public.protect_profile_server_managed_fields();;



-- SOURCE MIGRATION: 20260812085111_qa_security_harden_legacy_backup_shadow_tables.sql
revoke insert, update, delete, truncate, references, trigger on table public._backup_exercise_logs_pre_progress_v21 from authenticated;
revoke insert, update, delete, truncate, references, trigger on table public._backup_workout_session_exercises_pre_progress_v21 from authenticated;
revoke insert, update, delete, truncate, references, trigger on table public.capability_live_run_errors from authenticated;
revoke insert, update, delete, truncate, references, trigger on table public.user_exercise_capabilities_shadow from authenticated;
revoke insert, update, delete, truncate, references, trigger on table public.programs from authenticated;
revoke insert, update, delete, truncate, references, trigger on table public.workout_logs from authenticated;
revoke insert, update, delete, truncate, references, trigger on table public.workout_requests from authenticated;

grant select on table public._backup_exercise_logs_pre_progress_v21,
 public._backup_workout_session_exercises_pre_progress_v21,
 public.capability_live_run_errors,
 public.user_exercise_capabilities_shadow,
 public.programs,
 public.workout_logs,
 public.workout_requests to authenticated;;



-- SOURCE MIGRATION: 20260812094033_qa_v1_mechanic_specific_wod_duration_caps.sql
-- V1 guardrail: mechanic-specific WOD caps. No change to sport hierarchy or candidate ranking.
update public.session_engine_policy
set config = jsonb_set(
  coalesce(config,'{}'::jsonb),
  '{wod_duration_caps_minutes}',
  jsonb_build_object(
    'HIIT',25,
    'AMRAP',35,
    'EMOM',40,
    'FOR_TIME',40,
    'PROGRESSIVE_INTERVAL',40,
    'LADDER',40,
    'PYRAMID',40,
    'REP_TARGET',40,
    'ODD_EVEN',40,
    'COUPLET',40,
    'DECK',40,
    'CIRCUIT',50,
    'CHIPPER',50,
    'STRENGTH',50,
    'EVERY_X_MINUTES',50,
    'DEFAULT',50
  ),
  true
)
where policy_key='c4-final-default';

create or replace function public.c4_mechanic_wod_cap_minutes(
  p_mechanic text,
  p_policy_key text default 'c4-final-default'
) returns integer
language plpgsql stable
set search_path='public'
as $$
declare
  v_cfg jsonb;
  v_mech text:=upper(coalesce(p_mechanic,''));
  v_cap int;
begin
  select config into v_cfg from public.session_engine_policy where policy_key=p_policy_key;
  if v_cfg is null then raise exception 'Unknown C4 policy %',p_policy_key; end if;
  v_cap:=coalesce(
    nullif(v_cfg#>>array['wod_duration_caps_minutes',v_mech],'')::int,
    nullif(v_cfg#>>'{wod_duration_caps_minutes,DEFAULT}','')::int,
    50
  );
  return greatest(10,least(50,v_cap));
end;
$$;

alter function public.c4_finalize_candidate(jsonb,jsonb,integer,integer,text,text)
  rename to c4_finalize_candidate_pre_wod_caps;

create function public.c4_finalize_candidate(
  p_candidate jsonb,
  p_stimulus jsonb,
  p_total_duration_minutes integer,
  p_exact_wod_minutes integer default null,
  p_c4_policy_key text default 'c4-final-default',
  p_c3_policy_key text default 'c3-sim-default'
) returns jsonb
language plpgsql stable
set search_path='public'
as $$
declare
  v_mechanic text:=upper(coalesce(p_candidate->>'mechanic',''));
  v_cap int;
  v_effective_exact int;
  v_result jsonb;
begin
  v_cap:=public.c4_mechanic_wod_cap_minutes(v_mechanic,p_c4_policy_key);
  v_effective_exact:=case
    when p_exact_wod_minutes is null then null
    else least(p_exact_wod_minutes,v_cap)
  end;

  v_result:=public.c4_finalize_candidate_pre_wod_caps(
    p_candidate,p_stimulus,p_total_duration_minutes,v_effective_exact,p_c4_policy_key,p_c3_policy_key
  );

  return jsonb_set(
    v_result,
    '{c4_final,wod_duration_guardrail}',
    jsonb_build_object(
      'mechanic',v_mechanic,
      'cap_minutes',v_cap,
      'requested_wod_minutes',p_exact_wod_minutes,
      'effective_wod_minutes',coalesce(v_effective_exact,nullif(v_result#>>'{c4_final,mechanic_json,wod_budget_minutes}','')::int),
      'cap_applied',p_exact_wod_minutes is not null and p_exact_wod_minutes>v_cap,
      'version','v1-mechanic-wod-cap-1'
    ),
    true
  );
end;
$$;

alter function public.c4_plan_full_session(uuid,text,integer,text,text,text,text[],jsonb,integer,text,integer,text)
  rename to c4_plan_full_session_pre_wod_caps;

create function public.c4_plan_full_session(
  p_user_id uuid,
  p_focus text,
  p_duration_minutes integer,
  p_readiness text,
  p_target_region text default null,
  p_progression_intent text default null,
  p_zone_terms text[] default '{}'::text[],
  p_inventory jsonb default '[]'::jsonb,
  p_max_complexity integer default 3,
  p_max_difficulty text default 'Intermédiaire',
  p_candidate_count integer default 12,
  p_policy_key text default 'c4-final-default'
) returns jsonb
language plpgsql stable
set search_path='public'
as $$
declare
  v_plan jsonb;
  v_actual_wod int;
  v_original_wod int;
  v_warmup int;
  v_tabata int;
  v_skill int;
  v_planned int;
  v_blocks jsonb;
  v_mechanic text;
begin
  v_plan:=public.c4_plan_full_session_pre_wod_caps(
    p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
    p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty,p_candidate_count,p_policy_key
  );

  if coalesce(v_plan->>'status','')<>'READY' then return v_plan; end if;

  v_mechanic:=upper(coalesce(v_plan#>>'{selected_candidate,mechanic}',''));
  v_actual_wod:=coalesce(
    nullif(v_plan#>>'{selected_candidate,c4_final,mechanic_json,wod_budget_minutes}','')::int,
    nullif(v_plan#>>'{architecture,wod_minutes}','')::int,
    0
  );
  v_original_wod:=coalesce(nullif(v_plan#>>'{architecture,wod_minutes}','')::int,v_actual_wod);
  v_warmup:=coalesce(nullif(v_plan#>>'{architecture,warmup_minutes}','')::int,0);
  v_tabata:=coalesce(nullif(v_plan#>>'{architecture,tabata_minutes}','')::int,0);
  v_skill:=coalesce(nullif(v_plan#>>'{architecture,skill_minutes}','')::int,0);
  v_planned:=v_warmup+v_tabata+v_skill+v_actual_wod;

  select coalesce(jsonb_agg(
    case when b->>'block_key'='wod'
      then b||jsonb_build_object('duration_minutes',v_actual_wod)
      else b end
    order by ord
  ),'[]'::jsonb)
  into v_blocks
  from jsonb_array_elements(coalesce(v_plan->'blocks','[]'::jsonb)) with ordinality x(b,ord);

  v_plan:=jsonb_set(v_plan,'{blocks}',v_blocks,true);
  v_plan:=jsonb_set(v_plan,'{architecture,wod_minutes}',to_jsonb(v_actual_wod),true);
  v_plan:=jsonb_set(v_plan,'{architecture,planned_minutes}',to_jsonb(v_planned),true);
  v_plan:=jsonb_set(v_plan,'{architecture,unallocated_available_minutes}',to_jsonb(greatest(0,p_duration_minutes-v_planned)),true);
  v_plan:=jsonb_set(v_plan,'{architecture,wod_duration_guardrail}',jsonb_build_object(
    'mechanic',v_mechanic,
    'cap_minutes',public.c4_mechanic_wod_cap_minutes(v_mechanic,p_policy_key),
    'pre_guardrail_wod_minutes',v_original_wod,
    'final_wod_minutes',v_actual_wod,
    'available_time_is_maximum_not_fill_target',true,
    'version','v1-mechanic-wod-cap-1'
  ),true);

  return v_plan;
end;
$$;

revoke all on function public.c4_mechanic_wod_cap_minutes(text,text) from public, anon;
grant execute on function public.c4_mechanic_wod_cap_minutes(text,text) to authenticated;
;



-- SOURCE MIGRATION: 20260812094944_qa_v1_explicit_region_preference_min_60.sql
-- Product contract: an explicit Upper/Lower/Core preference must remain visibly dominant
-- whenever safety/equipment allow it. Minimum WOD share = 60% for every focus.

alter function public.c4_expand_candidate_to_block_rules(jsonb,uuid,text,integer,text,text,text,text[],jsonb,integer,text)
  rename to c4_expand_candidate_to_block_rules_pre_pref60;

create function public.c4_expand_candidate_to_block_rules(
  p_candidate jsonb,
  p_user_id uuid,
  p_focus text,
  p_duration_minutes integer,
  p_readiness text,
  p_target_region text,
  p_progression_intent text,
  p_zone_terms text[],
  p_inventory jsonb,
  p_max_complexity integer,
  p_max_difficulty text
) returns jsonb
language plpgsql stable
set search_path='public'
as $$
declare
  v_result jsonb;
  v_exercises jsonb;
  v_n int;
  v_required int;
  v_current int;
  v_mechanic text;
  v_replace_id text;
  v_new jsonb;
  v_rebuilt jsonb;
  v_score numeric;
  r record;
begin
  v_result:=public.c4_expand_candidate_to_block_rules_pre_pref60(
    p_candidate,p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
    p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty
  );

  if p_target_region not in ('Upper','Lower','Core') then return v_result; end if;

  v_exercises:=coalesce(v_result->'exercises','[]'::jsonb);
  v_n:=jsonb_array_length(v_exercises);
  if v_n=0 then return v_result; end if;
  v_required:=ceil(v_n*0.60)::int;

  select count(*) into v_current
  from jsonb_array_elements(v_exercises) x
  join public.exercises e on e.id=x->>'exercise_id'
  where e.body_region=p_target_region;

  v_mechanic:=upper(coalesce(v_result->>'mechanic','CIRCUIT'));

  while v_current<v_required loop
    -- Replace the weakest non-target exercise with the best safe target-region candidate.
    select x->>'exercise_id' into v_replace_id
    from jsonb_array_elements(v_exercises) x
    join public.exercises e on e.id=x->>'exercise_id'
    where e.body_region is distinct from p_target_region
    order by coalesce(nullif(x->>'candidate_score','')::numeric,0), x->>'exercise_id'
    limit 1;

    exit when v_replace_id is null;

    select cp.* into r
    from public.c2_candidate_pool(
      p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
      p_zone_terms,p_inventory,'WOD',p_max_complexity,p_max_difficulty,100
    ) cp
    where cp.body_region=p_target_region
      and not exists(
        select 1 from jsonb_array_elements(v_exercises) z where z->>'exercise_id'=cp.exercise_id
      )
    order by cp.candidate_score desc,cp.exercise_id
    limit 1;

    exit when not found;

    v_new:=jsonb_build_object(
      'exercise_id',r.exercise_id,
      'name',r.exercise_name,
      'pattern',r.movement_pattern,
      'family',r.exercise_family,
      'candidate_score',r.candidate_score,
      'components',r.score_components,
      'prescription',public.c2_solver_prescription(
        p_user_id,r.exercise_id,
        public.build_session_stimulus_target(p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,'c1-default'),
        v_mechanic,p_progression_intent,p_inventory
      )
    );

    select jsonb_agg(case when x->>'exercise_id'=v_replace_id then v_new else x end order by ord)
    into v_rebuilt
    from jsonb_array_elements(v_exercises) with ordinality z(x,ord);

    v_exercises:=coalesce(v_rebuilt,v_exercises);
    v_current:=v_current+1;
    v_replace_id:=null;
  end loop;

  select round(
    coalesce(avg(coalesce(nullif(x->>'candidate_score','')::numeric,0)),0)*0.90
    + coalesce(nullif(v_result->>'mechanic_fit','')::numeric,0)*0.10,2
  ) into v_score
  from jsonb_array_elements(v_exercises) x;

  v_result:=jsonb_set(v_result,'{exercises}',v_exercises,true);
  v_result:=jsonb_set(v_result,'{coach_score}',to_jsonb(v_score),true);
  v_result:=jsonb_set(v_result,'{c4_block_rules,required_target_region_count}',to_jsonb(v_required),true);
  v_result:=jsonb_set(v_result,'{c4_block_rules,final_target_region_count}',to_jsonb(v_current),true);
  v_result:=jsonb_set(v_result,'{c4_block_rules,explicit_region_min_share}',to_jsonb(0.60::numeric),true);
  v_result:=jsonb_set(v_result,'{c4_block_rules,preference_contract_version}',to_jsonb('v1-explicit-region-60'::text),true);
  return v_result;
end;
$$;

create or replace function public.c4_candidate_quality_gate_v2(
  p_candidate jsonb,
  p_readiness text,
  p_focus text,
  p_target_region text,
  p_zone_terms text[],
  p_inventory jsonb,
  p_max_complexity integer,
  p_policy_key text default 'c4-final-default'
) returns jsonb
language plpgsql stable
set search_path='public'
as $$
declare
  v_result jsonb;
  v_reasons jsonb;
  v_filtered jsonb;
  v_checks jsonb;
  v_mechanic text:=upper(coalesce(p_candidate->>'mechanic',''));
  v_duration_status text:=coalesce(p_candidate#>>'{c4_final,whole_wod_metrics,duration_status}','');
  v_time_limit int:=nullif(p_candidate#>>'{c4_final,mechanic_json,parameters,time_limit_seconds}','')::int;
  v_wod_minutes int:=nullif(p_candidate#>>'{c4_final,mechanic_json,wod_budget_minutes}','')::int;
  v_count int:=jsonb_array_length(coalesce(p_candidate->'exercises','[]'::jsonb));
  v_match int:=0;
  v_required int:=0;
begin
  v_result:=public.c4_candidate_quality_gate_v2_pre_progressive_duration(
    p_candidate,p_readiness,p_focus,p_target_region,p_zone_terms,p_inventory,p_max_complexity,p_policy_key
  );
  v_reasons:=coalesce(v_result->'hard_gate_reasons','[]'::jsonb);
  v_checks:=coalesce(v_result->'checks','{}'::jsonb);

  if v_mechanic='PROGRESSIVE_INTERVAL' and v_duration_status='UNDERFILLED' then
    select coalesce(jsonb_agg(value),'[]'::jsonb)
    into v_filtered
    from jsonb_array_elements(v_reasons) x(value)
    where value<>to_jsonb('FINAL_DURATION_UNDERFILLED'::text);
    v_reasons:=v_filtered;

    if v_time_limit is null or v_time_limit<=0 or v_wod_minutes is null or v_time_limit>v_wod_minutes*60 then
      v_reasons:=v_reasons||jsonb_build_array('PROGRESSIVE_INTERVAL_REQUIRES_WOD_TIME_CAP');
    end if;

    v_checks:=v_checks||jsonb_build_object(
      'variable_duration_allowed',true,
      'time_limit_seconds',v_time_limit,
      'wod_budget_seconds',coalesce(v_wod_minutes,0)*60,
      'underfilled_prediction_is_hard_failure',false
    );
  else
    v_checks:=v_checks||jsonb_build_object('variable_duration_allowed',false);
  end if;

  if p_target_region in ('Upper','Lower','Core') and v_count>0 then
    select count(*) into v_match
    from jsonb_array_elements(coalesce(p_candidate->'exercises','[]'::jsonb)) x
    join public.exercises e on e.id=x->>'exercise_id'
    where e.body_region=p_target_region;
    v_required:=ceil(v_count*0.60)::int;
    if v_match<v_required and not (v_reasons ? 'EXPLICIT_TARGET_REGION_COHERENCE_60') then
      v_reasons:=v_reasons||jsonb_build_array('EXPLICIT_TARGET_REGION_COHERENCE_60');
    end if;
    v_checks:=v_checks||jsonb_build_object(
      'target_region',p_target_region,
      'region_match_count',v_match,
      'region_required_count',v_required,
      'region_min_share',0.60,
      'preference_contract_version','v1-explicit-region-60'
    );
  end if;

  return jsonb_build_object(
    'pass',jsonb_array_length(v_reasons)=0,
    'hard_gate_reasons',v_reasons,
    'mechanic',v_mechanic,
    'checks',v_checks,
    'version','c4-quality-gate-v1.6-explicit-region-60'
  );
end;
$$;;



-- SOURCE MIGRATION: 20260812095223_qa_v1_optimize_region_preference_repair_pool.sql
create or replace function public.c4_expand_candidate_to_block_rules(
  p_candidate jsonb,
  p_user_id uuid,
  p_focus text,
  p_duration_minutes integer,
  p_readiness text,
  p_target_region text,
  p_progression_intent text,
  p_zone_terms text[],
  p_inventory jsonb,
  p_max_complexity integer,
  p_max_difficulty text
) returns jsonb
language plpgsql stable
set search_path='public'
as $$
declare
  v_result jsonb;
  v_exercises jsonb;
  v_n int;
  v_required int;
  v_current int;
  v_mechanic text;
  v_replace_id text;
  v_new jsonb;
  v_rebuilt jsonb;
  v_score numeric;
  r record;
begin
  v_result:=public.c4_expand_candidate_to_block_rules_pre_pref60(
    p_candidate,p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
    p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty
  );

  if p_target_region not in ('Upper','Lower','Core') then return v_result; end if;

  v_exercises:=coalesce(v_result->'exercises','[]'::jsonb);
  v_n:=jsonb_array_length(v_exercises);
  if v_n=0 then return v_result; end if;
  v_required:=ceil(v_n*0.60)::int;

  select count(*) into v_current
  from jsonb_array_elements(v_exercises) x
  join public.exercises e on e.id=x->>'exercise_id'
  where e.body_region=p_target_region;

  v_mechanic:=upper(coalesce(v_result->>'mechanic','CIRCUIT'));

  while v_current<v_required loop
    select x->>'exercise_id' into v_replace_id
    from jsonb_array_elements(v_exercises) x
    join public.exercises e on e.id=x->>'exercise_id'
    where e.body_region is distinct from p_target_region
    order by coalesce(nullif(x->>'candidate_score','')::numeric,0), x->>'exercise_id'
    limit 1;
    exit when v_replace_id is null;

    select cp.* into r
    from public.c2_candidate_pool(
      p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
      p_zone_terms,p_inventory,'WOD',p_max_complexity,p_max_difficulty,24
    ) cp
    where cp.body_region=p_target_region
      and not exists(select 1 from jsonb_array_elements(v_exercises) z where z->>'exercise_id'=cp.exercise_id)
    order by cp.candidate_score desc,cp.exercise_id
    limit 1;
    exit when not found;

    v_new:=jsonb_build_object(
      'exercise_id',r.exercise_id,'name',r.exercise_name,'pattern',r.movement_pattern,'family',r.exercise_family,
      'candidate_score',r.candidate_score,'components',r.score_components,
      'prescription',public.c2_solver_prescription(
        p_user_id,r.exercise_id,
        public.build_session_stimulus_target(p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,'c1-default'),
        v_mechanic,p_progression_intent,p_inventory
      )
    );

    select jsonb_agg(case when x->>'exercise_id'=v_replace_id then v_new else x end order by ord)
    into v_rebuilt from jsonb_array_elements(v_exercises) with ordinality z(x,ord);
    v_exercises:=coalesce(v_rebuilt,v_exercises);
    v_current:=v_current+1;
    v_replace_id:=null;
  end loop;

  select round(coalesce(avg(coalesce(nullif(x->>'candidate_score','')::numeric,0)),0)*0.90
               +coalesce(nullif(v_result->>'mechanic_fit','')::numeric,0)*0.10,2)
  into v_score from jsonb_array_elements(v_exercises) x;

  v_result:=jsonb_set(v_result,'{exercises}',v_exercises,true);
  v_result:=jsonb_set(v_result,'{coach_score}',to_jsonb(v_score),true);
  v_result:=jsonb_set(v_result,'{c4_block_rules,required_target_region_count}',to_jsonb(v_required),true);
  v_result:=jsonb_set(v_result,'{c4_block_rules,final_target_region_count}',to_jsonb(v_current),true);
  v_result:=jsonb_set(v_result,'{c4_block_rules,explicit_region_min_share}',to_jsonb(0.60::numeric),true);
  v_result:=jsonb_set(v_result,'{c4_block_rules,preference_contract_version}',to_jsonb('v1-explicit-region-60'::text),true);
  return v_result;
end;
$$;;



-- SOURCE MIGRATION: 20260812095710_qa_v1_mechanic_fit_respects_long_session_duration.sql
create or replace function public.c2_mechanic_fit(
  p_mechanic_key text,
  p_stimulus jsonb,
  p_progression_intent text default null
) returns numeric
language plpgsql stable
set search_path='public'
as $$
declare
  s_strength numeric := coalesce((p_stimulus#>>'{qualities,strength,score}')::numeric,50);
  s_cond numeric := coalesce((p_stimulus#>>'{qualities,conditioning,score}')::numeric,50);
  s_end numeric := coalesce((p_stimulus#>>'{qualities,muscular_endurance,score}')::numeric,50);
  s_density numeric := coalesce((p_stimulus#>>'{density,score}')::numeric,50);
  s_complexity numeric := coalesce((p_stimulus#>>'{complexity,score}')::numeric,50);
  m_strength numeric;
  m_cond numeric;
  m_end numeric;
  m_density numeric;
  m_complexity numeric;
  v_score numeric;
  v_intent text := upper(coalesce(p_progression_intent,''));
  v_duration int:=coalesce(nullif(p_stimulus->>'duration_minutes','')::int,45);
  v_desired_wod numeric;
  v_mechanic_cap int;
  v_duration_penalty numeric:=0;
begin
  case upper(p_mechanic_key)
    when 'AMRAP' then m_strength:=35;m_cond:=90;m_end:=80;m_density:=90;m_complexity:=45;
    when 'EMOM' then m_strength:=50;m_cond:=75;m_end:=65;m_density:=65;m_complexity:=55;
    when 'FOR_TIME' then m_strength:=40;m_cond:=85;m_end:=80;m_density:=80;m_complexity:=50;
    when 'CIRCUIT' then m_strength:=55;m_cond:=65;m_end:=65;m_density:=60;m_complexity:=45;
    when 'HIIT' then m_strength:=30;m_cond:=95;m_end:=82;m_density:=90;m_complexity:=45;
    when 'LADDER' then m_strength:=60;m_cond:=55;m_end:=80;m_density:=55;m_complexity:=55;
    when 'PYRAMID' then m_strength:=65;m_cond:=45;m_end:=70;m_density:=45;m_complexity:=55;
    when 'STRENGTH' then m_strength:=95;m_cond:=20;m_end:=40;m_density:=30;m_complexity:=60;
    when 'PROGRESSIVE_INTERVAL' then m_strength:=35;m_cond:=80;m_end:=75;m_density:=70;m_complexity:=50;
    when 'CHIPPER' then m_strength:=45;m_cond:=78;m_end:=85;m_density:=70;m_complexity:=50;
    when 'EVERY_X_MINUTES' then m_strength:=65;m_cond:=55;m_end:=60;m_density:=50;m_complexity:=55;
    when 'REP_TARGET' then m_strength:=55;m_cond:=55;m_end:=80;m_density:=60;m_complexity:=50;
    when 'ODD_EVEN' then m_strength:=45;m_cond:=78;m_end:=72;m_density:=70;m_complexity:=50;
    when 'COUPLET' then m_strength:=50;m_cond:=70;m_end:=78;m_density:=68;m_complexity:=55;
    when 'DECK' then m_strength:=35;m_cond:=82;m_end:=82;m_density:=75;m_complexity:=50;
    else return 0;
  end case;

  v_score := 100 - (
    abs(s_strength-m_strength)*0.20 +
    abs(s_cond-m_cond)*0.30 +
    abs(s_end-m_end)*0.20 +
    abs(s_density-m_density)*0.20 +
    abs(s_complexity-m_complexity)*0.10
  );

  if upper(p_mechanic_key)='PROGRESSIVE_INTERVAL' and v_intent in ('RECALIBRATE','EXPLORE') then v_score:=v_score+12; end if;
  if upper(p_mechanic_key)='STRENGTH' and v_intent='DELOAD' then v_score:=v_score-10; end if;
  if upper(p_mechanic_key)='HIIT' and v_intent='DELOAD' then v_score:=v_score-12; end if;

  -- Long availability should not be dominated by a short mechanic simply because its stimulus profile is attractive.
  -- Available time is still a maximum, not a fill target; this is only a soft selection penalty.
  v_desired_wod:=greatest(20,least(45,round(v_duration*0.50)));
  v_mechanic_cap:=public.c4_mechanic_wod_cap_minutes(upper(p_mechanic_key),'c4-final-default');
  if v_mechanic_cap<v_desired_wod then
    v_duration_penalty:=(v_desired_wod-v_mechanic_cap)*1.20;
    v_score:=v_score-v_duration_penalty;
  end if;

  return round(greatest(0,least(100,v_score)),2);
end;
$$;;



-- SOURCE MIGRATION: 20260812100617_qa_final_lock_client_acl_and_default_privileges.sql
-- Final client ACL hardening.
-- Anonymous users never mutate public tables.
-- Authenticated users may mutate only explicit user-owned declarative/import tables.

do $$
declare
  r record;
  v_auth_write text[] := array[
    'profiles',
    'user_goals',
    'user_equipment_inventory',
    'exercise_favorites',
    'user_athletic_baseline',
    'external_session_imports',
    'external_session_items'
  ];
begin
  for r in
    select tablename
    from pg_tables
    where schemaname='public'
  loop
    execute format('revoke insert, update, delete, truncate, references, trigger on table public.%I from anon',r.tablename);
    if not (r.tablename = any(v_auth_write)) then
      execute format('revoke insert, update, delete, truncate, references, trigger on table public.%I from authenticated',r.tablename);
    end if;
  end loop;
end $$;

-- Explicitly lock the two SECURITY DEFINER surfaces found by the final scan.
revoke all on function public.c4_evaluate_session_format(uuid,uuid,text,text) from public, anon;
grant execute on function public.c4_evaluate_session_format(uuid,uuid,text,text) to authenticated, service_role;

revoke all on function public.c4_recompile_session_format_core(uuid,uuid,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.c4_recompile_session_format_core(uuid,uuid,text,text,jsonb) to service_role;

-- Prevent future objects created by postgres from silently regaining broad client mutation/execute grants.
alter default privileges for role postgres in schema public
  revoke insert, update, delete, truncate, references, trigger on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from public;
;



-- SOURCE MIGRATION: 20260812104630_qa_b_live_actual_metric_contract_aliases.sql
create or replace function public.build_capability_observation_inputs(
  p_exercise_log_id bigint,
  p_quality_policy_key text default 'b2.6-adapter-draft-1'::text
)
returns jsonb
language plpgsql
stable
set search_path to 'public'
as $function$
declare
  v_result jsonb;
  v_block text;
  v_actual jsonb;
begin
  v_result:=public.build_capability_observation_inputs_pre_block_filter(p_exercise_log_id,p_quality_policy_key);

  -- Canonicalize live completion metrics for the capability engine while
  -- preserving the public/logging contract fields.
  v_actual:=coalesce(v_result->'actual','{}'::jsonb);
  if not (v_actual ? 'reps') and v_actual ? 'reps_completed' then
    v_actual:=jsonb_set(v_actual,'{reps}',v_actual->'reps_completed',true);
  end if;
  if not (v_actual ? 'load_kg') and v_actual ? 'weight_kg' then
    v_actual:=jsonb_set(v_actual,'{load_kg}',v_actual->'weight_kg',true);
  end if;
  v_result:=jsonb_set(v_result,'{actual}',v_actual,true);
  v_result:=jsonb_set(v_result,'{observation_context,metric_alias_contract}',to_jsonb('reps_completed->reps|weight_kg->load_kg'::text),true);

  select lower(coalesce(wse.block_key,'')) into v_block
  from public.exercise_logs el
  left join public.workout_session_exercises wse on wse.id=el.session_exercise_id
  where el.id=p_exercise_log_id;

  if v_block in ('warmup','warm_up','tabata') then
    v_result:=jsonb_set(v_result,'{excluded}','true'::jsonb,true);
    v_result:=jsonb_set(v_result,'{capability_eligible}','false'::jsonb,true);
    v_result:=jsonb_set(v_result,'{observation_role}',to_jsonb('CONTEXT_ONLY'::text),true);
    v_result:=jsonb_set(v_result,'{exclusion_reason}',to_jsonb('BLOCK_NOT_EXERCISE_CAPABILITY_ELIGIBLE'::text),true);
    v_result:=jsonb_set(v_result,'{updates}','[]'::jsonb,true);
    v_result:=jsonb_set(v_result,'{observation_context,capability_block_policy}',to_jsonb('warmup_tabata_history_only'::text),true);
  end if;

  return v_result;
end;
$function$;;



-- SOURCE MIGRATION: 20260812234505_c49_multiblock_safe_swap_backend.sql
create or replace function public.c4_non_wod_swap_candidate(
  p_user_id uuid,
  p_session_exercise_id uuid,
  p_excluded_exercise_ids text[] default '{}'::text[]
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  target record;
  ws record;
  v_block_key text;
  v_names text[];
  v_inventory jsonb;
  v_zones text[];
  v_max_complexity int;
  v_block_minutes int;
  v_candidate record;
  v_pres jsonb;
  v_expected jsonb;
  v_cap jsonb := '{}'::jsonb;
  v_direct_variant boolean := false;
begin
  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'Forbidden user';
  end if;

  select
    wse.*,
    e.movement_pattern as old_pattern,
    e.exercise_family as old_family,
    e.body_region as old_region,
    e.technical_complexity as old_complexity,
    e.warmup_role as old_warmup_role
  into target
  from public.workout_session_exercises wse
  join public.workout_sessions s on s.id = wse.session_id
  join public.exercises e on e.id = wse.exercise_id
  where wse.id = p_session_exercise_id
    and s.user_id = p_user_id;

  if not found then
    raise exception 'Session exercise instance not found';
  end if;

  v_block_key := case target.block_key when 'warm_up' then 'warmup' else target.block_key end;

  if v_block_key not in ('warmup','tabata','skill') then
    return jsonb_build_object(
      'status','NOT_SUPPORTED',
      'reason','NON_WOD_SWAP_REQUIRES_WARMUP_TABATA_OR_SKILL',
      'session_exercise_id',p_session_exercise_id,
      'block_key',v_block_key
    );
  end if;

  select * into ws
  from public.workout_sessions
  where id = target.session_id and user_id = p_user_id;

  if ws.status not in ('generated','in_progress') then
    return jsonb_build_object(
      'status','NOT_AVAILABLE',
      'reason','SESSION_NOT_MUTABLE',
      'session_exercise_id',p_session_exercise_id,
      'block_key',v_block_key
    );
  end if;

  v_names := coalesce(ws.available_equipment,'{}'::text[]);
  if cardinality(v_names)=0 then
    select coalesce(array_agg(e.name order by e.id),'{}'::text[])
    into v_names
    from public.user_equipment_inventory ui
    join public.equipment e on e.id=ui.equipment_id
    where ui.user_id=p_user_id and ui.active;
  end if;
  if cardinality(v_names)=0 then v_names:=array['Aucun']; end if;

  v_inventory := public.resolve_user_equipment_inventory(p_user_id,v_names,'c4-final-default');
  v_zones := public.normalize_body_zone_ids(coalesce(ws.injured_zones,'{}'::text[]));
  v_max_complexity := coalesce(target.old_complexity,case lower(coalesce(ws.readiness,'normal')) when 'low' then 3 else 5 end);

  select coalesce((b->>'duration_minutes')::int,0)
  into v_block_minutes
  from jsonb_array_elements(coalesce(ws.generated_workout->'blocks','[]'::jsonb)) b
  where (case b->>'block_key' when 'warm_up' then 'warmup' else b->>'block_key' end)=v_block_key
  limit 1;
  v_block_minutes := coalesce(v_block_minutes,0);

  select
    e.*,
    exists(
      select 1
      from public.exercise_variants ev
      where (ev.exercise_id=target.exercise_id and ev.target_exercise_id=e.id)
         or (ev.target_exercise_id=target.exercise_id and ev.exercise_id=e.id)
    ) as direct_variant
  into v_candidate
  from public.exercises e
  where e.id <> target.exercise_id
    and not (e.id = any(coalesce(p_excluded_exercise_ids,'{}'::text[])))
    and not exists(
      select 1 from public.workout_session_exercises used
      where used.session_id=target.session_id and used.exercise_id=e.id
    )
    and coalesce(e.technical_complexity,99) <= v_max_complexity
    and public.exercise_safe_for_zones(e.id,v_zones)
    and public.exercise_equipment_compatible(e.id,v_inventory)
    and (
      (
        v_block_key='warmup'
        and 'Warm-up'=any(e.usable_for)
        and coalesce(e.warmup_eligible,false)
        and coalesce(e.warmup_intensity,99)<=2
        and coalesce(e.fatigue_score,99)<=2
        and coalesce(e.joint_impact,99)<=2
        and coalesce(e.warmup_role,'')=coalesce(target.old_warmup_role,target.prescription_json->>'warmup_role','')
      )
      or
      (
        v_block_key='tabata'
        and 'Core'=any(e.usable_for)
        and coalesce(e.tabata_eligible,false)
        and not coalesce(e.warmup_only,false)
        and e.exercise_family='Core'
        and coalesce(e.fatigue_score,99)<=4
        and coalesce(e.joint_impact,99)<=3
        and not exists(
          select 1
          from public.workout_session_exercises other
          join public.exercises oe on oe.id=other.exercise_id
          where other.session_id=target.session_id
            and other.block_key='tabata'
            and other.id<>target.id
            and oe.movement_pattern=e.movement_pattern
        )
      )
      or
      (
        v_block_key='skill'
        and 'Skill'=any(e.usable_for)
        and not coalesce(e.warmup_only,false)
        and coalesce(e.fatigue_score,99)<=3
        and coalesce(e.joint_impact,99)<=3
        and (ws.target_region is null or ws.target_region='Full Body' or e.body_region=ws.target_region)
        and (e.movement_pattern=target.old_pattern or e.exercise_family=target.old_family)
      )
    )
  order by
    case when exists(
      select 1 from public.exercise_variants ev
      where (ev.exercise_id=target.exercise_id and ev.target_exercise_id=e.id)
         or (ev.target_exercise_id=target.exercise_id and ev.exercise_id=e.id)
    ) then 0 else 1 end,
    case when e.movement_pattern=target.old_pattern then 0 else 1 end,
    case when e.exercise_family=target.old_family then 0 else 1 end,
    case when e.body_region=target.old_region then 0 else 1 end,
    coalesce(e.selection_weight,0) desc,
    e.id
  limit 1;

  if not found then
    return jsonb_build_object(
      'status','NO_SAFE_SWAP',
      'mutated',false,
      'session_exercise_id',p_session_exercise_id,
      'block_key',v_block_key,
      'old_exercise_id',target.exercise_id,
      'old_technical_complexity',target.old_complexity,
      'technical_complexity_must_not_increase',true
    );
  end if;

  v_direct_variant := coalesce(v_candidate.direct_variant,false);

  v_pres := public.c2_solver_prescription(
    p_user_id,
    v_candidate.id,
    ws.expected_stimulus_json,
    case v_block_key when 'warmup' then 'WARMUP' when 'tabata' then 'TABATA' else 'SKILL' end,
    ws.progression_intent,
    v_inventory
  );

  if v_block_key='warmup' then
    v_pres := v_pres || jsonb_build_object(
      'block_role','warmup',
      'warmup_role',v_candidate.warmup_role,
      'target_duration_minutes',v_block_minutes
    );
  elsif v_block_key='tabata' then
    v_pres := v_pres || jsonb_build_object(
      'block_role','tabata',
      'protocol',coalesce(target.prescription_json->'protocol',jsonb_build_object(
        'rounds',8,'work_seconds',20,'rest_seconds',10,'rotation','alternate_exercises'
      ))
    );
  else
    v_pres := v_pres || jsonb_build_object(
      'block_role','skill',
      'target_duration_minutes',v_block_minutes,
      'quality_priority','technique_before_fatigue'
    );
  end if;

  v_expected := coalesce(target.expected_outcome_json,'{}'::jsonb);
  if v_block_key='warmup' then
    v_expected := v_expected || jsonb_build_object('block_key','warmup','warmup_role',v_candidate.warmup_role);
  elsif v_block_key='tabata' then
    v_expected := v_expected || jsonb_build_object('block_key','tabata','core_only',true,'protocol','20_on_10_off_x8');
  else
    v_expected := v_expected || jsonb_build_object('block_key','skill','goal','technical_quality_or_progression');
  end if;

  select coalesce(jsonb_build_object(
    'source','user_exercise_coach_state','state',s.state,'recommendation',s.recommendation,
    'reps_envelope',s.reps_envelope,'load_envelope',s.load_envelope,'time_envelope',s.time_envelope,
    'distance_envelope',s.distance_envelope,'pace_envelope',s.pace_envelope,
    'capability_confidence',s.capability_confidence,'capability_freshness',s.capability_freshness,
    'valid_evidence_count',s.valid_evidence_count
  ),'{}'::jsonb)
  into v_cap
  from public.user_exercise_coach_state s
  where s.user_id=p_user_id and s.exercise_id=v_candidate.id;
  v_cap := coalesce(v_cap,'{}'::jsonb);

  return jsonb_build_object(
    'status','AVAILABLE',
    'mutated',false,
    'session_id',target.session_id,
    'session_exercise_id',p_session_exercise_id,
    'block_key',v_block_key,
    'old_exercise_id',target.exercise_id,
    'new_exercise_id',v_candidate.id,
    'old_technical_complexity',target.old_complexity,
    'new_technical_complexity',v_candidate.technical_complexity,
    'technical_complexity_non_increasing',coalesce(v_candidate.technical_complexity,99)<=v_max_complexity,
    'direct_variant',v_direct_variant,
    'capacity_snapshot',v_cap,
    'expected_outcome',v_expected,
    'substitute',jsonb_build_object(
      'id',v_candidate.id,
      'exercise_id',v_candidate.id,
      'session_exercise_id',p_session_exercise_id,
      'name',v_candidate.name,
      'family',v_candidate.exercise_family,
      'pattern',v_candidate.movement_pattern,
      'region',v_candidate.body_region,
      'instructions',v_candidate.instructions,
      'tips',v_candidate.tips,
      'image_path',v_candidate.image_path,
      'tracking_modes',coalesce(to_jsonb(v_candidate.tracking_modes),'[]'::jsonb),
      'prescription',v_pres,
      'prescription_json',v_pres,
      'expected_outcome',v_expected,
      'warmup_role',case when v_block_key='warmup' then v_candidate.warmup_role else null end
    )
  );
end;
$function$;

revoke all on function public.c4_non_wod_swap_candidate(uuid,uuid,text[]) from public, anon, authenticated;

create or replace function public.c4_swap_session_exercise_v2(
  p_user_id uuid,
  p_session_exercise_id uuid,
  p_excluded_exercise_ids text[] default '{}'::text[]
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  target record;
  ws record;
  v_block_key text;
  v_preview jsonb;
  v_sub jsonb;
  v_pres jsonb;
  v_expected jsonb;
  v_cap jsonb;
  v_blocks jsonb;
  v_new_solver jsonb;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;

  select wse.*, s.user_id
  into target
  from public.workout_session_exercises wse
  join public.workout_sessions s on s.id=wse.session_id
  where wse.id=p_session_exercise_id and s.user_id=p_user_id;
  if not found then raise exception 'Session exercise instance not found'; end if;

  v_block_key:=case target.block_key when 'warm_up' then 'warmup' else target.block_key end;

  if v_block_key='wod' then
    return public.c4_swap_session_exercise(p_user_id,p_session_exercise_id,p_excluded_exercise_ids);
  end if;

  if v_block_key not in ('warmup','tabata','skill') then
    return jsonb_build_object('status','NOT_SUPPORTED','reason','SWAP_BLOCK_NOT_SUPPORTED','session_exercise_id',p_session_exercise_id,'block_key',v_block_key,'mutated',false);
  end if;

  select * into ws
  from public.workout_sessions
  where id=target.session_id and user_id=p_user_id
  for update;
  if ws.status not in ('generated','in_progress') then raise exception 'Session cannot swap in status %',ws.status; end if;

  v_preview:=public.c4_non_wod_swap_candidate(p_user_id,p_session_exercise_id,p_excluded_exercise_ids);
  if coalesce(v_preview->>'status','')<>'AVAILABLE' then return v_preview; end if;

  v_sub:=v_preview->'substitute';
  v_pres:=coalesce(v_preview->'substitute'->'prescription_json','{}'::jsonb);
  v_expected:=coalesce(v_preview->'expected_outcome','{}'::jsonb);
  v_cap:=coalesce(v_preview->'capacity_snapshot','{}'::jsonb);

  v_new_solver:=jsonb_build_object(
    'engine','c4-swap-v2',
    'block_key',v_block_key,
    'full_session_authority',true,
    'action','SWAP_INSTANCE:'||p_session_exercise_id::text,
    'swap_origin_exercise_id',target.exercise_id,
    'swap_new_exercise_id',v_preview->>'new_exercise_id',
    'technical_complexity_non_increasing',coalesce((v_preview->>'technical_complexity_non_increasing')::boolean,false),
    'direct_variant',coalesce((v_preview->>'direct_variant')::boolean,false)
  );

  update public.workout_session_exercises
  set exercise_id=v_preview->>'new_exercise_id',
      exercise_name=v_sub->>'name',
      prescription=coalesce(v_pres->>'text','Prescription adaptée'),
      prescription_json=v_pres,
      expected_outcome_json=v_expected,
      expected_rpe_min=nullif(v_pres->>'target_rpe_min','')::numeric,
      expected_rpe_max=nullif(v_pres->>'target_rpe_max','')::numeric,
      capacity_snapshot_json=v_cap,
      solver_decision_json=v_new_solver
  where id=p_session_exercise_id;

  select coalesce(jsonb_agg(
    case
      when (case b->>'block_key' when 'warm_up' then 'warmup' else b->>'block_key' end)=v_block_key then
        jsonb_set(
          b,
          '{exercises}',
          coalesce((
            select jsonb_agg(
              case when ord=target.position then v_sub else ex end
              order by ord
            )
            from jsonb_array_elements(coalesce(b->'exercises','[]'::jsonb)) with ordinality x(ex,ord)
          ),'[]'::jsonb),
          true
        )
      else b
    end
    order by bord
  ),'[]'::jsonb)
  into v_blocks
  from jsonb_array_elements(coalesce(ws.generated_workout->'blocks','[]'::jsonb)) with ordinality z(b,bord);

  update public.workout_sessions
  set generated_workout=jsonb_set(coalesce(generated_workout,'{}'::jsonb),'{blocks}',v_blocks,true),
      updated_at=now()
  where id=target.session_id;

  return jsonb_build_object(
    'status','APPLIED',
    'mutated',true,
    'session_id',target.session_id,
    'session_exercise_id',p_session_exercise_id,
    'block_key',v_block_key,
    'position',target.position,
    'old_exercise_id',target.exercise_id,
    'new_exercise_id',v_preview->>'new_exercise_id',
    'old_technical_complexity',v_preview->'old_technical_complexity',
    'new_technical_complexity',v_preview->'new_technical_complexity',
    'technical_complexity_non_increasing',v_preview->'technical_complexity_non_increasing',
    'full_wod_resimulated',false,
    'quality_gate',jsonb_build_object(
      'pain_gate',true,
      'equipment_gate',true,
      'block_contract_preserved',true,
      'technical_complexity_non_increasing',v_preview->'technical_complexity_non_increasing',
      'version','c4-multiblock-swap-v1'
    ),
    'result',jsonb_build_object('exercises',jsonb_build_array(v_sub)),
    'substitute',v_sub
  );
end;
$function$;

revoke all on function public.c4_swap_session_exercise_v2(uuid,uuid,text[]) from public, anon;
grant execute on function public.c4_swap_session_exercise_v2(uuid,uuid,text[]) to authenticated, service_role;



-- SOURCE MIGRATION: 20260812235340_c50_swap_availability_contract.sql
create or replace function public.c4_wod_swap_candidate_preview(
  p_user_id uuid,
  p_session_exercise_id uuid,
  p_excluded_exercise_ids text[] default '{}'::text[]
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  target record;
  ws record;
  v_names text[];
  v_inventory jsonb;
  v_base jsonb;
  v_candidate jsonb;
  v_exercises jsonb;
  v_final jsonb;
  v_prepared jsonb;
  v_gate jsonb;
  v_wod_min int;
  v_max_complexity int;
  r record;
  v_pres jsonb;
  v_new_ex jsonb;
  v_tested int:=0;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then
    raise exception 'Forbidden user';
  end if;

  select wse.*, e.movement_pattern old_pattern, e.exercise_family old_family, e.technical_complexity old_complexity
  into target
  from public.workout_session_exercises wse
  join public.workout_sessions s on s.id=wse.session_id
  join public.exercises e on e.id=wse.exercise_id
  where wse.id=p_session_exercise_id and s.user_id=p_user_id;

  if not found then
    raise exception 'Session exercise instance not found';
  end if;

  if target.block_key<>'wod' then
    return jsonb_build_object(
      'status','NOT_SUPPORTED',
      'reason','WOD_PREVIEW_REQUIRES_WOD_INSTANCE',
      'session_exercise_id',p_session_exercise_id,
      'mutated',false
    );
  end if;

  select * into ws
  from public.workout_sessions
  where id=target.session_id and user_id=p_user_id;

  if ws.status not in ('generated','in_progress') then
    return jsonb_build_object(
      'status','NOT_AVAILABLE',
      'reason','SESSION_NOT_MUTABLE',
      'session_exercise_id',p_session_exercise_id,
      'mutated',false
    );
  end if;

  v_names:=coalesce(ws.available_equipment,'{}'::text[]);
  if cardinality(v_names)=0 then
    select coalesce(array_agg(e.name order by e.id),'{}'::text[])
    into v_names
    from public.user_equipment_inventory ui
    join public.equipment e on e.id=ui.equipment_id
    where ui.user_id=p_user_id and ui.active;
  end if;
  if cardinality(v_names)=0 then v_names:=array['Aucun']; end if;

  v_inventory:=public.resolve_user_equipment_inventory(p_user_id,v_names,'c4-final-default');
  v_base:=public.c4_session_wod_candidate(target.session_id);
  v_wod_min:=coalesce(
    nullif(ws.mechanic_json->>'wod_budget_minutes','')::int,
    nullif(ws.planning_context_json#>>'{architecture,wod_minutes}','')::int,
    (
      select nullif(b->>'duration_minutes','')::int
      from jsonb_array_elements(coalesce(ws.generated_workout->'blocks','[]'::jsonb)) b
      where b->>'block_key'='wod'
      limit 1
    ),
    10
  );
  v_max_complexity:=case lower(coalesce(ws.readiness,'normal')) when 'low' then 3 else 5 end;

  for r in
    select cp.*, ne.technical_complexity as new_complexity
    from public.c2_candidate_pool(
      p_user_id,
      coalesce(ws.focus,'General Fitness'),
      coalesce(ws.duration_minutes,45),
      coalesce(ws.readiness,'normal'),
      ws.target_region,
      ws.progression_intent,
      coalesce(ws.injured_zones,'{}'::text[]),
      v_inventory,
      'WOD',
      v_max_complexity,
      'Avancé',
      60
    ) cp
    join public.exercises ne on ne.id=cp.exercise_id
    where cp.exercise_id<>target.exercise_id
      and coalesce(ne.technical_complexity,99)<=coalesce(target.old_complexity,v_max_complexity)
      and not (cp.exercise_id=any(coalesce(p_excluded_exercise_ids,'{}'::text[])))
      and not exists(
        select 1
        from jsonb_array_elements(v_base->'exercises') x
        where x->>'exercise_id'=cp.exercise_id
      )
    order by
      case when cp.movement_pattern=target.old_pattern then 0 when cp.exercise_family=target.old_family then 1 else 2 end,
      cp.candidate_score desc,
      cp.exercise_id
  loop
    v_tested:=v_tested+1;
    exit when v_tested>25;

    v_pres:=public.c2_solver_prescription(
      p_user_id,
      r.exercise_id,
      ws.expected_stimulus_json,
      v_base->>'mechanic',
      ws.progression_intent,
      v_inventory
    );

    v_new_ex:=jsonb_build_object(
      'exercise_id',r.exercise_id,
      'name',r.exercise_name,
      'pattern',r.movement_pattern,
      'family',r.exercise_family,
      'candidate_score',r.candidate_score,
      'components',r.score_components,
      'prescription',v_pres
    );

    select coalesce(
      jsonb_agg(case when ord=target.position then v_new_ex else value end order by ord),
      '[]'::jsonb
    )
    into v_exercises
    from jsonb_array_elements(v_base->'exercises') with ordinality x(value,ord);

    v_candidate:=jsonb_set(v_base,'{exercises}',v_exercises,true);
    v_prepared:=public.c4_prepare_candidate(v_candidate,'c4-final-default');
    v_final:=public.c4_finalize_candidate(
      v_prepared,
      ws.expected_stimulus_json,
      coalesce(ws.duration_minutes,45),
      v_wod_min,
      'c4-final-default',
      'c3-sim-default'
    );
    v_gate:=public.c4_candidate_quality_gate_v2(
      v_final,
      coalesce(ws.readiness,'normal'),
      coalesce(ws.focus,'General Fitness'),
      ws.target_region,
      coalesce(ws.injured_zones,'{}'::text[]),
      v_inventory,
      v_max_complexity,
      'c4-final-default'
    );

    if coalesce((v_gate->>'pass')::boolean,false)
       and coalesce((v_final#>>'{c4_final,feasible}')::boolean,false) then
      return jsonb_build_object(
        'status','AVAILABLE',
        'mutated',false,
        'session_id',target.session_id,
        'session_exercise_id',p_session_exercise_id,
        'block_key','wod',
        'old_exercise_id',target.exercise_id,
        'new_exercise_id',r.exercise_id,
        'old_technical_complexity',target.old_complexity,
        'new_technical_complexity',r.new_complexity,
        'technical_complexity_non_increasing',coalesce(r.new_complexity,99)<=coalesce(target.old_complexity,v_max_complexity),
        'candidates_tested',v_tested
      );
    end if;
  end loop;

  return jsonb_build_object(
    'status','NO_SAFE_SWAP',
    'mutated',false,
    'session_exercise_id',p_session_exercise_id,
    'block_key','wod',
    'old_exercise_id',target.exercise_id,
    'old_technical_complexity',target.old_complexity,
    'candidates_tested',v_tested,
    'technical_complexity_must_not_increase',true
  );
end;
$function$;

create or replace function public.get_workout_swap_availability(p_session_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_user_id uuid:=auth.uid();
  v_session record;
  r record;
  v_preview jsonb;
  v_items jsonb:='{}'::jsonb;
  v_block_key text;
  v_status text;
begin
  if v_user_id is null then
    raise exception 'Unauthorized';
  end if;

  select id,status
  into v_session
  from public.workout_sessions
  where id=p_session_id and user_id=v_user_id;

  if not found then
    raise exception 'Session not found';
  end if;

  for r in
    select id,block_key,position,exercise_id
    from public.workout_session_exercises
    where session_id=p_session_id
    order by
      case block_key when 'warm_up' then 1 when 'tabata' then 2 when 'skill' then 3 when 'wod' then 4 else 9 end,
      position
  loop
    v_block_key:=case r.block_key when 'warm_up' then 'warmup' else r.block_key end;

    if v_session.status not in ('generated','in_progress') then
      v_preview:=jsonb_build_object('status','NOT_AVAILABLE','reason','SESSION_NOT_MUTABLE');
    elsif v_block_key='wod' then
      v_preview:=public.c4_wod_swap_candidate_preview(v_user_id,r.id,'{}'::text[]);
    elsif v_block_key in ('warmup','tabata','skill') then
      v_preview:=public.c4_non_wod_swap_candidate(v_user_id,r.id,'{}'::text[]);
    else
      v_preview:=jsonb_build_object('status','NOT_SUPPORTED','reason','BLOCK_NOT_SUPPORTED');
    end if;

    v_status:=coalesce(v_preview->>'status','NOT_AVAILABLE');
    v_items:=v_items||jsonb_build_object(
      r.id::text,
      jsonb_build_object(
        'available',v_status='AVAILABLE',
        'status',v_status,
        'block_key',v_block_key,
        'exercise_id',r.exercise_id,
        'candidate_exercise_id',v_preview->>'new_exercise_id',
        'reason',v_preview->>'reason'
      )
    );
  end loop;

  return jsonb_build_object(
    'version','swap-availability-v1',
    'session_id',p_session_id,
    'items',v_items
  );
end;
$function$;

revoke all on function public.c4_wod_swap_candidate_preview(uuid,uuid,text[]) from public, anon, authenticated;
revoke all on function public.get_workout_swap_availability(uuid) from public, anon;
grant execute on function public.get_workout_swap_availability(uuid) to authenticated;



-- SOURCE MIGRATION: 20260813000923_c51_support_20_minute_sessions.sql
-- C51 — Support V1 des séances de 20 minutes
-- DEV appliqué le 13/08/2026.

create or replace function public.build_session_stimulus_target(
  p_focus text,
  p_duration_minutes integer,
  p_readiness text,
  p_target_region text default null::text,
  p_progression_intent text default null::text,
  p_policy_key text default 'c1-default'::text
)
returns jsonb
language plpgsql
stable
as $function$
declare
  v_config jsonb;
  v_profile jsonb;
  v_modifier jsonb;
  v_readiness text;
  v_focus text := trim(coalesce(p_focus,''));
  v_region text := nullif(trim(coalesce(p_target_region,'')),'');
  v_intent text := upper(nullif(trim(coalesce(p_progression_intent,'')),''));
  v_strength numeric;
  v_conditioning numeric;
  v_muscular_endurance numeric;
  v_power numeric;
  v_stability numeric;
  v_mobility numeric;
  v_density numeric;
  v_local_fatigue numeric;
  v_complexity numeric;
  v_rpe_min numeric;
  v_rpe_max numeric;
  v_shift numeric;
  v_reason_codes jsonb;
begin
  select config into v_config
  from public.session_engine_policy
  where policy_key=p_policy_key;

  if v_config is null then
    raise exception 'Unknown session engine policy: %', p_policy_key;
  end if;

  if v_focus not in ('General Fitness','Fat Loss','Muscle Gain','Strength','Conditioning') then
    raise exception 'Unsupported V1 focus: %', p_focus;
  end if;

  if p_duration_minutes is null or p_duration_minutes < 20 or p_duration_minutes > 90 then
    raise exception 'V1 session duration must be between 20 and 90 minutes';
  end if;

  if v_region is not null and v_region not in ('Upper','Lower','Core','Full Body') then
    raise exception 'Unsupported target region: %', p_target_region;
  end if;

  if v_intent is not null and v_intent not in ('PROGRESS','MAINTAIN','CONSOLIDATE','DELOAD','RECALIBRATE','EXPLORE') then
    raise exception 'Unsupported progression intent: %', p_progression_intent;
  end if;

  v_readiness := public.normalize_session_readiness(p_readiness);
  v_profile := v_config #> array['focus_profiles',v_focus];
  v_modifier := v_config #> array['readiness_modifiers',v_readiness];

  if v_profile is null or v_modifier is null then
    raise exception 'Incomplete session policy for focus/readiness';
  end if;

  v_strength := greatest(0,least(100,(v_profile->>'strength')::numeric));
  v_conditioning := greatest(0,least(100,(v_profile->>'conditioning')::numeric));
  v_muscular_endurance := greatest(0,least(100,(v_profile->>'muscular_endurance')::numeric));
  v_power := greatest(0,least(100,(v_profile->>'power')::numeric + coalesce((v_modifier->>'power')::numeric,0)));
  v_stability := greatest(0,least(100,(v_profile->>'stability')::numeric));
  v_mobility := greatest(0,least(100,(v_profile->>'mobility')::numeric));
  v_density := greatest(0,least(100,(v_profile->>'density')::numeric + coalesce((v_modifier->>'density')::numeric,0)));
  v_local_fatigue := greatest(0,least(100,(v_profile->>'local_fatigue')::numeric + coalesce((v_modifier->>'local_fatigue')::numeric,0)));
  v_complexity := greatest(0,least(100,(v_profile->>'complexity')::numeric + coalesce((v_modifier->>'complexity')::numeric,0)));
  v_shift := coalesce((v_modifier->>'rpe_shift')::numeric,0);
  v_rpe_min := greatest(1,least(10,(v_profile->>'rpe_min')::numeric + v_shift));
  v_rpe_max := greatest(v_rpe_min,least(10,(v_profile->>'rpe_max')::numeric + v_shift));

  v_reason_codes := jsonb_build_array(
    'focus_profile:' || replace(lower(v_focus),' ','_'),
    'readiness:' || v_readiness,
    case when v_region is null then 'region:auto' else 'region:' || replace(lower(v_region),' ','_') end,
    case when v_intent is null then 'progression_intent:unspecified' else 'progression_intent:' || lower(v_intent) end
  );

  return jsonb_build_object(
    'contract_version','c1-stimulus-v1.1-20min',
    'policy_key',p_policy_key,
    'focus',v_focus,
    'duration_minutes',p_duration_minutes,
    'target_region',coalesce(v_region,'AUTO'),
    'progression_intent',coalesce(v_intent,'UNSPECIFIED'),
    'readiness',jsonb_build_object('raw',p_readiness,'band',v_readiness),
    'qualities',jsonb_build_object(
      'strength',jsonb_build_object('score',v_strength,'band',public.session_stimulus_band(v_strength)),
      'conditioning',jsonb_build_object('score',v_conditioning,'band',public.session_stimulus_band(v_conditioning)),
      'muscular_endurance',jsonb_build_object('score',v_muscular_endurance,'band',public.session_stimulus_band(v_muscular_endurance)),
      'power',jsonb_build_object('score',v_power,'band',public.session_stimulus_band(v_power)),
      'stability',jsonb_build_object('score',v_stability,'band',public.session_stimulus_band(v_stability)),
      'mobility',jsonb_build_object('score',v_mobility,'band',public.session_stimulus_band(v_mobility))
    ),
    'density',jsonb_build_object('score',v_density,'band',public.session_stimulus_band(v_density)),
    'local_fatigue',jsonb_build_object('score',v_local_fatigue,'band',public.session_stimulus_band(v_local_fatigue)),
    'complexity',jsonb_build_object('score',v_complexity,'band',public.session_stimulus_band(v_complexity)),
    'rpe_target',jsonb_build_object('min',v_rpe_min,'max',v_rpe_max),
    'hard_gate_priority',v_config->'hard_gate_priority',
    'reason_codes',v_reason_codes
  );
end;
$function$;

create or replace function public.c3_wod_budget_minutes(
  p_total_duration_minutes integer,
  p_exact_wod_minutes integer default null::integer,
  p_policy_key text default 'c3-sim-default'::text
)
returns integer
language plpgsql
stable
as $function$
declare
  v_cfg jsonb;
  v_fraction numeric;
  v_min int;
  v_max int;
  v_result int;
begin
  if p_total_duration_minutes is null or p_total_duration_minutes < 20 or p_total_duration_minutes > 90 then
    raise exception 'V1 session duration must be between 20 and 90 minutes';
  end if;

  if p_exact_wod_minutes is not null then
    if p_exact_wod_minutes < 8 or p_exact_wod_minutes >= p_total_duration_minutes then
      raise exception 'Exact WOD duration must be >= 8 and lower than total session duration';
    end if;
    return p_exact_wod_minutes;
  end if;

  select config into v_cfg from public.session_engine_policy where policy_key=p_policy_key;
  if v_cfg is null then raise exception 'Unknown C3 policy %',p_policy_key; end if;

  v_fraction := coalesce((v_cfg#>>'{wod_budget,fraction_of_session}')::numeric,0.45);
  v_min := coalesce((v_cfg#>>'{wod_budget,min_minutes}')::int,12);
  v_max := coalesce((v_cfg#>>'{wod_budget,max_minutes}')::int,30);
  v_result := round(p_total_duration_minutes*v_fraction)::int;

  if p_total_duration_minutes < 30 then
    return greatest(8, least(p_total_duration_minutes - 5, v_result));
  end if;

  return greatest(v_min,least(v_max,v_result));
end;
$function$;



-- SOURCE MIGRATION: 20260813001101_c52_block_budget_and_opportunistic_skill.sql
-- C52 — Block Budget + Skill opportuniste
-- DEV appliqué le 13/08/2026.

update public.session_engine_policy
set config = jsonb_set(
  jsonb_set(
    config,
    '{block_budget}',
    jsonb_build_object(
      'base_transition_recovery_minutes',2,
      'optional_block_transition_minutes',1,
      'long_session_extra_recovery_minutes',1,
      'long_session_threshold_minutes',75,
      'low_readiness_extra_recovery_minutes',1,
      'skill_minutes_standard',8,
      'skill_minutes_long',10,
      'skill_minutes_very_long',12,
      'skill_long_threshold_minutes',75,
      'skill_very_long_threshold_minutes',90,
      'minimum_wod_minutes',10,
      'duration_is_maximum_not_fill_target',true
    ),
    true
  ),
  '{skill_policy}',
  jsonb_build_object(
    'min_session_minutes',45,
    'targeted_long_session_min_minutes',75,
    'max_exercises',1,
    'recalibration_is_single_movement',true,
    'include_focuses',jsonb_build_array('Strength','Muscle Gain'),
    'include_progression_intents',jsonb_build_array('PROGRESS','CONSOLIDATE','EXPLORE'),
    'recalibration_intent','RECALIBRATE',
    'capability_signal_confidence_threshold',0.60,
    'capability_signal_freshness_threshold',0.60
  ),
  true
)
where policy_key='c4-final-default';

create or replace function public.c4_plan_full_session_pre_wod_caps(
  p_user_id uuid,
  p_focus text,
  p_duration_minutes integer,
  p_readiness text,
  p_target_region text default null::text,
  p_progression_intent text default null::text,
  p_zone_terms text[] default '{}'::text[],
  p_inventory jsonb default '[]'::jsonb,
  p_max_complexity integer default 3,
  p_max_difficulty text default 'Intermédiaire'::text,
  p_candidate_count integer default 12,
  p_policy_key text default 'c4-final-default'::text
)
returns jsonb
language plpgsql
stable
set search_path to 'public'
as $function$
declare
  v_cfg jsonb;
  v_stimulus jsonb;
  v_warmup_min int;
  v_tabata_min int:=0;
  v_skill_min int:=0;
  v_wod_min int;
  v_transition_min int:=0;
  v_include_tabata boolean:=false;
  v_include_skill boolean:=false;
  v_skill_reason text:=null;
  v_warmup_count int;
  v_warmup jsonb:='[]'::jsonb;
  v_tabata jsonb:='[]'::jsonb;
  v_skill jsonb:='[]'::jsonb;
  v_wod jsonb;
  v_wod_candidate jsonb;
  v_blocks jsonb:='[]'::jsonb;
  v_pres jsonb;
  r record;
  v_target_patterns text[]:='{}'::text[];
  v_readiness_band text;
  v_min_wod int;
  v_base_transition int;
  v_optional_transition int;
  v_long_extra int;
  v_low_extra int;
  v_long_threshold int;
begin
  if p_duration_minutes<20 or p_duration_minutes>90 then
    raise exception 'Unsupported V1 session duration %',p_duration_minutes;
  end if;

  select config into v_cfg
  from public.session_engine_policy
  where policy_key=p_policy_key;
  if v_cfg is null then
    raise exception 'Unknown C4 policy %',p_policy_key;
  end if;

  v_stimulus:=public.build_session_stimulus_target(
    p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,'c1-default'
  );
  v_readiness_band:=public.normalize_session_readiness(p_readiness);

  v_warmup_min:=case when p_duration_minutes<=35 then 5 when p_duration_minutes<=60 then 6 else 7 end;
  v_warmup_count:=case when p_duration_minutes<=35 then 2 when p_duration_minutes<=60 then 3 else 4 end;

  v_include_tabata:=p_duration_minutes>=45 and (
    p_focus in ('General Fitness','Fat Loss','Conditioning') or p_target_region='Core'
  );
  if v_include_tabata then v_tabata_min:=4; end if;

  if p_duration_minutes>=coalesce((v_cfg#>>'{skill_policy,min_session_minutes}')::int,45) then
    if p_focus in ('Strength','Muscle Gain') then
      v_include_skill:=true;
      v_skill_reason:='focus_development';
    elsif upper(coalesce(p_progression_intent,'')) in ('PROGRESS','CONSOLIDATE','EXPLORE') then
      v_include_skill:=true;
      v_skill_reason:='progression_intent';
    elsif upper(coalesce(p_progression_intent,''))='RECALIBRATE' then
      v_include_skill:=true;
      v_skill_reason:='recalibration_window';
    elsif exists(
      select 1
      from public.exercises e
      join public.user_exercise_coach_state s
        on s.user_id=p_user_id and s.exercise_id=e.id
      where 'Skill'=any(e.usable_for)
        and not coalesce(e.warmup_only,false)
        and coalesce(e.technical_complexity,99)<=p_max_complexity
        and coalesce(e.fatigue_score,99)<=3
        and coalesce(e.joint_impact,99)<=3
        and (p_target_region is null or p_target_region='Full Body' or e.body_region=p_target_region)
        and public.exercise_safe_for_zones(e.id,public.normalize_body_zone_ids(coalesce(p_zone_terms,'{}'::text[])))
        and public.exercise_equipment_compatible(e.id,p_inventory)
        and (
          upper(coalesce(s.recommendation,'')) in ('PROGRESS_RECOMMENDED','PROGRESS_POSSIBLE','LEARN','RECALIBRATE')
          or (s.capability_confidence is not null and s.capability_confidence<0.60)
          or (s.capability_freshness is not null and s.capability_freshness<0.60)
          or coalesce(s.valid_evidence_count,0)=1
        )
    ) then
      v_include_skill:=true;
      v_skill_reason:='capability_signal';
    elsif p_duration_minutes>=coalesce((v_cfg#>>'{skill_policy,targeted_long_session_min_minutes}')::int,75)
      and p_target_region is not null
      and p_target_region<>'Full Body'
    then
      v_include_skill:=true;
      v_skill_reason:='targeted_long_session';
    end if;
  end if;

  if v_include_skill then
    v_skill_min:=case
      when p_duration_minutes>=coalesce((v_cfg#>>'{block_budget,skill_very_long_threshold_minutes}')::int,90)
        then coalesce((v_cfg#>>'{block_budget,skill_minutes_very_long}')::int,12)
      when p_duration_minutes>=coalesce((v_cfg#>>'{block_budget,skill_long_threshold_minutes}')::int,75)
        then coalesce((v_cfg#>>'{block_budget,skill_minutes_long}')::int,10)
      else coalesce((v_cfg#>>'{block_budget,skill_minutes_standard}')::int,8)
    end;
  end if;

  select coalesce(array_agg(distinct movement_pattern),'{}'::text[])
  into v_target_patterns
  from public.exercises e
  where (p_target_region is null or p_target_region='Full Body' or e.body_region=p_target_region)
    and 'WOD'=any(e.usable_for)
    and not coalesce(e.warmup_only,false)
    and e.technical_complexity<=p_max_complexity;

  for r in
    select e.*,
      case e.warmup_role when 'mobility' then 1 when 'activation' then 2 when 'movement_prep' then 3 when 'pulse_raiser' then 4 else 5 end role_rank,
      case when e.warmup_role='movement_prep' and e.movement_pattern=any(v_target_patterns) then 0 else 1 end prep_rank
    from public.exercises e
    where 'Warm-up'=any(e.usable_for)
      and coalesce(e.warmup_eligible,false)
      and coalesce(e.warmup_intensity,99)<=2
      and coalesce(e.fatigue_score,99)<=2
      and coalesce(e.joint_impact,99)<=2
      and coalesce(e.technical_complexity,99)<=p_max_complexity
      and public.exercise_safe_for_zones(e.id,public.normalize_body_zone_ids(coalesce(p_zone_terms,'{}'::text[])))
      and public.exercise_equipment_compatible(e.id,p_inventory)
    order by prep_rank,role_rank,coalesce(e.selection_weight,0) desc,e.id
  loop
    exit when jsonb_array_length(v_warmup)>=v_warmup_count;
    if not exists(select 1 from jsonb_array_elements(v_warmup) x where x->>'warmup_role'=r.warmup_role)
       or jsonb_array_length(v_warmup)>=3 then
      v_pres:=public.c2_solver_prescription(p_user_id,r.id,v_stimulus,'WARMUP',p_progression_intent,p_inventory)
        ||jsonb_build_object('block_role','warmup','warmup_role',r.warmup_role,'target_duration_minutes',v_warmup_min);
      v_warmup:=v_warmup||jsonb_build_array(jsonb_build_object(
        'exercise_id',r.id,'name',r.name,'pattern',r.movement_pattern,'family',r.exercise_family,'warmup_role',r.warmup_role,
        'prescription',v_pres,
        'expected_outcome',jsonb_build_object('block_key','warmup','goal','prepare_without_fatigue','warmup_role',r.warmup_role,'pain_gate',true,'equipment_gate',true)
      ));
    end if;
  end loop;

  if jsonb_array_length(v_warmup)<2 then
    return jsonb_build_object('version','c4-full-session-v1.1-budget','status','NO_SAFE_WARMUP','production_mutation',false,'stimulus',v_stimulus);
  end if;

  if v_include_tabata then
    for r in
      select e.*
      from public.exercises e
      where 'Core'=any(e.usable_for)
        and coalesce(e.tabata_eligible,false)
        and not coalesce(e.warmup_only,false)
        and coalesce(e.technical_complexity,99)<=p_max_complexity
        and coalesce(e.fatigue_score,99)<=4
        and coalesce(e.joint_impact,99)<=3
        and e.exercise_family='Core'
        and public.exercise_safe_for_zones(e.id,public.normalize_body_zone_ids(coalesce(p_zone_terms,'{}'::text[])))
        and public.exercise_equipment_compatible(e.id,p_inventory)
      order by case when e.body_region='Core' then 0 else 1 end,coalesce(e.selection_weight,0) desc,e.id
    loop
      exit when jsonb_array_length(v_tabata)>=2;
      if not exists(select 1 from jsonb_array_elements(v_tabata) x where x->>'pattern'=r.movement_pattern) then
        v_pres:=public.c2_solver_prescription(p_user_id,r.id,v_stimulus,'TABATA',p_progression_intent,p_inventory)
          ||jsonb_build_object('block_role','tabata','protocol',jsonb_build_object('rounds',8,'work_seconds',20,'rest_seconds',10,'rotation','alternate_exercises'));
        v_tabata:=v_tabata||jsonb_build_array(jsonb_build_object(
          'exercise_id',r.id,'name',r.name,'pattern',r.movement_pattern,'family',r.exercise_family,'prescription',v_pres,
          'expected_outcome',jsonb_build_object('block_key','tabata','protocol','20_on_10_off_x8','core_only',true,'pain_gate',true,'equipment_gate',true)
        ));
      end if;
    end loop;
    if jsonb_array_length(v_tabata)=0 then
      v_include_tabata:=false;
      v_tabata_min:=0;
    end if;
  end if;

  if v_include_skill then
    select e.* into r
    from public.exercises e
    left join public.user_exercise_coach_state s
      on s.user_id=p_user_id and s.exercise_id=e.id
    where 'Skill'=any(e.usable_for)
      and not coalesce(e.warmup_only,false)
      and coalesce(e.technical_complexity,99)<=p_max_complexity
      and coalesce(e.fatigue_score,99)<=3
      and coalesce(e.joint_impact,99)<=3
      and (p_target_region is null or p_target_region='Full Body' or e.body_region=p_target_region)
      and public.exercise_safe_for_zones(e.id,public.normalize_body_zone_ids(coalesce(p_zone_terms,'{}'::text[])))
      and public.exercise_equipment_compatible(e.id,p_inventory)
    order by
      case
        when v_skill_reason='recalibration_window'
          and (
            upper(coalesce(s.recommendation,'')) in ('LEARN','RECALIBRATE')
            or (s.capability_confidence is not null and s.capability_confidence<0.60)
            or (s.capability_freshness is not null and s.capability_freshness<0.60)
            or coalesce(s.valid_evidence_count,0)<=1
          )
        then 0 else 1
      end,
      case when upper(coalesce(s.recommendation,'')) in ('PROGRESS_RECOMMENDED','PROGRESS_POSSIBLE') then 0 else 1 end,
      case when s.user_id is not null then 0 else 1 end,
      coalesce(s.mastery_score,50) asc,
      coalesce(e.selection_weight,0) desc,
      e.id
    limit 1;

    if found then
      v_pres:=public.c2_solver_prescription(p_user_id,r.id,v_stimulus,'SKILL',p_progression_intent,p_inventory)
        ||jsonb_build_object(
          'block_role','skill',
          'target_duration_minutes',v_skill_min,
          'quality_priority','technique_before_fatigue',
          'skill_reason',v_skill_reason
        );
      v_skill:=jsonb_build_array(jsonb_build_object(
        'exercise_id',r.id,
        'name',r.name,
        'pattern',r.movement_pattern,
        'family',r.exercise_family,
        'prescription',v_pres,
        'expected_outcome',jsonb_build_object(
          'block_key','skill',
          'goal','technical_quality_or_progression',
          'skill_reason',v_skill_reason,
          'pain_gate',true,
          'equipment_gate',true
        )
      ));
    else
      v_include_skill:=false;
      v_skill_min:=0;
      v_skill_reason:=null;
    end if;
  end if;

  v_base_transition:=coalesce((v_cfg#>>'{block_budget,base_transition_recovery_minutes}')::int,2);
  v_optional_transition:=coalesce((v_cfg#>>'{block_budget,optional_block_transition_minutes}')::int,1);
  v_long_extra:=coalesce((v_cfg#>>'{block_budget,long_session_extra_recovery_minutes}')::int,1);
  v_low_extra:=coalesce((v_cfg#>>'{block_budget,low_readiness_extra_recovery_minutes}')::int,1);
  v_long_threshold:=coalesce((v_cfg#>>'{block_budget,long_session_threshold_minutes}')::int,75);
  v_min_wod:=coalesce((v_cfg#>>'{block_budget,minimum_wod_minutes}')::int,10);

  v_transition_min:=v_base_transition
    + case when v_include_tabata then v_optional_transition else 0 end
    + case when v_include_skill then v_optional_transition else 0 end
    + case when p_duration_minutes>=v_long_threshold then v_long_extra else 0 end
    + case when v_readiness_band='low' then v_low_extra else 0 end;

  v_wod_min:=p_duration_minutes-v_warmup_min-v_tabata_min-v_skill_min-v_transition_min;

  if v_wod_min<v_min_wod and v_include_skill then
    v_include_skill:=false;
    v_skill_min:=0;
    v_skill_reason:=null;
    v_skill:='[]'::jsonb;
    v_transition_min:=v_base_transition
      + case when v_include_tabata then v_optional_transition else 0 end
      + case when p_duration_minutes>=v_long_threshold then v_long_extra else 0 end
      + case when v_readiness_band='low' then v_low_extra else 0 end;
    v_wod_min:=p_duration_minutes-v_warmup_min-v_tabata_min-v_transition_min;
  end if;

  if v_wod_min<v_min_wod and v_include_tabata then
    v_include_tabata:=false;
    v_tabata_min:=0;
    v_tabata:='[]'::jsonb;
    v_transition_min:=v_base_transition
      + case when p_duration_minutes>=v_long_threshold then v_long_extra else 0 end
      + case when v_readiness_band='low' then v_low_extra else 0 end;
    v_wod_min:=p_duration_minutes-v_warmup_min-v_transition_min;
  end if;

  if v_wod_min<8 then
    return jsonb_build_object(
      'version','c4-full-session-v1.1-budget',
      'status','NO_SAFE_TIME_BUDGET',
      'production_mutation',false,
      'stimulus',v_stimulus,
      'architecture',jsonb_build_object(
        'total_minutes',p_duration_minutes,
        'warmup_minutes',v_warmup_min,
        'tabata_minutes',v_tabata_min,
        'skill_minutes',v_skill_min,
        'transition_recovery_minutes',v_transition_min,
        'wod_minutes',v_wod_min
      )
    );
  end if;

  v_wod:=public.solve_session_engine_c4(
    p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
    p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty,p_candidate_count,v_wod_min,p_policy_key
  );
  if coalesce(v_wod->>'status','')<>'READY' or v_wod->'selected_candidate' is null then
    return jsonb_build_object(
      'version','c4-full-session-v1.1-budget','status','NO_SAFE_COHERENT_WOD','production_mutation',false,
      'stimulus',v_stimulus,
      'architecture',jsonb_build_object(
        'total_minutes',p_duration_minutes,
        'warmup_minutes',v_warmup_min,
        'tabata_minutes',v_tabata_min,
        'skill_minutes',v_skill_min,
        'transition_recovery_minutes',v_transition_min,
        'wod_minutes',v_wod_min,
        'skill_reason',v_skill_reason,
        'duration_is_maximum_not_fill_target',true
      ),
      'wod_solver',v_wod
    );
  end if;
  v_wod_candidate:=v_wod->'selected_candidate';

  v_blocks:=v_blocks||jsonb_build_array(jsonb_build_object(
    'block_key','warmup','block_name','Échauffement','duration_minutes',v_warmup_min,
    'required',true,'exercises',v_warmup,'expected_outcome',jsonb_build_object('role','prepare','fatigue_ceiling','low')
  ));

  if v_include_tabata then
    v_blocks:=v_blocks||jsonb_build_array(jsonb_build_object(
      'block_key','tabata','block_name','Core Tabata','duration_minutes',4,'required',false,
      'structure','8 rounds — 20s travail / 10s repos','exercises',v_tabata,
      'expected_outcome',jsonb_build_object('role','core_conditioning','protocol','tabata_4min')
    ));
  end if;

  if v_include_skill then
    v_blocks:=v_blocks||jsonb_build_array(jsonb_build_object(
      'block_key','skill','block_name','Skill','duration_minutes',v_skill_min,'required',false,'exercises',v_skill,
      'expected_outcome',jsonb_build_object('role','skill','quality_priority',true,'skill_reason',v_skill_reason)
    ));
  end if;

  v_blocks:=v_blocks||jsonb_build_array(jsonb_build_object(
    'block_key','wod','block_name','WOD principal','duration_minutes',v_wod_min,'required',true,
    'mechanic',v_wod_candidate->>'mechanic','mechanic_json',v_wod_candidate#>'{c4_final,mechanic_json}',
    'exercises',v_wod_candidate->'exercises','expected_outcome',jsonb_build_object(
      'role','primary_training_stimulus',
      'predicted_volume',v_wod_candidate#>'{c4_final,predicted_volume}',
      'whole_wod_metrics',v_wod_candidate#>'{c4_final,whole_wod_metrics}'
    )
  ));

  return jsonb_build_object(
    'version','c4-full-session-v1.1-budget',
    'status','READY',
    'production_mutation',false,
    'stimulus',v_stimulus,
    'architecture',jsonb_build_object(
      'total_minutes',p_duration_minutes,
      'warmup_minutes',v_warmup_min,
      'tabata_minutes',v_tabata_min,
      'skill_minutes',v_skill_min,
      'transition_recovery_minutes',v_transition_min,
      'wod_minutes',v_wod_min,
      'active_block_budget_minutes',v_warmup_min+v_tabata_min+v_skill_min+v_wod_min,
      'planned_pre_cap_minutes',v_warmup_min+v_tabata_min+v_skill_min+v_wod_min+v_transition_min,
      'tabata_optional',true,
      'skill_optional',true,
      'skill_reason',v_skill_reason,
      'warmup_required',true,
      'wod_required',true,
      'duration_is_maximum_not_fill_target',true
    ),
    'blocks',v_blocks,
    'wod_solver',jsonb_build_object(
      'version',v_wod->'version',
      'candidate_count',v_wod->'candidate_count',
      'quality_gate',v_wod_candidate->'c4_quality_gate',
      'anti_redundancy',v_wod_candidate->'c4_anti_redundancy',
      'selection_score',v_wod_candidate->'c4_selection_score'
    ),
    'selected_candidate',v_wod_candidate
  );
end;
$function$;

create or replace function public.c4_plan_full_session(
  p_user_id uuid,
  p_focus text,
  p_duration_minutes integer,
  p_readiness text,
  p_target_region text default null::text,
  p_progression_intent text default null::text,
  p_zone_terms text[] default '{}'::text[],
  p_inventory jsonb default '[]'::jsonb,
  p_max_complexity integer default 3,
  p_max_difficulty text default 'Intermédiaire'::text,
  p_candidate_count integer default 12,
  p_policy_key text default 'c4-final-default'::text
)
returns jsonb
language plpgsql
stable
set search_path to 'public'
as $function$
declare
  v_plan jsonb;
  v_actual_wod int;
  v_original_wod int;
  v_warmup int;
  v_tabata int;
  v_skill int;
  v_transition int;
  v_planned int;
  v_active int;
  v_blocks jsonb;
  v_mechanic text;
begin
  v_plan:=public.c4_plan_full_session_pre_wod_caps(
    p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
    p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty,p_candidate_count,p_policy_key
  );

  if coalesce(v_plan->>'status','')<>'READY' then return v_plan; end if;

  v_mechanic:=upper(coalesce(v_plan#>>'{selected_candidate,mechanic}',''));
  v_actual_wod:=coalesce(
    nullif(v_plan#>>'{selected_candidate,c4_final,mechanic_json,wod_budget_minutes}','')::int,
    nullif(v_plan#>>'{architecture,wod_minutes}','')::int,
    0
  );
  v_original_wod:=coalesce(nullif(v_plan#>>'{architecture,wod_minutes}','')::int,v_actual_wod);
  v_warmup:=coalesce(nullif(v_plan#>>'{architecture,warmup_minutes}','')::int,0);
  v_tabata:=coalesce(nullif(v_plan#>>'{architecture,tabata_minutes}','')::int,0);
  v_skill:=coalesce(nullif(v_plan#>>'{architecture,skill_minutes}','')::int,0);
  v_transition:=coalesce(nullif(v_plan#>>'{architecture,transition_recovery_minutes}','')::int,0);
  v_active:=v_warmup+v_tabata+v_skill+v_actual_wod;
  v_planned:=v_active+v_transition;

  select coalesce(jsonb_agg(
    case when b->>'block_key'='wod'
      then b||jsonb_build_object('duration_minutes',v_actual_wod)
      else b end
    order by ord
  ),'[]'::jsonb)
  into v_blocks
  from jsonb_array_elements(coalesce(v_plan->'blocks','[]'::jsonb)) with ordinality x(b,ord);

  v_plan:=jsonb_set(v_plan,'{blocks}',v_blocks,true);
  v_plan:=jsonb_set(v_plan,'{architecture,wod_minutes}',to_jsonb(v_actual_wod),true);
  v_plan:=jsonb_set(v_plan,'{architecture,active_training_minutes}',to_jsonb(v_active),true);
  v_plan:=jsonb_set(v_plan,'{architecture,planned_minutes}',to_jsonb(v_planned),true);
  v_plan:=jsonb_set(v_plan,'{architecture,unallocated_available_minutes}',to_jsonb(greatest(0,p_duration_minutes-v_planned)),true);
  v_plan:=jsonb_set(v_plan,'{architecture,block_budget_version}','"block-budget-v1"'::jsonb,true);
  v_plan:=jsonb_set(v_plan,'{architecture,wod_duration_guardrail}',jsonb_build_object(
    'mechanic',v_mechanic,
    'cap_minutes',public.c4_mechanic_wod_cap_minutes(v_mechanic,p_policy_key),
    'pre_guardrail_wod_minutes',v_original_wod,
    'final_wod_minutes',v_actual_wod,
    'released_by_wod_cap_minutes',greatest(0,v_original_wod-v_actual_wod),
    'available_time_is_maximum_not_fill_target',true,
    'version','v1-mechanic-wod-cap-2-block-budget'
  ),true);

  return v_plan;
end;
$function$;



-- SOURCE MIGRATION: 20260813001155_c53_conditioning_variety_weighting.sql
-- C53 — Légère pondération variété pour Conditioning
-- Les hard gates restent absolus et passent avant le ranking.

update public.session_engine_policy
set config = jsonb_set(
  config,
  '{selection_weights_conditioning}',
  jsonb_build_object(
    'coach_score',0.52,
    'whole_wod_fit',0.28,
    'anti_redundancy',0.20,
    'note','Conditioning gets a mild variety boost only after hard quality gates pass.'
  ),
  true
)
where policy_key='c4-final-default';

create or replace function public.solve_session_engine_c4_raw_v15(
  p_user_id uuid,
  p_focus text,
  p_duration_minutes integer,
  p_readiness text,
  p_target_region text default null::text,
  p_progression_intent text default null::text,
  p_zone_terms text[] default '{}'::text[],
  p_inventory jsonb default '[]'::jsonb,
  p_max_complexity integer default 3,
  p_max_difficulty text default 'Intermédiaire'::text,
  p_candidate_count integer default 10,
  p_exact_wod_minutes integer default null::integer,
  p_policy_key text default 'c4-final-default'::text
)
returns jsonb
language plpgsql
stable
as $function$
declare
  v_cfg jsonb;
  v_c2 jsonb;
  v_stimulus jsonb;
  v_candidate jsonb;
  v_expanded jsonb;
  v_prepared jsonb;
  v_final jsonb;
  v_gate jsonb;
  v_red jsonb;
  v_score numeric;
  v_weight_coach numeric;
  v_weight_whole numeric;
  v_weight_red numeric;
  v_accepted jsonb := '[]'::jsonb;
  v_rejected jsonb := '[]'::jsonb;
  v_sorted jsonb := '[]'::jsonb;
  v_selected jsonb;
  v_effective_weights jsonb;
begin
  select config into v_cfg from public.session_engine_policy where policy_key=p_policy_key;
  if v_cfg is null then raise exception 'Unknown C4 policy %',p_policy_key; end if;

  if p_focus='Conditioning' then
    v_weight_coach := coalesce((v_cfg#>>'{selection_weights_conditioning,coach_score}')::numeric,0.52);
    v_weight_whole := coalesce((v_cfg#>>'{selection_weights_conditioning,whole_wod_fit}')::numeric,0.28);
    v_weight_red := coalesce((v_cfg#>>'{selection_weights_conditioning,anti_redundancy}')::numeric,0.20);
  else
    v_weight_coach := coalesce((v_cfg#>>'{selection_weights,coach_score}')::numeric,0.55);
    v_weight_whole := coalesce((v_cfg#>>'{selection_weights,whole_wod_fit}')::numeric,0.30);
    v_weight_red := coalesce((v_cfg#>>'{selection_weights,anti_redundancy}')::numeric,0.15);
  end if;

  v_effective_weights:=jsonb_build_object(
    'coach_score',v_weight_coach,
    'whole_wod_fit',v_weight_whole,
    'anti_redundancy',v_weight_red,
    'focus_specific',p_focus='Conditioning',
    'hard_quality_gates_run_before_ranking',true
  );

  v_c2 := public.simulate_session_engine_c2(
    p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
    p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty,greatest(5,least(coalesce(p_candidate_count,10),20))
  );
  v_stimulus := v_c2->'stimulus';

  if coalesce(v_c2#>>'{coherence_gate,status}','OK')<>'OK' then
    return jsonb_build_object(
      'version','c4-final-v1.7','status','NO_SAFE_COHERENT_WOD','production_mutation',false,
      'stimulus',v_stimulus,'selected_candidate',null,'accepted_candidates','[]'::jsonb,
      'rejected_candidates','[]'::jsonb,'c2_coherence_gate',v_c2->'coherence_gate',
      'selection_weights_effective',v_effective_weights
    );
  end if;

  for v_candidate in select value from jsonb_array_elements(coalesce(v_c2->'candidate_sessions','[]'::jsonb))
  loop
    v_expanded := public.c4_expand_candidate_to_block_rules(
      v_candidate,p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
      p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty
    );
    v_prepared := public.c4_prepare_candidate(v_expanded,p_policy_key);
    v_final := public.c4_finalize_candidate(v_prepared,v_stimulus,p_duration_minutes,p_exact_wod_minutes,p_policy_key,'c3-sim-default');
    v_gate := public.c4_candidate_quality_gate_v2(v_final,p_readiness,p_focus,p_target_region,p_zone_terms,p_inventory,p_max_complexity,p_policy_key);
    v_red := public.c4_redundancy_score(p_user_id,v_final,p_policy_key);

    if coalesce((v_gate->>'pass')::boolean,false) then
      v_score := round(
        coalesce((v_final->>'coach_score')::numeric,0)*v_weight_coach +
        coalesce((v_final#>>'{c4_final,whole_wod_metrics,whole_wod_fit}')::numeric,0)*v_weight_whole +
        coalesce((v_red->>'score')::numeric,0)*v_weight_red,2
      );
      v_accepted := v_accepted || jsonb_build_array(
        v_final || jsonb_build_object(
          'c4_quality_gate',v_gate,
          'c4_anti_redundancy',v_red,
          'c4_selection_score',v_score,
          'c4_selection_weights_effective',v_effective_weights
        )
      );
    else
      v_rejected := v_rejected || jsonb_build_array(jsonb_build_object(
        'mechanic',v_candidate->>'mechanic',
        'exercise_ids',(select coalesce(jsonb_agg(x->>'exercise_id'),'[]'::jsonb) from jsonb_array_elements(coalesce(v_final->'exercises','[]'::jsonb)) x),
        'quality_gate',v_gate,
        'final_status',v_final#>>'{c4_final,status}'
      ));
    end if;
  end loop;

  select coalesce(jsonb_agg(x order by (x->>'c4_selection_score')::numeric desc,(x->>'coach_score')::numeric desc),'[]'::jsonb)
  into v_sorted from jsonb_array_elements(v_accepted) x;

  if jsonb_array_length(v_sorted)=0 then
    return jsonb_build_object(
      'version','c4-final-v1.7','status','NO_FINAL_CANDIDATE','production_mutation',false,
      'stimulus',v_stimulus,'selected_candidate',null,'accepted_candidates','[]'::jsonb,
      'rejected_candidates',v_rejected,'c2_coherence_gate',v_c2->'coherence_gate',
      'selection_weights_effective',v_effective_weights
    );
  end if;

  v_selected := v_sorted->0;
  return jsonb_build_object(
    'version','c4-final-v1.7','status','READY','production_mutation',false,
    'stimulus',v_stimulus,'selected_candidate',v_selected,
    'accepted_candidates',v_sorted,'rejected_candidates',v_rejected,
    'candidate_count',jsonb_array_length(v_sorted),
    'selection_weights',v_cfg->'selection_weights',
    'selection_weights_effective',v_effective_weights,
    'quality_gate_priority',v_stimulus->'hard_gate_priority',
    'legacy_inventory_note',v_cfg#>'{legacy_inventory_defaults,note}'
  );
end;
$function$;

create or replace function public.solve_session_engine_c4(
  p_user_id uuid,
  p_focus text,
  p_duration_minutes integer,
  p_readiness text,
  p_target_region text default null::text,
  p_progression_intent text default null::text,
  p_zone_terms text[] default '{}'::text[],
  p_inventory jsonb default '[]'::jsonb,
  p_max_complexity integer default 3,
  p_max_difficulty text default 'Intermédiaire'::text,
  p_candidate_count integer default 10,
  p_exact_wod_minutes integer default null::integer,
  p_policy_key text default 'c4-final-default'::text
)
returns jsonb
language plpgsql
stable
set search_path to 'public'
as $function$
declare
  v_first jsonb;
  v_retry jsonb;
  v_requested int:=greatest(1,least(coalesce(p_candidate_count,10),20));
begin
  v_first:=public.solve_session_engine_c4_raw_v15(
    p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
    p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty,v_requested,
    p_exact_wod_minutes,p_policy_key
  );

  if coalesce(v_first->>'status','')='READY' or v_requested>=20 then
    return jsonb_set(
      v_first || jsonb_build_object('search_fallback_used',false,'initial_candidate_count',v_requested,'final_candidate_count',v_requested),
      '{version}','"c4-final-v1.7"'::jsonb,true
    );
  end if;

  v_retry:=public.solve_session_engine_c4_raw_v15(
    p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
    p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty,20,
    p_exact_wod_minutes,p_policy_key
  );

  return jsonb_set(
    v_retry || jsonb_build_object(
      'search_fallback_used',true,
      'initial_status',v_first->>'status',
      'initial_candidate_count',v_requested,
      'final_candidate_count',20
    ),
    '{version}','"c4-final-v1.7"'::jsonb,true
  );
end;
$function$;



-- SOURCE MIGRATION: 20260813001555_c54_long_session_utilization_tiebreak.sql
-- C54 — Utilisation des longues séances sans remplissage artificiel
-- Uniquement comme tiebreak dans une bande de qualité équivalente.

update public.session_engine_policy
set config = jsonb_set(
  jsonb_set(
    jsonb_set(config,'{block_budget,skill_minutes_long}','12'::jsonb,true),
    '{block_budget,skill_minutes_very_long}','15'::jsonb,true
  ),
  '{long_session_selection}',
  jsonb_build_object(
    'min_duration_minutes',75,
    'equivalent_score_delta',1.5,
    'prefer_more_usable_wod_time_only_inside_equivalent_quality_band',true
  ),
  true
)
where policy_key='c4-final-default';

create or replace function public.solve_session_engine_c4_raw_v15(
  p_user_id uuid,
  p_focus text,
  p_duration_minutes integer,
  p_readiness text,
  p_target_region text default null::text,
  p_progression_intent text default null::text,
  p_zone_terms text[] default '{}'::text[],
  p_inventory jsonb default '[]'::jsonb,
  p_max_complexity integer default 3,
  p_max_difficulty text default 'Intermédiaire'::text,
  p_candidate_count integer default 10,
  p_exact_wod_minutes integer default null::integer,
  p_policy_key text default 'c4-final-default'::text
)
returns jsonb
language plpgsql
stable
as $function$
declare
  v_cfg jsonb;
  v_c2 jsonb;
  v_stimulus jsonb;
  v_candidate jsonb;
  v_expanded jsonb;
  v_prepared jsonb;
  v_final jsonb;
  v_gate jsonb;
  v_red jsonb;
  v_score numeric;
  v_weight_coach numeric;
  v_weight_whole numeric;
  v_weight_red numeric;
  v_accepted jsonb := '[]'::jsonb;
  v_rejected jsonb := '[]'::jsonb;
  v_sorted jsonb := '[]'::jsonb;
  v_selected jsonb;
  v_tiebreak jsonb;
  v_effective_weights jsonb;
  v_top_score numeric;
  v_equivalent_delta numeric;
  v_long_min int;
  v_selected_wod int;
  v_tiebreak_wod int;
begin
  select config into v_cfg
  from public.session_engine_policy
  where policy_key=p_policy_key;

  if v_cfg is null then
    raise exception 'Unknown C4 policy %',p_policy_key;
  end if;

  if p_focus='Conditioning' then
    v_weight_coach := coalesce((v_cfg#>>'{selection_weights_conditioning,coach_score}')::numeric,0.52);
    v_weight_whole := coalesce((v_cfg#>>'{selection_weights_conditioning,whole_wod_fit}')::numeric,0.28);
    v_weight_red := coalesce((v_cfg#>>'{selection_weights_conditioning,anti_redundancy}')::numeric,0.20);
  else
    v_weight_coach := coalesce((v_cfg#>>'{selection_weights,coach_score}')::numeric,0.55);
    v_weight_whole := coalesce((v_cfg#>>'{selection_weights,whole_wod_fit}')::numeric,0.30);
    v_weight_red := coalesce((v_cfg#>>'{selection_weights,anti_redundancy}')::numeric,0.15);
  end if;

  v_effective_weights:=jsonb_build_object(
    'coach_score',v_weight_coach,
    'whole_wod_fit',v_weight_whole,
    'anti_redundancy',v_weight_red,
    'focus_specific',p_focus='Conditioning',
    'hard_quality_gates_run_before_ranking',true
  );

  v_c2 := public.simulate_session_engine_c2(
    p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
    p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty,greatest(5,least(coalesce(p_candidate_count,10),20))
  );
  v_stimulus := v_c2->'stimulus';

  if coalesce(v_c2#>>'{coherence_gate,status}','OK')<>'OK' then
    return jsonb_build_object(
      'version','c4-final-v1.7','status','NO_SAFE_COHERENT_WOD','production_mutation',false,
      'stimulus',v_stimulus,'selected_candidate',null,'accepted_candidates','[]'::jsonb,
      'rejected_candidates','[]'::jsonb,'c2_coherence_gate',v_c2->'coherence_gate',
      'selection_weights_effective',v_effective_weights
    );
  end if;

  for v_candidate in
    select value from jsonb_array_elements(coalesce(v_c2->'candidate_sessions','[]'::jsonb))
  loop
    v_expanded := public.c4_expand_candidate_to_block_rules(
      v_candidate,p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
      p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty
    );
    v_prepared := public.c4_prepare_candidate(v_expanded,p_policy_key);
    v_final := public.c4_finalize_candidate(
      v_prepared,v_stimulus,p_duration_minutes,p_exact_wod_minutes,p_policy_key,'c3-sim-default'
    );
    v_gate := public.c4_candidate_quality_gate_v2(
      v_final,p_readiness,p_focus,p_target_region,p_zone_terms,p_inventory,p_max_complexity,p_policy_key
    );
    v_red := public.c4_redundancy_score(p_user_id,v_final,p_policy_key);

    if coalesce((v_gate->>'pass')::boolean,false) then
      v_score := round(
        coalesce((v_final->>'coach_score')::numeric,0)*v_weight_coach +
        coalesce((v_final#>>'{c4_final,whole_wod_metrics,whole_wod_fit}')::numeric,0)*v_weight_whole +
        coalesce((v_red->>'score')::numeric,0)*v_weight_red,
        2
      );

      v_accepted := v_accepted || jsonb_build_array(
        v_final || jsonb_build_object(
          'c4_quality_gate',v_gate,
          'c4_anti_redundancy',v_red,
          'c4_selection_score',v_score,
          'c4_selection_weights_effective',v_effective_weights
        )
      );
    else
      v_rejected := v_rejected || jsonb_build_array(jsonb_build_object(
        'mechanic',v_candidate->>'mechanic',
        'exercise_ids',(
          select coalesce(jsonb_agg(x->>'exercise_id'),'[]'::jsonb)
          from jsonb_array_elements(coalesce(v_final->'exercises','[]'::jsonb)) x
        ),
        'quality_gate',v_gate,
        'final_status',v_final#>>'{c4_final,status}'
      ));
    end if;
  end loop;

  select coalesce(
    jsonb_agg(
      x
      order by
        (x->>'c4_selection_score')::numeric desc,
        (x->>'coach_score')::numeric desc
    ),
    '[]'::jsonb
  )
  into v_sorted
  from jsonb_array_elements(v_accepted) x;

  if jsonb_array_length(v_sorted)=0 then
    return jsonb_build_object(
      'version','c4-final-v1.7','status','NO_FINAL_CANDIDATE','production_mutation',false,
      'stimulus',v_stimulus,'selected_candidate',null,'accepted_candidates','[]'::jsonb,
      'rejected_candidates',v_rejected,'c2_coherence_gate',v_c2->'coherence_gate',
      'selection_weights_effective',v_effective_weights
    );
  end if;

  v_selected := v_sorted->0;
  v_long_min:=coalesce((v_cfg#>>'{long_session_selection,min_duration_minutes}')::int,75);
  v_equivalent_delta:=coalesce((v_cfg#>>'{long_session_selection,equivalent_score_delta}')::numeric,1.5);

  if p_duration_minutes>=v_long_min and p_exact_wod_minutes is not null then
    v_top_score:=coalesce((v_selected->>'c4_selection_score')::numeric,0);

    select x
    into v_tiebreak
    from jsonb_array_elements(v_sorted) x
    where coalesce((x->>'c4_selection_score')::numeric,0)>=v_top_score-v_equivalent_delta
    order by
      coalesce(nullif(x#>>'{c4_final,mechanic_json,wod_budget_minutes}','')::int,0) desc,
      coalesce((x->>'c4_selection_score')::numeric,0) desc,
      coalesce((x->>'coach_score')::numeric,0) desc
    limit 1;

    if v_tiebreak is not null then
      v_selected_wod:=coalesce(nullif(v_selected#>>'{c4_final,mechanic_json,wod_budget_minutes}','')::int,0);
      v_tiebreak_wod:=coalesce(nullif(v_tiebreak#>>'{c4_final,mechanic_json,wod_budget_minutes}','')::int,0);

      if v_tiebreak_wod>v_selected_wod then
        v_selected:=v_tiebreak||jsonb_build_object(
          'c4_long_session_utilization_tiebreak',jsonb_build_object(
            'used',true,
            'quality_equivalence_delta',v_equivalent_delta,
            'original_top_score',v_top_score,
            'selected_score',(v_tiebreak->>'c4_selection_score')::numeric,
            'original_wod_minutes',v_selected_wod,
            'selected_wod_minutes',v_tiebreak_wod,
            'reason','prefer_more_usable_time_only_inside_equivalent_quality_band'
          )
        );
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'version','c4-final-v1.7','status','READY','production_mutation',false,
    'stimulus',v_stimulus,'selected_candidate',v_selected,
    'accepted_candidates',v_sorted,'rejected_candidates',v_rejected,
    'candidate_count',jsonb_array_length(v_sorted),
    'selection_weights',v_cfg->'selection_weights',
    'selection_weights_effective',v_effective_weights,
    'quality_gate_priority',v_stimulus->'hard_gate_priority',
    'legacy_inventory_note',v_cfg#>'{legacy_inventory_defaults,note}'
  );
end;
$function$;



-- SOURCE MIGRATION: 20260813085500_c55_wall_drill_explicit_swap_fallback.sql
insert into public.exercise_variants(exercise_id,target_exercise_id,variant_type)
values ('EX429','EX401','regression')
on conflict do nothing;

do $migration$
declare
  v_def text;
  v_old text;
  v_new text;
begin
  select pg_get_functiondef('public.c4_non_wod_swap_candidate(uuid,uuid,text[])'::regprocedure)
  into v_def;

  v_old := $old$      (
        v_block_key='warmup'
        and 'Warm-up'=any(e.usable_for)
        and coalesce(e.warmup_eligible,false)
        and coalesce(e.warmup_intensity,99)<=2
        and coalesce(e.fatigue_score,99)<=2
        and coalesce(e.joint_impact,99)<=2
        and coalesce(e.warmup_role,'')=coalesce(target.old_warmup_role,target.prescription_json->>'warmup_role','')
      )$old$;

  v_new := $new$      (
        v_block_key='warmup'
        and (
          (
            'Warm-up'=any(e.usable_for)
            and coalesce(e.warmup_eligible,false)
            and coalesce(e.warmup_intensity,99)<=2
            and coalesce(e.fatigue_score,99)<=2
            and coalesce(e.joint_impact,99)<=2
            and coalesce(e.warmup_role,'')=coalesce(target.old_warmup_role,target.prescription_json->>'warmup_role','')
          )
          or
          (
            exists(
              select 1 from public.exercise_variants ev
              where (ev.exercise_id=target.exercise_id and ev.target_exercise_id=e.id)
                 or (ev.target_exercise_id=target.exercise_id and ev.exercise_id=e.id)
            )
            and e.movement_pattern=target.old_pattern
            and e.exercise_family=target.old_family
            and coalesce(e.fatigue_score,99)<=2
            and coalesce(e.joint_impact,99)<=2
          )
        )
      )$new$;

  if position(v_old in v_def)=0 then
    raise exception 'C55 expected warmup candidate block not found';
  end if;

  v_def := replace(v_def,v_old,v_new);
  v_def := replace(
    v_def,
    $$'warmup_role',v_candidate.warmup_role,$$,
    $$'warmup_role',coalesce(v_candidate.warmup_role,target.old_warmup_role,target.prescription_json->>'warmup_role'),$$
  );
  v_def := replace(
    v_def,
    $$jsonb_build_object('block_key','warmup','warmup_role',v_candidate.warmup_role)$$,
    $$jsonb_build_object('block_key','warmup','warmup_role',coalesce(v_candidate.warmup_role,target.old_warmup_role,target.prescription_json->>'warmup_role'))$$
  );
  v_def := replace(
    v_def,
    $$'warmup_role',case when v_block_key='warmup' then v_candidate.warmup_role else null end$$,
    $$'warmup_role',case when v_block_key='warmup' then coalesce(v_candidate.warmup_role,target.old_warmup_role,target.prescription_json->>'warmup_role') else null end$$
  );

  execute v_def;
end;
$migration$;

revoke all on function public.c4_non_wod_swap_candidate(uuid,uuid,text[]) from public, anon, authenticated;
grant execute on function public.c4_non_wod_swap_candidate(uuid,uuid,text[]) to service_role;



-- SOURCE MIGRATION: 20260817190500_session_environment_requirements_v1.sql
create table if not exists public.exercise_environment_requirements (
  exercise_id text not null references public.exercises(id) on delete cascade,
  requirement_key text not null,
  reason text null,
  created_at timestamptz not null default now(),
  primary key (exercise_id, requirement_key),
  constraint exercise_environment_requirements_key_check
    check (requirement_key in ('wall','travel_space','overhead_clearance','jumping_allowed'))
);

alter table public.exercise_environment_requirements enable row level security;

drop policy if exists exercise_environment_requirements_read on public.exercise_environment_requirements;
create policy exercise_environment_requirements_read
  on public.exercise_environment_requirements
  for select
  to authenticated
  using (true);

grant select on public.exercise_environment_requirements to authenticated;

insert into public.exercise_environment_requirements (exercise_id, requirement_key, reason)
select e.id, 'wall', 'Ce mouvement nécessite un mur exploitable.'
from public.exercises e
where lower(e.name) like '%wall%'
   or lower(e.name) like '%mur%'
on conflict (exercise_id, requirement_key) do update
set reason = excluded.reason;

insert into public.exercise_environment_requirements (exercise_id, requirement_key, reason)
select e.id, 'travel_space', 'Ce mouvement nécessite un espace de déplacement exploitable.'
from public.exercises e
where e.movement_pattern in ('Carry','Locomotion')
   or lower(e.name) like '%carry%'
   or lower(e.name) like '%walk%'
on conflict (exercise_id, requirement_key) do update
set reason = excluded.reason;

insert into public.exercise_environment_requirements (exercise_id, requirement_key, reason)
select e.id, 'overhead_clearance', 'Ce mouvement nécessite une hauteur libre suffisante au-dessus de la tête.'
from public.exercises e
where e.starting_position = 'Handstand'
   or lower(e.name) like '%overhead%'
on conflict (exercise_id, requirement_key) do update
set reason = excluded.reason;

insert into public.exercise_environment_requirements (exercise_id, requirement_key, reason)
select e.id, 'jumping_allowed', 'Ce mouvement nécessite que les sauts soient possibles dans l’environnement actuel.'
from public.exercises e
where e.movement_pattern = 'Jump'
on conflict (exercise_id, requirement_key) do update
set reason = excluded.reason;



-- SOURCE MIGRATION: 20260817205700_cold_start_generation_timeout_and_week_target_sync.sql
alter function public.d_generate_adaptive_session_v2(uuid,text,integer,text,text,text,text[],jsonb,text[],integer,text,integer,text,date,boolean,uuid[])
  set statement_timeout='15s';

create or replace function public.d_ensure_week_plan(
  p_user_id uuid,
  p_anchor_date date default current_date,
  p_force_rebuild boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path='public'
as $$
declare
  v_week date:=public.d_week_start(coalesce(p_anchor_date,current_date));
  v_target int;
  v_goal text;
  v_exists boolean;
  v_stored_target int;
  v_seq int;
  v_offset int;
  v_completed record;
  v_item_id uuid;
  v_existing_completed int:=0;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then
    raise exception 'Cannot create another user weekly plan';
  end if;

  select least(7,greatest(1,coalesce(weekly_session_target,3)))
  into v_target from public.profiles where id=p_user_id;
  if not found then raise exception 'Profile not found'; end if;
  v_goal:=public.d_primary_goal(p_user_id);

  update public.user_training_plan_items
  set status='unrealized',
      updated_at=now(),
      planning_context_json=(coalesce(planning_context_json,'{}'::jsonb)-'closed_by_new_week')
        || jsonb_build_object(
          'closed_week_unrealized',true,
          'recommended_date_is_soft',true,
          'user_debt_created',false
        )
  where user_id=p_user_id and week_start<v_week and status='available';

  update public.user_training_weeks w
  set status='closed',updated_at=now()
  where w.user_id=p_user_id and w.week_start<v_week and w.status='active'
    and not exists(
      select 1 from public.user_training_plan_items i
      join public.workout_sessions ws on ws.id=i.session_id
      where i.user_id=w.user_id and i.week_start=w.week_start and i.status='claimed'
        and ws.status in ('generated','in_progress')
    );

  select exists(
    select 1 from public.user_training_weeks where user_id=p_user_id and week_start=v_week
  ) into v_exists;

  if v_exists then
    select weekly_session_target into v_stored_target
    from public.user_training_weeks
    where user_id=p_user_id and week_start=v_week;
  end if;

  if v_exists
     and (p_force_rebuild or v_stored_target is distinct from v_target)
     and not exists(
       select 1 from public.user_training_plan_items
       where user_id=p_user_id and week_start=v_week and status in ('claimed','completed')
     ) then
    delete from public.user_training_plan_items where user_id=p_user_id and week_start=v_week;
    delete from public.user_training_weeks where user_id=p_user_id and week_start=v_week;
    v_exists:=false;
  end if;

  if not v_exists then
    insert into public.user_training_weeks(
      user_id,week_start,weekly_session_target,primary_goal,status,plan_version,context_json
    ) values (
      p_user_id,v_week,v_target,v_goal,'active','d1-weekly-loop-v1',
      jsonb_build_object(
        'created_from_anchor_date',p_anchor_date,
        'baseline_duration_minutes',45,
        'planned_not_generated',true,
        'recommended_dates_are_soft',true,
        'no_session_debt',true,
        'weekly_target_synced_from_profile',true
      )
    );

    for v_seq in 1..v_target loop
      v_offset:=public.d_plan_recommended_offset(v_seq,v_target);
      insert into public.user_training_plan_items(
        user_id,sequence_index,recommended_date,status,week_start,planned_focus,
        planned_target_region,planned_progression_intent,planned_duration_minutes,planning_context_json
      ) values (
        p_user_id,v_seq,v_week+v_offset,'available',v_week,v_goal,
        public.d_base_target_region(v_goal,v_seq),public.d_base_progression_intent(v_seq,v_target),45,
        jsonb_build_object(
          'plan_version','d1-weekly-loop-v1',
          'recommended_date_is_soft',true,
          'wod_pre_generated',false,
          'user_debt_created',false
        )
      );
    end loop;
  end if;

  for v_completed in
    select ws.id,ws.completed_at
    from public.workout_sessions ws
    where ws.user_id=p_user_id
      and ws.status='completed'
      and coalesce(ws.completed_at,ws.created_at)::date between v_week and v_week+6
      and not exists(select 1 from public.user_training_plan_items i where i.session_id=ws.id)
    order by coalesce(ws.completed_at,ws.created_at),ws.id
  loop
    select id into v_item_id
    from public.user_training_plan_items
    where user_id=p_user_id and week_start=v_week and status='available'
    order by sequence_index
    limit 1
    for update;
    exit when v_item_id is null;
    update public.user_training_plan_items set
      status='completed',session_id=v_completed.id,completed_at=v_completed.completed_at,
      claimed_at=coalesce(claimed_at,v_completed.completed_at),updated_at=now(),
      planning_context_json=planning_context_json||jsonb_build_object('backfilled_existing_session',true)
    where id=v_item_id;
    v_existing_completed:=v_existing_completed+1;
    v_item_id:=null;
  end loop;

  perform public.d_rebuild_weekly_stimulus_targets(p_user_id,v_week);

  return jsonb_build_object(
    'status','READY','version','d1-weekly-plan-v4-profile-target-sync','user_id',p_user_id,'week_start',v_week,
    'weekly_session_target',(select weekly_session_target from public.user_training_weeks where user_id=p_user_id and week_start=v_week),
    'primary_goal',(select primary_goal from public.user_training_weeks where user_id=p_user_id and week_start=v_week),
    'backfilled_completed_sessions',v_existing_completed,
    'recommended_dates_are_soft',true,
    'user_session_debt',false,
    'items',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',i.id,'sequence_index',i.sequence_index,'recommended_date',i.recommended_date,'status',i.status,
        'session_id',i.session_id,'planned_focus',i.planned_focus,'planned_target_region',i.planned_target_region,
        'planned_progression_intent',i.planned_progression_intent,'planned_duration_minutes',i.planned_duration_minutes,
        'planning_context',i.planning_context_json
      ) order by i.sequence_index)
      from public.user_training_plan_items i where i.user_id=p_user_id and i.week_start=v_week
    ),'[]'::jsonb)
  );
end;
$$;



-- SOURCE MIGRATION: 20260818134141_wod_roles_readability_and_uncovered_intent_v1.sql
alter table public.exercises add column if not exists display_name text;

alter table public.exercises drop constraint if exists exercises_wod_role_check;
update public.exercises set wod_role='wod' where wod_role in ('primary','secondary');
update public.exercises set wod_role='adaptation' where wod_role='accessory';
alter table public.exercises alter column wod_role set default 'wod';
alter table public.exercises add constraint exercises_wod_role_check check (wod_role in ('wod','adaptation','prep_only'));

update public.exercises
set display_name=regexp_replace(name,' classique$','','i')
where name ~* ' classique$' and display_name is null;

update public.exercises set display_name=case id
  when 'EX003' then 'Pompes inclinées'
  when 'EX009' then 'Push-ups'
  when 'EX033' then 'Air Squat'
  when 'EX071' then 'Pull-ups'
  when 'EX079' then 'Chest-to-Bar'
  when 'EX097' then 'Commandos'
  when 'EX110' then 'KB Swing'
  when 'EX111' then 'American KB Swing'
  when 'EX146' then 'Burpees'
  when 'EX203' then 'HSPU strict'
  when 'EX415' then 'Hip Dips'
  when 'EX450' then 'Pike Hold'
  when 'EX456' then 'Pike Push-up'
  when 'EX470' then 'Support Hold'
  when 'EX471' then 'Dips négatifs'
  when 'EX472' then 'Dips'
  when 'EX480' then 'Tuck L-Sit'
  when 'EX481' then 'L-Sit 1 jambe'
  when 'EX091' then 'L-Sit'
  else display_name end
where id in ('EX003','EX009','EX033','EX071','EX079','EX097','EX110','EX111','EX146','EX203','EX415','EX450','EX456','EX470','EX471','EX472','EX480','EX481','EX091');

create table if not exists public.user_uncovered_pattern_intents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  movement_pattern text not null,
  exercise_family text,
  source_session_id uuid references public.workout_sessions(id) on delete set null,
  source_exercise_id text references public.exercises(id) on delete set null,
  reason text not null default 'unavailable_today',
  priority smallint not null default 5 check (priority between 1 and 10),
  status text not null default 'active' check (status in ('active','resolved','expired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now()+interval '21 days'),
  resolved_at timestamptz,
  metadata_json jsonb not null default '{}'::jsonb
);

create index if not exists user_uncovered_pattern_intents_active_idx
  on public.user_uncovered_pattern_intents(user_id,movement_pattern,status,expires_at);

alter table public.user_uncovered_pattern_intents enable row level security;

drop policy if exists user_uncovered_pattern_intents_select_own on public.user_uncovered_pattern_intents;
create policy user_uncovered_pattern_intents_select_own on public.user_uncovered_pattern_intents
for select using (auth.uid()=user_id);

create or replace function public.record_uncovered_pattern_intent_v1(
  p_user_id uuid,
  p_session_id uuid,
  p_exercise_id text,
  p_reason text default 'unavailable_today'
) returns jsonb
language plpgsql
security definer
set search_path='public'
as $$
declare
  v_pattern text;
  v_family text;
  v_id uuid;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;
  select movement_pattern,exercise_family into v_pattern,v_family from public.exercises where id=p_exercise_id;
  if v_pattern is null then return jsonb_build_object('status','NO_PATTERN','exercise_id',p_exercise_id); end if;

  update public.user_uncovered_pattern_intents
  set priority=least(10,priority+1),
      source_session_id=p_session_id,
      source_exercise_id=p_exercise_id,
      exercise_family=v_family,
      reason=coalesce(nullif(p_reason,''),'unavailable_today'),
      expires_at=now()+interval '21 days',
      updated_at=now(),
      metadata_json=coalesce(metadata_json,'{}'::jsonb)||jsonb_build_object('last_recorded_at',now())
  where user_id=p_user_id and movement_pattern=v_pattern and status='active' and expires_at>now()
  returning id into v_id;

  if v_id is null then
    insert into public.user_uncovered_pattern_intents(user_id,movement_pattern,exercise_family,source_session_id,source_exercise_id,reason,priority,metadata_json)
    values(p_user_id,v_pattern,v_family,p_session_id,p_exercise_id,coalesce(nullif(p_reason,''),'unavailable_today'),5,jsonb_build_object('created_by','structural_fallback_v1'))
    returning id into v_id;
  end if;

  return jsonb_build_object('status','RECORDED','intent_id',v_id,'movement_pattern',v_pattern,'exercise_family',v_family,'soft_bias_only',true,'not_training_debt',true);
end;
$$;

create or replace function public.resolve_uncovered_pattern_intents_v1(
  p_user_id uuid,
  p_session_id uuid
) returns jsonb
language plpgsql
security definer
set search_path='public'
as $$
declare v_count int:=0;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;

  update public.user_uncovered_pattern_intents i
  set status='resolved',resolved_at=now(),updated_at=now(),
      metadata_json=coalesce(i.metadata_json,'{}'::jsonb)||jsonb_build_object('resolved_by_session_id',p_session_id)
  where i.user_id=p_user_id and i.status='active'
    and exists(
      select 1
      from public.exercise_logs l
      join public.exercises e on e.id=l.exercise_id
      where l.session_id=p_session_id and l.user_id=p_user_id
        and coalesce(l.user_execution_status,l.status,'completed') not in ('not_completed','skipped')
        and e.movement_pattern=i.movement_pattern
    );
  get diagnostics v_count=row_count;

  update public.user_uncovered_pattern_intents
  set status='expired',updated_at=now()
  where user_id=p_user_id and status='active' and expires_at<=now();

  return jsonb_build_object('status','SYNCED','resolved_count',v_count,'soft_bias_only',true,'not_training_debt',true);
end;
$$;

create or replace function public.c2_candidate_pool(
  p_user_id uuid,
  p_focus text,
  p_duration_minutes integer,
  p_readiness text,
  p_target_region text default null,
  p_progression_intent text default null,
  p_zone_terms text[] default '{}'::text[],
  p_inventory jsonb default '[]'::jsonb,
  p_usable_for text default 'WOD',
  p_max_complexity integer default 3,
  p_max_difficulty text default 'Intermédiaire',
  p_limit integer default 20
) returns table(
  exercise_id text, exercise_name text, movement_pattern text, exercise_family text, body_region text,
  candidate_score numeric, score_components jsonb, stimulus_proxy jsonb, prescription_simulation jsonb
)
language sql
stable
set search_path='public'
as $$
with base as (
  select * from public.c2_candidate_pool_pre_p2b(
    p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
    p_zone_terms,p_inventory,p_usable_for,p_max_complexity,p_max_difficulty,greatest(p_limit*4,80)
  )
), enriched as (
  select b.*,e.wod_role,e.selection_weight,e.technical_complexity,
    case when upper(coalesce(p_usable_for,'WOD'))='WOD' then
      case e.wod_role when 'wod' then 6 when 'adaptation' then -14 when 'prep_only' then -100 else 0 end
    else 0 end as role_bias,
    case when upper(coalesce(p_usable_for,'WOD'))='WOD' then
      greatest(-3::numeric,least(3::numeric,(coalesce(e.selection_weight,7)-7)*0.8 - greatest(0,coalesce(e.technical_complexity,3)-3)*0.4))
    else 0 end as readability_bias,
    case when upper(coalesce(p_usable_for,'WOD'))='WOD' then coalesce((
      select max(
        (case when i.movement_pattern=b.movement_pattern then 6 else 0 end)
        +(case when i.exercise_family is not null and i.exercise_family=b.exercise_family then 2 else 0 end)
      )
      from public.user_uncovered_pattern_intents i
      where i.user_id=p_user_id and i.status='active' and i.expires_at>now()
        and (i.movement_pattern=b.movement_pattern or (i.exercise_family is not null and i.exercise_family=b.exercise_family))
    ),0) else 0 end as uncovered_intent_bias
  from base b
  join public.exercises e on e.id=b.exercise_id
  where upper(coalesce(p_usable_for,'WOD'))<>'WOD' or e.wod_role<>'prep_only'
), scored as (
  select e.*,(e.candidate_score+e.role_bias+e.readability_bias+e.uncovered_intent_bias)::numeric as adjusted_score
  from enriched e
)
select s.exercise_id,s.exercise_name,s.movement_pattern,s.exercise_family,s.body_region,
       round(s.adjusted_score,2) as candidate_score,
       coalesce(s.score_components,'{}'::jsonb)||jsonb_build_object(
         'wod_role',s.wod_role,
         'wod_role_bias',round(s.role_bias,2),
         'readability_bias',round(s.readability_bias,2),
         'uncovered_pattern_soft_bias',round(s.uncovered_intent_bias,2),
         'uncovered_pattern_is_debt',false
       ) as score_components,
       s.stimulus_proxy,s.prescription_simulation
from scored s
order by s.adjusted_score desc,s.exercise_id
limit greatest(1,p_limit);
$$;

create or replace function public.c4_wod_role_contract_v1(p_candidate jsonb)
returns jsonb
language plpgsql
stable
set search_path='public'
as $$
declare n int; wod_count int; adaptation_count int; prep int;
begin
  select count(*),
         count(*) filter(where e.wod_role='wod'),
         count(*) filter(where e.wod_role='adaptation'),
         count(*) filter(where e.wod_role='prep_only')
  into n,wod_count,adaptation_count,prep
  from jsonb_array_elements(coalesce(p_candidate->'exercises','[]'::jsonb)) x
  join public.exercises e on e.id=x->>'exercise_id';

  return jsonb_build_object(
    'version','wod-role-contract-v3',
    'exercise_count',n,
    'wod_count',wod_count,
    'adaptation_count',adaptation_count,
    'prep_only_count',prep,
    'pass',prep=0 and wod_count>=1,
    'adaptation_allowed_as_last_resort',true,
    'prep_only_forbidden_in_wod',true,
    'rule','Prefer WOD movements; adaptation only when no compatible WOD replacement exists; PREP_ONLY never enters a WOD'
  );
end;
$$;

create or replace function public.c4_repair_wod_role_composition_v1(
  p_candidate jsonb,p_user_id uuid,p_focus text,p_duration_minutes integer,p_readiness text,p_target_region text,
  p_progression_intent text,p_zone_terms text[],p_inventory jsonb,p_max_complexity integer,p_max_difficulty text
) returns jsonb
language plpgsql
stable
set search_path='public'
as $$
declare
  r jsonb:=p_candidate; exs jsonb:=coalesce(p_candidate->'exercises','[]'::jsonb); n int:=jsonb_array_length(exs); idx int;
  item jsonb; role text; replacement jsonb; mech text:=upper(coalesce(p_candidate->>'mechanic','')); variant text:=upper(coalesce(p_candidate->>'variant_key',''));
  stimulus jsonb; repaired jsonb:='[]'::jsonb; wod_count int:=0; adaptation_count int:=0; prep_count int:=0;
begin
  if n=0 then return p_candidate; end if;
  stimulus:=public.build_session_stimulus_target(p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,'c1-default');

  for idx in 0..n-1 loop
    item:=exs->idx;
    select wod_role into role from public.exercises where id=item->>'exercise_id';
    if role='wod' then continue; end if;

    replacement:=null;
    select jsonb_build_object(
      'exercise_id',cp.exercise_id,'name',cp.exercise_name,'pattern',cp.movement_pattern,'family',cp.exercise_family,
      'candidate_score',cp.candidate_score,'components',cp.score_components,
      'prescription',public.c2_solver_prescription(p_user_id,cp.exercise_id,stimulus,mech,p_progression_intent,p_inventory),
      'mechanic_suitability',prof.profile
    ) into replacement
    from public.c2_candidate_pool(
      p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,p_zone_terms,p_inventory,
      'WOD',p_max_complexity,p_max_difficulty,120
    ) cp
    join public.exercises e on e.id=cp.exercise_id
    cross join lateral (select public.c4_exercise_mechanic_profile(p_user_id,cp.exercise_id,mech,nullif(variant,''),p_readiness,p_progression_intent) profile) prof
    where e.wod_role='wod'
      and coalesce((prof.profile->>'compatible')::boolean,false)
      and not exists(select 1 from jsonb_array_elements(exs) z where z->>'exercise_id'=cp.exercise_id)
    order by coalesce(nullif(prof.profile->>'suitability_score','')::numeric,0) desc,cp.candidate_score desc,cp.exercise_id
    limit 1;

    if replacement is not null then
      repaired:=repaired||jsonb_build_array(jsonb_build_object(
        'position',idx+1,'removed_exercise_id',item->>'exercise_id','replacement_exercise_id',replacement->>'exercise_id',
        'reason',case when role='prep_only' then 'prep_only_forbidden' else 'prefer_wod_over_adaptation' end
      ));
      exs:=jsonb_set(exs,array[idx::text],replacement,true);
    end if;
  end loop;

  select count(*) filter(where e.wod_role='wod'),count(*) filter(where e.wod_role='adaptation'),count(*) filter(where e.wod_role='prep_only')
  into wod_count,adaptation_count,prep_count
  from jsonb_array_elements(exs) x join public.exercises e on e.id=x->>'exercise_id';

  r:=jsonb_set(r,'{exercises}',exs,true);
  r:=jsonb_set(r,'{c4_wod_role_adapter}',jsonb_build_object(
    'version','wod-role-repair-v3','wod_count',wod_count,'adaptation_count',adaptation_count,'prep_only_count',prep_count,
    'repairs',repaired,'wod_first_attempted_for_every_non_wod_movement',true,
    'adaptation_used_only_if_no_compatible_wod_replacement',adaptation_count>0,
    'prep_only_cleared',prep_count=0
  ),true);
  return r;
end;
$$;

create or replace function public.complete_workout_session_v2(
  p_session_id uuid,p_global_rpe integer,p_post_workout_feeling integer,p_notes text default null,
  p_exercises jsonb default '[]'::jsonb,p_protocol_outcome jsonb default null
) returns jsonb
language plpgsql
security definer
set search_path='public'
as $$
declare
  v_result jsonb; v_item jsonb; v_instance_id uuid; v_extra jsonb; v_augmented int:=0; v_user_id uuid; v_intent_sync jsonb:='{}'::jsonb;
begin
  v_result:=public.complete_workout_session_v1(p_session_id,p_global_rpe,p_post_workout_feeling,p_notes,p_exercises,p_protocol_outcome);

  for v_item in select value from jsonb_array_elements(coalesce(p_exercises,'[]'::jsonb)) loop
    begin v_instance_id:=(v_item->>'session_exercise_id')::uuid; exception when others then continue; end;
    v_extra:=coalesce(v_item->'performance_actual_json','{}'::jsonb);
    if jsonb_typeof(v_extra)='object' and v_extra<>'{}'::jsonb then
      update public.exercise_logs
      set actual_json=jsonb_strip_nulls(coalesce(actual_json,'{}'::jsonb)||v_extra||jsonb_build_object('performance_actual_contract','m7.2-v1')),
          comparison_context_json=coalesce(comparison_context_json,'{}'::jsonb)||jsonb_build_object('performance_actual_contract','m7.2-v1')
      where session_id=p_session_id and session_exercise_id=v_instance_id and source_kind='internal';
      if found then v_augmented:=v_augmented+1; end if;
    end if;
  end loop;

  select user_id into v_user_id from public.workout_sessions where id=p_session_id;
  if v_user_id is not null then v_intent_sync:=public.resolve_uncovered_pattern_intents_v1(v_user_id,p_session_id); end if;

  return v_result||jsonb_build_object(
    'completion_contract','m7.2-atomic-completion-v2-uncovered-pattern-v1',
    'performance_actual_rows_augmented',v_augmented,
    'uncovered_pattern_intent_sync',v_intent_sync
  );
end;
$$;



-- SOURCE MIGRATION: 20260818134421_wod_structural_fallback_v1.sql
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



-- SOURCE MIGRATION: 20260818134956_wod_structural_fallback_confirmation_and_display_names_v1.sql
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



-- SOURCE MIGRATION: 20260818135317_fix_detach_recompiled_wod_instance_order_v1.sql
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

  -- La recompilation peut avoir réutilisé l'ID de l'exercice supprimé pour
  -- le mouvement qui a pris sa position. On détache cet ID pour que le front
  -- ne marque pas par erreur ce nouveau mouvement comme "adapté".
  -- Le WOD n'a pas encore démarré : aucun résultat d'exécution n'est perdu.
  delete from public.workout_session_exercises where id=p_old_instance_id;

  insert into public.workout_session_exercises(
    session_id,exercise_id,exercise_name,block_key,position,status,prescription,rounds,reps_completed,weight_kg,rpe,notes,
    created_at,updated_at,duration_seconds,distance_meters,prescription_json,expected_outcome_json,expected_rpe_min,expected_rpe_max,
    capacity_snapshot_json,solver_decision_json,user_execution_status,execution_reason_code
  ) values (
    r.session_id,r.exercise_id,r.exercise_name,r.block_key,r.position,r.status,r.prescription,r.rounds,r.reps_completed,r.weight_kg,r.rpe,r.notes,
    r.created_at,r.updated_at,r.duration_seconds,r.distance_meters,r.prescription_json,r.expected_outcome_json,r.expected_rpe_min,r.expected_rpe_max,
    r.capacity_snapshot_json,r.solver_decision_json,r.user_execution_status,r.execution_reason_code
  ) returning id into v_new_id;

  select generated_workout into v_generated
  from public.workout_sessions
  where id=p_session_id and user_id=p_user_id
  for update;

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



-- SOURCE MIGRATION: 20260818135542_compile_reduced_wod_for_alternative_mechanic_v1.sql
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

