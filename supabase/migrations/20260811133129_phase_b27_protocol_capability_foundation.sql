-- Phase B2.7.2 — protocol-level capability foundation.
-- Progressive/density performance belongs to the complete protocol, not to one exercise row.

alter table public.workout_sessions
add column if not exists actual_protocol_outcome_json jsonb not null default '{}'::jsonb;

alter table public.workout_sessions
drop constraint if exists workout_sessions_actual_protocol_outcome_object;
alter table public.workout_sessions
add constraint workout_sessions_actual_protocol_outcome_object
check (jsonb_typeof(actual_protocol_outcome_json)='object');

create table if not exists public.user_protocol_capabilities(
  user_id uuid not null references auth.users(id) on delete cascade,
  protocol_signature text not null,
  mechanic_key text not null,
  variant_key text,
  protocol_json jsonb not null default '{}'::jsonb,
  best_outcome_json jsonb not null default '{}'::jsonb,
  latest_outcome_json jsonb not null default '{}'::jsonb,
  confidence numeric not null default 0 check (confidence between 0 and 1),
  freshness numeric not null default 0 check (freshness between 0 and 1),
  effective_evidence numeric not null default 0 check (effective_evidence>=0),
  evidence_count integer not null default 0 check (evidence_count>=0),
  valid_evidence_count integer not null default 0 check (valid_evidence_count>=0),
  last_observed_at timestamptz,
  last_valid_observed_at timestamptz,
  engine_version text not null default 'b2.7-protocol-1',
  updated_at timestamptz not null default now(),
  primary key(user_id,protocol_signature)
);

create table if not exists public.protocol_capability_events(
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null references public.workout_sessions(id) on delete cascade,
  protocol_signature text not null,
  mechanic_key text not null,
  variant_key text,
  protocol_kind text not null,
  decision text not null,
  quality numeric not null default 0 check (quality between 0 and 1),
  expected_json jsonb not null default '{}'::jsonb,
  actual_json jsonb not null default '{}'::jsonb,
  before_json jsonb not null default '{}'::jsonb,
  after_json jsonb not null default '{}'::jsonb,
  reason_codes text[] not null default '{}'::text[],
  applied boolean not null default true,
  created_at timestamptz not null default now(),
  unique(session_id,protocol_signature)
);

alter table public.user_protocol_capabilities enable row level security;
alter table public.protocol_capability_events enable row level security;

drop policy if exists user_protocol_capabilities_own_all on public.user_protocol_capabilities;
create policy user_protocol_capabilities_own_all
on public.user_protocol_capabilities for all
to authenticated
using (user_id=auth.uid())
with check (user_id=auth.uid());

drop policy if exists protocol_capability_events_select_own on public.protocol_capability_events;
create policy protocol_capability_events_select_own
on public.protocol_capability_events for select
to authenticated
using (user_id=auth.uid());

create or replace function public.build_session_protocol_descriptor(p_session_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  v_user_id uuid;
  v_mechanic text;
  v_variant text;
  v_parameters jsonb;
  v_exercises jsonb;
  v_protocol jsonb;
  v_signature text;
begin
  select
    ws.user_id,
    upper(coalesce(
      nullif(ws.mechanic_json->>'mechanic_key',''),
      nullif(ws.mechanic_json->>'mechanic',''),
      nullif(ws.mechanic_json->>'kind',''),
      nullif(ws.generated_workout->'meta'->>'format',''),
      'UNKNOWN'
    )),
    upper(nullif(coalesce(
      ws.mechanic_json->>'variant_key',
      ws.mechanic_json#>>'{parameters,variant_key}'
    ),'')),
    coalesce(ws.mechanic_json->'parameters','{}'::jsonb)
  into v_user_id,v_mechanic,v_variant,v_parameters
  from public.workout_sessions ws
  where ws.id=p_session_id;

  if not found then raise exception 'Unknown session %',p_session_id; end if;
  if auth.uid() is not null and auth.uid()<>v_user_id then
    raise exception 'Cannot inspect another user protocol';
  end if;

  select coalesce(jsonb_agg(
    jsonb_strip_nulls(jsonb_build_object(
      'exercise_id',wse.exercise_id,
      'position',wse.position,
      'prescription',coalesce(wse.prescription_json,'{}'::jsonb)
    )) order by wse.position,wse.id
  ),'[]'::jsonb)
  into v_exercises
  from public.workout_session_exercises wse
  where wse.session_id=p_session_id and wse.block_key='wod';

  v_protocol:=jsonb_strip_nulls(jsonb_build_object(
    'mechanic_key',v_mechanic,
    'variant_key',v_variant,
    'parameters',v_parameters,
    'exercises',v_exercises
  ));

  v_signature:=lower(v_mechanic)||':'||lower(coalesce(v_variant,'base'))||':'||md5(v_protocol::text);

  return jsonb_build_object(
    'protocol_signature',v_signature,
    'mechanic_key',v_mechanic,
    'variant_key',v_variant,
    'protocol_json',v_protocol,
    'exercise_count',jsonb_array_length(v_exercises),
    'version','b2.7-protocol-signature-1'
  );
end;
$$;

create or replace function public.apply_session_protocol_observation(
  p_session_id uuid,
  p_quality numeric default null,
  p_policy_key text default 'b2.7-live-default'
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_user_id uuid;
  v_expected jsonb;
  v_actual jsonb;
  v_observed_at timestamptz;
  v_desc jsonb;
  v_signature text;
  v_mechanic text;
  v_variant text;
  v_kind text;
  v_quality numeric;
  v_policy record;
  v_old public.user_protocol_capabilities%rowtype;
  v_before jsonb:='{}'::jsonb;
  v_best jsonb:='{}'::jsonb;
  v_stage numeric;
  v_partial numeric;
  v_old_stage numeric;
  v_old_partial numeric;
  v_effective numeric:=0;
  v_conf numeric:=0;
  v_decision text;
  v_reason text[]:='{}'::text[];
begin
  select ws.user_id,
         coalesce(nullif(ws.mechanic_json,'{}'::jsonb),ws.generated_workout->'meta','{}'::jsonb),
         coalesce(ws.actual_protocol_outcome_json,'{}'::jsonb),
         coalesce(ws.completed_at,ws.updated_at,now())
  into v_user_id,v_expected,v_actual,v_observed_at
  from public.workout_sessions ws where ws.id=p_session_id;

  if not found then raise exception 'Unknown session %',p_session_id; end if;
  if auth.uid() is not null and auth.uid()<>v_user_id then
    raise exception 'Cannot update another user protocol capability';
  end if;

  if v_actual='{}'::jsonb then
    return jsonb_build_object('version','b2.7-protocol-runtime-1','status','SKIPPED','reason','NO_PROTOCOL_ACTUAL','session_id',p_session_id);
  end if;

  if coalesce((v_actual->>'pain_affected')::boolean,false) then
    return jsonb_build_object('version','b2.7-protocol-runtime-1','status','SKIPPED','reason','PAIN_STATE_ONLY','session_id',p_session_id);
  end if;

  select * into v_policy from public.performance_engine_policy where policy_key=p_policy_key and active;
  if not found then raise exception 'Active performance policy % not found',p_policy_key; end if;

  v_desc:=public.build_session_protocol_descriptor(p_session_id);
  v_signature:=v_desc->>'protocol_signature';
  v_mechanic:=v_desc->>'mechanic_key';
  v_variant:=nullif(v_desc->>'variant_key','');

  v_kind:=case
    when coalesce(v_variant,'') in ('DEATH_BY','DEATH_BY_COUPLET') or v_mechanic='PROGRESSIVE_INTERVAL' then 'progressive_limit'
    when v_actual ? 'rounds_completed' or v_actual ? 'work_seconds' then 'density'
    else 'generic_protocol'
  end;

  v_quality:=greatest(0,least(1,coalesce(
    p_quality,
    nullif(v_actual->>'observation_quality','')::numeric,
    case when v_kind='progressive_limit' and v_actual ? 'last_completed_stage' then 0.90 else 0.70 end
  )));

  if exists(select 1 from public.protocol_capability_events where session_id=p_session_id and protocol_signature=v_signature and applied) then
    return jsonb_build_object('version','b2.7-protocol-runtime-1','status','IDEMPOTENT_SKIP','protocol_signature',v_signature,'session_id',p_session_id);
  end if;

  select * into v_old
  from public.user_protocol_capabilities
  where user_id=v_user_id and protocol_signature=v_signature
  for update;

  if found then
    v_before:=jsonb_build_object(
      'best_outcome_json',v_old.best_outcome_json,
      'latest_outcome_json',v_old.latest_outcome_json,
      'confidence',v_old.confidence,
      'freshness',v_old.freshness,
      'effective_evidence',v_old.effective_evidence,
      'evidence_count',v_old.evidence_count,
      'valid_evidence_count',v_old.valid_evidence_count
    );
    v_best:=coalesce(v_old.best_outcome_json,'{}'::jsonb);
    v_effective:=coalesce(v_old.effective_evidence,0)+v_quality;
  else
    v_effective:=v_quality;
  end if;

  if v_kind='progressive_limit' then
    v_stage:=nullif(v_actual->>'last_completed_stage','')::numeric;
    v_partial:=coalesce(nullif(v_actual->>'partial_next_stage_reps','')::numeric,0);
    if v_stage is null then
      return jsonb_build_object('version','b2.7-protocol-runtime-1','status','SKIPPED','reason','PROGRESSIVE_STAGE_MISSING','protocol_signature',v_signature);
    end if;

    v_old_stage:=nullif(v_best->>'last_completed_stage','')::numeric;
    v_old_partial:=coalesce(nullif(v_best->>'partial_next_stage_reps','')::numeric,0);

    if v_old_stage is null then
      v_best:=v_actual;
      v_decision:='INITIALIZE_PROTOCOL';
    elsif v_stage>v_old_stage or (v_stage=v_old_stage and v_partial>v_old_partial) then
      v_best:=v_actual;
      v_decision:='EXPAND_PROTOCOL_FRONTIER';
    elsif v_stage=v_old_stage and v_partial=v_old_partial then
      v_decision:='CONFIRM_PROTOCOL';
    else
      v_decision:='HOLD_BEST_RECALIBRATION_PENDING';
      v_reason:=array['LOWER_SINGLE_PROTOCOL_RESULT_DOES_NOT_REGRESS_BEST'];
    end if;
  else
    if v_best='{}'::jsonb then v_best:=v_actual; end if;
    v_decision:=case when found then 'CONFIRM_PROTOCOL_CONTEXT' else 'INITIALIZE_PROTOCOL_CONTEXT' end;
  end if;

  v_conf:=public.capability_confidence_from_evidence(v_effective,v_policy.confidence_half_evidence);

  insert into public.user_protocol_capabilities(
    user_id,protocol_signature,mechanic_key,variant_key,protocol_json,best_outcome_json,latest_outcome_json,
    confidence,freshness,effective_evidence,evidence_count,valid_evidence_count,last_observed_at,last_valid_observed_at,
    engine_version,updated_at
  ) values (
    v_user_id,v_signature,v_mechanic,v_variant,v_desc->'protocol_json',v_best,v_actual,
    v_conf,1,v_effective,coalesce(v_old.evidence_count,0)+1,coalesce(v_old.valid_evidence_count,0)+1,
    v_observed_at,v_observed_at,'b2.7-protocol-1',now()
  )
  on conflict(user_id,protocol_signature) do update set
    mechanic_key=excluded.mechanic_key,variant_key=excluded.variant_key,protocol_json=excluded.protocol_json,
    best_outcome_json=excluded.best_outcome_json,latest_outcome_json=excluded.latest_outcome_json,
    confidence=excluded.confidence,freshness=excluded.freshness,effective_evidence=excluded.effective_evidence,
    evidence_count=excluded.evidence_count,valid_evidence_count=excluded.valid_evidence_count,
    last_observed_at=excluded.last_observed_at,last_valid_observed_at=excluded.last_valid_observed_at,
    engine_version=excluded.engine_version,updated_at=now();

  insert into public.protocol_capability_events(
    user_id,session_id,protocol_signature,mechanic_key,variant_key,protocol_kind,decision,quality,
    expected_json,actual_json,before_json,after_json,reason_codes,applied
  ) values (
    v_user_id,p_session_id,v_signature,v_mechanic,v_variant,v_kind,v_decision,v_quality,
    v_expected,v_actual,v_before,jsonb_build_object(
      'best_outcome_json',v_best,'latest_outcome_json',v_actual,'confidence',v_conf,'freshness',1,
      'effective_evidence',v_effective
    ),v_reason,true
  );

  return jsonb_build_object(
    'version','b2.7-protocol-runtime-1','status','APPLIED','session_id',p_session_id,
    'protocol_signature',v_signature,'protocol_kind',v_kind,'decision',v_decision,
    'quality',v_quality,'confidence',v_conf,'best_outcome',v_best
  );
end;
$$;

grant execute on function public.build_session_protocol_descriptor(uuid) to authenticated;
grant execute on function public.apply_session_protocol_observation(uuid,numeric,text) to authenticated;

comment on table public.user_protocol_capabilities is
'Protocol-level capability state for multi-exercise or mechanic-specific performance (e.g. Death By Couplet). Kept separate from per-exercise capability.';

comment on function public.apply_session_protocol_observation(uuid,numeric,text) is
'B2.7 protocol capability updater. Progressive-limit protocols such as Death By/Death By Couplet use last completed stage + partial next-stage work as a high-quality performance boundary. One lower result never regresses the stored best.';
