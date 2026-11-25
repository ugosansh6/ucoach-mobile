CREATE OR REPLACE FUNCTION public.week_composer_exercise_compatibility_v1(p_exercise_ids text[], p_equipment_ids text[], p_environment_code text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path TO public, pg_temp AS $function$
DECLARE inventory jsonb; result jsonb;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
 IF coalesce(cardinality(p_exercise_ids),0)>500 OR upper(coalesce(p_environment_code,'')) NOT IN ('HOME','BOX','GYM','OUTDOOR') THEN RAISE EXCEPTION 'INVALID_COMPOSER_COMPATIBILITY_CONTEXT'; END IF;
 inventory:=public.resolve_user_equipment_inventory(auth.uid(),coalesce(p_equipment_ids,'{}'::text[]),'c4-final-default');
 SELECT coalesce(jsonb_object_agg(e.id,jsonb_build_object(
 'equipment_ok',public.exercise_equipment_compatible(e.id,inventory),
 'environment_ok',public.exercise_environment_eligible_v1(e.id,p_environment_code),
 'equipment_ids',coalesce((SELECT jsonb_agg(distinct q.equipment_id) FROM public.exercise_equipment_requirements_v2 q WHERE q.exercise_id=e.id AND NOT q.is_optional),'[]'::jsonb),
 'equipment_groups',coalesce((SELECT jsonb_agg(g.items ORDER BY g.option_group) FROM
   (SELECT q.option_group,jsonb_agg(q.equipment_id ORDER BY q.equipment_id) items FROM public.exercise_equipment_requirements_v2 q WHERE q.exercise_id=e.id AND NOT q.is_optional GROUP BY q.option_group) g),'[]'::jsonb)
 )), '{}'::jsonb) INTO result
 FROM public.exercises e WHERE e.id=ANY(coalesce(p_exercise_ids,'{}'::text[]));
 RETURN result;
END $function$;
REVOKE ALL ON FUNCTION public.week_composer_exercise_compatibility_v1(text[],text[],text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.week_composer_exercise_compatibility_v1(text[],text[],text) TO authenticated,service_role;