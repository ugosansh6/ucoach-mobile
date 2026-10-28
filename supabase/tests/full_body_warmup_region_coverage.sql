-- DEV. Set ugerod.qa_user_id first. Optionally set ugerod.qa_session_id to
-- an unstarted session to exercise the persisted warm-up refresh as well.
-- All session changes are rolled back.
begin;
set local statement_timeout='60s';
do $$
declare
  uid uuid:=nullif(current_setting('ugerod.qa_user_id',true),'')::uuid;
  sid uuid:=nullif(current_setting('ugerod.qa_session_id',true),'')::uuid;
  p jsonb;
  q jsonb;
  warm jsonb;
  before_workout jsonb;
  after_workout jsonb;
  result jsonb;
  region text;
  n int;
begin
  if uid is null then raise exception 'Set ugerod.qa_user_id first'; end if;
  perform set_config('request.jwt.claim.sub',uid::text,true);
  p:=jsonb_build_object('status','READY','architecture','{}'::jsonb,
    'stimulus',public.build_session_stimulus_target('Strength',45,'normal','Full Body','RECALIBRATE','c1-default'),
    'blocks','[
      {"block_key":"tabata","duration_minutes":4,"exercises":[{"exercise_id":"EX414"},{"exercise_id":"EX095"}]},
      {"block_key":"warmup","duration_minutes":6,"exercises":[{}, {}, {}]},
      {"block_key":"skill","duration_minutes":9,"exercises":[{"exercise_id":"EX087"},{"exercise_id":"EX_C03"}]},
      {"block_key":"wod","duration_minutes":20,"exercises":[{"id":"EX020"},{"id":"EX539"}]}
    ]'::jsonb);
  q:=public.c4_apply_preparation_quality_v3_pre_exercise_coherence_v1(uid,p,'{}','[]','Full Body',3,'RECALIBRATE');
  select b into warm from jsonb_array_elements(q->'blocks') b where b->>'block_key'='warmup';
  if jsonb_array_length(warm->'exercises')<>3 then raise exception 'Warm-up shape changed'; end if;
  foreach region in array array['Upper','Lower','Core'] loop
    select count(*) into n from jsonb_array_elements(warm->'exercises') x
      join public.exercises e on e.id=x->>'exercise_id'
      where public.c4_full_body_region_v1(e.movement_pattern,e.exercise_family,e.body_region)=region;
    if n<>1 then raise exception 'Warm-up does not prepare each region once: % / %',region,warm; end if;
  end loop;
  if exists(select 1 from jsonb_array_elements(warm->'exercises') x join public.exercises e on e.id=x->>'exercise_id'
    where not public.exercise_equipment_compatible(e.id,'[]')
      or not public.exercise_safe_for_zones(e.id,'{}')
      or not ('Warm-up'=any(e.usable_for) or 'Skill'=any(e.usable_for) or 'WOD'=any(e.usable_for))
      or coalesce(e.fatigue_score,99)>3
      or coalesce(e.joint_impact,99)>3 or coalesce(e.technical_complexity,99)>3) then
    raise exception 'Warm-up selection bypassed existing safety or equipment gates';
  end if;
  if (select jsonb_agg(b order by ord) from jsonb_array_elements(p->'blocks') with ordinality x(b,ord) where b->>'block_key'<>'warmup')
     is distinct from (select jsonb_agg(b order by ord) from jsonb_array_elements(q->'blocks') with ordinality x(b,ord) where b->>'block_key'<>'warmup') then
    raise exception 'Skill, Tabata or WOD changed';
  end if;

  -- Explicit regional sessions retain the old Skill-first target order.
  foreach region in array array['Upper','Lower','Core'] loop
    q:=public.c4_apply_preparation_quality_v3_pre_exercise_coherence_v1(uid,p,'{}','[]',region,3,'RECALIBRATE');
    select b into warm from jsonb_array_elements(q->'blocks') b where b->>'block_key'='warmup';
    if warm#>>'{exercises,0,prescription,warmup_target_block}'<>'skill'
       or warm#>>'{exercises,1,prescription,warmup_target_block}'<>'skill' then
      raise exception 'Explicit % target ordering changed',region;
    end if;
  end loop;

  if sid is not null then
    select generated_workout into before_workout from public.workout_sessions
      where id=sid and user_id=uid and status='generated' and started_at is null for update;
    if before_workout is null then raise exception 'QA session must belong to the user and be unstarted'; end if;
    result:=public.c4_refresh_specific_warmup_session_v1(uid,sid);
    if result->>'status'<>'APPLIED' then raise exception 'Persisted refresh failed: %',result; end if;
    select generated_workout into after_workout from public.workout_sessions where id=sid;
    if (select jsonb_agg(b order by ord) from jsonb_array_elements(before_workout->'blocks') with ordinality x(b,ord) where b->>'block_key'<>'warmup')
       is distinct from (select jsonb_agg(b order by ord) from jsonb_array_elements(after_workout->'blocks') with ordinality x(b,ord) where b->>'block_key'<>'warmup') then
      raise exception 'Persisted refresh changed another block';
    end if;
    select count(distinct public.c4_full_body_region_v1(e.movement_pattern,e.exercise_family,e.body_region)) into n
      from public.workout_session_exercises x join public.exercises e on e.id=x.exercise_id
      where x.session_id=sid and x.block_key='warm_up';
    if n<>3 then raise exception 'Persisted warm-up omitted a region'; end if;
  end if;
end;
$$;
select 'full_body_warmup_region_coverage: PASS' result;
rollback;
