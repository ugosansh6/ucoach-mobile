alter table public.workout_sessions
add column if not exists wod_revealed_at timestamptz;

create or replace function public.mark_wod_revealed(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user uuid:=auth.uid();
  v_session public.workout_sessions%rowtype;
begin
  if v_user is null then raise exception 'Authentication required'; end if;

  select * into v_session
  from public.workout_sessions
  where id=p_session_id and user_id=v_user
  for update;

  if not found then raise exception 'Session not found'; end if;
  if v_session.status not in ('generated','in_progress') then
    return jsonb_build_object('status','NOT_REVEALABLE','session_id',p_session_id,'session_status',v_session.status);
  end if;

  update public.workout_sessions
  set wod_revealed_at=coalesce(wod_revealed_at,now()),updated_at=now()
  where id=p_session_id and user_id=v_user
  returning * into v_session;

  return jsonb_build_object(
    'status','WOD_REVEALED',
    'session_id',p_session_id,
    'wod_revealed_at',v_session.wod_revealed_at,
    'format_locked',true
  );
end;
$function$;

revoke execute on function public.mark_wod_revealed(uuid) from public,anon;
grant execute on function public.mark_wod_revealed(uuid) to authenticated;

alter function public.c4_evaluate_session_format(uuid,uuid,text,text)
rename to c4_evaluate_session_format_pre_reveal_guard;

create or replace function public.c4_evaluate_session_format(
  p_user_id uuid,
  p_session_id uuid,
  p_new_mechanic text,
  p_variant_key text default null::text
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_revealed_at timestamptz;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;

  select wod_revealed_at into v_revealed_at
  from public.workout_sessions
  where id=p_session_id and user_id=p_user_id;

  if not found then
    return jsonb_build_object('compatible',false,'classification','NOT_RECOMMENDED','reason_codes',jsonb_build_array('SESSION_NOT_FOUND'));
  end if;

  if v_revealed_at is not null then
    return jsonb_build_object(
      'compatible',false,
      'classification','LOCKED_AFTER_WOD_REVEAL',
      'reason_codes',jsonb_build_array('WOD_ALREADY_REVEALED'),
      'wod_revealed_at',v_revealed_at
    );
  end if;

  return public.c4_evaluate_session_format_pre_reveal_guard(p_user_id,p_session_id,p_new_mechanic,p_variant_key);
end;
$function$;

alter function public.c4_recompile_session_format_core(uuid,uuid,text,text,jsonb)
rename to c4_recompile_session_format_core_pre_reveal_guard;

create or replace function public.c4_recompile_session_format_core(
  p_user_id uuid,
  p_session_id uuid,
  p_new_mechanic text,
  p_variant_key text default null::text,
  p_overlays jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_revealed_at timestamptz;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;

  select wod_revealed_at into v_revealed_at
  from public.workout_sessions
  where id=p_session_id and user_id=p_user_id
  for update;

  if not found then raise exception 'Session not found'; end if;

  if v_revealed_at is not null then
    return jsonb_build_object(
      'status','LOCKED_AFTER_WOD_REVEAL',
      'classification','LOCKED_AFTER_WOD_REVEAL',
      'mutated',false,
      'session_id',p_session_id,
      'wod_revealed_at',v_revealed_at,
      'reason_codes',jsonb_build_array('WOD_ALREADY_REVEALED')
    );
  end if;

  return public.c4_recompile_session_format_core_pre_reveal_guard(
    p_user_id,p_session_id,p_new_mechanic,p_variant_key,coalesce(p_overlays,'[]'::jsonb)
  );
end;
$function$;;
