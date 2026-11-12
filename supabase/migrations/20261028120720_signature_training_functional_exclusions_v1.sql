do $guard$ begin
if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='c4_apply_wod_candidate' and md5(pg_get_functiondef(p.oid))='c806467ade170c87eed101bca040dbff') then raise exception 'Unexpected baseline: c4_apply_wod_candidate';end if;
if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='ugerod_finalize_environment_plan_v1' and md5(pg_get_functiondef(p.oid))='2f19dee8bb90adbddf7abbe199432739') then raise exception 'Unexpected baseline: ugerod_finalize_environment_plan_v1';end if;
end $guard$;
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
  v_first record;
  v_second record;
  v_items jsonb:='[]'::jsonb;
  v_limit_to_standing boolean:=false;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then
    raise exception 'Forbidden user';
  end if;

  v_limit_to_standing := v_env='OUTDOOR' and v_surface='ROAD' and not v_has_mat;

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
    coalesce(public.c4_tabata_variety_penalty_v2(p_user_id,e.id),0) asc,
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
    coalesce(public.c4_tabata_variety_penalty_v2(p_user_id,e.id),0) asc,
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
revoke all on function public.ugerod_build_signature_tabata_excluding_v1(uuid,text,text[],jsonb,integer,text,text,text[]) from public,anon,authenticated;
CREATE OR REPLACE FUNCTION public.ugerod_finalize_environment_plan_v1(p_plan jsonb, p_user_id uuid, p_environment_code text, p_focus text, p_requested_minutes integer, p_zone_terms text[] DEFAULT '{}'::text[], p_inventory jsonb DEFAULT '[]'::jsonb, p_max_complexity integer DEFAULT 3, p_max_difficulty text DEFAULT 'Intermédiaire'::text, p_surface_code text DEFAULT NULL::text, p_add_signature_if_missing boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  v_plan jsonb:=coalesce(p_plan,'{}'::jsonb);
  v_blocks jsonb:=coalesce(v_plan->'blocks','[]'::jsonb);
  v_has_tabata boolean:=false;
  v_excluded_ids text[];
  v_signature_overlap boolean;
  v_signature jsonb;
  v_rebuilt jsonb:='[]'::jsonb;
  v_block jsonb;
  v_inserted boolean:=false;
  v_time jsonb;
  v_session_intent text;
  v_base_intent text;
  v_session_role text;
  v_domain text;
  v_domain_aligned boolean:=false;
begin
  if coalesce(v_plan->>'status','') not in ('READY','generated','GENERATED') then
    return v_plan;
  end if;

  v_session_intent:=upper(coalesce(
    nullif(v_plan#>>'{authority_context,resolved_session_intent}',''),
    nullif(v_plan#>>'{architecture,session_intent_v2,proposed_session_intent}',''),
    nullif(v_plan#>>'{architecture,session_intent_v3,proposed_session_intent}',''),
    'CLASSIC'
  ));

  v_base_intent:=upper(coalesce(
    nullif(v_plan#>>'{authority_context,base_training_intent}',''),
    nullif(v_plan#>>'{architecture,session_intent_v2,current_architecture_proxy}',''),
    nullif(v_plan#>>'{architecture,session_intent_v3,current_architecture_proxy}',''),
    case when v_session_intent='CONSOLIDATE' then 'CLASSIC' else v_session_intent end
  ));

  v_session_role:=coalesce(
    nullif(v_plan#>>'{authority_context,session_role}',''),
    nullif(v_plan#>>'{architecture,session_role_v3,recommended_role}','')
  );

  v_domain_aligned:=coalesce(
    nullif(v_plan#>>'{authority_context,evolution_domain_aligned_today}','')::boolean,
    nullif(v_plan#>>'{architecture,session_role_v3,evolution_relevance,aligned}','')::boolean,
    false
  );

  if v_domain_aligned then
    v_domain:=upper(coalesce(
      nullif(v_plan#>>'{authority_context,evolution_domain}',''),
      nullif(v_plan#>>'{architecture,session_role_v3,evolution_policy,domain}','')
    ));
  else
    v_domain:=null;
  end if;

  select exists(
    select 1 from jsonb_array_elements(v_blocks) b
    where lower(coalesce(b->>'block_key','')) in ('tabata','tabata_abs')
       or upper(coalesce(b->>'module_code','')) in ('TABATA','TABATA_ABS')
  ) into v_has_tabata;

  select coalesce(array_agg(coalesce(e->>'exercise_id',e->>'id')),'{}'::text[]) into v_excluded_ids
  from jsonb_array_elements(v_blocks) b cross join lateral jsonb_array_elements(coalesce(b->'exercises','[]')) e
  where lower(b->>'block_key') in ('warmup','warm_up','skill','wod','strength','gym','street_gym');
  select exists(select 1 from jsonb_array_elements(v_blocks) b cross join lateral jsonb_array_elements(coalesce(b->'exercises','[]')) e
    where lower(b->>'block_key') in ('tabata','tabata_abs') and coalesce(e->>'exercise_id',e->>'id')=any(public.exercise_expand_functional_exclusions_v1(v_excluded_ids))) into v_signature_overlap;
  if v_signature_overlap then
    v_signature:=public.ugerod_build_signature_tabata_excluding_v1(p_user_id,p_environment_code,p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty,p_surface_code,v_excluded_ids);
    if v_signature->>'status'<>'READY' then
      return v_plan||jsonb_build_object('status','NOT_READY','reason','NO_DISTINCT_SIGNATURE_TABATA');
    end if;
    select jsonb_agg(case when lower(b->>'block_key') in ('tabata','tabata_abs') then v_signature-'status' else b end order by ord)
    into v_blocks from jsonb_array_elements(v_blocks) with ordinality x(b,ord);
    v_plan:=v_plan||jsonb_build_object('blocks',v_blocks,'signature_coherence',jsonb_build_object('reselected',true,'reason','PRESERVE_TRAINING_TARGET_AVOID_FUNCTIONAL_REPEAT'));
  end if;
  if p_add_signature_if_missing and not v_has_tabata then
    v_signature:=public.ugerod_build_signature_tabata_excluding_v1(
      p_user_id,p_environment_code,p_zone_terms,p_inventory,
      p_max_complexity,p_max_difficulty,p_surface_code,v_excluded_ids
    );

    if v_signature->>'status'='READY' then
      for v_block in select value from jsonb_array_elements(v_blocks)
      loop
        v_rebuilt:=v_rebuilt||jsonb_build_array(v_block);
        if not v_inserted and lower(coalesce(v_block->>'block_key',''))='unlock' then
          v_rebuilt:=v_rebuilt||jsonb_build_array(v_signature-'status');
          v_inserted:=true;
        end if;
      end loop;

      if not v_inserted then
        v_rebuilt:=jsonb_build_array(v_signature-'status')||v_blocks;
      end if;

      v_plan:=v_plan||jsonb_build_object('blocks',v_rebuilt);
      v_has_tabata:=true;
    else
      v_plan:=v_plan||jsonb_build_object(
        'signature_tabata_exception',v_signature
      );
    end if;
  end if;

  v_plan:=public.ugerod_apply_block_roles_v3(
    v_plan,v_session_intent,v_base_intent,p_environment_code,v_domain,v_session_role
  );

  v_time:=public.ugerod_estimate_session_elapsed_v1(
    v_plan,p_requested_minutes
  );

  v_plan:=v_plan
    ||jsonb_build_object(
      'duration_estimate',v_time,
      'time_contract_version','ugerod-session-time-engine-v1',
      'signature_tabata_present',v_has_tabata,
      'resolved_session_authority',jsonb_build_object(
        'resolved_session_intent',v_session_intent,
        'base_training_intent',v_base_intent,
        'session_role',v_session_role,
        'aligned_evolution_domain',v_domain,
        'evolution_domain_aligned_today',v_domain_aligned,
        'focus',p_focus,
        'focus_is_goal_not_session_intent',true
      )
    );

  v_plan:=jsonb_set(
    v_plan,
    '{architecture,real_duration_estimate}',
    v_time,
    true
  );

  return v_plan;
end;
$function$;
CREATE OR REPLACE FUNCTION public.c4_apply_wod_candidate(p_user_id uuid, p_session_id uuid, p_candidate jsonb, p_quality_gate jsonb, p_action text DEFAULT 'RECOMPILE'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r jsonb;
  m text:=upper(coalesce(p_candidate->>'mechanic',p_candidate#>>'{c4_final,mechanic_json,mechanic_key}',''));
  mj jsonb:=coalesce(p_candidate#>'{c4_final,mechanic_json}','{}'::jsonb);
  params jsonb:=coalesce(p_candidate#>'{c4_final,mechanic_json,parameters}','{}'::jsonb);
  v_cards int:=coalesce(nullif(params->>'cards','')::int,52);
  v_caps numeric[]:=array[]::numeric[];
  v_plan jsonb;
  v_generated jsonb;
  v_blocks jsonb;
  v_readiness text;
  v_intent text;
  x jsonb;
  v_item_ord bigint;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;

  perform 1 from public.workout_sessions where id=p_session_id and user_id=p_user_id for update;
  if exists(select 1 from jsonb_array_elements(coalesce(p_candidate->'exercises','[]')) ex where coalesce(ex->>'exercise_id',ex->>'id')=any(public.exercise_expand_functional_exclusions_v1(
    array(select coalesce(t->>'exercise_id',t->>'id') from public.workout_sessions s cross join lateral jsonb_array_elements(s.generated_workout->'blocks') b
      cross join lateral jsonb_array_elements(coalesce(b->'exercises','[]')) t where s.id=p_session_id and s.user_id=p_user_id and b->>'block_key' in ('tabata','tabata_abs'))
  ))) then
    raise exception 'Ce WOD répète un exercice ou une variante du Tabata. Choisis une autre proposition.' using errcode='P0001';
  end if;
  r:=public.c4_apply_wod_candidate_pre_deck_adaptive_v1(
    p_user_id,p_session_id,p_candidate,p_quality_gate,p_action
  );

  if m<>'DECK' then
    select generated_workout into v_generated
    from public.workout_sessions
    where id=p_session_id and user_id=p_user_id
    for update;

    select coalesce(jsonb_agg(
      case when b->>'block_key'='wod' then
        b||jsonb_build_object(
          'structure',public.c4_wod_structure_v1(
            coalesce(b->>'mechanic',m),
            coalesce(b->'mechanic_json',mj,'{}'::jsonb),
            coalesce(nullif(b->>'duration_minutes','')::int,nullif(mj->>'wod_budget_minutes','')::int,10)
          )
        )
      else b end order by ord
    ),'[]'::jsonb)
    into v_blocks
    from jsonb_array_elements(coalesce(v_generated->'blocks','[]'::jsonb)) with ordinality z(b,ord);

    v_generated:=jsonb_set(v_generated,'{blocks}',v_blocks,true);

    update public.workout_sessions
    set generated_workout=v_generated,updated_at=now()
    where id=p_session_id and user_id=p_user_id;

    r:=jsonb_set(r,'{generated_workout}',v_generated,true);
    return r;
  end if;

  select readiness,progression_intent,generated_workout
  into v_readiness,v_intent,v_generated
  from public.workout_sessions
  where id=p_session_id and user_id=p_user_id
  for update;

  for x,v_item_ord in
    select value,ordinality
    from jsonb_array_elements(coalesce(p_candidate->'exercises','[]'::jsonb)) with ordinality
  loop
    v_caps:=array_append(
      v_caps,
      public.c4_deck_exercise_rep_cap_v1(
        p_user_id,
        x->>'exercise_id',
        v_readiness,
        v_intent
      )
    );
  end loop;

  v_plan:=public.c4_build_deck_plan_v2(p_session_id,v_cards,v_caps);
  if coalesce((v_plan->>'safe')::boolean,false)=false then
    raise exception 'No safe adaptive Deck draw for session % and % cards',p_session_id,v_cards;
  end if;

  params:=params||jsonb_build_object(
    'cards',v_cards,
    'deck_order',v_plan->'deck_order',
    'deck_order_version','deck-adaptive-order-v1',
    'deck_suit_reps',v_plan->'suit_reps',
    'deck_suit_card_counts',v_plan->'suit_card_counts',
    'deck_shuffle_attempt',v_plan->'shuffle_attempt',
    'source_deck_cards',52,
    'without_replacement',true,
    'safe_random_draw',true
  );
  mj:=mj||jsonb_build_object('parameters',params);

  select coalesce(
    jsonb_agg(
      case when z.b->>'block_key'='wod' then
        z.b||jsonb_build_object(
          'mechanic','DECK',
          'mechanic_json',mj,
          'structure','DECK — '||v_cards||' cartes'
        )
      else z.b end
      order by z.block_ord
    ),
    '[]'::jsonb
  )
  into v_blocks
  from jsonb_array_elements(coalesce(v_generated->'blocks','[]'::jsonb))
       with ordinality z(b,block_ord);

  v_generated:=jsonb_set(v_generated,'{blocks}',v_blocks,true);
  v_generated:=jsonb_set(v_generated,'{meta,deck_protocol_version}',to_jsonb('deck-adaptive-v1'::text),true);
  v_generated:=jsonb_set(v_generated,'{meta,deck_played_cards}',to_jsonb(v_cards),true);

  update public.workout_session_exercises
  set prescription_json=case
        when jsonb_typeof(prescription_json)='object' then jsonb_set(prescription_json,'{block_parameters}',params,true)
        else prescription_json end,
      expected_outcome_json=case
        when jsonb_typeof(expected_outcome_json)='object' then jsonb_set(expected_outcome_json,'{block_parameters}',params,true)
        else expected_outcome_json end,
      updated_at=now()
  where session_id=p_session_id and block_key='wod';

  update public.workout_sessions
  set mechanic_json=mj,generated_workout=v_generated,updated_at=now()
  where id=p_session_id and user_id=p_user_id;

  r:=jsonb_set(r,'{generated_workout}',v_generated,true);
  r:=r||jsonb_build_object(
    'mechanic_json',mj,
    'deck_protocol',jsonb_build_object(
      'version','deck-adaptive-v1',
      'played_cards',v_cards,
      'source_deck_cards',52,
      'suit_reps',v_plan->'suit_reps',
      'suit_card_counts',v_plan->'suit_card_counts',
      'safe_random_draw',true
    )
  );
  return r;
end;
$function$;
