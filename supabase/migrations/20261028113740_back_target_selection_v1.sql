do $baseline$ begin
if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='build_session_stimulus_target' and md5(pg_get_functiondef(p.oid))='36d4a3f535b6bb6466d3b0ac422bc5a0') then raise exception 'Unexpected baseline: build_session_stimulus_target';end if;
if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='c2_candidate_pool_v2' and md5(pg_get_functiondef(p.oid))='cbc066b344e8e13f8853f4f0c92f3c6d') then raise exception 'Unexpected baseline: c2_candidate_pool_v2';end if;
if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='c4_apply_skill_path_v2' and md5(pg_get_functiondef(p.oid))='21f21bcb8db303843f417907e1afb2f8') then raise exception 'Unexpected baseline: c4_apply_skill_path_v2';end if;
if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='c4_candidate_quality_gate_v2' and md5(pg_get_functiondef(p.oid))='f92869fa9e78f88aedc77444b363b815') then raise exception 'Unexpected baseline: c4_candidate_quality_gate_v2';end if;
if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='c4_skill_path_region_compatible_v1' and md5(pg_get_functiondef(p.oid))='78fa9b02bda96443211c9343c2a28ce9') then raise exception 'Unexpected baseline: c4_skill_path_region_compatible_v1';end if;
if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='gym_resolve_target_region_v1' and md5(pg_get_functiondef(p.oid))='c8e8c2531d46bea31b4418133790f7fd') then raise exception 'Unexpected baseline: gym_resolve_target_region_v1';end if;
end $baseline$;
CREATE OR REPLACE FUNCTION public.build_session_stimulus_target(p_focus text, p_duration_minutes integer, p_readiness text, p_target_region text DEFAULT NULL::text, p_progression_intent text DEFAULT NULL::text, p_policy_key text DEFAULT 'c1-default'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_config jsonb;
  v_profile jsonb;
  v_modifier jsonb;
  v_readiness text;
  v_focus text := trim(coalesce(p_focus,''));
  v_region text := nullif(trim(coalesce(p_target_region,'')),'');
  v_intent text := upper(nullif(trim(coalesce(p_progression_intent,'')),''));
  v_strength numeric;
  v_conditioning numeric;
  v_muscular_endurance numeric;
  v_power numeric;
  v_stability numeric;
  v_mobility numeric;
  v_density numeric;
  v_local_fatigue numeric;
  v_complexity numeric;
  v_rpe_min numeric;
  v_rpe_max numeric;
  v_shift numeric;
  v_reason_codes jsonb;
begin
  select config into v_config
  from public.session_engine_policy
  where policy_key=p_policy_key;

  if v_config is null then
    raise exception 'Unknown session engine policy: %', p_policy_key;
  end if;

  if v_focus not in ('General Fitness','Fat Loss','Muscle Gain','Strength','Conditioning') then
    raise exception 'Unsupported V1 focus: %', p_focus;
  end if;

  if p_duration_minutes is null or p_duration_minutes < 20 or p_duration_minutes > 90 then
    raise exception 'V1 session duration must be between 20 and 90 minutes';
  end if;

  if v_region is not null and v_region not in ('Upper','Lower','Core','Full Body','Back') then
    raise exception 'Unsupported target region: %', p_target_region;
  end if;

  if v_intent is not null and v_intent not in ('PROGRESS','MAINTAIN','CONSOLIDATE','DELOAD','RECALIBRATE','EXPLORE') then
    raise exception 'Unsupported progression intent: %', p_progression_intent;
  end if;

  v_readiness := public.normalize_session_readiness(p_readiness);
  v_profile := v_config #> array['focus_profiles',v_focus];
  v_modifier := v_config #> array['readiness_modifiers',v_readiness];

  if v_profile is null or v_modifier is null then
    raise exception 'Incomplete session policy for focus/readiness';
  end if;

  v_strength := greatest(0,least(100,(v_profile->>'strength')::numeric));
  v_conditioning := greatest(0,least(100,(v_profile->>'conditioning')::numeric));
  v_muscular_endurance := greatest(0,least(100,(v_profile->>'muscular_endurance')::numeric));
  v_power := greatest(0,least(100,(v_profile->>'power')::numeric + coalesce((v_modifier->>'power')::numeric,0)));
  v_stability := greatest(0,least(100,(v_profile->>'stability')::numeric));
  v_mobility := greatest(0,least(100,(v_profile->>'mobility')::numeric));
  v_density := greatest(0,least(100,(v_profile->>'density')::numeric + coalesce((v_modifier->>'density')::numeric,0)));
  v_local_fatigue := greatest(0,least(100,(v_profile->>'local_fatigue')::numeric + coalesce((v_modifier->>'local_fatigue')::numeric,0)));
  v_complexity := greatest(0,least(100,(v_profile->>'complexity')::numeric + coalesce((v_modifier->>'complexity')::numeric,0)));
  v_shift := coalesce((v_modifier->>'rpe_shift')::numeric,0);
  v_rpe_min := greatest(1,least(10,(v_profile->>'rpe_min')::numeric + v_shift));
  v_rpe_max := greatest(v_rpe_min,least(10,(v_profile->>'rpe_max')::numeric + v_shift));

  v_reason_codes := jsonb_build_array(
    'focus_profile:' || replace(lower(v_focus),' ','_'),
    'readiness:' || v_readiness,
    case when v_region is null then 'region:auto' else 'region:' || replace(lower(v_region),' ','_') end,
    case when v_intent is null then 'progression_intent:unspecified' else 'progression_intent:' || lower(v_intent) end
  );

  return jsonb_build_object(
    'contract_version','c1-stimulus-v1.1-20min',
    'policy_key',p_policy_key,
    'focus',v_focus,
    'duration_minutes',p_duration_minutes,
    'target_region',coalesce(v_region,'AUTO'),
    'progression_intent',coalesce(v_intent,'UNSPECIFIED'),
    'readiness',jsonb_build_object('raw',p_readiness,'band',v_readiness),
    'qualities',jsonb_build_object(
      'strength',jsonb_build_object('score',v_strength,'band',public.session_stimulus_band(v_strength)),
      'conditioning',jsonb_build_object('score',v_conditioning,'band',public.session_stimulus_band(v_conditioning)),
      'muscular_endurance',jsonb_build_object('score',v_muscular_endurance,'band',public.session_stimulus_band(v_muscular_endurance)),
      'power',jsonb_build_object('score',v_power,'band',public.session_stimulus_band(v_power)),
      'stability',jsonb_build_object('score',v_stability,'band',public.session_stimulus_band(v_stability)),
      'mobility',jsonb_build_object('score',v_mobility,'band',public.session_stimulus_band(v_mobility))
    ),
    'density',jsonb_build_object('score',v_density,'band',public.session_stimulus_band(v_density)),
    'local_fatigue',jsonb_build_object('score',v_local_fatigue,'band',public.session_stimulus_band(v_local_fatigue)),
    'complexity',jsonb_build_object('score',v_complexity,'band',public.session_stimulus_band(v_complexity)),
    'rpe_target',jsonb_build_object('min',v_rpe_min,'max',v_rpe_max),
    'hard_gate_priority',v_config->'hard_gate_priority',
    'reason_codes',v_reason_codes
  );
end;
$function$;
CREATE OR REPLACE FUNCTION public.c2_candidate_pool_v2(p_user_id uuid, p_focus text, p_duration_minutes integer, p_readiness text, p_target_region text DEFAULT NULL::text, p_progression_intent text DEFAULT NULL::text, p_zone_terms text[] DEFAULT '{}'::text[], p_inventory jsonb DEFAULT '[]'::jsonb, p_usable_for text DEFAULT 'WOD'::text, p_max_complexity integer DEFAULT 3, p_max_difficulty text DEFAULT 'Intermédiaire'::text, p_limit integer DEFAULT 20, p_session_intent text DEFAULT NULL::text, p_base_training_intent text DEFAULT NULL::text, p_aligned_evolution_domain text DEFAULT NULL::text)
 RETURNS TABLE(exercise_id text, exercise_name text, movement_pattern text, exercise_family text, body_region text, candidate_score numeric, score_components jsonb, stimulus_proxy jsonb, prescription_simulation jsonb)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
with authority as materialized (
  select
    upper(coalesce(
      nullif(trim(p_session_intent),''),
      nullif(current_setting('ugerod.resolved_session_intent',true),''),
      public.program_coach_session_intent_classify_v2(
        p_focus,p_progression_intent,p_readiness,p_duration_minutes,
        'BUILD','LOW','LEARNING','{}'::jsonb
      )->>'proposed_session_intent',
      'CLASSIC'
    )) as session_intent,
    upper(coalesce(
      nullif(trim(p_base_training_intent),''),
      nullif(current_setting('ugerod.base_training_intent',true),''),
      public.program_coach_session_intent_classify_v2(
        p_focus,p_progression_intent,p_readiness,p_duration_minutes,
        'BUILD','LOW','LEARNING','{}'::jsonb
      )->>'current_architecture_proxy',
      'CLASSIC'
    )) as base_training_intent,
    upper(coalesce(
      nullif(trim(p_aligned_evolution_domain),''),
      nullif(current_setting('ugerod.aligned_evolution_domain',true),''),
      ''
    )) as aligned_evolution_domain
),
context as materialized (
  select
    coalesce(nullif(current_setting('ugerod.session_environment',true),''),'UNKNOWN') environment_code,
    nullif(current_setting('ugerod.session_surface',true),'') surface_code
),
legacy_ordered as materialized (
  select row_number() over () as legacy_position,q.*
  from public.c2_candidate_pool_pre_environment_v1(
    p_user_id,p_focus,p_duration_minutes,p_readiness,case when p_target_region='Back' then null else p_target_region end,p_progression_intent,
    p_zone_terms,p_inventory,p_usable_for,p_max_complexity,p_max_difficulty,
    case when p_target_region='Back' then greatest(p_limit*4,160) else greatest(p_limit*2,36) end
  ) q
),
eligible as materialized (
  select
    c.*,
    ctx.environment_code,
    ctx.surface_code,
    a.session_intent,
    a.base_training_intent,
    a.aligned_evolution_domain,
    public.exercise_environment_leverage_v1(
      c.exercise_id,ctx.environment_code,p_inventory
    ) as leverage,
    public.ugerod_exercise_intent_alignment_v2(
      c.exercise_id,
      a.session_intent,
      a.base_training_intent,
      p_focus,
      p_target_region,
      nullif(a.aligned_evolution_domain,'')
    ) as intent_alignment,
    case
      when upper(coalesce(p_progression_intent,''))='PROGRESS'
       and coalesce(nullif(c.score_components->>'recent_exact_sessions','')::int,0)>0
       and lower(coalesce(c.prescription_simulation->>'progression_axis','none'))='none'
       and not coalesce(
         nullif(c.score_components#>>'{w5_mastery_candidate_preference,eligible}','')::boolean,
         false
       )
      then -coalesce(
        nullif(c.score_components#>>'{w5_mastery_candidate_preference,quality_band_delta}','')::numeric,
        2.0
      )
      else 0::numeric
    end as continuity_bias,
    jsonb_build_object(
      'version','repeat-continuity-v1-existing-progress-authority',
      'recent_exact_sessions',coalesce(nullif(c.score_components->>'recent_exact_sessions','')::int,0),
      'progression_intent',upper(coalesce(p_progression_intent,'')),
      'progression_axis',coalesce(c.prescription_simulation->>'progression_axis','none'),
      'mastery_progression_preferred',coalesce(
        nullif(c.score_components#>>'{w5_mastery_candidate_preference,eligible}','')::boolean,
        false
      ),
      'status',case
        when upper(coalesce(p_progression_intent,''))<>'PROGRESS'
          then 'NEUTRAL_NON_PROGRESS_SESSION'
        when coalesce(nullif(c.score_components->>'recent_exact_sessions','')::int,0)=0
          then 'NEW_OR_NOT_RECENT'
        when lower(coalesce(c.prescription_simulation->>'progression_axis','none'))<>'none'
          then 'CONTINUE_PROGRESSIVE'
        when coalesce(
          nullif(c.score_components#>>'{w5_mastery_candidate_preference,eligible}','')::boolean,
          false
        )
          then 'CONTINUE_MASTERY'
        else 'ROTATE_SOFT_NO_PROGRESS_JUSTIFICATION'
      end,
      'uses_existing_progression_authority',true,
      'soft_bias_only',true,
      'no_hard_ban',true
    ) as repeat_continuity
  from context ctx
  cross join authority a
  cross join legacy_ordered c
  where
    ctx.environment_code='UNKNOWN'
    or public.exercise_environment_eligible_v1(
      c.exercise_id,ctx.environment_code
    )
),
scored as (
  select
    e.*,
    coalesce(e.candidate_score,0)
      +coalesce(nullif(e.leverage->>'soft_bonus','')::numeric,0)
      +coalesce(nullif(e.intent_alignment->>'soft_bonus','')::numeric,0)
      +coalesce(e.continuity_bias,0)
      as adjusted_score
  from eligible e
)
select
  s.exercise_id,
  s.exercise_name,
  s.movement_pattern,
  s.exercise_family,
  s.body_region,
  round(s.adjusted_score,2) as candidate_score,
  coalesce(s.score_components,'{}'::jsonb)
    ||jsonb_build_object(
      'environment_filter',jsonb_build_object(
        'environment_code',s.environment_code,
        'surface_code',s.surface_code,
        'eligible',true,
        'equipment_checked_by_base_hard_gate',true,
        'pain_checked_by_base_hard_gate',true,
        'technical_level_checked_by_base_hard_gate',true,
        'version','environment-filter-fastpath-v1'
      ),
      'environment_leverage',s.leverage,
      'environment_leverage_applied',true,
      'intent_alignment',s.intent_alignment,
      'intent_alignment_applied',true,
      'repeat_continuity',s.repeat_continuity||jsonb_build_object(
        'soft_bonus',round(s.continuity_bias,2)
      ),
      'repeat_continuity_applied',true,
      'resolved_session_intent',s.session_intent,
      'base_training_intent',s.base_training_intent,
      'aligned_evolution_domain',nullif(s.aligned_evolution_domain,''),
      'candidate_score_before_environment_and_intent',s.candidate_score,
      'candidate_score_after_environment_intent_and_continuity',round(s.adjusted_score,2),
      'context_resolver',jsonb_build_object(
        'version','c2-pre-gated-environment-intent-v2',
        'eligible',true,
        'environment_code',s.environment_code,
        'surface_code',s.surface_code,
        'base_hard_gates_reused',true,
        'full_c4_quality_gate_still_required',true,
        'focus_is_goal_not_session_intent',true
      )
    ),
  s.stimulus_proxy,
  s.prescription_simulation
from scored s
where p_target_region is distinct from 'Back' or exists(select 1 from public.exercise_muscles em where em.exercise_id=s.exercise_id and em.muscle_id in('M02','M12','M13') and em.priority='primary')
order by
  s.adjusted_score desc,
  s.legacy_position,
  s.exercise_id
limit greatest(1,p_limit);
$function$;
CREATE OR REPLACE FUNCTION public.c4_skill_path_region_compatible_v1(p_path_region text, p_target_region text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select case
    when p_target_region is null or p_target_region='Full Body' then true
    when p_target_region='Back' then true
    when p_target_region='Upper' then p_path_region in ('Upper','Core','Full Body')
    when p_target_region='Lower' then p_path_region in ('Lower','Core','Full Body')
    when p_target_region='Core' then p_path_region in ('Core','Full Body')
    else false
  end;
$function$;
CREATE OR REPLACE FUNCTION public.c4_apply_skill_path_v2(p_user_id uuid, p_plan jsonb, p_zone_terms text[] DEFAULT '{}'::text[], p_inventory jsonb DEFAULT '[]'::jsonb, p_target_region text DEFAULT NULL::text, p_max_complexity integer DEFAULT 3, p_progression_intent text DEFAULT NULL::text, p_readiness text DEFAULT 'normal'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  r jsonb:=coalesce(p_plan,'{}'::jsonb);
  v_skill_block jsonb;
  v_skill_minutes int:=0;
  v_skill_reason text;
  v_wod_ids text[]:='{}'::text[];
  v_path record;
  v_anchor record;
  v_choice record;
  v_progress record;
  v_choice_id text;
  v_choice_source text:='ENTRY_LEVEL';
  v_auto_progressed boolean:=false;
  v_manual_anchor boolean:=false;
  v_mini_cfg jsonb:='{}'::jsonb;
  v_mini_target int:=3;
  v_mini_window_days int:=35;
  v_mini_max_gap_days int:=21;
  v_mini_anchor_path text:=null;
  v_mini_completed_exposures int:=0;
  v_mini_last_completed_date date:=null;
  v_mini_active boolean:=false;
  v_focus jsonb:='{}'::jsonb;
  v_focus_decision text:='OPEN_SELECTION';
  v_focus_anchor_path text:=null;
  v_pres jsonb;
  v_contract jsonb;
  v_ex jsonb;
  v_blocks jsonb;
  v_active int;
  v_planned int;
  v_transition int;
  v_unallocated int;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;
  if coalesce(r->>'status','')<>'READY' then return r; end if;

  select b into v_skill_block
  from jsonb_array_elements(coalesce(r->'blocks','[]'::jsonb)) b
  where b->>'block_key'='skill'
  limit 1;

  if v_skill_block is null then
    r:=jsonb_set(r,'{architecture,skill_path}',jsonb_build_object(
      'version','skill-path-v1','applied',false,'reason','NO_SKILL_BLOCK'
    ),true);
    return r;
  end if;

  v_skill_minutes:=coalesce(nullif(v_skill_block->>'duration_minutes','')::int,0);
  if v_skill_minutes<=0 then return r; end if;
  if exists (
    select 1 from public.user_skill_session_preferences usp
    where usp.user_id=p_user_id
      and usp.preference_date=public.ugerod_effective_session_anchor_date_v1()
      and usp.action='SKIP_SKILL'
      and (usp.expires_at is null or usp.expires_at>now())
  ) then
    select coalesce(jsonb_agg(b order by ord),'[]'::jsonb)
    into v_blocks
    from jsonb_array_elements(coalesce(r->'blocks','[]'::jsonb)) with ordinality x(b,ord)
    where b->>'block_key'<>'skill';
    v_active:=greatest(0,coalesce(nullif(r#>>'{architecture,active_training_minutes}','')::int,0)-v_skill_minutes);
    v_transition:=greatest(0,coalesce(nullif(r#>>'{architecture,transition_recovery_minutes}','')::int,0)-1);
    v_planned:=greatest(0,coalesce(nullif(r#>>'{architecture,planned_minutes}','')::int,0)-v_skill_minutes-1);
    v_unallocated:=coalesce(nullif(r#>>'{architecture,unallocated_available_minutes}','')::int,0)+v_skill_minutes+1;
    r:=jsonb_set(r,'{blocks}',v_blocks,true);
    r:=jsonb_set(r,'{architecture,skill_minutes}',to_jsonb(0),true);
    r:=jsonb_set(r,'{architecture,active_training_minutes}',to_jsonb(v_active),true);
    r:=jsonb_set(r,'{architecture,transition_recovery_minutes}',to_jsonb(v_transition),true);
    r:=jsonb_set(r,'{architecture,planned_minutes}',to_jsonb(v_planned),true);
    r:=jsonb_set(r,'{architecture,unallocated_available_minutes}',to_jsonb(v_unallocated),true);
    r:=jsonb_set(r,'{architecture,skill_path}',jsonb_build_object(
      'version','skill-session-preference-v1','applied',false,'reason','USER_SKIPPED_SKILL_TODAY',
      'preference_scope','SESSION_DAY_ONLY','safety_signal',false,'creates_training_debt',false,
      'focus_cycle_preserved_for_future_sessions',true
    ),true);
    r:=jsonb_set(r,'{architecture,skill_session_preference}',jsonb_build_object(
      'action','SKIP_SKILL','scope','SESSION_DAY_ONLY','preference_not_pain',true,
      'does_not_change_level',true,'does_not_break_focus_cycle',true
    ),true);
    return r;
  end if;
  v_skill_reason:=coalesce(r#>>'{architecture,skill_reason}',v_skill_block#>>'{expected_outcome,skill_reason}');

  select coalesce(array_agg(x->>'exercise_id') filter(where nullif(x->>'exercise_id','') is not null),'{}'::text[])
  into v_wod_ids
  from jsonb_array_elements(coalesce((
    select b->'exercises'
    from jsonb_array_elements(coalesce(r->'blocks','[]'::jsonb)) b
    where b->>'block_key'='wod'
    limit 1
  ),'[]'::jsonb)) x;

  select coalesce(config#>'{skill_path,mini_cycle}','{}'::jsonb) into v_mini_cfg
  from public.session_engine_policy where policy_key='c4-final-default';
  v_mini_target:=greatest(2,least(coalesce(nullif(v_mini_cfg->>'target_completed_exposures','')::int,3),4));
  v_mini_window_days:=greatest(14,least(coalesce(nullif(v_mini_cfg->>'window_days','')::int,35),70));
  v_mini_max_gap_days:=greatest(7,least(coalesce(nullif(v_mini_cfg->>'max_gap_days','')::int,21),35));

  select case
    when coalesce((ws.planning_context_json#>>'{architecture,skill_path,mini_cycle,active}')::boolean,false)
      and not coalesce((ws.planning_context_json#>>'{architecture,skill_path,mini_cycle,selected_anchor_path}')::boolean,false)
      and nullif(ws.planning_context_json#>>'{architecture,skill_path,mini_cycle,anchor_path_key}','') is not null
    then ws.planning_context_json#>>'{architecture,skill_path,mini_cycle,anchor_path_key}'
    else hist.path_key
  end
  into v_mini_anchor_path
  from public.workout_sessions ws
  join public.workout_session_exercises wse on wse.session_id=ws.id and wse.block_key='skill'
  join public.skill_path_members hist on hist.exercise_id=wse.exercise_id and hist.active
  where ws.user_id=p_user_id and ws.status='completed'
    and coalesce(ws.generation_local_date,ws.completed_at::date,ws.created_at::date)>=public.ugerod_effective_session_anchor_date_v1()-v_mini_window_days
  order by coalesce(ws.completed_at,ws.created_at) desc,wse.updated_at desc
  limit 1;

  if v_mini_anchor_path is not null then
    select max(coalesce(ws.generation_local_date,ws.completed_at::date,ws.created_at::date)),
           count(distinct ws.id)::int
    into v_mini_last_completed_date,v_mini_completed_exposures
    from public.workout_sessions ws
    join public.workout_session_exercises wse on wse.session_id=ws.id and wse.block_key='skill'
    join public.skill_path_members hist on hist.exercise_id=wse.exercise_id and hist.path_key=v_mini_anchor_path and hist.active
    where ws.user_id=p_user_id and ws.status='completed'
      and coalesce(ws.generation_local_date,ws.completed_at::date,ws.created_at::date)>=public.ugerod_effective_session_anchor_date_v1()-v_mini_window_days;
  end if;

  v_mini_active:=v_mini_anchor_path is not null
    and v_mini_completed_exposures between 1 and v_mini_target-1
    and v_mini_last_completed_date is not null
    and public.ugerod_effective_session_anchor_date_v1()-v_mini_last_completed_date<=v_mini_max_gap_days
    and public.normalize_session_readiness(p_readiness)<>'low'
    and upper(coalesce(p_progression_intent,''))<>'DELOAD';

  v_focus:=public.skill_focus_cycle_decision_v1(
    p_user_id,
    public.ugerod_effective_session_anchor_date_v1(),
    p_readiness,
    p_progression_intent
  );
  v_focus_decision:=coalesce(v_focus->>'decision','OPEN_SELECTION');
  v_focus_anchor_path:=nullif(v_focus->>'anchor_path_key','');
  if v_focus_anchor_path is not null then
    v_mini_anchor_path:=v_focus_anchor_path;
    v_mini_completed_exposures:=coalesce(nullif(v_focus->>'completed_exposures','')::int,v_mini_completed_exposures);
    v_mini_last_completed_date:=coalesce(nullif(v_focus->>'last_completed_on','')::date,v_mini_last_completed_date);
    v_mini_active:=v_focus_decision in ('FOCUS','DETOUR');
  end if;

  with recent_sessions as (
    select ws.id
    from public.workout_sessions ws
    where ws.user_id=p_user_id
      and ws.status in ('completed','abandoned','generated','in_progress')
    order by ws.created_at desc
    limit 6
  ), eligible_paths as (
    select
      sp.*,
      case
        when p_target_region is null or p_target_region='Full Body' then 0
        when sp.body_region=p_target_region then 0
        when sp.body_region='Core' then 1
        when sp.body_region='Full Body' then 2
        else 3
      end as region_rank,
      (
        select count(distinct ws.id)::int
        from public.workout_sessions ws
        join public.workout_session_exercises wse on wse.session_id=ws.id and wse.block_key='skill'
        join public.skill_path_members hist on hist.exercise_id=wse.exercise_id and hist.path_key=sp.path_key and hist.active
        where ws.user_id=p_user_id
          and ws.id in (select id from recent_sessions)
      ) as recent_count,
      exists(
        select 1
        from public.workout_sessions ws
        join public.workout_session_exercises wse on wse.session_id=ws.id and wse.block_key='skill'
        join public.skill_path_members hist on hist.exercise_id=wse.exercise_id and hist.path_key=sp.path_key and hist.active
        where ws.user_id=p_user_id
          and ws.status in ('completed','abandoned','generated','in_progress')
          and ws.generation_local_date=public.ugerod_effective_session_anchor_date_v1()
      ) as same_day_continuity,
      (
        select max(ws.created_at)
        from public.workout_sessions ws
        join public.workout_session_exercises wse on wse.session_id=ws.id and wse.block_key='skill'
        join public.skill_path_members hist on hist.exercise_id=wse.exercise_id and hist.path_key=sp.path_key and hist.active
        where ws.user_id=p_user_id
          and ws.status in ('completed','abandoned','generated','in_progress')
      ) as last_used_at
    from public.skill_paths sp
    where sp.active
      and not exists (
        select 1 from public.user_skill_session_preferences usp
        where usp.user_id=p_user_id
          and usp.preference_date=public.ugerod_effective_session_anchor_date_v1()
          and usp.action='NOT_TODAY'
          and usp.path_key=sp.path_key
          and (usp.expires_at is null or usp.expires_at>now())
      )
      and public.c4_skill_path_region_compatible_v1(sp.body_region,p_target_region)
      and exists(
        select 1
        from public.skill_path_members m
        join public.exercises e on e.id=m.exercise_id
        where m.path_key=sp.path_key
          and m.active
          and not coalesce(e.warmup_only,false)
          and coalesce(e.technical_complexity,99)<=p_max_complexity
          and coalesce(e.fatigue_score,99)<=5
          and coalesce(e.joint_impact,99)<=4
          and public.exercise_safe_for_zones(e.id,public.normalize_body_zone_ids(coalesce(p_zone_terms,'{}'::text[])))
          and public.exercise_equipment_compatible(e.id,coalesce(p_inventory,'[]'::jsonb))
          and (p_target_region is distinct from 'Back' or exists(select 1 from public.exercise_muscles em where em.exercise_id=e.id and em.muscle_id in('M02','M12','M13') and em.priority='primary'))
          and not (e.id=any(v_wod_ids))
      )
  )
  select * into v_path
  from eligible_paths
  order by
    case
      when same_day_continuity
           and not (v_focus_decision in ('DETOUR','ROTATE') and path_key=v_focus_anchor_path) then 0
      when v_focus_decision='FOCUS' and path_key=v_focus_anchor_path then 0
      when v_focus_decision='FOCUS' then 1
      when v_focus_decision in ('DETOUR','ROTATE') and path_key=v_focus_anchor_path then 1
      else 0
    end,
    region_rank asc,
    recent_count asc,
    last_used_at asc nulls first,
    selection_priority desc,
    md5(p_user_id::text||public.ugerod_effective_session_anchor_date_v1()::text||path_key)
  limit 1;

  if not found then
    select coalesce(jsonb_agg(b order by ord),'[]'::jsonb)
    into v_blocks
    from jsonb_array_elements(coalesce(r->'blocks','[]'::jsonb)) with ordinality x(b,ord)
    where b->>'block_key'<>'skill';

    v_active:=greatest(0,coalesce(nullif(r#>>'{architecture,active_training_minutes}','')::int,0)-v_skill_minutes);
    v_transition:=greatest(0,coalesce(nullif(r#>>'{architecture,transition_recovery_minutes}','')::int,0)-1);
    v_planned:=greatest(0,coalesce(nullif(r#>>'{architecture,planned_minutes}','')::int,0)-v_skill_minutes-1);
    v_unallocated:=coalesce(nullif(r#>>'{architecture,unallocated_available_minutes}','')::int,0)+v_skill_minutes+1;

    r:=jsonb_set(r,'{blocks}',v_blocks,true);
    r:=jsonb_set(r,'{architecture,skill_minutes}',to_jsonb(0),true);
    r:=jsonb_set(r,'{architecture,active_training_minutes}',to_jsonb(v_active),true);
    r:=jsonb_set(r,'{architecture,transition_recovery_minutes}',to_jsonb(v_transition),true);
    r:=jsonb_set(r,'{architecture,planned_minutes}',to_jsonb(v_planned),true);
    r:=jsonb_set(r,'{architecture,unallocated_available_minutes}',to_jsonb(v_unallocated),true);
    r:=jsonb_set(r,'{architecture,skill_path}',jsonb_build_object(
      'version','skill-path-v1','applied',false,'reason','NO_SAFE_CURATED_SKILL_PATH',
      'legacy_skill_not_used_as_fallback',true
    ),true);
    return r;
  end if;

  select
    ws.id as source_session_id,
    wse.exercise_id,
    e.name,e.exercise_family,e.movement_pattern,e.body_region,e.instructions,e.tips,e.image_path,e.tracking_modes,
    e.technical_complexity,m.step_order,
    upper(coalesce(s.recommendation,'')) as recommendation,
    coalesce(s.valid_evidence_count,0) as valid_evidence_count,
    exists(
      select 1 from public.workout_session_swap_history h
      where h.user_id=p_user_id and h.session_id=ws.id
        and h.to_exercise_id=wse.exercise_id and h.undone_at is null
    ) as manual_selected
  into v_anchor
  from public.workout_session_exercises wse
  join public.workout_sessions ws on ws.id=wse.session_id
  join public.skill_path_members m on m.exercise_id=wse.exercise_id and m.path_key=v_path.path_key and m.active
  join public.exercises e on e.id=wse.exercise_id
  left join public.user_exercise_coach_state s on s.user_id=p_user_id and s.exercise_id=e.id
  where ws.user_id=p_user_id
    and wse.block_key='skill'
    and ws.status in ('completed','abandoned','generated','in_progress')
    and public.exercise_safe_for_zones(e.id,public.normalize_body_zone_ids(coalesce(p_zone_terms,'{}'::text[])))
    and public.exercise_equipment_compatible(e.id,coalesce(p_inventory,'[]'::jsonb))
          and (p_target_region is distinct from 'Back' or exists(select 1 from public.exercise_muscles em where em.exercise_id=e.id and em.muscle_id in('M02','M12','M13') and em.priority='primary'))
    and not (e.id=any(v_wod_ids))
    and (
      coalesce(e.technical_complexity,99)<=p_max_complexity
      or exists(
        select 1 from public.workout_session_swap_history h
        where h.user_id=p_user_id and h.session_id=ws.id
          and h.to_exercise_id=wse.exercise_id and h.undone_at is null
      )
    )
  order by ws.created_at desc,wse.updated_at desc
  limit 1;

  if found then
    v_choice_id:=v_anchor.exercise_id;
    v_choice_source:='TRAJECTORY_MEMORY';
    v_manual_anchor:=coalesce(v_anchor.manual_selected,false);

    if (
         coalesce(v_anchor.recommendation,'')='PROGRESS_RECOMMENDED'
         or exists(
           select 1
           from public.pi_exercise_directives(p_user_id,public.ugerod_effective_session_anchor_date_v1(),90) pd
           where pd.exercise_id=v_anchor.exercise_id and pd.directive='PROGRESS'
         )
       )
       and coalesce(v_anchor.valid_evidence_count,0)>=2
       and public.w2_skill_progression_feedback_allows_v1(p_user_id,v_anchor.exercise_id)
       and public.normalize_session_readiness(p_readiness)<>'low'
       and upper(coalesce(p_progression_intent,''))<>'DELOAD'
    then
      select e.*,m.step_order into v_progress
      from public.exercise_variants ev
      join public.skill_path_members m
        on m.exercise_id=ev.target_exercise_id and m.path_key=v_path.path_key and m.active
      join public.exercises e on e.id=ev.target_exercise_id
      where ev.exercise_id=v_anchor.exercise_id
        and lower(ev.variant_type)='progression'
        and coalesce(e.technical_complexity,99)<=p_max_complexity
        and coalesce(e.fatigue_score,99)<=5
        and coalesce(e.joint_impact,99)<=4
        and public.exercise_safe_for_zones(e.id,public.normalize_body_zone_ids(coalesce(p_zone_terms,'{}'::text[])))
        and public.exercise_equipment_compatible(e.id,coalesce(p_inventory,'[]'::jsonb))
          and (p_target_region is distinct from 'Back' or exists(select 1 from public.exercise_muscles em where em.exercise_id=e.id and em.muscle_id in('M02','M12','M13') and em.priority='primary'))
        and not (e.id=any(v_wod_ids))
      order by ev.is_preferred desc,ev.priority desc,m.step_order asc,e.id
      limit 1;

      if found then
        v_choice_id:=v_progress.id;
        v_choice_source:='AUTO_DIRECT_PROGRESSION';
        v_auto_progressed:=true;
      end if;
    end if;
  end if;

  if v_choice_id is null then
    select e.*,m.step_order,m.member_role,
           upper(coalesce(s.recommendation,'')) as recommendation,
           coalesce(s.valid_evidence_count,0) as valid_evidence_count
    into v_choice
    from public.skill_path_members m
    join public.exercises e on e.id=m.exercise_id
    left join public.user_exercise_coach_state s on s.user_id=p_user_id and s.exercise_id=e.id
    where m.path_key=v_path.path_key
      and m.active
      and not coalesce(e.warmup_only,false)
      and coalesce(e.technical_complexity,99)<=p_max_complexity
      and coalesce(e.fatigue_score,99)<=5
      and coalesce(e.joint_impact,99)<=4
      and public.exercise_safe_for_zones(e.id,public.normalize_body_zone_ids(coalesce(p_zone_terms,'{}'::text[])))
      and public.exercise_equipment_compatible(e.id,coalesce(p_inventory,'[]'::jsonb))
          and (p_target_region is distinct from 'Back' or exists(select 1 from public.exercise_muscles em where em.exercise_id=e.id and em.muscle_id in('M02','M12','M13') and em.priority='primary'))
      and not (e.id=any(v_wod_ids))
    order by
      case when s.user_id is not null and upper(coalesce(s.recommendation,'')) in ('LEARN','RECALIBRATE','PROGRESS_RECOMMENDED','PROGRESS_POSSIBLE') then 0 else 1 end,
      case when s.user_id is not null then 0 else 1 end,
      m.step_order asc,
      coalesce(e.technical_complexity,99) asc,
      md5(p_user_id::text||v_path.path_key||e.id)
    limit 1;

    if not found then
      return r;
    end if;
    v_choice_id:=v_choice.id;
    v_choice_source:='ENTRY_LEVEL';
  end if;

  select e.*,m.step_order,m.member_role into v_choice
  from public.exercises e
  join public.skill_path_members m on m.exercise_id=e.id and m.path_key=v_path.path_key
  where e.id=v_choice_id
  limit 1;

  v_pres:=public.c2_solver_prescription(
    p_user_id,v_choice.id,coalesce(r->'stimulus','{}'::jsonb),'SKILL',p_progression_intent,coalesce(p_inventory,'[]'::jsonb)
  )||jsonb_build_object(
    'block_role','skill',
    'target_duration_minutes',v_skill_minutes,
    'quality_priority','technique_before_fatigue',
    'skill_reason',v_skill_reason,
    'skill_path_key',v_path.path_key,
    'skill_path_name',v_path.display_name,
    'skill_path_step',v_choice.step_order,
    'skill_path_selection_source',v_choice_source,
    'trajectory_anchor',v_choice_source='TRAJECTORY_MEMORY',
    'manual_progression_self_selected',v_manual_anchor,
    'auto_direct_progression',v_auto_progressed
  );

  v_contract:=public.c4_skill_contract_v1(
    p_user_id,v_choice.id,v_skill_reason,v_skill_minutes,p_progression_intent,p_readiness,v_pres
  );
  v_pres:=v_pres||coalesce(v_contract->'prescription_patch','{}'::jsonb)||jsonb_build_object(
    'skill_path_key',v_path.path_key,
    'skill_path_name',v_path.display_name,
    'skill_path_step',v_choice.step_order,
    'skill_path_selection_source',v_choice_source,
    'trajectory_anchor',v_choice_source='TRAJECTORY_MEMORY',
    'auto_direct_progression',v_auto_progressed
  );

  v_ex:=jsonb_build_object(
    'exercise_id',v_choice.id,
    'name',v_choice.name,
    'family',v_choice.exercise_family,
    'pattern',v_choice.movement_pattern,
    'region',v_choice.body_region,
    'instructions',v_choice.instructions,
    'tips',v_choice.tips,
    'image_path',v_choice.image_path,
    'tracking_modes',coalesce(to_jsonb(v_choice.tracking_modes),'[]'::jsonb),
    'prescription',v_pres,
    'expected_outcome',jsonb_build_object(
      'block_key','skill',
      'goal','technical_quality_or_progression',
      'skill_reason',v_skill_reason,
      'pain_gate',true,
      'equipment_gate',true,
      'skill_path_key',v_path.path_key,
      'skill_path_name',v_path.display_name,
      'skill_path_step',v_choice.step_order,
      'skill_objective_type',v_contract->>'objective_type',
      'score_required',coalesce((v_contract->>'score_required')::boolean,false),
      'score_metric',v_contract->>'score_metric',
      'trajectory_memory',v_choice_source='TRAJECTORY_MEMORY',
      'auto_direct_progression',v_auto_progressed,
      'capability_promoted',false
    )
  );

  select coalesce(jsonb_agg(
    case when b->>'block_key'='skill' then
      b||jsonb_build_object(
        'block_name','Skill',
        'exercises',jsonb_build_array(v_ex),
        'structure',v_contract->>'structure',
        'objective',(v_contract->>'objective_title')||' — '||(v_contract->>'objective_description'),
        'skill_contract',v_contract,
        'skill_path',jsonb_build_object(
          'key',v_path.path_key,'name',v_path.display_name,'step',v_choice.step_order,'source',v_choice_source
        ),
        'expected_outcome',coalesce(b->'expected_outcome','{}'::jsonb)||jsonb_build_object(
          'role','skill_development','skill_reason',v_skill_reason,'contract_version','skill-contract-v2',
          'skill_path_key',v_path.path_key,'skill_path_name',v_path.display_name,'skill_path_step',v_choice.step_order
        )
      )
    else b end order by ord
  ),'[]'::jsonb)
  into v_blocks
  from jsonb_array_elements(coalesce(r->'blocks','[]'::jsonb)) with ordinality x(b,ord);

  r:=jsonb_set(r,'{blocks}',v_blocks,true);
  r:=jsonb_set(r,'{architecture,skill_path}',jsonb_build_object(
    'version','skill-path-v2-focus-cycle',
    'applied',true,
    'family_first_selection',true,
    'path_key',v_path.path_key,
    'path_name',v_path.display_name,
    'path_region',v_path.body_region,
    'step',v_choice.step_order,
    'exercise_id',v_choice.id,
    'selection_source',v_choice_source,
    'same_day_continuity',coalesce(v_path.same_day_continuity,false),
    'recent_path_count',coalesce(v_path.recent_count,0),
    'mini_cycle',jsonb_build_object(
      'version','skill-mini-cycle-v1',
      'active',v_mini_active,
      'anchor_path_key',v_mini_anchor_path,
      'selected_anchor_path',v_mini_active and v_path.path_key=v_mini_anchor_path,
      'completed_exposures_before_session',v_mini_completed_exposures,
      'target_completed_exposures',v_mini_target,
      'window_days',v_mini_window_days,
      'max_gap_days',v_mini_max_gap_days,
      'last_completed_date',v_mini_last_completed_date,
      'completed_exposures_only',true,
      'region_coherence_before_minicycle',true,
      'disabled_by_low_readiness_or_deload',public.normalize_session_readiness(p_readiness)='low' or upper(coalesce(p_progression_intent,''))='DELOAD'
    ),
    'focus_cycle',coalesce(v_focus,'{}'::jsonb)||jsonb_build_object(
      'selected_path_key',v_path.path_key,
      'selected_anchor_path',v_focus_anchor_path is not null and v_path.path_key=v_focus_anchor_path,
      'selection_outcome',case
        when v_focus_decision='FOCUS' and v_path.path_key=v_focus_anchor_path then 'FOCUS'
        when v_focus_decision='FOCUS' then 'CONTEXT_DETOUR'
        when v_focus_decision='DETOUR' and v_path.path_key is distinct from v_focus_anchor_path then 'DETOUR'
        when v_focus_decision='DETOUR' then 'DETOUR_FALLBACK_NO_ALTERNATIVE'
        when v_focus_decision='ROTATE' and v_path.path_key is distinct from v_focus_anchor_path then 'ROTATE'
        when v_focus_decision='ROTATE' then 'ROTATION_FALLBACK_NO_ALTERNATIVE'
        when v_focus_decision='PAUSE' then 'PAUSED_GUARDRAIL_SELECTION'
        else 'OPEN_SELECTION'
      end,
      'selection_authority','ACTIVE_SOFT_BIAS',
      'hard_gates_remain_authoritative',true,
      'trajectory_memory_preserved',true,
      'focus_can_return_later',true
    ),
    'anchor_source_session_id',case when v_anchor.source_session_id is null then null else v_anchor.source_session_id end,
    'manual_anchor',v_manual_anchor,
    'auto_direct_progression',v_auto_progressed,
    'presented_memory_does_not_create_mastery',true,
    'rotation_between_paths_progression_within_path',true
  ),true);
  r:=jsonb_set(r,'{architecture,skill_trajectory_memory}',jsonb_build_object(
    'version','skill-trajectory-memory-v2-path-scoped',
    'applied',v_choice_source in ('TRAJECTORY_MEMORY','AUTO_DIRECT_PROGRESSION'),
    'path_key',v_path.path_key,
    'exercise_id',v_choice.id,
    'source_session_id',case when v_anchor.source_session_id is null then null else v_anchor.source_session_id end,
    'manual_selected',v_manual_anchor,
    'continuity_without_mastery_assumption',true,
    'path_scoped_not_global',true
  ),true);
  return r;
end;
$function$;
CREATE OR REPLACE FUNCTION public.c4_candidate_quality_gate_v2(p_candidate jsonb, p_readiness text, p_focus text, p_target_region text, p_zone_terms text[], p_inventory jsonb, p_max_complexity integer, p_policy_key text DEFAULT 'c4-final-default'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  r jsonb;
  reasons jsonb:='[]'::jsonb;
  checks jsonb:='{}'::jsonb;
  m text:=upper(coalesce(p_candidate->>'mechanic',p_candidate#>>'{c4_final,mechanic_json,mechanic_key}',''));
  params jsonb:=coalesce(p_candidate#>'{c4_final,mechanic_json,parameters}','{}'::jsonb);
  expected_reps numeric:=coalesce(nullif(params->>'expected_reps_per_suit','')::numeric,0);
  cards int:=coalesce(nullif(params->>'cards','')::int,0);
  uid uuid:=nullif(p_candidate#>>'{c4_runtime_context,user_id}','')::uuid;
  cap numeric;
  guarded_expected numeric;
  x jsonb;
  ord bigint;
  bad int:=0;
begin
  r:=public.c4_candidate_quality_gate_v2_pre_deck_adaptive_v1(
    p_candidate,p_readiness,p_focus,case when p_target_region='Back' then null else p_target_region end,p_zone_terms,p_inventory,p_max_complexity,p_policy_key
  );
  if p_target_region='Back' then
    if exists(select 1 from jsonb_array_elements(coalesce(p_candidate->'exercises','[]')) ex where not exists(
      select 1 from public.exercise_muscles em where em.exercise_id=coalesce(ex->>'exercise_id',ex->>'id') and em.muscle_id in('M02','M12','M13') and em.priority='primary')) then
      r:=r||jsonb_build_object('pass',false,'hard_gate_reasons',coalesce(r->'hard_gate_reasons','[]')||'["BACK_PRIMARY_MUSCLE_REQUIRED"]'::jsonb);
    end if;
  end if;
  if m<>'DECK' then return r; end if;

  select coalesce(jsonb_agg(to_jsonb(reason)),'[]'::jsonb)
  into reasons
  from jsonb_array_elements_text(coalesce(r->'hard_gate_reasons','[]'::jsonb)) reason
  where reason not like 'DECK_VOLUME_EXCEEDS_ATHLETE_CAP:%';

  checks:=coalesce(r->'checks','{}'::jsonb)
    -'deck_reps_per_exercise'
    -'deck_athlete_relative_volume'
    -'deck_exercises_over_volume_cap';
  guarded_expected:=case when cards>=52 then expected_reps else expected_reps*1.20 end;

  if uid is not null then
    for x,ord in select value,ordinality from jsonb_array_elements(coalesce(p_candidate->'exercises','[]'::jsonb)) with ordinality
    loop
      cap:=public.c4_deck_exercise_rep_cap_v1(uid,x->>'exercise_id',p_readiness,p_candidate#>>'{c4_runtime_context,progression_intent}');
      if guarded_expected>cap then
        bad:=bad+1;
        reasons:=reasons||jsonb_build_array('DECK_ADAPTIVE_VOLUME_EXCEEDS_ATHLETE_CAP:'||(x->>'exercise_id'));
      end if;
    end loop;
  end if;

  checks:=checks||jsonb_build_object(
    'deck_adaptive_protocol',true,
    'played_cards',cards,
    'source_deck_cards',coalesce(nullif(params->>'source_deck_cards','')::int,52),
    'protocol_mode',params->>'protocol_mode',
    'full_deck_min_wod_minutes',coalesce(nullif(params->>'full_deck_min_wod_minutes','')::int,30),
    'nominal_full_deck_minutes',coalesce(nullif(params->>'nominal_full_deck_minutes','')::numeric,30),
    'expected_reps_per_suit',round(expected_reps,2),
    'random_draw_guarded_expected_reps_per_suit',round(guarded_expected,2),
    'random_draw_safety_margin',case when cards>=52 then 1 else 1.20 end,
    'deck_exercises_over_volume_cap',bad,
    'deck_card_count_fixed_before_execution',true
  );

  return jsonb_build_object(
    'pass',jsonb_array_length(reasons)=0,
    'hard_gate_reasons',reasons,
    'mechanic','DECK',
    'checks',checks,
    'version','c4-quality-gate-deck-adaptive-v1.1'
  );
end;
$function$;
CREATE OR REPLACE FUNCTION public.gym_resolve_target_region_v1(p_user_id uuid, p_focus text, p_anchor_date date DEFAULT CURRENT_DATE, p_requested_region text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_requested text;
  v_focus text := coalesce(nullif(trim(p_focus),''),'General Fitness');
  v_anchor date := coalesce(p_anchor_date,current_date);
  v_completed_gym_sessions int := 0;
  v_sequence int := 1;
  v_region text;
begin
  if p_user_id is null then
    raise exception 'p_user_id is required';
  end if;
  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'Forbidden user';
  end if;

  v_requested := case upper(coalesce(trim(p_requested_region),''))
    when 'UPPER' then 'Upper'
    when 'LOWER' then 'Lower'
    when 'FULL BODY' then 'Full Body'
    when 'FULL_BODY' then 'Full Body'
    when 'CORE' then 'Core'
    when 'BACK' then 'Back'
    when 'DOS' then 'Back'
    else null
  end;

  if v_requested is not null then
    return jsonb_build_object(
      'status','RESOLVED',
      'version','gym-target-region-resolver-v1',
      'target_region',v_requested,
      'source','EXPLICIT_USER_OR_PROGRAM_CONTEXT',
      'requested_region',p_requested_region,
      'anchor_date',v_anchor,
      'focus',v_focus,
      'rotation_sequence',null,
      'completed_gym_sessions_before_anchor',null
    );
  end if;

  select count(*)
  into v_completed_gym_sessions
  from public.workout_sessions ws
  where ws.user_id=p_user_id
    and upper(coalesce(ws.planned_environment_code,''))='GYM'
    and ws.status='completed'
    and coalesce(ws.started_local_date,ws.generation_local_date,ws.completed_at::date,ws.created_at::date) < v_anchor
    and public.session_counts_as_training_v1(ws.id);

  v_sequence := greatest(1,v_completed_gym_sessions+1);
  v_region := public.d_base_target_region(v_focus,v_sequence);

  if v_region is null then
    v_region := 'Full Body';
  end if;

  return jsonb_build_object(
    'status','RESOLVED',
    'version','gym-target-region-resolver-v1',
    'target_region',v_region,
    'source','GYM_FOCUS_ROTATION',
    'requested_region',null,
    'anchor_date',v_anchor,
    'focus',v_focus,
    'rotation_sequence',v_sequence,
    'completed_gym_sessions_before_anchor',v_completed_gym_sessions,
    'rotation_contract','d_base_target_region'
  );
end;
$function$;
