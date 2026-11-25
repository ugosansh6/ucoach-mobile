alter table public.user_runtime_overrides
  add column if not exists unlimited_context_recalculations boolean not null default false;

create or replace function public.d_user_unlimited_context_recalculations_v1(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1
    from public.user_runtime_overrides uro
    where uro.user_id = p_user_id
      and uro.unlimited_context_recalculations = true
  );
$$;

revoke all on function public.d_user_unlimited_context_recalculations_v1(uuid) from public, anon, authenticated;
grant execute on function public.d_user_unlimited_context_recalculations_v1(uuid) to service_role;

create or replace function public.d_resolve_session_context_v6_pre_program_coach(
  p_user_id uuid,
  p_anchor_date date default current_date,
  p_duration_minutes integer default 45,
  p_readiness text default 'normal'::text,
  p_focus_override text default null::text,
  p_target_region_override text default null::text,
  p_progression_intent_override text default null::text,
  p_available_equipment text[] default '{}'::text[],
  p_zone_terms text[] default '{}'::text[],
  p_force_recalculate_started boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_result jsonb;
  v_session public.workout_sessions%rowtype;
  v_active public.user_training_plan_items%rowtype;
  v_base jsonb;
  v_anchor date:=coalesce(p_anchor_date,current_date);
  v_week date:=public.d_week_start(coalesce(p_anchor_date,current_date));
  v_root uuid;
  v_count int;
  v_limit_session_id uuid;
begin
  v_result:=public.d_resolve_session_context_v6_base(
    p_user_id,p_anchor_date,p_duration_minutes,p_readiness,p_focus_override,p_target_region_override,
    p_progression_intent_override,p_available_equipment,p_zone_terms,p_force_recalculate_started
  );

  /*
   * DEV-only runtime override: the owner test profile may repeatedly regenerate
   * a not-yet-started daily session without being blocked by the normal 3-recalc
   * product guard. We preserve the normal rule for every other user and we do
   * not bypass the confirmation required once a session has actually started.
   */
  if coalesce(v_result->>'status','')='RECALC_LIMIT_REACHED'
     and public.d_user_unlimited_context_recalculations_v1(p_user_id)
  then
    v_limit_session_id:=nullif(v_result->>'session_id','')::uuid;

    if v_limit_session_id is not null then
      update public.workout_sessions
      set context_recalculation_count=0,
          planning_context_json=coalesce(planning_context_json,'{}'::jsonb)||jsonb_build_object(
            'dev_runtime_override',jsonb_build_object(
              'unlimited_context_recalculations',true,
              'last_limit_bypass_at',now()
            )
          ),
          updated_at=now()
      where id=v_limit_session_id
        and user_id=p_user_id
        and status<>'in_progress';

      v_result:=public.d_resolve_session_context_v6_base(
        p_user_id,p_anchor_date,p_duration_minutes,p_readiness,p_focus_override,p_target_region_override,
        p_progression_intent_override,p_available_equipment,p_zone_terms,p_force_recalculate_started
      );

      v_result:=v_result||jsonb_build_object(
        'context_recalculation_unlimited',true,
        'context_recalculation_limit_bypassed',true
      );
    end if;
  end if;

  if not p_force_recalculate_started
     or coalesce(v_result->>'status','')<>'RESUME_EXISTING'
     or nullif(v_result->>'resume_session_id','') is null
  then
    return v_result;
  end if;

  select * into v_session
  from public.workout_sessions
  where id=(v_result->>'resume_session_id')::uuid and user_id=p_user_id
  for update;

  if not found
     or v_session.status<>'in_progress'
     or v_session.started_local_date is distinct from v_anchor
  then
    return v_result;
  end if;

  select i.* into v_active
  from public.user_training_plan_items i
  where i.user_id=p_user_id and i.session_id=v_session.id and i.status='claimed'
  order by coalesce(i.claimed_at,i.updated_at) desc
  limit 1
  for update;

  v_root:=coalesce(v_session.context_recalculation_root_session_id,v_session.id);
  v_count:=coalesce(v_session.context_recalculation_count,0);

  delete from public.session_stimulus_ledger
  where session_id=v_session.id
    and metadata_json->>'source'='phase_d_weekly_loop';

  update public.workout_sessions
  set status='abandoned',
      planning_context_json=coalesce(planning_context_json,'{}'::jsonb)||jsonb_build_object(
        'daily_refresh',jsonb_build_object(
          'released_at',now(),'released_for_local_date',v_anchor,
          'reason','forced_recalculate_started_session_same_context'
        ),
        'recalculation_release',jsonb_build_object(
          'changed_fields','[]'::jsonb,'safety_only',false,'next_count',v_count,'root_session_id',v_root,
          'forced_after_start',true
        )
      ),updated_at=now()
  where id=v_session.id and user_id=p_user_id;

  if v_active.id is not null then
    update public.user_training_plan_items
    set status=case when week_start<v_week then 'skipped' else 'available' end,
        session_id=null,claimed_at=null,updated_at=now(),
        planning_context_json=coalesce(planning_context_json,'{}'::jsonb)||jsonb_build_object(
          'daily_refresh_released_session_id',v_session.id,'daily_refresh_released_at',now()
        )
    where id=v_active.id;
  end if;

  v_base:=public.d_resolve_session_context(
    p_user_id,v_anchor,p_duration_minutes,p_readiness,
    p_focus_override,p_target_region_override,p_progression_intent_override
  );

  return v_base||jsonb_build_object(
    'recalculation',jsonb_build_object(
      'parent_session_id',v_session.id,
      'root_session_id',v_root,
      'count',v_count,
      'limit',3,
      'safety_only',false,
      'forced_after_start',true,
      'changed_fields','[]'::jsonb
    )
  );
end;
$function$;