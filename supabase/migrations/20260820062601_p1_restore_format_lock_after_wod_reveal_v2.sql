create or replace function public.c4_evaluate_session_format(p_user_id uuid, p_session_id uuid, p_new_mechanic text, p_variant_key text default null::text)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_started_at timestamptz;
  v_revealed_at timestamptz;
  v_count int;
  v_effective_count int;
  v_unlimited boolean:=false;
  v_current_mechanic text;
  v_current_variant text;
  v_target_mechanic text:=upper(trim(coalesce(p_new_mechanic,'')));
  v_target_variant text:=upper(trim(coalesce(p_variant_key,'')));
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;
  select wod_started_at,wod_revealed_at,format_change_count,
         upper(coalesce(mechanic_json->>'mechanic_key','CIRCUIT')),
         upper(coalesce(mechanic_json->>'variant_key',''))
  into v_started_at,v_revealed_at,v_count,v_current_mechanic,v_current_variant
  from public.workout_sessions where id=p_session_id and user_id=p_user_id;
  if not found then
    return jsonb_build_object('compatible',false,'classification','NOT_RECOMMENDED','reason_codes',jsonb_build_array('SESSION_NOT_FOUND'));
  end if;

  v_unlimited:=public.c4_user_unlimited_format_changes_v1(p_user_id);
  v_effective_count:=case when v_unlimited then 0 else coalesce(v_count,0) end;

  if v_target_mechanic=v_current_mechanic and coalesce(v_target_variant,'')=coalesce(v_current_variant,'') then
    return jsonb_build_object(
      'compatible',true,'classification','CURRENT','reason_codes','[]'::jsonb,
      'format_change_count',v_effective_count,'format_change_limit',3,
      'remaining_format_changes',case when v_revealed_at is not null or v_started_at is not null then 0 when v_unlimited then 3 else greatest(0,3-v_effective_count) end,
      'format_change_unlimited',v_unlimited,
      'format_locked',v_revealed_at is not null or v_started_at is not null or (not v_unlimited and v_effective_count>=3),
      'wod_revealed_at',v_revealed_at,'wod_started_at',v_started_at
    );
  end if;
  if v_started_at is not null then
    return jsonb_build_object(
      'compatible',false,'classification','LOCKED_AFTER_WOD_START','reason_codes',jsonb_build_array('WOD_ALREADY_STARTED'),
      'wod_started_at',v_started_at,'wod_revealed_at',v_revealed_at,
      'format_change_count',v_effective_count,'format_change_limit',3,'remaining_format_changes',0,
      'format_change_unlimited',v_unlimited,'format_locked',true
    );
  end if;
  if v_revealed_at is not null then
    return jsonb_build_object(
      'compatible',false,'classification','LOCKED_AFTER_WOD_REVEAL','reason_codes',jsonb_build_array('WOD_ALREADY_REVEALED'),
      'wod_revealed_at',v_revealed_at,
      'format_change_count',v_effective_count,'format_change_limit',3,'remaining_format_changes',0,
      'format_change_unlimited',v_unlimited,'format_locked',true
    );
  end if;
  if not v_unlimited and v_effective_count>=3 then
    return jsonb_build_object(
      'compatible',false,'classification','LOCKED_AFTER_FORMAT_CHANGE_LIMIT','reason_codes',jsonb_build_array('FORMAT_CHANGE_LIMIT_REACHED'),
      'format_change_count',v_effective_count,'format_change_limit',3,'remaining_format_changes',0,
      'format_change_unlimited',false,'format_locked',true
    );
  end if;

  return public.c4_evaluate_session_format_pre_reveal_guard(p_user_id,p_session_id,p_new_mechanic,p_variant_key)
    || jsonb_build_object(
      'format_change_count',v_effective_count,'format_change_limit',3,
      'remaining_format_changes',case when v_unlimited then 3 else greatest(0,3-v_effective_count) end,
      'format_change_unlimited',v_unlimited,'format_locked',false,
      'wod_revealed_at',v_revealed_at,'wod_started_at',v_started_at
    );
end;
$function$;

create or replace function public.c4_recompile_session_format_core(p_user_id uuid, p_session_id uuid, p_new_mechanic text, p_variant_key text default null::text, p_overlays jsonb default '[]'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_started_at timestamptz;
  v_revealed_at timestamptz;
  v_count int;
  v_effective_count int;
  v_unlimited boolean:=false;
  v_current_mechanic text;
  v_current_variant text;
  v_target_mechanic text:=upper(trim(coalesce(p_new_mechanic,'')));
  v_target_variant text:=upper(trim(coalesce(p_variant_key,'')));
  v_anchor jsonb;
  v_result jsonb;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;
  select wod_started_at,wod_revealed_at,format_change_count,
         upper(coalesce(mechanic_json->>'mechanic_key','CIRCUIT')),
         upper(coalesce(mechanic_json->>'variant_key','')),wod_format_anchor_json
  into v_started_at,v_revealed_at,v_count,v_current_mechanic,v_current_variant,v_anchor
  from public.workout_sessions where id=p_session_id and user_id=p_user_id for update;
  if not found then raise exception 'Session not found'; end if;

  v_unlimited:=public.c4_user_unlimited_format_changes_v1(p_user_id);
  v_effective_count:=case when v_unlimited then 0 else coalesce(v_count,0) end;

  if v_target_mechanic=v_current_mechanic and coalesce(v_target_variant,'')=coalesce(v_current_variant,'') then
    return jsonb_build_object(
      'status','NO_CHANGE','classification','CURRENT','mutated',false,'session_id',p_session_id,
      'format_change_count',v_effective_count,'format_change_limit',3,
      'remaining_format_changes',case when v_revealed_at is not null or v_started_at is not null then 0 when v_unlimited then 3 else greatest(0,3-v_effective_count) end,
      'format_change_unlimited',v_unlimited,
      'format_locked',v_revealed_at is not null or v_started_at is not null or (not v_unlimited and v_effective_count>=3),
      'wod_revealed_at',v_revealed_at,'wod_started_at',v_started_at
    );
  end if;
  if v_started_at is not null then
    return jsonb_build_object(
      'status','LOCKED_AFTER_WOD_START','classification','LOCKED_AFTER_WOD_START','mutated',false,'session_id',p_session_id,
      'wod_started_at',v_started_at,'wod_revealed_at',v_revealed_at,'reason_codes',jsonb_build_array('WOD_ALREADY_STARTED'),
      'format_change_count',v_effective_count,'format_change_limit',3,'remaining_format_changes',0,
      'format_change_unlimited',v_unlimited,'format_locked',true
    );
  end if;
  if v_revealed_at is not null then
    return jsonb_build_object(
      'status','LOCKED_AFTER_WOD_REVEAL','classification','LOCKED_AFTER_WOD_REVEAL','mutated',false,'session_id',p_session_id,
      'wod_revealed_at',v_revealed_at,'reason_codes',jsonb_build_array('WOD_ALREADY_REVEALED'),
      'format_change_count',v_effective_count,'format_change_limit',3,'remaining_format_changes',0,
      'format_change_unlimited',v_unlimited,'format_locked',true
    );
  end if;
  if not v_unlimited and v_effective_count>=3 then
    return jsonb_build_object(
      'status','LOCKED_AFTER_FORMAT_CHANGE_LIMIT','classification','LOCKED_AFTER_FORMAT_CHANGE_LIMIT','mutated',false,'session_id',p_session_id,
      'reason_codes',jsonb_build_array('FORMAT_CHANGE_LIMIT_REACHED'),
      'format_change_count',v_effective_count,'format_change_limit',3,'remaining_format_changes',0,
      'format_change_unlimited',false,'format_locked',true
    );
  end if;

  if jsonb_typeof(v_anchor)<>'object' or v_anchor='{}'::jsonb or jsonb_array_length(coalesce(v_anchor->'exercises','[]'::jsonb))=0 then
    v_anchor:=public.c4_session_wod_candidate(p_session_id);
  end if;
  v_result:=public.c4_recompile_session_format_core_pre_reveal_guard(p_user_id,p_session_id,p_new_mechanic,p_variant_key,coalesce(p_overlays,'[]'::jsonb));

  if coalesce(v_result->>'status','')='APPLIED' and coalesce((v_result->>'mutated')::boolean,false) then
    update public.workout_sessions
    set format_change_count=case when v_unlimited then 0 else least(3,coalesce(format_change_count,0)+1) end,
        wod_format_anchor_json=case
          when jsonb_typeof(wod_format_anchor_json)='object' and wod_format_anchor_json<>'{}'::jsonb
               and jsonb_array_length(coalesce(wod_format_anchor_json->'exercises','[]'::jsonb))>0
          then wod_format_anchor_json else v_anchor end,
        updated_at=now()
    where id=p_session_id and user_id=p_user_id
    returning format_change_count into v_count;
    v_effective_count:=case when v_unlimited then 0 else coalesce(v_count,0) end;
    v_result:=v_result||jsonb_build_object(
      'format_change_count',v_effective_count,'format_change_limit',3,
      'remaining_format_changes',case when v_unlimited then 3 else greatest(0,3-v_effective_count) end,
      'format_change_unlimited',v_unlimited,'format_locked',false,'wod_revealed_at',null,'wod_started_at',null
    );
  else
    v_result:=v_result||jsonb_build_object(
      'format_change_count',v_effective_count,'format_change_limit',3,
      'remaining_format_changes',case when v_unlimited then 3 else greatest(0,3-v_effective_count) end,
      'format_change_unlimited',v_unlimited,'format_locked',false,'wod_revealed_at',v_revealed_at,'wod_started_at',v_started_at
    );
  end if;
  return v_result;
end;
$function$;

create or replace function public.get_workout_format_options_pre_explainability_v1(p_session_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_user_id uuid:=auth.uid();
  v_tier text;
  v_current_mechanic text;
  v_current_variant text;
  v_count int;
  v_effective_count int;
  v_unlimited boolean:=false;
  v_started_at timestamptz;
  v_revealed_at timestamptz;
  v_options jsonb:='[]'::jsonb;
  v_eval jsonb;
  r record;
  v_entitled boolean;
  v_locked boolean;
  v_compatible boolean;
  v_option_id text;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if not exists(select 1 from public.workout_sessions where id=p_session_id and user_id=v_user_id) then raise exception 'Session not found'; end if;
  select coalesce(subscription_tier,'FREE') into v_tier from public.profiles where id=v_user_id;
  v_tier:=coalesce(v_tier,'FREE');
  select upper(coalesce(mechanic_json->>'mechanic_key','CIRCUIT')),upper(coalesce(mechanic_json->>'variant_key','')),format_change_count,wod_started_at,wod_revealed_at
  into v_current_mechanic,v_current_variant,v_count,v_started_at,v_revealed_at
  from public.workout_sessions where id=p_session_id and user_id=v_user_id;
  v_unlimited:=public.c4_user_unlimited_format_changes_v1(v_user_id);
  v_effective_count:=case when v_unlimited then 0 else coalesce(v_count,0) end;
  if v_current_variant='' then
    if v_current_mechanic='COUPLET' then v_current_variant:='ASCENDING_COUPLET';
    elsif v_current_mechanic='PROGRESSIVE_INTERVAL' then v_current_variant:='PROGRESSIVE_GENERIC'; end if;
  end if;

  for r in
    select wm.mechanic_key,null::text as variant_key,wm.display_name,wm.short_description,wm.manual_free_eligible,wm.manual_premium_eligible,0 as variant_sort
    from public.workout_mechanics wm
    where wm.active and wm.mechanic_kind='core'
      and not exists(select 1 from public.workout_mechanic_variants wmv where wmv.mechanic_key=wm.mechanic_key and wmv.active)
    union all
    select wmv.mechanic_key,wmv.variant_key,wmv.display_name,wmv.short_description,wmv.manual_free_eligible,wmv.manual_premium_eligible,1 as variant_sort
    from public.workout_mechanic_variants wmv
    join public.workout_mechanics wm on wm.mechanic_key=wmv.mechanic_key and wm.active and wm.mechanic_kind='core'
    where wmv.active
    order by mechanic_key,variant_sort,variant_key nulls first
  loop
    v_eval:=public.c4_evaluate_session_format(v_user_id,p_session_id,r.mechanic_key,r.variant_key);
    v_compatible:=coalesce((v_eval->>'compatible')::boolean,false);
    v_entitled:=case when v_tier='PREMIUM' then coalesce(r.manual_premium_eligible,false) else coalesce(r.manual_free_eligible,false) end;
    v_locked:=v_compatible and not v_entitled;
    v_option_id:=case when r.variant_key is null then r.mechanic_key else r.variant_key end;
    v_options:=v_options||jsonb_build_array(jsonb_build_object(
      'option_id',v_option_id,'mechanic',r.mechanic_key,'variant_key',r.variant_key,
      'display_name',r.display_name,'description',r.short_description,
      'compatible',v_compatible,'classification',coalesce(v_eval->>'classification','NOT_RECOMMENDED'),
      'entitled',v_entitled,'locked',v_locked,
      'selectable',v_compatible and v_entitled and coalesce(v_eval->>'classification','')<>'CURRENT',
      'current',r.mechanic_key=v_current_mechanic and coalesce(r.variant_key,'')=coalesce(v_current_variant,''),
      'reason_codes',coalesce(v_eval->'reason_codes','[]'::jsonb),'mechanic_json',v_eval->'mechanic_json'
    ));
  end loop;

  return jsonb_build_object(
    'session_id',p_session_id,'subscription_tier',v_tier,
    'current_mechanic',v_current_mechanic,'current_variant',nullif(v_current_variant,''),
    'wod_revealed_at',v_revealed_at,'wod_started_at',v_started_at,
    'format_change_count',v_effective_count,'format_change_limit',3,
    'remaining_format_changes',case when v_revealed_at is not null or v_started_at is not null then 0 when v_unlimited then 3 else greatest(0,3-v_effective_count) end,
    'format_change_unlimited',v_unlimited,
    'format_locked',v_revealed_at is not null or v_started_at is not null or (not v_unlimited and v_effective_count>=3),
    'format_lock_reason',case when v_started_at is not null then 'WOD_ALREADY_STARTED' when v_revealed_at is not null then 'WOD_ALREADY_REVEALED' else null end,
    'options',v_options,'version','pre-reveal-format-change-v2'
  );
end;
$function$;

create or replace function public.mark_wod_revealed(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user uuid:=auth.uid();
  v_session public.workout_sessions%rowtype;
  v_anchor jsonb;
  v_unlimited boolean:=false;
  v_effective_count int:=0;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  select * into v_session from public.workout_sessions where id=p_session_id and user_id=v_user for update;
  if not found then raise exception 'Session not found'; end if;
  if v_session.status not in ('generated','in_progress') then
    return jsonb_build_object('status','NOT_REVEALABLE','session_id',p_session_id,'session_status',v_session.status);
  end if;

  if jsonb_typeof(v_session.wod_format_anchor_json)<>'object'
     or v_session.wod_format_anchor_json='{}'::jsonb
     or jsonb_array_length(coalesce(v_session.wod_format_anchor_json->'exercises','[]'::jsonb))=0 then
    v_anchor:=public.c4_session_wod_candidate(p_session_id);
  else
    v_anchor:=v_session.wod_format_anchor_json;
  end if;

  update public.workout_sessions
  set wod_revealed_at=coalesce(wod_revealed_at,now()),
      wod_format_anchor_json=coalesce(v_anchor,'{}'::jsonb),
      updated_at=now()
  where id=p_session_id and user_id=v_user
  returning * into v_session;

  v_unlimited:=public.c4_user_unlimited_format_changes_v1(v_user);
  v_effective_count:=case when v_unlimited then 0 else coalesce(v_session.format_change_count,0) end;

  return jsonb_build_object(
    'status','WOD_REVEALED','session_id',p_session_id,
    'wod_revealed_at',v_session.wod_revealed_at,'wod_started_at',v_session.wod_started_at,
    'format_change_count',v_effective_count,'format_change_limit',3,
    'remaining_format_changes',0,'format_change_unlimited',v_unlimited,
    'format_locked',true,'format_lock_reason','WOD_ALREADY_REVEALED','format_anchor_frozen',true
  );
end;
$function$;
