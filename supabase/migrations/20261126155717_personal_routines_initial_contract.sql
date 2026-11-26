-- Independent personal routines; no relation to workout_sessions or coach history.
create function public.routine_exercises_valid_v1(p_exercises jsonb)
returns boolean language plpgsql immutable security invoker set search_path = pg_catalog, public as $$
declare e jsonb;
begin
 if jsonb_typeof(p_exercises) is distinct from 'array' then return false; end if;
 if jsonb_array_length(p_exercises)=0 then return false; end if;
 for e in select value from jsonb_array_elements(p_exercises) loop
   if jsonb_typeof(e) is distinct from 'object' or jsonb_typeof(e->'name') is distinct from 'string' or length(btrim(e->>'name')) not between 1 and 200
      or not (e ? 'exercise_id') or coalesce(jsonb_typeof(e->'exercise_id'),'') not in ('null','string')
      or (jsonb_typeof(e->'exercise_id')='string' and length(btrim(e->>'exercise_id')) not between 1 and 100)
      or jsonb_typeof(e->'sets') is distinct from 'number' or (e->>'sets') !~ '^[1-9][0-9]{0,3}$'
      or jsonb_typeof(e->'reps') is distinct from 'number' or (e->>'reps') !~ '^[1-9][0-9]{0,3}$'
      or (e - array['name','exercise_id','sets','reps']) <> '{}'::jsonb then return false; end if;
 end loop;
 return true;
end;
$$;
revoke all on function public.routine_exercises_valid_v1(jsonb) from public, anon;
grant execute on function public.routine_exercises_valid_v1(jsonb) to authenticated, service_role;
create table public.user_routines (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
 name text not null check(length(btrim(name)) between 1 and 120),
 category text not null check(category in ('MOBILITY','CORE','PHYSIO','CONDITIONING')),
 mechanic text not null default 'SETS_REPS' check(mechanic='SETS_REPS'),
 planned_minutes smallint not null check(planned_minutes between 1 and 30),
 recurrence_days smallint[] not null default '{}' check(cardinality(recurrence_days)<=7 and recurrence_days <@ array[0,1,2,3,4,5,6]::smallint[] and array_position(recurrence_days,null) is null),
 exercises jsonb not null check(public.routine_exercises_valid_v1(exercises)),
 archived_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(user_id,id)
);
create index user_routines_owner_active_idx on public.user_routines(user_id, archived_at);
alter table public.user_routines enable row level security;
revoke all on table public.user_routines from anon, authenticated;
grant select,insert,update on table public.user_routines to authenticated;
create policy routine_owner_read on public.user_routines for select to authenticated using ((select auth.uid())=user_id);
create policy routine_owner_insert on public.user_routines for insert to authenticated with check ((select auth.uid())=user_id);
create policy routine_owner_update on public.user_routines for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create table public.user_routine_realizations (
 user_id uuid not null default auth.uid(),
 routine_id uuid not null,
 local_date date not null,
 primary key(user_id,routine_id,local_date),
 foreign key(user_id,routine_id) references public.user_routines(user_id,id) on delete cascade
);
create index user_routine_realizations_owner_day_idx on public.user_routine_realizations(user_id,local_date);
alter table public.user_routine_realizations enable row level security;
revoke all on table public.user_routine_realizations from anon, authenticated;
grant select,insert on table public.user_routine_realizations to authenticated;
create policy routine_realization_owner_read on public.user_routine_realizations for select to authenticated using ((select auth.uid())=user_id);
create policy routine_realization_owner_insert on public.user_routine_realizations for insert to authenticated with check ((select auth.uid())=user_id and exists(select 1 from public.user_routines r where r.user_id=(select auth.uid()) and r.id=routine_id and r.archived_at is null));
comment on table public.user_routine_realizations is 'Minimal daily adherence only: no performance, dose results, duration, calories, or coach feedback.';
