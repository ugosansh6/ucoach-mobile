-- Preserve the producer's root block contract (no additional block envelope).
DO $patch$
declare d text;
begin
 d:=pg_get_functiondef('public.week_composer_outdoor_cardio_v1(uuid,jsonb)'::regprocedure);
 if position(' b:=compiled->''block'';' in d)=0 then raise exception 'Outdoor producer adapter changed'; end if;
 d:=replace(d,' b:=compiled->''block'';',' b:=compiled;');
 execute d;
 d:=pg_get_functiondef('public.week_compile_composer_outdoor_day_j_v1(uuid,uuid,date,integer,text[],text[],text,jsonb)'::regprocedure);
 d:=replace(d,E'begin\n  if auth.uid()',E'begin\n  if auth.uid() is null then raise exception ''AUTH_REQUIRED'' using errcode=''42501''; end if;\n  if auth.uid()');
 execute d;
end $patch$;
NOTIFY pgrst,'reload schema';
