create or replace function public.c2_mechanic_fit(
  p_mechanic_key text,
  p_stimulus jsonb,
  p_progression_intent text default null
)
returns numeric
language plpgsql
stable
set search_path = public
as $function$
declare
  s_strength numeric := coalesce((p_stimulus#>>'{qualities,strength,score}')::numeric,50);
  s_cond numeric := coalesce((p_stimulus#>>'{qualities,conditioning,score}')::numeric,50);
  s_end numeric := coalesce((p_stimulus#>>'{qualities,muscular_endurance,score}')::numeric,50);
  s_density numeric := coalesce((p_stimulus#>>'{density,score}')::numeric,50);
  s_complexity numeric := coalesce((p_stimulus#>>'{complexity,score}')::numeric,50);
  m_strength numeric;
  m_cond numeric;
  m_end numeric;
  m_density numeric;
  m_complexity numeric;
  v_score numeric;
  v_intent text := upper(coalesce(p_progression_intent,''));
begin
  case upper(p_mechanic_key)
    when 'AMRAP' then m_strength:=35;m_cond:=90;m_end:=80;m_density:=90;m_complexity:=45;
    when 'EMOM' then m_strength:=50;m_cond:=75;m_end:=65;m_density:=65;m_complexity:=55;
    when 'FOR_TIME' then m_strength:=40;m_cond:=85;m_end:=80;m_density:=80;m_complexity:=50;
    when 'CIRCUIT' then m_strength:=55;m_cond:=65;m_end:=65;m_density:=60;m_complexity:=45;
    when 'HIIT' then m_strength:=30;m_cond:=95;m_end:=82;m_density:=90;m_complexity:=45;
    when 'LADDER' then m_strength:=60;m_cond:=55;m_end:=80;m_density:=55;m_complexity:=55;
    when 'PYRAMID' then m_strength:=65;m_cond:=45;m_end:=70;m_density:=45;m_complexity:=55;
    when 'STRENGTH' then m_strength:=95;m_cond:=20;m_end:=40;m_density:=30;m_complexity:=60;
    when 'PROGRESSIVE_INTERVAL' then m_strength:=35;m_cond:=80;m_end:=75;m_density:=70;m_complexity:=50;
    else return 0;
  end case;

  v_score := 100 - (
    abs(s_strength-m_strength)*0.20 +
    abs(s_cond-m_cond)*0.30 +
    abs(s_end-m_end)*0.20 +
    abs(s_density-m_density)*0.20 +
    abs(s_complexity-m_complexity)*0.10
  );

  if upper(p_mechanic_key)='PROGRESSIVE_INTERVAL' and v_intent in ('RECALIBRATE','EXPLORE') then
    v_score:=v_score+12;
  end if;

  if upper(p_mechanic_key)='STRENGTH' and v_intent='DELOAD' then
    v_score:=v_score-10;
  end if;

  if upper(p_mechanic_key)='HIIT' and v_intent='DELOAD' then
    v_score:=v_score-12;
  end if;

  return round(greatest(0,least(100,v_score)),2);
end;
$function$;;
