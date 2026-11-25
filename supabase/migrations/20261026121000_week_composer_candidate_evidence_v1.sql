
-- Composer candidate evidence, reusing get_user_exercise_preference_evidence_v1.
-- No new sport-scoring policy: only expose observed history and user-authored plans.
CREATE OR REPLACE FUNCTION public.week_composer_candidate_evidence_v1(
  p_user_id uuid,
  p_exercise_ids text[],
  p_anchor_date date,
  p_plan_item_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO public,pg_temp
AS $f$
DECLARE
  ids text[]; results jsonb:='{}'::jsonb; ex text; v_evidence jsonb; planned int;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'FORBIDDEN_CANDIDATE_EVIDENCE' USING ERRCODE='42501';
  END IF;
  SELECT coalesce(array_agg(DISTINCT elem),'{}'::text[]) INTO ids
  FROM unnest(coalesce(p_exercise_ids,'{}'::text[])) elem WHERE nullif(elem,'') IS NOT NULL;
  IF cardinality(ids)>160 OR p_anchor_date IS NULL THEN
    RAISE EXCEPTION 'INVALID_CANDIDATE_EVIDENCE_CONTEXT';
  END IF;
  FOREACH ex IN ARRAY ids LOOP
    v_evidence:=public.get_user_exercise_preference_evidence_v1(
      p_user_id,ex,'GLOBAL',p_anchor_date);
    SELECT count(*)::integer INTO planned
    FROM public.user_training_plan_items item
    WHERE item.user_id=p_user_id
      AND item.recommended_date BETWEEN p_anchor_date-6 AND p_anchor_date+6
      AND (p_plan_item_id IS NULL OR item.id<>p_plan_item_id)
      AND item.status IN ('available','claimed')
      AND EXISTS(
        SELECT 1
        FROM jsonb_array_elements(
          CASE WHEN jsonb_typeof(item.planning_context_json #> '{w11,composer_draft,architecture,blocks}')='array'
            THEN item.planning_context_json #> '{w11,composer_draft,architecture,blocks}'
            ELSE '[]'::jsonb END
        ) b,
        LATERAL jsonb_array_elements(
          CASE WHEN jsonb_typeof(b->'exercises')='array' THEN b->'exercises' ELSE '[]'::jsonb END
        ) e
        WHERE e->>'id'=ex
      );
    results:=results||jsonb_build_object(ex,jsonb_build_object(
      'completed_exposures',coalesce((v_evidence->>'completed_exposures')::int,0),
      'recent_completed_14d',coalesce((v_evidence->>'recent_completed_14d')::int,0),
      'last_completed_at',v_evidence->'last_completed_at',
      'explicit_preference_state',v_evidence->>'explicit_preference_state',
      'other_composer_plans_nearby',planned
    ));
  END LOOP;
  RETURN jsonb_build_object('status','OK','version','composer-evidence-existing-v1',
    'anchor_date',p_anchor_date,'by_exercise',results);
END;
$f$;
REVOKE EXECUTE ON FUNCTION public.week_composer_candidate_evidence_v1(uuid,text[],date,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.week_composer_candidate_evidence_v1(uuid,text[],date,uuid) TO authenticated,service_role;
