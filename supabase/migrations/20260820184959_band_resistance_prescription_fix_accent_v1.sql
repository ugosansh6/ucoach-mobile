create or replace function public.c2_band_resistance_prescription_v1(
  p_exercise_id text,
  p_inventory jsonb,
  p_readiness text default 'normal',
  p_progression_intent text default null,
  p_mechanic_key text default null
) returns jsonb
language plpgsql stable set search_path to 'public'
as $function$
declare
  v_semantics text;
  v_labels text[]:='{}'::text[];
  v_target text:='medium';
  v_selected text:=null;
  v_intent text:=upper(coalesce(p_progression_intent,''));
  v_readiness text:=public.normalize_session_readiness(coalesce(p_readiness,'normal'));
begin
  select semantics into v_semantics from public.exercise_band_resistance_profiles where exercise_id=p_exercise_id;
  if v_semantics is null then return '{}'::jsonb; end if;

  select coalesce(array_agg(distinct case
    when lower(coalesce(x->>'resistance_label','')) like 'lég%' or lower(coalesce(x->>'resistance_label','')) like 'leg%' then 'light'
    when lower(coalesce(x->>'resistance_label','')) like 'moy%' then 'medium'
    when lower(coalesce(x->>'resistance_label','')) like 'fort%' then 'strong'
    else null end) filter(where coalesce(x->>'equipment_id','')='E05'),'{}'::text[])
  into v_labels
  from jsonb_array_elements(case when jsonb_typeof(coalesce(p_inventory,'[]'::jsonb))='array' then p_inventory else '[]'::jsonb end) x;
  v_labels:=array_remove(v_labels,null);
  if cardinality(v_labels)=0 then return '{}'::jsonb; end if;

  if v_readiness='low' or v_intent='DELOAD' then
    v_target:=case when v_semantics='assistance' then 'strong' else 'light' end;
  elsif v_intent='PROGRESS' then
    v_target:=case when v_semantics='assistance' then 'light' else 'strong' end;
  else
    v_target:='medium';
  end if;

  if v_target=any(v_labels) then
    v_selected:=v_target;
  elsif v_semantics='assistance' then
    v_selected:=case
      when v_target='light' and 'medium'=any(v_labels) then 'medium'
      when v_target='light' and 'strong'=any(v_labels) then 'strong'
      when v_target='medium' and 'strong'=any(v_labels) then 'strong'
      when v_target='medium' and 'light'=any(v_labels) then 'light'
      when v_target='strong' and 'medium'=any(v_labels) then 'medium'
      when v_target='strong' and 'light'=any(v_labels) then 'light'
      else v_labels[1] end;
  else
    v_selected:=case
      when v_target='strong' and 'medium'=any(v_labels) then 'medium'
      when v_target='strong' and 'light'=any(v_labels) then 'light'
      when v_target='medium' and 'light'=any(v_labels) then 'light'
      when v_target='medium' and 'strong'=any(v_labels) then 'strong'
      when v_target='light' and 'medium'=any(v_labels) then 'medium'
      when v_target='light' and 'strong'=any(v_labels) then 'strong'
      else v_labels[1] end;
  end if;

  return jsonb_build_object(
    'band_resistance_level',v_selected,
    'band_resistance_label',case v_selected when 'light' then 'Légère' when 'medium' then 'Moyenne' when 'strong' then 'Forte' else v_selected end,
    'band_resistance_semantics',v_semantics,
    'band_resistance_source','user_inventory',
    'band_resistance_contract','band-resistance-v1',
    'band_resistance_available_levels',to_jsonb(v_labels)
  );
end;
$function$;
