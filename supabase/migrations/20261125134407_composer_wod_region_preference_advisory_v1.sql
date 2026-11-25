DO $migration$
DECLARE d text; needle text:=' -- No replacement, ordering change or partial candidate is accepted.'; replacement text;
BEGIN
 SELECT pg_get_functiondef('public.week_composer_wod_authority_v2(uuid,jsonb)'::regprocedure) INTO d;
 IF position(needle in d)=0 OR position('composer_region_advisories' in d)>0 THEN RAISE EXCEPTION 'Concurrent Composer WOD authority change'; END IF;
 replacement:=$patch$ -- Composer: preferred muscle region is not an execution constraint.
 gate:=gate||jsonb_build_object('composer_region_advisories',
   (SELECT coalesce(jsonb_agg(value),'[]'::jsonb) FROM jsonb_array_elements_text(coalesce(gate->'hard_gate_reasons','[]'::jsonb)) x(value)
      WHERE value IN ('EXPLICIT_TARGET_REGION_COHERENCE','EXPLICIT_TARGET_REGION_COHERENCE_60','BACK_PRIMARY_MUSCLE_REQUIRED')));
 gate:=gate||jsonb_build_object('hard_gate_reasons',
   (SELECT coalesce(jsonb_agg(value),'[]'::jsonb) FROM jsonb_array_elements_text(coalesce(gate->'hard_gate_reasons','[]'::jsonb)) x(value)
      WHERE value NOT IN ('EXPLICIT_TARGET_REGION_COHERENCE','EXPLICIT_TARGET_REGION_COHERENCE_60','BACK_PRIMARY_MUSCLE_REQUIRED')));
 gate:=gate||jsonb_build_object('pass',jsonb_array_length(gate->'hard_gate_reasons')=0);
 -- No replacement, ordering change or partial candidate is accepted.$patch$;
 d:=replace(d,needle,replacement);
 IF position('''prescribed_seconds'',estimate,''duration_semantic'',spec->>''duration_semantic'')' in d)=0 THEN RAISE EXCEPTION 'Concurrent time contract change'; END IF;
 d:=replace(d,'''prescribed_seconds'',estimate,''duration_semantic'',spec->>''duration_semantic'')',
 '''prescribed_seconds'',estimate,''duration_semantic'',spec->>''duration_semantic'',''advisories'',gate->''composer_region_advisories'')');
 EXECUTE d;
END $migration$;