-- DEV. Set ugerod.qa_user_id first. No training/history writes.
begin;
do $$
declare
  uid uuid:=nullif(current_setting('ugerod.qa_user_id',true),'')::uuid;
  blocks jsonb:='[{"block_key":"skill","duration_minutes":9,"exercises":[{"exercise_id":"EX087"}]},{"block_key":"wod","duration_minutes":20,"exercises":[{"exercise_id":"EX020"},{"exercise_id":"EX539"}]}]';
  extra jsonb:='[{"block_key":"tabata","duration_minutes":40,"exercises":[{"exercise_id":"EX087"},{"exercise_id":"EX095"}]},{"block_key":"warmup","duration_minutes":30,"exercises":[{"exercise_id":"EX033"}]},{"block_key":"unlock","duration_minutes":30,"exercises":[{"exercise_id":"EX033"}]}]';
  a jsonb;
  b jsonb;
  p jsonb;
  q jsonb;
  warm jsonb;
  warm2 jsonb;
  region text;
  ids text[];
begin
  if uid is null then raise exception 'Set ugerod.qa_user_id first'; end if;
  perform set_config('request.jwt.claim.sub',uid::text,true);
  a:=public.c4_full_body_exposure_v1(blocks);
  b:=public.c4_full_body_exposure_v1(blocks||extra);
  if a<>b or (a->>'tabata_counted')::boolean is distinct from false then
    raise exception 'Tabata or preparation changed the balance of Skill + WOD';
  end if;
  if a#>>'{regional_minutes,Core}'<>'9.0000' and (a#>>'{regional_minutes,Core}')::numeric<>9 then
    raise exception 'Core Skill was not counted';
  end if;
  a:=public.c4_full_body_exposure_v1('[{"block_key":"wod","duration_minutes":20,"exercises":[{"exercise_id":"EX020"},{"exercise_id":"EX539"}]}]');
  if (a->>'missing_count')::int<>0 or (a->>'imbalance')::numeric<>0
     or (a->>'core_quota_required')::boolean is distinct from false then
    raise exception 'Core was forced into a balanced upper/lower WOD';
  end if;
  b:=public.c4_full_body_exposure_v1('[{"block_key":"strength","duration_minutes":20,"exercises":[{"exercise_id":"EX020"},{"exercise_id":"EX539"}]}]');
  if a<>b then raise exception 'Gym strength block did not use the common WOD policy'; end if;
  a:=public.c4_full_body_exposure_v1(blocks);
  b:=public.c4_full_body_exposure_v1(jsonb_set(blocks,'{0,block_key}','"gym"'));
  if a<>b then raise exception 'Outdoor Skill did not use the common Skill policy'; end if;
  a:=public.c4_full_body_exposure_v1('[{"block_key":"wod","duration_minutes":20,"exercises":[{"exercise_id":"EX020"}]}]'::jsonb||extra);
  if not (a->'missing_regions' ? 'Lower') then
    raise exception 'Warm-up leg work manufactured full-body coverage';
  end if;

  -- The warm-up follows the actual Skill anchor and final WOD targets,
  -- not a separate regional quota or the signature Tabata pair.
  p:=jsonb_build_object('status','READY','architecture','{}'::jsonb,
    'stimulus',public.build_session_stimulus_target('Strength',45,'normal','Full Body','MAINTAIN','c1-default'),
    'blocks','[
      {"block_key":"tabata","duration_minutes":4,"exercises":[{"exercise_id":"EX414"},{"exercise_id":"EX095"}]},
      {"block_key":"warmup","duration_minutes":6,"exercises":[{}, {}, {}]},
      {"block_key":"skill","duration_minutes":9,"exercises":[{"exercise_id":"EX087"},{"exercise_id":"EX_C03"}]},
      {"block_key":"wod","duration_minutes":20,"exercises":[{"id":"EX020"},{"id":"EX539"}]}
    ]'::jsonb);
  q:=public.c4_apply_preparation_quality_v3_pre_exercise_coherence_v1(uid,p,'{}','[]','Full Body',3,'MAINTAIN');
  select x into warm from jsonb_array_elements(q->'blocks') x where x->>'block_key'='warmup';
  select array_agg(x#>>'{prescription,warmup_target_exercise_id}') into ids from jsonb_array_elements(warm->'exercises') x;
  if not (ids @> array['EX087','EX020','EX539']) then
    raise exception 'Final Skill/WOD targets not prepared before secondary Skill drill: %',ids;
  end if;
  if coalesce((warm#>>'{preparation_quality_contract,independent_region_quota}')::boolean,true) then
    raise exception 'Independent warm-up region quota still active';
  end if;
  q:=public.c4_apply_preparation_quality_v3_pre_exercise_coherence_v1(uid,
    jsonb_set(p,'{blocks,0,exercises}','[{"exercise_id":"EX523"},{"exercise_id":"EX318"}]'),
    '{}','[]','Full Body',3,'MAINTAIN');
  select x into warm2 from jsonb_array_elements(q->'blocks') x where x->>'block_key'='warmup';
  if warm<>warm2 then raise exception 'Tabata pair changed the specific warm-up'; end if;
  foreach region in array array['Upper','Lower','Core'] loop
    q:=public.c4_apply_preparation_quality_v3_pre_exercise_coherence_v1(uid,p,'{}','[]',region,3,'MAINTAIN');
    select x into warm2 from jsonb_array_elements(q->'blocks') x where x->>'block_key'='warmup';
    if warm2#>>'{exercises,0,prescription,warmup_target_block}'<>'skill'
       or warm2#>>'{exercises,1,prescription,warmup_target_block}'<>'skill' then
      raise exception 'Explicit regional preparation order changed';
    end if;
  end loop;
end;
$$;
select 'full_body_skill_wod_policy: PASS' result;
rollback;
