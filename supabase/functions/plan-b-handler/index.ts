// @ts-ignore -- Deno/Supabase Edge Runtime
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-ignore -- Deno/Supabase Edge Runtime
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

declare const Deno: { env: { get(name: string): string | undefined } };

const VERSION = "plan-b-handler-v1-long-running-rpc";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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
    return "PLAN_B_TIMEOUT";
  }
  if (/Forbidden user/i.test(message)) return "FORBIDDEN_USER";
  if (/Session not found/i.test(message)) return "SESSION_NOT_FOUND";
  return "PLAN_B_FAILED";
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

    // Authentication remains the user's JWT. Only the expensive database RPC is
    // executed through service_role so it is not killed by authenticated's 8 s timeout.
    const authClient = createClient(url, anon, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: authData, error: authError } = await authClient.auth.getUser();
    if (authError || !authData.user?.id) {
      return json({ ok: false, error: "Unauthorized", code: "UNAUTHORIZED", version: VERSION }, 401);
    }

    const body = await req.json().catch(() => ({}));
    const sessionId = String(body?.session_id ?? "").trim();
    const mode = String(body?.mode ?? "SKILL").trim().toUpperCase();
    const action = String(body?.action ?? "").trim().toUpperCase();

    if (!sessionId) {
      return json({ ok: false, error: "session_id is required", code: "INVALID_PAYLOAD", version: VERSION });
    }
    if (!['SKILL', 'WHOLE_SESSION'].includes(mode)) {
      return json({ ok: false, error: "Unsupported Plan B mode", code: "INVALID_PAYLOAD", version: VERSION });
    }
    if (mode === 'SKILL' && !['ALTERNATE_SKILL', 'SKIP_SKILL'].includes(action)) {
      return json({ ok: false, error: "Unsupported Skill Plan B action", code: "INVALID_PAYLOAD", version: VERSION });
    }

    const admin = createClient(url, serviceRole, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Defense in depth: the authenticated user must own the source session.
    const { data: ownedSession, error: ownershipError } = await admin
      .from("workout_sessions")
      .select("id")
      .eq("id", sessionId)
      .eq("user_id", authData.user.id)
      .maybeSingle();

    if (ownershipError) {
      return json({ ok: false, error: ownershipError.message, code: "OWNERSHIP_CHECK_FAILED", version: VERSION });
    }
    if (!ownedSession?.id) {
      return json({ ok: false, error: "Session not found", code: "SESSION_NOT_FOUND", version: VERSION });
    }

    const rpcName = mode === 'WHOLE_SESSION'
      ? 'change_workout_session_plan_v1'
      : 'change_workout_skill_plan_v1';
    const rpcArgs = mode === 'WHOLE_SESSION'
      ? {
          p_user_id: authData.user.id,
          p_session_id: sessionId,
        }
      : {
          p_user_id: authData.user.id,
          p_session_id: sessionId,
          p_action: action,
        };

    const startedAt = Date.now();
    const { data, error } = await admin.rpc(rpcName, rpcArgs);
    const elapsedMs = Date.now() - startedAt;

    if (error) {
      console.error(VERSION, JSON.stringify({
        rpc: rpcName,
        session_id: sessionId,
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
      rpc: rpcName,
      session_id: sessionId,
      user_id: authData.user.id,
      elapsed_ms: elapsedMs,
      status: data?.status ?? null,
      new_session_id: data?.new_session_id ?? null,
    }));

    return json({ ok: true, result: data, elapsed_ms: elapsedMs, version: VERSION });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Plan B error";
    console.error(VERSION, message);
    return json({ ok: false, error: message, code: classifyError(message), version: VERSION }, 500);
  }
});
