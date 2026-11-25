CREATE OR REPLACE FUNCTION public.week_composer_wod_authority_v2(p_user_id uuid,p_context jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
 m text:=upper(p_context->>'mechanic_key'); variant text:=nullif(upper(p_context->>'variant_key'),'');
 minutes int:=(p_context->>'block_minutes')::int; duration int:=(p_context->>'session_minutes')::int;
 env text:=upper(coalesce(p_context->>'environment_code','BOX'));
 focus text:=coalesce(p_context->>'focus','General Fitness'); region text:=nullif(p_context->>'target_region','');
 readiness text:=public.normalize_session_readiness(coalesce(p_context->>'readiness','normal'));
 intent text:=coalesce(p_context->>'progression_intent','MAINTAIN');
 equipment text[]; pain text[]; inventory jsonb; spec jsonb; contract jsonb; chosen jsonb:=p_context->'exercises';
 candidate jsonb; stimulus jsonb; sol jsonb; x jsonb; gate jsonb; ids text[]:='{}'; params jsonb;
 budget numeric; estimate numeric; result jsonb; count_ex int;
BEGIN
 IF auth.uid() IS NULL OR auth.uid()<>p_user_id THEN RAISE EXCEPTION 'FORBIDDEN_COMPOSER' USING ERRCODE='42501'; END IF;
 IF minutes IS NULL OR minutes NOT BETWEEN 3 AND 90 OR duration IS NULL OR duration NOT BETWEEN 15 AND 180
  OR minutes>duration OR env NOT IN ('HOME','BOX','GYM','OUTDOOR') OR jsonb_typeof(chosen) IS DISTINCT FROM 'array'
  OR jsonb_array_length(chosen) NOT BETWEEN 1 AND 8 THEN RAISE EXCEPTION 'INVALID_COMPOSER_WOD_CONTEXT'; END IF;
 SELECT o INTO spec FROM jsonb_array_elements(public.week_composer_mechanic_catalog_v2(p_user_id)->'options') o
 WHERE o->>'key'=m AND coalesce(o->>'variant_key','')=coalesce(variant,'');
 IF spec IS NULL THEN RETURN jsonb_build_object('status','NEEDS_RECOMPOSITION','reason','MECHANIC_UNAVAILABLE'); END IF;
 IF NOT (spec->>'entitled')::boolean THEN RETURN jsonb_build_object('status','NEEDS_RECOMPOSITION','reason','PREMIUM_REQUIRED'); END IF;
 contract:=spec->'contract'; count_ex:=jsonb_array_length(chosen);
 IF NOT coalesce((contract->>'found')::boolean,false) OR count_ex NOT BETWEEN (contract->>'min_exercises')::int AND (contract->>'max_exercises')::int
 THEN RETURN jsonb_build_object('status','NEEDS_RECOMPOSITION','reason','EXERCISE_COUNT','contract',contract); END IF;
 SELECT coalesce(array_agg(value),'{}') INTO equipment FROM jsonb_array_elements_text(coalesce(p_context->'equipment_names','[]'));
 SELECT coalesce(array_agg(value),'{}') INTO pain FROM jsonb_array_elements_text(coalesce(p_context->'pain_zones','[]'));
 inventory:=public.resolve_user_equipment_inventory(p_user_id,equipment,'c4-final-default');
 stimulus:=public.build_session_stimulus_target(focus,duration,readiness,region,intent,'c1-default');
 candidate:=jsonb_build_object('mechanic',m,'variant_key',variant,'exercises','[]'::jsonb,
  'c4_runtime_context',jsonb_build_object('source','W11_COMPOSER_V2','user_id',p_user_id,
   'readiness',readiness,'progression_intent',intent,'focus',focus,'target_region',region,'environment_code',env));
 FOR x IN SELECT value FROM jsonb_array_elements(chosen) LOOP
  IF nullif(x->>'id','') IS NULL OR x->>'id'=ANY(ids) THEN RAISE EXCEPTION 'INVALID_COMPOSER_WOD_IDS'; END IF;
  ids:=array_append(ids,x->>'id');
  IF NOT EXISTS(SELECT 1 FROM exercises WHERE id=x->>'id') OR NOT public.exercise_environment_eligible_v1(x->>'id',env)
   OR NOT public.exercise_safe_for_zones(x->>'id',public.normalize_body_zone_ids(pain))
   OR NOT public.exercise_equipment_compatible(x->>'id',inventory)
  THEN RETURN jsonb_build_object('status','NEEDS_RECOMPOSITION','reason','EXERCISE_INCOMPATIBLE','exercise_id',x->>'id'); END IF;
  sol:=public.c2_solver_prescription(p_user_id,x->>'id',stimulus,m,intent,inventory);
  IF jsonb_typeof(sol) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'MISSING_COMPOSER_C2_DOSE'; END IF;
  candidate:=jsonb_set(candidate,'{exercises}',candidate->'exercises'||jsonb_build_array(jsonb_build_object(
   'exercise_id',x->>'id','name',(SELECT coalesce(display_name,name) FROM exercises WHERE id=x->>'id'),'prescription',sol)));
 END LOOP;
 candidate:=public.c4_prepare_candidate(candidate,'c4-final-default');
 candidate:=public.c4_finalize_candidate(candidate,stimulus,duration,minutes,'c4-final-default','c3-sim-default');
 gate:=public.c4_candidate_quality_gate_v2(candidate,readiness,focus,region,public.normalize_body_zone_ids(pain),inventory,
  (SELECT max(technical_complexity) FROM exercises WHERE id=ANY(ids)),'c4-final-default');
 -- No replacement, ordering change or partial candidate is accepted.
 IF (SELECT array_agg(value->>'exercise_id' ORDER BY ordinality) FROM jsonb_array_elements(candidate->'exercises') WITH ORDINALITY) IS DISTINCT FROM ids
 THEN RAISE EXCEPTION 'COMPOSER_SELECTION_CHANGED'; END IF;
 params:=coalesce(candidate#>'{c4_final,mechanic_json,parameters}','{}');
 budget:=coalesce(nullif(candidate#>>'{c4_final,mechanic_json,wod_budget_minutes}','')::numeric,minutes);
 estimate:=nullif(candidate#>>'{c4_final,mechanic_json,predicted_elapsed_seconds}','')::numeric;
 result:=jsonb_build_object('source','C2+C3+C4_COMPOSER_V2','candidate',candidate,'parameters',params,
  'mechanic',m,'variant_key',variant,'duration_semantic',spec->>'duration_semantic',
  'time',jsonb_build_object('budget_minutes',minutes,'compiled_budget_minutes',budget,
   'prescribed_seconds',estimate,'duration_semantic',spec->>'duration_semantic'),'quality_gate',gate);
 IF NOT coalesce((candidate#>>'{c4_final,feasible}')::boolean,false) OR NOT coalesce((gate->>'pass')::boolean,false)
  OR candidate#>>'{athlete_workload_contract,pass}'='false' THEN
  RETURN result||jsonb_build_object('status','NEEDS_RECOMPOSITION','reason','C4_PROTOCOL_REJECTED',
   'reasons',coalesce(candidate#>'{c4_final,reasons}','[]')||coalesce(gate->'hard_gate_reasons','[]'));
 END IF;
 -- Use existing coach fit and history redundancy policies; no Composer bonus table.
 candidate:=candidate||jsonb_build_object('coach_score',public.c2_mechanic_fit(m,stimulus,intent),
   'c4_anti_redundancy',public.c4_redundancy_score_v5(p_user_id,candidate,'c4-final-default'));
 RETURN result||jsonb_build_object('status','READY','candidate',candidate);
END $$;

