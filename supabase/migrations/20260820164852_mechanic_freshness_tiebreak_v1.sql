update public.session_engine_policy
set config=jsonb_set(
  config,
  '{p2_variety,mechanic_freshness}',
  jsonb_build_object(
    'version','p2c-mechanic-freshness-v1',
    'recent_completed_window',5,
    'same_mechanic_trigger_count',3,
    'max_selection_score_delta',1.0,
    'max_base_quality_delta',5.0,
    'min_anti_redundancy_gain',10.0,
    'different_mechanic_only',true,
    'hard_gates_already_passed',true,
    'never_randomize',true,
    'higher_priority_tiebreaks_preserved',true
  ),
  true
)
where policy_key='c4-final-default';

create or replace function public.c4_apply_mechanic_freshness_tiebreak_v1(
  p_user_id uuid,
  p_result jsonb,
  p_policy_key text default 'c4-final-default'
)
returns jsonb
language plpgsql
stable
set search_path to 'public'
as $function$
declare
  r jsonb:=coalesce(p_result,'{}'::jsonb);
  cfg jsonb;
  selected jsonb:=p_result->'selected_candidate';
  candidate jsonb:=null;
  selected_mechanic text;
  selected_score numeric:=0;
  selected_base numeric:=0;
  selected_redundancy numeric:=0;
  candidate_score numeric:=0;
  candidate_base numeric:=0;
  candidate_redundancy numeric:=0;
  recent_window int:=5;
  trigger_count int:=3;
  max_selection_delta numeric:=1.0;
  max_base_delta numeric:=5.0;
  min_redundancy_gain numeric:=10.0;
  recent_total int:=0;
  recent_same int:=0;
  preserved_reason text:=null;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then
    raise exception 'Forbidden user';
  end if;

  if coalesce(r->>'status','')<>'READY' or selected is null then
    return r;
  end if;

  if coalesce((selected#>>'{p1d_protocol_retest_tiebreak,used}')::boolean,false) then
    preserved_reason:='P1D_PROTOCOL_RETEST';
  elsif coalesce((selected#>>'{c4_long_session_utilization_tiebreak,used}')::boolean,false) then
    preserved_reason:='LONG_SESSION_UTILIZATION';
  end if;

  select config into cfg
  from public.session_engine_policy
  where policy_key=p_policy_key;

  recent_window:=greatest(1,least(coalesce(nullif(cfg#>>'{p2_variety,mechanic_freshness,recent_completed_window}','')::int,5),8));
  trigger_count:=greatest(2,least(coalesce(nullif(cfg#>>'{p2_variety,mechanic_freshness,same_mechanic_trigger_count}','')::int,3),recent_window));
  max_selection_delta:=greatest(0,coalesce(nullif(cfg#>>'{p2_variety,mechanic_freshness,max_selection_score_delta}','')::numeric,1.0));
  max_base_delta:=greatest(0,coalesce(nullif(cfg#>>'{p2_variety,mechanic_freshness,max_base_quality_delta}','')::numeric,5.0));
  min_redundancy_gain:=greatest(0,coalesce(nullif(cfg#>>'{p2_variety,mechanic_freshness,min_anti_redundancy_gain}','')::numeric,10.0));

  selected_mechanic:=upper(coalesce(selected->>'mechanic',selected#>>'{c4_final,mechanic_json,mechanic_key}',''));
  selected_score:=coalesce(nullif(selected->>'c4_selection_score','')::numeric,0);
  selected_base:=coalesce(
    nullif(selected->>'p2_base_quality_score','')::numeric,
    coalesce(nullif(selected->>'coach_score','')::numeric,0)*0.65
      +coalesce(nullif(selected#>>'{c4_final,whole_wod_metrics,whole_wod_fit}','')::numeric,0)*0.35
  );
  selected_redundancy:=coalesce(nullif(selected#>>'{c4_anti_redundancy,score}','')::numeric,100);

  with recent as (
    select upper(coalesce(
      nullif(ws.mechanic_json->>'mechanic_key',''),
      nullif(ws.mechanic_json->>'mechanic',''),
      (select nullif(b->>'mechanic','')
       from jsonb_array_elements(coalesce(ws.generated_workout->'blocks','[]'::jsonb)) b
       where b->>'block_key'='wod'
       limit 1),
      ''
    )) as mechanic
    from public.workout_sessions ws
    where ws.user_id=p_user_id
      and ws.status='completed'
    order by coalesce(ws.completed_at,ws.generated_at,ws.created_at) desc
    limit recent_window
  )
  select count(*)::int,
         count(*) filter(where mechanic=selected_mechanic)::int
  into recent_total,recent_same
  from recent;

  if preserved_reason is not null then
    return jsonb_set(r,'{p2_mechanic_freshness_policy}',jsonb_build_object(
      'version','p2c-mechanic-freshness-v1','applied',false,'reason','HIGHER_PRIORITY_TIEBREAK_PRESERVED',
      'preserved_reason',preserved_reason,'recent_completed_window',recent_window,
      'recent_completed_sessions',recent_total,'same_mechanic_recent_count',recent_same,
      'selected_mechanic',selected_mechanic
    ),true);
  end if;

  if selected_mechanic='' or recent_same<trigger_count then
    return jsonb_set(r,'{p2_mechanic_freshness_policy}',jsonb_build_object(
      'version','p2c-mechanic-freshness-v1','applied',false,'reason','REPEAT_TRIGGER_NOT_REACHED',
      'recent_completed_window',recent_window,'same_mechanic_trigger_count',trigger_count,
      'recent_completed_sessions',recent_total,'same_mechanic_recent_count',recent_same,
      'selected_mechanic',nullif(selected_mechanic,'')
    ),true);
  end if;

  select x
  into candidate
  from jsonb_array_elements(coalesce(r->'accepted_candidates','[]'::jsonb)) x
  where upper(coalesce(x->>'mechanic',x#>>'{c4_final,mechanic_json,mechanic_key}',''))<>selected_mechanic
    and coalesce(nullif(x->>'c4_selection_score','')::numeric,0)>=selected_score-max_selection_delta
    and coalesce(
      nullif(x->>'p2_base_quality_score','')::numeric,
      coalesce(nullif(x->>'coach_score','')::numeric,0)*0.65
        +coalesce(nullif(x#>>'{c4_final,whole_wod_metrics,whole_wod_fit}','')::numeric,0)*0.35
    )>=selected_base-max_base_delta
    and coalesce(nullif(x#>>'{c4_anti_redundancy,score}','')::numeric,100)>=selected_redundancy+min_redundancy_gain
  order by
    coalesce(nullif(x->>'c4_selection_score','')::numeric,0) desc,
    coalesce(nullif(x#>>'{c4_anti_redundancy,score}','')::numeric,100) desc,
    coalesce(nullif(x->>'p2_base_quality_score','')::numeric,0) desc,
    upper(coalesce(x->>'mechanic','')),
    coalesce(x->>'p2_variety_signature','')
  limit 1;

  if candidate is null then
    return jsonb_set(r,'{p2_mechanic_freshness_policy}',jsonb_build_object(
      'version','p2c-mechanic-freshness-v1','applied',false,'reason','NO_NEAR_EQUIVALENT_FRESHER_MECHANIC',
      'recent_completed_window',recent_window,'same_mechanic_trigger_count',trigger_count,
      'recent_completed_sessions',recent_total,'same_mechanic_recent_count',recent_same,
      'selected_mechanic',selected_mechanic,
      'max_selection_score_delta',max_selection_delta,'max_base_quality_delta',max_base_delta,
      'min_anti_redundancy_gain',min_redundancy_gain
    ),true);
  end if;

  candidate_score:=coalesce(nullif(candidate->>'c4_selection_score','')::numeric,0);
  candidate_base:=coalesce(
    nullif(candidate->>'p2_base_quality_score','')::numeric,
    coalesce(nullif(candidate->>'coach_score','')::numeric,0)*0.65
      +coalesce(nullif(candidate#>>'{c4_final,whole_wod_metrics,whole_wod_fit}','')::numeric,0)*0.35
  );
  candidate_redundancy:=coalesce(nullif(candidate#>>'{c4_anti_redundancy,score}','')::numeric,100);

  candidate:=candidate||jsonb_build_object(
    'p2_mechanic_freshness_tiebreak',jsonb_build_object(
      'used',true,
      'version','p2c-mechanic-freshness-v1',
      'reason','different_mechanic_only_after_repetition_and_inside_bounded_quality_tradeoff',
      'previous_selected_mechanic',selected_mechanic,
      'selected_mechanic',upper(coalesce(candidate->>'mechanic',candidate#>>'{c4_final,mechanic_json,mechanic_key}','')),
      'recent_completed_window',recent_window,
      'same_mechanic_recent_count',recent_same,
      'same_mechanic_trigger_count',trigger_count,
      'previous_selection_score',round(selected_score,2),
      'selected_selection_score',round(candidate_score,2),
      'selection_score_delta',round(candidate_score-selected_score,2),
      'previous_base_quality',round(selected_base,2),
      'selected_base_quality',round(candidate_base,2),
      'base_quality_delta',round(candidate_base-selected_base,2),
      'previous_anti_redundancy',round(selected_redundancy,2),
      'selected_anti_redundancy',round(candidate_redundancy,2),
      'anti_redundancy_gain',round(candidate_redundancy-selected_redundancy,2),
      'hard_gates_already_passed',true,
      'never_randomize',true
    )
  );

  r:=jsonb_set(r,'{selected_candidate}',candidate,true);
  r:=jsonb_set(r,'{p2_mechanic_freshness_policy}',jsonb_build_object(
    'version','p2c-mechanic-freshness-v1','applied',true,
    'recent_completed_window',recent_window,'same_mechanic_trigger_count',trigger_count,
    'recent_completed_sessions',recent_total,'same_mechanic_recent_count',recent_same,
    'max_selection_score_delta',max_selection_delta,'max_base_quality_delta',max_base_delta,
    'min_anti_redundancy_gain',min_redundancy_gain,
    'different_mechanic_only',true,'hard_gates_already_passed',true,'never_randomize',true
  ),true);
  return r;
end;
$function$;

revoke all on function public.c4_apply_mechanic_freshness_tiebreak_v1(uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.c4_apply_mechanic_freshness_tiebreak_v1(uuid,jsonb,text) to postgres,service_role;

alter function public.solve_session_engine_c4_mechanic_policy_shadow_full_v1(uuid,text,integer,text,text,text,text[],jsonb,integer,text,integer,integer,text)
rename to solve_session_engine_c4_pre_mechanic_freshness_v1;

create or replace function public.solve_session_engine_c4_mechanic_policy_shadow_full_v1(
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
  p_candidate_count integer default 10,
  p_exact_wod_minutes integer default null,
  p_policy_key text default 'c4-final-default'
)
returns jsonb
language plpgsql
stable
set search_path to 'public'
as $function$
declare
  r jsonb;
begin
  r:=public.solve_session_engine_c4_pre_mechanic_freshness_v1(
    p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
    p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty,p_candidate_count,p_exact_wod_minutes,p_policy_key
  );
  r:=public.c4_apply_mechanic_freshness_tiebreak_v1(p_user_id,r,p_policy_key);
  return jsonb_set(r,'{version}','"c4-final-v1.10-p2c-mechanic-freshness"'::jsonb,true);
end;
$function$;

revoke all on function public.solve_session_engine_c4_mechanic_policy_shadow_full_v1(uuid,text,integer,text,text,text,text[],jsonb,integer,text,integer,integer,text) from public,anon,authenticated;
grant execute on function public.solve_session_engine_c4_mechanic_policy_shadow_full_v1(uuid,text,integer,text,text,text,text[],jsonb,integer,text,integer,integer,text) to postgres,service_role;
