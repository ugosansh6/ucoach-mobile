-- #29 / DEV. New Composer 20-minute sessions should persist at the same
-- minimum supported by week_update_plan_item_context_v1 and the C4 targets.
-- Widen the lower bound only. Keep ownership, status and all other constraints.
DO $guard$
DECLARE actual text;
BEGIN
 SELECT pg_get_constraintdef(c.oid) INTO actual
 FROM pg_constraint c
 JOIN pg_class t ON t.oid=c.conrelid
 JOIN pg_namespace n ON n.oid=t.relnamespace
 WHERE n.nspname='public' AND t.relname='user_training_plan_items'
   AND c.conname='user_training_plan_items_duration_check';
 IF actual IS DISTINCT FROM
 'CHECK (((planned_duration_minutes IS NULL) OR ((planned_duration_minutes >= 30) AND (planned_duration_minutes <= 90))))' THEN
    RAISE EXCEPTION 'Duration constraint baseline changed: %',actual;
 END IF;
END $guard$;
ALTER TABLE public.user_training_plan_items
 DROP CONSTRAINT user_training_plan_items_duration_check;
ALTER TABLE public.user_training_plan_items
 ADD CONSTRAINT user_training_plan_items_duration_check
 CHECK (planned_duration_minutes IS NULL
  OR (planned_duration_minutes >= 20 AND planned_duration_minutes <= 90));
