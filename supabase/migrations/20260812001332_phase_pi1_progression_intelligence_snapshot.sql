create or replace function public.pi_progression_snapshot(
  p_user_id uuid,
  p_period_days integer default 90,
  p_anchor_date date default current_date
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_anchor date:=coalesce(p_anchor_date,current_date);
  v_days int:=least(1825,greatest(28,coalesce(p_period_days,90)));
  v_since date;
  v_total_sessions int:=0;
  v_period_sessions int:=0;
  v_period_minutes numeric:=0;
  v_avg_rpe numeric;
  v_avg_feeling numeric;
  v_cap_rows int:=0;
  v_confident_cap_rows int:=0;
  v_protocol_rows int:=0;
  v_cap_events int:=0;
  v_positive_events int:=0;
  v_recalibration_events int:=0;
  v_protocol_positive_events int:=0;
  v_protocol_recalibration_events int:=0;
  v_stage text;
  v_overall_state text;
  v_overall_text text;
  v_consistency jsonb;
  v_movements jsonb;
  v_protocols jsonb;
  v_legacy jsonb;
  v_signals jsonb:='[]'::jsonb;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;

  v_since:=v_anchor-(v_days-1);

  select count(*) into v_total_sessions
  from public.workout_sessions
  where user_id=p_user_id and status='completed';

  select count(*),coalesce(sum(duration_minutes),0),round(avg(global_rpe)::numeric,1),round(avg(post_workout_feeling)::numeric,1)
  into v_period_sessions,v_period_minutes,v_avg_rpe,v_avg_feeling
  from public.workout_sessions
  where user_id=p_user_id and status='completed'
    and coalesce(completed_at,created_at)::date between v_since and v_anchor;

  select count(*),count(*) filter(where confidence>=0.60)
  into v_cap_rows,v_confident_cap_rows
  from public.user_exercise_capabilities
  where user_id=p_user_id;

  select count(*) into v_protocol_rows
  from public.user_protocol_capabilities
  where user_id=p_user_id;

  select
    count(*),
    count(*) filter(where decision ilike 'EXPAND%' or decision ilike '%PROGRESS%'),
    count(*) filter(where decision ilike '%RECALIBRAT%')
  into v_cap_events,v_positive_events,v_recalibration_events
  from public.capability_update_events
  where user_id=p_user_id and applied
    and created_at::date between v_since and v_anchor;

  select
    count(*) filter(where decision ilike 'EXPAND%' or decision ilike '%PROGRESS%'),
    count(*) filter(where decision ilike '%RECALIBRAT%')
  into v_protocol_positive_events,v_protocol_recalibration_events
  from public.protocol_capability_events
  where user_id=p_user_id and applied
    and created_at::date between v_since and v_anchor;

  if v_total_sessions=0 then
    v_stage:='EMPTY';
  elsif v_total_sessions<4 or v_cap_rows<3 then
    v_stage:='LEARNING';
  elsif v_total_sessions<10 or v_confident_cap_rows<5 then
    v_stage:='CALIBRATING';
  else
    v_stage:='ESTABLISHED';
  end if;

  if v_stage in ('EMPTY','LEARNING') then
    v_overall_state:='LEARNING';
    v_overall_text:='UGEROD accumule encore des références avant de tirer des conclusions sur ta progression.';
  elsif (v_recalibration_events+v_protocol_recalibration_events)>=2
        and (v_recalibration_events+v_protocol_recalibration_events)>(v_positive_events+v_protocol_positive_events) then
    v_overall_state:='RECALIBRATING';
    v_overall_text='Certaines références récentes demandent à être recalibrées avant de pousser plus loin.';
  elsif (v_positive_events+v_protocol_positive_events)>=2 then
    v_overall_state:='PROGRESSING';
    v_overall_text:='Plusieurs signaux récents indiquent une progression suffisamment nette pour influencer les prochaines séances.';
  else
    v_overall_state:='STABLE';
    v_overall_text:='Les références récentes sont globalement stables. UGEROD continue de consolider et d’observer.';
  end if;

  v_consistency:=public.e_training_consistency_history(
    p_user_id,
    v_anchor,
    least(120,greatest(2,ceil(v_days/30.0)::int+1))
  );

  select coalesce(jsonb_agg(x.obj order by x.priority asc,x.confidence desc,x.last_observed_at desc),'[]'::jsonb)
  into v_movements
  from (
    select
      case signal
        when 'PROGRESSING' then 1
        when 'RECALIBRATING' then 2
        when 'STABLE' then 3
        else 4
      end as priority,
      c.confidence,
      c.last_observed_at,
      jsonb_build_object(
        'source','b2.7-live-capability',
        'exercise_id',c.exercise_id,
        'name',e.name,
        'movement_pattern',e.movement_pattern,
        'exercise_family',e.exercise_family,
        'body_region',e.body_region,
        'training_focus',e.training_focus,
        'tracking_modes',e.tracking_modes,
        'signal',signal,
        'latest_decision',latest_decision,
        'positive_events_period',positive_events,
        'recalibration_events_period',recalibration_events,
        'hold_events_period',hold_events,
        'confidence',round(coalesce(c.confidence,0),3),
        'freshness',round(coalesce(f.dynamic_freshness,c.freshness,0),3),
        'evidence_count',c.evidence_count,
        'valid_evidence_count',c.valid_evidence_count,
        'last_observed_at',c.last_observed_at,
        'last_valid_observed_at',c.last_valid_observed_at,
        'reps_envelope',c.reps_envelope,
        'load_envelope',c.load_envelope,
        'time_envelope',c.time_envelope,
        'distance_envelope',c.distance_envelope,
        'pace_envelope',c.pace_envelope,
        'confidence_json',c.confidence_json,
        'evidence_json',c.evidence_json
      ) as obj
    from public.user_exercise_capabilities c
    join public.exercises e on e.id=c.exercise_id
    left join lateral (
      select round(avg(public.capability_freshness_from_age(
        extract(epoch from (v_anchor::timestamptz-(j.value->>'last_valid_observed_at')::timestamptz))/86400.0,
        coalesce(public.jsonb_num(j.value,'half_life_days'),45)
      ))::numeric,3) as dynamic_freshness
      from jsonb_each(coalesce(c.freshness_json,'{}'::jsonb)) j
      where j.value ? 'last_valid_observed_at'
    ) f on true
    left join lateral (
      select cue.decision as latest_decision
      from public.capability_update_events cue
      where cue.user_id=c.user_id and cue.exercise_id=c.exercise_id and cue.applied
        and cue.created_at::date between v_since and v_anchor
      order by cue.created_at desc,cue.id desc
      limit 1
    ) ld on true
    left join lateral (
      select
        count(*) filter(where cue.decision ilike 'EXPAND%' or cue.decision ilike '%PROGRESS%')::int as positive_events,
        count(*) filter(where cue.decision ilike '%RECALIBRAT%')::int as recalibration_events,
        count(*) filter(where cue.decision='HOLD')::int as hold_events
      from public.capability_update_events cue
      where cue.user_id=c.user_id and cue.exercise_id=c.exercise_id and cue.applied
        and cue.created_at::date between v_since and v_anchor
    ) ev on true
    cross join lateral (
      select case
        when coalesce(c.confidence,0)<0.45 or coalesce(c.valid_evidence_count,0)<2 then 'LEARNING'
        when coalesce(ld.latest_decision,'') ilike '%RECALIBRAT%' or coalesce(ev.recalibration_events,0)>coalesce(ev.positive_events,0) then 'RECALIBRATING'
        when coalesce(ld.latest_decision,'') ilike 'EXPAND%' or coalesce(ld.latest_decision,'') ilike '%PROGRESS%' or coalesce(ev.positive_events,0)>0 then 'PROGRESSING'
        else 'STABLE'
      end as signal
    ) s
    order by priority,c.confidence desc,c.last_observed_at desc
    limit 12
  ) x;

  select coalesce(jsonb_agg(x.obj order by x.priority,x.confidence desc,x.last_observed_at desc),'[]'::jsonb)
  into v_protocols
  from (
    select
      case signal when 'PROGRESSING' then 1 when 'RECALIBRATING' then 2 when 'STABLE' then 3 else 4 end as priority,
      p.confidence,p.last_observed_at,
      jsonb_build_object(
        'source','b2.7-protocol-capability',
        'protocol_signature',p.protocol_signature,
        'mechanic_key',p.mechanic_key,
        'variant_key',p.variant_key,
        'signal',signal,
        'latest_decision',latest_decision,
        'boundary_type',boundary_type,
        'positive_events_period',positive_events,
        'recalibration_events_period',recalibration_events,
        'confidence',round(coalesce(p.confidence,0),3),
        'freshness',round(coalesce(p.freshness,0),3),
        'evidence_count',p.evidence_count,
        'valid_evidence_count',p.valid_evidence_count,
        'best_outcome',p.best_outcome_json,
        'latest_outcome',p.latest_outcome_json,
        'last_observed_at',p.last_observed_at
      ) as obj
    from public.user_protocol_capabilities p
    left join lateral (
      select pe.decision as latest_decision,pe.boundary_type
      from public.protocol_capability_events pe
      where pe.user_id=p.user_id and pe.protocol_signature=p.protocol_signature and pe.applied
        and pe.created_at::date between v_since and v_anchor
      order by pe.created_at desc,pe.id desc
      limit 1
    ) ld on true
    left join lateral (
      select
        count(*) filter(where pe.decision ilike 'EXPAND%' or pe.decision ilike '%PROGRESS%')::int as positive_events,
        count(*) filter(where pe.decision ilike '%RECALIBRAT%')::int as recalibration_events
      from public.protocol_capability_events pe
      where pe.user_id=p.user_id and pe.protocol_signature=p.protocol_signature and pe.applied
        and pe.created_at::date between v_since and v_anchor
    ) ev on true
    cross join lateral (
      select case
        when coalesce(p.confidence,0)<0.45 or coalesce(p.valid_evidence_count,0)<2 then 'LEARNING'
        when coalesce(ld.latest_decision,'') ilike '%RECALIBRAT%' or coalesce(ev.recalibration_events,0)>coalesce(ev.positive_events,0) then 'RECALIBRATING'
        when coalesce(ld.latest_decision,'') ilike 'EXPAND%' or coalesce(ld.latest_decision,'') ilike '%PROGRESS%' or coalesce(ev.positive_events,0)>0 then 'PROGRESSING'
        else 'STABLE'
      end as signal
    ) s
    where p.user_id=p_user_id
    order by priority,p.confidence desc,p.last_observed_at desc
    limit 8
  ) x;

  select coalesce(jsonb_agg(jsonb_build_object(
    'source','legacy-progress-fallback',
    'exercise_id',up.exercise_id,
    'name',e.name,
    'movement_pattern',e.movement_pattern,
    'training_focus',e.training_focus,
    'state',up.state,
    'recommendation',up.recommendation,
    'performance_delta',up.performance_delta,
    'overall_confidence',up.overall_confidence,
    'exposure_count',up.exposure_count,
    'current_performance',up.current_performance_json,
    'best_performance',up.best_performance_json,
    'last_observed_at',up.last_observed_at
  ) order by up.overall_confidence desc nulls last),'[]'::jsonb)
  into v_legacy
  from (
    select * from public.user_exercise_progress
    where user_id=p_user_id
    order by overall_confidence desc nulls last,last_observed_at desc nulls last
    limit 12
  ) up
  join public.exercises e on e.id=up.exercise_id;

  if v_stage='EMPTY' then
    v_signals:=jsonb_build_array(jsonb_build_object(
      'type','LEARNING','priority',1,
      'title','TON ÉVOLUTION COMMENCE ICI',
      'text','Termine tes premières séances pour donner à UGEROD des références fiables.'
    ));
  elsif v_stage in ('LEARNING','CALIBRATING') then
    v_signals:=v_signals||jsonb_build_array(jsonb_build_object(
      'type','LEARNING','priority',1,
      'title','UGEROD AFFINE TON PROFIL',
      'text','Les données s’accumulent. Les tendances deviendront plus affirmées à mesure que les références se confirment.'
    ));
  end if;

  if (v_positive_events+v_protocol_positive_events)>0 then
    v_signals:=v_signals||jsonb_build_array(jsonb_build_object(
      'type','PROGRESSION_SIGNAL','priority',2,
      'title','DES SIGNAUX DE PROGRESSION APPARAISSENT',
      'text','UGEROD a détecté des références récentes en hausse. Elles pourront influencer les prochaines séances si elles se confirment.'
    ));
  end if;

  if (v_recalibration_events+v_protocol_recalibration_events)>0 then
    v_signals:=v_signals||jsonb_build_array(jsonb_build_object(
      'type','RECALIBRATION_SIGNAL','priority',3,
      'title','CERTAINES RÉFÉRENCES SONT À RECALIBRER',
      'text','Une performance plus basse ne supprime pas ton niveau acquis : UGEROD cherche d’abord à confirmer la nouvelle référence.'
    ));
  end if;

  return jsonb_build_object(
    'version','pi1-progression-intelligence-v1',
    'anchor_date',v_anchor,
    'period_days',v_days,
    'period_start',v_since,
    'data_maturity',jsonb_build_object(
      'stage',v_stage,
      'total_completed_sessions',v_total_sessions,
      'period_completed_sessions',v_period_sessions,
      'live_capability_exercises',v_cap_rows,
      'confident_capability_exercises',v_confident_cap_rows,
      'protocol_capabilities',v_protocol_rows,
      'capability_events_period',v_cap_events
    ),
    'overall',jsonb_build_object(
      'state',v_overall_state,
      'text',v_overall_text,
      'positive_events',v_positive_events+v_protocol_positive_events,
      'recalibration_events',v_recalibration_events+v_protocol_recalibration_events
    ),
    'training_summary',jsonb_build_object(
      'completed_sessions',v_period_sessions,
      'total_minutes',v_period_minutes,
      'avg_rpe',v_avg_rpe,
      'avg_post_workout_feeling',v_avg_feeling
    ),
    'consistency',v_consistency,
    'movement_capabilities',v_movements,
    'protocol_capabilities',v_protocols,
    'legacy_progress_fallback',case when v_cap_rows=0 then v_legacy else '[]'::jsonb end,
    'coach_signals',v_signals,
    'decision_feed',jsonb_build_object(
      'progression_candidate_exercise_ids',coalesce((
        select jsonb_agg((m->>'exercise_id')) from jsonb_array_elements(v_movements) m where m->>'signal'='PROGRESSING'
      ),'[]'::jsonb),
      'recalibration_candidate_exercise_ids',coalesce((
        select jsonb_agg((m->>'exercise_id')) from jsonb_array_elements(v_movements) m where m->>'signal'='RECALIBRATING'
      ),'[]'::jsonb),
      'progression_candidate_protocols',coalesce((
        select jsonb_agg((p->>'protocol_signature')) from jsonb_array_elements(v_protocols) p where p->>'signal'='PROGRESSING'
      ),'[]'::jsonb),
      'recalibration_candidate_protocols',coalesce((
        select jsonb_agg((p->>'protocol_signature')) from jsonb_array_elements(v_protocols) p where p->>'signal'='RECALIBRATING'
      ),'[]'::jsonb),
      'integration_status','READY_FOR_WEEKLY_AND_SESSION_ENGINE_CONSUMPTION'
    )
  );
end;
$function$;

revoke all on function public.pi_progression_snapshot(uuid,integer,date) from public, anon;
grant execute on function public.pi_progression_snapshot(uuid,integer,date) to authenticated;
;
