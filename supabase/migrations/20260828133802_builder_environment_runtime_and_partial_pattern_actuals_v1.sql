-- BUILD-013 / ENV-007
-- Keep HOME/BOX legacy semantics untouched while exposing distinct runtime blocks
-- for GYM/OUTDOOR, and make rolling pattern exposure use actual partial execution.

CREATE OR REPLACE FUNCTION public.commit_user_session_draft_v2(
  p_draft_id uuid,
  p_start_now boolean DEFAULT false,
  p_accept_warnings boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
  v_environment text;
  v_runtime_block_key text;
begin
  v_validation:=public.validate_user_session_draft_v2(p_draft_id,3,'Intermédiaire');
  if not coalesce((v_validation->>'pass')::boolean,false) then
    raise exception 'Session draft has hard validation errors';
  end if;
  if coalesce((v_validation->>'warning_count')::int,0)>0 and not coalesce(p_accept_warnings,false) then
    raise exception 'Session draft has warnings that require explicit acceptance';
  end if;

  select upper(environment_code) into v_environment
  from public.user_session_drafts where id=p_draft_id;

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

      if v_environment in ('GYM','OUTDOOR') then
        v_runtime_block_key:=case v_module
          when 'STRENGTH' then 'strength'
          when 'CARDIO' then 'cardio'
          when 'CONDITIONING' then 'conditioning'
          when 'GYM' then 'gym'
          when 'STREET_GYM' then 'street_gym'
          when 'SKILL' then 'skill'
          when 'WOD' then 'wod'
          when 'TABATA' then 'tabata'
          when 'TABATA_ABS' then 'tabata'
          else null
        end;
        if v_runtime_block_key is not null then
          v_block:=jsonb_set(v_block,'{block_key}',to_jsonb(v_runtime_block_key),true);
        end if;
      end if;

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
    'environment_runtime_block_keys_normalized',v_environment in ('GYM','OUTDOOR'),
    'runtime_contract','user-session-builder-runtime-v2.2-environment-block-keys'
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.d_sync_session_pattern_ledger_v1(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_session public.workout_sessions%rowtype;
  v_source text:='internal';
  v_import_id uuid:=null;
  v_global_factor numeric:=1;
  v_inserted_planned int:=0;
  v_inserted_realized int:=0;
  v_actual jsonb:='{}'::jsonb;
begin
  select * into v_session from public.workout_sessions where id=p_session_id;
  if not found then raise exception 'Session not found'; end if;
  if auth.uid() is not null and auth.uid()<>v_session.user_id then raise exception 'Cannot sync another user session pattern ledger'; end if;

  v_actual:=coalesce(v_session.actual_protocol_outcome_json,'{}'::jsonb);

  select case when ws.planning_context_json->>'session_source'='external_import' then 'external_import' else 'internal' end,
         i.id
  into v_source,v_import_id
  from public.workout_sessions ws
  left join public.external_session_imports i on i.committed_session_id=ws.id
  where ws.id=p_session_id;
  v_source:=coalesce(v_source,'internal');

  begin
    v_global_factor:=public.d_session_execution_factor_v2(p_session_id);
  exception when others then
    v_global_factor:=case when v_session.status='completed' then 1 else 0 end;
  end;

  delete from public.session_stimulus_ledger
  where session_id=p_session_id
    and stimulus_type='pattern'
    and metadata_json->>'source'='rolling-pattern-exposure-v1';

  with eligible_raw as (
    select wse.id,wse.exercise_id,wse.block_key,wse.position,wse.duration_seconds,
           wse.user_execution_status,wse.status,wse.solver_decision_json,e.movement_pattern,
           lower(coalesce(
             nullif(wse.solver_decision_json->>'gym_block_key',''),
             nullif(wse.solver_decision_json->>'outdoor_block_key',''),
             case upper(coalesce(wse.solver_decision_json->>'module_code',''))
               when 'STRENGTH' then 'strength'
               when 'CARDIO' then 'cardio'
               when 'CONDITIONING' then 'conditioning'
               when 'GYM' then 'gym'
               when 'STREET_GYM' then 'street_gym'
               when 'SKILL' then 'skill'
               when 'WOD' then 'wod'
               else null
             end,
             wse.block_key
           )) as runtime_block_key
    from public.workout_session_exercises wse
    join public.exercises e on e.id=wse.exercise_id
    where wse.session_id=p_session_id
      and nullif(e.movement_pattern,'') is not null
      and wse.block_key not in ('unlock','warmup','warm_up','tabata','core')
  ), eligible as (
    select er.*,
           case when er.runtime_block_key='skill' or er.block_key='skill' then 1.25::numeric else 1.0::numeric end block_multiplier
    from eligible_raw er
  ), block_meta as (
    select lower(b->>'block_key') runtime_block_key,
           coalesce(nullif(b->>'duration_minutes','')::numeric,0) duration_minutes,
           upper(coalesce(b->>'mechanic',b#>>'{mechanic_json,mechanic_key}','')) mechanic
    from jsonb_array_elements(coalesce(v_session.generated_workout->'blocks','[]'::jsonb)) b
  ), counts as (
    select runtime_block_key,count(*)::numeric n
    from eligible
    group by runtime_block_key
  ), status_base as (
    select el.*,bm.duration_minutes,bm.mechanic,
           case
             when coalesce(bm.duration_minutes,0)>0 then (bm.duration_minutes/coalesce(c.n,1))*el.block_multiplier
             when coalesce(el.duration_seconds,0)>0 then (el.duration_seconds::numeric/60.0)*el.block_multiplier
             else (coalesce(v_session.duration_minutes,45)::numeric/greatest(count(*) over()::numeric,1))*el.block_multiplier
           end planned_exposure,
           case lower(coalesce(el.user_execution_status,el.status,''))
             when 'completed' then 1.0::numeric
             when 'adapted' then 0.70::numeric
             when 'not_completed' then 0::numeric
             when 'skipped' then 0::numeric
             else greatest(0,least(coalesce(v_global_factor,0),1))
           end status_factor
    from eligible el
    left join block_meta bm on bm.runtime_block_key=el.runtime_block_key
    left join counts c on c.runtime_block_key=el.runtime_block_key
  ), base as (
    select sb.*,
           case
             when coalesce(sb.mechanic,'') like 'RUN_%' and v_actual<>'{}'::jsonb then
               least(sb.status_factor,
                 case
                   when coalesce((case when lower(coalesce(v_actual->>'protocol_completed','')) in ('true','false') then (v_actual->>'protocol_completed')::boolean end),false) then 1.0::numeric
                   when public.jsonb_num(v_actual,'planned_intervals') is not null and public.jsonb_num(v_actual,'intervals_completed') is not null then
                     least(1.0::numeric,greatest(0::numeric,public.jsonb_num(v_actual,'intervals_completed'))/greatest(1::numeric,public.jsonb_num(v_actual,'planned_intervals')))
                   when public.jsonb_num(v_actual,'planned_duration_seconds') is not null and public.jsonb_num(v_actual,'elapsed_seconds') is not null then
                     least(1.0::numeric,greatest(0::numeric,public.jsonb_num(v_actual,'elapsed_seconds'))/greatest(1::numeric,public.jsonb_num(v_actual,'planned_duration_seconds')))
                   else sb.status_factor
                 end)
             when sb.mechanic='CARDIO_CONTINUOUS' and coalesce(sb.duration_minutes,0)>0 and coalesce(sb.duration_seconds,0)>0 then
               least(sb.status_factor,least(1.0::numeric,sb.duration_seconds::numeric/greatest(1::numeric,sb.duration_minutes*60)))
             else sb.status_factor
           end execution_factor
    from status_base sb
  ), agg as (
    select movement_pattern,sum(planned_exposure) planned_exposure,count(*)::int exercise_instances
    from base
    group by movement_pattern
  )
  insert into public.session_stimulus_ledger(
    user_id,session_id,source_kind,stimulus_type,stimulus_key,
    planned_value,realized_value,unit,metadata_json,occurred_at,external_import_id
  )
  select v_session.user_id,p_session_id,v_source,'pattern',movement_pattern,
         planned_exposure,null,'weighted_minute',
         jsonb_build_object(
           'source','rolling-pattern-exposure-v1',
           'contract_version','rolling-pattern-exposure-v2-runtime-actuals',
           'ledger_role','planned',
           'exercise_instances',exercise_instances,
           'skill_exposure_multiplier',1.25,
           'warmup_unlock_tabata_excluded',true,
           'session_source',v_source
         ),
         coalesce(v_session.generated_at,v_session.created_at,now()),
         case when v_source='external_import' then v_import_id else null end
  from agg;
  get diagnostics v_inserted_planned=row_count;

  if v_session.status='completed' then
    with eligible_raw as (
      select wse.id,wse.exercise_id,wse.block_key,wse.position,wse.duration_seconds,
             wse.user_execution_status,wse.status,wse.solver_decision_json,e.movement_pattern,
             lower(coalesce(
               nullif(wse.solver_decision_json->>'gym_block_key',''),
               nullif(wse.solver_decision_json->>'outdoor_block_key',''),
               case upper(coalesce(wse.solver_decision_json->>'module_code',''))
                 when 'STRENGTH' then 'strength'
                 when 'CARDIO' then 'cardio'
                 when 'CONDITIONING' then 'conditioning'
                 when 'GYM' then 'gym'
                 when 'STREET_GYM' then 'street_gym'
                 when 'SKILL' then 'skill'
                 when 'WOD' then 'wod'
                 else null
               end,
               wse.block_key
             )) as runtime_block_key
      from public.workout_session_exercises wse
      join public.exercises e on e.id=wse.exercise_id
      where wse.session_id=p_session_id
        and nullif(e.movement_pattern,'') is not null
        and wse.block_key not in ('unlock','warmup','warm_up','tabata','core')
    ), eligible as (
      select er.*,
             case when er.runtime_block_key='skill' or er.block_key='skill' then 1.25::numeric else 1.0::numeric end block_multiplier
      from eligible_raw er
    ), block_meta as (
      select lower(b->>'block_key') runtime_block_key,
             coalesce(nullif(b->>'duration_minutes','')::numeric,0) duration_minutes,
             upper(coalesce(b->>'mechanic',b#>>'{mechanic_json,mechanic_key}','')) mechanic
      from jsonb_array_elements(coalesce(v_session.generated_workout->'blocks','[]'::jsonb)) b
    ), counts as (
      select runtime_block_key,count(*)::numeric n
      from eligible
      group by runtime_block_key
    ), status_base as (
      select el.*,bm.duration_minutes,bm.mechanic,
             case
               when coalesce(bm.duration_minutes,0)>0 then (bm.duration_minutes/coalesce(c.n,1))*el.block_multiplier
               when coalesce(el.duration_seconds,0)>0 then (el.duration_seconds::numeric/60.0)*el.block_multiplier
               else (coalesce(v_session.duration_minutes,45)::numeric/greatest(count(*) over()::numeric,1))*el.block_multiplier
             end planned_exposure,
             case lower(coalesce(el.user_execution_status,el.status,''))
               when 'completed' then 1.0::numeric
               when 'adapted' then 0.70::numeric
               when 'not_completed' then 0::numeric
               when 'skipped' then 0::numeric
               else greatest(0,least(coalesce(v_global_factor,0),1))
             end status_factor
      from eligible el
      left join block_meta bm on bm.runtime_block_key=el.runtime_block_key
      left join counts c on c.runtime_block_key=el.runtime_block_key
    ), base as (
      select sb.*,
             case
               when coalesce(sb.mechanic,'') like 'RUN_%' and v_actual<>'{}'::jsonb then
                 least(sb.status_factor,
                   case
                     when coalesce((case when lower(coalesce(v_actual->>'protocol_completed','')) in ('true','false') then (v_actual->>'protocol_completed')::boolean end),false) then 1.0::numeric
                     when public.jsonb_num(v_actual,'planned_intervals') is not null and public.jsonb_num(v_actual,'intervals_completed') is not null then
                       least(1.0::numeric,greatest(0::numeric,public.jsonb_num(v_actual,'intervals_completed'))/greatest(1::numeric,public.jsonb_num(v_actual,'planned_intervals')))
                     when public.jsonb_num(v_actual,'planned_duration_seconds') is not null and public.jsonb_num(v_actual,'elapsed_seconds') is not null then
                       least(1.0::numeric,greatest(0::numeric,public.jsonb_num(v_actual,'elapsed_seconds'))/greatest(1::numeric,public.jsonb_num(v_actual,'planned_duration_seconds')))
                     else sb.status_factor
                   end)
               when sb.mechanic='CARDIO_CONTINUOUS' and coalesce(sb.duration_minutes,0)>0 and coalesce(sb.duration_seconds,0)>0 then
                 least(sb.status_factor,least(1.0::numeric,sb.duration_seconds::numeric/greatest(1::numeric,sb.duration_minutes*60)))
               else sb.status_factor
             end execution_factor
      from status_base sb
    ), agg as (
      select movement_pattern,
             sum(planned_exposure*execution_factor) realized_exposure,
             count(*)::int exercise_instances,
             round(avg(execution_factor),4) mean_execution_factor
      from base
      group by movement_pattern
    )
    insert into public.session_stimulus_ledger(
      user_id,session_id,source_kind,stimulus_type,stimulus_key,
      planned_value,realized_value,unit,metadata_json,occurred_at,external_import_id
    )
    select v_session.user_id,p_session_id,v_source,'pattern',movement_pattern,
           0,realized_exposure,'weighted_minute',
           jsonb_build_object(
             'source','rolling-pattern-exposure-v1',
             'contract_version','rolling-pattern-exposure-v2-runtime-actuals',
             'ledger_role','realized',
             'exercise_instances',exercise_instances,
             'mean_execution_factor',mean_execution_factor,
             'skill_exposure_multiplier',1.25,
             'warmup_unlock_tabata_excluded',true,
             'session_source',v_source,
             'protocol_actual_applied',true
           ),
           coalesce(v_session.completed_at,v_session.updated_at,now()),
           case when v_source='external_import' then v_import_id else null end
    from agg;
    get diagnostics v_inserted_realized=row_count;
  end if;

  return jsonb_build_object(
    'status','OK',
    'version','rolling-pattern-exposure-v2-runtime-actuals',
    'session_id',p_session_id,
    'source_kind',v_source,
    'planned_pattern_rows',v_inserted_planned,
    'realized_pattern_rows',v_inserted_realized,
    'skill_multiplier',1.25,
    'warmup_unlock_tabata_excluded',true,
    'runtime_block_mapping',true,
    'protocol_actual_applied',true,
    'decision_authority',false
  );
end;
$function$;
