delete from public.equipment_locations where equipment_id between 'E01' and 'E30';

insert into public.equipment_locations (equipment_id, location_key, display_order) values
-- HOME: objets courants + petit matériel fréquemment utilisé à domicile
('E01','HOME',10),('E02','HOME',20),('E03','HOME',30),('E04','HOME',40),('E05','HOME',50),('E06','HOME',60),('E07','HOME',70),('E11','HOME',80),('E12','HOME',90),('E20','HOME',100),('E21','HOME',110),
-- OUTDOOR: équipement réellement rencontré/utilisé naturellement dehors
('E02','OUTDOOR',10),('E05','OUTDOOR',20),('E06','OUTDOOR',30),('E07','OUTDOOR',40),('E08','OUTDOOR',50),('E13','OUTDOOR',60),('E21','OUTDOOR',70),
-- GARAGE / HOME GYM: équipement sportif personnel dédié
('E01','GARAGE',10),('E02','GARAGE',20),('E03','GARAGE',30),('E04','GARAGE',40),('E05','GARAGE',50),('E06','GARAGE',60),('E07','GARAGE',70),('E08','GARAGE',80),('E09','GARAGE',90),('E10','GARAGE',100),('E11','GARAGE',110),('E12','GARAGE',120),('E13','GARAGE',130),('E14','GARAGE',140),('E15','GARAGE',150),('E16','GARAGE',160),('E17','GARAGE',170),('E18','GARAGE',180),('E19','GARAGE',190),('E22','GARAGE',200),('E23','GARAGE',210),('E25','GARAGE',220),('E26','GARAGE',230),('E27','GARAGE',240),('E28','GARAGE',250),('E29','GARAGE',260),('E30','GARAGE',270),
-- GYM / BOX: équipement collectif / professionnel
('E01','GYM_BOX',10),('E02','GYM_BOX',20),('E03','GYM_BOX',30),('E04','GYM_BOX',40),('E05','GYM_BOX',50),('E06','GYM_BOX',60),('E07','GYM_BOX',70),('E08','GYM_BOX',80),('E09','GYM_BOX',90),('E10','GYM_BOX',100),('E11','GYM_BOX',110),('E12','GYM_BOX',120),('E13','GYM_BOX',130),('E14','GYM_BOX',140),('E15','GYM_BOX',150),('E16','GYM_BOX',160),('E17','GYM_BOX',170),('E18','GYM_BOX',180),('E19','GYM_BOX',190),('E22','GYM_BOX',200),('E23','GYM_BOX',210),('E24','GYM_BOX',220),('E25','GYM_BOX',230),('E26','GYM_BOX',240),('E27','GYM_BOX',250),('E28','GYM_BOX',260),('E29','GYM_BOX',270),('E30','GYM_BOX',280);
