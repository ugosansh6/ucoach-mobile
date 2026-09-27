// @ts-ignore -- Deno/Supabase Edge Runtime
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-ignore -- Deno/Supabase Edge Runtime
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

declare const Deno: { env: { get(name: string): string | undefined } };
const VERSION = "format-handler-v5-fast-options-final-guard";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Payload = {
  action?: string;
  session_id?: string;
  mechanic?: string;
  variant_key?: string | null;
  overlays?: unknown[];
};

type OptionSeed = {
  option_id: string;
  mechanic: string;
  variant_key: string | null;
  display_name: string;
  description: string | null;
  manual_free_eligible: boolean;
  manual_premium_eligible: boolean;
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const auth = req.headers.get("Authorization");
    const url = Deno.env.get("SUPABASE_URL");
    const anon = Deno.env.get("SUPABASE_ANON_KEY");
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!auth) return json({ error: "Unauthorized" }, 401);
    if (!url || !anon || !service) throw new Error("Missing Supabase environment variables.");

    const userClient = createClient(url, anon, {
      global: { headers: { Authorization: auth } },
    });
    const adminClient = createClient(url, service);

    const { data: authData, error: authError } = await userClient.auth.getUser();
    if (authError || !authData.user) return json({ error: "Unauthorized" }, 401);

    const body = (await req.json()) as Payload;
    if (!body.session_id) return json({ error: "session_id requis." }, 400);

    const { data: ownedSession, error: ownedSessionError } = await adminClient
      .from("workout_sessions")
      .select("id")
      .eq("id", body.session_id)
      .eq("user_id", authData.user.id)
      .maybeSingle();
    if (ownedSessionError) throw new Error(ownedSessionError.message);
    if (!ownedSession) return json({ error: "Session not found" }, 404);

    if (String(body.action ?? "").toUpperCase() === "OPTIONS") {
      const started = performance.now();
      const data = await loadFormatOptions({
        adminClient,
        userId: authData.user.id,
        sessionId: body.session_id,
      });
      return json({
        version: VERSION,
        timing_ms: Math.round(performance.now() - started),
        ...data,
      });
    }

    if (!body.mechanic) return json({ error: "session_id et mechanic requis." }, 400);

    const started = performance.now();
    const { data, error } = await adminClient.rpc("c4_recompile_session_format", {
      p_user_id: authData.user.id,
      p_session_id: body.session_id,
      p_new_mechanic: normalizeMechanic(body.mechanic),
      p_variant_key: body.variant_key ?? null,
      p_overlays: Array.isArray(body.overlays) ? body.overlays : [],
    });
    if (error) throw new Error(error.message);

    if (data?.classification === "PREMIUM_REQUIRED") {
      return json({ version: VERSION, timing_ms: Math.round(performance.now() - started), ...data }, 403);
    }
    if (data?.classification === "NOT_RECOMMENDED") {
      return json({ version: VERSION, timing_ms: Math.round(performance.now() - started), ...data }, 422);
    }
    return json({ version: VERSION, timing_ms: Math.round(performance.now() - started), ...data }, 200);
  } catch (error) {
    console.error(VERSION, error);
    return json({ error: error instanceof Error ? error.message : "Unknown format change error" }, 400);
  }
});

async function loadFormatOptions({ adminClient, userId, sessionId }: any) {
  const [sessionResult, profileResult, overrideResult, mechanicResult, variantResult, wodResult] = await Promise.all([
    adminClient.from("workout_sessions").select("id,user_id,mechanic_json,format_change_count,wod_started_at,wod_revealed_at,planned_environment_code").eq("id", sessionId).eq("user_id", userId).single(),
    adminClient.from("profiles").select("subscription_tier").eq("id", userId).single(),
    adminClient.from("user_runtime_overrides").select("unlimited_format_changes").eq("user_id", userId).maybeSingle(),
    adminClient.from("workout_mechanics").select("mechanic_key,display_name,short_description,manual_free_eligible,manual_premium_eligible,active,mechanic_kind").eq("active", true).eq("mechanic_kind", "core"),
    adminClient.from("workout_mechanic_variants").select("variant_key,mechanic_key,display_name,short_description,manual_free_eligible,manual_premium_eligible,active").eq("active", true),
    adminClient.from("workout_session_exercises").select("id", { count: "exact", head: true }).eq("session_id", sessionId).eq("block_key", "wod"),
  ]);

  if (sessionResult.error || !sessionResult.data) throw new Error("Session not found");
  if (profileResult.error) throw new Error(profileResult.error.message);
  if (mechanicResult.error) throw new Error(mechanicResult.error.message);
  if (variantResult.error) throw new Error(variantResult.error.message);
  if (wodResult.error) throw new Error(wodResult.error.message);

  const session = sessionResult.data;
  const tier = String(profileResult.data?.subscription_tier ?? "FREE").toUpperCase();
  const unlimited = Boolean(overrideResult.data?.unlimited_format_changes);
  const currentMechanic = normalizeMechanic(session.mechanic_json?.mechanic_key ?? "CIRCUIT");
  let currentVariant = normalizeMechanic(session.mechanic_json?.variant_key ?? "") || null;
  if (!currentVariant && currentMechanic === "COUPLET") currentVariant = "ASCENDING_COUPLET";
  if (!currentVariant && currentMechanic === "PROGRESSIVE_INTERVAL") currentVariant = "PROGRESSIVE_GENERIC";

  const variants = variantResult.data ?? [];
  const mechanicsWithVariants = new Set(variants.map((item: any) => normalizeMechanic(item.mechanic_key)));
  const seeds: OptionSeed[] = [];

  for (const mechanic of mechanicResult.data ?? []) {
    const mechanicKey = normalizeMechanic(mechanic.mechanic_key);
    if (!mechanicKey || mechanicsWithVariants.has(mechanicKey)) continue;
    seeds.push({ option_id: mechanicKey, mechanic: mechanicKey, variant_key: null, display_name: mechanic.display_name, description: mechanic.short_description ?? null, manual_free_eligible: Boolean(mechanic.manual_free_eligible), manual_premium_eligible: Boolean(mechanic.manual_premium_eligible) });
  }
  for (const variant of variants) {
    const mechanicKey = normalizeMechanic(variant.mechanic_key);
    const variantKey = normalizeMechanic(variant.variant_key);
    if (!mechanicKey || !variantKey) continue;
    seeds.push({ option_id: variantKey, mechanic: mechanicKey, variant_key: variantKey, display_name: variant.display_name, description: variant.short_description ?? null, manual_free_eligible: Boolean(variant.manual_free_eligible), manual_premium_eligible: Boolean(variant.manual_premium_eligible) });
  }
  seeds.sort((a, b) => `${a.mechanic}:${a.variant_key ?? ""}`.localeCompare(`${b.mechanic}:${b.variant_key ?? ""}`));

  // PERF-003: selector = cheap catalog. The full C4 quality/safety gate
  // remains authoritative and runs only for the mechanic actually selected.
  const effectiveCount = unlimited ? 0 : Number(session.format_change_count ?? 0);
  const locked = Boolean(session.wod_started_at) || (!unlimited && effectiveCount >= 3);
  const wodExerciseCount = Number(wodResult.count ?? 0);
  const hasMutableWod = wodExerciseCount > 0;

  const options = seeds.map((seed) => {
    const current =
      seed.mechanic === currentMechanic &&
      (seed.variant_key ?? null) === (currentVariant ?? null);
    const entitled =
      tier === "PREMIUM"
        ? seed.manual_premium_eligible
        : seed.manual_free_eligible;

    let classification = "FINAL_VALIDATION_ON_SELECTION";
    let reasonCodes: string[] = [];

    if (current) {
      classification = "CURRENT";
    } else if (!hasMutableWod) {
      classification = "NOT_RECOMMENDED";
      reasonCodes = ["NO_MUTABLE_WOD_BLOCK"];
    } else if (session.wod_started_at) {
      classification = "LOCKED_AFTER_WOD_START";
      reasonCodes = ["WOD_ALREADY_STARTED"];
    } else if (!unlimited && effectiveCount >= 3) {
      classification = "LOCKED_AFTER_FORMAT_CHANGE_LIMIT";
      reasonCodes = ["FORMAT_CHANGE_LIMIT_REACHED"];
    } else if (!entitled) {
      classification = "PREMIUM_REQUIRED";
      reasonCodes = ["PREMIUM_REQUIRED"];
    }

    return {
      option_id: seed.option_id,
      mechanic: seed.mechanic,
      variant_key: seed.variant_key,
      display_name: seed.display_name,
      description: seed.description,
      compatible: current || hasMutableWod,
      classification,
      entitled,
      locked: !current && (!hasMutableWod || locked || !entitled),
      selectable: !current && hasMutableWod && !locked && entitled,
      current,
      reason_codes: reasonCodes,
      mechanic_json: current ? session.mechanic_json ?? null : null,
      validation_mode: current ? "CURRENT" : "FULL_C4_ON_SELECTION",
    };
  });

  return {
    session_id: sessionId,
    subscription_tier: tier,
    current_mechanic: currentMechanic,
    current_variant: currentVariant,
    wod_revealed_at: session.wod_revealed_at ?? null,
    wod_started_at: session.wod_started_at ?? null,
    format_change_count: effectiveCount,
    format_change_limit: 3,
    remaining_format_changes: locked ? 0 : unlimited ? 3 : Math.max(0, 3 - effectiveCount),
    format_change_unlimited: unlimited,
    format_locked: locked,
    format_lock_reason: session.wod_started_at ? "WOD_ALREADY_STARTED" : !unlimited && effectiveCount >= 3 ? "FORMAT_CHANGE_LIMIT_REACHED" : null,
    format_lock_contract: "LOCK_ON_WOD_START_NOT_REVEAL",
    options_evaluation_mode: "FAST_CATALOG_FINAL_GUARD_ON_SELECTION",
    planned_environment_code: session.planned_environment_code ?? null,
    wod_exercise_count: wodExerciseCount,
    options,
  };
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, mapper: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) break;
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function normalizeMechanic(value: string) {
  const n = String(value ?? "").trim().toUpperCase().replace(/[\s\/-]+/g, "_");
  const aliases: Record<string, string> = { FORTIME: "FOR_TIME", MUSCULATION: "STRENGTH", EVERY_X_MIN: "EVERY_X_MINUTES", PROGRESSIVE: "PROGRESSIVE_INTERVAL", HIIT: "HIIT" };
  return aliases[n] ?? n;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
