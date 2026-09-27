-- PERF-006: reuse the weekly scoring snapshot's program budget.
create or replace function public.program_coach_adaptive_block_budget_v1(
  p_user_id uuid,
  p_anchor_date date default current_date
) returns jsonb
language plpgsql
stable
set search_path to 'public'
as $function$
declare
  v_anchor date := coalesce(p_anchor_date,current_date);
  v_week date := public.d_week_start(coalesce(p_anchor_date,current_date));
  v_budget jsonb;
  v_scoring jsonb;
  v_rolling jsonb;
  v_fatigue jsonb;
  v_protocol jsonb;
  v_result jsonb;
begin
  if p_user_id is null then raise exception 'User required'; end if;
  if auth.uid() is not null and auth.uid() <> p_user_id then raise exception 'Forbidden user'; end if;

  v_scoring := public.program_coach_weekly_scoring_snapshot_v1(p_user_id,v_anchor);
  v_budget := coalesce(
    v_scoring->'program_budget',
    public.program_coach_weekly_budget_v1(p_user_id,v_week)
  );
  v_rolling := public.program_coach_rolling_stimulus_state_v1(p_user_id,v_anchor,'{}'::jsonb);
  v_fatigue := public.program_coach_cumulative_fatigue_state_v1(p_user_id,v_anchor,null,null,'{}'::jsonb);
  v_protocol := public.program_coach_protocol_progress_state_v1(p_user_id,v_anchor,56);

  v_result := public.program_coach_adaptive_block_budget_from_inputs_v1(
    v_budget,v_scoring,v_rolling,v_fatigue,v_protocol
  );

  return v_result || jsonb_build_object(
    'anchor_date',v_anchor,
    'week_start',v_week,
    'source_versions',jsonb_build_object(
      'weekly_budget',v_budget->>'version',
      'weekly_scoring',v_scoring->>'version',
      'rolling_stimulus',v_rolling->>'version',
      'cumulative_fatigue',v_fatigue->>'version',
      'protocol_progress',v_protocol->>'version'
    )
  );
end;
$function$;
