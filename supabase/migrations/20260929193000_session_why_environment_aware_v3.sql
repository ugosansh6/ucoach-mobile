-- UX: make "Pourquoi ?" useful for every real session without inventing
-- explanations. Reuse persisted session decisions and environment-specific
-- planning context as evidence.

create or replace function public.w3_session_why_v1(
  p_session_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_session public.workout_sessions%rowtype;
  v_pc jsonb;
  v_skill jsonb;
  v_focus_cycle jsonb;
  v_intent jsonb;
  v_equipment jsonb;
  v_reasons jsonb := '[]'::jsonb;
  v_skill_exercise_name text;
  v_intent_key text;
  v_progression text;
  v_env text;
  v_format text;
  v_mastery_state text;
  v_selection_outcome text;
  v_completed_exposures int;
  v_target_exposures int;
  v_duration_budget jsonb;
  v_execution_style jsonb;
  v_strength_minutes int;
  v_cardio_minutes int;
  v_running_family jsonb;
  v_place_context jsonb;
  v_running_label text;
  v_place_label text;
  v_running_mechanic text;
begin
  select * into v_session
  from public.workout_sessions
  where id=p_session_id;

  if not found then raise exception 'Session not found'; end if;
  if auth.uid() is not null and auth.uid()<>v_session.user_id then raise exception 'Forbidden user'; end if;

  v_pc:=coalesce(v_session.planning_context_json,'{}'::jsonb);
  v_skill:=coalesce(v_pc#>'{architecture,skill_path}','{}'::jsonb);
  v_focus_cycle:=coalesce(v_skill->'focus_cycle','{}'::jsonb);
  v_intent:=coalesce(
    v_pc#>'{architecture,session_intent_v2}',
    v_pc#>'{architecture,session_intent}',
    '{}'::jsonb
  );
  v_equipment:=coalesce(v_pc#>'{architecture,equipment_opportunity}','{}'::jsonb);
  v_intent_key:=upper(coalesce(v_intent->>'proposed_session_intent',v_intent->>'session_intent',''));
  v_progression:=upper(coalesce(v_session.progression_intent,''));
  v_env:=public.normalize_session_environment_v1(
    coalesce(v_session.planned_environment_code,v_pc->>'environment_code','UNKNOWN')
  );
  v_format:=upper(coalesce(v_pc->>'format_code',''));

  if coalesce((v_skill->>'applied')::boolean,false) then
    select coalesce(nullif(e.display_name,''),e.name)
    into v_skill_exercise_name
    from public.exercises e
    where e.id=v_skill->>'exercise_id';

    v_mastery_state:=upper(coalesce(v_focus_cycle->>'mastery_state',''));
    v_selection_outcome:=upper(coalesce(v_focus_cycle->>'selection_outcome',''));
    v_completed_exposures:=nullif(v_focus_cycle->>'completed_exposures','')::int;
    v_target_exposures:=nullif(v_focus_cycle->>'target_completed_exposures','')::int;

    v_reasons:=v_reasons||jsonb_build_array(jsonb_build_object(
      'type','SKILL_PATH',
      'text',case
        when v_selection_outcome='DETOUR' then
          'Aujourd’hui, le Coach choisit '||coalesce(v_skill_exercise_name,'ce Skill')||
          ' pour varier le travail technique sans changer durablement ta trajectoire.'
        when v_completed_exposures is not null
         and v_target_exposures is not null
         and v_target_exposures>v_completed_exposures then
          'On garde '||coalesce(v_skill_exercise_name,'cette étape')||
          ' dans ton parcours '||coalesce(v_skill->>'path_name','Skill')||' : '||
          v_completed_exposures||' expositions réalisées sur '||v_target_exposures||
          ' visées dans le cycle actuel. Le Coach préfère consolider cette étape avant de changer de priorité.'
        when coalesce((v_skill#>>'{mini_cycle,selected_anchor_path}')::boolean,false) then
          'On poursuit '||coalesce(v_skill_exercise_name,'cette étape')||
          ' dans ton parcours '||coalesce(v_skill->>'path_name','Skill')||
          ' pour garder la continuité du cycle technique déjà engagé.'
        else
          coalesce(v_skill_exercise_name,'Ce Skill')||
          ' est l’étape retenue aujourd’hui dans ton parcours '||
          coalesce(v_skill->>'path_name','actuel')||'.'
      end,
      'evidence',jsonb_build_object(
        'source','workout_sessions.planning_context_json.architecture.skill_path',
        'path_key',v_skill->>'path_key',
        'exercise_id',v_skill->>'exercise_id',
        'selection_source',v_skill->>'selection_source',
        'selection_outcome',v_selection_outcome,
        'mastery_state',v_mastery_state,
        'completed_exposures',v_completed_exposures,
        'target_completed_exposures',v_target_exposures
      )
    ));
  end if;

  if v_intent_key<>'' then
    v_reasons:=v_reasons||jsonb_build_array(jsonb_build_object(
      'type','SESSION_INTENT',
      'text',case v_intent_key
        when 'CONSOLIDATE' then 'Aujourd’hui, le Coach privilégie la consolidation : garder une exécution propre et reproductible plutôt que monter artificiellement la difficulté.'
        when 'SKILL_DEVELOPMENT' then 'La séance réserve volontairement de la place au travail technique : la qualité du mouvement passe avant la fatigue.'
        when 'STRENGTH_QUALITY' then 'La séance donne la priorité à un travail de force de qualité, avec assez de récupération pour préserver l’exécution.'
        when 'CONDITIONING' then 'La séance donne aujourd’hui la priorité au conditionnement prévu par ton programme.'
        when 'RECOVERY' then 'Le Coach réduit volontairement l’ambition aujourd’hui pour protéger la récupération plutôt que forcer une progression.'
        else null
      end,
      'evidence',jsonb_build_object(
        'source','workout_sessions.planning_context_json.architecture.session_intent_v2',
        'session_intent',v_intent_key,
        'reason',v_intent->>'reason'
      )
    ));
  end if;

  select coalesce(jsonb_agg(value),'[]'::jsonb)
  into v_reasons
  from jsonb_array_elements(v_reasons) value
  where nullif(value->>'text','') is not null;

  if coalesce((v_equipment->>'applied')::boolean,false)
     and coalesce(
       nullif(v_equipment->>'equipment_name',''),
       nullif(v_equipment#>>'{used_opportunities,0,name}','')
     ) is not null then
    v_reasons:=v_reasons||jsonb_build_array(jsonb_build_object(
      'type','EQUIPMENT_OPPORTUNITY',
      'text','Le Coach profite de '||
        coalesce(v_equipment->>'equipment_name',v_equipment#>>'{used_opportunities,0,name}')||
        ' aujourd’hui parce que ce matériel est disponible et qu’il peut être utilisé sans dégrader la cohérence de la séance.',
      'evidence',jsonb_build_object(
        'source','workout_sessions.planning_context_json.architecture.equipment_opportunity',
        'equipment_id',coalesce(v_equipment->>'equipment_id',v_equipment#>>'{used_opportunities,0,equipment_id}'),
        'equipment_name',coalesce(v_equipment->>'equipment_name',v_equipment#>>'{used_opportunities,0,name}'),
        'opportunity_level',coalesce(v_equipment->>'opportunity_level',v_equipment#>>'{used_opportunities,0,level}')
      )
    ));
  end if;

  -- Longitudinal progression intent is a real user-facing coaching decision and
  -- exists independently of the environment-specific planner.
  if v_progression in ('PROGRESS','MAINTAIN','DELOAD','RECALIBRATE') then
    v_reasons:=v_reasons||jsonb_build_array(jsonb_build_object(
      'type','PROGRESSION_INTENT',
      'text',case v_progression
        when 'PROGRESS' then
          'Aujourd’hui, le Coach cherche une progression contrôlée : la dose peut monter, mais seulement dans la marge que tes capacités actuelles et les garde-fous autorisent.'
        when 'MAINTAIN' then
          'Aujourd’hui, le Coach maintient volontairement la dose de travail pour consolider ce que tu sais déjà faire plutôt que monter la difficulté sans preuve suffisante.'
        when 'DELOAD' then
          'Aujourd’hui, le Coach allège volontairement la dose pour réduire la fatigue tout en gardant un stimulus utile.'
        when 'RECALIBRATE' then
          'Aujourd’hui, le Coach utilise la séance pour recalibrer tes repères avant de décider d’une nouvelle progression.'
      end,
      'evidence',jsonb_build_object(
        'source','workout_sessions.progression_intent',
        'progression_intent',v_progression
      )
    ));
  end if;

  -- GYM and OUTDOOR use specialized planners, so their useful explanation data
  -- lives at the root of planning_context_json rather than under architecture.
  if v_env='GYM' then
    v_duration_budget:=coalesce(v_pc->'duration_budget','{}'::jsonb);
    v_execution_style:=coalesce(v_pc->'execution_style','{}'::jsonb);
    v_strength_minutes:=nullif(v_duration_budget->>'strength_budget_minutes','')::int;
    v_cardio_minutes:=nullif(v_duration_budget->>'cardio_budget_minutes','')::int;

    if v_strength_minutes is not null
       or nullif(v_execution_style->>'label_fr','') is not null then
      v_reasons:=v_reasons||jsonb_build_array(jsonb_build_object(
        'type','ENVIRONMENT_STRUCTURE',
        'text',
          'En salle, le Coach '||
          case
            when v_strength_minutes is not null then
              'réserve '||v_strength_minutes||' min au travail de force'
            else
              'donne la priorité au travail de musculation'
          end||
          case
            when nullif(v_execution_style->>'label_fr','') is not null then
              ' et choisit le format « '||v_execution_style->>'label_fr'||' »'
            else ''
          end||
          case
            when coalesce(v_cardio_minutes,0)=0 then
              '. Le cardio n’est pas prioritaire sur cette séance.'
            else
              '.'
          end,
        'evidence',jsonb_build_object(
          'source','workout_sessions.planning_context_json',
          'environment_code',v_env,
          'format_code',v_format,
          'strength_budget_minutes',v_strength_minutes,
          'cardio_budget_minutes',v_cardio_minutes,
          'execution_style',v_execution_style->>'style_code'
        )
      ));
    end if;

  elsif v_env='OUTDOOR' then
    v_running_family:=coalesce(v_pc->'running_family','{}'::jsonb);
    v_place_context:=coalesce(v_pc->'place_context','{}'::jsonb);
    v_running_label:=coalesce(
      nullif(v_running_family#>>'{family,label_fr}',''),
      nullif(v_running_family->>'family_code','')
    );
    v_place_label:=coalesce(
      nullif(v_place_context->>'place_label_fr',''),
      nullif(v_place_context->>'effective_surface_code','')
    );
    v_running_mechanic:=nullif(v_running_family->>'compiled_mechanic','');

    if v_running_label is not null or v_running_mechanic is not null then
      v_reasons:=v_reasons||jsonb_build_array(jsonb_build_object(
        'type','ENVIRONMENT_STRUCTURE',
        'text',
          'Dehors, le Coach retient '||
          coalesce(lower(v_running_label),'un travail de conditionnement structuré')||
          case when v_place_label is not null then ' sur le contexte « '||v_place_label||' »' else '' end||
          case
            when coalesce((v_running_family->>'reliable_distance')::boolean,false)=false then
              '. La distance n’étant pas considérée comme fiable, le protocole peut se piloter au temps plutôt que forcer une distance.'
            else '.'
          end,
        'evidence',jsonb_build_object(
          'source','workout_sessions.planning_context_json.running_family',
          'environment_code',v_env,
          'format_code',v_format,
          'family_code',v_running_family->>'family_code',
          'compiled_mechanic',v_running_mechanic,
          'surface_code',v_place_context->>'effective_surface_code',
          'reliable_distance',v_running_family->>'reliable_distance'
        )
      ));
    end if;
  end if;

  select coalesce(jsonb_agg(value),'[]'::jsonb)
  into v_reasons
  from (
    select value
    from jsonb_array_elements(v_reasons)
    where nullif(value->>'text','') is not null
    limit 3
  ) q;

  return jsonb_build_object(
    'version','w3-session-why-v3-environment-aware',
    'session_id',p_session_id,
    'status',case when jsonb_array_length(v_reasons)>0 then 'TRACEABLE' else 'NO_USEFUL_REASON' end,
    'reasons',v_reasons,
    'reason_count',jsonb_array_length(v_reasons),
    'semantics',jsonb_build_object(
      'user_value_filter',true,
      'no_duration_filler_reason',true,
      'raw_internal_scores_hidden',true,
      'each_reason_carries_evidence',true,
      'specialized_environment_context_supported',true,
      'progression_intent_explained',true
    )
  );
end;
$function$;
