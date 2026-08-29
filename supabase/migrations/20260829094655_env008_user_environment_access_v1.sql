revoke execute on function public.program_coach_programming_diagnostic_v1(uuid,date) from authenticated;

create table if not exists public.user_environment_access (
  user_id uuid not null references public.profiles(id) on delete cascade,
  environment_code text not null references public.session_environment_catalog(environment_code),
  access_level text not null,
  source text not null default 'USER_PROFILE',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, environment_code),
  constraint user_environment_access_level_check
    check (access_level in ('PRIMARY','REGULAR','OCCASIONAL','NEVER'))
);

create unique index if not exists user_environment_access_one_primary_idx
  on public.user_environment_access(user_id)
  where access_level='PRIMARY';

create index if not exists user_environment_access_user_level_idx
  on public.user_environment_access(user_id, access_level);

alter table public.user_environment_access enable row level security;

create policy "user_environment_access_select_own"
  on public.user_environment_access for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "user_environment_access_insert_own"
  on public.user_environment_access for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "user_environment_access_update_own"
  on public.user_environment_access for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "user_environment_access_delete_own"
  on public.user_environment_access for delete to authenticated
  using ((select auth.uid()) = user_id);

create trigger user_environment_access_set_updated_at
before update on public.user_environment_access
for each row execute function public.set_updated_at();

create or replace function public.program_coach_environment_access_v1(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_rows jsonb := '[]'::jsonb;
  v_declared int := 0;
  v_primary text := null;
  v_accessible jsonb := '[]'::jsonb;
  v_never jsonb := '[]'::jsonb;
begin
  if p_user_id is null then raise exception 'User required'; end if;
  if auth.uid() is not null and auth.uid() <> p_user_id then raise exception 'Forbidden user'; end if;

  select
    coalesce(jsonb_agg(jsonb_build_object(
      'environment_code',c.environment_code,'label_fr',c.label_fr,
      'access_level',coalesce(a.access_level,'UNDECLARED'),'declared',a.user_id is not null,
      'source',a.source,'updated_at',a.updated_at
    ) order by c.sort_order),'[]'::jsonb),
    count(a.user_id)::int,
    max(a.environment_code) filter(where a.access_level='PRIMARY')
  into v_rows,v_declared,v_primary
  from public.session_environment_catalog c
  left join public.user_environment_access a
    on a.environment_code=c.environment_code and a.user_id=p_user_id
  where c.active;

  select coalesce(jsonb_agg(x->>'environment_code' order by x->>'environment_code'),'[]'::jsonb)
  into v_accessible from jsonb_array_elements(v_rows) x
  where x->>'access_level' in ('PRIMARY','REGULAR','OCCASIONAL');

  select coalesce(jsonb_agg(x->>'environment_code' order by x->>'environment_code'),'[]'::jsonb)
  into v_never from jsonb_array_elements(v_rows) x
  where x->>'access_level'='NEVER';

  return jsonb_build_object(
    'version','program-coach-environment-access-v1',
    'status',case when v_declared=0 then 'UNDECLARED' else 'DECLARED' end,
    'primary_environment',v_primary,
    'environments',v_rows,
    'accessible_environment_codes',v_accessible,
    'never_environment_codes',v_never,
    'semantics',jsonb_build_object(
      'never_is_not_recommended',true,
      'occasional_is_opportunity_not_requirement',true,
      'undeclared_does_not_invent_access',true,
      'session_selected_environment_remains_separate',true,
      'equipment_is_not_inferred_from_access_level',true
    )
  );
end;
$$;

revoke all on function public.program_coach_environment_access_v1(uuid) from public;
revoke all on function public.program_coach_environment_access_v1(uuid) from anon;
revoke all on function public.program_coach_environment_access_v1(uuid) from authenticated;

create or replace function public.replace_my_environment_access_v1(p_rows jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_row jsonb;
  v_env text;
  v_level text;
  v_primary_count int := 0;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then raise exception 'p_rows must be a JSON array'; end if;

  select count(*)::int into v_primary_count
  from jsonb_array_elements(p_rows) x
  where upper(coalesce(x->>'access_level',''))='PRIMARY';
  if v_primary_count > 1 then raise exception 'Only one PRIMARY environment is allowed'; end if;

  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    v_env := upper(nullif(v_row->>'environment_code',''));
    v_level := upper(nullif(v_row->>'access_level',''));
    if v_env is null or not exists(
      select 1 from public.session_environment_catalog where environment_code=v_env and active
    ) then raise exception 'Unknown or inactive environment: %',coalesce(v_env,'NULL'); end if;
    if v_level not in ('PRIMARY','REGULAR','OCCASIONAL','NEVER') then
      raise exception 'Invalid access level for %: %',v_env,coalesce(v_level,'NULL');
    end if;
  end loop;

  delete from public.user_environment_access where user_id=v_user;
  insert into public.user_environment_access(user_id,environment_code,access_level,source,notes)
  select v_user,upper(x->>'environment_code'),upper(x->>'access_level'),
         coalesce(nullif(x->>'source',''),'USER_PROFILE'),nullif(x->>'notes','')
  from jsonb_array_elements(p_rows) x;

  return public.program_coach_environment_access_v1(v_user);
end;
$$;

revoke all on function public.replace_my_environment_access_v1(jsonb) from public;
revoke all on function public.replace_my_environment_access_v1(jsonb) from anon;
grant execute on function public.replace_my_environment_access_v1(jsonb) to authenticated;
