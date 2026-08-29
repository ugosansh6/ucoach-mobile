create or replace function public.canonical_execution_block_key_v1(p_block_key text)
returns text
language sql
immutable
set search_path=public
as $$
  select case lower(replace(replace(coalesce(p_block_key,''),'-','_'),' ',''))
    when 'unlock' then 'unlock'
    when 'warmup' then 'warmup'
    when 'warm_up' then 'warmup'
    when 'tabata' then 'tabata'
    when 'tabata_abs' then 'tabata'
    when 'core' then 'tabata'
    when 'skill' then 'skill'
    when 'gym' then 'skill'
    when 'street_gym' then 'skill'
    when 'streetgym' then 'skill'
    when 'wod' then 'wod'
    when 'conditioning' then 'wod'
    when 'strength' then 'wod'
    when 'cardio' then 'wod'
    when 'external' then 'wod'
    else lower(replace(replace(coalesce(p_block_key,''),'-','_'),' ',''))
  end
$$;

comment on function public.canonical_execution_block_key_v1(text) is
  'Canonical execution block key. External imported work is runtime WOD-equivalent for execution-factor matching while retaining external source provenance elsewhere.';
