-- Normalize readiness through the existing authority and publish exact timer aliases.
-- Never change existing interval counts, work/recovery dose or reserved user duration.
DO $patch$
declare d text; old text;
begin
 d:=pg_get_functiondef('public.week_composer_outdoor_cardio_v1(uuid,jsonb)'::regprocedure);
 d:=replace(d,'coalesce(p_context->>''readiness'',''normal'')','public.normalize_session_readiness(coalesce(p_context->>''readiness'',''normal''))');
 old:=' b:=compiled;';
 if position(old in d)=0 then raise exception 'Outdoor adapter changed'; end if;
 d:=replace(d,old,$new$
 b:=public.normalize_user_builder_outdoor_running_workout_v1(jsonb_build_object('blocks',jsonb_build_array(compiled)))#>'{blocks,0}';
 b:=b||jsonb_build_object('reserved_duration_minutes',minutes,
   'time',jsonb_build_object('budget_minutes',minutes,'prescribed_seconds',compiled#>'{running_protocol,predicted_elapsed_seconds}',
     'duration_semantic','fixed_protocol','source','outdoor-running-protocol-v1'));
$new$);
 old:=' pres:=b#>''{exercises,0,prescription}'';';
 if position(old in d)=0 then raise exception 'Outdoor prescription contract changed'; end if;
 d:=replace(d,old,$new$
 pres:=b#>'{exercises,0,prescription}';
 pres:=pres||jsonb_build_object('block_parameters',b#>'{mechanic_json,parameters}');
$new$);
 old:='''text'',coalesce(family#>>''{family,label_fr}'',family->>''family_code''))';
 if position(old in d)=0 then raise exception 'Outdoor dose text contract changed'; end if;
 d:=replace(d,old,$new$'text',case when b->>'mechanic'='RUN_CONTINUOUS' then 'Course continue · '||(b->>'duration_minutes')||' min'
   else (b#>>'{mechanic_json,parameters,repeats}')||' × '||(b#>>'{mechanic_json,parameters,work_seconds}')||' s effort · '||
     (b#>>'{mechanic_json,parameters,recovery_seconds}')||' s récupération' end)$new$);
 execute d;
 d:=pg_get_functiondef('public.week_composer_prescription_preview_v1(uuid,jsonb,text[])'::regprocedure);
 old:='''source'',cardio_plan->>''source''';
 if position(old in d)=0 then raise exception 'Cardio preview changed'; end if;
 d:=replace(d,old,'''source'',cardio_plan->>''source'',''time'',cardio_plan#>''{block,time}''');
 execute d;
end $patch$;
NOTIFY pgrst,'reload schema';
