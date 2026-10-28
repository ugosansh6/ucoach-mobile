-- DEV only. Set ugerod.qa_user_id to an existing QA profile first.
-- Full generation, no persistence; equipment, duration, region and WOD gates.
begin;
set local statement_timeout='120s';
do $test$
declare uid uuid:=nullif(current_setting('ugerod.qa_user_id',true),'')::uuid; rec record; p jsonb; q jsonb; results jsonb:='[]'; started timestamptz;
begin
if uid is null then raise exception 'Set ugerod.qa_user_id first'; end if;
perform set_config('request.jwt.claim.sub',uid::text,true);
perform set_config('ugerod.session_anchor_date',current_date::text,true);
for rec in select * from (values ('HOME',30,'normal','[]'::jsonb),('HOME',45,'normal','[{"equipment_id":"E05","inventory_mode":"non_load","quantity":1}]'::jsonb),('BOX',45,'high','[{"equipment_id":"E05","inventory_mode":"non_load","quantity":1}]'::jsonb)) x(env,minutes,readiness,inventory) loop
perform set_config('ugerod.session_environment',rec.env,true);started:=clock_timestamp();
p:=public.c4_plan_full_session_v2(uid,'General Fitness',rec.minutes,rec.readiness,'Full Body','MAINTAIN','{}',rec.inventory,3,'Intermédiaire',8,'c4-final-default');
q:=public.qa_c4_plan_contract_v1(p,rec.minutes,rec.inventory);
if p->>'status'<>'READY' or not coalesce((q->>'pass')::boolean,false) or not coalesce((p#>>'{selected_candidate,c4_quality_gate,pass}')::boolean,false) then raise exception 'Matrix failed % / %: status %, qa %, gate %',rec.env,rec.minutes,p->>'status',q,p#>'{selected_candidate,c4_quality_gate}';end if;
if (public.c4_full_body_exposure_v1(p->'blocks')->>'missing_count')::int<>0 then raise exception 'Matrix omitted region % / %: %',rec.env,rec.minutes,public.c4_full_body_exposure_v1(p->'blocks');end if;
results:=results||jsonb_build_array(jsonb_build_object('environment',rec.env,'minutes',rec.minutes,'readiness',rec.readiness,'elapsed_ms',round(extract(epoch from clock_timestamp()-started)*1000),'qa',q,'balance',p#>'{architecture,full_body_balance}','blocks',(select jsonb_agg(jsonb_build_object('key',b->>'block_key','names',(select jsonb_agg(e->>'name') from jsonb_array_elements(b->'exercises') e))) from jsonb_array_elements(p->'blocks') b)));
end loop;perform set_config('ugerod.qa_balance_results',results::text,true);
end;$test$;
select current_setting('ugerod.qa_balance_results')::jsonb results;
rollback;
