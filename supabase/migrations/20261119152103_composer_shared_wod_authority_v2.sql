DO $guard$ BEGIN
 IF (select md5(pg_get_functiondef(oid)) from pg_proc where oid='public.week_compile_composer_day_j_v1(uuid,uuid,date,integer,text[],text[],text)'::regprocedure)<>'fc620affc9322ca5bb56cc474b32f567' OR
 (select md5(pg_get_functiondef(oid)) from pg_proc where oid='public.week_composer_prescription_preview_v1(uuid,jsonb,text[])'::regprocedure)<>'b4ed89aa70512840958166e487609fc2' OR
 (select md5(pg_get_functiondef(oid)) from pg_proc where oid='public.c4_finalize_candidate_pre_m72(jsonb,jsonb,integer,integer,text,text)'::regprocedure)<>'65a61f241142a9258d505349a15fd786'
 THEN RAISE EXCEPTION 'Concurrent function change: refresh before applying'; END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.c4_finalize_candidate_pre_m72(p_candidate jsonb, p_stimulus jsonb, p_total_duration_minutes integer, p_exact_wod_minutes integer DEFAULT NULL::integer, p_c4_policy_key text DEFAULT 'c4-final-default'::text, p_c3_policy_key text DEFAULT 'c3-sim-default'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  v_mechanic text:=upper(coalesce(p_candidate->>'mechanic',''));
  v_cap int;
  v_effective_exact int;
  v_result jsonb;
begin
  v_cap:=public.c4_mechanic_wod_cap_minutes(v_mechanic,p_c4_policy_key);
  v_effective_exact:=case
    when p_exact_wod_minutes is null then null
    when p_candidate#>>'{c4_runtime_context,source}'='W11_COMPOSER_V2'
      and nullif(p_candidate#>>'{c4_runtime_context,user_id}','')::uuid=auth.uid() then p_exact_wod_minutes
    else least(p_exact_wod_minutes,v_cap)
  end;

  v_result:=public.c4_finalize_candidate_pre_wod_caps(
    p_candidate,p_stimulus,p_total_duration_minutes,v_effective_exact,p_c4_policy_key,p_c3_policy_key
  );

  return jsonb_set(
    v_result,
    '{c4_final,wod_duration_guardrail}',
    jsonb_build_object(
      'mechanic',v_mechanic,
      'cap_minutes',v_cap,
      'requested_wod_minutes',p_exact_wod_minutes,
      'effective_wod_minutes',coalesce(v_effective_exact,nullif(v_result#>>'{c4_final,mechanic_json,wod_budget_minutes}','')::int),
      'cap_applied',v_effective_exact is distinct from p_exact_wod_minutes,
      'mode',case when v_effective_exact=p_exact_wod_minutes and p_exact_wod_minutes>v_cap then 'EXPLICIT_COMPOSER_BUDGET_WITH_C4_SAFETY' else 'STANDARD_CAP' end,
      'version','v1-mechanic-wod-cap-1'
    ),
    true
  );
end;
$function$

;
-- Explicit Composer adapter: C2 owns doses, C4 owns protocol, duration and safety.
CREATE OR REPLACE FUNCTION public.week_composer_mechanic_catalog_v2(p_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE tier text; options jsonb;
BEGIN
 IF auth.uid() IS NULL OR auth.uid()<>p_user_id THEN RAISE EXCEPTION 'FORBIDDEN_COMPOSER' USING ERRCODE='42501'; END IF;
 SELECT upper(coalesce(subscription_tier,'FREE')) INTO tier FROM profiles WHERE id=p_user_id;
 WITH catalog AS (
  SELECT m.mechanic_key key,NULL::text variant_key,m.display_name title,m.short_description description,
   m.duration_semantic,m.manual_free_eligible free,m.manual_premium_eligible premium
  FROM workout_mechanics m WHERE m.active AND m.mechanic_kind='core'
  UNION ALL
  SELECT v.mechanic_key,v.variant_key,v.display_name,v.short_description,m.duration_semantic,
   v.manual_free_eligible AND m.manual_free_eligible,v.manual_premium_eligible AND m.manual_premium_eligible
  FROM workout_mechanic_variants v JOIN workout_mechanics m USING(mechanic_key)
  WHERE v.active AND m.active AND m.mechanic_kind='core'
 ) SELECT coalesce(jsonb_agg(jsonb_build_object('key',key,'variant_key',variant_key,'title',title,
   'description',description,'duration_semantic',duration_semantic,
   'entitled',coalesce(free OR (tier='PREMIUM' AND premium),false),
   'premium',NOT free,'contract',public.c4_mechanic_composition_contract(key,variant_key))
   ORDER BY key,variant_key NULLS FIRST),'[]') INTO options FROM catalog;
 RETURN jsonb_build_object('options',options,'version','composer-catalog-v2');
END $$;

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
 stimulus:=public.build_session_stimulus_target(focus,duration,readiness,region,intent,'c4-final-default');
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

CREATE OR REPLACE FUNCTION public.week_composer_mechanic_recommendations_v2(p_user_id uuid,p_context jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s jsonb; a jsonb; candidates jsonb:='[]'; options jsonb:='[]'; unavailable jsonb:='[]'; ranked jsonb; selected jsonb; x jsonb;
 reason text; min_ex int; max_ex int;
BEGIN
 IF auth.uid() IS NULL OR auth.uid()<>p_user_id THEN RAISE EXCEPTION 'FORBIDDEN_COMPOSER' USING ERRCODE='42501'; END IF;
 FOR s IN SELECT value FROM jsonb_array_elements(public.week_composer_mechanic_catalog_v2(p_user_id)->'options') LOOP
  a:=public.week_composer_wod_authority_v2(p_user_id,p_context||jsonb_build_object('mechanic_key',s->>'key','variant_key',s->>'variant_key'));
  IF a->>'status'='READY' THEN
   candidates:=candidates||jsonb_build_array(a->'candidate');
   options:=options||jsonb_build_array(s||jsonb_build_object('available',true,'protocol',a-'candidate'));
  ELSE
   min_ex:=(s#>>'{contract,min_exercises}')::int; max_ex:=(s#>>'{contract,max_exercises}')::int;
   reason:=case a->>'reason' WHEN 'PREMIUM_REQUIRED' THEN 'Réservé à Premium.'
    WHEN 'EXERCISE_COUNT' THEN 'Choisis entre '||min_ex||' et '||max_ex||' mouvements pour ce format.'
    WHEN 'EXERCISE_INCOMPATIBLE' THEN 'Un mouvement ne convient pas au matériel, au lieu ou aux douleurs indiquées.'
    ELSE 'Le moteur ne valide pas ce protocole avec cette durée et ces mouvements. Ajuste la sélection ou la durée.' END;
   unavailable:=unavailable||jsonb_build_array(s||jsonb_build_object('available',false,'reason',reason,
     'reason_code',a->>'reason','details',a->'reasons'));
  END IF;
 END LOOP;
 IF jsonb_array_length(candidates)>0 THEN
  ranked:=public.c4_apply_quality_band_variety_v1(jsonb_build_object('status','READY',
   'selected_candidate',candidates->0,'accepted_candidates',candidates),coalesce(p_context->>'focus','General Fitness'),'c4-final-default');
  -- Freshness operates only within the existing quality band.
  SELECT jsonb_agg(value||jsonb_build_object('c4_selection_score',value->'p2_base_quality_score')) INTO candidates
   FROM jsonb_array_elements(ranked->'accepted_candidates');
  ranked:=jsonb_set(ranked,'{accepted_candidates}',candidates);
  ranked:=public.c4_apply_mechanic_freshness_tiebreak_v1(p_user_id,ranked,'c4-final-default');
  selected:=ranked->'selected_candidate';
  SELECT coalesce(jsonb_agg(o||jsonb_build_object('recommended',
   o->>'key'=selected->>'mechanic' AND coalesce(o->>'variant_key','')=coalesce(selected->>'variant_key',''),
   'score',c->'p2_base_quality_score') ORDER BY
   (o->>'key'=selected->>'mechanic' AND coalesce(o->>'variant_key','')=coalesce(selected->>'variant_key','')) DESC,
   (c->>'p2_base_quality_score')::numeric DESC,o->>'key',o->>'variant_key'),'[]') INTO options
  FROM jsonb_array_elements(options) o JOIN jsonb_array_elements(candidates) c
  ON c->>'mechanic'=o->>'key' AND coalesce(c->>'variant_key','')=coalesce(o->>'variant_key','');
 END IF;
 RETURN jsonb_build_object('version','composer-real-candidates-v2','options',options,'unavailable',unavailable,
  'quality_policy',ranked->'p2_variety_policy','freshness_policy',ranked->'mechanic_freshness_tiebreak');
END $$;
REVOKE ALL ON FUNCTION public.week_composer_mechanic_catalog_v2(uuid),public.week_composer_wod_authority_v2(uuid,jsonb),public.week_composer_mechanic_recommendations_v2(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.week_composer_mechanic_catalog_v2(uuid),public.week_composer_wod_authority_v2(uuid,jsonb),public.week_composer_mechanic_recommendations_v2(uuid,jsonb) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.week_composer_prescription_preview_v1(p_user_id uuid, p_draft jsonb, p_equipment_names text[] DEFAULT '{}'::text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
 b jsonb; x jsonb; sol jsonb; blocks jsonb:='[]'; exercises jsonb; inventory jsonb;
 k text; mechanic text; n int; count_ex int; sets_count int; rest_s int; rounds_count int;
 reps int; total int:=0; duration int; intent text; seen text[]:='{}';
 strength_plan jsonb; wod_plan jsonb;
BEGIN
 IF auth.uid() IS NULL OR auth.uid()<>p_user_id THEN
   RAISE EXCEPTION 'FORBIDDEN_PREVIEW' USING ERRCODE='42501';
 END IF;
 IF jsonb_typeof(p_draft #> '{architecture,blocks}')<>'array'
    OR jsonb_array_length(p_draft #> '{architecture,blocks}') NOT BETWEEN 1 AND 6 THEN
   RAISE EXCEPTION 'INVALID_PREVIEW_BLOCKS';
 END IF;
 duration:=NULLIF(p_draft->>'duration_minutes','')::int;
 IF duration NOT BETWEEN 15 AND 180 THEN RAISE EXCEPTION 'INVALID_PREVIEW_DURATION'; END IF;
 mechanic:=upper(coalesce(p_draft #>> '{mechanic,key}',''));
 intent:=coalesce(nullif(p_draft->>'progression_intent',''),'MAINTAIN');
 inventory:=public.resolve_user_equipment_inventory(p_user_id,coalesce(p_equipment_names,'{}'::text[]),'c4-final-default');
 FOR b IN SELECT value FROM jsonb_array_elements(p_draft #> '{architecture,blocks}') LOOP
   k:=upper(coalesce(b->>'type','')); n:=nullif(b->>'minutes','')::int;
   IF k NOT IN ('WARMUP','TABATA','STRENGTH','SKILL','WOD') OR n NOT BETWEEN 2 AND 90
     OR k=ANY(seen) OR jsonb_typeof(b->'exercises')<>'array'
     OR jsonb_array_length(b->'exercises') NOT BETWEEN 1 AND 8 THEN
     RAISE EXCEPTION 'INVALID_PREVIEW_BLOCK';
   END IF;
   seen:=array_append(seen,k); total:=total+n; count_ex:=jsonb_array_length(b->'exercises');

   if k='WOD' and p_draft->>'wod_engine_version'='C4_COMPOSER_V2' then
     wod_plan:=public.week_composer_wod_authority_v2(p_user_id,jsonb_build_object(
       'mechanic_key',mechanic,'variant_key',p_draft#>>'{mechanic,variant_key}',
       'session_minutes',duration,'block_minutes',n,'exercises',b->'exercises',
       'equipment_names',to_jsonb(p_equipment_names),'environment_code',p_draft->>'environment_code',
       'focus',p_draft#>>'{intent,focus}','target_region',p_draft->>'target_region',
       'progression_intent',intent,'readiness','normal'));
     if wod_plan->>'status'<>'READY' then
       return wod_plan||jsonb_build_object('block_type','WOD','block_minutes',n);
     end if;
     select jsonb_agg(jsonb_build_object('id',e->>'exercise_id','name',e->>'name',
       'reps',coalesce(e#>'{prescription,execution_target_reps}',e#>'{prescription,reps_min}'),
       'reps_semantics',e#>'{prescription,reps_semantics}',
       'duration_seconds',coalesce(e#>'{prescription,execution_target_seconds}',e#>'{prescription,duration_seconds}',e#>'{prescription,duration_seconds_min}'),
       'distance_meters',coalesce(e#>'{prescription,execution_target_distance_meters}',e#>'{prescription,distance_meters}',e#>'{prescription,distance_meters_min}'),
       'sets',e#>'{prescription,sets}','rest_seconds',e#>'{prescription,rest_seconds}',
       'load_kg',e#>'{prescription,load_kg}','load_scope',e#>'{prescription,load_scope}',
       'prescription_json',e->'prescription') ORDER BY ordinality) into exercises
       from jsonb_array_elements(wod_plan#>'{candidate,exercises}') WITH ORDINALITY e(e,ordinality);
     blocks:=blocks||jsonb_build_array(jsonb_build_object('type',k,'minutes',n,'mechanic',mechanic,
       'variant_key',p_draft#>>'{mechanic,variant_key}','parameters',wod_plan->'parameters',
       'time',wod_plan->'time','exercises',exercises,'source',wod_plan->>'source'));
     continue;
   end if;
   strength_plan:=null;
   if k='STRENGTH' then
     strength_plan:=public.week_composer_strength_authority_v2(
       p_user_id,b->'exercises',duration,n,intent,p_equipment_names,
       coalesce(nullif(p_draft#>>'{intent,focus}',''),'Strength'),
       nullif(p_draft->>'target_region',''),'normal',
       coalesce(nullif(p_draft->>'environment_code',''),'BOX')
     );
     if strength_plan->>'status'<>'READY' then
       return jsonb_build_object(
         'status','NEEDS_RECOMPOSITION',
         'reason','STRENGTH_BLOCK_TIME_MISMATCH',
         'block_type',k,'block_minutes',n,
         'time',strength_plan->'time',
         'calculated_exercises',strength_plan->'exercises',
         'source',strength_plan->>'source'
       );
     end if;
   end if;
   sets_count:=CASE WHEN k='WARMUP' THEN CASE WHEN n>=6 THEN 2 ELSE 1 END
     WHEN k='STRENGTH' THEN (strength_plan->>'sets')::int
     WHEN k='SKILL' THEN CASE WHEN n>=15 THEN 3 ELSE 2 END ELSE NULL END;
   rest_s:=CASE WHEN k='STRENGTH' THEN (strength_plan->>'rest_seconds')::int WHEN k='SKILL' THEN 60 ELSE NULL END;
   rounds_count:=CASE WHEN k='TABATA' THEN 8
     WHEN k='WOD' AND mechanic='EMOM' THEN floor(n::numeric/count_ex)::int
     WHEN k='WOD' AND mechanic='FOR_TIME' THEN greatest(1,least(5,floor(n::numeric/4)::int))
     WHEN k='WOD' AND mechanic='CIRCUIT' THEN greatest(2,least(4,floor(n::numeric/5)::int))
     WHEN k='WOD' AND mechanic='HIIT' THEN floor(n::numeric/count_ex)::int
     ELSE NULL END;
   exercises:='[]';
   FOR x IN SELECT value FROM jsonb_array_elements(b->'exercises') LOOP
     IF NOT EXISTS(SELECT 1 FROM public.exercises WHERE id=x->>'id') THEN
       RAISE EXCEPTION 'UNKNOWN_PREVIEW_EXERCISE';
     END IF;
     if k='STRENGTH' then
       select value->'solver_reference' into sol
       from jsonb_array_elements(strength_plan->'exercises') value
       where value->>'id'=x->>'id' limit 1;
     else
       sol:=public.c2_solver_prescription(p_user_id,x->>'id','{}'::jsonb,
         CASE WHEN k='SKILL' THEN 'STRENGTH' WHEN k='WOD' THEN mechanic ELSE k END,
         intent,inventory);
     end if;
     IF jsonb_typeof(sol)<>'object' THEN RAISE EXCEPTION 'MISSING_C2_PREVIEW'; END IF;
     reps:=coalesce(nullif(sol->>'reps_min','')::int,nullif(sol->>'reps_max','')::int);
     IF reps IS NOT NULL THEN
       if k='STRENGTH' then
         reps:=greatest(1,reps); -- Keep exact C2 dose used by C4 and Day J.
       else
         reps:=greatest(1,least(30,reps));
       end if;
       IF k='WOD' AND mechanic='EMOM' THEN reps:=least(10,reps); END IF;
     END IF;
     exercises:=exercises||jsonb_build_array(jsonb_build_object(
       'id',x->>'id','name',x->>'name','sets',sets_count,'rest_seconds',rest_s,
       'reps',CASE WHEN k='TABATA' THEN NULL ELSE reps END,
       'reps_semantics',sol->>'reps_semantics',
       'duration_seconds',CASE WHEN k<>'TABATA' AND reps IS NULL AND jsonb_typeof(sol->'duration_seconds_min')='number'
         THEN CASE WHEN k='STRENGTH' THEN (sol->>'duration_seconds_min')::int ELSE least(40,greatest(10,(sol->>'duration_seconds_min')::int)) END ELSE NULL END,
       'distance_meters',CASE WHEN k<>'TABATA' AND reps IS NULL AND jsonb_typeof(sol->'distance_meters_min')='number'
         THEN (sol->>'distance_meters_min')::int ELSE NULL END,
       'load_kg',CASE WHEN jsonb_typeof(sol->'load_kg')='number' THEN sol->'load_kg' ELSE NULL END,
       'load_scope',sol->'load_scope','band_resistance_label',sol->'band_resistance_label',
       'target_rpe_min',sol->'target_rpe_min','target_rpe_max',sol->'target_rpe_max',
       'evidence_count',sol->'valid_evidence_count',
       'intervals_per_exercise',CASE WHEN k='TABATA' AND 8%count_ex=0 THEN 8/count_ex ELSE NULL END,
       'work_seconds',CASE WHEN k='TABATA' THEN 20 ELSE NULL END,
       'solver_version',sol->'solver_version'));
   END LOOP;
   blocks:=blocks||jsonb_build_array(jsonb_build_object(
     'type',k,'minutes',n,'mechanic',CASE WHEN k='WOD' THEN mechanic ELSE NULL END,
     'rounds',rounds_count,'work_seconds',CASE WHEN k='TABATA' THEN 20 WHEN k='WOD' AND mechanic='HIIT' THEN 40 ELSE NULL END,
     'rest_seconds',CASE WHEN k='TABATA' THEN 10 WHEN k='WOD' AND mechanic='HIIT' THEN 20 ELSE NULL END,
     'exercises',exercises,'time',CASE WHEN k='STRENGTH' THEN strength_plan->'time' ELSE NULL END));
 END LOOP;
 IF total>duration THEN RAISE EXCEPTION 'PREVIEW_TIME_BUDGET_EXCEEDED'; END IF;
 RETURN jsonb_build_object('status','PREVIEW','version','composer-c2-preview-v1',
   'provisional',true,'duration_minutes',duration,'planned_block_minutes',total,'blocks',blocks,
   'shared_engine',true,'strength_authority','C2+C3+C4+UGEROD_TIME_ENGINE');
END;
$function$

;
CREATE OR REPLACE FUNCTION public.week_compile_composer_day_j_v1(p_user_id uuid, p_plan_item_id uuid, p_local_date date, p_readiness integer, p_pain_zones text[], p_available_equipment text[], p_environment_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_item public.user_training_plan_items%rowtype;
  v_draft jsonb;
  v_blocks jsonb;
  v_b jsonb;
  v_e jsonb;
  v_ex public.exercises%rowtype;
  v_inventory jsonb;
  v_mechanic text;
  v_env text;
  v_focus text;
  v_region text;
  v_intent text;
  v_duration integer;
  v_minutes integer;
  v_wod_minutes integer;
  v_total_minutes integer := 0;
  v_count integer;
  v_cycles integer;
  v_sets integer;
  v_rounds integer;
  v_rest integer;
  v_reps integer;
  v_reps_max integer;
  v_work integer;
  v_work_seconds integer;
  v_estimated_round_seconds integer;
  v_block_key text;
  v_type text;
  v_pres jsonb;
  v_solver jsonb;
  v_strength_plan jsonb;
  v_wod_plan jsonb;
  v_shared_wod boolean;
  v_params jsonb;
  v_ejson jsonb;
  v_out_blocks jsonb := '[]'::jsonb;
  v_out_exercises jsonb;
  v_ids text[] := '{}';
  v_block_ids text[] := '{}';
  v_keys text[] := '{}';
  v_id text;
  v_session_id uuid;
  v_exercise_instance_id uuid;
  v_active uuid;
  v_existing_status text;
  v_existing_source text;
  v_block_idx integer := 0;
  v_item_idx integer;
  v_wod_mechanic text;
  v_wod_params jsonb;
  v_pres_text text;
  v_rep_time integer;
  v_max_station integer;
  v_ctx jsonb;
  v_result jsonb;
  v_expected_stimulus jsonb;
begin
  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'Forbidden user' using errcode='42501';
  end if;
  if p_user_id is null or p_plan_item_id is null or p_local_date is null then
    raise exception 'Missing Composer identity/date';
  end if;
  if p_readiness is null or p_readiness not between 1 and 10 then
    raise exception 'READINESS_REQUIRED';
  end if;
  if p_pain_zones is null or cardinality(p_pain_zones)=0 then
    raise exception 'PAIN_CHECK_REQUIRED';
  end if;
  if p_available_equipment is null then
    raise exception 'EQUIPMENT_CONFIRMATION_REQUIRED';
  end if;
  if p_local_date < current_date-1 or p_local_date > current_date+1 then
    raise exception 'DAY_J_ONLY';
  end if;

  select * into v_item
  from public.user_training_plan_items
  where id=p_plan_item_id and user_id=p_user_id
  for update;
  if not found or v_item.recommended_date is distinct from p_local_date then
    raise exception 'COMPOSER_DAY_MISMATCH';
  end if;
  if v_item.session_id is not null then
    select status,planning_context_json->>'session_source'
      into v_existing_status,v_existing_source
    from public.workout_sessions
    where id=v_item.session_id and user_id=p_user_id;
    if v_existing_source='W11_COMPOSER_DAY_J' then
      return jsonb_build_object('status','ALREADY_READY','session_id',v_item.session_id,
        'session_status',v_existing_status,'plan_item_id',v_item.id,'idempotent',true);
    end if;
    raise exception 'PLAN_ITEM_ALREADY_BOUND_TO_ANOTHER_SESSION';
  end if;
  if v_item.status not in ('available','claimed') then
    raise exception 'PLAN_ITEM_NOT_EDITABLE';
  end if;
  select id into v_active from public.workout_sessions
  where user_id=p_user_id and generation_local_date=p_local_date and status in ('generated','in_progress')
  order by generated_at desc limit 1;
  if v_active is not null then
    return jsonb_build_object('status','OTHER_SESSION_ACTIVE','session_id',v_active,
      'plan_item_id',v_item.id,'idempotent',false);
  end if;

  v_draft:=v_item.planning_context_json #> '{w11,composer_draft}';
  if jsonb_typeof(v_draft)<>'object' or coalesce(v_draft->>'version','')<>'w11-composer-draft-v1' then
    raise exception 'COMPOSER_DRAFT_NOT_FOUND';
  end if;
  if coalesce((v_draft->>'structure_stable')::boolean,false)<>true then
    raise exception 'UNSTABLE_COMPOSITION';
  end if;
  v_shared_wod:=coalesce(v_draft->>'wod_engine_version','')='C4_COMPOSER_V2';
  v_blocks:=v_draft #> '{architecture,blocks}';
  if jsonb_typeof(v_blocks)<>'array' or jsonb_array_length(v_blocks) not between 1 and 6 then
    raise exception 'COMPOSER_BLOCKS_INVALID';
  end if;
  v_duration:=nullif(v_draft->>'duration_minutes','')::integer;
  if v_duration is null or v_duration not between 15 and 180 then
    raise exception 'COMPOSER_DURATION_INVALID';
  end if;
  v_env:=upper(coalesce(v_draft->>'environment_code',''));
  if v_env not in ('HOME','BOX','GYM','OUTDOOR')
     or v_env<>upper(coalesce(p_environment_code,'')) then
    raise exception 'ENVIRONMENT_CHANGED_REQUIRES_RECOMPOSITION';
  end if;
  -- Outdoor needs the same explicit terrain gate as the standard generator.
  if v_env='OUTDOOR' and nullif(v_item.planning_context_json #>> '{w11,future_context,surface_code}','') is null then
    raise exception 'OUTDOOR_SURFACE_REQUIRED';
  end if;
  v_region:=nullif(v_draft->>'target_region','');
  v_focus:=coalesce(nullif(v_draft#>>'{intent,focus}',''),'General Fitness');
  v_intent:=coalesce(nullif(v_item.planned_progression_intent,''),'MAINTAIN');
  v_inventory:=public.resolve_user_equipment_inventory(p_user_id,p_available_equipment,'c4-final-default');
  v_mechanic:=upper(coalesce(v_draft#>>'{mechanic,key}',''));
  if exists(select 1 from jsonb_array_elements(v_blocks) b where upper(b->>'type')='WOD') then
    if not v_shared_wod and (v_mechanic not in ('AMRAP','EMOM','FOR_TIME','CIRCUIT','HIIT')
       or not exists(select 1 from public.workout_mechanics m where m.mechanic_key=v_mechanic
          and m.active and m.mechanic_kind='core' and m.manual_free_eligible)) then
      raise exception 'COMPOSER_MECHANIC_NOT_EXECUTABLE_%',v_mechanic;
    end if;
  end if;

  -- Preflight the entire user-selected structure before creating anything.
  for v_b in select value from jsonb_array_elements(v_blocks) loop
    v_block_ids:='{}'; -- separate uniqueness per authored block
    v_type:=upper(coalesce(v_b->>'type',''));
    if v_type not in ('WARMUP','TABATA','STRENGTH','SKILL','WOD') then
      raise exception 'COMPOSER_UNSUPPORTED_BLOCK_%',v_type;
    end if;
    if v_type=any(v_keys) then raise exception 'COMPOSER_DUPLICATE_BLOCK_%',v_type; end if;
    v_keys:=array_append(v_keys,v_type);
    v_minutes:=nullif(v_b->>'minutes','')::integer;
    if v_minutes is null or v_minutes<2 or v_minutes>90 then
      raise exception 'COMPOSER_INVALID_BLOCK_DURATION_%',v_type;
    end if;
    if v_type='TABATA' and v_minutes<>4 then
      raise exception 'TABATA_MUST_BE_4_MINUTES';
    end if;
    v_total_minutes:=v_total_minutes+v_minutes;
    if jsonb_typeof(v_b->'exercises')<>'array' or jsonb_array_length(v_b->'exercises')=0
       or jsonb_array_length(v_b->'exercises')>8 then
      raise exception 'COMPOSER_BLOCK_EXERCISES_INVALID_%',v_type;
    end if;
    if v_type='WOD' and v_mechanic='EMOM'
       and v_minutes<jsonb_array_length(v_b->'exercises') then
      raise exception 'EMOM_TOO_SHORT_FOR_STATIONS';
    end if;
    for v_e in select value from jsonb_array_elements(v_b->'exercises') loop
      v_id:=v_e->>'id';
      if v_id is null or v_id=any(v_block_ids) then
        raise exception 'COMPOSER_DUPLICATE_OR_MISSING_EXERCISE_%',coalesce(v_id,'null');
      end if;
      v_block_ids:=array_append(v_block_ids,v_id);
      v_ids:=array_append(v_ids,v_id);
      select * into v_ex from public.exercises where id=v_id;
      if not found then raise exception 'COMPOSER_UNKNOWN_EXERCISE_%',v_id; end if;
      if not public.exercise_environment_eligible_v1(v_id,v_env)
        or not public.exercise_safe_for_zones(v_id,public.normalize_body_zone_ids(p_pain_zones))
        or not public.exercise_equipment_compatible(v_id,v_inventory) then
        raise exception 'COMPOSER_EXERCISE_INCOMPATIBLE_%',v_id;
      end if;
      if v_type='WARMUP' and not coalesce(v_ex.warmup_eligible,false) then
        raise exception 'COMPOSER_NOT_WARMUP_ELIGIBLE_%',v_id;
      end if;
      if v_type='TABATA' and not coalesce(v_ex.tabata_eligible,false) then
        raise exception 'COMPOSER_NOT_TABATA_ELIGIBLE_%',v_id;
      end if;
    end loop;
  end loop;
  if v_total_minutes>v_duration then
    raise exception 'COMPOSER_TIME_BUDGET_EXCEEDED';
  end if;

  -- Store the selected workload as an explicit user-authored expected-stimulus
  -- contract; the generic C4 target policy may not support every Composer focus.
  begin
    v_expected_stimulus:=public.build_session_stimulus_target(v_focus,v_duration,
      p_readiness::text,v_region,v_intent,'c4-final-default');
  exception when others then
    v_expected_stimulus:=jsonb_build_object(
      'stimulus_model_status','USER_AUTHORED_NOT_AUTO_DERIVED');
  end;
  v_expected_stimulus:=coalesce(v_expected_stimulus,'{}'::jsonb)||
    jsonb_build_object('source','W11_COMPOSER_DAY_J','user_authored',true,
      'focus',v_focus,'duration_minutes',v_duration,'readiness',p_readiness,
      'target_region',v_region,'progression_intent',v_intent,
      'auto_generation_used',false);

  -- A single transaction owns both the session and every exercise; any failed
  -- dose, compatibility or density check rolls everything back.
  v_session_id:=gen_random_uuid();
  insert into public.workout_sessions (
    id,user_id,status,duration_minutes,target_region,readiness,focus,
    available_equipment,injured_zones,generated_at,progression_intent,
    generated_workout,planning_context_json,expected_stimulus_json,quality_gate_json,generation_local_date,
    planned_environment_code,planned_environment_source,planned_environment_selected_at,planned_surface_code
  ) values (
    v_session_id,p_user_id,'generated',v_duration,v_region,p_readiness::text,v_focus,
    p_available_equipment,p_pain_zones,now(),v_intent,
    jsonb_build_object('version','w11-composer-player-v1','blocks','[]'::jsonb),
    jsonb_build_object('session_source','W11_COMPOSER_DAY_J','plan_item_id',v_item.id,
      'composer_draft',v_draft,'user_block_order_preserved',true,'day_j_readiness',p_readiness),
    v_expected_stimulus,
    jsonb_build_object('source','w11-composer-finalizer-v1','pass',true,
      'user_exercise_choices_preserved',true,'time_budget_minutes',v_duration),
    p_local_date,v_env,'USER_COMPOSER',now(),
    nullif(v_item.planning_context_json #>> '{w11,future_context,surface_code}','')
  );

  for v_b in select value from jsonb_array_elements(v_blocks) loop
    v_block_idx:=v_block_idx+1;
    v_type:=upper(v_b->>'type');
    v_minutes:=(v_b->>'minutes')::integer;
    v_count:=jsonb_array_length(v_b->'exercises');
    v_block_key:=case v_type when 'WARMUP' then 'warm_up'
      when 'TABATA' then 'tabata' when 'STRENGTH' then 'strength'
      when 'SKILL' then 'skill' else 'wod' end;
    v_params:='{}'::jsonb;
    v_rounds:=null;
    v_rest:=null;
    v_wod_minutes:=v_minutes;
    v_wod_plan:=null;
    if v_type='WOD' and v_shared_wod then
      v_wod_plan:=public.week_composer_wod_authority_v2(p_user_id,jsonb_build_object(
        'mechanic_key',v_mechanic,'variant_key',v_draft#>>'{mechanic,variant_key}',
        'session_minutes',v_duration,'block_minutes',v_minutes,'exercises',v_b->'exercises',
        'equipment_names',to_jsonb(p_available_equipment),'environment_code',v_env,'focus',v_focus,
        'target_region',v_region,'progression_intent',v_intent,'readiness',p_readiness::text,
        'pain_zones',to_jsonb(p_pain_zones)));
      if v_wod_plan->>'status'<>'READY' then
        raise exception 'COMPOSER_WOD_RECOMPOSITION_REQUIRED_%',v_wod_plan->>'reason';
      end if;
      v_params:=v_wod_plan->'parameters';
      v_sets:=null;
    elsif v_type='WARMUP' then
      v_sets:=case when v_minutes>=6 then 2 else 1 end;
      v_params:=jsonb_build_object('rounds',v_sets);
    elsif v_type='TABATA' then
      v_sets:=1;
      v_params:=jsonb_build_object('rounds',8,'work_seconds',20,'rest_seconds',10,
        'duration_minutes',4,'exercise_count',v_count);
    elsif v_type='STRENGTH' then
      v_strength_plan:=public.week_composer_strength_authority_v2(
        p_user_id,v_b->'exercises',v_duration,v_minutes,v_intent,
        p_available_equipment,v_focus,v_region,
        public.normalize_session_readiness(p_readiness::text),v_env
      );
      if v_strength_plan->>'status'<>'READY' then
        raise exception 'COMPOSER_STRENGTH_RECOMPOSITION_REQUIRED_%',v_strength_plan->>'status';
      end if;
      v_sets:=(v_strength_plan->>'sets')::int;
      v_rest:=(v_strength_plan->>'rest_seconds')::int;
      v_params:=jsonb_build_object(
        'sets',v_sets,'rest_seconds',v_rest,'duration_minutes',v_minutes,
        'dose_authority',v_strength_plan->>'source','time',v_strength_plan->'time'
      );
    elsif v_type='SKILL' then
      v_sets:=case when v_minutes>=15 then 3 else 2 end;
      v_rest:=60;
      v_params:=jsonb_build_object('sets',v_sets,'rest_seconds',v_rest,'duration_minutes',v_minutes);
    else
      v_sets:=null;
      if v_mechanic='EMOM' then
        v_cycles:=floor(v_minutes::numeric/v_count)::integer;
        v_wod_minutes:=v_cycles*v_count;
        v_params:=jsonb_build_object('duration_minutes',v_wod_minutes,
          'cycles',v_cycles,'station_seconds',60,'exercise_count',v_count,
          'transition_budget_minutes',v_minutes-v_wod_minutes);
      elsif v_mechanic='AMRAP' then
        v_params:=jsonb_build_object('duration_minutes',v_minutes,'exercise_count',v_count);
      elsif v_mechanic='FOR_TIME' then
        v_rounds:=greatest(1,least(5,floor(v_minutes::numeric/4)::integer));
        v_params:=jsonb_build_object('rounds',v_rounds,'time_cap_minutes',v_minutes,
          'cap_seconds',v_minutes*60);
      elsif v_mechanic='CIRCUIT' then
        v_rounds:=greatest(2,least(4,floor(v_minutes::numeric/5)::integer));
        v_params:=jsonb_build_object('rounds',v_rounds,'rest_seconds',45,'rest_between_rounds_seconds',45,
          'duration_minutes',v_minutes);
      elsif v_mechanic='HIIT' then
        v_cycles:=floor(v_minutes::numeric/v_count)::integer;
        if v_cycles<2 then raise exception 'HIIT_TOO_SHORT_FOR_STATIONS'; end if;
        v_wod_minutes:=v_cycles*v_count;
        v_params:=jsonb_build_object('rounds',v_cycles,'exercise_count',v_count,
          'work_seconds',40,'rest_seconds',20,'duration_minutes',v_wod_minutes,
          'transition_budget_minutes',v_minutes-v_wod_minutes);
      end if;
    end if;
    v_estimated_round_seconds:=0;
    v_out_exercises:='[]'::jsonb;
    v_item_idx:=0;
    for v_e in select value from jsonb_array_elements(v_b->'exercises') loop
      v_item_idx:=v_item_idx+1;
      v_id:=v_e->>'id';
      select * into v_ex from public.exercises where id=v_id;
      if v_wod_plan is not null then
        select value->'prescription' into v_pres from jsonb_array_elements(v_wod_plan#>'{candidate,exercises}')
        where value->>'exercise_id'=v_id;
        if v_pres is null then raise exception 'COMPOSER_WOD_DOSE_MISSING'; end if;
        v_solver:=v_pres;
      else
      if v_type='STRENGTH' then
        select value->'solver_reference' into v_solver
        from jsonb_array_elements(v_strength_plan->'exercises') value
        where value->>'id'=v_id limit 1;
      else
        v_solver:=public.c2_solver_prescription(p_user_id,v_id,'{}'::jsonb,
          case when v_type='WARMUP' then 'WARMUP'
            when v_type='TABATA' then 'TABATA'
            when v_type='SKILL' then 'STRENGTH'
            else v_mechanic end,v_intent,v_inventory);
      end if;
      if jsonb_typeof(v_solver)<>'object' then raise exception 'COMPOSER_DOSE_UNAVAILABLE_%',v_id; end if;
      v_reps:=case when jsonb_typeof(v_solver->'reps_min')='number'
        then (v_solver->>'reps_min')::integer else null end;
      v_reps_max:=case when jsonb_typeof(v_solver->'reps_max')='number'
        then (v_solver->>'reps_max')::integer else null end;
      v_reps:=coalesce(v_reps,v_reps_max);
      v_pres:=jsonb_build_object('source','w11_composer_day_j_v1','finalized',true,
        'tracking_modes',coalesce(to_jsonb(v_ex.tracking_modes),'[]'::jsonb),
        'target_rpe_min',v_solver->'target_rpe_min','target_rpe_max',v_solver->'target_rpe_max',
        'solver_reference',v_solver,'duration_budget_minutes',v_minutes);
      if v_type='TABATA' then
        v_pres:=v_pres||jsonb_build_object('mechanic','TABATA','protocol',
          jsonb_build_object('rounds',8,'work_seconds',20,'rest_seconds',10),
          'duration_seconds',20,'text','20 s effort / 10 s récupération · 4 cycles par mouvement');
      elsif v_reps is not null and v_reps>0 then
        -- Strength doses are owned by C2/C4; do not apply a second cap.
        if v_type='STRENGTH' then
          v_reps:=greatest(1,v_reps);
        else
          v_reps:=greatest(1,least(v_reps,30));
        end if;
        -- Keep a real rest window inside each EMOM minute. Cap prescribed reps
        -- from the solver, never increase them to fill the available minute.
        if v_type='WOD' and v_mechanic='EMOM' then
          v_reps:=least(v_reps,10);
        end if;
        v_rep_time:=case when v_type='WOD' then 4 else 5 end;
        v_work_seconds:=v_reps*v_rep_time;
        v_estimated_round_seconds:=v_estimated_round_seconds+v_work_seconds+10;
        if v_type='WOD' and v_mechanic='EMOM' and v_work_seconds>42 then
          v_reps:=greatest(1,floor(42.0/v_rep_time)::integer);
          v_work_seconds:=v_reps*v_rep_time;
        end if;
        v_pres:=v_pres||jsonb_build_object('reps_min',v_reps,'reps_max',v_reps,
          'reps_semantics',coalesce(v_solver->>'reps_semantics','total'));
        if v_sets is not null then
          v_pres:=v_pres||jsonb_build_object('sets',v_sets,'rest_seconds',coalesce(v_rest,0));
        end if;
        v_pres:=v_pres||jsonb_build_object('text',
          case when v_sets is not null then v_sets||' × ' else '' end||v_reps||' reps');
      elsif jsonb_typeof(v_solver->'duration_seconds_min')='number' then
        v_work_seconds:=case when v_type='STRENGTH' then
          (v_solver->>'duration_seconds_min')::integer
          else least(40,greatest(10,(v_solver->>'duration_seconds_min')::integer)) end;
        v_estimated_round_seconds:=v_estimated_round_seconds+v_work_seconds+10;
        v_pres:=v_pres||jsonb_build_object('duration_seconds',v_work_seconds,
          'text',v_work_seconds||' s');
      elsif jsonb_typeof(v_solver->'distance_meters_min')='number' then
        v_pres:=v_pres||jsonb_build_object('distance_meters',
          (v_solver->>'distance_meters_min')::integer,
          'text',(v_solver->>'distance_meters_min')||' m');
        v_estimated_round_seconds:=v_estimated_round_seconds+45;
      else
        raise exception 'COMPOSER_EXERCISE_DOSE_NOT_ACTIONABLE_%',v_id;
      end if;
      -- Numeric loads only from confirmed engine prescriptions (never inferred).
      if jsonb_typeof(v_solver->'load_kg')='number' then
        v_pres:=v_pres||jsonb_build_object('load_kg',v_solver->'load_kg',
          'load_scope',v_solver->'load_scope');
      end if;
      end if; -- canonical WOD prescriptions bypass the legacy scalar formatter
      v_exercise_instance_id:=gen_random_uuid();
      insert into public.workout_session_exercises (
        id,session_id,exercise_id,exercise_name,block_key,position,status,
        prescription,prescription_json,expected_outcome_json,
        expected_rpe_min,expected_rpe_max,solver_decision_json,selection_provenance,user_execution_status
      ) values (
        v_exercise_instance_id,v_session_id,v_id,coalesce(v_ex.display_name,v_ex.name),
        v_block_key,v_item_idx,'pending',v_pres->>'text',v_pres,v_pres,
        nullif(v_pres->>'target_rpe_min','')::numeric,
        nullif(v_pres->>'target_rpe_max','')::numeric,
        jsonb_build_object('source','w11_composer_day_j_v1','selection_provenance','USER_COMPOSER',
          'solver_source',v_solver->>'solver_version','original_block_type',v_type),
        'USER_SELECTED','pending'
      );
      v_ejson:=jsonb_build_object('id',v_id,'exercise_id',v_id,
        'session_exercise_id',v_exercise_instance_id,
        'name',coalesce(v_ex.display_name,v_ex.name),
        'family',v_ex.exercise_family,'region',v_ex.body_region,
        'pattern',v_ex.movement_pattern,'tracking_modes',to_jsonb(v_ex.tracking_modes),
        'prescription',v_pres,'prescription_json',v_pres);
      v_out_exercises:=v_out_exercises||jsonb_build_array(v_ejson);
    end loop;
    if v_type='WOD' and v_wod_plan is null and (
       (v_mechanic='AMRAP' and v_estimated_round_seconds>v_minutes*60*0.85)
       or (v_mechanic in ('FOR_TIME','CIRCUIT')
         and (v_estimated_round_seconds*v_rounds
            + greatest(0,v_rounds-1)*coalesce(v_params->>'rest_seconds','0')::integer)>v_minutes*60*0.85)
       ) then
      raise exception 'COMPOSER_DENSITY_EXCEEDS_BUDGET';
    end if;
    if v_type='WOD' then
      v_wod_mechanic:=v_mechanic;
      v_wod_params:=v_params;
    end if;
    v_out_blocks:=v_out_blocks||jsonb_build_array(jsonb_build_object(
      'block_key',v_block_key,'block_name',coalesce(v_b->>'label',initcap(v_type)),
      'module_code',v_type,'duration_minutes',v_wod_minutes,
      'mechanic',case when v_type='WOD' then v_mechanic when v_type='STRENGTH' then 'SETS_REPS'
        when v_type='TABATA' then 'TABATA' when v_type='WARMUP' then 'WARMUP' else 'SKILL' end,
      'mechanic_json',jsonb_build_object(
        'mechanic_key',case when v_type='WOD' then v_mechanic when v_type='STRENGTH' then 'SETS_REPS'
        when v_type='TABATA' then 'TABATA' when v_type='WARMUP' then 'WARMUP' else 'SKILL' end,
        'variant_key',case when v_type='WOD' and v_shared_wod then v_draft#>>'{mechanic,variant_key}' else null end,
        'parameters',v_params,'source','W11_COMPOSER_DAY_J'),
      'exercises',v_out_exercises,'user_editable',true,'manual_selection',true,
      'block_order',v_block_idx
    ));
  end loop;

  update public.workout_sessions
    set generated_workout=jsonb_build_object('version','w11-composer-player-v1',
      'meta',jsonb_build_object('source','w11_composer','plan_item_id',v_item.id,'environment_code',v_env,
        'focus',v_focus,'target_region',v_region,'total_duration_minutes',v_duration,
        'day_j_dose_finalized',true,'original_selection_preserved',true),
      'blocks',v_out_blocks),
      mechanic_json=case when v_wod_mechanic is null then '{}'::jsonb else
        jsonb_build_object('mechanic_key',v_wod_mechanic,
          'variant_key',case when v_shared_wod then v_draft#>>'{mechanic,variant_key}' else null end,
          'parameters',v_wod_params,'source','W11_COMPOSER_DAY_J') end,
      updated_at=now()
    where id=v_session_id;
  update public.user_training_plan_items
    set session_id=v_session_id,status='claimed',claimed_at=coalesce(claimed_at,now()),
      updated_at=now()
    where id=v_item.id;
  return jsonb_build_object('status','READY','session_id',v_session_id,
    'plan_item_id',v_item.id,'idempotent',false,
    'block_count',jsonb_array_length(v_out_blocks),
    'exercise_count',cardinality(v_ids),
    'mechanic',v_wod_mechanic,
    'duration_minutes',v_duration,'planned_block_minutes',v_total_minutes,
    'source','W11_COMPOSER_DAY_J_V1');
end;
$function$

;
