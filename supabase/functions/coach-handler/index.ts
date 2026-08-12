// @ts-ignore -- Deno/Supabase Edge Runtime
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-ignore -- Deno/Supabase Edge Runtime
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

declare const Deno: { env: { get(name: string): string | undefined } };

const VERSION = "coach-handler-v2.1-a1-real-inventory";
const C4_VERSION = "c4-final-v1.5";
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

type C4Result = {
  version?: string;
  status?: string;
  stimulus?: Record<string, any>;
  selected_candidate?: Record<string, any> | null;
  accepted_candidates?: any[];
  rejected_candidates?: any[];
  candidate_count?: number;
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
    const focus = String(original.focus_override ?? "General Fitness");
    const readinessScore = normalizeReadiness(original.readiness);

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("experience")
      .eq("id", userId)
      .maybeSingle();
    if (profileError) throw new Error(profileError.message);

    const experience = normalizeExperience(profile?.experience);
    const maxComplexity = getMaxComplexity(experience, readinessScore);

    let payload: Payload = {
      ...original,
      excluded_exercise_ids: unique(original.excluded_exercise_ids ?? []),
    };

    const rejected: any[] = [];
    let regionOverride = false;
    let accepted: Workout | null = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const scaffold = await callBase(url, anon, auth, payload);
      const scaffoldAudit = await auditScaffold(
        supabase,
        scaffold,
        original.injured_zones ?? [],
      );

      const scaffoldReasons = [
        ...scaffoldAudit.pain.map((id: string) => `PAIN_GATE:${id}`),
        ...scaffoldAudit.warmup.map((id: string) => `WARMUP_GATE:${id}`),
      ];

      if (scaffoldReasons.length > 0) {
        rejected.push({ attempt, stage: "scaffold", reasons: scaffoldReasons });
        await cleanup(supabase, scaffold.session_id, userId);

        const excluded = new Set(payload.excluded_exercise_ids ?? []);
        [...scaffoldAudit.pain, ...scaffoldAudit.warmup].forEach((id: string) =>
          excluded.add(id)
        );
        payload = { ...payload, excluded_exercise_ids: Array.from(excluded) };
        continue;
      }

      const releaseEstimate = await estimateReleasedMinutes(
        supabase,
        scaffold,
        focus,
      );

      const oldWod = getBlock(scaffold.blocks ?? [], "wod");
      const baseWodMinutes = Math.max(8, Number(oldWod?.duration_minutes ?? 8));
      const finalWodMinutes = baseWodMinutes + releaseEstimate;
      const effectiveRegion =
        original.target_region ??
        scaffold.meta?.target_region ??
        payload.target_region ??
        null;

      const c4 = await solveC4(supabase, {
        userId,
        focus,
        totalDuration: clampInt(Number(original.duration_minutes ?? 45), 30, 90),
        readinessScore,
        targetRegion: effectiveRegion,
        progressionIntent: scaffold.meta?.progression_intent ?? null,
        injuredZones: original.injured_zones ?? [],
        availableEquipment: original.available_equipment ?? ["Aucun"],
        maxComplexity,
        maxDifficulty: experience,
        exactWodMinutes: finalWodMinutes,
      });

      if (c4.status !== "READY" || !c4.selected_candidate) {
        rejected.push({
          attempt,
          stage: "c4",
          reasons: [String(c4.status ?? "C4_NO_FINAL_CANDIDATE")],
        });
        await cleanup(supabase, scaffold.session_id, userId);

        if (
          original.target_region == null &&
          ["Conditioning", "Fat Loss"].includes(focus) &&
          payload.target_region !== "Full Body"
        ) {
          payload = { ...payload, target_region: "Full Body" };
          regionOverride = true;
        }
        continue;
      }

      const withC4 = await replaceWodWithC4(
        supabase,
        userId,
        scaffold,
        c4,
        focus,
        effectiveRegion,
        baseWodMinutes,
        finalWodMinutes,
      );

      accepted = await postProcess(
        supabase,
        userId,
        withC4,
        focus,
        rejected,
        regionOverride,
      );
      break;
    }

    if (!accepted) {
      throw new Error(
        "Impossible de construire une séance suffisamment sûre et cohérente avec les contraintes du jour.",
      );
    }

    return json(
      { ...accepted, status: "generated" },
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

async function auditScaffold(
  supabase: any,
  candidate: Workout,
  injuredZones: string[],
) {
  const blocks = candidate.blocks ?? [];
  const nonWodExercises = blocks
    .filter((block: any) => block.block_key !== "wod")
    .flatMap((block: any) => block.exercises ?? []);
  const ids = unique(nonWodExercises.map((e: any) => e.id));
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

  const warmupExercises = getBlock(blocks, "warmup")?.exercises ?? [];
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

  return { pain, warmup };
}

async function estimateReleasedMinutes(
  supabase: any,
  candidate: Workout,
  focus: string,
) {
  const blocks = candidate.blocks ?? [];
  const warmup = getBlock(blocks, "warmup");
  const skill = getBlock(blocks, "skill");
  let released = 0;

  if (warmup && (warmup.exercises ?? []).length > 4) {
    const before = Number(warmup.duration_minutes ?? 0);
    released += Math.max(0, before - Math.min(before, 6));
  }

  if (skill && (skill.exercises ?? []).length) {
    const chosen = skill.exercises[0];
    const meta = await loadMeta(supabase, chosen?.id ? [chosen.id] : []);
    const cap = getSkillDurationCap(candidate, focus, meta.get(chosen?.id));
    released += Math.max(0, Number(skill.duration_minutes ?? 0) - cap);
  }

  return released;
}

async function solveC4(
  supabase: any,
  args: {
    userId: string;
    focus: string;
    totalDuration: number;
    readinessScore: number;
    targetRegion: string | null;
    progressionIntent: string | null;
    injuredZones: string[];
    availableEquipment: string[];
    maxComplexity: number;
    maxDifficulty: string;
    exactWodMinutes: number;
  },
): Promise<C4Result> {
  /*
   * A1 — Inventaire matériel réel.
   *
   * Le check-in continue d'indiquer quels matériels sont disponibles aujourd'hui.
   * Mais cette sélection est maintenant résolue contre user_equipment_inventory
   * afin de récupérer les quantités et charges réellement connues.
   *
   * Si un matériel n'a pas encore été détaillé par l'utilisateur,
   * le resolver SQL conserve automatiquement le fallback legacy pour ce
   * matériel uniquement.
   */
  const { data: inventory, error: inventoryError } = await supabase.rpc(
    "resolve_user_equipment_inventory",
    {
      p_user_id: args.userId,
      p_selected_names:
        args.availableEquipment.length > 0
          ? args.availableEquipment
          : ["Aucun"],
      p_policy_key: "c4-final-default",
    },
  );

  if (inventoryError) {
    throw new Error(inventoryError.message);
  }

  const { data, error } = await supabase.rpc("solve_session_engine_c4", {
    p_user_id: args.userId,
    p_focus: args.focus,
    p_duration_minutes: args.totalDuration,
    p_readiness: readinessBand(args.readinessScore),
    p_target_region: args.targetRegion,
    p_progression_intent: args.progressionIntent,
    p_zone_terms: args.injuredZones,
    p_inventory: inventory ?? [],
    p_max_complexity: args.maxComplexity,
    p_max_difficulty: args.maxDifficulty,
    p_candidate_count: 12,
    p_exact_wod_minutes: args.exactWodMinutes,
    p_policy_key: "c4-final-default",
  });
  if (error) throw new Error(error.message);
  return (data ?? {}) as C4Result;
}

async function replaceWodWithC4(
  supabase: any,
  userId: string,
  scaffold: Workout,
  c4: C4Result,
  focus: string,
  effectiveRegion: string | null,
  baseWodMinutes: number,
  finalWodMinutes: number,
): Promise<Workout> {
  const selected = c4.selected_candidate ?? {};
  const selectedExercises = Array.isArray(selected.exercises)
    ? selected.exercises
    : [];
  if (!selectedExercises.length) throw new Error("C4 returned an empty WOD.");

  const ids = unique(selectedExercises.map((e: any) => e.exercise_id));
  const detailMap = await loadExerciseDetails(supabase, ids);
  const capabilityMap = await loadCapabilitySnapshots(supabase, userId, ids);

  const final = selected.c4_final ?? {};
  const mechanicJson = final.mechanic_json ?? {};
  const mechanic = String(selected.mechanic ?? mechanicJson.mechanic_key ?? "CIRCUIT").toUpperCase();
  const params = mechanicJson.parameters ?? {};

  const generatedExercises = selectedExercises.map((item: any) => {
    const detail = detailMap.get(item.exercise_id);
    if (!detail) throw new Error(`C4 exercise metadata missing: ${item.exercise_id}`);
    const prescriptionJson = item.prescription ?? {};
    const prescription = formatPrescription(prescriptionJson, mechanic, params);
    return {
      id: item.exercise_id,
      name: detail.name,
      pattern: detail.movement_pattern ?? null,
      region: detail.body_region ?? null,
      prescription,
      prescription_json: { ...prescriptionJson, text: prescription },
      instructions: detail.instructions ?? null,
      tips: detail.tips ?? null,
      tracking_modes: detail.tracking_modes ?? [],
      _candidate_score: item.candidate_score ?? null,
      _components: item.components ?? {},
    };
  });

  const wodBlock = {
    block_key: "wod",
    block_name: "WOD principal",
    duration_minutes: baseWodMinutes,
    objective: getWodObjective(mechanic, focus),
    structure: buildC4Structure(mechanic, params, finalWodMinutes, generatedExercises.length),
    rounds: prescribedRounds(mechanic, params),
    exercises: generatedExercises,
  };

  const blocks = structuredClone(scaffold.blocks ?? []);
  const wodIndex = blocks.findIndex((b: any) => b.block_key === "wod");
  if (wodIndex >= 0) blocks[wodIndex] = wodBlock;
  else blocks.push(wodBlock);

  const { error: deleteError } = await supabase
    .from("workout_session_exercises")
    .delete()
    .eq("session_id", scaffold.session_id)
    .eq("block_key", "wod");
  if (deleteError) throw new Error(deleteError.message);

  const expectedRpeMin = toNumber(c4.stimulus?.rpe_target?.min);
  const expectedRpeMax = toNumber(c4.stimulus?.rpe_target?.max);

  const rows = generatedExercises.map((exercise: any, index: number) => ({
    session_id: scaffold.session_id,
    exercise_id: exercise.id,
    exercise_name: exercise.name,
    block_key: "wod",
    position: index + 1,
    status: "pending",
    prescription: exercise.prescription,
    prescription_json: exercise.prescription_json,
    rounds: prescribedRounds(mechanic, params),
    expected_outcome_json: {
      mechanic,
      block_parameters: params,
      predicted_block_volume: final.predicted_volume ?? {},
      whole_wod_metrics: final.whole_wod_metrics ?? {},
      candidate_score: exercise._candidate_score,
    },
    expected_rpe_min: expectedRpeMin,
    expected_rpe_max: expectedRpeMax,
    capacity_snapshot_json:
      capabilityMap.get(exercise.id) ?? { source: "no_confirmed_capability" },
    solver_decision_json: {
      engine_version: c4.version ?? C4_VERSION,
      selection_score: selected.c4_selection_score ?? null,
      exercise_candidate_score: exercise._candidate_score,
      score_components: exercise._components,
      anti_redundancy: selected.c4_anti_redundancy ?? {},
      quality_gate: selected.c4_quality_gate ?? {},
      mechanic,
    },
  }));

  const { data: inserted, error: insertError } = await supabase
    .from("workout_session_exercises")
    .insert(rows)
    .select("id,exercise_id,position");
  if (insertError) throw new Error(insertError.message);

  const instanceByPosition = new Map(
    (inserted ?? []).map((row: any) => [Number(row.position), row.id]),
  );
  wodBlock.exercises = wodBlock.exercises.map((exercise: any, index: number) => ({
    ...exercise,
    session_exercise_id: instanceByPosition.get(index + 1) ?? null,
  }));
  if (wodIndex >= 0) blocks[wodIndex] = wodBlock;

  const meta = structuredClone(scaffold.meta ?? {});
  meta.format = mechanic;
  if (effectiveRegion) meta.target_region = effectiveRegion;
  meta.session_engine_c4 = {
    version: c4.version ?? C4_VERSION,
    selected_score: selected.c4_selection_score ?? null,
    accepted_candidates: c4.candidate_count ?? 0,
    final_wod_minutes: finalWodMinutes,
    mechanic,
    mechanic_json: mechanicJson,
    whole_wod_metrics: final.whole_wod_metrics ?? {},
    anti_redundancy: selected.c4_anti_redundancy ?? {},
    quality_gate: selected.c4_quality_gate ?? {},
  };

  const qualityGate = {
    ...(selected.c4_quality_gate ?? {}),
    anti_redundancy: selected.c4_anti_redundancy ?? {},
    selection_score: selected.c4_selection_score ?? null,
    engine_version: c4.version ?? C4_VERSION,
  };

  const { error: sessionUpdateError } = await supabase
    .from("workout_sessions")
    .update({
      target_region: effectiveRegion ?? meta.target_region ?? null,
      focus,
      progression_intent: c4.stimulus?.progression_intent === "UNSPECIFIED"
        ? null
        : c4.stimulus?.progression_intent ?? null,
      planning_context_json: {
        engine: c4.version ?? C4_VERSION,
        orchestration: VERSION,
        scaffold_version: scaffold.version ?? null,
        candidate_count: c4.candidate_count ?? 0,
        final_wod_minutes: finalWodMinutes,
        target_region_source: effectiveRegion ? "resolved_for_session" : "auto",
      },
      expected_stimulus_json: c4.stimulus ?? {},
      mechanic_json: mechanicJson,
      quality_gate_json: qualityGate,
    })
    .eq("id", scaffold.session_id)
    .eq("user_id", userId);
  if (sessionUpdateError) throw new Error(sessionUpdateError.message);

  return {
    ...scaffold,
    version: VERSION,
    meta,
    blocks,
  };
}

async function postProcess(
  supabase: any,
  userId: string,
  candidate: Workout,
  focus: string,
  rejected: any[],
  regionOverride: boolean,
): Promise<Workout> {
  const blocks = structuredClone(candidate.blocks ?? []);
  const meta = structuredClone(candidate.meta ?? {});
  const allIds = unique(
    blocks.flatMap((block: any) => (block.exercises ?? []).map((e: any) => e.id)),
  );
  const exerciseMeta = await loadMeta(supabase, allIds);
  const warmup = getBlock(blocks, "warmup");
  const skill = getBlock(blocks, "skill");
  const wod = getBlock(blocks, "wod");

  let released = 0;
  let warmupTrimmed = false;

  if (warmup && (warmup.exercises ?? []).length > 4) {
    const original = warmup.exercises;
    const targetPatterns = new Set<string>(
      (wod?.exercises ?? [])
        .map((e: any) => String(e.pattern ?? ""))
        .filter(Boolean),
    );
    const kept = selectWarmupFour(original, exerciseMeta, targetPatterns, focus);
    const keepIds = new Set(kept.map((e: any) => e.id));
    const removed = original
      .filter((e: any) => !keepIds.has(e.id))
      .map((e: any) => e.id);
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
    const chosen = skill.exercises[0];
    const cap = getSkillDurationCap(candidate, focus, exerciseMeta.get(chosen?.id));

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
    base_version: candidate.meta?.session_engine_c4?.version ?? candidate.version ?? null,
    accepted_attempt: rejected.length + 1,
    rejected_candidates: rejected,
    scaffold_pain_gate_verified: true,
    warmup_contract_verified: true,
    warmup_trimmed_to_max_four: warmupTrimmed,
    skill_duration_adjusted: skillAdjusted,
    released_minutes_to_wod: released,
    c4_wod_authoritative: true,
    c4_quality_gate_verified: true,
    region_override_for_conditioning: regionOverride,
  };

  const stored = { version: VERSION, meta, blocks };
  const { error: updateError } = await supabase
    .from("workout_sessions")
    .update({ generated_workout: stored })
    .eq("id", candidate.session_id)
    .eq("user_id", userId);
  if (updateError) throw new Error(updateError.message);

  return {
    session_id: candidate.session_id,
    status: "generated",
    ...stored,
  };
}

function getSkillDurationCap(candidate: Workout, focus: string, m: any) {
  const skill = getBlock(candidate.blocks ?? [], "skill");
  const before = Number(skill?.duration_minutes ?? 0);
  if (!skill || !(skill.exercises ?? []).length) return before;

  const priority = candidate.meta?.session_architecture?.skill_priority ?? {};
  const priorityIds = new Set([
    ...(priority.priority_exercise_ids ?? []),
    ...(priority.progression_target_ids ?? []),
  ]);
  const chosen = skill.exercises[0];
  let cap = before;

  if (["Conditioning", "Fat Loss"].includes(focus)) cap = Math.min(cap, 10);
  if (priorityIds.size && chosen && !priorityIds.has(chosen.id)) cap = Math.min(cap, 10);
  if (
    m &&
    (m.technical_complexity ?? 99) <= 1 &&
    (m.fatigue_score ?? 99) <= 2 &&
    m.equipment_requirement === "none"
  ) {
    cap = Math.min(cap, 8);
  }
  return cap;
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

async function loadMeta(
  supabase: any,
  ids: string[],
): Promise<Map<string, any>> {
  if (!ids.length) return new Map<string, any>();
  const { data, error } = await supabase
    .from("exercises")
    .select(
      "id,body_region,movement_pattern,exercise_family,training_focus,fatigue_score,joint_impact,technical_complexity,equipment_requirement,warmup_eligible,warmup_role,warmup_intensity,warmup_only",
    )
    .in("id", ids);
  if (error) throw new Error(error.message);
  return new Map<string, any>(
    (data ?? []).map((e: any) => [String(e.id), e]),
  );
}

async function loadExerciseDetails(
  supabase: any,
  ids: string[],
): Promise<Map<string, any>> {
  const { data, error } = await supabase
    .from("exercises")
    .select(
      "id,name,instructions,tips,body_region,movement_pattern,exercise_family,tracking_modes,prescription_type",
    )
    .in("id", ids);
  if (error) throw new Error(error.message);
  return new Map<string, any>(
    (data ?? []).map((e: any) => [String(e.id), e]),
  );
}

async function loadCapabilitySnapshots(
  supabase: any,
  userId: string,
  ids: string[],
): Promise<Map<string, any>> {
  const { data, error } = await supabase
    .from("user_exercise_coach_state")
    .select(
      "exercise_id,state,recommendation,reps_envelope,load_envelope,time_envelope,distance_envelope,pace_envelope,density_envelope,capability_confidence,capability_freshness,evidence_count,valid_evidence_count,last_observed_at",
    )
    .eq("user_id", userId)
    .in("exercise_id", ids);
  if (error) throw new Error(error.message);

  return new Map<string, any>(
    (data ?? []).map((row: any) => [
      String(row.exercise_id),
      { source: "user_exercise_coach_state", ...row },
    ]),
  );
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

function getBlock(blocks: any[], key: string) {
  return blocks.find((b: any) => b.block_key === key) ?? null;
}

function formatPrescription(p: any, mechanic: string, params: any) {
  const repsMin = toNumber(p?.reps_min);
  const repsMax = toNumber(p?.reps_max);
  const durationMin = toNumber(p?.duration_seconds_min);
  const durationMax = toNumber(p?.duration_seconds_max);
  const distanceMin = toNumber(p?.distance_meters_min);
  const distanceMax = toNumber(p?.distance_meters_max);
  const perSide = p?.reps_semantics === "per_side";
  const rpeMin = toNumber(p?.target_rpe_min);
  const rpeMax = toNumber(p?.target_rpe_max);

  let base = "Prescription adaptée";
  if (repsMin != null || repsMax != null) {
    base = rangeText(repsMin, repsMax, "reps") + (perSide ? " par côté" : "");
  } else if (durationMin != null || durationMax != null) {
    base = rangeText(durationMin, durationMax, "sec");
  } else if (distanceMin != null || distanceMax != null) {
    base = rangeText(distanceMin, distanceMax, "m");
  }

  if (mechanic === "STRENGTH" && params?.sets) {
    base = `${params.sets} séries × ${base}`;
    if (params?.rest_between_exercises_seconds) {
      base += ` — repos ${params.rest_between_exercises_seconds}s`;
    }
  }

  if (rpeMin != null || rpeMax != null) {
    base += ` — RPE ${rangeText(rpeMin, rpeMax, "")}`.trimEnd();
  }
  return base;
}

function buildC4Structure(
  mechanic: string,
  params: any,
  minutes: number,
  exerciseCount: number,
) {
  switch (mechanic) {
    case "AMRAP":
      return `AMRAP ${minutes} min — ${exerciseCount} exercices`;
    case "EMOM":
      return `EMOM ${Math.round(Number(params?.duration_minutes ?? minutes))} min — ${exerciseCount} stations — 1 station/min`;
    case "FOR_TIME":
      return `For Time — ${params?.rounds ?? "?"} tours — cap ${Math.ceil(Number(params?.cap_seconds ?? minutes * 60) / 60)} min`;
    case "CIRCUIT":
      return `Circuit — ${params?.rounds ?? "?"} tours — repos ${params?.rest_between_rounds_seconds ?? 45}s — ${minutes} min`;
    case "STRENGTH":
      return `Strength — ${params?.sets ?? "?"} séries — repos ${params?.rest_between_exercises_seconds ?? 75}s — ${minutes} min`;
    case "LADDER":
      return `Ladder — départ ${params?.start_reps ?? 2} reps, +${params?.increment_reps ?? 2} par palier — ${params?.rungs ?? "?"} paliers — ${minutes} min`;
    case "PYRAMID":
      return `Pyramide — base ${params?.base_reps ?? 4} reps — 1-2-3-2-1 × ${params?.cycles ?? 1} — ${minutes} min`;
    case "PROGRESSIVE_INTERVAL":
      return `Progressif — départ ${params?.start_reps ?? 3} reps, +${params?.increment_reps ?? 1}/min — palier attendu ${params?.expected_stage ?? "?"} — ${minutes} min`;
    default:
      return `${mechanic} — ${minutes} min — ${exerciseCount} exercices`;
  }
}

function prescribedRounds(mechanic: string, params: any) {
  const value =
    mechanic === "FOR_TIME" || mechanic === "CIRCUIT"
      ? params?.rounds
      : mechanic === "STRENGTH"
      ? params?.sets
      : mechanic === "EMOM"
      ? params?.cycles
      : mechanic === "LADDER"
      ? params?.rungs
      : null;
  const numeric = toNumber(value);
  return numeric == null ? null : clampInt(numeric, 1, 32767);
}

function getWodObjective(mechanic: string, focus: string) {
  if (mechanic === "STRENGTH") return `Développer la force — focus ${focus}.`;
  if (mechanic === "EMOM") return "Maintenir qualité, rythme et répétabilité.";
  if (mechanic === "AMRAP") return "Accumuler un volume propre à rythme soutenu.";
  if (mechanic === "FOR_TIME") return "Compléter un volume défini avec une exécution efficace.";
  if (mechanic === "LADDER" || mechanic === "PYRAMID" || mechanic === "PROGRESSIVE_INTERVAL") {
    return "Faire progresser le volume selon une mécanique contrôlée et prévisible.";
  }
  return "Enchaîner les mouvements avec qualité et fatigue maîtrisée.";
}

function replaceMinutes(structure: string, minutes: number) {
  if (!structure) return `WOD ${minutes} min`;
  return /\d+\s*min/i.test(structure)
    ? structure.replace(/\d+\s*min/i, `${minutes} min`)
    : `${structure} — ${minutes} min`;
}

function normalizeExperience(value: unknown) {
  const normalized = normalize(String(value ?? ""));
  if (normalized.includes("begin") || normalized.includes("debut")) return "Débutant";
  if (normalized.includes("advance") || normalized.includes("avance")) return "Avancé";
  return "Intermédiaire";
}

function normalizeReadiness(value: number | string | undefined) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return clampInt(Math.round(value), 1, 10);
  }
  const n = normalize(String(value ?? "normal"));
  if (["faible", "low"].includes(n)) return 3;
  if (["olympique", "high"].includes(n)) return 9;
  const parsed = Number(n);
  return Number.isFinite(parsed) ? clampInt(parsed, 1, 10) : 6;
}

function readinessBand(score: number) {
  if (score <= 4) return "low";
  if (score >= 8) return "high";
  return "normal";
}

function getMaxComplexity(experience: string, readinessScore: number) {
  let base = experience === "Débutant" ? 3 : experience === "Avancé" ? 5 : 4;
  if (readinessScore <= 4) base -= 1;
  return clampInt(base, 1, 5);
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

function rangeText(min: number | null, max: number | null, unit: string) {
  const a = min ?? max;
  const b = max ?? min;
  const suffix = unit ? ` ${unit}` : "";
  if (a == null && b == null) return "";
  if (a === b) return `${a}${suffix}`;
  return `${a} à ${b}${suffix}`;
}

function toNumber(value: any): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function unique(values: any[]) {
  return Array.from(new Set(values.map((v) => String(v).trim()).filter(Boolean)));
}

function clampInt(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}