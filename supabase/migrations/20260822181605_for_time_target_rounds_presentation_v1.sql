create or replace function public.c4_wod_structure_v1(
  p_mechanic text,
  p_mechanic_json jsonb,
  p_duration_minutes integer
)
returns text
language plpgsql
immutable
set search_path to 'public'
as $function$
declare
  v_mechanic text:=upper(coalesce(nullif(trim(p_mechanic),''),p_mechanic_json->>'mechanic_key','WOD'));
  v_params jsonb:=coalesce(p_mechanic_json->'parameters','{}'::jsonb);
  v_budget_minutes int:=greatest(1,coalesce(nullif(p_mechanic_json->>'wod_budget_minutes','')::int,p_duration_minutes,10));
  v_rounds int:=nullif(v_params->>'rounds','')::int;
  v_cap_seconds int:=nullif(v_params->>'cap_seconds','')::int;
  v_duration_seconds int;
  v_clock text;
begin
  if v_mechanic='FOR_TIME' then
    v_cap_seconds:=greatest(1,coalesce(v_cap_seconds,v_budget_minutes*60));
    v_clock:=(v_cap_seconds/60)::text||':'||lpad((v_cap_seconds%60)::text,2,'0');

    if v_rounds is not null then
      return 'FOR TIME · '||v_rounds||' TOURS · CAP '||v_clock;
    end if;

    return 'FOR TIME · CAP '||v_clock;
  end if;

  if v_mechanic='AMRAP' then
    v_duration_seconds:=greatest(
      1,
      coalesce(nullif(v_params->>'duration_minutes','')::int,v_budget_minutes)*60
    );
    v_clock:=(v_duration_seconds/60)::text||':'||lpad((v_duration_seconds%60)::text,2,'0');
    return 'AMRAP · '||v_clock;
  end if;

  return replace(v_mechanic,'_',' ')||' · '||v_budget_minutes||' min';
end;
$function$;

create or replace function public.c4_generate_full_session(p_user_id uuid, p_focus text, p_duration_minutes integer, p_readiness text, p_target_region text default null::text, p_progression_intent text default null::text, p_zone_terms text[] default '{}'::text[], p_inventory jsonb default '[]'::jsonb, p_available_equipment text[] default '{}'::text[], p_max_complexity integer default 3, p_max_difficulty text default 'Intermédiaire'::text, p_candidate_count integer default 12, p_policy_key text default 'c4-final-default'::text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_plan jsonb;
  v_session_id uuid;
  v_blocks jsonb:='[]'::jsonb;
  v_block jsonb;
  v_block_out jsonb;
  v_ex jsonb;
  v_ex_out jsonb;
  v_pres jsonb;
  v_instance uuid;
  v_db_block text;
  v_position int;
  v_cap jsonb;
  v_generated jsonb;
  v_mechanic jsonb;
  v_quality jsonb;
  v_rpe_min numeric;
  v_rpe_max numeric;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;

  v_plan:=public.c4_plan_full_session(
    p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
    p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty,p_candidate_count,p_policy_key
  );
  if coalesce(v_plan->>'status','')<>'READY' then return v_plan; end if;

  v_mechanic:=coalesce(v_plan#>'{selected_candidate,c4_final,mechanic_json}','{}'::jsonb);
  v_quality:=coalesce(v_plan#>'{selected_candidate,c4_quality_gate}','{}'::jsonb)||jsonb_build_object(
    'anti_redundancy',coalesce(v_plan#>'{selected_candidate,c4_anti_redundancy}','{}'::jsonb),
    'selection_score',v_plan#>'{selected_candidate,c4_selection_score}');
  v_rpe_min:=nullif(v_plan#>>'{stimulus,rpe_target,min}','')::numeric;
  v_rpe_max:=nullif(v_plan#>>'{stimulus,rpe_target,max}','')::numeric;

  insert into public.workout_sessions(
    user_id,status,duration_minutes,target_region,readiness,focus,available_equipment,injured_zones,progression_intent,
    planning_context_json,expected_stimulus_json,mechanic_json,quality_gate_json,generated_workout
  ) values (
    p_user_id,'generated',p_duration_minutes,p_target_region,p_readiness,p_focus,coalesce(p_available_equipment,'{}'::text[]),coalesce(p_zone_terms,'{}'::text[]),
    case when upper(coalesce(p_progression_intent,'')) in ('MAINTAIN','PROGRESS','CONSOLIDATE','DELOAD','RECALIBRATE','EXPLORE') then upper(p_progression_intent) else null end,
    jsonb_build_object('engine','c4-full-session-v1','architecture',v_plan->'architecture','full_session_authority',true),
    coalesce(v_plan->'stimulus','{}'::jsonb),v_mechanic,v_quality,'{}'::jsonb
  ) returning id into v_session_id;

  for v_block in select value from jsonb_array_elements(v_plan->'blocks')
  loop
    v_db_block:=case v_block->>'block_key' when 'warmup' then 'warm_up' else v_block->>'block_key' end;
    v_block_out:=v_block;

    if v_block->>'block_key'='wod' then
      v_block_out:=v_block_out||jsonb_build_object(
        'structure',public.c4_wod_structure_v1(
          coalesce(v_block->>'mechanic',v_mechanic->>'mechanic_key'),
          coalesce(v_block->'mechanic_json',v_mechanic,'{}'::jsonb),
          coalesce(nullif(v_block->>'duration_minutes','')::int,nullif(v_mechanic->>'wod_budget_minutes','')::int,10)
        )
      );
    end if;

    v_ex_out:='[]'::jsonb;v_position:=0;

    for v_ex in select value from jsonb_array_elements(coalesce(v_block->'exercises','[]'::jsonb))
    loop
      v_position:=v_position+1;
      v_pres:=coalesce(v_ex->'prescription','{}'::jsonb);
      select coalesce(jsonb_build_object(
        'source','user_exercise_coach_state','state',s.state,'recommendation',s.recommendation,
        'reps_envelope',s.reps_envelope,'load_envelope',s.load_envelope,'time_envelope',s.time_envelope,
        'distance_envelope',s.distance_envelope,'pace_envelope',s.pace_envelope,
        'capability_confidence',s.capability_confidence,'capability_freshness',s.capability_freshness,
        'valid_evidence_count',s.valid_evidence_count),'{}'::jsonb)
      into v_cap
      from public.user_exercise_coach_state s where s.user_id=p_user_id and s.exercise_id=v_ex->>'exercise_id';

      insert into public.workout_session_exercises(
        session_id,exercise_id,exercise_name,block_key,position,status,prescription,prescription_json,
        expected_outcome_json,expected_rpe_min,expected_rpe_max,capacity_snapshot_json,solver_decision_json
      ) values (
        v_session_id,v_ex->>'exercise_id',coalesce(v_ex->>'name',(select name from public.exercises where id=v_ex->>'exercise_id')),
        v_db_block,v_position,'pending',coalesce(v_pres->>'text','Prescription adaptée'),v_pres,
        coalesce(v_ex->'expected_outcome',v_block->'expected_outcome','{}'::jsonb),v_rpe_min,v_rpe_max,coalesce(v_cap,'{}'::jsonb),
        jsonb_build_object('engine','c4-full-session-v1','block_key',v_block->>'block_key','full_session_authority',true,
          'mechanic',case when v_block->>'block_key'='wod' then v_block->>'mechanic' else null end)
      ) returning id into v_instance;

      v_ex_out:=v_ex_out||jsonb_build_array(v_ex||jsonb_build_object('id',v_ex->>'exercise_id','session_exercise_id',v_instance));
    end loop;

    v_block_out:=jsonb_set(v_block_out,'{exercises}',v_ex_out,true);
    v_blocks:=v_blocks||jsonb_build_array(v_block_out);
  end loop;

  v_generated:=jsonb_build_object(
    'version','c4-full-session-v1','session_id',v_session_id,
    'meta',jsonb_build_object('session_engine','c4-full-session-v1','full_session_authority',true,'architecture',v_plan->'architecture',
      'target_region',p_target_region,'focus',p_focus,'progression_intent',p_progression_intent),
    'blocks',v_blocks
  );

  update public.workout_sessions set generated_workout=v_generated,updated_at=now() where id=v_session_id;

  return jsonb_build_object('session_id',v_session_id,'status','generated','version','c4-full-session-v1',
    'meta',v_generated->'meta','blocks',v_blocks,'stimulus',v_plan->'stimulus','wod_solver',v_plan->'wod_solver');
end;
$function$;

create or replace function public.c4_apply_wod_candidate(p_user_id uuid, p_session_id uuid, p_candidate jsonb, p_quality_gate jsonb, p_action text default 'RECOMPILE'::text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
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
