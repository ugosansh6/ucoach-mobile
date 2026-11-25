CREATE OR REPLACE FUNCTION public.apply_capability_observation(
  p_user_id uuid,
  p_exercise_id varchar,
  p_exercise_log_id bigint,
  p_family text,
  p_expected jsonb,
  p_actual jsonb,
  p_quality numeric,
  p_capability_eligible boolean,
  p_pain_affected boolean,
  p_observation_role text,
  p_comparison jsonb DEFAULT '{}'::jsonb,
  p_policy_key text DEFAULT 'b2.5-draft-default',
  p_observed_at timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_row public.user_exercise_capabilities%ROWTYPE;
  v_state jsonb;
  v_result jsonb;
  v_after jsonb;
  v_conf numeric:=0;
  v_fresh numeric:=0;
  v_total int:=0;
  v_valid int:=0;
  v_reason text[]:='{}'::text[];
  v_decision text;
  v_event_id bigint;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid()<>p_user_id THEN
    RAISE EXCEPTION 'Cannot update another user capability';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.exercises WHERE id=p_exercise_id) THEN
    RAISE EXCEPTION 'Unknown exercise %',p_exercise_id;
  END IF;

  SELECT * INTO v_row
  FROM public.user_exercise_capabilities
  WHERE user_id=p_user_id AND exercise_id=p_exercise_id
  FOR UPDATE;

  IF FOUND THEN
    v_state:=jsonb_build_object(
      'reps_envelope',v_row.reps_envelope,
      'load_envelope',v_row.load_envelope,
      'time_envelope',v_row.time_envelope,
      'distance_envelope',v_row.distance_envelope,
      'pace_envelope',v_row.pace_envelope,
      'density_envelope',v_row.density_envelope,
      'progressive_envelope',v_row.progressive_envelope,
      'confidence_json',v_row.confidence_json,
      'freshness_json',v_row.freshness_json,
      'evidence_json',v_row.evidence_json,
      'engine_version',v_row.engine_version
    );
  ELSE
    v_state:=jsonb_build_object(
      'reps_envelope','{}'::jsonb,'load_envelope','{}'::jsonb,'time_envelope','{}'::jsonb,
      'distance_envelope','{}'::jsonb,'pace_envelope','{}'::jsonb,'density_envelope','{}'::jsonb,
      'progressive_envelope','{}'::jsonb,'confidence_json','{}'::jsonb,'freshness_json','{}'::jsonb,
      'evidence_json','{}'::jsonb,'engine_version','b2.5-draft-2'
    );
  END IF;

  v_result:=public.propose_capability_state_update(
    v_state,p_family,p_expected,p_actual,p_quality,p_capability_eligible,p_pain_affected,
    p_comparison,p_policy_key,p_observed_at
  );
  v_after:=v_result->'after_state';
  v_decision:=v_result->>'decision';

  SELECT COALESCE(avg(public.jsonb_num(value,'score')),0)
  INTO v_conf FROM jsonb_each(COALESCE(v_after->'confidence_json','{}'::jsonb));

  SELECT
    COALESCE(sum(COALESCE((value->>'total_count')::int,0)),0),
    COALESCE(sum(COALESCE((value->>'valid_count')::int,0)),0)
  INTO v_total,v_valid
  FROM jsonb_each(COALESCE(v_after->'evidence_json','{}'::jsonb));

  -- Stored scalar freshness is only a compatibility snapshot at write time.
  -- Dynamic freshness must be computed from freshness_json + observation age when read.
  SELECT COALESCE(avg(
    public.capability_freshness_from_age(
      EXTRACT(EPOCH FROM (p_observed_at-(value->>'last_valid_observed_at')::timestamptz))/86400.0,
      COALESCE(public.jsonb_num(value,'half_life_days'),45)
    )
  ),0)
  INTO v_fresh
  FROM jsonb_each(COALESCE(v_after->'freshness_json','{}'::jsonb))
  WHERE value ? 'last_valid_observed_at';

  INSERT INTO public.user_exercise_capabilities(
    user_id,exercise_id,reps_envelope,load_envelope,time_envelope,distance_envelope,pace_envelope,
    density_envelope,progressive_envelope,confidence,freshness,evidence_count,valid_evidence_count,
    last_observed_at,last_valid_observed_at,updated_at,confidence_json,freshness_json,evidence_json,engine_version
  ) VALUES (
    p_user_id,p_exercise_id,
    COALESCE(v_after->'reps_envelope','{}'),COALESCE(v_after->'load_envelope','{}'),COALESCE(v_after->'time_envelope','{}'),
    COALESCE(v_after->'distance_envelope','{}'),COALESCE(v_after->'pace_envelope','{}'),COALESCE(v_after->'density_envelope','{}'),
    COALESCE(v_after->'progressive_envelope','{}'),v_conf,v_fresh,v_total,v_valid,p_observed_at,
    CASE WHEN COALESCE(p_capability_eligible,false) AND NOT COALESCE(p_pain_affected,false) AND COALESCE(p_quality,0)>0 THEN p_observed_at ELSE COALESCE(v_row.last_valid_observed_at,NULL) END,
    now(),COALESCE(v_after->'confidence_json','{}'),COALESCE(v_after->'freshness_json','{}'),COALESCE(v_after->'evidence_json','{}'),COALESCE(v_after->>'engine_version','b2.5-draft-2')
  )
  ON CONFLICT(user_id,exercise_id) DO UPDATE SET
    reps_envelope=EXCLUDED.reps_envelope,load_envelope=EXCLUDED.load_envelope,time_envelope=EXCLUDED.time_envelope,
    distance_envelope=EXCLUDED.distance_envelope,pace_envelope=EXCLUDED.pace_envelope,density_envelope=EXCLUDED.density_envelope,
    progressive_envelope=EXCLUDED.progressive_envelope,confidence=EXCLUDED.confidence,freshness=EXCLUDED.freshness,
    evidence_count=EXCLUDED.evidence_count,valid_evidence_count=EXCLUDED.valid_evidence_count,last_observed_at=EXCLUDED.last_observed_at,
    last_valid_observed_at=COALESCE(EXCLUDED.last_valid_observed_at,user_exercise_capabilities.last_valid_observed_at),
    updated_at=now(),confidence_json=EXCLUDED.confidence_json,freshness_json=EXCLUDED.freshness_json,
    evidence_json=EXCLUDED.evidence_json,engine_version=EXCLUDED.engine_version;

  IF v_result->'proposal' ? 'reason_codes' THEN
    SELECT COALESCE(array_agg(x),'{}'::text[]) INTO v_reason
    FROM jsonb_array_elements_text(v_result->'proposal'->'reason_codes') x;
  END IF;

  INSERT INTO public.capability_update_events(
    user_id,exercise_id,exercise_log_id,capability_family,engine_version,decision,reason_codes,
    observation_role,quality_json,comparison_json,before_json,proposal_json,after_json,applied,created_at,applied_at
  ) VALUES (
    p_user_id,p_exercise_id,p_exercise_log_id,p_family,COALESCE(v_result->>'engine_version','b2.5-draft-2'),
    v_decision,v_reason,p_observation_role,jsonb_build_object('score',p_quality),COALESCE(p_comparison,'{}'),
    v_state,COALESCE(v_result->'proposal','{}'),v_after,true,now(),now()
  ) RETURNING id INTO v_event_id;

  RETURN v_result||jsonb_build_object('applied',true,'event_id',v_event_id);
END;
$$;

CREATE OR REPLACE VIEW public.user_exercise_capability_runtime
WITH (security_invoker=true)
AS
SELECT
  c.*,
  COALESCE((
    SELECT avg(public.jsonb_num(v,'score'))
    FROM jsonb_each(c.confidence_json) e(k,v)
  ),0) AS runtime_confidence,
  COALESCE((
    SELECT avg(public.capability_freshness_from_age(
      EXTRACT(EPOCH FROM (now()-(v->>'last_valid_observed_at')::timestamptz))/86400.0,
      COALESCE(public.jsonb_num(v,'half_life_days'),45)
    ))
    FROM jsonb_each(c.freshness_json) e(k,v)
    WHERE v ? 'last_valid_observed_at'
  ),0) AS runtime_freshness
FROM public.user_exercise_capabilities c;;
