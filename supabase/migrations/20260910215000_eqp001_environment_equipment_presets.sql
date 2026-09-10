create table if not exists public.user_environment_equipment_presets (
  user_id uuid not null references auth.users(id) on delete cascade,
  environment_code text not null references public.session_environment_catalog(environment_code),
  equipment_id varchar not null references public.equipment(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, environment_code, equipment_id),
  constraint user_environment_equipment_presets_environment_check
    check (environment_code in ('HOME','BOX','GYM','OUTDOOR'))
);

create index if not exists user_environment_equipment_presets_user_env_idx
  on public.user_environment_equipment_presets(user_id, environment_code);

alter table public.user_environment_equipment_presets enable row level security;

drop policy if exists user_environment_equipment_presets_select_own
  on public.user_environment_equipment_presets;
create policy user_environment_equipment_presets_select_own
  on public.user_environment_equipment_presets
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists user_environment_equipment_presets_insert_own
  on public.user_environment_equipment_presets;
create policy user_environment_equipment_presets_insert_own
  on public.user_environment_equipment_presets
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists user_environment_equipment_presets_update_own
  on public.user_environment_equipment_presets;
create policy user_environment_equipment_presets_update_own
  on public.user_environment_equipment_presets
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists user_environment_equipment_presets_delete_own
  on public.user_environment_equipment_presets;
create policy user_environment_equipment_presets_delete_own
  on public.user_environment_equipment_presets
  for delete to authenticated
  using ((select auth.uid()) = user_id);

create or replace function public.replace_user_environment_equipment_preset(
  p_environment_code text,
  p_equipment_ids text[] default '{}'::text[]
)
returns text[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_environment_code text := upper(trim(coalesce(p_environment_code, '')));
  v_ids text[] := coalesce(p_equipment_ids, '{}'::text[]);
  v_result text[];
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if v_environment_code not in ('HOME','BOX','GYM','OUTDOOR') then
    raise exception 'Unsupported environment: %', v_environment_code;
  end if;

  if not exists (
    select 1
    from public.session_environment_catalog sec
    where sec.environment_code = v_environment_code
      and sec.active = true
  ) then
    raise exception 'Inactive environment: %', v_environment_code;
  end if;

  if exists (
    select 1
    from unnest(v_ids) as requested(equipment_id)
    where requested.equipment_id is null
       or trim(requested.equipment_id) = ''
       or not exists (
         select 1 from public.equipment e
         where e.id = requested.equipment_id
       )
  ) then
    raise exception 'Unknown equipment in preset';
  end if;

  delete from public.user_environment_equipment_presets p
  where p.user_id = v_user_id
    and p.environment_code = v_environment_code;

  insert into public.user_environment_equipment_presets (
    user_id,
    environment_code,
    equipment_id,
    created_at,
    updated_at
  )
  select
    v_user_id,
    v_environment_code,
    requested.equipment_id,
    now(),
    now()
  from (
    select distinct trim(value) as equipment_id
    from unnest(v_ids) as t(value)
    where value is not null and trim(value) <> '' and trim(value) <> 'E00'
  ) requested;

  select coalesce(array_agg(p.equipment_id::text order by p.equipment_id), '{}'::text[])
  into v_result
  from public.user_environment_equipment_presets p
  where p.user_id = v_user_id
    and p.environment_code = v_environment_code;

  return v_result;
end;
$$;

grant execute on function public.replace_user_environment_equipment_preset(text, text[]) to authenticated;

comment on table public.user_environment_equipment_presets is
  'EQP-001: habitual equipment availability per user and training environment. Session-day Preparation overrides are not persisted here.';
comment on function public.replace_user_environment_equipment_preset(text, text[]) is
  'Atomically replaces the authenticated user habitual equipment preset for one environment.';