do $migration$
declare
  v_def text;
  v_start int;
  v_end int;
  v_new text;
  v_replacement text := $replacement$
  -- Tabata freshness: keep the newly generated Tabata. A recalculation must not restore
  -- the parent's exact Core pair. Presentation freshness is handled by
  -- c4_tabata_variety_penalty_v2; completed sessions remain the training-evidence source.
  select count(*)::int
  into v_tabata_preserved
  from public.workout_session_exercises p
  join public.workout_session_exercises n
    on n.session_id=p_new_session_id
   and n.block_key='tabata'
   and n.exercise_id=p.exercise_id
  where p.session_id=p_parent_session_id
    and p.block_key='tabata';

$replacement$;
begin
  select pg_get_functiondef(p.oid)
  into v_def
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname='c4_preserve_recalculation_continuity_v1'
  limit 1;

  if v_def is null then
    raise exception 'c4_preserve_recalculation_continuity_v1 not found';
  end if;

  v_start:=strpos(v_def,'  -- Tabata is context-light: preserve exact exercises only when the normal hard gates still accept them.');
  v_end:=strpos(v_def,'  -- Unlock continuity is kept only when the old mobility drill still matches the new region and safety context.');

  if v_start=0 or v_end=0 or v_end<=v_start then
    raise exception 'Unexpected continuity function shape; refusing unsafe patch';
  end if;

  v_new:=substr(v_def,1,v_start-1)||v_replacement||substr(v_def,v_end);
  execute v_new;
end
$migration$;
