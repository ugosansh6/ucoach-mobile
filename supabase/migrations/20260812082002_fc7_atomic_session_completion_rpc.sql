create or replace function public.complete_workout_session_v1(
  p_session_id uuid,
  p_global_rpe integer,
  p_post_workout_feeling integer,
  p_notes text default null,
  p_exercises jsonb default '[]'::jsonb,
  p_protocol_outcome jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user_id uuid:=auth.uid();
  v_session public.workout_sessions%rowtype;
  v_item jsonb;
  v_wse public.workout_session_exercises%rowtype;
  v_instance_id uuid;
  v_exec text;
  v_reason text;
  v_reps int;
  v_weight numeric;
  v_duration int;
  v_distance numeric;
  v_rpe int;
  v_item_notes text;
  v_status text;
  v_quality numeric;
  v_capability_eligible boolean;
  v_pain boolean;
  v_payload_ids uuid[]:='{}'::uuid[];
  v_total_instances int:=0;
  v_logs_count int:=0;
  v_pending_count int:=0;
  v_missing_logs int:=0;
  v_duplicate_payload_ids int:=0;
  v_adapted int:=0;
  v_not_completed int:=0;
  v_completed int:=0;
  v_completed_at timestamptz:=now();
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if jsonb_typeof(coalesce(p_exercises,'[]'::jsonb))<>'array' then raise exception 'exercises must be a JSON array'; end if;
  if p_global_rpe is not null and (p_global_rpe<1 or p_global_rpe>10) then raise exception 'global_rpe must be between 1 and 10'; end if;
  if p_post_workout_feeling is not null and (p_post_workout_feeling<1 or p_post_workout_feeling>10) then raise exception 'post_workout_feeling must be between 1 and 10'; end if;

  select * into v_session
  from public.workout_sessions
  where id=p_session_id and user_id=v_user_id
  for update;

  if not found then raise exception 'Session not found'; end if;

  select count(*) into v_total_instances
  from public.workout_session_exercises
  where session_id=p_session_id;

  if v_session.status='completed' then
    select count(*) into v_logs_count
    from public.exercise_logs
    where session_id=p_session_id and source_kind='internal';

    select count(*) into v_pending_count
    from public.workout_session_exercises
    where session_id=p_session_id
      and coalesce(user_execution_status,'pending')='pending';

    return jsonb_build_object(
      'status',case when v_logs_count=v_total_instances and v_pending_count=0 then 'ALREADY_COMPLETED' else 'ALREADY_COMPLETED_INCONSISTENT' end,
      'session_id',p_session_id,
      'session_status',v_session.status,
      'instances',v_total_instances,
      'logs',v_logs_count,
      'pending_instances',v_pending_count,
      'idempotent',true,
      'mutated',false
    );
  end if;

  if v_session.status not in ('generated','in_progress') then
    raise exception 'Session cannot be completed in status %',v_session.status;
  end if;

  if v_total_instances=0 then raise exception 'Session has no exercise instances'; end if;
  if jsonb_array_length(coalesce(p_exercises,'[]'::jsonb))<>v_total_instances then
    raise exception 'Completion payload must contain exactly one row for every session exercise instance: expected %, received %',
      v_total_instances,jsonb_array_length(coalesce(p_exercises,'[]'::jsonb));
  end if;

  -- Validate the complete payload before the first mutation.
  for v_item in select value from jsonb_array_elements(coalesce(p_exercises,'[]'::jsonb))
  loop
    begin
      v_instance_id:=(v_item->>'session_exercise_id')::uuid;
    exception when others then
      raise exception 'Invalid session_exercise_id in completion payload';
    end;

    if v_instance_id=any(v_payload_ids) then
      v_duplicate_payload_ids:=v_duplicate_payload_ids+1;
    end if;
    v_payload_ids:=array_append(v_payload_ids,v_instance_id);

    select * into v_wse
    from public.workout_session_exercises
    where id=v_instance_id and session_id=p_session_id;
    if not found then raise exception 'Exercise instance % does not belong to session %',v_instance_id,p_session_id; end if;

    v_exec:=lower(trim(coalesce(v_item->>'user_execution_status','')));
    v_reason:=upper(nullif(trim(coalesce(v_item->>'execution_reason_code','')),''));

    if v_exec not in ('completed','adapted','not_completed') then
      raise exception 'Invalid user_execution_status % for instance %',v_exec,v_instance_id;
    end if;

    if v_exec='adapted' and v_reason is not null and v_reason not in (
      'TECHNIQUE_DIFFICULTY','LOAD_TOO_HEAVY','FATIGUE','PAIN_DISCOMFORT','EQUIPMENT','TIME','OTHER'
    ) then
      raise exception 'Invalid adapted reason %',v_reason;
    end if;

    if v_exec='not_completed' and v_reason is not null and v_reason not in (
      'MOVEMENT_FAILURE','FATIGUE','PAIN_DISCOMFORT','TIME','MOTIVATION','EQUIPMENT','OTHER'
    ) then
      raise exception 'Invalid not_completed reason %',v_reason;
    end if;
  end loop;

  if v_duplicate_payload_ids>0 then raise exception 'Completion payload contains duplicate session exercise instances'; end if;

  -- All validation passed: mutations below are one PostgreSQL transaction.
  for v_item in select value from jsonb_array_elements(coalesce(p_exercises,'[]'::jsonb))
  loop
    v_instance_id:=(v_item->>'session_exercise_id')::uuid;
    select * into v_wse
    from public.workout_session_exercises
    where id=v_instance_id and session_id=p_session_id
    for update;

    v_exec:=lower(trim(v_item->>'user_execution_status'));
    v_reason:=upper(nullif(trim(coalesce(v_item->>'execution_reason_code','')),''));
    v_reps:=nullif(v_item->>'reps_completed','')::int;
    v_weight:=nullif(v_item->>'weight_kg','')::numeric;
    v_duration:=nullif(v_item->>'duration_seconds','')::int;
    v_distance:=nullif(v_item->>'distance_meters','')::numeric;
    v_rpe:=nullif(v_item->>'rpe','')::int;
    v_item_notes:=nullif(v_item->>'notes','');

    if v_rpe is not null and (v_rpe<1 or v_rpe>10) then raise exception 'Exercise RPE must be between 1 and 10'; end if;
    if coalesce(v_reps,0)<0 or coalesce(v_weight,0)<0 or coalesce(v_duration,0)<0 or coalesce(v_distance,0)<0 then
      raise exception 'Exercise metrics cannot be negative';
    end if;

    v_status:=case when v_exec='not_completed' then 'skipped' else 'completed' end;
    v_quality:=case v_exec when 'completed' then 1.0 when 'adapted' then 0.5 else 0.0 end;
    v_capability_eligible:=(v_exec='completed');
    v_pain:=(v_reason='PAIN_DISCOMFORT');

    update public.workout_session_exercises
    set status=v_status,
        user_execution_status=v_exec,
        execution_reason_code=case when v_exec='completed' then null else v_reason end,
        reps_completed=v_reps,
        weight_kg=v_weight,
        duration_seconds=v_duration,
        distance_meters=v_distance,
        rpe=v_rpe,
        notes=v_item_notes,
        updated_at=now()
    where id=v_instance_id and session_id=p_session_id;

    insert into public.exercise_logs(
      user_id,exercise_id,reps_completed,weight_kg,rpe,notes,created_at,session_id,duration_seconds,distance_meters,
      status,prescription_json,source_kind,observation_quality,capability_eligible,skip_reason,pain_affected,pain_zones,
      actual_json,observation_context_json,observation_quality_json,comparison_context_json,session_exercise_id,
      user_execution_status,execution_reason_code
    ) values (
      v_user_id,v_wse.exercise_id,v_reps,v_weight,v_rpe,v_item_notes,v_completed_at,p_session_id,v_duration,v_distance,
      v_status,coalesce(v_wse.prescription_json,'{}'::jsonb),'internal',v_quality,v_capability_eligible,
      case when v_exec='not_completed' then coalesce(v_reason,'USER_NOT_COMPLETED') else null end,
      v_pain,case when v_pain then coalesce(v_session.injured_zones,'{}'::text[]) else '{}'::text[] end,
      jsonb_strip_nulls(jsonb_build_object(
        'reps_completed',v_reps,'weight_kg',v_weight,'duration_seconds',v_duration,'distance_meters',v_distance,
        'rpe',v_rpe,'user_execution_status',v_exec,'execution_reason_code',v_reason
      )),
      jsonb_build_object(
        'session_id',p_session_id,'block_key',v_wse.block_key,'position',v_wse.position,
        'focus',v_session.focus,'readiness',v_session.readiness,'target_region',v_session.target_region,
        'mechanic',coalesce(v_session.mechanic_json->>'mechanic_key','')
      ),
      jsonb_build_object('score',v_quality,'capability_eligible',v_capability_eligible,'pain_affected',v_pain),
      jsonb_build_object('source','complete_workout_session_v1','session_exercise_id',v_instance_id),
      v_instance_id,v_exec,case when v_exec='completed' then null else v_reason end
    )
    on conflict (session_exercise_id) where source_kind='internal'
    do update set
      exercise_id=excluded.exercise_id,
      reps_completed=excluded.reps_completed,
      weight_kg=excluded.weight_kg,
      rpe=excluded.rpe,
      notes=excluded.notes,
      duration_seconds=excluded.duration_seconds,
      distance_meters=excluded.distance_meters,
      status=excluded.status,
      prescription_json=excluded.prescription_json,
      observation_quality=excluded.observation_quality,
      capability_eligible=excluded.capability_eligible,
      skip_reason=excluded.skip_reason,
      pain_affected=excluded.pain_affected,
      pain_zones=excluded.pain_zones,
      actual_json=excluded.actual_json,
      observation_context_json=excluded.observation_context_json,
      observation_quality_json=excluded.observation_quality_json,
      comparison_context_json=excluded.comparison_context_json,
      user_execution_status=excluded.user_execution_status,
      execution_reason_code=excluded.execution_reason_code;

    if v_exec='completed' then v_completed:=v_completed+1;
    elsif v_exec='adapted' then v_adapted:=v_adapted+1;
    else v_not_completed:=v_not_completed+1;
    end if;
  end loop;

  select count(*) into v_pending_count
  from public.workout_session_exercises
  where session_id=p_session_id and coalesce(user_execution_status,'pending')='pending';
  if v_pending_count<>0 then raise exception 'Session still contains % pending exercise instances',v_pending_count; end if;

  if p_protocol_outcome is not null and p_protocol_outcome<>'{}'::jsonb then
    perform public.record_session_protocol_outcome(p_session_id,p_protocol_outcome);
  end if;

  update public.workout_sessions
  set status='completed',
      completed_at=v_completed_at,
      global_rpe=p_global_rpe,
      post_workout_feeling=p_post_workout_feeling,
      notes=coalesce(p_notes,notes),
      updated_at=now()
  where id=p_session_id and user_id=v_user_id;

  select count(*) into v_logs_count
  from public.exercise_logs
  where session_id=p_session_id and source_kind='internal';

  select count(*) into v_missing_logs
  from public.workout_session_exercises wse
  where wse.session_id=p_session_id
    and not exists(
      select 1 from public.exercise_logs el
      where el.session_exercise_id=wse.id and el.source_kind='internal'
    );
  if v_missing_logs<>0 then raise exception 'Atomic completion invariant failed: % exercise instances have no log',v_missing_logs; end if;

  return jsonb_build_object(
    'status','COMPLETED',
    'version','fc7-atomic-completion-v1',
    'session_id',p_session_id,
    'completed_at',v_completed_at,
    'instances',v_total_instances,
    'logs',v_logs_count,
    'completed_exercises',v_completed,
    'adapted_exercises',v_adapted,
    'not_completed_exercises',v_not_completed,
    'pending_instances',0,
    'atomic',true,
    'idempotent_retry_supported',true,
    'analysis_after_commit',jsonb_build_array('run_capability_live_session','apply_session_protocol_observation','d_finalize_weekly_session','pi_refresh_coaching_directives')
  );
end;
$function$;

revoke execute on function public.complete_workout_session_v1(uuid,integer,integer,text,jsonb,jsonb) from public,anon;
grant execute on function public.complete_workout_session_v1(uuid,integer,integer,text,jsonb,jsonb) to authenticated;;
