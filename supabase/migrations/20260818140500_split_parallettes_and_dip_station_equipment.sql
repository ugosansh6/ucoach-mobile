begin;

insert into public.equipment (id, name, category, description)
values (
  'E19',
  'Parallettes',
  'Gym',
  'Petites barres parallèles basses au sol pour supports, L-Sit et exercices de gymnastique.'
)
on conflict (id) do update
set name = excluded.name,
    category = excluded.category,
    description = excluded.description;

update public.equipment
set description = 'Barres parallèles hautes ou station de dips permettant au corps de descendre entre les appuis.'
where id = 'E13';

update public.exercises
set name = 'Support Hold sur supports parallèles',
    description = 'Maintien bras tendus sur parallettes ou barres parallèles pour construire le support nécessaire aux dips et au L-Sit.'
where id = 'EX470';

update public.exercises
set name = 'Dip négatif aux barres parallèles',
    description = 'Descente contrôlée en dip sur barres parallèles ou station dips pour développer force et contrôle dans l’amplitude.'
where id = 'EX471';

update public.exercises
set name = 'Dip strict aux barres parallèles',
    description = 'Dip strict sur barres parallèles ou station dips avec contrôle complet de l’amplitude.'
where id = 'EX472';

delete from public.exercise_equipment
where exercise_id in ('EX470','EX471','EX472','EX473','EX474','EX475')
  and equipment_id in ('E13','E19');

insert into public.exercise_equipment (exercise_id, equipment_id)
values
  ('EX470','E13'),
  ('EX470','E19'),
  ('EX471','E13'),
  ('EX472','E13'),
  ('EX473','E19'),
  ('EX474','E19'),
  ('EX475','E19')
on conflict do nothing;

delete from public.exercise_equipment_requirements_v2
where exercise_id in ('EX470','EX471','EX472','EX473','EX474','EX475')
  and equipment_id in ('E13','E19');

insert into public.exercise_equipment_requirements_v2
  (exercise_id, option_group, equipment_id, min_quantity, is_optional, notes)
values
  ('EX470',1,'E13',1,false,'Barres parallèles hautes / station dips utilisables pour le Support Hold.'),
  ('EX470',2,'E19',1,false,'Parallettes basses utilisables comme alternative pour le Support Hold.'),
  ('EX471',1,'E13',1,false,'Barres parallèles hautes / station dips requises pour permettre la descente du corps.'),
  ('EX472',1,'E13',1,false,'Barres parallèles hautes / station dips requises pour permettre une amplitude complète.'),
  ('EX473',1,'E19',1,false,'Parallettes basses requises pour le Tuck L-Sit.'),
  ('EX474',1,'E19',1,false,'Parallettes basses requises pour le L-Sit une jambe.'),
  ('EX475',1,'E19',1,false,'Parallettes basses requises pour le L-Sit.')
on conflict (exercise_id, option_group, equipment_id) do update
set min_quantity = excluded.min_quantity,
    is_optional = excluded.is_optional,
    notes = excluded.notes;

commit;
