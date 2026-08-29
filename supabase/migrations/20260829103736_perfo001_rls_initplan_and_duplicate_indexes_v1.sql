do $$
declare
  r record;
  v_qual text;
  v_check text;
  v_sql text;
begin
  for r in
    select schemaname,tablename,policyname,qual,with_check
    from pg_policies
    where schemaname='public'
      and (
        (coalesce(qual,'') like '%auth.uid()%' and coalesce(qual,'') not ilike '%select auth.uid()%')
        or
        (coalesce(with_check,'') like '%auth.uid()%' and coalesce(with_check,'') not ilike '%select auth.uid()%')
      )
  loop
    v_qual := r.qual;
    v_check := r.with_check;

    if v_qual is not null and v_qual not ilike '%select auth.uid()%' then
      v_qual := replace(v_qual,'auth.uid()','(select auth.uid())');
    end if;
    if v_check is not null and v_check not ilike '%select auth.uid()%' then
      v_check := replace(v_check,'auth.uid()','(select auth.uid())');
    end if;

    v_sql := format('alter policy %I on %I.%I',r.policyname,r.schemaname,r.tablename);
    if v_qual is not null then
      v_sql := v_sql || format(' using (%s)',v_qual);
    end if;
    if v_check is not null then
      v_sql := v_sql || format(' with check (%s)',v_check);
    end if;
    execute v_sql;
  end loop;
end;
$$;

-- Keep the more-used equivalent index in each non-constraint pair.
drop index if exists public.exercise_logs_user_created_at_idx;
drop index if exists public.idx_exercises_pattern;
drop index if exists public.user_athletic_baseline_user_dimension_uidx;

-- The constraint-backed user_goals index must remain; remove the redundant standalone copy.
drop index if exists public.user_goals_user_goal_unique_idx;

-- Keep the heavily-used canonical workout_session_exercises indexes.
drop index if exists public.workout_session_exercises_session_idx;
drop index if exists public.workout_session_exercises_block_idx;
drop index if exists public.workout_session_exercises_status_idx;