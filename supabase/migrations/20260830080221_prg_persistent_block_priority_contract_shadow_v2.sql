alter table public.program_coach_blocks
  add column if not exists priority_contract_json jsonb not null default '{}'::jsonb,
  add column if not exists priority_contract_version text,
  add column if not exists priority_locked_at timestamptz,
  add column if not exists priority_last_reviewed_at timestamptz;

comment on column public.program_coach_blocks.priority_contract_json is
'Coach V2 persistent cycle priority contract. Separate from legacy priorities_json until V2 authority is activated.';

create or replace function public.program_coach_priority_contract_from_resolver_v2(p_resolver jsonb)
returns jsonb
language sql
immutable
set search_path to 'public','pg_temp'
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'version','program-coach-persistent-priority-v2',
    'primary_goal',p_resolver->>'primary_goal',
    'primary_priority',p_resolver->'primary_priority',
    'secondary_priority',p_resolver->'secondary_priority',
    'maintenance',coalesce(p_resolver->'maintenance','[]'::jsonb),
    'unknown_patterns',coalesce(p_resolver->'unknown_patterns','[]'::jsonb),
    'decision_order',coalesce(p_resolver->'decision_order','[]'::jsonb),
    'environment_context',coalesce(p_resolver->'environment_context','{}'::jsonb),
    'source_resolver_version',p_resolver->>'version',
    'semantics',jsonb_build_object(
      'persistent_until_strategy_review',true,
      'actuals_change_dose_or_week_not_cycle_priority',true,
      'priority_switch_requires_lifecycle_transition',true,
      'legacy_numeric_weights_are_not_authority',true,
      'missing_evidence_is_not_weakness',true
    )
  ));
$$;

create or replace function public.program_coach_seed_priority_contract_shadow_v2(
  p_user_id uuid,
  p_anchor_date date default current_date
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_block public.program_coach_blocks%rowtype;
  v_resolver jsonb;
  v_contract jsonb;
begin
  if p_user_id is null then raise exception 'User required'; end if;
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;

  select * into v_block
  from public.program_coach_blocks
  where user_id=p_user_id and layer_type='BASE' and status='active'
  order by started_on desc,created_at desc limit 1
  for update;

  if not found then
    return jsonb_build_object('status','NO_ACTIVE_BLOCK','mode','SHADOW_METADATA_ONLY');
  end if;

  if coalesce(v_block.priority_contract_json,'{}'::jsonb)<>'{}'::jsonb then
    return jsonb_build_object(
      'status','EXISTING_PERSISTENT_PRIORITY','mode','SHADOW_METADATA_ONLY',
      'block_id',v_block.id,'locked_at',v_block.priority_locked_at,
      'priority_contract',v_block.priority_contract_json,'overwritten',false
    );
  end if;

  v_resolver:=public.program_coach_cycle_priority_resolver_v2(p_user_id,coalesce(p_anchor_date,current_date));
  if coalesce(v_resolver->>'status','')<>'PRIORITY_CANDIDATE_READY' then
    return jsonb_build_object(
      'status','PRIORITY_NOT_READY','mode','SHADOW_METADATA_ONLY','block_id',v_block.id,
      'resolver',v_resolver,'overwritten',false
    );
  end if;

  v_contract:=public.program_coach_priority_contract_from_resolver_v2(v_resolver);
  update public.program_coach_blocks
  set priority_contract_json=v_contract,
      priority_contract_version='program-coach-persistent-priority-v2',
      priority_locked_at=now(),
      priority_last_reviewed_at=now(),
      updated_at=now()
  where id=v_block.id;

  return jsonb_build_object(
    'status','SEEDED_PERSISTENT_PRIORITY','mode','SHADOW_METADATA_ONLY','block_id',v_block.id,
    'priority_contract',v_contract,'overwritten',false,'generation_authority',false
  );
end;
$function$;

create or replace function public.program_coach_block_priority_snapshot_v2(
  p_user_id uuid,
  p_anchor_date date default current_date
)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_block public.program_coach_blocks%rowtype;
  v_candidate jsonb;
begin
  if p_user_id is null then raise exception 'User required'; end if;
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;

  select * into v_block
  from public.program_coach_blocks
  where user_id=p_user_id and layer_type='BASE' and status='active'
  order by started_on desc,created_at desc limit 1;

  if found and coalesce(v_block.priority_contract_json,'{}'::jsonb)<>'{}'::jsonb then
    return jsonb_build_object(
      'version','program-coach-block-priority-snapshot-v2','status','PERSISTED','mode','SHADOW_READ_ONLY',
      'block_id',v_block.id,'locked_at',v_block.priority_locked_at,'last_reviewed_at',v_block.priority_last_reviewed_at,
      'priority_contract',v_block.priority_contract_json,'generation_authority',false
    );
  end if;

  v_candidate:=public.program_coach_cycle_priority_resolver_v2(p_user_id,coalesce(p_anchor_date,current_date));
  return jsonb_build_object(
    'version','program-coach-block-priority-snapshot-v2',
    'status',case when found then 'UNPERSISTED_CANDIDATE' else 'NO_ACTIVE_BLOCK_CANDIDATE' end,
    'mode','SHADOW_READ_ONLY','block_id',case when found then v_block.id else null end,
    'priority_contract',public.program_coach_priority_contract_from_resolver_v2(v_candidate),
    'generation_authority',false
  );
end;
$function$;

revoke execute on function public.program_coach_priority_contract_from_resolver_v2(jsonb) from anon;
revoke execute on function public.program_coach_seed_priority_contract_shadow_v2(uuid,date) from anon;
revoke execute on function public.program_coach_block_priority_snapshot_v2(uuid,date) from anon;
grant execute on function public.program_coach_priority_contract_from_resolver_v2(jsonb) to authenticated;
grant execute on function public.program_coach_seed_priority_contract_shadow_v2(uuid,date) to authenticated;
grant execute on function public.program_coach_block_priority_snapshot_v2(uuid,date) to authenticated;
