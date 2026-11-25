-- PLAY-011 — WOD reveal must not lock format changes.
-- Contract: the format stays changeable until the WOD actually starts.

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
  v_locked boolean:=false;
  v_remaining int:=0;
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
  v_locked:=v_session.wod_started_at is not null or (not v_unlimited and v_effective_count>=3);
  v_remaining:=case
    when v_session.wod_started_at is not null then 0
    when v_unlimited then 3
    else greatest(0,3-v_effective_count)
  end;

  return jsonb_build_object(
    'status','WOD_REVEALED','session_id',p_session_id,
    'wod_revealed_at',v_session.wod_revealed_at,'wod_started_at',v_session.wod_started_at,
    'format_change_count',v_effective_count,'format_change_limit',3,
    'remaining_format_changes',v_remaining,'format_change_unlimited',v_unlimited,
    'format_locked',v_locked,
    'format_lock_reason',case
      when v_session.wod_started_at is not null then 'WOD_ALREADY_STARTED'
      when not v_unlimited and v_effective_count>=3 then 'FORMAT_CHANGE_LIMIT_REACHED'
      else null
    end,
    'format_lock_contract','LOCK_ON_WOD_START_NOT_REVEAL',
    'format_anchor_frozen',true
  );
end;
$function$;
