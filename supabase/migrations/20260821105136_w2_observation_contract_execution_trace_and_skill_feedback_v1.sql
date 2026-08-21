create table if not exists public.observation_provenance_catalog (
  observation_key text primary key,
  acquisition_class text not null check (acquisition_class in ('AUTOMATIC','SAFE_DERIVATION','ASK_IF_DECISION_RELEVANT','NEVER_INFER')),
  confidence_class text not null,
  source_of_truth text not null,
  consumer text,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.observation_provenance_catalog enable row level security;
drop policy if exists observation_provenance_catalog_read on public.observation_provenance_catalog;
create policy observation_provenance_catalog_read on public.observation_provenance_catalog
for select to authenticated using (true);
revoke all on public.observation_provenance_catalog from anon;
grant select on public.observation_provenance_catalog to authenticated;

insert into public.observation_provenance_catalog(observation_key,acquisition_class,confidence_class,source_of_truth,consumer,notes)
values
('session.prescription','AUTOMATIC','AUTHORITATIVE','workout_session_exercises.prescription_json','execution + observation','Structured prescription is known by UGEROD.'),
('session.equipment','AUTOMATIC','AUTHORITATIVE','workout_sessions.available_equipment','generation','Equipment selected for the session is already known.'),
('session.swap','AUTOMATIC','AUTHORITATIVE','workout_session_swap_history','generation + feedback','Swap and undo are observed actions.'),
('wod.controlled_elapsed','AUTOMATIC','CONTROLLED_WINDOW','UGEROD protocol player','protocol capability','Only explicit player start/pause/resume/finish windows are sports timing.'),
('wod.round_split','AUTOMATIC','CONTROLLED_INTERACTION','UGEROD protocol player round completion','pacing context','A split exists only when a round completion is observed.'),
('skill.prescription_fulfilled','SAFE_DERIVATION','STRUCTURED_PRESCRIPTION_CONFIRMED','completed Skill + exact prescription','capability context','Records exactly the prescribed target, never extra performance.'),
('skill.technical_quality','ASK_IF_DECISION_RELEVANT','USER_QUALITATIVE','user feedback','skill path progression gate','Asked only when it can alter an upcoming Skill progression decision.'),
('exercise.load_kg','NEVER_INFER','USER_EXPLICIT','user load input or explicit selected load','strength capability','Load is never inferred from level or prescription unless explicitly selected by the user.'),
('pain.discomfort','NEVER_INFER','USER_EXPLICIT','check-in or explicit in-session feedback','safety','Pain cannot be inferred from performance.'),
('uncontrolled.wall_clock','NEVER_INFER','INVALID_FOR_PERFORMANCE','none','none','Time spent between screens or blocks is never sports performance.')
on conflict (observation_key) do update set
acquisition_class=excluded.acquisition_class,
confidence_class=excluded.confidence_class,
source_of_truth=excluded.source_of_truth,
consumer=excluded.consumer,
notes=excluded.notes,
active=true;

create table if not exists public.observation_question_catalog (
  question_key text primary key,
  enabled boolean not null default true,
  ask_policy text not null,
  required boolean not null default false,
  consumer_key text not null,
  question_text text,
  options_json jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.observation_question_catalog enable row level security;
drop policy if exists observation_question_catalog_read on public.observation_question_catalog;
create policy observation_question_catalog_read on public.observation_question_catalog
for select to authenticated using (true);
revoke all on public.observation_question_catalog from anon;
grant select on public.observation_question_catalog to authenticated;

insert into public.observation_question_catalog(question_key,enabled,ask_policy,required,consumer_key,question_text,options_json)
values
('GLOBAL_RPE',true,'ALWAYS_AFTER_COMPLETED_SESSION',true,'program_coach_recent_load + d_resolve_session_context + pi_progression_snapshot','À quel point cette séance t’a semblé difficile ?','[]'::jsonb),
('POST_WORKOUT_FEELING',true,'ALWAYS_AFTER_COMPLETED_SESSION',true,'program_coach_recent_load + load_pressure + d_resolve_session_context','Comment tu te sens juste après l’entraînement ?','[]'::jsonb),
('SKILL_TECHNICAL_QUALITY',true,'ONLY_WHEN_SKILL_PROGRESSION_DECISION_IS_PENDING',false,'skill_path_progression_gate','Sur le Skill, ta technique était…','["PROPRE","LIMITE","PAS_ENCORE"]'::jsonb),
('BLOCK_DIFFICULTY',false,'ONLY_IF_BLOCK_LOCALIZATION_CHANGES_COACH_DECISION',false,'performance_context_localization','Qu’est-ce qui t’a principalement sollicité aujourd’hui ?','["SKILL","WOD","ENSEMBLE"]'::jsonb),
('ADAPTATION_REASON',true,'ONLY_FOR_ADAPTED_OR_NOT_COMPLETED_EXERCISE',false,'safety + swap_feedback + context','Pourquoi as-tu adapté ou arrêté cet exercice ?','[]'::jsonb),
('LOAD_CONFIRMATION',true,'ONLY_WHEN_LOAD_NOT_ALREADY_EXPLICIT',false,'strength capability','Charge utilisée','[]'::jsonb)
on conflict (question_key) do update set
enabled=excluded.enabled,ask_policy=excluded.ask_policy,required=excluded.required,
consumer_key=excluded.consumer_key,question_text=excluded.question_text,options_json=excluded.options_json,updated_at=now();

create table if not exists public.session_execution_events (
  id bigint generated by default as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null references public.workout_sessions(id) on delete cascade,
  session_exercise_id uuid references public.workout_session_exercises(id) on delete cascade,
  event_type text not null,
  block_key text,
  occurred_at timestamptz not null default now(),
  recorded_at timestamptz not null default now(),
  source text not null default 'backend_authoritative',
  payload_json jsonb not null default '{}'::jsonb,
  idempotency_key text,
  trace_only boolean not null default true
);
create unique index if not exists session_execution_events_idempotency_uq
on public.session_execution_events(session_id,idempotency_key) where idempotency_key is not null;
create index if not exists session_execution_events_session_time_idx
on public.session_execution_events(session_id,occurred_at,id);

alter table public.session_execution_events enable row level security;
drop policy if exists session_execution_events_select_own on public.session_execution_events;
create policy session_execution_events_select_own on public.session_execution_events
for select to authenticated using (auth.uid()=user_id);
drop policy if exists session_execution_events_insert_own on public.session_execution_events;
create policy session_execution_events_insert_own on public.session_execution_events
for insert to authenticated with check (
  auth.uid()=user_id and exists(select 1 from public.workout_sessions ws where ws.id=session_id and ws.user_id=auth.uid())
);
revoke all on public.session_execution_events from anon;
grant select,insert on public.session_execution_events to authenticated;
grant usage,select on sequence public.session_execution_events_id_seq to authenticated;

create or replace function public.record_session_execution_event_v1(
  p_session_id uuid,
  p_event_type text,
  p_payload jsonb default '{}'::jsonb,
  p_source text default 'user_action',
  p_session_exercise_id uuid default null,
  p_block_key text default null,
  p_occurred_at timestamptz default now(),
  p_idempotency_key text default null
) returns jsonb
language plpgsql
set search_path=public
as $$
declare v_user_id uuid:=auth.uid(); v_id bigint;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if not exists(select 1 from public.workout_sessions ws where ws.id=p_session_id and ws.user_id=v_user_id) then raise exception 'Session not found'; end if;
  if p_session_exercise_id is not null and not exists(select 1 from public.workout_session_exercises w where w.id=p_session_exercise_id and w.session_id=p_session_id) then raise exception 'Exercise instance does not belong to session'; end if;
  if p_idempotency_key is not null then
    select id into v_id from public.session_execution_events where session_id=p_session_id and idempotency_key=p_idempotency_key;
    if v_id is not null then return jsonb_build_object('status','EXISTS','event_id',v_id); end if;
  end if;
  insert into public.session_execution_events(user_id,session_id,session_exercise_id,event_type,block_key,occurred_at,source,payload_json,idempotency_key)
  values(v_user_id,p_session_id,p_session_exercise_id,upper(trim(p_event_type)),p_block_key,coalesce(p_occurred_at,now()),coalesce(nullif(p_source,''),'user_action'),coalesce(p_payload,'{}'::jsonb),p_idempotency_key)
  returning id into v_id;
  return jsonb_build_object('status','RECORDED','event_id',v_id);
exception when unique_violation then
  select id into v_id from public.session_execution_events where session_id=p_session_id and idempotency_key=p_idempotency_key;
  return jsonb_build_object('status','EXISTS','event_id',v_id);
end; $$;
revoke all on function public.record_session_execution_event_v1(uuid,text,jsonb,text,uuid,text,timestamptz,text) from public,anon;
grant execute on function public.record_session_execution_event_v1(uuid,text,jsonb,text,uuid,text,timestamptz,text) to authenticated,service_role;

create or replace function public.w2_trace_session_state_v1() returns trigger
language plpgsql security definer set search_path=public
as $$
begin
  if old.started_at is null and new.started_at is not null then
    insert into public.session_execution_events(user_id,session_id,event_type,occurred_at,source,idempotency_key,payload_json)
    values(new.user_id,new.id,'SESSION_START',new.started_at,'backend_authoritative','session_start',jsonb_build_object('status',new.status)) on conflict do nothing;
  end if;
  if old.wod_revealed_at is null and new.wod_revealed_at is not null then
    insert into public.session_execution_events(user_id,session_id,event_type,occurred_at,source,idempotency_key)
    values(new.user_id,new.id,'WOD_REVEAL',new.wod_revealed_at,'backend_authoritative','wod_reveal') on conflict do nothing;
  end if;
  if old.wod_started_at is null and new.wod_started_at is not null then
    insert into public.session_execution_events(user_id,session_id,event_type,occurred_at,source,idempotency_key)
    values(new.user_id,new.id,'WOD_START',new.wod_started_at,'backend_authoritative','wod_start') on conflict do nothing;
  end if;
  if old.status is distinct from new.status and new.status='completed' then
    insert into public.session_execution_events(user_id,session_id,event_type,occurred_at,source,idempotency_key,payload_json)
    values(new.user_id,new.id,'SESSION_COMPLETE',coalesce(new.completed_at,now()),'backend_authoritative','session_complete',jsonb_build_object('global_rpe',new.global_rpe,'post_workout_feeling',new.post_workout_feeling)) on conflict do nothing;
  end if;
  return new;
end; $$;
revoke all on function public.w2_trace_session_state_v1() from public,anon,authenticated;

drop trigger if exists trg_w2_trace_session_state on public.workout_sessions;
create trigger trg_w2_trace_session_state after update on public.workout_sessions
for each row execute function public.w2_trace_session_state_v1();

create or replace function public.w2_trace_exercise_state_v1() returns trigger
language plpgsql security definer set search_path=public
as $$
declare v_user_id uuid;
begin
  select user_id into v_user_id from public.workout_sessions where id=new.session_id;
  if old.user_execution_status is distinct from new.user_execution_status and coalesce(new.user_execution_status,'pending')<>'pending' then
    insert into public.session_execution_events(user_id,session_id,session_exercise_id,event_type,block_key,occurred_at,source,idempotency_key,payload_json)
    values(v_user_id,new.session_id,new.id,'EXERCISE_'||upper(new.user_execution_status),new.block_key,now(),'backend_authoritative','exercise_status:'||new.id::text,
      jsonb_strip_nulls(jsonb_build_object('exercise_id',new.exercise_id,'status',new.user_execution_status,'reason',new.execution_reason_code))) on conflict do nothing;
  end if;
  if old.weight_kg is distinct from new.weight_kg and new.weight_kg is not null then
    insert into public.session_execution_events(user_id,session_id,session_exercise_id,event_type,block_key,occurred_at,source,idempotency_key,payload_json)
    values(v_user_id,new.session_id,new.id,'LOAD_CONFIRMED',new.block_key,now(),'backend_authoritative','final_load:'||new.id::text,
      jsonb_build_object('weight_kg',new.weight_kg,'provenance','USER_EXPLICIT_OR_CONFIRMED')) on conflict do nothing;
  end if;
  return new;
end; $$;
revoke all on function public.w2_trace_exercise_state_v1() from public,anon,authenticated;

drop trigger if exists trg_w2_trace_exercise_state on public.workout_session_exercises;
create trigger trg_w2_trace_exercise_state after update on public.workout_session_exercises
for each row execute function public.w2_trace_exercise_state_v1();

create or replace function public.w2_trace_swap_state_v1() returns trigger
language plpgsql security definer set search_path=public
as $$
begin
  if tg_op='INSERT' then
    insert into public.session_execution_events(user_id,session_id,session_exercise_id,event_type,occurred_at,source,idempotency_key,payload_json)
    values(new.user_id,new.session_id,new.session_exercise_id,'SWAP',coalesce(new.created_at,now()),'backend_authoritative','swap:'||new.id::text,
      jsonb_build_object('from_exercise_id',new.from_exercise_id,'to_exercise_id',new.to_exercise_id,'direction',new.direction)) on conflict do nothing;
  elsif old.undone_at is null and new.undone_at is not null then
    insert into public.session_execution_events(user_id,session_id,session_exercise_id,event_type,occurred_at,source,idempotency_key,payload_json)
    values(new.user_id,new.session_id,new.session_exercise_id,'UNDO_SWAP',new.undone_at,'backend_authoritative','undo_swap:'||new.id::text,
      jsonb_build_object('from_exercise_id',new.from_exercise_id,'to_exercise_id',new.to_exercise_id)) on conflict do nothing;
  end if;
  return new;
end; $$;
revoke all on function public.w2_trace_swap_state_v1() from public,anon,authenticated;

drop trigger if exists trg_w2_trace_swap_insert on public.workout_session_swap_history;
create trigger trg_w2_trace_swap_insert after insert on public.workout_session_swap_history
for each row execute function public.w2_trace_swap_state_v1();
drop trigger if exists trg_w2_trace_swap_update on public.workout_session_swap_history;
create trigger trg_w2_trace_swap_update after update of undone_at on public.workout_session_swap_history
for each row execute function public.w2_trace_swap_state_v1();

create or replace function public.w2_enrich_completion_payload_v1(p_session_id uuid,p_exercises jsonb)
returns jsonb language plpgsql set search_path=public
as $$
declare
  v_out jsonb:='[]'::jsonb; v_item jsonb; v_wse public.workout_session_exercises%rowtype; v_id uuid;
  v_pres jsonb; v_actual jsonb; v_sets int; v_target numeric; v_family text; v_total numeric; v_exec text;
begin
  for v_item in select value from jsonb_array_elements(coalesce(p_exercises,'[]'::jsonb)) loop
    begin v_id=(v_item->>'session_exercise_id')::uuid; exception when others then v_out=v_out||jsonb_build_array(v_item); continue; end;
    select * into v_wse from public.workout_session_exercises where id=v_id and session_id=p_session_id;
    if not found then v_out=v_out||jsonb_build_array(v_item); continue; end if;
    v_exec=lower(coalesce(v_item->>'user_execution_status',''));
    v_pres=coalesce(v_wse.prescription_json,'{}'::jsonb);
    if lower(coalesce(v_wse.block_key,''))='skill'
       and v_exec='completed'
       and upper(coalesce(v_pres->>'skill_objective_type',''))<>'TEST'
       and not coalesce((v_pres->>'test_score_required')::boolean,false)
    then
      v_sets=greatest(1,coalesce(nullif(v_pres->>'sets','')::int,1));
      v_family=lower(coalesce(v_pres->>'capability_family',''));
      v_actual=coalesce(v_item->'performance_actual_json','{}'::jsonb);
      if nullif(v_item->>'reps_completed','') is null and v_family='reps' and nullif(v_pres->>'execution_target_reps','') is not null then
        v_target=(v_pres->>'execution_target_reps')::numeric; v_total=v_target*v_sets;
        v_item=v_item||jsonb_build_object('reps_completed',round(v_total)::int);
        v_actual=v_actual||jsonb_strip_nulls(jsonb_build_object('performance_source','prescription_fulfilled_one_click','measurement_kind','prescription_fulfilled','independent_measurement',false,'prescription_fulfilled',true,'prescribed_sets',v_sets,'prescribed_reps_per_set',v_target,'session_total_prescribed_reps',v_total,'capability_reps',v_target,'capability_observation_unit','per_set_prescription_fulfilled','side_semantics',v_pres->>'reps_semantics','provenance_class','SAFE_DERIVATION'));
      elsif nullif(v_item->>'duration_seconds','') is null and v_family='time' and nullif(v_pres->>'execution_target_duration_seconds','') is not null then
        v_target=(v_pres->>'execution_target_duration_seconds')::numeric; v_total=v_target*v_sets;
        v_item=v_item||jsonb_build_object('duration_seconds',round(v_total)::int);
        v_actual=v_actual||jsonb_strip_nulls(jsonb_build_object('performance_source','prescription_fulfilled_one_click','measurement_kind','prescription_fulfilled','independent_measurement',false,'prescription_fulfilled',true,'prescribed_sets',v_sets,'prescribed_duration_seconds_per_set',v_target,'session_total_prescribed_duration_seconds',v_total,'capability_duration_seconds',v_target,'capability_observation_unit','per_set_prescription_fulfilled','provenance_class','SAFE_DERIVATION'));
      elsif nullif(v_item->>'distance_meters','') is null and v_family='distance' and nullif(v_pres->>'execution_target_distance_meters','') is not null then
        v_target=(v_pres->>'execution_target_distance_meters')::numeric; v_total=v_target*v_sets;
        v_item=v_item||jsonb_build_object('distance_meters',v_total);
        v_actual=v_actual||jsonb_strip_nulls(jsonb_build_object('performance_source','prescription_fulfilled_one_click','measurement_kind','prescription_fulfilled','independent_measurement',false,'prescription_fulfilled',true,'prescribed_sets',v_sets,'prescribed_distance_meters_per_set',v_target,'session_total_prescribed_distance_meters',v_total,'capability_distance_meters',v_target,'capability_observation_unit','per_set_prescription_fulfilled','provenance_class','SAFE_DERIVATION'));
      end if;
      if v_actual<>'{}'::jsonb then v_item=v_item||jsonb_build_object('performance_actual_json',v_actual); end if;
    end if;
    v_out=v_out||jsonb_build_array(v_item);
  end loop;
  return v_out;
end; $$;
revoke all on function public.w2_enrich_completion_payload_v1(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.w2_enrich_completion_payload_v1(uuid,jsonb) to service_role;

create or replace function public.w2_ingest_protocol_execution_events_v1(p_session_id uuid,p_outcome jsonb)
returns integer language plpgsql security definer set search_path=public
as $$
declare v_user_id uuid; v_event jsonb; v_count int:=0; v_key text;
begin
  if p_outcome is null or jsonb_typeof(coalesce(p_outcome->'execution_events','[]'::jsonb))<>'array' then return 0; end if;
  select user_id into v_user_id from public.workout_sessions where id=p_session_id;
  if v_user_id is null then return 0; end if;
  for v_event in select value from jsonb_array_elements(coalesce(p_outcome->'execution_events','[]'::jsonb)) loop
    v_key=nullif(v_event->>'idempotency_key','');
    begin
      insert into public.session_execution_events(user_id,session_id,event_type,block_key,occurred_at,source,payload_json,idempotency_key)
      values(v_user_id,p_session_id,upper(coalesce(v_event->>'event_type','PLAYER_EVENT')),'wod',coalesce(nullif(v_event->>'occurred_at','')::timestamptz,now()),'ugerod_player',coalesce(v_event->'payload','{}'::jsonb),v_key);
      v_count=v_count+1;
    exception when unique_violation then null; end;
  end loop;
  return v_count;
end; $$;
revoke all on function public.w2_ingest_protocol_execution_events_v1(uuid,jsonb) from public,anon,authenticated;

create or replace function public.complete_workout_session_v2(p_session_id uuid,p_global_rpe integer,p_post_workout_feeling integer,p_notes text default null,p_exercises jsonb default '[]'::jsonb,p_protocol_outcome jsonb default null)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare
  v_result jsonb; v_item jsonb; v_instance_id uuid; v_extra jsonb; v_augmented int:=0; v_user_id uuid; v_intent_sync jsonb:='{}'::jsonb; v_working jsonb; v_events int:=0;
begin
  v_working:=public.w2_enrich_completion_payload_v1(p_session_id,p_exercises);
  v_result:=public.complete_workout_session_v1(p_session_id,p_global_rpe,p_post_workout_feeling,p_notes,v_working,p_protocol_outcome);
  for v_item in select value from jsonb_array_elements(coalesce(v_working,'[]'::jsonb)) loop
    begin v_instance_id:=(v_item->>'session_exercise_id')::uuid; exception when others then continue; end;
    v_extra:=coalesce(v_item->'performance_actual_json','{}'::jsonb);
    if jsonb_typeof(v_extra)='object' and v_extra<>'{}'::jsonb then
      update public.exercise_logs
      set actual_json=jsonb_strip_nulls(coalesce(actual_json,'{}'::jsonb)||v_extra||jsonb_build_object('performance_actual_contract','m7.2-v1')),
          comparison_context_json=coalesce(comparison_context_json,'{}'::jsonb)||jsonb_build_object('performance_actual_contract','m7.2-v1','provenance_class',v_extra->>'provenance_class')
      where session_id=p_session_id and session_exercise_id=v_instance_id and source_kind='internal';
      if found then v_augmented:=v_augmented+1; end if;
    end if;
  end loop;
  v_events:=public.w2_ingest_protocol_execution_events_v1(p_session_id,p_protocol_outcome);
  select user_id into v_user_id from public.workout_sessions where id=p_session_id;
  if v_user_id is not null then v_intent_sync:=public.resolve_uncovered_pattern_intents_v1(v_user_id,p_session_id); end if;
  return v_result||jsonb_build_object('completion_contract','w2-observation-completion-v1','performance_actual_rows_augmented',v_augmented,'execution_trace_events_ingested',v_events,'uncovered_pattern_intent_sync',v_intent_sync);
end; $$;

create table if not exists public.user_skill_technical_feedback (
  id bigint generated by default as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null references public.workout_sessions(id) on delete cascade,
  session_exercise_id uuid not null references public.workout_session_exercises(id) on delete cascade,
  exercise_id text not null references public.exercises(id),
  skill_path_key text,
  feedback text not null check (feedback in ('PROPRE','LIMITE','PAS_ENCORE')),
  created_at timestamptz not null default now(),
  unique(session_exercise_id)
);
create index if not exists user_skill_technical_feedback_user_exercise_idx on public.user_skill_technical_feedback(user_id,exercise_id,created_at desc);
alter table public.user_skill_technical_feedback enable row level security;
drop policy if exists user_skill_technical_feedback_select_own on public.user_skill_technical_feedback;
create policy user_skill_technical_feedback_select_own on public.user_skill_technical_feedback for select to authenticated using(auth.uid()=user_id);
revoke all on public.user_skill_technical_feedback from anon;
grant select on public.user_skill_technical_feedback to authenticated;

create or replace function public.w2_session_question_need_v1(p_session_id uuid,p_question_key text)
returns jsonb language plpgsql stable security definer set search_path=public
as $$
declare v_user uuid:=auth.uid(); v_cfg public.observation_question_catalog%rowtype; v_wse record; v_raw_rec text; v_should boolean:=false; v_reason text:='NOT_APPLICABLE';
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if not exists(select 1 from public.workout_sessions where id=p_session_id and user_id=v_user and status='completed') then return jsonb_build_object('should_ask',false,'reason','SESSION_NOT_COMPLETED'); end if;
  select * into v_cfg from public.observation_question_catalog where question_key=upper(p_question_key);
  if not found or not v_cfg.enabled then return jsonb_build_object('should_ask',false,'reason','QUESTION_DISABLED'); end if;
  if v_cfg.question_key='SKILL_TECHNICAL_QUALITY' then
    select w.id,w.exercise_id,w.prescription_json,w.user_execution_status into v_wse
    from public.workout_session_exercises w
    where w.session_id=p_session_id and lower(w.block_key)='skill' and w.user_execution_status='completed'
      and upper(coalesce(w.prescription_json->>'skill_objective_type',''))<>'TEST'
      and nullif(w.prescription_json->>'skill_path_key','') is not null
    order by w.position limit 1;
    if not found then v_reason='NO_ELIGIBLE_COMPLETED_SKILL';
    elsif exists(select 1 from public.user_skill_technical_feedback f where f.session_exercise_id=v_wse.id) then v_reason='ALREADY_ANSWERED';
    else
      select upper(coalesce(recommendation,'')) into v_raw_rec from public.user_exercise_progress where user_id=v_user and exercise_id=v_wse.exercise_id limit 1;
      if v_raw_rec in ('PROGRESS_RECOMMENDED','PROGRESS_POSSIBLE') then v_should=true; v_reason='SKILL_PROGRESSION_DECISION_PENDING';
      else v_reason='NO_PROGRESSION_DECISION_PENDING'; end if;
    end if;
    return jsonb_build_object('should_ask',v_should,'reason',v_reason,'question_key',v_cfg.question_key,'question_text',v_cfg.question_text,'options',v_cfg.options_json,'consumer_key',v_cfg.consumer_key,'session_exercise_id',v_wse.id,'exercise_id',v_wse.exercise_id,'skill_path_key',v_wse.prescription_json->>'skill_path_key');
  end if;
  return jsonb_build_object('should_ask',false,'reason','NO_DYNAMIC_GATE_REQUIRED','question_key',v_cfg.question_key,'consumer_key',v_cfg.consumer_key);
end; $$;
revoke all on function public.w2_session_question_need_v1(uuid,text) from public,anon;
grant execute on function public.w2_session_question_need_v1(uuid,text) to authenticated,service_role;

create or replace function public.w2_submit_skill_technical_feedback_v1(p_session_exercise_id uuid,p_feedback text)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare v_user uuid:=auth.uid(); v_wse record; v_value text:=upper(trim(p_feedback)); v_id bigint;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if v_value not in ('PROPRE','LIMITE','PAS_ENCORE') then raise exception 'Invalid feedback'; end if;
  select w.id,w.session_id,w.exercise_id,w.prescription_json into v_wse
  from public.workout_session_exercises w join public.workout_sessions s on s.id=w.session_id
  where w.id=p_session_exercise_id and s.user_id=v_user and s.status='completed' and lower(w.block_key)='skill' and w.user_execution_status='completed';
  if not found then raise exception 'Eligible completed Skill not found'; end if;
  insert into public.user_skill_technical_feedback(user_id,session_id,session_exercise_id,exercise_id,skill_path_key,feedback)
  values(v_user,v_wse.session_id,v_wse.id,v_wse.exercise_id,v_wse.prescription_json->>'skill_path_key',v_value)
  on conflict(session_exercise_id) do update set feedback=excluded.feedback,created_at=now()
  returning id into v_id;
  insert into public.session_execution_events(user_id,session_id,session_exercise_id,event_type,block_key,source,payload_json,idempotency_key)
  values(v_user,v_wse.session_id,v_wse.id,'SKILL_TECHNICAL_FEEDBACK','skill','user_action',jsonb_build_object('feedback',v_value,'exercise_id',v_wse.exercise_id),'skill_feedback:'||v_wse.id::text)
  on conflict(session_id,idempotency_key) where idempotency_key is not null do update set payload_json=excluded.payload_json,occurred_at=now(),recorded_at=now();
  return jsonb_build_object('status','RECORDED','feedback_id',v_id,'feedback',v_value,'decision_effect',case when v_value='PROPRE' then 'NO_AUTOMATIC_PROMOTION' when v_value='LIMITE' then 'HOLD_DIRECT_PROGRESSION' else 'RETURN_TO_LEARN' end);
end; $$;
revoke all on function public.w2_submit_skill_technical_feedback_v1(uuid,text) from public,anon;
grant execute on function public.w2_submit_skill_technical_feedback_v1(uuid,text) to authenticated,service_role;

create or replace view public.user_exercise_coach_state as
with latest_skill_feedback as (
  select distinct on (user_id,exercise_id) user_id,exercise_id,feedback,created_at
  from public.user_skill_technical_feedback
  order by user_id,exercise_id,created_at desc
)
select
  coalesce(p.user_id,c.user_id) as user_id,
  coalesce(p.exercise_id,c.exercise_id) as exercise_id,
  p.exposure_count,p.completed_count,p.skipped_count,p.avg_rpe,p.last_rpe,p.rpe_trend,p.adherence_score,p.performance_trend,p.consistency_score,p.mastery_score,p.state,
  case
    when sf.feedback='PAS_ENCORE' and sf.created_at>=greatest(coalesce(p.last_observed_at,'epoch'::timestamptz),coalesce(c.last_observed_at,'epoch'::timestamptz)) and upper(coalesce(p.recommendation,'')) in ('PROGRESS_RECOMMENDED','PROGRESS_POSSIBLE') then 'LEARN'
    when sf.feedback='LIMITE' and sf.created_at>=greatest(coalesce(p.last_observed_at,'epoch'::timestamptz),coalesce(c.last_observed_at,'epoch'::timestamptz)) and upper(coalesce(p.recommendation,''))='PROGRESS_RECOMMENDED' then 'PROGRESS_POSSIBLE'
    else p.recommendation
  end as recommendation,
  p.performance_score,p.performance_confidence,p.mastery_confidence,p.overall_confidence,p.best_performance_json,p.current_performance_json,p.performance_delta,
  c.reps_envelope,c.load_envelope,c.time_envelope,c.distance_envelope,c.pace_envelope,c.density_envelope,c.confidence as capability_confidence,c.freshness as capability_freshness,c.evidence_count,c.valid_evidence_count,
  greatest(p.last_observed_at,c.last_observed_at) as last_observed_at
from public.user_exercise_progress p
full join public.user_exercise_capabilities c on c.user_id=p.user_id and c.exercise_id::text=p.exercise_id::text
left join latest_skill_feedback sf on sf.user_id=coalesce(p.user_id,c.user_id) and sf.exercise_id=coalesce(p.exercise_id,c.exercise_id);

grant select on public.user_exercise_coach_state to authenticated,service_role;

comment on table public.session_execution_events is 'W2 trace only. Final workout/session/exercise state remains authoritative; events must never become a second source of truth.';
comment on function public.w2_enrich_completion_payload_v1(uuid,jsonb) is 'W2 safe derivation: completed non-test Skill may fulfill exact structured prescription; never infers load or extra performance.';
