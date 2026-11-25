-- Preserve confirmed work when an explicit, successful adaptation changes only
-- unperformed parts. A normal reload never confirms a changed contract.
do $migration$
declare d text;
begin
 select pg_get_functiondef(oid) into d from pg_proc where proname='composer_player_progress_save_v1';
 if position($needle$'saved_at',now(),'progress',p_progress$needle$ in d)=0 then raise exception 'Concurrent progress writer change'; end if;
 d:=replace(d,$needle$'saved_at',now(),'progress',p_progress$needle$,
   $patch$'saved_at',now(),'progress',p_progress,'contract_blocks',s.generated_workout->'blocks',
     'contract_instances',(select jsonb_agg(jsonb_build_object('id',e.id,'block_key',e.block_key,'prescription',e.prescription_json))
       from public.workout_session_exercises e where e.session_id=p_session_id)$patch$);
 d:=replace(d,$needle$rows:=ex#>'{performanceActualJson,skill_sets}';$needle$,
   $patch$rows:=coalesce(ex#>'{performanceActualJson,skill_sets}',ex#>'{performanceActualJson,gym_sets}');$patch$);
 execute d;
end $migration$;

create or replace function public.composer_player_progress_rebase_v1(p_session_id uuid,p_expected_contract_key text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare s public.workout_sessions%rowtype; stored jsonb; p jsonb; protected text[]; key text; instances jsonb; cursor text; oldblock jsonb; b jsonb; newp jsonb; result jsonb;
begin
 if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
 select * into s from public.workout_sessions where id=p_session_id and user_id=auth.uid() for update;
 if not found then raise exception 'SESSION_NOT_ACCESSIBLE' using errcode='42501'; end if;
 if s.status not in ('generated','in_progress') or s.planning_context_json->>'session_source' is distinct from 'W11_COMPOSER_DAY_J' then raise exception 'SESSION_NOT_ADAPTABLE'; end if;
 key:=public.composer_player_contract_key_v1(s.generated_workout,s.mechanic_json);
 if key is distinct from p_expected_contract_key then return jsonb_build_object('status','REVISION_CONFLICT'); end if;
 stored:=s.planning_context_json->'composer_player_progress_v1'; p:=stored->'progress';
 if stored is null or stored->>'contract_key'=key then return jsonb_build_object('status','UNCHANGED'); end if;
 if jsonb_typeof(stored->'contract_instances') is distinct from 'array' then return jsonb_build_object('status','INCOMPATIBLE_REALIZED_WORK'); end if;
 select coalesce(array_agg(distinct id),'{}'::text[]) into protected from (
   select e->>'sessionExerciseId' id from jsonb_array_elements(coalesce(p->'exercises','[]')) e where e->>'status'<>'pending'
   union select k from jsonb_each(coalesce(p->'strengthDrafts','{}')) d(k,v) where exists(select 1 from jsonb_array_elements(coalesce(v->'sets','[]')) r where r->>'done'='true')
   union select split_part(k,':',1) from jsonb_object_keys(coalesce(p#>'{skillRuntime,results}','{}')) k
   union select split_part(k,':',1) from jsonb_object_keys(coalesce(p#>'{strengthRuntime,results}','{}')) k
   union select p#>>'{playerCursor,sessionExerciseId}' where p#>>'{skillRuntime,runningSince}' is not null or p#>>'{strengthRuntime,runningSince}' is not null
   union select e->>'id' from jsonb_array_elements(stored->'contract_instances') e where
     (e->>'block_key'='wod' and p#>>'{wodRuntime,started}'='true') or
     (e->>'block_key'='tabata' and p#>>'{tabataRuntime,started}'='true') or
     (e->>'block_key'='warm_up' and coalesce((p#>>'{warmupRuntime,round}')::int,1)>1) or
     p#>>array['timedRuntimes',e->>'block_key','started']='true'
 ) ids where id is not null;
 if exists(select 1 from jsonb_array_elements(stored->'contract_instances') old
   left join public.workout_session_exercises current on current.id::text=old->>'id' and current.session_id=p_session_id
   where old->>'id'=any(protected) and (current.id is null or current.prescription_json is distinct from old->'prescription')) then
   return jsonb_build_object('status','INCOMPATIBLE_REALIZED_WORK');
 end if;
 -- A running block must keep its timing and protocol, not just exercise doses.
 for oldblock in select value from jsonb_array_elements(coalesce(stored->'contract_blocks','[]')) loop
   select value into b from jsonb_array_elements(coalesce(s.generated_workout->'blocks','[]')) where value->>'block_key'=oldblock->>'block_key';
   if b is distinct from oldblock and exists(select 1 from jsonb_array_elements(stored->'contract_instances') e
      where e->>'block_key'=oldblock->>'block_key' and e->>'id'=any(protected)) then
     return jsonb_build_object('status','INCOMPATIBLE_REALIZED_WORK');
   end if;
 end loop;
 select jsonb_agg(jsonb_build_object('id',id,'block_key',block_key,'prescription',prescription_json)) into instances from public.workout_session_exercises where session_id=p_session_id;
 newp:=p||jsonb_build_object('exercises',(select coalesce(jsonb_agg(e),'[]') from jsonb_array_elements(p->'exercises') e where exists(select 1 from public.workout_session_exercises w where w.session_id=p_session_id and w.id::text=e->>'sessionExerciseId')));
 newp:=newp||jsonb_build_object('strengthDrafts',(select coalesce(jsonb_object_agg(k,v),'{}') from jsonb_each(coalesce(p->'strengthDrafts','{}')) d(k,v)
   where exists(select 1 from jsonb_array_elements(stored->'contract_instances') old join public.workout_session_exercises w on w.id::text=old->>'id' and w.session_id=p_session_id where old->>'id'=k and old->'prescription'=w.prescription_json)));
 -- Drop only unperformed runtime for explicitly changed blocks.
 for oldblock in select value from jsonb_array_elements(coalesce(stored->'contract_blocks','[]')) loop
   select value into b from jsonb_array_elements(coalesce(s.generated_workout->'blocks','[]')) where value->>'block_key'=oldblock->>'block_key';
   if b is distinct from oldblock then
     if oldblock->>'block_key'='wod' then newp:=jsonb_set(newp,'{wodRuntime}','null'); end if;
     if oldblock->>'block_key'='skill' then newp:=jsonb_set(newp,'{skillRuntime}','null'); end if;
     if oldblock->>'block_key'='strength' then newp:=jsonb_set(newp,'{strengthRuntime}','null'); end if;
     if oldblock->>'block_key'='tabata' then newp:=jsonb_set(newp,'{tabataRuntime}','null'); end if;
     newp:=jsonb_set(newp,'{timedRuntimes}',coalesce(newp->'timedRuntimes','{}')-(oldblock->>'block_key'));
   end if;
 end loop;
 cursor:=newp#>>'{playerCursor,sessionExerciseId}';
 if cursor is not null and not exists(select 1 from public.workout_session_exercises where session_id=p_session_id and id::text=cursor) then newp:=jsonb_set(newp,'{playerCursor}','null'); end if;
 result:=stored||jsonb_build_object('revision',(stored->>'revision')::int+1,'contract_key',key,'contract_instances',instances,'contract_blocks',s.generated_workout->'blocks','progress',newp,'saved_at',now());
 update public.workout_sessions set planning_context_json=jsonb_set(planning_context_json,'{composer_player_progress_v1}',result),updated_at=now() where id=p_session_id;
 return jsonb_build_object('status','REBASED','preserved_instances',to_jsonb(protected));
end $$;
revoke all on function public.composer_player_progress_rebase_v1(uuid,text) from public,anon;
grant execute on function public.composer_player_progress_rebase_v1(uuid,text) to authenticated,service_role;
