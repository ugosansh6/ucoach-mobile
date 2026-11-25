do $$
declare
  v_def text;
  v_patched text;
  v_marker text := '      perform public.e_mark_session_started(v_sid, v_anchor);';
  v_replacement text := '      perform public.e_mark_session_started(v_sid, v_anchor);' || E'\n\n' ||
    '      if exists (' || E'\n' ||
    '        select 1' || E'\n' ||
    '        from public.workout_session_exercises wse_lifecycle' || E'\n' ||
    '        where wse_lifecycle.session_id=v_sid' || E'\n' ||
    '          and lower(coalesce(wse_lifecycle.block_key,'''') )=''wod''' || E'\n' ||
    '      ) then' || E'\n' ||
    '        perform public.mark_wod_revealed(v_sid);' || E'\n' ||
    '        perform public.mark_wod_started(v_sid);' || E'\n' ||
    '      end if;';
begin
  select pg_get_functiondef(p.oid)
  into v_def
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname='qa_concrete_coach_cycle_v1'
    and pg_get_function_identity_arguments(p.oid) like 'p_user_id uuid%'
  limit 1;

  if v_def is null then
    raise exception 'qa_concrete_coach_cycle_v1 not found';
  end if;

  if position('perform public.mark_wod_started(v_sid);' in v_def) > 0 then
    return;
  end if;

  if position(v_marker in v_def) = 0 then
    raise exception 'qa_concrete_coach_cycle_v1 session-start marker not found';
  end if;

  v_patched := replace(v_def, v_marker, v_replacement);

  if v_patched = v_def then
    raise exception 'qa_concrete_coach_cycle_v1 WOD lifecycle patch produced no change';
  end if;

  execute v_patched;
end;
$$;

comment on function public.qa_concrete_coach_cycle_v1(uuid,date,text,integer) is
  'Synthetic 4-week/12-session coach-cycle QA. Lifecycle-aligned: starts session and explicitly reveals/starts WOD when present before completion. All mutations intentionally roll back.';
