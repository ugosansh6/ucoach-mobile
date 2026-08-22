-- Skill Curriculum V1 — catalogue and pedagogical paths.
-- Skill teaches; WOD remains a separate consumer of mastered/scaled movements.

create table if not exists public.skill_curriculum_paths_v1 (
  path_key text primary key references public.skill_paths(path_key) on delete cascade,
  terminal_goal text not null,
  source_type text not null,
  source_urls text[] not null default '{}'::text[],
  confidence text not null check (confidence in ('HAUTE','MOYENNE','FAIBLE')),
  active boolean not null default true,
  version text not null default 'skill-curriculum-v1',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.skill_curriculum_steps_v1 (
  path_key text not null references public.skill_paths(path_key) on delete cascade,
  exercise_id text not null references public.exercises(id) on delete cascade,
  step_order integer not null,
  member_role text not null,
  branch_key text not null,
  pedagogical_stage text not null,
  active boolean not null default true,
  version text not null default 'skill-curriculum-v1',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(path_key,exercise_id)
);

alter table public.skill_curriculum_paths_v1 enable row level security;
alter table public.skill_curriculum_steps_v1 enable row level security;

drop policy if exists skill_curriculum_paths_v1_authenticated_select on public.skill_curriculum_paths_v1;
create policy skill_curriculum_paths_v1_authenticated_select
on public.skill_curriculum_paths_v1 for select to authenticated using(true);

drop policy if exists skill_curriculum_steps_v1_authenticated_select on public.skill_curriculum_steps_v1;
create policy skill_curriculum_steps_v1_authenticated_select
on public.skill_curriculum_steps_v1 for select to authenticated using(true);

insert into public.skill_curriculum_paths_v1(path_key,terminal_goal,source_type,source_urls,confidence)
values
('BARBELL_CLEAN_JERK','Clean & Jerk complet, propre et reproductible','SOURCE_BACKED_CURATED',ARRAY['https://www.crossfit.com/essentials/the-clean','https://www.crossfit.com/essentials/the-power-clean','https://www.crossfit.com/essentials/the-push-jerk']::text[],'HAUTE'),
('BARBELL_SNATCH','Squat Snatch complet, propre et reproductible','SOURCE_BACKED_CURATED',ARRAY['https://www.crossfit.com/essentials/the-snatch','https://www.crossfit.com/essentials/the-power-snatch']::text[],'HAUTE'),
('DB_CLEAN_SNATCH','Transfert explosif propre avec charge unilatérale','UGEROD_CURATED_STRUCTURAL',ARRAY[]::text[],'MOYENNE'),
('DIPS','Dip strict contrôlé','SOURCE_BACKED_CURATED',ARRAY['https://www.crossfit.com/essentials/the-dip']::text[],'HAUTE'),
('DOUBLE_UNDER','Double Unders enchaînés avec rythme stable','SOURCE_BACKED_CURATED',ARRAY['https://www.crossfit.com/essentials/the-double-under']::text[],'HAUTE'),
('HANDSTAND_HSPU','Handstand libre puis branche Handstand Walk et/ou HSPU','SOURCE_BACKED_CURATED',ARRAY['https://www.crossfit.com/essentials/hspu-and-you-master-the-movement','https://www.crossfit.com/essentials/crossfit-handstand-walking-rx-plan']::text[],'HAUTE'),
('HANGING_CORE_TTB','Toes-to-Bar propre puis cyclable','SOURCE_BACKED_CURATED',ARRAY['https://www.crossfit.com/essentials/toes-to-bar']::text[],'HAUTE'),
('L_SIT_CORE','L-Sit au sol contrôlé','UGEROD_CURATED_STRUCTURAL',ARRAY[]::text[],'MOYENNE'),
('PISTOL','Pistol Squat strict et contrôlé','SOURCE_BACKED_CURATED',ARRAY['https://www.crossfit.com/essentials/the-single-leg-squat']::text[],'HAUTE'),
('PULL_UP_MUSCLE_UP','Traction stricte puissante puis transition Muscle-up maîtrisée','SOURCE_BACKED_CURATED',ARRAY['https://www.crossfit.com/essentials/the-pull-up','https://www.crossfit.com/essentials/the-strict-pull-up','https://www.crossfit.com/essentials/the-muscle-up']::text[],'HAUTE'),
('SINGLE_LEG_HINGE','Single-Leg RDL chargé, stable et contrôlé','SOURCE_BACKED_CURATED',ARRAY['https://www.jtsstrength.com/romanian-deadlift-rdl/']::text[],'MOYENNE')
on conflict(path_key) do update set
 terminal_goal=excluded.terminal_goal,
 source_type=excluded.source_type,
 source_urls=excluded.source_urls,
 confidence=excluded.confidence,
 active=true,
 version='skill-curriculum-v1',
 updated_at=now();

insert into public.skill_curriculum_steps_v1(
 path_key,exercise_id,step_order,member_role,branch_key,pedagogical_stage,active,version,updated_at
)
select
 m.path_key,m.exercise_id,m.step_order,m.member_role,
 case
  when m.path_key='BARBELL_CLEAN_JERK' and m.member_role in ('jerk_prep','jerk') then 'jerk'
  when m.path_key='BARBELL_CLEAN_JERK' and m.member_role='clean' then 'clean'
  when m.path_key='BARBELL_CLEAN_JERK' and m.member_role='full_lift' then 'integrated'
  when m.path_key='DB_CLEAN_SNATCH' then m.member_role
  when m.path_key='HANDSTAND_HSPU' and m.member_role='strength_branch' then 'hspu'
  when m.path_key='HANDSTAND_HSPU' and m.member_role='locomotion_branch' then 'walk'
  when m.path_key='HANDSTAND_HSPU' and m.member_role='balance_branch' then 'balance'
  when m.path_key='HANDSTAND_HSPU' and m.step_order<=6 then 'foundation'
  when m.path_key='PULL_UP_MUSCLE_UP' and m.member_role='alternate' then 'alternate'
  else 'default'
 end,
 case
  when m.path_key='HANDSTAND_HSPU' and m.exercise_id='EX027' then 'HANDSTAND — LIGNE AU MUR'
  when m.path_key='HANDSTAND_HSPU' and m.exercise_id='EX460' then 'HANDSTAND — TRANSFERT DE POIDS'
  when m.path_key='HANDSTAND_HSPU' and m.exercise_id='EX464' then 'HANDSTAND — QUITTER LE MUR'
  when m.path_key='HANDSTAND_HSPU' and m.exercise_id='EX451' then 'HANDSTAND — ÉQUILIBRE LIBRE'
  when m.path_key='HANDSTAND_HSPU' and m.exercise_id='EX465' then 'HANDSTAND WALK — TRANSFERT LIBRE'
  when m.path_key='HANDSTAND_HSPU' and m.exercise_id='EX466' then 'HANDSTAND WALK — PREMIERS PAS'
  when m.path_key='HANDSTAND_HSPU' and m.exercise_id='EX201' then 'HANDSTAND WALK — INTÉGRATION'
  when m.path_key='HANDSTAND_HSPU' and m.member_role='strength_branch' then 'HSPU — '||upper(e.name)
  else upper(sp.display_name)||' — '||upper(e.name)
 end,
 true,'skill-curriculum-v1',now()
from public.skill_path_members m
join public.skill_paths sp on sp.path_key=m.path_key and sp.active
join public.exercises e on e.id=m.exercise_id
where m.active
on conflict(path_key,exercise_id) do update set
 step_order=excluded.step_order,
 member_role=excluded.member_role,
 branch_key=excluded.branch_key,
 pedagogical_stage=excluded.pedagogical_stage,
 active=true,
 version=excluded.version,
 updated_at=now();

create or replace function public.skill_curriculum_lesson_ids_v1(p_path_key text,p_target_exercise_id text)
returns text[] language plpgsql stable set search_path=public as $$
declare
 v_target public.skill_curriculum_steps_v1%rowtype;
 v_ids text[]:='{}'::text[];
begin
 select * into v_target
 from public.skill_curriculum_steps_v1
 where path_key=p_path_key and exercise_id=p_target_exercise_id and active;
 if not found then return array[p_target_exercise_id]::text[]; end if;

 if p_path_key='HANDSTAND_HSPU' then
  v_ids:=case p_target_exercise_id
   when 'EX027' then array['EX027','EX460','EX464','EX451']::text[]
   when 'EX460' then array['EX027','EX460','EX461','EX464']::text[]
   when 'EX461' then array['EX027','EX460','EX461','EX462']::text[]
   when 'EX462' then array['EX027','EX461','EX462','EX464']::text[]
   when 'EX464' then array['EX027','EX460','EX464','EX451']::text[]
   when 'EX451' then array['EX027','EX464','EX451','EX465']::text[]
   when 'EX465' then array['EX451','EX465','EX466']::text[]
   when 'EX466' then array['EX451','EX465','EX466','EX201']::text[]
   when 'EX201' then array['EX451','EX465','EX466','EX201']::text[]
   when 'EX457' then array['EX456','EX457','EX458']::text[]
   when 'EX458' then array['EX456','EX458','EX203']::text[]
   when 'EX203' then array['EX456','EX458','EX203']::text[]
   when 'EX459' then array['EX203','EX459']::text[]
   when 'EX453' then array['EX451','EX203','EX453']::text[]
   else null end;
  if v_ids is not null then return v_ids; end if;
 end if;

 if p_path_key='BARBELL_CLEAN_JERK' and p_target_exercise_id='EX500' then
  return array['EX493','EX494','EX491','EX500']::text[];
 end if;
 if p_path_key='DOUBLE_UNDER' then
  return array['EX156','EX476','EX157']::text[];
 end if;

 select coalesce(array_agg(exercise_id order by lesson_order),'{}'::text[])
 into v_ids
 from (
  select s.exercise_id,
   case when s.exercise_id=p_target_exercise_id then 2 when s.step_order<v_target.step_order then 1 else 3 end lesson_order
  from public.skill_curriculum_steps_v1 s
  where s.path_key=p_path_key and s.active
   and (s.branch_key=v_target.branch_key or s.exercise_id=p_target_exercise_id or s.branch_key='default' or v_target.branch_key='default')
  order by case when s.exercise_id=p_target_exercise_id then 0 else 1 end,
           abs(s.step_order-v_target.step_order),s.step_order
  limit 3
 ) q;
 if not (p_target_exercise_id=any(v_ids)) then v_ids:=array_append(v_ids,p_target_exercise_id); end if;
 return v_ids;
end;
$$;

create or replace function public.skill_curriculum_step_v1(p_path_key text,p_exercise_id text)
returns jsonb language sql stable security definer set search_path=public as $$
select coalesce((select jsonb_build_object(
 'version',s.version,
 'status','READY',
 'path_key',s.path_key,
 'path_name',sp.display_name,
 'terminal_goal',p.terminal_goal,
 'exercise_id',s.exercise_id,
 'exercise_name',e.name,
 'step_order',s.step_order,
 'member_role',s.member_role,
 'branch_key',s.branch_key,
 'pedagogical_stage',s.pedagogical_stage,
 'learning_objective',case
  when s.exercise_id='EX027' then 'Construire une ligne propre au mur puis apprendre à quitter volontairement le mur.'
  when s.exercise_id='EX464' then 'Décoller les pieds du mur et récupérer l’équilibre avec les doigts avant de transférer au handstand libre.'
  when s.exercise_id='EX451' then 'Trouver puis reproduire le point d’équilibre sans le mur.'
  when s.exercise_id='EX465' then 'Déplacer le centre de masse d’une main à l’autre en handstand libre.'
  when s.exercise_id='EX466' then 'Transformer l’équilibre libre en premiers pas contrôlés.'
  when s.exercise_id='EX201' then 'Marcher sur les mains avec une ligne et un rythme contrôlés.'
  else 'Maîtriser '||e.name||' comme étape vers : '||p.terminal_goal end,
 'coach_focus',case
  when s.exercise_id='EX027' then 'Privilégie ventre au mur pour travailler la ligne : mains proches du mur, fesses et abdos serrés, épaules poussées vers le plafond.'
  when s.exercise_id='EX464' then 'Depuis ventre au mur, décolle les orteils sans pousser le mur ; utilise les doigts pour freiner et retrouver l’équilibre.'
  when s.exercise_id='EX451' then 'Kick-up contrôlé, ligne serrée, doigts actifs et sortie latérale maîtrisée.'
  else coalesce(nullif(e.tips,''),nullif(e.instructions,''),'Priorité à une exécution propre et contrôlée.') end,
 'success_signal',case
  when s.exercise_id='EX027' then 'Ligne stable sans banane excessive ni effondrement des épaules.'
  when s.exercise_id='EX464' then 'Plusieurs décollages contrôlés sans saut ni perte immédiate de ligne.'
  when s.exercise_id='EX451' then 'Plusieurs équilibres courts contrôlés, pas seulement une réussite accidentelle.'
  else 'Exécution propre, contrôlée et reproductible, sans douleur ni régression nécessaire.' end,
 'next_step_hint',case
  when s.exercise_id='EX027' then 'Transfert de poids → Toe Pull / Wall Float → tentatives libres.'
  when s.exercise_id='EX451' then 'Weight Shift libre → premiers pas → Handstand Walk.'
  else 'UGEROD garde cette étape disponible et rend la suivante prioritaire quand les preuves W3/W4 sont suffisantes.' end,
 'lesson_drill_ids',to_jsonb(public.skill_curriculum_lesson_ids_v1(s.path_key,s.exercise_id)),
 'skill_only',true
)
from public.skill_curriculum_steps_v1 s
join public.skill_curriculum_paths_v1 p on p.path_key=s.path_key and p.active
join public.skill_paths sp on sp.path_key=s.path_key
join public.exercises e on e.id=s.exercise_id
where s.path_key=p_path_key and s.exercise_id=p_exercise_id and s.active),
jsonb_build_object('version','skill-curriculum-v1','status','NO_CURRICULUM_STEP'));
$$;

revoke all on public.skill_curriculum_paths_v1 from anon;
revoke all on public.skill_curriculum_steps_v1 from anon;
grant select on public.skill_curriculum_paths_v1 to authenticated,service_role;
grant select on public.skill_curriculum_steps_v1 to authenticated,service_role;
revoke all on function public.skill_curriculum_lesson_ids_v1(text,text) from public,anon;
revoke all on function public.skill_curriculum_step_v1(text,text) from public,anon;
grant execute on function public.skill_curriculum_lesson_ids_v1(text,text) to authenticated,service_role;
grant execute on function public.skill_curriculum_step_v1(text,text) to authenticated,service_role;
