alter table public.exercise_muscles
  drop constraint if exists exercise_muscles_priority_check;

alter table public.exercise_muscles
  add constraint exercise_muscles_priority_check
  check (priority in ('primary','secondary'));;
