create table if not exists public.exercise_environment_requirements (
  exercise_id text not null references public.exercises(id) on delete cascade,
  requirement_key text not null,
  reason text null,
  created_at timestamptz not null default now(),
  primary key (exercise_id, requirement_key),
  constraint exercise_environment_requirements_key_check
    check (requirement_key in ('wall','travel_space','overhead_clearance','jumping_allowed'))
);

alter table public.exercise_environment_requirements enable row level security;

drop policy if exists exercise_environment_requirements_read on public.exercise_environment_requirements;
create policy exercise_environment_requirements_read
  on public.exercise_environment_requirements
  for select
  to authenticated
  using (true);

grant select on public.exercise_environment_requirements to authenticated;

insert into public.exercise_environment_requirements (exercise_id, requirement_key, reason)
select e.id, 'wall', 'Ce mouvement nécessite un mur exploitable.'
from public.exercises e
where lower(e.name) like '%wall%'
   or lower(e.name) like '%mur%'
on conflict (exercise_id, requirement_key) do update
set reason = excluded.reason;

insert into public.exercise_environment_requirements (exercise_id, requirement_key, reason)
select e.id, 'travel_space', 'Ce mouvement nécessite un espace de déplacement exploitable.'
from public.exercises e
where e.movement_pattern in ('Carry','Locomotion')
   or lower(e.name) like '%carry%'
   or lower(e.name) like '%walk%'
on conflict (exercise_id, requirement_key) do update
set reason = excluded.reason;

insert into public.exercise_environment_requirements (exercise_id, requirement_key, reason)
select e.id, 'overhead_clearance', 'Ce mouvement nécessite une hauteur libre suffisante au-dessus de la tête.'
from public.exercises e
where e.starting_position = 'Handstand'
   or lower(e.name) like '%overhead%'
on conflict (exercise_id, requirement_key) do update
set reason = excluded.reason;

insert into public.exercise_environment_requirements (exercise_id, requirement_key, reason)
select e.id, 'jumping_allowed', 'Ce mouvement nécessite que les sauts soient possibles dans l’environnement actuel.'
from public.exercises e
where e.movement_pattern = 'Jump'
on conflict (exercise_id, requirement_key) do update
set reason = excluded.reason;
