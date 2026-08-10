import React, { useMemo, useState } from "react";
import {
  SafeAreaView,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { supabase } from "../src/lib/supabase";

export default function DevBackendTest() {
  const [log, setLog] = useState("Prêt.");
  const [sessionId, setSessionId] = useState(null);
  const [exerciseId, setExerciseId] = useState(null);
  const [loading, setLoading] = useState(false);

  const canSwap = useMemo(
    () => Boolean(sessionId && exerciseId),
    [sessionId, exerciseId]
  );

  const append = (title, payload) => {
    const content =
      typeof payload === "string"
        ? payload
        : JSON.stringify(payload, null, 2);

    setLog((prev) => `${title}\n${content}\n\n${prev}`);
  };

  const checkAuth = async () => {
    const {
      data: { session },
      error,
    } = await supabase.auth.getSession();

    if (error) throw error;

    if (!session?.user) {
      throw new Error(
        "Aucune session Supabase active. Connecte-toi d'abord dans UGEROD."
      );
    }

    append("AUTH OK", {
      user_id: session.user.id,
    });

    return session;
  };

  // ============================================================
  // 1. GENERATION
  // ============================================================

  const generateWorkout = async () => {
    setLoading(true);

    try {
      await checkAuth();

      const { data, error } = await supabase.functions.invoke(
        "bright-handler",
        {
          body: {
            duration_minutes: 45,
            readiness: 7,
            available_equipment: ["Aucun"],
            injured_zones: [],
            target_region: null,
            format_preference: null,
            focus_override: "General Fitness",
          },
        }
      );

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      if (!data?.session_id) {
        throw new Error(
          "bright-handler n'a pas retourné de session_id."
        );
      }

      setSessionId(data.session_id);

      const wod = data?.blocks?.find(
        (block) => block.block_key === "wod"
      );

      const firstExercise = wod?.exercises?.[0];

      if (!firstExercise?.id) {
        throw new Error(
          "La séance a été créée mais aucun exercice WOD n'a été trouvé."
        );
      }

      setExerciseId(firstExercise.id);

      append("1. GENERATION OK", {
        version: data.version,
        session_id: data.session_id,
        status: data.status,
        wod_first_exercise: firstExercise,
        progression_engine: data?.meta?.progression_engine,
      });
    } catch (error) {
      append(
        "ERREUR GENERATION",
        error?.message ?? String(error)
      );
    } finally {
      setLoading(false);
    }
  };

  // ============================================================
  // 2. VERIFICATION PERSISTENCE
  // ============================================================

  const verifyPersistence = async () => {
    setLoading(true);

    try {
      await checkAuth();

      if (!sessionId) {
        throw new Error("Génère d'abord une séance.");
      }

      const { data: session, error: sessionError } =
        await supabase
          .from("workout_sessions")
          .select(
            `
            id,
            user_id,
            status,
            duration_minutes,
            target_region,
            readiness,
            focus,
            generated_workout
          `
          )
          .eq("id", sessionId)
          .single();

      if (sessionError) throw sessionError;

      const { data: exercises, error: exerciseError } =
        await supabase
          .from("workout_session_exercises")
          .select(
            `
            id,
            session_id,
            exercise_id,
            exercise_name,
            block_key,
            position,
            status,
            prescription,
            prescription_json
          `
          )
          .eq("session_id", sessionId)
          .order("block_key", { ascending: true })
          .order("position", { ascending: true });

      if (exerciseError) throw exerciseError;

      append("2. PERSISTENCE OK", {
        session,
        exercise_count: exercises?.length ?? 0,
        exercises,
      });
    } catch (error) {
      append(
        "ERREUR PERSISTENCE",
        error?.message ?? String(error)
      );
    } finally {
      setLoading(false);
    }
  };

  // ============================================================
  // 3. SWAP
  // ============================================================

  const swapExercise = async () => {
  setLoading(true);

  try {
    await checkAuth();

    if (!sessionId || !exerciseId) {
      throw new Error("Génère d'abord une séance.");
    }

    const { data, error } = await supabase.functions.invoke(
      "generate-workout",
      {
        body: {
          session_id: sessionId,
          current_exercise_id: exerciseId,
        },
      }
    );

    if (error) {
      let errorBody = null;
      let status = null;

      try {
        status = error?.context?.status ?? null;
        errorBody = await error?.context?.json();
      } catch {
        errorBody = null;
      }

      append("ERREUR SWAP DETAILLEE", {
        message: error?.message ?? String(error),
        status,
        body: errorBody,
        session_id: sessionId,
        current_exercise_id: exerciseId,
      });

      return;
    }

    if (data?.error) {
      throw new Error(data.error);
    }

    if (data?.substitute?.id) {
      setExerciseId(data.substitute.id);
    }

    append("3. SWAP OK", data);
  } catch (error) {
    append(
      "ERREUR SWAP",
      error?.message ?? String(error)
    );
  } finally {
    setLoading(false);
  }
  };

  // ============================================================
  // 4. TERMINER LA SEANCE
  // ============================================================

  const completeWorkout = async () => {
    setLoading(true);

    try {
      await checkAuth();

      if (!sessionId) {
        throw new Error("Génère d'abord une séance.");
      }

      const { data: sessionExercises, error: sessionError } =
        await supabase
          .from("workout_session_exercises")
          .select(
            `
            exercise_id,
            exercise_name,
            block_key
          `
          )
          .eq("session_id", sessionId);

      if (sessionError) throw sessionError;

      if (!sessionExercises?.length) {
        throw new Error(
          "Aucun exercice trouvé dans la séance."
        );
      }

      const exerciseIds = [
        ...new Set(
          sessionExercises.map((item) => item.exercise_id)
        ),
      ];

      const { data: exerciseMeta, error: metaError } =
        await supabase
          .from("exercises")
          .select("id, tracking_modes")
          .in("id", exerciseIds);

      if (metaError) throw metaError;

      const metaById = new Map(
        (exerciseMeta ?? []).map((exercise) => [
          exercise.id,
          exercise.tracking_modes ?? [],
        ])
      );

      const results = sessionExercises.map((exercise) => {
        const trackingModes =
          metaById.get(exercise.exercise_id) ?? [];

        return {
          exercise_id: exercise.exercise_id,
          status: "completed",

          reps_completed: trackingModes.includes("reps")
            ? 10
            : null,

          weight_kg: trackingModes.includes("load")
            ? 10
            : null,

          duration_seconds: trackingModes.includes("time")
            ? 30
            : null,

          distance_meters: trackingModes.includes("distance")
            ? 200
            : null,

          rpe: 7,

          notes: "UGEROD E2E backend test",
        };
      });

      const { data, error } = await supabase.functions.invoke(
        "hyper-api",
        {
          body: {
            session_id: sessionId,

            post_workout_feeling: 7,

            global_rpe: 7,

            notes: "UGEROD E2E backend test",

            exercises: results,
          },
        }
      );

      if (error) {
        let status = null;
        let errorBody = null;

        try {
          status = error?.context?.status ?? null;
          errorBody = await error?.context?.json();
        } catch {
          errorBody = null;
        }

        append("ERREUR HISTORIQUE DETAILLEE", {
          message: error?.message ?? String(error),
          status,
          body: errorBody,
          session_id: sessionId,
          exercises_sent: results.length,
        });

        return;
      }

      if (data?.error) {
        append("ERREUR HISTORIQUE DETAILLEE", {
          body: data,
          session_id: sessionId,
          exercises_sent: results.length,
        });

        return;
      }

      append("4. HISTORIQUE / COMPLETION OK", data);
    } catch (error) {
      append(
        "ERREUR HISTORIQUE DETAILLEE",
        error?.message ?? String(error)
      );
    } finally {
      setLoading(false);
    }
  };

  // ============================================================
  // 5. VERIFICATION FINALE
  // ============================================================

  const verifyHistory = async () => {
    setLoading(true);

    try {
      await checkAuth();

      if (!sessionId) {
        throw new Error("Aucune session de test.");
      }

      const { data: session, error: sessionError } =
        await supabase
          .from("workout_sessions")
          .select(
            `
            id,
            status,
            started_at,
            completed_at,
            post_workout_feeling,
            global_rpe,
            notes
          `
          )
          .eq("id", sessionId)
          .single();

      if (sessionError) throw sessionError;

      const { data: logs, error: logsError } =
        await supabase
          .from("exercise_logs")
          .select(
            `
            exercise_id,
            status,
            reps_completed,
            weight_kg,
            duration_seconds,
            distance_meters,
            rpe,
            prescription_json,
            created_at
          `
          )
          .eq("session_id", sessionId)
          .order("created_at", { ascending: false });

      if (logsError) throw logsError;

      const exerciseIds = [
        ...new Set(
          (logs ?? []).map((item) => item.exercise_id)
        ),
      ];

      let progression = [];

      if (exerciseIds.length > 0) {
        const { data, error } = await supabase
          .from("user_exercise_progress")
          .select(
            `
            exercise_id,
            exposure_count,
            completed_count,
            skipped_count,
            rpe_count,
            avg_rpe,
            last_rpe,
            recent_rpe,
            rpe_trend,
            adherence_score,
            performance_trend,
            consistency_score,
            mastery_score,
            state,
            recommendation,
            updated_at
          `
          )
          .in("exercise_id", exerciseIds);

        if (error) throw error;

        progression = data ?? [];
      }

      append("5. VERIFICATION FINALE OK", {
        session,
        exercise_logs_count: logs?.length ?? 0,
        exercise_logs: logs,
        user_exercise_progress: progression,
      });
    } catch (error) {
      append(
        "ERREUR VERIFICATION FINALE",
        error?.message ?? String(error)
      );
    } finally {
      setLoading(false);
    }
  };

  // ============================================================
  // UI
  // ============================================================

  const TestButton = ({
    title,
    onPress,
    disabled = false,
  }) => (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || loading}
      style={{
        padding: 15,
        marginBottom: 10,
        borderRadius: 10,
        backgroundColor:
          disabled || loading ? "#444" : "#1769ff",
      }}
    >
      <Text
        style={{
          color: "#fff",
          fontSize: 16,
          fontWeight: "700",
          textAlign: "center",
        }}
      >
        {title}
      </Text>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView
      style={{
        flex: 1,
        backgroundColor: "#0b0b0c",
      }}
    >
      <ScrollView
        contentContainerStyle={{
          padding: 18,
        }}
      >
        <Text
          style={{
            color: "#fff",
            fontSize: 28,
            fontWeight: "900",
            marginBottom: 6,
          }}
        >
          UGEROD Backend E2E
        </Text>

        <Text
          style={{
            color: "#aaa",
            marginBottom: 20,
          }}
        >
          Test temporaire du backend avec l'utilisateur
          actuellement connecté.
        </Text>

        <TestButton
          title="1 — Générer séance"
          onPress={generateWorkout}
        />

        <TestButton
          title="2 — Vérifier persistence"
          onPress={verifyPersistence}
          disabled={!sessionId}
        />

        <TestButton
          title="3 — Swap exercice"
          onPress={swapExercise}
          disabled={!canSwap}
        />

        <TestButton
          title="4 — Terminer séance test"
          onPress={completeWorkout}
          disabled={!sessionId}
        />

        <TestButton
          title="5 — Vérifier logs + progression"
          onPress={verifyHistory}
          disabled={!sessionId}
        />

        <View
          style={{
            marginTop: 15,
            padding: 15,
            borderRadius: 10,
            backgroundColor: "#171719",
          }}
        >
          <Text
            selectable
            style={{
              color: "#e8e8e8",
              fontFamily: "monospace",
              fontSize: 12,
              lineHeight: 18,
            }}
          >
            {log}
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}