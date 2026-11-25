-- EQP-004 + SAFE-002 targeted repairs found during Check-in audit.

-- Explicit wall / vertical target capability. A place never implies this equipment.
insert into public.equipment(id,name,category,description)
values ('E49','Mur / cible verticale','Support','Mur dégagé ou cible verticale utilisable pour les exercices qui l’exigent.')
on conflict (id) do update set
  name=excluded.name,
  category=excluded.category,
  description=excluded.description;

insert into public.equipment_locations(equipment_id,location_key,display_order) values
  ('E49','HOME',49),('E49','OUTDOOR',49),('E49','GARAGE',49),('E49','GYM_BOX',49)
on conflict (equipment_id,location_key) do nothing;

insert into public.equipment_locations(equipment_id,location_key,display_order) values
  ('E39','GYM_BOX',39),
  ('E43','GYM_BOX',43),
  ('E44','GYM_BOX',44),
  ('E45','HOME',45),('E45','OUTDOOR',45),('E45','GARAGE',45),('E45','GYM_BOX',45),
  ('E46','GYM_BOX',46),
  ('E47','GYM_BOX',47),
  ('E48','GARAGE',48),('E48','GYM_BOX',48)
on conflict (equipment_id,location_key) do nothing;

-- Penguin Tap is a Double Under drill: rope availability is required for the skill path to be relevant.
insert into public.exercise_equipment_requirements_v2(exercise_id,option_group,equipment_id,min_quantity,is_optional,notes)
values ('EX476',1,'E02',1,false,'Double Under drill: rope must be available in the session context even though the drill itself uses hand taps.')
on conflict (exercise_id,option_group,equipment_id) do update set
  min_quantity=excluded.min_quantity,
  is_optional=excluded.is_optional,
  notes=excluded.notes;

-- Wall-dependent exercises must be infeasible when no wall/vertical target was explicitly declared.
with wall_exercise(exercise_id) as (
  values
    ('EX001'),('EX027'),('EX029'),('EX203'),('EX305'),
    ('EX436'),('EX437'),('EX439'),('EX441'),
    ('EX457'),('EX458'),('EX459'),('EX460'),('EX461'),('EX462'),('EX463'),('EX464'),
    ('EXW005'),('EXW029')
)
insert into public.exercise_equipment_requirements_v2(exercise_id,option_group,equipment_id,min_quantity,is_optional,notes)
select w.exercise_id,
       coalesce((select max(r.option_group)+1 from public.exercise_equipment_requirements_v2 r where r.exercise_id=w.exercise_id),1),
       'E49',1,false,'Explicit wall / vertical target required; never inferred from environment or Outdoor place.'
from wall_exercise w
where not exists (
  select 1 from public.exercise_equipment_requirements_v2 r
  where r.exercise_id=w.exercise_id and r.equipment_id='E49' and not r.is_optional
)
on conflict (exercise_id,option_group,equipment_id) do nothing;

with wall_exercise(exercise_id) as (
  values
    ('EX001'),('EX027'),('EX029'),('EX203'),('EX305'),
    ('EX436'),('EX437'),('EX439'),('EX441'),
    ('EX457'),('EX458'),('EX459'),('EX460'),('EX461'),('EX462'),('EX463'),('EX464'),
    ('EXW005'),('EXW029')
)
insert into public.exercise_equipment(exercise_id,equipment_id)
select exercise_id,'E49' from wall_exercise
on conflict do nothing;

-- Complete body-zone safety metadata for the ten new mobility / preparation exercises.
insert into public.exercise_body_zones(exercise_id,body_zone_id,involvement,source,notes) values
  ('EXW031','hip_glute_groin','primary','reviewed','Cossack mobility: hips/adductors/groin are directly mobilised.'),
  ('EXW031','knee','secondary','reviewed','Loaded lateral knee flexion.'),
  ('EXW031','ankle_foot','secondary','reviewed','Ankle mobility/stability required.'),
  ('EXW032','hip_glute_groin','primary','reviewed','Dynamic straddle directly loads adductors/groin/hips.'),
  ('EXW032','hamstring','secondary','reviewed','Hamstrings are directly lengthened.'),
  ('EXW033','ankle_foot','primary','reviewed','Repeated light bouncing uses ankle/foot.'),
  ('EXW033','calf_shin','secondary','reviewed','Calf/shin participate in repeated light bouncing.'),
  ('EXW033','knee','secondary','reviewed','Knees accompany the bounce.'),
  ('EXW033','hip_glute_groin','secondary','reviewed','Hips accompany the bounce.'),
  ('EXW033','shoulder','support','reviewed','Shoulders are deliberately loosened during the movement.'),
  ('EXW034','upper_back_neck','primary','reviewed','Controlled cervical mobility.'),
  ('EXW035','shoulder','primary','reviewed','Large controlled arm circles directly mobilise shoulders.'),
  ('EXW035','upper_back_neck','secondary','reviewed','Scapular/upper-back motion accompanies shoulder circles.'),
  ('EXW036','upper_back_neck','primary','reviewed','Thoracic rotation is a primary target.'),
  ('EXW036','hip_glute_groin','secondary','reviewed','Pelvis/hips accompany the rotation.'),
  ('EXW036','lower_back','secondary','reviewed','Lumbar region participates and must be protected when symptomatic.'),
  ('EXW037','knee','primary','reviewed','Exercise directly mobilises the knee.'),
  ('EXW038','arm_elbow','primary','reviewed','Exercise directly mobilises the elbow.'),
  ('EXW038','forearm_wrist_hand','secondary','reviewed','Forearm rotation accompanies the elbow circles.'),
  ('EXW039','hip_glute_groin','primary','reviewed','Pelvic circles directly mobilise the hips/pelvis.'),
  ('EXW039','lower_back','secondary','reviewed','Lower back accompanies pelvic circles.'),
  ('EXW040','hip_glute_groin','primary','reviewed','Deep squat directly mobilises hips.'),
  ('EXW040','knee','primary','reviewed','Deep squat directly loads knee flexion.'),
  ('EXW040','ankle_foot','primary','reviewed','Deep squat requires ankle mobility.'),
  ('EXW040','quadriceps','secondary','reviewed','Quadriceps participate in squat control.'),
  ('EXW040','shoulder','secondary','reviewed','Overhead reach mobilises shoulder.'),
  ('EXW040','upper_back_neck','secondary','reviewed','Thoracic opening accompanies the reach.')
on conflict (exercise_id,body_zone_id) do update set
  involvement=excluded.involvement,
  source=excluded.source,
  notes=excluded.notes;
