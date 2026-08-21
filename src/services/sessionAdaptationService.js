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

const CONTEXTUAL_REASONS = new Set([
  'environment',
  'equipment',
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

async function resolveAdaptationDirection({
  sessionId,
  sessionExerciseId,
  adaptationReason,
}) {
  if (!CONTEXTUAL_REASONS.has(adaptationReason)) {
    return REASON_DIRECTIONS[adaptationReason] ?? 'equivalent';
  }

  const { data, error } = await supabase.rpc(
    'get_workout_swap_availability',
    {
      p_session_id: sessionId,
    }
  );

  if (error) {
    console.warn(
      'Contextual swap availability',
      error
    );
    return null;
  }

  const availability =
    data?.items?.[sessionExerciseId] ?? null;
  const directions =
    availability?.directions ?? {};

  // Pour une contrainte de lieu ou de matériel, on cherche d'abord
  // une alternative de niveau comparable. Si elle n'existe pas,
  // une régression déjà validée par le moteur est préférable à
  // laisser l'utilisateur avec un exercice impossible à réaliser.
  if (directions?.equivalent?.available === true) {
    return 'equivalent';
  }

  if (directions?.easier?.available === true) {
    return 'easier';
  }

  return null;
}

export async function adaptSessionExercise({
  sessionId,
  sessionExerciseId,
  currentExerciseId,
  reason,
  excludedExerciseIds = [],
  confirmStructuralChange = false,
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

  const direction =
    await resolveAdaptationDirection({
      sessionId,
      sessionExerciseId,
      adaptationReason,
    });

  if (!direction) {
    throw new Error(
      getSafeFallbackMessage(
        adaptationReason
      )
    );
  }

  // Un choix explicite "trop facile / trop difficile" doit pouvoir
  // revenir sur une étape adjacente déjà visitée dans la progression.
  // Même logique pour une contrainte de lieu/matériel : une ancienne
  // alternative sûre reste préférable à un mouvement devenu impossible.
  const effectiveExcludedExerciseIds =
    DIRECTIONAL_REASONS.has(
      adaptationReason
    ) ||
    CONTEXTUAL_REASONS.has(
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
          direction,
          adaptation_reason:
            adaptationReason,
          excluded_exercise_ids:
            effectiveExcludedExerciseIds,
          confirm_structural_change:
            Boolean(confirmStructuralChange),
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
        direction,
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

  const structuralFallbackApplied =
    data?.structural_fallback === true ||
    data?.status ===
      'STRUCTURAL_FALLBACK_APPLIED';

  if (
    !structuralFallbackApplied &&
    !data?.substitute?.id
  ) {
    throw new Error(
      getSafeFallbackMessage(
        adaptationReason
      )
    );
  }

  return data;
}
