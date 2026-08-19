do $$
declare
  v_def text;
  v_old text := $old$v_plan:=jsonb_set(v_plan,'{architecture,pattern_complement_authority}','"SHADOW"'::jsonb,true);$old$;
  v_new text := $new$v_plan:=jsonb_set(v_plan,'{architecture,pattern_complement_authority}','"ACTIVE"'::jsonb,true);$new$;
begin
  select pg_get_functiondef('public.c4_plan_full_session(uuid,text,integer,text,text,text,text[],jsonb,integer,text,integer,text)'::regprocedure) into v_def;
  if position(v_old in v_def)=0 then
    raise exception 'Pattern complement authority metadata anchor not found';
  end if;
  execute replace(v_def,v_old,v_new);
end $$;