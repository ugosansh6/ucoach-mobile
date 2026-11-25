-- The UI confirmation 'Aucune' is not an anatomical pain zone.
-- Use the existing normalizer before feeding the recovery/challenge authority.
DO $patch$
declare d text; old text:='''CONDITIONING'',minutes,1,pain,''c4-final-default''';
begin
 d:=pg_get_functiondef('public.week_composer_outdoor_cardio_v1(uuid,jsonb)'::regprocedure);
 if position(old in d)=0 then raise exception 'Outdoor challenge adapter changed'; end if;
 d:=replace(d,old,'''CONDITIONING'',minutes,1,public.normalize_body_zone_ids(pain),''c4-final-default''');
 execute d;
end $patch$;
NOTIFY pgrst,'reload schema';
