alter function public.generate_environment_session_v3(
  uuid,text,text,text,text,text,integer,text,text,text,text[],jsonb,text[],text,
  boolean,boolean,boolean,integer,text,integer,text,boolean,date
)
  set statement_timeout = '60s';

revoke execute on function public.generate_environment_session_v3(
  uuid,text,text,text,text,text,integer,text,text,text,text[],jsonb,text[],text,
  boolean,boolean,boolean,integer,text,integer,text,boolean,date
)
  from authenticated;

grant execute on function public.generate_environment_session_v3(
  uuid,text,text,text,text,text,integer,text,text,text,text[],jsonb,text[],text,
  boolean,boolean,boolean,integer,text,integer,text,boolean,date
)
  to service_role;
