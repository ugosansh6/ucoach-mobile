do $$
declare v_def text;
begin
  if to_regprocedure('public.c4_plan_full_session_pre_session_intent_active_v1(uuid,text,integer,text,text,text,text[],jsonb,integer,text,integer,text)') is null then
    select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='c4_plan_full_session'
    limit 1;
    v_def:=replace(v_def,'FUNCTION public.c4_plan_full_session(','FUNCTION public.c4_plan_full_session_pre_session_intent_active_v1(');
    execute v_def;
  end if;

  if to_regprocedure('public.d_resolve_session_context_v6_pre_session_intent_active_v1(uuid,date,integer,text,text,text,text,text[],text[],boolean)') is null then
    select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='d_resolve_session_context_v6'
    limit 1;
    v_def:=replace(v_def,'FUNCTION public.d_resolve_session_context_v6(','FUNCTION public.d_resolve_session_context_v6_pre_session_intent_active_v1(');
    execute v_def;
  end if;
end $$;

create or replace function public.program_coach_session_intent_v1(
  p_user_id uuid,
  p_anchor_date date default current_date,
  p_session_context jsonb default '{}'::jsonb,
  p_duration_minutes integer default 45,
  p_readiness text default 'normal'
) returns jsonb
language plpgsql stable security definer set search_path='public'
as $$
declare r jsonb;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;
  r:=public.program_coach_session_intent_shadow_v1(p_user_id,p_anchor_date,p_session_context,p_duration_minutes,p_readiness);
  if coalesce(r->>'status','')='PROPOSED' then
    r:=jsonb_set(r,'{mode}','"ACTIVE"'::jsonb,true);
    r:=jsonb_set(r,'{version}','"session-intent-v1"'::jsonb,true);
    r:=jsonb_set(r,'{authority}',jsonb_build_object(
      'shadow_only',false,
      'may_change_session_decision',true,
      'may_change_focus',false,
      'may_change_progression_intent',false,
      'may_change_block_budget',false,
      'may_change_exercise_selection',true,
      'session_coach_remains_safety_authority',true,
      'health_equipment_readiness_override',true
    ),true);
  end if;
  return r;
end $$;

revoke all on function public.program_coach_session_intent_v1(uuid,date,jsonb,integer,text) from public,anon;
grant execute on function public.program_coach_session_intent_v1(uuid,date,jsonb,integer,text) to authenticated,service_role;

create or replace function public.program_coach_skill_target_v1(
  p_user_id uuid,
  p_anchor_date date default current_date,
  p_session_context jsonb default '{}'::jsonb
) returns jsonb
language plpgsql stable security definer set search_path='public'
as $$
declare r jsonb; c jsonb:=coalesce(p_session_context,'{}'::jsonb);
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;
  if c->'session_intent' is not null then
    c:=jsonb_set(c,'{session_intent_shadow}',c->'session_intent',true);
  end if;
  r:=public.program_coach_skill_target_shadow_v1(p_user_id,p_anchor_date,c);
  r:=jsonb_set(r,'{mode}','"ACTIVE"'::jsonb,true);
  r:=jsonb_set(r,'{version}','"skill-target-v1"'::jsonb,true);
  if coalesce(r->>'status','')='PROPOSED' then
    r:=jsonb_set(r,'{authority}',jsonb_build_object(
      'shadow_only',false,
      'may_change_skill',true,
      'may_change_session_decision',true,
      'health_equipment_level_and_manual_continuity_override',true
    ),true);
  end if;
  return r;
end $$;

revoke all on function public.program_coach_skill_target_v1(uuid,date,jsonb) from public,anon;
grant execute on function public.program_coach_skill_target_v1(uuid,date,jsonb) to authenticated,service_role;

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
language plpgsql stable set search_path='public'
as $$
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

  v_plan:=public.c4_apply_preparation_quality_v3(
    p_user_id,v_plan,p_zone_terms,p_inventory,p_target_region,p_max_complexity,p_progression_intent
  );
  if coalesce(v_plan->>'status','')<>'READY' then return v_plan; end if;
  v_plan:=public.c4_finalize_skill_path_preparation_metadata_v1(v_plan);

  v_plan:=jsonb_set(v_plan,'{architecture,session_intent}',v_intent,true);
  v_plan:=jsonb_set(v_plan,'{architecture,skill_target}',v_skill_target,true);
  v_plan:=jsonb_set(v_plan,'{architecture,session_intent_authority}','"ACTIVE"'::jsonb,true);
  v_plan:=jsonb_set(v_plan,'{architecture,mechanic_policy_active}',to_jsonb(v_intent_key<>'CLASSIC'),true);
  v_plan:=jsonb_set(v_plan,'{architecture,pattern_complement_authority}','"SHADOW"'::jsonb,true);
  return v_plan;
end $$;

create or replace function public.d_resolve_session_context_v6(
  p_user_id uuid,
  p_anchor_date date default current_date,
  p_duration_minutes integer default 45,
  p_readiness text default 'normal',
  p_focus_override text default null,
  p_target_region_override text default null,
  p_progression_intent_override text default null,
  p_available_equipment text[] default '{}'::text[],
  p_zone_terms text[] default '{}'::text[],
  p_force_recalculate_started boolean default false
) returns jsonb
language plpgsql security definer set search_path='public'
as $$
declare
  r jsonb;
  v_apply boolean:=false;
  v_intent jsonb;
  v_skill jsonb;
begin
  r:=public.d_resolve_session_context_v6_pre_session_intent_active_v1(
    p_user_id,p_anchor_date,p_duration_minutes,p_readiness,p_focus_override,p_target_region_override,
    p_progression_intent_override,p_available_equipment,p_zone_terms,p_force_recalculate_started
  );

  select coalesce((config#>>'{session_intent,apply_enabled}')::boolean,false)
  into v_apply from public.session_engine_policy where policy_key='c4-final-default';

  if v_apply and coalesce(r->>'status','')='READY' then
    v_intent:=public.program_coach_session_intent_v1(p_user_id,p_anchor_date,r,p_duration_minutes,p_readiness);
    r:=r||jsonb_build_object('session_intent',v_intent,'session_intent_applied',true);
    v_skill:=public.program_coach_skill_target_v1(p_user_id,p_anchor_date,r||jsonb_build_object('session_intent',v_intent));
    r:=r||jsonb_build_object('skill_target',v_skill,'skill_target_applied',coalesce(v_skill->>'status','')='PROPOSED');
  else
    r:=r||jsonb_build_object('session_intent_applied',false);
  end if;
  return r;
end $$;

update public.session_engine_policy
set config=jsonb_set(
  jsonb_set(
    jsonb_set(
      config,
      '{session_intent}',
      jsonb_build_object(
        'enabled',true,
        'version','session-intent-v1',
        'shadow_mode',false,
        'apply_enabled',true,
        'authority','TYPE_OF_WORK_TODAY',
        'safety_override',true,
        'pattern_complement_remains_shadow',true
      ),true
    ),
    '{mechanic_policy,apply_enabled}','true'::jsonb,true
  ),
  '{mechanic_policy,shadow_mode}','false'::jsonb,true
), updated_at=now()
where policy_key='c4-final-default';

revoke all on function public.c4_plan_full_session(uuid,text,integer,text,text,text,text[],jsonb,integer,text,integer,text) from public,anon;
grant execute on function public.c4_plan_full_session(uuid,text,integer,text,text,text,text[],jsonb,integer,text,integer,text) to authenticated,service_role;
revoke all on function public.d_resolve_session_context_v6(uuid,date,integer,text,text,text,text,text[],text[],boolean) from public,anon;
grant execute on function public.d_resolve_session_context_v6(uuid,date,integer,text,text,text,text,text[],text[],boolean) to authenticated,service_role;