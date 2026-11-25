
-- Environment coaching decisions v1:
-- 1) GYM gets an explicit muscle-region identity even when check-in leaves target_region empty.
-- 2) Whole-session Plan B is routed by environment and must be materially different.
-- 3) A whole-session alternative may not be accepted when it only swaps Skill OR WOD content.

create or replace function public.gym_resolve_target_region_v1(
  p_user_id uuid,
  p_focus text,
  p_anchor_date date default current_date,
  p_requested_region text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_requested text;
  v_focus text := coalesce(nullif(trim(p_focus),''),'General Fitness');
  v_anchor date := coalesce(p_anchor_date,current_date);
  v_completed_gym_sessions int := 0;
  v_sequence int := 1;
  v_region text;
begin
  if p_user_id is null then
    raise exception 'p_user_id is required';
  end if;
  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'Forbidden user';
  end if;

  v_requested := case upper(coalesce(trim(p_requested_region),''))
    when 'UPPER' then 'Upper'
    when 'LOWER' then 'Lower'
    when 'FULL BODY' then 'Full Body'
    when 'FULL_BODY' then 'Full Body'
    when 'CORE' then 'Core'
    else null
  end;

  if v_requested is not null then
    return jsonb_build_object(
      'status','RESOLVED',
      'version','gym-target-region-resolver-v1',
      'target_region',v_requested,
      'source','EXPLICIT_USER_OR_PROGRAM_CONTEXT',
      'requested_region',p_requested_region,
      'anchor_date',v_anchor,
      'focus',v_focus,
      'rotation_sequence',null,
      'completed_gym_sessions_before_anchor',null
    );
  end if;

  select count(*)
  into v_completed_gym_sessions
  from public.workout_sessions ws
  where ws.user_id=p_user_id
    and upper(coalesce(ws.planned_environment_code,''))='GYM'
    and ws.status='completed'
    and coalesce(ws.started_local_date,ws.generation_local_date,ws.completed_at::date,ws.created_at::date) < v_anchor
    and public.session_counts_as_training_v1(ws.id);

  v_sequence := greatest(1,v_completed_gym_sessions+1);
  v_region := public.d_base_target_region(v_focus,v_sequence);

  if v_region is null then
    v_region := 'Full Body';
  end if;

  return jsonb_build_object(
    'status','RESOLVED',
    'version','gym-target-region-resolver-v1',
    'target_region',v_region,
    'source','GYM_FOCUS_ROTATION',
    'requested_region',null,
    'anchor_date',v_anchor,
    'focus',v_focus,
    'rotation_sequence',v_sequence,
    'completed_gym_sessions_before_anchor',v_completed_gym_sessions,
    'rotation_contract','d_base_target_region'
  );
end;
$$;

create or replace function public.generate_environment_session_v4(
  p_user_id uuid,
  p_environment_code text,
  p_surface_code text default null,
  p_requested_format_code text default null,
  p_execution_style text default null,
  p_user_focus text default 'General Fitness',
  p_duration_minutes integer default 45,
  p_readiness text default 'normal',
  p_target_region text default null,
  p_progression_intent text default null,
  p_zone_terms text[] default '{}'::text[],
  p_inventory jsonb default '[]'::jsonb,
  p_available_equipment text[] default '{}'::text[],
  p_outdoor_place_code text default null,
  p_reliable_distance boolean default false,
  p_running_allowed boolean default true,
  p_calibration_opportunity boolean default false,
  p_max_complexity integer default 3,
  p_max_difficulty text default 'Intermédiaire',
  p_candidate_count integer default 20,
  p_policy_key text default 'c4-final-default',
  p_start_now boolean default false,
  p_anchor_date date default current_date
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
set statement_timeout to '60s'
as $$
declare
  v_environment text := public.normalize_session_environment_v1(p_environment_code);
  v_anchor date := coalesce(p_anchor_date,current_date);
  v_resolution jsonb := null;
  v_effective_region text := p_target_region;
  v_existing public.workout_sessions%rowtype;
  v_result jsonb;
  v_workout jsonb;
begin
  if p_user_id is null then raise exception 'p_user_id is required'; end if;
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;

  if v_environment='GYM' then
    select ws.*
    into v_existing
    from public.workout_sessions ws
    where ws.user_id=p_user_id
      and ws.status in ('generated','in_progress')
      and coalesce(ws.started_local_date,ws.generation_local_date)=v_anchor
    order by
      case when ws.status='in_progress' then 0 else 1 end,
      coalesce(ws.started_at,ws.generated_at,ws.updated_at) desc
    limit 1;

    if v_existing.id is not null
       and upper(coalesce(v_existing.planned_environment_code,''))='GYM'
       and p_target_region is null then
      v_effective_region := v_existing.target_region;
      v_resolution := jsonb_build_object(
        'status','RESOLVED',
        'version','gym-target-region-resolver-v1',
        'target_region',v_effective_region,
        'source','EXISTING_OPEN_SESSION_PRESERVED',
        'session_id',v_existing.id,
        'anchor_date',v_anchor
      );
    else
      v_resolution := public.gym_resolve_target_region_v1(
        p_user_id,p_user_focus,v_anchor,p_target_region
      );
      v_effective_region := v_resolution->>'target_region';
    end if;
  end if;

  v_result := public.generate_environment_session_v3(
    p_user_id,
    v_environment,
    p_surface_code,
    p_requested_format_code,
    p_execution_style,
    p_user_focus,
    p_duration_minutes,
    p_readiness,
    v_effective_region,
    p_progression_intent,
    p_zone_terms,
    p_inventory,
    p_available_equipment,
    p_outdoor_place_code,
    p_reliable_distance,
    p_running_allowed,
    p_calibration_opportunity,
    p_max_complexity,
    p_max_difficulty,
    p_candidate_count,
    p_policy_key,
    p_start_now,
    v_anchor
  );

  if v_environment='GYM'
     and v_resolution is not null
     and nullif(v_result->>'session_id','') is not null
     and coalesce((v_result->>'session_persisted')::boolean,false) then
    update public.workout_sessions
    set target_region=coalesce(target_region,v_effective_region),
        planning_context_json=coalesce(planning_context_json,'{}'::jsonb)
          || jsonb_build_object(
            'gym_target_region_resolution',
            v_resolution || jsonb_build_object(
              'effective_target_region',v_effective_region
            )
          ),
        generated_workout=jsonb_set(
          coalesce(generated_workout,'{}'::jsonb),
          '{meta}',
          coalesce(generated_workout->'meta','{}'::jsonb)
            || jsonb_build_object(
              'resolved_target_region',v_effective_region,
              'gym_target_region_resolution',v_resolution
            ),
          true
        ),
        updated_at=now()
    where id=(v_result->>'session_id')::uuid
      and user_id=p_user_id;

    select generated_workout
    into v_workout
    from public.workout_sessions
    where id=(v_result->>'session_id')::uuid
      and user_id=p_user_id;

    v_result := jsonb_set(v_result,'{generated_workout}',coalesce(v_workout,'{}'::jsonb),true);
  end if;

  return v_result || jsonb_build_object(
    'version','environment-session-generator-v4-environment-coaching',
    'resolved_target_region',case when v_environment='GYM' then v_effective_region else p_target_region end,
    'gym_target_region_resolution',case when v_environment='GYM' then v_resolution else null end
  );
end;
$$;

create or replace function public.ugerod_session_plan_signature_v1(
  p_session_id uuid
)
returns jsonb
language plpgsql
stable
set search_path to 'public'
as $$
declare
  v_session public.workout_sessions%rowtype;
  v_architecture jsonb := '[]'::jsonb;
  v_main_content jsonb := '{}'::jsonb;
  v_format text;
  v_style text;
  v_mechanic text;
begin
  select * into v_session
  from public.workout_sessions
  where id=p_session_id;

  if not found then
    return jsonb_build_object(
      'status','SESSION_NOT_FOUND',
      'session_id',p_session_id
    );
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'block_key',lower(coalesce(b->>'block_key','')),
        'mechanic',upper(coalesce(
          nullif(b->>'mechanic',''),
          nullif(b#>>'{mechanic_json,mechanic_key}',''),
          nullif(b->>'block_mechanic',''),
          ''
        )),
        'duration_minutes',coalesce(nullif(b->>'duration_minutes','')::numeric,0)
      )
      order by ord
    ),
    '[]'::jsonb
  )
  into v_architecture
  from jsonb_array_elements(coalesce(v_session.generated_workout->'blocks','[]'::jsonb))
       with ordinality z(b,ord);

  select coalesce(
    jsonb_object_agg(block_key,exercise_ids),
    '{}'::jsonb
  )
  into v_main_content
  from (
    select
      lower(coalesce(b->>'block_key','')) as block_key,
      coalesce((
        select jsonb_agg(coalesce(nullif(e->>'exercise_id',''),nullif(e->>'id','')) order by eord)
        from jsonb_array_elements(coalesce(b->'exercises','[]'::jsonb))
             with ordinality ex(e,eord)
        where coalesce(nullif(e->>'exercise_id',''),nullif(e->>'id','')) is not null
      ),'[]'::jsonb) as exercise_ids
    from jsonb_array_elements(coalesce(v_session.generated_workout->'blocks','[]'::jsonb)) b
    where lower(coalesce(b->>'block_key','')) not in (
      'unlock','warmup','warm_up','tabata','mobility'
    )
  ) q;

  v_format := upper(coalesce(
    nullif(v_session.generated_workout#>>'{meta,format_code}',''),
    nullif(v_session.generated_workout->>'format_code',''),
    nullif(v_session.planning_context_json->>'format_code',''),
    nullif(v_session.mechanic_json->>'format_code',''),
    ''
  ));

  v_style := upper(coalesce(
    nullif(v_session.generated_workout#>>'{meta,execution_style,style_code}',''),
    nullif(v_session.generated_workout#>>'{execution_style,style_code}',''),
    nullif(v_session.planning_context_json#>>'{execution_style,style_code}',''),
    nullif(v_session.mechanic_json->>'execution_style',''),
    ''
  ));

  v_mechanic := upper(coalesce(
    nullif(v_session.mechanic_json->>'mechanic_key',''),
    ''
  ));

  return jsonb_build_object(
    'status','OK',
    'version','session-plan-signature-v1',
    'session_id',p_session_id,
    'environment_code',upper(coalesce(v_session.planned_environment_code,'')),
    'target_region',v_session.target_region,
    'format_code',nullif(v_format,''),
    'execution_style',nullif(v_style,''),
    'mechanic_key',nullif(v_mechanic,''),
    'architecture',v_architecture,
    'main_content',v_main_content
  );
end;
$$;

create or replace function public.ugerod_session_plan_difference_v1(
  p_old_session_id uuid,
  p_new_session_id uuid
)
returns jsonb
language plpgsql
stable
set search_path to 'public'
as $$
declare
  v_old jsonb := public.ugerod_session_plan_signature_v1(p_old_session_id);
  v_new jsonb := public.ugerod_session_plan_signature_v1(p_new_session_id);
  v_architecture_changed boolean;
  v_format_changed boolean;
  v_style_changed boolean;
  v_mechanic_changed boolean;
  v_changed_main_blocks int := 0;
  v_main_block_count int := 0;
  v_main_content_significant boolean := false;
  v_key text;
  v_old_block jsonb;
  v_new_block jsonb;
begin
  if coalesce(v_old->>'status','')<>'OK'
     or coalesce(v_new->>'status','')<>'OK' then
    return jsonb_build_object(
      'status','SIGNATURE_UNAVAILABLE',
      'version','session-plan-difference-v1',
      'meaningfully_different',false,
      'old_signature',v_old,
      'new_signature',v_new
    );
  end if;

  v_architecture_changed := (v_old->'architecture') is distinct from (v_new->'architecture');
  v_format_changed := (v_old->>'format_code') is distinct from (v_new->>'format_code');
  v_style_changed := (v_old->>'execution_style') is distinct from (v_new->>'execution_style');
  v_mechanic_changed := (v_old->>'mechanic_key') is distinct from (v_new->>'mechanic_key');

  for v_key in
    select key
    from (
      select jsonb_object_keys(coalesce(v_old->'main_content','{}'::jsonb)) as key
      union
      select jsonb_object_keys(coalesce(v_new->'main_content','{}'::jsonb)) as key
    ) keys
  loop
    v_main_block_count := v_main_block_count + 1;
    v_old_block := coalesce(v_old#>array['main_content',v_key],'[]'::jsonb);
    v_new_block := coalesce(v_new#>array['main_content',v_key],'[]'::jsonb);

    if v_old_block is distinct from v_new_block then
      v_changed_main_blocks := v_changed_main_blocks + 1;
    end if;
  end loop;

  v_main_content_significant :=
    v_changed_main_blocks >= 2
    or (v_main_block_count = 1 and v_changed_main_blocks = 1);

  return jsonb_build_object(
    'status','OK',
    'version','session-plan-difference-v1',
    'old_session_id',p_old_session_id,
    'new_session_id',p_new_session_id,
    'architecture_changed',v_architecture_changed,
    'format_changed',v_format_changed,
    'execution_style_changed',v_style_changed,
    'mechanic_changed',v_mechanic_changed,
    'changed_main_blocks',v_changed_main_blocks,
    'main_block_count',v_main_block_count,
    'main_content_significant',v_main_content_significant,
    'meaningfully_different',
      v_architecture_changed
      or v_format_changed
      or v_style_changed
      or v_mechanic_changed
      or v_main_content_significant,
    'old_signature',v_old,
    'new_signature',v_new
  );
end;
$$;

create or replace function public.change_gym_session_plan_fast_v2(
  p_user_id uuid,
  p_session_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
set statement_timeout to '30s'
as $$
declare
  v_session public.workout_sessions%rowtype;
  v_region_resolution jsonb;
  v_resolved_region text;
  v_result jsonb;
  v_new_session_id uuid;
  v_difference jsonb;
  v_error text := null;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;

  select * into v_session
  from public.workout_sessions
  where id=p_session_id and user_id=p_user_id
  for update;

  if not found then raise exception 'Session not found'; end if;

  if upper(coalesce(v_session.planned_environment_code,''))<>'GYM' then
    return jsonb_build_object(
      'status','NOT_AVAILABLE',
      'reason','GYM_PLAN_B_REQUIRES_GYM_SESSION',
      'session_id',p_session_id,
      'version','gym-session-plan-b-fast-v2'
    );
  end if;

  if v_session.status<>'generated' or v_session.started_at is not null then
    return jsonb_build_object(
      'status','NOT_AVAILABLE',
      'reason','SESSION_PLAN_B_ONLY_BEFORE_SESSION_START',
      'session_id',p_session_id,
      'version','gym-session-plan-b-fast-v2'
    );
  end if;

  v_region_resolution := public.gym_resolve_target_region_v1(
    p_user_id,
    v_session.focus,
    coalesce(v_session.generation_local_date,public.ugerod_effective_session_anchor_date_v1()),
    v_session.target_region
  );
  v_resolved_region := v_region_resolution->>'target_region';

  begin
    if v_session.target_region is null and v_resolved_region is not null then
      update public.workout_sessions
      set target_region=v_resolved_region,
          planning_context_json=coalesce(planning_context_json,'{}'::jsonb)
            || jsonb_build_object('gym_target_region_resolution',v_region_resolution),
          updated_at=now()
      where id=p_session_id and user_id=p_user_id;
    end if;

    v_result := public.change_gym_session_plan_fast_v1(
      p_user_id,p_session_id
    );

    if coalesce(v_result->>'status','')<>'APPLIED'
       or nullif(v_result->>'new_session_id','') is null then
      raise exception 'GYM_PLAN_B_GENERATION_NOT_AVAILABLE';
    end if;

    v_new_session_id := (v_result->>'new_session_id')::uuid;
    v_difference := public.ugerod_session_plan_difference_v1(
      p_session_id,v_new_session_id
    );

    if not coalesce((v_difference->>'meaningfully_different')::boolean,false) then
      raise exception 'GYM_PLAN_B_NOT_MEANINGFULLY_DIFFERENT';
    end if;

    update public.workout_sessions
    set planning_context_json=coalesce(planning_context_json,'{}'::jsonb)
          || jsonb_build_object(
            'gym_target_region_resolution',v_region_resolution,
            'whole_session_difference',v_difference
          ),
        generated_workout=jsonb_set(
          coalesce(generated_workout,'{}'::jsonb),
          '{meta}',
          coalesce(generated_workout->'meta','{}'::jsonb)
            || jsonb_build_object(
              'resolved_target_region',v_resolved_region,
              'gym_target_region_resolution',v_region_resolution
            ),
          true
        ),
        updated_at=now()
    where id=v_new_session_id and user_id=p_user_id;

    return v_result || jsonb_build_object(
      'version','gym-session-plan-b-fast-v2',
      'router_version','whole-session-environment-router-v4',
      'resolved_target_region',v_resolved_region,
      'gym_target_region_resolution',v_region_resolution,
      'difference',v_difference,
      'meaningfully_different',true,
      'whole_session_difference_enforced',true
    );
  exception when others then
    v_error := sqlerrm;
  end;

  return jsonb_build_object(
    'status','NOT_AVAILABLE',
    'reason','SESSION_PLAN_B_NO_MEANINGFUL_ALTERNATIVE_AVAILABLE',
    'session_id',p_session_id,
    'environment_code','GYM',
    'resolved_target_region',v_resolved_region,
    'gym_target_region_resolution',v_region_resolution,
    'version','gym-session-plan-b-fast-v2',
    'whole_session_difference_enforced',true,
    'diagnostic',v_error
  );
end;
$$;

create or replace function public.change_workout_session_plan_fast_v3(
  p_user_id uuid,
  p_session_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
set statement_timeout to '30s'
as $$
declare
  v_session public.workout_sessions%rowtype;
  v_environment text;
  v_result jsonb;
  v_new_session_id uuid;
  v_difference jsonb;
  v_error text := null;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then
    raise exception 'Forbidden user';
  end if;

  select * into v_session
  from public.workout_sessions
  where id=p_session_id and user_id=p_user_id
  for update;

  if not found then raise exception 'Session not found'; end if;

  if v_session.status<>'generated' or v_session.started_at is not null then
    return jsonb_build_object(
      'status','NOT_AVAILABLE',
      'reason','SESSION_PLAN_B_ONLY_BEFORE_SESSION_START',
      'session_id',p_session_id,
      'version','whole-session-environment-router-v4'
    );
  end if;

  v_environment := upper(coalesce(v_session.planned_environment_code,'UNKNOWN'));

  if v_environment='GYM' then
    return public.change_gym_session_plan_fast_v2(p_user_id,p_session_id)
      || jsonb_build_object('whole_session_router_version','whole-session-environment-router-v4');
  end if;

  if v_environment='OUTDOOR' then
    begin
      v_result := public.change_outdoor_session_plan_fast_v1(
        p_user_id,p_session_id
      );

      if coalesce(v_result->>'status','')<>'APPLIED'
         or nullif(v_result->>'new_session_id','') is null then
        raise exception 'OUTDOOR_PLAN_B_GENERATION_NOT_AVAILABLE';
      end if;

      v_new_session_id := (v_result->>'new_session_id')::uuid;
      v_difference := public.ugerod_session_plan_difference_v1(
        p_session_id,v_new_session_id
      );

      if not coalesce((v_difference->>'meaningfully_different')::boolean,false) then
        raise exception 'OUTDOOR_PLAN_B_NOT_MEANINGFULLY_DIFFERENT';
      end if;

      update public.workout_sessions
      set planning_context_json=coalesce(planning_context_json,'{}'::jsonb)
            || jsonb_build_object('whole_session_difference',v_difference),
          updated_at=now()
      where id=v_new_session_id and user_id=p_user_id;

      return v_result || jsonb_build_object(
        'whole_session_router_version','whole-session-environment-router-v4',
        'difference',v_difference,
        'whole_session_difference_enforced',true
      );
    exception when others then
      v_error:=sqlerrm;
    end;

    return jsonb_build_object(
      'status','NOT_AVAILABLE',
      'reason','SESSION_PLAN_B_NO_MEANINGFUL_ALTERNATIVE_AVAILABLE',
      'session_id',p_session_id,
      'environment_code',v_environment,
      'version','whole-session-environment-router-v4',
      'whole_session_difference_enforced',true,
      'diagnostic',v_error
    );
  end if;

  begin
    v_result := public.change_workout_session_plan_v1(
      p_user_id,p_session_id
    );

    if coalesce(v_result->>'status','')<>'APPLIED'
       or nullif(v_result->>'new_session_id','') is null then
      raise exception 'WHOLE_SESSION_PLAN_B_GENERATION_NOT_AVAILABLE';
    end if;

    v_new_session_id := (v_result->>'new_session_id')::uuid;
    v_difference := public.ugerod_session_plan_difference_v1(
      p_session_id,v_new_session_id
    );

    if not coalesce((v_difference->>'meaningfully_different')::boolean,false) then
      raise exception 'SESSION_PLAN_B_NO_MEANINGFUL_ALTERNATIVE_AVAILABLE';
    end if;

    update public.workout_sessions
    set planning_context_json=coalesce(planning_context_json,'{}'::jsonb)
          || jsonb_build_object('whole_session_difference',v_difference),
        updated_at=now()
    where id=v_new_session_id and user_id=p_user_id;

    return v_result || jsonb_build_object(
      'whole_session_router_version','whole-session-environment-router-v4',
      'fast_path',false,
      'fast_path_kind','FULL_SESSION_MEANINGFUL_ALTERNATIVE',
      'difference',v_difference,
      'whole_session_difference_enforced',true
    );
  exception when others then
    v_error:=sqlerrm;
  end;

  return jsonb_build_object(
    'status','NOT_AVAILABLE',
    'reason','SESSION_PLAN_B_NO_MEANINGFUL_ALTERNATIVE_AVAILABLE',
    'session_id',p_session_id,
    'environment_code',v_environment,
    'version','whole-session-environment-router-v4',
    'whole_session_difference_enforced',true,
    'diagnostic',v_error
  );
end;
$$;

revoke all on function public.gym_resolve_target_region_v1(uuid,text,date,text) from public;
revoke all on function public.generate_environment_session_v4(uuid,text,text,text,text,text,integer,text,text,text,text[],jsonb,text[],text,boolean,boolean,boolean,integer,text,integer,text,boolean,date) from public;
revoke all on function public.change_gym_session_plan_fast_v2(uuid,uuid) from public;
revoke all on function public.change_workout_session_plan_fast_v3(uuid,uuid) from public;

grant execute on function public.gym_resolve_target_region_v1(uuid,text,date,text) to authenticated;
grant execute on function public.generate_environment_session_v4(uuid,text,text,text,text,text,integer,text,text,text,text[],jsonb,text[],text,boolean,boolean,boolean,integer,text,integer,text,boolean,date) to authenticated;
grant execute on function public.change_gym_session_plan_fast_v2(uuid,uuid) to authenticated;
grant execute on function public.change_workout_session_plan_fast_v3(uuid,uuid) to authenticated;
