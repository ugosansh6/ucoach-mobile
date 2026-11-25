-- CARDIO already has a native Player. Its session rows need the same identity
-- and outcome contract as the other Composer blocks (not a WOD alias).
alter table public.workout_session_exercises drop constraint workout_session_exercises_block_key_check;
alter table public.workout_session_exercises add constraint workout_session_exercises_block_key_check
  check (block_key = any(array['unlock','warm_up','tabata','skill','strength','wod','cardio']::text[]));
do $migration$
declare d text;
begin
 select pg_get_functiondef(oid) into d from pg_proc where proname='week_compile_composer_day_j_v1';
 if position('exercise_name,block_key,position,prescription,prescription_json,status,user_execution_status)' in d)=0 then raise exception 'Concurrent CARDIO compiler change'; end if;
 d:=replace(d,'exercise_name,block_key,position,prescription,prescription_json,status,user_execution_status)',
   'exercise_name,block_key,position,prescription,prescription_json,status,user_execution_status,expected_outcome_json,selection_provenance)');
 d:=replace(d,$old$v_e#>>'{prescription,text}',v_e->'prescription','pending','pending');$old$,
   $new$v_e#>>'{prescription,text}',v_e->'prescription','pending','pending',v_e->'prescription','USER_SELECTED');$new$);
 execute d;
end $migration$;
