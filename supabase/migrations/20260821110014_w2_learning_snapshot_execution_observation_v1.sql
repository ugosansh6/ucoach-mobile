create or replace function public.w2_progression_session_learning_snapshot_v1(p_session_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path=public
as $$
declare
  v_base jsonb;
  v_execution jsonb;
begin
  v_base:=public.progression_session_learning_snapshot_v1(p_session_id);
  v_execution:=public.w2_session_execution_observation_v1(p_session_id);
  return coalesce(v_base,'{}'::jsonb)
    || jsonb_build_object(
      'version','w2-session-learning-snapshot-v1',
      'execution_observation',coalesce(v_execution,'{}'::jsonb)
    )
    || jsonb_build_object(
      'semantics',coalesce(v_base->'semantics','{}'::jsonb)||jsonb_build_object(
        'controlled_timing_only',true,
        'pacing_requires_complete_split_coverage',true,
        'execution_trace_is_not_source_of_truth',true
      )
    );
end; $$;
revoke all on function public.w2_progression_session_learning_snapshot_v1(uuid) from public,anon;
grant execute on function public.w2_progression_session_learning_snapshot_v1(uuid) to authenticated,service_role;
