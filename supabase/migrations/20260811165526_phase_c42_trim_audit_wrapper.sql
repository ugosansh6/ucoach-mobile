do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='c4_expand_candidate_to_block_rules'
  ) and not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='c4_expand_candidate_to_block_rules_c42_base'
  ) then
    alter function public.c4_expand_candidate_to_block_rules(jsonb,uuid,text,integer,text,text,text,text[],jsonb,integer,text)
      rename to c4_expand_candidate_to_block_rules_c42_base;
  end if;
end $$;

create or replace function public.c4_expand_candidate_to_block_rules(
  p_candidate jsonb,
  p_user_id uuid,
  p_focus text,
  p_duration_minutes integer,
  p_readiness text,
  p_target_region text,
  p_progression_intent text,
  p_zone_terms text[],
  p_inventory jsonb,
  p_max_complexity integer,
  p_max_difficulty text
)
returns jsonb
language plpgsql
stable
set search_path=public
as $$
declare v_result jsonb;v_trimmed jsonb;
begin
  v_result:=public.c4_expand_candidate_to_block_rules_c42_base(
    p_candidate,p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
    p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty
  );
  v_trimmed:=public.c4_trimmed_ids(coalesce(p_candidate->'exercises','[]'::jsonb),coalesce(v_result->'exercises','[]'::jsonb));
  if coalesce((v_result#>>'{c4_block_rules,rule_found}')::boolean,false) then
    v_result:=jsonb_set(v_result,'{c4_block_rules,trimmed_exercise_ids}',v_trimmed,true);
  end if;
  return v_result;
end;
$$;;
