create or replace function public.seed_common_environment_equipment_presets_for_user(
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_environment_code text;
  v_source text;
  v_requested_ids text[];
begin
  if p_user_id is null then
    return;
  end if;

  foreach v_environment_code in array array['BOX','GYM']::text[]
  loop
    if exists (
      select 1
      from public.user_environment_equipment_preset_state s
      where s.user_id = p_user_id
        and s.environment_code = v_environment_code
    ) then
      continue;
    end if;

    if exists (
      select 1
      from public.user_environment_equipment_presets p
      where p.user_id = p_user_id
        and p.environment_code = v_environment_code
    ) then
      v_source := 'existing_preset';
    else
      if v_environment_code = 'BOX' then
        v_requested_ids := array[
          'E01','E02','E03','E04','E05','E07',
          'E09','E10','E14','E15','E17','E22'
        ]::text[];
      else
        v_requested_ids := array[
          'E01','E03','E04','E05','E08','E14',
          'E15','E16','E27','E28','E48'
        ]::text[];
      end if;

      insert into public.user_environment_equipment_presets (
        user_id,
        environment_code,
        equipment_id,
        created_at,
        updated_at
      )
      select
        p_user_id,
        v_environment_code,
        c.id,
        now(),
        now()
      from public.equipment_catalog_v2 c
      where c.id = any(v_requested_ids)
        and coalesce(c.exercise_count, 0) > 0
      on conflict (user_id, environment_code, equipment_id) do nothing;

      v_source := 'auto_common_v1';
    end if;

    insert into public.user_environment_equipment_preset_state (
      user_id,
      environment_code,
      initialized_at,
      initialization_source,
      updated_at
    ) values (
      p_user_id,
      v_environment_code,
      now(),
      v_source,
      now()
    )
    on conflict (user_id, environment_code) do nothing;
  end loop;
end;
$function$;

revoke all on function public.seed_common_environment_equipment_presets_for_user(uuid) from public, anon, authenticated;

create or replace function public.seed_common_environment_equipment_presets_on_profile_insert()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform public.seed_common_environment_equipment_presets_for_user(new.id);
  return new;
end;
$function$;

revoke all on function public.seed_common_environment_equipment_presets_on_profile_insert() from public, anon, authenticated;

drop trigger if exists seed_common_environment_equipment_presets_after_profile_insert on public.profiles;
create trigger seed_common_environment_equipment_presets_after_profile_insert
after insert on public.profiles
for each row
execute function public.seed_common_environment_equipment_presets_on_profile_insert();

do $block$
declare
  v_user record;
begin
  for v_user in select id from auth.users
  loop
    perform public.seed_common_environment_equipment_presets_for_user(v_user.id);
  end loop;
end;
$block$;
