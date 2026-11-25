do $$
declare r record;
begin
  for r in
    select ws.id
    from public.workout_sessions ws
    where ws.status='completed'
      and exists(select 1 from public.workout_session_exercises wse where wse.session_id=ws.id)
    order by coalesce(ws.completed_at,ws.created_at),ws.id
  loop
    perform public.d_sync_session_pattern_ledger_v1(r.id);
  end loop;
end;
$$;