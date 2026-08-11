create table if not exists public.performance_observation_quality_policy (
  policy_key text not null,
  context_key text not null,
  fresh_quality numeric(4,3) not null,
  repeatable_quality numeric(4,3) not null,
  notes text,
  active boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (policy_key, context_key),
  check (fresh_quality between 0 and 1),
  check (repeatable_quality between 0 and 1)
);

insert into public.performance_observation_quality_policy(
  policy_key,context_key,fresh_quality,repeatable_quality,notes,active
) values
  ('b2.6-adapter-draft-1','benchmark',0.950,0.800,'Calibration produit: benchmark standardisé. Paramètres de simulation, non constantes physiologiques.',false),
  ('b2.6-adapter-draft-1','skill',0.900,0.600,'Calibration produit: série fraîche / skill.',false),
  ('b2.6-adapter-draft-1','strength',0.850,0.800,'Calibration produit: bloc force.',false),
  ('b2.6-adapter-draft-1','wod',0.550,0.900,'Calibration produit: effort contextuel / répétable en WOD.',false),
  ('b2.6-adapter-draft-1','tabata',0.300,0.900,'Calibration produit: Tabata Core 20/10, faible preuve fraîche, forte preuve répétable.',false),
  ('b2.6-adapter-draft-1','warm_up',0.250,0.250,'Calibration produit: échauffement = preuve faible.',false),
  ('b2.6-adapter-draft-1','external',0.600,0.600,'Calibration produit: import externe validé.',false),
  ('b2.6-adapter-draft-1','manual',0.550,0.550,'Calibration produit: saisie manuelle.',false),
  ('b2.6-adapter-draft-1','unknown',0.350,0.350,'Fallback conservateur.',false)
on conflict (policy_key,context_key) do update set
  fresh_quality=excluded.fresh_quality,
  repeatable_quality=excluded.repeatable_quality,
  notes=excluded.notes,
  updated_at=now();

alter table public.performance_observation_quality_policy enable row level security;
drop policy if exists "Authenticated can read observation quality policy" on public.performance_observation_quality_policy;
create policy "Authenticated can read observation quality policy"
  on public.performance_observation_quality_policy
  for select to authenticated
  using (true);

grant select on public.performance_observation_quality_policy to authenticated;

create or replace function public.capability_family_from_tracking(
  p_tracking_modes text[],
  p_prescription_type text default null
) returns text
language plpgsql immutable
as $$
begin
  if coalesce(p_tracking_modes,'{}'::text[]) @> array['reps','load']::text[] then
    return 'load_reps';
  end if;

  if coalesce(p_prescription_type,'') like 'reps%'
     or 'reps'=any(coalesce(p_tracking_modes,'{}'::text[])) then
    return 'reps';
  end if;

  if coalesce(p_tracking_modes,'{}'::text[]) @> array['distance','time','load']::text[] then
    return 'loaded_distance';
  end if;

  if coalesce(p_tracking_modes,'{}'::text[]) @> array['distance','time']::text[] then
    return 'pace';
  end if;

  if 'time'=any(coalesce(p_tracking_modes,'{}'::text[])) then
    return 'time';
  end if;

  return null;
end;
$$;

create or replace function public.performance_context_key(
  p_source_kind text,
  p_block_key text
) returns text
language sql immutable
as $$
  select case
    when p_source_kind='external_import' then 'external'
    when p_source_kind='manual' then 'manual'
    when lower(coalesce(p_block_key,'')) in ('benchmark','test') then 'benchmark'
    when lower(coalesce(p_block_key,'')) in ('skill') then 'skill'
    when lower(coalesce(p_block_key,'')) in ('strength','force') then 'strength'
    when lower(coalesce(p_block_key,'')) in ('tabata','core') then 'tabata'
    when lower(coalesce(p_block_key,'')) in ('warm_up','warmup') then 'warm_up'
    when lower(coalesce(p_block_key,''))='wod' then 'wod'
    else 'unknown'
  end;
$$;

create or replace function public.build_capability_observation_inputs(
  p_exercise_log_id bigint,
  p_quality_policy_key text default 'b2.6-adapter-draft-1'
) returns jsonb
language plpgsql stable
security invoker
as $$
declare
  v_obs record;
  v_tracking text[];
  v_prescription_type text;
  v_movement_side text;
  v_family text;
  v_context_key text;
  v_mechanic text;
  v_side_semantics text;
  v_protocol_signature text;
  v_fresh_quality numeric;
  v_repeatable_quality numeric;
  v_updates jsonb := '[]'::jsonb;
  v_base_comparison jsonb;
  v_observation_context jsonb;
  v_quality_json jsonb;
  v_is_candidate boolean;
begin
  select
    poc.*,
    e.tracking_modes,
    e.prescription_type,
    e.movement_side,
    coalesce(
      nullif(ws.mechanic_json->>'kind',''),
      nullif(ws.mechanic_json->>'mechanic',''),
      nullif(ws.generated_workout->'meta'->>'format',''),
      'unknown'
    ) as mechanic
  into v_obs
  from public.performance_observation_contract poc
  join public.exercises e on e.id::text=poc.exercise_id
  left join public.workout_sessions ws on ws.id=poc.session_id
  where poc.exercise_log_id=p_exercise_log_id;

  if not found then
    raise exception 'Unknown exercise_log_id %', p_exercise_log_id;
  end if;

  v_tracking := coalesce(v_obs.tracking_modes,'{}'::text[]);
  v_prescription_type := v_obs.prescription_type;
  v_movement_side := v_obs.movement_side;
  v_family := public.capability_family_from_tracking(v_tracking,v_prescription_type);
  v_context_key := public.performance_context_key(v_obs.source_kind,v_obs.block_key);
  v_mechanic := coalesce(v_obs.mechanic,'unknown');

  v_side_semantics := case
    when v_prescription_type='reps_unilateral' then 'per_side'
    when v_prescription_type like 'reps%' then 'total'
    when v_prescription_type='distance' and v_movement_side='Unilateral' then 'per_side'
    when v_prescription_type='isometric' and v_movement_side='Unilateral' then 'per_side'
    else null
  end;

  select fresh_quality,repeatable_quality
  into v_fresh_quality,v_repeatable_quality
  from public.performance_observation_quality_policy
  where policy_key=p_quality_policy_key and context_key=v_context_key;

  if not found then
    raise exception 'No quality policy % for context %',p_quality_policy_key,v_context_key;
  end if;

  v_protocol_signature := concat_ws('|',
    'context='||v_context_key,
    'mechanic='||lower(v_mechanic),
    'prescription='||coalesce(v_prescription_type,'unknown'),
    'side='||coalesce(v_side_semantics,'na')
  );

  v_observation_context := jsonb_strip_nulls(jsonb_build_object(
    'adapter_version','b2.6-adapter-draft-1',
    'quality_policy_key',p_quality_policy_key,
    'source_kind',v_obs.source_kind,
    'block_key',v_obs.block_key,
    'position',v_obs.position,
    'context_key',v_context_key,
    'mechanic',v_mechanic,
    'tracking_modes',v_tracking,
    'prescription_type',v_prescription_type,
    'movement_side',v_movement_side,
    'side_semantics',v_side_semantics,
    'session_exercise_id',v_obs.session_exercise_id
  ));

  v_quality_json := jsonb_build_object(
    'policy_key',p_quality_policy_key,
    'context_key',v_context_key,
    'fresh',v_fresh_quality,
    'repeatable',v_repeatable_quality
  );

  v_base_comparison := jsonb_strip_nulls(jsonb_build_object(
    'protocol_signature',v_protocol_signature,
    'context_key',v_context_key,
    'mechanic',v_mechanic,
    'prescription_type',v_prescription_type,
    'side_semantics',v_side_semantics
  ));

  v_is_candidate := (
    v_obs.observation_role='CAPABILITY_CANDIDATE'
    and coalesce(v_obs.capability_eligible,false)
    and not coalesce(v_obs.pain_affected,false)
    and v_family is not null
  );

  if v_is_candidate then
    v_updates := jsonb_build_array(
      jsonb_build_object(
        'family',v_family,
        'capability_mode','fresh',
        'quality',v_fresh_quality,
        'comparison',v_base_comparison || jsonb_build_object('capability_mode','fresh')
      ),
      jsonb_build_object(
        'family',v_family,
        'capability_mode','repeatable',
        'quality',v_repeatable_quality,
        'comparison',v_base_comparison || jsonb_build_object('capability_mode','repeatable')
      )
    );
  end if;

  return jsonb_build_object(
    'adapter_version','b2.6-adapter-draft-1',
    'exercise_log_id',v_obs.exercise_log_id,
    'session_exercise_id',v_obs.session_exercise_id,
    'user_id',v_obs.user_id,
    'exercise_id',v_obs.exercise_id,
    'exercise_name',v_obs.exercise_name,
    'family',v_family,
    'observation_role',v_obs.observation_role,
    'capability_eligible',v_obs.capability_eligible,
    'pain_affected',v_obs.pain_affected,
    'expected',v_obs.expected_json,
    'actual',v_obs.actual_json,
    'observation_context',v_observation_context,
    'observation_quality',v_quality_json,
    'comparison_context',v_base_comparison,
    'updates',v_updates,
    'excluded',not v_is_candidate,
    'exclusion_reason',case
      when v_obs.pain_affected then 'PAIN_STATE_ONLY'
      when not coalesce(v_obs.capability_eligible,false) then 'NOT_CAPABILITY_ELIGIBLE'
      when v_obs.observation_role<>'CAPABILITY_CANDIDATE' then v_obs.observation_role
      when v_family is null then 'UNSUPPORTED_TRACKING_FAMILY'
      else null
    end
  );
end;
$$;

grant execute on function public.build_capability_observation_inputs(bigint,text) to authenticated;
grant execute on function public.capability_family_from_tracking(text[],text) to authenticated;
grant execute on function public.performance_context_key(text,text) to authenticated;

comment on table public.performance_observation_quality_policy is
'B2.6 simulation/tuning quality policy. Numeric values are configurable product calibration parameters, not validated physiological constants.';
comment on function public.build_capability_observation_inputs(bigint,text) is
'Pure adapter for B2.6 shadow integration: maps one exercise log into zero or more capability-update inputs without mutating capability state.';