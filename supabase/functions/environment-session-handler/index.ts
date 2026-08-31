// @ts-ignore -- Deno/Supabase Edge Runtime
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-ignore -- Deno/Supabase Edge Runtime
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

declare const Deno: { env: { get(name: string): string | undefined } };

const VERSION = "environment-session-handler-v1-long-running-rpc";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ALLOWED_ENVIRONMENTS = new Set(["GYM", "OUTDOOR"]);
const ALLOWED_PARAMS = [
  "p_environment_code",
  "p_surface_code",
  "p_requested_format_code",
  "p_execution_style",
  "p_user_focus",
  "p_duration_minutes",
  "p_readiness",
  "p_target_region",
  "p_progression_intent",
  "p_zone_terms",
  "p_inventory",
  "p_available_equipment",
  "p_outdoor_place_code",
  "p_reliable_distance",
  "p_running_allowed",
  "p_calibration_opportunity",
  "p_max_complexity",
  "p_max_difficulty",
  "p_candidate_count",
  "p_policy_key",
  "p_start_now",
  "p_anchor_date",
] as const;

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function classifyError(message: string) {
  if (/statement timeout|canceling statement due to statement timeout/i.test(message)) {
    return "ENVIRONMENT_GENERATION_TIMEOUT";
  }
  if (/Forbidden user/i.test(message)) return "FORBIDDEN_USER";
  return "ENVIRONMENT_GENERATION_FAILED";
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed", code: "METHOD_NOT_ALLOWED", version: VERSION }, 405);

  try {
    const authorization = req.headers.get("Authorization");
    const url = Deno.env.get("SUPABASE_URL");
    const anon = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!authorization) {
      return json({ ok: false, error: "Missing Authorization header", code: "UNAUTHORIZED", version: VERSION }, 401);
    }
    if (!url || !anon || !serviceRole) {
      throw new Error("Missing Supabase environment variables.");
    }

    const authClient = createClient(url, anon, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: authData, error: authError } = await authClient.auth.getUser();
    if (authError || !authData.user?.id) {
      return json({ ok: false, error: "Unauthorized", code: "UNAUTHORIZED", version: VERSION }, 401);
    }

    const body = await req.json().catch(() => ({}));
    const requested = body?.params && typeof body.params === "object" ? body.params : body;
    const environmentCode = String(requested?.p_environment_code ?? "").trim().toUpperCase();

    if (!ALLOWED_ENVIRONMENTS.has(environmentCode)) {
      return json({
        ok: false,
        error: "environment-session-handler only accepts GYM or OUTDOOR",
        code: "INVALID_ENVIRONMENT",
        version: VERSION,
      });
    }

    const params: Record<string, unknown> = {
      p_user_id: authData.user.id,
      p_environment_code: environmentCode,
    };
    for (const key of ALLOWED_PARAMS) {
      if (key === "p_environment_code") continue;
      if (Object.prototype.hasOwnProperty.call(requested, key)) {
        params[key] = requested[key];
      }
    }

    const admin = createClient(url, serviceRole, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const startedAt = Date.now();
    const { data, error } = await admin.rpc("generate_environment_session_v3", params);
    const elapsedMs = Date.now() - startedAt;

    if (error) {
      console.error(VERSION, JSON.stringify({
        environment_code: environmentCode,
        user_id: authData.user.id,
        elapsed_ms: elapsedMs,
        error: error.message,
      }));
      return json({
        ok: false,
        error: error.message,
        code: classifyError(error.message),
        elapsed_ms: elapsedMs,
        version: VERSION,
      });
    }

    console.log(VERSION, JSON.stringify({
      environment_code: environmentCode,
      user_id: authData.user.id,
      elapsed_ms: elapsedMs,
      status: data?.status ?? null,
      session_id: data?.session_id ?? null,
    }));

    return json({ ok: true, result: data, elapsed_ms: elapsedMs, version: VERSION });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown environment generation error";
    console.error(VERSION, message);
    return json({ ok: false, error: message, code: classifyError(message), version: VERSION }, 500);
  }
});
