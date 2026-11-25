update public.exercises
set display_name=case id
  when 'EX421' then 'Mobilité cheville'
  when 'EX422' then '90/90 hanches'
  when 'EX430' then 'Pont fessier'
  when 'EX433' then 'Dead Bug'
  when 'EX439' then 'Pompes scapulaires au mur'
  when 'EX444' then 'Cercles de bras'
  when 'EXW006' then 'Élévation bras à genoux'
  when 'EXW012' then 'Cercles de poignets'
  when 'EXW015' then 'Pompes scapulaires à 4 pattes'
  when 'EXW016' then 'Élévation bras au mur'
  when 'EXW019' then 'Fentes arrière + reach'
  when 'EXW029' then 'Pompes au mur lentes'
  when 'EX315' then 'Shoulder Taps'
  when 'EX051' then 'Fentes arrière'
  when 'EX478' then 'Pistol assisté'
  when 'EX314' then 'Pas chassés'
  when 'EX027' then 'Handstand Hold'
  else display_name end
where id in ('EX421','EX422','EX430','EX433','EX439','EX444','EXW006','EXW012','EXW015','EXW016','EXW019','EXW029','EX315','EX051','EX478','EX314','EX027');

update public.workout_sessions
set generated_workout=public.ugerod_apply_display_names_to_workout_v1(generated_workout),updated_at=updated_at
where status in ('generated','in_progress') and generated_workout is not null;

update public.workout_session_exercises wse
set exercise_name=coalesce(nullif(btrim(e.display_name),''),e.name),updated_at=wse.updated_at
from public.exercises e
where e.id=wse.exercise_id and wse.status='pending';
