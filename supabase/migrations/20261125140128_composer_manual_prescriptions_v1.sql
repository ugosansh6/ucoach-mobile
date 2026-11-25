-- User-owned Composer prescriptions, applied after existing sport authorities.
CREATE OR REPLACE FUNCTION public.week_composer_manual_integer_v1(v jsonb,lo int,hi int)
RETURNS int LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path TO public,pg_temp AS $$
DECLARE n numeric;
BEGIN
 IF jsonb_typeof(v) IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'COMPOSER_MANUAL_INVALID_NUMBER'; END IF;
 n:=(v#>>'{}')::numeric;
 IF n<>trunc(n) OR n<lo OR n>hi THEN RAISE EXCEPTION 'COMPOSER_MANUAL_INVALID_NUMBER'; END IF;
 RETURN n::int;
END $$;

CREATE OR REPLACE FUNCTION public.week_composer_manual_exercise_v1(p_id text,p_base jsonb,p_edit jsonb,p_type text,p_mechanic text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path TO public,pg_temp AS $$
DECLARE r jsonb:=p_base; e jsonb:=coalesce(p_edit,'{}'); k text; v jsonb; n int; ov jsonb; mode text; suffix text;
BEGIN
 IF p_type IN ('SKILL','STRENGTH') AND coalesce(r->>'execution_target_duration_seconds',r->>'duration_seconds',r->>'duration_seconds_min') IS NOT NULL
 AND coalesce(r->>'execution_target_reps',r->>'reps',r->>'reps_min') IS NULL
 AND r->>'duration_semantics' IS NULL
 AND EXISTS(SELECT 1 FROM exercises WHERE id=p_id AND movement_side='Unilateral' AND 'time'=ANY(tracking_modes))
 THEN r:=r||jsonb_build_object('duration_semantics','per_side'); END IF;
 IF e='{}' THEN RETURN r; END IF;
 IF jsonb_typeof(e) IS DISTINCT FROM 'object' OR p_type NOT IN ('SKILL','STRENGTH','WOD') OR coalesce((r->>'test_score_required')::boolean,false) OR r->>'test_attempts' IS NOT NULL THEN RAISE EXCEPTION 'COMPOSER_MANUAL_UNSUPPORTED_DOSE'; END IF;
 IF p_type='WOD' AND p_mechanic IN ('DECK','HIIT') THEN RAISE EXCEPTION 'COMPOSER_MANUAL_UNSUPPORTED_DOSE'; END IF;
 FOR k,v IN SELECT key,value FROM jsonb_each(e) LOOP
  IF k='reps' AND coalesce(r->>'execution_target_reps',r->>'reps',r->>'reps_min') IS NOT NULL THEN
   n:=public.week_composer_manual_integer_v1(v,1,500);
   r:=r||jsonb_build_object('reps',n,'reps_min',n,'reps_max',n,'execution_target_reps',n);
   ov:=coalesce(r->'mechanic_overlay','{}');
   IF p_mechanic='PYRAMID' THEN ov:=ov||jsonb_build_object('base_reps',n);
   ELSIF p_mechanic IN ('LADDER','COUPLET','PROGRESSIVE_INTERVAL') THEN ov:=(ov-'first_stage_reps')||jsonb_build_object('start_reps',n);
   ELSIF p_mechanic='CHIPPER' THEN ov:=ov||jsonb_build_object('scaled_reps',n);
   ELSIF p_mechanic='REP_TARGET' THEN ov:=ov||jsonb_build_object('target_reps',n); END IF;
   IF ov<>'{}' THEN r:=r||jsonb_build_object('mechanic_overlay',ov); END IF;
  ELSIF p_type IN ('SKILL','STRENGTH') AND k='sets' AND r->>'sets' IS NOT NULL THEN
   n:=public.week_composer_manual_integer_v1(v,1,50);r:=r||jsonb_build_object('sets',n);
  ELSIF p_type IN ('SKILL','STRENGTH') AND k='rest_seconds' THEN
   n:=public.week_composer_manual_integer_v1(v,0,1800);r:=r||jsonb_build_object('rest_seconds',n,'rest_between_sets_seconds',n);
  ELSIF k='duration_seconds' AND p_type IN ('SKILL','STRENGTH') AND coalesce(r->>'execution_target_reps',r->>'reps',r->>'reps_min') IS NULL
    AND coalesce(r->>'execution_target_duration_seconds',r->>'duration_seconds',r->>'duration_seconds_min') IS NOT NULL THEN
   n:=public.week_composer_manual_integer_v1(v,1,1800);r:=r||jsonb_build_object('duration_seconds',n,'duration_seconds_min',n,'duration_seconds_max',n,'execution_target_duration_seconds',n);
  ELSE RAISE EXCEPTION 'COMPOSER_MANUAL_UNSUPPORTED_FIELD_%',k;
  END IF;
 END LOOP;
 IF coalesce(r->>'execution_target_reps',r->>'reps',r->>'reps_min') IS NOT NULL THEN
  mode:=coalesce(r->>'execution_target_reps',r->>'reps',r->>'reps_min')||' reps';suffix:=CASE WHEN r->>'reps_semantics'='per_side' THEN ' / côté' ELSE '' END;
 ELSIF coalesce(r->>'execution_target_duration_seconds',r->>'duration_seconds',r->>'duration_seconds_min') IS NOT NULL THEN
  mode:=coalesce(r->>'execution_target_duration_seconds',r->>'duration_seconds',r->>'duration_seconds_min')||' s';suffix:=CASE WHEN r->>'duration_semantics'='per_side' THEN ' / côté' ELSE '' END;
 ELSE mode:=coalesce(r->>'distance_meters',r->>'execution_target_distance_meters',r->>'distance_meters_min')||' m';suffix:=''; END IF;
 RETURN r||jsonb_build_object('text',CASE WHEN p_type<>'WOD' AND r->>'sets' IS NOT NULL THEN (r->>'sets')||' × ' ELSE '' END||mode||suffix,
  'manual_dose',e,'manual_recommendation',jsonb_strip_nulls(jsonb_build_object('sets',p_base->'sets','reps',coalesce(p_base->'execution_target_reps',p_base->'reps',p_base->'reps_min'),'duration_seconds',coalesce(p_base->'execution_target_duration_seconds',p_base->'duration_seconds',p_base->'duration_seconds_min'),'rest_seconds',p_base->'rest_seconds')));
END $$;

CREATE OR REPLACE FUNCTION public.week_composer_manual_unit_v1(p_id text,p_pres jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path TO public,pg_temp AS $$
DECLARE r jsonb:=p_pres; n numeric; u jsonb;
BEGIN
 n:=coalesce((r->>'execution_target_reps')::numeric,(r->>'reps')::numeric,(r->>'reps_min')::numeric);
 IF n>0 THEN r:=(r-ARRAY['duration_seconds_min','duration_seconds_max','distance_meters_min','distance_meters_max'])||jsonb_build_object('reps_min',n,'reps_max',n);
 ELSE
  n:=coalesce((r->>'execution_target_duration_seconds')::numeric,(r->>'duration_seconds')::numeric,(r->>'duration_seconds_min')::numeric);
  IF n>0 THEN r:=r||jsonb_build_object('duration_seconds_min',n,'duration_seconds_max',n);
  ELSE n:=coalesce((r->>'execution_target_distance_meters')::numeric,(r->>'distance_meters')::numeric,(r->>'distance_meters_min')::numeric);IF n>0 THEN r:=r||jsonb_build_object('distance_meters_min',n,'distance_meters_max',n);END IF; END IF;
 END IF;
 u:=public.c3_unit_estimate(p_id,r,'c3-sim-default');
 IF p_pres->>'duration_semantics'='per_side' AND (u->>'duration_seconds')::numeric>0 THEN u:=jsonb_set(u,'{estimated_active_work_seconds}',to_jsonb((u->>'estimated_active_work_seconds')::numeric*2));END IF;
 RETURN u;
END $$;

CREATE OR REPLACE FUNCTION public.week_composer_manual_series_preview_v1(p_block jsonb,p_authored jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path TO public,pg_temp AS $$
DECLARE output jsonb:='[]'; x jsonb; e jsonb; pres jsonb; u jsonb; elapsed numeric:=0; sets int; edited boolean:=false; t jsonb;
BEGIN
 FOR x IN SELECT value FROM jsonb_array_elements(p_block->'exercises') LOOP
  SELECT value->'manual_dose' INTO e FROM jsonb_array_elements(p_authored->'exercises') WHERE value->>'id'=x->>'id';
  pres:=public.week_composer_manual_exercise_v1(x->>'id',coalesce(x->'prescription_json','{}')||(x-'prescription_json'),e,p_block->>'type',null);
  IF coalesce(e,'{}')<>'{}' OR coalesce(pres->'manual_dose','{}')<>'{}' OR pres->>'duration_semantics'='per_side' THEN
   edited:=true;
   x:=x||jsonb_strip_nulls(jsonb_build_object('sets',pres->'sets','reps',coalesce(pres->'execution_target_reps',pres->'reps'),'duration_seconds',coalesce(pres->'execution_target_duration_seconds',pres->'duration_seconds'),'rest_seconds',pres->'rest_seconds','duration_semantics',pres->'duration_semantics','prescription_json',pres));
  END IF;
  u:=public.week_composer_manual_unit_v1(x->>'id',pres);sets:=coalesce((pres->>'sets')::int,1);
  elapsed:=elapsed+sets*((u->>'estimated_active_work_seconds')::numeric+(u->>'estimated_transition_seconds')::numeric)+greatest(0,sets-1)*coalesce((pres->>'rest_between_sets_seconds')::numeric,(pres->>'rest_seconds')::numeric,0);
  output:=output||jsonb_build_array(x);
 END LOOP;
 IF NOT edited THEN RETURN p_block; END IF;
 t:=(coalesce(nullif(p_block->'time','null'::jsonb),'{}')-ARRAY['components','utilization_percent'])||jsonb_build_object('budget_minutes',p_block->'minutes','recommended_seconds',coalesce(p_block#>'{time,recommended_seconds}',p_block#>'{time,prescribed_seconds}'),'prescribed_seconds',ceil(elapsed),'manual_estimate',true,'utilization_percent',round(elapsed/greatest(1,(p_block->>'minutes')::numeric*60)*100,2));
 RETURN p_block||jsonb_build_object('exercises',output,'time',t);
END $$;

CREATE OR REPLACE FUNCTION public.week_composer_manual_wod_v1(p_plan jsonb,p_block jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path TO public,pg_temp AS $$
DECLARE m text:=p_plan->>'mechanic'; params jsonb:=p_plan->'parameters'; original jsonb:=params; changes jsonb:=coalesce(p_block->'manual_parameters','{}'); candidate jsonb:=p_plan->'candidate'; x jsonb; e jsonb; pres jsonb; u jsonb; output jsonb:='[]'; schedule jsonb:='[]'; k text; v jsonb; n int; stage_count int; base numeric; inc numeric; rep_total numeric:=0; unit_active numeric; unit_trans numeric; total_active numeric:=0; total_trans numeric:=0; projected numeric:=0; elapsed numeric; station numeric; max_unit numeric:=0; count_ex int; time jsonb; stage_delta numeric:=0;
BEGIN
 IF p_plan->>'status'<>'READY' THEN RETURN p_plan; END IF;
 IF changes='{}' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_block->'exercises') a WHERE coalesce(a->'manual_dose','{}')<>'{}') THEN RETURN p_plan; END IF;
 IF jsonb_typeof(changes) IS DISTINCT FROM 'object' OR m='DECK' THEN RAISE EXCEPTION 'COMPOSER_MANUAL_UNSUPPORTED_MECHANIC'; END IF;
 count_ex:=jsonb_array_length(candidate->'exercises');
 FOR k,v IN SELECT key,value FROM jsonb_each(changes) LOOP
  IF (k='rounds' AND m IN ('CIRCUIT','FOR_TIME','HIIT')) OR (k='cycles' AND m IN ('EMOM','PYRAMID','ODD_EVEN','EVERY_X_MINUTES'))
   OR (k='sets' AND m='SETS_REPS') OR (k='rungs' AND m IN ('LADDER','COUPLET')) THEN n:=public.week_composer_manual_integer_v1(v,1,100);
  ELSIF k='duration_minutes' AND m='AMRAP' THEN n:=public.week_composer_manual_integer_v1(v,1,180);
  ELSIF (k='cap_seconds' AND m='FOR_TIME') OR (k='time_limit_seconds' AND m='PROGRESSIVE_INTERVAL') THEN n:=public.week_composer_manual_integer_v1(v,60,10800);
  ELSIF (k='rest_between_rounds_seconds' AND m='CIRCUIT') OR (k='rest_between_exercises_seconds' AND m='SETS_REPS') THEN n:=public.week_composer_manual_integer_v1(v,0,1800);
  ELSE RAISE EXCEPTION 'COMPOSER_MANUAL_UNSUPPORTED_PARAMETER_%',k; END IF;
  IF NOT(params?k) THEN RAISE EXCEPTION 'COMPOSER_MANUAL_MISSING_PARAMETER_%',k;END IF;
  params:=jsonb_set(params,ARRAY[k],to_jsonb(n));
 END LOOP;
 IF m='EMOM' THEN params:=params||jsonb_build_object('duration_minutes',(params->>'cycles')::int*count_ex*(params->>'station_seconds')::numeric/60); END IF;
 FOR x IN SELECT value FROM jsonb_array_elements(candidate->'exercises') LOOP
  SELECT value->'manual_dose' INTO e FROM jsonb_array_elements(p_block->'exercises') WHERE value->>'id'=x->>'exercise_id';
  pres:=public.week_composer_manual_exercise_v1(x->>'exercise_id',x->'prescription',e,'WOD',m);
  IF m='HIIT' THEN pres:=jsonb_set(pres,'{mechanic_overlay,rounds}',params->'rounds',true); END IF;
  IF m IN ('LADDER','COUPLET','PYRAMID','PROGRESSIVE_INTERVAL') THEN
   base:=coalesce((pres#>>'{mechanic_overlay,base_reps}')::numeric,(pres#>>'{mechanic_overlay,start_reps}')::numeric);
   IF base IS NULL OR base<1 THEN RAISE EXCEPTION 'COMPOSER_MANUAL_PROGRESSION_MISSING';END IF;
   u:=public.week_composer_manual_unit_v1(x->>'exercise_id',pres||jsonb_build_object('reps_min',base,'reps_max',base,'execution_target_reps',base,'reps',base));
  ELSE u:=public.week_composer_manual_unit_v1(x->>'exercise_id',pres);END IF;
  unit_active:=(u->>'estimated_active_work_seconds')::numeric;unit_trans:=(u->>'estimated_transition_seconds')::numeric;
  total_active:=total_active+unit_active;total_trans:=total_trans+unit_trans;max_unit:=greatest(max_unit,unit_active+unit_trans);
  IF m='REP_TARGET' THEN rep_total:=rep_total+coalesce((u->>'reps_each')::numeric,0);END IF;
  IF m='PROGRESSIVE_INTERVAL' THEN stage_delta:=stage_delta+unit_active*coalesce((pres#>>'{mechanic_overlay,increment_reps}')::numeric,1)/base; END IF;
  IF m IN ('LADDER','COUPLET') THEN
   stage_count:=(params->>'rungs')::int;inc:=coalesce((pres#>>'{mechanic_overlay,increment_reps}')::numeric,1);
   projected:=projected+unit_active*(stage_count*base+inc*stage_count*(stage_count-1)/2)/base+unit_trans*stage_count;
   IF m='COUPLET' THEN
    pres:=jsonb_set(pres,'{mechanic_overlay}',(pres->'mechanic_overlay')-'first_stage_reps',true);
    schedule:=schedule||jsonb_build_array(jsonb_build_object('exercise_id',x->>'exercise_id','base_reps',base,'increment_reps',inc,'first_stage_reps',CASE WHEN params->>'sequence_direction'='descending' THEN base+(stage_count-1)*inc ELSE base END,'last_stage_reps',CASE WHEN params->>'sequence_direction'='descending' THEN base ELSE base+(stage_count-1)*inc END));
   END IF;
  END IF;
  output:=output||jsonb_build_array(jsonb_set(x,'{prescription}',pres,true));
 END LOOP;
 CASE m
 WHEN 'AMRAP' THEN elapsed:=(params->>'duration_minutes')::numeric*60;params:=params||jsonb_build_object('expected_rounds',greatest(1,floor(elapsed/greatest(1,total_active+total_trans))));
 WHEN 'CIRCUIT' THEN n:=(params->>'rounds')::int;elapsed:=n*(total_active+total_trans)+greatest(0,n-1)*coalesce((params->>'rest_between_rounds_seconds')::numeric,0);
 WHEN 'FOR_TIME' THEN elapsed:=(params->>'rounds')::int*(total_active+total_trans);
 WHEN 'SETS_REPS' THEN n:=(params->>'sets')::int;elapsed:=n*(total_active+total_trans)+greatest(0,n*count_ex-1)*coalesce((params->>'rest_between_exercises_seconds')::numeric,0);
 WHEN 'EMOM' THEN station:=(params->>'station_seconds')::numeric;IF max_unit>station THEN RAISE EXCEPTION 'COMPOSER_MANUAL_INTERVAL_TOO_SHORT';END IF;elapsed:=(params->>'duration_minutes')::numeric*60;
 WHEN 'ODD_EVEN' THEN station:=(params->>'station_seconds')::numeric;IF max_unit>station THEN RAISE EXCEPTION 'COMPOSER_MANUAL_INTERVAL_TOO_SHORT';END IF;elapsed:=(params->>'cycles')::numeric*2*station;
 WHEN 'EVERY_X_MINUTES' THEN station:=(params->>'interval_seconds')::numeric;IF total_active+total_trans>station THEN RAISE EXCEPTION 'COMPOSER_MANUAL_INTERVAL_TOO_SHORT';END IF;elapsed:=(params->>'cycles')::numeric*station;
 WHEN 'HIIT' THEN elapsed:=(params->>'rounds')::numeric*count_ex*((params->>'work_seconds')::numeric+(params->>'rest_seconds')::numeric);
 WHEN 'PYRAMID' THEN elapsed:=(params->>'cycles')::numeric*(total_active*(SELECT sum(value::numeric) FROM jsonb_array_elements_text(params->'multipliers'))+total_trans*jsonb_array_length(params->'multipliers'));
 WHEN 'LADDER' THEN elapsed:=projected;params:=params||jsonb_build_object('planned_execution_minutes',ceil(elapsed/60));
 WHEN 'COUPLET' THEN elapsed:=projected;params:=params||jsonb_build_object('per_exercise_schedule',schedule);
 WHEN 'CHIPPER' THEN elapsed:=total_active+total_trans;
 WHEN 'REP_TARGET' THEN elapsed:=total_active+total_trans;params:=params||jsonb_build_object('total_rep_target',rep_total);
 WHEN 'PROGRESSIVE_INTERVAL' THEN
  station:=(params->>'interval_seconds')::numeric;IF total_active+total_trans>station THEN RAISE EXCEPTION 'COMPOSER_MANUAL_INTERVAL_TOO_SHORT';END IF;
  stage_count:=greatest(1,least(floor((params->>'time_limit_seconds')::numeric/station),1+floor(greatest(0,station-total_active-total_trans)/greatest(0.01,stage_delta))));
  elapsed:=stage_count*station; params:=params||jsonb_build_object('expected_stage',stage_count);
 ELSE RAISE EXCEPTION 'COMPOSER_MANUAL_UNSUPPORTED_MECHANIC';END CASE;
 IF elapsed IS NULL OR elapsed<=0 THEN RAISE EXCEPTION 'COMPOSER_MANUAL_INVALID_ESTIMATE';END IF;
 SELECT jsonb_agg(jsonb_set(value,'{prescription,block_parameters}',params,true) ORDER BY ordinality) INTO output FROM jsonb_array_elements(output) WITH ORDINALITY;
 candidate:=jsonb_set(candidate,'{exercises}',output);
 time:=coalesce(p_plan->'time','{}')||jsonb_build_object('prescribed_seconds',ceil(elapsed),'manual_estimate',true,'advisories',coalesce(p_plan#>'{time,advisories}','[]')||'["USER_MANUAL_DOSE"]'::jsonb||CASE WHEN elapsed>(p_block->>'minutes')::numeric*60 THEN '["MANUAL_DURATION_EXCEEDS_BUDGET"]'::jsonb ELSE '[]'::jsonb END);
 RETURN p_plan||jsonb_build_object('candidate',candidate,'parameters',params,'time',time,'manual_parameters',changes,'recommended_parameters',original);
END $$;

REVOKE ALL ON FUNCTION public.week_composer_manual_integer_v1(jsonb,integer,integer),public.week_composer_manual_exercise_v1(text,jsonb,jsonb,text,text),public.week_composer_manual_unit_v1(text,jsonb),public.week_composer_manual_series_preview_v1(jsonb,jsonb),public.week_composer_manual_wod_v1(jsonb,jsonb) FROM PUBLIC,anon,authenticated;

DO $migration$
DECLARE d text; a text; b text;
BEGIN
 SELECT pg_get_functiondef('public.week_composer_prescription_preview_v1(uuid,jsonb,text[])'::regprocedure) INTO d;
 IF position('week_composer_manual_wod_v1' in d)>0 THEN RAISE EXCEPTION 'Unexpected preview version';END IF;
 a:=$old$     select jsonb_agg(jsonb_build_object('id',e->>'exercise_id','name',e->>'name',
       'reps',coalesce(e#>'{prescription,execution_target_reps}',e#>'{prescription,reps_min}'),$old$;
 IF position(a in d)=0 THEN RAISE EXCEPTION 'Preview WOD changed';END IF;
 d:=overlay(d placing '     wod_plan:=public.week_composer_manual_wod_v1(wod_plan,b);'||chr(10)||a from position(a in d) for length(a));
 a:=$old$   seen:=array_append(seen,k); total:=total+n; count_ex:=jsonb_array_length(b->'exercises');$old$;
 b:=$new$   seen:=array_append(seen,k); total:=total+n; count_ex:=jsonb_array_length(b->'exercises');
   IF k<>'WOD' AND coalesce(b->'manual_parameters','{}')<>'{}' THEN RAISE EXCEPTION 'COMPOSER_MANUAL_UNSUPPORTED_BLOCK'; END IF;
   IF (k NOT IN ('SKILL','STRENGTH','WOD') OR (k='SKILL' AND public.week_composer_preferences_v1(p_draft)->>'skill_target_path_key' IS NOT NULL) OR (k='WOD' AND p_draft->>'wod_engine_version' IS DISTINCT FROM 'C4_COMPOSER_V2'))
    AND (coalesce(b->'manual_parameters','{}')<>'{}' OR EXISTS(SELECT 1 FROM jsonb_array_elements(b->'exercises') q WHERE coalesce(q->'manual_dose','{}')<>'{}'))
   THEN RAISE EXCEPTION 'COMPOSER_MANUAL_UNSUPPORTED_BLOCK'; END IF;$new$;
 IF position(a in d)=0 THEN RAISE EXCEPTION 'Preview preflight changed';END IF;d:=replace(d,a,b);
 a:=$old$ IF total>duration THEN RAISE EXCEPTION 'PREVIEW_TIME_BUDGET_EXCEEDED'; END IF;$old$;
 b:=$new$ IF total>duration THEN RAISE EXCEPTION 'PREVIEW_TIME_BUDGET_EXCEEDED'; END IF;
 SELECT jsonb_agg(CASE WHEN q.value->>'type' IN ('STRENGTH','SKILL') THEN public.week_composer_manual_series_preview_v1(q.value,a.value) ELSE q.value END ORDER BY q.ordinality)
 INTO blocks FROM jsonb_array_elements(blocks) WITH ORDINALITY q(value,ordinality)
 JOIN jsonb_array_elements(p_draft#>'{architecture,blocks}') a(value) ON a.value->>'type'=q.value->>'type';$new$;
 IF position(a in d)=0 THEN RAISE EXCEPTION 'Preview return changed';END IF;d:=replace(d,a,b);EXECUTE d;
 SELECT pg_get_functiondef('public.week_compile_composer_day_j_v1(uuid,uuid,date,integer,text[],text[],text)'::regprocedure) INTO d;
 IF position('week_composer_manual_wod_v1' in d)>0 THEN RAISE EXCEPTION 'Unexpected compiler version';END IF;
 a:='      v_params:=v_wod_plan->''parameters'';'; IF position(a in d)=0 THEN RAISE EXCEPTION 'Compiler WOD changed';END IF;
 d:=replace(d,a,'      v_wod_plan:=public.week_composer_manual_wod_v1(v_wod_plan,v_b);'||chr(10)||a);
 a:=$old$    v_type:=upper(coalesce(v_b->>'type',''));$old$;
 b:=$new$    v_type:=upper(coalesce(v_b->>'type',''));
    IF v_type<>'WOD' AND coalesce(v_b->'manual_parameters','{}')<>'{}' THEN RAISE EXCEPTION 'COMPOSER_MANUAL_UNSUPPORTED_BLOCK'; END IF;
    IF (v_type NOT IN ('SKILL','STRENGTH','WOD') OR (v_type='SKILL' AND public.week_composer_preferences_v1(v_draft)->>'skill_target_path_key' IS NOT NULL) OR (v_type='WOD' AND NOT v_shared_wod))
      AND (coalesce(v_b->'manual_parameters','{}')<>'{}' OR EXISTS(SELECT 1 FROM jsonb_array_elements(v_b->'exercises') q WHERE coalesce(q->'manual_dose','{}')<>'{}'))
    THEN RAISE EXCEPTION 'COMPOSER_MANUAL_UNSUPPORTED_BLOCK'; END IF;$new$;
 IF position(a in d)=0 THEN RAISE EXCEPTION 'Compiler preflight changed';END IF;d:=replace(d,a,b);
 a:=$old$      v_exercise_instance_id:=gen_random_uuid();
      insert into public.workout_session_exercises ($old$;
 b:=$new$      IF v_type IN ('STRENGTH','SKILL') THEN
        v_pres:=public.week_composer_manual_exercise_v1(v_id,v_pres,v_e->'manual_dose',v_type,null);
      END IF;
      v_exercise_instance_id:=gen_random_uuid();
      insert into public.workout_session_exercises ($new$;
 IF position(a in d)=0 THEN RAISE EXCEPTION 'Compiler prescription changed';END IF;d:=replace(d,a,b);
 a:=$old$    if v_type='WOD' then
      v_wod_mechanic:=v_mechanic;$old$;
 b:=$new$    IF v_type IN ('SKILL','STRENGTH') THEN
      v_ctx:=public.week_composer_manual_series_preview_v1(jsonb_build_object('type',v_type,'minutes',v_minutes,'time',v_params->'time','exercises',v_out_exercises),jsonb_build_object('exercises','[]'::jsonb));
      IF v_ctx#>>'{time,manual_estimate}'='true' THEN
        v_params:=v_params||jsonb_build_object('time',v_ctx->'time','manual_per_exercise',true);
        IF v_skill_plan IS NOT NULL THEN v_skill_plan:=v_skill_plan||jsonb_build_object('time',v_ctx->'time'); END IF;
      END IF;
    END IF;
    if v_type='WOD' then
      v_wod_mechanic:=v_mechanic;$new$;
 IF position(a in d)=0 THEN RAISE EXCEPTION 'Compiler block changed'; END IF;d:=replace(d,a,b);
 EXECUTE d;
END $migration$;;
