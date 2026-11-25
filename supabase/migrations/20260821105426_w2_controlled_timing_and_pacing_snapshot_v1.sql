create or replace function public.w2_session_execution_observation_v1(p_session_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path=public
as $$
declare
  v_user uuid:=auth.uid();
  v_session record;
  v_events int:=0;
  v_splits jsonb:='[]'::jsonb;
  v_split_count int:=0;
  v_completed_rounds int:=0;
  v_first numeric;
  v_last numeric;
  v_fast numeric;
  v_slow numeric;
  v_mean numeric;
  v_pacing jsonb:=null;
  v_controlled boolean:=false;
  v_start boolean:=false;
  v_wod_start boolean:=false;
  v_complete boolean:=false;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  select ws.id,ws.user_id,ws.status,ws.started_at,ws.completed_at,ws.wod_started_at,ws.actual_protocol_outcome_json
  into v_session from public.workout_sessions ws where ws.id=p_session_id and ws.user_id=v_user;
  if not found then raise exception 'Session not found'; end if;

  select count(*)::int,
         bool_or(event_type='SESSION_START'),
         bool_or(event_type in ('WOD_START','WOD_PLAYER_START')),
         bool_or(event_type in ('SESSION_COMPLETE','WOD_PLAYER_COMPLETE'))
  into v_events,v_start,v_wod_start,v_complete
  from public.session_execution_events where session_id=p_session_id;

  v_controlled:=coalesce(v_session.actual_protocol_outcome_json->>'source','')='ugerod_session_player'
    or exists(select 1 from public.session_execution_events where session_id=p_session_id and event_type='WOD_PLAYER_START');

  select count(*)::int,
         coalesce(jsonb_agg(payload_json order by coalesce(nullif(payload_json->>'round','')::int,0),occurred_at,id),'[]'::jsonb),
         min(nullif(payload_json->>'split_seconds','')::numeric),
         max(nullif(payload_json->>'split_seconds','')::numeric),
         round(avg(nullif(payload_json->>'split_seconds','')::numeric),2)
  into v_split_count,v_splits,v_fast,v_slow,v_mean
  from public.session_execution_events
  where session_id=p_session_id and event_type='ROUND_COMPLETE'
    and nullif(payload_json->>'split_seconds','') is not null;

  select nullif(e.payload_json->>'split_seconds','')::numeric into v_first
  from public.session_execution_events e
  where e.session_id=p_session_id and e.event_type='ROUND_COMPLETE' and nullif(e.payload_json->>'split_seconds','') is not null
  order by coalesce(nullif(e.payload_json->>'round','')::int,0),e.occurred_at,e.id limit 1;

  select nullif(e.payload_json->>'split_seconds','')::numeric into v_last
  from public.session_execution_events e
  where e.session_id=p_session_id and e.event_type='ROUND_COMPLETE' and nullif(e.payload_json->>'split_seconds','') is not null
  order by coalesce(nullif(e.payload_json->>'round','')::int,0) desc,e.occurred_at desc,e.id desc limit 1;

  v_completed_rounds:=coalesce(nullif(v_session.actual_protocol_outcome_json->>'rounds_completed','')::int,0);

  if v_controlled and v_completed_rounds>=2 and v_split_count=v_completed_rounds and v_first is not null and v_first>0 then
    v_pacing:=jsonb_build_object(
      'status','QUALIFIED',
      'first_split_seconds',v_first,
      'last_split_seconds',v_last,
      'fastest_split_seconds',v_fast,
      'slowest_split_seconds',v_slow,
      'mean_split_seconds',v_mean,
      'last_vs_first_change_percent',round(((v_last-v_first)/v_first*100.0)::numeric,1),
      'interpretation','RAW_PACING_ONLY_NO_FATIGUE_CAUSE_INFERRED'
    );
  end if;

  return jsonb_build_object(
    'version','w2-session-execution-observation-v1',
    'session_id',p_session_id,
    'time_quality',case when v_controlled then 'CONTROLLED_WINDOW' else 'UNQUALIFIED' end,
    'controlled_window',v_controlled,
    'uncontrolled_wall_clock_used_for_performance',false,
    'round_splits',v_splits,
    'split_coverage',jsonb_build_object(
      'recorded_rounds',v_split_count,
      'completed_rounds',v_completed_rounds,
      'complete',v_completed_rounds>0 and v_split_count=v_completed_rounds
    ),
    'pacing',v_pacing,
    'event_trace',jsonb_build_object(
      'event_count',v_events,
      'session_start_seen',coalesce(v_start,false),
      'wod_start_seen',coalesce(v_wod_start,false),
      'completion_seen',coalesce(v_complete,false),
      'chronology_reconstructable',coalesce(v_start,false) and coalesce(v_wod_start,false) and coalesce(v_complete,false),
      'trace_is_not_source_of_truth',true
    ),
    'semantics',jsonb_build_object(
      'pacing_requires_complete_controlled_round_coverage',true,
      'missing_splits_are_not_fabricated',true,
      'pause_resume_are_trace_events_not_sports_output',true,
      'final_session_state_remains_authoritative',true
    )
  );
end; $$;
revoke all on function public.w2_session_execution_observation_v1(uuid) from public,anon;
grant execute on function public.w2_session_execution_observation_v1(uuid) to authenticated,service_role;
