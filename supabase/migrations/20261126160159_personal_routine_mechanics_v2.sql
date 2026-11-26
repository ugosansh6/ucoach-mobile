-- Expand routine-only configuration, preserving all existing SETS_REPS definitions.
create function public.routine_configuration_valid_v2(p_mechanic text,p_parameters jsonb,p_exercises jsonb,p_minutes integer)
returns boolean language plpgsql immutable security invoker set search_path=pg_catalog,public as $$
declare e jsonb; n integer; rounds integer:=1; work integer:=0; rest integer:=0; known_seconds bigint:=0; dose integer; sets integer;
begin
 if p_minutes not between 1 and 30 or jsonb_typeof(p_parameters) is distinct from 'object' or jsonb_typeof(p_exercises) is distinct from 'array' then return false; end if;
 n:=jsonb_array_length(p_exercises);
 if n=0 then return false; end if;
 if p_mechanic='SETS_REPS' then
   if p_parameters<>'{}'::jsonb then return false; end if;
 elsif p_mechanic in ('CIRCUIT','HIIT','TABATA') then
   if jsonb_typeof(p_parameters->'rounds') is distinct from 'number' or (p_parameters->>'rounds') !~ '^[1-9][0-9]{0,3}$' then return false; end if;
   rounds:=(p_parameters->>'rounds')::int;
   if p_mechanic='CIRCUIT' then
     if (p_parameters-array['rounds','rest_seconds'])<>'{}'::jsonb then return false; end if;
   else
     if (p_parameters-array['rounds','work_seconds','rest_seconds'])<>'{}'::jsonb or jsonb_typeof(p_parameters->'work_seconds') is distinct from 'number' or (p_parameters->>'work_seconds') !~ '^[1-9][0-9]{0,3}$' then return false; end if;
     work:=(p_parameters->>'work_seconds')::int;
   end if;
   if jsonb_typeof(p_parameters->'rest_seconds') is distinct from 'number' or (p_parameters->>'rest_seconds') !~ '^(0|[1-9][0-9]{0,3})$' then return false; end if;
   rest:=(p_parameters->>'rest_seconds')::int;
   if p_mechanic='TABATA' and (work<>20 or rest<>10) then return false; end if;
 else return false;
 end if;
 for e in select value from jsonb_array_elements(p_exercises) loop
   if jsonb_typeof(e) is distinct from 'object' or jsonb_typeof(e->'name') is distinct from 'string' or length(btrim(e->>'name')) not between 1 and 200
   or not(e?'exercise_id') or coalesce(jsonb_typeof(e->'exercise_id'),'') not in ('null','string')
   or (jsonb_typeof(e->'exercise_id')='string' and length(btrim(e->>'exercise_id')) not between 1 and 100)
   or (e-array['name','exercise_id','sets','reps','duration_seconds'])<>'{}'::jsonb then return false; end if;
   if p_mechanic in ('HIIT','TABATA') then
     if e?'sets' or e?'reps' or e?'duration_seconds' then return false; end if;
   else
     if jsonb_typeof(e->'sets') is distinct from 'number' or (e->>'sets') !~ '^[1-9][0-9]{0,3}$' then return false; end if;
     sets:=(e->>'sets')::int;
     if p_mechanic='CIRCUIT' and sets<>1 then return false; end if;
     if e?'duration_seconds' then
       if e?'reps' or jsonb_typeof(e->'duration_seconds') is distinct from 'number' or (e->>'duration_seconds') !~ '^[1-9][0-9]{0,3}$' then return false; end if;
       dose:=(e->>'duration_seconds')::int;
       known_seconds:=known_seconds+sets::bigint*dose;
     else
       if jsonb_typeof(e->'reps') is distinct from 'number' or (e->>'reps') !~ '^[1-9][0-9]{0,3}$' then return false; end if;
     end if;
   end if;
 end loop;
 if p_mechanic in ('HIIT','TABATA') then known_seconds:=rounds::bigint*n*(work+rest); end if;
 if p_mechanic='CIRCUIT' then known_seconds:=known_seconds*rounds+(rounds-1)::bigint*rest; end if;
 return known_seconds<=p_minutes*60 and known_seconds<=1800;
end;
$$;
revoke all on function public.routine_configuration_valid_v2(text,jsonb,jsonb,integer) from public,anon;
grant execute on function public.routine_configuration_valid_v2(text,jsonb,jsonb,integer) to authenticated,service_role;
alter table public.user_routines add column parameters jsonb not null default '{}'::jsonb;
alter table public.user_routines drop constraint user_routines_mechanic_check,drop constraint user_routines_exercises_check;
alter table public.user_routines add constraint user_routines_configuration_v2_check check(public.routine_configuration_valid_v2(mechanic,parameters,exercises,planned_minutes));
