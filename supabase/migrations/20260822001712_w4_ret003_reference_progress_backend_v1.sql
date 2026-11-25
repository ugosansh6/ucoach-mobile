create or replace function public.w4_reference_metric_interpretation_v1(
  p_metric_key text,
  p_current_value numeric,
  p_reference_value numeric,
  p_higher_is_better boolean,
  p_current_rpe numeric default null,
  p_reference_rpe numeric default null
)
returns jsonb
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_status text;
  v_rpe_context text:='UNKNOWN';
  v_delta numeric;
  v_label text;
begin
  if p_metric_key is null or p_current_value is null or p_reference_value is null or p_higher_is_better is null then
    return jsonb_build_object(
      'version','w4-reference-metric-interpretation-v1',
      'status','INSUFFICIENT_METRIC_DATA',
      'semantics',jsonb_build_object('missing_metric_is_not_regression',true,'no_tolerance_threshold',true)
    );
  end if;

  v_delta:=p_current_value-p_reference_value;
  if p_current_rpe is not null and p_reference_rpe is not null then
    v_rpe_context:=case when p_current_rpe<p_reference_rpe then 'LOWER_RPE' when p_current_rpe>p_reference_rpe then 'HIGHER_RPE' else 'SAME_RPE' end;
  end if;

  if p_current_value=p_reference_value then
    v_status:=case when v_rpe_context='LOWER_RPE' then 'EQUIVALENT_RESULT_LOWER_RPE' when v_rpe_context='HIGHER_RPE' then 'EQUIVALENT_RESULT_HIGHER_RPE' else 'STABLE_RESULT' end;
  elsif (p_higher_is_better and p_current_value>p_reference_value)
     or (not p_higher_is_better and p_current_value<p_reference_value) then
    v_status:='IMPROVED_RESULT';
  else
    v_status:='LOWER_RESULT_ON_REFERENCE';
  end if;

  v_label:=case p_metric_key
    when 'elapsed_seconds' then 'Temps'
    when 'rounds_per_minute' then 'Rythme'
    when 'completion_ratio' then 'Avancement'
    when 'time_completion_ratio' then 'Avancement'
    when 'interval_completion_ratio' then 'Intervalles complétés'
    when 'stage_equivalent' then 'Niveau atteint'
    else p_metric_key
  end;

  return jsonb_build_object(
    'version','w4-reference-metric-interpretation-v1',
    'status',v_status,
    'metric_key',p_metric_key,
    'metric_label',v_label,
    'current_value',p_current_value,
    'reference_value',p_reference_value,
    'absolute_delta',v_delta,
    'higher_is_better',p_higher_is_better,
    'rpe_context',v_rpe_context,
    'current_rpe',p_current_rpe,
    'reference_rpe',p_reference_rpe,
    'semantics',jsonb_build_object(
      'classification_uses_only_strict_reference_metric_direction',true,
      'no_percent_improvement_claim',true,
      'no_tolerance_threshold',true,
      'lower_result_on_one_reference_is_not_a_capability_weakness',true,
      'rpe_is_supporting_context_not_metric_rewrite',true
    )
  );
end;
$$;

create or replace function public.w4_reference_progress_v1(
  p_user_id uuid,
  p_current_session_id uuid,
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_pair jsonb;
  v_current_metric jsonb;
  v_reference_metric jsonb;
  v_interpretation jsonb;
  v_reference_session_id uuid;
  v_current_rpe numeric;
  v_reference_rpe numeric;
  v_current_value numeric;
  v_reference_value numeric;
  v_higher boolean;
  v_metric_key text;
  v_current_display text;
  v_reference_display text;
  v_summary text;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;

  v_pair:=public.w4_personal_reference_pair_v1(p_user_id,p_current_session_id,p_limit);
  if v_pair->>'status'<>'BEFORE_AFTER_REFERENCE_READY' then
    return jsonb_build_object(
      'version','w4-reference-progress-v1',
      'status','NO_STRICT_REFERENCE_COMPARISON',
      'session_id',p_current_session_id,
      'reference_pair',v_pair,
      'semantics',jsonb_build_object(
        'no_progress_claim_without_strict_reference',true,
        'related_context_is_not_used_for_progress_claim',true,
        'missing_reference_is_not_weakness',true
      )
    );
  end if;

  v_current_metric:=v_pair#>'{current,outcome_metric}';
  v_reference_metric:=v_pair#>'{reference,outcome_metric}';
  v_reference_session_id:=nullif(v_pair#>>'{reference,session_id}','')::uuid;
  v_metric_key:=v_current_metric->>'metric_key';

  if v_metric_key is distinct from v_reference_metric->>'metric_key' then
    return jsonb_build_object('version','w4-reference-progress-v1','status','METRIC_MISMATCH','session_id',p_current_session_id,'reference_pair',v_pair);
  end if;

  v_current_value:=nullif(v_current_metric->>'metric_value','')::numeric;
  v_reference_value:=nullif(v_reference_metric->>'metric_value','')::numeric;
  v_higher:=nullif(v_current_metric->>'higher_is_better','')::boolean;

  select global_rpe into v_current_rpe from public.workout_sessions where id=p_current_session_id and user_id=p_user_id;
  select global_rpe into v_reference_rpe from public.workout_sessions where id=v_reference_session_id and user_id=p_user_id;

  v_interpretation:=public.w4_reference_metric_interpretation_v1(v_metric_key,v_current_value,v_reference_value,v_higher,v_current_rpe,v_reference_rpe);

  if v_metric_key='elapsed_seconds' then
    v_current_display:=floor(v_current_value/60)::int||':'||lpad(mod(v_current_value::int,60)::text,2,'0');
    v_reference_display:=floor(v_reference_value/60)::int||':'||lpad(mod(v_reference_value::int,60)::text,2,'0');
  elsif v_metric_key in ('completion_ratio','time_completion_ratio','interval_completion_ratio') then
    v_current_display:=round(v_current_value*100,1)::text||' %';
    v_reference_display:=round(v_reference_value*100,1)::text||' %';
  else
    v_current_display:=round(v_current_value,3)::text;
    v_reference_display:=round(v_reference_value,3)::text;
  end if;

  v_summary:=case v_interpretation->>'status'
    when 'IMPROVED_RESULT' then 'Tu fais mieux sur cette même séance repère.'
    when 'EQUIVALENT_RESULT_LOWER_RPE' then 'Même résultat, avec un effort perçu plus bas.'
    when 'EQUIVALENT_RESULT_HIGHER_RPE' then 'Même résultat, avec un effort perçu plus élevé cette fois.'
    when 'STABLE_RESULT' then 'Résultat stable sur cette séance repère.'
    when 'LOWER_RESULT_ON_REFERENCE' then 'Résultat inférieur à ta référence sur cette tentative.'
    else 'Comparaison disponible sur cette séance repère.'
  end;

  return jsonb_build_object(
    'version','w4-reference-progress-v1',
    'status','REFERENCE_PROGRESS_AVAILABLE',
    'session_id',p_current_session_id,
    'reference_session_id',v_reference_session_id,
    'interpretation',v_interpretation,
    'presentation',jsonb_build_object(
      'headline',v_summary,
      'metric_label',v_interpretation->>'metric_label',
      'current_display',v_current_display,
      'reference_display',v_reference_display,
      'current_rpe',v_current_rpe,
      'reference_rpe',v_reference_rpe,
      'context_note','Comparaison avec une séance strictement comparable selon Performance Context.'
    ),
    'evidence',jsonb_build_object(
      'reference_pair',v_pair,
      'comparison_contract','w4_protocol_session_comparability_v1'
    ),
    'semantics',jsonb_build_object(
      'user_message_is_deterministic_from_reference_evidence',true,
      'no_population_norm_used',true,
      'no_percent_improvement_claim',true,
      'single_lower_result_is_not_called_regression',true,
      'rpe_supports_but_does_not_rewrite_the_result',true
    )
  );
end;
$$;

revoke all on function public.w4_reference_metric_interpretation_v1(text,numeric,numeric,boolean,numeric,numeric) from public,anon;
revoke all on function public.w4_reference_progress_v1(uuid,uuid,integer) from public,anon;
grant execute on function public.w4_reference_metric_interpretation_v1(text,numeric,numeric,boolean,numeric,numeric) to authenticated,service_role,postgres;
grant execute on function public.w4_reference_progress_v1(uuid,uuid,integer) to authenticated,service_role,postgres;

comment on function public.w4_reference_metric_interpretation_v1(text,numeric,numeric,boolean,numeric,numeric) is 'W4 RET-003 deterministic interpretation of a strictly comparable reference metric. Uses metric direction and optional RPE context only; no percentage claim, tolerance threshold, or capability inference.';
comment on function public.w4_reference_progress_v1(uuid,uuid,integer) is 'W4 RET-003 backend progression card contract. Produces a user-facing before/now message only from a strictly comparable personal reference pair; lower one-off result is not called regression.';
