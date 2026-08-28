-- Outdoor Conditioning + WOD and safe replacement of an unstarted generated session.

insert into public.session_format_catalog(format_code,label_fr,description_fr,module_order,user_buildable,active,sort_order)
values (
  'OUTDOOR_CONDITIONING_WOD',
  'Conditioning + WOD',
  'Préparation, conditioning extérieur puis WOD Functional Fitness issu du moteur Maison / Box.',
  array['UNLOCK','CONDITIONING','WOD']::text[],
  true,true,32
)
on conflict (format_code) do update set
  label_fr=excluded.label_fr,
  description_fr=excluded.description_fr,
  module_order=excluded.module_order,
  user_buildable=excluded.user_buildable,
  active=excluded.active,
  sort_order=excluded.sort_order;

insert into public.environment_session_format_policy(environment_code,format_code,is_default,is_locked_architecture,constraints_json)
values (
  'OUTDOOR','OUTDOOR_CONDITIONING_WOD',false,false,
  jsonb_build_object(
    'wod_source','C4_HOME_BOX_WOD',
    'compiler_status','ACTIVE_DEV_VALIDATING',
    'player_contract','environment-session-core-v1',
    'generation_enabled',false,
    'surface_is_explicit',true,
    'equipment_is_explicit',true,
    'conditioning_minimum_minutes',8,
    'module_reduction_authorities',jsonb_build_array('EXISTING_DURATION_BUDGET','EXISTING_READINESS_POLICY','PAIN_HARD_GATES','EQUIPMENT_HARD_GATES')
  )
)
on conflict (environment_code,format_code) do update set
  is_default=excluded.is_default,
  is_locked_architecture=excluded.is_locked_architecture,
  constraints_json=excluded.constraints_json;

create or replace function public.outdoor_plan_session_v3(
  p_user_id uuid,
  p_duration_minutes integer default 45,
  p_readiness text default 'normal',
  p_focus text default 'Conditioning',
  p_target_region text default 'Full Body',
  p_progression_intent text default 'MAINTAIN',
  p_zone_terms text[] default '{}'::text[],
  p_inventory jsonb default '[]'::jsonb,
  p_place_code text default null,
  p_surface_code text default null,
  p_format_code text default null,
  p_reliable_distance boolean default false,
  p_running_allowed boolean default true,
  p_calibration_opportunity boolean default false,
  p_max_complexity integer default 3,
  p_max_difficulty text default 'Intermédiaire',
  p_candidate_count integer default 16
)
returns jsonb
language plpgsql stable
set search_path='public'
as $function$
declare
  v_format text:=upper(coalesce(nullif(trim(p_format_code),''),'OUTDOOR_CONDITIONING'));
  v_ctx jsonb; v_surface text; v_legacy jsonb; v_wod jsonb; v_wod_minutes int:=0;
  v_base jsonb; v_unlock jsonb; v_conditioning jsonb; v_conditioning_minutes int:=0;
  v_compiled jsonb; v_family jsonb; v_blocks jsonb:='[]'::jsonb; v_planned int:=0;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;
  if v_format<>'OUTDOOR_CONDITIONING_WOD' then
    return public.outdoor_plan_session_v2(p_user_id,p_duration_minutes,p_readiness,p_focus,p_target_region,p_progression_intent,p_zone_terms,p_inventory,p_place_code,p_surface_code,p_format_code,p_reliable_distance,p_running_allowed,p_calibration_opportunity,p_max_complexity,p_max_difficulty,p_candidate_count);
  end if;
  if p_duration_minutes not between 20 and 120 then
    return jsonb_build_object('status','blocked','reason_code','DURATION_OUT_OF_RANGE','format_code',v_format,'version','outdoor-planner-v3.1-conditioning-wod');
  end if;
  v_ctx:=public.outdoor_place_context_v1(p_place_code,p_surface_code);
  v_surface:=v_ctx->>'effective_surface_code';
  if v_surface is null then
    return jsonb_build_object('status','blocked','reason_code','SURFACE_REQUIRED_OUTDOOR','format_code',v_format,'place_context',v_ctx,'version','outdoor-planner-v3.1-conditioning-wod');
  end if;
  perform set_config('ugerod.session_environment','OUTDOOR',true);
  perform set_config('ugerod.session_surface',v_surface,true);
  v_base:=public.outdoor_plan_session_v2(p_user_id,p_duration_minutes,p_readiness,p_focus,p_target_region,p_progression_intent,p_zone_terms,p_inventory,p_place_code,p_surface_code,'OUTDOOR_CONDITIONING',p_reliable_distance,p_running_allowed,p_calibration_opportunity,p_max_complexity,p_max_difficulty,p_candidate_count);
  if v_base->>'status'<>'READY' then return v_base||jsonb_build_object('format_code',v_format,'version','outdoor-planner-v3.1-conditioning-wod'); end if;
  v_legacy:=public.c4_plan_full_session(p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty,greatest(8,p_candidate_count),'c4-final-default');
  if v_legacy->>'status'<>'READY' then
    return jsonb_build_object('status','blocked','reason_code','HOME_BOX_WOD_NOT_COMPILABLE_OUTDOOR','format_code',v_format,'legacy_status',v_legacy->>'status','version','outdoor-planner-v3.1-conditioning-wod');
  end if;
  select b into v_unlock from jsonb_array_elements(coalesce(v_base->'blocks','[]'::jsonb)) b where b->>'block_key'='unlock' limit 1;
  select b into v_conditioning from jsonb_array_elements(coalesce(v_base->'blocks','[]'::jsonb)) b where b->>'block_key'='conditioning' limit 1;
  select b into v_wod from jsonb_array_elements(coalesce(v_legacy->'blocks','[]'::jsonb)) b where b->>'block_key'='wod' limit 1;
  if v_unlock is null or v_conditioning is null or v_wod is null then
    return jsonb_build_object('status','blocked','reason_code','CONDITIONING_PLUS_WOD_BLOCK_MISSING','format_code',v_format,'version','outdoor-planner-v3.1-conditioning-wod');
  end if;
  v_wod_minutes:=greatest(1,coalesce((v_wod->>'duration_minutes')::int,0));
  v_conditioning_minutes:=p_duration_minutes-coalesce((v_unlock->>'duration_minutes')::int,2)-v_wod_minutes;
  if v_conditioning_minutes<8 then
    return jsonb_build_object('status','blocked','reason_code','DURATION_TOO_SHORT_FOR_CONDITIONING_PLUS_HOME_BOX_WOD','format_code',v_format,'requested_minutes',p_duration_minutes,'wod_minutes',v_wod_minutes,'conditioning_minutes_available',v_conditioning_minutes,'minimum_conditioning_minutes',8,'version','outdoor-planner-v3.1-conditioning-wod');
  end if;
  v_family:=coalesce(v_base->'running_family_opportunity','{}'::jsonb);
  if v_family->>'status'='FAMILY_SELECTED' then
    v_compiled:=public.outdoor_compile_running_block_v1(v_family,v_conditioning_minutes,p_reliable_distance);
    if v_compiled->>'status'='READY' then v_conditioning:=v_compiled-'status'; else v_conditioning:=v_conditioning||jsonb_build_object('duration_minutes',v_conditioning_minutes); end if;
  else
    v_conditioning:=v_conditioning||jsonb_build_object('duration_minutes',v_conditioning_minutes);
  end if;
  v_wod:=v_wod||jsonb_build_object('module_code','WOD','wod_source','C4_HOME_BOX_WOD','outdoor_reused_legacy_wod',true);
  v_blocks:=jsonb_build_array(v_unlock,v_conditioning,v_wod);
  select coalesce(sum(coalesce((b->>'duration_minutes')::int,0)),0) into v_planned from jsonb_array_elements(v_blocks) b;
  return v_base||jsonb_build_object(
    'status','READY','format_code',v_format,'blocks',v_blocks,
    'architecture',coalesce(v_base->'architecture','{}'::jsonb)||jsonb_build_object('block_order',jsonb_build_array('unlock','conditioning','wod'),'planned_minutes',v_planned,'requested_minutes',p_duration_minutes,'unallocated_available_minutes',greatest(0,p_duration_minutes-v_planned),'duration_is_maximum_not_fill_target',true,'wod_minutes',v_wod_minutes,'conditioning_minutes',v_conditioning_minutes),
    'explainability',coalesce(v_base->'explainability','{}'::jsonb)||jsonb_build_object('architecture_reason','EXPLICIT_CONDITIONING_PLUS_HOME_BOX_WOD','wod_source','C4_HOME_BOX_WOD','wod_compiled_under_outdoor_hard_gates',true),
    'version','outdoor-planner-v3.1-conditioning-wod'
  );
end;
$function$;

create or replace function public.outdoor_generate_session_v1(
  p_user_id uuid,
  p_duration_minutes integer default 45,
  p_readiness text default 'normal',
  p_focus text default 'Conditioning',
  p_target_region text default 'Full Body',
  p_progression_intent text default 'MAINTAIN',
  p_zone_terms text[] default '{}'::text[],
  p_inventory jsonb default '[]'::jsonb,
  p_available_equipment text[] default '{}'::text[],
  p_place_code text default null,
  p_surface_code text default null,
  p_format_code text default null,
  p_reliable_distance boolean default false,
  p_running_allowed boolean default true,
  p_calibration_opportunity boolean default false,
  p_max_complexity integer default 3,
  p_max_difficulty text default 'Intermédiaire',
  p_candidate_count integer default 16,
  p_start_now boolean default false
)
returns jsonb
language plpgsql security definer
set search_path='public'
as $function$
declare
  v_plan jsonb; v_session_id uuid; v_status text:=case when p_start_now then 'in_progress' else 'generated' end;
  v_now timestamptz:=now(); v_local_date date:=public.ugerod_effective_session_anchor_date_v1();
  v_block jsonb; v_ex jsonb; v_legacy_key text; v_position smallint; v_unlock_pos smallint:=0; v_wod_pos smallint:=0; v_pres jsonb; v_generated jsonb;
  v_run_block jsonb; v_run_mechanic text; v_run_family text; v_run_params jsonb:='{}'::jsonb; v_effective_surface text; v_expected_stimulus jsonb;
begin
  if p_user_id is null then raise exception 'p_user_id is required'; end if;
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;
  v_plan:=public.outdoor_plan_session_v3(p_user_id,p_duration_minutes,p_readiness,p_focus,p_target_region,p_progression_intent,p_zone_terms,p_inventory,p_place_code,p_surface_code,p_format_code,p_reliable_distance,p_running_allowed,p_calibration_opportunity,p_max_complexity,p_max_difficulty,p_candidate_count);
  if v_plan->>'status'<>'READY' then return v_plan||jsonb_build_object('session_persisted',false,'version','outdoor-session-generate-v1.3-conditioning-wod'); end if;
  select b into v_run_block from jsonb_array_elements(coalesce(v_plan->'blocks','[]'::jsonb)) b where lower(coalesce(b->>'block_key',''))='conditioning' limit 1;
  v_run_mechanic:=upper(coalesce(v_run_block->>'mechanic',v_run_block#>>'{mechanic_json,mechanic_key}','OUTDOOR_CONDITIONING'));
  v_run_family:=coalesce(v_run_block#>>'{running_protocol,family_code}',v_run_block#>>'{running_family_context,family_code}',v_plan#>>'{running_family_opportunity,family_code}');
  v_run_params:=coalesce(v_run_block#>'{mechanic_json,parameters}',v_run_block#>'{running_protocol,parameters}','{}'::jsonb);
  v_effective_surface:=coalesce(v_plan#>>'{place_context,effective_surface_code}',public.normalize_session_surface_v1(p_surface_code));
  v_expected_stimulus:=public.build_session_stimulus_target(p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,'c1-default')||jsonb_build_object('source','outdoor_auto_generation');
  v_generated:=v_plan||jsonb_build_object('meta',coalesce(v_plan->'meta','{}'::jsonb)||jsonb_build_object('source','outdoor_auto_generation','environment_code','OUTDOOR','format_code',v_plan->>'format_code','duration_minutes',p_duration_minutes,'session_contract','outdoor-session-generate-v1.3-conditioning-wod'));
  insert into public.workout_sessions(user_id,status,duration_minutes,target_region,readiness,focus,available_equipment,injured_zones,generated_at,started_at,progression_intent,planning_context_json,expected_stimulus_json,mechanic_json,quality_gate_json,generated_workout,generation_local_date,started_local_date,planned_environment_code,planned_environment_source,planned_environment_selected_at,planned_surface_code)
  values(p_user_id,v_status,p_duration_minutes,p_target_region,p_readiness,p_focus,coalesce(p_available_equipment,'{}'::text[]),coalesce(p_zone_terms,'{}'::text[]),v_now,case when p_start_now then v_now else null end,p_progression_intent,
    jsonb_build_object('session_source','outdoor_auto_generation','environment_code','OUTDOOR','format_code',v_plan->>'format_code','place_context',v_plan->'place_context','running_family',v_plan->'running_family_opportunity','challenge_target',v_plan->'challenge_target','equipment_inferred_from_environment',false,'compiler_version','outdoor-planner-v3-conditioning-wod'),
    v_expected_stimulus,jsonb_strip_nulls(jsonb_build_object('mechanic_key',v_run_mechanic,'variant_key',v_run_family,'format_code',v_plan->>'format_code','session_kind','OUTDOOR_SESSION','running_mechanic',v_run_mechanic,'running_family_code',v_run_family,'parameters',v_run_params,'source','outdoor_auto_generation')),
    jsonb_build_object('pass',true,'source','outdoor_plan_session_v3','format_code',v_plan->>'format_code'),v_generated,v_local_date,case when p_start_now then v_local_date else null end,'OUTDOOR','USER_PREPARATION',v_now,v_effective_surface)
  returning id into v_session_id;
  for v_block in select value from jsonb_array_elements(coalesce(v_plan->'blocks','[]'::jsonb)) loop
    v_legacy_key:=case lower(coalesce(v_block->>'block_key','')) when 'unlock' then 'unlock' when 'gym' then 'skill' when 'street_gym' then 'skill' when 'tabata' then 'tabata' when 'tabata_abs' then 'tabata' when 'core' then 'tabata' when 'conditioning' then 'wod' when 'wod' then 'wod' else null end;
    if v_legacy_key is null then raise exception 'Unsupported OUTDOOR block_key during persistence: %',v_block->>'block_key'; end if;
    for v_ex in select value from jsonb_array_elements(coalesce(v_block->'exercises','[]'::jsonb)) loop
      if v_legacy_key='unlock' then v_unlock_pos:=v_unlock_pos+1; v_position:=v_unlock_pos; else v_wod_pos:=v_wod_pos+1; v_position:=v_wod_pos; end if;
      v_pres:=coalesce(v_ex->'prescription','{}'::jsonb);
      insert into public.workout_session_exercises(session_id,exercise_id,exercise_name,block_key,position,status,prescription,prescription_json,expected_outcome_json,solver_decision_json,user_execution_status)
      values(v_session_id,v_ex->>'exercise_id',coalesce(nullif(v_ex->>'name',''),nullif(v_ex->>'exercise_name',''),v_ex->>'exercise_id'),v_legacy_key,v_position,'pending',nullif(v_pres->>'text',''),v_pres,coalesce(v_ex->'expected_outcome',v_pres),jsonb_build_object('source','outdoor_auto_generation','environment_code','OUTDOOR','format_code',v_plan->>'format_code','outdoor_block_key',v_block->>'block_key','running_family_code',v_pres->>'running_family_code','running_protocol_version',v_pres->>'running_protocol_version','manual_selection',false),'pending');
    end loop;
  end loop;
  return jsonb_build_object('status',case when p_start_now then 'STARTED' else 'GENERATED' end,'session_id',v_session_id,'session_status',v_status,'environment_code','OUTDOOR','format_code',v_plan->>'format_code','running_mechanic',v_run_mechanic,'running_family_code',v_run_family,'generated_workout',v_generated,'session_persisted',true,'completion_rpc','complete_workout_session_v3','version','outdoor-session-generate-v1.3-conditioning-wod');
end;
$function$;

create or replace function public.discard_unstarted_workout_session_v1(p_session_id uuid)
returns jsonb
language plpgsql security definer
set search_path='public'
as $function$
declare
  v_session public.workout_sessions%rowtype;
  v_uid uuid:=auth.uid();
begin
  if p_session_id is null then raise exception 'p_session_id is required'; end if;
  select * into v_session from public.workout_sessions where id=p_session_id for update;
  if not found then return jsonb_build_object('status','NOT_FOUND','session_id',p_session_id,'discarded',false,'version','discard-unstarted-session-v1'); end if;
  if v_uid is not null and v_session.user_id<>v_uid then raise exception 'Forbidden session'; end if;
  if v_session.status<>'generated' or v_session.started_at is not null or v_session.started_local_date is not null or v_session.wod_started_at is not null then
    return jsonb_build_object('status','STARTED_SESSION_PROTECTED','session_id',p_session_id,'session_status',v_session.status,'discarded',false,'version','discard-unstarted-session-v1');
  end if;
  update public.workout_sessions set status='abandoned',planning_context_json=coalesce(planning_context_json,'{}'::jsonb)||jsonb_build_object('lifecycle_disposition','REPLACED_BEFORE_START','replacement_requested_at',now(),'counts_as_completed_execution',false),updated_at=now() where id=p_session_id;
  return jsonb_build_object('status','DISCARDED','session_id',p_session_id,'discarded',true,'counts_as_completed_execution',false,'version','discard-unstarted-session-v1');
end;
$function$;

revoke all on function public.discard_unstarted_workout_session_v1(uuid) from public,anon;
grant execute on function public.discard_unstarted_workout_session_v1(uuid) to authenticated,service_role;
