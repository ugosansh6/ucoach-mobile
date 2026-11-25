-- Explicitly authored personal programs use the existing Composer compiler/player.
-- They are not recommendations: only physical compatibility and structural safety
-- checks are mandatory. No changes to generic C2/C3/C4 or automatic Today.
CREATE FUNCTION public.week_personal_program_prescription_v1(p_id text,p_dose jsonb,p_block text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path TO public,pg_temp AS $$
DECLARE e public.exercises%rowtype; r jsonb; sets int; rest int; n int; mode text; unit text; lo int; hi int; tempo_down int; tempo_pause int; instruction text; sides boolean; u jsonb; work numeric; trans numeric; label text;
BEGIN
 SELECT * INTO e FROM public.exercises WHERE id=p_id;
 IF NOT FOUND OR jsonb_typeof(p_dose) IS DISTINCT FROM 'object' OR p_block NOT IN ('WARMUP','STRENGTH') THEN RAISE EXCEPTION 'PERSONAL_PROGRAM_INVALID_EXERCISE_%',p_id; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_dose) k WHERE k NOT IN ('sets','rest_seconds','target','mode','count_unit','range_min','range_max','tempo_eccentric_seconds','tempo_pause_seconds','instruction','per_side')) THEN RAISE EXCEPTION 'PERSONAL_PROGRAM_INVALID_FIELD'; END IF;
 sets:=public.week_composer_manual_integer_v1(p_dose->'sets',1,50);
 rest:=public.week_composer_manual_integer_v1(p_dose->'rest_seconds',0,1800);
 n:=public.week_composer_manual_integer_v1(p_dose->'target',1,1800);
 mode:=p_dose->>'mode'; unit:=p_dose->>'count_unit';
 IF p_block='WARMUP' AND (NOT e.warmup_eligible OR sets>3 OR rest>60 OR n>60 OR mode='count') THEN RAISE EXCEPTION 'PERSONAL_PROGRAM_INVALID_WARMUP_%',p_id; END IF;
 IF mode='reps' AND 'reps'=ANY(e.tracking_modes) AND p_id<>'EX583' AND n<=500 THEN
  r:=jsonb_build_object('reps_min',n,'reps_max',n,'execution_target_reps',n,'reps',n,'reps_semantics',CASE WHEN lower(e.movement_side)='unilateral' THEN 'per_side' ELSE 'total' END); label:=n||' reps';
 ELSIF mode='time' AND 'time'=ANY(e.tracking_modes) THEN
  r:=jsonb_build_object('duration_seconds_min',n,'duration_seconds_max',n,'duration_seconds',n,'execution_target_duration_seconds',n,'duration_semantics',CASE WHEN lower(e.movement_side)='unilateral' THEN 'per_side' ELSE 'total' END); label:=n||' s';
 ELSIF mode='count' AND p_id='EX583' AND unit IN ('barreaux','traversées') AND n<=100 THEN
  r:=jsonb_build_object('execution_target_count',n,'count_unit',unit); label:=n||' '||unit;
 ELSE RAISE EXCEPTION 'PERSONAL_PROGRAM_INVALID_TRACKING_%',p_id; END IF;
 IF p_dose ? 'per_side' AND jsonb_typeof(p_dose->'per_side') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'PERSONAL_PROGRAM_INVALID_SIDE'; END IF;
 sides:=r->>'duration_semantics'='per_side' OR r->>'reps_semantics'='per_side';
 IF coalesce((p_dose->>'per_side')::boolean,false) AND NOT coalesce(sides,false) THEN RAISE EXCEPTION 'PERSONAL_PROGRAM_INVALID_SIDE'; END IF;
 IF coalesce(sides,false) THEN label:=label||' / côté'; END IF;
 IF p_dose ? 'range_min' OR p_dose ? 'range_max' THEN
  lo:=public.week_composer_manual_integer_v1(p_dose->'range_min',1,500); hi:=public.week_composer_manual_integer_v1(p_dose->'range_max',lo,500);
  r:=r||jsonb_build_object('target_range_min',lo,'target_range_max',hi);
 END IF;
 tempo_down:=CASE WHEN p_dose?'tempo_eccentric_seconds' THEN public.week_composer_manual_integer_v1(p_dose->'tempo_eccentric_seconds',0,15) ELSE 0 END;
 tempo_pause:=CASE WHEN p_dose?'tempo_pause_seconds' THEN public.week_composer_manual_integer_v1(p_dose->'tempo_pause_seconds',0,15) ELSE 0 END;
 IF (tempo_down>0 OR tempo_pause>0) AND mode<>'reps' THEN RAISE EXCEPTION 'PERSONAL_PROGRAM_INVALID_TEMPO'; END IF;
 instruction:=nullif(trim(p_dose->>'instruction'),'');
 IF length(instruction)>500 THEN RAISE EXCEPTION 'PERSONAL_PROGRAM_INVALID_INSTRUCTION'; END IF;
 IF mode='count' THEN work:=n*CASE WHEN unit='barreaux' THEN 4 ELSE 30 END; trans:=10;
 ELSE
  u:=public.c3_unit_estimate(p_id,r,'c3-sim-default');
  work:=coalesce((u->>'estimated_active_work_seconds')::numeric,0);trans:=coalesce((u->>'estimated_transition_seconds')::numeric,0);
  IF mode='reps' THEN work:=greatest(work,n*(tempo_down+tempo_pause+1)*CASE WHEN coalesce(sides,false) THEN 2 ELSE 1 END); END IF;
  IF mode='time' AND coalesce(sides,false) THEN work:=greatest(work,n*2); END IF;
 END IF;
 RETURN r||jsonb_strip_nulls(jsonb_build_object('source','PERSONAL_PROGRAM_V1','finalized',true,'tracking_modes',to_jsonb(e.tracking_modes),'sets',sets,'rest_seconds',rest,'rest_between_sets_seconds',rest,'tempo_eccentric_seconds',tempo_down,'tempo_pause_seconds',tempo_pause,'program_instruction',instruction,'text',sets||' × '||label,'authored_dose',p_dose,'estimated_set_seconds',ceil(work+trans),'estimated_total_seconds',ceil(sets*(work+trans)+greatest(0,sets-1)*rest)));
END $$;

CREATE FUNCTION public.week_personal_program_preview_v1(p_user_id uuid,p_draft jsonb,p_equipment text[])
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path TO public,pg_temp AS $$
DECLARE env text:=p_draft->>'environment_code'; b jsonb; x jsonb; typ text; r jsonb; e public.exercises%rowtype; arr jsonb; blocks jsonb:='[]'; ids text[]; sec numeric; total numeric:=0; main_minutes int; duration int; inventory jsonb;
BEGIN
 IF auth.uid() IS NULL OR auth.uid()<>p_user_id THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='42501'; END IF;
 IF p_draft->>'personal_program_version' IS DISTINCT FROM 'PERSONAL_PROGRAM_V1' OR env IS NULL OR env NOT IN ('HOME','OUTDOOR') OR jsonb_typeof(p_draft#>'{architecture,blocks}') IS DISTINCT FROM 'array' OR jsonb_array_length(p_draft#>'{architecture,blocks}')<>2 OR p_draft#>>'{architecture,blocks,0,type}' IS DISTINCT FROM 'WARMUP' OR p_draft#>>'{architecture,blocks,1,type}' IS DISTINCT FROM 'STRENGTH' THEN RAISE EXCEPTION 'PERSONAL_PROGRAM_INVALID_STRUCTURE'; END IF;
 inventory:=public.resolve_user_equipment_inventory(p_user_id,coalesce(p_equipment,'{}'),'c4-final-default');
 FOR b IN SELECT value FROM jsonb_array_elements(p_draft#>'{architecture,blocks}') LOOP
  typ:=b->>'type'; arr:='[]';ids:='{}';sec:=0;
  IF jsonb_typeof(b->'exercises') IS DISTINCT FROM 'array' OR jsonb_array_length(b->'exercises') NOT BETWEEN 1 AND 8 THEN RAISE EXCEPTION 'PERSONAL_PROGRAM_INVALID_BLOCK'; END IF;
  FOR x IN SELECT value FROM jsonb_array_elements(b->'exercises') LOOP
   SELECT * INTO e FROM public.exercises WHERE id=x->>'id';
   IF NOT FOUND OR e.id=ANY(ids) THEN RAISE EXCEPTION 'PERSONAL_PROGRAM_INVALID_EXERCISE_%',x->>'id'; END IF;
   ids:=array_append(ids,e.id);
   IF NOT public.exercise_environment_eligible_v1(e.id,env) OR NOT public.exercise_equipment_compatible(e.id,inventory) THEN RAISE EXCEPTION 'COMPOSER_EXERCISE_INCOMPATIBLE_%',e.id; END IF;
   r:=public.week_personal_program_prescription_v1(e.id,x->'authored_dose',typ);
   sec:=sec+(r->>'estimated_total_seconds')::numeric;
   arr:=arr||jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('id',e.id,'name',coalesce(e.display_name,e.name),'sets',r->'sets','reps',r->'execution_target_reps','duration_seconds',r->'execution_target_duration_seconds','reps_semantics',r->'reps_semantics','duration_semantics',r->'duration_semantics','rest_seconds',r->'rest_seconds','prescription_json',r)));
  END LOOP;
  IF typ='WARMUP' THEN
   IF EXISTS(SELECT 1 FROM jsonb_array_elements(arr) elem WHERE elem->>'sets' IS DISTINCT FROM arr#>>'{0,sets}') THEN RAISE EXCEPTION 'PERSONAL_PROGRAM_WARMUP_ROUNDS'; END IF;
   sec:=greatest(300,sec);
  END IF;
  total:=total+sec;
  blocks:=blocks||jsonb_build_array(jsonb_build_object('type',typ,'minutes',CASE WHEN typ='WARMUP' THEN 5 ELSE least(85,greatest(15,ceil(sec/60)::int)) END,'exercises',arr,'time',jsonb_build_object('prescribed_seconds',ceil(sec),'manual_estimate',true)));
 END LOOP;
 main_minutes:=least(85,greatest(15,ceil((blocks#>>'{1,time,prescribed_seconds}')::numeric/60)::int));
 duration:=main_minutes+5;
 RETURN jsonb_build_object('status','PREVIEW','version','personal-program-v1','duration_minutes',duration,'planned_block_minutes',duration,'estimated_seconds',ceil(total),'blocks',blocks,'provisional',false);
END $$;
REVOKE ALL ON FUNCTION public.week_personal_program_prescription_v1(text,jsonb,text),public.week_personal_program_preview_v1(uuid,jsonb,text[]) FROM PUBLIC,anon,authenticated;

-- Keep the existing public preview RPC, compiler preflight, ownership, session
-- idempotency, exercise insertion and completion path. Only the authored dose
-- source changes for this explicitly marked two-block structure.
DO $migration$
DECLARE d text; a text; b text;
BEGIN
 SELECT pg_get_functiondef('public.week_composer_prescription_preview_v1(uuid,jsonb,text[])'::regprocedure) INTO d;
 a:=' IF jsonb_typeof(p_draft #> ''{architecture,blocks}'')';
 IF position(a in d)=0 OR position('week_personal_program_preview_v1' in d)>0 THEN RAISE EXCEPTION 'Unexpected preview version'; END IF;
 d:=replace(d,a,' IF p_draft->>''personal_program_version''=''PERSONAL_PROGRAM_V1'' THEN RETURN public.week_personal_program_preview_v1(p_user_id,p_draft,p_equipment_names); END IF;'||chr(10)||a); EXECUTE d;
 SELECT pg_get_functiondef('public.week_compile_composer_day_j_v1(uuid,uuid,date,integer,text[],text[],text)'::regprocedure) INTO d;
 a:='  v_mechanic:=upper(coalesce(v_draft#>>''{mechanic,key}'',''''));';
 IF position(a in d)=0 OR position('v_program_preview' in d)>0 THEN RAISE EXCEPTION 'Unexpected compiler version'; END IF;
 d:=replace(d,'  v_draft jsonb;','  v_draft jsonb; v_program_preview jsonb;');
 d:=replace(d,a,a||chr(10)||'  IF v_draft->>''personal_program_version''=''PERSONAL_PROGRAM_V1'' THEN v_program_preview:=public.week_personal_program_preview_v1(p_user_id,v_draft,p_available_equipment); END IF;');
 a:=$old$    elsif v_type='WARMUP' then
      v_sets:=case$old$;
 b:=$new$    elsif v_program_preview IS NOT NULL AND v_type IN ('WARMUP','STRENGTH') THEN
      SELECT value INTO v_ctx FROM jsonb_array_elements(v_program_preview->'blocks') WHERE value->>'type'=v_type;
      v_sets:=CASE WHEN v_type='WARMUP' THEN (v_ctx#>>'{exercises,0,sets}')::int ELSE NULL END;
      v_params:=jsonb_build_object('duration_minutes',v_minutes,'time',v_ctx->'time','manual_per_exercise',true,'dose_authority','PERSONAL_PROGRAM_V1')||CASE WHEN v_type='WARMUP' THEN jsonb_build_object('rounds',v_sets) ELSE '{}'::jsonb END;
    elsif v_type='WARMUP' then
      v_sets:=case$new$;
 IF position(a in d)=0 THEN RAISE EXCEPTION 'Compiler block changed'; END IF; d:=replace(d,a,b);
 a:=$old$      if v_skill_plan is not null then
        select value->'prescription' into v_pres$old$;
 b:=$new$      if v_program_preview IS NOT NULL then
        SELECT ex->'prescription_json' INTO v_pres FROM jsonb_array_elements(v_program_preview->'blocks') z CROSS JOIN LATERAL jsonb_array_elements(z->'exercises') ex WHERE z->>'type'=v_type AND ex->>'id'=v_id;
        IF v_pres IS NULL THEN RAISE EXCEPTION 'PERSONAL_PROGRAM_DOSE_MISSING'; END IF;
        v_solver:=v_pres;
      elsif v_skill_plan is not null then
        select value->'prescription' into v_pres$new$;
 IF position(a in d)=0 THEN RAISE EXCEPTION 'Compiler dose changed'; END IF; d:=replace(d,a,b);
 a:=$old$      IF v_type IN ('STRENGTH','SKILL') THEN
        v_pres:=public.week_composer_manual_exercise_v1$old$;
 b:=$new$      IF v_program_preview IS NULL AND v_type IN ('STRENGTH','SKILL') THEN
        v_pres:=public.week_composer_manual_exercise_v1$new$;
 IF position(a in d)=0 THEN RAISE EXCEPTION 'Compiler manual dose changed'; END IF;d:=replace(d,a,b);
 a:=$old$    IF v_type IN ('SKILL','STRENGTH') THEN
      v_ctx:=public.week_composer_manual_series_preview_v1$old$;
 b:=$new$    IF v_program_preview IS NULL AND v_type IN ('SKILL','STRENGTH') THEN
      v_ctx:=public.week_composer_manual_series_preview_v1$new$;
 IF position(a in d)=0 THEN RAISE EXCEPTION 'Compiler manual estimate changed'; END IF;d:=replace(d,a,b);
 EXECUTE d;
END $migration$;

-- The plan slot and its validated draft are saved in one transaction.
CREATE FUNCTION public.week_plan_personal_program_v1(p_model_id uuid,p_date date,p_draft jsonb,p_surface text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path TO public,pg_temp AS $$
DECLARE u uuid:=auth.uid(); m public.personal_workout_models%rowtype; preview jsonb; draft jsonb; gear text[]; gear_names text[]; ctx jsonb; item jsonb; saved jsonb; i int; row jsonb; original jsonb; duration int;
BEGIN
 IF u IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='42501'; END IF;
 SELECT * INTO m FROM public.personal_workout_models WHERE id=p_model_id AND user_id=u AND origin='PROGRAM';
 IF NOT FOUND THEN RAISE EXCEPTION 'PERSONAL_PROGRAM_NOT_FOUND'; END IF;
 IF p_draft->>'environment_code' IS DISTINCT FROM m.source_payload->>'environment_code' OR jsonb_array_length(p_draft#>'{architecture,blocks,1,exercises}') IS DISTINCT FROM jsonb_array_length(m.source_payload->'exercises') THEN RAISE EXCEPTION 'PERSONAL_PROGRAM_SOURCE_MISMATCH'; END IF;
 i:=0;
 FOR row IN SELECT value FROM jsonb_array_elements(p_draft#>'{architecture,blocks,1,exercises}') LOOP
  original:=m.source_payload->'exercises'->i;
  IF NOT coalesce(original->'candidate_ids' ? (row->>'id'),false) THEN RAISE EXCEPTION 'PERSONAL_PROGRAM_VARIANT_REQUIRED'; END IF;
  i:=i+1;
 END LOOP;
 SELECT array_agg(value) INTO gear FROM jsonb_array_elements_text(coalesce(p_draft->'equipment_ids','[]'));
 SELECT array_agg(name ORDER BY id) INTO gear_names FROM public.equipment_catalog_v2 WHERE id=ANY(coalesce(gear,'{}'));
 IF cardinality(coalesce(gear,'{}'))<>cardinality(coalesce(gear_names,'{}')) THEN RAISE EXCEPTION 'PERSONAL_PROGRAM_UNKNOWN_EQUIPMENT'; END IF;
 preview:=public.week_composer_prescription_preview_v1(u,p_draft,gear);
 duration:=(preview->>'duration_minutes')::int;
 draft:=p_draft||jsonb_build_object('version','w11-composer-draft-v1','structure_stable',true,'duration_minutes',duration,'estimated_minutes',ceil((preview->>'estimated_seconds')::numeric/60),'target_date',p_date,'source_model_id',p_model_id,'prescription_preview',preview);
 draft:=jsonb_set(draft,'{architecture,blocks,0,minutes}','5');
 draft:=jsonb_set(draft,'{architecture,blocks,1,minutes}',to_jsonb(duration-5));
 ctx:=jsonb_build_object('duration_minutes',duration,'environment_code',draft->>'environment_code','equipment',to_jsonb(coalesce(gear_names,'{}'::text[])),'target_region','Upper');
 IF draft->>'environment_code'='OUTDOOR' THEN
  IF p_surface IS NULL OR public.normalize_session_surface_v1(p_surface)='UNKNOWN' THEN RAISE EXCEPTION 'OUTDOOR_SURFACE_REQUIRED'; END IF;
  ctx:=ctx||jsonb_build_object('surface_code',public.normalize_session_surface_v1(p_surface));
 END IF;
 item:=public.week_create_assisted_plan_item_v1(u,p_date,ctx);
 saved:=public.week_save_composer_revision_v1(u,(item->>'plan_item_id')::uuid,draft,ctx,false);
 IF saved->>'status' IS DISTINCT FROM 'SAVED' THEN RAISE EXCEPTION 'PERSONAL_PROGRAM_SAVE_FAILED'; END IF;
 RETURN saved||jsonb_build_object('estimated_seconds',preview->'estimated_seconds');
END $$;
REVOKE ALL ON FUNCTION public.week_plan_personal_program_v1(uuid,date,jsonb,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.week_plan_personal_program_v1(uuid,date,jsonb,text) TO authenticated;

DO $migration$ DECLARE d text; a text; BEGIN
 SELECT pg_get_functiondef('public.gym_normalize_set_actuals_v1(jsonb)'::regprocedure) INTO d;
 a:='    ''tempo'',nullif(s->>''tempo'',''''),';
 IF position(a in d)=0 THEN RAISE EXCEPTION 'Unexpected actual normalization';END IF;
 d:=replace(d,a,a||chr(10)||$new$    'count_actual',case when s->>'count_unit' IN ('barreaux','traversées') and jsonb_typeof(s->'count_actual')='number' and (s->>'count_actual')::numeric between 1 and 1000 then s->'count_actual' else null end,
    'count_unit',case when s->>'count_unit' IN ('barreaux','traversées') and jsonb_typeof(s->'count_actual')='number' and (s->>'count_actual')::numeric between 1 and 1000 then s->>'count_unit' else null end,
    'duration_seconds',case when jsonb_typeof(s->'duration_seconds')='number' then s->'duration_seconds' else null end,
    'side',case when s->>'side' IN ('left','right') then s->>'side' else null end,$new$);
 EXECUTE d;
END $migration$;
