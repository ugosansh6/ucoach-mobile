create or replace function public.w3_capability_context_observations_v1(
  p_user_id uuid,
  p_exercise_id text,
  p_anchor_date date default current_date,
  p_limit integer default 20
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_anchor date := coalesce(p_anchor_date,current_date);
  v_limit integer := greatest(1,least(coalesce(p_limit,20),100));
  v_items jsonb := '[]'::jsonb;
  v_total integer := 0;
  v_isolated integer := 0;
  v_fatigue integer := 0;
  v_contextual integer := 0;
begin
  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'Forbidden user';
  end if;

  with candidate_logs as (
    select el.id,el.created_at
    from public.exercise_logs el
    join public.performance_observation_contract poc on poc.exercise_log_id=el.id
    where el.user_id=p_user_id
      and el.exercise_id=p_exercise_id
      and poc.observation_role='CAPABILITY_CANDIDATE'
      and el.created_at < (v_anchor + 1)::timestamptz
    order by el.created_at desc,el.id desc
    limit v_limit
  ), contexts as (
    select cl.id,cl.created_at,public.w4_performance_context_v1(cl.id) ctx
    from candidate_logs cl
  ), classified as (
    select
      c.id,
      c.created_at,
      c.ctx,
      case
        when c.ctx#>>'{prescription_structure,block_key}'='skill'
         and coalesce((c.ctx#>>'{sequence_context,block_exercise_count}')::int,0)=1
         and c.ctx#>'{sequence_context,previous}'='null'::jsonb
         and coalesce((c.ctx#>>'{sequence_context,protocol_repeat_evidence}')::boolean,false)=false
          then 'ISOLATED_SKILL_OBSERVATION'
        when c.ctx#>>'{prescription_structure,block_key}'='wod'
         and (
           coalesce((c.ctx#>>'{sequence_context,previous,has_primary_local_muscle_overlap}')::boolean,false)
           or coalesce((c.ctx#>>'{sequence_context,cycle_predecessor,has_primary_local_muscle_overlap}')::boolean,false)
           or coalesce((c.ctx#>>'{sequence_context,protocol_repeat_evidence}')::boolean,false)
           or c.ctx#>'{fatigue_context,whole_wod_local_fatigue_fit}' is not null
           or c.ctx#>'{fatigue_context,whole_wod_local_fatigue_concentration_index}' is not null
         ) then 'FATIGUE_CONTEXT_PRESENT'
        else 'CONTEXTUAL_OBSERVATION'
      end context_class
    from contexts c
  ), built as (
    select
      id,
      created_at,
      context_class,
      jsonb_build_object(
        'exercise_log_id',id,
        'observed_at',ctx#>'{observation,observed_at}',
        'context_class',context_class,
        'comparison_partition_key',concat_ws('|',
          'exercise='||coalesce(ctx#>>'{exercise,exercise_id}','unknown'),
          'block='||coalesce(ctx#>>'{prescription_structure,block_key}','unknown'),
          'mechanic='||coalesce(ctx#>>'{session_context,mechanic}','unknown'),
          'pattern='||coalesce(ctx#>>'{exercise,movement_pattern}','unknown'),
          'fatigue='||context_class
        ),
        'raw_performance',ctx#>'{observation,raw_performance}',
        'context',ctx,
        'fatigue_evidence',jsonb_build_object(
          'previous_primary_local_muscle_overlap',coalesce((ctx#>>'{sequence_context,previous,has_primary_local_muscle_overlap}')::boolean,false),
          'cycle_primary_local_muscle_overlap',coalesce((ctx#>>'{sequence_context,cycle_predecessor,has_primary_local_muscle_overlap}')::boolean,false),
          'protocol_repeat_evidence',coalesce((ctx#>>'{sequence_context,protocol_repeat_evidence}')::boolean,false),
          'whole_wod_local_fatigue_context_available',(
            ctx#>'{fatigue_context,whole_wod_local_fatigue_fit}' is not null
            or ctx#>'{fatigue_context,whole_wod_local_fatigue_concentration_index}' is not null
          ),
          'density_context_available',coalesce((ctx#>>'{density_context,available}')::boolean,false)
        )
      ) item
    from classified
  )
  select
    coalesce(jsonb_agg(item order by created_at desc,id desc),'[]'::jsonb),
    count(*)::int,
    count(*) filter(where context_class='ISOLATED_SKILL_OBSERVATION')::int,
    count(*) filter(where context_class='FATIGUE_CONTEXT_PRESENT')::int,
    count(*) filter(where context_class='CONTEXTUAL_OBSERVATION')::int
  into v_items,v_total,v_isolated,v_fatigue,v_contextual
  from built;

  return jsonb_build_object(
    'version','w3-capability-context-observations-v1',
    'anchor_date',v_anchor,
    'exercise_id',p_exercise_id,
    'summary',jsonb_build_object(
      'observations',v_total,
      'isolated_skill_observations',v_isolated,
      'fatigue_context_observations',v_fatigue,
      'other_contextual_observations',v_contextual
    ),
    'observations',v_items,
    'semantics',jsonb_build_object(
      'raw_metric_is_never_rewritten',true,
      'context_class_is_not_a_performance_score',true,
      'fatigue_context_present_is_evidence_label_not_fatigue_quantity',true,
      'no_arbitrary_multiplier_or_threshold',true,
      'comparisons_may_partition_by_context_later',true,
      'missing_context_is_not_weakness',true
    )
  );
end;
$$;

revoke all on function public.w3_capability_context_observations_v1(uuid,text,date,integer) from public;
revoke all on function public.w3_capability_context_observations_v1(uuid,text,date,integer) from anon;
grant execute on function public.w3_capability_context_observations_v1(uuid,text,date,integer) to authenticated;
grant execute on function public.w3_capability_context_observations_v1(uuid,text,date,integer) to service_role;

alter function public.w3_capability_model_v1(uuid,date) rename to w3_capability_model_pre_cap002_v1;
revoke all on function public.w3_capability_model_pre_cap002_v1(uuid,date) from public,anon,authenticated;
grant execute on function public.w3_capability_model_pre_cap002_v1(uuid,date) to service_role;

create or replace function public.w3_capability_model_v1(
  p_user_id uuid,
  p_anchor_date date default current_date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  r jsonb;
  v_anchor date:=coalesce(p_anchor_date,current_date);
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;
  r:=public.w3_capability_model_pre_cap002_v1(p_user_id,v_anchor);
  r:=jsonb_set(r,'{version}','"w3-athlete-capability-model-v1.1"'::jsonb,true);
  r:=jsonb_set(r,'{authority}',coalesce(r->'authority','{}'::jsonb)||jsonb_build_object(
    'performance_context','w4_performance_context_v1',
    'context_partition_reader','w3_capability_context_observations_v1'
  ),true);
  r:=jsonb_set(r,'{semantics}',coalesce(r->'semantics','{}'::jsonb)||jsonb_build_object(
    'performance_context_status','ACTIVE_W4_CTX_001',
    'isolated_vs_fatigued_context_interpreted',true,
    'context_partition_does_not_rewrite_capability_envelope',true,
    'fatigue_context_is_qualitative_evidence_not_numeric_penalty',true,
    'no_new_sports_thresholds_added',true
  ),true);
  return r;
end;
$$;

revoke all on function public.w3_capability_model_v1(uuid,date) from public;
revoke all on function public.w3_capability_model_v1(uuid,date) from anon;
grant execute on function public.w3_capability_model_v1(uuid,date) to authenticated;
grant execute on function public.w3_capability_model_v1(uuid,date) to service_role;

comment on function public.w3_capability_context_observations_v1(uuid,text,date,integer) is 'W3 CAP-002: attaches W4 performance context to capability-candidate observations without rewriting raw metrics. Distinguishes isolated Skill evidence, fatigue-context evidence, and other contextual observations without numeric penalties.';
comment on function public.w3_capability_model_v1(uuid,date) is 'W3 Capability Model V1.1. CAP-002 activated through W4 CTX-001 context descriptors; raw capability envelopes remain unchanged.';
