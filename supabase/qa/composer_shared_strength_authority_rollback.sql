-- DEV-only, read-only shared-authority regression.
-- Uses a synthetic auth subject, no real user data and no permanent writes.
BEGIN;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';

DO $qa$
DECLARE
  v_user uuid := '00000000-0000-0000-0000-000000000001';
  v_two jsonb := '[{"id":"EXW029"},{"id":"EXW021"}]'::jsonb;
  v_result jsonb;
  v_draft jsonb;
  v_pool jsonb;
BEGIN
  v_result := public.week_composer_strength_authority_v2(
    v_user,v_two,60,21,'MAINTAIN','{}','Strength','Full Body','normal','HOME');
  IF v_result->>'status' <> 'READY' OR v_result->>'duration_contract'<>'C4_STANDARD_DURATION' THEN
    RAISE EXCEPTION 'HOME_21_DID_NOT_REUSE_C4: %',v_result->>'status';
  END IF;

  v_result := public.week_composer_strength_authority_v2(
    v_user,v_two,60,45,'MAINTAIN','{}','Strength','Full Body','normal','HOME');
  IF v_result->>'status' <> 'UNDERFILLED'
     OR (v_result#>>'{time,prescribed_seconds}')::numeric >= 45*60 THEN
    RAISE EXCEPTION 'FAKE_45_MINUTE_COMPOSITION_ACCEPTED';
  END IF;

  v_result := public.week_composer_strength_authority_v2(
    v_user,v_two,60,21,'MAINTAIN','{}','Strength','Full Body','normal','GYM');
  IF v_result->>'status' <> 'UNDERFILLED'
     OR v_result->>'duration_contract'<>'GYM_STANDARD_REAL_ELAPSED' THEN
    RAISE EXCEPTION 'GYM_DURATION_POLICY_IGNORED';
  END IF;

  v_draft:=jsonb_build_object(
    'duration_minutes',60,'environment_code','HOME',
    'progression_intent','MAINTAIN','intent',jsonb_build_object('focus','Strength'),
    'target_region','Full Body','architecture',jsonb_build_object(
      'blocks',jsonb_build_array(jsonb_build_object(
        'type','STRENGTH','minutes',45,'exercises',v_two
      ))
    )
  );
  v_result:=public.week_composer_prescription_preview_v1(v_user,v_draft,'{}');
  IF v_result->>'status' <> 'NEEDS_RECOMPOSITION'
     OR v_result->>'reason'<>'STRENGTH_BLOCK_TIME_MISMATCH' THEN
    RAISE EXCEPTION 'PREVIEW_IGNORES_SHARED_STRENGTH_ENGINE';
  END IF;

  SELECT jsonb_agg(jsonb_build_object('id',id,'name',name)) INTO v_pool
  FROM (
    SELECT id,name FROM (
      SELECT DISTINCT ON (movement_pattern) id,name,movement_pattern
      FROM public.exercises
      WHERE movement_pattern IS NOT NULL AND coalesce(warmup_only,false)=false
      ORDER BY movement_pattern,id LIMIT 8
    ) q
  ) t;
  v_result:=public.week_composer_strength_autopick_v2(
    v_user,v_pool,60,45,'MAINTAIN','{}','Strength','Full Body','HOME'
  );
  IF jsonb_array_length(v_result->'selected_exercises')<=2
     OR v_result->>'selection_authority'<>'C2+C4+UGEROD_TIME_ENGINE' THEN
    RAISE EXCEPTION 'AUTOPICK_STILL_USES_TWO_EXERCISE_QUOTA';
  END IF;
  RAISE NOTICE 'OK: C4 HOME, GYM-specific time, preview fails closed, dynamic autopick';
END;
$qa$;

ROLLBACK;
