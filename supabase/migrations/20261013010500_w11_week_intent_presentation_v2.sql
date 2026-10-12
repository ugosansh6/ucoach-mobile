-- W11 / Ma semaine
-- Evidence-bound presentation contract for projected weekly intents.
-- The front must not infer Coach advice, future readiness, or exercise candidates.

create or replace function public.week_priority_label_fr_v1(p_key text)
returns text
language sql
immutable
set search_path to 'public'
as $function$
  select case lower(trim(coalesce(p_key,'')))
    when 'push vertical' then 'la poussée verticale'
    when 'push_vertical' then 'la poussée verticale'
    when 'pull vertical' then 'le tirage vertical'
    when 'pull_vertical' then 'le tirage vertical'
    when 'push horizontal' then 'la poussée horizontale'
    when 'push_horizontal' then 'la poussée horizontale'
    when 'pull horizontal' then 'le tirage horizontal'
    when 'pull_horizontal' then 'le tirage horizontal'
    when 'strength' then 'la force'
    when 'force' then 'la force'
    when 'conditioning' then 'le conditioning'
    when 'cardio' then 'le cardio'
    when 'skill' then 'la technique'
    when 'technique' then 'la technique'
    when 'mobility' then 'la mobilité'
    when 'mobilite' then 'la mobilité'
    when 'hypertrophy' then 'l’hypertrophie'
    when 'hypertrophie' then 'l’hypertrophie'
    when 'recovery' then 'la récupération'
    when 'recuperation' then 'la récupération'
    when 'week_balance' then 'l’équilibre de la semaine'
    when 'lower_body' then 'le bas du corps'
    when 'upper_body' then 'le haut du corps'
    when 'full_body' then 'le travail full body'
    when 'legs' then 'les jambes'
    when 'back' then 'le dos'
    when 'shoulders' then 'les épaules'
    when 'chest' then 'les pectoraux'
    when 'core' then 'le tronc'
    else case
      when nullif(trim(coalesce(p_key,'')),'') is null then null
      else lower(replace(replace(trim(p_key),'_',' '),'-',' '))
    end
  end;
$function$;

create or replace function public.week_intent_presentation_v1(
  p_priority jsonb,
  p_slot_kind text,
  p_projection_certainty text
)
returns jsonb
language plpgsql
stable
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_priority jsonb := coalesce(p_priority, '{}'::jsonb);
  v_key text := nullif(v_priority->>'key', '');
  v_label text := public.week_priority_label_fr_v1(v_priority->>'key');
  v_label_sentence text;
  v_kind text := upper(coalesce(v_priority->>'kind', ''));
  v_state text := upper(coalesce(v_priority->>'programming_state', ''));
  v_reason_codes jsonb := case
    when jsonb_typeof(v_priority->'reason_codes') = 'array' then v_priority->'reason_codes'
    else '[]'::jsonb
  end;
  v_description text;
  v_why text;
  v_advice jsonb := null;
  v_reason_match text;
begin
  v_label_sentence := case
    when v_label is null then null
    when length(v_label) = 1 then upper(v_label)
    else upper(substr(v_label, 1, 1)) || substr(v_label, 2)
  end;

  select value
  into v_reason_match
  from jsonb_array_elements_text(v_reason_codes)
  where value in (
    'ACTIVE_SKILL_TARGET_CALIBRATION_NEEDED',
    'ACTIVE_SKILL_TARGET',
    'GOAL_ROLE_PRIORITY',
    'RELEVANT_QUALITY_NEEDS_CALIBRATION',
    'PERSONAL_TREND_UNKNOWN',
    'PERSONAL_TREND_STABLE'
  )
  order by case value
    when 'ACTIVE_SKILL_TARGET_CALIBRATION_NEEDED' then 1
    when 'ACTIVE_SKILL_TARGET' then 2
    when 'GOAL_ROLE_PRIORITY' then 3
    when 'RELEVANT_QUALITY_NEEDS_CALIBRATION' then 4
    when 'PERSONAL_TREND_UNKNOWN' then 5
    when 'PERSONAL_TREND_STABLE' then 6
    else 99
  end
  limit 1;

  if v_key is null then
    if upper(coalesce(p_slot_kind, '')) = 'FLEXIBLE_COMPLEMENT' then
      v_description := 'Ce créneau reste volontairement flexible et sera précisé au moment de préparer la séance.';
      v_why := 'UGEROD garde de la marge pour réagir aux séances réellement réalisées et au contexte du jour.';
    else
      v_description := 'UGEROD a réservé ce créneau, mais son contenu exact sera précisé au moment utile.';
      v_why := null;
    end if;
  elsif v_state = 'CALIBRATE' then
    v_description := format(
      'UGEROD veut d’abord obtenir une référence exploitable sur %s avant de faire progresser la difficulté.',
      v_label
    );
    v_why := case v_reason_match
      when 'ACTIVE_SKILL_TARGET_CALIBRATION_NEEDED' then format(
        '%s est lié à ton objectif technique actif, mais il manque encore une référence suffisamment fiable.',
        v_label_sentence
      )
      when 'RELEVANT_QUALITY_NEEDS_CALIBRATION' then format(
        '%s est pertinent pour ton objectif actuel, mais doit encore être calibré.',
        v_label_sentence
      )
      when 'PERSONAL_TREND_UNKNOWN' then format(
        'La tendance personnelle sur %s n’est pas encore assez claire pour justifier une progression.',
        v_label
      )
      else format(
        '%s est une priorité du bloc actuel et nécessite d’abord un repère comparable.',
        v_label_sentence
      )
    end;
    v_advice := jsonb_build_object(
      'type', 'MEASURABLE_REFERENCE',
      'text', 'Si tu fais cette séance, garde un repère mesurable — charge, répétitions, temps ou qualité d’exécution — pour que le Coach puisse comparer la suite.',
      'evidence_reason_codes', v_reason_codes
    );
  elsif v_state = 'DEVELOP' then
    v_description := format('UGEROD garde %s comme axe de développement de cette séance.', v_label);
    v_why := case v_reason_match
      when 'ACTIVE_SKILL_TARGET' then format(
        '%s vient directement de ton objectif technique actif.',
        v_label_sentence
      )
      when 'GOAL_ROLE_PRIORITY' then format(
        '%s fait partie des priorités explicites de ton objectif actuel.',
        v_label_sentence
      )
      else format('%s est la priorité persistée du bloc en cours.', v_label_sentence)
    end;
  elsif v_state = 'MAINTAIN' then
    v_description := format(
      'UGEROD entretient %s sans en faire la priorité principale du bloc.',
      v_label
    );
    v_why := format(
      '%s reste utile à ton équilibre d’entraînement, mais le Coach évite de disperser la priorité du cycle.',
      v_label_sentence
    );
  else
    v_description := format('UGEROD garde %s comme direction pour ce créneau.', v_label);
    v_why := case
      when v_kind = 'MAINTENANCE_POOL' then
        'Ce créneau sert à entretenir une capacité utile sans forcer une répartition égale entre toutes les qualités.'
      else 'Cette direction vient de la priorité persistée du bloc actuel.'
    end;
  end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'version', 'week-intent-presentation-v1',
    'description', v_description,
    'why', case when v_why is null then null else jsonb_build_object(
      'title', 'Pourquoi ce choix ?',
      'text', v_why
    ) end,
    'coach_advice', v_advice,
    'exercise_examples', '[]'::jsonb,
    'evidence', jsonb_build_object(
      'priority_key', v_key,
      'priority_label_fr', v_label,
      'priority_kind', nullif(v_kind, ''),
      'programming_state', nullif(v_state, ''),
      'reason_codes', v_reason_codes,
      'slot_kind', p_slot_kind,
      'projection_certainty', p_projection_certainty,
      'source', 'PERSISTED_BLOCK_PRIORITY_V2'
    ),
    'semantics', jsonb_build_object(
      'coach_advice_optional', true,
      'no_equipment_advice_without_equipment_signal', true,
      'no_future_readiness_assumption', true,
      'front_must_not_invent_coach_advice', true
    )
  ));
end;
$function$;

create or replace function public.week_read_contract_v2(
  p_user_id uuid,
  p_anchor_date date default current_date
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_base jsonb;
  v_items jsonb := '[]'::jsonb;
  v_item jsonb;
  v_projection jsonb;
  v_presentation jsonb;
  v_semantics jsonb;
begin
  if p_user_id is null then raise exception 'User required'; end if;
  if auth.uid() is not null and auth.uid() <> p_user_id then raise exception 'Forbidden user'; end if;

  v_base := public.week_read_contract_v1(
    p_user_id,
    coalesce(p_anchor_date, current_date)
  );

  for v_item in
    select value
    from jsonb_array_elements(coalesce(v_base->'items', '[]'::jsonb))
  loop
    v_projection := v_item->'coach_projection';
    if jsonb_typeof(v_projection) = 'object' then
      v_presentation := public.week_intent_presentation_v1(
        v_projection->'priority',
        v_projection->>'slot_kind',
        v_projection->>'projection_certainty'
      );
      v_projection := v_projection || jsonb_build_object(
        'presentation', v_presentation
      );
      v_item := jsonb_set(v_item, '{coach_projection}', v_projection, true);
    end if;
    v_items := v_items || jsonb_build_array(v_item);
  end loop;

  v_semantics := coalesce(v_base->'semantics', '{}'::jsonb) || jsonb_build_object(
    'coach_advice_is_optional', true,
    'front_must_not_invent_coach_advice', true,
    'intent_presentation_is_evidence_bound', true,
    'exercise_examples_require_real_candidate_data', true
  );

  v_base := jsonb_set(v_base, '{items}', v_items, true);
  v_base := jsonb_set(v_base, '{semantics}', v_semantics, true);
  v_base := jsonb_set(
    v_base,
    '{contract_version}',
    to_jsonb('W11_WEEK_READ_V2'::text),
    true
  );
  return v_base;
end;
$function$;

grant execute on function public.week_priority_label_fr_v1(text) to authenticated;
grant execute on function public.week_intent_presentation_v1(jsonb,text,text) to authenticated;
grant execute on function public.week_read_contract_v2(uuid,date) to authenticated;
