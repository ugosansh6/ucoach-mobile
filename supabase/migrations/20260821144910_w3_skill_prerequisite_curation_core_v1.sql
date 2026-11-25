update public.skill_prerequisite_edges
set requirement_json = coalesce(requirement_json,'{}'::jsonb) || jsonb_build_object(
      'curation_review','SOURCE_SCOPE_MISMATCH_NOT_PROMOTED_TO_CAUSAL_EDGE',
      'reviewed_path','DIPS',
      'source_title','Support Strength on the Rings / ring-dip progressions',
      'source_url','https://www.crossfit.com/essentials/support-strength-on-the-rings',
      'note','CrossFit documents support and negative-dip progressions on rings. UGEROD Dips uses parallel bars, so the existing structural order is retained but is not promoted to a physiological prerequisite.'
    ),
    updated_at=now()
where path_key='DIPS'
  and active
  and source='DERIVED_FROM_CURATED_PATH_ORDER_V1';

update public.skill_prerequisite_edges
set source='CROSSFIT_OFFICIAL_LSIT_SCALING_V1',
    confidence=1.0,
    rationale='CrossFit explicitly presents tuck L-sit, one-leg-extended L-sit and full L-sit as progressively harder scaling options. No duration threshold is imposed by UGEROD.',
    requirement_json=jsonb_build_object(
      'evidence_type','OFFICIAL_PROGRESSION',
      'qualitative_only',true,
      'no_fixed_duration_threshold',true,
      'source_title','CrossFit Substitutions - L-sit scaling',
      'source_url','https://www.crossfit.com/faq/substitutions'
    ),
    version='w3-skill-prerequisite-curated-core-v1',
    updated_at=now()
where path_key='L_SIT_CORE'
  and target_exercise_id='EX481'
  and prerequisite_exercise_id='EX480'
  and active;

insert into public.skill_prerequisite_edges(
  path_key,target_exercise_id,prerequisite_kind,prerequisite_exercise_id,
  requirement_json,source,confidence,rationale,version,active
) values
(
  'L_SIT_CORE','EX091','SKILL_STEP','EX481',
  jsonb_build_object(
    'evidence_type','OFFICIAL_PROGRESSION',
    'qualitative_only',true,
    'no_fixed_duration_threshold',true,
    'source_title','CrossFit Substitutions - L-sit scaling',
    'source_url','https://www.crossfit.com/faq/substitutions'
  ),
  'CROSSFIT_OFFICIAL_LSIT_SCALING_V1',1.0,
  'CrossFit explicitly uses one-leg-extended L-sit as a scaling step between tuck and full straight-leg L-sit. UGEROD treats this as a qualitative prerequisite without inventing a hold-time threshold.',
  'w3-skill-prerequisite-curated-core-v1',true
),
(
  'PULL_UP_MUSCLE_UP','EX080','EXERCISE_CAPABILITY','EX071',
  jsonb_build_object(
    'capability_role','PULLING_STRENGTH_BASE_FOR_TRANSITION_PRACTICE',
    'evidence_type','OFFICIAL_COACHING_GUIDANCE',
    'qualitative_only',true,
    'no_fixed_rep_threshold',true,
    'source_title','Developing a Muscle-Up With CrossFit',
    'source_url','https://www.crossfit.com/pro-coach/developing-a-muscle-up'
  ),
  'CROSSFIT_OFFICIAL_MUSCLE_UP_DEVELOPMENT_V1',1.0,
  'CrossFit states that once strict pull-up capacity is developed, muscle-up transition drills can begin. UGEROD requires supported pull-up capability but deliberately adds no universal rep threshold.',
  'w3-skill-prerequisite-curated-core-v1',true
),
(
  'HANDSTAND_HSPU','EX203','EXERCISE_CAPABILITY','EX456',
  jsonb_build_object(
    'capability_role','INVERTED_PRESSING_BASE',
    'evidence_type','OFFICIAL_HSPU_PROGRESSION',
    'qualitative_only',true,
    'no_fixed_rep_threshold',true,
    'source_title','HSPU and You: Master the Movement',
    'source_url','https://www.crossfit.com/essentials/hspu-and-you-master-the-movement'
  ),
  'CROSSFIT_OFFICIAL_HSPU_PROGRESSION_V1',1.0,
  'CrossFit includes a pike handstand push-up progression before attempting a handstand push-up. UGEROD uses the existing advanced Pike Push-up step as a qualitative prerequisite for strict HSPU.',
  'w3-skill-prerequisite-curated-core-v1',true
),
(
  'HANDSTAND_HSPU','EX203','EXERCISE_CAPABILITY','EX027',
  jsonb_build_object(
    'capability_role','SAFE_INVERTED_SUPPORT_BASE',
    'evidence_type','OFFICIAL_HSPU_PROGRESSION',
    'qualitative_only',true,
    'no_fixed_hold_threshold',true,
    'source_title','HSPU and You: Master the Movement',
    'source_url','https://www.crossfit.com/essentials/hspu-and-you-master-the-movement'
  ),
  'CROSSFIT_OFFICIAL_HSPU_PROGRESSION_V1',1.0,
  'CrossFit requires safe handstand capacity before handstand push-up work. UGEROD uses its existing Handstand Hold capability as the qualitative support prerequisite without adding a hold-time threshold.',
  'w3-skill-prerequisite-curated-core-v1',true
),
(
  'HANDSTAND_HSPU','EX459','EXERCISE_CAPABILITY','EX203',
  jsonb_build_object(
    'capability_role','STRICT_BEFORE_KIPPING',
    'evidence_type','OFFICIAL_COACHING_POLICY',
    'qualitative_only',true,
    'no_fixed_rep_threshold',true,
    'source_title','Strict Before Kipping?',
    'source_url','https://www.crossfit.com/pro-coach/strict-before-kipping'
  ),
  'CROSSFIT_OFFICIAL_STRICT_BEFORE_KIPPING_V1',1.0,
  'CrossFit recommends demonstrating capacity in the strict handstand push-up before progressing to the kipping handstand push-up. UGEROD encodes that relationship without a rep threshold.',
  'w3-skill-prerequisite-curated-core-v1',true
)
on conflict do nothing;

comment on table public.skill_prerequisite_edges is 'W3 SKL-001 versioned prerequisite graph. Structural path order remains non-causal by default. Curated-core-v1 adds only source-backed qualitative prerequisite relationships for Pull-up/Muscle-up, Handstand/HSPU and L-sit; Dips remains structural where source apparatus does not match.';
