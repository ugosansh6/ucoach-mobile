update public.exercises
set joint_impact=1
where id in ('EX_C03','EX_L02') and joint_impact is null;;
