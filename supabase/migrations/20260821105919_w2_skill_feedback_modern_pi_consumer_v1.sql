create or replace function public.w2_skill_progression_feedback_allows_v1(p_user_id uuid,p_exercise_id text)
returns boolean
language sql
stable
set search_path=public
as $$
with latest_feedback as (
  select feedback,created_at
  from public.user_skill_technical_feedback
  where user_id=p_user_id and exercise_id=p_exercise_id
  order by created_at desc
  limit 1
), observed as (
  select last_observed_at
  from public.user_exercise_coach_state
  where user_id=p_user_id and exercise_id=p_exercise_id
  limit 1
)
select case
  when not exists(select 1 from latest_feedback) then true
  when (select feedback from latest_feedback)='PROPRE' then true
  when coalesce((select created_at from latest_feedback),'epoch'::timestamptz)
       < coalesce((select last_observed_at from observed),'epoch'::timestamptz) then true
  else false
end;
$$;
revoke all on function public.w2_skill_progression_feedback_allows_v1(uuid,text) from public,anon,authenticated;
grant execute on function public.w2_skill_progression_feedback_allows_v1(uuid,text) to service_role;

create or replace function public.w2_session_question_need_v1(p_session_id uuid,p_question_key text)
returns jsonb language plpgsql stable security definer set search_path=public
as $$
declare
  v_user uuid:=auth.uid();
  v_cfg public.observation_question_catalog%rowtype;
  v_wse record;
  v_pi_directive text;
  v_should boolean:=false;
  v_reason text:='NOT_APPLICABLE';
  v_anchor date;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  select coalesce(started_local_date,generation_local_date,completed_at::date,created_at::date)
  into v_anchor
  from public.workout_sessions
  where id=p_session_id and user_id=v_user and status='completed';
  if not found then return jsonb_build_object('should_ask',false,'reason','SESSION_NOT_COMPLETED'); end if;

  select * into v_cfg from public.observation_question_catalog where question_key=upper(p_question_key);
  if not found or not v_cfg.enabled then return jsonb_build_object('should_ask',false,'reason','QUESTION_DISABLED'); end if;

  if v_cfg.question_key='SKILL_TECHNICAL_QUALITY' then
    select w.id,w.exercise_id,w.prescription_json,w.user_execution_status into v_wse
    from public.workout_session_exercises w
    where w.session_id=p_session_id and lower(w.block_key)='skill' and w.user_execution_status='completed'
      and upper(coalesce(w.prescription_json->>'skill_objective_type',''))<>'TEST'
      and nullif(w.prescription_json->>'skill_path_key','') is not null
    order by w.position limit 1;

    if not found then
      v_reason='NO_ELIGIBLE_COMPLETED_SKILL';
    elsif exists(select 1 from public.user_skill_technical_feedback f where f.session_exercise_id=v_wse.id) then
      v_reason='ALREADY_ANSWERED';
    else
      select directive into v_pi_directive
      from public.pi_exercise_directives(v_user,coalesce(v_anchor,current_date),90)
      where exercise_id=v_wse.exercise_id
      limit 1;

      if upper(coalesce(v_pi_directive,''))='PROGRESS' then
        v_should=true;
        v_reason='MODERN_PI_SKILL_PROGRESSION_DECISION_PENDING';
      else
        v_reason='NO_PROGRESSION_DECISION_PENDING';
      end if;
    end if;

    return jsonb_build_object(
      'should_ask',v_should,
      'reason',v_reason,
      'question_key',v_cfg.question_key,
      'question_text',v_cfg.question_text,
      'options',v_cfg.options_json,
      'consumer_key',v_cfg.consumer_key,
      'consumer_source','pi_exercise_directives + w2_skill_progression_feedback_allows_v1',
      'session_exercise_id',v_wse.id,
      'exercise_id',v_wse.exercise_id,
      'skill_path_key',v_wse.prescription_json->>'skill_path_key',
      'pi_directive',v_pi_directive
    );
  end if;

  return jsonb_build_object('should_ask',false,'reason','NO_DYNAMIC_GATE_REQUIRED','question_key',v_cfg.question_key,'consumer_key',v_cfg.consumer_key);
end; $$;
revoke all on function public.w2_session_question_need_v1(uuid,text) from public,anon;
grant execute on function public.w2_session_question_need_v1(uuid,text) to authenticated,service_role;

DO $do$
declare
  v_def text;
  v_old text := $old$if coalesce(v_anchor.recommendation,'')='PROGRESS_RECOMMENDED'
       and coalesce(v_anchor.valid_evidence_count,0)>=2$old$;
  v_new text := $new$if (
         coalesce(v_anchor.recommendation,'')='PROGRESS_RECOMMENDED'
         or exists(
           select 1
           from public.pi_exercise_directives(p_user_id,public.ugerod_effective_session_anchor_date_v1(),90) pd
           where pd.exercise_id=v_anchor.exercise_id and pd.directive='PROGRESS'
         )
       )
       and coalesce(v_anchor.valid_evidence_count,0)>=2
       and public.w2_skill_progression_feedback_allows_v1(p_user_id,v_anchor.exercise_id)$new$;
begin
  select pg_get_functiondef('public.c4_apply_skill_path_v1(uuid,jsonb,text[],jsonb,text,integer,text,text)'::regprocedure) into v_def;
  if position(v_old in v_def)=0 then
    raise exception 'Expected c4_apply_skill_path_v1 progression guard not found';
  end if;
  execute replace(v_def,v_old,v_new);
end
$do$;

comment on function public.w2_skill_progression_feedback_allows_v1(uuid,text) is 'W2 qualitative Skill gate. Feedback can hold an already-supported progression but never creates a progression signal.';
