import { supabase } from '../lib/supabase';

const PERIOD_DAYS = {
  '4w': 28,
  '3m': 90,
  '1y': 365,
};

const ATHLETIC_LABELS = {
  strength: 'FORCE',
  conditioning: 'CONDITIONING',
  power: 'PUISSANCE',
  stability: 'STABILITÉ',
  mobility: 'MOBILITÉ',
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value, digits = 0) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function startOfWeek(date) {
  const copy = new Date(date);
  const day = copy.getDay();
  const diff = day === 0 ? -6 : 1 - day;

  copy.setHours(0, 0, 0, 0);
  copy.setDate(copy.getDate() + diff);

  return copy;
}

function toDateKey(date) {
  return date.toISOString().slice(0, 10);
}

function formatWeekLabel(date) {
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: 'short',
  })
    .format(date)
    .replace('.', '')
    .toUpperCase();
}

function formatSessionDate(value) {
  if (!value) {
    return '';
  }

  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
  })
    .format(new Date(value))
    .replace('.', '')
    .toUpperCase();
}

function formatHours(minutes) {
  const total = Math.max(0, Number(minutes ?? 0));
  const hours = Math.floor(total / 60);
  const rest = Math.round(total % 60);

  if (hours === 0) {
    return `${rest} min`;
  }

  if (rest === 0) {
    return `${hours} h`;
  }

  return `${hours} h ${rest}`;
}

function getMovementValue(progress) {
  const current = progress?.current_performance_json ?? {};
  const modes = Array.isArray(current?.tracking_modes)
    ? current.tracking_modes
    : [];

  if (
    modes.includes('load') &&
    current.weight_kg != null
  ) {
    const reps =
      current.reps_completed != null
        ? ` × ${Math.round(current.reps_completed)}`
        : '';

    return `${round(Number(current.weight_kg), 1)} KG${reps}`;
  }

  if (
    modes.includes('reps') &&
    current.reps_completed != null
  ) {
    return `${Math.round(current.reps_completed)} REPS`;
  }

  if (
    modes.includes('distance') &&
    current.distance_meters != null
  ) {
    return `${Math.round(current.distance_meters)} M`;
  }

  if (
    modes.includes('time') &&
    current.duration_seconds != null
  ) {
    return `${Math.round(current.duration_seconds)} S`;
  }

  return null;
}

function getRecommendationLabel(value) {
  if (value === 'PROGRESS_RECOMMENDED') {
    return 'PROGRESSION RECOMMANDÉE';
  }

  if (value === 'PROGRESS_POSSIBLE') {
    return 'PROGRESSION POSSIBLE';
  }

  return null;
}

function getStateLabel(value) {
  if (value === 'LEARN') {
    return 'EN APPRENTISSAGE';
  }

  if (value === 'PROGRESS') {
    return 'EN PROGRESSION';
  }

  if (value === 'RECOVER') {
    return 'À RÉCUPÉRER';
  }

  return 'À CONSOLIDER';
}

function buildWeeklyLoad(loadRows, days) {
  const weekCount = Math.max(
    4,
    Math.min(12, Math.ceil(days / 7))
  );

  const currentWeek = startOfWeek(new Date());

  const buckets = Array.from(
    { length: weekCount },
    (_, index) => {
      const date = new Date(currentWeek);
      date.setDate(
        date.getDate() -
          (weekCount - 1 - index) * 7
      );

      return {
        key: toDateKey(date),
        label: formatWeekLabel(date),
        load: 0,
        sessions: 0,
      };
    }
  );

  const byKey = new Map(
    buckets.map((bucket) => [
      bucket.key,
      bucket,
    ])
  );

  for (const row of loadRows ?? []) {
    if (!row?.calculated_at) {
      continue;
    }

    const week = startOfWeek(
      new Date(row.calculated_at)
    );

    const bucket = byKey.get(
      toDateKey(week)
    );

    if (!bucket) {
      continue;
    }

    bucket.load += Number(
      row.load_score ?? 0
    );

    bucket.sessions += 1;
  }

  return buckets.map((bucket) => ({
    ...bucket,
    load: round(bucket.load, 0),
  }));
}

function buildRegularity(
  sessions,
  weeklyTarget,
  days
) {
  const weekCount = Math.max(
    4,
    Math.min(12, Math.ceil(days / 7))
  );

  const currentWeek = startOfWeek(new Date());

  const buckets = Array.from(
    { length: weekCount },
    (_, index) => {
      const date = new Date(currentWeek);
      date.setDate(
        date.getDate() -
          (weekCount - 1 - index) * 7
      );

      return {
        key: toDateKey(date),
        label: formatWeekLabel(date),
        value: 0,
        target: weeklyTarget,
      };
    }
  );

  const byKey = new Map(
    buckets.map((bucket) => [
      bucket.key,
      bucket,
    ])
  );

  for (const session of sessions ?? []) {
    const dateValue =
      session.completed_at ??
      session.generated_at ??
      session.created_at;

    if (!dateValue) {
      continue;
    }

    const week = startOfWeek(
      new Date(dateValue)
    );

    const bucket = byKey.get(
      toDateKey(week)
    );

    if (bucket) {
      bucket.value += 1;
    }
  }

  return buckets;
}

function calculateRegularityPercent(
  weekly,
  weeklyTarget
) {
  if (!weeklyTarget || weekly.length === 0) {
    return 0;
  }

  const expected =
    weekly.length * weeklyTarget;

  const completed = weekly.reduce(
    (sum, item) =>
      sum + Math.min(item.value, weeklyTarget),
    0
  );

  return Math.round(
    clamp(completed / expected, 0, 1) * 100
  );
}

function buildCoachObservations({
  athleticProfile,
  movements,
  weeklyLoad,
  regularityPercent,
}) {
  const observations = [];

  const scored = athleticProfile
    .filter(
      (item) =>
        item.score != null &&
        item.confidence >= 25
    )
    .sort(
      (a, b) =>
        Number(b.trend ?? 0) -
        Number(a.trend ?? 0)
    );

  const improving = scored.find(
    (item) => Number(item.trend ?? 0) > 0.02
  );

  if (improving) {
    observations.push({
      icon: 'trending-up-outline',
      title: `${improving.label} EN PROGRESSION`,
      text: `La tendance récente est positive avec ${Math.round(
        improving.confidence
      )}% de confiance.`,
    });
  }

  const progressMovement = movements.find(
    (item) =>
      item.recommendation ===
        'PROGRESS_RECOMMENDED'
  );

  if (progressMovement) {
    observations.push({
      icon: 'arrow-up-circle-outline',
      title: 'PROCHAINE PROGRESSION',
      text: `${progressMovement.name} présente assez de signaux pour envisager une progression.`,
    });
  }

  if (regularityPercent >= 80) {
    observations.push({
      icon: 'calendar-outline',
      title: 'RÉGULARITÉ SOLIDE',
      text: `Tu tiens ${regularityPercent}% de ton rythme cible sur la période.`,
    });
  }

  if (weeklyLoad.length >= 3) {
    const values = weeklyLoad
      .slice(-3)
      .map((item) => item.load);

    if (
      values[0] > 0 &&
      values[2] > values[0] * 1.25
    ) {
      observations.push({
        icon: 'pulse-outline',
        title: 'CHARGE EN HAUSSE',
        text: 'Ta charge récente augmente nettement. UGEROD doit continuer à surveiller récupération et RPE.',
      });
    }
  }

  if (observations.length === 0) {
    observations.push({
      icon: 'analytics-outline',
      title: 'UGEROD APPREND TON PROFIL',
      text: 'Encore quelques séances permettront de rendre les tendances et recommandations plus fiables.',
    });
  }

  return observations.slice(0, 3);
}

export async function getProgressionDashboard(
  period = '4w'
) {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    throw new Error(
      'Utilisateur non authentifié.'
    );
  }

  const days =
    PERIOD_DAYS[period] ??
    PERIOD_DAYS['4w'];

  const since = new Date();
  since.setDate(
    since.getDate() - days
  );

  const sinceIso =
    since.toISOString();

  const [
    profileResult,
    sessionsResult,
    loadResult,
    athleticResult,
    athleticHistoryResult,
    movementResult,
  ] = await Promise.all([
    supabase
      .from('profiles')
      .select(
        'weekly_session_target'
      )
      .eq('id', user.id)
      .maybeSingle(),

    supabase
      .from('workout_sessions')
      .select(
        'id, status, duration_minutes, target_region, focus, completed_at, generated_at, global_rpe, post_workout_feeling, created_at'
      )
      .eq('user_id', user.id)
      .eq('status', 'completed')
      .gte('completed_at', sinceIso)
      .order('completed_at', {
        ascending: false,
      }),

    supabase
      .from('user_training_load')
      .select(
        'session_id, duration_minutes, global_rpe, load_score, readiness_before, feeling_after, calculated_at'
      )
      .eq('user_id', user.id)
      .gte('calculated_at', sinceIso)
      .order('calculated_at', {
        ascending: true,
      }),

    supabase
      .from('user_athletic_profile')
      .select(
        'dimension, score, confidence, trend, sample_count, source_breakdown, explanation_json, calculated_at'
      )
      .eq('user_id', user.id),

    supabase
      .from('user_athletic_profile_history')
      .select(
        'dimension, score, confidence, trend, sample_count, recorded_at'
      )
      .eq('user_id', user.id)
      .gte('recorded_at', sinceIso)
      .order('recorded_at', {
        ascending: true,
      }),

    supabase
      .from('user_exercise_progress')
      .select(
        'exercise_id, exposure_count, completed_count, skipped_count, avg_rpe, adherence_score, consistency_score, mastery_score, state, recommendation, performance_score, performance_confidence, mastery_confidence, overall_confidence, current_performance_json, best_performance_json, performance_delta, last_observed_at, updated_at'
      )
      .eq('user_id', user.id)
      .order('overall_confidence', {
        ascending: false,
        nullsFirst: false,
      })
      .limit(20),
  ]);

  const errors = [
    profileResult.error,
    sessionsResult.error,
    loadResult.error,
    athleticResult.error,
    athleticHistoryResult.error,
    movementResult.error,
  ].filter(Boolean);

  if (errors.length > 0) {
    throw errors[0];
  }

  const sessions =
    sessionsResult.data ?? [];

  const loadRows =
    loadResult.data ?? [];

  const movementRows =
    movementResult.data ?? [];

  const exerciseIds = movementRows
    .map((item) => item.exercise_id)
    .filter(Boolean);

  let exerciseById = new Map();

  if (exerciseIds.length > 0) {
    const {
      data: exercises,
      error: exerciseError,
    } = await supabase
      .from('exercises')
      .select(
        'id, name, tracking_modes, training_focus, movement_pattern'
      )
      .in('id', exerciseIds);

    if (exerciseError) {
      throw exerciseError;
    }

    exerciseById = new Map(
      (exercises ?? []).map(
        (exercise) => [
          exercise.id,
          exercise,
        ]
      )
    );
  }

  const weeklyTarget =
    Number(
      profileResult.data
        ?.weekly_session_target
    ) || 3;

  const regularity = buildRegularity(
    sessions,
    weeklyTarget,
    days
  );

  const regularityPercent =
    calculateRegularityPercent(
      regularity,
      weeklyTarget
    );

  const weeklyLoad =
    buildWeeklyLoad(
      loadRows,
      days
    );

  const totalMinutes =
    sessions.reduce(
      (sum, session) =>
        sum +
        Number(
          session.duration_minutes ?? 0
        ),
      0
    );

  const avgRpeValues =
    sessions
      .map((session) =>
        Number(session.global_rpe)
      )
      .filter(Number.isFinite);

  const avgRpe =
    avgRpeValues.length > 0
      ? round(
          avgRpeValues.reduce(
            (a, b) => a + b,
            0
          ) / avgRpeValues.length,
          1
        )
      : null;

  const athleticProfile =
    (athleticResult.data ?? [])
      .map((item) => ({
        ...item,
        label:
          ATHLETIC_LABELS[
            item.dimension
          ] ??
          String(
            item.dimension
          ).toUpperCase(),
        score:
          item.score == null
            ? null
            : round(
                Number(item.score),
                0
              ),
        confidence: round(
          Number(
            item.confidence ?? 0
          ),
          0
        ),
        trend: Number(
          item.trend ?? 0
        ),
      }))
      .sort((a, b) => {
        const order = [
          'strength',
          'conditioning',
          'power',
          'stability',
          'mobility',
        ];

        return (
          order.indexOf(a.dimension) -
          order.indexOf(b.dimension)
        );
      });

  const movements = movementRows
    .map((progress) => {
      const exercise =
        exerciseById.get(
          progress.exercise_id
        );

      return {
        id: progress.exercise_id,
        name:
          exercise?.name ??
          'EXERCICE',
        focus:
          exercise?.training_focus ??
          null,
        pattern:
          exercise?.movement_pattern ??
          null,
        masteryScore:
          progress.mastery_score == null
            ? null
            : round(
                Number(
                  progress.mastery_score
                ),
                0
              ),
        performanceScore:
          progress.performance_score ==
          null
            ? null
            : round(
                Number(
                  progress.performance_score
                ),
                0
              ),
        confidence: round(
          Number(
            progress.overall_confidence ??
              0
          ),
          0
        ),
        performanceDelta:
          progress.performance_delta ==
          null
            ? null
            : Number(
                progress.performance_delta
              ),
        state:
          progress.state,
        stateLabel:
          getStateLabel(
            progress.state
          ),
        recommendation:
          progress.recommendation,
        recommendationLabel:
          getRecommendationLabel(
            progress.recommendation
          ),
        currentValue:
          getMovementValue(
            progress
          ),
        exposureCount:
          Number(
            progress.exposure_count ?? 0
          ),
        avgRpe:
          progress.avg_rpe == null
            ? null
            : round(
                Number(
                  progress.avg_rpe
                ),
                1
              ),
      };
    })
    .sort((a, b) => {
      const recA =
        a.recommendation ===
        'PROGRESS_RECOMMENDED'
          ? 2
          : a.recommendation ===
              'PROGRESS_POSSIBLE'
            ? 1
            : 0;

      const recB =
        b.recommendation ===
        'PROGRESS_RECOMMENDED'
          ? 2
          : b.recommendation ===
              'PROGRESS_POSSIBLE'
            ? 1
            : 0;

      if (recA !== recB) {
        return recB - recA;
      }

      return (
        b.confidence -
        a.confidence
      );
    })
    .slice(0, 6);

  const recentSessions = sessions
    .slice(0, 5)
    .map((session) => ({
      id: session.id,
      date: formatSessionDate(
        session.completed_at
      ),
      title:
        session.target_region ??
        session.focus ??
        'SÉANCE',
      duration:
        session.duration_minutes != null
          ? `${Math.round(
              session.duration_minutes
            )} MIN`
          : null,
      rpe:
        session.global_rpe != null
          ? `${session.global_rpe}/10`
          : null,
      form:
        session.post_workout_feeling !=
        null
          ? `${session.post_workout_feeling}/10`
          : null,
    }));

  const coachObservations =
    buildCoachObservations({
      athleticProfile,
      movements,
      weeklyLoad,
      regularityPercent,
    });

  return {
    period,
    periodDays: days,
    summary: {
      completedSessions:
        sessions.length,
      totalMinutes,
      totalTimeLabel:
        formatHours(totalMinutes),
      regularityPercent,
      avgRpe,
      weeklyTarget,
    },
    regularity,
    weeklyLoad,
    athleticProfile,
    athleticHistory:
      athleticHistoryResult.data ?? [],
    movements,
    recentSessions,
    coachObservations,
  };
}