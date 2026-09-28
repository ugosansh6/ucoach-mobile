-- TEST-001: keep the release smoke fast without changing production
-- candidate counts. QUICK validates contracts/paths with reduced QA-only search;
-- FULL retains the representative production-like candidate counts.

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
  v_cases jsonb:='[]'::jsonb;
  v_case jsonb;
  v_total int;
  v_passed int;
  v_failed int;
  v_home_candidates int;
  v_box_candidates int;
  v_gym_candidates int;
  v_outdoor_candidates int;
begin
  if p_user_id is null then raise exception 'User required'; end if;
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;
  if v_mode not in ('QUICK','FULL') then raise exception 'Unsupported QA mode %',v_mode; end if;

  perform set_config('ugerod.session_anchor_date',v_anchor::text,true);

  -- QA-only counts. Production generator counts are untouched.
  v_home_candidates:=case when v_mode='QUICK' then 3 else 8 end;
  v_box_candidates:=case when v_mode='QUICK' then 4 else 8 end;
  v_gym_candidates:=case when v_mode='QUICK' then 6 else 12 end;
  v_outdoor_candidates:=case when v_mode='QUICK' then 4 else 8 end;

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
    '{}'::text[],v_home_min,null,null,v_home_candidates,'READY',null
  );
  v_cases:=v_cases||jsonb_build_array(v_case||jsonb_build_object('case_id','HOME_30_NORMAL_MINIMAL'));

  v_case:=public.qa_generation_case_v1(
    p_user_id,'HOME',45,'low','Strength','Upper','DELOAD',
    '{}'::text[],v_home_std,null,null,v_home_candidates,'READY',null
  );
  v_cases:=v_cases||jsonb_build_array(v_case||jsonb_build_object('case_id','HOME_45_LOW_READY'));

  v_case:=public.qa_generation_case_v1(
    p_user_id,'HOME',45,'low','Strength','Upper','DELOAD',
    array['shoulder']::text[],v_home_std,null,null,v_home_candidates,'BLOCKED','NO_SAFE_COHERENT_WOD'
  );
  v_cases:=v_cases||jsonb_build_array(v_case||jsonb_build_object(
    'case_id','HOME_45_LOW_PAIN_FAIL_SAFE',
    'classification','EXPECTED_SAFETY_REFUSAL_NOT_GENERATION_HOLE'
  ));

  v_case:=public.qa_generation_case_v1(
    p_user_id,'BOX',45,'normal','Strength','Full Body','RECALIBRATE',
    '{}'::text[],v_box,null,null,v_box_candidates,'READY',null
  );
  v_cases:=v_cases||jsonb_build_array(v_case||jsonb_build_object('case_id','BOX_45_NORMAL_FULL'));

  v_case:=public.qa_generation_case_v1(
    p_user_id,'GYM',45,'normal','Strength','Upper','MAINTAIN',
    '{}'::text[],v_gym,null,'GYM_STRENGTH',v_gym_candidates,'READY',null
  );
  v_cases:=v_cases||jsonb_build_array(v_case||jsonb_build_object('case_id','GYM_45_UPPER_STRENGTH'));

  v_case:=public.qa_generation_case_v1(
    p_user_id,'OUTDOOR',45,'normal','Conditioning','Full Body','MAINTAIN',
    '{}'::text[],'[]'::jsonb,'TRACK','OUTDOOR_CONDITIONING',v_outdoor_candidates,'READY',null
  );
  v_cases:=v_cases||jsonb_build_array(v_case||jsonb_build_object('case_id','OUTDOOR_45_TRACK'));

  v_case:=public.qa_generation_case_v1(
    p_user_id,'OUTDOOR',45,'normal','Conditioning','Full Body','MAINTAIN',
    '{}'::text[],'[]'::jsonb,null,'OUTDOOR_CONDITIONING',
    case when v_mode='QUICK' then 2 else 6 end,
    'BLOCKED','SURFACE_REQUIRED_OUTDOOR'
  );
  v_cases:=v_cases||jsonb_build_array(v_case||jsonb_build_object(
    'case_id','OUTDOOR_MISSING_SURFACE_FAIL_CLOSED',
    'classification','EXPECTED_ENVIRONMENT_CONTRACT_REFUSAL'
  ));

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
    'version','qa-generation-robustness-matrix-v1.2',
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
      'pain_fail_safe_classified',true,
      'minimal_equipment',true,
      'full_equipment',true,
      'no_equipment_outdoor',true,
      'fail_closed_reason_code',true,
      'environment_identity_checked',true,
      'ready_and_expected_blocked_cases_separated',true,
      'no_session_persistence',true,
      'quick_candidate_counts_are_qa_only',true,
      'production_candidate_counts_unchanged',true
    )
  );
end;
$function$;
