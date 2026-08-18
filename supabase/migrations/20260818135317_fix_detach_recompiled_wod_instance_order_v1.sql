create or replace function public.c4_detach_recompiled_wod_instance_v1(
  p_user_id uuid,
  p_session_id uuid,
  p_old_instance_id uuid
) returns uuid
language plpgsql
security definer
set search_path='public'
as $$
declare
  r public.workout_session_exercises%rowtype;
  v_new_id uuid;
  v_generated jsonb;
  v_blocks jsonb;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;

  select wse.* into r
  from public.workout_session_exercises wse
  join public.workout_sessions ws on ws.id=wse.session_id and ws.user_id=p_user_id
  where wse.id=p_old_instance_id and wse.session_id=p_session_id and wse.block_key='wod';

  if not found then return null; end if;

  -- La recompilation peut avoir réutilisé l'ID de l'exercice supprimé pour
  -- le mouvement qui a pris sa position. On détache cet ID pour que le front
  -- ne marque pas par erreur ce nouveau mouvement comme "adapté".
  -- Le WOD n'a pas encore démarré : aucun résultat d'exécution n'est perdu.
  delete from public.workout_session_exercises where id=p_old_instance_id;

  insert into public.workout_session_exercises(
    session_id,exercise_id,exercise_name,block_key,position,status,prescription,rounds,reps_completed,weight_kg,rpe,notes,
    created_at,updated_at,duration_seconds,distance_meters,prescription_json,expected_outcome_json,expected_rpe_min,expected_rpe_max,
    capacity_snapshot_json,solver_decision_json,user_execution_status,execution_reason_code
  ) values (
    r.session_id,r.exercise_id,r.exercise_name,r.block_key,r.position,r.status,r.prescription,r.rounds,r.reps_completed,r.weight_kg,r.rpe,r.notes,
    r.created_at,r.updated_at,r.duration_seconds,r.distance_meters,r.prescription_json,r.expected_outcome_json,r.expected_rpe_min,r.expected_rpe_max,
    r.capacity_snapshot_json,r.solver_decision_json,r.user_execution_status,r.execution_reason_code
  ) returning id into v_new_id;

  select generated_workout into v_generated
  from public.workout_sessions
  where id=p_session_id and user_id=p_user_id
  for update;

  select coalesce(jsonb_agg(
    case when b->>'block_key'='wod' and jsonb_typeof(b->'exercises')='array' then
      jsonb_set(b,'{exercises}',coalesce((
        select jsonb_agg(
          case when ex->>'session_exercise_id'=p_old_instance_id::text
            then jsonb_set(ex,'{session_exercise_id}',to_jsonb(v_new_id::text),true)
            else ex end
          order by eord
        )
        from jsonb_array_elements(b->'exercises') with ordinality x(ex,eord)
      ),'[]'::jsonb),true)
    else b end
    order by bord
  ),'[]'::jsonb)
  into v_blocks
  from jsonb_array_elements(coalesce(v_generated->'blocks','[]'::jsonb)) with ordinality z(b,bord);

  update public.workout_sessions
  set generated_workout=jsonb_set(coalesce(v_generated,'{}'::jsonb),'{blocks}',v_blocks,true),updated_at=now()
  where id=p_session_id and user_id=p_user_id;

  return v_new_id;
end;
$$;
