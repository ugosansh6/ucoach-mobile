SET session_replication_role = replica;

--
-- PostgreSQL database dump
--

-- \restrict OQ5jVmvIeY6LX3UjVAvhteT8XYEXYNm9808WB0g6x913t9eaWiiKPdQGAvkKCGC

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Data for Name: block_rules; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."block_rules" ("id", "block_key", "format", "duration_minutes", "min_exercises", "max_exercises", "preferred_exercises", "rounds", "work_seconds", "rest_seconds", "rotation_mode", "active", "notes", "created_at") VALUES
	(1, 'warmup', NULL, NULL, 2, 4, 3, NULL, NULL, NULL, NULL, true, 'Échauffement dynamique. Le moteur adapte la durée au WOD et au niveau.', '2026-08-07 15:33:48.70852+00'),
	(2, 'tabata', 'TABATA', 4, 1, 2, 2, 8, 20, 10, 'alternate', true, 'Tabata abdos strict: 4 minutes. Jamais 3 exercices. Préférence 2 exercices alternés.', '2026-08-07 15:33:48.70852+00'),
	(3, 'tabata', 'TABATA', 8, 1, 4, 2, 16, 20, 10, 'alternate', true, 'Tabata abdos strict: 8 minutes. Nombre autorisé: 1, 2 ou 4. Jamais 3.', '2026-08-07 15:33:48.70852+00'),
	(4, 'skill', NULL, NULL, 1, 3, 1, NULL, NULL, NULL, NULL, true, 'Bloc technique ou de renforcement ciblé.', '2026-08-07 15:33:48.70852+00'),
	(5, 'wod', 'AMRAP', NULL, 2, 5, 3, NULL, NULL, NULL, NULL, true, 'Limiter la variété pour préserver le rythme et la lisibilité.', '2026-08-07 15:33:48.70852+00'),
	(6, 'wod', 'EMOM', NULL, 2, 5, 3, NULL, NULL, NULL, NULL, true, 'Le nombre de stations doit rester compatible avec les minutes du cycle.', '2026-08-07 15:33:48.70852+00'),
	(7, 'wod', 'FOR_TIME', NULL, 3, 7, 4, NULL, NULL, NULL, NULL, true, 'Le nombre dépend du nombre de rounds et de la durée disponible.', '2026-08-07 15:33:48.70852+00'),
	(8, 'wod', 'CIRCUIT', NULL, 4, 10, 6, NULL, NULL, NULL, NULL, true, 'Le circuit est le format autorisant le plus grand nombre de mouvements.', '2026-08-07 15:33:48.70852+00'),
	(9, 'wod', 'STRENGTH', NULL, 3, 6, 4, NULL, NULL, NULL, NULL, true, 'Musculation classique, sans obligation de chronomètre.', '2026-08-07 15:33:48.70852+00');


--
-- Data for Name: equipment; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."equipment" ("id", "name", "category", "description") VALUES
	('E00', 'Aucun', 'Bodyweight', 'Aucun matériel, au poids du corps'),
	('E01', 'Tapis', 'Accessoire', 'Tapis de sol pour le confort'),
	('E02', 'Corde à sauter', 'Cardio', 'Corde à sauter basique ou lourde'),
	('E03', 'Haltères', 'Poids libre', 'Paire d''haltères (Dumbbells)'),
	('E04', 'Kettlebell', 'Poids libre', 'Poids avec poignée (Kettlebell)'),
	('E05', 'Élastiques', 'Résistance', 'Bandes de résistance (Resistance Bands)'),
	('E06', 'TRX', 'Suspension', 'Sangles de suspension type TRX'),
	('E07', 'Barre de traction', 'Gym', 'Barre fixe pour suspensions et tirages'),
	('E08', 'Banc', 'Support', 'Banc plat ou inclinable'),
	('E09', 'Medball', 'Poids libre', 'Ballon lesté (Medicine Ball / Wall Ball)'),
	('E10', 'Box', 'Plyométrie', 'Caisse de saut (Plyo Box)'),
	('E11', 'Step', 'Support', 'Marche de fitness (Step)'),
	('E12', 'Foam roller', 'Récupération', 'Rouleau de massage et mobilité');


--
-- Data for Name: equipment_profiles; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."equipment_profiles" ("id", "profile_name", "available_equipment", "description") OVERRIDING SYSTEM VALUE VALUES
	(1, 'Bodyweight Only', '{Aucun,Tapis}', 'Entraînement 100% sans matériel, idéal voyage.'),
	(2, 'Minimal Equipment', '{Aucun,Tapis,"Corde à sauter",Élastiques,Haltères}', 'Base légère pour la maison.'),
	(3, 'Home Gym', '{Aucun,Tapis,"Corde à sauter",Haltères,Kettlebell,Box,"Barre de traction",TRX}', 'Installation intermédiaire avec points d''ancrage.'),
	(4, 'Garage Gym', '{Aucun,Tapis,"Corde à sauter",Haltères,Kettlebell,Élastiques,TRX,"Barre de traction",Banc,Medball,Box,Step,"Foam roller"}', 'Matériel complet type Box de CrossFit.');


--
-- Data for Name: exercises; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."exercises" ("id", "name", "description", "instructions", "tips", "exercise_type", "difficulty", "technical_complexity", "movement_pattern", "exercise_family", "body_region", "training_focus", "equipment_requirement", "fatigue_score", "cardio_score", "joint_impact", "stability_requirement", "mobility_requirement", "energy_system", "movement_side", "starting_position", "transition_cost", "selection_weight", "usable_for", "home_friendly", "notes", "created_at", "prescription_type", "image_path", "tracking_modes", "tabata_eligible") VALUES
	('EX030', 'Air Squat box', 'Variante de squat au poids du corps avec une box comme repère de profondeur. Elle aide à apprendre le recul des hanches et à contrôler la descente.', '1. Place-toi devant une box, pieds légèrement plus larges que le bassin.
2. Recule les hanches et fléchis les genoux jusqu’à effleurer ou t’asseoir brièvement sur la box.
3. Pousse dans le sol pour revenir debout sans perdre la position du tronc.', 'Recule les hanches vers la box sans t’y laisser tomber. Garde les genoux dans l’axe des orteils et tout le pied en contact avec le sol.', 'strength', 'Débutant', 1, 'Squat', 'Squat', 'Lower', 'Strength', 'required', 2, 2, 1, 2, 4, 'ATP-PC', 'Bilateral', 'Standing', 3, 10, '{Warm-up,WOD}', false, 'Exercice de base.', '2026-08-05 14:38:35.107694+00', 'reps_standard', NULL, '{reps}', false),
	('EX033', 'Air Squat classique', 'Squat au poids du corps pour développer la force des jambes, la coordination hanches-genoux-chevilles et la maîtrise d’une position accroupie.', '1. Place les pieds autour de la largeur d’épaules, pointes légèrement ouvertes.
2. Fléchis hanches et genoux en gardant la poitrine ouverte et le pied entier au sol.
3. Remonte en poussant dans le sol jusqu’à l’extension complète.', 'Garde le pied entier au sol et les genoux orientés dans la même direction que les orteils. Descends seulement aussi bas que tu peux rester stable.', 'strength', 'Débutant', 1, 'Squat', 'Squat', 'Lower', 'Strength', 'none', 3, 3, 1, 2, 4, 'ATP-PC', 'Bilateral', 'Standing', 1, 10, '{Warm-up,WOD}', true, 'Exercice de base.', '2026-08-05 14:38:35.107694+00', 'reps_standard', NULL, '{reps}', false),
	('EX138', 'Band Overhead Press', 'Poussée verticale avec élastique pour renforcer épaules et triceps avec une résistance progressive.', '1. Place l’élastique sous les pieds et tiens les extrémités au niveau des épaules.
2. Presse les mains au-dessus de la tête jusqu’à tendre les bras.
3. Redescends lentement au niveau des épaules.', 'Garde les côtes basses et évite de cambrer pour terminer la répétition. Termine bras tendus au-dessus de la tête.', 'general', 'Débutant', 1, 'Push Vertical', 'Push', 'Upper', 'Conditioning', 'required', 3, 2, 1, 1, 5, 'Glycolytic', 'Bilateral', 'Standing', 2, 7, '{Warm-up,WOD}', false, 'Exercice de base.', '2026-08-05 14:38:35.107694+00', 'reps_standard', NULL, '{reps}', false),
	('EX141', 'Band Pallof Press', 'Exercice anti-rotation avec élastique : tu éloignes les mains du buste tout en résistant à la traction latérale.', '1. Place-toi de côté par rapport à l’ancrage, mains contre le sternum.
2. Tends les bras devant toi sans laisser le tronc pivoter.
3. Ramène les mains avec contrôle puis répète avant de changer de côté.', 'Le bassin et les épaules restent face devant. Si tu tournes, rapproche-toi du point d’ancrage ou réduis la tension.', 'stability', 'Débutant', 2, 'Anti-Rotation', 'Core', 'Core', 'Stability', 'required', 2, 2, 1, 4, 1, 'Mixed', 'Bilateral', 'Standing', 2, 7, '{Warm-up,Core,WOD}', false, 'Exercice de base.', '2026-08-05 14:38:35.107694+00', 'reps_standard', NULL, '{reps}', true),
	('EX135', 'Band Pull-Apart', 'Ouverture horizontale avec élastique pour solliciter le haut du dos et les muscles qui stabilisent les omoplates.', '1. Tiens l’élastique devant toi, bras tendus à hauteur de poitrine.
2. Écarte les mains jusqu’à ouvrir les bras sur les côtés.
3. Reviens lentement sans relâcher complètement la tension.', 'Ne hausse pas les épaules. Écarte l’élastique en rapprochant les omoplates plutôt qu’en cambrant le dos.', 'mobility', 'Débutant', 1, 'Pull Horizontal', 'Pull', 'Upper', 'Mobility', 'required', 1, 1, 1, 1, 3, 'Aerobic', 'Bilateral', 'Standing', 2, 7, '{Warm-up}', false, 'Exercice de base.', '2026-08-05 14:38:35.107694+00', 'reps_standard', NULL, '{reps}', false),
	('EX308', 'DB Bench Press', 'Allongé sur un banc, descends les haltères près de la poitrine puis pousse jusqu’à l’extension.', '1. Allonge-toi sur le banc, pieds ancrés au sol et haltères au-dessus de la poitrine.
2. Descends les charges de chaque côté du buste avec les avant-bras stables.
3. Pousse jusqu’à l’extension des bras sans décoller les épaules du banc.', 'Garde les pieds ancrés et les épaules stables sur le banc.', 'strength', 'Intermédiaire', 3, 'Push Horizontal', 'Push', 'Upper', 'Strength', 'required', 3, 1, 2, 2, 2, 'Phosphagen', 'Bilateral', NULL, 2, 80, '{Skill,WOD}', false, NULL, '2026-08-07 15:33:48.70852+00', 'reps_heavy', NULL, '{reps,load}', false),
	('EX152', 'Box Jump', 'Saut vertical sur box pour développer puissance des jambes, coordination et capacité à absorber un atterrissage.', '1. Place-toi face à la box à une courte distance.
2. Fléchis légèrement hanches et genoux puis saute sur la box.
3. Atterris avec les deux pieds stables, redresse-toi puis redescends en contrôle.', 'Choisis une hauteur qui permet d’atterrir stable, avec les genoux dans l’axe. Redescends de la box en marchant si nécessaire.', 'general', 'Avancé', 3, 'Jump', 'Jump', 'Full Body', 'Power', 'required', 5, 4, 4, 1, 1, 'ATP-PC', 'Bilateral', 'Standing', 3, 8, '{Skill,WOD}', false, 'Exercice de base.', '2026-08-05 14:38:35.107694+00', 'metabolic_high', NULL, '{reps}', false),
	('EX309', 'DB Deadlift', 'Depuis le sol, pousse dans les pieds et étends les hanches pour te relever avec les haltères.', '1. Place les haltères au sol près des pieds et recule les hanches pour les saisir.
2. Pousse dans le sol et étends les hanches en gardant les charges proches des jambes.
3. Termine debout puis redescends les haltères avec le même contrôle.', 'Garde le dos neutre et les charges proches des jambes.', 'strength', 'Débutant', 2, 'Hinge', 'Posterior Chain', 'Lower', 'Strength', 'required', 3, 2, 2, 3, 2, 'Mixed', 'Bilateral', NULL, 2, 90, '{Warm-up,Skill,WOD}', true, NULL, '2026-08-07 15:33:48.70852+00', 'reps_standard', NULL, '{reps,load}', false),
	('EX155', 'Broad Jump (Saut en longueur)', 'Saut horizontal à deux pieds pour développer l’explosivité et la capacité à absorber un déplacement vers l’avant.', '1. Place-toi debout, pieds autour de la largeur du bassin.
2. Charge les hanches puis projette-toi vers l’avant avec les bras.
3. Atterris sur les deux pieds et stabilise la position avant la répétition suivante.', 'Atterris silencieusement sur les deux pieds, genoux souples. Privilégie une réception stable à une distance maximale.', 'general', 'Intermédiaire', 3, 'Jump', 'Jump', 'Full Body', 'Power', 'none', 4, 4, 4, 1, 1, 'ATP-PC', 'Bilateral', 'Standing', 1, 7, '{Skill,WOD}', true, 'Exercice de base.', '2026-08-05 14:38:35.107694+00', 'metabolic_high', NULL, '{reps}', false),
	('EX146', 'Burpee classique', 'Burpee complet combinant passage au sol, retour debout et saut. Il sollicite tout le corps et fait rapidement monter l’intensité.', '1. Pose les mains au sol et envoie les pieds vers l’arrière.
2. Amène la poitrine au sol selon le standard choisi.
3. Ramène les pieds vers les mains, redresse-toi et termine par un saut avec extension.', 'Reste fluide : pose la poitrine au sol sans transformer chaque répétition en pompe stricte, puis ramène les pieds près des mains.', 'conditioning', 'Avancé', 3, 'Conditioning', 'Conditioning', 'Full Body', 'Conditioning', 'none', 5, 5, 3, 1, 1, 'Glycolytic', 'Bilateral', 'Standing', 1, 10, '{WOD}', true, 'Exercice de base.', '2026-08-05 14:38:35.107694+00', 'metabolic_high', NULL, '{reps}', false),
	('EX147', 'Burpee Target', 'Burpee terminé par un saut vers une cible afin d’imposer une hauteur d’extension constante à chaque répétition.', '1. Effectue la descente d’un burpee jusqu’au sol.
2. Ramène les pieds près des mains et relève-toi.
3. Saute verticalement pour toucher la cible puis enchaîne.', 'Garde une cible réaliste et touche-la avec une extension complète plutôt qu’avec un saut désorganisé.', 'conditioning', 'Avancé', 3, 'Conditioning', 'Conditioning', 'Full Body', 'Conditioning', 'none', 5, 5, 4, 1, 1, 'Glycolytic', 'Bilateral', 'Standing', 1, 10, '{WOD}', true, 'Exercice de base.', '2026-08-05 14:38:35.107694+00', 'metabolic_high', NULL, '{reps}', false),
	('EX158', 'Cat Cow', 'Mobilisation douce de la colonne à quatre appuis en alternant arrondi et extension contrôlée du dos.', '1. Place-toi à quatre appuis.
2. Expire en arrondissant progressivement le dos et en rentrant le bassin.
3. Inspire en revenant vers une légère extension contrôlée.', 'Fais circuler le mouvement sur toute la colonne sans forcer l’amplitude cervicale ou lombaire.', 'mobility', 'Débutant', 1, 'Mobility', 'Mobility', 'Full Body', 'Mobility', 'optional', 1, 1, 1, 1, 4, 'Aerobic', 'Bilateral', 'Quadruped', 1, 7, '{Warm-up}', true, 'Exercice de base.', '2026-08-05 14:38:35.107694+00', 'reps_standard', NULL, '{reps}', false),
	('EX310', 'KB Deadlift', 'Soulève la kettlebell depuis le sol en poussant les hanches vers l’arrière puis en les étendant.', '1. Place la kettlebell entre les pieds et recule les hanches pour saisir la poignée.
2. Pousse dans le sol et étends les hanches jusqu’à te tenir debout.
3. Replace la kettlebell au sol en reculant les hanches sans arrondir le dos.', 'Apprends le hinge avant d’accélérer vers un swing.', 'strength', 'Débutant', 2, 'Hinge', 'Posterior Chain', 'Lower', 'Strength', 'required', 3, 2, 2, 3, 2, 'Mixed', 'Bilateral', NULL, 2, 90, '{Warm-up,Skill,WOD}', true, NULL, '2026-08-07 15:33:48.70852+00', 'reps_standard', NULL, '{reps,load}', false),
	('EX161', 'Couch Stretch', 'Étirement du quadriceps et des fléchisseurs de hanche réalisé en position de fente avec le pied arrière sur un support ou contre un mur.', '1. Place un genou au sol près d’un mur ou d’une box et le pied arrière relevé.
2. Avance l’autre pied en position de fente.
3. Redresse progressivement le buste et maintiens une tension confortable.', 'Commence loin du support puis rapproche-toi progressivement. Garde le bassin légèrement rétroversé plutôt que de cambrer.', 'mobility', 'Débutant', 2, 'Mobility', 'Mobility', 'Full Body', 'Mobility', 'required', 2, 1, 1, 1, 4, 'Aerobic', 'Bilateral', 'Standing', 2, 7, '{Warm-up}', false, 'Exercice de base.', '2026-08-05 14:38:35.107694+00', 'reps_standard', NULL, '{reps}', false),
	('EX129', 'DB Devil Press', 'Devil Press avec haltères : burpee sur les poignées suivi d’un mouvement explosif qui amène les haltères au-dessus de la tête.', '1. Pose les haltères au sol et effectue la phase basse du burpee.
2. Ramène les pieds puis redresse les haltères avec une extension puissante des hanches.
3. Termine les deux charges au-dessus de la tête avant de redescendre.', 'Garde les haltères proches du corps pendant la remontée et utilise les hanches pour accélérer la charge.', 'conditioning', 'Avancé', 4, 'Conditioning', 'Conditioning', 'Full Body', 'Conditioning', 'required', 5, 5, 4, 1, 1, 'Glycolytic', 'Bilateral', 'Standing', 2, 5, '{WOD}', false, 'Exercice de base.', '2026-08-05 14:38:35.107694+00', 'reps_standard', NULL, '{reps,load}', false),
	('EX126', 'DB Hang Clean', 'Clean depuis la position suspendue avec haltères : extension des hanches puis réception des charges aux épaules.', '1. Tiens les haltères devant les cuisses et pousse légèrement les hanches vers l’arrière.
2. Étends rapidement les hanches et accompagne les charges vers le haut.
3. Reçois les haltères aux épaules avec les genoux souples puis redresse-toi.', 'Les bras guident les haltères après l’extension des hanches ; évite de les tirer uniquement avec les biceps.', 'general', 'Intermédiaire', 3, 'Jump', 'Jump', 'Full Body', 'Power', 'required', 4, 4, 3, 1, 1, 'ATP-PC', 'Bilateral', 'Standing', 2, 7, '{Skill,WOD}', false, 'Exercice de base.', '2026-08-05 14:38:35.107694+00', 'reps_heavy', NULL, '{reps,load}', false),
	('EX125', 'DB Hang Snatch', 'Snatch depuis la position suspendue avec haltère : extension explosive des hanches pour amener la charge directement au-dessus de la tête.', '1. Tiens l’haltère entre les jambes ou devant la cuisse en position de hang.
2. Étends puissamment les hanches puis guide la charge vers le haut.
3. Verrouille le bras au-dessus de la tête avant de redescendre et de changer de côté.', 'Garde l’haltère proche du corps et termine avec un bras stable au-dessus de l’épaule.', 'skill', 'Avancé', 4, 'Jump', 'Jump', 'Full Body', 'Power', 'required', 5, 4, 3, 1, 5, 'ATP-PC', 'Bilateral', 'Standing', 2, 7, '{Skill,WOD}', false, 'Exercice de base.', '2026-08-05 14:38:35.107694+00', 'reps_heavy', NULL, '{reps,load}', false),
	('EX121', 'DB Push Press', 'Poussée verticale avec haltères utilisant une légère flexion-extension des jambes pour donner de l’élan aux charges.', '1. Place les haltères aux épaules.
2. Fléchis légèrement les genoux puis étends rapidement jambes et hanches.
3. Termine en pressant les haltères au-dessus de la tête, bras tendus.', 'Le dip reste court et vertical. Transmets la force des jambes aux haltères sans transformer le mouvement en squat.', 'strength', 'Intermédiaire', 3, 'Push Vertical', 'Push', 'Upper', 'Strength', 'required', 4, 4, 3, 1, 1, 'ATP-PC', 'Bilateral', 'Standing', 2, 7, '{Skill,WOD}', false, 'Exercice de base.', '2026-08-05 14:38:35.107694+00', 'reps_standard', NULL, '{reps,load}', false),
	('EX115', 'DB RDL (Soulevé de terre jambes tendues)', 'Hinge avec haltères ciblant surtout ischio-jambiers et fessiers grâce à une descente contrôlée des charges le long des jambes.', '1. Tiens les haltères devant les cuisses, genoux légèrement fléchis.
2. Recule les hanches en gardant le dos neutre et les charges proches des jambes.
3. Pousse les hanches vers l’avant pour revenir debout.', 'Garde les haltères proches des cuisses et pousse les hanches loin derrière. Arrête la descente avant que le dos ne s’arrondisse.', 'strength', 'Intermédiaire', 3, 'Hinge', 'Hinge', 'Lower', 'Strength', 'required', 4, 3, 2, 1, 1, 'ATP-PC', 'Bilateral', 'Standing', 2, 7, '{Warm-up,WOD}', false, 'Exercice de base.', '2026-08-05 14:38:35.107694+00', 'reps_standard', NULL, '{reps,load}', false),
	('EX131', 'DB Row (Tirage Bûcheron)', 'Tirage unilatéral avec haltère, généralement avec une main ou un genou en appui, pour renforcer le dos et le bras.', '1. Prends un appui stable et laisse le bras chargé descendre sous l’épaule.
2. Tire l’haltère vers les côtes en rapprochant l’omoplate.
3. Redescends complètement avec contrôle puis change de côté.', 'Tire le coude vers la hanche sans tourner le buste. Garde l’épaule loin de l’oreille.', 'strength', 'Intermédiaire', 2, 'Pull Horizontal', 'Pull', 'Upper', 'Strength', 'required', 4, 3, 2, 1, 3, 'ATP-PC', 'Bilateral', 'Standing', 2, 7, '{WOD}', false, 'Exercice de base.', '2026-08-05 14:38:35.107694+00', 'reps_standard', NULL, '{reps,load}', false),
	('EX118', 'DB Strict Press', 'Poussée verticale stricte avec haltères, sans aide des jambes, pour développer épaules et triceps.', '1. Place les haltères aux épaules, jambes tendues.
2. Presse les charges au-dessus de la tête sans impulsion des jambes.
3. Redescends lentement aux épaules.', 'Serre les fessiers et garde les côtes basses afin d’éviter de compenser avec le bas du dos.', 'strength', 'Intermédiaire', 2, 'Push Vertical', 'Push', 'Upper', 'Strength', 'required', 4, 2, 2, 1, 1, 'ATP-PC', 'Bilateral', 'Standing', 2, 7, '{Skill,WOD}', false, 'Exercice de base.', '2026-08-05 14:38:35.107694+00', 'reps_standard', NULL, '{reps,load}', false),
	('EX130', 'DB Thruster', 'Thruster avec haltères combinant un front squat et une poussée au-dessus de la tête en un mouvement continu.', '1. Place les haltères aux épaules et descends en squat.
2. Remonte puissamment en étendant hanches et genoux.
3. Enchaîne directement avec la poussée au-dessus de la tête puis redescends les charges.', 'Accélère en sortant du squat et utilise cette extension pour lancer les haltères vers le haut.', 'conditioning', 'Avancé', 3, 'Conditioning', 'Conditioning', 'Full Body', 'Conditioning', 'required', 5, 5, 3, 1, 1, 'Glycolytic', 'Bilateral', 'Standing', 2, 8, '{Skill,WOD}', false, 'Exercice de base.', '2026-08-05 14:38:35.107694+00', 'reps_standard', NULL, '{reps,load}', false),
	('EX164', 'Deep Squat Hold', 'Maintien en squat profond utilisé pour travailler confort, mobilité des hanches et des chevilles et contrôle de la position basse.', '1. Descends dans un squat aussi profond que confortable.
2. Garde le pied entier au sol et le tronc aussi stable que possible.
3. Maintiens la position en respirant calmement.', 'Garde les talons au sol. Utilise un support devant toi si tu perds l’équilibre ou si la profondeur force la posture.', 'mobility', 'Débutant', 1, 'Mobility', 'Mobility', 'Full Body', 'Mobility', 'none', 1, 1, 1, 2, 4, 'Aerobic', 'Bilateral', 'Standing', 1, 7, '{Warm-up}', true, 'Exercice de base.', '2026-08-05 14:38:35.107694+00', 'isometric', NULL, '{time}', false),
	('EX157', 'Double Under', 'Saut à la corde où celle-ci passe deux fois sous les pieds pendant un seul saut.', '1. Commence par des sauts verticaux réguliers avec les mains près des hanches.
2. Accélère les poignets pendant un saut légèrement plus haut.
3. Fais passer la corde deux fois sous les pieds avant l’atterrissage.', 'Reste haut et relâché : la vitesse vient surtout des poignets. Évite de plier fortement les genoux à chaque saut.', 'conditioning', 'Avancé', 5, 'Conditioning', 'Conditioning', 'Full Body', 'Conditioning', 'required', 5, 5, 3, 1, 1, 'Glycolytic', 'Bilateral', 'Standing', 2, 7, '{Skill,WOD}', false, 'Exercice de base.', '2026-08-05 14:38:35.107694+00', 'reps_standard', NULL, '{reps}', false),
	('EX159', 'Downward Dog (Chien tête en bas)', 'Position de mobilité en V inversé qui associe flexion des hanches, ouverture des épaules et mise en tension progressive de l’arrière des jambes.', '1. Pars à quatre appuis ou en planche haute.
2. Pousse les hanches vers le haut et l’arrière.
3. Presse les mains dans le sol et allonge la colonne en respirant.', 'Allonge le dos avant de chercher à poser les talons. Plie légèrement les genoux si nécessaire.', 'mobility', 'Débutant', 1, 'Mobility', 'Mobility', 'Full Body', 'Mobility', 'optional', 1, 1, 1, 1, 4, 'Aerobic', 'Bilateral', 'Standing', 1, 7, '{Warm-up}', true, 'Exercice de base.', '2026-08-05 14:38:35.107694+00', 'reps_standard', NULL, '{reps}', false),
	('EX051', 'Fente arrière alternée', 'Fente arrière alternée : chaque répétition commence par un pas vers l’arrière, ce qui permet de charger une jambe à la fois avec un bon contrôle.', '1. Depuis la position debout, recule un pied.
2. Descends le genou arrière vers le sol en gardant le buste stable.
3. Pousse dans le pied avant pour revenir puis alterne.', 'Garde le pied avant entièrement au sol et pousse à travers celui-ci pour revenir debout.', 'strength', 'Débutant', 2, 'Lunge', 'Lunge', 'Lower', 'Strength', 'none', 3, 3, 2, 3, 1, 'ATP-PC', 'Alternating', 'Standing', 1, 7, '{Warm-up,WOD}', true, 'Exercice de base.', '2026-08-05 14:38:35.107694+00', 'reps_unilateral', NULL, '{reps}', false),
	('EX054', 'Fente avant alternée', 'Fente avant alternée pour renforcer les jambes et contrôler la décélération à chaque pas.', '1. Avance un pied et pose-le entièrement au sol.
2. Descends jusqu’à approcher le genou arrière du sol.
3. Repousse avec la jambe avant pour revenir puis alterne.', 'Fais un pas assez long pour garder le talon avant au sol et éviter que le genou ne s’effondre vers l’intérieur.', 'strength', 'Débutant', 2, 'Lunge', 'Lunge', 'Lower', 'Strength', 'none', 3, 3, 3, 3, 1, 'ATP-PC', 'Alternating', 'Standing', 1, 7, '{Warm-up,WOD}', true, 'Exercice de base.', '2026-08-05 14:38:35.107694+00', 'reps_unilateral', NULL, '{reps}', false),
	('EX057', 'Fente bulgare', 'Fente bulgare avec le pied arrière surélevé pour augmenter le travail unilatéral de la jambe avant.', '1. Place le pied arrière sur un banc ou une box et avance l’autre pied.
2. Descends le genou arrière vers le sol en contrôlant.
3. Pousse dans le pied avant pour revenir en haut.', 'Choisis une distance qui te permet de descendre verticalement sans perdre l’équilibre. Le pied avant reste bien ancré.', 'strength', 'Intermédiaire', 3, 'Lunge', 'Lunge', 'Lower', 'Strength', 'required', 4, 3, 2, 3, 1, 'ATP-PC', 'Unilateral', 'Standing', 2, 7, '{Skill,WOD}', false, 'Exercice de base.', '2026-08-05 14:38:35.107694+00', 'reps_unilateral', NULL, '{reps}', false),
	('EX061', 'Fente marchée DB', 'Fente marchée avec haltères : enchaînement de pas en fente avec une charge tenue le long du corps ou en position choisie.', '1. Tiens les haltères et fais un grand pas vers l’avant.
2. Descends le genou arrière vers le sol.
3. Pousse sur la jambe avant pour avancer directement dans la répétition suivante.', 'Garde les charges stables et le buste haut. Chaque pas doit finir par une position équilibrée.', 'strength', 'Intermédiaire', 2, 'Lunge', 'Lunge', 'Lower', 'Strength', 'required', 4, 4, 3, 3, 1, 'ATP-PC', 'Alternating', 'Standing', 2, 7, '{WOD}', false, 'Exercice de base.', '2026-08-05 14:38:35.107694+00', 'reps_unilateral', NULL, '{reps,load}', false),
	('EX048', 'Fente statique', 'Fente statique réalisée sans déplacer les pieds, pour renforcer les jambes et travailler la stabilité dans une position asymétrique.', '1. Place un pied devant l’autre en position de fente.
2. Descends le genou arrière vers le sol sans bouger les pieds.
3. Remonte en poussant dans le pied avant.', 'Répartis la pression sur tout le pied avant et descends verticalement plutôt que d’avancer le genou.', 'strength', 'Débutant', 1, 'Lunge', 'Lunge', 'Lower', 'Strength', 'none', 2, 2, 1, 3, 1, 'ATP-PC', 'Bilateral', 'Standing', 1, 7, '{Warm-up,WOD}', true, 'Exercice de base.', '2026-08-05 14:38:35.107694+00', 'reps_unilateral', NULL, '{reps}', false),
	('EX040', 'Front Squat KB', 'Front squat avec kettlebell tenue en position rack devant le corps, sollicitant jambes, tronc et contrôle de la posture.', '1. Place la kettlebell en rack au niveau de l’épaule ou du sternum selon la variante.
2. Descends en squat en gardant le pied entier au sol.
3. Remonte jusqu’à l’extension complète des hanches et genoux.', 'Garde la kettlebell proche du corps et les coudes organisés. Ne laisse pas la charge tirer le buste vers l’avant.', 'strength', 'Intermédiaire', 3, 'Squat', 'Squat', 'Lower', 'Strength', 'required', 4, 3, 2, 2, 4, 'ATP-PC', 'Bilateral', 'Standing', 2, 7, '{Warm-up,WOD}', false, 'Exercice de base.', '2026-08-05 14:38:35.107694+00', 'reps_standard', NULL, '{reps,load}', false),
	('EX037', 'Goblet Squat DB', 'Goblet squat avec haltère tenu devant la poitrine pour renforcer les jambes tout en favorisant un buste stable.', '1. Tiens un haltère verticalement contre la poitrine.
2. Descends en squat avec les genoux dans l’axe des pieds.
3. Pousse dans le sol pour revenir debout.', 'Tiens l’haltère près du sternum et garde les coudes à l’intérieur des genoux sans t’effondrer vers l’avant.', 'strength', 'Intermédiaire', 2, 'Squat', 'Squat', 'Lower', 'Strength', 'required', 4, 3, 2, 2, 4, 'ATP-PC', 'Bilateral', 'Standing', 2, 8, '{Warm-up,WOD}', false, 'Exercice de base.', '2026-08-05 14:38:35.107694+00', 'reps_standard', NULL, '{reps,load}', false),
	('EX112', 'Good Morning Band', 'Good morning avec élastique : hinge contrôlé pour renforcer la chaîne postérieure et apprendre à reculer les hanches.', '1. Place l’élastique de façon à créer une résistance sur le haut du corps.
2. Recule les hanches en inclinant le buste avec le dos neutre.
3. Contracte les fessiers pour revenir debout.', 'Garde les genoux légèrement fléchis et le dos neutre. Le mouvement vient des hanches, pas d’une flexion de la colonne.', 'general', 'Débutant', 2, 'Hinge', 'Hinge', 'Lower', 'Conditioning', 'required', 3, 2, 1, 1, 1, 'Glycolytic', 'Bilateral', 'Standing', 2, 7, '{Warm-up,WOD}', false, 'Exercice de base.', '2026-08-05 14:38:35.107694+00', 'reps_standard', NULL, '{reps}', false),
	('EX201', 'Handstand Walk', 'Déplacement en appui renversé sur les mains, destiné aux pratiquants maîtrisant déjà le handstand et le contrôle des épaules.', '1. Monte en appui renversé dans un espace dégagé.
2. Transfère légèrement le poids d’une main à l’autre pour avancer.
3. Fais de petits pas de mains tout en gardant le tronc gainé.', 'Commence par de très courtes distances. Garde les bras actifs et évite de marcher si tu ne contrôles pas encore la sortie du handstand.', 'skill', 'Avancé', 5, 'Locomotion', 'Push', 'Upper', NULL, 'none', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '{Skill,WOD}', false, NULL, '2026-08-05 16:22:37.758664+00', 'distance', NULL, '{distance,time}', false),
	('EX150', 'High Knees (Montées de genoux)', 'Course sur place dynamique avec montée alternée des genoux pour augmenter rapidement la fréquence cardiaque.', '1. Commence à courir sur place.
2. Monte alternativement les genoux vers l’avant avec une cadence rapide.
3. Utilise les bras comme lors d’une course normale.', 'Reste léger sur les appuis et garde le buste grand. La cadence compte plus que de chercher une hauteur excessive.', 'conditioning', 'Débutant', 1, 'Conditioning', 'Conditioning', 'Full Body', 'Conditioning', 'none', 3, 4, 3, 1, 1, 'Glycolytic', 'Bilateral', 'Tall Kneeling', 1, 7, '{Warm-up,WOD}', true, 'Exercice de base.', '2026-08-05 14:38:35.107694+00', 'reps_standard', NULL, '{reps}', false),
	('EX107', 'Hip Thrust DB', 'Hip thrust chargé avec haltère, réalisé avec le haut du dos sur un support pour renforcer les fessiers sur une grande amplitude d’extension de hanche.', '1. Place le haut du dos sur un banc et l’haltère sur le bassin.
2. Descends les hanches avec contrôle.
3. Pousse dans les talons pour remonter jusqu’à contracter fortement les fessiers.', 'Garde le menton légèrement rentré et termine avec le bassin, sans hyperextension lombaire.', 'strength', 'Débutant', 2, 'Hinge', 'Hinge', 'Lower', 'Strength', 'required', 3, 2, 1, 1, 1, 'ATP-PC', 'Bilateral', 'Standing', 2, 7, '{Warm-up,WOD}', false, 'Exercice de base.', '2026-08-05 14:38:35.107694+00', 'reps_standard', NULL, '{reps,load}', false),
	('EX089', 'Hollow Rocks', 'Balancement contrôlé en position hollow : le corps oscille comme un bloc sans perdre la forme creuse du tronc.', '1. Prends une position hollow solide au sol.
2. Bascule doucement vers les épaules puis vers les hanches.
3. Maintiens la même forme du corps pendant toute l’oscillation.', 'Le balancement vient du changement d’appui du corps, pas d’un mouvement des bras ou des jambes.', 'stability', 'Avancé', 4, 'Anti-Extension', 'Core', 'Core', 'Stability', 'optional', 4, 3, 2, 4, 2, 'Mixed', 'Bilateral', 'Supine', 1, 7, '{Core,Skill,WOD}', true, 'Exercice de base.', '2026-08-05 14:38:35.107694+00', 'isometric', NULL, '{time}', false),
	('EX148', 'Jumping Jack', 'Jumping jack : saut rythmé où les pieds s’écartent pendant que les bras montent, puis reviennent ensemble.', '1. Pars debout, pieds joints et bras le long du corps.
2. Saute en écartant les pieds tout en montant les bras.
3. Saute de nouveau pour revenir à la position initiale.', 'Reste léger sur les appuis et garde une cadence régulière. Réduis l’amplitude des bras si les épaules sont raides.', 'conditioning', 'Débutant', 1, 'Conditioning', 'Conditioning', 'Full Body', 'Conditioning', 'none', 2, 3, 2, 1, 1, 'Glycolytic', 'Bilateral', 'Standing', 1, 7, '{Warm-up,WOD}', true, 'Exercice de base.', '2026-08-05 14:38:35.107694+00', 'metabolic_high', NULL, '{reps}', false),
	('EX122', 'KB Arnold Press', 'Développé Arnold avec kettlebell combinant rotation du bras et poussée verticale au-dessus de la tête.', '1. Tiens la kettlebell en rack devant l’épaule.
2. Fais pivoter le bras en pressant la charge vers le haut.
3. Redescends en inversant le mouvement jusqu’à la position de départ.', 'Contrôle la rotation et garde le poignet aligné avec l’avant-bras. Évite de cambrer pour finir la répétition.', 'strength', 'Intermédiaire', 3, 'Push Vertical', 'Push', 'Upper', 'Strength', 'required', 4, 3, 2, 1, 1, 'ATP-PC', 'Bilateral', 'Standing', 2, 7, '{Skill,WOD}', false, 'Exercice de base.', '2026-08-05 14:38:35.107694+00', 'reps_standard', NULL, '{reps,load}', false),
	('EX128', 'KB Clean', 'Clean avec kettlebell : extension des hanches pour amener la charge du swing vers une position rack stable.', '1. Place la kettlebell devant toi et initie un hinge.
2. Étends les hanches pour accélérer la charge.
3. Ramène le coude près du corps et reçois la kettlebell en rack.', 'Guide la kettlebell autour de la main plutôt que de la laisser frapper l’avant-bras.', 'skill', 'Avancé', 4, 'Jump', 'Jump', 'Full Body', 'Power', 'required', 5, 4, 3, 1, 1, 'ATP-PC', 'Bilateral', 'Standing', 2, 7, '{Skill,WOD}', false, 'Exercice de base.', '2026-08-05 14:38:35.107694+00', 'reps_heavy', NULL, '{reps,load}', false),
	('EX127', 'KB Snatch', 'Snatch avec kettlebell : mouvement balistique qui amène la charge du swing à une position verrouillée au-dessus de la tête.', '1. Initie le mouvement comme un swing entre les jambes.
2. Étends puissamment les hanches et guide la kettlebell vers le haut.
3. Passe la main autour de la poignée et verrouille le bras au-dessus de la tête.', 'Fais tourner la main autour de la poignée en haut pour éviter que la kettlebell ne frappe l’avant-bras.', 'skill', 'Avancé', 5, 'Jump', 'Jump', 'Full Body', 'Power', 'required', 5, 5, 3, 1, 5, 'ATP-PC', 'Bilateral', 'Standing', 2, 7, '{Skill,WOD}', false, 'Exercice de base.', '2026-08-05 14:38:35.107694+00', 'reps_heavy', NULL, '{reps,load}', false),
	('EX149', 'Mountain Climber', 'Course en planche où les genoux reviennent alternativement vers le buste, combinant gainage et travail cardiovasculaire.', '1. Place-toi en planche haute.
2. Ramène un genou vers la poitrine puis replace le pied.
3. Alterne rapidement les jambes tout en gardant le tronc stable.', 'Garde les épaules au-dessus des mains et évite de laisser le bassin rebondir à chaque changement de jambe.', 'conditioning', 'Débutant', 2, 'Conditioning', 'Conditioning', 'Full Body', 'Conditioning', 'none', 3, 4, 2, 1, 1, 'Glycolytic', 'Bilateral', 'Plank', 1, 7, '{Warm-up,Core,WOD}', true, 'Exercice de base.', '2026-08-05 14:38:35.107694+00', 'metabolic_high', NULL, '{reps}', false),
	('EX080', 'Muscle-up transition', 'Travail technique de transition du tirage vers l’appui au-dessus de la barre ou des anneaux, spécifique au muscle-up.', '1. Utilise une assistance ou un support permettant de contrôler le mouvement.
2. Tire le buste vers l’appui puis fais passer les épaules au-dessus des mains.
3. Termine dans une position de dip stable avant de redescendre.', 'Travaille lentement et à une hauteur adaptée. Cherche à garder la charge près du corps pendant la transition.', 'skill', 'Avancé', 5, 'Pull Vertical', 'Pull', 'Upper', 'Conditioning', 'required', 5, 5, 4, 1, 3, 'Glycolytic', 'Bilateral', 'Suspended', 2, 7, '{Skill,WOD}', false, 'Exercice de base.', '2026-08-05 14:38:35.107694+00', 'reps_standard', NULL, '{reps}', false),
	('EX163', 'Pigeon Pose', 'Étirement des fessiers et rotateurs externes de hanche en position de pigeon, avec une jambe repliée devant le corps.', '1. Amène une jambe pliée devant toi et étends l’autre derrière.
2. Place le bassin aussi droit que possible.
3. Reste haut ou incline légèrement le buste tant que la position reste confortable.', 'Ne force pas le genou avant. Utilise un coussin ou choisis une variante sur le dos si la position est inconfortable.', 'mobility', 'Débutant', 1, 'Mobility', 'Mobility', 'Full Body', 'Mobility', 'optional', 1, 1, 1, 1, 4, 'Aerobic', 'Bilateral', 'Standing', 1, 7, '{Warm-up}', true, 'Exercice de base.', '2026-08-05 14:38:35.107694+00', 'reps_standard', NULL, '{reps}', false),
	('EX017', 'Pike Push-up genoux', 'Pike push-up avec les genoux en appui pour apprendre la poussée verticale avec une charge corporelle réduite.', '1. Place les genoux au sol et les mains devant toi, hanches élevées.
2. Fléchis les coudes pour amener la tête vers l’avant des mains.
3. Pousse dans le sol pour revenir bras tendus.', 'Dirige la tête vers l’espace entre les mains plutôt que droit vers le sol. Garde les hanches hautes.', 'strength', 'Débutant', 2, 'Push Vertical', 'Push', 'Upper', 'Strength', 'required', 3, 2, 2, 1, 1, 'ATP-PC', 'Bilateral', 'Tall Kneeling', 2, 7, '{Warm-up,Skill,WOD}', false, 'Exercice de base.', '2026-08-05 14:38:35.107694+00', 'reps_standard', NULL, '{reps}', false),
	('EX095', 'Planche', 'Planche frontale isométrique pour renforcer la capacité à maintenir bassin, côtes et épaules alignés.', '1. Place-toi sur les avant-bras ou les mains selon la variante.
2. Aligne épaules, bassin et chevilles.
3. Maintiens la position en respirant sans perdre l’alignement.', 'Serre les fessiers et les abdos ; évite de laisser le bassin tomber ou monter excessivement.', 'stability', 'Débutant', 1, 'Anti-Extension', 'Core', 'Core', 'Stability', 'optional', 2, 2, 1, 5, 1, 'Mixed', 'Bilateral', 'Plank', 1, 7, '{Warm-up,Core,WOD}', true, 'Exercice de base.', '2026-08-05 14:38:35.107694+00', 'reps_standard', NULL, '{reps}', true),
	('EX093', 'Planche genoux', 'Planche avec genoux au sol pour apprendre le gainage du tronc avec une charge corporelle réduite.', '1. Place les mains ou les avant-bras au sol et les genoux derrière toi.
2. Crée une ligne stable des épaules aux genoux.
3. Maintiens la position en gardant les abdos engagés.', 'Aligne épaules, bassin et genoux. Ne laisse pas les hanches partir en arrière.', 'stability', 'Débutant', 1, 'Anti-Extension', 'Core', 'Core', 'Stability', 'optional', 1, 1, 1, 5, 1, 'Mixed', 'Bilateral', 'Plank', 1, 7, '{Warm-up,Core,WOD}', true, 'Exercice de base.', '2026-08-05 14:38:35.107694+00', 'reps_standard', NULL, '{reps}', true),
	('EX006', 'Pompe genoux', 'Pompe avec les genoux au sol pour développer la force de poussée tout en réduisant la charge par rapport à une pompe classique.', '1. Place les mains sous ou légèrement plus larges que les épaules et les genoux au sol.
2. Fléchis les coudes pour descendre le buste en bloc.
3. Pousse dans le sol pour revenir bras tendus.', 'Garde une ligne des épaules aux genoux et descends la poitrine entre les mains, pas seulement la tête.', 'strength', 'Débutant', 1, 'Push Horizontal', 'Push', 'Upper', 'Strength', 'none', 3, 2, 1, 2, 2, 'ATP-PC', 'Bilateral', 'Plank', 1, 10, '{Warm-up,WOD}', true, 'Exercice de base.', '2026-08-05 14:38:35.107694+00', 'reps_standard', NULL, '{reps}', false),
	('EX003', 'Pompe inclinée', 'Pompe avec les mains sur un support surélevé, permettant de réduire la charge tout en conservant la mécanique d’une pompe complète.', '1. Place les mains sur un support stable et recule les pieds.
2. Descends la poitrine vers le support en gardant le corps gainé.
3. Pousse jusqu’à l’extension des bras.', 'Plus le support est haut, plus la variante est accessible. Garde le corps en ligne et les coudes contrôlés.', 'strength', 'Débutant', 1, 'Push Horizontal', 'Push', 'Upper', 'Strength', 'required', 3, 2, 1, 2, 2, 'ATP-PC', 'Bilateral', 'Plank', 2, 10, '{Warm-up,WOD}', false, 'Exercice de base.', '2026-08-05 14:38:35.107694+00', 'reps_standard', NULL, '{reps}', false),
	('EX001', 'Pompe mur', 'Pompe debout contre un mur, variante d’apprentissage très accessible pour travailler la poussée horizontale.', '1. Place les mains sur le mur à hauteur de poitrine.
2. Fléchis les coudes pour rapprocher le buste du mur.
3. Pousse dans le mur pour revenir à la position initiale.', 'Éloigne davantage les pieds du mur pour augmenter progressivement la difficulté tout en gardant le corps aligné.', 'strength', 'Débutant', 1, 'Push Horizontal', 'Push', 'Upper', 'Strength', 'none', 2, 1, 1, 2, 2, 'ATP-PC', 'Bilateral', 'Plank', 1, 10, '{Warm-up,WOD}', true, 'Exercice de base.', '2026-08-05 14:38:35.107694+00', 'reps_standard', NULL, '{reps}', false),
	('EX100', 'Russian Twist DB', 'Rotation du tronc en position assise avec haltère, sollicitant principalement les obliques et le contrôle du bassin.', '1. Assieds-toi, genoux fléchis, buste légèrement incliné.
2. Tiens l’haltère près du torse et tourne vers un côté.
3. Passe par le centre puis tourne de l’autre côté.', 'Tourne le buste avec contrôle plutôt que de déplacer uniquement les bras. Réduis la charge si le bas du dos se cambre.', 'stability', 'Intermédiaire', 2, 'Rotation', 'Core', 'Core', 'Stability', 'required', 3, 3, 1, 1, 1, 'Mixed', 'Bilateral', 'Floor', 2, 7, '{Core,WOD}', false, 'Exercice de base.', '2026-08-05 14:38:35.107694+00', 'reps_standard', NULL, '{reps,load}', true),
	('EX166', 'Scorpion Stretch', 'Mobilisation au sol où une jambe passe derrière le corps pour créer une rotation contrôlée du tronc et une ouverture de hanche.', '1. Allonge-toi sur le ventre ou en position adaptée à la variante.
2. Amène un pied vers le côté opposé derrière toi.
3. Reviens au centre avec contrôle puis change de côté.', 'Va seulement jusqu’à l’amplitude où le mouvement reste fluide. Évite de forcer le bas du dos.', 'mobility', 'Débutant', 2, 'Mobility', 'Mobility', 'Full Body', 'Mobility', 'optional', 2, 1, 1, 1, 4, 'Aerobic', 'Bilateral', 'Prone', 1, 7, '{Warm-up}', true, 'Exercice de base.', '2026-08-05 14:38:35.107694+00', 'reps_standard', NULL, '{reps}', false),
	('EX098', 'Side Plank', 'Planche latérale isométrique pour renforcer les obliques et la stabilité de l’épaule et du bassin.', '1. Place un avant-bras sous l’épaule et les jambes tendues ou fléchies selon le niveau.
2. Soulève le bassin pour aligner tête, tronc et jambes.
3. Maintiens la position puis change de côté.', 'Empile les épaules et garde les hanches hautes. Utilise le genou inférieur au sol si nécessaire.', 'stability', 'Débutant', 2, 'Anti-Rotation', 'Core', 'Core', 'Stability', 'optional', 2, 2, 1, 4, 1, 'Mixed', 'Unilateral', 'Standing', 1, 7, '{Warm-up,Core,WOD}', true, 'Exercice de base.', '2026-08-05 14:38:35.107694+00', 'isometric', NULL, '{time}', true),
	('EX_L02', 'Single Leg Romanian Deadlift (Au poids du corps)', 'Hinge unilatéral au poids du corps pour travailler équilibre, contrôle du bassin et chaîne postérieure.', '1. Tiens-toi sur une jambe, genou légèrement fléchi.
2. Recule les hanches et incline le buste en allongeant l’autre jambe derrière.
3. Contracte les fessiers pour revenir debout puis change de côté.', 'Garde les hanches face au sol et une légère flexion du genou d’appui. La jambe arrière s’allonge pendant que le buste s’incline.', 'general', 'Intermédiaire', 3, 'Hinge', 'Posterior Chain', 'Lower', NULL, 'none', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '{Warm-up,Skill}', false, NULL, '2026-08-05 16:39:29.71047+00', 'reps_unilateral', NULL, '{reps}', false),
	('EX156', 'Single Under (Corde à sauter)', 'Saut à la corde simple où la corde passe une fois sous les pieds à chaque saut.', '1. Tiens les poignées près des hanches et place la corde derrière toi.
2. Fais tourner la corde avec les poignets et réalise un petit saut vertical.
3. Maintiens une cadence régulière avec un passage de corde par saut.', 'Saute juste assez haut pour laisser passer la corde et fais-la tourner principalement avec les poignets.', 'conditioning', 'Débutant', 2, 'Conditioning', 'Conditioning', 'Full Body', 'Conditioning', 'required', 3, 3, 2, 1, 1, 'Glycolytic', 'Bilateral', 'Standing', 2, 7, '{Warm-up,WOD}', false, 'Exercice de base.', '2026-08-05 14:38:35.107694+00', 'reps_standard', NULL, '{reps}', false),
	('EX151', 'Skaters', 'Saut latéral d’une jambe à l’autre inspiré du patinage, pour travailler puissance latérale et stabilité.', '1. Pousse sur une jambe pour sauter latéralement.
2. Atterris sur l’autre jambe avec le genou légèrement fléchi.
3. Repars dans l’autre sens en gardant un rythme contrôlé.', 'Atterris avec le genou souple et stabilise la hanche avant de repartir, surtout si tu augmentes l’amplitude.', 'conditioning', 'Intermédiaire', 3, 'Locomotion', 'Locomotion', 'Full Body', 'Conditioning', 'none', 4, 4, 3, 1, 1, 'Glycolytic', 'Bilateral', 'Standing', 1, 7, '{Warm-up,WOD}', true, 'Exercice de base.', '2026-08-05 14:38:35.107694+00', 'distance', NULL, '{distance,time}', false),
	('EX144', 'Sprawl', 'Sprawl : déplacement rapide vers une position de planche ou proche du sol puis retour debout, sans obligation de pompe ni de saut.', '1. Pose les mains au sol et envoie les pieds vers l’arrière.
2. Stabilise brièvement la position basse selon le standard.
3. Ramène les pieds vers les mains et relève-toi.', 'Garde le mouvement simple et rapide. Ramène les pieds assez près des mains pour te relever sans arrondir excessivement le dos.', 'conditioning', 'Débutant', 2, 'Conditioning', 'Conditioning', 'Full Body', 'Conditioning', 'none', 3, 3, 2, 1, 1, 'Glycolytic', 'Bilateral', 'Plank', 1, 7, '{Warm-up,WOD}', true, 'Exercice de base.', '2026-08-05 14:38:35.107694+00', 'reps_standard', NULL, '{reps}', false),
	('EX_C03', 'Superman Hold (Arch)', 'Maintien en extension au sol où bras, poitrine et jambes se décollent légèrement pour solliciter la chaîne postérieure.', '1. Allonge-toi sur le ventre, bras allongés devant ou le long du corps.
2. Décolle légèrement poitrine, bras et jambes.
3. Maintiens la tension en respirant puis repose avec contrôle.', 'Cherche à t’allonger plutôt qu’à monter très haut. Si le bas du dos est comprimé, réduis immédiatement l’amplitude.', 'general', 'Débutant', 1, 'Core', 'Core', 'Core', NULL, 'none', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '{Warm-up,Core}', false, NULL, '2026-08-05 16:39:29.71047+00', 'isometric', NULL, '{time}', true),
	('EX065', 'Suspension active', 'Suspension active à la barre où les bras restent tendus pendant que les omoplates s’abaissent et se stabilisent.', '1. Suspends-toi à la barre, bras tendus.
2. Sans plier les coudes, abaisse les épaules et rapproche légèrement les omoplates.
3. Relâche vers la suspension passive puis répète.', 'Le mouvement est petit : ne plie pas les coudes et évite de hausser les épaules vers les oreilles.', 'general', 'Débutant', 2, 'Pull Vertical', 'Pull', 'Upper', 'Conditioning', 'required', 3, 1, 2, 1, 3, 'Glycolytic', 'Bilateral', 'Suspended', 2, 7, '{Warm-up,Skill}', false, 'Exercice de base.', '2026-08-05 14:38:35.107694+00', 'reps_standard', NULL, '{reps}', false),
	('EX162', 'Thread the Needle', 'Mobilisation thoracique à quatre appuis où un bras passe sous le corps puis s’ouvre vers le plafond.', '1. Place-toi à quatre appuis.
2. Glisse un bras sous le bras opposé en tournant le haut du dos.
3. Reviens puis ouvre ce bras vers le plafond avant de répéter.', 'Garde les hanches relativement stables pour que la rotation vienne surtout du haut du dos.', 'mobility', 'Débutant', 1, 'Mobility', 'Mobility', 'Full Body', 'Mobility', 'optional', 1, 1, 1, 1, 4, 'Aerobic', 'Bilateral', 'Standing', 1, 7, '{Warm-up}', true, 'Exercice de base.', '2026-08-05 14:38:35.107694+00', 'reps_standard', NULL, '{reps}', false),
	('EX313', 'Course', 'Cours à l’allure demandée sur la distance ou le temps prévu.', '1. Adopte une posture relâchée avec le regard devant toi et les bras proches du corps.
2. Cours à l’allure demandée sur la distance ou le temps prévu.
3. Maintiens une foulée régulière et adapte l’allure pour terminer le bloc proprement.', 'Adapte l’allure pour rester capable de tenir tout le bloc.', 'conditioning', 'Débutant', 1, 'Locomotion', 'Locomotion', 'Full Body', 'Conditioning', 'none', 4, 5, 2, 1, 1, 'Aerobic', 'Alternating', NULL, 1, 95, '{Warm-up,WOD}', true, NULL, '2026-08-07 15:33:48.70852+00', 'distance', NULL, '{distance,time}', false),
	('EX071', 'Traction classique', 'Traction en pronation où le corps est tiré depuis une suspension bras tendus jusqu’à amener le menton au-dessus de la barre.', '1. Suspends-toi à la barre en pronation.
2. Engage les omoplates et tire jusqu’à passer le menton au-dessus de la barre.
3. Redescends jusqu’aux bras tendus avec contrôle.', 'Commence par engager les omoplates puis tire les coudes vers le bas. Évite de donner un grand coup de jambes.', 'strength', 'Avancé', 3, 'Pull Vertical', 'Pull', 'Upper', 'Strength', 'required', 5, 4, 3, 1, 3, 'ATP-PC', 'Bilateral', 'Suspended', 2, 10, '{Skill,WOD}', false, 'Exercice de base.', '2026-08-05 14:38:35.107694+00', 'reps_standard', NULL, '{reps}', false),
	('EX067', 'Traction élastique', 'Traction assistée par élastique afin de réduire la charge corporelle tout en conservant la trajectoire d’une traction complète.', '1. Fixe l’élastique à la barre et place le pied ou le genou dedans.
2. Pars bras tendus puis tire le corps vers la barre.
3. Redescends lentement jusqu’à l’extension complète.', 'Choisis juste assez d’assistance pour garder une répétition propre. Ne te laisse pas rebondir sur l’élastique.', 'strength', 'Intermédiaire', 2, 'Pull Vertical', 'Pull', 'Upper', 'Strength', 'required', 4, 3, 2, 1, 3, 'ATP-PC', 'Bilateral', 'Suspended', 2, 10, '{Warm-up,Skill,WOD}', false, 'Exercice de base.', '2026-08-05 14:38:35.107694+00', 'reps_standard', NULL, '{reps}', false),
	('EX070', 'Traction excentrique', 'Traction excentrique centrée sur la phase de descente : tu pars en haut et résistes à la gravité jusqu’aux bras tendus.', '1. Monte le menton au-dessus de la barre à l’aide d’un support ou d’un saut contrôlé.
2. Stabilise brièvement la position haute.
3. Descends aussi lentement que prévu jusqu’aux bras tendus.', 'Vise une descente régulière du début à la fin. Utilise un support pour remonter en haut sans fatiguer inutilement la phase concentrique.', 'strength', 'Intermédiaire', 3, 'Pull Vertical', 'Pull', 'Upper', 'Strength', 'required', 4, 3, 2, 1, 3, 'ATP-PC', 'Bilateral', 'Suspended', 2, 10, '{Skill,WOD}', false, 'Exercice de base.', '2026-08-05 14:38:35.107694+00', 'reps_standard', NULL, '{reps}', false),
	('EX075', 'Traction supination (Chin-up)', 'Traction en supination, paumes vers toi, mettant davantage l’accent sur les biceps tout en sollicitant le dos.', '1. Suspends-toi à la barre avec les paumes vers toi.
2. Engage les omoplates puis tire jusqu’à passer le menton au-dessus de la barre.
3. Redescends complètement avec contrôle.', 'Garde les épaules basses et tire la poitrine vers la barre sans projeter le menton en avant.', 'strength', 'Avancé', 3, 'Pull Vertical', 'Pull', 'Upper', 'Strength', 'required', 5, 4, 3, 1, 3, 'ATP-PC', 'Bilateral', 'Suspended', 2, 10, '{Skill,WOD}', false, 'Exercice de base.', '2026-08-05 14:38:35.107694+00', 'reps_standard', NULL, '{reps}', false),
	('EX084', 'Tuck Crunch', 'Crunch compact où genoux et buste se rapprochent simultanément pour solliciter la sangle abdominale.', '1. Assieds-toi légèrement en arrière avec les genoux fléchis.
2. Éloigne le buste et les jambes sans perdre le contrôle du tronc.
3. Ramène les genoux vers la poitrine en redressant le buste.', 'Garde le mouvement contrôlé et évite de tirer sur la nuque. Expire en rapprochant le buste et les genoux.', 'stability', 'Débutant', 1, 'Core', 'Core', 'Core', 'Stability', 'optional', 2, 2, 1, 4, 2, 'Mixed', 'Bilateral', 'Standing', 1, 7, '{Warm-up,Core,WOD}', true, 'Exercice de base.', '2026-08-05 14:38:35.107694+00', 'reps_standard', NULL, '{reps}', true),
	('EX160', 'World''s Greatest Stretch', 'Enchaînement de mobilité en fente profonde associant ouverture de hanche, rotation thoracique et mobilisation des jambes.', '1. Avance un pied à côté de la main du même côté en fente profonde.
2. Pose la main opposée au sol et ouvre l’autre bras vers le plafond.
3. Reviens, puis change de côté après le nombre de répétitions prévu.', 'Travaille lentement et garde le pied avant bien ancré. La rotation doit rester confortable et contrôlée.', 'mobility', 'Débutant', 2, 'Mobility', 'Mobility', 'Full Body', 'Mobility', 'optional', 2, 1, 1, 1, 4, 'Aerobic', 'Bilateral', 'Standing', 1, 7, '{Warm-up}', true, 'Exercice de base.', '2026-08-05 14:38:35.107694+00', 'reps_standard', NULL, '{reps}', false),
	('EX101', 'Bird Dog', 'Exercice de gainage à quatre appuis qui associe extension du bras et de la jambe opposée tout en stabilisant le bassin.', '1. Place-toi à quatre appuis, mains sous les épaules et genoux sous les hanches.
2. Tends simultanément un bras et la jambe opposée.
3. Reviens au centre avec contrôle puis alterne.', 'Imagine un verre posé sur le bassin : il ne doit pas se renverser. Allonge-toi plutôt que de chercher à lever très haut.', 'stability', 'Débutant', 2, 'Anti-Rotation', 'Core', 'Core', 'Stability', 'optional', 1, 1, 1, 4, 1, 'Mixed', 'Bilateral', 'Quadruped', 1, 7, '{Warm-up,Core}', true, 'Exercice de base.', '2026-08-05 14:38:35.107694+00', 'reps_standard', NULL, '{reps}', true),
	('EX153', 'Box Step-up', 'Montée sur box unilatérale pour renforcer quadriceps et fessiers tout en travaillant l’équilibre.', '1. Pose un pied entièrement sur la box.
2. Pousse dans ce pied pour monter jusqu’à te tenir debout sur la box.
3. Redescends avec contrôle puis alterne ou termine les répétitions du même côté.', 'Pousse principalement avec la jambe posée sur la box et évite de te propulser avec le pied resté au sol.', 'general', 'Débutant', 1, 'Lunge', 'Lunge', 'Lower', 'Strength', 'required', 3, 3, 2, 1, 1, 'Glycolytic', 'Bilateral', 'Standing', 3, 7, '{Warm-up,WOD}', false, 'Exercice de base.', '2026-08-05 14:38:35.107694+00', 'reps_standard', NULL, '{reps}', false),
	('EX079', 'Chest to bar Pull-up', 'Traction verticale avancée où la poitrine vient au contact ou très près de la barre, avec une amplitude supérieure à une traction classique.', '1. Suspends-toi à la barre, bras tendus.
2. Engage les omoplates puis tire fort jusqu’à amener le haut de la poitrine vers la barre.
3. Redescends jusqu’à l’extension complète avec contrôle.', 'Initie le tirage avec les omoplates et garde le corps gainé. N’essaie pas de gagner la hauteur en projetant le menton.', 'skill', 'Avancé', 4, 'Pull Vertical', 'Pull', 'Upper', 'Strength', 'required', 5, 5, 3, 1, 3, 'Glycolytic', 'Bilateral', 'Standing', 2, 7, '{Skill,WOD}', false, 'Exercice de base.', '2026-08-05 14:38:35.107694+00', 'reps_standard', NULL, '{reps}', false),
	('EX062', 'Tirage TRX', 'Tirage au poids du corps avec sangles TRX, réalisé en gardant le corps aligné pendant que la poitrine se rapproche des poignées.', '1. Saisis les poignées et incline-toi en arrière, bras tendus.
2. Tire la poitrine vers les poignées en rapprochant les omoplates.
3. Redescends en contrôlant jusqu’à tendre les bras.', 'Plus tu avances les pieds sous le point d’ancrage, plus le mouvement devient difficile. Garde les épaules loin des oreilles.', 'strength', 'Débutant', 2, 'Pull Horizontal', 'Pull', 'Upper', 'Strength', 'required', 3, 2, 1, 1, 3, 'ATP-PC', 'Bilateral', 'Suspended', 4, 7, '{Warm-up,WOD}', false, 'Exercice de base.', '2026-08-05 14:38:35.107694+00', 'reps_standard', NULL, '{reps}', false),
	('EX016', 'Archer Push-up', 'Pompe asymétrique avancée où la majorité du poids se déplace vers un bras, utile comme progression vers la pompe à un bras.', '1. Place les mains nettement plus larges que les épaules.
2. Descends vers un côté en fléchissant ce coude tandis que l’autre bras reste presque tendu.
3. Pousse avec le bras chargé pour revenir au centre puis change de côté.', 'Garde l’épaule du bras chargé stable et descends avec contrôle. Réduis l’amplitude si tu ne peux pas maintenir le buste et le bassin alignés.', 'skill', 'Avancé', 4, 'Push Horizontal', 'Push', 'Upper', 'Strength', 'none', 5, 3, 3, 1, 1, 'Glycolytic', 'Unilateral', 'Standing', 1, 5, '{Skill,WOD}', true, 'Exercice de base.', '2026-08-05 14:38:35.107694+00', 'reps_standard', NULL, '{reps}', false),
	('EX314', 'Lateral Shuffle', 'Déplace-toi latéralement sans croiser les pieds, dans une position légèrement fléchie.', '1. Place-toi en position légèrement fléchie, pieds parallèles et buste stable.
2. Pousse sur la jambe opposée pour te déplacer latéralement sans croiser les pieds.
3. Garde la même hauteur de bassin et change de direction au repère prévu.', 'Reste bas et pousse dans le sol avec la jambe opposée au déplacement.', 'conditioning', 'Débutant', 2, 'Locomotion', 'Locomotion', 'Full Body', 'Conditioning', 'none', 3, 4, 2, 2, 2, 'Mixed', 'Bilateral', NULL, 1, 75, '{Warm-up,WOD}', true, NULL, '2026-08-07 15:33:48.70852+00', 'distance', NULL, '{distance,time}', false),
	('EX315', 'Shoulder Tap', 'Depuis la planche haute, touche alternativement chaque épaule avec la main opposée.', '1. Place-toi en planche haute, mains sous les épaules et pieds légèrement écartés.
2. Décolle une main pour toucher l’épaule opposée sans laisser le bassin tourner.
3. Repose la main puis alterne côté après côté.', 'Écarte légèrement les pieds et garde le bassin immobile.', 'stability', 'Débutant', 2, 'Anti-Rotation', 'Core', 'Core', 'Stability', 'none', 2, 2, 1, 3, 1, 'Mixed', 'Alternating', NULL, 1, 90, '{Warm-up,Core}', true, NULL, '2026-08-07 15:33:48.70852+00', 'reps_standard', NULL, '{reps}', true),
	('EX316', 'Bicycle Crunch', 'Alterne coude et genou opposés en tournant le buste tout en allongeant l’autre jambe.', '1. Allonge-toi sur le dos, mains légères derrière la tête et jambes relevées.
2. Rapproche un coude du genou opposé pendant que l’autre jambe s’allonge.
3. Passe par le centre puis alterne de l’autre côté avec contrôle.', 'Évite de tirer sur la nuque et contrôle la rotation.', 'general', 'Débutant', 2, 'Rotation', 'Core', 'Core', 'Conditioning', 'none', 3, 3, 1, 2, 1, 'Mixed', 'Alternating', NULL, 1, 85, '{Core}', true, NULL, '2026-08-07 15:33:48.70852+00', 'reps_standard', NULL, '{reps}', true),
	('EX317', 'Reverse Crunch', 'Depuis le dos, ramène les genoux vers la poitrine en enroulant légèrement le bassin.', '1. Allonge-toi sur le dos, genoux fléchis et rapprochés du bassin.
2. Ramène les genoux vers la poitrine en enroulant légèrement le bassin hors du sol.
3. Redescends le bassin avec contrôle sans utiliser d’élan.', 'Le mouvement vient des abdos, pas d’un élan des jambes.', 'strength', 'Débutant', 1, 'Core', 'Core', 'Core', 'Strength', 'none', 2, 2, 1, 2, 1, 'Mixed', 'Bilateral', NULL, 1, 90, '{Core}', true, NULL, '2026-08-07 15:33:48.70852+00', 'reps_standard', NULL, '{reps}', true),
	('EX318', 'Flutter Kicks', 'Allongé sur le dos, alterne de petits battements de jambes tendues au-dessus du sol.', '1. Allonge-toi sur le dos et plaque les lombaires au sol.
2. Décolle légèrement les jambes tendues puis alterne de petits battements verticaux.
3. Maintiens l’amplitude uniquement tant que le bas du dos reste plaqué.', 'Garde le bas du dos plaqué et réduis l’amplitude si nécessaire.', 'general', 'Intermédiaire', 2, 'Anti-Extension', 'Core', 'Core', 'Conditioning', 'none', 3, 3, 1, 3, 1, 'Mixed', 'Alternating', NULL, 1, 85, '{Core}', true, NULL, '2026-08-07 15:33:48.70852+00', 'isometric', NULL, '{time}', true),
	('EX319', 'Heel Taps', 'Allongé sur le dos genoux fléchis, alterne les inclinaisons latérales pour toucher chaque talon.', '1. Allonge-toi sur le dos, genoux fléchis, pieds au sol et épaules légèrement décollées.
2. Incline le buste sur un côté pour rapprocher la main du talon correspondant.
3. Reviens au centre puis alterne de l’autre côté.', 'Garde les épaules légèrement décollées et le mouvement contrôlé.', 'general', 'Débutant', 1, 'Core', 'Core', 'Core', 'Conditioning', 'none', 2, 2, 1, 2, 1, 'Mixed', 'Alternating', NULL, 1, 85, '{Core}', true, NULL, '2026-08-07 15:33:48.70852+00', 'reps_standard', NULL, '{reps}', true),
	('EX320', 'Side Plank Reach Through', 'Depuis la planche latérale, passe le bras libre sous le buste puis ouvre de nouveau la poitrine.', '1. Place-toi en planche latérale avec l’avant-bras sous l’épaule et les hanches hautes.
2. Passe le bras libre sous le buste en tournant le haut du corps.
3. Ouvre de nouveau la poitrine vers le plafond puis répète avant de changer de côté.', 'Maintiens les hanches hautes pendant toute la rotation.', 'stability', 'Intermédiaire', 3, 'Rotation', 'Core', 'Core', 'Stability', 'none', 3, 2, 1, 4, 2, 'Mixed', 'Unilateral', NULL, 2, 70, '{Core}', true, NULL, '2026-08-07 15:33:48.70852+00', 'reps_unilateral', NULL, '{reps,time}', true),
	('EX321', 'Band Row', 'Tire l’élastique vers le buste en rapprochant les omoplates puis reviens avec contrôle.', '1. Fixe l’élastique devant toi et saisis une extrémité dans chaque main.
2. Tire les mains vers le buste en ramenant les coudes vers l’arrière et en rapprochant les omoplates.
3. Reviens bras tendus avec contrôle sans laisser les épaules monter.', 'Évite de hausser les épaules pendant le tirage.', 'strength', 'Débutant', 1, 'Pull Horizontal', 'Pull', 'Upper', 'Strength', 'required', 2, 1, 1, 2, 1, 'Mixed', 'Bilateral', NULL, 1, 90, '{Warm-up,Skill,WOD}', true, NULL, '2026-08-07 15:33:48.70852+00', 'reps_standard', NULL, '{reps}', false),
	('EX322', 'Band Face Pull', 'Tire l’élastique vers le visage en écartant les mains et en rapprochant les omoplates.', '1. Fixe l’élastique à hauteur du visage et saisis-le avec les deux mains.
2. Tire vers le visage en écartant les mains et en gardant les coudes ouverts.
3. Reviens lentement jusqu’aux bras tendus sans perdre la tension.', 'Garde les coudes hauts sans cambrer le bas du dos.', 'stability', 'Débutant', 2, 'Pull Horizontal', 'Pull', 'Upper', 'Stability', 'required', 2, 1, 1, 3, 2, 'Mixed', 'Bilateral', NULL, 1, 80, '{Warm-up,Skill}', true, NULL, '2026-08-07 15:33:48.70852+00', 'reps_standard', NULL, '{reps}', false),
	('EX323', 'Ankle Rocks', 'En fente courte, avance doucement le genou au-dessus des orteils sans décoller le talon.', '1. Place-toi en fente courte avec le pied avant entièrement au sol.
2. Avance doucement le genou au-dessus des orteils sans décoller le talon.
3. Reviens puis répète dans une amplitude confortable avant de changer de côté.', 'Travaille dans une amplitude confortable et contrôlée.', 'mobility', 'Débutant', 1, 'Mobility', 'Mobility', 'Lower', 'Mobility', 'none', 1, 1, 1, 1, 2, 'Aerobic', 'Unilateral', NULL, 1, 85, '{Warm-up}', true, NULL, '2026-08-07 15:33:48.70852+00', 'reps_standard', NULL, '{reps,time}', false),
	('EX324', 'Shoulder CARs', 'Effectue lentement un grand cercle contrôlé avec le bras en mobilisant l’épaule sur toute son amplitude.', '1. Tiens-toi droit, bras le long du corps et tronc immobile.
2. Décris lentement le plus grand cercle contrôlé possible avec un bras sans compenser avec le buste.
3. Reviens à la position de départ puis répète avant de changer de côté.', 'Bouge sans compensation du tronc et reste dans une amplitude indolore.', 'mobility', 'Débutant', 2, 'Mobility', 'Mobility', 'Upper', 'Mobility', 'none', 1, 1, 1, 2, 3, 'Aerobic', 'Unilateral', NULL, 1, 80, '{Warm-up}', true, NULL, '2026-08-07 15:33:48.70852+00', 'reps_standard', NULL, '{reps}', false),
	('EX325', 'Half-Kneeling DB Press', 'Depuis une position à demi-genou, presse l’haltère au-dessus de la tête sans incliner le buste.', '1. Place-toi à demi-genou avec l’haltère du côté du genou au sol, tenu à l’épaule.
2. Engage les fessiers et les abdos puis presse l’haltère au-dessus de la tête.
3. Redescends à l’épaule avec contrôle sans incliner ni cambrer le buste.', 'Contracte les fessiers et garde les côtes basses.', 'strength', 'Intermédiaire', 3, 'Push Vertical', 'Push', 'Upper', 'Strength', 'required', 3, 1, 2, 4, 2, 'Phosphagen', 'Unilateral', NULL, 2, 75, '{Skill,WOD}', true, NULL, '2026-08-07 15:33:48.70852+00', 'reps_unilateral', NULL, '{reps,load}', false),
	('EX104', 'Glute Bridge', 'Extension de hanches au sol pour renforcer les fessiers en partant d’une position allongée, genoux fléchis.', '1. Allonge-toi sur le dos, pieds au sol près des fessiers.
2. Pousse dans les talons pour lever le bassin.
3. Contracte les fessiers en haut puis redescends avec contrôle.', 'Termine avec les fessiers, pas avec le bas du dos. Garde les côtes abaissées en haut.', 'strength', 'Débutant', 1, 'Hinge', 'Hinge', 'Lower', 'Strength', 'optional', 2, 1, 1, 1, 1, 'ATP-PC', 'Bilateral', 'Supine', 1, 7, '{Warm-up,WOD}', true, 'Exercice de base.', '2026-08-05 14:38:35.107694+00', 'reps_standard', NULL, '{reps}', false),
	('EX097', 'Planche dynamique (Commandos)', 'Planche dynamique où tu alternes entre appui sur les avant-bras et appui sur les mains tout en stabilisant le tronc.', '1. Pars en planche sur les avant-bras.
2. Monte sur une main puis l’autre jusqu’à la planche haute.
3. Redescends sur les avant-bras et répète.', 'Écarte légèrement les pieds et limite la rotation du bassin. Alterne régulièrement le bras qui commence.', 'stability', 'Intermédiaire', 2, 'Anti-Rotation', 'Core', 'Core', 'Stability', 'optional', 3, 3, 2, 5, 1, 'Mixed', 'Alternating', 'Plank', 1, 7, '{Warm-up,Core,WOD}', true, 'Exercice de base.', '2026-08-05 14:38:35.107694+00', 'reps_standard', NULL, '{reps}', true),
	('EX203', 'Strict HSPU (Handstand Push-up)', 'Handstand push-up strict contre un mur : poussée verticale inversée sans impulsion des jambes.', '1. Monte en handstand contre le mur.
2. Descends la tête vers le support en fléchissant les coudes.
3. Pousse jusqu’à l’extension complète des bras.', 'Utilise un support de tête adapté et une amplitude que tu peux contrôler. Ce mouvement demande déjà une bonne force de poussée verticale.', 'skill', 'Avancé', 5, 'Push Vertical', 'Push', 'Upper', 'Strength', 'none', 5, 2, 4, 5, 4, 'ATP-PC', 'Bilateral', 'Handstand', 3, 5, '{Skill,WOD}', true, NULL, '2026-08-05 16:22:37.758664+00', 'reps_standard', NULL, '{reps}', false),
	('EX087', 'Hollow Hold', 'Maintien isométrique en position hollow pour renforcer la capacité à stabiliser le bassin et le tronc.', '1. Allonge-toi sur le dos et engage les abdos.
2. Décolle épaules et jambes selon ton niveau.
3. Maintiens la position en respirant sans creuser le dos.', 'Priorité absolue au bas du dos plaqué au sol. Une position plus facile bien tenue vaut mieux qu’une forme plus longue mal contrôlée.', 'stability', 'Intermédiaire', 3, 'Anti-Extension', 'Core', 'Core', 'Stability', 'optional', 3, 2, 1, 4, 1, 'Mixed', 'Bilateral', 'Supine', 1, 7, '{Warm-up,Core,Skill,WOD}', true, 'Exercice de base.', '2026-08-05 14:38:35.107694+00', 'isometric', NULL, '{time}', true),
	('EX081', 'Dead Bug', 'Exercice de gainage au sol où bras et jambe opposés s’éloignent du tronc sans perdre le contact lombaire avec le sol.', '1. Allonge-toi sur le dos, hanches et genoux à environ 90°, bras vers le plafond.
2. Tends lentement un bras et la jambe opposée vers le sol.
3. Reviens au centre puis alterne en gardant les lombaires plaquées.', 'Si le bas du dos se décolle, réduis l’amplitude ou garde les genoux plus fléchis.', 'stability', 'Débutant', 2, 'Anti-Extension', 'Core', 'Core', 'Stability', 'optional', 1, 1, 1, 4, 2, 'Mixed', 'Bilateral', 'Supine', 1, 7, '{Warm-up,Core,WOD}', true, 'Exercice de base.', '2026-08-05 14:38:35.107694+00', 'reps_standard', NULL, '{reps}', true),
	('EX024', 'Dips sur banc', 'Dips avec les mains sur un banc pour solliciter principalement triceps et épaules à partir d’un appui derrière le corps.', '1. Place les mains sur le bord du banc, doigts vers l’avant, bassin proche du support.
2. Fléchis les coudes pour descendre verticalement.
3. Pousse dans les mains pour revenir bras tendus.', 'Garde les épaules basses et limite la profondeur si l’avant de l’épaule devient inconfortable.', 'strength', 'Intermédiaire', 2, 'Push Vertical', 'Push', 'Upper', 'Strength', 'required', 4, 2, 2, 1, 1, 'ATP-PC', 'Bilateral', 'Standing', 3, 7, '{Warm-up,WOD}', false, 'Exercice de base.', '2026-08-05 14:38:35.107694+00', 'reps_standard', NULL, '{reps}', false),
	('EX009', 'Pompe classique', 'Pompe classique au poids du corps pour renforcer poitrine, épaules, triceps et gainage en conservant le corps aligné.', '1. Place les mains au sol légèrement plus larges que les épaules et tends les jambes derrière toi.
2. Descends la poitrine vers le sol en gardant le corps en bloc et les coudes contrôlés.
3. Pousse dans le sol jusqu’à retrouver les bras tendus.', 'Garde fessiers et abdos engagés pour éviter que le bassin ne tombe. Réduis l’amplitude ou utilise une variante inclinée si la forme se dégrade.', 'strength', 'Intermédiaire', 2, 'Push Horizontal', 'Push', 'Upper', 'Strength', 'none', 4, 3, 2, 2, 2, 'ATP-PC', 'Bilateral', 'Plank', 1, 10, '{Warm-up,Skill,WOD}', true, 'Exercice de base.', '2026-08-05 14:38:35.107694+00', 'reps_standard', NULL, '{reps}', false),
	('EX013', 'Pompe diamant', 'Variante de pompe avec les mains rapprochées pour accentuer le travail des triceps tout en gardant une poussée horizontale complète.', '1. Place les mains rapprochées sous la poitrine, index et pouces proches l’un de l’autre.
2. Descends la poitrine vers les mains en gardant les coudes près du corps.
3. Pousse jusqu’à l’extension des bras sans perdre le gainage.', 'Garde le corps en bloc. Si la forme se dégrade, utilise les genoux au sol ou une variante inclinée plutôt que de réduire fortement l’amplitude.', 'strength', 'Avancé', 3, 'Push Horizontal', 'Push', 'Upper', 'Strength', 'none', 5, 3, 2, 2, 2, 'ATP-PC', 'Bilateral', 'Plank', 1, 10, '{Skill,WOD}', true, 'Exercice de base.', '2026-08-05 14:38:35.107694+00', 'reps_standard', NULL, '{reps}', false),
	('EX020', 'Pike Push-up', 'Poussée verticale au poids du corps en position de V inversé, utilisée pour renforcer les épaules et préparer les mouvements en appui renversé.', '1. Place-toi en V inversé avec les hanches hautes et les mains au sol.
2. Fléchis les coudes pour amener la tête légèrement en avant des mains.
3. Pousse dans le sol pour revenir bras tendus avec la tête entre les bras.', 'Forme un triangle entre les deux mains et la zone où la tête descend. Plus les hanches restent hautes, plus le mouvement conserve une dominante verticale.', 'strength', 'Intermédiaire', 3, 'Push Vertical', 'Push', 'Upper', 'Strength', 'none', 4, 3, 2, 1, 1, 'ATP-PC', 'Bilateral', 'Standing', 1, 7, '{Skill,WOD}', true, 'Exercice de base.', '2026-08-05 14:38:35.107694+00', 'reps_standard', NULL, '{reps}', false),
	('EX302', 'Suitcase Carry haltère', 'Marche avec une charge tenue d’un seul côté sans laisser le buste s’incliner.', '1. Tiens un haltère d’un seul côté, bras le long du corps.
2. Marche en gardant épaules et bassin horizontaux malgré la traction de la charge.
3. Termine la distance prévue puis change de côté.', 'Reste grand et résiste à la charge avec les obliques.', 'stability', 'Intermédiaire', 2, 'Carry', 'Carry', 'Full Body', 'Stability', 'required', 3, 3, 2, 4, 1, 'Mixed', 'Unilateral', NULL, 2, 75, '{Skill,WOD}', true, NULL, '2026-08-07 15:33:48.70852+00', 'distance', NULL, '{distance,time,load}', false),
	('EX029', 'Wall Walk', 'Déplacement progressif des pieds sur un mur pendant que les mains s’en rapprochent, afin de développer force des épaules, gainage et aisance en position inversée.', '1. Pars en planche avec les pieds contre le mur puis commence à monter les pieds.
2. Avance les mains vers le mur à mesure que les pieds montent, en gardant le tronc gainé.
3. Arrête-toi à la distance maîtrisée puis redescends en inversant les étapes.', 'Avance seulement jusqu’à la distance que tu peux contrôler. Garde les bras actifs et évite de laisser le bassin s’effondrer pendant la montée ou la descente.', 'skill', 'Avancé', 4, 'Push Vertical', 'Push', 'Upper', 'Conditioning', 'none', 5, 4, 3, 1, 1, 'Glycolytic', 'Bilateral', 'Standing', 1, 7, '{Core,Skill,WOD}', true, 'Exercice de base.', '2026-08-05 14:38:35.107694+00', 'reps_standard', NULL, '{reps}', false),
	('EX045', 'Cossack Squat', 'Squat latéral profond alterné pour développer force unilatérale, mobilité des hanches et contrôle des adducteurs.', '1. Place les pieds dans un écartement large, pointes légèrement ouvertes.
2. Transfère le poids vers une jambe en fléchissant ce genou tandis que l’autre jambe reste tendue.
3. Pousse dans le pied de la jambe fléchie pour revenir au centre puis change de côté.', 'Garde le pied de la jambe d’appui entièrement au sol et ne force pas une profondeur qui te fait perdre l’alignement du genou ou du dos.', 'mobility', 'Intermédiaire', 3, 'Squat', 'Squat', 'Lower', 'Mobility', 'none', 3, 2, 2, 2, 4, 'Aerobic', 'Bilateral', 'Standing', 1, 5, '{Warm-up,Skill,WOD}', true, 'Exercice de base.', '2026-08-05 14:38:35.107694+00', 'reps_standard', NULL, '{reps}', false),
	('EX090', 'V-Ups', 'Exercice abdominal dynamique où le buste et les jambes se rapprochent simultanément pour former un V.', '1. Allonge-toi sur le dos, bras allongés au-dessus de la tête et jambes tendues.
2. Relève simultanément le buste et les jambes en rapprochant les mains des pieds.
3. Redescends avec contrôle jusqu’à retrouver une position allongée sans perdre la tension du tronc.', 'Plie légèrement les genoux si nécessaire. Cherche une montée simultanée du buste et des jambes plutôt qu’un élan des bras.', 'stability', 'Avancé', 4, 'Core', 'Core', 'Core', 'Stability', 'optional', 4, 3, 2, 4, 2, 'Mixed', 'Bilateral', 'Supine', 1, 7, '{Core,Skill,WOD}', true, 'Exercice de base.', '2026-08-05 14:38:35.107694+00', 'reps_standard', NULL, '{reps}', false),
	('EX091', 'L-Sit sol', 'Maintien isométrique en appui sur les mains avec les jambes décollées devant soi, sollicitant triceps, épaules, abdominaux et fléchisseurs de hanche.', '1. Assieds-toi jambes tendues avec les mains posées au sol près des hanches.
2. Pousse fortement dans les mains pour décoller le bassin puis les jambes.
3. Maintiens les bras tendus et les épaules basses pendant le temps prévu.', 'Commence en tuck avec les genoux pliés si nécessaire. Cherche à pousser le sol loin de toi avant d’essayer de tendre complètement les jambes.', 'stability', 'Avancé', 5, 'Core', 'Core', 'Core', 'Stability', 'optional', 5, 3, 2, 4, 2, 'Mixed', 'Bilateral', 'Floor', 1, 7, '{Core,Skill,WOD}', true, 'Exercice de base.', '2026-08-05 14:38:35.107694+00', 'reps_standard', NULL, '{reps}', false),
	('EX304', 'Overhead Carry haltère', 'Marche avec une charge stabilisée bras tendu au-dessus de la tête.', '1. Presse l’haltère au-dessus de la tête et stabilise le bras tendu.
2. Marche lentement en gardant les côtes basses et le biceps proche de l’oreille.
3. Termine la distance sans perdre l’alignement puis change de côté.', 'Ne compense pas par une hyperextension lombaire.', 'stability', 'Avancé', 4, 'Carry', 'Carry', 'Upper', 'Stability', 'required', 4, 3, 3, 5, 4, 'Mixed', 'Unilateral', NULL, 3, 50, '{Skill,WOD}', false, NULL, '2026-08-07 15:33:48.70852+00', 'distance', NULL, '{distance,time,load}', false),
	('EX303', 'Front Rack Carry kettlebell', 'Marche avec une kettlebell tenue en position front rack près de l’épaule.', '1. Place la kettlebell en position front rack près de l’épaule.
2. Engage les abdos et marche sans laisser le buste s’incliner ou pivoter.
3. Termine la distance prévue puis change de côté.', 'Garde le poignet neutre et les côtes abaissées.', 'stability', 'Intermédiaire', 3, 'Carry', 'Carry', 'Full Body', 'Stability', 'required', 3, 3, 2, 4, 2, 'Mixed', 'Unilateral', NULL, 2, 70, '{Skill,WOD}', true, NULL, '2026-08-07 15:33:48.70852+00', 'distance', NULL, '{distance,time,load}', false),
	('EX043', 'Pistol Squat assisté', 'Version assistée du pistol squat utilisant un support pour apprendre la force, l’équilibre et la mobilité nécessaires au squat sur une jambe.', '1. Tiens un support avec une ou deux mains et place-toi sur une jambe, l’autre devant toi.
2. Descends en utilisant juste assez d’aide pour garder le pied d’appui stable et le genou dans l’axe.
3. Pousse dans le pied d’appui et utilise le support seulement si nécessaire pour remonter.', 'Réduis progressivement l’aide du support au lieu de forcer la profondeur. Garde le talon de la jambe d’appui au sol.', 'skill', 'Avancé', 4, 'Squat', 'Squat', 'Lower', 'Conditioning', 'required', 5, 3, 3, 5, 5, 'Glycolytic', 'Unilateral', 'Standing', 2, 7, '{Skill,WOD}', false, 'Exercice de base.', '2026-08-05 14:38:35.107694+00', 'reps_unilateral', NULL, '{reps}', false),
	('EX044', 'Pistol Squat', 'Squat complet sur une jambe nécessitant force unilatérale, équilibre et mobilité de hanche, genou et cheville.', '1. Tiens-toi sur une jambe et tends l’autre devant toi.
2. Descends en contrôlant le bassin et le genou jusqu’à la profondeur que tu peux maîtriser.
3. Pousse dans le pied d’appui pour revenir debout sans poser l’autre pied.', 'Garde le pied d’appui entièrement ancré et le genou orienté dans la même direction que les orteils. Utilise une régression si tu perds l’équilibre.', 'skill', 'Avancé', 5, 'Squat', 'Squat', 'Lower', 'Conditioning', 'none', 5, 4, 4, 5, 5, 'Glycolytic', 'Unilateral', 'Standing', 1, 7, '{Skill,WOD}', true, 'Exercice de base.', '2026-08-05 14:38:35.107694+00', 'reps_unilateral', NULL, '{reps}', false),
	('EX145', 'Burpee sans pompe', 'Burpee simplifié sans phase de pompe : passage rapide de la position debout à la planche puis retour debout avec ou sans petit saut selon le standard.', '1. Depuis la position debout, pose les mains au sol et envoie les pieds vers l’arrière jusqu’à la planche.
2. Ramène les pieds près des mains sans descendre la poitrine au sol.
3. Redresse-toi et termine par l’extension ou le petit saut prévu.', 'Conserve un rythme fluide et replace les pieds assez près des mains pour te relever sans arrondir excessivement le dos.', 'conditioning', 'Intermédiaire', 2, 'Conditioning', 'Conditioning', 'Full Body', 'Conditioning', 'none', 4, 4, 3, 2, 2, 'Glycolytic', 'Bilateral', 'Plank', 1, 10, '{Warm-up,WOD}', true, 'Exercice de base.', '2026-08-05 14:38:35.107694+00', 'metabolic_high', NULL, '{reps}', false),
	('EX027', 'Handstand Hold mur', 'Maintien en équilibre sur les mains contre un mur pour développer stabilité des épaules, gainage et contrôle de la position inversée.', '1. Monte en handstand contre le mur selon la variante maîtrisée.
2. Pousse activement le sol avec les mains et aligne poignets, épaules, bassin et chevilles.
3. Maintiens la position pendant le temps prévu puis redescends sous contrôle.', 'Grandis-toi dans les épaules et garde les fessiers engagés. Choisis une distance au mur qui te permet de rester stable sans cambrer.', 'skill', 'Avancé', 4, 'Push Vertical', 'Push', 'Upper', 'Conditioning', 'none', 5, 2, 3, 5, 1, 'Glycolytic', 'Bilateral', 'Standing', 1, 7, '{Core,Skill,WOD}', true, 'Exercice de base.', '2026-08-05 14:38:35.107694+00', 'isometric', NULL, '{time}', false),
	('EX111', 'Kettlebell Swing Américain', 'Swing américain avec kettlebell : extension explosive des hanches qui accompagne la charge jusqu’au-dessus de la tête selon le standard retenu.', '1. Fais passer la kettlebell entre les jambes avec un hinge contrôlé.
2. Étends rapidement les hanches et accompagne la charge vers le haut.
3. Termine avec les bras au-dessus de la tête uniquement si tu gardes côtes et épaules sous contrôle, puis laisse la charge revenir.', 'Ne cherche pas l’amplitude overhead si elle te fait cambrer ou perdre le contrôle des épaules. La puissance vient toujours des hanches.', 'strength', 'Avancé', 4, 'Hinge', 'Hinge', 'Lower', 'Strength', 'required', 5, 4, 3, 3, 1, 'ATP-PC', 'Bilateral', 'Standing', 2, 8, '{Skill,WOD}', false, 'Exercice de base.', '2026-08-05 14:38:35.107694+00', 'reps_standard', NULL, '{reps,load}', false),
	('EX134', 'DB Renegade Row', 'Tirage unilatéral avec haltères depuis une planche haute, combinant renforcement du dos et résistance à la rotation du tronc.', '1. Place-toi en planche haute, mains sur les haltères et pieds légèrement plus écartés que les hanches.
2. Tire un haltère vers les côtes sans laisser le bassin tourner.
3. Repose la charge avec contrôle puis alterne de l’autre côté.', 'Écarte davantage les pieds si nécessaire pour stabiliser le bassin. Tire le coude vers l’arrière sans hausser l’épaule.', 'skill', 'Avancé', 4, 'Pull Horizontal', 'Pull', 'Upper', 'Conditioning', 'required', 5, 4, 3, 1, 3, 'Glycolytic', 'Bilateral', 'Standing', 2, 7, '{Core,Skill,WOD}', false, 'Exercice de base.', '2026-08-05 14:38:35.107694+00', 'reps_standard', NULL, '{reps,load}', false),
	('EX110', 'Kettlebell Swing Russe', 'Swing russe avec kettlebell : extension explosive des hanches qui propulse la charge jusqu’à environ la hauteur de poitrine.', '1. Place la kettlebell devant toi puis fais-la passer entre les jambes avec un hinge.
2. Étends rapidement les hanches pour propulser la charge vers l’avant jusqu’à environ la poitrine.
3. Laisse la kettlebell revenir entre les jambes et absorbe son retour en reculant les hanches.', 'Le moteur du mouvement vient des hanches, pas d’un squat ni d’un tirage des bras. Garde la kettlebell proche de l’axe du corps.', 'strength', 'Intermédiaire', 3, 'Hinge', 'Hinge', 'Lower', 'Strength', 'required', 4, 4, 2, 3, 1, 'ATP-PC', 'Bilateral', 'Standing', 2, 8, '{Warm-up,Skill,WOD}', false, 'Exercice de base.', '2026-08-05 14:38:35.107694+00', 'reps_standard', NULL, '{reps,load}', false),
	('EX301', 'Farmer Carry haltères', 'Marche en tenant une charge dans chaque main, bras longs et buste droit.', '1. Tiens un haltère dans chaque main, bras le long du corps.
2. Grandis-toi, engage le tronc et marche à pas réguliers sur la distance prévue.
3. Garde les charges stables et termine sans hausser les épaules ni incliner le buste.', 'Garde les épaules basses et le tronc gainé.', 'conditioning', 'Intermédiaire', 2, 'Carry', 'Carry', 'Full Body', 'Conditioning', 'required', 3, 4, 2, 3, 1, 'Mixed', 'Bilateral', NULL, 2, 80, '{WOD}', true, NULL, '2026-08-07 15:33:48.70852+00', 'distance', NULL, '{distance,time,load}', false),
	('EX305', 'Wall Ball', 'Réalise un squat puis utilise l’extension des jambes pour lancer le medball vers une cible.', '1. Tiens le medball devant la poitrine et descends en squat.
2. Remonte puissamment et utilise l’extension des jambes pour lancer le ballon vers la cible.
3. Récupère le ballon près de la poitrine et enchaîne directement la répétition suivante.', 'Attrape le ballon en amortissant directement vers le squat suivant.', 'general', 'Intermédiaire', 3, 'Squat', 'Squat', 'Full Body', 'Conditioning', 'required', 4, 5, 2, 3, 3, 'Glycolytic', 'Bilateral', NULL, 2, 80, '{WOD}', false, NULL, '2026-08-07 15:33:48.70852+00', 'reps_standard', NULL, '{reps,load}', false),
	('EX306', 'Medball Slam', 'Monte le medball au-dessus de la tête puis projette-le puissamment vers le sol.', '1. Tiens le medball à deux mains et monte-le au-dessus de la tête.
2. Étends le corps puis projette le ballon vers le sol avec les hanches et les abdos.
3. Récupère le ballon en gardant le dos stable avant de recommencer.', 'Utilise les hanches et les abdos plutôt que seulement les bras.', 'conditioning', 'Débutant', 2, 'Conditioning', 'Conditioning', 'Full Body', 'Power', 'required', 4, 5, 2, 2, 2, 'Glycolytic', 'Bilateral', NULL, 2, 80, '{WOD}', false, NULL, '2026-08-07 15:33:48.70852+00', 'metabolic_high', NULL, '{reps,load}', false),
	('EX307', 'DB Floor Press', 'Allongé au sol, presse les haltères jusqu’à l’extension des bras puis redescends avec contrôle.', '1. Allonge-toi au sol avec un haltère dans chaque main, coudes proches du buste.
2. Presse les haltères jusqu’à tendre les bras au-dessus de la poitrine.
3. Redescends avec contrôle jusqu’à ce que les bras touchent légèrement le sol.', 'Garde les omoplates stables et les poignets neutres.', 'strength', 'Débutant', 2, 'Push Horizontal', 'Push', 'Upper', 'Strength', 'required', 3, 1, 1, 2, 1, 'Phosphagen', 'Bilateral', NULL, 2, 85, '{Skill,WOD}', true, NULL, '2026-08-07 15:33:48.70852+00', 'reps_standard', NULL, '{reps,load}', false),
	('EX311', 'Bear Crawl', 'Déplace-toi à quatre appuis avec les genoux légèrement décollés du sol.', '1. Place-toi à quatre appuis puis décolle légèrement les genoux du sol.
2. Avance une main et le pied opposé en gardant le bassin bas et stable.
3. Continue en alternant les appuis sur la distance ou le temps prévu.', 'Avance lentement en limitant les rotations du bassin.', 'conditioning', 'Intermédiaire', 3, 'Locomotion', 'Locomotion', 'Full Body', 'Conditioning', 'none', 4, 4, 2, 4, 2, 'Mixed', 'Alternating', NULL, 2, 80, '{Warm-up,WOD}', true, NULL, '2026-08-07 15:33:48.70852+00', 'distance', NULL, '{distance,time}', false),
	('EX312', 'Shuttle Run', 'Effectue des allers-retours rapides entre deux repères en changeant de direction à chaque extrémité.', '1. Place deux repères à la distance prévue et démarre derrière le premier.
2. Cours jusqu’au repère opposé puis ralentis pour changer de direction sous contrôle.
3. Repars immédiatement dans l’autre sens jusqu’à compléter les allers-retours demandés.', 'Ralentis avant le demi-tour pour conserver un bon appui.', 'conditioning', 'Débutant', 2, 'Locomotion', 'Locomotion', 'Full Body', 'Conditioning', 'none', 5, 5, 3, 2, 2, 'Glycolytic', 'Alternating', NULL, 1, 85, '{WOD}', true, NULL, '2026-08-07 15:33:48.70852+00', 'distance', NULL, '{distance,time}', false);


--
-- Data for Name: exercise_constraints; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."exercise_constraints" ("id", "exercise_id", "constraint_name", "reason", "priority", "body_zone", "rule_type", "severity") OVERRIDING SYSTEM VALUE VALUES
	(1, 'EX027', 'Requires strong warm-up', 'High mobility and stability risk', 'High', NULL, NULL, NULL),
	(2, 'EX043', 'Requires strong warm-up', 'High mobility and stability risk', 'High', NULL, NULL, NULL),
	(3, 'EX044', 'Requires strong warm-up', 'High mobility and stability risk', 'High', NULL, NULL, NULL),
	(4, 'EX310', 'kb_deadlift_lower_back', 'Le hinge chargé nécessite un contrôle lombaire suffisant.', 'medium', 'lower_back', 'regress', 2),
	(5, 'EX201', 'handstand_walk_shoulder', 'Stabilité avancée au-dessus de la tête.', 'high', 'shoulder', 'avoid', 3),
	(6, 'EX318', 'flutter_kicks_lower_back', 'Peut accentuer la contrainte lombaire si le bassin perd sa position.', 'medium', 'lower_back', 'regress', 2),
	(7, 'EX320', 'side_plank_shoulder', 'Appui latéral prolongé sur l’épaule.', 'medium', 'shoulder', 'regress', 2),
	(8, 'EX305', 'wall_ball_knee', 'Volume de squat répété sous fatigue.', 'medium', 'knee', 'caution', 2),
	(9, 'EX201', 'handstand_walk_wrist', 'Charge importante sur les poignets en extension.', 'high', 'wrist', 'avoid', 3),
	(10, 'EX315', 'shoulder_tap_wrist', 'Appui prolongé sur les poignets en extension.', 'medium', 'wrist', 'caution', 2),
	(11, 'EX203', 'strict_hspu_wrist', 'Appui prolongé avec forte extension du poignet.', 'high', 'wrist', 'avoid', 3),
	(12, 'EX203', 'strict_hspu_shoulder', 'Forte demande de poussée verticale et de stabilité au-dessus de la tête.', 'high', 'shoulder', 'avoid', 3),
	(13, 'EX309', 'db_deadlift_lower_back', 'Le hinge chargé nécessite un contrôle lombaire suffisant.', 'medium', 'lower_back', 'regress', 2),
	(14, 'EX044', 'pistol_knee', 'Forte flexion et contrôle unilatéral du genou.', 'high', 'knee', 'regress', 3),
	(15, 'EX315', 'shoulder_tap_shoulder', 'Stabilité répétée en appui bras tendus.', 'medium', 'shoulder', 'caution', 2),
	(16, 'EX304', 'overhead_carry_shoulder', 'Charge maintenue au-dessus de la tête.', 'high', 'shoulder', 'avoid', 3);


--
-- Data for Name: exercise_equipment; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."exercise_equipment" ("exercise_id", "equipment_id") VALUES
	('EX003', 'E10'),
	('EX017', 'E10'),
	('EX024', 'E08'),
	('EX030', 'E10'),
	('EX037', 'E03'),
	('EX040', 'E04'),
	('EX043', 'E06'),
	('EX057', 'E08'),
	('EX061', 'E03'),
	('EX062', 'E06'),
	('EX065', 'E07'),
	('EX067', 'E07'),
	('EX070', 'E07'),
	('EX071', 'E07'),
	('EX075', 'E07'),
	('EX079', 'E07'),
	('EX080', 'E07'),
	('EX081', 'E01'),
	('EX084', 'E01'),
	('EX087', 'E01'),
	('EX089', 'E01'),
	('EX090', 'E01'),
	('EX091', 'E01'),
	('EX093', 'E01'),
	('EX095', 'E01'),
	('EX097', 'E01'),
	('EX098', 'E01'),
	('EX100', 'E03'),
	('EX101', 'E01'),
	('EX104', 'E01'),
	('EX107', 'E03'),
	('EX110', 'E04'),
	('EX111', 'E04'),
	('EX112', 'E05'),
	('EX115', 'E03'),
	('EX118', 'E03'),
	('EX121', 'E03'),
	('EX122', 'E04'),
	('EX125', 'E03'),
	('EX126', 'E03'),
	('EX127', 'E04'),
	('EX128', 'E04'),
	('EX129', 'E03'),
	('EX130', 'E03'),
	('EX131', 'E03'),
	('EX134', 'E03'),
	('EX135', 'E05'),
	('EX138', 'E05'),
	('EX141', 'E05'),
	('EX152', 'E10'),
	('EX153', 'E10'),
	('EX156', 'E02'),
	('EX157', 'E02'),
	('EX158', 'E01'),
	('EX159', 'E01'),
	('EX160', 'E01'),
	('EX161', 'E10'),
	('EX162', 'E01'),
	('EX163', 'E01'),
	('EX166', 'E01'),
	('EX301', 'E03'),
	('EX302', 'E03'),
	('EX303', 'E04'),
	('EX304', 'E03'),
	('EX305', 'E09'),
	('EX306', 'E09'),
	('EX307', 'E03'),
	('EX308', 'E03'),
	('EX308', 'E08'),
	('EX309', 'E03'),
	('EX310', 'E04'),
	('EX321', 'E05'),
	('EX322', 'E05'),
	('EX325', 'E03');


--
-- Data for Name: muscles; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."muscles" ("id", "name") VALUES
	('M01', 'Pectoraux'),
	('M02', 'Grand Dorsal'),
	('M03', 'Deltoïdes'),
	('M04', 'Biceps'),
	('M05', 'Triceps'),
	('M06', 'Quadriceps'),
	('M07', 'Ischio-jambiers'),
	('M08', 'Fessiers'),
	('M09', 'Mollets'),
	('M10', 'Sangle abdominale'),
	('M11', 'Obliques'),
	('M12', 'Lombaires'),
	('M13', 'Trapèzes'),
	('M14', 'Psoas'),
	('M15', 'Mobilité Globale'),
	('M16', 'Cardio-vasculaire');


--
-- Data for Name: exercise_muscles; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."exercise_muscles" ("exercise_id", "muscle_id", "priority") VALUES
	('EX001', 'M01', 'primary'),
	('EX001', 'M05', 'secondary'),
	('EX003', 'M01', 'primary'),
	('EX003', 'M05', 'secondary'),
	('EX006', 'M01', 'primary'),
	('EX006', 'M05', 'secondary'),
	('EX009', 'M01', 'primary'),
	('EX009', 'M05', 'secondary'),
	('EX013', 'M05', 'primary'),
	('EX013', 'M01', 'secondary'),
	('EX016', 'M01', 'primary'),
	('EX016', 'M05', 'secondary'),
	('EX017', 'M03', 'primary'),
	('EX017', 'M05', 'secondary'),
	('EX020', 'M03', 'primary'),
	('EX020', 'M05', 'secondary'),
	('EX024', 'M05', 'primary'),
	('EX024', 'M01', 'secondary'),
	('EX027', 'M03', 'primary'),
	('EX027', 'M10', 'secondary'),
	('EX029', 'M03', 'primary'),
	('EX029', 'M10', 'secondary'),
	('EX030', 'M06', 'primary'),
	('EX030', 'M08', 'secondary'),
	('EX033', 'M06', 'primary'),
	('EX033', 'M08', 'secondary'),
	('EX037', 'M06', 'primary'),
	('EX037', 'M10', 'secondary'),
	('EX040', 'M06', 'primary'),
	('EX040', 'M10', 'secondary'),
	('EX043', 'M06', 'primary'),
	('EX043', 'M08', 'secondary'),
	('EX044', 'M06', 'primary'),
	('EX044', 'M08', 'secondary'),
	('EX045', 'M06', 'primary'),
	('EX048', 'M06', 'primary'),
	('EX048', 'M08', 'secondary'),
	('EX051', 'M06', 'primary'),
	('EX051', 'M08', 'secondary'),
	('EX054', 'M06', 'primary'),
	('EX054', 'M08', 'secondary'),
	('EX057', 'M06', 'primary'),
	('EX057', 'M08', 'secondary'),
	('EX061', 'M06', 'primary'),
	('EX061', 'M08', 'secondary'),
	('EX062', 'M02', 'primary'),
	('EX062', 'M04', 'secondary'),
	('EX065', 'M02', 'primary'),
	('EX065', 'M13', 'secondary'),
	('EX067', 'M02', 'primary'),
	('EX067', 'M04', 'secondary'),
	('EX070', 'M02', 'primary'),
	('EX070', 'M04', 'secondary'),
	('EX071', 'M02', 'primary'),
	('EX071', 'M04', 'secondary'),
	('EX075', 'M02', 'primary'),
	('EX075', 'M04', 'secondary'),
	('EX079', 'M02', 'primary'),
	('EX079', 'M04', 'secondary'),
	('EX080', 'M02', 'primary'),
	('EX080', 'M05', 'secondary'),
	('EX081', 'M10', 'primary'),
	('EX081', 'M14', 'secondary'),
	('EX084', 'M10', 'primary'),
	('EX084', 'M14', 'secondary'),
	('EX087', 'M10', 'primary'),
	('EX087', 'M06', 'secondary'),
	('EX089', 'M10', 'primary'),
	('EX089', 'M06', 'secondary'),
	('EX090', 'M10', 'primary'),
	('EX090', 'M14', 'secondary'),
	('EX091', 'M10', 'primary'),
	('EX091', 'M06', 'secondary'),
	('EX093', 'M10', 'primary'),
	('EX093', 'M03', 'secondary'),
	('EX095', 'M10', 'primary'),
	('EX095', 'M03', 'secondary'),
	('EX097', 'M10', 'primary'),
	('EX097', 'M05', 'secondary'),
	('EX098', 'M11', 'primary'),
	('EX098', 'M03', 'secondary'),
	('EX100', 'M11', 'primary'),
	('EX100', 'M10', 'secondary'),
	('EX101', 'M12', 'primary'),
	('EX101', 'M10', 'secondary'),
	('EX104', 'M08', 'primary'),
	('EX104', 'M07', 'secondary'),
	('EX107', 'M08', 'primary'),
	('EX107', 'M07', 'secondary'),
	('EX110', 'M08', 'primary'),
	('EX110', 'M07', 'secondary'),
	('EX111', 'M08', 'primary'),
	('EX111', 'M03', 'secondary'),
	('EX112', 'M12', 'primary'),
	('EX112', 'M07', 'secondary'),
	('EX115', 'M07', 'primary'),
	('EX115', 'M08', 'secondary'),
	('EX118', 'M03', 'primary'),
	('EX118', 'M05', 'secondary'),
	('EX121', 'M03', 'primary'),
	('EX121', 'M06', 'secondary'),
	('EX122', 'M03', 'primary'),
	('EX122', 'M05', 'secondary'),
	('EX125', 'M08', 'primary'),
	('EX125', 'M03', 'secondary'),
	('EX126', 'M08', 'primary'),
	('EX126', 'M13', 'secondary'),
	('EX127', 'M08', 'primary'),
	('EX127', 'M03', 'secondary'),
	('EX128', 'M08', 'primary'),
	('EX128', 'M13', 'secondary'),
	('EX129', 'M16', 'primary'),
	('EX129', 'M08', 'secondary'),
	('EX130', 'M06', 'primary'),
	('EX130', 'M03', 'secondary'),
	('EX131', 'M02', 'primary'),
	('EX131', 'M04', 'secondary'),
	('EX134', 'M02', 'primary'),
	('EX134', 'M10', 'secondary'),
	('EX135', 'M03', 'primary'),
	('EX135', 'M13', 'secondary'),
	('EX138', 'M03', 'primary'),
	('EX138', 'M05', 'secondary'),
	('EX141', 'M11', 'primary'),
	('EX141', 'M10', 'secondary'),
	('EX144', 'M16', 'primary'),
	('EX144', 'M10', 'secondary'),
	('EX145', 'M16', 'primary'),
	('EX145', 'M08', 'secondary'),
	('EX146', 'M16', 'primary'),
	('EX146', 'M01', 'secondary'),
	('EX147', 'M16', 'primary'),
	('EX147', 'M01', 'secondary'),
	('EX148', 'M16', 'primary'),
	('EX148', 'M09', 'secondary'),
	('EX149', 'M16', 'primary'),
	('EX149', 'M10', 'secondary'),
	('EX150', 'M16', 'primary'),
	('EX150', 'M14', 'secondary'),
	('EX151', 'M16', 'primary'),
	('EX151', 'M08', 'secondary'),
	('EX152', 'M08', 'primary'),
	('EX152', 'M16', 'secondary'),
	('EX153', 'M06', 'primary'),
	('EX153', 'M08', 'secondary'),
	('EX155', 'M08', 'primary'),
	('EX155', 'M06', 'secondary'),
	('EX156', 'M16', 'primary'),
	('EX156', 'M09', 'secondary'),
	('EX157', 'M16', 'primary'),
	('EX157', 'M09', 'secondary'),
	('EX158', 'M15', 'primary'),
	('EX158', 'M12', 'secondary'),
	('EX159', 'M15', 'primary'),
	('EX159', 'M07', 'secondary'),
	('EX160', 'M15', 'primary'),
	('EX160', 'M14', 'secondary'),
	('EX161', 'M06', 'primary'),
	('EX161', 'M14', 'secondary'),
	('EX162', 'M15', 'primary'),
	('EX162', 'M13', 'secondary'),
	('EX163', 'M08', 'primary'),
	('EX163', 'M15', 'secondary'),
	('EX164', 'M15', 'primary'),
	('EX166', 'M15', 'primary'),
	('EX166', 'M01', 'secondary'),
	('EX301', 'M13', 'primary'),
	('EX301', 'M10', 'secondary'),
	('EX301', 'M08', 'secondary'),
	('EX302', 'M11', 'primary'),
	('EX302', 'M10', 'secondary'),
	('EX302', 'M13', 'secondary'),
	('EX303', 'M10', 'primary'),
	('EX303', 'M03', 'secondary'),
	('EX303', 'M11', 'secondary'),
	('EX304', 'M03', 'primary'),
	('EX304', 'M10', 'secondary'),
	('EX304', 'M13', 'secondary'),
	('EX305', 'M06', 'primary'),
	('EX305', 'M08', 'primary'),
	('EX305', 'M03', 'secondary'),
	('EX306', 'M10', 'primary'),
	('EX306', 'M03', 'secondary'),
	('EX306', 'M08', 'secondary'),
	('EX307', 'M01', 'primary'),
	('EX307', 'M05', 'secondary'),
	('EX307', 'M03', 'secondary'),
	('EX308', 'M01', 'primary'),
	('EX308', 'M05', 'secondary'),
	('EX308', 'M03', 'secondary'),
	('EX309', 'M08', 'primary'),
	('EX309', 'M07', 'primary'),
	('EX309', 'M12', 'secondary'),
	('EX310', 'M08', 'primary'),
	('EX310', 'M07', 'primary'),
	('EX310', 'M12', 'secondary'),
	('EX311', 'M10', 'primary'),
	('EX311', 'M03', 'secondary'),
	('EX311', 'M06', 'secondary'),
	('EX312', 'M16', 'primary'),
	('EX312', 'M06', 'secondary'),
	('EX312', 'M09', 'secondary'),
	('EX313', 'M16', 'primary'),
	('EX313', 'M06', 'secondary'),
	('EX313', 'M09', 'secondary'),
	('EX314', 'M08', 'primary'),
	('EX314', 'M06', 'secondary'),
	('EX314', 'M16', 'secondary'),
	('EX315', 'M10', 'primary'),
	('EX315', 'M11', 'secondary'),
	('EX315', 'M03', 'secondary'),
	('EX316', 'M11', 'primary'),
	('EX316', 'M10', 'secondary'),
	('EX316', 'M14', 'secondary'),
	('EX317', 'M10', 'primary'),
	('EX317', 'M14', 'secondary'),
	('EX318', 'M10', 'primary'),
	('EX318', 'M14', 'secondary'),
	('EX319', 'M11', 'primary'),
	('EX319', 'M10', 'secondary'),
	('EX320', 'M11', 'primary'),
	('EX320', 'M10', 'secondary'),
	('EX320', 'M03', 'secondary'),
	('EX321', 'M02', 'primary'),
	('EX321', 'M04', 'secondary'),
	('EX321', 'M13', 'secondary'),
	('EX322', 'M13', 'primary'),
	('EX322', 'M03', 'secondary'),
	('EX322', 'M02', 'secondary'),
	('EX323', 'M09', 'primary'),
	('EX323', 'M15', 'secondary'),
	('EX324', 'M03', 'primary'),
	('EX324', 'M15', 'secondary'),
	('EX325', 'M03', 'primary'),
	('EX325', 'M05', 'secondary'),
	('EX325', 'M10', 'secondary'),
	('EX203', 'M03', 'primary'),
	('EX203', 'M05', 'secondary');


--
-- Data for Name: exercise_tags; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."exercise_tags" ("exercise_id", "tag") VALUES
	('EX001', 'Upper'),
	('EX001', 'Push'),
	('EX001', 'Strength'),
	('EX001', 'Bodyweight'),
	('EX001', 'Push Horizontal'),
	('EX003', 'Upper'),
	('EX003', 'Push'),
	('EX003', 'Strength'),
	('EX003', 'Push Horizontal'),
	('EX006', 'Upper'),
	('EX006', 'Push'),
	('EX006', 'Strength'),
	('EX006', 'Bodyweight'),
	('EX006', 'Push Horizontal'),
	('EX009', 'Upper'),
	('EX009', 'Push'),
	('EX009', 'Strength'),
	('EX009', 'Bodyweight'),
	('EX009', 'Push Horizontal'),
	('EX013', 'Upper'),
	('EX013', 'Push'),
	('EX013', 'Strength'),
	('EX013', 'Bodyweight'),
	('EX013', 'Push Horizontal'),
	('EX016', 'Upper'),
	('EX016', 'Push'),
	('EX016', 'Conditioning'),
	('EX016', 'Bodyweight'),
	('EX016', 'Push Horizontal'),
	('EX017', 'Upper'),
	('EX017', 'Push'),
	('EX017', 'Strength'),
	('EX017', 'Push Vertical'),
	('EX020', 'Upper'),
	('EX020', 'Push'),
	('EX020', 'Strength'),
	('EX020', 'Bodyweight'),
	('EX020', 'Push Vertical'),
	('EX024', 'Upper'),
	('EX024', 'Push'),
	('EX024', 'Strength'),
	('EX024', 'Push Vertical'),
	('EX027', 'Upper'),
	('EX027', 'Push'),
	('EX027', 'Conditioning'),
	('EX027', 'Bodyweight'),
	('EX027', 'Push Vertical'),
	('EX029', 'Upper'),
	('EX029', 'Push'),
	('EX029', 'Conditioning'),
	('EX029', 'Bodyweight'),
	('EX029', 'Push Vertical'),
	('EX030', 'Lower'),
	('EX030', 'Squat'),
	('EX030', 'Strength'),
	('EX033', 'Lower'),
	('EX033', 'Squat'),
	('EX033', 'Strength'),
	('EX033', 'Bodyweight'),
	('EX037', 'Lower'),
	('EX037', 'Squat'),
	('EX037', 'Strength'),
	('EX040', 'Lower'),
	('EX040', 'Squat'),
	('EX040', 'Strength'),
	('EX043', 'Lower'),
	('EX043', 'Squat'),
	('EX043', 'Conditioning'),
	('EX044', 'Lower'),
	('EX044', 'Squat'),
	('EX044', 'Conditioning'),
	('EX044', 'Bodyweight'),
	('EX045', 'Lower'),
	('EX045', 'Squat'),
	('EX045', 'Mobility'),
	('EX045', 'Bodyweight'),
	('EX048', 'Lower'),
	('EX048', 'Lunge'),
	('EX048', 'Strength'),
	('EX048', 'Bodyweight'),
	('EX051', 'Lower'),
	('EX051', 'Lunge'),
	('EX051', 'Strength'),
	('EX051', 'Bodyweight'),
	('EX054', 'Lower'),
	('EX054', 'Lunge'),
	('EX054', 'Strength'),
	('EX054', 'Bodyweight'),
	('EX057', 'Lower'),
	('EX057', 'Lunge'),
	('EX057', 'Strength'),
	('EX061', 'Lower'),
	('EX061', 'Lunge'),
	('EX061', 'Strength'),
	('EX062', 'Upper'),
	('EX062', 'Pull'),
	('EX062', 'Strength'),
	('EX062', 'Pull Horizontal'),
	('EX065', 'Upper'),
	('EX065', 'Pull'),
	('EX065', 'Conditioning'),
	('EX065', 'Pull Vertical'),
	('EX067', 'Upper'),
	('EX067', 'Pull'),
	('EX067', 'Strength'),
	('EX067', 'Pull Vertical'),
	('EX070', 'Upper'),
	('EX070', 'Pull'),
	('EX070', 'Strength'),
	('EX070', 'Pull Vertical'),
	('EX071', 'Upper'),
	('EX071', 'Pull'),
	('EX071', 'Strength'),
	('EX071', 'Pull Vertical'),
	('EX075', 'Upper'),
	('EX075', 'Pull'),
	('EX075', 'Strength'),
	('EX075', 'Pull Vertical'),
	('EX079', 'Upper'),
	('EX079', 'Pull'),
	('EX079', 'Conditioning'),
	('EX079', 'Pull Vertical'),
	('EX080', 'Upper'),
	('EX080', 'Pull'),
	('EX080', 'Conditioning'),
	('EX080', 'Pull Vertical'),
	('EX081', 'Core'),
	('EX081', 'Stability'),
	('EX084', 'Core'),
	('EX084', 'Stability'),
	('EX087', 'Core'),
	('EX087', 'Stability'),
	('EX089', 'Core'),
	('EX089', 'Stability'),
	('EX090', 'Core'),
	('EX090', 'Stability'),
	('EX091', 'Core'),
	('EX091', 'Stability'),
	('EX093', 'Core'),
	('EX093', 'Stability'),
	('EX095', 'Core'),
	('EX095', 'Stability'),
	('EX097', 'Core'),
	('EX097', 'Stability'),
	('EX098', 'Core'),
	('EX098', 'Stability'),
	('EX100', 'Core'),
	('EX100', 'Stability'),
	('EX101', 'Core'),
	('EX101', 'Stability'),
	('EX104', 'Lower'),
	('EX104', 'Hinge'),
	('EX104', 'Strength'),
	('EX107', 'Lower'),
	('EX107', 'Hinge'),
	('EX107', 'Strength'),
	('EX110', 'Lower'),
	('EX110', 'Hinge'),
	('EX110', 'Strength'),
	('EX111', 'Lower'),
	('EX111', 'Hinge'),
	('EX111', 'Strength'),
	('EX112', 'Lower'),
	('EX112', 'Hinge'),
	('EX112', 'Conditioning'),
	('EX115', 'Lower'),
	('EX115', 'Hinge'),
	('EX115', 'Strength'),
	('EX118', 'Upper'),
	('EX118', 'Push'),
	('EX118', 'Strength'),
	('EX118', 'Push Vertical'),
	('EX121', 'Upper'),
	('EX121', 'Push'),
	('EX121', 'Strength'),
	('EX121', 'Push Vertical'),
	('EX122', 'Upper'),
	('EX122', 'Push'),
	('EX122', 'Strength'),
	('EX122', 'Push Vertical'),
	('EX125', 'Full Body'),
	('EX125', 'Jump'),
	('EX125', 'Power'),
	('EX126', 'Full Body'),
	('EX126', 'Jump'),
	('EX126', 'Power'),
	('EX127', 'Full Body'),
	('EX127', 'Jump'),
	('EX127', 'Power'),
	('EX128', 'Full Body'),
	('EX128', 'Jump'),
	('EX128', 'Power'),
	('EX129', 'Full Body'),
	('EX129', 'Conditioning'),
	('EX130', 'Full Body'),
	('EX130', 'Conditioning'),
	('EX131', 'Upper'),
	('EX131', 'Pull'),
	('EX131', 'Strength'),
	('EX131', 'Pull Horizontal'),
	('EX134', 'Upper'),
	('EX134', 'Pull'),
	('EX134', 'Conditioning'),
	('EX134', 'Pull Horizontal'),
	('EX135', 'Upper'),
	('EX135', 'Pull'),
	('EX135', 'Mobility'),
	('EX135', 'Pull Horizontal'),
	('EX138', 'Upper'),
	('EX138', 'Push'),
	('EX138', 'Conditioning'),
	('EX138', 'Push Vertical'),
	('EX141', 'Core'),
	('EX141', 'Stability'),
	('EX144', 'Full Body'),
	('EX144', 'Conditioning'),
	('EX144', 'Bodyweight'),
	('EX145', 'Full Body'),
	('EX145', 'Conditioning'),
	('EX145', 'Bodyweight'),
	('EX146', 'Full Body'),
	('EX146', 'Conditioning'),
	('EX146', 'Bodyweight'),
	('EX147', 'Full Body'),
	('EX147', 'Conditioning'),
	('EX147', 'Bodyweight'),
	('EX148', 'Full Body'),
	('EX148', 'Conditioning'),
	('EX148', 'Bodyweight'),
	('EX149', 'Full Body'),
	('EX149', 'Conditioning'),
	('EX149', 'Bodyweight'),
	('EX150', 'Full Body'),
	('EX150', 'Conditioning'),
	('EX150', 'Bodyweight'),
	('EX151', 'Full Body'),
	('EX151', 'Locomotion'),
	('EX151', 'Conditioning'),
	('EX151', 'Bodyweight'),
	('EX152', 'Full Body'),
	('EX152', 'Jump'),
	('EX152', 'Power'),
	('EX153', 'Lower'),
	('EX153', 'Lunge'),
	('EX153', 'Conditioning'),
	('EX155', 'Full Body'),
	('EX155', 'Jump'),
	('EX155', 'Power'),
	('EX155', 'Bodyweight'),
	('EX156', 'Full Body'),
	('EX156', 'Conditioning'),
	('EX157', 'Full Body'),
	('EX157', 'Conditioning'),
	('EX158', 'Full Body'),
	('EX158', 'Mobility'),
	('EX159', 'Full Body'),
	('EX159', 'Mobility'),
	('EX160', 'Full Body'),
	('EX160', 'Mobility'),
	('EX161', 'Full Body'),
	('EX161', 'Mobility'),
	('EX162', 'Full Body'),
	('EX162', 'Mobility'),
	('EX163', 'Full Body'),
	('EX163', 'Mobility'),
	('EX164', 'Full Body'),
	('EX164', 'Mobility'),
	('EX164', 'Bodyweight'),
	('EX166', 'Full Body'),
	('EX166', 'Mobility'),
	('EX301', 'carry'),
	('EX301', 'conditioning'),
	('EX301', 'loaded'),
	('EX302', 'carry'),
	('EX302', 'unilateral'),
	('EX302', 'core'),
	('EX303', 'carry'),
	('EX303', 'front-rack'),
	('EX303', 'core'),
	('EX304', 'carry'),
	('EX304', 'overhead'),
	('EX304', 'advanced'),
	('EX305', 'squat'),
	('EX305', 'conditioning'),
	('EX305', 'medball'),
	('EX306', 'conditioning'),
	('EX306', 'power'),
	('EX306', 'medball'),
	('EX307', 'push'),
	('EX307', 'horizontal'),
	('EX307', 'strength'),
	('EX308', 'push'),
	('EX308', 'horizontal'),
	('EX308', 'strength'),
	('EX309', 'hinge'),
	('EX309', 'strength'),
	('EX309', 'dumbbell'),
	('EX310', 'hinge'),
	('EX310', 'strength'),
	('EX310', 'kettlebell'),
	('EX311', 'locomotion'),
	('EX311', 'conditioning'),
	('EX311', 'bodyweight'),
	('EX312', 'locomotion'),
	('EX312', 'conditioning'),
	('EX312', 'cardio'),
	('EX313', 'locomotion'),
	('EX313', 'conditioning'),
	('EX313', 'cardio'),
	('EX314', 'locomotion'),
	('EX314', 'lateral'),
	('EX314', 'warmup'),
	('EX315', 'core'),
	('EX315', 'anti-rotation'),
	('EX315', 'tabata'),
	('EX316', 'core'),
	('EX316', 'rotation'),
	('EX316', 'tabata'),
	('EX317', 'core'),
	('EX317', 'tabata'),
	('EX317', 'bodyweight'),
	('EX318', 'core'),
	('EX318', 'anti-extension'),
	('EX318', 'tabata'),
	('EX319', 'core'),
	('EX319', 'tabata'),
	('EX319', 'bodyweight'),
	('EX320', 'core'),
	('EX320', 'rotation'),
	('EX320', 'tabata'),
	('EX321', 'pull'),
	('EX321', 'horizontal'),
	('EX321', 'band'),
	('EX322', 'pull'),
	('EX322', 'shoulder-health'),
	('EX322', 'band'),
	('EX323', 'mobility'),
	('EX323', 'ankle'),
	('EX323', 'warmup'),
	('EX324', 'mobility'),
	('EX324', 'shoulder'),
	('EX324', 'warmup'),
	('EX325', 'push'),
	('EX325', 'vertical'),
	('EX325', 'unilateral'),
	('EX203', 'Bodyweight'),
	('EX203', 'Conditioning'),
	('EX203', 'Push'),
	('EX203', 'Push Vertical'),
	('EX203', 'Upper');


--
-- Data for Name: exercise_variants; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."exercise_variants" ("exercise_id", "target_exercise_id", "variant_type") VALUES
	('EX030', 'EX033', 'progression'),
	('EX033', 'EX037', 'progression'),
	('EX037', 'EX040', 'progression'),
	('EX043', 'EX044', 'progression'),
	('EX048', 'EX051', 'progression'),
	('EX051', 'EX054', 'progression'),
	('EX054', 'EX061', 'progression'),
	('EX001', 'EX003', 'progression'),
	('EX003', 'EX006', 'progression'),
	('EX006', 'EX009', 'progression'),
	('EX009', 'EX013', 'progression'),
	('EX013', 'EX016', 'progression'),
	('EX017', 'EX020', 'progression'),
	('EX020', 'EX027', 'progression'),
	('EX027', 'EX029', 'progression'),
	('EX029', 'EX203', 'progression'),
	('EX138', 'EX118', 'progression'),
	('EX118', 'EX121', 'progression'),
	('EX307', 'EX308', 'progression'),
	('EX321', 'EX062', 'progression'),
	('EX062', 'EX131', 'progression'),
	('EX131', 'EX134', 'progression'),
	('EX065', 'EX067', 'progression'),
	('EX067', 'EX070', 'progression'),
	('EX070', 'EX071', 'progression'),
	('EX071', 'EX079', 'progression'),
	('EX079', 'EX080', 'progression'),
	('EX104', 'EX107', 'progression'),
	('EX107', 'EX112', 'progression'),
	('EX112', 'EX115', 'progression'),
	('EX310', 'EX309', 'progression'),
	('EX309', 'EX115', 'progression'),
	('EX115', 'EX110', 'progression'),
	('EX110', 'EX111', 'progression'),
	('EX110', 'EX128', 'progression'),
	('EX128', 'EX127', 'progression'),
	('EX126', 'EX125', 'progression'),
	('EX081', 'EX087', 'progression'),
	('EX087', 'EX089', 'progression'),
	('EX084', 'EX090', 'progression'),
	('EX093', 'EX095', 'progression'),
	('EX095', 'EX097', 'progression'),
	('EX101', 'EX315', 'progression'),
	('EX098', 'EX320', 'progression'),
	('EX144', 'EX145', 'progression'),
	('EX145', 'EX146', 'progression'),
	('EX146', 'EX147', 'progression'),
	('EX148', 'EX150', 'progression'),
	('EX150', 'EX156', 'progression'),
	('EX156', 'EX157', 'progression'),
	('EX033', 'EX030', 'regression'),
	('EX037', 'EX033', 'regression'),
	('EX040', 'EX037', 'regression'),
	('EX044', 'EX043', 'regression'),
	('EX051', 'EX048', 'regression'),
	('EX054', 'EX051', 'regression'),
	('EX061', 'EX054', 'regression'),
	('EX003', 'EX001', 'regression'),
	('EX006', 'EX003', 'regression'),
	('EX009', 'EX006', 'regression'),
	('EX013', 'EX009', 'regression'),
	('EX016', 'EX013', 'regression'),
	('EX020', 'EX017', 'regression'),
	('EX027', 'EX020', 'regression'),
	('EX029', 'EX027', 'regression'),
	('EX203', 'EX029', 'regression'),
	('EX118', 'EX138', 'regression'),
	('EX121', 'EX118', 'regression'),
	('EX308', 'EX307', 'regression'),
	('EX062', 'EX321', 'regression'),
	('EX131', 'EX062', 'regression'),
	('EX134', 'EX131', 'regression'),
	('EX067', 'EX065', 'regression'),
	('EX070', 'EX067', 'regression'),
	('EX071', 'EX070', 'regression'),
	('EX079', 'EX071', 'regression'),
	('EX080', 'EX079', 'regression'),
	('EX107', 'EX104', 'regression'),
	('EX112', 'EX107', 'regression'),
	('EX115', 'EX112', 'regression'),
	('EX309', 'EX310', 'regression'),
	('EX115', 'EX309', 'regression'),
	('EX110', 'EX115', 'regression'),
	('EX111', 'EX110', 'regression'),
	('EX128', 'EX110', 'regression'),
	('EX127', 'EX128', 'regression'),
	('EX125', 'EX126', 'regression'),
	('EX087', 'EX081', 'regression'),
	('EX089', 'EX087', 'regression'),
	('EX090', 'EX084', 'regression'),
	('EX095', 'EX093', 'regression'),
	('EX097', 'EX095', 'regression'),
	('EX315', 'EX101', 'regression'),
	('EX320', 'EX098', 'regression'),
	('EX145', 'EX144', 'regression'),
	('EX146', 'EX145', 'regression'),
	('EX147', 'EX146', 'regression'),
	('EX150', 'EX148', 'regression'),
	('EX156', 'EX150', 'regression'),
	('EX157', 'EX156', 'regression');


--
-- Data for Name: goals; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: movement_patterns; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."movement_patterns" ("id", "name", "description") VALUES
	('P01', 'Squat', 'Flexion dominante des genoux et hanches, torse droit'),
	('P02', 'Hinge', 'Flexion dominante des hanches (charnière), genoux peu pliés'),
	('P03', 'Push Horizontal', 'Poussée devant le corps'),
	('P04', 'Push Vertical', 'Poussée au-dessus de la tête'),
	('P05', 'Pull Horizontal', 'Tirage vers le corps'),
	('P06', 'Pull Vertical', 'Tirage depuis le haut vers le corps'),
	('P07', 'Lunge', 'Fente (mouvement unilatéral asymétrique)'),
	('P08', 'Jump', 'Saut / Plyométrie / Puissance'),
	('P09', 'Core', 'Travail direct du centre du corps (flexion/isométrie)'),
	('P10', 'Anti-Rotation', 'Résister à une force de rotation'),
	('P11', 'Anti-Extension', 'Résister à l''extension du tronc'),
	('P12', 'Rotation', 'Mouvement rotatif du tronc'),
	('P13', 'Locomotion', 'Déplacement dans l''espace'),
	('P14', 'Conditioning', 'Travail métabolique à haute intensité'),
	('P15', 'Mobility', 'Amélioration de l''amplitude articulaire'),
	('P16', 'Carry', 'Transport de charge (Loaded Carry)');


--
-- Data for Name: programming_rules; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."programming_rules" ("rule_id", "description", "scope", "format", "priority", "condition_json", "action_json") VALUES
	('PRG-V1-001', 'Si un exercice dépasse le niveau technique du profil, utiliser une régression de la même chaîne de mouvement.', 'global', NULL, 100, '{"all": [{"op": "=", "field": "profile.experience", "value": "beginner"}, {"op": ">", "field": "candidate.technical_complexity", "value": 3}]}', '{"type": "use_regression", "strategy": "same_variant_chain", "require_same_movement_family": true}'),
	('PRG-V1-002', 'Ne jamais remplacer un exercice par une régression d''une autre famille technique.', 'global', NULL, 100, '{"op": "=", "field": "substitution.reason", "value": "regression"}', '{"type": "require_relation", "relation": "regression", "same_variant_chain": true}'),
	('PRG-V1-003', 'Limiter à un seul exercice à impact articulaire maximal dans un même WOD.', 'wod', NULL, 95, '{"op": ">=", "field": "candidate.joint_impact", "value": 5}', '{"type": "max_count", "count": 1, "group_by": "joint_impact_high"}'),
	('PRG-V1-004', 'Ne pas enchaîner deux mouvements à la fois très fatigants et explosifs.', 'wod', NULL, 95, '{"all": [{"op": ">=", "field": "previous.fatigue_score", "value": 4}, {"op": ">=", "field": "candidate.fatigue_score", "value": 4}, {"op": "in", "field": "previous.training_focus", "value": ["Power", "Conditioning"]}, {"op": "in", "field": "candidate.training_focus", "value": ["Power", "Conditioning"]}]}', '{"type": "forbid_adjacent"}'),
	('PRG-V1-005', 'Après un volume d''épaules lourd, éviter un mouvement en position de handstand.', 'wod', NULL, 95, '{"all": [{"op": "=", "field": "previous.body_region", "value": "Upper"}, {"op": ">=", "field": "previous.fatigue_score", "value": 4}, {"op": "=", "field": "candidate.starting_position", "value": "Handstand"}]}', '{"type": "forbid_adjacent"}'),
	('PRG-V1-010', 'Si le WOD contient du Hinge lourd, le Warm-up doit préparer le pattern Hinge.', 'warmup', NULL, 90, '{"wod": {"movement_pattern": "Hinge", "prescription_type": "reps_heavy"}}', '{"role": "mobility_or_preparation", "type": "require_pattern", "min_count": 1, "movement_pattern": "Hinge"}'),
	('PRG-V1-011', 'Si le WOD contient du Squat lourd, le Warm-up doit préparer le pattern Squat.', 'warmup', NULL, 90, '{"wod": {"movement_pattern": "Squat", "prescription_type": "reps_heavy"}}', '{"role": "mobility_or_preparation", "type": "require_pattern", "min_count": 1, "movement_pattern": "Squat"}'),
	('PRG-V1-012', 'Si le WOD contient une poussée lourde, le Warm-up doit préparer le pattern de poussée concerné.', 'warmup', NULL, 90, '{"wod": {"exercise_family": "Push", "prescription_type": "reps_heavy"}}', '{"role": "mobility_or_preparation", "type": "require_family", "min_count": 1, "exercise_family": "Push"}'),
	('PRG-V1-013', 'Si le WOD contient un tirage lourd, le Warm-up doit préparer le pattern de tirage concerné.', 'warmup', NULL, 90, '{"wod": {"exercise_family": "Pull", "prescription_type": "reps_heavy"}}', '{"role": "mobility_or_preparation", "type": "require_family", "min_count": 1, "exercise_family": "Pull"}'),
	('PRG-V1-014', 'Si le WOD contient du Lunge lourd, le Warm-up doit préparer les appuis unilatéraux.', 'warmup', NULL, 90, '{"wod": {"movement_pattern": "Lunge", "prescription_type": "reps_heavy"}}', '{"role": "mobility_or_preparation", "type": "require_pattern", "min_count": 1, "movement_pattern": "Lunge"}'),
	('PRG-V1-015', 'Si le WOD contient des sauts, le Warm-up doit inclure une préparation progressive des appuis et réceptions.', 'warmup', NULL, 90, '{"wod": {"movement_pattern": "Jump"}}', '{"role": "low_impact_preparation", "type": "require_pattern", "min_count": 1, "max_joint_impact": 3, "movement_pattern": "Jump"}'),
	('PRG-V1-020', 'Le Tabata UGEROD V1 utilise uniquement des exercices explicitement éligibles au Tabata.', 'tabata', 'TABATA', 100, '{"op": "=", "field": "candidate.tabata_eligible", "value": true}', '{"type": "require"}'),
	('PRG-V1-021', 'Le Tabata UGEROD V1 cible le Core.', 'tabata', 'TABATA', 100, '{"op": "=", "field": "candidate.body_region", "value": "Core"}', '{"type": "require"}'),
	('PRG-V1-022', 'Éviter de sélectionner deux exercices Tabata ayant exactement le même mouvement_pattern lorsque plusieurs options valides existent.', 'tabata', 'TABATA', 70, '{"op": ">", "field": "block.valid_candidate_count", "value": 2}', '{"type": "prefer_pattern_variety"}'),
	('PRG-V1-030', 'Le Skill doit préparer ou renforcer le pattern principal du WOD du jour.', 'skill', NULL, 90, '{"op": "is_not_null", "field": "wod.primary_movement_pattern"}', '{"type": "prefer_same_pattern", "source": "wod.primary_movement_pattern"}'),
	('PRG-V1-031', 'Pour un débutant, le Skill ne doit pas imposer un exercice de complexité technique supérieure à 3 sans régression disponible.', 'skill', NULL, 95, '{"all": [{"op": "=", "field": "profile.experience", "value": "beginner"}, {"op": ">", "field": "candidate.technical_complexity", "value": 3}]}', '{"type": "use_regression", "strategy": "same_variant_chain"}'),
	('PRG-V1-040', 'Favoriser l''équilibre Push/Pull lorsqu''un WOD contient des mouvements du haut du corps.', 'wod', NULL, 70, '{"op": "=", "field": "block.has_upper_body", "value": true}', '{"left": {"exercise_family": "Push"}, "type": "target_ratio", "favor": "Pull", "ratio": ["1:1", "1:2"], "right": {"exercise_family": "Pull"}}'),
	('PRG-V1-041', 'Favoriser l''alternance Haut/Bas pour limiter la fatigue locale lorsque le format le permet.', 'wod', NULL, 65, '{"op": ">=", "field": "block.exercise_count", "value": 3}', '{"type": "prefer_alternation", "field": "body_region", "values": ["Upper", "Lower"]}'),
	('PRG-V1-042', 'Limiter à un seul mouvement de saut/pliométrie par WOD, sauf format explicitement centré sur le saut.', 'wod', NULL, 90, '{"op": "=", "field": "candidate.movement_pattern", "value": "Jump"}', '{"type": "max_count", "count": 1, "group_by": "movement_pattern:Jump"}'),
	('PRG-V1-043', 'Éviter deux mouvements très techniques dans le même WOD court.', 'wod', NULL, 85, '{"op": ">=", "field": "candidate.technical_complexity", "value": 4}', '{"type": "max_count", "count": 1, "group_by": "technical_complexity_high", "when_planned_duration_lte": 20}'),
	('PRG-V1-050', 'Dans un AMRAP, exclure les exercices dont le coût de transition est supérieur à 3.', 'wod', 'AMRAP', 95, '{"op": ">", "field": "candidate.transition_cost", "value": 3}', '{"type": "exclude_candidate"}'),
	('PRG-V1-051', 'Dans un AMRAP, privilégier des mouvements techniquement simples à modérés pour maintenir la qualité sous fatigue.', 'wod', 'AMRAP', 80, '{"op": ">", "field": "candidate.technical_complexity", "value": 3}', '{"type": "deprioritize"}'),
	('PRG-V1-060', 'Dans un EMOM, limiter à un seul mouvement de complexité technique élevée.', 'wod', 'EMOM', 95, '{"op": ">=", "field": "candidate.technical_complexity", "value": 4}', '{"type": "max_count", "count": 1, "group_by": "technical_complexity_high"}'),
	('PRG-V1-061', 'Dans un EMOM, ne pas cumuler plusieurs exercices à fatigue maximale dans le même cycle.', 'wod', 'EMOM', 90, '{"op": ">=", "field": "candidate.fatigue_score", "value": 5}', '{"type": "max_count", "count": 1, "group_by": "fatigue_max"}'),
	('PRG-V1-070', 'Dans un For Time, éviter de cumuler Hinge très fatigant et Jump très fatigant dans le même enchaînement.', 'wod', 'FOR_TIME', 90, '{"pair": [{"movement_pattern": "Hinge", "fatigue_score_gte": 5}, {"movement_pattern": "Jump", "fatigue_score_gte": 5}]}', '{"type": "forbid_pair"}'),
	('PRG-V1-080', 'Dans un circuit, éviter deux exercices consécutifs dominants sur la même zone corporelle lorsque des alternatives existent.', 'wod', 'CIRCUIT', 75, '{"op": ">", "field": "block.valid_candidate_count", "value": 3}', '{"type": "prefer_non_adjacent_same_body_region"}'),
	('PRG-V1-090', 'Pour un objectif Strength, privilégier le format STRENGTH pour les mouvements lourds plutôt qu''un AMRAP ou un Tabata.', 'global', NULL, 90, '{"all": [{"op": "=", "field": "profile.objective", "value": "strength"}, {"op": "=", "field": "candidate.prescription_type", "value": "reps_heavy"}]}', '{"type": "prefer_format", "formats": ["STRENGTH"], "avoid_formats": ["AMRAP", "TABATA"]}'),
	('PRG-V1-100', 'Avec une readiness basse, réduire la complexité technique et la fatigue maximale du WOD.', 'global', NULL, 95, '{"op": "<=", "field": "session.readiness", "value": 4}', '{"type": "apply_caps", "fatigue_score_max": 4, "technical_complexity_max": 3}');


--
-- Data for Name: workout_focus; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."workout_focus" ("focus_name", "description") VALUES
	('Fat Loss', 'Maximiser la dépense calorique'),
	('Muscle Gain', 'Hypertrophie et volume'),
	('Strength', 'Force brute et recrutement neurologique'),
	('Power', 'Explosivité et vitesse'),
	('Conditioning', 'Endurance cardio-vasculaire'),
	('Mobility', 'Souplesse et amplitude articulaire'),
	('Recovery', 'Récupération active'),
	('Skill Development', 'Apprentissage technique (Gymnastics/Haltéro)'),
	('General Fitness', 'Santé globale (GPP)');


--
-- Data for Name: workout_formats; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: workout_templates; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."workout_templates" ("template_name", "description", "duration_range", "movements_count", "rules") VALUES
	('EMOM', 'Every Minute on the Minute', '10-20 min', '1-4', 'Volume calibré pour max 45s de travail par minute.'),
	('AMRAP', 'As Many Rounds As Possible', '5-20 min', '2-5', 'Maintenir une intensité constante, pas de goulot musculaire.'),
	('FOR TIME', 'Terminer le travail le plus vite possible', '10-30 min', '3-6', 'Volume fixe, intensité max, prioriser mouvements maîtrisés.'),
	('HIIT', 'High Intensity Interval Training', '10-20 min', '4-8', 'Ratios de type 30s/30s ou 40s/20s.'),
	('INTERVAL', 'Intervalles longs', '15-30 min', '3-5', 'Ratios de type 2 min / 1 min repos, axé Aerobic/Glycolytic.'),
	('CHIPPER', 'Grosse liste d''exercices à faire 1 fois', '15-25 min', '5-10', 'Uniquement 1 seul tour, haut volume par mouvement.'),
	('LADDER', 'Échelle montante ou descendante', '10-15 min', '2-3', 'Répétitions croissantes (1-2-3...) ou décroissantes (10-9-8...).'),
	('STRENGTH', 'Renforcement lourd', '15-30 min', '2-4', 'Temps de repos obligatoires > 1min30, séries courtes.'),
	('TABATA', 'Intervalles très courts', '4 min', '1-2', '20s travail / 10s repos sur 8 tours.');


--
-- Name: block_rules_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('"public"."block_rules_id_seq"', 9, true);


--
-- Name: equipment_profiles_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('"public"."equipment_profiles_id_seq"', 4, true);


--
-- Name: exercise_constraints_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('"public"."exercise_constraints_id_seq"', 16, true);


--
-- PostgreSQL database dump complete
--

-- \unrestrict OQ5jVmvIeY6LX3UjVAvhteT8XYEXYNm9808WB0g6x913t9eaWiiKPdQGAvkKCGC

RESET ALL;
