-- Phase B2.7.1 — controlled activation of the real exercise capability loop.
-- Keeps legacy progression + shadow engine in parallel.

insert into public.performance_engine_policy(
  policy_key,engine_version,positive_confirmations_required,negative_confirmations_required,
  confidence_half_evidence,positive_candidate_evidence_factor,negative_candidate_evidence_factor,
  freshness_half_life_days,active,notes,updated_at
)
select
  'b2.7-live-default','b2.7-live-1',positive_confirmations_required,negative_confirmations_required,
  confidence_half_evidence,positive_candidate_evidence_factor,negative_candidate_evidence_factor,
  freshness_half_life_days,true,
  'B2.7 controlled live policy. Legacy user_exercise_progress and B2.6 shadow remain in parallel during transition.',
  now()
from public.performance_engine_policy
where policy_key='b2.5-draft-default'
on conflict (policy_key) do update set
  engine_version=excluded.engine_version,
  positive_confirmations_required=excluded.positive_confirmations_required,
  negative_confirmations_required=excluded.negative_confirmations_required,
  confidence_half_evidence=excluded.confidence_half_evidence,
  positive_candidate_evidence_factor=excluded.positive_candidate_evidence_factor,
  negative_candidate_evidence_factor=excluded.negative_candidate_evidence_factor,
  freshness_half_life_days=excluded.freshness_half_life_days,
  active=true,
  notes=excluded.notes,
  updated_at=now();

update public.performance_engine_policy
set active=false,updated_at=now()
where policy_key<>'b2.7-live-default' and active;

create table if not exists public.capability_live_run_errors(
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null references public.workout_sessions(id) on delete cascade,
  error_text text not null,
  created_at timestamptz not null default now()
);

alter table public.capability_live_run_errors enable row level security;

drop policy if exists capability_live_run_errors_select_own on public.capability_live_run_errors;
create policy capability_live_run_errors_select_own
on public.capability_live_run_errors for select
to authenticated
using (user_id=auth.uid());

drop policy if exists capability_live_run_errors_insert_own on public.capability_live_run_errors;
create policy capability_live_run_errors_insert_own
on public.capability_live_run_errors for insert
to authenticated
with check (user_id=auth.uid());

-- One applied live proposal per exact log + capability family + fresh/repeatable mode.
create unique index if not exists uq_capability_update_event_live_observation
on public.capability_update_events(
  exercise_log_id,
  capability_family,
  ((comparison_json->>'capability_mode'))
)
where applied and exercise_log_id is not null and (comparison_json->>'capability_mode') is not null;

create or replace function public.run_capability_live_session(
  p_session_id uuid,
  p_engine_policy_key text default 'b2.7-live-default',
  p_quality_policy_key text default 'b2.6-adapter-draft-1'
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_user_id uuid;
  v_policy_active boolean;
  v_log record;
  v_adapter jsonb;
  v_update jsonb;
  v_result jsonb;
  v_family text;
  v_mode text;
  v_applied int:=0;
  v_skipped_existing int:=0;
  v_excluded int:=0;
  v_protocol_scoped int:=0;
begin
  select user_id into v_user_id
  from public.workout_sessions
  where id=p_session_id;

  if not found then
    raise exception 'Unknown session %',p_session_id;
  end if;

  if auth.uid() is not null and auth.uid()<>v_user_id then
    raise exception 'Cannot run live capability engine for another user session';
  end if;

  select active into v_policy_active
  from public.performance_engine_policy
  where policy_key=p_engine_policy_key;

  if not found then
    raise exception 'Unknown performance engine policy %',p_engine_policy_key;
  end if;

  if not coalesce(v_policy_active,false) then
    raise exception 'Performance engine policy % is not active',p_engine_policy_key;
  end if;

  for v_log in
    select id,user_id,exercise_id,session_exercise_id,created_at
    from public.exercise_logs
    where session_id=p_session_id
    order by created_at,id
  loop
    v_adapter:=public.build_capability_observation_inputs(v_log.id,p_quality_policy_key);

    if coalesce((v_adapter->>'excluded')::boolean,false) then
      v_excluded:=v_excluded+1;
      continue;
    end if;

    for v_update in
      select value from jsonb_array_elements(coalesce(v_adapter->'updates','[]'::jsonb))
    loop
      v_family:=v_update->>'family';
      v_mode:=v_update->>'capability_mode';

      -- Density/progressive belong to protocol capability, not an isolated exercise.
      if v_family not in ('reps','load_reps','time','pace','loaded_distance') then
        v_protocol_scoped:=v_protocol_scoped+1;
        continue;
      end if;

      if exists(
        select 1
        from public.capability_update_events cue
        where cue.exercise_log_id=v_log.id
          and cue.capability_family=v_family
          and cue.applied
          and cue.comparison_json->>'capability_mode'=v_mode
      ) then
        v_skipped_existing:=v_skipped_existing+1;
        continue;
      end if;

      v_result:=public.apply_capability_observation(
        v_log.user_id,
        v_log.exercise_id::varchar,
        v_log.id,
        v_family,
        coalesce(v_adapter->'expected','{}'::jsonb),
        coalesce(v_adapter->'actual','{}'::jsonb),
        coalesce((v_update->>'quality')::numeric,0),
        coalesce((v_adapter->>'capability_eligible')::boolean,false),
        coalesce((v_adapter->>'pain_affected')::boolean,false),
        coalesce(v_adapter->>'observation_role','CAPABILITY_EXCLUDED'),
        coalesce(v_update->'comparison','{}'::jsonb),
        p_engine_policy_key,
        coalesce(v_log.created_at,now())
      );

      if coalesce((v_result->>'applied')::boolean,false) then
        v_applied:=v_applied+1;
      end if;
    end loop;
  end loop;

  return jsonb_build_object(
    'version','b2.7-live-runtime-1',
    'session_id',p_session_id,
    'user_id',v_user_id,
    'policy_key',p_engine_policy_key,
    'quality_policy_key',p_quality_policy_key,
    'applied_proposals',v_applied,
    'skipped_existing_proposals',v_skipped_existing,
    'excluded_observations',v_excluded,
    'protocol_scoped_proposals',v_protocol_scoped,
    'legacy_progression_preserved',true,
    'shadow_engine_preserved',true,
    'real_capability_mutated',v_applied>0
  );
end;
$$;

comment on function public.run_capability_live_session(uuid,text,text)
is 'B2.7 controlled live capability runner. Applies exact per-exercise observations idempotently while preserving legacy progression and shadow runtime.';

grant execute on function public.run_capability_live_session(uuid,text,text) to authenticated;;
