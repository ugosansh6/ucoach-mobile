do $$
declare
  r record;
begin
  for r in
    select p.oid,p.proname,pg_get_function_identity_arguments(p.oid) args
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.prosecdef
      and (
        p.proname like '%\_pre\_%' escape '\'
        or p.prorettype='trigger'::regtype
        or p.proname in (
          'c4_apply_local_fatigue_complement_v1',
          'c4_apply_mastery_progression_v1',
          'c4_apply_pattern_complement_plan_v1',
          'c4_apply_skill_curriculum_v1',
          'c4_apply_skill_curriculum_v2',
          'c4_best_reduced_wod_mechanic_v1',
          'c4_compile_reduced_wod_for_mechanic_v1',
          'c4_detach_recompiled_wod_instance_v1',
          'c4_reinvest_available_time_v1',
          'c4_session_wod_local_fatigue_swap_allowed_v1',
          'c4_tabata_variety_penalty_v1',
          'c4_tabata_variety_penalty_v2',
          'c4_warmup_candidate_for_target_v1',
          'd_sync_session_pattern_ledger_v1',
          'd_sync_session_stimulus_ledger',
          'gym_compile_strength_runtime_v2',
          'gym_expected_stimulus_v1',
          'm89_refresh_distinct_exposure_counts',
          'outdoor_enrich_protocol_outcome_v1',
          'outdoor_generate_session_runtime_v1',
          'session_exercise_execution_factor_v2',
          'session_original_block_execution_factor_v1'
        )
      )
  loop
    execute format('revoke all on function public.%I(%s) from public',r.proname,r.args);
    execute format('revoke all on function public.%I(%s) from anon',r.proname,r.args);
    execute format('revoke all on function public.%I(%s) from authenticated',r.proname,r.args);
  end loop;
end;
$$;