-- ENV-007: HOME/BOX use the legacy adaptive engine, but must inject the selected
-- environment into the same transaction so environment hard gates can act.
create or replace function public.d_generate_adaptive_session_v3(
  p_user_id uuid,
  p_focus_override text,
  p_duration_minutes integer,
  p_readiness text,
  p_target_region_override text default null::text,
  p_progression_intent_override text default null::text,
  p_zone_terms text[] default '{}'::text[],
  p_inventory jsonb default '[]'::jsonb,
  p_available_equipment text[] default '{}'::text[],
  p_max_complexity integer default 3,
  p_max_difficulty text default 'Intermédiaire'::text,
  p_candidate_count integer default 12,
  p_policy_key text default 'c4-final-default'::text,
  p_anchor_date date default current_date,
  p_force_recalculate_started boolean default false,
  p_protected_session_exercise_ids uuid[] default '{}'::uuid[],
  p_environment_code text default null::text
)
returns jsonb
language plpgsql
security definer
set search_path to public, pg_temp
as $function$
declare
  v_env text;
  v_result jsonb;
  v_session_id uuid;
begin
  if p_user_id is null then raise exception 'p_user_id is required'; end if;
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;

  v_env := public.normalize_session_environment_v1(p_environment_code);
  if v_env not in ('HOME','BOX') then
    raise exception 'd_generate_adaptive_session_v3 only accepts HOME or BOX';
  end if;

  perform pg_catalog.set_config('ugerod.session_environment',v_env,true);
  perform pg_catalog.set_config('ugerod.session_surface','',true);

  v_result := public.d_generate_adaptive_session_v2(
    p_user_id=>p_user_id,
    p_focus_override=>p_focus_override,
    p_duration_minutes=>p_duration_minutes,
    p_readiness=>p_readiness,
    p_target_region_override=>p_target_region_override,
    p_progression_intent_override=>p_progression_intent_override,
    p_zone_terms=>p_zone_terms,
    p_inventory=>p_inventory,
    p_available_equipment=>p_available_equipment,
    p_max_complexity=>p_max_complexity,
    p_max_difficulty=>p_max_difficulty,
    p_candidate_count=>p_candidate_count,
    p_policy_key=>p_policy_key,
    p_anchor_date=>p_anchor_date,
    p_force_recalculate_started=>p_force_recalculate_started,
    p_protected_session_exercise_ids=>p_protected_session_exercise_ids
  );

  v_session_id := nullif(v_result->>'session_id','')::uuid;
  if v_session_id is not null then
    update public.workout_sessions
    set planned_environment_code=v_env,
        planned_environment_source='USER_PREPARATION',
        planned_environment_selected_at=coalesce(planned_environment_selected_at,now()),
        planning_context_json=coalesce(planning_context_json,'{}'::jsonb)
          || jsonb_build_object('environment_code',v_env,'environment_context_source','HOME_BOX_GENERATION_V3'),
        generated_workout=case
          when generated_workout is null then generated_workout
          else jsonb_set(
            generated_workout,
            '{meta}',
            coalesce(generated_workout->'meta','{}'::jsonb)
              || jsonb_build_object('environment_code',v_env,'environment_context_source','HOME_BOX_GENERATION_V3'),
            true
          )
        end,
        updated_at=now()
    where id=v_session_id and user_id=p_user_id;

    v_result := jsonb_set(v_result,'{meta}',coalesce(v_result->'meta','{}'::jsonb)
      || jsonb_build_object('environment_code',v_env,'environment_context_source','HOME_BOX_GENERATION_V3'),true)
      || jsonb_build_object('environment_code',v_env,'environment_context_persisted',true);
  end if;

  return v_result || jsonb_build_object('generation_contract','home-box-adaptive-v3-environment-context');
end;
$function$;

revoke execute on function public.d_generate_adaptive_session_v3(uuid,text,integer,text,text,text,text[],jsonb,text[],integer,text,integer,text,date,boolean,uuid[],text) from public, anon;
grant execute on function public.d_generate_adaptive_session_v3(uuid,text,integer,text,text,text,text[],jsonb,text[],integer,text,integer,text,date,boolean,uuid[],text) to authenticated;