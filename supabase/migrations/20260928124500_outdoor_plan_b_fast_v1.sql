-- PERF-011: OUTDOOR Plan B uses the environment-specific generator.
-- The existing quick WOD swap remains first in the common router. When it cannot
-- produce a safe alternative, this function regenerates an OUTDOOR-specific
-- architecture instead of falling back to the generic HOME/BOX generator.

create or replace function public.change_outdoor_session_plan_fast_v1(
  p_user_id uuid,
  p_session_id uuid
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
set statement_timeout to '15s'
as $function$
declare
  v_session public.workout_sessions%rowtype;
  v_inventory jsonb;
  v_anchor_date date;
  v_current_format text;
  v_candidate_format text;
  v_new_format text;
  v_formats text[];
  v_generated jsonb;
  v_new_session_id uuid;
  v_plan_item_id uuid;
  v_place_code text;
  v_surface_code text;
  v_reliable_distance boolean:=false;
  v_running_allowed boolean:=true;
  v_old_signature jsonb:='[]'::jsonb;
  v_new_signature jsonb:='[]'::jsonb;
  v_started_at timestamptz:=clock_timestamp();
  v_elapsed_ms int;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then
    raise exception 'Forbidden user';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_user_id::text||':outdoor-session-plan-b:'||p_session_id::text,0)
  );

  select *
  into v_session
  from public.workout_sessions
  where id=p_session_id
    and user_id=p_user_id
  for update;

  if not found then raise exception 'Session not found'; end if;

  if upper(coalesce(v_session.planned_environment_code,''))<>'OUTDOOR' then
    return jsonb_build_object(
      'status','NOT_AVAILABLE',
      'reason','OUTDOOR_PLAN_B_REQUIRES_OUTDOOR_SESSION',
      'session_id',p_session_id,
      'fast_path',true
    );
  end if;

  if v_session.status<>'generated' or v_session.started_at is not null then
    return jsonb_build_object(
      'status','NOT_AVAILABLE',
      'reason','SESSION_PLAN_B_ONLY_BEFORE_SESSION_START',
      'session_id',p_session_id,
      'fast_path',true
    );
  end if;

  v_anchor_date:=coalesce(
    v_session.generation_local_date,
    public.ugerod_effective_session_anchor_date_v1()
  );

  v_current_format:=upper(coalesce(
    nullif(v_session.generated_workout#>>'{meta,format_code}',''),
    nullif(v_session.generated_workout->>'format_code',''),
    nullif(v_session.planning_context_json->>'format_code',''),
    nullif(v_session.mechanic_json->>'format_code',''),
    'OUTDOOR_CONDITIONING'
  ));

  v_place_code:=coalesce(
    nullif(v_session.planning_context_json#>>'{place_context,place_code}',''),
    nullif(v_session.generated_workout#>>'{place_context,place_code}','')
  );
  v_surface_code:=coalesce(
    public.normalize_session_surface_v1(v_session.planned_surface_code),
    public.normalize_session_surface_v1(
      v_session.planning_context_json#>>'{place_context,effective_surface_code}'
    )
  );
  v_reliable_distance:=coalesce(
    nullif(v_session.planning_context_json#>>'{running_family,reliable_distance}','')::boolean,
    nullif(v_session.generated_workout#>>'{running_family_opportunity,reliable_distance}','')::boolean,
    false
  );
  v_running_allowed:=coalesce(
    nullif(v_session.planning_context_json->>'running_allowed','')::boolean,
    true
  );

  v_formats:=case v_current_format
    when 'OUTDOOR_CONDITIONING' then
      array['OUTDOOR_CONDITIONING_WOD','OUTDOOR_CONDITIONING_ABS']::text[]
    when 'OUTDOOR_CONDITIONING_WOD' then
      array['OUTDOOR_CONDITIONING_ABS','OUTDOOR_CONDITIONING']::text[]
    when 'OUTDOOR_CONDITIONING_GYM' then
      array['OUTDOOR_CONDITIONING_WOD','OUTDOOR_CONDITIONING']::text[]
    when 'OUTDOOR_CONDITIONING_ABS' then
      array['OUTDOOR_CONDITIONING_WOD','OUTDOOR_CONDITIONING']::text[]
    else
      array['OUTDOOR_CONDITIONING','OUTDOOR_CONDITIONING_WOD']::text[]
  end;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'block_key',lower(coalesce(b->>'block_key','')),
        'mechanic',upper(coalesce(b->>'mechanic',b#>>'{mechanic_json,mechanic_key}','')),
        'duration_minutes',coalesce(nullif(b->>'duration_minutes','')::int,0),
        'exercise_ids',(
          select coalesce(jsonb_agg(e->>'exercise_id' order by eord),'[]'::jsonb)
          from jsonb_array_elements(coalesce(b->'exercises','[]'::jsonb))
               with ordinality ex(e,eord)
        )
      )
      order by ord
    ),
    '[]'::jsonb
  )
  into v_old_signature
  from jsonb_array_elements(coalesce(v_session.generated_workout->'blocks','[]'::jsonb))
       with ordinality z(b,ord);

  v_inventory:=public.resolve_user_equipment_inventory(
    p_user_id,
    case
      when cardinality(coalesce(v_session.available_equipment,'{}'::text[]))=0
        then array['Aucun']::text[]
      else v_session.available_equipment
    end,
    'c4-final-default'
  );

  foreach v_candidate_format in array v_formats loop
    v_new_session_id:=null;
    v_new_signature:='[]'::jsonb;

    begin
      v_generated:=public.outdoor_generate_session_v1(
        p_user_id,
        v_session.duration_minutes,
        v_session.readiness,
        v_session.focus,
        coalesce(v_session.target_region,'Full Body'),
        v_session.progression_intent,
        coalesce(v_session.injured_zones,'{}'::text[]),
        coalesce(v_inventory,'[]'::jsonb),
        coalesce(v_session.available_equipment,'{}'::text[]),
        v_place_code,
        v_surface_code,
        v_candidate_format,
        v_reliable_distance,
        v_running_allowed,
        false,
        3,
        'Intermédiaire',
        8,
        false
      );

      if not coalesce((v_generated->>'session_persisted')::boolean,false)
         or nullif(v_generated->>'session_id','') is null then
        raise exception 'OUTDOOR_PLAN_B_GENERATION_NOT_READY';
      end if;

      v_new_session_id:=(v_generated->>'session_id')::uuid;
      v_new_format:=upper(coalesce(
        nullif(v_generated->>'format_code',''),
        v_candidate_format
      ));

      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'block_key',lower(coalesce(b->>'block_key','')),
            'mechanic',upper(coalesce(b->>'mechanic',b#>>'{mechanic_json,mechanic_key}','')),
            'duration_minutes',coalesce(nullif(b->>'duration_minutes','')::int,0),
            'exercise_ids',(
              select coalesce(jsonb_agg(e->>'exercise_id' order by eord),'[]'::jsonb)
              from jsonb_array_elements(coalesce(b->'exercises','[]'::jsonb))
                   with ordinality ex(e,eord)
            )
          )
          order by ord
        ),
        '[]'::jsonb
      )
      into v_new_signature
      from public.workout_sessions ws
      cross join lateral jsonb_array_elements(coalesce(ws.generated_workout->'blocks','[]'::jsonb))
           with ordinality z(b,ord)
      where ws.id=v_new_session_id
        and ws.user_id=p_user_id;

      if v_new_signature=v_old_signature then
        raise exception 'OUTDOOR_PLAN_B_NOT_MEANINGFULLY_DIFFERENT';
      end if;

    exception when others then
      -- PL/pgSQL subtransaction rolls back any generated replacement created
      -- by this attempt. Try the next OUTDOOR-specific architecture.
      v_new_session_id:=null;
      v_new_signature:='[]'::jsonb;
    end;

    exit when v_new_session_id is not null;
  end loop;

  if v_new_session_id is null then
    return jsonb_build_object(
      'status','NOT_AVAILABLE',
      'reason','OUTDOOR_PLAN_B_NO_SAFE_MEANINGFUL_ALTERNATIVE',
      'session_id',p_session_id,
      'fast_path',true,
      'fast_path_kind','OUTDOOR_ENVIRONMENT_REGEN'
    );
  end if;

  update public.workout_sessions
  set generation_local_date=v_anchor_date,
      planning_context_json=coalesce(planning_context_json,'{}'::jsonb)
        || jsonb_build_object(
          'session_plan_b',
          jsonb_build_object(
            'version','outdoor-session-plan-b-fast-v1',
            'source_session_id',p_session_id,
            'scope','SESSION_DAY_ONLY',
            'same_checkin_preserved',true,
            'old_format_code',v_current_format,
            'new_format_code',v_new_format,
            'planned_surface_preserved',v_surface_code,
            'preference_not_pain',true,
            'does_not_change_level',true,
            'does_not_create_training_debt',true,
            'environment_specific_generator',true
          )
        ),
      updated_at=now()
  where id=v_new_session_id
    and user_id=p_user_id;

  select id
  into v_plan_item_id
  from public.user_training_plan_items
  where user_id=p_user_id
    and session_id=p_session_id
  order by updated_at desc
  limit 1
  for update;

  if v_plan_item_id is not null then
    update public.user_training_plan_items
    set session_id=v_new_session_id,
        planning_context_json=coalesce(planning_context_json,'{}'::jsonb)
          || jsonb_build_object(
            'session_plan_b',
            jsonb_build_object(
              'version','outdoor-session-plan-b-fast-v1',
              'replaced_session_id',p_session_id,
              'old_format_code',v_current_format,
              'new_format_code',v_new_format,
              'preference_not_pain',true,
              'creates_training_debt',false
            )
          ),
        updated_at=now()
    where id=v_plan_item_id
      and user_id=p_user_id;
  end if;

  update public.workout_sessions
  set status='abandoned',
      planning_context_json=coalesce(planning_context_json,'{}'::jsonb)
        || jsonb_build_object(
          'replacement',
          jsonb_build_object(
            'version','outdoor-session-plan-b-fast-v1',
            'reason','USER_REQUESTED_ALTERNATIVE_BEFORE_START',
            'replacement_session_id',v_new_session_id,
            'old_format_code',v_current_format,
            'new_format_code',v_new_format,
            'preference_not_pain',true,
            'actual_training_abandonment',false,
            'creates_training_debt',false
          )
        ),
      updated_at=now()
  where id=p_session_id
    and user_id=p_user_id;

  v_elapsed_ms:=round(
    extract(epoch from (clock_timestamp()-v_started_at))*1000
  )::int;

  return jsonb_build_object(
    'status','APPLIED',
    'version','outdoor-session-plan-b-fast-v1',
    'old_session_id',p_session_id,
    'new_session_id',v_new_session_id,
    'old_format_code',v_current_format,
    'new_format_code',v_new_format,
    'meaningfully_different',true,
    'same_checkin_preserved',true,
    'planned_surface_preserved',v_surface_code,
    'preference_not_pain',true,
    'does_not_change_level',true,
    'does_not_create_training_debt',true,
    'fast_path',true,
    'fast_path_kind','OUTDOOR_ENVIRONMENT_REGEN',
    'elapsed_ms',v_elapsed_ms
  );
end;
$function$;

create or replace function public.change_workout_session_plan_fast_v2(
  p_user_id uuid,
  p_session_id uuid
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
set statement_timeout to '30s'
as $function$
declare
  v_session public.workout_sessions%rowtype;
  v_current_path text;
  v_fast jsonb;
  v_started_at timestamptz:=clock_timestamp();
  v_elapsed_ms int;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then
    raise exception 'Forbidden user';
  end if;

  select *
  into v_session
  from public.workout_sessions
  where id=p_session_id and user_id=p_user_id;

  if not found then raise exception 'Session not found'; end if;

  if v_session.status<>'generated' or v_session.started_at is not null then
    return jsonb_build_object(
      'status','NOT_AVAILABLE',
      'reason','SESSION_PLAN_B_ONLY_BEFORE_SESSION_START',
      'session_id',p_session_id,
      'fast_path',true
    );
  end if;

  v_current_path:=coalesce(
    nullif(v_session.generated_workout#>>'{meta,architecture,skill_path,path_key}',''),
    nullif(v_session.planning_context_json#>>'{architecture,skill_path,path_key}','')
  );

  -- 1) Cheapest meaningful change: replace Skill and copy every other block.
  if v_current_path is not null then
    begin
      v_fast:=public.change_workout_skill_plan_fast_v1(
        p_user_id,p_session_id,'ALTERNATE_SKILL'
      );
    exception when others then
      v_fast:=null;
    end;

    if coalesce(v_fast->>'status','')='APPLIED' then
      return v_fast||jsonb_build_object(
        'fast_path_kind','SKILL_CLONE',
        'whole_session_router_version','whole-session-fast-router-v3'
      );
    end if;
  end if;

  -- 2) Same check-in + validated blocks + one quality-gated WOD change.
  begin
    v_fast:=public.change_workout_session_wod_fast_v1(
      p_user_id,p_session_id
    );
  exception when others then
    v_fast:=null;
  end;

  if coalesce(v_fast->>'status','')='APPLIED' then
    return v_fast||jsonb_build_object(
      'whole_session_router_version','whole-session-fast-router-v3'
    );
  end if;

  -- 3) OUTDOOR keeps its own architecture. Never fall directly from an
  -- Outdoor session into the generic HOME/BOX full-session generator.
  if upper(coalesce(v_session.planned_environment_code,''))='OUTDOOR' then
    begin
      v_fast:=public.change_outdoor_session_plan_fast_v1(
        p_user_id,p_session_id
      );
    exception when others then
      v_fast:=null;
    end;

    if coalesce(v_fast->>'status','')='APPLIED' then
      return v_fast||jsonb_build_object(
        'whole_session_router_version','whole-session-fast-router-v3'
      );
    end if;
  end if;

  -- 4) Last resort: retain the existing complete generator and all guards.
  v_fast:=public.change_workout_session_plan_v1(
    p_user_id,p_session_id
  );

  v_elapsed_ms:=round(
    extract(epoch from (clock_timestamp()-v_started_at))*1000
  )::int;

  return coalesce(v_fast,'{}'::jsonb)||jsonb_build_object(
    'whole_session_router_version','whole-session-fast-router-v3',
    'fast_path',false,
    'fast_path_kind','FULL_GENERATION_FALLBACK',
    'router_elapsed_ms',v_elapsed_ms
  );
end;
$function$;
