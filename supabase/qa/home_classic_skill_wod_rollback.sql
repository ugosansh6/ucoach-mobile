-- UGEROD #26 — DEV-only HOME classic Skill + WOD invariants, 30/45/60 minutes.
-- Synthetic user and all transient planning writes are rolled back.
-- Does not call the W11 Composer compiler or mutate real workout histories.
BEGIN;
SET LOCAL statement_timeout='100000ms';
SET LOCAL ugerod.session_environment='HOME';
INSERT INTO auth.users(id,instance_id,aud,role,email,created_at,updated_at)
VALUES ('00000000-0000-0000-0000-000000000f26',
        '00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated',
        'qa-ticket26-rollback@example.invalid',now(),now());
INSERT INTO public.profiles(id)
VALUES ('00000000-0000-0000-0000-000000000f26') ON CONFLICT DO NOTHING;
DO $qa$
DECLARE
  u uuid:='00000000-0000-0000-0000-000000000f26';
  minutes int;
  plan jsonb;
  skill_count int;
  wod_count int;
  planned int;
BEGIN
  FOREACH minutes IN ARRAY ARRAY[30,45,60] LOOP
    plan:=public.c4_plan_full_session_v2(
      u,'General Fitness',minutes,'normal','Full Body','MAINTAIN',
      '{}'::text[],'[]'::jsonb,3,'Intermédiaire',8,'c4-final-default'
    );
    IF plan->>'status'<>'READY' THEN
      RAISE EXCEPTION 'HOME_CLASSIC_NOT_READY_%: %',minutes,plan->>'reason';
    END IF;
    SELECT count(*) INTO skill_count
    FROM jsonb_array_elements(coalesce(plan->'blocks','[]'::jsonb)) b
    WHERE b->>'block_key'='skill'
      AND nullif(b->>'duration_minutes','')::integer>0
      AND jsonb_array_length(coalesce(b->'exercises','[]'::jsonb))>0;
    SELECT count(*) INTO wod_count
    FROM jsonb_array_elements(coalesce(plan->'blocks','[]'::jsonb)) b
    WHERE b->>'block_key'='wod'
      AND nullif(b->>'duration_minutes','')::integer>0
      AND jsonb_array_length(coalesce(b->'exercises','[]'::jsonb))>0;
    planned:=coalesce((plan#>>'{architecture,planned_minutes}')::integer,100000);
    IF skill_count<>1 OR wod_count<>1 OR planned>minutes THEN
      RAISE EXCEPTION 'HOME_CLASSIC_INVALID_BLOCKS_%: skill %, wod %, planned %',
        minutes,skill_count,wod_count,planned;
    END IF;
  END LOOP;
END $qa$;
ROLLBACK;
