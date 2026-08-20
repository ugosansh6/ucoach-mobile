create table if not exists public.equipment_locations (
  equipment_id varchar not null references public.equipment(id) on delete cascade,
  location_key text not null check (location_key in ('HOME','OUTDOOR','GARAGE','GYM_BOX')),
  display_order smallint not null default 100,
  primary key (equipment_id, location_key)
);

alter table public.equipment_locations enable row level security;
drop policy if exists equipment_locations_read_catalog on public.equipment_locations;
create policy equipment_locations_read_catalog on public.equipment_locations for select to anon, authenticated using (true);
grant select on public.equipment_locations to anon, authenticated;
revoke insert, update, delete on public.equipment_locations from anon, authenticated;

insert into public.equipment(id,name,category,description) values
 ('E20','Chaise / support stable','Support','Chaise solide ou support stable pour pompes inclinées, dips et exercices unilatéraux.'),
 ('E21','Escalier / marche','Support','Marche ou escalier stable utilisable pour step-ups et préparation des membres inférieurs.'),
 ('E22','Anneaux de gymnastique','Suspension','Paire d’anneaux suspendus pour tirages, supports et mouvements de gymnastique.'),
 ('E23','SkiErg','Cardio','Ergomètre de ski type Concept2 SkiErg ou équivalent.'),
 ('E24','Sled / traîneau','Conditioning','Traîneau de poussée ou de tirage avec zone de déplacement dégagée.'),
 ('E25','Sandbag','Poids libre','Sac lesté pour portés, squats et travail fonctionnel.'),
 ('E26','Battle Rope','Cardio','Corde ondulatoire ancrée pour intervalles de conditioning.'),
 ('E27','Tapis de course','Cardio','Tapis motorisé pour course ou marche rapide en intérieur.'),
 ('E28','Poulie / Cable machine','Machine','Station à poulie haute ou basse pour tirages et poussées guidées.'),
 ('E29','Gilet lesté','Lest','Gilet de charge porté sur le tronc pour marche et mouvements au poids du corps.'),
 ('E30','Slam Ball','Poids libre','Ballon lesté conçu pour être projeté au sol de manière répétée.')
on conflict(id) do update set name=excluded.name,category=excluded.category,description=excluded.description;

with seed(equipment_id,locations,display_order) as (values
 ('E01',array['HOME','OUTDOOR','GARAGE','GYM_BOX']::text[],10),
 ('E02',array['HOME','OUTDOOR','GARAGE','GYM_BOX']::text[],20),
 ('E03',array['HOME','OUTDOOR','GARAGE','GYM_BOX']::text[],30),
 ('E04',array['HOME','OUTDOOR','GARAGE','GYM_BOX']::text[],40),
 ('E05',array['HOME','OUTDOOR','GARAGE','GYM_BOX']::text[],50),
 ('E06',array['HOME','OUTDOOR','GARAGE','GYM_BOX']::text[],60),
 ('E07',array['HOME','OUTDOOR','GARAGE','GYM_BOX']::text[],70),
 ('E08',array['HOME','OUTDOOR','GARAGE','GYM_BOX']::text[],80),
 ('E09',array['HOME','OUTDOOR','GARAGE','GYM_BOX']::text[],90),
 ('E10',array['HOME','OUTDOOR','GARAGE','GYM_BOX']::text[],100),
 ('E11',array['HOME','OUTDOOR','GARAGE','GYM_BOX']::text[],110),
 ('E12',array['HOME','GARAGE','GYM_BOX']::text[],120),
 ('E13',array['HOME','OUTDOOR','GARAGE','GYM_BOX']::text[],130),
 ('E14',array['HOME','GARAGE','GYM_BOX']::text[],140),
 ('E15',array['HOME','GARAGE','GYM_BOX']::text[],150),
 ('E16',array['HOME','GARAGE','GYM_BOX']::text[],160),
 ('E17',array['HOME','GARAGE','GYM_BOX']::text[],170),
 ('E18',array['HOME','GARAGE','GYM_BOX']::text[],180),
 ('E19',array['HOME','OUTDOOR','GARAGE','GYM_BOX']::text[],190),
 ('E20',array['HOME','GARAGE']::text[],15),
 ('E21',array['HOME','OUTDOOR','GARAGE','GYM_BOX']::text[],25),
 ('E22',array['HOME','OUTDOOR','GARAGE','GYM_BOX']::text[],75),
 ('E23',array['GARAGE','GYM_BOX']::text[],155),
 ('E24',array['OUTDOOR','GARAGE','GYM_BOX']::text[],165),
 ('E25',array['HOME','OUTDOOR','GARAGE','GYM_BOX']::text[],95),
 ('E26',array['OUTDOOR','GARAGE','GYM_BOX']::text[],175),
 ('E27',array['HOME','GARAGE','GYM_BOX']::text[],185),
 ('E28',array['GARAGE','GYM_BOX']::text[],195),
 ('E29',array['HOME','OUTDOOR','GARAGE','GYM_BOX']::text[],105),
 ('E30',array['HOME','OUTDOOR','GARAGE','GYM_BOX']::text[],115)
)
insert into public.equipment_locations(equipment_id,location_key,display_order)
select s.equipment_id,l.location_key,s.display_order
from seed s cross join lateral unnest(s.locations) as l(location_key)
on conflict(equipment_id,location_key) do update set display_order=excluded.display_order;

insert into public.exercise_equipment_requirements_v2(exercise_id,option_group,equipment_id,min_quantity,is_optional,notes) values
 ('EX003',4,'E20',1,false,'Stable chair/support is a valid incline push-up surface.'),
 ('EX024',2,'E20',1,false,'Stable chair/support is a valid bench-dip support.'),
 ('EX057',2,'E20',1,false,'Stable chair/support is a valid rear-foot support for Bulgarian split squat.'),
 ('EX107',3,'E03',1,false,'Dumbbell required for chair-supported DB hip thrust.'),
 ('EX107',3,'E20',1,false,'Stable chair/support may replace bench or box for DB hip thrust.')
on conflict do nothing;

create temporary table _equipment_exercise_clone_map(new_id text primary key,source_id text not null) on commit drop;
insert into _equipment_exercise_clone_map(new_id,source_id) values
 ('EX504','EX062'),('EX505','EX470'),('EX506','EX501'),('EX507','EX306'),('EX508','EX301'),
 ('EX509','EX301'),('EX510','EX037'),('EX511','EX306'),('EX512','EX313'),('EX513','EX321'),
 ('EX514','EX067'),('EX515','EX307'),('EX516','EX301'),('EX517','EX153'),('EX518','EXW008'),
 ('EX519','EX425'),('EX520','EX425'),('EX521','EX436'),('EX522','EX306');

with spec(new_id,patch) as (values
 ('EX504',jsonb_build_object('name','Ring Row','display_name','Ring Row','description','Tirage horizontal aux anneaux avec le corps gainé.','instructions','1. Place les anneaux à hauteur adaptée.\n2. Garde le corps gainé et tire la poitrine vers les anneaux.\n3. Redescends sous contrôle sans casser l’alignement.','tips','Plus tu places les pieds loin sous le point d’ancrage, plus le mouvement devient difficile.','equipment_requirement','required')),
 ('EX505',jsonb_build_object('name','Ring Support Hold','display_name','Support aux anneaux','description','Maintien bras tendus en appui sur anneaux avec épaules basses et tronc gainé.','instructions','1. Monte en appui bras tendus sur les anneaux.\n2. Stabilise les anneaux près du corps et abaisse les épaules.\n3. Tiens la position sans laisser les coudes se plier.','tips','Commence par des maintiens courts et propres.','equipment_requirement','required')),
 ('EX506',jsonb_build_object('name','SkiErg','display_name','SkiErg','description','Effort cardio sur SkiErg, prescrit en distance ou en temps.','instructions','1. Démarre bras hauts avec le tronc grand.\n2. Tire les poignées vers le bas en engageant le tronc et les bras.\n3. Reviens fluide et garde une cadence adaptée au bloc.','tips','Cherche une cadence régulière plutôt qu’un départ trop violent.','equipment_requirement','required','home_friendly',false)),
 ('EX507',jsonb_build_object('name','Sled Push','display_name','Poussée de traîneau','description','Pousse un traîneau sur une distance définie avec le tronc gainé.','instructions','1. Place les mains sur les montants et incline légèrement le corps.\n2. Pousse le sol derrière toi avec des pas courts et puissants.\n3. Maintiens le bassin et le tronc stables jusqu’à la distance cible.','tips','Charge modérément pour conserver une poussée continue et propre.','movement_pattern','Locomotion','exercise_family','Conditioning','body_region','Full Body','training_focus','Conditioning','equipment_requirement','required','fatigue_score',5,'cardio_score',5,'joint_impact',2,'technical_complexity',2,'prescription_type','distance','tracking_modes',jsonb_build_array('distance','time'),'home_friendly',false)),
 ('EX508',jsonb_build_object('name','Backward Sled Drag','display_name','Traîneau en marche arrière','description','Tire le traîneau en reculant pour solliciter les jambes avec une faible composante d’impact.','instructions','1. Saisis les sangles ou poignées et recule jusqu’à mettre la tension.\n2. Marche en arrière par petits pas continus.\n3. Garde le buste haut et les genoux alignés avec les pieds.','tips','Privilégie une charge qui permet de rester en mouvement sans à-coups.','movement_pattern','Locomotion','exercise_family','Conditioning','body_region','Lower','training_focus','Strength','equipment_requirement','required','fatigue_score',4,'cardio_score',3,'joint_impact',1,'technical_complexity',2,'prescription_type','distance','tracking_modes',jsonb_build_array('distance','time'),'home_friendly',false)),
 ('EX509',jsonb_build_object('name','Sandbag Bear Hug Carry','display_name','Porté Sandbag','description','Porte le sandbag contre le torse sur une distance définie.','instructions','1. Serre le sac contre le torse avec les avant-bras.\n2. Marche avec des pas réguliers en gardant le buste stable.\n3. Respire sous contrôle jusqu’à la distance cible.','tips','Ne laisse pas le sac tirer le haut du dos vers l’avant.','equipment_requirement','required','prescription_type','distance','tracking_modes',jsonb_build_array('distance','time'),'home_friendly',true)),
 ('EX510',jsonb_build_object('name','Sandbag Front Squat','display_name','Front Squat Sandbag','description','Squat avec sandbag tenu contre le haut du torse.','instructions','1. Place le sandbag haut contre le torse.\n2. Descends en squat en gardant les genoux dans l’axe.\n3. Remonte en poussant le sol sans perdre le gainage.','tips','Garde le sac proche du corps pour limiter la flexion du dos.','equipment_requirement','required','tracking_modes',jsonb_build_array('reps'),'home_friendly',true)),
 ('EX511',jsonb_build_object('name','Battle Rope Alternating Waves','display_name','Battle Rope','description','Ondulations alternées rapides avec une corde lourde ancrée.','instructions','1. Tiens une extrémité dans chaque main, genoux légèrement fléchis.\n2. Alterne rapidement les bras pour créer des vagues régulières.\n3. Garde le tronc stable pendant toute la durée.','tips','Réduis l’amplitude avant de perdre la posture.','equipment_requirement','required','prescription_type','time','tracking_modes',jsonb_build_array('time'),'home_friendly',false)),
 ('EX512',jsonb_build_object('name','Course sur tapis','display_name','Course sur tapis','description','Course sur tapis motorisé à l’allure demandée.','instructions','1. Monte progressivement à la vitesse cible.\n2. Garde une foulée régulière et le regard devant toi.\n3. Ajuste l’allure pour tenir la durée ou la distance prévue.','tips','N’utilise pas les poignées sauf nécessité de sécurité.','equipment_requirement','required','home_friendly',true)),
 ('EX513',jsonb_build_object('name','Cable Row','display_name','Tirage poulie basse','description','Tirage horizontal à la poulie en gardant le buste stable.','instructions','1. Place-toi face à la poulie avec le tronc gainé.\n2. Tire la poignée vers le bas des côtes.\n3. Reviens lentement sans laisser les épaules partir vers l’avant.','tips','Initie le mouvement avec les omoplates plutôt qu’avec les bras.','equipment_requirement','required','home_friendly',false,'tracking_modes',jsonb_build_array('reps'))),
 ('EX514',jsonb_build_object('name','Lat Pulldown','display_name','Tirage vertical poulie','description','Tirage vertical à la poulie vers le haut de la poitrine.','instructions','1. Assieds-toi stable et saisis la barre au-dessus de la tête.\n2. Tire les coudes vers le bas jusqu’à amener la barre vers le haut de la poitrine.\n3. Remonte sous contrôle sans hausser les épaules.','tips','Évite de transformer le mouvement en tirage avec un grand balancement du buste.','equipment_requirement','required','home_friendly',false,'tracking_modes',jsonb_build_array('reps'))),
 ('EX515',jsonb_build_object('name','Cable Chest Press','display_name','Développé poitrine poulie','description','Poussée horizontale à la poulie avec contrôle du tronc.','instructions','1. Place-toi entre ou devant les poulies, poignées près de la poitrine.\n2. Pousse devant toi sans laisser le bas du dos se creuser.\n3. Reviens lentement jusqu’à la position de départ.','tips','Garde les épaules basses et les côtes contrôlées.','equipment_requirement','required','home_friendly',false,'tracking_modes',jsonb_build_array('reps'))),
 ('EX516',jsonb_build_object('name','Marche avec gilet lesté','display_name','Marche lestée','description','Marche soutenue avec un gilet lesté en conservant une posture naturelle.','instructions','1. Ajuste le gilet près du corps.\n2. Marche à une allure régulière sans modifier excessivement ta foulée.\n3. Garde le tronc haut et arrête si la charge dégrade la posture.','tips','Le gilet doit rester stable et ne pas rebondir.','movement_pattern','Locomotion','exercise_family','Carry','body_region','Full Body','training_focus','Conditioning','equipment_requirement','required','fatigue_score',3,'cardio_score',3,'joint_impact',2,'technical_complexity',1,'prescription_type','distance','tracking_modes',jsonb_build_array('distance','time'),'home_friendly',true)),
 ('EX517',jsonb_build_object('name','Step-up sur marche','display_name','Step-up','description','Monte sur une marche ou un step stable en contrôlant la poussée de la jambe d’appui.','instructions','1. Pose entièrement un pied sur le support.\n2. Pousse dans la jambe d’appui pour monter.\n3. Redescends sous contrôle puis alterne selon la prescription.','tips','Choisis une hauteur qui permet de garder le genou stable.','equipment_requirement','required')),
 ('EX518',jsonb_build_object('name','Step-up sur marche — préparation','display_name','Préparation Step-up','description','Step-ups faciles sur marche basse pour préparer les jambes au travail principal.','instructions','Monte et redescends d’une marche basse à rythme facile, en contrôlant l’alignement du genou.','tips','Reste très loin de la fatigue : c’est une préparation.','equipment_requirement','required')),
 ('EX519',jsonb_build_object('name','Foam Roll mollets','display_name','Foam Roll mollets','description','Auto-massage léger des mollets au foam roller avant la séance.','instructions','Place le mollet sur le rouleau et effectue des passages lents sur une amplitude confortable.','tips','Évite de rester longtemps sur une zone très douloureuse.','exercise_family','Mobility','movement_pattern','Mobility','body_region','Lower','training_focus','Mobility','equipment_requirement','required','fatigue_score',1,'cardio_score',1,'joint_impact',1,'technical_complexity',1,'usable_for',jsonb_build_array('Warm-up'),'warmup_eligible',true,'warmup_role','mobility','warmup_only',true,'prescription_type','time','tracking_modes',jsonb_build_array('time'),'home_friendly',true)),
 ('EX520',jsonb_build_object('name','Foam Roll quadriceps','display_name','Foam Roll quadriceps','description','Auto-massage léger de la face antérieure de la cuisse au foam roller.','instructions','Place le rouleau sous la cuisse et effectue des passages lents sans chercher une douleur forte.','tips','Garde une pression modérée avant l’entraînement.','exercise_family','Mobility','movement_pattern','Mobility','body_region','Lower','training_focus','Mobility','equipment_requirement','required','fatigue_score',1,'cardio_score',1,'joint_impact',1,'technical_complexity',1,'usable_for',jsonb_build_array('Warm-up'),'warmup_eligible',true,'warmup_role','mobility','warmup_only',true,'prescription_type','time','tracking_modes',jsonb_build_array('time'),'home_friendly',true)),
 ('EX521',jsonb_build_object('name','Mobilité épaules à l’espalier','display_name','Mobilité épaules espalier','description','Mobilisation douce des épaules avec les mains posées sur un espalier stable.','instructions','1. Pose les mains sur un barreau à hauteur confortable.\n2. Recule le bassin et laisse le buste descendre entre les bras.\n3. Reviens doucement sans forcer l’amplitude.','tips','Garde les côtes contrôlées et ne cherche pas une amplitude douloureuse.','equipment_requirement','required','warmup_eligible',true,'warmup_role','mobility','warmup_only',true,'usable_for',jsonb_build_array('Warm-up'),'tracking_modes',jsonb_build_array('time'))),
 ('EX522',jsonb_build_object('name','Slam Ball','display_name','Slam Ball','description','Monte le slam ball au-dessus de la tête puis projette-le puissamment vers le sol.','instructions','1. Monte le ballon au-dessus de la tête.\n2. Engage le tronc et projette-le vers le sol.\n3. Récupère-le avec une posture stable avant de recommencer.','tips','Utilise le tronc et les hanches, pas seulement les bras.','equipment_requirement','required'))
)
insert into public.exercises
select (jsonb_populate_record(null::public.exercises,
  to_jsonb(src)||s.patch||jsonb_build_object('id',s.new_id,'image_path',null,'notes','equipment-catalog-v1','created_at',now())
)).*
from spec s join _equipment_exercise_clone_map m on m.new_id=s.new_id join public.exercises src on src.id=m.source_id
on conflict(id) do nothing;

insert into public.exercise_muscles(exercise_id,muscle_id,priority)
select m.new_id,x.muscle_id,x.priority from _equipment_exercise_clone_map m join public.exercise_muscles x on x.exercise_id=m.source_id
on conflict do nothing;
insert into public.exercise_muscles(exercise_id,muscle_id,priority) values ('EX506','M02','secondary'),('EX506','M10','secondary') on conflict do nothing;

insert into public.exercise_tags(exercise_id,tag)
select m.new_id,x.tag from _equipment_exercise_clone_map m join public.exercise_tags x on x.exercise_id=m.source_id
on conflict do nothing;
insert into public.exercise_tags(exercise_id,tag) values
 ('EX504','rings'),('EX505','rings'),('EX506','skierg'),('EX507','sled'),('EX508','sled'),('EX509','sandbag'),('EX510','sandbag'),
 ('EX511','battle_rope'),('EX512','treadmill'),('EX513','cable_machine'),('EX514','cable_machine'),('EX515','cable_machine'),
 ('EX516','weighted_vest'),('EX517','step'),('EX518','step'),('EX519','foam_roller'),('EX520','foam_roller'),('EX521','espalier'),('EX522','slam_ball')
on conflict do nothing;

insert into public.exercise_body_zones(exercise_id,body_zone_id,involvement,source,notes)
select m.new_id,z.body_zone_id,z.involvement,z.source,z.notes
from _equipment_exercise_clone_map m join public.exercise_body_zones z on z.exercise_id=m.source_id
on conflict do nothing;

insert into public.exercise_constraints(exercise_id,constraint_name,reason,priority,body_zone,rule_type,severity)
select m.new_id,x.constraint_name,x.reason,x.priority,x.body_zone,x.rule_type,x.severity
from _equipment_exercise_clone_map m join public.exercise_constraints x on x.exercise_id=m.source_id
where not exists (select 1 from public.exercise_constraints y where y.exercise_id=m.new_id and y.constraint_name=x.constraint_name and coalesce(y.body_zone,'')=coalesce(x.body_zone,''));

insert into public.exercise_context_constraints(exercise_id,context_key,context_kind,description,is_environmental,is_equipment) values
 ('EX504','anchor_point','environment','Les anneaux nécessitent un point d’ancrage sécurisé.',true,false),
 ('EX505','anchor_point','environment','Les anneaux nécessitent un point d’ancrage sécurisé.',true,false),
 ('EX507','travel_lane','environment','Le sled nécessite une zone de déplacement dégagée.',true,false),
 ('EX508','travel_lane','environment','Le sled nécessite une zone de déplacement dégagée.',true,false),
 ('EX509','travel_lane','environment','Le porté Sandbag nécessite une zone de déplacement dégagée.',true,false),
 ('EX511','anchor_point','environment','La Battle Rope nécessite un point d’ancrage sécurisé et de l’espace libre.',true,false),
 ('EX516','travel_lane','environment','La marche lestée nécessite une zone de déplacement dégagée.',true,false),
 ('EX517','elevated_surface','environment','Le Step-up nécessite une marche ou un step stable.',true,false),
 ('EX518','elevated_surface','environment','La préparation Step-up nécessite une marche ou un step stable.',true,false)
on conflict do nothing;

insert into public.exercise_equipment_requirements_v2(exercise_id,option_group,equipment_id,min_quantity,is_optional,notes) values
 ('EX504',1,'E22',1,false,'Gymnastic rings required.'),('EX505',1,'E22',1,false,'Gymnastic rings required.'),
 ('EX506',1,'E23',1,false,'SkiErg required.'),('EX507',1,'E24',1,false,'Sled required.'),('EX508',1,'E24',1,false,'Sled required.'),
 ('EX509',1,'E25',1,false,'Sandbag required.'),('EX510',1,'E25',1,false,'Sandbag required.'),('EX511',1,'E26',1,false,'Battle Rope required.'),
 ('EX512',1,'E27',1,false,'Treadmill required.'),('EX513',1,'E28',1,false,'Cable station required.'),('EX514',1,'E28',1,false,'Cable station required.'),
 ('EX515',1,'E28',1,false,'Cable station required.'),('EX516',1,'E29',1,false,'Weighted vest required.'),
 ('EX517',1,'E11',1,false,'Fitness step is valid.'),('EX517',2,'E21',1,false,'Stair/step is valid.'),
 ('EX518',1,'E11',1,false,'Fitness step is valid.'),('EX518',2,'E21',1,false,'Stair/step is valid.'),
 ('EX519',1,'E12',1,false,'Foam roller required.'),('EX520',1,'E12',1,false,'Foam roller required.'),
 ('EX521',1,'E18',1,false,'Espalier required.'),('EX522',1,'E30',1,false,'Slam Ball required.')
on conflict do nothing;

insert into public.exercise_equipment(exercise_id,equipment_id) values
 ('EX504','E22'),('EX505','E22'),('EX506','E23'),('EX507','E24'),('EX508','E24'),('EX509','E25'),('EX510','E25'),('EX511','E26'),
 ('EX512','E27'),('EX513','E28'),('EX514','E28'),('EX515','E28'),('EX516','E29'),('EX519','E12'),('EX520','E12'),('EX521','E18'),('EX522','E30')
on conflict do nothing;

create or replace view public.equipment_catalog_v2 with (security_invoker=true) as
select e.id,e.name,e.category,e.description,
 coalesce((select array_agg(l.location_key order by case l.location_key when 'HOME' then 1 when 'OUTDOOR' then 2 when 'GARAGE' then 3 when 'GYM_BOX' then 4 else 9 end,l.display_order) from public.equipment_locations l where l.equipment_id=e.id),'{}'::text[]) as locations,
 (select count(distinct req.exercise_id)::int from public.exercise_equipment_requirements_v2 req where req.equipment_id=e.id) as exercise_count
from public.equipment e
where e.id<>'E00' and exists(select 1 from public.exercise_equipment_requirements_v2 req where req.equipment_id=e.id);

grant select on public.equipment_catalog_v2 to anon, authenticated;
