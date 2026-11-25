-- TEST-001 release smoke:
-- keep the one-command release gate bounded. The wider GEN-001 matrix remains
-- available separately in QUICK/FULL modes; this release smoke only proves that
-- each environment's generation path and fail-closed contract are alive.

create or replace function public.qa_generation_release_smoke_v1(
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
  v_home jsonb;
  v_box jsonb;
  v_gym jsonb;
  v_cases jsonb:='[]'::jsonb;
  v_case jsonb;
  v_failed int;
begin
  if p_user_id is null then raise exception 'User required'; end if;
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;

  perform set_config('ugerod.session_anchor_date',v_anchor::text,true);

  v_home:=public.resolve_user_equipment_inventory(
    p_user_id,array['Tapis','Élastiques']::text[],'c4-final-default'
  );
  v_box:=public.resolve_user_equipment_inventory(
    p_user_id,
    array['Air Bike / Assault Bike','Barre de traction','Barre olympique + disques','Corde à sauter','Élastiques','Haltères','Kettlebell','Rameur','Tapis']::text[],
    'c4-final-default'
  );
  v_gym:=public.resolve_user_equipment_inventory(
    p_user_id,
    array['Banc','Barre olympique + disques','Élastiques','Haltères','Poulie / Cable machine','Rack / cage à squat','Rameur','Tapis']::text[],
    'c4-final-default'
  );

  v_case:=public.qa_generation_case_v1(
    p_user_id,'HOME',30,'normal','General Fitness','Full Body','MAINTAIN',
    '{}'::text[],v_home,null,null,2,'READY',null
  );
  v_cases:=v_cases||jsonb_build_array(v_case||jsonb_build_object('case_id','HOME_RELEASE_SMOKE'));

  v_case:=public.qa_generation_case_v1(
    p_user_id,'BOX',45,'normal','Strength','Full Body','RECALIBRATE',
    '{}'::text[],v_box,null,null,3,'READY',null
  );
  v_cases:=v_cases||jsonb_build_array(v_case||jsonb_build_object('case_id','BOX_RELEASE_SMOKE'));

  v_case:=public.qa_generation_case_v1(
    p_user_id,'GYM',45,'normal','Strength','Upper','MAINTAIN',
    '{}'::text[],v_gym,null,'GYM_STRENGTH',4,'READY',null
  );
  v_cases:=v_cases||jsonb_build_array(v_case||jsonb_build_object('case_id','GYM_RELEASE_SMOKE'));

  v_case:=public.qa_generation_case_v1(
    p_user_id,'OUTDOOR',45,'normal','Conditioning','Full Body','MAINTAIN',
    '{}'::text[],'[]'::jsonb,'TRACK','OUTDOOR_CONDITIONING',3,'READY',null
  );
  v_cases:=v_cases||jsonb_build_array(v_case||jsonb_build_object('case_id','OUTDOOR_RELEASE_SMOKE'));

  v_case:=public.qa_generation_case_v1(
    p_user_id,'OUTDOOR',45,'normal','Conditioning','Full Body','MAINTAIN',
    '{}'::text[],'[]'::jsonb,null,'OUTDOOR_CONDITIONING',1,'BLOCKED','SURFACE_REQUIRED_OUTDOOR'
  );
  v_cases:=v_cases||jsonb_build_array(v_case||jsonb_build_object('case_id','OUTDOOR_FAIL_CLOSED_SMOKE'));

  select count(*) filter(where not coalesce((x->>'pass')::boolean,false))
  into v_failed
  from jsonb_array_elements(v_cases) x;

  return jsonb_build_object(
    'version','qa-generation-release-smoke-v1',
    'pass',v_failed=0,
    'anchor_date',v_anchor,
    'case_count',jsonb_array_length(v_cases),
    'failed',v_failed,
    'cases',v_cases,
    'scope','FAST_RELEASE_SENTINEL_NOT_FULL_GEN_001_MATRIX',
    'full_matrix_function','qa_generation_robustness_matrix_v1',
    'production_candidate_counts_unchanged',true
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
  v_generation:=public.qa_generation_release_smoke_v1(p_user_id,v_anchor);

  v_pass:=
    coalesce((v_evolution->>'pass')::boolean,false)
    and coalesce((v_cross->>'pass')::boolean,false)
    and coalesce((v_progression->>'pass')::boolean,false)
    and coalesce((v_generation->>'pass')::boolean,false);

  return jsonb_build_object(
    'version','qa-engine-release-v2.1',
    'pass',v_pass,
    'anchor_date',v_anchor,
    'checks',jsonb_build_array(
      jsonb_build_object('scope','EVOLUTION_1_16','pass',coalesce((v_evolution->>'pass')::boolean,false)),
      jsonb_build_object('scope','CROSS_ENVIRONMENT_8_WEEKS','pass',coalesce((v_cross->>'pass')::boolean,false)),
      jsonb_build_object('scope','PRG_004_PROGRESSION_INTENT','pass',coalesce((v_progression->>'pass')::boolean,false)),
      jsonb_build_object('scope','GEN_001_RELEASE_SMOKE','pass',coalesce((v_generation->>'pass')::boolean,false))
    ),
    'evolution',v_evolution,
    'cross_environment',v_cross,
    'progression_intent',v_progression,
    'generation_smoke',v_generation,
    'full_generation_matrix',jsonb_build_object(
      'function','qa_generation_robustness_matrix_v1',
      'quick_mode_available',true,
      'full_mode_available',true,
      'kept_separate_to_keep_release_gate_bounded',true
    ),
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

revoke all on function public.qa_generation_release_smoke_v1(uuid,date) from public,anon;
grant execute on function public.qa_generation_release_smoke_v1(uuid,date) to authenticated,service_role;
