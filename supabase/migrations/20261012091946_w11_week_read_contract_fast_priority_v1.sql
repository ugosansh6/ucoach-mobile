-- W11.1 — optimize Ma semaine read path.
-- Use the persisted Program Coach priority contract for a fast, stable week surface.
-- Exact Session Role / dose / readiness-sensitive decisions remain day-J concerns.

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
  v_week_start date := public.d_week_start(coalesce(p_anchor_date,current_date));
  v_week_end date := public.d_week_start(coalesce(p_anchor_date,current_date)) + 6;
  v_week record;
  v_priority_snapshot jsonb;
  v_priority_contract jsonb;
  v_primary jsonb;
  v_secondary jsonb;
  v_maintenance jsonb;
  v_items jsonb := '[]'::jsonb;
  v_item record;
  v_provenance text;
  v_provenance_source text;
  v_adaptation_mode text;
  v_authority jsonb;
  v_display_state text;
  v_surface_visibility text;
  v_completed_actual_count int := 0;
  v_open_rank int := 0;
  v_priority jsonb;
  v_slot_kind text;
  v_projection_certainty text;
begin
  if p_user_id is null then raise exception 'User required'; end if;
  if auth.uid() is not null and auth.uid() <> p_user_id then raise exception 'Forbidden user'; end if;

  select * into v_week
  from public.user_training_weeks
  where user_id=p_user_id and week_start=v_week_start;

  v_priority_snapshot := public.program_coach_block_priority_snapshot_v2(p_user_id,v_anchor);
  v_priority_contract := coalesce(v_priority_snapshot->'priority_contract','{}'::jsonb);
  v_primary := v_priority_contract->'primary_priority';
  v_secondary := v_priority_contract->'secondary_priority';
  v_maintenance := coalesce(v_priority_contract->'maintenance','[]'::jsonb);

  for v_item in
    select
      i.*,
      s.status as session_status,
      s.duration_minutes as session_duration_minutes,
      s.focus as session_focus,
      s.target_region as session_target_region,
      s.progression_intent as session_progression_intent,
      s.planning_context_json as session_planning_context,
      s.generated_workout as session_generated_workout,
      s.planned_environment_code as session_planned_environment_code,
      s.available_equipment as session_available_equipment,
      s.started_at as session_started_at,
      s.completed_at as session_completed_at
    from public.user_training_plan_items i
    left join public.workout_sessions s on s.id=i.session_id
    where i.user_id=p_user_id and i.week_start=v_week_start
    order by i.sequence_index,i.recommended_date,i.id
  loop
    v_provenance := public.week_item_provenance_v1(
      coalesce(v_item.planning_context_json,'{}'::jsonb),
      coalesce(v_item.session_planning_context,'{}'::jsonb),
      coalesce(v_item.session_generated_workout,'{}'::jsonb),
      v_item.session_id is not null
    );

    v_provenance_source := case
      when nullif(v_item.planning_context_json #>> '{w11,provenance}','') is not null
        or nullif(v_item.session_planning_context #>> '{w11,provenance}','') is not null
        or nullif(v_item.session_generated_workout #>> '{meta,w11,provenance}','') is not null
      then 'EXPLICIT_W11'
      when v_item.session_id is not null then 'SERVER_LEGACY_FALLBACK'
      else 'COACH_PROJECTION_DEFAULT'
    end;

    v_adaptation_mode := upper(coalesce(
      nullif(v_item.planning_context_json #>> '{w11,adaptation_mode}',''),
      nullif(v_item.session_planning_context #>> '{w11,adaptation_mode}',''),
      'DEFAULT'
    ));
    v_authority := public.week_authority_contract_v1(v_provenance,v_adaptation_mode);

    v_display_state := case
      when v_item.session_status='completed' or v_item.status='completed' then 'REALISEE'
      when v_item.session_status='in_progress' then 'ACTIVE'
      when v_item.session_status='generated' then 'PRETE'
      when v_item.status in ('skipped','unrealized') or v_item.session_status='abandoned' then 'CLOSED_SILENT'
      else 'PREVUE'
    end;

    v_surface_visibility := case
      when v_display_state='CLOSED_SILENT' then 'CONTEXT_ONLY'
      else 'PRIMARY'
    end;

    if v_display_state='REALISEE' then
      v_completed_actual_count:=v_completed_actual_count+1;
    end if;

    v_priority := null;
    v_slot_kind := null;
    v_projection_certainty := null;

    if v_display_state in ('PREVUE','PRETE','ACTIVE') then
      v_open_rank := v_open_rank + 1;
      if v_open_rank=1 and jsonb_typeof(v_primary)='object' then
        v_priority:=v_primary;
        v_slot_kind:='PERSISTED_PRIMARY_PRIORITY';
      elsif v_open_rank=2 and jsonb_typeof(v_secondary)='object' then
        v_priority:=v_secondary;
        v_slot_kind:='PERSISTED_SECONDARY_PRIORITY';
      elsif v_open_rank=3 and jsonb_typeof(v_maintenance)='array' and jsonb_array_length(v_maintenance)>0 then
        v_priority:=jsonb_build_object(
          'kind','MAINTENANCE_POOL',
          'key','week_balance',
          'programming_state','MAINTAIN',
          'candidates',v_maintenance,
          'priority_reason','PRESERVE_NON_PRIORITY_CAPACITIES_WITHOUT_FORCED_EQUAL_DISTRIBUTION'
        );
        v_slot_kind:='MAINTENANCE_POOL';
      else
        v_slot_kind:='FLEXIBLE_COMPLEMENT';
      end if;

      v_projection_certainty := case
        when v_open_rank=1 and v_item.recommended_date<=v_anchor then 'CURRENT_RECOMMENDATION'
        else 'CONDITIONAL_FUTURE'
      end;
    end if;

    v_items := v_items || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'plan_item_id',v_item.id,
      'sequence_index',v_item.sequence_index,
      'recommended_date',v_item.recommended_date,
      'recommended_date_is_soft',coalesce((v_item.planning_context_json->>'recommended_date_is_soft')::boolean,true),
      'lifecycle_status',v_item.status,
      'display_state',v_display_state,
      'surface_visibility',v_surface_visibility,
      'user_debt_created',false,
      'session_id',v_item.session_id,
      'session_status',v_item.session_status,
      'provenance',jsonb_build_object(
        'code',v_provenance,
        'source',v_provenance_source
      ),
      'authority',v_authority,
      'planned_context',jsonb_strip_nulls(jsonb_build_object(
        'duration_minutes',coalesce(v_item.session_duration_minutes,v_item.planned_duration_minutes),
        'environment_code',v_item.session_planned_environment_code,
        'equipment',case when v_item.session_id is not null then to_jsonb(v_item.session_available_equipment) else v_item.planning_context_json->'equipment' end,
        'planning_context',v_item.planning_context_json
      )),
      'session_summary',case when v_item.session_id is null then null else jsonb_strip_nulls(jsonb_build_object(
        'status',v_item.session_status,
        'duration_minutes',v_item.session_duration_minutes,
        'focus',v_item.session_focus,
        'target_region',v_item.session_target_region,
        'progression_intent',v_item.session_progression_intent,
        'planned_environment_code',v_item.session_planned_environment_code,
        'started_at',v_item.session_started_at,
        'completed_at',v_item.session_completed_at
      )) end,
      'coach_projection',case when v_slot_kind is null then null else jsonb_strip_nulls(jsonb_build_object(
        'slot_kind',v_slot_kind,
        'priority',v_priority,
        'projection_certainty',v_projection_certainty,
        'role_requires_revalidation',v_open_rank>1,
        'replan_after_previous_actual',v_open_rank>1,
        'future_readiness_unknown',true,
        'priority_source','PERSISTED_BLOCK_PRIORITY_V2_FAST_READ'
      )) end
    )));
  end loop;

  return jsonb_build_object(
    'contract_version','W11_WEEK_READ_V1',
    'read_path','PERSISTED_PRIORITY_FAST_READ',
    'user_id',p_user_id,
    'anchor_date',v_anchor,
    'week_start',v_week_start,
    'week_end',v_week_end,
    'week_status',v_week.status,
    'weekly_session_target',v_week.weekly_session_target,
    'completed_actual_count',v_completed_actual_count,
    'items',v_items,
    'projection_meta',jsonb_strip_nulls(jsonb_build_object(
      'version',v_priority_snapshot->>'version',
      'status',v_priority_snapshot->>'status',
      'mode',v_priority_snapshot->>'mode',
      'block_id',v_priority_snapshot->>'block_id',
      'priority_contract_version',v_priority_contract->>'version',
      'full_projection_rpc','program_coach_ideal_week_projection_v2',
      'full_projection_deferred',true
    )),
    'semantics',jsonb_build_object(
      'single_longitudinal_engine',true,
      'legacy_planned_focus_is_programming_authority',false,
      'recommended_dates_are_soft',true,
      'no_session_debt',true,
      'planned_is_not_actual',true,
      'future_readiness_is_not_assumed',true,
      'front_must_not_infer_provenance',true,
      'front_must_not_reimplement_authority_policy',true,
      'weekly_target_is_not_a_completion_score',true,
      'closed_silent_items_must_not_be_rendered_as_failure',true,
      'full_session_role_and_dose_are_resolved_at_session_time',true,
      'week_read_uses_persisted_priority_not_heavy_runtime_recalculation',true
    )
  );
end;
$$;

comment on function public.week_read_contract_v1(uuid,date) is
'W11 unified fast read contract for Ma semaine. Temporal scaffold + persisted Program Coach priority contract + canonical sessions + provenance/authority. Heavy session-role/dose projection is intentionally deferred to session time.';
