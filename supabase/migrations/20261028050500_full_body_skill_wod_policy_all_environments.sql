-- Full Body balance is Skill + WOD only. Signature abs/gainage Tabata
-- stays independent. Warm-up is derived from the final exercise targets.
do $guard$
begin
  if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='c4_apply_full_body_balance_v1' and md5(pg_get_functiondef(p.oid))='4616347f4805c6f4d6f75be675191419') then
    raise exception 'Consumer changed: rebase c4_apply_full_body_balance_v1 first';
  end if;
  if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='c4_apply_preparation_quality_v3_pre_exercise_coherence_v1' and md5(pg_get_functiondef(p.oid))='043e1937500f203965b6c21d37180c96') then
    raise exception 'Consumer changed: rebase c4_apply_preparation_quality_v3_pre_exercise_coherence_v1 first';
  end if;
  if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='c4_full_body_exposure_v1' and md5(pg_get_functiondef(p.oid))='06c22dc7674f97a3cf487f7b0093ed1e') then
    raise exception 'Consumer changed: rebase c4_full_body_exposure_v1 first';
  end if;
  if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='gym_compile_strength_candidate_v1' and md5(pg_get_functiondef(p.oid))='2fa6c0076158dd3228762188c78fcf68') then
    raise exception 'Consumer changed: rebase gym_compile_strength_candidate_v1 first';
  end if;
  if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='gym_plan_session_v2' and md5(pg_get_functiondef(p.oid))='a86a051c50c40bcf449bd6a24ac846b9') then
    raise exception 'Consumer changed: rebase gym_plan_session_v2 first';
  end if;
  if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='outdoor_plan_session_v4' and md5(pg_get_functiondef(p.oid))='13d141ec28dfb7b9efc20022ca8158b0') then
    raise exception 'Consumer changed: rebase outdoor_plan_session_v4 first';
  end if;
  if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='c4_plan_full_session_v2' and md5(pg_get_functiondef(p.oid))='26cc608f5abfc75d2982ae67b8990cd2') then
    raise exception 'Consumer changed: rebase c4_plan_full_session_v2 first';
  end if;
end;
$guard$;

CREATE OR REPLACE FUNCTION public.c4_full_body_exposure_v1(p_blocks jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with items as (
    select public.c4_full_body_region_v1(e.movement_pattern,e.exercise_family,e.body_region) region,
      greatest(0,coalesce(nullif(b->>'duration_minutes','')::numeric,0))
        / greatest(1,jsonb_array_length(coalesce(b->'exercises','[]'::jsonb))) minutes,
      lower(b->>'block_key') block_key
    from jsonb_array_elements(coalesce(p_blocks,'[]'::jsonb)) b
    cross join lateral jsonb_array_elements(coalesce(b->'exercises','[]'::jsonb)) x
    left join public.exercises e on e.id=coalesce(x->>'exercise_id',x->>'id')
    where lower(b->>'block_key') in ('skill','wod','strength','gym','street_gym')
  ), regions as (
    select r.region,coalesce(sum(i.minutes),0) minutes,count(i.region) occurrences
    from (values ('Upper'),('Lower'),('Core')) r(region)
    left join items i on i.region=r.region group by r.region
  ), totals as (
    select sum(minutes) minutes,
      coalesce(sum(minutes) filter(where region='Upper'),0) upper_minutes,
      coalesce(sum(minutes) filter(where region='Lower'),0) lower_minutes,
      coalesce(sum(minutes) filter(where region='Core'),0) core_minutes from regions
  )
  select jsonb_build_object(
    'version','full-body-exposure-v2-skill-wod','scope','SKILL_WOD','core_quota_required',false,
    'regional_minutes', (select jsonb_object_agg(region,round(minutes,4)) from regions),
    'regional_occurrences', (select jsonb_object_agg(region,occurrences) from regions),
    'missing_regions',coalesce((select jsonb_agg(region order by region) from regions where region in ('Upper','Lower') and occurrences=0),'[]'::jsonb),
    'missing_count',(select count(*) from regions where region in ('Upper','Lower') and occurrences=0),
    -- A relative ranking, not a physiological load estimate or a hard quota.
    'imbalance',coalesce((select (power(upper_minutes-lower_minutes,2)+power(core_minutes,2))/nullif(power(minutes,2),0) from totals),0),
    'mixed_minutes',coalesce((select sum(minutes) from items where region='Mixed'),0),
    'tabata_counted',false,'warmup_unlock_counted',false,
    'semantics','block_time_exposure_proxy_not_active_work_or_muscle_load'
  );
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
    v_selected_ids:=coalesce(v_environment_blocked_ids,'{}'::text[]);
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
          where b->>'block_key' in ('tabata','tabata_abs','skill','wod','strength','gym','street_gym') and ex->>'exercise_id'=cp->>'exercise_id'
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

CREATE OR REPLACE FUNCTION public.gym_compile_strength_candidate_v1(p_user_id uuid, p_user_focus text, p_duration_minutes integer, p_strength_budget_minutes integer, p_readiness text, p_target_region text DEFAULT NULL::text, p_progression_intent text DEFAULT NULL::text, p_zone_terms text[] DEFAULT '{}'::text[], p_inventory jsonb DEFAULT '[]'::jsonb, p_max_complexity integer DEFAULT 3, p_max_difficulty text DEFAULT 'Intermédiaire'::text, p_candidate_count integer DEFAULT 20, p_execution_style text DEFAULT 'CLASSIC_SETS'::text, p_policy_key text DEFAULT 'c4-final-default'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  v_style jsonb;
  v_style_code text;
  v_target text;
  v_solver_focus text;
  v_c2 jsonb;
  v_stimulus jsonb;
  v_raw jsonb;
  v_compiled jsonb;
  v_accepted jsonb:='[]'::jsonb;
  v_rejected int:=0;
  v_selected jsonb;
  v_profile jsonb;
  v_cfg jsonb;
  v_delta numeric:=2.0;
  v_best_base numeric:=0;
  v_sets_count int:=0;
  v_gym_variant text;
  v_secondary_focus_enabled boolean:=false;
  v_selected_pattern_count int:=0;
  v_selected_family_count int:=0;
  v_balance_plan jsonb;
  v_balance_before jsonb;
  v_balance_after jsonb;
  v_recompiled jsonb;
  v_balance_diag jsonb;
  v_balance_adopted boolean:=false;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then
    raise exception 'Forbidden user';
  end if;

  v_style:=public.gym_resolve_execution_style_v1(p_execution_style);
  v_style_code:=coalesce(v_style->>'style_code','CLASSIC_SETS');

  v_target:=case
    when upper(coalesce(p_target_region,'')) in ('FULL BODY','FULL_BODY','CORPS ENTIER') then 'Full Body'
    when upper(coalesce(p_target_region,'')) in ('AUTOMATIQUE','AUTO') then null
    else p_target_region
  end;

  v_solver_focus:=coalesce(nullif(p_user_focus,''),'General Fitness');

  v_gym_variant:=case
    when coalesce(p_strength_budget_minutes,0) < 22 then 'GYM_SHORT'
    when coalesce(p_strength_budget_minutes,0) < 38 then 'GYM_STANDARD'
    else 'GYM_LONG'
  end;

  v_secondary_focus_enabled :=
    coalesce(p_strength_budget_minutes,0) >= 55
    and upper(coalesce(v_style_code,'CLASSIC_SETS')) <> 'CIRCUIT';

  v_c2:=public.simulate_session_engine_c2(
    p_user_id,v_solver_focus,p_duration_minutes,p_readiness,v_target,p_progression_intent,
    p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty,
    greatest(5,least(coalesce(p_candidate_count,20),6))
  );
  v_stimulus:=v_c2->'stimulus';

  select count(*)
  into v_sets_count
  from jsonb_array_elements(coalesce(v_c2->'candidate_sessions','[]'::jsonb)) x
  where x->>'mechanic'='SETS_REPS';

  if v_sets_count=0 then
    v_solver_focus:='Strength';
    v_c2:=public.simulate_session_engine_c2(
      p_user_id,v_solver_focus,p_duration_minutes,p_readiness,v_target,p_progression_intent,
      p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty,
      greatest(5,least(coalesce(p_candidate_count,20),6))
    );
    v_stimulus:=v_c2->'stimulus';
  end if;

  for v_raw in
    select value
    from jsonb_array_elements(coalesce(v_c2->'candidate_sessions','[]'::jsonb))
    where value->>'mechanic'='SETS_REPS'
  loop
    if upper(coalesce(v_style_code,'CLASSIC_SETS')) <> 'CIRCUIT' then
      v_raw:=jsonb_set(v_raw,'{variant_key}',to_jsonb(v_gym_variant),true);
    end if;

    v_compiled:=public.gym_compile_strength_candidate_item_v1(
      v_raw,p_user_id,v_solver_focus,p_duration_minutes,p_strength_budget_minutes,p_readiness,v_target,p_progression_intent,
      p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty,v_style_code,v_stimulus,p_policy_key
    );

    if v_compiled->>'status'='READY' then
      v_accepted:=v_accepted||jsonb_build_array(v_compiled);
    else
      v_rejected:=v_rejected+1;
    end if;
  end loop;

  if jsonb_array_length(v_accepted)=0 then
    return jsonb_build_object(
      'status','NO_SAFE_STRENGTH_CANDIDATE',
      'version','gym-strength-compiler-v4-duration-aware',
      'execution_style',v_style_code,
      'gym_composition_variant',v_gym_variant,
      'rejected_candidate_count',v_rejected,
      'solver_focus',v_solver_focus
    );
  end if;

  select config into v_cfg
  from public.session_engine_policy
  where policy_key=p_policy_key;

  v_delta:=coalesce((v_cfg#>>'{p2_variety,quality_band_delta}')::numeric,2.0);

  select max(coalesce(nullif(x->>'base_quality','')::numeric,0))
  into v_best_base
  from jsonb_array_elements(v_accepted) x;

  with eligible as (
    select
      x,
      public.c4_full_body_exposure_v1(jsonb_build_array(jsonb_build_object(
        'block_key','strength','duration_minutes',p_strength_budget_minutes,'exercises',x#>'{candidate,exercises}'
      ))) full_body_exposure,
      coalesce(nullif(x->>'base_quality','')::numeric,0) as base_quality,
      public.exercise_preference_candidate_profile_v1(p_user_id,x->'candidate','GYM') as profile,
      coalesce(nullif(x#>>'{candidate,gym_real_duration_estimate,estimated_utilization_percent}','')::numeric,0) as duration_utilization,
      coalesce(x#>>'{candidate,gym_real_duration_estimate,status}','UNKNOWN') as duration_status,
      (
        select count(*)
        from jsonb_array_elements(coalesce(x#>'{candidate,exercises}','[]'::jsonb)) ex
        join public.exercises e on e.id=ex->>'exercise_id'
        where 'load'=any(coalesce(e.tracking_modes,'{}'::text[]))
      ) as gym_load_count,
      (
        select count(*)
        from jsonb_array_elements(coalesce(x#>'{candidate,exercises}','[]'::jsonb)) ex
        join public.exercises e on e.id=ex->>'exercise_id'
        where coalesce(e.equipment_requirement,'none')='required'
      ) as gym_equipment_count,
      (
        select count(*)
        from jsonb_array_elements(coalesce(x#>'{candidate,exercises}','[]'::jsonb)) ex
        where coalesce(ex#>>'{components,environment_leverage,tier}','NEUTRAL') in ('NATIVE','ENHANCED')
      ) as gym_environment_leveraged_count,
      (
        select count(distinct coalesce(ex->>'pattern',''))
        from jsonb_array_elements(coalesce(x#>'{candidate,exercises}','[]'::jsonb)) ex
        where nullif(ex->>'pattern','') is not null
      ) as distinct_pattern_count,
      (
        select count(distinct coalesce(ex->>'family',''))
        from jsonb_array_elements(coalesce(x#>'{candidate,exercises}','[]'::jsonb)) ex
        where nullif(ex->>'family','') is not null
      ) as distinct_family_count
    from jsonb_array_elements(v_accepted) x
    where coalesce(nullif(x->>'base_quality','')::numeric,0)>=coalesce(v_best_base,0)-v_delta
  )
  select e.x,e.profile,e.distinct_pattern_count,e.distinct_family_count
  into v_selected,v_profile,v_selected_pattern_count,v_selected_family_count
  from eligible e
  order by
    case when v_target='Full Body' then (e.full_body_exposure->>'missing_count')::int else 0 end,
    case when v_target='Full Body' then (e.full_body_exposure->>'imbalance')::numeric else 0 end,
    coalesce((e.profile->>'depreferred')::boolean,false) asc,
    case e.duration_status
      when 'ON_TARGET' then 0
      when 'UNDERFILLED' then 1
      when 'OVERFILLED' then 2
      else 3
    end asc,
    case
      when e.duration_status='ON_TARGET' then abs(e.duration_utilization-92)
      when e.duration_status='UNDERFILLED' then -e.duration_utilization
      else e.duration_utilization
    end asc,
    case when v_secondary_focus_enabled then e.distinct_pattern_count else 0 end desc,
    case when v_secondary_focus_enabled then e.distinct_family_count else 0 end desc,
    e.gym_environment_leveraged_count desc,
    e.gym_load_count desc,
    e.gym_equipment_count desc,
    coalesce((e.profile->>'favorite_count')::int,0) desc,
    coalesce((e.profile->>'often_chosen_count')::int,0) desc,
    e.base_quality desc,
    coalesce(nullif(e.x#>>'{candidate,c4_anti_redundancy,score}','')::numeric,100) desc
  limit 1;

  if v_target='Full Body' then
    v_balance_before:=public.c4_full_body_exposure_v1(jsonb_build_array(jsonb_build_object(
      'block_key','strength','duration_minutes',p_strength_budget_minutes,'exercises',v_selected#>'{candidate,exercises}'
    )));
    v_balance_plan:=public.c4_apply_full_body_balance_v1(
      p_user_id,jsonb_build_object(
        'status','READY','stimulus',v_stimulus,'architecture','{}'::jsonb,
        'selected_candidate',v_selected->'candidate',
        'blocks',jsonb_build_array(jsonb_build_object('block_key','wod','duration_minutes',p_strength_budget_minutes,
          'mechanic',v_selected#>>'{candidate,mechanic}','exercises',v_selected#>'{candidate,exercises}'))
      ),v_solver_focus,p_duration_minutes,p_readiness,'Full Body',p_progression_intent,
      p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty,p_candidate_count,p_policy_key
    );
    if v_balance_plan->>'status'='READY'
       and coalesce((v_balance_plan#>>'{architecture,full_body_balance,applied}')::boolean,false) then
      v_recompiled:=public.gym_compile_strength_candidate_item_v1(
        v_balance_plan->'selected_candidate',p_user_id,v_solver_focus,p_duration_minutes,p_strength_budget_minutes,
        p_readiness,v_target,p_progression_intent,p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty,
        v_style_code,v_stimulus,p_policy_key
      );
      v_balance_after:=public.c4_full_body_exposure_v1(jsonb_build_array(jsonb_build_object(
        'block_key','strength','duration_minutes',p_strength_budget_minutes,'exercises',v_recompiled#>'{candidate,exercises}'
      )));
      if v_recompiled->>'status'='READY'
         and (v_balance_after->>'missing_count')::int<=(v_balance_before->>'missing_count')::int
         and ((v_balance_after->>'missing_count')::int<(v_balance_before->>'missing_count')::int
              or (v_balance_after->>'imbalance')::numeric<=(v_balance_before->>'imbalance')::numeric+0.0001) then
        v_selected:=v_recompiled;
        v_balance_adopted:=true;
        v_profile:=public.exercise_preference_candidate_profile_v1(p_user_id,v_selected->'candidate','GYM');
      end if;
    end if;
    v_balance_after:=public.c4_full_body_exposure_v1(jsonb_build_array(jsonb_build_object(
      'block_key','strength','duration_minutes',p_strength_budget_minutes,'exercises',v_selected#>'{candidate,exercises}'
    )));
    v_balance_diag:=jsonb_build_object('version','full-body-balance-v2-skill-wod','scope','SKILL_WOD',
      'mode','ACTIVE','source','GYM_STRENGTH_COMPILER','applied',v_balance_adopted,
      'before',v_balance_before,'after',v_balance_after,'tabata_independent',true,
      'gym_style_recompiled',v_balance_adopted,'existing_quality_and_duration_gates_preserved',true);
  end if;

  return jsonb_build_object(
    'status','READY',
    'version','gym-strength-compiler-v4-duration-aware',
    'execution_style',v_style_code,
    'style',v_style,
    'gym_composition_variant',v_gym_variant,
    'solver_focus',v_solver_focus,
    'user_focus',p_user_focus,
    'focus_fallback_used',v_solver_focus<>coalesce(nullif(p_user_focus,''),'General Fitness'),
    'stimulus',v_stimulus,
    'candidate',v_selected->'candidate',
    'full_body_balance',v_balance_diag,
    'quality_gate',v_selected->'quality_gate',
    'real_duration_estimate',v_selected#>'{candidate,gym_real_duration_estimate}',
    'accepted_candidate_count',jsonb_array_length(v_accepted),
    'rejected_candidate_count',v_rejected,
    'secondary_focus_policy',jsonb_build_object(
      'enabled',v_secondary_focus_enabled,
      'activation_strength_budget_minutes',55,
      'selection_mode',case when v_secondary_focus_enabled then 'DIVERSITY_TIEBREAK_WITHIN_QUALITY_BAND' else 'DISABLED' end,
      'distinct_pattern_count',v_selected_pattern_count,
      'distinct_family_count',v_selected_family_count,
      'does_not_override_hard_gates',true,
      'does_not_force_named_muscle_groups',true
    ),
    'exercise_preference_policy',jsonb_build_object(
      'consulted',true,
      'profile',v_profile,
      'quality_band_delta',v_delta,
      'gym_environment_leverage_tiebreak',true,
      'gym_load_use_tiebreak',true,
      'gym_equipment_use_tiebreak',true,
      'real_duration_tiebreak',true,
      'soft_lexicographic_tiebreak_only',true,
      'no_numeric_preference_weight',true,
      'all_candidates_passed_quality_gate_before_preference',true,
      'preference_does_not_change_mastery',true
    )
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.gym_plan_session_v2(p_user_id uuid, p_user_focus text, p_duration_minutes integer, p_readiness text, p_target_region text DEFAULT NULL::text, p_progression_intent text DEFAULT NULL::text, p_zone_terms text[] DEFAULT '{}'::text[], p_inventory jsonb DEFAULT '[]'::jsonb, p_format_code text DEFAULT 'GYM_BALANCED'::text, p_execution_style text DEFAULT 'CLASSIC_SETS'::text, p_max_complexity integer DEFAULT 3, p_max_difficulty text DEFAULT 'Intermédiaire'::text, p_candidate_count integer DEFAULT 20, p_policy_key text DEFAULT 'c4-final-default'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  v_core_minutes int:=greatest(20,p_duration_minutes-4);
  v_authority jsonb;
  v_domain_for_today text;
  r jsonb;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then
    raise exception 'Forbidden user';
  end if;

  perform set_config('ugerod.session_environment','GYM',true);

  v_authority:=public.ugerod_session_authority_context_v1(
    p_user_id,p_user_focus,p_duration_minutes,p_readiness,
    p_progression_intent,p_target_region,p_zone_terms
  );

  v_domain_for_today:=case
    when coalesce((v_authority->>'evolution_domain_aligned_today')::boolean,false)
      then nullif(v_authority->>'evolution_domain','')
    else null
  end;

  perform set_config(
    'ugerod.resolved_session_intent',
    coalesce(v_authority->>'resolved_session_intent','CLASSIC'),
    true
  );
  perform set_config(
    'ugerod.base_training_intent',
    coalesce(v_authority->>'base_training_intent','CLASSIC'),
    true
  );
  perform set_config(
    'ugerod.aligned_evolution_domain',
    coalesce(v_domain_for_today,''),
    true
  );
  perform set_config(
    'ugerod.session_role',
    coalesce(v_authority->>'session_role',''),
    true
  );

  r:=public.gym_plan_session_v1(
    p_user_id,p_user_focus,v_core_minutes,p_readiness,p_target_region,p_progression_intent,
    p_zone_terms,p_inventory,p_format_code,p_execution_style,p_max_complexity,
    p_max_difficulty,p_candidate_count,p_policy_key
  );

  r:=r||jsonb_build_object(
    'authority_context',v_authority,
    'version','gym-session-plan-v3-program-coach-authority',
    'requested_session_minutes',p_duration_minutes,
    'planner_budget_minutes',v_core_minutes,
    'signature_reserved_minutes',4
  );

  if coalesce(r->>'status','')<>'READY' then
    return r;
  end if;

  if p_target_region='Full Body' then
    r:=r||jsonb_build_object('architecture',coalesce(r->'architecture','{}'::jsonb)||jsonb_build_object(
      'full_body_balance',jsonb_build_object('version','full-body-balance-v2-skill-wod','scope','SKILL_WOD',
        'mode','ACTIVE','source','GYM_STRENGTH_COMPILER','tabata_independent',true,
        'after',public.c4_full_body_exposure_v1(r->'blocks'))
    ));
  end if;

  r:=public.ugerod_finalize_environment_plan_v1(
    r,p_user_id,'GYM',p_user_focus,p_duration_minutes,p_zone_terms,p_inventory,
    p_max_complexity,p_max_difficulty,null,true
  );

  return r||jsonb_build_object(
    'version','gym-session-plan-v3-program-coach-authority',
    'requested_session_minutes',p_duration_minutes,
    'planner_budget_minutes',v_core_minutes,
    'signature_reserved_minutes',4,
    'signature_rule','UGEROD_CORE_TABATA_EVERY_SESSION',
    'goal_focus_is_not_session_intent',true
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.outdoor_plan_session_v4(p_user_id uuid, p_duration_minutes integer DEFAULT 45, p_readiness text DEFAULT 'normal'::text, p_focus text DEFAULT 'Conditioning'::text, p_target_region text DEFAULT 'Full Body'::text, p_progression_intent text DEFAULT 'MAINTAIN'::text, p_zone_terms text[] DEFAULT '{}'::text[], p_inventory jsonb DEFAULT '[]'::jsonb, p_place_code text DEFAULT NULL::text, p_surface_code text DEFAULT NULL::text, p_format_code text DEFAULT NULL::text, p_reliable_distance boolean DEFAULT false, p_running_allowed boolean DEFAULT true, p_calibration_opportunity boolean DEFAULT false, p_max_complexity integer DEFAULT 3, p_max_difficulty text DEFAULT 'Intermédiaire'::text, p_candidate_count integer DEFAULT 16)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  v_core_minutes int:=greatest(20,p_duration_minutes-4);
  v_requested_format text:=upper(coalesce(nullif(trim(p_format_code),''),'OUTDOOR_CONDITIONING'));
  v_effective_format text;
  v_authority jsonb;
  v_session_intent text;
  v_base_intent text;
  v_effective_intent text;
  v_domain_for_today text;
  r jsonb;
  v_surface text;
  v_targets jsonb;
  v_street jsonb;
  v_street_minutes int:=0;
  v_conditioning jsonb;
  v_conditioning_minutes int:=0;
  v_new_conditioning_minutes int:=0;
  v_family jsonb;
  v_compiled jsonb;
  v_blocks jsonb:='[]'::jsonb;
  v_block jsonb;
  v_planned int:=0;
  v_support_cap int:=0;
  v_balance_wod jsonb;
  v_balance_stimulus jsonb;
  v_balance_candidate jsonb;
  v_balance_plan jsonb;
  v_balance_diag jsonb;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then
    raise exception 'Forbidden user';
  end if;

  perform set_config('ugerod.session_environment','OUTDOOR',true);
  perform set_config(
    'ugerod.session_surface',
    coalesce(public.normalize_session_surface_v1(p_surface_code),''),
    true
  );

  v_authority:=public.ugerod_session_authority_context_v1(
    p_user_id,p_focus,p_duration_minutes,p_readiness,
    p_progression_intent,p_target_region,p_zone_terms
  );

  v_session_intent:=upper(coalesce(
    v_authority->>'resolved_session_intent','CLASSIC'
  ));
  v_base_intent:=upper(coalesce(
    v_authority->>'base_training_intent','CLASSIC'
  ));
  v_effective_intent:=case
    when v_session_intent='CONSOLIDATE' then v_base_intent
    else v_session_intent
  end;
  v_domain_for_today:=case
    when coalesce((v_authority->>'evolution_domain_aligned_today')::boolean,false)
      then nullif(v_authority->>'evolution_domain','')
    else null
  end;

  perform set_config('ugerod.resolved_session_intent',v_session_intent,true);
  perform set_config('ugerod.base_training_intent',v_base_intent,true);
  perform set_config('ugerod.aligned_evolution_domain',coalesce(v_domain_for_today,''),true);
  perform set_config('ugerod.session_role',coalesce(v_authority->>'session_role',''),true);

  v_effective_format:=case
    when v_requested_format in ('OUTDOOR_CONDITIONING','OUTDOOR_CONDITIONING_GYM')
      and (v_effective_intent='STRENGTH_QUALITY' or upper(coalesce(v_domain_for_today,''))='HALTERO')
      then 'OUTDOOR_CONDITIONING_WOD'
    when v_requested_format='OUTDOOR_CONDITIONING'
      and v_effective_intent='SKILL_DEVELOPMENT'
      then 'OUTDOOR_CONDITIONING_WOD'
    else v_requested_format
  end;

  r:=public.outdoor_plan_session_v3(
    p_user_id,v_core_minutes,p_readiness,p_focus,p_target_region,p_progression_intent,
    p_zone_terms,p_inventory,p_place_code,p_surface_code,v_effective_format,p_reliable_distance,
    p_running_allowed,p_calibration_opportunity,p_max_complexity,p_max_difficulty,p_candidate_count
  );

  r:=r||jsonb_build_object(
    'authority_context',v_authority,
    'requested_session_minutes',p_duration_minutes,
    'planner_budget_minutes',v_core_minutes,
    'signature_reserved_minutes',4,
    'requested_format_code',v_requested_format,
    'effective_format_code',v_effective_format,
    'version','outdoor-planner-v5.1-program-coach-authority'
  );

  if coalesce(r->>'status','')<>'READY' then
    return r;
  end if;

  v_surface:=coalesce(
    r#>>'{place_context,effective_surface_code}',
    public.normalize_session_surface_v1(p_surface_code)
  );

  -- A non-conditioning intent must not turn all spare Outdoor time into
  -- conditioning. Reuse the existing canonical WOD target as the support cap;
  -- remaining time may stay as legitimate session buffer.
  if v_effective_format='OUTDOOR_CONDITIONING_WOD'
     and v_effective_intent<>'CONDITIONING'
  then
    v_targets:=public.c4_session_architecture_targets_v2(
      p_duration_minutes,'c4-final-default'
    );
    v_support_cap:=greatest(
      8,
      coalesce((v_targets->>'wod_target_minutes')::int,8)
    );

    select b into v_conditioning
    from jsonb_array_elements(coalesce(r->'blocks','[]'::jsonb)) b
    where b->>'block_key'='conditioning'
    limit 1;

    v_conditioning_minutes:=coalesce(
      nullif(v_conditioning->>'duration_minutes','')::int,0
    );

    if v_conditioning is not null
       and v_conditioning_minutes>v_support_cap
    then
      v_family:=coalesce(r->'running_family_opportunity','{}'::jsonb);
      if v_family->>'status'='FAMILY_SELECTED' then
        v_compiled:=public.outdoor_compile_running_block_v1(
          v_family,v_support_cap,p_reliable_distance
        );
      else
        v_compiled:='{}'::jsonb;
      end if;

      if v_compiled->>'status'='READY' then
        v_conditioning:=v_compiled-'status';
      else
        v_conditioning:=v_conditioning||jsonb_build_object(
          'duration_minutes',v_support_cap
        );
      end if;

      v_blocks:='[]'::jsonb;
      for v_block in
        select value from jsonb_array_elements(coalesce(r->'blocks','[]'::jsonb))
      loop
        if v_block->>'block_key'='conditioning' then
          v_blocks:=v_blocks||jsonb_build_array(v_conditioning);
        else
          v_blocks:=v_blocks||jsonb_build_array(v_block);
        end if;
      end loop;

      r:=r||jsonb_build_object('blocks',v_blocks);
      select coalesce(sum(coalesce((b->>'duration_minutes')::int,0)),0)
      into v_planned
      from jsonb_array_elements(v_blocks) b;

      r:=jsonb_set(r,'{architecture,conditioning_minutes}',to_jsonb(v_support_cap),true);
      r:=jsonb_set(r,'{architecture,planned_minutes}',to_jsonb(v_planned),true);
      r:=jsonb_set(r,'{architecture,conditioning_support_cap}',jsonb_build_object(
        'version','outdoor-conditioning-support-cap-v1',
        'applied',true,
        'source','c4_session_architecture_targets_v2.wod_target_minutes',
        'before_minutes',v_conditioning_minutes,
        'after_minutes',v_support_cap,
        'spare_time_can_remain_buffer',true,
        'no_new_numeric_threshold',true
      ),true);
    end if;

    v_blocks:='[]'::jsonb;
    v_conditioning:=null;
    v_conditioning_minutes:=0;
  end if;

  -- For a resolved Strength-quality session, explicit street equipment can
  -- support the primary WOD without becoming a second progression authority.
  if v_effective_format='OUTDOOR_CONDITIONING_WOD'
     and (v_effective_intent='STRENGTH_QUALITY' or upper(coalesce(v_domain_for_today,''))='HALTERO')
  then
    v_targets:=public.c4_session_architecture_targets_v2(
      p_duration_minutes,'c4-final-default'
    );

    v_street:=public.outdoor_build_street_gym_block_v1(
      p_user_id,p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty,
      greatest(4,coalesce((v_targets->>'skill_target_minutes')::int,8)),
      p_progression_intent
    );

    if v_street->>'status'='READY' then
      v_street_minutes:=coalesce((v_street->>'duration_minutes')::int,0);

      select b into v_conditioning
      from jsonb_array_elements(coalesce(r->'blocks','[]'::jsonb)) b
      where b->>'block_key'='conditioning'
      limit 1;

      v_conditioning_minutes:=coalesce(
        nullif(v_conditioning->>'duration_minutes','')::int,0
      );

      if v_conditioning is not null
         and v_street_minutes>0
         and v_conditioning_minutes-v_street_minutes>=8
      then
        v_new_conditioning_minutes:=v_conditioning_minutes-v_street_minutes;
        v_family:=coalesce(r->'running_family_opportunity','{}'::jsonb);

        if v_family->>'status'='FAMILY_SELECTED' then
          v_compiled:=public.outdoor_compile_running_block_v1(
            v_family,v_new_conditioning_minutes,p_reliable_distance
          );
        else
          v_compiled:='{}'::jsonb;
        end if;

        if v_compiled->>'status'='READY' then
          v_conditioning:=v_compiled-'status';
        else
          v_conditioning:=v_conditioning||jsonb_build_object(
            'duration_minutes',v_new_conditioning_minutes
          );
        end if;

        for v_block in
          select value from jsonb_array_elements(coalesce(r->'blocks','[]'::jsonb))
        loop
          if v_block->>'block_key'='unlock' then
            v_blocks:=v_blocks||jsonb_build_array(v_block);
            v_blocks:=v_blocks||jsonb_build_array(
              (v_street-'status')||jsonb_build_object(
                'support_reason','EXPLICIT_STREET_EQUIPMENT_SUPPORTS_PRIMARY_INTENT',
                'intent_support',true
              )
            );
          elsif v_block->>'block_key'='conditioning' then
            v_blocks:=v_blocks||jsonb_build_array(v_conditioning);
          else
            v_blocks:=v_blocks||jsonb_build_array(v_block);
          end if;
        end loop;

        r:=r||jsonb_build_object('blocks',v_blocks);

        select coalesce(sum(coalesce((b->>'duration_minutes')::int,0)),0)
        into v_planned
        from jsonb_array_elements(v_blocks) b;

        r:=jsonb_set(r,'{architecture,conditioning_minutes}',to_jsonb(v_new_conditioning_minutes),true);
        r:=jsonb_set(r,'{architecture,planned_minutes}',to_jsonb(v_planned),true);
        r:=jsonb_set(r,'{architecture,street_intent_support}',jsonb_build_object(
          'version','outdoor-strength-street-support-v2-resolved-intent',
          'applied',true,
          'street_minutes',v_street_minutes,
          'conditioning_minutes_before',v_conditioning_minutes,
          'conditioning_minutes_after',v_new_conditioning_minutes,
          'minutes_reallocated_not_added',true,
          'selection_uses_existing_skill_path',true
        ),true);
      end if;
    end if;
  end if;

  -- Outdoor assembles its actual Skill/street block after the C4 reference.
  -- Complement that final selection, without changing the running protocol.
  if p_target_region='Full Body' then
    select b into v_balance_wod from jsonb_array_elements(r->'blocks') b
      where b->>'block_key'='wod' limit 1;
    if v_balance_wod is not null then
      v_balance_stimulus:=public.build_session_stimulus_target(
        p_focus,greatest(20,least(90,p_duration_minutes)),p_readiness,'Full Body',p_progression_intent,'c1-default');
      v_balance_candidate:=public.c4_finalize_candidate(jsonb_build_object(
        'mechanic',v_balance_wod->>'mechanic','variant_key',v_balance_wod->>'variant_key',
        'exercises',v_balance_wod->'exercises',
        'c4_runtime_context',jsonb_build_object('user_id',p_user_id,'focus',p_focus,'readiness',p_readiness,
          'target_region','Full Body','duration_minutes',p_duration_minutes,'progression_intent',p_progression_intent)
      ),v_balance_stimulus,p_duration_minutes,(v_balance_wod->>'duration_minutes')::int,'c4-final-default','c3-sim-default');
      v_balance_plan:=public.c4_apply_full_body_balance_v1(
        p_user_id,r||jsonb_build_object('stimulus',v_balance_stimulus,'selected_candidate',v_balance_candidate),
        p_focus,p_duration_minutes,p_readiness,'Full Body',p_progression_intent,
        p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty,p_candidate_count,'c4-final-default');
      if v_balance_plan->>'status'='READY'
         and coalesce((v_balance_plan#>>'{architecture,full_body_balance,applied}')::boolean,false) then
        select jsonb_agg(case when b->>'block_key'='wod' then
          (select x from jsonb_array_elements(v_balance_plan->'blocks') x where x->>'block_key'='wod' limit 1)
          else b end order by ord) into v_blocks
        from jsonb_array_elements(r->'blocks') with ordinality x(b,ord);
        r:=r||jsonb_build_object('blocks',v_blocks);
      end if;
      v_balance_diag:=coalesce(v_balance_plan#>'{architecture,full_body_balance}','{}'::jsonb)
        ||jsonb_build_object('version','full-body-balance-v2-skill-wod','scope','SKILL_WOD','mode','ACTIVE',
          'source','FINAL_OUTDOOR_SKILL_WOD','tabata_independent',true,
          'after',public.c4_full_body_exposure_v1(r->'blocks'));
    else
      v_balance_diag:=jsonb_build_object('version','full-body-balance-v2-skill-wod','scope','SKILL_WOD',
        'mode','NOT_APPLICABLE','reason','NO_FUNCTIONAL_WOD_IN_SELECTED_RUNNING_FORMAT','tabata_independent',true);
    end if;
    r:=r||jsonb_build_object('architecture',coalesce(r->'architecture','{}'::jsonb)
      ||jsonb_build_object('full_body_balance',v_balance_diag));
  end if;

  r:=public.ugerod_finalize_environment_plan_v1(
    r,p_user_id,'OUTDOOR',p_focus,p_duration_minutes,p_zone_terms,p_inventory,
    p_max_complexity,p_max_difficulty,v_surface,true
  );

  return r||jsonb_build_object(
    'version','outdoor-planner-v5.1-program-coach-authority',
    'requested_session_minutes',p_duration_minutes,
    'planner_budget_minutes',v_core_minutes,
    'signature_reserved_minutes',4,
    'signature_rule','UGEROD_CORE_TABATA_EVERY_SESSION',
    'requested_format_code',v_requested_format,
    'effective_format_code',v_effective_format,
    'intent_format_alignment',jsonb_build_object(
      'version','outdoor-intent-format-alignment-v3-program-coach',
      'goal_focus',p_focus,
      'resolved_session_intent',v_session_intent,
      'base_training_intent',v_base_intent,
      'effective_training_intent',v_effective_intent,
      'aligned_evolution_domain',v_domain_for_today,
      'requested_format',v_requested_format,
      'effective_format',v_effective_format,
      'conditioning_remains_available_as_support',true,
      'street_equipment_remains_available_to_c4',true,
      'environment_changes_execution_not_exercise_duration',true,
      'focus_not_used_as_session_intent',true
    )
  );
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
