-- Durable execution cursor/results only, separate from generated prescriptions.
create or replace function public.composer_player_contract_key_v1(p_workout jsonb,p_mechanic jsonb)
returns text language sql immutable set search_path=public,pg_temp as $$
 select md5(jsonb_build_object('blocks',p_workout->'blocks','mechanic',coalesce(p_mechanic,'{}'::jsonb))::text)
$$;

create or replace function public.composer_player_progress_read_v1(p_session_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare s public.workout_sessions%rowtype; stored jsonb; key text;
begin
 if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
 select * into s from public.workout_sessions where id=p_session_id and user_id=auth.uid();
 if not found then raise exception 'SESSION_NOT_ACCESSIBLE' using errcode='42501'; end if;
 if s.planning_context_json->>'session_source' is distinct from 'W11_COMPOSER_DAY_J' then raise exception 'NOT_A_COMPOSER_SESSION'; end if;
 key:=public.composer_player_contract_key_v1(s.generated_workout,s.mechanic_json);
 stored:=s.planning_context_json->'composer_player_progress_v1';
 if stored is not null and stored->>'contract_key' is distinct from key then
   return jsonb_build_object('status','CONTRACT_CHANGED','contract_key',key,'revision',coalesce((stored->>'revision')::int,0),
     'progress',null,'closed',s.status in ('completed','abandoned'));
 end if;
 return jsonb_build_object('status','READY','contract_key',key,'revision',coalesce((stored->>'revision')::int,0),
   'progress',stored->'progress','saved_at',stored->'saved_at','closed',s.status in ('completed','abandoned'));
end $$;

create or replace function public.composer_player_progress_save_v1(p_session_id uuid,p_contract_key text,p_expected_revision integer,p_progress jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare s public.workout_sessions%rowtype; stored jsonb; revision int; key text; ex jsonb; expected jsonb; rows jsonb; n int;
begin
 if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
 select * into s from public.workout_sessions where id=p_session_id and user_id=auth.uid() for update;
 if not found then raise exception 'SESSION_NOT_ACCESSIBLE' using errcode='42501'; end if;
 if s.planning_context_json->>'session_source' is distinct from 'W11_COMPOSER_DAY_J' then raise exception 'NOT_A_COMPOSER_SESSION'; end if;
 if s.status not in ('generated','in_progress') or s.started_at is null then raise exception 'SESSION_NOT_RUNNING'; end if;
 key:=public.composer_player_contract_key_v1(s.generated_workout,s.mechanic_json);
 stored:=s.planning_context_json->'composer_player_progress_v1';
 revision:=coalesce((stored->>'revision')::int,0);
 if key is distinct from p_contract_key then return jsonb_build_object('status','CONTRACT_CHANGED'); end if;
 if p_expected_revision is distinct from revision then return jsonb_build_object('status','REVISION_CONFLICT','revision',revision); end if;
 if jsonb_typeof(p_progress) is distinct from 'object' or p_progress->>'version' is distinct from 'composer-player-progress-v1'
   or p_progress->>'sessionId' is distinct from p_session_id::text or octet_length(p_progress::text)>1048576
   or jsonb_typeof(p_progress->'exercises') is distinct from 'array' then raise exception 'INVALID_PLAYER_PROGRESS'; end if;
 if exists(select 1 from jsonb_array_elements(p_progress->'exercises') x group by x->>'sessionExerciseId' having count(*)>1) then raise exception 'DUPLICATE_PROGRESS_INSTANCE'; end if;
 for ex in select value from jsonb_array_elements(p_progress->'exercises') loop
   select e.prescription_json into expected from public.workout_session_exercises e
     where e.session_id=p_session_id and e.id::text=ex->>'sessionExerciseId';
   if not found then raise exception 'UNKNOWN_PROGRESS_INSTANCE'; end if;
   if ex->>'status' is null or ex->>'userExecutionStatus' is null or ex->>'status' not in ('pending','completed','adapted','not_completed','skipped')
     or ex->>'userExecutionStatus' not in ('pending','completed','adapted','not_completed','skipped') then raise exception 'INVALID_PROGRESS_STATUS'; end if;
   if exists(select 1 from jsonb_each(ex) z where z.key in ('repsCompleted','durationSeconds','distanceMeters','rpe')
     and (jsonb_typeof(z.value) not in ('null','number') or (jsonb_typeof(z.value)='number' and (z.value#>>'{}')::numeric<0))) then
     raise exception 'INVALID_PROGRESS_ACTUAL';
   end if;
   rows:=ex#>'{performanceActualJson,skill_sets}';
   if rows is not null and (jsonb_typeof(rows)<>'array' or jsonb_array_length(rows)>
     coalesce(nullif(expected->>'test_attempts','')::int,nullif(expected->>'sets','')::int,0)*case when expected->>'reps_semantics'='per_side' or expected->>'duration_semantics'='per_side' then 2 else 1 end) then
     raise exception 'PROGRESS_EXCEEDS_PRESCRIBED_SETS';
   end if;
 end loop;
 update public.workout_sessions set planning_context_json=jsonb_set(coalesce(planning_context_json,'{}'::jsonb),'{composer_player_progress_v1}',
   jsonb_build_object('version','composer-player-progress-v1','revision',revision+1,'contract_key',key,
     'saved_at',now(),'progress',p_progress),true),updated_at=now()
 where id=p_session_id and user_id=auth.uid();
 return jsonb_build_object('status','SAVED','revision',revision+1,'contract_key',key);
end $$;

revoke all on function public.composer_player_contract_key_v1(jsonb,jsonb) from public,anon;
revoke all on function public.composer_player_progress_read_v1(uuid) from public,anon;
revoke all on function public.composer_player_progress_save_v1(uuid,text,integer,jsonb) from public,anon;
grant execute on function public.composer_player_contract_key_v1(jsonb,jsonb) to authenticated,service_role;
grant execute on function public.composer_player_progress_read_v1(uuid) to authenticated,service_role;
grant execute on function public.composer_player_progress_save_v1(uuid,text,integer,jsonb) to authenticated,service_role;
