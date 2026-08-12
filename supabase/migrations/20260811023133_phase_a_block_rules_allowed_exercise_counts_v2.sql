ALTER TABLE public.block_rules
  ADD COLUMN IF NOT EXISTS allowed_exercise_counts smallint[];

UPDATE public.block_rules
SET allowed_exercise_counts = CASE
  WHEN block_key='tabata' AND duration_minutes=4 THEN ARRAY[1,2]::smallint[]
  WHEN block_key='tabata' AND duration_minutes=8 THEN ARRAY[1,2,4]::smallint[]
  ELSE allowed_exercise_counts
END;

ALTER TABLE public.block_rules
  DROP CONSTRAINT IF EXISTS block_rules_allowed_exercise_counts_nonempty;
ALTER TABLE public.block_rules
  ADD CONSTRAINT block_rules_allowed_exercise_counts_nonempty CHECK (
    allowed_exercise_counts IS NULL OR cardinality(allowed_exercise_counts) >= 1
  );;
