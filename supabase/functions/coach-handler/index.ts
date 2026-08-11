// @ts-ignore -- Deno/Supabase Edge Runtime
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-ignore -- Deno/Supabase Edge Runtime
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

declare const Deno: { env: { get(name: string): string | undefined } };

const VERSION = "coach-handler-v1.0";
const MAX_ATTEMPTS = 3;
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

type Payload = {
  duration_minutes?: number;
  readiness?: number | string;
  available_equipment?: string[];
  injured_zones?: string[];
  target_region?: "Full Body" | "Lower" | "Upper" | "Core" | null;
  format_preference?: string | null;
  focus_override?: string | null;
  excluded_exercise_ids?: string[];
  excluded_patterns?: string[];
};

type Workout = {
  session_id: string;
  status?: string;
  version?: string;
  meta?: Record<string, any>;
  blocks?: any[];
  error?: string;
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const auth = req.headers.get("Authorization");
    const url = Deno.env.get("SUPABASE_URL");
    const anon = Deno.env.get("SUPABASE_ANON_KEY");
    if (!auth) return json({ error: "Missing Authorization header" }, 401);
    if (!url || !anon) throw new Error("Missing Supabase environment variables.");

    const supabase = createClient(url, anon, {
      global: { headers: { Authorization: auth } },
    });
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData.user) return json({ error: "Unauthorized" }, 401);

    const userId = authData.user.id;
    const original = (await req.json()) as Payload;
    let payload: Payload = {
      ...original,
      excluded_exercise_ids: unique(original.excluded_exercise_ids ?? []),
    };
    const rejected: any[] = [];
    let regionOverride = false;
    let accepted: Workout | null = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const candidate = await callBase(url, anon, auth, payload);
      const audit = await auditCandidate(
        supabase,
        candidate,
        original.injured_zones ?? [],
        String(original.focus_override ?? "General Fitness"),
        original.target_region == null,
      );

      const reasons = [
        ...audit.pain.map((id: string) => `PAIN_GATE:${id}`),
        ...audit.warmup.map((id: string) => `WARMUP_GATE:${id}`),
        ...audit.conditioningReasons,
      ];

      if (reasons.length === 0) {
        accepted = candidate;
        break;
      }

      rejected.push({ attempt, reasons });
      await cleanup(supabase, candidate.session_id, userId);

      const excluded = new Set(payload.excluded_exercise_ids ?? []);
      [...audit.pain, ...audit.warmup].forEach((id: string) => excluded.add(id));
      if (audit.excludeForBalance) excluded.add(audit.excludeForBalance);
      payload = { ...payload, excluded_exercise_ids: Array.from(excluded) };

      if (
        original.target_region == null &&
        audit.conditioningReasons.length > 0 &&
        ["Conditioning", "Fat Loss"].includes(
          String(original.focus_override ?? "General Fitness"),
        )
      ) {
        payload.target_region = "Full Body";
        regionOverride = true;
      }
    }

    if (!accepted) {
      throw new Error(
        "Impossible de construire une séance suffisamment sûre et cohérente avec les contraintes du jour.",
      );
    }

    const finalWorkout = await postProcess(
      supabase,
      userId,
      accepted,
      String(original.focus_override ?? "General Fitness"),
      rejected,
      regionOverride,
    );

    return json(
      { session_id: accepted.session_id, status: "generated", ...finalWorkout },
      200,
    );
  } catch (error) {
    console.error(VERSION, error);
    return json(
      { error: error instanceof Error ? error.message : "Unknown coach error" },
      400,
    );
  }
});

async function callBase(
  url: string,
  anon: string,
  auth: string,
  payload: Payload,
): Promise<Workout> {
  const response = await fetch(`${url}/functions/v1/bright-handler`, {
    method: "POST",
    headers: {
      Authorization: auth,
      apikey: anon,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  let data: Workout | null = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = null;
  }
  if (!response.ok || !data || data.error) {
    throw new Error(data?.error ?? `bright-handler error ${response.status}`);
  }
  if (!data.session_id || !Array.isArray(data.blocks)) {
    throw new Error("bright-handler returned an incomplete session.");
  }
  return data;
}

async function auditCandidate(
  supabase: any,
  candidate: Workout,
  injuredZones: string[],
  focus: string,
  automaticRegion: boolean,
) {
  const blocks = candidate.blocks ?? [];
  const exercises = blocks.flatMap((block: any) => block.exercises ?? []);
  const ids = unique(exercises.map((e: any) => e.id));
  const meta = await loadMeta(supabase, ids);

  const zones = unique(injuredZones.map(toConstraintZone).filter(Boolean));
  let pain: string[] = [];
  if (ids.length && zones.length) {
    const { data, error } = await supabase
      .from("exercise_constraints")
      .select("exercise_id")
      .in("exercise_id", ids)
      .in("body_zone", zones)
      .eq("rule_type", "avoid");
    if (error) throw new Error(error.message);
    pain = unique((data ?? []).map((row: any) => row.exercise_id));
  }

  const warmupExercises =
    blocks.find((block: any) => block.block_key === "warmup")?.exercises ?? [];
  const warmup = warmupExercises
    .filter((exercise: any) => {
      const m = meta.get(exercise.id);
      return (
        !m ||
        m.warmup_eligible !== true ||
        !m.warmup_role ||
        (m.warmup_intensity ?? 99) > 2 ||
        (m.fatigue_score ?? 99) > 2 ||
        (m.joint_impact ?? 99) > 2
      );
    })
    .map((exercise: any) => exercise.id);

  const conditioning = await auditConditioning(
    supabase,
    blocks,
    meta,
    focus,
    automaticRegion,
  );

  return {
    pain,
    warmup,
    conditioningReasons: conditioning.reasons,
    excludeForBalance: conditioning.excludeId,
  };
}

async function auditConditioning(
  supabase: any,
  blocks: any[],
  meta: Map<string, any>,
  focus: string,
  automaticRegion: boolean,
) {
  if (!["Conditioning", "Fat Loss"].includes(focus)) {
    return { reasons: [] as string[], excludeId: null as string | null };
  }
  const wod = blocks.find((b: any) => b.block_key === "wod")?.exercises ?? [];
  if (wod.length < 4) return { reasons: [], excludeId: null };

  const regions = new Map<string, number>();
  let cardioAnchor = false;
  for (const exercise of wod) {
    const m = meta.get(exercise.id);
    if (!m) continue;
    const region = m.body_region ?? "unknown";
    regions.set(region, (regions.get(region) ?? 0) + 1);
    if (
      ["Conditioning", "Locomotion"].includes(m.movement_pattern ?? "") ||
      ["Conditioning", "Locomotion"].includes(m.exercise_family ?? "")
    ) cardioAnchor = true;
  }

  const { data: muscleRows, error: muscleError } = await supabase
    .from("exercise_muscles")
    .select("exercise_id,muscle_id")
    .in("exercise_id", wod.map((e: any) => e.id))
    .eq("priority", "primary");
  if (muscleError) throw new Error(muscleError.message);

  const musclesByExercise = new Map<string, string[]>();
  const muscleCounts = new Map<string, number>();
  for (const row of muscleRows ?? []) {
    if (["M15", "M16"].includes(row.muscle_id)) continue;
    const list = musclesByExercise.get(row.exercise_id) ?? [];
    list.push(row.muscle_id);
    musclesByExercise.set(row.exercise_id, list);
    muscleCounts.set(row.muscle_id, (muscleCounts.get(row.muscle_id) ?? 0) + 1);
  }

  const maxRegion = Math.max(0, ...Array.from(regions.values()));
  const maxMuscle = Math.max(0, ...Array.from(muscleCounts.values()));
  const reasons: string[] = [];
  if (automaticRegion && maxRegion === wod.length && !cardioAnchor) {
    reasons.push("CONDITIONING_TOO_LOCAL");
  }
  if (maxMuscle >= 3) reasons.push("CONDITIONING_LOCAL_FATIGUE_REDUNDANCY");

  let excludeId: string | null = null;
  if (reasons.length) {
    let dominantMuscle: string | null = null;
    let dominantCount = 0;
    for (const [muscleId, count] of muscleCounts.entries()) {
      if (count > dominantCount) {
        dominantMuscle = muscleId;
        dominantCount = count;
      }
    }
    const candidates = wod
      .filter((exercise: any) =>
        !dominantMuscle ||
        (musclesByExercise.get(exercise.id) ?? []).includes(dominantMuscle),
      )
      .sort(
        (a: any, b: any) =>
          (meta.get(b.id)?.fatigue_score ?? 0) - (meta.get(a.id)?.fatigue_score ?? 0),
      );
    excludeId = candidates[0]?.id ?? wod[wod.length - 1]?.id ?? null;
  }
  return { reasons, excludeId };
}

async function postProcess(
  supabase: any,
  userId: string,
  candidate: Workout,
  focus: string,
  rejected: any[],
  regionOverride: boolean,
) {
  const blocks = structuredClone(candidate.blocks ?? []);
  const meta = structuredClone(candidate.meta ?? {});
  const allIds = unique(
    blocks.flatMap((block: any) => (block.exercises ?? []).map((e: any) => e.id)),
  );
  const exerciseMeta = await loadMeta(supabase, allIds);
  const warmup = blocks.find((b: any) => b.block_key === "warmup");
  const skill = blocks.find((b: any) => b.block_key === "skill");
  const wod = blocks.find((b: any) => b.block_key === "wod");

  let released = 0;
  let warmupTrimmed = false;
  if (warmup && (warmup.exercises ?? []).length > 4) {
    const original = warmup.exercises;
    const targetPatterns = new Set(
      (wod?.exercises ?? []).map((e: any) => e.pattern).filter(Boolean),
    );
    const kept = selectWarmupFour(original, exerciseMeta, targetPatterns, focus);
    const keepIds = new Set(kept.map((e: any) => e.id));
    const removed = original.filter((e: any) => !keepIds.has(e.id)).map((e: any) => e.id);
    warmup.exercises = kept;
    warmupTrimmed = removed.length > 0;

    if (removed.length) {
      const { error } = await supabase
        .from("workout_session_exercises")
        .delete()
        .eq("session_id", candidate.session_id)
        .eq("block_key", "warm_up")
        .in("exercise_id", removed);
      if (error) throw new Error(error.message);
      for (let i = 0; i < kept.length; i++) {
        const { error: posError } = await supabase
          .from("workout_session_exercises")
          .update({ position: i + 1 })
          .eq("session_id", candidate.session_id)
          .eq("block_key", "warm_up")
          .eq("exercise_id", kept[i].id);
        if (posError) throw new Error(posError.message);
      }
    }

    const before = Number(warmup.duration_minutes ?? 0);
    const after = Math.min(before, 6);
    warmup.duration_minutes = after;
    released += Math.max(0, before - after);
    warmup.structure = `1 passage fluide — ${kept.length} mouvements — environ ${after} min`;
  }

  let skillAdjusted = false;
  if (skill && (skill.exercises ?? []).length) {
    const before = Number(skill.duration_minutes ?? 0);
    const priority = meta?.session_architecture?.skill_priority ?? {};
    const priorityIds = new Set([
      ...(priority.priority_exercise_ids ?? []),
      ...(priority.progression_target_ids ?? []),
    ]);
    const chosen = skill.exercises[0];
    const m = chosen ? exerciseMeta.get(chosen.id) : null;
    let cap = before;
    if (["Conditioning", "Fat Loss"].includes(focus)) cap = Math.min(cap, 10);
    if (priorityIds.size && chosen && !priorityIds.has(chosen.id)) cap = Math.min(cap, 10);
    if (
      m &&
      (m.technical_complexity ?? 99) <= 1 &&
      (m.fatigue_score ?? 99) <= 2 &&
      m.equipment_requirement === "none"
    ) cap = Math.min(cap, 8);

    if (cap < before) {
      skill.duration_minutes = cap;
      released += before - cap;
      skillAdjusted = true;
    }
  }

  if (released > 0 && wod) {
    wod.duration_minutes = Number(wod.duration_minutes ?? 0) + released;
    wod.structure = replaceMinutes(wod.structure ?? "", wod.duration_minutes);
  }

  if (meta.session_architecture) {
    meta.session_architecture.warmup_minutes = Number(warmup?.duration_minutes ?? 0);
    meta.session_architecture.skill_minutes = Number(skill?.duration_minutes ?? 0);
    meta.session_architecture.wod_minutes = Number(wod?.duration_minutes ?? 0);
    meta.session_architecture.programmed_minutes =
      Number(meta.session_architecture.warmup_minutes ?? 0) +
      Number(meta.session_architecture.tabata_minutes ?? 0) +
      Number(meta.session_architecture.skill_minutes ?? 0) +
      Number(meta.session_architecture.wod_minutes ?? 0);
  }
  if (regionOverride) {
    meta.target_region_source = "coach_balance_override_from_automatic_history";
  }
  meta.coach_gate = {
    version: VERSION,
    base_version: candidate.version ?? null,
    accepted_attempt: rejected.length + 1,
    rejected_candidates: rejected,
    pain_gate_verified: true,
    warmup_contract_verified: true,
    warmup_trimmed_to_max_four: warmupTrimmed,
    skill_duration_adjusted: skillAdjusted,
    released_minutes_to_wod: released,
    conditioning_balance_verified: ["Conditioning", "Fat Loss"].includes(focus),
    region_override_for_conditioning: regionOverride,
  };

  const stored = { version: VERSION, meta, blocks };
  const { error: updateError } = await supabase
    .from("workout_sessions")
    .update({ generated_workout: stored })
    .eq("id", candidate.session_id)
    .eq("user_id", userId);
  if (updateError) throw new Error(updateError.message);
  return stored;
}

function selectWarmupFour(
  exercises: any[],
  meta: Map<string, any>,
  targetPatterns: Set<any>,
  focus: string,
) {
  const selected: any[] = [];
  const used = new Set<string>();
  const take = (predicate: (e: any, m: any) => boolean) => {
    const e = exercises.find((item) => {
      if (used.has(item.id)) return false;
      const m = meta.get(item.id);
      return m && predicate(item, m);
    });
    if (e && selected.length < 4) {
      selected.push(e);
      used.add(e.id);
    }
  };
  take((_e, m) => m.warmup_role === "mobility");
  take((_e, m) => m.warmup_role === "activation");
  take((e, m) => m.warmup_role === "movement_prep" && targetPatterns.has(e.pattern));
  if (["Conditioning", "Fat Loss"].includes(focus)) {
    take((_e, m) => m.warmup_role === "pulse_raiser");
  }
  for (const e of exercises) {
    if (selected.length >= 4) break;
    if (!used.has(e.id)) {
      selected.push(e);
      used.add(e.id);
    }
  }
  return selected;
}

async function loadMeta(supabase: any, ids: string[]) {
  if (!ids.length) return new Map<string, any>();
  const { data, error } = await supabase
    .from("exercises")
    .select(
      "id,body_region,movement_pattern,exercise_family,training_focus,fatigue_score,joint_impact,technical_complexity,equipment_requirement,warmup_eligible,warmup_role,warmup_intensity,warmup_only",
    )
    .in("id", ids);
  if (error) throw new Error(error.message);
  return new Map((data ?? []).map((e: any) => [e.id, e]));
}

async function cleanup(supabase: any, sessionId: string, userId: string) {
  const { error: childError } = await supabase
    .from("workout_session_exercises")
    .delete()
    .eq("session_id", sessionId);
  if (childError) throw new Error(childError.message);
  const { error: sessionError } = await supabase
    .from("workout_sessions")
    .delete()
    .eq("id", sessionId)
    .eq("user_id", userId);
  if (sessionError) throw new Error(sessionError.message);
}

function replaceMinutes(structure: string, minutes: number) {
  if (!structure) return `WOD ${minutes} min`;
  return /\d+\s*min/i.test(structure)
    ? structure.replace(/\d+\s*min/i, `${minutes} min`)
    : `${structure} — ${minutes} min`;
}

function toConstraintZone(value: string) {
  const normalized = normalize(value);
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

function normalize(value: string) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function unique(values: any[]) {
  return Array.from(new Set(values.map((v) => String(v).trim()).filter(Boolean)));
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
