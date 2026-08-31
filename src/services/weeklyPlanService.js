import { supabase } from '../lib/supabase';
import {
  getAuthenticatedUserWithRetry,
  runSupabaseRequestWithAuthRetry,
} from '../lib/supabaseAuthRetry';

export function getLocalDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getMonthStartKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}-01`;
}

async function getAuthenticatedUserId() {
  const user = await getAuthenticatedUserWithRetry();
  return user.id;
}

export async function getDashboardSnapshot({
  anchorDate = new Date(),
  monthDate = anchorDate,
} = {}) {
  const userId = await getAuthenticatedUserId();

  const data = await runSupabaseRequestWithAuthRetry(() =>
    supabase.rpc(
      'e_dashboard_snapshot',
      {
        p_user_id: userId,
        p_anchor_date: getLocalDateKey(anchorDate),
        p_month_start: getMonthStartKey(monthDate),
      }
    )
  );

  return normalizeDashboardSnapshot(data);
}

export async function getTrainingConsistency({
  anchorDate = new Date(),
  monthsBack = 24,
} = {}) {
  const userId = await getAuthenticatedUserId();

  const data = await runSupabaseRequestWithAuthRetry(() =>
    supabase.rpc(
      'e_training_consistency_history',
      {
        p_user_id: userId,
        p_anchor_date: getLocalDateKey(anchorDate),
        p_months_back: monthsBack,
      }
    )
  );

  return data ?? {};
}

function normalizeDashboardSnapshot(data) {
  const source = data ?? {};
  const activeSession = source.active_session_today ?? {};
  const learning = source.profile_learning ?? {};

  return {
    version: source.version ?? null,
    anchorDate: source.anchor_date ?? null,
    weekStart: source.week_start ?? null,
    weekEnd: source.week_end ?? null,
    monthStart: source.month_start ?? null,
    monthEnd: source.month_end ?? null,
    primaryGoal: source.primary_goal ?? 'General Fitness',
    coachNote: {
      headline: source.coach_note?.headline ?? 'LE MOT DU COACH',
      text: source.coach_note?.text ?? null,
      category: source.coach_note?.category ?? null,
      dataConfidence: source.coach_note?.data_confidence ?? 'LOW',
      preCheckin: source.coach_note?.pre_checkin !== false,
      spoilerSafe: source.coach_note?.spoiler_safe !== false,
      usesAi: Boolean(source.coach_note?.uses_ai),
    },
    weeklyTarget: Number(source.weekly_session_target ?? 0),
    completedThisWeek: Number(source.completed_sessions_this_week ?? 0),
    remainingThisWeek: Number(source.remaining_sessions_this_week ?? 0),
    weeklyGoalReached: Boolean(source.weekly_goal_reached),
    consecutiveGoalWeeks: Number(source.consecutive_goal_weeks ?? 0),
    totalCompletedSessions: Number(source.total_completed_sessions ?? 0),
    formTrend7d:
      source.form_trend_7d == null
        ? null
        : Number(source.form_trend_7d),
    formSamples7d: Number(source.form_samples_7d ?? 0),
    rpeTrend7d:
      source.rpe_trend_7d == null
        ? null
        : Number(source.rpe_trend_7d),
    weekDays: Array.isArray(source.week_days) ? source.week_days : [],
    nextPlanItem: source.next_plan_item ?? {},
    monthSessions: Array.isArray(source.month_sessions)
      ? source.month_sessions
      : [],
    monthlyActivity: Array.isArray(source.monthly_activity)
      ? source.monthly_activity.map((item) => ({
          monthStart: item?.month_start ?? null,
          completedSessions: Number(item?.completed_sessions ?? 0),
        }))
      : [],
    recentSessions: Array.isArray(source.recent_sessions)
      ? source.recent_sessions
      : [],
    stimulusBalance: Array.isArray(source.stimulus_balance)
      ? source.stimulus_balance
      : [],
    activeSessionToday: {
      sessionId: activeSession?.session_id ?? null,
      status: activeSession?.status ?? null,
      startedLocalDate: activeSession?.started_local_date ?? null,
      startedAt: activeSession?.started_at ?? null,
      frozenForLocalDay: Boolean(activeSession?.frozen_for_local_day),
    },
    profileLearning: {
      stage: learning?.stage ?? 'NEW',
      visible: learning?.visible !== false,
      title: learning?.title ?? 'UGEROD APPREND À TE CONNAÎTRE',
      text:
        learning?.text ??
        'Chaque séance me donne de nouveaux repères pour mieux adapter les suivantes.',
    },
    dailySessionRefresh: source.daily_session_refresh ?? {},
    recommendedDatesAreSoft: source.recommended_dates_are_soft !== false,
    sessionDebtEnabled: Boolean(source.session_debt_enabled),
    weeklyScheduleExplanationEnabled: Boolean(
      source.weekly_schedule_explanation_enabled
    ),
    raw: source,
  };
}
