create or replace function public.program_coach_mechanic_policy_session_shadow_v1(
  p_user_id uuid,
  p_session_id uuid,
  p_session_context jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
stable
set search_path='public'
as $function$
declare
  ws record;
  v_intent text;
  v_stimulus jsonb;
  v_rank jsonb;
  v_current text;
  v_proposed text;
  v_apply boolean:=false;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;
  select id,focus,duration_minutes,readiness,target_region,progression_intent,expected_stimulus_json,mechanic_json,planning_context_json
  into ws from public.workout_sessions where id=p_session_id and user_id=p_user_id;
  if not found then return jsonb_build_object('version','mechanic-policy-session-shadow-v1','mode','SHADOW','status','SESSION_NOT_FOUND'); end if;

  select coalesce((config#>>'{mechanic_policy,apply_enabled}')::boolean,false)
  into v_apply from public.session_engine_policy where policy_key='c4-final-default';

  v_intent:=coalesce(
    nullif(p_session_context#>>'{session_intent_shadow,proposed_session_intent}',''),
    nullif(ws.planning_context_json#>>'{weekly_loop,session_intent_shadow,proposed_session_intent}',''),
    public.program_coach_solver_session_intent_v1(p_user_id,coalesce(ws.focus,'General Fitness'),coalesce(ws.duration_minutes,45),coalesce(ws.readiness,'normal'),ws.progression_intent)->>'proposed_session_intent',
    'CLASSIC'
  );
  v_stimulus:=coalesce(ws.expected_stimulus_json,public.build_session_stimulus_target(
    coalesce(ws.focus,'General Fitness'),coalesce(ws.duration_minutes,45),coalesce(ws.readiness,'normal'),ws.target_region,ws.progression_intent,'c1-default'
  ))||jsonb_build_object('session_intent_shadow',v_intent,'mechanic_policy_shadow_version','mechanic-policy-shadow-v1');
  v_rank:=public.program_coach_mechanic_policy_rank_v1(v_stimulus,ws.progression_intent);
  v_current:=upper(coalesce(ws.mechanic_json->>'mechanic_key',ws.mechanic_json->>'mechanic',''));
  v_proposed:=upper(coalesce(v_rank#>>'{ranked_mechanics,0,mechanic}',''));

  return jsonb_build_object(
    'version','mechanic-policy-session-shadow-v1','mode','SHADOW','status','PROPOSED','session_id',p_session_id,
    'session_intent',v_intent,'current_authoritative_mechanic',nullif(v_current,''),'proposed_top_mechanic',nullif(v_proposed,''),
    'would_differ_from_current',v_current<>v_proposed and v_current<>'' and v_proposed<>'',
    'ranked_mechanics',coalesce(v_rank->'ranked_mechanics','[]'::jsonb),
    'candidate_selection_mode','authoritative_top3_plus_policy_top3_then_c4','apply_enabled',v_apply,
    'authority',jsonb_build_object('shadow_only',true,'may_change_session_decision',false,'may_change_mechanic',false,'c4_remains_authoritative',true)
  );
end;
$function$;

revoke all on function public.program_coach_mechanic_policy_session_shadow_v1(uuid,uuid,jsonb) from public,anon;
grant execute on function public.program_coach_mechanic_policy_session_shadow_v1(uuid,uuid,jsonb) to authenticated,service_role;

do $patch$
declare v_def text; old_block text; new_block text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='d_generate_adaptive_session_v2' limit 1;
  if v_def is null then raise exception 'd_generate_adaptive_session_v2 not found'; end if;

  old_block:=$old$  v_context_opportunity jsonb:='{}'::jsonb;
  v_context_opportunity_error text:=null;$old$;
  new_block:=$new$  v_context_opportunity jsonb:='{}'::jsonb;
  v_context_opportunity_error text:=null;
  v_mechanic_policy_shadow jsonb:='{}'::jsonb;
  v_mechanic_policy_shadow_error text:=null;$new$;
  if strpos(v_def,old_block)=0 then raise exception 'Declaration anchor missing'; end if;
  v_def:=replace(v_def,old_block,new_block);

  old_block:=$old$  v_recalc:=coalesce(v_context->'recalculation','{}'::jsonb);$old$;
  new_block:=$new$  begin
    v_mechanic_policy_shadow:=public.program_coach_mechanic_policy_session_shadow_v1(p_user_id,v_session_id,v_context);
  exception when others then
    v_mechanic_policy_shadow_error:=sqlerrm;
    v_mechanic_policy_shadow:=jsonb_build_object(
      'version','mechanic-policy-session-shadow-v1','mode','SHADOW','status','UNAVAILABLE',
      'authority',jsonb_build_object('shadow_only',true,'may_change_session_decision',false,'may_change_mechanic',false)
    );
  end;

  v_recalc:=coalesce(v_context->'recalculation','{}'::jsonb);$new$;
  if strpos(v_def,old_block)=0 then raise exception 'Recalc anchor missing'; end if;
  v_def:=replace(v_def,old_block,new_block);

  old_block:=$old$        'pattern_budget_shadow',v_pattern_budget,
        'pattern_budget_shadow_error',v_pattern_budget_error,
        'context_opportunity_shadow',v_context_opportunity,
        'context_opportunity_shadow_error',v_context_opportunity_error$old$;
  new_block:=$new$        'pattern_budget_shadow',v_pattern_budget,
        'pattern_budget_shadow_error',v_pattern_budget_error,
        'context_opportunity_shadow',v_context_opportunity,
        'context_opportunity_shadow_error',v_context_opportunity_error,
        'mechanic_policy_shadow',v_mechanic_policy_shadow,
        'mechanic_policy_shadow_error',v_mechanic_policy_shadow_error$new$;
  if strpos(v_def,old_block)=0 then raise exception 'Planning context block missing'; end if;
  v_def:=replace(v_def,old_block,new_block);

  old_block:=$old$    'pattern_budget_shadow',v_pattern_budget,
    'context_opportunity_shadow',v_context_opportunity,
    'meta',$old$;
  new_block:=$new$    'pattern_budget_shadow',v_pattern_budget,
    'context_opportunity_shadow',v_context_opportunity,
    'mechanic_policy_shadow',v_mechanic_policy_shadow,
    'meta',$new$;
  if strpos(v_def,old_block)=0 then raise exception 'Return block missing'; end if;
  v_def:=replace(v_def,old_block,new_block);

  execute v_def;
end;
$patch$;