ALTER FUNCTION public.propose_capability_state_update(jsonb,text,jsonb,jsonb,numeric,boolean,boolean,jsonb,text,timestamptz)
  RENAME TO propose_capability_state_update_core;

CREATE OR REPLACE FUNCTION public.propose_capability_state_update(
  p_state jsonb,
  p_family text,
  p_expected jsonb,
  p_actual jsonb,
  p_quality numeric,
  p_capability_eligible boolean,
  p_pain_affected boolean,
  p_comparison jsonb DEFAULT '{}'::jsonb,
  p_policy_key text DEFAULT 'b2.5-draft-default',
  p_observed_at timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_result jsonb;
  v_state jsonb;
  v_cap_key text;
  v_mode text:=COALESCE(NULLIF(p_comparison->>'capability_mode',''),'repeatable');
  v_signature text:=NULLIF(p_comparison->>'protocol_signature','');
  v_env_key text;
  v_root jsonb;
  v_sub jsonb;
  v_candidate jsonb;
BEGIN
  v_result:=public.propose_capability_state_update_core(
    p_state,p_family,p_expected,p_actual,p_quality,p_capability_eligible,p_pain_affected,
    p_comparison,p_policy_key,p_observed_at
  );

  IF COALESCE(v_result->>'decision','') <> 'REGRESS_CONFIRMED' THEN
    RETURN v_result;
  END IF;

  -- A confirmed negative observation starts recalibration; it never erases
  -- established/historical capability in one step.
  v_state:=COALESCE(v_result->'after_state','{}'::jsonb);
  v_cap_key:=v_result->>'capability_key';
  v_env_key:=CASE p_family
    WHEN 'reps' THEN 'reps_envelope'
    WHEN 'load_reps' THEN 'load_envelope'
    WHEN 'time' THEN 'time_envelope'
    WHEN 'pace' THEN 'pace_envelope'
    WHEN 'loaded_distance' THEN 'distance_envelope'
    WHEN 'density' THEN 'density_envelope'
    WHEN 'progressive' THEN 'progressive_envelope'
  END;

  v_root:=COALESCE(p_state->v_env_key,'{}'::jsonb);
  IF p_family IN ('density','progressive') THEN
    v_sub:=COALESCE(v_root#>ARRAY['protocols',COALESCE(v_signature,'missing')],'{}'::jsonb);
  ELSE
    v_sub:=COALESCE(v_root->v_mode,'{}'::jsonb);
  END IF;

  v_candidate:=jsonb_build_object(
    'actual',COALESCE(p_actual,'{}'::jsonb),
    'expected',COALESCE(p_expected,'{}'::jsonb),
    'quality',public.num_clamp(COALESCE(p_quality,0),0,1),
    'comparison',COALESCE(p_comparison,'{}'::jsonb),
    'observed_at',p_observed_at,
    'status','CONFIRMED_NEGATIVE_RECALIBRATION'
  );
  v_sub:=jsonb_set(v_sub,ARRAY['recalibration_candidate'],v_candidate,true);

  IF p_family IN ('density','progressive') THEN
    v_root:=jsonb_set(v_root,ARRAY['protocols',COALESCE(v_signature,'missing')],v_sub,true);
  ELSE
    v_root:=jsonb_set(v_root,ARRAY[v_mode],v_sub,true);
  END IF;
  v_state:=jsonb_set(v_state,ARRAY[v_env_key],v_root,true);

  IF v_cap_key IS NOT NULL THEN
    v_state:=jsonb_set(v_state,ARRAY['evidence_json',v_cap_key,'last_decision'],to_jsonb('RECALIBRATE'::text),true);
  END IF;

  v_result:=jsonb_set(v_result,ARRAY['decision'],to_jsonb('RECALIBRATE'::text),true);
  v_result:=jsonb_set(v_result,ARRAY['after_state'],v_state,true);
  v_result:=jsonb_set(v_result,ARRAY['proposal','decision'],to_jsonb('RECALIBRATE'::text),true);
  v_result:=jsonb_set(v_result,ARRAY['proposal','after'],v_sub,true);
  v_result:=jsonb_set(v_result,ARRAY['proposal','reason_codes'],jsonb_build_array('CONFIRMED_NEGATIVE_REQUIRES_RECALIBRATION'),true);
  RETURN v_result;
END;
$$;;
