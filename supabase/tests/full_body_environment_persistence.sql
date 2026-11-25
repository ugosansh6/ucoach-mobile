-- DEV. Set ugerod.qa_user_id first. Generated fixture sessions are rolled back.
begin;
set local statement_timeout='100s';
do $$
declare
  uid uuid:=nullif(current_setting('ugerod.qa_user_id',true),'')::uuid;
  inv jsonb;
  result jsonb;
  workout jsonb;
  diag jsonb;
  sid uuid;
  env text;
  results jsonb:='[]';
begin
  if uid is null then raise exception 'Set ugerod.qa_user_id first'; end if;
  perform set_config('request.jwt.claim.sub',uid::text,true);
  perform set_config('ugerod.session_anchor_date',current_date::text,true);
  foreach env in array array['GYM','OUTDOOR'] loop
    if env='GYM' then
      inv:='[{"equipment_id":"E03","inventory_mode":"fixed_load","load_kg":10,"quantity":2},{"equipment_id":"E05","inventory_mode":"non_load","quantity":1},{"equipment_id":"E07","inventory_mode":"non_load","quantity":1},{"equipment_id":"E08","inventory_mode":"non_load","quantity":1}]';
      result:=public.gym_generate_session_runtime_v1(uid,'Strength',45,'normal','Full Body','MAINTAIN','{}',inv,array['Haltères','Élastiques','Barre de traction','Banc'],'GYM_STRENGTH','CLASSIC_SETS',3,'Intermédiaire',8,'c4-final-default',false);
    else
      inv:='[{"equipment_id":"E07","inventory_mode":"non_load","quantity":1}]';
      result:=public.outdoor_generate_session_runtime_v1(uid,45,'normal','General Fitness','Full Body','MAINTAIN','{}',inv,array['Barre de traction'],'STREET_WORKOUT','GRASS','OUTDOOR_CONDITIONING_WOD',false,true,false,3,'Intermédiaire',8,false);
    end if;
    sid:=nullif(result->>'session_id','')::uuid;
    if sid is null then raise exception '% persistence failed: %',env,result; end if;
    select generated_workout into workout from public.workout_sessions where id=sid and user_id=uid;
    diag:=coalesce(workout#>'{meta,architecture,full_body_balance}',workout#>'{architecture,full_body_balance}');
    if diag is null or diag->>'scope'<>'SKILL_WOD' or diag->'after' is distinct from public.c4_full_body_exposure_v1(workout->'blocks') then
      raise exception '% persisted policy diagnostic mismatch: %',env,diag;
    end if;
    if (diag#>>'{after,missing_count}')::int<>0 then raise exception '% persisted plan omitted a required region',env; end if;
    if not exists(select 1 from public.workout_session_exercises x where x.session_id=sid and x.block_key='wod')
       or not exists(select 1 from public.workout_session_exercises x where x.session_id=sid and x.block_key='tabata') then
      raise exception '% lost canonical training or signature rows',env;
    end if;
    if exists(select 1 from public.workout_session_exercises x join public.exercises e on e.id=x.exercise_id
      where x.session_id=sid and x.block_key='tabata' and e.exercise_family<>'Core') then
      raise exception '% persisted signature is no longer core',env;
    end if;
    results:=results||jsonb_build_array(jsonb_build_object('environment',env,'pass',true));
  end loop;
  perform set_config('ugerod.full_body_persistence_results',results::text,true);
end;
$$;
select current_setting('ugerod.full_body_persistence_results')::jsonb results;
rollback;
