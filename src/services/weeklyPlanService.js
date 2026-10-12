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

function normalizeWeekDateInput(value, fieldName) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return getLocalDateKey(value);
  }

  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  throw new Error(`${fieldName} must be a Date or a YYYY-MM-DD string.`);
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

export async function getWeekReadContract({
  anchorDate = new Date(),
} = {}) {
  const userId = await getAuthenticatedUserId();

  const data = await runSupabaseRequestWithAuthRetry(() =>
    supabase.rpc(
      'week_read_contract_v2',
      {
        p_user_id: userId,
        p_anchor_date: getLocalDateKey(anchorDate),
      }
    )
  );

  return normalizeWeekReadContract(data);
}

export async function moveWeekPlanItem({
  planItemId,
  targetDate,
  anchorDate = new Date(),
} = {}) {
  if (!planItemId) {
    throw new Error('planItemId is required to move a week item.');
  }

  const userId = await getAuthenticatedUserId();
  const data = await runSupabaseRequestWithAuthRetry(() =>
    supabase.rpc(
      'week_move_plan_item_v1',
      {
        p_user_id: userId,
        p_plan_item_id: planItemId,
        p_target_date: normalizeWeekDateInput(targetDate, 'targetDate'),
        p_anchor_date: normalizeWeekDateInput(anchorDate, 'anchorDate'),
      }
    )
  );

  return normalizeWeekMoveResult(data);
}

function normalizeWeekPresentation(presentation) {
  const source = presentation ?? {};
  const why = source.why ?? null;
  const coachAdvice = source.coach_advice ?? null;

  return {
    version: source.version ?? null,
    description: source.description ?? null,
    why: why
      ? {
          title: why.title ?? 'Pourquoi ce choix ?',
          text: why.text ?? null,
        }
      : null,
    coachAdvice: coachAdvice
      ? {
          type: coachAdvice.type ?? null,
          text: coachAdvice.text ?? null,
          evidenceReasonCodes: Array.isArray(coachAdvice.evidence_reason_codes)
            ? coachAdvice.evidence_reason_codes
            : [],
        }
      : null,
    exerciseExamples: Array.isArray(source.exercise_examples)
      ? source.exercise_examples
      : [],
    evidence: source.evidence ?? {},
    semantics: source.semantics ?? {},
  };
}

function normalizeWeekReadItem(item) {
  const source = item ?? {};
  const provenance = source.provenance ?? {};
  const projection = source.coach_projection ?? {};
  const plannedContext = source.planned_context ?? {};
  const sessionSummary = source.session_summary ?? null;

  return {
    planItemId: source.plan_item_id ?? null,
    sequenceIndex:
      source.sequence_index == null
        ? null
        : Number(source.sequence_index),
    recommendedDate: source.recommended_date ?? null,
    recommendedDateIsSoft:
      source.recommended_date_is_soft !== false,
    lifecycleStatus: source.lifecycle_status ?? null,
    displayState: source.display_state ?? 'PREVUE',
    surfaceVisibility: source.surface_visibility ?? 'PRIMARY',
    userDebtCreated: Boolean(source.user_debt_created),
    sessionId: source.session_id ?? null,
    sessionStatus: source.session_status ?? null,
    provenance: {
      code: provenance.code ?? null,
      source: provenance.source ?? null,
    },
    authority: source.authority ?? {},
    plannedContext: {
      durationMinutes:
        plannedContext.duration_minutes == null
          ? null
          : Number(plannedContext.duration_minutes),
      environmentCode: plannedContext.environment_code ?? null,
      equipment: Array.isArray(plannedContext.equipment)
        ? plannedContext.equipment
        : [],
    },
    sessionSummary: sessionSummary
      ? {
          status: sessionSummary.status ?? null,
          durationMinutes:
            sessionSummary.duration_minutes == null
              ? null
              : Number(sessionSummary.duration_minutes),
          focus: sessionSummary.focus ?? null,
          targetRegion: sessionSummary.target_region ?? null,
          progressionIntent: sessionSummary.progression_intent ?? null,
          plannedEnvironmentCode:
            sessionSummary.planned_environment_code ?? null,
          startedAt: sessionSummary.started_at ?? null,
          completedAt: sessionSummary.completed_at ?? null,
        }
      : null,
    coachProjection: {
      slotKind: projection.slot_kind ?? null,
      priority: projection.priority ?? null,
      projectionCertainty: projection.projection_certainty ?? null,
      relationshipToItem: projection.relationship_to_item ?? null,
      appliesToSessionContent:
        projection.applies_to_session_content === true,
      presentation: normalizeWeekPresentation(projection.presentation),
    },
  };
}

function normalizeWeekReadContract(data) {
  const source = data ?? {};
  const semantics = source.semantics ?? {};
  const items = Array.isArray(source.items)
    ? source.items.map(normalizeWeekReadItem)
    : [];

  return {
    contractVersion: source.contract_version ?? null,
    anchorDate: source.anchor_date ?? null,
    weekStart: source.week_start ?? null,
    weekEnd: source.week_end ?? null,
    weekStatus: source.week_status ?? null,
    weeklySessionTarget:
      source.weekly_session_target == null
        ? null
        : Number(source.weekly_session_target),
    completedActualCount: Number(source.completed_actual_count ?? 0),
    items,
    visibleItems: items.filter(
      (item) =>
        item.surfaceVisibility !== 'CONTEXT_ONLY' &&
        item.displayState !== 'CLOSED_SILENT'
    ),
    semantics: {
      recommendedDatesAreSoft:
        semantics.recommended_dates_are_soft !== false,
      noSessionDebt: semantics.no_session_debt !== false,
      plannedIsNotActual: semantics.planned_is_not_actual !== false,
      futureReadinessIsNotAssumed:
        semantics.future_readiness_is_not_assumed !== false,
      weeklyTargetIsNotCompletionScore:
        semantics.weekly_target_is_not_a_completion_score !== false,
      coachAdviceIsOptional:
        semantics.coach_advice_is_optional !== false,
      frontMustNotInventCoachAdvice:
        semantics.front_must_not_invent_coach_advice !== false,
      intentPresentationIsEvidenceBound:
        semantics.intent_presentation_is_evidence_bound !== false,
      exerciseExamplesRequireRealCandidateData:
        semantics.exercise_examples_require_real_candidate_data !== false,
    },
  };
}

function normalizeWeekMoveResult(data) {
  const source = data ?? {};

  return {
    contractVersion: source.contract_version ?? null,
    planItemId: source.plan_item_id ?? null,
    previousDate: source.previous_date ?? null,
    recommendedDate: source.recommended_date ?? null,
    weekStart: source.week_start ?? null,
    weekEnd: source.week_end ?? null,
    changed: Boolean(source.changed),
    recommendedDateIsSoft: source.recommended_date_is_soft !== false,
    hasCollision: Boolean(source.has_collision),
    collisionCount: Number(source.collision_count ?? 0),
    collisionPolicy: source.collision_policy ?? 'ALLOW_AND_ADVISE',
    userDebtCreated: Boolean(source.user_debt_created),
    contentMutated: Boolean(source.content_mutated),
    sessionIdentityMutated: Boolean(source.session_identity_mutated),
    sequenceMutated: Boolean(source.sequence_mutated),
    refreshWith: source.refresh_with ?? 'week_read_contract_v1',
    raw: source,
  };
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
