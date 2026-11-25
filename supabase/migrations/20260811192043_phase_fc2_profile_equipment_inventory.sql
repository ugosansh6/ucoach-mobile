-- F-C2: durable profile equipment inventory with optional unknown loads and atomic replacement

alter table public.user_equipment_inventory
  drop constraint if exists user_equipment_inventory_inventory_mode_check;

alter table public.user_equipment_inventory
  add constraint user_equipment_inventory_inventory_mode_check
  check (inventory_mode = any (array['non_load'::text,'load_unknown'::text,'fixed_load'::text,'adjustable_load'::text]));

alter table public.user_equipment_inventory
  drop constraint if exists user_equipment_inventory_check;

alter table public.user_equipment_inventory
  add constraint user_equipment_inventory_check
  check (
    ((inventory_mode in ('non_load','load_unknown')) and load_kg is null and min_load_kg is null and max_load_kg is null and increment_kg is null)
    or
    ((inventory_mode='fixed_load') and load_kg is not null and load_kg>0 and min_load_kg is null and max_load_kg is null and increment_kg is null)
    or
    ((inventory_mode='adjustable_load') and min_load_kg is not null and max_load_kg is not null and min_load_kg>0 and max_load_kg>=min_load_kg and increment_kg is not null and increment_kg>0 and load_kg is null)
  );

create or replace function public.resolve_user_equipment_inventory(
  p_user_id uuid,
  p_selected_names text[],
  p_policy_key text default 'c4-final-default'
)
returns jsonb
language plpgsql
stable
set search_path = public
as $function$
declare
  v_cfg jsonb;
  v_result jsonb;
begin
  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'Cannot resolve another user equipment inventory';
  end if;

  select config into v_cfg
  from public.session_engine_policy
  where policy_key = p_policy_key;

  if v_cfg is null then
    raise exception 'Unknown Session Engine policy %', p_policy_key;
  end if;

  with requested as (
    select distinct e.id as equipment_id, e.name
    from unnest(coalesce(p_selected_names, '{}'::text[])) as selected(name)
    join public.equipment e
      on lower(trim(e.name)) = lower(trim(selected.name))
      or lower(trim(e.id)) = lower(trim(selected.name))
  ),
  user_rows as (
    select u.id,u.equipment_id,u.inventory_mode,u.quantity,u.load_kg,u.min_load_kg,u.max_load_kg,u.increment_kg,u.resistance_label,u.notes
    from public.user_equipment_inventory u
    join requested r on r.equipment_id=u.equipment_id
    where u.user_id=p_user_id and u.active=true
  ),
  equipment_with_real_inventory as (
    select distinct equipment_id from user_rows
  ),
  fallback_rows as (
    select r.equipment_id,
      coalesce(
        (v_cfg #>> array['legacy_inventory_defaults',r.equipment_id])::integer,
        (v_cfg #>> '{legacy_inventory_defaults,default}')::integer,
        1
      ) as quantity
    from requested r
    where not exists (
      select 1 from equipment_with_real_inventory x where x.equipment_id=r.equipment_id
    )
  ),
  combined as (
    select
      u.equipment_id,u.inventory_mode,u.quantity,u.load_kg,u.min_load_kg,u.max_load_kg,u.increment_kg,u.resistance_label,
      'user_inventory'::text as source,
      case
        when u.inventory_mode in ('fixed_load','adjustable_load') then 'confirmed'
        when u.inventory_mode='load_unknown' then 'unknown'
        else 'not_applicable'
      end::text as load_confidence
    from user_rows u

    union all

    select
      f.equipment_id,'load_unknown'::text,f.quantity,
      null::numeric,null::numeric,null::numeric,null::numeric,null::text,
      'legacy_equipment_selection'::text,'unknown'::text
    from fallback_rows f
  )
  select coalesce(
    jsonb_agg(
      jsonb_strip_nulls(
        jsonb_build_object(
          'equipment_id',equipment_id,
          'inventory_mode',inventory_mode,
          'quantity',quantity,
          'load_kg',load_kg,
          'min_load_kg',min_load_kg,
          'max_load_kg',max_load_kg,
          'increment_kg',increment_kg,
          'resistance_label',resistance_label,
          'source',source,
          'load_confidence',load_confidence
        )
      )
      order by equipment_id, load_kg nulls first, min_load_kg nulls first
    ),
    '[]'::jsonb
  ) into v_result
  from combined;

  return v_result;
end;
$function$;

create or replace function public.exercise_equipment_compatible(
  p_exercise_id character varying,
  p_inventory jsonb
)
returns boolean
language sql
stable
set search_path = public
as $function$
  with inventory_rows as (
    select
      item->>'equipment_id' as equipment_id,
      coalesce(nullif(item->>'inventory_mode',''),'non_load') as inventory_mode,
      greatest(coalesce(nullif(item->>'quantity','')::integer,0),0) as quantity,
      case
        when coalesce(nullif(item->>'inventory_mode',''),'non_load')='fixed_load'
          then 'fixed:'||coalesce(item->>'load_kg','unknown')
        when coalesce(nullif(item->>'inventory_mode',''),'non_load')='adjustable_load'
          then 'adjustable:'||coalesce(item->>'min_load_kg','unknown')||':'||coalesce(item->>'max_load_kg','unknown')||':'||coalesce(item->>'increment_kg','unknown')
        when coalesce(nullif(item->>'inventory_mode',''),'non_load')='load_unknown'
          then 'load_unknown'
        else 'non_load'
      end as load_signature
    from jsonb_array_elements(
      case when jsonb_typeof(coalesce(p_inventory,'[]'::jsonb))='array'
        then coalesce(p_inventory,'[]'::jsonb)
        else '[]'::jsonb
      end
    ) item
  ),
  inventory_totals as (
    select equipment_id,sum(quantity)::integer as quantity
    from inventory_rows
    where equipment_id is not null
    group by equipment_id
  ),
  inventory_load_groups as (
    select equipment_id,load_signature,sum(quantity)::integer as quantity
    from inventory_rows
    where equipment_id is not null
    group by equipment_id,load_signature
  ),
  requirements as (
    select
      requirement.option_group,
      requirement.equipment_id,
      requirement.min_quantity,
      greatest(requirement.min_quantity,coalesce(max(load_semantics.expected_implement_count),1)) as required_implement_count,
      coalesce(bool_or(load_semantics.symmetric_load),false) as symmetric_load
    from public.exercise_equipment_requirements_v2 requirement
    left join public.exercise_load_semantics load_semantics
      on load_semantics.exercise_id=requirement.exercise_id
     and load_semantics.equipment_id=requirement.equipment_id
    where requirement.exercise_id=p_exercise_id
      and requirement.is_optional=false
    group by requirement.option_group,requirement.equipment_id,requirement.min_quantity
  ),
  requirement_evaluation as (
    select
      requirement.option_group,
      requirement.equipment_id,
      case
        when requirement.symmetric_load=true and requirement.required_implement_count>1
          then exists (
            select 1 from inventory_load_groups inventory_group
            where inventory_group.equipment_id=requirement.equipment_id
              and inventory_group.quantity>=requirement.required_implement_count
          )
        else coalesce((
          select inventory.quantity from inventory_totals inventory
          where inventory.equipment_id=requirement.equipment_id
        ),0)>=requirement.min_quantity
      end as equipment_ok
    from requirements requirement
  ),
  required_groups as (
    select option_group,bool_and(equipment_ok) as group_ok
    from requirement_evaluation
    group by option_group
  )
  select case
    when not exists (
      select 1 from public.exercise_equipment_requirements_v2 requirement
      where requirement.exercise_id=p_exercise_id and requirement.is_optional=false
    ) then true
    else coalesce((select bool_or(group_ok) from required_groups),false)
  end;
$function$;

create or replace function public.replace_user_equipment_inventory(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_user_id uuid := auth.uid();
  v_result jsonb;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if jsonb_typeof(coalesce(p_rows,'[]'::jsonb)) <> 'array' then
    raise exception 'p_rows must be a JSON array';
  end if;

  delete from public.user_equipment_inventory
  where user_id=v_user_id;

  insert into public.user_equipment_inventory (
    user_id,equipment_id,inventory_mode,quantity,load_kg,min_load_kg,max_load_kg,increment_kg,resistance_label,active,notes
  )
  select
    v_user_id,
    nullif(trim(row->>'equipment_id'),'')::varchar,
    coalesce(nullif(trim(row->>'inventory_mode'),''),'non_load'),
    greatest(coalesce(nullif(row->>'quantity','')::integer,1),1)::smallint,
    nullif(row->>'load_kg','')::numeric,
    nullif(row->>'min_load_kg','')::numeric,
    nullif(row->>'max_load_kg','')::numeric,
    nullif(row->>'increment_kg','')::numeric,
    nullif(trim(row->>'resistance_label'),''),
    true,
    nullif(trim(row->>'notes'),'')
  from jsonb_array_elements(coalesce(p_rows,'[]'::jsonb)) row
  where nullif(trim(row->>'equipment_id'),'') is not null;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id',id,
        'equipment_id',equipment_id,
        'inventory_mode',inventory_mode,
        'quantity',quantity,
        'load_kg',load_kg,
        'min_load_kg',min_load_kg,
        'max_load_kg',max_load_kg,
        'increment_kg',increment_kg,
        'resistance_label',resistance_label,
        'active',active,
        'notes',notes
      ) order by equipment_id,load_kg nulls first,min_load_kg nulls first
    ),
    '[]'::jsonb
  ) into v_result
  from public.user_equipment_inventory
  where user_id=v_user_id and active=true;

  return v_result;
end;
$function$;

revoke all on function public.replace_user_equipment_inventory(jsonb) from public;
revoke all on function public.replace_user_equipment_inventory(jsonb) from anon;
grant execute on function public.replace_user_equipment_inventory(jsonb) to authenticated;;
