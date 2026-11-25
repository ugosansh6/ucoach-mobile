create or replace function public.program_coach_replan_after_completed_session_v1(
  p_session_id uuid,
  p_anchor_date date default current_date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_session public.workout_sessions%rowtype;
  v_anchor date := coalesce(p_anchor_date,current_date);
  v_has_realized boolean := false;
  v_source text := 'internal';
  v_execution_factor numeric := null;
  v_realized_patterns jsonb := '[]'::jsonb;
  v_realized_focus jsonb := '[]'::jsonb;
  v_projection jsonb := null;
  v_priority jsonb := null;
begin
  select * into v_session from public.workout_sessions where id=p_session_id;
  if not found then raise exception 'Session not found'; end if;
  if auth.uid() is not null and auth.uid()<>v_session.user_id then raise exception 'Forbidden user'; end if;

  if v_session.status<>'completed' then
    return jsonb_build_object(
      'version','program-coach-replan-after-completed-session-v1',
      'mode','SHADOW_READ_ONLY','status','NOT_APPLICABLE_SESSION_NOT_COMPLETED',
      'session_id',p_session_id,'session_status',v_session.status,'replan_triggered',false,
      'reason_code','ONLY_COMPLETED_FINALIZED_ACTUALS_CAN_REPLAN',
      'principles',jsonb_build_object(
        'generated_or_claimed_is_not_actual',true,'abandoned_is_not_actual',true,
        'planned_projection_is_not_stimulus',true,'no_plan_mutation',true));
  end if;

  select exists(
    select 1 from public.session_stimulus_ledger l
    where l.session_id=p_session_id and l.metadata_json->>'ledger_role'='realized'
  ) into v_has_realized;

  if not v_has_realized then
    return jsonb_build_object(
      'version','program-coach-replan-after-completed-session-v1',
      'mode','SHADOW_READ_ONLY','status','WAITING_FOR_FINALIZED_ACTUALS',
      'session_id',p_session_id,'session_status',v_session.status,'replan_triggered',false,
      'reason_code','REALIZED_STIMULUS_LEDGER_REQUIRED',
      'principles',jsonb_build_object(
        'completion_row_alone_is_not_longitudinal_authority',true,
        'finalized_realized_ledger_is_required',true,'no_plan_mutation',true));
  end if;

  select coalesce(max(nullif(l.source_kind,'')),'internal')
  into v_source from public.session_stimulus_ledger l where l.session_id=p_session_id;

  v_execution_factor := public.d_session_execution_factor_v2(p_session_id);

  select coalesce(jsonb_agg(jsonb_build_object(
    'pattern',x.stimulus_key,'unit',x.unit,'realized_value',round(x.realized_value,3)
  ) order by x.realized_value desc,x.stimulus_key),'[]'::jsonb)
  into v_realized_patterns
  from (
    select l.stimulus_key,l.unit,sum(coalesce(l.realized_value,0)) realized_value
    from public.session_stimulus_ledger l
    where l.session_id=p_session_id and l.stimulus_type='pattern'
      and l.metadata_json->>'ledger_role'='realized' and coalesce(l.realized_value,0)>0
    group by l.stimulus_key,l.unit
  ) x;

  select coalesce(jsonb_agg(jsonb_build_object(
    'quality',x.stimulus_key,'unit',x.unit,'realized_value',round(x.realized_value,3)
  ) order by x.realized_value desc,x.stimulus_key),'[]'::jsonb)
  into v_realized_focus
  from (
    select l.stimulus_key,l.unit,sum(coalesce(l.realized_value,0)) realized_value
    from public.session_stimulus_ledger l
    where l.session_id=p_session_id and l.stimulus_type='focus'
      and l.metadata_json->>'ledger_role'='realized' and coalesce(l.realized_value,0)>0
    group by l.stimulus_key,l.unit
  ) x;

  v_priority := public.program_coach_cycle_priority_resolver_v1(v_session.user_id,v_anchor);
  v_projection := public.program_coach_ideal_week_projection_v1(v_session.user_id,v_anchor,null,null);

  return jsonb_build_object(
    'version','program-coach-replan-after-completed-session-v1','mode','SHADOW_READ_ONLY',
    'status','REPLAN_PROJECTION_READY','session_id',p_session_id,'user_id',v_session.user_id,
    'anchor_date',v_anchor,'completed_at',v_session.completed_at,'session_source',v_source,
    'execution_factor',case when v_execution_factor is null then null else round(v_execution_factor,4) end,
    'realized_patterns',v_realized_patterns,'realized_qualities',v_realized_focus,
    'cycle_priority_after_actuals',v_priority,'projection_after_actuals',v_projection,
    'replan_triggered',true,'reason_code','COMPLETED_FINALIZED_ACTUALS_CHANGED_WEEK_CONTEXT',
    'principles',jsonb_build_object(
      'completed_finalized_actuals_are_authority',true,'partial_execution_is_preserved',true,
      'external_completed_session_has_same_planning_authority',true,
      'generated_claimed_or_draft_does_not_replan',true,'missed_session_creates_no_debt',true,
      'projection_is_recomputed_not_shifted',true,'no_existing_plan_mutation',true,'no_generation_authority',true),
    'authority',jsonb_build_object(
      'shadow_only',true,'may_mutate_user_training_plan_items',false,
      'may_generate_or_replace_sessions',false,'realized_ledgers_remain_longitudinal_authority',true));
end;
$$;

revoke all on function public.program_coach_replan_after_completed_session_v1(uuid,date) from public;
revoke all on function public.program_coach_replan_after_completed_session_v1(uuid,date) from anon;
revoke all on function public.program_coach_replan_after_completed_session_v1(uuid,date) from authenticated;

create or replace function public.d_finalize_weekly_session(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_base jsonb;
  v_user_id uuid;
  v_directives jsonb:=null;
  v_directives_error text:=null;
  v_program jsonb:=null;
  v_program_error text:=null;
  v_replan jsonb:=null;
  v_replan_error text:=null;
begin
  v_base:=public.d_finalize_weekly_session_pre_m89(p_session_id);
  select user_id into v_user_id from public.workout_sessions where id=p_session_id;

  if v_user_id is not null then
    begin
      v_directives:=public.pi_refresh_coaching_directives(v_user_id,current_date,90);
    exception when others then v_directives_error:=sqlerrm; end;

    begin
      v_program:=public.program_coach_refresh_week_state_v1(v_user_id,current_date);
    exception when others then v_program_error:=sqlerrm; end;

    begin
      v_replan:=public.program_coach_replan_after_completed_session_v1(p_session_id,current_date);
    exception when others then v_replan_error:=sqlerrm; end;
  end if;

  return v_base||jsonb_build_object(
    'version','d1-finalize-weekly-session-prg012-shadow-v1',
    'pi_refresh_after_weekly_finalize',v_directives_error is null,'pi_refresh_error',v_directives_error,
    'pi_data_maturity',v_directives->'data_maturity',
    'program_coach_shadow_refresh',v_program_error is null,'program_coach_shadow_error',v_program_error,
    'program_coach_shadow',coalesce(v_program,'{}'::jsonb),
    'program_coach_replan_shadow',v_replan_error is null,'program_coach_replan_error',v_replan_error,
    'program_coach_replan',coalesce(v_replan,'{}'::jsonb));
end;
$$;

revoke all on function public.d_finalize_weekly_session(uuid) from public;
revoke all on function public.d_finalize_weekly_session(uuid) from anon;
