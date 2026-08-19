do $$
declare v_def text;
begin
  select pg_get_functiondef('public.c4_apply_pattern_complement_plan_v1(uuid,jsonb,jsonb,date,text,integer,text,text,text,text[],jsonb,integer,text,integer,text)'::regprocedure) into v_def;
  if position('v_current_patterns text[]' in v_def)=0 then
    v_def:=replace(v_def,$a$  v_current_ids text[]:='{}'::text[];$a$,$b$  v_current_ids text[]:='{}'::text[];
  v_current_patterns text[]:='{}'::text[];$b$);
    v_def:=replace(v_def,$a$  select coalesce(array_agg(e->>'exercise_id' order by ord),'{}'::text[]) into v_current_ids
  from jsonb_array_elements(coalesce(v_current->'exercises','[]'::jsonb)) with ordinality x(e,ord);$a$,$b$  select coalesce(array_agg(e->>'exercise_id' order by ord),'{}'::text[]),
         coalesce(array_agg(e->>'pattern' order by ord),'{}'::text[])
  into v_current_ids,v_current_patterns
  from jsonb_array_elements(coalesce(v_current->'exercises','[]'::jsonb)) with ordinality x(e,ord);$b$);
    v_def:=replace(v_def,$a$order by case when cp.movement_pattern=any((select coalesce(array_agg(e->>'pattern'),'{}'::text[]) from jsonb_array_elements(coalesce(v_wod_block->'exercises','[]'::jsonb)) e)) then 1 else 0 end,$a$,$b$order by case when cp.movement_pattern=any(v_current_patterns) then 1 else 0 end,$b$);
    execute v_def;
  end if;
end $$;
