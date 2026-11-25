create or replace function public.c4_difficulty_rank_v1(p_difficulty text)
returns int
language sql
immutable
as $$
  select case lower(coalesce(p_difficulty,''))
    when 'débutant' then 1
    when 'debutant' then 1
    when 'intermédiaire' then 2
    when 'intermediaire' then 2
    when 'avancé' then 3
    when 'avance' then 3
    else 2
  end;
$$;

create or replace function public.c4_warmup_candidate_for_target_v1(
  p_user_id uuid,
  p_target_exercise_id text,
  p_target_block text,
  p_excluded_exercise_ids text[] default '{}'::text[],
  p_all_target_exercise_ids text[] default '{}'::text[],
  p_zone_terms text[] default '{}'::text[],
  p_inventory jsonb default '[]'::jsonb,
  p_max_complexity int default 5
) returns jsonb
language plpgsql
stable
security definer
set search_path='public'
as $$
declare
  t record;
  c record;
begin
  select * into t from public.exercises where id=p_target_exercise_id;
  if not found then
    return jsonb_build_object('status','NO_TARGET');
  end if;

  select q.* into c
  from (
    select e.*,
      case
        when exists(
          select 1 from public.exercise_preparation_links l
          where l.active and l.target_exercise_id=t.id and l.warmup_exercise_id=e.id and l.link_type='specific_regression'
        ) then 1
        when exists(
          select 1 from public.exercise_variants ev
          where ev.exercise_id=t.id and ev.target_exercise_id=e.id and lower(ev.variant_type)='regression'
        ) then 2
        when exists(
          select 1 from public.exercise_preparation_links l
          where l.active and l.target_exercise_id=t.id and l.warmup_exercise_id=e.id and l.link_type='movement_prep'
        ) then 3
        when exists(
          select 1 from public.exercise_preparation_links l
          where l.active and l.target_exercise_id=t.id and l.warmup_exercise_id=e.id and l.link_type='pulse_raiser'
        ) then 4
        when e.id<>t.id and e.movement_pattern=t.movement_pattern and (
          coalesce(e.technical_complexity,99)<coalesce(t.technical_complexity,99)
          or public.c4_difficulty_rank_v1(e.difficulty)<public.c4_difficulty_rank_v1(t.difficulty)
          or coalesce(e.fatigue_score,99)<coalesce(t.fatigue_score,99)
        ) then 5
        when e.id<>t.id and exists(
          select 1
          from public.exercise_muscles tm
          join public.exercise_muscles cm on cm.muscle_id=tm.muscle_id and cm.priority='primary'
          where tm.exercise_id=t.id and tm.priority='primary' and cm.exercise_id=e.id
        ) and (
          coalesce(e.technical_complexity,99)<coalesce(t.technical_complexity,99)
          or public.c4_difficulty_rank_v1(e.difficulty)<public.c4_difficulty_rank_v1(t.difficulty)
          or coalesce(e.fatigue_score,99)<coalesce(t.fatigue_score,99)
        ) then 6
        when e.id<>t.id and e.exercise_family=t.exercise_family and (
          coalesce(e.technical_complexity,99)<coalesce(t.technical_complexity,99)
          or public.c4_difficulty_rank_v1(e.difficulty)<public.c4_difficulty_rank_v1(t.difficulty)
          or coalesce(e.fatigue_score,99)<coalesce(t.fatigue_score,99)
        ) then 7
        when lower(coalesce(p_target_block,''))='wod' and e.id=t.id and coalesce(t.technical_complexity,99)<=2 and coalesce(t.fatigue_score,99)<=3 then 8
        else 99
      end as warmup_tier,
      coalesce((
        select max(l.priority)::int from public.exercise_preparation_links l
        where l.active and l.target_exercise_id=t.id and l.warmup_exercise_id=e.id
          and l.link_type in ('specific_regression','movement_prep','pulse_raiser')
      ),0) as prep_priority
    from public.exercises e
    where not (e.id=any(coalesce(p_excluded_exercise_ids,'{}'::text[])))
      and (e.id=t.id or not (e.id=any(coalesce(p_all_target_exercise_ids,'{}'::text[]))))
      and (lower(coalesce(p_target_block,''))<>'skill' or e.id<>t.id)
      and public.exercise_safe_for_zones(e.id,public.normalize_body_zone_ids(coalesce(p_zone_terms,'{}'::text[])))
      and public.exercise_equipment_compatible(e.id,p_inventory)
      and coalesce(e.technical_complexity,99)<=p_max_complexity
      and coalesce(e.fatigue_score,99)<=3
      and coalesce(e.joint_impact,99)<=3
      and coalesce(e.warmup_role,'') not in ('mobility','activation')
      and (
        'WOD'=any(coalesce(e.usable_for,'{}'::text[]))
        or 'Skill'=any(coalesce(e.usable_for,'{}'::text[]))
        or 'Warm-up'=any(coalesce(e.usable_for,'{}'::text[]))
      )
  ) q
  where q.warmup_tier<99
    and (
      lower(coalesce(p_target_block,''))<>'skill'
      or q.warmup_tier in (1,2)
      or coalesce(q.technical_complexity,99)<coalesce(t.technical_complexity,99)
      or public.c4_difficulty_rank_v1(q.difficulty)<public.c4_difficulty_rank_v1(t.difficulty)
      or coalesce(q.fatigue_score,99)<coalesce(t.fatigue_score,99)
    )
  order by q.warmup_tier asc,q.prep_priority desc,coalesce(q.selection_weight,0) desc,coalesce(q.technical_complexity,99) asc,coalesce(q.fatigue_score,99) asc,q.id
  limit 1;

  if not found then
    return jsonb_build_object('status','NO_SAFE_CANDIDATE','target_exercise_id',t.id,'target_block',p_target_block);
  end if;

  return jsonb_build_object(
    'status','AVAILABLE',
    'target_exercise_id',t.id,
    'target_block',lower(coalesce(p_target_block,'')),
    'target_pattern',t.movement_pattern,
    'candidate_exercise_id',c.id,
    'candidate_name',coalesce(nullif(btrim(c.display_name),''),c.name),
    'candidate_pattern',c.movement_pattern,
    'candidate_family',c.exercise_family,
    'tier',c.warmup_tier,
    'prep_priority',c.prep_priority,
    'candidate_technical_complexity',c.technical_complexity,
    'candidate_fatigue_score',c.fatigue_score,
    'candidate_difficulty',c.difficulty
  );
end;
$$;

comment on function public.c4_warmup_candidate_for_target_v1(uuid,text,text,text[],text[],text[],jsonb,int) is
'Generic warm-up hierarchy: specific regression -> graph regression -> linked movement prep -> pulse raiser -> easier same pattern -> easier same primary muscle -> easier same family -> exact simple WOD only as last resort. Skill target itself is never allowed.';

insert into public.exercise_muscles(exercise_id,muscle_id,priority)
select v.exercise_id,em.muscle_id,em.priority
from (values
  ('EX470','EX024'),('EX471','EX024'),('EX472','EX024'),
  ('EX473','EX480'),('EX474','EX481'),('EX475','EX091'),
  ('EX476','EX156'),('EX478','EX044'),('EX479','EX044')
) v(exercise_id,source_id)
join public.exercise_muscles em on em.exercise_id=v.source_id
where not exists(
  select 1 from public.exercise_muscles x where x.exercise_id=v.exercise_id and x.muscle_id=em.muscle_id
);

update public.exercises
set display_name=case id
  when 'EXW001' then 'Down-Ups'
  when 'EXW002' then 'Down-Ups contrôlés'
  when 'EXW007' then 'Single Unders'
  when 'EX156' then 'Single Unders'
  else display_name end
where id in ('EXW001','EXW002','EXW007','EX156');

create or replace function public.c4_apply_preparation_quality_v3(
  p_user_id uuid,
  p_plan jsonb,
  p_zone_terms text[] default '{}'::text[],
  p_inventory jsonb default '[]'::jsonb,
  p_target_region text default null,
  p_max_complexity integer default 3,
  p_progression_intent text default null
) returns jsonb
language plpgsql
stable
set search_path='public'
as $$
declare
  r jsonb:=coalesce(p_plan,'{}'::jsonb);
  v_blocks jsonb:='[]'::jsonb;
  v_block jsonb;
  v_new jsonb;
  v_count int;
  v_duration int;
  v_rounds int:=3;
  v_total_sec int;
  v_alloc_total int;
  v_per_round_sec int;
  v_slot int;
  v_target_ids text[]:='{}'::text[];
  v_target_patterns text[]:='{}'::text[];
  v_selected_ids text[]:='{}'::text[];
  v_selected_families text[]:='{}'::text[];
  v_prepared_patterns text[]:='{}'::text[];
  v_family_key text;
  v_candidate jsonb;
  v_pres jsonb;
  v_expected jsonb;
  v_linked_ids text[];
  target_rec record;
  rec record;
begin
  if coalesce(r->>'status','')<>'READY' then return r; end if;

  select coalesce(array_agg(distinct x.exercise_id) filter(where x.exercise_id is not null),'{}'::text[]),
         coalesce(array_agg(distinct e.movement_pattern) filter(where e.movement_pattern is not null),'{}'::text[])
  into v_target_ids,v_target_patterns
  from (
    select coalesce(ex->>'exercise_id',ex->>'id') exercise_id
    from jsonb_array_elements(coalesce(r->'blocks','[]'::jsonb)) b
    cross join lateral jsonb_array_elements(coalesce(b->'exercises','[]'::jsonb)) ex
    where b->>'block_key' in ('skill','wod')
  ) x
  left join public.exercises e on e.id=x.exercise_id;

  for v_block in select value from jsonb_array_elements(coalesce(r->'blocks','[]'::jsonb)) loop
    if v_block->>'block_key' not in ('unlock','warmup') then
      v_blocks:=v_blocks||jsonb_build_array(v_block);
      continue;
    end if;

    v_count:=jsonb_array_length(coalesce(v_block->'exercises','[]'::jsonb));
    if v_count<=0 then
      v_blocks:=v_blocks||jsonb_build_array(v_block);
      continue;
    end if;

    v_duration:=coalesce(nullif(v_block->>'duration_minutes','')::int,1);
    v_total_sec:=greatest(60,v_duration*60);
    v_new:='[]'::jsonb;
    v_selected_ids:='{}'::text[];
    v_selected_families:='{}'::text[];

    if v_block->>'block_key'='unlock' then
      for v_slot in 1..v_count loop
        select q.* into rec
        from (
          select e.*,
                 public.c4_preparation_family_key_v1(e.id) family_key,
                 coalesce(l.coverage,0) link_coverage,
                 coalesce(l.max_priority,0) link_priority,
                 coalesce(l.prepares_ids,'{}'::text[]) linked_target_ids,
                 (select count(*) from public.workout_session_exercises wse
                  join public.workout_sessions ws on ws.id=wse.session_id
                  where ws.user_id=p_user_id and ws.status='completed'
                    and wse.exercise_id=e.id and wse.block_key='unlock'
                    and ws.id in (select id from public.workout_sessions where user_id=p_user_id and status='completed' order by coalesce(completed_at,created_at) desc limit 6)) recent_count
          from public.exercises e
          left join lateral (
            select count(distinct pl.target_exercise_id)::int coverage,
                   max(pl.priority)::int max_priority,
                   array_agg(distinct pl.target_exercise_id)::text[] prepares_ids
            from public.exercise_preparation_links pl
            where pl.active and pl.warmup_exercise_id=e.id
              and pl.target_exercise_id=any(v_target_ids)
              and pl.link_type in ('activation','mobility')
          ) l on true
          where 'Warm-up'=any(coalesce(e.usable_for,'{}'::text[]))
            and coalesce(e.warmup_eligible,false)
            and e.warmup_role in ('mobility','activation')
            and coalesce(e.warmup_intensity,99)<=2
            and coalesce(e.fatigue_score,99)<=2
            and coalesce(e.joint_impact,99)<=2
            and coalesce(e.technical_complexity,99)<=p_max_complexity
            and not(e.id=any(v_selected_ids))
            and not(public.c4_preparation_family_key_v1(e.id)=any(v_selected_families))
            and public.exercise_safe_for_zones(e.id,public.normalize_body_zone_ids(coalesce(p_zone_terms,'{}'::text[])))
            and public.exercise_equipment_compatible(e.id,p_inventory)
        ) q
        order by
          case
            when v_slot=1 and q.warmup_role='mobility' then 0
            when v_slot=1 then 1
            when v_slot>1 and q.link_coverage>0 then 0
            when v_slot>1 and q.warmup_role='activation' then 1
            else 2 end,
          q.link_coverage desc,q.link_priority desc,q.recent_count asc,coalesce(q.selection_weight,0) desc,q.id
        limit 1;

        if not found then exit; end if;

        v_family_key:=rec.family_key;
        v_alloc_total:=greatest(30,v_total_sec/v_count);
        v_pres:=(public.c2_solver_prescription(p_user_id,rec.id,coalesce(r->'stimulus','{}'::jsonb),'WARMUP',p_progression_intent,p_inventory)
                 -'target_rpe_min'-'target_rpe_max'-'target_duration_minutes')
          ||jsonb_build_object(
            'block_role','unlock','unlock_role',rec.warmup_role,
            'activation_counts_as_unlock',rec.warmup_role='activation',
            'allocated_duration_seconds',v_alloc_total,
            'fatigue_target','minimal','effort_semantics','easy_mobility_or_activation_no_rpe_target',
            'preparation_quality_version','preparation-v3'
          );
        v_expected:=jsonb_build_object(
          'block_key','unlock','goal','mobility_and_light_activation_without_fatigue',
          'pain_gate',true,'equipment_gate',true,'activation_counts_as_unlock',rec.warmup_role='activation',
          'prepares_exercise_ids',to_jsonb(coalesce(rec.linked_target_ids,'{}'::text[]))
        );
        v_new:=v_new||jsonb_build_array(jsonb_build_object(
          'exercise_id',rec.id,'name',coalesce(nullif(btrim(rec.display_name),''),rec.name),
          'pattern',rec.movement_pattern,'family',rec.exercise_family,'warmup_role',rec.warmup_role,
          'preparation_family_key',v_family_key,'prescription',v_pres,'expected_outcome',v_expected
        ));
        v_selected_ids:=array_append(v_selected_ids,rec.id);
        v_selected_families:=array_append(v_selected_families,v_family_key);
      end loop;

      if jsonb_array_length(v_new)>0 then
        v_block:=v_block||jsonb_build_object(
          'exercises',v_new,
          'structure','Mobilité + activation légère · sans fatigue',
          'preparation_quality_contract',jsonb_build_object(
            'version','preparation-v3','unlock_contains_mobility_and_activation',true,
            'activation_is_not_specific_warmup',true,'recent_history_completed_only',true
          )
        );
      end if;

    else
      v_prepared_patterns:='{}'::text[];
      v_rounds:=3;
      v_alloc_total:=greatest(30,v_total_sec/v_count);
      v_per_round_sec:=greatest(10,v_alloc_total/v_rounds);

      -- Pass 1: one preparation movement for each distinct Skill/WOD pattern, Skill first.
      for target_rec in
        with raw as (
          select b->>'block_key' target_block,
                 coalesce(ex->>'exercise_id',ex->>'id') target_id,
                 bord,eord
          from jsonb_array_elements(coalesce(r->'blocks','[]'::jsonb)) with ordinality bz(b,bord)
          cross join lateral jsonb_array_elements(coalesce(b->'exercises','[]'::jsonb)) with ordinality ez(ex,eord)
          where b->>'block_key' in ('skill','wod')
        )
        select distinct on (raw.target_id)
               raw.target_id,raw.target_block,e.movement_pattern,e.exercise_family,e.technical_complexity,e.fatigue_score,raw.bord,raw.eord
        from raw join public.exercises e on e.id=raw.target_id
        order by raw.target_id,case when raw.target_block='skill' then 0 else 1 end,raw.bord,raw.eord
      loop
        exit when jsonb_array_length(v_new)>=v_count;
        if target_rec.movement_pattern is not null and target_rec.movement_pattern=any(v_prepared_patterns) then
          continue;
        end if;

        v_candidate:=public.c4_warmup_candidate_for_target_v1(
          p_user_id,target_rec.target_id,target_rec.target_block,v_selected_ids,v_target_ids,
          p_zone_terms,p_inventory,p_max_complexity
        );
        if coalesce(v_candidate->>'status','')<>'AVAILABLE' then continue; end if;

        select * into rec from public.exercises where id=v_candidate->>'candidate_exercise_id';
        if not found then continue; end if;

        v_pres:=(public.c2_solver_prescription(p_user_id,rec.id,coalesce(r->'stimulus','{}'::jsonb),'WARMUP',p_progression_intent,p_inventory)
                 -'target_rpe_min'-'target_rpe_max'-'target_duration_minutes'-'load_kg'-'load_resolution')
          ||jsonb_build_object(
            'block_role','warmup','warmup_role','movement_prep','warmup_rounds',v_rounds,
            'warmup_target_exercise_id',target_rec.target_id,'warmup_target_block',target_rec.target_block,
            'warmup_derivation_tier',(v_candidate->>'tier')::int,
            'allocated_duration_seconds',v_alloc_total,'per_round_target_seconds',v_per_round_sec,
            'fatigue_target','low','effort_semantics','easy_progressive_movement_prep_no_rpe_target',
            'preparation_quality_version','preparation-v3'
          );

        if rec.movement_pattern='Conditioning' then
          v_pres:=v_pres-'reps_min'-'reps_max';
          v_pres:=v_pres||jsonb_build_object('duration_seconds_min',least(20,v_per_round_sec),'duration_seconds_max',least(25,greatest(20,v_per_round_sec)),'prescription_type','time_interval');
        elsif lower(coalesce(rec.prescription_type,''))='isometric' then
          v_pres:=v_pres-'reps_min'-'reps_max';
          v_pres:=v_pres||jsonb_build_object('duration_seconds_min',15,'duration_seconds_max',least(25,greatest(20,v_per_round_sec)));
        elsif v_pres ? 'reps_min' or v_pres ? 'reps_max' then
          v_pres:=jsonb_set(v_pres,'{reps_min}',to_jsonb(case when coalesce(rec.fatigue_score,1)>=3 then 5 else 6 end),true);
          v_pres:=jsonb_set(v_pres,'{reps_max}',to_jsonb(case when coalesce(rec.fatigue_score,1)>=3 then 8 else 10 end),true);
        end if;

        v_expected:=jsonb_build_object(
          'block_key','warmup','goal','easier_movement_preparation_for_skill_and_wod',
          'pain_gate',true,'equipment_gate',true,'warmup_rounds',v_rounds,
          'target_exercise_id',target_rec.target_id,'target_block',target_rec.target_block,
          'derivation_tier',(v_candidate->>'tier')::int,
          'skill_target_must_be_easier',target_rec.target_block='skill'
        );

        v_new:=v_new||jsonb_build_array(jsonb_build_object(
          'exercise_id',rec.id,'name',coalesce(nullif(btrim(rec.display_name),''),rec.name),
          'pattern',rec.movement_pattern,'family',rec.exercise_family,'warmup_role','movement_prep',
          'prescription',v_pres,'expected_outcome',v_expected
        ));
        v_selected_ids:=array_append(v_selected_ids,rec.id);
        if target_rec.movement_pattern is not null then v_prepared_patterns:=array_append(v_prepared_patterns,target_rec.movement_pattern); end if;
      end loop;

      -- Pass 2: if the architecture asks for more movements than distinct targets, add a safe low-fatigue movement prep.
      while jsonb_array_length(v_new)<v_count loop
        select e.* into rec
        from public.exercises e
        where 'Warm-up'=any(coalesce(e.usable_for,'{}'::text[]))
          and coalesce(e.warmup_eligible,false)
          and e.warmup_role in ('movement_prep','pulse_raiser')
          and coalesce(e.warmup_intensity,99)<=2
          and coalesce(e.fatigue_score,99)<=2
          and coalesce(e.joint_impact,99)<=2
          and coalesce(e.technical_complexity,99)<=p_max_complexity
          and not(e.id=any(v_selected_ids))
          and public.exercise_safe_for_zones(e.id,public.normalize_body_zone_ids(coalesce(p_zone_terms,'{}'::text[])))
          and public.exercise_equipment_compatible(e.id,p_inventory)
        order by case when e.movement_pattern=any(v_target_patterns) then 0 else 1 end,
                 (select count(*) from public.workout_session_exercises wse join public.workout_sessions ws on ws.id=wse.session_id
                  where ws.user_id=p_user_id and ws.status='completed' and wse.exercise_id=e.id and wse.block_key='warm_up') asc,
                 coalesce(e.selection_weight,0) desc,e.id
        limit 1;
        if not found then exit; end if;

        v_pres:=(public.c2_solver_prescription(p_user_id,rec.id,coalesce(r->'stimulus','{}'::jsonb),'WARMUP',p_progression_intent,p_inventory)
                 -'target_rpe_min'-'target_rpe_max'-'target_duration_minutes'-'load_kg'-'load_resolution')
          ||jsonb_build_object(
            'block_role','warmup','warmup_role','movement_prep','warmup_rounds',v_rounds,
            'warmup_derivation_tier',9,'allocated_duration_seconds',v_alloc_total,'per_round_target_seconds',v_per_round_sec,
            'fatigue_target','low','effort_semantics','easy_progressive_movement_prep_no_rpe_target','preparation_quality_version','preparation-v3'
          );
        if rec.movement_pattern='Conditioning' then
          v_pres:=v_pres-'reps_min'-'reps_max';
          v_pres:=v_pres||jsonb_build_object('duration_seconds_min',least(20,v_per_round_sec),'duration_seconds_max',least(25,greatest(20,v_per_round_sec)),'prescription_type','time_interval');
        elsif v_pres ? 'reps_min' or v_pres ? 'reps_max' then
          v_pres:=jsonb_set(v_pres,'{reps_min}',to_jsonb(6),true);
          v_pres:=jsonb_set(v_pres,'{reps_max}',to_jsonb(10),true);
        end if;

        v_new:=v_new||jsonb_build_array(jsonb_build_object(
          'exercise_id',rec.id,'name',coalesce(nullif(btrim(rec.display_name),''),rec.name),
          'pattern',rec.movement_pattern,'family',rec.exercise_family,'warmup_role','movement_prep',
          'prescription',v_pres,
          'expected_outcome',jsonb_build_object('block_key','warmup','goal','general_low_fatigue_movement_prep','warmup_rounds',v_rounds,'pain_gate',true,'equipment_gate',true)
        ));
        v_selected_ids:=array_append(v_selected_ids,rec.id);
      end loop;

      if jsonb_array_length(v_new)>0 then
        v_block:=v_block||jsonb_build_object(
          'exercises',v_new,
          'warmup_rounds',v_rounds,
          'structure',v_rounds||' tours · mouvements simplifiés du Skill et du WOD',
          'preparation_quality_contract',jsonb_build_object(
            'version','preparation-v3','rounds',v_rounds,
            'movement_prep_only',true,'activation_routed_to_unlock',true,
            'skill_exact_exercise_forbidden',true,'skill_candidate_must_be_easier',true,
            'fallback_hierarchy',jsonb_build_array('specific_regression','graph_regression','linked_movement_prep','pulse_raiser','easier_same_pattern','easier_same_primary_muscle','easier_same_family','exact_simple_wod_last_resort'),
            'recent_history_completed_only',true
          )
        );
      end if;
    end if;

    v_blocks:=v_blocks||jsonb_build_array(v_block);
  end loop;

  r:=jsonb_set(r,'{blocks}',v_blocks,true);
  r:=jsonb_set(r,'{architecture,preparation_quality_version}',to_jsonb('preparation-v3'::text),true);
  r:=jsonb_set(r,'{architecture,warmup_variety_version}',to_jsonb('preparation-v3'::text),true);
  return r;
end;
$$;

comment on function public.c4_apply_preparation_quality_v3(uuid,jsonb,text[],jsonb,text,int,text) is
'UGEROD preparation v3: Unlock receives mobility + light activation. Warm-up is a 3-round low-fatigue circuit derived from Skill/WOD via regression -> pattern -> muscle fallbacks. Skill target itself is forbidden.';

do $$
declare v_oid oid; v_sql text; begin
  select p.oid into v_oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.prokind='f' and p.proname='c4_plan_full_session' limit 1;
  if v_oid is null then raise exception 'c4_plan_full_session not found'; end if;
  v_sql:=pg_get_functiondef(v_oid);
  if position('c4_apply_preparation_quality_v2' in v_sql)=0 then raise exception 'v2 call not found in c4_plan_full_session'; end if;
  execute replace(v_sql,'c4_apply_preparation_quality_v2','c4_apply_preparation_quality_v3');

  select p.oid into v_oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.prokind='f' and p.proname='c4_refresh_specific_warmup_session_v1' limit 1;
  if v_oid is null then raise exception 'c4_refresh_specific_warmup_session_v1 not found'; end if;
  v_sql:=pg_get_functiondef(v_oid);
  if position('c4_apply_preparation_quality_v2' in v_sql)=0 then raise exception 'v2 call not found in refresh function'; end if;
  execute replace(v_sql,'c4_apply_preparation_quality_v2','c4_apply_preparation_quality_v3');
end $$;