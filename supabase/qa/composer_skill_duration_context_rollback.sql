-- Verify the reported 33-minute Skill and distinguish duration from eligibility.
-- Synthetic athlete only; no persisted profile, session or equipment changes.
begin;
do $qa$
declare
 athlete uuid:=gen_random_uuid(); equipment jsonb; minutes int; ex text;
 proposal jsonb; report jsonb:='[]';
begin
 insert into auth.users(id,instance_id,aud,role,email,created_at,updated_at)
 values(athlete,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
   'qa-skill-duration-'||athlete::text||'@example.invalid',now(),now());
 insert into public.profiles(id,weight,experience,subscription_tier)
 values(athlete,80,'intermediate','PREMIUM')
 on conflict(id) do update set weight=80,experience='intermediate',subscription_tier='PREMIUM';
 perform set_config('request.jwt.claim.sub',athlete::text,true);
 select jsonb_agg(name) into equipment from public.equipment_catalog_v2;
 foreach minutes in array array[8,12,17,22,28,33,37,45] loop
  foreach ex in array array['EX472','EX087'] loop
   proposal:=public.week_composer_skill_authority_v1(athlete,jsonb_build_object(
     'session_minutes',60,'block_minutes',minutes,'environment_code','HOME','focus','Strength',
     'equipment_names',equipment,'readiness','normal','propose',true,
     'exercises',jsonb_build_array(jsonb_build_object('id',ex))));
   if ex='EX472' and (proposal->>'reason' is distinct from 'SKILL_CONTEXT_INCOMPATIBLE') then
     raise exception 'ELIGIBILITY_GUARD_CHANGED_%: %',minutes,proposal;
   end if;
   if ex='EX087' and (proposal->>'status' is distinct from 'READY'
       or (proposal->>'minutes')::int<>minutes
       or (proposal#>>'{time,budget_seconds}')::int<>minutes*60
       or (proposal#>>'{time,prescribed_seconds}')::numeric>minutes*60) then
     raise exception 'VALID_DURATION_REJECTED_%: %',minutes,proposal;
   end if;
   report:=report||jsonb_build_array(jsonb_build_object('minutes',minutes,'exercise_id',ex,'status','PASS'));
  end loop;
 end loop;
 perform set_config('ugerod.qa_skill_duration_context',report::text,true);
end $qa$;
select current_setting('ugerod.qa_skill_duration_context')::jsonb result;
rollback;
