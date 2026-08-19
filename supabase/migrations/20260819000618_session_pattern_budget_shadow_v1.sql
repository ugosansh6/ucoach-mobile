-- Session Pattern Budget SHADOW v1
-- Evaluates weighted training exposure across Skill + WOD without changing the plan.
-- Unlock/Warm-up/Tabata do not consume this transversal budget in v1.

create or replace function public.c4_session_pattern_budget_v1(
  p_session_intent text,
  p_blocks jsonb,
  p_pattern_allowance_overrides jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
immutable
set search_path to 'public'
as $function$
declare
  v_intent text:=upper(coalesce(nullif(btrim(p_session_intent),''),'CLASSIC'));
  v_blocks jsonb:=coalesce(p_blocks,'[]'::jsonb);
  v_skill_duration numeric:=0;
  v_wod_duration numeric:=0;
  v_skill_pattern_count int:=0;
  v_wod_exercise_count int:=0;
  v_training_exercise_count int:=0;
  v_missing_pattern_count int:=0;
  v_total_exposure numeric:=0;
  v_cap numeric:=0.65;
  v_override_cap numeric:=null;
  v_ledger jsonb:='[]'::jsonb;
  v_over jsonb:='[]'::jsonb;
  v_dominant_pattern text:=null;
  v_max_share numeric:=0;
  v_status text:='WITHIN_BUDGET';
  v_distinct_patterns int:=0;
begin
  if jsonb_typeof(v_blocks)<>'array' then
    return jsonb_build_object(
      'version','session-pattern-budget-v1',
      'mode','SHADOW',
      'status','INSUFFICIENT_DATA',
      'reason','BLOCKS_NOT_ARRAY',
      'authority',jsonb_build_object('shadow_only',true,'may_change_session_decision',false)
    );
  end if;

  v_cap:=case v_intent
    when 'SKILL_DEVELOPMENT' then 0.82
    when 'STRENGTH_QUALITY' then 0.78
    when 'CONDITIONING' then 0.60
    when 'CONSOLIDATE' then 0.70
    else 0.65
  end;

  begin
    v_override_cap:=nullif(p_pattern_allowance_overrides->>'max_concentration','')::numeric;
  exception when others then
    v_override_cap:=null;
  end;
  if v_override_cap is not null then
    v_cap:=greatest(0.50,least(v_override_cap,0.95));
  end if;

  select coalesce(max(coalesce(nullif(b->>'duration_minutes','')::numeric,0)) filter(where b->>'block_key'='skill'),0),
         coalesce(max(coalesce(nullif(b->>'duration_minutes','')::numeric,0)) filter(where b->>'block_key'='wod'),0)
  into v_skill_duration,v_wod_duration
  from jsonb_array_elements(v_blocks) b;

  with skill_patterns as (
    select distinct nullif(btrim(ex->>'pattern'),'') pattern
    from jsonb_array_elements(v_blocks) b
    cross join lateral jsonb_array_elements(coalesce(b->'exercises','[]'::jsonb)) ex
    where b->>'block_key'='skill'
  )
  select count(*) filter(where pattern is not null)::int
  into v_skill_pattern_count
  from skill_patterns;

  select count(*) filter(where b->>'block_key'='wod')::int,
         count(*) filter(where b->>'block_key' in ('skill','wod'))::int,
         count(*) filter(where b->>'block_key' in ('skill','wod') and nullif(btrim(ex->>'pattern'),'') is null)::int
  into v_wod_exercise_count,v_training_exercise_count,v_missing_pattern_count
  from jsonb_array_elements(v_blocks) b
  cross join lateral jsonb_array_elements(coalesce(b->'exercises','[]'::jsonb)) ex;

  if v_training_exercise_count=0 then
    return jsonb_build_object(
      'version','session-pattern-budget-v1',
      'mode','SHADOW',
      'status','INSUFFICIENT_DATA',
      'reason','NO_SKILL_OR_WOD_EXERCISES',
      'session_intent',v_intent,
      'authority',jsonb_build_object('shadow_only',true,'may_change_session_decision',false)
    );
  end if;

  if v_missing_pattern_count>0 then
    return jsonb_build_object(
      'version','session-pattern-budget-v1',
      'mode','SHADOW',
      'status','INSUFFICIENT_DATA',
      'reason','MISSING_MOVEMENT_PATTERN_METADATA',
      'session_intent',v_intent,
      'training_exercise_count',v_training_exercise_count,
      'missing_pattern_count',v_missing_pattern_count,
      'authority',jsonb_build_object('shadow_only',true,'may_change_session_decision',false)
    );
  end if;

  with skill_patterns as (
    select distinct nullif(btrim(ex->>'pattern'),'') pattern
    from jsonb_array_elements(v_blocks) b
    cross join lateral jsonb_array_elements(coalesce(b->'exercises','[]'::jsonb)) ex
    where b->>'block_key'='skill' and nullif(btrim(ex->>'pattern'),'') is not null
  ), exposures as (
    select pattern,
           case when v_skill_pattern_count>0
             then (v_skill_duration*1.25)/v_skill_pattern_count
             else 0 end as exposure,
           'skill'::text as source_block
    from skill_patterns
    union all
    select nullif(btrim(ex->>'pattern'),''),
           case when v_wod_exercise_count>0
             then v_wod_duration/v_wod_exercise_count
             else 0 end,
           'wod'::text
    from jsonb_array_elements(v_blocks) b
    cross join lateral jsonb_array_elements(coalesce(b->'exercises','[]'::jsonb)) ex
    where b->>'block_key'='wod' and nullif(btrim(ex->>'pattern'),'') is not null
  ), agg as (
    select pattern,
           sum(exposure) weighted_exposure_minutes,
           sum(exposure) filter(where source_block='skill') skill_exposure_minutes,
           sum(exposure) filter(where source_block='wod') wod_exposure_minutes
    from exposures
    group by pattern
  ), totals as (
    select coalesce(sum(weighted_exposure_minutes),0) total from agg
  ), scored as (
    select a.*,
           case when t.total>0 then a.weighted_exposure_minutes/t.total else 0 end concentration_share
    from agg a cross join totals t
  )
  select
    coalesce((select sum(weighted_exposure_minutes) from scored),0),
    coalesce((select count(*) from scored),0)::int,
    coalesce((select pattern from scored order by concentration_share desc,pattern limit 1),null),
    coalesce((select max(concentration_share) from scored),0),
    coalesce((select jsonb_agg(jsonb_build_object(
      'movement_pattern',pattern,
      'weighted_exposure_minutes',round(weighted_exposure_minutes,2),
      'skill_exposure_minutes',round(coalesce(skill_exposure_minutes,0),2),
      'wod_exposure_minutes',round(coalesce(wod_exposure_minutes,0),2),
      'concentration_share',round(concentration_share,4),
      'over_budget',concentration_share>v_cap
    ) order by concentration_share desc,pattern) from scored),'[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object(
      'movement_pattern',pattern,
      'concentration_share',round(concentration_share,4),
      'allowed_max_concentration',round(v_cap,4),
      'excess',round(concentration_share-v_cap,4)
    ) order by concentration_share desc) from scored where concentration_share>v_cap),'[]'::jsonb)
  into v_total_exposure,v_distinct_patterns,v_dominant_pattern,v_max_share,v_ledger,v_over;

  if jsonb_array_length(v_over)>0 then
    v_status:='SOFT_OVERCONCENTRATION';
  else
    v_status:='WITHIN_BUDGET';
  end if;

  return jsonb_build_object(
    'version','session-pattern-budget-v1',
    'mode','SHADOW',
    'status',v_status,
    'session_intent',v_intent,
    'budget',jsonb_build_object(
      'max_pattern_concentration',round(v_cap,4),
      'source',case when v_override_cap is null then 'intent_default' else 'explicit_overlay_override' end,
      'skill_exposure_multiplier',1.25,
      'skill_counts_as_strong_exposure',true,
      'wod_counts_as_training_exposure',true,
      'unlock_counts',false,
      'warmup_counts',false,
      'tabata_counts_in_transversal_v1',false
    ),
    'metrics',jsonb_build_object(
      'skill_duration_minutes',round(v_skill_duration,2),
      'wod_duration_minutes',round(v_wod_duration,2),
      'weighted_training_exposure_minutes',round(v_total_exposure,2),
      'distinct_training_patterns',v_distinct_patterns,
      'dominant_pattern',v_dominant_pattern,
      'max_pattern_concentration',round(v_max_share,4),
      'training_exercise_count',v_training_exercise_count
    ),
    'pattern_exposure_ledger',v_ledger,
    'over_budget_patterns',v_over,
    'recommendation',case when v_status='SOFT_OVERCONCENTRATION'
      then 'COMPLEMENT_DOMINANT_PATTERN_IF_SAFE_AND_COHERENT'
      else 'NO_CHANGE_SUGGESTED' end,
    'authority',jsonb_build_object(
      'shadow_only',true,
      'soft_bias_only_when_future_enabled',true,
      'may_change_session_decision',false,
      'may_change_skill',false,
      'may_change_wod',false,
      'may_change_exercise_selection',false,
      'hard_gates_always_override_budget',true
    ),
    'semantics',jsonb_build_object(
      'measures_exposure_not_raw_exercise_limit',true,
      'skill_and_wod_transversal_budget',true,
      'specialized_overlay_can_raise_budget_later',true
    )
  );
end;
$function$;

revoke all on function public.c4_session_pattern_budget_v1(text,jsonb,jsonb) from public, anon;
grant execute on function public.c4_session_pattern_budget_v1(text,jsonb,jsonb) to authenticated;

-- Attach the post-generation evaluation to planning_context_json only.
-- The generated workout itself and every C4 selection remain unchanged.
do $bridge$
declare
  v_def text;
  v_old text;
  v_new text;
begin
  select pg_get_functiondef(p.oid)
  into v_def
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname='d_generate_adaptive_session_v2'
    and pg_get_function_identity_arguments(p.oid)='p_user_id uuid, p_focus_override text, p_duration_minutes integer, p_readiness text, p_target_region_override text, p_progression_intent_override text, p_zone_terms text[], p_inventory jsonb, p_available_equipment text[], p_max_complexity integer, p_max_difficulty text, p_candidate_count integer, p_policy_key text, p_anchor_date date, p_force_recalculate_started boolean, p_protected_session_exercise_ids uuid[]';

  if v_def is null then
    raise exception 'Pattern Budget SHADOW guard: d_generate_adaptive_session_v2 exact signature not found';
  end if;

  v_old := $old$v_continuity jsonb:='{}'::jsonb;$old$;
  v_new := $new$v_continuity jsonb:='{}'::jsonb;
  v_pattern_budget jsonb:='{}'::jsonb;
  v_pattern_budget_error text:=null;$new$;
  if position(v_old in v_def)=0 then
    raise exception 'Pattern Budget SHADOW guard: declaration fragment changed';
  end if;
  v_def:=replace(v_def,v_old,v_new);

  v_old := $old$v_session_id:=(v_generated->>'session_id')::uuid;
  v_recalc:=coalesce(v_context->'recalculation','{}'::jsonb);$old$;
  v_new := $new$v_session_id:=(v_generated->>'session_id')::uuid;

  begin
    select public.c4_session_pattern_budget_v1(
      coalesce(v_context#>>'{session_intent_shadow,proposed_session_intent}','CLASSIC'),
      coalesce(ws.generated_workout->'blocks','[]'::jsonb),
      '{}'::jsonb
    )
    into v_pattern_budget
    from public.workout_sessions ws
    where ws.id=v_session_id and ws.user_id=p_user_id;
  exception when others then
    v_pattern_budget_error:=sqlerrm;
    v_pattern_budget:=jsonb_build_object(
      'version','session-pattern-budget-v1','mode','SHADOW','status','UNAVAILABLE',
      'reason','SHADOW_EVALUATION_ERROR',
      'authority',jsonb_build_object('shadow_only',true,'may_change_session_decision',false)
    );
  end;

  v_recalc:=coalesce(v_context->'recalculation','{}'::jsonb);$new$;
  if position(v_old in v_def)=0 then
    raise exception 'Pattern Budget SHADOW guard: session-id fragment changed';
  end if;
  v_def:=replace(v_def,v_old,v_new);

  v_old := $old$'context_recalculation',coalesce(v_recalc,'{}'::jsonb)
      ),updated_at=now()$old$;
  v_new := $new$'context_recalculation',coalesce(v_recalc,'{}'::jsonb),
        'pattern_budget_shadow',v_pattern_budget,
        'pattern_budget_shadow_error',v_pattern_budget_error
      ),updated_at=now()$new$;
  if position(v_old in v_def)=0 then
    raise exception 'Pattern Budget SHADOW guard: planning context fragment changed';
  end if;
  v_def:=replace(v_def,v_old,v_new);

  v_old := $old$'recalculation_continuity',v_continuity,
    'meta',$old$;
  v_new := $new$'recalculation_continuity',v_continuity,
    'pattern_budget_shadow',v_pattern_budget,
    'meta',$new$;
  if position(v_old in v_def)=0 then
    raise exception 'Pattern Budget SHADOW guard: return fragment changed';
  end if;
  v_def:=replace(v_def,v_old,v_new);

  execute v_def;
end;
$bridge$;
