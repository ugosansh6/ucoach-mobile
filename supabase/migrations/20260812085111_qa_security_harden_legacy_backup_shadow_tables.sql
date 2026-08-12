revoke insert, update, delete, truncate, references, trigger on table public._backup_exercise_logs_pre_progress_v21 from authenticated;
revoke insert, update, delete, truncate, references, trigger on table public._backup_workout_session_exercises_pre_progress_v21 from authenticated;
revoke insert, update, delete, truncate, references, trigger on table public.capability_live_run_errors from authenticated;
revoke insert, update, delete, truncate, references, trigger on table public.user_exercise_capabilities_shadow from authenticated;
revoke insert, update, delete, truncate, references, trigger on table public.programs from authenticated;
revoke insert, update, delete, truncate, references, trigger on table public.workout_logs from authenticated;
revoke insert, update, delete, truncate, references, trigger on table public.workout_requests from authenticated;

grant select on table public._backup_exercise_logs_pre_progress_v21,
 public._backup_workout_session_exercises_pre_progress_v21,
 public.capability_live_run_errors,
 public.user_exercise_capabilities_shadow,
 public.programs,
 public.workout_logs,
 public.workout_requests to authenticated;;
