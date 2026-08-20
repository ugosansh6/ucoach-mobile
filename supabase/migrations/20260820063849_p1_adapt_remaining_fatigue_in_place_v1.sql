create or replace function public.d_adapt_started_session_fatigue_v1(
  p_user_id uuid,
  p_session_id uuid,
  p_protected_session_exercise_ids uuid[] default '{}'::uuid[]
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r record;
  v_result jsonb;
  v_results jsonb:='[]'::jsonb;
  v_applied int:=0;
  v_attempted int:=0;
  v_skipped int:=0;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then
    raise exception 'Forbidden user';
  end if;

  if not exists(
    select 1 from public.workout_sessions ws
    where ws.id=p_session_id and ws.user_id=p_user_id and ws.status='in_progress'
  ) then
    return jsonb_build_object(
      'status','SESSION_NOT_ADAPTABLE',
      'version','fatigue-remaining-in-place-v1',
      'session_id',p_session_id,
      'applied_count',0
    );
  end if;

  for r in
    select wse.id,wse.exercise_id,wse.block_key,wse.position
    from public.workout_session_exercises wse
    where wse.session_id=p_session_id
      and wse.block_key in ('skill','wod')
      and not (wse.id=any(coalesce(p_protected_session_exercise_ids,'{}'::uuid[])))
    order by case wse.block_key when 'skill' then 0 else 1 end,wse.position,wse.id
  loop
    v_attempted:=v_attempted+1;

    begin
      v_result:=public.c4_swap_session_exercise_v3(
        p_user_id,
        r.id,
        'easier',
        '{}'::text[],
        false
      );
    exception when others then
      v_result:=jsonb_build_object(
        'status','ERROR',
        'message',sqlerrm,
        'session_exercise_id',r.id
      );
    end;

    if coalesce(v_result->>'status','')='APPLIED' and coalesce((v_result->>'mutated')::boolean,false) then
      v_applied:=v_applied+1;
    else
      v_skipped:=v_skipped+1;
    end if;

    v_results:=v_results||jsonb_build_array(jsonb_build_object(
      'session_exercise_id',r.id,
      'block_key',r.block_key,
      'position',r.position,
      'before_exercise_id',r.exercise_id,
      'status',coalesce(v_result->>'status','UNKNOWN'),
      'after_exercise_id',coalesce(v_result->>'new_exercise_id',v_result#>>'{substitute,id}',r.exercise_id)
    ));
  end loop;

  update public.workout_sessions
  set planning_context_json=coalesce(planning_context_json,'{}'::jsonb)||jsonb_build_object(
        'last_global_adaptation',jsonb_build_object(
          'version','fatigue-remaining-in-place-v1',
          'kind','GLOBAL_FATIGUE',
          'scope','UNFINISHED_SKILL_AND_WOD_ONLY',
          'protected_session_exercise_ids',to_jsonb(coalesce(p_protected_session_exercise_ids,'{}'::uuid[])),
          'attempted_count',v_attempted,
          'applied_count',v_applied,
          'unchanged_count',v_skipped,
          'adapted_at',now()
        )
      ),
      updated_at=now()
  where id=p_session_id and user_id=p_user_id;

  return jsonb_build_object(
    'status',case when v_applied>0 then 'FATIGUE_ADAPTED' else 'FATIGUE_CONTEXT_UPDATED_NO_SAFE_SWAP' end,
    'version','fatigue-remaining-in-place-v1',
    'session_id',p_session_id,
    'scope','UNFINISHED_SKILL_AND_WOD_ONLY',
    'attempted_count',v_attempted,
    'applied_count',v_applied,
    'unchanged_count',v_skipped,
    'protected_count',coalesce(array_length(p_protected_session_exercise_ids,1),0),
    'protected_progress_preserved',true,
    'new_session_created',false,
    'results',v_results
  );
end;
$function$;

alter function public.d_generate_adaptive_session_v2(
  uuid,text,integer,text,text,text,text[],jsonb,text[],integer,text,integer,text,date,boolean,uuid[]
) rename to d_generate_adaptive_session_v2_pre_fatigue_in_place_v1;

create or replace function public.d_generate_adaptive_session_v2(
  p_user_id uuid,
  p_focus_override text,
  p_duration_minutes integer,
  p_readiness text,
  p_target_region_override text default null,
  p_progression_intent_override text default null,
  p_zone_terms text[] default '{}'::text[],
  p_inventory jsonb default '[]'::jsonb,
  p_available_equipment text[] default '{}'::text[],
  p_max_complexity integer default 3,
  p_max_difficulty text default 'Intermédiaire',
  p_candidate_count integer default 12,
  p_policy_key text default 'c4-final-default',
  p_anchor_date date default current_date,
  p_force_recalculate_started boolean default false,
  p_protected_session_exercise_ids uuid[] default '{}'::uuid[]
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
set statement_timeout to '30s'
as $function$
declare
  v_anchor date:=coalesce(p_anchor_date,current_date);
  v_session_id uuid;
  v_context jsonb;
  v_recalc jsonb:='{}'::jsonb;
  v_adaptation jsonb;
  v_workout jsonb;
  v_count int:=0;
  v_unlimited boolean:=false;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then
    raise exception 'Forbidden user';
  end if;

  if p_force_recalculate_started
     and coalesce(array_length(p_protected_session_exercise_ids,1),0)>0 then
    select ws.id into v_session_id
    from public.user_training_plan_items i
    join public.workout_sessions ws on ws.id=i.session_id and ws.user_id=i.user_id
    where i.user_id=p_user_id
      and i.status='claimed'
      and ws.status='in_progress'
      and ws.started_local_date=v_anchor
    order by coalesce(i.claimed_at,i.updated_at) desc,ws.updated_at desc
    limit 1;

    if v_session_id is null then
      select ws.id into v_session_id
      from public.workout_sessions ws
      where ws.user_id=p_user_id
        and ws.status='in_progress'
        and ws.started_local_date=v_anchor
      order by ws.updated_at desc
      limit 1;
    end if;

    if v_session_id is not null then
      v_context:=public.d_resolve_session_context_v6(
        p_user_id,v_anchor,p_duration_minutes,p_readiness,
        p_focus_override,p_target_region_override,p_progression_intent_override,
        p_available_equipment,p_zone_terms,true
      );

      if coalesce(v_context->>'status','')<>'READY' then
        return v_context||jsonb_build_object('version','d1-adaptive-generation-v6-fatigue-in-place');
      end if;

      v_recalc:=coalesce(v_context->'recalculation','{}'::jsonb);
      v_count:=coalesce(nullif(v_recalc->>'count','')::int,0);
      v_unlimited:=public.d_user_unlimited_context_recalculations_v1(p_user_id);

      update public.workout_sessions
      set readiness=p_readiness,
          available_equipment=coalesce(p_available_equipment,'{}'::text[]),
          injured_zones=coalesce(p_zone_terms,'{}'::text[]),
          context_recalculation_count=case when v_unlimited then 0 else v_count end,
          planning_context_json=coalesce(planning_context_json,'{}'::jsonb)||jsonb_build_object(
            'global_fatigue_adaptation_context',jsonb_build_object(
              'anchor_date',v_anchor,
              'readiness',p_readiness,
              'protected_session_exercise_ids',to_jsonb(coalesce(p_protected_session_exercise_ids,'{}'::uuid[])),
              'context_recalculation',v_recalc,
              'updated_at',now()
            )
          ),
          updated_at=now()
      where id=v_session_id and user_id=p_user_id;

      v_adaptation:=public.d_adapt_started_session_fatigue_v1(
        p_user_id,v_session_id,p_protected_session_exercise_ids
      );

      select generated_workout into v_workout
      from public.workout_sessions
      where id=v_session_id and user_id=p_user_id;

      return jsonb_build_object(
        'status','safety_adapted_existing',
        'version','d1-adaptive-generation-v6-fatigue-in-place',
        'session_id',v_session_id,
        'generated_workout',coalesce(v_workout,'{}'::jsonb),
        'weekly_loop',v_context,
        'safety_adaptation',v_adaptation||jsonb_build_object('kind','GLOBAL_FATIGUE'),
        'context_recalculation_count',case when v_unlimited then 0 else v_count end,
        'context_recalculation_limit',3,
        'progress_preserved',true,
        'new_session_created',false
      );
    end if;
  end if;

  return public.d_generate_adaptive_session_v2_pre_fatigue_in_place_v1(
    p_user_id,p_focus_override,p_duration_minutes,p_readiness,p_target_region_override,
    p_progression_intent_override,p_zone_terms,p_inventory,p_available_equipment,
    p_max_complexity,p_max_difficulty,p_candidate_count,p_policy_key,v_anchor,
    p_force_recalculate_started,p_protected_session_exercise_ids
  );
end;
$function$;

revoke all on function public.d_adapt_started_session_fatigue_v1(uuid,uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.d_adapt_started_session_fatigue_v1(uuid,uuid,uuid[]) to service_role;

revoke all on function public.d_generate_adaptive_session_v2_pre_fatigue_in_place_v1(uuid,text,integer,text,text,text,text[],jsonb,text[],integer,text,integer,text,date,boolean,uuid[]) from public,anon,authenticated;
grant execute on function public.d_generate_adaptive_session_v2_pre_fatigue_in_place_v1(uuid,text,integer,text,text,text,text[],jsonb,text[],integer,text,integer,text,date,boolean,uuid[]) to service_role;

grant execute on function public.d_generate_adaptive_session_v2(uuid,text,integer,text,text,text,text[],jsonb,text[],integer,text,integer,text,date,boolean,uuid[]) to authenticated,service_role;