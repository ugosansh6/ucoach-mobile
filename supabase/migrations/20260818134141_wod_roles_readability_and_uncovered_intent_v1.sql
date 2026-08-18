alter table public.exercises add column if not exists display_name text;

alter table public.exercises drop constraint if exists exercises_wod_role_check;
update public.exercises set wod_role='wod' where wod_role in ('primary','secondary');
update public.exercises set wod_role='adaptation' where wod_role='accessory';
alter table public.exercises alter column wod_role set default 'wod';
alter table public.exercises add constraint exercises_wod_role_check check (wod_role in ('wod','adaptation','prep_only'));

update public.exercises
set display_name=regexp_replace(name,' classique$','','i')
where name ~* ' classique$' and display_name is null;

update public.exercises set display_name=case id
  when 'EX003' then 'Pompes inclinées'
  when 'EX009' then 'Push-ups'
  when 'EX033' then 'Air Squat'
  when 'EX071' then 'Pull-ups'
  when 'EX079' then 'Chest-to-Bar'
  when 'EX097' then 'Commandos'
  when 'EX110' then 'KB Swing'
  when 'EX111' then 'American KB Swing'
  when 'EX146' then 'Burpees'
  when 'EX203' then 'HSPU strict'
  when 'EX415' then 'Hip Dips'
  when 'EX450' then 'Pike Hold'
  when 'EX456' then 'Pike Push-up'
  when 'EX470' then 'Support Hold'
  when 'EX471' then 'Dips négatifs'
  when 'EX472' then 'Dips'
  when 'EX480' then 'Tuck L-Sit'
  when 'EX481' then 'L-Sit 1 jambe'
  when 'EX091' then 'L-Sit'
  else display_name end
where id in ('EX003','EX009','EX033','EX071','EX079','EX097','EX110','EX111','EX146','EX203','EX415','EX450','EX456','EX470','EX471','EX472','EX480','EX481','EX091');

create table if not exists public.user_uncovered_pattern_intents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  movement_pattern text not null,
  exercise_family text,
  source_session_id uuid references public.workout_sessions(id) on delete set null,
  source_exercise_id text references public.exercises(id) on delete set null,
  reason text not null default 'unavailable_today',
  priority smallint not null default 5 check (priority between 1 and 10),
  status text not null default 'active' check (status in ('active','resolved','expired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now()+interval '21 days'),
  resolved_at timestamptz,
  metadata_json jsonb not null default '{}'::jsonb
);

create index if not exists user_uncovered_pattern_intents_active_idx
  on public.user_uncovered_pattern_intents(user_id,movement_pattern,status,expires_at);

alter table public.user_uncovered_pattern_intents enable row level security;

drop policy if exists user_uncovered_pattern_intents_select_own on public.user_uncovered_pattern_intents;
create policy user_uncovered_pattern_intents_select_own on public.user_uncovered_pattern_intents
for select using (auth.uid()=user_id);

create or replace function public.record_uncovered_pattern_intent_v1(
  p_user_id uuid,
  p_session_id uuid,
  p_exercise_id text,
  p_reason text default 'unavailable_today'
) returns jsonb
language plpgsql
security definer
set search_path='public'
as $$
declare
  v_pattern text;
  v_family text;
  v_id uuid;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;
  select movement_pattern,exercise_family into v_pattern,v_family from public.exercises where id=p_exercise_id;
  if v_pattern is null then return jsonb_build_object('status','NO_PATTERN','exercise_id',p_exercise_id); end if;

  update public.user_uncovered_pattern_intents
  set priority=least(10,priority+1),
      source_session_id=p_session_id,
      source_exercise_id=p_exercise_id,
      exercise_family=v_family,
      reason=coalesce(nullif(p_reason,''),'unavailable_today'),
      expires_at=now()+interval '21 days',
      updated_at=now(),
      metadata_json=coalesce(metadata_json,'{}'::jsonb)||jsonb_build_object('last_recorded_at',now())
  where user_id=p_user_id and movement_pattern=v_pattern and status='active' and expires_at>now()
  returning id into v_id;

  if v_id is null then
    insert into public.user_uncovered_pattern_intents(user_id,movement_pattern,exercise_family,source_session_id,source_exercise_id,reason,priority,metadata_json)
    values(p_user_id,v_pattern,v_family,p_session_id,p_exercise_id,coalesce(nullif(p_reason,''),'unavailable_today'),5,jsonb_build_object('created_by','structural_fallback_v1'))
    returning id into v_id;
  end if;

  return jsonb_build_object('status','RECORDED','intent_id',v_id,'movement_pattern',v_pattern,'exercise_family',v_family,'soft_bias_only',true,'not_training_debt',true);
end;
$$;

create or replace function public.resolve_uncovered_pattern_intents_v1(
  p_user_id uuid,
  p_session_id uuid
) returns jsonb
language plpgsql
security definer
set search_path='public'
as $$
declare v_count int:=0;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;

  update public.user_uncovered_pattern_intents i
  set status='resolved',resolved_at=now(),updated_at=now(),
      metadata_json=coalesce(i.metadata_json,'{}'::jsonb)||jsonb_build_object('resolved_by_session_id',p_session_id)
  where i.user_id=p_user_id and i.status='active'
    and exists(
      select 1
      from public.exercise_logs l
      join public.exercises e on e.id=l.exercise_id
      where l.session_id=p_session_id and l.user_id=p_user_id
        and coalesce(l.user_execution_status,l.status,'completed') not in ('not_completed','skipped')
        and e.movement_pattern=i.movement_pattern
    );
  get diagnostics v_count=row_count;

  update public.user_uncovered_pattern_intents
  set status='expired',updated_at=now()
  where user_id=p_user_id and status='active' and expires_at<=now();

  return jsonb_build_object('status','SYNCED','resolved_count',v_count,'soft_bias_only',true,'not_training_debt',true);
end;
$$;

create or replace function public.c2_candidate_pool(
  p_user_id uuid,
  p_focus text,
  p_duration_minutes integer,
  p_readiness text,
  p_target_region text default null,
  p_progression_intent text default null,
  p_zone_terms text[] default '{}'::text[],
  p_inventory jsonb default '[]'::jsonb,
  p_usable_for text default 'WOD',
  p_max_complexity integer default 3,
  p_max_difficulty text default 'Intermédiaire',
  p_limit integer default 20
) returns table(
  exercise_id text, exercise_name text, movement_pattern text, exercise_family text, body_region text,
  candidate_score numeric, score_components jsonb, stimulus_proxy jsonb, prescription_simulation jsonb
)
language sql
stable
set search_path='public'
as $$
with base as (
  select * from public.c2_candidate_pool_pre_p2b(
    p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
    p_zone_terms,p_inventory,p_usable_for,p_max_complexity,p_max_difficulty,greatest(p_limit*4,80)
  )
), enriched as (
  select b.*,e.wod_role,e.selection_weight,e.technical_complexity,
    case when upper(coalesce(p_usable_for,'WOD'))='WOD' then
      case e.wod_role when 'wod' then 6 when 'adaptation' then -14 when 'prep_only' then -100 else 0 end
    else 0 end as role_bias,
    case when upper(coalesce(p_usable_for,'WOD'))='WOD' then
      greatest(-3::numeric,least(3::numeric,(coalesce(e.selection_weight,7)-7)*0.8 - greatest(0,coalesce(e.technical_complexity,3)-3)*0.4))
    else 0 end as readability_bias,
    case when upper(coalesce(p_usable_for,'WOD'))='WOD' then coalesce((
      select max(
        (case when i.movement_pattern=b.movement_pattern then 6 else 0 end)
        +(case when i.exercise_family is not null and i.exercise_family=b.exercise_family then 2 else 0 end)
      )
      from public.user_uncovered_pattern_intents i
      where i.user_id=p_user_id and i.status='active' and i.expires_at>now()
        and (i.movement_pattern=b.movement_pattern or (i.exercise_family is not null and i.exercise_family=b.exercise_family))
    ),0) else 0 end as uncovered_intent_bias
  from base b
  join public.exercises e on e.id=b.exercise_id
  where upper(coalesce(p_usable_for,'WOD'))<>'WOD' or e.wod_role<>'prep_only'
), scored as (
  select e.*,(e.candidate_score+e.role_bias+e.readability_bias+e.uncovered_intent_bias)::numeric as adjusted_score
  from enriched e
)
select s.exercise_id,s.exercise_name,s.movement_pattern,s.exercise_family,s.body_region,
       round(s.adjusted_score,2) as candidate_score,
       coalesce(s.score_components,'{}'::jsonb)||jsonb_build_object(
         'wod_role',s.wod_role,
         'wod_role_bias',round(s.role_bias,2),
         'readability_bias',round(s.readability_bias,2),
         'uncovered_pattern_soft_bias',round(s.uncovered_intent_bias,2),
         'uncovered_pattern_is_debt',false
       ) as score_components,
       s.stimulus_proxy,s.prescription_simulation
from scored s
order by s.adjusted_score desc,s.exercise_id
limit greatest(1,p_limit);
$$;

create or replace function public.c4_wod_role_contract_v1(p_candidate jsonb)
returns jsonb
language plpgsql
stable
set search_path='public'
as $$
declare n int; wod_count int; adaptation_count int; prep int;
begin
  select count(*),
         count(*) filter(where e.wod_role='wod'),
         count(*) filter(where e.wod_role='adaptation'),
         count(*) filter(where e.wod_role='prep_only')
  into n,wod_count,adaptation_count,prep
  from jsonb_array_elements(coalesce(p_candidate->'exercises','[]'::jsonb)) x
  join public.exercises e on e.id=x->>'exercise_id';

  return jsonb_build_object(
    'version','wod-role-contract-v3',
    'exercise_count',n,
    'wod_count',wod_count,
    'adaptation_count',adaptation_count,
    'prep_only_count',prep,
    'pass',prep=0 and wod_count>=1,
    'adaptation_allowed_as_last_resort',true,
    'prep_only_forbidden_in_wod',true,
    'rule','Prefer WOD movements; adaptation only when no compatible WOD replacement exists; PREP_ONLY never enters a WOD'
  );
end;
$$;

create or replace function public.c4_repair_wod_role_composition_v1(
  p_candidate jsonb,p_user_id uuid,p_focus text,p_duration_minutes integer,p_readiness text,p_target_region text,
  p_progression_intent text,p_zone_terms text[],p_inventory jsonb,p_max_complexity integer,p_max_difficulty text
) returns jsonb
language plpgsql
stable
set search_path='public'
as $$
declare
  r jsonb:=p_candidate; exs jsonb:=coalesce(p_candidate->'exercises','[]'::jsonb); n int:=jsonb_array_length(exs); idx int;
  item jsonb; role text; replacement jsonb; mech text:=upper(coalesce(p_candidate->>'mechanic','')); variant text:=upper(coalesce(p_candidate->>'variant_key',''));
  stimulus jsonb; repaired jsonb:='[]'::jsonb; wod_count int:=0; adaptation_count int:=0; prep_count int:=0;
begin
  if n=0 then return p_candidate; end if;
  stimulus:=public.build_session_stimulus_target(p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,'c1-default');

  for idx in 0..n-1 loop
    item:=exs->idx;
    select wod_role into role from public.exercises where id=item->>'exercise_id';
    if role='wod' then continue; end if;

    replacement:=null;
    select jsonb_build_object(
      'exercise_id',cp.exercise_id,'name',cp.exercise_name,'pattern',cp.movement_pattern,'family',cp.exercise_family,
      'candidate_score',cp.candidate_score,'components',cp.score_components,
      'prescription',public.c2_solver_prescription(p_user_id,cp.exercise_id,stimulus,mech,p_progression_intent,p_inventory),
      'mechanic_suitability',prof.profile
    ) into replacement
    from public.c2_candidate_pool(
      p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,p_zone_terms,p_inventory,
      'WOD',p_max_complexity,p_max_difficulty,120
    ) cp
    join public.exercises e on e.id=cp.exercise_id
    cross join lateral (select public.c4_exercise_mechanic_profile(p_user_id,cp.exercise_id,mech,nullif(variant,''),p_readiness,p_progression_intent) profile) prof
    where e.wod_role='wod'
      and coalesce((prof.profile->>'compatible')::boolean,false)
      and not exists(select 1 from jsonb_array_elements(exs) z where z->>'exercise_id'=cp.exercise_id)
    order by coalesce(nullif(prof.profile->>'suitability_score','')::numeric,0) desc,cp.candidate_score desc,cp.exercise_id
    limit 1;

    if replacement is not null then
      repaired:=repaired||jsonb_build_array(jsonb_build_object(
        'position',idx+1,'removed_exercise_id',item->>'exercise_id','replacement_exercise_id',replacement->>'exercise_id',
        'reason',case when role='prep_only' then 'prep_only_forbidden' else 'prefer_wod_over_adaptation' end
      ));
      exs:=jsonb_set(exs,array[idx::text],replacement,true);
    end if;
  end loop;

  select count(*) filter(where e.wod_role='wod'),count(*) filter(where e.wod_role='adaptation'),count(*) filter(where e.wod_role='prep_only')
  into wod_count,adaptation_count,prep_count
  from jsonb_array_elements(exs) x join public.exercises e on e.id=x->>'exercise_id';

  r:=jsonb_set(r,'{exercises}',exs,true);
  r:=jsonb_set(r,'{c4_wod_role_adapter}',jsonb_build_object(
    'version','wod-role-repair-v3','wod_count',wod_count,'adaptation_count',adaptation_count,'prep_only_count',prep_count,
    'repairs',repaired,'wod_first_attempted_for_every_non_wod_movement',true,
    'adaptation_used_only_if_no_compatible_wod_replacement',adaptation_count>0,
    'prep_only_cleared',prep_count=0
  ),true);
  return r;
end;
$$;

create or replace function public.complete_workout_session_v2(
  p_session_id uuid,p_global_rpe integer,p_post_workout_feeling integer,p_notes text default null,
  p_exercises jsonb default '[]'::jsonb,p_protocol_outcome jsonb default null
) returns jsonb
language plpgsql
security definer
set search_path='public'
as $$
declare
  v_result jsonb; v_item jsonb; v_instance_id uuid; v_extra jsonb; v_augmented int:=0; v_user_id uuid; v_intent_sync jsonb:='{}'::jsonb;
begin
  v_result:=public.complete_workout_session_v1(p_session_id,p_global_rpe,p_post_workout_feeling,p_notes,p_exercises,p_protocol_outcome);

  for v_item in select value from jsonb_array_elements(coalesce(p_exercises,'[]'::jsonb)) loop
    begin v_instance_id:=(v_item->>'session_exercise_id')::uuid; exception when others then continue; end;
    v_extra:=coalesce(v_item->'performance_actual_json','{}'::jsonb);
    if jsonb_typeof(v_extra)='object' and v_extra<>'{}'::jsonb then
      update public.exercise_logs
      set actual_json=jsonb_strip_nulls(coalesce(actual_json,'{}'::jsonb)||v_extra||jsonb_build_object('performance_actual_contract','m7.2-v1')),
          comparison_context_json=coalesce(comparison_context_json,'{}'::jsonb)||jsonb_build_object('performance_actual_contract','m7.2-v1')
      where session_id=p_session_id and session_exercise_id=v_instance_id and source_kind='internal';
      if found then v_augmented:=v_augmented+1; end if;
    end if;
  end loop;

  select user_id into v_user_id from public.workout_sessions where id=p_session_id;
  if v_user_id is not null then v_intent_sync:=public.resolve_uncovered_pattern_intents_v1(v_user_id,p_session_id); end if;

  return v_result||jsonb_build_object(
    'completion_contract','m7.2-atomic-completion-v2-uncovered-pattern-v1',
    'performance_actual_rows_augmented',v_augmented,
    'uncovered_pattern_intent_sync',v_intent_sync
  );
end;
$$;
