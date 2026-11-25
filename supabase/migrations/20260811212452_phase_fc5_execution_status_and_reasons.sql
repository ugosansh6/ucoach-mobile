alter table public.workout_session_exercises
  add column if not exists user_execution_status text,
  add column if not exists execution_reason_code text;

update public.workout_session_exercises
set user_execution_status = case status
  when 'pending' then 'pending'
  when 'skipped' then 'not_completed'
  else 'completed'
end
where user_execution_status is null;

alter table public.workout_session_exercises
  alter column user_execution_status set default 'pending',
  alter column user_execution_status set not null;

alter table public.workout_session_exercises
  drop constraint if exists workout_session_exercises_user_execution_status_check;
alter table public.workout_session_exercises
  add constraint workout_session_exercises_user_execution_status_check
  check (user_execution_status = any (array['pending'::text,'completed'::text,'adapted'::text,'not_completed'::text]));

alter table public.exercise_logs
  add column if not exists user_execution_status text,
  add column if not exists execution_reason_code text;

update public.exercise_logs
set user_execution_status = case status
  when 'skipped' then 'not_completed'
  else 'completed'
end
where user_execution_status is null;

alter table public.exercise_logs
  alter column user_execution_status set default 'completed',
  alter column user_execution_status set not null;

alter table public.exercise_logs
  drop constraint if exists exercise_logs_user_execution_status_check;
alter table public.exercise_logs
  add constraint exercise_logs_user_execution_status_check
  check (user_execution_status = any (array['completed'::text,'adapted'::text,'not_completed'::text]));

comment on column public.workout_session_exercises.user_execution_status is 'User-facing execution outcome. Legacy status remains pending/completed/skipped for engine compatibility.';
comment on column public.workout_session_exercises.execution_reason_code is 'Optional user reason selected on completion screen for adapted or non-completed execution.';
comment on column public.exercise_logs.user_execution_status is 'User-facing completed/adapted/not_completed outcome, separate from legacy completed/skipped capability status.';
comment on column public.exercise_logs.execution_reason_code is 'Optional user-selected reason code for adaptation or non-completion.';;
