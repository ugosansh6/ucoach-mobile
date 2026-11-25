create or replace function public.c4_plan_full_session_pre_p3_activation_v1(
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
language plpgsql
stable
set search_path to 'public'
as $function$
declare
  v_apply boolean:=false;
  v_context jsonb;
  v_intent jsonb;
  v_skill_target jsonb;
  v_intent_key text:='CLASSIC';
  v_plan jsonb;
  v_skill_app jsonb;
begin
  select coalesce((config#>>'{session_intent,apply_enabled}')::boolean,false)
  into v_apply from public.session_engine_policy where policy_key=p_policy_key;

  if not v_apply then
    return public.c4_plan_full_session_pre_session_intent_active_v1(
      p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
      p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty,p_candidate_count,p_policy_key
    );
  end if;

  v_context:=jsonb_build_object(
    'status','READY','focus',p_focus,'progression_intent',p_progression_intent,
    'target_region',p_target_region,'readiness',p_readiness
  );
  v_intent:=public.program_coach_session_intent_v1(
    p_user_id,current_date,v_context,p_duration_minutes,p_readiness
  );
  v_context:=v_context||jsonb_build_object('session_intent',v_intent,'session_intent_shadow',v_intent);
  v_skill_target:=public.program_coach_skill_target_v1(p_user_id,current_date,v_context);
  v_intent_key:=upper(coalesce(v_intent->>'proposed_session_intent','CLASSIC'));

  if v_intent_key='CLASSIC' then
    v_plan:=public.c4_plan_full_session_pre_preparation_v12(
      p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
      p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty,p_candidate_count,p_policy_key
    );
  else
    v_plan:=public.c4_plan_full_session_pre_preparation_v12_mechanic_policy_shadow(
      p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
      p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty,p_candidate_count,p_policy_key
    );
  end if;

  if coalesce(v_plan->>'status','')<>'READY' then return v_plan; end if;

  if coalesce(v_skill_target->>'status','')='PROPOSED' then
    v_plan:=public.c4_apply_skill_target_shadow_v1(
      p_user_id,v_plan,v_skill_target,p_zone_terms,p_inventory,p_target_region,
      p_max_complexity,p_progression_intent,p_readiness
    );
    v_skill_app:=coalesce(v_plan#>'{architecture,skill_target_shadow_application}','{}'::jsonb);
    if v_skill_app<>'{}'::jsonb then
      v_skill_app:=jsonb_set(v_skill_app,'{mode}','"ACTIVE"'::jsonb,true);
      v_skill_app:=jsonb_set(v_skill_app,'{version}','"skill-target-application-v1"'::jsonb,true);
      v_plan:=jsonb_set(v_plan,'{architecture,skill_target_application}',v_skill_app,true);
    end if;
  end if;

  v_plan:=public.c4_reinvest_available_time_v1(
    p_user_id,v_plan,v_intent_key,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,p_zone_terms,p_inventory,
    p_max_complexity,p_max_difficulty,p_candidate_count,p_policy_key
  );

  v_plan:=public.c4_apply_pattern_complement_plan_v1(
    p_user_id,v_plan,v_context||jsonb_build_object('session_intent_shadow',v_intent,'skill_target_shadow',v_skill_target),
    current_date,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,p_zone_terms,p_inventory,
    p_max_complexity,p_max_difficulty,p_candidate_count,p_policy_key
  );

  v_plan:=public.c4_apply_preparation_quality_v3(
    p_user_id,v_plan,p_zone_terms,p_inventory,p_target_region,p_max_complexity,p_progression_intent
  );
  if coalesce(v_plan->>'status','')<>'READY' then return v_plan; end if;
  v_plan:=public.c4_finalize_skill_path_preparation_metadata_v1(v_plan);

  v_plan:=jsonb_set(v_plan,'{architecture,session_intent}',v_intent,true);
  v_plan:=jsonb_set(v_plan,'{architecture,skill_target}',v_skill_target,true);
  v_plan:=jsonb_set(v_plan,'{architecture,session_intent_authority}','"ACTIVE"'::jsonb,true);
  v_plan:=jsonb_set(v_plan,'{architecture,mechanic_policy_active}',to_jsonb(v_intent_key<>'CLASSIC'),true);
  v_plan:=jsonb_set(v_plan,'{architecture,pattern_complement_authority}','"ACTIVE"'::jsonb,true);
  return v_plan;
end;
$function$;

create or replace function public.c4_plan_full_session(
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
language plpgsql
stable
set search_path to 'public'
as $function$
declare
  v_apply boolean:=false;
  v_mechanic_apply boolean:=false;
  v_context_apply boolean:=false;
  v_context jsonb;
  v_intent jsonb;
  v_skill_target jsonb;
  v_intent_key text:='CLASSIC';
  v_plan jsonb;
  v_skill_app jsonb;
begin
  select
    coalesce((config#>>'{session_intent,apply_enabled}')::boolean,false),
    coalesce((config#>>'{mechanic_policy,apply_enabled}')::boolean,false),
    coalesce((config#>>'{context_opportunity,apply_enabled}')::boolean,false)
  into v_apply,v_mechanic_apply,v_context_apply
  from public.session_engine_policy where policy_key=p_policy_key;

  if not v_apply then
    return public.c4_plan_full_session_pre_session_intent_active_v1(
      p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
      p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty,p_candidate_count,p_policy_key
    );
  end if;

  v_context:=jsonb_build_object(
    'status','READY','focus',p_focus,'progression_intent',p_progression_intent,
    'target_region',p_target_region,'readiness',p_readiness
  );
  v_intent:=public.program_coach_session_intent_v1(
    p_user_id,current_date,v_context,p_duration_minutes,p_readiness
  );
  v_context:=v_context||jsonb_build_object('session_intent',v_intent,'session_intent_shadow',v_intent);
  v_skill_target:=public.program_coach_skill_target_v1(p_user_id,current_date,v_context);
  v_intent_key:=upper(coalesce(v_intent->>'proposed_session_intent','CLASSIC'));

  if v_mechanic_apply then
    v_plan:=public.c4_plan_full_session_pre_preparation_v12_mechanic_policy_shadow(
      p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
      p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty,p_candidate_count,p_policy_key
    );
  elsif v_intent_key='CLASSIC' then
    v_plan:=public.c4_plan_full_session_pre_preparation_v12(
      p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
      p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty,p_candidate_count,p_policy_key
    );
  else
    v_plan:=public.c4_plan_full_session_pre_preparation_v12_mechanic_policy_shadow(
      p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
      p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty,p_candidate_count,p_policy_key
    );
  end if;

  if coalesce(v_plan->>'status','')<>'READY' then return v_plan; end if;

  if coalesce(v_skill_target->>'status','')='PROPOSED' then
    v_plan:=public.c4_apply_skill_target_shadow_v1(
      p_user_id,v_plan,v_skill_target,p_zone_terms,p_inventory,p_target_region,
      p_max_complexity,p_progression_intent,p_readiness
    );
    v_skill_app:=coalesce(v_plan#>'{architecture,skill_target_shadow_application}','{}'::jsonb);
    if v_skill_app<>'{}'::jsonb then
      v_skill_app:=jsonb_set(v_skill_app,'{mode}','"ACTIVE"'::jsonb,true);
      v_skill_app:=jsonb_set(v_skill_app,'{version}','"skill-target-application-v1"'::jsonb,true);
      v_plan:=jsonb_set(v_plan,'{architecture,skill_target_application}',v_skill_app,true);
    end if;
  end if;

  v_plan:=public.c4_reinvest_available_time_v1(
    p_user_id,v_plan,v_intent_key,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,p_zone_terms,p_inventory,
    p_max_complexity,p_max_difficulty,p_candidate_count,p_policy_key
  );

  v_plan:=public.c4_apply_pattern_complement_plan_v1(
    p_user_id,v_plan,v_context||jsonb_build_object('session_intent_shadow',v_intent,'skill_target_shadow',v_skill_target),
    current_date,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,p_zone_terms,p_inventory,
    p_max_complexity,p_max_difficulty,p_candidate_count,p_policy_key
  );

  if v_context_apply then
    v_plan:=public.c4_apply_equipment_opportunity_v1(
      p_user_id,v_plan,v_context,current_date,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
      p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty,p_candidate_count,p_policy_key
    );
  end if;

  v_plan:=public.c4_apply_preparation_quality_v3(
    p_user_id,v_plan,p_zone_terms,p_inventory,p_target_region,p_max_complexity,p_progression_intent
  );
  if coalesce(v_plan->>'status','')<>'READY' then return v_plan; end if;
  v_plan:=public.c4_finalize_skill_path_preparation_metadata_v1(v_plan);

  v_plan:=jsonb_set(v_plan,'{architecture,session_intent}',v_intent,true);
  v_plan:=jsonb_set(v_plan,'{architecture,skill_target}',v_skill_target,true);
  v_plan:=jsonb_set(v_plan,'{architecture,session_intent_authority}','"ACTIVE"'::jsonb,true);
  v_plan:=jsonb_set(v_plan,'{architecture,mechanic_policy_active}',to_jsonb(v_mechanic_apply),true);
  v_plan:=jsonb_set(v_plan,'{architecture,pattern_complement_authority}','"ACTIVE"'::jsonb,true);
  v_plan:=jsonb_set(v_plan,'{architecture,equipment_opportunity_authority}',to_jsonb(case when v_context_apply then 'ACTIVE' else 'OFF' end),true);
  return v_plan;
end;
$function$;

update public.session_engine_policy
set config = jsonb_set(
              jsonb_set(
                jsonb_set(
                  jsonb_set(
                    config,
                    '{program_coach,shadow_mode}','false'::jsonb,true
                  ),
                  '{mechanic_policy,version}',to_jsonb('mechanic-policy-v1'::text),true
                ),
                '{mechanic_policy,feature_flag_note}',to_jsonb('active search expansion for all session intents; final C4 hard gates and scoring remain authoritative'::text),true
              ),
              '{context_opportunity}',
              coalesce(config->'context_opportunity','{}'::jsonb)||jsonb_build_object(
                'enabled',true,
                'version','context-opportunity-v1',
                'shadow_mode',false,
                'apply_enabled',true,
                'present_equipment_opportunity',true,
                'quality_delta_floor',-1.0,
                'max_equipment_driven_training_exercises',1,
                'hard_gates_override',true
              ),
              true
            ),
    updated_at=now()
where policy_key='c4-final-default';
