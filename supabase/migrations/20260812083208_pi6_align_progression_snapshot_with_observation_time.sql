do $$
declare
  v_def text;
begin
  select pg_get_functiondef(p.oid)
  into v_def
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname='pi_progression_snapshot';

  if v_def is null then raise exception 'pi_progression_snapshot not found'; end if;

  -- Overall exercise-capability event counts: use the date of the sporting
  -- observation, not the later technical processing time.
  v_def:=replace(v_def,
$old$  from public.capability_update_events
  where user_id=p_user_id and applied
    and created_at::date between v_since and v_anchor;$old$,
$new$  from public.capability_update_events cue
  left join public.exercise_logs el on el.id=cue.exercise_log_id
  where cue.user_id=p_user_id and cue.applied
    and coalesce(el.created_at,cue.created_at)::date between v_since and v_anchor;$new$);

  -- Load-frontier expansion is a positive progression signal too.
  v_def:=replace(v_def,
    'count(*) filter(where decision ilike ''EXPAND%'' or decision ilike ''%PROGRESS%'')',
    'count(*) filter(where decision ilike ''EXPAND%'' or decision ilike ''%PROGRESS%'' or decision=''ADD_FRONTIER_POINT'')'
  );
  v_def:=replace(v_def,
    'count(*) filter(where cue.decision ilike ''EXPAND%'' or cue.decision ilike ''%PROGRESS%'')::int',
    'count(*) filter(where cue.decision ilike ''EXPAND%'' or cue.decision ilike ''%PROGRESS%'' or cue.decision=''ADD_FRONTIER_POINT'')::int'
  );
  v_def:=replace(v_def,
    'coalesce(ld.latest_decision,'''') ilike ''EXPAND%'' or coalesce(ld.latest_decision,'''') ilike ''%PROGRESS%''',
    'coalesce(ld.latest_decision,'''') ilike ''EXPAND%'' or coalesce(ld.latest_decision,'''') ilike ''%PROGRESS%'' or coalesce(ld.latest_decision,'''')=''ADD_FRONTIER_POINT'''
  );

  -- Movement-level live events: same sporting timestamp contract.
  v_def:=replace(v_def,
$new$      from public.capability_update_events cue
      where cue.user_id=c.user_id$new$,
$new$      from public.capability_update_events cue
      left join public.exercise_logs el on el.id=cue.exercise_log_id
      where cue.user_id=c.user_id$new$);
  v_def:=replace(v_def,
    'cue.created_at::date between v_since and v_anchor',
    'coalesce(el.created_at,cue.created_at)::date between v_since and v_anchor'
  );
  v_def:=replace(v_def,
    'order by cue.created_at desc,cue.id desc',
    'order by coalesce(el.created_at,cue.created_at) desc,cue.id desc'
  );

  -- Protocol events are scoped to the real completed session date.
  v_def:=replace(v_def,
$old$  from public.protocol_capability_events
  where user_id=p_user_id and applied
    and created_at::date between v_since and v_anchor;$old$,
$new$  from public.protocol_capability_events pe
  left join public.workout_sessions pws on pws.id=pe.session_id
  where pe.user_id=p_user_id and pe.applied
    and coalesce(pws.completed_at,pe.created_at)::date between v_since and v_anchor;$new$);

  v_def:=replace(v_def,
$new$      from public.protocol_capability_events pe
      where pe.user_id=p.user_id$new$,
$new$      from public.protocol_capability_events pe
      left join public.workout_sessions pws on pws.id=pe.session_id
      where pe.user_id=p.user_id$new$);
  v_def:=replace(v_def,
    'pe.created_at::date between v_since and v_anchor',
    'coalesce(pws.completed_at,pe.created_at)::date between v_since and v_anchor'
  );
  v_def:=replace(v_def,
    'order by pe.created_at desc,pe.id desc',
    'order by coalesce(pws.completed_at,pe.created_at) desc,pe.id desc'
  );

  v_def:=replace(v_def,
    '''version'',''pi1-progression-intelligence-v1''',
    '''version'',''pi1-progression-intelligence-v2-time-aligned'''
  );

  execute v_def;
end $$;;
