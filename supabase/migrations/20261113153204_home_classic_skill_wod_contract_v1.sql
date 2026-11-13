-- UGEROD #26 HOME CLASSIC: reserve Skill and recompile WOD via existing C2/C4.
-- DEV migration version 20261113153204 recorded in Supabase.
-- This versioned SQL matches the live function definition; no W11 Composer change.
DO $guard$ BEGIN
 IF md5(pg_get_functiondef('public.c4_plan_full_session_pre_skill_focus_v2_shadow(uuid,text,integer,text,text,text,text[],jsonb,integer,text,integer,text)'::regprocedure))<>'c1fc6385f8e205fc49948b4b819553ba' THEN
   RAISE EXCEPTION 'Unexpected C4 pre-skill baseline; review before applying';
 END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.c4_plan_full_session_pre_skill_focus_v2_shadow(p_user_id uuid, p_focus text, p_duration_minutes integer, p_readiness text, p_target_region text DEFAULT NULL::text, p_progression_intent text DEFAULT NULL::text, p_zone_terms text[] DEFAULT '{}'::text[], p_inventory jsonb DEFAULT '[]'::jsonb, p_max_complexity integer DEFAULT 3, p_max_difficulty text DEFAULT 'Intermédiaire'::text, p_candidate_count integer DEFAULT 12, p_policy_key text DEFAULT 'c4-final-default'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_home_skill_target integer:=0;
  v_mechanic_apply boolean:=false;
  v_context_apply boolean:=false;
  v_context jsonb;
  v_intent jsonb;
  v_skill_target jsonb;
  v_intent_key text:='CLASSIC';
  v_plan jsonb;
  v_skill_app jsonb;
  v_anchor date:=public.ugerod_effective_session_anchor_date_v1();
begin
  if p_user_id is null then raise exception 'User required'; end if;
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;

  select
    coalesce((config#>>'{mechanic_policy,apply_enabled}')::boolean,false),
    coalesce((config#>>'{context_opportunity,apply_enabled}')::boolean,false)
  into v_mechanic_apply,v_context_apply
  from public.session_engine_policy
  where policy_key=p_policy_key;

  v_context:=jsonb_build_object(
    'status','READY',
    'focus',p_focus,
    'progression_intent',p_progression_intent,
    'target_region',p_target_region,
    'readiness',p_readiness,
    'duration_minutes',p_duration_minutes,
    'reason_codes','[]'::jsonb
  );

  v_intent:=public.program_coach_session_intent_shadow_v3(
    p_user_id,v_anchor,v_context,p_duration_minutes,p_readiness
  );
  v_context:=v_context||jsonb_build_object(
    'session_intent_v2',v_intent,
    'session_intent_shadow',v_intent
  );

  v_skill_target:=public.program_coach_skill_target_shadow_v2(
    p_user_id,v_anchor,v_context
  );
  v_intent_key:=upper(coalesce(v_intent->>'proposed_session_intent','CLASSIC'));

  if v_mechanic_apply then
    v_plan:=public.c4_plan_full_session_pre_preparation_v13_mechanic_policy_shadow(
      p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
      p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty,p_candidate_count,p_policy_key
    );
  elsif v_intent_key='CLASSIC' then
    v_plan:=public.c4_plan_full_session_pre_preparation_v13(
      p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
      p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty,p_candidate_count,p_policy_key
    );
  else
    v_plan:=public.c4_plan_full_session_pre_preparation_v13_mechanic_policy_shadow(
      p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
      p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty,p_candidate_count,p_policy_key
    );
  end if;

  if coalesce(v_plan->>'status','')<>'READY' then
    return v_plan||jsonb_build_object(
      'coach_v2_shadow',jsonb_build_object(
        'status','BASE_PLAN_NOT_READY',
        'session_intent',v_intent,
        'skill_target',v_skill_target
      )
    );
  end if;


  -- Ticket #26: HOME CLASSIC must reserve Skill before C4 recompiles the WOD.
  -- W11 Composer / Ma semaine is a separate authoritative compiler.
  if v_intent_key='CLASSIC' and p_duration_minutes>=30
     and public.normalize_session_environment_v1(
       coalesce(nullif(current_setting('ugerod.session_environment',true),''),'UNKNOWN'))='HOME'
     and not exists (
       select 1 from jsonb_array_elements(coalesce(v_plan->'blocks','[]'::jsonb)) b
       where b->>'block_key'='skill'
         and jsonb_array_length(coalesce(b->'exercises','[]'::jsonb))>0
     )
     and not exists (
       select 1 from public.user_skill_session_preferences usp
       where usp.user_id=p_user_id
         and usp.preference_date=public.ugerod_effective_session_anchor_date_v1()
         and usp.action='SKIP_SKILL'
         and (usp.expires_at is null or usp.expires_at>now())
     )
  then
    v_home_skill_target:=coalesce(
      (public.c4_session_architecture_targets_v2(p_duration_minutes,p_policy_key)->>'skill_target_minutes')::int,0);
    if v_home_skill_target<=0
       or jsonb_array_length(coalesce(v_plan->'blocks','[]'::jsonb))=0
       or (v_plan->'blocks'->(jsonb_array_length(v_plan->'blocks')-1))->>'block_key'<>'wod'
    then
      return v_plan||jsonb_build_object('status','NOT_READY','reason','HOME_CLASSIC_SKILL_SLOT_UNAVAILABLE');
    end if;

    v_plan:=jsonb_insert(v_plan,
      array['blocks',(jsonb_array_length(v_plan->'blocks')-1)::text],
      jsonb_build_object('block_key','skill','block_name','Skill / Development',
        'duration_minutes',v_home_skill_target,'required',true,'exercises','[]'::jsonb,
        'expected_outcome',jsonb_build_object('role','skill_development',
          'skill_reason','home_classic_preserved_before_c4_recompile',
          'pain_gate',true,'equipment_gate',true)),false);

    v_plan:=public.c4_apply_session_architecture_v2(
      p_user_id,v_plan,p_focus,p_duration_minutes,p_readiness,p_target_region,
      p_progression_intent,p_zone_terms,p_inventory,p_max_complexity,
      p_max_difficulty,p_candidate_count,p_policy_key);
    if coalesce(v_plan->>'status','')<>'READY'
       or not coalesce((v_plan#>>'{architecture,session_architecture_v2_contract,applied}')::boolean,false)
    then
      return v_plan||jsonb_build_object('status','NOT_READY','reason','HOME_CLASSIC_WOD_RECOMPILE_UNAVAILABLE');
    end if;

    v_plan:=public.c4_apply_skill_path_v2(p_user_id,v_plan,
      p_zone_terms,p_inventory,p_target_region,p_max_complexity,p_progression_intent,p_readiness);
    if not exists (
      select 1 from jsonb_array_elements(coalesce(v_plan->'blocks','[]'::jsonb)) b
      where b->>'block_key'='skill' and
        coalesce(nullif(b->>'duration_minutes','')::int,0)>0 and
        jsonb_array_length(coalesce(b->'exercises','[]'::jsonb))>0
    ) or coalesce((v_plan#>>'{architecture,planned_minutes}')::int,p_duration_minutes+1)>p_duration_minutes
    then
      return v_plan||jsonb_build_object('status','NOT_READY','reason','HOME_CLASSIC_SKILL_UNFEASIBLE');
    end if;
    v_plan:=public.c4_finalize_architecture_metadata_v2(v_plan);
    v_plan:=jsonb_set(v_plan,'{architecture,home_classic_skill_wod_guard}',
      jsonb_build_object('version','home-classic-skill-wod-v1',
        'recompiled',true,'skill_minutes',v_home_skill_target,
        'wod_revalidated_by_c4',true),true);
  end if;

  if coalesce(v_skill_target->>'status','')='PROPOSED' then
    v_plan:=public.c4_apply_skill_target_shadow_v1(
      p_user_id,v_plan,v_skill_target,p_zone_terms,p_inventory,p_target_region,
      p_max_complexity,p_progression_intent,p_readiness
    );
    v_skill_app:=coalesce(v_plan#>'{architecture,skill_target_shadow_application}','{}'::jsonb);
    if v_skill_app<>'{}'::jsonb then
      v_skill_app:=v_skill_app||jsonb_build_object(
        'mode','SHADOW_V2',
        'version','skill-target-v2-shadow-application'
      );
      v_plan:=jsonb_set(v_plan,'{architecture,skill_target_v2_application}',v_skill_app,true);
    end if;
  end if;

  v_plan:=public.c4_reinvest_available_time_v2(
    p_user_id,v_plan,v_intent_key,p_focus,p_duration_minutes,p_readiness,p_target_region,
    p_progression_intent,p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty,
    p_candidate_count,p_policy_key
  );

  v_plan:=public.c4_apply_pattern_complement_plan_v1(
    p_user_id,v_plan,
    v_context||jsonb_build_object('skill_target_shadow',v_skill_target),
    v_anchor,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
    p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty,p_candidate_count,p_policy_key
  );

  if v_context_apply then
    v_plan:=public.c4_apply_equipment_opportunity_v1(
      p_user_id,v_plan,v_context,v_anchor,p_focus,p_duration_minutes,p_readiness,p_target_region,
      p_progression_intent,p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty,
      p_candidate_count,p_policy_key
    );
  end if;

  v_plan:=public.c4_apply_local_fatigue_complement_v1(
    p_user_id,v_plan,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
    p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty,p_candidate_count,p_policy_key
  );
  if coalesce(v_plan->>'status','')<>'READY' then return v_plan; end if;

  v_plan:=public.c4_apply_preparation_quality_v3(
    p_user_id,v_plan,p_zone_terms,p_inventory,p_target_region,p_max_complexity,p_progression_intent
  );
  if coalesce(v_plan->>'status','')<>'READY' then return v_plan; end if;

  v_plan:=public.c4_finalize_skill_path_preparation_metadata_v1(v_plan);
  v_plan:=jsonb_set(v_plan,'{architecture,session_intent_v2}',v_intent,true);
  v_plan:=jsonb_set(v_plan,'{architecture,skill_target_v2}',v_skill_target,true);
  v_plan:=jsonb_set(v_plan,'{architecture,session_intent_v2_authority}','"SHADOW"'::jsonb,true);
  v_plan:=jsonb_set(v_plan,'{architecture,skill_target_v2_authority}','"SHADOW"'::jsonb,true);
  v_plan:=jsonb_set(v_plan,'{architecture,coach_v2_generation_authority}','false'::jsonb,true);
  return v_plan;
end;
$function$
