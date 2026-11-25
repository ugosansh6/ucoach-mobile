create or replace function public.skill_curriculum_prescription_patch_v1(
  p_exercise_id text,
  p_role text,
  p_current jsonb
)
returns jsonb
language plpgsql
immutable
set search_path to 'public'
as $function$
declare
  r jsonb:=coalesce(p_current,'{}'::jsonb);
begin
  if p_exercise_id='EX027' then
    r:=(r
      -'execution_target_reps'
      -'reps_min'
      -'reps_max'
      -'reps_semantics'
      -'duration_seconds_min'
      -'duration_seconds_max')
      || jsonb_build_object(
        'sets',2,
        'execution_target_duration_seconds',30,
        'duration_seconds_min',30,
        'duration_seconds_max',30,
        'text','2 séries · 30 sec ventre au mur · ligne propre',
        'curriculum_prescription_kind','LINE_HOLD'
      );
  elsif p_exercise_id='EX460' then
    r:=(r
      -'execution_target_duration_seconds'
      -'duration_seconds_min'
      -'duration_seconds_max')
      || jsonb_build_object(
        'sets',2,
        'execution_target_reps',5,
        'reps_min',5,
        'reps_max',5,
        'reps_semantics','per_side',
        'text','2 séries · 5 transferts contrôlés / côté',
        'curriculum_prescription_kind','CONTROL_REPS'
      );
  elsif p_exercise_id='EX461' then
    r:=(r
      -'execution_target_duration_seconds'
      -'duration_seconds_min'
      -'duration_seconds_max')
      || jsonb_build_object(
        'sets',2,
        'execution_target_reps',5,
        'reps_min',5,
        'reps_max',5,
        'reps_semantics','per_side',
        'text','2 séries · 5 décollages de main / côté',
        'curriculum_prescription_kind','CONTROL_REPS'
      );
  elsif p_exercise_id='EX462' then
    r:=(r
      -'execution_target_duration_seconds'
      -'duration_seconds_min'
      -'duration_seconds_max')
      || jsonb_build_object(
        'sets',2,
        'execution_target_reps',5,
        'reps_min',5,
        'reps_max',5,
        'reps_semantics','per_side',
        'text','2 séries · 5 shoulder taps contrôlés / côté',
        'curriculum_prescription_kind','CONTROL_REPS'
      );
  elsif p_exercise_id='EX464' then
    r:=(r
      -'execution_target_duration_seconds'
      -'duration_seconds_min'
      -'duration_seconds_max')
      || jsonb_build_object(
        'sets',2,
        'execution_target_reps',5,
        'reps_min',5,
        'reps_max',5,
        'text','2 séries · 5 Toe Pull / Wall Float contrôlés',
        'curriculum_prescription_kind','CONTROL_REPS'
      );
  elsif p_exercise_id='EX451' then
    r:=(r
      -'execution_target_duration_seconds'
      -'duration_seconds_min'
      -'duration_seconds_max'
      -'execution_target_reps'
      -'reps_min'
      -'reps_max'
      -'reps_semantics')
      || jsonb_build_object(
        'sets',1,
        'text','10–15 kick-ups / tentatives libres propres · cherche le point d’équilibre',
        'curriculum_prescription_kind','QUALITY_ATTEMPTS',
        'quality_attempts_min',10,
        'quality_attempts_max',15
      );
  elsif p_exercise_id='EX465' then
    r:=(r
      -'execution_target_duration_seconds'
      -'duration_seconds_min'
      -'duration_seconds_max')
      || jsonb_build_object(
        'sets',2,
        'execution_target_reps',5,
        'reps_min',5,
        'reps_max',5,
        'reps_semantics','per_side',
        'text','2 séries · 5 transferts libres / côté',
        'curriculum_prescription_kind','CONTROL_REPS'
      );
  elsif p_exercise_id='EX466' then
    r:=(r
      -'execution_target_duration_seconds'
      -'duration_seconds_min'
      -'duration_seconds_max'
      -'execution_target_reps'
      -'reps_min'
      -'reps_max'
      -'reps_semantics')
      || jsonb_build_object(
        'sets',1,
        'text','8–10 départs contrôlés · cherche 1 à 3 pas propres',
        'curriculum_prescription_kind','QUALITY_ATTEMPTS',
        'quality_attempts_min',8,
        'quality_attempts_max',10
      );
  elsif p_exercise_id='EX201' then
    r:=(r
      -'execution_target_duration_seconds'
      -'duration_seconds_min'
      -'duration_seconds_max'
      -'execution_target_reps'
      -'reps_min'
      -'reps_max'
      -'reps_semantics')
      || jsonb_build_object(
        'sets',1,
        'text','4–6 passages contrôlés · priorité à la ligne et au transfert',
        'curriculum_prescription_kind','QUALITY_ATTEMPTS',
        'quality_attempts_min',4,
        'quality_attempts_max',6
      );
  end if;
  return r;
end;
$function$;
