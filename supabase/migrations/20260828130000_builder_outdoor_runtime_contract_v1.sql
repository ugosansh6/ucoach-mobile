-- UGEROD — User Builder Outdoor runtime contract
-- 2026-08-28
--
-- A Builder CONDITIONING block is intentionally persisted with the historical
-- downstream block_key="wod", but the environment player needs the real
-- RUN_* mechanic on the generated block. Preserve module_code and add the same
-- top-level mechanic/mechanic_json contract used by auto-generated Outdoor
-- sessions. Also let Outdoor protocol enrichment resolve Builder conditioning
-- blocks without changing their canonical downstream block_key.

begin;

create or replace function public.commit_user_session_draft_v2(
  p_draft_id uuid,
  p_start_now boolean default false,
  p_accept_warnings boolean default false
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_validation jsonb;
  v_result jsonb;
  v_session_id uuid;
  v_workout jsonb;
  v_blocks jsonb:='[]'::jsonb;
  v_block jsonb;
  v_mechanic text;
  v_params jsonb;
  v_duration numeric;
  v_module text;
  v_settings jsonb;
begin
  v_validation:=public.validate_user_session_draft_v2(p_draft_id,3,'Intermédiaire');
  if not coalesce((v_validation->>'pass')::boolean,false) then
    raise exception 'Session draft has hard validation errors';
  end if;
  if coalesce((v_validation->>'warning_count')::int,0)>0 and not coalesce(p_accept_warnings,false) then
    raise exception 'Session draft has warnings that require explicit acceptance';
  end if;

  v_result:=public.commit_user_session_draft_v1(p_draft_id,p_start_now,p_accept_warnings);
  v_session_id:=nullif(v_result->>'session_id','')::uuid;

  if v_session_id is not null then
    select generated_workout into v_workout
    from public.workout_sessions
    where id=v_session_id;

    for v_block in
      select value from jsonb_array_elements(coalesce(v_workout->'blocks','[]'::jsonb))
    loop
      v_module:=upper(trim(coalesce(v_block->>'module_code','')));
      v_mechanic:=nullif(upper(trim(coalesce(
        v_block->>'mechanic',
        v_block#>>'{mechanic_json,mechanic_key}',
        v_block#>>'{settings,mechanic_key}',
        v_block#>>'{exercises,0,prescription,mechanic}',
        ''
      ))),'');

      if v_mechanic is not null then
        begin
          v_duration:=nullif(v_block->>'duration_minutes','')::numeric;
        exception when others then
          v_duration:=null;
        end;

        v_settings:=coalesce(v_block->'settings','{}'::jsonb);

        if v_module='WOD' then
          v_params:=public.user_session_builder_wod_parameters_v1(v_settings,v_duration);
        else
          v_params:=coalesce(v_settings-'mechanic_key','{}'::jsonb);
          if v_mechanic like 'RUN_%' and v_duration is not null and not (v_params ? 'duration_seconds') then
            v_params:=v_params||jsonb_build_object('duration_seconds',round(v_duration*60)::int);
          end if;
        end if;

        v_block:=jsonb_set(v_block,'{mechanic}',to_jsonb(v_mechanic),true);
        v_block:=jsonb_set(v_block,'{mechanic_json}',jsonb_build_object(
          'mechanic_key',v_mechanic,
          'parameters',coalesce(v_params,'{}'::jsonb),
          'source','user_session_builder'
        ),true);
      end if;

      v_blocks:=v_blocks||jsonb_build_array(v_block);
    end loop;

    v_workout:=jsonb_set(v_workout,'{blocks}',v_blocks,true);

    select upper(trim(b.module_code)),
           upper(trim(b.settings_json->>'mechanic_key')),
           b.duration_minutes,
           coalesce(b.settings_json,'{}'::jsonb)
      into v_module,v_mechanic,v_duration,v_settings
    from public.user_session_draft_blocks b
    where b.draft_id=p_draft_id
      and b.module_code in ('WOD','CONDITIONING','CARDIO')
      and nullif(trim(coalesce(b.settings_json->>'mechanic_key','')),'') is not null
    order by case when b.module_code='WOD' then 0 else 1 end,b.position
    limit 1;

    if v_mechanic is not null then
      if v_module='WOD' then
        v_params:=public.user_session_builder_wod_parameters_v1(v_settings,v_duration);
      else
        v_params:=coalesce(v_settings-'mechanic_key','{}'::jsonb);
        if v_mechanic like 'RUN_%' and v_duration is not null and not (v_params ? 'duration_seconds') then
          v_params:=v_params||jsonb_build_object('duration_seconds',round(v_duration*60)::int);
        end if;
      end if;
    end if;

    update public.workout_sessions
    set generated_workout=v_workout,
        mechanic_json=case when v_mechanic is not null then
          jsonb_build_object(
            'mechanic_key',v_mechanic,
            'parameters',coalesce(v_params,'{}'::jsonb),
            'source','user_session_builder',
            'format_code',(select format_code from public.user_session_drafts where id=p_draft_id),
            'preparation_auto_generated',true
          ) else mechanic_json end,
        updated_at=now()
    where id=v_session_id;
  end if;

  return v_result||jsonb_build_object(
    'validated_with','user-session-builder-validation-v2',
    'commit_entrypoint','commit-user-session-draft-v2',
    'wod_parameters_normalized',true,
    'environment_mechanics_normalized',true,
    'runtime_contract','user-session-builder-runtime-v2.1-environment-mechanics'
  );
end;
$function$;

create or replace function public.outdoor_enrich_protocol_outcome_v1(
  p_session_id uuid,
  p_actual jsonb
) returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_user_id uuid;
  v_environment text;
  v_source text;
  v_generated jsonb;
  v_block jsonb;
  v_params jsonb := '{}'::jsonb;
  v_mechanic text;
  v_family text;
  v_planned_duration numeric;
  v_repeats numeric;
begin
  if p_actual is null then return null; end if;
  if jsonb_typeof(p_actual) <> 'object' then raise exception 'Protocol outcome must be a JSON object'; end if;

  select user_id,planned_environment_code,planning_context_json->>'session_source',coalesce(generated_workout,'{}'::jsonb)
  into v_user_id,v_environment,v_source,v_generated
  from public.workout_sessions where id=p_session_id;
  if not found then raise exception 'Session not found'; end if;
  if auth.uid() is not null and auth.uid()<>v_user_id then raise exception 'Forbidden user'; end if;

  if coalesce(v_environment,'')<>'OUTDOOR' and coalesce(v_source,'')<>'outdoor_auto_generation' then
    return p_actual;
  end if;

  select b into v_block
  from jsonb_array_elements(coalesce(v_generated->'blocks','[]'::jsonb)) b
  where (
      lower(coalesce(b->>'block_key',''))='conditioning'
      or upper(coalesce(b->>'module_code',''))='CONDITIONING'
    )
    and upper(coalesce(
      b->>'mechanic',
      b#>>'{mechanic_json,mechanic_key}',
      b#>>'{settings,mechanic_key}',
      b#>>'{exercises,0,prescription,mechanic}',
      ''
    )) like 'RUN_%'
  limit 1;

  if v_block is null then return p_actual; end if;

  v_mechanic:=upper(coalesce(
    v_block->>'mechanic',
    v_block#>>'{mechanic_json,mechanic_key}',
    v_block#>>'{settings,mechanic_key}',
    v_block#>>'{exercises,0,prescription,mechanic}'
  ));

  v_params:=coalesce(
    v_block#>'{mechanic_json,parameters}',
    v_block#>'{running_protocol,parameters}',
    case when jsonb_typeof(v_block->'settings')='object' then (v_block->'settings')-'mechanic_key' else null end,
    '{}'::jsonb
  );

  if not (v_params ? 'duration_seconds') and public.jsonb_num(v_block,'duration_minutes') is not null then
    v_params:=v_params||jsonb_build_object('duration_seconds',round(public.jsonb_num(v_block,'duration_minutes')*60)::int);
  end if;

  v_family:=coalesce(
    v_block#>>'{running_protocol,family_code}',
    v_block#>>'{running_family_context,family_code}',
    v_block#>>'{exercises,0,prescription,running_family_code}'
  );
  v_planned_duration:=coalesce(public.jsonb_num(v_params,'duration_seconds'),public.jsonb_num(v_block,'duration_minutes')*60);
  v_repeats:=public.jsonb_num(v_params,'repeats');

  return jsonb_strip_nulls(
    p_actual || jsonb_build_object(
      'running_mechanic',v_mechanic,
      'running_family_code',v_family,
      'planned_duration_seconds',coalesce(public.jsonb_num(p_actual,'planned_duration_seconds'),v_planned_duration),
      'planned_intervals',case when v_mechanic in ('RUN_INTERVALS','RUN_FARTLEK') then coalesce(public.jsonb_num(p_actual,'planned_intervals'),v_repeats) else public.jsonb_num(p_actual,'planned_intervals') end,
      'planned_work_seconds',public.jsonb_num(v_params,'work_seconds'),
      'planned_recovery_seconds',public.jsonb_num(v_params,'recovery_seconds'),
      'reliable_distance',coalesce((case when lower(coalesce(v_params->>'reliable_distance','')) in ('true','false') then (v_params->>'reliable_distance')::boolean end),false),
      'outdoor_protocol_enriched',true,
      'outdoor_protocol_contract','outdoor-running-completion-v1'
    )
  );
end;
$function$;

commit;
