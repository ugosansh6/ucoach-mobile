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
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const VERSION = "coach-handler-v1.0";
const MAX_CANDIDATE_ATTEMPTS = 3;

type Focus =
  | "Strength"
  | "Muscle Gain"
  | "Fat Loss"
  | "Conditioning"
  | "Skill"
  | "General Fitness";

type TargetRegion = "Full Body" | "Lower" | "Upper" | "Core";

type RequestPayload = {
  duration_minutes?: number;
  readiness?: number | string;
  available_equipment?: string[];
  injured_zones?: string[];
  target_region?: TargetRegion | null;
  format_preference?: string | null;
  focus_override?: Focus | null;
  excluded_exercise_ids?: string[];
  excluded_patterns?: string[];
};

type GeneratedExercise = {
  id: string;
  name: string;
  pattern?: string | null;
  region?: string | null;
  prescription?: string | null;
  prescription_json?: Record<string, unknown> | null;
  instructions?: string | null;
  tips?: string | null;
  tracking_modes?: string[];
};

type GeneratedBlock = {
  block_key: "warmup" | "tabata" | "skill" | "wod" | string;
  block_name?: string;
  duration_minutes?: number;
  objective?: string;
  structure?: string;
  rounds?: number | null;
  work_seconds?: number | null;
  rest_seconds?: number | null;
  rotation_mode?: string | null;
  exercises?: GeneratedExercise[];
};

type BaseWorkout = {
  session_id: string;
  status?: string;
  version?: string;
  meta?: Record<string, any>;
  blocks?: GeneratedBlock[];
  error?: string;
};

type ExerciseMeta = {
  id: string;
  body_region: string | null;
  movement_pattern: string | null;
  exercise_family: string | null;
  training_focus: string | null;
  fatigue_score: number | null;
  joint_impact: number | null;
  technical_complexity: number | null;
  equipment_requirement: string | null;
  warmup_eligible: boolean | null;
  warmup_role: string | null;
  warmup_intensity: number | null;
  warmup_only: boolean | null;
};

type CandidateAudit = {
  painViolations: string[];
  warmupViolations: string[];
  conditioningReasons: string[];
  conditioningExcludedId: string | null;
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  let currentSessionId: string | null = null;

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse({ error: "Missing Authorization header" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");

    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error("Missing Supabase environment variables.");
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: {
          Authorization: authHeader,
        },
      },
    });

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const originalPayload = (await req.json()) as RequestPayload;
    let candidatePayload: RequestPayload = {
      ...originalPayload,
      excluded_exercise_ids: uniqueStrings(
        originalPayload.excluded_exercise_ids ?? [],
      ),
    };

    const rejectionHistory: Array<{
      attempt: number;
      reasons: string[];
    }> = [];

    let accepted: BaseWorkout | null = null;
    let acceptedAudit: CandidateAudit | null = null;
    let coachRegionOverride = false;

    for (let attempt = 1; attempt <= MAX_CANDIDATE_ATTEMPTS; attempt++) {
      const candidate = await invokeBaseGenerator({
        supabaseUrl,
        supabaseAnonKey,
        authHeader,
        payload: candidatePayload,
      });

      currentSessionId = candidate.session_id;

      const audit = await auditCandidate({
        supabase,
        candidate,
        injuredZones: originalPayload.injured_zones ?? [],
        focus: (originalPayload.focus_override ?? "General Fitness") as Focus,
        automaticRegionRequest: originalPayload.target_region == null,
      });

      const rejectionReasons = [
        ...audit.painViolations.map((id) => `PAIN_GATE:${id}`),
        ...audit.warmupViolations.map((id) => `WARMUP_GATE:${id}`),
        ...audit.conditioningReasons,
      ];

      if (rejectionReasons.length === 0) {
        accepted = candidate;
        acceptedAudit = audit;
        break;
      }

      rejectionHistory.push({ attempt, reasons: rejectionReasons });
      await cleanupGeneratedSession(supabase, candidate.session_id, user.id);
      currentSessionId = null;

      const excluded = new Set(
        uniqueStrings(candidatePayload.excluded_exercise_ids ?? []),
      );

      for (const exerciseId of audit.painViolations) {
        excluded.add(exerciseId);
      }

      for (const exerciseId of audit.warmupViolations) {
        excluded.add(exerciseId);
      }

      if (audit.conditioningExcludedId) {
        excluded.add(audit.conditioningExcludedId);
      }

      candidatePayload = {
        ...candidatePayload,
        excluded_exercise_ids: Array.from(excluded),
      };

      // Si UGEROD avait choisi automatiquement une région trop locale pour un
      // objectif Conditioning/Fat Loss, le prochain candidat est élargi à Full Body.
      // Une préférence explicite de l'utilisateur n'est jamais écrasée ici.
      if (
        originalPayload.target_region == null &&
        audit.conditioningReasons.length > 0 &&
        ["Conditioning", "Fat Loss"].includes(
          String(originalPayload.focus_override ?? "General Fitness"),
        )
      ) {
        candidatePayload.target_region = "Full Body";
        coachRegionOverride = true;
      }
    }

    if (!accepted || !acceptedAudit) {
      throw new Error(
        "Impossible de construire une séance suffisamment sûre et cohérente avec les contraintes du jour.",
      );
    }

    const finalWorkout = await applyCoachPostProcessing({
      supabase,
      userId: user.id,
      candidate: accepted,
      focus: (originalPayload.focus_override ?? "General Fitness") as Focus,
      rejectionHistory,
      coachRegionOverride,
    });

    currentSessionId = null;

    return jsonResponse(
      {
        session_id: accepted.session_id,
        status: "generated",
        ...finalWorkout,
      },
      200,
    );
  } catch (error) {
    console.error(VERSION, error);

    return jsonResponse(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unknown coach generation error",
      },
      400,
    );
  }
});

async function invokeBaseGenerator(args: {
  supabaseUrl: string;
  supabaseAnonKey: string;
  authHeader: string;
  payload: RequestPayload;
}): Promise<BaseWorkout> {
  const response = await fetch(
    `${args.supabaseUrl}/functions/v1/bright-handler`,
    {
      method: "POST",
      headers: {
        Authorization: args.authHeader,
        apikey: args.supabaseAnonKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(args.payload),
    },
  );

  const text = await response.text();
  let data: BaseWorkout | null = null;

  try {
    data = JSON.parse(text) as BaseWorkout;
  } catch {
    data = null;
  }

  if (!response.ok || !data || data.error) {
    throw new Error(
      data?.error ??
        `Le générateur de base a échoué (${response.status}).`,
    );
  }

  if (!data.session_id || !Array.isArray(data.blocks)) {
    throw new Error("Le générateur de base a retourné une séance incomplète.");
  }

  return data;
}

async function auditCandidate(args: {
  supabase: any;
  candidate: BaseWorkout;
  injuredZones: string[];
  focus: Focus;
  automaticRegionRequest: boolean;
}): Promise<CandidateAudit> {
  const blocks = args.candidate.blocks ?? [];
  const allExercises = blocks.flatMap((block) => block.exercises ?? []);
  const ids = uniqueStrings(allExercises.map((exercise) => exercise.id));

  const metaById = await loadExerciseMeta(args.supabase, ids);

  const painViolations = await findPainViolations({
    supabase: args.supabase,
    ids,
    injuredZones: args.injuredZones,
  });

  const warmup =
    blocks.find((block) => block.block_key === "warmup")?.exercises ?? [];

  const warmupViolations = warmup
    .filter((exercise) => {
      const meta = metaById.get(exercise.id);
      if (!meta) return true;
      if (meta.warmup_eligible !== true) return true;
      if (!meta.warmup_role) return true;
      if ((meta.warmup_intensity ?? 99) > 2) return true;
      if ((meta.fatigue_score ?? 99) > 2) return true;
      if ((meta.joint_impact ?? 99) > 2) return true;
      return false;
    })
    .map((exercise) => exercise.id);

  const conditioning = await auditConditioningWod({
    supabase: args.supabase,
    candidate: args.candidate,
    metaById,
    focus: args.focus,
    automaticRegionRequest: args.automaticRegionRequest,
  });

  return {
    painViolations,
    warmupViolations,
    conditioningReasons: conditioning.reasons,
    conditioningExcludedId: conditioning.excludedId,
  };
}

async function loadExerciseMeta(
  supabase: any,
  ids: string[],
): Promise<Map<string, ExerciseMeta>> {
  if (ids.length === 0) return new Map();

  const { data, error } = await supabase
    .from("exercises")
    .select(
      "id, body_region, movement_pattern, exercise_family, training_focus, fatigue_score, joint_impact, technical_complexity, equipment_requirement, warmup_eligible, warmup_role, warmup_intensity, warmup_only",
    )
    .in("id", ids);

  if (error) throw new Error(error.message);

  return new Map(
    (data ?? []).map((exercise: ExerciseMeta) => [exercise.id, exercise]),
  );
}

async function findPainViolations(args: {
  supabase: any;
  ids: string[];
  injuredZones: string[];
}): Promise<string[]> {
  const normalizedZones = uniqueStrings(
    args.injuredZones.map(toConstraintZone).filter(Boolean),
  );

  if (args.ids.length === 0 || normalizedZones.length === 0) {
    return [];
  }

  const { data, error } = await args.supabase
    .from("exercise_constraints")
    .select("exercise_id, body_zone, rule_type")
    .in("exercise_id", args.ids)
    .in("body_zone", normalizedZones)
    .eq("rule_type", "avoid");

  if (error) throw new Error(error.message);

  return uniqueStrings((data ?? []).map((row: any) => row.exercise_id));
}

async function auditConditioningWod(args: {
  supabase: any;
  candidate: BaseWorkout;
  metaById: Map<string, ExerciseMeta>;
  focus: Focus;
  automaticRegionRequest: boolean;
}): Promise<{ reasons: string[]; excludedId: string | null }> {
  if (!["Conditioning", "Fat Loss"].includes(args.focus)) {
    return { reasons: [], excludedId: null };
  }

  const wod =
    (args.candidate.blocks ?? []).find((block) => block.block_key === "wod")
      ?.exercises ?? [];

  if (wod.length < 4) {
    return { reasons: [], excludedId: null };
  }

  const reasons: string[] = [];
  const regionCounts = new Map<string, number>();
  let hasConditioningAnchor = false;

  for (const exercise of wod) {
    const meta = args.metaById.get(exercise.id);
    if (!meta) continue;

    const region = meta.body_region ?? "unknown";
    regionCounts.set(region, (regionCounts.get(region) ?? 0) + 1);

    if (
      ["Conditioning", "Locomotion"].includes(meta.movement_pattern ?? "") ||
      ["Conditioning", "Locomotion"].includes(meta.exercise_family ?? "")
    ) {
      hasConditioningAnchor = true;
    }
  }

  const primaryMuscleByExercise = await loadPrimaryLocalMuscles(
    args.supabase,
    wod.map((exercise) => exercise.id),
  );

  const primaryMuscleCounts = new Map<string, number>();
  for (const exercise of wod) {
    for (const muscleId of primaryMuscleByExercise.get(exercise.id) ?? []) {
      primaryMuscleCounts.set(
        muscleId,
        (primaryMuscleCounts.get(muscleId) ?? 0) + 1,
      );
    }
  }

  const maxRegionCount = Math.max(0, ...Array.from(regionCounts.values()));
  const maxPrimaryMuscleCount = Math.max(
    0,
    ...Array.from(primaryMuscleCounts.values()),
  );

  if (
    args.automaticRegionRequest &&
    maxRegionCount === wod.length &&
    !hasConditioningAnchor
  ) {
    reasons.push("CONDITIONING_TOO_LOCAL");
  }

  if (maxPrimaryMuscleCount >= 3) {
    reasons.push("CONDITIONING_LOCAL_FATIGUE_REDUNDANCY");
  }

  let excludedId: string | null = null;

  if (reasons.length > 0) {
    let mostRedundantMuscle: string | null = null;
    let mostRedundantCount = 0;

    for (const [muscleId, count] of primaryMuscleCounts.entries()) {
      if (count > mostRedundantCount) {
        mostRedundantMuscle = muscleId;
        mostRedundantCount = count;
      }
    }

    const candidates = wod
      .filter((exercise) => {
        if (!mostRedundantMuscle) return true;
        return (primaryMuscleByExercise.get(exercise.id) ?? []).includes(
          mostRedundantMuscle,
        );
      })
      .sort((a, b) => {
        const fatigueA = args.metaById.get(a.id)?.fatigue_score ?? 0;
        const fatigueB = args.metaById.get(b.id)?.fatigue_score ?? 0;
        return fatigueB - fatigueA;
      });

    excludedId = candidates[0]?.id ?? wod[wod.length - 1]?.id ?? null;
  }

  return { reasons, excludedId };
}

async function loadPrimaryLocalMuscles(
  supabase: any,
  ids: string[],
): Promise<Map<string, string[]>> {
  if (ids.length === 0) return new Map();

  const { data, error } = await supabase
    .from("exercise_muscles")
    .select("exercise_id, muscle_id")
    .in("exercise_id", ids)
    .eq("priority", "primary")
    .not("muscle_id", "in", "(M15,M16)");

  if (error) throw new Error(error.message);

  const map = new Map<string, string[]>();
  for (const row of data ?? []) {
    const existing = map.get(row.exercise_id) ?? [];
    existing.push(row.muscle_id);
    map.set(row.exercise_id, existing);
  }

  return map;
}

async function applyCoachPostProcessing(args: {
  supabase: any;
  userId: string;
  candidate: BaseWorkout;
  focus: Focus;
  rejectionHistory: Array<{ attempt: number; reasons: string[] }>;
  coachRegionOverride: boolean;
}) {
  const blocks = structuredClone(args.candidate.blocks ?? []);
  const meta = structuredClone(args.candidate.meta ?? {});
  const baseVersion = args.candidate.version ?? null;

  const allIds = uniqueStrings(
    blocks.flatMap((block) => (block.exercises ?? []).map((exercise) => exercise.id)),
  );
  const metaById = await loadExerciseMeta(args.supabase, allIds);

  const warmupBlock = blocks.find((block) => block.block_key === "warmup");
  const skillBlock = blocks.find((block) => block.block_key === "skill");
  const wodBlock = blocks.find((block) => block.block_key === "wod");

  let warmupTrimmed = false;
  let warmupMinutesReleased = 0;

  if (warmupBlock && (warmupBlock.exercises ?? []).length > 4) {
    const originalExercises = warmupBlock.exercises ?? [];
    const targetPatterns = new Set(
      (wodBlock?.exercises ?? []).map((exercise) => exercise.pattern).filter(Boolean),
    );

    const selected = selectWarmupSubset({
      exercises: originalExercises,
      metaById,
      targetPatterns,
      focus: args.focus,
      count: 4,
    });

    const keptIds = new Set(selected.map((exercise) => exercise.id));
    const removedIds = originalExercises
      .filter((exercise) => !keptIds.has(exercise.id))
      .map((exercise) => exercise.id);

    warmupBlock.exercises = selected;
    warmupTrimmed = removedIds.length > 0;

    if (removedIds.length > 0) {
      const { error: deleteError } = await args.supabase
        .from("workout_session_exercises")
        .delete()
        .eq("session_id", args.candidate.session_id)
        .eq("block_key", "warm_up")
        .in("exercise_id", removedIds);

      if (deleteError) throw new Error(deleteError.message);

      for (let index = 0; index < selected.length; index++) {
        const { error: positionError } = await args.supabase
          .from("workout_session_exercises")
          .update({ position: index + 1 })
          .eq("session_id", args.candidate.session_id)
          .eq("block_key", "warm_up")
          .eq("exercise_id", selected[index].id);

        if (positionError) throw new Error(positionError.message);
      }
    }

    const originalDuration = Number(warmupBlock.duration_minutes ?? 0);
    const adjustedDuration = Math.min(originalDuration, 6);
    warmupMinutesReleased = Math.max(0, originalDuration - adjustedDuration);
    warmupBlock.duration_minutes = adjustedDuration;
    warmupBlock.structure = `1 passage fluide — ${selected.length} mouvements — environ ${adjustedDuration} min`;
  }

  let skillDurationAdjusted = false;
  let skillMinutesReleased = 0;

  if (skillBlock && (skillBlock.exercises ?? []).length > 0) {
    const originalDuration = Number(skillBlock.duration_minutes ?? 0);
    const skillPriority = meta?.session_architecture?.skill_priority ?? {};
    const priorityIds = new Set<string>([
      ...(skillPriority.priority_exercise_ids ?? []),
      ...(skillPriority.progression_target_ids ?? []),
    ]);

    const selectedSkill = (skillBlock.exercises ?? [])[0];
    const selectedMeta = selectedSkill ? metaById.get(selectedSkill.id) : null;
    const matchesPriority = selectedSkill ? priorityIds.has(selectedSkill.id) : false;

    let cap = originalDuration;

    if (["Conditioning", "Fat Loss"].includes(args.focus)) {
      cap = Math.min(cap, 10);
    }

    if (priorityIds.size > 0 && !matchesPriority) {
      cap = Math.min(cap, 10);
    }

    if (
      selectedMeta &&
      (selectedMeta.technical_complexity ?? 99) <= 1 &&
      (selectedMeta.fatigue_score ?? 99) <= 2 &&
      selectedMeta.equipment_requirement === "none"
    ) {
      cap = Math.min(cap, 8);
    }

    if (cap < originalDuration) {
      skillBlock.duration_minutes = cap;
      skillMinutesReleased = originalDuration - cap;
      skillDurationAdjusted = true;
    }
  }

  const releasedMinutes = warmupMinutesReleased + skillMinutesReleased;
  if (releasedMinutes > 0 && wodBlock) {
    wodBlock.duration_minutes =
      Number(wodBlock.duration_minutes ?? 0) + releasedMinutes;
    wodBlock.structure = updateDurationInStructure(
      wodBlock.structure ?? "",
      Number(wodBlock.duration_minutes ?? 0),
    );
  }

  if (meta.session_architecture) {
    meta.session_architecture.warmup_minutes = Number(
      warmupBlock?.duration_minutes ?? meta.session_architecture.warmup_minutes ?? 0,
    );
    meta.session_architecture.skill_minutes = Number(
      skillBlock?.duration_minutes ?? 0,
    );
    meta.session_architecture.wod_minutes = Number(
      wodBlock?.duration_minutes ?? meta.session_architecture.wod_minutes ?? 0,
    );
    meta.session_architecture.programmed_minutes =
      Number(meta.session_architecture.warmup_minutes ?? 0) +
      Number(meta.session_architecture.tabata_minutes ?? 0) +
      Number(meta.session_architecture.skill_minutes ?? 0) +
      Number(meta.session_architecture.wod_minutes ?? 0);
  }

  if (args.coachRegionOverride) {
    meta.target_region_source = "coach_balance_override_from_automatic_history";
  }

  meta.coach_gate = {
    version: VERSION,
    base_version: baseVersion,
    accepted_attempt: args.rejectionHistory.length + 1,
    rejected_candidates: args.rejectionHistory,
    pain_gate_verified: true,
    warmup_contract_verified: true,
    warmup_trimmed_to_max_four: warmupTrimmed,
    skill_duration_adjusted: skillDurationAdjusted,
    released_minutes_to_wod: releasedMinutes,
    conditioning_balance_verified: ["Conditioning", "Fat Loss"].includes(args.focus),
    region_override_for_conditioning: args.coachRegionOverride,
  };

  const storedWorkout = {
    version: VERSION,
    meta,
    blocks,
  };

  const { error: updateError } = await args.supabase
    .from("workout_sessions")
    .update({ generated_workout: storedWorkout })
    .eq("id", args.candidate.session_id)
    .eq("user_id", args.userId);

  if (updateError) throw new Error(updateError.message);

  return storedWorkout;
}

function selectWarmupSubset(args: {
  exercises: GeneratedExercise[];
  metaById: Map<string, ExerciseMeta>;
  targetPatterns: Set<string>;
  focus: Focus;
  count: number;
}): GeneratedExercise[] {
  const selected: GeneratedExercise[] = [];
  const used = new Set<string>();

  const take = (predicate: (exercise: GeneratedExercise, meta: ExerciseMeta) => boolean) => {
    const exercise = args.exercises.find((item) => {
      if (used.has(item.id)) return false;
      const meta = args.metaById.get(item.id);
      return meta ? predicate(item, meta) : false;
    });

    if (exercise && selected.length < args.count) {
      selected.push(exercise);
      used.add(exercise.id);
    }
  };

  // Ordre coach : mobilité → activation → préparation du pattern → montée en température.
  take((_exercise, meta) => meta.warmup_role === "mobility");
  take((_exercise, meta) => meta.warmup_role === "activation");
  take((exercise, meta) =>
    meta.warmup_role === "movement_prep" &&
    (!!exercise.pattern && args.targetPatterns.has(exercise.pattern)),
  );

  if (["Conditioning", "Fat Loss"].includes(args.focus)) {
    take((_exercise, meta) => meta.warmup_role === "pulse_raiser");
  }

  for (const exercise of args.exercises) {
    if (selected.length >= args.count) break;
    if (used.has(exercise.id)) continue;
    selected.push(exercise);
    used.add(exercise.id);
  }

  return selected;
}

async function cleanupGeneratedSession(
  supabase: any,
  sessionId: string,
  userId: string,
) {
  const { error: childrenError } = await supabase
    .from("workout_session_exercises")
    .delete()
    .eq("session_id", sessionId);

  if (childrenError) throw new Error(childrenError.message);

  const { error: sessionError } = await supabase
    .from("workout_sessions")
    .delete()
    .eq("id", sessionId)
    .eq("user_id", userId);

  if (sessionError) throw new Error(sessionError.message);
}

function updateDurationInStructure(structure: string, duration: number): string {
  if (!structure) return `WOD ${duration} min`;

  if (/\d+\s*min/i.test(structure)) {
    return structure.replace(/\d+\s*min/i, `${duration} min`);
  }

  return `${structure} — ${duration} min`;
}

function toConstraintZone(value: string): string {
  const normalized = normalizeText(value);
  const map: Record<string, string> = {
    poignet: "wrist",
    wrist: "wrist",
    coude: "elbow",
    elbow: "elbow",
    epaule: "shoulder",
    shoulder: "shoulder",
    genou: "knee",
    knee: "knee",
    "bas du dos": "lower_back",
    lombaires: "lower_back",
    lower_back: "lower_back",
  };

  return map[normalized] ?? normalized.replace(/\s+/g, "_");
}

function normalizeText(value: string): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => String(value).trim()).filter(Boolean)));
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}
