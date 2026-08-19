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
    'target_value',coalesce(bt.normalized_target,base.target_value,0),
    'realized_week',coalesce(r.realized_week,0),
    'realized_10d',coalesce(r.realized_10d,0)
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
      'full_numeric_precision_preserved',true,
      'same_scoring_math_as_program_budget_v1',true
    )
  );
end;
$function$;
