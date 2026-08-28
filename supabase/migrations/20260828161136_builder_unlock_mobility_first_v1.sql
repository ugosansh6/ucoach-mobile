create or replace function public.user_session_builder_auto_preparation_v1(p_draft_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path='public'
as $function$
declare
  v_d public.user_session_drafts%rowtype;
  v_inventory jsonb;
  v_targets jsonb;
  v_module_order text[] := '{}';
  v_include_unlock boolean := false;
  v_include_warmup boolean := false;
  v_unlock_count int := 0;
  v_warmup_count int := 0;
  v_unlock_minutes int := 0;
  v_warmup_minutes int := 0;
  v_target_ids text[] := '{}';
  v_selected_ids text[] := '{}';
  v_blocks jsonb := '[]'::jsonb;
  v_exercises jsonb := '[]'::jsonb;
  v_missing text[] := '{}';
  v_pres jsonb;
  r record;
begin
  select * into v_d from public.user_session_drafts where id=p_draft_id;
  if not found then raise exception 'Session draft not found'; end if;
  if auth.uid() is not null and auth.uid()<>v_d.user_id then raise exception 'Forbidden user'; end if;

  select coalesce(sf.module_order,'{}'::text[]) into v_module_order
  from public.session_format_catalog sf
  where sf.format_code=v_d.format_code;

  v_include_unlock := 'UNLOCK'=any(v_module_order);
  v_include_warmup := 'WARMUP'=any(v_module_order);
  v_targets := public.c4_session_architecture_targets_v2(v_d.duration_minutes,'c4-final-default');
  v_unlock_count := coalesce((v_targets->>'unlock_exercise_count')::int,2);
  v_warmup_count := coalesce((v_targets->>'warmup_exercise_count')::int,2);
  v_unlock_minutes := coalesce((v_targets->>'unlock_minutes')::int,2);
  v_warmup_minutes := coalesce((v_targets->>'warmup_minutes')::int,5);
  v_inventory := public.resolve_user_equipment_inventory(v_d.user_id,v_d.available_equipment,'c4-final-default');

  select coalesce(array_agg(distinct i.exercise_id),'{}'::text[]) into v_target_ids
  from public.user_session_draft_items i
  join public.user_session_draft_blocks b on b.id=i.block_id
  where b.draft_id=p_draft_id and b.module_code not in ('UNLOCK','WARMUP');

  if v_include_unlock then
    v_exercises := '[]'::jsonb;
    for r in
      select e.*
      from public.exercises e
      where coalesce(e.warmup_eligible,false)=true
        and e.warmup_role in ('mobility','activation')
        and not (e.id=any(coalesce(v_target_ids,'{}'::text[])))
        and public.exercise_safe_for_zones(e.id,public.normalize_body_zone_ids(coalesce(v_d.injured_zones,'{}'::text[])))
        and public.exercise_equipment_compatible(e.id,v_inventory)
        and public.exercise_environment_eligible_v1(e.id,v_d.environment_code)
        and coalesce(e.technical_complexity,99)<=3
        and coalesce(e.fatigue_score,99)<=3
        and coalesce(e.joint_impact,99)<=3
      order by
        case e.warmup_role when 'mobility' then 0 else 1 end,
        case when exists(
          select 1 from public.exercise_preparation_links l
          where l.active and l.warmup_exercise_id=e.id and l.target_exercise_id=any(coalesce(v_target_ids,'{}'::text[]))
        ) then 0 else 1 end,
        case when exists(
          select 1 from public.exercises t where t.id=any(coalesce(v_target_ids,'{}'::text[])) and t.body_region=e.body_region
        ) then 0 else 1 end,
        (select count(*) from public.workout_session_exercises wse
          where wse.exercise_id=e.id and wse.block_key in ('unlock','warm_up')
            and wse.session_id in (
              select ws.id from public.workout_sessions ws
              where ws.user_id=v_d.user_id order by ws.created_at desc limit 6
            )) asc,
        coalesce(e.selection_weight,0) desc,e.id
      limit greatest(1,v_unlock_count)
    loop
      v_pres := public.c2_solver_prescription(v_d.user_id,r.id,'{}'::jsonb,'WARMUP',coalesce(v_d.progression_intent,'MAINTAIN'),v_inventory)
        || jsonb_build_object(
          'text',public.user_session_builder_auto_preparation_text_v1(public.c2_solver_prescription(v_d.user_id,r.id,'{}'::jsonb,'WARMUP',coalesce(v_d.progression_intent,'MAINTAIN'),v_inventory)),
          'history_only',true,
          'capability_eligible',false,
          'source','user_session_builder_auto_unlock_v1',
          'auto_generated',true
        );
      v_exercises := v_exercises || jsonb_build_array(jsonb_build_object(
        'exercise_id',r.id,'name',coalesce(r.display_name,r.name),'pattern',r.movement_pattern,
        'warmup_role',r.warmup_role,'prescription',v_pres
      ));
      v_selected_ids := array_append(v_selected_ids,r.id);
    end loop;

    if jsonb_array_length(v_exercises)=0 then
      v_missing := array_append(v_missing,'UNLOCK');
    else
      v_blocks := v_blocks || jsonb_build_array(jsonb_build_object(
        'module_code','UNLOCK','block_key','unlock','title','Unlock','duration_minutes',v_unlock_minutes,
        'execution_style',null,'settings',jsonb_build_object('managed_by','UGEROD'),
        'managed_by','UGEROD','user_editable',false,'exercises',v_exercises
      ));
    end if;
  end if;

  if v_include_warmup then
    v_exercises := '[]'::jsonb;
    for r in
      select e.*
      from public.exercises e
      where coalesce(e.warmup_eligible,false)=true
        and e.warmup_role in ('movement_prep','pulse_raiser')
        and not (e.id=any(coalesce(v_target_ids,'{}'::text[])))
        and not (e.id=any(coalesce(v_selected_ids,'{}'::text[])))
        and public.exercise_safe_for_zones(e.id,public.normalize_body_zone_ids(coalesce(v_d.injured_zones,'{}'::text[])))
        and public.exercise_equipment_compatible(e.id,v_inventory)
        and public.exercise_environment_eligible_v1(e.id,v_d.environment_code)
        and coalesce(e.technical_complexity,99)<=3
        and coalesce(e.fatigue_score,99)<=3
        and coalesce(e.joint_impact,99)<=3
      order by
        case when exists(
          select 1 from public.exercise_preparation_links l
          where l.active and l.warmup_exercise_id=e.id and l.target_exercise_id=any(coalesce(v_target_ids,'{}'::text[]))
        ) then 0 else 1 end,
        case when e.movement_pattern=any(
          coalesce((select array_agg(distinct t.movement_pattern) from public.exercises t where t.id=any(coalesce(v_target_ids,'{}'::text[]))),'{}'::text[])
        ) then 0 else 1 end,
        case e.warmup_role when 'pulse_raiser' then 0 else 1 end,
        (select count(*) from public.workout_session_exercises wse
          where wse.exercise_id=e.id and wse.block_key in ('unlock','warm_up')
            and wse.session_id in (
              select ws.id from public.workout_sessions ws
              where ws.user_id=v_d.user_id order by ws.created_at desc limit 6
            )) asc,
        coalesce(e.selection_weight,0) desc,e.id
      limit greatest(1,v_warmup_count)
    loop
      v_pres := public.c2_solver_prescription(v_d.user_id,r.id,'{}'::jsonb,'WARMUP',coalesce(v_d.progression_intent,'MAINTAIN'),v_inventory)
        || jsonb_build_object(
          'text',public.user_session_builder_auto_preparation_text_v1(public.c2_solver_prescription(v_d.user_id,r.id,'{}'::jsonb,'WARMUP',coalesce(v_d.progression_intent,'MAINTAIN'),v_inventory)),
          'history_only',true,
          'capability_eligible',false,
          'source','user_session_builder_auto_warmup_v1',
          'auto_generated',true
        );
      v_exercises := v_exercises || jsonb_build_array(jsonb_build_object(
        'exercise_id',r.id,'name',coalesce(r.display_name,r.name),'pattern',r.movement_pattern,
        'warmup_role',r.warmup_role,'prescription',v_pres
      ));
      v_selected_ids := array_append(v_selected_ids,r.id);
    end loop;

    if jsonb_array_length(v_exercises)=0 then
      v_missing := array_append(v_missing,'WARMUP');
    else
      v_blocks := v_blocks || jsonb_build_array(jsonb_build_object(
        'module_code','WARMUP','block_key','warm_up','title','Échauffement','duration_minutes',v_warmup_minutes,
        'execution_style',null,'settings',jsonb_build_object('managed_by','UGEROD'),
        'managed_by','UGEROD','user_editable',false,'exercises',v_exercises
      ));
    end if;
  end if;

  return jsonb_build_object(
    'version','user-session-builder-auto-preparation-v1',
    'managed_by','UGEROD',
    'required_modules',to_jsonb(array_remove(array[case when v_include_unlock then 'UNLOCK' end,case when v_include_warmup then 'WARMUP' end],null)),
    'missing_modules',to_jsonb(v_missing),
    'duration_minutes',(case when v_include_unlock then v_unlock_minutes else 0 end)+(case when v_include_warmup then v_warmup_minutes else 0 end),
    'blocks',v_blocks
  );
end;
$function$;
