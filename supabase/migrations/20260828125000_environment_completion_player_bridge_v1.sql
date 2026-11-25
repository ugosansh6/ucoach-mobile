-- UGEROD — GYM/OUTDOOR player completion compatibility
-- 2026-08-28
--
-- The mobile completion service still calls complete_workout_session_v2.
-- Environment sessions already persist richer player actuals and declare
-- complete_workout_session_v3 as their canonical completion RPC.
--
-- This migration splits the historical V2 implementation into an internal
-- core, lets V3 call that core directly, and makes V2 transparently apply the
-- existing GYM/OUTDOOR enrichers for environment sessions. HOME/BOX retain
-- the historical V2 behaviour unchanged.
--
-- Important contract: the bridge never infers equipment used. For the current
-- dedicated environment player, actual environment/surface are copied from
-- the explicit planned context only because ENV-005 context mutation after
-- STARTED is not yet exposed. When that lifecycle is introduced, the front
-- should send explicit actual context through V3.

begin;

create or replace function ugerod_private.complete_workout_session_v2_core_v1(
  p_session_id uuid,
  p_global_rpe integer,
  p_post_workout_feeling integer,
  p_notes text default null,
  p_exercises jsonb default '[]'::jsonb,
  p_protocol_outcome jsonb default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public','ugerod_private'
as $function$
declare
  v_result jsonb;
  v_item jsonb;
  v_instance_id uuid;
  v_extra jsonb;
  v_augmented int:=0;
  v_user_id uuid;
  v_intent_sync jsonb:='{}'::jsonb;
  v_working jsonb;
  v_events int:=0;
begin
  v_working:=public.w2_enrich_completion_payload_v1(p_session_id,p_exercises);
  v_result:=public.complete_workout_session_v1(
    p_session_id,p_global_rpe,p_post_workout_feeling,p_notes,v_working,p_protocol_outcome
  );

  for v_item in select value from jsonb_array_elements(coalesce(v_working,'[]'::jsonb)) loop
    begin
      v_instance_id:=(v_item->>'session_exercise_id')::uuid;
    exception when others then
      continue;
    end;

    v_extra:=coalesce(v_item->'performance_actual_json','{}'::jsonb);
    if jsonb_typeof(v_extra)='object' and v_extra<>'{}'::jsonb then
      update public.exercise_logs
      set actual_json=jsonb_strip_nulls(
            coalesce(actual_json,'{}'::jsonb)
            ||v_extra
            ||jsonb_build_object('performance_actual_contract','m7.2-v1')
          ),
          comparison_context_json=coalesce(comparison_context_json,'{}'::jsonb)
            ||jsonb_build_object(
              'performance_actual_contract','m7.2-v1',
              'provenance_class',v_extra->>'provenance_class'
            )
      where session_id=p_session_id
        and session_exercise_id=v_instance_id
        and source_kind='internal';
      if found then
        v_augmented:=v_augmented+1;
      end if;
    end if;
  end loop;

  v_events:=public.w2_ingest_protocol_execution_events_v1(p_session_id,p_protocol_outcome);
  select user_id into v_user_id from public.workout_sessions where id=p_session_id;
  if v_user_id is not null then
    v_intent_sync:=public.resolve_uncovered_pattern_intents_v1(v_user_id,p_session_id);
  end if;

  return v_result||jsonb_build_object(
    'completion_contract','w2-observation-completion-v1',
    'performance_actual_rows_augmented',v_augmented,
    'execution_trace_events_ingested',v_events,
    'uncovered_pattern_intent_sync',v_intent_sync
  );
end;
$function$;

revoke all on function ugerod_private.complete_workout_session_v2_core_v1(uuid,integer,integer,text,jsonb,jsonb)
  from public, anon, authenticated;
grant execute on function ugerod_private.complete_workout_session_v2_core_v1(uuid,integer,integer,text,jsonb,jsonb)
  to service_role;

create or replace function public.complete_workout_session_v2(
  p_session_id uuid,
  p_global_rpe integer,
  p_post_workout_feeling integer,
  p_notes text default null,
  p_exercises jsonb default '[]'::jsonb,
  p_protocol_outcome jsonb default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public','ugerod_private'
as $function$
declare
  v_result jsonb;
  v_working jsonb;
  v_protocol jsonb;
  v_planned_environment text;
  v_planned_surface text;
  v_context jsonb:=null;
begin
  select planned_environment_code, planned_surface_code
  into v_planned_environment, v_planned_surface
  from public.workout_sessions
  where id=p_session_id;

  if not found then
    raise exception 'Session not found';
  end if;

  if upper(coalesce(v_planned_environment,'')) in ('GYM','OUTDOOR') then
    v_working:=public.gym_enrich_completion_payload_v1(p_session_id,p_exercises);
    v_protocol:=public.outdoor_enrich_protocol_outcome_v1(p_session_id,p_protocol_outcome);

    v_result:=ugerod_private.complete_workout_session_v2_core_v1(
      p_session_id,p_global_rpe,p_post_workout_feeling,p_notes,v_working,v_protocol
    );

    v_context:=public.set_workout_session_environment_v1(
      p_session_id,
      null,null,null,
      upper(v_planned_environment),
      v_planned_surface,
      null,
      'PLAYER_COMPLETION_COMPAT_V2',
      null
    );

    return v_result||jsonb_build_object(
      'environment_player_compatibility_bridge',true,
      'environment_context_recorded',true,
      'environment_context',v_context,
      'gym_set_actual_contract','gym-set-actual-v1',
      'outdoor_protocol_outcome_enriched',coalesce((v_protocol->>'outdoor_protocol_enriched')::boolean,false),
      'outdoor_protocol_contract',v_protocol->>'outdoor_protocol_contract',
      'version','complete-workout-session-v2.1-environment-player-bridge'
    );
  end if;

  return ugerod_private.complete_workout_session_v2_core_v1(
    p_session_id,p_global_rpe,p_post_workout_feeling,p_notes,p_exercises,p_protocol_outcome
  );
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
) returns jsonb
language plpgsql
security definer
set search_path to 'public','ugerod_private'
as $function$
declare
  v_user_id uuid;
  v_result jsonb;
  v_context jsonb:=null;
  v_working jsonb;
  v_protocol jsonb;
begin
  select user_id into v_user_id from public.workout_sessions where id=p_session_id;
  if v_user_id is null then raise exception 'Session not found'; end if;
  if auth.uid() is not null and auth.uid()<>v_user_id then raise exception 'Forbidden user'; end if;

  v_working:=public.gym_enrich_completion_payload_v1(p_session_id,p_exercises);
  v_protocol:=public.outdoor_enrich_protocol_outcome_v1(p_session_id,p_protocol_outcome);

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
    'outdoor_protocol_outcome_enriched',coalesce((v_protocol->>'outdoor_protocol_enriched')::boolean,false),
    'outdoor_protocol_contract',v_protocol->>'outdoor_protocol_contract',
    'version','complete-workout-session-v3.2-core-split'
  );
end;
$function$;

revoke all on function public.complete_workout_session_v2(uuid,integer,integer,text,jsonb,jsonb)
  from public, anon;
revoke all on function public.complete_workout_session_v3(uuid,integer,integer,text,jsonb,jsonb,text,text,text[],text)
  from public, anon;
grant execute on function public.complete_workout_session_v2(uuid,integer,integer,text,jsonb,jsonb)
  to authenticated, service_role;
grant execute on function public.complete_workout_session_v3(uuid,integer,integer,text,jsonb,jsonb,text,text,text[],text)
  to authenticated, service_role;

commit;
