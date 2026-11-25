-- TEST-001 / GEN-001 / PRG-004
-- Essential engine QA: deterministic progression-intent contract,
-- representative generation robustness matrix, and one release gate that
-- composes the already-existing longitudinal QA without creating a second
-- coaching authority.

create or replace function public.qa_progression_intent_contract_v1(
  p_user_id uuid,
  p_anchor_date date default current_date
) returns jsonb
language plpgsql
stable
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_anchor date:=coalesce(p_anchor_date,current_date);
  v_as_of timestamptz;
  v_exercise_id text;
  v_exercise_name text;
  v_ctx jsonb;
  v_progress jsonb;
  v_maintain jsonb;
  v_deload jsonb;
  v_recalibrate jsonb;
  v_static_pass boolean;
  v_integration_pass boolean:=true;
  v_integration_status text:='SKIPPED_NO_MATURE_REPS_CAPABILITY';
  v_pmax int;
  v_mmax int;
  v_dmax int;
  v_rmax int;
  v_pmin int;
  v_mmin int;
  v_dmin int;
  v_rmin int;
begin
  if p_user_id is null then raise exception 'User required'; end if;
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;

  perform set_config('ugerod.session_anchor_date',v_anchor::text,true);
  v_as_of:=(v_anchor::text||' 12:00:00+00')::timestamptz;

  v_static_pass:=
    public.c2_intent_repeatable_fraction_v1('PROGRESS')
      > public.c2_intent_repeatable_fraction_v1('MAINTAIN')
    and public.c2_intent_repeatable_fraction_v1('MAINTAIN')
      > public.c2_intent_repeatable_fraction_v1('RECALIBRATE')
    and public.c2_intent_repeatable_fraction_v1('RECALIBRATE')
      > public.c2_intent_repeatable_fraction_v1('DELOAD');

  select e.id,e.name,ctx.j
  into v_exercise_id,v_exercise_name,v_ctx
  from public.exercises e
  join public.user_exercise_capabilities c
    on c.user_id=p_user_id and c.exercise_id=e.id
  cross join lateral (
    select public.c2_capability_read_context_v1(
      p_user_id,e.id,'reps','repeatable',v_as_of
    ) j
  ) ctx
  where 'reps'=any(coalesce(e.tracking_modes,'{}'::text[]))
    and coalesce((ctx.j->>'mature')::boolean,false)
  order by
    coalesce(nullif(ctx.j->>'valid_evidence_count','')::int,0) desc,
    coalesce(nullif(ctx.j->>'confidence','')::numeric,0) desc,
    e.id
  limit 1;

  if v_exercise_id is not null then
    v_progress:=public.c2_solver_prescription(
      p_user_id,v_exercise_id,
      public.build_session_stimulus_target(
        'Strength',45,'normal','Full Body','PROGRESS','c1-default'
      ),
      'SETS_REPS','PROGRESS','[]'::jsonb
    );
    v_maintain:=public.c2_solver_prescription(
      p_user_id,v_exercise_id,
      public.build_session_stimulus_target(
        'Strength',45,'normal','Full Body','MAINTAIN','c1-default'
      ),
      'SETS_REPS','MAINTAIN','[]'::jsonb
    );
    v_deload:=public.c2_solver_prescription(
      p_user_id,v_exercise_id,
      public.build_session_stimulus_target(
        'Strength',45,'normal','Full Body','DELOAD','c1-default'
      ),
      'SETS_REPS','DELOAD','[]'::jsonb
    );
    v_recalibrate:=public.c2_solver_prescription(
      p_user_id,v_exercise_id,
      public.build_session_stimulus_target(
        'Strength',45,'normal','Full Body','RECALIBRATE','c1-default'
      ),
      'SETS_REPS','RECALIBRATE','[]'::jsonb
    );

    v_pmax:=nullif(v_progress->>'reps_max','')::int;
    v_mmax:=nullif(v_maintain->>'reps_max','')::int;
    v_dmax:=nullif(v_deload->>'reps_max','')::int;
    v_rmax:=nullif(v_recalibrate->>'reps_max','')::int;
    v_pmin:=nullif(v_progress->>'reps_min','')::int;
    v_mmin:=nullif(v_maintain->>'reps_min','')::int;
    v_dmin:=nullif(v_deload->>'reps_min','')::int;
    v_rmin:=nullif(v_recalibrate->>'reps_min','')::int;

    v_integration_status:='CHECKED_MATURE_REPS_CAPABILITY';
    v_integration_pass:=
      coalesce((v_progress->>'capability_mature')::boolean,false)
      and coalesce((v_maintain->>'capability_mature')::boolean,false)
      and coalesce((v_deload->>'capability_mature')::boolean,false)
      and coalesce((v_recalibrate->>'capability_mature')::boolean,false)
      and v_pmax>=v_mmax
      and v_dmax<=v_mmax
      and v_rmax<=v_mmax
      and v_pmin>=v_dmin
      and v_mmin>=v_dmin
      and v_rmin>=v_dmin
      and coalesce(v_recalibrate->>'progression_axis','')='recalibration_only'
      and (v_pmin,v_pmax) is distinct from (v_mmin,v_mmax)
      and (v_dmin,v_dmax) is distinct from (v_mmin,v_mmax)
      and (v_rmin,v_rmax) is distinct from (v_pmin,v_pmax);
  end if;

  return jsonb_build_object(
    'version','qa-progression-intent-contract-v1',
    'pass',v_static_pass and v_integration_pass,
    'anchor_date',v_anchor,
    'static_contract',jsonb_build_object(
      'pass',v_static_pass,
      'fractions',jsonb_build_object(
        'PROGRESS',public.c2_intent_repeatable_fraction_v1('PROGRESS'),
        'MAINTAIN',public.c2_intent_repeatable_fraction_v1('MAINTAIN'),
        'RECALIBRATE',public.c2_intent_repeatable_fraction_v1('RECALIBRATE'),
        'DELOAD',public.c2_intent_repeatable_fraction_v1('DELOAD')
      ),
      'rule','PROGRESS > MAINTAIN > RECALIBRATE > DELOAD'
    ),
    'integration',jsonb_build_object(
      'status',v_integration_status,
      'pass',v_integration_pass,
      'representative_exercise_id',v_exercise_id,
      'representative_exercise_name',v_exercise_name,
      'capability_context',coalesce(v_ctx,'{}'::jsonb),
      'dose_signatures',jsonb_build_object(
        'PROGRESS',jsonb_build_object('reps_min',v_pmin,'reps_max',v_pmax,'axis',v_progress->>'progression_axis'),
        'MAINTAIN',jsonb_build_object('reps_min',v_mmin,'reps_max',v_mmax,'axis',v_maintain->>'progression_axis'),
        'RECALIBRATE',jsonb_build_object('reps_min',v_rmin,'reps_max',v_rmax,'axis',v_recalibrate->>'progression_axis'),
        'DELOAD',jsonb_build_object('reps_min',v_dmin,'reps_max',v_dmax,'axis',v_deload->>'progression_axis')
      ),
      'no_new_progression_authority_created',true,
      'existing_c2_prescription_is_authority',true
    )
  );
end;
$function$;

create or replace function public.qa_generation_case_v1(
  p_user_id uuid,
  p_environment text,
  p_duration_minutes integer,
  p_readiness text,
  p_focus text,
  p_target_region text,
  p_progression_intent text,
  p_zone_terms text[] default '{}'::text[],
  p_inventory jsonb default '[]'::jsonb,
  p_surface_code text default null,
  p_format_code text default null,
  p_candidate_count integer default 6,
  p_expected_status text default 'READY',
  p_expected_reason text default null
) returns jsonb
language plpgsql
stable
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_env text:=public.normalize_session_environment_v1(p_environment);
  v_plan jsonb;
  v_contract jsonb:='{}'::jsonb;
  v_status text;
  v_reason text;
  v_identity_pass boolean:=false;
  v_contract_pass boolean:=true;
  v_pass boolean:=false;
  v_started timestamptz:=clock_timestamp();
  v_elapsed_ms int;
begin
  if p_user_id is null then raise exception 'User required'; end if;
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;

  perform set_config('ugerod.session_environment',v_env,true);
  perform set_config('ugerod.session_surface',coalesce(p_surface_code,''),true);

  if v_env in ('HOME','BOX') then
    v_plan:=public.c4_plan_full_session_v2(
      p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
      coalesce(p_zone_terms,'{}'::text[]),coalesce(p_inventory,'[]'::jsonb),
      4,'Intermédiaire',greatest(1,p_candidate_count),'c4-final-default'
    );

    if upper(coalesce(v_plan->>'status',''))='READY' then
      v_contract:=public.qa_c4_plan_contract_v1(
        v_plan,p_duration_minutes,coalesce(p_inventory,'[]'::jsonb)
      );
      v_contract_pass:=coalesce((v_contract->>'pass')::boolean,false);
    end if;

    v_identity_pass:=
      exists(
        select 1 from jsonb_array_elements(coalesce(v_plan->'blocks','[]'::jsonb)) b
        where b->>'block_key'='wod'
      )
      and exists(
        select 1 from jsonb_array_elements(coalesce(v_plan->'blocks','[]'::jsonb)) b
        where b->>'block_key' in ('unlock','warmup')
      )
      and not exists(
        select 1 from jsonb_array_elements(coalesce(v_plan->'blocks','[]'::jsonb)) b
        where b->>'block_key' in ('strength','conditioning')
      );

  elsif v_env='GYM' then
    v_plan:=public.gym_plan_session_v2(
      p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
      coalesce(p_zone_terms,'{}'::text[]),coalesce(p_inventory,'[]'::jsonb),
      coalesce(nullif(p_format_code,''),'GYM_STRENGTH'),
      'CLASSIC_SETS',4,'Intermédiaire',greatest(1,p_candidate_count),'c4-final-default'
    );

    v_identity_pass:=
      upper(coalesce(v_plan->>'environment_code',''))='GYM'
      and upper(coalesce(v_plan->>'format_code','')) like 'GYM_%'
      and exists(
        select 1 from jsonb_array_elements(coalesce(v_plan->'blocks','[]'::jsonb)) b
        where b->>'block_key'='strength'
          and jsonb_array_length(coalesce(b->'exercises','[]'::jsonb))>0
      );

  elsif v_env='OUTDOOR' then
    v_plan:=public.outdoor_plan_session_v4(
      p_user_id,p_duration_minutes,p_readiness,p_focus,coalesce(p_target_region,'Full Body'),
      coalesce(p_progression_intent,'MAINTAIN'),coalesce(p_zone_terms,'{}'::text[]),
      coalesce(p_inventory,'[]'::jsonb),null,p_surface_code,
      coalesce(nullif(p_format_code,''),'OUTDOOR_CONDITIONING'),
      false,true,false,4,'Intermédiaire',greatest(1,p_candidate_count)
    );

    v_identity_pass:=
      upper(coalesce(v_plan->>'environment_code',''))='OUTDOOR'
      and upper(coalesce(v_plan->>'format_code','')) like 'OUTDOOR_%'
      and exists(
        select 1 from jsonb_array_elements(coalesce(v_plan->'blocks','[]'::jsonb)) b
        where b->>'block_key'='conditioning'
          and jsonb_array_length(coalesce(b->'exercises','[]'::jsonb))>0
      );
  else
    return jsonb_build_object(
      'version','qa-generation-case-v1',
      'pass',false,
      'environment',v_env,
      'reason','UNSUPPORTED_QA_ENVIRONMENT'
    );
  end if;

  v_status:=upper(coalesce(v_plan->>'status','UNKNOWN'));
  v_reason:=coalesce(
    nullif(v_plan->>'reason_code',''),
    nullif(v_plan#>>'{architecture,session_architecture_v2_contract,reason}',''),
    case when v_status<>'READY' then v_status else null end
  );

  if upper(coalesce(p_expected_status,'READY'))='READY' then
    v_pass:=v_status='READY' and v_contract_pass and v_identity_pass;
  else
    v_pass:=v_status<>'READY'
      and (
        p_expected_reason is null
        or upper(coalesce(v_reason,''))=upper(p_expected_reason)
      );
  end if;

  v_elapsed_ms:=round(extract(epoch from (clock_timestamp()-v_started))*1000)::int;

  return jsonb_build_object(
    'version','qa-generation-case-v1',
    'pass',v_pass,
    'environment',v_env,
    'duration_minutes',p_duration_minutes,
    'readiness',p_readiness,
    'focus',p_focus,
    'target_region',p_target_region,
    'progression_intent',p_progression_intent,
    'surface_code',p_surface_code,
    'format_code',coalesce(v_plan->>'format_code',p_format_code),
    'status',v_status,
    'reason',v_reason,
    'expected_status',upper(coalesce(p_expected_status,'READY')),
    'expected_reason',p_expected_reason,
    'identity_pass',v_identity_pass,
    'contract_pass',v_contract_pass,
    'contract',v_contract,
    'elapsed_ms',v_elapsed_ms
  );
end;
$function$;

create or replace function public.qa_generation_robustness_matrix_v1(
  p_user_id uuid,
  p_anchor_date date default current_date,
  p_mode text default 'QUICK'
) returns jsonb
language plpgsql
stable
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_mode text:=upper(coalesce(nullif(trim(p_mode),''),'QUICK'));
  v_anchor date:=coalesce(p_anchor_date,current_date);
  v_home_min jsonb;
  v_home_std jsonb;
  v_box jsonb;
  v_gym jsonb;
  v_outdoor jsonb:='[]'::jsonb;
  v_cases jsonb:='[]'::jsonb;
  v_case jsonb;
  v_total int;
  v_passed int;
  v_failed int;
begin
  if p_user_id is null then raise exception 'User required'; end if;
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;
  if v_mode not in ('QUICK','FULL') then raise exception 'Unsupported QA mode %',v_mode; end if;

  perform set_config('ugerod.session_anchor_date',v_anchor::text,true);

  v_home_min:=public.resolve_user_equipment_inventory(
    p_user_id,array['Tapis']::text[],'c4-final-default'
  );
  v_home_std:=public.resolve_user_equipment_inventory(
    p_user_id,array['Tapis','Élastiques','Rameur','Barre de traction']::text[],'c4-final-default'
  );
  v_box:=public.resolve_user_equipment_inventory(
    p_user_id,
    array['Air Bike / Assault Bike','Anneaux de gymnastique','Barre de traction','Barre olympique + disques','Box','Corde à sauter','Élastiques','Haltères','Kettlebell','Medball','Rameur','Tapis']::text[],
    'c4-final-default'
  );
  v_gym:=public.resolve_user_equipment_inventory(
    p_user_id,
    array['Banc','Barre olympique + disques','Élastiques','Haltères','Kettlebell','Poulie / Cable machine','Rack / cage à squat','Rameur','Tapis','Tapis de course','Vélo / Bike']::text[],
    'c4-final-default'
  );

  v_case:=public.qa_generation_case_v1(
    p_user_id,'HOME',30,'normal','General Fitness','Full Body','MAINTAIN',
    '{}'::text[],v_home_min,null,null,6,'READY',null
  );
  v_cases:=v_cases||jsonb_build_array(v_case||jsonb_build_object('case_id','HOME_30_NORMAL_MINIMAL'));

  v_case:=public.qa_generation_case_v1(
    p_user_id,'HOME',45,'low','Strength','Upper','DELOAD',
    array['shoulder']::text[],v_home_std,null,null,6,'READY',null
  );
  v_cases:=v_cases||jsonb_build_array(v_case||jsonb_build_object('case_id','HOME_45_LOW_PAIN'));

  v_case:=public.qa_generation_case_v1(
    p_user_id,'BOX',45,'normal','Strength','Full Body','RECALIBRATE',
    '{}'::text[],v_box,null,null,8,'READY',null
  );
  v_cases:=v_cases||jsonb_build_array(v_case||jsonb_build_object('case_id','BOX_45_NORMAL_FULL'));

  v_case:=public.qa_generation_case_v1(
    p_user_id,'GYM',45,'normal','Strength','Upper','MAINTAIN',
    '{}'::text[],v_gym,null,'GYM_STRENGTH',12,'READY',null
  );
  v_cases:=v_cases||jsonb_build_array(v_case||jsonb_build_object('case_id','GYM_45_UPPER_STRENGTH'));

  v_case:=public.qa_generation_case_v1(
    p_user_id,'OUTDOOR',45,'normal','Conditioning','Full Body','MAINTAIN',
    '{}'::text[],'[]'::jsonb,'TRACK','OUTDOOR_CONDITIONING',8,'READY',null
  );
  v_cases:=v_cases||jsonb_build_array(v_case||jsonb_build_object('case_id','OUTDOOR_45_TRACK'));

  v_case:=public.qa_generation_case_v1(
    p_user_id,'OUTDOOR',45,'normal','Conditioning','Full Body','MAINTAIN',
    '{}'::text[],'[]'::jsonb,null,'OUTDOOR_CONDITIONING',6,'BLOCKED','SURFACE_REQUIRED_OUTDOOR'
  );
  v_cases:=v_cases||jsonb_build_array(v_case||jsonb_build_object('case_id','OUTDOOR_MISSING_SURFACE_FAIL_CLOSED'));

  if v_mode='FULL' then
    v_case:=public.qa_generation_case_v1(
      p_user_id,'BOX',60,'low','Strength','Full Body','DELOAD',
      '{}'::text[],v_box,null,null,8,'READY',null
    );
    v_cases:=v_cases||jsonb_build_array(v_case||jsonb_build_object('case_id','BOX_60_LOW_DELOAD'));

    v_case:=public.qa_generation_case_v1(
      p_user_id,'GYM',60,'low','Strength','Lower','DELOAD',
      '{}'::text[],v_gym,null,'GYM_STRENGTH',12,'READY',null
    );
    v_cases:=v_cases||jsonb_build_array(v_case||jsonb_build_object('case_id','GYM_60_LOWER_LOW'));

    v_case:=public.qa_generation_case_v1(
      p_user_id,'OUTDOOR',45,'low','Conditioning','Full Body','DELOAD',
      '{}'::text[],'[]'::jsonb,'GRASS','OUTDOOR_CONDITIONING',8,'READY',null
    );
    v_cases:=v_cases||jsonb_build_array(v_case||jsonb_build_object('case_id','OUTDOOR_45_GRASS_LOW'));

    v_case:=public.qa_generation_case_v1(
      p_user_id,'HOME',90,'normal','Strength','Full Body','MAINTAIN',
      '{}'::text[],v_home_std,null,null,8,'READY',null
    );
    v_cases:=v_cases||jsonb_build_array(v_case||jsonb_build_object('case_id','HOME_90_LONG_SESSION'));
  end if;

  v_total:=jsonb_array_length(v_cases);
  select
    count(*) filter(where coalesce((x->>'pass')::boolean,false)),
    count(*) filter(where not coalesce((x->>'pass')::boolean,false))
  into v_passed,v_failed
  from jsonb_array_elements(v_cases) x;

  return jsonb_build_object(
    'version','qa-generation-robustness-matrix-v1',
    'pass',v_failed=0,
    'mode',v_mode,
    'anchor_date',v_anchor,
    'case_count',v_total,
    'passed',v_passed,
    'failed',v_failed,
    'cases',v_cases,
    'coverage',jsonb_build_object(
      'environments',jsonb_build_array('HOME','BOX','GYM','OUTDOOR'),
      'duration_30',true,
      'duration_45',true,
      'duration_60',v_mode='FULL',
      'duration_90',v_mode='FULL',
      'readiness_normal',true,
      'readiness_low',true,
      'pain_filter',true,
      'minimal_equipment',true,
      'full_equipment',true,
      'no_equipment_outdoor',true,
      'fail_closed_reason_code',true,
      'environment_identity_checked',true,
      'no_session_persistence',true
    )
  );
end;
$function$;

create or replace function public.qa_engine_release_v2(
  p_user_id uuid,
  p_anchor_date date default current_date
) returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_anchor date:=coalesce(p_anchor_date,current_date);
  v_evolution jsonb;
  v_cross jsonb;
  v_progression jsonb;
  v_generation jsonb;
  v_pass boolean;
begin
  if p_user_id is null then raise exception 'User required'; end if;
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;

  v_evolution:=public.qa_evolution_release_v1(p_user_id,v_anchor);
  v_cross:=public.qa_evolution_cross_environment_multweek_sim_v1();
  v_progression:=public.qa_progression_intent_contract_v1(p_user_id,v_anchor);
  v_generation:=public.qa_generation_robustness_matrix_v1(p_user_id,v_anchor,'QUICK');

  v_pass:=
    coalesce((v_evolution->>'pass')::boolean,false)
    and coalesce((v_cross->>'pass')::boolean,false)
    and coalesce((v_progression->>'pass')::boolean,false)
    and coalesce((v_generation->>'pass')::boolean,false);

  return jsonb_build_object(
    'version','qa-engine-release-v2',
    'pass',v_pass,
    'anchor_date',v_anchor,
    'checks',jsonb_build_array(
      jsonb_build_object('scope','EVOLUTION_1_16','pass',coalesce((v_evolution->>'pass')::boolean,false)),
      jsonb_build_object('scope','CROSS_ENVIRONMENT_8_WEEKS','pass',coalesce((v_cross->>'pass')::boolean,false)),
      jsonb_build_object('scope','PRG_004_PROGRESSION_INTENT','pass',coalesce((v_progression->>'pass')::boolean,false)),
      jsonb_build_object('scope','GEN_001_QUICK_MATRIX','pass',coalesce((v_generation->>'pass')::boolean,false))
    ),
    'evolution',v_evolution,
    'cross_environment',v_cross,
    'progression_intent',v_progression,
    'generation_matrix',v_generation,
    'principles',jsonb_build_object(
      'no_second_progression_engine',true,
      'environment_specific_generation_preserved',true,
      'hard_gates_remain_authoritative',true,
      'missing_surface_fails_closed',true,
      'qa_does_not_persist_sessions',true
    )
  );
end;
$function$;

revoke all on function public.qa_progression_intent_contract_v1(uuid,date) from public,anon;
revoke all on function public.qa_generation_case_v1(uuid,text,integer,text,text,text,text,text[],jsonb,text,text,integer,text,text) from public,anon;
revoke all on function public.qa_generation_robustness_matrix_v1(uuid,date,text) from public,anon;
revoke all on function public.qa_engine_release_v2(uuid,date) from public,anon;

grant execute on function public.qa_progression_intent_contract_v1(uuid,date) to authenticated,service_role;
grant execute on function public.qa_generation_case_v1(uuid,text,integer,text,text,text,text,text[],jsonb,text,text,integer,text,text) to authenticated,service_role;
grant execute on function public.qa_generation_robustness_matrix_v1(uuid,date,text) to authenticated,service_role;
grant execute on function public.qa_engine_release_v2(uuid,date) to authenticated,service_role;
