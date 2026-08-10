// hyper-api-v3.0 — progression coach détaillée + profil athlétique + charge\n
// @ts-ignore -- import URL résolu par Deno/Supabase Edge Runtime
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-ignore -- import URL résolu par Deno/Supabase Edge Runtime
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

declare const Deno: {
  env: {
    get(name: string): string | undefined;
  };
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type ProgressState = "LEARN" | "MAINTAIN" | "PROGRESS" | "RECOVER";
type ProgressRecommendation =
  | "LEARN"
  | "MAINTAIN"
  | "PROGRESS_POSSIBLE"
  | "PROGRESS_RECOMMENDED"
  | "RECOVER";

type Experience = "Débutant" | "Intermédiaire" | "Avancé";

interface ExerciseResult {
  exercise_id: string;
  status?: "completed" | "skipped";
  reps_completed?: number | null;
  weight_kg?: number | null;
  duration_seconds?: number | null;
  distance_meters?: number | null;
  rpe?: number | null;
  notes?: string | null;
}

interface Payload {
  session_id: string;
  post_workout_feeling?: number | null;
  global_rpe?: number | null;
  notes?: string | null;
  exercises: ExerciseResult[];
}

interface SessionExerciseRow {
  id: string;
  exercise_id: string;
  exercise_name: string | null;
  status: string | null;
  prescription: string | null;
  prescription_json: Record<string, unknown> | null;
}

interface ProgressSnapshot {
  exercise_id: string;
  exposure_count: number;
  completed_count: number;
  skipped_count: number;
  rpe_count: number;
  avg_rpe: number | null;
  last_rpe: number | null;
  recent_rpe: number[];
  rpe_trend: number;
  adherence_score: number;
  performance_trend: number;
  consistency_score: number;
  mastery_score: number;

  // Progression V3 : performance et confiance séparées.
  performance_score: number | null;
  performance_confidence: number;
  mastery_confidence: number;
  overall_confidence: number;
  best_performance_json: Record<string, unknown> | null;
  current_performance_json: Record<string, unknown> | null;
  performance_delta: number | null;
  last_observed_at: string | null;

  state: ProgressState;
  recommendation: ProgressRecommendation;
  last_performance_at: string | null;
}

type AthleticDimension =
  | "strength"
  | "conditioning"
  | "power"
  | "stability"
  | "mobility";

interface AthleticProfileSnapshot {
  dimension: AthleticDimension;
  score: number | null;
  confidence: number;
  trend: number;
  sample_count: number;
  source_breakdown: Record<string, unknown>;
  explanation_json: Record<string, unknown>;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(url, anon, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return json({ error: "Unauthorized" }, 401);

    const body: Payload = await req.json();
    if (!body.session_id) throw new Error("session_id requis.");
    if (!Array.isArray(body.exercises) || body.exercises.length === 0) {
      throw new Error("Au moins un résultat d'exercice est requis.");
    }

    if (body.global_rpe != null && (body.global_rpe < 1 || body.global_rpe > 10)) {
      throw new Error("global_rpe doit être compris entre 1 et 10.");
    }
    if (
      body.post_workout_feeling != null &&
      (body.post_workout_feeling < 1 || body.post_workout_feeling > 10)
    ) {
      throw new Error("post_workout_feeling doit être compris entre 1 et 10.");
    }

    const { data: session, error: sessionError } = await supabase
      .from("workout_sessions")
      .select("id, user_id, status, started_at, duration_minutes, readiness, generated_workout")
      .eq("id", body.session_id)
      .eq("user_id", user.id)
      .single();

    if (sessionError || !session) throw new Error("Séance introuvable.");
    if (session.status === "completed") {
      return json({ error: "Cette séance est déjà terminée." }, 409);
    }

    const requestedIds = body.exercises.map((x) => x.exercise_id);
    const { data: sessionExercises, error: seError } = await supabase
      .from("workout_session_exercises")
      .select("id, exercise_id, exercise_name, status, prescription, prescription_json")
      .eq("session_id", body.session_id)
      .in("exercise_id", requestedIds);

    if (seError) throw new Error(seError.message);

    const existing = new Map<string, SessionExerciseRow>(
      ((sessionExercises ?? []) as SessionExerciseRow[]).map((x) => [
        x.exercise_id,
        x,
      ]),
    );

    for (const item of body.exercises) {
      if (!existing.has(item.exercise_id)) {
        throw new Error(`L'exercice ${item.exercise_id} n'appartient pas à cette séance.`);
      }
      validateResult(item);
    }

    const now = new Date().toISOString();

    // 1) Mise à jour du détail réel de la séance.
    for (const item of body.exercises) {
      const { error } = await supabase
        .from("workout_session_exercises")
        .update({
          status: item.status ?? "completed",
          reps_completed: item.reps_completed ?? null,
          weight_kg: item.weight_kg ?? null,
          duration_seconds: item.duration_seconds ?? null,
          distance_meters: item.distance_meters ?? null,
          rpe: item.rpe ?? null,
          notes: item.notes ?? null,
          updated_at: now,
        })
        .eq("session_id", body.session_id)
        .eq("exercise_id", item.exercise_id);

      if (error) throw new Error(error.message);
    }

    // 2) Historique longitudinal.
    // On journalise aussi les "skipped" : ils sont utiles pour détecter RECOVER.
    // Pour rendre l'appel idempotent, on remplace les éventuels logs de cette séance.
    const { error: deleteOldLogsError } = await supabase
      .from("exercise_logs")
      .delete()
      .eq("user_id", user.id)
      .eq("session_id", body.session_id)
      .in("exercise_id", requestedIds);

    if (deleteOldLogsError) throw new Error(deleteOldLogsError.message);

    const logRows = body.exercises.map((item) => {
      const planned = existing.get(item.exercise_id);
      return {
        user_id: user.id,
        session_id: body.session_id,
        exercise_id: item.exercise_id,
        status: item.status ?? "completed",
        reps_completed: item.reps_completed ?? null,
        weight_kg: item.weight_kg ?? null,
        duration_seconds: item.duration_seconds ?? null,
        distance_meters: item.distance_meters ?? null,
        rpe: item.rpe ?? null,
        notes: item.notes ?? null,
        prescription_json: planned?.prescription_json ?? {},
        created_at: now,
      };
    });

    const { error: logsError } = await supabase
      .from("exercise_logs")
      .insert(logRows);

    if (logsError) throw new Error(logsError.message);

    // 3) Recalcul du moteur de progression uniquement pour les exercices touchés.
    //
    // Le niveau déclaré sert de point de départ ("prior") tant que UGEROD
    // possède peu de données réelles sur un exercice. Ensuite, l'historique
    // observé prend progressivement le dessus.
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("experience")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError) throw new Error(profileError.message);

    const experience = normalizeExperience(profile?.experience);

    const progressionSnapshots: ProgressSnapshot[] = [];
    for (const exerciseId of Array.from(new Set(requestedIds))) {
      const snapshot = await recomputeExerciseProgress(
        supabase,
        user.id,
        exerciseId,
        experience,
      );
      progressionSnapshots.push(snapshot);

      const { error: progressError } = await supabase
        .from("user_exercise_progress")
        .upsert(
          {
            user_id: user.id,
            ...snapshot,
            updated_at: now,
          },
          { onConflict: "user_id,exercise_id" },
        );

      if (progressError) throw new Error(progressError.message);
    }

    // 4) Clôture de séance.
    const { error: finishError } = await supabase
      .from("workout_sessions")
      .update({
        status: "completed",
        started_at: session.started_at ?? now,
        completed_at: now,
        post_workout_feeling: body.post_workout_feeling ?? null,
        global_rpe: body.global_rpe ?? null,
        notes: body.notes ?? null,
        updated_at: now,
      })
      .eq("id", body.session_id)
      .eq("user_id", user.id);

    if (finishError) throw new Error(finishError.message);

    // 5) Charge d'entraînement de la séance.
    // Première version volontairement explicable : durée x RPE global.
    // Les zones de charge (faible / optimale / élevée) seront calculées ensuite
    // par rapport à l'historique personnel, pas avec des seuils universels.
    const readinessBefore = extractReadinessScore(session.generated_workout);
    const durationMinutes =
      typeof session.duration_minutes === "number"
        ? Number(session.duration_minutes)
        : null;

    const trainingLoad =
      durationMinutes != null && body.global_rpe != null
        ? round2(durationMinutes * Number(body.global_rpe))
        : null;

    const { error: loadError } = await supabase
      .from("user_training_load")
      .upsert(
        {
          user_id: user.id,
          session_id: body.session_id,
          duration_minutes: durationMinutes,
          global_rpe: body.global_rpe ?? null,
          load_score: trainingLoad,
          readiness_before: readinessBefore,
          feeling_after: body.post_workout_feeling ?? null,
          calculated_at: now,
        },
        { onConflict: "session_id" },
      );

    if (loadError) throw new Error(loadError.message);

    // 6) Profil athlétique global dérivé des mouvements observés.
    // Il est recalculé après chaque séance, puis snapshoté pour les graphiques.
    const athleticProfile = await recomputeAthleticProfile(
      supabase,
      user.id,
      now,
    );

    const completedCount = body.exercises.filter(
      (x) => (x.status ?? "completed") === "completed",
    ).length;

    return json({
      success: true,
      version: "hyper-api-v3.0",
      session_id: body.session_id,
      status: "completed",
      logged_count: logRows.length,
      completed_count: completedCount,
      skipped_count: body.exercises.length - completedCount,
      completed_at: now,
      progression: progressionSnapshots,
      training_load: {
        duration_minutes: durationMinutes,
        global_rpe: body.global_rpe ?? null,
        load_score: trainingLoad,
        readiness_before: readinessBefore,
        feeling_after: body.post_workout_feeling ?? null,
      },
      athletic_profile: athleticProfile,
    });
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      400,
    );
  }
});

// ============================================================================
// PROGRESSION ENGINE
// ============================================================================

async function recomputeExerciseProgress(
  supabase: any,
  userId: string,
  exerciseId: string,
  experience: Experience,
): Promise<ProgressSnapshot> {
  const [
    { data: logs, error: logsError },
    { data: exercise, error: exerciseError },
    { data: progressions, error: variantsError },
  ] = await Promise.all([
    supabase
      .from("exercise_logs")
      .select(
        "status, rpe, reps_completed, weight_kg, duration_seconds, distance_meters, prescription_json, created_at",
      )
      .eq("user_id", userId)
      .eq("exercise_id", exerciseId)
      .order("created_at", { ascending: false })
      .limit(12),
    supabase
      .from("exercises")
      .select("id, tracking_modes, technical_complexity, training_focus")
      .eq("id", exerciseId)
      .single(),
    supabase
      .from("exercise_variants")
      .select("target_exercise_id")
      .eq("exercise_id", exerciseId)
      .eq("variant_type", "progression"),
  ]);

  if (logsError) throw new Error(logsError.message);
  if (exerciseError || !exercise) {
    throw new Error("Exercice introuvable pour le calcul de progression.");
  }
  if (variantsError) throw new Error(variantsError.message);

  const rows = logs ?? [];
  const completed = rows.filter((x: any) => x.status === "completed");
  const skipped = rows.filter((x: any) => x.status === "skipped");
  const rpeRows = completed.filter((x: any) => typeof x.rpe === "number");
  const recentRpe = rpeRows.slice(0, 3).map((x: any) => Number(x.rpe));
  const avgRpe =
    rpeRows.length > 0
      ? average(rpeRows.slice(0, 5).map((x: any) => Number(x.rpe)))
      : null;
  const lastRpe = recentRpe[0] ?? null;

  // Positif = le RPE baisse avec le temps = amélioration.
  let rpeTrend = 0;
  if (recentRpe.length >= 3) {
    const chronological = [...recentRpe].reverse();
    rpeTrend = round3(
      chronological[0] - chronological[chronological.length - 1],
    );
  }

  // -------------------------------------------------------------------------
  // A. NIVEAU INITIAL ESTIMÉ
  // -------------------------------------------------------------------------
  // Absence d'historique != débutant sur l'exercice.
  //
  // Le niveau déclaré de l'utilisateur et la complexité technique du mouvement
  // donnent une présomption initiale de maîtrise. Cette présomption n'autorise
  // jamais à recommander immédiatement une progression : pour progresser, il
  // faut ensuite suffisamment de preuves réelles.
  const technicalComplexity = clamp(
    Number(exercise.technical_complexity ?? 3),
    1,
    5,
  );
  const baselineMastery = getInitialMasteryScore(
    experience,
    technicalComplexity,
  );

  // -------------------------------------------------------------------------
  // B. MAÎTRISE OBSERVÉE
  // -------------------------------------------------------------------------
  const exposureComponent = clamp(completed.length / 5, 0, 1) * 15;
  const rpeComponent = scoreRpe(avgRpe);
  const rpeTrendComponent = clamp((rpeTrend + 2) / 4, 0, 1) * 15;

  const adherenceValues = completed
    .slice(0, 5)
    .map((log: any) => computeAdherence(log))
    .filter((x: number | null): x is number => x != null);
  const adherenceNormalized =
    adherenceValues.length > 0 ? average(adherenceValues) * 100 : 50;
  const adherenceComponent = (adherenceNormalized / 100) * 20;

  const trackingModes: string[] = Array.isArray(exercise.tracking_modes)
    ? exercise.tracking_modes
    : [];

  const performanceTrend = computePerformanceTrend(
    completed,
    trackingModes,
  );

  const performanceSummary = computePerformanceSummary(
    completed,
    trackingModes,
    adherenceNormalized,
    rpeTrend,
  );

  // -1 .. +1 -> 0 .. 20, neutre = 10.
  const performanceComponent =
    clamp((performanceTrend + 1) / 2, 0, 1) * 20;

  const recentEight = rows.slice(0, 8);
  const consistencyNormalized =
    recentEight.length > 0
      ? (recentEight.filter((x: any) => x.status === "completed").length /
          recentEight.length) *
        100
      : 0;
  const consistencyComponent = (consistencyNormalized / 100) * 10;

  let observedMastery = round2(
    exposureComponent +
      rpeComponent +
      rpeTrendComponent +
      adherenceComponent +
      performanceComponent +
      consistencyComponent,
  );
  observedMastery = clamp(observedMastery, 0, 100);

  // -------------------------------------------------------------------------
  // C. LE NIVEAU DÉCLARÉ S'EFFACE PROGRESSIVEMENT DEVANT LES DONNÉES RÉELLES
  // -------------------------------------------------------------------------
  // 1 observation  = 20 % de données réelles
  // 3 observations = 60 %
  // 5+ observations = 100 %
  //
  // Les skips comptent comme de vraies observations : ils peuvent donc
  // remettre plus rapidement en cause une présomption initiale trop optimiste.
  const evidenceConfidence = clamp(rows.length / 5, 0, 1);

  let masteryScore = round2(
    baselineMastery * (1 - evidenceConfidence) +
      observedMastery * evidenceConfidence,
  );
  masteryScore = clamp(masteryScore, 0, 100);

  // Les confiances sont distinctes du score lui-même.
  // Un bon score avec seulement une observation reste donc explicitement fragile.
  const masteryConfidence = round2(
    clamp(rows.length / 6, 0, 1) * 100,
  );

  const performanceConfidence = round2(
    computePerformanceConfidence(completed, trackingModes),
  );

  const overallConfidence = round2(
    clamp(
      masteryConfidence * 0.55 +
        performanceConfidence * 0.45,
      0,
      100,
    ),
  );

  // -------------------------------------------------------------------------
  // D. FATIGUE / RÉCUPÉRATION : PRIORITAIRE SUR LE NIVEAU
  // -------------------------------------------------------------------------
  const lastTwoRpe = recentRpe.slice(0, 2);
  const recentThreeRows = rows.slice(0, 3);
  const recentSkipped = recentThreeRows.filter(
    (x: any) => x.status === "skipped",
  ).length;

  const recover =
    (lastRpe != null && lastRpe >= 9) ||
    (lastTwoRpe.length === 2 && average(lastTwoRpe) > 8.5) ||
    recentSkipped >= 2;

  // -------------------------------------------------------------------------
  // E. ÉTAT DU MOUVEMENT
  // -------------------------------------------------------------------------
  // Avec peu de données, on respecte la présomption initiale.
  // Un Intermédiaire/Avancé ne passe donc plus automatiquement en LEARN
  // simplement parce qu'il réalise un mouvement pour la première fois.
  //
  // Après plusieurs observations, les données réelles peuvent faire monter
  // ou descendre le niveau estimé.
  let state: ProgressState;

  if (recover) {
    state = "RECOVER";
  } else if (rows.length < 3) {
    const clearlyDifficult =
      masteryScore < 35 ||
      recentSkipped >= 1 ||
      (lastRpe != null && lastRpe >= 8.5);

    if (baselineMastery < 40 || clearlyDifficult) state = "LEARN";
    else state = "MAINTAIN";
  } else if (masteryScore < 40) {
    state = "LEARN";
  } else if (masteryScore < 70) {
    state = "MAINTAIN";
  } else {
    state = "PROGRESS";
  }

  // -------------------------------------------------------------------------
  // F. RECOMMANDATION DE PROGRESSION
  // -------------------------------------------------------------------------
  // La présomption de niveau seule ne suffit JAMAIS à recommander une
  // progression. Il faut des exécutions réelles, une maîtrise suffisante,
  // une performance qui ne se dégrade pas et un RPE compatible.
  const hasProgression = (progressions ?? []).length > 0;

  const enoughEvidenceForPossible = completed.length >= 3;
  const enoughEvidenceForRecommended = completed.length >= 5;

  const rpeAllowsProgress =
    avgRpe == null ||
    avgRpe <= 8;

  const performanceAllowsProgress =
    performanceTrend >= -0.15;

  let recommendation: ProgressRecommendation;

  if (state === "RECOVER") {
    recommendation = "RECOVER";
  } else if (state === "LEARN") {
    recommendation = "LEARN";
  } else if (
    masteryScore >= 85 &&
    hasProgression &&
    enoughEvidenceForRecommended &&
    rpeAllowsProgress &&
    performanceAllowsProgress
  ) {
    recommendation = "PROGRESS_RECOMMENDED";
  } else if (
    masteryScore >= 70 &&
    hasProgression &&
    enoughEvidenceForPossible &&
    rpeAllowsProgress &&
    performanceAllowsProgress
  ) {
    recommendation = "PROGRESS_POSSIBLE";
  } else {
    recommendation = "MAINTAIN";
  }

  return {
    exercise_id: exerciseId,
    exposure_count: rows.length,
    completed_count: completed.length,
    skipped_count: skipped.length,
    rpe_count: rpeRows.length,
    avg_rpe: avgRpe == null ? null : round2(avgRpe),
    last_rpe: lastRpe,
    recent_rpe: recentRpe,
    rpe_trend: rpeTrend,
    adherence_score: round2(adherenceNormalized),
    performance_trend: round3(performanceTrend),
    consistency_score: round2(consistencyNormalized),
    mastery_score: round2(masteryScore),

    performance_score: performanceSummary.score,
    performance_confidence: performanceConfidence,
    mastery_confidence: masteryConfidence,
    overall_confidence: overallConfidence,
    best_performance_json: performanceSummary.best,
    current_performance_json: performanceSummary.current,
    performance_delta: performanceSummary.delta,
    last_observed_at: rows[0]?.created_at ?? null,

    state,
    recommendation,
    last_performance_at: rows[0]?.created_at ?? null,
  };
}

function scoreRpe(avgRpe: number | null): number {
  if (avgRpe == null) return 8;
  if (avgRpe <= 6.5) return 20;
  if (avgRpe <= 7) return 17;
  if (avgRpe <= 7.5) return 14;
  if (avgRpe <= 8) return 10;
  if (avgRpe <= 8.5) return 6;
  return 2;
}

function computeAdherence(log: any): number | null {
  const p = log.prescription_json ?? {};
  const scores: number[] = [];

  if (typeof p.reps_min === "number" && typeof log.reps_completed === "number") {
    scores.push(clamp(log.reps_completed / Math.max(1, p.reps_min), 0, 1));
  }
  if (
    typeof p.duration_seconds_min === "number" &&
    typeof log.duration_seconds === "number"
  ) {
    scores.push(
      clamp(log.duration_seconds / Math.max(1, p.duration_seconds_min), 0, 1),
    );
  }
  if (
    typeof p.distance_meters_min === "number" &&
    typeof log.distance_meters === "number"
  ) {
    scores.push(
      clamp(log.distance_meters / Math.max(1, p.distance_meters_min), 0, 1),
    );
  }
  if (typeof p.target_rpe_max === "number" && typeof log.rpe === "number") {
    scores.push(
      log.rpe <= p.target_rpe_max
        ? 1
        : clamp(1 - (log.rpe - p.target_rpe_max) * 0.25, 0, 1),
    );
  }

  return scores.length > 0 ? average(scores) : null;
}

function computePerformanceTrend(logs: any[], trackingModes: string[]): number {
  const values = logs
    .slice(0, 6)
    .map((log: any) => primaryPerformanceValue(log, trackingModes))
    .filter((x: number | null): x is number => x != null && Number.isFinite(x));

  if (values.length < 4) return 0;

  // logs = récent -> ancien.
  const recent = average(values.slice(0, 2));
  const older = average(values.slice(2, 4));
  if (older <= 0) return 0;

  // +15% ou plus = +1 ; -15% ou moins = -1.
  return clamp((recent / older - 1) / 0.15, -1, 1);
}

function primaryPerformanceValue(log: any, modes: string[]): number | null {
  const has = (mode: string) => modes.includes(mode);

  if (
    has("load") &&
    has("reps") &&
    typeof log.weight_kg === "number" &&
    typeof log.reps_completed === "number"
  ) {
    // Indice de force estimé inspiré d'Epley.
    // Plus pertinent que "charge x reps", qui confond facilement volume
    // d'entraînement et progression de force.
    //
    // On plafonne les reps à 15 : au-delà, l'estimation de force devient
    // beaucoup moins représentative.
    const reps = clamp(log.reps_completed, 1, 15);
    return log.weight_kg * (1 + reps / 30);
  }

  if (has("reps") && typeof log.reps_completed === "number") {
    return log.reps_completed;
  }

  if (
    has("distance") &&
    has("time") &&
    typeof log.distance_meters === "number" &&
    typeof log.duration_seconds === "number" &&
    log.duration_seconds > 0
  ) {
    return log.distance_meters / log.duration_seconds;
  }

  if (has("time") && typeof log.duration_seconds === "number") {
    return log.duration_seconds;
  }

  if (has("distance") && typeof log.distance_meters === "number") {
    return log.distance_meters;
  }

  if (has("load") && typeof log.weight_kg === "number") {
    return log.weight_kg;
  }

  return null;
}


// ============================================================================
// PERFORMANCE V3 — MESURE, SCORE ET CONFIANCE
// ============================================================================

function computePerformanceSummary(
  completed: any[],
  trackingModes: string[],
  adherenceNormalized: number,
  rpeTrend: number,
): {
  score: number | null;
  best: Record<string, unknown> | null;
  current: Record<string, unknown> | null;
  delta: number | null;
} {
  const measurable = completed
    .map((log: any) => {
      const value = primaryPerformanceValue(log, trackingModes);
      if (value == null || !Number.isFinite(value)) return null;

      return {
        value,
        log,
      };
    })
    .filter(
      (
        item: { value: number; log: any } | null,
      ): item is { value: number; log: any } => item != null,
    );

  if (measurable.length === 0) {
    return {
      score: null,
      best: null,
      current: null,
      delta: null,
    };
  }

  // Les logs arrivent du plus récent au plus ancien.
  const currentRows = measurable.slice(0, Math.min(3, measurable.length));
  const currentValue = average(currentRows.map((x) => x.value));

  // Toutes les métriques produites par primaryPerformanceValue sont orientées
  // "plus haut = meilleure performance".
  const bestRow = measurable.reduce((best, row) =>
    row.value > best.value ? row : best
  );

  const oldestRows = measurable.slice(-Math.min(3, measurable.length));
  const baselineValue = average(oldestRows.map((x) => x.value));

  const delta =
    baselineValue > 0
      ? round3(currentValue / baselineValue - 1)
      : null;

  // Ce score représente la qualité de la performance PERSONNELLE observée,
  // pas un percentile contre la population.
  //
  // 50 = stable par rapport à son historique personnel.
  // La tendance, l'adhérence et l'évolution du RPE déplacent ce niveau.
  const trendSignal =
    delta == null
      ? 0
      : clamp(delta / 0.20, -1, 1);

  const adherenceSignal =
    clamp((adherenceNormalized - 70) / 30, -1, 1);

  const rpeSignal =
    clamp(rpeTrend / 2, -1, 1);

  const score = round2(
    clamp(
      50 +
        trendSignal * 25 +
        adherenceSignal * 15 +
        rpeSignal * 10,
      0,
      100,
    ),
  );

  return {
    score,
    best: serializePerformance(bestRow.log, bestRow.value, trackingModes),
    current: serializePerformance(
      currentRows[0].log,
      currentValue,
      trackingModes,
    ),
    delta,
  };
}

function computePerformanceConfidence(
  completed: any[],
  trackingModes: string[],
): number {
  const measurable = completed.filter((log: any) => {
    const value = primaryPerformanceValue(log, trackingModes);
    return value != null && Number.isFinite(value);
  });

  if (measurable.length === 0) return 0;

  // 6 mesures exploitables donnent la confiance maximale de la V1.
  const quantity = clamp(measurable.length / 6, 0, 1);

  // Bonus si les observations couvrent plusieurs dates plutôt qu'une seule saisie.
  const uniqueDays = new Set(
    measurable.map((log: any) =>
      String(log.created_at ?? "").slice(0, 10)
    ),
  ).size;
  const spread = clamp(uniqueDays / 4, 0, 1);

  return clamp((quantity * 0.75 + spread * 0.25) * 100, 0, 100);
}

function serializePerformance(
  log: any,
  normalizedValue: number,
  trackingModes: string[],
): Record<string, unknown> {
  return {
    tracking_modes: trackingModes,
    normalized_value: round3(normalizedValue),
    reps_completed:
      typeof log?.reps_completed === "number"
        ? log.reps_completed
        : null,
    weight_kg:
      typeof log?.weight_kg === "number"
        ? log.weight_kg
        : null,
    duration_seconds:
      typeof log?.duration_seconds === "number"
        ? log.duration_seconds
        : null,
    distance_meters:
      typeof log?.distance_meters === "number"
        ? log.distance_meters
        : null,
    observed_at: log?.created_at ?? null,
  };
}

// ============================================================================
// PROFIL ATHLÉTIQUE V3
// ============================================================================

async function recomputeAthleticProfile(
  supabase: any,
  userId: string,
  now: string,
): Promise<AthleticProfileSnapshot[]> {
  const [
    { data: progressRows, error: progressError },
    { data: baselines, error: baselineError },
  ] = await Promise.all([
    supabase
      .from("user_exercise_progress")
      .select(
        "exercise_id, mastery_score, performance_score, adherence_score, consistency_score, overall_confidence, performance_delta, exposure_count, updated_at",
      )
      .eq("user_id", userId),
    supabase
      .from("user_athletic_baseline")
      .select("dimension, self_rating")
      .eq("user_id", userId),
  ]);

  if (progressError) throw new Error(progressError.message);
  if (baselineError) throw new Error(baselineError.message);

  const progress = progressRows ?? [];
  const exerciseIds = progress.map((row: any) => row.exercise_id);

  let exerciseRows: any[] = [];
  if (exerciseIds.length > 0) {
    const { data, error } = await supabase
      .from("exercises")
      .select("id, training_focus")
      .in("id", exerciseIds);

    if (error) throw new Error(error.message);
    exerciseRows = data ?? [];
  }

  const focusByExercise = new Map<string, AthleticDimension | null>(
    exerciseRows.map((exercise: any) => [
      exercise.id,
      normalizeAthleticDimension(exercise.training_focus),
    ]),
  );

  const baselineByDimension = new Map<string, number>(
    (baselines ?? []).map((row: any) => [
      String(row.dimension),
      Number(row.self_rating),
    ]),
  );

  const dimensions: AthleticDimension[] = [
    "strength",
    "conditioning",
    "power",
    "stability",
    "mobility",
  ];

  const snapshots: AthleticProfileSnapshot[] = [];

  for (const dimension of dimensions) {
    const matching = progress.filter(
      (row: any) => focusByExercise.get(row.exercise_id) === dimension,
    );

    const observed = computeAthleticDimensionObserved(matching);

    // Auto-évaluation uniquement pour les dimensions compatibles.
    // 1..5 -> 20..100. Confiance volontairement faible (20).
    const baselineRating =
      baselineByDimension.get(dimension) ?? null;
    const baselineScore =
      baselineRating != null
        ? clamp(baselineRating * 20, 0, 100)
        : null;
    const baselineConfidence =
      baselineScore != null ? 20 : 0;

    let score: number | null = observed.score;
    let confidence = observed.confidence;

    if (baselineScore != null) {
      if (observed.score == null || observed.confidence <= 0) {
        score = baselineScore;
        confidence = baselineConfidence;
      } else {
        // Le prior disparaît progressivement : à 100 % de confiance observée,
        // son influence devient nulle.
        const observedWeight =
          clamp(observed.confidence / 100, 0, 1);
        const baselineWeight =
          (1 - observedWeight) * 0.35;

        score = round2(
          (observed.score * observedWeight +
            baselineScore * baselineWeight) /
            Math.max(0.0001, observedWeight + baselineWeight),
        );

        confidence = round2(
          clamp(
            observed.confidence +
              baselineConfidence * (1 - observedWeight),
            0,
            100,
          ),
        );
      }
    }

    const snapshot: AthleticProfileSnapshot = {
      dimension,
      score,
      confidence,
      trend: observed.trend,
      sample_count: matching.length,
      source_breakdown: {
        observed_exercises: matching.length,
        baseline_used: baselineScore != null,
        baseline_score: baselineScore,
        observed_score: observed.score,
        observed_confidence: observed.confidence,
      },
      explanation_json: {
        top_contributors: observed.topContributors,
        meaning:
          "Score UGEROD personnel dérivé des mouvements observés; ce n'est pas un percentile population.",
      },
    };

    snapshots.push(snapshot);

    const { error: upsertError } = await supabase
      .from("user_athletic_profile")
      .upsert(
        {
          user_id: userId,
          dimension,
          score: snapshot.score,
          confidence: snapshot.confidence,
          trend: snapshot.trend,
          sample_count: snapshot.sample_count,
          source_breakdown: snapshot.source_breakdown,
          explanation_json: snapshot.explanation_json,
          calculated_at: now,
          updated_at: now,
        },
        { onConflict: "user_id,dimension" },
      );

    if (upsertError) throw new Error(upsertError.message);

    const { error: historyError } = await supabase
      .from("user_athletic_profile_history")
      .insert({
        user_id: userId,
        dimension,
        score: snapshot.score,
        confidence: snapshot.confidence,
        trend: snapshot.trend,
        sample_count: snapshot.sample_count,
        source_breakdown: snapshot.source_breakdown,
        recorded_at: now,
      });

    if (historyError) throw new Error(historyError.message);
  }

  return snapshots;
}

function computeAthleticDimensionObserved(rows: any[]): {
  score: number | null;
  confidence: number;
  trend: number;
  topContributors: Array<Record<string, unknown>>;
} {
  if (rows.length === 0) {
    return {
      score: null,
      confidence: 0,
      trend: 0,
      topContributors: [],
    };
  }

  const contributors = rows
    .map((row: any) => {
      const mastery =
        typeof row.mastery_score === "number"
          ? Number(row.mastery_score)
          : 50;

      const performance =
        typeof row.performance_score === "number"
          ? Number(row.performance_score)
          : 50;

      const adherence =
        typeof row.adherence_score === "number"
          ? Number(row.adherence_score)
          : 50;

      const consistency =
        typeof row.consistency_score === "number"
          ? Number(row.consistency_score)
          : 50;

      const confidence =
        clamp(Number(row.overall_confidence ?? 0), 0, 100);

      // Une qualité physique est construite à partir de plusieurs facettes.
      // La performance pèse le plus, mais la maîtrise et la répétabilité
      // empêchent qu'une seule performance isolée fasse exploser le score.
      const movementScore = clamp(
        performance * 0.40 +
          mastery * 0.35 +
          adherence * 0.15 +
          consistency * 0.10,
        0,
        100,
      );

      const recencyWeight =
        computeRecencyWeight(row.updated_at);

      const weight =
        Math.max(0.05, confidence / 100) *
        recencyWeight;

      return {
        exercise_id: row.exercise_id,
        movement_score: round2(movementScore),
        confidence: round2(confidence),
        performance_delta:
          typeof row.performance_delta === "number"
            ? Number(row.performance_delta)
            : 0,
        weight,
      };
    })
    .filter((x: any) => x.weight > 0);

  if (contributors.length === 0) {
    return {
      score: null,
      confidence: 0,
      trend: 0,
      topContributors: [],
    };
  }

  const weightSum = contributors.reduce(
    (sum: number, x: any) => sum + x.weight,
    0,
  );

  const score = round2(
    contributors.reduce(
      (sum: number, x: any) =>
        sum + x.movement_score * x.weight,
      0,
    ) / Math.max(0.0001, weightSum),
  );

  const trend = round3(
    contributors.reduce(
      (sum: number, x: any) =>
        sum + x.performance_delta * x.weight,
      0,
    ) / Math.max(0.0001, weightSum),
  );

  // La confiance du profil exige à la fois des mouvements fiables
  // et un minimum de diversité dans la dimension.
  const avgMovementConfidence =
    contributors.reduce(
      (sum: number, x: any) =>
        sum + x.confidence * x.weight,
      0,
    ) / Math.max(0.0001, weightSum);

  const diversityFactor =
    clamp(contributors.length / 4, 0, 1);

  const confidence = round2(
    clamp(
      avgMovementConfidence *
        (0.65 + diversityFactor * 0.35),
      0,
      100,
    ),
  );

  const topContributors = [...contributors]
    .sort((a: any, b: any) => b.weight - a.weight)
    .slice(0, 4)
    .map((x: any) => ({
      exercise_id: x.exercise_id,
      movement_score: x.movement_score,
      confidence: x.confidence,
      performance_delta: round3(x.performance_delta),
    }));

  return {
    score,
    confidence,
    trend,
    topContributors,
  };
}

function normalizeAthleticDimension(
  value: unknown,
): AthleticDimension | null {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();

  if (normalized === "strength") return "strength";
  if (normalized === "conditioning") return "conditioning";
  if (normalized === "power") return "power";
  if (normalized === "stability") return "stability";
  if (normalized === "mobility") return "mobility";

  return null;
}

function computeRecencyWeight(updatedAt: unknown): number {
  const timestamp = new Date(String(updatedAt ?? "")).getTime();
  if (!Number.isFinite(timestamp)) return 0.7;

  const ageDays =
    Math.max(0, Date.now() - timestamp) /
    (1000 * 60 * 60 * 24);

  if (ageDays <= 14) return 1;
  if (ageDays <= 30) return 0.9;
  if (ageDays <= 60) return 0.75;
  if (ageDays <= 120) return 0.6;
  return 0.45;
}

function extractReadinessScore(
  generatedWorkout: unknown,
): number | null {
  if (
    !generatedWorkout ||
    typeof generatedWorkout !== "object"
  ) {
    return null;
  }

  const meta = (generatedWorkout as {
    meta?: Record<string, unknown>;
  }).meta;

  const value = meta?.readiness_score;

  return typeof value === "number"
    ? clamp(value, 1, 10)
    : null;
}

// ============================================================================
// NIVEAU INITIAL / PRIOR UTILISATEUR
// ============================================================================

function getInitialMasteryScore(
  experience: Experience,
  technicalComplexity: number,
): number {
  const complexity = clamp(Math.round(technicalComplexity), 1, 5);

  // Traduction numérique de la matrice coach :
  //
  // Débutant :
  //   complexité 1 -> familier
  //   complexité 2+ -> apprentissage
  //
  // Intermédiaire :
  //   1 -> maîtrisé
  //   2 -> acquis
  //   3 -> familier
  //   4-5 -> apprentissage
  //
  // Avancé :
  //   1-2 -> maîtrisé
  //   3 -> acquis
  //   4 -> familier
  //   5 -> apprentissage
  const beginner: Record<number, number> = {
    1: 50,
    2: 35,
    3: 30,
    4: 25,
    5: 20,
  };

  const intermediate: Record<number, number> = {
    1: 85,
    2: 75,
    3: 55,
    4: 35,
    5: 30,
  };

  const advanced: Record<number, number> = {
    1: 90,
    2: 85,
    3: 75,
    4: 55,
    5: 35,
  };

  if (experience === "Débutant") return beginner[complexity];
  if (experience === "Avancé") return advanced[complexity];
  return intermediate[complexity];
}

function normalizeExperience(value: unknown): Experience {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  if (normalized.includes("debut")) return "Débutant";
  if (normalized.includes("avance")) return "Avancé";
  return "Intermédiaire";
}

// ============================================================================
// VALIDATION / HELPERS
// ============================================================================

function validateResult(item: ExerciseResult) {
  if (!item.exercise_id) throw new Error("exercise_id requis.");
  if (item.rpe != null && (item.rpe < 1 || item.rpe > 10)) {
    throw new Error(`RPE invalide pour ${item.exercise_id}.`);
  }

  for (const [key, value] of Object.entries({
    reps_completed: item.reps_completed,
    weight_kg: item.weight_kg,
    duration_seconds: item.duration_seconds,
    distance_meters: item.distance_meters,
  })) {
    if (value != null && value < 0) {
      throw new Error(`${key} ne peut pas être négatif.`);
    }
  }
}

function average(values: number[]): number {
  return values.reduce((sum, x) => sum + x, 0) / values.length;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}