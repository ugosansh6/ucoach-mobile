-- Phase F: external session import staging.
-- AI/parser output is staged and reviewed. No trigger writes user capabilities.

CREATE TABLE IF NOT EXISTS public.external_session_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  input_type text NOT NULL,
  source_uri text,
  raw_text text,
  source_metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  parser_name text,
  parser_version text,
  parse_confidence numeric(4,3),
  parser_output_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'received',
  validation_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  validated_at timestamptz,
  committed_session_id uuid REFERENCES public.workout_sessions(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT external_session_imports_input_check CHECK (input_type IN ('text','photo','voice')),
  CONSTRAINT external_session_imports_confidence_check CHECK (parse_confidence IS NULL OR (parse_confidence >= 0 AND parse_confidence <= 1)),
  CONSTRAINT external_session_imports_status_check CHECK (status IN ('received','parsed','needs_review','validated','rejected','committed')),
  CONSTRAINT external_session_imports_json_check CHECK (
    jsonb_typeof(source_metadata_json)='object' AND
    jsonb_typeof(parser_output_json)='object' AND
    jsonb_typeof(validation_json)='object'
  ),
  CONSTRAINT external_session_imports_validated_check CHECK (
    status NOT IN ('validated','committed') OR validated_at IS NOT NULL
  ),
  CONSTRAINT external_session_imports_committed_check CHECK (
    status <> 'committed' OR committed_session_id IS NOT NULL
  )
);

CREATE TABLE IF NOT EXISTS public.external_session_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id uuid NOT NULL REFERENCES public.external_session_imports(id) ON DELETE CASCADE,
  position integer NOT NULL,
  raw_name text NOT NULL,
  matched_exercise_id varchar REFERENCES public.exercises(id) ON DELETE SET NULL,
  match_confidence numeric(4,3),
  structured_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_confirmed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT external_session_items_position_check CHECK (position >= 0),
  CONSTRAINT external_session_items_confidence_check CHECK (match_confidence IS NULL OR (match_confidence >= 0 AND match_confidence <= 1)),
  CONSTRAINT external_session_items_structured_check CHECK (jsonb_typeof(structured_json)='object'),
  UNIQUE(import_id,position)
);

CREATE INDEX IF NOT EXISTS idx_external_imports_user_created
  ON public.external_session_imports(user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_external_imports_status
  ON public.external_session_imports(status);
CREATE INDEX IF NOT EXISTS idx_external_items_import
  ON public.external_session_items(import_id,position);
CREATE INDEX IF NOT EXISTS idx_external_items_match
  ON public.external_session_items(matched_exercise_id);

ALTER TABLE public.external_session_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.external_session_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users own external session imports" ON public.external_session_imports;
CREATE POLICY "Users own external session imports" ON public.external_session_imports
FOR ALL TO authenticated USING (auth.uid()=user_id) WITH CHECK (auth.uid()=user_id);

DROP POLICY IF EXISTS "Users read own external session items" ON public.external_session_items;
CREATE POLICY "Users read own external session items" ON public.external_session_items
FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.external_session_imports i WHERE i.id=external_session_items.import_id AND i.user_id=auth.uid())
);
DROP POLICY IF EXISTS "Users insert own external session items" ON public.external_session_items;
CREATE POLICY "Users insert own external session items" ON public.external_session_items
FOR INSERT TO authenticated WITH CHECK (
  EXISTS (SELECT 1 FROM public.external_session_imports i WHERE i.id=external_session_items.import_id AND i.user_id=auth.uid())
);
DROP POLICY IF EXISTS "Users update own external session items" ON public.external_session_items;
CREATE POLICY "Users update own external session items" ON public.external_session_items
FOR UPDATE TO authenticated USING (
  EXISTS (SELECT 1 FROM public.external_session_imports i WHERE i.id=external_session_items.import_id AND i.user_id=auth.uid())
) WITH CHECK (
  EXISTS (SELECT 1 FROM public.external_session_imports i WHERE i.id=external_session_items.import_id AND i.user_id=auth.uid())
);
DROP POLICY IF EXISTS "Users delete own external session items" ON public.external_session_items;
CREATE POLICY "Users delete own external session items" ON public.external_session_items
FOR DELETE TO authenticated USING (
  EXISTS (SELECT 1 FROM public.external_session_imports i WHERE i.id=external_session_items.import_id AND i.user_id=auth.uid())
);

ALTER TABLE public.exercise_logs
  ADD COLUMN IF NOT EXISTS external_import_id uuid REFERENCES public.external_session_imports(id) ON DELETE SET NULL;
ALTER TABLE public.session_stimulus_ledger
  ADD COLUMN IF NOT EXISTS external_import_id uuid REFERENCES public.external_session_imports(id) ON DELETE SET NULL;

CREATE OR REPLACE VIEW public.external_import_review_queue
WITH (security_invoker=true)
AS
SELECT
  i.id AS import_id,
  i.user_id,
  i.input_type,
  i.status,
  i.parse_confidence,
  i.created_at,
  count(it.id) AS item_count,
  count(it.id) FILTER (WHERE it.matched_exercise_id IS NULL) AS unresolved_items,
  count(it.id) FILTER (WHERE NOT it.is_confirmed) AS unconfirmed_items
FROM public.external_session_imports i
LEFT JOIN public.external_session_items it ON it.import_id=i.id
WHERE i.status IN ('parsed','needs_review','validated')
GROUP BY i.id,i.user_id,i.input_type,i.status,i.parse_confidence,i.created_at;;
