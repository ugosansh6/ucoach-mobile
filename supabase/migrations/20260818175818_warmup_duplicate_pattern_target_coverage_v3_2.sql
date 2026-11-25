do $$
declare
  v_oid oid;
  v_sql text;
  v_old text;
  v_new text;
begin
  select p.oid into v_oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.prokind='f' and p.proname='c4_apply_preparation_quality_v3' limit 1;
  if v_oid is null then raise exception 'c4_apply_preparation_quality_v3 not found'; end if;
  v_sql:=pg_get_functiondef(v_oid);

  v_old:=$old$  v_prepared_patterns text[]:='{}'::text[];
  v_family_key text;$old$;
  v_new:=$new$  v_prepared_patterns text[]:='{}'::text[];
  v_prepared_target_ids text[]:='{}'::text[];
  v_family_key text;$new$;
  if position(v_old in v_sql)=0 then raise exception 'declaration fragment missing'; end if;
  v_sql:=replace(v_sql,v_old,v_new);

  v_old:=$old$    else
      v_prepared_patterns:='{}'::text[];
      v_rounds:=3;$old$;
  v_new:=$new$    else
      v_prepared_patterns:='{}'::text[];
      v_prepared_target_ids:='{}'::text[];
      v_rounds:=3;$new$;
  if position(v_old in v_sql)=0 then raise exception 'warmup init fragment missing'; end if;
  v_sql:=replace(v_sql,v_old,v_new);

  v_old:=$old$        v_selected_ids:=array_append(v_selected_ids,rec.id);
        if target_rec.movement_pattern is not null then v_prepared_patterns:=array_append(v_prepared_patterns,target_rec.movement_pattern); end if;
      end loop;

      -- Pass 2: if the architecture asks for more movements than distinct targets, add a safe low-fatigue movement prep.$old$;
  v_new:=$new$        v_selected_ids:=array_append(v_selected_ids,rec.id);
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
          'pain_gate',true,'equipment_gate',true,'warmup_rounds',v_rounds,
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

      -- Pass 3: if the architecture still asks for more movements, add a safe low-fatigue movement prep.$new$;
  if position(v_old in v_sql)=0 then raise exception 'pass insertion fragment missing'; end if;
  v_sql:=replace(v_sql,v_old,v_new);

  execute v_sql;
end $$;