CREATE OR REPLACE FUNCTION public.get_user_session_builder_bootstrap_v1(p_environment_code text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
declare
  v_env text;
  v_envs jsonb;
  v_formats jsonb;
  v_modules jsonb;
  v_styles jsonb;
  v_surfaces jsonb;
  v_wod_mechanics jsonb;
  v_conditioning_modes jsonb:='[]'::jsonb;
  v_conditioning_exercise jsonb:=null;
begin
  v_env:=case when p_environment_code is null or trim(p_environment_code)='' then null else public.normalize_session_environment_v1(p_environment_code) end;

  select coalesce(jsonb_agg(jsonb_build_object('environment_code',environment_code,'label_fr',label_fr,'description_fr',description_fr) order by sort_order,environment_code),'[]'::jsonb)
    into v_envs
  from public.session_environment_catalog
  where active=true and environment_code<>'UNKNOWN';

  select coalesce(jsonb_agg(jsonb_build_object(
    'environment_code',ep.environment_code,
    'format_code',sf.format_code,
    'label_fr',sf.label_fr,
    'description_fr',sf.description_fr,
    'module_order',sf.module_order,
    'is_default',ep.is_default,
    'user_buildable',sf.user_buildable,
    'auto_generation_enabled',coalesce((ep.constraints_json->>'generation_enabled')::boolean,false),
    'compiler_status',ep.constraints_json->>'compiler_status'
  ) order by sf.sort_order,sf.format_code),'[]'::jsonb)
    into v_formats
  from public.environment_session_format_policy ep
  join public.session_format_catalog sf on sf.format_code=ep.format_code
  where sf.active=true and sf.user_buildable=true and (v_env is null or ep.environment_code=v_env);

  if v_env is null then
    v_modules:='[]'::jsonb;
  else
    select coalesce(jsonb_agg(jsonb_build_object('module_code',module_code,'source_formats',source_formats) order by module_code),'[]'::jsonb)
      into v_modules
    from public.user_session_builder_allowed_modules_v1(v_env,null);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'style_code',style_code,
    'label_fr',label_fr,
    'mechanic_key',mechanic_key,
    'grouping_mode',grouping_mode,
    'is_default',is_default,
    'description_fr',description_fr
  ) order by is_default desc,style_code),'[]'::jsonb)
    into v_styles
  from public.gym_execution_style_catalog
  where active=true;

  select coalesce(jsonb_agg(jsonb_build_object(
    'mechanic_key',mechanic_key,
    'display_name',display_name,
    'short_description',short_description,
    'duration_semantic',duration_semantic,
    'format_family',format_family
  ) order by case mechanic_key when 'AMRAP' then 1 when 'FOR_TIME' then 2 when 'EMOM' then 3 when 'CIRCUIT' then 4 when 'HIIT' then 5 when 'LADDER' then 6 else 99 end,mechanic_key),'[]'::jsonb)
    into v_wod_mechanics
  from public.workout_mechanics
  where active=true and mechanic_kind='core' and manual_free_eligible=true;

  v_surfaces:=case
    when v_env='OUTDOOR' then jsonb_build_array('GRASS','TRACK','ROAD','TRAIL','SAND','MIXED')
    when v_env in ('HOME','BOX','GYM') then jsonb_build_array('INDOOR_FLOOR','RUBBER')
    else '[]'::jsonb
  end;

  if v_env='OUTDOOR' then
    v_conditioning_modes:=jsonb_build_array(
      jsonb_build_object(
        'mechanic_key','RUN_CONTINUOUS',
        'label_fr','Allure modérée',
        'description_fr','Course continue à un rythme confortable : tu peux encore parler.',
        'requires_intervals',false
      ),
      jsonb_build_object(
        'mechanic_key','RUN_INTERVALS',
        'label_fr','Intervalles',
        'description_fr','Alterne des temps d’effort et de récupération que tu définis.',
        'requires_intervals',true
      ),
      jsonb_build_object(
        'mechanic_key','RUN_FARTLEK',
        'label_fr','Fartlek',
        'description_fr','Alterne des phases plus vives et des phases à allure modérée.',
        'requires_intervals',true
      )
    );

    select jsonb_build_object(
      'exercise_id',e.id,
      'name',coalesce(e.display_name,e.name),
      'body_region',e.body_region,
      'movement_pattern',e.movement_pattern,
      'exercise_family',e.exercise_family,
      'training_categories',e.training_categories,
      'tracking_modes',e.tracking_modes,
      'prescription_type',e.prescription_type,
      'warning_codes','[]'::jsonb,
      'selectable',true,
      'canonical_outdoor_running_exercise',true
    )
    into v_conditioning_exercise
    from public.exercises e
    where e.id='EX313';
  end if;

  return jsonb_build_object(
    'environments',v_envs,
    'selected_environment',v_env,
    'formats',v_formats,
    'modules',v_modules,
    'gym_execution_styles',case when v_env='GYM' then v_styles else '[]'::jsonb end,
    'wod_mechanics',v_wod_mechanics,
    'outdoor_conditioning_modes',v_conditioning_modes,
    'outdoor_conditioning_exercise',v_conditioning_exercise,
    'surface_options',v_surfaces,
    'surface_required',v_env='OUTDOOR',
    'manual_builder_independent_of_auto_generation',true,
    'completion_rpc','complete_workout_session_v3',
    'version','user-session-builder-bootstrap-v3-outdoor-conditioning'
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.validate_user_session_draft_v2(p_draft_id uuid, p_max_complexity integer DEFAULT 3, p_max_difficulty text DEFAULT 'Intermédiaire'::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_result jsonb;
  v_errors jsonb;
  v_warnings jsonb;
  v_block record;
  v_mechanic text;
  v_rounds numeric;
  v_cap numeric;
  v_rest numeric;
  v_duration numeric;
  v_work numeric;
  v_total_seconds numeric;
  v_item_count int;
  v_course_count int;
begin
  v_result:=public.validate_user_session_draft_v1(p_draft_id,p_max_complexity,p_max_difficulty);
  v_errors:=coalesce(v_result->'errors','[]'::jsonb);
  v_warnings:=coalesce(v_result->'warnings','[]'::jsonb);

  for v_block in
    select b.*
    from public.user_session_draft_blocks b
    where b.draft_id=p_draft_id and b.module_code='WOD'
    order by b.position
  loop
    v_mechanic:=nullif(upper(trim(coalesce(v_block.settings_json->>'mechanic_key',''))),'');

    if v_mechanic is null then continue; end if;

    if not exists(
      select 1 from public.workout_mechanics m
      where m.mechanic_key=v_mechanic
        and m.active=true
        and m.mechanic_kind='core'
        and m.manual_free_eligible=true
    ) then
      v_errors:=v_errors||jsonb_build_array(jsonb_build_object(
        'code','WOD_MECHANIC_NOT_AVAILABLE','block_id',v_block.id,'mechanic_key',v_mechanic
      ));
      continue;
    end if;

    begin v_duration:=v_block.duration_minutes::numeric; exception when others then v_duration:=null; end;
    begin v_rounds:=nullif(v_block.settings_json->>'rounds','')::numeric; exception when others then v_rounds:=null; end;
    begin v_cap:=nullif(v_block.settings_json->>'time_cap_minutes','')::numeric; exception when others then v_cap:=null; end;
    begin v_rest:=nullif(v_block.settings_json->>'rest_seconds','')::numeric; exception when others then v_rest:=null; end;

    if v_mechanic in ('AMRAP','EMOM') and coalesce(v_duration,0)<=0 then
      v_errors:=v_errors||jsonb_build_array(jsonb_build_object(
        'code','WOD_DURATION_REQUIRED','block_id',v_block.id,'mechanic_key',v_mechanic
      ));
    end if;

    if v_mechanic='FOR_TIME' then
      if coalesce(v_rounds,0)<=0 then
        v_errors:=v_errors||jsonb_build_array(jsonb_build_object(
          'code','WOD_ROUNDS_REQUIRED','block_id',v_block.id,'mechanic_key',v_mechanic
        ));
      end if;
      if v_block.settings_json ? 'time_cap_minutes' and coalesce(v_cap,0)<=0 then
        v_errors:=v_errors||jsonb_build_array(jsonb_build_object(
          'code','WOD_TIME_CAP_INVALID','block_id',v_block.id,'mechanic_key',v_mechanic
        ));
      end if;
      if coalesce(v_cap,v_duration,0)<=0 then
        v_errors:=v_errors||jsonb_build_array(jsonb_build_object(
          'code','WOD_DURATION_REQUIRED','block_id',v_block.id,'mechanic_key',v_mechanic
        ));
      end if;
    end if;

    if v_mechanic='CIRCUIT' then
      if coalesce(v_rounds,0)<=0 then
        v_errors:=v_errors||jsonb_build_array(jsonb_build_object(
          'code','WOD_ROUNDS_REQUIRED','block_id',v_block.id,'mechanic_key',v_mechanic
        ));
      end if;
      if v_block.settings_json ? 'rest_seconds' and coalesce(v_rest,-1)<0 then
        v_errors:=v_errors||jsonb_build_array(jsonb_build_object(
          'code','WOD_REST_INVALID','block_id',v_block.id,'mechanic_key',v_mechanic
        ));
      end if;
    end if;
  end loop;

  for v_block in
    select b.*
    from public.user_session_draft_blocks b
    where b.draft_id=p_draft_id and b.module_code='CONDITIONING'
    order by b.position
  loop
    v_mechanic:=nullif(upper(trim(coalesce(v_block.settings_json->>'mechanic_key',''))),'');

    if v_mechanic is null then
      v_errors:=v_errors||jsonb_build_array(jsonb_build_object(
        'code','CONDITIONING_MODE_REQUIRED','block_id',v_block.id
      ));
      continue;
    end if;

    if v_mechanic not in ('RUN_CONTINUOUS','RUN_INTERVALS','RUN_FARTLEK') then
      v_errors:=v_errors||jsonb_build_array(jsonb_build_object(
        'code','CONDITIONING_MODE_NOT_AVAILABLE','block_id',v_block.id,'mechanic_key',v_mechanic
      ));
      continue;
    end if;

    select count(*),count(*) filter(where i.exercise_id='EX313')
      into v_item_count,v_course_count
    from public.user_session_draft_items i
    where i.block_id=v_block.id;

    if v_item_count<>1 or v_course_count<>1 then
      v_errors:=v_errors||jsonb_build_array(jsonb_build_object(
        'code','RUNNING_CONDITIONING_REQUIRES_COURSE','block_id',v_block.id,
        'expected_exercise_id','EX313','actual_item_count',v_item_count
      ));
    end if;

    begin v_duration:=v_block.duration_minutes::numeric; exception when others then v_duration:=null; end;
    begin v_rounds:=nullif(v_block.settings_json->>'repeats','')::numeric; exception when others then v_rounds:=null; end;
    begin v_work:=nullif(v_block.settings_json->>'work_seconds','')::numeric; exception when others then v_work:=null; end;
    begin v_rest:=nullif(v_block.settings_json->>'recovery_seconds','')::numeric; exception when others then v_rest:=null; end;

    if v_mechanic='RUN_CONTINUOUS' then
      if coalesce(v_duration,0)<8 then
        v_errors:=v_errors||jsonb_build_array(jsonb_build_object(
          'code','RUNNING_BLOCK_TOO_SHORT','block_id',v_block.id,'minimum_minutes',8
        ));
      end if;
    else
      if coalesce(v_rounds,0)<=0 or coalesce(v_work,0)<=0 or coalesce(v_rest,-1)<0 then
        v_errors:=v_errors||jsonb_build_array(jsonb_build_object(
          'code','RUNNING_INTERVAL_STRUCTURE_REQUIRED','block_id',v_block.id,'mechanic_key',v_mechanic
        ));
      else
        v_total_seconds:=v_rounds*(v_work+v_rest);
        if v_total_seconds<480 then
          v_errors:=v_errors||jsonb_build_array(jsonb_build_object(
            'code','RUNNING_BLOCK_TOO_SHORT','block_id',v_block.id,'minimum_minutes',8,
            'calculated_minutes',round(v_total_seconds/60.0,1)
          ));
        end if;
      end if;
    end if;
  end loop;

  v_result:=jsonb_set(v_result,'{errors}',v_errors,true);
  v_result:=jsonb_set(v_result,'{warnings}',v_warnings,true);
  v_result:=jsonb_set(v_result,'{hard_error_count}',to_jsonb(jsonb_array_length(v_errors)),true);
  v_result:=jsonb_set(v_result,'{warning_count}',to_jsonb(jsonb_array_length(v_warnings)),true);
  v_result:=jsonb_set(v_result,'{pass}',to_jsonb(jsonb_array_length(v_errors)=0),true);
  v_result:=jsonb_set(v_result,'{status}',to_jsonb(case when jsonb_array_length(v_errors)=0 then 'READY' else 'NEEDS_CHANGES' end),true);
  v_result:=jsonb_set(v_result,'{builder_validation_version}',to_jsonb('user-session-builder-validation-v3-outdoor-conditioning'::text),true);

  update public.user_session_drafts
  set status=case when jsonb_array_length(v_errors)=0 then 'validated' else 'draft' end,
      validation_json=v_result,
      updated_at=now()
  where id=p_draft_id;

  return v_result;
end;
$function$;
