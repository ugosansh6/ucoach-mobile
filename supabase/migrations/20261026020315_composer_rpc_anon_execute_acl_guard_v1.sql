-- Supabase DEV migration applied on 2026-10-26.
-- Hardens Composer RPCs: SECURITY DEFINER functions must not be callable
-- through the anonymous PostgREST role. Keep authenticated clients and
-- trusted server-side jobs functional. No data or sports prescriptions change.
-- Source: CMP-010 / MSW-015 / MSW-036, GitHub issue #3.
--
-- Re-execution is safe (REVOKE/GRANT are idempotent).

revoke execute on function public.week_compile_composer_day_j_v1(uuid,uuid,date,integer,text[],text[],text) from public, anon;
revoke execute on function public.week_composer_mechanic_recommendations_v1(uuid,text,integer,text[],text) from public, anon;
revoke execute on function public.week_read_composer_for_day_v1(uuid,date) from public, anon;
revoke execute on function public.week_save_composer_draft_v1(uuid,uuid,jsonb) from public, anon;

grant execute on function public.week_compile_composer_day_j_v1(uuid,uuid,date,integer,text[],text[],text) to authenticated, service_role;
grant execute on function public.week_composer_mechanic_recommendations_v1(uuid,text,integer,text[],text) to authenticated, service_role;
grant execute on function public.week_read_composer_for_day_v1(uuid,date) to authenticated, service_role;
grant execute on function public.week_save_composer_draft_v1(uuid,uuid,jsonb) to authenticated, service_role;
