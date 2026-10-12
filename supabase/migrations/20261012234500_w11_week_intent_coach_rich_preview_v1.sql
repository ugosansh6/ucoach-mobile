create or replace function public.week_intent_exercise_examples_v1(
  p_user_id uuid,
  p_planned_focus text,
  p_planned_target_region text,
  p_progression_intent text,
  p_priority jsonb,
  p_limit integer default 5
)
returns jsonb
language sql
stable
set search_path to 'public','pg_temp'
as $function$
with params as (
  select
    upper(coalesce(nullif(trim(p_planned_focus),''),'GENERAL FITNESS')) as focus,
    upper(coalesce(nullif(trim(p_planned_target_region),''),'FULL BODY')) as region,
    upper(coalesce(nullif(trim(p_progression_intent),''),'MAINTAIN')) as progression_intent,
    lower(coalesce(nullif(trim(p_priority->>'key'),''),'')) as priority_key,
    upper(coalesce(p_priority->>'kind','')) as priority_kind,
    greatest(1,least(coalesce(p_limit,5),5)) as wanted
),
scored as (
  select
    e.id,
    coalesce(nullif(e.display_name,''),e.name) as label,
    e.movement_pattern,
    e.body_region,
    e.selection_weight,
    p.priority_key,
    p.priority_kind,
    p.wanted,
    case
      when p.priority_kind in ('MOVEMENT_PATTERN','MOVEMENT')
       and lower(coalesce(e.movement_pattern,''))=p.priority_key then 12::numeric
      else 0::numeric
    end as priority_bonus,
    coalesce((public.ugerod_exercise_intent_alignment_v1(
      e.id,
      initcap(lower(p.focus)),
      initcap(lower(p.region)),
      p.progression_intent
    )->>'soft_bonus')::numeric,0) as alignment_bonus,
    case
      when p.region not in ('FULL BODY','FULL_BODY','')
       and upper(coalesce(e.body_region,''))=p.region then 2::numeric
      else 0::numeric
    end as region_bonus,
    case when upper(coalesce(e.training_focus,''))=p.focus then 2::numeric else 0::numeric end as focus_bonus
  from params p
  cross join public.exercises e
  where coalesce(e.warmup_only,false)=false
    and coalesce(nullif(e.display_name,''),nullif(e.name,'')) is not null
    and coalesce(e.movement_pattern,'') <> 'Mobility'
    and (
      p.focus not in ('STRENGTH','FORCE')
      or 'STRENGTH'=any(coalesce(e.usable_for,'{}'::text[]))
      or upper(coalesce(e.training_focus,''))='STRENGTH'
    )
    and (
      p.region in ('FULL BODY','FULL_BODY','')
      or upper(coalesce(e.body_region,''))=p.region
    )
    and not exists (
      select 1
      from public.user_exercise_preferences pref
      where pref.user_id=p_user_id
        and pref.exercise_id=e.id
        and upper(coalesce(pref.preference_state,'')) in ('DISLIKE','DISLIKED','AVOID','BLOCKED')
    )
),
ranked as (
  select
    s.*,
    (s.priority_bonus+s.alignment_bonus+s.region_bonus+s.focus_bonus) as score,
    row_number() over (
      partition by s.movement_pattern
      order by
        (s.priority_bonus+s.alignment_bonus+s.region_bonus+s.focus_bonus) desc,
        s.selection_weight desc nulls last,
        s.label
    ) as pattern_rank,
    row_number() over (
      partition by (s.priority_bonus>0)
      order by
        (s.priority_bonus+s.alignment_bonus+s.region_bonus+s.focus_bonus) desc,
        s.selection_weight desc nulls last,
        s.label
    ) as priority_group_rank
  from scored s
  where (s.priority_bonus+s.alignment_bonus+s.region_bonus+s.focus_bonus)>0
),
picked as (
  select r.*
  from ranked r
  where
    case
      when r.priority_kind in ('MOVEMENT_PATTERN','MOVEMENT') and r.priority_key<>'' then
        (r.priority_bonus>0 and r.priority_group_rank<=3)
        or (r.priority_bonus=0 and r.pattern_rank=1)
      else r.pattern_rank=1
    end
),
ordered as (
  select label
  from picked
  order by
    case when priority_bonus>0 then 0 else 1 end,
    score desc,
    selection_weight desc nulls last,
    label
  limit (select wanted from params)
)
select coalesce(jsonb_agg(label),'[]'::jsonb)
from ordered;
$function$;

create or replace function public.week_intent_presentation_v3(
  p_user_id uuid,
  p_planned_focus text,
  p_planned_target_region text,
  p_progression_intent text,
  p_priority jsonb,
  p_slot_kind text,
  p_projection_certainty text
)
returns jsonb
language plpgsql
stable
set search_path to 'public','pg_temp'
as $function$
declare
  v_priority jsonb := coalesce(p_priority,'{}'::jsonb);
  v_priority_key text := nullif(trim(v_priority->>'key'),'');
  v_priority_kind text := upper(coalesce(v_priority->>'kind',''));
  v_reason_codes jsonb := case
    when jsonb_typeof(v_priority->'reason_codes')='array' then v_priority->'reason_codes'
    else '[]'::jsonb
  end;
  v_focus_label text;
  v_region_label text;
  v_priority_title text;
  v_priority_sentence text := public.week_priority_label_fr_v1(v_priority_key);
  v_region_phrase text;
  v_title_tokens text[] := '{}';
  v_title text;
  v_description text := null;
  v_why text := null;
  v_advice jsonb := null;
  v_examples jsonb := '[]'::jsonb;
  v_progression text := upper(coalesce(nullif(trim(p_progression_intent),''),v_priority->>'programming_state',''));
  v_has_active_skill boolean := v_reason_codes ? 'ACTIVE_SKILL_TARGET';
  v_needs_skill_calibration boolean := v_reason_codes ? 'ACTIVE_SKILL_TARGET_CALIBRATION_NEEDED';
  v_is_maintenance boolean := upper(coalesce(p_slot_kind,''))='MAINTENANCE_POOL'
    or v_priority_kind='MAINTENANCE_POOL'
    or lower(coalesce(v_priority_key,''))='week_balance';
  v_use_priority_in_title boolean := false;
begin
  v_focus_label := case lower(trim(coalesce(p_planned_focus,'')))
    when 'strength' then 'Force'
    when 'conditioning' then 'Conditioning'
    when 'muscle gain' then 'Hypertrophie'
    when 'fat loss' then 'Perte de gras'
    when 'general fitness' then 'Fitness'
    when 'skill' then 'Technique'
    when 'technique' then 'Technique'
    else nullif(trim(p_planned_focus),'')
  end;

  v_region_label := case lower(trim(coalesce(p_planned_target_region,'')))
    when 'upper' then 'Haut du corps'
    when 'lower' then 'Bas du corps'
    when 'core' then 'Tronc'
    when 'full body' then 'Full body'
    when 'full_body' then 'Full body'
    else nullif(trim(p_planned_target_region),'')
  end;

  v_region_phrase := case lower(trim(coalesce(p_planned_target_region,'')))
    when 'upper' then 'du haut du corps'
    when 'lower' then 'du bas du corps'
    when 'core' then 'du tronc'
    when 'full body' then 'globale'
    when 'full_body' then 'globale'
    else null
  end;

  v_priority_title := case lower(trim(coalesce(v_priority_key,'')))
    when 'push vertical' then 'Poussée verticale'
    when 'push_vertical' then 'Poussée verticale'
    when 'pull vertical' then 'Tirage vertical'
    when 'pull_vertical' then 'Tirage vertical'
    when 'push horizontal' then 'Poussée horizontale'
    when 'push_horizontal' then 'Poussée horizontale'
    when 'pull horizontal' then 'Tirage horizontal'
    when 'pull_horizontal' then 'Tirage horizontal'
    when 'legs' then 'Jambes'
    when 'back' then 'Dos'
    when 'shoulders' then 'Épaules'
    when 'chest' then 'Pectoraux'
    when 'core' then 'Tronc'
    else null
  end;

  v_use_priority_in_title :=
    not v_is_maintenance
    and v_priority_title is not null
    and v_priority_kind in ('MOVEMENT_PATTERN','MOVEMENT','SKILL','SKILL_PATH');

  if v_focus_label is not null then
    v_title_tokens := array_append(v_title_tokens,upper(v_focus_label));
  end if;
  if v_use_priority_in_title and not exists (
    select 1 from unnest(v_title_tokens) x where lower(x)=lower(v_priority_title)
  ) then
    v_title_tokens := array_append(v_title_tokens,upper(v_priority_title));
  end if;
  if v_region_label is not null and not exists (
    select 1 from unnest(v_title_tokens) x where lower(x)=lower(v_region_label)
  ) then
    v_title_tokens := array_append(v_title_tokens,upper(v_region_label));
  end if;

  v_title := case
    when cardinality(v_title_tokens)>0 then array_to_string(v_title_tokens,' · ')
    else 'SÉANCE À PRÉCISER'
  end;

  if lower(trim(coalesce(p_planned_focus,'')))='strength' then
    if v_progression in ('PROGRESS','DEVELOP') then
      if v_use_priority_in_title and v_priority_title is not null then
        v_description := format(
          'Développer ta force en %s, avec un travail principal orienté force puis du volume complémentaire selon ton contexte du jour.',
          lower(v_priority_title)
        );
      elsif v_region_phrase is not null then
        v_description := format(
          'Développer ta force %s, avec un travail principal orienté force puis du volume complémentaire.',
          v_region_phrase
        );
      end if;
    elsif v_progression='MAINTAIN' then
      if v_region_phrase is not null then
        v_description := format(
          'Entretenir ta force %s avec un travail principal maîtrisé et du volume complémentaire.',
          v_region_phrase
        );
      elsif v_use_priority_in_title and v_priority_title is not null then
        v_description := format('Entretenir ta force en %s sans chercher à pousser la difficulté.',lower(v_priority_title));
      end if;
    elsif v_progression='CONSOLIDATE' then
      if lower(trim(coalesce(p_planned_target_region,''))) in ('full body','full_body') then
        v_description := 'Consolider ta force globale avec une séance volontairement maîtrisée avant de pousser plus loin.';
      elsif v_region_phrase is not null then
        v_description := format('Consolider ta force %s avec une dose volontairement maîtrisée.',v_region_phrase);
      else
        v_description := 'Consolider ce travail de force avec une dose volontairement maîtrisée.';
      end if;
    elsif v_progression='DELOAD' then
      v_description := 'Alléger le travail de force pour absorber la charge récente et repartir plus frais.';
      v_advice := jsonb_build_object(
        'type','DOSE_PROTECTION',
        'text','Ne cherche pas à compenser la baisse de charge par plus de volume : la marge fait partie de la séance aujourd’hui.',
        'evidence_reason_codes',v_reason_codes
      );
    elsif v_progression in ('RECALIBRATE','CALIBRATE') then
      v_description := 'Reprendre un repère fiable avant de faire évoluer la suite.';
    elsif v_progression='EXPLORE' then
      v_description := 'Explorer un niveau un peu plus exigeant sans en faire encore une nouvelle référence.';
      if v_has_active_skill then
        v_advice := jsonb_build_object(
          'type','QUALITY_OVER_FORCE',
          'text','Quelques essais propres suffisent aujourd’hui. L’objectif est d’explorer l’étape suivante, pas de la forcer.',
          'evidence_reason_codes',v_reason_codes
        );
      end if;
    end if;
  else
    v_description := case v_progression
      when 'PROGRESS' then 'Faire progresser cette qualité avec une séance construite autour de cette priorité.'
      when 'DEVELOP' then 'Faire progresser cette qualité avec une séance construite autour de cette priorité.'
      when 'MAINTAIN' then 'Entretenir cette qualité sans en faire la priorité principale de la semaine.'
      when 'CONSOLIDATE' then 'Consolider ce travail avant de pousser plus loin.'
      when 'DELOAD' then 'Alléger la charge de travail pour mieux récupérer.'
      when 'RECALIBRATE' then 'Reprendre un repère fiable avant de faire évoluer la suite.'
      when 'EXPLORE' then 'Explorer un niveau un peu plus exigeant.'
      else null
    end;
  end if;

  if v_needs_skill_calibration then
    v_why := case
      when v_priority_sentence is not null then format(
        '%s fait partie de ton objectif technique actuel, mais il manque encore une référence suffisamment fiable.',
        upper(substr(v_priority_sentence,1,1))||substr(v_priority_sentence,2)
      )
      else 'Il manque encore une référence suffisamment fiable avant de faire évoluer la suite.'
    end;
    v_advice := jsonb_build_object(
      'type','MEASURABLE_REFERENCE',
      'text','Cherche surtout une exécution propre et garde un repère mesurable — charge, répétitions ou temps — pour que la prochaine décision soit plus fiable.',
      'evidence_reason_codes',v_reason_codes
    );
  elsif v_progression in ('RECALIBRATE','CALIBRATE') and v_advice is null then
    v_advice := jsonb_build_object(
      'type','MEASURABLE_REFERENCE',
      'text','Le repère compte plus que le score aujourd’hui : garde une mesure comparable pour que la suite soit mieux ajustée.',
      'evidence_reason_codes',v_reason_codes
    );
  elsif v_has_active_skill and v_priority_sentence is not null then
    v_why := format('%s fait partie de ton objectif technique actuel.',upper(substr(v_priority_sentence,1,1))||substr(v_priority_sentence,2));
  elsif v_is_maintenance then
    v_why := 'Cette séance complète ce que tu as déjà travaillé cette semaine sans remettre fortement l’accent sur une seule zone.';
  end if;

  v_examples := public.week_intent_exercise_examples_v1(
    p_user_id,
    p_planned_focus,
    p_planned_target_region,
    p_progression_intent,
    p_priority,
    5
  );

  return jsonb_strip_nulls(jsonb_build_object(
    'version','week-intent-presentation-v3',
    'title',v_title,
    'title_tokens',to_jsonb(v_title_tokens),
    'description',v_description,
    'why',case when v_why is null then null else jsonb_build_object(
      'title','Pourquoi maintenant ?',
      'text',v_why
    ) end,
    'coach_advice',v_advice,
    'exercise_examples',v_examples,
    'evidence',jsonb_build_object(
      'planned_focus',p_planned_focus,
      'planned_target_region',p_planned_target_region,
      'planned_progression_intent',p_progression_intent,
      'priority_key',v_priority_key,
      'priority_kind',nullif(v_priority_kind,''),
      'reason_codes',v_reason_codes,
      'slot_kind',p_slot_kind,
      'projection_certainty',p_projection_certainty,
      'source','PERSISTED_WEEK_PLAN_PLUS_BLOCK_PRIORITY',
      'exercise_example_source','INTENT_ALIGNED_EXERCISE_CATALOG'
    ),
    'semantics',jsonb_build_object(
      'title_is_user_facing_intent',true,
      'priority_is_not_automatically_the_title',true,
      'why_now_is_optional',true,
      'coach_advice_optional',true,
      'coach_advice_must_change_execution_or_understanding',true,
      'exercise_examples_are_candidates_not_commitments',true,
      'exercise_examples_require_day_context_before_final_selection',true,
      'no_future_readiness_assumption',true,
      'front_must_not_invent_coach_advice',true,
      'no_equipment_advice_without_explicit_equipment_opportunity',true
    )
  ));
end;
$function$;

create or replace function public.week_read_contract_v2(p_user_id uuid, p_anchor_date date default current_date)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_base jsonb;
  v_items jsonb := '[]'::jsonb;
  v_item jsonb;
  v_projection jsonb;
  v_presentation jsonb;
  v_semantics jsonb;
  v_planned jsonb;
  v_future jsonb;
  v_plan_focus text;
  v_plan_region text;
  v_plan_intent text;
begin
  if p_user_id is null then raise exception 'User required'; end if;
  if auth.uid() is not null and auth.uid() <> p_user_id then raise exception 'Forbidden user'; end if;

  v_base := public.week_read_contract_v1(p_user_id,coalesce(p_anchor_date,current_date));

  for v_item in
    select value from jsonb_array_elements(coalesce(v_base->'items','[]'::jsonb))
  loop
    select i.planned_focus,i.planned_target_region,i.planned_progression_intent
      into v_plan_focus,v_plan_region,v_plan_intent
    from public.user_training_plan_items i
    where i.id=nullif(v_item->>'plan_item_id','')::uuid
      and i.user_id=p_user_id;

    v_planned := coalesce(v_item->'planned_context','{}'::jsonb)
      || jsonb_strip_nulls(jsonb_build_object(
        'focus',v_plan_focus,
        'target_region',v_plan_region,
        'progression_intent',v_plan_intent
      ));

    v_future := coalesce(v_planned#>'{planning_context,w11,future_context}','{}'::jsonb);
    if jsonb_typeof(v_future)='object' and v_future<>'{}'::jsonb then
      v_planned := v_planned || jsonb_strip_nulls(jsonb_build_object(
        'duration_minutes',coalesce(
          nullif(v_future->>'duration_minutes','')::integer,
          nullif(v_planned->>'duration_minutes','')::integer
        ),
        'environment_code',coalesce(nullif(v_future->>'environment_code',''),v_planned->>'environment_code'),
        'equipment',case
          when jsonb_typeof(v_future->'equipment')='array' then v_future->'equipment'
          else coalesce(v_planned->'equipment','[]'::jsonb)
        end,
        'future_context',v_future
      ));
    end if;
    v_item := jsonb_set(v_item,'{planned_context}',v_planned,true);

    v_projection := v_item->'coach_projection';
    if jsonb_typeof(v_projection)='object' then
      v_presentation := public.week_intent_presentation_v3(
        p_user_id,
        v_plan_focus,
        v_plan_region,
        v_plan_intent,
        v_projection->'priority',
        v_projection->>'slot_kind',
        v_projection->>'projection_certainty'
      );
      v_projection := v_projection || jsonb_build_object('presentation',v_presentation);
      v_item := jsonb_set(v_item,'{coach_projection}',v_projection,true);
    end if;

    v_items := v_items || jsonb_build_array(v_item);
  end loop;

  v_semantics := coalesce(v_base->'semantics','{}'::jsonb) || jsonb_build_object(
    'coach_advice_is_optional',true,
    'front_must_not_invent_coach_advice',true,
    'intent_presentation_is_evidence_bound',true,
    'intent_title_comes_from_persisted_plan_plus_concrete_priority',true,
    'priority_is_not_automatically_the_title',true,
    'why_now_is_optional',true,
    'exercise_examples_require_real_candidate_data',true,
    'exercise_examples_are_candidates_not_commitments',true,
    'no_equipment_advice_without_explicit_equipment_opportunity',true,
    'future_context_excludes_readiness_and_pain',true,
    'planned_context_is_not_actual',true
  );

  v_base := jsonb_set(v_base,'{items}',v_items,true);
  v_base := jsonb_set(v_base,'{semantics}',v_semantics,true);
  v_base := jsonb_set(v_base,'{contract_version}',to_jsonb('W11_WEEK_READ_V2_2'::text),true);
  return v_base;
end;
$function$;
