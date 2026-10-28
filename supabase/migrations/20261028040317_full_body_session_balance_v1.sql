-- Full Body is a whole-session intent. Keep the skill and signature Tabata;
-- complement them in the WOD after the last exercise-selection consumer.
-- These are internal, invoker helpers; no additional public RPC is exposed.

-- This preserves the inspected live wrapper instead of silently replacing
-- intervening backend work or applying against an older environment baseline.
do $guard$
begin
  if md5(pg_get_functiondef('public.c4_plan_full_session_v2(uuid,text,integer,text,text,text,text[],jsonb,integer,text,integer,text)'::regprocedure))
     <> '76d19d480bcc01808a2fa91dda20da6c' then
    raise exception 'C4 wrapper changed: rebase Full Body balancing on the current environment first';
  end if;
end;
$guard$;

create or replace function public.c4_full_body_region_v1(
  p_pattern text, p_family text, p_catalog_region text
) returns text language sql immutable
set search_path = public, pg_temp as $$
  select case
    when p_family='Core' or p_pattern in ('Core','Anti-Extension','Anti-Rotation','Rotation') then 'Core'
    when p_pattern in ('Squat','Hinge','Lunge','Step','Jump','Knee Extension','Knee Flexion','Hip Abduction','Hip Adduction','Ankle Extension') then 'Lower'
    when p_family in ('Push','Pull') or p_pattern in ('Push Horizontal','Push Vertical','Pull Horizontal','Pull Vertical','Elbow Extension','Elbow Flexion','Shoulder Abduction') then 'Upper'
    when p_catalog_region in ('Upper','Lower','Core') then p_catalog_region
    else 'Mixed'
  end;
$$;

create or replace function public.c4_full_body_exposure_v1(p_blocks jsonb)
returns jsonb language sql stable
set search_path = public, pg_temp as $$
  with items as (
    select public.c4_full_body_region_v1(e.movement_pattern,e.exercise_family,e.body_region) region,
      greatest(0,coalesce(nullif(b->>'duration_minutes','')::numeric,0))
        / greatest(1,jsonb_array_length(coalesce(b->'exercises','[]'::jsonb))) minutes,
      lower(b->>'block_key') block_key
    from jsonb_array_elements(coalesce(p_blocks,'[]'::jsonb)) b
    cross join lateral jsonb_array_elements(coalesce(b->'exercises','[]'::jsonb)) x
    left join public.exercises e on e.id=coalesce(x->>'exercise_id',x->>'id')
    where lower(b->>'block_key') in ('tabata','tabata_abs','skill','wod')
  ), regions as (
    select r.region,coalesce(sum(i.minutes),0) minutes,count(i.region) occurrences
    from (values ('Upper'),('Lower'),('Core')) r(region)
    left join items i on i.region=r.region group by r.region
  ), totals as (
    select sum(minutes) minutes from regions
  )
  select jsonb_build_object(
    'version','full-body-exposure-v1',
    'regional_minutes', (select jsonb_object_agg(region,round(minutes,4)) from regions),
    'regional_occurrences', (select jsonb_object_agg(region,occurrences) from regions),
    'missing_regions',coalesce((select jsonb_agg(region order by region) from regions where occurrences=0),'[]'::jsonb),
    'missing_count',(select count(*) from regions where occurrences=0),
    -- A relative ranking, not a physiological load estimate or a hard quota.
    'imbalance',coalesce((select sum(power(r.minutes/nullif(t.minutes,0)-1.0/3,2)) from regions r cross join totals t),0),
    'mixed_minutes',coalesce((select sum(minutes) from items where region='Mixed'),0),
    'tabata_counted',true,'warmup_unlock_counted',false,
    'semantics','block_time_exposure_proxy_not_active_work_or_muscle_load'
  );
$$;

create or replace function public.c4_apply_full_body_balance_v1(
  p_user_id uuid,p_plan jsonb,p_focus text,p_duration_minutes integer,p_readiness text,
  p_target_region text,p_progression_intent text,p_zone_terms text[],p_inventory jsonb,
  p_max_complexity integer,p_max_difficulty text,p_candidate_count integer,p_policy_key text
) returns jsonb language plpgsql stable
set search_path = public, pg_temp as $$
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
    ), alternatives as (
      select s.slot,s.ex->>'exercise_id' old_id,cp,
        (select jsonb_agg(case when ord=s.slot then jsonb_build_object('exercise_id',cp->>'exercise_id') else ex end order by ord)
         from jsonb_array_elements(v_candidate->'exercises') with ordinality z(ex,ord)) alt_exercises
      from slots s cross join jsonb_array_elements(v_pool) cp
      where cp->>'exercise_id'<>s.ex->>'exercise_id'
        and not (cp->>'exercise_id'=any(public.exercise_expand_functional_exclusions_v1(
          (select coalesce(array_agg(ex->>'exercise_id'),'{}'::text[])
           from jsonb_array_elements(v_candidate->'exercises') with ordinality z(ex,ord) where ord<>s.slot)
        )))
        and not exists (
          select 1 from jsonb_array_elements(r->'blocks') b cross join lateral jsonb_array_elements(b->'exercises') ex
          where b->>'block_key' in ('tabata','tabata_abs','skill','wod') and ex->>'exercise_id'=cp->>'exercise_id'
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
      select coalesce(array_agg(ex->>'exercise_id'),'{}'::text[]) into v_other_ids
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
      v_alt_candidate:=public.c4_finalize_candidate(
        (v_candidate-'c4_final')||jsonb_build_object('exercises',v_alt_exercises),r->'stimulus',
        p_duration_minutes,v_wod_minutes,p_policy_key,'c3-sim-default'
      );
      if not coalesce((v_alt_candidate#>>'{c4_final,feasible}')::boolean,false) then continue; end if;
      v_gate:=public.c4_candidate_quality_gate_v2(v_alt_candidate,p_readiness,p_focus,p_target_region,p_zone_terms,p_inventory,p_max_complexity,p_policy_key);
      if not coalesce((v_gate->>'pass')::boolean,false) then continue; end if;
      v_fit:=coalesce((v_alt_candidate#>>'{c4_final,whole_wod_metrics,whole_wod_fit}')::numeric,0);
      if v_fit-v_original_fit<v_floor then continue; end if;
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
        'version','full-body-balance-v1','mode','ACTIVE','applied',false,
        'reason','NO_SAFE_PREPARATION_FOR_COMPLEMENT','before',v_before,'after',v_before
      ),true);
    end if;
    r:=public.c4_finalize_skill_path_preparation_metadata_v1(r);
  end if;
  r:=jsonb_set(r,'{architecture,full_body_balance}',jsonb_build_object(
    'version','full-body-balance-v1','mode','ACTIVE','applied',jsonb_array_length(v_moves)>0,
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
$$;

revoke all on function public.c4_full_body_region_v1(text,text,text) from public,anon,authenticated;
revoke all on function public.c4_full_body_exposure_v1(jsonb) from public,anon,authenticated;
revoke all on function public.c4_apply_full_body_balance_v1(uuid,jsonb,text,integer,text,text,text,text[],jsonb,integer,text,integer,text) from public,anon,authenticated;
grant execute on function public.c4_full_body_region_v1(text,text,text),
  public.c4_full_body_exposure_v1(jsonb),
  public.c4_apply_full_body_balance_v1(uuid,jsonb,text,integer,text,text,text,text[],jsonb,integer,text,integer,text) to service_role;

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

  r:=public.ugerod_finalize_environment_plan_v1(
    r,p_user_id,v_env,p_focus,p_duration_minutes,p_zone_terms,p_inventory,
    p_max_complexity,p_max_difficulty,
    null,
    false
  );

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
