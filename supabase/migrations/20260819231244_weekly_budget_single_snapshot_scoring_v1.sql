create or replace function public.program_coach_weekly_scoring_snapshot_v1(
  p_user_id uuid,
  p_anchor_date date default current_date
) returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_anchor date:=coalesce(p_anchor_date,current_date);
  v_week date:=public.d_week_start(coalesce(p_anchor_date,current_date));
  v_budget jsonb;
  v_qualities jsonb:='[]'::jsonb;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then
    raise exception 'Forbidden user';
  end if;

  -- Expensive program calculation: exactly once for the whole candidate-pool evaluation.
  v_budget:=public.program_coach_weekly_budget_v1(p_user_id,v_week);

  with keys as (
    select unnest(array['strength','conditioning','muscular_endurance','power','stability','mobility']) as key
  ), budget_targets as (
    select x->>'stimulus_key' as key,
           nullif(x->>'normalized_target','')::numeric as normalized_target
    from jsonb_array_elements(coalesce(v_budget->'quality_budget','[]'::jsonb)) x
  ), base_targets as (
    select t.stimulus_key as key,t.target_value::numeric
    from public.weekly_stimulus_targets t
    where t.user_id=p_user_id
      and t.week_start=v_week
      and t.stimulus_type='focus'
  ), realized as (
    select l.stimulus_key as key,
           coalesce(sum(l.realized_value) filter(where l.occurred_at::date between v_week and v_week+6),0)::numeric as realized_week,
           coalesce(sum(l.realized_value) filter(where l.occurred_at::date between v_anchor-9 and v_anchor),0)::numeric as realized_10d
    from public.session_stimulus_ledger l
    where l.user_id=p_user_id
      and l.stimulus_type='focus'
      and l.realized_value is not null
      and l.metadata_json->>'ledger_role'='realized'
      and l.occurred_at::date between least(v_week,v_anchor-9) and greatest(v_week+6,v_anchor)
    group by l.stimulus_key
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'stimulus_key',k.key,
    'target_value',round(coalesce(bt.normalized_target,base.target_value,0),2),
    'realized_week',round(coalesce(r.realized_week,0),2),
    'realized_10d',round(coalesce(r.realized_10d,0),2)
  ) order by k.key),'[]'::jsonb)
  into v_qualities
  from keys k
  left join budget_targets bt on bt.key=k.key
  left join base_targets base on base.key=k.key
  left join realized r on r.key=k.key;

  return jsonb_build_object(
    'version','program-coach-weekly-scoring-snapshot-v1',
    'anchor_date',v_anchor,
    'week_start',v_week,
    'program_budget',v_budget,
    'qualities',v_qualities,
    'calculation_contract',jsonb_build_object(
      'program_budget_calculated_once',true,
      'realized_ledger_aggregated_once',true,
      'same_scoring_math_as_program_budget_v1',true
    )
  );
end;
$function$;

create or replace function public.c2_weekly_coherence_from_snapshot_v1(
  p_stimulus_proxy jsonb,
  p_snapshot jsonb
) returns jsonb
language sql
immutable
set search_path to 'public'
as $function$
with keys as (
  select unnest(array['strength','conditioning','muscular_endurance','power','stability','mobility']) key
), target as (
  select k.key,
         coalesce((select nullif(x->>'target_value','')::numeric
                   from jsonb_array_elements(coalesce(p_snapshot->'qualities','[]'::jsonb)) x
                   where x->>'stimulus_key'=k.key limit 1),0)::numeric target_value,
         coalesce((select nullif(x->>'realized_week','')::numeric
                   from jsonb_array_elements(coalesce(p_snapshot->'qualities','[]'::jsonb)) x
                   where x->>'stimulus_key'=k.key limit 1),0)::numeric realized_week,
         coalesce((select nullif(x->>'realized_10d','')::numeric
                   from jsonb_array_elements(coalesce(p_snapshot->'qualities','[]'::jsonb)) x
                   where x->>'stimulus_key'=k.key limit 1),0)::numeric realized_10d,
         coalesce(nullif(coalesce(p_stimulus_proxy,'{}'::jsonb)#>>array['qualities',k.key],'')::numeric,0)::numeric proxy_score
  from keys k
), enriched as (
  select *,
    case when target_value>0 then greatest(0,least(1,1-realized_week/target_value)) else 0 end week_need,
    case when target_value>0 then greatest(0,least(1,1-realized_10d/(target_value*10.0/7.0))) else 0 end rolling_need,
    case when target_value>0 then greatest(0,least(1,realized_week/target_value-1.10)) else 0 end week_over,
    case when target_value>0 then greatest(0,least(1,realized_10d/(target_value*10.0/7.0)-1.10)) else 0 end rolling_over
  from target
), weighted as (
  select *,
    (week_need*0.75+rolling_need*0.25) need_score,
    (week_over*0.75+rolling_over*0.25) over_score,
    case when sum(target_value) over()>0 then target_value/sum(target_value) over() else 0 end target_weight
  from enriched
), agg as (
  select
    sum(target_value) total_target,
    case when sum(target_weight*need_score)>0 then sum(target_weight*need_score*(proxy_score/100.0))/sum(target_weight*need_score) else 0.50 end reward,
    case when sum(target_weight*over_score)>0 then sum(target_weight*over_score*(proxy_score/100.0))/sum(target_weight*over_score) else 0 end penalty,
    jsonb_agg(jsonb_build_object(
      'stimulus_key',key,'target_value',round(target_value,2),'realized_week',round(realized_week,2),'realized_10d',round(realized_10d,2),
      'week_need',round(week_need,3),'rolling_need',round(rolling_need,3),'need_score',round(need_score,3),
      'week_over',round(week_over,3),'rolling_over',round(rolling_over,3),'proxy_score',proxy_score
    ) order by need_score desc,key) details
  from weighted
)
select jsonb_build_object(
  'version','p1b-weekly-coherence-program-budget-snapshot-v1',
  'score',case when total_target<=0 then 50 else round(greatest(0,least(100,50+(reward-0.50)*80-penalty*25)),2) end,
  'neutral',total_target<=0,
  'policy','soft_bias_realized_only_program_budget_no_debt',
  'current_week_weight',0.75,
  'rolling_10d_weight',0.25,
  'planned_sessions_used',false,
  'missed_session_debt_used',false,
  'program_budget_active',true,
  'snapshot_reused',true,
  'details',details
) from agg;
$function$;

revoke all on function public.program_coach_weekly_scoring_snapshot_v1(uuid,date) from public,anon;
grant execute on function public.program_coach_weekly_scoring_snapshot_v1(uuid,date) to authenticated,service_role;
