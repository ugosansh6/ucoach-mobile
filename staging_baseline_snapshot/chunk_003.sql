

-- SOURCE MIGRATION: 20260811134027_phase_b27_progressive_protocol_boundary.sql
-- B2.7 progressive protocol refinement.
-- Death By / Death By Couplet performance is a protocol boundary, potentially censored by a time cap.

alter table public.protocol_capability_events
add column if not exists boundary_type text;

create or replace function public.protocol_partial_progress_ratio(
  p_protocol jsonb,
  p_actual jsonb
)
returns numeric
language plpgsql
immutable
set search_path=public
as $$
declare
  v_explicit numeric;
  v_failed_stage numeric;
  v_ex jsonb;
  v_id text;
  v_pres jsonb;
  v_start numeric;
  v_increment numeric;
  v_target numeric;
  v_actual_reps numeric;
  v_target_total numeric:=0;
  v_actual_total numeric:=0;
  v_count int:=0;
begin
  v_explicit:=nullif(p_actual->>'partial_progress_ratio','')::numeric;
  if v_explicit is not null then
    return greatest(0,least(1,v_explicit));
  end if;

  v_failed_stage:=coalesce(
    nullif(p_actual->>'failed_stage','')::numeric,
    nullif(p_actual->>'last_completed_stage','')::numeric + 1
  );

  if v_failed_stage is null then return 0; end if;

  if jsonb_typeof(p_actual->'partial_reps_by_exercise')='object' then
    for v_ex in select value from jsonb_array_elements(coalesce(p_protocol->'exercises','[]'::jsonb))
    loop
      v_count:=v_count+1;
      v_id:=v_ex->>'exercise_id';
      v_pres:=coalesce(v_ex->'prescription','{}'::jsonb);
      v_start:=coalesce(nullif(v_pres->>'start_reps','')::numeric,nullif(v_pres->>'reps_min','')::numeric,0);
      v_increment:=coalesce(nullif(v_pres->>'increment_reps','')::numeric,0);
      v_target:=greatest(0,v_start + greatest(0,v_failed_stage-1)*v_increment);
      v_actual_reps:=greatest(0,coalesce(nullif(p_actual->'partial_reps_by_exercise'->>v_id,'')::numeric,0));
      v_target_total:=v_target_total+v_target;
      v_actual_total:=v_actual_total+least(v_target,v_actual_reps);
    end loop;

    if v_count>0 and v_target_total>0 then
      return greatest(0,least(1,v_actual_total/v_target_total));
    end if;
  end if;

  -- Single-exercise fallback only. Raw partial reps are not compared across a couplet.
  if jsonb_array_length(coalesce(p_protocol->'exercises','[]'::jsonb))=1
     and nullif(p_actual->>'partial_next_stage_reps','') is not null then
    v_ex:=p_protocol->'exercises'->0;
    v_pres:=coalesce(v_ex->'prescription','{}'::jsonb);
    v_start:=coalesce(nullif(v_pres->>'start_reps','')::numeric,nullif(v_pres->>'reps_min','')::numeric,0);
    v_increment:=coalesce(nullif(v_pres->>'increment_reps','')::numeric,0);
    v_target:=greatest(0,v_start + greatest(0,v_failed_stage-1)*v_increment);
    if v_target>0 then
      return greatest(0,least(1,(p_actual->>'partial_next_stage_reps')::numeric/v_target));
    end if;
  end if;

  return 0;
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
  v_protocol jsonb;
  v_signature text;
  v_mechanic text;
  v_variant text;
  v_kind text;
  v_boundary_type text:='generic';
  v_quality numeric;
  v_policy record;
  v_old public.user_protocol_capabilities%rowtype;
  v_before jsonb:='{}'::jsonb;
  v_best jsonb:='{}'::jsonb;
  v_stage numeric;
  v_partial_ratio numeric:=0;
  v_old_stage numeric;
  v_old_partial_ratio numeric:=0;
  v_effective numeric:=0;
  v_conf numeric:=0;
  v_decision text;
  v_reason text[]:='{}'::text[];
  v_right_censored boolean:=false;
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
    return jsonb_build_object('version','b2.7-protocol-runtime-2','status','SKIPPED','reason','NO_PROTOCOL_ACTUAL','session_id',p_session_id);
  end if;

  if coalesce((v_actual->>'pain_affected')::boolean,false) then
    return jsonb_build_object('version','b2.7-protocol-runtime-2','status','SKIPPED','reason','PAIN_STATE_ONLY','session_id',p_session_id);
  end if;

  select * into v_policy from public.performance_engine_policy where policy_key=p_policy_key and active;
  if not found then raise exception 'Active performance policy % not found',p_policy_key; end if;

  v_desc:=public.build_session_protocol_descriptor(p_session_id);
  v_protocol:=coalesce(v_desc->'protocol_json','{}'::jsonb);
  v_signature:=v_desc->>'protocol_signature';
  v_mechanic:=v_desc->>'mechanic_key';
  v_variant:=nullif(v_desc->>'variant_key','');

  v_kind:=case
    when coalesce(v_variant,'') in ('DEATH_BY','DEATH_BY_COUPLET') or v_mechanic='PROGRESSIVE_INTERVAL' then 'progressive_limit'
    when v_actual ? 'rounds_completed' or v_actual ? 'work_seconds' then 'density'
    else 'generic_protocol'
  end;

  if v_kind='progressive_limit' then
    v_stage:=nullif(v_actual->>'last_completed_stage','')::numeric;
    if v_stage is null then
      return jsonb_build_object('version','b2.7-protocol-runtime-2','status','SKIPPED','reason','PROGRESSIVE_STAGE_MISSING','protocol_signature',v_signature);
    end if;

    v_right_censored:=coalesce((v_actual->>'completed_time_limit')::boolean,false)
      or coalesce((v_actual->>'hit_time_cap')::boolean,false);

    if v_right_censored and not (v_actual ? 'failed_stage') then
      v_boundary_type:='right_censored_time_cap';
    elsif v_actual ? 'failed_stage' then
      v_boundary_type:='observed_failure_boundary';
    else
      v_boundary_type:='observed_stage_boundary';
    end if;

    v_partial_ratio:=public.protocol_partial_progress_ratio(v_protocol,v_actual);
    v_actual:=v_actual || jsonb_build_object(
      'normalized_partial_progress_ratio',round(v_partial_ratio,4),
      'boundary_type',v_boundary_type
    );
  end if;

  v_quality:=greatest(0,least(1,coalesce(
    p_quality,
    nullif(v_actual->>'observation_quality','')::numeric,
    case
      when v_boundary_type='observed_failure_boundary' then 0.95
      when v_boundary_type='right_censored_time_cap' then 0.85
      when v_kind='progressive_limit' then 0.80
      else 0.70
    end
  )));

  if exists(select 1 from public.protocol_capability_events where session_id=p_session_id and protocol_signature=v_signature and applied) then
    return jsonb_build_object('version','b2.7-protocol-runtime-2','status','IDEMPOTENT_SKIP','protocol_signature',v_signature,'session_id',p_session_id);
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
    v_old_stage:=nullif(v_best->>'last_completed_stage','')::numeric;
    v_old_partial_ratio:=coalesce(nullif(v_best->>'normalized_partial_progress_ratio','')::numeric,0);

    if v_old_stage is null then
      v_best:=v_actual;
      v_decision:=case when v_boundary_type='right_censored_time_cap' then 'INITIALIZE_PROTOCOL_LOWER_BOUND' else 'INITIALIZE_PROTOCOL' end;
    elsif v_stage>v_old_stage or (v_stage=v_old_stage and v_partial_ratio>v_old_partial_ratio) then
      v_best:=v_actual;
      v_decision:=case when v_boundary_type='right_censored_time_cap' then 'EXPAND_PROTOCOL_LOWER_BOUND' else 'EXPAND_PROTOCOL_FRONTIER' end;
    elsif v_stage=v_old_stage and v_partial_ratio=v_old_partial_ratio then
      v_decision:=case when v_boundary_type='right_censored_time_cap' then 'CONFIRM_PROTOCOL_LOWER_BOUND' else 'CONFIRM_PROTOCOL' end;
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
    v_user_id,v_signature,v_mechanic,v_variant,v_protocol,v_best,v_actual,
    v_conf,1,v_effective,coalesce(v_old.evidence_count,0)+1,coalesce(v_old.valid_evidence_count,0)+1,
    v_observed_at,v_observed_at,'b2.7-protocol-2',now()
  )
  on conflict(user_id,protocol_signature) do update set
    mechanic_key=excluded.mechanic_key,variant_key=excluded.variant_key,protocol_json=excluded.protocol_json,
    best_outcome_json=excluded.best_outcome_json,latest_outcome_json=excluded.latest_outcome_json,
    confidence=excluded.confidence,freshness=excluded.freshness,effective_evidence=excluded.effective_evidence,
    evidence_count=excluded.evidence_count,valid_evidence_count=excluded.valid_evidence_count,
    last_observed_at=excluded.last_observed_at,last_valid_observed_at=excluded.last_valid_observed_at,
    engine_version=excluded.engine_version,updated_at=now();

  insert into public.protocol_capability_events(
    user_id,session_id,protocol_signature,mechanic_key,variant_key,protocol_kind,boundary_type,decision,quality,
    expected_json,actual_json,before_json,after_json,reason_codes,applied
  ) values (
    v_user_id,p_session_id,v_signature,v_mechanic,v_variant,v_kind,v_boundary_type,v_decision,v_quality,
    v_expected,v_actual,v_before,jsonb_build_object(
      'best_outcome_json',v_best,'latest_outcome_json',v_actual,'confidence',v_conf,'freshness',1,
      'effective_evidence',v_effective,'boundary_type',v_boundary_type
    ),v_reason,true
  );

  return jsonb_build_object(
    'version','b2.7-protocol-runtime-2','status','APPLIED','session_id',p_session_id,
    'protocol_signature',v_signature,'protocol_kind',v_kind,'boundary_type',v_boundary_type,
    'decision',v_decision,'quality',v_quality,'confidence',v_conf,'best_outcome',v_best
  );
end;
$$;

revoke all on function public.protocol_partial_progress_ratio(jsonb,jsonb) from public;
revoke all on function public.protocol_partial_progress_ratio(jsonb,jsonb) from anon;
revoke all on function public.protocol_partial_progress_ratio(jsonb,jsonb) from authenticated;
;



-- SOURCE MIGRATION: 20260811162304_phase_a2_calibrated_joint_impact_gate.sql
update public.session_engine_policy
set config = jsonb_set(
  jsonb_set(
    jsonb_set(
      jsonb_set(
        config #- '{quality_gate,max_joint_impact_5_count}',
        '{quality_gate,high_joint_impact_threshold}',
        '4'::jsonb,
        true
      ),
      '{quality_gate,low_readiness_max_high_joint_impact_count}',
      '1'::jsonb,
      true
    ),
    '{quality_gate,normal_readiness_max_high_joint_impact_count}',
    '2'::jsonb,
    true
  ),
  '{quality_gate,high_readiness_max_high_joint_impact_count}',
  '2'::jsonb,
  true
)
where policy_key = 'c4-final-default';

create or replace function public.c4_candidate_quality_gate(
  p_candidate jsonb,
  p_readiness text,
  p_focus text,
  p_zone_terms text[],
  p_inventory jsonb,
  p_max_complexity integer,
  p_policy_key text default 'c4-final-default'
)
returns jsonb
language plpgsql
stable
set search_path = public
as $function$
declare
  v_cfg jsonb;
  v_mechanic text := upper(coalesce(p_candidate->>'mechanic',''));
  v_zone_ids text[] := public.normalize_body_zone_ids(coalesce(p_zone_terms,'{}'::text[]));
  v_readiness text := public.normalize_session_readiness(p_readiness);
  v_ex jsonb;
  e record;
  v_reasons jsonb := '[]'::jsonb;
  v_jump int := 0;
  v_high_impact int := 0;
  v_high_impact_threshold int := 4;
  v_high_impact_max int := 2;
  v_emom_tech int := 0;
  v_emom_fatigue int := 0;
  v_hinge5 boolean := false;
  v_jump5 boolean := false;
  v_anchor boolean := false;
  v_count int := 0;
begin
  select config into v_cfg
  from public.session_engine_policy
  where policy_key = p_policy_key;

  if v_cfg is null then
    raise exception 'Unknown C4 policy %', p_policy_key;
  end if;

  v_high_impact_threshold := coalesce(
    (v_cfg#>>'{quality_gate,high_joint_impact_threshold}')::int,
    4
  );

  v_high_impact_max := case v_readiness
    when 'low' then coalesce(
      (v_cfg#>>'{quality_gate,low_readiness_max_high_joint_impact_count}')::int,
      1
    )
    when 'high' then coalesce(
      (v_cfg#>>'{quality_gate,high_readiness_max_high_joint_impact_count}')::int,
      2
    )
    else coalesce(
      (v_cfg#>>'{quality_gate,normal_readiness_max_high_joint_impact_count}')::int,
      2
    )
  end;

  if coalesce((p_candidate#>>'{c4_preparation,mechanic_compatible}')::boolean,true)=false then
    v_reasons := v_reasons || coalesce(p_candidate#>'{c4_preparation,reasons}','[]'::jsonb);
  end if;

  for v_ex in
    select value from jsonb_array_elements(coalesce(p_candidate->'exercises','[]'::jsonb))
  loop
    v_count := v_count + 1;

    select id,movement_pattern,exercise_family,technical_complexity,fatigue_score,joint_impact,transition_cost,warmup_only
    into e
    from public.exercises
    where id = v_ex->>'exercise_id';

    if not found then
      v_reasons := v_reasons || jsonb_build_array('UNKNOWN_EXERCISE:'||(v_ex->>'exercise_id'));
      continue;
    end if;

    if not public.exercise_safe_for_zones(e.id,v_zone_ids) then
      v_reasons := v_reasons || jsonb_build_array('PAIN_GATE:'||e.id);
    end if;

    if not public.exercise_equipment_compatible(e.id,p_inventory) then
      v_reasons := v_reasons || jsonb_build_array('EQUIPMENT_GATE:'||e.id);
    end if;

    if coalesce(e.warmup_only,false) then
      v_reasons := v_reasons || jsonb_build_array('WARMUP_ONLY_IN_WOD:'||e.id);
    end if;

    if e.technical_complexity is null or e.fatigue_score is null or e.joint_impact is null then
      v_reasons := v_reasons || jsonb_build_array('MISSING_CRITICAL_METADATA:'||e.id);
    end if;

    if coalesce(e.technical_complexity,99)>p_max_complexity then
      v_reasons := v_reasons || jsonb_build_array('TECHNICAL_LEVEL_GATE:'||e.id);
    end if;

    if v_readiness='low'
       and coalesce(e.technical_complexity,99) > coalesce((v_cfg#>>'{quality_gate,low_readiness_max_complexity}')::int,3) then
      v_reasons := v_reasons || jsonb_build_array('LOW_READINESS_COMPLEXITY:'||e.id);
    end if;

    if v_readiness='low'
       and coalesce(e.fatigue_score,99) > coalesce((v_cfg#>>'{quality_gate,low_readiness_max_fatigue}')::int,4) then
      v_reasons := v_reasons || jsonb_build_array('LOW_READINESS_FATIGUE:'||e.id);
    end if;

    if e.movement_pattern='Jump' then v_jump := v_jump + 1; end if;
    if coalesce(e.joint_impact,0) >= v_high_impact_threshold then v_high_impact := v_high_impact + 1; end if;

    if v_mechanic='AMRAP'
       and coalesce(e.transition_cost,99) > coalesce((v_cfg#>>'{quality_gate,amrap_max_transition_cost}')::int,3) then
      v_reasons := v_reasons || jsonb_build_array('AMRAP_TRANSITION_COST:'||e.id);
    end if;

    if v_mechanic='EMOM' and coalesce(e.technical_complexity,0)>=4 then v_emom_tech := v_emom_tech + 1; end if;
    if v_mechanic='EMOM' and coalesce(e.fatigue_score,0)>=5 then v_emom_fatigue := v_emom_fatigue + 1; end if;
    if v_mechanic='FOR_TIME' and e.movement_pattern='Hinge' and coalesce(e.fatigue_score,0)>=5 then v_hinge5 := true; end if;
    if v_mechanic='FOR_TIME' and e.movement_pattern='Jump' and coalesce(e.fatigue_score,0)>=5 then v_jump5 := true; end if;
    if e.movement_pattern in ('Conditioning','Locomotion') or e.exercise_family in ('Conditioning','Locomotion') then v_anchor := true; end if;
  end loop;

  if v_count=0 then v_reasons := v_reasons || jsonb_build_array('EMPTY_WOD'); end if;

  if v_jump > coalesce((v_cfg#>>'{quality_gate,max_jump_count}')::int,1) then
    v_reasons := v_reasons || jsonb_build_array('MAX_JUMP_COUNT');
  end if;

  if v_high_impact > v_high_impact_max then
    v_reasons := v_reasons || jsonb_build_array('HIGH_JOINT_IMPACT_COUNT');
  end if;

  if v_mechanic='EMOM'
     and v_emom_tech > coalesce((v_cfg#>>'{quality_gate,emom_max_high_complexity_count}')::int,1) then
    v_reasons := v_reasons || jsonb_build_array('EMOM_HIGH_COMPLEXITY_COUNT');
  end if;

  if v_mechanic='EMOM'
     and v_emom_fatigue > coalesce((v_cfg#>>'{quality_gate,emom_max_fatigue_5_count}')::int,1) then
    v_reasons := v_reasons || jsonb_build_array('EMOM_FATIGUE_5_COUNT');
  end if;

  if v_mechanic='FOR_TIME' and v_hinge5 and v_jump5 then
    v_reasons := v_reasons || jsonb_build_array('FOR_TIME_HINGE5_PLUS_JUMP5');
  end if;

  if p_focus in ('Conditioning','Fat Loss') and not v_anchor then
    v_reasons := v_reasons || jsonb_build_array('CONDITIONING_ANCHOR_REQUIRED');
  end if;

  if coalesce((p_candidate#>>'{c4_final,feasible}')::boolean,false)=false then
    v_reasons := v_reasons || jsonb_build_array('FINAL_SOLVER_INFEASIBLE');
  end if;

  if coalesce(p_candidate#>>'{c4_final,whole_wod_metrics,duration_status}','')='OVERFILLED' then
    v_reasons := v_reasons || jsonb_build_array('FINAL_DURATION_OVERFILLED');
  end if;

  return jsonb_build_object(
    'pass', jsonb_array_length(v_reasons)=0,
    'hard_gate_reasons', v_reasons,
    'mechanic', v_mechanic,
    'checks', jsonb_build_object(
      'pain', true,
      'equipment', true,
      'technical_level', true,
      'readiness_caps', true,
      'jump_count', v_jump,
      'high_joint_impact_threshold', v_high_impact_threshold,
      'high_joint_impact_count', v_high_impact,
      'high_joint_impact_max', v_high_impact_max,
      'conditioning_anchor', v_anchor
    ),
    'version', 'c4-quality-gate-v1.1-a2'
  );
end;
$function$;;



-- SOURCE MIGRATION: 20260811162952_phase_a3_hierarchical_work_rate_estimation.sql
-- UGEROD A3 — hierarchical work-rate estimation
-- Level 1: prescription-type defaults
-- Level 2: exercise-specific calibrated/observed rate
-- Level 3: user-specific observed rate

create table if not exists public.c3_work_rate_defaults (
  prescription_type text primary key,
  metric text not null check (metric in ('seconds_per_rep','meters_per_second')),
  default_value numeric not null check (default_value > 0),
  source text not null default 'c3_policy_default',
  notes text,
  updated_at timestamptz not null default now()
);

create table if not exists public.exercise_work_rate_overrides (
  exercise_id varchar not null references public.exercises(id) on delete cascade,
  metric text not null check (metric in ('seconds_per_rep','meters_per_second')),
  estimate_value numeric not null check (estimate_value > 0),
  source text not null default 'manual_calibration',
  notes text,
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (exercise_id, metric)
);

create table if not exists public.exercise_work_rate_estimates (
  exercise_id varchar not null references public.exercises(id) on delete cascade,
  metric text not null check (metric in ('seconds_per_rep','meters_per_second')),
  estimate_value numeric not null check (estimate_value > 0),
  evidence_count integer not null default 0 check (evidence_count >= 0),
  user_count integer not null default 0 check (user_count >= 0),
  confidence numeric not null default 0 check (confidence between 0 and 1),
  freshness numeric not null default 0 check (freshness between 0 and 1),
  eligible boolean not null default false,
  last_observed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (exercise_id, metric)
);

create table if not exists public.user_exercise_work_rate_estimates (
  user_id uuid not null references public.profiles(id) on delete cascade,
  exercise_id varchar not null references public.exercises(id) on delete cascade,
  metric text not null check (metric in ('seconds_per_rep','meters_per_second')),
  estimate_value numeric not null check (estimate_value > 0),
  evidence_count integer not null default 0 check (evidence_count >= 0),
  confidence numeric not null default 0 check (confidence between 0 and 1),
  freshness numeric not null default 0 check (freshness between 0 and 1),
  eligible boolean not null default false,
  last_observed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, exercise_id, metric)
);

alter table public.c3_work_rate_defaults enable row level security;
alter table public.exercise_work_rate_overrides enable row level security;
alter table public.exercise_work_rate_estimates enable row level security;
alter table public.user_exercise_work_rate_estimates enable row level security;

drop policy if exists c3_work_rate_defaults_read on public.c3_work_rate_defaults;
create policy c3_work_rate_defaults_read on public.c3_work_rate_defaults
for select to authenticated using (true);

drop policy if exists exercise_work_rate_overrides_read on public.exercise_work_rate_overrides;
create policy exercise_work_rate_overrides_read on public.exercise_work_rate_overrides
for select to authenticated using (true);

drop policy if exists exercise_work_rate_estimates_read on public.exercise_work_rate_estimates;
create policy exercise_work_rate_estimates_read on public.exercise_work_rate_estimates
for select to authenticated using (true);

drop policy if exists user_exercise_work_rate_estimates_read_own on public.user_exercise_work_rate_estimates;
create policy user_exercise_work_rate_estimates_read_own on public.user_exercise_work_rate_estimates
for select to authenticated using (auth.uid() = user_id);

revoke all on public.c3_work_rate_defaults from anon;
revoke all on public.exercise_work_rate_overrides from anon;
revoke all on public.exercise_work_rate_estimates from anon;
revoke all on public.user_exercise_work_rate_estimates from anon;

grant select on public.c3_work_rate_defaults to authenticated;
grant select on public.exercise_work_rate_overrides to authenticated;
grant select on public.exercise_work_rate_estimates to authenticated;
grant select on public.user_exercise_work_rate_estimates to authenticated;

-- Seed the generic layer from the explicit C3 policy, not from per-exercise hardcodes.
insert into public.c3_work_rate_defaults(prescription_type,metric,default_value,source,notes)
select 'reps_standard','seconds_per_rep',coalesce((config#>>'{operational_assumptions,reps_standard_seconds_per_rep}')::numeric,2.5),'c3_policy_default','Generic operational default; replaced by exercise/user evidence when eligible.'
from public.session_engine_policy where policy_key='c3-sim-default'
on conflict (prescription_type) do update set metric=excluded.metric,default_value=excluded.default_value,source=excluded.source,notes=excluded.notes,updated_at=now();

insert into public.c3_work_rate_defaults(prescription_type,metric,default_value,source,notes)
select 'reps_unilateral','seconds_per_rep',coalesce((config#>>'{operational_assumptions,reps_unilateral_seconds_per_rep}')::numeric,2.5),'c3_policy_default','Generic operational default; replaced by exercise/user evidence when eligible.'
from public.session_engine_policy where policy_key='c3-sim-default'
on conflict (prescription_type) do update set metric=excluded.metric,default_value=excluded.default_value,source=excluded.source,notes=excluded.notes,updated_at=now();

insert into public.c3_work_rate_defaults(prescription_type,metric,default_value,source,notes)
select 'reps_heavy','seconds_per_rep',coalesce((config#>>'{operational_assumptions,reps_heavy_seconds_per_rep}')::numeric,3.5),'c3_policy_default','Generic operational default; replaced by exercise/user evidence when eligible.'
from public.session_engine_policy where policy_key='c3-sim-default'
on conflict (prescription_type) do update set metric=excluded.metric,default_value=excluded.default_value,source=excluded.source,notes=excluded.notes,updated_at=now();

insert into public.c3_work_rate_defaults(prescription_type,metric,default_value,source,notes)
select 'metabolic_high','seconds_per_rep',coalesce((config#>>'{operational_assumptions,metabolic_high_seconds_per_rep}')::numeric,1.8),'c3_policy_default','Generic operational default; replaced by exercise/user evidence when eligible.'
from public.session_engine_policy where policy_key='c3-sim-default'
on conflict (prescription_type) do update set metric=excluded.metric,default_value=excluded.default_value,source=excluded.source,notes=excluded.notes,updated_at=now();

insert into public.c3_work_rate_defaults(prescription_type,metric,default_value,source,notes)
select 'distance','meters_per_second',coalesce((config#>>'{operational_assumptions,distance_default_m_per_second}')::numeric,2.0),'c3_policy_default','Generic operational default; replaced by exercise/user evidence when eligible.'
from public.session_engine_policy where policy_key='c3-sim-default'
on conflict (prescription_type) do update set metric=excluded.metric,default_value=excluded.default_value,source=excluded.source,notes=excluded.notes,updated_at=now();

create or replace function public.c3_work_rate_samples(
  p_user_id uuid,
  p_exercise_id text,
  p_metric text,
  p_days integer default 180
)
returns table(sample_user_id uuid, sample_value numeric, quality numeric, observed_at timestamptz)
language sql
stable
set search_path = public
as $$
  select
    l.user_id,
    case
      when p_metric='seconds_per_rep' then l.duration_seconds::numeric / nullif(l.reps_completed,0)
      when p_metric='meters_per_second' then l.distance_meters / nullif(l.duration_seconds,0)
      else null
    end as sample_value,
    greatest(0,least(1,coalesce(l.observation_quality,0.70))) as quality,
    l.created_at
  from public.exercise_logs l
  join public.exercises e on e.id=l.exercise_id
  where l.exercise_id=p_exercise_id
    and (p_user_id is null or l.user_id=p_user_id)
    and l.created_at >= now() - make_interval(days => greatest(1,p_days))
    and l.status='completed'
    and coalesce(l.capability_eligible,false)=true
    and coalesce(l.pain_affected,false)=false
    and l.session_exercise_id is not null
    and coalesce(l.source_kind,'internal')='internal'
    and greatest(0,least(1,coalesce(l.observation_quality,0.70))) >= 0.60
    and coalesce(l.prescription_json->>'prescription_type',e.prescription_type)=e.prescription_type
    and (
      (p_metric='seconds_per_rep'
        and l.reps_completed>0 and l.duration_seconds>0
        and coalesce(l.prescription_json->'tracking_modes','[]'::jsonb) ? 'reps'
        and coalesce(l.prescription_json->'tracking_modes','[]'::jsonb) ? 'time'
        and l.duration_seconds::numeric/nullif(l.reps_completed,0) between 0.30 and 30.0)
      or
      (p_metric='meters_per_second'
        and l.distance_meters>0 and l.duration_seconds>0
        and coalesce(l.prescription_json->'tracking_modes','[]'::jsonb) ? 'distance'
        and coalesce(l.prescription_json->'tracking_modes','[]'::jsonb) ? 'time'
        and l.distance_meters/nullif(l.duration_seconds,0) between 0.10 and 10.0)
    );
$$;

create or replace function public.c3_refresh_work_rate_estimates(
  p_user_id uuid,
  p_exercise_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_metric text;
  v_count int;
  v_users int;
  v_value numeric;
  v_quality numeric;
  v_last timestamptz;
  v_conf numeric;
  v_fresh numeric;
begin
  if p_user_id is null or p_exercise_id is null then return; end if;

  delete from public.user_exercise_work_rate_estimates
  where user_id=p_user_id and exercise_id=p_exercise_id;

  delete from public.exercise_work_rate_estimates
  where exercise_id=p_exercise_id;

  foreach v_metric in array array['seconds_per_rep','meters_per_second']
  loop
    with samples as (
      select * from public.c3_work_rate_samples(p_user_id,p_exercise_id,v_metric,180)
      order by observed_at desc
      limit 8
    )
    select count(*), percentile_cont(0.5) within group(order by sample_value)::numeric,
           avg(quality), max(observed_at)
    into v_count,v_value,v_quality,v_last
    from samples;

    if v_count>0 and v_value is not null then
      v_fresh := case
        when v_last >= now()-interval '30 days' then 1.0
        when v_last >= now()-interval '90 days' then 0.8
        when v_last >= now()-interval '180 days' then 0.6
        else 0.0 end;
      v_conf := least(1.0,(v_count::numeric/6.0))*coalesce(v_quality,0);

      insert into public.user_exercise_work_rate_estimates(
        user_id,exercise_id,metric,estimate_value,evidence_count,confidence,freshness,eligible,last_observed_at,updated_at
      ) values (
        p_user_id,p_exercise_id,v_metric,round(v_value,4),v_count,round(v_conf,3),v_fresh,
        (v_count>=3 and v_conf>=0.55 and v_fresh>=0.60),v_last,now()
      );
    end if;

    with samples as (
      select * from public.c3_work_rate_samples(null,p_exercise_id,v_metric,365)
      order by observed_at desc
      limit 100
    )
    select count(*),count(distinct sample_user_id),
           percentile_cont(0.5) within group(order by sample_value)::numeric,
           avg(quality),max(observed_at)
    into v_count,v_users,v_value,v_quality,v_last
    from samples;

    if v_count>0 and v_value is not null then
      v_fresh := case
        when v_last >= now()-interval '60 days' then 1.0
        when v_last >= now()-interval '180 days' then 0.8
        when v_last >= now()-interval '365 days' then 0.6
        else 0.0 end;
      v_conf := least(1.0,(v_count::numeric/12.0)*0.60 + (v_users::numeric/5.0)*0.40) * coalesce(v_quality,0);

      insert into public.exercise_work_rate_estimates(
        exercise_id,metric,estimate_value,evidence_count,user_count,confidence,freshness,eligible,last_observed_at,updated_at
      ) values (
        p_exercise_id,v_metric,round(v_value,4),v_count,v_users,round(v_conf,3),v_fresh,
        (v_count>=8 and v_users>=3 and v_conf>=0.55 and v_fresh>=0.60),v_last,now()
      );
    end if;
  end loop;
end;
$$;

revoke all on function public.c3_refresh_work_rate_estimates(uuid,text) from public,anon,authenticated;

create or replace function public.c3_work_rate_log_refresh_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op='DELETE' then
    perform public.c3_refresh_work_rate_estimates(old.user_id,old.exercise_id);
    return old;
  end if;

  if tg_op='UPDATE' and (old.user_id is distinct from new.user_id or old.exercise_id is distinct from new.exercise_id) then
    perform public.c3_refresh_work_rate_estimates(old.user_id,old.exercise_id);
  end if;

  perform public.c3_refresh_work_rate_estimates(new.user_id,new.exercise_id);
  return new;
end;
$$;

revoke all on function public.c3_work_rate_log_refresh_trigger() from public,anon,authenticated;

drop trigger if exists trg_c3_refresh_work_rate_on_log on public.exercise_logs;
create trigger trg_c3_refresh_work_rate_on_log
after insert or delete or update of reps_completed,duration_seconds,distance_meters,observation_quality,capability_eligible,pain_affected,status,session_exercise_id,prescription_json,exercise_id,user_id
on public.exercise_logs
for each row execute function public.c3_work_rate_log_refresh_trigger();

create or replace function public.c3_resolve_work_rate(
  p_exercise_id text,
  p_prescription_type text,
  p_user_id uuid default auth.uid()
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_metric text;
  v_value numeric;
  v_source text;
  v_evidence int := 0;
  v_conf numeric := 0;
  v_fresh numeric := 0;
  v_last timestamptz;
begin
  v_metric := case
    when p_prescription_type='distance' then 'meters_per_second'
    when p_prescription_type in ('reps_standard','reps_unilateral','reps_heavy','metabolic_high') then 'seconds_per_rep'
    else null end;

  if v_metric is null then
    return jsonb_build_object('metric',null,'value',null,'source','prescribed_time_or_no_rate_needed');
  end if;

  if p_user_id is not null then
    select estimate_value,evidence_count,confidence,freshness,last_observed_at
    into v_value,v_evidence,v_conf,v_fresh,v_last
    from public.user_exercise_work_rate_estimates
    where user_id=p_user_id and exercise_id=p_exercise_id and metric=v_metric and eligible
    limit 1;
    if found then v_source:='user_observed'; end if;
  end if;

  if v_value is null then
    select estimate_value,0,1,1,null
    into v_value,v_evidence,v_conf,v_fresh,v_last
    from public.exercise_work_rate_overrides
    where exercise_id=p_exercise_id and metric=v_metric and active
    limit 1;
    if found then v_source:='exercise_calibrated_override'; end if;
  end if;

  if v_value is null then
    select estimate_value,evidence_count,confidence,freshness,last_observed_at
    into v_value,v_evidence,v_conf,v_fresh,v_last
    from public.exercise_work_rate_estimates
    where exercise_id=p_exercise_id and metric=v_metric and eligible
    limit 1;
    if found then v_source:='exercise_observed'; end if;
  end if;

  if v_value is null then
    select default_value into v_value
    from public.c3_work_rate_defaults
    where prescription_type=p_prescription_type and metric=v_metric;
    if v_value is null and v_metric='seconds_per_rep' then
      select default_value into v_value from public.c3_work_rate_defaults where prescription_type='reps_standard';
    end if;
    if v_value is null then v_value := case when v_metric='meters_per_second' then 2.0 else 2.5 end; end if;
    v_source:='prescription_type_default';
    v_evidence:=0; v_conf:=0; v_fresh:=0; v_last:=null;
  end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'metric',v_metric,'value',round(v_value,4),'source',v_source,
    'evidence_count',v_evidence,'confidence',v_conf,'freshness',v_fresh,'last_observed_at',v_last,
    'hierarchy','user > exercise_override > exercise_observed > prescription_type_default',
    'version','a3-work-rate-v1'
  ));
end;
$$;

revoke all on function public.c3_resolve_work_rate(text,text,uuid) from public,anon;
grant execute on function public.c3_resolve_work_rate(text,text,uuid) to authenticated;

create or replace function public.c3_unit_estimate(
  p_exercise_id text,
  p_prescription jsonb,
  p_policy_key text default 'c3-sim-default'
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_cfg jsonb;
  e record;
  v_type text;
  v_reps_min numeric;
  v_reps_max numeric;
  v_reps_each numeric;
  v_reps_total numeric;
  v_duration_min numeric;
  v_duration_max numeric;
  v_duration numeric;
  v_distance_min numeric;
  v_distance_max numeric;
  v_distance numeric;
  v_rate jsonb;
  v_sec_per_rep numeric;
  v_speed numeric;
  v_work_seconds numeric;
  v_transition_seconds numeric;
  v_primary_muscles text[];
  v_basis text;
begin
  select config into v_cfg from public.session_engine_policy where policy_key=p_policy_key;
  if v_cfg is null then raise exception 'Unknown C3 policy %',p_policy_key; end if;

  select id,prescription_type,tracking_modes,movement_side,fatigue_score,transition_cost,technical_complexity,movement_pattern,exercise_family,body_region
  into e from public.exercises where id=p_exercise_id;
  if not found then raise exception 'Unknown exercise %',p_exercise_id; end if;

  v_type := coalesce(p_prescription->>'prescription_type',e.prescription_type,'reps_standard');
  v_reps_min := nullif(p_prescription->>'reps_min','')::numeric;
  v_reps_max := nullif(p_prescription->>'reps_max','')::numeric;
  v_duration_min := nullif(p_prescription->>'duration_seconds_min','')::numeric;
  v_duration_max := nullif(p_prescription->>'duration_seconds_max','')::numeric;
  v_distance_min := nullif(p_prescription->>'distance_meters_min','')::numeric;
  v_distance_max := nullif(p_prescription->>'distance_meters_max','')::numeric;

  if v_reps_min is not null or v_reps_max is not null then
    v_reps_each := (coalesce(v_reps_min,v_reps_max)+coalesce(v_reps_max,v_reps_min))/2.0;
    v_reps_total := case when coalesce(p_prescription->>'reps_semantics','total')='per_side' then v_reps_each*2 else v_reps_each end;
  end if;

  if v_duration_min is not null or v_duration_max is not null then
    v_duration := (coalesce(v_duration_min,v_duration_max)+coalesce(v_duration_max,v_duration_min))/2.0;
  end if;

  if v_distance_min is not null or v_distance_max is not null then
    v_distance := (coalesce(v_distance_min,v_distance_max)+coalesce(v_distance_max,v_distance_min))/2.0;
  end if;

  v_rate := public.c3_resolve_work_rate(p_exercise_id,v_type,auth.uid());
  if v_rate->>'metric'='seconds_per_rep' then v_sec_per_rep := (v_rate->>'value')::numeric; end if;
  if v_rate->>'metric'='meters_per_second' then v_speed := (v_rate->>'value')::numeric; end if;

  v_work_seconds := case
    when v_duration is not null then v_duration
    when v_distance is not null then v_distance/greatest(0.1,coalesce(v_speed,2.0))
    when v_reps_total is not null then v_reps_total*coalesce(v_sec_per_rep,2.5)
    else 20
  end;

  v_basis := case
    when v_duration is not null then 'prescribed_time'
    when v_distance is not null then coalesce(v_rate->>'source','prescription_type_default')
    when v_reps_total is not null then coalesce(v_rate->>'source','prescription_type_default')
    else 'fallback_20_seconds' end;

  v_transition_seconds := greatest(0,coalesce(e.transition_cost,1)) * coalesce((v_cfg#>>'{operational_assumptions,transition_seconds_per_cost_point}')::numeric,3.0);

  select coalesce(array_agg(em.muscle_id order by em.muscle_id),'{}'::text[])
  into v_primary_muscles
  from public.exercise_muscles em
  where em.exercise_id=p_exercise_id and em.priority='primary';

  return jsonb_strip_nulls(jsonb_build_object(
    'exercise_id',p_exercise_id,
    'prescription_type',v_type,
    'reps_each',round(v_reps_each,2),
    'reps_total',round(v_reps_total,2),
    'duration_seconds',round(v_duration,2),
    'distance_meters',round(v_distance,2),
    'estimated_active_work_seconds',round(v_work_seconds,2),
    'estimated_transition_seconds',round(v_transition_seconds,2),
    'fatigue_score',coalesce(e.fatigue_score,3),
    'technical_complexity',coalesce(e.technical_complexity,3),
    'movement_pattern',e.movement_pattern,
    'exercise_family',e.exercise_family,
    'body_region',e.body_region,
    'primary_muscles',to_jsonb(v_primary_muscles),
    'estimate_basis',v_basis,
    'work_rate_resolution',v_rate,
    'work_rate_version','a3-hierarchical-v1'
  ));
end;
$$;

-- Refresh any existing real observations; no synthetic data is inserted.
do $$
declare r record;
begin
  for r in select distinct user_id,exercise_id from public.exercise_logs where user_id is not null and exercise_id is not null
  loop
    perform public.c3_refresh_work_rate_estimates(r.user_id,r.exercise_id);
  end loop;
end $$;;



-- SOURCE MIGRATION: 20260811164427_phase_c41_full_mechanic_compiler.sql
-- C4.1 — full backend mechanic compiler, DEV only

-- Complete WOD exercise-count contracts for every core mechanic.
insert into public.block_rules(block_key,format,min_exercises,max_exercises,preferred_exercises,active,notes)
select 'wod', v.format, v.min_ex, v.max_ex, v.pref, true, 'C4.1 full mechanic compiler'
from (values
  ('LADDER',2,3,2),
  ('PYRAMID',2,3,2),
  ('PROGRESSIVE_INTERVAL',1,2,1),
  ('CHIPPER',4,10,6),
  ('EVERY_X_MINUTES',2,5,3),
  ('REP_TARGET',2,6,4),
  ('ODD_EVEN',2,2,2),
  ('COUPLET',2,2,2),
  ('DECK',4,4,4)
) as v(format,min_ex,max_ex,pref)
where not exists (
  select 1 from public.block_rules br
  where br.block_key='wod' and upper(coalesce(br.format,''))=v.format and br.active
);

-- C4.1 defaults are explicit and calibratable.
update public.session_engine_policy
set config = jsonb_set(
  jsonb_set(
    jsonb_set(
      jsonb_set(
        jsonb_set(
          jsonb_set(
            jsonb_set(
              jsonb_set(
                config,
                '{mechanic_defaults,every_x_reserve_seconds}','10'::jsonb,true
              ),
              '{mechanic_defaults,every_x_allowed_intervals_seconds}','[60,90,120,180]'::jsonb,true
            ),
            '{mechanic_defaults,deck_cards}','52'::jsonb,true
          ),
          '{mechanic_defaults,deck_reps_per_suit}','95'::jsonb,true
        ),
        '{mechanic_defaults,couplet_max_rungs}','12'::jsonb,true
      ),
      '{mechanic_defaults,rep_target_min_reps_per_exercise}','5'::jsonb,true
    ),
    '{mechanic_defaults,rep_target_max_reps_per_exercise}','100'::jsonb,true
  ),
  '{mechanic_defaults,chipper_max_volume_multiplier}','3'::jsonb,true
)
where policy_key='c4-final-default';

-- Preserve the previous canonical compiler for the classic mechanics.
do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='c4_finalize_candidate'
  ) and not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='c4_finalize_candidate_v15_base'
  ) then
    alter function public.c4_finalize_candidate(jsonb,jsonb,integer,integer,text,text)
      rename to c4_finalize_candidate_v15_base;
  end if;
end $$;

-- Per-exercise mechanic preparation. Existing explicit overlays are preserved.
create or replace function public.c4_prepare_candidate(
  p_candidate jsonb,
  p_policy_key text default 'c4-final-default'
)
returns jsonb
language plpgsql
stable
set search_path=public
as $$
declare
  v_cfg jsonb;
  v_mechanic text := upper(coalesce(p_candidate->>'mechanic',''));
  v_variant text := upper(coalesce(p_candidate->>'variant_key',p_candidate->>'variant',''));
  v_exercises jsonb := '[]'::jsonb;
  v_ex jsonb;
  v_pres jsonb;
  v_modes jsonb;
  v_overlay jsonb;
  v_compatible boolean := true;
  v_reasons jsonb := '[]'::jsonb;
  v_start int;
  v_inc int;
  v_index int := 0;
begin
  select config into v_cfg from public.session_engine_policy where policy_key=p_policy_key;
  if v_cfg is null then raise exception 'Unknown C4 policy %',p_policy_key; end if;

  if v_mechanic='COUPLET' and v_variant='' then v_variant:='ASCENDING_COUPLET'; end if;
  if v_mechanic='PROGRESSIVE_INTERVAL' and v_variant='' then v_variant:='PROGRESSIVE_GENERIC'; end if;

  for v_ex in select value from jsonb_array_elements(coalesce(p_candidate->'exercises','[]'::jsonb))
  loop
    v_index:=v_index+1;
    v_pres:=coalesce(v_ex->'prescription','{}'::jsonb);
    v_modes:=coalesce(v_pres->'tracking_modes','[]'::jsonb);
    v_overlay:=coalesce(v_pres->'mechanic_overlay','{}'::jsonb);

    if v_mechanic in ('LADDER','PYRAMID','PROGRESSIVE_INTERVAL','COUPLET','REP_TARGET','DECK') then
      if not exists(select 1 from jsonb_array_elements_text(v_modes) m where m='reps') then
        v_compatible:=false;
        v_reasons:=v_reasons||jsonb_build_array(v_mechanic||'_REQUIRES_REP_TRACKING:'||(v_ex->>'exercise_id'));
      end if;
    end if;

    if v_mechanic='LADDER' then
      v_start:=coalesce(nullif(v_overlay->>'start_reps','')::int,
        nullif(v_pres->>'reps_min','')::int,
        (v_cfg#>>'{mechanic_defaults,ladder_start_reps}')::int,2);
      v_start:=greatest(1,least(v_start,12));
      v_inc:=coalesce(nullif(v_overlay->>'increment_reps','')::int,
        case when v_start>=8 then 1 else coalesce((v_cfg#>>'{mechanic_defaults,ladder_increment_reps}')::int,2) end);
      v_pres:=v_pres||jsonb_build_object('mechanic_overlay',jsonb_build_object(
        'type','ascending_ladder','start_reps',v_start,'increment_reps',greatest(1,v_inc),'exercise_position',v_index));

    elsif v_mechanic='PYRAMID' then
      v_start:=coalesce(nullif(v_overlay->>'base_reps','')::int,
        nullif(v_pres->>'reps_min','')::int,
        (v_cfg#>>'{mechanic_defaults,pyramid_base_reps}')::int,4);
      v_start:=greatest(1,least(v_start,12));
      v_pres:=v_pres||jsonb_build_object('mechanic_overlay',jsonb_build_object(
        'type','pyramid','base_reps',v_start,
        'multipliers',coalesce(v_cfg#>'{mechanic_defaults,pyramid_multipliers}','[1,2,3,2,1]'::jsonb),
        'exercise_position',v_index));

    elsif v_mechanic='PROGRESSIVE_INTERVAL' then
      v_start:=coalesce(nullif(v_overlay->>'start_reps','')::int,
        nullif(v_pres->>'reps_min','')::int,
        (v_cfg#>>'{mechanic_defaults,progressive_start_reps}')::int,3);
      v_start:=greatest(1,least(v_start,15));
      v_inc:=coalesce(nullif(v_overlay->>'increment_reps','')::int,
        (v_cfg#>>'{mechanic_defaults,progressive_increment_reps}')::int,1);
      v_pres:=v_pres||jsonb_build_object('mechanic_overlay',jsonb_build_object(
        'type',lower(case when v_variant in ('DEATH_BY','DEATH_BY_COUPLET') then v_variant else 'PROGRESSIVE_GENERIC' end),
        'start_reps',v_start,'increment_reps',greatest(1,v_inc),
        'interval_seconds',coalesce((v_cfg#>>'{mechanic_defaults,progressive_interval_seconds}')::int,60),
        'exercise_position',v_index));

    elsif v_mechanic='COUPLET' then
      v_start:=coalesce(nullif(v_overlay->>'start_reps','')::int,nullif(v_pres->>'reps_min','')::int,3);
      v_start:=greatest(1,least(v_start,15));
      v_inc:=coalesce(nullif(v_overlay->>'increment_reps','')::int,2);
      v_pres:=v_pres||jsonb_build_object('mechanic_overlay',jsonb_build_object(
        'type',lower(v_variant),'start_reps',v_start,'increment_reps',greatest(1,v_inc),'exercise_position',v_index));

    elsif v_mechanic='DECK' then
      v_pres:=v_pres||jsonb_build_object('mechanic_overlay',jsonb_build_object(
        'type','deck_suit','suit_index',v_index,'cards_per_suit',13,'strict_card_value_reps',true));
    end if;

    v_exercises:=v_exercises||jsonb_build_array(jsonb_set(v_ex,'{prescription}',v_pres,true));
  end loop;

  if v_mechanic='ODD_EVEN' and jsonb_array_length(v_exercises)<>2 then
    v_compatible:=false; v_reasons:=v_reasons||jsonb_build_array('ODD_EVEN_REQUIRES_EXACTLY_TWO_EXERCISES');
  end if;
  if v_mechanic='COUPLET' and jsonb_array_length(v_exercises)<>2 then
    v_compatible:=false; v_reasons:=v_reasons||jsonb_build_array('COUPLET_REQUIRES_EXACTLY_TWO_EXERCISES');
  end if;
  if v_mechanic='DECK' and jsonb_array_length(v_exercises)<>4 then
    v_compatible:=false; v_reasons:=v_reasons||jsonb_build_array('DECK_STRICT_REQUIRES_EXACTLY_FOUR_EXERCISES');
  end if;
  if v_mechanic='PROGRESSIVE_INTERVAL' and v_variant='DEATH_BY' and jsonb_array_length(v_exercises)<>1 then
    v_compatible:=false; v_reasons:=v_reasons||jsonb_build_array('DEATH_BY_REQUIRES_EXACTLY_ONE_EXERCISE');
  end if;
  if v_mechanic='PROGRESSIVE_INTERVAL' and v_variant='DEATH_BY_COUPLET' and jsonb_array_length(v_exercises)<>2 then
    v_compatible:=false; v_reasons:=v_reasons||jsonb_build_array('DEATH_BY_COUPLET_REQUIRES_EXACTLY_TWO_EXERCISES');
  end if;

  return jsonb_set(
    jsonb_set(jsonb_set(p_candidate,'{exercises}',v_exercises,true),'{variant_key}',to_jsonb(nullif(v_variant,'')),true),
    '{c4_preparation}',jsonb_build_object(
      'mechanic_compatible',v_compatible,'reasons',v_reasons,
      'per_exercise_progression',true,'version','c4-prepare-v2.0-c41'),true
  );
end;
$$;

-- Extended compiler for mechanics that were not fully compiled by v1.5,
-- plus Ladder/Pyramid/Progressive so their progression is truly per exercise.
create or replace function public.c4_finalize_candidate_extended(
  p_candidate jsonb,
  p_stimulus jsonb,
  p_total_duration_minutes integer,
  p_exact_wod_minutes integer default null,
  p_c4_policy_key text default 'c4-final-default',
  p_c3_policy_key text default 'c3-sim-default'
)
returns jsonb
language plpgsql
stable
set search_path=public
as $$
declare
  v_cfg jsonb;
  v_c3_cfg jsonb;
  v_mechanic text:=upper(coalesce(p_candidate->>'mechanic',''));
  v_variant text:=upper(coalesce(p_candidate->>'variant_key',p_candidate->>'variant',''));
  v_exercises jsonb:=coalesce(p_candidate->'exercises','[]'::jsonb);
  v_n int:=jsonb_array_length(v_exercises);
  v_units jsonb:='[]'::jsonb;
  v_unit jsonb;
  v_ex jsonb;
  v_pres jsonb;
  v_final_exercises jsonb:='[]'::jsonb;
  v_wod_min int;
  v_wod_sec numeric;
  v_target_util numeric;
  v_target_sec numeric;
  v_elapsed numeric:=0;
  v_active numeric:=0;
  v_rest numeric:=0;
  v_transition numeric:=0;
  v_base_round numeric:=0;
  v_duration_util numeric:=0;
  v_density numeric:=0;
  v_duration_fit numeric:=0;
  v_density_fit numeric:=0;
  v_whole_fit numeric:=0;
  v_status text:='OK';
  v_reasons jsonb:='[]'::jsonb;
  v_params jsonb:='{}'::jsonb;
  v_overlays jsonb:=coalesce(p_candidate->'overlays','[]'::jsonb);
  v_overlay_seconds numeric:=0;
  v_overlay jsonb;
  v_stage int:=0;
  v_rungs int:=0;
  v_cycles int:=0;
  v_interval numeric:=0;
  v_reserve numeric:=0;
  v_stage_active numeric:=0;
  v_stage_transition numeric:=0;
  v_stage_work numeric:=0;
  v_cycle_active numeric:=0;
  v_cycle_transition numeric:=0;
  v_cycle_work numeric:=0;
  v_scale numeric:=1;
  v_rep_target numeric:=0;
  v_target_each numeric:=0;
  v_spr numeric:=0;
  v_reps numeric:=0;
  v_deck_reps numeric:=95;
  v_deck_cards int:=52;
  v_deck_transition numeric:=0;
  v_max_chipper numeric:=3;
  v_allowed jsonb;
  v_candidate_interval numeric;
  v_count int;
  i int;
  rec record;
begin
  select config into v_cfg from public.session_engine_policy where policy_key=p_c4_policy_key;
  select config into v_c3_cfg from public.session_engine_policy where policy_key=p_c3_policy_key;
  if v_cfg is null then raise exception 'Unknown C4 policy %',p_c4_policy_key; end if;
  if v_c3_cfg is null then raise exception 'Unknown C3 policy %',p_c3_policy_key; end if;

  if coalesce((p_candidate#>>'{c4_preparation,mechanic_compatible}')::boolean,true)=false then
    return p_candidate||jsonb_build_object('c4_final',jsonb_build_object(
      'version','c4-full-mechanic-v2.0','status','INCOMPATIBLE_MECHANIC','feasible',false,
      'reasons',coalesce(p_candidate#>'{c4_preparation,reasons}','[]'::jsonb)));
  end if;

  v_wod_min:=public.c3_wod_budget_minutes(p_total_duration_minutes,p_exact_wod_minutes,p_c3_policy_key);
  v_wod_sec:=v_wod_min*60;
  v_target_util:=coalesce((v_c3_cfg#>>array['mechanic_duration_target_percent',v_mechanic])::numeric,85);
  v_target_sec:=v_wod_sec*v_target_util/100.0;

  for v_ex in select value from jsonb_array_elements(v_exercises)
  loop
    v_unit:=public.c3_unit_estimate(v_ex->>'exercise_id',coalesce(v_ex->'prescription','{}'::jsonb),p_c3_policy_key);
    v_units:=v_units||jsonb_build_array(v_unit);
    v_active:=v_active+coalesce((v_unit->>'estimated_active_work_seconds')::numeric,0);
    v_transition:=v_transition+coalesce((v_unit->>'estimated_transition_seconds')::numeric,0);
  end loop;
  v_base_round:=greatest(1,v_active+v_transition);

  -- Non-conditional overlays consume real baseline time; penalty remains conditional metadata.
  for v_overlay in select value from jsonb_array_elements(case when jsonb_typeof(v_overlays)='array' then v_overlays else '[]'::jsonb end)
  loop
    if coalesce((v_overlay->>'conditional')::boolean,false)=false then
      v_overlay_seconds:=v_overlay_seconds+
        coalesce(nullif(v_overlay->>'estimated_seconds','')::numeric,0)+
        coalesce(nullif(v_overlay->>'buy_in_seconds','')::numeric,0)+
        coalesce(nullif(v_overlay->>'cash_out_seconds','')::numeric,0);
    end if;
  end loop;
  v_target_sec:=greatest(1,v_target_sec-v_overlay_seconds);

  if v_mechanic in ('LADDER','COUPLET') then
    for i in 1..coalesce((v_cfg#>>'{mechanic_defaults,couplet_max_rungs}')::int,12)
    loop
      select
        coalesce(sum(
          case when coalesce(nullif(u.value->>'reps_total','')::numeric,0)>0 then
            (coalesce(nullif(x.value#>>'{prescription,mechanic_overlay,start_reps}','')::numeric,1)
             +(i-1)*coalesce(nullif(x.value#>>'{prescription,mechanic_overlay,increment_reps}','')::numeric,1))
            *coalesce((u.value->>'estimated_active_work_seconds')::numeric,0)
            /greatest(1,(u.value->>'reps_total')::numeric)
          else coalesce((u.value->>'estimated_active_work_seconds')::numeric,0) end
        ),0),
        coalesce(sum(coalesce((u.value->>'estimated_transition_seconds')::numeric,0)),0)
      into v_stage_active,v_stage_transition
      from jsonb_array_elements(v_units) with ordinality u(value,ord)
      join jsonb_array_elements(v_exercises) with ordinality x(value,ord) using(ord);
      v_stage_work:=v_stage_active+v_stage_transition;
      exit when v_elapsed+v_stage_work>v_target_sec;
      v_elapsed:=v_elapsed+v_stage_work;
      v_active:=case when v_rungs=0 then 0 else v_active end;
      if v_rungs=0 then v_active:=0; v_transition:=0; end if;
      v_active:=v_active+v_stage_active;
      v_transition:=v_transition+v_stage_transition;
      v_rungs:=i;
    end loop;
    if v_rungs<3 then v_status:='INFEASIBLE';v_reasons:=v_reasons||jsonb_build_array(v_mechanic||'_LT_3_RUNGS'); end if;
    if v_mechanic='COUPLET' and v_n<>2 then v_status:='INFEASIBLE';v_reasons:=v_reasons||jsonb_build_array('COUPLET_REQUIRES_2'); end if;
    v_params:=jsonb_build_object('rungs',v_rungs,'variant_key',nullif(v_variant,''),'per_exercise_progression',true);

  elsif v_mechanic='PYRAMID' then
    v_cycle_active:=0; v_cycle_transition:=0;
    for i in 1..5 loop
      select coalesce(sum(
        case when coalesce(nullif(u.value->>'reps_total','')::numeric,0)>0 then
          coalesce(nullif(x.value#>>'{prescription,mechanic_overlay,base_reps}','')::numeric,1)
          *case i when 1 then 1 when 2 then 2 when 3 then 3 when 4 then 2 else 1 end
          *coalesce((u.value->>'estimated_active_work_seconds')::numeric,0)/greatest(1,(u.value->>'reps_total')::numeric)
        else coalesce((u.value->>'estimated_active_work_seconds')::numeric,0) end
      ),0),coalesce(sum(coalesce((u.value->>'estimated_transition_seconds')::numeric,0)),0)
      into v_stage_active,v_stage_transition
      from jsonb_array_elements(v_units) with ordinality u(value,ord)
      join jsonb_array_elements(v_exercises) with ordinality x(value,ord) using(ord);
      v_cycle_active:=v_cycle_active+v_stage_active;
      v_cycle_transition:=v_cycle_transition+v_stage_transition;
    end loop;
    v_cycle_work:=greatest(1,v_cycle_active+v_cycle_transition);
    v_cycles:=greatest(0,least(coalesce((v_cfg#>>'{mechanic_defaults,pyramid_max_cycles}')::int,3),floor(v_target_sec/v_cycle_work)::int));
    if v_cycles<1 then v_status:='INFEASIBLE';v_reasons:=v_reasons||jsonb_build_array('PYRAMID_NO_COMPLETE_CYCLE'); end if;
    v_active:=v_cycle_active*v_cycles;v_transition:=v_cycle_transition*v_cycles;v_elapsed:=v_active+v_transition;
    v_params:=jsonb_build_object('cycles',v_cycles,'multipliers','[1,2,3,2,1]'::jsonb,'per_exercise_base_reps',true);

  elsif v_mechanic='PROGRESSIVE_INTERVAL' then
    v_interval:=coalesce((v_cfg#>>'{mechanic_defaults,progressive_interval_seconds}')::numeric,60);
    v_reserve:=coalesce((v_cfg#>>'{mechanic_defaults,progressive_reserve_seconds}')::numeric,8);
    if v_variant='DEATH_BY' and v_n<>1 then v_status:='INFEASIBLE';v_reasons:=v_reasons||jsonb_build_array('DEATH_BY_REQUIRES_1'); end if;
    if v_variant='DEATH_BY_COUPLET' and v_n<>2 then v_status:='INFEASIBLE';v_reasons:=v_reasons||jsonb_build_array('DEATH_BY_COUPLET_REQUIRES_2'); end if;
    v_active:=0;v_transition:=0;
    for i in 1..greatest(1,floor(v_wod_sec/v_interval)::int)
    loop
      select coalesce(sum(
        case when coalesce(nullif(u.value->>'reps_total','')::numeric,0)>0 then
          (coalesce(nullif(x.value#>>'{prescription,mechanic_overlay,start_reps}','')::numeric,1)
           +(i-1)*coalesce(nullif(x.value#>>'{prescription,mechanic_overlay,increment_reps}','')::numeric,1))
          *coalesce((u.value->>'estimated_active_work_seconds')::numeric,0)/greatest(1,(u.value->>'reps_total')::numeric)
        else coalesce((u.value->>'estimated_active_work_seconds')::numeric,0) end
      ),0),coalesce(sum(coalesce((u.value->>'estimated_transition_seconds')::numeric,0)),0)
      into v_stage_active,v_stage_transition
      from jsonb_array_elements(v_units) with ordinality u(value,ord)
      join jsonb_array_elements(v_exercises) with ordinality x(value,ord) using(ord);
      v_stage_work:=v_stage_active+v_stage_transition;
      exit when v_stage_work>v_interval-v_reserve;
      v_stage:=i;v_active:=v_active+v_stage_active;v_transition:=v_transition+v_stage_transition;
    end loop;
    if v_stage<1 then v_status:='INFEASIBLE';v_reasons:=v_reasons||jsonb_build_array('PROGRESSIVE_START_DOES_NOT_FIT'); end if;
    v_elapsed:=v_stage*v_interval;
    v_params:=jsonb_build_object('expected_stage',v_stage,'interval_seconds',v_interval,'stop_reserve_seconds',v_reserve,
      'variant_key',coalesce(nullif(v_variant,''),'PROGRESSIVE_GENERIC'),'per_exercise_progression',true,
      'stop_rule','stop_when_full_prescribed_stage_cannot_finish_inside_interval');

  elsif v_mechanic='EVERY_X_MINUTES' then
    v_allowed:=coalesce(v_cfg#>'{mechanic_defaults,every_x_allowed_intervals_seconds}','[60,90,120,180]'::jsonb);
    v_reserve:=coalesce((v_cfg#>>'{mechanic_defaults,every_x_reserve_seconds}')::numeric,10);
    v_interval:=0;
    for v_candidate_interval in select value::numeric from jsonb_array_elements_text(v_allowed)
    loop
      if v_base_round<=v_candidate_interval-v_reserve and floor(v_wod_sec/v_candidate_interval)>=2 then
        v_interval:=v_candidate_interval; exit;
      end if;
    end loop;
    if v_interval=0 then v_status:='INFEASIBLE';v_reasons:=v_reasons||jsonb_build_array('EVERY_X_NO_SAFE_INTERVAL');
    else
      v_cycles:=floor(v_wod_sec/v_interval);v_active:=v_active*v_cycles;v_transition:=v_transition*v_cycles;v_elapsed:=v_cycles*v_interval;
    end if;
    v_params:=jsonb_build_object('interval_seconds',v_interval,'cycles',v_cycles,'reserve_seconds',v_reserve);

  elsif v_mechanic='ODD_EVEN' then
    if v_n<>2 then v_status:='INFEASIBLE';v_reasons:=v_reasons||jsonb_build_array('ODD_EVEN_REQUIRES_2'); end if;
    if exists(select 1 from jsonb_array_elements(v_units) u where coalesce((u->>'estimated_active_work_seconds')::numeric,999)>50) then
      v_status:='INFEASIBLE';v_reasons:=v_reasons||jsonb_build_array('ODD_EVEN_STATION_EXCEEDS_50_SECONDS');
    end if;
    v_cycles:=floor(v_wod_min/2.0);v_active:=v_active*v_cycles;v_elapsed:=v_cycles*120;v_rest:=greatest(0,v_elapsed-v_active);
    v_params:=jsonb_build_object('cycles',v_cycles,'odd_position',1,'even_position',2,'station_seconds',60);

  elsif v_mechanic='REP_TARGET' then
    v_active:=0;v_transition:=0;v_final_exercises:='[]'::jsonb;
    for rec in
      select x.value as ex,u.value as unit,x.ord
      from jsonb_array_elements(v_exercises) with ordinality x(value,ord)
      join jsonb_array_elements(v_units) with ordinality u(value,ord) using(ord)
      order by x.ord
    loop
      v_reps:=greatest(1,coalesce(nullif(rec.unit->>'reps_total','')::numeric,1));
      v_spr:=greatest(0.2,coalesce((rec.unit->>'estimated_active_work_seconds')::numeric,1)/v_reps);
      v_target_each:=greatest(
        coalesce((v_cfg#>>'{mechanic_defaults,rep_target_min_reps_per_exercise}')::numeric,5),
        least(coalesce((v_cfg#>>'{mechanic_defaults,rep_target_max_reps_per_exercise}')::numeric,100),floor((v_target_sec/v_n)/v_spr))
      );
      v_pres:=coalesce(rec.ex->'prescription','{}'::jsonb)||jsonb_build_object(
        'reps_min',v_target_each,'reps_max',v_target_each,'mechanic_overlay',jsonb_build_object('type','rep_target','target_reps',v_target_each));
      v_final_exercises:=v_final_exercises||jsonb_build_array(jsonb_set(rec.ex,'{prescription}',v_pres,true));
      v_active:=v_active+v_target_each*v_spr;
      v_rep_target:=v_rep_target+v_target_each;
      v_transition:=v_transition+coalesce((rec.unit->>'estimated_transition_seconds')::numeric,0);
    end loop;
    v_elapsed:=v_active+v_transition;
    v_exercises:=v_final_exercises;
    v_params:=jsonb_build_object('total_rep_target',round(v_rep_target,0),'allocation','equal_time_weighted_by_exercise_work_rate');

  elsif v_mechanic='CHIPPER' then
    v_max_chipper:=coalesce((v_cfg#>>'{mechanic_defaults,chipper_max_volume_multiplier}')::numeric,3);
    v_scale:=greatest(0.5,least(v_max_chipper,v_target_sec/greatest(1,v_base_round)));
    v_active:=0;v_transition:=0;v_final_exercises:='[]'::jsonb;
    for rec in
      select x.value as ex,u.value as unit,x.ord
      from jsonb_array_elements(v_exercises) with ordinality x(value,ord)
      join jsonb_array_elements(v_units) with ordinality u(value,ord) using(ord)
      order by x.ord
    loop
      v_pres:=coalesce(rec.ex->'prescription','{}'::jsonb);
      if nullif(rec.unit->>'reps_total','') is not null then
        v_reps:=greatest(1,round((rec.unit->>'reps_total')::numeric*v_scale));
        v_pres:=v_pres||jsonb_build_object('reps_min',v_reps,'reps_max',v_reps,'reps_semantics','total');
      elsif nullif(rec.unit->>'distance_meters','') is not null then
        v_pres:=v_pres||jsonb_build_object('distance_meters_min',round((rec.unit->>'distance_meters')::numeric*v_scale),
          'distance_meters_max',round((rec.unit->>'distance_meters')::numeric*v_scale));
      elsif nullif(rec.unit->>'duration_seconds','') is not null then
        v_pres:=v_pres||jsonb_build_object('duration_seconds_min',round((rec.unit->>'duration_seconds')::numeric*v_scale),
          'duration_seconds_max',round((rec.unit->>'duration_seconds')::numeric*v_scale));
      end if;
      v_pres:=v_pres||jsonb_build_object('mechanic_overlay',jsonb_build_object('type','chipper','volume_multiplier',round(v_scale,3),'single_pass',true));
      v_final_exercises:=v_final_exercises||jsonb_build_array(jsonb_set(rec.ex,'{prescription}',v_pres,true));
      v_active:=v_active+coalesce((rec.unit->>'estimated_active_work_seconds')::numeric,0)*v_scale;
      v_transition:=v_transition+coalesce((rec.unit->>'estimated_transition_seconds')::numeric,0);
    end loop;
    v_exercises:=v_final_exercises;v_elapsed:=v_active+v_transition;
    v_params:=jsonb_build_object('single_pass',true,'volume_multiplier',round(v_scale,3),'exercise_order','strict');

  elsif v_mechanic='DECK' then
    v_deck_reps:=coalesce((v_cfg#>>'{mechanic_defaults,deck_reps_per_suit}')::numeric,95);
    v_deck_cards:=coalesce((v_cfg#>>'{mechanic_defaults,deck_cards}')::int,52);
    if v_n<>4 then v_status:='INFEASIBLE';v_reasons:=v_reasons||jsonb_build_array('DECK_STRICT_REQUIRES_4'); end if;
    v_active:=0;v_deck_transition:=0;
    for rec in
      select x.value as ex,u.value as unit,x.ord
      from jsonb_array_elements(v_exercises) with ordinality x(value,ord)
      join jsonb_array_elements(v_units) with ordinality u(value,ord) using(ord)
    loop
      v_reps:=greatest(1,coalesce(nullif(rec.unit->>'reps_total','')::numeric,1));
      v_spr:=greatest(0.2,coalesce((rec.unit->>'estimated_active_work_seconds')::numeric,1)/v_reps);
      v_active:=v_active+v_deck_reps*v_spr;
      v_deck_transition:=v_deck_transition+coalesce((rec.unit->>'estimated_transition_seconds')::numeric,0);
    end loop;
    v_transition:=(v_deck_transition/greatest(1,v_n))*v_deck_cards;
    v_elapsed:=v_active+v_transition;
    if v_elapsed>v_wod_sec then v_status:='INFEASIBLE';v_reasons:=v_reasons||jsonb_build_array('DECK_STRICT_EXCEEDS_WOD_BUDGET'); end if;
    v_params:=jsonb_build_object('cards',v_deck_cards,'suits',4,'reps_per_suit_total',v_deck_reps,
      'card_values','2-10 face value; J/Q/K=10; A=11','shuffle','controlled_random_without_replacement');

  else
    return public.c4_finalize_candidate_v15_base(p_candidate,p_stimulus,p_total_duration_minutes,p_exact_wod_minutes,p_c4_policy_key,p_c3_policy_key);
  end if;

  v_elapsed:=v_elapsed+v_overlay_seconds;
  v_rest:=greatest(v_rest,v_elapsed-v_active-v_transition-v_overlay_seconds);
  if v_elapsed>v_wod_sec*1.05 then v_status:='INFEASIBLE';v_reasons:=v_reasons||jsonb_build_array('FINAL_DURATION_OVERFILLED'); end if;
  v_duration_util:=case when v_wod_sec>0 then v_elapsed/v_wod_sec*100 else 0 end;
  v_density:=case when v_elapsed>0 then least(100,v_active/v_elapsed*100) else 0 end;
  v_duration_fit:=greatest(0,100-abs(v_duration_util-v_target_util)*1.25);
  v_density_fit:=greatest(0,100-abs(v_density-coalesce((p_stimulus#>>'{density,score}')::numeric,50)));
  v_whole_fit:=round(v_density_fit*0.55+v_duration_fit*0.45,2);

  v_params:=v_params||jsonb_build_object('overlays',v_overlays,'overlay_baseline_seconds',round(v_overlay_seconds,2));

  return jsonb_set(p_candidate,'{exercises}',v_exercises,true)||jsonb_build_object(
    'c4_final',jsonb_build_object(
      'version','c4-full-mechanic-v2.0',
      'status',v_status,'feasible',v_status='OK','reasons',v_reasons,
      'mechanic_json',jsonb_build_object(
        'mechanic_key',v_mechanic,'variant_key',nullif(v_variant,''),'parameters',v_params,
        'wod_budget_minutes',v_wod_min,'predicted_elapsed_seconds',round(v_elapsed,2),
        'time_utilization_percent',round(v_duration_util,2),
        'duration_status',case when v_elapsed>v_wod_sec*1.05 then 'OVERFILLED' when v_duration_util<greatest(0,v_target_util-20) then 'UNDERFILLED' else 'OK' end),
      'predicted_volume',jsonb_build_object('active_work_seconds',round(v_active,2)),
      'whole_wod_metrics',jsonb_build_object(
        'density_percent',round(v_density,2),'density_fit',round(v_density_fit,2),
        'local_fatigue_concentration_index',50,'local_fatigue_fit',50,
        'duration_fit',round(v_duration_fit,2),
        'duration_status',case when v_elapsed>v_wod_sec*1.05 then 'OVERFILLED' when v_duration_util<greatest(0,v_target_util-20) then 'UNDERFILLED' else 'OK' end,
        'time_utilization_percent',round(v_duration_util,2),'whole_wod_fit',v_whole_fit,
        'primary_muscle_exposure_ledger','[]'::jsonb)
    )
  );
end;
$$;

-- Restore the canonical function name as a dispatcher.
create or replace function public.c4_finalize_candidate(
  p_candidate jsonb,
  p_stimulus jsonb,
  p_total_duration_minutes integer,
  p_exact_wod_minutes integer default null,
  p_c4_policy_key text default 'c4-final-default',
  p_c3_policy_key text default 'c3-sim-default'
)
returns jsonb
language plpgsql
stable
set search_path=public
as $$
declare v_mechanic text:=upper(coalesce(p_candidate->>'mechanic',''));
begin
  if v_mechanic in ('LADDER','PYRAMID','PROGRESSIVE_INTERVAL','CHIPPER','EVERY_X_MINUTES','REP_TARGET','ODD_EVEN','COUPLET','DECK') then
    return public.c4_finalize_candidate_extended(p_candidate,p_stimulus,p_total_duration_minutes,p_exact_wod_minutes,p_c4_policy_key,p_c3_policy_key);
  end if;
  return public.c4_finalize_candidate_v15_base(p_candidate,p_stimulus,p_total_duration_minutes,p_exact_wod_minutes,p_c4_policy_key,p_c3_policy_key);
end;
$$;
;



-- SOURCE MIGRATION: 20260811164520_phase_c41_variant_null_safety.sql
create or replace function public.c4_prepare_candidate(
  p_candidate jsonb,
  p_policy_key text default 'c4-final-default'
)
returns jsonb
language plpgsql
stable
set search_path=public
as $$
declare
  v_cfg jsonb;
  v_mechanic text := upper(coalesce(p_candidate->>'mechanic',''));
  v_variant text := upper(coalesce(p_candidate->>'variant_key',p_candidate->>'variant',''));
  v_exercises jsonb := '[]'::jsonb;
  v_ex jsonb;
  v_pres jsonb;
  v_modes jsonb;
  v_overlay jsonb;
  v_compatible boolean := true;
  v_reasons jsonb := '[]'::jsonb;
  v_start int;
  v_inc int;
  v_index int := 0;
  v_result jsonb;
begin
  select config into v_cfg from public.session_engine_policy where policy_key=p_policy_key;
  if v_cfg is null then raise exception 'Unknown C4 policy %',p_policy_key; end if;

  if v_mechanic='COUPLET' and v_variant='' then v_variant:='ASCENDING_COUPLET'; end if;
  if v_mechanic='PROGRESSIVE_INTERVAL' and v_variant='' then v_variant:='PROGRESSIVE_GENERIC'; end if;

  for v_ex in select value from jsonb_array_elements(coalesce(p_candidate->'exercises','[]'::jsonb))
  loop
    v_index:=v_index+1;
    v_pres:=coalesce(v_ex->'prescription','{}'::jsonb);
    v_modes:=coalesce(v_pres->'tracking_modes','[]'::jsonb);
    v_overlay:=coalesce(v_pres->'mechanic_overlay','{}'::jsonb);

    if v_mechanic in ('LADDER','PYRAMID','PROGRESSIVE_INTERVAL','COUPLET','REP_TARGET','DECK') then
      if not exists(select 1 from jsonb_array_elements_text(v_modes) m where m='reps') then
        v_compatible:=false;
        v_reasons:=v_reasons||jsonb_build_array(v_mechanic||'_REQUIRES_REP_TRACKING:'||(v_ex->>'exercise_id'));
      end if;
    end if;

    if v_mechanic='LADDER' then
      v_start:=coalesce(nullif(v_overlay->>'start_reps','')::int,nullif(v_pres->>'reps_min','')::int,(v_cfg#>>'{mechanic_defaults,ladder_start_reps}')::int,2);
      v_start:=greatest(1,least(v_start,12));
      v_inc:=coalesce(nullif(v_overlay->>'increment_reps','')::int,case when v_start>=8 then 1 else coalesce((v_cfg#>>'{mechanic_defaults,ladder_increment_reps}')::int,2) end);
      v_pres:=v_pres||jsonb_build_object('mechanic_overlay',jsonb_build_object('type','ascending_ladder','start_reps',v_start,'increment_reps',greatest(1,v_inc),'exercise_position',v_index));
    elsif v_mechanic='PYRAMID' then
      v_start:=coalesce(nullif(v_overlay->>'base_reps','')::int,nullif(v_pres->>'reps_min','')::int,(v_cfg#>>'{mechanic_defaults,pyramid_base_reps}')::int,4);
      v_start:=greatest(1,least(v_start,12));
      v_pres:=v_pres||jsonb_build_object('mechanic_overlay',jsonb_build_object('type','pyramid','base_reps',v_start,'multipliers',coalesce(v_cfg#>'{mechanic_defaults,pyramid_multipliers}','[1,2,3,2,1]'::jsonb),'exercise_position',v_index));
    elsif v_mechanic='PROGRESSIVE_INTERVAL' then
      v_start:=coalesce(nullif(v_overlay->>'start_reps','')::int,nullif(v_pres->>'reps_min','')::int,(v_cfg#>>'{mechanic_defaults,progressive_start_reps}')::int,3);
      v_start:=greatest(1,least(v_start,15));
      v_inc:=coalesce(nullif(v_overlay->>'increment_reps','')::int,(v_cfg#>>'{mechanic_defaults,progressive_increment_reps}')::int,1);
      v_pres:=v_pres||jsonb_build_object('mechanic_overlay',jsonb_build_object('type',lower(case when v_variant in ('DEATH_BY','DEATH_BY_COUPLET') then v_variant else 'PROGRESSIVE_GENERIC' end),'start_reps',v_start,'increment_reps',greatest(1,v_inc),'interval_seconds',coalesce((v_cfg#>>'{mechanic_defaults,progressive_interval_seconds}')::int,60),'exercise_position',v_index));
    elsif v_mechanic='COUPLET' then
      v_start:=coalesce(nullif(v_overlay->>'start_reps','')::int,nullif(v_pres->>'reps_min','')::int,3);
      v_start:=greatest(1,least(v_start,15));
      v_inc:=coalesce(nullif(v_overlay->>'increment_reps','')::int,2);
      v_pres:=v_pres||jsonb_build_object('mechanic_overlay',jsonb_build_object('type',lower(v_variant),'start_reps',v_start,'increment_reps',greatest(1,v_inc),'exercise_position',v_index));
    elsif v_mechanic='DECK' then
      v_pres:=v_pres||jsonb_build_object('mechanic_overlay',jsonb_build_object('type','deck_suit','suit_index',v_index,'cards_per_suit',13,'strict_card_value_reps',true));
    end if;

    v_exercises:=v_exercises||jsonb_build_array(jsonb_set(v_ex,'{prescription}',v_pres,true));
  end loop;

  if v_mechanic='ODD_EVEN' and jsonb_array_length(v_exercises)<>2 then v_compatible:=false;v_reasons:=v_reasons||jsonb_build_array('ODD_EVEN_REQUIRES_EXACTLY_TWO_EXERCISES'); end if;
  if v_mechanic='COUPLET' and jsonb_array_length(v_exercises)<>2 then v_compatible:=false;v_reasons:=v_reasons||jsonb_build_array('COUPLET_REQUIRES_EXACTLY_TWO_EXERCISES'); end if;
  if v_mechanic='DECK' and jsonb_array_length(v_exercises)<>4 then v_compatible:=false;v_reasons:=v_reasons||jsonb_build_array('DECK_STRICT_REQUIRES_EXACTLY_FOUR_EXERCISES'); end if;
  if v_mechanic='PROGRESSIVE_INTERVAL' and v_variant='DEATH_BY' and jsonb_array_length(v_exercises)<>1 then v_compatible:=false;v_reasons:=v_reasons||jsonb_build_array('DEATH_BY_REQUIRES_EXACTLY_ONE_EXERCISE'); end if;
  if v_mechanic='PROGRESSIVE_INTERVAL' and v_variant='DEATH_BY_COUPLET' and jsonb_array_length(v_exercises)<>2 then v_compatible:=false;v_reasons:=v_reasons||jsonb_build_array('DEATH_BY_COUPLET_REQUIRES_EXACTLY_TWO_EXERCISES'); end if;

  v_result:=jsonb_set(p_candidate,'{exercises}',v_exercises,true);
  if v_variant<>'' then
    v_result:=jsonb_set(v_result,'{variant_key}',to_jsonb(v_variant),true);
  else
    v_result:=v_result-'variant_key';
  end if;
  v_result:=jsonb_set(v_result,'{c4_preparation}',jsonb_build_object('mechanic_compatible',v_compatible,'reasons',v_reasons,'per_exercise_progression',true,'version','c4-prepare-v2.1-c41'),true);
  return v_result;
end;
$$;;



-- SOURCE MIGRATION: 20260811164702_phase_c42_dynamic_composition_capability_prescription.sql
-- C4.2 — dynamic composition + mature-capability-aware prescriptions

update public.session_engine_policy
set config=jsonb_set(
  jsonb_set(
    jsonb_set(
      jsonb_set(config,'{capability_prescription,min_confidence}','0.60'::jsonb,true),
      '{capability_prescription,min_freshness}','0.40'::jsonb,true
    ),
    '{capability_prescription,min_valid_evidence}','3'::jsonb,true
  ),
  '{capability_prescription,conservative_fraction}','0.75'::jsonb,true
)
where policy_key='c4-final-default';

-- Resolve a numeric load only when BOTH mature capability and relevant real inventory agree.
create or replace function public.c4_resolve_numeric_load(
  p_exercise_id text,
  p_inventory jsonb,
  p_load_envelope jsonb
)
returns jsonb
language plpgsql
stable
set search_path=public
as $$
declare
  r record;
  inv jsonb;
  v_cap_max numeric;
  v_inv_load numeric;
  v_best numeric:=null;
  v_equipment text:=null;
  v_scope text:=null;
  v_count int:=1;
  v_total numeric:=null;
begin
  select max(nullif(x->>'load_kg','')::numeric)
  into v_cap_max
  from jsonb_array_elements(case when jsonb_typeof(coalesce(p_load_envelope->'frontier','[]'::jsonb))='array' then coalesce(p_load_envelope->'frontier','[]'::jsonb) else '[]'::jsonb end) x;

  if v_cap_max is null or v_cap_max<=0 then
    return jsonb_build_object('confirmed',false,'reason','no_confirmed_load_capability');
  end if;

  for r in
    select els.equipment_id,els.load_scope,greatest(1,coalesce(els.expected_implement_count,1)) expected_count,coalesce(els.symmetric_load,false) symmetric_load
    from public.exercise_load_semantics els
    where els.exercise_id=p_exercise_id
  loop
    for inv in select value from jsonb_array_elements(case when jsonb_typeof(coalesce(p_inventory,'[]'::jsonb))='array' then coalesce(p_inventory,'[]'::jsonb) else '[]'::jsonb end)
    loop
      if inv->>'equipment_id'=r.equipment_id and coalesce(nullif(inv->>'quantity','')::int,0)>=r.expected_count then
        v_inv_load:=coalesce(nullif(inv->>'load_kg','')::numeric,nullif(inv->>'max_load_kg','')::numeric);
        if v_inv_load is not null and v_inv_load>0 and v_inv_load<=v_cap_max and (v_best is null or v_inv_load>v_best) then
          v_best:=v_inv_load;v_equipment:=r.equipment_id;v_scope:=r.load_scope;v_count:=r.expected_count;
        end if;
      end if;
    end loop;
  end loop;

  if v_best is null then
    return jsonb_build_object('confirmed',false,'reason','no_inventory_load_within_confirmed_capability','capability_max_load_kg',v_cap_max);
  end if;

  v_total:=case when v_scope='per_implement' then v_best*v_count else v_best end;
  return jsonb_build_object(
    'confirmed',true,'load_kg',v_best,'load_scope',v_scope,'implement_count',v_count,
    'total_external_load_kg',v_total,'equipment_id',v_equipment,'capability_max_load_kg',v_cap_max,
    'source','confirmed_capability_intersect_real_inventory'
  );
end;
$$;

create or replace function public.c2_solver_prescription(
  p_user_id uuid,
  p_exercise_id text,
  p_stimulus jsonb,
  p_mechanic_key text,
  p_progression_intent text default null,
  p_inventory jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
stable
set search_path=public
as $$
declare
  e record;
  s record;
  c record;
  cfg jsonb;
  v_reps_min int;
  v_reps_max int;
  v_time_min int;
  v_time_max int;
  v_distance_min int;
  v_distance_max int;
  v_rpe_min numeric:=coalesce((p_stimulus#>>'{rpe_target,min}')::numeric,6);
  v_rpe_max numeric:=coalesce((p_stimulus#>>'{rpe_target,max}')::numeric,8);
  v_density numeric:=coalesce((p_stimulus#>>'{density,score}')::numeric,50);
  v_intent text:=upper(coalesce(p_progression_intent,''));
  v_progress_axis text:='none';
  v_load_strategy text:='not_applicable';
  v_load jsonb:='{}'::jsonb;
  v_numeric_load numeric:=null;
  v_cap_mature boolean:=false;
  v_cap_source text:='generic_catalog_default';
  v_fraction numeric:=0.75;
  v_repeat numeric;
  v_frontier_distance numeric;
begin
  select id,prescription_type,tracking_modes,movement_side,technical_complexity into e
  from public.exercises where id=p_exercise_id;
  if not found then raise exception 'Unknown exercise %',p_exercise_id; end if;

  select config into cfg from public.session_engine_policy where policy_key='c4-final-default';
  select * into s from public.user_exercise_coach_state where user_id=p_user_id and exercise_id=p_exercise_id;
  select * into c from public.user_exercise_capabilities where user_id=p_user_id and exercise_id=p_exercise_id;

  v_fraction:=case v_intent when 'PROGRESS' then 0.82 when 'DELOAD' then 0.60 when 'CONSOLIDATE' then 0.72 when 'RECALIBRATE' then 0.68 else coalesce((cfg#>>'{capability_prescription,conservative_fraction}')::numeric,0.75) end;
  v_cap_mature:=coalesce(c.confidence,0)>=coalesce((cfg#>>'{capability_prescription,min_confidence}')::numeric,0.60)
    and coalesce(c.freshness,0)>=coalesce((cfg#>>'{capability_prescription,min_freshness}')::numeric,0.40)
    and coalesce(c.valid_evidence_count,0)>=coalesce((cfg#>>'{capability_prescription,min_valid_evidence}')::int,3);

  -- Generic fallback remains explicit.
  case coalesce(e.prescription_type,'reps_standard')
    when 'reps_heavy' then v_reps_min:=4;v_reps_max:=8;
    when 'metabolic_high' then v_reps_min:=12;v_reps_max:=16;
    when 'reps_unilateral' then v_reps_min:=8;v_reps_max:=12;
    when 'isometric' then if v_density>=70 then v_time_min:=20;v_time_max:=30; else v_time_min:=30;v_time_max:=40; end if;
    when 'distance' then if upper(p_mechanic_key) in ('AMRAP','FOR_TIME','PROGRESSIVE_INTERVAL','CHIPPER') then v_distance_min:=20;v_distance_max:=40; else v_distance_min:=15;v_distance_max:=30; end if;
    else if upper(p_mechanic_key)='STRENGTH' then v_reps_min:=5;v_reps_max:=8; elsif v_density>=70 then v_reps_min:=8;v_reps_max:=12; else v_reps_min:=6;v_reps_max:=10; end if;
  end case;

  -- Mature observed capability overrides declared/generic dose, conservatively.
  if v_cap_mature then
    if 'reps'=any(e.tracking_modes) then
      v_repeat:=nullif(c.reps_envelope->>'repeatable_reps','')::numeric;
      if v_repeat is not null and v_repeat>0 then
        v_reps_min:=greatest(1,floor(v_repeat*v_fraction)::int);
        v_reps_max:=greatest(v_reps_min,ceil(v_repeat*least(0.90,v_fraction+0.08))::int);
        v_cap_source:='mature_reps_envelope';
      end if;
    end if;

    if 'time'=any(e.tracking_modes) and coalesce(e.prescription_type,'')='isometric' then
      v_repeat:=nullif(c.time_envelope->>'repeatable_seconds','')::numeric;
      if v_repeat is not null and v_repeat>0 then
        v_time_min:=greatest(5,floor(v_repeat*v_fraction/5)*5)::int;
        v_time_max:=greatest(v_time_min,ceil(v_repeat*least(0.90,v_fraction+0.08)/5)*5)::int;
        v_cap_source:='mature_time_envelope';
      end if;
    end if;

    if 'distance'=any(e.tracking_modes) then
      select max(nullif(x->>'distance_meters','')::numeric) into v_frontier_distance
      from jsonb_array_elements(case when jsonb_typeof(coalesce(c.pace_envelope->'frontier','[]'::jsonb))='array' then coalesce(c.pace_envelope->'frontier','[]'::jsonb) else '[]'::jsonb end) x;
      if v_frontier_distance is not null and v_frontier_distance>0 then
        v_distance_min:=greatest(5,floor(v_frontier_distance*v_fraction/5)*5)::int;
        v_distance_max:=greatest(v_distance_min,ceil(v_frontier_distance*least(0.90,v_fraction+0.08)/5)*5)::int;
        v_cap_source:='mature_pace_distance_frontier';
      end if;
    end if;
  end if;

  if 'load'=any(e.tracking_modes) then
    if v_cap_mature then v_load:=public.c4_resolve_numeric_load(p_exercise_id,p_inventory,c.load_envelope); end if;
    if coalesce((v_load->>'confirmed')::boolean,false) then
      v_numeric_load:=nullif(v_load->>'load_kg','')::numeric;
      v_load_strategy:='confirmed_numeric_load';
    elsif exists(select 1 from jsonb_array_elements(case when jsonb_typeof(coalesce(p_inventory,'[]'::jsonb))='array' then p_inventory else '[]'::jsonb end) x where nullif(x->>'load_kg','') is not null or nullif(x->>'max_load_kg','') is not null) then
      v_load_strategy:='inventory_known_capability_unconfirmed';
    else
      v_load_strategy:='no_numeric_load_without_confirmed_inventory_and_capability';
    end if;
  end if;

  if v_intent='PROGRESS' and coalesce(s.recommendation,'') in ('PROGRESS_POSSIBLE','PROGRESS_RECOMMENDED') then
    if 'reps'=any(e.tracking_modes) then v_progress_axis:='reps';
    elsif 'time'=any(e.tracking_modes) then v_progress_axis:='time';
    elsif 'distance'=any(e.tracking_modes) then v_progress_axis:='distance';
    elsif 'load'=any(e.tracking_modes) and v_load_strategy='confirmed_numeric_load' then v_progress_axis:='load'; end if;
  elsif v_intent='RECALIBRATE' then v_progress_axis:='recalibration_only';
  end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'solver_version','c2-prescription-v2-c42','simulation_only',true,'mechanic',upper(p_mechanic_key),
    'prescription_type',e.prescription_type,'tracking_modes',e.tracking_modes,
    'reps_min',v_reps_min,'reps_max',v_reps_max,
    'reps_semantics',case when e.prescription_type='reps_unilateral' then 'per_side' else 'total' end,
    'duration_seconds_min',v_time_min,'duration_seconds_max',v_time_max,
    'distance_meters_min',v_distance_min,'distance_meters_max',v_distance_max,
    'load_kg',v_numeric_load,'load_strategy',v_load_strategy,'load_resolution',case when 'load'=any(e.tracking_modes) then v_load else null end,
    'target_rpe_min',v_rpe_min,'target_rpe_max',v_rpe_max,
    'capability_source',v_cap_source,'capability_mature',v_cap_mature,
    'capability_confidence',case when c.user_id is not null then c.confidence else null end,
    'capability_freshness',case when c.user_id is not null then c.freshness else null end,
    'valid_evidence_count',case when c.user_id is not null then c.valid_evidence_count else null end,
    'progression_axis',v_progress_axis,'progression_budget_rule','at_most_one_axis',
    'unresolved_fields',jsonb_build_array('rounds','cap','whole_wod_density','whole_wod_volume')
  ));
end;
$$;

-- Exercise count is now a solver variable instead of an initial fixed three repaired only upward.
create or replace function public.c4_expand_candidate_to_block_rules(
  p_candidate jsonb,
  p_user_id uuid,
  p_focus text,
  p_duration_minutes integer,
  p_readiness text,
  p_target_region text,
  p_progression_intent text,
  p_zone_terms text[],
  p_inventory jsonb,
  p_max_complexity integer,
  p_max_difficulty text
)
returns jsonb
language plpgsql
stable
set search_path=public
as $$
declare
  v_mechanic text:=upper(coalesce(p_candidate->>'mechanic',''));
  v_exercises jsonb:=coalesce(p_candidate->'exercises','[]'::jsonb);
  v_original jsonb:=v_exercises;
  v_count int:=jsonb_array_length(v_exercises);
  v_min int:=0;v_max int:=99;v_pref int;
  v_target int;
  v_needed int;
  r record;
  v_added jsonb:='[]'::jsonb;
  v_trimmed jsonb:='[]'::jsonb;
  v_new jsonb:='[]'::jsonb;
  v_new_score numeric;
  v_stimulus jsonb;
  v_existing_patterns text[]:='{}'::text[];
  v_pass int;
begin
  select min_exercises,max_exercises,preferred_exercises into v_min,v_max,v_pref
  from public.block_rules where block_key='wod' and upper(coalesce(format,''))=v_mechanic and active order by id limit 1;

  if not found then
    return jsonb_set(p_candidate,'{c4_block_rules}',jsonb_build_object('rule_found',false,'exercise_count',v_count,'expanded',false,'dynamic_solver',false),true);
  end if;

  v_pref:=coalesce(v_pref,ceil((v_min+v_max)/2.0)::int);
  if v_min=v_max then v_target:=v_min;
  elsif p_duration_minutes<=35 then v_target:=v_min;
  elsif p_duration_minutes<=55 then v_target:=greatest(v_min,least(v_max,v_pref));
  else v_target:=greatest(v_min,least(v_max,v_pref+1)); end if;

  -- Mechanic-specific structural contracts take precedence.
  if v_mechanic in ('ODD_EVEN','COUPLET') then v_target:=2; end if;
  if v_mechanic='DECK' then v_target:=4; end if;
  if v_mechanic='PROGRESSIVE_INTERVAL' then
    if upper(coalesce(p_candidate->>'variant_key',''))='DEATH_BY' then v_target:=1;
    elsif upper(coalesce(p_candidate->>'variant_key',''))='DEATH_BY_COUPLET' then v_target:=2;
    else v_target:=greatest(v_min,least(v_max,2)); end if;
  end if;

  -- Trim first: retain best-scoring composition; Conditioning anchor is protected.
  if v_count>v_target then
    select coalesce(jsonb_agg(x order by ord),'[]'::jsonb) into v_new
    from (
      select value x,row_number() over(order by
        case when p_focus in ('Conditioning','Fat Loss') and (e.movement_pattern in ('Conditioning','Locomotion') or e.exercise_family in ('Conditioning','Locomotion')) then 0 else 1 end,
        coalesce((value->>'candidate_score')::numeric,0) desc,
        value->>'exercise_id') ord
      from jsonb_array_elements(v_exercises) value
      join public.exercises e on e.id=value->>'exercise_id'
      limit v_target
    ) q;
    select coalesce(jsonb_agg(value->>'exercise_id'),'[]'::jsonb) into v_trimmed
    from jsonb_array_elements(v_exercises) value
    where not exists(select 1 from jsonb_array_elements(v_new) z where z->>'exercise_id'=value->>'exercise_id');
    v_exercises:=v_new;v_count:=jsonb_array_length(v_exercises);
  end if;

  v_stimulus:=public.build_session_stimulus_target(p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,'c1-default');
  select coalesce(array_agg(distinct e.movement_pattern),'{}'::text[]) into v_existing_patterns
  from jsonb_array_elements(v_exercises) x join public.exercises e on e.id=x->>'exercise_id';

  v_needed:=v_target-v_count;
  -- Pass 1 adds new movement patterns; pass 2 fills by score if needed.
  for v_pass in 1..2 loop
    exit when v_needed<=0;
    for r in
      select * from public.c2_candidate_pool(
        p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
        p_zone_terms,p_inventory,'WOD',p_max_complexity,p_max_difficulty,60
      ) cp
      where not exists(select 1 from jsonb_array_elements(v_exercises) e where e->>'exercise_id'=cp.exercise_id)
        and (v_pass=2 or not (cp.movement_pattern=any(v_existing_patterns)))
      order by cp.candidate_score desc,cp.exercise_id
    loop
      exit when v_needed<=0;
      v_exercises:=v_exercises||jsonb_build_array(jsonb_build_object(
        'exercise_id',r.exercise_id,'name',r.exercise_name,'pattern',r.movement_pattern,'family',r.exercise_family,
        'candidate_score',r.candidate_score,'components',r.score_components,
        'prescription',public.c2_solver_prescription(p_user_id,r.exercise_id,v_stimulus,v_mechanic,p_progression_intent,p_inventory)
      ));
      v_existing_patterns:=array_append(v_existing_patterns,r.movement_pattern);
      v_added:=v_added||jsonb_build_array(r.exercise_id);v_needed:=v_needed-1;
    end loop;
  end loop;

  select round(coalesce(avg((x->>'candidate_score')::numeric),0)*0.90+coalesce((p_candidate->>'mechanic_fit')::numeric,0)*0.10,2)
  into v_new_score from jsonb_array_elements(v_exercises) x;

  return jsonb_set(jsonb_set(jsonb_set(p_candidate,'{exercises}',v_exercises,true),'{coach_score}',to_jsonb(v_new_score),true),
    '{c4_block_rules}',jsonb_build_object(
      'rule_found',true,'min_exercises',v_min,'max_exercises',v_max,'preferred_exercises',v_pref,
      'solver_target_exercises',v_target,'original_exercise_count',jsonb_array_length(v_original),
      'exercise_count',jsonb_array_length(v_exercises),'dynamic_solver',true,
      'added_exercise_ids',v_added,'trimmed_exercise_ids',v_trimmed,
      'valid_count',jsonb_array_length(v_exercises) between v_min and v_max
    ),true);
end;
$$;;



-- SOURCE MIGRATION: 20260811165000_phase_c43_full_session_orchestrator.sql
-- C4.3 — one backend Session Engine orchestrates the whole session.

create or replace function public.c4_plan_full_session(
  p_user_id uuid,
  p_focus text,
  p_duration_minutes integer,
  p_readiness text,
  p_target_region text default null,
  p_progression_intent text default null,
  p_zone_terms text[] default '{}'::text[],
  p_inventory jsonb default '[]'::jsonb,
  p_max_complexity integer default 3,
  p_max_difficulty text default 'Intermédiaire',
  p_candidate_count integer default 12,
  p_policy_key text default 'c4-final-default'
)
returns jsonb
language plpgsql
stable
set search_path=public
as $$
declare
  v_stimulus jsonb;
  v_warmup_min int;
  v_tabata_min int:=0;
  v_skill_min int:=0;
  v_wod_min int;
  v_include_tabata boolean:=false;
  v_include_skill boolean:=false;
  v_warmup_count int;
  v_warmup jsonb:='[]'::jsonb;
  v_tabata jsonb:='[]'::jsonb;
  v_skill jsonb:='[]'::jsonb;
  v_wod jsonb;
  v_wod_candidate jsonb;
  v_blocks jsonb:='[]'::jsonb;
  v_ex jsonb;
  v_pres jsonb;
  r record;
  v_role text;
  v_order int:=0;
  v_target_patterns text[]:='{}'::text[];
begin
  if p_duration_minutes<20 or p_duration_minutes>180 then
    raise exception 'Unsupported session duration %',p_duration_minutes;
  end if;

  v_stimulus:=public.build_session_stimulus_target(
    p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,'c1-default'
  );

  -- Dynamic architecture. Warm-up is mandatory; Tabata and Skill are optional.
  v_warmup_min:=case when p_duration_minutes<=35 then 5 when p_duration_minutes<=60 then 6 else 7 end;
  v_warmup_count:=case when p_duration_minutes<=35 then 2 when p_duration_minutes<=60 then 3 else 4 end;

  v_include_tabata:=p_duration_minutes>=45 and (
    p_focus in ('General Fitness','Fat Loss','Conditioning') or p_target_region='Core'
  );
  if v_include_tabata then v_tabata_min:=4; end if;

  v_include_skill:=p_duration_minutes>=45 and (
    p_focus in ('Strength','Muscle Gain') or upper(coalesce(p_progression_intent,'')) in ('PROGRESS','CONSOLIDATE','EXPLORE')
  );
  if v_include_skill then v_skill_min:=case when p_duration_minutes>=75 then 10 else 8 end; end if;

  v_wod_min:=p_duration_minutes-v_warmup_min-v_tabata_min-v_skill_min;
  if v_wod_min<10 then
    -- WOD is the primary block; optional blocks yield first.
    v_skill_min:=0;v_include_skill:=false;
    v_wod_min:=p_duration_minutes-v_warmup_min-v_tabata_min;
  end if;
  if v_wod_min<10 then
    v_tabata_min:=0;v_include_tabata:=false;
    v_wod_min:=p_duration_minutes-v_warmup_min;
  end if;

  -- Target patterns are known from target region/focus before WOD selection and used for movement prep priority.
  select coalesce(array_agg(distinct movement_pattern),'{}'::text[])
  into v_target_patterns
  from public.exercises e
  where (p_target_region is null or p_target_region='Full Body' or e.body_region=p_target_region)
    and 'WOD'=any(e.usable_for)
    and not coalesce(e.warmup_only,false)
    and e.technical_complexity<=p_max_complexity;

  -- Warm-up: hard gates + strict warm-up metadata, then role diversity.
  for r in
    select e.*,
      case e.warmup_role when 'mobility' then 1 when 'activation' then 2 when 'movement_prep' then 3 when 'pulse_raiser' then 4 else 5 end role_rank,
      case when e.warmup_role='movement_prep' and e.movement_pattern=any(v_target_patterns) then 0 else 1 end prep_rank
    from public.exercises e
    where 'Warm-up'=any(e.usable_for)
      and coalesce(e.warmup_eligible,false)
      and coalesce(e.warmup_intensity,99)<=2
      and coalesce(e.fatigue_score,99)<=2
      and coalesce(e.joint_impact,99)<=2
      and coalesce(e.technical_complexity,99)<=p_max_complexity
      and public.exercise_safe_for_zones(e.id,public.normalize_body_zone_ids(coalesce(p_zone_terms,'{}'::text[])))
      and public.exercise_equipment_compatible(e.id,p_inventory)
    order by prep_rank,role_rank,coalesce(e.selection_weight,0) desc,e.id
  loop
    exit when jsonb_array_length(v_warmup)>=v_warmup_count;
    if not exists(select 1 from jsonb_array_elements(v_warmup) x where x->>'warmup_role'=r.warmup_role)
       or jsonb_array_length(v_warmup)>=3 then
      v_pres:=public.c2_solver_prescription(p_user_id,r.id,v_stimulus,'WARMUP',p_progression_intent,p_inventory)
        ||jsonb_build_object('block_role','warmup','warmup_role',r.warmup_role,'target_duration_minutes',v_warmup_min);
      v_warmup:=v_warmup||jsonb_build_array(jsonb_build_object(
        'exercise_id',r.id,'name',r.name,'pattern',r.movement_pattern,'family',r.exercise_family,'warmup_role',r.warmup_role,
        'prescription',v_pres,
        'expected_outcome',jsonb_build_object('block_key','warmup','goal','prepare_without_fatigue','warmup_role',r.warmup_role,'pain_gate',true,'equipment_gate',true)
      ));
    end if;
  end loop;

  if jsonb_array_length(v_warmup)<2 then
    return jsonb_build_object('version','c4-full-session-v1','status','NO_SAFE_WARMUP','production_mutation',false,'stimulus',v_stimulus);
  end if;

  -- Optional core-only Tabata, strict 20/10 x 8 protocol.
  if v_include_tabata then
    for r in
      select e.*
      from public.exercises e
      where 'Core'=any(e.usable_for)
        and not coalesce(e.warmup_only,false)
        and coalesce(e.technical_complexity,99)<=p_max_complexity
        and coalesce(e.fatigue_score,99)<=4
        and coalesce(e.joint_impact,99)<=3
        and e.exercise_family='Core'
        and public.exercise_safe_for_zones(e.id,public.normalize_body_zone_ids(coalesce(p_zone_terms,'{}'::text[])))
        and public.exercise_equipment_compatible(e.id,p_inventory)
      order by case when e.body_region='Core' then 0 else 1 end,coalesce(e.selection_weight,0) desc,e.id
    loop
      exit when jsonb_array_length(v_tabata)>=2;
      if not exists(select 1 from jsonb_array_elements(v_tabata) x where x->>'pattern'=r.movement_pattern) then
        v_pres:=public.c2_solver_prescription(p_user_id,r.id,v_stimulus,'TABATA',p_progression_intent,p_inventory)
          ||jsonb_build_object('block_role','tabata','protocol',jsonb_build_object('rounds',8,'work_seconds',20,'rest_seconds',10,'rotation','alternate_exercises'));
        v_tabata:=v_tabata||jsonb_build_array(jsonb_build_object(
          'exercise_id',r.id,'name',r.name,'pattern',r.movement_pattern,'family',r.exercise_family,'prescription',v_pres,
          'expected_outcome',jsonb_build_object('block_key','tabata','protocol','20_on_10_off_x8','core_only',true,'pain_gate',true,'equipment_gate',true)
        ));
      end if;
    end loop;
    if jsonb_array_length(v_tabata)=0 then v_include_tabata:=false;v_tabata_min:=0;v_wod_min:=v_wod_min+4; end if;
  end if;

  -- Optional Skill: technique/progression without turning into a second WOD.
  if v_include_skill then
    select e.* into r
    from public.exercises e
    left join public.user_exercise_coach_state s on s.user_id=p_user_id and s.exercise_id=e.id
    where 'Skill'=any(e.usable_for)
      and not coalesce(e.warmup_only,false)
      and coalesce(e.technical_complexity,99)<=p_max_complexity
      and coalesce(e.fatigue_score,99)<=3
      and coalesce(e.joint_impact,99)<=3
      and (p_target_region is null or p_target_region='Full Body' or e.body_region=p_target_region)
      and public.exercise_safe_for_zones(e.id,public.normalize_body_zone_ids(coalesce(p_zone_terms,'{}'::text[])))
      and public.exercise_equipment_compatible(e.id,p_inventory)
    order by
      case when coalesce(s.recommendation,'') in ('PROGRESS_RECOMMENDED','PROGRESS_POSSIBLE') then 0 else 1 end,
      coalesce(s.mastery_score,0) asc,coalesce(e.selection_weight,0) desc,e.id
    limit 1;

    if found then
      v_pres:=public.c2_solver_prescription(p_user_id,r.id,v_stimulus,'SKILL',p_progression_intent,p_inventory)
        ||jsonb_build_object('block_role','skill','target_duration_minutes',v_skill_min,'quality_priority','technique_before_fatigue');
      v_skill:=jsonb_build_array(jsonb_build_object(
        'exercise_id',r.id,'name',r.name,'pattern',r.movement_pattern,'family',r.exercise_family,'prescription',v_pres,
        'expected_outcome',jsonb_build_object('block_key','skill','goal','technical_quality_or_progression','pain_gate',true,'equipment_gate',true)
      ));
    else
      v_include_skill:=false;v_skill_min:=0;v_wod_min:=v_wod_min+case when p_duration_minutes>=75 then 10 else 8 end;
    end if;
  end if;

  -- C4 remains authoritative for the WOD.
  v_wod:=public.solve_session_engine_c4(
    p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
    p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty,p_candidate_count,v_wod_min,p_policy_key
  );
  if coalesce(v_wod->>'status','')<>'READY' or v_wod->'selected_candidate' is null then
    return jsonb_build_object(
      'version','c4-full-session-v1','status','NO_SAFE_COHERENT_WOD','production_mutation',false,
      'stimulus',v_stimulus,'architecture',jsonb_build_object('warmup_minutes',v_warmup_min,'tabata_minutes',v_tabata_min,'skill_minutes',v_skill_min,'wod_minutes',v_wod_min),
      'wod_solver',v_wod
    );
  end if;
  v_wod_candidate:=v_wod->'selected_candidate';

  v_blocks:=v_blocks||jsonb_build_array(jsonb_build_object(
    'block_key','warmup','block_name','Échauffement','duration_minutes',v_warmup_min,
    'required',true,'exercises',v_warmup,'expected_outcome',jsonb_build_object('role','prepare','fatigue_ceiling','low')
  ));
  if v_include_tabata then
    v_blocks:=v_blocks||jsonb_build_array(jsonb_build_object(
      'block_key','tabata','block_name','Core Tabata','duration_minutes',4,'required',false,
      'structure','8 rounds — 20s travail / 10s repos','exercises',v_tabata,
      'expected_outcome',jsonb_build_object('role','core_conditioning','protocol','tabata_4min')
    ));
  end if;
  if v_include_skill then
    v_blocks:=v_blocks||jsonb_build_array(jsonb_build_object(
      'block_key','skill','block_name','Skill','duration_minutes',v_skill_min,'required',false,'exercises',v_skill,
      'expected_outcome',jsonb_build_object('role','skill','quality_priority',true)
    ));
  end if;
  v_blocks:=v_blocks||jsonb_build_array(jsonb_build_object(
    'block_key','wod','block_name','WOD principal','duration_minutes',v_wod_min,'required',true,
    'mechanic',v_wod_candidate->>'mechanic','mechanic_json',v_wod_candidate#>'{c4_final,mechanic_json}',
    'exercises',v_wod_candidate->'exercises','expected_outcome',jsonb_build_object(
      'role','primary_training_stimulus','predicted_volume',v_wod_candidate#>'{c4_final,predicted_volume}',
      'whole_wod_metrics',v_wod_candidate#>'{c4_final,whole_wod_metrics}')
  ));

  return jsonb_build_object(
    'version','c4-full-session-v1','status','READY','production_mutation',false,
    'stimulus',v_stimulus,
    'architecture',jsonb_build_object(
      'total_minutes',p_duration_minutes,'warmup_minutes',v_warmup_min,'tabata_minutes',v_tabata_min,
      'skill_minutes',v_skill_min,'wod_minutes',v_wod_min,'tabata_optional',true,'skill_optional',true,'warmup_required',true,'wod_required',true),
    'blocks',v_blocks,
    'wod_solver',jsonb_build_object(
      'version',v_wod->'version','candidate_count',v_wod->'candidate_count','quality_gate',v_wod_candidate->'c4_quality_gate',
      'anti_redundancy',v_wod_candidate->'c4_anti_redundancy','selection_score',v_wod_candidate->'c4_selection_score'),
    'selected_candidate',v_wod_candidate
  );
end;
$$;

-- Mutating authenticated entrypoint: persists the entire plan and exact exercise instances.
create or replace function public.c4_generate_full_session(
  p_user_id uuid,
  p_focus text,
  p_duration_minutes integer,
  p_readiness text,
  p_target_region text default null,
  p_progression_intent text default null,
  p_zone_terms text[] default '{}'::text[],
  p_inventory jsonb default '[]'::jsonb,
  p_available_equipment text[] default '{}'::text[],
  p_max_complexity integer default 3,
  p_max_difficulty text default 'Intermédiaire',
  p_candidate_count integer default 12,
  p_policy_key text default 'c4-final-default'
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_plan jsonb;
  v_session_id uuid;
  v_blocks jsonb:='[]'::jsonb;
  v_block jsonb;
  v_block_out jsonb;
  v_ex jsonb;
  v_ex_out jsonb;
  v_pres jsonb;
  v_instance uuid;
  v_db_block text;
  v_position int;
  v_cap jsonb;
  v_generated jsonb;
  v_mechanic jsonb;
  v_quality jsonb;
  v_rpe_min numeric;
  v_rpe_max numeric;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;

  v_plan:=public.c4_plan_full_session(
    p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
    p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty,p_candidate_count,p_policy_key
  );
  if coalesce(v_plan->>'status','')<>'READY' then return v_plan; end if;

  v_mechanic:=coalesce(v_plan#>'{selected_candidate,c4_final,mechanic_json}','{}'::jsonb);
  v_quality:=coalesce(v_plan#>'{selected_candidate,c4_quality_gate}','{}'::jsonb)||jsonb_build_object(
    'anti_redundancy',coalesce(v_plan#>'{selected_candidate,c4_anti_redundancy}','{}'::jsonb),
    'selection_score',v_plan#>'{selected_candidate,c4_selection_score}');
  v_rpe_min:=nullif(v_plan#>>'{stimulus,rpe_target,min}','')::numeric;
  v_rpe_max:=nullif(v_plan#>>'{stimulus,rpe_target,max}','')::numeric;

  insert into public.workout_sessions(
    user_id,status,duration_minutes,target_region,readiness,focus,available_equipment,injured_zones,progression_intent,
    planning_context_json,expected_stimulus_json,mechanic_json,quality_gate_json,generated_workout
  ) values (
    p_user_id,'generated',p_duration_minutes,p_target_region,p_readiness,p_focus,coalesce(p_available_equipment,'{}'::text[]),coalesce(p_zone_terms,'{}'::text[]),
    case when upper(coalesce(p_progression_intent,'')) in ('MAINTAIN','PROGRESS','CONSOLIDATE','DELOAD','RECALIBRATE','EXPLORE') then upper(p_progression_intent) else null end,
    jsonb_build_object('engine','c4-full-session-v1','architecture',v_plan->'architecture','full_session_authority',true),
    coalesce(v_plan->'stimulus','{}'::jsonb),v_mechanic,v_quality,'{}'::jsonb
  ) returning id into v_session_id;

  for v_block in select value from jsonb_array_elements(v_plan->'blocks')
  loop
    v_db_block:=case v_block->>'block_key' when 'warmup' then 'warm_up' else v_block->>'block_key' end;
    v_block_out:=v_block;
    v_ex_out:='[]'::jsonb;v_position:=0;

    for v_ex in select value from jsonb_array_elements(coalesce(v_block->'exercises','[]'::jsonb))
    loop
      v_position:=v_position+1;
      v_pres:=coalesce(v_ex->'prescription','{}'::jsonb);
      select coalesce(jsonb_build_object(
        'source','user_exercise_coach_state','state',s.state,'recommendation',s.recommendation,
        'reps_envelope',s.reps_envelope,'load_envelope',s.load_envelope,'time_envelope',s.time_envelope,
        'distance_envelope',s.distance_envelope,'pace_envelope',s.pace_envelope,
        'capability_confidence',s.capability_confidence,'capability_freshness',s.capability_freshness,
        'valid_evidence_count',s.valid_evidence_count),'{}'::jsonb)
      into v_cap
      from public.user_exercise_coach_state s where s.user_id=p_user_id and s.exercise_id=v_ex->>'exercise_id';

      insert into public.workout_session_exercises(
        session_id,exercise_id,exercise_name,block_key,position,status,prescription,prescription_json,
        expected_outcome_json,expected_rpe_min,expected_rpe_max,capacity_snapshot_json,solver_decision_json
      ) values (
        v_session_id,v_ex->>'exercise_id',coalesce(v_ex->>'name',(select name from public.exercises where id=v_ex->>'exercise_id')),
        v_db_block,v_position,'pending',coalesce(v_pres->>'text','Prescription adaptée'),v_pres,
        coalesce(v_ex->'expected_outcome',v_block->'expected_outcome','{}'::jsonb),v_rpe_min,v_rpe_max,coalesce(v_cap,'{}'::jsonb),
        jsonb_build_object('engine','c4-full-session-v1','block_key',v_block->>'block_key','full_session_authority',true,
          'mechanic',case when v_block->>'block_key'='wod' then v_block->>'mechanic' else null end)
      ) returning id into v_instance;

      v_ex_out:=v_ex_out||jsonb_build_array(v_ex||jsonb_build_object('id',v_ex->>'exercise_id','session_exercise_id',v_instance));
    end loop;

    v_block_out:=jsonb_set(v_block_out,'{exercises}',v_ex_out,true);
    v_blocks:=v_blocks||jsonb_build_array(v_block_out);
  end loop;

  v_generated:=jsonb_build_object(
    'version','c4-full-session-v1','session_id',v_session_id,
    'meta',jsonb_build_object('session_engine','c4-full-session-v1','full_session_authority',true,'architecture',v_plan->'architecture',
      'target_region',p_target_region,'focus',p_focus,'progression_intent',p_progression_intent),
    'blocks',v_blocks
  );

  update public.workout_sessions set generated_workout=v_generated,updated_at=now() where id=v_session_id;

  return jsonb_build_object('session_id',v_session_id,'status','generated','version','c4-full-session-v1',
    'meta',v_generated->'meta','blocks',v_blocks,'stimulus',v_plan->'stimulus','wod_solver',v_plan->'wod_solver');
end;
$$;

revoke all on function public.c4_generate_full_session(uuid,text,integer,text,text,text,text[],jsonb,text[],integer,text,integer,text) from public;
grant execute on function public.c4_generate_full_session(uuid,text,integer,text,text,text,text[],jsonb,text[],integer,text,integer,text) to authenticated;
;



-- SOURCE MIGRATION: 20260811165158_phase_c42_trim_audit_fix.sql
-- Fix only the audit metadata for trimmed exercises; solver behavior was already correct.
create or replace function public.c4_trimmed_ids(p_before jsonb,p_after jsonb)
returns jsonb
language sql
immutable
as $$
  select coalesce(jsonb_agg(o.value->>'exercise_id'),'[]'::jsonb)
  from jsonb_array_elements(coalesce(p_before,'[]'::jsonb)) o
  where not exists(
    select 1 from jsonb_array_elements(coalesce(p_after,'[]'::jsonb)) a
    where a.value->>'exercise_id'=o.value->>'exercise_id'
  );
$$;;



-- SOURCE MIGRATION: 20260811165223_phase_c44_mechanic_structure_redundancy.sql
-- C4.4a — mechanic + structure diversity as a soft tie-breaker, never a hard safety override.
update public.session_engine_policy
set config=jsonb_set(
  jsonb_set(config,'{anti_redundancy,mechanic_penalty}','10'::jsonb,true),
  '{anti_redundancy,structure_penalty}','12'::jsonb,true
)
where policy_key='c4-final-default';

create or replace function public.c4_redundancy_score(
  p_user_id uuid,
  p_candidate jsonb,
  p_policy_key text default 'c4-final-default'
)
returns jsonb
language plpgsql
stable
set search_path=public
as $$
declare
  v_cfg jsonb;
  v_recent int;
  v_exact_pen numeric;v_family_pen numeric;v_pattern_pen numeric;v_mechanic_pen numeric;v_structure_pen numeric;
  v_exact_ratio numeric:=0;v_family_ratio numeric:=0;v_pattern_ratio numeric:=0;v_mechanic_ratio numeric:=0;v_structure_ratio numeric:=0;
  v_score numeric:=100;v_recent_count int:=0;
  v_mechanic text:=upper(coalesce(p_candidate->>'mechanic',p_candidate#>>'{c4_final,mechanic_json,mechanic_key}',''));
  v_variant text:=upper(coalesce(p_candidate->>'variant_key',p_candidate#>>'{c4_final,mechanic_json,variant_key}',''));
  v_count int:=jsonb_array_length(coalesce(p_candidate->'exercises','[]'::jsonb));
  v_structure text;
begin
  select config into v_cfg from public.session_engine_policy where policy_key=p_policy_key;
  if v_cfg is null then raise exception 'Unknown C4 policy %',p_policy_key; end if;
  v_recent:=coalesce((v_cfg#>>'{anti_redundancy,recent_sessions}')::int,3);
  v_exact_pen:=coalesce((v_cfg#>>'{anti_redundancy,exact_non_anchor_penalty}')::numeric,45);
  v_family_pen:=coalesce((v_cfg#>>'{anti_redundancy,family_penalty}')::numeric,25);
  v_pattern_pen:=coalesce((v_cfg#>>'{anti_redundancy,pattern_penalty}')::numeric,15);
  v_mechanic_pen:=coalesce((v_cfg#>>'{anti_redundancy,mechanic_penalty}')::numeric,10);
  v_structure_pen:=coalesce((v_cfg#>>'{anti_redundancy,structure_penalty}')::numeric,12);
  v_structure:=v_mechanic||':'||coalesce(nullif(v_variant,''),'BASE')||':'||v_count::text;

  with recent as (
    select ws.id,
      upper(coalesce(ws.mechanic_json->>'mechanic_key',ws.mechanic_json->>'mechanic','')) mechanic,
      upper(coalesce(ws.mechanic_json->>'variant_key','')) variant_key,
      (select count(*) from public.workout_session_exercises z where z.session_id=ws.id and z.block_key='wod') exercise_count
    from public.workout_sessions ws
    where ws.user_id=p_user_id and ws.status='completed'
    order by coalesce(ws.completed_at,ws.generated_at) desc
    limit v_recent
  ), cand as (
    select e.id,e.exercise_family,e.movement_pattern,e.movement_pattern in ('Conditioning','Locomotion') anchor
    from jsonb_array_elements(coalesce(p_candidate->'exercises','[]'::jsonb)) x
    join public.exercises e on e.id=x->>'exercise_id'
  ), recent_ex as (
    select distinct wse.exercise_id,e.exercise_family,e.movement_pattern
    from recent r join public.workout_session_exercises wse on wse.session_id=r.id and wse.block_key='wod'
    join public.exercises e on e.id=wse.exercise_id
  ), stats as (
    select
      (select count(*) from recent) recent_count,
      (select count(*)::numeric/greatest(1,(select count(*) from cand where not anchor)) from cand c where not c.anchor and exists(select 1 from recent_ex r where r.exercise_id=c.id)) exact_ratio,
      (select count(*)::numeric/greatest(1,(select count(distinct exercise_family) from cand)) from (select distinct exercise_family from cand) c where exists(select 1 from recent_ex r where r.exercise_family=c.exercise_family)) family_ratio,
      (select count(*)::numeric/greatest(1,(select count(distinct movement_pattern) from cand)) from (select distinct movement_pattern from cand) c where exists(select 1 from recent_ex r where r.movement_pattern=c.movement_pattern)) pattern_ratio,
      (select count(*)::numeric/greatest(1,(select count(*) from recent)) from recent r where r.mechanic=v_mechanic) mechanic_ratio,
      (select count(*)::numeric/greatest(1,(select count(*) from recent)) from recent r where (r.mechanic||':'||coalesce(nullif(r.variant_key,''),'BASE')||':'||r.exercise_count::text)=v_structure) structure_ratio
  )
  select recent_count,coalesce(exact_ratio,0),coalesce(family_ratio,0),coalesce(pattern_ratio,0),coalesce(mechanic_ratio,0),coalesce(structure_ratio,0)
  into v_recent_count,v_exact_ratio,v_family_ratio,v_pattern_ratio,v_mechanic_ratio,v_structure_ratio from stats;

  if v_recent_count>0 then
    v_score:=greatest(0,least(100,100-v_exact_ratio*v_exact_pen-v_family_ratio*v_family_pen-v_pattern_ratio*v_pattern_pen-v_mechanic_ratio*v_mechanic_pen-v_structure_ratio*v_structure_pen));
  end if;

  return jsonb_build_object(
    'score',round(v_score,2),'recent_sessions_considered',v_recent_count,
    'exact_non_anchor_overlap_ratio',round(v_exact_ratio,3),'family_overlap_ratio',round(v_family_ratio,3),'pattern_overlap_ratio',round(v_pattern_ratio,3),
    'mechanic_overlap_ratio',round(v_mechanic_ratio,3),'structure_overlap_ratio',round(v_structure_ratio,3),
    'candidate_structure_signature',v_structure,'anchor_exact_repeat_exempt',true,
    'mechanic_structure_is_soft_tiebreaker',true,'version','c4-redundancy-v2-c44'
  );
end;
$$;;



-- SOURCE MIGRATION: 20260811165317_phase_c44_wod_recompile_persistence.sql
-- C4.4b — shared persistence/recompile path for swap and format changes.

create or replace function public.c4_prescription_text(p jsonb)
returns text
language plpgsql
immutable
as $$
declare a text;b text;v text:='Prescription adaptée';load_text text;
begin
  a:=coalesce(p->>'reps_min',p->>'duration_seconds_min',p->>'distance_meters_min');
  b:=coalesce(p->>'reps_max',p->>'duration_seconds_max',p->>'distance_meters_max');
  if p ? 'reps_min' or p ? 'reps_max' then
    v:=case when a=b or b is null then coalesce(a,b)||' reps' else a||' à '||b||' reps' end;
    if p->>'reps_semantics'='per_side' then v:=v||' par côté'; end if;
  elsif p ? 'duration_seconds_min' or p ? 'duration_seconds_max' then
    v:=case when a=b or b is null then coalesce(a,b)||' sec' else a||' à '||b||' sec' end;
  elsif p ? 'distance_meters_min' or p ? 'distance_meters_max' then
    v:=case when a=b or b is null then coalesce(a,b)||' m' else a||' à '||b||' m' end;
  end if;
  if nullif(p->>'load_kg','') is not null then
    load_text:=p->>'load_kg'||' kg';
    if p#>>'{load_resolution,load_scope}'='per_implement' then load_text:=load_text||' / élément'; end if;
    v:=v||' — '||load_text;
  end if;
  return v;
end;
$$;

create or replace function public.c4_session_wod_candidate(p_session_id uuid)
returns jsonb
language sql
stable
set search_path=public
as $$
  select jsonb_build_object(
    'mechanic',upper(coalesce(ws.mechanic_json->>'mechanic_key','CIRCUIT')),
    'variant_key',nullif(upper(coalesce(ws.mechanic_json->>'variant_key','')),''),
    'overlays',coalesce(ws.mechanic_json#>'{parameters,overlays}','[]'::jsonb),
    'coach_score',coalesce((select avg(coalesce(nullif(wse.solver_decision_json->>'exercise_candidate_score','')::numeric,50)) from public.workout_session_exercises wse where wse.session_id=ws.id and wse.block_key='wod'),50),
    'mechanic_fit',70,
    'exercises',coalesce((
      select jsonb_agg(jsonb_build_object(
        'exercise_id',wse.exercise_id,'name',wse.exercise_name,'pattern',e.movement_pattern,'family',e.exercise_family,
        'candidate_score',coalesce(nullif(wse.solver_decision_json->>'exercise_candidate_score','')::numeric,50),
        'components',coalesce(wse.solver_decision_json->'score_components','{}'::jsonb),
        'prescription',coalesce(wse.prescription_json,'{}'::jsonb)
      ) order by wse.position)
      from public.workout_session_exercises wse
      join public.exercises e on e.id=wse.exercise_id
      where wse.session_id=ws.id and wse.block_key='wod'
    ),'[]'::jsonb)
  )
  from public.workout_sessions ws where ws.id=p_session_id;
$$;

create or replace function public.c4_apply_wod_candidate(
  p_user_id uuid,
  p_session_id uuid,
  p_candidate jsonb,
  p_quality_gate jsonb,
  p_action text default 'RECOMPILE'
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  ws record;
  v_final jsonb:=coalesce(p_candidate->'c4_final','{}'::jsonb);
  v_mechanic_json jsonb:=coalesce(p_candidate#>'{c4_final,mechanic_json}','{}'::jsonb);
  v_mechanic text:=upper(coalesce(p_candidate->>'mechanic',v_mechanic_json->>'mechanic_key','CIRCUIT'));
  v_params jsonb:=coalesce(v_mechanic_json->'parameters','{}'::jsonb);
  v_ex jsonb;v_pres jsonb;v_instance uuid;v_name text;v_position int:=0;v_new_count int;
  v_rounds int;v_cap jsonb;v_wod_exercises jsonb:='[]'::jsonb;
  v_generated jsonb;v_blocks jsonb:='[]'::jsonb;v_block jsonb;v_wod_block jsonb:='{}'::jsonb;v_found_wod boolean:=false;
  v_duration int;v_rpe_min numeric;v_rpe_max numeric;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;
  select * into ws from public.workout_sessions where id=p_session_id and user_id=p_user_id for update;
  if not found then raise exception 'Session not found'; end if;
  if ws.status not in ('generated','in_progress') then raise exception 'Session cannot be recompiled in status %',ws.status; end if;

  v_new_count:=jsonb_array_length(coalesce(p_candidate->'exercises','[]'::jsonb));
  if v_new_count=0 then raise exception 'Cannot apply empty WOD'; end if;
  v_rpe_min:=nullif(ws.expected_stimulus_json#>>'{rpe_target,min}','')::numeric;
  v_rpe_max:=nullif(ws.expected_stimulus_json#>>'{rpe_target,max}','')::numeric;
  v_rounds:=coalesce(nullif(v_params->>'rounds','')::int,nullif(v_params->>'sets','')::int,nullif(v_params->>'cycles','')::int,nullif(v_params->>'rungs','')::int);

  for v_ex in select value from jsonb_array_elements(p_candidate->'exercises')
  loop
    v_position:=v_position+1;v_pres:=coalesce(v_ex->'prescription','{}'::jsonb);
    select name into v_name from public.exercises where id=v_ex->>'exercise_id';
    select id into v_instance from public.workout_session_exercises where session_id=p_session_id and block_key='wod' and position=v_position;

    select coalesce(jsonb_build_object(
      'source','user_exercise_coach_state','state',s.state,'recommendation',s.recommendation,
      'reps_envelope',s.reps_envelope,'load_envelope',s.load_envelope,'time_envelope',s.time_envelope,'distance_envelope',s.distance_envelope,'pace_envelope',s.pace_envelope,
      'capability_confidence',s.capability_confidence,'capability_freshness',s.capability_freshness,'valid_evidence_count',s.valid_evidence_count),'{}'::jsonb)
    into v_cap from public.user_exercise_coach_state s where s.user_id=p_user_id and s.exercise_id=v_ex->>'exercise_id';

    if v_instance is null then
      insert into public.workout_session_exercises(
        session_id,exercise_id,exercise_name,block_key,position,status,prescription,prescription_json,rounds,
        expected_outcome_json,expected_rpe_min,expected_rpe_max,capacity_snapshot_json,solver_decision_json
      ) values (
        p_session_id,v_ex->>'exercise_id',v_name,'wod',v_position,'pending',public.c4_prescription_text(v_pres),v_pres,v_rounds,
        jsonb_build_object('mechanic',v_mechanic,'block_parameters',v_params,'predicted_block_volume',coalesce(v_final->'predicted_volume','{}'::jsonb),'whole_wod_metrics',coalesce(v_final->'whole_wod_metrics','{}'::jsonb)),
        v_rpe_min,v_rpe_max,coalesce(v_cap,'{}'::jsonb),
        jsonb_build_object('engine_version','c4-full-backend-v2','action',p_action,'quality_gate',coalesce(p_quality_gate,'{}'::jsonb),'exercise_candidate_score',v_ex->'candidate_score','score_components',coalesce(v_ex->'components','{}'::jsonb),'mechanic',v_mechanic)
      ) returning id into v_instance;
    else
      update public.workout_session_exercises set
        exercise_id=v_ex->>'exercise_id',exercise_name=v_name,status='pending',prescription=public.c4_prescription_text(v_pres),prescription_json=v_pres,rounds=v_rounds,
        expected_outcome_json=jsonb_build_object('mechanic',v_mechanic,'block_parameters',v_params,'predicted_block_volume',coalesce(v_final->'predicted_volume','{}'::jsonb),'whole_wod_metrics',coalesce(v_final->'whole_wod_metrics','{}'::jsonb)),
        expected_rpe_min=v_rpe_min,expected_rpe_max=v_rpe_max,capacity_snapshot_json=coalesce(v_cap,'{}'::jsonb),
        solver_decision_json=jsonb_build_object('engine_version','c4-full-backend-v2','action',p_action,'quality_gate',coalesce(p_quality_gate,'{}'::jsonb),'exercise_candidate_score',v_ex->'candidate_score','score_components',coalesce(v_ex->'components','{}'::jsonb),'mechanic',v_mechanic),
        updated_at=now()
      where id=v_instance;
    end if;

    v_wod_exercises:=v_wod_exercises||jsonb_build_array(jsonb_build_object(
      'id',v_ex->>'exercise_id','session_exercise_id',v_instance,'name',v_name,
      'pattern',(select movement_pattern from public.exercises where id=v_ex->>'exercise_id'),
      'region',(select body_region from public.exercises where id=v_ex->>'exercise_id'),
      'prescription',public.c4_prescription_text(v_pres),'prescription_json',v_pres,
      'tracking_modes',(select to_jsonb(tracking_modes) from public.exercises where id=v_ex->>'exercise_id')
    ));
  end loop;

  delete from public.workout_session_exercises where session_id=p_session_id and block_key='wod' and position>v_new_count;

  v_generated:=coalesce(ws.generated_workout,'{}'::jsonb);
  for v_block in select value from jsonb_array_elements(coalesce(v_generated->'blocks','[]'::jsonb))
  loop
    if v_block->>'block_key'='wod' then
      v_found_wod:=true;
      v_duration:=coalesce(nullif(v_mechanic_json->>'wod_budget_minutes','')::int,nullif(v_block->>'duration_minutes','')::int,10);
      v_wod_block:=v_block||jsonb_build_object(
        'block_key','wod','block_name',coalesce(v_block->>'block_name','WOD principal'),'duration_minutes',v_duration,
        'mechanic',v_mechanic,'mechanic_json',v_mechanic_json,'structure',v_mechanic||' — '||v_duration||' min',
        'rounds',v_rounds,'exercises',v_wod_exercises,
        'expected_outcome',jsonb_build_object('role','primary_training_stimulus','predicted_volume',coalesce(v_final->'predicted_volume','{}'::jsonb),'whole_wod_metrics',coalesce(v_final->'whole_wod_metrics','{}'::jsonb))
      );
      v_blocks:=v_blocks||jsonb_build_array(v_wod_block);
    else
      v_blocks:=v_blocks||jsonb_build_array(v_block);
    end if;
  end loop;
  if not v_found_wod then
    v_duration:=coalesce(nullif(v_mechanic_json->>'wod_budget_minutes','')::int,10);
    v_blocks:=v_blocks||jsonb_build_array(jsonb_build_object('block_key','wod','block_name','WOD principal','duration_minutes',v_duration,'mechanic',v_mechanic,'mechanic_json',v_mechanic_json,'structure',v_mechanic||' — '||v_duration||' min','rounds',v_rounds,'exercises',v_wod_exercises));
  end if;

  v_generated:=jsonb_set(v_generated,'{blocks}',v_blocks,true);
  v_generated:=jsonb_set(v_generated,'{version}','"c4-full-backend-v2"'::jsonb,true);
  v_generated:=jsonb_set(v_generated,'{meta,session_engine}','"c4-full-backend-v2"'::jsonb,true);
  v_generated:=jsonb_set(v_generated,'{meta,last_wod_action}',to_jsonb(p_action),true);

  update public.workout_sessions set
    mechanic_json=v_mechanic_json,
    quality_gate_json=coalesce(p_quality_gate,'{}'::jsonb),
    generated_workout=v_generated,updated_at=now()
  where id=p_session_id and user_id=p_user_id;

  return jsonb_build_object('status','APPLIED','session_id',p_session_id,'action',p_action,'mechanic',v_mechanic,'mechanic_json',v_mechanic_json,'exercise_count',v_new_count,'exercises',v_wod_exercises,'generated_workout',v_generated);
end;
$$;

revoke all on function public.c4_apply_wod_candidate(uuid,uuid,jsonb,jsonb,text) from public;
grant execute on function public.c4_apply_wod_candidate(uuid,uuid,jsonb,jsonb,text) to authenticated;
;



-- SOURCE MIGRATION: 20260811165401_phase_c44_format_recompile.sql
-- C4.4c — format change re-enters the SAME compiler and quality gates.
create or replace function public.c4_recompile_session_format(
  p_user_id uuid,
  p_session_id uuid,
  p_new_mechanic text,
  p_variant_key text default null,
  p_overlays jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  ws record;
  v_mechanic text:=upper(trim(coalesce(p_new_mechanic,'')));
  v_variant text:=upper(trim(coalesce(p_variant_key,'')));
  v_names text[];
  v_inventory jsonb;
  v_base jsonb;v_exercises jsonb:='[]'::jsonb;v_ex jsonb;v_pres jsonb;
  v_expanded jsonb;v_prepared jsonb;v_final jsonb;v_gate jsonb;v_red jsonb;v_quality jsonb;
  v_original_count int;v_final_count int;v_wod_min int;v_class text;
  v_max_complexity int;
  v_result jsonb;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;
  select * into ws from public.workout_sessions where id=p_session_id and user_id=p_user_id for update;
  if not found then raise exception 'Session not found'; end if;
  if ws.status not in ('generated','in_progress') then raise exception 'Session cannot change format in status %',ws.status; end if;

  if not exists(select 1 from public.workout_mechanics wm where wm.mechanic_key=v_mechanic and wm.active and wm.mechanic_kind='core') then
    return jsonb_build_object('status','NOT_RECOMMENDED','classification','NOT_RECOMMENDED','reason','UNKNOWN_OR_INACTIVE_CORE_MECHANIC','mutated',false);
  end if;
  if jsonb_typeof(coalesce(p_overlays,'[]'::jsonb))<>'array' then
    return jsonb_build_object('status','NOT_RECOMMENDED','classification','NOT_RECOMMENDED','reason','OVERLAYS_MUST_BE_ARRAY','mutated',false);
  end if;
  if exists(select 1 from jsonb_array_elements(coalesce(p_overlays,'[]'::jsonb)) o where upper(coalesce(o->>'type','')) not in ('BUY_IN','CASH_OUT','BUY_IN_CASH_OUT','PENALTY')) then
    return jsonb_build_object('status','NOT_RECOMMENDED','classification','NOT_RECOMMENDED','reason','UNSUPPORTED_OVERLAY','mutated',false);
  end if;

  v_names:=coalesce(ws.available_equipment,'{}'::text[]);
  if cardinality(v_names)=0 then
    select coalesce(array_agg(e.name order by e.id),'{}'::text[]) into v_names
    from public.user_equipment_inventory ui join public.equipment e on e.id=ui.equipment_id
    where ui.user_id=p_user_id and ui.active;
  end if;
  if cardinality(v_names)=0 then v_names:=array['Aucun']; end if;
  v_inventory:=public.resolve_user_equipment_inventory(p_user_id,v_names,'c4-final-default');

  v_base:=public.c4_session_wod_candidate(p_session_id);
  if v_base is null or jsonb_array_length(coalesce(v_base->'exercises','[]'::jsonb))=0 then raise exception 'Session has no WOD'; end if;
  v_original_count:=jsonb_array_length(v_base->'exercises');
  v_max_complexity:=case lower(coalesce(ws.readiness,'normal')) when 'low' then 3 else 5 end;

  -- Rebuild every existing prescription for the new mechanic; no second conversion engine.
  for v_ex in select value from jsonb_array_elements(v_base->'exercises')
  loop
    v_pres:=public.c2_solver_prescription(p_user_id,v_ex->>'exercise_id',ws.expected_stimulus_json,v_mechanic,ws.progression_intent,v_inventory);
    v_exercises:=v_exercises||jsonb_build_array(jsonb_set(v_ex,'{prescription}',v_pres,true));
  end loop;
  v_base:=jsonb_set(v_base,'{exercises}',v_exercises,true);
  v_base:=jsonb_set(v_base,'{mechanic}',to_jsonb(v_mechanic),true);
  if v_variant<>'' then v_base:=jsonb_set(v_base,'{variant_key}',to_jsonb(v_variant),true); else v_base:=v_base-'variant_key'; end if;
  v_base:=jsonb_set(v_base,'{overlays}',coalesce(p_overlays,'[]'::jsonb),true);

  v_expanded:=public.c4_expand_candidate_to_block_rules(
    v_base,p_user_id,coalesce(ws.focus,'General Fitness'),coalesce(ws.duration_minutes,45),coalesce(ws.readiness,'normal'),ws.target_region,ws.progression_intent,
    coalesce(ws.injured_zones,'{}'::text[]),v_inventory,v_max_complexity,'Avancé'
  );
  v_prepared:=public.c4_prepare_candidate(v_expanded,'c4-final-default');
  v_wod_min:=coalesce(nullif(ws.mechanic_json->>'wod_budget_minutes','')::int,nullif(ws.planning_context_json#>>'{architecture,wod_minutes}','')::int,
    (select nullif(b->>'duration_minutes','')::int from jsonb_array_elements(coalesce(ws.generated_workout->'blocks','[]'::jsonb)) b where b->>'block_key'='wod' limit 1),10);
  v_final:=public.c4_finalize_candidate(v_prepared,ws.expected_stimulus_json,coalesce(ws.duration_minutes,45),v_wod_min,'c4-final-default','c3-sim-default');
  v_gate:=public.c4_candidate_quality_gate_v2(v_final,coalesce(ws.readiness,'normal'),coalesce(ws.focus,'General Fitness'),ws.target_region,coalesce(ws.injured_zones,'{}'::text[]),v_inventory,v_max_complexity,'c4-final-default');
  v_red:=public.c4_redundancy_score(p_user_id,v_final,'c4-final-default');
  v_final_count:=jsonb_array_length(coalesce(v_final->'exercises','[]'::jsonb));

  if coalesce((v_final#>>'{c4_final,feasible}')::boolean,false)=false or coalesce((v_gate->>'pass')::boolean,false)=false then
    return jsonb_build_object('status','NOT_RECOMMENDED','classification','NOT_RECOMMENDED','mutated',false,'mechanic',v_mechanic,'variant_key',nullif(v_variant,''),
      'quality_gate',v_gate,'final_status',v_final#>>'{c4_final,status}','reasons',v_final#>'{c4_final,reasons}');
  end if;

  v_class:=case when v_final_count=v_original_count then 'COMPATIBLE' else 'ADAPTABLE' end;
  v_quality:=v_gate||jsonb_build_object('anti_redundancy',v_red,'format_change_classification',v_class,'format_change_uses_same_compiler',true);
  v_result:=public.c4_apply_wod_candidate(p_user_id,p_session_id,v_final,v_quality,'FORMAT_CHANGE:'||v_mechanic||case when v_variant<>'' then ':'||v_variant else '' end);
  return jsonb_build_object('status','APPLIED','classification',v_class,'mutated',true,'mechanic',v_mechanic,'variant_key',nullif(v_variant,''),
    'original_exercise_count',v_original_count,'final_exercise_count',v_final_count,'quality_gate',v_quality,'result',v_result);
end;
$$;

revoke all on function public.c4_recompile_session_format(uuid,uuid,text,text,jsonb) from public;
grant execute on function public.c4_recompile_session_format(uuid,uuid,text,text,jsonb) to authenticated;
;



-- SOURCE MIGRATION: 20260811165426_phase_c44_exact_instance_swap.sql
-- C4.4d — exact session_exercise_id swap; complete WOD is re-simulated before persistence.
create or replace function public.c4_swap_session_exercise(
  p_user_id uuid,
  p_session_exercise_id uuid,
  p_excluded_exercise_ids text[] default '{}'::text[]
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  target record;
  ws record;
  v_names text[];
  v_inventory jsonb;
  v_base jsonb;v_candidate jsonb;v_exercises jsonb;v_final jsonb;v_prepared jsonb;v_gate jsonb;v_red jsonb;v_quality jsonb;
  v_best jsonb:=null;v_best_gate jsonb:=null;v_best_red jsonb:=null;v_best_score numeric:=-1e9;
  v_score numeric;v_same_pattern numeric;v_same_family numeric;v_wod_min int;v_max_complexity int;
  r record;v_pres jsonb;v_new_ex jsonb;v_result jsonb;v_new_id text:=null;v_tested int:=0;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;

  select wse.*,e.movement_pattern old_pattern,e.exercise_family old_family
  into target
  from public.workout_session_exercises wse
  join public.workout_sessions s on s.id=wse.session_id
  join public.exercises e on e.id=wse.exercise_id
  where wse.id=p_session_exercise_id and s.user_id=p_user_id;
  if not found then raise exception 'Session exercise instance not found'; end if;
  if target.block_key<>'wod' then
    return jsonb_build_object('status','NOT_SUPPORTED','reason','C4_SWAP_REQUIRES_WOD_INSTANCE','session_exercise_id',p_session_exercise_id,'mutated',false);
  end if;

  select * into ws from public.workout_sessions where id=target.session_id and user_id=p_user_id for update;
  if ws.status not in ('generated','in_progress') then raise exception 'Session cannot swap in status %',ws.status; end if;

  v_names:=coalesce(ws.available_equipment,'{}'::text[]);
  if cardinality(v_names)=0 then
    select coalesce(array_agg(e.name order by e.id),'{}'::text[]) into v_names
    from public.user_equipment_inventory ui join public.equipment e on e.id=ui.equipment_id
    where ui.user_id=p_user_id and ui.active;
  end if;
  if cardinality(v_names)=0 then v_names:=array['Aucun']; end if;
  v_inventory:=public.resolve_user_equipment_inventory(p_user_id,v_names,'c4-final-default');
  v_base:=public.c4_session_wod_candidate(target.session_id);
  v_wod_min:=coalesce(nullif(ws.mechanic_json->>'wod_budget_minutes','')::int,nullif(ws.planning_context_json#>>'{architecture,wod_minutes}','')::int,
    (select nullif(b->>'duration_minutes','')::int from jsonb_array_elements(coalesce(ws.generated_workout->'blocks','[]'::jsonb)) b where b->>'block_key'='wod' limit 1),10);
  v_max_complexity:=case lower(coalesce(ws.readiness,'normal')) when 'low' then 3 else 5 end;

  for r in
    select cp.*
    from public.c2_candidate_pool(
      p_user_id,coalesce(ws.focus,'General Fitness'),coalesce(ws.duration_minutes,45),coalesce(ws.readiness,'normal'),ws.target_region,ws.progression_intent,
      coalesce(ws.injured_zones,'{}'::text[]),v_inventory,'WOD',v_max_complexity,'Avancé',60
    ) cp
    where cp.exercise_id<>target.exercise_id
      and not (cp.exercise_id=any(coalesce(p_excluded_exercise_ids,'{}'::text[])))
      and not exists(select 1 from jsonb_array_elements(v_base->'exercises') x where x->>'exercise_id'=cp.exercise_id)
    order by
      case when cp.movement_pattern=target.old_pattern then 0 when cp.exercise_family=target.old_family then 1 else 2 end,
      cp.candidate_score desc,cp.exercise_id
  loop
    v_tested:=v_tested+1;
    exit when v_tested>25;
    v_pres:=public.c2_solver_prescription(p_user_id,r.exercise_id,ws.expected_stimulus_json,v_base->>'mechanic',ws.progression_intent,v_inventory);
    v_new_ex:=jsonb_build_object('exercise_id',r.exercise_id,'name',r.exercise_name,'pattern',r.movement_pattern,'family',r.exercise_family,
      'candidate_score',r.candidate_score,'components',r.score_components,'prescription',v_pres);

    select coalesce(jsonb_agg(case when ord=target.position then v_new_ex else value end order by ord),'[]'::jsonb)
    into v_exercises
    from jsonb_array_elements(v_base->'exercises') with ordinality x(value,ord);

    v_candidate:=jsonb_set(v_base,'{exercises}',v_exercises,true);
    v_prepared:=public.c4_prepare_candidate(v_candidate,'c4-final-default');
    v_final:=public.c4_finalize_candidate(v_prepared,ws.expected_stimulus_json,coalesce(ws.duration_minutes,45),v_wod_min,'c4-final-default','c3-sim-default');
    v_gate:=public.c4_candidate_quality_gate_v2(v_final,coalesce(ws.readiness,'normal'),coalesce(ws.focus,'General Fitness'),ws.target_region,
      coalesce(ws.injured_zones,'{}'::text[]),v_inventory,v_max_complexity,'c4-final-default');
    if coalesce((v_gate->>'pass')::boolean,false)=false or coalesce((v_final#>>'{c4_final,feasible}')::boolean,false)=false then continue; end if;

    v_red:=public.c4_redundancy_score(p_user_id,v_final,'c4-final-default');
    v_same_pattern:=case when r.movement_pattern=target.old_pattern then 10 else 0 end;
    v_same_family:=case when r.exercise_family=target.old_family then 5 else 0 end;
    v_score:=coalesce(r.candidate_score,0)*0.40+coalesce((v_final#>>'{c4_final,whole_wod_metrics,whole_wod_fit}')::numeric,0)*0.40+
      coalesce((v_red->>'score')::numeric,0)*0.20+v_same_pattern+v_same_family;

    if v_score>v_best_score then
      v_best_score:=v_score;v_best:=v_final;v_best_gate:=v_gate;v_best_red:=v_red;v_new_id:=r.exercise_id;
    end if;
  end loop;

  if v_best is null then
    return jsonb_build_object('status','NO_SAFE_SWAP','mutated',false,'session_exercise_id',p_session_exercise_id,'old_exercise_id',target.exercise_id,'candidates_tested',v_tested);
  end if;

  v_quality:=v_best_gate||jsonb_build_object('anti_redundancy',v_best_red,'swap_full_wod_resimulated',true,'swap_score',round(v_best_score,2),'target_session_exercise_id',p_session_exercise_id);
  v_result:=public.c4_apply_wod_candidate(p_user_id,target.session_id,v_best,v_quality,'SWAP_INSTANCE:'||p_session_exercise_id::text);

  return jsonb_build_object(
    'status','APPLIED','mutated',true,'session_id',target.session_id,'session_exercise_id',p_session_exercise_id,
    'position',target.position,'old_exercise_id',target.exercise_id,'new_exercise_id',v_new_id,'candidates_tested',v_tested,
    'full_wod_resimulated',true,'quality_gate',v_quality,'result',v_result
  );
end;
$$;

revoke all on function public.c4_swap_session_exercise(uuid,uuid,text[]) from public;
grant execute on function public.c4_swap_session_exercise(uuid,uuid,text[]) to authenticated;
;



-- SOURCE MIGRATION: 20260811165526_phase_c42_trim_audit_wrapper.sql
do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='c4_expand_candidate_to_block_rules'
  ) and not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='c4_expand_candidate_to_block_rules_c42_base'
  ) then
    alter function public.c4_expand_candidate_to_block_rules(jsonb,uuid,text,integer,text,text,text,text[],jsonb,integer,text)
      rename to c4_expand_candidate_to_block_rules_c42_base;
  end if;
end $$;

create or replace function public.c4_expand_candidate_to_block_rules(
  p_candidate jsonb,
  p_user_id uuid,
  p_focus text,
  p_duration_minutes integer,
  p_readiness text,
  p_target_region text,
  p_progression_intent text,
  p_zone_terms text[],
  p_inventory jsonb,
  p_max_complexity integer,
  p_max_difficulty text
)
returns jsonb
language plpgsql
stable
set search_path=public
as $$
declare v_result jsonb;v_trimmed jsonb;
begin
  v_result:=public.c4_expand_candidate_to_block_rules_c42_base(
    p_candidate,p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
    p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty
  );
  v_trimmed:=public.c4_trimmed_ids(coalesce(p_candidate->'exercises','[]'::jsonb),coalesce(v_result->'exercises','[]'::jsonb));
  if coalesce((v_result#>>'{c4_block_rules,rule_found}')::boolean,false) then
    v_result:=jsonb_set(v_result,'{c4_block_rules,trimmed_exercise_ids}',v_trimmed,true);
  end if;
  return v_result;
end;
$$;;



-- SOURCE MIGRATION: 20260811165810_phase_c41_couplet_direction_contract.sql
-- Make ascending/descending couplet execution semantics explicit in the compiled protocol.
do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='c4_finalize_candidate'
  ) and not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='c4_finalize_candidate_c41_dispatch_base'
  ) then
    alter function public.c4_finalize_candidate(jsonb,jsonb,integer,integer,text,text)
      rename to c4_finalize_candidate_c41_dispatch_base;
  end if;
end $$;

create or replace function public.c4_finalize_candidate(
  p_candidate jsonb,
  p_stimulus jsonb,
  p_total_duration_minutes integer,
  p_exact_wod_minutes integer default null,
  p_c4_policy_key text default 'c4-final-default',
  p_c3_policy_key text default 'c3-sim-default'
)
returns jsonb
language plpgsql
stable
set search_path=public
as $$
declare
  v_result jsonb;
  v_mechanic text:=upper(coalesce(p_candidate->>'mechanic',''));
  v_variant text:=upper(coalesce(p_candidate->>'variant_key',''));
  v_rungs int;
  v_schedule jsonb:='[]'::jsonb;
  x jsonb;
  v_base int;v_inc int;v_first int;v_last int;
begin
  v_result:=public.c4_finalize_candidate_c41_dispatch_base(
    p_candidate,p_stimulus,p_total_duration_minutes,p_exact_wod_minutes,p_c4_policy_key,p_c3_policy_key
  );

  if v_mechanic='COUPLET' and v_variant in ('ASCENDING_COUPLET','DESCENDING_COUPLET') then
    v_rungs:=coalesce(nullif(v_result#>>'{c4_final,mechanic_json,parameters,rungs}','')::int,0);
    for x in select value from jsonb_array_elements(coalesce(v_result->'exercises','[]'::jsonb))
    loop
      v_base:=coalesce(nullif(x#>>'{prescription,mechanic_overlay,start_reps}','')::int,1);
      v_inc:=coalesce(nullif(x#>>'{prescription,mechanic_overlay,increment_reps}','')::int,1);
      if v_variant='DESCENDING_COUPLET' then
        v_first:=v_base+greatest(0,v_rungs-1)*v_inc;v_last:=v_base;
      else
        v_first:=v_base;v_last:=v_base+greatest(0,v_rungs-1)*v_inc;
      end if;
      v_schedule:=v_schedule||jsonb_build_array(jsonb_build_object(
        'exercise_id',x->>'exercise_id','base_reps',v_base,'increment_reps',v_inc,
        'first_stage_reps',v_first,'last_stage_reps',v_last
      ));
    end loop;
    v_result:=jsonb_set(v_result,'{c4_final,mechanic_json,parameters,sequence_direction}',
      to_jsonb(case when v_variant='DESCENDING_COUPLET' then 'descending' else 'ascending' end),true);
    v_result:=jsonb_set(v_result,'{c4_final,mechanic_json,parameters,per_exercise_schedule}',v_schedule,true);
    v_result:=jsonb_set(v_result,'{c4_final,mechanic_json,parameters,execution_rule}',
      to_jsonb(case when v_variant='DESCENDING_COUPLET' then 'start_at_highest_compiled_stage_then_subtract_each_exercise_increment_until_base' else 'start_at_each_exercise_base_then_add_its_increment_each_stage' end),true);
  end if;
  return v_result;
end;
$$;;



-- SOURCE MIGRATION: 20260811165926_phase_c44_restrict_backend_rpc_execution.sql
-- Only validated authenticated entrypoints are public API.
revoke all on function public.c4_generate_full_session(uuid,text,integer,text,text,text,text[],jsonb,text[],integer,text,integer,text) from public,anon;
grant execute on function public.c4_generate_full_session(uuid,text,integer,text,text,text,text[],jsonb,text[],integer,text,integer,text) to authenticated;

revoke all on function public.c4_swap_session_exercise(uuid,uuid,text[]) from public,anon;
grant execute on function public.c4_swap_session_exercise(uuid,uuid,text[]) to authenticated;

revoke all on function public.c4_recompile_session_format(uuid,uuid,text,text,jsonb) from public,anon;
grant execute on function public.c4_recompile_session_format(uuid,uuid,text,text,jsonb) to authenticated;

-- Internal mutating helper: never callable directly by app roles.
revoke all on function public.c4_apply_wod_candidate(uuid,uuid,jsonb,jsonb,text) from public,anon,authenticated;

-- Internal planning/session reconstruction helpers are only reached through validated SECURITY DEFINER entrypoints.
revoke all on function public.c4_plan_full_session(uuid,text,integer,text,text,text,text[],jsonb,integer,text,integer,text) from public,anon,authenticated;
revoke all on function public.c4_session_wod_candidate(uuid) from public,anon,authenticated;
;



-- SOURCE MIGRATION: 20260811192043_phase_fc2_profile_equipment_inventory.sql
-- F-C2: durable profile equipment inventory with optional unknown loads and atomic replacement

alter table public.user_equipment_inventory
  drop constraint if exists user_equipment_inventory_inventory_mode_check;

alter table public.user_equipment_inventory
  add constraint user_equipment_inventory_inventory_mode_check
  check (inventory_mode = any (array['non_load'::text,'load_unknown'::text,'fixed_load'::text,'adjustable_load'::text]));

alter table public.user_equipment_inventory
  drop constraint if exists user_equipment_inventory_check;

alter table public.user_equipment_inventory
  add constraint user_equipment_inventory_check
  check (
    ((inventory_mode in ('non_load','load_unknown')) and load_kg is null and min_load_kg is null and max_load_kg is null and increment_kg is null)
    or
    ((inventory_mode='fixed_load') and load_kg is not null and load_kg>0 and min_load_kg is null and max_load_kg is null and increment_kg is null)
    or
    ((inventory_mode='adjustable_load') and min_load_kg is not null and max_load_kg is not null and min_load_kg>0 and max_load_kg>=min_load_kg and increment_kg is not null and increment_kg>0 and load_kg is null)
  );

create or replace function public.resolve_user_equipment_inventory(
  p_user_id uuid,
  p_selected_names text[],
  p_policy_key text default 'c4-final-default'
)
returns jsonb
language plpgsql
stable
set search_path = public
as $function$
declare
  v_cfg jsonb;
  v_result jsonb;
begin
  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'Cannot resolve another user equipment inventory';
  end if;

  select config into v_cfg
  from public.session_engine_policy
  where policy_key = p_policy_key;

  if v_cfg is null then
    raise exception 'Unknown Session Engine policy %', p_policy_key;
  end if;

  with requested as (
    select distinct e.id as equipment_id, e.name
    from unnest(coalesce(p_selected_names, '{}'::text[])) as selected(name)
    join public.equipment e
      on lower(trim(e.name)) = lower(trim(selected.name))
      or lower(trim(e.id)) = lower(trim(selected.name))
  ),
  user_rows as (
    select u.id,u.equipment_id,u.inventory_mode,u.quantity,u.load_kg,u.min_load_kg,u.max_load_kg,u.increment_kg,u.resistance_label,u.notes
    from public.user_equipment_inventory u
    join requested r on r.equipment_id=u.equipment_id
    where u.user_id=p_user_id and u.active=true
  ),
  equipment_with_real_inventory as (
    select distinct equipment_id from user_rows
  ),
  fallback_rows as (
    select r.equipment_id,
      coalesce(
        (v_cfg #>> array['legacy_inventory_defaults',r.equipment_id])::integer,
        (v_cfg #>> '{legacy_inventory_defaults,default}')::integer,
        1
      ) as quantity
    from requested r
    where not exists (
      select 1 from equipment_with_real_inventory x where x.equipment_id=r.equipment_id
    )
  ),
  combined as (
    select
      u.equipment_id,u.inventory_mode,u.quantity,u.load_kg,u.min_load_kg,u.max_load_kg,u.increment_kg,u.resistance_label,
      'user_inventory'::text as source,
      case
        when u.inventory_mode in ('fixed_load','adjustable_load') then 'confirmed'
        when u.inventory_mode='load_unknown' then 'unknown'
        else 'not_applicable'
      end::text as load_confidence
    from user_rows u

    union all

    select
      f.equipment_id,'load_unknown'::text,f.quantity,
      null::numeric,null::numeric,null::numeric,null::numeric,null::text,
      'legacy_equipment_selection'::text,'unknown'::text
    from fallback_rows f
  )
  select coalesce(
    jsonb_agg(
      jsonb_strip_nulls(
        jsonb_build_object(
          'equipment_id',equipment_id,
          'inventory_mode',inventory_mode,
          'quantity',quantity,
          'load_kg',load_kg,
          'min_load_kg',min_load_kg,
          'max_load_kg',max_load_kg,
          'increment_kg',increment_kg,
          'resistance_label',resistance_label,
          'source',source,
          'load_confidence',load_confidence
        )
      )
      order by equipment_id, load_kg nulls first, min_load_kg nulls first
    ),
    '[]'::jsonb
  ) into v_result
  from combined;

  return v_result;
end;
$function$;

create or replace function public.exercise_equipment_compatible(
  p_exercise_id character varying,
  p_inventory jsonb
)
returns boolean
language sql
stable
set search_path = public
as $function$
  with inventory_rows as (
    select
      item->>'equipment_id' as equipment_id,
      coalesce(nullif(item->>'inventory_mode',''),'non_load') as inventory_mode,
      greatest(coalesce(nullif(item->>'quantity','')::integer,0),0) as quantity,
      case
        when coalesce(nullif(item->>'inventory_mode',''),'non_load')='fixed_load'
          then 'fixed:'||coalesce(item->>'load_kg','unknown')
        when coalesce(nullif(item->>'inventory_mode',''),'non_load')='adjustable_load'
          then 'adjustable:'||coalesce(item->>'min_load_kg','unknown')||':'||coalesce(item->>'max_load_kg','unknown')||':'||coalesce(item->>'increment_kg','unknown')
        when coalesce(nullif(item->>'inventory_mode',''),'non_load')='load_unknown'
          then 'load_unknown'
        else 'non_load'
      end as load_signature
    from jsonb_array_elements(
      case when jsonb_typeof(coalesce(p_inventory,'[]'::jsonb))='array'
        then coalesce(p_inventory,'[]'::jsonb)
        else '[]'::jsonb
      end
    ) item
  ),
  inventory_totals as (
    select equipment_id,sum(quantity)::integer as quantity
    from inventory_rows
    where equipment_id is not null
    group by equipment_id
  ),
  inventory_load_groups as (
    select equipment_id,load_signature,sum(quantity)::integer as quantity
    from inventory_rows
    where equipment_id is not null
    group by equipment_id,load_signature
  ),
  requirements as (
    select
      requirement.option_group,
      requirement.equipment_id,
      requirement.min_quantity,
      greatest(requirement.min_quantity,coalesce(max(load_semantics.expected_implement_count),1)) as required_implement_count,
      coalesce(bool_or(load_semantics.symmetric_load),false) as symmetric_load
    from public.exercise_equipment_requirements_v2 requirement
    left join public.exercise_load_semantics load_semantics
      on load_semantics.exercise_id=requirement.exercise_id
     and load_semantics.equipment_id=requirement.equipment_id
    where requirement.exercise_id=p_exercise_id
      and requirement.is_optional=false
    group by requirement.option_group,requirement.equipment_id,requirement.min_quantity
  ),
  requirement_evaluation as (
    select
      requirement.option_group,
      requirement.equipment_id,
      case
        when requirement.symmetric_load=true and requirement.required_implement_count>1
          then exists (
            select 1 from inventory_load_groups inventory_group
            where inventory_group.equipment_id=requirement.equipment_id
              and inventory_group.quantity>=requirement.required_implement_count
          )
        else coalesce((
          select inventory.quantity from inventory_totals inventory
          where inventory.equipment_id=requirement.equipment_id
        ),0)>=requirement.min_quantity
      end as equipment_ok
    from requirements requirement
  ),
  required_groups as (
    select option_group,bool_and(equipment_ok) as group_ok
    from requirement_evaluation
    group by option_group
  )
  select case
    when not exists (
      select 1 from public.exercise_equipment_requirements_v2 requirement
      where requirement.exercise_id=p_exercise_id and requirement.is_optional=false
    ) then true
    else coalesce((select bool_or(group_ok) from required_groups),false)
  end;
$function$;

create or replace function public.replace_user_equipment_inventory(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_user_id uuid := auth.uid();
  v_result jsonb;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if jsonb_typeof(coalesce(p_rows,'[]'::jsonb)) <> 'array' then
    raise exception 'p_rows must be a JSON array';
  end if;

  delete from public.user_equipment_inventory
  where user_id=v_user_id;

  insert into public.user_equipment_inventory (
    user_id,equipment_id,inventory_mode,quantity,load_kg,min_load_kg,max_load_kg,increment_kg,resistance_label,active,notes
  )
  select
    v_user_id,
    nullif(trim(row->>'equipment_id'),'')::varchar,
    coalesce(nullif(trim(row->>'inventory_mode'),''),'non_load'),
    greatest(coalesce(nullif(row->>'quantity','')::integer,1),1)::smallint,
    nullif(row->>'load_kg','')::numeric,
    nullif(row->>'min_load_kg','')::numeric,
    nullif(row->>'max_load_kg','')::numeric,
    nullif(row->>'increment_kg','')::numeric,
    nullif(trim(row->>'resistance_label'),''),
    true,
    nullif(trim(row->>'notes'),'')
  from jsonb_array_elements(coalesce(p_rows,'[]'::jsonb)) row
  where nullif(trim(row->>'equipment_id'),'') is not null;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id',id,
        'equipment_id',equipment_id,
        'inventory_mode',inventory_mode,
        'quantity',quantity,
        'load_kg',load_kg,
        'min_load_kg',min_load_kg,
        'max_load_kg',max_load_kg,
        'increment_kg',increment_kg,
        'resistance_label',resistance_label,
        'active',active,
        'notes',notes
      ) order by equipment_id,load_kg nulls first,min_load_kg nulls first
    ),
    '[]'::jsonb
  ) into v_result
  from public.user_equipment_inventory
  where user_id=v_user_id and active=true;

  return v_result;
end;
$function$;

revoke all on function public.replace_user_equipment_inventory(jsonb) from public;
revoke all on function public.replace_user_equipment_inventory(jsonb) from anon;
grant execute on function public.replace_user_equipment_inventory(jsonb) to authenticated;;



-- SOURCE MIGRATION: 20260811200032_fc4_format_entitlements_and_hiit_foundation.sql
-- F-C4 — format entitlements + HIIT foundation

alter table public.profiles
  add column if not exists subscription_tier text not null default 'FREE';

alter table public.profiles
  drop constraint if exists profiles_subscription_tier_check;

alter table public.profiles
  add constraint profiles_subscription_tier_check
  check (subscription_tier in ('FREE','PREMIUM'));

alter table public.workout_mechanics
  add column if not exists manual_free_eligible boolean not null default false,
  add column if not exists short_description text;

alter table public.workout_mechanic_variants
  add column if not exists manual_free_eligible boolean not null default false,
  add column if not exists manual_premium_eligible boolean not null default true,
  add column if not exists short_description text;

-- Manual Free selection: exactly the product-approved base formats.
update public.workout_mechanics
set manual_free_eligible = mechanic_key in (
  'AMRAP','EMOM','CIRCUIT','LADDER','FOR_TIME','HIIT'
);

update public.workout_mechanics set short_description = case mechanic_key
  when 'AMRAP' then 'Accumule le plus de tours ou de répétitions possible dans un temps donné.'
  when 'EMOM' then 'Un travail démarre au début de chaque minute, le temps restant sert à récupérer.'
  when 'CIRCUIT' then 'Enchaîne plusieurs exercices sur plusieurs tours avec une récupération maîtrisée.'
  when 'FOR_TIME' then 'Termine le volume prévu le plus rapidement possible, avec un cap de sécurité.'
  when 'LADDER' then 'Les répétitions évoluent progressivement à chaque étape.'
  when 'PYRAMID' then 'Le volume monte puis redescend selon une séquence structurée.'
  when 'PROGRESSIVE_INTERVAL' then 'La difficulté augmente intervalle après intervalle jusqu’à la limite prévue.'
  when 'STRENGTH' then 'Travail en séries avec récupération plus longue et priorité à la qualité de force.'
  when 'CHIPPER' then 'Un seul passage à travers une liste d’exercices et de volumes à terminer.'
  when 'EVERY_X_MINUTES' then 'Réalise le travail demandé à intervalles réguliers avec récupération résiduelle.'
  when 'ODD_EVEN' then 'Deux exercices alternent entre les minutes impaires et paires.'
  when 'REP_TARGET' then 'Atteins un objectif total de répétitions réparti entre les exercices.'
  when 'COUPLET' then 'Deux exercices évoluent ensemble selon une structure progressive.'
  when 'DECK' then 'Quatre exercices sont pilotés par un paquet de cartes mélangé de façon contrôlée.'
  when 'HIIT' then 'Alterne effort et récupération sur plusieurs exercices et plusieurs tours.'
  else short_description
end;

update public.workout_mechanic_variants
set manual_free_eligible = false,
    manual_premium_eligible = true,
    short_description = case variant_key
      when 'ASCENDING_COUPLET' then 'Deux exercices dont les répétitions augmentent à chaque étape.'
      when 'DESCENDING_COUPLET' then 'Deux exercices dont les répétitions diminuent à chaque étape.'
      when 'DEATH_BY' then 'Un exercice progresse à chaque intervalle jusqu’à ne plus pouvoir finir dans le temps.'
      when 'DEATH_BY_COUPLET' then 'Deux exercices progressent indépendamment à chaque intervalle jusqu’à l’échec.'
      when 'PROGRESSIVE_GENERIC' then 'Une progression structurée de la dose de travail à chaque intervalle.'
      else short_description
    end;

insert into public.workout_mechanics (
  mechanic_key,
  display_name,
  format_family,
  auto_free_eligible,
  manual_premium_eligible,
  active,
  notes,
  mechanic_kind,
  manual_free_eligible,
  short_description
)
values (
  'HIIT',
  'HIIT',
  'HIIT',
  true,
  true,
  true,
  'Dynamic work/rest intervals. Exercise count, rounds and interval durations are solved by UGEROD.',
  'core',
  true,
  'Alterne effort et récupération sur plusieurs exercices et plusieurs tours.'
)
on conflict (mechanic_key) do update
set display_name = excluded.display_name,
    format_family = excluded.format_family,
    auto_free_eligible = excluded.auto_free_eligible,
    manual_premium_eligible = excluded.manual_premium_eligible,
    active = excluded.active,
    notes = excluded.notes,
    mechanic_kind = excluded.mechanic_kind,
    manual_free_eligible = excluded.manual_free_eligible,
    short_description = excluded.short_description;

-- HIIT: dynamic 3–5 exercise structure; 4 is the preferred shape, not a fixed rule.
insert into public.block_rules (
  block_key,
  format,
  min_exercises,
  max_exercises,
  preferred_exercises,
  active
)
select 'wod','HIIT',3,5,4,true
where not exists (
  select 1 from public.block_rules
  where block_key='wod' and upper(coalesce(format,''))='HIIT'
);

update public.block_rules
set min_exercises=3,
    max_exercises=5,
    preferred_exercises=4,
    active=true
where block_key='wod' and upper(coalesce(format,''))='HIIT';

-- Policy-driven HIIT parameters. These are solver options, never fixed UI promises.
update public.session_engine_policy
set config = jsonb_set(
  jsonb_set(
    jsonb_set(
      jsonb_set(
        jsonb_set(
          config,
          '{mechanic_defaults,hiit_work_options_seconds}',
          '[30,40,45,50]'::jsonb,
          true
        ),
        '{mechanic_defaults,hiit_rest_options_seconds}',
        '[15,20,30]'::jsonb,
        true
      ),
      '{mechanic_defaults,hiit_min_rounds}',
      '3'::jsonb,
      true
    ),
    '{mechanic_defaults,hiit_max_rounds}',
    '6'::jsonb,
    true
  ),
  '{mechanic_defaults,hiit_target_utilization_percent}',
  '92'::jsonb,
  true
)
where policy_key='c4-final-default';

update public.session_engine_policy
set config = jsonb_set(
  config,
  '{mechanic_duration_target_percent,HIIT}',
  '92'::jsonb,
  true
)
where policy_key='c3-sim-default';;



-- SOURCE MIGRATION: 20260811200132_fc4_hiit_compiler.sql
create or replace function public.c4_finalize_hiit_candidate(
  p_candidate jsonb,
  p_stimulus jsonb,
  p_total_duration_minutes integer,
  p_exact_wod_minutes integer default null,
  p_c4_policy_key text default 'c4-final-default',
  p_c3_policy_key text default 'c3-sim-default'
)
returns jsonb
language plpgsql
stable
set search_path = public
as $function$
declare
  v_cfg jsonb;
  v_exercises jsonb := coalesce(p_candidate->'exercises','[]'::jsonb);
  v_final_exercises jsonb := '[]'::jsonb;
  v_ex jsonb;
  v_pres jsonb;
  v_modes jsonb;
  v_n int := jsonb_array_length(v_exercises);
  v_wod_min int;
  v_wod_sec numeric;
  v_target_util numeric;
  v_target_sec numeric;
  v_work int;
  v_rest int;
  v_rounds int;
  v_candidate_elapsed numeric;
  v_best_score numeric := null;
  v_score numeric;
  v_best_work int := null;
  v_best_rest int := null;
  v_best_rounds int := null;
  v_elapsed numeric := 0;
  v_active numeric := 0;
  v_rest_total numeric := 0;
  v_density numeric := 0;
  v_duration_util numeric := 0;
  v_duration_fit numeric := 0;
  v_density_fit numeric := 0;
  v_whole_fit numeric := 0;
  v_target_density numeric := coalesce((p_stimulus#>>'{density,score}')::numeric,55);
  v_readiness text := lower(coalesce(p_stimulus#>>'{readiness,band}',p_stimulus#>>'{readiness,raw}','normal'));
  v_min_rest_ratio numeric := 0.30;
  v_work_options jsonb;
  v_rest_options jsonb;
  v_min_rounds int;
  v_max_rounds int;
  v_position int := 0;
begin
  select config into v_cfg
  from public.session_engine_policy
  where policy_key=p_c4_policy_key;

  if v_cfg is null then
    raise exception 'Unknown C4 policy %', p_c4_policy_key;
  end if;

  if coalesce((p_candidate#>>'{c4_preparation,mechanic_compatible}')::boolean,true)=false then
    return p_candidate || jsonb_build_object(
      'c4_final',jsonb_build_object(
        'version','c4-hiit-v1',
        'status','INCOMPATIBLE_MECHANIC',
        'feasible',false,
        'reasons',coalesce(p_candidate#>'{c4_preparation,reasons}','[]'::jsonb)
      )
    );
  end if;

  if v_n < 3 or v_n > 5 then
    return p_candidate || jsonb_build_object(
      'c4_final',jsonb_build_object(
        'version','c4-hiit-v1',
        'status','INFEASIBLE',
        'feasible',false,
        'reasons',jsonb_build_array('HIIT_REQUIRES_3_TO_5_EXERCISES')
      )
    );
  end if;

  v_wod_min := public.c3_wod_budget_minutes(
    p_total_duration_minutes,
    p_exact_wod_minutes,
    p_c3_policy_key
  );
  v_wod_sec := v_wod_min*60;
  v_target_util := coalesce(
    (v_cfg#>>'{mechanic_defaults,hiit_target_utilization_percent}')::numeric,
    92
  );
  v_target_sec := v_wod_sec*v_target_util/100.0;

  v_work_options := coalesce(
    v_cfg#>'{mechanic_defaults,hiit_work_options_seconds}',
    '[30,40,45,50]'::jsonb
  );
  v_rest_options := coalesce(
    v_cfg#>'{mechanic_defaults,hiit_rest_options_seconds}',
    '[15,20,30]'::jsonb
  );
  v_min_rounds := coalesce((v_cfg#>>'{mechanic_defaults,hiit_min_rounds}')::int,3);
  v_max_rounds := coalesce((v_cfg#>>'{mechanic_defaults,hiit_max_rounds}')::int,6);

  if v_readiness='low' then
    v_min_rest_ratio := 0.50;
  elsif v_readiness='high' then
    v_min_rest_ratio := 0.25;
  else
    v_min_rest_ratio := 0.30;
  end if;

  for v_work in
    select value::int from jsonb_array_elements_text(v_work_options)
  loop
    for v_rest in
      select value::int from jsonb_array_elements_text(v_rest_options)
    loop
      if v_rest < ceil(v_work*v_min_rest_ratio) then
        continue;
      end if;

      for v_rounds in v_min_rounds..v_max_rounds loop
        -- One work/rest station per exercise. Parameters stay solver-controlled.
        v_candidate_elapsed := v_n*(v_work+v_rest)*v_rounds;

        if v_candidate_elapsed > v_wod_sec*1.05 then
          continue;
        end if;

        -- Primary goal: fit the WOD budget. Secondary tie-break: familiar 40/20 x4 baseline.
        v_score := abs(v_candidate_elapsed-v_target_sec)
          + abs(v_work-40)*0.20
          + abs(v_rest-20)*0.10
          + abs(v_rounds-4)*2;

        if v_best_score is null or v_score < v_best_score then
          v_best_score := v_score;
          v_best_work := v_work;
          v_best_rest := v_rest;
          v_best_rounds := v_rounds;
        end if;
      end loop;
    end loop;
  end loop;

  if v_best_work is null then
    return p_candidate || jsonb_build_object(
      'c4_final',jsonb_build_object(
        'version','c4-hiit-v1',
        'status','INFEASIBLE',
        'feasible',false,
        'reasons',jsonb_build_array('HIIT_NO_SAFE_WORK_REST_CONFIGURATION')
      )
    );
  end if;

  v_elapsed := v_n*(v_best_work+v_best_rest)*v_best_rounds;
  v_active := v_n*v_best_work*v_best_rounds;
  v_rest_total := v_n*v_best_rest*v_best_rounds;
  v_density := case when v_elapsed>0 then v_active/v_elapsed*100 else 0 end;
  v_duration_util := case when v_wod_sec>0 then v_elapsed/v_wod_sec*100 else 0 end;
  v_duration_fit := greatest(0,100-abs(v_duration_util-v_target_util)*1.25);
  v_density_fit := greatest(0,100-abs(v_density-v_target_density));
  v_whole_fit := round(v_density_fit*0.55+v_duration_fit*0.45,2);

  for v_ex in
    select value from jsonb_array_elements(v_exercises)
  loop
    v_position := v_position+1;
    v_pres := coalesce(v_ex->'prescription','{}'::jsonb);
    v_modes := coalesce(v_pres->'tracking_modes','[]'::jsonb);

    if not exists(
      select 1 from jsonb_array_elements_text(
        case when jsonb_typeof(v_modes)='array' then v_modes else '[]'::jsonb end
      ) m where m='time'
    ) then
      v_modes := v_modes || jsonb_build_array('time');
    end if;

    v_pres := v_pres || jsonb_build_object(
      'mechanic','HIIT',
      'block_mechanic','HIIT',
      'duration_seconds_min',v_best_work,
      'duration_seconds_max',v_best_work,
      'tracking_modes',v_modes,
      'mechanic_overlay',jsonb_build_object(
        'type','hiit_station',
        'exercise_position',v_position,
        'work_seconds',v_best_work,
        'rest_seconds',v_best_rest,
        'rounds',v_best_rounds
      ),
      'block_parameters',jsonb_build_object(
        'exercise_count',v_n,
        'rounds',v_best_rounds,
        'work_seconds',v_best_work,
        'rest_seconds',v_best_rest,
        'station_order','sequential',
        'solver_controlled',true
      ),
      'c4_solver_version','c4-hiit-v1'
    );

    v_final_exercises := v_final_exercises ||
      jsonb_build_array(jsonb_set(v_ex,'{prescription}',v_pres,true));
  end loop;

  return jsonb_set(p_candidate,'{exercises}',v_final_exercises,true) ||
    jsonb_build_object(
      'c4_final',jsonb_build_object(
        'version','c4-hiit-v1',
        'status','OK',
        'feasible',true,
        'reasons','[]'::jsonb,
        'mechanic_json',jsonb_build_object(
          'mechanic_key','HIIT',
          'parameters',jsonb_build_object(
            'exercise_count',v_n,
            'rounds',v_best_rounds,
            'work_seconds',v_best_work,
            'rest_seconds',v_best_rest,
            'station_order','sequential',
            'solver_controlled',true
          ),
          'wod_budget_minutes',v_wod_min,
          'predicted_elapsed_seconds',round(v_elapsed,2),
          'time_utilization_percent',round(v_duration_util,2),
          'duration_status','OK'
        ),
        'predicted_volume',jsonb_build_object(
          'active_work_seconds',round(v_active,2),
          'rest_seconds',round(v_rest_total,2)
        ),
        'whole_wod_metrics',jsonb_build_object(
          'density_percent',round(v_density,2),
          'density_fit',round(v_density_fit,2),
          'local_fatigue_concentration_index',50,
          'local_fatigue_fit',50,
          'duration_fit',round(v_duration_fit,2),
          'duration_status','OK',
          'time_utilization_percent',round(v_duration_util,2),
          'whole_wod_fit',v_whole_fit,
          'primary_muscle_exposure_ledger','[]'::jsonb
        )
      )
    );
end;
$function$;

create or replace function public.c4_finalize_candidate(
  p_candidate jsonb,
  p_stimulus jsonb,
  p_total_duration_minutes integer,
  p_exact_wod_minutes integer default null,
  p_c4_policy_key text default 'c4-final-default',
  p_c3_policy_key text default 'c3-sim-default'
)
returns jsonb
language plpgsql
stable
set search_path = public
as $function$
declare
  v_result jsonb;
  v_mechanic text:=upper(coalesce(p_candidate->>'mechanic',''));
  v_variant text:=upper(coalesce(p_candidate->>'variant_key',''));
  v_rungs int;
  v_schedule jsonb:='[]'::jsonb;
  x jsonb;
  v_base int;
  v_inc int;
  v_first int;
  v_last int;
begin
  if v_mechanic='HIIT' then
    return public.c4_finalize_hiit_candidate(
      p_candidate,
      p_stimulus,
      p_total_duration_minutes,
      p_exact_wod_minutes,
      p_c4_policy_key,
      p_c3_policy_key
    );
  end if;

  v_result:=public.c4_finalize_candidate_c41_dispatch_base(
    p_candidate,p_stimulus,p_total_duration_minutes,p_exact_wod_minutes,p_c4_policy_key,p_c3_policy_key
  );

  if v_mechanic='COUPLET' and v_variant in ('ASCENDING_COUPLET','DESCENDING_COUPLET') then
    v_rungs:=coalesce(nullif(v_result#>>'{c4_final,mechanic_json,parameters,rungs}','')::int,0);
    for x in select value from jsonb_array_elements(coalesce(v_result->'exercises','[]'::jsonb))
    loop
      v_base:=coalesce(nullif(x#>>'{prescription,mechanic_overlay,start_reps}','')::int,1);
      v_inc:=coalesce(nullif(x#>>'{prescription,mechanic_overlay,increment_reps}','')::int,1);
      if v_variant='DESCENDING_COUPLET' then
        v_first:=v_base+greatest(0,v_rungs-1)*v_inc;
        v_last:=v_base;
      else
        v_first:=v_base;
        v_last:=v_base+greatest(0,v_rungs-1)*v_inc;
      end if;
      v_schedule:=v_schedule||jsonb_build_array(jsonb_build_object(
        'exercise_id',x->>'exercise_id','base_reps',v_base,'increment_reps',v_inc,
        'first_stage_reps',v_first,'last_stage_reps',v_last
      ));
    end loop;
    v_result:=jsonb_set(v_result,'{c4_final,mechanic_json,parameters,sequence_direction}',
      to_jsonb(case when v_variant='DESCENDING_COUPLET' then 'descending' else 'ascending' end),true);
    v_result:=jsonb_set(v_result,'{c4_final,mechanic_json,parameters,per_exercise_schedule}',v_schedule,true);
    v_result:=jsonb_set(v_result,'{c4_final,mechanic_json,parameters,execution_rule}',
      to_jsonb(case when v_variant='DESCENDING_COUPLET' then 'start_at_highest_compiled_stage_then_subtract_each_exercise_increment_until_base' else 'start_at_each_exercise_base_then_add_its_increment_each_stage' end),true);
  end if;

  return v_result;
end;
$function$;;

