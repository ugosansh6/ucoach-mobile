do $$
declare
  v_def text;
  v_old text;
  v_new text;
begin
  select pg_get_functiondef(p.oid)
  into v_def
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname='qa_session_001_case_v1'
    and pg_get_function_identity_arguments(p.oid)='p_user_id uuid, p_environment_code text, p_duration_minutes integer, p_focus text, p_readiness text, p_target_region text, p_progression_intent text, p_inventory jsonb, p_surface_code text, p_candidate_count integer'
  limit 1;

  if v_def is null then
    raise exception 'qa_session_001_case_v1 not found';
  end if;

  v_old := 'case upper(coalesce(p_surface_code,''GRASS''))' || chr(10) ||
           '        when ''ROAD'' then ''ROAD_ROUTE''' || chr(10) ||
           '        when ''TRAIL'' then ''TRAIL_ROUTE''' || chr(10) ||
           '        else ''GRASS_FIELD''' || chr(10) ||
           '      end';

  v_new := 'case upper(coalesce(p_surface_code,''GRASS''))' || chr(10) ||
           '        when ''ROAD'' then ''CITY_URBAN''' || chr(10) ||
           '        when ''TRAIL'' then ''FOREST_PATH''' || chr(10) ||
           '        when ''TRACK'' then ''ATHLETICS_TRACK''' || chr(10) ||
           '        when ''SAND'' then ''BEACH''' || chr(10) ||
           '        when ''MIXED'' then ''PARK''' || chr(10) ||
           '        else ''GRASS_FIELD''' || chr(10) ||
           '      end';

  if position(v_old in v_def)=0 then
    -- Fresh replays may already contain the corrected mapping.
    return;
  end if;

  v_def := replace(v_def,v_old,v_new);
  execute v_def;
end;
$$;
