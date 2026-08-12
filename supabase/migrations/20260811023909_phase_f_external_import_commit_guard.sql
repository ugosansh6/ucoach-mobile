CREATE OR REPLACE FUNCTION public.external_import_ready_to_commit(p_import_id uuid)
RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.external_session_imports i
    WHERE i.id=p_import_id
      AND i.status='validated'
      AND i.validated_at IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.external_session_items it
        WHERE it.import_id=i.id
          AND (it.matched_exercise_id IS NULL OR NOT it.is_confirmed)
      )
  );
$$;;
