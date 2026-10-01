-- Fatigue-driven substitutions are system adaptations, not explicit user swaps.
-- Keep them out of manual swap history / preference provenance.

create or replace function public.d_adapt_started_session_fatigue_v1(
  p_user_id uuid,
  p_session_id uuid,
  p_protected_session_exercise_ids uuid[] default '{}'::uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r record;
  v_session public.workout_sessions%rowtype;
  v_preview jsonb;
  v_apply jsonb;
  v_after_exercise_id text;
  v_results jsonb := '[]'::jsonb;
  v_applied int := 0;
  v_attempted int := 0;
  v_skipped int := 0;
begin
  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'Forbidden user';
  end if;

  select *
  into v_session
  from public.workout_sessions
  where id = p_session_id
    and user_id = p_user_id
  for update;

  if not found
     or v_session.status <> 'in_progress'
     or v_session.started_at is null then
    return jsonb_build_object(
      'status','SESSION_NOT_ADAPTABLE',
      'version','fatigue-remaining-in-place-v2-system',
      'session_id',p_session_id,
      'applied_count',0,
      'preference_signal_written',false
    );
  end if;

  for r in
    select wse.id, wse.exercise_id, wse.block_key, wse.position
    from public.workout_session_exercises wse
    where wse.session_id = p_session_id
      and wse.block_key in ('skill','wod')
      and not (
        wse.id = any(coalesce(p_protected_session_exercise_ids,'{}'::uuid[]))
      )
      and coalesce(wse.user_execution_status,'pending') = 'pending'
      and coalesce(wse.status,'pending') = 'pending'
      and wse.reps_completed is null
      and wse.weight_kg is null
      and wse.duration_seconds is null
      and wse.distance_meters is null
      and wse.rpe is null
      and (
        wse.actual_attempts_json is null
        or wse.actual_attempts_json = '{}'::jsonb
        or wse.actual_attempts_json = '[]'::jsonb
      )
    order by
      case wse.block_key when 'skill' then 0 else 1 end,
      wse.position,
      wse.id
  loop
    -- Never recompile a WOD that is already running.
    if r.block_key = 'wod' and v_session.wod_started_at is not null then
      v_skipped := v_skipped + 1;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'session_exercise_id',r.id,
        'block_key',r.block_key,
        'position',r.position,
        'before_exercise_id',r.exercise_id,
        'after_exercise_id',r.exercise_id,
        'status','PROTECTED_WOD_ALREADY_STARTED'
      ));
      continue;
    end if;

    v_attempted := v_attempted + 1;
    v_preview := null;
    v_apply := null;
    v_after_exercise_id := r.exercise_id;

    begin
      if r.block_key = 'skill' then
        v_preview := public.c4_non_wod_swap_candidate_v3(
          p_user_id,
          r.id,
          'easier',
          '{}'::text[],
          null
        );

        if coalesce(v_preview->>'status','') = 'AVAILABLE' then
          v_apply := public.c4_apply_system_non_wod_substitute_v1(
            p_user_id,
            r.id,
            v_preview->'substitute',
            'STARTED_SESSION_FATIGUE_ADAPT'
          );
        end if;
      else
        v_preview := public.c4_wod_swap_candidate_v3(
          p_user_id,
          r.id,
          'easier',
          '{}'::text[],
          null
        );

        if coalesce(v_preview->>'status','') = 'AVAILABLE' then
          v_apply := public.c4_apply_wod_candidate(
            p_user_id,
            p_session_id,
            v_preview->'candidate',
            coalesce(v_preview->'quality_gate','{}'::jsonb),
            'SYSTEM_FATIGUE_ADAPT:' || r.id::text
          );
        end if;
      end if;

      select exercise_id
      into v_after_exercise_id
      from public.workout_session_exercises
      where id = r.id
        and session_id = p_session_id;

      if v_after_exercise_id is distinct from r.exercise_id then
        v_applied := v_applied + 1;

        update public.workout_session_exercises
        set solver_decision_json =
              coalesce(solver_decision_json,'{}'::jsonb)
              || jsonb_build_object(
                'started_session_fatigue_variant',
                jsonb_build_object(
                  'version','fatigue-remaining-in-place-v2-system',
                  'source','SYSTEM_ADAPTATION',
                  'preference_signal',false,
                  'adapted_at',now()
                )
              ),
            updated_at = now()
        where id = r.id;
      else
        v_skipped := v_skipped + 1;
      end if;
    exception when others then
      v_apply := jsonb_build_object(
        'status','ERROR',
        'message',sqlerrm
      );
      v_skipped := v_skipped + 1;
      v_after_exercise_id := r.exercise_id;
    end;

    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'session_exercise_id',r.id,
      'block_key',r.block_key,
      'position',r.position,
      'before_exercise_id',r.exercise_id,
      'after_exercise_id',coalesce(v_after_exercise_id,r.exercise_id),
      'status',case
        when v_after_exercise_id is distinct from r.exercise_id then 'APPLIED'
        else coalesce(v_preview->>'status',v_apply->>'status','NO_SAFE_VARIANT')
      end,
      'system_adaptation',true,
      'preference_signal_written',false
    ));
  end loop;

  update public.workout_sessions
  set planning_context_json =
        coalesce(planning_context_json,'{}'::jsonb)
        || jsonb_build_object(
          'last_fatigue_variant_adaptation',
          jsonb_build_object(
            'version','fatigue-remaining-in-place-v2-system',
            'kind','GLOBAL_FATIGUE',
            'scope','UNFINISHED_SKILL_AND_WOD_ONLY',
            'protected_session_exercise_ids',
              to_jsonb(coalesce(p_protected_session_exercise_ids,'{}'::uuid[])),
            'attempted_count',v_attempted,
            'applied_count',v_applied,
            'unchanged_count',v_skipped,
            'system_adaptation',true,
            'preference_signal_written',false,
            'adapted_at',now()
          )
        ),
      updated_at = now()
  where id = p_session_id
    and user_id = p_user_id;

  return jsonb_build_object(
    'status',case
      when v_applied > 0 then 'FATIGUE_ADAPTED'
      else 'FATIGUE_CONTEXT_UPDATED_NO_SAFE_SWAP'
    end,
    'version','fatigue-remaining-in-place-v2-system',
    'session_id',p_session_id,
    'scope','UNFINISHED_SKILL_AND_WOD_ONLY',
    'attempted_count',v_attempted,
    'applied_count',v_applied,
    'unchanged_count',v_skipped,
    'protected_count',
      coalesce(array_length(p_protected_session_exercise_ids,1),0),
    'protected_progress_preserved',true,
    'new_session_created',false,
    'system_adaptation',true,
    'preference_signal_written',false,
    'results',v_results
  );
end;
$function$;
