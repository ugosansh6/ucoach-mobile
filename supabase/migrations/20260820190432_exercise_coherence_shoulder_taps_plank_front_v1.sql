insert into public.exercise_functional_group_members(exercise_id,group_key,source,confidence,notes)
values ('EX315','PLANK_FRONT','CURATED_V1_2',1.000,'Shoulder Taps is a dynamic front-plank anti-rotation variant, not a Hollow Body variant.')
on conflict (exercise_id) do update
set group_key=excluded.group_key,
    source=excluded.source,
    confidence=excluded.confidence,
    notes=excluded.notes;
