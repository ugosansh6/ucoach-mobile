-- Exact Composer draft read for a selected plan item; no date-based substitution.
CREATE OR REPLACE FUNCTION public.week_read_composer_for_item_v1(p_plan_item_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE u uuid:=auth.uid(); i public.user_training_plan_items%rowtype;
BEGIN
 IF u IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='42501'; END IF;
 SELECT * INTO i FROM public.user_training_plan_items WHERE id=p_plan_item_id AND user_id=u AND status IN ('available','claimed');
 IF NOT FOUND OR jsonb_typeof(i.planning_context_json#>'{w11,composer_draft}') IS DISTINCT FROM 'object' THEN RETURN jsonb_build_object('found',false); END IF;
 RETURN jsonb_build_object('found',true,'plan_item_id',i.id,'session_id',i.session_id,'local_date',i.recommended_date,'status',i.status,'composer_draft',i.planning_context_json#>'{w11,composer_draft}','future_context',coalesce(i.planning_context_json#>'{w11,future_context}','{}'::jsonb));
END;
$function$;
REVOKE ALL ON FUNCTION public.week_read_composer_for_item_v1(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.week_read_composer_for_item_v1(uuid) TO authenticated,service_role;
