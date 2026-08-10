// @ts-ignore -- URL import résolu par Deno/Supabase Edge Runtime
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-ignore -- URL import résolu par Deno/Supabase Edge Runtime
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

interface Payload {
  session_id: string;
  current_exercise_id: string;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json({ error: "Unauthorized" }, 401);
    }

    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;

    const supabase = createClient(url, anon, {
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return json({ error: "Unauthorized" }, 401);
    }

    const body: Payload = await req.json();

    if (!body.session_id || !body.current_exercise_id) {
      throw new Error("session_id et current_exercise_id requis.");
    }

    const { data: session, error: sessionError } = await supabase
      .from("workout_sessions")
      .select(
        "id, user_id, status, readiness, available_equipment, injured_zones, generated_workout",
      )
      .eq("id", body.session_id)
      .eq("user_id", user.id)
      .single();

    if (sessionError || !session) {
      throw new Error("Séance introuvable.");
    }

    if (!["generated", "started", "in_progress"].includes(session.status)) {
      throw new Error("Cette séance ne peut plus être modifiée.");
    }

    const { data: row, error: rowError } = await supabase
      .from("workout_session_exercises")
      .select(
        "id, exercise_id, exercise_name, block_key, position, prescription, prescription_json",
      )
      .eq("session_id", body.session_id)
      .eq("exercise_id", body.current_exercise_id)
      .single();

    if (rowError || !row) {
      throw new Error("Exercice de séance introuvable.");
    }

    const generatedExercise = findGeneratedExercise(
      session.generated_workout,
      body.current_exercise_id,
    );

    const originExerciseId =
      generatedExercise?.swap_origin_exercise_id ??
      body.current_exercise_id;

    const previousRejectedIds = Array.isArray(
      generatedExercise?.swap_excluded_exercise_ids,
    )
      ? generatedExercise.swap_excluded_exercise_ids
      : [];

    const { data: current, error: currentError } = await supabase
      .from("exercises")
      .select(
        "id, name, movement_pattern, exercise_family, body_region, training_focus, technical_complexity, prescription_type, usable_for, fatigue_score, cardio_score, joint_impact",
      )
      .eq("id", body.current_exercise_id)
      .single();

    if (currentError || !current) {
      throw new Error("Exercice actuel introuvable.");
    }

    const { data: origin, error: originError } = await supabase
      .from("exercises")
      .select(
        "id, name, movement_pattern, exercise_family, body_region, training_focus, technical_complexity, prescription_type, usable_for, fatigue_score, cardio_score, joint_impact",
      )
      .eq("id", originExerciseId)
      .single();

    if (originError || !origin) {
      throw new Error("Exercice d'origine introuvable.");
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("experience")
      .eq("id", user.id)
      .maybeSingle();

    const readinessScore = normalizeReadiness(session.readiness);
    const maxComplexity = getMaxComplexity(
      profile?.experience,
      readinessScore,
    );
    const complexityLimit = Math.min(
      origin.technical_complexity ?? current.technical_complexity ?? 1,
      maxComplexity,
    );

    const { data: usedRows } = await supabase
      .from("workout_session_exercises")
      .select("exercise_id")
      .eq("session_id", body.session_id);

    const usedIds = new Set<string>(
      (usedRows ?? []).map((x: any) => String(x.exercise_id)),
    );
    usedIds.add(body.current_exercise_id);

    const excludedIds = new Set<string>([
      originExerciseId,
      body.current_exercise_id,
      ...previousRejectedIds,
    ]);

    const equipmentNames = Array.isArray(session.available_equipment)
      ? session.available_equipment
      : ["Aucun"];

    const { data: equipData } = await supabase
      .from("equipment")
      .select("id")
      .in("name", equipmentNames);

    const validEquipIds = new Set<string>(
      (equipData ?? []).map((x: any) => String(x.id)),
    );

    const injuredZones = Array.isArray(session.injured_zones)
      ? session.injured_zones
      : [];

    const baseSelect = `
      id, name, instructions, tips, technical_complexity, movement_pattern,
      exercise_family, body_region, training_focus, usable_for, equipment_requirement,
      prescription_type, tracking_modes, tabata_eligible,
      fatigue_score, cardio_score, joint_impact, transition_cost,
      exercise_equipment(equipment_id)
    `;

    // ------------------------------------------------------------
    // STRATÉGIE DE SWAP V3
    //
    // On repart toujours de l'intention de l'exercice ORIGINAL.
    // Un deuxième / troisième swap ne dérive donc pas du dernier
    // exercice proposé.
    //
    // A — variante directe
    // B — même movement_pattern
    // C — équivalent fonctionnel (patterns voisins)
    // D — même région + même focus, en dernier recours
    //
    // À chaque niveau on filtre AVANT de passer au suivant :
    // bloc, matériel, blessures, complexité et exercices déjà refusés.
    // ------------------------------------------------------------

    let safe: any[] = [];
    let swapStrategy = "";

    const selectAndFilter = async (query: any) => {
      const { data, error } = await query;

      if (error) {
        throw new Error(error.message);
      }

      return await filterSafeCandidates(
        supabase,
        data ?? [],
        row.block_key,
        usedIds,
        excludedIds,
        validEquipIds,
        injuredZones,
      );
    };

    // A) Variantes directes autour de l'exercice d'origine.
    const { data: variants, error: variantsError } = await supabase
      .from("exercise_variants")
      .select("exercise_id, target_exercise_id, variant_type")
      .or(
        `exercise_id.eq.${origin.id},target_exercise_id.eq.${origin.id}`,
      );

    if (variantsError) {
      throw new Error(variantsError.message);
    }

    const relatedIds = new Set<string>();

    for (const v of variants ?? []) {
      if (v.exercise_id === origin.id) {
        relatedIds.add(v.target_exercise_id);
      }

      if (v.target_exercise_id === origin.id) {
        relatedIds.add(v.exercise_id);
      }
    }

    if (relatedIds.size > 0) {
      safe = await selectAndFilter(
        supabase
          .from("exercises")
          .select(baseSelect)
          .in("id", Array.from(relatedIds))
          .lte("technical_complexity", complexityLimit),
      );

      if (safe.length > 0) {
        swapStrategy = "direct_variant";
      }
    }

    // B) Même pattern que l'exercice d'origine.
    if (safe.length === 0 && origin.movement_pattern) {
      safe = await selectAndFilter(
        supabase
          .from("exercises")
          .select(baseSelect)
          .eq("movement_pattern", origin.movement_pattern)
          .neq("id", origin.id)
          .lte("technical_complexity", complexityLimit),
      );

      if (safe.length > 0) {
        swapStrategy = "same_pattern";
      }
    }

    // C) Équivalent fonctionnel.
    // Exemple : Jump -> Squat / Lunge / Hinge / Conditioning.
    if (safe.length === 0) {
      const functionalPatterns = getFunctionalFallbackPatterns(
        origin.movement_pattern,
      );

      if (functionalPatterns.length > 0) {
        safe = await selectAndFilter(
          supabase
            .from("exercises")
            .select(baseSelect)
            .in("movement_pattern", functionalPatterns)
            .lte("technical_complexity", complexityLimit),
        );

        if (safe.length > 0) {
          swapStrategy = "functional_equivalent";
        }
      }
    }

    // D) Dernier recours : même région + même intention de travail.
    if (
      safe.length === 0 &&
      origin.body_region &&
      origin.training_focus
    ) {
      safe = await selectAndFilter(
        supabase
          .from("exercises")
          .select(baseSelect)
          .eq("body_region", origin.body_region)
          .eq("training_focus", origin.training_focus)
          .neq("id", origin.id)
          .lte("technical_complexity", complexityLimit),
      );

      if (safe.length > 0) {
        swapStrategy = "same_region_focus";
      }
    }

    if (safe.length === 0) {
      return json(
        {
          message:
            "Aucun remplaçant sûr trouvé avec le matériel, le bloc et les précautions de cette séance.",
          origin_exercise_id: origin.id,
          origin_exercise_name: origin.name,
        },
        404,
      );
    }

    // Le score garde l'intention d'origine :
    // pattern / focus / région / fatigue / cardio / complexité.
    safe.sort((a: any, b: any) =>
      scoreSwapCandidate(a, origin) - scoreSwapCandidate(b, origin)
    );

    const substitute = safe[0];

    const prescription = makePrescription(
      substitute.prescription_type,
      substitute.technical_complexity ?? 1,
      readinessScore,
      row.block_key,
      row.prescription,
    );

    const prescriptionJson = buildPrescriptionJson(
      substitute,
      prescription,
    );

    const { error: updateError } = await supabase
      .from("workout_session_exercises")
      .update({
        exercise_id: substitute.id,
        exercise_name: substitute.name,
        prescription,
        prescription_json: prescriptionJson,
        status: "pending",
        reps_completed: null,
        weight_kg: null,
        duration_seconds: null,
        distance_meters: null,
        rpe: null,
        notes: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id)
      .eq("session_id", body.session_id);

    if (updateError) {
      throw new Error(updateError.message);
    }

    // Maintenir generated_workout cohérent avec la ligne normalisée.
    const generated = session.generated_workout;

    if (generated && Array.isArray(generated.blocks)) {
      const normalizedRowBlock = normalizeBlockKey(row.block_key);

      for (const block of generated.blocks) {
        const rawKey = String(
          block.block_key ?? block.block_name ?? "",
        );
        const normalizedGeneratedBlock = normalizeBlockKey(rawKey);

        const matchesBlock =
          normalizedGeneratedBlock === normalizedRowBlock;

        if (
          !matchesBlock ||
          !Array.isArray(block.exercises)
        ) {
          continue;
        }

        block.exercises = block.exercises.map((ex: any) =>
          ex.id === body.current_exercise_id
            ? {
                ...ex,
                id: substitute.id,
                name: substitute.name,
                pattern: substitute.movement_pattern,
                region: substitute.body_region,
                prescription,
                prescription_json: prescriptionJson,
                instructions: substitute.instructions,
                tips: substitute.tips,
                tracking_modes:
                  substitute.tracking_modes ?? [],
                swap_origin_exercise_id: origin.id,
                swap_excluded_exercise_ids: Array.from(
                  new Set([
                    ...previousRejectedIds,
                    body.current_exercise_id,
                  ]),
                ),
                swap_strategy: swapStrategy,
              }
            : ex
        );
      }

      const { error: jsonError } = await supabase
        .from("workout_sessions")
        .update({
          generated_workout: generated,
          updated_at: new Date().toISOString(),
        })
        .eq("id", body.session_id)
        .eq("user_id", user.id);

      if (jsonError) {
        throw new Error(jsonError.message);
      }
    }

    return json({
      success: true,
      session_id: body.session_id,
      block_key: row.block_key,
      replaced_exercise: {
        id: current.id,
        name: current.name,
      },
      swap_origin: {
        id: origin.id,
        name: origin.name,
      },
      swap_strategy: swapStrategy,
      substitute: {
        id: substitute.id,
        name: substitute.name,
        pattern: substitute.movement_pattern,
        region: substitute.body_region,
        prescription,
        prescription_json: prescriptionJson,
        instructions: substitute.instructions,
        tips: substitute.tips,
        tracking_modes: substitute.tracking_modes ?? [],
      },
    });
  } catch (error) {
    return json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unknown error",
      },
      400,
    );
  }
});

async function filterSafeCandidates(
  supabase: any,
  candidates: any[],
  blockKey: string,
  usedIds: Set<string>,
  excludedIds: Set<string>,
  validEquipIds: Set<string>,
  injuredZones: string[],
) {
  if (candidates.length === 0) {
    return [];
  }

  const candidateIds = candidates.map((x: any) => x.id);

  const { data: constraints, error: constraintsError } =
    await supabase
      .from("exercise_constraints")
      .select("exercise_id, body_zone, rule_type, severity")
      .in("exercise_id", candidateIds);

  if (constraintsError) {
    throw new Error(constraintsError.message);
  }

  const constraintsByExercise = new Map<string, any[]>();

  for (const c of constraints ?? []) {
    if (!constraintsByExercise.has(c.exercise_id)) {
      constraintsByExercise.set(c.exercise_id, []);
    }

    constraintsByExercise.get(c.exercise_id)!.push(c);
  }

  return candidates.filter((ex: any) => {
    if (usedIds.has(ex.id)) return false;
    if (excludedIds.has(ex.id)) return false;
    if (!usableInBlock(ex, blockKey)) return false;
    if (!hasEquipment(ex, validEquipIds)) return false;

    if (
      isBlocked(
        ex.id,
        injuredZones,
        constraintsByExercise,
      )
    ) {
      return false;
    }

    if (
      normalizeBlockKey(blockKey) === "tabata" &&
      (
        ex.tabata_eligible !== true ||
        ex.body_region !== "Core"
      )
    ) {
      return false;
    }

    return true;
  });
}

function findGeneratedExercise(
  generatedWorkout: any,
  exerciseId: string,
) {
  if (
    !generatedWorkout ||
    !Array.isArray(generatedWorkout.blocks)
  ) {
    return null;
  }

  for (const block of generatedWorkout.blocks) {
    if (!Array.isArray(block?.exercises)) {
      continue;
    }

    const found = block.exercises.find(
      (ex: any) => ex?.id === exerciseId,
    );

    if (found) {
      return found;
    }
  }

  return null;
}

function getFunctionalFallbackPatterns(
  movementPattern: string | null,
) {
  const map: Record<string, string[]> = {
    Jump: ["Squat", "Lunge", "Hinge", "Conditioning", "Locomotion"],
    Squat: ["Lunge", "Hinge", "Jump"],
    Lunge: ["Squat", "Hinge", "Locomotion"],
    Hinge: ["Squat", "Lunge", "Carry"],
    "Push Horizontal": ["Push Vertical", "Core", "Anti-Extension"],
    "Push Vertical": ["Push Horizontal", "Core", "Anti-Extension"],
    "Pull Horizontal": ["Pull Vertical", "Carry", "Core"],
    "Pull Vertical": ["Pull Horizontal", "Carry", "Core"],
    Core: ["Anti-Extension", "Anti-Rotation", "Rotation"],
    "Anti-Extension": ["Core", "Anti-Rotation", "Rotation"],
    "Anti-Rotation": ["Core", "Anti-Extension", "Rotation"],
    Rotation: ["Core", "Anti-Rotation", "Anti-Extension"],
    Conditioning: ["Locomotion", "Jump", "Squat", "Lunge"],
    Locomotion: ["Conditioning", "Jump", "Carry"],
    Carry: ["Locomotion", "Hinge", "Squat"],
    Mobility: [],
  };

  return map[movementPattern ?? ""] ?? [];
}

function scoreSwapCandidate(
  candidate: any,
  origin: any,
) {
  let score = 0;

  if (candidate.movement_pattern !== origin.movement_pattern) {
    score += 30;
  }

  if (candidate.training_focus !== origin.training_focus) {
    score += 12;
  }

  if (candidate.body_region !== origin.body_region) {
    score += 10;
  }

  score += Math.abs(
    (candidate.technical_complexity ?? 1) -
      (origin.technical_complexity ?? 1),
  ) * 5;

  score += Math.abs(
    (candidate.fatigue_score ?? 3) -
      (origin.fatigue_score ?? 3),
  ) * 2;

  score += Math.abs(
    (candidate.cardio_score ?? 3) -
      (origin.cardio_score ?? 3),
  ) * 2;

  score += Math.abs(
    (candidate.joint_impact ?? 2) -
      (origin.joint_impact ?? 2),
  ) * 2;

  score += candidate.transition_cost ?? 0;

  return score;
}

function normalizeBlockKey(blockKey: string) {
  const normalized = normalize(String(blockKey ?? ""));

  if (
    normalized === "warm_up" ||
    normalized === "warm-up" ||
    normalized === "warmup"
  ) {
    return "warmup";
  }

  return normalized;
}

function usableInBlock(ex: any, blockKey: string) {
  const values = Array.isArray(ex.usable_for)
    ? ex.usable_for
    : typeof ex.usable_for === "string"
    ? [ex.usable_for]
    : [];

  const normalizedBlockKey = normalizeBlockKey(blockKey);

  const tagMap: Record<string, string[]> = {
    warmup: ["Warm-up"],
    tabata: ["Core", "Tabata"],
    skill: ["Skill"],
    wod: ["WOD"],
  };

  return (tagMap[normalizedBlockKey] ?? []).some(
    (tag) =>
      values.some((v: string) =>
        v.includes(tag)
      ),
  );
}

function hasEquipment(
  ex: any,
  validIds: Set<string>,
) {
  const rel = ex.exercise_equipment ?? [];

  if (
    ex.equipment_requirement === "none" ||
    rel.length === 0
  ) {
    return true;
  }

  return rel.some((r: any) =>
    validIds.has(r.equipment_id)
  );
}

function isBlocked(
  exerciseId: string,
  injuredZones: string[],
  byExercise: Map<string, any[]>,
) {
  const zones = new Set(
    injuredZones.map(toZone),
  );

  return (byExercise.get(exerciseId) ?? []).some(
    (c: any) => {
      if (
        !c.body_zone ||
        !zones.has(c.body_zone)
      ) {
        return false;
      }

      if (c.rule_type === "avoid") {
        return true;
      }

      return (
        c.rule_type === "regress" &&
        (c.severity ?? 1) >= 2
      );
    },
  );
}

function toZone(value: string) {
  const n = normalize(value);

  const map: Record<string, string> = {
    poignet: "wrist",
    wrist: "wrist",
    genou: "knee",
    knee: "knee",
    epaule: "shoulder",
    shoulder: "shoulder",
    "bas du dos": "lower_back",
    lombaires: "lower_back",
    lower_back: "lower_back",
    coude: "elbow",
    elbow: "elbow",
  };

  return map[n] ?? n.replace(/\s+/g, "_");
}

function normalize(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function normalizeReadiness(value: unknown) {
  if (typeof value === "number") {
    return Math.min(
      10,
      Math.max(1, Math.round(value)),
    );
  }

  const n = normalize(
    String(value ?? "normal"),
  );

  if (
    n === "low" ||
    n === "faible"
  ) {
    return 3;
  }

  if (
    n === "high" ||
    n === "olympique"
  ) {
    return 9;
  }

  return 6;
}

function getMaxComplexity(
  experience: unknown,
  readiness: number,
) {
  const n = normalize(
    String(experience ?? ""),
  );

  let base = n.includes("debut")
    ? 3
    : n.includes("avance")
    ? 5
    : 4;

  if (readiness <= 4) {
    base -= 1;
  }

  return Math.min(
    5,
    Math.max(1, base),
  );
}

function makePrescription(
  prescriptionType: string | null,
  complexity: number,
  readiness: number,
  blockKey: string,
  previousPrescription: string | null,
) {
  const normalizedBlockKey =
    normalizeBlockKey(blockKey);

  // Pour Warm-up / Skill, conserver le volume déjà défini.
  if (
    (
      normalizedBlockKey === "warmup" ||
      normalizedBlockKey === "skill"
    ) &&
    previousPrescription
  ) {
    return previousPrescription;
  }

  if (normalizedBlockKey === "tabata") {
    return "20 secondes de travail / 10 secondes de repos";
  }

  const low = readiness <= 4;
  const high = readiness >= 8;

  if (prescriptionType === "isometric") {
    return low
      ? "20 secondes"
      : high
      ? "40 à 50 secondes"
      : "30 secondes";
  }

  if (prescriptionType === "distance") {
    return low
      ? "10 à 15 m"
      : high
      ? "20 à 30 m"
      : "15 à 20 m";
  }

  if (prescriptionType === "reps_heavy") {
    return low
      ? "3 reps charge modérée"
      : high
      ? "5 à 7 reps"
      : "5 reps";
  }

  if (prescriptionType === "reps_unilateral") {
    return low
      ? "6 reps par côté"
      : high
      ? "10 reps par côté"
      : "8 reps par côté";
  }

  if (prescriptionType === "metabolic_high") {
    return low
      ? "8 à 12 reps"
      : high
      ? "18 à 22 reps"
      : "12 à 16 reps";
  }

  if (complexity >= 4) {
    return low
      ? "3 à 5 reps"
      : high
      ? "6 à 8 reps"
      : "4 à 6 reps";
  }

  return low
    ? "6 à 8 reps"
    : high
    ? "12 à 15 reps"
    : "8 à 12 reps";
}

function buildPrescriptionJson(
  exercise: any,
  prescription: string,
) {
  const result: Record<string, unknown> = {
    prescription_type:
      exercise.prescription_type ??
      "reps_standard",
    tracking_modes:
      exercise.tracking_modes ?? [],
    text: prescription,
  };

  const normalized = prescription
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  const repsRange = normalized.match(
    /(\d+)\s*(?:a|-)\s*(\d+)\s*(?:reps|repetitions)/,
  );

  if (repsRange) {
    result.reps_min =
      Number(repsRange[1]);
    result.reps_max =
      Number(repsRange[2]);
  } else {
    const repsExact = normalized.match(
      /(\d+)\s*(?:reps|repetitions)/,
    );

    if (repsExact) {
      result.reps_min =
        Number(repsExact[1]);
      result.reps_max =
        Number(repsExact[1]);
    }
  }

  const durationRange = normalized.match(
    /(\d+)\s*(?:a|-)\s*(\d+)\s*secondes?/,
  );

  if (durationRange) {
    result.duration_seconds_min =
      Number(durationRange[1]);
    result.duration_seconds_max =
      Number(durationRange[2]);
  } else {
    const durationExact =
      normalized.match(
        /(\d+)\s*secondes?/,
      );

    if (durationExact) {
      result.duration_seconds_min =
        Number(durationExact[1]);
      result.duration_seconds_max =
        Number(durationExact[1]);
    }
  }

  const distanceRange = normalized.match(
    /(\d+)\s*(?:a|-)\s*(\d+)\s*m(?:\s|$)/,
  );

  if (distanceRange) {
    result.distance_meters_min =
      Number(distanceRange[1]);
    result.distance_meters_max =
      Number(distanceRange[2]);
  }

  const rpeRange = normalized.match(
    /rpe\s*(\d+)\s*(?:a|-)\s*(\d+)/,
  );

  if (rpeRange) {
    result.target_rpe_min =
      Number(rpeRange[1]);
    result.target_rpe_max =
      Number(rpeRange[2]);
  } else {
    const rpeExact = normalized.match(
      /rpe\s*(\d+)/,
    );

    if (rpeExact) {
      result.target_rpe_min =
        Number(rpeExact[1]);
      result.target_rpe_max =
        Number(rpeExact[1]);
    }
  }

  return result;
}

function json(
  body: unknown,
  status = 200,
) {
  return new Response(
    JSON.stringify(body),
    {
      status,
      headers: {
        ...corsHeaders,
        "Content-Type":
          "application/json",
      },
    },
  );
}