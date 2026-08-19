create or replace function public.program_coach_skill_target_shadow_v1(
  p_user_id uuid,
  p_anchor_date date default current_date,
  p_session_context jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $$
declare
  v_anchor date:=coalesce(p_anchor_date,current_date);
  v_intent jsonb:=coalesce(p_session_context->'session_intent_shadow','{}'::jsonb);
  v_intent_key text:=upper(coalesce(v_intent->>'proposed_session_intent',''));
  v_intent_conf numeric:=coalesce(nullif(v_intent->>'confidence','')::numeric,0);
  v_readiness text:=lower(coalesce(p_session_context->>'readiness','normal'));
  v_target_region text:=nullif(p_session_context->>'target_region','');
  v_pattern text;
  v_pattern_conf numeric:=0;
  v_pattern_score numeric:=0;
  v_path record;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;
  if v_intent_key<>'SKILL_DEVELOPMENT' then
    return jsonb_build_object('version','skill-target-shadow-v1','mode','SHADOW','status','NOT_ELIGIBLE','reason','SESSION_INTENT_NOT_SKILL_DEVELOPMENT','session_intent',v_intent_key,'authority',jsonb_build_object('shadow_only',true,'may_change_skill',false,'may_change_session_decision',false));
  end if;
  if v_intent_conf<0.70 then
    return jsonb_build_object('version','skill-target-shadow-v1','mode','SHADOW','status','NOT_ELIGIBLE','reason','SESSION_INTENT_CONFIDENCE_TOO_LOW','session_intent',v_intent_key,'intent_confidence',round(v_intent_conf,2),'authority',jsonb_build_object('shadow_only',true,'may_change_skill',false,'may_change_session_decision',false));
  end if;
  if v_readiness in ('low','faible') then
    return jsonb_build_object('version','skill-target-shadow-v1','mode','SHADOW','status','NOT_ELIGIBLE','reason','LOW_READINESS_SKILL_TARGET_SUPPRESSED','session_intent',v_intent_key,'authority',jsonb_build_object('shadow_only',true,'may_change_skill',false,'may_change_session_decision',false));
  end if;
  select x->>'movement_pattern',coalesce(nullif(x->>'confidence','')::numeric,0),coalesce(nullif(x->>'priority_score','')::numeric,0)
  into v_pattern,v_pattern_conf,v_pattern_score
  from jsonb_array_elements(coalesce(v_intent#>'{targets,movement_pattern_priorities}','[]'::jsonb)) x
  where nullif(x->>'movement_pattern','') is not null
    and (upper(coalesce(x->>'role','')) in ('PRIORITY','DEVELOP','RECALIBRATE') or upper(coalesce(x->>'directive','')) in ('PROGRESS','DEVELOPMENT_PRIORITY','RECALIBRATE'))
    and coalesce(nullif(x->>'confidence','')::numeric,0)>=0.50
  order by coalesce(nullif(x->>'priority_score','')::numeric,0) desc,coalesce(nullif(x->>'confidence','')::numeric,0) desc,x->>'movement_pattern'
  limit 1;
  if v_pattern is null then
    return jsonb_build_object('version','skill-target-shadow-v1','mode','SHADOW','status','NO_TARGET','reason','NO_RELIABLE_PATTERN_PRIORITY','session_intent',v_intent_key,'authority',jsonb_build_object('shadow_only',true,'may_change_skill',false,'may_change_session_decision',false));
  end if;
  select sp.path_key,sp.display_name,sp.body_region,sp.selection_priority,
         count(distinct m.exercise_id) filter(where e.movement_pattern=v_pattern)::int exact_pattern_members,
         count(distinct m.exercise_id)::int total_members
  into v_path
  from public.skill_paths sp
  join public.skill_path_members m on m.path_key=sp.path_key and m.active
  join public.exercises e on e.id=m.exercise_id
  where sp.active
    and public.c4_skill_path_region_compatible_v1(sp.body_region,v_target_region)
    and exists(select 1 from public.skill_path_members mm join public.exercises ee on ee.id=mm.exercise_id where mm.path_key=sp.path_key and mm.active and ee.movement_pattern=v_pattern)
  group by sp.path_key,sp.display_name,sp.body_region,sp.selection_priority
  order by count(distinct m.exercise_id) filter(where e.movement_pattern=v_pattern) desc,sp.selection_priority desc,sp.path_key
  limit 1;
  if not found then
    return jsonb_build_object('version','skill-target-shadow-v1','mode','SHADOW','status','NO_TARGET','reason','NO_CURATED_SKILL_PATH_FOR_PATTERN','session_intent',v_intent_key,'target_movement_pattern',v_pattern,'pattern_confidence',round(v_pattern_conf,2),'pattern_priority_score',round(v_pattern_score,2),'authority',jsonb_build_object('shadow_only',true,'may_change_skill',false,'may_change_session_decision',false));
  end if;
  return jsonb_build_object('version','skill-target-shadow-v1','mode','SHADOW','status','PROPOSED','reason','RELIABLE_PATTERN_PRIORITY_MATCHED_TO_CURATED_SKILL_PATH','session_intent',v_intent_key,'intent_confidence',round(v_intent_conf,2),'target_movement_pattern',v_pattern,'pattern_confidence',round(v_pattern_conf,2),'pattern_priority_score',round(v_pattern_score,2),'target_path_key',v_path.path_key,'target_path_name',v_path.display_name,'target_path_region',v_path.body_region,'exact_pattern_member_count',v_path.exact_pattern_members,'path_member_count',v_path.total_members,'requires_today_feasibility_check',true,'authority',jsonb_build_object('shadow_only',true,'may_change_skill',false,'may_change_session_decision',false,'health_equipment_level_and_manual_continuity_override',true));
end;
$$;