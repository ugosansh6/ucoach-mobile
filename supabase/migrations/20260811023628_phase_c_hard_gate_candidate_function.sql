CREATE OR REPLACE FUNCTION public.session_hard_gate_candidates(
  p_zone_ids text[],
  p_inventory jsonb,
  p_usable_for text,
  p_max_complexity integer,
  p_max_difficulty text
) RETURNS TABLE (
  exercise_id varchar,
  exercise_name text,
  difficulty varchar,
  technical_complexity integer,
  movement_pattern varchar,
  exercise_family varchar,
  training_focus varchar,
  selection_weight integer
)
LANGUAGE sql STABLE AS $$
  WITH limits AS (
    SELECT CASE p_max_difficulty
      WHEN 'Débutant' THEN 1
      WHEN 'Intermédiaire' THEN 2
      WHEN 'Avancé' THEN 3
      ELSE 0 END AS difficulty_rank
  )
  SELECT e.id,e.name,e.difficulty,e.technical_complexity,e.movement_pattern,
         e.exercise_family,e.training_focus,e.selection_weight
  FROM public.exercises e CROSS JOIN limits l
  WHERE p_usable_for = ANY(e.usable_for)
    -- conservative unknown metadata rule
    AND e.difficulty IS NOT NULL
    AND e.technical_complexity IS NOT NULL
    AND e.movement_pattern IS NOT NULL
    AND e.exercise_family IS NOT NULL
    AND e.training_focus IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.exercise_body_zones z WHERE z.exercise_id=e.id)
    -- absolute user-declared discomfort gate
    AND public.exercise_safe_for_zones(e.id,p_zone_ids)
    -- actual inventory / ALL_OF + ANY_OF + quantities
    AND public.exercise_equipment_compatible(e.id,p_inventory)
    -- caller supplies today's capability ceilings
    AND e.technical_complexity <= p_max_complexity
    AND CASE e.difficulty WHEN 'Débutant' THEN 1 WHEN 'Intermédiaire' THEN 2 WHEN 'Avancé' THEN 3 ELSE 99 END <= l.difficulty_rank
  ORDER BY e.id;
$$;;
