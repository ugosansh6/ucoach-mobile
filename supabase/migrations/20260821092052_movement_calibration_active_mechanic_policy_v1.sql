create or replace function public.solve_session_engine_c4_mechanic_policy_shadow_full_v1(
  p_user_id uuid,
  p_focus text,
  p_duration_minutes integer,
  p_readiness text,
  p_target_region text default null::text,
  p_progression_intent text default null::text,
  p_zone_terms text[] default '{}'::text[],
  p_inventory jsonb default '[]'::jsonb,
  p_max_complexity integer default 3,
  p_max_difficulty text default 'Intermédiaire'::text,
  p_candidate_count integer default 10,
  p_exact_wod_minutes integer default null::integer,
  p_policy_key text default 'c4-final-default'::text
)
returns jsonb
language plpgsql
stable
set search_path to 'public'
as $function$
declare
  r jsonb;
begin
  r:=public.solve_session_engine_c4_pre_mechanic_freshness_v1(
    p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
    p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty,p_candidate_count,p_exact_wod_minutes,p_policy_key
  );
  r:=public.c4_apply_mechanic_freshness_tiebreak_v1(p_user_id,r,p_policy_key);
  r:=public.c4_apply_movement_calibration_tiebreak_v1(p_user_id,r,p_progression_intent,p_policy_key);
  return jsonb_set(r,'{version}','"c4-final-v1.11-w1-calibration-mechanic-policy"'::jsonb,true);
end;
$function$;