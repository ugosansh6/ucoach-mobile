import { supabase } from '../lib/supabase';

const REASON_DIRECTIONS = {
  too_easy: 'harder',
  too_hard: 'easier',
  environment: 'equivalent',
  equipment: 'equivalent',
  equivalent: 'equivalent',
};

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
            Array.isArray(
              excludedExerciseIds
            )
              ? excludedExerciseIds.filter(
                  Boolean
                )
              : [],
          undo: false,
        },
      }
    );

  if (error) {
    let detail = null;

    try {
      detail =
        await error?.context?.json();
    } catch {
      detail = null;
    }

    throw new Error(
      detail?.error ??
        detail?.message ??
        error?.message ??
        'Impossible de trouver une alternative sûre.'
    );
  }

  if (data?.error) {
    throw new Error(data.error);
  }

  if (!data?.substitute?.id) {
    throw new Error(
      'UGEROD n’a trouvé aucune alternative sûre dans ce contexte.'
    );
  }

  return data;
}
