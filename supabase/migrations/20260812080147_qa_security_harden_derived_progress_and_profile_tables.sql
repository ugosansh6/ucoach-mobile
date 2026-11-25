-- Legacy exercise progression is calculated data. Keep own read only.
drop policy if exists "Users can insert own exercise progress" on public.user_exercise_progress;
drop policy if exists "Users can update own exercise progress" on public.user_exercise_progress;
drop policy if exists "Users can read own exercise progress" on public.user_exercise_progress;
create policy "Users can read own exercise progress"
on public.user_exercise_progress for select to authenticated
using (auth.uid() = user_id);
revoke all on table public.user_exercise_progress from anon;
revoke insert, update, delete, truncate, references, trigger on table public.user_exercise_progress from authenticated;
grant select on table public.user_exercise_progress to authenticated;

-- Training load is derived from completed sessions.
drop policy if exists "user training load insert own" on public.user_training_load;
drop policy if exists "user training load update own" on public.user_training_load;
drop policy if exists "user training load select own" on public.user_training_load;
create policy "user training load select own"
on public.user_training_load for select to authenticated
using (user_id = auth.uid());
revoke all on table public.user_training_load from anon;
revoke insert, update, delete, truncate, references, trigger on table public.user_training_load from authenticated;
grant select on table public.user_training_load to authenticated;

-- Athletic profile scores are derived analytics, not client-authored values.
drop policy if exists "user athletic profile insert own" on public.user_athletic_profile;
drop policy if exists "user athletic profile update own" on public.user_athletic_profile;
drop policy if exists "user athletic profile select own" on public.user_athletic_profile;
create policy "user athletic profile select own"
on public.user_athletic_profile for select to authenticated
using (user_id = auth.uid());
revoke all on table public.user_athletic_profile from anon;
revoke insert, update, delete, truncate, references, trigger on table public.user_athletic_profile from authenticated;
grant select on table public.user_athletic_profile to authenticated;

-- Historical athletic scores are append-only from trusted backend code.
drop policy if exists "user athletic profile history insert own" on public.user_athletic_profile_history;
drop policy if exists "user athletic profile history select own" on public.user_athletic_profile_history;
create policy "user athletic profile history select own"
on public.user_athletic_profile_history for select to authenticated
using (user_id = auth.uid());
revoke all on table public.user_athletic_profile_history from anon;
revoke insert, update, delete, truncate, references, trigger on table public.user_athletic_profile_history from authenticated;
grant select on table public.user_athletic_profile_history to authenticated;;
