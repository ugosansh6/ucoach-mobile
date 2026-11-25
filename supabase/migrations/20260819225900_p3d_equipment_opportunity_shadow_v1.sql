do $$
begin
  if to_regprocedure('public.program_coach_context_opportunity_shadow_pre_equipment_v1(uuid,date,jsonb,jsonb,jsonb)') is null
     and to_regprocedure('public.program_coach_context_opportunity_shadow_v1(uuid,date,jsonb,jsonb,jsonb)') is not null then
    alter function public.program_coach_context_opportunity_shadow_v1(uuid,date,jsonb,jsonb,jsonb)
      rename to program_coach_context_opportunity_shadow_pre_equipment_v1;
  end if;
end $$;

create or replace function public.program_coach_equipment_opportunity_shadow_v1(
  p_user_id uuid,
  p_anchor_date date,
  p_session_context jsonb,
  p_inventory jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_anchor date:=coalesce(p_anchor_date,current_date);
  v_focus text:=coalesce(nullif(p_session_context->>'focus',''),'General Fitness');
  v_target_region text:=coalesce(nullif(p_session_context->>'target_region',''),'Full Body');
  v_observation_days int:=0;
  v_items jsonb:='[]'::jsonb;
  v_high_count int:=0;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then
    raise exception 'Forbidden user';
  end if;

  if coalesce(p_session_context->>'status','')<>'READY' then
    return jsonb_build_object(
      'version','equipment-opportunity-shadow-v1',
      'mode','SHADOW',
      'status','NOT_ELIGIBLE',
      'reason','SESSION_CONTEXT_NOT_READY',
      'opportunities','[]'::jsonb,
      'authority',jsonb_build_object(
        'shadow_only',true,
        'may_change_exercise_selection',false,
        'hard_gates_override',true
      )
    );
  end if;

  select count(distinct ws.generated_at::date)::int
  into v_observation_days
  from public.workout_sessions ws
  where ws.user_id=p_user_id
    and ws.generated_at::date<v_anchor
    and ws.generated_at::date>=v_anchor-28;

  with present as (
    select distinct eq.id equipment_id,eq.name,eq.category
    from jsonb_array_elements(coalesce(p_inventory,'[]'::jsonb)) x
    join public.equipment eq on eq.id=nullif(x->>'equipment_id','')
    where eq.id<>'E00'
  ), metrics as (
    select p.equipment_id,p.name,p.category,
      (
        select count(distinct ws.generated_at::date)::int
        from public.workout_sessions ws
        where ws.user_id=p_user_id
          and ws.generated_at::date<v_anchor
          and ws.generated_at::date>=v_anchor-28
          and p.name=any(coalesce(ws.available_equipment,'{}'::text[]))
      ) availability_days,
      (
        select count(distinct ws.generated_at::date)::int
        from public.workout_sessions ws
        where ws.user_id=p_user_id
          and ws.generated_at::date<v_anchor
          and ws.generated_at::date>=v_anchor-28
          and p.name=any(coalesce(ws.available_equipment,'{}'::text[]))
          and exists(
            select 1
            from public.workout_session_exercises wse
            join public.exercise_equipment_requirements_v2 req
              on req.exercise_id=wse.exercise_id
             and req.equipment_id=p.equipment_id
             and not req.is_optional
            where wse.session_id=ws.id
              and wse.block_key in ('skill','wod')
          )
      ) used_training_days,
      (
        select count(distinct e.id)::int
        from public.exercises e
        join public.exercise_equipment_requirements_v2 req
          on req.exercise_id=e.id
         and req.equipment_id=p.equipment_id
         and not req.is_optional
        where (('Skill'=any(coalesce(e.usable_for,'{}'::text[]))) or ('WOD'=any(coalesce(e.usable_for,'{}'::text[]))))
          and public.exercise_equipment_compatible(e.id,coalesce(p_inventory,'[]'::jsonb))
          and (v_target_region='Full Body' or e.body_region in (v_target_region,'Full Body'))
      ) relevant_exercises,
      (
        select count(distinct e.id)::int
        from public.exercises e
        join public.exercise_equipment_requirements_v2 req
          on req.exercise_id=e.id
         and req.equipment_id=p.equipment_id
         and not req.is_optional
        where (('Skill'=any(coalesce(e.usable_for,'{}'::text[]))) or ('WOD'=any(coalesce(e.usable_for,'{}'::text[]))))
          and public.exercise_equipment_compatible(e.id,coalesce(p_inventory,'[]'::jsonb))
          and (v_target_region='Full Body' or e.body_region in (v_target_region,'Full Body'))
          and e.training_focus=v_focus
      ) focus_relevant_exercises,
      (
        select coalesce(jsonb_agg(jsonb_build_object(
          'exercise_id',z.id,
          'name',z.name,
          'movement_pattern',z.movement_pattern,
          'training_focus',z.training_focus,
          'body_region',z.body_region
        ) order by z.focus_match desc,z.region_match desc,z.selection_weight desc,z.id),'[]'::jsonb)
        from (
          select distinct e.id,e.name,e.movement_pattern,e.training_focus,e.body_region,e.selection_weight,
            (e.training_focus=v_focus)::int focus_match,
            (e.body_region=v_target_region)::int region_match
          from public.exercises e
          join public.exercise_equipment_requirements_v2 req
            on req.exercise_id=e.id
           and req.equipment_id=p.equipment_id
           and not req.is_optional
          where (('Skill'=any(coalesce(e.usable_for,'{}'::text[]))) or ('WOD'=any(coalesce(e.usable_for,'{}'::text[]))))
            and public.exercise_equipment_compatible(e.id,coalesce(p_inventory,'[]'::jsonb))
            and (v_target_region='Full Body' or e.body_region in (v_target_region,'Full Body'))
          order by focus_match desc,region_match desc,e.selection_weight desc,e.id
          limit 6
        ) z
      ) candidate_exercises
    from present p
  ), scored as (
    select m.*,
      case when v_observation_days>0 then round(m.availability_days::numeric/v_observation_days,3) else null end availability_share,
      case when m.availability_days>0 then round(m.used_training_days::numeric/m.availability_days,3) else null end utilization_when_available,
      case
        when m.relevant_exercises=0 then 'NO_RELEVANT_USE'
        when m.category in ('Bodyweight','Accessoire','Récupération') then 'OPTIONAL'
        when v_observation_days>=2 and m.availability_days=0 and m.relevant_exercises>=2 then 'HIGH_VALUE_NEW'
        when v_observation_days>=4 and (m.availability_days::numeric/nullif(v_observation_days,0))<=0.35 and m.relevant_exercises>=2 then 'HIGH_VALUE_RARE'
        when m.availability_days>=3 and (m.used_training_days::numeric/nullif(m.availability_days,0))<=0.34 and m.relevant_exercises>=2 then 'MEDIUM_UNDERUSED'
        else 'OPTIONAL'
      end opportunity_level
    from metrics m
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'equipment_id',equipment_id,
    'name',name,
    'category',category,
    'level',opportunity_level,
    'historical_observation_days',v_observation_days,
    'availability_days',availability_days,
    'availability_share',availability_share,
    'used_training_days_when_available',used_training_days,
    'utilization_when_available',utilization_when_available,
    'relevant_exercise_count',relevant_exercises,
    'focus_relevant_exercise_count',focus_relevant_exercises,
    'candidate_exercises',candidate_exercises,
    'recommended_soft_bias',case opportunity_level
      when 'HIGH_VALUE_NEW' then 0.18
      when 'HIGH_VALUE_RARE' then 0.16
      when 'MEDIUM_UNDERUSED' then 0.08
      else 0.00 end,
    'reason',case opportunity_level
      when 'HIGH_VALUE_NEW' then 'EQUIPMENT_AVAILABLE_TODAY_NOT_SEEN_IN_RECENT_SESSION_DAYS'
      when 'HIGH_VALUE_RARE' then 'EQUIPMENT_RARELY_AVAILABLE_AND_RELEVANT_TODAY'
      when 'MEDIUM_UNDERUSED' then 'EQUIPMENT_OFTEN_AVAILABLE_BUT_RARELY_USED_IN_TRAINING_BLOCKS'
      when 'NO_RELEVANT_USE' then 'NO_RELEVANT_SAFE_EXERCISE_FOR_TODAY_CONTEXT'
      else 'NO_STRONG_EQUIPMENT_OPPORTUNITY' end
  ) order by case opportunity_level when 'HIGH_VALUE_NEW' then 0 when 'HIGH_VALUE_RARE' then 1 when 'MEDIUM_UNDERUSED' then 2 else 3 end, focus_relevant_exercises desc,relevant_exercises desc,name),'[]'::jsonb),
  count(*) filter(where opportunity_level in ('HIGH_VALUE_NEW','HIGH_VALUE_RARE'))::int
  into v_items,v_high_count
  from scored;

  return jsonb_build_object(
    'version','equipment-opportunity-shadow-v1',
    'mode','SHADOW',
    'status',case when v_high_count>0 then 'HIGH_VALUE_EQUIPMENT_OPPORTUNITY' else 'NO_HIGH_VALUE_EQUIPMENT_OPPORTUNITY' end,
    'anchor_date',v_anchor,
    'focus',v_focus,
    'target_region',v_target_region,
    'historical_observation_days',v_observation_days,
    'opportunities',v_items,
    'selection_contract',jsonb_build_object(
      'soft_bias_only',true,
      'never_force_equipment_use',true,
      'max_equipment_driven_training_exercises',1,
      'hard_safety_equipment_readiness_and_program_coherence_override',true,
      'rare_equipment_does_not_justify_rebuilding_whole_session',true
    ),
    'authority',jsonb_build_object(
      'shadow_only',true,
      'may_change_exercise_selection',false,
      'may_change_session_decision',false,
      'hard_gates_override',true
    )
  );
end;
$$;

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
security definer
set search_path to 'public'
as $$
declare
  v_base jsonb;
  v_present jsonb;
  v_present_high boolean:=false;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then
    raise exception 'Forbidden user';
  end if;

  v_base:=public.program_coach_context_opportunity_shadow_pre_equipment_v1(
    p_user_id,p_anchor_date,p_session_context,p_session_intent_shadow,p_inventory
  );
  v_present:=public.program_coach_equipment_opportunity_shadow_v1(
    p_user_id,p_anchor_date,p_session_context,p_inventory
  );
  v_present_high:=coalesce(v_present->>'status','')='HIGH_VALUE_EQUIPMENT_OPPORTUNITY';

  v_base:=v_base||jsonb_build_object(
    'version','context-opportunity-shadow-v2-equipment-awareness',
    'present_equipment_opportunity',v_present,
    'equipment_opportunity_selection_eligible',v_present_high,
    'equipment_opportunity_contract',jsonb_build_object(
      'detect_rare_current_equipment',true,
      'detect_underused_current_equipment',true,
      'soft_bias_only_when_future_enabled',true,
      'never_force_equipment_use',true,
      'at_most_one_training_exercise_preferred_from_equipment_opportunity',true,
      'hard_gates_and_session_coherence_override',true
    )
  );

  if v_present_high and coalesce(v_base->>'status','') not in ('NOT_ELIGIBLE','UNAVAILABLE') then
    v_base:=jsonb_set(v_base,'{status}','"HIGH_VALUE_CONTEXT_IDENTIFIED"'::jsonb,true);
  end if;

  return v_base;
end;
$$;
