create or replace function public.solve_session_engine_c4(
  p_user_id uuid,
  p_focus text,
  p_duration_minutes integer,
  p_readiness text,
  p_target_region text default null::text,
  p_progression_intent text default null::text,
  p_zone_terms text[] default '{}'::text[],
  p_inventory jsonb default '[]'::jsonb,
  p_max_complexity integer default 3,
  p_max_difficulty text default 'Intermédiaire'::text,
  p_candidate_count integer default 10,
  p_exact_wod_minutes integer default null::integer,
  p_policy_key text default 'c4-final-default'::text
) returns jsonb
language plpgsql
stable
set search_path to 'public'
as $function$
declare
  v_first jsonb;
  v_retry jsonb;
  v_requested int:=greatest(1,least(coalesce(p_candidate_count,10),20));
begin
  v_first:=public.solve_session_engine_c4_raw_v15(
    p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
    p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty,v_requested,
    p_exact_wod_minutes,p_policy_key
  );

  if coalesce(v_first->>'status','')='READY' or v_requested>=20 then
    return jsonb_set(
      v_first || jsonb_build_object('search_fallback_used',false,'initial_candidate_count',v_requested,'final_candidate_count',v_requested),
      '{version}','"c4-final-v1.6"'::jsonb,true
    );
  end if;

  v_retry:=public.solve_session_engine_c4_raw_v15(
    p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
    p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty,20,
    p_exact_wod_minutes,p_policy_key
  );

  return jsonb_set(
    v_retry || jsonb_build_object(
      'search_fallback_used',true,
      'initial_status',v_first->>'status',
      'initial_candidate_count',v_requested,
      'final_candidate_count',20
    ),
    '{version}','"c4-final-v1.6"'::jsonb,true
  );
end;
$function$;

revoke all on function public.solve_session_engine_c4(uuid,text,integer,text,text,text,text[],jsonb,integer,text,integer,integer,text) from public, anon, authenticated;
grant execute on function public.solve_session_engine_c4(uuid,text,integer,text,text,text,text[],jsonb,integer,text,integer,integer,text) to service_role;;
