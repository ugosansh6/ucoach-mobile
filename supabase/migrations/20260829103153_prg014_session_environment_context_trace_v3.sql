alter function public.program_coach_explainability_trace_v1(uuid,date,text,text[],uuid)
rename to program_coach_explainability_trace_v1_pre_session_environment;

revoke all on function public.program_coach_explainability_trace_v1_pre_session_environment(uuid,date,text,text[],uuid) from public;
revoke all on function public.program_coach_explainability_trace_v1_pre_session_environment(uuid,date,text,text[],uuid) from anon;
revoke all on function public.program_coach_explainability_trace_v1_pre_session_environment(uuid,date,text,text[],uuid) from authenticated;

create or replace function public.program_coach_explainability_trace_v1(
  p_user_id uuid,
  p_anchor_date date default current_date,
  p_readiness text default null,
  p_pain_zones text[] default null,
  p_session_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_base jsonb;
  v_session public.workout_sessions%rowtype;
  v_env_node jsonb;
  v_chain jsonb;
  v_session_trace jsonb;
  v_effective_env text;
  v_reason_codes jsonb := '[]'::jsonb;
begin
  if p_user_id is null then raise exception 'User required'; end if;
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;

  v_base := public.program_coach_explainability_trace_v1_pre_session_environment(
    p_user_id,p_anchor_date,p_readiness,p_pain_zones,p_session_id
  );

  if p_session_id is null then
    return jsonb_set(v_base,'{version}','"program-coach-explainability-trace-v1.2-session-environment"'::jsonb,true);
  end if;

  select * into v_session from public.workout_sessions where id=p_session_id;
  if not found then raise exception 'Session not found'; end if;
  if v_session.user_id<>p_user_id then raise exception 'Session does not belong to user'; end if;

  v_effective_env := coalesce(nullif(v_session.actual_environment_code,''),nullif(v_session.planned_environment_code,''));
  if nullif(v_session.actual_environment_code,'') is not null and v_session.actual_environment_code<>'UNKNOWN' then
    v_reason_codes := jsonb_build_array('ACTUAL_ENVIRONMENT_RECORDED_AT_COMPLETION');
  elsif nullif(v_session.planned_environment_code,'') is not null and v_session.planned_environment_code<>'UNKNOWN' then
    v_reason_codes := jsonb_build_array('PLANNED_ENVIRONMENT_CONTEXT');
  end if;

  v_env_node := jsonb_build_object(
    'step','SESSION_ENVIRONMENT_CONTEXT',
    'status',case
      when v_effective_env is null or v_effective_env='UNKNOWN' then 'LEGACY_OR_UNDECLARED_CONTEXT'
      else 'TRACEABLE_CONTEXT_NOT_RECOMMENDATION'
    end,
    'decision',case when v_effective_env='UNKNOWN' then null else v_effective_env end,
    'reason_codes',v_reason_codes,
    'user_text_fr',case
      when nullif(v_session.actual_environment_code,'') is not null and v_session.actual_environment_code<>'UNKNOWN'
        then format('Séance réalisée en %s et enregistrée au moment de la completion. Ce contexte n’est pas présenté comme une recommandation du Coach.',v_session.actual_environment_code)
      when nullif(v_session.planned_environment_code,'') is not null and v_session.planned_environment_code<>'UNKNOWN'
        then format('Séance prévue en %s selon le contexte déclaré pour cette séance. Ce contexte n’est pas présenté comme une recommandation du Coach.',v_session.planned_environment_code)
      else 'L’environnement exact de cette séance legacy n’est pas suffisamment traçable pour en revendiquer la cause.'
    end,
    'evidence_ref','workout_sessions.planned_environment_* / actual_environment_*',
    'planned_environment_code',v_session.planned_environment_code,
    'planned_environment_source',v_session.planned_environment_source,
    'actual_environment_code',v_session.actual_environment_code,
    'actual_environment_source',v_session.actual_environment_source,
    'is_coach_recommendation',false
  );

  v_chain := coalesce(v_base->'decision_chain','[]'::jsonb) || jsonb_build_array(v_env_node);
  v_session_trace := coalesce(v_base->'session_trace','{}'::jsonb) || jsonb_build_object(
    'planned_environment_source',v_session.planned_environment_source,
    'actual_environment_source',v_session.actual_environment_source,
    'environment_context_is_not_retroactively_claimed_as_coach_recommendation',true
  );

  v_base := jsonb_set(v_base,'{decision_chain}',v_chain,true);
  v_base := jsonb_set(v_base,'{session_trace}',v_session_trace,true);
  v_base := jsonb_set(v_base,'{version}','"program-coach-explainability-trace-v1.2-session-environment"'::jsonb,true);
  return v_base;
end;
$$;

revoke all on function public.program_coach_explainability_trace_v1(uuid,date,text,text[],uuid) from public;
revoke all on function public.program_coach_explainability_trace_v1(uuid,date,text,text[],uuid) from anon;
revoke all on function public.program_coach_explainability_trace_v1(uuid,date,text,text[],uuid) from authenticated;