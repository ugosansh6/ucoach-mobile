-- Swap changes the prescription, not the execution outcome.
drop trigger if exists trg_c4_mark_swapped_instance_adapted on public.workout_session_exercises;

comment on function public.c4_mark_swapped_instance_adapted() is
'Legacy helper retained for migration compatibility only. Automatic swap->adapted execution status is disabled by swap_execution_semantics_and_feedback_v1.';

create or replace function public.pi_swap_feedback_v1(
  p_user_id uuid,
  p_anchor_date date default current_date,
  p_period_days integer default 90
) returns jsonb
language sql stable security definer
set search_path to 'public'
as $function$
with cfg as (
  select coalesce(p_anchor_date,current_date) anchor_date,
         greatest(7,least(coalesce(p_period_days,90),3650)) period_days
), x as (
  select
    h.id,
    h.session_id,
    h.session_exercise_id,
    h.from_exercise_id,
    h.to_exercise_id,
    h.direction,
    h.created_at,
    wse.user_execution_status,
    wse.solver_decision_json,
    efrom.display_name as from_display_name,
    efrom.name as from_name,
    eto.display_name as to_display_name,
    eto.name as to_name,
    coalesce(wse.solver_decision_json->>'user_adaptation_reason','equivalent') adaptation_reason
  from public.workout_session_swap_history h
  join public.workout_sessions ws on ws.id=h.session_id and ws.user_id=h.user_id
  join public.workout_session_exercises wse on wse.id=h.session_exercise_id and wse.session_id=h.session_id
  left join public.exercises efrom on efrom.id=h.from_exercise_id
  left join public.exercises eto on eto.id=h.to_exercise_id
  cross join cfg
  where h.user_id=p_user_id
    and ws.status='completed'
    and h.undone_at is null
    and h.created_at::date between cfg.anchor_date-cfg.period_days and cfg.anchor_date
    -- The final session instance carries the exact user reason from the edge handler.
    and wse.exercise_id=h.to_exercise_id
    and coalesce(wse.solver_decision_json->>'swap_origin_exercise_id','')=h.from_exercise_id
    and coalesce(wse.solver_decision_json->>'swap_new_exercise_id','')=h.to_exercise_id
)
select coalesce(jsonb_agg(jsonb_build_object(
  'swap_history_id',id,
  'session_id',session_id,
  'session_exercise_id',session_exercise_id,
  'origin_exercise_id',from_exercise_id,
  'origin_exercise_name',coalesce(nullif(from_display_name,''),from_name),
  'target_exercise_id',to_exercise_id,
  'target_exercise_name',coalesce(nullif(to_display_name,''),to_name),
  'direction',direction,
  'adaptation_reason',adaptation_reason,
  'target_execution_status',user_execution_status,
  'ability_inference',case
    when adaptation_reason='too_easy' then 'ORIGIN_TOO_EASY_TARGET_SELECTED_HARDER'
    when adaptation_reason='too_hard' then 'ORIGIN_TOO_HARD_TARGET_SELECTED_EASIER'
    else 'NONE_CONTEXT_ONLY' end,
  'target_completed',user_execution_status='completed',
  'soft_signal_only',true,
  'created_at',created_at
) order by created_at desc,id desc),'[]'::jsonb)
from x;
$function$;

revoke all on function public.pi_swap_feedback_v1(uuid,date,integer) from public,anon;
grant execute on function public.pi_swap_feedback_v1(uuid,date,integer) to authenticated,service_role;

alter function public.pi_candidate_fit(uuid,text,text) rename to pi_candidate_fit_pre_swap_feedback_v1;
create or replace function public.pi_candidate_fit(
  p_user_id uuid,
  p_exercise_id text,
  p_progression_intent text default null
) returns jsonb
language plpgsql stable security definer
set search_path to 'public'
as $function$
declare
  r jsonb;
  v_feedback jsonb;
  v_item jsonb;
  v_delta numeric:=0;
  v_reason text:=null;
  v_score numeric;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;
  r:=public.pi_candidate_fit_pre_swap_feedback_v1(p_user_id,p_exercise_id,p_progression_intent);
  v_feedback:=public.pi_swap_feedback_v1(p_user_id,current_date,90);

  select value into v_item
  from jsonb_array_elements(coalesce(v_feedback,'[]'::jsonb))
  where value->>'adaptation_reason' in ('too_easy','too_hard')
    and (
      value->>'origin_exercise_id'=p_exercise_id
      or (value->>'target_exercise_id'=p_exercise_id and coalesce((value->>'target_completed')::boolean,false))
    )
  order by (value->>'created_at')::timestamptz desc
  limit 1;

  if v_item is null then return r; end if;

  if v_item->>'adaptation_reason'='too_easy' then
    if v_item->>'origin_exercise_id'=p_exercise_id then
      v_delta:=-8;
      v_reason:='USER_REQUESTED_HARDER_FROM_THIS_EXERCISE';
    elsif v_item->>'target_exercise_id'=p_exercise_id then
      v_delta:=8;
      v_reason:='USER_COMPLETED_HARDER_SWAP_TARGET';
    end if;
  elsif v_item->>'adaptation_reason'='too_hard' then
    if v_item->>'origin_exercise_id'=p_exercise_id then
      v_delta:=-8;
      v_reason:='USER_REQUESTED_EASIER_FROM_THIS_EXERCISE';
    elsif v_item->>'target_exercise_id'=p_exercise_id then
      v_delta:=5;
      v_reason:='USER_COMPLETED_EASIER_SWAP_TARGET';
    end if;
  end if;

  v_score:=greatest(0,least(100,coalesce(nullif(r->>'score','')::numeric,50)+v_delta));
  return r||jsonb_build_object(
    'score',round(v_score,2),
    'swap_feedback_delta',v_delta,
    'swap_feedback_reason',v_reason,
    'swap_feedback',v_item,
    'swap_feedback_is_soft_not_capability_evidence',true
  );
end;
$function$;

revoke all on function public.pi_candidate_fit(uuid,text,text) from public,anon;
grant execute on function public.pi_candidate_fit(uuid,text,text) to authenticated,service_role;

alter function public.pi_coaching_directives(uuid,date,integer) rename to pi_coaching_directives_pre_swap_feedback_v1;
create or replace function public.pi_coaching_directives(
  p_user_id uuid,
  p_anchor_date date default current_date,
  p_period_days integer default 90
) returns jsonb
language plpgsql stable security definer
set search_path to 'public'
as $function$
declare
  r jsonb;
  v_feedback jsonb;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;
  r:=public.pi_coaching_directives_pre_swap_feedback_v1(p_user_id,p_anchor_date,p_period_days);
  v_feedback:=public.pi_swap_feedback_v1(p_user_id,coalesce(p_anchor_date,current_date),p_period_days);
  return r||jsonb_build_object(
    'swap_feedback',v_feedback,
    'swap_feedback_contract',jsonb_build_object(
      'version','swap-feedback-v1',
      'too_easy_is_soft_progression_signal',true,
      'too_hard_is_soft_regression_signal',true,
      'environment_and_equipment_do_not_infer_ability',true,
      'swap_does_not_create_capability_evidence',true,
      'final_exercise_execution_status_is_independent_from_swap',true
    )
  );
end;
$function$;

revoke all on function public.pi_coaching_directives(uuid,date,integer) from public,anon;
grant execute on function public.pi_coaching_directives(uuid,date,integer) to authenticated,service_role;

-- Always expose the localized exercise display name in undo availability.
do $do$
declare v_def text; v_old text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.prokind='f' and p.proname='get_workout_swap_availability'
    and pg_get_function_identity_arguments(p.oid)='p_session_id uuid';
  if v_def is null then raise exception 'get_workout_swap_availability exact signature not found'; end if;
  v_old:='join public.exercises e on e.id=h.from_exercise_id';
  v_new:='join public.exercises e on e.id=h.from_exercise_id';
  if position(v_old in v_def)=0 then raise exception 'undo history exercise join not found'; end if;
  v_def:=replace(v_def,'select h.*,e.name as from_name into v_history','select h.*,coalesce(nullif(e.display_name,'''') ,e.name) as from_name into v_history');
  v_def:=replace(v_def,'select e.name into v_undo_name from public.exercises e where e.id=v_manual_undo_id;','select coalesce(nullif(e.display_name,'''') ,e.name) into v_undo_name from public.exercises e where e.id=v_manual_undo_id;');
  execute v_def;
end $do$;
