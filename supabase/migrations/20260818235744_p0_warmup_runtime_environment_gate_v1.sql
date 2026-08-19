-- P0-B safety/feasibility: make preparation refresh consume the same
-- session-scoped runtime environment contract already written by swap/adaptation.
-- No parallel environment model is introduced.

do $migration$
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
    and p.proname='c4_apply_preparation_quality_v3'
    and pg_get_function_identity_arguments(p.oid)='p_user_id uuid, p_plan jsonb, p_zone_terms text[], p_inventory jsonb, p_target_region text, p_max_complexity integer, p_progression_intent text';

  if v_def is null then
    raise exception 'P0-B guard: c4_apply_preparation_quality_v3 exact signature not found';
  end if;

  v_old := $old$v_selected_ids text[]:='{}'::text[];$old$;
  v_new := $new$v_selected_ids text[]:='{}'::text[];
  v_environment_blocked_ids text[]:='{}'::text[];$new$;
  if position(v_old in v_def)=0 then
    raise exception 'P0-B guard: preparation selected-id declaration changed';
  end if;
  v_def := replace(v_def,v_old,v_new);

  v_old := $old$if coalesce(r->>'status','')<>'READY' then return r; end if;$old$;
  v_new := $new$if coalesce(r->>'status','')<>'READY' then return r; end if;

  -- The swap/adaptation contract stores session-scoped unavailable requirements
  -- in runtime_environment.unavailable_requirements. Convert those requirements
  -- to exercise IDs once, then reuse the existing exclusion mechanics throughout
  -- Unlock and Warm-up selection.
  if jsonb_typeof(r#>'{runtime_environment,unavailable_requirements}')='array' then
    select coalesce(array_agg(distinct eer.exercise_id), '{}'::text[])
    into v_environment_blocked_ids
    from public.exercise_environment_requirements eer
    where eer.requirement_key in (
      select value
      from jsonb_array_elements_text(r#>'{runtime_environment,unavailable_requirements}') x(value)
    );
  end if;$new$;
  if position(v_old in v_def)=0 then
    raise exception 'P0-B guard: preparation READY guard changed';
  end if;
  v_def := replace(v_def,v_old,v_new);

  v_old := $old$v_selected_ids:='{}'::text[];$old$;
  v_new := $new$v_selected_ids:=coalesce(v_environment_blocked_ids,'{}'::text[]);$new$;
  if position(v_old in v_def)=0 then
    raise exception 'P0-B guard: preparation selected-id reset changed';
  end if;
  v_def := replace(v_def,v_old,v_new);

  -- Keep explainability aligned with the actual gates now enforced.
  v_def := replace(
    v_def,
    $old$'pain_gate',true,'equipment_gate',true$old$,
    $new$'pain_gate',true,'equipment_gate',true,'environment_gate',true$new$
  );

  execute v_def;

  select pg_get_functiondef(p.oid)
  into v_def
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname='c4_refresh_specific_warmup_session_v1'
    and pg_get_function_identity_arguments(p.oid)='p_user_id uuid, p_session_id uuid';

  if v_def is null then
    raise exception 'P0-B guard: c4_refresh_specific_warmup_session_v1 not found';
  end if;

  v_old := $old$'status','READY','stimulus',coalesce(ws.expected_stimulus_json,'{}'::jsonb)$old$;
  v_new := $new$'status','READY',
    'stimulus',coalesce(ws.expected_stimulus_json,'{}'::jsonb),
    'runtime_environment',coalesce(ws.planning_context_json->'runtime_environment','{}'::jsonb)$new$;
  if position(v_old in v_def)=0 then
    raise exception 'P0-B guard: warmup refresh plan fragment changed';
  end if;
  v_def := replace(v_def,v_old,v_new);

  execute v_def;
end;
$migration$;
