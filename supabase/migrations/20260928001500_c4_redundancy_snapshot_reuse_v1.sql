-- PERF-008: compute anti-redundancy memory once per generation.
-- Validated before release on 8 real candidate plans: score payloads were exactly equal.

create or replace function public.c4_redundancy_snapshot_v1(
  p_user_id uuid,
  p_policy_key text default 'c4-final-default'
) returns jsonb
language plpgsql
stable
set search_path to 'public'
as $function$
declare
  v_cfg jsonb;
  v_recent int;
  v_recent_json jsonb:='[]'::jsonb;
  v_ex_json jsonb:='[]'::jsonb;
begin
  select config into v_cfg
  from public.session_engine_policy
  where policy_key=p_policy_key;

  if v_cfg is null then
    raise exception 'Unknown C4 policy %',p_policy_key;
  end if;

  v_recent:=greatest(
    1,
    least(
      coalesce((v_cfg#>>'{anti_redundancy,recent_sessions}')::int,5),
      8
    )
  );

  with completed0 as materialized (
    select
      ws.id,
      row_number() over(
        order by coalesce(ws.completed_at,ws.generated_at,ws.created_at) desc
      ) rn,
      upper(coalesce(
        ws.mechanic_json->>'mechanic_key',
        ws.mechanic_json->>'mechanic',
        ''
      )) mechanic,
      upper(coalesce(ws.mechanic_json->>'variant_key','')) variant_key,
      (
        select count(*)
        from public.workout_session_exercises z
        where z.session_id=ws.id
          and z.block_key='wod'
      ) exercise_count,
      'completed'::text memory_type
    from public.workout_sessions ws
    where ws.user_id=p_user_id
      and ws.status='completed'
      and public.session_counts_as_training_v1(ws.id)
    order by coalesce(ws.completed_at,ws.generated_at,ws.created_at) desc
    limit v_recent
  ),
  presented0 as materialized (
    select
      ws.id,
      row_number() over(
        order by coalesce(ws.generated_at,ws.created_at) desc
      ) rn,
      upper(coalesce(
        ws.mechanic_json->>'mechanic_key',
        ws.mechanic_json->>'mechanic',
        ''
      )) mechanic,
      upper(coalesce(ws.mechanic_json->>'variant_key','')) variant_key,
      (
        select count(*)
        from public.workout_session_exercises z
        where z.session_id=ws.id
          and z.block_key='wod'
      ) exercise_count,
      'presented_only'::text memory_type
    from public.workout_sessions ws
    where ws.user_id=p_user_id
      and ws.status in ('generated','in_progress','abandoned')
      and ws.generated_workout is not null
      and jsonb_array_length(
        coalesce(ws.generated_workout->'blocks','[]'::jsonb)
      )>0
      and not (
        ws.status='abandoned'
        and coalesce(
          ws.generation_local_date,
          ws.created_at::date
        )=current_date
        and coalesce(
          ws.planning_context_json#>>'{daily_refresh,reason}',
          ''
        ) in (
          'prestart_safety_refresh',
          'forced_recalculate_started_session'
        )
      )
    order by coalesce(ws.generated_at,ws.created_at) desc
    limit 3
  ),
  recent as materialized (
    select
      c.*,
      coalesce(
        nullif(
          v_cfg#>>array[
            'anti_redundancy',
            'recency_weights',
            (c.rn-1)::text
          ],
          ''
        )::numeric,
        case c.rn
          when 1 then 1.0
          when 2 then 0.75
          when 3 then 0.5
          when 4 then 0.3
          else 0.15
        end
      ) weight
    from completed0 c

    union all

    select
      p.*,
      case p.rn
        when 1 then 0.45
        when 2 then 0.30
        else 0.15
      end weight
    from presented0 p
  ),
  recent_ex as materialized (
    select
      r.rn,
      r.weight,
      r.memory_type,
      wse.exercise_id,
      e.exercise_family,
      e.movement_pattern
    from recent r
    join public.workout_session_exercises wse
      on wse.session_id=r.id
      and wse.block_key='wod'
    join public.exercises e
      on e.id=wse.exercise_id
  )
  select
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'rn',rn,
          'mechanic',mechanic,
          'variant_key',variant_key,
          'exercise_count',exercise_count,
          'memory_type',memory_type,
          'weight',weight
        )
        order by memory_type,rn
      )
      from recent
    ),'[]'::jsonb),
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'rn',rn,
          'weight',weight,
          'memory_type',memory_type,
          'exercise_id',exercise_id,
          'exercise_family',exercise_family,
          'movement_pattern',movement_pattern
        )
      )
      from recent_ex
    ),'[]'::jsonb)
  into v_recent_json,v_ex_json;

  return jsonb_build_object(
    'version','c4-redundancy-snapshot-v1',
    'recent_session_limit',v_recent,
    'exact_non_anchor_penalty',
      coalesce(
        (v_cfg#>>'{anti_redundancy,exact_non_anchor_penalty}')::numeric,
        45
      ),
    'family_penalty',
      coalesce((v_cfg#>>'{anti_redundancy,family_penalty}')::numeric,25),
    'pattern_penalty',
      coalesce((v_cfg#>>'{anti_redundancy,pattern_penalty}')::numeric,15),
    'mechanic_penalty',
      coalesce((v_cfg#>>'{anti_redundancy,mechanic_penalty}')::numeric,10),
    'structure_penalty',
      coalesce((v_cfg#>>'{anti_redundancy,structure_penalty}')::numeric,12),
    'recency_weights',
      coalesce(
        v_cfg#>'{anti_redundancy,recency_weights}',
        '[1.0,0.75,0.5,0.3,0.15]'::jsonb
      ),
    'recent',v_recent_json,
    'recent_exercises',v_ex_json
  );
end;
$function$;

create or replace function public.c4_redundancy_score_from_snapshot_v1(
  p_candidate jsonb,
  p_snapshot jsonb
) returns jsonb
language plpgsql
stable
set search_path to 'public'
as $function$
declare
  v_exact_pen numeric:=coalesce((p_snapshot->>'exact_non_anchor_penalty')::numeric,45);
  v_family_pen numeric:=coalesce((p_snapshot->>'family_penalty')::numeric,25);
  v_pattern_pen numeric:=coalesce((p_snapshot->>'pattern_penalty')::numeric,15);
  v_mechanic_pen numeric:=coalesce((p_snapshot->>'mechanic_penalty')::numeric,10);
  v_structure_pen numeric:=coalesce((p_snapshot->>'structure_penalty')::numeric,12);
  v_exact_pressure numeric:=0;
  v_family_pressure numeric:=0;
  v_pattern_pressure numeric:=0;
  v_mechanic_pressure numeric:=0;
  v_structure_pressure numeric:=0;
  v_score numeric:=100;
  v_recent_count int:=0;
  v_completed_count int:=0;
  v_presented_count int:=0;
  v_mechanic text:=upper(coalesce(
    p_candidate->>'mechanic',
    p_candidate#>>'{c4_final,mechanic_json,mechanic_key}',
    ''
  ));
  v_variant text:=upper(coalesce(
    p_candidate->>'variant_key',
    p_candidate#>>'{c4_final,mechanic_json,variant_key}',
    ''
  ));
  v_count int:=jsonb_array_length(
    coalesce(p_candidate->'exercises','[]'::jsonb)
  );
  v_structure text;
begin
  v_structure:=
    v_mechanic||':'||
    coalesce(nullif(v_variant,''),'BASE')||':'||
    v_count::text;

  with recent as (
    select *
    from jsonb_to_recordset(
      coalesce(p_snapshot->'recent','[]'::jsonb)
    ) as r(
      rn bigint,
      mechanic text,
      variant_key text,
      exercise_count bigint,
      memory_type text,
      weight numeric
    )
  ),
  recent_ex as (
    select *
    from jsonb_to_recordset(
      coalesce(p_snapshot->'recent_exercises','[]'::jsonb)
    ) as r(
      rn bigint,
      weight numeric,
      memory_type text,
      exercise_id text,
      exercise_family text,
      movement_pattern text
    )
  ),
  cand as (
    select
      e.id,
      e.exercise_family,
      e.movement_pattern,
      e.movement_pattern in ('Conditioning','Locomotion') anchor
    from jsonb_array_elements(
      coalesce(p_candidate->'exercises','[]'::jsonb)
    ) x
    join public.exercises e
      on e.id=x->>'exercise_id'
  ),
  exact_values as (
    select c.id,coalesce(max(re.weight),0) pressure
    from cand c
    left join recent_ex re
      on re.exercise_id=c.id
    where not c.anchor
    group by c.id
  ),
  family_values as (
    select c.exercise_family,coalesce(max(re.weight),0) pressure
    from (
      select distinct exercise_family
      from cand
      where exercise_family is not null
    ) c
    left join recent_ex re
      on re.exercise_family=c.exercise_family
    group by c.exercise_family
  ),
  pattern_values as (
    select c.movement_pattern,coalesce(max(re.weight),0) pressure
    from (
      select distinct movement_pattern
      from cand
      where movement_pattern is not null
    ) c
    left join recent_ex re
      on re.movement_pattern=c.movement_pattern
    group by c.movement_pattern
  )
  select
    (select count(*) from recent),
    (select count(*) from recent where memory_type='completed'),
    (select count(*) from recent where memory_type='presented_only'),
    coalesce((select avg(pressure) from exact_values),0),
    coalesce((select avg(pressure) from family_values),0),
    coalesce((select avg(pressure) from pattern_values),0),
    coalesce((
      select max(weight)
      from recent
      where mechanic=v_mechanic
    ),0),
    coalesce((
      select max(weight)
      from recent
      where (
        mechanic||':'||
        coalesce(nullif(variant_key,''),'BASE')||':'||
        exercise_count::text
      )=v_structure
    ),0)
  into
    v_recent_count,
    v_completed_count,
    v_presented_count,
    v_exact_pressure,
    v_family_pressure,
    v_pattern_pressure,
    v_mechanic_pressure,
    v_structure_pressure;

  if v_recent_count>0 then
    v_score:=greatest(
      0,
      least(
        100,
        100
          -v_exact_pressure*v_exact_pen
          -v_family_pressure*v_family_pen
          -v_pattern_pressure*v_pattern_pen
          -v_mechanic_pressure*v_mechanic_pen
          -v_structure_pressure*v_structure_pen
      )
    );
  end if;

  return jsonb_build_object(
    'score',round(v_score,2),
    'recent_sessions_considered',v_recent_count,
    'completed_sessions_considered',v_completed_count,
    'presented_only_sessions_considered',v_presented_count,
    'presented_only_latest_weight',0.45,
    'presented_only_is_soft_memory',true,
    'new_checkin_replaced_session_is_soft_memory',true,
    'exact_non_anchor_overlap_ratio',round(v_exact_pressure,3),
    'family_overlap_ratio',round(v_family_pressure,3),
    'pattern_overlap_ratio',round(v_pattern_pressure,3),
    'mechanic_overlap_ratio',round(v_mechanic_pressure,3),
    'structure_overlap_ratio',round(v_structure_pressure,3),
    'candidate_structure_signature',v_structure,
    'anchor_exact_repeat_exempt',true,
    'recency_weighted',true,
    'recent_session_limit',
      coalesce((p_snapshot->>'recent_session_limit')::int,5),
    'recency_weights',
      coalesce(
        p_snapshot->'recency_weights',
        '[1.0,0.75,0.5,0.3,0.15]'::jsonb
      ),
    'mechanic_structure_is_soft_tiebreaker',true,
    'presented_memory_does_not_create_training_evidence',true,
    'version','c4-redundancy-v5-new-checkin-soft-memory'
  );
end;
$function$;

-- Preserve the old engine for read-only A/B verification.
alter function public.solve_session_engine_c4_raw_v15(
  uuid,text,integer,text,text,text,text[],jsonb,integer,text,integer,integer,text
)
rename to solve_session_engine_c4_raw_v15_pre_perf008;

do $do$
declare
  v_def text;
  v_before text;
begin
  select pg_get_functiondef(p.oid)
  into v_def
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname='solve_session_engine_c4_raw_v15_pre_perf008';

  if v_def is null then
    raise exception 'PERF-008 source engine not found';
  end if;

  v_def:=replace(
    v_def,
    'FUNCTION public.solve_session_engine_c4_raw_v15_pre_perf008',
    'FUNCTION public.solve_session_engine_c4_raw_v15'
  );

  v_before:=v_def;
  v_def:=replace(
    v_def,
    'v_shared_pool jsonb:=''[]''::jsonb;',
    'v_shared_pool jsonb:=''[]''::jsonb; v_red_snapshot jsonb;'
  );
  if v_def=v_before then
    raise exception 'PERF-008 declaration patch failed';
  end if;

  v_before:=v_def;
  v_def:=replace(
    v_def,
    'for v_candidate in select value from jsonb_array_elements',
    'v_red_snapshot:=public.c4_redundancy_snapshot_v1(p_user_id,p_policy_key); for v_candidate in select value from jsonb_array_elements'
  );
  if v_def=v_before then
    raise exception 'PERF-008 snapshot insertion failed';
  end if;

  v_before:=v_def;
  v_def:=replace(
    v_def,
    'v_red:=public.c4_redundancy_score(p_user_id,v_final,p_policy_key);',
    'v_red:=public.c4_redundancy_score_from_snapshot_v1(v_final,v_red_snapshot);'
  );
  if v_def=v_before then
    raise exception 'PERF-008 scorer patch failed';
  end if;

  execute v_def;
end;
$do$;

revoke all on function public.solve_session_engine_c4_raw_v15_pre_perf008(
  uuid,text,integer,text,text,text,text[],jsonb,integer,text,integer,integer,text
) from public;
revoke all on function public.solve_session_engine_c4_raw_v15_pre_perf008(
  uuid,text,integer,text,text,text,text[],jsonb,integer,text,integer,integer,text
) from anon;
revoke all on function public.solve_session_engine_c4_raw_v15_pre_perf008(
  uuid,text,integer,text,text,text,text[],jsonb,integer,text,integer,integer,text
) from authenticated;
