-- Warm-up duration must represent the whole 3-round specific-preparation block,
-- not a compressed display budget. Restore the previously established V1
-- warm-up time floors while keeping Session Architecture V2 / Unlock separation.

update public.session_engine_policy
set config = jsonb_set(
  jsonb_set(
    jsonb_set(
      jsonb_set(
        jsonb_set(
          jsonb_set(
            jsonb_set(
              config,
              '{session_architecture_v2,durations,20,warmup_minutes}',
              '5'::jsonb,
              true
            ),
            '{session_architecture_v2,durations,30,warmup_minutes}',
            '5'::jsonb,
            true
          ),
          '{session_architecture_v2,durations,45,warmup_minutes}',
          '6'::jsonb,
          true
        ),
        '{session_architecture_v2,durations,60,warmup_minutes}',
        '6'::jsonb,
        true
      ),
      '{session_architecture_v2,durations,75,warmup_minutes}',
      '7'::jsonb,
      true
    ),
    '{session_architecture_v2,durations,90,warmup_minutes}',
    '7'::jsonb,
    true
  ),
  '{session_architecture_v2,warmup_budget_contract}',
  jsonb_build_object(
    'version','warmup-round-budget-v1',
    'rounds',3,
    'budget_includes_all_rounds',true,
    'duration_floor_source','RESTORED_EXISTING_V1_WARMUP_BUDGET',
    'short_session_minutes',5,
    'standard_session_minutes',6,
    'long_session_minutes',7,
    'frontend_must_display_block_total_not_per_round',true
  ),
  true
)
where policy_key='c4-final-default';
