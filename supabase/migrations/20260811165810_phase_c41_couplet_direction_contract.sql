-- Make ascending/descending couplet execution semantics explicit in the compiled protocol.
do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='c4_finalize_candidate'
  ) and not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='c4_finalize_candidate_c41_dispatch_base'
  ) then
    alter function public.c4_finalize_candidate(jsonb,jsonb,integer,integer,text,text)
      rename to c4_finalize_candidate_c41_dispatch_base;
  end if;
end $$;

create or replace function public.c4_finalize_candidate(
  p_candidate jsonb,
  p_stimulus jsonb,
  p_total_duration_minutes integer,
  p_exact_wod_minutes integer default null,
  p_c4_policy_key text default 'c4-final-default',
  p_c3_policy_key text default 'c3-sim-default'
)
returns jsonb
language plpgsql
stable
set search_path=public
as $$
declare
  v_result jsonb;
  v_mechanic text:=upper(coalesce(p_candidate->>'mechanic',''));
  v_variant text:=upper(coalesce(p_candidate->>'variant_key',''));
  v_rungs int;
  v_schedule jsonb:='[]'::jsonb;
  x jsonb;
  v_base int;v_inc int;v_first int;v_last int;
begin
  v_result:=public.c4_finalize_candidate_c41_dispatch_base(
    p_candidate,p_stimulus,p_total_duration_minutes,p_exact_wod_minutes,p_c4_policy_key,p_c3_policy_key
  );

  if v_mechanic='COUPLET' and v_variant in ('ASCENDING_COUPLET','DESCENDING_COUPLET') then
    v_rungs:=coalesce(nullif(v_result#>>'{c4_final,mechanic_json,parameters,rungs}','')::int,0);
    for x in select value from jsonb_array_elements(coalesce(v_result->'exercises','[]'::jsonb))
    loop
      v_base:=coalesce(nullif(x#>>'{prescription,mechanic_overlay,start_reps}','')::int,1);
      v_inc:=coalesce(nullif(x#>>'{prescription,mechanic_overlay,increment_reps}','')::int,1);
      if v_variant='DESCENDING_COUPLET' then
        v_first:=v_base+greatest(0,v_rungs-1)*v_inc;v_last:=v_base;
      else
        v_first:=v_base;v_last:=v_base+greatest(0,v_rungs-1)*v_inc;
      end if;
      v_schedule:=v_schedule||jsonb_build_array(jsonb_build_object(
        'exercise_id',x->>'exercise_id','base_reps',v_base,'increment_reps',v_inc,
        'first_stage_reps',v_first,'last_stage_reps',v_last
      ));
    end loop;
    v_result:=jsonb_set(v_result,'{c4_final,mechanic_json,parameters,sequence_direction}',
      to_jsonb(case when v_variant='DESCENDING_COUPLET' then 'descending' else 'ascending' end),true);
    v_result:=jsonb_set(v_result,'{c4_final,mechanic_json,parameters,per_exercise_schedule}',v_schedule,true);
    v_result:=jsonb_set(v_result,'{c4_final,mechanic_json,parameters,execution_rule}',
      to_jsonb(case when v_variant='DESCENDING_COUPLET' then 'start_at_highest_compiled_stage_then_subtract_each_exercise_increment_until_base' else 'start_at_each_exercise_base_then_add_its_increment_each_stage' end),true);
  end if;
  return v_result;
end;
$$;;
