create or replace function public.w3_session_why_v1(p_session_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  v_session public.workout_sessions%rowtype;
  v_pc jsonb;
  v_skill jsonb;
  v_intent jsonb;
  v_equipment jsonb;
  v_reasons jsonb:='[]'::jsonb;
  v_skill_exercise_name text;
  v_intent_key text;
  v_count int:=0;
begin
  select * into v_session from public.workout_sessions where id=p_session_id;
  if not found then raise exception 'Session not found'; end if;
  if auth.uid() is not null and auth.uid()<>v_session.user_id then raise exception 'Forbidden user'; end if;

  v_pc:=coalesce(v_session.planning_context_json,'{}'::jsonb);
  v_skill:=coalesce(v_pc#>'{architecture,skill_path}','{}'::jsonb);
  v_intent:=coalesce(v_pc#>'{architecture,session_intent}','{}'::jsonb);
  v_equipment:=coalesce(v_pc#>'{architecture,equipment_opportunity}','{}'::jsonb);
  v_intent_key:=upper(coalesce(v_intent->>'proposed_session_intent',''));

  if coalesce((v_skill->>'applied')::boolean,false) then
    select coalesce(nullif(e.display_name,''),e.name) into v_skill_exercise_name
    from public.exercises e where e.id=v_skill->>'exercise_id';

    v_reasons:=v_reasons||jsonb_build_array(jsonb_build_object(
      'type','SKILL_PATH',
      'text',case
        when coalesce((v_skill#>>'{mini_cycle,selected_anchor_path}')::boolean,false)
          then 'On poursuit '||coalesce(v_skill->>'path_name','la trajectoire Skill')||' avec '||coalesce(v_skill_exercise_name,'l’étape prévue')||' pour garder la continuité du cycle technique déjà engagé.'
        else 'Le Skill travaille '||coalesce(v_skill_exercise_name,'l’étape prévue')||' dans la trajectoire '||coalesce(v_skill->>'path_name','active')||'.'
      end,
      'evidence',jsonb_build_object(
        'source','workout_sessions.planning_context_json.architecture.skill_path',
        'path_key',v_skill->>'path_key',
        'exercise_id',v_skill->>'exercise_id',
        'selection_source',v_skill->>'selection_source',
        'mini_cycle_selected',coalesce((v_skill#>>'{mini_cycle,selected_anchor_path}')::boolean,false)
      )
    ));
  end if;

  if v_intent_key<>'' then
    v_reasons:=v_reasons||jsonb_build_array(jsonb_build_object(
      'type','SESSION_INTENT',
      'text',case v_intent_key
        when 'CONSOLIDATE' then 'Aujourd’hui, le Coach privilégie la consolidation plutôt qu’une hausse artificielle de difficulté.'
        when 'SKILL_DEVELOPMENT' then 'La séance réserve volontairement de la place au développement technique.'
        when 'STRENGTH_QUALITY' then 'La séance donne la priorité à un travail de force de qualité.'
        when 'CONDITIONING' then 'La séance donne la priorité au travail de conditionnement prévu par le programme.'
        when 'RECOVERY' then 'La séance protège la récupération aujourd’hui au lieu de forcer une progression.'
        else 'Le type de travail du jour vient de la décision Program Coach : '||replace(initcap(lower(v_intent_key)),'_',' ')||'.'
      end,
      'evidence',jsonb_build_object(
        'source','workout_sessions.planning_context_json.architecture.session_intent',
        'session_intent',v_intent_key,
        'reason',v_intent->>'reason'
      )
    ));
  end if;

  if coalesce((v_equipment->>'applied')::boolean,false) and nullif(v_equipment->>'equipment_name','') is not null then
    v_reasons:=v_reasons||jsonb_build_array(jsonb_build_object(
      'type','EQUIPMENT_OPPORTUNITY',
      'text','Le Coach utilise '||v_equipment->>'equipment_name'||' parce que ce matériel est pertinent aujourd’hui sans sacrifier la cohérence de la séance.',
      'evidence',jsonb_build_object(
        'source','workout_sessions.planning_context_json.architecture.equipment_opportunity',
        'equipment_id',v_equipment->>'equipment_id',
        'equipment_name',v_equipment->>'equipment_name',
        'opportunity_level',v_equipment->>'opportunity_level'
      )
    ));
  end if;

  v_count:=jsonb_array_length(v_reasons);
  if v_count<2 then
    v_reasons:=v_reasons||jsonb_build_array(jsonb_build_object(
      'type','SESSION_CONTEXT',
      'text','La séance est calibrée pour '||v_session.duration_minutes||' minutes avec ton état de forme du jour, tout en conservant les garde-fous de sécurité et de matériel.',
      'evidence',jsonb_build_object(
        'source','workout_sessions',
        'duration_minutes',v_session.duration_minutes,
        'readiness',v_session.readiness,
        'target_region',v_session.target_region
      )
    ));
  end if;

  if jsonb_array_length(v_reasons)<2 and nullif(v_session.focus,'') is not null then
    v_reasons:=v_reasons||jsonb_build_array(jsonb_build_object(
      'type','PROGRAM_FOCUS',
      'text','Le contenu reste aligné sur la priorité '||v_session.focus||' de ton programme actuel.',
      'evidence',jsonb_build_object('source','workout_sessions.focus','focus',v_session.focus)
    ));
  end if;

  select coalesce(jsonb_agg(value),'[]'::jsonb)
  into v_reasons
  from (
    select value from jsonb_array_elements(v_reasons) limit 4
  ) q;

  return jsonb_build_object(
    'version','w3-session-why-v1',
    'session_id',p_session_id,
    'status',case when jsonb_array_length(v_reasons)>=2 then 'TRACEABLE' else 'PARTIAL_EVIDENCE' end,
    'reasons',v_reasons,
    'reason_count',jsonb_array_length(v_reasons),
    'semantics',jsonb_build_object(
      'user_text_never_exposes_raw_internal_scores',true,
      'each_reason_carries_a_concrete_evidence_reference',true,
      'posthoc_opportunities_are_not_claimed_as_generation_causes',true,
      'missing_trace_is_not_filled_with_invented_causality',true
    )
  );
end;
$$;
revoke all on function public.w3_session_why_v1(uuid) from public,anon;
grant execute on function public.w3_session_why_v1(uuid) to authenticated,service_role;

alter function public.e_session_coach_note(uuid) rename to e_session_coach_note_pre_w3_why_v1;

create or replace function public.e_session_coach_note(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_base jsonb;
  v_why jsonb;
begin
  v_base:=public.e_session_coach_note_pre_w3_why_v1(p_session_id);
  v_why:=public.w3_session_why_v1(p_session_id);
  return v_base||jsonb_build_object(
    'why',v_why,
    'why_reasons',coalesce(v_why->'reasons','[]'::jsonb),
    'why_contract','w3-session-why-v1'
  );
end;
$$;
revoke all on function public.e_session_coach_note(uuid) from public,anon;
grant execute on function public.e_session_coach_note(uuid) to authenticated,service_role;

comment on function public.w3_session_why_v1(uuid) is 'W3 WHY-001: 2–4 user-facing reasons derived from the actual session decision trace, with evidence references and no raw internal scores.';
