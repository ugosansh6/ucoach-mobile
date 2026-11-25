create or replace function public.program_coach_pattern_complement_policy_shadow_v1(p_user_id uuid,p_anchor_date date default current_date,p_session_context jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path to 'public'
as $$
declare v_anchor date:=coalesce(p_anchor_date,current_date); v_exposure jsonb; v_protected text[]:='{}'::text[]; v_high text[]:='{}'::text[]; v_medium text[]:='{}'::text[]; v_soft_avoid text[]:='{}'::text[]; v_soft_reduce text[]:='{}'::text[]; v_status text:='INSUFFICIENT_HISTORY';
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;
  v_exposure:=public.program_coach_pattern_exposure_shadow_v1(p_user_id,v_anchor);
  select coalesce(array_agg(distinct p) filter(where p is not null),'{}'::text[]) into v_protected from (
    select nullif(p_session_context#>>'{skill_target_shadow,target_movement_pattern}','') p
    union all
    select nullif(x->>'movement_pattern','') from jsonb_array_elements(coalesce(p_session_context#>'{session_intent_shadow,targets,movement_pattern_priorities}','[]'::jsonb)) x where upper(coalesce(x->>'role',''))='PRIORITY' or upper(coalesce(x->>'directive',''))='PROGRESS'
  ) q;
  select coalesce(array_agg(x->>'movement_pattern') filter(where x->>'movement_pattern' is not null),'{}'::text[]) into v_high from jsonb_array_elements(coalesce(v_exposure->'pattern_exposure','[]'::jsonb)) x where x->>'recent_pressure'='HIGH';
  select coalesce(array_agg(x->>'movement_pattern') filter(where x->>'movement_pattern' is not null),'{}'::text[]) into v_medium from jsonb_array_elements(coalesce(v_exposure->'pattern_exposure','[]'::jsonb)) x where x->>'recent_pressure'='MEDIUM';
  select coalesce(array_agg(p order by p),'{}'::text[]) into v_soft_avoid from unnest(v_high) p where not(p=any(v_protected));
  select coalesce(array_agg(p order by p),'{}'::text[]) into v_soft_reduce from unnest(v_medium) p where not(p=any(v_protected));
  if coalesce(v_exposure->>'status','')='AVAILABLE' then v_status:='AVAILABLE'; end if;
  return jsonb_build_object('version','rolling-pattern-complement-policy-shadow-v1','mode','SHADOW','status',v_status,'anchor_date',v_anchor,'pattern_exposure',v_exposure,'protected_priority_patterns',to_jsonb(v_protected),'high_recent_pressure_patterns',to_jsonb(v_high),'medium_recent_pressure_patterns',to_jsonb(v_medium),'soft_avoid_patterns',to_jsonb(v_soft_avoid),'soft_reduce_patterns',to_jsonb(v_soft_reduce),'policy',jsonb_build_object('single_station_overlap_can_be_acceptable',true,'avoid_repeated_concentration_not_all_exposure',true,'reliable_skill_priority_is_protected',true,'health_equipment_level_and_session_coherence_override',true,'no_equal_pattern_distribution_target',true),'authority',jsonb_build_object('shadow_only',true,'may_change_session_decision',false,'may_change_skill',false,'may_change_wod',false,'may_change_exercise_selection',false));
end;
$$;
revoke all on function public.program_coach_pattern_complement_policy_shadow_v1(uuid,date,jsonb) from public,anon;
grant execute on function public.program_coach_pattern_complement_policy_shadow_v1(uuid,date,jsonb) to authenticated,service_role;

create or replace function public.c4_pattern_complement_session_shadow_v1(p_user_id uuid,p_session_id uuid,p_anchor_date date default current_date,p_session_context jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable set search_path to 'public'
as $$
declare v_policy jsonb; v_soft_avoid text[]:='{}'::text[]; v_soft_reduce text[]:='{}'::text[]; v_protected text[]:='{}'::text[]; v_count int:=0; v_high_count int:=0; v_medium_count int:=0; v_protected_count int:=0; v_high_share numeric:=0; v_medium_share numeric:=0; v_ledger jsonb:='[]'::jsonb; v_status text:='INSUFFICIENT_HISTORY'; v_reason text:='NO_PATTERN_HISTORY';
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;
  if not exists(select 1 from public.workout_sessions where id=p_session_id and user_id=p_user_id) then return jsonb_build_object('version','pattern-complement-session-shadow-v1','mode','SHADOW','status','SESSION_NOT_FOUND'); end if;
  v_policy:=public.program_coach_pattern_complement_policy_shadow_v1(p_user_id,coalesce(p_anchor_date,current_date),p_session_context);
  if coalesce(v_policy->>'status','')<>'AVAILABLE' then return jsonb_build_object('version','pattern-complement-session-shadow-v1','mode','SHADOW','status','INSUFFICIENT_HISTORY','policy',v_policy,'authority',jsonb_build_object('shadow_only',true,'may_change_wod',false,'may_change_session_decision',false)); end if;
  select coalesce(array_agg(value),'{}'::text[]) into v_soft_avoid from jsonb_array_elements_text(coalesce(v_policy->'soft_avoid_patterns','[]'::jsonb));
  select coalesce(array_agg(value),'{}'::text[]) into v_soft_reduce from jsonb_array_elements_text(coalesce(v_policy->'soft_reduce_patterns','[]'::jsonb));
  select coalesce(array_agg(value),'{}'::text[]) into v_protected from jsonb_array_elements_text(coalesce(v_policy->'protected_priority_patterns','[]'::jsonb));
  with wod as (
    select wse.position,wse.exercise_id,e.movement_pattern from public.workout_session_exercises wse join public.exercises e on e.id=wse.exercise_id where wse.session_id=p_session_id and wse.block_key='wod' and nullif(e.movement_pattern,'') is not null
  ), classified as (
    select *,movement_pattern=any(v_soft_avoid) high_unprotected,movement_pattern=any(v_soft_reduce) medium_unprotected,movement_pattern=any(v_protected) protected_priority from wod
  )
  select count(*)::int,count(*) filter(where high_unprotected)::int,count(*) filter(where medium_unprotected)::int,count(*) filter(where protected_priority)::int,coalesce(jsonb_agg(jsonb_build_object('position',position,'exercise_id',exercise_id,'movement_pattern',movement_pattern,'high_recent_pressure_unprotected',high_unprotected,'medium_recent_pressure_unprotected',medium_unprotected,'protected_priority_pattern',protected_priority) order by position,exercise_id),'[]'::jsonb)
  into v_count,v_high_count,v_medium_count,v_protected_count,v_ledger from classified;
  if v_count=0 then v_status:='NO_WOD_EXERCISES'; v_reason:='NO_WOD_PATTERN_DATA'; else
    v_high_share:=v_high_count::numeric/v_count; v_medium_share:=v_medium_count::numeric/v_count;
    if v_high_count>=2 or v_high_share>=0.40 then v_status:='SOFT_OVERLAP'; v_reason:='WOD_REPEATS_HIGH_PRESSURE_PATTERN_TOO_OFTEN';
    elsif v_high_count=1 then v_status:='ACCEPTABLE_SINGLE_OVERLAP'; v_reason:='ONE_HIGH_PRESSURE_STATION_REMAINS_ACCEPTABLE';
    elsif v_medium_count>=greatest(2,ceil(v_count*0.60)::int) then v_status:='SOFT_OVERLAP'; v_reason:='WOD_CONCENTRATES_MULTIPLE_MEDIUM_PRESSURE_PATTERNS';
    else v_status:='COMPLEMENTED'; v_reason:='WOD_COMPLEMENTS_RECENT_PATTERN_EXPOSURE'; end if;
  end if;
  return jsonb_build_object('version','pattern-complement-session-shadow-v1','mode','SHADOW','status',v_status,'reason',v_reason,'session_id',p_session_id,'wod_exercise_count',v_count,'high_pressure_unprotected_count',v_high_count,'medium_pressure_unprotected_count',v_medium_count,'protected_priority_station_count',v_protected_count,'high_pressure_unprotected_share',round(v_high_share,4),'medium_pressure_unprotected_share',round(v_medium_share,4),'wod_pattern_ledger',v_ledger,'policy',v_policy,'recommendation',case when v_status='SOFT_OVERLAP' then 'EXPLORE_COMPLEMENTARY_WOD_CANDIDATE_IF_C4_QUALITY_REMAINS_HIGH' else 'KEEP_CURRENT_WOD' end,'authority',jsonb_build_object('shadow_only',true,'may_change_session_decision',false,'may_change_wod',false,'may_change_exercise_selection',false,'c4_quality_and_hard_gates_remain_authoritative',true));
end;
$$;
revoke all on function public.c4_pattern_complement_session_shadow_v1(uuid,uuid,date,jsonb) from public,anon;
grant execute on function public.c4_pattern_complement_session_shadow_v1(uuid,uuid,date,jsonb) to authenticated,service_role;