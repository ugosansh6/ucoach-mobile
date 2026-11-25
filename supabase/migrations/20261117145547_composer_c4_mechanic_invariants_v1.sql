-- #32 MEC-CONTRACT: bring W11 Composer option eligibility in line with
-- the pre-existing C4 composition contract; do not change catalog or Today.
-- The RPC preserves its signature, AUTH check, SECURITY DEFINER and ACL.
DO $baseline$
BEGIN
  IF md5(pg_get_functiondef('public.week_composer_mechanic_recommendations_v1(uuid,text,integer,text[],text)'::regprocedure))
    <> 'fb13c37838d3b23e800ee0958dbaa081' THEN
    RAISE EXCEPTION 'MEC-CONTRACT baseline moved; inspect before migration';
  END IF;
END $baseline$;

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
 v_unavailable jsonb;
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
    -- Composer WODs >= 40 min: prefer steady circuits with recovery instead
    -- of scoring a 78-minute all-out AMRAP like a 12-minute sprint.
    -- Every valid mechanic remains selectable by an athlete.
    + case when p_wod_minutes>=40 then
        case m.mechanic_key
          when 'CIRCUIT' then 44
          when 'EMOM' then 28
          when 'AMRAP' then -40
          when 'FOR_TIME' then -38
          when 'HIIT' then -35
          else 0 end
      else 0 end
    as score
   from public.workout_mechanics m
   cross join lateral (select public.c4_mechanic_composition_contract(m.mechanic_key) as rules) contract
   where m.active=true and m.manual_free_eligible=true and m.mechanic_kind='core'
     and m.mechanic_key in ('AMRAP','EMOM','FOR_TIME','CIRCUIT','HIIT')
     and coalesce((contract.rules->>'found')::boolean,false)
     and v_count between coalesce((contract.rules->>'min_exercises')::integer,999)
       and coalesce((contract.rules->>'max_exercises')::integer,0)
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

 select coalesce(jsonb_agg(jsonb_build_object(
  'key',m.mechanic_key,
  'title',case m.mechanic_key when 'FOR_TIME' then 'For Time' when 'HIIT' then 'Intervalles HIIT' when 'CIRCUIT' then 'Circuit' else m.mechanic_key end,
  'available',false,
  'reason',case
    when not coalesce((contract.rules->>'found')::boolean,false) then 'Contrat de composition indisponible.'
    when v_count < coalesce((contract.rules->>'min_exercises')::integer,999)
      then 'Ajoute des mouvements : '||(contract.rules->>'min_exercises')||' minimum pour '||m.mechanic_key||'.'
    when v_count > coalesce((contract.rules->>'max_exercises')::integer,0)
      then 'Trop de mouvements : '||(contract.rules->>'max_exercises')||' maximum pour '||m.mechanic_key||'.'
    when m.mechanic_key='EMOM' and p_wod_minutes<v_count then 'Trop de mouvements pour une minute par station.'
    when m.mechanic_key='HIIT' and v_max_complexity>3 then 'Mouvements trop techniques pour ces intervalles.'
    when m.mechanic_key='HIIT' and p_wod_minutes<v_count*2 then 'Durée insuffisante pour deux passages par station.'
    when m.mechanic_key='FOR_TIME' and p_wod_minutes<8 then 'Il faut au moins 8 minutes pour ce format.'
    when m.mechanic_key='CIRCUIT' and p_wod_minutes<6 then 'Il faut au moins 6 minutes pour ce circuit.'
    else 'Non compatible avec cette sélection.' end
 ) order by m.mechanic_key),'[]'::jsonb) into v_unavailable
 from public.workout_mechanics m
 cross join lateral (select public.c4_mechanic_composition_contract(m.mechanic_key) as rules) contract
 where m.active and m.manual_free_eligible and m.mechanic_kind='core'
 and m.mechanic_key in ('AMRAP','EMOM','FOR_TIME','CIRCUIT','HIIT')
 and not (coalesce((contract.rules->>'found')::boolean,false)
  and v_count between coalesce((contract.rules->>'min_exercises')::integer,999)
    and coalesce((contract.rules->>'max_exercises')::integer,0)
  and (m.mechanic_key<>'EMOM' or p_wod_minutes>=v_count)
  and (m.mechanic_key<>'HIIT' or p_wod_minutes>=v_count*2)
  and (m.mechanic_key<>'FOR_TIME' or p_wod_minutes>=8)
  and (m.mechanic_key<>'CIRCUIT' or p_wod_minutes>=6)
  and (m.mechanic_key<>'HIIT' or v_max_complexity<=3));
 return jsonb_build_object('version','MSW-036-ENGINE-OPTIONS-V1','options',v_options,
   'unavailable',v_unavailable,
   'exercise_count',v_count,'wod_minutes',p_wod_minutes,'max_complexity',v_max_complexity);
end;
$function$;
