-- Layout adapter only: explicit course feasibility / movement target select
-- an existing module. Actual exercise selection and dose remain shared.
CREATE OR REPLACE FUNCTION public.week_composer_outdoor_architectures_v1(p_duration integer,p_context jsonb,p_skill_target text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path TO 'public','pg_temp' AS $fn$
declare proposal jsonb; option jsonb; place jsonb; typ text; label text; blocks jsonb;
begin
 proposal:=public.week_composer_architectures_v1(p_duration,'OUTDOOR'); -- includes authentication
 place:=public.outdoor_place_context_v1(p_context->>'place_code',p_context->>'surface_code');
 if place->>'place_code' is null or place->>'effective_surface_code' is null then raise exception 'OUTDOOR_SURFACE_REQUIRED'; end if;
 typ:=case when nullif(trim(p_skill_target),'') is not null then 'SKILL'
   when not coalesce((p_context->>'running_allowed')::boolean,true) then 'WOD' else 'CARDIO' end;
 label:=case typ when 'SKILL' then 'Gym' when 'WOD' then 'WOD' else 'Cardio extérieur' end;
 option:=proposal#>'{options,0}';
 select jsonb_agg(case when b->>'type'='CARDIO' then b||jsonb_build_object('type',typ,'label',label) else b end order by ord)
   into blocks from jsonb_array_elements(option->'blocks') with ordinality e(b,ord);
 option:=option||jsonb_build_object('key','outdoor_'||lower(typ),'title',label,'blocks',blocks,
   'source','composer-outdoor-existing-modules-v1','outdoor_context',p_context);
 return proposal||jsonb_build_object('options',jsonb_build_array(option));
end $fn$;
REVOKE ALL ON FUNCTION public.week_composer_outdoor_architectures_v1(integer,jsonb,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.week_composer_outdoor_architectures_v1(integer,jsonb,text) TO authenticated,service_role;
NOTIFY pgrst,'reload schema';
