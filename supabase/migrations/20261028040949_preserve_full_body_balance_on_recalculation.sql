-- Exact exercise continuity must preserve the newly generated Full Body balance.
do $guard$
begin
  if md5(pg_get_functiondef('public.c4_preserve_recalculation_continuity_v1(uuid,uuid,uuid)'::regprocedure))
     <> 'da402845a56e93c77fadf45a3e50f277' then
    raise exception 'Recalculation continuity changed: rebase Full Body preservation first';
  end if;
end;
$guard$;
CREATE OR REPLACE FUNCTION public.c4_preserve_recalculation_continuity_v1(p_user_id uuid, p_parent_session_id uuid, p_new_session_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  parent_ws public.workout_sessions%rowtype;
  new_ws public.workout_sessions%rowtype;
  v_names text[];
  v_inventory jsonb;
  old_ex record;
  new_ex record;
  v_preview jsonb;
  v_sub jsonb;
  v_pres jsonb;
  v_alloc int;
  v_wod_preserved int:=0;
  v_tabata_preserved int:=0;
  v_unlock_preserved int:=0;
  v_skill_preserved boolean:=false;
  v_warmup_refresh jsonb;
  v_old_wod_ids text[]:='{}'::text[];
  v_old_tabata_ids text[]:='{}'::text[];
  v_old_unlock_ids text[]:='{}'::text[];
  v_current_blocks jsonb;
  v_projected_blocks jsonb;
  v_region_before jsonb;
  v_region_after jsonb;
  v_balance_guard boolean:=false;
begin
  select * into parent_ws from public.workout_sessions where id=p_parent_session_id and user_id=p_user_id;
  select * into new_ws from public.workout_sessions where id=p_new_session_id and user_id=p_user_id for update;
  if parent_ws.id is null or new_ws.id is null then raise exception 'Continuity session not found'; end if;
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;
  if new_ws.status<>'generated' then
    return jsonb_build_object('status','NOT_APPLIED','reason','NEW_SESSION_NOT_PRESTART');
  end if;

  v_balance_guard:=new_ws.target_region='Full Body'
    and new_ws.generated_workout#>>'{meta,architecture,full_body_balance,mode}'='ACTIVE';

  v_names:=coalesce(new_ws.available_equipment,'{}'::text[]);
  if cardinality(v_names)=0 then v_names:=array['Aucun']; end if;
  v_inventory:=public.resolve_user_equipment_inventory(p_user_id,v_names,'c4-final-default');

  select coalesce(array_agg(exercise_id order by position),'{}'::text[]) into v_old_wod_ids
  from public.workout_session_exercises where session_id=p_parent_session_id and block_key='wod';
  select coalesce(array_agg(exercise_id order by position),'{}'::text[]) into v_old_tabata_ids
  from public.workout_session_exercises where session_id=p_parent_session_id and block_key='tabata';
  select coalesce(array_agg(exercise_id order by position),'{}'::text[]) into v_old_unlock_ids
  from public.workout_session_exercises where session_id=p_parent_session_id and block_key='unlock';

  -- Skill continuity is resolved before session creation by skill-trajectory-memory-v1.
  select exists(
    select 1
    from public.workout_session_exercises p
    join public.workout_session_exercises n on n.session_id=p_new_session_id and n.block_key='skill' and n.exercise_id=p.exercise_id
    where p.session_id=p_parent_session_id and p.block_key='skill'
  ) into v_skill_preserved;


  -- Tabata freshness: keep the newly generated Tabata. A recalculation must not restore
  -- the parent's exact Core pair. Presentation freshness is handled by
  -- c4_tabata_variety_penalty_v2; completed sessions remain the training-evidence source.
  select count(*)::int
  into v_tabata_preserved
  from public.workout_session_exercises p
  join public.workout_session_exercises n
    on n.session_id=p_new_session_id
   and n.block_key='tabata'
   and n.exercise_id=p.exercise_id
  where p.session_id=p_parent_session_id
    and p.block_key='tabata';

  -- Unlock continuity is kept only when the old mobility drill still matches the new region and safety context.
  for old_ex in
    select wse.exercise_id,wse.position,e.*
    from public.workout_session_exercises wse
    join public.exercises e on e.id=wse.exercise_id
    where wse.session_id=p_parent_session_id and wse.block_key='unlock'
    order by wse.position
  loop
    if exists(select 1 from public.workout_session_exercises where session_id=p_new_session_id and block_key='unlock' and exercise_id=old_ex.exercise_id) then
      v_unlock_preserved:=v_unlock_preserved+1;
      continue;
    end if;

    if not ('Warm-up'=any(old_ex.usable_for)
      and coalesce(old_ex.warmup_eligible,false)
      and old_ex.warmup_role='mobility'
      and coalesce(old_ex.warmup_intensity,99)<=2
      and coalesce(old_ex.fatigue_score,99)<=2
      and coalesce(old_ex.joint_impact,99)<=2
      and public.exercise_safe_for_zones(old_ex.exercise_id,public.normalize_body_zone_ids(coalesce(new_ws.injured_zones,'{}'::text[])))
      and public.exercise_equipment_compatible(old_ex.exercise_id,v_inventory)
      and (new_ws.target_region is null or new_ws.target_region='Full Body' or old_ex.body_region in (new_ws.target_region,'Full Body'))
    ) then
      continue;
    end if;

    select id,exercise_id,position,prescription_json into new_ex
    from public.workout_session_exercises
    where session_id=p_new_session_id and block_key='unlock'
      and not (exercise_id=any(v_old_unlock_ids))
    order by position
    limit 1;
    if not found then continue; end if;

    v_alloc:=coalesce(nullif(new_ex.prescription_json->>'allocated_duration_seconds','')::int,60);
    v_pres:=(public.c2_solver_prescription(
      p_user_id,old_ex.exercise_id,coalesce(new_ws.expected_stimulus_json,'{}'::jsonb),'WARMUP',new_ws.progression_intent,v_inventory
    )-'target_rpe_min'-'target_rpe_max'-'target_duration_minutes')||jsonb_build_object(
      'block_role','unlock','unlock_role','mobility','allocated_duration_seconds',v_alloc,
      'fatigue_target','minimal','effort_semantics','easy_mobility_no_rpe_target',
      'preparation_quality_version','preparation-v1.1','recalculation_continuity',true
    );
    v_sub:=jsonb_build_object(
      'exercise_id',old_ex.exercise_id,'name',old_ex.name,'family',old_ex.exercise_family,
      'pattern',old_ex.movement_pattern,'region',old_ex.body_region,'instructions',old_ex.instructions,
      'tips',old_ex.tips,'image_path',old_ex.image_path,'warmup_role','mobility',
      'tracking_modes',coalesce(to_jsonb(old_ex.tracking_modes),'[]'::jsonb),
      'prescription',v_pres,'prescription_json',v_pres,
      'expected_outcome',jsonb_build_object(
        'block_key','unlock','goal','unlock_mobility_without_fatigue','pain_gate',true,'equipment_gate',true,
        'allocated_duration_seconds',v_alloc,'effort_semantics','easy_mobility_no_rpe_target','recalculation_continuity',true
      )
    );
    perform public.c4_apply_system_non_wod_substitute_v1(p_user_id,new_ex.id,v_sub,'RECALC_CONTINUITY_UNLOCK');
    v_unlock_preserved:=v_unlock_preserved+1;
  end loop;

  -- WOD continuity is quality-gated. Each exact old exercise is restored only if the full new WOD remains feasible and coherent.
  for old_ex in
    select exercise_id,position
    from public.workout_session_exercises
    where session_id=p_parent_session_id and block_key='wod'
    order by position
  loop
    if exists(select 1 from public.workout_session_exercises where session_id=p_new_session_id and block_key='wod' and exercise_id=old_ex.exercise_id) then
      v_wod_preserved:=v_wod_preserved+1;
      continue;
    end if;

    for new_ex in
      select id,exercise_id,position
      from public.workout_session_exercises
      where session_id=p_new_session_id and block_key='wod'
        and not (exercise_id=any(v_old_wod_ids))
      order by position
    loop
      v_preview:=public.c4_wod_swap_candidate_v3_base(p_user_id,new_ex.id,'equivalent','{}'::text[],old_ex.exercise_id);
      if coalesce(v_preview->>'status','')='AVAILABLE' then
        if v_balance_guard then
          select generated_workout->'blocks' into v_current_blocks
          from public.workout_sessions where id=p_new_session_id and user_id=p_user_id;
          select jsonb_agg(case when b->>'block_key'='wod' then
            b||jsonb_build_object('exercises',v_preview#>'{candidate,exercises}') else b end order by ord)
            into v_projected_blocks from jsonb_array_elements(v_current_blocks) with ordinality x(b,ord);
          v_region_before:=public.c4_full_body_exposure_v1(v_current_blocks);
          v_region_after:=public.c4_full_body_exposure_v1(v_projected_blocks);
          if (v_region_after->>'missing_count')::integer>(v_region_before->>'missing_count')::integer
             or ((v_region_after->>'missing_count')::integer=(v_region_before->>'missing_count')::integer
                 and (v_region_after->>'imbalance')::numeric>(v_region_before->>'imbalance')::numeric+0.0001) then
            continue;
          end if;
        end if;
        perform public.c4_apply_wod_candidate(
          p_user_id,p_new_session_id,v_preview->'candidate',coalesce(v_preview->'quality_gate','{}'::jsonb),
          'RECALC_CONTINUITY:'||old_ex.exercise_id
        );
        v_wod_preserved:=v_wod_preserved+1;
        exit;
      end if;
    end loop;
  end loop;

  -- WOD changes can alter what must be prepared, therefore the specific warm-up is rebuilt from the final Skill + final WOD.
  v_warmup_refresh:=public.c4_refresh_specific_warmup_session_v1(p_user_id,p_new_session_id);

  if v_balance_guard then
    select generated_workout->'blocks' into v_current_blocks
    from public.workout_sessions where id=p_new_session_id and user_id=p_user_id;
    v_region_after:=public.c4_full_body_exposure_v1(v_current_blocks);
    update public.workout_sessions
    set generated_workout=jsonb_set(generated_workout,'{meta,architecture,full_body_balance}',
          (generated_workout#>'{meta,architecture,full_body_balance}')||jsonb_build_object(
            'generation_after',generated_workout#>'{meta,architecture,full_body_balance,after}',
            'after',v_region_after,'continuity_rechecked',true),true),
        planning_context_json=jsonb_set(planning_context_json,'{architecture,full_body_balance}',
          coalesce(planning_context_json#>'{architecture,full_body_balance}','{}'::jsonb)||jsonb_build_object(
            'after',v_region_after,'continuity_rechecked',true),true),
        updated_at=now()
    where id=p_new_session_id and user_id=p_user_id;
  end if;

  update public.workout_sessions
  set planning_context_json=coalesce(planning_context_json,'{}'::jsonb)||jsonb_build_object(
    'recalculation_continuity',jsonb_build_object(
      'version','recalc-continuity-v1','parent_session_id',p_parent_session_id,
      'unlock_preserved',v_unlock_preserved,'tabata_preserved',v_tabata_preserved,
      'skill_preserved',v_skill_preserved,'wod_preserved',v_wod_preserved,
      'warmup_refreshed_from_final_skill_and_wod',coalesce(v_warmup_refresh->>'status','')='APPLIED',
      'preservation_is_quality_gated',true
    )
  ),updated_at=now()
  where id=p_new_session_id and user_id=p_user_id;

  return jsonb_build_object(
    'status','APPLIED','version','recalc-continuity-v1','parent_session_id',p_parent_session_id,'new_session_id',p_new_session_id,
    'unlock_preserved',v_unlock_preserved,'tabata_preserved',v_tabata_preserved,'skill_preserved',v_skill_preserved,
    'wod_preserved',v_wod_preserved,'warmup_refresh',v_warmup_refresh
  );
end;
$function$;
