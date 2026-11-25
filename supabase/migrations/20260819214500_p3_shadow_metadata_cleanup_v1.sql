update public.session_engine_policy
set config=jsonb_set(config,'{session_intent,pattern_complement_remains_shadow}','false'::jsonb,true),updated_at=now()
where policy_key='c4-final-default';
