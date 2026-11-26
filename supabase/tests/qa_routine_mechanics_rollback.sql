-- No lasting test data. Exercise the new contract under actual authenticated RLS.
begin;
do $$ declare a uuid; b uuid; r uuid; n int; begin
 select id into a from auth.users order by id limit 1;
 select id into b from auth.users where id<>a order by id limit 1;
 if b is null then raise exception 'need two existing accounts'; end if;
 perform set_config('request.jwt.claim.sub',a::text,true);
 perform set_config('role','authenticated',true);
 insert into public.user_routines(name,category,mechanic,parameters,planned_minutes,exercises)
 values('QA routine v2','CONDITIONING','TABATA','{"rounds":4,"work_seconds":20,"rest_seconds":10}',4,'[{"name":"Libre","exercise_id":null},{"name":"Catalogue","exercise_id":"EX087"}]') returning id into r;
 begin update public.user_routines set planned_minutes=3 where id=r; raise exception 'duration accepted'; exception when check_violation then null; end;
 begin update public.user_routines set parameters='{"rounds":4,"work_seconds":40,"rest_seconds":10}' where id=r; raise exception 'wrong Tabata accepted'; exception when check_violation then null; end;
 update public.user_routines set mechanic='CIRCUIT',parameters='{"rounds":2,"rest_seconds":15}',planned_minutes=3,exercises='[{"name":"Libre","exercise_id":null,"sets":1,"reps":5},{"name":"Maintien","exercise_id":"EX087","sets":1,"duration_seconds":30}]' where id=r;
 begin update public.user_routines set exercises='[{"name":"Libre","exercise_id":null,"sets":2,"reps":5}]' where id=r; raise exception 'double dosage accepted'; exception when check_violation then null; end;
 update public.user_routines set mechanic='SETS_REPS',parameters='{}',planned_minutes=2,exercises='[{"name":"Maintien","exercise_id":null,"sets":2,"duration_seconds":30},{"name":"Libre","exercise_id":null,"sets":3,"reps":5}]' where id=r;
 insert into public.user_routine_realizations(routine_id,local_date) values(r,date '2026-11-26') on conflict do nothing;
 insert into public.user_routine_realizations(routine_id,local_date) values(r,date '2026-11-26') on conflict do nothing;
 select count(*) into n from public.user_routine_realizations where routine_id=r; if n<>1 then raise exception 'duplicate completion'; end if;
 perform set_config('request.jwt.claim.sub',b::text,true);
 if exists(select 1 from public.user_routines where id=r) or exists(select 1 from public.user_routine_realizations where routine_id=r) then raise exception 'RLS leak'; end if;
 begin insert into public.user_routine_realizations(routine_id,local_date) values(r,date '2026-11-26'); raise exception 'cross-account insert accepted'; exception when insufficient_privilege or foreign_key_violation then null; end;
 perform set_config('role','postgres',true);
 perform set_config('ugerod.routine_qa_v2','PASS',true);
end $$;
select current_setting('ugerod.routine_qa_v2') as result;
rollback;
