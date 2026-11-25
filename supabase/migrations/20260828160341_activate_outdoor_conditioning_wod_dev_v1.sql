update public.environment_session_format_policy
set constraints_json = jsonb_set(
  jsonb_set(coalesce(constraints_json,'{}'::jsonb),'{generation_enabled}','true'::jsonb,true),
  '{compiler_status}',to_jsonb('ACTIVE'::text),true
)
where environment_code='OUTDOOR'
  and format_code='OUTDOOR_CONDITIONING_WOD';
