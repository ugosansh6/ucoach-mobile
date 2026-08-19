-- Context Opportunity SHADOW v1
-- Detects equipment/environment that would materially improve a targeted future session.
-- It never blocks the current session and never writes unmet-priority memory in SHADOW.

create or replace function public.program_coach_context_opportunity_shadow_v1(
  p_user_id uuid,
  p_anchor_date date,
  p_session_context jsonb,
  p_session_intent_shadow jsonb,
  p_inventory jsonb
)
returns jsonb
language plpgsql
stable
set search_path to 'public'
as $function$
declare
  v_anchor date:=coalesce(p_anchor_date,current_date);
  v_intent text:=upper(coalesce(nullif(p_session_intent_shadow->>'proposed_session_intent',''),'CLASSIC'));
  v_intent_confidence numeric:=coalesce(nullif(p_session_intent_shadow->>'confidence','')::numeric,0);
  v_target_patterns text[]:='{}'::text[];
  v_training_focus text:=null;
  v_current_compatible int:=0;
  v_equipment jsonb:='[]'::jsonb;
  v_environment jsonb:='[]'::jsonb;
  v_memory jsonb:='[]'::jsonb;
  v_high_value_count int:=0;
  v_status text:='NO_HIGH_VALUE_CONTEXT_IDENTIFIED';
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then
    raise exception 'Forbidden user';
  end if;

  if coalesce(p_session_context->>'status','')<>'READY' then
    return jsonb_build_object(
      'version','context-opportunity-shadow-v1',
      'mode','SHADOW',
      'status','NOT_ELIGIBLE',
      'reason','SESSION_CONTEXT_NOT_READY',
      'authority',jsonb_build_object('shadow_only',true,'may_change_session_decision',false)
    );
  end if;

  select coalesce(array_agg(distinct nullif(x->>'movement_pattern','')) filter(where nullif(x->>'movement_pattern','') is not null),'{}'::text[])
  into v_target_patterns
  from jsonb_array_elements(coalesce(p_session_intent_shadow#>'{targets,movement_pattern_priorities}','[]'::jsonb)) x;

  v_training_focus:=case v_intent
    when 'STRENGTH_QUALITY' then 'Strength'
    when 'CONDITIONING' then 'Conditioning'
    else null
  end;

  -- Broad CLASSIC/calibration and CONSOLIDATE should not nag for more equipment.
  if v_intent not in ('STRENGTH_QUALITY','SKILL_DEVELOPMENT','CONDITIONING') then
    select coalesce(jsonb_agg(jsonb_build_object(
      'movement_pattern',movement_pattern,'exercise_family',exercise_family,
      'reason',reason,'priority',priority,'expires_at',expires_at
    ) order by priority desc,updated_at desc),'[]'::jsonb)
    into v_memory
    from public.user_uncovered_pattern_intents
    where user_id=p_user_id and status='active' and expires_at>now();

    return jsonb_build_object(
      'version','context-opportunity-shadow-v1',
      'mode','SHADOW',
      'status','NO_HIGH_VALUE_CONTEXT_IDENTIFIED',
      'session_intent',v_intent,
      'equipment_opportunities','[]'::jsonb,
      'environment_opportunities','[]'::jsonb,
      'active_uncovered_priority_memory',v_memory,
      'future_user_recommendation_eligible',false,
      'required_level_policy',jsonb_build_object(
        'required_emitted_by_base_v1',false,
        'reserved_for_explicit_program_or_skill_target',true
      ),
      'memory_contract',jsonb_build_object(
        'reuse_table','user_uncovered_pattern_intents',
        'future_reason','program_context_unavailable',
        'writes_enabled_in_shadow',false
      ),
      'authority',jsonb_build_object(
        'shadow_only',true,'may_change_session_decision',false,
        'may_require_equipment',false,'may_write_priority_memory',false
      )
    );
  end if;

  -- Count how much of the targeted work is already feasible with today's inventory.
  select count(*)::int
  into v_current_compatible
  from public.exercises e
  where (('Skill'=any(coalesce(e.usable_for,'{}'::text[]))) or ('WOD'=any(coalesce(e.usable_for,'{}'::text[]))))
    and (
      (v_intent='SKILL_DEVELOPMENT' and cardinality(v_target_patterns)>0 and e.movement_pattern=any(v_target_patterns))
      or (v_intent='STRENGTH_QUALITY' and e.training_focus='Strength')
      or (v_intent='CONDITIONING' and e.training_focus='Conditioning')
    )
    and public.exercise_equipment_compatible(e.id,coalesce(p_inventory,'[]'::jsonb));

  with present_equipment as (
    select distinct x->>'equipment_id' equipment_id
    from jsonb_array_elements(coalesce(p_inventory,'[]'::jsonb)) x
    where nullif(x->>'equipment_id','') is not null
  ), relevant as (
    select e.id,e.movement_pattern,e.training_focus
    from public.exercises e
    where (('Skill'=any(coalesce(e.usable_for,'{}'::text[]))) or ('WOD'=any(coalesce(e.usable_for,'{}'::text[]))))
      and (
        (v_intent='SKILL_DEVELOPMENT' and cardinality(v_target_patterns)>0 and e.movement_pattern=any(v_target_patterns))
        or (v_intent='STRENGTH_QUALITY' and e.training_focus='Strength')
        or (v_intent='CONDITIONING' and e.training_focus='Conditioning')
      )
      and not public.exercise_equipment_compatible(e.id,coalesce(p_inventory,'[]'::jsonb))
  ), opportunities as (
    select eq.category,
           count(distinct r.id)::int unlockable_exercises,
           jsonb_agg(distinct jsonb_build_object('equipment_id',eq.id,'name',eq.name)) missing_equipment
    from relevant r
    join public.exercise_equipment_requirements_v2 req on req.exercise_id=r.id and not req.is_optional
    join public.equipment eq on eq.id=req.equipment_id
    where not exists(select 1 from present_equipment pe where pe.equipment_id=eq.id)
    group by eq.category
  ), ranked as (
    select *,
      case
        when v_intent='STRENGTH_QUALITY' and category='Poids libre' and unlockable_exercises>=3 then 'HIGH_VALUE'
        when v_intent='SKILL_DEVELOPMENT' and unlockable_exercises>=2 and v_current_compatible<4 then 'HIGH_VALUE'
        when v_intent='CONDITIONING' and category='Cardio' and unlockable_exercises>=2 and v_current_compatible<3 then 'HIGH_VALUE'
        else 'OPTIONAL'
      end level
    from opportunities
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'category',category,
    'level',level,
    'unlockable_exercise_count',unlockable_exercises,
    'missing_equipment',missing_equipment,
    'recommendation_key',case category
      when 'Poids libre' then 'ACCESS_TO_EXTERNAL_LOAD'
      when 'Gym' then 'ACCESS_TO_GYMNASTICS_STATION'
      when 'Cardio' then 'ACCESS_TO_CARDIO_EQUIPMENT'
      when 'Plyométrie' then 'ACCESS_TO_PLYOMETRIC_SUPPORT'
      else 'ACCESS_TO_ADDITIONAL_EQUIPMENT' end
  ) order by case level when 'HIGH_VALUE' then 0 else 1 end,unlockable_exercises desc,category),'[]'::jsonb)
  into v_equipment
  from (select * from ranked order by case level when 'HIGH_VALUE' then 0 else 1 end,unlockable_exercises desc limit 4) q;

  -- Environment opportunity is meaningful in v1 only for targeted Skill development.
  if v_intent='SKILL_DEVELOPMENT' and cardinality(v_target_patterns)>0 then
    with relevant_skill as (
      select distinct e.id
      from public.exercises e
      where 'Skill'=any(coalesce(e.usable_for,'{}'::text[]))
        and e.movement_pattern=any(v_target_patterns)
    ), counts as (
      select eer.requirement_key,count(distinct eer.exercise_id)::int exercise_count,
             (select count(*) from relevant_skill)::int total_candidates
      from relevant_skill rs
      join public.exercise_environment_requirements eer on eer.exercise_id=rs.id
      group by eer.requirement_key
    )
    select coalesce(jsonb_agg(jsonb_build_object(
      'requirement_key',requirement_key,
      'level',case when total_candidates>0 and exercise_count::numeric/total_candidates>=0.50 and exercise_count>=2 then 'HIGH_VALUE' else 'OPTIONAL' end,
      'relevant_exercise_count',exercise_count,
      'relevant_candidate_count',total_candidates,
      'candidate_share',case when total_candidates>0 then round(exercise_count::numeric/total_candidates,3) else 0 end
    ) order by exercise_count desc,requirement_key),'[]'::jsonb)
    into v_environment
    from (select * from counts order by exercise_count desc limit 4) q;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'movement_pattern',movement_pattern,'exercise_family',exercise_family,
    'reason',reason,'priority',priority,'expires_at',expires_at
  ) order by priority desc,updated_at desc),'[]'::jsonb)
  into v_memory
  from public.user_uncovered_pattern_intents
  where user_id=p_user_id and status='active' and expires_at>now();

  select count(*)::int into v_high_value_count
  from (
    select x from jsonb_array_elements(v_equipment) x where x->>'level'='HIGH_VALUE'
    union all
    select x from jsonb_array_elements(v_environment) x where x->>'level'='HIGH_VALUE'
  ) q;

  if v_high_value_count>0 then v_status:='HIGH_VALUE_CONTEXT_IDENTIFIED'; end if;

  return jsonb_build_object(
    'version','context-opportunity-shadow-v1',
    'mode','SHADOW',
    'status',v_status,
    'anchor_date',v_anchor,
    'session_intent',v_intent,
    'intent_confidence',round(v_intent_confidence,2),
    'target_movement_patterns',to_jsonb(v_target_patterns),
    'target_training_focus',v_training_focus,
    'current_compatible_target_exercises',v_current_compatible,
    'equipment_opportunities',v_equipment,
    'environment_opportunities',v_environment,
    'active_uncovered_priority_memory',v_memory,
    'future_user_recommendation_eligible',v_high_value_count>0 and v_intent_confidence>=0.70,
    'required_level_policy',jsonb_build_object(
      'required_emitted_by_base_v1',false,
      'reserved_for_explicit_program_or_skill_target',true
    ),
    'memory_contract',jsonb_build_object(
      'reuse_table','user_uncovered_pattern_intents',
      'future_reason','program_context_unavailable',
      'writes_enabled_in_shadow',false
    ),
    'authority',jsonb_build_object(
      'shadow_only',true,
      'may_change_session_decision',false,
      'may_require_equipment',false,
      'may_write_priority_memory',false,
      'session_coach_adapts_to_actual_context',true,
      'hard_gates_override_context_opportunity',true
    )
  );
end;
$function$;

revoke all on function public.program_coach_context_opportunity_shadow_v1(uuid,date,jsonb,jsonb,jsonb) from public, anon;
grant execute on function public.program_coach_context_opportunity_shadow_v1(uuid,date,jsonb,jsonb,jsonb) to authenticated;

-- Bridge into adaptive generation as a non-blocking observation only.
do $bridge$
declare
  v_def text;
  v_old text;
  v_new text;
begin
  select pg_get_functiondef(p.oid)
  into v_def
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname='d_generate_adaptive_session_v2'
    and pg_get_function_identity_arguments(p.oid)='p_user_id uuid, p_focus_override text, p_duration_minutes integer, p_readiness text, p_target_region_override text, p_progression_intent_override text, p_zone_terms text[], p_inventory jsonb, p_available_equipment text[], p_max_complexity integer, p_max_difficulty text, p_candidate_count integer, p_policy_key text, p_anchor_date date, p_force_recalculate_started boolean, p_protected_session_exercise_ids uuid[]';

  if v_def is null then
    raise exception 'Context Opportunity SHADOW guard: d_generate_adaptive_session_v2 exact signature not found';
  end if;

  v_old := $old$v_pattern_budget_error text:=null;$old$;
  v_new := $new$v_pattern_budget_error text:=null;
  v_context_opportunity jsonb:='{}'::jsonb;
  v_context_opportunity_error text:=null;$new$;
  if position(v_old in v_def)=0 then
    raise exception 'Context Opportunity SHADOW guard: declaration fragment changed';
  end if;
  v_def:=replace(v_def,v_old,v_new);

  v_old := $old$  if coalesce(v_context->>'status','')<>'READY' then
    return v_context||jsonb_build_object('version','d1-adaptive-generation-v5-recalculation');
  end if;

  v_plan_item_id:=nullif(v_context->>'plan_item_id','')::uuid;$old$;
  v_new := $new$  if coalesce(v_context->>'status','')<>'READY' then
    return v_context||jsonb_build_object('version','d1-adaptive-generation-v5-recalculation');
  end if;

  begin
    v_context_opportunity:=public.program_coach_context_opportunity_shadow_v1(
      p_user_id,
      v_anchor,
      v_context,
      coalesce(v_context->'session_intent_shadow','{}'::jsonb),
      coalesce(p_inventory,'[]'::jsonb)
    );
  exception when others then
    v_context_opportunity_error:=sqlerrm;
    v_context_opportunity:=jsonb_build_object(
      'version','context-opportunity-shadow-v1','mode','SHADOW','status','UNAVAILABLE',
      'reason','SHADOW_EVALUATION_ERROR',
      'authority',jsonb_build_object('shadow_only',true,'may_change_session_decision',false)
    );
  end;

  v_context:=v_context||jsonb_build_object(
    'context_opportunity_shadow',v_context_opportunity,
    'context_opportunity_shadow_error',v_context_opportunity_error
  );

  v_plan_item_id:=nullif(v_context->>'plan_item_id','')::uuid;$new$;
  if position(v_old in v_def)=0 then
    raise exception 'Context Opportunity SHADOW guard: READY fragment changed';
  end if;
  v_def:=replace(v_def,v_old,v_new);

  v_old := $old$        'pattern_budget_shadow',v_pattern_budget,
        'pattern_budget_shadow_error',v_pattern_budget_error
      ),updated_at=now()$old$;
  v_new := $new$        'pattern_budget_shadow',v_pattern_budget,
        'pattern_budget_shadow_error',v_pattern_budget_error,
        'context_opportunity_shadow',v_context_opportunity,
        'context_opportunity_shadow_error',v_context_opportunity_error
      ),updated_at=now()$new$;
  if position(v_old in v_def)=0 then
    raise exception 'Context Opportunity SHADOW guard: planning-context fragment changed';
  end if;
  v_def:=replace(v_def,v_old,v_new);

  v_old := $old$    'recalculation_continuity',v_continuity,
    'pattern_budget_shadow',v_pattern_budget,
    'meta',$old$;
  v_new := $new$    'recalculation_continuity',v_continuity,
    'pattern_budget_shadow',v_pattern_budget,
    'context_opportunity_shadow',v_context_opportunity,
    'meta',$new$;
  if position(v_old in v_def)=0 then
    raise exception 'Context Opportunity SHADOW guard: return fragment changed';
  end if;
  v_def:=replace(v_def,v_old,v_new);

  execute v_def;
end;
$bridge$;
