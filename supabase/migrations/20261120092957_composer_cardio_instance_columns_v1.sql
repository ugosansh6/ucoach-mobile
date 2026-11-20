-- Align the additive CARDIO branch with the established session-instance schema.
do $migration$
declare d text; before text:='exercise_name,block_key,exercise_order,prescription_text,prescription_json,status,user_execution_status)';
begin
 select pg_get_functiondef(oid) into d from pg_proc where proname='week_compile_composer_day_j_v1';
 if d is null or position(before in d)=0 then raise exception 'Concurrent compiler change: CARDIO instance insert'; end if;
 d:=replace(d,before,'exercise_name,block_key,position,prescription,prescription_json,status,user_execution_status)');
 execute d;
end $migration$;
