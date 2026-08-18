

-- SOURCE MIGRATION: 20260818135710_prefer_structure_preservation_in_wod_fallback_v1.sql
create or replace function public.c4_best_reduced_wod_mechanic_v1(
  p_user_id uuid,
  p_session_id uuid,
  p_candidate jsonb,
  p_current_mechanic text
) returns jsonb
language sql
stable
security definer
set search_path='public'
as $$
  select coalesce((
    select jsonb_build_object(
      'status','AVAILABLE',
      'mechanic',wm.mechanic_key,
      'mechanic_fit',public.c2_mechanic_fit(wm.mechanic_key,ws.expected_stimulus_json,ws.progression_intent),
      'retained_exercise_count',jsonb_array_length(coalesce(preview#>'{candidate,exercises}','[]'::jsonb)),
      'preview',preview,
      'selection_rule','preserve_remaining_movements_then_mechanic_fit'
    )
    from public.workout_sessions ws
    join public.workout_mechanics wm on wm.active and wm.mechanic_kind='core'
    cross join lateral (
      select public.c4_compile_reduced_wod_for_mechanic_v1(p_user_id,p_session_id,p_candidate,wm.mechanic_key) preview
    ) p
    where ws.id=p_session_id and ws.user_id=p_user_id
      and wm.mechanic_key<>upper(coalesce(p_current_mechanic,''))
      and preview->>'status'='AVAILABLE'
    order by
      jsonb_array_length(coalesce(preview#>'{candidate,exercises}','[]'::jsonb)) desc,
      public.c2_mechanic_fit(wm.mechanic_key,ws.expected_stimulus_json,ws.progression_intent) desc,
      wm.mechanic_key
    limit 1
  ),jsonb_build_object('status','NONE'));
$$;

create or replace function public.c4_wod_structural_fallback_v1(
  p_user_id uuid,
  p_session_exercise_id uuid,
  p_reason text default 'environment',
  p_confirm_structure_change boolean default false
) returns jsonb
language plpgsql
security definer
set search_path='public'
as $$
declare
  target record;
  ws public.workout_sessions%rowtype;
  v_base jsonb;
  v_reduced_exercises jsonb;
  v_reduced jsonb;
  v_prepared jsonb;
  v_final jsonb;
  v_gate jsonb;
  v_inventory jsonb;
  v_names text[];
  v_wod_minutes int;
  v_max_complexity int;
  v_current_mechanic text;
  v_current_ok boolean:=false;
  v_alt_mechanic text:=null;
  v_alt_final jsonb:=null;
  v_alt_gate jsonb:=null;
  v_best jsonb:=null;
  v_alt_preview jsonb:=null;
  v_result jsonb;
  v_intent jsonb:='{}'::jsonb;
  v_ledger jsonb:='{}'::jsonb;
  v_pending jsonb:='{}'::jsonb;
  v_pending_confirmed boolean:=false;
  v_detached_id uuid:=null;
  v_prompt text;
  v_alt_duration numeric:=null;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;

  select wse.*,e.movement_pattern,e.exercise_family into target
  from public.workout_session_exercises wse
  join public.workout_sessions s on s.id=wse.session_id and s.user_id=p_user_id
  join public.exercises e on e.id=wse.exercise_id
  where wse.id=p_session_exercise_id;
  if not found then raise exception 'Session exercise instance not found'; end if;
  if target.block_key<>'wod' then return jsonb_build_object('status','NOT_SUPPORTED','reason','STRUCTURAL_FALLBACK_WOD_ONLY','mutated',false); end if;

  select * into ws from public.workout_sessions where id=target.session_id and user_id=p_user_id for update;
  if ws.status not in ('generated','in_progress') then return jsonb_build_object('status','NOT_AVAILABLE','reason','SESSION_NOT_MUTABLE','mutated',false); end if;
  if ws.wod_started_at is not null then
    return jsonb_build_object('status','NOT_AVAILABLE','reason','STRUCTURAL_FALLBACK_LOCKED_AFTER_WOD_START','mutated',false,'session_id',target.session_id,'session_exercise_id',p_session_exercise_id);
  end if;

  v_pending:=coalesce(ws.planning_context_json->'pending_structural_fallback','{}'::jsonb);
  v_pending_confirmed:=coalesce(p_confirm_structure_change,false) or (
    v_pending->>'session_exercise_id'=p_session_exercise_id::text
    and lower(coalesce(v_pending->>'reason',''))=lower(coalesce(p_reason,''))
    and nullif(v_pending->>'requested_at','')::timestamptz>now()-interval '5 minutes'
  );

  v_base:=public.c4_session_wod_candidate(target.session_id);
  if jsonb_array_length(coalesce(v_base->'exercises','[]'::jsonb))<=1 then
    return jsonb_build_object('status','NO_STRUCTURAL_FALLBACK','reason','CANNOT_REMOVE_LAST_WOD_MOVEMENT','mutated',false,'session_id',target.session_id,'session_exercise_id',p_session_exercise_id);
  end if;

  select coalesce(jsonb_agg(x.value order by x.ord),'[]'::jsonb) into v_reduced_exercises
  from jsonb_array_elements(coalesce(v_base->'exercises','[]'::jsonb)) with ordinality x(value,ord)
  where x.ord<>target.position;

  v_reduced:=jsonb_set(v_base,'{exercises}',v_reduced_exercises,true);
  v_current_mechanic:=upper(coalesce(v_base->>'mechanic',ws.mechanic_json->>'mechanic_key','CIRCUIT'));
  v_names:=coalesce(ws.available_equipment,'{}'::text[]); if cardinality(v_names)=0 then v_names:=array['Aucun']; end if;
  v_inventory:=public.resolve_user_equipment_inventory(p_user_id,v_names,'c4-final-default');
  v_wod_minutes:=coalesce(nullif(ws.mechanic_json->>'wod_budget_minutes','')::int,(select nullif(b->>'duration_minutes','')::int from jsonb_array_elements(coalesce(ws.generated_workout->'blocks','[]'::jsonb)) b where b->>'block_key'='wod' limit 1),10);
  v_max_complexity:=public.c4_user_max_swap_complexity(p_user_id,ws.readiness);

  v_prepared:=public.c4_prepare_candidate(v_reduced,'c4-final-default');
  v_final:=public.c4_finalize_candidate(v_prepared,ws.expected_stimulus_json,coalesce(ws.duration_minutes,45),v_wod_minutes,'c4-final-default','c3-sim-default');
  v_gate:=public.c4_candidate_quality_gate_v2(v_final,coalesce(ws.readiness,'normal'),coalesce(ws.focus,'General Fitness'),ws.target_region,coalesce(ws.injured_zones,'{}'::text[]),v_inventory,v_max_complexity,'c4-final-default');
  v_current_ok:=coalesce((v_final#>>'{c4_final,feasible}')::boolean,false) and coalesce((v_gate->>'pass')::boolean,false);

  if v_current_ok then
    v_result:=public.c4_apply_wod_candidate(p_user_id,target.session_id,v_final,v_gate,'STRUCTURAL_FALLBACK_REMOVE:'||target.exercise_id);
    v_detached_id:=public.c4_detach_recompiled_wod_instance_v1(p_user_id,target.session_id,p_session_exercise_id);
    if lower(coalesce(p_reason,'')) in ('equipment','environment') then v_intent:=public.record_uncovered_pattern_intent_v1(p_user_id,target.session_id,target.exercise_id,p_reason); end if;
    begin v_ledger:=public.d_sync_session_stimulus_ledger(target.session_id); exception when others then v_ledger:=jsonb_build_object('status','LEDGER_SYNC_SKIPPED'); end;
    update public.workout_sessions set planning_context_json=(coalesce(planning_context_json,'{}'::jsonb)-'pending_structural_fallback')||jsonb_build_object('last_structural_fallback',jsonb_build_object('version','structural-fallback-v1.3','applied_at',now(),'removed_exercise_id',target.exercise_id,'reason',p_reason,'old_mechanic',v_current_mechanic,'new_mechanic',v_current_mechanic,'mechanic_changed',false,'uncovered_pattern',target.movement_pattern)),updated_at=now() where id=target.session_id and user_id=p_user_id;
    return jsonb_build_object('status','STRUCTURAL_FALLBACK_APPLIED','mutated',true,'session_id',target.session_id,'removed_session_exercise_id',p_session_exercise_id,'removed_exercise_id',target.exercise_id,'removed_pattern',target.movement_pattern,'old_mechanic',v_current_mechanic,'new_mechanic',v_current_mechanic,'mechanic_changed',false,'rebalanced',true,'detached_recompiled_instance_id',v_detached_id,'result',v_result,'uncovered_pattern_intent',v_intent,'ledger_sync',v_ledger,'version','structural-fallback-v1.3');
  end if;

  v_best:=public.c4_best_reduced_wod_mechanic_v1(p_user_id,target.session_id,v_reduced,v_current_mechanic);
  if v_best->>'status'='AVAILABLE' then
    v_alt_mechanic:=v_best->>'mechanic';
    v_alt_preview:=v_best->'preview';
    v_alt_final:=v_alt_preview->'candidate';
    v_alt_gate:=v_alt_preview->'quality_gate';
  end if;

  if v_alt_mechanic is null then return jsonb_build_object('status','NO_STRUCTURAL_FALLBACK','mutated',false,'session_id',target.session_id,'session_exercise_id',p_session_exercise_id,'removed_exercise_id',target.exercise_id,'reason','NO_FEASIBLE_REBALANCED_WOD','version','structural-fallback-v1.3'); end if;

  v_alt_duration:=coalesce(nullif(v_alt_final#>>'{c4_final,mechanic_json,parameters,duration_minutes}','')::numeric,nullif(v_alt_final#>>'{c4_final,mechanic_json,wod_budget_minutes}','')::numeric,v_wod_minutes);

  if not v_pending_confirmed then
    v_prompt:='Sans ce mouvement, UGEROD propose '||replace(v_alt_mechanic,'_',' ')||case when v_alt_duration is not null then ' · '||trim(to_char(v_alt_duration,'FM999990.##'))||' min' else '' end||'. Appuie à nouveau sur le même choix pour confirmer.';
    update public.workout_sessions set planning_context_json=coalesce(planning_context_json,'{}'::jsonb)||jsonb_build_object('pending_structural_fallback',jsonb_build_object('version','structural-fallback-v1.3','requested_at',now(),'session_exercise_id',p_session_exercise_id,'exercise_id',target.exercise_id,'reason',p_reason,'old_mechanic',v_current_mechanic,'proposed_mechanic',v_alt_mechanic,'retained_exercise_count',v_best->'retained_exercise_count','proposed_parameters',coalesce(v_alt_final#>'{c4_final,mechanic_json,parameters}','{}'::jsonb))),updated_at=now() where id=target.session_id and user_id=p_user_id;
    return jsonb_build_object('status','STRUCTURAL_CHANGE_REQUIRED','mutated',false,'session_id',target.session_id,'session_exercise_id',p_session_exercise_id,'removed_exercise_id',target.exercise_id,'removed_pattern',target.movement_pattern,'old_mechanic',v_current_mechanic,'proposed_mechanic',v_alt_mechanic,'retained_exercise_count',v_best->'retained_exercise_count','proposed_parameters',coalesce(v_alt_final#>'{c4_final,mechanic_json,parameters}','{}'::jsonb),'message',v_prompt,'requires_user_confirmation',true,'confirmation_mode','repeat_same_reason_within_5_minutes','selection_rule','preserve_remaining_movements_then_mechanic_fit','version','structural-fallback-v1.3');
  end if;

  v_result:=public.c4_apply_wod_candidate(p_user_id,target.session_id,v_alt_final,v_alt_gate,'STRUCTURAL_FALLBACK_FORMAT:'||v_current_mechanic||'->'||v_alt_mechanic);
  v_detached_id:=public.c4_detach_recompiled_wod_instance_v1(p_user_id,target.session_id,p_session_exercise_id);
  if lower(coalesce(p_reason,'')) in ('equipment','environment') then v_intent:=public.record_uncovered_pattern_intent_v1(p_user_id,target.session_id,target.exercise_id,p_reason); end if;
  begin v_ledger:=public.d_sync_session_stimulus_ledger(target.session_id); exception when others then v_ledger:=jsonb_build_object('status','LEDGER_SYNC_SKIPPED'); end;
  update public.workout_sessions set planning_context_json=(coalesce(planning_context_json,'{}'::jsonb)-'pending_structural_fallback')||jsonb_build_object('last_structural_fallback',jsonb_build_object('version','structural-fallback-v1.3','applied_at',now(),'removed_exercise_id',target.exercise_id,'reason',p_reason,'old_mechanic',v_current_mechanic,'new_mechanic',v_alt_mechanic,'mechanic_changed',true,'user_confirmed',true,'uncovered_pattern',target.movement_pattern)),updated_at=now() where id=target.session_id and user_id=p_user_id;
  return jsonb_build_object('status','STRUCTURAL_FALLBACK_APPLIED','mutated',true,'session_id',target.session_id,'removed_session_exercise_id',p_session_exercise_id,'removed_exercise_id',target.exercise_id,'removed_pattern',target.movement_pattern,'old_mechanic',v_current_mechanic,'new_mechanic',v_alt_mechanic,'mechanic_changed',true,'user_confirmed',true,'retained_exercise_count',v_best->'retained_exercise_count','rebalanced',true,'detached_recompiled_instance_id',v_detached_id,'result',v_result,'uncovered_pattern_intent',v_intent,'ledger_sync',v_ledger,'selection_rule','preserve_remaining_movements_then_mechanic_fit','version','structural-fallback-v1.3');
end;
$$;



-- SOURCE MIGRATION: 20260818140500_split_parallettes_and_dip_station_equipment.sql
begin;

insert into public.equipment (id, name, category, description)
values (
  'E19',
  'Parallettes',
  'Gym',
  'Petites barres parallèles basses au sol pour supports, L-Sit et exercices de gymnastique.'
)
on conflict (id) do update
set name = excluded.name,
    category = excluded.category,
    description = excluded.description;

update public.equipment
set description = 'Barres parallèles hautes ou station de dips permettant au corps de descendre entre les appuis.'
where id = 'E13';

update public.exercises
set name = 'Support Hold sur supports parallèles',
    description = 'Maintien bras tendus sur parallettes ou barres parallèles pour construire le support nécessaire aux dips et au L-Sit.'
where id = 'EX470';

update public.exercises
set name = 'Dip négatif aux barres parallèles',
    description = 'Descente contrôlée en dip sur barres parallèles ou station dips pour développer force et contrôle dans l’amplitude.'
where id = 'EX471';

update public.exercises
set name = 'Dip strict aux barres parallèles',
    description = 'Dip strict sur barres parallèles ou station dips avec contrôle complet de l’amplitude.'
where id = 'EX472';

delete from public.exercise_equipment
where exercise_id in ('EX470','EX471','EX472','EX473','EX474','EX475')
  and equipment_id in ('E13','E19');

insert into public.exercise_equipment (exercise_id, equipment_id)
values
  ('EX470','E13'),
  ('EX470','E19'),
  ('EX471','E13'),
  ('EX472','E13'),
  ('EX473','E19'),
  ('EX474','E19'),
  ('EX475','E19')
on conflict do nothing;

delete from public.exercise_equipment_requirements_v2
where exercise_id in ('EX470','EX471','EX472','EX473','EX474','EX475')
  and equipment_id in ('E13','E19');

insert into public.exercise_equipment_requirements_v2
  (exercise_id, option_group, equipment_id, min_quantity, is_optional, notes)
values
  ('EX470',1,'E13',1,false,'Barres parallèles hautes / station dips utilisables pour le Support Hold.'),
  ('EX470',2,'E19',1,false,'Parallettes basses utilisables comme alternative pour le Support Hold.'),
  ('EX471',1,'E13',1,false,'Barres parallèles hautes / station dips requises pour permettre la descente du corps.'),
  ('EX472',1,'E13',1,false,'Barres parallèles hautes / station dips requises pour permettre une amplitude complète.'),
  ('EX473',1,'E19',1,false,'Parallettes basses requises pour le Tuck L-Sit.'),
  ('EX474',1,'E19',1,false,'Parallettes basses requises pour le L-Sit une jambe.'),
  ('EX475',1,'E19',1,false,'Parallettes basses requises pour le L-Sit.')
on conflict (exercise_id, option_group, equipment_id) do update
set min_quantity = excluded.min_quantity,
    is_optional = excluded.is_optional,
    notes = excluded.notes;

commit;



-- SOURCE MIGRATION: 20260818140831_common_exercise_display_names_v1.sql
update public.exercises
set display_name=case id
  when 'EX421' then 'Mobilité cheville'
  when 'EX422' then '90/90 hanches'
  when 'EX430' then 'Pont fessier'
  when 'EX433' then 'Dead Bug'
  when 'EX439' then 'Pompes scapulaires au mur'
  when 'EX444' then 'Cercles de bras'
  when 'EXW006' then 'Élévation bras à genoux'
  when 'EXW012' then 'Cercles de poignets'
  when 'EXW015' then 'Pompes scapulaires à 4 pattes'
  when 'EXW016' then 'Élévation bras au mur'
  when 'EXW019' then 'Fentes arrière + reach'
  when 'EXW029' then 'Pompes au mur lentes'
  when 'EX315' then 'Shoulder Taps'
  when 'EX051' then 'Fentes arrière'
  when 'EX478' then 'Pistol assisté'
  when 'EX314' then 'Pas chassés'
  when 'EX027' then 'Handstand Hold'
  else display_name end
where id in ('EX421','EX422','EX430','EX433','EX439','EX444','EXW006','EXW012','EXW015','EXW016','EXW019','EXW029','EX315','EX051','EX478','EX314','EX027');

update public.workout_sessions
set generated_workout=public.ugerod_apply_display_names_to_workout_v1(generated_workout),updated_at=updated_at
where status in ('generated','in_progress') and generated_workout is not null;

update public.workout_session_exercises wse
set exercise_name=coalesce(nullif(btrim(e.display_name),''),e.name),updated_at=wse.updated_at
from public.exercises e
where e.id=wse.exercise_id and wse.status='pending';



-- SOURCE MIGRATION: 20260818141000_complete_equipment_requirements_v2_coverage.sql
insert into public.exercise_equipment_requirements_v2
  (exercise_id, option_group, equipment_id, min_quantity, is_optional, notes)
values
  ('EXW007',1,'E02',1,false,'Corde à sauter requise pour Easy Single Under.'),
  ('EXW008',1,'E10',1,false,'Box requise pour Box Step-Up Prep.')
on conflict (exercise_id, option_group, equipment_id) do update
set min_quantity=excluded.min_quantity,
    is_optional=excluded.is_optional,
    notes=excluded.notes;



-- SOURCE MIGRATION: 20260818142500_l_sit_floor_parallettes_equivalents_v1.sql
update public.exercises
set name = 'L-Sit au sol'
where id = 'EX091' and name = 'L-Sit sol';

insert into public.exercise_variants (
  exercise_id,
  target_exercise_id,
  variant_type,
  relation_axis,
  constraint_relief,
  stimulus_similarity,
  priority,
  is_preferred,
  coach_note
)
values
  (
    'EX473','EX480','equivalent','support',array['equipment']::text[],96,10,true,
    'Même étape de Tuck L-Sit sans parallettes ; privilégier cette variante si les parallettes sont indisponibles.'
  ),
  (
    'EX480','EX473','equivalent','support','{}'::text[],96,8,false,
    'Même étape de Tuck L-Sit avec parallettes pour davantage de dégagement.'
  ),
  (
    'EX474','EX481','equivalent','support',array['equipment']::text[],96,10,true,
    'Même étape de L-Sit une jambe sans parallettes ; privilégier cette variante si les parallettes sont indisponibles.'
  ),
  (
    'EX481','EX474','equivalent','support','{}'::text[],96,8,false,
    'Même étape de L-Sit une jambe avec parallettes pour davantage de dégagement.'
  ),
  (
    'EX475','EX091','equivalent','support',array['equipment']::text[],96,10,true,
    'Même L-Sit complet sans parallettes ; privilégier cette variante si les parallettes sont indisponibles.'
  ),
  (
    'EX091','EX475','equivalent','support','{}'::text[],96,8,false,
    'Même L-Sit complet avec parallettes pour davantage de dégagement.'
  )
on conflict (exercise_id,target_exercise_id,variant_type) do update
set relation_axis=excluded.relation_axis,
    constraint_relief=excluded.constraint_relief,
    stimulus_similarity=excluded.stimulus_similarity,
    priority=excluded.priority,
    is_preferred=excluded.is_preferred,
    coach_note=excluded.coach_note;



-- SOURCE MIGRATION: 20260818144735_tabata_weekly_variety_and_scapular_wall_slide_unlock_v1.sql
update public.exercises
set display_name='Glissés d’omoplates au mur',
    warmup_role='mobility'
where id='EX436';

create or replace function public.c4_tabata_variety_penalty_v1(
  p_user_id uuid,
  p_exercise_id text
) returns numeric
language sql
stable
security definer
set search_path='public'
as $$
  with target as (
    select movement_pattern
    from public.exercises
    where id=p_exercise_id
  ),
  completed_week as (
    select ws.id
    from public.workout_sessions ws
    where ws.user_id=p_user_id
      and ws.status='completed'
      and coalesce(ws.completed_at,ws.created_at) >= date_trunc('week',now())
  ),
  recent_completed as (
    select ws.id
    from public.workout_sessions ws
    where ws.user_id=p_user_id
      and ws.status='completed'
    order by coalesce(ws.completed_at,ws.created_at) desc
    limit 6
  )
  select
    12 * (
      select count(*)
      from public.workout_session_exercises wse
      where wse.exercise_id=p_exercise_id
        and wse.block_key='tabata'
        and wse.session_id in (select id from completed_week)
    )
    + 3 * (
      select count(*)
      from public.workout_session_exercises wse
      join public.exercises e on e.id=wse.exercise_id
      where wse.block_key='tabata'
        and wse.session_id in (select id from completed_week)
        and e.movement_pattern=(select movement_pattern from target)
    )
    + 2 * (
      select count(*)
      from public.workout_session_exercises wse
      where wse.exercise_id=p_exercise_id
        and wse.block_key='tabata'
        and wse.session_id in (select id from recent_completed)
    );
$$;

comment on function public.c4_tabata_variety_penalty_v1(uuid,text) is
'Tabata variety is based on completed training only. Same exercise in current week is strongly penalized, same pattern moderately penalized, recent completed exposure lightly penalized. It is a soft preference, never a safety override.';

do $$
declare
  v_oid oid;
  v_sql text;
  v_old text;
  v_new text;
begin
  select p.oid into v_oid
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname='c4_apply_session_architecture_v2'
    and p.prokind='f'
  limit 1;

  if v_oid is null then
    raise exception 'c4_apply_session_architecture_v2 not found';
  end if;

  v_sql:=pg_get_functiondef(v_oid);
  v_old:='4*(select count(*) from public.workout_session_exercises wse
         where wse.exercise_id=e.id and wse.block_key=''tabata''
           and wse.session_id in (select ws.id from public.workout_sessions ws where ws.user_id=p_user_id order by ws.created_at desc limit 6)) asc,';
  v_new:='public.c4_tabata_variety_penalty_v1(p_user_id,e.id) asc,';

  if position(v_old in v_sql)=0 then
    raise exception 'Tabata recency selection fragment not found; refusing blind patch';
  end if;

  v_sql:=replace(v_sql,v_old,v_new);
  execute v_sql;
end $$;

update public.workout_sessions
set generated_workout=public.ugerod_apply_display_names_to_workout_v1(generated_workout),
    updated_at=updated_at
where status in ('generated','in_progress') and generated_workout is not null;

update public.workout_session_exercises wse
set exercise_name=coalesce(nullif(btrim(e.display_name),''),e.name),
    updated_at=wse.updated_at
from public.exercises e
where e.id=wse.exercise_id and wse.status='pending';


-- SOURCE MIGRATION: 20260818144859_tabata_unilateral_side_cue_v1.sql
do $$
declare
  v_oid oid;
  v_sql text;
  v_old text;
  v_new text;
begin
  select p.oid into v_oid
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname='c4_apply_session_architecture_v2'
    and p.prokind='f'
  limit 1;

  if v_oid is null then
    raise exception 'c4_apply_session_architecture_v2 not found';
  end if;

  v_sql:=pg_get_functiondef(v_oid);
  v_old:='||jsonb_build_object(''block_role'',''tabata'',''protocol'',jsonb_build_object(''rounds'',8,''work_seconds'',20,''rest_seconds'',10,''rotation'',''alternate_exercises''),''core_daily_training'',true);';
  v_new:='||jsonb_build_object(''block_role'',''tabata'',''protocol'',jsonb_build_object(''rounds'',8,''work_seconds'',20,''rest_seconds'',10,''rotation'',''alternate_exercises''),''core_daily_training'',true,''tabata_side_switch'',lower(coalesce(rec.movement_side,''''))=''unilateral'',''text'',case when lower(coalesce(rec.movement_side,''''))=''unilateral'' then ''20s travail · change de côté à chaque passage'' else null end);';

  if position(v_old in v_sql)=0 then
    raise exception 'Tabata prescription fragment not found; refusing blind patch';
  end if;

  v_sql:=replace(v_sql,v_old,v_new);
  execute v_sql;
end $$;

create or replace function public.ugerod_apply_tabata_side_cues_v1(p_workout jsonb)
returns jsonb
language plpgsql
stable
set search_path='public'
as $$
declare
  v_result jsonb:=coalesce(p_workout,'{}'::jsonb);
  v_blocks jsonb;
begin
  if jsonb_typeof(v_result)<>'object' or jsonb_typeof(v_result->'blocks')<>'array' then
    return v_result;
  end if;

  select coalesce(jsonb_agg(
    case when b->>'block_key'='tabata' and jsonb_typeof(b->'exercises')='array' then
      jsonb_set(b,'{exercises}',coalesce((
        select jsonb_agg(
          case when lower(coalesce(e.movement_side,''))='unilateral' then
            jsonb_set(
              ex,
              '{prescription}',
              coalesce(ex->'prescription','{}'::jsonb)||jsonb_build_object(
                'tabata_side_switch',true,
                'text','20s travail · change de côté à chaque passage'
              ),
              true
            )
          else ex end
          order by eord
        )
        from jsonb_array_elements(b->'exercises') with ordinality x(ex,eord)
        left join public.exercises e on e.id=coalesce(ex->>'exercise_id',ex->>'id')
      ),'[]'::jsonb),true)
    else b end
    order by bord
  ),'[]'::jsonb)
  into v_blocks
  from jsonb_array_elements(v_result->'blocks') with ordinality z(b,bord);

  return jsonb_set(v_result,'{blocks}',v_blocks,true);
end;
$$;

update public.workout_session_exercises wse
set prescription_json=coalesce(wse.prescription_json,'{}'::jsonb)||jsonb_build_object(
      'tabata_side_switch',true,
      'text','20s travail · change de côté à chaque passage'
    ),
    prescription='20s travail · change de côté à chaque passage',
    updated_at=wse.updated_at
from public.exercises e
join public.workout_sessions ws on true
where e.id=wse.exercise_id
  and ws.id=wse.session_id
  and wse.block_key='tabata'
  and lower(coalesce(e.movement_side,''))='unilateral'
  and ws.status in ('generated','in_progress');

update public.workout_sessions
set generated_workout=public.ugerod_apply_tabata_side_cues_v1(generated_workout),
    updated_at=updated_at
where status in ('generated','in_progress')
  and generated_workout is not null;


-- SOURCE MIGRATION: 20260818175058_progressive_movement_warmup_v3.sql
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


-- SOURCE MIGRATION: 20260818175246_warmup_skill_priority_v3_1.sql
do $$
declare
  v_oid oid;
  v_sql text;
  v_old text;
  v_new text;
begin
  select p.oid into v_oid
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.prokind='f' and p.proname='c4_apply_preparation_quality_v3'
  limit 1;
  if v_oid is null then raise exception 'c4_apply_preparation_quality_v3 not found'; end if;
  v_sql:=pg_get_functiondef(v_oid);

  v_old:=$old$for target_rec in
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
      loop$old$;

  v_new:=$new$for target_rec in
        with raw as (
          select b->>'block_key' target_block,
                 coalesce(ex->>'exercise_id',ex->>'id') target_id,
                 bord,eord
          from jsonb_array_elements(coalesce(r->'blocks','[]'::jsonb)) with ordinality bz(b,bord)
          cross join lateral jsonb_array_elements(coalesce(b->'exercises','[]'::jsonb)) with ordinality ez(ex,eord)
          where b->>'block_key' in ('skill','wod')
        ), dedup as (
          select distinct on (raw.target_id)
                 raw.target_id,raw.target_block,e.movement_pattern,e.exercise_family,e.technical_complexity,e.fatigue_score,raw.bord,raw.eord
          from raw join public.exercises e on e.id=raw.target_id
          order by raw.target_id,case when raw.target_block='skill' then 0 else 1 end,raw.bord,raw.eord
        )
        select * from dedup
        order by case when target_block='skill' then 0 else 1 end,
                 coalesce(technical_complexity,0) desc,
                 coalesce(fatigue_score,0) desc,
                 bord,eord,target_id
      loop$new$;

  if position(v_old in v_sql)=0 then raise exception 'target loop fragment not found; refusing blind patch'; end if;
  execute replace(v_sql,v_old,v_new);
end $$;


-- SOURCE MIGRATION: 20260818175818_warmup_duplicate_pattern_target_coverage_v3_2.sql
do $$
declare
  v_oid oid;
  v_sql text;
  v_old text;
  v_new text;
begin
  select p.oid into v_oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.prokind='f' and p.proname='c4_apply_preparation_quality_v3' limit 1;
  if v_oid is null then raise exception 'c4_apply_preparation_quality_v3 not found'; end if;
  v_sql:=pg_get_functiondef(v_oid);

  v_old:=$old$  v_prepared_patterns text[]:='{}'::text[];
  v_family_key text;$old$;
  v_new:=$new$  v_prepared_patterns text[]:='{}'::text[];
  v_prepared_target_ids text[]:='{}'::text[];
  v_family_key text;$new$;
  if position(v_old in v_sql)=0 then raise exception 'declaration fragment missing'; end if;
  v_sql:=replace(v_sql,v_old,v_new);

  v_old:=$old$    else
      v_prepared_patterns:='{}'::text[];
      v_rounds:=3;$old$;
  v_new:=$new$    else
      v_prepared_patterns:='{}'::text[];
      v_prepared_target_ids:='{}'::text[];
      v_rounds:=3;$new$;
  if position(v_old in v_sql)=0 then raise exception 'warmup init fragment missing'; end if;
  v_sql:=replace(v_sql,v_old,v_new);

  v_old:=$old$        v_selected_ids:=array_append(v_selected_ids,rec.id);
        if target_rec.movement_pattern is not null then v_prepared_patterns:=array_append(v_prepared_patterns,target_rec.movement_pattern); end if;
      end loop;

      -- Pass 2: if the architecture asks for more movements than distinct targets, add a safe low-fatigue movement prep.$old$;
  v_new:=$new$        v_selected_ids:=array_append(v_selected_ids,rec.id);
        v_prepared_target_ids:=array_append(v_prepared_target_ids,target_rec.target_id);
        if target_rec.movement_pattern is not null then v_prepared_patterns:=array_append(v_prepared_patterns,target_rec.movement_pattern); end if;
      end loop;

      -- Pass 2: cover remaining Skill/WOD targets even when their pattern is already represented.
      for target_rec in
        with raw as (
          select b->>'block_key' target_block,
                 coalesce(ex->>'exercise_id',ex->>'id') target_id,
                 bord,eord
          from jsonb_array_elements(coalesce(r->'blocks','[]'::jsonb)) with ordinality bz(b,bord)
          cross join lateral jsonb_array_elements(coalesce(b->'exercises','[]'::jsonb)) with ordinality ez(ex,eord)
          where b->>'block_key' in ('skill','wod')
        ), dedup as (
          select distinct on (raw.target_id)
                 raw.target_id,raw.target_block,e.movement_pattern,e.exercise_family,e.technical_complexity,e.fatigue_score,raw.bord,raw.eord
          from raw join public.exercises e on e.id=raw.target_id
          order by raw.target_id,case when raw.target_block='skill' then 0 else 1 end,raw.bord,raw.eord
        )
        select * from dedup
        where not(target_id=any(v_prepared_target_ids))
        order by case when target_block='skill' then 0 else 1 end,
                 coalesce(technical_complexity,0) desc,
                 coalesce(fatigue_score,0) desc,
                 bord,eord,target_id
      loop
        exit when jsonb_array_length(v_new)>=v_count;
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
        v_prepared_target_ids:=array_append(v_prepared_target_ids,target_rec.target_id);
      end loop;

      -- Pass 3: if the architecture still asks for more movements, add a safe low-fatigue movement prep.$new$;
  if position(v_old in v_sql)=0 then raise exception 'pass insertion fragment missing'; end if;
  v_sql:=replace(v_sql,v_old,v_new);

  execute v_sql;
end $$;


-- SOURCE MIGRATION: 20260818180207_warmup_pool_display_names_and_unlock_cleanup_v1.sql
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
