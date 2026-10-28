-- Count both sides before fitting unilateral Skill work into its time budget.
do $guard$ begin
if md5(pg_get_functiondef('public.skill_curriculum_duration_fit_v1(text,text,jsonb,integer,integer)'::regprocedure))<>'52483af86baec0b9a8bc7b6497879b7f' then raise exception 'Unexpected Skill duration baseline'; end if;
end $guard$;
update public.exercises set prescription_type='reps_unilateral',movement_side='Unilateral' where id='EX478' and lower(movement_side)='unilateral' and prescription_type='reps_standard';
CREATE OR REPLACE FUNCTION public.skill_curriculum_duration_fit_v1(p_exercise_id text, p_role text, p_current jsonb, p_allocated_duration_seconds integer, p_lesson_count integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare
  r jsonb := coalesce(p_current,'{}'::jsonb);
  v_role text := upper(coalesce(p_role,p_current->>'curriculum_role','FOUNDATION'));
  v_alloc integer := greatest(60,coalesce(p_allocated_duration_seconds,60));
  v_lesson_count integer := greatest(1,coalesce(p_lesson_count,1));
  v_original_sets integer := greatest(1,coalesce(nullif(p_current->>'sets','')::integer,1));
  v_sets integer;
  v_max_sets integer;
  v_rest integer := greatest(30,least(coalesce(nullif(p_current->>'rest_between_sets_seconds','')::integer,60),90));
  v_setup integer;
  v_buffer integer;
  v_fit_limit integer;
  v_predicted integer := 0;
  v_original_units integer := 0;
  v_units integer := 0;
  v_capped_units integer := 0;
  v_min_units integer := 1;
  v_seconds_per_unit integer := 3;
  v_side_multiplier integer := case when p_current->>'reps_semantics'='per_side' then 2 else 1 end;
  v_is_time boolean := false;
  v_is_attempts boolean := false;
  v_is_slow_technical boolean := false;
  v_descriptor text;
  v_adjusted boolean := false;
  v_status text := 'FIT';
begin
  v_descriptor := lower(concat_ws(' ',
    coalesce(p_exercise_id,''),
    coalesce(r->>'prescription_type',''),
    coalesce(r->>'curriculum_prescription_kind',''),
    coalesce(r->>'curriculum_stage',''),
    coalesce(r->>'curriculum_learning_objective',''),
    coalesce(r->>'curriculum_coach_focus','')
  ));

  v_is_time := coalesce(r->>'prescription_type','') in ('time_hold','isometric_hold')
    or (
      jsonb_typeof(r->'tracking_modes')='array'
      and (r->'tracking_modes') ? 'time'
      and not ((r->'tracking_modes') ? 'reps')
    );
  v_is_attempts := r ? 'quality_attempts_min' or r ? 'quality_attempts_max';
  -- Slow eccentric work needs more time per repetition. Generic coaching words
  -- such as "contrôlé" must not classify every technical movement as eccentric.
  v_is_slow_technical := v_descriptor ~ '(négat|negat|eccentr|descente|tempo)';

  v_setup := case when v_role='TARGET' then 20 else 15 end;
  v_buffer := greatest(10,floor(v_alloc*0.10)::integer);
  v_fit_limit := greatest(30,v_alloc-v_buffer);

  v_max_sets := case
    when v_is_attempts then 1
    -- Short timed holds remain inexpensive enough to repeat three times.
    -- Rep-based supporting drills are capped at two sets in a 3+ drill lesson.
    when v_lesson_count>=3
      and v_role in ('FOUNDATION','COMPANION','TRANSFER')
      and not v_is_time then 2
    else 3
  end;
  v_sets := greatest(1,least(v_original_sets,v_max_sets));

  if v_is_time then
    v_original_units := coalesce(
      nullif(r->>'execution_target_duration_seconds','')::integer,
      nullif(r->>'duration_seconds_max','')::integer,
      nullif(r->>'duration_seconds_min','')::integer,
      case
        when nullif(r->>'execution_target_reps','') is not null
          then greatest(10,least((r->>'execution_target_reps')::integer*2,30))
        else 20
      end
    );
    v_units := greatest(10,least(v_original_units,45));
    v_capped_units := v_units;
    v_min_units := 10;

    v_predicted := v_setup + v_sets*v_units + greatest(0,v_sets-1)*v_rest;
    while v_predicted>v_fit_limit and v_units>v_min_units loop
      v_units := greatest(v_min_units,v_units-5);
      v_predicted := v_setup + v_sets*v_units + greatest(0,v_sets-1)*v_rest;
    end loop;
    while v_predicted>v_fit_limit and v_sets>1 loop
      v_sets := v_sets-1;
      v_predicted := v_setup + v_sets*v_units + greatest(0,v_sets-1)*v_rest;
    end loop;
    while v_units<v_capped_units
      and v_setup + v_sets*least(v_capped_units,v_units+5) + greatest(0,v_sets-1)*v_rest<=v_fit_limit
    loop
      v_units := least(v_capped_units,v_units+5);
      v_predicted := v_setup + v_sets*v_units + greatest(0,v_sets-1)*v_rest;
    end loop;

    r := (r
      - 'execution_target_reps'
      - 'reps_min'
      - 'reps_max'
      - 'reps_semantics'
      - 'quality_attempts_min'
      - 'quality_attempts_max')
      || jsonb_build_object(
        'sets',v_sets,
        'execution_target_duration_seconds',v_units,
        'duration_seconds_min',v_units,
        'duration_seconds_max',v_units,
        'prescription_type','time_hold',
        'text',format('%s · %s sec',case when v_sets=1 then '1 série' else v_sets||' séries' end,v_units)
      );
  elsif v_is_attempts then
    v_original_units := greatest(1,coalesce(
      nullif(r->>'quality_attempts_max','')::integer,
      nullif(r->>'quality_attempts_min','')::integer,
      6
    ));
    v_units := v_original_units;
    v_capped_units := v_units;
    v_min_units := greatest(1,least(coalesce(nullif(r->>'quality_attempts_min','')::integer,3),v_units));
    v_seconds_per_unit := 10;
    v_sets := 1;
    v_predicted := v_setup + v_units*v_seconds_per_unit;
    while v_predicted>v_fit_limit and v_units>v_min_units loop
      v_units := v_units-1;
      v_predicted := v_setup + v_units*v_seconds_per_unit;
    end loop;

    r := (r
      - 'execution_target_reps'
      - 'reps_min'
      - 'reps_max'
      - 'reps_semantics'
      - 'execution_target_duration_seconds'
      - 'duration_seconds_min'
      - 'duration_seconds_max')
      || jsonb_build_object(
        'sets',1,
        'quality_attempts_min',least(v_min_units,v_units),
        'quality_attempts_max',v_units,
        'text',format('%s–%s tentatives propres',least(v_min_units,v_units),v_units)
      );
  else
    v_original_units := greatest(1,coalesce(
      nullif(r->>'execution_target_reps','')::integer,
      case
        when nullif(r->>'reps_min','') is not null and nullif(r->>'reps_max','') is not null
          then round(((r->>'reps_min')::numeric+(r->>'reps_max')::numeric)/2)::integer
        else null
      end,
      nullif(r->>'reps_max','')::integer,
      nullif(r->>'reps_min','')::integer,
      6
    ));
    v_units := least(v_original_units,case
      when coalesce((r->>'capability_mature')::boolean,false) then 8
      when v_role='TARGET' then 6
      when v_role='EXPLORATION' then 4
      else 5
    end);
    v_min_units := case when v_role='TARGET' then 3 else 3 end;
    v_units := greatest(v_min_units,v_units);
    v_capped_units := v_units;
    v_seconds_per_unit := case
      when v_is_slow_technical then 6
      when upper(coalesce(r->>'curriculum_prescription_kind',''))='CONTROL_REPS' then 4
      else 3
    end;

    v_predicted := v_setup + v_sets*v_units*v_seconds_per_unit*v_side_multiplier + greatest(0,v_sets-1)*v_rest;
    while v_predicted>v_fit_limit and v_units>v_min_units loop
      v_units := v_units-1;
      v_predicted := v_setup + v_sets*v_units*v_seconds_per_unit*v_side_multiplier + greatest(0,v_sets-1)*v_rest;
    end loop;
    while v_predicted>v_fit_limit and v_sets>1 loop
      v_sets := v_sets-1;
      v_predicted := v_setup + v_sets*v_units*v_seconds_per_unit*v_side_multiplier + greatest(0,v_sets-1)*v_rest;
    end loop;
    while v_units<v_capped_units
      and v_setup + v_sets*(v_units+1)*v_seconds_per_unit*v_side_multiplier + greatest(0,v_sets-1)*v_rest<=v_fit_limit
    loop
      v_units := v_units+1;
      v_predicted := v_setup + v_sets*v_units*v_seconds_per_unit*v_side_multiplier + greatest(0,v_sets-1)*v_rest;
    end loop;

    r := (r
      - 'execution_target_duration_seconds'
      - 'duration_seconds_min'
      - 'duration_seconds_max'
      - 'quality_attempts_min'
      - 'quality_attempts_max')
      || jsonb_build_object(
        'sets',v_sets,
        'execution_target_reps',v_units,
        'reps_min',v_units,
        'reps_max',v_units,
        'reps_semantics',coalesce(nullif(r->>'reps_semantics',''),'total'),
        'text',format('%s · %s reps%s',case when v_sets=1 then '1 série' else v_sets||' séries' end,v_units,case when v_side_multiplier=2 then ' / côté' else '' end),
        'estimated_seconds_per_rep',v_seconds_per_unit
      );
  end if;

  if v_predicted>v_fit_limit then
    v_status := 'MINIMUM_VOLUME_OVER_BUDGET';
  end if;
  v_adjusted := v_sets<>v_original_sets
    or v_units<>v_original_units
    or (v_is_time and nullif(p_current->>'execution_target_duration_seconds','') is null);

  return r || jsonb_build_object(
    'allocated_duration_seconds',v_alloc,
    'target_duration_minutes',ceil(v_alloc/60.0)::integer,
    'rest_between_sets_seconds',v_rest,
    'predicted_elapsed_seconds',v_predicted,
    'duration_fit_status',v_status,
    'duration_fit_adjusted',v_adjusted,
    'duration_fit_version','skill-duration-fit-v1',
    'duration_fit_buffer_seconds',v_buffer,
    'duration_fit_setup_seconds',v_setup,
    'duration_fit_limit_seconds',v_fit_limit,
    'duration_fit_includes_rest',true,
    'duration_fit_includes_setup',true,
    'duration_fit_semantic',case when v_is_time then 'TIME' when v_is_attempts then 'QUALITY_ATTEMPTS' else 'REPS' end
  );
end;
$function$;
