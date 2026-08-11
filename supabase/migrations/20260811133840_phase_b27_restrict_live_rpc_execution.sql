-- B2.7 hardening: SECURITY DEFINER helpers must never be callable anonymously.

revoke all on function public.run_capability_live_session(uuid,text,text) from public;
revoke all on function public.run_capability_live_session(uuid,text,text) from anon;
grant execute on function public.run_capability_live_session(uuid,text,text) to authenticated;

revoke all on function public.apply_session_protocol_observation(uuid,numeric,text) from public;
revoke all on function public.apply_session_protocol_observation(uuid,numeric,text) from anon;
grant execute on function public.apply_session_protocol_observation(uuid,numeric,text) to authenticated;

revoke all on function public.build_session_protocol_descriptor(uuid) from public;
revoke all on function public.build_session_protocol_descriptor(uuid) from anon;
revoke all on function public.build_session_protocol_descriptor(uuid) from authenticated;
