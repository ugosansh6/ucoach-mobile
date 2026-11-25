create or replace function public.w2_session_execution_observation_v1(p_session_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path=public
as $$
declare
  v_user uuid:=auth.uid();
  v_session record;
  v_outcome jsonb:='{}'::jsonb;
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

  select ws.id,ws.user_id,ws.status,ws.started_at,ws.completed_at,ws.wod_started_at,
         coalesce(ws.actual_protocol_outcome_json,'{}'::jsonb)
  into v_session
  from public.workout_sessions ws
  where ws.id=p_session_id and ws.user_id=v_user;

  if not found then raise exception 'Session not found'; end if;

  v_outcome:=coalesce(v_session.actual_protocol_outcome_json,'{}'::jsonb);
  v_controlled:=coalesce(v_outcome->>'source','')='ugerod_session_player'
    and coalesce((v_outcome->>'controlled_timing')::boolean,false);

  select count(*)::int,
         bool_or(event_type='SESSION_START'),
         bool_or(event_type in ('WOD_START','WOD_PLAYER_START')),
         bool_or(event_type in ('SESSION_COMPLETE','WOD_PLAYER_COMPLETE'))
  into v_events,v_start,v_wod_start,v_complete
  from public.session_execution_events
  where session_id=p_session_id;

  with source_splits as (
    select value as split, ord::int as ord
    from jsonb_array_elements(
      case
        when jsonb_typeof(coalesce(v_outcome->'round_splits','[]'::jsonb))='array'
          then coalesce(v_outcome->'round_splits','[]'::jsonb)
        else '[]'::jsonb
      end
    ) with ordinality q(value,ord)
    where coalesce((value->>'controlled_window')::boolean,false)
      and nullif(value->>'round','') is not null
      and nullif(value->>'split_seconds','') is not null
      and (value->>'split_seconds')::numeric >= 0
  ), normalized as (
    select split,
           (split->>'round')::int as round_number,
           (split->>'split_seconds')::numeric as split_seconds,
           ord
    from source_splits
  )
  select count(*)::int,
         coalesce(jsonb_agg(split order by round_number,ord),'[]'::jsonb),
         min(split_seconds),
         max(split_seconds),
         round(avg(split_seconds),2)
  into v_split_count,v_splits,v_fast,v_slow,v_mean
  from normalized;

  select (x->>'split_seconds')::numeric
  into v_first
  from jsonb_array_elements(v_splits) x
  order by (x->>'round')::int
  limit 1;

  select (x->>'split_seconds')::numeric
  into v_last
  from jsonb_array_elements(v_splits) x
  order by (x->>'round')::int desc
  limit 1;

  v_completed_rounds:=coalesce(nullif(v_outcome->>'rounds_completed','')::int,0);

  if v_controlled
     and v_completed_rounds>=2
     and v_split_count=v_completed_rounds
     and v_first is not null
     and v_first>0
  then
    v_pacing:=jsonb_build_object(
      'status','QUALIFIED',
      'first_split_seconds',v_first,
      'last_split_seconds',v_last,
      'fastest_split_seconds',v_fast,
      'slowest_split_seconds',v_slow,
      'mean_split_seconds',v_mean,
      'last_vs_first_change_percent',round(((v_last-v_first)/v_first*100.0)::numeric,1),
      'interpretation','RAW_PACING_ONLY_NO_FATIGUE_CAUSE_INFERRED',
      'source','AUTHORITATIVE_COMPLETION_ROUND_SPLITS'
    );
  end if;

  return jsonb_build_object(
    'version','w2-session-execution-observation-v2',
    'session_id',p_session_id,
    'time_quality',case when v_controlled then 'CONTROLLED_WINDOW' else 'UNQUALIFIED' end,
    'controlled_window',v_controlled,
    'uncontrolled_wall_clock_used_for_performance',false,
    'round_splits',v_splits,
    'split_coverage',jsonb_build_object(
      'recorded_rounds',v_split_count,
      'completed_rounds',v_completed_rounds,
      'complete',v_completed_rounds>0 and v_split_count=v_completed_rounds,
      'source','actual_protocol_outcome_json.round_splits'
    ),
    'pacing',v_pacing,
    'event_trace',jsonb_build_object(
      'event_count',v_events,
      'session_start_seen',coalesce(v_start,false),
      'wod_start_seen',coalesce(v_wod_start,false),
      'completion_seen',coalesce(v_complete,false),
      'chronology_reconstructable',coalesce(v_start,false) and coalesce(v_wod_start,false) and coalesce(v_complete,false),
      'trace_is_not_source_of_truth',true,
      'trace_is_not_source_of_pacing',true
    ),
    'semantics',jsonb_build_object(
      'pacing_requires_complete_controlled_round_coverage',true,
      'pacing_source','AUTHORITATIVE_COMPLETION_PAYLOAD',
      'missing_splits_are_not_fabricated',true,
      'pause_resume_are_trace_events_not_sports_output',true,
      'final_session_state_remains_authoritative',true,
      'event_trace_never_qualifies_timing_by_itself',true
    )
  );
end; $$;

revoke all on function public.w2_session_execution_observation_v1(uuid) from public,anon;
grant execute on function public.w2_session_execution_observation_v1(uuid) to authenticated,service_role;

comment on function public.w2_session_execution_observation_v1(uuid) is
'W2 controlled timing observation v2. Pacing is derived only from round splits persisted atomically inside actual_protocol_outcome_json by the UGEROD player. session_execution_events remains trace-only.';
