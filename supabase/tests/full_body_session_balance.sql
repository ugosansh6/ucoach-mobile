-- Run on DEV with an existing QA profile, in the same connection:
--   select set_config('ugerod.qa_user_id','<QA profile uuid>',false);
--   \i supabase/tests/full_body_session_balance.sql
-- No session/history writes; all test state is transaction-local.
begin;
set local statement_timeout='120s';
do $$
declare
  uid uuid:=nullif(current_setting('ugerod.qa_user_id',true),'')::uuid;
  p jsonb;
  q jsonb;
  fixture jsonb;
  candidate jsonb;
  ex jsonb;
  blocks jsonb;
  before_skill jsonb;
  before_tabata jsonb;
  original_rows bigint;
  region text;
  denied boolean:=false;
begin
  if uid is null then raise exception 'Set ugerod.qa_user_id first'; end if;
  perform set_config('request.jwt.claim.sub',uid::text,true);
  perform set_config('ugerod.session_anchor_date',current_date::text,true);
  perform set_config('ugerod.session_environment','HOME',true);
  select count(*) into original_rows from public.workout_sessions where user_id=uid;

  -- The Full Body catalog label cannot make a jump or a core exercise count as
  -- an upper-body strength movement. Different core patterns are one region.
  if public.c4_full_body_region_v1('Jump','Jump','Full Body')<>'Lower'
     or public.c4_full_body_region_v1('Anti-Extension','Core','Core')<>'Core'
     or public.c4_full_body_region_v1('Core','Core','Full Body')<>'Core'
     or public.c4_full_body_region_v1('Conditioning','Conditioning','Full Body')<>'Mixed' then
    raise exception 'Regional coverage misclassified';
  end if;
  q:=public.c4_full_body_exposure_v1('[{"block_key":"tabata","duration_minutes":4,"exercises":[{"exercise_id":"EX087"}]}]');
  if (q#>>'{regional_minutes,Core}')::numeric<>0 or (q->>'missing_count')::int<>2
     or (q->>'tabata_counted')::boolean is distinct from false then
    raise exception 'Independent Tabata contaminated Skill/WOD coverage: %',q;
  end if;

  p:=public.c4_plan_full_session_v2(uid,'Strength',60,'low','Full Body','DELOAD','{}','[]',3,'Intermédiaire',8,'c4-final-default');
  if p->>'status'<>'READY' or p#>>'{architecture,full_body_balance,mode}' is distinct from 'ACTIVE' then
    raise exception 'Final active generator did not run Full Body balancing: %',p->>'status';
  end if;
  if (public.c4_full_body_exposure_v1(p->'blocks')->>'missing_count')::int<>0 then
    raise exception 'Safe bodyweight Full Body omitted an entire region';
  end if;
  if not coalesce((p#>>'{selected_candidate,c4_quality_gate,pass}')::boolean,false) then
    raise exception 'Balanced generation failed WOD hard gates';
  end if;

  -- Rebuild the reported session independently of persisted private history:
  -- Tabata core + Hollow Hold/Rocks curriculum + squat/crunch/push WOD.
  select jsonb_agg(jsonb_build_object('exercise_id',e.id,'name',e.name,'pattern',e.movement_pattern,'family',e.exercise_family,
    'prescription',public.c2_solver_prescription(uid,e.id,p->'stimulus','SETS_REPS','DELOAD','[]')) order by x.pos)
    into ex from (values ('EX033',1),('EX524',2),('EX454',3)) x(id,pos) join public.exercises e on e.id=x.id;
  candidate:=public.c4_finalize_candidate(((p->'selected_candidate')-'c4_final')||jsonb_build_object('exercises',ex),p->'stimulus',60,13,'c4-final-default','c3-sim-default');
  select jsonb_agg(case b->>'block_key'
    when 'tabata' then b||jsonb_build_object('exercises','[{"exercise_id":"EX523"},{"exercise_id":"EX318"}]'::jsonb)
    when 'skill' then b||jsonb_build_object('exercises','[{"exercise_id":"EX087","pattern":"Anti-Extension","family":"Core"},{"exercise_id":"EX089","pattern":"Anti-Extension","family":"Core"}]'::jsonb)
    when 'wod' then b||jsonb_build_object('duration_minutes',13,'exercises',candidate->'exercises')
    else b end order by ord) into blocks from jsonb_array_elements(p->'blocks') with ordinality x(b,ord);
  fixture:=p||jsonb_build_object('blocks',blocks,'selected_candidate',candidate);
  select b into before_skill from jsonb_array_elements(blocks) b where b->>'block_key'='skill';
  select b into before_tabata from jsonb_array_elements(blocks) b where b->>'block_key'='tabata';
  q:=public.c4_apply_full_body_balance_v1(uid,fixture,'Strength',60,'low','Full Body','DELOAD','{}','[]',3,'Intermédiaire',8,'c4-final-default');
  if q->>'status'<>'READY' or not coalesce((q#>>'{architecture,full_body_balance,applied}')::boolean,false) then
    raise exception 'Reported stacking case was not repaired';
  end if;
  if exists(select 1 from jsonb_array_elements(q->'blocks') b where b->>'block_key'='skill' and b<>before_skill)
     or exists(select 1 from jsonb_array_elements(q->'blocks') b where b->>'block_key'='tabata' and b<>before_tabata) then
    raise exception 'Balancing changed the protected curriculum or signature';
  end if;
  if exists(select 1 from jsonb_array_elements(q->'blocks') b cross join lateral jsonb_array_elements(b->'exercises') x
    join public.exercises e on e.id=x->>'exercise_id' where b->>'block_key'='wod' and e.exercise_family='Core') then
    raise exception 'Core stacked again in the WOD despite safe complementary alternatives';
  end if;
  if not coalesce((q#>>'{selected_candidate,c4_quality_gate,pass}')::boolean,false)
     or not coalesce((q#>>'{architecture,full_body_balance,changed_block_coherence,pass}')::boolean,false) then
    raise exception 'Replacement failed workload/safety/coherence gates';
  end if;

  foreach region in array array['Upper','Lower','Core'] loop
    if public.c4_apply_full_body_balance_v1(uid,fixture,'Strength',60,'low',region,'DELOAD','{}','[]',3,'Intermédiaire',8,'c4-final-default')<>fixture then
      raise exception 'Explicit % session was changed',region;
    end if;
  end loop;
  p:=fixture||jsonb_build_object('status','NO_SAFE_PLAN');
  if public.c4_apply_full_body_balance_v1(uid,p,'Strength',60,'low','Full Body','DELOAD','{}','[]',3,'Intermédiaire',8,'c4-final-default')<>p then
    raise exception 'Failed plan was reinterpreted';
  end if;
  p:=jsonb_set(fixture,'{selected_candidate,protocol_intelligence,selection_retest_candidate}','true');
  if public.c4_apply_full_body_balance_v1(uid,p,'Strength',60,'low','Full Body','DELOAD','{}','[]',3,'Intermédiaire',8,'c4-final-default')<>p then
    raise exception 'Exact retest identity was changed';
  end if;

  begin
    perform public.c4_apply_full_body_balance_v1(gen_random_uuid(),fixture,'Strength',60,'low','Full Body','DELOAD','{}','[]',3,'Intermédiaire',8,'c4-final-default');
  exception when others then
    if sqlerrm='Forbidden user' then denied:=true; else raise; end if;
  end;
  if not denied then raise exception 'Cross-user invocation was accepted'; end if;
  if exists(select 1 from pg_proc pr join pg_namespace n on n.oid=pr.pronamespace
    where n.nspname='public' and pr.proname in ('c4_full_body_region_v1','c4_full_body_exposure_v1','c4_apply_full_body_balance_v1')
      and (pr.prosecdef or has_function_privilege('anon',pr.oid,'EXECUTE') or has_function_privilege('authenticated',pr.oid,'EXECUTE'))) then
    raise exception 'An internal helper is exposed as a client RPC';
  end if;
  if (select count(*) from public.workout_sessions where user_id=uid)<>original_rows then
    raise exception 'Read-only generation unexpectedly persisted sessions';
  end if;
end;
$$;
select 'full_body_session_balance: PASS' as result;
rollback;
