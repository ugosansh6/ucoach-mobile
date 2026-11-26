-- Bind replay identity to the submitted payload; require authenticated ownership for explicit same-day requests.
CREATE OR REPLACE FUNCTION public.week_create_assisted_plan_item_v1(p_user_id uuid, p_recommended_date date, p_context jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_week_start date;
  v_sequence integer;
  v_item_id uuid;
  v_result jsonb;
  v_existing_count integer;
  v_request text:=nullif(p_context->>'creation_request_id','');
  v_allow_same_day boolean:=coalesce(p_context->>'allow_same_day','false')='true';
  v_existing public.user_training_plan_items%rowtype;
begin
  if p_user_id is null or p_recommended_date is null then
    raise exception 'week_create_assisted_plan_item_v1 requires user and date';
  end if;
  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'Forbidden user' using errcode='42501';
  end if;
  if (v_allow_same_day or v_request is not null) and (auth.uid() is null or auth.uid()<>p_user_id) then
    raise exception 'AUTH_REQUIRED' using errcode='42501';
  end if;
  if v_allow_same_day and v_request is null then raise exception 'CREATION_REQUEST_REQUIRED';end if;
  if p_recommended_date < current_date then
    raise exception 'Cannot add a session in the past';
  end if;

  v_week_start := public.d_week_start(p_recommended_date);
  perform pg_advisory_xact_lock(
    hashtextextended('ugerod:week-edit:'||p_user_id::text||':'||v_week_start::text,0)
  );
  if v_request is not null then
    if length(v_request)>100 or v_request !~ '^[a-zA-Z0-9_-]+$' then raise exception 'INVALID_CREATION_REQUEST';end if;
    select * into v_existing from public.user_training_plan_items
      where user_id=p_user_id and week_start=v_week_start and planning_context_json#>>'{w11,creation_request_id}'=v_request limit 1;
    if found then
      if v_existing.recommended_date is distinct from p_recommended_date or v_existing.status not in ('available','claimed','completed') then raise exception 'CREATION_REQUEST_CONFLICT';end if;
      return jsonb_build_object('created',false,'plan_item_id',v_existing.id,'recommended_date',v_existing.recommended_date,'week_start',v_week_start,'sequence_index',v_existing.sequence_index,'idempotent',true);
    end if;
  end if;
  perform public.d_ensure_week_plan(p_user_id,p_recommended_date,false);

  select count(*)::integer
  into v_existing_count
  from public.user_training_plan_items
  where user_id=p_user_id
    and week_start=v_week_start
    and status in ('available','claimed','completed');

  if v_existing_count >= 5 then
    raise exception 'This week already contains five planned sessions';
  end if;

  if not v_allow_same_day and exists(
    select 1
    from public.user_training_plan_items
    where user_id=p_user_id
      and week_start=v_week_start
      and recommended_date=p_recommended_date
      and status in ('available','claimed','completed')
  ) then
    raise exception 'A session is already planned on this day';
  end if;

  select coalesce(max(sequence_index),0)+1
  into v_sequence
  from public.user_training_plan_items
  where user_id=p_user_id and week_start=v_week_start;

  insert into public.user_training_plan_items(
    user_id,
    sequence_index,
    recommended_date,
    status,
    week_start,
    planning_context_json
  ) values (
    p_user_id,
    v_sequence,
    p_recommended_date,
    'available',
    v_week_start,
    jsonb_build_object(
      'plan_version','w11-user-assisted-v1',
      'recommended_date_is_soft',true,
      'user_debt_created',false,
      'wod_pre_generated',false,
      'w11',jsonb_strip_nulls(jsonb_build_object(
        'creation_request_id',v_request,
        'provenance','USER_ASSISTED_SESSION',
        'creation_mode','ASSISTED',
        'replan_protected',true
      ))
    )
  )
  returning id into v_item_id;

  v_result := public.week_update_plan_item_context_v1(
    p_user_id,
    v_item_id,
    coalesce(p_context,'{}'::jsonb)-array['creation_request_id','allow_same_day']
  );

  return v_result || jsonb_build_object(
    'created',true,
    'sequence_index',v_sequence,
    'week_start',v_week_start,
    'week_end',v_week_start+6,
    'provenance','USER_ASSISTED_SESSION',
    'replan_protected',true,
    'max_week_sessions',5
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.week_create_composer_plan_v1(p_user_id uuid, p_date date, p_draft jsonb, p_context jsonb, p_request_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE item jsonb; saved jsonb; pid uuid; sig text:=md5(jsonb_build_object('date',p_date,'draft',p_draft,'context',p_context)::text);
BEGIN
 IF auth.uid() IS NULL OR auth.uid()<>p_user_id THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='42501';END IF;
 IF nullif(p_request_id,'') IS NULL THEN RAISE EXCEPTION 'CREATION_REQUEST_REQUIRED';END IF;
 item:=public.week_create_assisted_plan_item_v1(p_user_id,p_date,coalesce(p_context,'{}')||jsonb_build_object('allow_same_day',true,'creation_request_id',p_request_id));
 pid:=(item->>'plan_item_id')::uuid;
 IF item->>'created'='false' THEN
   IF NOT EXISTS(select 1 from public.user_training_plan_items where id=pid and user_id=p_user_id and jsonb_typeof(planning_context_json#>'{w11,composer_draft}')='object' and planning_context_json#>>'{w11,creation_payload_hash}'=sig) THEN RAISE EXCEPTION 'CREATION_REQUEST_CONFLICT';END IF;
   RETURN jsonb_build_object('status','SAVED','plan_item_id',pid,'idempotent',true);
 END IF;
 saved:=public.week_save_composer_with_model_v1(p_user_id,pid,p_draft,coalesce(p_context,'{}'),false);
 IF saved->>'status' IS DISTINCT FROM 'SAVED' THEN RAISE EXCEPTION 'COMPOSER_CREATE_FAILED';END IF;
 UPDATE public.user_training_plan_items SET planning_context_json=jsonb_set(planning_context_json,'{w11,creation_payload_hash}',to_jsonb(sig),true) WHERE id=pid AND user_id=p_user_id;
 RETURN saved||jsonb_build_object('plan_item_id',pid);
END;
$function$;

CREATE OR REPLACE FUNCTION public.week_plan_personal_program_v1(p_model_id uuid, p_date date, p_draft jsonb, p_surface text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE u uuid:=auth.uid(); m public.personal_workout_models%rowtype; preview jsonb; draft jsonb; gear text[]; gear_names text[]; ctx jsonb; item jsonb; saved jsonb; i int; row jsonb; original jsonb; duration int; sig text:=md5(jsonb_build_object('date',p_date,'model_id',p_model_id,'draft',p_draft-'creation_request_id','surface',p_surface)::text);
BEGIN
 IF u IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='42501'; END IF;
 SELECT * INTO m FROM public.personal_workout_models WHERE id=p_model_id AND user_id=u AND origin='PROGRAM';
 IF NOT FOUND THEN RAISE EXCEPTION 'PERSONAL_PROGRAM_NOT_FOUND'; END IF;
 IF p_draft->>'environment_code' IS DISTINCT FROM m.source_payload->>'environment_code' OR jsonb_array_length(p_draft#>'{architecture,blocks,1,exercises}') IS DISTINCT FROM jsonb_array_length(m.source_payload->'exercises') THEN RAISE EXCEPTION 'PERSONAL_PROGRAM_SOURCE_MISMATCH'; END IF;
 i:=0;
 FOR row IN SELECT value FROM jsonb_array_elements(p_draft#>'{architecture,blocks,1,exercises}') LOOP
  original:=m.source_payload->'exercises'->i;
  IF NOT coalesce(original->'candidate_ids' ? (row->>'id'),false) THEN RAISE EXCEPTION 'PERSONAL_PROGRAM_VARIANT_REQUIRED'; END IF;
  i:=i+1;
 END LOOP;
 SELECT array_agg(value) INTO gear FROM jsonb_array_elements_text(coalesce(p_draft->'equipment_ids','[]'));
 SELECT array_agg(name ORDER BY id) INTO gear_names FROM public.equipment_catalog_v2 WHERE id=ANY(coalesce(gear,'{}'));
 IF cardinality(coalesce(gear,'{}'))<>cardinality(coalesce(gear_names,'{}')) THEN RAISE EXCEPTION 'PERSONAL_PROGRAM_UNKNOWN_EQUIPMENT'; END IF;
 preview:=public.week_composer_prescription_preview_v1(u,p_draft,gear);
 duration:=(preview->>'duration_minutes')::int;
 draft:=(p_draft-'creation_request_id')||jsonb_build_object('version','w11-composer-draft-v1','structure_stable',true,'duration_minutes',duration,'estimated_minutes',ceil((preview->>'estimated_seconds')::numeric/60),'target_date',p_date,'source_model_id',p_model_id,'prescription_preview',preview);
 draft:=jsonb_set(draft,'{architecture,blocks,0,minutes}','5');
 draft:=jsonb_set(draft,'{architecture,blocks,1,minutes}',to_jsonb(duration-5));
 ctx:=jsonb_build_object('duration_minutes',duration,'environment_code',draft->>'environment_code','equipment',to_jsonb(coalesce(gear_names,'{}'::text[])),'target_region','Upper');
 IF draft->>'environment_code'='OUTDOOR' THEN
  IF p_surface IS NULL OR public.normalize_session_surface_v1(p_surface)='UNKNOWN' THEN RAISE EXCEPTION 'OUTDOOR_SURFACE_REQUIRED'; END IF;
  ctx:=ctx||jsonb_build_object('surface_code',public.normalize_session_surface_v1(p_surface));
 END IF;
 item:=public.week_create_assisted_plan_item_v1(u,p_date,ctx||jsonb_build_object('allow_same_day',coalesce(p_draft->>'creation_request_id','')<>'','creation_request_id',p_draft->>'creation_request_id'));
 IF item->>'created'='false' THEN
   IF NOT EXISTS(select 1 from public.user_training_plan_items where id=(item->>'plan_item_id')::uuid and user_id=u and planning_context_json#>>'{w11,creation_payload_hash}'=sig and jsonb_typeof(planning_context_json#>'{w11,composer_draft}')='object') THEN RAISE EXCEPTION 'CREATION_REQUEST_CONFLICT';END IF;
   RETURN jsonb_build_object('status','SAVED','plan_item_id',item->>'plan_item_id','idempotent',true);
 END IF;
 saved:=public.week_save_composer_revision_v1(u,(item->>'plan_item_id')::uuid,draft,ctx,false);
 IF saved->>'status' IS DISTINCT FROM 'SAVED' THEN RAISE EXCEPTION 'PERSONAL_PROGRAM_SAVE_FAILED'; END IF;
 IF nullif(p_draft->>'creation_request_id','') IS NOT NULL THEN UPDATE public.user_training_plan_items SET planning_context_json=jsonb_set(planning_context_json,'{w11,creation_payload_hash}',to_jsonb(sig),true) WHERE id=(item->>'plan_item_id')::uuid AND user_id=u;END IF;
 RETURN saved||jsonb_build_object('estimated_seconds',preview->'estimated_seconds');
END $function$;
