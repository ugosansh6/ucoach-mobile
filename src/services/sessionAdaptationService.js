import { supabase } from '../lib/supabase';
import { getWorkoutSwapAvailabilityForExercise } from './workoutService';

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

  let availability = null;

  try {
    const result = await getWorkoutSwapAvailabilityForExercise(
      sessionId,
      sessionExerciseId
    );
    availability = result?.item ?? null;
  } catch (error) {
    console.warn(
      'Contextual swap availability',
      error
    );
    return null;
  }

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

export async function adaptStartedSession({
  sessionId,
  reason = 'MORE_FATIGUED',
  protectedProgress = {},
}) {
  if (!sessionId) {
    throw new Error(
      "Impossible d’adapter la séance : session_id manquant."
    );
  }

  const protectedSessionExerciseIds =
    protectedProgress?.session_exercise_ids ??
    protectedProgress?.sessionExerciseIds ??
    [];

  const validatedBlocks =
    protectedProgress?.validated_blocks ??
    protectedProgress?.validatedBlocks ??
    [];

  const activeSessionExerciseId =
    protectedProgress?.active_session_exercise_id ??
    protectedProgress?.activeSessionExerciseId ??
    null;

  const { data, error } = await supabase.rpc(
    'adapt_started_session_v2',
    {
      p_session_id: sessionId,
      p_reason: reason,
      p_protected_progress: {
        session_exercise_ids:
          Array.isArray(protectedSessionExerciseIds)
            ? protectedSessionExerciseIds.filter(Boolean)
            : [],
        validated_blocks:
          Array.isArray(validatedBlocks)
            ? validatedBlocks.filter(Boolean)
            : [],
        active_session_exercise_id:
          activeSessionExerciseId ?? null,
      },
    }
  );

  if (error) {
    console.warn(
      'Started session adaptation failed',
      {
        sessionId,
        reason,
        technicalMessage: error?.message ?? null,
      }
    );

    throw new Error(
      error?.message ??
        'Impossible d’ajuster les blocs restants.'
    );
  }

  if (!data || typeof data !== 'object') {
    throw new Error(
      'UGEROD n’a pas reçu de résultat d’adaptation exploitable.'
    );
  }

  if (data.status === 'SESSION_NOT_ADAPTABLE') {
    throw new Error(
      'Cette séance ne peut plus être adaptée dans son état actuel.'
    );
  }

  if (data.status === 'SESSION_NOT_FOUND') {
    throw new Error(
      'La séance à adapter est introuvable.'
    );
  }

  if (data.status === 'UNSUPPORTED_REASON') {
    throw new Error(
      'Ce motif d’adaptation n’est pas encore pris en charge.'
    );
  }

  return data;
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
