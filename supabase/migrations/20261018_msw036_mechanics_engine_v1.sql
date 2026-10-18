CREATE OR REPLACE FUNCTION public.week_composer_mechanic_recommendations_v1(p_user_id uuid, p_environment_code text, p_wod_minutes integer, p_exercise_ids text[], p_focus text DEFAULT 'General Fitness'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
 v_count integer;
 v_max_complexity integer;
 v_unknown integer;
 v_options jsonb;
begin
 if p_user_id is null or (auth.uid() is not null and auth.uid()<>p_user_id) then
   raise exception 'Forbidden user' using errcode='42501';
 end if;
 v_count:=cardinality(coalesce(p_exercise_ids,'{}'::text[]));
 if v_count not between 1 and 8 or p_wod_minutes not between 3 and 90 then
   raise exception 'INVALID_COMPOSER_MECHANIC_CONTEXT';
 end if;
 select count(*) filter(where e.id is null),max(coalesce(e.technical_complexity,1))
   into v_unknown,v_max_complexity
 from unnest(p_exercise_ids) k(id) left join public.exercises e on e.id=k.id;
 if v_unknown>0 then raise exception 'UNKNOWN_COMPOSER_EXERCISE'; end if;
 if exists (
   select 1 from unnest(p_exercise_ids) k(id)
   where not public.exercise_environment_eligible_v1(k.id,upper(p_environment_code))
 ) then raise exception 'INCOMPATIBLE_COMPOSER_EXERCISE'; end if;

 with eligible as (
   select m.mechanic_key,
    case m.mechanic_key
      when 'AMRAP' then 84
      when 'EMOM' then 78
      when 'FOR_TIME' then 70
      when 'CIRCUIT' then 65
      when 'HIIT' then 59 else 0 end
    + case when p_wod_minutes<=12 and m.mechanic_key='EMOM' then 12 else 0 end
    + case when p_wod_minutes>=20 and m.mechanic_key='FOR_TIME' then 10 else 0 end
    + case when upper(coalesce(p_focus,''))='CONDITIONING' and m.mechanic_key in ('AMRAP','HIIT') then 7 else 0 end
    + case when upper(coalesce(p_focus,''))='STRENGTH' and m.mechanic_key='CIRCUIT' then 8 else 0 end
    - case when v_max_complexity>=4 and m.mechanic_key in ('AMRAP','FOR_TIME','HIIT') then 30 else 0 end
    as score
   from public.workout_mechanics m
   where m.active=true and m.manual_free_eligible=true and m.mechanic_kind='core'
     and m.mechanic_key in ('AMRAP','EMOM','FOR_TIME','CIRCUIT','HIIT')
     and (m.mechanic_key<>'EMOM' or p_wod_minutes>=v_count)
     and (m.mechanic_key<>'HIIT' or p_wod_minutes>=v_count*2)
     and (m.mechanic_key<>'FOR_TIME' or p_wod_minutes>=8)
     and (m.mechanic_key<>'CIRCUIT' or p_wod_minutes>=6)
     and (m.mechanic_key<>'HIIT' or v_max_complexity<=3)
 ), ranked as (
   select mechanic_key,score,row_number() over(order by score desc,mechanic_key) rank from eligible
 ) select coalesce(jsonb_agg(jsonb_build_object(
     'key',mechanic_key,'title',case mechanic_key when 'FOR_TIME' then 'For Time'
       when 'HIIT' then 'Intervalles HIIT' when 'CIRCUIT' then 'Circuit' else mechanic_key end,
     'description',case mechanic_key
       when 'AMRAP' then 'Tours libres dans le temps prévu.'
       when 'EMOM' then 'Un exercice par minute, avec une marge pour récupérer.'
       when 'FOR_TIME' then 'Tours à terminer avec un cap de temps.'
       when 'CIRCUIT' then 'Tours réguliers et récupération maîtrisée.'
       when 'HIIT' then 'Intervalles de travail et récupération alternés.' end,
     'score',score,'recommended',rank=1,'primary',rank<=3
   ) order by rank),'[]'::jsonb) into v_options from ranked;
 return jsonb_build_object('version','MSW-036-ENGINE-OPTIONS-V1','options',v_options,
   'exercise_count',v_count,'wod_minutes',p_wod_minutes,'max_complexity',v_max_complexity);
end;
$function$;
revoke all on function public.week_composer_mechanic_recommendations_v1(uuid,text,integer,text[],text) from public;
grant execute on function public.week_composer_mechanic_recommendations_v1(uuid,text,integer,text[],text) to authenticated,service_role;
