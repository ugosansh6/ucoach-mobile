revoke execute on function public.pi_coaching_directives(uuid,date,integer) from public,anon,authenticated;
revoke execute on function public.pi_exercise_directives(uuid,date,integer) from public,anon,authenticated;
revoke execute on function public.pi_pattern_directives(uuid,date,integer) from public,anon,authenticated;
revoke execute on function public.pi_refresh_coaching_directives(uuid,date,integer) from public,anon,authenticated;
revoke execute on function public.pi_candidate_fit(uuid,text,text) from public,anon,authenticated;
revoke all on table public.user_coaching_directive_runtime from public,anon,authenticated;;
