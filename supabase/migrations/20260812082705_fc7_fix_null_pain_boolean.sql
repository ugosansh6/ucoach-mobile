do $$
declare
  v_def text;
begin
  select pg_get_functiondef(p.oid)
  into v_def
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname='complete_workout_session_v1_pre_block_filter'
    and pg_get_function_identity_arguments(p.oid)='p_session_id uuid, p_global_rpe integer, p_post_workout_feeling integer, p_notes text, p_exercises jsonb, p_protocol_outcome jsonb';

  if v_def is null then raise exception 'completion base function not found'; end if;

  v_def:=replace(
    v_def,
    'v_pain:=(v_reason=''PAIN_DISCOMFORT'');',
    'v_pain:=coalesce(v_reason=''PAIN_DISCOMFORT'',false);'
  );

  execute v_def;
end $$;;
