-- #48: search-only candidate IDs from the versioned bilingual catalogue; all v2 gates and ordering preserved.
CREATE FUNCTION public.get_user_session_builder_exercises_v3(p_draft_id uuid, p_module_code text, p_query text DEFAULT NULL::text, p_limit integer DEFAULT 80, p_max_complexity integer DEFAULT 3, p_max_difficulty text DEFAULT 'Intermédiaire'::text, p_training_category text DEFAULT NULL::text, p_body_region text DEFAULT NULL::text, p_include_unavailable boolean DEFAULT false, p_bilingual_match_ids text[] DEFAULT '{}'::text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_d public.user_session_drafts%rowtype;
  v_inventory jsonb;
  v_module text;
  v_category text:=upper(trim(coalesce(p_training_category,'')));
  v_region text:=upper(trim(coalesce(p_body_region,'')));
  v_q text:=lower(trim(coalesce(p_query,'')));
  v_rows jsonb;
begin
  select * into v_d from public.user_session_drafts where id=p_draft_id;
  if not found then raise exception 'Session draft not found'; end if;
  if auth.uid() is null or auth.uid()<>v_d.user_id then raise exception 'Forbidden user'; end if;
  if cardinality(coalesce(p_bilingual_match_ids,'{}'::text[])) > 1000 then raise exception 'Too many search identifiers'; end if;
  v_module:=upper(trim(coalesce(p_module_code,'')));
  if not public.user_session_builder_module_allowed_v1(v_d.environment_code,v_d.format_code,v_module) then raise exception 'Module % is not available for this draft',v_module; end if;
  v_inventory:=public.resolve_user_equipment_inventory(v_d.user_id,v_d.available_equipment,'c4-final-default');

  with base as (
    select e.*,
      public.user_session_builder_candidate_context_v1(v_d.user_id,e.id,v_module,v_d.environment_code,v_d.surface_code,v_d.injured_zones,v_inventory,v_d.readiness,p_max_complexity,p_max_difficulty) ctx,
      array_remove(array[
        case when lower(coalesce(e.exercise_type,''))='strength' or lower(coalesce(e.training_focus,'')) in ('strength','hypertrophy') or 'STRENGTH'=any(coalesce(e.usable_for,'{}'::text[])) then 'STRENGTH' end,
        case when lower(coalesce(e.exercise_type,'')) in ('conditioning','general') or lower(coalesce(e.training_focus,''))='conditioning' or 'WOD'=any(coalesce(e.usable_for,'{}'::text[])) then 'CONDITIONING' end,
        case when lower(coalesce(e.exercise_type,'')) in ('skill','gymnastique') or 'Skill'=any(coalesce(e.usable_for,'{}'::text[])) then 'SKILL' end
      ]::text[],null) training_categories,
      (select a.alias from public.external_exercise_aliases a where a.exercise_id=e.id and a.active and v_q<>'' and lower(a.alias) like '%'||v_q||'%' order by case when lower(a.alias)=v_q then 0 else 1 end,a.base_confidence desc,length(a.alias),a.alias limit 1) matched_alias,
      case
        when v_q<>'' and lower(coalesce(e.display_name,e.name))=v_q then 0
        when v_q<>'' and lower(e.name)=v_q then 0
        when v_q<>'' and exists(select 1 from public.external_exercise_aliases ax where ax.exercise_id=e.id and ax.active and lower(ax.alias)=v_q) then 0
        else 1
      end query_exact_rank
    from public.exercises e
    where coalesce(e.warmup_only,false)=false
      and (v_q='' or e.id = any(coalesce(p_bilingual_match_ids,'{}'::text[])) or lower(coalesce(e.display_name,e.name)) like '%'||v_q||'%' or lower(e.name) like '%'||v_q||'%' or exists(select 1 from public.external_exercise_aliases a where a.exercise_id=e.id and a.active and lower(a.alias) like '%'||v_q||'%'))
      and (v_region='' or v_region='ALL' or (v_region='UPPER' and upper(coalesce(e.body_region,''))='UPPER') or (v_region='LOWER' and upper(coalesce(e.body_region,''))='LOWER') or (v_region='CORE' and upper(coalesce(e.body_region,''))='CORE') or (v_region in ('FULL BODY','FULL_BODY') and upper(coalesce(e.body_region,'')) in ('FULL BODY','FULL_BODY')))
  ), filtered as (
    select b.* from base b
    where (v_category='' or v_category='ALL' or v_category=any(b.training_categories))
      and (coalesce(p_include_unavailable,false) or coalesce((b.ctx->>'selectable')::boolean,false))
  ), ranked as (
    select b.*,
      (select max(el.created_at) from public.exercise_logs el where el.user_id=v_d.user_id and el.exercise_id=b.id and el.user_execution_status<>'not_completed') last_performed_at,
      (select count(*) from public.exercise_logs el where el.user_id=v_d.user_id and el.exercise_id=b.id and el.created_at>=now()-interval '28 days' and el.user_execution_status<>'not_completed') recent_exposures_28d,
      (select count(*) from public.exercise_logs el where el.user_id=v_d.user_id and el.exercise_id=b.id and el.created_at>=now()-interval '28 days' and el.user_execution_status<>'not_completed' and el.selection_provenance='USER_SELECTED') recent_user_selected_28d,
      pref.preference_state,pref.preference_source,
      coalesce((select jsonb_agg(distinct jsonb_build_object('equipment_id',eq.id,'name',eq.name,'category',eq.category)) from public.exercise_equipment xe join public.equipment eq on eq.id=xe.equipment_id where xe.exercise_id=b.id),'[]'::jsonb) equipment
    from filtered b
    left join lateral (
      select p.preference_state,p.preference_source
      from public.user_exercise_preferences p
      where p.user_id=v_d.user_id and p.exercise_id=b.id and p.context_key in (upper(v_d.environment_code),'GLOBAL')
      order by case when p.context_key=upper(v_d.environment_code) then 0 else 1 end,p.updated_at desc limit 1
    ) pref on true
  ), limited as (
    select * from ranked
    order by query_exact_rank,
      case when v_module='STRENGTH' and 'STRENGTH'=any(coalesce(usable_for,'{}'::text[])) then 0 else 1 end,
      case when matched_alias is not null then 0 else 1 end,
      case coalesce(preference_state,'NEUTRE') when 'FAVORI' then 0 when 'SOUVENT_CHOISI' then 1 when 'NEUTRE' then 2 when 'EVITE_VOLONTAIREMENT' then 3 else 2 end,
      selection_weight desc,last_performed_at desc nulls last,id
    limit greatest(1,least(coalesce(p_limit,80),150))
  )
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'exercise_id',id,'name',coalesce(display_name,name),'matched_alias',matched_alias,'body_region',body_region,'movement_pattern',movement_pattern,
    'exercise_family',exercise_family,'exercise_type',exercise_type,'training_focus',training_focus,'training_categories',to_jsonb(training_categories),
    'difficulty',difficulty,'technical_complexity',technical_complexity,'prescription_type',prescription_type,'tracking_modes',tracking_modes,'equipment',equipment,
    'selectable',(ctx->>'selectable')::boolean,'hard_eligible',(ctx->>'hard_eligible')::boolean,'advisory_eligible',(ctx->>'advisory_eligible')::boolean,'module_eligible',(ctx->>'module_eligible')::boolean,
    'hard_reason_codes',coalesce(ctx->'module_error_codes','[]'::jsonb)||coalesce((select jsonb_agg(code) from jsonb_array_elements_text(coalesce(ctx#>'{resolver,exclusion_reason_codes}','[]'::jsonb)) code where code in ('METADATA_INCOMPLETE','PAIN_ZONE_UNKNOWN','BODY_ZONE_METADATA_MISSING','PAIN_CONFLICT','EQUIPMENT_MISSING_OR_INCOMPATIBLE','ENVIRONMENT_UNSUPPORTED','SURFACE_ENVIRONMENT_MISMATCH','SURFACE_REQUIRED_OUTDOOR')),'[]'::jsonb),
    'warning_codes',coalesce((select jsonb_agg(code) from jsonb_array_elements_text(coalesce(ctx#>'{resolver,exclusion_reason_codes}','[]'::jsonb)) code where code in ('UNSUPPORTED_USAGE','CAPABILITY_COMPLEXITY_EXCEEDED','CAPABILITY_DIFFICULTY_EXCEEDED')),'[]'::jsonb)||coalesce(ctx#>'{resolver,adaptation_reason_codes}','[]'::jsonb),
    'recent_exposures_28d',recent_exposures_28d,'recent_user_selected_28d',recent_user_selected_28d,'last_performed_at',last_performed_at,
    'preference_state',coalesce(preference_state,'NEUTRE'),'preference_source',preference_source,'preference_is_hard_gate',false
  )) order by query_exact_rank,
      case when matched_alias is not null then 0 else 1 end,
      case coalesce(preference_state,'NEUTRE') when 'FAVORI' then 0 when 'SOUVENT_CHOISI' then 1 when 'NEUTRE' then 2 when 'EVITE_VOLONTAIREMENT' then 3 else 2 end,
      selection_weight desc,last_performed_at desc nulls last,id),'[]'::jsonb)
  into v_rows from limited;

  return jsonb_build_object(
    'draft_id',p_draft_id,'module_code',v_module,'environment_code',v_d.environment_code,
    'training_category',nullif(v_category,''),'body_region',nullif(v_region,''),'include_unavailable',coalesce(p_include_unavailable,false),'results',v_rows,
    'alias_search_enabled',true,'preference_order_enabled',true,'recents_exposed',true,
    'preference_policy',jsonb_build_object('soft_order_only',true,'hard_gates_remain_authoritative',true,'no_numeric_preference_weight',true),
    'version','user-session-builder-exercise-catalog-v6-bilingual-search'
  );
end $function$;
REVOKE ALL ON FUNCTION public.get_user_session_builder_exercises_v3(uuid,text,text,integer,integer,text,text,text,boolean,text[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_user_session_builder_exercises_v3(uuid,text,text,integer,integer,text,text,text,boolean,text[]) TO authenticated;
