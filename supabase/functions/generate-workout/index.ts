// @ts-ignore -- Deno/Supabase Edge Runtime
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-ignore -- Deno/Supabase Edge Runtime
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

declare const Deno: { env: { get(name: string): string | undefined } };

const VERSION = "swap-handler-v7-context-reasons";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type SwapDirection = "easier" | "equivalent" | "harder";
type AdaptationReason = "too_easy" | "too_hard" | "environment" | "equipment" | "equivalent";

type Payload = {
  session_exercise_id?: string;
  session_id?: string;
  current_exercise_id?: string;
  excluded_exercise_ids?: string[];
  direction?: SwapDirection;
  adaptation_reason?: AdaptationReason;
  unavailable_environment_requirements?: string[];
  undo?: boolean;
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

    const { data: target, error: targetError } = await supabase
      .from("workout_session_exercises")
      .select("id, session_id, exercise_id, solver_decision_json, workout_sessions!inner(user_id)")
      .eq("id", instanceId)
      .eq("workout_sessions.user_id", userId)
      .single();
    if (targetError || !target) return json({ error: "Exercice de séance introuvable." }, 404);

    const { data: session, error: sessionError } = await supabase
      .from("workout_sessions")
      .select("id, planning_context_json")
      .eq("id", target.session_id)
      .eq("user_id", userId)
      .single();
    if (sessionError || !session) return json({ error: "Séance introuvable." }, 404);

    const reason: AdaptationReason =
      ["too_easy", "too_hard", "environment", "equipment", "equivalent"].includes(String(body.adaptation_reason))
        ? body.adaptation_reason as AdaptationReason
        : "equivalent";

    let direction: SwapDirection =
      body.direction === "easier" || body.direction === "harder" || body.direction === "equivalent"
        ? body.direction
        : reason === "too_easy"
          ? "harder"
          : reason === "too_hard"
            ? "easier"
            : "equivalent";

    const excludedIds = new Set<string>(
      Array.isArray(body.excluded_exercise_ids) ? body.excluded_exercise_ids.filter(Boolean) : [],
    );
    excludedIds.add(String(target.exercise_id));

    const planning = session.planning_context_json && typeof session.planning_context_json === "object"
      ? session.planning_context_json
      : {};
    const runtimeEnvironment = planning.runtime_environment && typeof planning.runtime_environment === "object"
      ? planning.runtime_environment
      : {};
    const runtimeEquipment = planning.runtime_equipment && typeof planning.runtime_equipment === "object"
      ? planning.runtime_equipment
      : {};

    let unavailableEnvironment = uniqueStrings(runtimeEnvironment.unavailable_requirements ?? []);
    let unavailableEquipmentIds = uniqueStrings(runtimeEquipment.unavailable_equipment_ids ?? []);

    if (reason === "environment") {
      const explicit = uniqueStrings(body.unavailable_environment_requirements ?? []);
      const { data: requirements, error: requirementError } = await supabase
        .from("exercise_environment_requirements")
        .select("requirement_key, reason")
        .eq("exercise_id", target.exercise_id);
      if (requirementError) throw new Error(requirementError.message);

      const inferred = uniqueStrings((requirements ?? []).map((item: any) => item.requirement_key));
      const newlyUnavailable = explicit.length > 0 ? explicit : inferred;

      if (newlyUnavailable.length === 0) {
        return json({
          status: "NO_ENVIRONMENT_REQUIREMENT_IDENTIFIED",
          code: "NO_ENVIRONMENT_REQUIREMENT_IDENTIFIED",
          error: "UGEROD n’a pas identifié de contrainte d’environnement propre à ce mouvement.",
          exercise_id: target.exercise_id,
          version: VERSION,
        }, 422);
      }

      unavailableEnvironment = uniqueStrings([...unavailableEnvironment, ...newlyUnavailable]);
    }

    if (reason === "equipment") {
      const { data: equipmentRows, error: equipmentError } = await supabase
        .from("exercise_equipment")
        .select("equipment_id")
        .eq("exercise_id", target.exercise_id);
      if (equipmentError) throw new Error(equipmentError.message);

      const inferredEquipment = uniqueStrings((equipmentRows ?? []).map((item: any) => item.equipment_id));
      if (inferredEquipment.length === 0) {
        return json({
          status: "NO_EQUIPMENT_REQUIREMENT_IDENTIFIED",
          code: "NO_EQUIPMENT_REQUIREMENT_IDENTIFIED",
          error: "Ce mouvement ne dépend d’aucun matériel identifié par UGEROD.",
          exercise_id: target.exercise_id,
          version: VERSION,
        }, 422);
      }

      unavailableEquipmentIds = uniqueStrings([...unavailableEquipmentIds, ...inferredEquipment]);
    }

    if (unavailableEnvironment.length > 0) {
      const { data: blockedByEnvironment, error: blockedEnvironmentError } = await supabase
        .from("exercise_environment_requirements")
        .select("exercise_id")
        .in("requirement_key", unavailableEnvironment);
      if (blockedEnvironmentError) throw new Error(blockedEnvironmentError.message);
      for (const row of blockedByEnvironment ?? []) excludedIds.add(String(row.exercise_id));
    }

    if (unavailableEquipmentIds.length > 0) {
      const { data: blockedByEquipment, error: blockedEquipmentError } = await supabase
        .from("exercise_equipment")
        .select("exercise_id")
        .in("equipment_id", unavailableEquipmentIds);
      if (blockedEquipmentError) throw new Error(blockedEquipmentError.message);
      for (const row of blockedByEquipment ?? []) excludedIds.add(String(row.exercise_id));
    }

    if (reason === "environment" || reason === "equipment") {
      const nextPlanning = {
        ...planning,
        runtime_environment: {
          ...runtimeEnvironment,
          unavailable_requirements: unavailableEnvironment,
          scope: "current_session_only",
          updated_at: new Date().toISOString(),
        },
        runtime_equipment: {
          ...runtimeEquipment,
          unavailable_equipment_ids: unavailableEquipmentIds,
          scope: "current_session_only",
          updated_at: new Date().toISOString(),
        },
      };

      const { error: contextUpdateError } = await supabase
        .from("workout_sessions")
        .update({ planning_context_json: nextPlanning })
        .eq("id", target.session_id)
        .eq("user_id", userId);
      if (contextUpdateError) throw new Error(contextUpdateError.message);
    }

    const invokeSwap = async (requestedDirection: SwapDirection) => {
      const { data, error } = await supabase.rpc("c4_swap_session_exercise_v3", {
        p_user_id: userId,
        p_session_exercise_id: instanceId,
        p_direction: requestedDirection,
        p_excluded_exercise_ids: Array.from(excludedIds),
        p_undo: Boolean(body.undo),
      });
      if (error) throw new Error(error.message);
      return data;
    };

    let data = await invokeSwap(direction);

    if (
      !body.undo &&
      (reason === "environment" || reason === "equipment") &&
      data?.status !== "APPLIED" &&
      direction === "equivalent"
    ) {
      direction = "easier";
      data = await invokeSwap(direction);
    }

    if (!data || data.status !== "APPLIED") {
      const status = data?.status === "NO_SAFE_SWAP" || data?.status === "NO_SWAP_TO_UNDO" ? 404 : 422;
      return json({ ...data, adaptation_reason: reason, version: VERSION }, status);
    }

    const result = data.result ?? {};
    const exercises = Array.isArray(result.exercises) ? result.exercises : [];
    const substitute = data.substitute ?? exercises.find((x: any) => x.session_exercise_id === instanceId) ?? null;

    if (!body.undo) {
      const solverDecision = target.solver_decision_json && typeof target.solver_decision_json === "object"
        ? target.solver_decision_json
        : {};
      await supabase
        .from("workout_session_exercises")
        .update({
          solver_decision_json: {
            ...solverDecision,
            user_adaptation_reason: reason,
            runtime_environment_unavailable: unavailableEnvironment,
            runtime_equipment_unavailable_ids: unavailableEquipmentIds,
            adaptation_handler_version: VERSION,
          },
        })
        .eq("id", instanceId);
    }

    return json({
      success: true,
      version: VERSION,
      session_id: data.session_id,
      session_exercise_id: instanceId,
      block_key: data.block_key ?? null,
      replaced_exercise_id: data.old_exercise_id,
      new_exercise_id: data.new_exercise_id,
      direction: data.direction ?? direction,
      resolved_direction: direction,
      adaptation_reason: reason,
      environment_constraints_applied: unavailableEnvironment,
      unavailable_equipment_ids: unavailableEquipmentIds,
      undo_applied: Boolean(data.undo_applied),
      substitute,
      full_wod_resimulated: Boolean(data.full_wod_resimulated),
      quality_gate: data.quality_gate,
      c4_result: data,
    });
  } catch (error) {
    console.error(VERSION, error);
    return json({ error: error instanceof Error ? error.message : "Unknown swap error" }, 400);
  }
});

function uniqueStrings(values: unknown[]): string[] {
  return Array.from(new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean)));
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
