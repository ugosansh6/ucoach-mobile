DO $migration$
DECLARE d text;
BEGIN
 SELECT pg_get_functiondef('public.week_composer_exercise_compatibility_v1(text[],text[],text)'::regprocedure) INTO d;
 IF position('''wod_role'',e.wod_role' in d)>0 OR position('''equipment_ok'',public.exercise_equipment_compatible' in d)=0 THEN RAISE EXCEPTION 'Unexpected compatibility version'; END IF;
 d:=replace(d,'''equipment_ok'',public.exercise_equipment_compatible','''wod_role'',e.wod_role,''equipment_ok'',public.exercise_equipment_compatible');
 EXECUTE d;
END $migration$;;
