create table if not exists public.skill_prerequisite_reviews(
  path_key text not null references public.skill_paths(path_key) on delete cascade,
  target_exercise_id varchar not null references public.exercises(id) on delete cascade,
  review_status text not null,source_refs jsonb not null default '[]'::jsonb,rationale text,
  version text not null default 'w3-skill-prerequisite-curation-complete-v1',reviewed_at timestamptz not null default now(),
  primary key(path_key,target_exercise_id)
);
alter table public.skill_prerequisite_reviews enable row level security;
drop policy if exists skill_prerequisite_reviews_read on public.skill_prerequisite_reviews;
create policy skill_prerequisite_reviews_read on public.skill_prerequisite_reviews for select to authenticated using(true);
revoke all on public.skill_prerequisite_reviews from anon;
grant select on public.skill_prerequisite_reviews to authenticated,service_role;

update public.skill_prerequisite_edges set requirement_json=coalesce(requirement_json,'{}'::jsonb)||jsonb_build_object('causal_for_limiting_factor',false,'edge_role','STRUCTURAL_PROGRESSION_ONLY'),updated_at=now() where source='DERIVED_FROM_CURATED_PATH_ORDER_V1';
update public.skill_prerequisite_edges set requirement_json=coalesce(requirement_json,'{}'::jsonb)||jsonb_build_object('causal_for_limiting_factor',true,'edge_role','SOURCE_BACKED_CAPABILITY_PREREQUISITE'),updated_at=now() where source in('CROSSFIT_OFFICIAL_LSIT_SCALING_V1','CROSSFIT_OFFICIAL_MUSCLE_UP_DEVELOPMENT_V1','CROSSFIT_OFFICIAL_HSPU_PROGRESSION_V1','CROSSFIT_OFFICIAL_STRICT_BEFORE_KIPPING_V1');

with c(path_key,target_id,kind,prereq_id,source,url) as(values
('BARBELL_CLEAN_JERK','EX494','SKILL_STEP','EX493','CROSSFIT_OFFICIAL_POWER_CLEAN_PROGRESSION_V1','https://www.crossfit.com/essentials/the-power-clean'),
('BARBELL_CLEAN_JERK','EX495','SKILL_STEP','EX494','CROSSFIT_OFFICIAL_CLEAN_VARIATION_PROGRESSION_V1','https://www.crossfit.com/essentials/workout-demo-for-221118'),
('DOUBLE_UNDER','EX157','SKILL_STEP','EX156','CROSSFIT_OFFICIAL_DOUBLE_UNDER_PROGRESSION_V1','https://www.crossfit.com/essentials/from-single-unders-to-double-unders'),
('HANGING_CORE_TTB','EX486','EXERCISE_CAPABILITY','EX484','CROSSFIT_OFFICIAL_TTB_PROGRESSION_V1','https://www.crossfit.com/pro-coach/ask-a-coach-how-to-teach-coach-toes-to-bar'),
('BARBELL_CLEAN_JERK','EX491','EXERCISE_CAPABILITY','EX490','CROSSFIT_OFFICIAL_PUSH_JERK_PROGRESSION_V1','https://library.crossfit.com/free/pdf/CFJ_English_Level1_TrainingGuide.pdf'),
('BARBELL_CLEAN_JERK','EX500','EXERCISE_CAPABILITY','EX495','CROSSFIT_OFFICIAL_CLEAN_JERK_COMPONENTS_V1','https://www.crossfit.com/essentials/the-clean-and-jerk'),
('BARBELL_CLEAN_JERK','EX500','EXERCISE_CAPABILITY','EX491','CROSSFIT_OFFICIAL_CLEAN_JERK_COMPONENTS_V1','https://www.crossfit.com/essentials/the-clean-and-jerk'),
('BARBELL_SNATCH','EX498','EXERCISE_CAPABILITY','EX497','CROSSFIT_OFFICIAL_POWER_SNATCH_PROGRESSION_V1','https://www.crossfit.com/pro-coach/three-step-movement-progression-crossfit-coach'),
('BARBELL_SNATCH','EX499','EXERCISE_CAPABILITY','EX498','CROSSFIT_OFFICIAL_SQUAT_SNATCH_PROGRESSION_V1','https://www.crossfit.com/essentials/workout-tips-for-211202'),
('PISTOL','EX044','EXERCISE_CAPABILITY','EX478','CROSSFIT_OFFICIAL_PISTOL_SCALING_V1','https://www.crossfit.com/essentials/the-single-leg-squat'),
('SINGLE_LEG_HINGE','EX405','EXERCISE_CAPABILITY','EX_L02','ACE_RDL_LOAD_PROGRESSION_V1','https://www.acefitness.org/continuing-education/prosource/january-2016/5767/ace-technique-series-romanian-deadlift/'),
('HANDSTAND_HSPU','EX457','EXERCISE_CAPABILITY','EX027','CROSSFIT_OFFICIAL_HSPU_BRANCH_CURATION_V1','https://www.crossfit.com/essentials/hspu-and-you-master-the-movement'),
('HANDSTAND_HSPU','EX462','EXERCISE_CAPABILITY','EX027','CROSSFIT_OFFICIAL_HANDSTAND_WALK_FOUNDATION_V1','https://www.crossfit.com/essentials/crossfit-handstand-walking-rx-plan'),
('HANDSTAND_HSPU','EX465','EXERCISE_CAPABILITY','EX451','CROSSFIT_OFFICIAL_HANDSTAND_WALK_FOUNDATION_V1','https://www.crossfit.com/essentials/crossfit-handstand-walking-rx-plan'),
('HANDSTAND_HSPU','EX463','EXERCISE_CAPABILITY','EX027','CROSSFIT_OFFICIAL_HANDSTAND_WALK_FOUNDATION_V1','https://www.crossfit.com/essentials/crossfit-handstand-walking-rx-plan'),
('HANDSTAND_HSPU','EX453','EXERCISE_CAPABILITY','EX203','CROSSFIT_OFFICIAL_FREE_HSPU_FOUNDATION_V1','https://www.crossfit.com/essentials/hspu-and-you-master-the-movement'),
('HANDSTAND_HSPU','EX453','EXERCISE_CAPABILITY','EX451','CROSSFIT_OFFICIAL_FREE_HSPU_FOUNDATION_V1','https://www.crossfit.com/essentials/crossfit-handstand-walking-rx-plan')
)
insert into public.skill_prerequisite_edges(path_key,target_exercise_id,prerequisite_kind,prerequisite_exercise_id,requirement_json,source,confidence,rationale,version,active)
select path_key,target_id,kind,prereq_id,jsonb_build_object('causal_for_limiting_factor',true,'edge_role','SOURCE_BACKED_CAPABILITY_PREREQUISITE','qualitative_only',true,'no_fixed_threshold',true,'source_url',url),source,case when source='ACE_RDL_LOAD_PROGRESSION_V1' then .95 else 1 end,'Source-backed qualitative prerequisite; UGEROD deliberately adds no universal rep, hold or load threshold.','w3-skill-prerequisite-curation-complete-v1',true from c on conflict do nothing;

insert into public.skill_prerequisite_reviews(path_key,target_exercise_id,review_status,source_refs,rationale,version,reviewed_at)
select sp.path_key,m.exercise_id,
case when m.member_role='entry' then 'ENTRY_NO_PREREQUISITE_REQUIRED'
 when exists(select 1 from public.skill_prerequisite_edges pe where pe.path_key=m.path_key and pe.target_exercise_id=m.exercise_id and pe.active and coalesce((pe.requirement_json->>'causal_for_limiting_factor')::boolean,false)) then 'CURATED_CAUSAL'
 when sp.path_key='DB_CLEAN_SNATCH' then 'PARALLEL_SKILL_FAMILY_NO_CAUSAL_ORDER'
 when m.member_role='alternate' then 'ALTERNATE_BRANCH_REVIEWED_NO_AUTO_GATE'
 else 'STRUCTURAL_OR_SUPPORTING_ONLY_REVIEWED' end,
coalesce((select jsonb_agg(distinct jsonb_build_object('url',pe.requirement_json->>'source_url')) from public.skill_prerequisite_edges pe where pe.path_key=m.path_key and pe.target_exercise_id=m.exercise_id and pe.active and nullif(pe.requirement_json->>'source_url','') is not null),'[]'::jsonb),
case when sp.path_key='DB_CLEAN_SNATCH' then 'Clean and snatch are parallel technical skills here; path order is not a physiological prerequisite.' when sp.path_key='DIPS' then 'Reviewed, but the direct CrossFit progression source is ring-specific while UGEROD uses parallel bars; keep structural only.' else 'Reviewed. Only source-backed edges explicitly marked causal may gate a limiting factor.' end,
'w3-skill-prerequisite-curation-complete-v1',now()
from public.skill_paths sp join public.skill_path_members m on m.path_key=sp.path_key and m.active where sp.active
on conflict(path_key,target_exercise_id) do update set review_status=excluded.review_status,source_refs=excluded.source_refs,rationale=excluded.rationale,version=excluded.version,reviewed_at=now();
comment on table public.skill_prerequisite_reviews is 'W3 SKL-001 review registry for every active Skill member. Structural order is never causal by itself.';
