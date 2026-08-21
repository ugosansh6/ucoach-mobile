create or replace function public.w3_capability_dimension_state_v1(
  p_dimension text,
  p_tracking_modes text[],
  p_envelope jsonb,
  p_confidence_json jsonb,
  p_freshness_json jsonb,
  p_evidence_json jsonb,
  p_derived_dimension boolean default false
)
returns jsonb
language plpgsql
stable
set search_path=public
as $$
declare
  v_dimension text:=lower(trim(coalesce(p_dimension,'')));
  v_envelope jsonb:=coalesce(p_envelope,'{}'::jsonb);
  v_observed boolean:=jsonb_typeof(v_envelope)='object' and v_envelope<>'{}'::jsonb;
  v_explicitly_tracked boolean:=v_dimension=any(coalesce(p_tracking_modes,'{}'::text[]));
  v_confidence jsonb:='{}'::jsonb;
  v_freshness jsonb:='{}'::jsonb;
  v_evidence jsonb:='{}'::jsonb;
begin
  select coalesce(jsonb_object_agg(key,value),'{}'::jsonb)
  into v_confidence
  from jsonb_each(coalesce(p_confidence_json,'{}'::jsonb))
  where key like v_dimension||'|%';

  select coalesce(jsonb_object_agg(key,value),'{}'::jsonb)
  into v_freshness
  from jsonb_each(coalesce(p_freshness_json,'{}'::jsonb))
  where key like v_dimension||'|%';

  select coalesce(jsonb_object_agg(key,value),'{}'::jsonb)
  into v_evidence
  from jsonb_each(coalesce(p_evidence_json,'{}'::jsonb))
  where key like v_dimension||'|%';

  return jsonb_strip_nulls(jsonb_build_object(
    'dimension',v_dimension,
    'status',case
      when v_observed then 'OBSERVED'
      when v_explicitly_tracked then 'UNKNOWN'
      when p_derived_dimension then 'NOT_OBSERVED'
      else 'NOT_APPLICABLE'
    end,
    'applicability',case
      when v_explicitly_tracked then 'EXPLICIT_TRACKING_MODE'
      when p_derived_dimension then 'DERIVED_IF_OBSERVED'
      when v_observed then 'OBSERVED_LEGACY_OR_DERIVED'
      else 'NOT_TRACKED'
    end,
    'envelope',case when v_observed then v_envelope else null end,
    'confidence_detail',case when v_confidence<>'{}'::jsonb then v_confidence else null end,
    'freshness_detail',case when v_freshness<>'{}'::jsonb then v_freshness else null end,
    'evidence_detail',case when v_evidence<>'{}'::jsonb then v_evidence else null end,
    'unknown_is_not_weakness',not v_observed
  ));
end;
$$;

revoke all on function public.w3_capability_dimension_state_v1(text,text[],jsonb,jsonb,jsonb,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.w3_capability_dimension_state_v1(text,text[],jsonb,jsonb,jsonb,jsonb,boolean) to service_role;

create or replace function public.w3_capability_model_v1(
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
  v_movements jsonb:='[]'::jsonb;
  v_protocols jsonb:='[]'::jsonb;
  v_athletic jsonb:='[]'::jsonb;
  v_movement_count int:=0;
  v_protocol_count int:=0;
  v_athletic_count int:=0;
  v_unknown_tracked int:=0;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then
    raise exception 'Forbidden user';
  end if;

  with directives as (
    select *
    from public.pi_exercise_directives(p_user_id,v_anchor,90)
  ), movement_rows as (
    select
      c.*,
      e.name,
      e.display_name,
      e.movement_pattern,
      e.training_focus,
      e.body_region,
      coalesce(e.tracking_modes,'{}'::text[]) tracking_modes,
      d.directive,
      d.priority_score,
      d.confidence directive_confidence,
      d.source directive_source,
      d.latest_decision,
      d.reason_codes,
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'path_key',sp.path_key,
          'path_name',sp.display_name,
          'step_order',m.step_order,
          'member_role',m.member_role,
          'path_region',sp.body_region
        ) order by sp.selection_priority desc,m.step_order,sp.path_key)
        from public.skill_path_members m
        join public.skill_paths sp on sp.path_key=m.path_key and sp.active
        where m.exercise_id=c.exercise_id and m.active
      ),'[]'::jsonb) as skill_memberships
    from public.user_exercise_capabilities c
    join public.exercises e on e.id=c.exercise_id
    left join directives d on d.exercise_id=c.exercise_id::text
    where c.user_id=p_user_id
  ), built as (
    select
      c.exercise_id,
      jsonb_strip_nulls(jsonb_build_object(
        'exercise_id',c.exercise_id,
        'name',coalesce(nullif(c.display_name,''),c.name),
        'movement_pattern',c.movement_pattern,
        'training_focus',c.training_focus,
        'body_region',c.body_region,
        'tracking_modes',to_jsonb(c.tracking_modes),
        'dimensions',jsonb_build_object(
          'reps',public.w3_capability_dimension_state_v1('reps',c.tracking_modes,c.reps_envelope,c.confidence_json,c.freshness_json,c.evidence_json,false),
          'load',public.w3_capability_dimension_state_v1('load',c.tracking_modes,c.load_envelope,c.confidence_json,c.freshness_json,c.evidence_json,false),
          'time',public.w3_capability_dimension_state_v1('time',c.tracking_modes,c.time_envelope,c.confidence_json,c.freshness_json,c.evidence_json,false),
          'distance',public.w3_capability_dimension_state_v1('distance',c.tracking_modes,c.distance_envelope,c.confidence_json,c.freshness_json,c.evidence_json,false),
          'pace',public.w3_capability_dimension_state_v1('pace',c.tracking_modes,c.pace_envelope,c.confidence_json,c.freshness_json,c.evidence_json,true),
          'density',public.w3_capability_dimension_state_v1('density',c.tracking_modes,c.density_envelope,c.confidence_json,c.freshness_json,c.evidence_json,true),
          'progressive',public.w3_capability_dimension_state_v1('progressive',c.tracking_modes,c.progressive_envelope,c.confidence_json,c.freshness_json,c.evidence_json,true)
        ),
        'overall_confidence',c.confidence,
        'overall_freshness',c.freshness,
        'evidence_count',c.evidence_count,
        'valid_evidence_count',c.valid_evidence_count,
        'last_observed_at',c.last_observed_at,
        'last_valid_observed_at',c.last_valid_observed_at,
        'engine_version',c.engine_version,
        'technical_context',jsonb_build_object(
          'skill_memberships',c.skill_memberships,
          'technical_step_known',jsonb_array_length(c.skill_memberships)>0
        ),
        'coach_directive',case when c.directive is not null then jsonb_strip_nulls(jsonb_build_object(
          'directive',c.directive,
          'priority_score',c.priority_score,
          'confidence',c.directive_confidence,
          'source',c.directive_source,
          'latest_decision',c.latest_decision,
          'reason_codes',to_jsonb(c.reason_codes)
        )) else null end,
        'observation_context_evidence',case when coalesce(c.evidence_json,'{}'::jsonb)<>'{}'::jsonb then c.evidence_json else null end
      )) as obj,
      (
        case when 'reps'=any(c.tracking_modes) and coalesce(c.reps_envelope,'{}'::jsonb)='{}'::jsonb then 1 else 0 end +
        case when 'load'=any(c.tracking_modes) and coalesce(c.load_envelope,'{}'::jsonb)='{}'::jsonb then 1 else 0 end +
        case when 'time'=any(c.tracking_modes) and coalesce(c.time_envelope,'{}'::jsonb)='{}'::jsonb then 1 else 0 end +
        case when 'distance'=any(c.tracking_modes) and coalesce(c.distance_envelope,'{}'::jsonb)='{}'::jsonb then 1 else 0 end
      )::int as unknown_tracked_dimensions
    from movement_rows c
  )
  select
    coalesce(jsonb_agg(obj order by exercise_id),'[]'::jsonb),
    count(*)::int,
    coalesce(sum(unknown_tracked_dimensions),0)::int
  into v_movements,v_movement_count,v_unknown_tracked
  from built;

  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'protocol_signature',p.protocol_signature,
    'mechanic_key',p.mechanic_key,
    'variant_key',p.variant_key,
    'protocol',p.protocol_json,
    'best_outcome',p.best_outcome_json,
    'latest_outcome',p.latest_outcome_json,
    'confidence',p.confidence,
    'freshness',p.freshness,
    'effective_evidence',p.effective_evidence,
    'evidence_count',p.evidence_count,
    'valid_evidence_count',p.valid_evidence_count,
    'last_observed_at',p.last_observed_at,
    'last_valid_observed_at',p.last_valid_observed_at,
    'engine_version',p.engine_version
  )) order by p.confidence desc nulls last,p.last_valid_observed_at desc nulls last),'[]'::jsonb),count(*)::int
  into v_protocols,v_protocol_count
  from public.user_protocol_capabilities p
  where p.user_id=p_user_id;

  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'dimension',a.dimension,
    'score',a.score,
    'confidence',a.confidence,
    'trend',a.trend,
    'sample_count',a.sample_count,
    'source_breakdown',a.source_breakdown,
    'explanation',a.explanation_json,
    'calculated_at',a.calculated_at
  )) order by a.dimension),'[]'::jsonb),count(*)::int
  into v_athletic,v_athletic_count
  from public.user_athletic_profile a
  where a.user_id=p_user_id;

  return jsonb_build_object(
    'version','w3-athlete-capability-model-v1',
    'anchor_date',v_anchor,
    'summary',jsonb_build_object(
      'movement_capabilities',v_movement_count,
      'protocol_capabilities',v_protocol_count,
      'athletic_dimensions',v_athletic_count,
      'unknown_explicit_tracking_dimensions',v_unknown_tracked
    ),
    'movement_capabilities',v_movements,
    'protocol_capabilities',v_protocols,
    'athletic_profile',v_athletic,
    'authority',jsonb_build_object(
      'movement_capability','user_exercise_capabilities + capability_update_events',
      'protocol_capability','user_protocol_capabilities + protocol_capability_events',
      'technical_step','skill_paths + skill_path_members',
      'coach_directive','pi_exercise_directives',
      'athletic_profile','user_athletic_profile'
    ),
    'semantics',jsonb_build_object(
      'unknown_is_explicit',true,
      'missing_evidence_is_not_weakness',true,
      'raw_metrics_are_not_rewritten',true,
      'confidence_and_freshness_remain_attached_to_each_capability',true,
      'context_is_evidence_metadata_not_a_rewritten_score',true,
      'performance_context_status','PENDING_W4_CTX_001',
      'isolated_vs_fatigued_context_not_yet_interpreted',true,
      'no_new_sports_thresholds_added',true
    )
  );
end;
$$;

revoke all on function public.w3_capability_model_v1(uuid,date) from public,anon;
grant execute on function public.w3_capability_model_v1(uuid,date) to authenticated,service_role;

comment on function public.w3_capability_model_v1(uuid,date) is 'W3 CAP-001 canonical read model. Makes unknown capability dimensions explicit without treating missing evidence as weakness; preserves existing PI/capability authorities and defers Performance Context interpretation to W4.';
