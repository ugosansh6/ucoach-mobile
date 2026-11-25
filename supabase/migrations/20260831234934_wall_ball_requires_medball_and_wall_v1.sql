-- Wall Ball needs both a medball and a vertical target. Option groups are OR alternatives;
-- place E49 in the same group as E09 so both are required.
delete from public.exercise_equipment_requirements_v2
where exercise_id='EX305' and equipment_id='E49';

insert into public.exercise_equipment_requirements_v2(exercise_id,option_group,equipment_id,min_quantity,is_optional,notes)
values ('EX305',1,'E49',1,false,'Wall Ball requires a vertical target in addition to the medball; never infer it from the environment.')
on conflict (exercise_id,option_group,equipment_id) do update set
  min_quantity=excluded.min_quantity,
  is_optional=excluded.is_optional,
  notes=excluded.notes;
