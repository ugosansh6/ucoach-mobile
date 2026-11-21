-- #29: reuse Outdoor producers in Composer. No sports thresholds or old-draft migration.
-- New drafts opt in explicitly; canonical CARDIO / SKILL / WOD identities stay intact.

CREATE OR REPLACE FUNCTION public.week_composer_outdoor_context_v1(p_draft jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path TO 'public','pg_temp' AS $fn$
 SELECT jsonb_build_object('outdoor_engine_version',p_draft->'outdoor_engine_version',
   'outdoor_context',p_draft->'outdoor_context');
$fn$;

CREATE OR REPLACE FUNCTION public.week_composer_outdoor_cardio_v1(p_user_id uuid,p_context jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $fn$
declare
 ctx jsonb:=coalesce(p_context->'outdoor_context','{}'); place jsonb; family jsonb; safety jsonb; challenge jsonb; gate jsonb; compiled jsonb; b jsonb; pres jsonb;
 minutes int:=(p_context->>'block_minutes')::int; duration int:=(p_context->>'session_minutes')::int;
 pain text[]; inventory jsonb; equipment text[]; requested jsonb;
begin
 if auth.uid() is null or auth.uid()<>p_user_id then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
 if p_context->>'outdoor_engine_version' is distinct from 'COMPOSER_OUTDOOR_V1' then
   return jsonb_build_object('status','UNAVAILABLE','reason','OUTDOOR_CONTEXT_REQUIRED'); end if;
 if minutes is null or minutes not between 2 and 90 or duration is null or duration not between 20 and 90 or minutes>duration then raise exception 'INVALID_CARDIO_DURATION'; end if;
 place:=public.outdoor_place_context_v1(ctx->>'place_code',ctx->>'surface_code');
 if place->>'place_code' is null or place->>'effective_surface_code' is null then
   return jsonb_build_object('status','UNAVAILABLE','reason','OUTDOOR_SURFACE_REQUIRED'); end if;
 if not coalesce((ctx->>'running_allowed')::boolean,true) then
   return jsonb_build_object('status','UNAVAILABLE','reason','OUTDOOR_RUNNING_UNAVAILABLE'); end if;
 select coalesce(array_agg(value),'{}') into equipment from jsonb_array_elements_text(coalesce(p_context->'equipment_names','[]'));
 select coalesce(array_agg(value),'{}') into pain from jsonb_array_elements_text(coalesce(p_context->'pain_zones','[]'));
 inventory:=public.resolve_user_equipment_inventory(p_user_id,equipment,'c4-final-default');
 if not public.exercise_environment_eligible_v1('EX313','OUTDOOR')
   or not public.exercise_equipment_compatible('EX313',inventory)
   or not public.exercise_safe_for_zones('EX313',public.normalize_body_zone_ids(pain)) then
   return jsonb_build_object('status','UNAVAILABLE','reason','OUTDOOR_RUNNING_CONTEXT_INCOMPATIBLE'); end if;
 challenge:=public.program_coach_challenge_target_v2(p_user_id,current_date,
   coalesce(p_context->>'focus','Conditioning'),coalesce(p_context->>'readiness','normal'),
   coalesce(p_context->>'progression_intent','MAINTAIN'),'CONDITIONING',minutes,1,pain,'c4-final-default');
 gate:=public.program_coach_challenge_longitudinal_gate_v1(p_user_id,current_date,challenge,'c4-final-default');
 family:=public.outdoor_conditioning_family_decision_v1(ctx->>'place_code',place->>'effective_surface_code',
   coalesce(gate->>'effective_level',challenge->>'effective_level','NORMAL'),
   coalesce((ctx->>'reliable_distance')::boolean,false),true,false);
 if family->>'status' is distinct from 'FAMILY_SELECTED' then return jsonb_build_object('status','UNAVAILABLE','reason','OUTDOOR_RUNNING_PROTOCOL_UNAVAILABLE'); end if;
 safety:=public.outdoor_safety_feasibility_v1(ctx->>'place_code',place->>'effective_surface_code',family->>'family_code',
   coalesce((ctx->>'reliable_distance')::boolean,false),false,false);
 if not coalesce((safety->>'eligible')::boolean,false) then
   return jsonb_build_object('status','UNAVAILABLE','reason','OUTDOOR_RUNNING_PROTOCOL_UNAVAILABLE','details',safety); end if;
 compiled:=public.outdoor_compile_running_block_v1(family,minutes,coalesce((ctx->>'reliable_distance')::boolean,false));
 if compiled->>'status' is distinct from 'READY' then return jsonb_build_object('status','UNAVAILABLE','reason','OUTDOOR_RUNNING_PROTOCOL_UNAVAILABLE','details',compiled); end if;
 b:=compiled->'block';
 pres:=b#>'{exercises,0,prescription}';
 -- Runtime aliases only; protocol parameters and dose remain producer-owned.
 pres:=pres||jsonb_build_object('duration_seconds',pres->'execution_target_duration_seconds',
   'source','OUTDOOR_RUNNING_PROTOCOL_V1','text',coalesce(family#>>'{family,label_fr}',family->>'family_code'));
 b:=jsonb_set(b,'{exercises,0,prescription}',pres)||jsonb_build_object('block_key','cardio','block_name','Cardio extérieur',
   'place_context',place,'safety_feasibility',safety);
 select jsonb_agg(e->>'id' order by ord) into requested from jsonb_array_elements(coalesce(p_context->'exercises','[]')) with ordinality e(e,ord);
 if not coalesce((p_context->>'propose')::boolean,false) and requested is distinct from '["EX313"]'::jsonb then
   return jsonb_build_object('status','RECOMPOSITION_REQUIRED','reason','CARDIO_SELECTION_CHANGED','proposed_block',b); end if;
 return jsonb_build_object('status','READY','source','outdoor-running-protocol-v1','block',b);
end $fn$;
REVOKE ALL ON FUNCTION public.week_composer_outdoor_cardio_v1(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.week_composer_outdoor_cardio_v1(uuid,jsonb) TO authenticated,service_role;

-- The curated outdoor catalogue supplies choices; existing C2/C4 Skill remains the prescription authority.
CREATE OR REPLACE FUNCTION public.week_composer_outdoor_gym_catalog_v1()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $fn$
begin
 if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
 return (select coalesce(jsonb_agg(exercise_id order by exercise_id),'[]') from public.outdoor_street_exercise_catalog_v1
   where active and street_role in ('PULL','PUSH','SUPPORT','PREP','LEGS'));
end $fn$;
REVOKE ALL ON FUNCTION public.week_composer_outdoor_gym_catalog_v1() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.week_composer_outdoor_gym_catalog_v1() TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.week_composer_architectures_v1(p_duration integer, p_environment text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare t jsonb; warm int; reserve int; budget int; skill int; wod int; options jsonb:='[]'; prep jsonb;
 pair record; seen int[]:='{}'; home_box boolean:=p_environment in ('HOME','BOX');
begin
 if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
 if p_environment not in ('HOME','BOX','GYM','OUTDOOR') then raise exception 'INVALID_ENVIRONMENT'; end if;
 t:=public.c4_session_architecture_targets_v2(p_duration,'c4-final-default');
 if t->>'skill_target_minutes' is null or t->>'wod_target_minutes' is null then raise exception 'MISSING_ARCHITECTURE_TARGETS'; end if;
 warm:=(t->>'warmup_minutes')::int;
 reserve:=case when p_duration<=30 then 3 when p_duration<=45 then 4 else 5 end;
 budget:=p_duration-warm-4-reserve;
 prep:=jsonb_build_array(jsonb_build_object('type','WARMUP','label','Échauffement','minutes',warm),jsonb_build_object('type','TABATA','label','Tabata abdos','minutes',4));
 if p_environment='OUTDOOR' then
   return jsonb_build_object('status','READY','options',jsonb_build_array(jsonb_build_object(
     'key','outdoor_cardio','title','Cardio extérieur','recommended',true,
     'blocks',prep||jsonb_build_array(jsonb_build_object('type','CARDIO','label','Cardio extérieur','minutes',budget)),
     'transitionReserveMinutes',reserve,'estimatedMinutes',p_duration,'source','c4-session-architecture-v2')));
 end if;
 if budget>=16 then
   skill:=greatest(8,least(budget-8,round(budget*(t->>'skill_target_minutes')::numeric /
     greatest(1,(t->>'skill_target_minutes')::numeric+(t->>'wod_target_minutes')::numeric))::int));
   wod:=budget-skill;
   -- User-selectable time layouts, not alternative physiological objectives.
   for pair in select * from (values
     (0,skill,'skill','Répartition conseillée'),
     (1,greatest(8,least(budget-8,floor(budget/2.0)::int)),'skill_balanced','Répartition équilibrée'),
     (2,wod,'skill_reversed',case when wod>skill then 'Plus de temps pour le Skill' else 'Plus de temps pour le WOD' end)
   ) layouts(position,skill_minutes,option_key,label) order by position loop
     if pair.skill_minutes=any(seen) or (not home_box and pair.position>0) then continue; end if;
     seen:=array_append(seen,pair.skill_minutes);
     options:=options||jsonb_build_array(jsonb_build_object('key',pair.option_key,'title','Skill + WOD',
       'distribution_label',pair.label,'blocks',prep||jsonb_build_array(
         jsonb_build_object('type','SKILL','label','Skill','minutes',pair.skill_minutes),
         jsonb_build_object('type','WOD','label','WOD','minutes',budget-pair.skill_minutes))));
   end loop;
 end if;
 -- Keep standalone Skill and WOD alongside the duration layouts in every location.
 -- Only the STRENGTH proposal is excluded from HOME/BOX.
 if not home_box then
   options:=options||jsonb_build_array(jsonb_build_object('key','strength','title','Renforcement','blocks',prep||jsonb_build_array(jsonb_build_object('type','STRENGTH','label','Renforcement','minutes',budget))));
 end if;
 options:=options||jsonb_build_array(
   jsonb_build_object('key','conditioning','title','WOD seul','blocks',prep||jsonb_build_array(jsonb_build_object('type','WOD','label','WOD','minutes',budget))),
   jsonb_build_object('key','technique','title','Skill seul','blocks',prep||jsonb_build_array(jsonb_build_object('type','SKILL','label','Skill','minutes',budget))));
 select jsonb_agg(o||jsonb_build_object('transitionReserveMinutes',reserve,'estimatedMinutes',p_duration,'source','c4-session-architecture-v2',
   'recommended',case when home_box then o->>'key'='skill' else o->>'key'='strength' end)
   order by case when home_box and o->>'key'='skill' then 0 when not home_box and o->>'key'='strength' then 0 else 1 end,ord)
 into options from jsonb_array_elements(options) with ordinality e(o,ord);
 return jsonb_build_object('status',case when home_box and budget<16 then 'DEFAULT_UNAVAILABLE' else 'READY' end,
   'reason',case when home_box and budget<16 then 'Ce créneau ne permet pas Skill + WOD avec la préparation. Augmente la durée ou choisis explicitement Skill seul ou WOD seul.' else null end,'options',options);
end $function$

;
DO $patch$
declare d text; old text; changed text;
begin

 d:=pg_get_functiondef('public.week_composer_cardio_authority_v1(uuid,jsonb)'::regprocedure);
 old:=$old$ if p_context->>'environment_code'<>'GYM'$old$; changed:=$new$ if p_context->>'environment_code'='OUTDOOR' then return public.week_composer_outdoor_cardio_v1(p_user_id,p_context); end if;
 if p_context->>'environment_code'<>'GYM'$new$;
 if position(old in d)=0 then raise exception 'Concurrent function contract change: public.week_composer_cardio_authority_v1(uuid,jsonb)'; end if;
 d:=replace(d,old,changed);
 execute d;

 d:=pg_get_functiondef('public.week_composer_skill_context_v1(jsonb,jsonb,text[],text[],text)'::regprocedure);
 old:=$old$select jsonb_build_object('preferences'$old$; changed:=$new$select public.week_composer_outdoor_context_v1(p_draft)||jsonb_build_object('preferences'$new$;
 if position(old in d)=0 then raise exception 'Concurrent function contract change: public.week_composer_skill_context_v1(jsonb,jsonb,text[],text[],text)'; end if;
 d:=replace(d,old,changed);
 execute d;

 d:=pg_get_functiondef('public.week_composer_skill_authority_v1(uuid,jsonb)'::regprocedure);
 old:=$old$ if target is not null then
   if not exists$old$; changed:=$new$ -- An automatic new Outdoor Gym selection comes from the existing street producer.
 if env='OUTDOOR' and p_context->>'outdoor_engine_version'='COMPOSER_OUTDOOR_V1' and target is null
   and propose and coalesce((p_context->>'automatic_selection')::boolean,false) then
   plan:=public.outdoor_build_street_gym_block_v1(p_user_id,pain,inventory,complexity,'Intermédiaire',minutes,intent);
   if plan->>'status' is distinct from 'READY' then
     return jsonb_build_object('status','NEEDS_RECOMPOSITION','reason','OUTDOOR_GYM_UNAVAILABLE','block_type','SKILL'); end if;
   chosen:=plan->'exercises';
 end if;
 if target is not null then
   if not exists$new$;
 if position(old in d)=0 then raise exception 'Concurrent function contract change: public.week_composer_skill_authority_v1(uuid,jsonb)'; end if;
 d:=replace(d,old,changed);
 old:=$old$   ids:=array_append(ids,x.id);$old$; changed:=$new$   ids:=array_append(ids,x.id);
   if env='OUTDOOR' and p_context->>'outdoor_engine_version'='COMPOSER_OUTDOOR_V1' and target is null
     and not exists(select 1 from public.outdoor_street_exercise_catalog_v1 c where c.exercise_id=x.id and c.active
       and c.street_role in ('PULL','PUSH','SUPPORT','PREP','LEGS')) then
     return jsonb_build_object('status','NEEDS_RECOMPOSITION','reason','OUTDOOR_GYM_CATALOG_REQUIRED','block_type','SKILL','exercise_id',x.id); end if;$new$;
 if position(old in d)=0 then raise exception 'Concurrent function contract change: public.week_composer_skill_authority_v1(uuid,jsonb)'; end if;
 d:=replace(d,old,changed);
 execute d;

 d:=pg_get_functiondef('public.week_composer_prescription_preview_v1(uuid,jsonb,text[])'::regprocedure);
 old:=$old$cardio_authority_v1(p_user_id,jsonb_build_object('session_minutes'$old$; changed:=$new$cardio_authority_v1(p_user_id,public.week_composer_outdoor_context_v1(p_draft)||jsonb_build_object('focus',p_draft#>>'{intent,focus}','session_minutes'$new$;
 if position(old in d)=0 then raise exception 'Concurrent function contract change: public.week_composer_prescription_preview_v1(uuid,jsonb,text[])'; end if;
 d:=replace(d,old,changed);
 execute d;

 d:=pg_get_functiondef('public.week_compile_composer_day_j_v1(uuid,uuid,date,integer,text[],text[],text)'::regprocedure);
 old:=$old$cardio_authority_v1(p_user_id,jsonb_build_object('session_minutes'$old$; changed:=$new$cardio_authority_v1(p_user_id,public.week_composer_outdoor_context_v1(v_draft)||jsonb_build_object('focus',v_focus,'session_minutes'$new$;
 if position(old in d)=0 then raise exception 'Concurrent function contract change: public.week_compile_composer_day_j_v1(uuid,uuid,date,integer,text[],text[],text)'; end if;
 d:=replace(d,old,changed);
 execute d;

end $patch$;

-- Day-J explicit terrain is transported without mutating the saved authored draft.
DO $dayj$
declare d text; old text;
begin
 d:=pg_get_functiondef('public.week_compile_composer_day_j_v1(uuid,uuid,date,integer,text[],text[],text)'::regprocedure);
 d:=replace(d,'public.week_compile_composer_day_j_v1(', 'public.week_compile_composer_outdoor_day_j_v1(');
 old:='p_environment_code text)';
 if position(old in d)=0 then raise exception 'Day-J signature changed'; end if;
 d:=replace(d,old,'p_environment_code text, p_outdoor_context jsonb)');
 old:='  v_blocks:=v_draft #> ''{architecture,blocks}'';';
 if position(old in d)=0 then raise exception 'Day-J draft contract changed'; end if;
 d:=replace(d,old,$new$
  if v_draft->>'environment_code'<>'OUTDOOR' or v_draft->>'outdoor_engine_version' is distinct from 'COMPOSER_OUTDOOR_V1'
    or jsonb_typeof(p_outdoor_context) is distinct from 'object' then raise exception 'OUTDOOR_CONTEXT_REQUIRED'; end if;
  if public.outdoor_place_context_v1(p_outdoor_context->>'place_code',p_outdoor_context->>'surface_code')->>'effective_surface_code' is null then
    raise exception 'OUTDOOR_SURFACE_REQUIRED'; end if;
  v_draft:=jsonb_set(v_draft,'{outdoor_context}',p_outdoor_context);
  v_blocks:=v_draft #> '{architecture,blocks}';$new$);
 -- The actual terrain is saved on the session; future-context history is unchanged.
 d:=replace(d,'v_item.planning_context_json #>> ''{w11,future_context,surface_code}''','v_draft #>> ''{outdoor_context,surface_code}''');
 execute d;
end $dayj$;
REVOKE ALL ON FUNCTION public.week_compile_composer_outdoor_day_j_v1(uuid,uuid,date,integer,text[],text[],text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.week_compile_composer_outdoor_day_j_v1(uuid,uuid,date,integer,text[],text[],text,jsonb) TO authenticated,service_role;
NOTIFY pgrst,'reload schema';
