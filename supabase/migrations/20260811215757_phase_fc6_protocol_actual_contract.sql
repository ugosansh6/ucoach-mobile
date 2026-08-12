create or replace function public.build_session_protocol_descriptor(p_session_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to public
as $function$
declare
  v_user_id uuid;
  v_mechanic text;
  v_variant text;
  v_parameters jsonb;
  v_signature_parameters jsonb;
  v_exercises jsonb;
  v_protocol jsonb;
  v_signature_protocol jsonb;
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

  -- Runtime-only randomization must not create a new capability signature.
  v_signature_parameters:=v_parameters-'deck_order';
  v_signature_protocol:=jsonb_strip_nulls(jsonb_build_object(
    'mechanic_key',v_mechanic,
    'variant_key',v_variant,
    'parameters',v_signature_parameters,
    'exercises',v_exercises
  ));

  v_signature:=lower(v_mechanic)||':'||lower(coalesce(v_variant,'base'))||':'||md5(v_signature_protocol::text);

  return jsonb_build_object(
    'protocol_signature',v_signature,
    'mechanic_key',v_mechanic,
    'variant_key',v_variant,
    'protocol_json',v_protocol,
    'signature_protocol_json',v_signature_protocol,
    'exercise_count',jsonb_array_length(v_exercises),
    'version','b2.7-protocol-signature-2-fc6'
  );
end;
$function$;

create or replace function public.protocol_partial_progress_ratio(p_protocol jsonb, p_actual jsonb)
returns numeric
language plpgsql
immutable
set search_path to public
as $function$
declare
  v_explicit numeric;
  v_failed_stage numeric;
  v_ex jsonb;
  v_id text;
  v_pres jsonb;
  v_overlay jsonb;
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
      v_overlay:=coalesce(v_pres->'mechanic_overlay','{}'::jsonb);
      v_start:=coalesce(
        nullif(v_overlay->>'start_reps','')::numeric,
        nullif(v_overlay->>'base_reps','')::numeric,
        nullif(v_pres->>'start_reps','')::numeric,
        nullif(v_pres->>'reps_min','')::numeric,
        0
      );
      v_increment:=coalesce(
        nullif(v_overlay->>'increment_reps','')::numeric,
        nullif(v_pres->>'increment_reps','')::numeric,
        0
      );
      v_target:=greatest(0,v_start + greatest(0,v_failed_stage-1)*v_increment);
      v_actual_reps:=greatest(0,coalesce(nullif(p_actual->'partial_reps_by_exercise'->>v_id,'')::numeric,0));
      v_target_total:=v_target_total+v_target;
      v_actual_total:=v_actual_total+least(v_target,v_actual_reps);
    end loop;

    if v_count>0 and v_target_total>0 then
      return greatest(0,least(1,v_actual_total/v_target_total));
    end if;
  end if;

  if jsonb_array_length(coalesce(p_protocol->'exercises','[]'::jsonb))=1
     and nullif(p_actual->>'partial_next_stage_reps','') is not null then
    v_ex:=p_protocol->'exercises'->0;
    v_pres:=coalesce(v_ex->'prescription','{}'::jsonb);
    v_overlay:=coalesce(v_pres->'mechanic_overlay','{}'::jsonb);
    v_start:=coalesce(
      nullif(v_overlay->>'start_reps','')::numeric,
      nullif(v_overlay->>'base_reps','')::numeric,
      nullif(v_pres->>'start_reps','')::numeric,
      nullif(v_pres->>'reps_min','')::numeric,
      0
    );
    v_increment:=coalesce(
      nullif(v_overlay->>'increment_reps','')::numeric,
      nullif(v_pres->>'increment_reps','')::numeric,
      0
    );
    v_target:=greatest(0,v_start + greatest(0,v_failed_stage-1)*v_increment);
    if v_target>0 then
      return greatest(0,least(1,(p_actual->>'partial_next_stage_reps')::numeric/v_target));
    end if;
  end if;

  return 0;
end;
$function$;

create or replace function public.record_session_protocol_outcome(
  p_session_id uuid,
  p_actual jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to public
as $function$
declare
  v_user_id uuid;
  v_existing jsonb;
  v_actual jsonb;
begin
  if p_actual is null or jsonb_typeof(p_actual)<>'object' then
    raise exception 'Protocol outcome must be a JSON object';
  end if;

  select user_id,coalesce(actual_protocol_outcome_json,'{}'::jsonb)
  into v_user_id,v_existing
  from public.workout_sessions
  where id=p_session_id
  for update;

  if not found then raise exception 'Session not found'; end if;
  if auth.uid() is null or auth.uid()<>v_user_id then
    raise exception 'Forbidden user';
  end if;

  v_actual:=jsonb_strip_nulls(
    p_actual || jsonb_build_object(
      'recorded_at',now(),
      'source','ugerod_session_player',
      'version','fc6-protocol-actual-v1'
    )
  );

  update public.workout_sessions
  set actual_protocol_outcome_json=v_existing||v_actual,
      updated_at=now()
  where id=p_session_id and user_id=v_user_id;

  return jsonb_build_object(
    'status','RECORDED',
    'session_id',p_session_id,
    'actual_protocol_outcome_json',v_existing||v_actual,
    'version','fc6-protocol-actual-v1'
  );
end;
$function$;

revoke all on function public.record_session_protocol_outcome(uuid,jsonb) from public, anon;
grant execute on function public.record_session_protocol_outcome(uuid,jsonb) to authenticated;;
