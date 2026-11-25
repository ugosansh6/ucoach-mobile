-- W11.1 — canonical week provenance, authority matrix and unified read contract v1.
-- The read contract is optimized by the follow-up migration 20261012091946.

create or replace function public.week_item_provenance_v1(
  p_plan_context jsonb default '{}'::jsonb,
  p_session_context jsonb default '{}'::jsonb,
  p_generated_workout jsonb default '{}'::jsonb,
  p_has_session boolean default false
)
returns text
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_explicit text;
  v_source text;
  v_mode text;
begin
  v_explicit := upper(nullif(trim(coalesce(
    p_plan_context #>> '{w11,provenance}',
    p_session_context #>> '{w11,provenance}',
    p_generated_workout #>> '{meta,w11,provenance}'
  )),''));

  if v_explicit = any(array[
    'UGEROD_PROJECTION','UGEROD_GENERATED_SESSION','USER_ASSISTED_SESSION',
    'USER_FREE_SESSION','SAVED_MODEL_SESSION','STRUCTURED_PROGRAM_SESSION','EXTERNAL_ACTUAL'
  ]) then
    return v_explicit;
  end if;

  v_source := lower(nullif(trim(coalesce(
    p_session_context ->> 'session_source',
    p_generated_workout #>> '{meta,source}',
    p_generated_workout ->> 'session_source'
  )),''));

  v_mode := upper(nullif(trim(coalesce(
    p_plan_context #>> '{w11,creation_mode}',
    p_session_context #>> '{w11,creation_mode}'
  )),''));

  if v_source in ('external_import','external_actual','external_session') then return 'EXTERNAL_ACTUAL'; end if;
  if v_source in ('structured_program','program_session','strict_program') then return 'STRUCTURED_PROGRAM_SESSION'; end if;
  if v_source in ('saved_model','saved_session_model') or v_mode='SAVED_MODEL' then return 'SAVED_MODEL_SESSION'; end if;

  if v_source='user_session_builder' then
    if v_mode='ASSISTED' then return 'USER_ASSISTED_SESSION'; end if;
    if v_mode='SAVED_MODEL' then return 'SAVED_MODEL_SESSION'; end if;
    return 'USER_FREE_SESSION';
  end if;

  if coalesce(p_has_session,false) then return 'UGEROD_GENERATED_SESSION'; end if;
  return 'UGEROD_PROJECTION';
end;
$$;

comment on function public.week_item_provenance_v1(jsonb,jsonb,jsonb,boolean) is
'W11 canonical provenance resolver. Explicit planning_context_json.w11.provenance wins; legacy/session-source inference is fallback only.';

create or replace function public.week_authority_contract_v1(
  p_provenance text,
  p_adaptation_mode text default null
)
returns jsonb
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_p text := upper(coalesce(nullif(trim(p_provenance),''),'UGEROD_PROJECTION'));
  v_mode text := upper(coalesce(nullif(trim(p_adaptation_mode),''),'DEFAULT'));
  v_structure jsonb;
  v_exercises jsonb;
  v_mechanic jsonb;
  v_dose jsonb;
  v_summary text;
begin
  if v_p in ('UGEROD_PROJECTION','UGEROD_GENERATED_SESSION') then
    v_structure := jsonb_build_object('owner','COACH','auto_patch',true,'proposal_required',false);
    v_exercises := jsonb_build_object('owner','COACH','auto_patch',true,'proposal_required',false);
    v_mechanic := jsonb_build_object('owner','COACH','auto_patch',true,'proposal_required',false);
    v_dose := jsonb_build_object('owner','COACH','auto_patch',true,'proposal_required',false);
    v_summary := 'COACH_AUTHORED';
  elsif v_p='USER_ASSISTED_SESSION' then
    v_structure := jsonb_build_object('owner','USER','auto_patch',false,'proposal_required',true);
    v_exercises := jsonb_build_object('owner','USER','auto_patch',false,'proposal_required',true);
    v_mechanic := jsonb_build_object('owner','USER','auto_patch',false,'proposal_required',true);
    v_dose := jsonb_build_object('owner','COACH','auto_patch',true,'proposal_required',false,
      'allowed_dimensions',jsonb_build_array('REPS','LOAD','VOLUME','REST','DOSE'));
    v_summary := 'USER_STRUCTURE_COACH_DOSE';
  elsif v_p='USER_FREE_SESSION' then
    v_structure := jsonb_build_object('owner','USER','auto_patch',false,'proposal_required',true);
    v_exercises := jsonb_build_object('owner','USER','auto_patch',false,'proposal_required',true);
    v_mechanic := jsonb_build_object('owner','USER','auto_patch',false,'proposal_required',true);
    v_dose := jsonb_build_object('owner','USER','auto_patch',false,'proposal_required',true);
    v_summary := 'USER_AUTHORED';
  elsif v_p='SAVED_MODEL_SESSION' then
    v_structure := jsonb_build_object('owner','USER','auto_patch',false,'proposal_required',true);
    v_exercises := jsonb_build_object('owner','USER','auto_patch',false,'proposal_required',true);
    v_mechanic := jsonb_build_object('owner','USER','auto_patch',false,'proposal_required',true);
    if v_mode='ADAPT_TODAY' then
      v_dose := jsonb_build_object('owner','COACH','auto_patch',true,'proposal_required',false,
        'allowed_dimensions',jsonb_build_array('REPS','LOAD','VOLUME','REST','DOSE'));
      v_summary := 'SAVED_MODEL_USER_STRUCTURE_COACH_DOSE';
    else
      v_dose := jsonb_build_object('owner','USER','auto_patch',false,'proposal_required',true);
      v_summary := 'SAVED_MODEL_AS_AUTHORED';
    end if;
  elsif v_p='STRUCTURED_PROGRAM_SESSION' then
    v_structure := jsonb_build_object('owner','PROGRAM','auto_patch',false,'proposal_required',true,'bounds_required',true);
    v_exercises := jsonb_build_object('owner','PROGRAM','auto_patch',false,'proposal_required',true,'equivalence_rules_required',true);
    v_mechanic := jsonb_build_object('owner','PROGRAM','auto_patch',false,'proposal_required',true,'bounds_required',true);
    v_dose := jsonb_build_object('owner','COACH_WITHIN_PROGRAM_BOUNDS','auto_patch',true,'proposal_required',false,'bounds_required',true);
    v_summary := 'PROGRAM_CORE_COACH_WITHIN_BOUNDS';
  elsif v_p='EXTERNAL_ACTUAL' then
    v_structure := jsonb_build_object('owner','ACTUAL','auto_patch',false,'proposal_required',false);
    v_exercises := jsonb_build_object('owner','ACTUAL','auto_patch',false,'proposal_required',false);
    v_mechanic := jsonb_build_object('owner','ACTUAL','auto_patch',false,'proposal_required',false);
    v_dose := jsonb_build_object('owner','ACTUAL','auto_patch',false,'proposal_required',false);
    v_summary := 'IMMUTABLE_ACTUAL';
  else
    v_structure := jsonb_build_object('owner','UNKNOWN','auto_patch',false,'proposal_required',true);
    v_exercises := v_structure;
    v_mechanic := v_structure;
    v_dose := v_structure;
    v_summary := 'UNKNOWN_FAIL_CLOSED';
  end if;

  return jsonb_build_object(
    'version','w11-week-authority-v1',
    'provenance',v_p,
    'adaptation_mode',v_mode,
    'summary',v_summary,
    'dimensions',jsonb_build_object(
      'structure',v_structure,
      'exercise_selection',v_exercises,
      'mechanic',v_mechanic,
      'dose',v_dose
    ),
    'silent_structural_rewrite_allowed',false,
    'safety_override',jsonb_build_object(
      'allowed',v_p<>'EXTERNAL_ACTUAL',
      'scope','HARD_SAFETY_OR_PHYSICAL_IMPOSSIBILITY',
      'must_explain',true
    )
  );
end;
$$;

comment on function public.week_authority_contract_v1(text,text) is
'W11 authority matrix: who owns structure/exercises/mechanic/dose and what UGEROD may patch silently. Safety override is narrow and explicit.';

-- Initial unified read contract. The next migration replaces the heavy full projection
-- with the persisted-priority fast read while keeping the same public contract name.
create or replace function public.week_read_contract_v1(
  p_user_id uuid,
  p_anchor_date date default current_date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_anchor date := coalesce(p_anchor_date,current_date);
  v_projection jsonb;
  v_week_start date;
  v_week_end date;
  v_week record;
  v_items jsonb := '[]'::jsonb;
  v_item record;
  v_slot jsonb;
  v_provenance text;
  v_adaptation_mode text;
  v_authority jsonb;
  v_display_state text;
  v_surface_visibility text;
  v_completed_actual_count int := 0;
begin
  if p_user_id is null then raise exception 'User required'; end if;
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;

  v_projection := public.program_coach_ideal_week_projection_v2(p_user_id,v_anchor,null::text,null::text[]);
  v_week_start := coalesce(nullif(v_projection->>'week_start','')::date,public.d_week_start(v_anchor));
  v_week_end := coalesce(nullif(v_projection->>'week_end','')::date,v_week_start+6);

  select * into v_week from public.user_training_weeks
  where user_id=p_user_id and week_start=v_week_start;

  for v_item in
    select i.*,
      s.status session_status,s.duration_minutes session_duration_minutes,s.focus session_focus,
      s.target_region session_target_region,s.progression_intent session_progression_intent,
      s.planning_context_json session_planning_context,s.generated_workout session_generated_workout,
      s.planned_environment_code session_planned_environment_code,s.available_equipment session_available_equipment,
      s.started_at session_started_at,s.completed_at session_completed_at
    from public.user_training_plan_items i
    left join public.workout_sessions s on s.id=i.session_id
    where i.user_id=p_user_id and i.week_start=v_week_start
    order by i.sequence_index,i.recommended_date,i.id
  loop
    select value into v_slot
    from jsonb_array_elements(coalesce(v_projection->'projected_slots','[]'::jsonb)) x(value)
    where (value->>'source_plan_item_id')=v_item.id::text
       or (nullif(value->>'source_plan_item_id','') is null and coalesce((value->>'sequence_index')::int,-1)=v_item.sequence_index)
    order by case when (value->>'source_plan_item_id')=v_item.id::text then 0 else 1 end limit 1;

    v_provenance := public.week_item_provenance_v1(
      coalesce(v_item.planning_context_json,'{}'::jsonb),coalesce(v_item.session_planning_context,'{}'::jsonb),
      coalesce(v_item.session_generated_workout,'{}'::jsonb),v_item.session_id is not null);
    v_adaptation_mode := upper(coalesce(nullif(v_item.planning_context_json#>>'{w11,adaptation_mode}',''),
      nullif(v_item.session_planning_context#>>'{w11,adaptation_mode}',''),'DEFAULT'));
    v_authority := public.week_authority_contract_v1(v_provenance,v_adaptation_mode);

    v_display_state := case
      when v_item.session_status='completed' or v_item.status='completed' then 'REALISEE'
      when v_item.session_status='in_progress' then 'ACTIVE'
      when v_item.session_status='generated' then 'PRETE'
      when v_item.status in ('skipped','unrealized') or v_item.session_status='abandoned' then 'CLOSED_SILENT'
      else 'PREVUE' end;
    v_surface_visibility := case when v_display_state='CLOSED_SILENT' then 'CONTEXT_ONLY' else 'PRIMARY' end;
    if v_display_state='REALISEE' then v_completed_actual_count:=v_completed_actual_count+1; end if;

    v_items := v_items || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'plan_item_id',v_item.id,'sequence_index',v_item.sequence_index,'recommended_date',v_item.recommended_date,
      'recommended_date_is_soft',coalesce((v_item.planning_context_json->>'recommended_date_is_soft')::boolean,true),
      'lifecycle_status',v_item.status,'display_state',v_display_state,'surface_visibility',v_surface_visibility,
      'user_debt_created',false,'session_id',v_item.session_id,'session_status',v_item.session_status,
      'provenance',jsonb_build_object('code',v_provenance,'source','EXPLICIT_W11_OR_SERVER_FALLBACK'),
      'authority',v_authority,
      'planned_context',jsonb_strip_nulls(jsonb_build_object(
        'duration_minutes',coalesce(v_item.session_duration_minutes,v_item.planned_duration_minutes),
        'environment_code',v_item.session_planned_environment_code,
        'equipment',case when v_item.session_id is not null then to_jsonb(v_item.session_available_equipment) else v_item.planning_context_json->'equipment' end,
        'planning_context',v_item.planning_context_json)),
      'session_summary',case when v_item.session_id is null then null else jsonb_strip_nulls(jsonb_build_object(
        'status',v_item.session_status,'duration_minutes',v_item.session_duration_minutes,'focus',v_item.session_focus,
        'target_region',v_item.session_target_region,'progression_intent',v_item.session_progression_intent,
        'planned_environment_code',v_item.session_planned_environment_code,'started_at',v_item.session_started_at,
        'completed_at',v_item.session_completed_at)) end,
      'coach_projection',case when v_slot is null then null else jsonb_strip_nulls(jsonb_build_object(
        'slot_kind',v_slot->>'slot_kind','programming_role',v_slot->>'programming_role','priority',v_slot->'priority',
        'projection_certainty',v_slot->>'projection_certainty','role_requires_revalidation',v_slot->'role_requires_revalidation',
        'replan_after_previous_actual',v_slot->'replan_after_previous_actual','future_readiness_unknown',v_slot->'future_readiness_unknown',
        'environment_recommendation',v_slot->'environment_recommendation')) end
    )));
    v_slot:=null;
  end loop;

  return jsonb_build_object(
    'contract_version','W11_WEEK_READ_V1','user_id',p_user_id,'anchor_date',v_anchor,'week_start',v_week_start,'week_end',v_week_end,
    'week_status',v_week.status,'weekly_session_target',v_week.weekly_session_target,'completed_actual_count',v_completed_actual_count,'items',v_items,
    'projection_meta',jsonb_strip_nulls(jsonb_build_object('version',v_projection->>'version','status',v_projection->>'status','mode',v_projection->>'mode',
      'priority_persistence_status',v_projection->>'priority_persistence_status','legacy_week_plan_usage',v_projection->>'legacy_week_plan_usage')),
    'semantics',jsonb_build_object(
      'single_longitudinal_engine',true,'legacy_planned_focus_is_programming_authority',false,'recommended_dates_are_soft',true,
      'no_session_debt',true,'planned_is_not_actual',true,'future_readiness_is_not_assumed',true,'front_must_not_infer_provenance',true,
      'front_must_not_reimplement_authority_policy',true,'weekly_target_is_not_a_completion_score',true,
      'closed_silent_items_must_not_be_rendered_as_failure',true));
end;
$$;

comment on function public.week_read_contract_v1(uuid,date) is
'W11 unified read contract for Ma semaine. Aggregates temporal plan scaffold, modern Program Coach projection, linked canonical sessions, provenance and authority. Read-only; legacy planned_focus/region/intent are never programming authority.';

revoke all on function public.week_item_provenance_v1(jsonb,jsonb,jsonb,boolean) from public;
revoke all on function public.week_authority_contract_v1(text,text) from public;
revoke all on function public.week_read_contract_v1(uuid,date) from public;
grant execute on function public.week_item_provenance_v1(jsonb,jsonb,jsonb,boolean) to authenticated, service_role;
grant execute on function public.week_authority_contract_v1(text,text) to authenticated, service_role;
grant execute on function public.week_read_contract_v1(uuid,date) to authenticated, service_role;
