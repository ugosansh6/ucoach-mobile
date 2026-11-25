do $$
declare
  v_oid oid;
  v_sql text;
  v_old text;
  v_new text;
begin
  select p.oid into v_oid
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname='c4_apply_session_architecture_v2'
    and p.prokind='f'
  limit 1;

  if v_oid is null then
    raise exception 'c4_apply_session_architecture_v2 not found';
  end if;

  v_sql:=pg_get_functiondef(v_oid);
  v_old:='||jsonb_build_object(''block_role'',''tabata'',''protocol'',jsonb_build_object(''rounds'',8,''work_seconds'',20,''rest_seconds'',10,''rotation'',''alternate_exercises''),''core_daily_training'',true);';
  v_new:='||jsonb_build_object(''block_role'',''tabata'',''protocol'',jsonb_build_object(''rounds'',8,''work_seconds'',20,''rest_seconds'',10,''rotation'',''alternate_exercises''),''core_daily_training'',true,''tabata_side_switch'',lower(coalesce(rec.movement_side,''''))=''unilateral'',''text'',case when lower(coalesce(rec.movement_side,''''))=''unilateral'' then ''20s travail · change de côté à chaque passage'' else null end);';

  if position(v_old in v_sql)=0 then
    raise exception 'Tabata prescription fragment not found; refusing blind patch';
  end if;

  v_sql:=replace(v_sql,v_old,v_new);
  execute v_sql;
end $$;

create or replace function public.ugerod_apply_tabata_side_cues_v1(p_workout jsonb)
returns jsonb
language plpgsql
stable
set search_path='public'
as $$
declare
  v_result jsonb:=coalesce(p_workout,'{}'::jsonb);
  v_blocks jsonb;
begin
  if jsonb_typeof(v_result)<>'object' or jsonb_typeof(v_result->'blocks')<>'array' then
    return v_result;
  end if;

  select coalesce(jsonb_agg(
    case when b->>'block_key'='tabata' and jsonb_typeof(b->'exercises')='array' then
      jsonb_set(b,'{exercises}',coalesce((
        select jsonb_agg(
          case when lower(coalesce(e.movement_side,''))='unilateral' then
            jsonb_set(
              ex,
              '{prescription}',
              coalesce(ex->'prescription','{}'::jsonb)||jsonb_build_object(
                'tabata_side_switch',true,
                'text','20s travail · change de côté à chaque passage'
              ),
              true
            )
          else ex end
          order by eord
        )
        from jsonb_array_elements(b->'exercises') with ordinality x(ex,eord)
        left join public.exercises e on e.id=coalesce(ex->>'exercise_id',ex->>'id')
      ),'[]'::jsonb),true)
    else b end
    order by bord
  ),'[]'::jsonb)
  into v_blocks
  from jsonb_array_elements(v_result->'blocks') with ordinality z(b,bord);

  return jsonb_set(v_result,'{blocks}',v_blocks,true);
end;
$$;

update public.workout_session_exercises wse
set prescription_json=coalesce(wse.prescription_json,'{}'::jsonb)||jsonb_build_object(
      'tabata_side_switch',true,
      'text','20s travail · change de côté à chaque passage'
    ),
    prescription='20s travail · change de côté à chaque passage',
    updated_at=wse.updated_at
from public.exercises e
join public.workout_sessions ws on true
where e.id=wse.exercise_id
  and ws.id=wse.session_id
  and wse.block_key='tabata'
  and lower(coalesce(e.movement_side,''))='unilateral'
  and ws.status in ('generated','in_progress');

update public.workout_sessions
set generated_workout=public.ugerod_apply_tabata_side_cues_v1(generated_workout),
    updated_at=updated_at
where status in ('generated','in_progress')
  and generated_workout is not null;