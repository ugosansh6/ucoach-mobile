alter table public.workout_session_swap_history
  add column if not exists from_selection_provenance text,
  add column if not exists to_selection_provenance text;

do $$ begin
  alter table public.workout_session_swap_history
    add constraint workout_session_swap_history_from_provenance_chk
    check (from_selection_provenance is null or from_selection_provenance in ('USER_SELECTED','UGEROD_GENERATED','UGEROD_ADDED_PREP','UGEROD_SUGGESTED_ACCEPTED','IMPORTED_COPIED','LEGACY_UNKNOWN'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.workout_session_swap_history
    add constraint workout_session_swap_history_to_provenance_chk
    check (to_selection_provenance is null or to_selection_provenance in ('USER_SELECTED','UGEROD_GENERATED','UGEROD_ADDED_PREP','UGEROD_SUGGESTED_ACCEPTED','IMPORTED_COPIED','LEGACY_UNKNOWN'));
exception when duplicate_object then null; end $$;

alter function public.c4_swap_session_exercise_v3(uuid,uuid,text,text[],boolean)
rename to c4_swap_session_exercise_v3_pre_provenance_roundtrip;

revoke all on function public.c4_swap_session_exercise_v3_pre_provenance_roundtrip(uuid,uuid,text,text[],boolean) from public;
revoke all on function public.c4_swap_session_exercise_v3_pre_provenance_roundtrip(uuid,uuid,text,text[],boolean) from anon;
revoke all on function public.c4_swap_session_exercise_v3_pre_provenance_roundtrip(uuid,uuid,text,text[],boolean) from authenticated;

create or replace function public.c4_swap_session_exercise_v3(
  p_user_id uuid,
  p_session_exercise_id uuid,
  p_direction text default 'equivalent',
  p_excluded_exercise_ids text[] default '{}'::text[],
  p_undo boolean default false
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_before record;
  v_active_history public.workout_session_swap_history%rowtype;
  v_result jsonb;
  v_new_exercise_id text;
  v_restored_provenance text;
  v_history_id bigint;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;

  select wse.id,wse.session_id,wse.exercise_id,wse.selection_provenance
  into v_before
  from public.workout_session_exercises wse
  join public.workout_sessions ws on ws.id=wse.session_id
  where wse.id=p_session_exercise_id and ws.user_id=p_user_id;
  if not found then raise exception 'Session exercise instance not found'; end if;

  if p_undo then
    select * into v_active_history
    from public.workout_session_swap_history h
    where h.user_id=p_user_id
      and h.session_id=v_before.session_id
      and h.session_exercise_id=p_session_exercise_id
      and h.undone_at is null
      and h.to_exercise_id=v_before.exercise_id
    order by h.id desc
    limit 1;
  end if;

  v_result:=public.c4_swap_session_exercise_v3_pre_provenance_roundtrip(
    p_user_id,p_session_exercise_id,p_direction,p_excluded_exercise_ids,p_undo
  );

  if coalesce(v_result->>'status','')<>'APPLIED' or not coalesce((v_result->>'mutated')::boolean,false) then
    return v_result||jsonb_build_object(
      'selection_provenance_contract','pref001-swap-undo-roundtrip-v1',
      'selection_provenance_changed',false
    );
  end if;

  v_new_exercise_id:=nullif(v_result->>'new_exercise_id','');

  if not p_undo then
    update public.workout_session_exercises
    set selection_provenance='UGEROD_SUGGESTED_ACCEPTED',updated_at=now()
    where id=p_session_exercise_id;

    select h.id into v_history_id
    from public.workout_session_swap_history h
    where h.user_id=p_user_id
      and h.session_id=v_before.session_id
      and h.session_exercise_id=p_session_exercise_id
      and h.undone_at is null
      and h.from_exercise_id=v_before.exercise_id
      and (v_new_exercise_id is null or h.to_exercise_id=v_new_exercise_id)
    order by h.id desc
    limit 1;

    if v_history_id is not null then
      update public.workout_session_swap_history
      set from_selection_provenance=coalesce(nullif(v_before.selection_provenance,''),'LEGACY_UNKNOWN'),
          to_selection_provenance='UGEROD_SUGGESTED_ACCEPTED'
      where id=v_history_id;
    end if;

    return v_result||jsonb_build_object(
      'selection_provenance_contract','pref001-swap-undo-roundtrip-v1',
      'selection_provenance_before',coalesce(nullif(v_before.selection_provenance,''),'LEGACY_UNKNOWN'),
      'selection_provenance_after','UGEROD_SUGGESTED_ACCEPTED',
      'selection_provenance_changed',true
    );
  end if;

  v_restored_provenance:=case
    when v_active_history.id is null then 'LEGACY_UNKNOWN'
    when nullif(v_active_history.from_selection_provenance,'') is null then 'LEGACY_UNKNOWN'
    else v_active_history.from_selection_provenance
  end;

  update public.workout_session_exercises
  set selection_provenance=v_restored_provenance,updated_at=now()
  where id=p_session_exercise_id;

  return v_result||jsonb_build_object(
    'selection_provenance_contract','pref001-swap-undo-roundtrip-v1',
    'selection_provenance_before',coalesce(nullif(v_before.selection_provenance,''),'LEGACY_UNKNOWN'),
    'selection_provenance_after',v_restored_provenance,
    'selection_provenance_changed',true,
    'undo_restored_original_provenance',v_active_history.id is not null and nullif(v_active_history.from_selection_provenance,'') is not null
  );
end $$;

grant execute on function public.c4_swap_session_exercise_v3(uuid,uuid,text,text[],boolean) to authenticated;
revoke all on function public.c4_swap_session_exercise_v3(uuid,uuid,text,text[],boolean) from anon;
revoke all on function public.c4_swap_session_exercise_v3(uuid,uuid,text,text[],boolean) from public;

comment on column public.workout_session_swap_history.from_selection_provenance is
  'PREF-001 provenance before a user-accepted UGEROD swap; used to restore exact origin on Undo.';
comment on column public.workout_session_swap_history.to_selection_provenance is
  'PREF-001 provenance after swap; canonical accepted suggestion is UGEROD_SUGGESTED_ACCEPTED.';