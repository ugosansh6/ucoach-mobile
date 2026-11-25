create or replace function public.c4_mark_swapped_instance_adapted()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_action text:=coalesce(new.solver_decision_json->>'action','');
  v_target text;
begin
  if v_action like 'SWAP_INSTANCE:%' then
    v_target:=split_part(v_action,':',2);
    if new.id::text=v_target then
      new.user_execution_status:='adapted';
      new.execution_reason_code:=null;
      new.solver_decision_json:=coalesce(new.solver_decision_json,'{}'::jsonb)||jsonb_build_object(
        'swap_auto_marked_adapted',true,
        'swap_target_instance_id',new.id
      );
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_c4_mark_swapped_instance_adapted on public.workout_session_exercises;
create trigger trg_c4_mark_swapped_instance_adapted
before insert or update of solver_decision_json on public.workout_session_exercises
for each row execute function public.c4_mark_swapped_instance_adapted();

revoke all on function public.c4_mark_swapped_instance_adapted() from public,anon,authenticated;
grant execute on function public.c4_mark_swapped_instance_adapted() to service_role;;
