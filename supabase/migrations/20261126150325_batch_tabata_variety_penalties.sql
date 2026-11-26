-- Same scalar penalties, computed once for a Tabata selection.
-- Private schema, with the same owned-user authorization as the builders.
CREATE OR REPLACE FUNCTION ugerod_private.tabata_variety_penalties_v1(p_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE v_result jsonb;
BEGIN
  IF p_user_id IS NULL OR (auth.uid() IS NOT NULL AND auth.uid()<>p_user_id)
     OR (auth.uid() IS NULL AND NOT (
       coalesce(auth.role(),'')='service_role'
       OR coalesce(current_setting('role',true),'') IN ('service_role','postgres','supabase_admin')
       OR (current_setting('role',true)='none' AND session_user IN ('postgres','supabase_admin'))
     )) THEN RAISE EXCEPTION 'Forbidden user'; END IF;
  WITH completed_week AS MATERIALIZED (
    SELECT ws.id FROM public.workout_sessions ws
    WHERE ws.user_id=p_user_id AND ws.status='completed'
      AND public.session_counts_as_training_v1(ws.id)
      AND coalesce(ws.completed_at,ws.created_at)>=date_trunc('week',now())
  ), recent_completed AS MATERIALIZED (
    SELECT ws.id FROM public.workout_sessions ws
    WHERE ws.user_id=p_user_id AND ws.status='completed'
      AND public.session_counts_as_training_v1(ws.id)
    ORDER BY coalesce(ws.completed_at,ws.created_at) DESC LIMIT 6
  ), recent_presented AS MATERIALIZED (
    SELECT ws.id,row_number() OVER(ORDER BY coalesce(ws.generated_at,ws.created_at) DESC) rn
    FROM public.workout_sessions ws
    WHERE ws.user_id=p_user_id AND ws.status IN ('generated','in_progress','abandoned','completed')
      AND ws.generated_workout IS NOT NULL
      AND jsonb_array_length(coalesce(ws.generated_workout->'blocks','[]'::jsonb))>0
    ORDER BY coalesce(ws.generated_at,ws.created_at) DESC LIMIT 6
  ), week_counts AS (
    SELECT wse.exercise_id,count(*) n
    FROM completed_week cw JOIN public.workout_session_exercises wse ON wse.session_id=cw.id
    WHERE wse.block_key='tabata' GROUP BY wse.exercise_id
  ), pattern_counts AS (
    SELECT e.movement_pattern,sum(wc.n) n
    FROM week_counts wc JOIN public.exercises e ON e.id=wc.exercise_id
    GROUP BY e.movement_pattern
  ), recent_counts AS (
    SELECT wse.exercise_id,count(*) n
    FROM recent_completed rc JOIN public.workout_session_exercises wse ON wse.session_id=rc.id
    WHERE wse.block_key='tabata' GROUP BY wse.exercise_id
  ), presented_ids AS (
    SELECT wse.exercise_id,rp.rn
    FROM recent_presented rp JOIN public.workout_session_exercises wse ON wse.session_id=rp.id
    WHERE wse.block_key='tabata'
    UNION ALL
    SELECT swap.exercise_id,rp.rn
    FROM recent_presented rp JOIN public.workout_session_swap_history h ON h.session_id=rp.id
    JOIN public.workout_session_exercises wse ON wse.id=h.session_exercise_id
    CROSS JOIN LATERAL (VALUES(h.from_exercise_id),(h.to_exercise_id)) swap(exercise_id)
    WHERE wse.block_key='tabata'
  ), presented_penalties AS (
    SELECT exercise_id,max(CASE rn WHEN 1 THEN 20 WHEN 2 THEN 10 WHEN 3 THEN 6 WHEN 4 THEN 3 WHEN 5 THEN 2 ELSE 1 END) penalty
    FROM presented_ids GROUP BY exercise_id
  )
  SELECT coalesce(jsonb_object_agg(e.id,
    12*coalesce(wc.n,0)+3*coalesce(pc.n,0)+2*coalesce(rc.n,0)+coalesce(pp.penalty,0)
  ),'{}'::jsonb) INTO v_result
  FROM public.exercises e
  LEFT JOIN week_counts wc ON wc.exercise_id=e.id
  LEFT JOIN pattern_counts pc ON pc.movement_pattern=e.movement_pattern
  LEFT JOIN recent_counts rc ON rc.exercise_id=e.id
  LEFT JOIN presented_penalties pp ON pp.exercise_id=e.id;
  RETURN v_result;
END;
$function$;
REVOKE ALL ON FUNCTION ugerod_private.tabata_variety_penalties_v1(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION ugerod_private.tabata_variety_penalties_v1(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.outdoor_build_abs_tabata_v1(p_user_id uuid, p_place_code text, p_surface_code text, p_zone_terms text[] DEFAULT '{}'::text[], p_inventory jsonb DEFAULT '[]'::jsonb, p_max_complexity integer DEFAULT 3, p_max_difficulty text DEFAULT 'Intermédiaire'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  v_ctx jsonb:=public.outdoor_place_context_v1(p_place_code,p_surface_code);
  v_surface text:=v_ctx->>'effective_surface_code';
  v_has_mat boolean:=exists(select 1 from jsonb_array_elements(case when jsonb_typeof(coalesce(p_inventory,'[]'::jsonb))='array' then coalesce(p_inventory,'[]'::jsonb) else '[]'::jsonb end) x where x->>'equipment_id'='E01' and coalesce(nullif(x->>'quantity','')::int,0)>0);
  v_rolling jsonb;
  v_soft_avoid text[]:='{}'::text[];
  v_variety_penalties jsonb;
  v_first record;
  v_second record;
  v_items jsonb:='[]'::jsonb;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;
  if v_surface='ROAD' and not v_has_mat then
    return jsonb_build_object('version','outdoor-abs-tabata-v1.1','status','OMITTED','reason','HARD_SURFACE_FLOOR_WORK_AVOIDED_WITHOUT_MAT','duration_minutes',0,'place_context',v_ctx,'optional_module',true);
  end if;
  v_rolling:=public.program_coach_rolling_stimulus_state_v1(p_user_id,current_date,'{}'::jsonb);
  select coalesce(array_agg(value),'{}'::text[]) into v_soft_avoid from jsonb_array_elements_text(coalesce(v_rolling#>'{pattern_actions,soft_avoid_patterns}','[]'::jsonb));

  v_variety_penalties:=ugerod_private.tabata_variety_penalties_v1(p_user_id);

  select e.id,e.name,e.display_name,e.movement_pattern,e.exercise_family,e.tracking_modes into v_first
  from public.exercises e
  where 'Core'=any(coalesce(e.usable_for,'{}'::text[])) and e.exercise_family='Core'
    and public.exercise_environment_eligible_v1(e.id,'OUTDOOR') and public.exercise_equipment_compatible(e.id,p_inventory)
    and public.exercise_safe_for_zones(e.id,public.normalize_body_zone_ids(coalesce(p_zone_terms,'{}'::text[])))
    and coalesce(e.technical_complexity,99)<=p_max_complexity
    and (case e.difficulty when 'Débutant' then 1 when 'Intermédiaire' then 2 when 'Avancé' then 3 else 99 end)<=
        (case p_max_difficulty when 'Débutant' then 1 when 'Intermédiaire' then 2 when 'Avancé' then 3 else 0 end)
    and not (e.movement_pattern=any(v_soft_avoid))
  order by coalesce((v_variety_penalties->>e.id)::numeric,0) asc,coalesce(e.selection_weight,0) desc,e.id limit 1;
  if v_first.id is null then return jsonb_build_object('version','outdoor-abs-tabata-v1.1','status','OMITTED','reason','NO_SAFE_CORE_CANDIDATE','duration_minutes',0,'optional_module',true); end if;

  select e.id,e.name,e.display_name,e.movement_pattern,e.exercise_family,e.tracking_modes into v_second
  from public.exercises e
  where 'Core'=any(coalesce(e.usable_for,'{}'::text[])) and e.exercise_family='Core' and e.id<>v_first.id
    and e.movement_pattern is distinct from v_first.movement_pattern
    and public.exercise_environment_eligible_v1(e.id,'OUTDOOR') and public.exercise_equipment_compatible(e.id,p_inventory)
    and public.exercise_safe_for_zones(e.id,public.normalize_body_zone_ids(coalesce(p_zone_terms,'{}'::text[])))
    and coalesce(e.technical_complexity,99)<=p_max_complexity
    and (case e.difficulty when 'Débutant' then 1 when 'Intermédiaire' then 2 when 'Avancé' then 3 else 99 end)<=
        (case p_max_difficulty when 'Débutant' then 1 when 'Intermédiaire' then 2 when 'Avancé' then 3 else 0 end)
    and not (e.movement_pattern=any(v_soft_avoid))
  order by coalesce((v_variety_penalties->>e.id)::numeric,0) asc,coalesce(e.selection_weight,0) desc,e.id limit 1;

  v_items:=jsonb_build_array(jsonb_build_object('exercise_id',v_first.id,'name',coalesce(v_first.display_name,v_first.name),'pattern',v_first.movement_pattern,'tracking_modes',to_jsonb(v_first.tracking_modes),'prescription',public.c2_solver_prescription(p_user_id,v_first.id,public.c2_exercise_stimulus_proxy(v_first.id),'TABATA','MAINTAIN',p_inventory)||jsonb_build_object('protocol',jsonb_build_object('rounds',8,'work_seconds',20,'rest_seconds',10,'rotation','alternate_exercises'),'block_role','tabata_abs')));
  if v_second.id is not null then
    v_items:=v_items||jsonb_build_array(jsonb_build_object('exercise_id',v_second.id,'name',coalesce(v_second.display_name,v_second.name),'pattern',v_second.movement_pattern,'tracking_modes',to_jsonb(v_second.tracking_modes),'prescription',public.c2_solver_prescription(p_user_id,v_second.id,public.c2_exercise_stimulus_proxy(v_second.id),'TABATA','MAINTAIN',p_inventory)||jsonb_build_object('protocol',jsonb_build_object('rounds',8,'work_seconds',20,'rest_seconds',10,'rotation','alternate_exercises'),'block_role','tabata_abs')));
  end if;
  return jsonb_build_object('version','outdoor-abs-tabata-v1.1','status','READY','block_key','tabata_abs','block_name','Core / abdos','required',false,'duration_minutes',4,'structure','8 rounds — 20s travail / 10s repos','exercises',v_items,'optional_module',true,'explicit_selection_required_v1',true,'existing_tabata_protocol_reused',true,'rolling_soft_avoid_patterns',to_jsonb(v_soft_avoid),'place_context',v_ctx);
end; $function$;

CREATE OR REPLACE FUNCTION public.ugerod_build_signature_tabata_excluding_v1(p_user_id uuid, p_environment_code text, p_zone_terms text[] DEFAULT '{}'::text[], p_inventory jsonb DEFAULT '[]'::jsonb, p_max_complexity integer DEFAULT 3, p_max_difficulty text DEFAULT 'Intermédiaire'::text, p_surface_code text DEFAULT NULL::text, p_excluded_ids text[] DEFAULT '{}'::text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  v_env text:=public.normalize_session_environment_v1(p_environment_code);
  v_surface text:=public.normalize_session_surface_v1(p_surface_code);
  v_has_mat boolean:=exists(
    select 1
    from jsonb_array_elements(
      case when jsonb_typeof(coalesce(p_inventory,'[]'::jsonb))='array'
        then coalesce(p_inventory,'[]'::jsonb)
        else '[]'::jsonb
      end
    ) x
    where x->>'equipment_id'='E01'
      and coalesce(nullif(x->>'quantity','')::numeric,1)>0
  );
  v_variety_penalties jsonb;
  v_first record;
  v_second record;
  v_items jsonb:='[]'::jsonb;
  v_limit_to_standing boolean:=false;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then
    raise exception 'Forbidden user';
  end if;

  v_limit_to_standing := v_env='OUTDOOR' and v_surface='ROAD' and not v_has_mat;

  v_variety_penalties:=ugerod_private.tabata_variety_penalties_v1(p_user_id);

  select
    e.id,e.name,e.display_name,e.movement_pattern,e.exercise_family,e.tracking_modes
  into v_first
  from public.exercises e
  where
    (
      'Core'=any(coalesce(e.usable_for,'{}'::text[]))
      or e.id='EX418'
    )
    and not (e.id=any(public.exercise_expand_functional_exclusions_v1(coalesce(p_excluded_ids,'{}'::text[]))))
    and public.exercise_environment_eligible_v1(e.id,v_env)
    and public.exercise_equipment_compatible(e.id,p_inventory)
    and public.exercise_safe_for_zones(
      e.id,public.normalize_body_zone_ids(coalesce(p_zone_terms,'{}'::text[]))
    )
    and coalesce(e.technical_complexity,99)<=p_max_complexity
    and (
      case e.difficulty when 'Débutant' then 1 when 'Intermédiaire' then 2 when 'Avancé' then 3 else 99 end
    ) <= (
      case p_max_difficulty when 'Débutant' then 1 when 'Intermédiaire' then 2 when 'Avancé' then 3 else 0 end
    )
    and (
      not v_limit_to_standing
      or e.id='EX418'
      or lower(e.name) like '%standing%'
    )
  order by
    coalesce((v_variety_penalties->>e.id)::numeric,0) asc,
    case when e.exercise_family='Core' then 0 else 1 end,
    coalesce(e.selection_weight,0) desc,
    e.id
  limit 1;

  if v_first.id is null then
    return jsonb_build_object(
      'version','ugerod-signature-tabata-v1',
      'status','OMITTED_SAFETY_OR_FEASIBILITY',
      'reason_code','NO_SAFE_SIGNATURE_CORE_CANDIDATE',
      'required_by_product',true,
      'safety_overrides_signature',true,
      'duration_minutes',0
    );
  end if;

  select
    e.id,e.name,e.display_name,e.movement_pattern,e.exercise_family,e.tracking_modes
  into v_second
  from public.exercises e
  where
    (
      'Core'=any(coalesce(e.usable_for,'{}'::text[]))
      or e.id='EX418'
    )
    and e.id<>v_first.id
    and e.movement_pattern is distinct from v_first.movement_pattern
    and not (e.id=any(public.exercise_expand_functional_exclusions_v1(coalesce(p_excluded_ids,'{}'::text[]))))
    and public.exercise_environment_eligible_v1(e.id,v_env)
    and public.exercise_equipment_compatible(e.id,p_inventory)
    and public.exercise_safe_for_zones(
      e.id,public.normalize_body_zone_ids(coalesce(p_zone_terms,'{}'::text[]))
    )
    and coalesce(e.technical_complexity,99)<=p_max_complexity
    and (
      case e.difficulty when 'Débutant' then 1 when 'Intermédiaire' then 2 when 'Avancé' then 3 else 99 end
    ) <= (
      case p_max_difficulty when 'Débutant' then 1 when 'Intermédiaire' then 2 when 'Avancé' then 3 else 0 end
    )
    and (
      not v_limit_to_standing
      or e.id='EX418'
      or lower(e.name) like '%standing%'
    )
  order by
    coalesce((v_variety_penalties->>e.id)::numeric,0) asc,
    case when e.exercise_family='Core' then 0 else 1 end,
    coalesce(e.selection_weight,0) desc,
    e.id
  limit 1;

  v_items:=jsonb_build_array(
    jsonb_build_object(
      'exercise_id',v_first.id,
      'name',coalesce(v_first.display_name,v_first.name),
      'pattern',v_first.movement_pattern,
      'tracking_modes',to_jsonb(v_first.tracking_modes),
      'prescription',
        public.c2_solver_prescription(
          p_user_id,v_first.id,public.c2_exercise_stimulus_proxy(v_first.id),
          'TABATA','MAINTAIN',p_inventory
        )
        || jsonb_build_object(
          'protocol',jsonb_build_object(
            'rounds',8,'work_seconds',20,'rest_seconds',10,
            'rotation','alternate_exercises'
          ),
          'block_role','tabata_abs'
        )
    )
  );

  if v_second.id is not null then
    v_items:=v_items||jsonb_build_array(
      jsonb_build_object(
        'exercise_id',v_second.id,
        'name',coalesce(v_second.display_name,v_second.name),
        'pattern',v_second.movement_pattern,
        'tracking_modes',to_jsonb(v_second.tracking_modes),
        'prescription',
          public.c2_solver_prescription(
            p_user_id,v_second.id,public.c2_exercise_stimulus_proxy(v_second.id),
            'TABATA','MAINTAIN',p_inventory
          )
          || jsonb_build_object(
            'protocol',jsonb_build_object(
              'rounds',8,'work_seconds',20,'rest_seconds',10,
              'rotation','alternate_exercises'
            ),
            'block_role','tabata_abs'
          )
      )
    );
  end if;

  return jsonb_build_object(
    'version','ugerod-signature-tabata-v1',
    'status','READY',
    'block_key','tabata',
    'module_code','TABATA',
    'block_name','Core Tabata',
    'label_fr','Core Tabata',
    'required',true,
    'signature_module',true,
    'duration_minutes',4,
    'settings',jsonb_build_object('rounds',8,'work_seconds',20,'rest_seconds',10),
    'structure','8 rounds · 20s / 10s',
    'exercises',v_items,
    'product_rule','UGEROD_SIGNATURE_CORE_TABATA',
    'safety_remains_authoritative',true
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.ugerod_build_signature_tabata_v1(p_user_id uuid, p_environment_code text, p_zone_terms text[] DEFAULT '{}'::text[], p_inventory jsonb DEFAULT '[]'::jsonb, p_max_complexity integer DEFAULT 3, p_max_difficulty text DEFAULT 'Intermédiaire'::text, p_surface_code text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  v_env text:=public.normalize_session_environment_v1(p_environment_code);
  v_surface text:=public.normalize_session_surface_v1(p_surface_code);
  v_has_mat boolean:=exists(
    select 1
    from jsonb_array_elements(
      case when jsonb_typeof(coalesce(p_inventory,'[]'::jsonb))='array'
        then coalesce(p_inventory,'[]'::jsonb)
        else '[]'::jsonb
      end
    ) x
    where x->>'equipment_id'='E01'
      and coalesce(nullif(x->>'quantity','')::numeric,1)>0
  );
  v_variety_penalties jsonb;
  v_first record;
  v_second record;
  v_items jsonb:='[]'::jsonb;
  v_limit_to_standing boolean:=false;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then
    raise exception 'Forbidden user';
  end if;

  v_limit_to_standing := v_env='OUTDOOR' and v_surface='ROAD' and not v_has_mat;

  v_variety_penalties:=ugerod_private.tabata_variety_penalties_v1(p_user_id);

  select
    e.id,e.name,e.display_name,e.movement_pattern,e.exercise_family,e.tracking_modes
  into v_first
  from public.exercises e
  where
    (
      'Core'=any(coalesce(e.usable_for,'{}'::text[]))
      or e.id='EX418'
    )
    and public.exercise_environment_eligible_v1(e.id,v_env)
    and public.exercise_equipment_compatible(e.id,p_inventory)
    and public.exercise_safe_for_zones(
      e.id,public.normalize_body_zone_ids(coalesce(p_zone_terms,'{}'::text[]))
    )
    and coalesce(e.technical_complexity,99)<=p_max_complexity
    and (
      case e.difficulty when 'Débutant' then 1 when 'Intermédiaire' then 2 when 'Avancé' then 3 else 99 end
    ) <= (
      case p_max_difficulty when 'Débutant' then 1 when 'Intermédiaire' then 2 when 'Avancé' then 3 else 0 end
    )
    and (
      not v_limit_to_standing
      or e.id='EX418'
      or lower(e.name) like '%standing%'
    )
  order by
    coalesce((v_variety_penalties->>e.id)::numeric,0) asc,
    case when e.exercise_family='Core' then 0 else 1 end,
    coalesce(e.selection_weight,0) desc,
    e.id
  limit 1;

  if v_first.id is null then
    return jsonb_build_object(
      'version','ugerod-signature-tabata-v1',
      'status','OMITTED_SAFETY_OR_FEASIBILITY',
      'reason_code','NO_SAFE_SIGNATURE_CORE_CANDIDATE',
      'required_by_product',true,
      'safety_overrides_signature',true,
      'duration_minutes',0
    );
  end if;

  select
    e.id,e.name,e.display_name,e.movement_pattern,e.exercise_family,e.tracking_modes
  into v_second
  from public.exercises e
  where
    (
      'Core'=any(coalesce(e.usable_for,'{}'::text[]))
      or e.id='EX418'
    )
    and e.id<>v_first.id
    and e.movement_pattern is distinct from v_first.movement_pattern
    and public.exercise_environment_eligible_v1(e.id,v_env)
    and public.exercise_equipment_compatible(e.id,p_inventory)
    and public.exercise_safe_for_zones(
      e.id,public.normalize_body_zone_ids(coalesce(p_zone_terms,'{}'::text[]))
    )
    and coalesce(e.technical_complexity,99)<=p_max_complexity
    and (
      case e.difficulty when 'Débutant' then 1 when 'Intermédiaire' then 2 when 'Avancé' then 3 else 99 end
    ) <= (
      case p_max_difficulty when 'Débutant' then 1 when 'Intermédiaire' then 2 when 'Avancé' then 3 else 0 end
    )
    and (
      not v_limit_to_standing
      or e.id='EX418'
      or lower(e.name) like '%standing%'
    )
  order by
    coalesce((v_variety_penalties->>e.id)::numeric,0) asc,
    case when e.exercise_family='Core' then 0 else 1 end,
    coalesce(e.selection_weight,0) desc,
    e.id
  limit 1;

  v_items:=jsonb_build_array(
    jsonb_build_object(
      'exercise_id',v_first.id,
      'name',coalesce(v_first.display_name,v_first.name),
      'pattern',v_first.movement_pattern,
      'tracking_modes',to_jsonb(v_first.tracking_modes),
      'prescription',
        public.c2_solver_prescription(
          p_user_id,v_first.id,public.c2_exercise_stimulus_proxy(v_first.id),
          'TABATA','MAINTAIN',p_inventory
        )
        || jsonb_build_object(
          'protocol',jsonb_build_object(
            'rounds',8,'work_seconds',20,'rest_seconds',10,
            'rotation','alternate_exercises'
          ),
          'block_role','tabata_abs'
        )
    )
  );

  if v_second.id is not null then
    v_items:=v_items||jsonb_build_array(
      jsonb_build_object(
        'exercise_id',v_second.id,
        'name',coalesce(v_second.display_name,v_second.name),
        'pattern',v_second.movement_pattern,
        'tracking_modes',to_jsonb(v_second.tracking_modes),
        'prescription',
          public.c2_solver_prescription(
            p_user_id,v_second.id,public.c2_exercise_stimulus_proxy(v_second.id),
            'TABATA','MAINTAIN',p_inventory
          )
          || jsonb_build_object(
            'protocol',jsonb_build_object(
              'rounds',8,'work_seconds',20,'rest_seconds',10,
              'rotation','alternate_exercises'
            ),
            'block_role','tabata_abs'
          )
      )
    );
  end if;

  return jsonb_build_object(
    'version','ugerod-signature-tabata-v1',
    'status','READY',
    'block_key','tabata',
    'module_code','TABATA',
    'block_name','Core Tabata',
    'label_fr','Core Tabata',
    'required',true,
    'signature_module',true,
    'duration_minutes',4,
    'settings',jsonb_build_object('rounds',8,'work_seconds',20,'rest_seconds',10),
    'structure','8 rounds · 20s / 10s',
    'exercises',v_items,
    'product_rule','UGEROD_SIGNATURE_CORE_TABATA',
    'safety_remains_authoritative',true
  );
end;
$function$;
