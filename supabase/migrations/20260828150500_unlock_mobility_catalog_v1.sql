-- UNLOCK mobility catalog v1
-- Product contract:
-- - Unlock = joint mobility + light activation without fatigue.
-- - Warm-up movement prep / pulse raiser remains a separate role.
-- - New catalog rows clone existing low-fatigue warm-up profiles so we do not invent a new scoring scale.

DO $$
DECLARE
  v public.exercises%ROWTYPE;
BEGIN
  -- Cossack mobility variant: keep the existing EX045 WOD movement untouched.
  IF NOT EXISTS (SELECT 1 FROM public.exercises WHERE id='EXW031') THEN
    SELECT * INTO v FROM public.exercises WHERE id='EX428';
    v.id := 'EXW031';
    v.name := 'Cossack Mobility Shift';
    v.display_name := 'Cossack Squat mobilité';
    v.description := 'Déplacement latéral contrôlé en position de Cossack pour mobiliser hanches, adducteurs, genoux et chevilles.';
    v.instructions := 'Écarte les pieds, transfère lentement le bassin d’un côté puis de l’autre en gardant le pied d’appui stable. Reste dans une amplitude confortable.';
    v.tips := 'Contrôle le mouvement, genou dans l’axe du pied, sans chercher la profondeur maximale.';
    v.exercise_type := 'mobility';
    v.training_focus := 'Mobility';
    v.warmup_eligible := true;
    v.warmup_role := 'mobility';
    v.warmup_intensity := 1;
    v.warmup_only := true;
    v.wod_role := 'prep_only';
    v.usable_for := ARRAY['Warm-up']::varchar[];
    v.equipment_requirement := 'none';
    v.home_friendly := true;
    v.image_path := null;
    v.created_at := now();
    INSERT INTO public.exercises SELECT v.*;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.exercises WHERE id='EXW032') THEN
    SELECT * INTO v FROM public.exercises WHERE id='EX423';
    v.id := 'EXW032';
    v.name := 'Straddle Rock and Reach';
    v.display_name := 'Straddle dynamique';
    v.description := 'Mobilité dynamique des adducteurs, ischios et hanches en position jambes écartées.';
    v.instructions := 'Place-toi jambes écartées, fléchis légèrement les genoux puis déplace le bassin et le buste de façon contrôlée vers l’avant et les côtés.';
    v.tips := 'Garde le dos long et évite les rebonds forcés en fin d’amplitude.';
    v.starting_position := 'Standing';
    v.warmup_role := 'mobility';
    v.warmup_intensity := 1;
    v.warmup_only := true;
    v.wod_role := 'prep_only';
    v.usable_for := ARRAY['Warm-up']::varchar[];
    v.image_path := null;
    v.created_at := now();
    INSERT INTO public.exercises SELECT v.*;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.exercises WHERE id='EXW033') THEN
    SELECT * INTO v FROM public.exercises WHERE id='EX158';
    v.id := 'EXW033';
    v.name := 'Body Bounces';
    v.display_name := 'Body Bounces';
    v.description := 'Petits relâchements dynamiques du corps entier pour remettre les articulations en mouvement sans montée d’intensité.';
    v.instructions := 'Debout, relâche les bras et réalise de petits rebonds souples en laissant chevilles, genoux, hanches et épaules accompagner le mouvement.';
    v.tips := 'Amplitude courte et relâchée ; ce n’est pas un exercice pliométrique.';
    v.body_region := 'Full Body';
    v.starting_position := 'Standing';
    v.warmup_only := true;
    v.wod_role := 'prep_only';
    v.usable_for := ARRAY['Warm-up']::varchar[];
    v.image_path := null;
    v.created_at := now();
    INSERT INTO public.exercises SELECT v.*;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.exercises WHERE id='EXW034') THEN
    SELECT * INTO v FROM public.exercises WHERE id='EX324';
    v.id := 'EXW034';
    v.name := 'Cervical CARs';
    v.display_name := 'Neck Circle contrôlé';
    v.description := 'Mobilité cervicale contrôlée pour remettre le cou en mouvement sans forcer les amplitudes.';
    v.instructions := 'Réalise lentement des rotations contrôlées du cou dans une amplitude confortable, sans lancer la tête ni chercher la fin d’amplitude.';
    v.tips := 'Mouvement lent et indolore ; réduis l’amplitude si nécessaire.';
    v.body_region := 'Upper';
    v.movement_side := 'Bilateral';
    v.warmup_only := true;
    v.wod_role := 'prep_only';
    v.usable_for := ARRAY['Warm-up']::varchar[];
    v.image_path := null;
    v.created_at := now();
    INSERT INTO public.exercises SELECT v.*;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.exercises WHERE id='EXW035') THEN
    SELECT * INTO v FROM public.exercises WHERE id='EX324';
    v.id := 'EXW035';
    v.name := 'Arm Swimmers';
    v.display_name := 'Arm Swim';
    v.description := 'Cercles alternés des bras pour mobiliser les épaules et les omoplates.';
    v.instructions := 'Debout, réalise de grands cercles contrôlés avec les bras, alternativement vers l’avant puis vers l’arrière.';
    v.tips := 'Garde les côtes contrôlées et fais venir le mouvement de l’épaule plutôt que du bas du dos.';
    v.movement_side := 'Alternating';
    v.warmup_only := true;
    v.wod_role := 'prep_only';
    v.usable_for := ARRAY['Warm-up']::varchar[];
    v.image_path := null;
    v.created_at := now();
    INSERT INTO public.exercises SELECT v.*;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.exercises WHERE id='EXW036') THEN
    SELECT * INTO v FROM public.exercises WHERE id='EX435';
    v.id := 'EXW036';
    v.name := 'Standing Full Body Twist';
    v.display_name := 'Full Twist';
    v.description := 'Rotation contrôlée du tronc et du bassin pour mobiliser la colonne thoracique et les hanches.';
    v.instructions := 'Debout, tourne doucement le buste d’un côté puis de l’autre en laissant le bassin accompagner légèrement le mouvement.';
    v.tips := 'Reste fluide, sans à-coup ni recherche d’amplitude forcée.';
    v.starting_position := 'Standing';
    v.warmup_only := true;
    v.wod_role := 'prep_only';
    v.usable_for := ARRAY['Warm-up']::varchar[];
    v.image_path := null;
    v.created_at := now();
    INSERT INTO public.exercises SELECT v.*;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.exercises WHERE id='EXW037') THEN
    SELECT * INTO v FROM public.exercises WHERE id='EX421';
    v.id := 'EXW037';
    v.name := 'Knee CARs';
    v.display_name := 'Cercles de genoux';
    v.description := 'Mobilité contrôlée du genou en faible charge.';
    v.instructions := 'Debout avec un appui stable si besoin, réalise de petits cercles contrôlés du genou sans douleur.';
    v.tips := 'Amplitude courte ; le genou reste aligné et le mouvement ne doit pas provoquer de gêne.';
    v.movement_side := 'Unilateral';
    v.warmup_only := true;
    v.wod_role := 'prep_only';
    v.usable_for := ARRAY['Warm-up']::varchar[];
    v.image_path := null;
    v.created_at := now();
    INSERT INTO public.exercises SELECT v.*;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.exercises WHERE id='EXW038') THEN
    SELECT * INTO v FROM public.exercises WHERE id='EXW012';
    v.id := 'EXW038';
    v.name := 'Elbow CARs';
    v.display_name := 'Cercles de coudes';
    v.description := 'Flexion, extension et rotations contrôlées des avant-bras pour préparer les coudes.';
    v.instructions := 'Bras relâchés, fléchis et tends les coudes puis ajoute de petites rotations contrôlées des avant-bras.';
    v.tips := 'Reste lent et sans verrouillage agressif en extension.';
    v.warmup_only := true;
    v.wod_role := 'prep_only';
    v.usable_for := ARRAY['Warm-up']::varchar[];
    v.image_path := null;
    v.created_at := now();
    INSERT INTO public.exercises SELECT v.*;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.exercises WHERE id='EXW039') THEN
    SELECT * INTO v FROM public.exercises WHERE id='EX426';
    v.id := 'EXW039';
    v.name := 'Pelvic Circles';
    v.display_name := 'Cercles de bassin';
    v.description := 'Cercles de bassin contrôlés pour mobiliser hanches, bassin et bas du dos.';
    v.instructions := 'Debout, pieds stables, dessine lentement des cercles avec le bassin dans les deux sens.';
    v.tips := 'Garde les épaules relativement stables et choisis une amplitude confortable.';
    v.movement_side := 'Bilateral';
    v.warmup_only := true;
    v.wod_role := 'prep_only';
    v.usable_for := ARRAY['Warm-up']::varchar[];
    v.image_path := null;
    v.created_at := now();
    INSERT INTO public.exercises SELECT v.*;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.exercises WHERE id='EXW040') THEN
    SELECT * INTO v FROM public.exercises WHERE id='EX164';
    v.id := 'EXW040';
    v.name := 'Deep Squat Reach';
    v.display_name := 'Deep Squat Reach';
    v.description := 'Squat profond contrôlé avec ouverture thoracique pour mobiliser chevilles, genoux, hanches et colonne thoracique.';
    v.instructions := 'Descends en squat confortable, garde les pieds ancrés puis tends alternativement un bras vers le haut avant de remonter.';
    v.tips := 'Réduis la profondeur si les talons se décollent ou si une articulation gêne.';
    v.prescription_type := 'reps_standard';
    v.tracking_modes := ARRAY['reps']::text[];
    v.warmup_only := true;
    v.wod_role := 'prep_only';
    v.usable_for := ARRAY['Warm-up']::varchar[];
    v.image_path := null;
    v.created_at := now();
    INSERT INTO public.exercises SELECT v.*;
  END IF;
END $$;

-- Explicit semantic tag: these rows belong to the Unlock pool.
INSERT INTO public.exercise_tags(exercise_id, tag)
SELECT e.id, 'unlock'
FROM public.exercises e
WHERE e.warmup_eligible
  AND e.warmup_role IN ('mobility','activation')
  AND NOT EXISTS (
    SELECT 1 FROM public.exercise_tags t
    WHERE t.exercise_id=e.id AND lower(t.tag)='unlock'
  );

INSERT INTO public.exercise_tags(exercise_id, tag)
SELECT v.exercise_id, v.tag
FROM (VALUES
  ('EXW031','hip'),('EXW031','adductor'),('EXW031','knee'),('EXW031','ankle'),
  ('EXW032','adductor'),('EXW032','hamstring'),('EXW032','hip'),
  ('EXW033','full_body_mobility'),
  ('EXW034','cervical'),('EXW034','neck'),
  ('EXW035','shoulder'),('EXW035','scapula'),
  ('EXW036','thoracic_spine'),('EXW036','trunk_rotation'),
  ('EXW037','knee'),
  ('EXW038','elbow'),
  ('EXW039','pelvis'),('EXW039','hip'),
  ('EXW040','ankle'),('EXW040','knee'),('EXW040','hip'),('EXW040','thoracic_spine')
) AS v(exercise_id,tag)
WHERE NOT EXISTS (
  SELECT 1 FROM public.exercise_tags t
  WHERE t.exercise_id=v.exercise_id AND lower(t.tag)=lower(v.tag)
);

CREATE OR REPLACE FUNCTION public.gym_build_unlock_block_v1(
  p_user_id uuid,
  p_strength_exercises jsonb,
  p_duration_minutes integer,
  p_zone_terms text[] DEFAULT '{}'::text[],
  p_inventory jsonb DEFAULT '[]'::jsonb,
  p_max_complexity integer DEFAULT 3
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_targets jsonb := public.c4_session_architecture_targets_v2(p_duration_minutes,'c4-final-default');
  v_limit int;
  v_minutes int;
  v_alloc_seconds int;
  v_target_ids text[] := '{}';
  v_target_regions text[] := '{}';
  v_excluded text[] := '{}';
  v_families text[] := '{}';
  v_out jsonb := '[]'::jsonb;
  v_pres jsonb;
  v_family text;
  rec record;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid()<>p_user_id THEN
    RAISE EXCEPTION 'Forbidden user';
  END IF;

  v_limit := coalesce((v_targets->>'unlock_exercise_count')::int,2);
  v_minutes := coalesce((v_targets->>'unlock_minutes')::int,2);
  v_alloc_seconds := greatest(30,(v_minutes*60)/greatest(1,v_limit));

  SELECT
    coalesce(array_agg(distinct x.exercise_id) filter(where x.exercise_id is not null),'{}'::text[]),
    coalesce(array_agg(distinct e.body_region) filter(where e.body_region is not null),'{}'::text[])
  INTO v_target_ids,v_target_regions
  FROM (
    SELECT value->>'exercise_id' exercise_id
    FROM jsonb_array_elements(coalesce(p_strength_exercises,'[]'::jsonb))
  ) x
  LEFT JOIN public.exercises e ON e.id=x.exercise_id;

  WHILE jsonb_array_length(v_out)<v_limit LOOP
    SELECT q.* INTO rec
    FROM (
      SELECT e.*,
             public.c4_preparation_family_key_v1(e.id) family_key,
             coalesce(l.coverage,0) link_coverage,
             coalesce(l.max_priority,0) link_priority,
             (SELECT count(*)
              FROM public.workout_session_exercises wse
              JOIN public.workout_sessions ws ON ws.id=wse.session_id
              WHERE ws.user_id=p_user_id
                AND ws.status='completed'
                AND wse.exercise_id=e.id
                AND wse.block_key='unlock'
                AND ws.id IN (
                  SELECT id FROM public.workout_sessions
                  WHERE user_id=p_user_id AND status='completed'
                  ORDER BY coalesce(completed_at,created_at) DESC
                  LIMIT 6
                )) recent_count
      FROM public.exercises e
      LEFT JOIN LATERAL (
        SELECT count(distinct l.target_exercise_id)::int coverage,
               max(l.priority)::int max_priority
        FROM public.exercise_preparation_links l
        WHERE l.active
          AND l.warmup_exercise_id=e.id
          AND l.target_exercise_id=ANY(v_target_ids)
          AND l.link_type IN ('mobility','activation')
      ) l ON true
      WHERE 'Warm-up'=ANY(coalesce(e.usable_for,'{}'::text[]))
        AND coalesce(e.warmup_eligible,false)
        AND e.warmup_role IN ('mobility','activation')
        AND coalesce(e.warmup_intensity,99)<=2
        AND coalesce(e.fatigue_score,99)<=2
        AND coalesce(e.joint_impact,99)<=2
        AND coalesce(e.technical_complexity,99)<=p_max_complexity
        AND NOT (e.id=ANY(public.exercise_expand_functional_exclusions_v1(v_excluded)))
        AND NOT (public.c4_preparation_family_key_v1(e.id)=ANY(v_families))
        AND public.exercise_safe_for_zones(e.id,public.normalize_body_zone_ids(coalesce(p_zone_terms,'{}'::text[])))
        AND public.exercise_equipment_compatible(e.id,p_inventory)
        AND public.exercise_environment_eligible_v1(e.id,'GYM')
    ) q
    ORDER BY
      CASE WHEN q.link_coverage>0 THEN 0 ELSE 1 END,
      CASE WHEN q.body_region=ANY(v_target_regions) THEN 0 ELSE 1 END,
      CASE
        WHEN jsonb_array_length(v_out)=0 AND q.warmup_role='mobility' THEN 0
        WHEN q.warmup_role='activation' THEN 1
        ELSE 2
      END,
      q.link_coverage DESC,
      q.link_priority DESC,
      q.recent_count ASC,
      coalesce(q.selection_weight,0) DESC,
      q.id
    LIMIT 1;

    IF NOT FOUND THEN
      EXIT;
    END IF;

    v_family := rec.family_key;
    v_pres := (
      public.c2_solver_prescription(
        p_user_id,rec.id,'{}'::jsonb,'WARMUP','MAINTAIN',p_inventory
      ) - 'target_rpe_min' - 'target_rpe_max' - 'target_duration_minutes'
    ) || jsonb_build_object(
      'text',public.user_session_builder_auto_preparation_text_v1(
        public.c2_solver_prescription(p_user_id,rec.id,'{}'::jsonb,'WARMUP','MAINTAIN',p_inventory)
      ),
      'block_role','unlock',
      'unlock_role',rec.warmup_role,
      'activation_counts_as_unlock',rec.warmup_role='activation',
      'allocated_duration_seconds',v_alloc_seconds,
      'history_only',true,
      'capability_eligible',false,
      'fatigue_target','minimal',
      'effort_semantics','easy_mobility_or_activation_no_rpe_target',
      'source','gym_unlock_mobility_v2'
    );

    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'exercise_id',rec.id,
      'name',coalesce(nullif(btrim(rec.display_name),''),rec.name),
      'pattern',rec.movement_pattern,
      'family',rec.exercise_family,
      'warmup_role',rec.warmup_role,
      'preparation_family_key',v_family,
      'prescription',v_pres,
      'expected_outcome',jsonb_build_object(
        'block_key','unlock',
        'goal','mobility_and_light_activation_without_fatigue',
        'pain_gate',true,
        'equipment_gate',true,
        'environment_gate',true
      )
    ));

    v_excluded := array_append(v_excluded,rec.id);
    v_families := array_append(v_families,v_family);
  END LOOP;

  RETURN jsonb_build_object(
    'block_key','unlock',
    'label_fr','Unlock',
    'duration_minutes',v_minutes,
    'mechanic','PREPARATION',
    'structure','Mobilité articulaire + activation légère · sans fatigue',
    'exercises',v_out,
    'history_only',true,
    'capability_eligible',false,
    'preparation_quality_contract',jsonb_build_object(
      'version','unlock-mobility-v1',
      'mobility_or_activation_only',true,
      'movement_prep_excluded',true,
      'pulse_raiser_excluded',true
    )
  );
END;
$function$;
