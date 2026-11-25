-- Fix only the audit metadata for trimmed exercises; solver behavior was already correct.
create or replace function public.c4_trimmed_ids(p_before jsonb,p_after jsonb)
returns jsonb
language sql
immutable
as $$
  select coalesce(jsonb_agg(o.value->>'exercise_id'),'[]'::jsonb)
  from jsonb_array_elements(coalesce(p_before,'[]'::jsonb)) o
  where not exists(
    select 1 from jsonb_array_elements(coalesce(p_after,'[]'::jsonb)) a
    where a.value->>'exercise_id'=o.value->>'exercise_id'
  );
$$;;
