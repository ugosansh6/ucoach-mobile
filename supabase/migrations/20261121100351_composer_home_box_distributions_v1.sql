-- Maison/Box proposals vary time within Skill + WOD. No dose is invented.
create or replace function public.week_composer_architectures_v1(p_duration integer,p_environment text)
returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
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
 if not home_box then
   options:=options||jsonb_build_array(
     jsonb_build_object('key','strength','title','Renforcement','blocks',prep||jsonb_build_array(jsonb_build_object('type','STRENGTH','label','Renforcement','minutes',budget))),
     jsonb_build_object('key','conditioning','title','WOD seul','blocks',prep||jsonb_build_array(jsonb_build_object('type','WOD','label','WOD','minutes',budget))),
     jsonb_build_object('key','technique','title','Skill seul','blocks',prep||jsonb_build_array(jsonb_build_object('type','SKILL','label','Skill','minutes',budget))));
 elsif budget<16 then
   -- Short duration: never silently select a substitute for Skill + WOD.
   options:=jsonb_build_array(jsonb_build_object('key','conditioning','title','WOD seul','blocks',prep||jsonb_build_array(jsonb_build_object('type','WOD','label','WOD','minutes',budget))));
 end if;
 select jsonb_agg(o||jsonb_build_object('transitionReserveMinutes',reserve,'estimatedMinutes',p_duration,'source','c4-session-architecture-v2',
   'recommended',case when home_box then o->>'key'='skill' else o->>'key'='strength' end)
   order by case when home_box and o->>'key'='skill' then 0 when not home_box and o->>'key'='strength' then 0 else 1 end,ord)
 into options from jsonb_array_elements(options) with ordinality e(o,ord);
 return jsonb_build_object('status',case when home_box and budget<16 then 'DEFAULT_UNAVAILABLE' else 'READY' end,
   'reason',case when home_box and budget<16 then 'Ce créneau ne permet pas Skill + WOD avec la préparation. Augmente la durée ou choisis explicitement un WOD seul.' else null end,'options',options);
end $$;
revoke all on function public.week_composer_architectures_v1(integer,text) from public,anon;
grant execute on function public.week_composer_architectures_v1(integer,text) to authenticated,service_role;
