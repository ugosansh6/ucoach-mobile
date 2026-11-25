create or replace function public.w3_active_skill_objective_v1(
  p_user_id uuid,
  p_anchor_date date default current_date
)
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  v_anchor date:=coalesce(p_anchor_date,current_date);
  v_session record;
  v_current record;
  v_dir record;
  v_feedback_allows boolean:=true;
  v_next_step int;
  v_next_count int:=0;
  v_next jsonb:=null;
  v_state text;
  v_next_lim jsonb:=null;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;

  select ws.id,ws.status,ws.planning_context_json,
         ws.planning_context_json#>>'{architecture,skill_path,path_key}' path_key,
         ws.planning_context_json#>>'{architecture,skill_path,exercise_id}' exercise_id,
         ws.planning_context_json#>>'{architecture,skill_path,selection_source}' selection_source,
         ws.planning_context_json#>'{architecture,skill_path,mini_cycle}' mini_cycle
  into v_session
  from public.workout_sessions ws
  where ws.user_id=p_user_id
    and ws.status in ('generated','in_progress','completed')
    and coalesce(ws.generation_local_date,ws.generated_at::date,ws.created_at::date)<=v_anchor
    and coalesce((ws.planning_context_json#>>'{architecture,skill_path,applied}')::boolean,false)
    and nullif(ws.planning_context_json#>>'{architecture,skill_path,path_key}','') is not null
    and nullif(ws.planning_context_json#>>'{architecture,skill_path,exercise_id}','') is not null
  order by case when ws.status in ('generated','in_progress') then 0 else 1 end,
           coalesce(ws.generated_at,ws.created_at) desc
  limit 1;

  if not found then
    return jsonb_build_object(
      'version','w3-active-skill-objective-v1','status','NO_ACTIVE_SKILL_OBJECTIVE','anchor_date',v_anchor,
      'semantics',jsonb_build_object('no_path_is_inferred_without_explicit_planning_trace',true)
    );
  end if;

  select sp.path_key,sp.display_name path_name,sp.body_region,
         m.exercise_id,m.step_order,m.member_role,
         coalesce(nullif(e.display_name,''),e.name) exercise_name
  into v_current
  from public.skill_paths sp
  join public.skill_path_members m on m.path_key=sp.path_key and m.active
  join public.exercises e on e.id=m.exercise_id
  where sp.active and sp.path_key=v_session.path_key and m.exercise_id=v_session.exercise_id
  limit 1;

  if not found then
    return jsonb_build_object(
      'version','w3-active-skill-objective-v1','status','MODEL_INCOMPLETE','anchor_date',v_anchor,
      'reason','PLANNING_SKILL_TARGET_NOT_IN_ACTIVE_CURATED_PATH','session_id',v_session.id
    );
  end if;

  select * into v_dir
  from public.pi_exercise_directives(p_user_id,v_anchor,90)
  where exercise_id=v_current.exercise_id
  limit 1;

  v_feedback_allows:=public.w2_skill_progression_feedback_allows_v1(p_user_id,v_current.exercise_id);

  if v_dir.directive='PROGRESS' and v_feedback_allows and v_current.member_role<>'alternate' then
    select min(m.step_order)::int into v_next_step
    from public.skill_path_members m
    where m.path_key=v_current.path_key and m.active and m.step_order>v_current.step_order
      and (
        (v_current.member_role in ('entry','main') and m.member_role='main')
        or (v_current.member_role not in ('entry','main','alternate') and m.member_role=v_current.member_role)
      );

    if v_next_step is not null then
      select count(*)::int into v_next_count
      from public.skill_path_members m
      where m.path_key=v_current.path_key and m.active and m.step_order=v_next_step
        and (
          (v_current.member_role in ('entry','main') and m.member_role='main')
          or (v_current.member_role not in ('entry','main','alternate') and m.member_role=v_current.member_role)
        );

      if v_next_count=1 then
        select jsonb_build_object(
          'exercise_id',m.exercise_id,
          'exercise_name',coalesce(nullif(e.display_name,''),e.name),
          'step_order',m.step_order,
          'member_role',m.member_role
        )
        into v_next
        from public.skill_path_members m
        join public.exercises e on e.id=m.exercise_id
        where m.path_key=v_current.path_key and m.active and m.step_order=v_next_step
          and (
            (v_current.member_role in ('entry','main') and m.member_role='main')
            or (v_current.member_role not in ('entry','main','alternate') and m.member_role=v_current.member_role)
          )
        limit 1;
        v_next_lim:=public.w3_limiting_factor_snapshot_v1(p_user_id,v_current.path_key,v_next->>'exercise_id',v_anchor);
      end if;
    end if;
  end if;

  v_state:=case
    when v_dir.directive is null then 'CALIBRATION_NEEDED'
    when v_dir.directive in ('LEARN','RECALIBRATE') then 'CALIBRATION_NEEDED'
    when v_dir.directive in ('DEVELOP','CONSOLIDATE') then 'DEVELOPMENT_NEEDED'
    when v_dir.directive='PROGRESS' and not v_feedback_allows then 'HOLD_TECHNIQUE'
    when v_dir.directive='PROGRESS' and v_next_count=1 and coalesce(v_next_lim->>'status','') in ('PREREQUISITES_SUPPORTED','ENTRY_NO_PREREQUISITE_REQUIRED') then 'PROGRESSION_CANDIDATE'
    when v_dir.directive='PROGRESS' and v_next_count=1 and coalesce(v_next_lim->>'status','')='CALIBRATION_NEEDED' then 'NEXT_STEP_CALIBRATION_NEEDED'
    when v_dir.directive='PROGRESS' and v_next_count=1 and coalesce(v_next_lim->>'status','') in ('MODEL_INCOMPLETE','BRANCH_RELATION_UNRESOLVED') then 'PREREQUISITE_MODEL_INCOMPLETE'
    when v_dir.directive='PROGRESS' and v_next_step is not null and v_next_count<>1 then 'BRANCH_SELECTION_REQUIRED'
    when v_dir.directive='PROGRESS' then 'PATH_END_OR_BRANCH_REQUIRED'
    else 'MAINTAIN_CURRENT_STEP'
  end;

  return jsonb_build_object(
    'version','w3-active-skill-objective-v1','status',v_state,'anchor_date',v_anchor,
    'source_session',jsonb_build_object('session_id',v_session.id,'session_status',v_session.status,'selection_source',v_session.selection_source,'mini_cycle',v_session.mini_cycle),
    'path',jsonb_build_object('path_key',v_current.path_key,'path_name',v_current.path_name,'body_region',v_current.body_region),
    'current_target',jsonb_build_object(
      'exercise_id',v_current.exercise_id,'exercise_name',v_current.exercise_name,'step_order',v_current.step_order,'member_role',v_current.member_role,
      'pi_directive',v_dir.directive,'pi_priority_score',v_dir.priority_score,'pi_confidence',v_dir.confidence,'pi_evidence_count',v_dir.evidence_count,
      'technical_feedback_allows_progression',v_feedback_allows
    ),
    'next_target',v_next,
    'next_target_prerequisite_snapshot',v_next_lim,
    'semantics',jsonb_build_object(
      'active_path_comes_from_existing_session_planning_trace',true,
      'progression_uses_existing_pi_directive',true,
      'w2_technical_feedback_gate_is_preserved',true,
      'ambiguous_branch_is_not_auto_selected',true,
      'no_new_sports_thresholds_added',true
    )
  );
end;
$$;

revoke all on function public.w3_active_skill_objective_v1(uuid,date) from public,anon;
grant execute on function public.w3_active_skill_objective_v1(uuid,date) to authenticated,service_role;
