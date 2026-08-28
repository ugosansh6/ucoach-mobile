-- Bridge Environment Player exercise actuals into the canonical Outdoor protocol outcome.

create or replace function ugerod_private.outdoor_protocol_seed_from_completion_v1(p_exercises jsonb)
returns jsonb
language plpgsql
immutable
set search_path to 'public','ugerod_private'
as $function$
declare
  v_item jsonb;
  v_actual jsonb;
  v_elapsed numeric;
begin
  if p_exercises is null or jsonb_typeof(p_exercises)<>'array' then return null; end if;
  for v_item in select value from jsonb_array_elements(p_exercises) loop
    v_actual:=coalesce(v_item->'performance_actual_json','{}'::jsonb);
    if jsonb_typeof(v_actual)='object'
       and (upper(coalesce(v_actual->>'running_mechanic','')) like 'RUN_%' or v_actual->>'source'='ugerod_environment_player') then
      v_elapsed:=coalesce(public.jsonb_num(v_actual,'elapsed_seconds'),public.jsonb_num(v_item,'duration_seconds'));
      return jsonb_strip_nulls(v_actual||jsonb_build_object(
        'elapsed_seconds',v_elapsed,
        'source',coalesce(v_actual->>'source','ugerod_environment_player'),
        'environment_protocol_seed_from_exercise_actual',true
      ));
    end if;
  end loop;
  return null;
end;
$function$;

create or replace function public.complete_workout_session_v3(
  p_session_id uuid,
  p_global_rpe integer,
  p_post_workout_feeling integer,
  p_notes text default null,
  p_exercises jsonb default '[]'::jsonb,
  p_protocol_outcome jsonb default null,
  p_actual_environment_code text default null,
  p_actual_surface_code text default null,
  p_actual_equipment_used text[] default null,
  p_environment_change_reason text default null
)
returns jsonb
language plpgsql security definer
set search_path to 'public','ugerod_private'
as $function$
declare
  v_user_id uuid;
  v_planned_environment text;
  v_result jsonb;
  v_context jsonb:=null;
  v_working jsonb;
  v_protocol_seed jsonb;
  v_protocol jsonb;
begin
  select user_id,planned_environment_code into v_user_id,v_planned_environment
  from public.workout_sessions where id=p_session_id;
  if v_user_id is null then raise exception 'Session not found'; end if;
  if auth.uid() is not null and auth.uid()<>v_user_id then raise exception 'Forbidden user'; end if;

  v_working:=public.gym_enrich_completion_payload_v1(p_session_id,p_exercises);
  v_protocol_seed:=p_protocol_outcome;
  if upper(coalesce(v_planned_environment,''))='OUTDOOR' and v_protocol_seed is null then
    v_protocol_seed:=ugerod_private.outdoor_protocol_seed_from_completion_v1(p_exercises);
  end if;
  v_protocol:=public.outdoor_enrich_protocol_outcome_v1(p_session_id,v_protocol_seed);

  v_result:=ugerod_private.complete_workout_session_v2_core_v1(
    p_session_id,p_global_rpe,p_post_workout_feeling,p_notes,v_working,v_protocol
  );

  if p_actual_environment_code is not null then
    v_context:=public.set_workout_session_environment_v1(
      p_session_id,null,null,null,p_actual_environment_code,p_actual_surface_code,p_actual_equipment_used,
      'USER_COMPLETION',p_environment_change_reason
    );
  end if;

  return v_result||jsonb_build_object(
    'environment_context_recorded',p_actual_environment_code is not null,
    'environment_context',v_context,
    'gym_set_actual_contract','gym-set-actual-v1',
    'outdoor_protocol_seed_from_exercise_actual',coalesce((v_protocol_seed->>'environment_protocol_seed_from_exercise_actual')::boolean,false),
    'outdoor_protocol_outcome_enriched',coalesce((v_protocol->>'outdoor_protocol_enriched')::boolean,false),
    'outdoor_protocol_contract',v_protocol->>'outdoor_protocol_contract',
    'version','complete-workout-session-v3.3-environment-actual-protocol-bridge'
  );
end;
$function$;

revoke all on function ugerod_private.outdoor_protocol_seed_from_completion_v1(jsonb) from public,anon,authenticated;
grant execute on function public.complete_workout_session_v3(uuid,integer,integer,text,jsonb,jsonb,text,text,text[],text) to authenticated,service_role;
