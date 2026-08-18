-- P0-A safety: complete Body Zone coverage for the 12 currently unmapped exercises
-- and fail closed whenever an injured zone is declared for an exercise with
-- unknown Body Zone metadata.

insert into public.exercise_body_zones
  (exercise_id, body_zone_id, involvement, source, notes)
values
  -- EX452 Pike Walk-In: hand-supported vertical push / inversion preparation.
  ('EX452','shoulder','primary','reviewed','P0-A reviewed from Wall Walk / vertical-push analogs'),
  ('EX452','forearm_wrist_hand','support','reviewed','P0-A hand support'),
  ('EX452','arm_elbow','support','reviewed','P0-A upper-limb support'),
  ('EX452','core_abdomen','secondary','reviewed','P0-A trunk stabilization'),
  ('EX452','upper_back_neck','support','reviewed','P0-A scapular/overhead support'),

  -- EX454 Quadruped push-up: same safety footprint as knee/wall push-up family.
  ('EX454','chest','primary','reviewed','P0-A reviewed from push-up analogs'),
  ('EX454','arm_elbow','secondary','reviewed','P0-A elbow/triceps contribution'),
  ('EX454','shoulder','support','reviewed','P0-A shoulder support'),
  ('EX454','forearm_wrist_hand','support','reviewed','P0-A hand support'),

  -- EX455 Scapular push-up from knees.
  ('EX455','shoulder','primary','reviewed','P0-A reviewed from Scapular Wall Push analog'),
  ('EX455','chest','secondary','reviewed','P0-A chest/scapular chain'),
  ('EX455','arm_elbow','secondary','reviewed','P0-A upper-limb support'),
  ('EX455','forearm_wrist_hand','support','reviewed','P0-A hand support'),

  -- EXW001 Down-Up: low-impact burpee regression, hands to floor then stand.
  ('EXW001','hip_glute_groin','primary','reviewed','P0-A reviewed from burpee regressions'),
  ('EXW001','quadriceps','support','reviewed','P0-A stand-up support'),
  ('EXW001','knee','support','reviewed','P0-A floor-to-stand support'),
  ('EXW001','ankle_foot','support','reviewed','P0-A locomotor support'),
  ('EXW001','calf_shin','support','reviewed','P0-A locomotor support'),
  ('EXW001','forearm_wrist_hand','support','reviewed','P0-A hand contact with floor'),
  ('EXW001','shoulder','support','reviewed','P0-A upper-limb support on floor'),

  -- EXW002 Step-Back Down-Up: controlled version, same joints but lower impact.
  ('EXW002','hip_glute_groin','primary','reviewed','P0-A reviewed from controlled burpee regressions'),
  ('EXW002','quadriceps','support','reviewed','P0-A stand-up support'),
  ('EXW002','knee','support','reviewed','P0-A step-back support'),
  ('EXW002','ankle_foot','support','reviewed','P0-A locomotor support'),
  ('EXW002','calf_shin','support','reviewed','P0-A locomotor support'),
  ('EXW002','forearm_wrist_hand','support','reviewed','P0-A hand contact with floor'),
  ('EXW002','shoulder','support','reviewed','P0-A upper-limb support on floor'),

  -- EXW003 Squat to Reach: squat mechanics + overhead reach.
  ('EXW003','quadriceps','primary','reviewed','P0-A reviewed from squat/thruster prep analogs'),
  ('EXW003','hip_glute_groin','secondary','reviewed','P0-A squat support'),
  ('EXW003','knee','support','reviewed','P0-A squat joint'),
  ('EXW003','ankle_foot','support','reviewed','P0-A squat mobility/support'),
  ('EXW003','shoulder','secondary','reviewed','P0-A overhead reach'),
  ('EXW003','upper_back_neck','support','reviewed','P0-A overhead/scapular support'),

  -- EXW004 Low Pogo Bounce: repeated low-amplitude ankle/calf spring.
  ('EXW004','calf_shin','primary','reviewed','P0-A reviewed from single-under/jump analogs'),
  ('EXW004','ankle_foot','support','reviewed','P0-A jump contact'),
  ('EXW004','knee','support','reviewed','P0-A landing support'),
  ('EXW004','quadriceps','support','reviewed','P0-A landing support'),
  ('EXW004','hip_glute_groin','support','reviewed','P0-A lower-limb stabilization'),

  -- EXW005 Wall Shoulder Lean: vertical-push shoulder activation against wall.
  ('EXW005','shoulder','primary','reviewed','P0-A reviewed from handstand wall activation analogs'),
  ('EXW005','upper_back_neck','secondary','reviewed','P0-A scapular support'),
  ('EXW005','arm_elbow','support','reviewed','P0-A upper-limb support'),
  ('EXW005','forearm_wrist_hand','support','reviewed','P0-A wall hand support'),

  -- EXW006 Tall-Kneeling Press Reach: unloaded overhead press pattern.
  ('EXW006','shoulder','primary','reviewed','P0-A reviewed from overhead-press prep analogs'),
  ('EXW006','arm_elbow','secondary','reviewed','P0-A press support'),
  ('EXW006','upper_back_neck','support','reviewed','P0-A scapular/overhead support'),
  ('EXW006','core_abdomen','secondary','reviewed','P0-A tall-kneeling trunk stabilization'),

  -- EXW007 Easy Single Under: same mechanics as canonical Single Under.
  ('EXW007','calf_shin','secondary','reviewed','P0-A copied from canonical Single Under mechanics'),
  ('EXW007','ankle_foot','support','reviewed','P0-A rope-jump support'),
  ('EXW007','knee','support','reviewed','P0-A rope-jump support'),
  ('EXW007','quadriceps','support','reviewed','P0-A rope-jump support'),
  ('EXW007','hip_glute_groin','support','reviewed','P0-A rope-jump stabilization'),
  ('EXW007','forearm_wrist_hand','support','reviewed','P0-A rope handling'),

  -- EXW008 Box Step-Up Prep: low-impact step-up regression.
  ('EXW008','hip_glute_groin','primary','reviewed','P0-A reviewed from Box Jump / step-up analogs'),
  ('EXW008','quadriceps','secondary','reviewed','P0-A step-up drive'),
  ('EXW008','knee','support','reviewed','P0-A step-up joint'),
  ('EXW008','ankle_foot','support','reviewed','P0-A step contact'),
  ('EXW008','calf_shin','support','reviewed','P0-A step support'),
  ('EXW008','hamstring','support','reviewed','P0-A hip-extension support'),

  -- EXW009 High Pull Pattern Drill: unloaded hinge / high-pull preparation.
  ('EXW009','hip_glute_groin','primary','reviewed','P0-A reviewed from hang clean/snatch analogs'),
  ('EXW009','hamstring','support','reviewed','P0-A hinge support'),
  ('EXW009','quadriceps','support','reviewed','P0-A extension support'),
  ('EXW009','knee','support','reviewed','P0-A extension support'),
  ('EXW009','ankle_foot','support','reviewed','P0-A extension support'),
  ('EXW009','calf_shin','support','reviewed','P0-A extension support'),
  ('EXW009','forearm_wrist_hand','support','reviewed','P0-A pull/grip pattern'),
  ('EXW009','shoulder','secondary','reviewed','P0-A high-pull shoulder contribution'),
  ('EXW009','upper_back_neck','secondary','reviewed','P0-A upper-back high-pull contribution')
on conflict (exercise_id, body_zone_id) do update
set involvement = excluded.involvement,
    source = excluded.source,
    notes = excluded.notes;

create or replace function public.exercise_safe_for_zones(
  p_exercise_id character varying,
  p_zone_ids text[]
)
returns boolean
language sql
stable
as $function$
  select case
    when p_zone_ids is null or cardinality(p_zone_ids)=0 then true
    when not public.body_zone_terms_all_known(p_zone_ids) then false
    -- Safety invariant: with a declared injury/discomfort, unknown exercise
    -- metadata must never be interpreted as safe.
    when not exists (
      select 1
      from public.exercise_body_zones ebz
      where ebz.exercise_id = p_exercise_id
    ) then false
    else not exists (
      select 1
      from public.exercise_body_zones ebz
      where ebz.exercise_id = p_exercise_id
        and ebz.body_zone_id = any(public.normalize_body_zone_ids(p_zone_ids))
    )
  end;
$function$;
