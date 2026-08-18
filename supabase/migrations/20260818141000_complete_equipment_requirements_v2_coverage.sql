insert into public.exercise_equipment_requirements_v2
  (exercise_id, option_group, equipment_id, min_quantity, is_optional, notes)
values
  ('EXW007',1,'E02',1,false,'Corde à sauter requise pour Easy Single Under.'),
  ('EXW008',1,'E10',1,false,'Box requise pour Box Step-Up Prep.')
on conflict (exercise_id, option_group, equipment_id) do update
set min_quantity=excluded.min_quantity,
    is_optional=excluded.is_optional,
    notes=excluded.notes;
