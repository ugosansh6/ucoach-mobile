alter table public.user_training_plan_items
  drop constraint if exists user_training_plan_items_status_check;

alter table public.user_training_plan_items
  add constraint user_training_plan_items_status_check
  check (status in ('available','claimed','completed','skipped','unrealized'));

update public.user_training_plan_items
set status='unrealized',
    planning_context_json=(coalesce(planning_context_json,'{}'::jsonb)-'closed_by_new_week')
      || jsonb_build_object(
        'closed_week_unrealized',true,
        'recommended_date_is_soft',true,
        'user_debt_created',false
      ),
    updated_at=now()
where status='skipped'
  and coalesce(planning_context_json,'{}'::jsonb) @> '{"closed_by_new_week":true}'::jsonb;

create or replace function public.d_ensure_week_plan(
  p_user_id uuid,
  p_anchor_date date default current_date,
  p_force_rebuild boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path='public'
as $$
declare
  v_week date:=public.d_week_start(coalesce(p_anchor_date,current_date));
  v_target int;
  v_goal text;
  v_exists boolean;
  v_seq int;
  v_offset int;
  v_completed record;
  v_item_id uuid;
  v_existing_completed int:=0;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then
    raise exception 'Cannot create another user weekly plan';
  end if;

  select least(7,greatest(1,coalesce(weekly_session_target,3)))
  into v_target from public.profiles where id=p_user_id;
  if not found then raise exception 'Profile not found'; end if;
  v_goal:=public.d_primary_goal(p_user_id);

  -- The recommendation date is soft. At week rollover, an unused intention is
  -- archived as unrealized data only. It never creates a debt or a missed-session UX.
  update public.user_training_plan_items
  set status='unrealized',
      updated_at=now(),
      planning_context_json=(coalesce(planning_context_json,'{}'::jsonb)-'closed_by_new_week')
        || jsonb_build_object(
          'closed_week_unrealized',true,
          'recommended_date_is_soft',true,
          'user_debt_created',false
        )
  where user_id=p_user_id and week_start<v_week and status='available';

  update public.user_training_weeks w
  set status='closed',updated_at=now()
  where w.user_id=p_user_id and w.week_start<v_week and w.status='active'
    and not exists(
      select 1 from public.user_training_plan_items i
      join public.workout_sessions ws on ws.id=i.session_id
      where i.user_id=w.user_id and i.week_start=w.week_start and i.status='claimed'
        and ws.status in ('generated','in_progress')
    );

  select exists(
    select 1 from public.user_training_weeks where user_id=p_user_id and week_start=v_week
  ) into v_exists;

  if p_force_rebuild and v_exists and not exists(
    select 1 from public.user_training_plan_items
    where user_id=p_user_id and week_start=v_week and status in ('claimed','completed')
  ) then
    delete from public.user_training_plan_items where user_id=p_user_id and week_start=v_week;
    delete from public.user_training_weeks where user_id=p_user_id and week_start=v_week;
    v_exists:=false;
  end if;

  if not v_exists then
    insert into public.user_training_weeks(
      user_id,week_start,weekly_session_target,primary_goal,status,plan_version,context_json
    ) values (
      p_user_id,v_week,v_target,v_goal,'active','d1-weekly-loop-v1',
      jsonb_build_object(
        'created_from_anchor_date',p_anchor_date,
        'baseline_duration_minutes',45,
        'planned_not_generated',true,
        'recommended_dates_are_soft',true,
        'no_session_debt',true
      )
    );

    for v_seq in 1..v_target loop
      v_offset:=public.d_plan_recommended_offset(v_seq,v_target);
      insert into public.user_training_plan_items(
        user_id,sequence_index,recommended_date,status,week_start,planned_focus,
        planned_target_region,planned_progression_intent,planned_duration_minutes,planning_context_json
      ) values (
        p_user_id,v_seq,v_week+v_offset,'available',v_week,v_goal,
        public.d_base_target_region(v_goal,v_seq),public.d_base_progression_intent(v_seq,v_target),45,
        jsonb_build_object(
          'plan_version','d1-weekly-loop-v1',
          'recommended_date_is_soft',true,
          'wod_pre_generated',false,
          'user_debt_created',false
        )
      );
    end loop;
  end if;

  for v_completed in
    select ws.id,ws.completed_at
    from public.workout_sessions ws
    where ws.user_id=p_user_id
      and ws.status='completed'
      and coalesce(ws.completed_at,ws.created_at)::date between v_week and v_week+6
      and not exists(select 1 from public.user_training_plan_items i where i.session_id=ws.id)
    order by coalesce(ws.completed_at,ws.created_at),ws.id
  loop
    select id into v_item_id
    from public.user_training_plan_items
    where user_id=p_user_id and week_start=v_week and status='available'
    order by sequence_index
    limit 1
    for update;
    exit when v_item_id is null;
    update public.user_training_plan_items set
      status='completed',session_id=v_completed.id,completed_at=v_completed.completed_at,
      claimed_at=coalesce(claimed_at,v_completed.completed_at),updated_at=now(),
      planning_context_json=planning_context_json||jsonb_build_object('backfilled_existing_session',true)
    where id=v_item_id;
    v_existing_completed:=v_existing_completed+1;
    v_item_id:=null;
  end loop;

  perform public.d_rebuild_weekly_stimulus_targets(p_user_id,v_week);

  return jsonb_build_object(
    'status','READY','version','d1-weekly-plan-v3-soft-no-debt','user_id',p_user_id,'week_start',v_week,
    'weekly_session_target',(select weekly_session_target from public.user_training_weeks where user_id=p_user_id and week_start=v_week),
    'primary_goal',(select primary_goal from public.user_training_weeks where user_id=p_user_id and week_start=v_week),
    'backfilled_completed_sessions',v_existing_completed,
    'recommended_dates_are_soft',true,
    'user_session_debt',false,
    'items',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',i.id,'sequence_index',i.sequence_index,'recommended_date',i.recommended_date,'status',i.status,
        'session_id',i.session_id,'planned_focus',i.planned_focus,'planned_target_region',i.planned_target_region,
        'planned_progression_intent',i.planned_progression_intent,'planned_duration_minutes',i.planned_duration_minutes,
        'planning_context',i.planning_context_json
      ) order by i.sequence_index)
      from public.user_training_plan_items i where i.user_id=p_user_id and i.week_start=v_week
    ),'[]'::jsonb)
  );
end;
$$;

create or replace function public.e_coach_note_preview(
  p_user_id uuid,
  p_anchor_date date default current_date
)
returns jsonb
language plpgsql
security definer
set search_path='public'
as $$
declare
  v_anchor date:=coalesce(p_anchor_date,current_date);
  v_week date:=public.d_week_start(coalesce(p_anchor_date,current_date));
  v_total_completed int:=0;
  v_capability_rows int:=0;
  v_confident_rows int:=0;
  v_plan_status text;
  v_plan_intent text;
  v_last_rpe numeric;
  v_last_feeling numeric;
  v_last_session_id uuid;
  v_exception_ratio numeric:=0;
  v_category text:='DEFAULT';
  v_confidence text:='LOW';
  v_variant int:=0;
  v_text text;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then
    raise exception 'Forbidden user';
  end if;

  perform public.d_ensure_week_plan(p_user_id,v_anchor,false);

  select count(*) into v_total_completed
  from public.workout_sessions
  where user_id=p_user_id and status='completed';

  select count(*),count(*) filter(where confidence>=0.60)
  into v_capability_rows,v_confident_rows
  from public.user_exercise_capabilities
  where user_id=p_user_id;

  select i.status,i.planned_progression_intent
  into v_plan_status,v_plan_intent
  from public.user_training_plan_items i
  where i.user_id=p_user_id
    and i.week_start=v_week
    and i.status in ('claimed','available')
  order by case when i.status='claimed' then 0 else 1 end,
           case when i.recommended_date<=v_anchor then 0 else 1 end,
           i.recommended_date,
           i.sequence_index
  limit 1;

  select ws.id,ws.global_rpe,ws.post_workout_feeling
  into v_last_session_id,v_last_rpe,v_last_feeling
  from public.workout_sessions ws
  where ws.user_id=p_user_id and ws.status='completed'
  order by coalesce(ws.completed_at,ws.updated_at) desc
  limit 1;

  if v_last_session_id is not null then
    select coalesce(avg(case coalesce(wse.user_execution_status,'pending')
      when 'completed' then 0
      when 'adapted' then 1
      when 'not_completed' then 1
      else 0 end),0)
    into v_exception_ratio
    from public.workout_session_exercises wse
    where wse.session_id=v_last_session_id;
  end if;

  if v_total_completed<4 or v_capability_rows<5 then
    v_confidence:='LOW';
  elsif v_total_completed<10 or v_confident_rows<5 then
    v_confidence:='MEDIUM';
  else
    v_confidence:='HIGH';
  end if;

  if v_plan_status='claimed' then
    v_category:='READY';
  elsif v_total_completed=0 then
    v_category:='STARTER';
  elsif v_confidence='LOW' then
    v_category:='LEARNING';
  elsif v_exception_ratio>=0.50 or v_plan_intent='RECALIBRATE' then
    v_category:='TEST';
  elsif coalesce(v_last_rpe,0)>=9 or coalesce(v_last_feeling,10)<=3 then
    v_category:='CONTROL';
  elsif v_plan_intent='PROGRESS' then
    v_category:='CHALLENGE';
  elsif v_plan_intent='CONSOLIDATE' then
    v_category:='BUILD';
  elsif v_plan_intent='EXPLORE' then
    v_category:='SURPRISE';
  elsif v_plan_intent='DELOAD' then
    v_category:='CONTROL';
  elsif v_plan_intent='MAINTAIN' then
    v_category:='STEADY';
  else
    v_category:='DEFAULT';
  end if;

  v_variant:=get_byte(
    decode(md5(p_user_id::text||'|'||v_anchor::text||'|'||v_category),'hex'),
    0
  ) % 4;

  v_text:=case v_category
    when 'STARTER' then case v_variant
      when 0 then 'Pas de panique, j’aimerais simplement te tester un peu aujourd’hui.'
      when 1 then 'On apprend encore à se connaître. Aujourd’hui, je prends quelques repères.'
      when 2 then 'Pour commencer, je veux surtout voir comment tu réagis. Fais-moi confiance.'
      else 'Première mission : me donner quelques repères. Je m’occupe du reste.' end
    when 'LEARNING' then case v_variant
      when 0 then 'Je commence à mieux te connaître. Aujourd’hui, je prends encore quelques repères.'
      when 1 then 'Pas de panique, j’aimerais te tester un peu aujourd’hui.'
      when 2 then 'On affine encore la recette. Suis simplement ce que je te propose.'
      else 'J’ai encore quelques choses à apprendre sur toi. Aujourd’hui va m’aider.' end
    when 'TEST' then case v_variant
      when 0 then 'Pas de panique, j’aimerais te tester un peu aujourd’hui.'
      when 1 then 'Aujourd’hui, je veux surtout voir comment tu réagis. Fais-moi confiance.'
      when 2 then 'Je vais ajuster un peu la recette aujourd’hui. Rien à prouver.'
      else 'Petite prise de repères aujourd’hui. Ne cherche pas à en faire plus que prévu.' end
    when 'CONTROL' then case v_variant
      when 0 then 'Aujourd’hui, je garde un peu de marge. On fait les choses proprement.'
      when 1 then 'Pas besoin d’en faire trop aujourd’hui. Je veux surtout une séance propre.'
      when 2 then 'On garde de l’énergie aujourd’hui. La régularité fait aussi progresser.'
      else 'Aujourd’hui, on joue la carte de la maîtrise. Pas besoin de forcer.' end
    when 'CHALLENGE' then case v_variant
      when 0 then 'J’ai prévu de monter un peu le curseur aujourd’hui. Garde-en sous le pied au départ.'
      when 1 then 'Ça devrait chauffer un peu aujourd’hui. Pars progressivement.'
      when 2 then 'Je vais te challenger un peu plus aujourd’hui. Fais-moi confiance.'
      else 'J’ai quelque chose d’un peu plus relevé pour toi aujourd’hui.' end
    when 'BUILD' then case v_variant
      when 0 then 'Aujourd’hui, on consolide ce qu’on construit depuis quelques séances.'
      when 1 then 'Pas besoin d’en faire trop aujourd’hui. On continue de bâtir.'
      when 2 then 'Je veux une séance propre aujourd’hui. Le reste viendra tout seul.'
      else 'On avance sans forcer le trait aujourd’hui. Fais confiance au processus.' end
    when 'SURPRISE' then case v_variant
      when 0 then 'Je change un peu la recette aujourd’hui. Fais-moi confiance.'
      when 1 then 'J’ai envie de te surprendre un peu aujourd’hui.'
      when 2 then 'Un peu de nouveauté aujourd’hui. Je garde le reste pour moi.'
      else 'Aujourd’hui, je sors légèrement de nos habitudes. À toi de jouer.' end
    when 'STEADY' then case v_variant
      when 0 then 'Aujourd’hui, on construit. Rien de spectaculaire, mais chaque répétition compte.'
      when 1 then 'On garde le rythme aujourd’hui. Fais simple, propre et régulier.'
      when 2 then 'Séance utile aujourd’hui : pas besoin d’en faire plus que prévu.'
      else 'Je garde la recette simple aujourd’hui. À toi de mettre de la qualité.' end
    when 'READY' then case v_variant
      when 0 then 'Ta séance t’attend. J’ai gardé le reste secret.'
      when 1 then 'Tout est prêt. À toi de venir découvrir ce que je t’ai préparé.'
      when 2 then 'J’ai déjà préparé la suite. On reprend quand tu veux.'
      else 'Ta séance est prête. Je garde encore un peu de suspense.' end
    else case v_variant
      when 0 then 'J’ai préparé quelque chose pour toi aujourd’hui. Fais-moi confiance.'
      when 1 then 'On garde un peu de suspense. Viens voir ce que je t’ai préparé.'
      when 2 then 'Aujourd’hui, suis simplement le plan. Je m’occupe du reste.'
      else 'Une nouvelle séance t’attend. Je garde la recette pour moi.' end
  end;

  return jsonb_build_object(
    'version','e1-coach-note-preview-v1',
    'headline','LE MOT DU COACH',
    'text',v_text,
    'category',v_category,
    'data_confidence',v_confidence,
    'pre_checkin',true,
    'spoiler_safe',true,
    'uses_ai',false,
    'decision_basis',jsonb_build_object(
      'planned_intent',v_plan_intent,
      'completed_sessions',v_total_completed,
      'capability_rows',v_capability_rows,
      'confident_capability_rows',v_confident_rows,
      'previous_exception_ratio',round(v_exception_ratio,3)
    )
  );
end;
$$;

create or replace function public.e_session_coach_note(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path='public'
as $$
declare
  v_session public.workout_sessions%rowtype;
  v_total_completed int:=0;
  v_capability_rows int:=0;
  v_confident_rows int:=0;
  v_confidence text:='LOW';
  v_category text:='DEFAULT';
  v_variant int:=0;
  v_text text;
  v_rpe_max numeric;
  v_density numeric;
begin
  select * into v_session from public.workout_sessions where id=p_session_id;
  if not found then raise exception 'Session not found'; end if;
  if auth.uid() is not null and auth.uid()<>v_session.user_id then raise exception 'Forbidden user'; end if;

  select count(*) into v_total_completed from public.workout_sessions
  where user_id=v_session.user_id and status='completed';

  select count(*),count(*) filter(where confidence>=0.60)
  into v_capability_rows,v_confident_rows
  from public.user_exercise_capabilities where user_id=v_session.user_id;

  if v_total_completed<4 or v_capability_rows<5 then
    v_confidence:='LOW';
  elsif v_total_completed<10 or v_confident_rows<5 then
    v_confidence:='MEDIUM';
  else
    v_confidence:='HIGH';
  end if;

  v_rpe_max:=nullif(v_session.expected_stimulus_json#>>'{rpe_target,max}','')::numeric;
  v_density:=nullif(v_session.expected_stimulus_json#>>'{density,score}','')::numeric;

  if v_confidence='LOW' then v_category:='LEARNING';
  elsif upper(coalesce(v_session.progression_intent,''))='RECALIBRATE' then v_category:='TEST';
  elsif upper(coalesce(v_session.progression_intent,''))='DELOAD' or lower(coalesce(v_session.readiness,''))='low' then v_category:='CONTROL';
  elsif upper(coalesce(v_session.progression_intent,''))='EXPLORE' then v_category:='SURPRISE';
  elsif upper(coalesce(v_session.progression_intent,''))='CONSOLIDATE' then v_category:='BUILD';
  elsif upper(coalesce(v_session.progression_intent,''))='PROGRESS' and (coalesce(v_rpe_max,0)>=8 or coalesce(v_density,0)>=65) then v_category:='CHALLENGE';
  elsif upper(coalesce(v_session.progression_intent,''))='PROGRESS' then v_category:='BUILD';
  else v_category:='STEADY';
  end if;

  v_variant:=get_byte(decode(md5(v_session.user_id::text||'|'||p_session_id::text||'|'||v_category),'hex'),0)%4;

  v_text:=case v_category
    when 'LEARNING' then case v_variant
      when 0 then 'Pas de panique, j’aimerais te tester un peu aujourd’hui.'
      when 1 then 'On affine encore la recette. Suis simplement ce que je te propose.'
      when 2 then 'Je prends encore quelques repères aujourd’hui. Fais-moi confiance.'
      else 'On apprend encore à se connaître. Je m’occupe du reste.' end
    when 'TEST' then case v_variant
      when 0 then 'Pas de panique, j’aimerais te tester un peu aujourd’hui.'
      when 1 then 'Aujourd’hui, je veux surtout voir comment tu réagis. Fais-moi confiance.'
      when 2 then 'Je vais ajuster un peu la recette aujourd’hui. Rien à prouver.'
      else 'Petite prise de repères aujourd’hui. Ne cherche pas à en faire plus que prévu.' end
    when 'CONTROL' then case v_variant
      when 0 then 'Aujourd’hui, je garde un peu de marge. On fait les choses proprement.'
      when 1 then 'Pas besoin d’en faire trop aujourd’hui. Je veux surtout une séance propre.'
      when 2 then 'On garde de l’énergie aujourd’hui. La régularité fait aussi progresser.'
      else 'Aujourd’hui, on joue la carte de la maîtrise. Pas besoin de forcer.' end
    when 'CHALLENGE' then case v_variant
      when 0 then 'J’ai prévu de monter un peu le curseur aujourd’hui. Garde-en sous le pied au départ.'
      when 1 then 'Ça devrait chauffer aujourd’hui. Pars progressivement, tu en auras besoin.'
      when 2 then 'Je vais te challenger un peu plus aujourd’hui. Fais-moi confiance.'
      else 'J’ai quelque chose d’un peu plus relevé pour toi aujourd’hui.' end
    when 'BUILD' then case v_variant
      when 0 then 'Aujourd’hui, on consolide ce qu’on construit depuis quelques séances.'
      when 1 then 'Pas besoin d’en faire trop aujourd’hui. On continue de bâtir.'
      when 2 then 'Je veux une séance propre aujourd’hui. Le reste viendra tout seul.'
      else 'On avance sans forcer le trait aujourd’hui. Fais confiance au processus.' end
    when 'SURPRISE' then case v_variant
      when 0 then 'Je change un peu la recette aujourd’hui. Fais-moi confiance.'
      when 1 then 'J’ai envie de te surprendre un peu aujourd’hui.'
      when 2 then 'Un peu de nouveauté aujourd’hui. Je garde le reste pour moi.'
      else 'Aujourd’hui, je sors légèrement de nos habitudes. À toi de jouer.' end
    else case v_variant
      when 0 then 'On garde le rythme aujourd’hui. Fais simple, propre et régulier.'
      when 1 then 'Séance utile aujourd’hui : pas besoin d’en faire plus que prévu.'
      when 2 then 'Aujourd’hui, suis simplement le plan. Je m’occupe du reste.'
      else 'Je garde la recette simple aujourd’hui. À toi de mettre de la qualité.' end
  end;

  return jsonb_build_object(
    'version','e1-session-coach-note-v1',
    'headline','LE MOT DU COACH',
    'text',v_text,
    'category',v_category,
    'data_confidence',v_confidence,
    'pre_checkin',false,
    'spoiler_safe',true,
    'uses_ai',false
  );
end;
$$;

create or replace function public.e_dashboard_snapshot(
  p_user_id uuid,
  p_anchor_date date default current_date,
  p_month_start date default null
)
returns jsonb
language plpgsql
security definer
set search_path='public'
as $$
declare
  v_snapshot jsonb;
  v_note jsonb;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;
  v_snapshot:=public.d_dashboard_snapshot(p_user_id,p_anchor_date,p_month_start);
  v_note:=public.e_coach_note_preview(p_user_id,p_anchor_date);
  return v_snapshot||jsonb_build_object(
    'version','e1-dashboard-snapshot-v1',
    'coach_note',v_note,
    'weekly_schedule_explanation_enabled',false,
    'recommended_dates_are_soft',true,
    'session_debt_enabled',false
  );
end;
$$;

revoke all on function public.e_coach_note_preview(uuid,date) from public,anon;
revoke all on function public.e_session_coach_note(uuid) from public,anon;
revoke all on function public.e_dashboard_snapshot(uuid,date,date) from public,anon;
grant execute on function public.e_coach_note_preview(uuid,date) to authenticated;
grant execute on function public.e_session_coach_note(uuid) to authenticated;
grant execute on function public.e_dashboard_snapshot(uuid,date,date) to authenticated;;
