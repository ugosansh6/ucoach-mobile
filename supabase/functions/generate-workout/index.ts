// @ts-ignore -- Deno/Supabase Edge Runtime
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-ignore -- Deno/Supabase Edge Runtime
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

declare const Deno: { env: { get(name: string): string | undefined } };

const VERSION = "swap-handler-v10-structural-fallback";
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
  confirm_structural_change?: boolean;
  undo?: boolean;
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const auth = req.headers.get("Authorization");
    const url = Deno.env.get("SUPABASE_URL");
    const anon = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!auth) return json({ error: "Unauthorized" }, 401);
    if (!url || !anon || !serviceRole) throw new Error("Missing Supabase environment variables.");

    const supabase = createClient(url, anon, { global: { headers: { Authorization: auth } } });
    const admin = createClient(url, serviceRole, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData.user) return json({ error: "Unauthorized" }, 401);
    const userId = authData.user.id;
    const body = (await req.json()) as Payload;

    let instanceId = body.session_exercise_id ?? null;

    if (!instanceId) {
      if (!body.session_id || !body.current_exercise_id) {
        return json({ error: "session_exercise_id requis (ou session_id + current_exercise_id pour compatibilité temporaire)." }, 400);
      }

      const { data: rows, error } = await admin
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

    const { data: target, error: targetError } = await admin
      .from("workout_session_exercises")
      .select("id, session_id, exercise_id, block_key, workout_sessions!inner(user_id)")
      .eq("id", instanceId)
      .eq("workout_sessions.user_id", userId)
      .single();
    if (targetError || !target) return json({ error: "Exercice de séance introuvable." }, 404);

    const { data: session, error: sessionError } = await admin
      .from("workout_sessions")
      .select("id, planning_context_json, available_equipment")
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
    let sessionEquipmentNames = Array.isArray(session.available_equipment)
      ? uniqueStrings(session.available_equipment)
      : [];

    if (reason === "environment") {
      const explicit = uniqueStrings(body.unavailable_environment_requirements ?? []);
      const { data: requirements, error: requirementError } = await admin
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
      const { data: requirementRows, error: requirementError } = await admin
        .from("exercise_equipment_requirements_v2")
        .select("option_group, equipment_id, is_optional")
        .eq("exercise_id", target.exercise_id)
        .eq("is_optional", false);
      if (requirementError) throw new Error(requirementError.message);

      let candidateEquipmentIds = uniqueStrings(
        (requirementRows ?? []).map((item: any) => item.equipment_id),
      );

      if (candidateEquipmentIds.length === 0) {
        const { data: legacyRows, error: legacyError } = await admin
          .from("exercise_equipment")
          .select("equipment_id")
          .eq("exercise_id", target.exercise_id);
        if (legacyError) throw new Error(legacyError.message);
        candidateEquipmentIds = uniqueStrings((legacyRows ?? []).map((item: any) => item.equipment_id));
      }

      if (candidateEquipmentIds.length === 0) {
        return json({
          status: "NO_EQUIPMENT_REQUIREMENT_IDENTIFIED",
          code: "NO_EQUIPMENT_REQUIREMENT_IDENTIFIED",
          error: "Ce mouvement ne dépend d’aucun matériel identifié par UGEROD.",
          exercise_id: target.exercise_id,
          version: VERSION,
        }, 422);
      }

      const { data: candidateCatalog, error: candidateCatalogError } = await admin
        .from("equipment")
        .select("id, name")
        .in("id", candidateEquipmentIds);
      if (candidateCatalogError) throw new Error(candidateCatalogError.message);

      if (sessionEquipmentNames.length === 0) {
        const { data: inventoryRows, error: inventoryError } = await admin
          .from("user_equipment_inventory")
          .select("equipment_id")
          .eq("user_id", userId)
          .eq("active", true);
        if (inventoryError) throw new Error(inventoryError.message);

        const inventoryIds = uniqueStrings((inventoryRows ?? []).map((item: any) => item.equipment_id));
        if (inventoryIds.length > 0) {
          const { data: inventoryCatalog, error: inventoryCatalogError } = await admin
            .from("equipment")
            .select("id, name")
            .in("id", inventoryIds);
          if (inventoryCatalogError) throw new Error(inventoryCatalogError.message);
          sessionEquipmentNames = uniqueStrings((inventoryCatalog ?? []).map((item: any) => item.name));
        }
      }

      const availableKeys = new Set(sessionEquipmentNames.map(normalizeKey));
      const candidateNameById = new Map<string, string>(
        (candidateCatalog ?? []).map((item: any) => [String(item.id), String(item.name ?? "")]),
      );
      const currentlyAvailableCandidateIds = candidateEquipmentIds.filter((equipmentId) => {
        const equipmentName = candidateNameById.get(equipmentId) ?? "";
        return availableKeys.has(normalizeKey(equipmentId)) || availableKeys.has(normalizeKey(equipmentName));
      });

      let newlyUnavailableEquipment: string[] = [];
      if (currentlyAvailableCandidateIds.length === 1) {
        newlyUnavailableEquipment = currentlyAvailableCandidateIds;
      } else if (candidateEquipmentIds.length === 1) {
        newlyUnavailableEquipment = candidateEquipmentIds;
      } else {
        return json({
          status: "EQUIPMENT_SELECTION_REQUIRED",
          code: "EQUIPMENT_SELECTION_REQUIRED",
          error: "Ce mouvement peut utiliser plusieurs matériels disponibles. Précise lequel est indisponible.",
          exercise_id: target.exercise_id,
          equipment_options: (candidateCatalog ?? []).map((item: any) => ({ id: item.id, name: item.name })),
          version: VERSION,
        }, 409);
      }

      unavailableEquipmentIds = uniqueStrings([
        ...unavailableEquipmentIds,
        ...newlyUnavailableEquipment,
      ]);

      const { data: unavailableCatalog, error: unavailableCatalogError } = await admin
        .from("equipment")
        .select("id, name")
        .in("id", unavailableEquipmentIds);
      if (unavailableCatalogError) throw new Error(unavailableCatalogError.message);

      const unavailableKeys = new Set<string>();
      for (const item of unavailableCatalog ?? []) {
        unavailableKeys.add(normalizeKey(item.id));
        unavailableKeys.add(normalizeKey(item.name));
      }

      sessionEquipmentNames = sessionEquipmentNames.filter(
        (item) => !unavailableKeys.has(normalizeKey(item)),
      );
      if (sessionEquipmentNames.length === 0) sessionEquipmentNames = ["Aucun"];
    }

    if (unavailableEnvironment.length > 0) {
      const { data: blockedByEnvironment, error: blockedEnvironmentError } = await admin
        .from("exercise_environment_requirements")
        .select("exercise_id")
        .in("requirement_key", unavailableEnvironment);
      if (blockedEnvironmentError) throw new Error(blockedEnvironmentError.message);
      for (const row of blockedByEnvironment ?? []) excludedIds.add(String(row.exercise_id));
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

      const sessionUpdate: Record<string, unknown> = {
        planning_context_json: nextPlanning,
      };
      if (reason === "equipment") {
        sessionUpdate.available_equipment = sessionEquipmentNames;
      }

      const { error: contextUpdateError } = await admin
        .from("workout_sessions")
        .update(sessionUpdate)
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

    if (
      !body.undo &&
      target.block_key === "wod" &&
      (reason === "environment" || reason === "equipment") &&
      data?.status !== "APPLIED"
    ) {
      const { data: structural, error: structuralError } = await supabase.rpc(
        "c4_wod_structural_fallback_v1",
        {
          p_user_id: userId,
          p_session_exercise_id: instanceId,
          p_reason: reason,
          p_confirm_structure_change: Boolean(body.confirm_structural_change),
        },
      );
      if (structuralError) throw new Error(structuralError.message);

      if (structural?.status === "STRUCTURAL_FALLBACK_APPLIED") {
        return json({
          success: true,
          status: structural.status,
          version: VERSION,
          session_id: structural.session_id ?? target.session_id,
          session_exercise_id: instanceId,
          block_key: "wod",
          replaced_exercise_id: target.exercise_id,
          new_exercise_id: null,
          adaptation_reason: reason,
          environment_constraints_applied: unavailableEnvironment,
          unavailable_equipment_ids: unavailableEquipmentIds,
          session_available_equipment: sessionEquipmentNames,
          structural_fallback: true,
          mechanic_changed: Boolean(structural.mechanic_changed),
          old_mechanic: structural.old_mechanic ?? null,
          new_mechanic: structural.new_mechanic ?? null,
          removed_pattern: structural.removed_pattern ?? null,
          substitute: null,
          full_wod_resimulated: true,
          c4_result: structural,
        });
      }

      if (structural?.status === "STRUCTURAL_CHANGE_REQUIRED") {
        return json({
          status: structural.status,
          code: "STRUCTURAL_CHANGE_REQUIRED",
          error: structural.message ?? "Le WOD doit changer de format pour rester cohérent.",
          proposed_mechanic: structural.proposed_mechanic ?? null,
          proposed_parameters: structural.proposed_parameters ?? {},
          requires_user_confirmation: true,
          confirmation_mode: structural.confirmation_mode ?? "repeat_same_reason_within_5_minutes",
          adaptation_reason: reason,
          version: VERSION,
        }, 409);
      }
    }

    if (!data || data.status !== "APPLIED") {
      const status = data?.status === "NO_SAFE_SWAP" || data?.status === "NO_SWAP_TO_UNDO" ? 404 : 422;
      return json({ ...data, adaptation_reason: reason, version: VERSION }, status);
    }

    const result = data.result ?? {};
    const exercises = Array.isArray(result.exercises) ? result.exercises : [];
    const substitute = data.substitute ?? exercises.find((x: any) => x.session_exercise_id === instanceId) ?? null;

    if (!body.undo) {
      const { data: currentRow, error: currentRowError } = await admin
        .from("workout_session_exercises")
        .select("solver_decision_json")
        .eq("id", instanceId)
        .single();
      if (currentRowError) throw new Error(currentRowError.message);

      const solverDecision = currentRow?.solver_decision_json && typeof currentRow.solver_decision_json === "object"
        ? currentRow.solver_decision_json
        : {};

      const { error: reasonUpdateError } = await admin
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
      if (reasonUpdateError) throw new Error(reasonUpdateError.message);
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
      session_available_equipment: sessionEquipmentNames,
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

function normalizeKey(value: unknown): string {
  return String(value ?? "").trim().toLocaleLowerCase("fr-FR");
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
