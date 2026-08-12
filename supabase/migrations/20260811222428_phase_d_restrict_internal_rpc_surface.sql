revoke all on function public.d_primary_goal(uuid) from public,anon,authenticated;
revoke all on function public.d_rebuild_weekly_stimulus_targets(uuid,date) from public,anon,authenticated;
revoke all on function public.d_sync_session_stimulus_ledger(uuid) from public,anon,authenticated;
revoke all on function public.d_resolve_session_context(uuid,date,integer,text,text,text,text) from public,anon,authenticated;
revoke all on function public.d_ensure_week_plan(uuid,date,boolean) from public,anon,authenticated;
revoke all on function public.d_week_snapshot(uuid,date) from public,anon,authenticated;
revoke all on function public.d_goal_streak(uuid,date,integer) from public,anon,authenticated;

-- Public runtime surface intentionally kept for signed-in users only.
revoke all on function public.d_generate_adaptive_session(uuid,text,integer,text,text,text,text[],jsonb,text[],integer,text,integer,text,date) from public,anon;
grant execute on function public.d_generate_adaptive_session(uuid,text,integer,text,text,text,text[],jsonb,text[],integer,text,integer,text,date) to authenticated;

revoke all on function public.d_dashboard_snapshot(uuid,date,date) from public,anon;
grant execute on function public.d_dashboard_snapshot(uuid,date,date) to authenticated;

revoke all on function public.d_finalize_weekly_session(uuid) from public,anon;
grant execute on function public.d_finalize_weekly_session(uuid) to authenticated;

create or replace function public.d_week_start(p_date date)
returns date
language sql
immutable
set search_path=pg_catalog,public
as $$
  select date_trunc('week',p_date::timestamp)::date
$$;

create or replace function public.d_plan_recommended_offset(p_sequence int,p_target int)
returns int
language sql
immutable
set search_path=pg_catalog,public
as $$
  select case when greatest(1,p_target)=1 then 0
    else round(((greatest(1,p_sequence)-1)::numeric*6)/(greatest(1,p_target)-1))::int end
$$;

create or replace function public.d_base_progression_intent(p_sequence int,p_target int)
returns text
language sql
immutable
set search_path=pg_catalog,public
as $$
  select case
    when greatest(1,p_sequence)>=greatest(1,p_target) then 'CONSOLIDATE'
    when mod(greatest(1,p_sequence),2)=1 then 'PROGRESS'
    else 'MAINTAIN' end
$$;

create or replace function public.d_base_target_region(p_goal text,p_sequence int)
returns text
language plpgsql
immutable
set search_path=pg_catalog,public
as $$
declare v_index int:=mod(greatest(1,p_sequence)-1,4);
begin
  if p_goal in ('Strength','Muscle Gain') then
    return case v_index when 0 then 'Upper' when 1 then 'Lower' when 2 then 'Full Body' else 'Upper' end;
  elsif p_goal='Conditioning' then
    return case v_index when 0 then 'Full Body' when 1 then 'Lower' when 2 then 'Upper' else 'Full Body' end;
  elsif p_goal='Fat Loss' then
    return case v_index when 0 then 'Full Body' when 1 then 'Lower' when 2 then 'Full Body' else 'Upper' end;
  end if;
  return case v_index when 0 then 'Full Body' when 1 then 'Upper' when 2 then 'Lower' else 'Full Body' end;
end;
$$;;
