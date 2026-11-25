create or replace function public.w3_longitudinal_exposure_shadow_v1(
  p_user_id uuid,
  p_anchor_date date default current_date,
  p_period_days integer default 28
)
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  v_anchor date:=coalesce(p_anchor_date,current_date);
  v_days int:=greatest(7,least(coalesce(p_period_days,28),90));
  v_since date;
  v_patterns jsonb;
  v_exercises jsonb:='[]'::jsonb;
  v_muscles jsonb:='[]'::jsonb;
  v_session_diagnostics jsonb:='[]'::jsonb;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;
  v_since:=v_anchor-(v_days-1);
  v_patterns:=public.program_coach_pattern_exposure_shadow_v1(p_user_id,v_anchor);

  with realized as (
    select ws.id session_id,
           coalesce(ws.started_local_date,ws.generation_local_date,ws.completed_at::date,ws.created_at::date) session_date,
           wse.id session_exercise_id,wse.exercise_id,lower(coalesce(wse.block_key,'')) block_key
    from public.workout_sessions ws
    join public.workout_session_exercises wse on wse.session_id=ws.id
    where ws.user_id=p_user_id and ws.status='completed'
      and coalesce(ws.started_local_date,ws.generation_local_date,ws.completed_at::date,ws.created_at::date) between v_since and v_anchor
      and lower(coalesce(wse.block_key,'')) in ('skill','wod')
      and wse.user_execution_status='completed'
  ), exercise_rows as (
    select r.exercise_id,coalesce(nullif(e.display_name,''),e.name) exercise_name,e.movement_pattern,e.body_region,e.training_focus,
           count(*)::int completed_instances,count(distinct r.session_id)::int completed_sessions,
           min(r.session_date) first_date,max(r.session_date) last_date,
           count(*) filter(where r.block_key='skill')::int skill_instances,
           count(*) filter(where r.block_key='wod')::int wod_instances
    from realized r join public.exercises e on e.id=r.exercise_id
    group by r.exercise_id,e.display_name,e.name,e.movement_pattern,e.body_region,e.training_focus
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'exercise_id',exercise_id,'exercise_name',exercise_name,'movement_pattern',movement_pattern,
    'body_region',body_region,'training_focus',training_focus,
    'completed_instances',completed_instances,'completed_sessions',completed_sessions,
    'skill_instances',skill_instances,'wod_instances',wod_instances,
    'first_date',first_date,'last_date',last_date
  ) order by completed_sessions desc,completed_instances desc,exercise_name),'[]'::jsonb)
  into v_exercises from exercise_rows;

  with realized as (
    select ws.id session_id,wse.id session_exercise_id,wse.exercise_id
    from public.workout_sessions ws
    join public.workout_session_exercises wse on wse.session_id=ws.id
    where ws.user_id=p_user_id and ws.status='completed'
      and coalesce(ws.started_local_date,ws.generation_local_date,ws.completed_at::date,ws.created_at::date) between v_since and v_anchor
      and lower(coalesce(wse.block_key,'')) in ('skill','wod')
      and wse.user_execution_status='completed'
  ), muscle_rows as (
    select em.muscle_id,m.name muscle_name,
      count(*) filter(where lower(coalesce(em.priority,''))='primary')::int primary_completed_instances,
      count(*) filter(where lower(coalesce(em.priority,''))<>'primary')::int secondary_completed_instances,
      count(distinct r.session_id) filter(where lower(coalesce(em.priority,''))='primary')::int primary_sessions,
      count(distinct r.session_id)::int any_role_sessions
    from realized r
    join public.exercise_muscles em on em.exercise_id=r.exercise_id
    join public.muscles m on m.id=em.muscle_id
    group by em.muscle_id,m.name
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'muscle_id',muscle_id,'muscle_name',muscle_name,
    'primary_completed_instances',primary_completed_instances,
    'secondary_completed_instances',secondary_completed_instances,
    'primary_sessions',primary_sessions,'any_role_sessions',any_role_sessions
  ) order by primary_sessions desc,primary_completed_instances desc,muscle_name),'[]'::jsonb)
  into v_muscles from muscle_rows;

  with recent_sessions as (
    select ws.id,coalesce(ws.started_local_date,ws.generation_local_date,ws.completed_at::date,ws.created_at::date) session_date
    from public.workout_sessions ws
    where ws.user_id=p_user_id and ws.status='completed'
      and coalesce(ws.started_local_date,ws.generation_local_date,ws.completed_at::date,ws.created_at::date) between v_since and v_anchor
    order by session_date desc,ws.completed_at desc nulls last
    limit 8
  ), diag as (
    select rs.id,rs.session_date,
      public.c4_wod_primary_muscle_concentration_v1(coalesce((
        select jsonb_agg(jsonb_build_object('exercise_id',wse.exercise_id) order by wse.position)
        from public.workout_session_exercises wse
        where wse.session_id=rs.id and lower(coalesce(wse.block_key,''))='wod' and wse.user_execution_status='completed'
      ),'[]'::jsonb)) diagnostic
    from recent_sessions rs
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'session_id',id,'session_date',session_date,
    'wod_primary_muscle_diagnostic',diagnostic
  ) order by session_date desc),'[]'::jsonb)
  into v_session_diagnostics from diag;

  return jsonb_build_object(
    'version','w3-longitudinal-exposure-shadow-v1','mode','SHADOW','status','POLICY_REQUIRED_BEFORE_REBALANCE',
    'anchor_date',v_anchor,'period_days',v_days,'period_start',v_since,
    'pattern_exposure_existing_policy',v_patterns,
    'realized_exercise_exposure',v_exercises,
    'realized_muscle_exposure_raw_counts',v_muscles,
    'recent_session_muscle_diagnostics',v_session_diagnostics,
    'authority',jsonb_build_object('may_change_session_decision',false,'may_change_exercise_selection',false,'diagnostic_only',true),
    'semantics',jsonb_build_object(
      'realized_completed_skill_and_wod_only',true,
      'muscle_counts_are_raw_exposure_counts_not_training_load',true,
      'session_muscle_diagnostic_reuses_existing_local_diagnostic_only',true,
      'no_cross_session_muscle_threshold_added',true,
      'no_rebalance_is_activated_without_product_policy',true
    )
  );
end;
$$;
revoke all on function public.w3_longitudinal_exposure_shadow_v1(uuid,date,integer) from public,anon;
grant execute on function public.w3_longitudinal_exposure_shadow_v1(uuid,date,integer) to authenticated,service_role;

comment on function public.w3_longitudinal_exposure_shadow_v1(uuid,date,integer) is 'W3 PRG-002 diagnostic foundation. Exposes realized exercise/pattern/muscle exposure without converting raw muscle counts into training load or activating a longitudinal rebalance threshold.';
