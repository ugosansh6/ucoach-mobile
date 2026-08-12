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
  v_result jsonb;
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
      v_start:=coalesce(nullif(v_overlay->>'start_reps','')::int,nullif(v_pres->>'reps_min','')::int,(v_cfg#>>'{mechanic_defaults,ladder_start_reps}')::int,2);
      v_start:=greatest(1,least(v_start,12));
      v_inc:=coalesce(nullif(v_overlay->>'increment_reps','')::int,case when v_start>=8 then 1 else coalesce((v_cfg#>>'{mechanic_defaults,ladder_increment_reps}')::int,2) end);
      v_pres:=v_pres||jsonb_build_object('mechanic_overlay',jsonb_build_object('type','ascending_ladder','start_reps',v_start,'increment_reps',greatest(1,v_inc),'exercise_position',v_index));
    elsif v_mechanic='PYRAMID' then
      v_start:=coalesce(nullif(v_overlay->>'base_reps','')::int,nullif(v_pres->>'reps_min','')::int,(v_cfg#>>'{mechanic_defaults,pyramid_base_reps}')::int,4);
      v_start:=greatest(1,least(v_start,12));
      v_pres:=v_pres||jsonb_build_object('mechanic_overlay',jsonb_build_object('type','pyramid','base_reps',v_start,'multipliers',coalesce(v_cfg#>'{mechanic_defaults,pyramid_multipliers}','[1,2,3,2,1]'::jsonb),'exercise_position',v_index));
    elsif v_mechanic='PROGRESSIVE_INTERVAL' then
      v_start:=coalesce(nullif(v_overlay->>'start_reps','')::int,nullif(v_pres->>'reps_min','')::int,(v_cfg#>>'{mechanic_defaults,progressive_start_reps}')::int,3);
      v_start:=greatest(1,least(v_start,15));
      v_inc:=coalesce(nullif(v_overlay->>'increment_reps','')::int,(v_cfg#>>'{mechanic_defaults,progressive_increment_reps}')::int,1);
      v_pres:=v_pres||jsonb_build_object('mechanic_overlay',jsonb_build_object('type',lower(case when v_variant in ('DEATH_BY','DEATH_BY_COUPLET') then v_variant else 'PROGRESSIVE_GENERIC' end),'start_reps',v_start,'increment_reps',greatest(1,v_inc),'interval_seconds',coalesce((v_cfg#>>'{mechanic_defaults,progressive_interval_seconds}')::int,60),'exercise_position',v_index));
    elsif v_mechanic='COUPLET' then
      v_start:=coalesce(nullif(v_overlay->>'start_reps','')::int,nullif(v_pres->>'reps_min','')::int,3);
      v_start:=greatest(1,least(v_start,15));
      v_inc:=coalesce(nullif(v_overlay->>'increment_reps','')::int,2);
      v_pres:=v_pres||jsonb_build_object('mechanic_overlay',jsonb_build_object('type',lower(v_variant),'start_reps',v_start,'increment_reps',greatest(1,v_inc),'exercise_position',v_index));
    elsif v_mechanic='DECK' then
      v_pres:=v_pres||jsonb_build_object('mechanic_overlay',jsonb_build_object('type','deck_suit','suit_index',v_index,'cards_per_suit',13,'strict_card_value_reps',true));
    end if;

    v_exercises:=v_exercises||jsonb_build_array(jsonb_set(v_ex,'{prescription}',v_pres,true));
  end loop;

  if v_mechanic='ODD_EVEN' and jsonb_array_length(v_exercises)<>2 then v_compatible:=false;v_reasons:=v_reasons||jsonb_build_array('ODD_EVEN_REQUIRES_EXACTLY_TWO_EXERCISES'); end if;
  if v_mechanic='COUPLET' and jsonb_array_length(v_exercises)<>2 then v_compatible:=false;v_reasons:=v_reasons||jsonb_build_array('COUPLET_REQUIRES_EXACTLY_TWO_EXERCISES'); end if;
  if v_mechanic='DECK' and jsonb_array_length(v_exercises)<>4 then v_compatible:=false;v_reasons:=v_reasons||jsonb_build_array('DECK_STRICT_REQUIRES_EXACTLY_FOUR_EXERCISES'); end if;
  if v_mechanic='PROGRESSIVE_INTERVAL' and v_variant='DEATH_BY' and jsonb_array_length(v_exercises)<>1 then v_compatible:=false;v_reasons:=v_reasons||jsonb_build_array('DEATH_BY_REQUIRES_EXACTLY_ONE_EXERCISE'); end if;
  if v_mechanic='PROGRESSIVE_INTERVAL' and v_variant='DEATH_BY_COUPLET' and jsonb_array_length(v_exercises)<>2 then v_compatible:=false;v_reasons:=v_reasons||jsonb_build_array('DEATH_BY_COUPLET_REQUIRES_EXACTLY_TWO_EXERCISES'); end if;

  v_result:=jsonb_set(p_candidate,'{exercises}',v_exercises,true);
  if v_variant<>'' then
    v_result:=jsonb_set(v_result,'{variant_key}',to_jsonb(v_variant),true);
  else
    v_result:=v_result-'variant_key';
  end if;
  v_result:=jsonb_set(v_result,'{c4_preparation}',jsonb_build_object('mechanic_compatible',v_compatible,'reasons',v_reasons,'per_exercise_progression',true,'version','c4-prepare-v2.1-c41'),true);
  return v_result;
end;
$$;;
