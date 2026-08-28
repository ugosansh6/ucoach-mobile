-- ENV-007 cleanup: the canonical 19-argument d_generate_adaptive_session_v3 already
-- owns environment context resolution, policy, session config and persistence.
-- Remove the narrower overload introduced during the audit so there is one authority.
drop function if exists public.d_generate_adaptive_session_v3(
  uuid,text,integer,text,text,text,text[],jsonb,text[],integer,text,integer,text,date,boolean,uuid[],text
);