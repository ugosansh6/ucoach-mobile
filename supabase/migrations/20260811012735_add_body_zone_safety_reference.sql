create table if not exists public.body_zones (
  id text primary key,
  label_fr text not null unique,
  zone_group text not null check (zone_group in ('upper','trunk','lower')),
  zone_type text not null check (zone_type in ('joint_area','muscle_region','mixed')),
  sort_order smallint not null,
  active boolean not null default true
);

create table if not exists public.exercise_body_zones (
  exercise_id varchar references public.exercises(id) on delete cascade,
  body_zone_id text references public.body_zones(id) on delete cascade,
  involvement text not null check (involvement in ('primary','secondary','support')),
  source text not null default 'manual' check (source in ('manual','muscle_mapping','pattern_rule','reviewed')),
  notes text,
  primary key (exercise_id, body_zone_id)
);

alter table public.body_zones enable row level security;
alter table public.exercise_body_zones enable row level security;

create policy "Allow public read on body_zones"
on public.body_zones for select
to public
using (true);

create policy "Allow public read on exercise_body_zones"
on public.exercise_body_zones for select
to public
using (true);

insert into public.body_zones (id, label_fr, zone_group, zone_type, sort_order, active) values
('shoulder', 'Épaule', 'upper', 'joint_area', 10, true),
('chest', 'Pectoraux', 'upper', 'muscle_region', 20, true),
('arm_elbow', 'Bras / coude', 'upper', 'mixed', 30, true),
('forearm_wrist_hand', 'Avant-bras / poignet / main', 'upper', 'mixed', 40, true),
('upper_back_neck', 'Haut du dos / nuque', 'upper', 'mixed', 50, true),
('core_abdomen', 'Sangle abdominale', 'trunk', 'muscle_region', 60, true),
('lower_back', 'Bas du dos', 'trunk', 'mixed', 70, true),
('hip_glute_groin', 'Hanche / fessiers / aine', 'lower', 'mixed', 80, true),
('quadriceps', 'Cuisse avant / quadriceps', 'lower', 'muscle_region', 90, true),
('hamstring', 'Cuisse arrière / ischios', 'lower', 'muscle_region', 100, true),
('knee', 'Genou', 'lower', 'joint_area', 110, true),
('calf_shin', 'Mollet / tibia', 'lower', 'mixed', 120, true),
('ankle_foot', 'Cheville / pied', 'lower', 'mixed', 130, true)
on conflict (id) do update set
  label_fr = excluded.label_fr,
  zone_group = excluded.zone_group,
  zone_type = excluded.zone_type,
  sort_order = excluded.sort_order,
  active = excluded.active;
