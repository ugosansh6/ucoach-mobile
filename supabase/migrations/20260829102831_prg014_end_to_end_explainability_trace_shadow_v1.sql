create or replace function public.program_coach_explainability_trace_v1(
  p_user_id uuid,
  p_anchor_date date default current_date,
  p_readiness text default null,
  p_pain_zones text[] default null,
  p_session_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_anchor date := coalesce(p_anchor_date,current_date);
  v_diag jsonb;
  v_priority jsonb;
  v_strategy jsonb;
  v_role jsonb;
  v_dose jsonb;
  v_week jsonb;
  v_primary jsonb;
  v_chain jsonb := '[]'::jsonb;
  v_environment jsonb := null;
  v_first_slot jsonb := null;
  v_session public.workout_sessions%rowtype;
  v_session_why jsonb := null;
  v_exercises jsonb := '[]'::jsonb;
  v_session_trace_status text := null;
  v_traceable_exercises int := 0;
  v_untraceable_exercises int := 0;
  v_core_traceable boolean := true;
begin
  if p_user_id is null then raise exception 'User required'; end if;
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;

  v_diag := public.program_coach_programming_diagnostic_v1(p_user_id,v_anchor);
  v_priority := public.program_coach_cycle_priority_resolver_v1(p_user_id,v_anchor);
  v_strategy := public.program_coach_strategy_review_v1(p_user_id,v_anchor);
  v_role := public.program_coach_session_role_v1(p_user_id,v_anchor,p_readiness,p_pain_zones);
  v_dose := public.program_coach_dose_trajectory_v1(p_user_id,v_anchor,null,20,p_readiness,3,p_pain_zones);
  v_week := public.program_coach_ideal_week_projection_v1(p_user_id,v_anchor,p_readiness,p_pain_zones);
  v_primary := v_priority->'primary_priority';

  v_chain := v_chain || jsonb_build_array(jsonb_build_object(
    'step','GOAL',
    'status',case when nullif(v_priority->>'primary_goal','') is null then 'NOT_TRACEABLE' else 'TRACEABLE' end,
    'decision',v_priority->>'primary_goal',
    'reason_codes',case when nullif(v_priority->>'primary_goal','') is null then '[]'::jsonb else jsonb_build_array('PRIMARY_GOAL_DIRECTION') end,
    'user_text_fr',case when nullif(v_priority->>'primary_goal','') is null then null else 'Objectif principal : '||v_priority->>'primary_goal'||'.' end,
    'evidence_ref','program_coach_cycle_priority_resolver_v1.primary_goal'
  ));
  if nullif(v_priority->>'primary_goal','') is null then v_core_traceable:=false; end if;

  v_chain := v_chain || jsonb_build_array(jsonb_build_object(
    'step','CYCLE_PRIORITY',
    'status',case when v_primary is null or jsonb_typeof(v_primary)<>'object' then 'NOT_TRACEABLE' else 'TRACEABLE' end,
    'decision',v_primary,
    'reason_codes',coalesce(v_primary->'reason_codes','[]'::jsonb),
    'user_text_fr',case
      when v_primary is null or jsonb_typeof(v_primary)<>'object' then null
      when v_primary->>'programming_state'='CALIBRATE' then 'Priorité actuelle : calibrer '||coalesce(v_primary->>'key','la capacité ciblée')||' avant de décider de la suite.'
      when v_primary->>'programming_state'='MAINTAIN' then 'Priorité actuelle : maintenir '||coalesce(v_primary->>'key','la capacité ciblée')||'.'
      else 'Priorité actuelle : développer '||coalesce(v_primary->>'key','la capacité ciblée')||'.'
    end,
    'evidence_ref','program_coach_cycle_priority_resolver_v1.primary_priority',
    'continuity_action',v_priority#>>'{continuity,action}'
  ));
  if v_primary is null or jsonb_typeof(v_primary)<>'object' then v_core_traceable:=false; end if;

  v_chain := v_chain || jsonb_build_array(jsonb_build_object(
    'step','STRATEGY_REVIEW',
    'status',case when nullif(v_strategy->>'recommended_action','') is null then 'NOT_TRACEABLE' else 'TRACEABLE' end,
    'decision',v_strategy->>'recommended_action',
    'reason_codes',case when nullif(v_strategy->>'reason_code','') is null then '[]'::jsonb else jsonb_build_array(v_strategy->>'reason_code') end,
    'user_text_fr',case upper(coalesce(v_strategy->>'recommended_action',''))
      when 'CONTINUE' then 'La stratégie actuelle est maintenue : aucune raison corroborée ne justifie de la changer.'
      when 'CONSOLIDATE' then 'La stratégie reste valable, mais la dose doit être consolidée pour laisser la récupération suivre.'
      when 'RETEST' then 'Le Coach demande un retest comparable avant de juger la stratégie.'
      when 'EXTEND_AND_REVIEW_FUTURE_FREQUENCY' then 'Le Coach prolonge l’observation et revoit la fréquence future plutôt que de considérer le programme comme inefficace.'
      when 'SWITCH_INTERVENTION' then 'Une stagnation explicitement confirmée avec une adhérence suffisante justifie de changer l’intervention.'
      when 'REVIEW_NEXT_PRIORITY' then 'Le progrès est confirmé ; le Coach peut maintenant revoir la prochaine priorité.'
      when 'CALIBRATE_DECISION_BLOCKING_UNKNOWN' then 'Une information importante manque encore ; le Coach la calibre avant de changer de stratégie.'
      else null
    end,
    'evidence_ref','program_coach_strategy_review_v1',
    'plateau_status',v_strategy#>>'{plateau_assessment,status}'
  ));
  if nullif(v_strategy->>'recommended_action','') is null then v_core_traceable:=false; end if;

  v_chain := v_chain || jsonb_build_array(jsonb_build_object(
    'step','WEEK_PROJECTION',
    'status',case when nullif(v_week->>'status','') is null then 'NOT_TRACEABLE' else 'TRACEABLE' end,
    'decision',v_week->>'status',
    'reason_codes',to_jsonb(array_remove(array[
      case when coalesce((v_week->>'completed_session_count')::int,0)>0 then 'COMPLETED_ACTUALS_INCLUDED' end,
      case when coalesce((v_week->>'existing_claimed_session_count')::int,0)>0 then 'CLAIMED_RESERVES_CAPACITY_NOT_STIMULUS' end,
      case when coalesce((v_week->>'expired_soft_opportunities')::int,0)>0 then 'EXPIRED_SOFT_OPPORTUNITIES_NO_DEBT' end,
      case when v_week->>'status'='WEEK_PROJECTED_ENVIRONMENT_ACCESS_UNDECLARED' then 'ENVIRONMENT_ACCESS_UNDECLARED' end
    ],null)),
    'user_text_fr',case
      when v_week->>'status'='WEEK_TARGET_ALREADY_COMPLETED' then 'L’objectif de fréquence de la semaine est déjà réalisé.'
      when v_week->>'status'='NO_REMAINING_SCHEDULED_OPPORTUNITY_THIS_WEEK' then 'Il ne reste pas de créneau conseillé cette semaine ; aucune séance manquée n’est transformée en dette.'
      when v_week->>'status'='PARTIAL_WEEK_REMAINDER_NO_CATCHUP_DEBT' then 'La semaine est recalculée uniquement avec les créneaux encore possibles ; les créneaux passés ne sont pas rattrapés artificiellement.'
      else 'La semaine reste une projection souple et sera recalculée après les séances réellement réalisées.'
    end,
    'evidence_ref','program_coach_ideal_week_projection_v1',
    'completed_actual_sessions',coalesce((v_week->>'completed_session_count')::int,0),
    'claimed_not_realized_sessions',coalesce((v_week->>'existing_claimed_session_count')::int,0),
    'new_projection_opportunities',coalesce((v_week->>'new_projection_opportunities')::int,0),
    'expired_soft_opportunities',coalesce((v_week->>'expired_soft_opportunities')::int,0)
  ));

  v_chain := v_chain || jsonb_build_array(jsonb_build_object(
    'step','SESSION_ROLE',
    'status',case when nullif(v_role->>'recommended_role','') is null then 'NOT_TRACEABLE' else 'TRACEABLE' end,
    'decision',v_role->>'recommended_role',
    'reason_codes',to_jsonb(array_remove(array[v_role->>'role_reason'],null)),
    'user_text_fr',case upper(coalesce(v_role->>'recommended_role',''))
      when 'DEVELOPMENT' then 'La prochaine séance utile a un rôle de développement sur la priorité active.'
      when 'CONSOLIDATION' then 'La prochaine séance privilégie la consolidation plutôt qu’une hausse de difficulté.'
      when 'MAINTENANCE' then 'La prochaine séance sert principalement à maintenir une capacité sans en faire la priorité du cycle.'
      when 'CALIBRATION' then 'La prochaine séance sert à obtenir une référence exploitable avant de progresser.'
      when 'RETEST' then 'La prochaine séance doit produire une mesure comparable pour vérifier l’adaptation.'
      when 'REDUCED_STIMULUS' then 'La prochaine séance réduit le stimulus pour respecter la récupération.'
      else null
    end,
    'evidence_ref','program_coach_session_role_v1',
    'recovery_state',v_role->>'recovery_state',
    'block_phase',v_role->>'block_phase'
  ));
  if nullif(v_role->>'recommended_role','') is null then v_core_traceable:=false; end if;

  v_chain := v_chain || jsonb_build_array(jsonb_build_object(
    'step','DOSE_TRAJECTORY',
    'status',case when nullif(v_dose->>'trajectory_action','') is null then 'NOT_TRACEABLE' else 'TRACEABLE' end,
    'decision',v_dose->>'trajectory_action',
    'reason_codes',coalesce(v_dose->'reason_codes','[]'::jsonb),
    'user_text_fr',case upper(coalesce(v_dose->>'trajectory_action',''))
      when 'PROGRESS' then 'Le Coach peut faire progresser la dose, mais uniquement à l’intérieur des garde-fous existants ; progresser ne veut pas dire augmenter à chaque séance.'
      when 'MAINTAIN' then 'Le Coach conserve une dose comparable tant que les actuals ne justifient pas un changement.'
      when 'CONSOLIDATE' then 'Le Coach réduit ou stabilise la dose pour consolider l’adaptation.'
      when 'RECALIBRATE' then 'Le Coach cherche d’abord une référence fiable avant d’augmenter la dose.'
      when 'REDUCE' then 'Le Coach réduit la dose en réponse au contexte de récupération.'
      else null
    end,
    'evidence_ref','program_coach_dose_trajectory_v1',
    'anchor_exercise',case when v_dose->'anchor_candidate' is null then null else jsonb_build_object(
      'exercise_id',v_dose#>>'{anchor_candidate,exercise_id}',
      'exercise_name',v_dose#>>'{anchor_candidate,exercise_name}',
      'movement_pattern',v_dose#>>'{anchor_candidate,movement_pattern}',
      'source',v_dose#>>'{anchor_candidate,source}',
      'mastery_state',v_dose#>>'{anchor_candidate,mastery,mastery_state}'
    ) end,
    'variant_progression_allowed',coalesce((v_dose->>'variant_progression_allowed')::boolean,false)
  ));

  if jsonb_array_length(coalesce(v_week->'projected_slots','[]'::jsonb))>0 then
    v_first_slot := (v_week->'projected_slots')->0;
    v_environment := v_first_slot->'environment_recommendation';
  end if;

  v_chain := v_chain || jsonb_build_array(jsonb_build_object(
    'step','ENVIRONMENT',
    'status',case
      when v_environment is null then 'NO_CURRENT_RECOMMENDATION'
      when v_environment->>'status'='ENVIRONMENT_ACCESS_UNDECLARED' then 'ACCESS_UNDECLARED'
      when nullif(v_environment->>'recommended_environment','') is null then 'USER_CHOICE_WITHIN_DECLARED_ACCESS'
      else 'TRACEABLE'
    end,
    'decision',case when v_environment is null then null else v_environment->>'recommended_environment' end,
    'reason_codes',case when v_environment is null or nullif(v_environment->>'reason_code','') is null then '[]'::jsonb else jsonb_build_array(v_environment->>'reason_code') end,
    'user_text_fr',case
      when v_environment is null then 'Aucun environnement n’est figé ici ; il sera choisi ou recalculé au moment utile.'
      when v_environment->>'status'='ENVIRONMENT_ACCESS_UNDECLARED' then 'Le Coach ne recommande pas d’environnement tant que tes accès possibles ne sont pas déclarés.'
      when nullif(v_environment->>'recommended_environment','') is null then 'Plusieurs environnements déclarés restent valables ; aucun avantage suffisamment prouvé ne justifie d’en imposer un.'
      else 'Environnement conseillé : '||v_environment->>'recommended_environment'||'. La recommandation reste souple et doit respecter le matériel et le contexte réel.'
    end,
    'evidence_ref','program_coach_ideal_week_projection_v1.projected_slots.environment_recommendation',
    'recommendation_strength',case when v_environment is null then null else v_environment->>'recommendation_strength' end,
    'requires_confirmation',case when v_environment is null then '[]'::jsonb else coalesce(v_environment->'requires_confirmation','[]'::jsonb) end
  ));

  if p_session_id is not null then
    select * into v_session from public.workout_sessions where id=p_session_id;
    if not found then raise exception 'Session not found'; end if;
    if v_session.user_id<>p_user_id then raise exception 'Session does not belong to user'; end if;

    v_session_why := public.w3_session_why_v1(p_session_id);

    select coalesce(jsonb_agg(jsonb_build_object(
      'session_exercise_id',wse.id,
      'exercise_id',wse.exercise_id,
      'exercise_name',wse.exercise_name,
      'block_key',wse.block_key,
      'position',wse.position,
      'selection_provenance',wse.selection_provenance,
      'trace_status',case
        when wse.selection_provenance='USER_SELECTED' then 'TRACEABLE_USER_SELECTION'
        when wse.selection_provenance='UGEROD_ADDED_PREP' then 'TRACEABLE_UGEROD_PREPARATION'
        when nullif(wse.solver_decision_json#>>'{progression_intelligence,skill_user_feedback_reason}','') is not null then 'TRACEABLE_EXPLICIT_PROGRESSION_SIGNAL'
        else 'EXACT_SELECTION_CAUSE_NOT_TRACEABLE'
      end,
      'causality_level',case
        when wse.selection_provenance='USER_SELECTED' then 'DIRECT_USER_CHOICE'
        when wse.selection_provenance='UGEROD_ADDED_PREP' then 'DIRECT_SYSTEM_PREPARATION_RULE'
        when nullif(wse.solver_decision_json#>>'{progression_intelligence,skill_user_feedback_reason}','') is not null then 'EXPLICIT_PROGRESS_SIGNAL'
        else 'NOT_CLAIMED'
      end,
      'reason_code',case
        when wse.selection_provenance='USER_SELECTED' then 'USER_SELECTED'
        when wse.selection_provenance='UGEROD_ADDED_PREP' then 'UGEROD_ADDED_PREP'
        else nullif(wse.solver_decision_json#>>'{progression_intelligence,skill_user_feedback_reason}','')
      end,
      'user_text_fr',case
        when wse.selection_provenance='USER_SELECTED' then 'Exercice choisi par l’utilisateur.'
        when wse.selection_provenance='UGEROD_ADDED_PREP' then 'Exercice ajouté automatiquement par UGEROD pour préparer la séance.'
        when wse.solver_decision_json#>>'{progression_intelligence,skill_user_feedback_reason}'='NEXT_CURATED_VARIANT_AFTER_USER_CONFIRMED_TOO_EASY' then 'Variante suivante du parcours proposée après le retour utilisateur indiquant que l’étape précédente était trop facile.'
        when wse.solver_decision_json#>>'{progression_intelligence,skill_user_feedback_reason}'='USER_CONFIRMED_THIS_SKILL_TOO_EASY' then 'Le signal utilisateur « trop facile » sur cet exercice est enregistré comme information de progression, sans être transformé en preuve de maîtrise.'
        else null
      end,
      'evidence_ref',case
        when wse.selection_provenance in ('USER_SELECTED','UGEROD_ADDED_PREP') then 'workout_session_exercises.selection_provenance'
        when nullif(wse.solver_decision_json#>>'{progression_intelligence,skill_user_feedback_reason}','') is not null then 'workout_session_exercises.solver_decision_json.progression_intelligence.skill_user_feedback_reason'
        else null
      end
    ) order by case lower(wse.block_key) when 'unlock' then 1 when 'warmup' then 2 when 'warm_up' then 2 when 'skill' then 3 when 'strength' then 4 when 'wod' then 5 when 'conditioning' then 5 else 6 end,wse.position),'[]'::jsonb),
    count(*) filter(where wse.selection_provenance in ('USER_SELECTED','UGEROD_ADDED_PREP') or nullif(wse.solver_decision_json#>>'{progression_intelligence,skill_user_feedback_reason}','') is not null)::int,
    count(*) filter(where wse.selection_provenance not in ('USER_SELECTED','UGEROD_ADDED_PREP') and nullif(wse.solver_decision_json#>>'{progression_intelligence,skill_user_feedback_reason}','') is null)::int
    into v_exercises,v_traceable_exercises,v_untraceable_exercises
    from public.workout_session_exercises wse
    where wse.session_id=p_session_id;

    v_session_trace_status := case when v_untraceable_exercises=0 then 'EXACT_EXERCISE_TRACE_COMPLETE' else 'PARTIAL_EXERCISE_TRACE_NO_INVENTED_CAUSALITY' end;
  end if;

  return jsonb_build_object(
    'version','program-coach-explainability-trace-v1',
    'mode','SHADOW_READ_ONLY',
    'status',case
      when not v_core_traceable then 'PARTIAL_PROGRAM_TRACE'
      when p_session_id is not null and v_untraceable_exercises>0 then 'TRACEABLE_PROGRAM_PARTIAL_EXERCISE_CAUSALITY'
      else 'TRACEABLE'
    end,
    'anchor_date',v_anchor,
    'decision_chain',v_chain,
    'session_trace',case when p_session_id is null then null else jsonb_build_object(
      'session_id',p_session_id,
      'session_status',v_session.status,
      'planned_environment_code',v_session.planned_environment_code,
      'actual_environment_code',v_session.actual_environment_code,
      'session_why',v_session_why,
      'exercise_selection_trace_status',v_session_trace_status,
      'traceable_exercise_count',v_traceable_exercises,
      'untraceable_exact_selection_count',v_untraceable_exercises,
      'exercises',v_exercises
    ) end,
    'source_versions',jsonb_build_object(
      'diagnostic',v_diag->>'version',
      'cycle_priority',v_priority->>'version',
      'strategy_review',v_strategy->>'version',
      'session_role',v_role->>'version',
      'dose_trajectory',v_dose->>'version',
      'ideal_week',v_week->>'version',
      'session_why',case when v_session_why is null then null else v_session_why->>'version' end
    ),
    'semantics',jsonb_build_object(
      'no_raw_internal_score_exposed',true,
      'no_raw_confidence_score_exposed',true,
      'missing_trace_is_not_filled_with_invented_causality',true,
      'user_selected_and_ugerod_preparation_provenance_are_explicit',true,
      'planned_sessions_are_not_described_as_realized_stimulus',true,
      'claimed_sessions_reserve_capacity_but_are_not_actuals',true,
      'environment_recommendation_is_soft',true,
      'strategy_change_requires_supported_reason',true
    ),
    'authority',jsonb_build_object(
      'shadow_only',true,
      'read_only',true,
      'may_change_programming_decision',false,
      'may_change_session_generation',false,
      'explanation_never_creates_new_evidence',true
    )
  );
end;
$$;

revoke all on function public.program_coach_explainability_trace_v1(uuid,date,text,text[],uuid) from public;
revoke all on function public.program_coach_explainability_trace_v1(uuid,date,text,text[],uuid) from anon;
revoke all on function public.program_coach_explainability_trace_v1(uuid,date,text,text[],uuid) from authenticated;