-- P0-B reference precision for preparation/runtime environment gates.
-- Correct obvious false positives from the original heuristic and add explicit
-- rope/jump requirements that were missed because their movement_pattern is Conditioning.

delete from public.exercise_environment_requirements
where (exercise_id, requirement_key) in (
  ('EX442','travel_space'),
  ('EXW025','travel_space')
);

insert into public.exercise_environment_requirements (exercise_id, requirement_key, reason)
values
  ('EX156','jumping_allowed','Le Single Under nécessite que les sauts soient possibles dans l’environnement actuel.'),
  ('EX156','overhead_clearance','La corde à sauter nécessite une hauteur libre suffisante.'),
  ('EX157','jumping_allowed','Le Double Under nécessite que les sauts soient possibles dans l’environnement actuel.'),
  ('EX157','overhead_clearance','La corde à sauter nécessite une hauteur libre suffisante.'),
  ('EX476','jumping_allowed','Le drill Penguin Tap nécessite des sauts verticaux.'),
  ('EXW007','jumping_allowed','Le Single Under de préparation nécessite que les sauts soient possibles.'),
  ('EXW007','overhead_clearance','La corde à sauter de préparation nécessite une hauteur libre suffisante.')
on conflict (exercise_id, requirement_key) do update
set reason=excluded.reason;
