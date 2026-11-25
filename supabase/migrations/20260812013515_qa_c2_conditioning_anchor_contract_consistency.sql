create or replace function public.simulate_session_engine_c2(
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
  p_candidate_count integer default 5
) returns jsonb
language plpgsql
stable
set search_path to 'public'
as $function$
declare
  v_raw jsonb;
  v_filtered jsonb;
  v_requires_anchor boolean := p_focus in ('Conditioning','Fat Loss');
  v_status text := 'OK';
begin
  v_raw := public.simulate_session_engine_c2_raw(
    p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
    p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty,p_candidate_count
  );

  if v_requires_anchor then
    select coalesce(jsonb_agg(s order by ord),'[]'::jsonb)
    into v_filtered
    from jsonb_array_elements(coalesce(v_raw->'candidate_sessions','[]'::jsonb)) with ordinality t(s,ord)
    where coalesce((s#>>'{session_components,conditioning_anchor}')::boolean,false);
    if jsonb_array_length(v_filtered)=0 then v_status := 'NO_SAFE_COHERENT_WOD'; end if;
  else
    v_filtered := coalesce(v_raw->'candidate_sessions','[]'::jsonb);
    if jsonb_array_length(v_filtered)=0 then v_status := 'NO_SAFE_COHERENT_WOD'; end if;
  end if;

  return jsonb_set(
    jsonb_set(
      jsonb_set(v_raw,'{version}','"c2-sim-v1.3"'::jsonb,true),
      '{candidate_sessions}',v_filtered,true
    ),
    '{coherence_gate}',
    jsonb_build_object(
      'status',v_status,
      'conditioning_anchor_required',v_requires_anchor,
      'conditioning_anchor_definition','movement_pattern in Conditioning|Locomotion OR training_focus=Conditioning',
      'explicit_target_region_enforced',p_target_region in ('Upper','Lower','Core'),
      'never_force_when_no_safe_coherent_candidate',true
    ),true
  );
end;
$function$;

revoke all on function public.simulate_session_engine_c2(uuid,text,integer,text,text,text,text[],jsonb,integer,text,integer) from public,anon,authenticated;
grant execute on function public.simulate_session_engine_c2(uuid,text,integer,text,text,text,text[],jsonb,integer,text,integer) to service_role;;
