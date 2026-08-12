update public.exercises
set selection_weight = round(selection_weight / 10.0)::integer
where selection_weight > 10;

update public.exercises
set selection_weight = 7
where selection_weight is null;

alter table public.exercises
  alter column selection_weight set default 7;

alter table public.exercises
  alter column selection_weight set not null;

alter table public.exercises
  add constraint exercises_selection_weight_range_check
  check (selection_weight between 1 and 10);;
