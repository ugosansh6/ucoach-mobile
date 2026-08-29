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

  raise notice 'UGEROD backend_core_regression: PASS';
end $$;

rollback;
