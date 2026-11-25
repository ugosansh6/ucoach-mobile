create table if not exists public.exercise_equipment_requirements_v2 (
  exercise_id varchar not null references public.exercises(id) on delete cascade,
  option_group smallint not null default 1 check (option_group >= 1),
  equipment_id varchar not null references public.equipment(id) on delete restrict,
  min_quantity smallint not null default 1 check (min_quantity >= 1),
  is_optional boolean not null default false,
  notes text,
  primary key (exercise_id, option_group, equipment_id)
);

comment on table public.exercise_equipment_requirements_v2 is
'Equipment eligibility model. All required rows inside one option_group are ALL_OF. Different option_groups are ANY_OF alternatives. is_optional rows never gate eligibility.';

create table if not exists public.exercise_load_semantics (
  exercise_id varchar primary key references public.exercises(id) on delete cascade,
  equipment_id varchar not null references public.equipment(id) on delete restrict,
  load_scope text not null check (load_scope in ('single_implement','per_implement','total_external')),
  expected_implement_count smallint not null default 1 check (expected_implement_count >= 1),
  symmetric_load boolean not null default true,
  notes text
);

comment on table public.exercise_load_semantics is
'Defines what one recorded/recommended load_kg means for an exercise. single_implement=one object; per_implement=load per equal object (e.g. each dumbbell); total_external=combined external load.';

create table if not exists public.user_equipment_inventory (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  equipment_id varchar not null references public.equipment(id) on delete restrict,
  inventory_mode text not null default 'non_load' check (inventory_mode in ('non_load','fixed_load','adjustable_load')),
  quantity smallint not null default 1 check (quantity >= 1),
  load_kg numeric(7,2),
  min_load_kg numeric(7,2),
  max_load_kg numeric(7,2),
  increment_kg numeric(7,2),
  resistance_label text,
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (inventory_mode='non_load' and load_kg is null and min_load_kg is null and max_load_kg is null and increment_kg is null)
    or
    (inventory_mode='fixed_load' and load_kg is not null and load_kg > 0 and min_load_kg is null and max_load_kg is null and increment_kg is null)
    or
    (inventory_mode='adjustable_load' and min_load_kg is not null and max_load_kg is not null and min_load_kg > 0 and max_load_kg >= min_load_kg and increment_kg is not null and increment_kg > 0 and load_kg is null)
  )
);

create index if not exists idx_user_equipment_inventory_user_equipment
  on public.user_equipment_inventory(user_id,equipment_id)
  where active=true;

alter table public.user_equipment_inventory enable row level security;

drop policy if exists "Users read own equipment inventory" on public.user_equipment_inventory;
create policy "Users read own equipment inventory"
  on public.user_equipment_inventory for select
  using (auth.uid() = user_id);

drop policy if exists "Users insert own equipment inventory" on public.user_equipment_inventory;
create policy "Users insert own equipment inventory"
  on public.user_equipment_inventory for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users update own equipment inventory" on public.user_equipment_inventory;
create policy "Users update own equipment inventory"
  on public.user_equipment_inventory for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users delete own equipment inventory" on public.user_equipment_inventory;
create policy "Users delete own equipment inventory"
  on public.user_equipment_inventory for delete
  using (auth.uid() = user_id);

alter table public.exercise_equipment_requirements_v2 enable row level security;
alter table public.exercise_load_semantics enable row level security;

drop policy if exists "Public read equipment requirements v2" on public.exercise_equipment_requirements_v2;
create policy "Public read equipment requirements v2"
  on public.exercise_equipment_requirements_v2 for select using (true);

drop policy if exists "Public read load semantics" on public.exercise_load_semantics;
create policy "Public read load semantics"
  on public.exercise_load_semantics for select using (true);;
