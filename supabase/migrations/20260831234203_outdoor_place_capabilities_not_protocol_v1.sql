-- OUT-008 — Outdoor place describes capabilities/constraints, never the training protocol.

insert into public.outdoor_place_catalog_v1(
  place_code,label_fr,description_fr,derived_surface_code,locomotion_hint,
  distance_measurement_hint,floor_work_hint,impact_hint,active,sort_order,constraints_json
) values
  ('CITY_URBAN','Ville / urbain','Contexte urbain large. Le terrain réel reste à préciser seulement si cela change la faisabilité.',null,'SPACE_CONTEXTUAL','CONTEXTUAL','CONTEXTUAL','NORMAL',true,10,'{"weak_modifier":true,"equipment_inferred":false,"surface_ambiguous":true,"protocol_selection_authority":false}'::jsonb),
  ('PARK','Parc','Parc ou espace vert. Le type de sol n’est pas supposé : herbe, chemin ou sol dur peuvent coexister.',null,'OPEN_SPACE_POSSIBLE','CONTEXTUAL','CONTEXTUAL','NORMAL',true,20,'{"weak_modifier":true,"equipment_inferred":false,"surface_ambiguous":true,"protocol_selection_authority":false}'::jsonb),
  ('ATHLETICS_TRACK','Piste d’athlétisme','Piste mesurable. La mesure peut faciliter une exécution précise si le Coach a déjà choisi un protocole qui en bénéficie.','TRACK','MEASURABLE_LOOP','GOOD','CONTEXTUAL','NORMAL',true,30,'{"weak_modifier":true,"equipment_inferred":false,"protocol_selection_authority":false}'::jsonb),
  ('GRASS_FIELD','Pelouse / terrain en herbe','Zone principalement en herbe ou gazon.','GRASS','OPEN_SPACE_POSSIBLE','CONTEXTUAL','GOOD','SOFT_SURFACE',true,40,'{"weak_modifier":true,"equipment_inferred":false,"protocol_selection_authority":false}'::jsonb),
  ('FOREST_PATH','Forêt / sentier','Forêt ou sentier. Le terrain peut être régulier ou irrégulier ; préciser le sol seulement si nécessaire.',null,'PATH_OR_UNEVEN_TERRAIN','CONTEXTUAL','CONTEXTUAL','UNEVEN',true,50,'{"weak_modifier":true,"equipment_inferred":false,"surface_ambiguous":true,"protocol_selection_authority":false}'::jsonb),
  ('MOUNTAIN','Montagne / terrain vallonné','Terrain extérieur avec dénivelé potentiel. Le dénivelé est une capacité de terrain, pas une prescription sportive.',null,'ELEVATION_AVAILABLE','CONTEXTUAL','CONTEXTUAL','UNEVEN',true,60,'{"weak_modifier":true,"equipment_inferred":false,"surface_ambiguous":true,"elevation_possible":true,"protocol_selection_authority":false}'::jsonb),
  ('BEACH','Plage','Plage, généralement sableuse. Une surface explicitement indiquée reste prioritaire.','SAND','OPEN_SPACE_POSSIBLE','CONTEXTUAL','GOOD','SAND',true,70,'{"weak_modifier":true,"equipment_inferred":false,"protocol_selection_authority":false}'::jsonb),
  ('STREET_WORKOUT','Street workout','Zone extérieure orientée gym. Aucun agrès n’est présumé disponible sans déclaration explicite du matériel.',null,'GYM_SPACE_POSSIBLE','CONTEXTUAL','CONTEXTUAL','NORMAL',true,80,'{"weak_modifier":true,"equipment_inferred":false,"surface_ambiguous":true,"street_equipment_must_be_explicit":true,"protocol_selection_authority":false}'::jsonb),
  ('OTHER','Autre','Contexte extérieur non classé. Le Coach conserve le besoin sportif comme autorité principale.',null,'NEUTRAL','UNKNOWN','CONTEXTUAL','NORMAL',true,90,'{"weak_modifier":true,"equipment_inferred":false,"surface_ambiguous":true,"protocol_selection_authority":false}'::jsonb)
on conflict (place_code) do update set
  label_fr=excluded.label_fr,
  description_fr=excluded.description_fr,
  derived_surface_code=excluded.derived_surface_code,
  locomotion_hint=excluded.locomotion_hint,
  distance_measurement_hint=excluded.distance_measurement_hint,
  floor_work_hint=excluded.floor_work_hint,
  impact_hint=excluded.impact_hint,
  active=excluded.active,
  sort_order=excluded.sort_order,
  constraints_json=excluded.constraints_json;

update public.outdoor_place_catalog_v1
set active=false
where place_code in ('PARK_GRASS_STADIUM','TRAIL_PATH','BEACH_SAND','URBAN_HARD');

create or replace function public.normalize_outdoor_place_v1(p_value text)
returns text
language plpgsql
immutable
set search_path to 'public'
as $function$
declare v text:=upper(trim(coalesce(p_value,'')));
begin
  v:=translate(v,'ÀÂÄÁÃÅÇÉÈÊËÎÏÍÔÖÓÕÙÛÜÚŸ','AAAAAACEEEEIIIOOOOUUUUY');
  if v='' or v in ('UNKNOWN','INCONNU') then return null; end if;
  if v in ('CITY_URBAN','VILLE','URBAIN','URBAN_HARD','BITUME','ROUTE','URBAIN / BITUME') then return 'CITY_URBAN'; end if;
  if v in ('PARK','PARC','PARK_GRASS_STADIUM','PARC / PELOUSE / STADE','STADE') then return 'PARK'; end if;
  if v in ('ATHLETICS_TRACK','PISTE','PISTE ATHLETISME','PISTE D ATHLETISME') then return 'ATHLETICS_TRACK'; end if;
  if v in ('GRASS_FIELD','PELOUSE','GAZON','HERBE','TERRAIN EN HERBE') then return 'GRASS_FIELD'; end if;
  if v in ('FOREST_PATH','TRAIL_PATH','TRAIL','CHEMIN','SENTIER','FORET','FORÊT','FORET / SENTIER') then return 'FOREST_PATH'; end if;
  if v in ('MOUNTAIN','MONTAGNE','TERRAIN VALLONNE','TERRAIN VALLONNÉ') then return 'MOUNTAIN'; end if;
  if v in ('BEACH','BEACH_SAND','PLAGE','SABLE','PLAGE / SABLE') then return 'BEACH'; end if;
  if v in ('STREET_WORKOUT','STREET','STREET WORKOUT') then return 'STREET_WORKOUT'; end if;
  if v in ('OTHER','AUTRE') then return 'OTHER'; end if;
  raise exception 'Unsupported outdoor place: %',p_value using errcode='22023';
end;
$function$;

create or replace function public.outdoor_place_context_v1(p_place_code text, p_surface_code text default null::text)
returns jsonb
language plpgsql
stable
set search_path to 'public'
as $function$
declare
  v_place text:=public.normalize_outdoor_place_v1(p_place_code);
  v_surface text:=public.normalize_session_surface_v1(p_surface_code);
  r public.outdoor_place_catalog_v1%rowtype;
  v_effective_surface text;
  v_surface_source text;
begin
  if v_place is not null then
    select * into r from public.outdoor_place_catalog_v1 where place_code=v_place and active;
  end if;
  if v_surface is not null and v_surface<>'UNKNOWN' then
    v_effective_surface:=v_surface;
    v_surface_source:='EXPLICIT_SURFACE';
  elsif r.place_code is not null and r.derived_surface_code is not null then
    v_effective_surface:=r.derived_surface_code;
    v_surface_source:='DERIVED_WHEN_PLACE_IS_UNAMBIGUOUS';
  else
    v_effective_surface:=null;
    v_surface_source:='UNKNOWN_OR_AMBIGUOUS';
  end if;
  return jsonb_build_object(
    'version','outdoor-place-context-v2-capabilities',
    'place_code',v_place,
    'place_label_fr',r.label_fr,
    'effective_surface_code',v_effective_surface,
    'surface_source',v_surface_source,
    'surface_clarification_required',v_effective_surface is null,
    'locomotion_hint',r.locomotion_hint,
    'distance_measurement_hint',r.distance_measurement_hint,
    'floor_work_hint',r.floor_work_hint,
    'impact_hint',r.impact_hint,
    'constraints',coalesce(r.constraints_json,'{}'::jsonb),
    'weak_modifier',true,
    'equipment_inferred',false,
    'place_used_for_protocol_selection',false,
    'authority_order',jsonb_build_array('PROGRAM_HISTORY_RECOVERY','SESSION_NEED','EXPLICIT_EQUIPMENT','OUTDOOR_PLACE_FEASIBILITY')
  );
end;
$function$;

create or replace function public.outdoor_conditioning_family_decision_v1(
  p_place_code text,
  p_surface_code text,
  p_challenge_level text,
  p_reliable_distance boolean default false,
  p_running_allowed boolean default true,
  p_calibration_opportunity boolean default false
)
returns jsonb
language plpgsql
stable
set search_path to 'public'
as $function$
declare
  v_ctx jsonb:=public.outdoor_place_context_v1(p_place_code,p_surface_code);
  v_level text:=upper(coalesce(nullif(trim(p_challenge_level),''),'NORMAL'));
  v_family text;
  v_reason text;
  v_family_level text:=v_level;
  v_family_cap text:=null;
begin
  if not coalesce(p_running_allowed,true) then
    return jsonb_build_object(
      'version','outdoor-conditioning-family-v1.2-no-place-protocol-selection',
      'status','RUNNING_NOT_SELECTED','family_code',null,
      'reason','EXPLICIT_RUNNING_UNAVAILABLE_OR_NOT_WANTED',
      'place_context',v_ctx,'place_is_weak_modifier',true,
      'place_used_for_family_selection',false,'new_sport_threshold_created',false
    );
  end if;
  if coalesce(p_calibration_opportunity,false) and coalesce(p_reliable_distance,false) then
    v_family:='CALIBRATION_TEST';
    v_reason:='EXPLICIT_CALIBRATION_OPPORTUNITY_WITH_RELIABLE_MEASURE';
    v_family_level:=case when v_level in ('HARD','REDLINE') then 'SOUTENU' else v_level end;
    v_family_cap:='SOUTENU';
  elsif v_level in ('HARD','REDLINE') then
    v_family:='SHORT_INTERVALS';
    v_reason:='CHALLENGE_PREFERS_INTERVAL_STRUCTURE';
  elsif v_level='SOUTENU' then
    v_family:='MEDIUM_INTERVALS';
    v_reason:='CHALLENGE_PREFERS_STRUCTURED_CONDITIONING';
  else
    v_family:='EASY_CONTINUOUS';
    v_reason:='NORMAL_CHALLENGE_SIMPLE_CONDITIONING';
  end if;
  return jsonb_build_object(
    'version','outdoor-conditioning-family-v1.2-no-place-protocol-selection',
    'status','FAMILY_SELECTED','family_code',v_family,'reason',v_reason,
    'session_challenge_level',v_level,
    'running_family_challenge_level',v_family_level,
    'running_family_challenge_cap',v_family_cap,
    'session_challenge_preserved',true,
    'reliable_distance',coalesce(p_reliable_distance,false),
    'place_context',v_ctx,
    'family',(select to_jsonb(f) from public.outdoor_conditioning_family_catalog_v1 f where f.family_code=v_family),
    'place_is_weak_modifier',true,
    'place_used_for_family_selection',false,
    'equipment_inferred_from_place',false,
    'new_sport_threshold_created',false
  );
end;
$function$;

create or replace function public.generate_environment_session_v3(
  p_user_id uuid,
  p_environment_code text,
  p_surface_code text default null::text,
  p_requested_format_code text default null::text,
  p_execution_style text default null::text,
  p_user_focus text default 'General Fitness'::text,
  p_duration_minutes integer default 45,
  p_readiness text default 'normal'::text,
  p_target_region text default null::text,
  p_progression_intent text default null::text,
  p_zone_terms text[] default '{}'::text[],
  p_inventory jsonb default '[]'::jsonb,
  p_available_equipment text[] default '{}'::text[],
  p_outdoor_place_code text default null::text,
  p_reliable_distance boolean default false,
  p_running_allowed boolean default true,
  p_calibration_opportunity boolean default false,
  p_max_complexity integer default 3,
  p_max_difficulty text default 'Intermédiaire'::text,
  p_candidate_count integer default 20,
  p_policy_key text default 'c4-final-default'::text,
  p_start_now boolean default false,
  p_anchor_date date default current_date
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
set statement_timeout to '60s'
as $function$
declare
  v_anchor date := coalesce(p_anchor_date,current_date);
  v_environment text := public.normalize_session_environment_v1(p_environment_code);
  v_policy jsonb;
  v_selected_format text;
  v_style text := upper(coalesce(nullif(trim(p_execution_style),''),'CLASSIC_SETS'));
  v_existing public.workout_sessions%rowtype;
  v_existing_format text;
  v_existing_style text;
  v_existing_place text;
  v_requested_place text;
  v_same_context boolean := false;
  v_old_equipment text[] := '{}';
  v_new_equipment text[] := '{}';
  v_old_zones text[] := '{}';
  v_new_zones text[] := '{}';
  v_result jsonb;
  v_place_context jsonb := '{}'::jsonb;
  v_effective_surface text := p_surface_code;
begin
  if p_user_id is null then raise exception 'p_user_id is required'; end if;
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;
  perform pg_advisory_xact_lock(hashtextextended('ugerod:environment-generation:'||p_user_id::text||':'||v_anchor::text,0));
  perform set_config('ugerod.session_anchor_date',v_anchor::text,true);
  if v_environment='OUTDOOR' then
    v_place_context:=public.outdoor_place_context_v1(p_outdoor_place_code,p_surface_code);
    v_effective_surface:=v_place_context->>'effective_surface_code';
  end if;
  v_policy := public.resolve_environment_session_policy_v1(
    p_user_id,v_environment,v_effective_surface,p_requested_format_code,p_duration_minutes,p_readiness,p_zone_terms,p_inventory
  );
  if v_environment in ('HOME','BOX','UNKNOWN') then
    return jsonb_build_object('status','USE_LEGACY_ADAPTIVE_GENERATOR','environment_code',v_environment,'anchor_date',v_anchor,'policy',v_policy,'session_persisted',false,'version','environment-session-generator-v3-gym-outdoor-place-capabilities');
  end if;
  if not coalesce((v_policy->>'eligible')::boolean,false) or not coalesce((v_policy->>'generation_allowed')::boolean,false) then
    return jsonb_build_object('status','ENVIRONMENT_GENERATION_NOT_READY','environment_code',v_environment,'anchor_date',v_anchor,'policy',v_policy,'place_context',case when v_environment='OUTDOOR' then v_place_context else null end,'session_persisted',false,'version','environment-session-generator-v3-gym-outdoor-place-capabilities');
  end if;
  v_selected_format := v_policy->>'selected_format_code';
  v_requested_place := case when v_environment='OUTDOOR' then v_place_context->>'place_code' else null end;
  select ws.* into v_existing
  from public.workout_sessions ws
  where ws.user_id=p_user_id and ws.status in ('generated','in_progress')
    and coalesce(ws.started_local_date,ws.generation_local_date)=v_anchor
  order by case when ws.status='in_progress' then 0 else 1 end,coalesce(ws.started_at,ws.generated_at,ws.updated_at) desc
  limit 1 for update;
  if v_existing.id is not null then
    if v_existing.status='in_progress' then
      return jsonb_build_object('status','ACTIVE_SESSION_CONFIRM_REQUIRED','session_id',v_existing.id,'existing_environment_code',v_existing.planned_environment_code,'requested_environment_code',v_environment,'existing_session_started',true,'progress_preserved',true,'new_session_created',false,'session_persisted',false,'mutated',false,'anchor_date',v_anchor,'policy',v_policy,'version','environment-session-generator-v3-gym-outdoor-place-capabilities');
    end if;
    v_existing_format := nullif(v_existing.planning_context_json->>'format_code','');
    v_existing_style := coalesce(nullif(v_existing.planning_context_json#>>'{execution_style,style_code}',''),nullif(v_existing.mechanic_json->>'execution_style',''));
    v_existing_place := case when v_existing.planned_environment_code='OUTDOOR' then nullif(v_existing.planning_context_json#>>'{place_context,place_code}','') else null end;
    v_old_equipment := public.d_normalize_text_set_v1(coalesce(v_existing.available_equipment,'{}'::text[]));
    v_new_equipment := public.d_normalize_text_set_v1(coalesce(p_available_equipment,'{}'::text[]));
    v_old_zones := public.d_normalize_text_set_v1(coalesce(v_existing.injured_zones,'{}'::text[]));
    v_new_zones := public.d_normalize_text_set_v1(coalesce(p_zone_terms,'{}'::text[]));
    v_same_context :=
      v_existing.planned_environment_code=v_environment
      and v_existing.planned_surface_code is not distinct from public.normalize_session_surface_v1(v_effective_surface)
      and coalesce(v_existing.duration_minutes,45)=coalesce(p_duration_minutes,45)
      and public.normalize_session_readiness(coalesce(v_existing.readiness,'normal'))=public.normalize_session_readiness(p_readiness)
      and v_existing.focus is not distinct from p_user_focus
      and v_existing.target_region is not distinct from p_target_region
      and upper(coalesce(v_existing.progression_intent,''))=upper(coalesce(p_progression_intent,''))
      and v_old_equipment=v_new_equipment
      and v_old_zones=v_new_zones
      and v_existing_format is not distinct from v_selected_format
      and ((v_environment='GYM' and upper(coalesce(v_existing_style,'CLASSIC_SETS'))=v_style) or (v_environment='OUTDOOR' and v_existing_place is not distinct from v_requested_place));
    if v_same_context and coalesce(v_existing.planning_context_json->>'session_source','') in ('gym_auto_generation','outdoor_auto_generation') then
      return jsonb_build_object('status','RESUME_EXISTING','session_id',v_existing.id,'session_status',v_existing.status,'environment_code',v_environment,'format_code',v_selected_format,'generated_workout',v_existing.generated_workout,'session_persisted',true,'idempotent',true,'mutated',false,'new_session_created',false,'anchor_date',v_anchor,'policy',v_policy,'version','environment-session-generator-v3-gym-outdoor-place-capabilities');
    end if;
    return jsonb_build_object('status','EXISTING_GENERATED_SESSION_CONFLICT','session_id',v_existing.id,'existing_environment_code',v_existing.planned_environment_code,'requested_environment_code',v_environment,'existing_format_code',v_existing_format,'requested_format_code',v_selected_format,'existing_session_started',false,'progress_preserved',true,'new_session_created',false,'session_persisted',false,'mutated',false,'replacement_requires_explicit_lifecycle',true,'anchor_date',v_anchor,'policy',v_policy,'version','environment-session-generator-v3-gym-outdoor-place-capabilities');
  end if;
  if v_environment='GYM' then
    v_result := public.gym_generate_session_runtime_v1(p_user_id,p_user_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,p_zone_terms,p_inventory,p_available_equipment,v_selected_format,v_style,p_max_complexity,p_max_difficulty,p_candidate_count,p_policy_key,p_start_now);
  elsif v_environment='OUTDOOR' then
    v_result := public.outdoor_generate_session_runtime_v1(p_user_id,p_duration_minutes,p_readiness,p_user_focus,coalesce(p_target_region,'Full Body'),coalesce(p_progression_intent,'MAINTAIN'),p_zone_terms,p_inventory,p_available_equipment,v_requested_place,v_effective_surface,v_selected_format,p_reliable_distance,p_running_allowed,p_calibration_opportunity,p_max_complexity,p_max_difficulty,least(coalesce(p_candidate_count,16),16),p_start_now);
  else
    return jsonb_build_object('status','ENVIRONMENT_GENERATION_NOT_READY','environment_code',v_environment,'anchor_date',v_anchor,'policy',v_policy,'session_persisted',false,'version','environment-session-generator-v3-gym-outdoor-place-capabilities');
  end if;
  return v_result || jsonb_build_object('environment_policy',v_policy,'place_context',case when v_environment='OUTDOOR' then v_place_context else null end,'anchor_date',v_anchor,'new_session_created',coalesce((v_result->>'session_persisted')::boolean,false),'environment_gateway_version','environment-session-generator-v3-gym-outdoor-place-capabilities');
end;
$function$;
