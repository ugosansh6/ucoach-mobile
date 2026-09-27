-- PERF-009: mechanic-policy C4 uses the same once-per-generation
-- anti-redundancy snapshot as the canonical C4 solver.
-- No quality/safety/ranking rule is changed.

alter function public.solve_session_engine_c4_mechanic_policy_shadow_v1(
  uuid,text,integer,text,text,text,text[],jsonb,integer,text,integer,integer,text
)
rename to solve_session_engine_c4_mechanic_policy_shadow_v1_pre_perf009;

do $do$
declare
  v_def text;
  v_before text;
begin
  select pg_get_functiondef(p.oid)
  into v_def
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname='solve_session_engine_c4_mechanic_policy_shadow_v1_pre_perf009';

  if v_def is null then
    raise exception 'PERF-009 source engine not found';
  end if;

  v_def:=replace(
    v_def,
    'FUNCTION public.solve_session_engine_c4_mechanic_policy_shadow_v1_pre_perf009',
    'FUNCTION public.solve_session_engine_c4_mechanic_policy_shadow_v1'
  );

  v_before:=v_def;
  v_def:=replace(
    v_def,
    'v_red jsonb;',
    'v_red jsonb; v_red_snapshot jsonb;'
  );
  if v_def=v_before then
    raise exception 'PERF-009 declaration patch failed';
  end if;

  v_before:=v_def;
  v_def:=replace(
    v_def,
    'for v_candidate in',
    'v_red_snapshot:=public.c4_redundancy_snapshot_v1(p_user_id,p_policy_key); for v_candidate in'
  );
  if v_def=v_before then
    raise exception 'PERF-009 snapshot insertion failed';
  end if;

  v_before:=v_def;
  v_def:=replace(
    v_def,
    'v_red := public.c4_redundancy_score(p_user_id,v_final,p_policy_key);',
    'v_red := public.c4_redundancy_score_from_snapshot_v1(v_final,v_red_snapshot);'
  );
  if v_def=v_before then
    raise exception 'PERF-009 scorer patch failed';
  end if;

  execute v_def;
end;
$do$;

revoke all on function public.solve_session_engine_c4_mechanic_policy_shadow_v1_pre_perf009(
  uuid,text,integer,text,text,text,text[],jsonb,integer,text,integer,integer,text
) from public;
revoke all on function public.solve_session_engine_c4_mechanic_policy_shadow_v1_pre_perf009(
  uuid,text,integer,text,text,text,text[],jsonb,integer,text,integer,integer,text
) from anon;
revoke all on function public.solve_session_engine_c4_mechanic_policy_shadow_v1_pre_perf009(
  uuid,text,integer,text,text,text,text[],jsonb,integer,text,integer,integer,text
) from authenticated;
