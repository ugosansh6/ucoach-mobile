do $$
declare
  v_sig regprocedure := 'public.progression_data_contract_v1(uuid,integer,date)'::regprocedure;
  v_def text;
begin
  select pg_get_functiondef(v_sig) into v_def;
  v_def:=replace(v_def,
    'ws.status = ''completed''',
    'ws.status = ''completed'' and public.session_counts_as_training_v1(ws.id)');
  execute v_def;
end $$;
