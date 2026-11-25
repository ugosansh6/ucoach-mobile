-- Session Intent SHADOW v1
-- Distinguishes WHAT kind of work today (session_intent) from HOW to progress
-- (progression_intent). Shadow-only: no generation authority is changed.

create or replace function public.program_coach_session_intent_classify_v1(
  p_focus text,
  p_progression_intent text,
  p_readiness text,
  p_duration_minutes integer,
  p_block_phase text,
  p_load_pressure text,
  p_maturity_stage text,
  p_quality_priorities jsonb default '[]'::jsonb,
  p_movement_pattern_priorities jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
immutable
set search_path to 'public'
as $function$
declare
  v_focus text:=coalesce(nullif(btrim(p_focus),''),'General Fitness');
  v_progress text:=upper(coalesce(nullif(btrim(p_progression_intent),''),'MAINTAIN'));
  v_readiness text:=lower(coalesce(nullif(btrim(p_readiness),''),'normal'));
  v_duration int:=greatest(20,least(coalesce(p_duration_minutes,45),120));
  v_phase text:=upper(coalesce(nullif(btrim(p_block_phase),''),'BUILD'));
  v_load text:=upper(coalesce(nullif(btrim(p_load_pressure),''),'LOW'));
  v_maturity text:=upper(coalesce(nullif(btrim(p_maturity_stage),''),'COLD_START'));
  v_intent text:='CLASSIC';
  v_current_proxy text:='CLASSIC';
  v_confidence numeric:=0.60;
  v_reason text:='GENERAL_BALANCED_SESSION';
  v_pattern_targets jsonb:='[]'::jsonb;
  v_quality_targets jsonb:='[]'::jsonb;
  v_has_pattern_priority boolean:=false;
begin
  select coalesce(jsonb_agg(x order by coalesce(nullif(x->>'priority_score','')::numeric,0) desc),'[]'::jsonb)
  into v_pattern_targets
  from (
    select x
    from jsonb_array_elements(coalesce(p_movement_pattern_priorities,'[]'::jsonb)) x
    where upper(coalesce(x->>'role','')) in ('PRIORITY','DEVELOP','RECALIBRATE')
       or upper(coalesce(x->>'directive','')) in ('DEVELOPMENT_PRIORITY','PROGRESS','RECALIBRATE')
    limit 3
  ) q;
  v_has_pattern_priority:=jsonb_array_length(v_pattern_targets)>0;

  select coalesce(jsonb_agg(x order by coalesce(nullif(x->>'weight','')::numeric,0) desc),'[]'::jsonb)
  into v_quality_targets
  from (
    select x
    from jsonb_array_elements(coalesce(p_quality_priorities,'[]'::jsonb)) x
    where upper(coalesce(x->>'role','')) in ('PRIORITY','DEVELOP')
    limit 3
  ) q;

  -- Proxy of today's current authoritative architecture, only for SHADOW comparison.
  v_current_proxy:=case
    when v_readiness in ('low','faible') or v_progress in ('DELOAD','CONSOLIDATE') then 'CONSOLIDATE'
    when v_focus in ('Strength','Muscle Gain') then 'STRENGTH_QUALITY'
    when v_focus in ('Conditioning','Fat Loss') then 'CONDITIONING'
    else 'CLASSIC'
  end;

  -- Session Intent proposal. Safety/recovery signals dominate program ambition.
  if v_readiness in ('low','faible') then
    v_intent:='CONSOLIDATE';
    v_confidence:=0.98;
    v_reason:='LOW_READINESS_CONSOLIDATION';
  elsif v_progress='DELOAD' then
    v_intent:='CONSOLIDATE';
    v_confidence:=0.96;
    v_reason:='DELOAD_REQUIRES_CONSOLIDATION';
  elsif v_load='HIGH' then
    v_intent:='CONSOLIDATE';
    v_confidence:=0.92;
    v_reason:='HIGH_RECENT_LOAD_CONSOLIDATION';
  elsif v_phase='CONSOLIDATE' or v_progress='CONSOLIDATE' then
    v_intent:='CONSOLIDATE';
    v_confidence:=0.86;
    v_reason:='PROGRAM_OR_SESSION_CONSOLIDATION';
  elsif v_phase='CALIBRATE' or (v_maturity='COLD_START' and v_progress='RECALIBRATE') then
    -- Recalibration is HOW we learn about the athlete, not automatically a Skill session.
    v_intent:='CLASSIC';
    v_confidence:=0.82;
    v_reason:='BROAD_CALIBRATION_WITHOUT_FALSE_SKILL_BIAS';
  elsif v_duration>=35
        and v_progress in ('PROGRESS','RECALIBRATE')
        and v_has_pattern_priority then
    v_intent:='SKILL_DEVELOPMENT';
    v_confidence:=0.78;
    v_reason:='EVIDENCE_BACKED_PATTERN_DEVELOPMENT';
  elsif v_focus='Strength' then
    v_intent:='STRENGTH_QUALITY';
    v_confidence:=0.88;
    v_reason:='PRIMARY_STRENGTH_QUALITY';
  elsif v_focus='Muscle Gain' then
    v_intent:='STRENGTH_QUALITY';
    v_confidence:=0.72;
    v_reason:='MUSCLE_GAIN_STRENGTH_QUALITY_PROXY';
  elsif v_focus in ('Conditioning','Fat Loss') then
    v_intent:='CONDITIONING';
    v_confidence:=0.88;
    v_reason:='PRIMARY_CONDITIONING_QUALITY';
  else
    v_intent:='CLASSIC';
    v_confidence:=0.64;
    v_reason:='BALANCED_GENERAL_FITNESS';
  end if;

  return jsonb_build_object(
    'version','session-intent-classifier-v1',
    'proposed_session_intent',v_intent,
    'current_architecture_proxy',v_current_proxy,
    'would_differ_from_current_proxy',v_intent<>v_current_proxy,
    'confidence',round(v_confidence,2),
    'confidence_label',case when v_confidence>=0.85 then 'HIGH' when v_confidence>=0.70 then 'MEDIUM' else 'LOW' end,
    'reason',v_reason,
    'inputs',jsonb_build_object(
      'focus',v_focus,
      'progression_intent',v_progress,
      'readiness',v_readiness,
      'duration_minutes',v_duration,
      'block_phase',v_phase,
      'recent_load_pressure',v_load,
      'athlete_maturity',v_maturity
    ),
    'targets',jsonb_build_object(
      'quality_priorities',v_quality_targets,
      'movement_pattern_priorities',v_pattern_targets
    ),
    'semantics',jsonb_build_object(
      'progression_intent','HOW_TO_PROGRESS',
      'session_intent','WHAT_KIND_OF_WORK_TODAY',
      'recalibrate_does_not_imply_skill',true,
      'safety_and_readiness_override_program_ambition',true
    )
  );
end;
$function$;

create or replace function public.program_coach_session_intent_shadow_v1(
  p_user_id uuid,
  p_anchor_date date,
  p_session_context jsonb,
  p_duration_minutes integer,
  p_readiness text
)
returns jsonb
language plpgsql
stable
set search_path to 'public'
as $function$
declare
  v_anchor date:=coalesce(p_anchor_date,current_date);
  v_strategy jsonb:='{}'::jsonb;
  v_start jsonb:='{}'::jsonb;
  v_classification jsonb:='{}'::jsonb;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then
    raise exception 'Forbidden user';
  end if;

  if coalesce(p_session_context->>'status','')<>'READY' then
    return jsonb_build_object(
      'version','session-intent-shadow-v1',
      'mode','SHADOW',
      'status','NOT_ELIGIBLE',
      'proposed_session_intent',null,
      'reason','SESSION_CONTEXT_NOT_READY',
      'authority',jsonb_build_object(
        'shadow_only',true,
        'may_change_session_decision',false,
        'session_coach_remains_authoritative',true
      )
    );
  end if;

  v_strategy:=public.program_coach_week_strategy_v1(p_user_id,public.d_week_start(v_anchor));
  v_start:=public.program_coach_start_state_v1(p_user_id,v_anchor);

  v_classification:=public.program_coach_session_intent_classify_v1(
    p_session_context->>'focus',
    p_session_context->>'progression_intent',
    p_readiness,
    p_duration_minutes,
    v_strategy#>>'{block_phase,phase}',
    v_strategy#>>'{recent_load,load_pressure}',
    v_start->>'maturity_stage',
    coalesce(v_strategy->'quality_priorities','[]'::jsonb),
    coalesce(v_strategy->'movement_pattern_priorities','[]'::jsonb)
  );

  return v_classification||jsonb_build_object(
    'version','session-intent-shadow-v1',
    'mode','SHADOW',
    'status','PROPOSED',
    'anchor_date',v_anchor,
    'current_authoritative_decision',jsonb_build_object(
      'focus',p_session_context->>'focus',
      'progression_intent',p_session_context->>'progression_intent',
      'target_region',p_session_context->>'target_region',
      'reason_codes',coalesce(p_session_context->'reason_codes','[]'::jsonb)
    ),
    'program_context',jsonb_build_object(
      'block_phase',v_strategy->'block_phase',
      'recent_load',v_strategy->'recent_load',
      'athlete_maturity',v_start->>'maturity_stage',
      'program_kind',v_strategy->>'program_kind'
    ),
    'authority',jsonb_build_object(
      'shadow_only',true,
      'may_change_session_decision',false,
      'may_change_focus',false,
      'may_change_progression_intent',false,
      'may_change_block_budget',false,
      'may_change_exercise_selection',false,
      'session_coach_remains_authoritative',true
    )
  );
end;
$function$;

revoke all on function public.program_coach_session_intent_classify_v1(text,text,text,integer,text,text,text,jsonb,jsonb) from public, anon;
grant execute on function public.program_coach_session_intent_classify_v1(text,text,text,integer,text,text,text,jsonb,jsonb) to authenticated;
revoke all on function public.program_coach_session_intent_shadow_v1(uuid,date,jsonb,integer,text) from public, anon;
grant execute on function public.program_coach_session_intent_shadow_v1(uuid,date,jsonb,integer,text) to authenticated;

-- Bridge into session context as a non-blocking SHADOW observation only.
do $bridge$
declare
  v_def text;
  v_old text;
  v_new text;
begin
  select pg_get_functiondef(p.oid)
  into v_def
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname='d_resolve_session_context_v6'
    and pg_get_function_identity_arguments(p.oid)='p_user_id uuid, p_anchor_date date, p_duration_minutes integer, p_readiness text, p_focus_override text, p_target_region_override text, p_progression_intent_override text, p_available_equipment text[], p_zone_terms text[], p_force_recalculate_started boolean';

  if v_def is null then
    raise exception 'Session Intent SHADOW guard: d_resolve_session_context_v6 exact signature not found';
  end if;

  v_old := $old$v_directive jsonb:='{}'::jsonb;
  v_program_error text:=null;$old$;
  v_new := $new$v_directive jsonb:='{}'::jsonb;
  v_session_intent jsonb:='{}'::jsonb;
  v_program_error text:=null;
  v_session_intent_error text:=null;$new$;
  if position(v_old in v_def)=0 then
    raise exception 'Session Intent SHADOW guard: declaration fragment changed';
  end if;
  v_def:=replace(v_def,v_old,v_new);

  v_old := $old$  return v_base||jsonb_build_object(
    'program_coach_shadow',v_program,$old$;
  v_new := $new$  begin
    v_session_intent:=public.program_coach_session_intent_shadow_v1(
      p_user_id,coalesce(p_anchor_date,current_date),v_base,p_duration_minutes,p_readiness
    );
  exception when others then
    v_session_intent_error:=sqlerrm;
    v_session_intent:=jsonb_build_object(
      'version','session-intent-shadow-v1','mode','SHADOW','status','UNAVAILABLE',
      'proposed_session_intent',null,'reason','SHADOW_EVALUATION_ERROR',
      'authority',jsonb_build_object('shadow_only',true,'may_change_session_decision',false)
    );
  end;

  return v_base||jsonb_build_object(
    'program_coach_shadow',v_program,$new$;
  if position(v_old in v_def)=0 then
    raise exception 'Session Intent SHADOW guard: return fragment changed';
  end if;
  v_def:=replace(v_def,v_old,v_new);

  v_old := $old$'program_coach_shadow_error',v_program_error$old$;
  v_new := $new$'program_coach_shadow_error',v_program_error,
    'session_intent_shadow',v_session_intent,
    'session_intent_shadow_error',v_session_intent_error$new$;
  if position(v_old in v_def)=0 then
    raise exception 'Session Intent SHADOW guard: program coach return tail changed';
  end if;
  v_def:=replace(v_def,v_old,v_new);

  execute v_def;
end;
$bridge$;
