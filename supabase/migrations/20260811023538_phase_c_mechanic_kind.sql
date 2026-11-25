ALTER TABLE public.workout_mechanics
  ADD COLUMN IF NOT EXISTS mechanic_kind text NOT NULL DEFAULT 'core';
ALTER TABLE public.workout_mechanics
  DROP CONSTRAINT IF EXISTS workout_mechanics_kind_check;
ALTER TABLE public.workout_mechanics
  ADD CONSTRAINT workout_mechanics_kind_check CHECK (mechanic_kind IN ('core','overlay'));;
