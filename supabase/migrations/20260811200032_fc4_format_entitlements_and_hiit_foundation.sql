-- F-C4 — format entitlements + HIIT foundation

alter table public.profiles
  add column if not exists subscription_tier text not null default 'FREE';

alter table public.profiles
  drop constraint if exists profiles_subscription_tier_check;

alter table public.profiles
  add constraint profiles_subscription_tier_check
  check (subscription_tier in ('FREE','PREMIUM'));

alter table public.workout_mechanics
  add column if not exists manual_free_eligible boolean not null default false,
  add column if not exists short_description text;

alter table public.workout_mechanic_variants
  add column if not exists manual_free_eligible boolean not null default false,
  add column if not exists manual_premium_eligible boolean not null default true,
  add column if not exists short_description text;

-- Manual Free selection: exactly the product-approved base formats.
update public.workout_mechanics
set manual_free_eligible = mechanic_key in (
  'AMRAP','EMOM','CIRCUIT','LADDER','FOR_TIME','HIIT'
);

update public.workout_mechanics set short_description = case mechanic_key
  when 'AMRAP' then 'Accumule le plus de tours ou de répétitions possible dans un temps donné.'
  when 'EMOM' then 'Un travail démarre au début de chaque minute, le temps restant sert à récupérer.'
  when 'CIRCUIT' then 'Enchaîne plusieurs exercices sur plusieurs tours avec une récupération maîtrisée.'
  when 'FOR_TIME' then 'Termine le volume prévu le plus rapidement possible, avec un cap de sécurité.'
  when 'LADDER' then 'Les répétitions évoluent progressivement à chaque étape.'
  when 'PYRAMID' then 'Le volume monte puis redescend selon une séquence structurée.'
  when 'PROGRESSIVE_INTERVAL' then 'La difficulté augmente intervalle après intervalle jusqu’à la limite prévue.'
  when 'STRENGTH' then 'Travail en séries avec récupération plus longue et priorité à la qualité de force.'
  when 'CHIPPER' then 'Un seul passage à travers une liste d’exercices et de volumes à terminer.'
  when 'EVERY_X_MINUTES' then 'Réalise le travail demandé à intervalles réguliers avec récupération résiduelle.'
  when 'ODD_EVEN' then 'Deux exercices alternent entre les minutes impaires et paires.'
  when 'REP_TARGET' then 'Atteins un objectif total de répétitions réparti entre les exercices.'
  when 'COUPLET' then 'Deux exercices évoluent ensemble selon une structure progressive.'
  when 'DECK' then 'Quatre exercices sont pilotés par un paquet de cartes mélangé de façon contrôlée.'
  when 'HIIT' then 'Alterne effort et récupération sur plusieurs exercices et plusieurs tours.'
  else short_description
end;

update public.workout_mechanic_variants
set manual_free_eligible = false,
    manual_premium_eligible = true,
    short_description = case variant_key
      when 'ASCENDING_COUPLET' then 'Deux exercices dont les répétitions augmentent à chaque étape.'
      when 'DESCENDING_COUPLET' then 'Deux exercices dont les répétitions diminuent à chaque étape.'
      when 'DEATH_BY' then 'Un exercice progresse à chaque intervalle jusqu’à ne plus pouvoir finir dans le temps.'
      when 'DEATH_BY_COUPLET' then 'Deux exercices progressent indépendamment à chaque intervalle jusqu’à l’échec.'
      when 'PROGRESSIVE_GENERIC' then 'Une progression structurée de la dose de travail à chaque intervalle.'
      else short_description
    end;

insert into public.workout_mechanics (
  mechanic_key,
  display_name,
  format_family,
  auto_free_eligible,
  manual_premium_eligible,
  active,
  notes,
  mechanic_kind,
  manual_free_eligible,
  short_description
)
values (
  'HIIT',
  'HIIT',
  'HIIT',
  true,
  true,
  true,
  'Dynamic work/rest intervals. Exercise count, rounds and interval durations are solved by UGEROD.',
  'core',
  true,
  'Alterne effort et récupération sur plusieurs exercices et plusieurs tours.'
)
on conflict (mechanic_key) do update
set display_name = excluded.display_name,
    format_family = excluded.format_family,
    auto_free_eligible = excluded.auto_free_eligible,
    manual_premium_eligible = excluded.manual_premium_eligible,
    active = excluded.active,
    notes = excluded.notes,
    mechanic_kind = excluded.mechanic_kind,
    manual_free_eligible = excluded.manual_free_eligible,
    short_description = excluded.short_description;

-- HIIT: dynamic 3–5 exercise structure; 4 is the preferred shape, not a fixed rule.
insert into public.block_rules (
  block_key,
  format,
  min_exercises,
  max_exercises,
  preferred_exercises,
  active
)
select 'wod','HIIT',3,5,4,true
where not exists (
  select 1 from public.block_rules
  where block_key='wod' and upper(coalesce(format,''))='HIIT'
);

update public.block_rules
set min_exercises=3,
    max_exercises=5,
    preferred_exercises=4,
    active=true
where block_key='wod' and upper(coalesce(format,''))='HIIT';

-- Policy-driven HIIT parameters. These are solver options, never fixed UI promises.
update public.session_engine_policy
set config = jsonb_set(
  jsonb_set(
    jsonb_set(
      jsonb_set(
        jsonb_set(
          config,
          '{mechanic_defaults,hiit_work_options_seconds}',
          '[30,40,45,50]'::jsonb,
          true
        ),
        '{mechanic_defaults,hiit_rest_options_seconds}',
        '[15,20,30]'::jsonb,
        true
      ),
      '{mechanic_defaults,hiit_min_rounds}',
      '3'::jsonb,
      true
    ),
    '{mechanic_defaults,hiit_max_rounds}',
    '6'::jsonb,
    true
  ),
  '{mechanic_defaults,hiit_target_utilization_percent}',
  '92'::jsonb,
  true
)
where policy_key='c4-final-default';

update public.session_engine_policy
set config = jsonb_set(
  config,
  '{mechanic_duration_target_percent,HIIT}',
  '92'::jsonb,
  true
)
where policy_key='c3-sim-default';;
