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
  v_session public.workout_sessions%rowtype;
  v_session_id uuid;
  v_plan_item_id uuid;
  v_old_equipment text[]:='{}'::text[];
  v_new_equipment text[]:='{}'::text[];
  v_old_zones text[]:='{}'::text[];
  v_new_zones text[]:='{}'::text[];
  v_target_focus text;
  v_target_region text;
  v_target_intent text;
  v_target_readiness text:=public.normalize_session_readiness(p_readiness);
  v_current_readiness text;
  v_fatigue_only boolean:=false;
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
    select ws.* into v_session
    from public.user_training_plan_items i
    join public.workout_sessions ws on ws.id=i.session_id and ws.user_id=i.user_id
    where i.user_id=p_user_id
      and i.status='claimed'
      and ws.status='in_progress'
      and ws.started_local_date=v_anchor
    order by coalesce(i.claimed_at,i.updated_at) desc,ws.updated_at desc
    limit 1;

    if v_session.id is null then
      select ws.* into v_session
      from public.workout_sessions ws
      where ws.user_id=p_user_id
        and ws.status='in_progress'
        and ws.started_local_date=v_anchor
      order by ws.updated_at desc
      limit 1;
    end if;

    if v_session.id is not null then
      v_session_id:=v_session.id;
      select i.id into v_plan_item_id
      from public.user_training_plan_items i
      where i.user_id=p_user_id and i.session_id=v_session_id and i.status='claimed'
      order by coalesce(i.claimed_at,i.updated_at) desc
      limit 1;

      v_old_equipment:=public.d_normalize_text_set_v1(coalesce(v_session.available_equipment,'{}'::text[]));
      v_new_equipment:=public.d_normalize_text_set_v1(coalesce(p_available_equipment,'{}'::text[]));
      v_old_zones:=public.d_normalize_text_set_v1(coalesce(v_session.injured_zones,'{}'::text[]));
      v_new_zones:=public.d_normalize_text_set_v1(coalesce(p_zone_terms,'{}'::text[]));
      v_current_readiness:=public.normalize_session_readiness(coalesce(v_session.readiness,'normal'));

      v_target_focus:=case
        when p_focus_override in ('General Fitness','Fat Loss','Muscle Gain','Strength','Conditioning') then p_focus_override
        else v_session.focus
      end;
      v_target_region:=case
        when p_target_region_override in ('Upper','Lower','Core','Full Body') then p_target_region_override
        else v_session.target_region
      end;
      v_target_intent:=case
        when upper(coalesce(p_progression_intent_override,'')) in ('PROGRESS','MAINTAIN','CONSOLIDATE','DELOAD','RECALIBRATE','EXPLORE')
          then upper(p_progression_intent_override)
        else v_session.progression_intent
      end;

      v_fatigue_only:=
        coalesce(v_session.duration_minutes,45)=coalesce(p_duration_minutes,45)
        and v_target_focus is not distinct from v_session.focus
        and v_target_region is not distinct from v_session.target_region
        and v_target_intent is not distinct from v_session.progression_intent
        and v_old_equipment=v_new_equipment
        and v_old_zones=v_new_zones
        and v_current_readiness is distinct from v_target_readiness;

      if v_fatigue_only then
        v_unlimited:=public.d_user_unlimited_context_recalculations_v1(p_user_id);
        v_count:=case when v_unlimited then 0 else coalesce(v_session.context_recalculation_count,0) end;

        update public.workout_sessions
        set readiness=v_target_readiness,
            context_recalculation_count=v_count,
            planning_context_json=coalesce(planning_context_json,'{}'::jsonb)||jsonb_build_object(
              'global_fatigue_adaptation_context',jsonb_build_object(
                'anchor_date',v_anchor,
                'readiness_before',v_current_readiness,
                'readiness_after',v_target_readiness,
                'protected_session_exercise_ids',to_jsonb(coalesce(p_protected_session_exercise_ids,'{}'::uuid[])),
                'mode','IN_PLACE',
                'updated_at',now()
              )
            ),
            updated_at=now()
        where id=v_session_id and user_id=p_user_id and status='in_progress';

        v_adaptation:=public.d_adapt_started_session_fatigue_v1(
          p_user_id,v_session_id,p_protected_session_exercise_ids
        );

        select generated_workout into v_workout
        from public.workout_sessions
        where id=v_session_id and user_id=p_user_id;

        return jsonb_build_object(
          'status','safety_adapted_existing',
          'version','d1-adaptive-generation-v7-fatigue-in-place-safe',
          'session_id',v_session_id,
          'generated_workout',coalesce(v_workout,'{}'::jsonb),
          'weekly_loop',jsonb_build_object(
            'status','READY',
            'focus',v_session.focus,
            'target_region',v_session.target_region,
            'progression_intent',v_session.progression_intent,
            'changed_fields',jsonb_build_array('readiness'),
            'started_session_frozen',true,
            'in_place_adaptation',true
          ),
          'safety_adaptation',v_adaptation||jsonb_build_object('kind','GLOBAL_FATIGUE'),
          'context_recalculation_count',v_count,
          'context_recalculation_limit',3,
          'progress_preserved',true,
          'new_session_created',false,
          'plan_item_id',v_plan_item_id
        );
      end if;
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