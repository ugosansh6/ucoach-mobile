create or replace function public.c4_evaluate_session_format(p_user_id uuid, p_session_id uuid, p_new_mechanic text, p_variant_key text default null::text)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_started_at timestamptz;
  v_count int;
  v_current_mechanic text;
  v_current_variant text;
  v_target_mechanic text:=upper(trim(coalesce(p_new_mechanic,'')));
  v_target_variant text:=upper(trim(coalesce(p_variant_key,'')));
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;
  select wod_started_at,format_change_count,upper(coalesce(mechanic_json->>'mechanic_key','CIRCUIT')),upper(coalesce(mechanic_json->>'variant_key',''))
  into v_started_at,v_count,v_current_mechanic,v_current_variant
  from public.workout_sessions where id=p_session_id and user_id=p_user_id;
  if not found then return jsonb_build_object('compatible',false,'classification','NOT_RECOMMENDED','reason_codes',jsonb_build_array('SESSION_NOT_FOUND')); end if;

  if v_target_mechanic=v_current_mechanic and coalesce(v_target_variant,'')=coalesce(v_current_variant,'') then
    return jsonb_build_object('compatible',true,'classification','CURRENT','reason_codes','[]'::jsonb,'format_change_count',coalesce(v_count,0),'format_change_limit',3,'remaining_format_changes',greatest(0,3-coalesce(v_count,0)),'format_locked',v_started_at is not null or coalesce(v_count,0)>=3);
  end if;
  if v_started_at is not null then
    return jsonb_build_object('compatible',false,'classification','LOCKED_AFTER_WOD_START','reason_codes',jsonb_build_array('WOD_ALREADY_STARTED'),'wod_started_at',v_started_at,'format_change_count',coalesce(v_count,0),'format_change_limit',3,'remaining_format_changes',0,'format_locked',true);
  end if;
  if coalesce(v_count,0)>=3 then
    return jsonb_build_object('compatible',false,'classification','LOCKED_AFTER_FORMAT_CHANGE_LIMIT','reason_codes',jsonb_build_array('FORMAT_CHANGE_LIMIT_REACHED'),'format_change_count',coalesce(v_count,0),'format_change_limit',3,'remaining_format_changes',0,'format_locked',true);
  end if;

  return public.c4_evaluate_session_format_pre_reveal_guard(p_user_id,p_session_id,p_new_mechanic,p_variant_key)
    || jsonb_build_object('format_change_count',coalesce(v_count,0),'format_change_limit',3,'remaining_format_changes',greatest(0,3-coalesce(v_count,0)),'format_locked',false);
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
  v_count int;
  v_current_mechanic text;
  v_current_variant text;
  v_target_mechanic text:=upper(trim(coalesce(p_new_mechanic,'')));
  v_target_variant text:=upper(trim(coalesce(p_variant_key,'')));
  v_anchor jsonb;
  v_result jsonb;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;
  select wod_started_at,format_change_count,upper(coalesce(mechanic_json->>'mechanic_key','CIRCUIT')),upper(coalesce(mechanic_json->>'variant_key','')),wod_format_anchor_json
  into v_started_at,v_count,v_current_mechanic,v_current_variant,v_anchor
  from public.workout_sessions where id=p_session_id and user_id=p_user_id for update;
  if not found then raise exception 'Session not found'; end if;

  if v_target_mechanic=v_current_mechanic and coalesce(v_target_variant,'')=coalesce(v_current_variant,'') then
    return jsonb_build_object('status','NO_CHANGE','classification','CURRENT','mutated',false,'session_id',p_session_id,'format_change_count',coalesce(v_count,0),'format_change_limit',3,'remaining_format_changes',greatest(0,3-coalesce(v_count,0)),'format_locked',v_started_at is not null or coalesce(v_count,0)>=3);
  end if;
  if v_started_at is not null then
    return jsonb_build_object('status','LOCKED_AFTER_WOD_START','classification','LOCKED_AFTER_WOD_START','mutated',false,'session_id',p_session_id,'wod_started_at',v_started_at,'reason_codes',jsonb_build_array('WOD_ALREADY_STARTED'),'format_change_count',coalesce(v_count,0),'format_change_limit',3,'remaining_format_changes',0,'format_locked',true);
  end if;
  if coalesce(v_count,0)>=3 then
    return jsonb_build_object('status','LOCKED_AFTER_FORMAT_CHANGE_LIMIT','classification','LOCKED_AFTER_FORMAT_CHANGE_LIMIT','mutated',false,'session_id',p_session_id,'reason_codes',jsonb_build_array('FORMAT_CHANGE_LIMIT_REACHED'),'format_change_count',coalesce(v_count,0),'format_change_limit',3,'remaining_format_changes',0,'format_locked',true);
  end if;

  if jsonb_typeof(v_anchor)<>'object' or v_anchor='{}'::jsonb or jsonb_array_length(coalesce(v_anchor->'exercises','[]'::jsonb))=0 then v_anchor:=public.c4_session_wod_candidate(p_session_id); end if;
  v_result:=public.c4_recompile_session_format_core_pre_reveal_guard(p_user_id,p_session_id,p_new_mechanic,p_variant_key,coalesce(p_overlays,'[]'::jsonb));

  if coalesce(v_result->>'status','')='APPLIED' and coalesce((v_result->>'mutated')::boolean,false) then
    update public.workout_sessions
    set format_change_count=least(3,coalesce(format_change_count,0)+1),
        wod_format_anchor_json=case when jsonb_typeof(wod_format_anchor_json)='object' and wod_format_anchor_json<>'{}'::jsonb and jsonb_array_length(coalesce(wod_format_anchor_json->'exercises','[]'::jsonb))>0 then wod_format_anchor_json else v_anchor end,
        updated_at=now()
    where id=p_session_id and user_id=p_user_id
    returning format_change_count into v_count;
    v_result:=v_result||jsonb_build_object('format_change_count',v_count,'format_change_limit',3,'remaining_format_changes',greatest(0,3-v_count),'format_locked',v_count>=3,'wod_started_at',null);
  else
    v_result:=v_result||jsonb_build_object('format_change_count',coalesce(v_count,0),'format_change_limit',3,'remaining_format_changes',greatest(0,3-coalesce(v_count,0)),'format_locked',false);
  end if;
  return v_result;
end;
$function$;

create or replace function public.get_workout_format_options(p_session_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_base jsonb;
  v_options jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  v_base:=public.get_workout_format_options_pre_explainability_v1(p_session_id);

  select coalesce(jsonb_agg(
    o || jsonb_build_object(
      'explanations',public.coach_explain_reason_codes_v1(coalesce(o->'reason_codes','[]'::jsonb)),
      'primary_explanation',case
        when jsonb_array_length(public.coach_explain_reason_codes_v1(coalesce(o->'reason_codes','[]'::jsonb)))>0
        then public.coach_explain_reason_codes_v1(coalesce(o->'reason_codes','[]'::jsonb))->0
        else null end
    ) order by ord
  ),'[]'::jsonb)
  into v_options
  from jsonb_array_elements(coalesce(v_base->'options','[]'::jsonb)) with ordinality x(o,ord);

  return jsonb_set(v_base,'{options}',v_options,true)
    || jsonb_build_object('explainability_version','coach-explainability-v1');
end;
$function$;
