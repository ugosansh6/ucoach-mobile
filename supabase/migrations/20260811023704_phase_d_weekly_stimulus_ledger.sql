-- Phase D: weekly feedback loop. Planned stimulus and realized stimulus stay separate.

CREATE TABLE IF NOT EXISTS public.weekly_stimulus_targets (
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  week_start date NOT NULL,
  stimulus_type text NOT NULL,
  stimulus_key text NOT NULL,
  target_value numeric NOT NULL DEFAULT 0,
  unit text NOT NULL DEFAULT 'score',
  context_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, week_start, stimulus_type, stimulus_key),
  CONSTRAINT weekly_stimulus_targets_type_check CHECK (stimulus_type IN ('pattern','muscle','energy','focus','load','other')),
  CONSTRAINT weekly_stimulus_targets_value_check CHECK (target_value >= 0),
  CONSTRAINT weekly_stimulus_targets_context_check CHECK (jsonb_typeof(context_json)='object')
);

CREATE TABLE IF NOT EXISTS public.session_stimulus_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  session_id uuid REFERENCES public.workout_sessions(id) ON DELETE SET NULL,
  source_kind text NOT NULL DEFAULT 'internal',
  stimulus_type text NOT NULL,
  stimulus_key text NOT NULL,
  planned_value numeric NOT NULL DEFAULT 0,
  realized_value numeric,
  unit text NOT NULL DEFAULT 'score',
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT session_stimulus_ledger_source_check CHECK (source_kind IN ('internal','external_import','manual')),
  CONSTRAINT session_stimulus_ledger_type_check CHECK (stimulus_type IN ('pattern','muscle','energy','focus','load','other')),
  CONSTRAINT session_stimulus_ledger_values_check CHECK (planned_value >= 0 AND (realized_value IS NULL OR realized_value >= 0)),
  CONSTRAINT session_stimulus_ledger_metadata_check CHECK (jsonb_typeof(metadata_json)='object')
);

CREATE INDEX IF NOT EXISTS idx_session_stimulus_user_time
  ON public.session_stimulus_ledger(user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_session_stimulus_session
  ON public.session_stimulus_ledger(session_id);
CREATE INDEX IF NOT EXISTS idx_session_stimulus_dimension
  ON public.session_stimulus_ledger(stimulus_type, stimulus_key);

CREATE TABLE IF NOT EXISTS public.user_training_plan_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  sequence_index integer NOT NULL,
  recommended_date date,
  session_id uuid REFERENCES public.workout_sessions(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'available',
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_training_plan_items_sequence_check CHECK (sequence_index >= 0),
  CONSTRAINT user_training_plan_items_status_check CHECK (status IN ('available','completed','skipped')),
  CONSTRAINT user_training_plan_items_completed_check CHECK (status <> 'completed' OR completed_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_training_plan_user_sequence
  ON public.user_training_plan_items(user_id, sequence_index);
CREATE INDEX IF NOT EXISTS idx_training_plan_user_date
  ON public.user_training_plan_items(user_id, recommended_date);

ALTER TABLE public.weekly_stimulus_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.session_stimulus_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_training_plan_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users own weekly stimulus targets" ON public.weekly_stimulus_targets;
CREATE POLICY "Users own weekly stimulus targets" ON public.weekly_stimulus_targets
FOR ALL TO authenticated USING (auth.uid()=user_id) WITH CHECK (auth.uid()=user_id);

DROP POLICY IF EXISTS "Users own session stimulus ledger" ON public.session_stimulus_ledger;
CREATE POLICY "Users own session stimulus ledger" ON public.session_stimulus_ledger
FOR ALL TO authenticated USING (auth.uid()=user_id) WITH CHECK (auth.uid()=user_id);

DROP POLICY IF EXISTS "Users own training plan items" ON public.user_training_plan_items;
CREATE POLICY "Users own training plan items" ON public.user_training_plan_items
FOR ALL TO authenticated USING (auth.uid()=user_id) WITH CHECK (auth.uid()=user_id);

CREATE OR REPLACE VIEW public.weekly_stimulus_balance
WITH (security_invoker=true)
AS
WITH realized AS (
  SELECT
    user_id,
    date_trunc('week', occurred_at)::date AS week_start,
    stimulus_type,
    stimulus_key,
    unit,
    sum(planned_value) AS planned_from_sessions,
    sum(COALESCE(realized_value,0)) AS realized_value
  FROM public.session_stimulus_ledger
  GROUP BY user_id,date_trunc('week', occurred_at)::date,stimulus_type,stimulus_key,unit
), keys AS (
  SELECT user_id,week_start,stimulus_type,stimulus_key,unit FROM public.weekly_stimulus_targets
  UNION
  SELECT user_id,week_start,stimulus_type,stimulus_key,unit FROM realized
)
SELECT
  k.user_id,k.week_start,k.stimulus_type,k.stimulus_key,k.unit,
  t.target_value,
  r.planned_from_sessions,
  r.realized_value,
  CASE WHEN t.target_value IS NULL THEN NULL ELSE t.target_value - COALESCE(r.realized_value,0) END AS remaining_to_target
FROM keys k
LEFT JOIN public.weekly_stimulus_targets t
  ON t.user_id=k.user_id AND t.week_start=k.week_start AND t.stimulus_type=k.stimulus_type AND t.stimulus_key=k.stimulus_key AND t.unit=k.unit
LEFT JOIN realized r
  ON r.user_id=k.user_id AND r.week_start=k.week_start AND r.stimulus_type=k.stimulus_type AND r.stimulus_key=k.stimulus_key AND r.unit=k.unit;;
