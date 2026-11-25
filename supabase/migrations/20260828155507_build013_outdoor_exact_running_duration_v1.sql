create or replace function public.normalize_user_builder_outdoor_running_workout_v1(p_workout jsonb)
returns jsonb
language plpgsql
immutable
set search_path='public'
as $function$
declare
  v_workout jsonb:=coalesce(p_workout,'{}'::jsonb);
  v_blocks jsonb:='[]'::jsonb;
  v_block jsonb;
  v_mechanic text;
  v_params jsonb;
  v_repeats numeric;
  v_work numeric;
  v_recovery numeric;
  v_exact_seconds int;
begin
  if jsonb_typeof(v_workout->'blocks') is distinct from 'array' then return v_workout; end if;

  for v_block in select value from jsonb_array_elements(v_workout->'blocks') loop
    v_mechanic:=upper(coalesce(
      v_block->>'mechanic',
      v_block#>>'{mechanic_json,mechanic_key}',
      v_block#>>'{settings,mechanic_key}',
      ''
    ));

    if v_mechanic in ('RUN_INTERVALS','RUN_FARTLEK') then
      v_params:=coalesce(v_block#>'{mechanic_json,parameters}',case when jsonb_typeof(v_block->'settings')='object' then (v_block->'settings')-'mechanic_key' else '{}'::jsonb end,'{}'::jsonb);
      begin v_repeats:=nullif(v_params->>'repeats','')::numeric; exception when others then v_repeats:=null; end;
      begin v_work:=nullif(v_params->>'work_seconds','')::numeric; exception when others then v_work:=null; end;
      begin v_recovery:=nullif(v_params->>'recovery_seconds','')::numeric; exception when others then v_recovery:=null; end;

      if coalesce(v_repeats,0)>0 and coalesce(v_work,0)>0 and coalesce(v_recovery,-1)>=0 then
        v_exact_seconds:=round(v_repeats*(v_work+v_recovery))::int;
        v_params:=v_params||jsonb_build_object(
          'duration_seconds',v_exact_seconds,
          'interval_structure_duration_seconds',v_exact_seconds,
          'duration_source','INTERVAL_STRUCTURE_EXACT'
        );
        v_block:=jsonb_set(v_block,'{mechanic_json}',jsonb_build_object(
          'mechanic_key',v_mechanic,
          'parameters',v_params,
          'source',coalesce(v_block#>>'{mechanic_json,source}','user_session_builder')
        ),true);
      end if;
    end if;

    v_blocks:=v_blocks||jsonb_build_array(v_block);
  end loop;

  return jsonb_set(v_workout,'{blocks}',v_blocks,true);
end;
$function$;

create or replace function public.normalize_user_builder_outdoor_running_session_v1()
returns trigger
language plpgsql
set search_path='public'
as $function$
begin
  if upper(coalesce(new.planned_environment_code,''))='OUTDOOR'
     and coalesce(new.planning_context_json->>'session_source','')='user_session_builder'
     and new.generated_workout is not null then
    new.generated_workout:=public.normalize_user_builder_outdoor_running_workout_v1(new.generated_workout);
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_normalize_user_builder_outdoor_running_session_v1 on public.workout_sessions;
create trigger trg_normalize_user_builder_outdoor_running_session_v1
before insert or update of generated_workout,planned_environment_code,planning_context_json
on public.workout_sessions
for each row execute function public.normalize_user_builder_outdoor_running_session_v1();

create or replace function public.outdoor_enrich_protocol_outcome_v1(p_session_id uuid, p_actual jsonb)
returns jsonb
language plpgsql
stable security definer
set search_path='public'
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
  v_work numeric;
  v_recovery numeric;
begin
  if p_actual is null then return null; end if;
  if jsonb_typeof(p_actual) <> 'object' then raise exception 'Protocol outcome must be a JSON object'; end if;

  select user_id,planned_environment_code,planning_context_json->>'session_source',coalesce(generated_workout,'{}'::jsonb)
  into v_user_id,v_environment,v_source,v_generated
  from public.workout_sessions where id=p_session_id;
  if not found then raise exception 'Session not found'; end if;
  if auth.uid() is not null and auth.uid()<>v_user_id then raise exception 'Forbidden user'; end if;

  if coalesce(v_environment,'')<>'OUTDOOR' and coalesce(v_source,'')<>'outdoor_auto_generation' then return p_actual; end if;

  select b into v_block
  from jsonb_array_elements(coalesce(v_generated->'blocks','[]'::jsonb)) b
  where (lower(coalesce(b->>'block_key',''))='conditioning' or upper(coalesce(b->>'module_code',''))='CONDITIONING')
    and upper(coalesce(b->>'mechanic',b#>>'{mechanic_json,mechanic_key}',b#>>'{settings,mechanic_key}',b#>>'{exercises,0,prescription,mechanic}','')) like 'RUN_%'
  limit 1;

  if v_block is null then return p_actual; end if;

  v_mechanic:=upper(coalesce(v_block->>'mechanic',v_block#>>'{mechanic_json,mechanic_key}',v_block#>>'{settings,mechanic_key}',v_block#>>'{exercises,0,prescription,mechanic}'));
  v_params:=coalesce(v_block#>'{mechanic_json,parameters}',v_block#>'{running_protocol,parameters}',case when jsonb_typeof(v_block->'settings')='object' then (v_block->'settings')-'mechanic_key' else null end,'{}'::jsonb);

  v_family:=coalesce(v_block#>>'{running_protocol,family_code}',v_block#>>'{running_family_context,family_code}',v_block#>>'{exercises,0,prescription,running_family_code}');
  v_repeats:=public.jsonb_num(v_params,'repeats');
  v_work:=public.jsonb_num(v_params,'work_seconds');
  v_recovery:=public.jsonb_num(v_params,'recovery_seconds');

  if v_mechanic in ('RUN_INTERVALS','RUN_FARTLEK') and coalesce(v_repeats,0)>0 and coalesce(v_work,0)>0 and coalesce(v_recovery,-1)>=0 then
    v_planned_duration:=v_repeats*(v_work+v_recovery);
  else
    if not (v_params ? 'duration_seconds') and public.jsonb_num(v_block,'duration_minutes') is not null then
      v_params:=v_params||jsonb_build_object('duration_seconds',round(public.jsonb_num(v_block,'duration_minutes')*60)::int);
    end if;
    v_planned_duration:=coalesce(public.jsonb_num(v_params,'duration_seconds'),public.jsonb_num(v_block,'duration_minutes')*60);
  end if;

  return jsonb_strip_nulls(p_actual || jsonb_build_object(
    'running_mechanic',v_mechanic,
    'running_family_code',v_family,
    'planned_duration_seconds',coalesce(public.jsonb_num(p_actual,'planned_duration_seconds'),v_planned_duration),
    'planned_intervals',case when v_mechanic in ('RUN_INTERVALS','RUN_FARTLEK') then coalesce(public.jsonb_num(p_actual,'planned_intervals'),v_repeats) else public.jsonb_num(p_actual,'planned_intervals') end,
    'planned_work_seconds',v_work,
    'planned_recovery_seconds',v_recovery,
    'reliable_distance',coalesce((case when lower(coalesce(v_params->>'reliable_distance','')) in ('true','false') then (v_params->>'reliable_distance')::boolean end),false),
    'outdoor_protocol_enriched',true,
    'outdoor_protocol_contract','outdoor-running-completion-v1',
    'planned_duration_source',case when v_mechanic in ('RUN_INTERVALS','RUN_FARTLEK') and coalesce(v_repeats,0)>0 and coalesce(v_work,0)>0 and coalesce(v_recovery,-1)>=0 then 'INTERVAL_STRUCTURE_EXACT' else 'BLOCK_DURATION' end
  ));
end;
$function$;

revoke all on function public.normalize_user_builder_outdoor_running_workout_v1(jsonb) from public,anon,authenticated;
revoke all on function public.normalize_user_builder_outdoor_running_session_v1() from public,anon,authenticated;
grant execute on function public.outdoor_enrich_protocol_outcome_v1(uuid,jsonb) to authenticated,service_role;
