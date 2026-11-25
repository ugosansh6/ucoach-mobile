-- Final client ACL hardening.
-- Anonymous users never mutate public tables.
-- Authenticated users may mutate only explicit user-owned declarative/import tables.

do $$
declare
  r record;
  v_auth_write text[] := array[
    'profiles',
    'user_goals',
    'user_equipment_inventory',
    'exercise_favorites',
    'user_athletic_baseline',
    'external_session_imports',
    'external_session_items'
  ];
begin
  for r in
    select tablename
    from pg_tables
    where schemaname='public'
  loop
    execute format('revoke insert, update, delete, truncate, references, trigger on table public.%I from anon',r.tablename);
    if not (r.tablename = any(v_auth_write)) then
      execute format('revoke insert, update, delete, truncate, references, trigger on table public.%I from authenticated',r.tablename);
    end if;
  end loop;
end $$;

-- Explicitly lock the two SECURITY DEFINER surfaces found by the final scan.
revoke all on function public.c4_evaluate_session_format(uuid,uuid,text,text) from public, anon;
grant execute on function public.c4_evaluate_session_format(uuid,uuid,text,text) to authenticated, service_role;

revoke all on function public.c4_recompile_session_format_core(uuid,uuid,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.c4_recompile_session_format_core(uuid,uuid,text,text,jsonb) to service_role;

-- Prevent future objects created by postgres from silently regaining broad client mutation/execute grants.
alter default privileges for role postgres in schema public
  revoke insert, update, delete, truncate, references, trigger on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from public;
;
