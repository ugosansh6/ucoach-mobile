create or replace function public.w3_equipment_gap_for_exercise_v1(
  p_user_id uuid,
  p_exercise_id text
)
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  v_inventory jsonb:='[]'::jsonb;
  v_gap jsonb;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;
  if not exists(select 1 from public.exercises where id=p_exercise_id) then raise exception 'Unknown exercise'; end if;

  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'equipment_id',i.equipment_id,
    'inventory_mode',i.inventory_mode,
    'quantity',i.quantity,
    'load_kg',i.load_kg,
    'min_load_kg',i.min_load_kg,
    'max_load_kg',i.max_load_kg,
    'increment_kg',i.increment_kg,
    'resistance_label',i.resistance_label
  ))),'[]'::jsonb)
  into v_inventory
  from public.user_equipment_inventory i
  where i.user_id=p_user_id and i.active;

  if public.exercise_equipment_compatible(p_exercise_id,v_inventory) then
    return jsonb_build_object(
      'version','w3-equipment-gap-v1','status','AVAILABLE','exercise_id',p_exercise_id,
      'missing_equipment','[]'::jsonb,
      'semantics',jsonb_build_object('option_groups_are_alternative_bundles',true,'exact_inventory_semantics_reused',true)
    );
  end if;

  with inventory_rows as (
    select
      item->>'equipment_id' equipment_id,
      coalesce(nullif(item->>'inventory_mode',''),'non_load') inventory_mode,
      greatest(coalesce(nullif(item->>'quantity','')::int,0),0) quantity,
      case
        when coalesce(nullif(item->>'inventory_mode',''),'non_load')='fixed_load' then 'fixed:'||coalesce(item->>'load_kg','unknown')
        when coalesce(nullif(item->>'inventory_mode',''),'non_load')='adjustable_load' then 'adjustable:'||coalesce(item->>'min_load_kg','unknown')||':'||coalesce(item->>'max_load_kg','unknown')||':'||coalesce(item->>'increment_kg','unknown')
        when coalesce(nullif(item->>'inventory_mode',''),'non_load')='load_unknown' then 'load_unknown'
        else 'non_load'
      end load_signature
    from jsonb_array_elements(v_inventory) item
  ), inventory_totals as (
    select equipment_id,sum(quantity)::int quantity
    from inventory_rows where equipment_id is not null group by equipment_id
  ), inventory_load_groups as (
    select equipment_id,load_signature,sum(quantity)::int quantity
    from inventory_rows where equipment_id is not null group by equipment_id,load_signature
  ), requirements as (
    select
      r.option_group,r.equipment_id,r.min_quantity,
      greatest(r.min_quantity,coalesce(max(ls.expected_implement_count),1)) required_implement_count,
      coalesce(bool_or(ls.symmetric_load),false) symmetric_load,
      eq.name equipment_name,eq.category
    from public.exercise_equipment_requirements_v2 r
    join public.equipment eq on eq.id=r.equipment_id
    left join public.exercise_load_semantics ls on ls.exercise_id=r.exercise_id and ls.equipment_id=r.equipment_id
    where r.exercise_id=p_exercise_id and not r.is_optional
    group by r.option_group,r.equipment_id,r.min_quantity,eq.name,eq.category
  ), evaluated as (
    select r.*,
      case when r.symmetric_load and r.required_implement_count>1
        then coalesce((select max(g.quantity) from inventory_load_groups g where g.equipment_id=r.equipment_id),0)
        else coalesce((select t.quantity from inventory_totals t where t.equipment_id=r.equipment_id),0)
      end usable_quantity
    from requirements r
  ), groups as (
    select option_group,
      bool_and(usable_quantity>=case when symmetric_load then required_implement_count else min_quantity end) group_ok,
      count(*) filter(where usable_quantity<case when symmetric_load then required_implement_count else min_quantity end)::int missing_count,
      coalesce(jsonb_agg(jsonb_build_object(
        'equipment_id',equipment_id,'name',equipment_name,'category',category,
        'required_quantity',case when symmetric_load then required_implement_count else min_quantity end,
        'usable_quantity',usable_quantity,
        'symmetric_load_required',symmetric_load
      ) order by equipment_name) filter(where usable_quantity<case when symmetric_load then required_implement_count else min_quantity end),'[]'::jsonb) missing
    from evaluated group by option_group
  )
  select jsonb_build_object(
    'version','w3-equipment-gap-v1','status','MISSING_EQUIPMENT','exercise_id',p_exercise_id,
    'selected_option_group',option_group,'missing_equipment',missing,
    'semantics',jsonb_build_object(
      'selected_group_is_the_smallest_missing_alternative_bundle',true,
      'option_groups_are_alternative_bundles',true,
      'symmetric_load_quantity_is_respected',true,
      'recommendation_is_access_not_purchase',true
    )
  )
  into v_gap
  from groups
  where not group_ok
  order by missing_count,option_group
  limit 1;

  return coalesce(v_gap,jsonb_build_object(
    'version','w3-equipment-gap-v1','status','MODEL_INCOMPLETE','exercise_id',p_exercise_id,'missing_equipment','[]'::jsonb
  ));
end;
$$;
revoke all on function public.w3_equipment_gap_for_exercise_v1(uuid,text) from public,anon;
grant execute on function public.w3_equipment_gap_for_exercise_v1(uuid,text) to authenticated,service_role;

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
  v_next record;
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
        select m.exercise_id,m.step_order,m.member_role,coalesce(nullif(e.display_name,''),e.name) exercise_name
        into v_next
        from public.skill_path_members m join public.exercises e on e.id=m.exercise_id
        where m.path_key=v_current.path_key and m.active and m.step_order=v_next_step
          and (
            (v_current.member_role in ('entry','main') and m.member_role='main')
            or (v_current.member_role not in ('entry','main','alternate') and m.member_role=v_current.member_role)
          )
        limit 1;
        v_next_lim:=public.w3_limiting_factor_snapshot_v1(p_user_id,v_current.path_key,v_next.exercise_id,v_anchor);
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
    'next_target',case when v_next_count=1 then jsonb_build_object('exercise_id',v_next.exercise_id,'exercise_name',v_next.exercise_name,'step_order',v_next.step_order,'member_role',v_next.member_role) else null end,
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

create or replace function public.w3_opportunity_engine_v1(
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
  v_skill jsonb;
  v_candidates jsonb:='[]'::jsonb;
  v_ranked jsonb:='[]'::jsonb;
  v_skipped jsonb:='[]'::jsonb;
  v_current_id text;
  v_current_name text;
  v_next_id text;
  v_next_name text;
  v_skill_state text;
  v_dir text;
  v_pi_score numeric;
  v_pi_conf numeric;
  v_primary_target_id text;
  v_primary_target_name text;
  v_primary_type text;
  v_equipment jsonb;
  v_retest record;
  v_progress record;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;

  v_skill:=public.w3_active_skill_objective_v1(p_user_id,v_anchor);
  v_skill_state:=v_skill->>'status';
  v_current_id:=v_skill#>>'{current_target,exercise_id}';
  v_current_name:=v_skill#>>'{current_target,exercise_name}';
  v_next_id:=v_skill#>>'{next_target,exercise_id}';
  v_next_name:=v_skill#>>'{next_target,exercise_name}';
  v_dir:=v_skill#>>'{current_target,pi_directive}';
  v_pi_score:=nullif(v_skill#>>'{current_target,pi_priority_score}','')::numeric;
  v_pi_conf:=nullif(v_skill#>>'{current_target,pi_confidence}','')::numeric;

  if v_skill_state='CALIBRATION_NEEDED' then
    v_primary_target_id:=v_current_id; v_primary_target_name:=v_current_name;
    v_primary_type:=case when v_dir='RECALIBRATE' then 'RETEST' else 'CALIBRATION' end;
    v_candidates:=v_candidates||jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'type',v_primary_type,'primary',true,'decision_blocking',true,
      'target_exercise_id',v_primary_target_id,'target_exercise_name',v_primary_target_name,
      'existing_priority_score',v_pi_score,'existing_confidence',v_pi_conf,
      'reason_code',case when v_dir='RECALIBRATE' then 'ACTIVE_SKILL_RECALIBRATION_REQUIRED' else 'ACTIVE_SKILL_DECISION_MISSING_EVIDENCE' end,
      'evidence_ref',jsonb_build_object('source','w3_active_skill_objective_v1','status',v_skill_state,'pi_directive',v_dir)
    )));
  elsif v_skill_state='DEVELOPMENT_NEEDED' then
    v_primary_target_id:=v_current_id; v_primary_target_name:=v_current_name; v_primary_type:='SKILL_DEVELOPMENT';
    v_candidates:=v_candidates||jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'type','SKILL_DEVELOPMENT','primary',true,'decision_blocking',false,
      'target_exercise_id',v_current_id,'target_exercise_name',v_current_name,
      'existing_priority_score',v_pi_score,'existing_confidence',v_pi_conf,
      'reason_code','ACTIVE_SKILL_EXISTING_PI_DEVELOPMENT_DIRECTIVE',
      'evidence_ref',jsonb_build_object('source','w3_active_skill_objective_v1','status',v_skill_state,'pi_directive',v_dir)
    )));
  elsif v_skill_state='PROGRESSION_CANDIDATE' then
    v_primary_target_id:=v_next_id; v_primary_target_name:=v_next_name; v_primary_type:='SKILL_PROGRESSION';
    v_candidates:=v_candidates||jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'type','SKILL_PROGRESSION','primary',true,'decision_blocking',false,
      'target_exercise_id',v_next_id,'target_exercise_name',v_next_name,
      'existing_priority_score',v_pi_score,'existing_confidence',v_pi_conf,
      'reason_code','ACTIVE_SKILL_CURRENT_STEP_PROGRESS_SUPPORTED_AND_NEXT_PREREQUISITES_SUPPORTED',
      'evidence_ref',jsonb_build_object('source','w3_active_skill_objective_v1','status',v_skill_state,'current_exercise_id',v_current_id)
    )));
  elsif v_skill_state='NEXT_STEP_CALIBRATION_NEEDED' then
    v_primary_target_id:=v_next_id; v_primary_target_name:=v_next_name; v_primary_type:='CALIBRATION';
    v_candidates:=v_candidates||jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'type','CALIBRATION','primary',true,'decision_blocking',true,
      'target_exercise_id',v_next_id,'target_exercise_name',v_next_name,
      'existing_priority_score',v_pi_score,'existing_confidence',v_pi_conf,
      'reason_code','NEXT_SKILL_STEP_BLOCKED_BY_MISSING_PREREQUISITE_EVIDENCE',
      'evidence_ref',v_skill->'next_target_prerequisite_snapshot'
    )));
  elsif v_skill_state in ('PREREQUISITE_MODEL_INCOMPLETE','BRANCH_SELECTION_REQUIRED','PATH_END_OR_BRANCH_REQUIRED') then
    v_skipped:=v_skipped||jsonb_build_array(jsonb_build_object(
      'type','SKILL_PROGRESSION','reason_code',v_skill_state,
      'reason','No automatic recommendation because the prerequisite/branch model is not explicit enough.'
    ));
  end if;

  if v_primary_target_id is not null then
    v_equipment:=public.w3_equipment_gap_for_exercise_v1(p_user_id,v_primary_target_id);
    if v_equipment->>'status'='MISSING_EQUIPMENT' then
      v_candidates:=v_candidates||jsonb_build_array(jsonb_build_object(
        'type','EQUIPMENT_ACCESS','primary',false,'decision_blocking',true,
        'target_exercise_id',v_primary_target_id,'target_exercise_name',v_primary_target_name,
        'supports_opportunity_type',v_primary_type,
        'existing_priority_score',v_pi_score,'existing_confidence',v_pi_conf,
        'reason_code','EXACT_EQUIPMENT_MISSING_FOR_CURRENT_COACH_OPPORTUNITY',
        'equipment_gap',v_equipment,
        'evidence_ref',jsonb_build_object('source','exercise_equipment_requirements_v2 + user_equipment_inventory')
      ));
    end if;
  end if;

  select * into v_retest
  from public.pi_exercise_directives(p_user_id,v_anchor,90)
  where directive='RECALIBRATE' and (v_current_id is null or exercise_id<>v_current_id)
  order by priority_score desc,confidence desc,exercise_id
  limit 1;
  if found then
    v_candidates:=v_candidates||jsonb_build_array(jsonb_build_object(
      'type','RETEST','primary',true,'decision_blocking',false,
      'target_exercise_id',v_retest.exercise_id,'target_exercise_name',v_retest.exercise_name,
      'existing_priority_score',v_retest.priority_score,'existing_confidence',v_retest.confidence,
      'reason_code','EXISTING_PI_RECALIBRATE_DIRECTIVE',
      'evidence_ref',jsonb_build_object('source',v_retest.source,'latest_decision',v_retest.latest_decision,'reason_codes',to_jsonb(v_retest.reason_codes))
    ));
  end if;

  select * into v_progress
  from public.pi_exercise_directives(p_user_id,v_anchor,90)
  where directive='PROGRESS'
    and (v_current_id is null or exercise_id<>v_current_id)
    and (v_next_id is null or exercise_id<>v_next_id)
  order by priority_score desc,confidence desc,exercise_id
  limit 1;
  if found then
    v_candidates:=v_candidates||jsonb_build_array(jsonb_build_object(
      'type','MOVEMENT_PROGRESSION','primary',true,'decision_blocking',false,
      'target_exercise_id',v_progress.exercise_id,'target_exercise_name',v_progress.exercise_name,
      'existing_priority_score',v_progress.priority_score,'existing_confidence',v_progress.confidence,
      'reason_code','EXISTING_PI_PROGRESS_DIRECTIVE',
      'evidence_ref',jsonb_build_object('source',v_progress.source,'latest_decision',v_progress.latest_decision,'reason_codes',to_jsonb(v_progress.reason_codes))
    ));
  end if;

  select coalesce(jsonb_agg(value order by
    coalesce((value->>'decision_blocking')::boolean,false) desc,
    coalesce((value->>'primary')::boolean,false) desc,
    coalesce(nullif(value->>'existing_priority_score','')::numeric,-1) desc,
    value->>'type',value->>'target_exercise_id'
  ),'[]'::jsonb)
  into v_ranked
  from (
    select value
    from jsonb_array_elements(v_candidates)
    order by
      coalesce((value->>'decision_blocking')::boolean,false) desc,
      coalesce((value->>'primary')::boolean,false) desc,
      coalesce(nullif(value->>'existing_priority_score','')::numeric,-1) desc,
      value->>'type',value->>'target_exercise_id'
    limit 3
  ) q;

  return jsonb_build_object(
    'version','w3-opportunity-engine-v1','anchor_date',v_anchor,
    'status',case when jsonb_array_length(v_ranked)>0 then 'OPPORTUNITIES_IDENTIFIED' else 'NO_EVIDENCE_BACKED_OPPORTUNITY' end,
    'top_opportunities',v_ranked,
    'all_candidates',v_candidates,
    'skipped',v_skipped,
    'active_skill_objective',v_skill,
    'ranking_contract',jsonb_build_object(
      'soft_ranking_only',true,
      'decision_blocking_information_first',true,
      'existing_pi_priority_is_reused_not_reinvented',true,
      'max_user_facing_opportunities',3,
      'hard_safety_equipment_readiness_and_program_rules_remain_higher_authority',true,
      'does_not_mutate_generation',true
    ),
    'coverage',jsonb_build_object(
      'skill',true,'progression',true,'calibration',true,'retest',true,'equipment_access',true,
      'recovery','OWNED_BY_EXISTING_PROGRAM_COACH','time_opportunity','OWNED_BY_EXISTING_SESSION_ARCHITECTURE','useful_variety','OWNED_BY_EXISTING_VARIETY_POLICY'
    ),
    'semantics',jsonb_build_object(
      'calibration_is_created_only_when_it_blocks_a_named_decision_or_existing_recalibration_directive',true,
      'equipment_access_is_tied_to_a_named_opportunity_and_exact_requirement',true,
      'missing_equipment_recommends_access_not_purchase_or_gym_assumption',true,
      'no_new_sports_thresholds_added',true
    )
  );
end;
$$;
revoke all on function public.w3_opportunity_engine_v1(uuid,date) from public,anon;
grant execute on function public.w3_opportunity_engine_v1(uuid,date) to authenticated,service_role;

comment on function public.w3_opportunity_engine_v1(uuid,date) is 'W3 OPP-001/002/003 read engine. Ranks evidence-backed Skill/progression/calibration/retest/equipment opportunities using existing PI priority and explicit decision-blocking semantics; it does not mutate generation.';
