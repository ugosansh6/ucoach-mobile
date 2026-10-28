do $baseline$ begin
if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='c4_apply_full_body_balance_v1' and md5(pg_get_functiondef(p.oid))='287d3eff399a4a845aefb10eff6566a5') then raise exception 'Unexpected baseline: c4_apply_full_body_balance_v1';end if;
if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='c4_apply_preparation_quality_v3_pre_exercise_coherence_v1' and md5(pg_get_functiondef(p.oid))='f9fcb2393c2e06e285e3ed67af7ad7b1') then raise exception 'Unexpected baseline: c4_apply_preparation_quality_v3_pre_exercise_coherence_v1';end if;
if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='c4_plan_full_session_v2' and md5(pg_get_functiondef(p.oid))='f28093018a290ada26586ab7ee15cb45') then raise exception 'Unexpected baseline: c4_plan_full_session_v2';end if;
end $baseline$;
CREATE OR REPLACE FUNCTION public.c4_apply_full_body_balance_v1(p_user_id uuid, p_plan jsonb, p_focus text, p_duration_minutes integer, p_readiness text, p_target_region text, p_progression_intent text, p_zone_terms text[], p_inventory jsonb, p_max_complexity integer, p_max_difficulty text, p_candidate_count integer, p_policy_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  r jsonb:=p_plan;
  v_intent text:=upper(coalesce(r#>>'{resolved_session_authority,resolved_session_intent}',r#>>'{authority_context,resolved_session_intent}',r#>>'{architecture,session_intent_v2,proposed_session_intent}','CLASSIC'));
  v_before jsonb;
  v_current_exposure jsonb;
  v_after jsonb;
  v_candidate jsonb:=r->'selected_candidate';
  v_original_fit numeric:=coalesce((v_candidate#>>'{c4_final,whole_wod_metrics,whole_wod_fit}')::numeric,0);
  v_floor numeric:=-2;
  v_wod jsonb;
  v_wod_minutes integer;
  v_mechanic text;
  v_pool jsonb;
  v_proposals jsonb;
  v_alt_exercises jsonb;
  v_alt_candidate jsonb;
  v_alt_blocks jsonb;
  v_gate jsonb;
  v_changed_block_guard jsonb;
  v_profile jsonb;
  v_other_ids text[];
  v_fit numeric;
  v_best jsonb;
  v_best_exposure jsonb;
  v_best_fit numeric;
  v_best_slot integer;
  v_best_old text;
  v_best_new text;
  v_moves jsonb:='[]'::jsonb;
  v_examined integer:=0;
  v_pass integer;
  rec record;
begin
  if p_user_id is null then raise exception 'User required'; end if;
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;
  -- Explicit regional sessions keep their contract; skill priorities remain
  -- fixed while the WOD complements them, including on skill-development days.
  if coalesce(r->>'status','')<>'READY' or p_target_region is distinct from 'Full Body'
     or v_intent not in ('CLASSIC','STRENGTH_QUALITY','CONSOLIDATE','SKILL_DEVELOPMENT','CONDITIONING') then return r; end if;

  select b into v_wod from jsonb_array_elements(coalesce(r->'blocks','[]'::jsonb)) b where b->>'block_key'='wod' limit 1;
  if v_wod is null or v_candidate is null then return r; end if;
  v_mechanic:=upper(coalesce(v_candidate->>'mechanic',''));
  v_wod_minutes:=coalesce(nullif(v_wod->>'duration_minutes','')::integer,10);
  -- Named/retest protocols must retain their exact identity.
  if coalesce((v_candidate#>>'{protocol_intelligence,selection_retest_candidate}')::boolean,false)
     or coalesce((v_candidate#>>'{protocol_intelligence,retest_required}')::boolean,false)
     or coalesce((r#>>'{architecture,protocol_retest,applied}')::boolean,false) then return r; end if;

  select coalesce(nullif(config#>>'{pattern_complement,quality_delta_floor}','')::numeric,-2)
    into v_floor from public.session_engine_policy where policy_key=p_policy_key;
  v_floor:=coalesce(v_floor,-2);
  v_before:=public.c4_full_body_exposure_v1(r->'blocks');
  v_current_exposure:=v_before;

  -- Evaluate the expensive candidate pool once, then bound the compile search.
  select coalesce(jsonb_agg(to_jsonb(cp)),'[]'::jsonb) into v_pool
  from public.c2_candidate_pool(p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,
    p_progression_intent,p_zone_terms,p_inventory,'WOD',p_max_complexity,p_max_difficulty,80) cp;

  for v_pass in 1..least(3,jsonb_array_length(coalesce(v_candidate->'exercises','[]'::jsonb))) loop
    v_best:=null; v_best_fit:=null;
    -- Rank by regional coverage first, then time distribution. Only the best
    -- twelve diverse changes are compiled; fit uses the existing quality floor.
    with slots as (
      select ex,ord::integer slot from jsonb_array_elements(v_candidate->'exercises') with ordinality x(ex,ord)
      union all select null::jsonb,jsonb_array_length(v_candidate->'exercises')+1
      where (v_current_exposure->>'missing_count')::int>0 and jsonb_array_length(v_candidate->'exercises')<3
    ), alternatives as (
      select s.slot,coalesce(s.ex->>'exercise_id',s.ex->>'id') old_id,cp,
        (select jsonb_agg(case when ord=s.slot then jsonb_build_object('exercise_id',cp->>'exercise_id') else ex end order by ord)
         from jsonb_array_elements(v_candidate->'exercises') with ordinality z(ex,ord))
        ||case when s.slot>jsonb_array_length(v_candidate->'exercises') then jsonb_build_array(jsonb_build_object('exercise_id',cp->>'exercise_id')) else '[]'::jsonb end alt_exercises
      from slots s cross join jsonb_array_elements(v_pool) cp
      where cp->>'exercise_id'<>coalesce(s.ex->>'exercise_id',s.ex->>'id','')
        and not (cp->>'exercise_id'=any(public.exercise_expand_functional_exclusions_v1(
          (select coalesce(array_agg(coalesce(ex->>'exercise_id',ex->>'id')),'{}'::text[])
           from jsonb_array_elements(v_candidate->'exercises') with ordinality z(ex,ord) where ord<>s.slot)
        )))
        and not exists (
          select 1 from jsonb_array_elements(r->'blocks') b cross join lateral jsonb_array_elements(b->'exercises') ex
          where b->>'block_key' in ('tabata','tabata_abs','skill','wod','strength','gym','street_gym') and coalesce(ex->>'exercise_id',ex->>'id')=cp->>'exercise_id'
        )
    ), scored as (
      select a.*,public.c4_full_body_exposure_v1(
        (select jsonb_agg(case when b->>'block_key'='wod' then b||jsonb_build_object('exercises',a.alt_exercises) else b end order by ord)
         from jsonb_array_elements(r->'blocks') with ordinality x(b,ord))
      ) exposure from alternatives a
    ), diversified as (
      select scored.*,row_number() over (
        partition by slot,cp->>'movement_pattern'
        order by (cp->>'candidate_score')::numeric desc,cp->>'exercise_id'
      ) pattern_rank from scored
    )
    select coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) into v_proposals from (
      select * from diversified
      where pattern_rank<=2 and ((exposure->>'missing_count')::integer<(v_current_exposure->>'missing_count')::integer
         or ((exposure->>'missing_count')::integer=(v_current_exposure->>'missing_count')::integer
             and (exposure->>'imbalance')::numeric<(v_current_exposure->>'imbalance')::numeric-0.0001))
      order by (exposure->>'missing_count')::integer,(exposure->>'imbalance')::numeric,
        (cp->>'candidate_score')::numeric desc,cp->>'exercise_id',slot
      limit 12
    ) q;

    for rec in select * from jsonb_to_recordset(v_proposals) as x(slot integer,old_id text,cp jsonb,exposure jsonb) loop
      v_examined:=v_examined+1;
      select coalesce(array_agg(coalesce(ex->>'exercise_id',ex->>'id')),'{}'::text[]) into v_other_ids
      from jsonb_array_elements(v_candidate->'exercises') with ordinality x(ex,ord) where ord<>rec.slot;
      if rec.cp->>'exercise_id'=any(public.exercise_expand_functional_exclusions_v1(v_other_ids)) then continue; end if;
      v_profile:=public.c4_exercise_mechanic_profile(p_user_id,rec.cp->>'exercise_id',v_mechanic,null,p_readiness,p_progression_intent);
      if not coalesce((v_profile->>'compatible')::boolean,false)
         or coalesce(v_profile->>'classification','') not in ('NATURAL','ADAPTABLE') then continue; end if;

      select jsonb_agg(case when ord=rec.slot then jsonb_build_object(
        'exercise_id',rec.cp->>'exercise_id','name',rec.cp->>'exercise_name',
        'pattern',rec.cp->>'movement_pattern','family',rec.cp->>'exercise_family',
        'candidate_score',rec.cp->'candidate_score','components',rec.cp->'score_components',
        'prescription',public.c2_solver_prescription(p_user_id,rec.cp->>'exercise_id',r->'stimulus',v_mechanic,p_progression_intent,p_inventory),
        'mechanic_suitability',v_profile
      ) else ex end order by ord) into v_alt_exercises
      from jsonb_array_elements(v_candidate->'exercises') with ordinality x(ex,ord);
      if rec.slot>jsonb_array_length(v_candidate->'exercises') then v_alt_exercises:=v_alt_exercises||jsonb_build_array(jsonb_build_object(
        'exercise_id',rec.cp->>'exercise_id','name',rec.cp->>'exercise_name',
        'pattern',rec.cp->>'movement_pattern','family',rec.cp->>'exercise_family',
        'candidate_score',rec.cp->'candidate_score','components',rec.cp->'score_components',
        'prescription',public.c2_solver_prescription(p_user_id,rec.cp->>'exercise_id',r->'stimulus',v_mechanic,p_progression_intent,p_inventory),
        'mechanic_suitability',v_profile
      ));end if;
      v_alt_candidate:=public.c4_finalize_candidate(
        (v_candidate-'c4_final')||jsonb_build_object('exercises',v_alt_exercises),r->'stimulus',
        p_duration_minutes,v_wod_minutes,p_policy_key,'c3-sim-default'
      );
      if not coalesce((v_alt_candidate#>>'{c4_final,feasible}')::boolean,false) then continue; end if;
      v_gate:=public.c4_candidate_quality_gate_v2(v_alt_candidate,p_readiness,p_focus,p_target_region,p_zone_terms,p_inventory,p_max_complexity,p_policy_key);
      if not coalesce((v_gate->>'pass')::boolean,false) then continue; end if;
      v_fit:=coalesce((v_alt_candidate#>>'{c4_final,whole_wod_metrics,whole_wod_fit}')::numeric,0);
      if v_fit-v_original_fit<v_floor and (rec.exposure->>'missing_count')::integer >= (v_current_exposure->>'missing_count')::integer then continue; end if;
      -- Compare the compiled result: a compiler may alter volume/exercises.
      select jsonb_agg(case when b->>'block_key'='wod' then b||jsonb_build_object('exercises',v_alt_candidate->'exercises') else b end order by ord)
        into v_alt_blocks from jsonb_array_elements(r->'blocks') with ordinality x(b,ord);
      v_after:=public.c4_full_body_exposure_v1(v_alt_blocks);
      if (v_after->>'missing_count')::integer>(v_current_exposure->>'missing_count')::integer
         or ((v_after->>'missing_count')::integer=(v_current_exposure->>'missing_count')::integer
             and (v_after->>'imbalance')::numeric>=(v_current_exposure->>'imbalance')::numeric-0.0001) then continue; end if;
      if v_best is null
         or (v_after->>'missing_count')::integer<(v_best_exposure->>'missing_count')::integer
         or ((v_after->>'missing_count')::integer=(v_best_exposure->>'missing_count')::integer
             and (v_after->>'imbalance')::numeric<(v_best_exposure->>'imbalance')::numeric-0.0001)
         or ((v_after->>'missing_count')::integer=(v_best_exposure->>'missing_count')::integer
             and abs((v_after->>'imbalance')::numeric-(v_best_exposure->>'imbalance')::numeric)<0.0001 and v_fit>v_best_fit) then
        v_best:=v_alt_candidate||jsonb_build_object('c4_quality_gate',v_gate);
        v_best_exposure:=v_after; v_best_fit:=v_fit;
        v_best_slot:=rec.slot; v_best_old:=rec.old_id; v_best_new:=rec.cp->>'exercise_id';
      end if;
    end loop;
    exit when v_best is null;
    v_candidate:=v_best; v_current_exposure:=v_best_exposure;
    select jsonb_agg(case when b->>'block_key'='wod' then b||jsonb_build_object(
      'exercises',v_candidate->'exercises','mechanic_json',v_candidate#>'{c4_final,mechanic_json}',
      'expected_outcome',coalesce(b->'expected_outcome','{}'::jsonb)||jsonb_build_object(
        'predicted_volume',v_candidate#>'{c4_final,predicted_volume}','whole_wod_metrics',v_candidate#>'{c4_final,whole_wod_metrics}')
      ) else b end order by ord) into v_alt_blocks
      from jsonb_array_elements(r->'blocks') with ordinality x(b,ord);
    r:=r||jsonb_build_object('blocks',v_alt_blocks,'selected_candidate',v_candidate);
    v_moves:=v_moves||jsonb_build_array(jsonb_build_object('position',v_best_slot,'from',v_best_old,'to',v_best_new));
  end loop;

  if jsonb_array_length(v_moves)>0 then
    r:=jsonb_set(r,'{wod_solver}',coalesce(r->'wod_solver','{}'::jsonb)||jsonb_build_object(
      'quality_gate',v_candidate->'c4_quality_gate','full_body_balance_recompiled',true
    ),true);
    -- Preparation must be derived again from the final Skill/WOD targets.
    -- A curriculum may intentionally contain a target + optional exploration
    -- in one functional group (Hollow Hold / Rocks). Rebuilding preparation must
    -- not reinterpret that unchanged lesson as a new WOD redundancy conflict.
    r:=public.c4_apply_preparation_quality_v3_pre_exercise_coherence_v1(p_user_id,r,p_zone_terms,p_inventory,p_target_region,p_max_complexity,p_progression_intent);
    select public.c4_plan_functional_conflicts_v1(jsonb_build_object('blocks',jsonb_agg(b order by ord)))
      into v_changed_block_guard
      from jsonb_array_elements(r->'blocks') with ordinality x(b,ord) where b->>'block_key'<>'skill';
    if not coalesce((v_changed_block_guard->>'pass')::boolean,false) then
      return jsonb_set(p_plan,'{architecture,full_body_balance}',jsonb_build_object(
        'version','full-body-balance-v2-skill-wod','mode','ACTIVE','scope','SKILL_WOD','tabata_independent',true,'applied',false,
        'reason','NO_SAFE_PREPARATION_FOR_COMPLEMENT','before',v_before,'after',v_before
      ),true);
    end if;
    r:=public.c4_finalize_skill_path_preparation_metadata_v1(r);
  end if;
  r:=jsonb_set(r,'{architecture,full_body_balance}',jsonb_build_object(
    'version','full-body-balance-v2-skill-wod','mode','ACTIVE','scope','SKILL_WOD','tabata_independent',true,'applied',jsonb_array_length(v_moves)>0,
    'reason',case when jsonb_array_length(v_moves)>0 then 'WHOLE_SESSION_COMPLEMENTED'
      when v_examined=0 then 'ALREADY_COMPLEMENTARY'
      else 'NO_SAFE_QUALITY_PRESERVING_IMPROVEMENT' end,
    'before',v_before,'after',public.c4_full_body_exposure_v1(r->'blocks'),
    'changes',v_moves,'examined_candidates',v_examined,'quality_delta_floor',v_floor,
    'changed_block_coherence',v_changed_block_guard,
    'skill_preserved',true,'signature_tabata_preserved',true,'hard_gates_preserved',true
  ),true);
  return r;
end;
$function$;
CREATE OR REPLACE FUNCTION public.c4_apply_preparation_quality_v3_pre_exercise_coherence_v1(p_user_id uuid, p_plan jsonb, p_zone_terms text[] DEFAULT '{}'::text[], p_inventory jsonb DEFAULT '[]'::jsonb, p_target_region text DEFAULT NULL::text, p_max_complexity integer DEFAULT 3, p_progression_intent text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  r jsonb:=coalesce(p_plan,'{}'::jsonb);
  v_blocks jsonb:='[]'::jsonb;
  v_block jsonb;
  v_new jsonb;
  v_count int;
  v_duration int;
  v_rounds int:=3;
  v_total_sec int;
  v_alloc_total int;
  v_per_round_sec int;
  v_slot int;
  v_target_ids text[]:='{}'::text[];
  v_target_patterns text[]:='{}'::text[];
  v_selected_ids text[]:='{}'::text[];
  v_environment_blocked_ids text[]:='{}'::text[];
  v_selected_families text[]:='{}'::text[];
  v_prepared_patterns text[]:='{}'::text[];
  v_prepared_target_ids text[]:='{}'::text[];
  v_family_key text;
  v_candidate jsonb;
  v_pres jsonb;
  v_expected jsonb;
  v_linked_ids text[];
  target_rec record;
  rec record;
begin
  if coalesce(r->>'status','')<>'READY' then return r; end if;

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
  end if;

  select coalesce(array_agg(distinct x.exercise_id) filter(where x.exercise_id is not null),'{}'::text[]),
         coalesce(array_agg(distinct e.movement_pattern) filter(where e.movement_pattern is not null),'{}'::text[])
  into v_target_ids,v_target_patterns
  from (
    select coalesce(ex->>'exercise_id',ex->>'id') exercise_id
    from jsonb_array_elements(coalesce(r->'blocks','[]'::jsonb)) b
    cross join lateral jsonb_array_elements(coalesce(b->'exercises','[]'::jsonb)) ex
    where b->>'block_key' in ('skill','wod')
  ) x
  left join public.exercises e on e.id=x.exercise_id;

  for v_block in select value from jsonb_array_elements(coalesce(r->'blocks','[]'::jsonb)) loop
    if v_block->>'block_key' not in ('unlock','warmup') then
      v_blocks:=v_blocks||jsonb_build_array(v_block);
      continue;
    end if;

    v_count:=jsonb_array_length(coalesce(v_block->'exercises','[]'::jsonb));
    if v_count<=0 then
      v_blocks:=v_blocks||jsonb_build_array(v_block);
      continue;
    end if;

    v_duration:=coalesce(nullif(v_block->>'duration_minutes','')::int,1);
    v_total_sec:=greatest(60,v_duration*60);
    v_new:='[]'::jsonb;
    v_selected_ids:=coalesce(v_environment_blocked_ids,'{}'::text[]) || public.exercise_expand_functional_exclusions_v1(
      array(select coalesce(ex->>'exercise_id',ex->>'id') from jsonb_array_elements(coalesce(r->'blocks','[]')) b
        cross join lateral jsonb_array_elements(coalesce(b->'exercises','[]')) ex where b->>'block_key' in ('tabata','tabata_abs'))
    );
    v_selected_families:='{}'::text[];

    if v_block->>'block_key'='unlock' then
      for v_slot in 1..v_count loop
        select q.* into rec
        from (
          select e.*,
                 public.c4_preparation_family_key_v1(e.id) family_key,
                 coalesce(l.coverage,0) link_coverage,
                 coalesce(l.max_priority,0) link_priority,
                 coalesce(l.prepares_ids,'{}'::text[]) linked_target_ids,
                 (select count(*) from public.workout_session_exercises wse
                  join public.workout_sessions ws on ws.id=wse.session_id
                  where ws.user_id=p_user_id and ws.status='completed'
                    and wse.exercise_id=e.id and wse.block_key='unlock'
                    and ws.id in (select id from public.workout_sessions where user_id=p_user_id and status='completed' order by coalesce(completed_at,created_at) desc limit 6)) recent_count
          from public.exercises e
          left join lateral (
            select count(distinct pl.target_exercise_id)::int coverage,
                   max(pl.priority)::int max_priority,
                   array_agg(distinct pl.target_exercise_id)::text[] prepares_ids
            from public.exercise_preparation_links pl
            where pl.active and pl.warmup_exercise_id=e.id
              and pl.target_exercise_id=any(v_target_ids)
              and pl.link_type in ('activation','mobility')
          ) l on true
          where 'Warm-up'=any(coalesce(e.usable_for,'{}'::text[]))
            and coalesce(e.warmup_eligible,false)
            and e.warmup_role in ('mobility','activation')
            and coalesce(e.warmup_intensity,99)<=2
            and coalesce(e.fatigue_score,99)<=2
            and coalesce(e.joint_impact,99)<=2
            and coalesce(e.technical_complexity,99)<=p_max_complexity
            and not(e.id=any(public.exercise_expand_functional_exclusions_v1(v_selected_ids)))
            and not(public.c4_preparation_family_key_v1(e.id)=any(v_selected_families))
            and public.exercise_safe_for_zones(e.id,public.normalize_body_zone_ids(coalesce(p_zone_terms,'{}'::text[])))
            and public.exercise_equipment_compatible(e.id,p_inventory)
        ) q
        order by
          case
            when v_slot=1 and q.warmup_role='mobility' then 0
            when v_slot=1 then 1
            when v_slot>1 and q.link_coverage>0 then 0
            when v_slot>1 and q.warmup_role='activation' then 1
            else 2 end,
          q.link_coverage desc,q.link_priority desc,q.recent_count asc,coalesce(q.selection_weight,0) desc,q.id
        limit 1;

        if not found then exit; end if;

        v_family_key:=rec.family_key;
        v_alloc_total:=greatest(30,v_total_sec/v_count);
        v_pres:=(public.c2_solver_prescription(p_user_id,rec.id,coalesce(r->'stimulus','{}'::jsonb),'WARMUP',p_progression_intent,p_inventory)
                 -'target_rpe_min'-'target_rpe_max'-'target_duration_minutes')
          ||jsonb_build_object(
            'block_role','unlock','unlock_role',rec.warmup_role,
            'activation_counts_as_unlock',rec.warmup_role='activation',
            'allocated_duration_seconds',v_alloc_total,
            'fatigue_target','minimal','effort_semantics','easy_mobility_or_activation_no_rpe_target',
            'preparation_quality_version','preparation-v3'
          );
        v_expected:=jsonb_build_object(
          'block_key','unlock','goal','mobility_and_light_activation_without_fatigue',
          'pain_gate',true,'equipment_gate',true,'environment_gate',true,'activation_counts_as_unlock',rec.warmup_role='activation',
          'prepares_exercise_ids',to_jsonb(coalesce(rec.linked_target_ids,'{}'::text[]))
        );
        v_new:=v_new||jsonb_build_array(jsonb_build_object(
          'exercise_id',rec.id,'name',coalesce(nullif(btrim(rec.display_name),''),rec.name),
          'pattern',rec.movement_pattern,'family',rec.exercise_family,'warmup_role',rec.warmup_role,
          'preparation_family_key',v_family_key,'prescription',v_pres,'expected_outcome',v_expected
        ));
        v_selected_ids:=array_append(v_selected_ids,rec.id);
        v_selected_families:=array_append(v_selected_families,v_family_key);
      end loop;

      if jsonb_array_length(v_new)>0 then
        v_block:=v_block||jsonb_build_object(
          'exercises',v_new,
          'structure','Mobilité + activation légère · sans fatigue',
          'preparation_quality_contract',jsonb_build_object(
            'version','preparation-v3','unlock_contains_mobility_and_activation',true,
            'activation_is_not_specific_warmup',true,'recent_history_completed_only',true
          )
        );
      end if;

    else
      v_prepared_patterns:='{}'::text[];
      v_prepared_target_ids:='{}'::text[];
      v_rounds:=3;
      v_alloc_total:=greatest(30,v_total_sec/v_count);
      v_per_round_sec:=greatest(10,v_alloc_total/v_rounds);

      -- Prepare the actual Skill anchor, then distinct final WOD patterns.
      -- There is no independent Full Body region quota in the warm-up.
      for target_rec in
        with raw as (
          select b->>'block_key' target_block,
                 coalesce(ex->>'exercise_id',ex->>'id') target_id,
                 bord,eord
          from jsonb_array_elements(coalesce(r->'blocks','[]'::jsonb)) with ordinality bz(b,bord)
          cross join lateral jsonb_array_elements(coalesce(b->'exercises','[]'::jsonb)) with ordinality ez(ex,eord)
          where b->>'block_key' in ('skill','wod')
        ), dedup as (
          select distinct on (raw.target_id)
                 raw.target_id,raw.target_block,e.movement_pattern,e.exercise_family,e.technical_complexity,e.fatigue_score,raw.bord,raw.eord
          from raw join public.exercises e on e.id=raw.target_id
          order by raw.target_id,case when raw.target_block='skill' then 0 else 1 end,raw.bord,raw.eord
        )
        select * from dedup
        order by case when p_target_region='Full Body' then
                    case when target_block='skill' and eord=1 then 0 when target_block='wod' then 1 else 2 end
                  else case when target_block='skill' then 0 else 1 end end,
                 coalesce(technical_complexity,0) desc,
                 coalesce(fatigue_score,0) desc,
                 bord,eord,target_id
      loop
        exit when jsonb_array_length(v_new)>=v_count;
        if target_rec.movement_pattern is not null and target_rec.movement_pattern=any(v_prepared_patterns) then
          continue;
        end if;

        v_candidate:=public.c4_warmup_candidate_for_target_v1(
          p_user_id,target_rec.target_id,target_rec.target_block,v_selected_ids,v_target_ids,
          p_zone_terms,p_inventory,p_max_complexity
        );
        if coalesce(v_candidate->>'status','')<>'AVAILABLE' then continue; end if;

        select * into rec from public.exercises where id=v_candidate->>'candidate_exercise_id';
        if not found then continue; end if;

        v_pres:=(public.c2_solver_prescription(p_user_id,rec.id,coalesce(r->'stimulus','{}'::jsonb),'WARMUP',p_progression_intent,p_inventory)
                 -'target_rpe_min'-'target_rpe_max'-'target_duration_minutes'-'load_kg'-'load_resolution')
          ||jsonb_build_object(
            'block_role','warmup','warmup_role','movement_prep','warmup_rounds',v_rounds,
            'warmup_target_exercise_id',target_rec.target_id,'warmup_target_block',target_rec.target_block,
            'warmup_derivation_tier',(v_candidate->>'tier')::int,
            'allocated_duration_seconds',v_alloc_total,'per_round_target_seconds',v_per_round_sec,
            'fatigue_target','low','effort_semantics','easy_progressive_movement_prep_no_rpe_target',
            'preparation_quality_version','preparation-v3'
          );

        if rec.movement_pattern='Conditioning' then
          v_pres:=v_pres-'reps_min'-'reps_max';
          v_pres:=v_pres||jsonb_build_object('duration_seconds_min',least(20,v_per_round_sec),'duration_seconds_max',least(25,greatest(20,v_per_round_sec)),'prescription_type','time_interval');
        elsif lower(coalesce(rec.prescription_type,''))='isometric' then
          v_pres:=v_pres-'reps_min'-'reps_max';
          v_pres:=v_pres||jsonb_build_object('duration_seconds_min',15,'duration_seconds_max',least(25,greatest(20,v_per_round_sec)));
        elsif v_pres ? 'reps_min' or v_pres ? 'reps_max' then
          v_pres:=jsonb_set(v_pres,'{reps_min}',to_jsonb(case when coalesce(rec.fatigue_score,1)>=3 then 5 else 6 end),true);
          v_pres:=jsonb_set(v_pres,'{reps_max}',to_jsonb(case when coalesce(rec.fatigue_score,1)>=3 then 8 else 10 end),true);
        end if;

        v_expected:=jsonb_build_object(
          'block_key','warmup','goal','easier_movement_preparation_for_skill_and_wod',
          'pain_gate',true,'equipment_gate',true,'environment_gate',true,'warmup_rounds',v_rounds,
          'target_exercise_id',target_rec.target_id,'target_block',target_rec.target_block,
          'derivation_tier',(v_candidate->>'tier')::int,
          'skill_target_must_be_easier',target_rec.target_block='skill'
        );

        v_new:=v_new||jsonb_build_array(jsonb_build_object(
          'exercise_id',rec.id,'name',coalesce(nullif(btrim(rec.display_name),''),rec.name),
          'pattern',rec.movement_pattern,'family',rec.exercise_family,'warmup_role','movement_prep',
          'prescription',v_pres,'expected_outcome',v_expected
        ));
        v_selected_ids:=array_append(v_selected_ids,rec.id);
        v_prepared_target_ids:=array_append(v_prepared_target_ids,target_rec.target_id);
        if target_rec.movement_pattern is not null then v_prepared_patterns:=array_append(v_prepared_patterns,target_rec.movement_pattern); end if;
      end loop;

      -- Pass 2: cover remaining Skill/WOD targets even when their pattern is already represented.
      for target_rec in
        with raw as (
          select b->>'block_key' target_block,
                 coalesce(ex->>'exercise_id',ex->>'id') target_id,
                 bord,eord
          from jsonb_array_elements(coalesce(r->'blocks','[]'::jsonb)) with ordinality bz(b,bord)
          cross join lateral jsonb_array_elements(coalesce(b->'exercises','[]'::jsonb)) with ordinality ez(ex,eord)
          where b->>'block_key' in ('skill','wod')
        ), dedup as (
          select distinct on (raw.target_id)
                 raw.target_id,raw.target_block,e.movement_pattern,e.exercise_family,e.technical_complexity,e.fatigue_score,raw.bord,raw.eord
          from raw join public.exercises e on e.id=raw.target_id
          order by raw.target_id,case when raw.target_block='skill' then 0 else 1 end,raw.bord,raw.eord
        )
        select * from dedup
        where not(target_id=any(v_prepared_target_ids))
        order by case when target_block='skill' then 0 else 1 end,
                 coalesce(technical_complexity,0) desc,
                 coalesce(fatigue_score,0) desc,
                 bord,eord,target_id
      loop
        exit when jsonb_array_length(v_new)>=v_count;
        v_candidate:=public.c4_warmup_candidate_for_target_v1(
          p_user_id,target_rec.target_id,target_rec.target_block,v_selected_ids,v_target_ids,
          p_zone_terms,p_inventory,p_max_complexity
        );
        if coalesce(v_candidate->>'status','')<>'AVAILABLE' then continue; end if;

        select * into rec from public.exercises where id=v_candidate->>'candidate_exercise_id';
        if not found then continue; end if;

        v_pres:=(public.c2_solver_prescription(p_user_id,rec.id,coalesce(r->'stimulus','{}'::jsonb),'WARMUP',p_progression_intent,p_inventory)
                 -'target_rpe_min'-'target_rpe_max'-'target_duration_minutes'-'load_kg'-'load_resolution')
          ||jsonb_build_object(
            'block_role','warmup','warmup_role','movement_prep','warmup_rounds',v_rounds,
            'warmup_target_exercise_id',target_rec.target_id,'warmup_target_block',target_rec.target_block,
            'warmup_derivation_tier',(v_candidate->>'tier')::int,
            'allocated_duration_seconds',v_alloc_total,'per_round_target_seconds',v_per_round_sec,
            'fatigue_target','low','effort_semantics','easy_progressive_movement_prep_no_rpe_target',
            'preparation_quality_version','preparation-v3'
          );
        if rec.movement_pattern='Conditioning' then
          v_pres:=v_pres-'reps_min'-'reps_max';
          v_pres:=v_pres||jsonb_build_object('duration_seconds_min',least(20,v_per_round_sec),'duration_seconds_max',least(25,greatest(20,v_per_round_sec)),'prescription_type','time_interval');
        elsif lower(coalesce(rec.prescription_type,''))='isometric' then
          v_pres:=v_pres-'reps_min'-'reps_max';
          v_pres:=v_pres||jsonb_build_object('duration_seconds_min',15,'duration_seconds_max',least(25,greatest(20,v_per_round_sec)));
        elsif v_pres ? 'reps_min' or v_pres ? 'reps_max' then
          v_pres:=jsonb_set(v_pres,'{reps_min}',to_jsonb(case when coalesce(rec.fatigue_score,1)>=3 then 5 else 6 end),true);
          v_pres:=jsonb_set(v_pres,'{reps_max}',to_jsonb(case when coalesce(rec.fatigue_score,1)>=3 then 8 else 10 end),true);
        end if;

        v_expected:=jsonb_build_object(
          'block_key','warmup','goal','easier_movement_preparation_for_skill_and_wod',
          'pain_gate',true,'equipment_gate',true,'environment_gate',true,'warmup_rounds',v_rounds,
          'target_exercise_id',target_rec.target_id,'target_block',target_rec.target_block,
          'derivation_tier',(v_candidate->>'tier')::int,
          'skill_target_must_be_easier',target_rec.target_block='skill'
        );
        v_new:=v_new||jsonb_build_array(jsonb_build_object(
          'exercise_id',rec.id,'name',coalesce(nullif(btrim(rec.display_name),''),rec.name),
          'pattern',rec.movement_pattern,'family',rec.exercise_family,'warmup_role','movement_prep',
          'prescription',v_pres,'expected_outcome',v_expected
        ));
        v_selected_ids:=array_append(v_selected_ids,rec.id);
        v_prepared_target_ids:=array_append(v_prepared_target_ids,target_rec.target_id);
      end loop;

      -- Pass 3: if the architecture still asks for more movements, add a safe low-fatigue movement prep.
      while jsonb_array_length(v_new)<v_count loop
        select e.* into rec
        from public.exercises e
        where 'Warm-up'=any(coalesce(e.usable_for,'{}'::text[]))
          and coalesce(e.warmup_eligible,false)
          and e.warmup_role in ('movement_prep','pulse_raiser')
          and coalesce(e.warmup_intensity,99)<=2
          and coalesce(e.fatigue_score,99)<=2
          and coalesce(e.joint_impact,99)<=2
          and coalesce(e.technical_complexity,99)<=p_max_complexity
          and not(e.id=any(public.exercise_expand_functional_exclusions_v1(v_selected_ids)))
          and public.exercise_safe_for_zones(e.id,public.normalize_body_zone_ids(coalesce(p_zone_terms,'{}'::text[])))
          and public.exercise_equipment_compatible(e.id,p_inventory)
        order by case when e.movement_pattern=any(v_target_patterns) then 0 else 1 end,
                 (select count(*) from public.workout_session_exercises wse join public.workout_sessions ws on ws.id=wse.session_id
                  where ws.user_id=p_user_id and ws.status='completed' and wse.exercise_id=e.id and wse.block_key='warm_up') asc,
                 coalesce(e.selection_weight,0) desc,e.id
        limit 1;
        if not found then exit; end if;

        v_pres:=(public.c2_solver_prescription(p_user_id,rec.id,coalesce(r->'stimulus','{}'::jsonb),'WARMUP',p_progression_intent,p_inventory)
                 -'target_rpe_min'-'target_rpe_max'-'target_duration_minutes'-'load_kg'-'load_resolution')
          ||jsonb_build_object(
            'block_role','warmup','warmup_role','movement_prep','warmup_rounds',v_rounds,
            'warmup_derivation_tier',9,'allocated_duration_seconds',v_alloc_total,'per_round_target_seconds',v_per_round_sec,
            'fatigue_target','low','effort_semantics','easy_progressive_movement_prep_no_rpe_target','preparation_quality_version','preparation-v3'
          );
        if rec.movement_pattern='Conditioning' then
          v_pres:=v_pres-'reps_min'-'reps_max';
          v_pres:=v_pres||jsonb_build_object('duration_seconds_min',least(20,v_per_round_sec),'duration_seconds_max',least(25,greatest(20,v_per_round_sec)),'prescription_type','time_interval');
        elsif v_pres ? 'reps_min' or v_pres ? 'reps_max' then
          v_pres:=jsonb_set(v_pres,'{reps_min}',to_jsonb(6),true);
          v_pres:=jsonb_set(v_pres,'{reps_max}',to_jsonb(10),true);
        end if;

        v_new:=v_new||jsonb_build_array(jsonb_build_object(
          'exercise_id',rec.id,'name',coalesce(nullif(btrim(rec.display_name),''),rec.name),
          'pattern',rec.movement_pattern,'family',rec.exercise_family,'warmup_role','movement_prep',
          'prescription',v_pres,
          'expected_outcome',jsonb_build_object('block_key','warmup','goal','general_low_fatigue_movement_prep','warmup_rounds',v_rounds,'pain_gate',true,'equipment_gate',true,'environment_gate',true)
        ));
        v_selected_ids:=array_append(v_selected_ids,rec.id);
      end loop;

      if jsonb_array_length(v_new)>0 then
        v_block:=v_block||jsonb_build_object(
          'exercises',v_new,
          'warmup_rounds',v_rounds,
          'structure',v_rounds||' tours · mouvements simplifiés du Skill et du WOD',
          'preparation_quality_contract',jsonb_build_object(
            'version','preparation-v3','rounds',v_rounds,
            'movement_prep_only',true,'activation_routed_to_unlock',true,
            'selection_basis','FINAL_SKILL_AND_WOD_TARGETS','independent_region_quota',false,
            'skill_exact_exercise_forbidden',true,'skill_candidate_must_be_easier',true,
            'fallback_hierarchy',jsonb_build_array('specific_regression','graph_regression','linked_movement_prep','pulse_raiser','easier_same_pattern','easier_same_primary_muscle','easier_same_family','exact_simple_wod_last_resort'),
            'recent_history_completed_only',true
          )
        );
      end if;
    end if;

    v_blocks:=v_blocks||jsonb_build_array(v_block);
  end loop;

  r:=jsonb_set(r,'{blocks}',v_blocks,true);
  r:=jsonb_set(r,'{architecture,preparation_quality_version}',to_jsonb('preparation-v3'::text),true);
  r:=jsonb_set(r,'{architecture,warmup_variety_version}',to_jsonb('preparation-v3'::text),true);
  return r;
end;
$function$;

CREATE OR REPLACE FUNCTION public.c4_plan_full_session_v2(p_user_id uuid, p_focus text, p_duration_minutes integer, p_readiness text, p_target_region text DEFAULT NULL::text, p_progression_intent text DEFAULT NULL::text, p_zone_terms text[] DEFAULT '{}'::text[], p_inventory jsonb DEFAULT '[]'::jsonb, p_max_complexity integer DEFAULT 3, p_max_difficulty text DEFAULT 'Intermédiaire'::text, p_candidate_count integer DEFAULT 12, p_policy_key text DEFAULT 'c4-final-default'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  r jsonb;
  v_env text:=public.normalize_session_environment_v1(
    coalesce(nullif(current_setting('ugerod.session_environment',true),''),'UNKNOWN')
  );
begin
  if p_user_id is null then raise exception 'User required'; end if;
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;

  r:=public.c4_plan_full_session_v2_pre_force_prove(
    p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
    p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty,p_candidate_count,p_policy_key
  );

  if coalesce(r->>'status','')<>'READY' then return r; end if;

  r:=public.c4_refine_force_prove_v1(r);
  r:=public.c4_apply_maintenance_harmonization_v1(
    p_user_id,r,p_readiness
  );
  r:=jsonb_set(
    r,'{architecture,coach_v2,maintenance_harmonization_source}',
    '"c4_apply_maintenance_harmonization_v1"'::jsonb,true
  );

  r:=public.c4_apply_full_body_balance_v1(
    p_user_id,r,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
    p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty,p_candidate_count,p_policy_key
  );
  if coalesce(r->>'status','')<>'READY' then return r; end if;

  -- Preparation follows the final presented exercises, not the initial scaffold.
  if p_target_region='Full Body' then
    r:=public.c4_apply_preparation_quality_v3_pre_exercise_coherence_v1(
      p_user_id,r,p_zone_terms,p_inventory,p_target_region,p_max_complexity,p_progression_intent);
    r:=public.c4_finalize_skill_path_preparation_metadata_v1(r);
  end if;

  r:=public.ugerod_finalize_environment_plan_v1(
    r,p_user_id,v_env,p_focus,p_duration_minutes,p_zone_terms,p_inventory,
    p_max_complexity,p_max_difficulty,
    null,
    false
  );

  if p_target_region='Full Body' and r#>>'{architecture,full_body_balance,mode}'='ACTIVE' then
    r:=jsonb_set(r,'{architecture,full_body_balance,after}',public.c4_full_body_exposure_v1(r->'blocks'),true);
    if (r#>>'{architecture,full_body_balance,after,missing_count}')::int>0 then
      r:=r||jsonb_build_object('status','NOT_READY','reason','FULL_BODY_COVERAGE_UNAVAILABLE');
    end if;
  end if;
  r:=jsonb_set(
    r,'{architecture,quality_evolution}',
    jsonb_build_object(
      'version','ugerod-quality-evolution-v1',
      'intent_ranking_active',true,
      'environment_leverage_active',true,
      'common_time_engine_active',true,
      'block_roles_active',true,
      'signature_tabata_preserved',true
    ),
    true
  );

  return r;
end;
$function$;
