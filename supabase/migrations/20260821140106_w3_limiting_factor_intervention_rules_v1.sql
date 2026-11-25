insert into public.coach_intervention_catalog(intervention_key,category,label,description,auto_assignment_policy,active,version)
values
('PREREQUISITE_CAPABILITY_DEVELOPMENT','skill','Développer le prérequis','Consolider le mouvement prérequis explicitement documenté avant de débloquer l’étape Skill cible.','AUTO_ONLY_FROM_SOURCE_BACKED_CAUSAL_PREREQUISITE_AND_EXISTING_PI_DEVELOPMENT_STATE',true,'w3-intervention-catalog-v1.1'),
('COMPONENT_SKILL_CONSOLIDATION','skill','Consolider le composant','Travailler séparément le composant documenté comme nécessaire avant de recombiner le mouvement complet.','AUTO_ONLY_FROM_SOURCE_BACKED_COMPONENT_PREREQUISITE_AND_EXISTING_PI_DEVELOPMENT_STATE',true,'w3-intervention-catalog-v1.1'),
('BASE_PATTERN_BEFORE_LOAD','progression','Consolider avant de charger','Consolider la version de base documentée avant d’ajouter de la charge externe.','AUTO_ONLY_FROM_SOURCE_BACKED_LOAD_PROGRESSION_AND_EXISTING_PI_DEVELOPMENT_STATE',true,'w3-intervention-catalog-v1.1')
on conflict(intervention_key) do update set
 category=excluded.category,label=excluded.label,description=excluded.description,
 auto_assignment_policy=excluded.auto_assignment_policy,active=true,version=excluded.version;

create table if not exists public.coach_factor_intervention_rules (
  edge_role text primary key,
  intervention_key text not null references public.coach_intervention_catalog(intervention_key),
  target_policy text not null check (target_policy in ('PREREQUISITE_EXERCISE')),
  rationale text not null,
  version text not null default 'w3-factor-intervention-rules-v1',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.coach_factor_intervention_rules enable row level security;
drop policy if exists coach_factor_intervention_rules_read on public.coach_factor_intervention_rules;
create policy coach_factor_intervention_rules_read on public.coach_factor_intervention_rules for select to authenticated using (true);
revoke all on public.coach_factor_intervention_rules from anon;
grant select on public.coach_factor_intervention_rules to authenticated,service_role;

insert into public.coach_factor_intervention_rules(edge_role,intervention_key,target_policy,rationale,version,active)
values
('SOURCE_BACKED_CAPABILITY_PREREQUISITE','PREREQUISITE_CAPABILITY_DEVELOPMENT','PREREQUISITE_EXERCISE','A source-backed prerequisite plus an existing PI DEVELOP/CONSOLIDATE state can justify developing that exact prerequisite. Structural path order alone can never trigger this rule.','w3-factor-intervention-rules-v1',true),
('SOURCE_BACKED_COMPONENT_PREREQUISITE','COMPONENT_SKILL_CONSOLIDATION','PREREQUISITE_EXERCISE','When an official source identifies a component as necessary for a combined lift, an existing PI development state on that component can justify isolated consolidation before recombination.','w3-factor-intervention-rules-v1',true),
('SOURCE_BACKED_LOAD_PROGRESSION','BASE_PATTERN_BEFORE_LOAD','PREREQUISITE_EXERCISE','When the source-backed relation is explicitly base-pattern before external load, an existing PI development state can justify consolidating the unloaded/base pattern first.','w3-factor-intervention-rules-v1',true)
on conflict(edge_role) do update set intervention_key=excluded.intervention_key,target_policy=excluded.target_policy,
 rationale=excluded.rationale,version=excluded.version,active=true,updated_at=now();

create or replace function public.w3_limiting_factor_interventions_v1(
  p_user_id uuid,
  p_path_key text,
  p_target_exercise_id text,
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
  v_lim jsonb;
  v_all jsonb:='[]'::jsonb;
  v_top jsonb:='[]'::jsonb;
  v_status text;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;
  v_lim:=public.w3_limiting_factor_snapshot_v1(p_user_id,p_path_key,p_target_exercise_id,v_anchor);

  with evaluated as (
    select p.value factor,
           p.value->>'evaluation_status' evaluation_status,
           p.value->>'prerequisite_exercise_id' prerequisite_exercise_id,
           p.value->>'prerequisite_exercise_name' prerequisite_exercise_name,
           p.value#>>'{requirement,edge_role}' edge_role,
           p.value#>>'{requirement,source_title}' source_title,
           p.value#>>'{requirement,source_url}' source_url,
           nullif(p.value->>'pi_priority_score','')::numeric pi_priority_score,
           nullif(p.value->>'pi_confidence','')::numeric pi_confidence
    from jsonb_array_elements(coalesce(v_lim->'prerequisites','[]'::jsonb)) p(value)
    where p.value->>'evaluation_status' in ('CALIBRATION_NEEDED','PROBABLE_LIMITING_FACTOR')
  ), mapped as (
    select e.*,
           case when e.evaluation_status='CALIBRATION_NEEDED' then 'CALIBRATION_CONTROLLED' else r.intervention_key end intervention_key,
           r.rationale rule_rationale,
           public.w3_equipment_gap_for_exercise_v1(p_user_id,e.prerequisite_exercise_id) equipment_gap
    from evaluated e
    left join public.coach_factor_intervention_rules r on r.edge_role=e.edge_role and r.active
  ), objects as (
    select jsonb_strip_nulls(jsonb_build_object(
      'evaluation_status',m.evaluation_status,
      'target_skill_exercise_id',p_target_exercise_id,
      'target_skill_exercise_name',v_lim#>>'{target,exercise_name}',
      'target_exercise_id',m.prerequisite_exercise_id,
      'target_exercise_name',m.prerequisite_exercise_name,
      'intervention_key',c.intervention_key,
      'category',c.category,
      'label',c.label,
      'description',c.description,
      'auto_assignment_policy',c.auto_assignment_policy,
      'execution_readiness',case when m.equipment_gap->>'status'='AVAILABLE' then 'AVAILABLE' else m.equipment_gap->>'status' end,
      'equipment_gap',m.equipment_gap,
      'dose_policy','RESOLVE_WITH_EXISTING_CAPABILITY_AND_SESSION_ENGINE_AT_GENERATION_TIME',
      'user_reason',case
        when m.evaluation_status='CALIBRATION_NEEDED' then 'Il manque une observation fiable sur '||coalesce(m.prerequisite_exercise_name,'ce prérequis')||' pour décider proprement de la suite.'
        else coalesce(m.prerequisite_exercise_name,'Ce prérequis')||' est un prérequis documenté de '||coalesce(v_lim#>>'{target,exercise_name}','l’étape cible')||' et tes données actuelles demandent encore de le développer.'
      end,
      'source',jsonb_strip_nulls(jsonb_build_object('title',m.source_title,'url',m.source_url,'graph_source',m.factor->>'graph_source','graph_version',m.factor->>'graph_version')),
      'factor_evidence',m.factor,
      'rule_rationale',case when m.evaluation_status='CALIBRATION_NEEDED' then 'Calibration only: missing evidence must not be converted into a weakness.' else m.rule_rationale end,
      'pi_priority_score',m.pi_priority_score,
      'pi_confidence',m.pi_confidence
    )) obj,
    m.evaluation_status,m.pi_priority_score,m.prerequisite_exercise_id
    from mapped m
    left join public.coach_intervention_catalog c on c.intervention_key=m.intervention_key and c.active
    where m.intervention_key is not null
  )
  select coalesce(jsonb_agg(obj order by
           case when evaluation_status='CALIBRATION_NEEDED' then 0 else 1 end,
           coalesce(pi_priority_score,-1) desc,prerequisite_exercise_id),'[]'::jsonb)
  into v_all
  from objects;

  select coalesce(jsonb_agg(value order by ord),'[]'::jsonb)
  into v_top
  from (
    select value,ord
    from jsonb_array_elements(v_all) with ordinality q(value,ord)
    order by ord
    limit 2
  ) s;

  v_status:=case
    when v_lim->>'status'='MODEL_INCOMPLETE' then 'MODEL_INCOMPLETE'
    when jsonb_array_length(v_top)>0 and exists(select 1 from jsonb_array_elements(v_top) x where x->>'evaluation_status'='CALIBRATION_NEEDED') then 'CALIBRATION_REQUIRED'
    when jsonb_array_length(v_top)>0 then 'INTERVENTIONS_IDENTIFIED'
    when v_lim->>'status' in ('PREREQUISITES_SUPPORTED','ENTRY_NO_PREREQUISITE_REQUIRED') then 'NO_INTERVENTION_REQUIRED'
    else 'NO_ACTIONABLE_INTERVENTION'
  end;

  return jsonb_build_object(
    'version','w3-limiting-factor-interventions-v1',
    'anchor_date',v_anchor,
    'status',v_status,
    'target',v_lim->'target',
    'top_interventions',v_top,
    'all_candidates',v_all,
    'limiting_factor_snapshot',v_lim,
    'semantics',jsonb_build_object(
      'only_source_backed_causal_edges_can_map_to_development_interventions',true,
      'missing_evidence_maps_to_calibration_not_weakness',true,
      'structural_path_order_never_creates_an_intervention',true,
      'specific_dose_is_not_invented_here',true,
      'dose_is_resolved_by_existing_capability_and_session_engine',true,
      'equipment_access_is_checked_before_execution',true,
      'actual_session_health_readiness_equipment_and_program_hard_gates_still_override',true,
      'max_user_facing_interventions',2,
      'does_not_mutate_generation',true
    )
  );
end;
$$;

revoke all on function public.w3_limiting_factor_interventions_v1(uuid,text,text,date) from public,anon;
grant execute on function public.w3_limiting_factor_interventions_v1(uuid,text,text,date) to authenticated,service_role;

comment on table public.coach_factor_intervention_rules is 'W3 LIM-002 mapping from explicitly source-backed causal prerequisite role to a safe intervention category. Structural Skill order is excluded by design.';
comment on function public.w3_limiting_factor_interventions_v1(uuid,text,text,date) is 'W3 LIM-002 evidence-backed intervention resolver. Calibration is used when evidence is missing; development interventions require a curated causal prerequisite plus existing PI athlete-state evidence. No dose threshold is invented.';
