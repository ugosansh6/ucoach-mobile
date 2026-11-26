-- Real adaptive generation after a completed morning session; all synthetic writes rollback.
BEGIN;
SET LOCAL statement_timeout='55s';
DO $qa$
DECLARE u uuid:=gen_random_uuid(); s uuid:=gen_random_uuid(); x uuid:=gen_random_uuid(); r jsonb; c jsonb; equipment text[]:=array['Tapis','Élastiques']; inventory jsonb;
BEGIN
 INSERT INTO auth.users(id,instance_id,aud,role,email,created_at,updated_at)
 VALUES(u,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','qa-generate-day-'||u::text||'@example.invalid',now(),now());
 INSERT INTO public.profiles(id,weight) VALUES(u,80) ON CONFLICT DO NOTHING;
 PERFORM set_config('request.jwt.claim.sub',u::text,true);
 INSERT INTO public.workout_sessions(id,user_id,status,duration_minutes,readiness,focus,target_region,generated_at,generation_local_date,planned_environment_code,progression_intent,generated_workout)
 VALUES(s,u,'generated',45,'6','Strength','Core',now(),current_date,'HOME','MAINTAIN','{}'::jsonb);
 INSERT INTO public.workout_session_exercises(id,session_id,exercise_id,exercise_name,block_key,position,status,prescription_json,expected_outcome_json,user_execution_status)
 VALUES(x,s,'EX087','Hollow Hold','skill',1,'pending','{"duration_seconds":30}'::jsonb,'{"duration_seconds":30}'::jsonb,'pending');
 PERFORM public.e_mark_session_started(s,current_date);
 r:=public.complete_workout_session_v2(s,10,3,'Synthetic first session',jsonb_build_array(jsonb_build_object('session_exercise_id',x,'exercise_id','EX087','user_execution_status','completed','duration_seconds',30)),null);
 IF r->>'status'<>'COMPLETED' THEN RAISE EXCEPTION 'First completion failed %',r; END IF;
 inventory:=public.resolve_user_equipment_inventory(u,equipment,'c4-final-default');
 r:=public.d_generate_adaptive_session_v3(p_user_id=>u,p_focus_override=>'Strength',p_duration_minutes=>90,p_readiness=>'normal',p_target_region_override=>'Full Body',p_zone_terms=>'{}'::text[],p_inventory=>inventory,p_available_equipment=>equipment,p_candidate_count=>3,p_anchor_date=>current_date,p_environment_code=>'HOME');
 c:=coalesce(r->'weekly_loop','{}'::jsonb);
 IF r->>'status'<>'generated' OR r->>'session_id'=s::text OR r->>'session_id' IS NULL THEN RAISE EXCEPTION 'Second generation failed: %',jsonb_build_object('status',r->>'status','reason',r->>'reason_code','context',c->>'status'); END IF;
 IF (c->'previous_session'->>'session_id')=s::text OR coalesce(c->'reason_codes','[]'::jsonb) ?| array['intent:high_rpe_low_post_feeling','intent:previous_session_many_exceptions','intent:recovery_guard','intent:extra_session_after_week_target'] THEN RAISE EXCEPTION 'Same-day fatigue/count penalty persisted: %',c->'reason_codes'; END IF;
 IF (SELECT count(*) FROM public.workout_sessions WHERE user_id=u AND id=s AND status='completed')<>1 THEN RAISE EXCEPTION 'First session lost'; END IF;
 IF (SELECT duration_minutes FROM public.workout_sessions WHERE id=(r->>'session_id')::uuid) IS DISTINCT FROM 90 THEN RAISE EXCEPTION 'Requested second duration lost'; END IF;
 IF coalesce(current_setting('ugerod.daily_generation_anchor',true),'')<>'' THEN RAISE EXCEPTION 'Generation scope leaked'; END IF;
 PERFORM set_config('ugerod.qa_daily_generation_result',jsonb_build_object('status','PASS','second_duration',90,'intent',c->>'progression_intent','reasons',c->'reason_codes','first_preserved',true,'scope_restored',true)::text,true);
END $qa$;
SELECT current_setting('ugerod.qa_daily_generation_result')::jsonb result;
ROLLBACK;
