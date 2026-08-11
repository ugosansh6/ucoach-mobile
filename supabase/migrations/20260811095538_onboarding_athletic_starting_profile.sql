alter table public.profiles
  add column if not exists athletic_starting_profile jsonb not null
  default '{"version":1,"source":"onboarding_self_assessment","unsure":true,"strengths":[],"weaknesses":[],"scores":{"strength":3,"cardio_endurance":3,"bodyweight":3,"explosiveness":3,"mobility":3}}'::jsonb;

alter table public.profiles
  drop constraint if exists profiles_athletic_starting_profile_object;

alter table public.profiles
  add constraint profiles_athletic_starting_profile_object
  check (jsonb_typeof(athletic_starting_profile) = 'object');

comment on column public.profiles.athletic_starting_profile is
  'Cold-start self-assessment only. Neutral=3/5, declared strengths=4/5, declared weaknesses=2/5. Real performance observations must supersede this prior.';
