create table if not exists public.exercise_functional_groups (
  group_key text primary key,
  display_name text not null,
  block_exclusive boolean not null default true,
  rationale text,
  created_at timestamptz not null default now()
);

create table if not exists public.exercise_functional_group_members (
  exercise_id varchar primary key references public.exercises(id) on delete cascade,
  group_key text not null references public.exercise_functional_groups(group_key) on delete cascade,
  source text not null default 'CURATED_V1',
  confidence numeric(4,3) not null default 1.000 check (confidence between 0 and 1),
  notes text,
  created_at timestamptz not null default now()
);

alter table public.exercise_functional_groups enable row level security;
alter table public.exercise_functional_group_members enable row level security;

drop policy if exists exercise_functional_groups_read on public.exercise_functional_groups;
create policy exercise_functional_groups_read on public.exercise_functional_groups
for select to authenticated using (true);

drop policy if exists exercise_functional_group_members_read on public.exercise_functional_group_members;
create policy exercise_functional_group_members_read on public.exercise_functional_group_members
for select to authenticated using (true);

grant select on public.exercise_functional_groups, public.exercise_functional_group_members to authenticated, service_role;
revoke insert,update,delete on public.exercise_functional_groups, public.exercise_functional_group_members from anon,authenticated;

insert into public.exercise_functional_groups(group_key,display_name,rationale) values
('GOOD_MORNING','Good Morning / Hip Hinge Drill','Même geste de charnière de hanche; une seule variante par bloc.'),
('PUSH_UP','Push-up','Variantes de pompe; une seule variante de poussée horizontale de base par bloc.'),
('SCAPULAR_PUSHUP','Scapular Push-up','Activation scapulaire en appui; variantes fonctionnellement équivalentes.'),
('SQUAT_BILATERAL','Squat bilatéral','Variantes bilatérales du squat et préparations directes.'),
('PISTOL','Pistol Squat','Progressions/régressions du pistol.'),
('LUNGE_LINEAR','Lunge linéaire','Variantes avant/arrière/statique/bulgare/marchée du même geste unilatéral dominant.'),
('LUNGE_LATERAL','Lunge / Squat latéral','Variantes latérales de fente/squat.'),
('PLANK_FRONT','Plank frontal','Variantes de planche frontale.'),
('PLANK_SIDE','Side Plank','Variantes de planche latérale.'),
('DEADLIFT_RDL','Deadlift / RDL bilatéral','Variantes bilatérales de deadlift/RDL; une seule par bloc.'),
('SINGLE_LEG_RDL','Single-leg RDL','Variantes unilatérales du RDL.'),
('GLUTE_BRIDGE','Glute Bridge / Hip Thrust','Variantes du pont de hanches/hip thrust.'),
('ROW_HORIZONTAL','Horizontal Row','Variantes de tirage horizontal selon matériel.'),
('FACE_PULL','Face Pull','Variantes du face pull selon matériel.'),
('PULL_UP','Pull-up progression','Suspension/traction et régressions directes du geste de traction verticale.'),
('BURPEE','Burpee','Variantes de burpee/sprawl.'),
('HANGING_CORE_RAISE','Hanging Core Raise','Progressions de knee raise à toes-to-bar.'),
('L_SIT','L-Sit','Progressions au sol/parallettes du L-Sit.'),
('PIKE_HSPU','Pike / HSPU','Progressions de poussée verticale Pike/HSPU.'),
('SNATCH_BAR','Barbell Snatch','Progressions/variantes de snatch barre.'),
('CLEAN_BAR','Barbell Clean','Progressions/variantes de clean barre.'),
('DIP','Dip','Variantes/progressions de dip.'),
('JUMP_ROPE','Jump Rope','Progressions Single Under / Double Under et drill associé.')
on conflict(group_key) do update set display_name=excluded.display_name,rationale=excluded.rationale,block_exclusive=true;

insert into public.exercise_functional_group_members(exercise_id,group_key,source,confidence) values
('EX112','GOOD_MORNING','CURATED_V1',1),('EX401','GOOD_MORNING','CURATED_V1',1),('EX429','GOOD_MORNING','CURATED_V1',1),('EXW017','GOOD_MORNING','CURATED_V1',1),
('EX001','PUSH_UP','CURATED_V1',1),('EX003','PUSH_UP','CURATED_V1',1),('EX006','PUSH_UP','CURATED_V1',1),('EX009','PUSH_UP','CURATED_V1',1),('EX013','PUSH_UP','CURATED_V1',1),('EX016','PUSH_UP','CURATED_V1',1),('EX454','PUSH_UP','CURATED_V1',1),('EXW029','PUSH_UP','CURATED_V1',1),
('EX439','SCAPULAR_PUSHUP','CURATED_V1',1),('EX455','SCAPULAR_PUSHUP','CURATED_V1',1),('EXW015','SCAPULAR_PUSHUP','CURATED_V1',1),
('EX030','SQUAT_BILATERAL','CURATED_V1',1),('EX033','SQUAT_BILATERAL','CURATED_V1',1),('EX037','SQUAT_BILATERAL','CURATED_V1',1),('EX040','SQUAT_BILATERAL','CURATED_V1',1),('EX427','SQUAT_BILATERAL','CURATED_V1',1),('EX489','SQUAT_BILATERAL','CURATED_V1',1),('EX510','SQUAT_BILATERAL','CURATED_V1',1),('EXW003','SQUAT_BILATERAL','CURATED_V1',1),('EXW021','SQUAT_BILATERAL','CURATED_V1',1),
('EX043','PISTOL','CURATED_V1',1),('EX044','PISTOL','CURATED_V1',1),('EX478','PISTOL','CURATED_V1',1),('EX479','PISTOL','CURATED_V1',1),
('EX048','LUNGE_LINEAR','CURATED_V1',1),('EX051','LUNGE_LINEAR','CURATED_V1',1),('EX054','LUNGE_LINEAR','CURATED_V1',1),('EX057','LUNGE_LINEAR','CURATED_V1',1),('EX061','LUNGE_LINEAR','CURATED_V1',1),('EXW019','LUNGE_LINEAR','CURATED_V1',1),
('EX045','LUNGE_LATERAL','CURATED_V1',1),('EX428','LUNGE_LATERAL','CURATED_V1',1),('EXW020','LUNGE_LATERAL','CURATED_V1',1),
('EX093','PLANK_FRONT','CURATED_V1',1),('EX095','PLANK_FRONT','CURATED_V1',1),('EX097','PLANK_FRONT','CURATED_V1',1),
('EX098','PLANK_SIDE','CURATED_V1',1),('EX320','PLANK_SIDE','CURATED_V1',1),('EX415','PLANK_SIDE','CURATED_V1',1),
('EX115','DEADLIFT_RDL','CURATED_V1',1),('EX309','DEADLIFT_RDL','CURATED_V1',1),('EX310','DEADLIFT_RDL','CURATED_V1',1),('EX487','DEADLIFT_RDL','CURATED_V1',1),('EX488','DEADLIFT_RDL','CURATED_V1',1),
('EX_L02','SINGLE_LEG_RDL','CURATED_V1',1),('EX405','SINGLE_LEG_RDL','CURATED_V1',1),
('EX104','GLUTE_BRIDGE','CURATED_V1',1),('EX107','GLUTE_BRIDGE','CURATED_V1',1),('EX402','GLUTE_BRIDGE','CURATED_V1',1),('EX404','GLUTE_BRIDGE','CURATED_V1',1),('EX430','GLUTE_BRIDGE','CURATED_V1',1),
('EX062','ROW_HORIZONTAL','CURATED_V1',1),('EX131','ROW_HORIZONTAL','CURATED_V1',1),('EX134','ROW_HORIZONTAL','CURATED_V1',1),('EX321','ROW_HORIZONTAL','CURATED_V1',1),('EX408','ROW_HORIZONTAL','CURATED_V1',1),('EX504','ROW_HORIZONTAL','CURATED_V1',1),('EX513','ROW_HORIZONTAL','CURATED_V1',1),
('EX322','FACE_PULL','CURATED_V1',1),('EX410','FACE_PULL','CURATED_V1',1),
('EX065','PULL_UP','CURATED_V1',1),('EX067','PULL_UP','CURATED_V1',1),('EX070','PULL_UP','CURATED_V1',1),('EX071','PULL_UP','CURATED_V1',1),('EX079','PULL_UP','CURATED_V1',1),('EX411','PULL_UP','CURATED_V1',1),
('EX144','BURPEE','CURATED_V1',1),('EX145','BURPEE','CURATED_V1',1),('EX146','BURPEE','CURATED_V1',1),('EX147','BURPEE','CURATED_V1',1),
('EX482','HANGING_CORE_RAISE','CURATED_V1',1),('EX483','HANGING_CORE_RAISE','CURATED_V1',1),('EX484','HANGING_CORE_RAISE','CURATED_V1',1),('EX485','HANGING_CORE_RAISE','CURATED_V1',1),('EX486','HANGING_CORE_RAISE','CURATED_V1',1),
('EX091','L_SIT','CURATED_V1',1),('EX473','L_SIT','CURATED_V1',1),('EX474','L_SIT','CURATED_V1',1),('EX475','L_SIT','CURATED_V1',1),('EX480','L_SIT','CURATED_V1',1),('EX481','L_SIT','CURATED_V1',1),
('EX017','PIKE_HSPU','CURATED_V1',1),('EX020','PIKE_HSPU','CURATED_V1',1),('EX203','PIKE_HSPU','CURATED_V1',1),('EX453','PIKE_HSPU','CURATED_V1',1),('EX456','PIKE_HSPU','CURATED_V1',1),('EX457','PIKE_HSPU','CURATED_V1',1),('EX458','PIKE_HSPU','CURATED_V1',1),('EX459','PIKE_HSPU','CURATED_V1',1),
('EX496','SNATCH_BAR','CURATED_V1',1),('EX497','SNATCH_BAR','CURATED_V1',1),('EX498','SNATCH_BAR','CURATED_V1',1),('EX499','SNATCH_BAR','CURATED_V1',1),
('EX493','CLEAN_BAR','CURATED_V1',1),('EX494','CLEAN_BAR','CURATED_V1',1),('EX495','CLEAN_BAR','CURATED_V1',1),
('EX024','DIP','CURATED_V1',1),('EX470','DIP','CURATED_V1',1),('EX471','DIP','CURATED_V1',1),('EX472','DIP','CURATED_V1',1),
('EX156','JUMP_ROPE','CURATED_V1',1),('EX157','JUMP_ROPE','CURATED_V1',1),('EX476','JUMP_ROPE','CURATED_V1',1)
on conflict(exercise_id) do update set group_key=excluded.group_key,source=excluded.source,confidence=excluded.confidence;

create or replace function public.exercise_functional_group_key_v1(p_exercise_id text)
returns text language sql stable set search_path to 'public'
as $function$
  select coalesce((select m.group_key from public.exercise_functional_group_members m where m.exercise_id=p_exercise_id),'SELF:'||coalesce(p_exercise_id,'UNKNOWN'));
$function$;

create or replace function public.exercise_expand_functional_exclusions_v1(p_exercise_ids text[])
returns text[] language sql stable set search_path to 'public'
as $function$
  with base as (select distinct x id from unnest(coalesce(p_exercise_ids,'{}'::text[])) x),
  groups as (
    select distinct m.group_key from base b join public.exercise_functional_group_members m on m.exercise_id=b.id
    join public.exercise_functional_groups g on g.group_key=m.group_key and g.block_exclusive
  ), expanded as (
    select id from base union select m.exercise_id from public.exercise_functional_group_members m where m.group_key in (select group_key from groups)
  )
  select coalesce(array_agg(distinct id order by id),'{}'::text[]) from expanded;
$function$;

create or replace function public.c4_plan_functional_conflicts_v1(p_plan jsonb)
returns jsonb language sql stable set search_path to 'public'
as $function$
  with items as (
    select case b->>'block_key' when 'warm_up' then 'warmup' else b->>'block_key' end block_key,bord,eord,coalesce(ex->>'exercise_id',ex->>'id') exercise_id
    from jsonb_array_elements(coalesce(p_plan->'blocks','[]'::jsonb)) with ordinality bz(b,bord)
    cross join lateral jsonb_array_elements(coalesce(b->'exercises','[]'::jsonb)) with ordinality ez(ex,eord)
  ), grouped as (
    select i.*,m.group_key from items i join public.exercise_functional_group_members m on m.exercise_id=i.exercise_id
    join public.exercise_functional_groups g on g.group_key=m.group_key and g.block_exclusive
  ), conflicts as (
    select block_key,group_key,count(*) cnt,array_agg(exercise_id order by eord) exercise_ids from grouped group by block_key,group_key having count(*)>1
  )
  select jsonb_build_object('version','exercise-coherence-v1','pass',not exists(select 1 from conflicts),'conflicts',coalesce((select jsonb_agg(jsonb_build_object('block_key',block_key,'group_key',group_key,'exercise_ids',to_jsonb(exercise_ids),'count',cnt) order by block_key,group_key) from conflicts),'[]'::jsonb));
$function$;

create or replace function public.c4_session_functional_conflicts_v1(p_session_id uuid)
returns jsonb language sql stable set search_path to 'public'
as $function$
  with grouped as (
    select case wse.block_key when 'warm_up' then 'warmup' else wse.block_key end block_key,wse.exercise_id,wse.position,m.group_key
    from public.workout_session_exercises wse join public.exercise_functional_group_members m on m.exercise_id=wse.exercise_id
    join public.exercise_functional_groups g on g.group_key=m.group_key and g.block_exclusive where wse.session_id=p_session_id
  ), conflicts as (
    select block_key,group_key,count(*) cnt,array_agg(exercise_id order by position) exercise_ids from grouped group by block_key,group_key having count(*)>1
  )
  select jsonb_build_object('version','exercise-coherence-v1','pass',not exists(select 1 from conflicts),'conflicts',coalesce((select jsonb_agg(jsonb_build_object('block_key',block_key,'group_key',group_key,'exercise_ids',to_jsonb(exercise_ids),'count',cnt) order by block_key,group_key) from conflicts),'[]'::jsonb));
$function$;

create or replace function public.c4_session_block_functionally_coherent_v1(p_session_id uuid,p_block_key text)
returns boolean language sql stable set search_path to 'public'
as $function$
  with grouped as (
    select m.group_key,count(*) cnt
    from public.workout_session_exercises wse join public.exercise_functional_group_members m on m.exercise_id=wse.exercise_id
    join public.exercise_functional_groups g on g.group_key=m.group_key and g.block_exclusive
    where wse.session_id=p_session_id and (case wse.block_key when 'warm_up' then 'warmup' else wse.block_key end)=(case p_block_key when 'warm_up' then 'warmup' else p_block_key end)
    group by m.group_key
  ) select not exists(select 1 from grouped where cnt>1);
$function$;

grant execute on function public.exercise_functional_group_key_v1(text) to authenticated,service_role;
grant execute on function public.exercise_expand_functional_exclusions_v1(text[]) to authenticated,service_role;
grant execute on function public.c4_plan_functional_conflicts_v1(jsonb) to authenticated,service_role;
grant execute on function public.c4_session_functional_conflicts_v1(uuid) to authenticated,service_role;
grant execute on function public.c4_session_block_functionally_coherent_v1(uuid,text) to authenticated,service_role;

create or replace view public.exercise_functional_equivalence_suspects_v1 with (security_invoker=true) as
select a.id exercise_id_a,a.name name_a,b.id exercise_id_b,b.name name_b,a.exercise_family,a.movement_pattern,
  round(similarity(lower(unaccent(a.name)),lower(unaccent(b.name)))::numeric,3) name_similarity,
  public.exercise_functional_group_key_v1(a.id) group_key_a,public.exercise_functional_group_key_v1(b.id) group_key_b,
  array_remove(array[
    case when regexp_replace(lower(unaccent(a.name)),'[^a-z0-9]+','','g')=regexp_replace(lower(unaccent(b.name)),'[^a-z0-9]+','','g') then 'EXACT_NORMALIZED_NAME' end,
    case when exists(select 1 from public.exercise_variants ev where (ev.exercise_id=a.id and ev.target_exercise_id=b.id) or (ev.exercise_id=b.id and ev.target_exercise_id=a.id)) then 'DIRECT_VARIANT_RELATION' end,
    case when similarity(lower(unaccent(a.name)),lower(unaccent(b.name)))>=0.55 then 'NAME_SIMILARITY' end
  ],null) reason_codes
from public.exercises a join public.exercises b on a.id<b.id
where a.exercise_family=b.exercise_family and a.movement_pattern=b.movement_pattern
  and public.exercise_functional_group_key_v1(a.id)<>public.exercise_functional_group_key_v1(b.id)
  and (regexp_replace(lower(unaccent(a.name)),'[^a-z0-9]+','','g')=regexp_replace(lower(unaccent(b.name)),'[^a-z0-9]+','','g')
    or similarity(lower(unaccent(a.name)),lower(unaccent(b.name)))>=0.55
    or exists(select 1 from public.exercise_variants ev where (ev.exercise_id=a.id and ev.target_exercise_id=b.id) or (ev.exercise_id=b.id and ev.target_exercise_id=a.id)));
grant select on public.exercise_functional_equivalence_suspects_v1 to service_role;

do $do$
declare v_def text; v_old text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.prokind='f' and p.proname='c4_warmup_candidate_for_target_v1'
    and pg_get_function_identity_arguments(p.oid)='p_user_id uuid, p_target_exercise_id text, p_target_block text, p_excluded_exercise_ids text[], p_all_target_exercise_ids text[], p_zone_terms text[], p_inventory jsonb, p_max_complexity integer';
  if v_def is null then raise exception 'c4_warmup_candidate_for_target_v1 exact signature not found'; end if;
  v_old:='where not (e.id=any(coalesce(p_excluded_exercise_ids,''{}''::text[])))';
  v_new:='where not (e.id=any(public.exercise_expand_functional_exclusions_v1(coalesce(p_excluded_exercise_ids,''{}''::text[]))))';
  if position(v_old in v_def)=0 then raise exception 'warmup candidate exclusion snippet not found'; end if;
  execute replace(v_def,v_old,v_new);
end $do$;

do $do$
declare v_def text; v_old text; v_new text; v_count int;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.prokind='f' and p.proname='c4_apply_preparation_quality_v3'
    and pg_get_function_identity_arguments(p.oid)='p_user_id uuid, p_plan jsonb, p_zone_terms text[], p_inventory jsonb, p_target_region text, p_max_complexity integer, p_progression_intent text';
  if v_def is null then raise exception 'c4_apply_preparation_quality_v3 exact signature not found'; end if;
  v_old:='not(e.id=any(v_selected_ids))'; v_new:='not(e.id=any(public.exercise_expand_functional_exclusions_v1(v_selected_ids)))';
  v_count:=(length(v_def)-length(replace(v_def,v_old,'')))/length(v_old);
  if v_count<>2 then raise exception 'Expected 2 preparation direct selected-id filters, found %',v_count; end if;
  execute replace(v_def,v_old,v_new);
end $do$;

alter function public.c4_apply_preparation_quality_v3(uuid,jsonb,text[],jsonb,text,integer,text) rename to c4_apply_preparation_quality_v3_pre_exercise_coherence_v1;
create or replace function public.c4_apply_preparation_quality_v3(p_user_id uuid,p_plan jsonb,p_zone_terms text[] default '{}'::text[],p_inventory jsonb default '[]'::jsonb,p_target_region text default null,p_max_complexity integer default 3,p_progression_intent text default null)
returns jsonb language plpgsql stable set search_path to 'public' as $function$
declare r jsonb; v_guard jsonb;
begin
  r:=public.c4_apply_preparation_quality_v3_pre_exercise_coherence_v1(p_user_id,p_plan,p_zone_terms,p_inventory,p_target_region,p_max_complexity,p_progression_intent);
  if coalesce(r->>'status','')<>'READY' then return r; end if;
  v_guard:=public.c4_plan_functional_conflicts_v1(r);
  r:=jsonb_set(r,'{architecture,exercise_coherence}',v_guard,true);
  if not coalesce((v_guard->>'pass')::boolean,false) then r:=jsonb_set(r,'{status}',to_jsonb('NO_SAFE_FUNCTIONAL_COHERENCE'::text),true); end if;
  return r;
end;$function$;

do $do$
declare v_def text; v_old1 text; v_new1 text; v_old2 text; v_new2 text; v_count2 int;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.prokind='f' and p.proname='c4_apply_session_architecture_v2'
    and pg_get_function_identity_arguments(p.oid)='p_user_id uuid, p_plan jsonb, p_focus text, p_duration_minutes integer, p_readiness text, p_target_region text, p_progression_intent text, p_zone_terms text[], p_inventory jsonb, p_max_complexity integer, p_max_difficulty text, p_candidate_count integer, p_policy_key text';
  if v_def is null then raise exception 'c4_apply_session_architecture_v2 exact signature not found'; end if;
  v_old1:='if not (rec.id=any(v_selected_ids))'; v_new1:='if not (rec.id=any(public.exercise_expand_functional_exclusions_v1(v_selected_ids)))';
  if position(v_old1 in v_def)=0 then raise exception 'Architecture Tabata functional guard insertion point not found'; end if;
  v_def:=replace(v_def,v_old1,v_new1);
  v_old2:='if not(rec.id=any(v_selected_ids))'; v_new2:='if not(rec.id=any(public.exercise_expand_functional_exclusions_v1(v_selected_ids)))';
  v_count2:=(length(v_def)-length(replace(v_def,v_old2,'')))/length(v_old2);
  if v_count2<>2 then raise exception 'Expected 2 Architecture direct selection checks, found %',v_count2; end if;
  v_def:=replace(v_def,v_old2,v_new2); execute v_def;
end $do$;

do $do$
declare v_def text; v_old text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.prokind='f' and p.proname='c4_non_wod_swap_candidate_v3_base'
    and pg_get_function_identity_arguments(p.oid)='p_user_id uuid, p_session_exercise_id uuid, p_direction text, p_excluded_exercise_ids text[], p_target_exercise_id text';
  if v_def is null then raise exception 'c4_non_wod_swap_candidate_v3_base exact signature not found'; end if;
  v_old:='and not exists(select 1 from public.workout_session_exercises used where used.session_id=target.session_id and used.id<>target.id and used.exercise_id=e.id)';
  v_new:=v_old||E'\n    and not exists(\n      select 1 from public.workout_session_exercises used\n      where used.session_id=target.session_id and used.id<>target.id\n        and (case used.block_key when ''warm_up'' then ''warmup'' else used.block_key end)=v_block_key\n        and public.exercise_functional_group_key_v1(used.exercise_id)=public.exercise_functional_group_key_v1(e.id)\n        and public.exercise_functional_group_key_v1(e.id) not like ''SELF:%''\n    )';
  if position(v_old in v_def)=0 then raise exception 'Non-WOD swap duplicate filter insertion point not found'; end if;
  execute replace(v_def,v_old,v_new);
end $do$;

do $do$
declare v_def text; v_old text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.prokind='f' and p.proname='c4_wod_swap_candidate_v3_base'
    and pg_get_function_identity_arguments(p.oid)='p_user_id uuid, p_session_exercise_id uuid, p_direction text, p_excluded_exercise_ids text[], p_target_exercise_id text';
  if v_def is null then raise exception 'c4_wod_swap_candidate_v3_base exact signature not found'; end if;
  v_old:='and not exists(select 1 from jsonb_array_elements(v_base->''exercises'') x where x->>''exercise_id''=cp.exercise_id and (x->>''exercise_id'')<>target.exercise_id)';
  v_new:=v_old||E'\n      and not exists(\n        select 1 from public.workout_session_exercises used\n        where used.session_id=target.session_id and used.id<>target.id and used.block_key=''wod''\n          and public.exercise_functional_group_key_v1(used.exercise_id)=public.exercise_functional_group_key_v1(cp.exercise_id)\n          and public.exercise_functional_group_key_v1(cp.exercise_id) not like ''SELF:%''\n      )';
  if position(v_old in v_def)=0 then raise exception 'WOD swap duplicate filter insertion point not found'; end if;
  execute replace(v_def,v_old,v_new);
end $do$;

do $do$
declare v_def text; v_old text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.prokind='f' and p.proname='c4_swap_session_exercise_v3'
    and pg_get_function_identity_arguments(p.oid)='p_user_id uuid, p_session_exercise_id uuid, p_direction text, p_excluded_exercise_ids text[], p_undo boolean';
  if v_def is null then raise exception 'c4_swap_session_exercise_v3 exact signature not found'; end if;
  v_old:=E'  if p_undo then\n    if v_history.id is not null then';
  v_new:=E'  if not public.c4_session_block_functionally_coherent_v1(target.session_id,v_block_key) then\n    raise exception ''FUNCTIONAL_COHERENCE_GUARD: swap would create duplicate functional exercise in block %'',v_block_key;\n  end if;\n\n  if p_undo then\n    if v_history.id is not null then';
  if position(v_old in v_def)=0 then raise exception 'Post-swap assertion insertion point not found'; end if;
  execute replace(v_def,v_old,v_new);
end $do$;

comment on table public.exercise_functional_groups is 'Exercise Coherence V1 curated functional-equivalence groups. Same group means variants should not coexist inside one block unless future policy explicitly overrides it.';
comment on view public.exercise_functional_equivalence_suspects_v1 is 'Automatic audit queue for same-family/same-pattern exercise pairs that look equivalent but are not yet curated into the same functional group.';