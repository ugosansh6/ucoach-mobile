-- C4 metadata coherence: keep the canonical public solver version aligned with the finalizer/policy.
alter function public.solve_session_engine_c4(uuid,text,integer,text,text,text,text[],jsonb,integer,text,integer,integer,text)
rename to solve_session_engine_c4_raw_v15;

create or replace function public.solve_session_engine_c4(
  p_user_id uuid,
  p_focus text,
  p_duration_minutes integer,
  p_readiness text,
  p_target_region text default null,
  p_progression_intent text default null,
  p_zone_terms text[] default '{}'::text[],
  p_inventory jsonb default '[]'::jsonb,
  p_max_complexity integer default 3,
  p_max_difficulty text default 'Intermédiaire',
  p_candidate_count integer default 10,
  p_exact_wod_minutes integer default null,
  p_policy_key text default 'c4-final-default'
)
returns jsonb
language sql
stable
as $$
  select jsonb_set(
    public.solve_session_engine_c4_raw_v15(
      p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
      p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty,p_candidate_count,
      p_exact_wod_minutes,p_policy_key
    ),
    '{version}',
    '"c4-final-v1.5"'::jsonb,
    true
  );
$$;

comment on function public.solve_session_engine_c4(uuid,text,integer,text,text,text,text[],jsonb,integer,text,integer,integer,text)
is 'Canonical C4 Session Engine solver v1.5. Read-only: final C1+C2+C3+C4 selection, quality gates and anti-redundancy; no workout persistence.';;
