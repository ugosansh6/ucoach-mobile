create or replace function public.c4_resolve_numeric_load(p_exercise_id text,p_inventory jsonb,p_load_envelope jsonb)
returns jsonb
language plpgsql
stable
set search_path to 'public'
as $function$
declare
  r record;
  inv jsonb;
  v_cap_max numeric;
  v_candidate numeric;
  v_min numeric;
  v_max numeric;
  v_inc numeric;
  v_fixed numeric;
  v_mode text;
  v_best numeric:=null;
  v_equipment text:=null;
  v_scope text:=null;
  v_count int:=1;
  v_total numeric:=null;
begin
  select max(nullif(x->>'load_kg','')::numeric)
  into v_cap_max
  from jsonb_array_elements(case when jsonb_typeof(coalesce(p_load_envelope->'frontier','[]'::jsonb))='array' then coalesce(p_load_envelope->'frontier','[]'::jsonb) else '[]'::jsonb end) x;

  if v_cap_max is null or v_cap_max<=0 then
    return jsonb_build_object('confirmed',false,'reason','no_confirmed_load_capability');
  end if;

  for r in
    select els.equipment_id,els.load_scope,greatest(1,coalesce(els.expected_implement_count,1)) expected_count
    from public.exercise_load_semantics els
    where els.exercise_id=p_exercise_id
  loop
    for inv in
      select value from jsonb_array_elements(case when jsonb_typeof(coalesce(p_inventory,'[]'::jsonb))='array' then coalesce(p_inventory,'[]'::jsonb) else '[]'::jsonb end)
    loop
      continue when inv->>'equipment_id' is distinct from r.equipment_id;
      continue when coalesce(nullif(inv->>'quantity','')::int,0)<r.expected_count;
      continue when coalesce(inv->>'load_confidence','unknown')<>'confirmed';

      v_mode:=coalesce(inv->>'inventory_mode',case when nullif(inv->>'load_kg','') is not null then 'fixed_load' when nullif(inv->>'max_load_kg','') is not null then 'adjustable_load' else 'load_unknown' end);
      v_candidate:=null;

      if v_mode='fixed_load' then
        v_fixed:=nullif(inv->>'load_kg','')::numeric;
        if v_fixed is not null and v_fixed>0 and v_fixed<=v_cap_max then v_candidate:=v_fixed; end if;
      elsif v_mode='adjustable_load' then
        v_min:=coalesce(nullif(inv->>'min_load_kg','')::numeric,0);
        v_max:=nullif(inv->>'max_load_kg','')::numeric;
        v_inc:=nullif(inv->>'increment_kg','')::numeric;
        if v_max is not null and v_max>0 and v_inc is not null and v_inc>0 and v_cap_max>=v_min then
          v_candidate:=least(v_cap_max,v_max);
          v_candidate:=v_min + floor((v_candidate-v_min)/v_inc)*v_inc;
          if v_candidate<=0 or v_candidate<v_min or v_candidate>v_max or v_candidate>v_cap_max then v_candidate:=null; end if;
        end if;
      else
        v_fixed:=nullif(inv->>'load_kg','')::numeric;
        if v_fixed is not null and v_fixed>0 and v_fixed<=v_cap_max then v_candidate:=v_fixed; end if;
      end if;

      if v_candidate is not null and (v_best is null or v_candidate>v_best) then
        v_best:=v_candidate;v_equipment:=r.equipment_id;v_scope:=r.load_scope;v_count:=r.expected_count;
      end if;
    end loop;
  end loop;

  if v_best is null then
    return jsonb_build_object('confirmed',false,'reason','no_inventory_load_within_confirmed_capability','capability_max_load_kg',v_cap_max);
  end if;

  v_total:=case when v_scope='per_implement' then v_best*v_count else v_best end;
  return jsonb_build_object(
    'confirmed',true,'load_kg',v_best,'load_scope',v_scope,'implement_count',v_count,
    'total_external_load_kg',v_total,'equipment_id',v_equipment,'capability_max_load_kg',v_cap_max,
    'source','confirmed_capability_intersect_real_inventory'
  );
end;
$function$;

revoke all on function public.c4_resolve_numeric_load(text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.c4_resolve_numeric_load(text,jsonb,jsonb) to service_role;;
