-- UGEROD backend core regression smoke suite
-- DEV execution contract:
--   select set_config('ugerod.qa_user_id','<existing QA profile uuid>',false);
--   \i supabase/tests/backend_core_regression.sql
--
-- The suite is transaction-safe and leaves no data behind.
-- Full mutable E2E fixtures (Builder completion, partial GYM sets, Outdoor running,
-- external import commit and Swap/Undo) are exercised against DEV before backend releases;
-- this file protects deterministic contracts that can run without fabricating user history.

begin;

do $$
declare
  v_user uuid := nullif(current_setting('ugerod.qa_user_id',true),'')::uuid;
  v_home jsonb;
  v_box jsonb;
  v_gym jsonb;
  v_outdoor jsonb;
  v_missing int;
  v_contract jsonb;
  v_lifecycle jsonb;
begin
  if v_user is null then
    raise exception 'Set ugerod.qa_user_id to an existing QA profile before running this suite';
  end if;

  perform pg_catalog.set_config('request.jwt.claim.sub',v_user::text,true);

  -- Execution-key normalization must keep external completed work in the same
  -- runtime execution family as WOD while preserving external provenance elsewhere.
  if public.canonical_execution_block_key_v1('external') <> 'wod' then
    raise exception 'EXT-004 regression: external execution block is not canonical WOD';
  end if;
  if public.canonical_execution_block_key_v1('warm_up') <> 'warmup' then
    raise exception 'Execution-key regression: warm_up normalization broken';
  end if;

  -- SAFE-001: every user-selectable exercise must contain the metadata required
  -- by fail-closed pain / capability gates.
  select count(*) into v_missing
  from public.exercises e
  where coalesce(e.warmup_only,false)=false
    and (
      nullif(trim(e.movement_pattern),'') is null
      or nullif(trim(e.body_region),'') is null
      or nullif(trim(e.difficulty),'') is null
      or e.technical_complexity is null
      or coalesce(cardinality(e.tracking_modes),0)=0
      or not exists(select 1 from public.exercise_body_zones z where z.exercise_id=e.id)
    );
  if v_missing <> 0 then
    raise exception 'SAFE-001 regression: % selectable exercises have incomplete hard-gate metadata',v_missing;
  end if;

  -- Builder/environment contracts.
  v_home:=public.get_user_session_builder_bootstrap_v1('HOME');
  v_box:=public.get_user_session_builder_bootstrap_v1('BOX');
  v_gym:=public.get_user_session_builder_bootstrap_v1('GYM');
  v_outdoor:=public.get_user_session_builder_bootstrap_v1('OUTDOOR');

  if v_home->>'selected_environment' <> 'HOME'
     or not exists(select 1 from jsonb_array_elements(v_home->'formats') f where f->>'format_code'='FUNCTIONAL_CLASSIC') then
    raise exception 'ENV regression: HOME Functional Classic bootstrap missing';
  end if;
  if v_box->>'selected_environment' <> 'BOX'
     or not exists(select 1 from jsonb_array_elements(v_box->'formats') f where f->>'format_code'='FUNCTIONAL_CLASSIC') then
    raise exception 'ENV regression: BOX Functional Classic bootstrap missing';
  end if;
  if v_gym->>'selected_environment' <> 'GYM'
     or not exists(select 1 from jsonb_array_elements(v_gym->'formats') f where f->>'format_code'='GYM_STRENGTH')
     or not exists(select 1 from jsonb_array_elements(v_gym->'gym_execution_styles') s where s->>'style_code'='CLASSIC_SETS')
     or not exists(select 1 from jsonb_array_elements(v_gym->'gym_execution_styles') s where s->>'style_code'='CIRCUIT')
     or not exists(select 1 from jsonb_array_elements(v_gym->'gym_execution_styles') s where s->>'style_code'='SUPERSETS') then
    raise exception 'GYM regression: formats or execution styles missing';
  end if;
  if v_outdoor->>'selected_environment' <> 'OUTDOOR'
     or coalesce((v_outdoor->>'surface_required')::boolean,false) is not true
     or not exists(select 1 from jsonb_array_elements(v_outdoor->'formats') f where f->>'format_code'='OUTDOOR_CONDITIONING_WOD')
     or not exists(select 1 from jsonb_array_elements(v_outdoor->'outdoor_conditioning_modes') m where m->>'mechanic_key'='RUN_CONTINUOUS')
     or not exists(select 1 from jsonb_array_elements(v_outdoor->'outdoor_conditioning_modes') m where m->>'mechanic_key'='RUN_INTERVALS')
     or not exists(select 1 from jsonb_array_elements(v_outdoor->'outdoor_conditioning_modes') m where m->>'mechanic_key'='RUN_FARTLEK') then
    raise exception 'OUTDOOR regression: surface, WOD format or running mechanics missing';
  end if;

  if v_home->>'completion_rpc' <> 'complete_workout_session_v3'
     or v_box->>'completion_rpc' <> 'complete_workout_session_v3'
     or v_gym->>'completion_rpc' <> 'complete_workout_session_v3'
     or v_outdoor->>'completion_rpc' <> 'complete_workout_session_v3' then
    raise exception 'Completion regression: Builder bootstrap is not advertising complete_workout_session_v3';
  end if;

  -- PREF-001 deterministic provenance classification.
  if public.resolve_exercise_selection_provenance_v1(
       jsonb_build_object('source','c4-swap-directional-v3'),null,'USER_SELECTED'
     ) <> 'UGEROD_SUGGESTED_ACCEPTED' then
    raise exception 'PREF-001 regression: accepted swap provenance classification broken';
  end if;

  -- Coach truth: an administratively closed session only counts as training when
  -- there is realized execution. Existing positive-execution sessions must remain eligible.
  if exists(
    select 1 from public.workout_sessions ws
    where ws.status='completed'
      and public.d_session_execution_factor_v2(ws.id)>0
      and public.session_counts_as_training_v1(ws.id) is not true
  ) then
    raise exception 'Coach truth regression: positive-execution completed session does not count as training';
  end if;
  if exists(
    select 1 from public.workout_sessions ws
    where ws.status='completed'
      and public.d_session_execution_factor_v2(ws.id)=0
      and public.session_counts_as_training_v1(ws.id) is true
  ) then
    raise exception 'Coach truth regression: zero-execution closed session counts as training';
  end if;

  -- Coach V2 goal doctrine is qualitative: no legacy numeric weight is part of
  -- the new priority authority contract.
  if jsonb_path_exists(public.program_coach_goal_quality_roles_v2('Strength'),'$.**.weight')
     or jsonb_path_exists(public.program_coach_goal_quality_roles_v2('General Fitness'),'$.**.weight') then
    raise exception 'PRG V2 regression: qualitative goal roles expose numeric weights';
  end if;

  v_contract:=public.program_coach_priority_contract_from_resolver_v2(jsonb_build_object(
    'version','qa-resolver',
    'primary_goal','Strength',
    'primary_priority',jsonb_build_object('kind','QUALITY','key','strength','programming_state','DEVELOP'),
    'secondary_priority',jsonb_build_object('kind','QUALITY','key','conditioning','programming_state','MAINTAIN'),
    'maintenance','[]'::jsonb,
    'unknown_patterns','[]'::jsonb,
    'decision_order',jsonb_build_array('QA')));
  if jsonb_path_exists(v_contract,'$.**.weight') or jsonb_path_exists(v_contract,'$.**.priority_score') then
    raise exception 'PRG V2 regression: persistent cycle priority contains legacy numeric authority';
  end if;
  if coalesce((v_contract#>>'{semantics,persistent_until_strategy_review}')::boolean,false) is not true then
    raise exception 'PRG V2 regression: cycle priority is not declared persistent until review';
  end if;

  -- A block whose horizon has passed may not silently continue forever.
  v_lifecycle:=public.program_coach_block_lifecycle_from_inputs_v2(
    jsonb_build_object('id','00000000-0000-0000-0000-000000000001','status','active','primary_goal','Strength','target_end_on','2026-08-20'),
    jsonb_build_object('recommended_action','CONTINUE'),
    jsonb_build_object('primary_goal','Strength','primary_priority',jsonb_build_object('kind','QUALITY','key','strength')),
    '2026-08-30'::date);
  if v_lifecycle->>'transition'<>'LIFECYCLE_DECISION_REQUIRED'
     or v_lifecycle->>'reason_code'<>'ACTIVE_BLOCK_HORIZON_PASSED_NO_SILENT_EXTENSION' then
    raise exception 'PRG lifecycle regression: expired active block can silently continue';
  end if;
  if coalesce((v_lifecycle->>'extension_duration_decided')::boolean,true) is not false then
    raise exception 'PRG lifecycle regression: arbitrary automatic extension duration introduced';
  end if;

  -- Recovery may alter dose, not rewrite the cycle priority.
  v_lifecycle:=public.program_coach_block_lifecycle_from_inputs_v2(
    jsonb_build_object('id','00000000-0000-0000-0000-000000000001','status','active','primary_goal','Strength','target_end_on','2026-09-30'),
    jsonb_build_object('recommended_action','CONSOLIDATE'),
    jsonb_build_object('primary_goal','Strength','primary_priority',jsonb_build_object('kind','QUALITY','key','strength')),
    '2026-08-30'::date);
  if v_lifecycle->>'transition'<>'KEEP_ACTIVE_CONSOLIDATE'
     or coalesce((v_lifecycle#>>'{persistent_priority_contract,session_actuals_may_change_week_or_dose_not_cycle_priority}')::boolean,false) is not true then
    raise exception 'PRG lifecycle regression: consolidation is changing cycle priority semantics';
  end if;

  raise notice 'UGEROD backend_core_regression: PASS';
end $$;

rollback;
