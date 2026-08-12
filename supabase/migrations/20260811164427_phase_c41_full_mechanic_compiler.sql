-- C4.1 — full backend mechanic compiler, DEV only

-- Complete WOD exercise-count contracts for every core mechanic.
insert into public.block_rules(block_key,format,min_exercises,max_exercises,preferred_exercises,active,notes)
select 'wod', v.format, v.min_ex, v.max_ex, v.pref, true, 'C4.1 full mechanic compiler'
from (values
  ('LADDER',2,3,2),
  ('PYRAMID',2,3,2),
  ('PROGRESSIVE_INTERVAL',1,2,1),
  ('CHIPPER',4,10,6),
  ('EVERY_X_MINUTES',2,5,3),
  ('REP_TARGET',2,6,4),
  ('ODD_EVEN',2,2,2),
  ('COUPLET',2,2,2),
  ('DECK',4,4,4)
) as v(format,min_ex,max_ex,pref)
where not exists (
  select 1 from public.block_rules br
  where br.block_key='wod' and upper(coalesce(br.format,''))=v.format and br.active
);

-- C4.1 defaults are explicit and calibratable.
update public.session_engine_policy
set config = jsonb_set(
  jsonb_set(
    jsonb_set(
      jsonb_set(
        jsonb_set(
          jsonb_set(
            jsonb_set(
              jsonb_set(
                config,
                '{mechanic_defaults,every_x_reserve_seconds}','10'::jsonb,true
              ),
              '{mechanic_defaults,every_x_allowed_intervals_seconds}','[60,90,120,180]'::jsonb,true
            ),
            '{mechanic_defaults,deck_cards}','52'::jsonb,true
          ),
          '{mechanic_defaults,deck_reps_per_suit}','95'::jsonb,true
        ),
        '{mechanic_defaults,couplet_max_rungs}','12'::jsonb,true
      ),
      '{mechanic_defaults,rep_target_min_reps_per_exercise}','5'::jsonb,true
    ),
    '{mechanic_defaults,rep_target_max_reps_per_exercise}','100'::jsonb,true
  ),
  '{mechanic_defaults,chipper_max_volume_multiplier}','3'::jsonb,true
)
where policy_key='c4-final-default';

-- Preserve the previous canonical compiler for the classic mechanics.
do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='c4_finalize_candidate'
  ) and not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='c4_finalize_candidate_v15_base'
  ) then
    alter function public.c4_finalize_candidate(jsonb,jsonb,integer,integer,text,text)
      rename to c4_finalize_candidate_v15_base;
  end if;
end $$;

-- Per-exercise mechanic preparation. Existing explicit overlays are preserved.
create or replace function public.c4_prepare_candidate(
  p_candidate jsonb,
  p_policy_key text default 'c4-final-default'
)
returns jsonb
language plpgsql
stable
set search_path=public
as $$
declare
  v_cfg jsonb;
  v_mechanic text := upper(coalesce(p_candidate->>'mechanic',''));
  v_variant text := upper(coalesce(p_candidate->>'variant_key',p_candidate->>'variant',''));
  v_exercises jsonb := '[]'::jsonb;
  v_ex jsonb;
  v_pres jsonb;
  v_modes jsonb;
  v_overlay jsonb;
  v_compatible boolean := true;
  v_reasons jsonb := '[]'::jsonb;
  v_start int;
  v_inc int;
  v_index int := 0;
begin
  select config into v_cfg from public.session_engine_policy where policy_key=p_policy_key;
  if v_cfg is null then raise exception 'Unknown C4 policy %',p_policy_key; end if;

  if v_mechanic='COUPLET' and v_variant='' then v_variant:='ASCENDING_COUPLET'; end if;
  if v_mechanic='PROGRESSIVE_INTERVAL' and v_variant='' then v_variant:='PROGRESSIVE_GENERIC'; end if;

  for v_ex in select value from jsonb_array_elements(coalesce(p_candidate->'exercises','[]'::jsonb))
  loop
    v_index:=v_index+1;
    v_pres:=coalesce(v_ex->'prescription','{}'::jsonb);
    v_modes:=coalesce(v_pres->'tracking_modes','[]'::jsonb);
    v_overlay:=coalesce(v_pres->'mechanic_overlay','{}'::jsonb);

    if v_mechanic in ('LADDER','PYRAMID','PROGRESSIVE_INTERVAL','COUPLET','REP_TARGET','DECK') then
      if not exists(select 1 from jsonb_array_elements_text(v_modes) m where m='reps') then
        v_compatible:=false;
        v_reasons:=v_reasons||jsonb_build_array(v_mechanic||'_REQUIRES_REP_TRACKING:'||(v_ex->>'exercise_id'));
      end if;
    end if;

    if v_mechanic='LADDER' then
      v_start:=coalesce(nullif(v_overlay->>'start_reps','')::int,
        nullif(v_pres->>'reps_min','')::int,
        (v_cfg#>>'{mechanic_defaults,ladder_start_reps}')::int,2);
      v_start:=greatest(1,least(v_start,12));
      v_inc:=coalesce(nullif(v_overlay->>'increment_reps','')::int,
        case when v_start>=8 then 1 else coalesce((v_cfg#>>'{mechanic_defaults,ladder_increment_reps}')::int,2) end);
      v_pres:=v_pres||jsonb_build_object('mechanic_overlay',jsonb_build_object(
        'type','ascending_ladder','start_reps',v_start,'increment_reps',greatest(1,v_inc),'exercise_position',v_index));

    elsif v_mechanic='PYRAMID' then
      v_start:=coalesce(nullif(v_overlay->>'base_reps','')::int,
        nullif(v_pres->>'reps_min','')::int,
        (v_cfg#>>'{mechanic_defaults,pyramid_base_reps}')::int,4);
      v_start:=greatest(1,least(v_start,12));
      v_pres:=v_pres||jsonb_build_object('mechanic_overlay',jsonb_build_object(
        'type','pyramid','base_reps',v_start,
        'multipliers',coalesce(v_cfg#>'{mechanic_defaults,pyramid_multipliers}','[1,2,3,2,1]'::jsonb),
        'exercise_position',v_index));

    elsif v_mechanic='PROGRESSIVE_INTERVAL' then
      v_start:=coalesce(nullif(v_overlay->>'start_reps','')::int,
        nullif(v_pres->>'reps_min','')::int,
        (v_cfg#>>'{mechanic_defaults,progressive_start_reps}')::int,3);
      v_start:=greatest(1,least(v_start,15));
      v_inc:=coalesce(nullif(v_overlay->>'increment_reps','')::int,
        (v_cfg#>>'{mechanic_defaults,progressive_increment_reps}')::int,1);
      v_pres:=v_pres||jsonb_build_object('mechanic_overlay',jsonb_build_object(
        'type',lower(case when v_variant in ('DEATH_BY','DEATH_BY_COUPLET') then v_variant else 'PROGRESSIVE_GENERIC' end),
        'start_reps',v_start,'increment_reps',greatest(1,v_inc),
        'interval_seconds',coalesce((v_cfg#>>'{mechanic_defaults,progressive_interval_seconds}')::int,60),
        'exercise_position',v_index));

    elsif v_mechanic='COUPLET' then
      v_start:=coalesce(nullif(v_overlay->>'start_reps','')::int,nullif(v_pres->>'reps_min','')::int,3);
      v_start:=greatest(1,least(v_start,15));
      v_inc:=coalesce(nullif(v_overlay->>'increment_reps','')::int,2);
      v_pres:=v_pres||jsonb_build_object('mechanic_overlay',jsonb_build_object(
        'type',lower(v_variant),'start_reps',v_start,'increment_reps',greatest(1,v_inc),'exercise_position',v_index));

    elsif v_mechanic='DECK' then
      v_pres:=v_pres||jsonb_build_object('mechanic_overlay',jsonb_build_object(
        'type','deck_suit','suit_index',v_index,'cards_per_suit',13,'strict_card_value_reps',true));
    end if;

    v_exercises:=v_exercises||jsonb_build_array(jsonb_set(v_ex,'{prescription}',v_pres,true));
  end loop;

  if v_mechanic='ODD_EVEN' and jsonb_array_length(v_exercises)<>2 then
    v_compatible:=false; v_reasons:=v_reasons||jsonb_build_array('ODD_EVEN_REQUIRES_EXACTLY_TWO_EXERCISES');
  end if;
  if v_mechanic='COUPLET' and jsonb_array_length(v_exercises)<>2 then
    v_compatible:=false; v_reasons:=v_reasons||jsonb_build_array('COUPLET_REQUIRES_EXACTLY_TWO_EXERCISES');
  end if;
  if v_mechanic='DECK' and jsonb_array_length(v_exercises)<>4 then
    v_compatible:=false; v_reasons:=v_reasons||jsonb_build_array('DECK_STRICT_REQUIRES_EXACTLY_FOUR_EXERCISES');
  end if;
  if v_mechanic='PROGRESSIVE_INTERVAL' and v_variant='DEATH_BY' and jsonb_array_length(v_exercises)<>1 then
    v_compatible:=false; v_reasons:=v_reasons||jsonb_build_array('DEATH_BY_REQUIRES_EXACTLY_ONE_EXERCISE');
  end if;
  if v_mechanic='PROGRESSIVE_INTERVAL' and v_variant='DEATH_BY_COUPLET' and jsonb_array_length(v_exercises)<>2 then
    v_compatible:=false; v_reasons:=v_reasons||jsonb_build_array('DEATH_BY_COUPLET_REQUIRES_EXACTLY_TWO_EXERCISES');
  end if;

  return jsonb_set(
    jsonb_set(jsonb_set(p_candidate,'{exercises}',v_exercises,true),'{variant_key}',to_jsonb(nullif(v_variant,'')),true),
    '{c4_preparation}',jsonb_build_object(
      'mechanic_compatible',v_compatible,'reasons',v_reasons,
      'per_exercise_progression',true,'version','c4-prepare-v2.0-c41'),true
  );
end;
$$;

-- Extended compiler for mechanics that were not fully compiled by v1.5,
-- plus Ladder/Pyramid/Progressive so their progression is truly per exercise.
create or replace function public.c4_finalize_candidate_extended(
  p_candidate jsonb,
  p_stimulus jsonb,
  p_total_duration_minutes integer,
  p_exact_wod_minutes integer default null,
  p_c4_policy_key text default 'c4-final-default',
  p_c3_policy_key text default 'c3-sim-default'
)
returns jsonb
language plpgsql
stable
set search_path=public
as $$
declare
  v_cfg jsonb;
  v_c3_cfg jsonb;
  v_mechanic text:=upper(coalesce(p_candidate->>'mechanic',''));
  v_variant text:=upper(coalesce(p_candidate->>'variant_key',p_candidate->>'variant',''));
  v_exercises jsonb:=coalesce(p_candidate->'exercises','[]'::jsonb);
  v_n int:=jsonb_array_length(v_exercises);
  v_units jsonb:='[]'::jsonb;
  v_unit jsonb;
  v_ex jsonb;
  v_pres jsonb;
  v_final_exercises jsonb:='[]'::jsonb;
  v_wod_min int;
  v_wod_sec numeric;
  v_target_util numeric;
  v_target_sec numeric;
  v_elapsed numeric:=0;
  v_active numeric:=0;
  v_rest numeric:=0;
  v_transition numeric:=0;
  v_base_round numeric:=0;
  v_duration_util numeric:=0;
  v_density numeric:=0;
  v_duration_fit numeric:=0;
  v_density_fit numeric:=0;
  v_whole_fit numeric:=0;
  v_status text:='OK';
  v_reasons jsonb:='[]'::jsonb;
  v_params jsonb:='{}'::jsonb;
  v_overlays jsonb:=coalesce(p_candidate->'overlays','[]'::jsonb);
  v_overlay_seconds numeric:=0;
  v_overlay jsonb;
  v_stage int:=0;
  v_rungs int:=0;
  v_cycles int:=0;
  v_interval numeric:=0;
  v_reserve numeric:=0;
  v_stage_active numeric:=0;
  v_stage_transition numeric:=0;
  v_stage_work numeric:=0;
  v_cycle_active numeric:=0;
  v_cycle_transition numeric:=0;
  v_cycle_work numeric:=0;
  v_scale numeric:=1;
  v_rep_target numeric:=0;
  v_target_each numeric:=0;
  v_spr numeric:=0;
  v_reps numeric:=0;
  v_deck_reps numeric:=95;
  v_deck_cards int:=52;
  v_deck_transition numeric:=0;
  v_max_chipper numeric:=3;
  v_allowed jsonb;
  v_candidate_interval numeric;
  v_count int;
  i int;
  rec record;
begin
  select config into v_cfg from public.session_engine_policy where policy_key=p_c4_policy_key;
  select config into v_c3_cfg from public.session_engine_policy where policy_key=p_c3_policy_key;
  if v_cfg is null then raise exception 'Unknown C4 policy %',p_c4_policy_key; end if;
  if v_c3_cfg is null then raise exception 'Unknown C3 policy %',p_c3_policy_key; end if;

  if coalesce((p_candidate#>>'{c4_preparation,mechanic_compatible}')::boolean,true)=false then
    return p_candidate||jsonb_build_object('c4_final',jsonb_build_object(
      'version','c4-full-mechanic-v2.0','status','INCOMPATIBLE_MECHANIC','feasible',false,
      'reasons',coalesce(p_candidate#>'{c4_preparation,reasons}','[]'::jsonb)));
  end if;

  v_wod_min:=public.c3_wod_budget_minutes(p_total_duration_minutes,p_exact_wod_minutes,p_c3_policy_key);
  v_wod_sec:=v_wod_min*60;
  v_target_util:=coalesce((v_c3_cfg#>>array['mechanic_duration_target_percent',v_mechanic])::numeric,85);
  v_target_sec:=v_wod_sec*v_target_util/100.0;

  for v_ex in select value from jsonb_array_elements(v_exercises)
  loop
    v_unit:=public.c3_unit_estimate(v_ex->>'exercise_id',coalesce(v_ex->'prescription','{}'::jsonb),p_c3_policy_key);
    v_units:=v_units||jsonb_build_array(v_unit);
    v_active:=v_active+coalesce((v_unit->>'estimated_active_work_seconds')::numeric,0);
    v_transition:=v_transition+coalesce((v_unit->>'estimated_transition_seconds')::numeric,0);
  end loop;
  v_base_round:=greatest(1,v_active+v_transition);

  -- Non-conditional overlays consume real baseline time; penalty remains conditional metadata.
  for v_overlay in select value from jsonb_array_elements(case when jsonb_typeof(v_overlays)='array' then v_overlays else '[]'::jsonb end)
  loop
    if coalesce((v_overlay->>'conditional')::boolean,false)=false then
      v_overlay_seconds:=v_overlay_seconds+
        coalesce(nullif(v_overlay->>'estimated_seconds','')::numeric,0)+
        coalesce(nullif(v_overlay->>'buy_in_seconds','')::numeric,0)+
        coalesce(nullif(v_overlay->>'cash_out_seconds','')::numeric,0);
    end if;
  end loop;
  v_target_sec:=greatest(1,v_target_sec-v_overlay_seconds);

  if v_mechanic in ('LADDER','COUPLET') then
    for i in 1..coalesce((v_cfg#>>'{mechanic_defaults,couplet_max_rungs}')::int,12)
    loop
      select
        coalesce(sum(
          case when coalesce(nullif(u.value->>'reps_total','')::numeric,0)>0 then
            (coalesce(nullif(x.value#>>'{prescription,mechanic_overlay,start_reps}','')::numeric,1)
             +(i-1)*coalesce(nullif(x.value#>>'{prescription,mechanic_overlay,increment_reps}','')::numeric,1))
            *coalesce((u.value->>'estimated_active_work_seconds')::numeric,0)
            /greatest(1,(u.value->>'reps_total')::numeric)
          else coalesce((u.value->>'estimated_active_work_seconds')::numeric,0) end
        ),0),
        coalesce(sum(coalesce((u.value->>'estimated_transition_seconds')::numeric,0)),0)
      into v_stage_active,v_stage_transition
      from jsonb_array_elements(v_units) with ordinality u(value,ord)
      join jsonb_array_elements(v_exercises) with ordinality x(value,ord) using(ord);
      v_stage_work:=v_stage_active+v_stage_transition;
      exit when v_elapsed+v_stage_work>v_target_sec;
      v_elapsed:=v_elapsed+v_stage_work;
      v_active:=case when v_rungs=0 then 0 else v_active end;
      if v_rungs=0 then v_active:=0; v_transition:=0; end if;
      v_active:=v_active+v_stage_active;
      v_transition:=v_transition+v_stage_transition;
      v_rungs:=i;
    end loop;
    if v_rungs<3 then v_status:='INFEASIBLE';v_reasons:=v_reasons||jsonb_build_array(v_mechanic||'_LT_3_RUNGS'); end if;
    if v_mechanic='COUPLET' and v_n<>2 then v_status:='INFEASIBLE';v_reasons:=v_reasons||jsonb_build_array('COUPLET_REQUIRES_2'); end if;
    v_params:=jsonb_build_object('rungs',v_rungs,'variant_key',nullif(v_variant,''),'per_exercise_progression',true);

  elsif v_mechanic='PYRAMID' then
    v_cycle_active:=0; v_cycle_transition:=0;
    for i in 1..5 loop
      select coalesce(sum(
        case when coalesce(nullif(u.value->>'reps_total','')::numeric,0)>0 then
          coalesce(nullif(x.value#>>'{prescription,mechanic_overlay,base_reps}','')::numeric,1)
          *case i when 1 then 1 when 2 then 2 when 3 then 3 when 4 then 2 else 1 end
          *coalesce((u.value->>'estimated_active_work_seconds')::numeric,0)/greatest(1,(u.value->>'reps_total')::numeric)
        else coalesce((u.value->>'estimated_active_work_seconds')::numeric,0) end
      ),0),coalesce(sum(coalesce((u.value->>'estimated_transition_seconds')::numeric,0)),0)
      into v_stage_active,v_stage_transition
      from jsonb_array_elements(v_units) with ordinality u(value,ord)
      join jsonb_array_elements(v_exercises) with ordinality x(value,ord) using(ord);
      v_cycle_active:=v_cycle_active+v_stage_active;
      v_cycle_transition:=v_cycle_transition+v_stage_transition;
    end loop;
    v_cycle_work:=greatest(1,v_cycle_active+v_cycle_transition);
    v_cycles:=greatest(0,least(coalesce((v_cfg#>>'{mechanic_defaults,pyramid_max_cycles}')::int,3),floor(v_target_sec/v_cycle_work)::int));
    if v_cycles<1 then v_status:='INFEASIBLE';v_reasons:=v_reasons||jsonb_build_array('PYRAMID_NO_COMPLETE_CYCLE'); end if;
    v_active:=v_cycle_active*v_cycles;v_transition:=v_cycle_transition*v_cycles;v_elapsed:=v_active+v_transition;
    v_params:=jsonb_build_object('cycles',v_cycles,'multipliers','[1,2,3,2,1]'::jsonb,'per_exercise_base_reps',true);

  elsif v_mechanic='PROGRESSIVE_INTERVAL' then
    v_interval:=coalesce((v_cfg#>>'{mechanic_defaults,progressive_interval_seconds}')::numeric,60);
    v_reserve:=coalesce((v_cfg#>>'{mechanic_defaults,progressive_reserve_seconds}')::numeric,8);
    if v_variant='DEATH_BY' and v_n<>1 then v_status:='INFEASIBLE';v_reasons:=v_reasons||jsonb_build_array('DEATH_BY_REQUIRES_1'); end if;
    if v_variant='DEATH_BY_COUPLET' and v_n<>2 then v_status:='INFEASIBLE';v_reasons:=v_reasons||jsonb_build_array('DEATH_BY_COUPLET_REQUIRES_2'); end if;
    v_active:=0;v_transition:=0;
    for i in 1..greatest(1,floor(v_wod_sec/v_interval)::int)
    loop
      select coalesce(sum(
        case when coalesce(nullif(u.value->>'reps_total','')::numeric,0)>0 then
          (coalesce(nullif(x.value#>>'{prescription,mechanic_overlay,start_reps}','')::numeric,1)
           +(i-1)*coalesce(nullif(x.value#>>'{prescription,mechanic_overlay,increment_reps}','')::numeric,1))
          *coalesce((u.value->>'estimated_active_work_seconds')::numeric,0)/greatest(1,(u.value->>'reps_total')::numeric)
        else coalesce((u.value->>'estimated_active_work_seconds')::numeric,0) end
      ),0),coalesce(sum(coalesce((u.value->>'estimated_transition_seconds')::numeric,0)),0)
      into v_stage_active,v_stage_transition
      from jsonb_array_elements(v_units) with ordinality u(value,ord)
      join jsonb_array_elements(v_exercises) with ordinality x(value,ord) using(ord);
      v_stage_work:=v_stage_active+v_stage_transition;
      exit when v_stage_work>v_interval-v_reserve;
      v_stage:=i;v_active:=v_active+v_stage_active;v_transition:=v_transition+v_stage_transition;
    end loop;
    if v_stage<1 then v_status:='INFEASIBLE';v_reasons:=v_reasons||jsonb_build_array('PROGRESSIVE_START_DOES_NOT_FIT'); end if;
    v_elapsed:=v_stage*v_interval;
    v_params:=jsonb_build_object('expected_stage',v_stage,'interval_seconds',v_interval,'stop_reserve_seconds',v_reserve,
      'variant_key',coalesce(nullif(v_variant,''),'PROGRESSIVE_GENERIC'),'per_exercise_progression',true,
      'stop_rule','stop_when_full_prescribed_stage_cannot_finish_inside_interval');

  elsif v_mechanic='EVERY_X_MINUTES' then
    v_allowed:=coalesce(v_cfg#>'{mechanic_defaults,every_x_allowed_intervals_seconds}','[60,90,120,180]'::jsonb);
    v_reserve:=coalesce((v_cfg#>>'{mechanic_defaults,every_x_reserve_seconds}')::numeric,10);
    v_interval:=0;
    for v_candidate_interval in select value::numeric from jsonb_array_elements_text(v_allowed)
    loop
      if v_base_round<=v_candidate_interval-v_reserve and floor(v_wod_sec/v_candidate_interval)>=2 then
        v_interval:=v_candidate_interval; exit;
      end if;
    end loop;
    if v_interval=0 then v_status:='INFEASIBLE';v_reasons:=v_reasons||jsonb_build_array('EVERY_X_NO_SAFE_INTERVAL');
    else
      v_cycles:=floor(v_wod_sec/v_interval);v_active:=v_active*v_cycles;v_transition:=v_transition*v_cycles;v_elapsed:=v_cycles*v_interval;
    end if;
    v_params:=jsonb_build_object('interval_seconds',v_interval,'cycles',v_cycles,'reserve_seconds',v_reserve);

  elsif v_mechanic='ODD_EVEN' then
    if v_n<>2 then v_status:='INFEASIBLE';v_reasons:=v_reasons||jsonb_build_array('ODD_EVEN_REQUIRES_2'); end if;
    if exists(select 1 from jsonb_array_elements(v_units) u where coalesce((u->>'estimated_active_work_seconds')::numeric,999)>50) then
      v_status:='INFEASIBLE';v_reasons:=v_reasons||jsonb_build_array('ODD_EVEN_STATION_EXCEEDS_50_SECONDS');
    end if;
    v_cycles:=floor(v_wod_min/2.0);v_active:=v_active*v_cycles;v_elapsed:=v_cycles*120;v_rest:=greatest(0,v_elapsed-v_active);
    v_params:=jsonb_build_object('cycles',v_cycles,'odd_position',1,'even_position',2,'station_seconds',60);

  elsif v_mechanic='REP_TARGET' then
    v_active:=0;v_transition:=0;v_final_exercises:='[]'::jsonb;
    for rec in
      select x.value as ex,u.value as unit,x.ord
      from jsonb_array_elements(v_exercises) with ordinality x(value,ord)
      join jsonb_array_elements(v_units) with ordinality u(value,ord) using(ord)
      order by x.ord
    loop
      v_reps:=greatest(1,coalesce(nullif(rec.unit->>'reps_total','')::numeric,1));
      v_spr:=greatest(0.2,coalesce((rec.unit->>'estimated_active_work_seconds')::numeric,1)/v_reps);
      v_target_each:=greatest(
        coalesce((v_cfg#>>'{mechanic_defaults,rep_target_min_reps_per_exercise}')::numeric,5),
        least(coalesce((v_cfg#>>'{mechanic_defaults,rep_target_max_reps_per_exercise}')::numeric,100),floor((v_target_sec/v_n)/v_spr))
      );
      v_pres:=coalesce(rec.ex->'prescription','{}'::jsonb)||jsonb_build_object(
        'reps_min',v_target_each,'reps_max',v_target_each,'mechanic_overlay',jsonb_build_object('type','rep_target','target_reps',v_target_each));
      v_final_exercises:=v_final_exercises||jsonb_build_array(jsonb_set(rec.ex,'{prescription}',v_pres,true));
      v_active:=v_active+v_target_each*v_spr;
      v_rep_target:=v_rep_target+v_target_each;
      v_transition:=v_transition+coalesce((rec.unit->>'estimated_transition_seconds')::numeric,0);
    end loop;
    v_elapsed:=v_active+v_transition;
    v_exercises:=v_final_exercises;
    v_params:=jsonb_build_object('total_rep_target',round(v_rep_target,0),'allocation','equal_time_weighted_by_exercise_work_rate');

  elsif v_mechanic='CHIPPER' then
    v_max_chipper:=coalesce((v_cfg#>>'{mechanic_defaults,chipper_max_volume_multiplier}')::numeric,3);
    v_scale:=greatest(0.5,least(v_max_chipper,v_target_sec/greatest(1,v_base_round)));
    v_active:=0;v_transition:=0;v_final_exercises:='[]'::jsonb;
    for rec in
      select x.value as ex,u.value as unit,x.ord
      from jsonb_array_elements(v_exercises) with ordinality x(value,ord)
      join jsonb_array_elements(v_units) with ordinality u(value,ord) using(ord)
      order by x.ord
    loop
      v_pres:=coalesce(rec.ex->'prescription','{}'::jsonb);
      if nullif(rec.unit->>'reps_total','') is not null then
        v_reps:=greatest(1,round((rec.unit->>'reps_total')::numeric*v_scale));
        v_pres:=v_pres||jsonb_build_object('reps_min',v_reps,'reps_max',v_reps,'reps_semantics','total');
      elsif nullif(rec.unit->>'distance_meters','') is not null then
        v_pres:=v_pres||jsonb_build_object('distance_meters_min',round((rec.unit->>'distance_meters')::numeric*v_scale),
          'distance_meters_max',round((rec.unit->>'distance_meters')::numeric*v_scale));
      elsif nullif(rec.unit->>'duration_seconds','') is not null then
        v_pres:=v_pres||jsonb_build_object('duration_seconds_min',round((rec.unit->>'duration_seconds')::numeric*v_scale),
          'duration_seconds_max',round((rec.unit->>'duration_seconds')::numeric*v_scale));
      end if;
      v_pres:=v_pres||jsonb_build_object('mechanic_overlay',jsonb_build_object('type','chipper','volume_multiplier',round(v_scale,3),'single_pass',true));
      v_final_exercises:=v_final_exercises||jsonb_build_array(jsonb_set(rec.ex,'{prescription}',v_pres,true));
      v_active:=v_active+coalesce((rec.unit->>'estimated_active_work_seconds')::numeric,0)*v_scale;
      v_transition:=v_transition+coalesce((rec.unit->>'estimated_transition_seconds')::numeric,0);
    end loop;
    v_exercises:=v_final_exercises;v_elapsed:=v_active+v_transition;
    v_params:=jsonb_build_object('single_pass',true,'volume_multiplier',round(v_scale,3),'exercise_order','strict');

  elsif v_mechanic='DECK' then
    v_deck_reps:=coalesce((v_cfg#>>'{mechanic_defaults,deck_reps_per_suit}')::numeric,95);
    v_deck_cards:=coalesce((v_cfg#>>'{mechanic_defaults,deck_cards}')::int,52);
    if v_n<>4 then v_status:='INFEASIBLE';v_reasons:=v_reasons||jsonb_build_array('DECK_STRICT_REQUIRES_4'); end if;
    v_active:=0;v_deck_transition:=0;
    for rec in
      select x.value as ex,u.value as unit,x.ord
      from jsonb_array_elements(v_exercises) with ordinality x(value,ord)
      join jsonb_array_elements(v_units) with ordinality u(value,ord) using(ord)
    loop
      v_reps:=greatest(1,coalesce(nullif(rec.unit->>'reps_total','')::numeric,1));
      v_spr:=greatest(0.2,coalesce((rec.unit->>'estimated_active_work_seconds')::numeric,1)/v_reps);
      v_active:=v_active+v_deck_reps*v_spr;
      v_deck_transition:=v_deck_transition+coalesce((rec.unit->>'estimated_transition_seconds')::numeric,0);
    end loop;
    v_transition:=(v_deck_transition/greatest(1,v_n))*v_deck_cards;
    v_elapsed:=v_active+v_transition;
    if v_elapsed>v_wod_sec then v_status:='INFEASIBLE';v_reasons:=v_reasons||jsonb_build_array('DECK_STRICT_EXCEEDS_WOD_BUDGET'); end if;
    v_params:=jsonb_build_object('cards',v_deck_cards,'suits',4,'reps_per_suit_total',v_deck_reps,
      'card_values','2-10 face value; J/Q/K=10; A=11','shuffle','controlled_random_without_replacement');

  else
    return public.c4_finalize_candidate_v15_base(p_candidate,p_stimulus,p_total_duration_minutes,p_exact_wod_minutes,p_c4_policy_key,p_c3_policy_key);
  end if;

  v_elapsed:=v_elapsed+v_overlay_seconds;
  v_rest:=greatest(v_rest,v_elapsed-v_active-v_transition-v_overlay_seconds);
  if v_elapsed>v_wod_sec*1.05 then v_status:='INFEASIBLE';v_reasons:=v_reasons||jsonb_build_array('FINAL_DURATION_OVERFILLED'); end if;
  v_duration_util:=case when v_wod_sec>0 then v_elapsed/v_wod_sec*100 else 0 end;
  v_density:=case when v_elapsed>0 then least(100,v_active/v_elapsed*100) else 0 end;
  v_duration_fit:=greatest(0,100-abs(v_duration_util-v_target_util)*1.25);
  v_density_fit:=greatest(0,100-abs(v_density-coalesce((p_stimulus#>>'{density,score}')::numeric,50)));
  v_whole_fit:=round(v_density_fit*0.55+v_duration_fit*0.45,2);

  v_params:=v_params||jsonb_build_object('overlays',v_overlays,'overlay_baseline_seconds',round(v_overlay_seconds,2));

  return jsonb_set(p_candidate,'{exercises}',v_exercises,true)||jsonb_build_object(
    'c4_final',jsonb_build_object(
      'version','c4-full-mechanic-v2.0',
      'status',v_status,'feasible',v_status='OK','reasons',v_reasons,
      'mechanic_json',jsonb_build_object(
        'mechanic_key',v_mechanic,'variant_key',nullif(v_variant,''),'parameters',v_params,
        'wod_budget_minutes',v_wod_min,'predicted_elapsed_seconds',round(v_elapsed,2),
        'time_utilization_percent',round(v_duration_util,2),
        'duration_status',case when v_elapsed>v_wod_sec*1.05 then 'OVERFILLED' when v_duration_util<greatest(0,v_target_util-20) then 'UNDERFILLED' else 'OK' end),
      'predicted_volume',jsonb_build_object('active_work_seconds',round(v_active,2)),
      'whole_wod_metrics',jsonb_build_object(
        'density_percent',round(v_density,2),'density_fit',round(v_density_fit,2),
        'local_fatigue_concentration_index',50,'local_fatigue_fit',50,
        'duration_fit',round(v_duration_fit,2),
        'duration_status',case when v_elapsed>v_wod_sec*1.05 then 'OVERFILLED' when v_duration_util<greatest(0,v_target_util-20) then 'UNDERFILLED' else 'OK' end,
        'time_utilization_percent',round(v_duration_util,2),'whole_wod_fit',v_whole_fit,
        'primary_muscle_exposure_ledger','[]'::jsonb)
    )
  );
end;
$$;

-- Restore the canonical function name as a dispatcher.
create or replace function public.c4_finalize_candidate(
  p_candidate jsonb,
  p_stimulus jsonb,
  p_total_duration_minutes integer,
  p_exact_wod_minutes integer default null,
  p_c4_policy_key text default 'c4-final-default',
  p_c3_policy_key text default 'c3-sim-default'
)
returns jsonb
language plpgsql
stable
set search_path=public
as $$
declare v_mechanic text:=upper(coalesce(p_candidate->>'mechanic',''));
begin
  if v_mechanic in ('LADDER','PYRAMID','PROGRESSIVE_INTERVAL','CHIPPER','EVERY_X_MINUTES','REP_TARGET','ODD_EVEN','COUPLET','DECK') then
    return public.c4_finalize_candidate_extended(p_candidate,p_stimulus,p_total_duration_minutes,p_exact_wod_minutes,p_c4_policy_key,p_c3_policy_key);
  end if;
  return public.c4_finalize_candidate_v15_base(p_candidate,p_stimulus,p_total_duration_minutes,p_exact_wod_minutes,p_c4_policy_key,p_c3_policy_key);
end;
$$;
;
