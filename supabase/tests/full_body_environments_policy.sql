-- DEV. Set ugerod.qa_user_id first. Plans only; no session/history writes.
begin;
set local statement_timeout='150s';
do $$
declare
  uid uuid:=nullif(current_setting('ugerod.qa_user_id',true),'')::uuid;
  env text;
  p jsonb;
  exposure jsonb;
  diag jsonb;
  inv jsonb;
  results jsonb:='[]';
  warm_block jsonb;
  warm_exercise jsonb;
begin
  if uid is null then raise exception 'Set ugerod.qa_user_id first'; end if;
  perform set_config('request.jwt.claim.sub',uid::text,true);
  perform set_config('ugerod.session_anchor_date',current_date::text,true);
  foreach env in array array['HOME','BOX','GYM','OUTDOOR'] loop
    perform set_config('ugerod.session_environment',env,true);
    perform set_config('ugerod.session_surface',case when env='OUTDOOR' then 'GRASS' else '' end,true);
    if env='GYM' then
      inv:='[{"equipment_id":"E03","inventory_mode":"fixed_load","load_kg":10,"quantity":2},{"equipment_id":"E05","inventory_mode":"non_load","quantity":1},{"equipment_id":"E07","inventory_mode":"non_load","quantity":1},{"equipment_id":"E08","inventory_mode":"non_load","quantity":1}]';
      p:=public.gym_plan_session_v2(uid,'Strength',45,'normal','Full Body','MAINTAIN','{}',inv,'GYM_STRENGTH','CLASSIC_SETS',3,'Intermédiaire',8,'c4-final-default');
    elsif env='OUTDOOR' then
      inv:='[{"equipment_id":"E07","inventory_mode":"non_load","quantity":1}]';
      p:=public.outdoor_plan_session_v4(uid,45,'normal','General Fitness','Full Body','MAINTAIN','{}',inv,'STREET_WORKOUT','GRASS','OUTDOOR_CONDITIONING_WOD',false,true,false,3,'Intermédiaire',8);
    else
      inv:=case when env='BOX' then '[{"equipment_id":"E05","inventory_mode":"non_load","quantity":1}]'::jsonb else '[]'::jsonb end;
      p:=public.c4_plan_full_session_v2(uid,'Strength',45,'normal','Full Body','MAINTAIN','{}',inv,3,'Intermédiaire',8,'c4-final-default');
    end if;
    if p->>'status'<>'READY' then raise exception '% generation failed: %',env,p; end if;
    diag:=p#>'{architecture,full_body_balance}';
    exposure:=public.c4_full_body_exposure_v1(p->'blocks');
    if diag->>'mode' is distinct from 'ACTIVE' or diag->>'scope' is distinct from 'SKILL_WOD'
       or (diag->>'tabata_independent')::boolean is distinct from true then
      raise exception '% did not consume the common Skill/WOD policy: %',env,diag;
    end if;
    if diag->'after' is distinct from exposure or (exposure->>'missing_count')::int<>0 then
      raise exception '% final coverage/diagnostic mismatch: %',env,exposure;
    end if;
    if not exists(select 1 from jsonb_array_elements(p->'blocks') b where b->>'block_key' in ('tabata','tabata_abs')) then
      raise exception '% lost its signature Tabata',env;
    end if;
    if exists(select 1 from jsonb_array_elements(p->'blocks') b cross join lateral jsonb_array_elements(b->'exercises') ex
      join public.exercises e on e.id=coalesce(ex->>'exercise_id',ex->>'id')
      where b->>'block_key' in ('tabata','tabata_abs') and e.exercise_family<>'Core') then
      raise exception '% signature Tabata is no longer core focused',env;
    end if;
    if exists(select 1 from jsonb_array_elements(p->'blocks') b cross join lateral jsonb_array_elements(b->'exercises') ex
      where not public.exercise_equipment_compatible(coalesce(ex->>'exercise_id',ex->>'id'),inv)) then
      raise exception '% introduced undeclared equipment',env;
    end if;
    if env in ('HOME','BOX') then
      select z into warm_block from jsonb_array_elements(p->'blocks') z where z->>'block_key'='warmup';
      if warm_block#>>'{preparation_quality_contract,selection_basis}' is distinct from 'FINAL_SKILL_AND_WOD_TARGETS' then
        raise exception '% final preparation bypassed target derivation',env;
      end if;
      for warm_exercise in select value from jsonb_array_elements(warm_block->'exercises') loop
        if not exists(select 1 from jsonb_array_elements(p->'blocks') t cross join lateral jsonb_array_elements(t->'exercises') ex
          where t->>'block_key' in ('skill','wod') and coalesce(ex->>'exercise_id',ex->>'id')=warm_exercise#>>'{prescription,warmup_target_exercise_id}') then
          raise exception '% warm-up references a discarded target: %',env,warm_exercise;
        end if;
      end loop;
    end if;
    results:=results||jsonb_build_array(jsonb_build_object('environment',env,'pass',true,'exposure',exposure));
  end loop;
  perform set_config('ugerod.full_body_environment_results',results::text,true);
end;
$$;
select current_setting('ugerod.full_body_environment_results')::jsonb results;
rollback;
