create or replace function public.c4_apply_local_fatigue_complement_v1(
  p_user_id uuid,
  p_plan jsonb,
  p_focus text default 'General Fitness',
  p_duration_minutes integer default 45,
  p_readiness text default 'normal',
  p_target_region text default null,
  p_progression_intent text default null,
  p_zone_terms text[] default '{}'::text[],
  p_inventory jsonb default '[]'::jsonb,
  p_max_complexity integer default 3,
  p_max_difficulty text default 'Intermédiaire',
  p_candidate_count integer default 12,
  p_policy_key text default 'c4-final-default'
) returns jsonb
language plpgsql stable security definer
set search_path='public'
as $function$
declare
  r jsonb:=coalesce(p_plan,'{}'::jsonb);
  v_wod jsonb;
  v_diag jsonb:='{}'::jsonb;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;
  if coalesce(r->>'status','')<>'READY' then return r; end if;

  select b into v_wod
  from jsonb_array_elements(coalesce(r->'blocks','[]'::jsonb)) b
  where b->>'block_key'='wod'
  limit 1;

  if v_wod is not null then
    v_diag:=public.c4_wod_primary_muscle_concentration_v1(coalesce(v_wod->'exercises','[]'::jsonb));
  end if;

  r:=jsonb_set(r,'{architecture,local_muscle_fatigue}',
    jsonb_build_object(
      'version','local-muscle-fatigue-v2-diagnostic-only',
      'mode','DIAGNOSTIC_ONLY',
      'decision_authority',false,
      'generation_mutation',false,
      'swap_gate',false,
      'performance_context_candidate',true,
      'diagnostic',coalesce(v_diag,'{}'::jsonb)
    ),true);
  return r;
end;
$function$;

create or replace function public.c4_session_wod_local_fatigue_swap_allowed_v1(
  p_session_id uuid,
  p_position integer,
  p_candidate_exercise_id text
) returns boolean
language sql stable security definer
set search_path='public'
as $function$
  select true;
$function$;
