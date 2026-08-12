alter table public.muscles
  add column if not exists semantic_type text not null default 'local_muscle',
  add column if not exists local_fatigue_eligible boolean not null default true;

update public.muscles
set semantic_type = case
  when id = 'M15' then 'global_mobility'
  when id = 'M16' then 'systemic'
  else 'local_muscle'
end,
local_fatigue_eligible = case when id in ('M15','M16') then false else true end;

alter table public.muscles
  drop constraint if exists muscles_semantic_type_check;

alter table public.muscles
  add constraint muscles_semantic_type_check
  check (semantic_type in ('local_muscle','systemic','global_mobility'));

create or replace view public.exercise_local_fatigue_basis as
select
  e.id as exercise_id,
  e.name as exercise_name,
  e.exercise_family,
  e.movement_pattern,
  e.fatigue_score,
  m.id as muscle_id,
  m.name as muscle_name,
  em.priority
from public.exercises e
join public.exercise_muscles em on em.exercise_id = e.id
join public.muscles m on m.id = em.muscle_id
where m.local_fatigue_eligible = true
  and e.usable_for is not null
  and cardinality(e.usable_for) > 0;;
