-- Workout state and performance logs are authoritative coach data.
-- The mobile client can read its own rows but mutations must go through
-- authenticated SECURITY DEFINER RPCs / trusted Edge Functions.

revoke insert, update, delete, truncate, references, trigger on table public.workout_sessions from authenticated;
grant select on table public.workout_sessions to authenticated;

revoke insert, update, delete, truncate, references, trigger on table public.workout_session_exercises from authenticated;
grant select on table public.workout_session_exercises to authenticated;

revoke insert, update, delete, truncate, references, trigger on table public.exercise_logs from authenticated;
grant select on table public.exercise_logs to authenticated;;
