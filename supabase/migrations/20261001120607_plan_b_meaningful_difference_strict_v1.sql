
-- Tighten whole-session difference semantics:
-- * duration-only changes are not "architecture"
-- * environment changes never qualify as a valid Plan B difference

create or replace function public.ugerod_session_plan_signature_v1(
  p_session_id uuid
)
returns jsonb
language plpgsql
stable
set search_path to 'public'
as $$
declare
  v_session public.workout_sessions%rowtype;
  v_architecture jsonb := '[]'::jsonb;
  v_block_mechanics jsonb := '[]'::jsonb;
  v_main_content jsonb := '{}'::jsonb;
  v_format text;
  v_style text;
  v_mechanic text;
begin
  select * into v_session
  from public.workout_sessions
  where id=p_session_id;

  if not found then
    return jsonb_build_object(
      'status','SESSION_NOT_FOUND',
      'session_id',p_session_id
    );
  end if;

  select
    coalesce(
      jsonb_agg(lower(coalesce(b->>'block_key','')) order by ord),
      '[]'::jsonb
    ),
    coalesce(
      jsonb_agg(
        upper(coalesce(
          nullif(b->>'mechanic',''),
          nullif(b#>>'{mechanic_json,mechanic_key}',''),
          nullif(b->>'block_mechanic',''),
          ''
        ))
        order by ord
      ),
      '[]'::jsonb
    )
  into v_architecture,v_block_mechanics
  from jsonb_array_elements(coalesce(v_session.generated_workout->'blocks','[]'::jsonb))
       with ordinality z(b,ord);

  select coalesce(
    jsonb_object_agg(block_key,exercise_ids),
    '{}'::jsonb
  )
  into v_main_content
  from (
    select
      lower(coalesce(b->>'block_key','')) as block_key,
      coalesce((
        select jsonb_agg(coalesce(nullif(e->>'exercise_id',''),nullif(e->>'id','')) order by eord)
        from jsonb_array_elements(coalesce(b->'exercises','[]'::jsonb))
             with ordinality ex(e,eord)
        where coalesce(nullif(e->>'exercise_id',''),nullif(e->>'id','')) is not null
      ),'[]'::jsonb) as exercise_ids
    from jsonb_array_elements(coalesce(v_session.generated_workout->'blocks','[]'::jsonb)) b
    where lower(coalesce(b->>'block_key','')) not in (
      'unlock','warmup','warm_up','tabata','mobility'
    )
  ) q;

  v_format := upper(coalesce(
    nullif(v_session.generated_workout#>>'{meta,format_code}',''),
    nullif(v_session.generated_workout->>'format_code',''),
    nullif(v_session.planning_context_json->>'format_code',''),
    nullif(v_session.mechanic_json->>'format_code',''),
    ''
  ));

  v_style := upper(coalesce(
    nullif(v_session.generated_workout#>>'{meta,execution_style,style_code}',''),
    nullif(v_session.generated_workout#>>'{execution_style,style_code}',''),
    nullif(v_session.planning_context_json#>>'{execution_style,style_code}',''),
    nullif(v_session.mechanic_json->>'execution_style',''),
    ''
  ));

  v_mechanic := upper(coalesce(
    nullif(v_session.mechanic_json->>'mechanic_key',''),
    ''
  ));

  return jsonb_build_object(
    'status','OK',
    'version','session-plan-signature-v1.1',
    'session_id',p_session_id,
    'environment_code',upper(coalesce(v_session.planned_environment_code,'')),
    'target_region',v_session.target_region,
    'format_code',nullif(v_format,''),
    'execution_style',nullif(v_style,''),
    'mechanic_key',nullif(v_mechanic,''),
    'architecture',v_architecture,
    'block_mechanics',v_block_mechanics,
    'main_content',v_main_content
  );
end;
$$;

create or replace function public.ugerod_session_plan_difference_v1(
  p_old_session_id uuid,
  p_new_session_id uuid
)
returns jsonb
language plpgsql
stable
set search_path to 'public'
as $$
declare
  v_old jsonb := public.ugerod_session_plan_signature_v1(p_old_session_id);
  v_new jsonb := public.ugerod_session_plan_signature_v1(p_new_session_id);
  v_environment_changed boolean;
  v_architecture_changed boolean;
  v_format_changed boolean;
  v_style_changed boolean;
  v_mechanic_changed boolean;
  v_block_mechanics_changed boolean;
  v_changed_main_blocks int := 0;
  v_main_block_count int := 0;
  v_main_content_significant boolean := false;
  v_meaningful boolean := false;
  v_key text;
  v_old_block jsonb;
  v_new_block jsonb;
begin
  if coalesce(v_old->>'status','')<>'OK'
     or coalesce(v_new->>'status','')<>'OK' then
    return jsonb_build_object(
      'status','SIGNATURE_UNAVAILABLE',
      'version','session-plan-difference-v1.1',
      'meaningfully_different',false,
      'old_signature',v_old,
      'new_signature',v_new
    );
  end if;

  v_environment_changed := (v_old->>'environment_code') is distinct from (v_new->>'environment_code');
  v_architecture_changed := (v_old->'architecture') is distinct from (v_new->'architecture');
  v_format_changed := (v_old->>'format_code') is distinct from (v_new->>'format_code');
  v_style_changed := (v_old->>'execution_style') is distinct from (v_new->>'execution_style');
  v_mechanic_changed := (v_old->>'mechanic_key') is distinct from (v_new->>'mechanic_key');
  v_block_mechanics_changed := (v_old->'block_mechanics') is distinct from (v_new->'block_mechanics');

  for v_key in
    select key
    from (
      select jsonb_object_keys(coalesce(v_old->'main_content','{}'::jsonb)) as key
      union
      select jsonb_object_keys(coalesce(v_new->'main_content','{}'::jsonb)) as key
    ) keys
  loop
    v_main_block_count := v_main_block_count + 1;
    v_old_block := coalesce(v_old#>array['main_content',v_key],'[]'::jsonb);
    v_new_block := coalesce(v_new#>array['main_content',v_key],'[]'::jsonb);

    if v_old_block is distinct from v_new_block then
      v_changed_main_blocks := v_changed_main_blocks + 1;
    end if;
  end loop;

  v_main_content_significant :=
    v_changed_main_blocks >= 2
    or (v_main_block_count = 1 and v_changed_main_blocks = 1);

  v_meaningful :=
    not v_environment_changed
    and (
      v_architecture_changed
      or v_format_changed
      or v_style_changed
      or v_mechanic_changed
      or v_block_mechanics_changed
      or v_main_content_significant
    );

  return jsonb_build_object(
    'status','OK',
    'version','session-plan-difference-v1.1',
    'old_session_id',p_old_session_id,
    'new_session_id',p_new_session_id,
    'environment_changed',v_environment_changed,
    'architecture_changed',v_architecture_changed,
    'format_changed',v_format_changed,
    'execution_style_changed',v_style_changed,
    'mechanic_changed',v_mechanic_changed,
    'block_mechanics_changed',v_block_mechanics_changed,
    'changed_main_blocks',v_changed_main_blocks,
    'main_block_count',v_main_block_count,
    'main_content_significant',v_main_content_significant,
    'meaningfully_different',v_meaningful,
    'old_signature',v_old,
    'new_signature',v_new
  );
end;
$$;
