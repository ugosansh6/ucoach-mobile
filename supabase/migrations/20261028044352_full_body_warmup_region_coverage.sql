-- Full Body warm-up must prepare the final WOD regions before duplicating
-- core preparation for two different patterns within one Skill curriculum.
do $guard$
begin
  if md5(pg_get_functiondef('public.c4_apply_preparation_quality_v3_pre_exercise_coherence_v1(uuid,jsonb,text[],jsonb,text,integer,text)'::regprocedure))<>'62ffd377aec73ca22df13ad0db5835b6' then
    raise exception 'Preparation consumer changed: rebase Full Body coverage first';
  end if;
end;
$guard$;
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
  v_prepared_regions text[]:='{}'::text[];
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
      v_prepared_regions:='{}'::text[];
      v_prepared_target_ids:='{}'::text[];
      v_rounds:=3;
      v_alloc_total:=greatest(30,v_total_sec/v_count);
      v_per_round_sec:=greatest(10,v_alloc_total/v_rounds);

      -- Full Body: prepare distinct regions, WOD first, before spending a
      -- second slot on another core pattern from the same Skill curriculum.
      -- Explicit regional sessions retain the existing Skill-first ordering.
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
                 raw.target_id,raw.target_block,e.movement_pattern,e.exercise_family,e.body_region,e.technical_complexity,e.fatigue_score,raw.bord,raw.eord
          from raw join public.exercises e on e.id=raw.target_id
          order by raw.target_id,case when raw.target_block='skill' then 0 else 1 end,raw.bord,raw.eord
        )
        select dedup.*,
          case when exercise_family='Core' or movement_pattern in ('Core','Anti-Extension','Anti-Rotation','Rotation') then 'Core'
               when movement_pattern in ('Squat','Hinge','Lunge','Step','Jump') or exercise_family in ('Squat','Hinge','Lunge','Jump') then 'Lower'
               when exercise_family in ('Push','Pull') then 'Upper'
               else body_region end preparation_region
        from dedup
        order by case when p_target_region='Full Body'
                      then case when target_block='wod' then 0 else 1 end
                      else case when target_block='skill' then 0 else 1 end end,
                 coalesce(technical_complexity,0) desc,
                 coalesce(fatigue_score,0) desc,
                 bord,eord,target_id
      loop
        exit when jsonb_array_length(v_new)>=v_count;
        if p_target_region='Full Body'
           and target_rec.preparation_region in ('Upper','Lower','Core')
           and target_rec.preparation_region=any(v_prepared_regions) then
          continue;
        end if;
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
        if target_rec.preparation_region is not null then v_prepared_regions:=array_append(v_prepared_regions,target_rec.preparation_region); end if;
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
            'full_body_region_coverage_first',p_target_region='Full Body',
            'prepared_regions_first_pass',to_jsonb(v_prepared_regions),
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
