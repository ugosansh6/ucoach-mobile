-- Only validated authenticated entrypoints are public API.
revoke all on function public.c4_generate_full_session(uuid,text,integer,text,text,text,text[],jsonb,text[],integer,text,integer,text) from public,anon;
grant execute on function public.c4_generate_full_session(uuid,text,integer,text,text,text,text[],jsonb,text[],integer,text,integer,text) to authenticated;

revoke all on function public.c4_swap_session_exercise(uuid,uuid,text[]) from public,anon;
grant execute on function public.c4_swap_session_exercise(uuid,uuid,text[]) to authenticated;

revoke all on function public.c4_recompile_session_format(uuid,uuid,text,text,jsonb) from public,anon;
grant execute on function public.c4_recompile_session_format(uuid,uuid,text,text,jsonb) to authenticated;

-- Internal mutating helper: never callable directly by app roles.
revoke all on function public.c4_apply_wod_candidate(uuid,uuid,jsonb,jsonb,text) from public,anon,authenticated;

-- Internal planning/session reconstruction helpers are only reached through validated SECURITY DEFINER entrypoints.
revoke all on function public.c4_plan_full_session(uuid,text,integer,text,text,text,text[],jsonb,integer,text,integer,text) from public,anon,authenticated;
revoke all on function public.c4_session_wod_candidate(uuid) from public,anon,authenticated;
;
