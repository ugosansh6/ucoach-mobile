create or replace function public.get_user_session_builder_bootstrap_v1(p_environment_code text default null)
returns jsonb
language plpgsql
stable
set search_path='public'
as $function$
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
      jsonb_build_object('mechanic_key','RUN_CONTINUOUS','label_fr','Allure modérée','description_fr','Course continue à un rythme confortable : tu peux encore parler.','requires_intervals',false),
      jsonb_build_object('mechanic_key','RUN_INTERVALS','label_fr','Intervalles','description_fr','Alterne des temps d’effort et de récupération que tu définis.','requires_intervals',true),
      jsonb_build_object('mechanic_key','RUN_FARTLEK','label_fr','Fartlek','description_fr','Alterne des phases plus vives et des phases à allure modérée.','requires_intervals',true)
    );

    select jsonb_build_object(
      'exercise_id',e.id,
      'name',coalesce(e.display_name,e.name),
      'body_region',e.body_region,
      'movement_pattern',e.movement_pattern,
      'exercise_family',e.exercise_family,
      'training_categories',to_jsonb(array_remove(array[
        case when lower(coalesce(e.exercise_type,''))='strength' or lower(coalesce(e.training_focus,'')) in ('strength','hypertrophy') or 'STRENGTH'=any(coalesce(e.usable_for,'{}'::text[])) then 'STRENGTH' end,
        case when lower(coalesce(e.exercise_type,'')) in ('conditioning','general') or lower(coalesce(e.training_focus,''))='conditioning' or 'WOD'=any(coalesce(e.usable_for,'{}'::text[])) then 'CONDITIONING' end,
        case when lower(coalesce(e.exercise_type,'')) in ('skill','gymnastique') or 'Skill'=any(coalesce(e.usable_for,'{}'::text[])) then 'SKILL' end
      ]::text[],null)),
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
