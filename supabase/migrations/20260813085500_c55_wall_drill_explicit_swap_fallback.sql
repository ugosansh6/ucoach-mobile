insert into public.exercise_variants(exercise_id,target_exercise_id,variant_type)
values ('EX429','EX401','regression')
on conflict do nothing;

do $migration$
declare
  v_def text;
  v_old text;
  v_new text;
begin
  select pg_get_functiondef('public.c4_non_wod_swap_candidate(uuid,uuid,text[])'::regprocedure)
  into v_def;

  v_old := $old$      (
        v_block_key='warmup'
        and 'Warm-up'=any(e.usable_for)
        and coalesce(e.warmup_eligible,false)
        and coalesce(e.warmup_intensity,99)<=2
        and coalesce(e.fatigue_score,99)<=2
        and coalesce(e.joint_impact,99)<=2
        and coalesce(e.warmup_role,'')=coalesce(target.old_warmup_role,target.prescription_json->>'warmup_role','')
      )$old$;

  v_new := $new$      (
        v_block_key='warmup'
        and (
          (
            'Warm-up'=any(e.usable_for)
            and coalesce(e.warmup_eligible,false)
            and coalesce(e.warmup_intensity,99)<=2
            and coalesce(e.fatigue_score,99)<=2
            and coalesce(e.joint_impact,99)<=2
            and coalesce(e.warmup_role,'')=coalesce(target.old_warmup_role,target.prescription_json->>'warmup_role','')
          )
          or
          (
            exists(
              select 1 from public.exercise_variants ev
              where (ev.exercise_id=target.exercise_id and ev.target_exercise_id=e.id)
                 or (ev.target_exercise_id=target.exercise_id and ev.exercise_id=e.id)
            )
            and e.movement_pattern=target.old_pattern
            and e.exercise_family=target.old_family
            and coalesce(e.fatigue_score,99)<=2
            and coalesce(e.joint_impact,99)<=2
          )
        )
      )$new$;

  if position(v_old in v_def)=0 then
    raise exception 'C55 expected warmup candidate block not found';
  end if;

  v_def := replace(v_def,v_old,v_new);
  v_def := replace(
    v_def,
    $$'warmup_role',v_candidate.warmup_role,$$,
    $$'warmup_role',coalesce(v_candidate.warmup_role,target.old_warmup_role,target.prescription_json->>'warmup_role'),$$
  );
  v_def := replace(
    v_def,
    $$jsonb_build_object('block_key','warmup','warmup_role',v_candidate.warmup_role)$$,
    $$jsonb_build_object('block_key','warmup','warmup_role',coalesce(v_candidate.warmup_role,target.old_warmup_role,target.prescription_json->>'warmup_role'))$$
  );
  v_def := replace(
    v_def,
    $$'warmup_role',case when v_block_key='warmup' then v_candidate.warmup_role else null end$$,
    $$'warmup_role',case when v_block_key='warmup' then coalesce(v_candidate.warmup_role,target.old_warmup_role,target.prescription_json->>'warmup_role') else null end$$
  );

  execute v_def;
end;
$migration$;

revoke all on function public.c4_non_wod_swap_candidate(uuid,uuid,text[]) from public, anon, authenticated;
grant execute on function public.c4_non_wod_swap_candidate(uuid,uuid,text[]) to service_role;
