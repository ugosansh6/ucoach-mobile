alter table public.exercises
  add column if not exists warmup_eligible boolean not null default false,
  add column if not exists warmup_role text,
  add column if not exists warmup_intensity smallint,
  add column if not exists warmup_only boolean not null default false;

alter table public.exercises
  drop constraint if exists exercises_warmup_role_check,
  add constraint exercises_warmup_role_check
    check (warmup_role is null or warmup_role in ('mobility','activation','movement_prep','pulse_raiser')),
  drop constraint if exists exercises_warmup_intensity_check,
  add constraint exercises_warmup_intensity_check
    check (warmup_intensity is null or warmup_intensity between 1 and 3),
  drop constraint if exists exercises_warmup_contract_check,
  add constraint exercises_warmup_contract_check
    check (
      not warmup_eligible
      or (
        warmup_role is not null
        and warmup_intensity is not null
        and coalesce(fatigue_score,99) <= 2
        and coalesce(joint_impact,99) <= 2
        and coalesce(prescription_type,'') <> 'reps_heavy'
        and coalesce(training_focus,'') in ('Mobility','Stability','Conditioning')
      )
    );

update public.exercises
set warmup_eligible = false,
    warmup_role = null,
    warmup_intensity = null,
    warmup_only = false,
    usable_for = array_remove(coalesce(usable_for,'{}'::text[]), 'Warm-up')
where 'Warm-up' = any(coalesce(usable_for,'{}'::text[]));

update public.exercises
set warmup_eligible = true,
    warmup_role = case
      when id in ('EX158','EX159','EX160','EX161','EX162','EX163','EX164','EX166','EX323','EX324') then 'mobility'
      when id in ('EX081','EX101','EX135','EX141','EX322','EX404','EX406','EX407','EX413') then 'activation'
      else 'movement_prep'
    end,
    warmup_intensity = case when id in ('EX322','EX404') then 2 else 1 end,
    usable_for = case
      when not ('Warm-up' = any(coalesce(usable_for,'{}'::text[])))
        then array_append(coalesce(usable_for,'{}'::text[]),'Warm-up')
      else usable_for
    end
where id in (
  'EX081','EX101','EX135','EX141',
  'EX158','EX159','EX160','EX161','EX162','EX163','EX164','EX166',
  'EX322','EX323','EX324','EX404','EX406','EX407','EX413'
);

insert into public.exercises (
  id,name,description,instructions,tips,exercise_type,difficulty,technical_complexity,
  movement_pattern,exercise_family,body_region,training_focus,equipment_requirement,
  fatigue_score,cardio_score,joint_impact,stability_requirement,mobility_requirement,
  energy_system,movement_side,starting_position,transition_cost,selection_weight,
  usable_for,home_friendly,notes,prescription_type,image_path,tracking_modes,tabata_eligible,
  warmup_eligible,warmup_role,warmup_intensity,warmup_only
) values
('EX421','Ankle Dorsiflexion Rock','Mobilité douce de cheville pour préparer squat, fente et locomotion.','1. Place un pied au sol face à un mur.\n2. Avance doucement le genou vers l’avant sans décoller le talon.\n3. Reviens puis répète avant de changer de côté.','Garde le talon au sol et reste dans une amplitude confortable.','mobility','Débutant',1,'Mobility','Mobility','Lower','Mobility','none',1,1,1,1,4,'Mixed','Unilateral','Standing',1,10,array['Warm-up'],true,'Warm-up only — mobilité cheville.','reps_unilateral',null,array['reps'],false,true,'mobility',1,true),
('EX422','90/90 Hip Switch','Mobilité active des hanches en rotation interne et externe.','1. Assieds-toi avec les deux genoux fléchis.\n2. Fais basculer les genoux d’un côté puis de l’autre.\n3. Garde le mouvement lent et contrôlé.','Ne force pas la rotation ; cherche la fluidité.','mobility','Débutant',1,'Mobility','Mobility','Lower','Mobility','none',1,1,1,2,4,'Mixed','Alternating','Seated',1,10,array['Warm-up'],true,'Warm-up only — mobilité hanches.','reps_unilateral',null,array['reps'],false,true,'mobility',1,true),
('EX423','Adductor Rock Back','Mobilité dynamique des adducteurs et de la hanche.','1. Place-toi à quatre appuis et tends une jambe sur le côté.\n2. Recule doucement les hanches.\n3. Reviens sans perdre la position du dos.','Amplitude confortable, sans rebond.','mobility','Débutant',1,'Mobility','Mobility','Lower','Mobility','none',1,1,1,2,4,'Mixed','Unilateral','Quadruped',1,9,array['Warm-up'],true,'Warm-up only — mobilité adducteurs.','reps_unilateral',null,array['reps'],false,true,'mobility',1,true),
('EX424','Hip Flexor Rock + Reach','Mobilité dynamique du fléchisseur de hanche avec ouverture du tronc.','1. Mets-toi en demi-fente genou arrière au sol.\n2. Avance légèrement le bassin.\n3. Monte le bras du côté du genou arrière puis reviens.','Garde les côtes basses et évite de cambrer.','mobility','Débutant',1,'Mobility','Mobility','Lower','Mobility','none',1,1,1,2,4,'Mixed','Unilateral','Half Kneeling',1,9,array['Warm-up'],true,'Warm-up only — mobilité hanche.','reps_unilateral',null,array['reps'],false,true,'mobility',1,true),
('EX425','Hamstring Sweep','Mobilité dynamique des ischio-jambiers sans charge.','1. Avance un pied avec le talon posé.\n2. Recule les hanches et balaie les mains vers le pied.\n3. Reviens debout puis alterne.','Le mouvement doit rester fluide, sans étirement forcé.','mobility','Débutant',1,'Mobility','Mobility','Lower','Mobility','none',1,1,1,1,4,'Mixed','Alternating','Standing',1,9,array['Warm-up'],true,'Warm-up only — mobilité ischios.','reps_unilateral',null,array['reps'],false,true,'mobility',1,true),
('EX426','Standing Hip CARs','Cercles de hanche contrôlés pour explorer l’amplitude active.','1. Tiens-toi debout avec un appui si besoin.\n2. Monte un genou puis ouvre la hanche.\n3. Termine le cercle lentement puis change de sens.','Garde le bassin stable.','mobility','Débutant',2,'Mobility','Mobility','Lower','Mobility','none',1,1,1,3,4,'Mixed','Unilateral','Standing',1,8,array['Warm-up'],true,'Warm-up only — contrôle hanche.','reps_unilateral',null,array['reps'],false,true,'mobility',1,true),
('EX427','Squat to Stand','Préparation douce du pattern squat avec mobilité de hanches et chevilles.','1. Penche-toi pour saisir les pointes de pieds ou les tibias.\n2. Descends en squat confortable.\n3. Redresse les hanches puis recommence.','Reste lent ; ce n’est pas un exercice de force.','mobility','Débutant',2,'Squat','Squat','Lower','Mobility','none',2,1,1,2,4,'Mixed','Bilateral','Standing',1,9,array['Warm-up'],true,'Warm-up only — préparation squat.','reps_standard',null,array['reps'],false,true,'movement_prep',2,true),
('EX428','Assisted Lateral Squat Shift','Déplacement latéral contrôlé pour préparer les fentes et l’ouverture de hanche.','1. Prends un écartement large et utilise un support si besoin.\n2. Transfère doucement le poids vers une jambe.\n3. Reviens au centre puis alterne.','Reste haut si la mobilité est limitée.','mobility','Débutant',2,'Lunge','Lunge','Lower','Mobility','none',2,1,1,2,4,'Mixed','Alternating','Standing',1,8,array['Warm-up'],true,'Warm-up only — préparation lunge.','reps_unilateral',null,array['reps'],false,true,'movement_prep',2,true),
('EX429','Hip Hinge Wall Drill','Apprentissage du recul de hanches sans charge pour préparer les hinges.','1. Place-toi dos au mur à environ un pied de distance.\n2. Recule les hanches jusqu’à toucher le mur.\n3. Reviens debout en gardant le dos neutre.','Cherche le déplacement des hanches, pas la profondeur.','activation','Débutant',1,'Hinge','Hinge','Lower','Stability','none',1,1,1,2,2,'Mixed','Bilateral','Standing',1,10,array['Warm-up'],true,'Warm-up only — pattern hinge sans charge.','reps_standard',null,array['reps'],false,true,'movement_prep',1,true),
('EX430','Glute Bridge Iso Squeeze','Activation légère des fessiers avant un travail de jambes ou de hinge.','1. Allonge-toi sur le dos, pieds au sol.\n2. Monte le bassin.\n3. Maintiens une contraction douce des fessiers puis redescends.','Ne cherche pas une contraction maximale ; garde les côtes basses.','activation','Débutant',1,'Hinge','Hinge','Lower','Stability','none',1,1,1,2,1,'Mixed','Bilateral','Supine',1,10,array['Warm-up'],true,'Warm-up only — activation fessiers.','isometric',null,array['time'],false,true,'activation',1,true),
('EX431','Clamshell','Activation légère des muscles latéraux de hanche.','1. Allonge-toi sur le côté, genoux fléchis.\n2. Garde les pieds ensemble et ouvre le genou supérieur.\n3. Referme lentement puis change de côté.','Évite de rouler le bassin vers l’arrière.','activation','Débutant',1,'Hinge','Hinge','Lower','Stability','none',1,1,1,2,1,'Mixed','Unilateral','Side Lying',1,9,array['Warm-up'],true,'Warm-up only — activation hanche.','reps_unilateral',null,array['reps'],false,true,'activation',1,true),
('EX432','Mini-Band Lateral Walk','Activation latérale des fessiers avec élastique léger.','1. Place l’élastique autour des genoux ou des chevilles.\n2. Fléchis légèrement les genoux.\n3. Fais de petits pas latéraux contrôlés.','Utilise une résistance légère : le but est d’activer, pas de fatiguer.','activation','Débutant',1,'Lunge','Lunge','Lower','Stability','required',2,1,1,2,1,'Mixed','Alternating','Standing',1,9,array['Warm-up'],true,'Warm-up only — activation avec élastique léger.','reps_unilateral',null,array['reps'],false,true,'activation',2,true),
('EX433','Dead Bug Breathing','Activation du tronc associée à une respiration contrôlée.','1. Allonge-toi sur le dos, hanches et genoux à 90°.\n2. Expire en gardant le bas du dos stable.\n3. Alterne une extension courte bras/jambe opposés.','La respiration et le contrôle priment sur l’amplitude.','activation','Débutant',1,'Anti-Extension','Core','Core','Stability','none',1,1,1,2,1,'Mixed','Alternating','Supine',1,10,array['Warm-up'],true,'Warm-up only — activation core.','reps_unilateral',null,array['reps'],false,true,'activation',1,true),
('EX434','Bird Dog Reach','Activation du tronc et contrôle croisé à quatre appuis.','1. Place-toi à quatre appuis.\n2. Allonge bras et jambe opposés.\n3. Reviens sans bouger le bassin puis alterne.','Garde le mouvement court si le bassin tourne.','activation','Débutant',1,'Anti-Rotation','Core','Core','Stability','none',1,1,1,2,1,'Mixed','Alternating','Quadruped',1,9,array['Warm-up'],true,'Warm-up only — activation core.','reps_unilateral',null,array['reps'],false,true,'activation',1,true),
('EX435','Thoracic Open Book','Rotation thoracique douce pour préparer le haut du corps.','1. Allonge-toi sur le côté, genoux fléchis.\n2. Ouvre le bras supérieur vers l’arrière.\n3. Reviens lentement puis change de côté.','Garde les genoux ensemble pour cibler le haut du dos.','mobility','Débutant',1,'Mobility','Mobility','Full Body','Mobility','none',1,1,1,1,4,'Mixed','Unilateral','Side Lying',1,9,array['Warm-up'],true,'Warm-up only — mobilité thoracique.','reps_unilateral',null,array['reps'],false,true,'mobility',1,true),
('EX436','Scapular Wall Slide','Préparation légère des épaules et des omoplates contre un mur.','1. Place le dos contre le mur et les avant-bras devant toi.\n2. Fais glisser les bras vers le haut.\n3. Redescends sans hausser les épaules.','Reste dans une amplitude indolore.','activation','Débutant',1,'Push Vertical','Push','Upper','Stability','none',1,1,1,2,2,'Mixed','Bilateral','Standing',1,9,array['Warm-up'],true,'Warm-up only — activation scapulaire.','reps_standard',null,array['reps'],false,true,'activation',1,true),
('EX437','Wall Angel','Mobilité active des épaules et du haut du dos contre un mur.','1. Place le dos contre le mur.\n2. Fais glisser les bras de bas en haut.\n3. Garde le mouvement lent et confortable.','Ne force pas le contact des mains avec le mur.','mobility','Débutant',1,'Pull Horizontal','Pull','Upper','Mobility','none',1,1,1,2,3,'Mixed','Bilateral','Standing',1,8,array['Warm-up'],true,'Warm-up only — mobilité épaules.','reps_standard',null,array['reps'],false,true,'mobility',1,true),
('EX438','Band External Rotation','Activation légère de la coiffe des rotateurs avec élastique.','1. Garde les coudes près du corps.\n2. Écarte doucement les mains contre l’élastique.\n3. Reviens lentement.','Choisis une résistance très légère.','activation','Débutant',1,'Pull Horizontal','Pull','Upper','Stability','required',1,1,1,2,1,'Mixed','Bilateral','Standing',1,10,array['Warm-up'],true,'Warm-up only — activation épaule avec élastique léger.','reps_standard',null,array['reps'],false,true,'activation',1,true),
('EX439','Scapular Wall Push','Activation des omoplates en appui léger contre un mur.','1. Place les mains contre un mur, bras tendus.\n2. Laisse les omoplates se rapprocher légèrement.\n3. Repousse le mur pour les écarter sans plier les coudes.','L’appui doit rester léger.','activation','Débutant',1,'Push Horizontal','Push','Upper','Stability','none',1,1,1,2,1,'Mixed','Bilateral','Standing',1,9,array['Warm-up'],true,'Warm-up only — activation scapulaire en appui léger.','reps_standard',null,array['reps'],false,true,'activation',1,true),
('EX440','Prone Y Raise','Activation légère des stabilisateurs de l’omoplate au sol.','1. Allonge-toi sur le ventre.\n2. Place les bras en Y.\n3. Décolle légèrement les mains puis repose avec contrôle.','Très petite amplitude, sans charge.','activation','Débutant',1,'Pull Vertical','Pull','Upper','Stability','none',1,1,1,2,1,'Mixed','Bilateral','Prone',1,8,array['Warm-up'],true,'Warm-up only — activation haut du dos.','reps_standard',null,array['reps'],false,true,'activation',1,true),
('EX441','Serratus Wall Slide','Activation du dentelé et contrôle de l’omoplate contre un mur.','1. Place les avant-bras sur le mur.\n2. Fais-les glisser vers le haut en poussant légèrement dans le mur.\n3. Redescends sans hausser les épaules.','Pression légère et mouvement contrôlé.','activation','Débutant',1,'Push Vertical','Push','Upper','Stability','none',1,1,1,2,1,'Mixed','Bilateral','Standing',1,9,array['Warm-up'],true,'Warm-up only — activation serratus.','reps_standard',null,array['reps'],false,true,'activation',1,true),
('EX442','March in Place','Montée en température très progressive sans impact important.','1. Marche sur place.\n2. Monte les genoux à hauteur confortable.\n3. Garde un rythme facile et régulier.','Tu dois pouvoir parler facilement pendant le mouvement.','conditioning','Débutant',1,'Locomotion','Locomotion','Full Body','Conditioning','none',1,2,1,1,1,'Aerobic','Alternating','Standing',1,9,array['Warm-up'],true,'Warm-up only — pulse raiser faible impact.','reps_unilateral',null,array['reps'],false,true,'pulse_raiser',1,true),
('EX443','Low Impact Step Jack','Version sans saut du jumping jack pour monter progressivement la température.','1. Fais un pas latéral avec une jambe.\n2. Monte les bras confortablement.\n3. Reviens au centre puis alterne.','Pas de saut ; garde une intensité facile.','conditioning','Débutant',1,'Conditioning','Conditioning','Full Body','Conditioning','none',2,2,1,1,1,'Aerobic','Alternating','Standing',1,8,array['Warm-up'],true,'Warm-up only — pulse raiser sans saut.','reps_unilateral',null,array['reps'],false,true,'pulse_raiser',2,true),
('EX444','Arm Circles','Mobilité active simple des épaules sans charge.','1. Tends les bras sur les côtés.\n2. Dessine de petits cercles contrôlés.\n3. Change de sens après quelques répétitions.','Commence petit puis augmente légèrement l’amplitude.','mobility','Débutant',1,'Mobility','Mobility','Upper','Mobility','none',1,1,1,1,3,'Mixed','Bilateral','Standing',1,9,array['Warm-up'],true,'Warm-up only — mobilité épaules.','reps_standard',null,array['reps'],false,true,'mobility',1,true)
on conflict (id) do update set
  name=excluded.name,description=excluded.description,instructions=excluded.instructions,tips=excluded.tips,
  exercise_type=excluded.exercise_type,difficulty=excluded.difficulty,technical_complexity=excluded.technical_complexity,
  movement_pattern=excluded.movement_pattern,exercise_family=excluded.exercise_family,body_region=excluded.body_region,
  training_focus=excluded.training_focus,equipment_requirement=excluded.equipment_requirement,
  fatigue_score=excluded.fatigue_score,cardio_score=excluded.cardio_score,joint_impact=excluded.joint_impact,
  stability_requirement=excluded.stability_requirement,mobility_requirement=excluded.mobility_requirement,
  energy_system=excluded.energy_system,movement_side=excluded.movement_side,starting_position=excluded.starting_position,
  transition_cost=excluded.transition_cost,selection_weight=excluded.selection_weight,usable_for=excluded.usable_for,
  home_friendly=excluded.home_friendly,notes=excluded.notes,prescription_type=excluded.prescription_type,
  tracking_modes=excluded.tracking_modes,tabata_eligible=excluded.tabata_eligible,
  warmup_eligible=excluded.warmup_eligible,warmup_role=excluded.warmup_role,
  warmup_intensity=excluded.warmup_intensity,warmup_only=excluded.warmup_only;

insert into public.exercise_equipment (exercise_id,equipment_id)
values ('EX432','E05'),('EX438','E05')
on conflict do nothing;

insert into public.exercise_equipment_requirements_v2
  (exercise_id,option_group,equipment_id,min_quantity,is_optional,notes)
values
  ('EX432',1,'E05',1,false,'Élastique léger pour activation latérale.'),
  ('EX438',1,'E05',1,false,'Élastique très léger pour rotation externe.')
on conflict do nothing;

insert into public.exercise_muscles (exercise_id,muscle_id,priority) values
('EX421','M09','primary'),('EX421','M15','secondary'),
('EX422','M08','primary'),('EX422','M15','secondary'),
('EX423','M08','primary'),('EX423','M07','secondary'),('EX423','M15','secondary'),
('EX424','M14','primary'),('EX424','M06','secondary'),('EX424','M15','secondary'),
('EX425','M07','primary'),('EX425','M09','secondary'),('EX425','M15','secondary'),
('EX426','M08','primary'),('EX426','M14','secondary'),('EX426','M15','secondary'),
('EX427','M06','primary'),('EX427','M08','secondary'),('EX427','M07','secondary'),('EX427','M15','secondary'),
('EX428','M08','primary'),('EX428','M06','secondary'),('EX428','M15','secondary'),
('EX429','M07','primary'),('EX429','M08','secondary'),('EX429','M12','secondary'),
('EX430','M08','primary'),('EX430','M07','secondary'),('EX430','M10','secondary'),
('EX431','M08','primary'),('EX431','M11','secondary'),
('EX432','M08','primary'),('EX432','M06','secondary'),
('EX433','M10','primary'),('EX433','M14','secondary'),
('EX434','M10','primary'),('EX434','M08','secondary'),('EX434','M03','secondary'),
('EX435','M13','primary'),('EX435','M11','secondary'),('EX435','M15','secondary'),
('EX436','M03','primary'),('EX436','M13','secondary'),
('EX437','M13','primary'),('EX437','M03','secondary'),('EX437','M15','secondary'),
('EX438','M03','primary'),('EX438','M13','secondary'),
('EX439','M03','primary'),('EX439','M01','secondary'),('EX439','M05','secondary'),
('EX440','M13','primary'),('EX440','M03','secondary'),
('EX441','M03','primary'),('EX441','M13','secondary'),
('EX442','M16','primary'),('EX442','M06','secondary'),('EX442','M14','secondary'),
('EX443','M16','primary'),('EX443','M06','secondary'),('EX443','M03','secondary'),
('EX444','M03','primary'),('EX444','M15','secondary')
on conflict do nothing;

insert into public.exercise_body_zones (exercise_id,body_zone_id,involvement,source,notes) values
('EX421','ankle_foot','primary','reviewed',null),('EX421','calf_shin','secondary','reviewed',null),
('EX422','hip_glute_groin','primary','reviewed',null),
('EX423','hip_glute_groin','primary','reviewed',null),('EX423','hamstring','secondary','reviewed',null),
('EX424','hip_glute_groin','primary','reviewed',null),('EX424','quadriceps','secondary','reviewed',null),
('EX425','hamstring','primary','reviewed',null),('EX425','calf_shin','secondary','reviewed',null),
('EX426','hip_glute_groin','primary','reviewed',null),
('EX427','knee','primary','reviewed',null),('EX427','hip_glute_groin','secondary','reviewed',null),('EX427','ankle_foot','secondary','reviewed',null),('EX427','quadriceps','secondary','reviewed',null),
('EX428','knee','primary','reviewed',null),('EX428','hip_glute_groin','secondary','reviewed',null),('EX428','ankle_foot','secondary','reviewed',null),('EX428','quadriceps','secondary','reviewed',null),
('EX429','lower_back','secondary','reviewed','Le hinge implique la zone lombaire même sans charge.'),('EX429','hamstring','primary','reviewed',null),('EX429','hip_glute_groin','secondary','reviewed',null),
('EX430','hip_glute_groin','primary','reviewed',null),('EX430','hamstring','secondary','reviewed',null),('EX430','lower_back','secondary','reviewed',null),
('EX431','hip_glute_groin','primary','reviewed',null),
('EX432','hip_glute_groin','primary','reviewed',null),('EX432','knee','secondary','reviewed',null),
('EX433','core_abdomen','primary','reviewed',null),('EX433','lower_back','secondary','reviewed',null),
('EX434','core_abdomen','primary','reviewed',null),('EX434','shoulder','secondary','reviewed',null),('EX434','forearm_wrist_hand','secondary','reviewed',null),('EX434','hip_glute_groin','secondary','reviewed',null),
('EX435','upper_back_neck','primary','reviewed',null),('EX435','shoulder','secondary','reviewed',null),
('EX436','shoulder','primary','reviewed',null),('EX436','upper_back_neck','secondary','reviewed',null),('EX436','arm_elbow','secondary','reviewed',null),
('EX437','shoulder','primary','reviewed',null),('EX437','upper_back_neck','secondary','reviewed',null),
('EX438','shoulder','primary','reviewed',null),('EX438','arm_elbow','secondary','reviewed',null),('EX438','forearm_wrist_hand','secondary','reviewed',null),
('EX439','shoulder','primary','reviewed',null),('EX439','arm_elbow','secondary','reviewed',null),('EX439','forearm_wrist_hand','secondary','reviewed',null),
('EX440','shoulder','primary','reviewed',null),('EX440','upper_back_neck','secondary','reviewed',null),
('EX441','shoulder','primary','reviewed',null),('EX441','upper_back_neck','secondary','reviewed',null),
('EX442','knee','secondary','reviewed',null),('EX442','ankle_foot','secondary','reviewed',null),('EX442','hip_glute_groin','secondary','reviewed',null),('EX442','calf_shin','secondary','reviewed',null),
('EX443','knee','secondary','reviewed',null),('EX443','ankle_foot','secondary','reviewed',null),('EX443','shoulder','secondary','reviewed',null),
('EX444','shoulder','primary','reviewed',null)
on conflict do nothing;

insert into public.exercise_tags (exercise_id,tag)
select id,'warmup_only' from public.exercises where warmup_only
on conflict do nothing;
insert into public.exercise_tags (exercise_id,tag)
select id,'warmup_role:'||warmup_role from public.exercises where warmup_eligible and warmup_role is not null
on conflict do nothing;

insert into public.exercise_constraints
  (exercise_id,constraint_name,reason,priority,body_zone,rule_type,severity)
select ebz.exercise_id,'auto_hard_gate_wrist',
       'Zone poignet/main impliquée : exclure si gêne ou douleur déclarée au poignet.',
       'critical','wrist','avoid',3
from public.exercise_body_zones ebz
where ebz.body_zone_id='forearm_wrist_hand'
  and not exists (select 1 from public.exercise_constraints c where c.exercise_id=ebz.exercise_id and c.constraint_name='auto_hard_gate_wrist');

insert into public.exercise_constraints
  (exercise_id,constraint_name,reason,priority,body_zone,rule_type,severity)
select ebz.exercise_id,'auto_hard_gate_elbow',
       'Zone bras/coude impliquée : exclure si gêne ou douleur déclarée au coude.',
       'critical','elbow','avoid',3
from public.exercise_body_zones ebz
where ebz.body_zone_id='arm_elbow'
  and not exists (select 1 from public.exercise_constraints c where c.exercise_id=ebz.exercise_id and c.constraint_name='auto_hard_gate_elbow');

insert into public.exercise_constraints
  (exercise_id,constraint_name,reason,priority,body_zone,rule_type,severity)
select ebz.exercise_id,'auto_hard_gate_shoulder',
       'Zone épaule impliquée : exclure si gêne ou douleur déclarée à l’épaule.',
       'critical','shoulder','avoid',3
from public.exercise_body_zones ebz
where ebz.body_zone_id='shoulder'
  and not exists (select 1 from public.exercise_constraints c where c.exercise_id=ebz.exercise_id and c.constraint_name='auto_hard_gate_shoulder');

insert into public.exercise_constraints
  (exercise_id,constraint_name,reason,priority,body_zone,rule_type,severity)
select ebz.exercise_id,'auto_hard_gate_knee',
       'Zone genou impliquée : exclure si gêne ou douleur déclarée au genou.',
       'critical','knee','avoid',3
from public.exercise_body_zones ebz
where ebz.body_zone_id='knee'
  and not exists (select 1 from public.exercise_constraints c where c.exercise_id=ebz.exercise_id and c.constraint_name='auto_hard_gate_knee');

insert into public.exercise_constraints
  (exercise_id,constraint_name,reason,priority,body_zone,rule_type,severity)
select ebz.exercise_id,'auto_hard_gate_lower_back',
       'Zone lombaire impliquée : exclure si gêne ou douleur déclarée au bas du dos.',
       'critical','lower_back','avoid',3
from public.exercise_body_zones ebz
where ebz.body_zone_id='lower_back'
  and not exists (select 1 from public.exercise_constraints c where c.exercise_id=ebz.exercise_id and c.constraint_name='auto_hard_gate_lower_back');

create or replace function public.sync_exercise_warmup_contract()
returns trigger
language plpgsql
as $$
begin
  if new.warmup_only then
    new.warmup_eligible := true;
  end if;
  if new.warmup_eligible then
    if new.warmup_role is null or new.warmup_intensity is null then
      raise exception 'warmup_eligible requires warmup_role and warmup_intensity for exercise %', new.id;
    end if;
    if not ('Warm-up' = any(coalesce(new.usable_for,'{}'::text[]))) then
      new.usable_for := array_append(coalesce(new.usable_for,'{}'::text[]),'Warm-up');
    end if;
    if new.warmup_only then
      new.usable_for := array['Warm-up'];
    end if;
  else
    new.usable_for := array_remove(coalesce(new.usable_for,'{}'::text[]),'Warm-up');
    new.warmup_role := null;
    new.warmup_intensity := null;
    new.warmup_only := false;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sync_exercise_warmup_contract on public.exercises;
create trigger trg_sync_exercise_warmup_contract
before insert or update of warmup_eligible,warmup_role,warmup_intensity,warmup_only,usable_for
on public.exercises
for each row execute function public.sync_exercise_warmup_contract();

comment on column public.exercises.warmup_eligible is 'True only for low-fatigue exercises suitable for warm-up selection.';
comment on column public.exercises.warmup_role is 'Coach warm-up role: mobility, activation, movement_prep, pulse_raiser.';
comment on column public.exercises.warmup_intensity is 'Warm-up intensity 1-3; V1 catalogue intentionally stays at 1-2.';
comment on column public.exercises.warmup_only is 'If true, the exercise is dedicated exclusively to Warm-up.';;
