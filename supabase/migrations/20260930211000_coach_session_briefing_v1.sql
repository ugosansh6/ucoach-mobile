-- UX-COACH-BRIEFING-V1
-- One common explanation contract for HOME / BOX / GYM / OUTDOOR.
-- It does not decide the workout. It only narrates already-persisted decisions
-- and the actual generated session, with deterministic phrasing variation.

create or replace function public.coach_briefing_pattern_label_v1(
  p_pattern text
) returns text
language sql
immutable
set search_path to 'public'
as $function$
  select case upper(coalesce(p_pattern,''))
    when 'PULL VERTICAL' then 'le dos et le tirage vertical'
    when 'PULL HORIZONTAL' then 'le dos et le tirage horizontal'
    when 'PUSH HORIZONTAL' then 'la poussée du haut du corps, surtout les pectoraux'
    when 'PUSH VERTICAL' then 'les épaules et la poussée verticale'
    when 'SQUAT' then 'les jambes, surtout le travail de squat'
    when 'LUNGE' then 'les jambes avec davantage de travail unilatéral'
    when 'HINGE' then 'la chaîne postérieure'
    when 'CORE' then 'le gainage et le contrôle du tronc'
    when 'ROTATION' then 'le tronc et la rotation'
    when 'ANTI-ROTATION' then 'le gainage et l’anti-rotation'
    when 'CARRY' then 'le portage et le gainage'
    when 'JUMP' then 'l’explosivité'
    when 'CONDITIONING' then 'le cardio et le conditioning'
    when 'LOCOMOTION' then 'le cardio et la locomotion'
    else null
  end;
$function$;

create or replace function public.coach_session_briefing_v1(
  p_session_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  s public.workout_sessions%rowtype;
  pc jsonb;
  arch jsonb;
  v_env text;
  v_variant int:=0;
  v_text text:='';
  v_goal text:='';
  v_reason text:='';
  v_future text:='';
  v_extra text:='';
  v_evidence jsonb:='[]'::jsonb;

  v_primary_pattern text;
  v_secondary_pattern text;
  v_primary_label text;
  v_secondary_label text;
  v_focus text;
  v_focus_label text;
  v_progression text;
  v_readiness text;

  v_skill jsonb;
  v_skill_name text;
  v_skill_completed int;
  v_skill_target int;
  v_skill_applied boolean:=false;

  v_retest jsonb;
  v_retest_exercise_id text;
  v_retest_exercise_name text;
  v_retest_active boolean:=false;

  v_pi jsonb;
  v_recalibration_pattern text;
  v_recalibration_label text;

  v_pattern_complement jsonb;
  v_complement_applied boolean:=false;
  v_replaced_pattern text;
  v_added_pattern text;
  v_replaced_label text;
  v_added_label text;

  v_equipment jsonb;
  v_equipment_applied boolean:=false;
  v_equipment_name text;
  v_equipment_level text;

  v_duration_budget jsonb;
  v_execution_style jsonb;
  v_cardio_minutes int:=0;
  v_strength_minutes int:=0;

  v_running_family jsonb;
  v_place_context jsonb;
  v_running_label text;
  v_surface_label text;
  v_reliable_distance boolean:=true;

  v_force_role text;
  v_conditioning_role text;
  v_has_conditioning boolean:=false;
begin
  select * into s
  from public.workout_sessions
  where id=p_session_id;

  if not found then raise exception 'Session not found'; end if;
  if auth.uid() is not null and auth.uid()<>s.user_id then raise exception 'Forbidden user'; end if;

  pc:=coalesce(s.planning_context_json,'{}'::jsonb);
  arch:=coalesce(pc->'architecture','{}'::jsonb);
  v_env:=public.normalize_session_environment_v1(
    coalesce(s.planned_environment_code,pc->>'environment_code','UNKNOWN')
  );
  v_variant:=mod(abs(hashtextextended(p_session_id::text,0)),4)::int;
  v_focus:=upper(coalesce(s.focus,'GENERAL FITNESS'));
  v_progression:=upper(coalesce(s.progression_intent,''));
  v_readiness:=lower(coalesce(s.readiness,'normal'));

  select p.patterns[1],p.patterns[2]
  into v_primary_pattern,v_secondary_pattern
  from (
    select array_agg(movement_pattern order by cnt desc, first_pos) patterns
    from (
      select
        e.movement_pattern,
        count(*)::int cnt,
        min((b_ord*1000)+e_ord)::int first_pos
      from jsonb_array_elements(
             case when jsonb_typeof(s.generated_workout->'blocks')='array'
               then s.generated_workout->'blocks' else '[]'::jsonb end
           ) with ordinality b(block,b_ord)
      cross join lateral jsonb_array_elements(
        case when jsonb_typeof(block->'exercises')='array'
          then block->'exercises' else '[]'::jsonb end
      ) with ordinality x(ex,e_ord)
      join public.exercises e on e.id=ex->>'exercise_id'
      where lower(coalesce(block->>'block_key','')) in ('skill','strength','wod','conditioning')
        and nullif(e.movement_pattern,'') is not null
      group by e.movement_pattern
    ) z
  ) p;

  v_primary_label:=public.coach_briefing_pattern_label_v1(v_primary_pattern);
  v_secondary_label:=public.coach_briefing_pattern_label_v1(v_secondary_pattern);

  v_has_conditioning:=exists(
    select 1
    from jsonb_array_elements(
      case when jsonb_typeof(s.generated_workout->'blocks')='array'
        then s.generated_workout->'blocks' else '[]'::jsonb end
    ) b
    where lower(coalesce(b->>'block_key',''))='conditioning'
  );

  v_focus_label:=case v_focus
    when 'STRENGTH' then 'ta force'
    when 'MUSCLE GAIN' then 'le travail musculaire'
    when 'CONDITIONING' then 'ton conditioning'
    when 'FAT LOSS' then 'un travail dynamique et complet'
    when 'SKILL' then 'la technique'
    else 'un travail complet'
  end;

  -- The opening describes the workout that was actually generated.
  if v_env='OUTDOOR' then
    v_running_family:=coalesce(pc->'running_family','{}'::jsonb);
    v_place_context:=coalesce(pc->'place_context','{}'::jsonb);
    v_running_label:=coalesce(
      nullif(v_running_family#>>'{family,label_fr}',''),
      case upper(coalesce(v_running_family->>'compiled_mechanic',''))
        when 'RUN_INTERVALS' then 'des intervalles de course'
        when 'RUN_FARTLEK' then 'un fartlek'
        when 'RUN_CONTINUOUS' then 'une course continue'
        else null
      end,
      'un travail de conditioning dehors'
    );
    v_surface_label:=coalesce(
      nullif(v_place_context->>'place_label_fr',''),
      nullif(v_place_context->>'effective_surface_code','')
    );
    v_reliable_distance:=coalesce(
      nullif(v_running_family->>'reliable_distance','')::boolean,
      true
    );

    v_goal:=case v_variant
      when 0 then concat('Aujourd’hui, on va surtout travailler ton conditioning avec ',lower(v_running_label),'.')
      when 1 then concat('Je te propose une séance dehors construite autour de ',lower(v_running_label),'.')
      when 2 then concat('On va profiter de cette séance dehors pour remettre ',lower(v_running_label),' au centre du travail.')
      else concat('Pour cette séance, je préfère un travail de conditioning basé sur ',lower(v_running_label),'.')
    end;
  else
    if v_primary_label is not null then
      v_goal:=case v_variant
        when 0 then concat('Aujourd’hui, je veux surtout travailler ',v_focus_label,' avec un accent sur ',v_primary_label,'.')
        when 1 then concat('On va mettre l’accent sur ',v_primary_label,' aujourd’hui, tout en gardant ',v_focus_label,' comme fil conducteur.')
        when 2 then concat('Je te propose une séance centrée sur ',v_primary_label,', avec l’idée de faire avancer ',v_focus_label,'.')
        else concat('Pour cette séance, je préfère orienter le travail vers ',v_primary_label,' plutôt que de partir sur quelque chose de trop dispersé.')
      end;
    else
      v_goal:=case v_variant
        when 0 then concat('Aujourd’hui, je veux surtout faire avancer ',v_focus_label,'.')
        when 1 then concat('On garde ',v_focus_label,' comme priorité sur cette séance.')
        when 2 then concat('Je te propose une séance construite pour faire progresser ',v_focus_label,'.')
        else concat('Pour cette séance, je préfère rester centré sur ',v_focus_label,'.')
      end;
    end if;
  end if;

  v_evidence:=v_evidence||jsonb_build_array(jsonb_build_object(
    'type','SESSION_CONTENT',
    'environment',v_env,
    'focus',s.focus,
    'target_region',s.target_region,
    'primary_pattern',v_primary_pattern,
    'secondary_pattern',v_secondary_pattern
  ));

  -- Strongest longitudinal reason: retest / calibration already persisted.
  v_retest:=coalesce(arch->'retest_contract_v1','{}'::jsonb);
  v_retest_active:=coalesce((v_retest->>'today_has_natural_retest')::boolean,false)
    or coalesce((v_retest->>'today_requires_reference_selection')::boolean,false);

  if v_retest_active then
    v_retest_exercise_id:=coalesce(
      nullif(v_retest#>>'{natural_capture_item,exercise_id}',''),
      nullif(v_retest#>>'{selection_required_items,0,exercise_id}',''),
      nullif(v_retest#>>'{eligible_items,0,exercise_id}','')
    );
    if v_retest_exercise_id is not null then
      select coalesce(nullif(display_name,''),name)
      into v_retest_exercise_name
      from public.exercises
      where id=v_retest_exercise_id;
    end if;

    v_reason:=case v_variant
      when 0 then concat(
        'J’aimerais aussi reprendre un repère',
        case when v_retest_exercise_name is not null then concat(' sur ',v_retest_exercise_name) else '' end,
        ' : les informations que j’ai ne sont pas assez récentes pour faire évoluer la suite proprement.'
      )
      when 1 then concat(
        'Ça fait un moment que je n’ai pas eu une référence suffisamment fiable',
        case when v_retest_exercise_name is not null then concat(' sur ',v_retest_exercise_name) else '' end,
        ', donc je profite de cette séance pour voir où tu en es vraiment.'
      )
      when 2 then concat(
        'Je veux profiter de la séance pour reprendre une mesure propre',
        case when v_retest_exercise_name is not null then concat(' sur ',v_retest_exercise_name) else '' end,
        ' avant de monter la difficulté.'
      )
      else concat(
        'Il me manque encore un bon repère récent',
        case when v_retest_exercise_name is not null then concat(' sur ',v_retest_exercise_name) else '' end,
        ', et cette séance est une bonne occasion de le récupérer.'
      )
    end;

    v_future:=case v_variant
      when 0 then 'Ce que tu fais aujourd’hui me servira de base pour régler plus précisément les prochaines séances.'
      when 1 then 'À partir de cette référence, je pourrai ajuster la suite avec beaucoup plus de précision.'
      when 2 then 'Si la référence est propre, je pourrai ensuite faire évoluer la difficulté sans avancer à l’aveugle.'
      else 'Ça me donnera un point de départ fiable pour les semaines qui suivent.'
    end;

    v_evidence:=v_evidence||jsonb_build_array(jsonb_build_object(
      'type','RETEST',
      'source','planning_context.architecture.retest_contract_v1',
      'exercise_id',v_retest_exercise_id,
      'status',v_retest->>'status'
    ));
  end if;

  -- Calibration signal already persisted by Progression Intelligence.
  if v_reason='' then
    v_pi:=coalesce(pc->'progression_intelligence','{}'::jsonb);
    v_recalibration_pattern:=nullif(
      v_pi#>>'{session_recommendation,recalibration_patterns,0}',
      ''
    );
    v_recalibration_label:=public.coach_briefing_pattern_label_v1(v_recalibration_pattern);

    if v_recalibration_pattern is not null then
      v_reason:=case v_variant
        when 0 then concat('J’aimerais aussi reprendre un repère sur ',coalesce(v_recalibration_label,lower(v_recalibration_pattern)),' avant de te faire progresser davantage.')
        when 1 then concat('Je manque encore d’une référence assez solide sur ',coalesce(v_recalibration_label,lower(v_recalibration_pattern)),', donc je préfère recalibrer ça aujourd’hui.')
        when 2 then concat('On va aussi se servir de la séance pour vérifier où tu en es sur ',coalesce(v_recalibration_label,lower(v_recalibration_pattern)),'.')
        else concat('Avant de pousser plus loin ',coalesce(v_recalibration_label,lower(v_recalibration_pattern)),', je veux d’abord reprendre une base propre.')
      end;
      v_future:=case v_variant
        when 0 then 'Cette référence m’aidera à choisir plus justement la difficulté des prochaines séances.'
        when 1 then 'Avec ça, je pourrai être plus précis sur ce que je te propose ensuite.'
        when 2 then 'Si le repère est bon, la suite pourra progresser sans deviner.'
        else 'L’idée est de repartir ensuite sur une progression mieux calibrée.'
      end;
      v_evidence:=v_evidence||jsonb_build_array(jsonb_build_object(
        'type','CALIBRATION',
        'source','planning_context.progression_intelligence.session_recommendation',
        'movement_pattern',v_recalibration_pattern
      ));
    end if;
  end if;

  -- Skill continuity is a strong longitudinal reason when the cycle is not finished.
  v_skill:=coalesce(arch->'skill_path','{}'::jsonb);
  v_skill_applied:=coalesce((v_skill->>'applied')::boolean,false);
  if v_reason='' and v_skill_applied then
    select coalesce(nullif(display_name,''),name)
    into v_skill_name
    from public.exercises
    where id=v_skill->>'exercise_id';

    v_skill_completed:=nullif(v_skill#>>'{focus_cycle,completed_exposures}','')::int;
    v_skill_target:=nullif(v_skill#>>'{focus_cycle,target_completed_exposures}','')::int;

    if v_skill_target is null or v_skill_completed is null or v_skill_completed<v_skill_target then
      v_reason:=case v_variant
        when 0 then concat('On revient sur ',coalesce(v_skill_name,'ce travail technique'),' parce que je veux encore consolider cette étape avant de passer à la suivante.')
        when 1 then concat('Je garde ',coalesce(v_skill_name,'ce Skill'),' dans la séance : le mouvement n’a pas encore besoin de changer, il a surtout besoin de devenir plus solide.')
        when 2 then concat('On continue le travail commencé sur ',coalesce(v_skill_name,'ce Skill'),'. Je préfère accumuler quelques expositions propres plutôt que brûler une étape.')
        else concat('Je ne change pas encore de priorité sur ',coalesce(v_skill_name,'ce Skill'),' : je veux d’abord voir cette étape devenir vraiment stable.')
      end;
      v_future:=case v_variant
        when 0 then 'Si ça devient plus régulier, je pourrai faire évoluer la variante plus sereinement.'
        when 1 then 'La suite viendra quand cette étape sera suffisamment propre et reproductible.'
        when 2 then 'Ce sont ces expositions qui me diront quand il sera pertinent de te faire avancer.'
        else 'Je veux que le passage à l’étape suivante soit mérité par ce que tu réalises, pas décidé au calendrier.'
      end;
      v_evidence:=v_evidence||jsonb_build_array(jsonb_build_object(
        'type','SKILL_CONTINUITY',
        'source','planning_context.architecture.skill_path',
        'exercise_id',v_skill->>'exercise_id',
        'completed_exposures',v_skill_completed,
        'target_exposures',v_skill_target
      ));
    end if;
  end if;

  -- A real pattern-complement mutation is safe to explain as session balancing.
  v_pattern_complement:=coalesce(arch->'pattern_complement','{}'::jsonb);
  v_complement_applied:=coalesce((v_pattern_complement->>'applied')::boolean,false);
  if v_reason='' and v_complement_applied then
    v_replaced_pattern:=nullif(v_pattern_complement#>>'{replace,movement_pattern}','');
    v_added_pattern:=nullif(v_pattern_complement#>>'{with,movement_pattern}','');
    v_replaced_label:=public.coach_briefing_pattern_label_v1(v_replaced_pattern);
    v_added_label:=public.coach_briefing_pattern_label_v1(v_added_pattern);

    v_reason:=case v_variant
      when 0 then concat('J’ai aussi rééquilibré la séance avec ',coalesce(v_added_label,lower(v_added_pattern)),' pour éviter de concentrer trop de travail sur ',coalesce(v_replaced_label,lower(v_replaced_pattern)),'.')
      when 1 then concat('Plutôt que de remettre encore du volume sur ',coalesce(v_replaced_label,lower(v_replaced_pattern)),', j’ai gardé ',coalesce(v_added_label,lower(v_added_pattern)),' en complément.')
      when 2 then concat('Je veux que la séance reste cohérente dans son ensemble : j’ai donc ajouté ',coalesce(v_added_label,lower(v_added_pattern)),' pour mieux répartir le travail.')
      else concat('La séance était trop concentrée sur ',coalesce(v_replaced_label,lower(v_replaced_pattern)),'. J’ai déplacé une partie du travail vers ',coalesce(v_added_label,lower(v_added_pattern)),' pour garder un meilleur équilibre.')
    end;
    v_evidence:=v_evidence||jsonb_build_array(jsonb_build_object(
      'type','PATTERN_BALANCE',
      'source','planning_context.architecture.pattern_complement',
      'replaced_pattern',v_replaced_pattern,
      'added_pattern',v_added_pattern
    ));
  end if;

  -- Recovery / dose only when it is genuinely informative.
  if v_reason='' and (v_readiness='low' or v_progression='DELOAD') then
    v_reason:=case v_variant
      when 0 then 'Tu es moins frais aujourd’hui, donc je garde du travail utile mais je réduis volontairement ce qui ajouterait de la fatigue pour rien.'
      when 1 then 'Je préfère lever un peu le pied aujourd’hui : on garde le stimulus, mais sans forcer une progression quand les sensations ne le justifient pas.'
      when 2 then 'La séance reste utile, mais je la rends volontairement plus contrôlée parce que ta forme du jour passe avant le fait de charger davantage.'
      else 'Aujourd’hui, je préfère protéger la récupération. On travaille quand même, mais sans transformer la séance en test de force ou de volume.'
    end;
    v_evidence:=v_evidence||jsonb_build_array(jsonb_build_object(
      'type','RECOVERY',
      'source','workout_sessions.readiness/progression_intent',
      'readiness',s.readiness,
      'progression_intent',s.progression_intent
    ));
  end if;

  -- Equipment opportunity is only narrated when it actually changed the session.
  v_equipment:=coalesce(arch->'equipment_opportunity','{}'::jsonb);
  v_equipment_applied:=coalesce((v_equipment->>'applied')::boolean,false)
    or coalesce((v_equipment->>'session_level_applied')::boolean,false);
  if v_reason='' and v_equipment_applied then
    v_equipment_name:=coalesce(
      nullif(v_equipment->>'equipment_name',''),
      nullif(v_equipment#>>'{source_signal,opportunities,0,name}','')
    );
    v_equipment_level:=upper(coalesce(
      v_equipment->>'opportunity_level',
      v_equipment#>>'{source_signal,opportunities,0,level}',
      ''
    ));

    if v_equipment_name is not null then
      v_reason:=case
        when v_equipment_level like '%RARE%' or v_equipment_level like '%NEW%' then
          case v_variant
            when 0 then concat('Comme tu as ',v_equipment_name,' aujourd’hui et que tu ne l’as pas souvent dans tes séances, j’en profite pour l’utiliser là où il apporte vraiment quelque chose.')
            when 1 then concat('Tu n’as pas souvent ',v_equipment_name,' à disposition. Je l’utilise donc aujourd’hui, mais seulement parce qu’il s’intègre bien au travail prévu.')
            when 2 then concat('C’est une bonne occasion de profiter de ',v_equipment_name,' : ce matériel est rarement disponible et il colle bien à la séance du jour.')
            else concat('Je profite de ',v_equipment_name,' pendant qu’il est disponible, sans changer la logique de la séance juste pour caser du matériel.')
          end
        else
          case v_variant
            when 0 then concat('J’utilise aussi ',v_equipment_name,' aujourd’hui parce qu’il complète bien le travail prévu sans dégrader la séance.')
            when 1 then concat('Le matériel disponible me permet d’intégrer ',v_equipment_name,' proprement, donc j’en profite.')
            when 2 then concat('Je garde ',v_equipment_name,' dans la séance parce qu’il apporte un vrai complément au travail principal.')
            else concat('Aujourd’hui, ',v_equipment_name,' a une vraie utilité dans la séance, donc je préfère l’exploiter plutôt que l’ignorer.')
          end
      end;
      v_evidence:=v_evidence||jsonb_build_array(jsonb_build_object(
        'type','EQUIPMENT',
        'source','planning_context.architecture.equipment_opportunity',
        'equipment_name',v_equipment_name,
        'opportunity_level',v_equipment_level
      ));
    end if;
  end if;

  -- Program priority is useful when nothing more specific explains "why today".
  v_force_role:=upper(coalesce(
    arch#>>'{force_evolution_v1,priority_state,role}',
    ''
  ));
  v_conditioning_role:=upper(coalesce(
    arch#>>'{conditioning_evolution_v1,priority_state,role}',
    ''
  ));

  if v_reason='' and v_focus='STRENGTH'
     and v_force_role in ('PRIMARY_PRIORITY','SECONDARY_PRIORITY','PRIORITY') then
    v_reason:=case v_variant
      when 0 then 'La force reste une priorité de ton programme, donc je veux continuer à lui donner de vraies expositions plutôt que la travailler seulement de temps en temps.'
      when 1 then 'Je garde la force bien présente parce qu’elle fait partie des axes qu’on cherche encore à développer dans ton programme.'
      when 2 then 'On continue à nourrir le travail de force : c’est encore un axe prioritaire et j’ai suffisamment de contexte pour le travailler aujourd’hui.'
      else 'Je ne laisse pas la force passer au second plan cette semaine : elle reste un axe important de ta progression.'
    end;
    v_evidence:=v_evidence||jsonb_build_array(jsonb_build_object(
      'type','PROGRAM_PRIORITY',
      'source','planning_context.architecture.force_evolution_v1.priority_state',
      'role',v_force_role
    ));
  elsif v_reason='' and v_focus='CONDITIONING'
     and v_conditioning_role in ('PRIMARY_PRIORITY','SECONDARY_PRIORITY','PRIORITY','MAINTAIN') then
    v_reason:=case v_variant
      when 0 then 'Le conditioning fait partie du travail qu’on doit continuer à entretenir, donc je lui garde une vraie place aujourd’hui.'
      when 1 then 'Je veux maintenir une exposition régulière au conditioning plutôt que le laisser disparaître entre deux séances plus orientées force.'
      when 2 then 'On garde du conditioning aujourd’hui pour préserver la continuité du programme et continuer à accumuler des références utiles.'
      else 'Cette séance sert aussi à entretenir ton conditioning avec une exposition suffisamment claire pour pouvoir la comparer plus tard.'
    end;
    v_evidence:=v_evidence||jsonb_build_array(jsonb_build_object(
      'type','PROGRAM_PRIORITY',
      'source','planning_context.architecture.conditioning_evolution_v1.priority_state',
      'role',v_conditioning_role
    ));
  end if;

  -- Environment-specific useful detail, never raw engine metadata.
  if v_env='GYM' then
    v_duration_budget:=coalesce(pc->'duration_budget','{}'::jsonb);
    v_execution_style:=coalesce(pc->'execution_style','{}'::jsonb);
    v_strength_minutes:=coalesce(nullif(v_duration_budget->>'strength_budget_minutes','')::int,0);
    v_cardio_minutes:=coalesce(nullif(v_duration_budget->>'cardio_budget_minutes','')::int,0);

    if v_cardio_minutes>0 and v_focus='STRENGTH' then
      v_extra:=case v_variant
        when 0 then 'Je garde quand même un peu de cardio en complément pour faire monter l’intensité sans détourner la séance de son travail de force.'
        when 1 then 'J’ajoute juste ce qu’il faut de cardio pour donner du rythme, mais la musculation reste clairement le cœur de la séance.'
        when 2 then 'Le cardio reste volontairement en complément : il sert à garder de l’intensité sans prendre la place du travail principal.'
        else 'Je complète avec un peu de cardio pour garder une séance dynamique, sans sacrifier la qualité du travail de force.'
      end;
      v_evidence:=v_evidence||jsonb_build_array(jsonb_build_object(
        'type','GYM_CARDIO_COMPLEMENT',
        'source','planning_context.duration_budget',
        'strength_minutes',v_strength_minutes,
        'cardio_minutes',v_cardio_minutes
      ));
    end if;

  elsif v_env='OUTDOOR' then
    if not v_reliable_distance then
      v_extra:=case v_variant
        when 0 then 'Je pilote les efforts au temps plutôt qu’à la distance : ici, ça me donne un repère plus fiable pour comparer tes efforts.'
        when 1 then 'Comme la distance n’est pas assez fiable dans ce contexte, je préfère te faire travailler au temps plutôt que forcer une mesure approximative.'
        when 2 then 'Je garde un protocole au temps : c’est plus propre pour mesurer l’effort aujourd’hui que de prétendre avoir une distance précise.'
        else 'Ici, le temps est un meilleur repère que la distance, donc je m’appuie dessus pour structurer les intervalles.'
      end;
      v_evidence:=v_evidence||jsonb_build_array(jsonb_build_object(
        'type','OUTDOOR_MEASUREMENT',
        'source','planning_context.running_family',
        'surface',v_surface_label,
        'reliable_distance',v_reliable_distance
      ));
    end if;
  end if;

  -- Generic progression language only as a last resort.
  if v_reason='' then
    if v_progression='RECALIBRATE' then
      v_reason:=case v_variant
        when 0 then 'Je préfère reprendre des repères propres aujourd’hui avant de te demander davantage.'
        when 1 then 'Cette séance sert aussi à remettre les compteurs à jour avant de décider où augmenter la difficulté.'
        when 2 then 'Je ne cherche pas encore à monter la charge à tout prix : je veux d’abord vérifier que les repères sont bons.'
        else 'On utilise cette séance pour recalibrer proprement la suite plutôt que progresser sur une estimation trop ancienne.'
      end;
    elsif v_progression='PROGRESS' then
      v_reason:=case v_variant
        when 0 then 'Les conditions sont réunies pour faire monter légèrement l’exigence, donc je veux voir si tu confirmes ce niveau aujourd’hui.'
        when 1 then 'On peut chercher un petit cran de progression aujourd’hui, sans sortir de ce que tes repères actuels permettent.'
        when 2 then 'Je te demande un peu plus sur cette séance parce qu’on est dans une phase où la progression peut être testée proprement.'
        else 'Aujourd’hui, je veux vérifier si on peut faire avancer la dose sans perdre la qualité d’exécution.'
      end;
      v_future:=case v_variant
        when 0 then 'Si ça passe proprement, je pourrai faire évoluer la suite.'
        when 1 then 'Une bonne réponse aujourd’hui me donnera le feu vert pour continuer à progresser.'
        when 2 then 'Ce que tu montres sur cette séance guidera le niveau d’exigence des prochaines.'
        else 'Si la qualité reste bonne, la prochaine étape pourra être un peu plus ambitieuse.'
      end;
    end if;
  end if;

  v_text:=trim(v_goal);
  if nullif(trim(v_reason),'') is not null then
    v_text:=concat(v_text,' ',trim(v_reason));
  end if;
  if nullif(trim(v_extra),'') is not null then
    v_text:=concat(v_text,' ',trim(v_extra));
  end if;
  if nullif(trim(v_future),'') is not null then
    v_text:=concat(v_text,' ',trim(v_future));
  end if;

  return jsonb_build_object(
    'version','coach-session-briefing-v1',
    'session_id',p_session_id,
    'environment_code',v_env,
    'variant',v_variant,
    'text',v_text,
    'evidence',v_evidence,
    'evidence_count',jsonb_array_length(v_evidence),
    'contract',jsonb_build_object(
      'narrates_existing_decisions_only',true,
      'same_contract_all_environments',true,
      'deterministic_per_session',true,
      'no_runtime_history_recalculation',true,
      'no_internal_jargon_in_text',true,
      'no_objective_of_day_label',true
    )
  );
end;
$function$;

create or replace function public.w3_session_why_v1(
  p_session_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_briefing jsonb;
begin
  v_briefing:=public.coach_session_briefing_v1(p_session_id);

  return jsonb_build_object(
    'version','w3-session-why-v4-coach-briefing',
    'session_id',p_session_id,
    'status',case
      when nullif(v_briefing->>'text','') is not null then 'TRACEABLE'
      else 'NO_USEFUL_REASON'
    end,
    'briefing',v_briefing,
    'briefing_text',v_briefing->>'text',
    'reasons','[]'::jsonb,
    'reason_count',0,
    'semantics',jsonb_build_object(
      'single_coach_briefing',true,
      'same_contract_home_box_gym_outdoor',true,
      'deterministic_phrase_variation',true,
      'evidence_backed_only',true
    )
  );
end;
$function$;

revoke all on function public.coach_briefing_pattern_label_v1(text) from public,anon;
revoke all on function public.coach_session_briefing_v1(uuid) from public,anon;
grant execute on function public.coach_briefing_pattern_label_v1(text) to authenticated,service_role;
grant execute on function public.coach_session_briefing_v1(uuid) to authenticated,service_role;
