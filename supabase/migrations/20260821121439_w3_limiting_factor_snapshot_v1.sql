create or replace function public.w3_limiting_factor_snapshot_v1(
  p_user_id uuid,
  p_path_key text,
  p_target_exercise_id text,
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
  v_target record;
  v_prerequisites jsonb:='[]'::jsonb;
  v_factors jsonb:='[]'::jsonb;
  v_calibration jsonb:='[]'::jsonb;
  v_edge_count int:=0;
  v_model_incomplete boolean:=false;
  v_factor_count int:=0;
  v_calibration_count int:=0;
  v_status text;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then
    raise exception 'Forbidden user';
  end if;

  select
    sp.path_key,
    sp.display_name path_name,
    sp.body_region path_region,
    m.exercise_id,
    m.step_order,
    m.member_role,
    coalesce(nullif(e.display_name,''),e.name) exercise_name
  into v_target
  from public.skill_paths sp
  join public.skill_path_members m on m.path_key=sp.path_key and m.active
  join public.exercises e on e.id=m.exercise_id
  where sp.active
    and sp.path_key=p_path_key
    and m.exercise_id=p_target_exercise_id
  limit 1;

  if not found then
    raise exception 'Target exercise is not an active member of this Skill path';
  end if;

  select count(*)::int into v_edge_count
  from public.skill_prerequisite_edges pe
  where pe.path_key=p_path_key
    and pe.target_exercise_id=p_target_exercise_id
    and pe.active;

  v_model_incomplete:=v_edge_count=0 and v_target.member_role not in ('entry','alternate');

  with dirs as (
    select * from public.pi_exercise_directives(p_user_id,v_anchor,90)
  ), evaluated as (
    select
      pe.id edge_id,
      pe.prerequisite_kind,
      pe.prerequisite_exercise_id,
      coalesce(nullif(pre.display_name,''),pre.name) prerequisite_exercise_name,
      pe.requirement_json,
      pe.source,
      pe.confidence graph_confidence,
      pe.rationale,
      pe.version,
      d.directive,
      d.priority_score,
      d.confidence directive_confidence,
      d.evidence_count directive_evidence_count,
      d.source directive_source,
      d.latest_decision,
      d.reason_codes,
      c.confidence capability_confidence,
      c.freshness capability_freshness,
      c.valid_evidence_count capability_valid_evidence_count,
      c.last_valid_observed_at,
      case
        when pe.prerequisite_kind not in ('SKILL_STEP','EXERCISE_CAPABILITY') then 'NOT_EVALUATED'
        when pe.prerequisite_exercise_id is null then 'MODEL_INCOMPLETE'
        when c.exercise_id is null or d.directive is null then 'CALIBRATION_NEEDED'
        when d.directive in ('LEARN','RECALIBRATE') then 'CALIBRATION_NEEDED'
        when d.directive in ('DEVELOP','CONSOLIDATE') then 'PROBABLE_LIMITING_FACTOR'
        when d.directive in ('PROGRESS','MAINTAIN') then 'SUPPORTED'
        else 'CALIBRATION_NEEDED'
      end evaluation_status,
      case
        when pe.prerequisite_kind not in ('SKILL_STEP','EXERCISE_CAPABILITY') then 'PREREQUISITE_TYPE_REQUIRES_EXPLICIT_EVALUATOR'
        when pe.prerequisite_exercise_id is null then 'PREREQUISITE_EXERCISE_MISSING'
        when c.exercise_id is null then 'NO_CAPABILITY_OBSERVATION'
        when d.directive is null then 'NO_PI_DIRECTIVE'
        when d.directive='LEARN' then 'PI_REQUIRES_MORE_EVIDENCE'
        when d.directive='RECALIBRATE' then 'PI_REQUIRES_RECALIBRATION'
        when d.directive='DEVELOP' then 'PI_DEVELOPMENT_DIRECTIVE'
        when d.directive='CONSOLIDATE' then 'PI_CONSOLIDATION_DIRECTIVE'
        when d.directive='PROGRESS' then 'PI_PROGRESS_SUPPORTED'
        when d.directive='MAINTAIN' then 'PI_CAPABILITY_SUPPORTED'
        else 'PI_STATE_UNRESOLVED'
      end evaluation_reason
    from public.skill_prerequisite_edges pe
    left join public.exercises pre on pre.id=pe.prerequisite_exercise_id
    left join public.user_exercise_capabilities c
      on c.user_id=p_user_id and c.exercise_id=pe.prerequisite_exercise_id
    left join dirs d on d.exercise_id=pe.prerequisite_exercise_id::text
    where pe.path_key=p_path_key
      and pe.target_exercise_id=p_target_exercise_id
      and pe.active
  ), objects as (
    select *,jsonb_strip_nulls(jsonb_build_object(
      'edge_id',edge_id,
      'prerequisite_kind',prerequisite_kind,
      'prerequisite_exercise_id',prerequisite_exercise_id,
      'prerequisite_exercise_name',prerequisite_exercise_name,
      'requirement',requirement_json,
      'evaluation_status',evaluation_status,
      'evaluation_reason',evaluation_reason,
      'graph_source',source,
      'graph_confidence',graph_confidence,
      'graph_version',version,
      'rationale',rationale,
      'pi_directive',directive,
      'pi_priority_score',priority_score,
      'pi_confidence',directive_confidence,
      'pi_evidence_count',directive_evidence_count,
      'pi_source',directive_source,
      'pi_latest_decision',latest_decision,
      'pi_reason_codes',to_jsonb(reason_codes),
      'capability_confidence',capability_confidence,
      'capability_freshness',capability_freshness,
      'capability_valid_evidence_count',capability_valid_evidence_count,
      'last_valid_observed_at',last_valid_observed_at
    )) obj
    from evaluated
  )
  select
    coalesce(jsonb_agg(obj order by edge_id),'[]'::jsonb),
    coalesce(jsonb_agg(obj order by coalesce(priority_score,0) desc,edge_id) filter(where evaluation_status='PROBABLE_LIMITING_FACTOR'),'[]'::jsonb),
    coalesce(jsonb_agg(obj order by coalesce(priority_score,0) desc,edge_id) filter(where evaluation_status='CALIBRATION_NEEDED'),'[]'::jsonb),
    count(*) filter(where evaluation_status='PROBABLE_LIMITING_FACTOR')::int,
    count(*) filter(where evaluation_status='CALIBRATION_NEEDED')::int,
    coalesce(bool_or(evaluation_status in ('MODEL_INCOMPLETE','NOT_EVALUATED')),false)
  into v_prerequisites,v_factors,v_calibration,v_factor_count,v_calibration_count,v_model_incomplete
  from objects;

  v_model_incomplete:=v_model_incomplete or (v_edge_count=0 and v_target.member_role not in ('entry','alternate'));

  if v_target.member_role='alternate' and v_edge_count=0 then
    v_status:='BRANCH_RELATION_UNRESOLVED';
  elsif v_model_incomplete then
    v_status:='MODEL_INCOMPLETE';
  elsif v_calibration_count>0 then
    v_status:='CALIBRATION_NEEDED';
  elsif v_factor_count>0 then
    v_status:='LIMITING_FACTORS_IDENTIFIED';
  elsif v_edge_count=0 and v_target.member_role='entry' then
    v_status:='ENTRY_NO_PREREQUISITE_REQUIRED';
  else
    v_status:='PREREQUISITES_SUPPORTED';
  end if;

  return jsonb_build_object(
    'version','w3-limiting-factor-snapshot-v1',
    'anchor_date',v_anchor,
    'status',v_status,
    'target',jsonb_build_object(
      'path_key',v_target.path_key,
      'path_name',v_target.path_name,
      'path_region',v_target.path_region,
      'exercise_id',v_target.exercise_id,
      'exercise_name',v_target.exercise_name,
      'step_order',v_target.step_order,
      'member_role',v_target.member_role
    ),
    'prerequisites',v_prerequisites,
    'probable_limiting_factors',(
      select coalesce(jsonb_agg(value),'[]'::jsonb)
      from (
        select value
        from jsonb_array_elements(v_factors)
        limit 2
      ) q
    ),
    'calibration_needs',v_calibration,
    'summary',jsonb_build_object(
      'prerequisite_edges',v_edge_count,
      'probable_limiting_factor_count',v_factor_count,
      'calibration_need_count',v_calibration_count,
      'model_incomplete',v_model_incomplete
    ),
    'semantics',jsonb_build_object(
      'limiting_factors_are_probable_not_certain',true,
      'only_existing_pi_directives_are_used_for_athlete_state',true,
      'missing_athlete_evidence_returns_calibration_needed',true,
      'missing_prerequisite_model_returns_model_incomplete_not_athlete_weakness',true,
      'maximum_user_facing_probable_factors',2,
      'no_new_sports_thresholds_added',true
    )
  );
end;
$$;

revoke all on function public.w3_limiting_factor_snapshot_v1(uuid,text,text,date) from public,anon;
grant execute on function public.w3_limiting_factor_snapshot_v1(uuid,text,text,date) to authenticated,service_role;

comment on function public.w3_limiting_factor_snapshot_v1(uuid,text,text,date) is 'W3 LIM-001. Evaluates known Skill prerequisites using existing PI directives only. Missing athlete evidence yields CALIBRATION_NEEDED; missing graph knowledge yields MODEL_INCOMPLETE; no weakness is invented.';
