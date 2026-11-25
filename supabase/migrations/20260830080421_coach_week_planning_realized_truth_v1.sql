do $$
declare
  v_sig regprocedure;
  v_def text;
begin
  v_sig:='public.d_ensure_week_plan(uuid,date,boolean)'::regprocedure;
  select pg_get_functiondef(v_sig) into v_def;
  v_def:=replace(v_def,
    'ws.status=''completed''',
    'ws.status=''completed'' and public.session_counts_as_training_v1(ws.id)');
  execute v_def;

  v_sig:='public.program_coach_ideal_week_projection_v1(uuid,date,text,text[])'::regprocedure;
  select pg_get_functiondef(v_sig) into v_def;
  v_def:=replace(v_def,
    'ws.status=''completed''',
    'ws.status=''completed'' and public.session_counts_as_training_v1(ws.id)');
  execute v_def;
end $$;
