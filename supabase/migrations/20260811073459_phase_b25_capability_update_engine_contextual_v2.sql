-- B2.5 draft-2: preserve multidimensional frontiers and protocol comparability.
DROP FUNCTION IF EXISTS public.propose_capability_update(text,jsonb,jsonb,jsonb,numeric,boolean,boolean,boolean,timestamptz);

CREATE OR REPLACE FUNCTION public.propose_capability_update(
  p_family text,
  p_current jsonb,
  p_expected jsonb,
  p_actual jsonb,
  p_quality numeric,
  p_confirmed boolean,
  p_capability_eligible boolean,
  p_pain_affected boolean,
  p_comparison jsonb DEFAULT '{}'::jsonb,
  p_observed_at timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_current jsonb := COALESCE(p_current,'{}'::jsonb);
  v_before jsonb := COALESCE(p_current,'{}'::jsonb);
  v_quality numeric := public.num_clamp(COALESCE(p_quality,0),0,1);
  v_expected_rpe numeric := COALESCE(public.jsonb_num(p_expected,'target_rpe'),public.jsonb_num(p_expected,'target_rpe_max'));
  v_actual_rpe numeric := public.jsonb_num(p_actual,'rpe');
  v_rpe_delta numeric := CASE WHEN v_expected_rpe IS NOT NULL AND v_actual_rpe IS NOT NULL THEN v_actual_rpe-v_expected_rpe ELSE 0 END;
  v_reason text[] := '{}'::text[];
  v_decision text := 'HOLD';
  v_signal text := 'NEUTRAL';
  v_actual_value numeric;
  v_old_value numeric;
  v_load numeric;
  v_reps numeric;
  v_frontier jsonb;
  v_point jsonb;
  v_stage numeric;
  v_partial numeric;
  v_distance numeric;
  v_duration numeric;
  v_pace numeric;
  v_signature text := NULLIF(trim(COALESCE(p_comparison->>'protocol_signature','')),'');
  v_existing_signature text := NULLIF(trim(COALESCE(v_current->>'protocol_signature','')),'');
  v_mode text := COALESCE(NULLIF(trim(p_comparison->>'capability_mode'),''),'repeatable');
  v_value_key text;
BEGIN
  IF p_family NOT IN ('reps','load_reps','time','pace','loaded_distance','density','progressive') THEN
    RAISE EXCEPTION 'Unsupported capability family: %',p_family;
  END IF;
  IF v_mode NOT IN ('fresh','repeatable') THEN
    RAISE EXCEPTION 'Unsupported capability_mode: %',v_mode;
  END IF;

  IF NOT COALESCE(p_capability_eligible,false) OR COALESCE(p_pain_affected,false) THEN
    v_decision := 'EXCLUDE';
    v_reason := CASE WHEN COALESCE(p_pain_affected,false)
      THEN ARRAY['PAIN_STATE_ONLY']::text[] ELSE ARRAY['NOT_CAPABILITY_ELIGIBLE']::text[] END;
    RETURN jsonb_build_object('engine_version','b2.5-draft-2','family',p_family,'decision',v_decision,'signal','NONE','reason_codes',v_reason,'before',v_before,'after',v_before,'quality',v_quality,'confirmed',COALESCE(p_confirmed,false),'comparison',COALESCE(p_comparison,'{}'::jsonb),'observed_at',p_observed_at);
  END IF;
  IF v_quality <= 0 THEN
    RETURN jsonb_build_object('engine_version','b2.5-draft-2','family',p_family,'decision','HOLD','signal','NONE','reason_codes',ARRAY['ZERO_QUALITY']::text[],'before',v_before,'after',v_before,'quality',v_quality,'confirmed',COALESCE(p_confirmed,false),'comparison',COALESCE(p_comparison,'{}'::jsonb),'observed_at',p_observed_at);
  END IF;

  -- Context-sensitive mechanics cannot be compared without a protocol signature.
  IF p_family IN ('density','progressive') THEN
    IF v_signature IS NULL THEN
      RETURN jsonb_build_object('engine_version','b2.5-draft-2','family',p_family,'decision','HOLD','signal','NONE','reason_codes',ARRAY['MISSING_PROTOCOL_SIGNATURE']::text[],'before',v_before,'after',v_before,'quality',v_quality,'confirmed',COALESCE(p_confirmed,false),'comparison',COALESCE(p_comparison,'{}'::jsonb),'observed_at',p_observed_at);
    END IF;
    IF v_existing_signature IS NOT NULL AND v_existing_signature <> v_signature THEN
      RETURN jsonb_build_object('engine_version','b2.5-draft-2','family',p_family,'decision','HOLD','signal','INCOMPARABLE_CONTEXT','reason_codes',ARRAY['PROTOCOL_SIGNATURE_MISMATCH']::text[],'before',v_before,'after',v_before,'quality',v_quality,'confirmed',COALESCE(p_confirmed,false),'comparison',COALESCE(p_comparison,'{}'::jsonb),'observed_at',p_observed_at);
    END IF;
    v_current := v_current || jsonb_build_object('protocol_signature',v_signature);
  END IF;

  IF p_family='reps' THEN
    v_actual_value := public.jsonb_num(p_actual,'reps');
    v_value_key := CASE WHEN v_mode='fresh' THEN 'fresh_reps' ELSE 'repeatable_reps' END;
    v_old_value := public.jsonb_num(v_current,v_value_key);
    IF v_actual_value IS NULL THEN v_reason:=ARRAY['MISSING_REPS'];
    ELSIF v_old_value IS NULL THEN v_decision:='CONFIRM'; v_signal:='INITIALIZE'; v_current:=v_current||jsonb_build_object(v_value_key,v_actual_value,'last_observed_at',p_observed_at); v_reason:=ARRAY['FIRST_VALID_REPS'];
    ELSIF v_actual_value>v_old_value AND v_rpe_delta<=0 THEN v_signal:='POSITIVE'; IF p_confirmed THEN v_decision:='EXPAND'; v_current:=v_current||jsonb_build_object(v_value_key,v_actual_value,'last_observed_at',p_observed_at); v_reason:=ARRAY['HIGHER_REPS_CONFIRMED']; ELSE v_decision:='HOLD'; v_reason:=ARRAY['HIGHER_REPS_UNCONFIRMED']; END IF;
    ELSIF v_actual_value=v_old_value AND v_rpe_delta<0 THEN v_decision:='CONFIRM'; v_signal:='POSITIVE_EFFICIENCY'; v_reason:=ARRAY['SAME_REPS_LOWER_RPE'];
    ELSIF v_actual_value<v_old_value AND v_rpe_delta>0 THEN v_signal:='NEGATIVE'; IF p_confirmed THEN v_decision:='REGRESS_CONFIRMED'; v_current:=v_current||jsonb_build_object(v_value_key,v_actual_value,'last_observed_at',p_observed_at); v_reason:=ARRAY['LOWER_REPS_HIGHER_RPE_CONFIRMED']; ELSE v_decision:='HOLD'; v_reason:=ARRAY['NEGATIVE_UNCONFIRMED_STATE_ONLY']; END IF;
    ELSE v_decision:='CONFIRM'; v_reason:=ARRAY['REPS_COMPATIBLE_WITH_ENVELOPE']; END IF;

  ELSIF p_family='time' THEN
    v_actual_value:=public.jsonb_num(p_actual,'duration_seconds');
    v_value_key:=CASE WHEN v_mode='fresh' THEN 'fresh_seconds' ELSE 'repeatable_seconds' END;
    v_old_value:=public.jsonb_num(v_current,v_value_key);
    IF v_actual_value IS NULL THEN v_reason:=ARRAY['MISSING_DURATION'];
    ELSIF v_old_value IS NULL THEN v_decision:='CONFIRM'; v_signal:='INITIALIZE'; v_current:=v_current||jsonb_build_object(v_value_key,v_actual_value,'last_observed_at',p_observed_at); v_reason:=ARRAY['FIRST_VALID_TIME'];
    ELSIF v_actual_value>v_old_value AND v_rpe_delta<=0 THEN v_signal:='POSITIVE'; IF p_confirmed THEN v_decision:='EXPAND'; v_current:=v_current||jsonb_build_object(v_value_key,v_actual_value,'last_observed_at',p_observed_at); v_reason:=ARRAY['LONGER_HOLD_CONFIRMED']; ELSE v_decision:='HOLD'; v_reason:=ARRAY['LONGER_HOLD_UNCONFIRMED']; END IF;
    ELSIF v_actual_value<v_old_value AND v_rpe_delta>0 THEN v_signal:='NEGATIVE'; IF p_confirmed THEN v_decision:='REGRESS_CONFIRMED'; v_current:=v_current||jsonb_build_object(v_value_key,v_actual_value,'last_observed_at',p_observed_at); v_reason:=ARRAY['SHORTER_HOLD_HIGHER_RPE_CONFIRMED']; ELSE v_decision:='HOLD'; v_reason:=ARRAY['NEGATIVE_UNCONFIRMED_STATE_ONLY']; END IF;
    ELSE v_decision:='CONFIRM'; v_reason:=ARRAY['TIME_COMPATIBLE_WITH_ENVELOPE']; END IF;

  ELSIF p_family='load_reps' THEN
    v_load:=public.jsonb_num(p_actual,'load_kg'); v_reps:=public.jsonb_num(p_actual,'reps');
    IF v_load IS NULL OR v_reps IS NULL THEN v_reason:=ARRAY['MISSING_LOAD_OR_REPS'];
    ELSE
      v_frontier:=COALESCE(v_current->'frontier','[]'::jsonb); IF jsonb_typeof(v_frontier)<>'array' THEN v_frontier:='[]'::jsonb; END IF;
      v_point:=jsonb_build_object('load_kg',v_load,'reps',v_reps,'rpe',v_actual_rpe,'quality',v_quality,'observed_at',p_observed_at);
      IF EXISTS(SELECT 1 FROM jsonb_array_elements(v_frontier)x WHERE public.jsonb_num(x,'load_kg')>=v_load AND public.jsonb_num(x,'reps')>=v_reps AND (public.jsonb_num(x,'load_kg')>v_load OR public.jsonb_num(x,'reps')>v_reps)) THEN
        v_signal:='BELOW_FRONTIER'; IF p_confirmed AND v_rpe_delta>0 THEN v_decision:='REGRESS_CONFIRMED'; v_reason:=ARRAY['BELOW_FRONTIER_CONFIRMED']; ELSE v_decision:='HOLD'; v_reason:=ARRAY['BELOW_FRONTIER_NOT_ENOUGH_TO_REGRESS']; END IF;
      ELSE
        SELECT COALESCE(jsonb_agg(x),'[]'::jsonb) INTO v_frontier FROM jsonb_array_elements(v_frontier)x WHERE NOT(public.jsonb_num(x,'load_kg')<=v_load AND public.jsonb_num(x,'reps')<=v_reps AND (public.jsonb_num(x,'load_kg')<v_load OR public.jsonb_num(x,'reps')<v_reps));
        v_frontier:=v_frontier||jsonb_build_array(v_point); v_current:=v_current||jsonb_build_object('frontier',v_frontier,'last_observed_at',p_observed_at); v_decision:='ADD_FRONTIER_POINT'; v_signal:='POSITIVE_OR_NEW_CAPACITY_POINT'; v_reason:=ARRAY['NON_DOMINATED_LOAD_REP_POINT'];
      END IF;
    END IF;

  ELSIF p_family='pace' THEN
    v_distance:=public.jsonb_num(p_actual,'distance_meters'); v_duration:=public.jsonb_num(p_actual,'duration_seconds');
    IF v_distance IS NULL OR v_duration IS NULL OR v_duration<=0 THEN v_reason:=ARRAY['MISSING_DISTANCE_OR_TIME'];
    ELSE
      v_pace:=v_distance/v_duration;
      v_frontier:=COALESCE(v_current->'frontier','[]'::jsonb); IF jsonb_typeof(v_frontier)<>'array' THEN v_frontier:='[]'::jsonb; END IF;
      v_point:=jsonb_build_object('distance_meters',v_distance,'duration_seconds',v_duration,'pace_mps',v_pace,'rpe',v_actual_rpe,'quality',v_quality,'observed_at',p_observed_at);
      IF EXISTS(SELECT 1 FROM jsonb_array_elements(v_frontier)x WHERE public.jsonb_num(x,'distance_meters')>=v_distance AND public.jsonb_num(x,'pace_mps')>=v_pace AND (public.jsonb_num(x,'distance_meters')>v_distance OR public.jsonb_num(x,'pace_mps')>v_pace)) THEN
        v_signal:='BELOW_FRONTIER'; IF p_confirmed AND v_rpe_delta>0 THEN v_decision:='REGRESS_CONFIRMED'; v_reason:=ARRAY['PACE_DISTANCE_BELOW_FRONTIER_CONFIRMED']; ELSE v_decision:='HOLD'; v_reason:=ARRAY['PACE_DISTANCE_BELOW_FRONTIER']; END IF;
      ELSE
        SELECT COALESCE(jsonb_agg(x),'[]'::jsonb) INTO v_frontier FROM jsonb_array_elements(v_frontier)x WHERE NOT(public.jsonb_num(x,'distance_meters')<=v_distance AND public.jsonb_num(x,'pace_mps')<=v_pace AND (public.jsonb_num(x,'distance_meters')<v_distance OR public.jsonb_num(x,'pace_mps')<v_pace));
        v_frontier:=v_frontier||jsonb_build_array(v_point); v_current:=v_current||jsonb_build_object('frontier',v_frontier,'last_observed_at',p_observed_at); v_decision:='ADD_FRONTIER_POINT'; v_signal:='POSITIVE_OR_NEW_CAPACITY_POINT'; v_reason:=ARRAY['NON_DOMINATED_DISTANCE_PACE_POINT'];
      END IF;
    END IF;

  ELSIF p_family='loaded_distance' THEN
    v_load:=public.jsonb_num(p_actual,'load_kg'); v_distance:=public.jsonb_num(p_actual,'distance_meters'); v_duration:=public.jsonb_num(p_actual,'duration_seconds');
    IF v_load IS NULL OR v_distance IS NULL OR v_duration IS NULL OR v_duration<=0 THEN v_reason:=ARRAY['MISSING_LOAD_DISTANCE_OR_TIME'];
    ELSE
      v_pace:=v_distance/v_duration;
      v_frontier:=COALESCE(v_current->'frontier','[]'::jsonb); IF jsonb_typeof(v_frontier)<>'array' THEN v_frontier:='[]'::jsonb; END IF;
      v_point:=jsonb_build_object('load_kg',v_load,'distance_meters',v_distance,'duration_seconds',v_duration,'pace_mps',v_pace,'rpe',v_actual_rpe,'quality',v_quality,'observed_at',p_observed_at);
      IF EXISTS(SELECT 1 FROM jsonb_array_elements(v_frontier)x WHERE public.jsonb_num(x,'load_kg')>=v_load AND public.jsonb_num(x,'distance_meters')>=v_distance AND public.jsonb_num(x,'pace_mps')>=v_pace AND (public.jsonb_num(x,'load_kg')>v_load OR public.jsonb_num(x,'distance_meters')>v_distance OR public.jsonb_num(x,'pace_mps')>v_pace)) THEN
        v_signal:='BELOW_FRONTIER'; IF p_confirmed AND v_rpe_delta>0 THEN v_decision:='REGRESS_CONFIRMED'; v_reason:=ARRAY['LOADED_DISTANCE_BELOW_FRONTIER_CONFIRMED']; ELSE v_decision:='HOLD'; v_reason:=ARRAY['LOADED_DISTANCE_BELOW_FRONTIER']; END IF;
      ELSE
        SELECT COALESCE(jsonb_agg(x),'[]'::jsonb) INTO v_frontier FROM jsonb_array_elements(v_frontier)x WHERE NOT(public.jsonb_num(x,'load_kg')<=v_load AND public.jsonb_num(x,'distance_meters')<=v_distance AND public.jsonb_num(x,'pace_mps')<=v_pace AND (public.jsonb_num(x,'load_kg')<v_load OR public.jsonb_num(x,'distance_meters')<v_distance OR public.jsonb_num(x,'pace_mps')<v_pace));
        v_frontier:=v_frontier||jsonb_build_array(v_point); v_current:=v_current||jsonb_build_object('frontier',v_frontier,'last_observed_at',p_observed_at); v_decision:='ADD_FRONTIER_POINT'; v_signal:='POSITIVE_OR_NEW_CAPACITY_POINT'; v_reason:=ARRAY['NON_DOMINATED_LOADED_DISTANCE_POINT'];
      END IF;
    END IF;

  ELSIF p_family='progressive' THEN
    v_stage:=public.jsonb_num(p_actual,'last_completed_stage'); v_partial:=COALESCE(public.jsonb_num(p_actual,'partial_next_stage'),0); v_actual_value:=CASE WHEN v_stage IS NULL THEN NULL ELSE v_stage+public.num_clamp(v_partial,0,0.999) END; v_old_value:=public.jsonb_num(v_current,'threshold_stage_equivalent');
    IF v_actual_value IS NULL THEN v_reason:=ARRAY['MISSING_PROGRESSIVE_STAGE'];
    ELSIF v_old_value IS NULL THEN v_decision:='CONFIRM'; v_signal:='INITIALIZE'; v_current:=v_current||jsonb_build_object('threshold_stage_equivalent',v_actual_value,'last_completed_stage',v_stage,'partial_next_stage',v_partial,'last_observed_at',p_observed_at); v_reason:=ARRAY['FIRST_VALID_PROGRESSIVE_THRESHOLD'];
    ELSIF v_actual_value>v_old_value THEN v_signal:='POSITIVE'; IF p_confirmed THEN v_decision:='EXPAND'; v_current:=v_current||jsonb_build_object('threshold_stage_equivalent',v_actual_value,'last_completed_stage',v_stage,'partial_next_stage',v_partial,'last_observed_at',p_observed_at); v_reason:=ARRAY['HIGHER_PROGRESSIVE_THRESHOLD_CONFIRMED']; ELSE v_decision:='HOLD'; v_reason:=ARRAY['HIGHER_PROGRESSIVE_THRESHOLD_UNCONFIRMED']; END IF;
    ELSIF v_actual_value<v_old_value THEN v_signal:='NEGATIVE'; IF p_confirmed THEN v_decision:='REGRESS_CONFIRMED'; v_current:=v_current||jsonb_build_object('threshold_stage_equivalent',v_actual_value,'last_completed_stage',v_stage,'partial_next_stage',v_partial,'last_observed_at',p_observed_at); v_reason:=ARRAY['LOWER_PROGRESSIVE_THRESHOLD_CONFIRMED']; ELSE v_decision:='HOLD'; v_reason:=ARRAY['NEGATIVE_UNCONFIRMED_STATE_ONLY']; END IF;
    ELSE v_decision:='CONFIRM'; v_reason:=ARRAY['PROGRESSIVE_THRESHOLD_CONFIRMED']; END IF;

  ELSE -- density
    v_actual_value:=public.jsonb_num(p_actual,'density_value'); v_old_value:=public.jsonb_num(v_current,'repeatable_density');
    IF v_actual_value IS NULL THEN v_reason:=ARRAY['MISSING_DENSITY_VALUE'];
    ELSIF v_old_value IS NULL THEN v_decision:='CONFIRM'; v_signal:='INITIALIZE'; v_current:=v_current||jsonb_build_object('repeatable_density',v_actual_value,'last_observed_at',p_observed_at); v_reason:=ARRAY['FIRST_VALID_DENSITY'];
    ELSIF v_actual_value>v_old_value AND v_rpe_delta<=0 THEN v_signal:='POSITIVE'; IF p_confirmed THEN v_decision:='EXPAND'; v_current:=v_current||jsonb_build_object('repeatable_density',v_actual_value,'last_observed_at',p_observed_at); v_reason:=ARRAY['HIGHER_DENSITY_CONFIRMED']; ELSE v_decision:='HOLD'; v_reason:=ARRAY['HIGHER_DENSITY_UNCONFIRMED']; END IF;
    ELSIF v_actual_value<v_old_value AND v_rpe_delta>0 THEN v_signal:='NEGATIVE'; IF p_confirmed THEN v_decision:='REGRESS_CONFIRMED'; v_current:=v_current||jsonb_build_object('repeatable_density',v_actual_value,'last_observed_at',p_observed_at); v_reason:=ARRAY['LOWER_DENSITY_CONFIRMED']; ELSE v_decision:='HOLD'; v_reason:=ARRAY['NEGATIVE_UNCONFIRMED_STATE_ONLY']; END IF;
    ELSE v_decision:='CONFIRM'; v_reason:=ARRAY['DENSITY_COMPATIBLE_WITH_ENVELOPE']; END IF;
  END IF;

  RETURN jsonb_build_object('engine_version','b2.5-draft-2','family',p_family,'decision',v_decision,'signal',v_signal,'reason_codes',v_reason,'before',v_before,'after',v_current,'quality',v_quality,'confirmed',COALESCE(p_confirmed,false),'rpe_delta',v_rpe_delta,'comparison',COALESCE(p_comparison,'{}'::jsonb),'observed_at',p_observed_at);
END;
$$;;
