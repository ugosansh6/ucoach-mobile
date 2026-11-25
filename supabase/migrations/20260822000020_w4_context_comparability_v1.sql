create or replace function public.w4_performance_comparability_v1(
  p_left_exercise_log_id bigint,
  p_right_exercise_log_id bigint
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  l jsonb;
  r jsonb;
  l_status text;
  r_status text;
  l_exercise text;
  r_exercise text;
  l_block text;
  r_block text;
  l_mechanic text;
  r_mechanic text;
  l_pattern text;
  r_pattern text;
  l_fatigue_class text;
  r_fatigue_class text;
  l_metrics text[] := '{}'::text[];
  r_metrics text[] := '{}'::text[];
  shared_metrics text[] := '{}'::text[];
  result_status text;
  reasons jsonb := '[]'::jsonb;
begin
  if p_left_exercise_log_id = p_right_exercise_log_id then
    return jsonb_build_object(
      'version','w4-performance-comparability-v1',
      'status','SAME_OBSERVATION',
      'comparable',false,
      'left_exercise_log_id',p_left_exercise_log_id,
      'right_exercise_log_id',p_right_exercise_log_id,
      'semantics',jsonb_build_object(
        'no_numeric_similarity_score',true,
        'no_metric_rewrite',true,
        'missing_context_is_not_weakness',true
      )
    );
  end if;

  l := public.w4_performance_context_v1(p_left_exercise_log_id);
  r := public.w4_performance_context_v1(p_right_exercise_log_id);
  l_status := l->>'status';
  r_status := r->>'status';

  if l_status in ('NO_OBSERVATION','NOT_FOUND_OR_FORBIDDEN')
     or r_status in ('NO_OBSERVATION','NOT_FOUND_OR_FORBIDDEN') then
    return jsonb_build_object(
      'version','w4-performance-comparability-v1',
      'status','CONTEXT_UNAVAILABLE',
      'comparable',false,
      'left_status',l_status,
      'right_status',r_status,
      'semantics',jsonb_build_object(
        'no_numeric_similarity_score',true,
        'no_metric_rewrite',true,
        'missing_context_is_not_weakness',true
      )
    );
  end if;

  l_exercise := l#>>'{exercise,exercise_id}';
  r_exercise := r#>>'{exercise,exercise_id}';
  l_block := l#>>'{prescription_structure,block_key}';
  r_block := r#>>'{prescription_structure,block_key}';
  l_mechanic := l#>>'{session_context,mechanic}';
  r_mechanic := r#>>'{session_context,mechanic}';
  l_pattern := l#>>'{exercise,movement_pattern}';
  r_pattern := r#>>'{exercise,movement_pattern}';

  l_fatigue_class := case
    when l_block='skill'
      and coalesce((l#>>'{sequence_context,block_exercise_count}')::int,0)=1
      and l#>'{sequence_context,previous}'='null'::jsonb
      and coalesce((l#>>'{sequence_context,protocol_repeat_evidence}')::boolean,false)=false
      then 'ISOLATED_SKILL_OBSERVATION'
    when l_block='wod' and (
      coalesce((l#>>'{sequence_context,previous,has_primary_local_muscle_overlap}')::boolean,false)
      or coalesce((l#>>'{sequence_context,cycle_predecessor,has_primary_local_muscle_overlap}')::boolean,false)
      or coalesce((l#>>'{sequence_context,protocol_repeat_evidence}')::boolean,false)
      or l#>'{fatigue_context,whole_wod_local_fatigue_fit}' is not null
      or l#>'{fatigue_context,whole_wod_local_fatigue_concentration_index}' is not null
    ) then 'FATIGUE_CONTEXT_PRESENT'
    else 'CONTEXTUAL_OBSERVATION'
  end;

  r_fatigue_class := case
    when r_block='skill'
      and coalesce((r#>>'{sequence_context,block_exercise_count}')::int,0)=1
      and r#>'{sequence_context,previous}'='null'::jsonb
      and coalesce((r#>>'{sequence_context,protocol_repeat_evidence}')::boolean,false)=false
      then 'ISOLATED_SKILL_OBSERVATION'
    when r_block='wod' and (
      coalesce((r#>>'{sequence_context,previous,has_primary_local_muscle_overlap}')::boolean,false)
      or coalesce((r#>>'{sequence_context,cycle_predecessor,has_primary_local_muscle_overlap}')::boolean,false)
      or coalesce((r#>>'{sequence_context,protocol_repeat_evidence}')::boolean,false)
      or r#>'{fatigue_context,whole_wod_local_fatigue_fit}' is not null
      or r#>'{fatigue_context,whole_wod_local_fatigue_concentration_index}' is not null
    ) then 'FATIGUE_CONTEXT_PRESENT'
    else 'CONTEXTUAL_OBSERVATION'
  end;

  if l#>'{observation,raw_performance,reps_completed}' is not null and l#>'{observation,raw_performance,reps_completed}' <> 'null'::jsonb then l_metrics := array_append(l_metrics,'reps'); end if;
  if l#>'{observation,raw_performance,weight_kg}' is not null and l#>'{observation,raw_performance,weight_kg}' <> 'null'::jsonb then l_metrics := array_append(l_metrics,'load'); end if;
  if l#>'{observation,raw_performance,duration_seconds}' is not null and l#>'{observation,raw_performance,duration_seconds}' <> 'null'::jsonb then l_metrics := array_append(l_metrics,'time'); end if;
  if l#>'{observation,raw_performance,distance_meters}' is not null and l#>'{observation,raw_performance,distance_meters}' <> 'null'::jsonb then l_metrics := array_append(l_metrics,'distance'); end if;

  if r#>'{observation,raw_performance,reps_completed}' is not null and r#>'{observation,raw_performance,reps_completed}' <> 'null'::jsonb then r_metrics := array_append(r_metrics,'reps'); end if;
  if r#>'{observation,raw_performance,weight_kg}' is not null and r#>'{observation,raw_performance,weight_kg}' <> 'null'::jsonb then r_metrics := array_append(r_metrics,'load'); end if;
  if r#>'{observation,raw_performance,duration_seconds}' is not null and r#>'{observation,raw_performance,duration_seconds}' <> 'null'::jsonb then r_metrics := array_append(r_metrics,'time'); end if;
  if r#>'{observation,raw_performance,distance_meters}' is not null and r#>'{observation,raw_performance,distance_meters}' <> 'null'::jsonb then r_metrics := array_append(r_metrics,'distance'); end if;

  select coalesce(array_agg(x order by x),'{}'::text[])
  into shared_metrics
  from (
    select unnest(l_metrics) x
    intersect
    select unnest(r_metrics) x
  ) s;

  if l_exercise is distinct from r_exercise then
    result_status := 'DIFFERENT_EXERCISE';
    reasons := reasons || jsonb_build_array('exercise_differs');
  elsif cardinality(shared_metrics)=0 then
    result_status := 'DIFFERENT_METRIC';
    reasons := reasons || jsonb_build_array('no_shared_observed_metric');
  elsif l_block is not distinct from r_block
    and l_mechanic is not distinct from r_mechanic
    and l_fatigue_class = r_fatigue_class then
    result_status := 'STRICTLY_COMPARABLE';
    reasons := reasons || jsonb_build_array('same_exercise','shared_metric','same_block','same_mechanic','same_fatigue_context_class');
  elsif l_block is not distinct from r_block then
    result_status := 'RELATED_CONTEXT';
    reasons := reasons || jsonb_build_array('same_exercise','shared_metric','same_block');
    if l_mechanic is distinct from r_mechanic then reasons := reasons || jsonb_build_array('mechanic_differs'); end if;
    if l_fatigue_class <> r_fatigue_class then reasons := reasons || jsonb_build_array('fatigue_context_class_differs'); end if;
  else
    result_status := 'DIFFERENT_CONTEXT';
    reasons := reasons || jsonb_build_array('same_exercise','shared_metric','block_differs');
  end if;

  return jsonb_build_object(
    'version','w4-performance-comparability-v1',
    'status',result_status,
    'comparable',result_status='STRICTLY_COMPARABLE',
    'related_context',result_status='RELATED_CONTEXT',
    'left_exercise_log_id',p_left_exercise_log_id,
    'right_exercise_log_id',p_right_exercise_log_id,
    'exercise_id',case when l_exercise is not distinct from r_exercise then l_exercise else null end,
    'shared_metrics',to_jsonb(shared_metrics),
    'left_context',jsonb_build_object('block_key',l_block,'mechanic',l_mechanic,'movement_pattern',l_pattern,'fatigue_context_class',l_fatigue_class,'context_key',l->>'context_key'),
    'right_context',jsonb_build_object('block_key',r_block,'mechanic',r_mechanic,'movement_pattern',r_pattern,'fatigue_context_class',r_fatigue_class,'context_key',r->>'context_key'),
    'reasons',reasons,
    'semantics',jsonb_build_object(
      'strict_comparability_requires_same_exercise_shared_metric_same_block_same_mechanic_same_fatigue_context_class',true,
      'related_context_is_not_strictly_comparable',true,
      'no_numeric_similarity_score',true,
      'no_arbitrary_multiplier_or_threshold',true,
      'raw_performance_immutable',true,
      'missing_context_is_not_weakness',true,
      'no_better_or_worse_claim_in_this_function',true
    )
  );
end;
$$;

revoke all on function public.w4_performance_comparability_v1(bigint,bigint) from public, anon;
grant execute on function public.w4_performance_comparability_v1(bigint,bigint) to authenticated, service_role, postgres;
