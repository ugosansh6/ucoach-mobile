-- Final budget composition for Outdoor Conditioning + WOD.
-- Reuse the full Outdoor conditioning planner and the same C4 WOD engine as HOME/BOX.

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
  v_ctx jsonb;
  v_surface text;
  v_legacy jsonb;
  v_wod jsonb;
  v_wod_minutes int:=0;
  v_base jsonb;
  v_unlock jsonb;
  v_conditioning jsonb;
  v_conditioning_minutes int:=0;
  v_compiled jsonb;
  v_family jsonb;
  v_blocks jsonb:='[]'::jsonb;
  v_planned int:=0;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;

  if v_format<>'OUTDOOR_CONDITIONING_WOD' then
    return public.outdoor_plan_session_v2(
      p_user_id,p_duration_minutes,p_readiness,p_focus,p_target_region,p_progression_intent,
      p_zone_terms,p_inventory,p_place_code,p_surface_code,p_format_code,p_reliable_distance,
      p_running_allowed,p_calibration_opportunity,p_max_complexity,p_max_difficulty,p_candidate_count
    );
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

  v_base:=public.outdoor_plan_session_v2(
    p_user_id,p_duration_minutes,p_readiness,p_focus,p_target_region,p_progression_intent,
    p_zone_terms,p_inventory,p_place_code,p_surface_code,'OUTDOOR_CONDITIONING',p_reliable_distance,
    p_running_allowed,p_calibration_opportunity,p_max_complexity,p_max_difficulty,p_candidate_count
  );
  if v_base->>'status'<>'READY' then
    return v_base||jsonb_build_object('format_code',v_format,'version','outdoor-planner-v3.1-conditioning-wod');
  end if;

  v_legacy:=public.c4_plan_full_session(
    p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
    p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty,greatest(8,p_candidate_count),'c4-final-default'
  );
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
    return jsonb_build_object(
      'status','blocked','reason_code','DURATION_TOO_SHORT_FOR_CONDITIONING_PLUS_HOME_BOX_WOD',
      'format_code',v_format,'requested_minutes',p_duration_minutes,'wod_minutes',v_wod_minutes,
      'conditioning_minutes_available',v_conditioning_minutes,'minimum_conditioning_minutes',8,
      'version','outdoor-planner-v3.1-conditioning-wod'
    );
  end if;

  v_family:=coalesce(v_base->'running_family_opportunity','{}'::jsonb);
  if v_family->>'status'='FAMILY_SELECTED' then
    v_compiled:=public.outdoor_compile_running_block_v1(v_family,v_conditioning_minutes,p_reliable_distance);
    if v_compiled->>'status'='READY' then
      v_conditioning:=v_compiled-'status';
    else
      v_conditioning:=v_conditioning||jsonb_build_object('duration_minutes',v_conditioning_minutes);
    end if;
  else
    v_conditioning:=v_conditioning||jsonb_build_object('duration_minutes',v_conditioning_minutes);
  end if;

  v_wod:=v_wod||jsonb_build_object(
    'module_code','WOD',
    'wod_source','C4_HOME_BOX_WOD',
    'outdoor_reused_legacy_wod',true
  );

  v_blocks:=jsonb_build_array(v_unlock,v_conditioning,v_wod);
  select coalesce(sum(coalesce((b->>'duration_minutes')::int,0)),0)
    into v_planned
  from jsonb_array_elements(v_blocks) b;

  return v_base||jsonb_build_object(
    'status','READY',
    'format_code',v_format,
    'blocks',v_blocks,
    'architecture',coalesce(v_base->'architecture','{}'::jsonb)||jsonb_build_object(
      'block_order',jsonb_build_array('unlock','conditioning','wod'),
      'planned_minutes',v_planned,
      'requested_minutes',p_duration_minutes,
      'unallocated_available_minutes',greatest(0,p_duration_minutes-v_planned),
      'duration_is_maximum_not_fill_target',true,
      'wod_minutes',v_wod_minutes,
      'conditioning_minutes',v_conditioning_minutes
    ),
    'explainability',coalesce(v_base->'explainability','{}'::jsonb)||jsonb_build_object(
      'architecture_reason','EXPLICIT_CONDITIONING_PLUS_HOME_BOX_WOD',
      'wod_source','C4_HOME_BOX_WOD',
      'wod_compiled_under_outdoor_hard_gates',true
    ),
    'version','outdoor-planner-v3.1-conditioning-wod'
  );
end;
$function$;
