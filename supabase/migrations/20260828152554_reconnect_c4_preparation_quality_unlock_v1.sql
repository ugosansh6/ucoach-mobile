-- Reconnect the existing preparation-v1.1 quality pass after final Skill/WOD selection.
-- This keeps Unlock mobility-first, low-fatigue, pain/equipment safe and anti-repetitive.

CREATE OR REPLACE FUNCTION public.c4_plan_full_session(
  p_user_id uuid,
  p_focus text,
  p_duration_minutes integer,
  p_readiness text,
  p_target_region text DEFAULT NULL::text,
  p_progression_intent text DEFAULT NULL::text,
  p_zone_terms text[] DEFAULT '{}'::text[],
  p_inventory jsonb DEFAULT '[]'::jsonb,
  p_max_complexity integer DEFAULT 3,
  p_max_difficulty text DEFAULT 'Intermédiaire'::text,
  p_candidate_count integer DEFAULT 12,
  p_policy_key text DEFAULT 'c4-final-default'::text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
declare
  v_plan jsonb;
  v_challenge jsonb;
  v_gate jsonb;
  v_wod_minutes int:=0;
  v_exercise_count int:=0;
  v_session_intent text:='CLASSIC';
begin
  v_plan := public.c4_plan_full_session_pre_skill_focus_v1(
    p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
    p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty,p_candidate_count,p_policy_key
  );
  if coalesce(v_plan->>'status','')<>'READY' then return v_plan; end if;

  v_plan := public.c4_apply_mastery_progression_v1(
    p_user_id,v_plan,p_zone_terms,p_inventory,p_max_complexity,p_progression_intent,p_readiness
  );
  if coalesce(v_plan->>'status','')<>'READY' then return v_plan; end if;

  v_plan := public.c4_apply_skill_curriculum_v3(
    p_user_id,v_plan,p_zone_terms,p_inventory,p_max_complexity,p_progression_intent,p_readiness
  );
  if coalesce(v_plan->>'status','')<>'READY' then return v_plan; end if;

  v_plan:=public.c4_finalize_skill_path_preparation_metadata_v1(v_plan);

  v_plan:=public.c4_apply_preparation_quality_v2(
    p_user_id,v_plan,p_zone_terms,p_inventory,p_target_region,p_max_complexity,p_progression_intent
  );
  if coalesce(v_plan->>'status','')<>'READY' then return v_plan; end if;

  select coalesce(nullif(b->>'duration_minutes','')::int,0),jsonb_array_length(coalesce(b->'exercises','[]'::jsonb))
  into v_wod_minutes,v_exercise_count
  from jsonb_array_elements(coalesce(v_plan->'blocks','[]'::jsonb)) b
  where b->>'block_key'='wod' limit 1;

  v_session_intent:=upper(coalesce(v_plan#>>'{architecture,session_intent,proposed_session_intent}','CLASSIC'));
  v_challenge:=public.program_coach_challenge_target_v2(
    p_user_id,public.ugerod_effective_session_anchor_date_v1(),p_focus,p_readiness,p_progression_intent,
    v_session_intent,v_wod_minutes,v_exercise_count,p_zone_terms,p_policy_key
  );

  v_gate:=public.program_coach_challenge_longitudinal_gate_v1(
    p_user_id,public.ugerod_effective_session_anchor_date_v1(),v_challenge,p_policy_key
  );
  v_challenge:=jsonb_set(v_challenge,'{longitudinal_gate}',v_gate,true);
  v_challenge:=jsonb_set(v_challenge,'{pre_longitudinal_effective_level}',to_jsonb(coalesce(v_challenge->>'effective_level','NORMAL')),true);
  v_challenge:=jsonb_set(v_challenge,'{effective_level}',to_jsonb(coalesce(v_gate->>'effective_level',v_challenge->>'effective_level','NORMAL')),true);

  v_plan:=jsonb_set(v_plan,'{architecture,challenge_target}',v_challenge,true);
  v_plan:=public.c4_apply_challenge_dose_v1(
    p_user_id,v_plan,v_challenge,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
    p_zone_terms,p_inventory,p_max_complexity,p_policy_key
  );
  return v_plan;
end;
$function$;
