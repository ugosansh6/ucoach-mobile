-- Preserve an otherwise valid Outdoor base plan when the challenge layer proposes
-- an invalid exact WOD duration. Only this known exception is fail-safe.

create or replace function public.outdoor_plan_session_v1_pre_contract_alignment_v2(
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
  v_ctx jsonb:=public.outdoor_place_context_v1(p_place_code,p_surface_code);
  v_surface text:=v_ctx->>'effective_surface_code';
  v_format text:=upper(coalesce(nullif(trim(p_format_code),''),'OUTDOOR_CONDITIONING'));
  v_unlock_source jsonb; v_unlock jsonb; v_gym jsonb:='{}'::jsonb; v_abs jsonb:='{}'::jsonb;
  v_gym_minutes int:=0; v_abs_minutes int:=0; v_conditioning_requested int;
  v_solver jsonb; v_candidate jsonb; v_stimulus jsonb; v_challenge jsonb; v_gate jsonb;
  v_plan jsonb; v_conditioning jsonb; v_family jsonb; v_safety jsonb;
  v_blocks jsonb:='[]'::jsonb; v_planned int:=0; v_unallocated int:=0;
  v_challenge_dose_status text:='APPLIED';
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;
  if p_duration_minutes not between 20 and 120 then
    return jsonb_build_object('status','blocked','reason_code','DURATION_OUT_OF_RANGE','version','outdoor-planner-v1');
  end if;
  if v_surface is null then
    return jsonb_build_object('status','blocked','reason_code','SURFACE_REQUIRED_OUTDOOR','version','outdoor-planner-v1','place_context',v_ctx);
  end if;
  if v_format not in ('OUTDOOR_CONDITIONING','OUTDOOR_CONDITIONING_GYM','OUTDOOR_CONDITIONING_ABS') then
    return jsonb_build_object('status','blocked','reason_code','FORMAT_NOT_ALLOWED_FOR_ENVIRONMENT','version','outdoor-planner-v1','format_code',v_format);
  end if;

  perform set_config('ugerod.session_environment','OUTDOOR',true);
  perform set_config('ugerod.session_surface',v_surface,true);

  if v_format='OUTDOOR_CONDITIONING_GYM' then
    v_gym:=public.outdoor_build_street_gym_block_v1(p_user_id,p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty,least(10,greatest(6,p_duration_minutes/5)),p_progression_intent);
    if v_gym->>'status'<>'READY' then
      return jsonb_build_object('status','blocked','reason_code','EXPLICIT_OUTDOOR_GYM_REQUIRES_COMPATIBLE_DECLARED_EQUIPMENT','version','outdoor-planner-v1','gym_attempt',v_gym,'place_context',v_ctx);
    end if;
    v_gym_minutes:=coalesce((v_gym->>'duration_minutes')::int,0);
  elsif v_format='OUTDOOR_CONDITIONING_ABS' then
    v_abs:=public.outdoor_build_abs_tabata_v1(p_user_id,p_place_code,v_surface,p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty);
    if v_abs->>'status'='READY' then v_abs_minutes:=4; end if;
  end if;

  v_unlock_source:=public.c4_plan_full_session(p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty,greatest(8,p_candidate_count),'c4-final-default');
  select b into v_unlock from jsonb_array_elements(coalesce(v_unlock_source->'blocks','[]'::jsonb)) b where b->>'block_key'='unlock' limit 1;
  if v_unlock is null then
    return jsonb_build_object('status','blocked','reason_code','OUTDOOR_UNLOCK_NOT_COMPILABLE','version','outdoor-planner-v1','place_context',v_ctx);
  end if;

  v_conditioning_requested:=greatest(8,p_duration_minutes-coalesce((v_unlock->>'duration_minutes')::int,2)-v_gym_minutes-v_abs_minutes);
  v_solver:=public.solve_session_engine_c4(p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty,greatest(8,p_candidate_count),v_conditioning_requested,'c4-final-default');
  if v_solver->>'status'<>'READY' then
    return jsonb_build_object('status','blocked','reason_code','OUTDOOR_CONDITIONING_NOT_COMPILABLE','version','outdoor-planner-v1','solver_status',v_solver->>'status','place_context',v_ctx);
  end if;
  v_candidate:=v_solver->'selected_candidate';
  v_stimulus:=v_candidate->'stimulus';
  if v_stimulus is null then
    v_stimulus:=public.c1_stimulus_contract(p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,'c1-default');
  end if;

  v_challenge:=public.program_coach_challenge_target_v2(
    p_user_id,current_date,p_focus,p_readiness,p_progression_intent,'CONDITIONING',
    coalesce(nullif(v_candidate#>>'{c4_final,mechanic_json,wod_budget_minutes}','')::int,v_conditioning_requested),
    jsonb_array_length(coalesce(v_candidate->'exercises','[]'::jsonb)),p_zone_terms,'c4-final-default'
  );
  v_gate:=public.program_coach_challenge_longitudinal_gate_v1(p_user_id,current_date,v_challenge,'c4-final-default');
  v_challenge:=v_challenge||jsonb_build_object('effective_level',coalesce(v_gate->>'effective_level',v_challenge->>'effective_level','NORMAL'),'longitudinal_gate',v_gate);

  v_conditioning:=jsonb_build_object(
    'block_key','wod','block_name','Conditioning','required',true,'mechanic',v_candidate->>'mechanic',
    'duration_minutes',coalesce(nullif(v_candidate#>>'{c4_final,mechanic_json,wod_budget_minutes}','')::int,v_conditioning_requested),
    'mechanic_json',v_candidate#>'{c4_final,mechanic_json}','exercises',v_candidate->'exercises',
    'expected_outcome',jsonb_build_object('role','primary_training_stimulus','predicted_volume',v_candidate#>'{c4_final,predicted_volume}','whole_wod_metrics',v_candidate#>'{c4_final,whole_wod_metrics}')
  );
  v_plan:=jsonb_build_object(
    'status','READY','version','outdoor-planner-base-v1','stimulus',v_stimulus,'selected_candidate',v_candidate,
    'blocks',jsonb_build_array(v_conditioning),
    'architecture',jsonb_build_object('wod_minutes',v_conditioning->'duration_minutes','wod_target_minutes',v_conditioning->'duration_minutes','total_minutes',p_duration_minutes,'unallocated_available_minutes',greatest(0,p_duration_minutes-coalesce((v_conditioning->>'duration_minutes')::int,0)))
  );

  begin
    v_plan:=public.c4_apply_challenge_dose_v1(p_user_id,v_plan,v_challenge,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,p_zone_terms,p_inventory,p_max_complexity,'c4-final-default');
  exception when others then
    if position('Exact WOD duration must be >= 8 and lower than total session duration' in sqlerrm)>0 then
      v_challenge_dose_status:='BASE_PLAN_PRESERVED_INVALID_EXACT_DURATION';
    else
      raise;
    end if;
  end;

  select b into v_conditioning from jsonb_array_elements(coalesce(v_plan->'blocks','[]'::jsonb)) b where b->>'block_key'='wod' limit 1;
  v_conditioning:=v_conditioning||jsonb_build_object('block_key','conditioning','block_name','Conditioning');

  v_family:=public.outdoor_conditioning_family_decision_v1(p_place_code,v_surface,coalesce(v_plan#>>'{architecture,challenge_target,delivered_level}',v_gate->>'effective_level','NORMAL'),p_reliable_distance,p_running_allowed,p_calibration_opportunity);
  v_safety:=public.outdoor_safety_feasibility_v1(p_place_code,v_surface,v_family->>'family_code',p_reliable_distance,false,false);
  if not coalesce((v_safety->>'eligible')::boolean,true) then
    return jsonb_build_object('status','blocked','reason_code','OUTDOOR_SAFETY_OR_FEASIBILITY_CONFLICT','version','outdoor-planner-v1','safety',v_safety,'place_context',v_ctx);
  end if;
  v_conditioning:=v_conditioning||jsonb_build_object('conditioning_family_context',v_family,'outdoor_safety',v_safety,'running_is_optional_tool',true);

  v_blocks:=jsonb_build_array(v_unlock);
  if v_gym->>'status'='READY' then v_blocks:=v_blocks||jsonb_build_array(v_gym-'status'); end if;
  if v_abs->>'status'='READY' then v_blocks:=v_blocks||jsonb_build_array(v_abs-'status'); end if;
  v_blocks:=v_blocks||jsonb_build_array(v_conditioning);
  select coalesce(sum(coalesce((b->>'duration_minutes')::int,0)),0) into v_planned from jsonb_array_elements(v_blocks) b;
  v_unallocated:=greatest(0,p_duration_minutes-v_planned);

  return jsonb_build_object(
    'status','READY','version','outdoor-planner-v1.2-challenge-fail-safe','environment_code','OUTDOOR','format_code',v_format,
    'place_context',v_ctx,'blocks',v_blocks,
    'architecture',jsonb_build_object('block_order',(select jsonb_agg(b->>'block_key' order by ord) from jsonb_array_elements(v_blocks) with ordinality z(b,ord)),'planned_minutes',v_planned,'requested_minutes',p_duration_minutes,'unallocated_available_minutes',v_unallocated,'duration_is_maximum_not_fill_target',true),
    'challenge_target',v_plan#>'{architecture,challenge_target}','conditioning_family_context',v_family,
    'street_gym_opportunity',public.outdoor_street_candidates_v1(p_user_id,p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty,20),
    'authority',jsonb_build_object('place_is_weak_modifier',true,'equipment_inferred_from_place',false,'safety_and_pain_override',true,'program_history_recovery_override_place',true,'generation_persistence_enabled',false),
    'explainability',jsonb_build_object('architecture_reason',case v_format when 'OUTDOOR_CONDITIONING_GYM' then 'EXPLICIT_GYM_FORMAT_WITH_DECLARED_COMPATIBLE_EQUIPMENT' when 'OUTDOOR_CONDITIONING_ABS' then 'EXPLICIT_OPTIONAL_CORE_FORMAT' else 'OUTDOOR_CONDITIONING_DEFAULT' end,'place_reason',v_family->>'reason','running_not_mandatory',true,'challenge_dose_status',v_challenge_dose_status)
  );
end;
$function$;
