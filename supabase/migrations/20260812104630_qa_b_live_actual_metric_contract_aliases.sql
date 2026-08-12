create or replace function public.build_capability_observation_inputs(
  p_exercise_log_id bigint,
  p_quality_policy_key text default 'b2.6-adapter-draft-1'::text
)
returns jsonb
language plpgsql
stable
set search_path to 'public'
as $function$
declare
  v_result jsonb;
  v_block text;
  v_actual jsonb;
begin
  v_result:=public.build_capability_observation_inputs_pre_block_filter(p_exercise_log_id,p_quality_policy_key);

  -- Canonicalize live completion metrics for the capability engine while
  -- preserving the public/logging contract fields.
  v_actual:=coalesce(v_result->'actual','{}'::jsonb);
  if not (v_actual ? 'reps') and v_actual ? 'reps_completed' then
    v_actual:=jsonb_set(v_actual,'{reps}',v_actual->'reps_completed',true);
  end if;
  if not (v_actual ? 'load_kg') and v_actual ? 'weight_kg' then
    v_actual:=jsonb_set(v_actual,'{load_kg}',v_actual->'weight_kg',true);
  end if;
  v_result:=jsonb_set(v_result,'{actual}',v_actual,true);
  v_result:=jsonb_set(v_result,'{observation_context,metric_alias_contract}',to_jsonb('reps_completed->reps|weight_kg->load_kg'::text),true);

  select lower(coalesce(wse.block_key,'')) into v_block
  from public.exercise_logs el
  left join public.workout_session_exercises wse on wse.id=el.session_exercise_id
  where el.id=p_exercise_log_id;

  if v_block in ('warmup','warm_up','tabata') then
    v_result:=jsonb_set(v_result,'{excluded}','true'::jsonb,true);
    v_result:=jsonb_set(v_result,'{capability_eligible}','false'::jsonb,true);
    v_result:=jsonb_set(v_result,'{observation_role}',to_jsonb('CONTEXT_ONLY'::text),true);
    v_result:=jsonb_set(v_result,'{exclusion_reason}',to_jsonb('BLOCK_NOT_EXERCISE_CAPABILITY_ELIGIBLE'::text),true);
    v_result:=jsonb_set(v_result,'{updates}','[]'::jsonb,true);
    v_result:=jsonb_set(v_result,'{observation_context,capability_block_policy}',to_jsonb('warmup_tabata_history_only'::text),true);
  end if;

  return v_result;
end;
$function$;;
