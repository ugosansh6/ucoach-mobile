ALTER TABLE public.exercise_logs
  DROP CONSTRAINT IF EXISTS exercise_logs_source_kind_check;
ALTER TABLE public.exercise_logs
  ADD CONSTRAINT exercise_logs_source_kind_check
  CHECK (source_kind IN ('internal','external_import','manual'));

ALTER TABLE public.exercise_logs
  DROP CONSTRAINT IF EXISTS exercise_logs_actual_json_object_check;
ALTER TABLE public.exercise_logs
  ADD CONSTRAINT exercise_logs_actual_json_object_check
  CHECK (jsonb_typeof(actual_json) = 'object');

ALTER TABLE public.user_exercise_capabilities
  DROP CONSTRAINT IF EXISTS user_exercise_capabilities_envelopes_object_check;
ALTER TABLE public.user_exercise_capabilities
  ADD CONSTRAINT user_exercise_capabilities_envelopes_object_check CHECK (
    jsonb_typeof(reps_envelope)='object' AND
    jsonb_typeof(load_envelope)='object' AND
    jsonb_typeof(time_envelope)='object' AND
    jsonb_typeof(distance_envelope)='object' AND
    jsonb_typeof(pace_envelope)='object' AND
    jsonb_typeof(density_envelope)='object'
  );;
