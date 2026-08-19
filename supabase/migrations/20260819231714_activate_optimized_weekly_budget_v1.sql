update public.session_engine_policy
set config = jsonb_set(
  config,
  '{program_coach}',
  coalesce(config->'program_coach','{}'::jsonb) || jsonb_build_object(
    'weekly_budget_mode','ACTIVE',
    'weekly_budget_scoring_version','program-coach-weekly-scoring-snapshot-v1',
    'weekly_budget_calculation_scope','once_per_candidate_pool',
    'weekly_budget_snapshot_reused',true,
    'weekly_budget_fallback','legacy_weekly_coherence_when_not_active'
  ),
  true
)
where policy_key='c4-final-default';
