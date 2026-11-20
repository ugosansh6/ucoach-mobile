begin;
insert into auth.users(id,instance_id,aud,role,email,created_at,updated_at)
 values('00000000-0000-0000-0000-000094245001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','qa-exercise-catalogue@example.invalid',now(),now());
set local request.jwt.claim.sub='00000000-0000-0000-0000-000094245001';
set local role authenticated;
do $qa$
declare e text; r jsonb; count_visible int;
begin
 select id into e from public.exercises order by id limit 1;
 if e is null then raise exception 'CATALOGUE_NOT_READABLE'; end if;
 r:=public.set_user_exercise_preference_v1(auth.uid(),e,'FAVORI','GLOBAL','{"source":"QA_EXERCISE_LIBRARY"}');
 if r->>'status'<>'SAVED' then raise exception 'FAVORITE_WRITE_FAILED'; end if;
 select count(*) into count_visible from public.user_exercise_preferences where user_id=auth.uid() and exercise_id=e and context_key='GLOBAL' and preference_state='FAVORI';
 if count_visible<>1 then raise exception 'FAVORITE_NOT_READABLE_WITH_RLS'; end if;
 if public.get_user_exercise_preference_evidence_v1(auth.uid(),e)->>'explicit_preference_state'<>'FAVORI' then raise exception 'ENGINE_FAVORITE_DIFFERS'; end if;
 perform public.set_user_exercise_preference_v1(auth.uid(),e,'NEUTRE','GLOBAL','{"source":"QA_EXERCISE_LIBRARY"}');
 if public.get_user_exercise_preference_evidence_v1(auth.uid(),e)->>'explicit_preference_state'<>'NEUTRE' then raise exception 'FAVORITE_NOT_REMOVED'; end if;
 perform set_config('ugerod.qa_catalogue','PASS catalogue/favorites/engine same preference under authenticated RLS',true);
end $qa$;
select current_setting('ugerod.qa_catalogue') as result;
rollback;
