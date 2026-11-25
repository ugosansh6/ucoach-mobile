create or replace function public.discard_unstarted_workout_session_v1(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_session public.workout_sessions%rowtype;
  v_uid uuid:=auth.uid();
  v_released_plan_items int:=0;
begin
  if p_session_id is null then raise exception 'p_session_id is required'; end if;

  select * into v_session
  from public.workout_sessions
  where id=p_session_id
  for update;

  if not found then
    return jsonb_build_object('status','NOT_FOUND','session_id',p_session_id,'discarded',false,'version','discard-unstarted-session-v2-plan-release');
  end if;

  if v_uid is not null and v_session.user_id<>v_uid then
    raise exception 'Forbidden session';
  end if;

  if v_session.status<>'generated'
     or v_session.started_at is not null
     or v_session.started_local_date is not null
     or v_session.wod_started_at is not null then
    return jsonb_build_object(
      'status','STARTED_SESSION_PROTECTED',
      'session_id',p_session_id,
      'session_status',v_session.status,
      'discarded',false,
      'version','discard-unstarted-session-v2-plan-release'
    );
  end if;

  update public.workout_sessions
  set status='abandoned',
      planning_context_json=coalesce(planning_context_json,'{}'::jsonb)||jsonb_build_object(
        'lifecycle_disposition','REPLACED_BEFORE_START',
        'replacement_requested_at',now(),
        'counts_as_completed_execution',false
      ),
      updated_at=now()
  where id=p_session_id;

  update public.user_training_plan_items i
  set status=case
        when i.week_start < public.d_week_start(current_date) then 'unrealized'
        else 'available'
      end,
      session_id=null,
      claimed_at=null,
      updated_at=now(),
      planning_context_json=coalesce(i.planning_context_json,'{}'::jsonb)||jsonb_build_object(
        'discard_release',jsonb_build_object(
          'released_session_id',p_session_id,
          'released_at',now(),
          'reason','session_discarded_before_start',
          'user_debt_created',false
        )
      )
  where i.user_id=v_session.user_id
    and i.session_id=p_session_id
    and i.status='claimed';
  get diagnostics v_released_plan_items=row_count;

  return jsonb_build_object(
    'status','DISCARDED',
    'session_id',p_session_id,
    'discarded',true,
    'released_plan_items',v_released_plan_items,
    'counts_as_completed_execution',false,
    'version','discard-unstarted-session-v2-plan-release'
  );
end;
$function$;

-- Repair legacy orphaned claims created before the lifecycle fix.
update public.user_training_plan_items i
set status=case
      when i.week_start < public.d_week_start(current_date) then 'unrealized'
      else 'available'
    end,
    session_id=null,
    claimed_at=null,
    updated_at=now(),
    planning_context_json=coalesce(i.planning_context_json,'{}'::jsonb)||jsonb_build_object(
      'orphan_claim_repair',jsonb_build_object(
        'repaired_at',now(),
        'reason','linked_session_abandoned',
        'user_debt_created',false
      )
    )
from public.workout_sessions ws
where i.session_id=ws.id
  and i.user_id=ws.user_id
  and i.status='claimed'
  and ws.status='abandoned';