-- Set ugerod.qa_user_id to an existing DEV QA profile before running.
begin;
set local statement_timeout='45s';
select set_config('request.jwt.claim.sub',current_setting('ugerod.qa_user_id'),true);
select set_config('ugerod.session_environment','HOME',true);
do $test$
declare uid uuid:=current_setting('ugerod.qa_user_id')::uuid; p jsonb; n int;
begin
p:=public.c4_plan_full_session_v2(uid,'Strength',30,'normal','Full Body','RECALIBRATE','{}','[]',3,'Intermédiaire',20,'c4-final-default');
if p->>'status'<>'READY' or (public.c4_full_body_exposure_v1(p->'blocks')->>'missing_count')::int<>0 then raise exception '30-minute Full Body lacks coverage: %',p->>'status';end if;
if exists(select 1 from jsonb_array_elements(p->'blocks') warm cross join lateral jsonb_array_elements(warm->'exercises') e where warm->>'block_key'='warmup' and coalesce(e->>'exercise_id',e->>'id')=any(public.exercise_expand_functional_exclusions_v1(array(select coalesce(t->>'exercise_id',t->>'id') from jsonb_array_elements(p->'blocks') tab cross join lateral jsonb_array_elements(tab->'exercises') t where tab->>'block_key'='tabata')))) then raise exception 'Warm-up repeats signature family';end if;
p:=public.c4_plan_full_session_v2(uid,'Strength',45,'normal','Back','RECALIBRATE','{}','[]',3,'Intermédiaire',20,'c4-final-default');
if p->>'status'<>'READY' then raise exception 'Back unavailable: %',p->>'status';end if;
select count(*) into n from jsonb_array_elements(p->'blocks') b cross join lateral jsonb_array_elements(b->'exercises') e where b->>'block_key' in('skill','wod') and not exists(select 1 from public.exercise_muscles m where m.exercise_id=coalesce(e->>'exercise_id',e->>'id') and m.muscle_id in('M02','M12','M13') and m.priority='primary');
if n>0 then raise exception 'Back selection includes unrelated training';end if;
end $test$;
rollback;
