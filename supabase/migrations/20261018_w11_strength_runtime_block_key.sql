-- Composer native Strength requires a distinct runtime block key.
alter table public.workout_session_exercises
  drop constraint workout_session_exercises_block_key_check;
alter table public.workout_session_exercises
  add constraint workout_session_exercises_block_key_check
  check (block_key in ('unlock','warm_up','tabata','skill','strength','wod'));
