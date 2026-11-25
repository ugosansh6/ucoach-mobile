create or replace function public.session_counts_as_training_v1(p_session_id uuid)
returns boolean
language sql
stable
set search_path to 'public','pg_temp'
as $$
  select exists(
    select 1
    from public.workout_sessions ws
    where ws.id=p_session_id
      and ws.status='completed'
      and public.d_session_execution_factor_v2(ws.id)>0
  );
$$;

comment on function public.session_counts_as_training_v1(uuid) is
'Canonical distinction between administratively closed sessions and sessions with realized training execution. A completed session with execution factor 0 does not count as training.';

do $$
declare
  v_sig regprocedure;
  v_def text;
  v_name text;
  v_names text[] := array[
    'public.program_coach_adherence_v1(uuid,date)',
    'public.program_coach_adherence_intelligence_v1(uuid,date)',
    'public.program_coach_recent_load_v1(uuid,date)',
    'public.d_goal_streak(uuid,date,integer)',
    'public.e_training_consistency_history(uuid,date,integer)',
    'public.program_coach_return_after_absence_v1(uuid,date,text,text[])',
    'public.program_coach_start_state_pre_pr_v1(uuid,date)',
    'public.c4_athlete_volume_context(uuid,text,text)',
    'public.c4_apply_mechanic_freshness_tiebreak_v1(uuid,jsonb,text)',
    'public.c4_redundancy_score_v5(uuid,jsonb,text)',
    'public.c4_tabata_variety_penalty_v2(uuid,text)',
    'public.adh006_window_summary_v1(uuid,date,date)'
  ];
begin
  foreach v_name in array v_names loop
    v_sig:=to_regprocedure(v_name);
    if v_sig is null then
      raise exception 'Required function missing: %',v_name;
    end if;
    select pg_get_functiondef(v_sig) into v_def;

    v_def:=replace(v_def,
      'ws.status=''completed''',
      'ws.status=''completed'' and public.session_counts_as_training_v1(ws.id)');

    v_def:=replace(v_def,
      'where user_id=p_user_id and status=''completed''',
      'where user_id=p_user_id and status=''completed'' and public.session_counts_as_training_v1(id)');
    v_def:=replace(v_def,
      'where user_id=p_user_id and status = ''completed''',
      'where user_id=p_user_id and status = ''completed'' and public.session_counts_as_training_v1(id)');

    execute v_def;
  end loop;
end $$;
