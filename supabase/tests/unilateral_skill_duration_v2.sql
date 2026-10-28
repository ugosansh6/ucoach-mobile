do $test$ declare r jsonb; p jsonb; begin
p:=public.c2_solver_prescription('7d26944b-15ab-4140-b4c3-016255882380','EX478','{}','SKILL','RECALIBRATE','[]');
if p->>'reps_semantics'<>'per_side' then raise exception 'Pistol not per side';end if;
r:=public.skill_curriculum_duration_fit_v1('EX478','TARGET',p||'{"sets":3,"execution_target_reps":6,"rest_between_sets_seconds":75}',300,1);
if r->>'reps_semantics'<>'per_side' or (r->>'predicted_elapsed_seconds')::int<>260 or (r->>'execution_target_reps')::int<>5 or r->>'duration_fit_status'<>'FIT' then raise exception 'Unilateral fitting failed: %',r;end if;
end $test$;
