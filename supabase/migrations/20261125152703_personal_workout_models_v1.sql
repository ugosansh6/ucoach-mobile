CREATE TABLE public.personal_workout_models (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
 name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
 origin text NOT NULL CHECK(origin IN ('COMPOSER','PROGRAM')),
 source_key text, fingerprint text, draft jsonb, source_payload jsonb,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(user_id,fingerprint), UNIQUE(user_id,source_key),
 CHECK ((origin='COMPOSER' AND draft IS NOT NULL AND jsonb_typeof(draft)='object' AND source_payload IS NULL) OR
        (origin='PROGRAM' AND source_payload IS NOT NULL AND jsonb_typeof(source_payload)='object' AND draft IS NULL))
);
ALTER TABLE public.personal_workout_models ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.personal_workout_models FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.personal_workout_models TO authenticated;
CREATE POLICY model_owner_select ON public.personal_workout_models FOR SELECT TO authenticated USING ((select auth.uid())=user_id);
CREATE POLICY model_owner_insert ON public.personal_workout_models FOR INSERT TO authenticated WITH CHECK ((select auth.uid())=user_id);
CREATE POLICY model_owner_update ON public.personal_workout_models FOR UPDATE TO authenticated USING ((select auth.uid())=user_id) WITH CHECK ((select auth.uid())=user_id);
CREATE POLICY model_owner_delete ON public.personal_workout_models FOR DELETE TO authenticated USING ((select auth.uid())=user_id);
CREATE INDEX personal_workout_models_user_updated ON public.personal_workout_models(user_id,updated_at DESC);
CREATE FUNCTION public.week_save_composer_with_model_v1(p_user_id uuid,p_plan_item_id uuid,p_draft jsonb,p_context jsonb,p_confirm_replacement boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path TO public,pg_temp AS $$
DECLARE result jsonb; snapshot jsonb; normalized jsonb; sig text; model_id uuid; title text;
BEGIN
 IF auth.uid() IS NULL OR auth.uid()<>p_user_id THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='42501'; END IF;
 IF jsonb_typeof(p_draft#>'{architecture,blocks}') IS DISTINCT FROM 'array' OR p_draft#>>'{prescription_preview,status}' IS DISTINCT FROM 'PREVIEW' THEN
  RAISE EXCEPTION 'COMPOSER_MODEL_PREVIEW_REQUIRED'; END IF;
 result:=public.week_save_composer_revision_v1(p_user_id,p_plan_item_id,p_draft,p_context,p_confirm_replacement);
 IF result->>'status' IS DISTINCT FROM 'SAVED' THEN RETURN result; END IF;
 snapshot:=(result->'composer_draft')-ARRAY['target_date','saved_at','dose_finalization_deferred','source_model_id'];
 normalized:=snapshot-ARRAY['prescription_preview','estimated_minutes'];
 sig:=md5(normalized::text);
 title:=left(coalesce(nullif(snapshot#>>'{architecture,title}',''),nullif(snapshot#>>'{intent,label}',''),'Séance personnalisée'),120);
 INSERT INTO public.personal_workout_models(user_id,name,origin,fingerprint,draft)
 VALUES(p_user_id,title,'COMPOSER',sig,snapshot) ON CONFLICT(user_id,fingerprint) DO NOTHING;
 SELECT id INTO model_id FROM public.personal_workout_models WHERE user_id=p_user_id AND fingerprint=sig;
 RETURN result||jsonb_build_object('model_id',model_id);
END $$;
REVOKE ALL ON FUNCTION public.week_save_composer_with_model_v1(uuid,uuid,jsonb,jsonb,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.week_save_composer_with_model_v1(uuid,uuid,jsonb,jsonb,boolean) TO authenticated;