insert into public.exercise_functional_groups(group_key,display_name,rationale) values
('KB_SWING','Kettlebell Swing','Swing russe/américain : même geste de base, amplitude différente.'),
('HOLLOW_BODY','Hollow Body','Hollow Hold/Rocks : même position de gainage, variante statique/dynamique.'),
('DB_HORIZONTAL_PRESS','DB Horizontal Press','Floor Press/Bench Press : même poussée horizontale avec support différent.')
on conflict(group_key) do update set display_name=excluded.display_name,rationale=excluded.rationale,block_exclusive=true;

insert into public.exercise_functional_group_members(exercise_id,group_key,source,confidence) values
('EX110','KB_SWING','CURATED_V1_1',1),('EX111','KB_SWING','CURATED_V1_1',1),
('EX087','HOLLOW_BODY','CURATED_V1_1',1),('EX089','HOLLOW_BODY','CURATED_V1_1',1),
('EX307','DB_HORIZONTAL_PRESS','CURATED_V1_1',1),('EX308','DB_HORIZONTAL_PRESS','CURATED_V1_1',1)
on conflict(exercise_id) do update set group_key=excluded.group_key,source=excluded.source,confidence=excluded.confidence;