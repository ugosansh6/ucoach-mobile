import { supabase } from '../lib/supabase';

const REASON_DIRECTIONS = {
  too_easy: 'harder',
  too_hard: 'easier',
  environment: 'equivalent',
  equipment: 'equivalent',
  equivalent: 'equivalent',
};

const DIRECTIONAL_REASONS = new Set([
  'too_easy',
  'too_hard',
]);

function getSafeFallbackMessage(reason) {
  if (reason === 'too_easy') {
    return 'Aucune progression sûre disponible pour ce mouvement.';
  }

  if (reason === 'too_hard') {
    return 'Aucune régression sûre disponible pour ce mouvement.';
  }

  if (reason === 'environment') {
    return 'Aucune alternative sûre disponible dans cet environnement.';
  }

  if (reason === 'equipment') {
    return 'Aucune alternative sûre disponible avec le matériel restant.';
  }

  return 'Impossible de trouver une alternative sûre.';
}

export async function adaptSessionExercise({
  sessionId,
  sessionExerciseId,
  currentExerciseId,
  reason,
  excludedExerciseIds = [],
}) {
  if (!sessionId || !sessionExerciseId) {
    throw new Error(
      "Impossible d’adapter cet exercice : séance ou instance manquante."
    );
  }

  const adaptationReason =
    REASON_DIRECTIONS[reason]
      ? reason
      : 'equivalent';

  // Un choix explicite "trop facile / trop difficile" doit pouvoir
  // revenir sur une étape adjacente déjà visitée dans la progression.
  // L’anti-boucle reste utile pour les remplacements équivalents et
  // contextuels, mais ne doit pas bloquer une progression/régression.
  const effectiveExcludedExerciseIds =
    DIRECTIONAL_REASONS.has(
      adaptationReason
    )
      ? []
      : Array.isArray(
          excludedExerciseIds
        )
        ? excludedExerciseIds.filter(
            Boolean
          )
        : [];

  const { data, error } =
    await supabase.functions.invoke(
      'generate-workout',
      {
        body: {
          session_id: sessionId,
          session_exercise_id:
            sessionExerciseId,
          current_exercise_id:
            currentExerciseId ?? null,
          direction:
            REASON_DIRECTIONS[
              adaptationReason
            ],
          adaptation_reason:
            adaptationReason,
          excluded_exercise_ids:
            effectiveExcludedExerciseIds,
          undo: false,
        },
      }
    );

  if (error) {
    let detail = null;

    try {
      const context =
        error?.context?.clone?.() ??
        error?.context;

      detail =
        await context?.json?.();
    } catch {
      detail = null;
    }

    console.warn(
      'Session adaptation failed',
      {
        reason: adaptationReason,
        technicalMessage:
          error?.message ?? null,
        detail,
      }
    );

    throw new Error(
      detail?.error ??
        detail?.message ??
        getSafeFallbackMessage(
          adaptationReason
        )
    );
  }

  if (data?.error) {
    throw new Error(
      data.error ??
        getSafeFallbackMessage(
          adaptationReason
        )
    );
  }

  if (!data?.substitute?.id) {
    throw new Error(
      getSafeFallbackMessage(
        adaptationReason
      )
    );
  }

  return data;
}
