create or replace function public.c2_candidate_pool_pattern_complement_shadow_v1(
  p_user_id uuid,p_focus text,p_duration_minutes integer,p_readiness text,p_target_region text default null,p_progression_intent text default null,p_zone_terms text[] default '{}'::text[],p_inventory jsonb default '[]'::jsonb,p_usable_for text default 'WOD',p_max_complexity integer default 3,p_max_difficulty text default 'Intermédiaire',p_limit integer default 20,p_anchor_date date default current_date,p_session_context jsonb default '{}'::jsonb
) returns table(exercise_id text,exercise_name text,movement_pattern text,exercise_family text,body_region text,candidate_score numeric,score_components jsonb,stimulus_proxy jsonb,prescription_simulation jsonb)
language sql stable set search_path to 'public'
as $$
with policy as (select public.program_coach_pattern_complement_policy_shadow_v1(p_user_id,coalesce(p_anchor_date,current_date),p_session_context) j), arrays as (
  select coalesce((select array_agg(value) from jsonb_array_elements_text(coalesce(j->'soft_avoid_patterns','[]'::jsonb))),'{}'::text[]) soft_avoid,coalesce((select array_agg(value) from jsonb_array_elements_text(coalesce(j->'soft_reduce_patterns','[]'::jsonb))),'{}'::text[]) soft_reduce,coalesce((select array_agg(value) from jsonb_array_elements_text(coalesce(j->'protected_priority_patterns','[]'::jsonb))),'{}'::text[]) protected from policy
), base as (
  select * from public.c2_candidate_pool(p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,p_zone_terms,p_inventory,p_usable_for,p_max_complexity,p_max_difficulty,greatest(40,p_limit*4))
), scored as (
  select b.*,case when b.movement_pattern=any(a.protected) then 0::numeric when b.movement_pattern=any(a.soft_avoid) then -8::numeric when b.movement_pattern=any(a.soft_reduce) then -3::numeric else 0::numeric end complement_bias from base b cross join arrays a
)
select s.exercise_id,s.exercise_name,s.movement_pattern,s.exercise_family,s.body_region,round(s.candidate_score+s.complement_bias,2),coalesce(s.score_components,'{}'::jsonb)||jsonb_build_object('rolling_pattern_complement_bias',s.complement_bias,'rolling_pattern_complement_shadow',true,'rolling_pattern_bias_is_soft',true),s.stimulus_proxy,s.prescription_simulation
from scored s order by s.candidate_score+s.complement_bias desc,s.exercise_id limit greatest(1,p_limit);
$$;
revoke all on function public.c2_candidate_pool_pattern_complement_shadow_v1(uuid,text,integer,text,text,text,text[],jsonb,text,integer,text,integer,date,jsonb) from public,anon;
grant execute on function public.c2_candidate_pool_pattern_complement_shadow_v1(uuid,text,integer,text,text,text,text[],jsonb,text,integer,text,integer,date,jsonb) to authenticated,service_role;

create or replace function public.c4_pattern_complement_alternative_shadow_v1(p_user_id uuid,p_session_id uuid,p_anchor_date date default current_date,p_session_context jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable set search_path to 'public'
as $$
declare ws public.workout_sessions%rowtype; v_eval jsonb; v_inventory jsonb:='[]'::jsonb; v_max_complexity int:=3; v_max_diff text:='Intermédiaire'; v_current_ids text[]:='{}'::text[]; v_current_patterns text[]:='{}'::text[]; v_replace_id text; v_replace_pattern text; v_replace_position int; v_candidate record; v_profile jsonb; v_projected_high_count int:=0; v_wod_count int:=0; v_projected_status text;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;
  select * into ws from public.workout_sessions where id=p_session_id and user_id=p_user_id;
  if not found then return jsonb_build_object('version','pattern-complement-alternative-shadow-v1','mode','SHADOW','status','SESSION_NOT_FOUND'); end if;
  v_eval:=public.c4_pattern_complement_session_shadow_v1(p_user_id,p_session_id,coalesce(p_anchor_date,current_date),p_session_context);
  if coalesce(v_eval->>'status','')<>'SOFT_OVERLAP' then return jsonb_build_object('version','pattern-complement-alternative-shadow-v1','mode','SHADOW','status','NOT_NEEDED','reason','CURRENT_WOD_NOT_SOFT_OVERLAP','current_evaluation',v_eval,'authority',jsonb_build_object('shadow_only',true,'may_change_wod',false,'may_apply_replacement',false)); end if;
  v_inventory:=public.resolve_user_equipment_inventory(p_user_id,coalesce(ws.available_equipment,'{}'::text[]),'c4-final-default');
  select greatest(1,coalesce(max(e.technical_complexity),3)),coalesce((array_agg(e.difficulty order by public.c4_difficulty_rank_v1(e.difficulty) desc,e.id))[1],'Intermédiaire'),coalesce(array_agg(wse.exercise_id order by wse.position),'{}'::text[]),coalesce(array_agg(e.movement_pattern order by wse.position),'{}'::text[]),count(*)::int into v_max_complexity,v_max_diff,v_current_ids,v_current_patterns,v_wod_count from public.workout_session_exercises wse join public.exercises e on e.id=wse.exercise_id where wse.session_id=p_session_id and wse.block_key='wod';
  with high_rows as (
    select (x->>'position')::int position,x->>'exercise_id' exercise_id,x->>'movement_pattern' movement_pattern,count(*) over(partition by x->>'movement_pattern') pattern_count,row_number() over(partition by x->>'movement_pattern' order by (x->>'position')::int) pattern_ordinal from jsonb_array_elements(coalesce(v_eval->'wod_pattern_ledger','[]'::jsonb)) x where coalesce((x->>'high_recent_pressure_unprotected')::boolean,false)
  ) select exercise_id,movement_pattern,position into v_replace_id,v_replace_pattern,v_replace_position from high_rows where pattern_count>=2 and pattern_ordinal>1 order by pattern_count desc,position desc limit 1;
  if v_replace_id is null then return jsonb_build_object('version','pattern-complement-alternative-shadow-v1','mode','SHADOW','status','NO_REPLACEMENT_TARGET','reason','SOFT_OVERLAP_WITHOUT_REPEATED_HIGH_PRESSURE_STATION','current_evaluation',v_eval,'authority',jsonb_build_object('shadow_only',true,'may_change_wod',false,'may_apply_replacement',false)); end if;
  for v_candidate in
    select cp.* from public.c2_candidate_pool_pattern_complement_shadow_v1(p_user_id,coalesce(ws.focus,'General Fitness'),coalesce(ws.duration_minutes,45),coalesce(ws.readiness,'normal'),ws.target_region,ws.progression_intent,coalesce(ws.injured_zones,'{}'::text[]),v_inventory,'WOD',v_max_complexity,v_max_diff,40,coalesce(p_anchor_date,current_date),p_session_context) cp
    where not(cp.exercise_id=any(v_current_ids)) and not(cp.movement_pattern=any(coalesce((select array_agg(value) from jsonb_array_elements_text(coalesce(v_eval#>'{policy,soft_avoid_patterns}','[]'::jsonb))),'{}'::text[])))
    order by case when cp.movement_pattern=any(v_current_patterns) then 1 else 0 end,cp.candidate_score desc,cp.exercise_id
  loop
    v_profile:=public.c4_exercise_mechanic_profile(p_user_id,v_candidate.exercise_id,upper(coalesce(ws.mechanic_json->>'mechanic_key','CIRCUIT')),null,coalesce(ws.readiness,'normal'),ws.progression_intent);
    if coalesce((v_profile->>'compatible')::boolean,false) and coalesce(v_profile->>'classification','') in ('NATURAL','ADAPTABLE') then exit; end if;
    v_candidate:=null;
  end loop;
  if v_candidate is null then return jsonb_build_object('version','pattern-complement-alternative-shadow-v1','mode','SHADOW','status','NO_SAFE_COHERENT_ALTERNATIVE','reason','NO_C2_CANDIDATE_PRESERVES_CURRENT_MECHANIC','current_evaluation',v_eval,'replace_exercise_id',v_replace_id,'replace_pattern',v_replace_pattern,'replace_position',v_replace_position,'authority',jsonb_build_object('shadow_only',true,'may_change_wod',false,'may_apply_replacement',false)); end if;
  v_projected_high_count:=greatest(0,coalesce(nullif(v_eval->>'high_pressure_unprotected_count','')::int,0)-1); v_projected_status:=case when v_wod_count>0 and (v_projected_high_count>=2 or v_projected_high_count::numeric/v_wod_count>=0.40) then 'SOFT_OVERLAP' else 'COMPLEMENTED_OR_ACCEPTABLE' end;
  return jsonb_build_object('version','pattern-complement-alternative-shadow-v1','mode','SHADOW','status','ALTERNATIVE_PROPOSED','reason','SAFE_COMPLEMENTARY_C2_CANDIDATE_FOUND','replace',jsonb_build_object('position',v_replace_position,'exercise_id',v_replace_id,'movement_pattern',v_replace_pattern),'with',jsonb_build_object('exercise_id',v_candidate.exercise_id,'name',v_candidate.exercise_name,'movement_pattern',v_candidate.movement_pattern,'exercise_family',v_candidate.exercise_family,'candidate_score',v_candidate.candidate_score,'score_components',v_candidate.score_components,'mechanic_profile',v_profile),'current_evaluation',v_eval,'projected_high_pressure_unprotected_count',v_projected_high_count,'projected_pattern_status',v_projected_status,'same_wod_mechanic',upper(coalesce(ws.mechanic_json->>'mechanic_key','CIRCUIT')),'hard_gates_reused_from_c2',true,'authority',jsonb_build_object('shadow_only',true,'may_change_wod',false,'may_apply_replacement',false,'c4_remains_authoritative',true));
end;
$$;
revoke all on function public.c4_pattern_complement_alternative_shadow_v1(uuid,uuid,date,jsonb) from public,anon;
grant execute on function public.c4_pattern_complement_alternative_shadow_v1(uuid,uuid,date,jsonb) to authenticated,service_role;