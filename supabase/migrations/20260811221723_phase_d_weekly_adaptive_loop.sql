create table if not exists public.user_training_weeks (
  user_id uuid not null references public.profiles(id) on delete cascade,
  week_start date not null,
  weekly_session_target smallint not null,
  primary_goal text not null,
  status text not null default 'active',
  plan_version text not null default 'd1-weekly-loop-v1',
  context_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, week_start),
  constraint user_training_weeks_target_check check (weekly_session_target between 1 and 7),
  constraint user_training_weeks_goal_check check (primary_goal in ('General Fitness','Fat Loss','Muscle Gain','Strength','Conditioning')),
  constraint user_training_weeks_status_check check (status in ('active','closed')),
  constraint user_training_weeks_context_check check (jsonb_typeof(context_json)='object')
);

alter table public.user_training_weeks enable row level security;
drop policy if exists "Users own training weeks" on public.user_training_weeks;
create policy "Users own training weeks" on public.user_training_weeks
for all using (auth.uid()=user_id) with check (auth.uid()=user_id);

alter table public.user_training_plan_items
  add column if not exists week_start date,
  add column if not exists planned_focus text,
  add column if not exists planned_target_region text,
  add column if not exists planned_progression_intent text,
  add column if not exists planned_duration_minutes smallint,
  add column if not exists planning_context_json jsonb not null default '{}'::jsonb,
  add column if not exists claimed_at timestamptz;

alter table public.user_training_plan_items drop constraint if exists user_training_plan_items_status_check;
alter table public.user_training_plan_items add constraint user_training_plan_items_status_check
  check (status in ('available','claimed','completed','skipped'));

alter table public.user_training_plan_items drop constraint if exists user_training_plan_items_planned_focus_check;
alter table public.user_training_plan_items add constraint user_training_plan_items_planned_focus_check
  check (planned_focus is null or planned_focus in ('General Fitness','Fat Loss','Muscle Gain','Strength','Conditioning'));

alter table public.user_training_plan_items drop constraint if exists user_training_plan_items_planned_region_check;
alter table public.user_training_plan_items add constraint user_training_plan_items_planned_region_check
  check (planned_target_region is null or planned_target_region in ('Upper','Lower','Core','Full Body'));

alter table public.user_training_plan_items drop constraint if exists user_training_plan_items_planned_intent_check;
alter table public.user_training_plan_items add constraint user_training_plan_items_planned_intent_check
  check (planned_progression_intent is null or planned_progression_intent in ('PROGRESS','MAINTAIN','CONSOLIDATE','DELOAD','RECALIBRATE','EXPLORE'));

alter table public.user_training_plan_items drop constraint if exists user_training_plan_items_duration_check;
alter table public.user_training_plan_items add constraint user_training_plan_items_duration_check
  check (planned_duration_minutes is null or planned_duration_minutes between 30 and 90);

alter table public.user_training_plan_items drop constraint if exists user_training_plan_items_planning_context_check;
alter table public.user_training_plan_items add constraint user_training_plan_items_planning_context_check
  check (jsonb_typeof(planning_context_json)='object');

create unique index if not exists user_training_plan_items_week_sequence_uidx
  on public.user_training_plan_items(user_id,week_start,sequence_index)
  where week_start is not null;
create index if not exists user_training_plan_items_week_status_idx
  on public.user_training_plan_items(user_id,week_start,status,recommended_date,sequence_index);

create or replace function public.d_week_start(p_date date)
returns date
language sql
immutable
as $$
  select date_trunc('week',p_date::timestamp)::date
$$;

create or replace function public.d_primary_goal(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path=public
as $$
  select coalesce((
    select g.name
    from public.user_goals ug
    join public.goals g on g.id=ug.goal_id
    where ug.user_id=p_user_id
      and g.name in ('General Fitness','Fat Loss','Muscle Gain','Strength','Conditioning')
    order by coalesce(ug.priority,999),ug.id
    limit 1
  ),'General Fitness')
$$;

create or replace function public.d_plan_recommended_offset(p_sequence int,p_target int)
returns int
language sql
immutable
as $$
  select case
    when greatest(1,p_target)=1 then 0
    else round(((greatest(1,p_sequence)-1)::numeric*6)/(greatest(1,p_target)-1))::int
  end
$$;

create or replace function public.d_base_progression_intent(p_sequence int,p_target int)
returns text
language sql
immutable
as $$
  select case
    when greatest(1,p_sequence)>=greatest(1,p_target) then 'CONSOLIDATE'
    when mod(greatest(1,p_sequence),2)=1 then 'PROGRESS'
    else 'MAINTAIN'
  end
$$;

create or replace function public.d_base_target_region(p_goal text,p_sequence int)
returns text
language plpgsql
immutable
as $$
declare
  v_index int:=mod(greatest(1,p_sequence)-1,4);
begin
  if p_goal in ('Strength','Muscle Gain') then
    return case v_index when 0 then 'Upper' when 1 then 'Lower' when 2 then 'Full Body' else 'Upper' end;
  end if;
  if p_goal='Conditioning' then
    return case v_index when 0 then 'Full Body' when 1 then 'Lower' when 2 then 'Upper' else 'Full Body' end;
  end if;
  if p_goal='Fat Loss' then
    return case v_index when 0 then 'Full Body' when 1 then 'Lower' when 2 then 'Full Body' else 'Upper' end;
  end if;
  return case v_index when 0 then 'Full Body' when 1 then 'Upper' when 2 then 'Lower' else 'Full Body' end;
end;
$$;

create or replace function public.d_rebuild_weekly_stimulus_targets(
  p_user_id uuid,
  p_week_start date
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  r record;
  v_stim jsonb;
  v_duration numeric;
  v_count int:=0;
  v_keys text[]:=array['strength','conditioning','muscular_endurance','power','stability','mobility'];
  v_key text;
  v_score numeric;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then
    raise exception 'Cannot rebuild another user weekly targets';
  end if;

  delete from public.weekly_stimulus_targets
  where user_id=p_user_id and week_start=p_week_start;

  for r in
    select * from public.user_training_plan_items
    where user_id=p_user_id and week_start=p_week_start
    order by sequence_index
  loop
    v_duration:=coalesce(r.planned_duration_minutes,45);
    v_stim:=public.build_session_stimulus_target(
      coalesce(r.planned_focus,public.d_primary_goal(p_user_id)),
      v_duration::int,
      'normal',
      r.planned_target_region,
      r.planned_progression_intent,
      'c1-default'
    );

    foreach v_key in array v_keys loop
      v_score:=coalesce(nullif(v_stim#>>array['qualities',v_key,'score'],'')::numeric,0)*v_duration/60.0;
      insert into public.weekly_stimulus_targets(
        user_id,week_start,stimulus_type,stimulus_key,target_value,unit,context_json,updated_at
      ) values (
        p_user_id,p_week_start,'focus',v_key,v_score,'score_minute',
        jsonb_build_object('source','phase_d_weekly_plan','plan_version','d1-weekly-loop-v1'),now()
      )
      on conflict(user_id,week_start,stimulus_type,stimulus_key) do update set
        target_value=public.weekly_stimulus_targets.target_value+excluded.target_value,
        unit=excluded.unit,
        context_json=excluded.context_json,
        updated_at=now();
    end loop;
    v_count:=v_count+1;
  end loop;

  insert into public.weekly_stimulus_targets(
    user_id,week_start,stimulus_type,stimulus_key,target_value,unit,context_json,updated_at
  ) values (
    p_user_id,p_week_start,'other','sessions',v_count,'session',
    jsonb_build_object('source','phase_d_weekly_plan','plan_version','d1-weekly-loop-v1'),now()
  )
  on conflict(user_id,week_start,stimulus_type,stimulus_key) do update set
    target_value=excluded.target_value,unit=excluded.unit,context_json=excluded.context_json,updated_at=now();

  return jsonb_build_object(
    'status','OK','version','d1-weekly-targets-v1','user_id',p_user_id,'week_start',p_week_start,
    'planned_session_count',v_count
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

  -- Backfill completed sessions that existed before the weekly loop was created.
  for v_completed in
    select ws.id,ws.completed_at
    from public.workout_sessions ws
    where ws.user_id=p_user_id
      and ws.status='completed'
      and coalesce(ws.completed_at,ws.created_at)::date between v_week and v_week+6
      and not exists(
        select 1 from public.user_training_plan_items i where i.session_id=ws.id
      )
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
    'status','READY','version','d1-weekly-plan-v1','user_id',p_user_id,'week_start',v_week,
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

create or replace function public.d_week_snapshot(
  p_user_id uuid,
  p_anchor_date date default current_date
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
  v_completed int;
  v_available int;
  v_claimed int;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then
    raise exception 'Cannot inspect another user week';
  end if;
  perform public.d_ensure_week_plan(p_user_id,p_anchor_date,false);
  select weekly_session_target,primary_goal into v_target,v_goal
  from public.user_training_weeks where user_id=p_user_id and week_start=v_week;
  select count(*) filter(where status='completed'),count(*) filter(where status='available'),count(*) filter(where status='claimed')
  into v_completed,v_available,v_claimed
  from public.user_training_plan_items where user_id=p_user_id and week_start=v_week;

  return jsonb_build_object(
    'version','d1-week-snapshot-v1','week_start',v_week,'week_end',v_week+6,'primary_goal',v_goal,
    'weekly_session_target',v_target,'completed_plan_items',v_completed,'available_plan_items',v_available,'claimed_plan_items',v_claimed,
    'actual_completed_sessions',(
      select count(*) from public.workout_sessions ws where ws.user_id=p_user_id and ws.status='completed'
      and coalesce(ws.completed_at,ws.created_at)::date between v_week and v_week+6
    ),
    'items',coalesce((select jsonb_agg(to_jsonb(i) order by i.sequence_index) from public.user_training_plan_items i where i.user_id=p_user_id and i.week_start=v_week),'[]'::jsonb),
    'stimulus_balance',coalesce((select jsonb_agg(to_jsonb(b) order by b.stimulus_type,b.stimulus_key) from public.weekly_stimulus_balance b where b.user_id=p_user_id and b.week_start=v_week),'[]'::jsonb)
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
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then
    raise exception 'Cannot resolve another user session context';
  end if;
  perform public.d_ensure_week_plan(p_user_id,p_anchor_date,false);
  select weekly_session_target,primary_goal into v_target,v_goal
  from public.user_training_weeks where user_id=p_user_id and week_start=v_week;

  select i.* into v_active
  from public.user_training_plan_items i
  join public.workout_sessions ws on ws.id=i.session_id and ws.user_id=i.user_id
  where i.user_id=p_user_id and i.week_start=v_week and i.status='claimed'
    and ws.status in ('generated','in_progress')
  order by i.sequence_index
  limit 1;

  if found then
    return jsonb_build_object(
      'status','RESUME_EXISTING','version','d1-session-context-v1','week_start',v_week,
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
  order by
    case when i.recommended_date<=coalesce(p_anchor_date,current_date) then 0 else 1 end,
    i.recommended_date,i.sequence_index
  limit 1
  for update;

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
    v_intent:='CONSOLIDATE';v_reasons:=array_append(v_reasons,'intent:extra_session_after_week_target');
  else
    v_intent:=coalesce(v_item.planned_progression_intent,'MAINTAIN');v_reasons:=array_append(v_reasons,'intent:weekly_plan');
  end if;

  if v_item.id is not null and v_item.recommended_date<coalesce(p_anchor_date,current_date) then
    v_reasons:=array_append(v_reasons,'schedule:soft_reschedule_after_recommended_date');
  end if;

  return jsonb_build_object(
    'status','READY','version','d1-session-context-v1','week_start',v_week,'week_end',v_week+6,
    'plan_item_id',v_item.id,'sequence_index',v_item.sequence_index,'recommended_date',v_item.recommended_date,
    'weekly_session_target',v_target,'completed_before',v_completed_count,'remaining_before',greatest(0,v_target-v_completed_count),
    'missed_recommended_dates',v_missed,'extra_session',v_item.id is null,
    'focus',v_focus,'target_region',v_region,'progression_intent',v_intent,
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
  v_occurred timestamptz;
begin
  select * into v_session from public.workout_sessions where id=p_session_id;
  if not found then raise exception 'Session not found'; end if;
  v_user_id:=v_session.user_id;
  if auth.uid() is not null and auth.uid()<>v_user_id then
    raise exception 'Cannot sync another user session ledger';
  end if;

  v_duration:=coalesce(v_session.duration_minutes,45);
  v_occurred:=coalesce(v_session.completed_at,v_session.generated_at,v_session.created_at,now());

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
      v_user_id,p_session_id,'internal','focus',v_key,v_planned,
      case when v_factor is null then null else v_planned*v_factor end,
      'score_minute',jsonb_build_object('source','phase_d_weekly_loop','execution_factor',v_factor,'progression_intent',v_session.progression_intent),v_occurred
    );
  end loop;

  insert into public.session_stimulus_ledger(
    user_id,session_id,source_kind,stimulus_type,stimulus_key,planned_value,realized_value,unit,metadata_json,occurred_at
  ) values (
    v_user_id,p_session_id,'internal','other','sessions',1,
    case when v_session.status='completed' then 1 else null end,
    'session',jsonb_build_object('source','phase_d_weekly_loop','execution_factor',v_factor,'progression_intent',v_session.progression_intent),v_occurred
  );

  return jsonb_build_object('status','OK','version','d1-stimulus-ledger-v1','session_id',p_session_id,'execution_factor',v_factor);
end;
$$;

create or replace function public.d_finalize_weekly_session(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_session public.workout_sessions%rowtype;
  v_item_id uuid;
  v_week date;
  v_sync jsonb;
begin
  select * into v_session from public.workout_sessions where id=p_session_id;
  if not found then raise exception 'Session not found'; end if;
  if auth.uid() is not null and auth.uid()<>v_session.user_id then
    raise exception 'Cannot finalize another user weekly session';
  end if;
  if v_session.status<>'completed' then
    return jsonb_build_object('status','SKIPPED','reason','SESSION_NOT_COMPLETED','session_id',p_session_id);
  end if;
  v_week:=public.d_week_start(coalesce(v_session.completed_at,v_session.created_at)::date);

  select id into v_item_id from public.user_training_plan_items
  where user_id=v_session.user_id and session_id=p_session_id
  limit 1 for update;

  if v_item_id is not null then
    update public.user_training_plan_items set status='completed',completed_at=v_session.completed_at,updated_at=now()
    where id=v_item_id;
  end if;

  v_sync:=public.d_sync_session_stimulus_ledger(p_session_id);

  return jsonb_build_object(
    'status','OK','version','d1-finalize-weekly-session-v1','session_id',p_session_id,'plan_item_id',v_item_id,
    'week_start',v_week,'stimulus_ledger',v_sync
  );
end;
$$;

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
  p_max_difficulty text default 'Intermédiaire',
  p_candidate_count integer default 12,
  p_policy_key text default 'c4-final-default',
  p_anchor_date date default current_date
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_context jsonb;
  v_generated jsonb;
  v_session_id uuid;
  v_plan_item_id uuid;
  v_existing jsonb;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;

  v_context:=public.d_resolve_session_context(
    p_user_id,p_anchor_date,p_duration_minutes,p_readiness,p_focus_override,p_target_region_override,p_progression_intent_override
  );

  if v_context->>'status'='RESUME_EXISTING' then
    select generated_workout into v_existing from public.workout_sessions
    where id=(v_context->>'resume_session_id')::uuid and user_id=p_user_id;
    return jsonb_build_object(
      'status','resume_existing','version','d1-adaptive-generation-v1','session_id',(v_context->>'resume_session_id')::uuid,
      'weekly_loop',v_context,'generated_workout',coalesce(v_existing,'{}'::jsonb)
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
    return v_generated||jsonb_build_object('weekly_loop',v_context,'version','d1-adaptive-generation-v1');
  end if;

  v_session_id:=(v_generated->>'session_id')::uuid;
  v_plan_item_id:=nullif(v_context->>'plan_item_id','')::uuid;

  update public.workout_sessions set
    planning_context_json=coalesce(planning_context_json,'{}'::jsonb)||jsonb_build_object(
      'weekly_loop',v_context,'weekly_loop_version','d1-weekly-loop-v1'
    ),updated_at=now()
  where id=v_session_id and user_id=p_user_id;

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
    'version','d1-adaptive-generation-v1','weekly_loop',v_context,
    'meta',coalesce(v_generated->'meta','{}'::jsonb)||jsonb_build_object(
      'weekly_loop',v_context,'weekly_loop_version','d1-weekly-loop-v1'
    )
  );
end;
$$;

revoke all on function public.d_ensure_week_plan(uuid,date,boolean) from public,anon;
revoke all on function public.d_week_snapshot(uuid,date) from public,anon;
revoke all on function public.d_resolve_session_context(uuid,date,integer,text,text,text,text) from public,anon;
revoke all on function public.d_rebuild_weekly_stimulus_targets(uuid,date) from public,anon;
revoke all on function public.d_sync_session_stimulus_ledger(uuid) from public,anon;
revoke all on function public.d_finalize_weekly_session(uuid) from public,anon;
revoke all on function public.d_generate_adaptive_session(uuid,text,integer,text,text,text,text[],jsonb,text[],integer,text,integer,text,date) from public,anon;

grant execute on function public.d_ensure_week_plan(uuid,date,boolean) to authenticated;
grant execute on function public.d_week_snapshot(uuid,date) to authenticated;
grant execute on function public.d_resolve_session_context(uuid,date,integer,text,text,text,text) to authenticated;
grant execute on function public.d_finalize_weekly_session(uuid) to authenticated;
grant execute on function public.d_generate_adaptive_session(uuid,text,integer,text,text,text,text[],jsonb,text[],integer,text,integer,text,date) to authenticated;
;
