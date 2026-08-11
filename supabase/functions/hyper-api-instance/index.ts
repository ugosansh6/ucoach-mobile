// hyper-api-instance-v1 — exact workout_session_exercises bridge for Phase B2.6.4
// Keeps hyper-api-v3.0 as the legacy progression/athletic-profile engine while
// guaranteeing that every internal observation is attached to the exact session
// exercise instance, including duplicate exercise IDs across blocks.

// @ts-ignore -- import URL resolved by Deno/Supabase Edge Runtime
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-ignore -- import URL resolved by Deno/Supabase Edge Runtime
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

declare const Deno: {
  env: {
    get(name: string): string | undefined;
  };
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface ExerciseResult {
  session_exercise_id: string;
  exercise_id: string;
  status?: "completed" | "skipped";
  reps_completed?: number | null;
  weight_kg?: number | null;
  duration_seconds?: number | null;
  distance_meters?: number | null;
  rpe?: number | null;
  notes?: string | null;
}

interface Payload {
  session_id: string;
  post_workout_feeling?: number | null;
  global_rpe?: number | null;
  notes?: string | null;
  exercises: ExerciseResult[];
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

    const url = Deno.env.get("SUPABASE_URL");
    const anon = Deno.env.get("SUPABASE_ANON_KEY");

    if (!url || !anon) {
      throw new Error("Missing Supabase environment variables.");
    }

    const supabase = createClient(url, anon, {
      global: {
        headers: {
          Authorization: authHeader,
        },
      },
    });

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return json({ error: "Unauthorized" }, 401);
    }

    const body = (await req.json()) as Payload;

    if (!body.session_id) {
      throw new Error("session_id requis.");
    }

    if (!Array.isArray(body.exercises) || body.exercises.length === 0) {
      throw new Error("Au moins un résultat d'exercice est requis.");
    }

    const instanceIds = body.exercises.map((item) => item.session_exercise_id);

    if (instanceIds.some((id) => !id)) {
      throw new Error(
        "session_exercise_id requis pour chaque exercice interne.",
      );
    }

    if (new Set(instanceIds).size !== instanceIds.length) {
      throw new Error(
        "Chaque session_exercise_id doit apparaître une seule fois dans la validation.",
      );
    }

    const { data: session, error: sessionError } = await supabase
      .from("workout_sessions")
      .select("id, user_id, status")
      .eq("id", body.session_id)
      .eq("user_id", user.id)
      .single();

    if (sessionError || !session) {
      throw new Error("Séance introuvable.");
    }

    if (session.status === "completed") {
      return json({ error: "Cette séance est déjà terminée." }, 409);
    }

    const { data: rows, error: rowsError } = await supabase
      .from("workout_session_exercises")
      .select("id, session_id, exercise_id")
      .eq("session_id", body.session_id)
      .in("id", instanceIds);

    if (rowsError) {
      throw new Error(rowsError.message);
    }

    const instanceById = new Map(
      (rows ?? []).map((row: any) => [String(row.id), row]),
    );

    for (const item of body.exercises) {
      const planned = instanceById.get(item.session_exercise_id);

      if (!planned) {
        throw new Error(
          `L'instance ${item.session_exercise_id} n'appartient pas à cette séance.`,
        );
      }

      if (planned.exercise_id !== item.exercise_id) {
        throw new Error(
          `L'instance ${item.session_exercise_id} ne correspond pas à ${item.exercise_id}.`,
        );
      }
    }

    // Compatibility bridge: hyper-api-v3.0 currently accepts exercise_id only.
    // The database trigger extracts this marker BEFORE the log is persisted,
    // assigns the exact workout_session_exercises.id, copies the correct planned
    // prescription and removes the marker from notes.
    const legacyExercises = body.exercises.map((item) => {
      const marker = `[[UGEROD_INSTANCE:${item.session_exercise_id}]]`;
      const userNotes = item.notes?.trim();

      return {
        exercise_id: item.exercise_id,
        status: item.status,
        reps_completed: item.reps_completed ?? null,
        weight_kg: item.weight_kg ?? null,
        duration_seconds: item.duration_seconds ?? null,
        distance_meters: item.distance_meters ?? null,
        rpe: item.rpe ?? null,
        notes: userNotes ? `${marker} ${userNotes}` : marker,
      };
    });

    const legacyResponse = await fetch(`${url}/functions/v1/hyper-api`, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        apikey: anon,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        session_id: body.session_id,
        post_workout_feeling: body.post_workout_feeling ?? null,
        global_rpe: body.global_rpe ?? null,
        notes: body.notes ?? null,
        exercises: legacyExercises,
      }),
    });

    const legacyText = await legacyResponse.text();
    let legacyData: any = null;

    try {
      legacyData = JSON.parse(legacyText);
    } catch {
      legacyData = null;
    }

    if (!legacyResponse.ok || !legacyData || legacyData.error) {
      return json(
        {
          error:
            legacyData?.error ??
            `Le moteur d'historique a échoué (${legacyResponse.status}).`,
        },
        legacyResponse.status >= 400 ? legacyResponse.status : 400,
      );
    }

    // hyper-api-v3.0 updates workout_session_exercises by exercise_id. That is
    // harmless for unique IDs but imprecise when an exercise is repeated. Restore
    // the exact per-instance actuals after the legacy engine has completed its
    // progression, training-load and athletic-profile work.
    const now = new Date().toISOString();

    for (const item of body.exercises) {
      const { error: updateError } = await supabase
        .from("workout_session_exercises")
        .update({
          status: item.status ?? "completed",
          reps_completed: item.reps_completed ?? null,
          weight_kg: item.weight_kg ?? null,
          duration_seconds: item.duration_seconds ?? null,
          distance_meters: item.distance_meters ?? null,
          rpe:
            (item.status ?? "completed") === "completed"
              ? item.rpe ?? null
              : null,
          notes: item.notes ?? null,
          updated_at: now,
        })
        .eq("id", item.session_exercise_id)
        .eq("session_id", body.session_id);

      if (updateError) {
        throw new Error(
          `Correction de l'instance ${item.session_exercise_id} impossible: ${updateError.message}`,
        );
      }
    }

    return json({
      ...legacyData,
      version: "hyper-api-instance-v1",
      legacy_version: legacyData.version ?? "hyper-api-v3.0",
      exact_instance_count: body.exercises.length,
    });
  } catch (error) {
    return json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unknown exact-instance completion error",
      },
      400,
    );
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}
