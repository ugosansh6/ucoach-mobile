alter function public.program_coach_equipment_opportunity_shadow_v1(uuid,date,jsonb,jsonb)
rename to program_coach_equipment_opportunity_shadow_v1_base;

create or replace function public.program_coach_equipment_opportunity_shadow_v1(
  p_user_id uuid,
  p_anchor_date date,
  p_session_context jsonb,
  p_inventory jsonb
)
returns jsonb
language plpgsql
stable
set search_path to 'public'
as $function$
declare
  v jsonb;
  v_items jsonb:='[]'::jsonb;
  v_high_count int:=0;
begin
  v:=public.program_coach_equipment_opportunity_shadow_v1_base(
    p_user_id,p_anchor_date,p_session_context,p_inventory
  );

  if coalesce(v->>'status','')='NOT_ELIGIBLE' then
    return jsonb_set(
      v,'{version}',to_jsonb('equipment-opportunity-shadow-v2-single-exercise'::text),true
    );
  end if;

  with scored as (
    select
      ord,
      x,
      case
        when coalesce(x->>'level','')<>'OPTIONAL' then coalesce(x->>'level','OPTIONAL')
        when coalesce(nullif(x->>'relevant_exercise_count','')::int,0)<>1 then 'OPTIONAL'
        when coalesce(x->>'category','') in ('Bodyweight','Accessoire','Récupération') then 'OPTIONAL'
        when coalesce(nullif(x->>'historical_observation_days','')::int,0)>=2
             and coalesce(nullif(x->>'availability_days','')::int,0)=0
          then 'HIGH_VALUE_NEW'
        when coalesce(nullif(x->>'historical_observation_days','')::int,0)>=4
             and coalesce(nullif(x->>'availability_share','')::numeric,1)<=0.35
          then 'HIGH_VALUE_RARE'
        when coalesce(nullif(x->>'availability_days','')::int,0)>=3
             and coalesce(nullif(x->>'utilization_when_available','')::numeric,1)<=0.34
          then 'MEDIUM_UNDERUSED'
        else 'OPTIONAL'
      end new_level
    from jsonb_array_elements(coalesce(v->'opportunities','[]'::jsonb)) with ordinality q(x,ord)
  ), rebuilt as (
    select
      ord,
      case
        when new_level=coalesce(x->>'level','') then x
        else x||jsonb_build_object(
          'level',new_level,
          'recommended_soft_bias',case new_level
            when 'HIGH_VALUE_NEW' then 0.18
            when 'HIGH_VALUE_RARE' then 0.16
            when 'MEDIUM_UNDERUSED' then 0.08
            else 0.00 end,
          'reason',case new_level
            when 'HIGH_VALUE_NEW' then 'EQUIPMENT_AVAILABLE_TODAY_NOT_SEEN_IN_RECENT_SESSION_DAYS'
            when 'HIGH_VALUE_RARE' then 'EQUIPMENT_RARELY_AVAILABLE_AND_RELEVANT_TODAY'
            when 'MEDIUM_UNDERUSED' then 'EQUIPMENT_OFTEN_AVAILABLE_BUT_RARELY_USED_IN_TRAINING_BLOCKS'
            else 'NO_STRONG_EQUIPMENT_OPPORTUNITY' end,
          'single_relevant_exercise_qualified',new_level in ('HIGH_VALUE_NEW','HIGH_VALUE_RARE','MEDIUM_UNDERUSED')
        )
      end item,
      new_level
    from scored
  )
  select
    coalesce(jsonb_agg(item order by ord),'[]'::jsonb),
    count(*) filter(where new_level in ('HIGH_VALUE_NEW','HIGH_VALUE_RARE'))::int
  into v_items,v_high_count
  from rebuilt;

  v:=jsonb_set(v,'{version}',to_jsonb('equipment-opportunity-shadow-v2-single-exercise'::text),true);
  v:=jsonb_set(v,'{opportunities}',v_items,true);
  v:=jsonb_set(
    v,'{status}',
    to_jsonb(case when v_high_count>0 then 'HIGH_VALUE_EQUIPMENT_OPPORTUNITY' else 'NO_HIGH_VALUE_EQUIPMENT_OPPORTUNITY' end::text),
    true
  );
  v:=jsonb_set(v,'{selection_contract,single_relevant_exercise_can_qualify}','true'::jsonb,true);
  v:=jsonb_set(v,'{selection_contract,single_relevant_exercise_still_requires_active_quality_gate}','true'::jsonb,true);

  return v;
end;
$function$;

comment on function public.program_coach_equipment_opportunity_shadow_v1(uuid,date,jsonb,jsonb)
is 'Equipment Opportunity v2 compatibility entrypoint: a single safe/relevant Skill or WOD exercise may qualify new/rare/underused equipment; active C4 quality and safety gates remain authoritative.';
