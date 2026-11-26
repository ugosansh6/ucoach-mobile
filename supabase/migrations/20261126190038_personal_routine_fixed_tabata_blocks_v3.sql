-- Fixed Tabata blocks, with explicit exercise-to-block assignment.
-- Preserve old configurations and checkpoints; no user rows are rewritten.
create function public.routine_configuration_valid_v3(p_mechanic text,p_parameters jsonb,p_exercises jsonb,p_minutes integer)
returns boolean language plpgsql immutable security invoker set search_path=pg_catalog,public as $$
declare blocks integer; b integer; e jsonb; cleaned jsonb:='[]'::jsonb; counts integer[]:=array[0,0,0]; max_blocks integer;
begin
 if p_minutes is null or p_minutes not between 1 and 30 then return false; end if;
 if p_mechanic='TABATA' and p_parameters?'blocks' then
   if jsonb_typeof(p_parameters) is distinct from 'object' or jsonb_typeof(p_exercises) is distinct from 'array' or
      jsonb_typeof(p_parameters->'blocks') is distinct from 'number' or (p_parameters->>'blocks') !~ '^[123]$' or
      p_parameters->'work_seconds' is distinct from '20'::jsonb or p_parameters->'rest_seconds' is distinct from '10'::jsonb or
      (p_parameters-array['blocks','work_seconds','rest_seconds'])<>'{}'::jsonb then return false; end if;
   blocks:=(p_parameters->>'blocks')::integer;
   max_blocks:=case when p_minutes>=14 then 3 when p_minutes>=10 then 2 when p_minutes>=4 then 1 else 0 end;
   if blocks>max_blocks or jsonb_array_length(p_exercises) not between blocks and blocks*8 then return false; end if;
   for e in select value from jsonb_array_elements(p_exercises) loop
     if jsonb_typeof(e) is distinct from 'object' or jsonb_typeof(e->'tabata_block') is distinct from 'number' or (e->>'tabata_block') !~ '^[123]$' then return false; end if;
     b:=(e->>'tabata_block')::integer;
     if b>blocks then return false; end if;
     counts[b]:=counts[b]+1;
     cleaned:=cleaned||jsonb_build_array(e-'tabata_block');
   end loop;
   for b in 1..blocks loop if counts[b] not between 1 and 8 then return false; end if; end loop;
   -- Reuse the existing exercise validation; the actual duration is blocks*240, not exercise count.
   return public.routine_configuration_valid_v2('TABATA','{"rounds":1,"work_seconds":20,"rest_seconds":10}',cleaned,30);
 end if;
 -- Preserve the original Tabata contract for legacy rows; other timed formats
 -- may exceed the indicative target by at most 2 min, never the overall 30 min.
 return public.routine_configuration_valid_v2(p_mechanic,p_parameters,p_exercises,
   case when p_mechanic='TABATA' then p_minutes else least(30,p_minutes+2) end);
end;
$$;
revoke all on function public.routine_configuration_valid_v3(text,jsonb,jsonb,integer) from public,anon;
grant execute on function public.routine_configuration_valid_v3(text,jsonb,jsonb,integer) to authenticated,service_role;
alter table public.user_routines add constraint user_routines_configuration_v3_check check(public.routine_configuration_valid_v3(mechanic,parameters,exercises,planned_minutes));
alter table public.user_routines drop constraint user_routines_configuration_v2_check;
