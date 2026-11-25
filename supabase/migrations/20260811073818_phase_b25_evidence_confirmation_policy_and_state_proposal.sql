CREATE TABLE IF NOT EXISTS public.performance_engine_policy (
  policy_key text PRIMARY KEY,
  engine_version text NOT NULL,
  positive_confirmations_required smallint NOT NULL,
  negative_confirmations_required smallint NOT NULL,
  confidence_half_evidence numeric NOT NULL,
  positive_candidate_evidence_factor numeric NOT NULL,
  negative_candidate_evidence_factor numeric NOT NULL,
  freshness_half_life_days numeric NOT NULL,
  active boolean NOT NULL DEFAULT false,
  notes text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (positive_confirmations_required>=1),
  CHECK (negative_confirmations_required>=1),
  CHECK (confidence_half_evidence>0),
  CHECK (positive_candidate_evidence_factor BETWEEN 0 AND 1),
  CHECK (negative_candidate_evidence_factor BETWEEN 0 AND 1),
  CHECK (freshness_half_life_days>0)
);

INSERT INTO public.performance_engine_policy(
 policy_key,engine_version,positive_confirmations_required,negative_confirmations_required,
 confidence_half_evidence,positive_candidate_evidence_factor,negative_candidate_evidence_factor,
 freshness_half_life_days,active,notes
) VALUES (
 'b2.5-draft-default','b2.5-draft-2',2,3,2.0,0.50,0.25,45,false,
 'Simulation/tuning policy only. Values are product calibration parameters, not validated physiological constants.'
)
ON CONFLICT(policy_key) DO UPDATE SET
 engine_version=EXCLUDED.engine_version,
 positive_confirmations_required=EXCLUDED.positive_confirmations_required,
 negative_confirmations_required=EXCLUDED.negative_confirmations_required,
 confidence_half_evidence=EXCLUDED.confidence_half_evidence,
 positive_candidate_evidence_factor=EXCLUDED.positive_candidate_evidence_factor,
 negative_candidate_evidence_factor=EXCLUDED.negative_candidate_evidence_factor,
 freshness_half_life_days=EXCLUDED.freshness_half_life_days,
 notes=EXCLUDED.notes,
 updated_at=now();

ALTER TABLE public.performance_engine_policy ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated can read performance engine policy" ON public.performance_engine_policy;
CREATE POLICY "Authenticated can read performance engine policy" ON public.performance_engine_policy
FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.capability_confidence_from_evidence(p_effective_evidence numeric,p_half_evidence numeric)
RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE WHEN COALESCE(p_effective_evidence,0)<=0 THEN 0
 ELSE public.num_clamp(p_effective_evidence/(p_effective_evidence+p_half_evidence),0,0.999) END;
$$;

CREATE OR REPLACE FUNCTION public.capability_freshness_from_age(p_age_days numeric,p_half_life_days numeric)
RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE WHEN p_age_days IS NULL THEN 0
 ELSE public.num_clamp(p_half_life_days/(p_half_life_days+GREATEST(0,p_age_days)),0,1) END;
$$;

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
  v_state jsonb:=COALESCE(p_state,'{}'::jsonb);
  v_policy public.performance_engine_policy%ROWTYPE;
  v_mode text:=COALESCE(NULLIF(p_comparison->>'capability_mode',''),'repeatable');
  v_signature text:=NULLIF(p_comparison->>'protocol_signature','');
  v_cap_key text;
  v_env_root_key text;
  v_env_root jsonb;
  v_subenv jsonb;
  v_probe jsonb;
  v_final jsonb;
  v_signal text;
  v_rpe_delta numeric;
  v_evidence_root jsonb:=COALESCE(v_state->'evidence_json','{}'::jsonb);
  v_conf_root jsonb:=COALESCE(v_state->'confidence_json','{}'::jsonb);
  v_fresh_root jsonb:=COALESCE(v_state->'freshness_json','{}'::jsonb);
  v_ev jsonb;
  v_total int;
  v_valid int;
  v_eff numeric;
  v_pos int;
  v_neg int;
  v_context text;
  v_prev_context text;
  v_confirmed boolean:=false;
  v_factor numeric:=1;
  v_conf numeric;
  v_quality numeric:=public.num_clamp(COALESCE(p_quality,0),0,1);
  v_after_subenv jsonb;
  v_decision text;
BEGIN
  SELECT * INTO v_policy FROM public.performance_engine_policy WHERE policy_key=p_policy_key;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unknown performance engine policy: %',p_policy_key; END IF;

  IF p_family IN ('density','progressive') THEN
    IF v_signature IS NULL THEN v_cap_key:=p_family||'|protocol:missing'; ELSE v_cap_key:=p_family||'|protocol:'||v_signature; END IF;
  ELSE
    v_cap_key:=p_family||'|'||v_mode;
  END IF;
  v_context:=COALESCE(v_signature,p_family||'|'||v_mode);

  v_env_root_key:=CASE p_family
    WHEN 'reps' THEN 'reps_envelope'
    WHEN 'load_reps' THEN 'load_envelope'
    WHEN 'time' THEN 'time_envelope'
    WHEN 'pace' THEN 'pace_envelope'
    WHEN 'loaded_distance' THEN 'distance_envelope'
    WHEN 'density' THEN 'density_envelope'
    WHEN 'progressive' THEN 'progressive_envelope'
  END;
  IF v_env_root_key IS NULL THEN RAISE EXCEPTION 'Unsupported family: %',p_family; END IF;

  v_env_root:=COALESCE(v_state->v_env_root_key,'{}'::jsonb);
  IF p_family IN ('density','progressive') THEN
    v_subenv:=COALESCE(v_env_root#>ARRAY['protocols',COALESCE(v_signature,'missing')],'{}'::jsonb);
  ELSE
    v_subenv:=COALESCE(v_env_root->v_mode,'{}'::jsonb);
  END IF;

  -- First pass never confirms: it classifies the current observation.
  v_probe:=public.propose_capability_update(p_family,v_subenv,p_expected,p_actual,v_quality,false,p_capability_eligible,p_pain_affected,p_comparison,p_observed_at);
  v_signal:=COALESCE(v_probe->>'signal','NONE');
  v_rpe_delta:=COALESCE(public.jsonb_num(v_probe,'rpe_delta'),0);

  v_ev:=COALESCE(v_evidence_root->v_cap_key,'{}'::jsonb);
  v_total:=COALESCE((v_ev->>'total_count')::int,0)+1;
  v_valid:=COALESCE((v_ev->>'valid_count')::int,0);
  v_eff:=COALESCE(public.jsonb_num(v_ev,'effective_evidence'),0);
  v_pos:=COALESCE((v_ev->>'pending_positive_count')::int,0);
  v_neg:=COALESCE((v_ev->>'pending_negative_count')::int,0);
  v_prev_context:=v_ev->>'pending_context';

  IF COALESCE(p_capability_eligible,false) AND NOT COALESCE(p_pain_affected,false) AND v_quality>0
     AND COALESCE(v_probe->>'decision','HOLD')<>'EXCLUDE'
     AND NOT (v_probe->'reason_codes' ? 'MISSING_PROTOCOL_SIGNATURE')
     AND NOT (v_probe->'reason_codes' ? 'PROTOCOL_SIGNATURE_MISMATCH') THEN
    v_valid:=v_valid+1;

    IF v_signal IN ('POSITIVE','POSITIVE_OR_NEW_CAPACITY_POINT') THEN
      IF v_prev_context IS DISTINCT FROM v_context THEN v_pos:=1; ELSE v_pos:=v_pos+1; END IF;
      v_neg:=0;
      v_confirmed:=v_pos>=v_policy.positive_confirmations_required;
      v_factor:=CASE WHEN v_confirmed THEN 1 ELSE v_policy.positive_candidate_evidence_factor END;
    ELSIF v_signal IN ('NEGATIVE','BELOW_FRONTIER') AND v_rpe_delta>0 THEN
      IF v_prev_context IS DISTINCT FROM v_context THEN v_neg:=1; ELSE v_neg:=v_neg+1; END IF;
      v_pos:=0;
      v_confirmed:=v_neg>=v_policy.negative_confirmations_required;
      v_factor:=CASE WHEN v_confirmed THEN 1 ELSE v_policy.negative_candidate_evidence_factor END;
    ELSE
      v_pos:=0; v_neg:=0; v_confirmed:=false; v_factor:=1;
    END IF;
    v_eff:=v_eff+(v_quality*v_factor);
  END IF;

  -- Second pass applies confirmation only when enough comparable evidence has accumulated.
  IF v_confirmed THEN
    v_final:=public.propose_capability_update(p_family,v_subenv,p_expected,p_actual,v_quality,true,p_capability_eligible,p_pain_affected,p_comparison,p_observed_at);
    IF v_signal IN ('POSITIVE','POSITIVE_OR_NEW_CAPACITY_POINT') THEN v_pos:=0; ELSE v_neg:=0; END IF;
  ELSE
    v_final:=v_probe;
  END IF;
  v_after_subenv:=COALESCE(v_final->'after',v_subenv);
  v_decision:=COALESCE(v_final->>'decision','HOLD');

  IF p_family IN ('density','progressive') THEN
    v_env_root:=jsonb_set(v_env_root,ARRAY['protocols',COALESCE(v_signature,'missing')],v_after_subenv,true);
  ELSE
    v_env_root:=jsonb_set(v_env_root,ARRAY[v_mode],v_after_subenv,true);
  END IF;
  v_state:=jsonb_set(v_state,ARRAY[v_env_root_key],v_env_root,true);

  v_evidence_root:=jsonb_set(v_evidence_root,ARRAY[v_cap_key],jsonb_build_object(
    'total_count',v_total,'valid_count',v_valid,'effective_evidence',round(v_eff,4),
    'pending_positive_count',v_pos,'pending_negative_count',v_neg,'pending_context',v_context,
    'last_signal',v_signal,'last_decision',v_decision,'last_observed_at',p_observed_at
  ),true);
  v_conf:=public.capability_confidence_from_evidence(v_eff,v_policy.confidence_half_evidence);
  v_conf_root:=jsonb_set(v_conf_root,ARRAY[v_cap_key],jsonb_build_object('score',round(v_conf,4),'effective_evidence',round(v_eff,4),'policy',p_policy_key),true);
  IF COALESCE(p_capability_eligible,false) AND NOT COALESCE(p_pain_affected,false) AND v_quality>0 THEN
    v_fresh_root:=jsonb_set(v_fresh_root,ARRAY[v_cap_key],jsonb_build_object('last_valid_observed_at',p_observed_at,'half_life_days',v_policy.freshness_half_life_days),true);
  END IF;

  v_state:=jsonb_set(v_state,ARRAY['evidence_json'],v_evidence_root,true);
  v_state:=jsonb_set(v_state,ARRAY['confidence_json'],v_conf_root,true);
  v_state:=jsonb_set(v_state,ARRAY['freshness_json'],v_fresh_root,true);
  v_state:=jsonb_set(v_state,ARRAY['engine_version'],to_jsonb(v_policy.engine_version),true);

  RETURN jsonb_build_object(
    'engine_version',v_policy.engine_version,
    'policy_key',p_policy_key,
    'capability_key',v_cap_key,
    'signal',v_signal,
    'confirmed_now',v_confirmed,
    'decision',v_decision,
    'quality',v_quality,
    'effective_evidence',round(v_eff,4),
    'confidence',round(v_conf,4),
    'proposal',v_final,
    'after_state',v_state
  );
END;
$$;;
