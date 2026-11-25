create or replace function public.d_resolve_session_context(
  p_user_id uuid,
  p_anchor_date date default current_date,
  p_duration_minutes integer default 45,
  p_readiness text default 'normal'::text,
  p_focus_override text default null,
  p_target_region_override text default null,
  p_progression_intent_override text default null
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $function$
declare
  v_anchor date:=coalesce(p_anchor_date,current_date);
  v_week date:=public.d_week_start(coalesce(p_anchor_date,current_date));
  v_target int;
  v_goal text;
  v_item public.user_training_plan_items%rowtype;
  v_active public.user_training_plan_items%rowtype;
  v_active_session public.workout_sessions%rowtype;
  v_completed_count int;
  v_last record;
  v_exception_ratio numeric:=0;
  v_intent text;
  v_focus text;
  v_region text;
  v_reasons text[]:='{}'::text[];
  v_override_intent text:=upper(nullif(trim(coalesce(p_progression_intent_override,'')),''));
  v_readiness text:=lower(trim(coalesce(p_readiness,'normal')));
  v_capability_rows int:=0;
  v_confident_rows int:=0;
  v_pi jsonb:='{}'::jsonb;
  v_pi_hint text:='MAINTAIN';
  v_pi_stage text:='LOW';
  v_planned_intent text;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then
    raise exception 'Cannot resolve another user session context';
  end if;

  perform public.d_ensure_week_plan(p_user_id,v_anchor,false);

  select weekly_session_target,primary_goal into v_target,v_goal
  from public.user_training_weeks
  where user_id=p_user_id and week_start=v_week;

  select i.* into v_active
  from public.user_training_plan_items i
  join public.workout_sessions ws on ws.id=i.session_id and ws.user_id=i.user_id
  where i.user_id=p_user_id
    and i.status='claimed'
    and ws.status in ('generated','in_progress')
  order by coalesce(i.claimed_at,i.updated_at) desc
  limit 1;

  if found then
    select * into v_active_session
    from public.workout_sessions
    where id=v_active.session_id;

    if v_active_session.status='in_progress'
       and v_active_session.started_local_date=v_anchor then
      return jsonb_build_object(
        'status','RESUME_EXISTING',
        'version','d1-session-context-v4-pi',
        'week_start',v_week,
        'plan_item_id',v_active.id,
        'resume_session_id',v_active.session_id,
        'focus',v_active.planned_focus,
        'target_region',v_active.planned_target_region,
        'progression_intent',v_active.planned_progression_intent,
        'started_local_date',v_active_session.started_local_date,
        'frozen_for_local_day',true,
        'reason_codes',jsonb_build_array('daily_session:resume_started_today')
      );
    end if;

    delete from public.session_stimulus_ledger
    where session_id=v_active.session_id
      and metadata_json->>'source'='phase_d_weekly_loop';

    update public.workout_sessions
    set status='abandoned',
        planning_context_json=coalesce(planning_context_json,'{}'::jsonb)||jsonb_build_object(
          'daily_refresh',jsonb_build_object(
            'released_at',now(),
            'released_for_local_date',v_anchor,
            'reason',case
              when v_active_session.status='generated' then 'new_checkin_before_start'
              else 'new_local_day_after_started_session'
            end
          )
        ),
        updated_at=now()
    where id=v_active.session_id;

    update public.user_training_plan_items
    set status=case when week_start<v_week then 'skipped' else 'available' end,
        session_id=null,
        claimed_at=null,
        updated_at=now(),
        planning_context_json=coalesce(planning_context_json,'{}'::jsonb)||jsonb_build_object(
          'daily_refresh_released_session_id',v_active.session_id,
          'daily_refresh_released_at',now()
        )
    where id=v_active.id;

    v_reasons:=array_append(v_reasons,
      case when v_active_session.status='generated'
        then 'daily_session:rebuild_for_new_checkin'
        else 'daily_session:unfreeze_new_local_day'
      end
    );
  end if;

  select directive_json into v_pi
  from public.user_coaching_directive_runtime
  where user_id=p_user_id;
  if v_pi is null then
    v_pi:=public.pi_coaching_directives(p_user_id,v_anchor,90);
  end if;
  v_pi_hint:=upper(coalesce(v_pi#>>'{session_recommendation,progression_intent_hint}','MAINTAIN'));
  v_pi_stage:=upper(coalesce(v_pi#>>'{data_maturity,stage}','LOW'));

  select count(*) into v_completed_count
  from public.workout_sessions ws
  where ws.user_id=p_user_id and ws.status='completed'
    and coalesce(ws.completed_at,ws.created_at)::date between v_week and v_week+6;

  select count(*),count(*) filter(where confidence>=0.60)
  into v_capability_rows,v_confident_rows
  from public.user_exercise_capabilities where user_id=p_user_id;

  select ws.id,ws.global_rpe,ws.post_workout_feeling,ws.target_region,ws.completed_at into v_last
  from public.workout_sessions ws
  where ws.user_id=p_user_id and ws.status='completed'
  order by coalesce(ws.completed_at,ws.updated_at) desc
  limit 1;

  if v_last.id is not null then
    select coalesce(avg(case coalesce(wse.user_execution_status,'pending')
      when 'completed' then 0 when 'adapted' then 1 else 1 end),0)
    into v_exception_ratio
    from public.workout_session_exercises wse where wse.session_id=v_last.id;
  end if;

  select i.* into v_item
  from public.user_training_plan_items i
  where i.user_id=p_user_id and i.week_start=v_week and i.status='available'
  order by case when i.recommended_date<=v_anchor then 0 else 1 end,
    i.recommended_date,i.sequence_index
  limit 1 for update;

  v_planned_intent:=upper(coalesce(v_item.planned_progression_intent,'MAINTAIN'));

  if p_focus_override in ('General Fitness','Fat Loss','Muscle Gain','Strength','Conditioning') then
    v_focus:=p_focus_override;v_reasons:=array_append(v_reasons,'focus:user_or_profile_override');
  else
    v_focus:=coalesce(v_item.planned_focus,v_goal,'General Fitness');v_reasons:=array_append(v_reasons,'focus:weekly_plan');
  end if;

  if p_target_region_override in ('Upper','Lower','Core','Full Body') then
    v_region:=p_target_region_override;v_reasons:=array_append(v_reasons,'region:user_day_preference');
  else
    v_region:=coalesce(v_item.planned_target_region,'Full Body');v_reasons:=array_append(v_reasons,'region:weekly_rotation');
  end if;

  if v_override_intent in ('PROGRESS','MAINTAIN','CONSOLIDATE','DELOAD','RECALIBRATE','EXPLORE') then
    v_intent:=v_override_intent;v_reasons:=array_append(v_reasons,'intent:explicit_override');
  elsif v_readiness in ('low','faible') then
    v_intent:='DELOAD';v_reasons:=array_append(v_reasons,'intent:low_readiness');
  elsif v_last.id is not null and coalesce(v_last.global_rpe,0)>=9 and coalesce(v_last.post_workout_feeling,10)<=4 then
    v_intent:='DELOAD';v_reasons:=array_append(v_reasons,'intent:high_rpe_low_post_feeling');
  elsif v_exception_ratio>=0.50 then
    v_intent:='RECALIBRATE';v_reasons:=array_append(v_reasons,'intent:previous_session_many_exceptions');
  elsif v_last.id is not null and (coalesce(v_last.global_rpe,0)>=9 or coalesce(v_last.post_workout_feeling,10)<=3) then
    v_intent:='CONSOLIDATE';v_reasons:=array_append(v_reasons,'intent:recovery_guard');
  elsif v_item.id is null or v_completed_count>=v_target then
    if v_readiness in ('high','olympique') and v_confident_rows>=5 then
      v_intent:='EXPLORE';v_reasons:=array_append(v_reasons,'intent:extra_session_high_readiness_explore');
    else
      v_intent:='CONSOLIDATE';v_reasons:=array_append(v_reasons,'intent:extra_session_after_week_target');
    end if;
  elsif v_capability_rows<5 and v_completed_count=0 then
    v_intent:='RECALIBRATE';v_reasons:=array_append(v_reasons,'intent:sparse_capability_evidence');
  elsif v_pi_stage in ('MEDIUM','HIGH') and v_pi_hint='RECALIBRATE' and v_planned_intent<>'CONSOLIDATE' then
    v_intent:='RECALIBRATE';v_reasons:=array_append(v_reasons,'intent:progression_intelligence_recalibrate');
  elsif v_pi_stage in ('MEDIUM','HIGH') and v_pi_hint='CONSOLIDATE' and v_planned_intent='PROGRESS' then
    v_intent:='CONSOLIDATE';v_reasons:=array_append(v_reasons,'intent:progression_intelligence_consolidate');
  else
    v_intent:=coalesce(v_item.planned_progression_intent,'MAINTAIN');
    v_reasons:=array_append(v_reasons,'intent:weekly_plan');
    if v_pi_hint='PROGRESS' then
      v_reasons:=array_append(v_reasons,'pi:progress_signal_used_as_candidate_bias');
    elsif v_pi_hint='MAINTAIN' then
      v_reasons:=array_append(v_reasons,'pi:no_strong_intent_override');
    end if;
  end if;

  return jsonb_build_object(
    'status','READY','version','d1-session-context-v4-pi','week_start',v_week,'week_end',v_week+6,
    'plan_item_id',v_item.id,'sequence_index',v_item.sequence_index,'recommended_date',v_item.recommended_date,
    'weekly_session_target',v_target,'completed_before',v_completed_count,'remaining_before',greatest(0,v_target-v_completed_count),
    'extra_session',v_item.id is null,
    'focus',v_focus,'target_region',v_region,'progression_intent',v_intent,
    'daily_refresh',jsonb_build_object('new_checkin_rebuilds_unstarted_session',true,'started_session_frozen_for_local_day_only',true),
    'capability_evidence',jsonb_build_object('rows',v_capability_rows,'confident_rows',v_confident_rows),
    'progression_intelligence',jsonb_build_object(
      'version',v_pi->>'version',
      'data_maturity',coalesce(v_pi->'data_maturity','{}'::jsonb),
      'session_recommendation',coalesce(v_pi->'session_recommendation','{}'::jsonb),
      'guardrails',coalesce(v_pi->'guardrails','{}'::jsonb)
    ),
    'previous_session',case when v_last.id is null then '{}'::jsonb else jsonb_build_object(
      'session_id',v_last.id,'global_rpe',v_last.global_rpe,'post_workout_feeling',v_last.post_workout_feeling,
      'target_region',v_last.target_region,'exception_ratio',round(v_exception_ratio,3)
    ) end,
    'reason_codes',to_jsonb(v_reasons),
    'weekly_stimulus_balance',coalesce((select jsonb_agg(jsonb_build_object(
      'stimulus_type',b.stimulus_type,'stimulus_key',b.stimulus_key,'unit',b.unit,'target_value',b.target_value,
      'planned_from_sessions',b.planned_from_sessions,'realized_value',b.realized_value,'remaining_to_target',b.remaining_to_target
    ) order by b.stimulus_type,b.stimulus_key) from public.weekly_stimulus_balance b where b.user_id=p_user_id and b.week_start=v_week),'[]'::jsonb)
  );
end;
$function$;

create or replace function public.d_generate_adaptive_session(
  p_user_id uuid,
  p_focus_override text,
  p_duration_minutes integer,
  p_readiness text,
  p_target_region_override text default null,
  p_progression_intent_override text default null,
  p_zone_terms text[] default '{}'::text[],
  p_inventory jsonb default '[]'::jsonb,
  p_available_equipment text[] default '{}'::text[],
  p_max_complexity integer default 3,
  p_max_difficulty text default 'Intermédiaire'::text,
  p_candidate_count integer default 12,
  p_policy_key text default 'c4-final-default'::text,
  p_anchor_date date default current_date
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $function$
declare
  v_context jsonb;
  v_generated jsonb;
  v_session_id uuid;
  v_plan_item_id uuid;
  v_existing jsonb;
  v_anchor date:=coalesce(p_anchor_date,current_date);
  v_pi jsonb;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;

  v_pi:=public.pi_refresh_coaching_directives(p_user_id,v_anchor,90);

  v_context:=public.d_resolve_session_context(
    p_user_id,v_anchor,p_duration_minutes,p_readiness,p_focus_override,p_target_region_override,p_progression_intent_override
  );

  if v_context->>'status'='RESUME_EXISTING' then
    select generated_workout into v_existing from public.workout_sessions
    where id=(v_context->>'resume_session_id')::uuid and user_id=p_user_id;
    return jsonb_build_object(
      'status','resume_existing','version','d1-adaptive-generation-v3-pi','session_id',(v_context->>'resume_session_id')::uuid,
      'weekly_loop',v_context,'generated_workout',coalesce(v_existing,'{}'::jsonb),
      'progression_intelligence',jsonb_build_object('frozen_session_unchanged',true,'runtime_refreshed',true)
    );
  end if;

  v_generated:=public.c4_generate_full_session(
    p_user_id,
    coalesce(v_context->>'focus',p_focus_override,'General Fitness'),
    p_duration_minutes,
    p_readiness,
    nullif(v_context->>'target_region',''),
    nullif(v_context->>'progression_intent',''),
    p_zone_terms,p_inventory,p_available_equipment,p_max_complexity,p_max_difficulty,p_candidate_count,p_policy_key
  );

  if coalesce(v_generated->>'status','')<>'generated' or nullif(v_generated->>'session_id','') is null then
    return v_generated||jsonb_build_object('weekly_loop',v_context,'version','d1-adaptive-generation-v3-pi');
  end if;

  v_session_id:=(v_generated->>'session_id')::uuid;
  v_plan_item_id:=nullif(v_context->>'plan_item_id','')::uuid;

  update public.workout_sessions set
    generation_local_date=v_anchor,
    planning_context_json=coalesce(planning_context_json,'{}'::jsonb)||jsonb_build_object(
      'weekly_loop',v_context,
      'weekly_loop_version','d1-weekly-loop-v1',
      'progression_intelligence',coalesce(v_context->'progression_intelligence','{}'::jsonb),
      'daily_refresh',jsonb_build_object('generation_local_date',v_anchor,'started_session_frozen_for_local_day_only',true)
    ),updated_at=now()
  where id=v_session_id and user_id=p_user_id;

  update public.workout_session_exercises wse
  set solver_decision_json=coalesce(wse.solver_decision_json,'{}'::jsonb)||jsonb_build_object(
    'progression_intelligence',public.pi_candidate_fit(p_user_id,wse.exercise_id,v_context->>'progression_intent')
  )
  where wse.session_id=v_session_id;

  if v_plan_item_id is not null then
    update public.user_training_plan_items set
      status='claimed',session_id=v_session_id,claimed_at=now(),updated_at=now(),
      planning_context_json=planning_context_json||jsonb_build_object(
        'claimed_session_id',v_session_id,'claimed_at',now(),'resolved_context',v_context
      )
    where id=v_plan_item_id and user_id=p_user_id and status='available';
    if not found then raise exception 'Weekly plan item could not be claimed'; end if;
  end if;

  perform public.d_sync_session_stimulus_ledger(v_session_id);

  return v_generated||jsonb_build_object(
    'version','d1-adaptive-generation-v3-pi','weekly_loop',v_context,
    'progression_intelligence',coalesce(v_context->'progression_intelligence','{}'::jsonb),
    'meta',coalesce(v_generated->'meta','{}'::jsonb)||jsonb_build_object(
      'weekly_loop',v_context,'weekly_loop_version','d1-weekly-loop-v1','generation_local_date',v_anchor,
      'progression_intelligence_version',v_pi->>'version'
    )
  );
end;
$function$;;
