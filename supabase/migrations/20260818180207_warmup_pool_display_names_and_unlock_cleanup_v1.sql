update public.exercises
set display_name=case id
  when 'EX411' then 'Tractions scapulaires'
  when 'EX427' then 'Squat dynamique'
  when 'EX428' then 'Squat latéral assisté'
  when 'EX429' then 'Bascule de hanches au mur'
  when 'EX442' then 'Marche sur place'
  when 'EX443' then 'Step Jacks sans saut'
  when 'EXW003' then 'Squat + bras hauts'
  when 'EXW004' then 'Petits rebonds'
  when 'EXW008' then 'Step-ups faciles'
  when 'EXW009' then 'Tirage haut technique'
  when 'EXW013' then 'Mobilité poignets à 4 pattes'
  when 'EXW014' then 'Appuis poignets'
  when 'EXW017' then 'Good Morning'
  when 'EXW018' then 'Hinge 1 jambe'
  when 'EXW020' then 'Fentes latérales'
  when 'EXW021' then 'Air Squats tempo'
  when 'EXW022' then 'Réception athlétique'
  when 'EXW023' then 'Pas patineur latéraux'
  when 'EXW024' then 'Bear Plank dynamique'
  when 'EXW026' then 'Marche bras au-dessus'
  else display_name end
where id in ('EX411','EX427','EX428','EX429','EX442','EX443','EXW003','EXW004','EXW008','EXW009','EXW013','EXW014','EXW017','EXW018','EXW020','EXW021','EXW022','EXW023','EXW024','EXW026');

update public.exercises
set warmup_role='mobility'
where id in ('EXW013','EXW014');