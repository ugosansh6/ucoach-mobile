-- Transactional QA with two existing accounts; no changes persisted.
begin;
do $$ declare a uuid; b uuid; r uuid; n int; begin
 select id into a from auth.users order by id limit 1;
 select id into b from auth.users where id<>a order by id limit 1;
 if b is null then raise exception 'need two existing account IDs for rollback RLS QA'; end if;
 perform set_config('request.jwt.claim.sub',a::text,true);
 perform set_config('role','authenticated',true);
 insert into public.user_routines(name,category,planned_minutes,recurrence_days,exercises) values ('QA only','PHYSIO',30,array[1,3]::smallint[],'[{"name":"Kiné libre","exercise_id":null,"sets":3,"reps":15},{"name":"Hollow Hold","exercise_id":"EX087","sets":2,"reps":8}]') returning id into r;
 begin insert into public.user_routines(name,category,planned_minutes,exercises) values('invalid','CORE',31,'[{"name":"Test","exercise_id":null,"sets":1,"reps":1}]'); raise exception 'duration accepted'; exception when check_violation then null; end;
 begin update public.user_routines set exercises='[{"name":"bad","exercise_id":null,"sets":0,"reps":2}]' where id=r; raise exception 'zero sets accepted'; exception when check_violation then null; end;
 insert into public.user_routine_realizations(routine_id,local_date) values(r,date '2026-11-26') on conflict do nothing;
 insert into public.user_routine_realizations(routine_id,local_date) values(r,date '2026-11-26') on conflict do nothing;
 select count(*) into n from public.user_routine_realizations where routine_id=r; if n<>1 then raise exception 'duplicate completion'; end if;
 perform set_config('request.jwt.claim.sub',b::text,true);
 if exists(select 1 from public.user_routines where id=r) or exists(select 1 from public.user_routine_realizations where routine_id=r) then raise exception 'RLS leak'; end if;
 begin insert into public.user_routine_realizations(routine_id,local_date) values(r,date '2026-11-26'); raise exception 'cross-account insert accepted'; exception when insufficient_privilege or foreign_key_violation then null; end;
 perform set_config('role','postgres',true);
 perform set_config('ugerod.routine_qa','PASS',true);
end $$;
select current_setting('ugerod.routine_qa') as result;
rollback;
