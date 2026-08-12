create or replace function public.c4_resolve_numeric_load(
  p_exercise_id text,
  p_inventory jsonb,
  p_load_envelope jsonb
)
returns jsonb
language plpgsql
stable
set search_path to 'public'
as $function$
declare
  r record;
  inv jsonb;
  v_frontier jsonb:='[]'::jsonb;
  v_cap_max numeric;
  v_inv_load numeric;
  v_min numeric;
  v_max numeric;
  v_inc numeric;
  v_candidate numeric;
  v_best numeric:=null;
  v_equipment text:=null;
  v_scope text:=null;
  v_count int:=1;
  v_total numeric:=null;
  v_capability_mode text:=null;
begin
  -- B2.7 live capability format: prefer the repeatable frontier, then fresh.
  if jsonb_typeof(coalesce(p_load_envelope#>'{repeatable,frontier}','null'::jsonb))='array'
     and jsonb_array_length(coalesce(p_load_envelope#>'{repeatable,frontier}','[]'::jsonb))>0 then
    v_frontier:=p_load_envelope#>'{repeatable,frontier}';
    v_capability_mode:='repeatable';
  elsif jsonb_typeof(coalesce(p_load_envelope#>'{fresh,frontier}','null'::jsonb))='array'
     and jsonb_array_length(coalesce(p_load_envelope#>'{fresh,frontier}','[]'::jsonb))>0 then
    v_frontier:=p_load_envelope#>'{fresh,frontier}';
    v_capability_mode:='fresh';
  elsif jsonb_typeof(coalesce(p_load_envelope->'frontier','null'::jsonb))='array' then
    -- Backward compatibility with the pre-B2.7 envelope shape.
    v_frontier:=coalesce(p_load_envelope->'frontier','[]'::jsonb);
    v_capability_mode:='legacy_root';
  end if;

  select max(nullif(x->>'load_kg','')::numeric)
  into v_cap_max
  from jsonb_array_elements(v_frontier) x;

  if v_cap_max is null or v_cap_max<=0 then
    return jsonb_build_object('confirmed',false,'reason','no_confirmed_load_capability');
  end if;

  for r in
    select els.equipment_id,els.load_scope,greatest(1,coalesce(els.expected_implement_count,1)) expected_count,coalesce(els.symmetric_load,false) symmetric_load
    from public.exercise_load_semantics els
    where els.exercise_id=p_exercise_id
  loop
    for inv in
      select value
      from jsonb_array_elements(case when jsonb_typeof(coalesce(p_inventory,'[]'::jsonb))='array' then coalesce(p_inventory,'[]'::jsonb) else '[]'::jsonb end)
    loop
      if inv->>'equipment_id'=r.equipment_id
         and coalesce(nullif(inv->>'quantity','')::int,0)>=r.expected_count
         and coalesce(inv->>'load_confidence','unknown')='confirmed' then

        v_candidate:=null;

        if coalesce(inv->>'inventory_mode','')='adjustable_load' then
          v_min:=nullif(inv->>'min_load_kg','')::numeric;
          v_max:=nullif(inv->>'max_load_kg','')::numeric;
          v_inc:=nullif(inv->>'increment_kg','')::numeric;

          if v_min is not null and v_max is not null and v_min>0 and v_max>=v_min then
            if v_inc is not null and v_inc>0 then
              if least(v_cap_max,v_max)>=v_min then
                v_candidate:=v_min + floor((least(v_cap_max,v_max)-v_min)/v_inc)*v_inc;
              end if;
            else
              v_candidate:=least(v_cap_max,v_max);
            end if;
          end if;
        else
          v_candidate:=nullif(inv->>'load_kg','')::numeric;
        end if;

        if v_candidate is not null
           and v_candidate>0
           and v_candidate<=v_cap_max
           and (v_best is null or v_candidate>v_best) then
          v_best:=v_candidate;
          v_equipment:=r.equipment_id;
          v_scope:=r.load_scope;
          v_count:=r.expected_count;
        end if;
      end if;
    end loop;
  end loop;

  if v_best is null then
    return jsonb_build_object(
      'confirmed',false,
      'reason','no_inventory_load_within_confirmed_capability',
      'capability_max_load_kg',v_cap_max,
      'capability_mode',v_capability_mode
    );
  end if;

  v_total:=case when v_scope='per_implement' then v_best*v_count else v_best end;

  return jsonb_build_object(
    'confirmed',true,
    'load_kg',v_best,
    'load_scope',v_scope,
    'implement_count',v_count,
    'total_external_load_kg',v_total,
    'equipment_id',v_equipment,
    'capability_max_load_kg',v_cap_max,
    'capability_mode',v_capability_mode,
    'source','confirmed_capability_intersect_real_inventory'
  );
end;
$function$;;
