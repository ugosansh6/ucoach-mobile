// @ts-ignore -- Deno/Supabase Edge Runtime
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-ignore -- Deno/Supabase Edge Runtime
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

declare const Deno: { env: { get(name: string): string | undefined } };

const VERSION = "swap-handler-v4-c4-exact-instance";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Payload = {
  session_exercise_id?: string;
  session_id?: string;
  current_exercise_id?: string;
  excluded_exercise_ids?: string[];
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const auth = req.headers.get("Authorization");
    const url = Deno.env.get("SUPABASE_URL");
    const anon = Deno.env.get("SUPABASE_ANON_KEY");
    if (!auth) return json({ error: "Unauthorized" }, 401);
    if (!url || !anon) throw new Error("Missing Supabase environment variables.");

    const supabase = createClient(url, anon, { global: { headers: { Authorization: auth } } });
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData.user) return json({ error: "Unauthorized" }, 401);
    const userId = authData.user.id;
    const body = (await req.json()) as Payload;

    let instanceId = body.session_exercise_id ?? null;

    // Backward compatibility only: resolve the old exercise-id payload when it is unambiguous.
    if (!instanceId) {
      if (!body.session_id || !body.current_exercise_id) {
        return json({ error: "session_exercise_id requis (ou session_id + current_exercise_id pour compatibilité temporaire)." }, 400);
      }

      const { data: rows, error } = await supabase
        .from("workout_session_exercises")
        .select("id, session_id, exercise_id, block_key, position, workout_sessions!inner(user_id)")
        .eq("session_id", body.session_id)
        .eq("exercise_id", body.current_exercise_id)
        .eq("workout_sessions.user_id", userId)
        .order("position", { ascending: true })
        .limit(2);
      if (error) throw new Error(error.message);
      if (!rows || rows.length === 0) return json({ error: "Exercice de séance introuvable." }, 404);
      if (rows.length > 1) {
        return json({
          error: "Plusieurs occurrences de cet exercice existent dans la séance : session_exercise_id est nécessaire.",
          code: "EXACT_INSTANCE_REQUIRED",
          candidates: rows.map((r: any) => ({ session_exercise_id: r.id, block_key: r.block_key, position: r.position })),
        }, 409);
      }
      instanceId = rows[0].id;
    }

    const { data, error } = await supabase.rpc("c4_swap_session_exercise", {
      p_user_id: userId,
      p_session_exercise_id: instanceId,
      p_excluded_exercise_ids: Array.isArray(body.excluded_exercise_ids) ? body.excluded_exercise_ids : [],
    });
    if (error) throw new Error(error.message);

    if (!data || data.status !== "APPLIED") {
      const status = data?.status === "NO_SAFE_SWAP" ? 404 : 422;
      return json({ ...data, version: VERSION }, status);
    }

    const result = data.result ?? {};
    const exercises = Array.isArray(result.exercises) ? result.exercises : [];
    const substitute = exercises.find((x: any) => x.session_exercise_id === instanceId) ?? null;

    return json({
      success: true,
      version: VERSION,
      session_id: data.session_id,
      session_exercise_id: instanceId,
      replaced_exercise_id: data.old_exercise_id,
      new_exercise_id: data.new_exercise_id,
      substitute,
      full_wod_resimulated: true,
      quality_gate: data.quality_gate,
      c4_result: data,
    });
  } catch (error) {
    console.error(VERSION, error);
    return json({ error: error instanceof Error ? error.message : "Unknown swap error" }, 400);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
