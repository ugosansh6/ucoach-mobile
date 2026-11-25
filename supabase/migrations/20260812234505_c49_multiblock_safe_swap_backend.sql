create or replace function public.c4_non_wod_swap_candidate(
  p_user_id uuid,
  p_session_exercise_id uuid,
  p_excluded_exercise_ids text[] default '{}'::text[]
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  target record;
  ws record;
  v_block_key text;
  v_names text[];
  v_inventory jsonb;
  v_zones text[];
  v_max_complexity int;
  v_block_minutes int;
  v_candidate record;
  v_pres jsonb;
  v_expected jsonb;
  v_cap jsonb := '{}'::jsonb;
  v_direct_variant boolean := false;
begin
  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'Forbidden user';
  end if;

  select
    wse.*,
    e.movement_pattern as old_pattern,
    e.exercise_family as old_family,
    e.body_region as old_region,
    e.technical_complexity as old_complexity,
    e.warmup_role as old_warmup_role
  into target
  from public.workout_session_exercises wse
  join public.workout_sessions s on s.id = wse.session_id
  join public.exercises e on e.id = wse.exercise_id
  where wse.id = p_session_exercise_id
    and s.user_id = p_user_id;

  if not found then
    raise exception 'Session exercise instance not found';
  end if;

  v_block_key := case target.block_key when 'warm_up' then 'warmup' else target.block_key end;

  if v_block_key not in ('warmup','tabata','skill') then
    return jsonb_build_object(
      'status','NOT_SUPPORTED',
      'reason','NON_WOD_SWAP_REQUIRES_WARMUP_TABATA_OR_SKILL',
      'session_exercise_id',p_session_exercise_id,
      'block_key',v_block_key
    );
  end if;

  select * into ws
  from public.workout_sessions
  where id = target.session_id and user_id = p_user_id;

  if ws.status not in ('generated','in_progress') then
    return jsonb_build_object(
      'status','NOT_AVAILABLE',
      'reason','SESSION_NOT_MUTABLE',
      'session_exercise_id',p_session_exercise_id,
      'block_key',v_block_key
    );
  end if;

  v_names := coalesce(ws.available_equipment,'{}'::text[]);
  if cardinality(v_names)=0 then
    select coalesce(array_agg(e.name order by e.id),'{}'::text[])
    into v_names
    from public.user_equipment_inventory ui
    join public.equipment e on e.id=ui.equipment_id
    where ui.user_id=p_user_id and ui.active;
  end if;
  if cardinality(v_names)=0 then v_names:=array['Aucun']; end if;

  v_inventory := public.resolve_user_equipment_inventory(p_user_id,v_names,'c4-final-default');
  v_zones := public.normalize_body_zone_ids(coalesce(ws.injured_zones,'{}'::text[]));
  v_max_complexity := coalesce(target.old_complexity,case lower(coalesce(ws.readiness,'normal')) when 'low' then 3 else 5 end);

  select coalesce((b->>'duration_minutes')::int,0)
  into v_block_minutes
  from jsonb_array_elements(coalesce(ws.generated_workout->'blocks','[]'::jsonb)) b
  where (case b->>'block_key' when 'warm_up' then 'warmup' else b->>'block_key' end)=v_block_key
  limit 1;
  v_block_minutes := coalesce(v_block_minutes,0);

  select
    e.*,
    exists(
      select 1
      from public.exercise_variants ev
      where (ev.exercise_id=target.exercise_id and ev.target_exercise_id=e.id)
         or (ev.target_exercise_id=target.exercise_id and ev.exercise_id=e.id)
    ) as direct_variant
  into v_candidate
  from public.exercises e
  where e.id <> target.exercise_id
    and not (e.id = any(coalesce(p_excluded_exercise_ids,'{}'::text[])))
    and not exists(
      select 1 from public.workout_session_exercises used
      where used.session_id=target.session_id and used.exercise_id=e.id
    )
    and coalesce(e.technical_complexity,99) <= v_max_complexity
    and public.exercise_safe_for_zones(e.id,v_zones)
    and public.exercise_equipment_compatible(e.id,v_inventory)
    and (
      (
        v_block_key='warmup'
        and 'Warm-up'=any(e.usable_for)
        and coalesce(e.warmup_eligible,false)
        and coalesce(e.warmup_intensity,99)<=2
        and coalesce(e.fatigue_score,99)<=2
        and coalesce(e.joint_impact,99)<=2
        and coalesce(e.warmup_role,'')=coalesce(target.old_warmup_role,target.prescription_json->>'warmup_role','')
      )
      or
      (
        v_block_key='tabata'
        and 'Core'=any(e.usable_for)
        and coalesce(e.tabata_eligible,false)
        and not coalesce(e.warmup_only,false)
        and e.exercise_family='Core'
        and coalesce(e.fatigue_score,99)<=4
        and coalesce(e.joint_impact,99)<=3
        and not exists(
          select 1
          from public.workout_session_exercises other
          join public.exercises oe on oe.id=other.exercise_id
          where other.session_id=target.session_id
            and other.block_key='tabata'
            and other.id<>target.id
            and oe.movement_pattern=e.movement_pattern
        )
      )
      or
      (
        v_block_key='skill'
        and 'Skill'=any(e.usable_for)
        and not coalesce(e.warmup_only,false)
        and coalesce(e.fatigue_score,99)<=3
        and coalesce(e.joint_impact,99)<=3
        and (ws.target_region is null or ws.target_region='Full Body' or e.body_region=ws.target_region)
        and (e.movement_pattern=target.old_pattern or e.exercise_family=target.old_family)
      )
    )
  order by
    case when exists(
      select 1 from public.exercise_variants ev
      where (ev.exercise_id=target.exercise_id and ev.target_exercise_id=e.id)
         or (ev.target_exercise_id=target.exercise_id and ev.exercise_id=e.id)
    ) then 0 else 1 end,
    case when e.movement_pattern=target.old_pattern then 0 else 1 end,
    case when e.exercise_family=target.old_family then 0 else 1 end,
    case when e.body_region=target.old_region then 0 else 1 end,
    coalesce(e.selection_weight,0) desc,
    e.id
  limit 1;

  if not found then
    return jsonb_build_object(
      'status','NO_SAFE_SWAP',
      'mutated',false,
      'session_exercise_id',p_session_exercise_id,
      'block_key',v_block_key,
      'old_exercise_id',target.exercise_id,
      'old_technical_complexity',target.old_complexity,
      'technical_complexity_must_not_increase',true
    );
  end if;

  v_direct_variant := coalesce(v_candidate.direct_variant,false);

  v_pres := public.c2_solver_prescription(
    p_user_id,
    v_candidate.id,
    ws.expected_stimulus_json,
    case v_block_key when 'warmup' then 'WARMUP' when 'tabata' then 'TABATA' else 'SKILL' end,
    ws.progression_intent,
    v_inventory
  );

  if v_block_key='warmup' then
    v_pres := v_pres || jsonb_build_object(
      'block_role','warmup',
      'warmup_role',v_candidate.warmup_role,
      'target_duration_minutes',v_block_minutes
    );
  elsif v_block_key='tabata' then
    v_pres := v_pres || jsonb_build_object(
      'block_role','tabata',
      'protocol',coalesce(target.prescription_json->'protocol',jsonb_build_object(
        'rounds',8,'work_seconds',20,'rest_seconds',10,'rotation','alternate_exercises'
      ))
    );
  else
    v_pres := v_pres || jsonb_build_object(
      'block_role','skill',
      'target_duration_minutes',v_block_minutes,
      'quality_priority','technique_before_fatigue'
    );
  end if;

  v_expected := coalesce(target.expected_outcome_json,'{}'::jsonb);
  if v_block_key='warmup' then
    v_expected := v_expected || jsonb_build_object('block_key','warmup','warmup_role',v_candidate.warmup_role);
  elsif v_block_key='tabata' then
    v_expected := v_expected || jsonb_build_object('block_key','tabata','core_only',true,'protocol','20_on_10_off_x8');
  else
    v_expected := v_expected || jsonb_build_object('block_key','skill','goal','technical_quality_or_progression');
  end if;

  select coalesce(jsonb_build_object(
    'source','user_exercise_coach_state','state',s.state,'recommendation',s.recommendation,
    'reps_envelope',s.reps_envelope,'load_envelope',s.load_envelope,'time_envelope',s.time_envelope,
    'distance_envelope',s.distance_envelope,'pace_envelope',s.pace_envelope,
    'capability_confidence',s.capability_confidence,'capability_freshness',s.capability_freshness,
    'valid_evidence_count',s.valid_evidence_count
  ),'{}'::jsonb)
  into v_cap
  from public.user_exercise_coach_state s
  where s.user_id=p_user_id and s.exercise_id=v_candidate.id;
  v_cap := coalesce(v_cap,'{}'::jsonb);

  return jsonb_build_object(
    'status','AVAILABLE',
    'mutated',false,
    'session_id',target.session_id,
    'session_exercise_id',p_session_exercise_id,
    'block_key',v_block_key,
    'old_exercise_id',target.exercise_id,
    'new_exercise_id',v_candidate.id,
    'old_technical_complexity',target.old_complexity,
    'new_technical_complexity',v_candidate.technical_complexity,
    'technical_complexity_non_increasing',coalesce(v_candidate.technical_complexity,99)<=v_max_complexity,
    'direct_variant',v_direct_variant,
    'capacity_snapshot',v_cap,
    'expected_outcome',v_expected,
    'substitute',jsonb_build_object(
      'id',v_candidate.id,
      'exercise_id',v_candidate.id,
      'session_exercise_id',p_session_exercise_id,
      'name',v_candidate.name,
      'family',v_candidate.exercise_family,
      'pattern',v_candidate.movement_pattern,
      'region',v_candidate.body_region,
      'instructions',v_candidate.instructions,
      'tips',v_candidate.tips,
      'image_path',v_candidate.image_path,
      'tracking_modes',coalesce(to_jsonb(v_candidate.tracking_modes),'[]'::jsonb),
      'prescription',v_pres,
      'prescription_json',v_pres,
      'expected_outcome',v_expected,
      'warmup_role',case when v_block_key='warmup' then v_candidate.warmup_role else null end
    )
  );
end;
$function$;

revoke all on function public.c4_non_wod_swap_candidate(uuid,uuid,text[]) from public, anon, authenticated;

create or replace function public.c4_swap_session_exercise_v2(
  p_user_id uuid,
  p_session_exercise_id uuid,
  p_excluded_exercise_ids text[] default '{}'::text[]
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  target record;
  ws record;
  v_block_key text;
  v_preview jsonb;
  v_sub jsonb;
  v_pres jsonb;
  v_expected jsonb;
  v_cap jsonb;
  v_blocks jsonb;
  v_new_solver jsonb;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;

  select wse.*, s.user_id
  into target
  from public.workout_session_exercises wse
  join public.workout_sessions s on s.id=wse.session_id
  where wse.id=p_session_exercise_id and s.user_id=p_user_id;
  if not found then raise exception 'Session exercise instance not found'; end if;

  v_block_key:=case target.block_key when 'warm_up' then 'warmup' else target.block_key end;

  if v_block_key='wod' then
    return public.c4_swap_session_exercise(p_user_id,p_session_exercise_id,p_excluded_exercise_ids);
  end if;

  if v_block_key not in ('warmup','tabata','skill') then
    return jsonb_build_object('status','NOT_SUPPORTED','reason','SWAP_BLOCK_NOT_SUPPORTED','session_exercise_id',p_session_exercise_id,'block_key',v_block_key,'mutated',false);
  end if;

  select * into ws
  from public.workout_sessions
  where id=target.session_id and user_id=p_user_id
  for update;
  if ws.status not in ('generated','in_progress') then raise exception 'Session cannot swap in status %',ws.status; end if;

  v_preview:=public.c4_non_wod_swap_candidate(p_user_id,p_session_exercise_id,p_excluded_exercise_ids);
  if coalesce(v_preview->>'status','')<>'AVAILABLE' then return v_preview; end if;

  v_sub:=v_preview->'substitute';
  v_pres:=coalesce(v_preview->'substitute'->'prescription_json','{}'::jsonb);
  v_expected:=coalesce(v_preview->'expected_outcome','{}'::jsonb);
  v_cap:=coalesce(v_preview->'capacity_snapshot','{}'::jsonb);

  v_new_solver:=jsonb_build_object(
    'engine','c4-swap-v2',
    'block_key',v_block_key,
    'full_session_authority',true,
    'action','SWAP_INSTANCE:'||p_session_exercise_id::text,
    'swap_origin_exercise_id',target.exercise_id,
    'swap_new_exercise_id',v_preview->>'new_exercise_id',
    'technical_complexity_non_increasing',coalesce((v_preview->>'technical_complexity_non_increasing')::boolean,false),
    'direct_variant',coalesce((v_preview->>'direct_variant')::boolean,false)
  );

  update public.workout_session_exercises
  set exercise_id=v_preview->>'new_exercise_id',
      exercise_name=v_sub->>'name',
      prescription=coalesce(v_pres->>'text','Prescription adaptée'),
      prescription_json=v_pres,
      expected_outcome_json=v_expected,
      expected_rpe_min=nullif(v_pres->>'target_rpe_min','')::numeric,
      expected_rpe_max=nullif(v_pres->>'target_rpe_max','')::numeric,
      capacity_snapshot_json=v_cap,
      solver_decision_json=v_new_solver
  where id=p_session_exercise_id;

  select coalesce(jsonb_agg(
    case
      when (case b->>'block_key' when 'warm_up' then 'warmup' else b->>'block_key' end)=v_block_key then
        jsonb_set(
          b,
          '{exercises}',
          coalesce((
            select jsonb_agg(
              case when ord=target.position then v_sub else ex end
              order by ord
            )
            from jsonb_array_elements(coalesce(b->'exercises','[]'::jsonb)) with ordinality x(ex,ord)
          ),'[]'::jsonb),
          true
        )
      else b
    end
    order by bord
  ),'[]'::jsonb)
  into v_blocks
  from jsonb_array_elements(coalesce(ws.generated_workout->'blocks','[]'::jsonb)) with ordinality z(b,bord);

  update public.workout_sessions
  set generated_workout=jsonb_set(coalesce(generated_workout,'{}'::jsonb),'{blocks}',v_blocks,true),
      updated_at=now()
  where id=target.session_id;

  return jsonb_build_object(
    'status','APPLIED',
    'mutated',true,
    'session_id',target.session_id,
    'session_exercise_id',p_session_exercise_id,
    'block_key',v_block_key,
    'position',target.position,
    'old_exercise_id',target.exercise_id,
    'new_exercise_id',v_preview->>'new_exercise_id',
    'old_technical_complexity',v_preview->'old_technical_complexity',
    'new_technical_complexity',v_preview->'new_technical_complexity',
    'technical_complexity_non_increasing',v_preview->'technical_complexity_non_increasing',
    'full_wod_resimulated',false,
    'quality_gate',jsonb_build_object(
      'pain_gate',true,
      'equipment_gate',true,
      'block_contract_preserved',true,
      'technical_complexity_non_increasing',v_preview->'technical_complexity_non_increasing',
      'version','c4-multiblock-swap-v1'
    ),
    'result',jsonb_build_object('exercises',jsonb_build_array(v_sub)),
    'substitute',v_sub
  );
end;
$function$;

revoke all on function public.c4_swap_session_exercise_v2(uuid,uuid,text[]) from public, anon;
grant execute on function public.c4_swap_session_exercise_v2(uuid,uuid,text[]) to authenticated, service_role;
