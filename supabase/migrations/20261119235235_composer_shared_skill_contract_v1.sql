do $guard$ begin
 if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='c4_apply_skill_path_v2' and md5(pg_get_functiondef(p.oid))='d2802e5d098114c0dc087760ba4e5c0f') then raise exception 'Concurrent change: c4_apply_skill_path_v2'; end if;
 if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='c4_skill_contract_v1' and md5(pg_get_functiondef(p.oid))='5b340c9772e2fea1d14c6b4ae44a6dde') then raise exception 'Concurrent change: c4_skill_contract_v1'; end if;
 if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='week_composer_prescription_preview_v1' and md5(pg_get_functiondef(p.oid))='62b4637304235faefda0e9cd62332f0f') then raise exception 'Concurrent change: week_composer_prescription_preview_v1'; end if;
 if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='week_compile_composer_day_j_v1' and md5(pg_get_functiondef(p.oid))='8dcb3862bd882a3bd72a545c05bdf984') then raise exception 'Concurrent change: week_compile_composer_day_j_v1'; end if;
 if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='c4_apply_skill_curriculum_v1' and md5(pg_get_functiondef(p.oid))='268eb0c0727b430d1bde86a4f1ed76ce') then raise exception 'Concurrent change: c4_apply_skill_curriculum_v1'; end if;
end $guard$;

-- #42/#43: one Skill producer for proposal, preview and Day J.
-- Calls the existing C2, Skill Paths, curriculum and duration-fit authorities.
-- This source is included verbatim in its CLI-created migration.
create or replace function public.week_composer_preferences_v1(p_draft jsonb)
returns jsonb language plpgsql immutable set search_path=public,pg_temp as $$
declare p jsonb:=p_draft->'preferences'; regions jsonb; target text;
begin
 if p is null then
   p:=jsonb_build_object('preferred_regions',case when nullif(p_draft->>'target_region','') is null
     then '[]'::jsonb else jsonb_build_array(p_draft->>'target_region') end);
 elsif jsonb_typeof(p)<>'object' or p->>'version' is distinct from 'composer-preferences-v1' then
   raise exception 'UNSUPPORTED_COMPOSER_PREFERENCES';
 end if;
 regions:=coalesce(p->'preferred_regions','[]'::jsonb);
 if jsonb_typeof(regions)<>'array' then raise exception 'INVALID_COMPOSER_REGIONS'; end if;
 if exists(select 1 from jsonb_array_elements(regions) r where jsonb_typeof(r)<>'string'
   or r#>>'{}' not in ('Upper','Back','Lower','Core','Full Body')) then
   raise exception 'INVALID_COMPOSER_REGIONS';
 end if;
 if regions ? 'Full Body' then regions:='["Full Body"]'::jsonb;
 else
   select coalesce(jsonb_agg(to_jsonb(region) order by pos),'[]'::jsonb) into regions
   from (select value region,min(ord) pos from jsonb_array_elements_text(regions) with ordinality r(value,ord) group by value) x;
 end if;
 target:=nullif(p->>'skill_target_path_key','');
 if target is not null and target !~ '^[A-Z0-9_]{1,80}$' then raise exception 'INVALID_COMPOSER_SKILL_TARGET'; end if;
 return jsonb_build_object('version','composer-preferences-v1','preferred_regions',regions,'skill_target_path_key',target);
end $$;

create or replace function public.week_composer_skill_context_v1(p_draft jsonb,p_block jsonb,p_equipment text[],p_pain text[] default '{}',p_readiness text default 'normal')
returns jsonb language sql immutable set search_path=public,pg_temp as $$
 select jsonb_build_object('preferences',public.week_composer_preferences_v1(p_draft),
   'session_minutes',p_draft->'duration_minutes','block_minutes',p_block->'minutes',
   'environment_code',p_draft->'environment_code','focus',p_draft#>'{intent,focus}',
   'progression_intent',coalesce(p_draft->>'progression_intent','MAINTAIN'),
   'equipment_names',to_jsonb(coalesce(p_equipment,'{}')),'pain_zones',to_jsonb(coalesce(p_pain,'{}')),
   'readiness',p_readiness,'exercises',p_block->'exercises',
   'wod_exercises',coalesce((select jsonb_agg(jsonb_build_object('exercise_id',ex->>'id'))
     from jsonb_array_elements(p_draft#>'{architecture,blocks}') b,
       jsonb_array_elements(b->'exercises') ex where b->>'type'='WOD'),'[]'::jsonb));
$$;

create or replace function public.week_composer_skill_authority_v1(p_user_id uuid,p_context jsonb)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare
 prefs jsonb:=public.week_composer_preferences_v1(p_context);
 target text:=prefs->>'skill_target_path_key';
 minutes int:=(p_context->>'block_minutes')::int;
 duration int:=(p_context->>'session_minutes')::int;
 env text:=upper(coalesce(p_context->>'environment_code','HOME'));
 readiness text:=public.normalize_session_readiness(coalesce(p_context->>'readiness','normal'));
 intent text:=coalesce(p_context->>'progression_intent','MAINTAIN');
 chosen jsonb:=coalesce(p_context->'exercises','[]'::jsonb);
 propose boolean:=coalesce((p_context->>'propose')::boolean,false);
 equipment text[]; pain text[]; inventory jsonb; complexity int; region text;
 plan jsonb; b jsonb; ex jsonb; sol jsonb; contract jsonb; pres jsonb;
 output jsonb:='[]'::jsonb; ids text[]:='{}'; target_ids text[]; chosen_ids text[];
 elapsed numeric:=0; x record; alloc int; stimulus jsonb;
begin
 if auth.uid() is null or auth.uid()<>p_user_id then raise exception 'FORBIDDEN_COMPOSER_SKILL' using errcode='42501'; end if;
 if minutes is null or minutes not between 2 and 90 or duration is null or duration not between 20 and 90
   or minutes>duration or env not in ('HOME','BOX','GYM','OUTDOOR') or jsonb_typeof(chosen)<>'array' then
   raise exception 'INVALID_COMPOSER_SKILL_CONTEXT';
 end if;
 if jsonb_array_length(chosen)>3 then
   return jsonb_build_object('status','NEEDS_RECOMPOSITION','reason','SKILL_MAX_THREE_EXERCISES','block_type','SKILL');
 end if;
 select coalesce(array_agg(value),'{}') into equipment from jsonb_array_elements_text(coalesce(p_context->'equipment_names','[]'));
 select coalesce(array_agg(value),'{}') into pain from jsonb_array_elements_text(coalesce(p_context->'pain_zones','[]'));
 inventory:=public.resolve_user_equipment_inventory(p_user_id,equipment,'c4-final-default');
 complexity:=public.c4_user_max_swap_complexity(p_user_id,readiness);
 region:=case when jsonb_array_length(prefs->'preferred_regions')=1 then prefs#>>'{preferred_regions,0}' else null end;
 stimulus:=public.build_session_stimulus_target(coalesce(p_context->>'focus','General Fitness'),duration,readiness,region,intent,'c4-final-default');
 if target is not null then
   if not exists(select 1 from public.skill_paths where path_key=target and active) then
     return jsonb_build_object('status','NEEDS_RECOMPOSITION','reason','SKILL_TARGET_UNAVAILABLE','block_type','SKILL');
   end if;
   -- The existing path engine owns entry step, trajectory and progression.
   -- The explicit request narrows its catalogue, not the athlete's mastery.
   plan:=jsonb_build_object('status','READY','stimulus',stimulus,
     'architecture',jsonb_build_object('requested_skill_path_key',target,'preferred_regions',prefs->'preferred_regions',
       'skill_practice_only',true,'skill_reason','composer_learning'),
     'blocks',jsonb_build_array(jsonb_build_object('block_key','skill','duration_minutes',minutes,'exercises','[]'::jsonb),
       jsonb_build_object('block_key','wod','exercises',coalesce(p_context->'wod_exercises','[]'::jsonb))));
   plan:=public.c4_apply_skill_path_v2(p_user_id,plan,pain,inventory,region,complexity,intent,readiness);
   if plan#>>'{architecture,skill_path,path_key}' is distinct from target then
     return jsonb_build_object('status','NEEDS_RECOMPOSITION','reason','SKILL_TARGET_NOT_FEASIBLE','block_type','SKILL',
       'details',plan#>'{architecture,skill_path}');
   end if;
   plan:=public.c4_apply_skill_curriculum_v3(p_user_id,plan,pain,inventory,complexity,intent,readiness);
   select value into b from jsonb_array_elements(plan->'blocks') where value->>'block_key'='skill';
   if b is null or jsonb_array_length(b->'exercises') not between 1 and 3 then
     return jsonb_build_object('status','NEEDS_RECOMPOSITION','reason','SKILL_LESSON_EXCEEDS_THREE','block_type','SKILL',
       'required_exercises',b->'exercises'); -- Never truncate a required lesson.
   end if;
   select array_agg(value->>'exercise_id' order by ord) into target_ids
     from jsonb_array_elements(b->'exercises') with ordinality e(value,ord);
   select array_agg(value->>'id' order by ord) into chosen_ids
     from jsonb_array_elements(chosen) with ordinality e(value,ord);
   if not propose and chosen_ids is distinct from target_ids then
     return jsonb_build_object('status','NEEDS_RECOMPOSITION','reason','SKILL_LESSON_CHANGED','block_type','SKILL',
       'required_exercises',b->'exercises');
   end if;
   chosen:=b->'exercises';
 else
   if jsonb_array_length(chosen)<1 then raise exception 'SKILL_EXERCISES_REQUIRED'; end if;
   b:=jsonb_build_object('block_key','skill','block_name','Skill','duration_minutes',minutes);
 end if;
 alloc:=floor(minutes*60.0/greatest(1,jsonb_array_length(chosen)))::int;
 for ex in select value from jsonb_array_elements(chosen) loop
   select e.* into x from public.exercises e where id=coalesce(ex->>'exercise_id',ex->>'id');
   if x.id is null or x.id=any(ids) then raise exception 'INVALID_SKILL_EXERCISE'; end if;
   ids:=array_append(ids,x.id);
   if not public.exercise_environment_eligible_v1(x.id,env)
     or not public.exercise_equipment_compatible(x.id,inventory)
     or not public.exercise_safe_for_zones(x.id,public.normalize_body_zone_ids(pain))
     or coalesce(x.technical_complexity,99)>complexity then
     return jsonb_build_object('status','NEEDS_RECOMPOSITION','reason','SKILL_CONTEXT_INCOMPATIBLE','block_type','SKILL','exercise_id',x.id);
   end if;
   if target is not null then
     pres:=ex->'prescription';
   else
     sol:=public.c2_solver_prescription(p_user_id,x.id,stimulus,'SKILL',intent,inventory)
       ||jsonb_build_object('practice_only',true);
     contract:=public.c4_skill_contract_v1(p_user_id,x.id,'composer_mastery',greatest(1,ceil(alloc/60.0)::int),intent,readiness,sol);
     pres:=sol||coalesce(contract->'prescription_patch','{}'::jsonb);
   end if;
   pres:=public.skill_curriculum_duration_fit_v1(x.id,pres->>'curriculum_role',pres,alloc,jsonb_array_length(chosen));
   -- Publish aliases consumed by the existing runtime; numeric dose is untouched.
   pres:=pres||jsonb_strip_nulls(jsonb_build_object('source','COMPOSER_SHARED_SKILL_V1',
     'rest_seconds',coalesce(pres->'rest_between_sets_seconds',pres->'rest_seconds'),
     'reps_min',coalesce(pres->'execution_target_reps',pres->'reps_min'),
     'duration_seconds',coalesce(pres->'execution_target_duration_seconds',pres->'duration_seconds'),
     'distance_meters',coalesce(pres->'execution_target_distance_meters',pres->'distance_meters'),
     'composer_skill_version','C4_COMPOSER_SKILL_V1'));
   if pres->>'duration_fit_status' is distinct from 'FIT' then
     return jsonb_build_object('status','NEEDS_RECOMPOSITION','reason','SKILL_TIME_MISMATCH','block_type','SKILL','exercise_id',x.id,'prescription',pres);
   end if;
   if coalesce((pres->>'test_score_required')::boolean,false) then
     return jsonb_build_object('status','NEEDS_RECOMPOSITION','reason','SKILL_TEST_CONFIRMATION_REQUIRED','block_type','SKILL');
   end if;
   elapsed:=elapsed+coalesce((pres->>'predicted_elapsed_seconds')::numeric,0);
   output:=output||jsonb_build_array(coalesce(ex,'{}'::jsonb)||jsonb_build_object('id',x.id,'exercise_id',x.id,
     'name',coalesce(x.display_name,x.name),'prescription',pres));
 end loop;
 return jsonb_build_object('status','READY','source','C2+SKILL_PATH+CURRICULUM+DURATION_FIT',
   'version','C4_COMPOSER_SKILL_V1','block_type','SKILL','minutes',minutes,'exercises',output,
   'skill_contract',b->'skill_contract','curriculum',b->'curriculum','skill_path',b->'skill_path',
   'time',jsonb_build_object('budget_seconds',minutes*60,'prescribed_seconds',elapsed,'duration_is_maximum_not_fill_target',true));
end $$;

revoke all on function public.week_composer_preferences_v1(jsonb) from public,anon;
revoke all on function public.week_composer_skill_context_v1(jsonb,jsonb,text[],text[],text) from public,anon;
revoke all on function public.week_composer_skill_authority_v1(uuid,jsonb) from public,anon;
grant execute on function public.week_composer_preferences_v1(jsonb) to authenticated,service_role;
grant execute on function public.week_composer_skill_context_v1(jsonb,jsonb,text[],text[],text) to authenticated,service_role;
grant execute on function public.week_composer_skill_authority_v1(uuid,jsonb) to authenticated,service_role;


CREATE OR REPLACE FUNCTION public.c4_apply_skill_path_v2(p_user_id uuid, p_plan jsonb, p_zone_terms text[] DEFAULT '{}'::text[], p_inventory jsonb DEFAULT '[]'::jsonb, p_target_region text DEFAULT NULL::text, p_max_complexity integer DEFAULT 3, p_progression_intent text DEFAULT NULL::text, p_readiness text DEFAULT 'normal'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  r jsonb:=coalesce(p_plan,'{}'::jsonb);
  v_skill_block jsonb;
  v_skill_minutes int:=0;
  v_skill_reason text;
  v_wod_ids text[]:='{}'::text[];
  v_path record;
  v_anchor record;
  v_choice record;
  v_progress record;
  v_choice_id text;
  v_choice_source text:='ENTRY_LEVEL';
  v_auto_progressed boolean:=false;
  v_manual_anchor boolean:=false;
  v_mini_cfg jsonb:='{}'::jsonb;
  v_mini_target int:=3;
  v_mini_window_days int:=35;
  v_mini_max_gap_days int:=21;
  v_mini_anchor_path text:=null;
  v_mini_completed_exposures int:=0;
  v_mini_last_completed_date date:=null;
  v_mini_active boolean:=false;
  v_focus jsonb:='{}'::jsonb;
  v_focus_decision text:='OPEN_SELECTION';
  v_focus_anchor_path text:=null;
  v_pres jsonb;
  v_contract jsonb;
  v_ex jsonb;
  v_blocks jsonb;
  v_active int;
  v_planned int;
  v_transition int;
  v_unallocated int;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;
  if coalesce(r->>'status','')<>'READY' then return r; end if;

  select b into v_skill_block
  from jsonb_array_elements(coalesce(r->'blocks','[]'::jsonb)) b
  where b->>'block_key'='skill'
  limit 1;

  if v_skill_block is null then
    r:=jsonb_set(r,'{architecture,skill_path}',jsonb_build_object(
      'version','skill-path-v1','applied',false,'reason','NO_SKILL_BLOCK'
    ),true);
    return r;
  end if;

  v_skill_minutes:=coalesce(nullif(v_skill_block->>'duration_minutes','')::int,0);
  if v_skill_minutes<=0 then return r; end if;
  if exists (
    select 1 from public.user_skill_session_preferences usp
    where usp.user_id=p_user_id
      and usp.preference_date=public.ugerod_effective_session_anchor_date_v1()
      and usp.action='SKIP_SKILL'
      and (usp.expires_at is null or usp.expires_at>now())
  ) then
    select coalesce(jsonb_agg(b order by ord),'[]'::jsonb)
    into v_blocks
    from jsonb_array_elements(coalesce(r->'blocks','[]'::jsonb)) with ordinality x(b,ord)
    where b->>'block_key'<>'skill';
    v_active:=greatest(0,coalesce(nullif(r#>>'{architecture,active_training_minutes}','')::int,0)-v_skill_minutes);
    v_transition:=greatest(0,coalesce(nullif(r#>>'{architecture,transition_recovery_minutes}','')::int,0)-1);
    v_planned:=greatest(0,coalesce(nullif(r#>>'{architecture,planned_minutes}','')::int,0)-v_skill_minutes-1);
    v_unallocated:=coalesce(nullif(r#>>'{architecture,unallocated_available_minutes}','')::int,0)+v_skill_minutes+1;
    r:=jsonb_set(r,'{blocks}',v_blocks,true);
    r:=jsonb_set(r,'{architecture,skill_minutes}',to_jsonb(0),true);
    r:=jsonb_set(r,'{architecture,active_training_minutes}',to_jsonb(v_active),true);
    r:=jsonb_set(r,'{architecture,transition_recovery_minutes}',to_jsonb(v_transition),true);
    r:=jsonb_set(r,'{architecture,planned_minutes}',to_jsonb(v_planned),true);
    r:=jsonb_set(r,'{architecture,unallocated_available_minutes}',to_jsonb(v_unallocated),true);
    r:=jsonb_set(r,'{architecture,skill_path}',jsonb_build_object(
      'version','skill-session-preference-v1','applied',false,'reason','USER_SKIPPED_SKILL_TODAY',
      'preference_scope','SESSION_DAY_ONLY','safety_signal',false,'creates_training_debt',false,
      'focus_cycle_preserved_for_future_sessions',true
    ),true);
    r:=jsonb_set(r,'{architecture,skill_session_preference}',jsonb_build_object(
      'action','SKIP_SKILL','scope','SESSION_DAY_ONLY','preference_not_pain',true,
      'does_not_change_level',true,'does_not_break_focus_cycle',true
    ),true);
    return r;
  end if;
  v_skill_reason:=coalesce(r#>>'{architecture,skill_reason}',v_skill_block#>>'{expected_outcome,skill_reason}');

  select coalesce(array_agg(x->>'exercise_id') filter(where nullif(x->>'exercise_id','') is not null),'{}'::text[])
  into v_wod_ids
  from jsonb_array_elements(coalesce((
    select b->'exercises'
    from jsonb_array_elements(coalesce(r->'blocks','[]'::jsonb)) b
    where b->>'block_key'='wod'
    limit 1
  ),'[]'::jsonb)) x;

  select coalesce(config#>'{skill_path,mini_cycle}','{}'::jsonb) into v_mini_cfg
  from public.session_engine_policy where policy_key='c4-final-default';
  v_mini_target:=greatest(2,least(coalesce(nullif(v_mini_cfg->>'target_completed_exposures','')::int,3),4));
  v_mini_window_days:=greatest(14,least(coalesce(nullif(v_mini_cfg->>'window_days','')::int,35),70));
  v_mini_max_gap_days:=greatest(7,least(coalesce(nullif(v_mini_cfg->>'max_gap_days','')::int,21),35));

  select case
    when coalesce((ws.planning_context_json#>>'{architecture,skill_path,mini_cycle,active}')::boolean,false)
      and not coalesce((ws.planning_context_json#>>'{architecture,skill_path,mini_cycle,selected_anchor_path}')::boolean,false)
      and nullif(ws.planning_context_json#>>'{architecture,skill_path,mini_cycle,anchor_path_key}','') is not null
    then ws.planning_context_json#>>'{architecture,skill_path,mini_cycle,anchor_path_key}'
    else hist.path_key
  end
  into v_mini_anchor_path
  from public.workout_sessions ws
  join public.workout_session_exercises wse on wse.session_id=ws.id and wse.block_key='skill'
  join public.skill_path_members hist on hist.exercise_id=wse.exercise_id and hist.active
  where ws.user_id=p_user_id and ws.status='completed'
    and coalesce(ws.generation_local_date,ws.completed_at::date,ws.created_at::date)>=public.ugerod_effective_session_anchor_date_v1()-v_mini_window_days
  order by coalesce(ws.completed_at,ws.created_at) desc,wse.updated_at desc
  limit 1;

  if v_mini_anchor_path is not null then
    select max(coalesce(ws.generation_local_date,ws.completed_at::date,ws.created_at::date)),
           count(distinct ws.id)::int
    into v_mini_last_completed_date,v_mini_completed_exposures
    from public.workout_sessions ws
    join public.workout_session_exercises wse on wse.session_id=ws.id and wse.block_key='skill'
    join public.skill_path_members hist on hist.exercise_id=wse.exercise_id and hist.path_key=v_mini_anchor_path and hist.active
    where ws.user_id=p_user_id and ws.status='completed'
      and coalesce(ws.generation_local_date,ws.completed_at::date,ws.created_at::date)>=public.ugerod_effective_session_anchor_date_v1()-v_mini_window_days;
  end if;

  v_mini_active:=v_mini_anchor_path is not null
    and v_mini_completed_exposures between 1 and v_mini_target-1
    and v_mini_last_completed_date is not null
    and public.ugerod_effective_session_anchor_date_v1()-v_mini_last_completed_date<=v_mini_max_gap_days
    and public.normalize_session_readiness(p_readiness)<>'low'
    and upper(coalesce(p_progression_intent,''))<>'DELOAD';

  v_focus:=public.skill_focus_cycle_decision_v1(
    p_user_id,
    public.ugerod_effective_session_anchor_date_v1(),
    p_readiness,
    p_progression_intent
  );
  v_focus_decision:=coalesce(v_focus->>'decision','OPEN_SELECTION');
  v_focus_anchor_path:=nullif(v_focus->>'anchor_path_key','');
  if v_focus_anchor_path is not null then
    v_mini_anchor_path:=v_focus_anchor_path;
    v_mini_completed_exposures:=coalesce(nullif(v_focus->>'completed_exposures','')::int,v_mini_completed_exposures);
    v_mini_last_completed_date:=coalesce(nullif(v_focus->>'last_completed_on','')::date,v_mini_last_completed_date);
    v_mini_active:=v_focus_decision in ('FOCUS','DETOUR');
  end if;

  with recent_sessions as (
    select ws.id
    from public.workout_sessions ws
    where ws.user_id=p_user_id
      and ws.status in ('completed','abandoned','generated','in_progress')
    order by ws.created_at desc
    limit 6
  ), eligible_paths as (
    select
      sp.*,
      case
        when p_target_region is null or p_target_region='Full Body' then 0
        when sp.body_region=p_target_region then 0
        when sp.body_region='Core' then 1
        when sp.body_region='Full Body' then 2
        else 3
      end as region_rank,
      (
        select count(distinct ws.id)::int
        from public.workout_sessions ws
        join public.workout_session_exercises wse on wse.session_id=ws.id and wse.block_key='skill'
        join public.skill_path_members hist on hist.exercise_id=wse.exercise_id and hist.path_key=sp.path_key and hist.active
        where ws.user_id=p_user_id
          and ws.id in (select id from recent_sessions)
      ) as recent_count,
      exists(
        select 1
        from public.workout_sessions ws
        join public.workout_session_exercises wse on wse.session_id=ws.id and wse.block_key='skill'
        join public.skill_path_members hist on hist.exercise_id=wse.exercise_id and hist.path_key=sp.path_key and hist.active
        where ws.user_id=p_user_id
          and ws.status in ('completed','abandoned','generated','in_progress')
          and ws.generation_local_date=public.ugerod_effective_session_anchor_date_v1()
      ) as same_day_continuity,
      (
        select max(ws.created_at)
        from public.workout_sessions ws
        join public.workout_session_exercises wse on wse.session_id=ws.id and wse.block_key='skill'
        join public.skill_path_members hist on hist.exercise_id=wse.exercise_id and hist.path_key=sp.path_key and hist.active
        where ws.user_id=p_user_id
          and ws.status in ('completed','abandoned','generated','in_progress')
      ) as last_used_at
    from public.skill_paths sp
    where sp.active
      and (nullif(r#>>'{architecture,requested_skill_path_key}','') is null
        or sp.path_key=r#>>'{architecture,requested_skill_path_key}')
      and not exists (
        select 1 from public.user_skill_session_preferences usp
        where usp.user_id=p_user_id
          and usp.preference_date=public.ugerod_effective_session_anchor_date_v1()
          and usp.action='NOT_TODAY'
          and usp.path_key=sp.path_key
          and (usp.expires_at is null or usp.expires_at>now())
      )
      and public.c4_skill_path_region_compatible_v1(sp.body_region,p_target_region)
      and exists(
        select 1
        from public.skill_path_members m
        join public.exercises e on e.id=m.exercise_id
        where m.path_key=sp.path_key
          and m.active
          and not coalesce(e.warmup_only,false)
          and coalesce(e.technical_complexity,99)<=p_max_complexity
          and coalesce(e.fatigue_score,99)<=5
          and coalesce(e.joint_impact,99)<=4
          and public.exercise_safe_for_zones(e.id,public.normalize_body_zone_ids(coalesce(p_zone_terms,'{}'::text[])))
          and public.exercise_equipment_compatible(e.id,coalesce(p_inventory,'[]'::jsonb))
          and (p_target_region is distinct from 'Back' or exists(select 1 from public.exercise_muscles em where em.exercise_id=e.id and em.muscle_id in('M02','M12','M13') and em.priority='primary'))
          and not (e.id=any(v_wod_ids))
      )
  )
  select * into v_path
  from eligible_paths
  order by
    case
      when same_day_continuity
           and not (v_focus_decision in ('DETOUR','ROTATE') and path_key=v_focus_anchor_path) then 0
      when v_focus_decision='FOCUS' and path_key=v_focus_anchor_path then 0
      when v_focus_decision='FOCUS' then 1
      when v_focus_decision in ('DETOUR','ROTATE') and path_key=v_focus_anchor_path then 1
      else 0
    end,
    region_rank asc,
    recent_count asc,
    last_used_at asc nulls first,
    selection_priority desc,
    md5(p_user_id::text||public.ugerod_effective_session_anchor_date_v1()::text||path_key)
  limit 1;

  if not found then
    select coalesce(jsonb_agg(b order by ord),'[]'::jsonb)
    into v_blocks
    from jsonb_array_elements(coalesce(r->'blocks','[]'::jsonb)) with ordinality x(b,ord)
    where b->>'block_key'<>'skill';

    v_active:=greatest(0,coalesce(nullif(r#>>'{architecture,active_training_minutes}','')::int,0)-v_skill_minutes);
    v_transition:=greatest(0,coalesce(nullif(r#>>'{architecture,transition_recovery_minutes}','')::int,0)-1);
    v_planned:=greatest(0,coalesce(nullif(r#>>'{architecture,planned_minutes}','')::int,0)-v_skill_minutes-1);
    v_unallocated:=coalesce(nullif(r#>>'{architecture,unallocated_available_minutes}','')::int,0)+v_skill_minutes+1;

    r:=jsonb_set(r,'{blocks}',v_blocks,true);
    r:=jsonb_set(r,'{architecture,skill_minutes}',to_jsonb(0),true);
    r:=jsonb_set(r,'{architecture,active_training_minutes}',to_jsonb(v_active),true);
    r:=jsonb_set(r,'{architecture,transition_recovery_minutes}',to_jsonb(v_transition),true);
    r:=jsonb_set(r,'{architecture,planned_minutes}',to_jsonb(v_planned),true);
    r:=jsonb_set(r,'{architecture,unallocated_available_minutes}',to_jsonb(v_unallocated),true);
    r:=jsonb_set(r,'{architecture,skill_path}',jsonb_build_object(
      'version','skill-path-v1','applied',false,'reason','NO_SAFE_CURATED_SKILL_PATH',
      'legacy_skill_not_used_as_fallback',true
    ),true);
    return r;
  end if;

  select
    ws.id as source_session_id,
    wse.exercise_id,
    e.name,e.exercise_family,e.movement_pattern,e.body_region,e.instructions,e.tips,e.image_path,e.tracking_modes,
    e.technical_complexity,m.step_order,
    upper(coalesce(s.recommendation,'')) as recommendation,
    coalesce(s.valid_evidence_count,0) as valid_evidence_count,
    exists(
      select 1 from public.workout_session_swap_history h
      where h.user_id=p_user_id and h.session_id=ws.id
        and h.to_exercise_id=wse.exercise_id and h.undone_at is null
    ) as manual_selected
  into v_anchor
  from public.workout_session_exercises wse
  join public.workout_sessions ws on ws.id=wse.session_id
  join public.skill_path_members m on m.exercise_id=wse.exercise_id and m.path_key=v_path.path_key and m.active
  join public.exercises e on e.id=wse.exercise_id
  left join public.user_exercise_coach_state s on s.user_id=p_user_id and s.exercise_id=e.id
  where ws.user_id=p_user_id
    and wse.block_key='skill'
    and ws.status in ('completed','abandoned','generated','in_progress')
    and public.exercise_safe_for_zones(e.id,public.normalize_body_zone_ids(coalesce(p_zone_terms,'{}'::text[])))
    and public.exercise_equipment_compatible(e.id,coalesce(p_inventory,'[]'::jsonb))
          and (p_target_region is distinct from 'Back' or exists(select 1 from public.exercise_muscles em where em.exercise_id=e.id and em.muscle_id in('M02','M12','M13') and em.priority='primary'))
    and not (e.id=any(v_wod_ids))
    and (
      coalesce(e.technical_complexity,99)<=p_max_complexity
      or exists(
        select 1 from public.workout_session_swap_history h
        where h.user_id=p_user_id and h.session_id=ws.id
          and h.to_exercise_id=wse.exercise_id and h.undone_at is null
      )
    )
  order by ws.created_at desc,wse.updated_at desc
  limit 1;

  if found then
    v_choice_id:=v_anchor.exercise_id;
    v_choice_source:='TRAJECTORY_MEMORY';
    v_manual_anchor:=coalesce(v_anchor.manual_selected,false);

    if (
         coalesce(v_anchor.recommendation,'')='PROGRESS_RECOMMENDED'
         or exists(
           select 1
           from public.pi_exercise_directives(p_user_id,public.ugerod_effective_session_anchor_date_v1(),90) pd
           where pd.exercise_id=v_anchor.exercise_id and pd.directive='PROGRESS'
         )
       )
       and coalesce(v_anchor.valid_evidence_count,0)>=2
       and public.w2_skill_progression_feedback_allows_v1(p_user_id,v_anchor.exercise_id)
       and public.normalize_session_readiness(p_readiness)<>'low'
       and upper(coalesce(p_progression_intent,''))<>'DELOAD'
    then
      select e.*,m.step_order into v_progress
      from public.exercise_variants ev
      join public.skill_path_members m
        on m.exercise_id=ev.target_exercise_id and m.path_key=v_path.path_key and m.active
      join public.exercises e on e.id=ev.target_exercise_id
      where ev.exercise_id=v_anchor.exercise_id
        and lower(ev.variant_type)='progression'
        and coalesce(e.technical_complexity,99)<=p_max_complexity
        and coalesce(e.fatigue_score,99)<=5
        and coalesce(e.joint_impact,99)<=4
        and public.exercise_safe_for_zones(e.id,public.normalize_body_zone_ids(coalesce(p_zone_terms,'{}'::text[])))
        and public.exercise_equipment_compatible(e.id,coalesce(p_inventory,'[]'::jsonb))
          and (p_target_region is distinct from 'Back' or exists(select 1 from public.exercise_muscles em where em.exercise_id=e.id and em.muscle_id in('M02','M12','M13') and em.priority='primary'))
        and not (e.id=any(v_wod_ids))
      order by ev.is_preferred desc,ev.priority desc,m.step_order asc,e.id
      limit 1;

      if found then
        v_choice_id:=v_progress.id;
        v_choice_source:='AUTO_DIRECT_PROGRESSION';
        v_auto_progressed:=true;
      end if;
    end if;
  end if;

  if v_choice_id is null then
    select e.*,m.step_order,m.member_role,
           upper(coalesce(s.recommendation,'')) as recommendation,
           coalesce(s.valid_evidence_count,0) as valid_evidence_count
    into v_choice
    from public.skill_path_members m
    join public.exercises e on e.id=m.exercise_id
    left join public.user_exercise_coach_state s on s.user_id=p_user_id and s.exercise_id=e.id
    where m.path_key=v_path.path_key
      and m.active
      and not coalesce(e.warmup_only,false)
      and coalesce(e.technical_complexity,99)<=p_max_complexity
      and coalesce(e.fatigue_score,99)<=5
      and coalesce(e.joint_impact,99)<=4
      and public.exercise_safe_for_zones(e.id,public.normalize_body_zone_ids(coalesce(p_zone_terms,'{}'::text[])))
      and public.exercise_equipment_compatible(e.id,coalesce(p_inventory,'[]'::jsonb))
          and (p_target_region is distinct from 'Back' or exists(select 1 from public.exercise_muscles em where em.exercise_id=e.id and em.muscle_id in('M02','M12','M13') and em.priority='primary'))
      and not (e.id=any(v_wod_ids))
    order by
      case when s.user_id is not null and upper(coalesce(s.recommendation,'')) in ('LEARN','RECALIBRATE','PROGRESS_RECOMMENDED','PROGRESS_POSSIBLE') then 0 else 1 end,
      case when s.user_id is not null then 0 else 1 end,
      m.step_order asc,
      coalesce(e.technical_complexity,99) asc,
      md5(p_user_id::text||v_path.path_key||e.id)
    limit 1;

    if not found then
      return r;
    end if;
    v_choice_id:=v_choice.id;
    v_choice_source:='ENTRY_LEVEL';
  end if;

  select e.*,m.step_order,m.member_role into v_choice
  from public.exercises e
  join public.skill_path_members m on m.exercise_id=e.id and m.path_key=v_path.path_key
  where e.id=v_choice_id
  limit 1;

  v_pres:=public.c2_solver_prescription(
    p_user_id,v_choice.id,coalesce(r->'stimulus','{}'::jsonb),'SKILL',p_progression_intent,coalesce(p_inventory,'[]'::jsonb)
  )||jsonb_build_object(
    'block_role','skill',
    'target_duration_minutes',v_skill_minutes,
    'quality_priority','technique_before_fatigue',
    'skill_reason',v_skill_reason,
    'skill_path_key',v_path.path_key,
    'skill_path_name',v_path.display_name,
    'skill_path_step',v_choice.step_order,
    'skill_path_selection_source',v_choice_source,
    'trajectory_anchor',v_choice_source='TRAJECTORY_MEMORY',
    'manual_progression_self_selected',v_manual_anchor,
    'auto_direct_progression',v_auto_progressed
  );

  if coalesce((r#>>'{architecture,skill_practice_only}')::boolean,false) then v_pres:=v_pres||jsonb_build_object('practice_only',true); end if;
  v_contract:=public.c4_skill_contract_v1(
    p_user_id,v_choice.id,v_skill_reason,v_skill_minutes,p_progression_intent,p_readiness,v_pres
  );
  v_pres:=v_pres||coalesce(v_contract->'prescription_patch','{}'::jsonb)||jsonb_build_object(
    'skill_path_key',v_path.path_key,
    'skill_path_name',v_path.display_name,
    'skill_path_step',v_choice.step_order,
    'skill_path_selection_source',v_choice_source,
    'trajectory_anchor',v_choice_source='TRAJECTORY_MEMORY',
    'auto_direct_progression',v_auto_progressed
  );

  v_ex:=jsonb_build_object(
    'exercise_id',v_choice.id,
    'name',v_choice.name,
    'family',v_choice.exercise_family,
    'pattern',v_choice.movement_pattern,
    'region',v_choice.body_region,
    'instructions',v_choice.instructions,
    'tips',v_choice.tips,
    'image_path',v_choice.image_path,
    'tracking_modes',coalesce(to_jsonb(v_choice.tracking_modes),'[]'::jsonb),
    'prescription',v_pres,
    'expected_outcome',jsonb_build_object(
      'block_key','skill',
      'goal','technical_quality_or_progression',
      'skill_reason',v_skill_reason,
      'pain_gate',true,
      'equipment_gate',true,
      'skill_path_key',v_path.path_key,
      'skill_path_name',v_path.display_name,
      'skill_path_step',v_choice.step_order,
      'skill_objective_type',v_contract->>'objective_type',
      'score_required',coalesce((v_contract->>'score_required')::boolean,false),
      'score_metric',v_contract->>'score_metric',
      'trajectory_memory',v_choice_source='TRAJECTORY_MEMORY',
      'auto_direct_progression',v_auto_progressed,
      'capability_promoted',false
    )
  );

  select coalesce(jsonb_agg(
    case when b->>'block_key'='skill' then
      b||jsonb_build_object(
        'block_name','Skill',
        'exercises',jsonb_build_array(v_ex),
        'structure',v_contract->>'structure',
        'objective',(v_contract->>'objective_title')||' — '||(v_contract->>'objective_description'),
        'skill_contract',v_contract,
        'skill_path',jsonb_build_object(
          'key',v_path.path_key,'name',v_path.display_name,'step',v_choice.step_order,'source',v_choice_source
        ),
        'expected_outcome',coalesce(b->'expected_outcome','{}'::jsonb)||jsonb_build_object(
          'role','skill_development','skill_reason',v_skill_reason,'contract_version','skill-contract-v2',
          'skill_path_key',v_path.path_key,'skill_path_name',v_path.display_name,'skill_path_step',v_choice.step_order
        )
      )
    else b end order by ord
  ),'[]'::jsonb)
  into v_blocks
  from jsonb_array_elements(coalesce(r->'blocks','[]'::jsonb)) with ordinality x(b,ord);

  r:=jsonb_set(r,'{blocks}',v_blocks,true);
  r:=jsonb_set(r,'{architecture,skill_path}',jsonb_build_object(
    'version','skill-path-v2-focus-cycle',
    'applied',true,
    'family_first_selection',true,
    'path_key',v_path.path_key,
    'path_name',v_path.display_name,
    'path_region',v_path.body_region,
    'step',v_choice.step_order,
    'exercise_id',v_choice.id,
    'selection_source',v_choice_source,
    'same_day_continuity',coalesce(v_path.same_day_continuity,false),
    'recent_path_count',coalesce(v_path.recent_count,0),
    'mini_cycle',jsonb_build_object(
      'version','skill-mini-cycle-v1',
      'active',v_mini_active,
      'anchor_path_key',v_mini_anchor_path,
      'selected_anchor_path',v_mini_active and v_path.path_key=v_mini_anchor_path,
      'completed_exposures_before_session',v_mini_completed_exposures,
      'target_completed_exposures',v_mini_target,
      'window_days',v_mini_window_days,
      'max_gap_days',v_mini_max_gap_days,
      'last_completed_date',v_mini_last_completed_date,
      'completed_exposures_only',true,
      'region_coherence_before_minicycle',true,
      'disabled_by_low_readiness_or_deload',public.normalize_session_readiness(p_readiness)='low' or upper(coalesce(p_progression_intent,''))='DELOAD'
    ),
    'focus_cycle',coalesce(v_focus,'{}'::jsonb)||jsonb_build_object(
      'selected_path_key',v_path.path_key,
      'selected_anchor_path',v_focus_anchor_path is not null and v_path.path_key=v_focus_anchor_path,
      'selection_outcome',case
        when v_focus_decision='FOCUS' and v_path.path_key=v_focus_anchor_path then 'FOCUS'
        when v_focus_decision='FOCUS' then 'CONTEXT_DETOUR'
        when v_focus_decision='DETOUR' and v_path.path_key is distinct from v_focus_anchor_path then 'DETOUR'
        when v_focus_decision='DETOUR' then 'DETOUR_FALLBACK_NO_ALTERNATIVE'
        when v_focus_decision='ROTATE' and v_path.path_key is distinct from v_focus_anchor_path then 'ROTATE'
        when v_focus_decision='ROTATE' then 'ROTATION_FALLBACK_NO_ALTERNATIVE'
        when v_focus_decision='PAUSE' then 'PAUSED_GUARDRAIL_SELECTION'
        else 'OPEN_SELECTION'
      end,
      'selection_authority','ACTIVE_SOFT_BIAS',
      'hard_gates_remain_authoritative',true,
      'trajectory_memory_preserved',true,
      'focus_can_return_later',true
    ),
    'anchor_source_session_id',case when v_anchor.source_session_id is null then null else v_anchor.source_session_id end,
    'manual_anchor',v_manual_anchor,
    'auto_direct_progression',v_auto_progressed,
    'presented_memory_does_not_create_mastery',true,
    'rotation_between_paths_progression_within_path',true
  ),true);
  r:=jsonb_set(r,'{architecture,skill_trajectory_memory}',jsonb_build_object(
    'version','skill-trajectory-memory-v2-path-scoped',
    'applied',v_choice_source in ('TRAJECTORY_MEMORY','AUTO_DIRECT_PROGRESSION'),
    'path_key',v_path.path_key,
    'exercise_id',v_choice.id,
    'source_session_id',case when v_anchor.source_session_id is null then null else v_anchor.source_session_id end,
    'manual_selected',v_manual_anchor,
    'continuity_without_mastery_assumption',true,
    'path_scoped_not_global',true
  ),true);
  return r;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.c4_skill_contract_v1(p_user_id uuid, p_exercise_id text, p_skill_reason text, p_skill_minutes integer, p_progression_intent text, p_readiness text, p_base_prescription jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  v_tracking text[] := '{}'::text[];
  v_complexity int := 1;
  v_reps_semantics text := coalesce(p_base_prescription->>'reps_semantics','total');
  v_evidence int := 0;
  v_mastery numeric := null;
  v_confidence numeric := null;
  v_freshness numeric := null;
  v_recommendation text := null;
  v_readiness text := public.normalize_session_readiness(p_readiness);
  v_objective text;
  v_description text;
  v_sets int;
  v_rest int;
  v_target_reps int := null;
  v_target_seconds int := null;
  v_target_distance int := null;
  v_has_load boolean := false;
  v_has_reps boolean := false;
  v_has_time boolean := false;
  v_has_distance boolean := false;
  v_score_metric text := null;
  v_score_label text := null;
  v_score_unit text := null;
  v_structure text;
  v_patch jsonb := '{}'::jsonb;
begin
  select coalesce(e.tracking_modes,'{}'::text[]), coalesce(e.technical_complexity,1)
    into v_tracking, v_complexity
  from public.exercises e
  where e.id = p_exercise_id
  limit 1;

  select
    coalesce(s.valid_evidence_count,0),
    s.mastery_score,
    coalesce(s.capability_confidence,s.overall_confidence),
    s.capability_freshness,
    upper(coalesce(s.recommendation,''))
  into v_evidence, v_mastery, v_confidence, v_freshness, v_recommendation
  from public.user_exercise_coach_state s
  where s.user_id=p_user_id and s.exercise_id=p_exercise_id
  limit 1;

  v_evidence := coalesce(v_evidence,0);
  v_has_load := 'load'=any(v_tracking);
  v_has_reps := 'reps'=any(v_tracking);
  v_has_time := 'time'=any(v_tracking);
  v_has_distance := 'distance'=any(v_tracking);

  if not coalesce((p_base_prescription->>'practice_only')::boolean,false)
     and v_readiness <> 'low'
     and v_evidence >= 2
     and (
       coalesce(p_skill_reason,'')='recalibration_window'
       or v_recommendation='RECALIBRATE'
       or (v_freshness is not null and v_freshness < 0.45)
     )
  then
    v_objective := 'TEST';
  elsif v_evidence = 0
     or v_recommendation='LEARN'
     or (v_mastery is not null and v_mastery < 45)
  then
    v_objective := 'APPRENTISSAGE';
  elsif v_evidence >= 3
     and coalesce(v_mastery,0) >= 75
     and coalesce(v_confidence,0) >= 0.60
     and v_recommendation not in ('PROGRESS_RECOMMENDED','PROGRESS_POSSIBLE','RECALIBRATE')
  then
    v_objective := 'ENTRETIEN';
  else
    v_objective := 'PROGRESSION';
  end if;

  v_sets := case
    when v_objective='TEST' then 3
    when v_objective='ENTRETIEN' then case when p_skill_minutes>=10 then 3 else 2 end
    when p_skill_minutes>=12 then 5
    when p_skill_minutes>=10 then 4
    else 3
  end;

  v_rest := case
    when v_objective='TEST' then 120
    when v_objective='PROGRESSION' and v_complexity>=3 then 90
    when v_objective='PROGRESSION' then 75
    when v_objective='APPRENTISSAGE' and v_complexity>=3 then 75
    else 60
  end;

  if nullif(p_base_prescription->>'execution_target_reps','') is not null then
    v_target_reps := round((p_base_prescription->>'execution_target_reps')::numeric)::int;
  elsif nullif(p_base_prescription->>'reps_min','') is not null or nullif(p_base_prescription->>'reps_max','') is not null then
    v_target_reps := round((coalesce(nullif(p_base_prescription->>'reps_min','')::numeric,nullif(p_base_prescription->>'reps_max','')::numeric)
      + coalesce(nullif(p_base_prescription->>'reps_max','')::numeric,nullif(p_base_prescription->>'reps_min','')::numeric))/2.0)::int;
  end if;

  if nullif(p_base_prescription->>'execution_target_duration_seconds','') is not null then
    v_target_seconds := round((p_base_prescription->>'execution_target_duration_seconds')::numeric)::int;
  elsif nullif(p_base_prescription->>'duration_seconds_min','') is not null or nullif(p_base_prescription->>'duration_seconds_max','') is not null then
    v_target_seconds := round((coalesce(nullif(p_base_prescription->>'duration_seconds_min','')::numeric,nullif(p_base_prescription->>'duration_seconds_max','')::numeric)
      + coalesce(nullif(p_base_prescription->>'duration_seconds_max','')::numeric,nullif(p_base_prescription->>'duration_seconds_min','')::numeric))/2.0)::int;
  end if;

  if nullif(p_base_prescription->>'execution_target_distance_meters','') is not null then
    v_target_distance := round((p_base_prescription->>'execution_target_distance_meters')::numeric)::int;
  elsif nullif(p_base_prescription->>'distance_meters_min','') is not null or nullif(p_base_prescription->>'distance_meters_max','') is not null then
    v_target_distance := round((coalesce(nullif(p_base_prescription->>'distance_meters_min','')::numeric,nullif(p_base_prescription->>'distance_meters_max','')::numeric)
      + coalesce(nullif(p_base_prescription->>'distance_meters_max','')::numeric,nullif(p_base_prescription->>'distance_meters_min','')::numeric))/2.0)::int;
  end if;

  if v_objective='APPRENTISSAGE' then
    v_description := 'Découvre le mouvement. Concentre-toi sur le contrôle et une exécution propre.';
  elsif v_objective='ENTRETIEN' then
    v_description := 'On entretient ce mouvement aujourd’hui. Reste propre et efficace, sans chercher l’échec.';
  elsif v_objective='TEST' then
    if v_has_load then
      v_description := 'Va chercher ta meilleure charge propre sur le format proposé. Ton score servira de nouvelle référence.';
      v_score_metric := 'load_kg'; v_score_label := 'CHARGE'; v_score_unit := 'kg';
    elsif v_has_reps then
      v_description := 'Va chercher ta meilleure série propre. Ton score servira de nouvelle référence.';
      v_score_metric := 'max_reps'; v_score_label := 'MAX REPS'; v_score_unit := 'reps';
    elsif v_has_time then
      v_description := 'Tiens le plus longtemps possible sans perdre la position. Ton score servira de nouvelle référence.';
      v_score_metric := 'max_duration_seconds'; v_score_label := 'TEMPS'; v_score_unit := 'sec';
    elsif v_has_distance then
      v_description := 'Va chercher ta meilleure distance propre. Ton score servira de nouvelle référence.';
      v_score_metric := 'max_distance_meters'; v_score_label := 'DISTANCE'; v_score_unit := 'm';
    else
      v_description := 'Va chercher ta meilleure performance propre. Ton score servira de nouvelle référence.';
      v_score_metric := 'score'; v_score_label := 'SCORE'; v_score_unit := null;
    end if;
  else
    if v_has_load and nullif(p_base_prescription->>'load_kg','') is not null then
      v_description := 'On augmente légèrement la charge. Concentre-toi sur un mouvement propre et régulier.';
    elsif v_has_reps then
      v_description := 'On augmente légèrement les reps. Garde la même qualité jusqu’à la dernière.';
    elsif v_has_time then
      v_description := 'On augmente légèrement le temps de travail. Reste solide et propre jusqu’au bout.';
    elsif v_has_distance then
      v_description := 'On augmente légèrement la distance. Garde une exécution propre et régulière.';
    else
      v_description := 'On augmente légèrement la difficulté. Concentre-toi sur un mouvement propre et régulier.';
    end if;
  end if;

  v_patch := jsonb_build_object(
    'block_role','skill',
    'skill_reason',p_skill_reason,
    'skill_objective_type',v_objective,
    'skill_objective_description',v_description,
    'target_duration_minutes',p_skill_minutes,
    'sets',v_sets,
    'rest_between_sets_seconds',v_rest,
    'quality_priority','clean_reps_before_intensity',
    'skill_contract_version','skill-contract-v2'
  );

  if v_objective <> 'TEST' then
    if v_target_reps is not null then v_patch := v_patch || jsonb_build_object('execution_target_reps',v_target_reps); end if;
    if v_target_seconds is not null then v_patch := v_patch || jsonb_build_object('execution_target_duration_seconds',v_target_seconds); end if;
    if v_target_distance is not null then v_patch := v_patch || jsonb_build_object('execution_target_distance_meters',v_target_distance); end if;
  else
    v_patch := v_patch || jsonb_build_object(
      'test_metric',v_score_metric,
      'test_score_label',v_score_label,
      'test_score_unit',v_score_unit,
      'test_score_required',true,
      'test_attempts',v_sets
    );
  end if;

  if v_objective='TEST' then
    v_structure := case
      when v_score_metric='load_kg' then format('%s tentatives · meilleure charge propre · %ss repos',v_sets,v_rest)
      when v_score_metric='max_reps' then format('%s tentatives · max reps propres · %ss repos',v_sets,v_rest)
      when v_score_metric='max_duration_seconds' then format('%s tentatives · temps max propre · %ss repos',v_sets,v_rest)
      when v_score_metric='max_distance_meters' then format('%s tentatives · distance max propre · %ss repos',v_sets,v_rest)
      else format('%s tentatives · meilleure performance propre · %ss repos',v_sets,v_rest)
    end;
  elsif v_target_reps is not null then
    v_structure := format('%s séries · %s reps%s · %ss repos',v_sets,v_target_reps,
      case when v_reps_semantics='per_side' then ' / côté' else '' end,v_rest);
  elsif v_target_seconds is not null then
    v_structure := format('%s séries · %ss · %ss repos',v_sets,v_target_seconds,v_rest);
  elsif v_target_distance is not null then
    v_structure := format('%s séries · %s m · %ss repos',v_sets,v_target_distance,v_rest);
  else
    v_structure := format('%s séries · %ss repos',v_sets,v_rest);
  end if;

  return jsonb_build_object(
    'version','skill-contract-v2',
    'objective_type',v_objective,
    'objective_title',v_objective,
    'objective_description',v_description,
    'structure',v_structure,
    'sets',v_sets,
    'rest_seconds',v_rest,
    'score_required',(v_objective='TEST'),
    'score_metric',v_score_metric,
    'score_label',v_score_label,
    'score_unit',v_score_unit,
    'prescription_patch',v_patch,
    'evidence_count',v_evidence,
    'mastery_score',v_mastery,
    'capability_confidence',v_confidence,
    'capability_freshness',v_freshness
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.c4_apply_skill_curriculum_v1(p_user_id uuid, p_plan jsonb, p_zone_terms text[] DEFAULT '{}'::text[], p_inventory jsonb DEFAULT '[]'::jsonb, p_max_complexity integer DEFAULT 3, p_progression_intent text DEFAULT NULL::text, p_readiness text DEFAULT 'normal'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
 r jsonb:=coalesce(p_plan,'{}'::jsonb); v_skill jsonb; v_target jsonb; v_target_id text; v_path text;
 v_minutes int; v_target_step public.skill_curriculum_steps_v1%rowtype; v_target_json jsonb; v_target_complexity int:=1;
 v_ids text[]; v_safe text[]:='{}'::text[]; v_wod text[]:='{}'::text[]; v_limit int; v_count int; v_alloc int;
 v_id text; v_ord int; v_e public.exercises%rowtype; v_s public.skill_curriculum_steps_v1%rowtype; v_sj jsonb;
 v_role text; v_base jsonb; v_contract jsonb; v_pres jsonb; v_sets int; v_exercises jsonb:='[]'::jsonb; v_blocks jsonb;
 v_original_contract jsonb;
begin
 if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;
 if coalesce(r->>'status','')<>'READY' then return r; end if;
 select b into v_skill from jsonb_array_elements(coalesce(r->'blocks','[]'::jsonb)) b where b->>'block_key'='skill' limit 1;
 if v_skill is null or jsonb_array_length(coalesce(v_skill->'exercises','[]'::jsonb))=0 then return r; end if;
 v_minutes:=coalesce(nullif(v_skill->>'duration_minutes','')::int,0);
 v_target:=v_skill#>'{exercises,0}'; v_target_id:=v_target->>'exercise_id';
 v_path:=coalesce(v_target#>>'{prescription,skill_path_key}',v_skill#>>'{skill_path,key}',r#>>'{architecture,skill_path,path_key}');
 v_original_contract:=coalesce(v_skill->'skill_contract','{}'::jsonb);
 if coalesce((v_original_contract->>'score_required')::boolean,false) then return jsonb_set(r,'{architecture,skill_curriculum}',jsonb_build_object('version','skill-curriculum-v1','applied',false,'reason','TARGET_CONTROLLED_TEST','no_extra_calibration_added',true),true); end if;
 select * into v_target_step from public.skill_curriculum_steps_v1 where path_key=v_path and exercise_id=v_target_id and active;
 if not found then return jsonb_set(r,'{architecture,skill_curriculum}',jsonb_build_object('version','skill-curriculum-v1','applied',false,'reason','NO_CURATED_STEP'),true); end if;
 v_target_json:=public.skill_curriculum_step_v1(v_path,v_target_id); select coalesce(technical_complexity,1) into v_target_complexity from public.exercises where id=v_target_id;
 v_ids:=public.skill_curriculum_lesson_ids_v1(v_path,v_target_id); v_limit:=case when v_minutes>=9 then 4 when v_minutes>=6 then 3 else 2 end;
 select coalesce(array_agg(eid order by ord),'{}'::text[]) into v_wod from (select e->>'exercise_id' eid,ord from jsonb_array_elements(coalesce((select b->'exercises' from jsonb_array_elements(coalesce(r->'blocks','[]'::jsonb)) b where b->>'block_key'='wod' limit 1),'[]'::jsonb)) with ordinality z(e,ord)) q;
 select coalesce(array_agg(exercise_id order by ord),'{}'::text[]) into v_safe from (select d.exercise_id,d.ord from unnest(v_ids) with ordinality d(exercise_id,ord) join public.exercises e on e.id=d.exercise_id join public.skill_path_members m on m.path_key=v_path and m.exercise_id=d.exercise_id and m.active where public.exercise_safe_for_zones(e.id,public.normalize_body_zone_ids(coalesce(p_zone_terms,'{}'::text[]))) and public.exercise_equipment_compatible(e.id,coalesce(p_inventory,'[]'::jsonb)) and coalesce(e.fatigue_score,99)<=5 and coalesce(e.joint_impact,99)<=4 and (d.exercise_id=v_target_id or coalesce(e.technical_complexity,99)<=least(5,greatest(coalesce(p_max_complexity,3),v_target_complexity+1))) and (d.exercise_id=v_target_id or not (d.exercise_id=any(v_wod))) order by d.ord limit v_limit) q;
 if not (v_target_id=any(v_safe)) then v_safe:=array_prepend(v_target_id,v_safe); end if; v_count:=coalesce(cardinality(v_safe),0);
 if v_count<2 then return jsonb_set(r,'{architecture,skill_curriculum}',jsonb_build_object('version','skill-curriculum-v1','applied',false,'reason','NO_SAFE_COMPANION'),true); end if;
 v_alloc:=greatest(2,floor(v_minutes::numeric/v_count)::int);
 for v_id,v_ord in select exercise_id,ord::int from unnest(v_safe) with ordinality q(exercise_id,ord) order by ord loop
  select * into v_e from public.exercises where id=v_id; select * into v_s from public.skill_curriculum_steps_v1 where path_key=v_path and exercise_id=v_id and active; v_sj:=public.skill_curriculum_step_v1(v_path,v_id);
  v_role:=case when v_id=v_target_id then 'TARGET' when v_s.step_order<v_target_step.step_order then 'FOUNDATION' when v_s.step_order=v_target_step.step_order then 'COMPANION' else 'TRANSFER' end;
  v_base:=public.c2_solver_prescription(p_user_id,v_id,coalesce(r->'stimulus','{}'::jsonb),'SKILL',p_progression_intent,coalesce(p_inventory,'[]'::jsonb));  if coalesce((r#>>'{architecture,skill_practice_only}')::boolean,false) then v_base:=v_base||jsonb_build_object('practice_only',true); end if;
 v_contract:=public.c4_skill_contract_v1(p_user_id,v_id,coalesce(r#>>'{architecture,skill_reason}','curriculum_learning'),v_alloc,p_progression_intent,p_readiness,v_base);
  v_pres:=case when v_id=v_target_id then coalesce(v_target->'prescription','{}'::jsonb) else v_base end ||coalesce(v_contract->'prescription_patch','{}'::jsonb);
  v_pres:=public.skill_curriculum_prescription_patch_v1(v_id,v_role,v_pres);
  v_sets:=coalesce(nullif(v_pres->>'sets','')::int,1); if v_id not in ('EX451','EX466','EX201') then v_sets:=case when v_count>=4 then least(v_sets,2) else least(v_sets,3) end; end if;
  v_pres:=v_pres||jsonb_build_object('sets',greatest(1,v_sets),'target_duration_minutes',v_alloc,'allocated_duration_seconds',greatest(60,floor((v_minutes*60)::numeric/v_count)::int),'curriculum_version','skill-curriculum-v1','curriculum_path_key',v_path,'curriculum_target_exercise_id',v_target_id,'curriculum_role',v_role,'curriculum_lesson_order',v_ord,'curriculum_lesson_count',v_count,'curriculum_stage',v_s.pedagogical_stage,'curriculum_learning_objective',v_sj->>'learning_objective','curriculum_coach_focus',v_sj->>'coach_focus','curriculum_success_signal',v_sj->>'success_signal','curriculum_next_step_hint',v_sj->>'next_step_hint','curriculum_skill_only',true,'quality_priority','technique_before_fatigue');
  v_exercises:=v_exercises||jsonb_build_array(jsonb_build_object('exercise_id',v_e.id,'name',v_e.name,'family',v_e.exercise_family,'pattern',v_e.movement_pattern,'region',v_e.body_region,'instructions',v_e.instructions,'tips',v_e.tips,'image_path',v_e.image_path,'tracking_modes',coalesce(to_jsonb(v_e.tracking_modes),'[]'::jsonb),'prescription',v_pres,'expected_outcome',jsonb_build_object('block_key','skill','goal','skill_curriculum_learning','pain_gate',true,'equipment_gate',true,'skill_path_key',v_path,'skill_path_step',v_s.step_order,'curriculum_version','skill-curriculum-v1','curriculum_target_exercise_id',v_target_id,'curriculum_role',v_role,'curriculum_stage',v_s.pedagogical_stage,'learning_objective',v_sj->>'learning_objective','coach_focus',v_sj->>'coach_focus','success_signal',v_sj->>'success_signal','next_step_hint',v_sj->>'next_step_hint','capability_promoted',false),'curriculum',jsonb_build_object('role',v_role,'stage',v_s.pedagogical_stage,'learning_objective',v_sj->>'learning_objective','coach_focus',v_sj->>'coach_focus','success_signal',v_sj->>'success_signal','next_step_hint',v_sj->>'next_step_hint','lesson_order',v_ord,'lesson_count',v_count)));
 end loop;
 select coalesce(jsonb_agg(case when b->>'block_key'='skill' then b||jsonb_build_object('block_name','Skill · Coach','exercises',v_exercises,'structure',format('Parcours coach · %s étapes · %s min',v_count,v_minutes),'objective',v_target_json->>'learning_objective','skill_contract',jsonb_build_object('version','skill-curriculum-v1','objective_type','CURRICULUM','objective_title','PARCOURS COACH','objective_description',v_target_json->>'learning_objective','score_required',false,'curriculum_version','skill-curriculum-v1','multi_drill',true,'lesson_count',v_count,'target_exercise_id',v_target_id,'pedagogical_stage',v_target_step.pedagogical_stage,'learning_objective',v_target_json->>'learning_objective','coach_focus',v_target_json->>'coach_focus','success_signal',v_target_json->>'success_signal','next_step_hint',v_target_json->>'next_step_hint'),'curriculum',jsonb_build_object('version','skill-curriculum-v1','path_key',v_path,'terminal_goal',(select terminal_goal from public.skill_curriculum_paths_v1 where path_key=v_path),'target_exercise_id',v_target_id,'lesson_drill_ids',to_jsonb(v_safe),'wod_unchanged',true,'no_calibration_forced',true)) else b end order by ord),'[]'::jsonb) into v_blocks from jsonb_array_elements(coalesce(r->'blocks','[]'::jsonb)) with ordinality x(b,ord);
 r:=jsonb_set(r,'{blocks}',v_blocks,true); r:=jsonb_set(r,'{architecture,skill_curriculum}',jsonb_build_object('version','skill-curriculum-v1','applied',true,'skill_only',true,'wod_unchanged',true,'path_key',v_path,'target_exercise_id',v_target_id,'lesson_drill_ids',to_jsonb(v_safe),'lesson_count',v_count,'no_calibration_forced',true,'performance_tracking_per_drill',true,'w3_causal_authority_preserved',true),true); return r;
end;$function$
;

CREATE OR REPLACE FUNCTION public.week_composer_prescription_preview_v1(p_user_id uuid, p_draft jsonb, p_equipment_names text[] DEFAULT '{}'::text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
 b jsonb; x jsonb; sol jsonb; blocks jsonb:='[]'; exercises jsonb; inventory jsonb;
 k text; mechanic text; n int; count_ex int; sets_count int; rest_s int; rounds_count int;
 reps int; total int:=0; duration int; intent text; seen text[]:='{}';
 strength_plan jsonb; wod_plan jsonb; skill_plan jsonb;
BEGIN
 IF auth.uid() IS NULL OR auth.uid()<>p_user_id THEN
   RAISE EXCEPTION 'FORBIDDEN_PREVIEW' USING ERRCODE='42501';
 END IF;
 IF jsonb_typeof(p_draft #> '{architecture,blocks}')<>'array'
    OR jsonb_array_length(p_draft #> '{architecture,blocks}') NOT BETWEEN 1 AND 6 THEN
   RAISE EXCEPTION 'INVALID_PREVIEW_BLOCKS';
 END IF;
 duration:=NULLIF(p_draft->>'duration_minutes','')::int;
 IF duration NOT BETWEEN 15 AND 180 THEN RAISE EXCEPTION 'INVALID_PREVIEW_DURATION'; END IF;
 mechanic:=upper(coalesce(p_draft #>> '{mechanic,key}',''));
 intent:=coalesce(nullif(p_draft->>'progression_intent',''),'MAINTAIN');
 inventory:=public.resolve_user_equipment_inventory(p_user_id,coalesce(p_equipment_names,'{}'::text[]),'c4-final-default');
 FOR b IN SELECT value FROM jsonb_array_elements(p_draft #> '{architecture,blocks}') LOOP
   k:=upper(coalesce(b->>'type','')); n:=nullif(b->>'minutes','')::int;
   IF k NOT IN ('WARMUP','TABATA','STRENGTH','SKILL','WOD') OR n NOT BETWEEN 2 AND 90
     OR k=ANY(seen) OR jsonb_typeof(b->'exercises')<>'array'
     OR jsonb_array_length(b->'exercises') NOT BETWEEN 1 AND 8 THEN
     RAISE EXCEPTION 'INVALID_PREVIEW_BLOCK';
   END IF;
   seen:=array_append(seen,k); total:=total+n; count_ex:=jsonb_array_length(b->'exercises');

   if k='WOD' and p_draft->>'wod_engine_version'='C4_COMPOSER_V2' then
     wod_plan:=public.week_composer_wod_authority_v2(p_user_id,jsonb_build_object(
       'mechanic_key',mechanic,'variant_key',p_draft#>>'{mechanic,variant_key}',
       'session_minutes',duration,'block_minutes',n,'exercises',b->'exercises',
       'equipment_names',to_jsonb(p_equipment_names),'environment_code',p_draft->>'environment_code',
       'focus',p_draft#>>'{intent,focus}','target_region',p_draft->>'target_region',
       'progression_intent',intent,'readiness','normal'));
     if wod_plan->>'status'<>'READY' then
       return wod_plan||jsonb_build_object('block_type','WOD','block_minutes',n);
     end if;
     select jsonb_agg(jsonb_build_object('id',e->>'exercise_id','name',e->>'name',
       'reps',coalesce(e#>'{prescription,execution_target_reps}',e#>'{prescription,reps_min}'),
       'reps_semantics',e#>'{prescription,reps_semantics}',
       'duration_seconds',coalesce(e#>'{prescription,execution_target_duration_seconds}',e#>'{prescription,duration_seconds}',e#>'{prescription,duration_seconds_min}'),
       'distance_meters',coalesce(e#>'{prescription,execution_target_distance_meters}',e#>'{prescription,distance_meters}',e#>'{prescription,distance_meters_min}'),
       'sets',e#>'{prescription,sets}','rest_seconds',e#>'{prescription,rest_seconds}',
       'load_kg',e#>'{prescription,load_kg}','load_scope',e#>'{prescription,load_scope}',
       'prescription_json',e->'prescription') ORDER BY ordinality) into exercises
       from jsonb_array_elements(wod_plan#>'{candidate,exercises}') WITH ORDINALITY e(e,ordinality);
     blocks:=blocks||jsonb_build_array(jsonb_build_object('type',k,'minutes',n,'mechanic',mechanic,
       'variant_key',p_draft#>>'{mechanic,variant_key}','parameters',wod_plan->'parameters',
       'time',wod_plan->'time','exercises',exercises,'source',wod_plan->>'source'));
     continue;
   end if;
   if k='SKILL' and p_draft->>'skill_engine_version'='C4_COMPOSER_SKILL_V1' then
     skill_plan:=public.week_composer_skill_authority_v1(p_user_id,
       public.week_composer_skill_context_v1(p_draft,b,p_equipment_names));
     if skill_plan->>'status'<>'READY' then return skill_plan||jsonb_build_object('block_minutes',n); end if;
     select jsonb_agg(jsonb_build_object('id',e->>'exercise_id','name',e->>'name',
       'reps',coalesce(e#>'{prescription,execution_target_reps}',e#>'{prescription,reps_min}'),
       'reps_semantics',e#>'{prescription,reps_semantics}',
       'duration_seconds',coalesce(e#>'{prescription,execution_target_duration_seconds}',e#>'{prescription,duration_seconds}'),
       'distance_meters',coalesce(e#>'{prescription,execution_target_distance_meters}',e#>'{prescription,distance_meters}'),
       'sets',e#>'{prescription,sets}','rest_seconds',e#>'{prescription,rest_seconds}',
       'load_kg',e#>'{prescription,load_kg}','load_scope',e#>'{prescription,load_scope}',
       'prescription_json',e->'prescription') order by ord) into exercises
       from jsonb_array_elements(skill_plan->'exercises') with ordinality e(e,ord);
     blocks:=blocks||jsonb_build_array(jsonb_build_object('type',k,'minutes',n,
       'source',skill_plan->'source','time',skill_plan->'time','skill_contract',skill_plan->'skill_contract',
       'curriculum',skill_plan->'curriculum','skill_path',skill_plan->'skill_path','exercises',exercises));
     continue;
   end if;
   strength_plan:=null;
   if k='STRENGTH' then
     strength_plan:=public.week_composer_strength_authority_v2(
       p_user_id,b->'exercises',duration,n,intent,p_equipment_names,
       coalesce(nullif(p_draft#>>'{intent,focus}',''),'Strength'),
       nullif(p_draft->>'target_region',''),'normal',
       coalesce(nullif(p_draft->>'environment_code',''),'BOX')
     );
     if strength_plan->>'status'<>'READY' then
       return jsonb_build_object(
         'status','NEEDS_RECOMPOSITION',
         'reason','STRENGTH_BLOCK_TIME_MISMATCH',
         'block_type',k,'block_minutes',n,
         'time',strength_plan->'time',
         'calculated_exercises',strength_plan->'exercises',
         'source',strength_plan->>'source'
       );
     end if;
   end if;
   sets_count:=CASE WHEN k='WARMUP' THEN CASE WHEN n>=6 THEN 2 ELSE 1 END
     WHEN k='STRENGTH' THEN (strength_plan->>'sets')::int
     WHEN k='SKILL' THEN CASE WHEN n>=15 THEN 3 ELSE 2 END ELSE NULL END;
   rest_s:=CASE WHEN k='STRENGTH' THEN (strength_plan->>'rest_seconds')::int WHEN k='SKILL' THEN 60 ELSE NULL END;
   rounds_count:=CASE WHEN k='TABATA' THEN 8
     WHEN k='WOD' AND mechanic='EMOM' THEN floor(n::numeric/count_ex)::int
     WHEN k='WOD' AND mechanic='FOR_TIME' THEN greatest(1,least(5,floor(n::numeric/4)::int))
     WHEN k='WOD' AND mechanic='CIRCUIT' THEN greatest(2,least(4,floor(n::numeric/5)::int))
     WHEN k='WOD' AND mechanic='HIIT' THEN floor(n::numeric/count_ex)::int
     ELSE NULL END;
   exercises:='[]';
   FOR x IN SELECT value FROM jsonb_array_elements(b->'exercises') LOOP
     IF NOT EXISTS(SELECT 1 FROM public.exercises WHERE id=x->>'id') THEN
       RAISE EXCEPTION 'UNKNOWN_PREVIEW_EXERCISE';
     END IF;
     if k='STRENGTH' then
       select value->'solver_reference' into sol
       from jsonb_array_elements(strength_plan->'exercises') value
       where value->>'id'=x->>'id' limit 1;
     else
       sol:=public.c2_solver_prescription(p_user_id,x->>'id','{}'::jsonb,
         CASE WHEN k='SKILL' THEN 'STRENGTH' WHEN k='WOD' THEN mechanic ELSE k END,
         intent,inventory);
     end if;
     IF jsonb_typeof(sol)<>'object' THEN RAISE EXCEPTION 'MISSING_C2_PREVIEW'; END IF;
     reps:=coalesce(nullif(sol->>'reps_min','')::int,nullif(sol->>'reps_max','')::int);
     IF reps IS NOT NULL THEN
       if k='STRENGTH' then
         reps:=greatest(1,reps); -- Keep exact C2 dose used by C4 and Day J.
       else
         reps:=greatest(1,least(30,reps));
       end if;
       IF k='WOD' AND mechanic='EMOM' THEN reps:=least(10,reps); END IF;
     END IF;
     exercises:=exercises||jsonb_build_array(jsonb_build_object(
       'id',x->>'id','name',x->>'name','sets',sets_count,'rest_seconds',rest_s,
       'reps',CASE WHEN k='TABATA' THEN NULL ELSE reps END,
       'reps_semantics',sol->>'reps_semantics',
       'duration_seconds',CASE WHEN k<>'TABATA' AND reps IS NULL AND jsonb_typeof(sol->'duration_seconds_min')='number'
         THEN CASE WHEN k='STRENGTH' THEN (sol->>'duration_seconds_min')::int ELSE least(40,greatest(10,(sol->>'duration_seconds_min')::int)) END ELSE NULL END,
       'distance_meters',CASE WHEN k<>'TABATA' AND reps IS NULL AND jsonb_typeof(sol->'distance_meters_min')='number'
         THEN (sol->>'distance_meters_min')::int ELSE NULL END,
       'load_kg',CASE WHEN jsonb_typeof(sol->'load_kg')='number' THEN sol->'load_kg' ELSE NULL END,
       'load_scope',sol->'load_scope','band_resistance_label',sol->'band_resistance_label',
       'target_rpe_min',sol->'target_rpe_min','target_rpe_max',sol->'target_rpe_max',
       'evidence_count',sol->'valid_evidence_count',
       'intervals_per_exercise',CASE WHEN k='TABATA' AND 8%count_ex=0 THEN 8/count_ex ELSE NULL END,
       'work_seconds',CASE WHEN k='TABATA' THEN 20 ELSE NULL END,
       'solver_version',sol->'solver_version'));
   END LOOP;
   blocks:=blocks||jsonb_build_array(jsonb_build_object(
     'type',k,'minutes',n,'mechanic',CASE WHEN k='WOD' THEN mechanic ELSE NULL END,
     'rounds',rounds_count,'work_seconds',CASE WHEN k='TABATA' THEN 20 WHEN k='WOD' AND mechanic='HIIT' THEN 40 ELSE NULL END,
     'rest_seconds',CASE WHEN k='TABATA' THEN 10 WHEN k='WOD' AND mechanic='HIIT' THEN 20 ELSE NULL END,
     'exercises',exercises,'time',CASE WHEN k='STRENGTH' THEN strength_plan->'time' ELSE NULL END));
 END LOOP;
 IF total>duration THEN RAISE EXCEPTION 'PREVIEW_TIME_BUDGET_EXCEEDED'; END IF;
 RETURN jsonb_build_object('status','PREVIEW','version','composer-c2-preview-v1',
   'provisional',true,'duration_minutes',duration,'planned_block_minutes',total,'blocks',blocks,
   'shared_engine',true,'strength_authority','C2+C3+C4+UGEROD_TIME_ENGINE');
END;
$function$
;

CREATE OR REPLACE FUNCTION public.week_compile_composer_day_j_v1(p_user_id uuid, p_plan_item_id uuid, p_local_date date, p_readiness integer, p_pain_zones text[], p_available_equipment text[], p_environment_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_item public.user_training_plan_items%rowtype;
  v_draft jsonb;
  v_blocks jsonb;
  v_b jsonb;
  v_e jsonb;
  v_ex public.exercises%rowtype;
  v_inventory jsonb;
  v_mechanic text;
  v_env text;
  v_focus text;
  v_region text;
  v_intent text;
  v_duration integer;
  v_minutes integer;
  v_wod_minutes integer;
  v_total_minutes integer := 0;
  v_count integer;
  v_cycles integer;
  v_sets integer;
  v_rounds integer;
  v_rest integer;
  v_reps integer;
  v_reps_max integer;
  v_work integer;
  v_work_seconds integer;
  v_estimated_round_seconds integer;
  v_block_key text;
  v_type text;
  v_pres jsonb;
  v_solver jsonb;
  v_strength_plan jsonb;
  v_wod_plan jsonb;
  v_deck_plan jsonb;
  v_deck_caps numeric[];
  v_shared_wod boolean;
  v_skill_plan jsonb;
  v_params jsonb;
  v_ejson jsonb;
  v_out_blocks jsonb := '[]'::jsonb;
  v_out_exercises jsonb;
  v_ids text[] := '{}';
  v_block_ids text[] := '{}';
  v_keys text[] := '{}';
  v_id text;
  v_session_id uuid;
  v_exercise_instance_id uuid;
  v_active uuid;
  v_existing_status text;
  v_existing_source text;
  v_block_idx integer := 0;
  v_item_idx integer;
  v_wod_mechanic text;
  v_wod_params jsonb;
  v_pres_text text;
  v_rep_time integer;
  v_max_station integer;
  v_ctx jsonb;
  v_result jsonb;
  v_expected_stimulus jsonb;
begin
  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'Forbidden user' using errcode='42501';
  end if;
  if p_user_id is null or p_plan_item_id is null or p_local_date is null then
    raise exception 'Missing Composer identity/date';
  end if;
  if p_readiness is null or p_readiness not between 1 and 10 then
    raise exception 'READINESS_REQUIRED';
  end if;
  if p_pain_zones is null or cardinality(p_pain_zones)=0 then
    raise exception 'PAIN_CHECK_REQUIRED';
  end if;
  if p_available_equipment is null then
    raise exception 'EQUIPMENT_CONFIRMATION_REQUIRED';
  end if;
  if p_local_date < current_date-1 or p_local_date > current_date+1 then
    raise exception 'DAY_J_ONLY';
  end if;

  select * into v_item
  from public.user_training_plan_items
  where id=p_plan_item_id and user_id=p_user_id
  for update;
  if not found or v_item.recommended_date is distinct from p_local_date then
    raise exception 'COMPOSER_DAY_MISMATCH';
  end if;
  if v_item.session_id is not null then
    select status,planning_context_json->>'session_source'
      into v_existing_status,v_existing_source
    from public.workout_sessions
    where id=v_item.session_id and user_id=p_user_id;
    if v_existing_source='W11_COMPOSER_DAY_J' then
      return jsonb_build_object('status','ALREADY_READY','session_id',v_item.session_id,
        'session_status',v_existing_status,'plan_item_id',v_item.id,'idempotent',true);
    end if;
    raise exception 'PLAN_ITEM_ALREADY_BOUND_TO_ANOTHER_SESSION';
  end if;
  if v_item.status not in ('available','claimed') then
    raise exception 'PLAN_ITEM_NOT_EDITABLE';
  end if;
  select id into v_active from public.workout_sessions
  where user_id=p_user_id and generation_local_date=p_local_date and status in ('generated','in_progress')
  order by generated_at desc limit 1;
  if v_active is not null then
    return jsonb_build_object('status','OTHER_SESSION_ACTIVE','session_id',v_active,
      'plan_item_id',v_item.id,'idempotent',false);
  end if;

  v_draft:=v_item.planning_context_json #> '{w11,composer_draft}';
  if jsonb_typeof(v_draft)<>'object' or coalesce(v_draft->>'version','')<>'w11-composer-draft-v1' then
    raise exception 'COMPOSER_DRAFT_NOT_FOUND';
  end if;
  if coalesce((v_draft->>'structure_stable')::boolean,false)<>true then
    raise exception 'UNSTABLE_COMPOSITION';
  end if;
  v_shared_wod:=coalesce(v_draft->>'wod_engine_version','')='C4_COMPOSER_V2';
  v_blocks:=v_draft #> '{architecture,blocks}';
  if jsonb_typeof(v_blocks)<>'array' or jsonb_array_length(v_blocks) not between 1 and 6 then
    raise exception 'COMPOSER_BLOCKS_INVALID';
  end if;
  v_duration:=nullif(v_draft->>'duration_minutes','')::integer;
  if v_duration is null or v_duration not between 15 and 180 then
    raise exception 'COMPOSER_DURATION_INVALID';
  end if;
  v_env:=upper(coalesce(v_draft->>'environment_code',''));
  if v_env not in ('HOME','BOX','GYM','OUTDOOR')
     or v_env<>upper(coalesce(p_environment_code,'')) then
    raise exception 'ENVIRONMENT_CHANGED_REQUIRES_RECOMPOSITION';
  end if;
  -- Outdoor needs the same explicit terrain gate as the standard generator.
  if v_env='OUTDOOR' and nullif(v_item.planning_context_json #>> '{w11,future_context,surface_code}','') is null then
    raise exception 'OUTDOOR_SURFACE_REQUIRED';
  end if;
  v_region:=nullif(v_draft->>'target_region','');
  v_focus:=coalesce(nullif(v_draft#>>'{intent,focus}',''),'General Fitness');
  v_intent:=coalesce(nullif(v_item.planned_progression_intent,''),'MAINTAIN');
  v_inventory:=public.resolve_user_equipment_inventory(p_user_id,p_available_equipment,'c4-final-default');
  v_mechanic:=upper(coalesce(v_draft#>>'{mechanic,key}',''));
  if exists(select 1 from jsonb_array_elements(v_blocks) b where upper(b->>'type')='WOD') then
    if not v_shared_wod and (v_mechanic not in ('AMRAP','EMOM','FOR_TIME','CIRCUIT','HIIT')
       or not exists(select 1 from public.workout_mechanics m where m.mechanic_key=v_mechanic
          and m.active and m.mechanic_kind='core' and m.manual_free_eligible)) then
      raise exception 'COMPOSER_MECHANIC_NOT_EXECUTABLE_%',v_mechanic;
    end if;
  end if;

  -- Preflight the entire user-selected structure before creating anything.
  for v_b in select value from jsonb_array_elements(v_blocks) loop
    v_block_ids:='{}'; -- separate uniqueness per authored block
    v_type:=upper(coalesce(v_b->>'type',''));
    if v_type not in ('WARMUP','TABATA','STRENGTH','SKILL','WOD') then
      raise exception 'COMPOSER_UNSUPPORTED_BLOCK_%',v_type;
    end if;
    if v_type=any(v_keys) then raise exception 'COMPOSER_DUPLICATE_BLOCK_%',v_type; end if;
    v_keys:=array_append(v_keys,v_type);
    v_minutes:=nullif(v_b->>'minutes','')::integer;
    if v_minutes is null or v_minutes<2 or v_minutes>90 then
      raise exception 'COMPOSER_INVALID_BLOCK_DURATION_%',v_type;
    end if;
    if v_type='TABATA' and v_minutes<>4 then
      raise exception 'TABATA_MUST_BE_4_MINUTES';
    end if;
    v_total_minutes:=v_total_minutes+v_minutes;
    if jsonb_typeof(v_b->'exercises')<>'array' or jsonb_array_length(v_b->'exercises')=0
       or jsonb_array_length(v_b->'exercises')>8 then
      raise exception 'COMPOSER_BLOCK_EXERCISES_INVALID_%',v_type;
    end if;
    if v_type='WOD' and v_mechanic='EMOM'
       and v_minutes<jsonb_array_length(v_b->'exercises') then
      raise exception 'EMOM_TOO_SHORT_FOR_STATIONS';
    end if;
    for v_e in select value from jsonb_array_elements(v_b->'exercises') loop
      v_id:=v_e->>'id';
      if v_id is null or v_id=any(v_block_ids) then
        raise exception 'COMPOSER_DUPLICATE_OR_MISSING_EXERCISE_%',coalesce(v_id,'null');
      end if;
      v_block_ids:=array_append(v_block_ids,v_id);
      v_ids:=array_append(v_ids,v_id);
      select * into v_ex from public.exercises where id=v_id;
      if not found then raise exception 'COMPOSER_UNKNOWN_EXERCISE_%',v_id; end if;
      if not public.exercise_environment_eligible_v1(v_id,v_env)
        or not public.exercise_safe_for_zones(v_id,public.normalize_body_zone_ids(p_pain_zones))
        or not public.exercise_equipment_compatible(v_id,v_inventory) then
        raise exception 'COMPOSER_EXERCISE_INCOMPATIBLE_%',v_id;
      end if;
      if v_type='WARMUP' and not coalesce(v_ex.warmup_eligible,false) then
        raise exception 'COMPOSER_NOT_WARMUP_ELIGIBLE_%',v_id;
      end if;
      if v_type='TABATA' and not coalesce(v_ex.tabata_eligible,false) then
        raise exception 'COMPOSER_NOT_TABATA_ELIGIBLE_%',v_id;
      end if;
    end loop;
  end loop;
  if v_total_minutes>v_duration then
    raise exception 'COMPOSER_TIME_BUDGET_EXCEEDED';
  end if;

  -- Store the selected workload as an explicit user-authored expected-stimulus
  -- contract; the generic C4 target policy may not support every Composer focus.
  begin
    v_expected_stimulus:=public.build_session_stimulus_target(v_focus,v_duration,
      p_readiness::text,v_region,v_intent,'c4-final-default');
  exception when others then
    v_expected_stimulus:=jsonb_build_object(
      'stimulus_model_status','USER_AUTHORED_NOT_AUTO_DERIVED');
  end;
  v_expected_stimulus:=coalesce(v_expected_stimulus,'{}'::jsonb)||
    jsonb_build_object('source','W11_COMPOSER_DAY_J','user_authored',true,
      'focus',v_focus,'duration_minutes',v_duration,'readiness',p_readiness,
      'target_region',v_region,'progression_intent',v_intent,
      'auto_generation_used',false);

  -- A single transaction owns both the session and every exercise; any failed
  -- dose, compatibility or density check rolls everything back.
  v_session_id:=gen_random_uuid();
  insert into public.workout_sessions (
    id,user_id,status,duration_minutes,target_region,readiness,focus,
    available_equipment,injured_zones,generated_at,progression_intent,
    generated_workout,planning_context_json,expected_stimulus_json,quality_gate_json,generation_local_date,
    planned_environment_code,planned_environment_source,planned_environment_selected_at,planned_surface_code
  ) values (
    v_session_id,p_user_id,'generated',v_duration,v_region,p_readiness::text,v_focus,
    p_available_equipment,p_pain_zones,now(),v_intent,
    jsonb_build_object('version','w11-composer-player-v1','blocks','[]'::jsonb),
    jsonb_build_object('session_source','W11_COMPOSER_DAY_J','plan_item_id',v_item.id,
      'composer_draft',v_draft,'user_block_order_preserved',true,'day_j_readiness',p_readiness),
    v_expected_stimulus,
    jsonb_build_object('source','w11-composer-finalizer-v1','pass',true,
      'user_exercise_choices_preserved',true,'time_budget_minutes',v_duration),
    p_local_date,v_env,'USER_COMPOSER',now(),
    nullif(v_item.planning_context_json #>> '{w11,future_context,surface_code}','')
  );

  for v_b in select value from jsonb_array_elements(v_blocks) loop
    v_block_idx:=v_block_idx+1;
    v_type:=upper(v_b->>'type');
    v_minutes:=(v_b->>'minutes')::integer;
    v_count:=jsonb_array_length(v_b->'exercises');
    v_block_key:=case v_type when 'WARMUP' then 'warm_up'
      when 'TABATA' then 'tabata' when 'STRENGTH' then 'strength'
      when 'SKILL' then 'skill' else 'wod' end;
    v_params:='{}'::jsonb;
    v_rounds:=null;
    v_rest:=null;
    v_wod_minutes:=v_minutes;
    v_wod_plan:=null;
    v_skill_plan:=null;
    if v_type='WOD' and v_shared_wod then
      v_wod_plan:=public.week_composer_wod_authority_v2(p_user_id,jsonb_build_object(
        'mechanic_key',v_mechanic,'variant_key',v_draft#>>'{mechanic,variant_key}',
        'session_minutes',v_duration,'block_minutes',v_minutes,'exercises',v_b->'exercises',
        'equipment_names',to_jsonb(p_available_equipment),'environment_code',v_env,'focus',v_focus,
        'target_region',v_region,'progression_intent',v_intent,'readiness',p_readiness::text,
        'pain_zones',to_jsonb(p_pain_zones)));
      if v_wod_plan->>'status'<>'READY' then
        raise exception 'COMPOSER_WOD_RECOMPOSITION_REQUIRED_%',v_wod_plan->>'reason';
      end if;
      v_params:=v_wod_plan->'parameters';
      if v_mechanic='DECK' then
        select array_agg(public.c4_deck_exercise_rep_cap_v1(p_user_id,value->>'exercise_id',p_readiness::text,v_intent) order by ordinality)
        into v_deck_caps from jsonb_array_elements(v_wod_plan#>'{candidate,exercises}') with ordinality;
        v_deck_plan:=public.c4_build_deck_plan_v2(v_session_id,(v_params->>'cards')::int,v_deck_caps);
        if not coalesce((v_deck_plan->>'safe')::boolean,false) then raise exception 'COMPOSER_NO_SAFE_DECK_DRAW'; end if;
        v_params:=v_params||jsonb_build_object('deck_order',v_deck_plan->'deck_order',
          'deck_order_version','deck-adaptive-order-v1','deck_suit_reps',v_deck_plan->'suit_reps',
          'deck_suit_card_counts',v_deck_plan->'suit_card_counts','deck_shuffle_attempt',v_deck_plan->'shuffle_attempt',
          'source_deck_cards',52,'without_replacement',true,'safe_random_draw',true);
      end if;
      v_sets:=null;
    elsif v_type='WARMUP' then
      v_sets:=case when v_minutes>=6 then 2 else 1 end;
      v_params:=jsonb_build_object('rounds',v_sets);
    elsif v_type='TABATA' then
      v_sets:=1;
      v_params:=jsonb_build_object('rounds',8,'work_seconds',20,'rest_seconds',10,
        'duration_minutes',4,'exercise_count',v_count);
    elsif v_type='STRENGTH' then
      v_strength_plan:=public.week_composer_strength_authority_v2(
        p_user_id,v_b->'exercises',v_duration,v_minutes,v_intent,
        p_available_equipment,v_focus,v_region,
        public.normalize_session_readiness(p_readiness::text),v_env
      );
      if v_strength_plan->>'status'<>'READY' then
        raise exception 'COMPOSER_STRENGTH_RECOMPOSITION_REQUIRED_%',v_strength_plan->>'status';
      end if;
      v_sets:=(v_strength_plan->>'sets')::int;
      v_rest:=(v_strength_plan->>'rest_seconds')::int;
      v_params:=jsonb_build_object(
        'sets',v_sets,'rest_seconds',v_rest,'duration_minutes',v_minutes,
        'dose_authority',v_strength_plan->>'source','time',v_strength_plan->'time'
      );
    elsif v_type='SKILL' then
      if v_draft->>'skill_engine_version'='C4_COMPOSER_SKILL_V1' then
        v_skill_plan:=public.week_composer_skill_authority_v1(p_user_id,
          public.week_composer_skill_context_v1(v_draft,v_b,p_available_equipment,p_pain_zones,p_readiness::text));
        if v_skill_plan->>'status'<>'READY' then
          raise exception 'COMPOSER_SKILL_RECOMPOSITION_REQUIRED_%',v_skill_plan->>'reason';
        end if;
        v_sets:=null;
        v_params:=jsonb_build_object('duration_minutes',v_minutes,'dose_authority',v_skill_plan->>'source','time',v_skill_plan->'time');
      else
        v_sets:=case when v_minutes>=15 then 3 else 2 end;
        v_rest:=60;
        v_params:=jsonb_build_object('sets',v_sets,'rest_seconds',v_rest,'duration_minutes',v_minutes);
      end if;
    else
      v_sets:=null;
      if v_mechanic='EMOM' then
        v_cycles:=floor(v_minutes::numeric/v_count)::integer;
        v_wod_minutes:=v_cycles*v_count;
        v_params:=jsonb_build_object('duration_minutes',v_wod_minutes,
          'cycles',v_cycles,'station_seconds',60,'exercise_count',v_count,
          'transition_budget_minutes',v_minutes-v_wod_minutes);
      elsif v_mechanic='AMRAP' then
        v_params:=jsonb_build_object('duration_minutes',v_minutes,'exercise_count',v_count);
      elsif v_mechanic='FOR_TIME' then
        v_rounds:=greatest(1,least(5,floor(v_minutes::numeric/4)::integer));
        v_params:=jsonb_build_object('rounds',v_rounds,'time_cap_minutes',v_minutes,
          'cap_seconds',v_minutes*60);
      elsif v_mechanic='CIRCUIT' then
        v_rounds:=greatest(2,least(4,floor(v_minutes::numeric/5)::integer));
        v_params:=jsonb_build_object('rounds',v_rounds,'rest_seconds',45,'rest_between_rounds_seconds',45,
          'duration_minutes',v_minutes);
      elsif v_mechanic='HIIT' then
        v_cycles:=floor(v_minutes::numeric/v_count)::integer;
        if v_cycles<2 then raise exception 'HIIT_TOO_SHORT_FOR_STATIONS'; end if;
        v_wod_minutes:=v_cycles*v_count;
        v_params:=jsonb_build_object('rounds',v_cycles,'exercise_count',v_count,
          'work_seconds',40,'rest_seconds',20,'duration_minutes',v_wod_minutes,
          'transition_budget_minutes',v_minutes-v_wod_minutes);
      end if;
    end if;
    v_estimated_round_seconds:=0;
    v_out_exercises:='[]'::jsonb;
    v_item_idx:=0;
    for v_e in select value from jsonb_array_elements(v_b->'exercises') loop
      v_item_idx:=v_item_idx+1;
      v_id:=v_e->>'id';
      select * into v_ex from public.exercises where id=v_id;
      if v_skill_plan is not null then
        select value->'prescription' into v_pres from jsonb_array_elements(v_skill_plan->'exercises')
          where value->>'exercise_id'=v_id;
        if v_pres is null then raise exception 'COMPOSER_SKILL_DOSE_MISSING'; end if;
        v_solver:=v_pres;
      elsif v_wod_plan is not null then
        select value->'prescription' into v_pres from jsonb_array_elements(v_wod_plan#>'{candidate,exercises}')
        where value->>'exercise_id'=v_id;
        if v_pres is null then raise exception 'COMPOSER_WOD_DOSE_MISSING'; end if;
        v_pres:=v_pres||jsonb_build_object('block_parameters',v_params);
        v_solver:=v_pres;
      else
      if v_type='STRENGTH' then
        select value->'solver_reference' into v_solver
        from jsonb_array_elements(v_strength_plan->'exercises') value
        where value->>'id'=v_id limit 1;
      else
        v_solver:=public.c2_solver_prescription(p_user_id,v_id,'{}'::jsonb,
          case when v_type='WARMUP' then 'WARMUP'
            when v_type='TABATA' then 'TABATA'
            when v_type='SKILL' then 'STRENGTH'
            else v_mechanic end,v_intent,v_inventory);
      end if;
      if jsonb_typeof(v_solver)<>'object' then raise exception 'COMPOSER_DOSE_UNAVAILABLE_%',v_id; end if;
      v_reps:=case when jsonb_typeof(v_solver->'reps_min')='number'
        then (v_solver->>'reps_min')::integer else null end;
      v_reps_max:=case when jsonb_typeof(v_solver->'reps_max')='number'
        then (v_solver->>'reps_max')::integer else null end;
      v_reps:=coalesce(v_reps,v_reps_max);
      v_pres:=jsonb_build_object('source','w11_composer_day_j_v1','finalized',true,
        'tracking_modes',coalesce(to_jsonb(v_ex.tracking_modes),'[]'::jsonb),
        'target_rpe_min',v_solver->'target_rpe_min','target_rpe_max',v_solver->'target_rpe_max',
        'solver_reference',v_solver,'duration_budget_minutes',v_minutes);
      if v_type='TABATA' then
        v_pres:=v_pres||jsonb_build_object('mechanic','TABATA','protocol',
          jsonb_build_object('rounds',8,'work_seconds',20,'rest_seconds',10),
          'duration_seconds',20,'text','20 s effort / 10 s récupération · 4 cycles par mouvement');
      elsif v_reps is not null and v_reps>0 then
        -- Strength doses are owned by C2/C4; do not apply a second cap.
        if v_type='STRENGTH' then
          v_reps:=greatest(1,v_reps);
        else
          v_reps:=greatest(1,least(v_reps,30));
        end if;
        -- Keep a real rest window inside each EMOM minute. Cap prescribed reps
        -- from the solver, never increase them to fill the available minute.
        if v_type='WOD' and v_mechanic='EMOM' then
          v_reps:=least(v_reps,10);
        end if;
        v_rep_time:=case when v_type='WOD' then 4 else 5 end;
        v_work_seconds:=v_reps*v_rep_time;
        v_estimated_round_seconds:=v_estimated_round_seconds+v_work_seconds+10;
        if v_type='WOD' and v_mechanic='EMOM' and v_work_seconds>42 then
          v_reps:=greatest(1,floor(42.0/v_rep_time)::integer);
          v_work_seconds:=v_reps*v_rep_time;
        end if;
        v_pres:=v_pres||jsonb_build_object('reps_min',v_reps,'reps_max',v_reps,
          'reps_semantics',coalesce(v_solver->>'reps_semantics','total'));
        if v_sets is not null then
          v_pres:=v_pres||jsonb_build_object('sets',v_sets,'rest_seconds',coalesce(v_rest,0));
        end if;
        v_pres:=v_pres||jsonb_build_object('text',
          case when v_sets is not null then v_sets||' × ' else '' end||v_reps||' reps');
      elsif jsonb_typeof(v_solver->'duration_seconds_min')='number' then
        v_work_seconds:=case when v_type='STRENGTH' then
          (v_solver->>'duration_seconds_min')::integer
          else least(40,greatest(10,(v_solver->>'duration_seconds_min')::integer)) end;
        v_estimated_round_seconds:=v_estimated_round_seconds+v_work_seconds+10;
        v_pres:=v_pres||jsonb_build_object('duration_seconds',v_work_seconds,
          'text',v_work_seconds||' s');
      elsif jsonb_typeof(v_solver->'distance_meters_min')='number' then
        v_pres:=v_pres||jsonb_build_object('distance_meters',
          (v_solver->>'distance_meters_min')::integer,
          'text',(v_solver->>'distance_meters_min')||' m');
        v_estimated_round_seconds:=v_estimated_round_seconds+45;
      else
        raise exception 'COMPOSER_EXERCISE_DOSE_NOT_ACTIONABLE_%',v_id;
      end if;
      -- Numeric loads only from confirmed engine prescriptions (never inferred).
      if jsonb_typeof(v_solver->'load_kg')='number' then
        v_pres:=v_pres||jsonb_build_object('load_kg',v_solver->'load_kg',
          'load_scope',v_solver->'load_scope');
      end if;
      end if; -- canonical WOD prescriptions bypass the legacy scalar formatter
      v_exercise_instance_id:=gen_random_uuid();
      insert into public.workout_session_exercises (
        id,session_id,exercise_id,exercise_name,block_key,position,status,
        prescription,prescription_json,expected_outcome_json,
        expected_rpe_min,expected_rpe_max,solver_decision_json,selection_provenance,user_execution_status
      ) values (
        v_exercise_instance_id,v_session_id,v_id,coalesce(v_ex.display_name,v_ex.name),
        v_block_key,v_item_idx,'pending',v_pres->>'text',v_pres,v_pres,
        nullif(v_pres->>'target_rpe_min','')::numeric,
        nullif(v_pres->>'target_rpe_max','')::numeric,
        jsonb_build_object('source','w11_composer_day_j_v1','selection_provenance','USER_COMPOSER',
          'solver_source',v_solver->>'solver_version','original_block_type',v_type),
        'USER_SELECTED','pending'
      );
      v_ejson:=jsonb_build_object('id',v_id,'exercise_id',v_id,
        'session_exercise_id',v_exercise_instance_id,
        'name',coalesce(v_ex.display_name,v_ex.name),
        'family',v_ex.exercise_family,'region',v_ex.body_region,
        'pattern',v_ex.movement_pattern,'tracking_modes',to_jsonb(v_ex.tracking_modes),
        'prescription',v_pres,'prescription_json',v_pres);
      v_out_exercises:=v_out_exercises||jsonb_build_array(v_ejson);
    end loop;
    if v_type='WOD' and v_wod_plan is null and (
       (v_mechanic='AMRAP' and v_estimated_round_seconds>v_minutes*60*0.85)
       or (v_mechanic in ('FOR_TIME','CIRCUIT')
         and (v_estimated_round_seconds*v_rounds
            + greatest(0,v_rounds-1)*coalesce(v_params->>'rest_seconds','0')::integer)>v_minutes*60*0.85)
       ) then
      raise exception 'COMPOSER_DENSITY_EXCEEDS_BUDGET';
    end if;
    if v_type='WOD' then
      v_wod_mechanic:=v_mechanic;
      v_wod_params:=v_params;
    end if;
    v_out_blocks:=v_out_blocks||jsonb_build_array(jsonb_build_object(
      'block_key',v_block_key,'block_name',coalesce(v_b->>'label',initcap(v_type)),
      'module_code',v_type,'duration_minutes',v_wod_minutes,
      'mechanic',case when v_type='WOD' then v_mechanic when v_type='STRENGTH' then 'SETS_REPS'
        when v_type='TABATA' then 'TABATA' when v_type='WARMUP' then 'WARMUP' else 'SKILL' end,
      'mechanic_json',jsonb_build_object(
        'mechanic_key',case when v_type='WOD' then v_mechanic when v_type='STRENGTH' then 'SETS_REPS'
        when v_type='TABATA' then 'TABATA' when v_type='WARMUP' then 'WARMUP' else 'SKILL' end,
        'variant_key',case when v_type='WOD' and v_shared_wod then v_draft#>>'{mechanic,variant_key}' else null end,
        'parameters',v_params,'source','W11_COMPOSER_DAY_J'),
      'exercises',v_out_exercises,'user_editable',true,'manual_selection',true,
      'block_order',v_block_idx
    )||case when v_skill_plan is not null then jsonb_build_object(
      'skill_contract',v_skill_plan->'skill_contract','curriculum',v_skill_plan->'curriculum',
      'skill_path',v_skill_plan->'skill_path','time',v_skill_plan->'time') else '{}'::jsonb end);
  end loop;

  update public.workout_sessions
    set generated_workout=jsonb_build_object('version','w11-composer-player-v1',
      'meta',jsonb_build_object('source','w11_composer','plan_item_id',v_item.id,'environment_code',v_env,
        'focus',v_focus,'target_region',v_region,'total_duration_minutes',v_duration,
        'day_j_dose_finalized',true,'original_selection_preserved',true),
      'blocks',v_out_blocks),
      mechanic_json=case when v_wod_mechanic is null then '{}'::jsonb else
        jsonb_build_object('mechanic_key',v_wod_mechanic,
          'variant_key',case when v_shared_wod then v_draft#>>'{mechanic,variant_key}' else null end,
          'parameters',v_wod_params,'source','W11_COMPOSER_DAY_J') end,
      updated_at=now()
    where id=v_session_id;
  update public.user_training_plan_items
    set session_id=v_session_id,status='claimed',claimed_at=coalesce(claimed_at,now()),
      updated_at=now()
    where id=v_item.id;
  return jsonb_build_object('status','READY','session_id',v_session_id,
    'plan_item_id',v_item.id,'idempotent',false,
    'block_count',jsonb_array_length(v_out_blocks),
    'exercise_count',cardinality(v_ids),
    'mechanic',v_wod_mechanic,
    'duration_minutes',v_duration,'planned_block_minutes',v_total_minutes,
    'source','W11_COMPOSER_DAY_J_V1');
end;
$function$
;
