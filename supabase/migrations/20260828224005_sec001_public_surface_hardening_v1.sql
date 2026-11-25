-- SEC-001: harden exposed public schema without changing authenticated app contracts.

-- 1) Public/read-only catalog tables: enable RLS and preserve the existing read audience only.
alter table public.exercise_catalog_releases enable row level security;
drop policy if exists exercise_catalog_releases_read on public.exercise_catalog_releases;
create policy exercise_catalog_releases_read on public.exercise_catalog_releases
for select to anon, authenticated using (true);

alter table public.performance_record_metric_catalog enable row level security;
drop policy if exists performance_record_metric_catalog_read on public.performance_record_metric_catalog;
create policy performance_record_metric_catalog_read on public.performance_record_metric_catalog
for select to authenticated using (true);

alter table public.outdoor_place_catalog_v1 enable row level security;
drop policy if exists outdoor_place_catalog_v1_read on public.outdoor_place_catalog_v1;
create policy outdoor_place_catalog_v1_read on public.outdoor_place_catalog_v1
for select to authenticated using (true);

alter table public.outdoor_conditioning_family_catalog_v1 enable row level security;
drop policy if exists outdoor_conditioning_family_catalog_v1_read on public.outdoor_conditioning_family_catalog_v1;
create policy outdoor_conditioning_family_catalog_v1_read on public.outdoor_conditioning_family_catalog_v1
for select to authenticated using (true);

alter table public.outdoor_street_exercise_catalog_v1 enable row level security;
drop policy if exists outdoor_street_exercise_catalog_v1_read on public.outdoor_street_exercise_catalog_v1;
create policy outdoor_street_exercise_catalog_v1_read on public.outdoor_street_exercise_catalog_v1
for select to authenticated using (true);

-- 2) User-scoped coach view must obey the querying user's RLS policies.
alter view public.user_exercise_coach_state set (security_invoker = true);

-- 3) Pin search_path on the exact legacy/helper functions reported by the advisor.
do $do$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname = any(array[
        'set_updated_at','propose_capability_update','session_hard_gate_candidates',
        'normalize_body_zone_ids','body_zone_terms_all_known','jsonb_num','num_clamp',
        'capability_confidence_from_evidence','capability_freshness_from_age',
        'propose_capability_state_update_core','capability_family_from_tracking',
        'build_capability_observation_inputs_pre_block_filter','apply_capability_observation',
        'propose_capability_state_update_b29','empty_capability_state','capability_state_snapshot',
        'c3_simulate_candidate_wod_raw','c3_simulate_candidate_wod',
        'shadow_capability_observation_from_state','shadow_capability_observation','shadow_capability_session',
        'sync_exercise_warmup_contract','session_stimulus_band','normalize_session_readiness',
        'c2_exercise_stimulus_proxy','build_session_stimulus_target','simulate_session_engine_c3',
        'c3_wod_budget_minutes','c4_legacy_inventory_from_equipment_names','c4_finalize_candidate_v15_base',
        'c4_prescription_text','c4_trimmed_ids','solve_session_engine_c4_raw_v15','c4_difficulty_rank_v1',
        'exercise_safe_for_zones','solve_session_engine_c4_mechanic_policy_shadow_v1','gym_intent_label_v1'
      ]::text[])
  loop
    execute format('alter function %s set search_path to public, pg_temp', r.sig);
  end loop;
end $do$;

-- 4) No SECURITY DEFINER business/helper RPC should be callable anonymously.
-- Preserve the pre-existing signed-in app contract explicitly.
do $do$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.prosecdef
      and has_function_privilege('anon',p.oid,'EXECUTE')
  loop
    execute format('revoke execute on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end $do$;