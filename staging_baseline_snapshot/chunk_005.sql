

-- SOURCE MIGRATION: 20260812010531_pi3_candidate_scoring_bridge.sql
create or replace function public.c2_candidate_pool(
  p_user_id uuid,
  p_focus text,
  p_duration_minutes integer,
  p_readiness text,
  p_target_region text default null,
  p_progression_intent text default null,
  p_zone_terms text[] default '{}'::text[],
  p_inventory jsonb default '[]'::jsonb,
  p_usable_for text default 'WOD'::text,
  p_max_complexity integer default 3,
  p_max_difficulty text default 'Intermédiaire'::text,
  p_limit integer default 20
)
returns table(
  exercise_id text,
  exercise_name text,
  movement_pattern text,
  exercise_family text,
  body_region text,
  candidate_score numeric,
  score_components jsonb,
  stimulus_proxy jsonb,
  prescription_simulation jsonb
)
language sql
stable
set search_path=public
as $function$
with stimulus as (
  select public.build_session_stimulus_target(p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,'c1-default') s
), zones as (
  select public.normalize_body_zone_ids(coalesce(p_zone_terms,'{}'::text[])) z
), recent_sessions as (
  select ws.id
  from public.workout_sessions ws
  where ws.user_id=p_user_id and ws.status='completed'
  order by coalesce(ws.completed_at,ws.generated_at) desc
  limit 3
), base as (
  select hg.exercise_id::text,hg.exercise_name::text,hg.movement_pattern::text,hg.exercise_family::text,
         e.body_region::text,e.prescription_type,e.tracking_modes,e.technical_complexity,e.fatigue_score,e.transition_cost,e.training_focus,
         public.c2_exercise_stimulus_proxy(hg.exercise_id::text) proxy,
         cs.recommendation,cs.state,cs.exposure_count,cs.overall_confidence,cs.capability_confidence,cs.capability_freshness,
         (select count(distinct rs.id) from recent_sessions rs join public.workout_session_exercises wse on wse.session_id=rs.id where wse.exercise_id=hg.exercise_id) exact_recent,
         (select count(distinct rs.id) from recent_sessions rs join public.workout_session_exercises wse on wse.session_id=rs.id join public.exercises re on re.id=wse.exercise_id where re.exercise_family=hg.exercise_family) family_recent,
         (select s from stimulus) stimulus,
         public.pi_candidate_fit(p_user_id,hg.exercise_id::text,p_progression_intent) pi_fit
  from zones z
  cross join lateral public.session_hard_gate_candidates(z.z,p_inventory,p_usable_for,p_max_complexity,p_max_difficulty) hg
  join public.exercises e on e.id=hg.exercise_id
  left join public.user_exercise_coach_state cs on cs.user_id=p_user_id and cs.exercise_id=hg.exercise_id
  where not coalesce(e.warmup_only,false)
), scored as (
  select b.*,
    greatest(0,least(100,
      (
        (100-abs((b.stimulus#>>'{qualities,strength,score}')::numeric-(b.proxy#>>'{qualities,strength}')::numeric)) * ((b.stimulus#>>'{qualities,strength,score}')::numeric+10) +
        (100-abs((b.stimulus#>>'{qualities,conditioning,score}')::numeric-(b.proxy#>>'{qualities,conditioning}')::numeric)) * ((b.stimulus#>>'{qualities,conditioning,score}')::numeric+10) +
        (100-abs((b.stimulus#>>'{qualities,muscular_endurance,score}')::numeric-(b.proxy#>>'{qualities,muscular_endurance}')::numeric)) * ((b.stimulus#>>'{qualities,muscular_endurance,score}')::numeric+10) +
        (100-abs((b.stimulus#>>'{qualities,power,score}')::numeric-(b.proxy#>>'{qualities,power}')::numeric)) * ((b.stimulus#>>'{qualities,power,score}')::numeric+10) +
        (100-abs((b.stimulus#>>'{qualities,stability,score}')::numeric-(b.proxy#>>'{qualities,stability}')::numeric)) * ((b.stimulus#>>'{qualities,stability,score}')::numeric+10) +
        (100-abs((b.stimulus#>>'{qualities,mobility,score}')::numeric-(b.proxy#>>'{qualities,mobility}')::numeric)) * ((b.stimulus#>>'{qualities,mobility,score}')::numeric+10)
      ) / greatest(1,
        ((b.stimulus#>>'{qualities,strength,score}')::numeric+10)+
        ((b.stimulus#>>'{qualities,conditioning,score}')::numeric+10)+
        ((b.stimulus#>>'{qualities,muscular_endurance,score}')::numeric+10)+
        ((b.stimulus#>>'{qualities,power,score}')::numeric+10)+
        ((b.stimulus#>>'{qualities,stability,score}')::numeric+10)+
        ((b.stimulus#>>'{qualities,mobility,score}')::numeric+10)
      )
      * 0.85
      + case
          when coalesce(p_target_region,'')='' then 15
          when b.body_region=p_target_region then 15
          when b.body_region='Full Body' then 12
          else 4
        end
    )) as stimulus_fit,
    case upper(coalesce(p_progression_intent,''))
      when 'PROGRESS' then case coalesce(b.recommendation,'') when 'PROGRESS_RECOMMENDED' then 95 when 'PROGRESS_POSSIBLE' then 90 when 'MAINTAIN' then 60 when 'LEARN' then 35 when 'RECOVER' then 10 else 45 end
      when 'MAINTAIN' then case coalesce(b.recommendation,'') when 'MAINTAIN' then 90 when 'LEARN' then 70 when 'PROGRESS_POSSIBLE' then 70 when 'PROGRESS_RECOMMENDED' then 65 when 'RECOVER' then 20 else 60 end
      when 'CONSOLIDATE' then case coalesce(b.recommendation,'') when 'MAINTAIN' then 92 when 'LEARN' then 75 when 'PROGRESS_POSSIBLE' then 70 when 'PROGRESS_RECOMMENDED' then 65 when 'RECOVER' then 20 else 60 end
      when 'DELOAD' then case coalesce(b.recommendation,'') when 'RECOVER' then 85 when 'LEARN' then 75 when 'MAINTAIN' then 75 when 'PROGRESS_POSSIBLE' then 45 when 'PROGRESS_RECOMMENDED' then 40 else 60 end
      when 'RECALIBRATE' then case when coalesce(b.exposure_count,0)=0 then 90 when coalesce(b.capability_freshness,0)<0.35 then 92 when coalesce(b.overall_confidence,0)<35 then 85 else 60 end
      when 'EXPLORE' then case when coalesce(b.exposure_count,0)=0 then 95 when coalesce(b.exposure_count,0)<=2 then 80 else 50 end
      else case coalesce(b.recommendation,'') when 'PROGRESS_RECOMMENDED' then 90 when 'PROGRESS_POSSIBLE' then 85 when 'MAINTAIN' then 75 when 'LEARN' then 60 when 'RECOVER' then 20 else 65 end
    end::numeric as progression_fit,
    greatest(0,least(100,
      case
        when cardinality(b.tracking_modes)=0 then 35
        when 'load'=any(b.tracking_modes) and not exists(
          select 1 from jsonb_array_elements(case when jsonb_typeof(coalesce(p_inventory,'[]'::jsonb))='array' then coalesce(p_inventory,'[]'::jsonb) else '[]'::jsonb end) x
          where nullif(x->>'load_kg','') is not null or nullif(x->>'max_load_kg','') is not null or nullif(x->>'min_load_kg','') is not null
        ) then 55
        else 78
      end
      + case when b.prescription_type is not null then 8 else 0 end
      + least(12,coalesce(b.capability_confidence,0)*12)
    )) as prescription_fit,
    greatest(0,least(100,
      case when b.technical_complexity*20 > (b.stimulus#>>'{complexity,score}')::numeric
        then 100-abs(b.technical_complexity*20-(b.stimulus#>>'{complexity,score}')::numeric)*1.35
        else 100-abs(b.technical_complexity*20-(b.stimulus#>>'{complexity,score}')::numeric)*0.55 end
    )) as complexity_fit,
    50::numeric as weekly_coherence,
    greatest(0,least(100,
      case when b.fatigue_score*20 > (b.stimulus#>>'{local_fatigue,score}')::numeric
        then 100-abs(b.fatigue_score*20-(b.stimulus#>>'{local_fatigue,score}')::numeric)*1.20
        else 100-abs(b.fatigue_score*20-(b.stimulus#>>'{local_fatigue,score}')::numeric)*0.50 end
    )) as fatigue_fit,
    greatest(0,least(100,100 - b.exact_recent*25 - greatest(b.family_recent-b.exact_recent,0)*7))::numeric as session_similarity,
    greatest(0,least(100,coalesce(nullif(b.pi_fit->>'score','')::numeric,50)))::numeric as progression_intelligence_fit
  from base b
), final as (
  select s.*,
    round(
      s.stimulus_fit*0.28 +
      s.progression_fit*0.14 +
      s.prescription_fit*0.14 +
      s.complexity_fit*0.10 +
      s.weekly_coherence*0.05 +
      s.fatigue_fit*0.13 +
      s.session_similarity*0.08 +
      s.progression_intelligence_fit*0.08,2
    ) candidate_score
  from scored s
)
select exercise_id,exercise_name,movement_pattern,exercise_family,body_region,candidate_score,
       jsonb_build_object(
         'stimulus_fit',round(stimulus_fit,2),
         'progression_fit',round(progression_fit,2),
         'progression_intelligence_fit',round(progression_intelligence_fit,2),
         'progression_intelligence',pi_fit,
         'prescription_fit',round(prescription_fit,2),
         'complexity_fit',round(complexity_fit,2),
         'weekly_coherence',weekly_coherence,
         'weekly_coherence_reason','weekly_loop_intent_and_region_supplied_by_d',
         'fatigue_fit',round(fatigue_fit,2),
         'session_similarity',round(session_similarity,2),
         'recent_exact_sessions',exact_recent,
         'recent_family_sessions',family_recent,
         'hard_gate_pass',true,
         'score_weights',jsonb_build_object(
           'stimulus',0.28,'progression',0.14,'progression_intelligence',0.08,'prescription',0.14,
           'complexity',0.10,'weekly_coherence',0.05,'fatigue',0.13,'session_similarity',0.08
         )
       ) score_components,
       proxy stimulus_proxy,
       public.c2_solver_prescription(p_user_id,exercise_id,stimulus,
         case when p_focus='Strength' then 'STRENGTH' when p_focus in ('Conditioning','Fat Loss') then 'AMRAP' else 'CIRCUIT' end,
         p_progression_intent,p_inventory) prescription_simulation
from final
order by candidate_score desc,exercise_id
limit greatest(1,least(coalesce(p_limit,20),100));
$function$;;



-- SOURCE MIGRATION: 20260812010640_pi3_weekly_loop_session_engine_bridge.sql
create or replace function public.d_resolve_session_context(
  p_user_id uuid,
  p_anchor_date date default current_date,
  p_duration_minutes integer default 45,
  p_readiness text default 'normal'::text,
  p_focus_override text default null,
  p_target_region_override text default null,
  p_progression_intent_override text default null
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $function$
declare
  v_anchor date:=coalesce(p_anchor_date,current_date);
  v_week date:=public.d_week_start(coalesce(p_anchor_date,current_date));
  v_target int;
  v_goal text;
  v_item public.user_training_plan_items%rowtype;
  v_active public.user_training_plan_items%rowtype;
  v_active_session public.workout_sessions%rowtype;
  v_completed_count int;
  v_last record;
  v_exception_ratio numeric:=0;
  v_intent text;
  v_focus text;
  v_region text;
  v_reasons text[]:='{}'::text[];
  v_override_intent text:=upper(nullif(trim(coalesce(p_progression_intent_override,'')),''));
  v_readiness text:=lower(trim(coalesce(p_readiness,'normal')));
  v_capability_rows int:=0;
  v_confident_rows int:=0;
  v_pi jsonb:='{}'::jsonb;
  v_pi_hint text:='MAINTAIN';
  v_pi_stage text:='LOW';
  v_planned_intent text;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then
    raise exception 'Cannot resolve another user session context';
  end if;

  perform public.d_ensure_week_plan(p_user_id,v_anchor,false);

  select weekly_session_target,primary_goal into v_target,v_goal
  from public.user_training_weeks
  where user_id=p_user_id and week_start=v_week;

  select i.* into v_active
  from public.user_training_plan_items i
  join public.workout_sessions ws on ws.id=i.session_id and ws.user_id=i.user_id
  where i.user_id=p_user_id
    and i.status='claimed'
    and ws.status in ('generated','in_progress')
  order by coalesce(i.claimed_at,i.updated_at) desc
  limit 1;

  if found then
    select * into v_active_session
    from public.workout_sessions
    where id=v_active.session_id;

    if v_active_session.status='in_progress'
       and v_active_session.started_local_date=v_anchor then
      return jsonb_build_object(
        'status','RESUME_EXISTING',
        'version','d1-session-context-v4-pi',
        'week_start',v_week,
        'plan_item_id',v_active.id,
        'resume_session_id',v_active.session_id,
        'focus',v_active.planned_focus,
        'target_region',v_active.planned_target_region,
        'progression_intent',v_active.planned_progression_intent,
        'started_local_date',v_active_session.started_local_date,
        'frozen_for_local_day',true,
        'reason_codes',jsonb_build_array('daily_session:resume_started_today')
      );
    end if;

    delete from public.session_stimulus_ledger
    where session_id=v_active.session_id
      and metadata_json->>'source'='phase_d_weekly_loop';

    update public.workout_sessions
    set status='abandoned',
        planning_context_json=coalesce(planning_context_json,'{}'::jsonb)||jsonb_build_object(
          'daily_refresh',jsonb_build_object(
            'released_at',now(),
            'released_for_local_date',v_anchor,
            'reason',case
              when v_active_session.status='generated' then 'new_checkin_before_start'
              else 'new_local_day_after_started_session'
            end
          )
        ),
        updated_at=now()
    where id=v_active.session_id;

    update public.user_training_plan_items
    set status=case when week_start<v_week then 'skipped' else 'available' end,
        session_id=null,
        claimed_at=null,
        updated_at=now(),
        planning_context_json=coalesce(planning_context_json,'{}'::jsonb)||jsonb_build_object(
          'daily_refresh_released_session_id',v_active.session_id,
          'daily_refresh_released_at',now()
        )
    where id=v_active.id;

    v_reasons:=array_append(v_reasons,
      case when v_active_session.status='generated'
        then 'daily_session:rebuild_for_new_checkin'
        else 'daily_session:unfreeze_new_local_day'
      end
    );
  end if;

  select directive_json into v_pi
  from public.user_coaching_directive_runtime
  where user_id=p_user_id;
  if v_pi is null then
    v_pi:=public.pi_coaching_directives(p_user_id,v_anchor,90);
  end if;
  v_pi_hint:=upper(coalesce(v_pi#>>'{session_recommendation,progression_intent_hint}','MAINTAIN'));
  v_pi_stage:=upper(coalesce(v_pi#>>'{data_maturity,stage}','LOW'));

  select count(*) into v_completed_count
  from public.workout_sessions ws
  where ws.user_id=p_user_id and ws.status='completed'
    and coalesce(ws.completed_at,ws.created_at)::date between v_week and v_week+6;

  select count(*),count(*) filter(where confidence>=0.60)
  into v_capability_rows,v_confident_rows
  from public.user_exercise_capabilities where user_id=p_user_id;

  select ws.id,ws.global_rpe,ws.post_workout_feeling,ws.target_region,ws.completed_at into v_last
  from public.workout_sessions ws
  where ws.user_id=p_user_id and ws.status='completed'
  order by coalesce(ws.completed_at,ws.updated_at) desc
  limit 1;

  if v_last.id is not null then
    select coalesce(avg(case coalesce(wse.user_execution_status,'pending')
      when 'completed' then 0 when 'adapted' then 1 else 1 end),0)
    into v_exception_ratio
    from public.workout_session_exercises wse where wse.session_id=v_last.id;
  end if;

  select i.* into v_item
  from public.user_training_plan_items i
  where i.user_id=p_user_id and i.week_start=v_week and i.status='available'
  order by case when i.recommended_date<=v_anchor then 0 else 1 end,
    i.recommended_date,i.sequence_index
  limit 1 for update;

  v_planned_intent:=upper(coalesce(v_item.planned_progression_intent,'MAINTAIN'));

  if p_focus_override in ('General Fitness','Fat Loss','Muscle Gain','Strength','Conditioning') then
    v_focus:=p_focus_override;v_reasons:=array_append(v_reasons,'focus:user_or_profile_override');
  else
    v_focus:=coalesce(v_item.planned_focus,v_goal,'General Fitness');v_reasons:=array_append(v_reasons,'focus:weekly_plan');
  end if;

  if p_target_region_override in ('Upper','Lower','Core','Full Body') then
    v_region:=p_target_region_override;v_reasons:=array_append(v_reasons,'region:user_day_preference');
  else
    v_region:=coalesce(v_item.planned_target_region,'Full Body');v_reasons:=array_append(v_reasons,'region:weekly_rotation');
  end if;

  if v_override_intent in ('PROGRESS','MAINTAIN','CONSOLIDATE','DELOAD','RECALIBRATE','EXPLORE') then
    v_intent:=v_override_intent;v_reasons:=array_append(v_reasons,'intent:explicit_override');
  elsif v_readiness in ('low','faible') then
    v_intent:='DELOAD';v_reasons:=array_append(v_reasons,'intent:low_readiness');
  elsif v_last.id is not null and coalesce(v_last.global_rpe,0)>=9 and coalesce(v_last.post_workout_feeling,10)<=4 then
    v_intent:='DELOAD';v_reasons:=array_append(v_reasons,'intent:high_rpe_low_post_feeling');
  elsif v_exception_ratio>=0.50 then
    v_intent:='RECALIBRATE';v_reasons:=array_append(v_reasons,'intent:previous_session_many_exceptions');
  elsif v_last.id is not null and (coalesce(v_last.global_rpe,0)>=9 or coalesce(v_last.post_workout_feeling,10)<=3) then
    v_intent:='CONSOLIDATE';v_reasons:=array_append(v_reasons,'intent:recovery_guard');
  elsif v_item.id is null or v_completed_count>=v_target then
    if v_readiness in ('high','olympique') and v_confident_rows>=5 then
      v_intent:='EXPLORE';v_reasons:=array_append(v_reasons,'intent:extra_session_high_readiness_explore');
    else
      v_intent:='CONSOLIDATE';v_reasons:=array_append(v_reasons,'intent:extra_session_after_week_target');
    end if;
  elsif v_capability_rows<5 and v_completed_count=0 then
    v_intent:='RECALIBRATE';v_reasons:=array_append(v_reasons,'intent:sparse_capability_evidence');
  elsif v_pi_stage in ('MEDIUM','HIGH') and v_pi_hint='RECALIBRATE' and v_planned_intent<>'CONSOLIDATE' then
    v_intent:='RECALIBRATE';v_reasons:=array_append(v_reasons,'intent:progression_intelligence_recalibrate');
  elsif v_pi_stage in ('MEDIUM','HIGH') and v_pi_hint='CONSOLIDATE' and v_planned_intent='PROGRESS' then
    v_intent:='CONSOLIDATE';v_reasons:=array_append(v_reasons,'intent:progression_intelligence_consolidate');
  else
    v_intent:=coalesce(v_item.planned_progression_intent,'MAINTAIN');
    v_reasons:=array_append(v_reasons,'intent:weekly_plan');
    if v_pi_hint='PROGRESS' then
      v_reasons:=array_append(v_reasons,'pi:progress_signal_used_as_candidate_bias');
    elsif v_pi_hint='MAINTAIN' then
      v_reasons:=array_append(v_reasons,'pi:no_strong_intent_override');
    end if;
  end if;

  return jsonb_build_object(
    'status','READY','version','d1-session-context-v4-pi','week_start',v_week,'week_end',v_week+6,
    'plan_item_id',v_item.id,'sequence_index',v_item.sequence_index,'recommended_date',v_item.recommended_date,
    'weekly_session_target',v_target,'completed_before',v_completed_count,'remaining_before',greatest(0,v_target-v_completed_count),
    'extra_session',v_item.id is null,
    'focus',v_focus,'target_region',v_region,'progression_intent',v_intent,
    'daily_refresh',jsonb_build_object('new_checkin_rebuilds_unstarted_session',true,'started_session_frozen_for_local_day_only',true),
    'capability_evidence',jsonb_build_object('rows',v_capability_rows,'confident_rows',v_confident_rows),
    'progression_intelligence',jsonb_build_object(
      'version',v_pi->>'version',
      'data_maturity',coalesce(v_pi->'data_maturity','{}'::jsonb),
      'session_recommendation',coalesce(v_pi->'session_recommendation','{}'::jsonb),
      'guardrails',coalesce(v_pi->'guardrails','{}'::jsonb)
    ),
    'previous_session',case when v_last.id is null then '{}'::jsonb else jsonb_build_object(
      'session_id',v_last.id,'global_rpe',v_last.global_rpe,'post_workout_feeling',v_last.post_workout_feeling,
      'target_region',v_last.target_region,'exception_ratio',round(v_exception_ratio,3)
    ) end,
    'reason_codes',to_jsonb(v_reasons),
    'weekly_stimulus_balance',coalesce((select jsonb_agg(jsonb_build_object(
      'stimulus_type',b.stimulus_type,'stimulus_key',b.stimulus_key,'unit',b.unit,'target_value',b.target_value,
      'planned_from_sessions',b.planned_from_sessions,'realized_value',b.realized_value,'remaining_to_target',b.remaining_to_target
    ) order by b.stimulus_type,b.stimulus_key) from public.weekly_stimulus_balance b where b.user_id=p_user_id and b.week_start=v_week),'[]'::jsonb)
  );
end;
$function$;

create or replace function public.d_generate_adaptive_session(
  p_user_id uuid,
  p_focus_override text,
  p_duration_minutes integer,
  p_readiness text,
  p_target_region_override text default null,
  p_progression_intent_override text default null,
  p_zone_terms text[] default '{}'::text[],
  p_inventory jsonb default '[]'::jsonb,
  p_available_equipment text[] default '{}'::text[],
  p_max_complexity integer default 3,
  p_max_difficulty text default 'Intermédiaire'::text,
  p_candidate_count integer default 12,
  p_policy_key text default 'c4-final-default'::text,
  p_anchor_date date default current_date
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $function$
declare
  v_context jsonb;
  v_generated jsonb;
  v_session_id uuid;
  v_plan_item_id uuid;
  v_existing jsonb;
  v_anchor date:=coalesce(p_anchor_date,current_date);
  v_pi jsonb;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;

  v_pi:=public.pi_refresh_coaching_directives(p_user_id,v_anchor,90);

  v_context:=public.d_resolve_session_context(
    p_user_id,v_anchor,p_duration_minutes,p_readiness,p_focus_override,p_target_region_override,p_progression_intent_override
  );

  if v_context->>'status'='RESUME_EXISTING' then
    select generated_workout into v_existing from public.workout_sessions
    where id=(v_context->>'resume_session_id')::uuid and user_id=p_user_id;
    return jsonb_build_object(
      'status','resume_existing','version','d1-adaptive-generation-v3-pi','session_id',(v_context->>'resume_session_id')::uuid,
      'weekly_loop',v_context,'generated_workout',coalesce(v_existing,'{}'::jsonb),
      'progression_intelligence',jsonb_build_object('frozen_session_unchanged',true,'runtime_refreshed',true)
    );
  end if;

  v_generated:=public.c4_generate_full_session(
    p_user_id,
    coalesce(v_context->>'focus',p_focus_override,'General Fitness'),
    p_duration_minutes,
    p_readiness,
    nullif(v_context->>'target_region',''),
    nullif(v_context->>'progression_intent',''),
    p_zone_terms,p_inventory,p_available_equipment,p_max_complexity,p_max_difficulty,p_candidate_count,p_policy_key
  );

  if coalesce(v_generated->>'status','')<>'generated' or nullif(v_generated->>'session_id','') is null then
    return v_generated||jsonb_build_object('weekly_loop',v_context,'version','d1-adaptive-generation-v3-pi');
  end if;

  v_session_id:=(v_generated->>'session_id')::uuid;
  v_plan_item_id:=nullif(v_context->>'plan_item_id','')::uuid;

  update public.workout_sessions set
    generation_local_date=v_anchor,
    planning_context_json=coalesce(planning_context_json,'{}'::jsonb)||jsonb_build_object(
      'weekly_loop',v_context,
      'weekly_loop_version','d1-weekly-loop-v1',
      'progression_intelligence',coalesce(v_context->'progression_intelligence','{}'::jsonb),
      'daily_refresh',jsonb_build_object('generation_local_date',v_anchor,'started_session_frozen_for_local_day_only',true)
    ),updated_at=now()
  where id=v_session_id and user_id=p_user_id;

  update public.workout_session_exercises wse
  set solver_decision_json=coalesce(wse.solver_decision_json,'{}'::jsonb)||jsonb_build_object(
    'progression_intelligence',public.pi_candidate_fit(p_user_id,wse.exercise_id,v_context->>'progression_intent')
  )
  where wse.session_id=v_session_id;

  if v_plan_item_id is not null then
    update public.user_training_plan_items set
      status='claimed',session_id=v_session_id,claimed_at=now(),updated_at=now(),
      planning_context_json=planning_context_json||jsonb_build_object(
        'claimed_session_id',v_session_id,'claimed_at',now(),'resolved_context',v_context
      )
    where id=v_plan_item_id and user_id=p_user_id and status='available';
    if not found then raise exception 'Weekly plan item could not be claimed'; end if;
  end if;

  perform public.d_sync_session_stimulus_ledger(v_session_id);

  return v_generated||jsonb_build_object(
    'version','d1-adaptive-generation-v3-pi','weekly_loop',v_context,
    'progression_intelligence',coalesce(v_context->'progression_intelligence','{}'::jsonb),
    'meta',coalesce(v_generated->'meta','{}'::jsonb)||jsonb_build_object(
      'weekly_loop',v_context,'weekly_loop_version','d1-weekly-loop-v1','generation_local_date',v_anchor,
      'progression_intelligence_version',v_pi->>'version'
    )
  );
end;
$function$;;



-- SOURCE MIGRATION: 20260812011137_pi3_restrict_internal_surfaces.sql
revoke execute on function public.pi_coaching_directives(uuid,date,integer) from public,anon,authenticated;
revoke execute on function public.pi_exercise_directives(uuid,date,integer) from public,anon,authenticated;
revoke execute on function public.pi_pattern_directives(uuid,date,integer) from public,anon,authenticated;
revoke execute on function public.pi_refresh_coaching_directives(uuid,date,integer) from public,anon,authenticated;
revoke execute on function public.pi_candidate_fit(uuid,text,text) from public,anon,authenticated;
revoke all on table public.user_coaching_directive_runtime from public,anon,authenticated;;



-- SOURCE MIGRATION: 20260812012548_qa_c4_expand_search_on_no_final_candidate.sql
create or replace function public.solve_session_engine_c4(
  p_user_id uuid,
  p_focus text,
  p_duration_minutes integer,
  p_readiness text,
  p_target_region text default null::text,
  p_progression_intent text default null::text,
  p_zone_terms text[] default '{}'::text[],
  p_inventory jsonb default '[]'::jsonb,
  p_max_complexity integer default 3,
  p_max_difficulty text default 'Intermédiaire'::text,
  p_candidate_count integer default 10,
  p_exact_wod_minutes integer default null::integer,
  p_policy_key text default 'c4-final-default'::text
) returns jsonb
language plpgsql
stable
set search_path to 'public'
as $function$
declare
  v_first jsonb;
  v_retry jsonb;
  v_requested int:=greatest(1,least(coalesce(p_candidate_count,10),20));
begin
  v_first:=public.solve_session_engine_c4_raw_v15(
    p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
    p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty,v_requested,
    p_exact_wod_minutes,p_policy_key
  );

  if coalesce(v_first->>'status','')='READY' or v_requested>=20 then
    return jsonb_set(
      v_first || jsonb_build_object('search_fallback_used',false,'initial_candidate_count',v_requested,'final_candidate_count',v_requested),
      '{version}','"c4-final-v1.6"'::jsonb,true
    );
  end if;

  v_retry:=public.solve_session_engine_c4_raw_v15(
    p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
    p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty,20,
    p_exact_wod_minutes,p_policy_key
  );

  return jsonb_set(
    v_retry || jsonb_build_object(
      'search_fallback_used',true,
      'initial_status',v_first->>'status',
      'initial_candidate_count',v_requested,
      'final_candidate_count',20
    ),
    '{version}','"c4-final-v1.6"'::jsonb,true
  );
end;
$function$;

revoke all on function public.solve_session_engine_c4(uuid,text,integer,text,text,text,text[],jsonb,integer,text,integer,integer,text) from public, anon, authenticated;
grant execute on function public.solve_session_engine_c4(uuid,text,integer,text,text,text,text[],jsonb,integer,text,integer,integer,text) to service_role;;



-- SOURCE MIGRATION: 20260812013057_qa_c2_region_and_mechanic_diversity.sql
create or replace function public.simulate_session_engine_c2_raw(
  p_user_id uuid,
  p_focus text,
  p_duration_minutes integer,
  p_readiness text,
  p_target_region text default null::text,
  p_progression_intent text default null::text,
  p_zone_terms text[] default '{}'::text[],
  p_inventory jsonb default '[]'::jsonb,
  p_max_complexity integer default 3,
  p_max_difficulty text default 'Intermédiaire'::text,
  p_candidate_count integer default 5
) returns jsonb
language sql
stable
set search_path to 'public'
as $function$
with stimulus as (
  select public.build_session_stimulus_target(
    p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,'c1-default'
  ) s
), mechanic_ranked as (
  select wm.mechanic_key,wm.display_name,
         public.c2_mechanic_fit(wm.mechanic_key,(select s from stimulus),p_progression_intent) fit,
         row_number() over(order by public.c2_mechanic_fit(wm.mechanic_key,(select s from stimulus),p_progression_intent) desc,wm.mechanic_key) rn
  from public.workout_mechanics wm
  where wm.active and wm.auto_free_eligible and wm.mechanic_kind='core'
), top_mechanics as (
  select * from mechanic_ranked where rn<=3
), pool_raw as (
  select cp.*,e.transition_cost,e.training_focus,
         coalesce((select array_agg(em.muscle_id order by em.muscle_id)
                   from public.exercise_muscles em
                   where em.exercise_id=cp.exercise_id and em.priority='primary'),'{}'::text[]) primary_muscles
  from public.c2_candidate_pool(
    p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
    p_zone_terms,p_inventory,'WOD',p_max_complexity,p_max_difficulty,14
  ) cp
  join public.exercises e on e.id=cp.exercise_id
), pool as (
  select row_number() over(order by candidate_score desc,exercise_id)::int rn,*
  from pool_raw
), combos as (
  select
    a.exercise_id e1,a.exercise_name n1,a.movement_pattern p1,a.exercise_family f1,a.body_region r1,
    a.candidate_score s1,a.score_components sc1,a.primary_muscles m1,coalesce(a.transition_cost,2) t1,a.training_focus tf1,
    b.exercise_id e2,b.exercise_name n2,b.movement_pattern p2,b.exercise_family f2,b.body_region r2,
    b.candidate_score s2,b.score_components sc2,b.primary_muscles m2,coalesce(b.transition_cost,2) t2,b.training_focus tf2,
    c.exercise_id e3,c.exercise_name n3,c.movement_pattern p3,c.exercise_family f3,c.body_region r3,
    c.candidate_score s3,c.score_components sc3,c.primary_muscles m3,coalesce(c.transition_cost,2) t3,c.training_focus tf3,
    m.mechanic_key,m.fit mechanic_fit
  from pool a
  join pool b on b.rn>a.rn
  join pool c on c.rn>b.rn
  cross join top_mechanics m
), assessed as (
  select x.*,
    (select count(distinct q) from unnest(array[x.p1,x.p2,x.p3]) q) pattern_count,
    (select count(distinct q) from unnest(array[x.f1,x.f2,x.f3]) q) family_count,
    ((case when x.r1=p_target_region then 1 else 0 end)
     +(case when x.r2=p_target_region then 1 else 0 end)
     +(case when x.r3=p_target_region then 1 else 0 end))::int target_region_match_count,
    case
      when exists(
        select 1 from (
          select muscle_id,count(*) cnt
          from (
            select unnest(x.m1) muscle_id
            union all select unnest(x.m2)
            union all select unnest(x.m3)
          ) u group by muscle_id
        ) z where cnt>=3
      ) then 3
      when exists(
        select 1 from (
          select muscle_id,count(*) cnt
          from (
            select unnest(x.m1) muscle_id
            union all select unnest(x.m2)
            union all select unnest(x.m3)
          ) u group by muscle_id
        ) z where cnt=2
      ) then 2
      else 1
    end max_primary_overlap,
    (x.p1 in ('Conditioning','Locomotion') or x.p2 in ('Conditioning','Locomotion') or x.p3 in ('Conditioning','Locomotion')
     or x.tf1='Conditioning' or x.tf2='Conditioning' or x.tf3='Conditioning') has_conditioning_anchor,
    round((x.s1+x.s2+x.s3)/3.0,2) avg_exercise_score,
    round((x.t1+x.t2+x.t3)/3.0,2) avg_transition_cost
  from combos x
), filtered as (
  select a.*,
    greatest(0,least(100,a.pattern_count/3.0*100))::numeric pattern_diversity,
    case when a.max_primary_overlap>=3 then 35 when a.max_primary_overlap=2 then 72 else 100 end::numeric muscle_diversity
  from assessed a
  where a.pattern_count>=2
    and (p_focus not in ('Conditioning','Fat Loss') or a.has_conditioning_anchor)
    and (
      p_target_region not in ('Upper','Lower','Core')
      or a.target_region_match_count >= case when p_focus in ('Conditioning','Fat Loss') then 1 else 2 end
    )
), scored as (
  select f.*,
    round(f.avg_exercise_score*0.70 + f.pattern_diversity*0.10 + f.muscle_diversity*0.10 + f.mechanic_fit*0.10,2) session_score
  from filtered f
), ranked_sessions as (
  select s.*,
    row_number() over(partition by mechanic_key order by session_score desc,e1,e2,e3) mechanic_rank
  from scored s
), top_sessions as (
  select * from ranked_sessions
  where mechanic_rank <= greatest(1,ceil(greatest(1,least(coalesce(p_candidate_count,5),20))/3.0)::int)
  order by session_score desc,mechanic_key,e1,e2,e3
  limit greatest(1,least(coalesce(p_candidate_count,5),20))
), mechanics_json as (
  select coalesce(jsonb_agg(
    jsonb_build_object('mechanic_key',mechanic_key,'display_name',display_name,'fit',fit)
    order by fit desc,mechanic_key
  ),'[]'::jsonb) j
  from top_mechanics
), sessions_json as (
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'coach_score',session_score,
      'mechanic',mechanic_key,
      'mechanic_fit',mechanic_fit,
      'session_components',jsonb_build_object(
        'avg_exercise_coach_score',avg_exercise_score,
        'pattern_diversity',round(pattern_diversity,2),
        'muscle_diversity',muscle_diversity,
        'max_primary_muscle_overlap',max_primary_overlap,
        'conditioning_anchor',has_conditioning_anchor,
        'target_region_match_count',target_region_match_count,
        'target_region',p_target_region,
        'avg_transition_cost',avg_transition_cost
      ),
      'exercises',jsonb_build_array(
        jsonb_build_object('exercise_id',e1,'name',n1,'pattern',p1,'family',f1,'candidate_score',s1,'components',sc1,
          'prescription',public.c2_solver_prescription(p_user_id,e1,(select s from stimulus),mechanic_key,p_progression_intent,p_inventory)),
        jsonb_build_object('exercise_id',e2,'name',n2,'pattern',p2,'family',f2,'candidate_score',s2,'components',sc2,
          'prescription',public.c2_solver_prescription(p_user_id,e2,(select s from stimulus),mechanic_key,p_progression_intent,p_inventory)),
        jsonb_build_object('exercise_id',e3,'name',n3,'pattern',p3,'family',f3,'candidate_score',s3,'components',sc3,
          'prescription',public.c2_solver_prescription(p_user_id,e3,(select s from stimulus),mechanic_key,p_progression_intent,p_inventory))
      )
    ) order by session_score desc,mechanic_key,e1,e2,e3
  ),'[]'::jsonb) j from top_sessions
)
select jsonb_build_object(
  'version','c2-sim-v1.2',
  'simulation_only',true,
  'mutates_production_state',false,
  'stimulus',(select s from stimulus),
  'normalized_zones',public.normalize_body_zone_ids(coalesce(p_zone_terms,'{}'::text[])),
  'hard_gate_priority',(select s->'hard_gate_priority' from stimulus),
  'pool_count',(select count(*) from pool),
  'top_mechanics',(select j from mechanics_json),
  'candidate_sessions',(select j from sessions_json),
  'candidate_search_contract',jsonb_build_object(
    'explicit_region_enforced_before_c4',true,
    'mechanic_diversity_quota',true,
    'top_mechanics_considered',(select count(*) from top_mechanics)
  ),
  'known_limitations',jsonb_build_array(
    'whole_wod_round_time_and_volume_simulation_deferred_to_c3',
    'numeric_load_requires_confirmed_inventory_and_capability',
    'exercise_stimulus_is_a_catalog_proxy_until_contextual_simulation_c3'
  )
);
$function$;

create or replace function public.simulate_session_engine_c2(
  p_user_id uuid,
  p_focus text,
  p_duration_minutes integer,
  p_readiness text,
  p_target_region text default null::text,
  p_progression_intent text default null::text,
  p_zone_terms text[] default '{}'::text[],
  p_inventory jsonb default '[]'::jsonb,
  p_max_complexity integer default 3,
  p_max_difficulty text default 'Intermédiaire'::text,
  p_candidate_count integer default 5
) returns jsonb
language plpgsql
stable
set search_path to 'public'
as $function$
declare
  v_raw jsonb;
  v_filtered jsonb;
  v_requires_anchor boolean := p_focus in ('Conditioning','Fat Loss');
  v_status text := 'OK';
begin
  v_raw := public.simulate_session_engine_c2_raw(
    p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
    p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty,p_candidate_count
  );

  if v_requires_anchor then
    select coalesce(jsonb_agg(s order by ord),'[]'::jsonb)
    into v_filtered
    from jsonb_array_elements(coalesce(v_raw->'candidate_sessions','[]'::jsonb)) with ordinality t(s,ord)
    where exists (
      select 1 from jsonb_array_elements(coalesce(s->'exercises','[]'::jsonb)) e
      where e->>'pattern' in ('Conditioning','Locomotion')
    );
    if jsonb_array_length(v_filtered)=0 then v_status := 'NO_SAFE_COHERENT_WOD'; end if;
  else
    v_filtered := coalesce(v_raw->'candidate_sessions','[]'::jsonb);
    if jsonb_array_length(v_filtered)=0 then v_status := 'NO_SAFE_COHERENT_WOD'; end if;
  end if;

  return jsonb_set(
    jsonb_set(
      jsonb_set(v_raw,'{version}','"c2-sim-v1.2"'::jsonb,true),
      '{candidate_sessions}',v_filtered,true
    ),
    '{coherence_gate}',
    jsonb_build_object(
      'status',v_status,
      'conditioning_anchor_required',v_requires_anchor,
      'conditioning_anchor_definition','movement_pattern in Conditioning|Locomotion',
      'explicit_target_region_enforced',p_target_region in ('Upper','Lower','Core'),
      'never_force_when_no_safe_coherent_candidate',true
    ),true
  );
end;
$function$;

revoke all on function public.simulate_session_engine_c2_raw(uuid,text,integer,text,text,text,text[],jsonb,integer,text,integer) from public,anon,authenticated;
revoke all on function public.simulate_session_engine_c2(uuid,text,integer,text,text,text,text[],jsonb,integer,text,integer) from public,anon,authenticated;
grant execute on function public.simulate_session_engine_c2_raw(uuid,text,integer,text,text,text,text[],jsonb,integer,text,integer) to service_role;
grant execute on function public.simulate_session_engine_c2(uuid,text,integer,text,text,text,text[],jsonb,integer,text,integer) to service_role;;



-- SOURCE MIGRATION: 20260812013238_qa_c4_expansion_preserve_target_region.sql
create or replace function public.c4_expand_candidate_to_block_rules_c42_base(
  p_candidate jsonb,
  p_user_id uuid,
  p_focus text,
  p_duration_minutes integer,
  p_readiness text,
  p_target_region text,
  p_progression_intent text,
  p_zone_terms text[],
  p_inventory jsonb,
  p_max_complexity integer,
  p_max_difficulty text
) returns jsonb
language plpgsql
stable
set search_path to 'public'
as $function$
declare
  v_mechanic text:=upper(coalesce(p_candidate->>'mechanic',''));
  v_exercises jsonb:=coalesce(p_candidate->'exercises','[]'::jsonb);
  v_original jsonb:=v_exercises;
  v_count int:=jsonb_array_length(v_exercises);
  v_min int:=0;v_max int:=99;v_pref int;
  v_target int;
  v_needed int;
  r record;
  v_added jsonb:='[]'::jsonb;
  v_trimmed jsonb:='[]'::jsonb;
  v_new jsonb:='[]'::jsonb;
  v_new_score numeric;
  v_stimulus jsonb;
  v_existing_patterns text[]:='{}'::text[];
  v_pass int;
  v_required_region int:=0;
  v_current_region int:=0;
begin
  select min_exercises,max_exercises,preferred_exercises into v_min,v_max,v_pref
  from public.block_rules where block_key='wod' and upper(coalesce(format,''))=v_mechanic and active order by id limit 1;

  if not found then
    return jsonb_set(p_candidate,'{c4_block_rules}',jsonb_build_object('rule_found',false,'exercise_count',v_count,'expanded',false,'dynamic_solver',false),true);
  end if;

  v_pref:=coalesce(v_pref,ceil((v_min+v_max)/2.0)::int);
  if v_min=v_max then v_target:=v_min;
  elsif p_duration_minutes<=35 then v_target:=v_min;
  elsif p_duration_minutes<=55 then v_target:=greatest(v_min,least(v_max,v_pref));
  else v_target:=greatest(v_min,least(v_max,v_pref+1)); end if;

  if v_mechanic in ('ODD_EVEN','COUPLET') then v_target:=2; end if;
  if v_mechanic='DECK' then v_target:=4; end if;
  if v_mechanic='PROGRESSIVE_INTERVAL' then
    if upper(coalesce(p_candidate->>'variant_key',''))='DEATH_BY' then v_target:=1;
    elsif upper(coalesce(p_candidate->>'variant_key',''))='DEATH_BY_COUPLET' then v_target:=2;
    else v_target:=greatest(v_min,least(v_max,2)); end if;
  end if;

  if p_target_region in ('Upper','Lower','Core') then
    v_required_region:=case
      when p_focus in ('Conditioning','Fat Loss') then greatest(1,floor(v_target/2.0)::int)
      else ceil(v_target*0.60)::int
    end;
  end if;

  if v_count>v_target then
    select coalesce(jsonb_agg(x order by ord),'[]'::jsonb) into v_new
    from (
      select value x,row_number() over(order by
        case when v_required_region>0 and e.body_region=p_target_region then 0 else 1 end,
        case when p_focus in ('Conditioning','Fat Loss') and (e.movement_pattern in ('Conditioning','Locomotion') or e.exercise_family in ('Conditioning','Locomotion')) then 0 else 1 end,
        coalesce((value->>'candidate_score')::numeric,0) desc,
        value->>'exercise_id') ord
      from jsonb_array_elements(v_exercises) value
      join public.exercises e on e.id=value->>'exercise_id'
      limit v_target
    ) q;
    select coalesce(jsonb_agg(value->>'exercise_id'),'[]'::jsonb) into v_trimmed
    from jsonb_array_elements(v_exercises) value
    where not exists(select 1 from jsonb_array_elements(v_new) z where z->>'exercise_id'=value->>'exercise_id');
    v_exercises:=v_new;v_count:=jsonb_array_length(v_exercises);
  end if;

  v_stimulus:=public.build_session_stimulus_target(p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,'c1-default');
  select coalesce(array_agg(distinct e.movement_pattern),'{}'::text[]),
         count(*) filter(where v_required_region>0 and e.body_region=p_target_region)
  into v_existing_patterns,v_current_region
  from jsonb_array_elements(v_exercises) x join public.exercises e on e.id=x->>'exercise_id';

  v_needed:=v_target-v_count;
  for v_pass in 1..2 loop
    exit when v_needed<=0;
    for r in
      select * from public.c2_candidate_pool(
        p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
        p_zone_terms,p_inventory,'WOD',p_max_complexity,p_max_difficulty,60
      ) cp
      where not exists(select 1 from jsonb_array_elements(v_exercises) e where e->>'exercise_id'=cp.exercise_id)
        and (v_pass=2 or not (cp.movement_pattern=any(v_existing_patterns)))
        and (v_required_region=0 or v_current_region>=v_required_region or cp.body_region=p_target_region)
      order by
        case when v_required_region>v_current_region and cp.body_region=p_target_region then 0 else 1 end,
        cp.candidate_score desc,cp.exercise_id
    loop
      exit when v_needed<=0;
      v_exercises:=v_exercises||jsonb_build_array(jsonb_build_object(
        'exercise_id',r.exercise_id,'name',r.exercise_name,'pattern',r.movement_pattern,'family',r.exercise_family,
        'candidate_score',r.candidate_score,'components',r.score_components,
        'prescription',public.c2_solver_prescription(p_user_id,r.exercise_id,v_stimulus,v_mechanic,p_progression_intent,p_inventory)
      ));
      v_existing_patterns:=array_append(v_existing_patterns,r.movement_pattern);
      if v_required_region>0 and r.body_region=p_target_region then v_current_region:=v_current_region+1; end if;
      v_added:=v_added||jsonb_build_array(r.exercise_id);v_needed:=v_needed-1;
    end loop;
  end loop;

  select round(coalesce(avg((x->>'candidate_score')::numeric),0)*0.90+coalesce((p_candidate->>'mechanic_fit')::numeric,0)*0.10,2)
  into v_new_score from jsonb_array_elements(v_exercises) x;

  return jsonb_set(jsonb_set(jsonb_set(p_candidate,'{exercises}',v_exercises,true),'{coach_score}',to_jsonb(v_new_score),true),
    '{c4_block_rules}',jsonb_build_object(
      'rule_found',true,'min_exercises',v_min,'max_exercises',v_max,'preferred_exercises',v_pref,
      'solver_target_exercises',v_target,'original_exercise_count',jsonb_array_length(v_original),
      'exercise_count',jsonb_array_length(v_exercises),'dynamic_solver',true,
      'added_exercise_ids',v_added,'trimmed_exercise_ids',v_trimmed,
      'target_region',p_target_region,'required_target_region_count',v_required_region,'final_target_region_count',v_current_region,
      'valid_count',jsonb_array_length(v_exercises) between v_min and v_max
    ),true);
end;
$function$;

revoke all on function public.c4_expand_candidate_to_block_rules_c42_base(jsonb,uuid,text,integer,text,text,text,text[],jsonb,integer,text) from public,anon,authenticated;
grant execute on function public.c4_expand_candidate_to_block_rules_c42_base(jsonb,uuid,text,integer,text,text,text,text[],jsonb,integer,text) to service_role;;



-- SOURCE MIGRATION: 20260812013515_qa_c2_conditioning_anchor_contract_consistency.sql
create or replace function public.simulate_session_engine_c2(
  p_user_id uuid,
  p_focus text,
  p_duration_minutes integer,
  p_readiness text,
  p_target_region text default null::text,
  p_progression_intent text default null::text,
  p_zone_terms text[] default '{}'::text[],
  p_inventory jsonb default '[]'::jsonb,
  p_max_complexity integer default 3,
  p_max_difficulty text default 'Intermédiaire'::text,
  p_candidate_count integer default 5
) returns jsonb
language plpgsql
stable
set search_path to 'public'
as $function$
declare
  v_raw jsonb;
  v_filtered jsonb;
  v_requires_anchor boolean := p_focus in ('Conditioning','Fat Loss');
  v_status text := 'OK';
begin
  v_raw := public.simulate_session_engine_c2_raw(
    p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
    p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty,p_candidate_count
  );

  if v_requires_anchor then
    select coalesce(jsonb_agg(s order by ord),'[]'::jsonb)
    into v_filtered
    from jsonb_array_elements(coalesce(v_raw->'candidate_sessions','[]'::jsonb)) with ordinality t(s,ord)
    where coalesce((s#>>'{session_components,conditioning_anchor}')::boolean,false);
    if jsonb_array_length(v_filtered)=0 then v_status := 'NO_SAFE_COHERENT_WOD'; end if;
  else
    v_filtered := coalesce(v_raw->'candidate_sessions','[]'::jsonb);
    if jsonb_array_length(v_filtered)=0 then v_status := 'NO_SAFE_COHERENT_WOD'; end if;
  end if;

  return jsonb_set(
    jsonb_set(
      jsonb_set(v_raw,'{version}','"c2-sim-v1.3"'::jsonb,true),
      '{candidate_sessions}',v_filtered,true
    ),
    '{coherence_gate}',
    jsonb_build_object(
      'status',v_status,
      'conditioning_anchor_required',v_requires_anchor,
      'conditioning_anchor_definition','movement_pattern in Conditioning|Locomotion OR training_focus=Conditioning',
      'explicit_target_region_enforced',p_target_region in ('Upper','Lower','Core'),
      'never_force_when_no_safe_coherent_candidate',true
    ),true
  );
end;
$function$;

revoke all on function public.simulate_session_engine_c2(uuid,text,integer,text,text,text,text[],jsonb,integer,text,integer) from public,anon,authenticated;
grant execute on function public.simulate_session_engine_c2(uuid,text,integer,text,text,text,text[],jsonb,integer,text,integer) to service_role;;



-- SOURCE MIGRATION: 20260812013709_qa_conditioning_anchor_uses_stimulus.sql
create or replace function public.simulate_session_engine_c2_raw(
  p_user_id uuid,
  p_focus text,
  p_duration_minutes integer,
  p_readiness text,
  p_target_region text default null::text,
  p_progression_intent text default null::text,
  p_zone_terms text[] default '{}'::text[],
  p_inventory jsonb default '[]'::jsonb,
  p_max_complexity integer default 3,
  p_max_difficulty text default 'Intermédiaire'::text,
  p_candidate_count integer default 5
) returns jsonb
language sql
stable
set search_path to 'public'
as $function$
with stimulus as (
  select public.build_session_stimulus_target(
    p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,'c1-default'
  ) s
), mechanic_ranked as (
  select wm.mechanic_key,wm.display_name,
         public.c2_mechanic_fit(wm.mechanic_key,(select s from stimulus),p_progression_intent) fit,
         row_number() over(order by public.c2_mechanic_fit(wm.mechanic_key,(select s from stimulus),p_progression_intent) desc,wm.mechanic_key) rn
  from public.workout_mechanics wm
  where wm.active and wm.auto_free_eligible and wm.mechanic_kind='core'
), top_mechanics as (
  select * from mechanic_ranked where rn<=3
), pool_raw as (
  select cp.*,e.transition_cost,e.training_focus,
         coalesce((select array_agg(em.muscle_id order by em.muscle_id)
                   from public.exercise_muscles em
                   where em.exercise_id=cp.exercise_id and em.priority='primary'),'{}'::text[]) primary_muscles
  from public.c2_candidate_pool(
    p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
    p_zone_terms,p_inventory,'WOD',p_max_complexity,p_max_difficulty,14
  ) cp
  join public.exercises e on e.id=cp.exercise_id
), pool as (
  select row_number() over(order by candidate_score desc,exercise_id)::int rn,*
  from pool_raw
), combos as (
  select
    a.exercise_id e1,a.exercise_name n1,a.movement_pattern p1,a.exercise_family f1,a.body_region r1,
    a.candidate_score s1,a.score_components sc1,a.stimulus_proxy sp1,a.primary_muscles m1,coalesce(a.transition_cost,2) t1,a.training_focus tf1,
    b.exercise_id e2,b.exercise_name n2,b.movement_pattern p2,b.exercise_family f2,b.body_region r2,
    b.candidate_score s2,b.score_components sc2,b.stimulus_proxy sp2,b.primary_muscles m2,coalesce(b.transition_cost,2) t2,b.training_focus tf2,
    c.exercise_id e3,c.exercise_name n3,c.movement_pattern p3,c.exercise_family f3,c.body_region r3,
    c.candidate_score s3,c.score_components sc3,c.stimulus_proxy sp3,c.primary_muscles m3,coalesce(c.transition_cost,2) t3,c.training_focus tf3,
    m.mechanic_key,m.fit mechanic_fit
  from pool a
  join pool b on b.rn>a.rn
  join pool c on c.rn>b.rn
  cross join top_mechanics m
), assessed as (
  select x.*,
    (select count(distinct q) from unnest(array[x.p1,x.p2,x.p3]) q) pattern_count,
    (select count(distinct q) from unnest(array[x.f1,x.f2,x.f3]) q) family_count,
    ((case when x.r1=p_target_region then 1 else 0 end)
     +(case when x.r2=p_target_region then 1 else 0 end)
     +(case when x.r3=p_target_region then 1 else 0 end))::int target_region_match_count,
    case
      when exists(
        select 1 from (
          select muscle_id,count(*) cnt from (
            select unnest(x.m1) muscle_id union all select unnest(x.m2) union all select unnest(x.m3)
          ) u group by muscle_id
        ) z where cnt>=3
      ) then 3
      when exists(
        select 1 from (
          select muscle_id,count(*) cnt from (
            select unnest(x.m1) muscle_id union all select unnest(x.m2) union all select unnest(x.m3)
          ) u group by muscle_id
        ) z where cnt=2
      ) then 2
      else 1
    end max_primary_overlap,
    (
      x.p1 in ('Conditioning','Locomotion') or x.p2 in ('Conditioning','Locomotion') or x.p3 in ('Conditioning','Locomotion')
      or x.tf1='Conditioning' or x.tf2='Conditioning' or x.tf3='Conditioning'
      or coalesce((x.sp1#>>'{qualities,conditioning}')::numeric,0)>=60
      or coalesce((x.sp2#>>'{qualities,conditioning}')::numeric,0)>=60
      or coalesce((x.sp3#>>'{qualities,conditioning}')::numeric,0)>=60
    ) has_conditioning_anchor,
    round((x.s1+x.s2+x.s3)/3.0,2) avg_exercise_score,
    round((x.t1+x.t2+x.t3)/3.0,2) avg_transition_cost
  from combos x
), filtered as (
  select a.*,
    greatest(0,least(100,a.pattern_count/3.0*100))::numeric pattern_diversity,
    case when a.max_primary_overlap>=3 then 35 when a.max_primary_overlap=2 then 72 else 100 end::numeric muscle_diversity
  from assessed a
  where a.pattern_count>=2
    and (p_focus not in ('Conditioning','Fat Loss') or a.has_conditioning_anchor)
    and (
      p_target_region not in ('Upper','Lower','Core')
      or a.target_region_match_count >= case when p_focus in ('Conditioning','Fat Loss') then 1 else 2 end
    )
), scored as (
  select f.*,
    round(f.avg_exercise_score*0.70 + f.pattern_diversity*0.10 + f.muscle_diversity*0.10 + f.mechanic_fit*0.10,2) session_score
  from filtered f
), ranked_sessions as (
  select s.*,row_number() over(partition by mechanic_key order by session_score desc,e1,e2,e3) mechanic_rank
  from scored s
), top_sessions as (
  select * from ranked_sessions
  where mechanic_rank <= greatest(1,ceil(greatest(1,least(coalesce(p_candidate_count,5),20))/3.0)::int)
  order by session_score desc,mechanic_key,e1,e2,e3
  limit greatest(1,least(coalesce(p_candidate_count,5),20))
), mechanics_json as (
  select coalesce(jsonb_agg(jsonb_build_object('mechanic_key',mechanic_key,'display_name',display_name,'fit',fit) order by fit desc,mechanic_key),'[]'::jsonb) j
  from top_mechanics
), sessions_json as (
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'coach_score',session_score,'mechanic',mechanic_key,'mechanic_fit',mechanic_fit,
      'session_components',jsonb_build_object(
        'avg_exercise_coach_score',avg_exercise_score,'pattern_diversity',round(pattern_diversity,2),
        'muscle_diversity',muscle_diversity,'max_primary_muscle_overlap',max_primary_overlap,
        'conditioning_anchor',has_conditioning_anchor,'conditioning_anchor_definition','pattern|focus|stimulus_proxy>=60',
        'target_region_match_count',target_region_match_count,'target_region',p_target_region,'avg_transition_cost',avg_transition_cost
      ),
      'exercises',jsonb_build_array(
        jsonb_build_object('exercise_id',e1,'name',n1,'pattern',p1,'family',f1,'candidate_score',s1,'components',sc1,
          'prescription',public.c2_solver_prescription(p_user_id,e1,(select s from stimulus),mechanic_key,p_progression_intent,p_inventory)),
        jsonb_build_object('exercise_id',e2,'name',n2,'pattern',p2,'family',f2,'candidate_score',s2,'components',sc2,
          'prescription',public.c2_solver_prescription(p_user_id,e2,(select s from stimulus),mechanic_key,p_progression_intent,p_inventory)),
        jsonb_build_object('exercise_id',e3,'name',n3,'pattern',p3,'family',f3,'candidate_score',s3,'components',sc3,
          'prescription',public.c2_solver_prescription(p_user_id,e3,(select s from stimulus),mechanic_key,p_progression_intent,p_inventory))
      )
    ) order by session_score desc,mechanic_key,e1,e2,e3
  ),'[]'::jsonb) j from top_sessions
)
select jsonb_build_object(
  'version','c2-sim-v1.4','simulation_only',true,'mutates_production_state',false,
  'stimulus',(select s from stimulus),'normalized_zones',public.normalize_body_zone_ids(coalesce(p_zone_terms,'{}'::text[])),
  'hard_gate_priority',(select s->'hard_gate_priority' from stimulus),'pool_count',(select count(*) from pool),
  'top_mechanics',(select j from mechanics_json),'candidate_sessions',(select j from sessions_json),
  'candidate_search_contract',jsonb_build_object('explicit_region_enforced_before_c4',true,'mechanic_diversity_quota',true,'conditioning_anchor_uses_stimulus',true),
  'known_limitations',jsonb_build_array('whole_wod_round_time_and_volume_simulation_deferred_to_c3','numeric_load_requires_confirmed_inventory_and_capability','exercise_stimulus_is_a_catalog_proxy_until_contextual_simulation_c3')
);
$function$;

create or replace function public.c4_candidate_quality_gate(
  p_candidate jsonb,p_readiness text,p_focus text,p_zone_terms text[],p_inventory jsonb,p_max_complexity integer,p_policy_key text default 'c4-final-default'::text
) returns jsonb
language plpgsql
stable
set search_path to 'public'
as $function$
declare
  v_cfg jsonb;
  v_mechanic text := upper(coalesce(p_candidate->>'mechanic',''));
  v_zone_ids text[] := public.normalize_body_zone_ids(coalesce(p_zone_terms,'{}'::text[]));
  v_readiness text := public.normalize_session_readiness(p_readiness);
  v_ex jsonb;e record;v_reasons jsonb := '[]'::jsonb;
  v_jump int := 0;v_high_impact int := 0;v_high_impact_threshold int := 4;v_high_impact_max int := 2;
  v_emom_tech int := 0;v_emom_fatigue int := 0;v_hinge5 boolean := false;v_jump5 boolean := false;v_anchor boolean := false;v_count int := 0;
begin
  select config into v_cfg from public.session_engine_policy where policy_key = p_policy_key;
  if v_cfg is null then raise exception 'Unknown C4 policy %', p_policy_key; end if;
  v_high_impact_threshold := coalesce((v_cfg#>>'{quality_gate,high_joint_impact_threshold}')::int,4);
  v_high_impact_max := case v_readiness when 'low' then coalesce((v_cfg#>>'{quality_gate,low_readiness_max_high_joint_impact_count}')::int,1) when 'high' then coalesce((v_cfg#>>'{quality_gate,high_readiness_max_high_joint_impact_count}')::int,2) else coalesce((v_cfg#>>'{quality_gate,normal_readiness_max_high_joint_impact_count}')::int,2) end;
  if coalesce((p_candidate#>>'{c4_preparation,mechanic_compatible}')::boolean,true)=false then v_reasons := v_reasons || coalesce(p_candidate#>'{c4_preparation,reasons}','[]'::jsonb); end if;
  for v_ex in select value from jsonb_array_elements(coalesce(p_candidate->'exercises','[]'::jsonb)) loop
    v_count := v_count + 1;
    select id,movement_pattern,exercise_family,technical_complexity,fatigue_score,joint_impact,transition_cost,warmup_only,training_focus into e from public.exercises where id = v_ex->>'exercise_id';
    if not found then v_reasons := v_reasons || jsonb_build_array('UNKNOWN_EXERCISE:'||(v_ex->>'exercise_id')); continue; end if;
    if not public.exercise_safe_for_zones(e.id,v_zone_ids) then v_reasons := v_reasons || jsonb_build_array('PAIN_GATE:'||e.id); end if;
    if not public.exercise_equipment_compatible(e.id,p_inventory) then v_reasons := v_reasons || jsonb_build_array('EQUIPMENT_GATE:'||e.id); end if;
    if coalesce(e.warmup_only,false) then v_reasons := v_reasons || jsonb_build_array('WARMUP_ONLY_IN_WOD:'||e.id); end if;
    if e.technical_complexity is null or e.fatigue_score is null or e.joint_impact is null then v_reasons := v_reasons || jsonb_build_array('MISSING_CRITICAL_METADATA:'||e.id); end if;
    if coalesce(e.technical_complexity,99)>p_max_complexity then v_reasons := v_reasons || jsonb_build_array('TECHNICAL_LEVEL_GATE:'||e.id); end if;
    if v_readiness='low' and coalesce(e.technical_complexity,99) > coalesce((v_cfg#>>'{quality_gate,low_readiness_max_complexity}')::int,3) then v_reasons := v_reasons || jsonb_build_array('LOW_READINESS_COMPLEXITY:'||e.id); end if;
    if v_readiness='low' and coalesce(e.fatigue_score,99) > coalesce((v_cfg#>>'{quality_gate,low_readiness_max_fatigue}')::int,4) then v_reasons := v_reasons || jsonb_build_array('LOW_READINESS_FATIGUE:'||e.id); end if;
    if e.movement_pattern='Jump' then v_jump := v_jump + 1; end if;
    if coalesce(e.joint_impact,0) >= v_high_impact_threshold then v_high_impact := v_high_impact + 1; end if;
    if v_mechanic='AMRAP' and coalesce(e.transition_cost,99) > coalesce((v_cfg#>>'{quality_gate,amrap_max_transition_cost}')::int,3) then v_reasons := v_reasons || jsonb_build_array('AMRAP_TRANSITION_COST:'||e.id); end if;
    if v_mechanic='EMOM' and coalesce(e.technical_complexity,0)>=4 then v_emom_tech := v_emom_tech + 1; end if;
    if v_mechanic='EMOM' and coalesce(e.fatigue_score,0)>=5 then v_emom_fatigue := v_emom_fatigue + 1; end if;
    if v_mechanic='FOR_TIME' and e.movement_pattern='Hinge' and coalesce(e.fatigue_score,0)>=5 then v_hinge5 := true; end if;
    if v_mechanic='FOR_TIME' and e.movement_pattern='Jump' and coalesce(e.fatigue_score,0)>=5 then v_jump5 := true; end if;
    if e.movement_pattern in ('Conditioning','Locomotion') or e.exercise_family in ('Conditioning','Locomotion') or e.training_focus='Conditioning' or coalesce((public.c2_exercise_stimulus_proxy(e.id)#>>'{qualities,conditioning}')::numeric,0)>=60 then v_anchor := true; end if;
  end loop;
  if v_count=0 then v_reasons := v_reasons || jsonb_build_array('EMPTY_WOD'); end if;
  if v_jump > coalesce((v_cfg#>>'{quality_gate,max_jump_count}')::int,1) then v_reasons := v_reasons || jsonb_build_array('MAX_JUMP_COUNT'); end if;
  if v_high_impact > v_high_impact_max then v_reasons := v_reasons || jsonb_build_array('HIGH_JOINT_IMPACT_COUNT'); end if;
  if v_mechanic='EMOM' and v_emom_tech > coalesce((v_cfg#>>'{quality_gate,emom_max_high_complexity_count}')::int,1) then v_reasons := v_reasons || jsonb_build_array('EMOM_HIGH_COMPLEXITY_COUNT'); end if;
  if v_mechanic='EMOM' and v_emom_fatigue > coalesce((v_cfg#>>'{quality_gate,emom_max_fatigue_5_count}')::int,1) then v_reasons := v_reasons || jsonb_build_array('EMOM_FATIGUE_5_COUNT'); end if;
  if v_mechanic='FOR_TIME' and v_hinge5 and v_jump5 then v_reasons := v_reasons || jsonb_build_array('FOR_TIME_HINGE5_PLUS_JUMP5'); end if;
  if p_focus in ('Conditioning','Fat Loss') and not v_anchor then v_reasons := v_reasons || jsonb_build_array('CONDITIONING_ANCHOR_REQUIRED'); end if;
  if coalesce((p_candidate#>>'{c4_final,feasible}')::boolean,false)=false then v_reasons := v_reasons || jsonb_build_array('FINAL_SOLVER_INFEASIBLE'); end if;
  if coalesce(p_candidate#>>'{c4_final,whole_wod_metrics,duration_status}','')='OVERFILLED' then v_reasons := v_reasons || jsonb_build_array('FINAL_DURATION_OVERFILLED'); end if;
  return jsonb_build_object('pass',jsonb_array_length(v_reasons)=0,'hard_gate_reasons',v_reasons,'mechanic',v_mechanic,'checks',jsonb_build_object('pain',true,'equipment',true,'technical_level',true,'readiness_caps',true,'jump_count',v_jump,'high_joint_impact_threshold',v_high_impact_threshold,'high_joint_impact_count',v_high_impact,'high_joint_impact_max',v_high_impact_max,'conditioning_anchor',v_anchor,'conditioning_anchor_definition','pattern|family|focus|stimulus_proxy>=60'),'version','c4-quality-gate-v1.5-qa');
end;
$function$;

revoke all on function public.simulate_session_engine_c2_raw(uuid,text,integer,text,text,text,text[],jsonb,integer,text,integer) from public,anon,authenticated;
revoke all on function public.c4_candidate_quality_gate(jsonb,text,text,text[],jsonb,integer,text) from public,anon,authenticated;
grant execute on function public.simulate_session_engine_c2_raw(uuid,text,integer,text,text,text,text[],jsonb,integer,text,integer) to service_role;
grant execute on function public.c4_candidate_quality_gate(jsonb,text,text,text[],jsonb,integer,text) to service_role;;



-- SOURCE MIGRATION: 20260812013810_qa_d_region_fallback_when_preference_unsafe.sql
create or replace function public.d_generate_adaptive_session(
  p_user_id uuid,
  p_focus_override text,
  p_duration_minutes integer,
  p_readiness text,
  p_target_region_override text default null::text,
  p_progression_intent_override text default null::text,
  p_zone_terms text[] default '{}'::text[],
  p_inventory jsonb default '[]'::jsonb,
  p_available_equipment text[] default '{}'::text[],
  p_max_complexity integer default 3,
  p_max_difficulty text default 'Intermédiaire'::text,
  p_candidate_count integer default 12,
  p_policy_key text default 'c4-final-default'::text,
  p_anchor_date date default current_date
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_context jsonb;
  v_generated jsonb;
  v_session_id uuid;
  v_plan_item_id uuid;
  v_existing jsonb;
  v_anchor date:=coalesce(p_anchor_date,current_date);
  v_pi jsonb;
  v_initial_region text;
  v_plan_region text;
  v_actual_region text;
  v_attempted_regions text[]:='{}'::text[];
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;

  v_pi:=public.pi_refresh_coaching_directives(p_user_id,v_anchor,90);

  v_context:=public.d_resolve_session_context(
    p_user_id,v_anchor,p_duration_minutes,p_readiness,p_focus_override,p_target_region_override,p_progression_intent_override
  );

  if v_context->>'status'='RESUME_EXISTING' then
    select generated_workout into v_existing from public.workout_sessions
    where id=(v_context->>'resume_session_id')::uuid and user_id=p_user_id;
    return jsonb_build_object(
      'status','resume_existing','version','d1-adaptive-generation-v4-safe-region-fallback','session_id',(v_context->>'resume_session_id')::uuid,
      'weekly_loop',v_context,'generated_workout',coalesce(v_existing,'{}'::jsonb),
      'progression_intelligence',jsonb_build_object('frozen_session_unchanged',true,'runtime_refreshed',true)
    );
  end if;

  v_plan_item_id:=nullif(v_context->>'plan_item_id','')::uuid;
  v_initial_region:=nullif(v_context->>'target_region','');
  v_actual_region:=v_initial_region;
  if v_plan_item_id is not null then
    select planned_target_region into v_plan_region
    from public.user_training_plan_items
    where id=v_plan_item_id and user_id=p_user_id;
  end if;

  v_attempted_regions:=array_append(v_attempted_regions,coalesce(v_actual_region,'Full Body'));
  v_generated:=public.c4_generate_full_session(
    p_user_id,coalesce(v_context->>'focus',p_focus_override,'General Fitness'),p_duration_minutes,p_readiness,
    v_actual_region,nullif(v_context->>'progression_intent',''),p_zone_terms,p_inventory,p_available_equipment,
    p_max_complexity,p_max_difficulty,p_candidate_count,p_policy_key
  );

  if (coalesce(v_generated->>'status','')<>'generated' or nullif(v_generated->>'session_id','') is null)
     and v_plan_region in ('Upper','Lower','Core','Full Body')
     and v_plan_region is distinct from v_actual_region then
    v_actual_region:=v_plan_region;
    v_attempted_regions:=array_append(v_attempted_regions,v_actual_region);
    v_generated:=public.c4_generate_full_session(
      p_user_id,coalesce(v_context->>'focus',p_focus_override,'General Fitness'),p_duration_minutes,p_readiness,
      v_actual_region,nullif(v_context->>'progression_intent',''),p_zone_terms,p_inventory,p_available_equipment,
      p_max_complexity,p_max_difficulty,p_candidate_count,p_policy_key
    );
  end if;

  if (coalesce(v_generated->>'status','')<>'generated' or nullif(v_generated->>'session_id','') is null)
     and v_actual_region is distinct from 'Full Body' then
    v_actual_region:='Full Body';
    v_attempted_regions:=array_append(v_attempted_regions,v_actual_region);
    v_generated:=public.c4_generate_full_session(
      p_user_id,coalesce(v_context->>'focus',p_focus_override,'General Fitness'),p_duration_minutes,p_readiness,
      v_actual_region,nullif(v_context->>'progression_intent',''),p_zone_terms,p_inventory,p_available_equipment,
      p_max_complexity,p_max_difficulty,p_candidate_count,p_policy_key
    );
  end if;

  if coalesce(v_generated->>'status','')<>'generated' or nullif(v_generated->>'session_id','') is null then
    return v_generated||jsonb_build_object(
      'weekly_loop',v_context,
      'version','d1-adaptive-generation-v4-safe-region-fallback',
      'region_fallback',jsonb_build_object('requested_region',v_initial_region,'attempted_regions',to_jsonb(v_attempted_regions),'session_found',false)
    );
  end if;

  if v_actual_region is distinct from v_initial_region then
    v_context:=jsonb_set(v_context,'{target_region}',to_jsonb(v_actual_region),true);
    v_context:=jsonb_set(v_context,'{region_fallback}',jsonb_build_object(
      'requested_region',v_initial_region,
      'actual_region',v_actual_region,
      'attempted_regions',to_jsonb(v_attempted_regions),
      'silent',true,
      'reason','requested_or_planned_region_not_safe_or_coherent_with_today_context'
    ),true);
  end if;

  v_session_id:=(v_generated->>'session_id')::uuid;

  update public.workout_sessions set
    generation_local_date=v_anchor,
    planning_context_json=coalesce(planning_context_json,'{}'::jsonb)||jsonb_build_object(
      'weekly_loop',v_context,'weekly_loop_version','d1-weekly-loop-v1',
      'progression_intelligence',coalesce(v_context->'progression_intelligence','{}'::jsonb),
      'daily_refresh',jsonb_build_object('generation_local_date',v_anchor,'started_session_frozen_for_local_day_only',true)
    ),updated_at=now()
  where id=v_session_id and user_id=p_user_id;

  update public.workout_session_exercises wse
  set solver_decision_json=coalesce(wse.solver_decision_json,'{}'::jsonb)||jsonb_build_object(
    'progression_intelligence',public.pi_candidate_fit(p_user_id,wse.exercise_id,v_context->>'progression_intent')
  )
  where wse.session_id=v_session_id;

  if v_plan_item_id is not null then
    update public.user_training_plan_items set
      status='claimed',session_id=v_session_id,claimed_at=now(),updated_at=now(),
      planning_context_json=planning_context_json||jsonb_build_object('claimed_session_id',v_session_id,'claimed_at',now(),'resolved_context',v_context)
    where id=v_plan_item_id and user_id=p_user_id and status='available';
    if not found then raise exception 'Weekly plan item could not be claimed'; end if;
  end if;

  perform public.d_sync_session_stimulus_ledger(v_session_id);

  return v_generated||jsonb_build_object(
    'version','d1-adaptive-generation-v4-safe-region-fallback','weekly_loop',v_context,
    'progression_intelligence',coalesce(v_context->'progression_intelligence','{}'::jsonb),
    'region_fallback',coalesce(v_context->'region_fallback','{}'::jsonb),
    'meta',coalesce(v_generated->'meta','{}'::jsonb)||jsonb_build_object(
      'weekly_loop',v_context,'weekly_loop_version','d1-weekly-loop-v1','generation_local_date',v_anchor,
      'progression_intelligence_version',v_pi->>'version'
    )
  );
end;
$function$;

revoke all on function public.d_generate_adaptive_session(uuid,text,integer,text,text,text,text[],jsonb,text[],integer,text,integer,text,date) from public,anon;
grant execute on function public.d_generate_adaptive_session(uuid,text,integer,text,text,text,text[],jsonb,text[],integer,text,integer,text,date) to authenticated,service_role;;



-- SOURCE MIGRATION: 20260812014627_qa_adjustable_load_resolution.sql
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



-- SOURCE MIGRATION: 20260812014734_qa_swap_auto_marks_target_adapted.sql
create or replace function public.c4_mark_swapped_instance_adapted()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_action text:=coalesce(new.solver_decision_json->>'action','');
  v_target text;
begin
  if v_action like 'SWAP_INSTANCE:%' then
    v_target:=split_part(v_action,':',2);
    if new.id::text=v_target then
      new.user_execution_status:='adapted';
      new.execution_reason_code:=null;
      new.solver_decision_json:=coalesce(new.solver_decision_json,'{}'::jsonb)||jsonb_build_object(
        'swap_auto_marked_adapted',true,
        'swap_target_instance_id',new.id
      );
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_c4_mark_swapped_instance_adapted on public.workout_session_exercises;
create trigger trg_c4_mark_swapped_instance_adapted
before insert or update of solver_decision_json on public.workout_session_exercises
for each row execute function public.c4_mark_swapped_instance_adapted();

revoke all on function public.c4_mark_swapped_instance_adapted() from public,anon,authenticated;
grant execute on function public.c4_mark_swapped_instance_adapted() to service_role;;



-- SOURCE MIGRATION: 20260812072237_pi4_use_observation_time_for_live_decisions.sql
create or replace function public.pi_exercise_directives(
  p_user_id uuid,
  p_anchor_date date default current_date,
  p_period_days integer default 90
)
returns table(
  exercise_id text,
  exercise_name text,
  movement_pattern text,
  training_focus text,
  body_region text,
  directive text,
  priority_score numeric,
  confidence numeric,
  evidence_count integer,
  source text,
  latest_decision text,
  reason_codes text[]
)
language sql
stable
security definer
set search_path to 'public'
as $function$
with cfg as (
  select coalesce(p_anchor_date,current_date) anchor_date,
         greatest(28,least(coalesce(p_period_days,90),3650)) period_days
), latest_live as (
  select distinct on (cue.exercise_id)
    cue.exercise_id::text,
    cue.decision,
    coalesce(el.created_at,cue.created_at) observed_at
  from public.capability_update_events cue
  left join public.exercise_logs el on el.id=cue.exercise_log_id
  cross join cfg
  where cue.user_id=p_user_id
    and cue.applied
    and coalesce(el.created_at,cue.created_at)::date >= cfg.anchor_date-cfg.period_days
    and coalesce(el.created_at,cue.created_at)::date <= cfg.anchor_date
  order by cue.exercise_id,coalesce(el.created_at,cue.created_at) desc,cue.id desc
), base as (
  select
    cs.exercise_id::text,
    e.name::text exercise_name,
    e.movement_pattern::text,
    e.training_focus::text,
    e.body_region::text,
    coalesce(cs.exposure_count,0)::int exposure_count,
    coalesce(cs.valid_evidence_count,0)::int valid_evidence_count,
    cs.state,
    cs.recommendation,
    coalesce(cs.performance_delta,0)::numeric performance_delta,
    greatest(
      least(1.0,coalesce(cs.capability_confidence,0)::numeric),
      least(1.0,coalesce(cs.overall_confidence,0)::numeric/100.0)
    ) raw_confidence,
    cs.last_observed_at,
    ll.decision latest_decision,
    ll.observed_at latest_live_at,
    cfg.anchor_date,
    cfg.period_days
  from public.user_exercise_coach_state cs
  join public.exercises e on e.id=cs.exercise_id
  cross join cfg
  left join latest_live ll on ll.exercise_id=cs.exercise_id
  where coalesce(cs.exposure_count,0)>0
     or coalesce(cs.valid_evidence_count,0)>0
     or ll.exercise_id is not null
), normalized as (
  select b.*,
    greatest(0,least(1,
      b.raw_confidence * case
        when b.last_observed_at is null then 0.75
        when b.last_observed_at::date >= b.anchor_date-45 then 1.0
        when b.last_observed_at::date >= b.anchor_date-90 then 0.85
        when b.last_observed_at::date >= b.anchor_date-180 then 0.65
        else 0.45 end
    ))::numeric effective_confidence,
    greatest(b.exposure_count,b.valid_evidence_count)::int effective_evidence
  from base b
), classified as (
  select n.*,
    case
      when n.latest_decision='RECALIBRATE' and n.effective_confidence>=0.40 then 'RECALIBRATE'
      when n.latest_decision='EXPAND' and n.effective_confidence>=0.45 then 'PROGRESS'
      when n.recommendation='PROGRESS_RECOMMENDED' and n.effective_confidence>=0.55 then 'PROGRESS'
      when n.recommendation='PROGRESS_POSSIBLE' and n.effective_confidence>=0.45 then 'DEVELOP'
      when n.state='RECOVER' and n.effective_evidence>=2 then 'CONSOLIDATE'
      when n.effective_evidence<3 or n.effective_confidence<0.35 then 'LEARN'
      else 'MAINTAIN'
    end directive
  from normalized n
)
select
  c.exercise_id,c.exercise_name,c.movement_pattern,c.training_focus,c.body_region,c.directive,
  round((case c.directive
    when 'RECALIBRATE' then 96
    when 'PROGRESS' then 92
    when 'DEVELOP' then 84
    when 'CONSOLIDATE' then 72
    when 'MAINTAIN' then 62
    else 45 end) * (0.65+0.35*c.effective_confidence),2) priority_score,
  round(c.effective_confidence,4) confidence,
  c.effective_evidence evidence_count,
  case when c.latest_decision is not null then 'b2.7-live-capability'
       when c.recommendation is not null then 'legacy-progress-fallback'
       else 'evidence-learning' end source,
  c.latest_decision,
  array_remove(array[
    case when c.latest_decision='EXPAND' then 'LIVE_CAPABILITY_EXPANDED' end,
    case when c.latest_decision='RECALIBRATE' then 'LIVE_CAPABILITY_RECALIBRATION' end,
    case when c.recommendation='PROGRESS_RECOMMENDED' then 'LEGACY_PROGRESS_RECOMMENDED' end,
    case when c.recommendation='PROGRESS_POSSIBLE' then 'LEGACY_PROGRESS_POSSIBLE' end,
    case when c.state='RECOVER' then 'RECOVERY_STATE' end,
    case when c.effective_evidence<3 then 'SPARSE_EVIDENCE' end,
    case when c.effective_confidence<0.35 then 'LOW_CONFIDENCE' end
  ],null)::text[] reason_codes
from classified c
order by priority_score desc,c.exercise_id;
$function$;;



-- SOURCE MIGRATION: 20260812072555_b28_detect_repeated_prescription_failures.sql
create or replace function public.propose_capability_state_update(
  p_state jsonb,
  p_family text,
  p_expected jsonb,
  p_actual jsonb,
  p_quality numeric,
  p_capability_eligible boolean,
  p_pain_affected boolean,
  p_comparison jsonb default '{}'::jsonb,
  p_policy_key text default 'b2.5-draft-default'::text,
  p_observed_at timestamptz default now()
)
returns jsonb
language plpgsql
stable
as $function$
declare
  v_result jsonb;
  v_state jsonb;
  v_cap_key text;
  v_mode text:=coalesce(nullif(p_comparison->>'capability_mode',''),'repeatable');
  v_signature text:=nullif(p_comparison->>'protocol_signature','');
  v_env_key text;
  v_root jsonb;
  v_sub jsonb;
  v_candidate jsonb;
  v_evidence_root jsonb;
  v_ev jsonb;
  v_context text:=coalesce(nullif(p_comparison->>'protocol_signature',''),p_family||'|'||coalesce(nullif(p_comparison->>'capability_mode',''),'repeatable'));
  v_prev_failure_context text;
  v_failure_count int:=0;
  v_negative_required int:=3;
  v_expected_min numeric;
  v_actual_value numeric;
  v_prescription_failure boolean:=false;
begin
  v_result:=public.propose_capability_state_update_core(
    p_state,p_family,p_expected,p_actual,p_quality,p_capability_eligible,p_pain_affected,
    p_comparison,p_policy_key,p_observed_at
  );

  v_state:=coalesce(v_result->'after_state','{}'::jsonb);
  v_cap_key:=v_result->>'capability_key';
  v_env_key:=case p_family
    when 'reps' then 'reps_envelope'
    when 'load_reps' then 'load_envelope'
    when 'time' then 'time_envelope'
    when 'pace' then 'pace_envelope'
    when 'loaded_distance' then 'distance_envelope'
    when 'density' then 'density_envelope'
    when 'progressive' then 'progressive_envelope'
  end;

  -- Existing confirmed negative behavior: preserve the established best and
  -- create a recalibration candidate instead of regressing in one step.
  if coalesce(v_result->>'decision','')='REGRESS_CONFIRMED' then
    v_root:=coalesce(p_state->v_env_key,'{}'::jsonb);
    if p_family in ('density','progressive') then
      v_sub:=coalesce(v_root#>array['protocols',coalesce(v_signature,'missing')],'{}'::jsonb);
    else
      v_sub:=coalesce(v_root->v_mode,'{}'::jsonb);
    end if;

    v_candidate:=jsonb_build_object(
      'actual',coalesce(p_actual,'{}'::jsonb),
      'expected',coalesce(p_expected,'{}'::jsonb),
      'quality',public.num_clamp(coalesce(p_quality,0),0,1),
      'comparison',coalesce(p_comparison,'{}'::jsonb),
      'observed_at',p_observed_at,
      'status','CONFIRMED_NEGATIVE_RECALIBRATION'
    );
    v_sub:=jsonb_set(v_sub,array['recalibration_candidate'],v_candidate,true);

    if p_family in ('density','progressive') then
      v_root:=jsonb_set(v_root,array['protocols',coalesce(v_signature,'missing')],v_sub,true);
    else
      v_root:=jsonb_set(v_root,array[v_mode],v_sub,true);
    end if;
    v_state:=jsonb_set(v_state,array[v_env_key],v_root,true);

    if v_cap_key is not null then
      v_state:=jsonb_set(v_state,array['evidence_json',v_cap_key,'last_decision'],to_jsonb('RECALIBRATE'::text),true);
    end if;

    v_result:=jsonb_set(v_result,array['decision'],to_jsonb('RECALIBRATE'::text),true);
    v_result:=jsonb_set(v_result,array['after_state'],v_state,true);
    v_result:=jsonb_set(v_result,array['proposal','decision'],to_jsonb('RECALIBRATE'::text),true);
    v_result:=jsonb_set(v_result,array['proposal','after'],v_sub,true);
    v_result:=jsonb_set(v_result,array['proposal','reason_codes'],jsonb_build_array('CONFIRMED_NEGATIVE_REQUIRES_RECALIBRATION'),true);
    return v_result;
  end if;

  -- Prescription failure is distinct from losing the historical best.
  -- A user can keep a 10-rep capability while repeated inability to satisfy
  -- a current 9-10 rep prescription triggers recalibration.
  if coalesce(p_capability_eligible,false) and not coalesce(p_pain_affected,false) and coalesce(p_quality,0)>0 then
    if p_family in ('reps','load_reps') then
      v_expected_min:=public.jsonb_num(p_expected,'reps_min');
      v_actual_value:=public.jsonb_num(p_actual,'reps');
      v_prescription_failure:=v_expected_min is not null and v_actual_value is not null and v_actual_value < v_expected_min;
    elsif p_family='time' then
      v_expected_min:=public.jsonb_num(p_expected,'duration_seconds_min');
      v_actual_value:=public.jsonb_num(p_actual,'duration_seconds');
      v_prescription_failure:=v_expected_min is not null and v_actual_value is not null and v_actual_value < v_expected_min;
    end if;
  end if;

  if v_cap_key is not null then
    v_evidence_root:=coalesce(v_state->'evidence_json','{}'::jsonb);
    v_ev:=coalesce(v_evidence_root->v_cap_key,'{}'::jsonb);
  else
    v_evidence_root:='{}'::jsonb;
    v_ev:='{}'::jsonb;
  end if;

  if v_prescription_failure and v_cap_key is not null then
    select coalesce(negative_confirmations_required,3)
      into v_negative_required
    from public.performance_engine_policy
    where policy_key=p_policy_key;
    v_negative_required:=coalesce(v_negative_required,3);

    v_prev_failure_context:=v_ev->>'prescription_failure_context';
    if v_prev_failure_context is distinct from v_context then
      v_failure_count:=1;
    else
      v_failure_count:=coalesce((v_ev->>'prescription_failure_count')::int,0)+1;
    end if;

    v_ev:=v_ev||jsonb_build_object(
      'prescription_failure_count',v_failure_count,
      'prescription_failure_context',v_context,
      'last_prescription_failure_at',p_observed_at,
      'last_prescription_failure_actual',coalesce(p_actual,'{}'::jsonb),
      'last_prescription_failure_expected',coalesce(p_expected,'{}'::jsonb)
    );

    if v_failure_count>=v_negative_required then
      v_ev:=jsonb_set(v_ev,array['last_decision'],to_jsonb('RECALIBRATE'::text),true);
      v_evidence_root:=jsonb_set(v_evidence_root,array[v_cap_key],v_ev,true);
      v_state:=jsonb_set(v_state,array['evidence_json'],v_evidence_root,true);

      v_root:=coalesce(v_state->v_env_key,'{}'::jsonb);
      if p_family in ('density','progressive') then
        v_sub:=coalesce(v_root#>array['protocols',coalesce(v_signature,'missing')],'{}'::jsonb);
      else
        v_sub:=coalesce(v_root->v_mode,'{}'::jsonb);
      end if;
      v_candidate:=jsonb_build_object(
        'actual',coalesce(p_actual,'{}'::jsonb),
        'expected',coalesce(p_expected,'{}'::jsonb),
        'quality',public.num_clamp(coalesce(p_quality,0),0,1),
        'comparison',coalesce(p_comparison,'{}'::jsonb),
        'observed_at',p_observed_at,
        'status','REPEATED_PRESCRIPTION_FAILURE_RECALIBRATION',
        'failure_count',v_failure_count
      );
      v_sub:=jsonb_set(v_sub,array['recalibration_candidate'],v_candidate,true);
      if p_family in ('density','progressive') then
        v_root:=jsonb_set(v_root,array['protocols',coalesce(v_signature,'missing')],v_sub,true);
      else
        v_root:=jsonb_set(v_root,array[v_mode],v_sub,true);
      end if;
      v_state:=jsonb_set(v_state,array[v_env_key],v_root,true);

      v_result:=jsonb_set(v_result,array['decision'],to_jsonb('RECALIBRATE'::text),true);
      v_result:=jsonb_set(v_result,array['after_state'],v_state,true);
      v_result:=jsonb_set(v_result,array['proposal','decision'],to_jsonb('RECALIBRATE'::text),true);
      v_result:=jsonb_set(v_result,array['proposal','reason_codes'],jsonb_build_array('REPEATED_BELOW_PRESCRIPTION_MIN','RECALIBRATION_REQUIRED'),true);
      return v_result;
    else
      v_ev:=jsonb_set(v_ev,array['last_decision'],to_jsonb('HOLD'::text),true);
      v_evidence_root:=jsonb_set(v_evidence_root,array[v_cap_key],v_ev,true);
      v_state:=jsonb_set(v_state,array['evidence_json'],v_evidence_root,true);
      v_result:=jsonb_set(v_result,array['decision'],to_jsonb('HOLD'::text),true);
      v_result:=jsonb_set(v_result,array['after_state'],v_state,true);
      v_result:=jsonb_set(v_result,array['proposal','decision'],to_jsonb('HOLD'::text),true);
      v_result:=jsonb_set(v_result,array['proposal','reason_codes'],jsonb_build_array('BELOW_PRESCRIPTION_MIN_UNCONFIRMED'),true);
      return v_result;
    end if;
  end if;

  -- A successful comparable exposure clears any pending consecutive
  -- prescription-failure streak.
  if v_cap_key is not null and coalesce((v_ev->>'prescription_failure_count')::int,0)>0 then
    v_ev:=v_ev||jsonb_build_object('prescription_failure_count',0,'prescription_failure_context',v_context);
    v_evidence_root:=jsonb_set(v_evidence_root,array[v_cap_key],v_ev,true);
    v_state:=jsonb_set(v_state,array['evidence_json'],v_evidence_root,true);
    v_result:=jsonb_set(v_result,array['after_state'],v_state,true);
  end if;

  return v_result;
end;
$function$;;



-- SOURCE MIGRATION: 20260812072711_b28_persist_prescription_failure_streak.sql
create or replace function public.propose_capability_state_update(
  p_state jsonb,
  p_family text,
  p_expected jsonb,
  p_actual jsonb,
  p_quality numeric,
  p_capability_eligible boolean,
  p_pain_affected boolean,
  p_comparison jsonb default '{}'::jsonb,
  p_policy_key text default 'b2.5-draft-default'::text,
  p_observed_at timestamptz default now()
)
returns jsonb
language plpgsql
stable
as $function$
declare
  v_result jsonb;
  v_state jsonb;
  v_cap_key text;
  v_mode text:=coalesce(nullif(p_comparison->>'capability_mode',''),'repeatable');
  v_signature text:=nullif(p_comparison->>'protocol_signature','');
  v_env_key text;
  v_root jsonb;
  v_sub jsonb;
  v_candidate jsonb;
  v_evidence_root jsonb;
  v_ev jsonb;
  v_context text:=coalesce(nullif(p_comparison->>'protocol_signature',''),p_family||'|'||coalesce(nullif(p_comparison->>'capability_mode',''),'repeatable'));
  v_prev_failure_context text;
  v_failure_count int:=0;
  v_negative_required int:=3;
  v_expected_min numeric;
  v_actual_value numeric;
  v_prescription_failure boolean:=false;
begin
  v_result:=public.propose_capability_state_update_core(
    p_state,p_family,p_expected,p_actual,p_quality,p_capability_eligible,p_pain_affected,
    p_comparison,p_policy_key,p_observed_at
  );

  v_state:=coalesce(v_result->'after_state','{}'::jsonb);
  v_cap_key:=v_result->>'capability_key';
  v_env_key:=case p_family
    when 'reps' then 'reps_envelope'
    when 'load_reps' then 'load_envelope'
    when 'time' then 'time_envelope'
    when 'pace' then 'pace_envelope'
    when 'loaded_distance' then 'distance_envelope'
    when 'density' then 'density_envelope'
    when 'progressive' then 'progressive_envelope'
  end;

  v_root:=coalesce(v_state->v_env_key,'{}'::jsonb);
  if p_family in ('density','progressive') then
    v_sub:=coalesce(v_root#>array['protocols',coalesce(v_signature,'missing')],'{}'::jsonb);
  else
    v_sub:=coalesce(v_root->v_mode,'{}'::jsonb);
  end if;

  -- Existing confirmed negative behavior: historical best is never erased in one step.
  if coalesce(v_result->>'decision','')='REGRESS_CONFIRMED' then
    v_candidate:=jsonb_build_object(
      'actual',coalesce(p_actual,'{}'::jsonb),
      'expected',coalesce(p_expected,'{}'::jsonb),
      'quality',public.num_clamp(coalesce(p_quality,0),0,1),
      'comparison',coalesce(p_comparison,'{}'::jsonb),
      'observed_at',p_observed_at,
      'status','CONFIRMED_NEGATIVE_RECALIBRATION'
    );
    v_sub:=jsonb_set(v_sub,array['recalibration_candidate'],v_candidate,true);
    if p_family in ('density','progressive') then
      v_root:=jsonb_set(v_root,array['protocols',coalesce(v_signature,'missing')],v_sub,true);
    else
      v_root:=jsonb_set(v_root,array[v_mode],v_sub,true);
    end if;
    v_state:=jsonb_set(v_state,array[v_env_key],v_root,true);
    if v_cap_key is not null then
      v_state:=jsonb_set(v_state,array['evidence_json',v_cap_key,'last_decision'],to_jsonb('RECALIBRATE'::text),true);
    end if;
    v_result:=jsonb_set(v_result,array['decision'],to_jsonb('RECALIBRATE'::text),true);
    v_result:=jsonb_set(v_result,array['after_state'],v_state,true);
    v_result:=jsonb_set(v_result,array['proposal','decision'],to_jsonb('RECALIBRATE'::text),true);
    v_result:=jsonb_set(v_result,array['proposal','after'],v_sub,true);
    v_result:=jsonb_set(v_result,array['proposal','reason_codes'],jsonb_build_array('CONFIRMED_NEGATIVE_REQUIRES_RECALIBRATION'),true);
    return v_result;
  end if;

  if coalesce(p_capability_eligible,false) and not coalesce(p_pain_affected,false) and coalesce(p_quality,0)>0 then
    if p_family in ('reps','load_reps') then
      v_expected_min:=public.jsonb_num(p_expected,'reps_min');
      v_actual_value:=public.jsonb_num(p_actual,'reps');
      v_prescription_failure:=v_expected_min is not null and v_actual_value is not null and v_actual_value < v_expected_min;
    elsif p_family='time' then
      v_expected_min:=public.jsonb_num(p_expected,'duration_seconds_min');
      v_actual_value:=public.jsonb_num(p_actual,'duration_seconds');
      v_prescription_failure:=v_expected_min is not null and v_actual_value is not null and v_actual_value < v_expected_min;
    end if;
  end if;

  if v_prescription_failure and v_cap_key is not null then
    select coalesce(negative_confirmations_required,3)
      into v_negative_required
    from public.performance_engine_policy
    where policy_key=p_policy_key;
    v_negative_required:=coalesce(v_negative_required,3);

    v_prev_failure_context:=v_sub#>>'{prescription_failure_streak,context}';
    if v_prev_failure_context is distinct from v_context then
      v_failure_count:=1;
    else
      v_failure_count:=coalesce((v_sub#>>'{prescription_failure_streak,count}')::int,0)+1;
    end if;

    v_sub:=jsonb_set(v_sub,array['prescription_failure_streak'],jsonb_build_object(
      'count',v_failure_count,
      'context',v_context,
      'last_failed_at',p_observed_at,
      'actual',coalesce(p_actual,'{}'::jsonb),
      'expected',coalesce(p_expected,'{}'::jsonb)
    ),true);

    v_evidence_root:=coalesce(v_state->'evidence_json','{}'::jsonb);
    v_ev:=coalesce(v_evidence_root->v_cap_key,'{}'::jsonb);

    if v_failure_count>=v_negative_required then
      v_candidate:=jsonb_build_object(
        'actual',coalesce(p_actual,'{}'::jsonb),
        'expected',coalesce(p_expected,'{}'::jsonb),
        'quality',public.num_clamp(coalesce(p_quality,0),0,1),
        'comparison',coalesce(p_comparison,'{}'::jsonb),
        'observed_at',p_observed_at,
        'status','REPEATED_PRESCRIPTION_FAILURE_RECALIBRATION',
        'failure_count',v_failure_count
      );
      v_sub:=jsonb_set(v_sub,array['recalibration_candidate'],v_candidate,true);
      v_ev:=jsonb_set(v_ev,array['last_decision'],to_jsonb('RECALIBRATE'::text),true);
      v_result:=jsonb_set(v_result,array['decision'],to_jsonb('RECALIBRATE'::text),true);
      v_result:=jsonb_set(v_result,array['proposal','decision'],to_jsonb('RECALIBRATE'::text),true);
      v_result:=jsonb_set(v_result,array['proposal','reason_codes'],jsonb_build_array('REPEATED_BELOW_PRESCRIPTION_MIN','RECALIBRATION_REQUIRED'),true);
    else
      v_ev:=jsonb_set(v_ev,array['last_decision'],to_jsonb('HOLD'::text),true);
      v_result:=jsonb_set(v_result,array['decision'],to_jsonb('HOLD'::text),true);
      v_result:=jsonb_set(v_result,array['proposal','decision'],to_jsonb('HOLD'::text),true);
      v_result:=jsonb_set(v_result,array['proposal','reason_codes'],jsonb_build_array('BELOW_PRESCRIPTION_MIN_UNCONFIRMED'),true);
    end if;

    v_evidence_root:=jsonb_set(v_evidence_root,array[v_cap_key],v_ev,true);
    v_state:=jsonb_set(v_state,array['evidence_json'],v_evidence_root,true);
    if p_family in ('density','progressive') then
      v_root:=jsonb_set(v_root,array['protocols',coalesce(v_signature,'missing')],v_sub,true);
    else
      v_root:=jsonb_set(v_root,array[v_mode],v_sub,true);
    end if;
    v_state:=jsonb_set(v_state,array[v_env_key],v_root,true);
    v_result:=jsonb_set(v_result,array['after_state'],v_state,true);
    v_result:=jsonb_set(v_result,array['proposal','after'],v_sub,true);
    return v_result;
  end if;

  -- Successful comparable exposure clears a pending consecutive failure streak.
  if coalesce((v_sub#>>'{prescription_failure_streak,count}')::int,0)>0 then
    v_sub:=jsonb_set(v_sub,array['prescription_failure_streak'],jsonb_build_object(
      'count',0,'context',v_context,'cleared_at',p_observed_at
    ),true);
    if p_family in ('density','progressive') then
      v_root:=jsonb_set(v_root,array['protocols',coalesce(v_signature,'missing')],v_sub,true);
    else
      v_root:=jsonb_set(v_root,array[v_mode],v_sub,true);
    end if;
    v_state:=jsonb_set(v_state,array[v_env_key],v_root,true);
    v_result:=jsonb_set(v_result,array['after_state'],v_state,true);
  end if;

  return v_result;
end;
$function$;;



-- SOURCE MIGRATION: 20260812073955_qa_security_harden_engine_state_tables.sql
-- Engine policy tables: never client-writable.
alter table public.session_engine_policy enable row level security;
drop policy if exists "Authenticated can read session engine policy" on public.session_engine_policy;
create policy "Authenticated can read session engine policy"
on public.session_engine_policy for select to authenticated using (true);

revoke all on table public.session_engine_policy from anon;
revoke insert, update, delete, truncate, references, trigger on table public.session_engine_policy from authenticated;
grant select on table public.session_engine_policy to authenticated;

revoke all on table public.performance_engine_policy from anon;
revoke insert, update, delete, truncate, references, trigger on table public.performance_engine_policy from authenticated;
grant select on table public.performance_engine_policy to authenticated;

revoke all on table public.performance_observation_quality_policy from anon;
revoke insert, update, delete, truncate, references, trigger on table public.performance_observation_quality_policy from authenticated;
grant select on table public.performance_observation_quality_policy to authenticated;

-- Engine event ledgers: user may inspect own history, never forge it.
revoke all on table public.capability_update_events from anon;
revoke insert, update, delete, truncate, references, trigger on table public.capability_update_events from authenticated;
grant select on table public.capability_update_events to authenticated;

revoke all on table public.protocol_capability_events from anon;
revoke insert, update, delete, truncate, references, trigger on table public.protocol_capability_events from authenticated;
grant select on table public.protocol_capability_events to authenticated;

revoke all on table public.capability_shadow_events from anon;
revoke insert, update, delete, truncate, references, trigger on table public.capability_shadow_events from authenticated;
grant select on table public.capability_shadow_events to authenticated;

revoke all on table public.capability_shadow_run_errors from anon;
revoke insert, update, delete, truncate, references, trigger on table public.capability_shadow_run_errors from authenticated;
grant select on table public.capability_shadow_run_errors to authenticated;

-- Live exercise capability is derived state, not user-editable state.
drop policy if exists "Users can insert own exercise capabilities" on public.user_exercise_capabilities;
drop policy if exists "Users can update own exercise capabilities" on public.user_exercise_capabilities;
drop policy if exists "Users can delete own exercise capabilities" on public.user_exercise_capabilities;
drop policy if exists "Users can read own exercise capabilities" on public.user_exercise_capabilities;
create policy "Users can read own exercise capabilities"
on public.user_exercise_capabilities for select to authenticated
using (auth.uid() = user_id);
revoke all on table public.user_exercise_capabilities from anon;
revoke insert, update, delete, truncate, references, trigger on table public.user_exercise_capabilities from authenticated;
grant select on table public.user_exercise_capabilities to authenticated;

-- Work-rate estimates are derived by the secured trigger.
revoke all on table public.user_exercise_work_rate_estimates from anon;
revoke insert, update, delete, truncate, references, trigger on table public.user_exercise_work_rate_estimates from authenticated;
grant select on table public.user_exercise_work_rate_estimates to authenticated;

-- Protocol capability is also computed by the coach.
drop policy if exists "user_protocol_capabilities_own_all" on public.user_protocol_capabilities;
create policy "user_protocol_capabilities_select_own"
on public.user_protocol_capabilities for select to authenticated
using (user_id = auth.uid());
revoke all on table public.user_protocol_capabilities from anon;
revoke insert, update, delete, truncate, references, trigger on table public.user_protocol_capabilities from authenticated;
grant select on table public.user_protocol_capabilities to authenticated;

-- Weekly adaptive state is generated by D, not authored by the mobile client.
drop policy if exists "Users own training weeks" on public.user_training_weeks;
create policy "Users read own training weeks"
on public.user_training_weeks for select to authenticated using (auth.uid() = user_id);
revoke all on table public.user_training_weeks from anon;
revoke insert, update, delete, truncate, references, trigger on table public.user_training_weeks from authenticated;
grant select on table public.user_training_weeks to authenticated;

drop policy if exists "Users own training plan items" on public.user_training_plan_items;
create policy "Users read own training plan items"
on public.user_training_plan_items for select to authenticated using (auth.uid() = user_id);
revoke all on table public.user_training_plan_items from anon;
revoke insert, update, delete, truncate, references, trigger on table public.user_training_plan_items from authenticated;
grant select on table public.user_training_plan_items to authenticated;

drop policy if exists "Users own weekly stimulus targets" on public.weekly_stimulus_targets;
create policy "Users read own weekly stimulus targets"
on public.weekly_stimulus_targets for select to authenticated using (auth.uid() = user_id);
revoke all on table public.weekly_stimulus_targets from anon;
revoke insert, update, delete, truncate, references, trigger on table public.weekly_stimulus_targets from authenticated;
grant select on table public.weekly_stimulus_targets to authenticated;

drop policy if exists "Users own session stimulus ledger" on public.session_stimulus_ledger;
create policy "Users read own session stimulus ledger"
on public.session_stimulus_ledger for select to authenticated using (auth.uid() = user_id);
revoke all on table public.session_stimulus_ledger from anon;
revoke insert, update, delete, truncate, references, trigger on table public.session_stimulus_ledger from authenticated;
grant select on table public.session_stimulus_ledger to authenticated;;



-- SOURCE MIGRATION: 20260812074201_qa_security_restrict_internal_trigger_and_shadow_functions.sql
revoke execute on function public.capability_shadow_on_session_complete() from public, anon, authenticated;
revoke execute on function public.resolve_exercise_log_instance() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.run_capability_shadow_session(uuid,text,text) from public, anon, authenticated;;



-- SOURCE MIGRATION: 20260812074240_qa_security_restrict_internal_capability_mutators.sql
revoke execute on function public.apply_capability_observation(uuid,character varying,bigint,text,jsonb,jsonb,numeric,boolean,boolean,text,jsonb,text,timestamptz) from public, anon, authenticated;
revoke execute on function public.set_updated_at() from public, anon, authenticated;
revoke execute on function public.sync_exercise_warmup_contract() from public, anon, authenticated;;



-- SOURCE MIGRATION: 20260812074333_qa_security_fix_performance_observation_view_rls_bypass.sql
alter view public.performance_observation_contract set (security_invoker = true);
revoke all on table public.performance_observation_contract from anon;
grant select on table public.performance_observation_contract to authenticated;

-- Reference-only view: also make security semantics explicit.
alter view public.exercise_local_fatigue_basis set (security_invoker = true);;



-- SOURCE MIGRATION: 20260812075836_d5_long_inactivity_recalibration_guard.sql
update public.session_engine_policy
set config = jsonb_set(
  coalesce(config,'{}'::jsonb),
  '{weekly_loop,long_inactivity_recalibrate_days}',
  '90'::jsonb,
  true
)
where policy_key='c4-final-default';

create or replace function public.d_resolve_session_context(
  p_user_id uuid,
  p_anchor_date date default current_date,
  p_duration_minutes integer default 45,
  p_readiness text default 'normal'::text,
  p_focus_override text default null::text,
  p_target_region_override text default null::text,
  p_progression_intent_override text default null::text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_anchor date:=coalesce(p_anchor_date,current_date);
  v_week date:=public.d_week_start(coalesce(p_anchor_date,current_date));
  v_target int;
  v_goal text;
  v_item public.user_training_plan_items%rowtype;
  v_active public.user_training_plan_items%rowtype;
  v_active_session public.workout_sessions%rowtype;
  v_completed_count int;
  v_last record;
  v_exception_ratio numeric:=0;
  v_intent text;
  v_focus text;
  v_region text;
  v_reasons text[]:='{}'::text[];
  v_override_intent text:=upper(nullif(trim(coalesce(p_progression_intent_override,'')),''));
  v_readiness text:=lower(trim(coalesce(p_readiness,'normal')));
  v_capability_rows int:=0;
  v_confident_rows int:=0;
  v_pi jsonb:='{}'::jsonb;
  v_pi_hint text:='MAINTAIN';
  v_pi_stage text:='LOW';
  v_planned_intent text;
  v_long_inactivity_days int:=90;
  v_days_since_last int:=null;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then
    raise exception 'Cannot resolve another user session context';
  end if;

  select coalesce((config#>>'{weekly_loop,long_inactivity_recalibrate_days}')::int,90)
  into v_long_inactivity_days
  from public.session_engine_policy
  where policy_key='c4-final-default';
  v_long_inactivity_days:=greatest(1,coalesce(v_long_inactivity_days,90));

  perform public.d_ensure_week_plan(p_user_id,v_anchor,false);

  select weekly_session_target,primary_goal into v_target,v_goal
  from public.user_training_weeks
  where user_id=p_user_id and week_start=v_week;

  select i.* into v_active
  from public.user_training_plan_items i
  join public.workout_sessions ws on ws.id=i.session_id and ws.user_id=i.user_id
  where i.user_id=p_user_id
    and i.status='claimed'
    and ws.status in ('generated','in_progress')
  order by coalesce(i.claimed_at,i.updated_at) desc
  limit 1;

  if found then
    select * into v_active_session
    from public.workout_sessions
    where id=v_active.session_id;

    if v_active_session.status='in_progress'
       and v_active_session.started_local_date=v_anchor then
      return jsonb_build_object(
        'status','RESUME_EXISTING',
        'version','d1-session-context-v5-inactivity',
        'week_start',v_week,
        'plan_item_id',v_active.id,
        'resume_session_id',v_active.session_id,
        'focus',v_active.planned_focus,
        'target_region',v_active.planned_target_region,
        'progression_intent',v_active.planned_progression_intent,
        'started_local_date',v_active_session.started_local_date,
        'frozen_for_local_day',true,
        'reason_codes',jsonb_build_array('daily_session:resume_started_today')
      );
    end if;

    delete from public.session_stimulus_ledger
    where session_id=v_active.session_id
      and metadata_json->>'source'='phase_d_weekly_loop';

    update public.workout_sessions
    set status='abandoned',
        planning_context_json=coalesce(planning_context_json,'{}'::jsonb)||jsonb_build_object(
          'daily_refresh',jsonb_build_object(
            'released_at',now(),
            'released_for_local_date',v_anchor,
            'reason',case
              when v_active_session.status='generated' then 'new_checkin_before_start'
              else 'new_local_day_after_started_session'
            end
          )
        ),
        updated_at=now()
    where id=v_active.session_id;

    update public.user_training_plan_items
    set status=case when week_start<v_week then 'skipped' else 'available' end,
        session_id=null,
        claimed_at=null,
        updated_at=now(),
        planning_context_json=coalesce(planning_context_json,'{}'::jsonb)||jsonb_build_object(
          'daily_refresh_released_session_id',v_active.session_id,
          'daily_refresh_released_at',now()
        )
    where id=v_active.id;

    v_reasons:=array_append(v_reasons,
      case when v_active_session.status='generated'
        then 'daily_session:rebuild_for_new_checkin'
        else 'daily_session:unfreeze_new_local_day'
      end
    );
  end if;

  select directive_json into v_pi
  from public.user_coaching_directive_runtime
  where user_id=p_user_id;
  if v_pi is null then
    v_pi:=public.pi_coaching_directives(p_user_id,v_anchor,90);
  end if;
  v_pi_hint:=upper(coalesce(v_pi#>>'{session_recommendation,progression_intent_hint}','MAINTAIN'));
  v_pi_stage:=upper(coalesce(v_pi#>>'{data_maturity,stage}','LOW'));

  select count(*) into v_completed_count
  from public.workout_sessions ws
  where ws.user_id=p_user_id and ws.status='completed'
    and coalesce(ws.completed_at,ws.created_at)::date between v_week and v_week+6;

  select count(*),count(*) filter(where confidence>=0.60)
  into v_capability_rows,v_confident_rows
  from public.user_exercise_capabilities where user_id=p_user_id;

  select ws.id,ws.global_rpe,ws.post_workout_feeling,ws.target_region,ws.completed_at into v_last
  from public.workout_sessions ws
  where ws.user_id=p_user_id and ws.status='completed'
    and coalesce(ws.completed_at,ws.created_at)::date <= v_anchor
  order by coalesce(ws.completed_at,ws.updated_at) desc
  limit 1;

  if v_last.id is not null then
    v_days_since_last:=greatest(0,v_anchor-v_last.completed_at::date);
    select coalesce(avg(case coalesce(wse.user_execution_status,'pending')
      when 'completed' then 0 when 'adapted' then 1 else 1 end),0)
    into v_exception_ratio
    from public.workout_session_exercises wse where wse.session_id=v_last.id;
  end if;

  select i.* into v_item
  from public.user_training_plan_items i
  where i.user_id=p_user_id and i.week_start=v_week and i.status='available'
  order by case when i.recommended_date<=v_anchor then 0 else 1 end,
    i.recommended_date,i.sequence_index
  limit 1 for update;

  v_planned_intent:=upper(coalesce(v_item.planned_progression_intent,'MAINTAIN'));

  if p_focus_override in ('General Fitness','Fat Loss','Muscle Gain','Strength','Conditioning') then
    v_focus:=p_focus_override;v_reasons:=array_append(v_reasons,'focus:user_or_profile_override');
  else
    v_focus:=coalesce(v_item.planned_focus,v_goal,'General Fitness');v_reasons:=array_append(v_reasons,'focus:weekly_plan');
  end if;

  if p_target_region_override in ('Upper','Lower','Core','Full Body') then
    v_region:=p_target_region_override;v_reasons:=array_append(v_reasons,'region:user_day_preference');
  else
    v_region:=coalesce(v_item.planned_target_region,'Full Body');v_reasons:=array_append(v_reasons,'region:weekly_rotation');
  end if;

  if v_override_intent in ('PROGRESS','MAINTAIN','CONSOLIDATE','DELOAD','RECALIBRATE','EXPLORE') then
    v_intent:=v_override_intent;v_reasons:=array_append(v_reasons,'intent:explicit_override');
  elsif v_readiness in ('low','faible') then
    v_intent:='DELOAD';v_reasons:=array_append(v_reasons,'intent:low_readiness');
  elsif v_days_since_last is not null and v_days_since_last>=v_long_inactivity_days then
    v_intent:='RECALIBRATE';v_reasons:=array_append(v_reasons,'intent:long_inactivity_recalibrate');
  elsif v_last.id is not null and coalesce(v_last.global_rpe,0)>=9 and coalesce(v_last.post_workout_feeling,10)<=4 then
    v_intent:='DELOAD';v_reasons:=array_append(v_reasons,'intent:high_rpe_low_post_feeling');
  elsif v_exception_ratio>=0.50 then
    v_intent:='RECALIBRATE';v_reasons:=array_append(v_reasons,'intent:previous_session_many_exceptions');
  elsif v_last.id is not null and (coalesce(v_last.global_rpe,0)>=9 or coalesce(v_last.post_workout_feeling,10)<=3) then
    v_intent:='CONSOLIDATE';v_reasons:=array_append(v_reasons,'intent:recovery_guard');
  elsif v_item.id is null or v_completed_count>=v_target then
    if v_readiness in ('high','olympique') and v_confident_rows>=5 then
      v_intent:='EXPLORE';v_reasons:=array_append(v_reasons,'intent:extra_session_high_readiness_explore');
    else
      v_intent:='CONSOLIDATE';v_reasons:=array_append(v_reasons,'intent:extra_session_after_week_target');
    end if;
  elsif v_capability_rows<5 and v_completed_count=0 then
    v_intent:='RECALIBRATE';v_reasons:=array_append(v_reasons,'intent:sparse_capability_evidence');
  elsif v_pi_stage in ('MEDIUM','HIGH') and v_pi_hint='RECALIBRATE' and v_planned_intent<>'CONSOLIDATE' then
    v_intent:='RECALIBRATE';v_reasons:=array_append(v_reasons,'intent:progression_intelligence_recalibrate');
  elsif v_pi_stage in ('MEDIUM','HIGH') and v_pi_hint='CONSOLIDATE' and v_planned_intent='PROGRESS' then
    v_intent:='CONSOLIDATE';v_reasons:=array_append(v_reasons,'intent:progression_intelligence_consolidate');
  else
    v_intent:=coalesce(v_item.planned_progression_intent,'MAINTAIN');
    v_reasons:=array_append(v_reasons,'intent:weekly_plan');
    if v_pi_hint='PROGRESS' then
      v_reasons:=array_append(v_reasons,'pi:progress_signal_used_as_candidate_bias');
    elsif v_pi_hint='MAINTAIN' then
      v_reasons:=array_append(v_reasons,'pi:no_strong_intent_override');
    end if;
  end if;

  return jsonb_build_object(
    'status','READY','version','d1-session-context-v5-inactivity','week_start',v_week,'week_end',v_week+6,
    'plan_item_id',v_item.id,'sequence_index',v_item.sequence_index,'recommended_date',v_item.recommended_date,
    'weekly_session_target',v_target,'completed_before',v_completed_count,'remaining_before',greatest(0,v_target-v_completed_count),
    'extra_session',v_item.id is null,
    'focus',v_focus,'target_region',v_region,'progression_intent',v_intent,
    'days_since_last_completed_session',v_days_since_last,
    'long_inactivity_recalibrate_days',v_long_inactivity_days,
    'daily_refresh',jsonb_build_object('new_checkin_rebuilds_unstarted_session',true,'started_session_frozen_for_local_day_only',true),
    'capability_evidence',jsonb_build_object('rows',v_capability_rows,'confident_rows',v_confident_rows),
    'progression_intelligence',jsonb_build_object(
      'version',v_pi->>'version',
      'data_maturity',coalesce(v_pi->'data_maturity','{}'::jsonb),
      'session_recommendation',coalesce(v_pi->'session_recommendation','{}'::jsonb),
      'guardrails',coalesce(v_pi->'guardrails','{}'::jsonb)
    ),
    'previous_session',case when v_last.id is null then '{}'::jsonb else jsonb_build_object(
      'session_id',v_last.id,'global_rpe',v_last.global_rpe,'post_workout_feeling',v_last.post_workout_feeling,
      'target_region',v_last.target_region,'exception_ratio',round(v_exception_ratio,3)
    ) end,
    'reason_codes',to_jsonb(v_reasons),
    'weekly_stimulus_balance',coalesce((select jsonb_agg(jsonb_build_object(
      'stimulus_type',b.stimulus_type,'stimulus_key',b.stimulus_key,'unit',b.unit,'target_value',b.target_value,
      'planned_from_sessions',b.planned_from_sessions,'realized_value',b.realized_value,'remaining_to_target',b.remaining_to_target
    ) order by b.stimulus_type,b.stimulus_key) from public.weekly_stimulus_balance b where b.user_id=p_user_id and b.week_start=v_week),'[]'::jsonb)
  );
end;
$function$;;



-- SOURCE MIGRATION: 20260812080147_qa_security_harden_derived_progress_and_profile_tables.sql
-- Legacy exercise progression is calculated data. Keep own read only.
drop policy if exists "Users can insert own exercise progress" on public.user_exercise_progress;
drop policy if exists "Users can update own exercise progress" on public.user_exercise_progress;
drop policy if exists "Users can read own exercise progress" on public.user_exercise_progress;
create policy "Users can read own exercise progress"
on public.user_exercise_progress for select to authenticated
using (auth.uid() = user_id);
revoke all on table public.user_exercise_progress from anon;
revoke insert, update, delete, truncate, references, trigger on table public.user_exercise_progress from authenticated;
grant select on table public.user_exercise_progress to authenticated;

-- Training load is derived from completed sessions.
drop policy if exists "user training load insert own" on public.user_training_load;
drop policy if exists "user training load update own" on public.user_training_load;
drop policy if exists "user training load select own" on public.user_training_load;
create policy "user training load select own"
on public.user_training_load for select to authenticated
using (user_id = auth.uid());
revoke all on table public.user_training_load from anon;
revoke insert, update, delete, truncate, references, trigger on table public.user_training_load from authenticated;
grant select on table public.user_training_load to authenticated;

-- Athletic profile scores are derived analytics, not client-authored values.
drop policy if exists "user athletic profile insert own" on public.user_athletic_profile;
drop policy if exists "user athletic profile update own" on public.user_athletic_profile;
drop policy if exists "user athletic profile select own" on public.user_athletic_profile;
create policy "user athletic profile select own"
on public.user_athletic_profile for select to authenticated
using (user_id = auth.uid());
revoke all on table public.user_athletic_profile from anon;
revoke insert, update, delete, truncate, references, trigger on table public.user_athletic_profile from authenticated;
grant select on table public.user_athletic_profile to authenticated;

-- Historical athletic scores are append-only from trusted backend code.
drop policy if exists "user athletic profile history insert own" on public.user_athletic_profile_history;
drop policy if exists "user athletic profile history select own" on public.user_athletic_profile_history;
create policy "user athletic profile history select own"
on public.user_athletic_profile_history for select to authenticated
using (user_id = auth.uid());
revoke all on table public.user_athletic_profile_history from anon;
revoke insert, update, delete, truncate, references, trigger on table public.user_athletic_profile_history from authenticated;
grant select on table public.user_athletic_profile_history to authenticated;;



-- SOURCE MIGRATION: 20260812080348_qa_security_revoke_anon_from_private_user_tables.sql
revoke all on table public.profiles from anon;
revoke all on table public.user_goals from anon;
revoke all on table public.exercise_favorites from anon;
revoke all on table public.exercise_logs from anon;
revoke all on table public.workout_sessions from anon;
revoke all on table public.workout_session_exercises from anon;
revoke all on table public.user_equipment_inventory from anon;
revoke all on table public.user_athletic_baseline from anon;
revoke all on table public.external_session_imports from anon;
revoke all on table public.weekly_loop_run_errors from anon;
revoke all on table public.capability_live_run_errors from anon;
revoke all on table public.user_exercise_capabilities_shadow from anon;
revoke all on table public._backup_exercise_logs_pre_progress_v21 from anon;
revoke all on table public._backup_workout_session_exercises_pre_progress_v21 from anon;
revoke all on table public.programs from anon;
revoke all on table public.workout_logs from anon;
revoke all on table public.workout_requests from anon;;



-- SOURCE MIGRATION: 20260812080645_c45_resolve_nested_live_load_capability.sql
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



-- SOURCE MIGRATION: 20260812081036_b29_repeat_confirm_numeric_load_before_coaching.sql
create or replace function public.propose_capability_state_update(
  p_state jsonb,
  p_family text,
  p_expected jsonb,
  p_actual jsonb,
  p_quality numeric,
  p_capability_eligible boolean,
  p_pain_affected boolean,
  p_comparison jsonb default '{}'::jsonb,
  p_policy_key text default 'b2.5-draft-default'::text,
  p_observed_at timestamptz default now()
)
returns jsonb
language plpgsql
stable
as $function$
declare
  v_result jsonb;
  v_state jsonb;
  v_cap_key text;
  v_mode text:=coalesce(nullif(p_comparison->>'capability_mode',''),'repeatable');
  v_signature text:=nullif(p_comparison->>'protocol_signature','');
  v_env_key text;
  v_root jsonb;
  v_sub jsonb;
  v_old_root jsonb;
  v_old_sub jsonb;
  v_candidate jsonb;
  v_evidence_root jsonb;
  v_ev jsonb;
  v_context text:=coalesce(nullif(p_comparison->>'protocol_signature',''),p_family||'|'||coalesce(nullif(p_comparison->>'capability_mode',''),'repeatable'));
  v_prev_failure_context text;
  v_failure_count int:=0;
  v_negative_required int:=3;
  v_expected_min numeric;
  v_actual_value numeric;
  v_prescription_failure boolean:=false;
  v_load_actual numeric;
  v_load_reps numeric;
  v_load_candidate numeric;
  v_load_confirmed numeric;
  v_load_expected_reps_min numeric;
  v_load_performance_valid boolean:=true;
  v_same_load_candidate boolean:=false;
begin
  v_result:=public.propose_capability_state_update_core(
    p_state,p_family,p_expected,p_actual,p_quality,p_capability_eligible,p_pain_affected,
    p_comparison,p_policy_key,p_observed_at
  );

  v_state:=coalesce(v_result->'after_state','{}'::jsonb);
  v_cap_key:=v_result->>'capability_key';
  v_env_key:=case p_family
    when 'reps' then 'reps_envelope'
    when 'load_reps' then 'load_envelope'
    when 'time' then 'time_envelope'
    when 'pace' then 'pace_envelope'
    when 'loaded_distance' then 'distance_envelope'
    when 'density' then 'density_envelope'
    when 'progressive' then 'progressive_envelope'
  end;

  v_old_root:=coalesce(p_state->v_env_key,'{}'::jsonb);
  if p_family in ('density','progressive') then
    v_old_sub:=coalesce(v_old_root#>array['protocols',coalesce(v_signature,'missing')],'{}'::jsonb);
  else
    v_old_sub:=coalesce(v_old_root->v_mode,'{}'::jsonb);
  end if;

  v_root:=coalesce(v_state->v_env_key,'{}'::jsonb);
  if p_family in ('density','progressive') then
    v_sub:=coalesce(v_root#>array['protocols',coalesce(v_signature,'missing')],'{}'::jsonb);
  else
    v_sub:=coalesce(v_root->v_mode,'{}'::jsonb);
  end if;

  -- Loaded performance points have a stricter contract than generic positive
  -- evidence: a numeric coaching load is only trusted after the same load has
  -- been observed on two separate eligible exposures.
  if p_family='load_reps'
     and coalesce(p_capability_eligible,false)
     and not coalesce(p_pain_affected,false)
     and coalesce(p_quality,0)>0 then

    v_load_actual:=public.jsonb_num(p_actual,'load_kg');
    v_load_reps:=public.jsonb_num(p_actual,'reps');
    v_load_expected_reps_min:=public.jsonb_num(p_expected,'reps_min');
    v_load_performance_valid:=v_load_expected_reps_min is null
      or (v_load_reps is not null and v_load_reps>=v_load_expected_reps_min);
    v_load_candidate:=nullif(v_old_sub#>>'{load_confirmation_candidate,load_kg}','')::numeric;
    v_load_confirmed:=nullif(v_old_sub->>'numeric_load_confirmed_max_kg','')::numeric;
    v_same_load_candidate:=v_load_actual is not null
      and v_load_candidate is not null
      and abs(v_load_actual-v_load_candidate)<=0.001;

    if v_load_actual is not null and v_load_actual>0 and v_load_performance_valid then
      if v_same_load_candidate then
        -- Second exposure at the same load: now safe for numeric coaching.
        v_sub:=v_sub-'load_confirmation_candidate';
        v_sub:=jsonb_set(v_sub,'{numeric_load_confirmed_max_kg}',to_jsonb(greatest(coalesce(v_load_confirmed,0),v_load_actual)),true);
        v_sub:=jsonb_set(v_sub,'{numeric_load_last_confirmed_at}',to_jsonb(p_observed_at),true);
        v_sub:=jsonb_set(v_sub,'{numeric_load_confirmation_rule}',to_jsonb('repeat_same_load_on_distinct_exposure'::text),true);
        v_root:=jsonb_set(v_root,array[v_mode],v_sub,true);
        v_state:=jsonb_set(v_state,array['load_envelope'],v_root,true);
        v_result:=jsonb_set(v_result,array['after_state'],v_state,true);
        v_result:=jsonb_set(v_result,array['proposal','after'],v_sub,true);
      elsif v_load_confirmed is null or v_load_actual>v_load_confirmed then
        -- First sighting of an unconfirmed/new higher load. Keep the historical
        -- observation, but do not let it become a numeric coaching reference.
        v_candidate:=jsonb_build_object(
          'load_kg',v_load_actual,
          'reps',v_load_reps,
          'rpe',public.jsonb_num(p_actual,'rpe'),
          'observed_at',p_observed_at,
          'quality',public.num_clamp(coalesce(p_quality,0),0,1),
          'status','AWAITING_REPEAT_CONFIRMATION'
        );

        if coalesce(v_result->>'decision','')='ADD_FRONTIER_POINT' then
          -- Restore the previously trusted frontier until this exact load is
          -- observed again on another exposure.
          v_sub:=v_old_sub||jsonb_build_object('load_confirmation_candidate',v_candidate);
          v_root:=v_old_root;
          v_root:=jsonb_set(v_root,array[v_mode],v_sub,true);
          v_state:=jsonb_set(v_state,array['load_envelope'],v_root,true);
          v_result:=jsonb_set(v_result,array['decision'],to_jsonb('HOLD'::text),true);
          v_result:=jsonb_set(v_result,array['after_state'],v_state,true);
          v_result:=jsonb_set(v_result,array['proposal','decision'],to_jsonb('HOLD'::text),true);
          v_result:=jsonb_set(v_result,array['proposal','after'],v_sub,true);
          v_result:=jsonb_set(v_result,array['proposal','reason_codes'],jsonb_build_array('LOAD_FRONTIER_POINT_REQUIRES_REPEAT_CONFIRMATION'),true);
          v_root:=coalesce(v_state->'load_envelope','{}'::jsonb);
          v_sub:=coalesce(v_root->v_mode,'{}'::jsonb);
        else
          -- FIRST_VALID_LOAD_REP_POINT may remain in the descriptive frontier,
          -- but it is explicitly non-prescribable until repeated.
          v_sub:=jsonb_set(v_sub,'{load_confirmation_candidate}',v_candidate,true);
          v_sub:=v_sub-'numeric_load_confirmed_max_kg';
          v_root:=jsonb_set(v_root,array[v_mode],v_sub,true);
          v_state:=jsonb_set(v_state,array['load_envelope'],v_root,true);
          v_result:=jsonb_set(v_result,array['after_state'],v_state,true);
          v_result:=jsonb_set(v_result,array['proposal','after'],v_sub,true);
          v_result:=jsonb_set(v_result,array['proposal','reason_codes'],jsonb_build_array('LOAD_POINT_OBSERVED_AWAITING_REPEAT_CONFIRMATION'),true);
        end if;
      elsif v_load_candidate is not null and not v_same_load_candidate and v_load_actual<=coalesce(v_load_confirmed,0) then
        -- Returning to an already confirmed load invalidates a pending spike.
        v_sub:=v_sub-'load_confirmation_candidate';
        v_root:=jsonb_set(v_root,array[v_mode],v_sub,true);
        v_state:=jsonb_set(v_state,array['load_envelope'],v_root,true);
        v_result:=jsonb_set(v_result,array['after_state'],v_state,true);
        v_result:=jsonb_set(v_result,array['proposal','after'],v_sub,true);
      end if;
    end if;
  end if;

  -- Existing confirmed negative behavior: historical best is never erased in one step.
  if coalesce(v_result->>'decision','')='REGRESS_CONFIRMED' then
    v_root:=coalesce(v_state->v_env_key,'{}'::jsonb);
    if p_family in ('density','progressive') then
      v_sub:=coalesce(v_root#>array['protocols',coalesce(v_signature,'missing')],'{}'::jsonb);
    else
      v_sub:=coalesce(v_root->v_mode,'{}'::jsonb);
    end if;

    v_candidate:=jsonb_build_object(
      'actual',coalesce(p_actual,'{}'::jsonb),
      'expected',coalesce(p_expected,'{}'::jsonb),
      'quality',public.num_clamp(coalesce(p_quality,0),0,1),
      'comparison',coalesce(p_comparison,'{}'::jsonb),
      'observed_at',p_observed_at,
      'status','CONFIRMED_NEGATIVE_RECALIBRATION'
    );
    v_sub:=jsonb_set(v_sub,array['recalibration_candidate'],v_candidate,true);

    if p_family in ('density','progressive') then
      v_root:=jsonb_set(v_root,array['protocols',coalesce(v_signature,'missing')],v_sub,true);
    else
      v_root:=jsonb_set(v_root,array[v_mode],v_sub,true);
    end if;
    v_state:=jsonb_set(v_state,array[v_env_key],v_root,true);

    if v_cap_key is not null then
      v_state:=jsonb_set(v_state,array['evidence_json',v_cap_key,'last_decision'],to_jsonb('RECALIBRATE'::text),true);
    end if;

    v_result:=jsonb_set(v_result,array['decision'],to_jsonb('RECALIBRATE'::text),true);
    v_result:=jsonb_set(v_result,array['after_state'],v_state,true);
    v_result:=jsonb_set(v_result,array['proposal','decision'],to_jsonb('RECALIBRATE'::text),true);
    v_result:=jsonb_set(v_result,array['proposal','after'],v_sub,true);
    v_result:=jsonb_set(v_result,array['proposal','reason_codes'],jsonb_build_array('CONFIRMED_NEGATIVE_REQUIRES_RECALIBRATION'),true);
    return v_result;
  end if;

  -- Prescription failure is distinct from losing the historical best.
  if coalesce(p_capability_eligible,false) and not coalesce(p_pain_affected,false) and coalesce(p_quality,0)>0 then
    if p_family in ('reps','load_reps') then
      v_expected_min:=public.jsonb_num(p_expected,'reps_min');
      v_actual_value:=public.jsonb_num(p_actual,'reps');
      v_prescription_failure:=v_expected_min is not null and v_actual_value is not null and v_actual_value < v_expected_min;
    elsif p_family='time' then
      v_expected_min:=public.jsonb_num(p_expected,'duration_seconds_min');
      v_actual_value:=public.jsonb_num(p_actual,'duration_seconds');
      v_prescription_failure:=v_expected_min is not null and v_actual_value is not null and v_actual_value < v_expected_min;
    end if;
  end if;

  v_root:=coalesce(v_state->v_env_key,'{}'::jsonb);
  if p_family in ('density','progressive') then
    v_sub:=coalesce(v_root#>array['protocols',coalesce(v_signature,'missing')],'{}'::jsonb);
  else
    v_sub:=coalesce(v_root->v_mode,'{}'::jsonb);
  end if;

  if v_cap_key is not null then
    v_evidence_root:=coalesce(v_state->'evidence_json','{}'::jsonb);
    v_ev:=coalesce(v_evidence_root->v_cap_key,'{}'::jsonb);
  else
    v_evidence_root:='{}'::jsonb;
    v_ev:='{}'::jsonb;
  end if;

  if v_prescription_failure and v_cap_key is not null then
    select coalesce(negative_confirmations_required,3)
      into v_negative_required
    from public.performance_engine_policy
    where policy_key=p_policy_key;
    v_negative_required:=coalesce(v_negative_required,3);

    v_prev_failure_context:=v_sub#>>'{prescription_failure_streak,context}';
    if v_prev_failure_context is distinct from v_context then
      v_failure_count:=1;
    else
      v_failure_count:=coalesce((v_sub#>>'{prescription_failure_streak,count}')::int,0)+1;
    end if;

    v_sub:=jsonb_set(v_sub,array['prescription_failure_streak'],jsonb_build_object(
      'count',v_failure_count,
      'context',v_context,
      'last_failed_at',p_observed_at,
      'actual',coalesce(p_actual,'{}'::jsonb),
      'expected',coalesce(p_expected,'{}'::jsonb)
    ),true);

    if v_failure_count>=v_negative_required then
      v_candidate:=jsonb_build_object(
        'actual',coalesce(p_actual,'{}'::jsonb),
        'expected',coalesce(p_expected,'{}'::jsonb),
        'quality',public.num_clamp(coalesce(p_quality,0),0,1),
        'comparison',coalesce(p_comparison,'{}'::jsonb),
        'observed_at',p_observed_at,
        'status','REPEATED_PRESCRIPTION_FAILURE_RECALIBRATION',
        'failure_count',v_failure_count
      );
      v_sub:=jsonb_set(v_sub,array['recalibration_candidate'],v_candidate,true);
      v_ev:=jsonb_set(v_ev,array['last_decision'],to_jsonb('RECALIBRATE'::text),true);
      v_result:=jsonb_set(v_result,array['decision'],to_jsonb('RECALIBRATE'::text),true);
      v_result:=jsonb_set(v_result,array['proposal','decision'],to_jsonb('RECALIBRATE'::text),true);
      v_result:=jsonb_set(v_result,array['proposal','reason_codes'],jsonb_build_array('REPEATED_BELOW_PRESCRIPTION_MIN','RECALIBRATION_REQUIRED'),true);
    else
      v_ev:=jsonb_set(v_ev,array['last_decision'],to_jsonb('HOLD'::text),true);
      v_result:=jsonb_set(v_result,array['decision'],to_jsonb('HOLD'::text),true);
      v_result:=jsonb_set(v_result,array['proposal','decision'],to_jsonb('HOLD'::text),true);
      v_result:=jsonb_set(v_result,array['proposal','reason_codes'],jsonb_build_array('BELOW_PRESCRIPTION_MIN_UNCONFIRMED'),true);
    end if;

    v_evidence_root:=jsonb_set(v_evidence_root,array[v_cap_key],v_ev,true);
    v_state:=jsonb_set(v_state,array['evidence_json'],v_evidence_root,true);
    if p_family in ('density','progressive') then
      v_root:=jsonb_set(v_root,array['protocols',coalesce(v_signature,'missing')],v_sub,true);
    else
      v_root:=jsonb_set(v_root,array[v_mode],v_sub,true);
    end if;
    v_state:=jsonb_set(v_state,array[v_env_key],v_root,true);
    v_result:=jsonb_set(v_result,array['after_state'],v_state,true);
    v_result:=jsonb_set(v_result,array['proposal','after'],v_sub,true);
    return v_result;
  end if;

  -- Successful comparable exposure clears a pending consecutive failure streak.
  if coalesce((v_sub#>>'{prescription_failure_streak,count}')::int,0)>0 then
    v_sub:=jsonb_set(v_sub,array['prescription_failure_streak'],jsonb_build_object(
      'count',0,'context',v_context,'cleared_at',p_observed_at
    ),true);
    if p_family in ('density','progressive') then
      v_root:=jsonb_set(v_root,array['protocols',coalesce(v_signature,'missing')],v_sub,true);
    else
      v_root:=jsonb_set(v_root,array[v_mode],v_sub,true);
    end if;
    v_state:=jsonb_set(v_state,array[v_env_key],v_root,true);
    v_result:=jsonb_set(v_result,array['after_state'],v_state,true);
  end if;

  return v_result;
end;
$function$;

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
begin
  -- Only the repeatable load explicitly confirmed on two distinct exposures
  -- is allowed to become a numeric coaching prescription.
  v_cap_max:=nullif(p_load_envelope#>>'{repeatable,numeric_load_confirmed_max_kg}','')::numeric;

  -- Backward compatibility only for the old pre-B2.7 root shape.
  if v_cap_max is null
     and p_load_envelope ? 'frontier'
     and jsonb_typeof(coalesce(p_load_envelope->'frontier','null'::jsonb))='array' then
    select max(nullif(x->>'load_kg','')::numeric)
    into v_cap_max
    from jsonb_array_elements(coalesce(p_load_envelope->'frontier','[]'::jsonb)) x;
  end if;

  if v_cap_max is null or v_cap_max<=0 then
    return jsonb_build_object('confirmed',false,'reason','no_repeat_confirmed_numeric_load_capability');
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
      'reason','no_inventory_load_within_repeat_confirmed_capability',
      'capability_max_load_kg',v_cap_max,
      'capability_mode','repeatable_confirmed'
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
    'capability_mode','repeatable_confirmed',
    'source','repeat_confirmed_capability_intersect_real_inventory'
  );
end;
$function$;;



-- SOURCE MIGRATION: 20260812081205_b29_promote_repeat_confirmed_load_to_frontier.sql
alter function public.propose_capability_state_update(jsonb,text,jsonb,jsonb,numeric,boolean,boolean,jsonb,text,timestamptz)
rename to propose_capability_state_update_b29;

create or replace function public.propose_capability_state_update(
  p_state jsonb,
  p_family text,
  p_expected jsonb,
  p_actual jsonb,
  p_quality numeric,
  p_capability_eligible boolean,
  p_pain_affected boolean,
  p_comparison jsonb default '{}'::jsonb,
  p_policy_key text default 'b2.5-draft-default'::text,
  p_observed_at timestamptz default now()
)
returns jsonb
language plpgsql
stable
as $function$
declare
  v_result jsonb;
  v_state jsonb;
  v_mode text:=coalesce(nullif(p_comparison->>'capability_mode',''),'repeatable');
  v_old_sub jsonb;
  v_sub jsonb;
  v_candidate_load numeric;
  v_confirmed_before numeric;
  v_actual_load numeric;
  v_actual_reps numeric;
  v_expected_reps_min numeric;
  v_frontier jsonb;
  v_point jsonb;
begin
  v_result:=public.propose_capability_state_update_b29(
    p_state,p_family,p_expected,p_actual,p_quality,p_capability_eligible,p_pain_affected,
    p_comparison,p_policy_key,p_observed_at
  );

  if p_family<>'load_reps'
     or not coalesce(p_capability_eligible,false)
     or coalesce(p_pain_affected,false)
     or coalesce(p_quality,0)<=0 then
    return v_result;
  end if;

  v_old_sub:=coalesce(p_state#>array['load_envelope',v_mode],'{}'::jsonb);
  v_candidate_load:=nullif(v_old_sub#>>'{load_confirmation_candidate,load_kg}','')::numeric;
  v_confirmed_before:=nullif(v_old_sub->>'numeric_load_confirmed_max_kg','')::numeric;
  v_actual_load:=public.jsonb_num(p_actual,'load_kg');
  v_actual_reps:=public.jsonb_num(p_actual,'reps');
  v_expected_reps_min:=public.jsonb_num(p_expected,'reps_min');

  -- Only the second distinct exposure at the same load can promote it into
  -- the trusted frontier. The B2.9 base wrapper has already recorded the
  -- numeric confirmation; here we make the descriptive frontier consistent.
  if v_candidate_load is not null
     and v_actual_load is not null
     and abs(v_actual_load-v_candidate_load)<=0.001
     and (v_expected_reps_min is null or (v_actual_reps is not null and v_actual_reps>=v_expected_reps_min))
     and v_actual_load>coalesce(v_confirmed_before,0) then

    v_state:=coalesce(v_result->'after_state','{}'::jsonb);
    v_sub:=coalesce(v_state#>array['load_envelope',v_mode],'{}'::jsonb);

    select coalesce(jsonb_agg(value order by value->>'load_kg',value->>'reps'),'[]'::jsonb)
    into v_frontier
    from jsonb_array_elements(coalesce(v_sub->'frontier','[]'::jsonb)) x(value)
    where not (
      public.jsonb_num(value,'load_kg') is not null
      and public.jsonb_num(value,'reps') is not null
      and public.jsonb_num(value,'load_kg')<=v_actual_load
      and public.jsonb_num(value,'reps')<=coalesce(v_actual_reps,0)
    );

    v_point:=jsonb_strip_nulls(jsonb_build_object(
      'load_kg',v_actual_load,
      'reps',v_actual_reps,
      'rpe',public.jsonb_num(p_actual,'rpe'),
      'quality',public.num_clamp(coalesce(p_quality,0),0,1),
      'observed_at',p_observed_at,
      'confirmation','repeat_same_load_on_distinct_exposure'
    ));

    v_frontier:=v_frontier||jsonb_build_array(v_point);
    v_sub:=jsonb_set(v_sub,'{frontier}',v_frontier,true);
    v_sub:=jsonb_set(v_sub,'{last_observed_at}',to_jsonb(p_observed_at),true);
    v_sub:=v_sub-'load_confirmation_candidate';

    v_state:=jsonb_set(v_state,array['load_envelope',v_mode],v_sub,true);
    v_result:=jsonb_set(v_result,'{decision}',to_jsonb('ADD_FRONTIER_POINT'::text),true);
    v_result:=jsonb_set(v_result,'{after_state}',v_state,true);
    v_result:=jsonb_set(v_result,'{proposal,decision}',to_jsonb('ADD_FRONTIER_POINT'::text),true);
    v_result:=jsonb_set(v_result,'{proposal,after}',v_sub,true);
    v_result:=jsonb_set(v_result,'{proposal,reason_codes}',jsonb_build_array('REPEAT_CONFIRMED_LOAD_FRONTIER_POINT'),true);
  end if;

  return v_result;
end;
$function$;;



-- SOURCE MIGRATION: 20260812081344_pi5_treat_load_frontier_expansion_as_progress.sql
create or replace function public.pi_exercise_directives(
  p_user_id uuid,
  p_anchor_date date default current_date,
  p_period_days integer default 90
)
returns table(
  exercise_id text,
  exercise_name text,
  movement_pattern text,
  training_focus text,
  body_region text,
  directive text,
  priority_score numeric,
  confidence numeric,
  evidence_count integer,
  source text,
  latest_decision text,
  reason_codes text[]
)
language sql
stable
security definer
set search_path to 'public'
as $function$
with cfg as (
  select coalesce(p_anchor_date,current_date) anchor_date,
         greatest(28,least(coalesce(p_period_days,90),3650)) period_days
), latest_live as (
  select distinct on (cue.exercise_id)
    cue.exercise_id::text,
    cue.decision,
    coalesce(el.created_at,cue.created_at) observed_at
  from public.capability_update_events cue
  left join public.exercise_logs el on el.id=cue.exercise_log_id
  cross join cfg
  where cue.user_id=p_user_id
    and cue.applied
    and coalesce(el.created_at,cue.created_at)::date >= cfg.anchor_date-cfg.period_days
    and coalesce(el.created_at,cue.created_at)::date <= cfg.anchor_date
  order by cue.exercise_id,coalesce(el.created_at,cue.created_at) desc,cue.id desc
), base as (
  select
    cs.exercise_id::text,
    e.name::text exercise_name,
    e.movement_pattern::text,
    e.training_focus::text,
    e.body_region::text,
    coalesce(cs.exposure_count,0)::int exposure_count,
    coalesce(cs.valid_evidence_count,0)::int valid_evidence_count,
    cs.state,
    cs.recommendation,
    coalesce(cs.performance_delta,0)::numeric performance_delta,
    greatest(
      least(1.0,coalesce(cs.capability_confidence,0)::numeric),
      least(1.0,coalesce(cs.overall_confidence,0)::numeric/100.0)
    ) raw_confidence,
    cs.last_observed_at,
    ll.decision latest_decision,
    ll.observed_at latest_live_at,
    cfg.anchor_date,
    cfg.period_days
  from public.user_exercise_coach_state cs
  join public.exercises e on e.id=cs.exercise_id
  cross join cfg
  left join latest_live ll on ll.exercise_id=cs.exercise_id
  where coalesce(cs.exposure_count,0)>0
     or coalesce(cs.valid_evidence_count,0)>0
     or ll.exercise_id is not null
), normalized as (
  select b.*,
    greatest(0,least(1,
      b.raw_confidence * case
        when b.last_observed_at is null then 0.75
        when b.last_observed_at::date >= b.anchor_date-45 then 1.0
        when b.last_observed_at::date >= b.anchor_date-90 then 0.85
        when b.last_observed_at::date >= b.anchor_date-180 then 0.65
        else 0.45 end
    ))::numeric effective_confidence,
    greatest(b.exposure_count,b.valid_evidence_count)::int effective_evidence
  from base b
), classified as (
  select n.*,
    case
      when n.latest_decision='RECALIBRATE' and n.effective_confidence>=0.40 then 'RECALIBRATE'
      when n.latest_decision in ('EXPAND','ADD_FRONTIER_POINT') and n.effective_confidence>=0.45 then 'PROGRESS'
      when n.recommendation='PROGRESS_RECOMMENDED' and n.effective_confidence>=0.55 then 'PROGRESS'
      when n.recommendation='PROGRESS_POSSIBLE' and n.effective_confidence>=0.45 then 'DEVELOP'
      when n.state='RECOVER' and n.effective_evidence>=2 then 'CONSOLIDATE'
      when n.effective_evidence<3 or n.effective_confidence<0.35 then 'LEARN'
      else 'MAINTAIN'
    end directive
  from normalized n
)
select
  c.exercise_id,c.exercise_name,c.movement_pattern,c.training_focus,c.body_region,c.directive,
  round((case c.directive
    when 'RECALIBRATE' then 96
    when 'PROGRESS' then 92
    when 'DEVELOP' then 84
    when 'CONSOLIDATE' then 72
    when 'MAINTAIN' then 62
    else 45 end) * (0.65+0.35*c.effective_confidence),2) priority_score,
  round(c.effective_confidence,4) confidence,
  c.effective_evidence evidence_count,
  case when c.latest_decision is not null then 'b2.7-live-capability'
       when c.recommendation is not null then 'legacy-progress-fallback'
       else 'evidence-learning' end source,
  c.latest_decision,
  array_remove(array[
    case when c.latest_decision='EXPAND' then 'LIVE_CAPABILITY_EXPANDED' end,
    case when c.latest_decision='ADD_FRONTIER_POINT' then 'LIVE_LOAD_FRONTIER_EXPANDED' end,
    case when c.latest_decision='RECALIBRATE' then 'LIVE_CAPABILITY_RECALIBRATION' end,
    case when c.recommendation='PROGRESS_RECOMMENDED' then 'LEGACY_PROGRESS_RECOMMENDED' end,
    case when c.recommendation='PROGRESS_POSSIBLE' then 'LEGACY_PROGRESS_POSSIBLE' end,
    case when c.state='RECOVER' then 'RECOVERY_STATE' end,
    case when c.effective_evidence<3 then 'SPARSE_EVIDENCE' end,
    case when c.effective_confidence<0.35 then 'LOW_CONFIDENCE' end
  ],null)::text[] reason_codes
from classified c
order by priority_score desc,c.exercise_id;
$function$;;



-- SOURCE MIGRATION: 20260812081533_c46_swap_never_increases_technical_complexity.sql
create or replace function public.c4_swap_session_exercise(
  p_user_id uuid,
  p_session_exercise_id uuid,
  p_excluded_exercise_ids text[] default '{}'::text[]
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  target record;
  ws record;
  v_names text[];
  v_inventory jsonb;
  v_base jsonb;v_candidate jsonb;v_exercises jsonb;v_final jsonb;v_prepared jsonb;v_gate jsonb;v_red jsonb;v_quality jsonb;
  v_best jsonb:=null;v_best_gate jsonb:=null;v_best_red jsonb:=null;v_best_score numeric:=-1e9;
  v_score numeric;v_same_pattern numeric;v_same_family numeric;v_wod_min int;v_max_complexity int;
  r record;v_pres jsonb;v_new_ex jsonb;v_result jsonb;v_new_id text:=null;v_tested int:=0;v_new_complexity int:=null;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;

  select wse.*,e.movement_pattern old_pattern,e.exercise_family old_family,e.technical_complexity old_complexity
  into target
  from public.workout_session_exercises wse
  join public.workout_sessions s on s.id=wse.session_id
  join public.exercises e on e.id=wse.exercise_id
  where wse.id=p_session_exercise_id and s.user_id=p_user_id;
  if not found then raise exception 'Session exercise instance not found'; end if;
  if target.block_key<>'wod' then
    return jsonb_build_object('status','NOT_SUPPORTED','reason','C4_SWAP_REQUIRES_WOD_INSTANCE','session_exercise_id',p_session_exercise_id,'mutated',false);
  end if;

  select * into ws from public.workout_sessions where id=target.session_id and user_id=p_user_id for update;
  if ws.status not in ('generated','in_progress') then raise exception 'Session cannot swap in status %',ws.status; end if;

  v_names:=coalesce(ws.available_equipment,'{}'::text[]);
  if cardinality(v_names)=0 then
    select coalesce(array_agg(e.name order by e.id),'{}'::text[]) into v_names
    from public.user_equipment_inventory ui join public.equipment e on e.id=ui.equipment_id
    where ui.user_id=p_user_id and ui.active;
  end if;
  if cardinality(v_names)=0 then v_names:=array['Aucun']; end if;
  v_inventory:=public.resolve_user_equipment_inventory(p_user_id,v_names,'c4-final-default');
  v_base:=public.c4_session_wod_candidate(target.session_id);
  v_wod_min:=coalesce(nullif(ws.mechanic_json->>'wod_budget_minutes','')::int,nullif(ws.planning_context_json#>>'{architecture,wod_minutes}','')::int,
    (select nullif(b->>'duration_minutes','')::int from jsonb_array_elements(coalesce(ws.generated_workout->'blocks','[]'::jsonb)) b where b->>'block_key'='wod' limit 1),10);
  v_max_complexity:=case lower(coalesce(ws.readiness,'normal')) when 'low' then 3 else 5 end;

  for r in
    select cp.*,ne.technical_complexity as new_complexity
    from public.c2_candidate_pool(
      p_user_id,coalesce(ws.focus,'General Fitness'),coalesce(ws.duration_minutes,45),coalesce(ws.readiness,'normal'),ws.target_region,ws.progression_intent,
      coalesce(ws.injured_zones,'{}'::text[]),v_inventory,'WOD',v_max_complexity,'Avancé',60
    ) cp
    join public.exercises ne on ne.id=cp.exercise_id
    where cp.exercise_id<>target.exercise_id
      and coalesce(ne.technical_complexity,99)<=coalesce(target.old_complexity,v_max_complexity)
      and not (cp.exercise_id=any(coalesce(p_excluded_exercise_ids,'{}'::text[])))
      and not exists(select 1 from jsonb_array_elements(v_base->'exercises') x where x->>'exercise_id'=cp.exercise_id)
    order by
      case when cp.movement_pattern=target.old_pattern then 0 when cp.exercise_family=target.old_family then 1 else 2 end,
      cp.candidate_score desc,cp.exercise_id
  loop
    v_tested:=v_tested+1;
    exit when v_tested>25;
    v_pres:=public.c2_solver_prescription(p_user_id,r.exercise_id,ws.expected_stimulus_json,v_base->>'mechanic',ws.progression_intent,v_inventory);
    v_new_ex:=jsonb_build_object('exercise_id',r.exercise_id,'name',r.exercise_name,'pattern',r.movement_pattern,'family',r.exercise_family,
      'candidate_score',r.candidate_score,'components',r.score_components,'prescription',v_pres);

    select coalesce(jsonb_agg(case when ord=target.position then v_new_ex else value end order by ord),'[]'::jsonb)
    into v_exercises
    from jsonb_array_elements(v_base->'exercises') with ordinality x(value,ord);

    v_candidate:=jsonb_set(v_base,'{exercises}',v_exercises,true);
    v_prepared:=public.c4_prepare_candidate(v_candidate,'c4-final-default');
    v_final:=public.c4_finalize_candidate(v_prepared,ws.expected_stimulus_json,coalesce(ws.duration_minutes,45),v_wod_min,'c4-final-default','c3-sim-default');
    v_gate:=public.c4_candidate_quality_gate_v2(v_final,coalesce(ws.readiness,'normal'),coalesce(ws.focus,'General Fitness'),ws.target_region,
      coalesce(ws.injured_zones,'{}'::text[]),v_inventory,v_max_complexity,'c4-final-default');
    if coalesce((v_gate->>'pass')::boolean,false)=false or coalesce((v_final#>>'{c4_final,feasible}')::boolean,false)=false then continue; end if;

    v_red:=public.c4_redundancy_score(p_user_id,v_final,'c4-final-default');
    v_same_pattern:=case when r.movement_pattern=target.old_pattern then 10 else 0 end;
    v_same_family:=case when r.exercise_family=target.old_family then 5 else 0 end;
    v_score:=coalesce(r.candidate_score,0)*0.40+coalesce((v_final#>>'{c4_final,whole_wod_metrics,whole_wod_fit}')::numeric,0)*0.40+
      coalesce((v_red->>'score')::numeric,0)*0.20+v_same_pattern+v_same_family;

    if v_score>v_best_score then
      v_best_score:=v_score;v_best:=v_final;v_best_gate:=v_gate;v_best_red:=v_red;v_new_id:=r.exercise_id;v_new_complexity:=r.new_complexity;
    end if;
  end loop;

  if v_best is null then
    return jsonb_build_object(
      'status','NO_SAFE_SWAP','mutated',false,'session_exercise_id',p_session_exercise_id,
      'old_exercise_id',target.exercise_id,'old_technical_complexity',target.old_complexity,
      'candidates_tested',v_tested,'technical_complexity_must_not_increase',true
    );
  end if;

  v_quality:=v_best_gate||jsonb_build_object(
    'anti_redundancy',v_best_red,
    'swap_full_wod_resimulated',true,
    'swap_score',round(v_best_score,2),
    'target_session_exercise_id',p_session_exercise_id,
    'old_technical_complexity',target.old_complexity,
    'new_technical_complexity',v_new_complexity,
    'technical_complexity_non_increasing',coalesce(v_new_complexity,99)<=coalesce(target.old_complexity,v_max_complexity)
  );
  v_result:=public.c4_apply_wod_candidate(p_user_id,target.session_id,v_best,v_quality,'SWAP_INSTANCE:'||p_session_exercise_id::text);

  return jsonb_build_object(
    'status','APPLIED','mutated',true,'session_id',target.session_id,'session_exercise_id',p_session_exercise_id,
    'position',target.position,'old_exercise_id',target.exercise_id,'new_exercise_id',v_new_id,'candidates_tested',v_tested,
    'old_technical_complexity',target.old_complexity,'new_technical_complexity',v_new_complexity,
    'technical_complexity_non_increasing',coalesce(v_new_complexity,99)<=coalesce(target.old_complexity,v_max_complexity),
    'full_wod_resimulated',true,'quality_gate',v_quality,'result',v_result
  );
end;
$function$;;



-- SOURCE MIGRATION: 20260812081704_c47_lock_format_after_wod_reveal.sql
alter table public.workout_sessions
add column if not exists wod_revealed_at timestamptz;

create or replace function public.mark_wod_revealed(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user uuid:=auth.uid();
  v_session public.workout_sessions%rowtype;
begin
  if v_user is null then raise exception 'Authentication required'; end if;

  select * into v_session
  from public.workout_sessions
  where id=p_session_id and user_id=v_user
  for update;

  if not found then raise exception 'Session not found'; end if;
  if v_session.status not in ('generated','in_progress') then
    return jsonb_build_object('status','NOT_REVEALABLE','session_id',p_session_id,'session_status',v_session.status);
  end if;

  update public.workout_sessions
  set wod_revealed_at=coalesce(wod_revealed_at,now()),updated_at=now()
  where id=p_session_id and user_id=v_user
  returning * into v_session;

  return jsonb_build_object(
    'status','WOD_REVEALED',
    'session_id',p_session_id,
    'wod_revealed_at',v_session.wod_revealed_at,
    'format_locked',true
  );
end;
$function$;

revoke execute on function public.mark_wod_revealed(uuid) from public,anon;
grant execute on function public.mark_wod_revealed(uuid) to authenticated;

alter function public.c4_evaluate_session_format(uuid,uuid,text,text)
rename to c4_evaluate_session_format_pre_reveal_guard;

create or replace function public.c4_evaluate_session_format(
  p_user_id uuid,
  p_session_id uuid,
  p_new_mechanic text,
  p_variant_key text default null::text
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_revealed_at timestamptz;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;

  select wod_revealed_at into v_revealed_at
  from public.workout_sessions
  where id=p_session_id and user_id=p_user_id;

  if not found then
    return jsonb_build_object('compatible',false,'classification','NOT_RECOMMENDED','reason_codes',jsonb_build_array('SESSION_NOT_FOUND'));
  end if;

  if v_revealed_at is not null then
    return jsonb_build_object(
      'compatible',false,
      'classification','LOCKED_AFTER_WOD_REVEAL',
      'reason_codes',jsonb_build_array('WOD_ALREADY_REVEALED'),
      'wod_revealed_at',v_revealed_at
    );
  end if;

  return public.c4_evaluate_session_format_pre_reveal_guard(p_user_id,p_session_id,p_new_mechanic,p_variant_key);
end;
$function$;

alter function public.c4_recompile_session_format_core(uuid,uuid,text,text,jsonb)
rename to c4_recompile_session_format_core_pre_reveal_guard;

create or replace function public.c4_recompile_session_format_core(
  p_user_id uuid,
  p_session_id uuid,
  p_new_mechanic text,
  p_variant_key text default null::text,
  p_overlays jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_revealed_at timestamptz;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;

  select wod_revealed_at into v_revealed_at
  from public.workout_sessions
  where id=p_session_id and user_id=p_user_id
  for update;

  if not found then raise exception 'Session not found'; end if;

  if v_revealed_at is not null then
    return jsonb_build_object(
      'status','LOCKED_AFTER_WOD_REVEAL',
      'classification','LOCKED_AFTER_WOD_REVEAL',
      'mutated',false,
      'session_id',p_session_id,
      'wod_revealed_at',v_revealed_at,
      'reason_codes',jsonb_build_array('WOD_ALREADY_REVEALED')
    );
  end if;

  return public.c4_recompile_session_format_core_pre_reveal_guard(
    p_user_id,p_session_id,p_new_mechanic,p_variant_key,coalesce(p_overlays,'[]'::jsonb)
  );
end;
$function$;;



-- SOURCE MIGRATION: 20260812082002_fc7_atomic_session_completion_rpc.sql
create or replace function public.complete_workout_session_v1(
  p_session_id uuid,
  p_global_rpe integer,
  p_post_workout_feeling integer,
  p_notes text default null,
  p_exercises jsonb default '[]'::jsonb,
  p_protocol_outcome jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user_id uuid:=auth.uid();
  v_session public.workout_sessions%rowtype;
  v_item jsonb;
  v_wse public.workout_session_exercises%rowtype;
  v_instance_id uuid;
  v_exec text;
  v_reason text;
  v_reps int;
  v_weight numeric;
  v_duration int;
  v_distance numeric;
  v_rpe int;
  v_item_notes text;
  v_status text;
  v_quality numeric;
  v_capability_eligible boolean;
  v_pain boolean;
  v_payload_ids uuid[]:='{}'::uuid[];
  v_total_instances int:=0;
  v_logs_count int:=0;
  v_pending_count int:=0;
  v_missing_logs int:=0;
  v_duplicate_payload_ids int:=0;
  v_adapted int:=0;
  v_not_completed int:=0;
  v_completed int:=0;
  v_completed_at timestamptz:=now();
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if jsonb_typeof(coalesce(p_exercises,'[]'::jsonb))<>'array' then raise exception 'exercises must be a JSON array'; end if;
  if p_global_rpe is not null and (p_global_rpe<1 or p_global_rpe>10) then raise exception 'global_rpe must be between 1 and 10'; end if;
  if p_post_workout_feeling is not null and (p_post_workout_feeling<1 or p_post_workout_feeling>10) then raise exception 'post_workout_feeling must be between 1 and 10'; end if;

  select * into v_session
  from public.workout_sessions
  where id=p_session_id and user_id=v_user_id
  for update;

  if not found then raise exception 'Session not found'; end if;

  select count(*) into v_total_instances
  from public.workout_session_exercises
  where session_id=p_session_id;

  if v_session.status='completed' then
    select count(*) into v_logs_count
    from public.exercise_logs
    where session_id=p_session_id and source_kind='internal';

    select count(*) into v_pending_count
    from public.workout_session_exercises
    where session_id=p_session_id
      and coalesce(user_execution_status,'pending')='pending';

    return jsonb_build_object(
      'status',case when v_logs_count=v_total_instances and v_pending_count=0 then 'ALREADY_COMPLETED' else 'ALREADY_COMPLETED_INCONSISTENT' end,
      'session_id',p_session_id,
      'session_status',v_session.status,
      'instances',v_total_instances,
      'logs',v_logs_count,
      'pending_instances',v_pending_count,
      'idempotent',true,
      'mutated',false
    );
  end if;

  if v_session.status not in ('generated','in_progress') then
    raise exception 'Session cannot be completed in status %',v_session.status;
  end if;

  if v_total_instances=0 then raise exception 'Session has no exercise instances'; end if;
  if jsonb_array_length(coalesce(p_exercises,'[]'::jsonb))<>v_total_instances then
    raise exception 'Completion payload must contain exactly one row for every session exercise instance: expected %, received %',
      v_total_instances,jsonb_array_length(coalesce(p_exercises,'[]'::jsonb));
  end if;

  -- Validate the complete payload before the first mutation.
  for v_item in select value from jsonb_array_elements(coalesce(p_exercises,'[]'::jsonb))
  loop
    begin
      v_instance_id:=(v_item->>'session_exercise_id')::uuid;
    exception when others then
      raise exception 'Invalid session_exercise_id in completion payload';
    end;

    if v_instance_id=any(v_payload_ids) then
      v_duplicate_payload_ids:=v_duplicate_payload_ids+1;
    end if;
    v_payload_ids:=array_append(v_payload_ids,v_instance_id);

    select * into v_wse
    from public.workout_session_exercises
    where id=v_instance_id and session_id=p_session_id;
    if not found then raise exception 'Exercise instance % does not belong to session %',v_instance_id,p_session_id; end if;

    v_exec:=lower(trim(coalesce(v_item->>'user_execution_status','')));
    v_reason:=upper(nullif(trim(coalesce(v_item->>'execution_reason_code','')),''));

    if v_exec not in ('completed','adapted','not_completed') then
      raise exception 'Invalid user_execution_status % for instance %',v_exec,v_instance_id;
    end if;

    if v_exec='adapted' and v_reason is not null and v_reason not in (
      'TECHNIQUE_DIFFICULTY','LOAD_TOO_HEAVY','FATIGUE','PAIN_DISCOMFORT','EQUIPMENT','TIME','OTHER'
    ) then
      raise exception 'Invalid adapted reason %',v_reason;
    end if;

    if v_exec='not_completed' and v_reason is not null and v_reason not in (
      'MOVEMENT_FAILURE','FATIGUE','PAIN_DISCOMFORT','TIME','MOTIVATION','EQUIPMENT','OTHER'
    ) then
      raise exception 'Invalid not_completed reason %',v_reason;
    end if;
  end loop;

  if v_duplicate_payload_ids>0 then raise exception 'Completion payload contains duplicate session exercise instances'; end if;

  -- All validation passed: mutations below are one PostgreSQL transaction.
  for v_item in select value from jsonb_array_elements(coalesce(p_exercises,'[]'::jsonb))
  loop
    v_instance_id:=(v_item->>'session_exercise_id')::uuid;
    select * into v_wse
    from public.workout_session_exercises
    where id=v_instance_id and session_id=p_session_id
    for update;

    v_exec:=lower(trim(v_item->>'user_execution_status'));
    v_reason:=upper(nullif(trim(coalesce(v_item->>'execution_reason_code','')),''));
    v_reps:=nullif(v_item->>'reps_completed','')::int;
    v_weight:=nullif(v_item->>'weight_kg','')::numeric;
    v_duration:=nullif(v_item->>'duration_seconds','')::int;
    v_distance:=nullif(v_item->>'distance_meters','')::numeric;
    v_rpe:=nullif(v_item->>'rpe','')::int;
    v_item_notes:=nullif(v_item->>'notes','');

    if v_rpe is not null and (v_rpe<1 or v_rpe>10) then raise exception 'Exercise RPE must be between 1 and 10'; end if;
    if coalesce(v_reps,0)<0 or coalesce(v_weight,0)<0 or coalesce(v_duration,0)<0 or coalesce(v_distance,0)<0 then
      raise exception 'Exercise metrics cannot be negative';
    end if;

    v_status:=case when v_exec='not_completed' then 'skipped' else 'completed' end;
    v_quality:=case v_exec when 'completed' then 1.0 when 'adapted' then 0.5 else 0.0 end;
    v_capability_eligible:=(v_exec='completed');
    v_pain:=(v_reason='PAIN_DISCOMFORT');

    update public.workout_session_exercises
    set status=v_status,
        user_execution_status=v_exec,
        execution_reason_code=case when v_exec='completed' then null else v_reason end,
        reps_completed=v_reps,
        weight_kg=v_weight,
        duration_seconds=v_duration,
        distance_meters=v_distance,
        rpe=v_rpe,
        notes=v_item_notes,
        updated_at=now()
    where id=v_instance_id and session_id=p_session_id;

    insert into public.exercise_logs(
      user_id,exercise_id,reps_completed,weight_kg,rpe,notes,created_at,session_id,duration_seconds,distance_meters,
      status,prescription_json,source_kind,observation_quality,capability_eligible,skip_reason,pain_affected,pain_zones,
      actual_json,observation_context_json,observation_quality_json,comparison_context_json,session_exercise_id,
      user_execution_status,execution_reason_code
    ) values (
      v_user_id,v_wse.exercise_id,v_reps,v_weight,v_rpe,v_item_notes,v_completed_at,p_session_id,v_duration,v_distance,
      v_status,coalesce(v_wse.prescription_json,'{}'::jsonb),'internal',v_quality,v_capability_eligible,
      case when v_exec='not_completed' then coalesce(v_reason,'USER_NOT_COMPLETED') else null end,
      v_pain,case when v_pain then coalesce(v_session.injured_zones,'{}'::text[]) else '{}'::text[] end,
      jsonb_strip_nulls(jsonb_build_object(
        'reps_completed',v_reps,'weight_kg',v_weight,'duration_seconds',v_duration,'distance_meters',v_distance,
        'rpe',v_rpe,'user_execution_status',v_exec,'execution_reason_code',v_reason
      )),
      jsonb_build_object(
        'session_id',p_session_id,'block_key',v_wse.block_key,'position',v_wse.position,
        'focus',v_session.focus,'readiness',v_session.readiness,'target_region',v_session.target_region,
        'mechanic',coalesce(v_session.mechanic_json->>'mechanic_key','')
      ),
      jsonb_build_object('score',v_quality,'capability_eligible',v_capability_eligible,'pain_affected',v_pain),
      jsonb_build_object('source','complete_workout_session_v1','session_exercise_id',v_instance_id),
      v_instance_id,v_exec,case when v_exec='completed' then null else v_reason end
    )
    on conflict (session_exercise_id) where source_kind='internal'
    do update set
      exercise_id=excluded.exercise_id,
      reps_completed=excluded.reps_completed,
      weight_kg=excluded.weight_kg,
      rpe=excluded.rpe,
      notes=excluded.notes,
      duration_seconds=excluded.duration_seconds,
      distance_meters=excluded.distance_meters,
      status=excluded.status,
      prescription_json=excluded.prescription_json,
      observation_quality=excluded.observation_quality,
      capability_eligible=excluded.capability_eligible,
      skip_reason=excluded.skip_reason,
      pain_affected=excluded.pain_affected,
      pain_zones=excluded.pain_zones,
      actual_json=excluded.actual_json,
      observation_context_json=excluded.observation_context_json,
      observation_quality_json=excluded.observation_quality_json,
      comparison_context_json=excluded.comparison_context_json,
      user_execution_status=excluded.user_execution_status,
      execution_reason_code=excluded.execution_reason_code;

    if v_exec='completed' then v_completed:=v_completed+1;
    elsif v_exec='adapted' then v_adapted:=v_adapted+1;
    else v_not_completed:=v_not_completed+1;
    end if;
  end loop;

  select count(*) into v_pending_count
  from public.workout_session_exercises
  where session_id=p_session_id and coalesce(user_execution_status,'pending')='pending';
  if v_pending_count<>0 then raise exception 'Session still contains % pending exercise instances',v_pending_count; end if;

  if p_protocol_outcome is not null and p_protocol_outcome<>'{}'::jsonb then
    perform public.record_session_protocol_outcome(p_session_id,p_protocol_outcome);
  end if;

  update public.workout_sessions
  set status='completed',
      completed_at=v_completed_at,
      global_rpe=p_global_rpe,
      post_workout_feeling=p_post_workout_feeling,
      notes=coalesce(p_notes,notes),
      updated_at=now()
  where id=p_session_id and user_id=v_user_id;

  select count(*) into v_logs_count
  from public.exercise_logs
  where session_id=p_session_id and source_kind='internal';

  select count(*) into v_missing_logs
  from public.workout_session_exercises wse
  where wse.session_id=p_session_id
    and not exists(
      select 1 from public.exercise_logs el
      where el.session_exercise_id=wse.id and el.source_kind='internal'
    );
  if v_missing_logs<>0 then raise exception 'Atomic completion invariant failed: % exercise instances have no log',v_missing_logs; end if;

  return jsonb_build_object(
    'status','COMPLETED',
    'version','fc7-atomic-completion-v1',
    'session_id',p_session_id,
    'completed_at',v_completed_at,
    'instances',v_total_instances,
    'logs',v_logs_count,
    'completed_exercises',v_completed,
    'adapted_exercises',v_adapted,
    'not_completed_exercises',v_not_completed,
    'pending_instances',0,
    'atomic',true,
    'idempotent_retry_supported',true,
    'analysis_after_commit',jsonb_build_array('run_capability_live_session','apply_session_protocol_observation','d_finalize_weekly_session','pi_refresh_coaching_directives')
  );
end;
$function$;

revoke execute on function public.complete_workout_session_v1(uuid,integer,integer,text,jsonb,jsonb) from public,anon;
grant execute on function public.complete_workout_session_v1(uuid,integer,integer,text,jsonb,jsonb) to authenticated;;



-- SOURCE MIGRATION: 20260812082202_b30_exclude_warmup_and_tabata_from_exercise_capability.sql
alter function public.build_capability_observation_inputs(bigint,text)
rename to build_capability_observation_inputs_pre_block_filter;

create or replace function public.build_capability_observation_inputs(
  p_exercise_log_id bigint,
  p_quality_policy_key text default 'b2.6-adapter-draft-1'::text
)
returns jsonb
language plpgsql
stable
set search_path to 'public'
as $function$
declare
  v_result jsonb;
  v_block text;
begin
  v_result:=public.build_capability_observation_inputs_pre_block_filter(p_exercise_log_id,p_quality_policy_key);

  select lower(coalesce(wse.block_key,'')) into v_block
  from public.exercise_logs el
  left join public.workout_session_exercises wse on wse.id=el.session_exercise_id
  where el.id=p_exercise_log_id;

  if v_block in ('warmup','warm_up','tabata') then
    v_result:=jsonb_set(v_result,'{excluded}','true'::jsonb,true);
    v_result:=jsonb_set(v_result,'{capability_eligible}','false'::jsonb,true);
    v_result:=jsonb_set(v_result,'{observation_role}',to_jsonb('CONTEXT_ONLY'::text),true);
    v_result:=jsonb_set(v_result,'{exclusion_reason}',to_jsonb('BLOCK_NOT_EXERCISE_CAPABILITY_ELIGIBLE'::text),true);
    v_result:=jsonb_set(v_result,'{updates}','[]'::jsonb,true);
    v_result:=jsonb_set(v_result,'{observation_context,capability_block_policy}',to_jsonb('warmup_tabata_history_only'::text),true);
  end if;

  return v_result;
end;
$function$;

alter function public.complete_workout_session_v1(uuid,integer,integer,text,jsonb,jsonb)
rename to complete_workout_session_v1_pre_block_filter;

create or replace function public.complete_workout_session_v1(
  p_session_id uuid,
  p_global_rpe integer,
  p_post_workout_feeling integer,
  p_notes text default null,
  p_exercises jsonb default '[]'::jsonb,
  p_protocol_outcome jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_result jsonb;
  v_excluded_count int:=0;
begin
  v_result:=public.complete_workout_session_v1_pre_block_filter(
    p_session_id,p_global_rpe,p_post_workout_feeling,p_notes,p_exercises,p_protocol_outcome
  );

  -- Keep preparation/core context in history but never let it mutate the
  -- general per-exercise capability model.
  update public.exercise_logs el
  set capability_eligible=false,
      observation_quality_json=coalesce(el.observation_quality_json,'{}'::jsonb)||jsonb_build_object(
        'capability_eligible',false,
        'block_policy','history_only'
      ),
      comparison_context_json=coalesce(el.comparison_context_json,'{}'::jsonb)||jsonb_build_object(
        'capability_exclusion_reason','BLOCK_NOT_EXERCISE_CAPABILITY_ELIGIBLE'
      )
  from public.workout_session_exercises wse
  where el.session_exercise_id=wse.id
    and el.session_id=p_session_id
    and lower(coalesce(wse.block_key,'')) in ('warmup','warm_up','tabata')
    and el.capability_eligible=true;
  get diagnostics v_excluded_count=row_count;

  return v_result||jsonb_build_object(
    'exercise_capability_block_policy','skill_and_wod_only',
    'history_only_logs',v_excluded_count
  );
end;
$function$;

revoke execute on function public.complete_workout_session_v1_pre_block_filter(uuid,integer,integer,text,jsonb,jsonb) from public,anon,authenticated;
revoke execute on function public.complete_workout_session_v1(uuid,integer,integer,text,jsonb,jsonb) from public,anon;
grant execute on function public.complete_workout_session_v1(uuid,integer,integer,text,jsonb,jsonb) to authenticated;;



-- SOURCE MIGRATION: 20260812082628_fc7_fix_internal_log_upsert_partial_index.sql
do $$
declare
  v_def text;
begin
  select pg_get_functiondef(p.oid)
  into v_def
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname='complete_workout_session_v1_pre_block_filter'
    and pg_get_function_identity_arguments(p.oid)='p_session_id uuid, p_global_rpe integer, p_post_workout_feeling integer, p_notes text, p_exercises jsonb, p_protocol_outcome jsonb';

  if v_def is null then
    raise exception 'completion base function not found';
  end if;

  v_def:=replace(
    v_def,
    'on conflict (session_exercise_id) where source_kind=''internal''',
    'on conflict (session_exercise_id) where source_kind=''internal'' and session_exercise_id is not null'
  );

  execute v_def;
end $$;;



-- SOURCE MIGRATION: 20260812082705_fc7_fix_null_pain_boolean.sql
do $$
declare
  v_def text;
begin
  select pg_get_functiondef(p.oid)
  into v_def
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname='complete_workout_session_v1_pre_block_filter'
    and pg_get_function_identity_arguments(p.oid)='p_session_id uuid, p_global_rpe integer, p_post_workout_feeling integer, p_notes text, p_exercises jsonb, p_protocol_outcome jsonb';

  if v_def is null then raise exception 'completion base function not found'; end if;

  v_def:=replace(
    v_def,
    'v_pain:=(v_reason=''PAIN_DISCOMFORT'');',
    'v_pain:=coalesce(v_reason=''PAIN_DISCOMFORT'',false);'
  );

  execute v_def;
end $$;;



-- SOURCE MIGRATION: 20260812082952_qa_security_force_workout_mutations_through_rpcs.sql
-- Workout state and performance logs are authoritative coach data.
-- The mobile client can read its own rows but mutations must go through
-- authenticated SECURITY DEFINER RPCs / trusted Edge Functions.

revoke insert, update, delete, truncate, references, trigger on table public.workout_sessions from authenticated;
grant select on table public.workout_sessions to authenticated;

revoke insert, update, delete, truncate, references, trigger on table public.workout_session_exercises from authenticated;
grant select on table public.workout_session_exercises to authenticated;

revoke insert, update, delete, truncate, references, trigger on table public.exercise_logs from authenticated;
grant select on table public.exercise_logs to authenticated;;

