alter view public.performance_observation_contract set (security_invoker = true);
revoke all on table public.performance_observation_contract from anon;
grant select on table public.performance_observation_contract to authenticated;

-- Reference-only view: also make security semantics explicit.
alter view public.exercise_local_fatigue_basis set (security_invoker = true);;
