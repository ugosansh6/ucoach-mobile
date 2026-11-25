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
  if auth.uid() is not null and auth.uid()<>p_user_id then
    raise exception 'Forbidden user';
  end if;

  r:=public.w3_capability_model_pre_cap002_v1(p_user_id,v_anchor);
  r:=jsonb_set(r,'{version}','"w3-athlete-capability-model-v1.1"'::jsonb,true);
  r:=jsonb_set(r,'{authority}',coalesce(r->'authority','{}'::jsonb)||jsonb_build_object(
    'performance_context','w4_performance_context_v1',
    'context_partition_reader','w3_capability_context_observations_v1'
  ),true);
  r:=jsonb_set(r,'{semantics}',(coalesce(r->'semantics','{}'::jsonb)-'isolated_vs_fatigued_context_not_yet_interpreted')||jsonb_build_object(
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

comment on function public.w3_capability_model_v1(uuid,date) is 'W3 Capability Model V1.1. CAP-002 activated through W4 CTX-001 context descriptors; raw capability envelopes remain unchanged and context classes are qualitative evidence only.';
