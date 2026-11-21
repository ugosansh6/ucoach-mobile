begin;
set local request.jwt.claim.sub='00000000-0000-0000-0000-000094246001';
do $qa$
declare env text; minutes int; r jsonb; o jsonb; sums int; pairs int[]; skill int; report jsonb:='[]';
begin
 foreach env in array array['HOME','BOX','GYM','OUTDOOR'] loop
  foreach minutes in array array[20,30,45,60,75,90] loop
   r:=public.week_composer_architectures_v1(minutes,env); pairs:='{}';
   for o in select value from jsonb_array_elements(r->'options') loop
    select sum((b->>'minutes')::int) into sums from jsonb_array_elements(o->'blocks') b;
    if sums+(o->>'transitionReserveMinutes')::int<>minutes then raise exception 'BUDGET_DRIFT'; end if;
    if env in ('HOME','BOX') then
      if exists(select 1 from jsonb_array_elements(o->'blocks') b where b->>'type'='STRENGTH') then raise exception 'STRENGTH_OPTION_STILL_PROPOSED'; end if;
      if minutes<>20 then
        if (select array_agg(b->>'type' order by ord) from jsonb_array_elements(o->'blocks') with ordinality b(b,ord))<>array['WARMUP','TABATA','SKILL','WOD'] then raise exception 'WRONG_HOME_BOX_OPTION'; end if;
        skill:=(o#>>'{blocks,2,minutes}')::int;
        if skill=any(pairs) then raise exception 'DUPLICATE_LAYOUT'; end if;
        pairs:=array_append(pairs,skill);
        if skill<8 or (o#>>'{blocks,3,minutes}')::int<8 then raise exception 'BELOW_EXISTING_FLOOR'; end if;
      elsif r->>'status'<>'DEFAULT_UNAVAILABLE' or (o->>'recommended')::boolean then raise exception 'SHORT_SILENT_SUBSTITUTE'; end if;
    end if;
   end loop;
   if env in ('HOME','BOX') and minutes=60 then
     if (r#>>'{options,0,blocks,2,minutes}')::int<>17 or (r#>>'{options,0,blocks,3,minutes}')::int<>28 then raise exception 'C4_TARGET_FIELD_REGRESSION_%',r; end if;
     if cardinality(pairs)<>3 then raise exception 'MISSING_DURATION_ALTERNATIVES'; end if;
   end if;
   if env in ('GYM','OUTDOOR') and r#>>'{options,0,key}'<>'strength' then raise exception 'OTHER_ENVIRONMENT_CHANGED'; end if;
   report:=report||jsonb_build_array(jsonb_build_object('environment',env,'minutes',minutes,'status','PASS'));
  end loop;
 end loop;
 perform set_config('ugerod.qa_distributions',report::text,true);
end $qa$;
select current_setting('ugerod.qa_distributions')::jsonb result;
rollback;
