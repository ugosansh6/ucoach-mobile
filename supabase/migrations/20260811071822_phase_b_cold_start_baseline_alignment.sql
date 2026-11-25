ALTER TABLE public.user_athletic_baseline
  DROP CONSTRAINT IF EXISTS user_athletic_baseline_dimension_check;

ALTER TABLE public.user_athletic_baseline
  ADD CONSTRAINT user_athletic_baseline_dimension_check
  CHECK (dimension IN ('strength','conditioning','power','stability','mobility'));

CREATE UNIQUE INDEX IF NOT EXISTS uq_user_athletic_baseline_user_dimension
  ON public.user_athletic_baseline(user_id, dimension);

CREATE OR REPLACE VIEW public.user_cold_start_prior
WITH (security_invoker=true)
AS
WITH dimensions AS (
  SELECT unnest(ARRAY['strength','conditioning','power','stability','mobility']::text[]) AS dimension
), profile_base AS (
  SELECT
    p.id AS user_id,
    p.experience,
    CASE p.experience::text
      WHEN 'beginner' THEN 2
      WHEN 'intermediate' THEN 3
      WHEN 'advanced' THEN 4
      ELSE 3
    END::smallint AS global_rating
  FROM public.profiles p
)
SELECT
  pb.user_id,
  d.dimension,
  pb.experience,
  pb.global_rating,
  b.self_rating AS explicit_self_rating,
  COALESCE(b.self_rating, pb.global_rating)::smallint AS effective_self_rating,
  CASE
    WHEN b.self_rating IS NOT NULL THEN 'dimension_self_assessment'
    ELSE 'global_experience_fallback'
  END AS prior_source,
  b.source AS baseline_source,
  b.benchmark_json
FROM profile_base pb
CROSS JOIN dimensions d
LEFT JOIN public.user_athletic_baseline b
  ON b.user_id=pb.user_id AND b.dimension=d.dimension;;
