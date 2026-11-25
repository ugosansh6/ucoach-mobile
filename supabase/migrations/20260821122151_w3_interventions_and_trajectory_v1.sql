create table public.coach_intervention_catalog (
  intervention_key text primary key,
  category text not null,
  label text not null,
  description text not null,
  auto_assignment_policy text not null,
  active boolean not null default true,
  version text not null default 'w3-intervention-catalog-v1',
  created_at timestamptz not null default now()
);

alter table public.coach_intervention_catalog enable row level security;
create policy coach_intervention_catalog_read on public.coach_intervention_catalog for select to authenticated using (true);
revoke all on public.coach_intervention_catalog from anon;
grant select on public.coach_intervention_catalog to authenticated,service_role;

insert into public.coach_intervention_catalog(intervention_key,category,label,description,auto_assignment_policy) values
('CALIBRATION_CONTROLLED','calibration','Calibration contrôlée','Créer une exposition mesurable et contrôlée pour obtenir la donnée qui manque à une décision Coach.','AUTO_WHEN_W3_OPPORTUNITY_IS_CALIBRATION'),
('RETEST_CONTROLLED','retest','Retest contrôlé','Rejouer une référence comparable lorsque PI demande explicitement une recalibration.','AUTO_WHEN_EXISTING_PI_DIRECTIVE_IS_RECALIBRATE'),
('SKILL_PRACTICE_CURRENT_STEP','skill','Consolider l’étape Skill','Continuer l’étape technique courante lorsque les preuves existantes demandent encore du développement ou de la consolidation.','AUTO_WHEN_W3_ACTIVE_SKILL_STATE_IS_DEVELOPMENT_NEEDED'),
('SKILL_PROGRESS_NEXT_STEP','skill','Étape Skill suivante','Passer à l’étape suivante seulement lorsque PI autorise la progression, que le feedback technique ne la bloque pas et que les prérequis connus sont soutenus.','AUTO_WHEN_W3_ACTIVE_SKILL_STATE_IS_PROGRESSION_CANDIDATE'),
('MOVEMENT_PROGRESS_EXPOSURE','progression','Exposition de progression','Créer une exposition progressive pour un mouvement déjà marqué PROGRESS par PI.','AUTO_WHEN_EXISTING_PI_DIRECTIVE_IS_PROGRESS'),
('EQUIPMENT_ACCESS_CONTEXT','equipment','Accès matériel ciblé','Chercher un contexte donnant accès au matériel précisément manquant pour une opportunité Coach identifiée.','AUTO_ONLY_WHEN_W3_EQUIPMENT_GAP_IS_TIED_TO_NAMED_OPPORTUNITY'),
('SPECIFIC_STRENGTH_CURATED_ONLY','strength','Renforcement spécifique','Travail de force spécifique lié à un facteur limitant explicitement documenté.','CURATED_ONLY_NEVER_AUTO_FROM_STRUCTURAL_PATH_EDGE'),
('RECOVERY_PROGRAM_OWNED','recovery','Récupération','Réduire ou réorienter la séance lorsque Program Coach le décide selon ses règles existantes.','OWNED_BY_EXISTING_PROGRAM_COACH_NOT_RECOMPUTED_BY_W3')
on conflict(intervention_key) do update set
  category=excluded.category,label=excluded.label,description=excluded.description,
  auto_assignment_policy=excluded.auto_assignment_policy,active=true,version='w3-intervention-catalog-v1';

create or replace function public.w3_intervention_options_v1(
  p_user_id uuid,
  p_anchor_date date default current_date
)
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  v_anchor date:=coalesce(p_anchor_date,current_date);
  v_opp jsonb;
  v_items jsonb:='[]'::jsonb;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;
  v_opp:=public.w3_opportunity_engine_v1(p_user_id,v_anchor);

  with opps as (
    select value,ord
    from jsonb_array_elements(coalesce(v_opp->'top_opportunities','[]'::jsonb)) with ordinality q(value,ord)
  ), mapped as (
    select o.ord,o.value,
      case o.value->>'type'
        when 'CALIBRATION' then 'CALIBRATION_CONTROLLED'
        when 'RETEST' then 'RETEST_CONTROLLED'
        when 'SKILL_DEVELOPMENT' then 'SKILL_PRACTICE_CURRENT_STEP'
        when 'SKILL_PROGRESSION' then 'SKILL_PROGRESS_NEXT_STEP'
        when 'MOVEMENT_PROGRESSION' then 'MOVEMENT_PROGRESS_EXPOSURE'
        when 'EQUIPMENT_ACCESS' then 'EQUIPMENT_ACCESS_CONTEXT'
        else null
      end intervention_key
    from opps o
  )
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'rank',m.ord,
    'opportunity',m.value,
    'intervention_key',c.intervention_key,
    'category',c.category,
    'label',c.label,
    'description',c.description,
    'auto_assignment_policy',c.auto_assignment_policy,
    'catalog_version',c.version
  )) order by m.ord),'[]'::jsonb)
  into v_items
  from mapped m
  left join public.coach_intervention_catalog c on c.intervention_key=m.intervention_key and c.active;

  return jsonb_build_object(
    'version','w3-intervention-options-v1','anchor_date',v_anchor,
    'items',v_items,
    'semantics',jsonb_build_object(
      'intervention_is_tied_to_an_evidence_backed_opportunity',true,
      'specific_strength_is_never_inferred_from_structural_skill_order',true,
      'recovery_remains_owned_by_existing_program_coach',true,
      'hard_safety_equipment_readiness_and_program_rules_override',true
    )
  );
end;
$$;
revoke all on function public.w3_intervention_options_v1(uuid,date) from public,anon;
grant execute on function public.w3_intervention_options_v1(uuid,date) to authenticated,service_role;

create or replace function public.w3_trajectory_snapshot_v1(
  p_user_id uuid,
  p_anchor_date date default current_date
)
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  v_anchor date:=coalesce(p_anchor_date,current_date);
  v_cap jsonb;
  v_opp jsonb;
  v_interventions jsonb;
  v_progression jsonb;
  v_strategy jsonb;
  v_skill jsonb;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;

  v_cap:=public.w3_capability_model_v1(p_user_id,v_anchor);
  v_opp:=public.w3_opportunity_engine_v1(p_user_id,v_anchor);
  v_interventions:=public.w3_intervention_options_v1(p_user_id,v_anchor);
  v_progression:=public.progression_data_contract_v1(p_user_id,28,v_anchor);
  v_strategy:=public.program_coach_week_strategy_v1(p_user_id,public.d_week_start(v_anchor));
  v_skill:=public.w3_active_skill_objective_v1(p_user_id,v_anchor);

  return jsonb_build_object(
    'version','w3-trajectory-snapshot-v1',
    'anchor_date',v_anchor,
    'window',jsonb_build_object(
      'type','SLIDING','days',28,'fixed_session_calendar',false,
      'recomputed_when_new_evidence_arrives',true
    ),
    'current_program_state',jsonb_build_object(
      'program_kind',v_strategy->>'program_kind',
      'block_phase',v_strategy->'block_phase',
      'recent_load',v_strategy->'recent_load',
      'quality_priorities',coalesce(v_strategy->'quality_priorities','[]'::jsonb),
      'movement_pattern_priorities',coalesce(v_strategy->'movement_pattern_priorities','[]'::jsonb)
    ),
    'capability_state',jsonb_build_object(
      'summary',v_cap->'summary',
      'athletic_profile',v_cap->'athletic_profile',
      'performance_context_status',v_cap#>>'{semantics,performance_context_status}'
    ),
    'skill_state',v_skill,
    'current_opportunities',v_opp->'top_opportunities',
    'current_interventions',v_interventions->'items',
    'activity_context',jsonb_build_object(
      'summary',v_progression#>'{activity,summary}',
      'current_week',v_progression#>'{activity,current_week}',
      'active_plan_consistency',v_progression#>'{activity,active_plan_consistency}',
      'weekly_load',v_progression#>'{activity,weekly_load}'
    ),
    'trajectory_contract',jsonb_build_object(
      'priorities_not_fixed_sessions',true,
      'capabilities_and_skill_evidence_can_change_the_next_decision',true,
      'calibration_is_a_first_class_priority_when_it_blocks_a_decision',true,
      'program_load_and_recovery_authorities_are_reused',true,
      'no_new_longitudinal_muscle_threshold_is_activated',true,
      'prg_002_longitudinal_rebalance_status','PENDING_PRODUCT_ARBITRATION'
    )
  );
end;
$$;
revoke all on function public.w3_trajectory_snapshot_v1(uuid,date) from public,anon;
grant execute on function public.w3_trajectory_snapshot_v1(uuid,date) to authenticated,service_role;

comment on table public.coach_intervention_catalog is 'W3 LIM-002 intervention-type library. Generic intervention categories may be auto-mapped only from evidence-backed W3 opportunities; specific-strength causal prescriptions remain curated-only.';
comment on function public.w3_trajectory_snapshot_v1(uuid,date) is 'W3 PRG-001 sliding 28-day trajectory snapshot: priorities, capabilities, Skill, calibration and load; it deliberately avoids fixed future sessions and leaves PRG-002 longitudinal muscle rebalance pending arbitration.';
