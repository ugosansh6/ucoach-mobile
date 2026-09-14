create table if not exists public.user_environment_equipment_preset_state (
  user_id uuid not null references auth.users(id) on delete cascade,
  environment_code text not null check (environment_code in ('HOME','BOX','GYM','OUTDOOR')),
  initialized_at timestamptz not null default now(),
  initialization_source text not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, environment_code)
);

alter table public.user_environment_equipment_preset_state enable row level security;

drop policy if exists "user_environment_equipment_preset_state_select_own" on public.user_environment_equipment_preset_state;
create policy "user_environment_equipment_preset_state_select_own"
on public.user_environment_equipment_preset_state
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "user_environment_equipment_preset_state_insert_own" on public.user_environment_equipment_preset_state;
create policy "user_environment_equipment_preset_state_insert_own"
on public.user_environment_equipment_preset_state
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "user_environment_equipment_preset_state_update_own" on public.user_environment_equipment_preset_state;
create policy "user_environment_equipment_preset_state_update_own"
on public.user_environment_equipment_preset_state
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "user_environment_equipment_preset_state_delete_own" on public.user_environment_equipment_preset_state;
create policy "user_environment_equipment_preset_state_delete_own"
on public.user_environment_equipment_preset_state
for delete
to authenticated
using (auth.uid() = user_id);

create or replace function public.ensure_user_environment_equipment_preset(
  p_environment_code text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user_id uuid := auth.uid();
  v_environment_code text := upper(trim(coalesce(p_environment_code, '')));
  v_source text;
  v_requested_ids text[] := '{}'::text[];
  v_result text[] := '{}'::text[];
  v_initialized_now boolean := false;
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

  select s.initialization_source
  into v_source
  from public.user_environment_equipment_preset_state s
  where s.user_id = v_user_id
    and s.environment_code = v_environment_code;

  if found then
    select coalesce(array_agg(p.equipment_id::text order by p.equipment_id), '{}'::text[])
    into v_result
    from public.user_environment_equipment_presets p
    where p.user_id = v_user_id
      and p.environment_code = v_environment_code;

    return jsonb_build_object(
      'environment_code', v_environment_code,
      'equipment_ids', to_jsonb(v_result),
      'initialized_now', false,
      'source', v_source
    );
  end if;

  select coalesce(array_agg(p.equipment_id::text order by p.equipment_id), '{}'::text[])
  into v_result
  from public.user_environment_equipment_presets p
  where p.user_id = v_user_id
    and p.environment_code = v_environment_code;

  if cardinality(v_result) > 0 then
    insert into public.user_environment_equipment_preset_state (
      user_id, environment_code, initialized_at, initialization_source, updated_at
    ) values (
      v_user_id, v_environment_code, now(), 'existing_preset', now()
    )
    on conflict (user_id, environment_code) do nothing;

    return jsonb_build_object(
      'environment_code', v_environment_code,
      'equipment_ids', to_jsonb(v_result),
      'initialized_now', false,
      'source', 'existing_preset'
    );
  end if;

  if v_environment_code = 'BOX' then
    v_requested_ids := array[
      'E01','E02','E03','E04','E05','E07',
      'E09','E10','E14','E15','E17','E22'
    ]::text[];
    v_source := 'auto_common_v1';
  elsif v_environment_code = 'GYM' then
    v_requested_ids := array[
      'E01','E03','E04','E05','E08','E14',
      'E15','E16','E27','E28','E48'
    ]::text[];
    v_source := 'auto_common_v1';
  else
    v_requested_ids := '{}'::text[];
    v_source := 'empty_v1';
  end if;

  if cardinality(v_requested_ids) > 0 then
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
      c.id,
      now(),
      now()
    from public.equipment_catalog_v2 c
    where c.id = any(v_requested_ids)
      and coalesce(c.exercise_count, 0) > 0
    on conflict (user_id, environment_code, equipment_id) do nothing;
  end if;

  insert into public.user_environment_equipment_preset_state (
    user_id, environment_code, initialized_at, initialization_source, updated_at
  ) values (
    v_user_id, v_environment_code, now(), v_source, now()
  )
  on conflict (user_id, environment_code) do update
  set initialization_source = excluded.initialization_source,
      updated_at = now();

  select coalesce(array_agg(p.equipment_id::text order by p.equipment_id), '{}'::text[])
  into v_result
  from public.user_environment_equipment_presets p
  where p.user_id = v_user_id
    and p.environment_code = v_environment_code;

  v_initialized_now := v_source = 'auto_common_v1' and cardinality(v_result) > 0;

  return jsonb_build_object(
    'environment_code', v_environment_code,
    'equipment_ids', to_jsonb(v_result),
    'initialized_now', v_initialized_now,
    'source', v_source
  );
end;
$function$;

grant execute on function public.ensure_user_environment_equipment_preset(text) to authenticated;

create or replace function public.replace_user_environment_equipment_preset(
  p_environment_code text,
  p_equipment_ids text[] default '{}'::text[]
)
returns text[]
language plpgsql
security definer
set search_path to 'public'
as $function$
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

  insert into public.user_environment_equipment_preset_state (
    user_id, environment_code, initialized_at, initialization_source, updated_at
  ) values (
    v_user_id, v_environment_code, now(), 'manual', now()
  )
  on conflict (user_id, environment_code) do update
  set initialization_source = 'manual',
      updated_at = now();

  select coalesce(array_agg(p.equipment_id::text order by p.equipment_id), '{}'::text[])
  into v_result
  from public.user_environment_equipment_presets p
  where p.user_id = v_user_id
    and p.environment_code = v_environment_code;

  return v_result;
end;
$function$;

grant execute on function public.replace_user_environment_equipment_preset(text, text[]) to authenticated;
