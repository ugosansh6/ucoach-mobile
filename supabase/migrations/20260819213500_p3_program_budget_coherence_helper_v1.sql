create or replace function public.c2_weekly_coherence_fit_program_budget_v1(
  p_user_id uuid,
  p_exercise_id text,
  p_anchor_date date default current_date
) returns jsonb
language sql
stable
set search_path to 'public'
as $function$
with params as (
  select public.d_week_start(coalesce(p_anchor_date,current_date)) week_start,
         coalesce(p_anchor_date,current_date) anchor_date,
         public.c2_exercise_stimulus_proxy(p_exercise_id) proxy,
         public.program_coach_weekly_budget_v1(p_user_id,public.d_week_start(coalesce(p_anchor_date,current_date))) budget
), keys as (
  select unnest(array['strength','conditioning','muscular_endurance','power','stability','mobility']) key
), target as (
  select k.key,
         coalesce((select nullif(x->>'normalized_target','')::numeric
                   from params p cross join lateral jsonb_array_elements(coalesce(p.budget->'quality_budget','[]'::jsonb)) x
                   where x->>'stimulus_key'=k.key limit 1),
                  (select t.target_value from public.weekly_stimulus_targets t,params p
                   where t.user_id=p_user_id and t.week_start=p.week_start and t.stimulus_type='focus' and t.stimulus_key=k.key limit 1),0)::numeric target_value,
         coalesce((select sum(l.realized_value) from public.session_stimulus_ledger l,params p
                   where l.user_id=p_user_id and l.stimulus_type='focus' and l.stimulus_key=k.key
                     and l.realized_value is not null
                     and l.metadata_json->>'ledger_role'='realized'
                     and l.occurred_at::date between p.week_start and p.week_start+6),0)::numeric realized_week,
         coalesce((select sum(l.realized_value) from public.session_stimulus_ledger l,params p
                   where l.user_id=p_user_id and l.stimulus_type='focus' and l.stimulus_key=k.key
                     and l.realized_value is not null
                     and l.metadata_json->>'ledger_role'='realized'
                     and l.occurred_at::date between p.anchor_date-9 and p.anchor_date),0)::numeric realized_10d,
         coalesce((select nullif((p.proxy#>>array['qualities',k.key])::numeric,0) from params p),0)::numeric proxy_score
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
    sum(target_weight*need_score) need_den,
    sum(target_weight*over_score) over_den,
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
  'version','p1b-weekly-coherence-program-budget-v1',
  'score',case when total_target<=0 then 50 else round(greatest(0,least(100,50+(reward-0.50)*80-penalty*25)),2) end,
  'neutral',total_target<=0,
  'policy','soft_bias_realized_only_program_budget_no_debt',
  'current_week_weight',0.75,
  'rolling_10d_weight',0.25,
  'planned_sessions_used',false,
  'missed_session_debt_used',false,
  'program_budget_active',true,
  'details',details
) from agg;
$function$;
