update public.exercises
set name = 'L-Sit au sol'
where id = 'EX091' and name = 'L-Sit sol';

insert into public.exercise_variants (
  exercise_id,
  target_exercise_id,
  variant_type,
  relation_axis,
  constraint_relief,
  stimulus_similarity,
  priority,
  is_preferred,
  coach_note
)
values
  (
    'EX473','EX480','equivalent','support',array['equipment']::text[],96,10,true,
    'Même étape de Tuck L-Sit sans parallettes ; privilégier cette variante si les parallettes sont indisponibles.'
  ),
  (
    'EX480','EX473','equivalent','support','{}'::text[],96,8,false,
    'Même étape de Tuck L-Sit avec parallettes pour davantage de dégagement.'
  ),
  (
    'EX474','EX481','equivalent','support',array['equipment']::text[],96,10,true,
    'Même étape de L-Sit une jambe sans parallettes ; privilégier cette variante si les parallettes sont indisponibles.'
  ),
  (
    'EX481','EX474','equivalent','support','{}'::text[],96,8,false,
    'Même étape de L-Sit une jambe avec parallettes pour davantage de dégagement.'
  ),
  (
    'EX475','EX091','equivalent','support',array['equipment']::text[],96,10,true,
    'Même L-Sit complet sans parallettes ; privilégier cette variante si les parallettes sont indisponibles.'
  ),
  (
    'EX091','EX475','equivalent','support','{}'::text[],96,8,false,
    'Même L-Sit complet avec parallettes pour davantage de dégagement.'
  )
on conflict (exercise_id,target_exercise_id,variant_type) do update
set relation_axis=excluded.relation_axis,
    constraint_relief=excluded.constraint_relief,
    stimulus_similarity=excluded.stimulus_similarity,
    priority=excluded.priority,
    is_preferred=excluded.is_preferred,
    coach_note=excluded.coach_note;
