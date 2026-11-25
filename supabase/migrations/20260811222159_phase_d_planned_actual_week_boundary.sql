create or replace function public.d_sync_session_stimulus_ledger(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_session public.workout_sessions%rowtype;
  v_user_id uuid;
  v_duration numeric;
  v_factor numeric:=null;
  v_count int;
  v_key text;
  v_score numeric;
  v_planned numeric;
  v_keys text[]:=array['strength','conditioning','muscular_endurance','power','stability','mobility'];
  v_planned_at timestamptz;
  v_realized_at timestamptz;
begin
  select * into v_session from public.workout_sessions where id=p_session_id;
  if not found then raise exception 'Session not found'; end if;
  v_user_id:=v_session.user_id;
  if auth.uid() is not null and auth.uid()<>v_user_id then
    raise exception 'Cannot sync another user session ledger';
  end if;

  v_duration:=coalesce(v_session.duration_minutes,45);
  v_planned_at:=coalesce(v_session.generated_at,v_session.created_at,now());
  v_realized_at:=coalesce(v_session.completed_at,v_session.updated_at,now());

  if v_session.status='completed' then
    select count(*),coalesce(avg(case coalesce(user_execution_status,'pending')
      when 'completed' then 1.0 when 'adapted' then 0.70 when 'not_completed' then 0.0 else 0.0 end),1)
    into v_count,v_factor
    from public.workout_session_exercises where session_id=p_session_id;
    if v_count=0 then v_factor:=1; end if;
  end if;

  delete from public.session_stimulus_ledger
  where session_id=p_session_id and metadata_json->>'source'='phase_d_weekly_loop';

  foreach v_key in array v_keys loop
    v_score:=coalesce(nullif(v_session.expected_stimulus_json#>>array['qualities',v_key,'score'],'')::numeric,0);
    v_planned:=v_score*v_duration/60.0;

    insert into public.session_stimulus_ledger(
      user_id,session_id,source_kind,stimulus_type,stimulus_key,planned_value,realized_value,unit,metadata_json,occurred_at
    ) values (
      v_user_id,p_session_id,'internal','focus',v_key,v_planned,null,
      'score_minute',jsonb_build_object('source','phase_d_weekly_loop','ledger_role','planned','progression_intent',v_session.progression_intent),v_planned_at
    );

    if v_factor is not null then
      insert into public.session_stimulus_ledger(
        user_id,session_id,source_kind,stimulus_type,stimulus_key,planned_value,realized_value,unit,metadata_json,occurred_at
      ) values (
        v_user_id,p_session_id,'internal','focus',v_key,0,v_planned*v_factor,
        'score_minute',jsonb_build_object('source','phase_d_weekly_loop','ledger_role','realized','execution_factor',v_factor,'progression_intent',v_session.progression_intent),v_realized_at
      );
    end if;
  end loop;

  insert into public.session_stimulus_ledger(
    user_id,session_id,source_kind,stimulus_type,stimulus_key,planned_value,realized_value,unit,metadata_json,occurred_at
  ) values (
    v_user_id,p_session_id,'internal','other','sessions',1,null,'session',
    jsonb_build_object('source','phase_d_weekly_loop','ledger_role','planned','progression_intent',v_session.progression_intent),v_planned_at
  );

  if v_session.status='completed' then
    insert into public.session_stimulus_ledger(
      user_id,session_id,source_kind,stimulus_type,stimulus_key,planned_value,realized_value,unit,metadata_json,occurred_at
    ) values (
      v_user_id,p_session_id,'internal','other','sessions',0,1,'session',
      jsonb_build_object('source','phase_d_weekly_loop','ledger_role','realized','execution_factor',v_factor,'progression_intent',v_session.progression_intent),v_realized_at
    );
  end if;

  return jsonb_build_object(
    'status','OK','version','d1-stimulus-ledger-v2','session_id',p_session_id,'execution_factor',v_factor,
    'planned_week_start',public.d_week_start(v_planned_at::date),
    'realized_week_start',case when v_factor is null then null else public.d_week_start(v_realized_at::date) end
  );
end;
$$;

create or replace function public.d_ensure_week_plan(
  p_user_id uuid,
  p_anchor_date date default current_date,
  p_force_rebuild boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_week date:=public.d_week_start(coalesce(p_anchor_date,current_date));
  v_target int;
  v_goal text;
  v_exists boolean;
  v_seq int;
  v_offset int;
  v_completed record;
  v_item_id uuid;
  v_existing_completed int:=0;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then
    raise exception 'Cannot create another user weekly plan';
  end if;

  select least(7,greatest(1,coalesce(weekly_session_target,3)))
  into v_target from public.profiles where id=p_user_id;
  if not found then raise exception 'Profile not found'; end if;
  v_goal:=public.d_primary_goal(p_user_id);

  -- Old unclaimed intentions become explicit misses when a new week begins.
  update public.user_training_plan_items
  set status='skipped',updated_at=now(),planning_context_json=planning_context_json||jsonb_build_object('closed_by_new_week',true)
  where user_id=p_user_id and week_start<v_week and status='available';

  update public.user_training_weeks w
  set status='closed',updated_at=now()
  where w.user_id=p_user_id and w.week_start<v_week and w.status='active'
    and not exists(
      select 1 from public.user_training_plan_items i
      join public.workout_sessions ws on ws.id=i.session_id
      where i.user_id=w.user_id and i.week_start=w.week_start and i.status='claimed'
        and ws.status in ('generated','in_progress')
    );

  select exists(
    select 1 from public.user_training_weeks where user_id=p_user_id and week_start=v_week
  ) into v_exists;

  if p_force_rebuild and v_exists and not exists(
    select 1 from public.user_training_plan_items
    where user_id=p_user_id and week_start=v_week and status in ('claimed','completed')
  ) then
    delete from public.user_training_plan_items where user_id=p_user_id and week_start=v_week;
    delete from public.user_training_weeks where user_id=p_user_id and week_start=v_week;
    v_exists:=false;
  end if;

  if not v_exists then
    insert into public.user_training_weeks(
      user_id,week_start,weekly_session_target,primary_goal,status,plan_version,context_json
    ) values (
      p_user_id,v_week,v_target,v_goal,'active','d1-weekly-loop-v1',
      jsonb_build_object('created_from_anchor_date',p_anchor_date,'baseline_duration_minutes',45,'planned_not_generated',true)
    );

    for v_seq in 1..v_target loop
      v_offset:=public.d_plan_recommended_offset(v_seq,v_target);
      insert into public.user_training_plan_items(
        user_id,sequence_index,recommended_date,status,week_start,planned_focus,
        planned_target_region,planned_progression_intent,planned_duration_minutes,planning_context_json
      ) values (
        p_user_id,v_seq,v_week+v_offset,'available',v_week,v_goal,
        public.d_base_target_region(v_goal,v_seq),public.d_base_progression_intent(v_seq,v_target),45,
        jsonb_build_object('plan_version','d1-weekly-loop-v1','recommended_date_is_soft',true,'wod_pre_generated',false)
      );
    end loop;
  end if;

  for v_completed in
    select ws.id,ws.completed_at
    from public.workout_sessions ws
    where ws.user_id=p_user_id
      and ws.status='completed'
      and coalesce(ws.completed_at,ws.created_at)::date between v_week and v_week+6
      and not exists(select 1 from public.user_training_plan_items i where i.session_id=ws.id)
    order by coalesce(ws.completed_at,ws.created_at),ws.id
  loop
    select id into v_item_id
    from public.user_training_plan_items
    where user_id=p_user_id and week_start=v_week and status='available'
    order by sequence_index
    limit 1
    for update;
    exit when v_item_id is null;
    update public.user_training_plan_items set
      status='completed',session_id=v_completed.id,completed_at=v_completed.completed_at,
      claimed_at=coalesce(claimed_at,v_completed.completed_at),updated_at=now(),
      planning_context_json=planning_context_json||jsonb_build_object('backfilled_existing_session',true)
    where id=v_item_id;
    v_existing_completed:=v_existing_completed+1;
    v_item_id:=null;
  end loop;

  perform public.d_rebuild_weekly_stimulus_targets(p_user_id,v_week);

  return jsonb_build_object(
    'status','READY','version','d1-weekly-plan-v2','user_id',p_user_id,'week_start',v_week,
    'weekly_session_target',(select weekly_session_target from public.user_training_weeks where user_id=p_user_id and week_start=v_week),
    'primary_goal',(select primary_goal from public.user_training_weeks where user_id=p_user_id and week_start=v_week),
    'backfilled_completed_sessions',v_existing_completed,
    'items',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',i.id,'sequence_index',i.sequence_index,'recommended_date',i.recommended_date,'status',i.status,
        'session_id',i.session_id,'planned_focus',i.planned_focus,'planned_target_region',i.planned_target_region,
        'planned_progression_intent',i.planned_progression_intent,'planned_duration_minutes',i.planned_duration_minutes,
        'planning_context',i.planning_context_json
      ) order by i.sequence_index)
      from public.user_training_plan_items i where i.user_id=p_user_id and i.week_start=v_week
    ),'[]'::jsonb)
  );
end;
$$;

create or replace function public.d_resolve_session_context(
  p_user_id uuid,
  p_anchor_date date default current_date,
  p_duration_minutes int default 45,
  p_readiness text default 'normal',
  p_focus_override text default null,
  p_target_region_override text default null,
  p_progression_intent_override text default null
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_week date:=public.d_week_start(coalesce(p_anchor_date,current_date));
  v_target int;
  v_goal text;
  v_item public.user_training_plan_items%rowtype;
  v_active public.user_training_plan_items%rowtype;
  v_completed_count int;
  v_last record;
  v_exception_ratio numeric:=0;
  v_intent text;
  v_focus text;
  v_region text;
  v_reasons text[]:='{}'::text[];
  v_override_intent text:=upper(nullif(trim(coalesce(p_progression_intent_override,'')),''));
  v_readiness text:=lower(trim(coalesce(p_readiness,'normal')));
  v_missed int:=0;
  v_capability_rows int:=0;
  v_confident_rows int:=0;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then
    raise exception 'Cannot resolve another user session context';
  end if;
  perform public.d_ensure_week_plan(p_user_id,p_anchor_date,false);
  select weekly_session_target,primary_goal into v_target,v_goal
  from public.user_training_weeks where user_id=p_user_id and week_start=v_week;

  -- Resume an already generated UGEROD session even if it was claimed at the end of the previous week.
  select i.* into v_active
  from public.user_training_plan_items i
  join public.workout_sessions ws on ws.id=i.session_id and ws.user_id=i.user_id
  where i.user_id=p_user_id and i.status='claimed' and ws.status in ('generated','in_progress')
  order by coalesce(i.claimed_at,i.updated_at) desc
  limit 1;

  if found then
    return jsonb_build_object(
      'status','RESUME_EXISTING','version','d1-session-context-v2','week_start',v_week,
      'plan_item_id',v_active.id,'resume_session_id',v_active.session_id,
      'focus',v_active.planned_focus,'target_region',v_active.planned_target_region,
      'progression_intent',v_active.planned_progression_intent,
      'reason_codes',jsonb_build_array('weekly_loop:resume_claimed_session')
    );
  end if;

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
  order by case when i.recommended_date<=coalesce(p_anchor_date,current_date) then 0 else 1 end,
    i.recommended_date,i.sequence_index
  limit 1 for update;

  select count(*) into v_missed from public.user_training_plan_items i
  where i.user_id=p_user_id and i.week_start=v_week and i.status='available'
    and i.recommended_date<coalesce(p_anchor_date,current_date);

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
  else
    v_intent:=coalesce(v_item.planned_progression_intent,'MAINTAIN');v_reasons:=array_append(v_reasons,'intent:weekly_plan');
  end if;

  if v_item.id is not null and v_item.recommended_date<coalesce(p_anchor_date,current_date) then
    v_reasons:=array_append(v_reasons,'schedule:soft_reschedule_after_recommended_date');
  end if;

  return jsonb_build_object(
    'status','READY','version','d1-session-context-v2','week_start',v_week,'week_end',v_week+6,
    'plan_item_id',v_item.id,'sequence_index',v_item.sequence_index,'recommended_date',v_item.recommended_date,
    'weekly_session_target',v_target,'completed_before',v_completed_count,'remaining_before',greatest(0,v_target-v_completed_count),
    'missed_recommended_dates',v_missed,'extra_session',v_item.id is null,
    'focus',v_focus,'target_region',v_region,'progression_intent',v_intent,
    'capability_evidence',jsonb_build_object('rows',v_capability_rows,'confident_rows',v_confident_rows),
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
$$;
;
