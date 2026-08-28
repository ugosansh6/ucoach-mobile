-- Mobility-first Unlock catalogue additions.
-- These movements are preparation-only, low-fatigue and do not create capability evidence.

insert into public.exercises(
  id,name,display_name,description,instructions,tips,exercise_type,difficulty,technical_complexity,
  movement_pattern,exercise_family,body_region,training_focus,equipment_requirement,
  fatigue_score,cardio_score,joint_impact,stability_requirement,mobility_requirement,energy_system,
  movement_side,starting_position,transition_cost,selection_weight,usable_for,home_friendly,
  prescription_type,tracking_modes,tabata_eligible,warmup_eligible,warmup_role,warmup_intensity,
  warmup_only,wod_role
)
values
('EXW031','Cossack Mobility Shift','Cossack Squat mobilité','Déplacement latéral contrôlé en position de Cossack pour mobiliser hanches, adducteurs, genoux et chevilles.','Écarte les pieds, transfère lentement le bassin d’un côté puis de l’autre en gardant le pied d’appui stable. Reste dans une amplitude confortable.','Contrôle le mouvement, genou dans l’axe du pied, sans chercher la profondeur maximale.','mobility','Débutant',2,'Lunge','Lunge','Lower','Mobility','none',2,1,1,2,4,'Mixed','Alternating','Standing',1,8,array['Warm-up']::text[],true,'reps_unilateral',array['reps']::text[],false,true,'mobility',1,true,'prep_only'),
('EXW032','Straddle Rock and Reach','Straddle dynamique','Mobilité dynamique des adducteurs, ischios et hanches en position jambes écartées.','Place-toi jambes écartées, fléchis légèrement les genoux puis déplace le bassin et le buste de façon contrôlée vers l’avant et les côtés.','Garde le dos long et évite les rebonds forcés en fin d’amplitude.','mobility','Débutant',1,'Mobility','Mobility','Lower','Mobility','none',1,1,1,2,4,'Mixed','Unilateral','Standing',1,9,array['Warm-up']::text[],true,'reps_unilateral',array['reps']::text[],false,true,'mobility',1,true,'prep_only'),
('EXW033','Body Bounces','Body Bounces','Petits relâchements dynamiques du corps entier pour remettre les articulations en mouvement sans montée d’intensité.','Debout, relâche les bras et réalise de petits rebonds souples en laissant chevilles, genoux, hanches et épaules accompagner le mouvement.','Amplitude courte et relâchée ; ce n’est pas un exercice pliométrique.','mobility','Débutant',1,'Mobility','Mobility','Full Body','Mobility','optional',1,1,1,1,4,'Aerobic','Bilateral','Standing',1,7,array['Warm-up']::text[],true,'reps_standard',array['reps']::text[],false,true,'mobility',1,true,'prep_only'),
('EXW034','Cervical CARs','Neck Circle contrôlé','Mobilité cervicale contrôlée pour remettre le cou en mouvement sans forcer les amplitudes.','Réalise lentement des rotations contrôlées du cou dans une amplitude confortable, sans lancer la tête ni chercher la fin d’amplitude.','Mouvement lent et indolore ; réduis l’amplitude si nécessaire.','mobility','Débutant',2,'Mobility','Mobility','Upper','Mobility','none',1,1,1,2,3,'Aerobic','Bilateral','Standing',1,8,array['Warm-up']::text[],true,'reps_unilateral',array['reps']::text[],false,true,'mobility',1,true,'prep_only'),
('EXW035','Arm Swimmers','Arm Swim','Cercles alternés des bras pour mobiliser les épaules et les omoplates.','Debout, réalise de grands cercles contrôlés avec les bras, alternativement vers l’avant puis vers l’arrière.','Garde les côtes contrôlées et fais venir le mouvement de l’épaule plutôt que du bas du dos.','mobility','Débutant',2,'Mobility','Mobility','Upper','Mobility','none',1,1,1,2,3,'Aerobic','Alternating','Standing',1,8,array['Warm-up']::text[],true,'reps_unilateral',array['reps']::text[],false,true,'mobility',1,true,'prep_only'),
('EXW036','Standing Full Body Twist','Full Twist','Rotation contrôlée du tronc et du bassin pour mobiliser la colonne thoracique et les hanches.','Debout, tourne doucement le buste d’un côté puis de l’autre en laissant le bassin accompagner légèrement le mouvement.','Reste fluide, sans à-coup ni recherche d’amplitude forcée.','mobility','Débutant',1,'Mobility','Mobility','Full Body','Mobility','none',1,1,1,1,4,'Mixed','Unilateral','Standing',1,9,array['Warm-up']::text[],true,'reps_unilateral',array['reps']::text[],false,true,'mobility',1,true,'prep_only'),
('EXW037','Knee CARs','Cercles de genoux','Mobilité contrôlée du genou en faible charge.','Debout avec un appui stable si besoin, réalise de petits cercles contrôlés du genou sans douleur.','Amplitude courte ; le genou reste aligné et le mouvement ne doit pas provoquer de gêne.','mobility','Débutant',1,'Mobility','Mobility','Lower','Mobility','none',1,1,1,1,4,'Mixed','Unilateral','Standing',1,10,array['Warm-up']::text[],true,'reps_unilateral',array['reps']::text[],false,true,'mobility',1,true,'prep_only'),
('EXW038','Elbow CARs','Cercles de coudes','Flexion, extension et rotations contrôlées des avant-bras pour préparer les coudes.','Bras relâchés, fléchis et tends les coudes puis ajoute de petites rotations contrôlées des avant-bras.','Reste lent et sans verrouillage agressif en extension.','mobility','Débutant',1,'Mobility','Mobility','Upper','Mobility','none',1,1,1,1,2,'Mixed','Bilateral','Standing',1,8,array['Warm-up']::text[],true,'reps_standard',array['reps']::text[],false,true,'mobility',1,true,'prep_only'),
('EXW039','Pelvic Circles','Cercles de bassin','Cercles de bassin contrôlés pour mobiliser hanches, bassin et bas du dos.','Debout, pieds stables, dessine lentement des cercles avec le bassin dans les deux sens.','Garde les épaules relativement stables et choisis une amplitude confortable.','mobility','Débutant',2,'Mobility','Mobility','Lower','Mobility','none',1,1,1,3,4,'Mixed','Bilateral','Standing',1,8,array['Warm-up']::text[],true,'reps_unilateral',array['reps']::text[],false,true,'mobility',1,true,'prep_only'),
('EXW040','Deep Squat Reach','Deep Squat Reach','Squat profond contrôlé avec ouverture thoracique pour mobiliser chevilles, genoux, hanches et colonne thoracique.','Descends en squat confortable, garde les pieds ancrés puis tends alternativement un bras vers le haut avant de remonter.','Réduis la profondeur si les talons se décollent ou si une articulation gêne.','mobility','Débutant',1,'Mobility','Mobility','Full Body','Mobility','none',1,1,1,2,4,'Aerobic','Bilateral','Standing',1,7,array['Warm-up']::text[],true,'reps_standard',array['reps']::text[],false,true,'mobility',1,true,'prep_only')
on conflict (id) do update set
  name=excluded.name,
  display_name=excluded.display_name,
  description=excluded.description,
  instructions=excluded.instructions,
  tips=excluded.tips,
  exercise_type=excluded.exercise_type,
  difficulty=excluded.difficulty,
  technical_complexity=excluded.technical_complexity,
  movement_pattern=excluded.movement_pattern,
  exercise_family=excluded.exercise_family,
  body_region=excluded.body_region,
  training_focus=excluded.training_focus,
  equipment_requirement=excluded.equipment_requirement,
  fatigue_score=excluded.fatigue_score,
  cardio_score=excluded.cardio_score,
  joint_impact=excluded.joint_impact,
  stability_requirement=excluded.stability_requirement,
  mobility_requirement=excluded.mobility_requirement,
  energy_system=excluded.energy_system,
  movement_side=excluded.movement_side,
  starting_position=excluded.starting_position,
  transition_cost=excluded.transition_cost,
  selection_weight=excluded.selection_weight,
  usable_for=excluded.usable_for,
  home_friendly=excluded.home_friendly,
  prescription_type=excluded.prescription_type,
  tracking_modes=excluded.tracking_modes,
  tabata_eligible=excluded.tabata_eligible,
  warmup_eligible=excluded.warmup_eligible,
  warmup_role=excluded.warmup_role,
  warmup_intensity=excluded.warmup_intensity,
  warmup_only=excluded.warmup_only,
  wod_role=excluded.wod_role;

insert into public.exercise_tags(exercise_id,tag)
values
('EXW031','adductor'),('EXW031','ankle'),('EXW031','hip'),('EXW031','knee'),('EXW031','unlock'),
('EXW032','adductor'),('EXW032','hamstring'),('EXW032','hip'),('EXW032','unlock'),
('EXW033','full_body_mobility'),('EXW033','unlock'),
('EXW034','cervical'),('EXW034','neck'),('EXW034','unlock'),
('EXW035','scapula'),('EXW035','shoulder'),('EXW035','unlock'),
('EXW036','thoracic_spine'),('EXW036','trunk_rotation'),('EXW036','unlock'),
('EXW037','knee'),('EXW037','unlock'),
('EXW038','elbow'),('EXW038','unlock'),
('EXW039','hip'),('EXW039','pelvis'),('EXW039','unlock'),
('EXW040','ankle'),('EXW040','hip'),('EXW040','knee'),('EXW040','thoracic_spine'),('EXW040','unlock')
on conflict do nothing;
