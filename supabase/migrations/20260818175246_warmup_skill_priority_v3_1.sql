do $$
declare
  v_oid oid;
  v_sql text;
  v_old text;
  v_new text;
begin
  select p.oid into v_oid
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.prokind='f' and p.proname='c4_apply_preparation_quality_v3'
  limit 1;
  if v_oid is null then raise exception 'c4_apply_preparation_quality_v3 not found'; end if;
  v_sql:=pg_get_functiondef(v_oid);

  v_old:=$old$for target_rec in
        with raw as (
          select b->>'block_key' target_block,
                 coalesce(ex->>'exercise_id',ex->>'id') target_id,
                 bord,eord
          from jsonb_array_elements(coalesce(r->'blocks','[]'::jsonb)) with ordinality bz(b,bord)
          cross join lateral jsonb_array_elements(coalesce(b->'exercises','[]'::jsonb)) with ordinality ez(ex,eord)
          where b->>'block_key' in ('skill','wod')
        )
        select distinct on (raw.target_id)
               raw.target_id,raw.target_block,e.movement_pattern,e.exercise_family,e.technical_complexity,e.fatigue_score,raw.bord,raw.eord
        from raw join public.exercises e on e.id=raw.target_id
        order by raw.target_id,case when raw.target_block='skill' then 0 else 1 end,raw.bord,raw.eord
      loop$old$;

  v_new:=$new$for target_rec in
        with raw as (
          select b->>'block_key' target_block,
                 coalesce(ex->>'exercise_id',ex->>'id') target_id,
                 bord,eord
          from jsonb_array_elements(coalesce(r->'blocks','[]'::jsonb)) with ordinality bz(b,bord)
          cross join lateral jsonb_array_elements(coalesce(b->'exercises','[]'::jsonb)) with ordinality ez(ex,eord)
          where b->>'block_key' in ('skill','wod')
        ), dedup as (
          select distinct on (raw.target_id)
                 raw.target_id,raw.target_block,e.movement_pattern,e.exercise_family,e.technical_complexity,e.fatigue_score,raw.bord,raw.eord
          from raw join public.exercises e on e.id=raw.target_id
          order by raw.target_id,case when raw.target_block='skill' then 0 else 1 end,raw.bord,raw.eord
        )
        select * from dedup
        order by case when target_block='skill' then 0 else 1 end,
                 coalesce(technical_complexity,0) desc,
                 coalesce(fatigue_score,0) desc,
                 bord,eord,target_id
      loop$new$;

  if position(v_old in v_sql)=0 then raise exception 'target loop fragment not found; refusing blind patch'; end if;
  execute replace(v_sql,v_old,v_new);
end $$;