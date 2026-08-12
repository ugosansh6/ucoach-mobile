create or replace function public.d_generate_adaptive_session(
  p_user_id uuid,
  p_focus_override text,
  p_duration_minutes integer,
  p_readiness text,
  p_target_region_override text default null::text,
  p_progression_intent_override text default null::text,
  p_zone_terms text[] default '{}'::text[],
  p_inventory jsonb default '[]'::jsonb,
  p_available_equipment text[] default '{}'::text[],
  p_max_complexity integer default 3,
  p_max_difficulty text default 'Intermédiaire'::text,
  p_candidate_count integer default 12,
  p_policy_key text default 'c4-final-default'::text,
  p_anchor_date date default current_date
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_context jsonb;
  v_generated jsonb;
  v_session_id uuid;
  v_plan_item_id uuid;
  v_existing jsonb;
  v_anchor date:=coalesce(p_anchor_date,current_date);
  v_pi jsonb;
  v_initial_region text;
  v_plan_region text;
  v_actual_region text;
  v_attempted_regions text[]:='{}'::text[];
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;

  v_pi:=public.pi_refresh_coaching_directives(p_user_id,v_anchor,90);

  v_context:=public.d_resolve_session_context(
    p_user_id,v_anchor,p_duration_minutes,p_readiness,p_focus_override,p_target_region_override,p_progression_intent_override
  );

  if v_context->>'status'='RESUME_EXISTING' then
    select generated_workout into v_existing from public.workout_sessions
    where id=(v_context->>'resume_session_id')::uuid and user_id=p_user_id;
    return jsonb_build_object(
      'status','resume_existing','version','d1-adaptive-generation-v4-safe-region-fallback','session_id',(v_context->>'resume_session_id')::uuid,
      'weekly_loop',v_context,'generated_workout',coalesce(v_existing,'{}'::jsonb),
      'progression_intelligence',jsonb_build_object('frozen_session_unchanged',true,'runtime_refreshed',true)
    );
  end if;

  v_plan_item_id:=nullif(v_context->>'plan_item_id','')::uuid;
  v_initial_region:=nullif(v_context->>'target_region','');
  v_actual_region:=v_initial_region;
  if v_plan_item_id is not null then
    select planned_target_region into v_plan_region
    from public.user_training_plan_items
    where id=v_plan_item_id and user_id=p_user_id;
  end if;

  v_attempted_regions:=array_append(v_attempted_regions,coalesce(v_actual_region,'Full Body'));
  v_generated:=public.c4_generate_full_session(
    p_user_id,coalesce(v_context->>'focus',p_focus_override,'General Fitness'),p_duration_minutes,p_readiness,
    v_actual_region,nullif(v_context->>'progression_intent',''),p_zone_terms,p_inventory,p_available_equipment,
    p_max_complexity,p_max_difficulty,p_candidate_count,p_policy_key
  );

  if (coalesce(v_generated->>'status','')<>'generated' or nullif(v_generated->>'session_id','') is null)
     and v_plan_region in ('Upper','Lower','Core','Full Body')
     and v_plan_region is distinct from v_actual_region then
    v_actual_region:=v_plan_region;
    v_attempted_regions:=array_append(v_attempted_regions,v_actual_region);
    v_generated:=public.c4_generate_full_session(
      p_user_id,coalesce(v_context->>'focus',p_focus_override,'General Fitness'),p_duration_minutes,p_readiness,
      v_actual_region,nullif(v_context->>'progression_intent',''),p_zone_terms,p_inventory,p_available_equipment,
      p_max_complexity,p_max_difficulty,p_candidate_count,p_policy_key
    );
  end if;

  if (coalesce(v_generated->>'status','')<>'generated' or nullif(v_generated->>'session_id','') is null)
     and v_actual_region is distinct from 'Full Body' then
    v_actual_region:='Full Body';
    v_attempted_regions:=array_append(v_attempted_regions,v_actual_region);
    v_generated:=public.c4_generate_full_session(
      p_user_id,coalesce(v_context->>'focus',p_focus_override,'General Fitness'),p_duration_minutes,p_readiness,
      v_actual_region,nullif(v_context->>'progression_intent',''),p_zone_terms,p_inventory,p_available_equipment,
      p_max_complexity,p_max_difficulty,p_candidate_count,p_policy_key
    );
  end if;

  if coalesce(v_generated->>'status','')<>'generated' or nullif(v_generated->>'session_id','') is null then
    return v_generated||jsonb_build_object(
      'weekly_loop',v_context,
      'version','d1-adaptive-generation-v4-safe-region-fallback',
      'region_fallback',jsonb_build_object('requested_region',v_initial_region,'attempted_regions',to_jsonb(v_attempted_regions),'session_found',false)
    );
  end if;

  if v_actual_region is distinct from v_initial_region then
    v_context:=jsonb_set(v_context,'{target_region}',to_jsonb(v_actual_region),true);
    v_context:=jsonb_set(v_context,'{region_fallback}',jsonb_build_object(
      'requested_region',v_initial_region,
      'actual_region',v_actual_region,
      'attempted_regions',to_jsonb(v_attempted_regions),
      'silent',true,
      'reason','requested_or_planned_region_not_safe_or_coherent_with_today_context'
    ),true);
  end if;

  v_session_id:=(v_generated->>'session_id')::uuid;

  update public.workout_sessions set
    generation_local_date=v_anchor,
    planning_context_json=coalesce(planning_context_json,'{}'::jsonb)||jsonb_build_object(
      'weekly_loop',v_context,'weekly_loop_version','d1-weekly-loop-v1',
      'progression_intelligence',coalesce(v_context->'progression_intelligence','{}'::jsonb),
      'daily_refresh',jsonb_build_object('generation_local_date',v_anchor,'started_session_frozen_for_local_day_only',true)
    ),updated_at=now()
  where id=v_session_id and user_id=p_user_id;

  update public.workout_session_exercises wse
  set solver_decision_json=coalesce(wse.solver_decision_json,'{}'::jsonb)||jsonb_build_object(
    'progression_intelligence',public.pi_candidate_fit(p_user_id,wse.exercise_id,v_context->>'progression_intent')
  )
  where wse.session_id=v_session_id;

  if v_plan_item_id is not null then
    update public.user_training_plan_items set
      status='claimed',session_id=v_session_id,claimed_at=now(),updated_at=now(),
      planning_context_json=planning_context_json||jsonb_build_object('claimed_session_id',v_session_id,'claimed_at',now(),'resolved_context',v_context)
    where id=v_plan_item_id and user_id=p_user_id and status='available';
    if not found then raise exception 'Weekly plan item could not be claimed'; end if;
  end if;

  perform public.d_sync_session_stimulus_ledger(v_session_id);

  return v_generated||jsonb_build_object(
    'version','d1-adaptive-generation-v4-safe-region-fallback','weekly_loop',v_context,
    'progression_intelligence',coalesce(v_context->'progression_intelligence','{}'::jsonb),
    'region_fallback',coalesce(v_context->'region_fallback','{}'::jsonb),
    'meta',coalesce(v_generated->'meta','{}'::jsonb)||jsonb_build_object(
      'weekly_loop',v_context,'weekly_loop_version','d1-weekly-loop-v1','generation_local_date',v_anchor,
      'progression_intelligence_version',v_pi->>'version'
    )
  );
end;
$function$;

revoke all on function public.d_generate_adaptive_session(uuid,text,integer,text,text,text,text[],jsonb,text[],integer,text,integer,text,date) from public,anon;
grant execute on function public.d_generate_adaptive_session(uuid,text,integer,text,text,text,text[],jsonb,text[],integer,text,integer,text,date) to authenticated,service_role;;
