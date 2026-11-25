CREATE TABLE IF NOT EXISTS public.body_zone_aliases (
  alias text PRIMARY KEY,
  body_zone_id text NOT NULL REFERENCES public.body_zones(id) ON DELETE CASCADE,
  active boolean NOT NULL DEFAULT true
);

ALTER TABLE public.body_zone_aliases ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow public read on body_zone_aliases" ON public.body_zone_aliases;
CREATE POLICY "Allow public read on body_zone_aliases" ON public.body_zone_aliases
FOR SELECT TO public USING (true);

INSERT INTO public.body_zone_aliases(alias,body_zone_id,active) VALUES
('shoulder','shoulder',true),('Épaule','shoulder',true),('Epaule','shoulder',true),
('chest','chest',true),('Pectoraux','chest',true),
('arm_elbow','arm_elbow',true),('Bras / coude','arm_elbow',true),('Coude','arm_elbow',true),('Bras','arm_elbow',true),
('forearm_wrist_hand','forearm_wrist_hand',true),('Avant-bras / poignet / main','forearm_wrist_hand',true),('Poignet','forearm_wrist_hand',true),('Main','forearm_wrist_hand',true),('Avant-bras','forearm_wrist_hand',true),
('upper_back_neck','upper_back_neck',true),('Haut du dos / nuque','upper_back_neck',true),('Haut du dos','upper_back_neck',true),('Nuque','upper_back_neck',true),
('core_abdomen','core_abdomen',true),('Sangle abdominale','core_abdomen',true),('Abdominaux','core_abdomen',true),('Ventre','core_abdomen',true),
('lower_back','lower_back',true),('Bas du dos','lower_back',true),('Lombaires','lower_back',true),
('hip_glute_groin','hip_glute_groin',true),('Hanche / fessiers / aine','hip_glute_groin',true),('Hanche','hip_glute_groin',true),('Fessiers','hip_glute_groin',true),('Aine','hip_glute_groin',true),
('quadriceps','quadriceps',true),('Cuisse avant / quadriceps','quadriceps',true),('Quadriceps','quadriceps',true),('Cuisse avant','quadriceps',true),
('hamstring','hamstring',true),('Cuisse arrière / ischios','hamstring',true),('Ischios','hamstring',true),('Ischio-jambiers','hamstring',true),('Cuisse arrière','hamstring',true),
('knee','knee',true),('Genou','knee',true),
('calf_shin','calf_shin',true),('Mollet / tibia','calf_shin',true),('Mollet','calf_shin',true),('Tibia','calf_shin',true),
('ankle_foot','ankle_foot',true),('Cheville / pied','ankle_foot',true),('Cheville','ankle_foot',true),('Pied','ankle_foot',true)
ON CONFLICT(alias) DO UPDATE SET body_zone_id=EXCLUDED.body_zone_id,active=EXCLUDED.active;

CREATE OR REPLACE FUNCTION public.normalize_body_zone_ids(p_terms text[])
RETURNS text[]
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(array_agg(DISTINCT a.body_zone_id ORDER BY a.body_zone_id),'{}'::text[])
  FROM unnest(COALESCE(p_terms,'{}'::text[])) t(term)
  JOIN public.body_zone_aliases a ON lower(a.alias)=lower(trim(t.term)) AND a.active;
$$;

CREATE OR REPLACE FUNCTION public.body_zone_terms_all_known(p_terms text[])
RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT NOT EXISTS (
    SELECT 1
    FROM unnest(COALESCE(p_terms,'{}'::text[])) t(term)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.body_zone_aliases a
      WHERE a.active AND lower(a.alias)=lower(trim(t.term))
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.exercise_safe_for_zones(
  p_exercise_id varchar,
  p_zone_ids text[]
) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN p_zone_ids IS NULL OR cardinality(p_zone_ids)=0 THEN true
    WHEN NOT public.body_zone_terms_all_known(p_zone_ids) THEN false
    ELSE NOT EXISTS (
      SELECT 1 FROM public.exercise_body_zones ebz
      WHERE ebz.exercise_id=p_exercise_id
        AND ebz.body_zone_id = ANY(public.normalize_body_zone_ids(p_zone_ids))
    )
  END;
$$;

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_default_injured_zones_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_default_injured_zones_check CHECK (
  public.body_zone_terms_all_known(default_injured_zones)
);;
