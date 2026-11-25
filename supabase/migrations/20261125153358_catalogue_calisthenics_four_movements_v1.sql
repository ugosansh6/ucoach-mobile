-- #49: four distinct catalogue identities. No changes to existing exercise rows or engine.
INSERT INTO public.equipment(id,name,category,description) VALUES
('E50','Échelle suspendue / Monkey Bars','Gym','Échelle horizontale fixe en hauteur, avec plusieurs barreaux successifs et une zone de réception dégagée.'),
('E51','Serviette de suspension','Accessoire','Serviette robuste, sèche et sans déchirure, utilisée en prise autour d’une barre fixe.'),
('E52','Ancrage haut pour élastique','Support','Point fixe en hauteur, stable et conçu pour supporter la tension d’un élastique.');
INSERT INTO public.equipment_locations(equipment_id,location_key,display_order) VALUES
('E50','OUTDOOR',100),('E50','GYM_BOX',100),('E50','GARAGE',100),
('E51','HOME',100),('E51','OUTDOOR',100),('E51','GARAGE',100),('E51','GYM_BOX',100),
('E52','HOME',100),('E52','OUTDOOR',100),('E52','GARAGE',100),('E52','GYM_BOX',100);

INSERT INTO public.exercises(id,name,display_name,description,instructions,tips,exercise_type,difficulty,technical_complexity,movement_pattern,exercise_family,body_region,training_focus,equipment_requirement,fatigue_score,cardio_score,joint_impact,stability_requirement,mobility_requirement,energy_system,movement_side,starting_position,transition_cost,selection_weight,usable_for,home_friendly,notes,prescription_type,tracking_modes,tabata_eligible,warmup_eligible,warmup_only,wod_role) VALUES
('EX582','Band Lat Pulldown','Tirage vertical à l’élastique',
'Tirage vertical avec un élastique fixé en hauteur pour renforcer le grand dorsal et les muscles du tirage, sans avoir à soulever le poids du corps.',
'1. Fixe l’élastique à un ancrage haut adapté et vérifie sa fixation. Place-toi debout ou à genoux, bras tendus vers le haut.\n2. Tire les coudes vers les côtes en gardant le buste stable et les épaules basses.\n3. Remonte les bras lentement en contrôlant le retour de l’élastique.',
'Choisis une résistance qui permet de garder le tronc stable. Ne relâche pas brutalement l’élastique et ne tire pas derrière la nuque.',
'strength','Débutant',1,'Pull Vertical','Pull','Upper','Strength','required',2,1,1,2,2,'Mixed','Bilateral','Standing',1,6,ARRAY['STRENGTH','Skill','WOD'],true,'Ancrage haut sécurisé obligatoire. Résistance élastique, pas assistance.','reps_standard',ARRAY['reps'],false,false,false,'wod'),
('EX583','Monkey Bars','Monkey Bars – traversée suspendue',
'Déplacement de barreau en barreau sur une échelle horizontale en suspension, pour développer la force de préhension, la stabilité des épaules et la coordination.',
'1. Saisis le premier barreau à deux mains, bras tendus, avec un espace de réception dégagé.\n2. Engage légèrement les épaules, avance une main vers le barreau suivant puis transfère ton poids avant de déplacer l’autre main.\n3. Progresse à un rythme maîtrisé, puis redescends en sécurité avant de perdre ta prise.',
'Commence sur une échelle basse avec les pieds proches du sol. Évite les grands balancements et arrête avant de perdre la prise.',
'skill','Intermédiaire',3,'Pull Vertical','Pull','Upper','Strength','required',4,3,2,4,3,'Mixed','Alternating','Suspended',2,1,ARRAY['Skill','STRENGTH'],false,'Unité sportive : progression en barreaux ou traversées, à distinguer. Le suivi natif actuel est en répétitions; ne pas assimiler une traversée à une répétition ou une distance. Hors WOD en attendant la validation du protocole.','reps_standard',ARRAY['reps'],false,false,false,'prep_only'),
('EX584','Towel Hang','Towel Hang – suspension à la serviette',
'Maintien en suspension en agrippant les deux extrémités d’une serviette passée autour d’une barre fixe, pour solliciter particulièrement les muscles de la prise.',
'1. Passe une serviette robuste sur une barre stable et saisis une extrémité dans chaque main. Vérifie la prise avant de décoller les pieds.\n2. Suspends-toi bras tendus, épaules stables et tronc légèrement engagé. Garde les pieds en appui si nécessaire pour alléger la charge.\n3. Maintiens la position en respirant puis repose les pieds de façon contrôlée.',
'Ne va pas jusqu’au lâcher de la prise. Utilise une serviette non glissante et en bon état. Réduis la durée ou conserve un appui des pieds si nécessaire.',
'skill','Intermédiaire',2,'Pull Vertical','Pull','Upper','Strength','required',4,1,2,3,2,'Mixed','Bilateral','Suspended',2,4,ARRAY['Skill','STRENGTH'],true,'Maintien chronométré; assistance par appui des pieds possible sans changer le nom du mouvement.','isometric',ARRAY['time'],false,false,false,'adaptation'),
('EX585','Dead Hang','Dead Hang – suspension à la barre',
'Maintien en suspension bras tendus à une barre fixe, qui développe l’endurance de préhension et la tolérance à la suspension.',
'1. Saisis une barre fixe en pronation, les mains environ à la largeur des épaules.\n2. Décolle les pieds progressivement et garde les coudes tendus, sans forcer une amplitude d’épaule inconfortable.\n3. Respire pendant le maintien, sans balancer le corps, puis repose les pieds avant de perdre ta prise.',
'Commence par des maintiens courts ou garde les pieds en appui. Ne force pas une suspension passive si elle provoque une gêne aux épaules.',
'skill','Débutant',1,'Pull Vertical','Pull','Upper','Strength','required',3,1,2,2,2,'Mixed','Bilateral','Suspended',1,5,ARRAY['Skill','STRENGTH'],true,'Maintien chronométré. Distinct du maintien en haut de traction et des tractions scapulaires.','isometric',ARRAY['time'],false,false,false,'adaptation');

INSERT INTO public.exercise_equipment_requirements_v2(exercise_id,option_group,equipment_id,min_quantity,is_optional,notes) VALUES
('EX582',1,'E05',1,false,'Élastique de résistance'),('EX582',1,'E52',1,false,'Ancrage haut sécurisé'),
('EX583',1,'E50',1,false,'Échelle horizontale obligatoire, pas une simple barre'),
('EX584',1,'E07',1,false,'Barre fixe'),('EX584',1,'E51',1,false,'Serviette robuste'),
('EX585',1,'E07',1,false,'Barre fixe');
INSERT INTO public.exercise_equipment(exercise_id,equipment_id) SELECT exercise_id,equipment_id FROM public.exercise_equipment_requirements_v2 WHERE exercise_id IN ('EX582','EX583','EX584','EX585');
INSERT INTO public.exercise_band_resistance_profiles(exercise_id,semantics) VALUES('EX582','resistance');
INSERT INTO public.exercise_muscles(exercise_id,muscle_id,priority) VALUES
('EX582','M02','primary'),('EX582','M04','secondary'),('EX582','M13','secondary'),
('EX583','M02','primary'),('EX583','M13','secondary'),('EX583','M04','secondary'),('EX583','M10','secondary'),
('EX584','M02','secondary'),('EX584','M13','secondary'),
('EX585','M02','secondary'),('EX585','M13','secondary');
-- The current muscle dictionary has no forearm flexors entry. Capture the
-- principal grip demand in the existing body-zone taxonomy instead.
INSERT INTO public.exercise_body_zones(exercise_id,body_zone_id,involvement,source,notes)
SELECT e.id,z.zone,CASE WHEN z.zone='forearm_wrist_hand' AND e.id<>'EX582' THEN 'primary' WHEN z.zone='upper_back_neck' AND e.id IN ('EX582','EX583') THEN 'primary' WHEN z.zone='arm_elbow' THEN 'secondary' ELSE 'support' END,'manual',CASE WHEN z.zone='forearm_wrist_hand' THEN 'Préhension; fléchisseurs des doigts et du poignet.' ELSE NULL END
FROM (VALUES('EX582'),('EX583'),('EX584'),('EX585')) e(id)
CROSS JOIN (VALUES('forearm_wrist_hand'),('upper_back_neck'),('arm_elbow'),('shoulder')) z(zone);
INSERT INTO public.exercise_constraints(exercise_id,constraint_name,reason,priority,body_zone,rule_type,severity)
SELECT e.id,c.constraint_name,c.reason,c.priority,c.body_zone,c.rule_type,c.severity
FROM (VALUES('EX582'),('EX583'),('EX584'),('EX585')) e(id)
CROSS JOIN public.exercise_constraints c WHERE c.exercise_id='EX412' AND c.body_zone IN ('wrist','elbow','shoulder');
INSERT INTO public.exercise_environment_compatibility(exercise_id,environment_code,compatibility,reason_code,source)
SELECT e.id,env.code,'CONDITIONAL','EQUIPMENT_REQUIRED','CATALOG_POLICY' FROM (VALUES('EX582'),('EX583'),('EX584'),('EX585')) e(id) CROSS JOIN (VALUES('GYM'),('OUTDOOR')) env(code);
INSERT INTO public.outdoor_street_exercise_catalog_v1(exercise_id,street_role,canonical_identity_preserved,notes,active) VALUES
('EX582','PULL',true,'Élastique et ancrage haut sécurisé requis.',true),
('EX583','LOCOMOTION',true,'Échelle suspendue requise; validation des unités barreaux/traversées distincte.',false),
('EX584','PULL',true,'Barre et serviette requises.',true),
('EX585','PULL',true,'Barre fixe requise.',true);
INSERT INTO public.exercise_tags(exercise_id,tag) VALUES
('EX582','band'),('EX582','Pull Vertical'),('EX582','Strength'),('EX582','Upper'),
('EX583','grip'),('EX583','street_workout'),('EX583','Upper'),('EX583','locomotion'),
('EX584','grip'),('EX584','isometric'),('EX584','Upper'),('EX584','street_workout'),
('EX585','grip'),('EX585','isometric'),('EX585','Upper'),('EX585','street_workout');
