alter function public.w3_active_skill_objective_v1(uuid,date) rename to w3_active_skill_objective_pre_lim002_v1;
revoke all on function public.w3_active_skill_objective_pre_lim002_v1(uuid,date) from public,anon,authenticated;
grant execute on function public.w3_active_skill_objective_pre_lim002_v1(uuid,date) to service_role;

create or replace function public.w3_active_skill_objective_v1(
  p_user_id uuid,
  p_anchor_date date default current_date
)
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  r jsonb;
  v_snapshot_status text;
  v_next_path text;
  v_next_id text;
  v_interventions jsonb;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;
  r:=public.w3_active_skill_objective_pre_lim002_v1(p_user_id,coalesce(p_anchor_date,current_date));
  v_snapshot_status:=r#>>'{next_target_prerequisite_snapshot,status}';
  v_next_path:=r#>>'{path,path_key}';
  v_next_id:=r#>>'{next_target,exercise_id}';

  if v_snapshot_status='LIMITING_FACTORS_IDENTIFIED' then
    r:=jsonb_set(r,'{status}','"NEXT_STEP_LIMITING_FACTORS"'::jsonb,true);
  end if;

  if v_next_path is not null and v_next_id is not null
     and v_snapshot_status in ('LIMITING_FACTORS_IDENTIFIED','CALIBRATION_NEEDED') then
    v_interventions:=public.w3_limiting_factor_interventions_v1(p_user_id,v_next_path,v_next_id,coalesce(p_anchor_date,current_date));
    r:=jsonb_set(r,'{limiting_factor_interventions}',v_interventions,true);
  end if;

  r:=jsonb_set(r,'{semantics}',coalesce(r->'semantics','{}'::jsonb)||jsonb_build_object(
    'next_step_limiting_factor_state_is_explicit',true,
    'limiting_factor_interventions_use_only_source_backed_causal_edges',true
  ),true);
  r:=jsonb_set(r,'{version}','"w3-active-skill-objective-v1.1"'::jsonb,true);
  return r;
end;
$$;
revoke all on function public.w3_active_skill_objective_v1(uuid,date) from public,anon;
grant execute on function public.w3_active_skill_objective_v1(uuid,date) to authenticated,service_role;

alter function public.w3_opportunity_engine_v1(uuid,date) rename to w3_opportunity_engine_pre_lim002_v1;
revoke all on function public.w3_opportunity_engine_pre_lim002_v1(uuid,date) from public,anon,authenticated;
grant execute on function public.w3_opportunity_engine_pre_lim002_v1(uuid,date) to service_role;

create or replace function public.w3_opportunity_engine_v1(
  p_user_id uuid,
  p_anchor_date date default current_date
)
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  r jsonb;
  v_skill jsonb;
  v_state text;
  v_top_int jsonb;
  v_candidates jsonb:='[]'::jsonb;
  v_ranked jsonb:='[]'::jsonb;
  v_new_opp jsonb;
  v_eq_opp jsonb;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;
  r:=public.w3_opportunity_engine_pre_lim002_v1(p_user_id,coalesce(p_anchor_date,current_date));
  v_skill:=r->'active_skill_objective';
  v_state:=v_skill->>'status';

  if v_state in ('NEXT_STEP_LIMITING_FACTORS','NEXT_STEP_CALIBRATION_NEEDED') then
    v_top_int:=v_skill#>'{limiting_factor_interventions,top_interventions,0}';
    if v_top_int is not null and v_top_int<>'null'::jsonb then
      select coalesce(jsonb_agg(value),'[]'::jsonb)
      into v_candidates
      from jsonb_array_elements(coalesce(r->'all_candidates','[]'::jsonb)) x(value)
      where coalesce(value->>'reason_code','')<>'NEXT_SKILL_STEP_BLOCKED_BY_MISSING_PREREQUISITE_EVIDENCE'
        and not (v_state='NEXT_STEP_CALIBRATION_NEEDED'
                 and value->>'type'='EQUIPMENT_ACCESS'
                 and value->>'supports_opportunity_type'='CALIBRATION');

      v_new_opp:=jsonb_strip_nulls(jsonb_build_object(
        'type',case when v_top_int->>'evaluation_status'='CALIBRATION_NEEDED' then 'CALIBRATION' else 'LIMITING_FACTOR_DEVELOPMENT' end,
        'primary',true,
        'decision_blocking',true,
        'target_exercise_id',v_top_int->>'target_exercise_id',
        'target_exercise_name',v_top_int->>'target_exercise_name',
        'supports_skill_target_id',v_skill#>>'{next_target,exercise_id}',
        'supports_skill_target_name',v_skill#>>'{next_target,exercise_name}',
        'existing_priority_score',nullif(v_top_int->>'pi_priority_score','')::numeric,
        'existing_confidence',nullif(v_top_int->>'pi_confidence','')::numeric,
        'reason_code',case when v_top_int->>'evaluation_status'='CALIBRATION_NEEDED'
          then 'NEXT_SKILL_STEP_BLOCKED_BY_PREREQUISITE_CALIBRATION'
          else 'NEXT_SKILL_STEP_BLOCKED_BY_DOCUMENTED_LIMITING_FACTOR' end,
        'recommended_intervention',v_top_int,
        'evidence_ref',v_top_int->'factor_evidence'
      ));
      v_candidates:=v_candidates||jsonb_build_array(v_new_opp);

      if v_top_int#>>'{equipment_gap,status}'='MISSING_EQUIPMENT' then
        v_eq_opp:=jsonb_build_object(
          'type','EQUIPMENT_ACCESS','primary',false,'decision_blocking',true,
          'target_exercise_id',v_top_int->>'target_exercise_id','target_exercise_name',v_top_int->>'target_exercise_name',
          'supports_opportunity_type',v_new_opp->>'type',
          'reason_code','EXACT_EQUIPMENT_MISSING_FOR_LIMITING_FACTOR_INTERVENTION',
          'equipment_gap',v_top_int->'equipment_gap',
          'evidence_ref',jsonb_build_object('source','w3_limiting_factor_interventions_v1')
        );
        v_candidates:=v_candidates||jsonb_build_array(v_eq_opp);
      end if;

      select coalesce(jsonb_agg(value order by
        coalesce((value->>'decision_blocking')::boolean,false) desc,
        coalesce((value->>'primary')::boolean,false) desc,
        coalesce(nullif(value->>'existing_priority_score','')::numeric,-1) desc,
        value->>'type',value->>'target_exercise_id'
      ),'[]'::jsonb)
      into v_ranked
      from (
        select value
        from jsonb_array_elements(v_candidates)
        order by
          coalesce((value->>'decision_blocking')::boolean,false) desc,
          coalesce((value->>'primary')::boolean,false) desc,
          coalesce(nullif(value->>'existing_priority_score','')::numeric,-1) desc,
          value->>'type',value->>'target_exercise_id'
        limit 3
      ) q;

      r:=jsonb_set(r,'{all_candidates}',v_candidates,true);
      r:=jsonb_set(r,'{top_opportunities}',v_ranked,true);
      r:=jsonb_set(r,'{status}',case when jsonb_array_length(v_ranked)>0 then '"OPPORTUNITIES_IDENTIFIED"'::jsonb else '"NO_EVIDENCE_BACKED_OPPORTUNITY"'::jsonb end,true);
    end if;
  end if;

  r:=jsonb_set(r,'{coverage}',coalesce(r->'coverage','{}'::jsonb)||jsonb_build_object('limiting_factor_interventions',true),true);
  r:=jsonb_set(r,'{semantics}',coalesce(r->'semantics','{}'::jsonb)||jsonb_build_object(
    'limiting_factor_development_requires_source_backed_causal_prerequisite_and_existing_pi_state',true,
    'prerequisite_calibration_targets_the_prerequisite_not_the_future_skill_step',true
  ),true);
  r:=jsonb_set(r,'{version}','"w3-opportunity-engine-v1.1"'::jsonb,true);
  return r;
end;
$$;
revoke all on function public.w3_opportunity_engine_v1(uuid,date) from public,anon;
grant execute on function public.w3_opportunity_engine_v1(uuid,date) to authenticated,service_role;

create or replace function public.w3_intervention_options_v1(
  p_user_id uuid,
  p_anchor_date date default current_date
)
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  v_anchor date:=coalesce(p_anchor_date,current_date);
  v_opp jsonb;
  v_items jsonb:='[]'::jsonb;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;
  v_opp:=public.w3_opportunity_engine_v1(p_user_id,v_anchor);

  with opps as (
    select value,ord
    from jsonb_array_elements(coalesce(v_opp->'top_opportunities','[]'::jsonb)) with ordinality q(value,ord)
  ), mapped as (
    select o.ord,o.value,
      case
        when o.value->>'type'='LIMITING_FACTOR_DEVELOPMENT' then o.value#>>'{recommended_intervention,intervention_key}'
        when o.value->>'type'='CALIBRATION' and o.value#>>'{recommended_intervention,intervention_key}' is not null then o.value#>>'{recommended_intervention,intervention_key}'
        when o.value->>'type'='CALIBRATION' then 'CALIBRATION_CONTROLLED'
        when o.value->>'type'='RETEST' then 'RETEST_CONTROLLED'
        when o.value->>'type'='SKILL_DEVELOPMENT' then 'SKILL_PRACTICE_CURRENT_STEP'
        when o.value->>'type'='SKILL_PROGRESSION' then 'SKILL_PROGRESS_NEXT_STEP'
        when o.value->>'type'='MOVEMENT_PROGRESSION' then 'MOVEMENT_PROGRESS_EXPOSURE'
        when o.value->>'type'='EQUIPMENT_ACCESS' then 'EQUIPMENT_ACCESS_CONTEXT'
        else null
      end intervention_key
    from opps o
  )
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'rank',m.ord,
    'opportunity',m.value,
    'intervention_key',c.intervention_key,
    'category',c.category,
    'label',c.label,
    'description',c.description,
    'auto_assignment_policy',c.auto_assignment_policy,
    'catalog_version',c.version,
    'factor_intervention',m.value->'recommended_intervention'
  )) order by m.ord),'[]'::jsonb)
  into v_items
  from mapped m
  left join public.coach_intervention_catalog c on c.intervention_key=m.intervention_key and c.active;

  return jsonb_build_object(
    'version','w3-intervention-options-v1.1','anchor_date',v_anchor,
    'items',v_items,
    'semantics',jsonb_build_object(
      'intervention_is_tied_to_an_evidence_backed_opportunity',true,
      'limiting_factor_intervention_requires_curated_causal_edge',true,
      'missing_evidence_maps_to_calibration_not_development',true,
      'specific_strength_is_never_inferred_from_structural_skill_order',true,
      'specific_dose_is_resolved_by_existing_engine_not_this_layer',true,
      'recovery_remains_owned_by_existing_program_coach',true,
      'hard_safety_equipment_readiness_and_program_rules_override',true
    )
  );
end;
$$;
revoke all on function public.w3_intervention_options_v1(uuid,date) from public,anon;
grant execute on function public.w3_intervention_options_v1(uuid,date) to authenticated,service_role;

comment on function public.w3_active_skill_objective_v1(uuid,date) is 'W3 active Skill objective v1.1. Explicitly distinguishes next-step limiting factors from path-end/branch ambiguity and attaches evidence-backed LIM-002 interventions.';
comment on function public.w3_opportunity_engine_v1(uuid,date) is 'W3 Opportunity Engine v1.1. Converts a documented next-step limiting factor into an opportunity on the actual prerequisite exercise, not the future skill step.';
comment on function public.w3_intervention_options_v1(uuid,date) is 'W3 LIM-002 integrated intervention resolver v1.1. Limiting-factor development is allowed only through curated causal prerequisite relations; missing evidence remains calibration.';
