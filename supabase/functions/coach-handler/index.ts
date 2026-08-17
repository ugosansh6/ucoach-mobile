// @ts-ignore -- Deno/Supabase Edge Runtime
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-ignore -- Deno/Supabase Edge Runtime
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

declare const Deno: { env: { get(name: string): string | undefined } };

const VERSION = "coach-handler-v9-generation-timeout-guard";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Payload = {
  duration_minutes?: number;
  readiness?: number | string;
  available_equipment?: string[];
  injured_zones?: string[];
  target_region?: "Full Body" | "Lower" | "Upper" | "Core" | null;
  format_preference?: string | null;
  format_variant?: string | null;
  format_overlays?: unknown[];
  focus_override?: string | null;
  progression_intent?: string | null;
  local_date?: string | null;
  force_recalculate_started?: boolean;
  protected_session_exercise_ids?: string[];
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

    const supabase = createClient(url, anon, { global: { headers: { Authorization: auth } } });
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData.user) return json({ error: "Unauthorized" }, 401);

    const userId = authData.user.id;
    const body = (await req.json()) as Payload;
    const duration = clampInt(Number(body.duration_minutes ?? 45), 20, 90);
    const readinessScore = normalizeReadiness(body.readiness);
    const readiness = readinessBand(readinessScore);
    const focusOverride = normalizeFocus(body.focus_override);
    const equipment = unique(body.available_equipment?.length ? body.available_equipment : ["Aucun"]);
    const injuredZones = unique(body.injured_zones ?? []);
    const localDate = normalizeLocalDate(body.local_date);
    const protectedSessionExerciseIds = unique(body.protected_session_exercise_ids ?? []);

    const { data: profile, error: profileError } = await supabase
      .from("profiles").select("experience").eq("id", userId).maybeSingle();
    if (profileError) throw new Error(profileError.message);
    const experience = normalizeExperience(profile?.experience);
    const maxComplexity = getMaxComplexity(experience, readinessScore);

    const { data: inventory, error: inventoryError } = await supabase.rpc(
      "resolve_user_equipment_inventory",
      { p_user_id: userId, p_selected_names: equipment, p_policy_key: "c4-final-default" },
    );
    if (inventoryError) throw new Error(inventoryError.message);

    const { data: generated, error: generateError } = await supabase.rpc(
      "d_generate_adaptive_session_v2",
      {
        p_user_id: userId,
        p_focus_override: focusOverride,
        p_duration_minutes: duration,
        p_readiness: readiness,
        p_target_region_override: body.target_region ?? null,
        p_progression_intent_override: normalizeIntent(body.progression_intent),
        p_zone_terms: injuredZones,
        p_inventory: inventory ?? [],
        p_available_equipment: equipment,
        p_max_complexity: maxComplexity,
        p_max_difficulty: experience,
        p_candidate_count: 12,
        p_policy_key: "c4-final-default",
        p_anchor_date: localDate,
        p_force_recalculate_started: Boolean(body.force_recalculate_started),
        p_protected_session_exercise_ids: protectedSessionExerciseIds,
      },
    );
    if (generateError) throw new Error(generateError.message);

    if (["STARTED_SESSION_CONFIRM_REQUIRED", "RECALC_LIMIT_REACHED"].includes(generated?.status)) {
      return json({
        ...(generated ?? {}),
        version: VERSION,
      });
    }

    if (
      ["resume_existing", "safety_adapted_existing", "safety_adapt_partial_recalc_required"].includes(generated?.status)
      && generated?.session_id
    ) {
      const workout = generated.generated_workout ?? {};
      const coachNote = await getSessionCoachNote(supabase, generated.session_id);
      const safetyAdaptation = generated.safety_adaptation ?? null;
      return json({
        session_id: generated.session_id,
        status: "generated",
        version: VERSION,
        ...(workout ?? {}),
        generation_control_status: generated.status,
        context_recalculation_count: generated.context_recalculation_count ?? 0,
        context_recalculation_limit: generated.context_recalculation_limit ?? 3,
        safety_adaptation: safetyAdaptation,
        meta: {
          ...(workout?.meta ?? {}),
          backend_authority: "d1_weekly_loop_plus_c4_full_session",
          legacy_scaffold_authority: false,
          weekly_loop: generated.weekly_loop ?? null,
          resumed_existing_session: generated.status === "resume_existing",
          safety_adapted_existing: generated.status === "safety_adapted_existing",
          safety_adaptation: safetyAdaptation,
          generation_control_status: generated.status,
          context_recalculation_count: generated.context_recalculation_count ?? 0,
          context_recalculation_limit: generated.context_recalculation_limit ?? 3,
          coach_note: coachNote,
          format_preference_result: null,
        },
      });
    }

    if (!generated || generated.status !== "generated" || !generated.session_id) {
      return json(generated ?? { error: "No safe coherent session" }, 422);
    }

    let formatResult: any = null;
    const preferred = normalizeMechanic(body.format_preference);
    if (preferred) {
      const { data, error } = await supabase.rpc("c4_recompile_session_format", {
        p_user_id: userId,
        p_session_id: generated.session_id,
        p_new_mechanic: preferred,
        p_variant_key: body.format_variant ?? null,
        p_overlays: Array.isArray(body.format_overlays) ? body.format_overlays : [],
      });
      if (error) throw new Error(error.message);
      formatResult = data;
    }

    const { data: stored, error: storedError } = await supabase
      .from("workout_sessions")
      .select("generated_workout, planning_context_json, progression_intent, focus, target_region, context_recalculation_count, context_recalculation_root_session_id, context_recalculation_parent_session_id")
      .eq("id", generated.session_id)
      .eq("user_id", userId)
      .single();
    if (storedError) throw new Error(storedError.message);

    const workout = stored.generated_workout ?? generated;
    const weeklyLoop = generated.weekly_loop ?? stored.planning_context_json?.weekly_loop ?? null;
    const coachNote = await getSessionCoachNote(supabase, generated.session_id);

    return json({
      session_id: generated.session_id,
      status: "generated",
      version: VERSION,
      ...(workout ?? {}),
      context_recalculation_count: stored.context_recalculation_count ?? generated.context_recalculation_count ?? 0,
      context_recalculation_limit: generated.context_recalculation_limit ?? 3,
      recalculation_continuity: generated.recalculation_continuity ?? stored.planning_context_json?.recalculation_continuity ?? null,
      meta: {
        ...(workout?.meta ?? generated.meta ?? {}),
        backend_authority: "d1_weekly_loop_plus_c4_full_session",
        legacy_scaffold_authority: false,
        weekly_loop: weeklyLoop,
        weekly_loop_version: "d1-weekly-loop-v1",
        progression_intent: stored.progression_intent ?? weeklyLoop?.progression_intent ?? null,
        focus: stored.focus ?? weeklyLoop?.focus ?? null,
        target_region: stored.target_region ?? weeklyLoop?.target_region ?? null,
        context_recalculation_count: stored.context_recalculation_count ?? 0,
        context_recalculation_limit: generated.context_recalculation_limit ?? 3,
        context_recalculation_root_session_id: stored.context_recalculation_root_session_id ?? null,
        context_recalculation_parent_session_id: stored.context_recalculation_parent_session_id ?? null,
        recalculation_continuity: generated.recalculation_continuity ?? stored.planning_context_json?.recalculation_continuity ?? null,
        coach_note: coachNote,
        format_preference_result: formatResult,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown coach error";
    console.error(VERSION, message);

    if (/statement timeout|canceling statement due to statement timeout/i.test(message)) {
      return json(
        {
          error: "UGEROD a mis plus de temps que prévu à construire ta séance. Réessaie.",
          code: "GENERATION_TIMEOUT",
        },
        503,
      );
    }

    return json({ error: message }, 400);
  }
});

async function getSessionCoachNote(supabase: any, sessionId: string) {
  const { data, error } = await supabase.rpc("e_session_coach_note", {
    p_session_id: sessionId,
  });
  if (error) {
    console.error(`${VERSION}: coach note non-blocking`, error.message);
    return null;
  }
  return data ?? null;
}

function normalizeIntent(value: string | null | undefined) {
  const v = String(value ?? "").trim().toUpperCase();
  return ["MAINTAIN","PROGRESS","CONSOLIDATE","DELOAD","RECALIBRATE","EXPLORE"].includes(v) ? v : null;
}
function normalizeFocus(value: string | null | undefined) {
  const v = String(value ?? "").trim();
  return ["General Fitness","Fat Loss","Muscle Gain","Strength","Conditioning"].includes(v) ? v : null;
}
function normalizeLocalDate(value: string | null | undefined) {
  const v = String(value ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}
function normalizeMechanic(value: string | null | undefined) {
  const raw = String(value ?? "").trim();
  if (!raw || ["auto","automatic","automatique"].includes(raw.toLowerCase())) return null;
  const n = raw.toUpperCase().replace(/[\s\/-]+/g, "_");
  const aliases: Record<string,string> = {
    FORTIME: "FOR_TIME", FOR_TIME: "FOR_TIME", MUSCULATION: "STRENGTH",
    EVERY_X_MIN: "EVERY_X_MINUTES", EVERY_X_MINUTES: "EVERY_X_MINUTES",
    ODD_EVEN: "ODD_EVEN", REP_TARGET: "REP_TARGET", PROGRESSIVE: "PROGRESSIVE_INTERVAL",
    DEATH_BY: "PROGRESSIVE_INTERVAL", DEATH_BY_COUPLET: "PROGRESSIVE_INTERVAL",
  };
  return aliases[n] ?? n;
}
function normalizeExperience(value: unknown) {
  const n = normalize(String(value ?? ""));
  if (n.includes("begin") || n.includes("debut")) return "Débutant";
  if (n.includes("advance") || n.includes("avance")) return "Avancé";
  return "Intermédiaire";
}
function normalizeReadiness(value: number | string | undefined) {
  if (typeof value === "number" && Number.isFinite(value)) return clampInt(Math.round(value), 1, 10);
  const n = normalize(String(value ?? "normal"));
  if (["faible","low"].includes(n)) return 3;
  if (["olympique","high"].includes(n)) return 9;
  const parsed = Number(n);
  return Number.isFinite(parsed) ? clampInt(parsed, 1, 10) : 6;
}
function readinessBand(score: number) { if (score <= 4) return "low"; if (score >= 8) return "high"; return "normal"; }
function getMaxComplexity(experience: string, readinessScore: number) {
  let base = experience === "Débutant" ? 3 : experience === "Avancé" ? 5 : 4;
  if (readinessScore <= 4) base -= 1;
  return clampInt(base, 1, 5);
}
function normalize(value: string) { return String(value ?? "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""); }
function unique(values: any[]) { return Array.from(new Set(values.map((v) => String(v).trim()).filter(Boolean))); }
function clampInt(value: number, min: number, max: number) { return Math.min(max, Math.max(min, Math.round(value))); }
function json(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
